import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Injectable, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Response } from 'express';
import { z } from 'zod';
import type { SecretBox, Tx } from '@hf/db';
import { localDate, zDate } from '@hf/shared';
import { Auth, Meta, PatientAuth, Staff, Webhook } from '../common/decorators';
import { asPatient, asStaff } from '../common/auth.guard';
import type { Principal, RequestMeta } from '../common/principal';
import { AuditService, BOX, Tenancy } from '../common/services';
import { DomainError, badRequest, forbidden, notFound } from '../common/errors';
import { parse, uuid } from '../common/zod';
import { CONFIG, type Config } from '../config';
import { CALENDAR_SCOPE, GOOGLE, type GoogleClient, type GoogleTokens } from '../integrations/google';
import { VIDEO, type VideoProvider } from '../integrations/video';
import { AppointmentsService, type ApptRow } from './appointments.service';

const JOIN_OPENS_MIN = 10; // FR-TEL-4: patient joins from T-10 min
const JOIN_CLOSES_MIN = 30; // after the scheduled end

interface SessionRow {
  id: string; appointment_id: string; doctor_id: string; patient_id: string; clinic_id: string; provider: string; meeting_id: string;
  host_url_enc: Buffer; join_url_enc: Buffer; passcode_enc: Buffer | null; status: string; patient_joined_at: Date | null; admitted_at: Date | null;
}

@Injectable()
export class GoogleTokenStore {
  constructor(@Inject(BOX) private readonly box: SecretBox, @Inject(GOOGLE) private readonly google: GoogleClient) {}
  /** Fresh access token for a user's Google connection (refreshed and re-encrypted when expired). */
  async tokens(tx: Tx, userId: string): Promise<GoogleTokens | null> {
    const c = await tx.maybeOne<{ id: string; tokens_enc: Buffer }>(`select id, tokens_enc from oauth_connections where user_id = $1 and provider = 'google' and revoked_at is null`, [userId]);
    if (!c) return null;
    const t = JSON.parse(this.box.decrypt(c.tokens_enc, `oauth:${c.id}`)) as GoogleTokens;
    const fresh = await this.google.refresh(t);
    if (fresh.access_token !== t.access_token) await tx.query('update oauth_connections set tokens_enc = $2 where id = $1', [c.id, this.box.encrypt(JSON.stringify(fresh), `oauth:${c.id}`)]);
    return fresh;
  }
}

@Injectable()
export class TelemedicineService {
  constructor(
    @Inject(VIDEO) private readonly video: VideoProvider,
    @Inject(BOX) private readonly box: SecretBox,
    private readonly googleTokens: GoogleTokenStore,
  ) {}

  static isTelemedicine = async (tx: Tx, appointmentId: string) =>
    !!(await tx.maybeOne(`select 1 from appointment_services x join services s on s.id = x.service_id where x.appointment_id = $1 and s.type = 'telemedicine'`, [appointmentId]));

  /** Create the per-appointment meeting once (worker ahead of time, or on first join). */
  async ensureSession(tx: Tx, a: ApptRow): Promise<SessionRow> {
    const existing = await tx.maybeOne<SessionRow>('select * from telemedicine_sessions where appointment_id = $1', [a.id]);
    if (existing) return existing;
    const google = this.video.name === 'google_meet' ? await this.googleTokens.tokens(tx, a.doctor_id) : null;
    const m = await this.video.createMeeting({
      appointmentId: a.id, topic: `HealthFlow ${a.ref}`, start: new Date(a.start_at),
      durationMinutes: Math.max(10, Math.round((new Date(a.end_at).getTime() - new Date(a.start_at).getTime()) / 60000)), googleAccessToken: google?.access_token,
    });
    const aad = `tele:${a.id}`;
    return tx.one<SessionRow>(
      `insert into telemedicine_sessions (organisation_id, clinic_id, appointment_id, patient_id, doctor_id, provider, meeting_id, host_url_enc, join_url_enc, passcode_enc)
       values (app_org(), $1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict (appointment_id) do update set provider = telemedicine_sessions.provider returning *`,
      [a.clinic_id, a.id, a.patient_id, a.doctor_id, this.video.name, m.meetingId, this.box.encrypt(m.hostUrl, aad), this.box.encrypt(m.joinUrl, aad), m.passcode ? this.box.encrypt(m.passcode, aad) : null],
    );
  }

