import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import { DEFAULT_PRIVILEGES, PRIVILEGE_ACTIONS, PRIVILEGE_MODULES, ROLES, clinicSchema, type Privilege } from '@hf/shared';
import type { SecretBox } from '@hf/db';
import { Auth, Meta, Public, Staff } from '../common/decorators';
import { asStaff } from '../common/auth.guard';
import type { Principal, RequestMeta } from '../common/principal';
import { AuditService, BOX, Tenancy } from '../common/services';
import { TokenService } from '../common/tokens';
import { notFound } from '../common/errors';
import { parse, uuid } from '../common/zod';
import { assertPlanLimit } from './platform';

const settingsSchema = z.object({
  defaultLocale: z.enum(['ar', 'en']).optional(),
  digitStyle: z.enum(['western', 'arabic_indic']).optional(),
  hijri: z.boolean().optional(),
  booking: z
    .object({
      leadMinutes: z.number().int().min(0).max(10080),
      cancellationCutoffHours: z.number().int().min(0).max(168),
      maxReschedules: z.number().int().min(0).max(10),
      rescheduleFee: z.number().int().min(0),
      noShowFee: z.number().int().min(0),
      depositPercent: z.number().int().min(0).max(100),
      holdMinutes: z.number().int().min(5).max(30),
      noShowAfterMinutes: z.number().int().min(0).max(240),
      requireOnlinePayment: z.boolean(),
    })
    .partial()
    .optional(),
  reminders: z.object({ hoursBefore: z.array(z.number().int().min(1).max(168)).max(4) }).optional(),
  discountApprovalPercent: z.number().min(0).max(100).optional(),
  shiftVarianceThreshold: z.number().int().min(0).optional(),
  queueNotifyPositions: z.number().int().min(1).max(20).optional(),
  mrnFormat: z.string().regex(/\{n:\d\}/).optional(),
  messaging: z.object({ disabledEvents: z.array(z.string()) }).partial().optional(),
});

const legalEntitySchema = z.object({
  nameAr: z.string().min(2),
  nameEn: z.string().default(''),
  taxRegistrationNumber: z.string().regex(/^[\d-]{9,15}$/).optional(),
  commercialRegister: z.string().max(50).optional(),
  address: z.string().max(500).optional(),
});

const privilegeSet = new Set<string>(PRIVILEGE_MODULES.flatMap((m) => PRIVILEGE_ACTIONS.map((a) => `${m}:${a}`)));

@Controller('v1')
export class OrgController {
  constructor(
    private readonly tenancy: Tenancy,
    private readonly audit: AuditService,
    private readonly tokens: TokenService,
    @Inject(BOX) private readonly box: SecretBox,
  ) {}

  @Get('specialties')
  @Public()
  specialties(@Auth() p: Principal) {
    return this.tenancy.run(p, (tx) => tx.query('select id, slug, name_ar, name_en from specialties order by name_ar'));
  }

  @Get('governorates')
  @Public()
  async governorates() {
    const { GOVERNORATES } = await import('@hf/shared');
    return GOVERNORATES;
  }

  @Get('org')
  @Staff()
  org(@Auth() p: Principal) {
    return this.tenancy.run(p, (tx) => tx.one('select id, name_ar, name_en, slug, domain, settings, branding, privilege_overrides from organisations where id = app_org()'));
  }

  @Patch('org/settings')
  @Staff('settings:edit')
  async updateSettings(@Auth() p: Principal, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const s = parse(settingsSchema, body);
    return this.tenancy.run(p, async (tx) => {
      const cur = await tx.one<{ settings: Record<string, unknown> }>('select settings from organisations where id = app_org() for update');
      const merged = { ...cur.settings, ...s, booking: { ...(cur.settings.booking as object), ...s.booking } };
      await tx.query('update organisations set settings = $1 where id = app_org()', [JSON.stringify(merged)]);
      await this.audit.record(tx, p, meta, { action: 'settings.update', entity: 'organisation', details: { keys: Object.keys(s) } });
      return merged;
    });
  }

  @Get('org/privileges')
  @Staff('settings:view')
  async privileges(@Auth() p: Principal) {
    const o = await this.tenancy.run(p, (tx) => tx.one<{ privilege_overrides: Record<string, Privilege[]> }>('select privilege_overrides from organisations where id = app_org()'));
    return { defaults: DEFAULT_PRIVILEGES, overrides: o.privilege_overrides, modules: PRIVILEGE_MODULES, actions: PRIVILEGE_ACTIONS };
  }

