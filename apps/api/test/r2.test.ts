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

describe('ETA e-receipts, insurance and interactions (FR-BIL-10, FR-BIL-11, FR-RX-3)', () => {
  it('flags drug-drug interactions in the prescription builder', async () => {
    const services = await h.http().get('/v1/services').set(auth(h.staff.manager));
    ctx.consult = services.body.find((s: { code: string }) => s.code === 'CONS-IM').id;
    const walk = await h.http().post('/v1/appointments/walk-in').set(auth(h.staff.reception)).send({ patientId: ctx.patient, clinicId: ctx.clinic, doctorId: h.env.demo.doctorIds[0], serviceIds: [ctx.consult] });
    expect(walk.status, JSON.stringify(walk.body)).toBe(201);
    ctx.walkAppt = walk.body.appointment.id;
    const enc = (await admin.query('select id from encounters where appointment_id = $1', [ctx.walkAppt])).rows[0].id;
    const brufen = (await h.http().get('/v1/drugs?q=Brufen').set(auth(h.staff.dr_ahmed))).body[0].id;
    const voltaren = (await h.http().get('/v1/drugs?q=Voltaren').set(auth(h.staff.dr_ahmed))).body[0].id;
    const rx = await h.http().post(`/v1/encounters/${enc}/prescriptions`).set(auth(h.staff.dr_ahmed)).send({ lines: [
      { drugId: brufen, dose: '400 mg', frequency: 'tid' }, { drugId: voltaren, dose: '50 mg', frequency: 'bid' },
    ] });
    const w = rx.body.warnings.find((x: { kind: string }) => x.kind === 'interaction');
    expect(w).toMatchObject({ severity: 'moderate' });
  });

  it('queues a chained ETA e-receipt when a bill is paid and submits it with retry', async () => {
    const le = (await h.http().get('/v1/legal-entities').set(auth(h.staff.owner))).body[0];
    await h.http().put(`/v1/legal-entities/${le.id}/eta`).set(auth(h.staff.owner)).send({
      mode: 'preprod', clientId: 'client', clientSecret: 'secret', posSerial: 'POS-1', rin: '123456789', activityCode: '8620', companyTradeName: 'HealthFlow',
      address: { governate: 'Cairo', regionCity: 'Nasr City', street: 'x', buildingNumber: '1' },
    }).expect(200);
    await h.http().post('/v1/shifts').set(auth(h.staff.reception)).send({ clinicId: ctx.clinic, openingFloat: 0 }).expect(201);
    const uuids: string[] = [];
    for (let i = 0; i < 2; i++) {
      const bill = await h.http().post('/v1/bills').set(auth(h.staff.reception)).send({ clinicId: ctx.clinic, patientId: ctx.patient, lines: [{ serviceId: ctx.consult, qty: 1 }] });
      await h.http().post(`/v1/bills/${bill.body.id}/issue`).set(auth(h.staff.reception)).expect(200);
      await h.http().post(`/v1/bills/${bill.body.id}/payments`).set(auth(h.staff.reception)).send({ method: 'cash', amount: 40000 }).expect(201);
      const r = (await admin.query('select uuid, previous_uuid, status from eta_receipts where bill_id = $1', [bill.body.id])).rows[0];
      expect(r.uuid).toMatch(/^[0-9a-f]{64}$/);
      uuids.push(r.uuid);
      if (i === 1) expect(r.previous_uuid).toBe(uuids[0]);
      ctx.etaBill = bill.body.id;
    }
    const { EtaService } = await import('../src/modules/eta');
    const { ETA } = await import('../src/integrations/eta');
    const { Tenancy } = await import('../src/common/services');
    (h.app.get(ETA) as import('../src/integrations/eta').FakeEtaClient).failNext = 1;
    await h.app.get(Tenancy).system(h.env.demo.orgId, (tx) => h.app.get(EtaService).submitDue(tx));
    expect((await admin.query(`select count(*)::int as n from eta_receipts where status = 'failed' and next_attempt_at > now()`)).rows[0].n).toBe(2);
    await admin.query('update eta_receipts set next_attempt_at = now()');
    const ok = await h.app.get(Tenancy).system(h.env.demo.orgId, (tx) => h.app.get(EtaService).submitDue(tx));
    expect(ok).toBe(2);
    const dash = await h.http().get('/v1/eta/receipts').set(auth(h.staff.accountant));
    expect(dash.body.summary).toEqual([{ status: 'valid', n: 2 }]);
    const pdf = await h.http().get(`/v1/bills/${ctx.etaBill}/invoice.pdf`).set(auth(h.staff.reception));
    expect(pdf.headers['content-type']).toBe('application/pdf');
  }, 60000);

  it('splits a bill with insurance coverage and settles the payer share through a claim batch', async () => {
    const payer = await h.http().post('/v1/insurance/payers').set(auth(h.staff.owner)).send({ code: 'MISR-INS', nameAr: 'مصر للتأمين', nameEn: 'Misr Insurance', kind: 'insurer' });
    const plan = await h.http().post('/v1/insurance/plans').set(auth(h.staff.owner)).send({ payerId: payer.body.id, name: 'Gold', coveragePercent: 80, copayFixed: 5000, requiresApproval: true });
    const cov = await h.http().post(`/v1/insurance/patients/${ctx.patient}/coverages`).set(auth(h.staff.reception)).send({ planId: plan.body.id, memberNumber: 'MI-778899', validFrom: '2026-01-01' });
    expect(cov.status, JSON.stringify(cov.body)).toBe(201);
    const noApproval = await h.http().post('/v1/bills').set(auth(h.staff.reception)).send({ clinicId: ctx.clinic, patientId: ctx.patient, coverageId: cov.body.id, lines: [{ serviceId: ctx.consult, qty: 1 }] });
    expect(noApproval.body.error).toBe('approval_number_required');
    const bill = await h.http().post('/v1/bills').set(auth(h.staff.reception)).send({ clinicId: ctx.clinic, patientId: ctx.patient, coverageId: cov.body.id, approvalNumber: 'APR-1', lines: [{ serviceId: ctx.consult, qty: 1 }] });
    expect(bill.body.insurer_share).toBe(32000 - 5000);
    await h.http().post(`/v1/bills/${bill.body.id}/issue`).set(auth(h.staff.reception)).expect(200);
    const tooMuch = await h.http().post(`/v1/bills/${bill.body.id}/payments`).set(auth(h.staff.reception)).send({ method: 'cash', amount: 40000 });
    expect(tooMuch.body.error).toBe('amount_exceeds_patient_share');
    const share = await h.http().post(`/v1/bills/${bill.body.id}/payments`).set(auth(h.staff.reception)).send({ method: 'cash', amount: 13000 });
    expect(share.body.billStatus).toBe('partially_paid');
    const today = new Date().toISOString().slice(0, 10);
    const batch = await h.http().post('/v1/insurance/claim-batches').set(auth(h.staff.accountant)).send({ payerId: payer.body.id, from: '2026-01-01', to: '2031-01-01' });
    expect(batch.status, JSON.stringify(batch.body)).toBe(201);
    expect(batch.body.total).toBe(27000);
    const csv = await h.http().get(`/v1/insurance/claim-batches/${batch.body.id}/export.csv`).set(auth(h.staff.accountant));
    expect(csv.text).toContain('MI-778899');
    expect(csv.text).toContain('APR-1');
    await h.http().post(`/v1/insurance/claim-batches/${batch.body.id}/submit`).set(auth(h.staff.accountant)).expect(200);
    const settled = await h.http().post(`/v1/insurance/claim-batches/${batch.body.id}/settle`).set(auth(h.staff.accountant)).send({ reference: 'REMIT-1', items: [{ billId: bill.body.id, paidAmount: 27000 }] });
    expect(settled.status, JSON.stringify(settled.body)).toBe(200);
    expect(settled.body.status).toBe('paid');
    const final = await h.http().get(`/v1/bills/${bill.body.id}`).set(auth(h.staff.reception));
    expect(final.body.status).toBe('paid');
    void today;
  }, 60000);
});
