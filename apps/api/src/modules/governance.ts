import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { CONSENT_TYPES } from '@hf/shared';
import type { Tx } from '@hf/db';
import { Auth, Meta, Staff } from '../common/decorators';
import { asStaff } from '../common/auth.guard';
import type { Principal, RequestMeta } from '../common/principal';
import { AuditService, Tenancy } from '../common/services';
import { DomainError, badRequest, notFound } from '../common/errors';
import { parse, uuid } from '../common/zod';
import { STORAGE, type Storage } from '../integrations/storage';
import { TokenService } from '../common/tokens';
import { PatientsService } from './patients.service';
import { MessagingService } from './messaging.service';
import { randomInt } from 'node:crypto';
import { HttpStatus } from '@nestjs/common';

@Controller('v1')
export class GovernanceController {
  constructor(
    private readonly tenancy: Tenancy,
    private readonly audit: AuditService,
    private readonly patients: PatientsService,
    private readonly messaging: MessagingService,
    private readonly tokens: TokenService,
    @Inject(STORAGE) private readonly storage: Storage,
  ) {}

  // ---- Reviews (FR-REV-2)
  @Get('reviews')
  @Staff('review:view')
  reviews(@Auth() p: Principal, @Query('status') status = 'pending') {
    return this.tenancy.run(p, (tx) =>
      tx.query(`select r.*, u.name_ar as doctor_name, c.name_ar as clinic_name from reviews r join users u on u.id = r.doctor_id join clinics c on c.id = r.clinic_id where r.status = $1 order by r.created_at desc limit 200`, [status]),
    );
  }

  @Post('reviews/:id/moderate')
  @Staff('review:approve')
  @HttpCode(200)
  moderate(@Auth() p: Principal, @Param('id') id: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const s = asStaff(p);
    const { approve } = parse(z.object({ approve: z.boolean() }), body);
    return this.tenancy.run(s, async (tx) => {
      const r = await tx.maybeOne<{ doctor_id: string; patient_id: string }>(`update reviews set status = $2, moderated_by = $3, moderated_at = now() where id = $1 returning doctor_id, patient_id`, [uuid(id), approve ? 'approved' : 'rejected', s.userId]);
      if (!r) throw notFound('review');
      await tx.query(
        `update doctor_profiles d set rating_avg = x.avg, rating_count = x.n from (select round(avg(rating)::numeric, 2) as avg, count(*)::int as n from reviews where doctor_id = $1 and status = 'approved') x where d.user_id = $1`,
        [r.doctor_id],
      );
      await this.audit.record(tx, s, meta, { action: `review.${approve ? 'approve' : 'reject'}`, entity: 'review', entityId: id, patientId: r.patient_id });
      return { ok: true };
    });
  }

  // ---- Tasks (service recovery, break-glass notices, variances)
  @Get('tasks')
  @Staff()
  tasks(@Auth() p: Principal, @Query('status') status = 'open') {
    const s = asStaff(p);
    return this.tenancy.run(s, (tx) => tx.query(`select * from tasks where status = $1 and (assignee_role is null or assignee_role = any($2)) order by created_at desc limit 200`, [status, s.roles]));
  }

  @Post('tasks/:id/done')
  @Staff()
  @HttpCode(200)
  async taskDone(@Auth() p: Principal, @Param('id') id: string, @Meta() meta: RequestMeta) {
    const s = asStaff(p);
    return this.tenancy.run(s, async (tx) => {
      const r = await tx.maybeOne(`update tasks set status = 'done' where id = $1 and (assignee_role is null or assignee_role = any($2)) returning id`, [uuid(id), s.roles]);
      if (!r) throw notFound('task');
      await this.audit.record(tx, s, meta, { action: 'task.done', entity: 'task', entityId: id });
      return { ok: true };
    });
  }

