import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { auth, nationalIdFor, startHarness, type Harness } from './harness';
import { AI, type FakeAiClient } from '../src/integrations/ai';

let h: Harness;
let admin: Client;
const ctx: Record<string, string> = {};

beforeAll(async () => {
  h = await startHarness('hf_test_api_r3');
  admin = new Client({ connectionString: h.env.adminUrl });
  await admin.connect();
  const pt = await h.http().post('/v1/patients').set(auth(h.staff.reception)).send({
    patient: { nameAr: { first: 'سمير', father: 'نبيل', family: 'عبده' }, dateOfBirth: '1970-04-04', gender: 'male', nationalId: nationalIdFor('1970-04-04', 'male', 61), phones: [{ number: '01077770001', primary: true }] },
    consents: { healthData: true },
  });
  ctx.patient = pt.body.id;
  const services = await h.http().get('/v1/services').set(auth(h.staff.manager));
  const walk = await h.http().post('/v1/appointments/walk-in').set(auth(h.staff.reception)).send({ patientId: ctx.patient, clinicId: h.env.demo.clinicIds[0], doctorId: h.env.demo.doctorIds[0], serviceIds: [services.body.find((s: { code: string }) => s.code === 'CONS-IM').id] });
  ctx.encounter = (await admin.query('select id from encounters where appointment_id = $1', [walk.body.appointment.id])).rows[0].id;
}, 180000);
afterAll(async () => {
  await admin?.end();
  await h?.close();
});

