import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Patch, Post, Query, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { CONSENT_TYPES, patientSchema, publicBookingSchema, reviewSchema } from '@hf/shared';
import { renderPdf, icsEvent } from '@hf/documents';
import type { Tx } from '@hf/db';
import { Auth, Meta, PatientAuth } from '../common/decorators';
import { asPatient } from '../common/auth.guard';
import type { PatientPrincipal, Principal, RequestMeta } from '../common/principal';
import { AuditService, Tenancy } from '../common/services';
import { DomainError, badRequest, forbidden, notFound } from '../common/errors';
import { parse, uuid } from '../common/zod';
import { TokenService } from '../common/tokens';
import { ANTIVIRUS, MAX_UPLOAD_BYTES, STORAGE, type Antivirus, type Storage } from '../integrations/storage';
import { AppointmentsService } from './appointments.service';
import { PatientsService } from './patients.service';
import { PaymentsService } from './payments';
import { PrescriptionRenderer } from './prescriptions';
import { BillingService } from './billing.service';
import { invoiceDocument } from './billing';
import { storeDocument } from './emr';
import { CONFIG, type Config } from '../config';

/** Patient portal & app API (BR-11, FR-APP-1). Every query also runs under patient-mode RLS (MT-4). */
@Controller('v1/portal')
export class PortalController {
  constructor(
    private readonly tenancy: Tenancy,
    private readonly audit: AuditService,
    private readonly appointments: AppointmentsService,
    private readonly patients: PatientsService,
    private readonly payments: PaymentsService,
    private readonly rx: PrescriptionRenderer,
    private readonly billing: BillingService,
    private readonly tokens: TokenService,
    @Inject(CONFIG) private readonly cfg: Config,
    @Inject(STORAGE) private readonly storage: Storage,
    @Inject(ANTIVIRUS) private readonly av: Antivirus,
  ) {}

  /** MT-4: an identifier is accepted only when it belongs to the account (self or confirmed family link). */
  private own(p: PatientPrincipal, patientId: string) {
    uuid(patientId);
    if (!p.patientIds.includes(patientId)) throw notFound('patient');
    return patientId;
  }

  /** Patient-mode RLS read proves the appointment belongs to the account before a system-mode write. */
  private async ownAppointment(p: PatientPrincipal, id: string) {
    const a = await this.tenancy.run(p, (tx) => tx.maybeOne('select id from appointments where id = $1', [uuid(id)]));
    if (!a) throw notFound('appointment');
  }

  @Get('me')
  @PatientAuth()
  me(@Auth() p: Principal) {
    const pt = asPatient(p);
    return this.tenancy.system(pt.orgId, async (tx) => {
      const account = await tx.one('select id, phone, locale, status, created_at from patient_accounts where id = $1', [pt.accountId]);
      const patients = await tx.query(
        `select p.id, p.mrn, p.first_name_ar, p.father_name_ar, p.family_name_ar, p.name_en, p.date_of_birth, p.gender, l.relation, l.confirmed_at
         from patient_links l join patients p on p.id = l.patient_id where l.account_id = $1 and p.merged_into_id is null order by l.relation = 'self' desc, p.date_of_birth`,
        [pt.accountId],
      );
      return { account, patients };
    });
  }

  @Patch('me')
  @PatientAuth()
  updateMe(@Auth() p: Principal, @Body() body: unknown) {
    const pt = asPatient(p);
    const b = parse(z.object({ locale: z.enum(['ar', 'en']) }), body);
    return this.tenancy.system(pt.orgId, (tx) => tx.one('update patient_accounts set locale = $2 where id = $1 returning id, locale', [pt.accountId, b.locale]));
  }