  /** Reception links a patient to a family account; the account holder confirms with an OTP (FR-PAT-4). */
  @Post('patients/:id/link-account')
  @Staff('patient:edit')
  async linkAccount(@Auth() p: Principal, @Param('id') id: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const s = asStaff(p);
    const b = parse(z.object({ phone: z.string(), relation: z.enum(['child', 'spouse', 'parent', 'sibling', 'other']) }), body);
    const { normalisePhone } = await import('@hf/shared');
    const phone = normalisePhone(b.phone);
    if (!phone) throw badRequest('invalid_phone');
    const ids = await this.tenancy.run(s, async (tx) => {
      const pt = await tx.maybeOne('select id from patients where id = $1', [uuid(id)]);
      if (!pt) throw notFound('patient');
      await this.audit.record(tx, s, meta, { action: 'patient.link_request', entity: 'patient', entityId: id, patientId: id, details: { relation: b.relation } });
      return true;
    });
    void ids;
    return this.tenancy.system(s.orgId, async (tx) => {
      let acct = await tx.maybeOne<{ id: string }>('select id from patient_accounts where phone = $1', [phone]);
      if (!acct) acct = await tx.one<{ id: string }>('insert into patient_accounts (organisation_id, phone) values (app_org(), $1) returning id', [phone]);
      await tx.query(`insert into patient_links (organisation_id, account_id, patient_id, relation) values (app_org(), $1,$2,$3) on conflict (account_id, patient_id) do nothing`, [acct.id, id, b.relation]);
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      await tx.query(`insert into otp_codes (organisation_id, phone, purpose, code_hash, expires_at) values (app_org(), $1, 'link_family', $2, now() + interval '5 minutes')`, [phone, this.tokens.hashOtp(phone, code)]);
      await this.messaging.enqueue(tx, { event: 'otp', to: { phone }, vars: { code }, channels: ['sms'] });
      return { pending: true };
    });
  }

  // ---- Privacy & consent (FR-PRV-*)
  @Get('privacy/consent-versions')
  @Staff('privacy:view')
  consentVersions(@Auth() p: Principal) {
    return this.tenancy.run(p, (tx) => tx.query('select * from consent_versions order by type, version desc'));
  }

  @Post('privacy/consent-versions')
  @Staff('privacy:create')
  publishConsent(@Auth() p: Principal, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const b = parse(z.object({ type: z.enum(CONSENT_TYPES), textAr: z.string().min(20), textEn: z.string().default('') }), body);
    return this.tenancy.run(p, async (tx) => {
      const r = await tx.one<{ id: string; version: number }>(
        `insert into consent_versions (organisation_id, type, version, text_ar, text_en) values (app_org(), $1, coalesce((select max(version) from consent_versions where type = $1), 0) + 1, $2, $3) returning *`,
        [b.type, b.textAr, b.textEn],
      );
      await this.audit.record(tx, p, meta, { action: 'privacy.consent_version', entity: 'consent_version', entityId: r.id, details: { type: b.type, version: r.version } });
      return r;
    });
  }

  @Get('privacy/data-requests')
  @Staff('privacy:view')
  dataRequests(@Auth() p: Principal, @Query('status') status?: string) {
    return this.tenancy.run(p, (tx) =>
      tx.query(`select d.*, p.mrn, p.first_name_ar || ' ' || p.family_name_ar as patient_name, d.due_at < now() and d.status not in ('completed','rejected') as overdue from data_requests d join patients p on p.id = d.patient_id where ($1::text is null or d.status = $1) order by d.due_at`, [status ?? null]),
    );
  }

