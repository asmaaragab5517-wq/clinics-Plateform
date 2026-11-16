import { Body, Controller, Get, Inject, Param, Patch, Post, Put, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import { ROLES, computeCommission, doctorProfileSchema, inviteStaffSchema, type CommissionRule } from '@hf/shared';
import type { SecretBox } from '@hf/db';
import { Auth, Meta, Staff } from '../common/decorators';
import { asStaff } from '../common/auth.guard';
import type { Principal, RequestMeta } from '../common/principal';
import { AuditService, BOX, Tenancy } from '../common/services';
import { badRequest, forbidden, notFound } from '../common/errors';
import { parse, uuid } from '../common/zod';
import { IDENTITY_ADMIN, type IdentityAdmin } from '../integrations/keycloak';
import { STORAGE, sniffMime, type Storage } from '../integrations/storage';
import { MessagingService } from './messaging.service';
import { CONFIG, type Config } from '../config';

const commissionRuleSchema: z.ZodType<CommissionRule> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('percent'), percent: z.number().min(0).max(100) }),
  z.object({ kind: z.literal('fixed'), amount: z.number().int().min(0) }),
  z.object({ kind: z.literal('tiered'), tiers: z.array(z.object({ upTo: z.number().int().positive().nullable(), percent: z.number().min(0).max(100) })).min(1) }),
]);

@Controller('v1')
export class StaffController {
  constructor(
    private readonly tenancy: Tenancy,
    private readonly audit: AuditService,
    private readonly messaging: MessagingService,
    @Inject(IDENTITY_ADMIN) private readonly idp: IdentityAdmin,
    @Inject(STORAGE) private readonly storage: Storage,
    @Inject(BOX) private readonly box: SecretBox,
    @Inject(CONFIG) private readonly cfg: Config,
  ) {}

  @Get('staff')
  @Staff('staff:view')
  list(@Auth() p: Principal) {
    return this.tenancy.run(p, (tx) =>
      tx.query(`select u.id, u.name_ar, u.name_en, u.email, u.phone, u.status, u.mfa_enrolled, u.last_login_at,
                  coalesce(jsonb_agg(jsonb_build_object('role', m.role, 'clinicId', m.clinic_id)) filter (where m.id is not null), '[]') as memberships
                from users u left join staff_memberships m on m.user_id = u.id group by u.id order by u.name_ar`),
    );
  }

  @Post('staff/invite')
  @Staff('staff:create')
  async invite(@Auth() p: Principal, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const s = asStaff(p);
    const b = parse(inviteStaffSchema, body);
    if (!b.email && !b.phone) throw badRequest('email_or_phone_required');
    // Only the owner may grant owner/network roles.
    if (b.roles.some((r) => r === 'owner' || r === 'network_director') && !s.roles.includes('owner')) throw forbidden('owner_only_role');
    const sub = await this.idp.createUser({ email: b.email, phone: b.phone, firstName: b.name.ar, orgId: s.orgId });
    return this.tenancy.run(s, async (tx) => {
      const u = await tx.one<{ id: string }>(
        `insert into users (organisation_id, keycloak_sub, email, phone, name_ar, name_en, status, created_by) values (app_org(), $1,$2,$3,$4,$5,'active',$6) returning id`,
        [sub, b.email ?? null, b.phone ?? null, b.name.ar, b.name.en, s.userId],
      );
      const orgRoles = ['owner', 'network_director', 'accountant'];
      for (const role of b.roles) {
        if (orgRoles.includes(role)) await tx.query('insert into staff_memberships (organisation_id, user_id, clinic_id, role) values (app_org(), $1, null, $2)', [u.id, role]);
        else {
          if (!b.clinicIds.length) throw badRequest('clinic_required_for_role', role);
          for (const c of b.clinicIds) await tx.query('insert into staff_memberships (organisation_id, user_id, clinic_id, role) values (app_org(), $1, $2, $3)', [u.id, c, role]);
        }
      }
      if (b.phone) await this.messaging.enqueue(tx, { event: 'staff_invite', to: { phone: b.phone }, vars: { link: this.cfg.CONSOLE_URL }, channels: ['sms'] });
      await this.audit.record(tx, s, meta, { action: 'staff.invite', entity: 'user', entityId: u.id, details: { roles: b.roles, clinicIds: b.clinicIds } });
      return { id: u.id };
    });
  }

