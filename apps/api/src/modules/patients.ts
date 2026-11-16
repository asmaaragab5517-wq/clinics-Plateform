import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { CONSENT_TYPES, decodeNationalId, medicalHistoryItemSchema, normalisePhone, normaliseArabic, patientSchema, toWesternDigits } from '@hf/shared';
import { Auth, Meta, Staff } from '../common/decorators';
import { asStaff } from '../common/auth.guard';
import type { Principal, RequestMeta } from '../common/principal';
import { AuditService, Tenancy } from '../common/services';
import { badRequest, forbidden, notFound } from '../common/errors';
import { parse, uuid } from '../common/zod';
import { PatientsService } from './patients.service';
import { MessagingService } from './messaging.service';

/** 404 unless the patient row is visible under the caller's RLS context. */
export async function visiblePatient(tx: import('@hf/db').Tx, id: string) {
  const r = await tx.maybeOne('select id from patients where id = $1', [uuid(id)]);
  if (!r) throw notFound('patient');
}

const PUBLIC_COLS = `p.id, p.mrn, p.first_name_ar, p.father_name_ar, p.grandfather_name_ar, p.family_name_ar, p.name_en, p.date_of_birth, p.gender, p.governorate, p.city,
  p.merged_into_id, (select phone from patient_contacts c where c.patient_id = p.id order by is_primary desc limit 1) as phone`;

@Controller('v1/patients')
export class PatientsController {
  constructor(
    private readonly tenancy: Tenancy,
    private readonly svc: PatientsService,
    private readonly audit: AuditService,
    private readonly messaging: MessagingService,
  ) {}

  /** Search by phone, National ID, MRN or Arabic/English name (LOC-8 normalisation). */
  @Get()
  @Staff('patient:view')
  search(@Auth() p: Principal, @Query('q') q = '', @Meta() meta: RequestMeta) {
    const term = toWesternDigits(q.trim()).slice(0, 100);
    if (term.length < 2) throw badRequest('query_too_short');
    return this.tenancy.run(p, async (tx) => {
      let rows;
      let kind: string;
      const phone = normalisePhone(term);
      if (/^\d{14}$/.test(term) && decodeNationalId(term).ok) {
        kind = 'national_id';
        rows = await tx.query(`select ${PUBLIC_COLS} from patients p where national_id_bidx = $1 and merged_into_id is null`, [this.svc.nidIndex(p.orgId, term)]);
      } else if (phone) {
        kind = 'phone';
        rows = await tx.query(`select distinct ${PUBLIC_COLS} from patients p join patient_contacts c on c.patient_id = p.id where c.phone = $1 and p.merged_into_id is null`, [phone]);
      } else if (/^[A-Z]{1,4}-\d+$/i.test(term)) {
        kind = 'mrn';
        rows = await tx.query(`select ${PUBLIC_COLS} from patients p where upper(mrn) = upper($1)`, [term]);
      } else {
        kind = 'name';
        const n = normaliseArabic(term);
        rows = await tx.query(
          `select ${PUBLIC_COLS}, similarity(p.name_search, $1) as score from patients p where p.merged_into_id is null and p.deleted_at is null and p.anonymised_at is null
             and (p.name_search % $1 or p.name_search like '%' || $1 || '%') order by score desc limit 25`,
          [n],
        );
      }
      await this.audit.record(tx, p, meta, { action: 'patient.search', entity: 'patient', details: { kind, results: rows.length } });
      return rows;
    });
  }

  @Post()
  @Staff('patient:create')
  create(@Auth() p: Principal, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const b = parse(
      z.object({
        patient: patientSchema,
        force: z.boolean().default(false),
        consents: z.object({ healthData: z.boolean(), messaging: z.boolean().default(true), marketing: z.boolean().default(false) }).optional(),
      }),
      body,
    );
    const s = asStaff(p);
    return this.tenancy.run(s, async (tx) => {
      const created = await this.svc.create(tx, s, b.patient, { force: b.force });
      if (b.consents) await this.recordConsents(tx, s, meta, created.id, { health_data: b.consents.healthData, messaging: b.consents.messaging, marketing: b.consents.marketing }, 'reception');
      await this.audit.record(tx, s, meta, { action: 'patient.create', entity: 'patient', entityId: created.id, patientId: created.id, details: { forced: b.force } });
      return created;
    });
  }

