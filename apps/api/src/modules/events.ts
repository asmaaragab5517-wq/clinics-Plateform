import { Body, Controller, Delete, Get, HttpCode, Inject, Injectable, Logger, Param, Patch, Post, Query } from '@nestjs/common';
import { createHmac, randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { SecretBox, Tx } from '@hf/db';
import { Auth, Meta, PatientAuth, Staff } from '../common/decorators';
import { asPatient, asStaff } from '../common/auth.guard';
import type { Principal, RequestMeta } from '../common/principal';
import { AuditService, BOX, Tenancy } from '../common/services';
import { badRequest, notFound } from '../common/errors';
import { parse, uuid } from '../common/zod';
import { assertPublicHttpsUrl } from '../integrations/egress';

export const OUTBOUND_EVENTS = ['complaint.created', 'complaint.resolved', 'rating.low', 'incident.reported', 'incident.closed', 'ping'] as const;
export type OutboundEvent = (typeof OUTBOUND_EVENTS)[number];
const MAX_ATTEMPTS = 10;

/** Remove phone numbers, national IDs and e-mail addresses from free text before it leaves the platform. */
export function redact(text: string): string {
  return text.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]').replace(/[+٠-٩\d][\d٠-٩\s-]{6,}\d/g, '[number]');
}

export function signBody(secret: string, body: string, t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
}

/**
 * Pseudonymised outbound event bus (FR-INT-1). Payloads never contain names, phones or IDs; a patient reference is a
 * per-organisation keyed pseudonym and is included only with the patient's ITQAN data-sharing consent.
 */
@Injectable()
export class EventsService {
  private readonly log = new Logger('Events');
  constructor(@Inject(BOX) private readonly box: SecretBox) {}

  async pseudonym(tx: Tx, patientId: string | null): Promise<string | null> {
    if (!patientId) return null;
    const c = await tx.maybeOne<{ granted: boolean }>(`select granted from consents where patient_id = $1 and type = 'itqan_sharing' order by created_at desc limit 1`, [patientId]);
    return c?.granted ? `p_${this.box.blindIndex(`itqan:${patientId}`, tx.ctx.orgId).slice(0, 32)}` : null;
  }

  async emit(tx: Tx, event: OutboundEvent, data: Record<string, unknown>) {
    const endpoints = await tx.query<{ id: string }>('select id from webhook_endpoints where is_active and $1 = any(events)', [event]);
    for (const e of endpoints) {
      await tx.query(`insert into outbound_events (organisation_id, endpoint_id, event, payload) values (app_org(), $1, $2, $3)`, [
        e.id, event, JSON.stringify({ id: randomBytes(12).toString('hex'), event, occurredAt: new Date().toISOString(), organisation: tx.ctx.orgId, data }),
      ]);
    }
    return endpoints.length;
  }

  /** Deliver due events with retry/backoff (worker). The URL is re-validated at send time (DNS rebinding). */
  async deliverDue(tx: Tx, fetchImpl: typeof fetch = fetch) {
    const due = await tx.query<{ id: string; payload: unknown; attempts: number; url: string; secret_enc: Buffer; endpoint_id: string }>(
      `select o.id, o.payload, o.attempts, w.url, w.secret_enc, w.id as endpoint_id from outbound_events o join webhook_endpoints w on w.id = o.endpoint_id
       where o.status = 'queued' and o.next_attempt_at <= now() and w.is_active order by o.created_at limit 100 for update of o skip locked`,
    );
    let delivered = 0;
    for (const d of due) {
      let status = 0;
      try {
        await assertPublicHttpsUrl(d.url);
        const body = JSON.stringify(d.payload);
        const res = await fetchImpl(d.url, {
          method: 'POST',
          redirect: 'manual',
          headers: { 'content-type': 'application/json', 'x-healthflow-signature': signBody(this.box.decrypt(d.secret_enc, `webhook:${d.endpoint_id}`), body), 'user-agent': 'HealthFlow-Webhooks/1' },
          body,
          signal: AbortSignal.timeout(10000),
        });
        status = res.status;
      } catch (e) {
        this.log.warn(`delivery ${d.id} failed: ${(e as Error).message}`);
      }
      const ok = status >= 200 && status < 300;
      if (ok) delivered++;
      await tx.query(
        `update outbound_events set attempts = attempts + 1, last_status = $2, status = $3, delivered_at = case when $3 = 'delivered' then now() else null end,
           next_attempt_at = now() + (interval '30 seconds' * power(2, attempts)) where id = $1`,
        [d.id, status || null, ok ? 'delivered' : d.attempts + 1 >= MAX_ATTEMPTS ? 'failed' : 'queued'],
      );
    }
    return delivered;
  }
}

