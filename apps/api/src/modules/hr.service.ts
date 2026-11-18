import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { SecretBox, Tx } from '@hf/db';
import {
  DEFAULT_LEAVE_TYPES,
  addDays,
  annualLeaveEntitlement,
  computeAttendance,
  computePayslip,
  hrSettings,
  localDate,
  localTime,
  minutesOf,
  scheduledShift,
  shiftMinutes,
  workPatternSchema,
  workingDaysBetween,
  type Allowance,
  type AdjustmentKind,
  type HrSettings,
  type PayslipResult,
  type WorkPattern,
} from '@hf/shared';
import { BOX } from '../common/services';
import { DomainError } from '../common/errors';

export interface ContractRow {
  id: string;
  user_id: string;
  clinic_id: string;
  job_title_ar: string;
  job_title_en: string;
  employment_type: string;
  pay_basis: 'monthly' | 'hourly' | 'commission_only';
  start_date: string;
  end_date: string | null;
  base_salary: number;
  allowances: Allowance[];
  insurable_wage: number | null;
  social_insurance_number: string | null;
  bank_name: string | null;
  iban_enc: Buffer | null;
  iban_last4: string | null;
  work_pattern: WorkPattern;
  date_of_birth: string | null;
  status: 'active' | 'ended';
}

export interface MonthSummary {
  periodDays: number;
  employedDays: number;
  scheduledDays: number;
  workedDays: number;
  workedMinutes: number;
  absentDays: number;
  leaveDays: number;
  unpaidLeaveDays: number;
  latenessMinutes: number;
  overtimeMinutes: number;
  restDayOvertimeMinutes: number;
  pendingOvertimeMinutes: number;
  futureDays: number;
}

/** Leave types whose length is counted in calendar days rather than working days. */
const CALENDAR_DAY_LEAVE = new Set(['maternity', 'hajj']);

const ymd = (d: Date | string) => (typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10));
const toMinutes = (workDate: string, ts: Date | null) => {
  if (!ts) return null;
  const day = localDate(ts);
  const m = minutesOf(localTime(ts));
  return day > workDate ? m + 1440 : m;
};

@Injectable()
export class HrService {
  constructor(@Inject(BOX) private readonly box: SecretBox) {}

  async settings(tx: Tx): Promise<HrSettings> {
    const o = await tx.one<{ settings: { hr?: Partial<HrSettings> } }>('select settings from organisations where id = app_org()');
    return hrSettings(o.settings.hr);
  }

  async ensureLeaveTypes(tx: Tx) {
    const n = await tx.one<{ n: number }>('select count(*)::int as n from leave_types');
    if (n.n > 0) return;
    for (const t of DEFAULT_LEAVE_TYPES)
      await tx.query(
        `insert into leave_types (organisation_id, code, name_ar, name_en, paid, uses_annual_balance, annual_quota, max_consecutive_days)
         values (app_org(), $1,$2,$3,$4,$5,$6,$7) on conflict do nothing`,
        [t.code, t.nameAr, t.nameEn, t.paid, t.usesAnnualBalance, t.annualQuota, t.maxConsecutiveDays],
      );
  }

  activeContract(tx: Tx, userId: string) {
    return tx.maybeOne<ContractRow>(`select * from employment_contracts where user_id = $1 and status = 'active'`, [userId]);
  }

  async requireContract(tx: Tx, userId: string) {
    const c = await this.activeContract(tx, userId);
    if (!c) throw new DomainError('no_active_contract', HttpStatus.UNPROCESSABLE_ENTITY);
    return { ...c, work_pattern: workPatternSchema.parse(c.work_pattern) };
  }

  async holidays(tx: Tx, from: string, to: string): Promise<Set<string>> {
    const rows = await tx.query<{ d: string }>(`select to_char(holiday_date, 'YYYY-MM-DD') as d from public_holidays where holiday_date between $1 and $2`, [from, to]);
    return new Set(rows.map((r) => r.d));
  }