  /** IAM-1: owner edits the privilege matrix per role; audited; reset by DELETE. */
  @Put('org/privileges/:role')
  @Staff('settings:edit')
  async setPrivileges(@Auth() p: Principal, @Param('role') role: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const s = asStaff(p);
    const r = parse(z.enum(ROLES).exclude(['owner', 'patient']), role);
    const { privileges } = parse(z.object({ privileges: z.array(z.string().refine((x) => privilegeSet.has(x), 'unknown_privilege')) }), body);
    return this.tenancy.run(s, async (tx) => {
      await tx.query(`update organisations set privilege_overrides = privilege_overrides || jsonb_build_object($1::text, $2::jsonb) where id = app_org()`, [r, JSON.stringify(privileges)]);
      await this.audit.record(tx, s, meta, { action: 'privileges.update', entity: 'role', entityId: r, details: { privileges } });
      return { role: r, privileges };
    });
  }

  @Delete('org/privileges/:role')
  @Staff('settings:edit')
  async resetPrivileges(@Auth() p: Principal, @Param('role') role: string, @Meta() meta: RequestMeta) {
    const r = parse(z.enum(ROLES), role);
    return this.tenancy.run(p, async (tx) => {
      await tx.query('update organisations set privilege_overrides = privilege_overrides - $1 where id = app_org()', [r]);
      await this.audit.record(tx, p, meta, { action: 'privileges.reset', entity: 'role', entityId: r });
      return { role: r, privileges: DEFAULT_PRIVILEGES[r] };
    });
  }

  // ---- Clinics (FR-ORG-1)
  @Get('clinics')
  @Staff('clinic:view')
  clinics(@Auth() p: Principal) {
    return this.tenancy.run(p, (tx) =>
      tx.query(`select c.*, coalesce((select array_agg(specialty_id) from clinic_specialties s where s.clinic_id = c.id), '{}') as specialty_ids from clinics c order by c.name_ar`),
    );
  }

  @Get('clinics/:id')
  @Staff('clinic:view')
  async clinic(@Auth() p: Principal, @Param('id') id: string) {
    const c = await this.tenancy.run(p, (tx) => tx.maybeOne('select * from clinics where id = $1', [uuid(id)]));
    if (!c) throw notFound('clinic');
    return c;
  }

  @Post('clinics')
  @Staff('clinic:create')
  createClinic(@Auth() p: Principal, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const s = asStaff(p);
    const c = parse(clinicSchema.extend({ specialtyIds: z.array(z.string().uuid()).default([]) }), body);
    return this.tenancy.run(s, async (tx) => {
      await assertPlanLimit(tx, 'clinics');
      const row = await tx.one<{ id: string }>(
        `insert into clinics (organisation_id, legal_entity_id, name_ar, name_en, slug, governorate, city, address_lines, lat, lng, phones, email, working_hours, colours, invoice_footer, is_public, created_by)
         values (app_org(), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) returning *`,
        [c.legalEntityId ?? null, c.name.ar, c.name.en, c.slug, c.governorate, c.city, c.addressLines, c.lat ?? null, c.lng ?? null, c.phones, c.email ?? null, JSON.stringify(c.workingHours), JSON.stringify(c.colours), c.invoiceFooter, c.isPublic, s.userId],
      );
      for (const sp of c.specialtyIds) await tx.query('insert into clinic_specialties (organisation_id, clinic_id, specialty_id) values (app_org(), $1, $2)', [row.id, sp]);
      await this.audit.record(tx, s, meta, { action: 'clinic.create', entity: 'clinic', entityId: row.id, clinicId: row.id });
      return row;
    });
  }