  /** Create self or a family member; minors are linked to the account holder as guardian (FR-PAT-4). */
  @Post('patients')
  @PatientAuth()
  createPatient(@Auth() p: Principal, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const pt = asPatient(p);
    const b = parse(z.object({ patient: patientSchema, relation: z.enum(['self', 'child', 'spouse', 'parent', 'sibling', 'other']), consentHealthData: z.literal(true), consentMessaging: z.boolean().default(true) }), body);
    return this.tenancy.system(pt.orgId, async (tx) => {
      const links = await tx.query<{ patient_id: string; relation: string }>('select patient_id, relation from patient_links where account_id = $1 and confirmed_at is not null', [pt.accountId]);
      if (b.relation === 'self' && links.some((l) => l.relation === 'self')) throw badRequest('self_already_exists');
      if (links.length >= 10) throw badRequest('family_limit_reached');
      const self = links.find((l) => l.relation === 'self');
      const input = { ...b.patient, guardianPatientId: b.patient.guardianPatientId ?? (b.relation === 'child' ? self?.patient_id : undefined) };
      if (input.guardianPatientId && !links.some((l) => l.patient_id === input.guardianPatientId)) throw forbidden();
      if (!input.phones.some((x) => x.number === pt.phone) && b.relation === 'self') input.phones = [{ number: pt.phone, primary: true }, ...input.phones.map((x) => ({ ...x, primary: false }))];
      const created = await this.patients.create(tx, pt, input, { force: true, allowMinorWithoutGuardian: false });
      await tx.query(`insert into patient_links (organisation_id, account_id, patient_id, relation, confirmed_at) values (app_org(), $1, $2, $3, now())`, [pt.accountId, created.id, b.relation]);
      for (const [type, granted] of [['health_data', true], ['messaging', b.consentMessaging]] as const) {
        const v = await tx.one<{ id: string }>('select id from consent_versions where type = $1 order by version desc limit 1', [type]);
        await tx.query(`insert into consents (organisation_id, patient_id, version_id, type, granted, channel, ip, device) values (app_org(), $1,$2,$3,$4,'portal',$5::inet,$6)`, [created.id, v.id, type, granted, meta.ip, meta.userAgent?.slice(0, 200) ?? null]);
      }
      await this.audit.record(tx, pt, meta, { action: 'patient.self_register', entity: 'patient', entityId: created.id, patientId: created.id, details: { relation: b.relation } });
      return created;
    });
  }

  /** Confirm pending family links created at reception with the OTP sent to this phone (FR-PAT-4). */
  @Post('links/confirm')
  @PatientAuth()
  @HttpCode(200)
  confirmLinks(@Auth() p: Principal, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const pt = asPatient(p);
    const { code } = parse(z.object({ code: z.string().regex(/^\d{6}$/) }), body);
    return this.tenancy.system(pt.orgId, async (tx) => {
      const otp = await tx.maybeOne<{ id: string; code_hash: string; attempts: number; expires_at: Date }>(
        `select * from otp_codes where phone = $1 and purpose = 'link_family' and consumed_at is null order by created_at desc limit 1 for update`,
        [pt.phone],
      );
      if (!otp || new Date(otp.expires_at) < new Date() || otp.attempts >= 3) throw new DomainError('otp_expired', HttpStatus.UNAUTHORIZED);
      const ok = timingSafeEqual(Buffer.from(otp.code_hash, 'hex'), Buffer.from(this.tokens.hashOtp(pt.phone, code), 'hex'));
      if (!ok) {
        await tx.query('update otp_codes set attempts = attempts + 1 where id = $1', [otp.id]);
        throw new DomainError('otp_invalid', HttpStatus.UNAUTHORIZED);
      }
      await tx.query('update otp_codes set consumed_at = now() where id = $1', [otp.id]);
      const rows = await tx.query<{ patient_id: string }>('update patient_links set confirmed_at = now() where account_id = $1 and confirmed_at is null returning patient_id', [pt.accountId]);
      await this.audit.record(tx, pt, meta, { action: 'patient.link_confirm', entity: 'patient_account', entityId: pt.accountId, details: { linked: rows.length } });
      return { linked: rows.map((r) => r.patient_id) };
    });
  }

