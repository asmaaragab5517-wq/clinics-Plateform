import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { SERVICE_TYPES, zDate } from '@hf/shared';
import { Auth, Meta, Staff } from '../common/decorators';
import { asStaff } from '../common/auth.guard';
import type { Principal, RequestMeta } from '../common/principal';
import { AuditService, Tenancy } from '../common/services';
import { DomainError, badRequest, notFound } from '../common/errors';
import { parse, uuid } from '../common/zod';
import { BillingService } from './billing.service';
import { visiblePatient } from './patients';

/** Insurance / TPA (FR-BIL-11): payers, plans, patient coverage, claim batches with export and settlement. */
@Controller('v1/insurance')
export class InsuranceController {
  constructor(private readonly tenancy: Tenancy, private readonly audit: AuditService, private readonly billing: BillingService) {}

  @Get('payers')
  @Staff('bill:view')
  payers(@Auth() p: Principal) {
    return this.tenancy.run(p, (tx) =>
      tx.query(`select py.*, coalesce((select jsonb_agg(pp order by pp.name) from payer_plans pp where pp.payer_id = py.id), '[]') as plans from payers py order by py.name_ar`),
    );
  }

  @Post('payers')
  @Staff('settings:edit')
  createPayer(@Auth() p: Principal, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const b = parse(z.object({ code: z.string().regex(/^[A-Z0-9_-]{2,20}$/), nameAr: z.string().min(2), nameEn: z.string().default(''), kind: z.enum(['insurer', 'tpa', 'corporate']), contact: z.record(z.string()).default({}) }), body);
    return this.tenancy.run(p, async (tx) => {
      const r = await tx.one<{ id: string }>(`insert into payers (organisation_id, code, name_ar, name_en, kind, contact) values (app_org(), $1,$2,$3,$4,$5) returning *`, [b.code, b.nameAr, b.nameEn, b.kind, JSON.stringify(b.contact)]);
      await this.audit.record(tx, p, meta, { action: 'insurance.payer_create', entity: 'payer', entityId: r.id });
      return r;
    });
  }

  @Post('plans')
  @Staff('settings:edit')
  createPlan(@Auth() p: Principal, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const b = parse(
      z.object({
        payerId: z.string().uuid(), name: z.string().min(2), coveragePercent: z.number().min(0).max(100), copayFixed: z.number().int().min(0).default(0),
        typeOverrides: z.record(z.enum(SERVICE_TYPES), z.number().min(0).max(100)).default({}), excludedServiceIds: z.array(z.string().uuid()).default([]),
        requiresApproval: z.boolean().default(false), annualLimit: z.number().int().positive().optional(),
      }),
      body,
    );
    return this.tenancy.run(p, async (tx) => {
      const r = await tx.one<{ id: string }>(
        `insert into payer_plans (organisation_id, payer_id, name, coverage_percent, copay_fixed, type_overrides, excluded_service_ids, requires_approval, annual_limit) values (app_org(), $1,$2,$3,$4,$5,$6,$7,$8) returning *`,
        [b.payerId, b.name, b.coveragePercent, b.copayFixed, JSON.stringify(b.typeOverrides), b.excludedServiceIds, b.requiresApproval, b.annualLimit ?? null],
      );
      await this.audit.record(tx, p, meta, { action: 'insurance.plan_create', entity: 'payer_plan', entityId: r.id });
      return r;
    });
  }

  @Get('patients/:patientId/coverages')
  @Staff('patient:view')
  coverages(@Auth() p: Principal, @Param('patientId') patientId: string) {
    return this.tenancy.run(p, async (tx) => {
      await visiblePatient(tx, patientId);
      return tx.query(
        `select pc.*, pp.name as plan_name, pp.coverage_percent, pp.copay_fixed, pp.requires_approval, py.name_ar as payer_name_ar, py.name_en as payer_name_en
         from patient_coverages pc join payer_plans pp on pp.id = pc.plan_id join payers py on py.id = pp.payer_id where pc.patient_id = $1 order by pc.is_active desc, pc.valid_from desc`,
        [patientId],
      );
    });
  }

