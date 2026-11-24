import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, startHarness, type Harness } from './harness';

let h: Harness;
const id: Record<string, string> = {};

beforeAll(async () => {
  h = await startHarness('hf_test_api_hr3');
  for (const k of ['owner', 'manager', 'nurse']) {
    const me = await h.http().get('/v1/auth/me').set(auth(h.staff[k]!));
    id[k] = me.body.userId;
    if (k === 'manager') id.clinic = me.body.memberships.find((m: { clinicId: string | null }) => m.clinicId)?.clinicId;
  }
  // Split shift every day: 09:00–21:00 with 13:00–17:00 off (8 paid hours).
  const r = await h.http().put(`/v1/hr/staff/${id.nurse}/contract`).set(auth(h.staff.owner!)).send({
    clinicId: id.clinic, jobTitleAr: 'ممرضة', employmentType: 'full_time', payBasis: 'monthly', startDate: '2026-01-01', baseSalary: 960000,
    workPattern: { days: [0, 1, 2, 3, 4, 5, 6], start: '09:00', end: '21:00', breakStart: '13:00', breakEnd: '17:00' },
  });
  if (r.status !== 200) throw new Error(JSON.stringify(r.body));
}, 180000);
afterAll(async () => {
  await h?.close();
});

describe('split shifts and several clock-in pairs', () => {
  it('lets staff clock out for the break and back in, once per open pair', async () => {
    const clock = (action: 'in' | 'out') => h.http().post('/v1/hr/attendance/clock').set(auth(h.staff.nurse!)).send({ action });
    expect((await clock('in')).status).toBe(200);
    expect((await clock('in')).body.error).toBe('already_clocked_in');
    expect((await clock('out')).body.status).toBe('complete');
    const back = await clock('in');
    expect(back.status).toBe(200);
    expect(back.body.punches).toHaveLength(2);
    expect(back.body.clock_out).toBeNull();
    const done = await clock('out');
    expect(done.body.punches.every((p: { out: string | null }) => p.out)).toBe(true);
  });

  it('corrects a split day with pairs and measures a late return from the break', async () => {
    const r = await h.http().put('/v1/hr/attendance').set(auth(h.staff.manager!)).send({
      userId: id.nurse, workDate: '2026-10-03', reason: 'From the paper sheet',
      punches: [{ in: '09:05', out: '13:00' }, { in: '17:25', out: '21:00' }],
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    // 5 minutes late is within grace; returning 25 minutes late from the break is not.
    expect(r.body).toMatchObject({ late_minutes: 25, early_leave_minutes: 0, worked_minutes: 450, overtime_minutes: 0 }); // 235 + 215
    expect((await h.http().put('/v1/hr/attendance').set(auth(h.staff.manager!)).send({ userId: id.nurse, workDate: '2026-10-04', reason: 'x x x', punches: [{ in: '09:00', out: null }, { in: '17:00', out: '21:00' }] })).body.error).toBe('only_last_pair_may_be_open');
    expect((await h.http().put('/v1/hr/attendance').set(auth(h.staff.manager!)).send({ userId: id.nurse, workDate: '2026-10-04', reason: 'x x x', clockIn: '09:00', punches: [{ in: '09:00', out: '21:00' }] })).body.error).toBe('use_punches_or_clock_times');
    // A pattern whose break falls outside the day is refused.
    const bad = await h.http().put(`/v1/hr/staff/${id.nurse}/contract`).set(auth(h.staff.owner!)).send({
      clinicId: id.clinic, jobTitleAr: 'ممرضة', employmentType: 'full_time', payBasis: 'monthly', startDate: '2026-01-01', baseSalary: 960000,
      workPattern: { days: [6], start: '09:00', end: '21:00', breakStart: '21:30', breakEnd: '22:00' },
    });
    expect(bad.status).toBe(400);
  });
});

describe('what the app must send when clocking', () => {
  it('reports a position check only while the clinic uses a radius', async () => {
    const me = () => h.http().get('/v1/hr/me').set(auth(h.staff.nurse!));
    expect((await me()).body.clockCheck).toEqual({ mode: 'off', usesPosition: false, usesNetwork: false });
    await h.http().patch(`/v1/clinics/${id.clinic}`).set(auth(h.staff.owner!)).send({ lat: 30.05, lng: 31.24 });
    const put = await h.http().put(`/v1/hr/clinics/${id.clinic}/attendance-rules`).set(auth(h.staff.owner!)).send({ mode: 'flag', allowedNetworks: ['10.0.0.0/8'], geofenceMeters: 200 });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    const body = (await me()).body;
    expect(body.clockCheck).toEqual({ mode: 'flag', usesPosition: true, usesNetwork: true });
    expect(JSON.stringify(body)).not.toContain('10.0.0.0'); // the networks and coordinates stay private
    expect(JSON.stringify(body)).not.toContain('31.24');
    await h.http().put(`/v1/hr/clinics/${id.clinic}/attendance-rules`).set(auth(h.staff.owner!)).send({ mode: 'off', allowedNetworks: [], geofenceMeters: null });
  });
});