  @Put('staff/:id/memberships')
  @Staff('staff:edit')
  async memberships(@Auth() p: Principal, @Param('id') id: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const s = asStaff(p);
    const b = parse(z.object({ memberships: z.array(z.object({ role: z.enum(ROLES).exclude(['patient']), clinicId: z.string().uuid().nullable() })).min(1) }), body);
    if (b.memberships.some((m) => m.role === 'owner' || m.role === 'network_director') && !s.roles.includes('owner')) throw forbidden('owner_only_role');
    return this.tenancy.run(s, async (tx) => {
      const u = await tx.maybeOne('select id from users where id = $1', [uuid(id)]);
      if (!u) throw notFound('user');
      await tx.query('delete from staff_memberships where user_id = $1', [id]);
      for (const m of b.memberships) await tx.query('insert into staff_memberships (organisation_id, user_id, clinic_id, role) values (app_org(), $1, $2, $3)', [id, m.clinicId, m.role]);
      await this.audit.record(tx, s, meta, { action: 'privileges.memberships', entity: 'user', entityId: id, details: { memberships: b.memberships } });
      return { ok: true };
    });
  }

  /** FR-STF-4: deactivation revokes access immediately (guard checks status per request) and keeps attribution. */
  @Post('staff/:id/deactivate')
  @Staff('staff:delete')
  async deactivate(@Auth() p: Principal, @Param('id') id: string, @Meta() meta: RequestMeta) {
    const s = asStaff(p);
    if (id === s.userId) throw badRequest('cannot_deactivate_self');
    const u = await this.tenancy.run(s, async (tx) => {
      const row = await tx.maybeOne<{ keycloak_sub: string | null }>(`update users set status = 'deactivated', pin_hash = null where id = $1 returning keycloak_sub`, [uuid(id)]);
      if (!row) throw notFound('user');
      await this.audit.record(tx, s, meta, { action: 'staff.deactivate', entity: 'user', entityId: id });
      return row;
    });
    if (u.keycloak_sub) await this.idp.disableUser(u.keycloak_sub);
    return { ok: true };
  }

  @Get('doctors')
  @Staff('staff:view')
  doctors(@Auth() p: Principal, @Query('clinicId') clinicId?: string) {
    return this.tenancy.run(p, (tx) =>
      tx.query(
        `select u.id, u.name_ar, u.name_en, d.slug, d.title, d.syndicate_number, d.is_public, d.rating_avg, d.rating_count,
                coalesce((select array_agg(distinct m.clinic_id) from staff_memberships m where m.user_id = u.id and m.role = 'doctor'), '{}') as clinic_ids,
                coalesce((select array_agg(specialty_id) from doctor_specialties ds where ds.doctor_id = u.id), '{}') as specialty_ids,
                coalesce((select array_agg(service_id) from doctor_services s where s.doctor_id = u.id), '{}') as service_ids
         from users u join doctor_profiles d on d.user_id = u.id
         where u.status = 'active' and ($1::uuid is null or exists (select 1 from staff_memberships m where m.user_id = u.id and m.clinic_id = $1 and m.role = 'doctor'))
         order by u.name_ar`,
        [clinicId ? uuid(clinicId) : null],
      ),
    );
  }

  @Put('doctors/:id/profile')
  @Staff('staff:edit')
  profile(@Auth() p: Principal, @Param('id') id: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const b = parse(doctorProfileSchema, body);
    return this.tenancy.run(p, async (tx) => {
      const u = await tx.maybeOne(`select id from users u where id = $1 and exists (select 1 from staff_memberships m where m.user_id = u.id and m.role = 'doctor')`, [uuid(id)]);
      if (!u) throw notFound('doctor');
      const r = await tx.one(
        `insert into doctor_profiles (user_id, organisation_id, slug, title, syndicate_number, gender, languages, bio_ar, bio_en, qualifications, is_public)
         values ($1, app_org(), $2,$3,$4,$5,$6,$7,$8,$9,$10)
         on conflict (user_id) do update set slug = excluded.slug, title = excluded.title, syndicate_number = excluded.syndicate_number, gender = excluded.gender,
           languages = excluded.languages, bio_ar = excluded.bio_ar, bio_en = excluded.bio_en, qualifications = excluded.qualifications, is_public = excluded.is_public
         returning *`,
        [id, b.slug, b.title, b.syndicateNumber, b.gender ?? null, b.languages, b.bio?.ar ?? '', b.bio?.en ?? '', JSON.stringify(b.qualifications), b.isPublic],
      );
      await tx.query('delete from doctor_specialties where doctor_id = $1', [id]);
      for (const sp of b.specialtyIds) await tx.query('insert into doctor_specialties (organisation_id, doctor_id, specialty_id) values (app_org(), $1, $2)', [id, sp]);
      await this.audit.record(tx, p, meta, { action: 'doctor.profile', entity: 'user', entityId: id });
      return r;
    });
  }