  @Post('patients/:patientId/coverages')
  @Staff('patient:edit')
  addCoverage(@Auth() p: Principal, @Param('patientId') patientId: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const b = parse(z.object({ planId: z.string().uuid(), memberNumber: z.string().min(2).max(60), validFrom: zDate, validTo: zDate.optional() }), body);
    return this.tenancy.run(p, async (tx) => {
      await visiblePatient(tx, patientId);
      const r = await tx.one<{ id: string }>(
        `insert into patient_coverages (organisation_id, patient_id, plan_id, member_number, valid_from, valid_to) values (app_org(), $1,$2,$3,$4,$5) returning *`,
        [patientId, b.planId, b.memberNumber, b.validFrom, b.validTo ?? null],
      );
      await this.audit.record(tx, p, meta, { action: 'insurance.coverage_add', entity: 'patient_coverage', entityId: r.id, patientId });
      return r;
    });
  }

  @Patch('coverages/:id')
  @Staff('patient:edit')
  updateCoverage(@Auth() p: Principal, @Param('id') id: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const b = parse(z.object({ isActive: z.boolean().optional(), validTo: zDate.nullable().optional() }), body);
    return this.tenancy.run(p, async (tx) => {
      const r = await tx.maybeOne<{ patient_id: string }>(
        `update patient_coverages set is_active = coalesce($2, is_active), valid_to = case when $3::boolean then $4::date else valid_to end where id = $1 returning patient_id`,
        [uuid(id), b.isActive ?? null, b.validTo !== undefined, b.validTo ?? null],
      );
      if (!r) throw notFound('coverage');
      await this.audit.record(tx, p, meta, { action: 'insurance.coverage_update', entity: 'patient_coverage', entityId: id, patientId: r.patient_id });
      return { ok: true };
    });
  }

  // ---- Claims
  @Get('claim-batches')
  @Staff('bill:view')
  batches(@Auth() p: Principal) {
    return this.tenancy.run(p, (tx) => tx.query(`select cb.*, py.name_ar as payer_name_ar, py.name_en as payer_name_en, (select count(*)::int from claim_items ci where ci.batch_id = cb.id) as items from claim_batches cb join payers py on py.id = cb.payer_id order by cb.created_at desc`));
  }

  @Get('claim-batches/:id/items')
  @Staff('bill:view')
  items(@Auth() p: Principal, @Param('id') id: string) {
    return this.tenancy.run(p, async (tx) => {
      if (!(await tx.maybeOne('select 1 from claim_batches where id = $1', [uuid(id)]))) throw notFound('claim_batch');
      return tx.query(
        `select ci.id, ci.bill_id, b.number as invoice, ci.patient_id, p.mrn, ci.amount, ci.paid, ci.status, ci.rejection_reason, b.approval_number, pc.member_number
         from claim_items ci join bills b on b.id = ci.bill_id join patients p on p.id = ci.patient_id left join patient_coverages pc on pc.id = b.coverage_id where ci.batch_id = $1 order by b.issued_at`,
        [id],
      );
    });
  }

  @Patch('payers/:id')
  @Staff('settings:edit')
  updatePayer(@Auth() p: Principal, @Param('id') id: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const b = parse(z.object({ nameAr: z.string().min(2).optional(), nameEn: z.string().optional(), isActive: z.boolean().optional(), contact: z.record(z.string()).optional() }), body);
    return this.tenancy.run(p, async (tx) => {
      const r = await tx.maybeOne('update payers set name_ar = coalesce($2, name_ar), name_en = coalesce($3, name_en), is_active = coalesce($4, is_active), contact = coalesce($5, contact) where id = $1 returning *', [uuid(id), b.nameAr ?? null, b.nameEn ?? null, b.isActive ?? null, b.contact ? JSON.stringify(b.contact) : null]);
      if (!r) throw notFound('payer');
      await this.audit.record(tx, p, meta, { action: 'insurance.payer_update', entity: 'payer', entityId: id, details: { keys: Object.keys(b) } });
      return r;
    });
  }

  @Patch('plans/:id')
  @Staff('settings:edit')
  updatePlan(@Auth() p: Principal, @Param('id') id: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const b = parse(z.object({ isActive: z.boolean().optional(), coveragePercent: z.number().min(0).max(100).optional(), copayFixed: z.number().int().min(0).optional(), requiresApproval: z.boolean().optional() }), body);
    return this.tenancy.run(p, async (tx) => {
      const r = await tx.maybeOne(
        'update payer_plans set is_active = coalesce($2, is_active), coverage_percent = coalesce($3, coverage_percent), copay_fixed = coalesce($4, copay_fixed), requires_approval = coalesce($5, requires_approval) where id = $1 returning *',
        [uuid(id), b.isActive ?? null, b.coveragePercent ?? null, b.copayFixed ?? null, b.requiresApproval ?? null],
      );
      if (!r) throw notFound('plan');
      await this.audit.record(tx, p, meta, { action: 'insurance.plan_update', entity: 'payer_plan', entityId: id, details: b });
      return r;
    });
  }

