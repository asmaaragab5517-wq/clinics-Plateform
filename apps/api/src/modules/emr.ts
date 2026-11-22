import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, Patch, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { createHash, randomUUID } from 'node:crypto';
import type { Response } from 'express';
import { z } from 'zod';
import { ageInYears, encounterUpdateSchema, mergeDentalCharts, orderSchema, treatmentPlan, vitalsSchema, type DentalChart } from '@hf/shared';
import type { Tx } from '@hf/db';
import { labOrderHtml, renderPdf, visitSummaryHtml } from '@hf/documents';
import { Auth, Meta, Staff } from '../common/decorators';
import { asStaff } from '../common/auth.guard';
import type { Principal, RequestMeta, StaffPrincipal } from '../common/principal';
import { AuditService, Tenancy } from '../common/services';
import { DomainError, badRequest, forbidden, notFound } from '../common/errors';
import { parse, uuid } from '../common/zod';
import { ANTIVIRUS, MAX_UPLOAD_BYTES, STORAGE, sniffMime, type Antivirus, type Storage } from '../integrations/storage';
import { PatientsService } from './patients.service';
import { visiblePatient } from './patients';
import { MessagingService } from './messaging.service';

const SIGN_OFF_MAX_AUTH_AGE_S = 12 * 3600; // IAM-3

export interface EncounterRow {
  id: string; clinic_id: string; doctor_id: string; patient_id: string; appointment_id: string | null; status: 'open' | 'signed'; vitals: Record<string, number>;
  chief_complaint: string; hpi: string; examination: string; notes: string; diagnoses: { code: string; primary: boolean }[]; follow_up: { date: string; serviceId?: string; note?: string } | null; created_at: Date; signed_at: Date | null;
}

export async function clinicHeader(tx: Tx, clinicId: string) {
  const c = await tx.one<{ name_ar: string; name_en: string; address_lines: string; city: string; phones: string[] }>('select name_ar, name_en, address_lines, city, phones from clinics where id = $1', [clinicId]);
  return { nameAr: c.name_ar, nameEn: c.name_en, address: [c.address_lines, c.city].filter(Boolean).join('، '), phones: c.phones };
}

/** Document upload pipeline shared by staff and patient uploads (FR-EMR-6, SEC-4). */
export async function storeDocument(
  deps: { storage: Storage; av: Antivirus },
  tx: Tx,
  input: { orgId: string; patientId: string; encounterId?: string | null; orderId?: string | null; title: string; kind: string; file: { buffer: Buffer; size: number } | undefined; patientProvided: boolean; actorId: string | null },
) {
  if (!input.file) throw badRequest('file_required');
  if (input.file.size > MAX_UPLOAD_BYTES) throw badRequest('file_too_large');
  const mime = sniffMime(input.file.buffer);
  if (!mime) throw badRequest('unsupported_file_type');
  const scan = await deps.av.scan(input.file.buffer);
  if (scan === 'infected') throw new DomainError('file_infected', HttpStatus.UNPROCESSABLE_ENTITY);
  if (scan === 'error') throw new DomainError('antivirus_unavailable', HttpStatus.SERVICE_UNAVAILABLE);
  const key = `org/${input.orgId}/patients/${input.patientId}/${randomUUID()}`;
  await deps.storage.put(key, input.file.buffer, mime);
  return tx.one<{ id: string }>(
    `insert into documents (organisation_id, patient_id, encounter_id, order_id, kind, title, storage_key, mime, size_bytes, sha256, scan_status, patient_provided, created_by)
     values (app_org(), $1,$2,$3,$4,$5,$6,$7,$8,$9,'clean',$10,$11) returning id, title, kind, mime, size_bytes, patient_provided, created_at`,
    [input.patientId, input.encounterId ?? null, input.orderId ?? null, input.kind, input.title.slice(0, 200), key, mime, input.file.size, createHash('sha256').update(input.file.buffer).digest('hex'), input.patientProvided, input.actorId],
  );
}

@Controller('v1')
export class EmrController {
  constructor(
    private readonly tenancy: Tenancy,
    private readonly audit: AuditService,
    private readonly patients: PatientsService,
    private readonly messaging: MessagingService,
    @Inject(STORAGE) private readonly storage: Storage,
    @Inject(ANTIVIRUS) private readonly av: Antivirus,
  ) {}