const complaintSchema = z.object({
  clinicId: z.string().uuid(),
  patientId: z.string().uuid().optional(),
  channel: z.enum(['reception', 'phone', 'portal', 'app', 'email', 'review']).default('reception'),
  category: z.enum(['waiting_time', 'staff_behaviour', 'clinical_care', 'billing', 'facility', 'communication', 'other']),
  description: z.string().min(5).max(5000),
});

@Controller('v1')
export class EventsController {
  constructor(private readonly tenancy: Tenancy, private readonly audit: AuditService, private readonly events: EventsService, @Inject(BOX) private readonly box: SecretBox) {}

  // ---- Complaints (patient voice)
  @Get('complaints')
  @Staff('quality:view')
  complaints(@Auth() p: Principal, @Query('status') status?: string) {
    return this.tenancy.run(p, (tx) => tx.query(`select c.*, cl.name_ar as clinic_name from complaints c left join clinics cl on cl.id = c.clinic_id where ($1::text is null or c.status = $1) order by c.created_at desc limit 300`, [status ?? null]));
  }

  @Post('complaints')
  @Staff('quality:create')
  createComplaint(@Auth() p: Principal, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const s = asStaff(p);
    const b = parse(complaintSchema, body);
    return this.tenancy.run(s, (tx) => this.recordComplaint(tx, s, meta, b));
  }

  @Post('portal/complaints')
  @PatientAuth()
  patientComplaint(@Auth() p: Principal, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const pt = asPatient(p);
    const b = parse(complaintSchema.extend({ patientId: z.string().uuid(), channel: z.enum(['portal', 'app']).default('portal') }), body);
    if (!pt.patientIds.includes(b.patientId)) throw notFound('patient');
    return this.tenancy.system(pt.orgId, (tx) => this.recordComplaint(tx, pt, meta, b));
  }

  @Get('portal/complaints')
  @PatientAuth()
  myComplaints(@Auth() p: Principal) {
    return this.tenancy.run(p, (tx) => tx.query(
        `select c.id, c.clinic_id, cl.name_ar as clinic_name_ar, cl.name_en as clinic_name_en, c.patient_id, c.category, c.description,
                c.status, c.resolution, c.created_at, c.resolved_at
           from complaints c left join clinics cl on cl.id = c.clinic_id order by c.created_at desc limit 100`,
      ));
  }

  private async recordComplaint(tx: Tx, actor: Principal, meta: RequestMeta, b: z.infer<typeof complaintSchema>) {
    const clinic = await tx.maybeOne('select 1 from clinics where id = $1', [b.clinicId]);
    if (!clinic) throw notFound('clinic');
    const r = await tx.one<{ id: string; created_at: Date }>(
      `insert into complaints (organisation_id, clinic_id, patient_id, channel, category, description, created_by) values (app_org(), $1,$2,$3,$4,$5,$6) returning id, created_at`,
      [b.clinicId, b.patientId ?? null, b.channel, b.category, b.description, actor.kind === 'staff' ? actor.userId : null],
    );
    await tx.query(`insert into tasks (organisation_id, clinic_id, kind, title, entity_id, assignee_role) values (app_org(), $1, 'complaint', $2, $3, 'clinic_manager')`, [b.clinicId, `Complaint: ${b.category}`, r.id]);
    await this.events.emit(tx, 'complaint.created', { complaintId: r.id, clinicId: b.clinicId, category: b.category, channel: b.channel, description: redact(b.description), patientRef: await this.events.pseudonym(tx, b.patientId ?? null) });
    await this.audit.record(tx, actor, meta, { action: 'quality.complaint_create', entity: 'complaint', entityId: r.id, patientId: b.patientId ?? null, clinicId: b.clinicId });
    return r;
  }

