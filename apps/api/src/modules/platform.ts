import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Patch, Post, Query } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { Tx } from '@hf/db';
import { addDays, localDate, zDate } from '@hf/shared';
import { ApiKey, Auth, Meta, Platform, Staff } from '../common/decorators';
import { asStaff } from '../common/auth.guard';
import type { ApiKeyPrincipal, PlatformPrincipal, Principal, RequestMeta } from '../common/principal';
import { AuditService, Tenancy } from '../common/services';
import { DomainError, badRequest, forbidden, notFound } from '../common/errors';
import { parse, uuid } from '../common/zod';
import { TokenService } from '../common/tokens';
import { CONFIG, type Config } from '../config';
import { HEALTHPAY, type HealthPayClient } from '../integrations/healthpay';
import { IDENTITY_ADMIN, type IdentityAdmin } from '../integrations/keycloak';
import { AvailabilityService } from './availability.service';
import { ReportsController } from './reports';

export const API_SCOPES = ['catalogue:read', 'availability:read', 'appointments:read', 'reports:read'] as const;

/** Enforce the subscription's plan limits when adding clinics or staff (BR-20). */
export async function assertPlanLimit(tx: Tx, what: 'clinics' | 'staff') {
  const sub = await tx.maybeOne<{ status: string; limits: Record<string, number> }>('select status, limits from org_subscription()');
  if (!sub) return;
  if (sub.status === 'cancelled') throw new DomainError('subscription_cancelled', HttpStatus.PAYMENT_REQUIRED);
  const limit = sub.limits[what];
  if (!limit) return;
  const n = what === 'clinics' ? (await tx.one<{ n: number }>('select count(*)::int as n from clinics where is_active')).n : (await tx.one<{ n: number }>(`select count(*)::int as n from users where status = 'active'`)).n;
  if (n >= limit) throw new DomainError('plan_limit_reached', HttpStatus.PAYMENT_REQUIRED, { what, limit });
}

/** SaaS super-admin console API (FR-ADM-1). Never runs under a tenant context; uses narrow platform functions. */
@Controller('v1/platform')
export class PlatformController {
  constructor(
    private readonly tenancy: Tenancy,
    private readonly audit: AuditService,
    private readonly tokens: TokenService,
    @Inject(IDENTITY_ADMIN) private readonly idp: IdentityAdmin,
    @Inject(HEALTHPAY) private readonly healthpay: HealthPayClient,
    @Inject(CONFIG) private readonly cfg: Config,
  ) {}

  private admin(p: Principal): PlatformPrincipal {
    if (p.kind !== 'platform') throw forbidden();
    return p;
  }

  /** Platform actions are audited into the affected organisation's own chain. */
  private async auditOrg(orgId: string, p: PlatformPrincipal, action: string, details: Record<string, unknown>) {
    await this.tenancy.system(orgId, (tx) => this.audit.record(tx, p, null, { action: `platform.${action}`, entity: 'organisation', entityId: orgId, details }));
  }

  @Get('me')
  @Platform()
  me(@Auth() p: Principal) {
    return this.admin(p);
  }

  @Get('organisations')
  @Platform()
  orgs() {
    return this.tenancy.db.raw('select * from platform_orgs()');
  }

  @Get('plans')
  @Platform()
  plans() {
    return this.tenancy.db.raw('select * from platform_plans()');
  }

  /** Onboard an external organisation: organisation, owner account (Keycloak invite), trial subscription. */
  @Post('organisations')
  @Platform()
  async createOrg(@Auth() p: Principal, @Body() body: unknown) {
    const a = this.admin(p);
    const b = parse(
      z.object({ slug: z.string().regex(/^[a-z0-9-]{3,40}$/), nameAr: z.string().min(2), nameEn: z.string().default(''), plan: z.enum(['starter', 'network', 'enterprise']), ownerEmail: z.string().email(), ownerName: z.string().min(2), trialDays: z.number().int().min(0).max(90).default(30) }),
      body,
    );
    const exists = await this.tenancy.db.raw('select 1 from resolve_org($1)', [b.slug]);
    if (exists.length) throw badRequest('slug_taken');
    const sub = await this.idp.createUser({ email: b.ownerEmail, firstName: b.ownerName, orgId: 'pending' });
    const r = (await this.tenancy.db.raw<{ organisation_id: string; owner_id: string }>('select * from platform_create_org($1,$2,$3,$4,$5,$6,$7,$8)', [b.slug, b.nameAr, b.nameEn, b.plan, b.ownerEmail, b.ownerName, sub, b.trialDays]))[0]!;
    await this.auditOrg(r.organisation_id, a, 'org_create', { plan: b.plan, by: a.email });
    return { organisationId: r.organisation_id, ownerId: r.owner_id };
  }

