import { Injectable } from '@nestjs/common';
import type { Tx } from '@hf/db';
import { addDays, computeSlots, zonedToUtc, type ExceptionDef, type SessionDef, type Slot } from '@hf/shared';

export interface SlotQuery {
  doctorIds: string[];
  clinicId?: string | null;
  serviceId?: string | null;
  from: string;
  days: number;
  channel: 'online' | 'desk';
  leadMinutes?: number;
}

@Injectable()
export class AvailabilityService {
  async slots(tx: Tx, q: SlotQuery): Promise<Slot[]> {
    if (!q.doctorIds.length) return [];
    const to = addDays(q.from, q.days - 1);
    const sessions = await tx.query<{
      id: string; doctor_id: string; clinic_id: string; profile_id: string | null; weekdays: number[]; start_time: string; end_time: string; slot_minutes: number;
      capacity_per_slot: number; walk_in_reserved: number; overbook_per_slot: number; breaks: { start: string; end: string }[]; service_ids: string[]; effective_from: string; effective_to: string | null;
    }>(
      `select * from doctor_sessions where is_active and doctor_id = any($1::uuid[]) and ($2::uuid is null or clinic_id = $2)
         and effective_from <= $4::date and (effective_to is null or effective_to >= $3::date)`,
      [q.doctorIds, q.clinicId ?? null, q.from, to],
    );
    if (!sessions.length) return [];
    const profiles = await tx.query<{ id: string; date_from: string; date_to: string }>('select id, date_from, date_to from schedule_profiles where date_to >= $1 and date_from <= $2', [q.from, to]);
    const exceptions = await tx.query<{ kind: ExceptionDef['kind']; doctor_id: string | null; clinic_id: string | null; date: string; start_time: string | null; end_time: string | null; session: SessionDef | null }>(
      `select kind, doctor_id, clinic_id, date, start_time, end_time, session from schedule_exceptions
       where date between $1 and $2 and (doctor_id is null or doctor_id = any($3::uuid[]))`,
      [q.from, to, q.doctorIds],
    );
    const booked = await tx.query<{ doctor_id: string; start_at: Date; booked: number }>('select * from slot_booked_counts($1, $2, $3)', [
      q.doctorIds,
      zonedToUtc(q.from, '00:00'),
      zonedToUtc(addDays(to, 1), '00:00'),
    ]);
    const bookedCounts = new Map(booked.map((b) => [`${b.doctor_id}|${new Date(b.start_at).toISOString()}`, Number(b.booked)]));
    const hhmm = (t: string | null) => (t ? t.slice(0, 5) : null);
    const defs: SessionDef[] = sessions.map((s) => ({
      id: s.id, doctorId: s.doctor_id, clinicId: s.clinic_id, weekdays: s.weekdays, startTime: hhmm(s.start_time)!, endTime: hhmm(s.end_time)!, slotMinutes: s.slot_minutes,
      capacityPerSlot: s.capacity_per_slot, walkInReserved: s.walk_in_reserved, breaks: s.breaks, effectiveFrom: s.effective_from, effectiveTo: s.effective_to, profileId: s.profile_id, serviceIds: s.service_ids,
    }));
    const overbook = Math.max(0, ...sessions.map((s) => s.overbook_per_slot));
    return computeSlots({
      from: q.from,
      days: q.days,
      sessions: defs,
      profiles: profiles.map((p) => ({ id: p.id, from: p.date_from, to: p.date_to })),
      exceptions: exceptions.map((e) => ({ kind: e.kind, doctorId: e.doctor_id, clinicId: e.clinic_id, date: e.date, startTime: hhmm(e.start_time), endTime: hhmm(e.end_time), session: e.session ?? undefined })),
      bookedCounts,
      channel: q.channel,
      overbookPerSlot: overbook,
      notBefore: new Date(Date.now() + (q.leadMinutes ?? 0) * 60000),
      serviceId: q.serviceId ?? undefined,
    });
  }

  /** Effective price for a service at a clinic on a date (doctor override first) - FR-ORG-3. */
  async price(tx: Tx, clinicId: string, serviceId: string, doctorId: string | null, date: string): Promise<number | null> {
    const r = await tx.maybeOne<{ price: number }>(
      `select price from price_list_items where clinic_id = $1 and service_id = $2 and (doctor_id = $3 or doctor_id is null)
         and effective_from <= $4::date and (effective_to is null or effective_to >= $4::date)
       order by doctor_id nulls last limit 1`,
      [clinicId, serviceId, doctorId, date],
    );
    return r?.price ?? null;
  }
}