  @Get('appointments')
  @PatientAuth()
  list(@Auth() p: Principal, @Query('scope') scope = 'upcoming') {
    return this.tenancy.run(p, (tx) =>
      tx.query(
        `select a.id, a.ref, a.patient_id, a.clinic_id, a.doctor_id, a.start_at, a.end_at, a.status, a.payment_mode, a.hold_expires_at,
                c.name_ar as clinic_name_ar, c.name_en as clinic_name_en, c.address_lines, u.name_ar as doctor_name_ar, u.name_en as doctor_name_en,
                (select ticket_number from queue_tickets q where q.appointment_id = a.id) as ticket_number,
                (select checkout_url from payment_intents i where i.appointment_id = a.id and i.status = 'pending' limit 1) as checkout_url
         from appointments a join clinics c on c.id = a.clinic_id join users u on u.id = a.doctor_id
         where ${scope === 'past' ? `a.start_at < now() or a.status in ('completed','no_show','cancelled')` : `a.start_at >= now() - interval '3 hours' and a.status not in ('completed','no_show','cancelled')`}
         order by a.start_at ${scope === 'past' ? 'desc' : 'asc'} limit 100`,
      ),
    );
  }

  /** Booking wizard commit (FR-WEB-3 step 5): pay online (10-minute hold) or at the clinic per policy. */
  @Post('bookings')
  @PatientAuth()
  book(@Auth() p: Principal, @Body() body: unknown, @Meta() meta: RequestMeta, @Req() req: Request) {
    const pt = asPatient(p);
    const b = parse(publicBookingSchema, body);
    this.own(pt, b.patientId);
    const idem = (req.headers['idempotency-key'] as string | undefined)?.slice(0, 100);
    const channel = req.headers['x-client'] === 'app' ? 'app' : 'site';
    // Ownership was checked above; the write runs in system mode so it can also record events, messages and the payment intent.
    return this.tenancy.system(pt.orgId, async (tx) => {
      const policy = await this.appointments.policy(tx);
      if (policy.requireOnlinePayment && b.paymentMode !== 'online') throw badRequest('online_payment_required');
      const appt = await this.appointments.book(tx, pt, meta, { patientId: b.patientId, clinicId: b.clinicId, doctorId: b.doctorId, serviceIds: [b.serviceId], start: b.start, channel, paymentMode: b.paymentMode, idempotencyKey: idem ? `${pt.accountId}:${idem}` : undefined });
      const payment = appt.status === 'requested' ? await this.payments.createIntent(tx, appt, pt.phone) : null;
      return { appointment: appt, payment, holdExpiresAt: appt.hold_expires_at };
    });
  }

  @Post('appointments/:id/cancel')
  @PatientAuth()
  @HttpCode(200)
  async cancel(@Auth() p: Principal, @Param('id') id: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const pt = asPatient(p);
    const { reason } = parse(z.object({ reason: z.string().min(2).max(300) }), body);
    await this.ownAppointment(pt, id);
    return this.tenancy.system(pt.orgId, (tx) => this.appointments.transition(tx, pt, meta, id, 'cancelled', { reason, cancelledBy: 'patient' }));
  }

  @Post('appointments/:id/reschedule')
  @PatientAuth()
  @HttpCode(200)
  async reschedule(@Auth() p: Principal, @Param('id') id: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const pt = asPatient(p);
    const { start } = parse(z.object({ start: z.string().datetime() }), body);
    await this.ownAppointment(pt, id);
    return this.tenancy.system(pt.orgId, (tx) => this.appointments.reschedule(tx, pt, meta, id, start));
  }

  @Post('appointments/:id/confirm')
  @PatientAuth()
  @HttpCode(200)
  async confirm(@Auth() p: Principal, @Param('id') id: string, @Meta() meta: RequestMeta) {
    const pt = asPatient(p);
    await this.ownAppointment(pt, id);
    return this.tenancy.system(pt.orgId, (tx) => this.appointments.transition(tx, pt, meta, id, 'confirmed'));
  }