  @Patch('organisations/:id')
  @Platform()
  async updateOrg(@Auth() p: Principal, @Param('id') id: string, @Body() body: unknown) {
    const a = this.admin(p);
    const b = parse(z.object({ status: z.enum(['active', 'suspended']).optional(), plan: z.enum(['starter', 'network', 'enterprise']).optional(), subscriptionStatus: z.enum(['trial', 'active', 'past_due', 'cancelled']).optional(), periodEnd: zDate.optional() }), body);
    await this.tenancy.db.raw('select platform_set_org($1,$2,$3,$4,$5)', [uuid(id), b.status ?? null, b.plan ?? null, b.subscriptionStatus ?? null, b.periodEnd ?? null]);
    await this.auditOrg(id, a, 'org_update', { ...b, by: a.email });
    return { ok: true };
  }

  /** Monthly platform invoices (plan + SMS overage) with a HealthPay checkout link per organisation. */
  @Post('invoices/generate')
  @Platform()
  @HttpCode(200)
  async generate(@Auth() p: Principal, @Body() body: unknown) {
    const a = this.admin(p);
    const { month } = parse(z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }), body);
    const start = `${month}-01`;
    const end = addDays(new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1)).toISOString().slice(0, 10), -1);
    const orgs = await this.tenancy.db.raw<{ id: string }>('select id from platform_orgs()');
    const out = [];
    const merchant = this.cfg.PLATFORM_HEALTHPAY_API_KEY ? { apiKey: this.cfg.PLATFORM_HEALTHPAY_API_KEY, merchantId: this.cfg.PLATFORM_HEALTHPAY_MERCHANT_ID ?? '' } : null;
    for (const o of orgs) {
      const inv = (await this.tenancy.db.raw<{ id: string; amount: number; status: string; checkout_url: string | null }>('select * from platform_upsert_invoice($1,$2,$3)', [o.id, start, end]))[0];
      if (!inv) continue;
      if (inv.status === 'open' && !inv.checkout_url && inv.amount > 0) {
        const c = await this.healthpay.createCheckout({ merchant, orderId: inv.id, amount: inv.amount, description: `HealthFlow ${month}`, customerPhone: '', returnUrl: `${this.cfg.CONSOLE_URL}/admin/subscription`, idempotencyKey: `platform:${inv.id}` });
        await this.tenancy.db.raw('select platform_invoice_checkout($1,$2,$3)', [inv.id, c.providerOrderId, c.checkoutUrl]);
        inv.checkout_url = c.checkoutUrl;
      }
      out.push(inv);
      await this.auditOrg(o.id, a, 'invoice_generate', { month });
    }
    return out;
  }

  @Get('invoices')
  @Platform()
  invoices(@Query('organisationId') org?: string) {
    return this.tenancy.db.raw('select * from platform_invoices_for($1)', [org ? uuid(org) : null]);
  }

  @Post('announcements')
  @Platform()
  async announce(@Auth() p: Principal, @Body() body: unknown) {
    const a = this.admin(p);
    const b = parse(z.object({ titleAr: z.string().min(2), titleEn: z.string().default(''), bodyAr: z.string().min(2), bodyEn: z.string().default(''), severity: z.enum(['info', 'warning', 'maintenance']).default('info'), startsAt: z.string().datetime(), endsAt: z.string().datetime() }), body);
    const id = (await this.tenancy.db.raw<{ platform_announce: string }>('select platform_announce($1,$2,$3,$4,$5,$6,$7,$8)', [a.adminId, b.titleAr, b.titleEn, b.bodyAr, b.bodyEn, b.severity, b.startsAt, b.endsAt]))[0]!.platform_announce;
    return { id };
  }

  @Get('announcements')
  @Platform()
  announcements() {
    return this.tenancy.db.raw('select * from platform_announcements_list()');
  }

  @Post('announcements/:id/withdraw')
  @Platform()
  @HttpCode(200)
  async withdraw(@Auth() p: Principal, @Param('id') id: string) {
    this.admin(p);
    await this.tenancy.db.raw('select platform_announcement_withdraw($1)', [uuid(id)]);
    return { ok: true };
  }

  /** Support access needs the organisation owner's approval before any token is issued. */
  @Post('organisations/:id/support-access')
  @Platform()
  async requestSupport(@Auth() p: Principal, @Param('id') id: string, @Body() body: unknown) {
    const a = this.admin(p);
    const b = parse(z.object({ reason: z.string().min(10).max(500), hours: z.number().int().min(1).max(72) }), body);
    const accessId = (await this.tenancy.db.raw<{ platform_request_support: string }>('select platform_request_support($1,$2,$3,$4)', [uuid(id), a.adminId, b.reason, b.hours]))[0]!.platform_request_support;
    await this.tenancy.system(id, async (tx) => {
      await tx.query(`insert into tasks (organisation_id, kind, title, entity_id, assignee_role) values (app_org(), 'support_access', $1, $2, 'owner')`, [`HealthFlow support requests access for ${b.hours} h: ${b.reason}`.slice(0, 300), accessId]);
      await this.audit.record(tx, a, null, { action: 'platform.support_request', entity: 'support_access', entityId: accessId, reason: b.reason });
    });
    return { id: accessId, status: 'requested' };
  }

  @Get('support-access')
  @Platform()
  supportList(@Auth() p: Principal) {
    return this.tenancy.db.raw('select * from platform_support_list($1)', [this.admin(p).adminId]);
  }

  @Post('support-access/:id/token')
  @Platform()
  @HttpCode(200)
  async supportToken(@Auth() p: Principal, @Param('id') id: string) {
    const a = this.admin(p);
    const w = (await this.tenancy.db.raw<{ organisation_id: string; ends_at: Date }>('select * from support_identity($1, $2)', [uuid(id), a.adminId]))[0];
    if (!w) throw forbidden('support_window_not_active');
    return { token: await this.tokens.signSupport(a.adminId, id, w.organisation_id, new Date(w.ends_at)), organisationId: w.organisation_id, expiresAt: w.ends_at, readOnly: true };
  }
}

