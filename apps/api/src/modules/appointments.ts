import { Body, Controller, Get, HttpCode, MessageEvent, Param, Patch, Post, Query, Req, Sse } from '@nestjs/common';
import { Observable, concat, defer, from, interval, map, merge } from 'rxjs';
import { z } from 'zod';
import { QUEUE_PRIORITIES, checkInSchema, createAppointmentSchema, rescheduleSchema, transitionAppointmentSchema, zDate, localDate } from '@hf/shared';
import type { Request } from 'express';
import { Auth, DisplayAuth, Meta, Staff } from '../common/decorators';
import { asStaff } from '../common/auth.guard';
import type { Principal, RequestMeta } from '../common/principal';
import { AuditService, Tenancy } from '../common/services';
import { badRequest, forbidden, notFound } from '../common/errors';
import { parse, uuid } from '../common/zod';
import { EventBus } from '../integrations/events';
import { AppointmentsService } from './appointments.service';

@Controller('v1')
export class AppointmentsController {
  constructor(
    private readonly tenancy: Tenancy,
    private readonly svc: AppointmentsService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
  ) {}

  /** Calendar views (FR-APT-8): day/week/month per doctor or clinic. */
  @Get('appointments')
  @Staff('appointment:view')
  list(@Auth() p: Principal, @Query() q: Record<string, string>) {
    const b = parse(z.object({ clinicId: z.string().uuid().optional(), doctorId: z.string().uuid().optional(), patientId: z.string().uuid().optional(), from: z.string().datetime(), to: z.string().datetime(), status: z.string().optional(), ref: z.string().max(20).optional() }), q);
    const s = asStaff(p);
    // Doctors without broader appointment rights see their own schedule.
    const onlyOwn = s.roles.length === 1 && s.roles[0] === 'doctor' && !b.doctorId ? s.userId : null;
    return this.tenancy.run(s, (tx) =>
      tx.query(
        `select a.id, a.ref, a.clinic_id, a.doctor_id, a.patient_id, a.start_at, a.end_at, a.status, a.channel, a.payment_mode, a.is_walk_in, a.notes,
                p.first_name_ar || ' ' || p.father_name_ar || ' ' || p.family_name_ar as patient_name, p.mrn, u.name_ar as doctor_name,
                coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name_ar', s.name_ar, 'name_en', s.name_en)) from appointment_services x join services s on s.id = x.service_id where x.appointment_id = a.id), '[]') as services,
                (select ticket_number from queue_tickets q where q.appointment_id = a.id) as ticket_number,
                (select e.id from encounters e where e.appointment_id = a.id) as encounter_id
         from appointments a join patients p on p.id = a.patient_id join users u on u.id = a.doctor_id
         where a.start_at >= $1 and a.start_at < $2 and ($3::uuid is null or a.clinic_id = $3) and ($4::uuid is null or a.doctor_id = $4)
           and ($5::uuid is null or a.patient_id = $5) and ($6::text is null or a.status = any(string_to_array($6, ','))) and ($7::text is null or a.ref = upper($7))
         order by a.start_at`,
        [b.from, b.to, b.clinicId ?? null, b.doctorId ?? onlyOwn, b.patientId ?? null, b.status ?? null, b.ref ?? null],
      ),
    );
  }

  @Get('appointments/:id')
  @Staff('appointment:view')
  async get(@Auth() p: Principal, @Param('id') id: string) {
    const r = await this.tenancy.run(p, async (tx) => {
      const a = await tx.maybeOne('select a.*, (select e.id from encounters e where e.appointment_id = a.id limit 1) as encounter_id from appointments a where a.id = $1', [uuid(id)]);
      if (!a) return null;
      const events = await tx.query('select from_status, to_status, reason, actor_type, actor_id, at from appointment_events where appointment_id = $1 order by at', [id]);
      const services = await tx.query('select s.* from appointment_services x join services s on s.id = x.service_id where x.appointment_id = $1', [id]);
      return { ...a, events, services };
    });
    if (!r) throw notFound('appointment');
    return r;
  }

  @Post('appointments')
  @Staff('appointment:create')
  create(@Auth() p: Principal, @Body() body: unknown, @Meta() meta: RequestMeta, @Req() req: Request) {
    const b = parse(createAppointmentSchema, body);
    const idem = (req.headers['idempotency-key'] as string | undefined)?.slice(0, 100);
    return this.tenancy.run(p, (tx) => this.svc.book(tx, p, meta, { ...b, idempotencyKey: idem }));
  }