  open(s: SessionRow, which: 'host' | 'join') {
    const aad = `tele:${s.appointment_id}`;
    return { url: this.box.decrypt(which === 'host' ? s.host_url_enc : s.join_url_enc, aad), passcode: s.passcode_enc ? this.box.decrypt(s.passcode_enc, aad) : null, provider: s.provider };
  }

  async cancel(tx: Tx, s: SessionRow) {
    const google = s.provider === 'google_meet' ? await this.googleTokens.tokens(tx, s.doctor_id) : null;
    await this.video.deleteMeeting(s.meeting_id, google?.access_token).catch(() => undefined);
    await tx.query(`update telemedicine_sessions set status = 'cancelled' where id = $1`, [s.id]);
  }

  window(a: ApptRow) {
    const opens = new Date(new Date(a.start_at).getTime() - JOIN_OPENS_MIN * 60000);
    const closes = new Date(new Date(a.end_at).getTime() + JOIN_CLOSES_MIN * 60000);
    return { opens, closes, open: Date.now() >= opens.getTime() && Date.now() <= closes.getTime() };
  }
}

@Controller('v1')
export class TelemedicineController {
  constructor(
    private readonly tenancy: Tenancy,
    private readonly audit: AuditService,
    private readonly tele: TelemedicineService,
    private readonly appointments: AppointmentsService,
    private readonly googleTokens: GoogleTokenStore,
    @Inject(GOOGLE) private readonly google: GoogleClient,
    @Inject(BOX) private readonly box: SecretBox,
    @Inject(CONFIG) private readonly cfg: Config,
  ) {}

  // ---- Patient (FR-TEL-4)
  @Get('portal/appointments/:id/telemedicine')
  @PatientAuth()
  async status(@Auth() p: Principal, @Param('id') id: string) {
    const pt = asPatient(p);
    const a = await this.tenancy.run(pt, (tx) => tx.maybeOne<ApptRow>('select * from appointments where id = $1', [uuid(id)]));
    if (!a) throw notFound('appointment');
    return this.tenancy.system(pt.orgId, async (tx) => {
      if (!(await TelemedicineService.isTelemedicine(tx, id))) throw badRequest('not_a_video_consultation');
      const s = await tx.maybeOne<{ status: string }>('select status from telemedicine_sessions where appointment_id = $1', [id]);
      const w = this.tele.window(a);
      return { status: s?.status ?? 'scheduled', opensAt: w.opens, closesAt: w.closes, canJoin: w.open && ['booked', 'confirmed', 'checked_in', 'in_consultation'].includes(a.status) };
    });
  }

  @Post('portal/appointments/:id/telemedicine/join')
  @PatientAuth()
  @HttpCode(200)
  async join(@Auth() p: Principal, @Param('id') id: string, @Meta() meta: RequestMeta) {
    const pt = asPatient(p);
    const a = await this.tenancy.run(pt, (tx) => tx.maybeOne<ApptRow>('select * from appointments where id = $1', [uuid(id)]));
    if (!a) throw notFound('appointment');
    return this.tenancy.system(pt.orgId, async (tx) => {
      if (!(await TelemedicineService.isTelemedicine(tx, id))) throw badRequest('not_a_video_consultation');
      if (!['booked', 'confirmed', 'checked_in', 'in_consultation'].includes(a.status)) throw new DomainError('appointment_not_joinable', HttpStatus.CONFLICT);
      if (!this.tele.window(a).open) throw new DomainError('waiting_room_not_open', HttpStatus.CONFLICT);
      const consent = await tx.maybeOne<{ granted: boolean }>(`select granted from consents where patient_id = $1 and type = 'telemedicine' order by created_at desc limit 1`, [a.patient_id]);
      if (!consent?.granted) throw new DomainError('telemedicine_consent_required');
      const s = await this.tele.ensureSession(tx, a);
      if (a.status === 'booked' || a.status === 'confirmed') await this.appointments.transition(tx, pt, meta, a.id, 'checked_in', { priority: 'booked_on_time' });
      await tx.query(`update telemedicine_sessions set patient_joined_at = coalesce(patient_joined_at, now()), status = case when status = 'scheduled' then 'patient_waiting' else status end where id = $1`, [s.id]);
      await this.audit.record(tx, pt, meta, { action: 'telemedicine.patient_join', entity: 'appointment', entityId: id, patientId: a.patient_id, clinicId: a.clinic_id });
      return this.tele.open(s, 'join');
    });
  }