  @Post('duplicates')
  @Staff('patient:create')
  @HttpCode(200)
  duplicates(@Auth() p: Principal, @Body() body: unknown) {
    const b = parse(z.object({ nationalId: z.string().optional(), phones: z.array(z.object({ number: z.string() })).default([]), nameAr: z.object({ first: z.string(), father: z.string().default(''), grandfather: z.string().default(''), family: z.string().default('') }), dateOfBirth: z.string() }), body);
    const phones = b.phones.map((x) => ({ number: normalisePhone(x.number) ?? x.number, primary: false }));
    return this.tenancy.run(p, (tx) => this.svc.findDuplicates(tx, p.orgId, { ...b, phones }));
  }

  @Get(':id')
  @Staff('patient:view')
  async get(@Auth() p: Principal, @Param('id') id: string, @Meta() meta: RequestMeta) {
    const s = asStaff(p);
    return this.tenancy.run(s, async (tx) => {
      const row = await tx.maybeOne<Record<string, unknown> & { national_id_enc: Buffer | null; passport_enc: Buffer | null }>('select * from patients where id = $1', [uuid(id)]);
      if (!row) throw notFound('patient');
      const nid = this.svc.decryptNid(s.orgId, row.national_id_enc);
      const contacts = await tx.query('select id, phone, is_primary from patient_contacts where patient_id = $1 order by is_primary desc', [id]);
      const emr = await this.svc.canViewEmr(tx, s, id);
      // Allergy banner is shown to clinical roles (FR-EMR-4).
      const allergies = emr ? await tx.query(`select id, text, severity, ingredient from medical_history_items where patient_id = $1 and kind = 'allergy' and is_active`, [id]) : [];
      const guardian = row.guardian_patient_id ? await tx.maybeOne(`select ${PUBLIC_COLS} from patients p where id = $1`, [row.guardian_patient_id]) : null;
      const consents = await tx.query(`select distinct on (type) type, granted, created_at, version_id from consents where patient_id = $1 order by type, created_at desc`, [id]);
      await this.audit.record(tx, s, meta, { action: 'patient.read', entity: 'patient', entityId: id, patientId: id });
      const { national_id_enc: _n, passport_enc: _p, national_id_bidx: _b, passport_bidx: _pb, name_search: _ns, ...rest } = row as Record<string, unknown>;
      return {
        ...rest,
        nationalId: nid ? (s.privileges.has('patient:edit') ? nid : `**********${nid.slice(-4)}`) : null,
        contacts,
        allergies,
        guardian,
        consents,
      };
    });
  }