  /** Queue position for a checked-in visit (FR-APP-1). Counts only, no other patients' data. */
  @Get('appointments/:id/queue')
  @PatientAuth()
  async queue(@Auth() p: Principal, @Param('id') id: string) {
    const pt = asPatient(p);
    const t = await this.tenancy.run(pt, (tx) => tx.maybeOne<{ id: string; clinic_id: string; doctor_id: string; ticket_number: number; status: string }>('select * from queue_tickets where appointment_id = $1', [uuid(id)]));
    if (!t) throw notFound('ticket');
    const groups = await this.tenancy.system(pt.orgId, (tx) => this.appointments.queue(tx, t.clinic_id, t.doctor_id, false));
    const idx = groups[0]?.waiting.findIndex((w) => w.id === t.id) ?? -1;
    return { ticketNumber: t.ticket_number, status: t.status, position: idx >= 0 ? idx + 1 : null, nowServing: groups[0]?.serving?.ticket_number ?? groups[0]?.called?.ticket_number ?? null };
  }

  @Get('appointments/:id/calendar.ics')
  @PatientAuth()
  async ics(@Auth() p: Principal, @Param('id') id: string, @Query('locale') locale: string | undefined, @Res() res: Response) {
    const a = await this.tenancy.run(p, (tx) =>
      tx.maybeOne<{ id: string; ref: string; start_at: Date; end_at: Date; doctor: string; clinic: string; address: string }>(
        `select a.id, a.ref, a.start_at, a.end_at, ${locale === 'en' ? "coalesce(nullif(u.name_en, ''), u.name_ar)" : 'u.name_ar'} as doctor, ${locale === 'en' ? "coalesce(nullif(c.name_en, ''), c.name_ar)" : 'c.name_ar'} as clinic, c.address_lines as address from appointments a join users u on u.id = a.doctor_id join clinics c on c.id = a.clinic_id where a.id = $1`,
        [uuid(id)],
      ),
    );
    if (!a) throw notFound('appointment');
    res.setHeader('content-type', 'text/calendar; charset=utf-8').setHeader('content-disposition', `attachment; filename="${a.ref}.ics"`)
      .send(icsEvent({ uid: `${a.id}@healthflow`, start: new Date(a.start_at), end: new Date(a.end_at), summary: `${locale === 'en' ? 'Appointment:' : 'موعد'} ${a.doctor}`, location: `${a.clinic} - ${a.address}`, description: `Ref ${a.ref}` }));
  }

  @Get('prescriptions')
  @PatientAuth()
  prescriptions(@Auth() p: Principal) {
    return this.tenancy.run(p, (tx) =>
      tx.query(
        `select rx.id, rx.patient_id, rx.issued_at, u.name_ar as doctor_name_ar, u.name_en as doctor_name_en,
                (select jsonb_agg(jsonb_build_object('drug', coalesce(d.trade_name_en, l.free_text), 'instructionsAr', l.instructions_ar, 'instructionsEn', l.instructions_en, 'durationDays', l.duration_days) order by l.position)
                   from prescription_lines l left join drugs d on d.id = l.drug_id where l.prescription_id = rx.id) as lines
         from prescriptions rx join users u on u.id = rx.doctor_id where rx.status = 'issued' order by rx.issued_at desc`,
      ),
    );
  }