  // ---- Doctor
  @Get('telemedicine')
  @Staff('queue:view')
  today(@Auth() p: Principal, @Query('date') date?: string) {
    const s = asStaff(p);
    const d = date ? parse(zDate, date) : localDate(new Date());
    return this.tenancy.run(s, (tx) =>
      tx.query(
        `select a.id as appointment_id, a.ref, a.start_at, a.end_at, a.status as appointment_status, a.doctor_id, p.first_name_ar || ' ' || p.family_name_ar as patient_name,
                t.status, t.patient_joined_at, t.admitted_at, t.provider
         from appointments a join patients p on p.id = a.patient_id left join telemedicine_sessions t on t.appointment_id = a.id
         where (a.start_at at time zone 'Africa/Cairo')::date = $1::date and ($2::uuid is null or a.doctor_id = $2)
           and exists (select 1 from appointment_services x join services sv on sv.id = x.service_id where x.appointment_id = a.id and sv.type = 'telemedicine')
         order by a.start_at`,
        [d, s.roles.includes('doctor') && !s.network ? s.userId : null],
      ),
    );
  }

  /** Doctor starts the call (admits from the provider's waiting room) and the visit moves to in_consultation. */
  @Post('telemedicine/:appointmentId/start')
  @Staff('emr:create')
  @HttpCode(200)
  start(@Auth() p: Principal, @Param('appointmentId') id: string, @Meta() meta: RequestMeta) {
    const s = asStaff(p);
    return this.tenancy.run(s, async (tx) => {
      const a = await tx.maybeOne<ApptRow>('select * from appointments where id = $1', [uuid(id)]);
      if (!a) throw notFound('appointment');
      if (a.doctor_id !== s.userId) throw forbidden('not_appointment_doctor');
      if (!(await TelemedicineService.isTelemedicine(tx, id))) throw badRequest('not_a_video_consultation');
      if (!['booked', 'confirmed', 'checked_in', 'in_consultation'].includes(a.status)) throw new DomainError('appointment_not_joinable', HttpStatus.CONFLICT);
      const sess = await this.tele.ensureSession(tx, a);
      if (a.status === 'booked' || a.status === 'confirmed') await this.appointments.transition(tx, s, meta, id, 'checked_in', { priority: 'booked_on_time' });
      const cur = await tx.one<{ status: string }>('select status from appointments where id = $1', [id]);
      if (cur.status === 'checked_in') await this.appointments.transition(tx, s, meta, id, 'in_consultation');
      await tx.query(`update telemedicine_sessions set status = 'in_progress', admitted_at = coalesce(admitted_at, now()) where id = $1`, [sess.id]);
      const encounter = await tx.maybeOne<{ id: string }>('select id from encounters where appointment_id = $1', [id]);
      await this.audit.record(tx, s, meta, { action: 'telemedicine.start', entity: 'appointment', entityId: id, patientId: a.patient_id, clinicId: a.clinic_id });
      return { ...this.tele.open(sess, 'host'), encounterId: encounter?.id ?? null };
    });
  }

  @Post('telemedicine/:appointmentId/end')
  @Staff('emr:create')
  @HttpCode(200)
  end(@Auth() p: Principal, @Param('appointmentId') id: string, @Meta() meta: RequestMeta) {
    const s = asStaff(p);
    return this.tenancy.run(s, async (tx) => {
      const r = await tx.maybeOne<{ patient_id: string }>(`update telemedicine_sessions set status = 'ended', ended_at = now() where appointment_id = $1 and doctor_id = $2 and status in ('patient_waiting','in_progress') returning patient_id`, [uuid(id), s.userId]);
      if (!r) throw notFound('session');
      await this.audit.record(tx, s, meta, { action: 'telemedicine.end', entity: 'appointment', entityId: id, patientId: r.patient_id });
      return { ok: true };
    });
  }

