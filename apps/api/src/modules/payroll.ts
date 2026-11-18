import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { ADJUSTMENT_KINDS, localDate, workPatternSchema } from '@hf/shared';
import type { Tx } from '@hf/db';
import { payslipHtml, renderPdf } from '@hf/documents';
import { Auth, Meta, Staff, Webhook } from '../common/decorators';
import { TokenService } from '../common/tokens';
import { CONFIG, type Config } from '../config';
import { asStaff } from '../common/auth.guard';
import type { Principal, RequestMeta, StaffPrincipal } from '../common/principal';
import { AuditService, Tenancy } from '../common/services';
import { badRequest, conflict, forbidden, notFound } from '../common/errors';
import { parse, uuid } from '../common/zod';
import { HrService, type ContractRow } from './hr.service';

const zMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  // Neutralise spreadsheet formulas and quote fields with separators.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
const egp = (p: number) => (p / 100).toFixed(2);

/**
 * Monthly payroll (Sprint 19). Accountants prepare a run (payroll:create/edit); a different person approves it
 * (payroll:approve), except an owner, who may approve their own run in a single-person office. Approved runs are
 * frozen: corrections go into the next month as adjustments.
 */
@Controller('v1/payroll')
export class PayrollController {
  constructor(
    private readonly tenancy: Tenancy,
    private readonly audit: AuditService,
    private readonly hr: HrService,
    private readonly tokens: TokenService,
    @Inject(CONFIG) private readonly cfg: Config,
  ) {}

  @Get('runs')
  @Staff('payroll:view')
  runs(@Auth() p: Principal) {
    return this.tenancy.run(p, (tx) =>
      tx.query(`select r.*, to_char(r.period, 'YYYY-MM') as month, (select count(*)::int from payslips s where s.run_id = r.id) as payslips from payroll_runs r order by r.period desc limit 36`),
    );
  }

  @Post('runs')
  @Staff('payroll:create')
  create(@Auth() p: Principal, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const s = asStaff(p);
    const b = parse(z.object({ month: zMonth }), body);
    // Payroll covers every clinic: read attendance organisation-wide (the privilege is checked above).
    return this.tenancy.system(s.orgId, async (tx) => {
      const period = `${b.month}-01`;
      if (await tx.maybeOne(`select 1 from payroll_runs where period = $1 and status <> 'cancelled'`, [period])) throw conflict('payroll_run_exists');
      const run = await tx.one<{ id: string }>(`insert into payroll_runs (organisation_id, period, created_by) values (app_org(), $1, $2) returning id`, [period, s.userId]);
      await this.calculate(tx, run.id, period);
      await this.audit.record(tx, s, meta, { action: 'payroll.run_create', entity: 'payroll_run', entityId: run.id, details: { month: b.month } });
      return this.runDetail(tx, run.id);
    });
  }

  @Get('runs/:id')
  @Staff('payroll:view')
  run(@Auth() p: Principal, @Param('id') id: string, @Meta() meta: RequestMeta) {
    return this.tenancy.run(p, async (tx) => {
      const r = await this.runDetail(tx, uuid(id));
      await this.audit.record(tx, p, meta, { action: 'payroll.run_read', entity: 'payroll_run', entityId: id });
      return r;
    });
  }

  @Post('runs/:id/calculate')
  @Staff('payroll:edit')
  @HttpCode(200)
  recalculate(@Auth() p: Principal, @Param('id') id: string, @Meta() meta: RequestMeta) {
    return this.tenancy.system(p.orgId, async (tx) => {
      const run = await this.lockRun(tx, uuid(id));
      if (run.status !== 'draft') throw conflict('payroll_run_not_draft');
      await this.calculate(tx, run.id, run.period);
      await this.audit.record(tx, p, meta, { action: 'payroll.run_calculate', entity: 'payroll_run', entityId: id });
      return this.runDetail(tx, run.id);
    });
  }

  @Post('runs/:id/approve')
  @Staff('payroll:approve')
  @HttpCode(200)
  approve(@Auth() p: Principal, @Param('id') id: string, @Meta() meta: RequestMeta) {
    const s = asStaff(p);
    return this.tenancy.run(s, async (tx) => {
      const run = await this.lockRun(tx, uuid(id));
      if (run.status !== 'draft') throw conflict('payroll_run_not_draft');
      if (run.created_by === s.userId && !s.roles.includes('owner')) throw forbidden('four_eyes_required');
      const n = await tx.one<{ n: number }>('select count(*)::int as n from payslips where run_id = $1', [run.id]);
      if (n.n === 0) throw badRequest('payroll_run_empty');
      await tx.query(`update payroll_runs set status = 'approved', approved_by = $2, approved_at = now() where id = $1`, [run.id, s.userId]);
      await this.audit.record(tx, s, meta, { action: 'payroll.run_approve', entity: 'payroll_run', entityId: id });
      return this.runDetail(tx, run.id);
    });
  }