  /** Process a request: export bundles all patient data as JSON; erasure anonymises demographics and keeps clinical records (D12). */
  @Post('privacy/data-requests/:id/process')
  @Staff('privacy:approve')
  @HttpCode(200)
  process(@Auth() p: Principal, @Param('id') id: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const s = asStaff(p);
    const b = parse(z.object({ action: z.enum(['complete', 'reject']), note: z.string().max(1000).optional() }), body);
    return this.tenancy.run(s, async (tx) => {
      const r = await tx.maybeOne<{ id: string; patient_id: string; kind: string; status: string }>('select * from data_requests where id = $1 for update', [uuid(id)]);
      if (!r) throw notFound('data_request');
      if (['completed', 'rejected'].includes(r.status)) throw new DomainError('already_closed', HttpStatus.CONFLICT);
      let resultKey: string | null = null;
      if (b.action === 'complete' && (r.kind === 'export' || r.kind === 'access')) resultKey = await this.exportBundle(tx, s.orgId, r.patient_id);
      if (b.action === 'complete' && r.kind === 'erasure') await this.anonymise(tx, r.patient_id);
      await tx.query(`update data_requests set status = $2, result_key = $3, completed_at = now(), details = coalesce(details, '') || $4 where id = $1`, [id, b.action === 'complete' ? 'completed' : 'rejected', resultKey, b.note ? `\n${b.note}` : '']);
      await this.audit.record(tx, s, meta, { action: `privacy.request_${b.action}`, entity: 'data_request', entityId: id, patientId: r.patient_id, details: { kind: r.kind } });
      return { ok: true, download: resultKey ? await this.storage.signedUrl(resultKey, 3600, 'patient-data.zip') : null };
    });
  }

  private async exportBundle(tx: Tx, orgId: string, patientId: string): Promise<string> {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    const q = (sql: string) => tx.query(sql, [patientId]);
    const patient = await tx.one<Record<string, unknown> & { national_id_enc: Buffer | null }>('select * from patients where id = $1', [patientId]);
    const { national_id_enc, passport_enc: _pe, national_id_bidx: _b, passport_bidx: _pb, name_search: _n, ...demo } = patient as Record<string, unknown> & { national_id_enc: Buffer | null };
    const data = {
      exportedAt: new Date().toISOString(),
      patient: { ...demo, nationalId: this.patients.decryptNid(orgId, national_id_enc) },
      contacts: await q('select phone, is_primary from patient_contacts where patient_id = $1'),
      appointments: await q('select ref, start_at, status, channel from appointments where patient_id = $1 order by start_at'),
      encounters: await q(`select created_at, signed_at, vitals, chief_complaint, hpi, examination, notes, diagnoses, follow_up, patient_summary from encounters where patient_id = $1 and status = 'signed' order by created_at`),
      medicalHistory: await q('select kind, text, severity, since from medical_history_items where patient_id = $1'),
      prescriptions: await q(`select rx.issued_at, (select jsonb_agg(to_jsonb(l) - 'organisation_id') from prescription_lines l where l.prescription_id = rx.id) as lines from prescriptions rx where patient_id = $1 and status = 'issued'`),
      bills: await q(`select number, issued_at, total, paid, refunded, status from bills where patient_id = $1 and status not in ('draft','void')`),
      consents: await q('select type, granted, channel, created_at from consents where patient_id = $1 order by created_at'),
      messages: await q('select event, channel, status, created_at from messages where patient_id = $1 order by created_at'),
    };
    zip.file('patient-data.json', JSON.stringify(data, null, 2));
    const docs = await tx.query<{ storage_key: string; title: string; mime: string; id: string }>(`select id, storage_key, title, mime from documents where patient_id = $1 and scan_status = 'clean'`, [patientId]);
    for (const d of docs) {
      const obj = await this.storage.get(d.storage_key);
      if (obj) zip.file(`documents/${d.id}-${d.title.replace(/[^\p{L}\p{N}._-]/gu, '_')}`, obj.body);
    }
    const key = `org/${orgId}/exports/${patientId}-${Date.now()}.zip`;
    await this.storage.put(key, await zip.generateAsync({ type: 'nodebuffer' }), 'application/zip');
    return key;
  }

