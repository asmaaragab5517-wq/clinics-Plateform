import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { auth, nationalIdFor, patientLogin, startHarness, type Harness } from './harness';

let h: Harness;
let admin: Client;
const ctx: Record<string, string> = {};

beforeAll(async () => {
  h = await startHarness('hf_test_api_s18');
  admin = new Client({ connectionString: h.env.adminUrl });
  await admin.connect();
  const t = await patientLogin(h, '01088880181');
  ctx.token = t.accessToken;
  ctx.refresh = t.refreshToken;
  const p = await h.http().post('/v1/portal/patients').set(auth(ctx.token)).send({ relation: 'self', consentHealthData: true, patient: { nameAr: { first: 'رنا', family: 'سمير' }, dateOfBirth: '1990-05-05', gender: 'female', nationalId: nationalIdFor('1990-05-05', 'female', 181), phones: [{ number: '01088880181', primary: true }] } });
  ctx.patient = p.body.id;
  // A refreshed token carries the new patient link.
  ctx.token = (await h.http().post('/v1/auth/refresh').send({ refreshToken: ctx.refresh })).body.accessToken;
  const services = (await h.http().get('/v1/services').set(auth(h.staff.manager))).body as { id: string; code: string }[];
  ctx.consult = services.find((s) => s.code === 'CONS-IM')!.id;
  ctx.clinic = h.env.demo.clinicIds[0]!;
}, 180000);
afterAll(async () => {
  await admin?.end();
  await h?.close();
});

