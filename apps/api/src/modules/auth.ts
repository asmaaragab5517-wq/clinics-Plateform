import { Body, Controller, Get, HttpCode, Inject, Injectable, Post, Req } from '@nestjs/common';
import { randomInt, randomUUID, scryptSync, timingSafeEqual, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { otpRequestSchema, otpVerifySchema, refreshSchema } from '@hf/shared';
import type { Request } from 'express';
import { CONFIG, type Config } from '../config';
import { Auth, Meta, PatientAuth, Public, Staff } from '../common/decorators';
import { DomainError, badRequest, forbidden } from '../common/errors';
import { asPatient, asStaff } from '../common/auth.guard';
import type { Principal, RequestMeta } from '../common/principal';
import { AuditService, Tenancy } from '../common/services';
import { TokenService } from '../common/tokens';
import { parse } from '../common/zod';
import { MessagingService } from './messaging.service';
import { HttpStatus } from '@nestjs/common';

const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 3;
const OTP_RESEND_MS = 60 * 1000;
const OTP_PER_PHONE_HOUR = 5;
const OTP_PER_IP_HOUR = 20;
const REFRESH_TTL_DAYS = 30;

@Injectable()
export class AuthService {
  constructor(
    private readonly tenancy: Tenancy,
    private readonly tokens: TokenService,
    private readonly messaging: MessagingService,
    private readonly audit: AuditService,
    @Inject(CONFIG) private readonly cfg: Config,
  ) {}

  /** IAM-4: 6 digits, 5 minutes, 3 attempts, resend after 60 s, 5/phone/hour, 20/IP/hour. */
  async requestOtp(orgId: string, phone: string, purpose: string, ip: string | null) {
    const { code, messageId } = await this.tenancy.system(orgId, async (tx) => {
      const stats = await tx.one<{ phone_hour: number; ip_hour: number; last: Date | null }>(
        `select (select count(*)::int from otp_codes where phone = $1 and created_at > now() - interval '1 hour') as phone_hour,
                (select count(*)::int from otp_codes where ip = $2::inet and created_at > now() - interval '1 hour') as ip_hour,
                (select max(created_at) from otp_codes where phone = $1) as last`,
        [phone, ip],
      );
      if (stats.last && Date.now() - new Date(stats.last).getTime() < OTP_RESEND_MS) throw new DomainError('otp_resend_too_soon', HttpStatus.TOO_MANY_REQUESTS);
      if (stats.phone_hour >= OTP_PER_PHONE_HOUR || (ip && stats.ip_hour >= OTP_PER_IP_HOUR)) throw new DomainError('otp_rate_limited', HttpStatus.TOO_MANY_REQUESTS);
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      await tx.query(`update otp_codes set consumed_at = now() where phone = $1 and purpose = $2 and consumed_at is null`, [phone, purpose]);
      await tx.query(
        `insert into otp_codes (organisation_id, phone, purpose, code_hash, expires_at, ip) values (app_org(), $1, $2, $3, $4, $5::inet)`,
        [phone, purpose, this.tokens.hashOtp(phone, code), new Date(Date.now() + OTP_TTL_MS), ip],
      );
      const acct = await tx.maybeOne<{ locale: 'ar' | 'en' }>('select locale from patient_accounts where phone = $1', [phone]);
      const [messageId] = await this.messaging.enqueue(tx, { event: 'otp', to: { phone }, locale: acct?.locale ?? 'ar', vars: { code }, channels: ['sms'] });
      return { code, messageId };
    });
    if (messageId) await this.messaging.dispatch(orgId, messageId);
    return { sent: true, expiresInSeconds: OTP_TTL_MS / 1000, resendAfterSeconds: OTP_RESEND_MS / 1000, ...(this.cfg.OTP_DEV_ECHO && !this.cfg.isProd ? { devCode: code } : {}) };
  }

  async verifyOtp(orgId: string, phone: string, code: string, deviceId: string | undefined, meta: RequestMeta) {
    return this.tenancy.system(orgId, async (tx) => {
      const otp = await tx.maybeOne<{ id: string; code_hash: string; attempts: number; expires_at: Date }>(
        `select id, code_hash, attempts, expires_at from otp_codes where phone = $1 and purpose = 'login' and consumed_at is null order by created_at desc limit 1 for update`,
        [phone],
      );
      if (!otp || new Date(otp.expires_at) < new Date()) throw new DomainError('otp_expired', HttpStatus.UNAUTHORIZED);
      if (otp.attempts >= OTP_MAX_ATTEMPTS) throw new DomainError('otp_attempts_exceeded', HttpStatus.UNAUTHORIZED);
      const a = Buffer.from(otp.code_hash, 'hex');
      const b = Buffer.from(this.tokens.hashOtp(phone, code), 'hex');
      if (!timingSafeEqual(a, b)) {
        await tx.query('update otp_codes set attempts = attempts + 1 where id = $1', [otp.id]);
        return { ok: false as const };
      }
      await tx.query('update otp_codes set consumed_at = now() where id = $1', [otp.id]);
      let acct = await tx.maybeOne<{ id: string; locale: string; status: string }>('select id, locale, status from patient_accounts where phone = $1', [phone]);
      if (!acct) acct = await tx.one<{ id: string; locale: string; status: string }>(`insert into patient_accounts (organisation_id, phone) values (app_org(), $1) returning id, locale, status`, [phone]);
      if (acct.status !== 'active') throw forbidden('account_disabled');
      // Possession of the phone (proved by OTP) links patient records registered with it as primary contact.
      await tx.query(
        `insert into patient_links (organisation_id, account_id, patient_id, relation, confirmed_at)
         select app_org(), $1, c.patient_id, case when row_number() over (order by p.created_at) = 1 then 'self' else 'other' end, now()
         from patient_contacts c join patients p on p.id = c.patient_id
         where c.phone = $2 and c.is_primary and p.merged_into_id is null and p.deleted_at is null
         on conflict (account_id, patient_id) do update set confirmed_at = coalesce(patient_links.confirmed_at, now())`,
        [acct.id, phone],
      );
      const refresh = this.tokens.newRefreshToken();
      await tx.query(
        `insert into refresh_tokens (organisation_id, account_id, token_hash, family, device_id, expires_at) values (app_org(), $1, $2, $3, $4, now() + interval '${REFRESH_TTL_DAYS} days')`,
        [acct.id, refresh.hash, randomUUID(), deviceId ?? null],
      );
      await this.audit.record(tx, { kind: 'patient', orgId, accountId: acct.id, phone, patientIds: [] }, meta, { action: 'auth.login', entity: 'patient_account', entityId: acct.id });
      return { ok: true as const, accessToken: await this.tokens.signPatient(acct.id, orgId, phone), refreshToken: refresh.token, accountId: acct.id, locale: acct.locale };
    });
  }

  /** Rotating refresh tokens with reuse detection: presenting a rotated token revokes the whole family. */
  async refresh(orgId: string, token: string) {
    const r = await this.tenancy.system(orgId, async (tx) => {
      const row = await tx.maybeOne<{ id: string; account_id: string; family: string; revoked_at: Date | null; expires_at: Date; phone: string; device_id: string | null }>(
        `select r.id, r.account_id, r.family, r.revoked_at, r.expires_at, r.device_id, a.phone from refresh_tokens r join patient_accounts a on a.id = r.account_id where r.token_hash = $1 for update of r`,
        [this.tokens.hashRefresh(token)],
      );
      if (!row) throw new DomainError('invalid_refresh_token', HttpStatus.UNAUTHORIZED);
      if (row.revoked_at) {
        // Commit the family revocation before reporting the reuse.
        await tx.query('update refresh_tokens set revoked_at = now() where family = $1 and revoked_at is null', [row.family]);
        return { reused: true as const };
      }
      if (new Date(row.expires_at) < new Date()) throw new DomainError('refresh_token_expired', HttpStatus.UNAUTHORIZED);
      const next = this.tokens.newRefreshToken();
      const created = await tx.one<{ id: string }>(
        `insert into refresh_tokens (organisation_id, account_id, token_hash, family, device_id, expires_at) values (app_org(), $1, $2, $3, $4, now() + interval '${REFRESH_TTL_DAYS} days') returning id`,
        [row.account_id, next.hash, row.family, row.device_id],
      );
      await tx.query('update refresh_tokens set revoked_at = now(), replaced_by = $2 where id = $1', [row.id, created.id]);
      return { reused: false as const, accessToken: await this.tokens.signPatient(row.account_id, orgId, row.phone), refreshToken: next.token };
    });
    if (r.reused) throw new DomainError('refresh_token_reused', HttpStatus.UNAUTHORIZED);
    return { accessToken: r.accessToken, refreshToken: r.refreshToken };
  }

  /** Signs out one device (its refresh-token family) when a token is given, otherwise every device. */
  async logout(orgId: string, accountId: string, refreshToken?: string) {
    await this.tenancy.system(orgId, (tx) =>
      refreshToken
        ? tx.query('update refresh_tokens set revoked_at = now() where account_id = $1 and revoked_at is null and family = (select family from refresh_tokens where token_hash = $2)', [accountId, this.tokens.hashRefresh(refreshToken)])
        : tx.query('update refresh_tokens set revoked_at = now() where account_id = $1 and revoked_at is null', [accountId]).then(() =>
            // Signing out everywhere also stops push to every device of the account.
            tx.query('delete from device_tokens where account_id = $1', [accountId]),
          ),
    );
    return { ok: true };
  }
}

function hashPin(pin: string): string {
  const salt = randomBytes(16);
  return `${salt.toString('hex')}:${scryptSync(pin, salt, 32).toString('hex')}`;
}
function checkPin(pin: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  const h = scryptSync(pin, Buffer.from(salt!, 'hex'), 32);
  return timingSafeEqual(h, Buffer.from(hash!, 'hex'));
}

@Controller('v1/auth')
export class AuthController {
  constructor(
    private readonly svc: AuthService,
    private readonly tokens: TokenService,
    private readonly tenancy: Tenancy,
    private readonly audit: AuditService,
    @Inject(CONFIG) private readonly cfg: Config,
  ) {}

  @Post('otp/request')
  @Public()
  @HttpCode(200)
  request(@Auth() p: Principal, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const b = parse(otpRequestSchema, body);
    return this.svc.requestOtp(p.orgId, b.phone, b.purpose, meta.ip);
  }

  @Post('otp/verify')
  @Public()
  @HttpCode(200)
  async verify(@Auth() p: Principal, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const b = parse(otpVerifySchema, body);
    const r = await this.svc.verifyOtp(p.orgId, b.phone, b.code, b.deviceId, meta);
    if (!r.ok) throw new DomainError('otp_invalid', HttpStatus.UNAUTHORIZED);
    return r;
  }

  @Post('refresh')
  @Public()
  @HttpCode(200)
  refresh(@Auth() p: Principal, @Body() body: unknown) {
    return this.svc.refresh(p.orgId, parse(refreshSchema, body).refreshToken);
  }

  @Post('logout')
  @PatientAuth()
  @HttpCode(200)
  logout(@Auth() p: Principal, @Body() body: unknown) {
    const pt = asPatient(p);
    const b = parse(z.object({ refreshToken: z.string().optional(), allDevices: z.boolean().default(false) }), body ?? {});
    return this.svc.logout(pt.orgId, pt.accountId, b.allDevices ? undefined : b.refreshToken);
  }

  @Get('me')
  @Staff()
  async me(@Auth() p: Principal) {
    const s = asStaff(p);
    const clinics = await this.tenancy.run(s, (tx) => tx.query('select id, name_ar, name_en, slug from clinics order by name_ar'));
    return { userId: s.userId, orgId: s.orgId, name: s.name, roles: s.roles, memberships: s.memberships, network: s.network, clinics, privileges: [...s.privileges].sort(), authTime: s.authTime };
  }

  /** Development only: mint a staff token for a seeded user (Keycloak replaces this in staging/production). */
  @Post('dev/staff-token')
  @Public()
  @HttpCode(200)
  async devStaffToken(@Auth() p: Principal, @Body() body: unknown) {
    if (this.cfg.isProd || !this.cfg.AUTH_DEV_SECRET) throw forbidden('dev_auth_disabled');
    const { email } = parse(z.object({ email: z.string().email() }), body);
    const u = await this.tenancy.system(p.orgId, (tx) => tx.maybeOne<{ keycloak_sub: string }>(`select keycloak_sub from users where email = $1 and status = 'active'`, [email]));
    if (!u) throw badRequest('unknown_user');
    return { accessToken: await this.tokens.signDevStaff(u.keycloak_sub) };
  }

  /** Development only: platform (SaaS) admin token. */
  @Post('dev/platform-token')
  @Public()
  @HttpCode(200)
  async devPlatformToken(@Body() body: unknown) {
    if (this.cfg.isProd || !this.cfg.AUTH_DEV_SECRET) throw forbidden('dev_auth_disabled');
    const { email } = parse(z.object({ email: z.string().email() }), body);
    const a = (await this.tenancy.db.raw<{ keycloak_sub: string }>('select * from platform_admin_sub($1)', [email]))[0];
    if (!a) throw badRequest('unknown_admin');
    return { accessToken: await this.tokens.signDevPlatform(a.keycloak_sub) };
  }

  /** Quick PIN re-unlock for shared reception PCs after idle timeout (IAM-2). */
  @Post('pin')
  @Staff()
  @HttpCode(200)
  async setPin(@Auth() p: Principal, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const s = asStaff(p);
    const { pin } = parse(z.object({ pin: z.string().regex(/^\d{4,8}$/) }), body);
    await this.tenancy.run(s, async (tx) => {
      await tx.query('update users set pin_hash = $2 where id = $1', [s.userId, hashPin(pin)]);
      await this.audit.record(tx, s, meta, { action: 'auth.pin_set', entity: 'user', entityId: s.userId });
    });
    return { ok: true };
  }

  @Post('pin/verify')
  @Staff()
  @HttpCode(200)
  async verifyPin(@Auth() p: Principal, @Body() body: unknown, @Req() _req: Request) {
    const s = asStaff(p);
    const { pin } = parse(z.object({ pin: z.string().regex(/^\d{4,8}$/) }), body);
    const row = await this.tenancy.run(s, (tx) => tx.maybeOne<{ pin_hash: string | null }>('select pin_hash from users where id = $1', [s.userId]));
    if (!row?.pin_hash || !checkPin(pin, row.pin_hash)) throw new DomainError('pin_invalid', HttpStatus.UNAUTHORIZED);
    return { ok: true };
  }
}