  private async anonymise(tx: Tx, patientId: string) {
    await tx.query(
      `update patients set first_name_ar = 'مجهول', father_name_ar = '', grandfather_name_ar = '', family_name_ar = '', name_en = null, name_search = '',
         national_id_enc = null, national_id_bidx = null, passport_enc = null, passport_bidx = null, email = null, address = null, occupation = null,
         emergency_contact = null, photo_key = null, custom_fields = '{}', anonymised_at = now() where id = $1`,
      [patientId],
    );
    await tx.query('delete from patient_contacts where patient_id = $1', [patientId]);
    await tx.query('delete from patient_links where patient_id = $1', [patientId]);
    await tx.query(`update messages set body = null, recipient = 'anonymised' where patient_id = $1`, [patientId]);
  }

  @Get('privacy/breaches')
  @Staff('privacy:view')
  breaches(@Auth() p: Principal) {
    return this.tenancy.run(p, (tx) => tx.query('select * from breaches order by detected_at desc'));
  }

  /** FR-PRV-5 breach register; PDPC notification due within 72 hours of detection. */
  @Post('privacy/breaches')
  @Staff('privacy:create')
  createBreach(@Auth() p: Principal, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const s = asStaff(p);
    const b = parse(z.object({ title: z.string().min(3), description: z.string().min(10), detectedAt: z.string().datetime(), severity: z.enum(['low', 'medium', 'high', 'critical']), affectedCount: z.number().int().min(0).optional() }), body);
    return this.tenancy.run(s, async (tx) => {
      const r = await tx.one<{ id: string; detected_at: Date }>(
        `insert into breaches (organisation_id, title, description, detected_at, severity, affected_count, timeline, created_by) values (app_org(), $1,$2,$3,$4,$5,$6,$7) returning *`,
        [b.title, b.description, b.detectedAt, b.severity, b.affectedCount ?? null, JSON.stringify([{ at: new Date().toISOString(), event: 'registered', by: s.name }]), s.userId],
      );
      await this.audit.record(tx, s, meta, { action: 'privacy.breach_register', entity: 'breach', entityId: r.id });
      return { ...r, notifyPdpcBy: new Date(new Date(r.detected_at).getTime() + 72 * 3600_000) };
    });
  }

  @Patch('privacy/breaches/:id')
  @Staff('privacy:edit')
  updateBreach(@Auth() p: Principal, @Param('id') id: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const s = asStaff(p);
    const b = parse(z.object({ containedAt: z.string().datetime().optional(), reportedToPdpcAt: z.string().datetime().optional(), subjectsNotifiedAt: z.string().datetime().optional(), note: z.string().max(1000).optional() }), body);
    return this.tenancy.run(s, async (tx) => {
      const r = await tx.maybeOne(
        `update breaches set contained_at = coalesce($2, contained_at), reported_to_pdpc_at = coalesce($3, reported_to_pdpc_at), subjects_notified_at = coalesce($4, subjects_notified_at),
           timeline = timeline || jsonb_build_array(jsonb_build_object('at', now(), 'event', $5::text, 'by', $6::text)) where id = $1 returning *`,
        [uuid(id), b.containedAt ?? null, b.reportedToPdpcAt ?? null, b.subjectsNotifiedAt ?? null, b.note ?? 'updated', s.name],
      );
      if (!r) throw notFound('breach');
      await this.audit.record(tx, s, meta, { action: 'privacy.breach_update', entity: 'breach', entityId: id });
      return r;
    });
  }

  // ---- Audit viewer (FR-PRV-3)
  @Get('audit')
  @Staff('audit:view')
  auditLog(@Auth() p: Principal, @Query() q: Record<string, string>) {
    const b = parse(z.object({ patientId: z.string().uuid().optional(), actorId: z.string().uuid().optional(), action: z.string().max(100).optional(), from: z.string().optional(), to: z.string().optional(), limit: z.coerce.number().int().min(1).max(1000).default(200) }), q);
    return this.tenancy.run(p, (tx) =>
      tx.query(
        `select seq, at, actor_type, actor_id, role, action, entity, entity_id, patient_id, clinic_id, ip, reason, details from audit_log
         where organisation_id = app_org() and ($1::uuid is null or patient_id = $1) and ($2::uuid is null or actor_id = $2) and ($3::text is null or action like $3 || '%')
           and ($4::timestamptz is null or at >= $4) and ($5::timestamptz is null or at < $5) order by seq desc limit $6`,
        [b.patientId ?? null, b.actorId ?? null, b.action ?? null, b.from ?? null, b.to ?? null, b.limit],
      ),
    );
  }