  @Post('runs/:id/paid')
  @Staff('payroll:approve')
  @HttpCode(200)
  paid(@Auth() p: Principal, @Param('id') id: string, @Meta() meta: RequestMeta) {
    return this.tenancy.run(p, async (tx) => {
      const run = await this.lockRun(tx, uuid(id));
      if (run.status !== 'approved') throw conflict('payroll_run_not_approved');
      await tx.query(`update payroll_runs set status = 'paid', paid_at = now() where id = $1`, [run.id]);
      await this.audit.record(tx, p, meta, { action: 'payroll.run_paid', entity: 'payroll_run', entityId: id });
      return this.runDetail(tx, run.id);
    });
  }

  @Post('runs/:id/cancel')
  @Staff('payroll:approve')
  @HttpCode(200)
  cancelRun(@Auth() p: Principal, @Param('id') id: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const b = parse(z.object({ reason: z.string().trim().min(3).max(300) }), body);
    return this.tenancy.run(p, async (tx) => {
      const run = await this.lockRun(tx, uuid(id));
      if (run.status === 'paid' || run.status === 'cancelled') throw conflict('payroll_run_closed');
      await tx.query(`update payroll_runs set status = 'cancelled' where id = $1`, [run.id]);
      await this.audit.record(tx, p, meta, { action: 'payroll.run_cancel', entity: 'payroll_run', entityId: id, reason: b.reason });
      return { ok: true };
    });
  }

  /** Bank transfer file: one line per payslip with the full IBAN (decrypted here only). */
  @Get('runs/:id/bank-file.csv')
  @Staff('payroll:export')
  async bankFile(@Auth() p: Principal, @Param('id') id: string, @Meta() meta: RequestMeta, @Res() res: Response) {
    const csv = await this.tenancy.run(p, async (tx) => {
      const run = await this.lockRun(tx, uuid(id), false);
      if (run.status === 'draft' || run.status === 'cancelled') throw conflict('payroll_run_not_approved');
      const rows = await tx.query<{ name_ar: string; name_en: string; bank_name: string | null; iban_enc: Buffer | null; net: number }>(
        `select u.name_ar, u.name_en, c.bank_name, c.iban_enc, s.net from payslips s join users u on u.id = s.user_id join employment_contracts c on c.id = s.contract_id where s.run_id = $1 order by u.name_ar`,
        [run.id],
      );
      await this.audit.record(tx, p, meta, { action: 'payroll.bank_file_export', entity: 'payroll_run', entityId: id, details: { rows: rows.length } });
      const ref = `SAL-${run.period.slice(0, 7)}`;
      return ['name_ar,name_en,bank,iban,amount_egp,reference', ...rows.map((r) => [r.name_ar, r.name_en, r.bank_name, this.hr.openIban(r.iban_enc) ?? '', egp(r.net), ref].map(csvCell).join(','))].join('\n');
    });
    res.setHeader('content-type', 'text/csv; charset=utf-8').setHeader('content-disposition', `attachment; filename="bank-${id}.csv"`).setHeader('cache-control', 'no-store').send('﻿' + csv);
  }

  /** Social insurance contributions for the month (Form 2 style summary). */
  @Get('runs/:id/insurance.csv')
  @Staff('payroll:export')
  async insuranceFile(@Auth() p: Principal, @Param('id') id: string, @Meta() meta: RequestMeta, @Res() res: Response) {
    const csv = await this.tenancy.run(p, async (tx) => {
      await this.lockRun(tx, uuid(id), false);
      const rows = await tx.query<{ name_ar: string; insurance_number: string | null; insurable_wage: number | null; lines: { code: string; amount: number }[] }>(
        `select u.name_ar, c.social_insurance_number as insurance_number, c.insurable_wage, s.lines from payslips s join users u on u.id = s.user_id join employment_contracts c on c.id = s.contract_id
         where s.run_id = $1 order by u.name_ar`,
        [id],
      );
      await this.audit.record(tx, p, meta, { action: 'payroll.insurance_export', entity: 'payroll_run', entityId: id, details: { rows: rows.length } });
      const amt = (l: { code: string; amount: number }[], code: string) => l.find((x) => x.code === code)?.amount ?? 0;
      return [
        'name_ar,insurance_number,insurable_wage_egp,employee_share_egp,employer_share_egp',
        ...rows.filter((r) => r.insurable_wage).map((r) => [r.name_ar, r.insurance_number, egp(r.insurable_wage ?? 0), egp(amt(r.lines, 'social_insurance')), egp(amt(r.lines, 'social_insurance_employer'))].map(csvCell).join(',')),
      ].join('\n');
    });
    res.setHeader('content-type', 'text/csv; charset=utf-8').setHeader('content-disposition', `attachment; filename="insurance-${id}.csv"`).setHeader('cache-control', 'no-store').send('﻿' + csv);
  }

