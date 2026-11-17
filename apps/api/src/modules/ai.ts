import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Post, Put, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import type { SecretBox, Tx } from '@hf/db';
import { addDays, ageInYears, localDate, normaliseArabic, vitalsSchema, zDate } from '@hf/shared';
import { Auth, Meta, Staff } from '../common/decorators';
import { asStaff } from '../common/auth.guard';
import type { Principal, RequestMeta, StaffPrincipal } from '../common/principal';
import { AuditService, BOX, Tenancy } from '../common/services';
import { DomainError, badRequest, forbidden, notFound } from '../common/errors';
import { parse, uuid } from '../common/zod';
import { CONFIG, type Config } from '../config';
import { AI, AiDeclinedError, PROMPT_VERSION, STT, type AiClient, type AiResult, type EncounterDraft, type SttProvider } from '../integrations/ai';
import { PatientsService } from './patients.service';
import { redact } from './events';

const MAX_AUDIO_BYTES = 20 * 1024 * 1024;

/** Audio types accepted for dictation, detected from magic bytes. */
function sniffAudio(b: Buffer): string | null {
  if (b.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return 'audio/webm';
  if (b.subarray(0, 4).toString() === 'OggS') return 'audio/ogg';
  if (b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WAVE') return 'audio/wav';
  if (b.subarray(0, 3).toString() === 'ID3' || (b[0] === 0xff && (b[1]! & 0xe0) === 0xe0)) return 'audio/mpeg';
  if (b.subarray(4, 8).toString() === 'ftyp') return 'audio/mp4';
  return null;
}

/**
 * PHI minimisation before text leaves the platform: the patient's own name parts, phone numbers, national IDs and
 * e-mail addresses are replaced. Only age, sex and clinical content are sent (BR-19 governance).
 */
export function minimise(text: string, names: string[]): string {
  let out = redact(text);
  const parts = [...new Set(names.flatMap((n) => (n ?? '').split(/\s+/)).filter((p) => p.length >= 3))];
  for (const p of parts) {
    const variants = [p, normaliseArabic(p)];
    for (const v of variants) out = out.split(v).join('[patient]');
  }
  return out;
}

const approveEncounterSchema = z.object({
  chiefComplaint: z.string().max(5000).optional(),
  hpi: z.string().max(20000).optional(),
  examination: z.string().max(20000).optional(),
  notes: z.string().max(50000).optional(),
  vitals: vitalsSchema.optional(),
  diagnosisCodes: z.array(z.string().max(10)).max(20).optional(),
  followUpDate: zDate.nullable().optional(),
});

@Controller('v1')
export class AiController {
  constructor(
    private readonly tenancy: Tenancy,
    private readonly audit: AuditService,
    private readonly patients: PatientsService,
    @Inject(AI) private readonly ai: AiClient,
    @Inject(STT) private readonly stt: SttProvider,
    @Inject(BOX) private readonly box: SecretBox,
    @Inject(CONFIG) private readonly cfg: Config,
  ) {}

  private async enabled(tx: Tx) {
    const f = await tx.maybeOne<{ enabled: boolean }>(`select enabled from feature_flags where key = 'ai_assistance'`);
    if (!f?.enabled) throw new DomainError('ai_assistance_disabled', HttpStatus.FORBIDDEN);
  }

  private async call<T>(fn: () => Promise<AiResult<T>>): Promise<AiResult<T>> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof AiDeclinedError) throw new DomainError('ai_declined', HttpStatus.UNPROCESSABLE_ENTITY, { category: e.message });
      throw new DomainError('ai_unavailable', HttpStatus.SERVICE_UNAVAILABLE);
    }
  }

  private async ownEncounter(tx: Tx, s: StaffPrincipal, id: string) {
    const e = await tx.maybeOne<{ id: string; doctor_id: string; patient_id: string; clinic_id: string; status: string }>('select id, doctor_id, patient_id, clinic_id, status from encounters where id = $1', [uuid(id)]);
    if (!e) throw notFound('encounter');
    if (e.doctor_id !== s.userId) throw forbidden('not_encounter_doctor');
    return e;
  }

  private async patientContext(tx: Tx, patientId: string) {
    const p = await tx.one<{ first_name_ar: string; father_name_ar: string; grandfather_name_ar: string; family_name_ar: string; name_en: string | null; date_of_birth: string; gender: string }>('select * from patients where id = $1', [patientId]);
    return { names: [p.first_name_ar, p.father_name_ar, p.grandfather_name_ar, p.family_name_ar, p.name_en ?? ''], ageYears: ageInYears(p.date_of_birth), sex: p.gender };
  }

  private async saveDraft(tx: Tx, s: StaffPrincipal, meta: RequestMeta, d: { clinicId: string; patientId: string; encounterId?: string; prescriptionId?: string; kind: string; source: string; input?: string; result: AiResult<unknown>; warnings: unknown[] }) {
    const row = await tx.one<{ id: string }>(
      `insert into ai_drafts (organisation_id, clinic_id, patient_id, doctor_id, encounter_id, prescription_id, kind, source, output, warnings, model, served_model, prompt_version, input_tokens, output_tokens)
       values (app_org(), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning id`,
      [d.clinicId, d.patientId, s.userId, d.encounterId ?? null, d.prescriptionId ?? null, d.kind, d.source, JSON.stringify(d.result.output), JSON.stringify(d.warnings),
        d.result.model, d.result.servedModel, PROMPT_VERSION, d.result.inputTokens, d.result.outputTokens],
    );
    if (d.input) await tx.query('update ai_drafts set input_enc = $2 where id = $1', [row.id, this.box.encrypt(d.input, `ai:${row.id}`)]);
    await this.audit.record(tx, s, meta, { action: `ai.draft_${d.kind}`, entity: 'ai_draft', entityId: row.id, patientId: d.patientId, clinicId: d.clinicId, details: { model: d.result.servedModel, promptVersion: PROMPT_VERSION } });
    return { id: row.id, kind: d.kind, status: 'pending', output: d.result.output, warnings: d.warnings };
  }

  /** Validate a draft against the record's rules; anything doubtful becomes a warning for the doctor, never silently kept. */
  private async checkEncounterDraft(tx: Tx, out: EncounterDraft) {
    const warnings: { field: string; issue: string; value?: unknown }[] = [];
    const codes = out.diagnoses.map((d) => d.code).filter(Boolean);
    const known = new Set((await tx.query<{ code: string }>('select code from icd10_codes where code = any($1)', [codes])).map((r) => r.code));
    for (const d of out.diagnoses) if (!d.code || !known.has(d.code)) warnings.push({ field: 'diagnoses', issue: 'unknown_or_unmapped_icd10', value: d });
    out.diagnoses = out.diagnoses.filter((d) => d.code && known.has(d.code));
    const vitals = Object.fromEntries(Object.entries(out.vitals).filter(([, v]) => v !== null));
    const v = vitalsSchema.safeParse(vitals);
    if (!v.success) {
      for (const i of v.error.issues) {
        warnings.push({ field: `vitals.${i.path.join('.')}`, issue: 'out_of_range', value: (vitals as Record<string, unknown>)[String(i.path[0])] });
        (out.vitals as Record<string, unknown>)[String(i.path[0])] = null;
      }
    }
    for (const m of out.missingInformation) warnings.push({ field: 'missing', issue: m });
    return warnings;
  }

  // ---- Settings & usage (governance)
  @Get('ai/settings')
  @Staff()
  async settings(@Auth() p: Principal) {
    const f = await this.tenancy.run(p, (tx) => tx.maybeOne<{ enabled: boolean }>(`select enabled from feature_flags where key = 'ai_assistance'`));
    return { enabled: !!f?.enabled, model: 'claude-opus-5-5', promptVersion: PROMPT_VERSION, mode: this.cfg.AI_MODE };
  }

  @Put('ai/settings')
  @Staff('settings:edit')
  setSettings(@Auth() p: Principal, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const { enabled } = parse(z.object({ enabled: z.boolean() }), body);
    return this.tenancy.run(p, async (tx) => {
      await tx.query(`insert into feature_flags (organisation_id, key, enabled) values (app_org(), 'ai_assistance', $1) on conflict (organisation_id, key) do update set enabled = excluded.enabled`, [enabled]);
      await this.audit.record(tx, p, meta, { action: 'ai.settings', entity: 'feature_flag', entityId: 'ai_assistance', details: { enabled } });
      return { enabled };
    });
  }

  @Get('ai/usage')
  @Staff('settings:view')
  usage(@Auth() p: Principal, @Query('from') from?: string) {
    const start = from ? parse(zDate, from) : addDays(localDate(new Date()), -30);
    return this.tenancy.run(p, (tx) =>
      tx.query(
        `select kind, status, count(*)::int as drafts, sum(input_tokens)::int as input_tokens, sum(output_tokens)::int as output_tokens
         from ai_drafts where created_at >= $1::date group by kind, status order by kind, status`,
        [start],
      ),
    );
  }

  // ---- Drafting
  /** Dictation (typed text or an audio file) → structured encounter draft. */
  @Post('encounters/:id/ai/dictation')
  @Staff('emr:edit')
  @UseInterceptors(FileInterceptor('audio', { limits: { fileSize: MAX_AUDIO_BYTES } }))
  async dictation(@Auth() p: Principal, @Param('id') id: string, @UploadedFile() audio: { buffer: Buffer } | undefined, @Body() body: { text?: string; language?: string }, @Meta() meta: RequestMeta) {
    const s = asStaff(p);
    const pre = await this.tenancy.run(s, async (tx) => {
      await this.enabled(tx);
      const e = await this.ownEncounter(tx, s, id);
      if (e.status === 'signed') throw new DomainError('encounter_signed_use_addendum', HttpStatus.CONFLICT);
      if (!(await this.patients.hasHealthConsent(tx, e.patient_id))) throw new DomainError('health_data_consent_required');
      const spec = await tx.maybeOne<{ name_en: string }>('select s.name_en from doctor_specialties ds join specialties s on s.id = ds.specialty_id where ds.doctor_id = $1 limit 1', [s.userId]);
      return { e, ctx: await this.patientContext(tx, e.patient_id), specialty: spec?.name_en ?? null };
    });
    const language = body?.language === 'en' ? 'en' : body?.language === 'ar' ? 'ar' : 'auto';
    let transcript: string;
    let source: 'text' | 'audio';
    if (audio) {
      const fakeOk = this.cfg.STT_MODE === 'fake' && audio.buffer.subarray(0, 10).toString() === 'FAKEAUDIO:';
      const mime = fakeOk ? 'audio/webm' : sniffAudio(audio.buffer);
      if (!mime) throw badRequest('unsupported_audio_type');
      transcript = await this.stt.transcribe(audio.buffer, mime, language).catch(() => {
        throw new DomainError('transcription_unavailable', HttpStatus.SERVICE_UNAVAILABLE);
      });
      source = 'audio';
    } else {
      transcript = parse(z.string().min(5).max(20000), body?.text);
      source = 'text';
    }
    const result = await this.call(() =>
      this.ai.draftEncounter({ transcript: minimise(transcript, pre.ctx.names), specialty: pre.specialty, ageYears: pre.ctx.ageYears, sex: pre.ctx.sex, locale: language === 'en' ? 'en' : 'ar' }),
    );
    return this.tenancy.run(s, async (tx) => {
      const warnings = await this.checkEncounterDraft(tx, result.output);
      return { ...(await this.saveDraft(tx, s, meta, { clinicId: pre.e.clinic_id, patientId: pre.e.patient_id, encounterId: pre.e.id, kind: 'encounter_note', source, input: transcript, result, warnings })), transcript };
    });
  }

  /** Patient-friendly Arabic/English summary of a signed visit. */
  @Post('encounters/:id/ai/patient-summary')
  @Staff('emr:edit')
  async summary(@Auth() p: Principal, @Param('id') id: string, @Meta() meta: RequestMeta) {
    const s = asStaff(p);
    const pre = await this.tenancy.run(s, async (tx) => {
      await this.enabled(tx);
      const e = await this.ownEncounter(tx, s, id);
      const rec = await tx.one<Record<string, unknown>>(`select chief_complaint, hpi, examination, notes, vitals, diagnoses, follow_up from encounters where id = $1`, [id]);
      const meds = await tx.query<{ line: string }>(
        `select coalesce(d.trade_name_en, l.free_text) || ' ' || coalesce(d.strength, '') || ' - ' || l.dose || ', ' || l.frequency || coalesce(', ' || l.duration_days || ' days', '') as line
         from prescriptions rx join prescription_lines l on l.prescription_id = rx.id left join drugs d on d.id = l.drug_id where rx.encounter_id = $1 and rx.status = 'issued' order by l.position`,
        [id],
      );
      const ctx = await this.patientContext(tx, e.patient_id);
      const titles = await tx.query<{ code: string; title_en: string; title_ar: string | null }>('select code, title_en, title_ar from icd10_codes where code = any($1)', [((rec.diagnoses as { code: string }[]) ?? []).map((d) => d.code)]);
      const record = Object.fromEntries(Object.entries({ ...rec, diagnoses: titles }).map(([k, v]) => [k, typeof v === 'string' ? minimise(v, ctx.names) : v]));
      return { e, ctx, record, meds: meds.map((m) => m.line) };
    });
    const result = await this.call(() => this.ai.patientSummary({ encounter: pre.record, medications: pre.meds, ageYears: pre.ctx.ageYears, sex: pre.ctx.sex }));
    return this.tenancy.run(s, (tx) => this.saveDraft(tx, s, meta, { clinicId: pre.e.clinic_id, patientId: pre.e.patient_id, encounterId: pre.e.id, kind: 'patient_summary', source: 'record', result, warnings: [] }));
  }

  /** Arabic/English instruction wording for a draft prescription; dose, frequency and duration are checked unchanged. */
  @Post('prescriptions/:id/ai/instructions')
  @Staff('prescription:create')
  async rxInstructions(@Auth() p: Principal, @Param('id') id: string, @Meta() meta: RequestMeta) {
    const s = asStaff(p);
    const pre = await this.tenancy.run(s, async (tx) => {
      await this.enabled(tx);
      const rx = await tx.maybeOne<{ id: string; doctor_id: string; patient_id: string; clinic_id: string; status: string }>('select * from prescriptions where id = $1', [uuid(id)]);
      if (!rx) throw notFound('prescription');
      if (rx.doctor_id !== s.userId) throw forbidden('not_prescriber');
      if (rx.status !== 'draft') throw new DomainError('not_draft', HttpStatus.CONFLICT);
      const lines = await tx.query<{ position: number; drug: string; dose: string; route: string; frequency: string; duration_days: number | null }>(
        `select l.position, coalesce(d.trade_name_en || ' ' || coalesce(d.strength, ''), l.free_text) as drug, l.dose, l.route, l.frequency, l.duration_days
         from prescription_lines l left join drugs d on d.id = l.drug_id where l.prescription_id = $1 order by l.position`,
        [id],
      );
      return { rx, lines };
    });
    const input = pre.lines.map((l) => ({ index: l.position, drug: l.drug, dose: l.dose, route: l.route, frequency: l.frequency, durationDays: l.duration_days }));
    const result = await this.call(() => this.ai.rxInstructions({ lines: input }));
    const warnings: { index: number; issue: string }[] = [];
    for (const l of input) {
      const o = result.output.lines.find((x) => x.index === l.index);
      if (!o) warnings.push({ index: l.index, issue: 'missing_line' });
      else if (l.durationDays && !o.instructionsEn.includes(String(l.durationDays))) warnings.push({ index: l.index, issue: 'duration_not_preserved' });
    }
    return this.tenancy.run(s, (tx) => this.saveDraft(tx, s, meta, { clinicId: pre.rx.clinic_id, patientId: pre.rx.patient_id, prescriptionId: pre.rx.id, kind: 'rx_instructions', source: 'record', result, warnings }));
  }

  /** The doctor's own drafts for an encounter or prescription (to resume a review). */
  @Get('ai/drafts')
  @Staff('emr:view')
  drafts(@Auth() p: Principal, @Query() q: Record<string, string>) {
    const s = asStaff(p);
    const b = parse(z.object({ encounterId: z.string().uuid().optional(), prescriptionId: z.string().uuid().optional(), status: z.enum(['pending', 'approved', 'rejected', 'expired']).default('pending') }), q);
    return this.tenancy.run(s, (tx) =>
      tx.query(
        `select id, kind, status, output, warnings, encounter_id, prescription_id, created_at from ai_drafts
         where doctor_id = $1 and status = $2 and ($3::uuid is null or encounter_id = $3) and ($4::uuid is null or prescription_id = $4)
           and (status <> 'pending' or created_at > now() - interval '24 hours') order by created_at desc limit 50`,
        [s.userId, b.status, b.encounterId ?? null, b.prescriptionId ?? null],
      ),
    );
  }

  @Get('ai/drafts/:id')
  @Staff('emr:view')
  async draft(@Auth() p: Principal, @Param('id') id: string) {
    const s = asStaff(p);
    const d = await this.tenancy.run(s, (tx) => tx.maybeOne<{ doctor_id: string }>('select id, kind, status, output, warnings, model, served_model, prompt_version, encounter_id, prescription_id, created_at, decided_at, applied, doctor_id from ai_drafts where id = $1', [uuid(id)]));
    if (!d) throw notFound('draft');
    if (d.doctor_id !== s.userId) throw forbidden('not_draft_owner');
    return d;
  }

  /**
   * Apply a draft after the doctor's review. The body carries the doctor's final (possibly edited) values; only those
   * fields are written. Signed records are never changed.
   */
  @Post('ai/drafts/:id/approve')
  @Staff('emr:approve')
  @HttpCode(200)
  approve(@Auth() p: Principal, @Param('id') id: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const s = asStaff(p);
    return this.tenancy.run(s, async (tx) => {
      const d = await tx.maybeOne<{ id: string; kind: string; status: string; doctor_id: string; encounter_id: string | null; prescription_id: string | null; output: Record<string, unknown>; patient_id: string; clinic_id: string; created_at: Date }>(
        'select * from ai_drafts where id = $1 for update',
        [uuid(id)],
      );
      if (!d) throw notFound('draft');
      if (d.doctor_id !== s.userId) throw forbidden('not_draft_owner');
      if (d.status !== 'pending') throw new DomainError('draft_not_pending', HttpStatus.CONFLICT);
      if (Date.now() - new Date(d.created_at).getTime() > 24 * 3600_000) {
        await tx.query(`update ai_drafts set status = 'expired' where id = $1`, [d.id]);
        throw new DomainError('draft_expired', HttpStatus.CONFLICT);
      }
      let applied: Record<string, unknown> = {};
      if (d.kind === 'encounter_note') {
        const b = parse(approveEncounterSchema, body);
        const e = await tx.one<{ status: string; vitals: Record<string, number>; diagnoses: { code: string; primary: boolean; note?: string }[] }>('select status, vitals, diagnoses from encounters where id = $1 for update', [d.encounter_id]);
        if (e.status === 'signed') throw new DomainError('encounter_signed_use_addendum', HttpStatus.CONFLICT);
        let diagnoses: { code: string; primary: boolean }[] | null = null;
        if (b.diagnosisCodes) {
          const known = await tx.query<{ code: string }>('select code from icd10_codes where code = any($1)', [b.diagnosisCodes]);
          if (known.length !== new Set(b.diagnosisCodes).size) throw badRequest('unknown_icd10_code');
          // Approved codes are added to the doctor's existing diagnoses (notes and primary flag kept).
          const existing = e.diagnoses ?? [];
          const added = b.diagnosisCodes.filter((c) => !existing.some((x) => x.code === c)).map((c, i) => ({ code: c, primary: existing.length === 0 && i === 0 }));
          diagnoses = [...existing, ...added];
        }
        const vitals: Record<string, number> | null = b.vitals ? { ...e.vitals, ...(b.vitals as Record<string, number>) } : null;
        if (vitals && vitals.weightKg && vitals.heightCm) vitals.bmi = Math.round((vitals.weightKg / (vitals.heightCm / 100) ** 2) * 10) / 10;
        await tx.query(
          `update encounters set chief_complaint = coalesce($2, chief_complaint), hpi = coalesce($3, hpi), examination = coalesce($4, examination), notes = coalesce($5, notes),
             vitals = coalesce($6, vitals), diagnoses = coalesce($7, diagnoses), follow_up = case when $8::boolean then $9::jsonb else follow_up end, updated_by = $10 where id = $1`,
          [d.encounter_id, b.chiefComplaint ?? null, b.hpi ?? null, b.examination ?? null, b.notes ?? null, vitals ? JSON.stringify(vitals) : null, diagnoses ? JSON.stringify(diagnoses) : null,
            b.followUpDate !== undefined, b.followUpDate ? JSON.stringify({ date: b.followUpDate }) : null, s.userId],
        );
        applied = { fields: Object.keys(b) };
      } else if (d.kind === 'patient_summary') {
        const b = parse(z.object({ text: z.string().min(10).max(5000) }), body);
        await tx.query('update encounters set patient_summary = $2 where id = $1', [d.encounter_id, b.text]);
        applied = { fields: ['patient_summary'] };
      } else {
        const b = parse(z.object({ lines: z.array(z.object({ index: z.number().int(), instructionsAr: z.string().max(500), instructionsEn: z.string().max(500) })).min(1) }), body);
        const rx = await tx.one<{ status: string }>('select status from prescriptions where id = $1 for update', [d.prescription_id]);
        if (rx.status !== 'draft') throw new DomainError('not_draft', HttpStatus.CONFLICT);
        for (const l of b.lines) await tx.query('update prescription_lines set instructions_ar = $3, instructions_en = $4 where prescription_id = $1 and position = $2', [d.prescription_id, l.index, l.instructionsAr, l.instructionsEn]);
        applied = { lines: b.lines.length };
      }
      await tx.query(`update ai_drafts set status = 'approved', decided_at = now(), applied = $2 where id = $1`, [d.id, JSON.stringify(applied)]);
      await this.audit.record(tx, s, meta, { action: 'ai.approve', entity: 'ai_draft', entityId: d.id, patientId: d.patient_id, clinicId: d.clinic_id, details: applied });
      return { ok: true, applied };
    });
  }

  @Post('ai/drafts/:id/reject')
  @Staff('emr:edit')
  @HttpCode(200)
  reject(@Auth() p: Principal, @Param('id') id: string, @Meta() meta: RequestMeta) {
    const s = asStaff(p);
    return this.tenancy.run(s, async (tx) => {
      const d = await tx.maybeOne<{ patient_id: string }>(`update ai_drafts set status = 'rejected', decided_at = now() where id = $1 and doctor_id = $2 and status = 'pending' returning patient_id`, [uuid(id), s.userId]);
      if (!d) throw notFound('draft');
      await this.audit.record(tx, s, meta, { action: 'ai.reject', entity: 'ai_draft', entityId: id, patientId: d.patient_id });
      return { ok: true };
    });
  }
}
