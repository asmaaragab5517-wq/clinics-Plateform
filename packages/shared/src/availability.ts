import { addDays, minutesOf, timeOf, weekdayOf, zonedToUtc } from './datetime';

export interface SessionDef {
  id: string;
  doctorId: string;
  clinicId: string;
  weekdays: number[]; // 0=Sun..6=Sat
  startTime: string; // HH:mm local
  endTime: string;
  slotMinutes: number;
  capacityPerSlot: number; // max bookings per slot
  walkInReserved: number; // slots per session kept for walk-ins (not bookable online)
  breaks?: { start: string; end: string }[];
  effectiveFrom: string; // YYYY-MM-DD
  effectiveTo?: string | null;
  profileId?: string | null; // null = base schedule; else belongs to a schedule profile (e.g. Ramadan)
  serviceIds?: string[] | null;
}

export interface ScheduleProfileDef {
  id: string;
  from: string;
  to: string;
}

export interface ExceptionDef {
  /** leave = doctor unavailable; holiday = clinic closed; extra = ad-hoc extra session */
  kind: 'leave' | 'holiday' | 'extra';
  doctorId?: string | null; // null for clinic holiday
  clinicId?: string | null;
  date: string;
  startTime?: string | null; // partial day when set
  endTime?: string | null;
  session?: Omit<SessionDef, 'weekdays' | 'effectiveFrom' | 'effectiveTo'>;
}

export interface Slot {
  sessionId: string;
  doctorId: string;
  clinicId: string;
  date: string;
  localStart: string;
  start: string; // ISO UTC
  end: string;
  capacity: number;
  booked: number;
  available: number;
}

export interface AvailabilityQuery {
  from: string;
  days: number;
  sessions: SessionDef[];
  profiles?: ScheduleProfileDef[];
  exceptions?: ExceptionDef[];
  /** Map of slot start ISO → count of bookings already occupying capacity. */
  bookedCounts?: Map<string, number>;
  /** Online channels cannot use walk-in reserved capacity. */
  channel?: 'online' | 'desk';
  /** Earliest bookable instant (lead time). */
  notBefore?: Date;
  /** Overbooking: extra bookings per slot allowed at the desk. */
  overbookPerSlot?: number;
  serviceId?: string;
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Compute bookable slots (FR-SCH-1..4). Pure: callers load sessions, exceptions and booking counts.
 * Schedule profiles (e.g. Ramadan) replace the base schedule of a doctor for their date range.
 */
export function computeSlots(q: AvailabilityQuery): Slot[] {
  const out: Slot[] = [];
  const profiles = q.profiles ?? [];
  const exceptions = q.exceptions ?? [];
  for (let i = 0; i < q.days; i++) {
    const date = addDays(q.from, i);
    const wd = weekdayOf(date);
    const activeProfiles = new Set(profiles.filter((p) => p.from <= date && date <= p.to).map((p) => p.id));
    const clinicHoliday = (clinicId: string) =>
      exceptions.some((e) => e.kind === 'holiday' && e.date === date && (!e.clinicId || e.clinicId === clinicId) && !e.startTime);

    // Doctors with an active profile session on this date use only profile sessions.
    const doctorsWithProfile = new Set(
      q.sessions.filter((s) => s.profileId && activeProfiles.has(s.profileId)).map((s) => s.doctorId),
    );
    const daySessions: (Omit<SessionDef, 'weekdays' | 'effectiveFrom' | 'effectiveTo'>)[] = q.sessions.filter((s) => {
      if (!s.weekdays.includes(wd)) return false;
      if (s.effectiveFrom > date || (s.effectiveTo && s.effectiveTo < date)) return false;
      if (s.profileId) return activeProfiles.has(s.profileId);
      return !doctorsWithProfile.has(s.doctorId);
    });
    for (const e of exceptions) if (e.kind === 'extra' && e.date === date && e.session) daySessions.push(e.session);

    for (const s of daySessions) {
      if (q.serviceId && s.serviceIds && s.serviceIds.length && !s.serviceIds.includes(q.serviceId)) continue;
      if (clinicHoliday(s.clinicId)) continue;
      const blocks = exceptions
        .filter(
          (e) =>
            e.date === date &&
            ((e.kind === 'leave' && e.doctorId === s.doctorId) ||
              (e.kind === 'holiday' && (!e.clinicId || e.clinicId === s.clinicId))),
        )
        .map((e) => [e.startTime ? minutesOf(e.startTime) : 0, e.endTime ? minutesOf(e.endTime) : 24 * 60] as const);
      const breaks = (s.breaks ?? []).map((b) => [minutesOf(b.start), minutesOf(b.end)] as const);
      const start = minutesOf(s.startTime);
      const end = minutesOf(s.endTime);
      const sessionSlots: Slot[] = [];
      for (let t = start; t + s.slotMinutes <= end; t += s.slotMinutes) {
        const tEnd = t + s.slotMinutes;
        if (blocks.some(([a, b]) => overlaps(t, tEnd, a, b))) continue;
        if (breaks.some(([a, b]) => overlaps(t, tEnd, a, b))) continue;
        const startAt = zonedToUtc(date, timeOf(t));
        const endAt = zonedToUtc(date, timeOf(tEnd));
        if (q.notBefore && startAt < q.notBefore) continue;
        const iso = startAt.toISOString();
        const booked = q.bookedCounts?.get(`${s.doctorId}|${iso}`) ?? q.bookedCounts?.get(iso) ?? 0;
        const capacity = s.capacityPerSlot + (q.channel === 'desk' ? (q.overbookPerSlot ?? 0) : 0);
        sessionSlots.push({
          sessionId: s.id,
          doctorId: s.doctorId,
          clinicId: s.clinicId,
          date,
          localStart: timeOf(t),
          start: iso,
          end: endAt.toISOString(),
          capacity,
          booked,
          available: Math.max(0, capacity - booked),
        });
      }
      // Walk-in reservation: online channel cannot book the last N slots of the session.
      if (q.channel !== 'desk' && s.walkInReserved > 0) {
        sessionSlots.splice(Math.max(0, sessionSlots.length - s.walkInReserved));
      }
      out.push(...sessionSlots);
    }
  }
  return out.sort((a, b) => a.start.localeCompare(b.start) || a.doctorId.localeCompare(b.doctorId));
}