  sealIban(iban: string) {
    return { enc: this.box.encrypt(iban, 'iban'), last4: iban.slice(-4) };
  }

  openIban(enc: Buffer | null) {
    return enc ? this.box.decrypt(enc, 'iban') : null;
  }

  /** Recalculate lateness, early leaving and overtime for one attendance record. */
  async recompute(tx: Tx, recordId: string) {
    const r = await tx.one<{ user_id: string; work_date: string; clock_in: Date | null; clock_out: Date | null }>(
      `select user_id, to_char(work_date, 'YYYY-MM-DD') as work_date, clock_in, clock_out from attendance_records where id = $1`,
      [recordId],
    );
    const c = await this.activeContract(tx, r.user_id);
    const s = await this.settings(tx);
    const pattern = c ? workPatternSchema.parse(c.work_pattern) : null;
    const shift = pattern ? scheduledShift(pattern, r.work_date, await this.holidays(tx, r.work_date, r.work_date)) : null;
    const perms = await tx.query<{ s: string; e: string }>(
      `select to_char(start_time, 'HH24:MI') as s, to_char(end_time, 'HH24:MI') as e from permission_requests where user_id = $1 and work_date = $2 and status = 'approved'`,
      [r.user_id, r.work_date],
    );
    const a = computeAttendance({
      shift,
      clockIn: toMinutes(r.work_date, r.clock_in),
      clockOut: toMinutes(r.work_date, r.clock_out),
      graceMinutes: s.graceMinutes,
      permissions: perms.map((p) => ({ start: minutesOf(p.s), end: minutesOf(p.e) })),
    });
    const status = r.clock_in && r.clock_out ? 'complete' : 'open';
    return tx.one(
      `update attendance_records set late_minutes = $2, early_leave_minutes = $3, worked_minutes = $4, overtime_minutes = $5, rest_day = $6,
         status = case when status in ('absent','on_leave','holiday','rest_day','incomplete') and $7 = 'open' then status else $7 end, updated_at = now()
       where id = $1 returning *`,
      [recordId, a.lateMinutes, a.earlyLeaveMinutes, a.workedMinutes, a.overtimeMinutes, a.restDay, status],
    );
  }

  /** Days a leave request uses: working days for most types, calendar days for maternity and Hajj. */
  async leaveDays(tx: Tx, pattern: WorkPattern, code: string, from: string, to: string) {
    if (CALENDAR_DAY_LEAVE.has(code)) return Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
    return workingDaysBetween(pattern, from, to, await this.holidays(tx, from, to));
  }

  /** The shared annual pool (annual + casual): entitlement, carry-over, adjustments and days used or requested. */
  async annualBalance(tx: Tx, userId: string, year: number) {
    const c = await this.activeContract(tx, userId);
    let b = await tx.maybeOne<{ id: string; entitled: string; carried: string; adjusted: string }>('select * from leave_balances where user_id = $1 and year = $2', [userId, year]);
    // Rows are stored for past and current years only; a future year is shown from the contract without saving.
    if (!b && c && year > Number(localDate(new Date()).slice(0, 4))) {
      b = { id: '', entitled: String(annualLeaveEntitlement(ymd(c.start_date), year, c.date_of_birth ? ymd(c.date_of_birth) : null)), carried: '0', adjusted: '0' };
    }
    if (!b && c) {
      b = await tx.one<{ id: string; entitled: string; carried: string; adjusted: string }>(
        `insert into leave_balances (organisation_id, user_id, year, entitled) values (app_org(), $1, $2, $3)
         on conflict (user_id, year) do update set entitled = leave_balances.entitled returning *`,
        [userId, year, annualLeaveEntitlement(ymd(c.start_date), year, c.date_of_birth ? ymd(c.date_of_birth) : null)],
      );
    }
    const used = await tx.one<{ approved: string; pending: string }>(
      `select coalesce(sum(r.days) filter (where r.status = 'approved'), 0) as approved, coalesce(sum(r.days) filter (where r.status = 'pending'), 0) as pending
       from leave_requests r join leave_types t on t.id = r.leave_type_id
       where r.user_id = $1 and t.uses_annual_balance and extract(year from r.start_date) = $2`,
      [userId, year],
    );
    const entitled = Number(b?.entitled ?? 0);
    const carried = Number(b?.carried ?? 0);
    const adjusted = Number(b?.adjusted ?? 0);
    const approved = Number(used.approved);
    const pending = Number(used.pending);
    return { balanceId: b?.id || null, year, entitled, carried, adjusted, used: approved, pending, available: entitled + carried + adjusted - approved - pending };
  }

