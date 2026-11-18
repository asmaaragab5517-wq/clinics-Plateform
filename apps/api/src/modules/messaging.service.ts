import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Tx } from '@hf/db';
import { TRANSACTIONAL_URGENT_EVENTS, inQuietHours, localTime, renderTemplate, smsSegments, zonedToUtc, localDate, addDays, type MessageEvent, catalogs } from '@hf/shared';
import { CHANNELS, type ChannelRegistry } from '../integrations/messaging';
import { Tenancy } from '../common/services';

export interface EnqueueInput {
  event: MessageEvent;
  patientId?: string | null;
  clinicId?: string | null;
  to?: { phone?: string | null; email?: string | null; deviceTokens?: string[] };
  locale?: 'ar' | 'en';
  vars: Record<string, string | number>;
  channels?: ('sms' | 'whatsapp' | 'email' | 'push')[];
  scheduledFor?: Date;
  dedupeKey?: string;
  /** Deep link for push notifications, e.g. { path: '/appointments/<id>' } (docs/integrations/push.md). */
  data?: { path: string };
}

const MARKETING_EVENTS: MessageEvent[] = [];

/**
 * Outbox-based messaging (FR-COM-*). Messages are written in the business transaction and dispatched by the worker,
 * so a failed provider never rolls back a booking. Bodies are purged after 90 days (FR-PRV-6).
 */
@Injectable()
export class MessagingService {
  private readonly log = new Logger('Messaging');
  constructor(
    private readonly tenancy: Tenancy,
    @Inject(CHANNELS) private readonly channels: ChannelRegistry,
  ) {}

  async enqueue(tx: Tx, input: EnqueueInput): Promise<string[]> {
    const org = await tx.one<{ settings: { messaging?: { disabledEvents?: string[] } } }>('select settings from organisations where id = app_org()');
    if (org.settings.messaging?.disabledEvents?.includes(input.event)) return [];
    let phone = input.to?.phone ?? null;
    let locale = input.locale ?? 'ar';
    let prefs: { channels: string[]; sms_opt_out: boolean; whatsapp_opt_out: boolean; marketing_opt_out: boolean } | null = null;
    if (input.patientId) {
      phone ??= (await tx.maybeOne<{ phone: string }>('select phone from patient_contacts where patient_id = $1 order by is_primary desc, created_at limit 1', [input.patientId]))?.phone ?? null;
      prefs = await tx.maybeOne('select channels, sms_opt_out, whatsapp_opt_out, marketing_opt_out from notification_preferences where patient_id = $1', [input.patientId]);
      const acct = await tx.maybeOne<{ locale: 'ar' | 'en' }>(
        'select a.locale from patient_links l join patient_accounts a on a.id = l.account_id where l.patient_id = $1 and l.confirmed_at is not null limit 1',
        [input.patientId],
      );
      if (acct && !input.locale) locale = acct.locale;
    }
    if (prefs?.marketing_opt_out && MARKETING_EVENTS.includes(input.event)) return [];

    // Channel choice: explicit list, else preference order with WhatsApp/push first to control SMS cost.
    const wanted = input.channels ?? (input.event === 'otp' ? ['sms'] : ((prefs?.channels as ('sms' | 'whatsapp' | 'push')[]) ?? ['whatsapp', 'sms']).slice(0, 1));
    const urgent = TRANSACTIONAL_URGENT_EVENTS.includes(input.event);
    let when = input.scheduledFor ?? new Date();
    if (!urgent && inQuietHours(localTime(when))) {
      // Defer to 09:00 Cairo (same day if before 09:00, else next day).
      const day = localTime(when) < '09:00' ? localDate(when) : addDays(localDate(when), 1);
      when = zonedToUtc(day, '09:00');
    }
    const ids: string[] = [];
    for (const channel of wanted) {
      if (input.event !== 'otp') {
        if (channel === 'sms' && prefs?.sms_opt_out) continue;
        if (channel === 'whatsapp' && prefs?.whatsapp_opt_out) continue;
      }
      let pushTokens = input.to?.deviceTokens ?? [];
      if (channel === 'push' && !pushTokens.length && input.patientId) {
        pushTokens = (await tx.query<{ token: string }>(
          `select d.token from device_tokens d join patient_links l on l.account_id = d.account_id and l.confirmed_at is not null where l.patient_id = $1`,
          [input.patientId],
        )).map((r) => r.token);
      }
      const recipients = channel === 'email' ? [input.to?.email] : channel === 'push' ? pushTokens : [phone];
      for (const recipient of recipients.filter((r): r is string => !!r)) {
        const tpl = await tx.maybeOne<{ body: string; is_enabled: boolean }>(
          'select body, is_enabled from message_templates where event = $1 and channel = $2 and locale = $3',
          [input.event, channel === 'email' ? 'sms' : channel, locale],
        );
        if (tpl && !tpl.is_enabled) continue;
        // Organisations without their own template get the built-in wording for the event.
        const builtIn = catalogs[locale]?.[`msg.${input.event}`] ?? catalogs.ar[`msg.${input.event}`];
        const body = tpl ? renderTemplate(tpl.body, input.vars) : builtIn ? renderTemplate(builtIn, input.vars) : JSON.stringify(input.vars);
        const row = await tx.maybeOne<{ id: string }>(
          `insert into messages (organisation_id, clinic_id, patient_id, event, channel, recipient, locale, body, segments, scheduled_for, dedupe_key, data)
           values (app_org(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           on conflict (organisation_id, dedupe_key) do nothing returning id`,
          [input.clinicId ?? null, input.patientId ?? null, input.event, channel, recipient, locale, body,
            channel === 'sms' ? smsSegments(body).segments : 1, when, input.dedupeKey ? `${input.dedupeKey}:${channel}:${recipient}` : null, input.data ? JSON.stringify(input.data) : null],
        );
        if (row) ids.push(row.id);
      }
    }
    return ids;
  }