  @Get('prescriptions/:id/pdf')
  @PatientAuth()
  async prescriptionPdf(@Auth() p: Principal, @Param('id') id: string, @Meta() meta: RequestMeta, @Res() res: Response) {
    const pt = asPatient(p);
    const rx = await this.tenancy.run(pt, (tx) => tx.maybeOne<{ id: string }>(`select id from prescriptions where id = $1 and status = 'issued'`, [uuid(id)]));
    if (!rx) throw notFound('prescription');
    const pdf = await this.tenancy.system(pt.orgId, async (tx) => {
      const r = await this.rx.render(tx, id, 'A5');
      await this.audit.record(tx, pt, meta, { action: 'prescription.patient_download', entity: 'prescription', entityId: id, patientId: r.patientId });
      return r.buffer;
    });
    res.setHeader('content-type', 'application/pdf').setHeader('cache-control', 'no-store').send(pdf);
  }

  /** Short-lived signed links so the system browser / share sheet can open PDFs without a bearer header. */
  @Get('prescriptions/:id/link')
  @PatientAuth()
  async prescriptionLink(@Auth() p: Principal, @Param('id') id: string) {
    const rx = await this.tenancy.run(p, (tx) => tx.maybeOne(`select id from prescriptions where id = $1 and status = 'issued'`, [uuid(id)]));
    if (!rx) throw notFound('prescription');
    return { url: `${this.cfg.API_PUBLIC_URL}/v1/share/rx/${this.tokens.signShareLink('rx', id, 600)}`, expiresInSeconds: 600 };
  }

  @Get('invoices/:id/link')
  @PatientAuth()
  async invoiceLink(@Auth() p: Principal, @Param('id') id: string) {
    const b = await this.tenancy.run(p, (tx) => tx.maybeOne(`select id from bills where id = $1 and status not in ('draft','void')`, [uuid(id)]));
    if (!b) throw notFound('bill');
    return { url: `${this.cfg.API_PUBLIC_URL}/v1/share/invoice/${this.tokens.signShareLink('invoice', `${p.orgId}:${id}`, 600)}`, expiresInSeconds: 600 };
  }

  @Get('appointments/:id')
  @PatientAuth()
  async appointment(@Auth() p: Principal, @Param('id') id: string) {
    const a = await this.tenancy.run(p, (tx) =>
      tx.maybeOne(
        `select a.id, a.ref, a.patient_id, a.clinic_id, a.doctor_id, a.start_at, a.end_at, a.status, a.payment_mode, a.hold_expires_at,
                c.name_ar as clinic_name_ar, c.name_en as clinic_name_en, c.address_lines, u.name_ar as doctor_name_ar, u.name_en as doctor_name_en,
                (select ticket_number from queue_tickets q where q.appointment_id = a.id) as ticket_number,
                (select checkout_url from payment_intents i where i.appointment_id = a.id and i.status = 'pending' limit 1) as checkout_url
         from appointments a join clinics c on c.id = a.clinic_id join users u on u.id = a.doctor_id where a.id = $1`,
        [uuid(id)],
      ),
    );
    if (!a) throw notFound('appointment');
    return a;
  }

  @Post('devices/unregister')
  @PatientAuth()
  @HttpCode(200)
  async unregisterDevice(@Auth() p: Principal, @Body() body: unknown) {
    const pt = asPatient(p);
    const { token } = parse(z.object({ token: z.string().min(20).max(4096) }), body);
    await this.tenancy.system(pt.orgId, (tx) => tx.query('delete from device_tokens where token = $1 and account_id = $2', [token, pt.accountId]));
    return { ok: true };
  }

  @Get('visits')
  @PatientAuth()
  visits(@Auth() p: Principal) {
    return this.tenancy.run(p, (tx) =>
      tx.query(
        `select e.id, e.patient_id, e.signed_at, e.patient_summary, e.diagnoses, e.follow_up, u.name_ar as doctor_name_ar, u.name_en as doctor_name_en, c.name_ar as clinic_name_ar, c.name_en as clinic_name_en
         from encounters e join users u on u.id = e.doctor_id join clinics c on c.id = e.clinic_id where e.status = 'signed' order by e.signed_at desc`,
      ),
    );
  }

