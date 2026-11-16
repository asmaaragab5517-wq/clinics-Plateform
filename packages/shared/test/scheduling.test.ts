import { describe, expect, it } from 'vitest';
import { canTransitionAppointment, computeSlots, orderQueue, queuePosition, startOfWeek, zonedToUtc, formatTime12, localDate, type SessionDef } from '../src';

const base: SessionDef = {
  id: 's1', doctorId: 'd1', clinicId: 'c1', weekdays: [6, 0, 1, 2, 3, 4], startTime: '17:00', endTime: '19:00',
  slotMinutes: 30, capacityPerSlot: 1, walkInReserved: 0, effectiveFrom: '2026-01-01', profileId: null,
};

describe('Cairo time (FR-SCH-4)', () => {
  it('handles winter (UTC+2) and summer DST (UTC+3)', () => {
    expect(zonedToUtc('2026-01-10', '17:00').toISOString()).toBe('2026-01-10T15:00:00.000Z');
    expect(zonedToUtc('2026-07-10', '17:00').toISOString()).toBe('2026-07-10T14:00:00.000Z');
  });
  it('week starts on Saturday', () => {
    expect(startOfWeek('2026-11-16')).toBe('2026-11-14'); // Monday → Saturday
    expect(startOfWeek('2026-11-14')).toBe('2026-11-14');
    expect(startOfWeek('2026-11-20')).toBe('2026-11-14'); // Friday
  });
  it('formats 12h Arabic time', () => {
    expect(formatTime12(new Date('2026-01-10T15:30:00Z'), 'ar')).toBe('5:30 م');
    expect(localDate(new Date('2026-01-10T23:30:00Z'))).toBe('2026-01-11');
  });
});

describe('availability engine', () => {
  it('generates slots, skipping Friday', () => {
    const slots = computeSlots({ from: '2026-11-19', days: 2, sessions: [base] }); // Thu, Fri
    expect(slots).toHaveLength(4);
    expect(slots[0]!.date).toBe('2026-11-19');
  });
  it('subtracts bookings, leaves, breaks and holidays', () => {
    const first = zonedToUtc('2026-11-21', '17:00').toISOString();
    const slots = computeSlots({
      from: '2026-11-21', days: 3,
      sessions: [{ ...base, breaks: [{ start: '18:00', end: '18:30' }] }],
      bookedCounts: new Map([[first, 1]]),
      exceptions: [
        { kind: 'leave', doctorId: 'd1', date: '2026-11-22', startTime: '17:00', endTime: '18:00' },
        { kind: 'holiday', clinicId: 'c1', date: '2026-11-23' },
      ],
    });
    const sat = slots.filter((s) => s.date === '2026-11-21');
    expect(sat.map((s) => s.localStart)).toEqual(['17:00', '17:30', '18:30']);
    expect(sat[0]!.available).toBe(0);
    expect(slots.filter((s) => s.date === '2026-11-22').map((s) => s.localStart)).toEqual(['18:30']);
    expect(slots.filter((s) => s.date === '2026-11-23')).toHaveLength(0);
  });
  it('reserves walk-in capacity from online channel only', () => {
    const s = { ...base, walkInReserved: 1 };
    expect(computeSlots({ from: '2026-11-21', days: 1, sessions: [s], channel: 'online' })).toHaveLength(3);
    expect(computeSlots({ from: '2026-11-21', days: 1, sessions: [s], channel: 'desk', overbookPerSlot: 1 })[0]!.capacity).toBe(2);
  });
  it('Ramadan profile replaces base schedule within its range', () => {
    const ramadan: SessionDef = { ...base, id: 's2', startTime: '20:00', endTime: '21:00', profileId: 'p1' };
    const slots = computeSlots({ from: '2027-02-13', days: 1, sessions: [base, ramadan], profiles: [{ id: 'p1', from: '2027-02-08', to: '2027-03-09' }] });
    expect(slots.map((s) => s.localStart)).toEqual(['20:00', '20:30']);
  });
});

describe('state machine and queue', () => {
  it('enforces transitions', () => {
    expect(canTransitionAppointment('booked', 'confirmed')).toBe(true);
    expect(canTransitionAppointment('completed', 'cancelled')).toBe(false);
    expect(canTransitionAppointment('requested', 'checked_in')).toBe(false);
  });
  it('orders queue by priority then check-in', () => {
    const q = [
      { id: 'a', ticketNumber: 1, priority: 'normal' as const, checkedInAt: '2026-01-01T10:00:00Z', status: 'waiting' as const },
      { id: 'b', ticketNumber: 2, priority: 'elderly' as const, checkedInAt: '2026-01-01T10:05:00Z', status: 'waiting' as const },
      { id: 'c', ticketNumber: 3, priority: 'normal' as const, checkedInAt: '2026-01-01T09:00:00Z', status: 'done' as const },
    ];
    expect(orderQueue(q).map((e) => e.id)).toEqual(['b', 'a']);
    expect(queuePosition(q, 'a')).toBe(2);
    expect(queuePosition(q, 'c')).toBeNull();
  });
});