  // ---- Adjustments ---------------------------------------------------------------------------------------------

  @Get('adjustments')
  @Staff('payroll:view')
  adjustments(@Auth() p: Principal, @Query('month') month: string) {
    const period = `${parse(zMonth, month)}-01`;
    return this.tenancy.run(p, (tx) =>
      tx.query(`select a.*, u.name_ar, u.name_en from payroll_adjustments a join users u on u.id = a.user_id where a.period = $1 order by u.name_ar, a.created_at`, [period]),
    );
  }

  @Post('adjustments')
  @Staff('payroll:edit')
  addAdjustment(@Auth() p: Principal, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const s = asStaff(p);
    const b = parse(
      z.object({ userId: z.string().uuid(), month: zMonth, kind: z.enum(ADJUSTMENT_KINDS), amount: z.number().int().positive().max(100_000_000), taxable: z.boolean().optional(), note: z.string().trim().min(2).max(300) }),
      body,
    );
    return this.tenancy.run(s, async (tx) => {
      const period = `${b.month}-01`;
      await this.assertPeriodOpen(tx, period);
      if (!(await tx.maybeOne(`select 1 from employment_contracts where user_id = $1`, [b.userId]))) throw notFound('contract');
      // Reimbursements, advances and repayments are not taxable; other kinds are unless stated.
      const taxable = b.taxable ?? !['reimbursement', 'advance', 'advance_repayment'].includes(b.kind);
      const r = await tx.one<{ id: string }>(
        `insert into payroll_adjustments (organisation_id, user_id, period, kind, amount, taxable, note, created_by) values (app_org(), $1,$2,$3,$4,$5,$6,$7) returning *`,
        [b.userId, period, b.kind, b.amount, taxable, b.note, s.userId],
      );
      await this.audit.record(tx, s, meta, { action: 'payroll.adjustment_add', entity: 'payroll_adjustment', entityId: r.id, details: { userId: b.userId, kind: b.kind, amount: b.amount } });
      return r;
    });
  }

  @Delete('adjustments/:id')
  @Staff('payroll:edit')
  deleteAdjustment(@Auth() p: Principal, @Param('id') id: string, @Meta() meta: RequestMeta) {
    return this.tenancy.run(p, async (tx) => {
      const a = await tx.maybeOne<{ period: string }>('select period from payroll_adjustments where id = $1', [uuid(id)]);
      if (!a) throw notFound('payroll_adjustment');
      await this.assertPeriodOpen(tx, a.period);
      await tx.query('delete from payroll_adjustments where id = $1', [id]);
      await this.audit.record(tx, p, meta, { action: 'payroll.adjustment_delete', entity: 'payroll_adjustment', entityId: id });
      return { deleted: true };
    });
  }

  // ---- Payslips ------------------------------------------------------------------------------------------------

  /** Your own payslips from approved or paid runs. */
  @Get('me/payslips')
  @Staff()
  myPayslips(@Auth() p: Principal) {
    const s = asStaff(p);
    return this.tenancy.system(s.orgId, (tx) =>
      tx.query(
        `select s.id, to_char(r.period, 'YYYY-MM') as month, r.status, s.gross, s.deductions, s.net, s.lines from payslips s join payroll_runs r on r.id = s.run_id
         where s.user_id = $1 and r.status in ('approved','paid') order by r.period desc limit 36`,
        [s.userId],
      ),
    );
  }

  /** One of your own payslips (approved or paid runs). */
  @Get('me/payslips/:id')
  @Staff()
  myPayslip(@Auth() p: Principal, @Param('id') id: string) {
    const s = asStaff(p);
    return this.tenancy.system(s.orgId, async (tx) => {
      const r = await tx.maybeOne(
        `select s.id, to_char(r.period, 'YYYY-MM') as month, r.status, s.gross, s.deductions, s.net, s.lines, s.inputs from payslips s join payroll_runs r on r.id = s.run_id
         where s.id = $1 and s.user_id = $2 and r.status in ('approved','paid')`,
        [uuid(id), s.userId],
      );
      if (!r) throw notFound('payslip');
      return r;
    });
  }

