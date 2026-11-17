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
    expect(usage.body.reduce((a: number, r: { drafts: number }) => a + r.drafts, 0)).toBe(4);
  });
});