  private async load(tx: Tx, s: StaffPrincipal, id: string, meta: RequestMeta, action = 'emr.read'): Promise<EncounterRow> {
    const e = await tx.maybeOne<EncounterRow>('select * from encounters where id = $1', [uuid(id)]);
    if (!e) throw notFound('encounter');
    const own = e.doctor_id === s.userId;
    if (!own && !(await this.patients.canViewEmr(tx, s, e.patient_id))) throw forbidden('emr_access_denied');
    // MT-3: every cross-clinic access is audited explicitly.
    const crossClinic = !s.clinicIds.includes(e.clinic_id);
    await this.audit.record(tx, s, meta, { action, entity: 'encounter', entityId: id, patientId: e.patient_id, clinicId: e.clinic_id, details: crossClinic ? { crossClinic: true } : null });
    return e;
  }

  @Get('patients/:patientId/encounters')
  @Staff()
  list(@Auth() p: Principal, @Param('patientId') patientId: string, @Meta() meta: RequestMeta) {
    const s = asStaff(p);
    return this.tenancy.run(s, async (tx) => {
      await visiblePatient(tx, patientId);
      if (!(await this.patients.canViewEmr(tx, s, patientId))) throw forbidden('emr_access_denied');
      const rows = await tx.query(
        `select e.id, e.appointment_id, e.clinic_id, c.name_ar as clinic_name, e.doctor_id, u.name_ar as doctor_name, e.status, e.chief_complaint, e.diagnoses, e.created_at, e.signed_at
         from encounters e join users u on u.id = e.doctor_id join clinics c on c.id = e.clinic_id where e.patient_id = $1 order by e.created_at desc`,
        [uuid(patientId)],
      );
      const cross = rows.filter((r) => !s.clinicIds.includes(r.clinic_id as string)).length;
      await this.audit.record(tx, s, meta, { action: 'emr.list', entity: 'patient', entityId: patientId, patientId, details: { count: rows.length, crossClinic: cross } });
      return rows;
    });
  }

  @Get('encounters/:id')
  @Staff()
  get(@Auth() p: Principal, @Param('id') id: string, @Meta() meta: RequestMeta) {
    const s = asStaff(p);
    return this.tenancy.run(s, async (tx) => {
      const e = await this.load(tx, s, id, meta);
      const [addenda, orders, documents, prescriptions] = await Promise.all([
        tx.query('select a.*, u.name_ar as author from addenda a join users u on u.id = a.created_by where encounter_id = $1 order by created_at', [id]),
        tx.query('select * from orders where encounter_id = $1 order by created_at', [id]),
        tx.query('select id, title, kind, mime, size_bytes, patient_provided, created_at, order_id from documents where encounter_id = $1 order by created_at', [id]),
        tx.query('select id, status, verify_code, issued_at from prescriptions where encounter_id = $1 order by created_at', [id]),
      ]);
      const allergies = await tx.query(`select text, severity, ingredient from medical_history_items where patient_id = $1 and kind = 'allergy' and is_active`, [e.patient_id]);
      return { ...e, addenda, orders, documents, prescriptions, allergies };
    });
  }