/** Organisation-side subscription, announcements, support approvals and API keys. */
@Controller('v1')
export class TenantPlatformController {
  constructor(private readonly tenancy: Tenancy, private readonly audit: AuditService, private readonly tokens: TokenService) {}

  @Get('subscription')
  @Staff()
  async subscription(@Auth() p: Principal) {
    return this.tenancy.run(p, async (tx) => {
      const sub = await tx.maybeOne('select * from org_subscription()');
      const usage = await tx.one(
        `select (select count(*)::int from clinics where is_active) as clinics, (select count(*)::int from users where status = 'active') as staff,
                (select coalesce(sum(segments), 0)::int from messages where channel = 'sms' and created_at >= date_trunc('month', now())) as sms_this_month,
                (select coalesce(sum(size_bytes), 0)::bigint from documents) as storage_bytes`,
      );
      return { subscription: sub, usage };
    });
  }

  @Get('subscription/invoices')
  @Staff('settings:view')
  invoices(@Auth() p: Principal) {
    return this.tenancy.db.raw('select id, period_start, period_end, plan_code, amount, usage, status, checkout_url, paid_at from platform_invoices_for($1)', [p.orgId]);
  }

  @Get('announcements')
  @Staff()
  announcements(@Auth() p: Principal) {
    return this.tenancy.run(p, (tx) => tx.query(`select id, title_ar, title_en, body_ar, body_en, severity, starts_at, ends_at from platform_announcements where now() between starts_at and ends_at order by starts_at desc`));
  }