  @Patch('complaints/:id')
  @Staff('quality:edit')
  updateComplaint(@Auth() p: Principal, @Param('id') id: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const b = parse(z.object({ status: z.enum(['in_progress', 'resolved', 'closed']), resolution: z.string().max(5000).optional() }), body);
    return this.tenancy.run(p, async (tx) => {
      const r = await tx.maybeOne<{ id: string; clinic_id: string; category: string; created_at: Date }>(
        `update complaints set status = $2, resolution = coalesce($3, resolution), resolved_at = case when $2 in ('resolved','closed') then coalesce(resolved_at, now()) else resolved_at end where id = $1 returning id, clinic_id, category, created_at`,
        [uuid(id), b.status, b.resolution ?? null],
      );
      if (!r) throw notFound('complaint');
      if (b.status === 'resolved') {
        await this.events.emit(tx, 'complaint.resolved', { complaintId: r.id, clinicId: r.clinic_id, category: r.category, resolutionHours: Math.round((Date.now() - new Date(r.created_at).getTime()) / 3600_000) });
      }
      await this.audit.record(tx, p, meta, { action: 'quality.complaint_update', entity: 'complaint', entityId: id, details: { status: b.status } });
      return { ok: true };
    });
  }

  // ---- Incidents (patient safety)
  @Get('incidents')
  @Staff('quality:view')
  incidents(@Auth() p: Principal) {
    return this.tenancy.run(p, (tx) => tx.query(`select i.*, cl.name_ar as clinic_name from incidents i join clinics cl on cl.id = i.clinic_id order by i.occurred_at desc limit 300`));
  }

  @Post('incidents')
  @Staff('quality:create')
  createIncident(@Auth() p: Principal, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const s = asStaff(p);
    const b = parse(
      z.object({
        clinicId: z.string().uuid(), patientId: z.string().uuid().optional(),
        category: z.enum(['medication_error', 'fall', 'misidentification', 'infection_control', 'equipment', 'privacy', 'other']),
        severity: z.enum(['near_miss', 'no_harm', 'minor', 'moderate', 'severe', 'death']), description: z.string().min(5).max(5000), occurredAt: z.string().datetime(), actionsTaken: z.string().max(5000).optional(),
      }),
      body,
    );
    return this.tenancy.run(s, async (tx) => {
      const r = await tx.one<{ id: string }>(
        `insert into incidents (organisation_id, clinic_id, patient_id, category, severity, description, occurred_at, actions_taken, created_by) values (app_org(), $1,$2,$3,$4,$5,$6,$7,$8) returning id`,
        [b.clinicId, b.patientId ?? null, b.category, b.severity, b.description, b.occurredAt, b.actionsTaken ?? null, s.userId],
      );
      if (['moderate', 'severe', 'death'].includes(b.severity)) {
        await tx.query(`insert into tasks (organisation_id, clinic_id, kind, title, entity_id, assignee_role) values (app_org(), $1, 'incident', $2, $3, 'clinic_manager')`, [b.clinicId, `Incident (${b.severity}): ${b.category}`, r.id]);
      }
      await this.events.emit(tx, 'incident.reported', { incidentId: r.id, clinicId: b.clinicId, category: b.category, severity: b.severity, occurredAt: b.occurredAt, description: redact(b.description), patientRef: await this.events.pseudonym(tx, b.patientId ?? null) });
      await this.audit.record(tx, s, meta, { action: 'quality.incident_report', entity: 'incident', entityId: r.id, patientId: b.patientId ?? null, clinicId: b.clinicId });
      return r;
    });
  }

  @Patch('incidents/:id')
  @Staff('quality:edit')
  updateIncident(@Auth() p: Principal, @Param('id') id: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const b = parse(z.object({ status: z.enum(['investigating', 'closed']), actionsTaken: z.string().max(5000).optional() }), body);
    return this.tenancy.run(p, async (tx) => {
      const r = await tx.maybeOne<{ id: string; clinic_id: string; category: string; severity: string }>(`update incidents set status = $2, actions_taken = coalesce($3, actions_taken) where id = $1 returning id, clinic_id, category, severity`, [uuid(id), b.status, b.actionsTaken ?? null]);
      if (!r) throw notFound('incident');
      if (b.status === 'closed') await this.events.emit(tx, 'incident.closed', { incidentId: r.id, clinicId: r.clinic_id, category: r.category, severity: r.severity });
      await this.audit.record(tx, p, meta, { action: 'quality.incident_update', entity: 'incident', entityId: id, details: { status: b.status } });
      return { ok: true };
    });
  }