  @Patch('encounters/:id')
  @Staff('emr:edit')
  update(@Auth() p: Principal, @Param('id') id: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const s = asStaff(p);
    const b = parse(encounterUpdateSchema, body);
    return this.tenancy.run(s, async (tx) => {
      const e = await this.load(tx, s, id, meta, 'emr.write');
      if (e.status === 'signed') throw new DomainError('encounter_signed_use_addendum', HttpStatus.CONFLICT);
      if (e.doctor_id !== s.userId) throw forbidden('not_encounter_doctor');
      if (!(await this.patients.hasHealthConsent(tx, e.patient_id))) throw new DomainError('health_data_consent_required');
      if (b.diagnoses?.length) {
        const known = await tx.query<{ code: string }>('select code from icd10_codes where code = any($1)', [b.diagnoses.map((d) => d.code)]);
        if (known.length !== new Set(b.diagnoses.map((d) => d.code)).size) throw badRequest('unknown_icd10_code');
      }
      const vitals = b.vitals ? withBmi({ ...e.vitals, ...b.vitals }) : null;
      // FR-EMR-2: body chart kept as vector JSON plus a rendered PNG in private storage.
      if (b.bodyChart?.pngDataUrl) {
        const png = Buffer.from(b.bodyChart.pngDataUrl.split(',')[1] ?? '', 'base64');
        if (sniffMime(png) !== 'image/png') throw badRequest('invalid_png');
        const key = `org/${s.orgId}/patients/${e.patient_id}/bodychart-${id}-${Date.now()}.png`;
        await this.storage.put(key, png, 'image/png');
        const { pngDataUrl: _drop, ...rest } = b.bodyChart;
        b.bodyChart = { ...rest, pngKey: key } as typeof b.bodyChart;
      } else if (b.bodyChart) {
        // Shapes saved without a new rendering keep the previously stored image reference.
        const prev = await tx.maybeOne<{ key: string | null }>(`select body_chart->>'pngKey' as key from encounters where id = $1`, [id]);
        if (prev?.key) b.bodyChart = { ...b.bodyChart, pngKey: prev.key } as typeof b.bodyChart;
      }
      return tx.one(
        `update encounters set vitals = coalesce($2, vitals), chief_complaint = coalesce($3, chief_complaint), hpi = coalesce($4, hpi), examination = coalesce($5, examination),
           notes = coalesce($6, notes), diagnoses = coalesce($7, diagnoses), problems = coalesce($8, problems), observations = coalesce($9, observations),
           body_chart = coalesce($10, body_chart), follow_up = case when $11::boolean then $12::jsonb else follow_up end, updated_by = $13,
           dental_chart = case when $15::boolean then $14::jsonb else dental_chart end where id = $1 returning *`,
        [id, vitals ? JSON.stringify(vitals) : null, b.chiefComplaint ?? null, b.hpi ?? null, b.examination ?? null, b.notes ?? null,
          b.diagnoses ? JSON.stringify(b.diagnoses) : null, b.problems ? JSON.stringify(b.problems) : null, b.observations ? JSON.stringify(b.observations) : null,
          b.bodyChart ? JSON.stringify(b.bodyChart) : null, b.followUp !== undefined, b.followUp ? JSON.stringify(b.followUp) : null, s.userId,
          b.dentalChart ? JSON.stringify(b.dentalChart) : null, b.dentalChart !== undefined],
      );
    });
  }

  /** Nurses record vitals and triage (SRS §4). */
  @Post('encounters/:id/vitals')
  @Staff('emr:create')
  @HttpCode(200)
  vitals(@Auth() p: Principal, @Param('id') id: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const s = asStaff(p);
    const v = parse(vitalsSchema, body);
    return this.tenancy.run(s, async (tx) => {
      const e = await this.load(tx, s, id, meta, 'emr.vitals');
      if (e.status === 'signed') throw new DomainError('encounter_signed_use_addendum', HttpStatus.CONFLICT);
      return tx.one('update encounters set vitals = $2, updated_by = $3 where id = $1 returning id, vitals', [id, JSON.stringify(withBmi({ ...e.vitals, ...v })), s.userId]);
    });
  }

  /** FR-EMR-7 sign-off lock; IAM-3 fresh authentication within 12 hours. */
  @Post('encounters/:id/sign')
  @Staff('emr:approve')
  @HttpCode(200)
  sign(@Auth() p: Principal, @Param('id') id: string, @Meta() meta: RequestMeta) {
    const s = asStaff(p);
    if (!s.authTime || Date.now() / 1000 - s.authTime > SIGN_OFF_MAX_AUTH_AGE_S) throw new DomainError('reauthentication_required', HttpStatus.UNAUTHORIZED);
    return this.tenancy.run(s, async (tx) => {
      const e = await this.load(tx, s, id, meta, 'emr.sign');
      if (e.doctor_id !== s.userId) throw forbidden('not_encounter_doctor');
      if (e.status === 'signed') throw new DomainError('already_signed', HttpStatus.CONFLICT);
      if (!e.diagnoses?.length) throw new DomainError('diagnosis_required');
      const r = await tx.one(`update encounters set status = 'signed', signed_at = now(), signed_by = $2 where id = $1 returning *`, [id, s.userId]);
      if (e.follow_up?.date) {
        await tx.query(
          `insert into follow_ups (organisation_id, clinic_id, doctor_id, patient_id, encounter_id, service_id, due_date, note) values (app_org(), $1,$2,$3,$4,$5,$6,$7)`,
          [e.clinic_id, e.doctor_id, e.patient_id, id, e.follow_up.serviceId ?? null, e.follow_up.date, e.follow_up.note ?? null],
        );
      }
      if (e.appointment_id) {
        const a = await tx.maybeOne<{ status: string }>('select status from appointments where id = $1', [e.appointment_id]);
        if (a?.status === 'in_consultation') {
          await tx.query(`update appointments set status = 'completed' where id = $1`, [e.appointment_id]);
          await tx.query(`insert into appointment_events (organisation_id, clinic_id, appointment_id, from_status, to_status, actor_type, actor_id) values (app_org(), $1, $2, 'in_consultation', 'completed', 'staff', $3)`, [e.clinic_id, e.appointment_id, s.userId]);
          await tx.query(`update queue_tickets set status = 'done', done_at = now() where appointment_id = $1`, [e.appointment_id]);
        }
      }
      return r;
    });
  }