describe('AI scribe (BR-19, FR-EMR-9)', () => {
  const dictation = 'المريض سمير نبيل عبده بيشتكي من صداع، الضغط 150/95، التشخيص ارتفاع ضغط الدم، متابعة بعد أسبوعين. رقمه 01077770001';

  it('is off until the organisation enables it', async () => {
    const r = await h.http().post(`/v1/encounters/${ctx.encounter}/ai/dictation`).set(auth(h.staff.dr_ahmed)).send({ text: dictation });
    expect(r.body.error).toBe('ai_assistance_disabled');
    const denied = await h.http().put('/v1/ai/settings').set(auth(h.staff.dr_ahmed)).send({ enabled: true });
    expect(denied.status).toBe(403);
    await h.http().put('/v1/ai/settings').set(auth(h.staff.owner)).send({ enabled: true }).expect(200);
  });

  it('drafts from dictation without sending names or phone numbers, flags unknown codes, and changes nothing until approved', async () => {
    const other = await h.http().post(`/v1/encounters/${ctx.encounter}/ai/dictation`).set(auth(h.staff.dr_mona)).send({ text: dictation });
    expect(other.status).toBe(403);
    const r = await h.http().post(`/v1/encounters/${ctx.encounter}/ai/dictation`).set(auth(h.staff.dr_ahmed)).send({ text: dictation, language: 'ar' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const fake = h.app.get(AI) as FakeAiClient;
    const sent = JSON.stringify(fake.calls.at(-1)!.input);
    expect(sent).not.toContain('سمير');
    expect(sent).not.toContain('عبده');
    expect(sent).not.toContain('01077770001');
    expect(r.body.output.diagnoses.map((d: { code: string }) => d.code)).toEqual(['I10']);
    expect(r.body.warnings.some((w: { issue: string }) => w.issue === 'unknown_or_unmapped_icd10')).toBe(true);
    ctx.draft = r.body.id;
    const enc = await h.http().get(`/v1/encounters/${ctx.encounter}`).set(auth(h.staff.dr_ahmed));
    expect(enc.body.diagnoses).toEqual([]);
    const stored = await admin.query('select input_enc from ai_drafts where id = $1', [ctx.draft]);
    expect(stored.rows[0].input_enc.toString()).not.toContain('صداع'); // transcript encrypted at rest
  });

  it('accepts audio dictation through the transcription provider', async () => {
    const r = await h.http().post(`/v1/encounters/${ctx.encounter}/ai/dictation`).set(auth(h.staff.dr_ahmed)).attach('audio', Buffer.from('FAKEAUDIO:Patient reports cough for two weeks'), 'note.webm');
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.transcript).toContain('cough');
    const bad = await h.http().post(`/v1/encounters/${ctx.encounter}/ai/dictation`).set(auth(h.staff.dr_ahmed)).attach('audio', Buffer.from('not audio at all'), 'x.webm');
    expect(bad.body.error).toBe('unsupported_audio_type');
  });

  it('applies only what the doctor approves, once', async () => {
    const ap = await h.http().post(`/v1/ai/drafts/${ctx.draft}/approve`).set(auth(h.staff.dr_ahmed)).send({ chiefComplaint: 'صداع', vitals: { systolic: 150, diastolic: 95 }, diagnosisCodes: ['I10'], followUpDate: '2026-12-01' });
    expect(ap.status, JSON.stringify(ap.body)).toBe(200);
    const enc = await h.http().get(`/v1/encounters/${ctx.encounter}`).set(auth(h.staff.dr_ahmed));
    expect(enc.body.chief_complaint).toBe('صداع');
    expect(enc.body.diagnoses).toEqual([{ code: 'I10', primary: true }]);
    const again = await h.http().post(`/v1/ai/drafts/${ctx.draft}/approve`).set(auth(h.staff.dr_ahmed)).send({});
    expect(again.body.error).toBe('draft_not_pending');
    const audit = await h.http().get('/v1/audit?action=ai.').set(auth(h.staff.owner));
    expect(audit.body.map((a: { action: string }) => a.action)).toEqual(expect.arrayContaining(['ai.draft_encounter_note', 'ai.approve']));
  });

  it('keeps existing diagnoses (with notes) and the stored body-chart image (regressions)', async () => {
    const walk2 = await h.http().post('/v1/appointments/walk-in').set(auth(h.staff.reception)).send({ patientId: ctx.patient, clinicId: h.env.demo.clinicIds[0], doctorId: h.env.demo.doctorIds[0], serviceIds: [(await h.http().get('/v1/services').set(auth(h.staff.manager))).body.find((s: { code: string }) => s.code === 'FU').id] });
    const enc = (await admin.query('select id from encounters where appointment_id = $1', [walk2.body.appointment.id])).rows[0].id;
    const png = 'data:image/png;base64,' + Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]).toString('base64');
    await h.http().patch(`/v1/encounters/${enc}`).set(auth(h.staff.dr_ahmed)).send({ diagnoses: [{ code: 'R51', primary: true, note: 'tension type' }], bodyChart: { image: 'front', shapes: [{ x: 1 }], pngDataUrl: png } }).expect(200);
    const key = (await admin.query(`select body_chart->>'pngKey' as k from encounters where id = $1`, [enc])).rows[0].k;
    expect(key).toBeTruthy();
    await h.http().patch(`/v1/encounters/${enc}`).set(auth(h.staff.dr_ahmed)).send({ bodyChart: { image: 'front', shapes: [{ x: 1 }, { x: 2 }] } }).expect(200);
    expect((await admin.query(`select body_chart->>'pngKey' as k from encounters where id = $1`, [enc])).rows[0].k).toBe(key);
    const d = await h.http().post(`/v1/encounters/${enc}/ai/dictation`).set(auth(h.staff.dr_ahmed)).send({ text: 'ارتفاع ضغط الدم مع صداع' });
    await h.http().post(`/v1/ai/drafts/${d.body.id}/approve`).set(auth(h.staff.dr_ahmed)).send({ diagnosisCodes: ['I10'] }).expect(200);
    const after = (await admin.query('select diagnoses from encounters where id = $1', [enc])).rows[0].diagnoses;
    expect(after).toEqual([{ code: 'R51', primary: true, note: 'tension type' }, { code: 'I10', primary: false }]);
  });

  it('words prescription instructions and writes a patient summary only on approval', async () => {
    const drug = (await h.http().get('/v1/drugs?q=Augmentin').set(auth(h.staff.dr_ahmed))).body[0].id;
    const rx = await h.http().post(`/v1/encounters/${ctx.encounter}/prescriptions`).set(auth(h.staff.dr_ahmed)).send({ lines: [{ drugId: drug, dose: '1 قرص', frequency: 'كل 12 ساعة', durationDays: 7 }] });
    const d = await h.http().post(`/v1/prescriptions/${rx.body.id}/ai/instructions`).set(auth(h.staff.dr_ahmed));
    expect(d.status, JSON.stringify(d.body)).toBe(201);
    expect(d.body.warnings).toEqual([]);
    await h.http().post(`/v1/ai/drafts/${d.body.id}/approve`).set(auth(h.staff.dr_ahmed)).send({ lines: d.body.output.lines }).expect(200);
    const line = await admin.query('select instructions_ar from prescription_lines where prescription_id = $1', [rx.body.id]);
    expect(line.rows[0].instructions_ar).toContain('7');

    const s = await h.http().post(`/v1/encounters/${ctx.encounter}/ai/patient-summary`).set(auth(h.staff.dr_ahmed));
    expect(s.status).toBe(201);
    await h.http().post(`/v1/ai/drafts/${s.body.id}/reject`).set(auth(h.staff.dr_ahmed)).expect(200);
    const enc = await admin.query('select patient_summary from encounters where id = $1', [ctx.encounter]);
    expect(enc.rows[0].patient_summary).toBeNull();
    const usage = await h.http().get('/v1/ai/usage').set(auth(h.staff.owner));
    expect(usage.body.reduce((a: number, r: { drafts: number }) => a + r.drafts, 0)).toBe(5);
  });
});