  async typeUsage(tx: Tx, userId: string, leaveTypeId: string, year: number) {
    const r = await tx.one<{ days: string }>(
      `select coalesce(sum(days), 0) as days from leave_requests where user_id = $1 and leave_type_id = $2 and status in ('pending','approved') and extract(year from start_date) = $3`,
      [userId, leaveTypeId, year],
    );
    return Number(r.days);
  }

  /** Attendance and leave summary for a calendar month (period = first day). */
  async monthSummary(tx: Tx, c: ContractRow, period: string, today: string): Promise<MonthSummary> {
    const pattern = workPatternSchema.parse(c.work_pattern);
    const last = addDays(addDays(period, 32).slice(0, 8) + '01', -1);
    const from = ymd(c.start_date) > period ? ymd(c.start_date) : period;
    const to = c.end_date && ymd(c.end_date) < last ? ymd(c.end_date) : last;
    const periodDays = Number(last.slice(8, 10));
    const sum: MonthSummary = {
      periodDays, employedDays: 0, scheduledDays: 0, workedDays: 0, workedMinutes: 0, absentDays: 0, leaveDays: 0, unpaidLeaveDays: 0,
      latenessMinutes: 0, overtimeMinutes: 0, restDayOvertimeMinutes: 0, pendingOvertimeMinutes: 0, futureDays: 0,
    };
    if (from > to) return sum;
    sum.employedDays = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
    const holidays = await this.holidays(tx, from, to);
    const records = await tx.query<{ d: string; clock_in: Date | null; late_minutes: number; early_leave_minutes: number; worked_minutes: number; overtime_minutes: number; rest_day: boolean; overtime_approved: boolean; overtime_status: string }>(
      `select to_char(work_date, 'YYYY-MM-DD') as d, clock_in, late_minutes, early_leave_minutes, worked_minutes, overtime_minutes, rest_day, overtime_approved, overtime_status
       from attendance_records where user_id = $1 and work_date between $2 and $3`,
      [c.user_id, from, to],
    );
    const byDay = new Map(records.map((r) => [r.d, r]));
    const leaves = await tx.query<{ s: string; e: string; paid: boolean }>(
      `select to_char(r.start_date, 'YYYY-MM-DD') as s, to_char(r.end_date, 'YYYY-MM-DD') as e, t.paid from leave_requests r join leave_types t on t.id = r.leave_type_id
       where r.user_id = $1 and r.status = 'approved' and r.start_date <= $3 and r.end_date >= $2`,
      [c.user_id, from, to],
    );
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const rec = byDay.get(d);
      if (rec?.clock_in) {
        sum.workedMinutes += rec.worked_minutes;
        if (rec.overtime_approved) {
          if (rec.rest_day) sum.restDayOvertimeMinutes += rec.overtime_minutes;
          else sum.overtimeMinutes += rec.overtime_minutes;
        } else if (rec.overtime_status === 'pending') sum.pendingOvertimeMinutes += rec.overtime_minutes;
      }
      if (!scheduledShift(pattern, d, holidays)) continue;
      sum.scheduledDays++;
      const leave = leaves.find((l) => l.s <= d && l.e >= d);
      if (leave) {
        sum.leaveDays++;
        if (!leave.paid) sum.unpaidLeaveDays++;
      } else if (rec?.clock_in) {
        sum.workedDays++;
        sum.latenessMinutes += rec.late_minutes + rec.early_leave_minutes;
      } else if (d >= today) sum.futureDays++;
      else sum.absentDays++;
    }
    return sum;
  }

  /** Payslip for one contract and month. */
  async payslipFor(tx: Tx, c: ContractRow, period: string, today: string, s: HrSettings): Promise<{ summary: MonthSummary; slip: PayslipResult; commission: number }> {
    const summary = await this.monthSummary(tx, c, period, today);
    const commission = await tx.one<{ n: string }>(`select coalesce(sum(share), 0) as n from commission_statements where doctor_id = $1 and month = $2 and status = 'approved'`, [c.user_id, period]);
    const adjustments = await tx.query<{ kind: AdjustmentKind; amount: number; taxable: boolean; note: string | null }>(
      'select kind, amount, taxable, note from payroll_adjustments where user_id = $1 and period = $2 order by created_at',
      [c.user_id, period],
    );
    const slip = computePayslip(
      {
        payBasis: c.pay_basis,
        baseSalary: c.base_salary,
        allowances: c.allowances ?? [],
        insurableWage: c.insurable_wage,
        dayMinutes: shiftMinutes(workPatternSchema.parse(c.work_pattern)),
        periodDays: summary.periodDays,
        employedDays: summary.employedDays,
        workedMinutes: summary.workedMinutes,
        absentDays: summary.absentDays,
        unpaidLeaveDays: summary.unpaidLeaveDays,
        latenessMinutes: summary.latenessMinutes,
        overtimeMinutes: summary.overtimeMinutes,
        restDayOvertimeMinutes: summary.restDayOvertimeMinutes,
        commission: Number(commission.n),
        adjustments,
      },
      s,
    );
    if (summary.pendingOvertimeMinutes > 0) slip.warnings.push('unapproved_overtime');
    if (summary.futureDays > 0) slip.warnings.push('period_not_finished');
    return { summary, slip, commission: Number(commission.n) };
  }

  /**
   * Nightly close of a working day: people scheduled to work with no attendance become absent, on leave or on a
   * public holiday; an open clock-in without a clock-out becomes incomplete for a manager to correct.
   */
  async closeDay(tx: Tx, day: string) {
    const holidays = await this.holidays(tx, day, day);
    const contracts = await tx.query<ContractRow>(`select * from employment_contracts where status = 'active' and start_date <= $1 and (end_date is null or end_date >= $1)`, [day]);
    let marked = 0;
    for (const c of contracts) {
      const pattern = workPatternSchema.parse(c.work_pattern);
      const rec = await tx.maybeOne<{ id: string; clock_in: Date | null; clock_out: Date | null }>('select id, clock_in, clock_out from attendance_records where user_id = $1 and work_date = $2', [c.user_id, day]);
      if (rec?.clock_in && !rec.clock_out) {
        await tx.query(`update attendance_records set status = 'incomplete', updated_at = now() where id = $1`, [rec.id]);
        marked++;
        continue;
      }
      if (rec) continue;
      const scheduled = pattern.days.includes(new Date(`${day}T00:00:00Z`).getUTCDay());
      if (!scheduled) continue;
      const onLeave = await tx.maybeOne(`select 1 from leave_requests where user_id = $1 and status = 'approved' and start_date <= $2 and end_date >= $2`, [c.user_id, day]);
      const status = holidays.has(day) ? 'holiday' : onLeave ? 'on_leave' : 'absent';
      await tx.query(
        `insert into attendance_records (organisation_id, user_id, clinic_id, work_date, source, status) values (app_org(), $1, $2, $3, 'system', $4) on conflict (user_id, work_date) do nothing`,
        [c.user_id, c.clinic_id, day, status],
      );
      marked++;
    }
    return marked;
  }
}