  @Post('encounters/:id/addenda')
  @Staff('emr:edit')
  addendum(@Auth() p: Principal, @Param('id') id: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const s = asStaff(p);
    const b = parse(z.object({ body: z.string().min(1).max(20000) }), body);
    return this.tenancy.run(s, async (tx) => {
      const e = await this.load(tx, s, id, meta, 'emr.addendum');
      if (e.status !== 'signed') throw new DomainError('encounter_not_signed', HttpStatus.CONFLICT);
      return tx.one('insert into addenda (organisation_id, encounter_id, patient_id, body, created_by) values (app_org(), $1,$2,$3,$4) returning *', [id, e.patient_id, b.body, s.userId]);
    });
  }

  @Post('encounters/:id/patient-summary')
  @Staff('emr:edit')
  @HttpCode(200)
  patientSummary(@Auth() p: Principal, @Param('id') id: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const s = asStaff(p);
    const b = parse(z.object({ text: z.string().min(1).max(5000) }), body);
    return this.tenancy.run(s, async (tx) => {
      const e = await this.load(tx, s, id, meta, 'emr.patient_summary');
      if (e.doctor_id !== s.userId) throw forbidden('not_encounter_doctor');
      await tx.query('update encounters set patient_summary = $2 where id = $1', [id, b.text]);
      return { ok: true };
    });
  }

  /** Current dental status: visit charts merged oldest to newest, plus the open treatment plan (FR-EMR-3). */
  @Get('patients/:patientId/dental-chart')
  @Staff()
  dental(@Auth() p: Principal, @Param('patientId') patientId: string, @Meta() meta: RequestMeta) {
    const s = asStaff(p);
    return this.tenancy.run(s, async (tx) => {
      await visiblePatient(tx, patientId);
      if (!(await this.patients.canViewEmr(tx, s, patientId))) throw forbidden('emr_access_denied');
      const rows = await tx.query<{ id: string; dental_chart: DentalChart; created_at: Date; status: string }>(
        `select id, dental_chart, created_at, status from encounters where patient_id = $1 and dental_chart is not null order by created_at`,
        [patientId],
      );
      let chart: DentalChart | null = null;
      for (const r of rows) chart = mergeDentalCharts(chart, r.dental_chart);
      await this.audit.record(tx, s, meta, { action: 'emr.dental_chart_read', entity: 'patient', entityId: patientId, patientId });
      return { chart, treatmentPlan: chart ? treatmentPlan(chart) : [], visits: rows.map((r) => ({ encounterId: r.id, at: r.created_at, status: r.status })) };
    });
  }

  @Get('encounters/:id/body-chart.png')
  @Staff()
  async bodyChartPng(@Auth() p: Principal, @Param('id') id: string, @Meta() meta: RequestMeta) {
    const s = asStaff(p);
    const key = await this.tenancy.run(s, async (tx) => {
      const e = await this.load(tx, s, id, meta, 'emr.body_chart');
      return (e as unknown as { body_chart: { pngKey?: string } | null }).body_chart?.pngKey ?? null;
    });
    if (!key) throw notFound('body_chart');
    return { url: await this.storage.signedUrl(key, 300), expiresInSeconds: 300 };
  }

