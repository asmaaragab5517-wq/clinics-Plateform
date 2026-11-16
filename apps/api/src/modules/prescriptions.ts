import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Injectable, Param, Post, Query, Res } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Response } from 'express';
import { z } from 'zod';
import { ageInYears, prescriptionSchema } from '@hf/shared';
import type { SecretBox, Tx } from '@hf/db';
import { prescriptionHtml, qrDataUrl, renderPdf } from '@hf/documents';
import { Auth, Meta, Public, Staff, Webhook } from '../common/decorators';
import { asStaff } from '../common/auth.guard';
import type { Principal, RequestMeta } from '../common/principal';
import { AuditService, BOX, Tenancy } from '../common/services';
import { DomainError, forbidden, notFound } from '../common/errors';
import { parse, uuid } from '../common/zod';
import { TokenService } from '../common/tokens';
import { STORAGE, type Storage } from '../integrations/storage';
import { CONFIG, type Config } from '../config';
import { PatientsService } from './patients.service';
import { MessagingService } from './messaging.service';
import { clinicHeader } from './emr';
import { BillingService } from './billing.service';

export interface RxWarning {
  line: number;
  kind: 'allergy' | 'duplicate_ingredient' | 'free_text';
  detail: string;
}

/** FR-RX-3: allergy conflict and duplicate active ingredient checks (interactions are R2). */
export async function safetyChecks(tx: Tx, patientId: string, lines: z.infer<typeof prescriptionSchema>['lines']): Promise<RxWarning[]> {
  const drugIds = lines.map((l) => l.drugId).filter((x): x is string => !!x);
  const drugs = new Map((await tx.query<{ id: string; active_ingredients: string[]; trade_name_en: string }>('select id, active_ingredients, trade_name_en from drugs where id = any($1::uuid[])', [drugIds])).map((d) => [d.id, d]));
  const allergies = await tx.query<{ text: string; ingredient: string | null }>(`select text, ingredient from medical_history_items where patient_id = $1 and kind = 'allergy' and is_active`, [patientId]);
  const meds = await tx.query<{ text: string; ingredient: string | null }>(`select text, ingredient from medical_history_items where patient_id = $1 and kind = 'medication' and is_active`, [patientId]);
  const warnings: RxWarning[] = [];
  const seen = new Map<string, number>();
  for (const [i, l] of lines.entries()) {
    if (!l.drugId) {
      warnings.push({ line: i, kind: 'free_text', detail: 'free_text_drug_not_checked' });
      continue;
    }
    const d = drugs.get(l.drugId);
    if (!d) throw new DomainError('unknown_drug');
    for (const ing of d.active_ingredients.map((x) => x.toLowerCase())) {
      for (const a of allergies) {
        const target = (a.ingredient ?? a.text).toLowerCase();
        if (target && (target === ing || target.includes(ing) || ing.includes(target))) warnings.push({ line: i, kind: 'allergy', detail: `${d.trade_name_en}: ${ing}` });
      }
      if (seen.has(ing)) warnings.push({ line: i, kind: 'duplicate_ingredient', detail: `${ing} (line ${seen.get(ing)! + 1})` });
      seen.set(ing, i);
      for (const m of meds) if ((m.ingredient ?? '').toLowerCase() === ing) warnings.push({ line: i, kind: 'duplicate_ingredient', detail: `${ing} (current medication)` });
    }
  }
  return warnings;
}


@Injectable()
export class PrescriptionRenderer {
  constructor(
    private readonly patients: PatientsService,
    @Inject(STORAGE) private readonly storage: Storage,
    @Inject(BOX) private readonly box: SecretBox,
    @Inject(CONFIG) private readonly cfg: Config,
  ) {}