  // ---- Google connection for Calendar sync / Meet (FR-TEL-3, FR-INT-2)
  private signState(nonce: string, userId: string, exp: number) {
    return createHmac('sha256', this.cfg.OAUTH_STATE_SECRET).update(`google:${nonce}:${userId}:${exp}`).digest('base64url');
  }

  @Get('integrations/google')
  @Staff()
  async googleStatus(@Auth() p: Principal) {
    const s = asStaff(p);
    const c = await this.tenancy.run(s, (tx) => tx.maybeOne(`select account_email, scopes, settings, created_at from oauth_connections where user_id = $1 and provider = 'google' and revoked_at is null`, [s.userId]));
    return { connected: !!c, ...(c ?? {}) };
  }

  /** Returns the Google consent URL. State is signed, expiring (10 min), single-use and bound to this user. */
  @Post('integrations/google/connect')
  @Staff()
  @HttpCode(200)
  async connect(@Auth() p: Principal) {
    const s = asStaff(p);
    const nonce = randomBytes(16).toString('base64url');
    const exp = Math.floor(Date.now() / 1000) + 600;
    await this.tenancy.db.raw('select create_oauth_state($1, $2, $3)', [nonce, s.userId, 'google']);
    const state = `${nonce}.${s.userId}.${exp}.${this.signState(nonce, s.userId, exp)}`;
    return { url: this.google.authUrl(state, [CALENDAR_SCOPE]) };
  }

  @Get('integrations/google/callback')
  @Webhook()
  async callback(@Query('code') code: string, @Query('state') state: string, @Res() res: Response) {
    const [nonce, userId, expStr, mac] = (state ?? '').split('.');
    const expected = nonce && userId && expStr ? this.signState(nonce, userId, Number(expStr)) : '';
    const valid = !!mac && mac.length === expected.length && timingSafeEqual(Buffer.from(mac), Buffer.from(expected)) && Number(expStr) > Date.now() / 1000;
    const consumed = valid ? (await this.tenancy.db.raw<{ user_id: string }>('select user_id from consume_oauth_state($1, $2)', [nonce, 'google']))[0] : undefined;
    if (!consumed || consumed.user_id !== userId || !code) return res.redirect(`${this.cfg.CONSOLE_URL}/profile?google=error`);
    const org = (await this.tenancy.db.raw<{ organisation_id: string }>('select organisation_id from user_org($1)', [userId]))[0];
    if (!org) return res.redirect(`${this.cfg.CONSOLE_URL}/profile?google=error`);
    const t = await this.google.exchange(code.slice(0, 2000));
    await this.tenancy.system(org.organisation_id, async (tx) => {
      const row = await tx.one<{ id: string }>(
        `insert into oauth_connections (organisation_id, user_id, provider, scopes, tokens_enc, account_email, settings) values (app_org(), $1, 'google', $2, '\\x00', $3, '{"calendarSync": true, "includePatientNames": false}')
         on conflict (user_id, provider) do update set revoked_at = null, account_email = excluded.account_email, scopes = excluded.scopes, updated_at = now() returning id`,
        [userId, [CALENDAR_SCOPE], t.email ?? null],
      );
      await tx.query('update oauth_connections set tokens_enc = $2 where id = $1', [row.id, this.box.encrypt(JSON.stringify(t), `oauth:${row.id}`)]);
      await this.audit.record(tx, null, null, { action: 'integration.google_connect', entity: 'user', entityId: userId });
    });
    return res.redirect(`${this.cfg.CONSOLE_URL}/profile?google=connected`);
  }

  @Patch('integrations/google')
  @Staff()
  settings(@Auth() p: Principal, @Body() body: unknown) {
    const s = asStaff(p);
    const b = parse(z.object({ calendarSync: z.boolean(), includePatientNames: z.boolean() }), body);
    return this.tenancy.run(s, async (tx) => {
      const r = await tx.maybeOne(`update oauth_connections set settings = $2 where user_id = $1 and provider = 'google' and revoked_at is null returning settings`, [s.userId, JSON.stringify(b)]);
      if (!r) throw notFound('connection');
      return r;
    });
  }

