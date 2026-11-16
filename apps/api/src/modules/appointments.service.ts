import { HttpStatus, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Tx } from '@hf/db';
import {
  CAPACITY_STATUSES, canTransitionAppointment, formatDate, formatTime12, localDate, orderQueue,
  type AppointmentStatus, type BookingChannel, type QueuePriority,
} from '@hf/shared';
import { DomainError, badRequest, conflict, notFound } from '../common/errors';
import type { Principal, RequestMeta } from '../common/principal';
import { AuditService } from '../common/services';
import { EventBus } from '../integrations/events';
import { AvailabilityService } from './availability.service';
import { MessagingService } from './messaging.service';

export interface BookingPolicy {
  leadMinutes: number;
  cancellationCutoffHours: number;
  maxReschedules: number;
  rescheduleFee: number;
  noShowFee: number;
  depositPercent: number;
  holdMinutes: number;
  noShowAfterMinutes: number;
  requireOnlinePayment?: boolean;
}

export const DEFAULT_POLICY: BookingPolicy = {
  leadMinutes: 60, cancellationCutoffHours: 6, maxReschedules: 2, rescheduleFee: 0, noShowFee: 0, depositPercent: 100, holdMinutes: 10, noShowAfterMinutes: 30,
};

export interface BookInput {
  patientId: string;
  clinicId: string;
  doctorId: string;
  serviceIds: string[];
  start: string;
  channel: BookingChannel;
  paymentMode: 'online' | 'at_clinic';
  notes?: string;
  idempotencyKey?: string;
}

const UUID_RE = /^[0-9a-f-]{36}$/i;
/** Extra (ad-hoc) sessions come from schedule exceptions and have no doctor_sessions row. */
const sessionRef = (id: string) => (UUID_RE.test(id) ? id : null);

const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export function newRef(): string {
  const b = randomBytes(7);
  return 'A' + [...b].map((x) => ALPHABET[x % ALPHABET.length]).join('');
}

export interface ApptRow {
  id: string; organisation_id: string; clinic_id: string; doctor_id: string; patient_id: string; session_id: string | null; ref: string; start_at: Date; end_at: Date;
  slot_index: number; status: AppointmentStatus; channel: string; payment_mode: string; hold_expires_at: Date | null; is_walk_in: boolean; reschedule_count: number; cancelled_by?: string | null;
}

@Injectable()
export class AppointmentsService {
  constructor(
    private readonly availability: AvailabilityService,
    private readonly messaging: MessagingService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
  ) {}

  async policy(tx: Tx): Promise<BookingPolicy> {
    const o = await tx.one<{ settings: { booking?: Partial<BookingPolicy> } }>('select settings from organisations where id = app_org()');
    return { ...DEFAULT_POLICY, ...(o.settings.booking ?? {}) };
  }

  private async context(tx: Tx, appointmentId: string) {
    return tx.one<{ doctor: string; clinic: string; clinic_address: string }>(
      `select u.name_ar as doctor, c.name_ar as clinic, c.address_lines as clinic_address from appointments a join users u on u.id = a.doctor_id join clinics c on c.id = a.clinic_id where a.id = $1`,
      [appointmentId],
    );
  }

  /** Pick the lowest free capacity index, retrying on concurrent exclusion conflicts (FR-SCH-4). */
  private async insertWithCapacity(tx: Tx, capacity: number, startAt: Date, endAt: Date, doctorId: string, insert: (slotIndex: number) => Promise<ApptRow>): Promise<ApptRow> {
    const used = new Set((await tx.query<{ used_slot_indexes: number }>('select used_slot_indexes from used_slot_indexes($1, $2, $3)', [doctorId, startAt, endAt])).map((r) => r.used_slot_indexes));
    for (let i = 0; i < capacity; i++) {
      if (used.has(i)) continue;
      await tx.query('savepoint book');
      try {
        const row = await insert(i);
        await tx.query('release savepoint book');
        return row;
      } catch (e) {
        await tx.query('rollback to savepoint book');
        if ((e as { code?: string }).code !== '23P01') throw e;
      }
    }
    throw conflict('slot_unavailable');
  }