  /** Collect issued bills with an insurer share for a payer and period into a draft batch. */
  @Post('claim-batches')
  @Staff('bill:approve')
  createBatch(@Auth() p: Principal, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const s = asStaff(p);
    const b = parse(z.object({ payerId: z.string().uuid(), from: zDate, to: zDate }), body);
    return this.tenancy.run(s, async (tx) => {
      const payer = await tx.maybeOne<{ code: string }>('select code from payers where id = $1', [b.payerId]);
      if (!payer) throw notFound('payer');
      const bills = await tx.query<{ id: string; clinic_id: string; patient_id: string; insurer_share: number }>(
        `select b.id, b.clinic_id, b.patient_id, b.insurer_share from bills b join patient_coverages pc on pc.id = b.coverage_id join payer_plans pp on pp.id = pc.plan_id
         where pp.payer_id = $1 and b.insurer_share > 0 and b.claim_item_id is null and b.status in ('issued','partially_paid','paid')
           and (b.issued_at at time zone 'Africa/Cairo')::date between $2 and $3 order by b.issued_at`,
        [b.payerId, b.from, b.to],
      );
      if (!bills.length) throw new DomainError('nothing_to_claim', HttpStatus.CONFLICT);
      const n = await tx.one<{ n: number }>('select next_number($1) as n', [`claim:${b.payerId}`]);
      const batch = await tx.one<{ id: string }>(
        `insert into claim_batches (organisation_id, payer_id, number, period_from, period_to, total, created_by) values (app_org(), $1,$2,$3,$4,$5,$6) returning *`,
        [b.payerId, `${payer.code}-${String(n.n).padStart(5, '0')}`, b.from, b.to, bills.reduce((a, x) => a + x.insurer_share, 0), s.userId],
      );
      for (const bill of bills) {
        const item = await tx.one<{ id: string }>(`insert into claim_items (organisation_id, batch_id, bill_id, clinic_id, patient_id, amount) values (app_org(), $1,$2,$3,$4,$5) returning id`, [batch.id, bill.id, bill.clinic_id, bill.patient_id, bill.insurer_share]);
        await tx.query('update bills set claim_item_id = $2 where id = $1', [bill.id, item.id]);
      }
      await this.audit.record(tx, s, meta, { action: 'insurance.claim_batch', entity: 'claim_batch', entityId: batch.id, details: { bills: bills.length } });
      return { ...batch, items: bills.length };
    });
  }