  @Patch('clinics/:id')
  @Staff('clinic:edit')
  updateClinic(@Auth() p: Principal, @Param('id') id: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const s = asStaff(p);
    const c = parse(clinicSchema.partial().extend({ specialtyIds: z.array(z.string().uuid()).optional(), isActive: z.boolean().optional() }), body);
    return this.tenancy.run(s, async (tx) => {
      const row = await tx.maybeOne(
        `update clinics set
           name_ar = coalesce($2, name_ar), name_en = coalesce($3, name_en), slug = coalesce($4, slug), governorate = coalesce($5, governorate),
           city = coalesce($6, city), address_lines = coalesce($7, address_lines), lat = coalesce($8, lat), lng = coalesce($9, lng),
           phones = coalesce($10, phones), email = coalesce($11, email), working_hours = coalesce($12, working_hours), colours = coalesce($13, colours),
           invoice_footer = coalesce($14, invoice_footer), is_public = coalesce($15, is_public), is_active = coalesce($16, is_active),
           legal_entity_id = coalesce($17, legal_entity_id), updated_by = $18
         where id = $1 returning *`,
        [uuid(id), c.name?.ar ?? null, c.name?.en ?? null, c.slug ?? null, c.governorate ?? null, c.city ?? null, c.addressLines ?? null, c.lat ?? null, c.lng ?? null, c.phones ?? null, c.email ?? null,
          c.workingHours ? JSON.stringify(c.workingHours) : null, c.colours ? JSON.stringify(c.colours) : null, c.invoiceFooter ?? null, c.isPublic ?? null, c.isActive ?? null, c.legalEntityId ?? null, s.userId],
      );
      if (!row) throw notFound('clinic');
      if (c.specialtyIds) {
        await tx.query('delete from clinic_specialties where clinic_id = $1', [id]);
        for (const sp of c.specialtyIds) await tx.query('insert into clinic_specialties (organisation_id, clinic_id, specialty_id) values (app_org(), $1, $2)', [id, sp]);
      }
      await this.audit.record(tx, s, meta, { action: 'clinic.update', entity: 'clinic', entityId: id, clinicId: id, details: { keys: Object.keys(c) } });
      return row;
    });
  }

  /** Long-lived token for the waiting-room screen of one clinic (FR-APT-6). */
  @Post('clinics/:id/display-token')
  @Staff('queue:edit')
  async displayToken(@Auth() p: Principal, @Param('id') id: string, @Meta() meta: RequestMeta) {
    const c = await this.tenancy.run(p, async (tx) => {
      const row = await tx.maybeOne<{ id: string }>('select id from clinics where id = $1', [uuid(id)]);
      if (row) await this.audit.record(tx, p, meta, { action: 'display.token_issued', entity: 'clinic', entityId: id, clinicId: id });
      return row;
    });
    if (!c) throw notFound('clinic');
    return { token: await this.tokens.signDisplay(p.orgId, id) };
  }

  // ---- Legal entities & HealthPay merchants (D3, FR-HP-1)
  @Get('legal-entities')
  @Staff('settings:view')
  legalEntities(@Auth() p: Principal) {
    return this.tenancy.run(p, (tx) =>
      tx.query(`select id, name_ar, name_en, tax_registration_number, commercial_register, address, healthpay_mode, healthpay_config_enc is not null as healthpay_configured, eta_mode, eta_config_enc is not null as eta_configured from legal_entities order by name_ar`),
    );
  }

  @Post('legal-entities')
  @Staff('settings:edit')
  createLegalEntity(@Auth() p: Principal, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const b = parse(legalEntitySchema, body);
    return this.tenancy.run(p, async (tx) => {
      const r = await tx.one<{ id: string }>(
        `insert into legal_entities (organisation_id, name_ar, name_en, tax_registration_number, commercial_register, address) values (app_org(), $1,$2,$3,$4,$5) returning id, name_ar, name_en, tax_registration_number, commercial_register, address`,
        [b.nameAr, b.nameEn, b.taxRegistrationNumber ?? null, b.commercialRegister ?? null, b.address ?? null],
      );
      await this.audit.record(tx, p, meta, { action: 'legal_entity.create', entity: 'legal_entity', entityId: r.id });
      return r;
    });
  }

  /** Merchant credentials are encrypted with AES-256-GCM and never returned (SEC-3). */
  @Put('legal-entities/:id/healthpay')
  @Staff('settings:edit')
  async setHealthPay(@Auth() p: Principal, @Param('id') id: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const b = parse(z.object({ merchantId: z.string().min(2).max(100), apiKey: z.string().min(8).max(500), mode: z.enum(['sandbox', 'live']) }), body);
    return this.tenancy.run(p, async (tx) => {
      const enc = this.box.encrypt(JSON.stringify({ merchantId: b.merchantId, apiKey: b.apiKey }), `healthpay:${id}`);
      const r = await tx.maybeOne('update legal_entities set healthpay_config_enc = $2, healthpay_mode = $3 where id = $1 returning id', [uuid(id), enc, b.mode]);
      if (!r) throw notFound('legal_entity');
      await this.audit.record(tx, p, meta, { action: 'healthpay.configure', entity: 'legal_entity', entityId: id, details: { mode: b.mode } });
      return { ok: true, mode: b.mode };
    });
  }
}