  @Get('encounters/:id/summary.pdf')
  @Staff('emr:view')
  async summaryPdf(@Auth() p: Principal, @Param('id') id: string, @Meta() meta: RequestMeta, @Res() res: Response) {
    const s = asStaff(p);
    const html = await this.tenancy.run(s, async (tx) => {
      const e = await this.load(tx, s, id, meta, 'emr.print');
      const pt = await tx.one<{ first_name_ar: string; father_name_ar: string; family_name_ar: string; mrn: string; date_of_birth: string }>('select * from patients where id = $1', [e.patient_id]);
      const doc = await tx.one<{ name_ar: string }>('select name_ar from users where id = $1', [e.doctor_id]);
      const codes = await tx.query<{ code: string; title_ar: string | null; title_en: string }>('select code, title_ar, title_en from icd10_codes where code = any($1)', [e.diagnoses.map((d) => d.code)]);
      return visitSummaryHtml({
        clinic: await clinicHeader(tx, e.clinic_id), doctor: doc.name_ar,
        patient: { name: this.patients.fullName(pt), mrn: pt.mrn, ageYears: ageInYears(pt.date_of_birth) }, date: new Date(e.created_at),
        chiefComplaint: e.chief_complaint, diagnoses: codes.map((c) => ({ code: c.code, title: c.title_ar ?? c.title_en })), vitals: e.vitals, plan: e.notes, followUp: e.follow_up?.date ?? null,
        dental: (e as unknown as { dental_chart: DentalChart | null }).dental_chart?.teeth.map((t) => ({ tooth: t.tooth, status: t.status, conditions: t.conditions.map((c) => `${c.type}${c.surfaces?.length ? ` (${c.surfaces.join('')})` : ''}`).join('، '), planned: t.planned.filter((x) => !x.done).map((x) => x.procedure).join('، ') })) ?? null,
      });
    });
    const pdf = await renderPdf(html);
    res.setHeader('content-type', 'application/pdf').setHeader('cache-control', 'no-store').send(pdf);
  }

  // ---- Orders (FR-EMR-5)
  @Post('encounters/:id/orders')
  @Staff('emr:create')
  createOrder(@Auth() p: Principal, @Param('id') id: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const s = asStaff(p);
    const b = parse(orderSchema, body);
    return this.tenancy.run(s, async (tx) => {
      const e = await this.load(tx, s, id, meta, 'emr.order');
      const tests = await tx.query<{ code: string }>('select code from lab_tests where code = any($1) and kind = $2', [b.testCodes, b.kind]);
      if (tests.length !== b.testCodes.length) throw badRequest('unknown_test_code');
      return tx.one('insert into orders (organisation_id, encounter_id, patient_id, kind, test_codes, note, created_by) values (app_org(), $1,$2,$3,$4,$5,$6) returning *', [id, e.patient_id, b.kind, b.testCodes, b.note ?? null, s.userId]);
    });
  }

  @Get('orders/:id/request.pdf')
  @Staff('emr:view')
  async orderPdf(@Auth() p: Principal, @Param('id') id: string, @Meta() meta: RequestMeta, @Res() res: Response) {
    const s = asStaff(p);
    const html = await this.tenancy.run(s, async (tx) => {
      const o = await tx.maybeOne<{ encounter_id: string; kind: 'lab' | 'radiology'; test_codes: string[]; note: string | null; created_at: Date }>('select * from orders where id = $1', [uuid(id)]);
      if (!o) throw notFound('order');
      const e = await this.load(tx, s, o.encounter_id, meta, 'emr.order_print');
      const pt = await tx.one<{ first_name_ar: string; father_name_ar: string; family_name_ar: string; mrn: string }>('select * from patients where id = $1', [e.patient_id]);
      const doc = await tx.one<{ name_ar: string }>('select name_ar from users where id = $1', [e.doctor_id]);
      const tests = await tx.query<{ code: string; name_ar: string; name_en: string }>('select * from lab_tests where code = any($1)', [o.test_codes]);
      return labOrderHtml({ clinic: await clinicHeader(tx, e.clinic_id), doctor: doc.name_ar, patient: { name: this.patients.fullName(pt), mrn: pt.mrn }, date: new Date(o.created_at), kind: o.kind, tests: tests.map((t) => ({ code: t.code, nameAr: t.name_ar, nameEn: t.name_en })), note: o.note });
    });
    res.setHeader('content-type', 'application/pdf').setHeader('cache-control', 'no-store').send(await renderPdf(html, { size: 'A5' }));
  }