  /** Claim export per payer (CSV, UTF-8 BOM so Excel opens Arabic correctly). Includes ICD-10 codes from the visit. */
  @Get('claim-batches/:id/export.csv')
  @Staff('bill:export')
  async export(@Auth() p: Principal, @Param('id') id: string, @Meta() meta: RequestMeta, @Res() res: Response) {
    const rows = await this.tenancy.run(p, async (tx) => {
      const batch = await tx.maybeOne<{ number: string }>('select number from claim_batches where id = $1', [uuid(id)]);
      if (!batch) throw notFound('claim_batch');
      const items = await tx.query<Record<string, unknown>>(
        `select cb.number as batch, b.number as invoice, to_char(b.issued_at at time zone 'Africa/Cairo', 'YYYY-MM-DD') as date, pc.member_number, b.approval_number,
                p.mrn, p.first_name_ar || ' ' || p.father_name_ar || ' ' || p.family_name_ar as patient, c.name_ar as clinic,
                coalesce((select string_agg(d->>'code', ' ') from encounters e cross join lateral jsonb_array_elements(e.diagnoses) d where e.id = b.encounter_id or e.appointment_id = b.appointment_id), '') as icd10,
                (select string_agg(l.description, ' | ' order by l.position) from bill_lines l where l.bill_id = b.id) as services,
                round(b.total / 100.0, 2) as bill_total_egp, round(ci.amount / 100.0, 2) as claimed_egp
         from claim_items ci join claim_batches cb on cb.id = ci.batch_id join bills b on b.id = ci.bill_id join patients p on p.id = ci.patient_id
         join clinics c on c.id = ci.clinic_id left join patient_coverages pc on pc.id = b.coverage_id where ci.batch_id = $1 order by b.issued_at`,
        [id],
      );
      await this.audit.record(tx, p, meta, { action: 'insurance.claim_export', entity: 'claim_batch', entityId: id, details: { rows: items.length } });
      return { batch, items };
    });
    const cols = ['batch', 'invoice', 'date', 'member_number', 'approval_number', 'mrn', 'patient', 'clinic', 'icd10', 'services', 'bill_total_egp', 'claimed_egp'];
    const cell = (v: unknown) => {
      const t = v === null || v === undefined ? '' : String(v);
      const safe = /^[=+\-@]/.test(t) ? `'${t}` : t;
      return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
    };
    res.setHeader('content-type', 'text/csv; charset=utf-8').setHeader('content-disposition', `attachment; filename="claims-${rows.batch.number}.csv"`)
      .send('﻿' + [cols.join(','), ...rows.items.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\r\n'));
  }

  @Post('claim-batches/:id/submit')
  @Staff('bill:approve')
  @HttpCode(200)
  submit(@Auth() p: Principal, @Param('id') id: string, @Meta() meta: RequestMeta) {
    return this.tenancy.run(p, async (tx) => {
      const r = await tx.maybeOne(`update claim_batches set status = 'submitted', submitted_at = now() where id = $1 and status = 'draft' returning id`, [uuid(id)]);
      if (!r) throw new DomainError('batch_not_draft', HttpStatus.CONFLICT);
      await this.audit.record(tx, p, meta, { action: 'insurance.claim_submit', entity: 'claim_batch', entityId: id });
      return { ok: true };
    });
  }

  /** Record the payer's remittance: paid items become 'insurance' payments on their bills; rejected items return to the patient balance. */
  @Post('claim-batches/:id/settle')
  @Staff('bill:approve')
  @HttpCode(200)
  settle(@Auth() p: Principal, @Param('id') id: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const s = asStaff(p);
    const b = parse(z.object({ reference: z.string().min(1).max(100), items: z.array(z.object({ billId: z.string().uuid(), paidAmount: z.number().int().min(0), rejectionReason: z.string().max(300).optional() })).min(1) }), body);
    return this.tenancy.run(s, async (tx) => {
      const batch = await tx.maybeOne<{ id: string; status: string }>('select id, status from claim_batches where id = $1 for update', [uuid(id)]);
      if (!batch) throw notFound('claim_batch');
      if (!['submitted', 'partially_paid'].includes(batch.status)) throw new DomainError('batch_not_submitted', HttpStatus.CONFLICT);
      for (const it of b.items) {
        const ci = await tx.maybeOne<{ id: string; amount: number; paid: number }>('select id, amount, paid from claim_items where batch_id = $1 and bill_id = $2 for update', [id, it.billId]);
        if (!ci) throw badRequest('bill_not_in_batch', it.billId);
        const pay = Math.min(it.paidAmount, ci.amount - ci.paid);
        if (pay > 0) await this.billing.pay(tx, s, meta, it.billId, { method: 'insurance', amount: pay, reference: b.reference });
        const paid = ci.paid + pay;
        const status = it.rejectionReason && paid === 0 ? 'rejected' : paid >= ci.amount ? 'paid' : 'partially_paid';
        await tx.query('update claim_items set paid = $2, status = $3, rejection_reason = $4 where id = $1', [ci.id, paid, status, it.rejectionReason ?? null]);
        // A rejected or short-paid claim moves the unpaid part back to the patient's share.
        if (status !== 'paid') await tx.query('update bills set insurer_share = $2 where id = $1', [it.billId, paid]);
      }
      const t = await tx.one<{ total: number; paid: number; open: number }>(`select sum(amount)::int as total, sum(paid)::int as paid, count(*) filter (where status = 'claimed')::int as open from claim_items where batch_id = $1`, [id]);
      await tx.query(`update claim_batches set paid = $2, status = $3 where id = $1`, [id, t.paid, t.open === 0 && t.paid >= t.total ? 'paid' : 'partially_paid']);
      await this.audit.record(tx, s, meta, { action: 'insurance.claim_settle', entity: 'claim_batch', entityId: id, details: { items: b.items.length, reference: b.reference } });
      return tx.one('select * from claim_batches where id = $1', [id]);
    });
  }
}