  async book(tx: Tx, actor: Principal, meta: RequestMeta | null, b: BookInput): Promise<ApptRow> {
    if (b.idempotencyKey) {
      const existing = await tx.maybeOne<ApptRow>('select * from appointments where idempotency_key = $1', [b.idempotencyKey]);
      if (existing) return existing;
    }
    const policy = await this.policy(tx);
    const works = await tx.maybeOne(
      `select 1 from users u where u.id = $1 and u.status = 'active'
         and exists (select 1 from doctor_sessions s where s.doctor_id = u.id and s.clinic_id = $2 and s.is_active)`,
      [b.doctorId, b.clinicId],
    );
    if (!works) throw badRequest('doctor_not_available_at_clinic');
    const services = await tx.query<{ id: string; duration_minutes: number }>('select id, duration_minutes from services where id = any($1::uuid[]) and is_active', [b.serviceIds]);
    if (services.length !== b.serviceIds.length) throw badRequest('invalid_service');
    const offered = await tx.query<{ service_id: string }>('select service_id from doctor_services where doctor_id = $1', [b.doctorId]);
    if (offered.length && b.serviceIds.some((s) => !offered.some((o) => o.service_id === s))) throw badRequest('service_not_offered_by_doctor');

    const start = new Date(b.start);
    if (Number.isNaN(start.getTime())) throw badRequest('invalid_start');
    const desk = actor.kind === 'staff';
    const slots = await this.availability.slots(tx, {
      doctorIds: [b.doctorId], clinicId: b.clinicId, serviceId: b.serviceIds[0], from: localDate(start), days: 1,
      channel: desk ? 'desk' : 'online', leadMinutes: desk ? -24 * 60 : policy.leadMinutes,
    });
    const slot = slots.find((s) => s.start === start.toISOString());
    if (!slot) throw new DomainError('slot_not_offered', HttpStatus.CONFLICT);
    const online = b.paymentMode === 'online';
    const status: AppointmentStatus = online ? 'requested' : 'booked';
    const holdUntil = online ? new Date(Date.now() + policy.holdMinutes * 60000) : null;
    const actorId = actor.kind === 'staff' ? actor.userId : actor.kind === 'patient' ? actor.accountId : null;
    const endAt = new Date(slot.end);
    const row = await this.insertWithCapacity(tx, slot.capacity, start, endAt, b.doctorId, (slotIndex) =>
      tx.one<ApptRow>(
        `insert into appointments (organisation_id, clinic_id, doctor_id, patient_id, session_id, ref, start_at, end_at, slot_index, status, channel, payment_mode, hold_expires_at, notes, idempotency_key, created_by)
         values (app_org(), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning *`,
        [b.clinicId, b.doctorId, b.patientId, sessionRef(slot.sessionId), newRef(), start, endAt, slotIndex, status, b.channel, b.paymentMode, holdUntil, b.notes ?? null, b.idempotencyKey ?? null, actorId],
      ),
    );
    for (const s of b.serviceIds) await tx.query('insert into appointment_services (organisation_id, appointment_id, service_id) values (app_org(), $1, $2)', [row.id, s]);
    await this.event(tx, row, null, status, actor);
    if (status === 'booked') await this.notifyBooked(tx, row);
    await this.audit.record(tx, actor, meta, { action: 'appointment.create', entity: 'appointment', entityId: row.id, patientId: b.patientId, clinicId: b.clinicId, details: { channel: b.channel, status } });
    return row;
  }

  async notifyBooked(tx: Tx, a: ApptRow) {
    const c = await this.context(tx, a.id);
    await this.messaging.enqueue(tx, {
      event: 'booking_confirmed', patientId: a.patient_id, clinicId: a.clinic_id, dedupeKey: `booked:${a.id}:${new Date(a.start_at).toISOString()}`,
      vars: { doctor: c.doctor, clinic: c.clinic, date: formatDate(new Date(a.start_at)), time: formatTime12(new Date(a.start_at), 'ar'), ref: a.ref },
    });
  }

