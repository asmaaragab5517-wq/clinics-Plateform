import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { auth, nationalIdFor, patientLogin, startHarness, type Harness } from './harness';
import { AvailabilityService } from '../src/modules/availability.service';
import { Tenancy } from '../src/common/services';

let h: Harness;
let admin: Client;
const ctx: Record<string, string> = {};

beforeAll(async () => {
  h = await startHarness('hf_test_api_s15');
  admin = new Client({ connectionString: h.env.adminUrl });
  await admin.connect();
  const t = await patientLogin(h, '01088880001');
  ctx.token = t.accessToken;
  ctx.refresh = t.refreshToken;
  const p = await h.http().post('/v1/portal/patients').set(auth(ctx.token)).send({ relation: 'self', consentHealthData: true, patient: { nameAr: { first: 'ليلى', family: 'فؤاد' }, dateOfBirth: '1991-03-03', gender: 'female', nationalId: nationalIdFor('1991-03-03', 'female', 71), phones: [{ number: '01088880001', primary: true }] } });
  ctx.patient = p.body.id;
  ctx.consult = (await h.http().get('/v1/services').set(auth(h.staff.manager))).body.find((s: { code: string }) => s.code === 'CONS-IM').id;
}, 180000);
afterAll(async () => {
  await admin?.end();
  await h?.close();
});

describe('Dental chart (FR-EMR-3, R2)', () => {
  it('validates, stores per visit, merges across visits and prints', async () => {
    const visit = async () => {
      const w = await h.http().post('/v1/appointments/walk-in').set(auth(h.staff.reception)).send({ patientId: ctx.patient, clinicId: h.env.demo.clinicIds[0], doctorId: h.env.demo.doctorIds[0], serviceIds: [ctx.consult] });
      return (await admin.query('select id from encounters where appointment_id = $1', [w.body.appointment.id])).rows[0].id as string;
    };
    const e1 = await visit();
    const bad = await h.http().patch(`/v1/encounters/${e1}`).set(auth(h.staff.dr_ahmed)).send({ dentalChart: { teeth: [{ tooth: 11, conditions: [{ type: 'caries', surfaces: ['O'] }] }] } });
    expect(bad.status).toBe(400);
    await h.http().patch(`/v1/encounters/${e1}`).set(auth(h.staff.dr_ahmed)).send({ dentalChart: { teeth: [{ tooth: 16, conditions: [{ type: 'filling', surfaces: ['O'] }] }, { tooth: 36, conditions: [{ type: 'caries', surfaces: ['O', 'D'] }], planned: [{ procedure: 'root_canal' }] }] } }).expect(200);
    const e2 = await visit();
    await h.http().patch(`/v1/encounters/${e2}`).set(auth(h.staff.dr_ahmed)).send({ dentalChart: { teeth: [{ tooth: 36, conditions: [{ type: 'root_canal' }], planned: [{ procedure: 'root_canal', done: true }, { procedure: 'crown' }] }] } }).expect(200);
    const chart = await h.http().get(`/v1/patients/${ctx.patient}/dental-chart`).set(auth(h.staff.dr_sara));
    expect(chart.status).toBe(200);
    expect(chart.body.chart.teeth.map((t: { tooth: number }) => t.tooth)).toEqual([16, 36]);
    expect(chart.body.treatmentPlan).toEqual([{ tooth: 36, procedure: 'crown', done: false }]);
    expect((await h.http().get(`/v1/patients/${ctx.patient}/dental-chart`).set(auth(h.staff.reception))).status).toBe(403);
    const pdf = await h.http().get(`/v1/encounters/${e2}/summary.pdf`).set(auth(h.staff.dr_ahmed));
    expect(pdf.headers['content-type']).toBe('application/pdf');
  }, 60000);
});