  @Get('documents')
  @PatientAuth()
  documents(@Auth() p: Principal) {
    return this.tenancy.run(p, (tx) => tx.query(`select id, patient_id, title, kind, mime, size_bytes, patient_provided, created_at from documents where scan_status = 'clean' order by created_at desc`));
  }

  @Get('documents/:id/url')
  @PatientAuth()
  async documentUrl(@Auth() p: Principal, @Param('id') id: string, @Meta() meta: RequestMeta) {
    const d = await this.tenancy.run(p, async (tx) => {
      const row = await tx.maybeOne<{ storage_key: string; patient_id: string; title: string }>(`select storage_key, patient_id, title from documents where id = $1 and scan_status = 'clean'`, [uuid(id)]);
      if (!row) throw notFound('document');
      await this.audit.record(tx, p, meta, { action: 'document.patient_access', entity: 'document', entityId: id, patientId: row.patient_id });
      return row;
    });
    return { url: await this.storage.signedUrl(d.storage_key, 300, d.title), expiresInSeconds: 300 };
  }

  @Post('documents')
  @PatientAuth()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  upload(@Auth() p: Principal, @UploadedFile() file: { buffer: Buffer; size: number } | undefined, @Body() body: { patientId?: string; title?: string }, @Meta() meta: RequestMeta) {
    const pt = asPatient(p);
    const patientId = this.own(pt, body?.patientId ?? '');
    return this.tenancy.run(pt, async (tx) => {
      const d = await storeDocument({ storage: this.storage, av: this.av }, tx, { orgId: pt.orgId, patientId, title: body?.title ?? 'document', kind: 'patient_upload', file, patientProvided: true, actorId: null });
      await this.audit.record(tx, pt, meta, { action: 'document.patient_upload', entity: 'document', entityId: d.id, patientId });
      return d;
    });
  }

  @Get('invoices')
  @PatientAuth()
  invoices(@Auth() p: Principal) {
    return this.tenancy.run(p, (tx) =>
      tx.query(`select b.id, b.patient_id, b.number, b.status, b.total, b.paid, b.refunded, b.credited, b.issued_at, c.name_ar as clinic_name_ar, c.name_en as clinic_name_en from bills b join clinics c on c.id = b.clinic_id where b.status not in ('draft','void') order by b.issued_at desc`),
    );
  }

  @Get('invoices/:id/pdf')
  @PatientAuth()
  async invoicePdf(@Auth() p: Principal, @Param('id') id: string, @Res() res: Response) {
    const pt = asPatient(p);
    const own = await this.tenancy.run(pt, (tx) => tx.maybeOne(`select id from bills where id = $1 and status not in ('draft','void')`, [uuid(id)]));
    if (!own) throw notFound('bill');
    const html = await this.tenancy.system(pt.orgId, async (tx: Tx) => (await invoiceDocument(tx, this.billing, this.patients, id, 'invoice')).html);
    res.setHeader('content-type', 'application/pdf').setHeader('cache-control', 'no-store').send(await renderPdf(html));
  }

  @Get('packages')
  @PatientAuth()
  packages(@Auth() p: Principal) {
    return this.tenancy.run(p, (tx) =>
      tx.query(`select pb.id, pb.patient_id, pb.sessions_total, pb.sessions_used, pb.expires_on, pk.name_ar, pk.name_en from package_balances pb join packages pk on pk.id = pb.package_id order by pb.expires_on desc`),
    );
  }