  private async event(tx: Tx, a: Pick<ApptRow, 'id' | 'clinic_id'>, from: AppointmentStatus | null, to: AppointmentStatus, actor: Principal | null, reason?: string) {
    await tx.query(
      `insert into appointment_events (organisation_id, clinic_id, appointment_id, from_status, to_status, reason, actor_type, actor_id) values (app_org(), $1,$2,$3,$4,$5,$6,$7)`,
      [a.clinic_id, a.id, from, to, reason ?? null, actor?.kind ?? 'system', actor?.kind === 'staff' ? actor.userId : actor?.kind === 'patient' ? actor.accountId : null],
    );
  }

  async get(tx: Tx, id: string): Promise<ApptRow> {
    const a = await tx.maybeOne<ApptRow>('select * from appointments where id = $1 for update', [id]);
    if (!a) throw notFound('appointment');
    return a;
  }

  /** Status machine with side effects (FR-APT-2). */
  async transition(tx: Tx, actor: Principal | null, meta: RequestMeta | null, id: string, to: AppointmentStatus, opts: { reason?: string; priority?: QueuePriority; cancelledBy?: 'patient' | 'clinic' } = {}) {
    const a = await this.get(tx, id);
    if (!canTransitionAppointment(a.status, to)) throw new DomainError('invalid_transition', HttpStatus.CONFLICT, { from: a.status, to });
    if (to === 'cancelled' && !opts.reason) throw badRequest('reason_required');
    const updated = await tx.one<ApptRow>(
      `update appointments set status = $2, cancel_reason = coalesce($3, cancel_reason), cancelled_by = coalesce($4, cancelled_by), hold_expires_at = case when $2 = 'requested' then hold_expires_at else null end, updated_by = $5 where id = $1 returning *`,
      [id, to, to === 'cancelled' ? opts.reason : null, to === 'cancelled' ? (opts.cancelledBy ?? (actor?.kind === 'patient' ? 'patient' : 'clinic')) : null, actor?.kind === 'staff' ? actor.userId : null],
    );
    await this.event(tx, a, a.status, to, actor, opts.reason);
    const c = await this.context(tx, id);
    const when = new Date(a.start_at);
    const vars = { doctor: c.doctor, clinic: c.clinic, date: formatDate(when), time: formatTime12(when, 'ar'), ref: a.ref, link: '' };
    let ticket: unknown = null;
    switch (to) {
      case 'booked':
        await this.notifyBooked(tx, updated);
        break;
      case 'checked_in':
        ticket = await this.issueTicket(tx, updated, opts.priority ?? (new Date() <= new Date(a.start_at) ? 'booked_on_time' : 'normal'));
        await tx.query(
          `insert into encounters (organisation_id, clinic_id, doctor_id, patient_id, appointment_id, created_by) values (app_org(), $1,$2,$3,$4,$5) on conflict (appointment_id) do nothing`,
          [a.clinic_id, a.doctor_id, a.patient_id, a.id, actor?.kind === 'staff' ? actor.userId : null],
        );
        break;
      case 'in_consultation':
        await tx.query(`update queue_tickets set status = 'serving', served_at = now() where appointment_id = $1`, [id]);
        break;
      case 'completed':
        await tx.query(`update queue_tickets set status = 'done', done_at = now() where appointment_id = $1`, [id]);
        await this.messaging.enqueue(tx, { event: 'review_request', patientId: a.patient_id, clinicId: a.clinic_id, scheduledFor: new Date(Date.now() + 2 * 3600_000), dedupeKey: `review:${id}`, vars: { ...vars, link: `review/${id}` } });
        break;
      case 'no_show':
        await this.messaging.enqueue(tx, { event: 'no_show_notice', patientId: a.patient_id, clinicId: a.clinic_id, dedupeKey: `noshow:${id}`, vars });
        break;
      case 'cancelled':
        await tx.query(`update queue_tickets set status = 'skipped' where appointment_id = $1 and status in ('waiting','called')`, [id]);
        await tx.query(`update payment_intents set status = 'expired' where appointment_id = $1 and status in ('created','pending')`, [id]);
        await this.messaging.enqueue(tx, { event: updated.cancelled_by === 'patient' ? 'cancelled_by_patient' : 'cancelled_by_clinic', patientId: a.patient_id, clinicId: a.clinic_id, dedupeKey: `cancel:${id}`, vars });
        await this.refundIfPrepaid(tx, actor, a, opts.reason ?? 'cancelled', updated.cancelled_by === 'clinic');
        break;
    }
    await this.audit.record(tx, actor, meta, { action: `appointment.${to}`, entity: 'appointment', entityId: id, patientId: a.patient_id, clinicId: a.clinic_id, reason: opts.reason ?? null });
    if (['checked_in', 'in_consultation', 'completed', 'cancelled', 'no_show'].includes(to)) await this.publishQueue(tx, a.clinic_id, a.doctor_id);
    return { appointment: updated, ticket };
  }