  @Get('payslips/:id/pdf')
  @Staff()
  async payslipPdf(@Auth() p: Principal, @Param('id') id: string, @Meta() meta: RequestMeta, @Res() res: Response) {
    const s = asStaff(p);
    const html = await this.tenancy.system(s.orgId, async (tx) => {
      const doc = await this.payslipDoc(tx, uuid(id), s);
      await this.audit.record(tx, s, meta, { action: 'payroll.payslip_print', entity: 'payslip', entityId: id });
      return doc;
    });
    res.setHeader('content-type', 'application/pdf').setHeader('cache-control', 'no-store').send(await renderPdf(html));
  }

  /** A 10-minute link to the payslip PDF, for apps that cannot send the sign-in header to a browser. */
  @Get('payslips/:id/link')
  @Staff()
  payslipLink(@Auth() p: Principal, @Param('id') id: string, @Meta() meta: RequestMeta) {
    const s = asStaff(p);
    return this.tenancy.system(s.orgId, async (tx) => {
      await this.payslipDoc(tx, uuid(id), s);
      await this.audit.record(tx, s, meta, { action: 'payroll.payslip_link', entity: 'payslip', entityId: id });
      const token = this.tokens.signShareLink('payslip', `${s.orgId}:${id}:${s.userId}`, 600);
      return { url: `${this.cfg.API_PUBLIC_URL}/v1/payroll/share/payslip/${token}`, expiresInSeconds: 600 };
    });
  }

  @Get('share/payslip/:token')
  @Webhook()
  async sharedPayslip(@Param('token') token: string, @Res() res: Response) {
    const [orgId, id, userId] = this.tokens.verifyShareLink('payslip', token)?.split(':') ?? [];
    if (!orgId || !id || !userId) throw notFound('link');
    const html = await this.tenancy.system(orgId, async (tx) => {
      // Re-check at open time: the run must still be approved or paid, and the link holder's access unchanged.
      const row = await tx.maybeOne<{ user_id: string; status: string }>('select s.user_id, r.status from payslips s join payroll_runs r on r.id = s.run_id where s.id = $1', [id]);
      if (!row || row.user_id !== userId || (row.status !== 'approved' && row.status !== 'paid')) throw notFound('link');
      const html = await this.payslipDoc(tx, id, null);
      await this.audit.record(tx, null, null, { action: 'payroll.payslip_link_open', entity: 'payslip', entityId: id });
      return html;
    });
    res.setHeader('content-type', 'application/pdf').setHeader('cache-control', 'no-store, private').setHeader('x-robots-tag', 'noindex').send(await renderPdf(html));
  }

  /** Payslip HTML; `viewer` must own it (approved/paid run) or hold payroll:view. Null viewer: caller already checked. */
  private async payslipDoc(tx: Tx, id: string, viewer: StaffPrincipal | null) {
    const row = await tx.maybeOne<{ user_id: string; status: string; period: string; gross: number; deductions: number; net: number; lines: never; inputs: { workedDays: number; absentDays: number; leaveDays: number; latenessMinutes: number; overtimeMinutes: number; restDayOvertimeMinutes: number }; name_ar: string; job_title_ar: string; social_insurance_number: string | null; iban_last4: string | null; clinic_ar: string; clinic_en: string; address: string | null; phones: string[] | null }>(
      `select s.user_id, r.status, to_char(r.period, 'YYYY-MM-DD') as period, s.gross, s.deductions, s.net, s.lines, s.inputs, u.name_ar, c.job_title_ar, c.social_insurance_number, c.iban_last4,
              cl.name_ar as clinic_ar, cl.name_en as clinic_en, cl.address_lines as address, cl.phones
       from payslips s join payroll_runs r on r.id = s.run_id join users u on u.id = s.user_id join employment_contracts c on c.id = s.contract_id join clinics cl on cl.id = s.clinic_id
       where s.id = $1`,
      [id],
    );
    if (!row) throw notFound('payslip');
    if (viewer) {
      const own = row.user_id === viewer.userId && (row.status === 'approved' || row.status === 'paid');
      if (!own && !viewer.privileges.has('payroll:view')) throw notFound('payslip');
    }
    return payslipHtml({
      clinic: { nameAr: row.clinic_ar, nameEn: row.clinic_en, address: row.address ?? '', phones: row.phones ?? [] },
      employee: { name: row.name_ar, jobTitle: row.job_title_ar, socialInsuranceNumber: row.social_insurance_number, ibanLast4: row.iban_last4 },
      period: row.period,
      lines: row.lines,
      gross: row.gross,
      deductions: row.deductions,
      net: row.net,
      attendance: { workedDays: row.inputs.workedDays, absentDays: row.inputs.absentDays, leaveDays: row.inputs.leaveDays, lateMinutes: row.inputs.latenessMinutes, overtimeMinutes: row.inputs.overtimeMinutes + row.inputs.restDayOvertimeMinutes },
      status: row.status,
    });
  }

