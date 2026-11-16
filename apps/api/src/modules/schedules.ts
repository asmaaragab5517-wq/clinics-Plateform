import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { scheduleExceptionSchema, sessionSchema, zDate, zTime } from '@hf/shared';
import { Auth, Meta, Staff } from '../common/decorators';
import { asStaff } from '../common/auth.guard';
import type { Principal, RequestMeta } from '../common/principal';
import { AuditService, Tenancy } from '../common/services';
import { badRequest, notFound } from '../common/errors';
import { parse, uuid } from '../common/zod';
import { AvailabilityService } from './availability.service';
import { AppointmentsService } from './appointments.service';
import { zonedToUtc, addDays } from '@hf/shared';

@Controller('v1')
export class SchedulesController {
  constructor(
    private readonly tenancy: Tenancy,
    private readonly audit: AuditService,
    private readonly availability: AvailabilityService,
    private readonly appointments: AppointmentsService,
  ) {}

  @Get('sessions')
  @Staff('schedule:view')
  sessions(@Auth() p: Principal, @Query('clinicId') clinicId?: string, @Query('doctorId') doctorId?: string) {
    return this.tenancy.run(p, (tx) =>
      tx.query(
        `select s.*, u.name_ar as doctor_name from doctor_sessions s join users u on u.id = s.doctor_id
         where s.is_active and ($1::uuid is null or s.clinic_id = $1) and ($2::uuid is null or s.doctor_id = $2) order by u.name_ar, s.start_time`,
        [clinicId ? uuid(clinicId) : null, doctorId ? uuid(doctorId) : null],
      ),
    );
  }

  @Post('sessions')
  @Staff('schedule:create')
  create(@Auth() p: Principal, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const s = asStaff(p);
    const b = parse(sessionSchema, body);
    return this.tenancy.run(s, async (tx) => {
      const isDoctor = await tx.maybeOne(`select 1 from staff_memberships where user_id = $1 and clinic_id = $2 and role = 'doctor'`, [b.doctorId, b.clinicId]);
      if (!isDoctor) throw badRequest('doctor_not_member_of_clinic');
      const r = await tx.one<{ id: string }>(
        `insert into doctor_sessions (organisation_id, clinic_id, doctor_id, profile_id, weekdays, start_time, end_time, slot_minutes, capacity_per_slot, walk_in_reserved, breaks, service_ids, effective_from, effective_to, created_by)
         values (app_org(), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning *`,
        [b.clinicId, b.doctorId, b.profileId ?? null, b.weekdays, b.startTime, b.endTime, b.slotMinutes, b.capacityPerSlot, b.walkInReserved, JSON.stringify(b.breaks), b.serviceIds, b.effectiveFrom, b.effectiveTo ?? null, s.userId],
      );
      await this.audit.record(tx, s, meta, { action: 'schedule.session_create', entity: 'doctor_session', entityId: r.id, clinicId: b.clinicId });
      return r;
    });
  }

  @Patch('sessions/:id')
  @Staff('schedule:edit')
  update(@Auth() p: Principal, @Param('id') id: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const b = parse(z.object({ effectiveTo: zDate.nullable().optional(), walkInReserved: z.number().int().min(0).optional(), capacityPerSlot: z.number().int().min(1).max(20).optional(), overbookPerSlot: z.number().int().min(0).max(10).optional(), isActive: z.boolean().optional() }), body);
    return this.tenancy.run(p, async (tx) => {
      const r = await tx.maybeOne(
        `update doctor_sessions set effective_to = case when $2::boolean then $3::date else effective_to end, walk_in_reserved = coalesce($4, walk_in_reserved),
           capacity_per_slot = coalesce($5, capacity_per_slot), overbook_per_slot = coalesce($6, overbook_per_slot), is_active = coalesce($7, is_active) where id = $1 returning *`,
        [uuid(id), b.effectiveTo !== undefined, b.effectiveTo ?? null, b.walkInReserved ?? null, b.capacityPerSlot ?? null, b.overbookPerSlot ?? null, b.isActive ?? null],
      );
      if (!r) throw notFound('session');
      await this.audit.record(tx, p, meta, { action: 'schedule.session_update', entity: 'doctor_session', entityId: id, details: b });
      return r;
    });
  }

  @Get('schedule-profiles')
  @Staff('schedule:view')
  profiles(@Auth() p: Principal) {
    return this.tenancy.run(p, (tx) => tx.query('select * from schedule_profiles order by date_from desc'));
  }

  @Post('schedule-profiles')
  @Staff('schedule:create')
  createProfile(@Auth() p: Principal, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const b = parse(z.object({ name: z.string().min(2), dateFrom: zDate, dateTo: zDate }).refine((x) => x.dateFrom <= x.dateTo), body);
    return this.tenancy.run(p, async (tx) => {
      const r = await tx.one<{ id: string }>('insert into schedule_profiles (organisation_id, name, date_from, date_to) values (app_org(), $1,$2,$3) returning *', [b.name, b.dateFrom, b.dateTo]);
      await this.audit.record(tx, p, meta, { action: 'schedule.profile_create', entity: 'schedule_profile', entityId: r.id });
      return r;
    });
  }