  @Post('appointments/walk-in')
  @Staff('queue:create')
  walkIn(@Auth() p: Principal, @Body() body: unknown, @Meta() meta: RequestMeta, @Req() req: Request) {
    const b = parse(z.object({ patientId: z.string().uuid(), clinicId: z.string().uuid(), doctorId: z.string().uuid(), serviceIds: z.array(z.string().uuid()).min(1), priority: z.enum(QUEUE_PRIORITIES).default('normal') }), body);
    const idem = (req.headers['idempotency-key'] as string | undefined)?.slice(0, 100);
    return this.tenancy.run(p, (tx) => this.svc.walkIn(tx, p, meta, { ...b, idempotencyKey: idem ? `walkin:${p.kind === 'staff' ? p.userId : ''}:${idem}` : undefined }));
  }

  @Post('appointments/:id/transition')
  @Staff('appointment:edit')
  @HttpCode(200)
  transition(@Auth() p: Principal, @Param('id') id: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const b = parse(transitionAppointmentSchema, body);
    if (b.to === 'requested' || b.to === 'booked') throw badRequest('not_allowed');
    return this.tenancy.run(p, (tx) => this.svc.transition(tx, p, meta, uuid(id), b.to, { reason: b.reason, cancelledBy: 'clinic' }));
  }

  @Post('appointments/:id/check-in')
  @Staff('queue:create')
  @HttpCode(200)
  async checkIn(@Auth() p: Principal, @Param('id') id: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const b = parse(checkInSchema, body ?? {});
    return this.tenancy.run(p, async (tx) => {
      const r = await this.svc.transition(tx, p, meta, uuid(id), 'checked_in', { priority: b.priority });
      // FR-BIL-7: package balance and expiry shown at check-in.
      const packages = await tx.query(
        `select pb.id, pk.name_ar, pk.name_en, pb.sessions_total - pb.sessions_used as remaining, pb.expires_on from package_balances pb join packages pk on pk.id = pb.package_id
         where pb.patient_id = $1 and pb.sessions_used < pb.sessions_total and pb.expires_on >= current_date`,
        [r.appointment.patient_id],
      );
      return { ...r, packages };
    });
  }

  @Post('appointments/:id/reschedule')
  @Staff('appointment:edit')
  @HttpCode(200)
  reschedule(@Auth() p: Principal, @Param('id') id: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const b = parse(rescheduleSchema, body);
    return this.tenancy.run(p, (tx) => this.svc.reschedule(tx, p, meta, uuid(id), b.start, b.reason));
  }

  // ---- Follow-ups & waitlist (FR-APT-9, FR-APT-10)
  @Get('follow-ups')
  @Staff('appointment:view')
  followUps(@Auth() p: Principal, @Query('clinicId') clinicId?: string, @Query('until') until?: string) {
    return this.tenancy.run(p, (tx) =>
      tx.query(
        `select f.*, p.first_name_ar || ' ' || p.family_name_ar as patient_name, u.name_ar as doctor_name from follow_ups f join patients p on p.id = f.patient_id join users u on u.id = f.doctor_id
         where f.status = 'due' and ($1::uuid is null or f.clinic_id = $1) and f.due_date <= coalesce($2::date, current_date + 14) order by f.due_date`,
        [clinicId ? uuid(clinicId) : null, until ?? null],
      ),
    );
  }

  @Post('waitlist')
  @Staff('appointment:create')
  addWaitlist(@Auth() p: Principal, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const b = parse(z.object({ patientId: z.string().uuid(), clinicId: z.string().uuid(), doctorId: z.string().uuid(), serviceId: z.string().uuid().optional(), earliest: zDate, latest: zDate.optional() }), body);
    return this.tenancy.run(p, async (tx) => {
      const r = await tx.one<{ id: string }>(
        `insert into waitlist (organisation_id, clinic_id, doctor_id, patient_id, service_id, earliest, latest) values (app_org(), $1,$2,$3,$4,$5,$6) returning *`,
        [b.clinicId, b.doctorId, b.patientId, b.serviceId ?? null, b.earliest, b.latest ?? null],
      );
      await this.audit.record(tx, p, meta, { action: 'waitlist.add', entity: 'waitlist', entityId: r.id, patientId: b.patientId, clinicId: b.clinicId });
      return r;
    });
  }

  @Get('waitlist')
  @Staff('appointment:view')
  waitlist(@Auth() p: Principal, @Query('clinicId') clinicId?: string, @Query('status') status = 'waiting') {
    return this.tenancy.run(p, (tx) =>
      tx.query(
        `select w.*, p.first_name_ar || ' ' || p.family_name_ar as patient_name, p.mrn, u.name_ar as doctor_name, s.name_ar as service_name_ar, s.name_en as service_name_en
         from waitlist w join patients p on p.id = w.patient_id join users u on u.id = w.doctor_id left join services s on s.id = w.service_id
         where ($1::uuid is null or w.clinic_id = $1) and w.status = $2 order by w.created_at`,
        [clinicId ? uuid(clinicId) : null, status],
      ),
    );
  }