  // ---- Helpers -------------------------------------------------------------------------------------------------

  private async lockRun(tx: Tx, id: string, forUpdate = true) {
    const run = await tx.maybeOne<{ id: string; status: string; period: string; created_by: string | null }>(
      `select id, status, to_char(period, 'YYYY-MM-DD') as period, created_by from payroll_runs where id = $1 ${forUpdate ? 'for update' : ''}`,
      [id],
    );
    if (!run) throw notFound('payroll_run');
    return run;
  }

  private async assertPeriodOpen(tx: Tx, period: string) {
    if (await tx.maybeOne(`select 1 from payroll_runs where period = $1 and status in ('approved','paid')`, [period])) throw conflict('payroll_period_closed');
  }

  /** (Re)build a draft run's payslips from contracts in force during the month. */
  private async calculate(tx: Tx, runId: string, period: string) {
    const settings = await this.hr.settings(tx);
    const today = localDate(new Date());
    const last = new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0)).toISOString().slice(0, 10);
    const contracts = await tx.query<ContractRow>(
      `select distinct on (user_id) * from employment_contracts where start_date <= $2 and (end_date is null or end_date >= $1) order by user_id, (status = 'active') desc, start_date desc`,
      [period, last],
    );
    await tx.query('delete from payslips where run_id = $1', [runId]);
    const runWarnings: string[] = [];
    if (settings.socialInsurance.year < Number(period.slice(0, 4))) runWarnings.push('social_insurance_limits_outdated');
    if (last >= today) runWarnings.push('period_not_finished');
    const totals = { gross: 0, deductions: 0, net: 0, employerCost: 0, employeeInsurance: 0, employerInsurance: 0, incomeTax: 0, martyrsFund: 0, people: 0 };
    for (const c of contracts) {
      workPatternSchema.parse(c.work_pattern);
      const { summary, slip } = await this.hr.payslipFor(tx, c, period, today, settings);
      await tx.query(
        `insert into payslips (organisation_id, run_id, user_id, clinic_id, contract_id, gross, deductions, net, employer_cost, lines, inputs, warnings)
         values (app_org(), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [runId, c.user_id, c.clinic_id, c.id, slip.gross, slip.deductions, slip.net, slip.employerCost, JSON.stringify(slip.lines), JSON.stringify(summary), JSON.stringify(slip.warnings)],
      );
      totals.gross += slip.gross;
      totals.deductions += slip.deductions;
      totals.net += slip.net;
      totals.employerCost += slip.employerCost;
      totals.employeeInsurance += slip.employeeInsurance;
      totals.employerInsurance += slip.employerInsurance;
      totals.incomeTax += slip.incomeTax;
      totals.martyrsFund += slip.martyrsFund;
      totals.people++;
    }
    await tx.query(`update payroll_runs set totals = $2, warnings = $3, calculated_at = now() where id = $1`, [runId, JSON.stringify(totals), JSON.stringify(runWarnings)]);
  }

  private async runDetail(tx: Tx, id: string) {
    const run = await tx.maybeOne(`select r.*, to_char(r.period, 'YYYY-MM') as month from payroll_runs r where r.id = $1`, [id]);
    if (!run) throw notFound('payroll_run');
    const payslips = await tx.query(
      `select s.id, s.user_id, s.clinic_id, s.gross, s.deductions, s.net, s.employer_cost, s.lines, s.inputs, s.warnings, u.name_ar, u.name_en, c.job_title_ar, c.job_title_en, c.pay_basis
       from payslips s join users u on u.id = s.user_id join employment_contracts c on c.id = s.contract_id where s.run_id = $1 order by u.name_ar`,
      [id],
    );
    return { ...run, payslips };
  }
}

export type { StaffPrincipal };
