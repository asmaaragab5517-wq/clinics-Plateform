import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { smsSegments } from '@hf/shared';
import { CONFIG, type Config } from '../config';

export interface OutboundMessage {
  channel: 'sms' | 'whatsapp' | 'email' | 'push';
  to: string;
  locale: 'ar' | 'en';
  body: string;
  subject?: string;
  providerTemplateId?: string | null;
  templateVars?: Record<string, string>;
}
export interface SendResult {
  providerMessageId: string;
  segments?: number;
  cost?: number; // piastres
}
export interface ChannelProvider {
  send(m: OutboundMessage): Promise<SendResult>;
}

export const SMS_COST_PER_SEGMENT = 25; // piastres, configurable per contract
export const WHATSAPP_COST = 40;

/**
 * Cequens SMS + WhatsApp (FR-COM-1). Sender ID depends on language (Arabic/Latin approved IDs).
 * Endpoint paths follow Cequens' messaging API; see docs/integrations/cequens.md.
 */
@Injectable()
export class CequensProvider implements ChannelProvider {
  private readonly log = new Logger('Cequens');
  constructor(@Inject(CONFIG) private readonly cfg: Config) {}

  async send(m: OutboundMessage): Promise<SendResult> {
    const recipient = m.to.replace(/^\+/, '');
    const isWa = m.channel === 'whatsapp';
    const body = isWa
      ? { recipient, type: 'template', template: { name: m.providerTemplateId, language: m.locale, parameters: Object.values(m.templateVars ?? {}) } }
      : { messageText: m.body, senderName: m.locale === 'ar' ? this.cfg.CEQUENS_SENDER_AR : this.cfg.CEQUENS_SENDER_EN, messageType: 'text', recipients: recipient, dlrUrl: `${this.cfg.API_PUBLIC_URL}/v1/webhooks/cequens` };
    const res = await fetch(`${this.cfg.CEQUENS_BASE_URL}${isWa ? '/whatsapp/v1/messages' : '/sms/v1/messages'}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.cfg.CEQUENS_API_KEY}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      this.log.warn(`Cequens ${m.channel} failed ${res.status}`);
      throw new Error(`cequens_${res.status}`);
    }
    const json = (await res.json()) as { data?: { SentSMSIDs?: { SMSId: string }[]; messageId?: string } };
    const id = json.data?.SentSMSIDs?.[0]?.SMSId ?? json.data?.messageId ?? randomUUID();
    const segments = isWa ? 1 : smsSegments(m.body).segments;
    return { providerMessageId: id, segments, cost: isWa ? WHATSAPP_COST : segments * SMS_COST_PER_SEGMENT };
  }
}

export function verifyCequensSignature(secret: string, header: string | undefined, raw: Buffer): boolean {
  if (!header) return false;
  const expected = createHmac('sha256', secret).update(raw).digest('hex');
  const a = Buffer.from(header, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Records messages in memory; used in dev and tests. */
@Injectable()
export class FakeProvider implements ChannelProvider {
  readonly sent: (OutboundMessage & { id: string })[] = [];
  private readonly log = new Logger('FakeMessaging');
  async send(m: OutboundMessage): Promise<SendResult> {
    const id = `fake_${randomUUID()}`;
    this.sent.push({ ...m, id });
    // Never log message bodies (they may contain OTPs or PHI) - SEC-11.
    this.log.debug(`would send ${m.channel} to ${m.to.slice(0, 6)}…`);
    return { providerMessageId: id, segments: m.channel === 'sms' ? smsSegments(m.body).segments : 1, cost: m.channel === 'sms' ? smsSegments(m.body).segments * SMS_COST_PER_SEGMENT : 0 };
  }
}

/** SMTP email via nodemailer. */
@Injectable()
export class SmtpProvider implements ChannelProvider {
  private transport: import('nodemailer').Transporter | null = null;
  constructor(@Inject(CONFIG) private readonly cfg: Config) {}
  async send(m: OutboundMessage): Promise<SendResult> {
    if (!this.transport) {
      const nm = await import('nodemailer');
      this.transport = nm.createTransport(this.cfg.SMTP_URL!);
    }
    const info = await this.transport.sendMail({ from: this.cfg.MAIL_FROM, to: m.to, subject: m.subject ?? 'HealthFlow', text: m.body, html: `<div dir="${m.locale === 'ar' ? 'rtl' : 'ltr'}">${m.body.replace(/</g, '&lt;').replace(/\n/g, '<br>')}</div>` });
    return { providerMessageId: info.messageId, cost: 0 };
  }
}

/** FCM HTTP v1 with a service-account OAuth token (FR-COM-7: per-device tokens only). */
@Injectable()
export class FcmProvider implements ChannelProvider {
  private token: { value: string; exp: number } | null = null;
  constructor(@Inject(CONFIG) private readonly cfg: Config) {}

  private async accessToken(sa: { client_email: string; private_key: string; project_id: string }) {
    if (this.token && this.token.exp > Date.now() + 60000) return this.token.value;
    const { SignJWT, importPKCS8 } = await import('jose');
    const key = await importPKCS8(sa.private_key, 'RS256');
    const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/firebase.messaging' })
      .setProtectedHeader({ alg: 'RS256' }).setIssuer(sa.client_email).setAudience('https://oauth2.googleapis.com/token').setIssuedAt().setExpirationTime('1h').sign(key);
    const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }) });
    const json = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: json.access_token, exp: Date.now() + json.expires_in * 1000 };
    return json.access_token;
  }

  async send(m: OutboundMessage): Promise<SendResult> {
    const sa = JSON.parse(this.cfg.FCM_SERVICE_ACCOUNT_JSON!);
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${await this.accessToken(sa)}` },
      // Push payloads carry no PHI: a generic title, body text, and a deep link.
      body: JSON.stringify({ message: { token: m.to, notification: { title: m.subject ?? 'HealthFlow', body: m.body } } }),
    });
    if (!res.ok) throw new Error(`fcm_${res.status}`);
    const json = (await res.json()) as { name: string };
    return { providerMessageId: json.name, cost: 0 };
  }
}

export const CHANNELS = Symbol('CHANNELS');
export type ChannelRegistry = Record<OutboundMessage['channel'], ChannelProvider>;