  @Patch(':id')
  @Staff('patient:edit')
  update(@Auth() p: Principal, @Param('id') id: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const b = parse(
      z.object({
        email: z.string().email().nullable().optional(),
        governorate: z.string().optional(),
        city: z.string().optional(),
        address: z.string().max(500).optional(),
        maritalStatus: z.enum(['single', 'married', 'divorced', 'widowed']).optional(),
        occupation: z.string().max(100).optional(),
        nameEn: z.string().max(200).optional(),
        emergencyContact: z.object({ name: z.string(), phone: z.string(), relation: z.string() }).optional(),
        customFields: z.record(z.unknown()).optional(),
        phones: z.array(z.object({ number: z.string(), primary: z.boolean().default(false) })).optional(),
      }),
      body,
    );
    return this.tenancy.run(p, async (tx) => {
      const r = await tx.maybeOne(
        `update patients set email = coalesce($2, email), governorate = coalesce($3, governorate), city = coalesce($4, city), address = coalesce($5, address),
           marital_status = coalesce($6, marital_status), occupation = coalesce($7, occupation), name_en = coalesce($8, name_en),
           emergency_contact = coalesce($9, emergency_contact), custom_fields = custom_fields || coalesce($10, '{}'::jsonb) where id = $1 and anonymised_at is null returning id`,
        [uuid(id), b.email ?? null, b.governorate ?? null, b.city ?? null, b.address ?? null, b.maritalStatus ?? null, b.occupation ?? null, b.nameEn ?? null,
          b.emergencyContact ? JSON.stringify(b.emergencyContact) : null, b.customFields ? JSON.stringify(b.customFields) : null],
      );
      if (!r) throw notFound('patient');
      if (b.phones) {
        const phones = b.phones.map((x) => ({ number: normalisePhone(x.number), primary: x.primary }));
        if (phones.some((x) => !x.number)) throw badRequest('invalid_phone');
        await tx.query('delete from patient_contacts where patient_id = $1', [id]);
        const primary = Math.max(0, phones.findIndex((x) => x.primary));
        for (const [i, ph] of phones.entries()) await tx.query('insert into patient_contacts (organisation_id, patient_id, phone, is_primary) values (app_org(), $1,$2,$3)', [id, ph.number, i === primary]);
      }
      await this.audit.record(tx, p, meta, { action: 'patient.update', entity: 'patient', entityId: id, patientId: id, details: { keys: Object.keys(b) } });
      return { ok: true };
    });
  }

  @Post(':id/merge')
  @Staff('patient:edit')
  merge(@Auth() p: Principal, @Param('id') targetId: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const s = asStaff(p);
    const b = parse(z.object({ sourcePatientId: z.string().uuid(), reason: z.string().min(3).max(500) }), body);
    return this.tenancy.run(s, async (tx) => {
      const both = await tx.query('select id from patients where id = any($1::uuid[]) and merged_into_id is null', [[uuid(targetId), b.sourcePatientId]]);
      if (both.length !== 2) throw notFound('patient');
      const m = await this.svc.merge(tx, b.sourcePatientId, targetId, s.userId, b.reason);
      await this.audit.record(tx, s, meta, { action: 'patient.merge', entity: 'patient', entityId: targetId, patientId: targetId, reason: b.reason, details: { source: b.sourcePatientId, mergeId: m.id } });
      return m;
    });
  }

  @Post('merges/:mergeId/unmerge')
  @Staff('patient:edit')
  unmerge(@Auth() p: Principal, @Param('mergeId') mergeId: string, @Meta() meta: RequestMeta) {
    const s = asStaff(p);
    return this.tenancy.run(s, async (tx) => {
      const r = await this.svc.unmerge(tx, uuid(mergeId), s.userId);
      await this.audit.record(tx, s, meta, { action: 'patient.unmerge', entity: 'patient_merge', entityId: mergeId });
      return r;
    });
  }

  /** FR-PAT-7: one chronological view. Clinical entries only for EMR-privileged users. */
  @Get(':id/timeline')
  @Staff('patient:view')
  timeline(@Auth() p: Principal, @Param('id') id: string, @Meta() meta: RequestMeta) {
    const s = asStaff(p);
    return this.tenancy.run(s, async (tx) => {
      await visiblePatient(tx, id);
      const emr = await this.svc.canViewEmr(tx, s, id);
      const items = await tx.query(
        `select * from (
           select 'appointment' as kind, a.id, a.start_at as at, a.status as status, jsonb_build_object('ref', a.ref, 'doctor', u.name_ar, 'clinicId', a.clinic_id) as data
             from appointments a join users u on u.id = a.doctor_id where a.patient_id = $1
           union all select 'bill', b.id, coalesce(b.issued_at, b.created_at), b.status, jsonb_build_object('number', b.number, 'total', b.total, 'paid', b.paid) from bills b where b.patient_id = $1
           union all select 'payment', y.id, y.created_at, y.status, jsonb_build_object('method', y.method, 'amount', y.amount, 'receipt', y.receipt_number) from payments y where y.patient_id = $1
           union all select 'message', m.id, m.created_at, m.status, jsonb_build_object('event', m.event, 'channel', m.channel) from messages m where m.patient_id = $1
           union all select 'document', d.id, d.created_at, d.scan_status, jsonb_build_object('title', d.title, 'kind', d.kind, 'patientProvided', d.patient_provided) from documents d where d.patient_id = $1 and $2
           union all select 'encounter', e.id, e.created_at, e.status, jsonb_build_object('doctorId', e.doctor_id, 'clinicId', e.clinic_id, 'diagnoses', e.diagnoses) from encounters e where e.patient_id = $1 and $2
         ) t order by at desc limit 200`,
        [id, emr],
      );
      await this.audit.record(tx, s, meta, { action: 'patient.timeline', entity: 'patient', entityId: id, patientId: id });
      return items;
    });
  }