  /** Signature/stamp/photo images in private storage; signature references are encrypted at rest (SEC-2). */
  @Post('doctors/:id/images/:kind')
  @Staff('staff:edit')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024 } }))
  async image(@Auth() p: Principal, @Param('id') id: string, @Param('kind') kind: string, @UploadedFile() file: { buffer: Buffer } | undefined, @Meta() meta: RequestMeta) {
    const k = parse(z.enum(['signature', 'stamp', 'photo']), kind);
    if (!file) throw badRequest('file_required');
    const mime = sniffMime(file.buffer);
    if (mime !== 'image/png' && mime !== 'image/jpeg') throw badRequest('unsupported_file_type');
    const key = `org/${p.orgId}/doctors/${uuid(id)}/${k}-${Date.now()}`;
    await this.storage.put(key, file.buffer, mime);
    return this.tenancy.run(p, async (tx) => {
      const col = k === 'photo' ? 'photo_key' : `${k}_key_enc`;
      const val = k === 'photo' ? key : this.box.encrypt(key, `doctor:${id}`);
      const r = await tx.maybeOne(`update doctor_profiles set ${col} = $2 where user_id = $1 returning user_id`, [id, val]);
      if (!r) throw notFound('doctor');
      await this.audit.record(tx, p, meta, { action: `doctor.${k}_upload`, entity: 'user', entityId: id });
      return { ok: true };
    });
  }

  // ---- Commission (FR-STF-3)
  @Get('commission-rules')
  @Staff('commission:view')
  rules(@Auth() p: Principal, @Query('doctorId') doctorId?: string) {
    return this.tenancy.run(p, (tx) => {
      const s = asStaff(p);
      // Doctors see only their own rules and statements.
      const own = !s.privileges.has('commission:edit') ? s.userId : doctorId ? uuid(doctorId) : null;
      return tx.query('select * from commission_rules where ($1::uuid is null or doctor_id = $1) order by created_at desc', [own]);
    });
  }

  @Post('commission-rules')
  @Staff('commission:edit')
  createRule(@Auth() p: Principal, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const b = parse(z.object({ doctorId: z.string().uuid(), clinicId: z.string().uuid().optional(), serviceId: z.string().uuid().optional(), serviceType: z.string().optional(), rule: commissionRuleSchema, effectiveFrom: z.string().optional() }), body);
    return this.tenancy.run(p, async (tx) => {
      const r = await tx.one<{ id: string }>(
        `insert into commission_rules (organisation_id, doctor_id, clinic_id, service_id, service_type, rule, effective_from) values (app_org(), $1,$2,$3,$4,$5, coalesce($6::date, current_date)) returning *`,
        [b.doctorId, b.clinicId ?? null, b.serviceId ?? null, b.serviceType ?? null, JSON.stringify(b.rule), b.effectiveFrom ?? null],
      );
      await this.audit.record(tx, p, meta, { action: 'commission.rule', entity: 'commission_rule', entityId: r.id });
      return r;
    });
  }

  @Get('commission-statements')
  @Staff('commission:view')
  statements(@Auth() p: Principal, @Query('month') month?: string) {
    const s = asStaff(p);
    const own = s.privileges.has('commission:edit') ? null : s.userId;
    return this.tenancy.run(s, (tx) =>
      tx.query(
        `select cs.*, u.name_ar as doctor_name from commission_statements cs join users u on u.id = cs.doctor_id
         where ($1::uuid is null or cs.doctor_id = $1) and ($2::date is null or cs.month = $2::date) order by cs.month desc`,
        [own, month ? `${month.slice(0, 7)}-01` : null],
      ),
    );
  }

  /** Generate (or regenerate drafts of) monthly statements. Usually run by the worker on the 1st. */
  @Post('commission-statements/generate')
  @Staff('commission:create')
  async generate(@Auth() p: Principal, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const { month } = parse(z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }), body);
    return this.tenancy.run(p, async (tx) => {
      const out = await generateCommissionStatements(tx, `${month}-01`);
      await this.audit.record(tx, p, meta, { action: 'commission.generate', entity: 'commission_statement', details: { month, count: out.length } });
      return out;
    });
  }

  @Post('commission-statements/:id/approve')
  @Staff('commission:approve')
  approve(@Auth() p: Principal, @Param('id') id: string, @Meta() meta: RequestMeta) {
    const s = asStaff(p);
    return this.tenancy.run(s, async (tx) => {
      const r = await tx.maybeOne(`update commission_statements set status = 'approved', approved_by = $2, approved_at = now() where id = $1 and status = 'draft' returning *`, [uuid(id), s.userId]);
      if (!r) throw notFound('statement');
      await this.audit.record(tx, s, meta, { action: 'commission.approve', entity: 'commission_statement', entityId: id });
      return r;
    });
  }
}