  @Delete('integrations/google')
  @Staff()
  async disconnect(@Auth() p: Principal, @Meta() meta: RequestMeta) {
    const s = asStaff(p);
    return this.tenancy.run(s, async (tx) => {
      const tokens = await this.googleTokens.tokens(tx, s.userId).catch(() => null);
      const events = await tx.query<{ event_id: string }>('select event_id from calendar_sync where doctor_id = $1 and event_id is not null', [s.userId]);
      if (tokens) for (const e of events) await this.google.deleteEvent(tokens, e.event_id).catch(() => undefined);
      await tx.query('delete from calendar_sync where doctor_id = $1', [s.userId]);
      await tx.query(`update oauth_connections set revoked_at = now(), tokens_enc = '\\x00' where user_id = $1 and provider = 'google'`, [s.userId]);
      await this.audit.record(tx, s, meta, { action: 'integration.google_disconnect', entity: 'user', entityId: s.userId });
      return { ok: true };
    });
  }
}

/** FR-INT-2 one-way sync of doctor appointments to Google Calendar, without patient names by default. */
@Injectable()
export class CalendarSyncService {
  constructor(private readonly tokens: GoogleTokenStore, @Inject(GOOGLE) private readonly google: GoogleClient) {}

  async syncOrg(tx: Tx) {
    const conns = await tx.query<{ user_id: string; settings: { calendarSync?: boolean; includePatientNames?: boolean } }>(
      `select user_id, settings from oauth_connections where provider = 'google' and revoked_at is null`,
    );
    let changed = 0;
    for (const c of conns.filter((x) => x.settings.calendarSync !== false)) {
      const t = await this.tokens.tokens(tx, c.user_id).catch(() => null);
      if (!t) continue;
      const rows = await tx.query<{ id: string; ref: string; start_at: Date; end_at: Date; status: string; clinic: string; address: string; patient: string; event_id: string | null; fingerprint: string | null }>(
        `select a.id, a.ref, a.start_at, a.end_at, a.status, c.name_ar as clinic, c.address_lines as address, p.first_name_ar || ' ' || p.family_name_ar as patient, cs.event_id, cs.fingerprint
         from appointments a join clinics c on c.id = a.clinic_id join patients p on p.id = a.patient_id
         left join calendar_sync cs on cs.appointment_id = a.id and cs.doctor_id = a.doctor_id
         where a.doctor_id = $1 and a.start_at > now() - interval '1 day' and a.start_at < now() + interval '60 days'
           and (cs.appointment_id is null or cs.synced_at < a.updated_at)`,
        [c.user_id],
      );
      for (const a of rows) {
        const live = ['booked', 'confirmed', 'checked_in', 'in_consultation', 'completed'].includes(a.status);
        const fp = `${new Date(a.start_at).toISOString()}|${new Date(a.end_at).toISOString()}|${live}|${c.settings.includePatientNames ? 1 : 0}`;
        if (fp === a.fingerprint) {
          await tx.query('update calendar_sync set synced_at = now() where appointment_id = $1 and doctor_id = $2', [a.id, c.user_id]);
          continue;
        }
        let eventId = a.event_id;
        if (!live) {
          if (eventId) await this.google.deleteEvent(t, eventId);
          eventId = null;
        } else {
          eventId = await this.google.upsertEvent(t, eventId, {
            summary: c.settings.includePatientNames ? `${a.patient} · ${a.ref}` : `موعد · ${a.ref}`,
            description: a.clinic, location: `${a.clinic} - ${a.address}`, start: new Date(a.start_at), end: new Date(a.end_at),
          });
        }
        await tx.query(
          `insert into calendar_sync (organisation_id, appointment_id, doctor_id, event_id, fingerprint) values (app_org(), $1,$2,$3,$4)
           on conflict (appointment_id, doctor_id) do update set event_id = excluded.event_id, fingerprint = excluded.fingerprint, synced_at = now()`,
          [a.id, c.user_id, eventId, fp],
        );
        changed++;
      }
    }
    return changed;
  }
}