  @Get(':id/history')
  @Staff('emr:view')
  history(@Auth() p: Principal, @Param('id') id: string, @Meta() meta: RequestMeta) {
    return this.tenancy.run(p, async (tx) => {
      await visiblePatient(tx, id);
      const rows = await tx.query('select * from medical_history_items where patient_id = $1 order by kind, created_at desc', [id]);
      await this.audit.record(tx, p, meta, { action: 'emr.history_read', entity: 'patient', entityId: id, patientId: id });
      return rows;
    });
  }

  @Post(':id/history')
  @Staff('emr:create')
  addHistory(@Auth() p: Principal, @Param('id') id: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const s = asStaff(p);
    const b = parse(medicalHistoryItemSchema, body);
    return this.tenancy.run(s, async (tx) => {
      await visiblePatient(tx, id);
      const r = await tx.one<{ id: string }>(
        `insert into medical_history_items (organisation_id, patient_id, kind, text, severity, ingredient, since, created_by) values (app_org(), $1,$2,$3,$4,$5,$6,$7) returning *`,
        [uuid(id), b.kind, b.text, b.severity ?? null, b.ingredient?.toLowerCase() ?? null, b.since ?? null, s.userId],
      );
      await this.audit.record(tx, s, meta, { action: 'emr.history_add', entity: 'medical_history_item', entityId: r.id, patientId: id });
      return r;
    });
  }

  @Patch(':id/history/:itemId')
  @Staff('emr:edit')
  deactivateHistory(@Auth() p: Principal, @Param('id') id: string, @Param('itemId') itemId: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const b = parse(z.object({ isActive: z.boolean() }), body);
    return this.tenancy.run(p, async (tx) => {
      const r = await tx.maybeOne('update medical_history_items set is_active = $3 where id = $2 and patient_id = $1 returning id', [uuid(id), uuid(itemId), b.isActive]);
      if (!r) throw notFound('history_item');
      await this.audit.record(tx, p, meta, { action: 'emr.history_update', entity: 'medical_history_item', entityId: itemId, patientId: id });
      return { ok: true };
    });
  }

  /** Consents captured at reception on the tablet (FR-PRV-2). */
  @Post(':id/consents')
  @Staff('patient:edit')
  consents(@Auth() p: Principal, @Param('id') id: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const b = parse(z.object({ consents: z.record(z.enum(CONSENT_TYPES), z.boolean()), signatureDataUrl: z.string().max(200000).optional() }), body);
    return this.tenancy.run(p, async (tx) => {
      const exists = await tx.maybeOne('select 1 from patients where id = $1', [uuid(id)]);
      if (!exists) throw notFound('patient');
      return this.recordConsents(tx, p, meta, id, b.consents, 'reception');
    });
  }