/** Apply the most specific rule per (doctor, clinic, service) to the month's paid bill lines. */
export async function generateCommissionStatements(tx: import('@hf/db').Tx, monthStart: string) {
  const lines = await tx.query<{ doctor_id: string; clinic_id: string; service_id: string | null; service_type: string | null; net: number; bill_id: string }>(
    `select l.doctor_id, b.clinic_id, l.service_id, s.type as service_type, l.net, b.id as bill_id
     from bill_lines l join bills b on b.id = l.bill_id left join services s on s.id = l.service_id
     where l.doctor_id is not null and b.status in ('paid','partially_paid')
       and b.issued_at >= $1::date and b.issued_at < ($1::date + interval '1 month')`,
    [monthStart],
  );
  const rules = await tx.query<{ doctor_id: string; clinic_id: string | null; service_id: string | null; service_type: string | null; rule: CommissionRule }>(
    `select * from commission_rules where effective_from < ($1::date + interval '1 month') order by effective_from desc`,
    [monthStart],
  );
  const pick = (l: (typeof lines)[number]) =>
    rules
      .filter((r) => r.doctor_id === l.doctor_id && (!r.clinic_id || r.clinic_id === l.clinic_id) && (!r.service_id || r.service_id === l.service_id) && (!r.service_type || r.service_type === l.service_type))
      .sort((a, b) => Number(!!b.service_id) - Number(!!a.service_id) || Number(!!b.service_type) - Number(!!a.service_type) || Number(!!b.clinic_id) - Number(!!a.clinic_id))[0];
  const groups = new Map<string, { doctor: string; clinic: string; rule: CommissionRule | null; lines: { net: number; billId: string }[] }>();
  for (const l of lines) {
    const rule = pick(l);
    const key = `${l.doctor_id}|${l.clinic_id}|${JSON.stringify(rule?.rule ?? null)}`;
    const g = groups.get(key) ?? { doctor: l.doctor_id, clinic: l.clinic_id, rule: rule?.rule ?? null, lines: [] };
    g.lines.push({ net: l.net, billId: l.bill_id });
    groups.set(key, g);
  }
  const perDoctorClinic = new Map<string, { doctor: string; clinic: string; revenue: number; share: number; detail: unknown[] }>();
  for (const g of groups.values()) {
    const share = g.rule ? computeCommission(g.rule, g.lines) : 0;
    const k = `${g.doctor}|${g.clinic}`;
    const agg = perDoctorClinic.get(k) ?? { doctor: g.doctor, clinic: g.clinic, revenue: 0, share: 0, detail: [] };
    agg.revenue += g.lines.reduce((a, l) => a + l.net, 0);
    agg.share += share;
    agg.detail.push({ rule: g.rule, lines: g.lines.length, share });
    perDoctorClinic.set(k, agg);
  }
  const out = [];
  for (const a of perDoctorClinic.values()) {
    const row = await tx.maybeOne(
        `insert into commission_statements (organisation_id, doctor_id, clinic_id, month, revenue, share, lines) values (app_org(), $1,$2,$3,$4,$5,$6)
         on conflict (doctor_id, clinic_id, month) do update set revenue = excluded.revenue, share = excluded.share, lines = excluded.lines
           where commission_statements.status = 'draft'
         returning *`,
        [a.doctor, a.clinic, monthStart, a.revenue, a.share, JSON.stringify(a.detail)],
    );
    if (row) out.push(row);
  }
  return out;
}
