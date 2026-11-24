import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  DEFAULT_ATTENDANCE_RULES,
  attendanceRulesSchema,
  clockPositionSchema,
  hrOverrides,
  leaverEntitlement,
  hrSettings,
  insideGeofence,
  contractSchema,
  hrSettingsSchema,
  leaveRequestSchema,
  localDate,
  minutesOf,
  permissionRequestSchema,
  workPatternSchema,
  zonedToUtc,
  addDays,
} from '@hf/shared';
import type { Tx } from '@hf/db';
import { Auth, Meta, Staff } from '../common/decorators';
import { asStaff } from '../common/auth.guard';
import type { Principal, RequestMeta, StaffPrincipal } from '../common/principal';
import { AuditService, Tenancy } from '../common/services';
import { DomainError, badRequest, conflict, forbidden, notFound } from '../common/errors';
import { parse, uuid } from '../common/zod';
import { BlockList, isIP } from 'node:net';
import { HrService, type ContractRow } from './hr.service';

const zDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const zMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const today = () => localDate(new Date());
const can = (s: StaffPrincipal, p: string) => s.privileges.has(p as never);

/** Contract fields every HR viewer may see; salary, insurance and bank details need payroll:view. */
function contractView(c: ContractRow | null, withPay: boolean) {
  if (!c) return null;
  const base = {
    id: c.id, user_id: c.user_id, clinic_id: c.clinic_id, job_title_ar: c.job_title_ar, job_title_en: c.job_title_en, employment_type: c.employment_type,
    pay_basis: c.pay_basis, start_date: c.start_date, end_date: c.end_date, work_pattern: c.work_pattern, status: c.status,
  };
  return withPay
    ? { ...base, base_salary: c.base_salary, allowances: c.allowances, insurable_wage: c.insurable_wage, social_insurance_number: c.social_insurance_number, bank_name: c.bank_name, iban_last4: c.iban_last4, date_of_birth: c.date_of_birth }
    : base;
}

/**
 * Staff HR (Sprint 19): attendance, leave, hourly permissions, public holidays and employment contracts.
 * Every staff member uses the "me" routes for their own records; managers use the team routes (hr:*), and salary
 * data needs payroll privileges.
 */
@Controller('v1/hr')
export class HrController {
  constructor(private readonly tenancy: Tenancy, private readonly audit: AuditService, private readonly hr: HrService) {}

  // ---- Self-service ------------------------------------------------------------------------------------------

  @Get('me')
  @Staff()
  me(@Auth() p: Principal, @Query('month') month?: string) {
    const s = asStaff(p);
    const allowanceDay = month ? `${parse(zMonth, month)}-01` : null;
    return this.tenancy.system(s.orgId, async (tx) => {
      await this.hr.ensureLeaveTypes(tx);
      const c = await this.hr.activeContract(tx, s.userId);
      const day = today();
      const att = await tx.maybeOne(`select * from attendance_records where user_id = $1 and work_date = $2`, [s.userId, day]);
      const year = Number(day.slice(0, 4));
      const settings = await this.hr.settings(tx);
      const used = await tx.one<{ n: number; minutes: number }>(
        `select count(*)::int as n, coalesce(sum(minutes), 0)::int as minutes from permission_requests
         where user_id = $1 and status in ('pending','approved') and work_date >= date_trunc('month', $2::date) and work_date < date_trunc('month', $2::date) + interval '1 month'`,
        [s.userId, allowanceDay ?? day],
      );
      // A shift that crossed midnight leaves yesterday's record open.
      const openRecord = await tx.maybeOne(
        `select * from attendance_records where user_id = $1 and clock_in is not null and clock_out is null and clock_in > now() - interval '16 hours' order by work_date desc limit 1`,
        [s.userId],
      );
      return {
        contract: contractView(c, true),
        today: att,
        openRecord,
        clockCheck: c ? await this.clockCheckInfo(tx, c.clinic_id) : null,
        permissionAllowance: { perMonth: settings.permissionsPerMonth, minutesPerMonth: settings.permissionMinutesPerMonth, used: used.n, usedMinutes: used.minutes },
        annualBalance: c ? await this.hr.annualBalance(tx, s.userId, year) : null,
        pending: {
          leave: await tx.query(`select r.*, t.code, t.name_ar, t.name_en from leave_requests r join leave_types t on t.id = r.leave_type_id where r.user_id = $1 and r.status = 'pending' order by r.start_date`, [s.userId]),
          permissions: await tx.query(`select * from permission_requests where user_id = $1 and status = 'pending' order by work_date`, [s.userId]),
        },
      };
    });
  }

  /** Clock in or out at the server's time; the work day is the Cairo calendar day of the clock-in. */
  @Post('attendance/clock')
  @Staff()
  @HttpCode(200)
  clock(@Auth() p: Principal, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const s = asStaff(p);
    const b = parse(z.object({ action: z.enum(['in', 'out']), source: z.enum(['console', 'mobile']).default('console'), position: clockPositionSchema.optional() }), body);
    return this.tenancy.system(s.orgId, async (tx) => {
      const c = await this.hr.requireContract(tx, s.userId);
      const check = await this.locationCheck(tx, c.clinic_id, meta.ip, b.position);
      if (check.mode === 'block' && check.verdict !== 'ok') throw new DomainError('clock_location_not_allowed', HttpStatus.FORBIDDEN, check.detail);
      const now = new Date();
      const day = localDate(now);
      let rec: { id: string } | null;
      if (b.action === 'in') {
        // A day can hold several clock-in/out pairs (split shifts, back from a break); only one may be open.
        const existing = await tx.maybeOne<{ id: string; clock_in: Date | null; open: boolean }>(
          `select id, clock_in, (jsonb_array_length(punches) > 0 and punches->-1->>'out' is null) as open from attendance_records where user_id = $1 and work_date = $2 for update`,
          [s.userId, day],
        );
        if (existing?.open) throw conflict('already_clocked_in');
        if (existing && (await tx.one<{ n: number }>('select jsonb_array_length(punches) as n from attendance_records where id = $1', [existing.id])).n >= 6) throw conflict('too_many_clock_ins');
        const punch = JSON.stringify([{ in: now.toISOString(), out: null }]);
        rec = existing
          ? await tx.one<{ id: string }>(
              `update attendance_records set punches = punches || $2::jsonb, clock_in = coalesce(clock_in, $3), clock_out = null, source = $4, status = 'open', updated_at = now() where id = $1 returning id`,
              [existing.id, punch, now, b.source],
            )
          : await tx.one<{ id: string }>(
              `insert into attendance_records (organisation_id, user_id, clinic_id, work_date, clock_in, punches, source) values (app_org(), $1,$2,$3,$4,$5,$6) returning id`,
              [s.userId, c.clinic_id, day, now, punch, b.source],
            );
      } else {
        // The open pair from today, or from yesterday for a shift that crosses midnight (opened within 16 hours).
        rec = await tx.maybeOne<{ id: string }>(
          `select id from attendance_records where user_id = $1 and work_date >= $2::date - 1 and jsonb_array_length(punches) > 0
             and punches->-1->>'out' is null and (punches->-1->>'in')::timestamptz > now() - interval '16 hours' order by work_date desc limit 1 for update`,
          [s.userId, day],
        );
        if (!rec) throw new DomainError('not_clocked_in', HttpStatus.CONFLICT);
        await tx.query(
          `update attendance_records set punches = jsonb_set(punches, array[(jsonb_array_length(punches) - 1)::text, 'out'], to_jsonb($2::timestamptz)), clock_out = $2, updated_at = now() where id = $1`,
          [rec.id, now],
        );
      }
      if (check.mode !== 'off') {
        const col = b.action === 'in' ? 'clock_in' : 'clock_out';
        await tx.query(`update attendance_records set ${col}_check = $2, ${col}_check_detail = $3 where id = $1`, [rec!.id, check.verdict, JSON.stringify(check.detail)]);
      }
      const out = await this.hr.recompute(tx, rec!.id);
      await this.audit.record(tx, s, meta, { action: `hr.clock_${b.action}`, entity: 'attendance_record', entityId: rec!.id, clinicId: c.clinic_id, details: check.mode === 'off' ? undefined : { check: check.verdict } });
      return out;
    });
  }