  private async recordConsents(tx: import('@hf/db').Tx, p: Principal, meta: RequestMeta, patientId: string, consents: Partial<Record<(typeof CONSENT_TYPES)[number], boolean>>, channel: string) {
    const out = [];
    for (const [type, granted] of Object.entries(consents)) {
      if (granted === undefined) continue;
      const v = await tx.maybeOne<{ id: string }>('select id from consent_versions where type = $1 order by version desc limit 1', [type]);
      if (!v) throw badRequest('no_consent_version', type);
      out.push(
        await tx.one(
          `insert into consents (organisation_id, patient_id, version_id, type, granted, channel, ip, device, recorded_by) values (app_org(), $1,$2,$3,$4,$5,$6::inet,$7,$8) returning id, type, granted`,
          [patientId, v.id, type, granted, channel, meta.ip, meta.userAgent?.slice(0, 200) ?? null, p.kind === 'staff' ? p.userId : null],
        ),
      );
      if (type === 'messaging' || type === 'marketing') {
        await tx.query(
          `insert into notification_preferences (organisation_id, patient_id, marketing_opt_out) values (app_org(), $1, $2)
           on conflict (patient_id) do update set marketing_opt_out = case when $3 = 'marketing' then $2 else notification_preferences.marketing_opt_out end`,
          [patientId, type === 'marketing' ? !granted : false, type],
        );
      }
    }
    await this.audit.record(tx, p, meta, { action: 'privacy.consent', entity: 'patient', entityId: patientId, patientId, details: consents });
    return out;
  }

  /** IAM-5: break-glass access with reason, 4 hours, Clinic Manager notified via task. */
  @Post(':id/break-glass')
  @Staff('patient:view')
  breakGlass(@Auth() p: Principal, @Param('id') id: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const s = asStaff(p);
    if (!s.roles.some((r) => ['doctor', 'nurse', 'clinic_manager'].includes(r))) throw forbidden('clinical_role_required');
    const b = parse(z.object({ reason: z.string().min(10).max(500) }), body);
    return this.tenancy.run(s, async (tx) => {
      const pt = await tx.maybeOne('select id from patients where id = $1', [uuid(id)]);
      if (!pt) throw notFound('patient');
      const g = await tx.one<{ id: string; expires_at: Date }>(
        `insert into access_grants (organisation_id, user_id, patient_id, reason, expires_at) values (app_org(), $1,$2,$3, now() + interval '4 hours') returning id, expires_at`,
        [s.userId, id, b.reason],
      );
      for (const clinicId of s.clinicIds) {
        await tx.query(`insert into tasks (organisation_id, clinic_id, kind, title, entity_id, assignee_role) values (app_org(), $1, 'break_glass', $2, $3, 'clinic_manager')`, [clinicId, `Break-glass access by ${s.name}: ${b.reason}`.slice(0, 300), g.id]);
      }
      await this.audit.record(tx, s, meta, { action: 'emr.break_glass', entity: 'patient', entityId: id, patientId: id, reason: b.reason });
      return g;
    });
  }

  @Post(':id/family')
  @Staff('patient:edit')
  setGuardian(@Auth() p: Principal, @Param('id') id: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const b = parse(z.object({ guardianPatientId: z.string().uuid() }), body);
    return this.tenancy.run(p, async (tx) => {
      if (b.guardianPatientId === id) throw badRequest('self_guardian');
      const r = await tx.maybeOne('update patients set guardian_patient_id = $2 where id = $1 returning id', [uuid(id), b.guardianPatientId]);
      if (!r) throw notFound('patient');
      await this.audit.record(tx, p, meta, { action: 'patient.guardian', entity: 'patient', entityId: id, patientId: id, details: b });
      return { ok: true };
    });
  }

  @Get(':id/messages')
  @Staff('message:view')
  messages(@Auth() p: Principal, @Param('id') id: string) {
    return this.tenancy.run(p, async (tx) => {
      await visiblePatient(tx, id);
      return tx.query('select id, event, channel, status, segments, cost, created_at, sent_at, error from messages where patient_id = $1 order by created_at desc limit 200', [id]);
    });
  }
}
