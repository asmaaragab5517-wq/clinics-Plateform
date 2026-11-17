import { Inject, Injectable } from '@nestjs/common';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { SignJWT, createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { CONFIG, type Config } from '../config';

export interface StaffClaims extends JWTPayload {
  sub: string;
  auth_time?: number;
  amr?: string[];
  acr?: string;
}

@Injectable()
export class TokenService {
  private readonly patientKey: Uint8Array;
  private readonly devKey: Uint8Array | null;
  private readonly jwks: ReturnType<typeof createRemoteJWKSet> | null;

  constructor(@Inject(CONFIG) private readonly cfg: Config) {
    this.patientKey = new TextEncoder().encode(cfg.PATIENT_JWT_SECRET);
    this.devKey = cfg.AUTH_DEV_SECRET && !cfg.isProd ? new TextEncoder().encode(cfg.AUTH_DEV_SECRET) : null;
    this.jwks = cfg.KEYCLOAK_ISSUER ? createRemoteJWKSet(new URL(`${cfg.KEYCLOAK_ISSUER}/protocol/openid-connect/certs`)) : null;
  }

  /** Patient access token: 15 minutes (SRS §2.1). */
  async signPatient(accountId: string, orgId: string, phone: string): Promise<string> {
    return new SignJWT({ org: orgId, phone, typ: 'patient' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(accountId)
      .setIssuer('hf-api')
      .setAudience('hf-patient')
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(this.patientKey);
  }

  async verifyPatient(token: string): Promise<{ accountId: string; orgId: string; phone: string } | null> {
    try {
      const { payload } = await jwtVerify(token, this.patientKey, { issuer: 'hf-api', audience: 'hf-patient', algorithms: ['HS256'] });
      if (payload.typ !== 'patient' || typeof payload.org !== 'string' || !payload.sub) return null;
      return { accountId: payload.sub, orgId: payload.org, phone: String(payload.phone ?? '') };
    } catch {
      return null;
    }
  }

  /** Staff token from Keycloak (RS256 via JWKS) or, outside production, a dev HS256 token. */
  async verifyStaff(token: string): Promise<StaffClaims | null> {
    try {
      if (this.jwks && this.cfg.KEYCLOAK_ISSUER) {
        const { payload } = await jwtVerify(token, this.jwks, { issuer: this.cfg.KEYCLOAK_ISSUER, audience: this.cfg.KEYCLOAK_AUDIENCE });
        if (this.cfg.STAFF_REQUIRE_MFA && !(payload.amr as string[] | undefined)?.some((m) => ['otp', 'totp', 'mfa'].includes(m))) return null;
        return payload as StaffClaims;
      }
    } catch {
      /* fall through to dev */
    }
    if (!this.devKey) return null;
    try {
      const { payload } = await jwtVerify(token, this.devKey, { issuer: 'hf-dev', audience: 'hf-staff', algorithms: ['HS256'] });
      return payload as StaffClaims;
    } catch {
      return null;
    }
  }

  async signDevStaff(sub: string, authTime = Math.floor(Date.now() / 1000)): Promise<string> {
    if (!this.devKey) throw new Error('dev staff tokens disabled');
    return new SignJWT({ amr: ['pwd', 'otp'], auth_time: authTime })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(sub)
      .setIssuer('hf-dev')
      .setAudience('hf-staff')
      .setIssuedAt()
      .setExpirationTime('8h')
      .sign(this.devKey);
  }

  async signDevPlatform(sub: string): Promise<string> {
    if (!this.devKey) throw new Error('dev tokens disabled');
    return new SignJWT({ amr: ['pwd', 'otp'], auth_time: Math.floor(Date.now() / 1000), typ: 'platform' })
      .setProtectedHeader({ alg: 'HS256' }).setSubject(sub).setIssuer('hf-dev').setAudience('hf-staff').setIssuedAt().setExpirationTime('8h').sign(this.devKey);
  }

  /** Support token: one platform admin, one organisation, valid only inside the owner-approved window. */
  async signSupport(adminId: string, accessId: string, orgId: string, endsAt: Date): Promise<string> {
    return new SignJWT({ typ: 'support', org: orgId, access: accessId })
      .setProtectedHeader({ alg: 'HS256' }).setSubject(adminId).setIssuer('hf-api').setAudience('hf-support').setIssuedAt()
      .setExpirationTime(Math.floor(endsAt.getTime() / 1000)).sign(new TextEncoder().encode(this.cfg.SUPPORT_TOKEN_SECRET));
  }

  async verifySupport(token: string): Promise<{ adminId: string; accessId: string; orgId: string } | null> {
    try {
      const { payload } = await jwtVerify(token, new TextEncoder().encode(this.cfg.SUPPORT_TOKEN_SECRET), { issuer: 'hf-api', audience: 'hf-support', algorithms: ['HS256'] });
      if (payload.typ !== 'support' || !payload.sub) return null;
      return { adminId: payload.sub, accessId: String(payload.access), orgId: String(payload.org) };
    } catch {
      return null;
    }
  }

  /** Waiting-room display token, bound to one clinic (FR-APT-6). */
  async signDisplay(orgId: string, clinicId: string): Promise<string> {
    return new SignJWT({ org: orgId, clinic: clinicId, typ: 'display' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('hf-api')
      .setAudience('hf-display')
      .setIssuedAt()
      .setExpirationTime('365d')
      .sign(new TextEncoder().encode(this.cfg.DISPLAY_TOKEN_SECRET));
  }

  async verifyDisplay(token: string): Promise<{ orgId: string; clinicId: string } | null> {
    try {
      const { payload } = await jwtVerify(token, new TextEncoder().encode(this.cfg.DISPLAY_TOKEN_SECRET), { issuer: 'hf-api', audience: 'hf-display' });
      return { orgId: String(payload.org), clinicId: String(payload.clinic) };
    } catch {
      return null;
    }
  }

  /** Expiring signed link for sharing a document via WhatsApp (FR-RX-6). */
  signShareLink(kind: string, id: string, ttlSeconds = 7 * 86400): string {
    const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
    const mac = createHmac('sha256', this.cfg.SHARE_LINK_SECRET).update(`${kind}:${id}:${exp}`).digest('base64url');
    return `${id}.${exp}.${mac}`;
  }

  verifyShareLink(kind: string, token: string): string | null {
    const [id, expStr, mac] = token.split('.');
    if (!id || !expStr || !mac || Number(expStr) < Date.now() / 1000) return null;
    const expected = createHmac('sha256', this.cfg.SHARE_LINK_SECRET).update(`${kind}:${id}:${expStr}`).digest('base64url');
    const a = Buffer.from(mac);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b) ? id : null;
  }

  hashOtp(phone: string, code: string): string {
    return createHmac('sha256', this.cfg.OTP_PEPPER).update(`${phone}:${code}`).digest('hex');
  }

  newRefreshToken(): { token: string; hash: string } {
    const token = randomBytes(32).toString('base64url');
    return { token, hash: createHash('sha256').update(token).digest('hex') };
  }

  hashRefresh(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