  @Post('orders/:id/result')
  @Staff('emr:create')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  orderResult(@Auth() p: Principal, @Param('id') id: string, @UploadedFile() file: { buffer: Buffer; size: number } | undefined, @Body() body: { title?: string }, @Meta() meta: RequestMeta) {
    const s = asStaff(p);
    return this.tenancy.run(s, async (tx) => {
      const o = await tx.maybeOne<{ id: string; encounter_id: string; patient_id: string; status: string }>('select * from orders where id = $1 for update', [uuid(id)]);
      if (!o) throw notFound('order');
      await this.load(tx, s, o.encounter_id, meta, 'emr.order_result');
      const d = await storeDocument({ storage: this.storage, av: this.av }, tx, { orgId: s.orgId, patientId: o.patient_id, encounterId: o.encounter_id, orderId: o.id, title: body?.title ?? 'Result', kind: 'result', file, patientProvided: false, actorId: s.userId });
      await tx.query(`update orders set status = 'result_received' where id = $1 and status = 'ordered'`, [id]);
      await this.messaging.enqueue(tx, { event: 'report_ready', patientId: o.patient_id, dedupeKey: `result:${d.id}`, data: { path: '/reports' }, vars: { link: 'portal/reports' } });
      return d;
    });
  }

  @Post('orders/:id/review')
  @Staff('emr:approve')
  @HttpCode(200)
  reviewOrder(@Auth() p: Principal, @Param('id') id: string, @Meta() meta: RequestMeta) {
    const s = asStaff(p);
    return this.tenancy.run(s, async (tx) => {
      const o = await tx.maybeOne<{ encounter_id: string }>(`update orders set status = 'reviewed', reviewed_at = now(), reviewed_by = $2 where id = $1 and status = 'result_received' returning encounter_id`, [uuid(id), s.userId]);
      if (!o) throw new DomainError('order_not_ready', HttpStatus.CONFLICT);
      await this.load(tx, s, o.encounter_id, meta, 'emr.order_review');
      return { ok: true };
    });
  }

  // ---- Documents (FR-EMR-6)
  @Post('patients/:patientId/documents')
  @Staff('emr:create')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  upload(@Auth() p: Principal, @Param('patientId') patientId: string, @UploadedFile() file: { buffer: Buffer; size: number } | undefined, @Body() body: { title?: string; kind?: string; encounterId?: string }, @Meta() meta: RequestMeta) {
    const s = asStaff(p);
    return this.tenancy.run(s, async (tx) => {
      const pt = await tx.maybeOne('select id from patients where id = $1', [uuid(patientId)]);
      if (!pt) throw notFound('patient');
      const d = await storeDocument({ storage: this.storage, av: this.av }, tx, { orgId: s.orgId, patientId, encounterId: body?.encounterId ? uuid(body.encounterId) : null, title: body?.title ?? 'Document', kind: body?.kind ?? 'report', file, patientProvided: false, actorId: s.userId });
      await this.audit.record(tx, s, meta, { action: 'document.upload', entity: 'document', entityId: d.id, patientId });
      return d;
    });
  }

