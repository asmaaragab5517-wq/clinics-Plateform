import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { localDate } from '@hf/shared';
import { auth, nationalIdFor, patientLogin, startHarness, type Harness } from './harness';
import { simulateHealthPay } from '../src/modules/payments';
import { PaymentsService } from '../src/modules/payments';

let h: Harness;
const ctx: Record<string, string> = {};

beforeAll(async () => {
  h = await startHarness('hf_test_api_e2e');
}, 180000);
afterAll(async () => h?.close());

describe('R1 acceptance: online patient journey (SRS §11.1)', () => {
  let patientToken = '';
  it('patient signs in with OTP and registers', async () => {
    const t = await patientLogin(h, '01011112222');
    patientToken = t.accessToken;
    const r = await h.http().post('/v1/portal/patients').set(auth(patientToken)).send({
      relation: 'self', consentHealthData: true,
      patient: { nameAr: { first: 'منى', father: 'أحمد', family: 'حسن' }, dateOfBirth: '1990-05-12', gender: 'female', phones: [{ number: '01011112222', primary: true }], nationalId: nationalIdFor('1990-05-12', 'female', 41) },
    });
    expect(r.status).toBe(201);
    ctx.patientId = r.body.id;
    // New links take effect on the next token (patient ids are resolved per request).
    const me = await h.http().get('/v1/portal/me').set(auth(patientToken));
    expect(me.body.patients).toHaveLength(1);
  });

  it('finds a doctor and free slots in Arabic', async () => {
    const docs = await h.http().get('/v1/public/doctors?specialty=internal-medicine').set('x-org', 'demo');
    expect(docs.status).toBe(200);
    const d = docs.body[0];
    expect(d.name_ar).toContain('أحمد');
    ctx.doctorId = d.id;
    const detail = await h.http().get(`/v1/public/doctors/${d.slug}`).set('x-org', 'demo');
    ctx.serviceId = detail.body.services.find((s: { type: string }) => s.type === 'consultation').id;
    const slots = await h.http().get(`/v1/public/slots?doctorId=${d.id}&serviceId=${ctx.serviceId}`).set('x-org', 'demo');
    expect(slots.body.length).toBeGreaterThan(0);
    ctx.start = slots.body[0].start;
    ctx.clinicId = slots.body[0].clinicId;
  });

  it('books with online payment, holds the slot, and the HealthPay webhook confirms it', async () => {
    const r = await h.http().post('/v1/portal/bookings').set(auth(patientToken)).set('idempotency-key', 'k1').send({ clinicId: ctx.clinicId, doctorId: ctx.doctorId, serviceId: ctx.serviceId, start: ctx.start, patientId: ctx.patientId, paymentMode: 'online' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.appointment.status).toBe('requested');
    expect(r.body.payment.amount).toBe(40000);
    ctx.appointmentId = r.body.appointment.id;
    // Idempotent retry returns the same appointment.
    const again = await h.http().post('/v1/portal/bookings').set(auth(patientToken)).set('idempotency-key', 'k1').send({ clinicId: ctx.clinicId, doctorId: ctx.doctorId, serviceId: ctx.serviceId, start: ctx.start, patientId: ctx.patientId, paymentMode: 'online' });
    expect(again.body.appointment.id).toBe(ctx.appointmentId);
    // The held slot is no longer offered.
    const slots = await h.http().get(`/v1/public/slots?doctorId=${ctx.doctorId}&serviceId=${ctx.serviceId}`).set('x-org', 'demo');
    expect(slots.body.find((s: { start: string }) => s.start === ctx.start)).toBeUndefined();

    const providerOrderId = [...h.healthpay.sessions.entries()].find(([, s]) => s.amount === 40000)![0];
    await simulateHealthPay(h.healthpay, h.app.get(PaymentsService), providerOrderId);
    // Duplicate delivery is ignored.
    const dup = await h.app.get(PaymentsService).handleWebhook({ id: `txn_${providerOrderId}`, type: 'payment.captured', orderId: h.healthpay.sessions.get(providerOrderId)!.orderId, amount: 40000, occurredAt: new Date().toISOString() });
    expect(dup).toBe('duplicate');

    const list = await h.http().get('/v1/portal/appointments').set(auth(patientToken));
    expect(list.body.find((a: { id: string }) => a.id === ctx.appointmentId).status).toBe('booked');
    const inv = await h.http().get('/v1/portal/invoices').set(auth(patientToken));
    expect(inv.body[0].status).toBe('paid');
    expect(h.sms.sent.some((m) => m.body.includes('تم تأكيد موعدك') || m.channel === 'whatsapp')).toBeDefined();
  });

  it('rejects a forged webhook signature', async () => {
    const r = await h.http().post('/v1/webhooks/healthpay').set('x-healthpay-signature', 't=1,v1=00').send({ id: 'x', type: 'payment.captured', orderId: ctx.appointmentId, amount: 1 });
    expect(r.status).toBe(403);
  });

  it('enforces OTP attempt limits and refresh-token reuse detection', async () => {
    const req = await h.http().post('/v1/auth/otp/request').set('x-org', 'demo').send({ phone: '01099998888' });
    for (let i = 0; i < 3; i++) await h.http().post('/v1/auth/otp/verify').set('x-org', 'demo').send({ phone: '01099998888', code: '000000' === req.body.devCode ? '111111' : '000000' });
    const blocked = await h.http().post('/v1/auth/otp/verify').set('x-org', 'demo').send({ phone: '01099998888', code: req.body.devCode });
    expect(blocked.body.error).toBe('otp_attempts_exceeded');
    const tooSoon = await h.http().post('/v1/auth/otp/request').set('x-org', 'demo').send({ phone: '01099998888' });
    expect(tooSoon.status).toBe(429);

    const t = await patientLogin(h, '01044445555');
    const r1 = await h.http().post('/v1/auth/refresh').set('x-org', 'demo').send({ refreshToken: t.refreshToken });
    expect(r1.status).toBe(200);
    const reuse = await h.http().post('/v1/auth/refresh').set('x-org', 'demo').send({ refreshToken: t.refreshToken });
    expect(reuse.body.error).toBe('refresh_token_reused');
    const after = await h.http().post('/v1/auth/refresh').set('x-org', 'demo').send({ refreshToken: r1.body.refreshToken });
    expect(after.status).toBe(401);
  });
});

describe('R1 acceptance: reception, doctor, cashier (SRS §11.2-11.3)', () => {
  it('registers a walk-in with National ID validation and duplicate detection', async () => {
    const bad = await h.http().post('/v1/patients').set(auth(h.staff.reception)).send({ patient: { nameAr: { first: 'كريم', family: 'محمود' }, dateOfBirth: '1985-03-03', gender: 'male', nationalId: '28503030112345', phones: [{ number: '01222223333' }] } });
    expect(bad.status).toBe(400); // DOB/gender digits mismatch the NID
    const nid = nationalIdFor('1985-03-03', 'male', 77);
    const body = { patient: { nameAr: { first: 'كريم', father: 'سعيد', family: 'محمود' }, dateOfBirth: '1985-03-03', gender: 'male', nationalId: nid, phones: [{ number: '01222223333', primary: true }] }, consents: { healthData: true, messaging: true } };
    const ok = await h.http().post('/v1/patients').set(auth(h.staff.reception)).send(body);
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.mrn).toMatch(/^HF-\d{6}$/);
    ctx.walkInPatient = ok.body.id;
    const dup = await h.http().post('/v1/patients').set(auth(h.staff.reception)).send(body);
    expect(dup.status).toBe(409);
    expect(dup.body.details[0].reason).toBe('national_id');
    const search = await h.http().get(`/v1/patients?q=${encodeURIComponent('كريم محمود')}`).set(auth(h.staff.reception));
    expect(search.body.some((p: { id: string }) => p.id === ctx.walkInPatient)).toBe(true);
    const byNid = await h.http().get(`/v1/patients?q=${nid}`).set(auth(h.staff.reception));
    expect(byNid.body[0].id).toBe(ctx.walkInPatient);
  });

  it('issues a queue ticket and the waiting-room display updates (ticket numbers only)', async () => {
    const services = await h.http().get('/v1/services').set(auth(h.staff.manager));
    ctx.consult = services.body.find((s: { code: string }) => s.code === 'CONS-IM').id;
    const clinics = await h.http().get('/v1/clinics').set(auth(h.staff.reception));
    ctx.nc = clinics.body[0].id;
    const r = await h.http().post('/v1/appointments/walk-in').set(auth(h.staff.reception)).send({ patientId: ctx.walkInPatient, clinicId: ctx.nc, doctorId: h.env.demo.doctorIds[0], serviceIds: [ctx.consult], priority: 'normal' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.ticket.ticket_number).toBe(1);
    ctx.walkInAppt = r.body.appointment.id;
    const tok = await h.http().post(`/v1/clinics/${ctx.nc}/display-token`).set(auth(h.staff.reception));
    const display = await h.http().get('/v1/display/state').set(auth(tok.body.token));
    expect(display.status).toBe(200);
    expect(JSON.stringify(display.body)).not.toContain('كريم');
    expect(display.body[0].next).toEqual([1]);
  });

  it('doctor calls next, documents, signs off and issues a bilingual prescription with QR', async () => {
    const called = await h.http().post('/v1/queue/call-next').set(auth(h.staff.dr_ahmed)).send({ clinicId: ctx.nc, doctorId: h.env.demo.doctorIds[0] });
    expect(called.status, JSON.stringify(called.body)).toBe(200);
    expect(called.body.called.ticketNumber).toBe(1);
    await h.http().post(`/v1/appointments/${ctx.walkInAppt}/transition`).set(auth(h.staff.dr_ahmed)).send({ to: 'in_consultation' }).expect(200);
    const appt = await h.http().get(`/v1/appointments/${ctx.walkInAppt}`).set(auth(h.staff.dr_ahmed));
    expect(appt.body.status).toBe('in_consultation');
    const enc = (await h.env && (await (async () => {
      const c = new Client({ connectionString: h.env.adminUrl });
      await c.connect();
      const r = await c.query('select id from encounters where appointment_id = $1', [ctx.walkInAppt]);
      await c.end();
      return r.rows[0].id as string;
    })()));
    ctx.encounter = enc;
    await h.http().post(`/v1/encounters/${enc}/vitals`).set(auth(h.staff.nurse)).send({ systolic: 130, diastolic: 85, weightKg: 80, heightCm: 175 }).expect(200);
    await h.http().post(`/v1/patients/${ctx.walkInPatient}/history`).set(auth(h.staff.dr_ahmed)).send({ kind: 'allergy', text: 'Penicillin', ingredient: 'amoxicillin', severity: 'severe' }).expect(201);
    const upd = await h.http().patch(`/v1/encounters/${enc}`).set(auth(h.staff.dr_ahmed)).send({ chiefComplaint: 'صداع ودوخة', diagnoses: [{ code: 'I10', primary: true }], notes: 'متابعة الضغط', followUp: { date: '2026-12-20' } });
    expect(upd.status, JSON.stringify(upd.body)).toBe(200);
    expect(upd.body.vitals.bmi).toBe(26.1);
    const drugs = await h.http().get('/v1/drugs?q=Aug').set(auth(h.staff.dr_ahmed));
    const conc = await h.http().get('/v1/drugs?q=Concor').set(auth(h.staff.dr_ahmed));
    const rx = await h.http().post(`/v1/encounters/${enc}/prescriptions`).set(auth(h.staff.dr_ahmed)).send({
      lines: [
        { drugId: conc.body[0].id, dose: '5 mg', frequency: 'مرة يوميًا', durationDays: 30, instructionsAr: 'قرص مرة يوميًا صباحًا', instructionsEn: 'One tablet every morning' },
        { drugId: drugs.body[0].id, dose: '1 g', frequency: 'bid', durationDays: 5, instructionsAr: 'قرص مرتين يوميًا بعد الأكل', instructionsEn: 'One tablet twice daily after meals' },
      ],
    });
    expect(rx.status).toBe(201);
    expect(rx.body.warnings.some((w: { kind: string }) => w.kind === 'allergy')).toBe(true);
    const blocked = await h.http().post(`/v1/prescriptions/${rx.body.id}/issue`).set(auth(h.staff.dr_ahmed)).send({});
    expect(blocked.body.error).toBe('warnings_not_acknowledged');
    const issued = await h.http().post(`/v1/prescriptions/${rx.body.id}/issue`).set(auth(h.staff.dr_ahmed)).send({ acknowledgeWarnings: true });
    expect(issued.status).toBe(200);
    ctx.rx = rx.body.id;
    ctx.verifyCode = issued.body.verify_code;
    const signed = await h.http().post(`/v1/encounters/${enc}/sign`).set(auth(h.staff.dr_ahmed));
    expect(signed.status, JSON.stringify(signed.body)).toBe(200);
    const locked = await h.http().patch(`/v1/encounters/${enc}`).set(auth(h.staff.dr_ahmed)).send({ notes: 'x' });
    expect(locked.body.error).toBe('encounter_signed_use_addendum');
    await h.http().post(`/v1/encounters/${enc}/addenda`).set(auth(h.staff.dr_ahmed)).send({ body: 'إضافة بعد الاعتماد' }).expect(201);
    const pdf = await h.http().get(`/v1/prescriptions/${ctx.rx}/pdf`).set(auth(h.staff.dr_ahmed)).buffer(true);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    const verify = await h.http().get(`/v1/public/verify/rx/${ctx.verifyCode}`).set('x-org', 'demo');
    expect(verify.body).toMatchObject({ valid: true });
    expect(JSON.stringify(verify.body)).not.toContain('Concor');
    const after = await h.http().get(`/v1/appointments/${ctx.walkInAppt}`).set(auth(h.staff.reception));
    expect(after.body.status).toBe('completed');
  }, 60000);

  it('receptionist cannot read clinical notes; a cross-clinic doctor can, and the access is audited', async () => {
    const r = await h.http().get(`/v1/encounters/${ctx.encounter}`).set(auth(h.staff.reception));
    expect(r.status).toBe(403);
    const list = await h.http().get(`/v1/patients/${ctx.walkInPatient}/encounters`).set(auth(h.staff.reception));
    expect(list.status).toBe(403);
    // Dr Sara works only at the Dokki clinic.
    const d = await h.http().get(`/v1/encounters/${ctx.encounter}`).set(auth(h.staff.dr_sara));
    expect(d.status).toBe(200);
    expect(d.body.allergies[0].text).toBe('Penicillin');
    const audit = await h.http().get(`/v1/audit?patientId=${ctx.walkInPatient}&action=emr.read`).set(auth(h.staff.owner));
    expect(audit.body.some((a: { details: { crossClinic?: boolean } | null }) => a.details?.crossClinic)).toBe(true);
  });

  it('cashier takes cash and closes the shift with a counted-cash report', async () => {
    const noShift = await h.http().post('/v1/bills').set(auth(h.staff.reception)).send({ clinicId: ctx.nc, patientId: ctx.walkInPatient, appointmentId: ctx.walkInAppt, lines: [{ serviceId: ctx.consult, qty: 1 }] });
    expect(noShift.status).toBe(201);
    ctx.bill = noShift.body.id;
    await h.http().post(`/v1/bills/${ctx.bill}/issue`).set(auth(h.staff.reception)).expect(200);
    const fail = await h.http().post(`/v1/bills/${ctx.bill}/payments`).set(auth(h.staff.reception)).send({ method: 'cash', amount: 40000 });
    expect(fail.body.error).toBe('no_open_shift');
    const shift = await h.http().post('/v1/shifts').set(auth(h.staff.reception)).send({ clinicId: ctx.nc, openingFloat: 50000 });
    expect(shift.status).toBe(201);
    const pay = await h.http().post(`/v1/bills/${ctx.bill}/payments`).set(auth(h.staff.reception)).send({ method: 'cash', amount: 40000 });
    expect(pay.status, JSON.stringify(pay.body)).toBe(201);
    expect(pay.body.billStatus).toBe('paid');
    expect(pay.body.receipt_number).toMatch(/^NC-\d{7}$/);
    const close = await h.http().post(`/v1/shifts/${shift.body.id}/close`).set(auth(h.staff.reception)).send({ counts: { '20000': 4, '10000': 1 } });
    expect(close.status).toBe(200);
    expect(close.body.summary).toMatchObject({ expected: 90000, counted: 90000, variance: 0, needsApproval: false });
    const rep = await h.http().get(`/v1/shifts/${shift.body.id}/report.pdf`).set(auth(h.staff.reception));
    expect(rep.headers['content-type']).toBe('application/pdf');
    const inv = await h.http().get(`/v1/bills/${ctx.bill}/invoice.pdf`).set(auth(h.staff.reception));
    expect(inv.status).toBe(200);
  }, 60000);

  it('VAT applies to taxable services and big discounts need manager approval', async () => {
    const services = await h.http().get('/v1/services').set(auth(h.staff.manager));
    const laser = services.body.find((s: { code: string }) => s.code === 'PROC-LASER').id;
    const b = await h.http().post('/v1/bills').set(auth(h.staff.reception)).send({ clinicId: ctx.nc, patientId: ctx.walkInPatient, lines: [{ serviceId: laser, qty: 1, discount: { type: 'percent', value: 30 } }] });
    expect(b.body).toMatchObject({ subtotal: 120000, discount: 36000, vat: 11760, total: 95760, needsApproval: true });
    const pending = await h.http().post(`/v1/bills/${b.body.id}/issue`).set(auth(h.staff.reception));
    expect(pending.body.error).toBe('discount_approval_pending');
    const self = await h.http().post(`/v1/approvals/${b.body.discount_approval_id}/decision`).set(auth(h.staff.reception)).send({ approve: true });
    expect(self.status).toBe(403);
    await h.http().post(`/v1/approvals/${b.body.discount_approval_id}/decision`).set(auth(h.staff.manager)).send({ approve: true }).expect(200);
    await h.http().post(`/v1/bills/${b.body.id}/issue`).set(auth(h.staff.reception)).expect(200);
  });

  it('patient sees the prescription, rates the visit, and moderation publishes it', async () => {
    const t = await patientLogin(h, '01222223333');
    ctx.walkInToken = t.accessToken;
    const rx = await h.http().get('/v1/portal/prescriptions').set(auth(t.accessToken));
    expect(rx.body).toHaveLength(1);
    const rev = await h.http().post('/v1/portal/reviews').set(auth(t.accessToken)).send({ appointmentId: ctx.walkInAppt, rating: 2, comment: 'انتظار طويل' });
    expect(rev.status, JSON.stringify(rev.body)).toBe(201);
    const tasks = await h.http().get('/v1/tasks').set(auth(h.staff.manager));
    expect(tasks.body.some((x: { kind: string }) => x.kind === 'service_recovery')).toBe(true);
    await h.http().post(`/v1/reviews/${rev.body.id}/moderate`).set(auth(h.staff.manager)).send({ approve: true }).expect(200);
    const doc = await h.http().get('/v1/public/doctors/ahmed-samy').set('x-org', 'demo');
    expect(doc.body.reviews[0].display_name).toBe('كريم م.');
  });
});

describe('Reports, privacy and audit (SRS §11.5, §11.7)', () => {
  it('director dashboard matches SQL ground truth', async () => {
    const c = new Client({ connectionString: h.env.adminUrl });
    await c.connect();
    await c.query('select refresh_reports()');
    const today = localDate(new Date());
    const truth = (await c.query(`select coalesce(sum(vat),0)::int as vat, coalesce(sum(total),0)::int as total from bills where organisation_id = $1 and status not in ('draft','void') and (issued_at at time zone 'Africa/Cairo')::date = $2`, [h.env.demo.orgId, today])).rows[0];
    const appts = (await c.query(`select count(*)::int as n from appointments where organisation_id = $1 and (start_at at time zone 'Africa/Cairo')::date between $2 and $3`, [h.env.demo.orgId, today, '2026-12-31'])).rows[0];
    await c.end();
    const d = await h.http().get(`/v1/reports/dashboard?from=${today}&to=${today}`).set(auth(h.staff.director));
    expect(d.status, JSON.stringify(d.body)).toBe(200);
    expect(Number(d.body.revenue.vat)).toBe(truth.vat);
    expect(Number(d.body.revenue.total)).toBe(truth.total);
    const wide = await h.http().get(`/v1/reports/dashboard?from=${today}&to=2026-12-31`).set(auth(h.staff.director));
    expect(wide.body.appointments.total).toBe(appts.n);
    const manager = await h.http().get(`/v1/reports/dashboard?from=${today}&to=${today}`).set(auth(h.staff.reception));
    expect(manager.status).toBe(403);
    const csv = await h.http().get(`/v1/reports/export?report=daily-appointments&format=csv&date=${today}`).set(auth(h.staff.director));
    expect(csv.text).toContain('# ');
  });

  it('patient data export and anonymisation request, audit chain verifies', async () => {
    const t = { accessToken: ctx.walkInToken! };
    const req = await h.http().post('/v1/portal/data-requests').set(auth(t.accessToken)).send({ patientId: ctx.walkInPatient, kind: 'export' });
    expect(req.status).toBe(201);
    const done = await h.http().post(`/v1/privacy/data-requests/${req.body.id}/process`).set(auth(h.staff.owner)).send({ action: 'complete' });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.download).toContain('http');
    const v = await h.http().get('/v1/audit/verify').set(auth(h.staff.owner));
    expect(v.body.intact).toBe(true);
    expect(v.body.entries).toBeGreaterThan(20);
  });
});
