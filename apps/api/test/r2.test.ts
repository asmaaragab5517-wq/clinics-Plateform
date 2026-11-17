import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { auth, nationalIdFor, patientLogin, startHarness, type Harness } from './harness';
import { PaymentsService, simulateHealthPay } from '../src/modules/payments';
import { CalendarSyncService } from '../src/modules/telemedicine';
import { FakeGoogleClient, GOOGLE } from '../src/integrations/google';

let h: Harness;
let admin: Client;
const ctx: Record<string, string> = {};

beforeAll(async () => {
  h = await startHarness('hf_test_api_r2');
  admin = new Client({ connectionString: h.env.adminUrl });
  await admin.connect();
}, 180000);
afterAll(async () => {
  await admin?.end();
  await h?.close();
});

describe('Telemedicine (BR-13, FR-TEL-1..4)', () => {
  it('manager sets up a prepaid video consultation service', async () => {
    const svc = await h.http().post('/v1/services').set(auth(h.staff.manager)).send({ code: 'TELE-IM', name: { ar: 'استشارة فيديو باطنة', en: 'Video consultation (IM)' }, durationMinutes: 20, type: 'telemedicine', vat: 'exempt' });
    expect(svc.status, JSON.stringify(svc.body)).toBe(201);
    ctx.tele = svc.body.id;
    ctx.clinic = h.env.demo.clinicIds[0]!;
    await h.http().post('/v1/prices').set(auth(h.staff.manager)).send({ clinicId: ctx.clinic, serviceId: ctx.tele, price: 30000, effectiveFrom: '2026-01-01' }).expect(201);
    const existing = await h.http().get('/v1/doctors').set(auth(h.staff.manager));
    const ahmed = existing.body.find((d: { id: string }) => d.id === h.env.demo.doctorIds[0]);
    await h.http().put(`/v1/doctors/${ahmed.id}/services`).set(auth(h.staff.director)).send({ serviceIds: [...ahmed.service_ids, ctx.tele] }).expect(200);
  });

  it('refuses pay-at-clinic and books with online payment', async () => {
    const t = await patientLogin(h, '01055550001');
    ctx.token = t.accessToken;
    const p = await h.http().post('/v1/portal/patients').set(auth(ctx.token)).send({ relation: 'self', consentHealthData: true, patient: { nameAr: { first: 'هالة', family: 'سمير' }, dateOfBirth: '1988-08-08', gender: 'female', nationalId: nationalIdFor('1988-08-08', 'female', 51), phones: [{ number: '01055550001', primary: true }] } });
    ctx.patient = p.body.id;
    const slots = await h.http().get(`/v1/public/slots?doctorId=${h.env.demo.doctorIds[0]}&serviceId=${ctx.tele}&clinicId=${ctx.clinic}`).set('x-org', 'demo');
    const base = { clinicId: ctx.clinic, doctorId: h.env.demo.doctorIds[0], serviceId: ctx.tele, start: slots.body[0].start, patientId: ctx.patient };
    const atClinic = await h.http().post('/v1/portal/bookings').set(auth(ctx.token)).send({ ...base, paymentMode: 'at_clinic' });
    expect(atClinic.body.error).toBe('telemedicine_requires_online_payment');
    const r = await h.http().post('/v1/portal/bookings').set(auth(ctx.token)).send({ ...base, paymentMode: 'online' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    ctx.appt = r.body.appointment.id;
    const orderId = [...h.healthpay.sessions.entries()].find(([, s]) => s.amount === 30000)![0];
    await simulateHealthPay(h.healthpay, h.app.get(PaymentsService), orderId);
  });

  it('opens the waiting room only from T-10 min and needs telemedicine consent', async () => {
    const early = await h.http().post(`/v1/portal/appointments/${ctx.appt}/telemedicine/join`).set(auth(ctx.token));
    expect(early.body.error).toBe('waiting_room_not_open');
    await admin.query(`update appointments set start_at = now() + interval '5 minutes', end_at = now() + interval '25 minutes' where id = $1`, [ctx.appt]);
    const noConsent = await h.http().post(`/v1/portal/appointments/${ctx.appt}/telemedicine/join`).set(auth(ctx.token));
    expect(noConsent.body.error).toBe('telemedicine_consent_required');
    const consents = await h.http().get('/v1/portal/consents').set(auth(ctx.token));
    const v = consents.body.versions.find((x: { type: string }) => x.type === 'telemedicine');
    await h.http().post('/v1/portal/consents').set(auth(ctx.token)).send({ patientId: ctx.patient, type: 'telemedicine', granted: true, versionId: v.id }).expect(201);
    const join = await h.http().post(`/v1/portal/appointments/${ctx.appt}/telemedicine/join`).set(auth(ctx.token));
    expect(join.status, JSON.stringify(join.body)).toBe(200);
    expect(join.body.url).toContain('/join/');
    const status = await h.http().get(`/v1/portal/appointments/${ctx.appt}/telemedicine`).set(auth(ctx.token));
    expect(status.body.status).toBe('patient_waiting');
  });

  it('only the appointment doctor starts the call; the encounter is documented as usual', async () => {
    const other = await h.http().post(`/v1/telemedicine/${ctx.appt}/start`).set(auth(h.staff.dr_mona));
    expect(other.status).toBe(403);
    const list = await h.http().get('/v1/telemedicine').set(auth(h.staff.dr_ahmed));
    expect(list.body.find((x: { appointment_id: string }) => x.appointment_id === ctx.appt).status).toBe('patient_waiting');
    const start = await h.http().post(`/v1/telemedicine/${ctx.appt}/start`).set(auth(h.staff.dr_ahmed));
    expect(start.status, JSON.stringify(start.body)).toBe(200);
    expect(start.body.url).toContain('/host/');
    expect(start.body.encounterId).toBeTruthy();
    const a = await h.http().get(`/v1/appointments/${ctx.appt}`).set(auth(h.staff.dr_ahmed));
    expect(a.body.status).toBe('in_consultation');
    const host = await admin.query('select host_url_enc from telemedicine_sessions where appointment_id = $1', [ctx.appt]);
    expect(host.rows[0].host_url_enc.toString()).not.toContain('https://'); // links encrypted at rest
  });
});

describe('Google Calendar one-way sync (FR-INT-2)', () => {
  it('connects with a signed single-use state and syncs without patient names', async () => {
    const c = await h.http().post('/v1/integrations/google/connect').set(auth(h.staff.dr_ahmed));
    const state = new URL(c.body.url).searchParams.get('state')!;
    const forged = await h.http().get(`/v1/integrations/google/callback?code=abc&state=${encodeURIComponent(state.replace(/.$/, 'x'))}`);
    expect(forged.headers.location).toContain('google=error');
    const ok = await h.http().get(`/v1/integrations/google/callback?code=abc&state=${encodeURIComponent(state)}`);
    expect(ok.headers.location).toContain('google=connected');
    const replay = await h.http().get(`/v1/integrations/google/callback?code=abc&state=${encodeURIComponent(state)}`);
    expect(replay.headers.location).toContain('google=error');
    const st = await h.http().get('/v1/integrations/google').set(auth(h.staff.dr_ahmed));
    expect(st.body.connected).toBe(true);
    const svc = h.app.get(CalendarSyncService);
    const { Tenancy } = await import('../src/common/services');
    const changed = await h.app.get(Tenancy).system(h.env.demo.orgId, (tx) => svc.syncOrg(tx));
    expect(changed).toBeGreaterThan(0);
    const events = [...(h.app.get(GOOGLE) as FakeGoogleClient).events.values()];
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => !e.summary.includes('هالة'))).toBe(true);
    const again = await h.app.get(Tenancy).system(h.env.demo.orgId, (tx) => svc.syncOrg(tx));
    expect(again).toBe(0);
    await h.http().delete('/v1/integrations/google').set(auth(h.staff.dr_ahmed)).expect(200);
    expect((h.app.get(GOOGLE) as FakeGoogleClient).events.size).toBe(0);
  });
});