  @Patch('waitlist/:id')
  @Staff('appointment:edit')
  updateWaitlist(@Auth() p: Principal, @Param('id') id: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    // 'offered' records an offer made by phone at the desk; the worker also offers slots automatically.
    const b = parse(z.object({ status: z.enum(['waiting', 'offered', 'booked', 'cancelled']) }), body);
    return this.tenancy.run(p, async (tx) => {
      const r = await tx.maybeOne<{ patient_id: string; clinic_id: string }>(
        `update waitlist set status = $2, offered_at = case when $2 = 'offered' then now() when $2 = 'waiting' then null else offered_at end where id = $1 returning patient_id, clinic_id`,
        [uuid(id), b.status],
      );
      if (!r) throw notFound('waitlist');
      await this.audit.record(tx, p, meta, { action: 'waitlist.update', entity: 'waitlist', entityId: id, patientId: r.patient_id, clinicId: r.clinic_id, details: b });
      return { ok: true };
    });
  }

  // ---- Queue (FR-APT-5..7)
  @Get('queue')
  @Staff('queue:view')
  queue(@Auth() p: Principal, @Query('clinicId') clinicId: string, @Query('doctorId') doctorId?: string) {
    return this.tenancy.run(p, (tx) => this.svc.queue(tx, uuid(clinicId), doctorId ? uuid(doctorId) : null));
  }

  @Post('queue/call-next')
  @Staff('queue:edit')
  @HttpCode(200)
  callNext(@Auth() p: Principal, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const b = parse(z.object({ clinicId: z.string().uuid(), doctorId: z.string().uuid() }), body);
    return this.tenancy.run(p, (tx) => this.svc.callNext(tx, p, meta, b.clinicId, b.doctorId));
  }

  @Patch('queue/:id')
  @Staff('queue:edit')
  updateTicket(@Auth() p: Principal, @Param('id') id: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const b = parse(z.object({ priority: z.enum(QUEUE_PRIORITIES).optional(), status: z.enum(['waiting', 'skipped']).optional() }), body);
    return this.tenancy.run(p, async (tx) => {
      const t = await tx.maybeOne<{ clinic_id: string; doctor_id: string; patient_id: string }>(
        'update queue_tickets set priority = coalesce($2, priority), status = coalesce($3, status) where id = $1 returning clinic_id, doctor_id, patient_id',
        [uuid(id), b.priority ?? null, b.status ?? null],
      );
      if (!t) throw notFound('ticket');
      await this.audit.record(tx, p, meta, { action: 'queue.update', entity: 'queue_ticket', entityId: id, clinicId: t.clinic_id, patientId: t.patient_id, details: b });
      await this.svc.publishQueue(tx, t.clinic_id, t.doctor_id);
      return { ok: true };
    });
  }

  /** Staff live queue (SSE). Sends a snapshot then pushes on every change, with a heartbeat. */
  @Sse('queue/stream')
  @Staff('queue:view')
  stream(@Auth() p: Principal, @Query('clinicId') clinicId: string): Observable<MessageEvent> {
    const s = asStaff(p);
    const cid = uuid(clinicId);
    if (!s.network && !s.clinicIds.includes(cid)) throw forbidden();
    return this.liveStream(p.orgId, cid);
  }

  @Get('display/state')
  @DisplayAuth()
  displayState(@Req() req: Request & { displayClinicId: string }, @Auth() p: Principal) {
    return this.tenancy.system(p.orgId, (tx) => this.svc.displayState(tx, req.displayClinicId));
  }

  @Sse('display/stream')
  @DisplayAuth()
  displayStream(@Req() req: Request & { displayClinicId: string }, @Auth() p: Principal): Observable<MessageEvent> {
    return this.liveStream(p.orgId, req.displayClinicId);
  }

  private liveStream(orgId: string, clinicId: string): Observable<MessageEvent> {
    const snapshot = defer(() => from(this.tenancy.system(orgId, (tx) => this.svc.displayState(tx, clinicId)))).pipe(map((state) => ({ data: { type: 'queue', clinicId, state } }) as MessageEvent));
    const updates = this.events.stream<{ state: unknown }>(`queue:${clinicId}`).pipe(map((e) => ({ data: e }) as MessageEvent));
    const heartbeat = interval(25000).pipe(map(() => ({ type: 'ping', data: { at: new Date().toISOString(), date: localDate(new Date()) } }) as MessageEvent));
    return concat(snapshot, merge(updates, heartbeat));
  }
}