  /**
   * Upload the file for a patient's `file` custom field (registration attachments such as an ID copy or a referral letter).
   * Needs `patient:edit` only, so reception can attach it without clinical-record privileges; the stored document is
   * linked from the field and can be opened through the field's own link below.
   */
  @Post('patients/:patientId/custom-fields/:key/file')
  @Staff('patient:edit')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  uploadFieldFile(@Auth() p: Principal, @Param('patientId') patientId: string, @Param('key') key: string, @UploadedFile() file: { buffer: Buffer; size: number; originalname?: string } | undefined, @Meta() meta: RequestMeta) {
    const s = asStaff(p);
    return this.tenancy.run(s, async (tx) => {
      const pt = await tx.maybeOne('select id from patients where id = $1 and anonymised_at is null', [uuid(patientId)]);
      if (!pt) throw notFound('patient');
      const def = await tx.maybeOne<{ label_en: string | null; label_ar: string }>(`select label_ar, label_en from custom_field_defs where entity = 'patient' and type = 'file' and key = $1`, [key]);
      if (!def) throw notFound('custom_field');
      const name = (Buffer.from(file?.originalname ?? 'file', 'latin1').toString('utf8') || 'file').slice(0, 255);
      const d = await storeDocument({ storage: this.storage, av: this.av }, tx, { orgId: s.orgId, patientId, title: `${def.label_en || def.label_ar} - ${name}`, kind: 'custom_field', file, patientProvided: false, actorId: s.userId });
      await tx.query(`update patients set custom_fields = custom_fields || jsonb_build_object($2::text, jsonb_build_object('documentId', $3::text, 'name', $4::text)) where id = $1`, [patientId, key, d.id, name]);
      await this.audit.record(tx, s, meta, { action: 'patient.custom_field_file', entity: 'patient', entityId: patientId, patientId, details: { key, documentId: d.id } });
      return { key, documentId: d.id, name };
    });
  }

  /** Signed link (5 minutes) to the file held in a patient's custom field; anyone who can see the patient may open it. */
  @Get('patients/:patientId/custom-fields/:key/file')
  @Staff('patient:view')
  async fieldFileUrl(@Auth() p: Principal, @Param('patientId') patientId: string, @Param('key') key: string, @Meta() meta: RequestMeta) {
    const d = await this.tenancy.run(p, async (tx) => {
      const row = await tx.maybeOne<{ storage_key: string; title: string; id: string }>(
        `select d.id, d.storage_key, d.title from patients pt join documents d on d.id = (pt.custom_fields -> $2 ->> 'documentId')::uuid and d.patient_id = pt.id
         where pt.id = $1 and d.scan_status = 'clean'`,
        [uuid(patientId), key],
      );
      if (!row) throw notFound('document');
      await this.audit.record(tx, p, meta, { action: 'document.access', entity: 'document', entityId: row.id, patientId });
      return row;
    });
    return { url: await this.storage.signedUrl(d.storage_key, 300, d.title), expiresInSeconds: 300 };
  }

  @Get('patients/:patientId/documents')
  @Staff()
  documents(@Auth() p: Principal, @Param('patientId') patientId: string, @Meta() meta: RequestMeta) {
    return this.tenancy.run(p, async (tx) => {
      await visiblePatient(tx, patientId);
      if (!(await this.patients.canViewEmr(tx, p, patientId))) throw forbidden('emr_access_denied');
      const rows = await tx.query('select id, title, kind, mime, size_bytes, patient_provided, encounter_id, order_id, created_at from documents where patient_id = $1 order by created_at desc', [patientId]);
      await this.audit.record(tx, p, meta, { action: 'document.list', entity: 'patient', entityId: patientId, patientId });
      return rows;
    });
  }

  /** Signed URL valid 5 minutes; every access audited. */
  @Get('documents/:id/url')
  @Staff('emr:view')
  async documentUrl(@Auth() p: Principal, @Param('id') id: string, @Meta() meta: RequestMeta) {
    const d = await this.tenancy.run(p, async (tx) => {
      const row = await tx.maybeOne<{ storage_key: string; patient_id: string; title: string }>('select storage_key, patient_id, title from documents where id = $1 and scan_status = $2', [uuid(id), 'clean']);
      if (!row) throw notFound('document');
      await this.audit.record(tx, p, meta, { action: 'document.access', entity: 'document', entityId: id, patientId: row.patient_id });
      return row;
    });
    return { url: await this.storage.signedUrl(d.storage_key, 300, d.title), expiresInSeconds: 300 };
  }

  // ---- Reference lookups
  @Get('icd10')
  @Staff('emr:view')
  icd10(@Auth() p: Principal, @Query('q') q = '') {
    const term = q.trim().slice(0, 50);
    return this.tenancy.run(p, (tx) =>
      tx.query(`select code, title_en, title_ar from icd10_codes where code ilike $1 || '%' or title_en ilike '%' || $1 || '%' or coalesce(title_ar, '') like '%' || $1 || '%' order by code limit 30`, [term]),
    );
  }

  @Get('lab-tests')
  @Staff('emr:view')
  labTests(@Auth() p: Principal) {
    return this.tenancy.run(p, (tx) => tx.query('select * from lab_tests order by kind, code'));
  }

