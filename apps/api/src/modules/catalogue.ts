import { Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { packageSchema, priceSchema, serviceSchema } from '@hf/shared';
import { Auth, Meta, Staff } from '../common/decorators';
import type { Principal, RequestMeta } from '../common/principal';
import { AuditService, Tenancy } from '../common/services';
import { notFound } from '../common/errors';
import { parse, uuid } from '../common/zod';

@Controller('v1')
export class CatalogueController {
  constructor(private readonly tenancy: Tenancy, private readonly audit: AuditService) {}

  @Get('services')
  @Staff('clinic:view')
  services(@Auth() p: Principal) {
    return this.tenancy.run(p, (tx) => tx.query('select * from services order by code'));
  }

  @Post('services')
  @Staff('clinic:edit')
  createService(@Auth() p: Principal, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const s = parse(serviceSchema, body);
    return this.tenancy.run(p, async (tx) => {
      const r = await tx.one<{ id: string }>(
        `insert into services (organisation_id, code, name_ar, name_en, specialty_id, duration_minutes, type, vat, is_active) values (app_org(), $1,$2,$3,$4,$5,$6,$7,$8) returning *`,
        [s.code, s.name.ar, s.name.en, s.specialtyId ?? null, s.durationMinutes, s.type, s.vat, s.isActive],
      );
      await this.audit.record(tx, p, meta, { action: 'service.create', entity: 'service', entityId: r.id });
      return r;
    });
  }

  @Patch('services/:id')
  @Staff('clinic:edit')
  updateService(@Auth() p: Principal, @Param('id') id: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const s = parse(serviceSchema.partial(), body);
    return this.tenancy.run(p, async (tx) => {
      const r = await tx.maybeOne(
        `update services set code = coalesce($2, code), name_ar = coalesce($3, name_ar), name_en = coalesce($4, name_en), specialty_id = coalesce($5, specialty_id),
           duration_minutes = coalesce($6, duration_minutes), type = coalesce($7, type), vat = coalesce($8, vat), is_active = coalesce($9, is_active) where id = $1 returning *`,
        [uuid(id), s.code ?? null, s.name?.ar ?? null, s.name?.en ?? null, s.specialtyId ?? null, s.durationMinutes ?? null, s.type ?? null, s.vat ?? null, s.isActive ?? null],
      );
      if (!r) throw notFound('service');
      await this.audit.record(tx, p, meta, { action: 'service.update', entity: 'service', entityId: id, details: { keys: Object.keys(s) } });
      return r;
    });
  }

  /** Per-clinic price list with effective dates and optional per-doctor override (FR-ORG-3). */
  @Get('prices')
  @Staff('clinic:view')
  prices(@Auth() p: Principal, @Query('clinicId') clinicId?: string) {
    return this.tenancy.run(p, (tx) =>
      tx.query(
        `select pl.*, s.code, s.name_ar, s.name_en, s.vat from price_list_items pl join services s on s.id = pl.service_id
         where ($1::uuid is null or pl.clinic_id = $1) order by s.code, pl.effective_from desc`,
        [clinicId ? uuid(clinicId) : null],
      ),
    );
  }

  @Post('prices')
  @Staff('clinic:edit')
  setPrice(@Auth() p: Principal, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const b = parse(priceSchema, body);
    return this.tenancy.run(p, async (tx) => {
      // Close the currently open price for the same key the day before the new one starts.
      await tx.query(
        `update price_list_items set effective_to = ($4::date - 1) where clinic_id = $1 and service_id = $2 and doctor_id is not distinct from $3
         and effective_from < $4::date and (effective_to is null or effective_to >= $4::date)`,
        [b.clinicId, b.serviceId, b.doctorId ?? null, b.effectiveFrom],
      );
      const r = await tx.one<{ id: string }>(
        `insert into price_list_items (organisation_id, clinic_id, service_id, doctor_id, price, effective_from, effective_to) values (app_org(), $1,$2,$3,$4,$5,$6) returning *`,
        [b.clinicId, b.serviceId, b.doctorId ?? null, b.price, b.effectiveFrom, b.effectiveTo ?? null],
      );
      await this.audit.record(tx, p, meta, { action: 'price.set', entity: 'price_list_item', entityId: r.id, clinicId: b.clinicId, details: { price: b.price } });
      return r;
    });
  }

  @Get('packages')
  @Staff('clinic:view')
  packages(@Auth() p: Principal) {
    return this.tenancy.run(p, (tx) => tx.query('select * from packages order by name_ar'));
  }

  @Post('packages')
  @Staff('clinic:edit')
  createPackage(@Auth() p: Principal, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const b = parse(packageSchema, body);
    return this.tenancy.run(p, async (tx) => {
      const r = await tx.one<{ id: string }>(
        `insert into packages (organisation_id, service_id, name_ar, name_en, sessions, validity_days, price, family_shareable) values (app_org(), $1,$2,$3,$4,$5,$6,$7) returning *`,
        [b.serviceId, b.name.ar, b.name.en, b.sessions, b.validityDays, b.price, b.familyShareable],
      );
      await this.audit.record(tx, p, meta, { action: 'package.create', entity: 'package', entityId: r.id });
      return r;
    });
  }

  @Put('doctors/:id/services')
  @Staff('staff:edit')
  setDoctorServices(@Auth() p: Principal, @Param('id') id: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const { serviceIds } = parse(z.object({ serviceIds: z.array(z.string().uuid()) }), body);
    return this.tenancy.run(p, async (tx) => {
      await tx.query('delete from doctor_services where doctor_id = $1', [uuid(id)]);
      for (const s of serviceIds) await tx.query('insert into doctor_services (organisation_id, doctor_id, service_id) values (app_org(), $1, $2)', [id, s]);
      await this.audit.record(tx, p, meta, { action: 'doctor.services', entity: 'user', entityId: id, details: { serviceIds } });
      return { doctorId: id, serviceIds };
    });
  }

  @Get('custom-fields')
  @Staff('patient:view')
  customFields(@Auth() p: Principal) {
    return this.tenancy.run(p, (tx) => tx.query('select * from custom_field_defs order by key'));
  }

  @Post('custom-fields')
  @Staff('settings:edit')
  createCustomField(@Auth() p: Principal, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const b = parse(
      z.object({
        entity: z.enum(['patient']).default('patient'),
        specialtyId: z.string().uuid().optional(),
        key: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/),
        labelAr: z.string().min(1),
        labelEn: z.string().default(''),
        type: z.enum(['text', 'number', 'date', 'select', 'multiselect', 'boolean', 'file']),
        options: z.array(z.object({ value: z.string(), ar: z.string(), en: z.string() })).default([]),
        required: z.boolean().default(false),
        validation: z.object({ min: z.number().optional(), max: z.number().optional(), pattern: z.string().max(200).optional() }).default({}),
        visibleRoles: z.array(z.string()).default([]),
      }),
      body,
    );
    return this.tenancy.run(p, async (tx) => {
      const r = await tx.one<{ id: string }>(
        `insert into custom_field_defs (organisation_id, entity, specialty_id, key, label_ar, label_en, type, options, required, validation, visible_roles) values (app_org(), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
        [b.entity, b.specialtyId ?? null, b.key, b.labelAr, b.labelEn, b.type, JSON.stringify(b.options), b.required, JSON.stringify(b.validation), b.visibleRoles],
      );
      await this.audit.record(tx, p, meta, { action: 'custom_field.create', entity: 'custom_field_def', entityId: r.id });
      return r;
    });
  }
}