describe('Next available cache, waitlist, retention, coverages, app return, push links', () => {
  it('caches next free slots for every doctor and supports a 30-day availableBy filter', async () => {
    const n = await h.app.get(Tenancy).system(h.env.demo.orgId, (tx) => h.app.get(AvailabilityService).refreshNextSlots(tx, 60));
    expect(n).toBeGreaterThan(0);
    const docs = await h.http().get('/v1/public/doctors').set('x-org', 'demo');
    expect(docs.body.every((d: { next_available: string | null }) => d.next_available)).toBe(true);
    const by = new Date(Date.now() + 25 * 86400000).toISOString().slice(0, 10);
    expect((await h.http().get(`/v1/public/doctors?availableBy=${by}`).set('x-org', 'demo')).body.length).toBe(docs.body.length);
  });

  it('lists and updates the waitlist', async () => {
    const w = await h.http().post('/v1/waitlist').set(auth(h.staff.reception)).send({ patientId: ctx.patient, clinicId: h.env.demo.clinicIds[0], doctorId: h.env.demo.doctorIds[0], earliest: '2026-12-01' });
    const list = await h.http().get(`/v1/waitlist?clinicId=${h.env.demo.clinicIds[0]}`).set(auth(h.staff.reception));
    expect(list.body.some((x: { id: string }) => x.id === w.body.id)).toBe(true);
    await h.http().patch(`/v1/waitlist/${w.body.id}`).set(auth(h.staff.reception)).send({ status: 'cancelled' }).expect(200);
    expect((await h.http().get('/v1/waitlist').set(auth(h.staff.reception))).body.some((x: { id: string }) => x.id === w.body.id)).toBe(false);
  });

  it('finds records past the retention period and anonymises only those, on explicit confirmation', async () => {
    const old = (await admin.query(`insert into patients (organisation_id, mrn, first_name_ar, date_of_birth, gender, created_at) values ($1, 'OLD-1', 'قديم', '1950-01-01', 'male', now() - interval '11 years') returning id`, [h.env.demo.orgId])).rows[0].id;
    const list = await h.http().get('/v1/privacy/retention-review').set(auth(h.staff.owner));
    expect(list.body.map((r: { id: string }) => r.id)).toContain(old);
    expect(list.body.map((r: { id: string }) => r.id)).not.toContain(ctx.patient);
    const noConfirm = await h.http().post('/v1/privacy/retention-review/anonymise').set(auth(h.staff.owner)).send({ patientIds: [old] });
    expect(noConfirm.status).toBe(400);
    const mixed = await h.http().post('/v1/privacy/retention-review/anonymise').set(auth(h.staff.owner)).send({ patientIds: [old, ctx.patient], confirm: true });
    expect(mixed.body).toMatchObject({ error: 'not_past_retention', details: { patientIds: [ctx.patient] } });
    const r = await h.http().post('/v1/privacy/retention-review/anonymise').set(auth(h.staff.owner)).send({ patientIds: [old], confirm: true });
    expect(r.body).toEqual({ anonymised: 1 });
    expect((await admin.query('select first_name_ar from patients where id = $1', [old])).rows[0].first_name_ar).toBe('مجهول');
  });

  it('shows the patient their insurance coverage in the portal', async () => {
    const payer = await h.http().post('/v1/insurance/payers').set(auth(h.staff.owner)).send({ code: 'AXA-EG', nameAr: 'أكسا', nameEn: 'AXA', kind: 'insurer' });
    const plan = await h.http().post('/v1/insurance/plans').set(auth(h.staff.owner)).send({ payerId: payer.body.id, name: 'Silver', coveragePercent: 70 });
    await h.http().post(`/v1/insurance/patients/${ctx.patient}/coverages`).set(auth(h.staff.reception)).send({ planId: plan.body.id, memberNumber: 'AX-1', validFrom: '2026-01-01' }).expect(201);
    const c = await h.http().get('/v1/portal/coverages').set(auth(ctx.token));
    expect(c.body[0]).toMatchObject({ member_number: 'AX-1', plan_name: 'Silver', payer_name_en: 'AXA', coverage_percent: 70 });
  });

  it('returns app bookings to the app and sends push notifications with deep links', async () => {
    const slots = await h.http().get(`/v1/public/slots?doctorId=${h.env.demo.doctorIds[0]}&serviceId=${ctx.consult}`).set('x-org', 'demo');
    const r = await h.http().post('/v1/portal/bookings').set(auth(ctx.token)).set('x-client', 'app').send({ clinicId: slots.body[0].clinicId, doctorId: h.env.demo.doctorIds[0], serviceId: ctx.consult, start: slots.body[0].start, patientId: ctx.patient, paymentMode: 'online' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const session = [...h.healthpay.sessions.values()].find((s) => s.orderId === r.body.payment.id)!;
    expect(session.returnUrl).toMatch(/^healthflow:\/\/book\/result\?ref=/);
    await h.http().post('/v1/portal/devices').set(auth(ctx.token)).send({ token: 'fcm-device-token-0123456789abcdef', platform: 'android' }).expect(201);
    const w = await h.http().post('/v1/appointments/walk-in').set(auth(h.staff.reception)).send({ patientId: ctx.patient, clinicId: h.env.demo.clinicIds[0], doctorId: h.env.demo.doctorIds[0], serviceIds: [ctx.consult] });
    const push = await admin.query(`select recipient, data from messages where patient_id = $1 and channel = 'push' and event = 'checkin_ticket' order by created_at desc limit 1`, [ctx.patient]);
    expect(push.rows[0]).toEqual({ recipient: 'fcm-device-token-0123456789abcdef', data: { path: `/appointments/${w.body.appointment.id}` } });
  });
});

describe('Custom patient fields (Sprint 16 follow-up)', () => {
  it('validates values against definitions, supports edit and delete', async () => {
    const def = await h.http().post('/v1/custom-fields').set(auth(h.staff.owner)).send({ key: 'blood_group', labelAr: 'فصيلة الدم', type: 'select', options: [{ value: 'A+', ar: 'A+', en: 'A+' }, { value: 'O+', ar: 'O+', en: 'O+' }] });
    expect(def.status).toBe(201);
    const bad = await h.http().patch(`/v1/patients/${ctx.patient}`).set(auth(h.staff.reception)).send({ customFields: { blood_group: 'Z', nope: 1 } });
    expect(bad.status).toBe(422);
    expect(bad.body.error).toBe('invalid_custom_fields');
    expect(bad.body.details.map((d: { key: string }) => d.key).sort()).toEqual(['blood_group', 'nope']);
    await h.http().patch(`/v1/patients/${ctx.patient}`).set(auth(h.staff.reception)).send({ customFields: { blood_group: 'O+' } }).expect(200);
    await h.http().patch(`/v1/custom-fields/${def.body.id}`).set(auth(h.staff.owner)).send({ required: true }).expect(200);
    const missing = await h.http().post('/v1/patients').set(auth(h.staff.reception)).send({ patient: { nameAr: { first: 'منى', family: 'سالم' }, dateOfBirth: '1990-01-01', gender: 'female', nationalId: nationalIdFor('1990-01-01', 'female', 72), phones: [{ number: '01088880072', primary: true }] } });
    expect(missing.status).toBe(422);
    expect(missing.body.details).toEqual([{ key: 'blood_group', error: 'required' }]);
    await h.http().patch(`/v1/custom-fields/${def.body.id}`).set(auth(h.staff.reception)).send({ required: false }).expect(403);
    await h.http().delete(`/v1/custom-fields/${def.body.id}`).set(auth(h.staff.owner)).expect(200);
    const list = await h.http().get('/v1/custom-fields').set(auth(h.staff.reception));
    expect(list.body.find((d: { key: string }) => d.key === 'blood_group')).toBeUndefined();
  });
});