  @Get('me/attendance')
  @Staff()
  myAttendance(@Auth() p: Principal, @Query('month') month?: string) {
    const s = asStaff(p);
    const m = parse(zMonth, month ?? today().slice(0, 7));
    return this.tenancy.system(s.orgId, (tx) => this.monthView(tx, s.userId, m));
  }

  @Get('me/requests')
  @Staff()
  myRequests(@Auth() p: Principal) {
    const s = asStaff(p);
    return this.tenancy.system(s.orgId, async (tx) => ({
      leave: await tx.query(
        `select r.*, t.code, t.name_ar, t.name_en from leave_requests r join leave_types t on t.id = r.leave_type_id where r.user_id = $1 order by r.start_date desc limit 100`,
        [s.userId],
      ),
      permissions: await tx.query(`select * from permission_requests where user_id = $1 order by work_date desc limit 100`, [s.userId]),
    }));
  }

  @Get('me/balances')
  @Staff()
  myBalances(@Auth() p: Principal, @Query('year') year?: string) {
    const s = asStaff(p);
    return this.tenancy.system(s.orgId, (tx) => this.balances(tx, s.userId, Number(year) || Number(today().slice(0, 4))));
  }

  @Get('leave-types')
  @Staff()
  leaveTypes(@Auth() p: Principal) {
    return this.tenancy.system(p.orgId, async (tx) => {
      await this.hr.ensureLeaveTypes(tx);
      return tx.query('select * from leave_types order by uses_annual_balance desc, code');
    });
  }

  /** Request leave for yourself; with `userId`, a manager (hr:create) records it for a team member. */
  @Post('leave-requests')
  @Staff()
  requestLeave(@Auth() p: Principal, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const s = asStaff(p);
    const b = parse(leaveRequestSchema, body);
    const userId = b.userId ?? s.userId;
    if (userId !== s.userId && !can(s, 'hr:create')) throw forbidden();
    return this.tenancy.system(s.orgId, async (tx) => {
      if (userId !== s.userId) await this.assertTeamMember(tx, s, userId);
      const c = await this.hr.requireContract(tx, userId);
      const type = await tx.maybeOne<{ id: string; code: string; uses_annual_balance: boolean; annual_quota: number | null; max_consecutive_days: number | null; is_active: boolean }>(
        'select * from leave_types where id = $1',
        [b.leaveTypeId],
      );
      if (!type || !type.is_active) throw notFound('leave_type');
      if (b.startDate.slice(0, 4) !== b.endDate.slice(0, 4)) throw badRequest('leave_must_stay_within_one_year');
      const days = await this.hr.leaveDays(tx, workPatternSchema.parse(c.work_pattern), type.code, b.startDate, b.endDate);
      if (days <= 0) throw badRequest('no_working_days_in_range');
      if (type.max_consecutive_days !== null && days > Number(type.max_consecutive_days)) throw new DomainError('exceeds_max_consecutive_days', HttpStatus.UNPROCESSABLE_ENTITY, { max: Number(type.max_consecutive_days) });
      const overlap = await tx.maybeOne(`select 1 from leave_requests where user_id = $1 and status in ('pending','approved') and start_date <= $3 and end_date >= $2`, [userId, b.startDate, b.endDate]);
      if (overlap) throw conflict('overlapping_leave');
      const year = Number(b.startDate.slice(0, 4));
      if (type.annual_quota !== null && (await this.hr.typeUsage(tx, userId, type.id, year)) + days > Number(type.annual_quota))
        throw new DomainError('leave_quota_exceeded', HttpStatus.UNPROCESSABLE_ENTITY, { quota: Number(type.annual_quota) });
      if (type.uses_annual_balance) {
        const bal = await this.hr.annualBalance(tx, userId, year);
        if (days > bal.available) throw new DomainError('insufficient_leave_balance', HttpStatus.UNPROCESSABLE_ENTITY, { available: bal.available, requested: days });
      }
      const r = await tx.one<{ id: string }>(
        `insert into leave_requests (organisation_id, user_id, clinic_id, leave_type_id, start_date, end_date, days, reason, requested_by) values (app_org(), $1,$2,$3,$4,$5,$6,$7,$8) returning *`,
        [userId, c.clinic_id, type.id, b.startDate, b.endDate, days, b.reason ?? null, s.userId],
      );
      await this.audit.record(tx, s, meta, { action: 'hr.leave_request', entity: 'leave_request', entityId: r.id, clinicId: c.clinic_id, details: { userId, days, type: type.code } });
      return r;
    });
  }