  /** Prepaid cancellation: refund request awaiting approval (clinic-initiated or outside cut-off) - FR-APT-4. */
  private async refundIfPrepaid(tx: Tx, actor: Principal | null, a: ApptRow, reason: string, clinicInitiated: boolean) {
    const policy = await this.policy(tx);
    const outsideCutoff = new Date(a.start_at).getTime() - Date.now() >= policy.cancellationCutoffHours * 3600_000;
    if (!clinicInitiated && !outsideCutoff) return;
    const payments = await tx.query<{ id: string; amount: number; refunded: number; clinic_id: string; patient_id: string }>(
      `select p.id, p.amount, p.refunded, p.clinic_id, p.patient_id from payments p join bills b on b.id = p.bill_id where b.appointment_id = $1 and p.method = 'healthpay' and p.status = 'captured'`,
      [a.id],
    );
    for (const p of payments) {
      const amount = p.amount - p.refunded;
      if (amount <= 0) continue;
      await tx.query(
        `insert into refunds (organisation_id, clinic_id, payment_id, patient_id, amount, reason, requested_by) values (app_org(), $1,$2,$3,$4,$5,$6)`,
        [p.clinic_id, p.id, p.patient_id, amount, `appointment_cancelled: ${reason}`.slice(0, 500), actor?.kind === 'staff' ? actor.userId : null],
      );
    }
  }

  async issueTicket(tx: Tx, a: ApptRow, priority: QueuePriority) {
    const date = localDate(new Date());
    const n = await tx.one<{ n: number }>(`select next_number($1) as n`, [`ticket:${a.doctor_id}:${date}`]);
    const t = await tx.one(
      `insert into queue_tickets (organisation_id, clinic_id, doctor_id, appointment_id, patient_id, queue_date, ticket_number, priority) values (app_org(), $1,$2,$3,$4,$5,$6,$7)
       on conflict (appointment_id) do update set status = 'waiting' returning *`,
      [a.clinic_id, a.doctor_id, a.id, a.patient_id, date, Number(n.n), priority],
    );
    const c = await this.context(tx, a.id);
    await this.messaging.enqueue(tx, { event: 'checkin_ticket', patientId: a.patient_id, clinicId: a.clinic_id, dedupeKey: `ticket:${a.id}`, channels: ['push'], vars: { ticket: Number(n.n), doctor: c.doctor } });
    return t;
  }