describe('Sprint 18 API follow-ups', () => {
  it('lets a doctor edit and delete only their own visit templates', async () => {
    const t = await h.http().post('/v1/encounter-templates').set(auth(h.staff.dr_ahmed)).send({ nameAr: 'ضغط', sections: ['notes'] });
    expect(t.status).toBe(201);
    const upd = await h.http().patch(`/v1/encounter-templates/${t.body.id}`).set(auth(h.staff.dr_ahmed)).send({ nameAr: 'متابعة ضغط', commonDiagnoses: ['I10'] });
    expect(upd.body.name_ar).toBe('متابعة ضغط');
    expect(upd.body.common_diagnoses).toEqual(['I10']);
    await h.http().patch(`/v1/encounter-templates/${t.body.id}`).set(auth(h.staff.dr_sara)).send({ nameAr: 'x x' }).expect(403);
    await h.http().delete(`/v1/encounter-templates/${t.body.id}`).set(auth(h.staff.dr_sara)).expect(403);
    await h.http().delete(`/v1/encounter-templates/${t.body.id}`).set(auth(h.staff.dr_ahmed)).expect(200);
  });

  it('clears a visit dental chart with null, records revocation details and exposes the visit id', async () => {
    await h.http().post(`/v1/patients/${ctx.patient}/consents`).set(auth(h.staff.reception)).send({ consents: { health_data: true } });
    const w = await h.http().post('/v1/appointments/walk-in').set(auth(h.staff.reception)).send({ patientId: ctx.patient, clinicId: ctx.clinic, doctorId: h.env.demo.doctorIds[0], serviceIds: [ctx.consult] });
    const appt = await h.http().get(`/v1/appointments/${w.body.appointment.id}`).set(auth(h.staff.reception));
    expect(appt.body.encounter_id).toMatch(/^[0-9a-f-]{36}$/);
    const enc = appt.body.encounter_id as string;
    await h.http().patch(`/v1/encounters/${enc}`).set(auth(h.staff.dr_ahmed)).send({ dentalChart: { teeth: [{ tooth: 16, conditions: [{ type: 'caries', surfaces: ['O'] }] }] } }).expect(200);
    const cleared = await h.http().patch(`/v1/encounters/${enc}`).set(auth(h.staff.dr_ahmed)).send({ dentalChart: null });
    expect(cleared.body.dental_chart).toBeNull();
    const kept = await h.http().patch(`/v1/encounters/${enc}`).set(auth(h.staff.dr_ahmed)).send({ notes: 'x' });
    expect(kept.body.dental_chart).toBeNull();

    const drug = (await h.http().get('/v1/drugs?q=Pana').set(auth(h.staff.dr_ahmed))).body[0];
    const rx = await h.http().post(`/v1/encounters/${enc}/prescriptions`).set(auth(h.staff.dr_ahmed)).send({ lines: [{ drugId: drug.id, dose: '500 mg', frequency: 'tid', durationDays: 3 }] });
    await h.http().post(`/v1/prescriptions/${rx.body.id}/issue`).set(auth(h.staff.dr_ahmed)).send({ acknowledgeWarnings: true }).expect(200);
    await h.http().post(`/v1/prescriptions/${rx.body.id}/revoke`).set(auth(h.staff.dr_ahmed)).send({ reason: 'Wrong dose entered' }).expect(200);
    const detail = await h.http().get(`/v1/prescriptions/${rx.body.id}`).set(auth(h.staff.dr_ahmed));
    expect(detail.body.status).toBe('revoked');
    expect(detail.body.revoked_reason).toBe('Wrong dose entered');
    expect(detail.body.revoked_at).toBeTruthy();
  });

  it('keeps patient-submitted insurance out of billing until staff verify it', async () => {
    const payer = await h.http().post('/v1/insurance/payers').set(auth(h.staff.owner)).send({ code: 'AXA-EG', nameAr: 'أكسا', nameEn: 'AXA', kind: 'insurer' });
    const plan = await h.http().post('/v1/insurance/plans').set(auth(h.staff.owner)).send({ payerId: payer.body.id, name: 'Silver', coveragePercent: 50 });
    const list = await h.http().get('/v1/portal/payers').set(auth(ctx.token));
    expect(list.body.find((x: { id: string }) => x.id === payer.body.id).plans).toEqual([{ id: plan.body.id, name: 'Silver' }]);

    const other = await h.http().post('/v1/portal/coverages').set(auth(ctx.token)).send({ patientId: '00000000-0000-7000-8000-000000000000', planId: plan.body.id, memberNumber: 'AX-1', validFrom: '2026-01-01' });
    expect(other.status).toBe(403);
    const sub = await h.http().post('/v1/portal/coverages').set(auth(ctx.token)).send({ patientId: ctx.patient, planId: plan.body.id, memberNumber: 'AX-12345', validFrom: '2026-01-01' });
    expect(sub.status, JSON.stringify(sub.body)).toBe(201);
    const mine = await h.http().get('/v1/portal/coverages').set(auth(ctx.token));
    expect(mine.body[0]).toMatchObject({ id: sub.body.id, source: 'patient', verified: false });

    const unverifiedBill = await h.http().post('/v1/bills').set(auth(h.staff.reception)).send({ clinicId: ctx.clinic, patientId: ctx.patient, coverageId: sub.body.id, lines: [{ serviceId: ctx.consult, qty: 1 }] });
    expect(unverifiedBill.body.error).toBe('coverage_not_valid');
    const queue = await h.http().get('/v1/insurance/coverages/unverified').set(auth(h.staff.reception));
    expect(queue.body.map((x: { id: string }) => x.id)).toContain(sub.body.id);
    await h.http().post(`/v1/insurance/coverages/${sub.body.id}/verify`).set(auth(h.staff.reception)).send({ approve: true }).expect(200);
    const bill = await h.http().post('/v1/bills').set(auth(h.staff.reception)).send({ clinicId: ctx.clinic, patientId: ctx.patient, coverageId: sub.body.id, lines: [{ serviceId: ctx.consult, qty: 1 }] });
    expect(bill.status, JSON.stringify(bill.body)).toBe(201);
    expect(bill.body.insurer_share).toBe(20000);
    const task = await admin.query(`select status from tasks where kind = 'coverage_verify' and entity_id = $1`, [sub.body.id]);
    expect(task.rows[0].status).toBe('done');
    await h.http().post(`/v1/portal/coverages/${sub.body.id}/withdraw`).set(auth(ctx.token)).expect(404); // verified cover cannot be withdrawn by the patient

    // Withdrawn and rejected submissions are told apart, and withdrawing closes the reception task.
    const w = await h.http().post('/v1/portal/coverages').set(auth(ctx.token)).send({ patientId: ctx.patient, planId: plan.body.id, memberNumber: 'AX-W', validFrom: '2026-01-01' });
    await h.http().post(`/v1/portal/coverages/${w.body.id}/withdraw`).set(auth(ctx.token)).expect(200);
    await h.http().post(`/v1/portal/coverages/${w.body.id}/withdraw`).set(auth(ctx.token)).expect(404);
    expect((await admin.query(`select status from tasks where kind = 'coverage_verify' and entity_id = $1`, [w.body.id])).rows[0].status).toBe('done');
    const rj = await h.http().post('/v1/portal/coverages').set(auth(ctx.token)).send({ patientId: ctx.patient, planId: plan.body.id, memberNumber: 'AX-R', validFrom: '2026-01-01' });
    await h.http().post(`/v1/insurance/coverages/${rj.body.id}/verify`).set(auth(h.staff.reception)).send({ approve: false }).expect(200);
    const statuses = Object.fromEntries((await h.http().get('/v1/portal/coverages').set(auth(ctx.token))).body.map((c: { id: string; status: string }) => [c.id, c.status]));
    expect([statuses[sub.body.id], statuses[w.body.id], statuses[rj.body.id]]).toEqual(['verified', 'withdrawn', 'rejected']);

    const plan2 = await h.http().patch(`/v1/insurance/plans/${plan.body.id}`).set(auth(h.staff.owner)).send({ name: 'Silver Plus', annualLimit: 5000000, typeOverrides: { procedure: 30 } });
    expect(plan2.body).toMatchObject({ name: 'Silver Plus', type_overrides: { procedure: 30 } });
    const payer2 = await h.http().patch(`/v1/insurance/payers/${payer.body.id}`).set(auth(h.staff.owner)).send({ code: 'AXA-EGY', kind: 'tpa' });
    expect(payer2.body).toMatchObject({ code: 'AXA-EGY', kind: 'tpa' });
  });

  it('marks waitlist offers, shows the service, finds partial file numbers and returns the doctor\'s specialties', async () => {
    const wl = await h.http().post('/v1/waitlist').set(auth(h.staff.reception)).send({ patientId: ctx.patient, clinicId: ctx.clinic, doctorId: h.env.demo.doctorIds[0], serviceId: ctx.consult, earliest: '2030-01-01' });
    await h.http().patch(`/v1/waitlist/${wl.body.id}`).set(auth(h.staff.reception)).send({ status: 'offered', notify: true, slot: 'الأحد 10:00' }).expect(200);
    const msg = await admin.query(`select body from messages where patient_id = $1 and event = 'waitlist_offer' limit 1`, [ctx.patient]);
    expect(msg.rows[0].body).toContain('الأحد 10:00');
    await h.http().patch(`/v1/waitlist/${wl.body.id}`).set(auth(h.staff.reception)).send({ status: 'booked', notify: true }).expect(400);
    const offered = await h.http().get('/v1/waitlist?status=offered').set(auth(h.staff.reception));
    const row = offered.body.find((x: { id: string }) => x.id === wl.body.id);
    expect(row.offered_at).toBeTruthy();
    expect(row.service_name_en).toBe('Internal medicine consultation');

    const mrn = (await admin.query('select mrn from patients where id = $1', [ctx.patient])).rows[0].mrn as string;
    const found = await h.http().get(`/v1/patients?q=${encodeURIComponent(mrn.slice(0, -1))}`).set(auth(h.staff.reception));
    expect(found.body.results ?? found.body).toEqual(expect.arrayContaining([expect.objectContaining({ id: ctx.patient })]));

    const me = await h.http().get('/v1/auth/me').set(auth(h.staff.dr_ahmed));
    expect(me.body.specialties.map((s: { slug: string }) => s.slug)).toEqual(['internal-medicine']);
  });
});