describe('SaaS administration and public API (BR-20, FR-ADM-1, FR-INT-3)', () => {
  let platform = '';
  it('only platform admins reach the platform API', async () => {
    platform = (await h.http().post('/v1/auth/dev/platform-token').set('x-org', 'demo').send({ email: 'platform@demo.healthflow.eg' })).body.accessToken;
    expect((await h.http().get('/v1/platform/organisations').set(auth(h.staff.owner))).status).toBe(403);
    const orgs = await h.http().get('/v1/platform/organisations').set(auth(platform));
    expect(orgs.status).toBe(200);
    expect(orgs.body.find((o: { slug: string }) => o.slug === 'demo').plan_code).toBe('enterprise');
  });

  it('onboards an organisation on a trial plan and enforces plan limits', async () => {
    const r = await h.http().post('/v1/platform/organisations').set(auth(platform)).send({ slug: 'nile-clinic', nameAr: 'عيادة النيل', plan: 'starter', ownerEmail: 'owner@nile.example', ownerName: 'مالك النيل' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const owner = (await h.http().post('/v1/auth/dev/staff-token').set('x-org', 'nile-clinic').send({ email: 'owner@nile.example' })).body.accessToken;
    const sub = await h.http().get('/v1/subscription').set(auth(owner));
    expect(sub.body.subscription).toMatchObject({ plan_code: 'starter', status: 'trial' });
    const clinic = { name: { ar: 'فرع ١', en: 'Branch 1' }, slug: 'branch-1', governorate: 'cairo', city: 'المعادي' };
    expect((await h.http().post('/v1/clinics').set(auth(owner)).send(clinic)).status).toBe(201);
    const second = await h.http().post('/v1/clinics').set(auth(owner)).send({ ...clinic, slug: 'branch-2' });
    expect(second.status).toBe(402);
    expect(second.body.error).toBe('plan_limit_reached');
    ctx.nileOrg = r.body.organisationId;
  });

  it('bills organisations through HealthPay and activates the subscription on payment', async () => {
    const inv = await h.http().post('/v1/platform/invoices/generate').set(auth(platform)).send({ month: '2026-11' });
    expect(inv.status).toBe(200);
    const nile = (await h.http().get(`/v1/platform/invoices?organisationId=${ctx.nileOrg}`).set(auth(platform))).body[0];
    expect(nile.amount).toBe(150000);
    expect(nile.checkout_url).toContain('/dev/healthpay/checkout/');
    const { PaymentsService } = await import('../src/modules/payments');
    expect(await h.app.get(PaymentsService).handleWebhook({ id: 'txn-plat-1', type: 'payment.captured', orderId: nile.id, amount: 150000, occurredAt: new Date().toISOString() })).toBe('processed');
    const orgs = await h.http().get('/v1/platform/organisations').set(auth(platform));
    expect(orgs.body.find((o: { id: string }) => o.id === ctx.nileOrg).sub_status).toBe('active');
  });

  it('support access needs the owner, is read-only and never shows clinical records', async () => {
    const req = await h.http().post(`/v1/platform/organisations/${h.env.demo.orgId}/support-access`).set(auth(platform)).send({ reason: 'Investigating a reported booking issue', hours: 2 });
    expect(req.status).toBe(201);
    const early = await h.http().post(`/v1/platform/support-access/${req.body.id}/token`).set(auth(platform));
    expect(early.status).toBe(403);
    const byManager = await h.http().post(`/v1/support-access/${req.body.id}/decision`).set(auth(h.staff.director)).send({ approve: true });
    expect(byManager.status).toBe(403);
    await h.http().post(`/v1/support-access/${req.body.id}/decision`).set(auth(h.staff.owner)).send({ approve: true }).expect(200);
    const tok = (await h.http().post(`/v1/platform/support-access/${req.body.id}/token`).set(auth(platform))).body.token;
    expect((await h.http().get('/v1/clinics').set(auth(tok))).status).toBe(200);
    expect((await h.http().get(`/v1/encounters/${ctx.encounter}`).set(auth(tok))).status).toBe(403);
    const write = await h.http().patch(`/v1/clinics/${h.env.demo.clinicIds[0]}`).set(auth(tok)).send({ invoiceFooter: 'x' });
    expect(write.body.error).toBe('support_read_only');
    await h.http().post(`/v1/support-access/${req.body.id}/revoke`).set(auth(h.staff.owner)).expect(200);
    expect((await h.http().get('/v1/clinics').set(auth(tok))).status).toBe(401);
    const audit = await admin.query(`select count(*)::int as n from audit_log where organisation_id = $1 and actor_type = 'platform'`, [h.env.demo.orgId]);
    expect(audit.rows[0].n).toBeGreaterThan(0);
  });

  it('API keys are hashed, scoped, revocable and never expose patient names', async () => {
    const k = await h.http().post('/v1/api-keys').set(auth(h.staff.owner)).send({ name: 'BI tool', scopes: ['catalogue:read', 'appointments:read'] });
    expect(k.status).toBe(201);
    expect(k.body.key).toMatch(/^hfk_live_/);
    const stored = await admin.query('select key_hash from api_keys where id = $1', [k.body.id]);
    expect(stored.rows[0].key_hash).not.toContain(k.body.key);
    expect((await h.http().get('/v1/ext/clinics').set('x-api-key', k.body.key)).status).toBe(200);
    const from = new Date(Date.now() - 86400000).toISOString();
    const to = new Date(Date.now() + 86400000).toISOString();
    const appts = await h.http().get(`/v1/ext/appointments?from=${from}&to=${to}`).set('x-api-key', k.body.key);
    expect(appts.status).toBe(200);
    expect(appts.body.length).toBeGreaterThan(0);
    expect(JSON.stringify(appts.body)).not.toContain('سمير');
    expect(appts.body[0].patient_mrn).toMatch(/^HF-/);
    expect((await h.http().get('/v1/ext/reports/dashboard?from=2026-01-01&to=2026-01-31').set('x-api-key', k.body.key)).body.error).toBe('missing_scope');
    expect((await h.http().get('/v1/ext/clinics').set('x-api-key', 'hfk_live_' + 'x'.repeat(40))).status).toBe(401);
    await h.http().post(`/v1/api-keys/${k.body.id}/revoke`).set(auth(h.staff.owner)).expect(200);
    expect((await h.http().get('/v1/ext/clinics').set('x-api-key', k.body.key)).status).toBe(401);
  });
});