  async reschedule(tx: Tx, actor: Principal, meta: RequestMeta | null, id: string, startIso: string, reason?: string) {
    const a = await this.get(tx, id);
    if (!['requested', 'booked', 'confirmed'].includes(a.status)) throw new DomainError('not_reschedulable', HttpStatus.CONFLICT);
    const policy = await this.policy(tx);
    const isPatient = actor.kind === 'patient';
    if (isPatient) {
      if (a.reschedule_count >= policy.maxReschedules) throw new DomainError('reschedule_limit_reached', HttpStatus.CONFLICT);
      if (new Date(a.start_at).getTime() - Date.now() < policy.cancellationCutoffHours * 3600_000) throw new DomainError('inside_cutoff', HttpStatus.CONFLICT);
    }
    const start = new Date(startIso);
    const slots = await this.availability.slots(tx, { doctorIds: [a.doctor_id], clinicId: a.clinic_id, from: localDate(start), days: 1, channel: isPatient ? 'online' : 'desk', leadMinutes: isPatient ? policy.leadMinutes : 0 });
    const slot = slots.find((s) => s.start === start.toISOString());
    if (!slot) throw new DomainError('slot_not_offered', HttpStatus.CONFLICT);
    const used = new Set((await tx.query<{ used_slot_indexes: number }>('select used_slot_indexes from used_slot_indexes($1, $2, $3, $4)', [a.doctor_id, start, new Date(slot.end), id])).map((r) => r.used_slot_indexes));
    let updated: ApptRow | null = null;
    for (let i = 0; i < slot.capacity && !updated; i++) {
      if (used.has(i)) continue;
      await tx.query('savepoint resched');
      try {
        updated = await tx.one<ApptRow>(
          `update appointments set start_at = $2, end_at = $3, slot_index = $4, session_id = $5, reschedule_count = reschedule_count + 1, status = case when status = 'confirmed' then 'booked' else status end where id = $1 returning *`,
          [id, start, new Date(slot.end), i, sessionRef(slot.sessionId)],
        );
        await tx.query('release savepoint resched');
      } catch (e) {
        await tx.query('rollback to savepoint resched');
        if ((e as { code?: string }).code !== '23P01') throw e;
      }
    }
    if (!updated) throw conflict('slot_unavailable');
    await this.event(tx, a, a.status, updated.status, actor, reason ?? 'rescheduled');
    const c = await this.context(tx, id);
    await this.messaging.enqueue(tx, { event: 'rescheduled', patientId: a.patient_id, clinicId: a.clinic_id, dedupeKey: `resched:${id}:${start.toISOString()}`, vars: { doctor: c.doctor, clinic: c.clinic, date: formatDate(start), time: formatTime12(start, 'ar') } });
    await this.audit.record(tx, actor, meta, { action: 'appointment.reschedule', entity: 'appointment', entityId: id, patientId: a.patient_id, clinicId: a.clinic_id, details: { from: a.start_at, to: start } });
    return updated;
  }

  /** Walk-in: registered and checked in immediately, outside slot capacity (FR-APT-5). */
  async walkIn(tx: Tx, actor: Principal, meta: RequestMeta | null, b: { patientId: string; clinicId: string; doctorId: string; serviceIds: string[]; priority: QueuePriority; idempotencyKey?: string }) {
    if (b.idempotencyKey) {
      const prior = await tx.maybeOne<ApptRow>('select * from appointments where idempotency_key = $1', [b.idempotencyKey]);
      if (prior) return { appointment: prior, ticket: await tx.maybeOne('select * from queue_tickets where appointment_id = $1', [prior.id]), replayed: true };
    }
    const svc = await tx.query<{ duration_minutes: number }>('select duration_minutes from services where id = any($1::uuid[])', [b.serviceIds]);
    if (svc.length !== b.serviceIds.length) throw badRequest('invalid_service');
    const start = new Date();
    const end = new Date(start.getTime() + Math.max(...svc.map((s) => s.duration_minutes)) * 60000);
    const row = await tx.one<ApptRow>(
      `insert into appointments (organisation_id, clinic_id, doctor_id, patient_id, ref, start_at, end_at, status, channel, is_walk_in, created_by, idempotency_key) values (app_org(), $1,$2,$3,$4,$5,$6,'booked','walk_in',true,$7,$8) returning *`,
      [b.clinicId, b.doctorId, b.patientId, newRef(), start, end, actor.kind === 'staff' ? actor.userId : null, b.idempotencyKey ?? null],
    );
    for (const s of b.serviceIds) await tx.query('insert into appointment_services (organisation_id, appointment_id, service_id) values (app_org(), $1, $2)', [row.id, s]);
    await this.event(tx, row, null, 'booked', actor, 'walk_in');
    return this.transition(tx, actor, meta, row.id, 'checked_in', { priority: b.priority });
  }