  @Get('support-access')
  @Staff('settings:view')
  support(@Auth() p: Principal) {
    return this.tenancy.run(p, (tx) => tx.query('select id, reason, hours, status, starts_at, ends_at, decided_at, created_at from support_access order by created_at desc'));
  }

  /** Only the organisation owner can grant support access; the window starts on approval. */
  @Post('support-access/:id/decision')
  @Staff('settings:edit')
  @HttpCode(200)
  decide(@Auth() p: Principal, @Param('id') id: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const s = asStaff(p);
    if (!s.roles.includes('owner')) throw forbidden('owner_only');
    const { approve } = parse(z.object({ approve: z.boolean() }), body);
    return this.tenancy.run(s, async (tx) => {
      const r = await tx.maybeOne(
        `update support_access set status = $2, decided_by = $3, decided_at = now(),
           starts_at = case when $2 = 'approved' then now() end, ends_at = case when $2 = 'approved' then now() + make_interval(hours => hours) end
         where id = $1 and status = 'requested' returning id, status, ends_at`,
        [uuid(id), approve ? 'approved' : 'rejected', s.userId],
      );
      if (!r) throw notFound('support_access');
      await this.audit.record(tx, s, meta, { action: `support.${approve ? 'approve' : 'reject'}`, entity: 'support_access', entityId: id });
      return r;
    });
  }

  @Post('support-access/:id/revoke')
  @Staff('settings:edit')
  @HttpCode(200)
  revoke(@Auth() p: Principal, @Param('id') id: string, @Meta() meta: RequestMeta) {
    const s = asStaff(p);
    return this.tenancy.run(s, async (tx) => {
      const r = await tx.maybeOne(`update support_access set status = 'revoked', ends_at = now() where id = $1 and status = 'approved' returning id`, [uuid(id)]);
      if (!r) throw notFound('support_access');
      await this.audit.record(tx, s, meta, { action: 'support.revoke', entity: 'support_access', entityId: id });
      return { ok: true };
    });
  }

  // ---- API keys (FR-INT-3)
  @Get('api-keys')
  @Staff('integration:view')
  keys(@Auth() p: Principal) {
    return this.tenancy.run(p, (tx) => tx.query('select id, name, prefix, scopes, expires_at, last_used_at, revoked_at, created_at from api_keys order by created_at desc'));
  }

  /** The full key is returned once; only its SHA-256 is stored. */
  @Post('api-keys')
  @Staff('integration:create')
  createKey(@Auth() p: Principal, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const s = asStaff(p);
    const b = parse(z.object({ name: z.string().min(2).max(80), scopes: z.array(z.enum(API_SCOPES)).min(1), expiresInDays: z.number().int().min(1).max(730).optional() }), body);
    const key = `hfk_live_${randomBytes(30).toString('base64url')}`;
    return this.tenancy.run(s, async (tx) => {
      const r = await tx.one<{ id: string }>(
        `insert into api_keys (organisation_id, name, prefix, key_hash, scopes, expires_at, created_by) values (app_org(), $1,$2,$3,$4, case when $5::int is null then null else now() + make_interval(days => $5::int) end, $6) returning id`,
        [b.name, key.slice(0, 14), createHash('sha256').update(key).digest('hex'), b.scopes, b.expiresInDays ?? null, s.userId],
      );
      await this.audit.record(tx, s, meta, { action: 'integration.api_key_create', entity: 'api_key', entityId: r.id, details: { scopes: b.scopes } });
      return { id: r.id, key, scopes: b.scopes };
    });
  }

  @Post('api-keys/:id/revoke')
  @Staff('integration:delete')
  @HttpCode(200)
  revokeKey(@Auth() p: Principal, @Param('id') id: string, @Meta() meta: RequestMeta) {
    return this.tenancy.run(p, async (tx) => {
      const r = await tx.maybeOne('update api_keys set revoked_at = now() where id = $1 and revoked_at is null returning id', [uuid(id)]);
      if (!r) throw notFound('api_key');
      await this.audit.record(tx, p, meta, { action: 'integration.api_key_revoke', entity: 'api_key', entityId: id });
      return { ok: true };
    });
  }
}