  @Get('schedule-exceptions')
  @Staff('schedule:view')
  exceptions(@Auth() p: Principal, @Query('from') from?: string, @Query('to') to?: string) {
    return this.tenancy.run(p, (tx) =>
      tx.query('select * from schedule_exceptions where ($1::date is null or date >= $1) and ($2::date is null or date <= $2) order by date', [from ?? null, to ?? null]),
    );
  }

  /**
   * FR-SCH-2: leave / holiday / extra session. When it removes capacity the response lists affected appointments;
   * `action` performs a bulk cancel with patient notification.
   */
  @Post('schedule-exceptions')
  @Staff('schedule:create')
  createException(@Auth() p: Principal, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const s = asStaff(p);
    const b = parse(
      scheduleExceptionSchema.extend({
        action: z.enum(['list', 'cancel_all']).default('list'),
        extraSession: z.object({ clinicId: z.string().uuid(), startTime: zTime, endTime: zTime, slotMinutes: z.number().int().min(5), capacityPerSlot: z.number().int().min(1).default(1) }).optional(),
      }),
      body,
    );
    if (b.kind === 'leave' && !b.doctorId) throw badRequest('doctor_required');
    if (b.kind === 'extra' && (!b.doctorId || !b.extraSession)) throw badRequest('extra_session_required');
    return this.tenancy.run(s, async (tx) => {
      const exc = await tx.one<{ id: string }>(
        `insert into schedule_exceptions (organisation_id, clinic_id, doctor_id, kind, date, start_time, end_time, reason, created_by) values (app_org(), $1,$2,$3,$4,$5,$6,$7,$8) returning *`,
        [b.clinicId ?? b.extraSession?.clinicId ?? null, b.doctorId ?? null, b.kind, b.date, b.startTime ?? null, b.endTime ?? null, b.reason ?? null, s.userId],
      );
      if (b.kind === 'extra' && b.extraSession) {
        const session = { id: `extra:${exc.id}`, doctorId: b.doctorId, clinicId: b.extraSession.clinicId, startTime: b.extraSession.startTime, endTime: b.extraSession.endTime, slotMinutes: b.extraSession.slotMinutes, capacityPerSlot: b.extraSession.capacityPerSlot, walkInReserved: 0 };
        await tx.query('update schedule_exceptions set session = $2 where id = $1', [exc.id, JSON.stringify(session)]);
      }
      let affected: { id: string; patient_id: string; start_at: Date; status: string }[] = [];
      if (b.kind !== 'extra') {
        const dayStart = zonedToUtc(b.date, b.startTime ?? '00:00');
        const dayEnd = b.endTime ? zonedToUtc(b.date, b.endTime) : zonedToUtc(addDays(b.date, 1), '00:00');
        affected = await tx.query(
          `select id, patient_id, start_at, status from appointments where status in ('requested','booked','confirmed')
             and start_at < $2 and end_at > $1 and ($3::uuid is null or doctor_id = $3) and ($4::uuid is null or clinic_id = $4) order by start_at`,
          [dayStart, dayEnd, b.doctorId ?? null, b.clinicId ?? null],
        );
        if (b.action === 'cancel_all') {
          for (const a of affected) await this.appointments.transition(tx, s, meta, a.id, 'cancelled', { reason: b.reason ?? b.kind, cancelledBy: 'clinic' });
        }
      }
      await this.audit.record(tx, s, meta, { action: `schedule.exception_${b.kind}`, entity: 'schedule_exception', entityId: exc.id, clinicId: b.clinicId ?? null, details: { affected: affected.length, action: b.action } });
      return { exception: exc, affected, cancelled: b.action === 'cancel_all' ? affected.length : 0 };
    });
  }

  @Delete('schedule-exceptions/:id')
  @Staff('schedule:delete')
  deleteException(@Auth() p: Principal, @Param('id') id: string, @Meta() meta: RequestMeta) {
    return this.tenancy.run(p, async (tx) => {
      const r = await tx.maybeOne('delete from schedule_exceptions where id = $1 returning id', [uuid(id)]);
      if (!r) throw notFound('exception');
      await this.audit.record(tx, p, meta, { action: 'schedule.exception_delete', entity: 'schedule_exception', entityId: id });
      return { ok: true };
    });
  }

  /** Desk availability (includes walk-in reserved capacity and overbooking). */
  @Get('availability')
  @Staff('appointment:view')
  availabilityDesk(@Auth() p: Principal, @Query() q: Record<string, string>) {
    const b = parse(z.object({ doctorId: z.string().uuid().optional(), clinicId: z.string().uuid().optional(), serviceId: z.string().uuid().optional(), from: zDate, days: z.coerce.number().int().min(1).max(31).default(7) }), q);
    return this.tenancy.run(p, async (tx) => {
      const doctors = b.doctorId
        ? [b.doctorId]
        : (await tx.query<{ doctor_id: string }>('select distinct doctor_id from doctor_sessions where is_active and ($1::uuid is null or clinic_id = $1)', [b.clinicId ?? null])).map((r) => r.doctor_id);
      return this.availability.slots(tx, { doctorIds: doctors, clinicId: b.clinicId, serviceId: b.serviceId, from: b.from, days: b.days, channel: 'desk', leadMinutes: 0 });
    });
  }
}