  // ---- Webhook endpoints (ITQAN and others)
  @Get('webhooks')
  @Staff('integration:view')
  endpoints(@Auth() p: Principal) {
    return this.tenancy.run(p, (tx) =>
      tx.query(`select w.id, w.name, w.url, w.events, w.is_active, w.created_at,
                  (select count(*)::int from outbound_events o where o.endpoint_id = w.id and o.status = 'queued') as queued,
                  (select count(*)::int from outbound_events o where o.endpoint_id = w.id and o.status = 'failed') as failed
                from webhook_endpoints w order by w.created_at`),
    );
  }

  /** Register an endpoint; the signing secret is returned once and stored encrypted. */
  @Post('webhooks')
  @Staff('integration:create')
  async createEndpoint(@Auth() p: Principal, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const b = parse(z.object({ name: z.string().min(2).max(80), url: z.string().url().max(500), events: z.array(z.enum(OUTBOUND_EVENTS)).min(1) }), body);
    try {
      await assertPublicHttpsUrl(b.url);
    } catch (e) {
      throw badRequest((e as Error).message);
    }
    const secret = `whsec_${randomBytes(24).toString('base64url')}`;
    return this.tenancy.run(p, async (tx) => {
      const r = await tx.one<{ id: string }>(`insert into webhook_endpoints (organisation_id, name, url, secret_enc, events) values (app_org(), $1, $2, '\\x00', $3) returning id`, [b.name, b.url, b.events]);
      await tx.query('update webhook_endpoints set secret_enc = $2 where id = $1', [r.id, this.box.encrypt(secret, `webhook:${r.id}`)]);
      await this.audit.record(tx, p, meta, { action: 'integration.webhook_create', entity: 'webhook_endpoint', entityId: r.id, details: { url: b.url, events: b.events } });
      return { id: r.id, secret };
    });
  }

  @Patch('webhooks/:id')
  @Staff('integration:edit')
  updateEndpoint(@Auth() p: Principal, @Param('id') id: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const b = parse(z.object({ isActive: z.boolean().optional(), events: z.array(z.enum(OUTBOUND_EVENTS)).min(1).optional() }), body);
    return this.tenancy.run(p, async (tx) => {
      const r = await tx.maybeOne('update webhook_endpoints set is_active = coalesce($2, is_active), events = coalesce($3, events) where id = $1 returning id', [uuid(id), b.isActive ?? null, b.events ?? null]);
      if (!r) throw notFound('webhook');
      await this.audit.record(tx, p, meta, { action: 'integration.webhook_update', entity: 'webhook_endpoint', entityId: id, details: b });
      return { ok: true };
    });
  }

  @Delete('webhooks/:id')
  @Staff('integration:delete')
  deleteEndpoint(@Auth() p: Principal, @Param('id') id: string, @Meta() meta: RequestMeta) {
    return this.tenancy.run(p, async (tx) => {
      const r = await tx.maybeOne('delete from webhook_endpoints where id = $1 returning id', [uuid(id)]);
      if (!r) throw notFound('webhook');
      await this.audit.record(tx, p, meta, { action: 'integration.webhook_delete', entity: 'webhook_endpoint', entityId: id });
      return { ok: true };
    });
  }

  @Post('webhooks/:id/ping')
  @Staff('integration:edit')
  @HttpCode(200)
  ping(@Auth() p: Principal, @Param('id') id: string) {
    return this.tenancy.run(p, async (tx) => {
      const w = await tx.maybeOne<{ id: string }>('select id from webhook_endpoints where id = $1', [uuid(id)]);
      if (!w) throw notFound('webhook');
      await tx.query(`insert into outbound_events (organisation_id, endpoint_id, event, payload) values (app_org(), $1, 'ping', $2)`, [id, JSON.stringify({ event: 'ping', occurredAt: new Date().toISOString() })]);
      return { queued: true };
    });
  }

  @Get('webhooks/:id/deliveries')
  @Staff('integration:view')
  deliveries(@Auth() p: Principal, @Param('id') id: string) {
    return this.tenancy.run(p, async (tx) => {
      if (!(await tx.maybeOne('select 1 from webhook_endpoints where id = $1', [uuid(id)]))) throw notFound('webhook');
      return tx.query('select id, event, status, attempts, last_status, delivered_at, created_at from outbound_events where endpoint_id = $1 order by created_at desc limit 200', [id]);
    });
  }
}