  @Get('encounter-templates')
  @Staff('emr:view')
  templates(@Auth() p: Principal) {
    const s = asStaff(p);
    return this.tenancy.run(s, (tx) =>
      tx.query('select t.*, sp.slug as specialty_slug from encounter_templates t left join specialties sp on sp.id = t.specialty_id where t.doctor_id is null or t.doctor_id = $1 order by t.name_ar', [s.userId]),
    );
  }

  @Post('encounter-templates')
  @Staff('emr:edit')
  createTemplate(@Auth() p: Principal, @Body() body: unknown) {
    const s = asStaff(p);
    const b = parse(z.object({ nameAr: z.string().min(2), nameEn: z.string().default(''), specialtyId: z.string().uuid().optional(), sections: z.array(z.string()).min(1), defaults: z.record(z.string()).default({}), commonDiagnoses: z.array(z.string()).default([]), personal: z.boolean().default(true) }), body);
    return this.tenancy.run(s, (tx) =>
      tx.one(
        'insert into encounter_templates (organisation_id, specialty_id, doctor_id, name_ar, name_en, sections, defaults, common_diagnoses) values (app_org(), $1,$2,$3,$4,$5,$6,$7) returning *',
        [b.specialtyId ?? null, b.personal ? s.userId : null, b.nameAr, b.nameEn, JSON.stringify(b.sections), JSON.stringify(b.defaults), b.commonDiagnoses],
      ),
    );
  }

  /** Doctors edit and delete their own personal templates; organisation templates need `settings:edit`. */
  @Patch('encounter-templates/:id')
  @Staff('emr:edit')
  updateTemplate(@Auth() p: Principal, @Param('id') id: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const s = asStaff(p);
    const b = parse(
      z.object({ nameAr: z.string().min(2).optional(), nameEn: z.string().optional(), specialtyId: z.string().uuid().nullable().optional(), sections: z.array(z.string()).min(1).optional(), defaults: z.record(z.string()).optional(), commonDiagnoses: z.array(z.string()).optional() }),
      body,
    );
    return this.tenancy.run(s, async (tx) => {
      await this.ownTemplate(tx, s, uuid(id));
      const r = await tx.one(
        `update encounter_templates set name_ar = coalesce($2, name_ar), name_en = coalesce($3, name_en),
           specialty_id = case when $4::boolean then $5::uuid else specialty_id end, sections = coalesce($6, sections),
           defaults = coalesce($7, defaults), common_diagnoses = coalesce($8, common_diagnoses) where id = $1 returning *`,
        [id, b.nameAr ?? null, b.nameEn ?? null, b.specialtyId !== undefined, b.specialtyId ?? null, b.sections ? JSON.stringify(b.sections) : null,
          b.defaults ? JSON.stringify(b.defaults) : null, b.commonDiagnoses ?? null],
      );
      await this.audit.record(tx, s, meta, { action: 'encounter_template.update', entity: 'encounter_template', entityId: id });
      return r;
    });
  }

  @Delete('encounter-templates/:id')
  @Staff('emr:edit')
  deleteTemplate(@Auth() p: Principal, @Param('id') id: string, @Meta() meta: RequestMeta) {
    const s = asStaff(p);
    return this.tenancy.run(s, async (tx) => {
      await this.ownTemplate(tx, s, uuid(id));
      await tx.query('delete from encounter_templates where id = $1', [id]);
      await this.audit.record(tx, s, meta, { action: 'encounter_template.delete', entity: 'encounter_template', entityId: id });
      return { deleted: true };
    });
  }

  private async ownTemplate(tx: Tx, s: StaffPrincipal, id: string) {
    const t = await tx.maybeOne<{ doctor_id: string | null }>('select doctor_id from encounter_templates where id = $1', [id]);
    if (!t) throw notFound('encounter_template');
    if (t.doctor_id ? t.doctor_id !== s.userId : !s.privileges.has('settings:edit')) throw forbidden('not_template_owner');
  }
}

function withBmi(v: Record<string, number>) {
  if (v.weightKg && v.heightCm) v.bmi = Math.round((v.weightKg / (v.heightCm / 100) ** 2) * 10) / 10;
  return v;
}