  /** FR-REV-1: one rating per completed appointment. */
  @Post('reviews')
  @PatientAuth()
  review(@Auth() p: Principal, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const pt = asPatient(p);
    const b = parse(reviewSchema, body);
    return this.tenancy.run(pt, async (tx) => {
      const a = await tx.maybeOne<{ id: string; status: string; clinic_id: string; doctor_id: string; patient_id: string }>('select * from appointments where id = $1', [b.appointmentId]);
      if (!a) throw notFound('appointment');
      if (a.status !== 'completed') throw new DomainError('appointment_not_completed', HttpStatus.CONFLICT);
      const pat = await tx.one<{ first_name_ar: string; family_name_ar: string }>('select first_name_ar, family_name_ar from patients where id = $1', [a.patient_id]);
      const display = `${pat.first_name_ar} ${pat.family_name_ar ? pat.family_name_ar[0] + '.' : ''}`.trim();
      const r = await tx.one<{ id: string }>(
        `insert into reviews (organisation_id, clinic_id, doctor_id, patient_id, appointment_id, rating, comment, display_name) values (app_org(), $1,$2,$3,$4,$5,$6,$7) returning id, rating, status`,
        [a.clinic_id, a.doctor_id, a.patient_id, a.id, b.rating, b.comment ?? null, display],
      );
      await this.audit.record(tx, pt, meta, { action: 'review.create', entity: 'review', entityId: r.id, patientId: a.patient_id });
      if (b.rating <= 2) {
        await this.tenancy.system(pt.orgId, (sys) => sys.query(`insert into tasks (organisation_id, clinic_id, kind, title, entity_id, assignee_role) values (app_org(), $1, 'service_recovery', $2, $3, 'clinic_manager')`, [a.clinic_id, `Low rating (${b.rating}/5)`, r.id]));
      }
      return r;
    });
  }

  @Get('notifications')
  @PatientAuth()
  notifications(@Auth() p: Principal) {
    return this.tenancy.run(p, (tx) => tx.query(`select id, patient_id, event, channel, body, status, created_at from messages where event <> 'otp' order by created_at desc limit 100`));
  }

  @Get('preferences/:patientId')
  @PatientAuth()
  async preferences(@Auth() p: Principal, @Param('patientId') patientId: string) {
    const pt = asPatient(p);
    this.own(pt, patientId);
    return (await this.tenancy.run(pt, (tx) => tx.maybeOne('select * from notification_preferences where patient_id = $1', [patientId]))) ?? { channels: ['whatsapp', 'sms', 'push'], marketing_opt_out: false, sms_opt_out: false, whatsapp_opt_out: false };
  }

  @Patch('preferences/:patientId')
  @PatientAuth()
  setPreferences(@Auth() p: Principal, @Param('patientId') patientId: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const pt = asPatient(p);
    this.own(pt, patientId);
    const b = parse(z.object({ channels: z.array(z.enum(['whatsapp', 'sms', 'push', 'email'])).min(1), marketingOptOut: z.boolean(), smsOptOut: z.boolean(), whatsappOptOut: z.boolean() }), body);
    return this.tenancy.run(pt, async (tx) => {
      const r = await tx.one(
        `insert into notification_preferences (organisation_id, patient_id, channels, marketing_opt_out, sms_opt_out, whatsapp_opt_out) values (app_org(), $1,$2,$3,$4,$5)
         on conflict (patient_id) do update set channels = excluded.channels, marketing_opt_out = excluded.marketing_opt_out, sms_opt_out = excluded.sms_opt_out, whatsapp_opt_out = excluded.whatsapp_opt_out returning *`,
        [patientId, b.channels, b.marketingOptOut, b.smsOptOut, b.whatsappOptOut],
      );
      await this.audit.record(tx, pt, meta, { action: 'privacy.preferences', entity: 'patient', entityId: patientId, patientId });
      return r;
    });
  }

  @Get('consents')
  @PatientAuth()
  consents(@Auth() p: Principal) {
    return this.tenancy.run(p, async (tx) => {
      const current = await tx.query(`select distinct on (type) id, type, version, text_ar, text_en, published_at from consent_versions order by type, version desc`);
      const given = await tx.query(`select distinct on (patient_id, type) patient_id, type, granted, version_id, created_at from consents order by patient_id, type, created_at desc`);
      // FR-PRV-2: flag re-consent when the latest version differs from the one granted.
      return { versions: current, consents: given.map((g) => ({ ...g, needsReconsent: !current.some((v) => v.id === g.version_id) })) };
    });
  }