  /** Request an hourly permission (late arrival, early leave, or time out during the day) within the monthly allowance. */
  @Post('permission-requests')
  @Staff()
  requestPermission(@Auth() p: Principal, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const s = asStaff(p);
    const b = parse(permissionRequestSchema, body);
    const userId = b.userId ?? s.userId;
    if (userId !== s.userId && !can(s, 'hr:create')) throw forbidden();
    return this.tenancy.system(s.orgId, async (tx) => {
      if (userId !== s.userId) await this.assertTeamMember(tx, s, userId);
      const c = await this.hr.requireContract(tx, userId);
      const settings = await this.hr.settings(tx);
      const minutes = minutesOf(b.endTime) - minutesOf(b.startTime);
      const month = b.workDate.slice(0, 7) + '-01';
      const used = await tx.one<{ n: number; minutes: number }>(
        `select count(*)::int as n, coalesce(sum(minutes), 0)::int as minutes from permission_requests
         where user_id = $1 and status in ('pending','approved') and work_date >= $2::date and work_date < ($2::date + interval '1 month')`,
        [userId, month],
      );
      if (used.n + 1 > settings.permissionsPerMonth || used.minutes + minutes > settings.permissionMinutesPerMonth)
        throw new DomainError('permission_allowance_exceeded', HttpStatus.UNPROCESSABLE_ENTITY, {
          perMonth: settings.permissionsPerMonth, minutesPerMonth: settings.permissionMinutesPerMonth, used: used.n, usedMinutes: used.minutes,
        });
      const r = await tx.one<{ id: string }>(
        `insert into permission_requests (organisation_id, user_id, clinic_id, work_date, kind, start_time, end_time, minutes, reason, requested_by)
         values (app_org(), $1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
        [userId, c.clinic_id, b.workDate, b.kind, b.startTime, b.endTime, minutes, b.reason ?? null, s.userId],
      );
      await this.audit.record(tx, s, meta, { action: 'hr.permission_request', entity: 'permission_request', entityId: r.id, clinicId: c.clinic_id, details: { userId, minutes } });
      return r;
    });
  }

  @Post('leave-requests/:id/cancel')
  @Staff()
  @HttpCode(200)
  cancelLeave(@Auth() p: Principal, @Param('id') id: string, @Meta() meta: RequestMeta) {
    return this.cancel(p, 'leave-requests', id, meta);
  }

  @Post('permission-requests/:id/cancel')
  @Staff()
  @HttpCode(200)
  cancelPermission(@Auth() p: Principal, @Param('id') id: string, @Meta() meta: RequestMeta) {
    return this.cancel(p, 'permission-requests', id, meta);
  }

  /** Cancel your own pending request, or an approved one that has not started yet. */
  private cancel(p: Principal, kind: string, id: string, meta: RequestMeta) {
    const s = asStaff(p);
    const table = kind === 'leave-requests' ? 'leave_requests' : 'permission_requests';
    const startCol = kind === 'leave-requests' ? 'start_date' : 'work_date';
    return this.tenancy.system(s.orgId, async (tx) => {
      const r = await tx.maybeOne<{ id: string }>(
        `update ${table} set status = 'cancelled' where id = $1 and user_id = $2 and (status = 'pending' or (status = 'approved' and ${startCol} > $3::date)) returning id`,
        [uuid(id), s.userId, today()],
      );
      if (!r) throw notFound('request');
      await this.audit.record(tx, s, meta, { action: `hr.${table}_cancel`, entity: table.slice(0, -1), entityId: id });
      return { ok: true };
    });
  }

  // ---- Team (managers) ----------------------------------------------------------------------------------------

  /** Daily board: everyone with an active contract in the visible clinics and their status for the day. */
  @Get('attendance')
  @Staff('hr:view')
  board(@Auth() p: Principal, @Query('date') date?: string, @Query('clinicId') clinicId?: string) {
    const day = parse(zDay, date ?? today());
    return this.tenancy.run(p, async (tx) => {
      const holidays = await this.hr.holidays(tx, day, day);
      const rows = await tx.query<ContractRow & { name_ar: string; name_en: string; rec: Record<string, unknown> | null; leave: string | null }>(
        `select c.*, u.name_ar, u.name_en,
                (select to_jsonb(a) from attendance_records a where a.user_id = c.user_id and a.work_date = $1) as rec,
                (select t.code from leave_requests r join leave_types t on t.id = r.leave_type_id where r.user_id = c.user_id and r.status = 'approved' and r.start_date <= $1 and r.end_date >= $1 limit 1) as leave
         from employment_contracts c join users u on u.id = c.user_id
         where c.status = 'active' and c.start_date <= $1 and (c.end_date is null or c.end_date >= $1)
           and ($2::uuid is null or c.clinic_id = $2) and c.clinic_id = any($3::uuid[])
         order by u.name_ar`,
        [day, clinicId ? uuid(clinicId) : null, await this.visibleClinics(tx, p)],
      );
      return rows.map((r) => {
        const pattern = workPatternSchema.parse(r.work_pattern);
        const scheduled = !holidays.has(day) && pattern.days.includes(new Date(`${day}T00:00:00Z`).getUTCDay());
        const rec = r.rec as { clock_in?: string | null; status?: string } | null;
        const expected = holidays.has(day) ? 'holiday' : r.leave ? 'on_leave' : !scheduled ? 'rest_day' : rec?.clock_in ? 'present' : day < today() ? 'absent' : 'not_in_yet';
        return { userId: r.user_id, nameAr: r.name_ar, nameEn: r.name_en, clinicId: r.clinic_id, jobTitleAr: r.job_title_ar, jobTitleEn: r.job_title_en, shift: scheduled ? { start: pattern.start, end: pattern.end, breakStart: pattern.breakStart ?? null, breakEnd: pattern.breakEnd ?? null } : null, leave: r.leave, state: expected, record: r.rec };
      });
    });
  }

  /** Month sheet for one person (self, or a team member with hr:view). */
  @Get('attendance/month')
  @Staff()
  month(@Auth() p: Principal, @Query('month') month: string, @Query('userId') userId?: string) {
    const s = asStaff(p);
    const m = parse(zMonth, month);
    const target = userId ? uuid(userId) : s.userId;
    if (target !== s.userId && !can(s, 'hr:view')) throw forbidden();
    return this.tenancy.system(s.orgId, async (tx) => {
      if (target !== s.userId) await this.assertTeamMember(tx, s, target);
      return this.monthView(tx, target, m);
    });
  }

  /** Create or correct a day's attendance with a reason (times are Cairo local; a clock-out before the clock-in is next day). */
  @Put('attendance')
  @Staff('hr:edit')
  correct(@Auth() p: Principal, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const s = asStaff(p);
    const b = parse(
      z.object({
        userId: z.guid(), workDate: zDay,
        clockIn: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(), clockOut: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
        // Several pairs for a split shift or stepping out, in order; a later time earlier than the previous one is the next day.
        punches: z.array(z.object({ in: z.string().regex(/^\d{2}:\d{2}$/), out: z.string().regex(/^\d{2}:\d{2}$/).nullable() })).min(1).max(6).optional(),
        status: z.enum(['absent', 'on_leave', 'holiday', 'rest_day']).optional(), reason: z.string().trim().min(3).max(500),
      }),
      body,
    );
    if (b.clockOut && !b.clockIn) throw badRequest('clock_out_without_clock_in');
    if (b.punches && (b.clockIn || b.clockOut)) throw badRequest('use_punches_or_clock_times');
    if (b.punches?.slice(0, -1).some((x) => x.out === null)) throw badRequest('only_last_pair_may_be_open');
    if (b.workDate > today()) throw badRequest('future_date');
    return this.tenancy.system(s.orgId, async (tx) => {
      await this.assertTeamMember(tx, s, b.userId);
      const c = await this.hr.requireContract(tx, b.userId);
      // Times in order on the work date, rolling into the next day when a time is earlier than the one before.
      const pairs = b.punches ?? (b.clockIn ? [{ in: b.clockIn, out: b.clockOut ?? null }] : []);
      let dayOffset = 0;
      let prev = -1;
      const at = (t: string) => {
        const m = minutesOf(t);
        if (m < prev) dayOffset++;
        prev = m;
        return zonedToUtc(addDays(b.workDate, dayOffset), t);
      };
      const punches = pairs.map((x) => ({ in: at(x.in).toISOString(), out: x.out ? at(x.out).toISOString() : null }));
      const inAt = punches[0]?.in ?? null;
      const lastOut = punches.length ? punches[punches.length - 1]!.out : null;
      const status = inAt ? (lastOut ? 'complete' : 'open') : (b.status ?? 'absent');
      const r = await tx.one<{ id: string }>(
        `insert into attendance_records (organisation_id, user_id, clinic_id, work_date, clock_in, clock_out, punches, source, status, adjusted_by, adjusted_reason)
         values (app_org(), $1,$2,$3,$4,$5,$9,'manual',$6,$7,$8)
         on conflict (user_id, work_date) do update set clock_in = excluded.clock_in, clock_out = excluded.clock_out, punches = excluded.punches, source = 'manual', status = excluded.status,
           adjusted_by = excluded.adjusted_by, adjusted_reason = excluded.adjusted_reason, overtime_approved = false, overtime_status = 'pending',
           overtime_decided_by = null, overtime_decided_at = null, updated_at = now()
         returning id`,
        [b.userId, c.clinic_id, b.workDate, inAt, lastOut, status, s.userId, b.reason, JSON.stringify(punches)],
      );
      const out = await this.hr.recompute(tx, r.id);
      await this.audit.record(tx, s, meta, { action: 'hr.attendance_correct', entity: 'attendance_record', entityId: r.id, clinicId: c.clinic_id, reason: b.reason, details: { userId: b.userId, workDate: b.workDate } });
      return out;
    });
  }

  @Post('attendance/:id/overtime')
  @Staff('hr:approve')
  @HttpCode(200)
  approveOvertime(@Auth() p: Principal, @Param('id') id: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const s = asStaff(p);
    // approved: true approves, false rejects, null returns the overtime to "awaiting a decision".
    const b = parse(z.object({ approved: z.boolean().nullable() }), body);
    return this.tenancy.run(s, async (tx) => {
      const cur = await tx.maybeOne<{ user_id: string }>('select user_id from attendance_records where id = $1 and overtime_minutes > 0 for update', [uuid(id)]);
      if (!cur) throw notFound('attendance_record');
      if (cur.user_id === s.userId) throw forbidden('cannot_approve_own_request');
      // Approve or reject; a rejected decision is explicit so payroll no longer reports it as waiting.
      const r = await tx.one<{ user_id: string; clinic_id: string }>(
        `update attendance_records set overtime_approved = $2, overtime_status = $3, overtime_decided_by = $4,
           overtime_decided_at = case when $4::uuid is null then null else now() end, updated_at = now() where id = $1 returning user_id, clinic_id`,
        [id, b.approved === true, b.approved === null ? 'pending' : b.approved ? 'approved' : 'rejected', b.approved === null ? null : s.userId],
      );
      await this.audit.record(tx, s, meta, { action: 'hr.overtime_decide', entity: 'attendance_record', entityId: id, clinicId: r.clinic_id, details: b });
      return { ok: true };
    });
  }

  @Get('leave-requests')
  @Staff('hr:view')
  leaveRequests(@Auth() p: Principal, @Query('status') status = 'pending') {
    return this.tenancy.run(p, (tx) =>
      tx.query(
        `select r.*, t.code, t.name_ar as type_name_ar, t.name_en as type_name_en, u.name_ar, u.name_en from leave_requests r join leave_types t on t.id = r.leave_type_id join users u on u.id = r.user_id
         where r.status = $1 order by r.start_date limit 200`,
        [parse(z.enum(['pending', 'approved', 'rejected', 'cancelled']), status)],
      ),
    );
  }

  @Get('permission-requests')
  @Staff('hr:view')
  permissionRequests(@Auth() p: Principal, @Query('status') status = 'pending') {
    return this.tenancy.run(p, (tx) =>
      tx.query(
        `select r.*, u.name_ar, u.name_en from permission_requests r join users u on u.id = r.user_id where r.status = $1 order by r.work_date limit 200`,
        [parse(z.enum(['pending', 'approved', 'rejected', 'cancelled']), status)],
      ),
    );
  }

  @Post('leave-requests/:id/decide')
  @Staff('hr:approve')
  @HttpCode(200)
  decideLeave(@Auth() p: Principal, @Param('id') id: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    return this.decide(p, 'leave-requests', id, body, meta);
  }

  @Post('permission-requests/:id/decide')
  @Staff('hr:approve')
  @HttpCode(200)
  decidePermission(@Auth() p: Principal, @Param('id') id: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    return this.decide(p, 'permission-requests', id, body, meta);
  }

  private decide(p: Principal, kind: string, id: string, body: unknown, meta: RequestMeta) {
    const s = asStaff(p);
    const b = parse(z.object({ approve: z.boolean(), note: z.string().max(500).optional() }), body);
    const table = kind === 'leave-requests' ? 'leave_requests' : 'permission_requests';
    return this.tenancy.run(s, async (tx) => {
      const cur = await tx.maybeOne<{ user_id: string; clinic_id: string; status: string; work_date?: string }>(
        `select user_id, clinic_id, status${table === 'permission_requests' ? ", to_char(work_date, 'YYYY-MM-DD') as work_date" : ''} from ${table} where id = $1 for update`,
        [uuid(id)],
      );
      if (!cur) throw notFound('request');
      if (cur.status !== 'pending') throw conflict('request_not_pending');
      if (cur.user_id === s.userId) throw forbidden('cannot_approve_own_request');
      await tx.query(`update ${table} set status = $2, decided_by = $3, decided_at = now(), decision_note = $4 where id = $1`, [id, b.approve ? 'approved' : 'rejected', s.userId, b.note ?? null]);
      // An approved permission changes that day's lateness.
      if (table === 'permission_requests' && cur.work_date) {
        const rec = await tx.maybeOne<{ id: string }>('select id from attendance_records where user_id = $1 and work_date = $2', [cur.user_id, cur.work_date]);
        if (rec) await this.hr.recompute(tx, rec.id);
      }
      await this.audit.record(tx, s, meta, { action: `hr.${table}_${b.approve ? 'approve' : 'reject'}`, entity: table.slice(0, -1), entityId: id, clinicId: cur.clinic_id });
      return { ok: true };
    });
  }

  @Get('balances')
  @Staff('hr:view')
  teamBalances(@Auth() p: Principal, @Query('userId') userId: string, @Query('year') year?: string) {
    const s = asStaff(p);
    const target = uuid(userId);
    return this.tenancy.system(s.orgId, async (tx) => {
      await this.assertTeamMember(tx, s, target);
      return this.balances(tx, target, Number(year) || Number(today().slice(0, 4)));
    });
  }

  @Patch('balances')
  @Staff('hr:edit')
  adjustBalance(@Auth() p: Principal, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const s = asStaff(p);
    const b = parse(z.object({ userId: z.guid(), year: z.number().int().min(2000).max(2100), carried: z.number().min(0).max(90).optional(), adjusted: z.number().min(-90).max(90).optional(), note: z.string().trim().min(3).max(300) }), body);
    return this.tenancy.system(s.orgId, async (tx) => {
      await this.assertTeamMember(tx, s, b.userId);
      await this.hr.annualBalance(tx, b.userId, b.year);
      await tx.query(
        'update leave_balances set carried = coalesce($3, carried), adjusted = coalesce($4, adjusted), adjusted_note = $5 where user_id = $1 and year = $2',
        [b.userId, b.year, b.carried ?? null, b.adjusted ?? null, b.note],
      );
      await this.audit.record(tx, s, meta, { action: 'hr.balance_adjust', entity: 'leave_balance', details: b });
      return this.hr.annualBalance(tx, b.userId, b.year);
    });
  }

  // ---- Holidays and leave types -------------------------------------------------------------------------------

  @Get('holidays')
  @Staff()
  holidaysList(@Auth() p: Principal, @Query('year') year?: string) {
    const y = Number(year) || Number(today().slice(0, 4));
    return this.tenancy.system(p.orgId, (tx) => tx.query(`select * from public_holidays where extract(year from holiday_date) = $1 order by holiday_date`, [y]));
  }

  @Post('holidays')
  @Staff('hr:edit')
  addHoliday(@Auth() p: Principal, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const b = parse(z.object({ date: zDay, nameAr: z.string().min(2), nameEn: z.string().default('') }), body);
    return this.tenancy.run(p, async (tx) => {
      const r = await tx.one<{ id: string }>(
        `insert into public_holidays (organisation_id, holiday_date, name_ar, name_en) values (app_org(), $1,$2,$3)
         on conflict (organisation_id, holiday_date) do update set name_ar = excluded.name_ar, name_en = excluded.name_en returning *`,
        [b.date, b.nameAr, b.nameEn],
      );
      await this.audit.record(tx, p, meta, { action: 'hr.holiday_set', entity: 'public_holiday', entityId: r.id, details: b });
      return r;
    });
  }

  @Delete('holidays/:id')
  @Staff('hr:edit')
  deleteHoliday(@Auth() p: Principal, @Param('id') id: string, @Meta() meta: RequestMeta) {
    return this.tenancy.run(p, async (tx) => {
      const r = await tx.maybeOne('delete from public_holidays where id = $1 returning id', [uuid(id)]);
      if (!r) throw notFound('holiday');
      await this.audit.record(tx, p, meta, { action: 'hr.holiday_delete', entity: 'public_holiday', entityId: id });
      return { deleted: true };
    });
  }

  @Patch('leave-types/:id')
  @Staff('hr:edit')
  updateLeaveType(@Auth() p: Principal, @Param('id') id: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const b = parse(z.object({ nameAr: z.string().min(2).optional(), nameEn: z.string().optional(), paid: z.boolean().optional(), annualQuota: z.number().min(0).max(365).nullable().optional(), maxConsecutiveDays: z.number().min(0.5).max(365).nullable().optional(), isActive: z.boolean().optional() }), body);
    return this.tenancy.run(p, async (tx) => {
      const r = await tx.maybeOne(
        `update leave_types set name_ar = coalesce($2, name_ar), name_en = coalesce($3, name_en), paid = coalesce($4, paid),
           annual_quota = case when $5::boolean then $6::numeric else annual_quota end, max_consecutive_days = case when $7::boolean then $8::numeric else max_consecutive_days end,
           is_active = coalesce($9, is_active) where id = $1 returning *`,
        [uuid(id), b.nameAr ?? null, b.nameEn ?? null, b.paid ?? null, b.annualQuota !== undefined, b.annualQuota ?? null, b.maxConsecutiveDays !== undefined, b.maxConsecutiveDays ?? null, b.isActive ?? null],
      );
      if (!r) throw notFound('leave_type');
      await this.audit.record(tx, p, meta, { action: 'hr.leave_type_update', entity: 'leave_type', entityId: id, details: b });
      return r;
    });
  }

  // ---- Contracts and settings ---------------------------------------------------------------------------------

  /** Staff list with contract summaries (salary fields only with payroll:view). */
  @Get('staff')
  @Staff('hr:view')
  staff(@Auth() p: Principal) {
    const s = asStaff(p);
    return this.tenancy.run(s, async (tx) => {
      const clinics = await this.visibleClinics(tx, s);
      const rows = await tx.query<{ id: string; name_ar: string; name_en: string; email: string | null; status: string; roles: string[]; contract: ContractRow | null }>(
        `select u.id, u.name_ar, u.name_en, u.email, u.status,
                array(select distinct m.role from staff_memberships m where m.user_id = u.id) as roles,
                (select to_jsonb(c) from employment_contracts c where c.user_id = u.id and c.status = 'active') as contract
         from users u where u.status <> 'deactivated'
           and exists (select 1 from staff_memberships m where m.user_id = u.id and (m.clinic_id is null or m.clinic_id = any($1::uuid[])))
         order by u.name_ar`,
        [clinics],
      );
      return rows.map((r) => ({ ...r, contract: contractView(r.contract, can(s, 'payroll:view')) }));
    });
  }

  @Get('staff/:userId/contract')
  @Staff('hr:view')
  contract(@Auth() p: Principal, @Param('userId') userId: string, @Meta() meta: RequestMeta) {
    const s = asStaff(p);
    return this.tenancy.system(s.orgId, async (tx) => {
      await this.assertTeamMember(tx, s, uuid(userId));
      const withPay = can(s, 'payroll:view');
      const active = await this.hr.activeContract(tx, userId);
      const history = await tx.query<ContractRow>(`select * from employment_contracts where user_id = $1 and status = 'ended' order by start_date desc`, [userId]);
      if (withPay) await this.audit.record(tx, s, meta, { action: 'payroll.contract_read', entity: 'user', entityId: userId });
      return { active: contractView(active, withPay), history: history.map((c) => contractView(c, withPay)) };
    });
  }

  /** Create or update a person's active contract (payroll:edit). */
  @Put('staff/:userId/contract')
  @Staff('payroll:edit')
  saveContract(@Auth() p: Principal, @Param('userId') userId: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const s = asStaff(p);
    const b = parse(contractSchema, body);
    return this.tenancy.system(s.orgId, async (tx) => {
      const user = await tx.maybeOne(`select 1 from users where id = $1 and status <> 'deactivated'`, [uuid(userId)]);
      if (!user) throw notFound('user');
      if (!(await tx.maybeOne('select 1 from clinics where id = $1', [b.clinicId]))) throw notFound('clinic');
      if (b.payBasis !== 'commission_only' && b.baseSalary <= 0) throw badRequest('base_salary_required');
      const iban = b.iban === undefined ? undefined : b.iban === null ? null : this.hr.sealIban(b.iban);
      const existing = await this.hr.activeContract(tx, userId);
      const vals = [
        b.clinicId, b.jobTitleAr, b.jobTitleEn, b.employmentType, b.payBasis, b.startDate, b.endDate ?? null, b.baseSalary, JSON.stringify(b.allowances),
        b.insurableWage ?? null, b.socialInsuranceNumber ?? null, b.bankName ?? null, JSON.stringify(b.workPattern), b.dateOfBirth ?? null,
      ];
      let id: string;
      if (existing) {
        id = existing.id;
        await tx.query(
          `update employment_contracts set clinic_id = $2, job_title_ar = $3, job_title_en = $4, employment_type = $5, pay_basis = $6, start_date = $7, end_date = $8,
             base_salary = $9, allowances = $10, insurable_wage = $11, social_insurance_number = $12, bank_name = $13, work_pattern = $14, date_of_birth = $15, updated_at = now()
           where id = $1`,
          [id, ...vals],
        );
      } else {
        id = (await tx.one<{ id: string }>(
          `insert into employment_contracts (organisation_id, user_id, clinic_id, job_title_ar, job_title_en, employment_type, pay_basis, start_date, end_date, base_salary,
             allowances, insurable_wage, social_insurance_number, bank_name, work_pattern, date_of_birth, created_by)
           values (app_org(), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) returning id`,
          [userId, ...vals, s.userId],
        )).id;
      }
      if (iban !== undefined) await tx.query('update employment_contracts set iban_enc = $2, iban_last4 = $3 where id = $1', [id, iban?.enc ?? null, iban?.last4 ?? null]);
      await this.audit.record(tx, s, meta, { action: existing ? 'payroll.contract_update' : 'payroll.contract_create', entity: 'employment_contract', entityId: id, details: { userId, keys: Object.keys(b).filter((k) => k !== 'iban') } });
      return contractView(await this.hr.activeContract(tx, userId), true);
    });
  }

  /** End employment: the contract stays for history and payroll stops after the end date. */
  @Post('staff/:userId/contract/end')
  @Staff('payroll:edit')
  @HttpCode(200)
  endContract(@Auth() p: Principal, @Param('userId') userId: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const s = asStaff(p);
    const b = parse(z.object({ endDate: zDay, reason: z.string().trim().min(3).max(300), payUnusedLeave: z.boolean().default(true) }), body);
    return this.tenancy.system(s.orgId, async (tx) => {
      const c = await this.hr.activeContract(tx, uuid(userId));
      if (!c) throw notFound('contract');
      if (b.endDate < c.start_date) throw badRequest('end_before_start');
      // Pending future requests are cancelled; unused annual leave is paid with the final month.
      await tx.query(`update leave_requests set status = 'cancelled', decision_note = 'Employment ended' where user_id = $1 and status in ('pending','approved') and start_date > $2`, [c.user_id, b.endDate]);
      const { unused, payout: due, period } = await this.leavePayout(tx, c, b.endDate);
      const payout = b.payUnusedLeave ? due : 0;
      if (payout > 0) {
        if (await tx.maybeOne(`select 1 from payroll_runs where period = $1 and status in ('approved','paid')`, [period])) throw conflict('payroll_period_closed');
        await tx.query(
          `insert into payroll_adjustments (organisation_id, user_id, period, kind, amount, taxable, note, created_by) values (app_org(), $1, $2, 'leave_encashment', $3, true, $4, $5)`,
          [c.user_id, period, payout, `${unused} d`, s.userId],
        );
      }
      await tx.query(`update employment_contracts set end_date = $2, status = 'ended', updated_at = now() where id = $1`, [c.id, b.endDate]);
      await this.audit.record(tx, s, meta, { action: 'payroll.contract_end', entity: 'employment_contract', entityId: c.id, reason: b.reason, details: { endDate: b.endDate, unusedLeaveDays: unused, payout } });
      // A negative balance (more leave taken than earned) is reported, not deducted automatically.
      return { ok: true, unusedLeaveDays: unused, leavePayout: payout, payoutMonth: period.slice(0, 7) };
    });
  }

  /** What ending employment on a date would pay for unused leave, before confirming. */
  @Get('staff/:userId/contract/end-preview')
  @Staff('payroll:edit')
  endPreview(@Auth() p: Principal, @Param('userId') userId: string, @Query('endDate') endDate: string) {
    const s = asStaff(p);
    const d = parse(zDay, endDate);
    return this.tenancy.system(s.orgId, async (tx) => {
      const c = await this.hr.activeContract(tx, uuid(userId));
      if (!c) throw notFound('contract');
      if (d < c.start_date) throw badRequest('end_before_start');
      const r = await this.leavePayout(tx, c, d);
      const closed = !!(await tx.maybeOne(`select 1 from payroll_runs where period = $1 and status in ('approved','paid')`, [r.period]));
      return { unusedLeaveDays: r.unused, leavePayout: r.payout, payoutMonth: r.period.slice(0, 7), payrollMonthClosed: closed && r.payout > 0 };
    });
  }

  /**
   * Unused annual leave at an end date: this year's entitlement prorated to the end date, plus carry-over and
   * adjustments, less leave taken (and pending requests up to that date). Paid at the daily rate for monthly pay only.
   */
  private async leavePayout(tx: Tx, c: ContractRow, endDate: string) {
    const year = Number(endDate.slice(0, 4));
    const bal = await this.hr.annualBalance(tx, c.user_id, year);
    const future = await tx.one<{ days: string }>(
      `select coalesce(sum(r.days), 0) as days from leave_requests r join leave_types t on t.id = r.leave_type_id
       where r.user_id = $1 and t.uses_annual_balance and r.status in ('pending','approved') and r.start_date > $2 and extract(year from r.start_date) = $3`,
      [c.user_id, endDate, year],
    );
    // Requests after the end date will be cancelled, so they do not reduce the payout.
    const taken = bal.used + bal.pending - Number(future.days);
    const earned = leaverEntitlement(bal.entitled, c.start_date, endDate, year);
    const unused = Math.round((earned + bal.carried + bal.adjusted - taken) * 2) / 2;
    const settings = await this.hr.settings(tx);
    const daily = c.pay_basis === 'monthly' ? c.base_salary / settings.daysPerMonth : 0;
    return { unused, payout: unused > 0 && daily > 0 ? Math.round(unused * daily) : 0, period: `${endDate.slice(0, 7)}-01` };
  }

  @Get('settings')
  @Staff('hr:view')
  getSettings(@Auth() p: Principal) {
    return this.tenancy.run(p, (tx) => this.hr.settings(tx));
  }

  @Patch('settings')
  @Staff('settings:edit')
  saveSettings(@Auth() p: Principal, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const b = parse(hrSettingsSchema.partial(), body);
    return this.tenancy.run(p, async (tx) => {
      const cur = await tx.one<{ settings: Record<string, unknown> }>('select settings from organisations where id = app_org() for update');
      const effective = hrSettingsSchema.parse(hrSettings({ ...(cur.settings.hr as object | undefined), ...b }));
      if (effective.socialInsurance.maxWage < effective.socialInsurance.minWage) throw badRequest('insurable_wage_limits_invalid');
      if (effective.nightStart === effective.nightEnd) throw badRequest('night_window_invalid');
      // Store only what differs from the defaults, so later corrections to the defaults still reach this organisation.
      await tx.query(`update organisations set settings = jsonb_set(settings, '{hr}', $1::jsonb) where id = app_org()`, [JSON.stringify(hrOverrides(effective))]);
      await this.audit.record(tx, p, meta, { action: 'hr.settings_update', entity: 'organisation', details: { keys: Object.keys(b) } });
      return this.hr.settings(tx);
    });
  }

  /** Return to the built-in defaults (drops every organisation override). */
  @Delete('settings')
  @Staff('settings:edit')
  resetSettings(@Auth() p: Principal, @Meta() meta: RequestMeta) {
    return this.tenancy.run(p, async (tx) => {
      await tx.query(`update organisations set settings = settings - 'hr' where id = app_org()`);
      await this.audit.record(tx, p, meta, { action: 'hr.settings_reset', entity: 'organisation' });
      return this.hr.settings(tx);
    });
  }

  /** Days a leave range would use and what would remain, before submitting. */
  @Get('leave-preview')
  @Staff()
  leavePreview(@Auth() p: Principal, @Query() q: Record<string, string>) {
    const s = asStaff(p);
    const b = parse(z.object({ leaveTypeId: z.guid(), startDate: zDay, endDate: zDay, userId: z.guid().optional() }), q);
    if (b.endDate < b.startDate) throw badRequest('end_before_start');
    const userId = b.userId ?? s.userId;
    if (userId !== s.userId && !can(s, 'hr:view')) throw forbidden();
    return this.tenancy.system(s.orgId, async (tx) => {
      if (userId !== s.userId) await this.assertTeamMember(tx, s, userId);
      const c = await this.hr.requireContract(tx, userId);
      const type = await tx.maybeOne<{ id: string; code: string; uses_annual_balance: boolean; annual_quota: number | null; max_consecutive_days: number | null }>('select * from leave_types where id = $1 and is_active', [b.leaveTypeId]);
      if (!type) throw notFound('leave_type');
      const days = await this.hr.leaveDays(tx, workPatternSchema.parse(c.work_pattern), type.code, b.startDate, b.endDate);
      const year = Number(b.startDate.slice(0, 4));
      const balance = type.uses_annual_balance ? await this.hr.annualBalance(tx, userId, year) : null;
      const quotaUsed = type.annual_quota !== null ? await this.hr.typeUsage(tx, userId, type.id, year) : null;
      return {
        days,
        available: balance?.available ?? null,
        remainingAfter: balance ? balance.available - days : null,
        quota: type.annual_quota !== null ? Number(type.annual_quota) : null,
        quotaRemainingAfter: quotaUsed !== null ? Number(type.annual_quota) - quotaUsed - days : null,
        maxConsecutiveDays: type.max_consecutive_days !== null ? Number(type.max_consecutive_days) : null,
      };
    });
  }

  /** Clock-in location rules for a clinic (stored in the clinic's settings). */
  @Get('clinics/:clinicId/attendance-rules')
  @Staff('hr:view')
  getRules(@Auth() p: Principal, @Param('clinicId') clinicId: string) {
    this.assertClinic(asStaff(p), uuid(clinicId));
    return this.tenancy.run(p, async (tx) => {
      const c = await tx.maybeOne<{ settings: { attendance?: unknown }; lat: number | null; lng: number | null }>('select settings, lat, lng from clinics where id = $1', [uuid(clinicId)]);
      if (!c) throw notFound('clinic');
      return { ...DEFAULT_ATTENDANCE_RULES, ...(c.settings.attendance as object | undefined), clinicHasLocation: c.lat !== null && c.lng !== null };
    });
  }

  @Put('clinics/:clinicId/attendance-rules')
  @Staff('hr:edit')
  saveRules(@Auth() p: Principal, @Param('clinicId') clinicId: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    this.assertClinic(asStaff(p), uuid(clinicId));
    const b = parse(attendanceRulesSchema, body);
    for (const n of b.allowedNetworks) {
      const [addr, bits] = n.split('/');
      const v = isIP(addr ?? '');
      if (!v || Number(bits) > (v === 4 ? 32 : 128)) throw badRequest('invalid_network', { network: n });
    }
    return this.tenancy.run(p, async (tx) => {
      const c = await tx.maybeOne<{ lat: number | null }>('select lat from clinics where id = $1 for update', [uuid(clinicId)]);
      if (!c) throw notFound('clinic');
      if (b.geofenceMeters !== null && c.lat === null) throw badRequest('clinic_location_missing');
      if (b.mode !== 'off' && !b.allowedNetworks.length && b.geofenceMeters === null) throw badRequest('no_location_rule');
      await tx.query(`update clinics set settings = jsonb_set(coalesce(settings, '{}'), '{attendance}', $2::jsonb) where id = $1`, [clinicId, JSON.stringify(b)]);
      await this.audit.record(tx, p, meta, { action: 'hr.attendance_rules_update', entity: 'clinic', entityId: clinicId, clinicId, details: { mode: b.mode, networks: b.allowedNetworks.length, geofence: b.geofenceMeters } });
      return b;
    });
  }

  /** The address the API sees for this request, so a manager at the clinic can add "this connection" to the rules. */
  @Get('my-network')
  @Staff('hr:edit')
  myNetwork(@Meta() meta: RequestMeta) {
    const ip = meta.ip?.replace(/^::ffff:/, '') ?? null;
    const v = ip ? isIP(ip) : 0;
    return { ip, suggestedRange: ip && v ? `${ip}/${v === 4 ? 32 : 128}` : null };
  }

  /**
   * What the person's clinic checks at clocking, so the app asks for the phone's position only when a radius rule
   * uses it. Never exposes the clinic's networks or coordinates.
   */
  private async clockCheckInfo(tx: Tx, clinicId: string) {
    const c = await tx.one<{ settings: { attendance?: unknown }; lat: number | null }>('select settings, lat from clinics where id = $1', [clinicId]);
    const rules = attendanceRulesSchema.safeParse(c.settings.attendance ?? DEFAULT_ATTENDANCE_RULES);
    const r = rules.success ? rules.data : DEFAULT_ATTENDANCE_RULES;
    return { mode: r.mode, usesPosition: r.mode !== 'off' && r.geofenceMeters !== null && c.lat !== null, usesNetwork: r.mode !== 'off' && r.allowedNetworks.length > 0 };
  }

  /** Clinic-scoped staff may only manage clinics they belong to; network roles manage all. */
  private assertClinic(s: StaffPrincipal, clinicId: string) {
    if (!s.network && !s.clinicIds.includes(clinicId)) throw notFound('clinic');
  }

  /**
   * Proof of presence for clocking: the request comes from a listed clinic network, or the device position is inside
   * the clinic geofence. Only the verdict and method (and distance) are kept, never the IP address or coordinates.
   */
  private async locationCheck(tx: Tx, clinicId: string, ip: string | null, position?: { lat: number; lng: number; accuracy: number }) {
    const c = await tx.one<{ settings: { attendance?: unknown }; lat: number | null; lng: number | null }>('select settings, lat, lng from clinics where id = $1', [clinicId]);
    const rules = attendanceRulesSchema.safeParse(c.settings.attendance ?? DEFAULT_ATTENDANCE_RULES);
    const r = rules.success ? rules.data : DEFAULT_ATTENDANCE_RULES;
    if (r.mode === 'off') return { mode: r.mode, verdict: 'ok' as const, detail: {} };
    const addr = ip?.replace(/^::ffff:/, '') ?? '';
    if (addr && r.allowedNetworks.length) {
      const list = new BlockList();
      for (const n of r.allowedNetworks) {
        const [a, bits] = n.split('/');
        const fam = isIP(a ?? '');
        if (fam) list.addSubnet(a!, Number(bits), fam === 4 ? 'ipv4' : 'ipv6');
      }
      const fam = isIP(addr);
      if (fam && list.check(addr, fam === 4 ? 'ipv4' : 'ipv6')) return { mode: r.mode, verdict: 'ok' as const, detail: { method: 'network' } };
    }
    if (position && r.geofenceMeters !== null && c.lat !== null && c.lng !== null) {
      const g = insideGeofence({ lat: c.lat, lng: c.lng }, position, r.geofenceMeters);
      return { mode: r.mode, verdict: g.inside ? ('ok' as const) : ('outside' as const), detail: { method: 'gps', distance: g.distance, accuracy: Math.round(position.accuracy) } };
    }
    return { mode: r.mode, verdict: 'unverified' as const, detail: { method: position ? 'gps_unavailable' : 'none' } };
  }

  // ---- Helpers -------------------------------------------------------------------------------------------------

  private async visibleClinics(tx: Tx, p: Principal): Promise<string[]> {
    return (await tx.query<{ id: string }>('select id from clinics')).map((r) => r.id).filter((id) => {
      const s = asStaff(p);
      return s.network || s.clinicIds.includes(id);
    });
  }

  /** A manager may act on people whose active contract (or membership) is in a clinic they manage. */
  private async assertTeamMember(tx: Tx, s: StaffPrincipal, userId: string) {
    if (userId === s.userId) return;
    // Network-wide roles reach everyone in the organisation, but the person must belong to it.
    if (s.network) {
      if (!(await tx.maybeOne('select 1 from users where id = $1 and organisation_id = app_org()', [userId]))) throw notFound('user');
      return;
    }
    const r = await tx.maybeOne(
      `select 1 from users u where u.id = $1 and (
         exists (select 1 from employment_contracts c where c.user_id = u.id and c.status = 'active' and c.clinic_id = any($2::uuid[]))
         or exists (select 1 from staff_memberships m where m.user_id = u.id and m.clinic_id = any($2::uuid[])))`,
      [userId, s.clinicIds],
    );
    if (!r) throw notFound('user');
  }

  private async monthView(tx: Tx, userId: string, month: string) {
    const period = `${month}-01`;
    const c = await this.hr.activeContract(tx, userId);
    const days = await tx.query(
      `select a.*, to_char(a.work_date, 'YYYY-MM-DD') as day, du.name_ar as overtime_decided_by_name_ar, du.name_en as overtime_decided_by_name_en
       from attendance_records a left join users du on du.id = a.overtime_decided_by where a.user_id = $1 and a.work_date >= $2::date and a.work_date < ($2::date + interval '1 month') order by a.work_date`,
      [userId, period],
    );
    const leave = await tx.query(
      `select r.id, to_char(r.start_date, 'YYYY-MM-DD') as start_date, to_char(r.end_date, 'YYYY-MM-DD') as end_date, r.days, r.status, t.code, t.name_ar, t.name_en
       from leave_requests r join leave_types t on t.id = r.leave_type_id
       where r.user_id = $1 and r.status in ('pending','approved') and r.start_date < ($2::date + interval '1 month') and r.end_date >= $2::date order by r.start_date`,
      [userId, period],
    );
    const permissions = await tx.query(
      `select *, to_char(work_date, 'YYYY-MM-DD') as day, to_char(start_time, 'HH24:MI') as start, to_char(end_time, 'HH24:MI') as "end" from permission_requests
       where user_id = $1 and status in ('pending','approved') and work_date >= $2::date and work_date < ($2::date + interval '1 month') order by work_date`,
      [userId, period],
    );
    const holidays = await tx.query(`select to_char(holiday_date, 'YYYY-MM-DD') as day, name_ar, name_en from public_holidays where holiday_date >= $1::date and holiday_date < ($1::date + interval '1 month')`, [period]);
    return { month, contract: contractView(c, false), summary: c ? await this.hr.monthSummary(tx, c, period, today()) : null, days, leave, permissions, holidays };
  }

  private async balances(tx: Tx, userId: string, year: number) {
    await this.hr.ensureLeaveTypes(tx);
    const annual = await this.hr.annualBalance(tx, userId, year);
    const types = await tx.query<{ id: string; code: string; name_ar: string; name_en: string; paid: boolean; uses_annual_balance: boolean; annual_quota: number | null }>(
      'select id, code, name_ar, name_en, paid, uses_annual_balance, annual_quota from leave_types where is_active order by uses_annual_balance desc, code',
    );
    const perType = [];
    for (const t of types) perType.push({ ...t, used: await this.hr.typeUsage(tx, userId, t.id, year) });
    return { year, annual, types: perType };
  }
}