/** Public REST API for integrators (FR-INT-3): read-only, organisation-scoped, no patient names or contact details. */
@Controller('v1/ext')
export class ExternalApiController {
  constructor(private readonly tenancy: Tenancy, private readonly availability: AvailabilityService, private readonly reports: ReportsController) {}

  private run<T>(p: Principal, fn: (tx: Tx) => Promise<T>) {
    return this.tenancy.run(p as ApiKeyPrincipal, fn);
  }

  @Get('clinics')
  @ApiKey('catalogue:read')
  clinics(@Auth() p: Principal) {
    return this.run(p, (tx) => tx.query('select id, slug, name_ar, name_en, governorate, city, address_lines, lat, lng, phones, working_hours from clinics where is_active order by name_ar'));
  }

  @Get('doctors')
  @ApiKey('catalogue:read')
  doctors(@Auth() p: Principal) {
    return this.run(p, (tx) =>
      tx.query(
        `select u.id, d.slug, u.name_ar, u.name_en, d.title, d.rating_avg, d.rating_count,
                coalesce((select array_agg(s.slug) from doctor_specialties ds join specialties s on s.id = ds.specialty_id where ds.doctor_id = u.id), '{}') as specialties
         from users u join doctor_profiles d on d.user_id = u.id where d.is_public and u.status = 'active' order by u.name_ar`,
      ),
    );
  }

  @Get('services')
  @ApiKey('catalogue:read')
  services(@Auth() p: Principal) {
    return this.run(p, (tx) =>
      tx.query(`select s.id, s.code, s.name_ar, s.name_en, s.type, s.duration_minutes, s.vat, pl.clinic_id, pl.price from services s join price_list_items pl on pl.service_id = s.id and pl.doctor_id is null
                where s.is_active and pl.effective_from <= current_date and (pl.effective_to is null or pl.effective_to >= current_date) order by s.code`),
    );
  }

  @Get('availability')
  @ApiKey('availability:read')
  slots(@Auth() p: Principal, @Query() q: Record<string, string>) {
    const b = parse(z.object({ doctorId: z.string().uuid(), clinicId: z.string().uuid().optional(), from: zDate.optional(), days: z.coerce.number().int().min(1).max(14).default(7) }), q);
    return this.run(p, async (tx) => (await this.availability.slots(tx, { doctorIds: [b.doctorId], clinicId: b.clinicId, from: b.from ?? localDate(new Date()), days: b.days, channel: 'online', leadMinutes: 60 }))
      .filter((s) => s.available > 0).map((s) => ({ start: s.start, end: s.end, clinicId: s.clinicId })));
  }

  /** Appointments without patient identity beyond the MRN (FR-INT-3, PDPL minimisation). */
  @Get('appointments')
  @ApiKey('appointments:read')
  appointments(@Auth() p: Principal, @Query() q: Record<string, string>) {
    const b = parse(z.object({ from: z.string().datetime(), to: z.string().datetime(), clinicId: z.string().uuid().optional() }), q);
    if (Date.parse(b.to) - Date.parse(b.from) > 31 * 86400_000) throw badRequest('range_too_large');
    return this.run(p, (tx) =>
      tx.query(
        `select a.id, a.ref, a.clinic_id, a.doctor_id, a.start_at, a.end_at, a.status, a.channel, p.mrn as patient_mrn
         from appointments a join patients p on p.id = a.patient_id where a.start_at >= $1 and a.start_at < $2 and ($3::uuid is null or a.clinic_id = $3) order by a.start_at limit 5000`,
        [b.from, b.to, b.clinicId ?? null],
      ),
    );
  }

  @Get('reports/dashboard')
  @ApiKey('reports:read')
  dashboard(@Auth() p: Principal, @Query() q: Record<string, string>) {
    const b = parse(z.object({ from: zDate, to: zDate, clinicId: z.string().uuid().optional() }), q);
    return this.run(p, (tx) => this.reports.compute(tx, b));
  }
}