  @Post('consents')
  @PatientAuth()
  giveConsent(@Auth() p: Principal, @Body() body: unknown, @Meta() meta: RequestMeta, @Req() req: Request) {
    const pt = asPatient(p);
    const b = parse(z.object({ patientId: z.string().uuid(), type: z.enum(CONSENT_TYPES), granted: z.boolean(), versionId: z.string().uuid() }), body);
    this.own(pt, b.patientId);
    return this.tenancy.run(pt, async (tx) => {
      const v = await tx.maybeOne<{ type: string }>('select type from consent_versions where id = $1', [b.versionId]);
      if (!v || v.type !== b.type) throw badRequest('invalid_consent_version');
      const r = await tx.one(
        `insert into consents (organisation_id, patient_id, version_id, type, granted, channel, ip, device) values (app_org(), $1,$2,$3,$4,$5,$6::inet,$7) returning id, type, granted, created_at`,
        [b.patientId, b.versionId, b.type, b.granted, req.headers['x-client'] === 'app' ? 'app' : 'portal', meta.ip, meta.userAgent?.slice(0, 200) ?? null],
      );
      await this.audit.record(tx, pt, meta, { action: 'privacy.consent', entity: 'patient', entityId: b.patientId, patientId: b.patientId, details: { type: b.type, granted: b.granted } });
      return r;
    });
  }

  /** FR-PRV-4 data subject requests with a 30-day SLA. */
  @Post('data-requests')
  @PatientAuth()
  dataRequest(@Auth() p: Principal, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const pt = asPatient(p);
    const b = parse(z.object({ patientId: z.string().uuid(), kind: z.enum(['access', 'export', 'correction', 'erasure']), details: z.string().max(2000).optional() }), body);
    this.own(pt, b.patientId);
    return this.tenancy.run(pt, async (tx) => {
      const r = await tx.one(`insert into data_requests (organisation_id, patient_id, kind, details, due_at) values (app_org(), $1,$2,$3, now() + interval '30 days') returning *`, [b.patientId, b.kind, b.details ?? null]);
      await this.audit.record(tx, pt, meta, { action: `privacy.request_${b.kind}`, entity: 'data_request', entityId: (r as { id: string }).id, patientId: b.patientId });
      return r;
    });
  }

  @Post('account/delete')
  @PatientAuth()
  @HttpCode(200)
  deleteAccount(@Auth() p: Principal, @Meta() meta: RequestMeta) {
    const pt = asPatient(p);
    return this.tenancy.system(pt.orgId, async (tx) => {
      await tx.query(`update patient_accounts set deletion_requested_at = now(), status = 'deletion_requested' where id = $1`, [pt.accountId]);
      await tx.query('update refresh_tokens set revoked_at = now() where account_id = $1 and revoked_at is null', [pt.accountId]);
      for (const pid of pt.patientIds) await tx.query(`insert into data_requests (organisation_id, patient_id, kind, details, due_at) values (app_org(), $1, 'erasure', 'account deletion request', now() + interval '30 days')`, [pid]);
      await this.audit.record(tx, pt, meta, { action: 'privacy.account_deletion', entity: 'patient_account', entityId: pt.accountId });
      return { ok: true };
    });
  }

  @Post('devices')
  @PatientAuth()
  device(@Auth() p: Principal, @Body() body: unknown) {
    const pt = asPatient(p);
    const b = parse(z.object({ token: z.string().min(20).max(4096), platform: z.enum(['ios', 'android', 'web']) }), body);
    return this.tenancy.system(pt.orgId, (tx) =>
      tx.one(`insert into device_tokens (organisation_id, account_id, token, platform) values (app_org(), $1,$2,$3) on conflict (token) do update set account_id = excluded.account_id returning id`, [pt.accountId, b.token, b.platform]),
    );
  }
}