  async render(tx: Tx, id: string, size: 'A4' | 'A5') {
    const rx = await tx.maybeOne<{ id: string; clinic_id: string; patient_id: string; doctor_id: string; verify_code: string; status: string; issued_at: Date | null; notes: string | null; created_at: Date }>('select * from prescriptions where id = $1', [id]);
    if (!rx) throw notFound('prescription');
    if (rx.status === 'draft') throw new DomainError('prescription_not_issued', HttpStatus.CONFLICT);
    const lines = await tx.query<{ drug_id: string | null; free_text: string | null; dose: string; route: string; frequency: string; duration_days: number | null; quantity: string | null; instructions_ar: string; instructions_en: string; trade_name_en: string | null; strength: string | null }>(
      'select l.*, d.trade_name_en, d.strength from prescription_lines l left join drugs d on d.id = l.drug_id where prescription_id = $1 order by position',
      [id],
    );
    const pt = await tx.one<{ first_name_ar: string; father_name_ar: string; family_name_ar: string; mrn: string; date_of_birth: string }>('select * from patients where id = $1', [rx.patient_id]);
    const doc = await tx.one<{ name_ar: string; name_en: string; title: string; syndicate_number: string; signature_key_enc: Buffer | null; stamp_key_enc: Buffer | null; specialty_ar: string | null; specialty_en: string | null }>(
      `select u.name_ar, u.name_en, d.title, d.syndicate_number, d.signature_key_enc, d.stamp_key_enc,
              (select s.name_ar from doctor_specialties ds join specialties s on s.id = ds.specialty_id where ds.doctor_id = u.id limit 1) as specialty_ar,
              (select s.name_en from doctor_specialties ds join specialties s on s.id = ds.specialty_id where ds.doctor_id = u.id limit 1) as specialty_en
       from users u join doctor_profiles d on d.user_id = u.id where u.id = $1`,
      [rx.doctor_id],
    );
    const image = async (enc: Buffer | null) => {
      if (!enc) return null;
      const obj = await this.storage.get(this.box.decrypt(enc, `doctor:${rx.doctor_id}`));
      return obj ? `data:${obj.contentType};base64,${obj.body.toString('base64')}` : null;
    };
    const verifyUrl = `${this.cfg.PUBLIC_SITE_URL}/verify/rx/${rx.verify_code}`;
    const html = prescriptionHtml({
      size,
      clinic: await clinicHeader(tx, rx.clinic_id),
      doctor: { nameAr: doc.name_ar, nameEn: doc.name_en, title: doc.title, specialtyAr: doc.specialty_ar ?? '', specialtyEn: doc.specialty_en ?? '', syndicateNumber: doc.syndicate_number, signatureDataUrl: await image(doc.signature_key_enc), stampDataUrl: await image(doc.stamp_key_enc) },
      patient: { name: this.patients.fullName(pt), ageYears: ageInYears(pt.date_of_birth), mrn: pt.mrn },
      issuedAt: new Date(rx.issued_at ?? rx.created_at),
      lines: lines.map((l) => ({ drug: l.trade_name_en ? `${l.trade_name_en} ${l.strength ?? ''}`.trim() : (l.free_text ?? ''), dose: l.dose, route: l.route, frequency: l.frequency, durationDays: l.duration_days, quantity: l.quantity, instructionsAr: l.instructions_ar, instructionsEn: l.instructions_en })),
      notes: rx.notes,
      qrDataUrl: await qrDataUrl(verifyUrl),
      verifyUrl: verifyUrl.replace(/^https?:\/\//, ''),
    });
    return { buffer: await renderPdf(html, { size }), patientId: rx.patient_id };
  }
}

@Controller('v1')
export class PrescriptionsController {
  constructor(
    private readonly tenancy: Tenancy,
    private readonly audit: AuditService,
    private readonly patients: PatientsService,
    private readonly messaging: MessagingService,
    private readonly tokens: TokenService,
    private readonly renderer: PrescriptionRenderer,
    private readonly billingSvc: BillingService,
    @Inject(CONFIG) private readonly cfg: Config,
  ) {}

  @Get('drugs')
  @Staff('prescription:view')
  drugs(@Auth() p: Principal, @Query('q') q = '') {
    const term = q.trim().slice(0, 60);
    return this.tenancy.run(p, (tx) =>
      tx.query(
        `select id, trade_name_en, trade_name_ar, active_ingredients, strength, form, manufacturer, price from drugs
         where trade_name_en ilike $1 || '%' or coalesce(trade_name_ar, '') like $1 || '%' or exists (select 1 from unnest(active_ingredients) i where i ilike $1 || '%')
         order by trade_name_en limit 30`,
        [term],
      ),
    );
  }

