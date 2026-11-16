import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { CHANNELS as CHANNEL_LIST, MESSAGE_EVENTS, smsSegments, templateVariables } from '@hf/shared';
import { Auth, Meta, Staff, Webhook } from '../common/decorators';
import { forbidden, notFound } from '../common/errors';
import type { Principal, RequestMeta } from '../common/principal';
import { AuditService, Tenancy } from '../common/services';
import { parse, uuid } from '../common/zod';
import { CONFIG, type Config } from '../config';
import { verifyCequensSignature } from '../integrations/messaging';

@Controller('v1')
export class CommsController {
  constructor(private readonly tenancy: Tenancy, private readonly audit: AuditService, @Inject(CONFIG) private readonly cfg: Config) {}

  @Get('message-templates')
  @Staff('message:view')
  async templates(@Auth() p: Principal) {
    const rows = await this.tenancy.run(p, (tx) => tx.query<{ body: string }>('select * from message_templates order by event, channel, locale'));
    // FR-COM-2 preview: segment count and variables.
    return rows.map((r) => ({ ...r, preview: { ...smsSegments(r.body), variables: templateVariables(r.body) } }));
  }

  @Patch('message-templates/:id')
  @Staff('settings:edit')
  updateTemplate(@Auth() p: Principal, @Param('id') id: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const b = parse(z.object({ body: z.string().min(1).max(1000).optional(), isEnabled: z.boolean().optional(), providerTemplateId: z.string().max(100).nullable().optional() }), body);
    return this.tenancy.run(p, async (tx) => {
      const cur = await tx.maybeOne<{ body: string }>('select body from message_templates where id = $1', [uuid(id)]);
      if (!cur) throw notFound('template');
      // Variables are typed: a new body may not introduce variables the event does not provide.
      if (b.body) {
        const allowed = new Set(templateVariables(cur.body));
        const extra = templateVariables(b.body).filter((v) => !allowed.has(v));
        if (extra.length) throw forbidden(`unknown_variables:${extra.join(',')}`);
      }
      const r = await tx.one(
        `update message_templates set body = coalesce($2, body), is_enabled = coalesce($3, is_enabled), provider_template_id = case when $4::boolean then $5 else provider_template_id end where id = $1 returning *`,
        [id, b.body ?? null, b.isEnabled ?? null, b.providerTemplateId !== undefined, b.providerTemplateId ?? null],
      );
      await this.audit.record(tx, p, meta, { action: 'settings.message_template', entity: 'message_template', entityId: id });
      return r;
    });
  }

  @Get('messages/costs')
  @Staff('message:view')
  costs(@Auth() p: Principal, @Query('from') from: string, @Query('to') to: string) {
    return this.tenancy.run(p, (tx) =>
      tx.query(
        `select clinic_id, channel, count(*)::int as messages, coalesce(sum(segments), 0)::int as segments, coalesce(sum(cost), 0)::int as cost,
                count(*) filter (where status = 'delivered')::int as delivered, count(*) filter (where status = 'failed')::int as failed
         from messages where created_at >= $1::date and created_at < $2::date + 1 group by clinic_id, channel order by clinic_id, channel`,
        [from, to],
      ),
    );
  }

  @Get('messages/events')
  @Staff('message:view')
  events() {
    return { events: MESSAGE_EVENTS, channels: CHANNEL_LIST };
  }

  /** Cequens delivery receipts (FR-COM-5). */
  @Post('webhooks/cequens')
  @Webhook()
  @HttpCode(200)
  async dlr(@Req() req: Request & { rawBody?: Buffer }) {
    const raw = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
    if (!verifyCequensSignature(this.cfg.CEQUENS_WEBHOOK_SECRET, req.headers['x-cequens-signature'] as string | undefined, raw)) throw forbidden('invalid_signature');
    const evt = parse(z.object({ messageId: z.string().max(200), status: z.string().max(50), errorCode: z.string().optional() }), JSON.parse(raw.toString()));
    const m = (await this.tenancy.db.raw<{ organisation_id: string; id: string }>('select * from message_org($1)', [evt.messageId]))[0];
    if (!m) return { ignored: true };
    const status = /deliver/i.test(evt.status) ? 'delivered' : /fail|reject|undeliv|expired/i.test(evt.status) ? 'failed' : 'sent';
    await this.tenancy.system(m.organisation_id, async (tx) => {
      await tx.query('insert into message_events (organisation_id, message_id, status, payload) values (app_org(), $1, $2, $3)', [m.id, evt.status, JSON.stringify(evt)]);
      await tx.query(`update messages set status = $2, error = coalesce($3, error) where id = $1 and status <> 'delivered'`, [m.id, status, evt.errorCode ?? null]);
    });
    return { ok: true };
  }
}