  @Get('audit/verify')
  @Staff('audit:view')
  async verify(@Auth() p: Principal) {
    const r = await this.tenancy.run(p, (tx) => tx.one<{ broken: number | null; total: number }>('select audit_verify(app_org()) as broken, (select count(*)::int from audit_log where organisation_id = app_org()) as total'));
    return { intact: r.broken === null, firstBrokenSeq: r.broken, entries: r.total };
  }

  /** SEC-8 quarterly access review: every staff user with roles, clinics and last login. */
  @Get('audit/access-review')
  @Staff('audit:view')
  accessReview(@Auth() p: Principal) {
    return this.tenancy.run(p, (tx) =>
      tx.query(
        `select u.id, u.name_ar, u.email, u.status, u.mfa_enrolled, u.last_login_at, jsonb_agg(jsonb_build_object('role', m.role, 'clinicId', m.clinic_id)) as memberships,
                (select count(*)::int from audit_log a where a.organisation_id = app_org() and a.actor_id = u.id and a.at > now() - interval '90 days') as actions_90d
         from users u left join staff_memberships m on m.user_id = u.id group by u.id order by u.name_ar`,
      ),
    );
  }

  // ---- CMS (FR-WEB-5)
  @Get('articles')
  @Staff('org:view')
  articles(@Auth() p: Principal) {
    return this.tenancy.run(p, (tx) => tx.query('select * from articles order by updated_at desc'));
  }

  @Post('articles')
  @Staff('org:edit')
  createArticle(@Auth() p: Principal, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const b = parse(z.object({ kind: z.enum(['article', 'news', 'page']), slug: z.string().regex(/^[a-z0-9-]{2,120}$/), titleAr: z.string().min(2), titleEn: z.string().default(''), bodyAr: z.string().default(''), bodyEn: z.string().default(''), publish: z.boolean().default(false) }), body);
    return this.tenancy.run(p, async (tx) => {
      const r = await tx.one<{ id: string }>(
        `insert into articles (organisation_id, kind, slug, title_ar, title_en, body_ar, body_en, status, published_at) values (app_org(), $1,$2,$3,$4,$5,$6,$7,$8) returning *`,
        [b.kind, b.slug, b.titleAr, b.titleEn, b.bodyAr, b.bodyEn, b.publish ? 'published' : 'draft', b.publish ? new Date() : null],
      );
      await this.audit.record(tx, p, meta, { action: 'cms.create', entity: 'article', entityId: r.id });
      return r;
    });
  }

  @Patch('articles/:id')
  @Staff('org:edit')
  updateArticle(@Auth() p: Principal, @Param('id') id: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const b = parse(z.object({ titleAr: z.string().optional(), titleEn: z.string().optional(), bodyAr: z.string().optional(), bodyEn: z.string().optional(), status: z.enum(['draft', 'published']).optional() }), body);
    return this.tenancy.run(p, async (tx) => {
      const r = await tx.maybeOne(
        `update articles set title_ar = coalesce($2, title_ar), title_en = coalesce($3, title_en), body_ar = coalesce($4, body_ar), body_en = coalesce($5, body_en),
           status = coalesce($6, status), published_at = case when $6 = 'published' and published_at is null then now() else published_at end where id = $1 returning *`,
        [uuid(id), b.titleAr ?? null, b.titleEn ?? null, b.bodyAr ?? null, b.bodyEn ?? null, b.status ?? null],
      );
      if (!r) throw notFound('article');
      await this.audit.record(tx, p, meta, { action: 'cms.update', entity: 'article', entityId: id });
      return r;
    });
  }
}