  /** Waiting queue for a clinic/day, ordered by priority then check-in (FR-APT-5). */
  async queue(tx: Tx, clinicId: string, doctorId?: string | null, withNames = true) {
    const rows = await tx.query<{
      id: string; ticket_number: number; priority: QueuePriority; status: 'waiting' | 'called' | 'serving' | 'done' | 'skipped'; checked_in_at: Date; doctor_id: string; doctor_name: string; patient_name: string | null; appointment_id: string; patient_id: string;
    }>(
      `select q.id, q.ticket_number, q.priority, q.status, q.checked_in_at, q.doctor_id, u.name_ar as doctor_name, q.appointment_id, q.patient_id, (select e.id from encounters e where e.appointment_id = q.appointment_id) as encounter_id,
              ${withNames ? `p.first_name_ar || ' ' || p.father_name_ar` : 'null'} as patient_name
       from queue_tickets q join users u on u.id = q.doctor_id left join patients p on p.id = q.patient_id
       where q.clinic_id = $1 and q.queue_date = $2 and ($3::uuid is null or q.doctor_id = $3)
       order by q.ticket_number`,
      [clinicId, localDate(new Date()), doctorId ?? null],
    );
    const byDoctor = new Map<string, { doctorId: string; doctorName: string; serving: (typeof rows)[number] | null; called: (typeof rows)[number] | null; waiting: typeof rows; done: number }>();
    for (const r of rows) {
      const g = byDoctor.get(r.doctor_id) ?? { doctorId: r.doctor_id, doctorName: r.doctor_name, serving: null, called: null, waiting: [], done: 0 };
      if (r.status === 'serving') g.serving = r;
      else if (r.status === 'called') g.called = r;
      else if (r.status === 'done') g.done++;
      byDoctor.set(r.doctor_id, g);
    }
    for (const g of byDoctor.values()) {
      g.waiting = orderQueue(rows.filter((r) => r.doctor_id === g.doctorId).map((r) => ({ ...r, checkedInAt: new Date(r.checked_in_at).toISOString(), ticketNumber: r.ticket_number })));
    }
    return [...byDoctor.values()];
  }

  /** Display payload: ticket numbers only, never names (FR-APT-6). */
  async displayState(tx: Tx, clinicId: string) {
    const q = await this.queue(tx, clinicId, null, false);
    return q.map((g) => ({ doctorId: g.doctorId, doctorName: g.doctorName, nowServing: g.serving?.ticket_number ?? g.called?.ticket_number ?? null, next: g.waiting.slice(0, 3).map((w) => w.ticket_number) }));
  }

  async callNext(tx: Tx, actor: Principal, meta: RequestMeta | null, clinicId: string, doctorId: string) {
    const groups = await this.queue(tx, clinicId, doctorId);
    const g = groups[0];
    const next = g?.waiting[0];
    if (!next) throw new DomainError('queue_empty', HttpStatus.CONFLICT);
    await tx.query(`update queue_tickets set status = 'done', done_at = coalesce(done_at, now()) where doctor_id = $1 and queue_date = $2 and status = 'called'`, [doctorId, localDate(new Date())]);
    await tx.query(`update queue_tickets set status = 'called', called_at = now() where id = $1`, [next.id]);
    // "Your turn is near" (FR-APT-7) for the patient N positions away.
    const o = await tx.one<{ settings: { queueNotifyPositions?: number } }>('select settings from organisations where id = app_org()');
    const n = o.settings.queueNotifyPositions ?? 3;
    const target = g.waiting[n];
    if (target) {
      await tx.query('update queue_tickets set notified_near = true where id = $1 and not notified_near', [target.id]);
      await this.messaging.enqueue(tx, { event: 'turn_approaching', patientId: target.patient_id, clinicId, dedupeKey: `near:${target.id}`, vars: { position: n } });
    }
    await this.audit.record(tx, actor, meta, { action: 'queue.call_next', entity: 'queue_ticket', entityId: next.id, clinicId, patientId: next.patient_id });
    await this.publishQueue(tx, clinicId, doctorId);
    return { called: { id: next.id, ticketNumber: next.ticket_number, appointmentId: next.appointment_id } };
  }

  async publishQueue(tx: Tx, clinicId: string, doctorId: string) {
    if (tx.ctx.mode !== 'staff' && tx.ctx.mode !== 'system') return; // patient sessions cannot see the whole queue
    const state = await this.displayState(tx, clinicId);
    await this.events.publish(`queue:${clinicId}`, { type: 'queue', clinicId, doctorId, state, at: new Date().toISOString() });
  }

  /** Bookings occupying a slot; exposed for tests and the calendar. */
  static capacityStatuses = CAPACITY_STATUSES;
}