  @Post('encounters/:id/prescriptions')
  @Staff('prescription:create')
  create(@Auth() p: Principal, @Param('id') encounterId: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const s = asStaff(p);
    const b = parse(prescriptionSchema, body);
    return this.tenancy.run(s, async (tx) => {
      const e = await tx.maybeOne<{ id: string; doctor_id: string; patient_id: string; clinic_id: string }>('select id, doctor_id, patient_id, clinic_id from encounters where id = $1', [uuid(encounterId)]);
      if (!e) throw notFound('encounter');
      if (e.doctor_id !== s.userId) throw forbidden('not_encounter_doctor');
      const warnings = await safetyChecks(tx, e.patient_id, b.lines);
      const rx = await tx.one<{ id: string }>(
        `insert into prescriptions (organisation_id, clinic_id, encounter_id, patient_id, doctor_id, verify_code, notes) values (app_org(), $1,$2,$3,$4,$5,$6) returning *`,
        [e.clinic_id, e.id, e.patient_id, s.userId, randomBytes(12).toString('base64url'), b.notes ?? null],
      );
      for (const [i, l] of b.lines.entries()) {
        await tx.query(
          `insert into prescription_lines (organisation_id, prescription_id, position, drug_id, free_text, dose, route, frequency, duration_days, quantity, instructions_ar, instructions_en, warnings)
           values (app_org(), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [rx.id, i, l.drugId ?? null, l.freeText ?? null, l.dose, l.route, l.frequency, l.durationDays ?? null, l.quantity ?? null, l.instructionsAr, l.instructionsEn, JSON.stringify(warnings.filter((w) => w.line === i))],
        );
      }
      await this.audit.record(tx, s, meta, { action: 'prescription.create', entity: 'prescription', entityId: rx.id, patientId: e.patient_id, clinicId: e.clinic_id, details: { warnings: warnings.length } });
      return { ...rx, warnings };
    });
  }

  /** Issue (sign) a prescription. Safety warnings must be acknowledged explicitly. */
  @Post('prescriptions/:id/issue')
  @Staff('prescription:approve')
  @HttpCode(200)
  issue(@Auth() p: Principal, @Param('id') id: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const s = asStaff(p);
    const b = parse(z.object({ acknowledgeWarnings: z.boolean().default(false) }), body ?? {});
    if (!s.authTime || Date.now() / 1000 - s.authTime > 12 * 3600) throw new DomainError('reauthentication_required', HttpStatus.UNAUTHORIZED);
    return this.tenancy.run(s, async (tx) => {
      const rx = await tx.maybeOne<{ id: string; doctor_id: string; patient_id: string; status: string; clinic_id: string }>('select * from prescriptions where id = $1 for update', [uuid(id)]);
      if (!rx) throw notFound('prescription');
      if (rx.doctor_id !== s.userId) throw forbidden('not_prescriber');
      if (rx.status !== 'draft') throw new DomainError('not_draft', HttpStatus.CONFLICT);
      const flagged = await tx.query(`select 1 from prescription_lines where prescription_id = $1 and jsonb_array_length(warnings) > 0 and not (warnings @> '[{"kind":"free_text"}]' and jsonb_array_length(warnings) = 1)`, [id]);
      if (flagged.length && !b.acknowledgeWarnings) throw new DomainError('warnings_not_acknowledged', HttpStatus.CONFLICT);
      const r = await tx.one(`update prescriptions set status = 'issued', issued_at = now() where id = $1 returning *`, [id]);
      const link = `${this.cfg.API_PUBLIC_URL}/v1/share/rx/${this.tokens.signShareLink('rx', id)}`;
      await this.messaging.enqueue(tx, { event: 'prescription_shared', patientId: rx.patient_id, clinicId: rx.clinic_id, dedupeKey: `rx:${id}`, vars: { link } });
      await this.audit.record(tx, s, meta, { action: 'prescription.issue', entity: 'prescription', entityId: id, patientId: rx.patient_id, details: { acknowledgedWarnings: flagged.length } });
      return { ...r, shareLink: link };
    });
  }

  @Post('prescriptions/:id/revoke')
  @Staff('prescription:approve')
  @HttpCode(200)
  revoke(@Auth() p: Principal, @Param('id') id: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const s = asStaff(p);
    const b = parse(z.object({ reason: z.string().min(3) }), body);
    return this.tenancy.run(s, async (tx) => {
      const r = await tx.maybeOne<{ patient_id: string }>(`update prescriptions set status = 'revoked' where id = $1 and doctor_id = $2 and status = 'issued' returning patient_id`, [uuid(id), s.userId]);
      if (!r) throw notFound('prescription');
      await this.audit.record(tx, s, meta, { action: 'prescription.revoke', entity: 'prescription', entityId: id, patientId: r.patient_id, reason: b.reason });
      return { ok: true };
    });
  }

  @Get('prescriptions/:id/pdf')
  @Staff('prescription:view')
  async pdf(@Auth() p: Principal, @Param('id') id: string, @Query('size') size: string | undefined, @Meta() meta: RequestMeta, @Res() res: Response) {
    const pdf = await this.tenancy.run(p, async (tx) => {
      const pdf = await this.render(tx, uuid(id), size === 'A4' ? 'A4' : 'A5');
      await this.audit.record(tx, p, meta, { action: 'prescription.print', entity: 'prescription', entityId: id, patientId: pdf.patientId });
      return pdf.buffer;
    });
    res.setHeader('content-type', 'application/pdf').setHeader('cache-control', 'no-store').send(pdf);
  }

  /** Expiring signed link shared over WhatsApp / portal (FR-RX-6). */
  @Get('share/rx/:token')
  @Webhook()
  async shared(@Param('token') token: string, @Res() res: Response) {
    const id = this.tokens.verifyShareLink('rx', token);
    if (!id) throw notFound('link');
    const orgId = (await this.tenancy.db.raw<{ organisation_id: string }>('select organisation_id from verify_rx_org($1)', [id]))[0]?.organisation_id;
    if (!orgId) throw notFound('link');
    const pdf = await this.tenancy.system(orgId, async (tx) => {
      const r = await this.render(tx, id, 'A5');
      await this.audit.record(tx, null, null, { action: 'prescription.share_open', entity: 'prescription', entityId: id, patientId: r.patientId });
      return r.buffer;
    });
    res.setHeader('content-type', 'application/pdf').setHeader('cache-control', 'no-store, private').setHeader('x-robots-tag', 'noindex').send(pdf);
  }

  @Get('share/invoice/:token')
  @Webhook()
  async sharedInvoice(@Param('token') token: string, @Res() res: Response) {
    const v = this.tokens.verifyShareLink('invoice', token);
    const [orgId, billId] = v?.split(':') ?? [];
    if (!orgId || !billId) throw notFound('link');
    const html = await this.tenancy.system(orgId, async (tx) => {
      const { invoiceDocument } = await import('./billing');
      return (await invoiceDocument(tx, this.billingSvc, this.patients, billId, 'invoice')).html;
    });
    res.setHeader('content-type', 'application/pdf').setHeader('cache-control', 'no-store, private').send(await renderPdf(html));
  }

  /** Public verification page data: validity only, never contents (FR-RX-5). */
  @Get('public/verify/rx/:code')
  @Public()
  async verify(@Param('code') code: string) {
    const r = (await this.tenancy.db.raw<{ valid: boolean; issued_at: Date; doctor_name: string; clinic_name: string }>('select * from verify_prescription($1)', [code.slice(0, 40)]))[0];
    if (!r) return { valid: false };
    return { valid: r.valid, issuedAt: r.issued_at, doctor: r.doctor_name, clinic: r.clinic_name };
  }

  @Get('prescription-templates')
  @Staff('prescription:view')
  templates(@Auth() p: Principal) {
    const s = asStaff(p);
    return this.tenancy.run(s, (tx) => tx.query('select * from prescription_templates where doctor_id is null or doctor_id = $1 order by name', [s.userId]));
  }

  @Post('prescription-templates')
  @Staff('prescription:create')
  createTemplate(@Auth() p: Principal, @Body() body: unknown) {
    const s = asStaff(p);
    const b = parse(z.object({ name: z.string().min(2).max(100), diagnosisCode: z.string().optional(), lines: prescriptionSchema.shape.lines }), body);
    return this.tenancy.run(s, (tx) =>
      tx.one('insert into prescription_templates (organisation_id, doctor_id, name, diagnosis_code, lines) values (app_org(), $1,$2,$3,$4) returning *', [s.userId, b.name, b.diagnosisCode ?? null, JSON.stringify(b.lines)]),
    );
  }

  render(tx: Tx, id: string, size: 'A4' | 'A5') {
    return this.renderer.render(tx, id, size);
  }
}
