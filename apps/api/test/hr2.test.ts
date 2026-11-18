import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { Client } from 'pg';
import { auth, startHarness, type Harness } from './harness';
import { verifyClientIp } from '../src/bootstrap';

let h: Harness;
let admin: Client;
const id: Record<string, string> = {};
const pattern = { days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '23:59' }; // any day, so clocking always has a shift

beforeAll(async () => {
  h = await startHarness('hf_test_api_hr2');
  admin = new Client({ connectionString: h.env.adminUrl });
  await admin.connect();
  for (const k of ['owner', 'manager', 'reception', 'nurse', 'accountant']) {
    const me = await h.http().get('/v1/auth/me').set(auth(h.staff[k]!));
    id[k] = me.body.userId;
    if (k === 'manager') id.clinic = me.body.memberships.find((m: { clinicId: string | null }) => m.clinicId)?.clinicId;
  }
  await admin.query('update clinics set lat = 30.0566, lng = 31.3301 where id = $1', [id.clinic]);
  for (const k of ['reception', 'nurse'])
    await h.http().put(`/v1/hr/staff/${id[k]}/contract`).set(auth(h.staff.owner!)).send({
      clinicId: id.clinic, jobTitleAr: 'موظف', employmentType: 'full_time', payBasis: 'monthly', startDate: '2026-01-01', baseSalary: 800000, workPattern: pattern,
    }).expect(200);
}, 180000);
afterAll(async () => {
  await admin?.end();
  await h?.close();
});