  /** Send one queued message (worker and OTP fast path). */
  async dispatch(orgId: string, messageId: string): Promise<'sent' | 'failed' | 'skipped'> {
    const m = await this.tenancy.system(orgId, (tx) =>
      tx.maybeOne<{ id: string; channel: 'sms' | 'whatsapp' | 'email' | 'push'; recipient: string; locale: 'ar' | 'en'; body: string; event: string; status: string; data: { path: string } | null }>(
        `update messages set status = 'sent', sent_at = now() where id = $1 and status = 'queued' returning id, channel, recipient, locale, body, event, status, data`,
        [messageId],
      ),
    );
    if (!m) return 'skipped';
    try {
      const provider = this.channels[m.channel];
      const tpl = await this.tenancy.system(orgId, (tx) =>
        tx.maybeOne<{ provider_template_id: string | null }>('select provider_template_id from message_templates where event = $1 and channel = $2 and locale = $3', [m.event, m.channel, m.locale]),
      );
      const r = await provider.send({ channel: m.channel, to: m.recipient, locale: m.locale, body: m.body, providerTemplateId: tpl?.provider_template_id ?? m.event, data: m.data ?? undefined });
      await this.tenancy.system(orgId, (tx) =>
        tx.query('update messages set provider_message_id = $2, segments = coalesce($3, segments), cost = $4 where id = $1', [m.id, r.providerMessageId, r.segments ?? null, r.cost ?? 0]),
      );
      return 'sent';
    } catch (e) {
      this.log.warn(`dispatch failed for message ${m.id}: ${(e as Error).message}`);
      // Retry policy (FR-COM-5): up to 3 attempts with exponential backoff, then failed.
      await this.tenancy.system(orgId, (tx) =>
        tx.query(
          `update messages set attempts = attempts + 1, error = $2,
             status = case when attempts + 1 >= 3 then 'failed' else 'queued' end,
             scheduled_for = now() + (interval '1 minute' * power(4, attempts)) where id = $1`,
          [m.id, (e as Error).message.slice(0, 200)],
        ),
      );
      return 'failed';
    }
  }
}