describe('Sprint 20: clock-in location, overtime decisions, settings, previews', () => {
  it('verifies clocking by clinic network or geofence, flagging or blocking as configured', async () => {
    const rules = (b: object) => h.http().put(`/v1/hr/clinics/${id.clinic}/attendance-rules`).set(auth(h.staff.manager!)).send(b);
    expect((await rules({ mode: 'block', allowedNetworks: [], geofenceMeters: null })).body.error).toBe('no_location_rule');
    expect((await rules({ mode: 'block', allowedNetworks: ['300.1.1.0/24'], geofenceMeters: null })).body.error).toBe('invalid_network');

    // Block mode, geofence only: a position 290 m away is refused; one 96 m away is accepted and recorded.
    await rules({ mode: 'block', allowedNetworks: [], geofenceMeters: 100 }).expect(200);
    const far = await h.http().post('/v1/hr/attendance/clock').set(auth(h.staff.reception!)).send({ action: 'in', position: { lat: 30.0566, lng: 31.3331, accuracy: 15 } });
    expect(far.status).toBe(403);
    expect(far.body).toMatchObject({ error: 'clock_location_not_allowed', details: { method: 'gps', distance: 289 } });
    expect((await h.http().post('/v1/hr/attendance/clock').set(auth(h.staff.reception!)).send({ action: 'in' })).body.error).toBe('clock_location_not_allowed');
    const near = await h.http().post('/v1/hr/attendance/clock').set(auth(h.staff.reception!)).send({ action: 'in', position: { lat: 30.0566, lng: 31.3311, accuracy: 15 } });
    expect(near.status, JSON.stringify(near.body)).toBe(200);
    expect(near.body).toMatchObject({ clock_in_check: 'ok', clock_in_check_detail: { method: 'gps', distance: 96 } });

    // Flag mode with the clinic network: test requests come from 127.0.0.1, which is "inside"; a GPS miss is only flagged.
    await rules({ mode: 'flag', allowedNetworks: ['10.0.0.0/8'], geofenceMeters: 100 }).expect(200);
    const flagged = await h.http().post('/v1/hr/attendance/clock').set(auth(h.staff.nurse!)).send({ action: 'in', position: { lat: 30.07, lng: 31.35, accuracy: 10 } });
    expect(flagged.status).toBe(200);
    expect(flagged.body.clock_in_check).toBe('outside');
    await rules({ mode: 'flag', allowedNetworks: ['127.0.0.0/8', '::1/128'], geofenceMeters: null }).expect(200);
    const out = await h.http().post('/v1/hr/attendance/clock').set(auth(h.staff.nurse!)).send({ action: 'out' });
    expect(out.body).toMatchObject({ clock_out_check: 'ok', clock_out_check_detail: { method: 'network' } });
    // Raw coordinates are never stored.
    const raw = await admin.query('select clock_in_check_detail::text as d from attendance_records where user_id = $1', [id.nurse]);
    expect(raw.rows[0].d).not.toMatch(/30\.07|31\.35/);
    await rules({ mode: 'off', allowedNetworks: [], geofenceMeters: null }).expect(200);
    // A clinic manager cannot read or change another clinic's rules.
    const other = (await admin.query('select id from clinics where organisation_id = $1 and id <> $2 limit 1', [h.env.demo.orgId, id.clinic])).rows[0].id;
    await h.http().put(`/v1/hr/clinics/${other}/attendance-rules`).set(auth(h.staff.manager!)).send({ mode: 'off', allowedNetworks: [], geofenceMeters: null }).expect(404);
    await h.http().get(`/v1/hr/clinics/${other}/attendance-rules`).set(auth(h.staff.manager!)).expect(404);
    await h.http().put(`/v1/hr/clinics/${other}/attendance-rules`).set(auth(h.staff.owner!)).send({ mode: 'off', allowedNetworks: [], geofenceMeters: null }).expect(200);
    const net = await h.http().get('/v1/hr/my-network').set(auth(h.staff.manager!));
    expect(net.body.suggestedRange).toMatch(/^(127\.0\.0\.1\/32|::1\/128)$/);
  });

  it('accepts only properly signed client addresses from the web proxies', () => {
    const secret = 's'.repeat(40);
    const ts = Math.floor(Date.now() / 1000);
    const sig = createHmac('sha256', secret).update(`197.32.10.5|${ts}`).digest('hex');
    expect(verifyClientIp(`197.32.10.5|${ts}|${sig}`, secret)).toBe('197.32.10.5');
    expect(verifyClientIp(`197.32.10.6|${ts}|${sig}`, secret)).toBeNull(); // address swapped
    expect(verifyClientIp(`197.32.10.5|${ts}|${sig}`, 't'.repeat(40))).toBeNull(); // wrong secret
    expect(verifyClientIp(`197.32.10.5|${ts}|${sig}`, secret, (ts + 120) * 1000)).toBeNull(); // too old
  });

  it('records explicit overtime decisions and resets them when times are corrected', async () => {
    const rec = await h.http().put('/v1/hr/attendance').set(auth(h.staff.manager!)).send({ userId: id.reception, workDate: '2026-10-03', clockIn: '09:00', clockOut: '23:59', reason: 'late shift cover' });
    expect(rec.body.overtime_minutes).toBe(0); // the test pattern ends at 23:59
    await admin.query(`update attendance_records set overtime_minutes = 90 where id = $1`, [rec.body.id]);
    await h.http().post(`/v1/hr/attendance/${rec.body.id}/overtime`).set(auth(h.staff.manager!)).send({ approved: false }).expect(200);
    let row = (await admin.query('select overtime_status, overtime_approved, overtime_decided_by from attendance_records where id = $1', [rec.body.id])).rows[0];
    expect(row).toMatchObject({ overtime_status: 'rejected', overtime_approved: false, overtime_decided_by: id.manager });
    await h.http().put('/v1/hr/attendance').set(auth(h.staff.manager!)).send({ userId: id.reception, workDate: '2026-10-03', clockIn: '09:00', clockOut: '22:00', reason: 'corrected' }).expect(200);
    row = (await admin.query('select overtime_status, overtime_decided_by from attendance_records where id = $1', [rec.body.id])).rows[0];
    expect(row).toMatchObject({ overtime_status: 'pending', overtime_decided_by: null });
  });

  it('stores only HR setting overrides and can reset to defaults', async () => {
    const saved = await h.http().patch('/v1/hr/settings').set(auth(h.staff.owner!)).send({ graceMinutes: 10, daysPerMonth: 30 });
    expect(saved.body.graceMinutes).toBe(10);
    const stored = (await admin.query(`select settings->'hr' as hr from organisations where id = $1`, [h.env.demo.orgId])).rows[0].hr;
    expect(stored).toEqual({ graceMinutes: 10 }); // 30 equals the default, so it is not pinned
    const bad = await h.http().patch('/v1/hr/settings').set(auth(h.staff.owner!)).send({ socialInsurance: { year: 2026, employeeRate: 0.11, employerRate: 0.1875, minWage: 500000, maxWage: 100000 } });
    expect(bad.body.error).toBe('insurable_wage_limits_invalid');
    const reset = await h.http().delete('/v1/hr/settings').set(auth(h.staff.owner!));
    expect(reset.body.graceMinutes).toBe(15);
  });

  it('previews leave days and remaining balance, and lists payroll people without HR access', async () => {
    const types = (await h.http().get('/v1/hr/leave-types').set(auth(h.staff.reception!))).body as { id: string; code: string }[];
    const casual = types.find((t) => t.code === 'casual')!.id;
    const pv = await h.http().get(`/v1/hr/leave-preview?leaveTypeId=${casual}&startDate=2026-12-01&endDate=2026-12-02`).set(auth(h.staff.reception!));
    expect(pv.body).toMatchObject({ days: 2, available: 15, remainingAfter: 13, quota: 7, quotaRemainingAfter: 5, maxConsecutiveDays: 2 });
    await h.http().get(`/v1/hr/leave-preview?leaveTypeId=${casual}&startDate=2026-12-01&endDate=2026-12-02&userId=${id.nurse}`).set(auth(h.staff.reception!)).expect(403);
    const people = await h.http().get('/v1/payroll/people').set(auth(h.staff.accountant!));
    expect(people.body.map((x: { id: string }) => x.id).sort()).toEqual([id.nurse, id.reception].sort());
    await h.http().get('/v1/payroll/people').set(auth(h.staff.manager!)).expect(403);
  });
});
