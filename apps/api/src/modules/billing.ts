import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { closeShiftSchema, countCash, createBillSchema, openShiftSchema, paymentSchema, refundRequestSchema, summariseShift } from '@hf/shared';
import { invoiceHtml, renderPdf, shiftReportHtml } from '@hf/documents';
import type { Tx } from '@hf/db';
import { Auth, Meta, Staff } from '../common/decorators';
import { asStaff } from '../common/auth.guard';
import type { Principal, RequestMeta } from '../common/principal';
import { AuditService, Tenancy } from '../common/services';
import { DomainError, badRequest, forbidden, notFound } from '../common/errors';
import { parse, uuid } from '../common/zod';
import { BillingService } from './billing.service';
import { PatientsService } from './patients.service';
import { visiblePatient } from './patients';
import { MessagingService } from './messaging.service';
import { clinicHeader } from './emr';

const METHOD_LABEL: Record<string, string> = { cash: 'نقدي / Cash', card_at_clinic: 'بطاقة / Card', healthpay: 'HealthPay', package_balance: 'رصيد باقة / Package', bank_transfer: 'تحويل بنكي / Transfer' };

@Controller('v1')
export class BillingController {
  constructor(
    private readonly tenancy: Tenancy,
    private readonly svc: BillingService,
    private readonly audit: AuditService,
    private readonly patients: PatientsService,
    private readonly messaging: MessagingService,
  ) {}

  @Get('bills')
  @Staff('bill:view')
  list(@Auth() p: Principal, @Query() q: Record<string, string>) {
    const b = parse(z.object({ clinicId: z.string().uuid().optional(), patientId: z.string().uuid().optional(), status: z.string().optional(), from: z.string().optional(), to: z.string().optional() }), q);
    return this.tenancy.run(p, (tx) =>
      tx.query(
        `select b.*, p.first_name_ar || ' ' || p.family_name_ar as patient_name, p.mrn from bills b join patients p on p.id = b.patient_id
         where ($1::uuid is null or b.clinic_id = $1) and ($2::uuid is null or b.patient_id = $2) and ($3::text is null or b.status = any(string_to_array($3, ',')))
           and ($4::date is null or b.created_at >= $4::date) and ($5::date is null or b.created_at < $5::date + 1)
         order by b.created_at desc limit 500`,
        [b.clinicId ?? null, b.patientId ?? null, b.status ?? null, b.from ?? null, b.to ?? null],
      ),
    );
  }

  @Get('bills/:id')
  @Staff('bill:view')
  async get(@Auth() p: Principal, @Param('id') id: string) {
    return this.tenancy.run(p, async (tx) => {
      const b = await this.svc.get(tx, uuid(id));
      const [lines, payments, creditNotes, refunds] = await Promise.all([
        tx.query('select * from bill_lines where bill_id = $1 order by position', [id]),
        tx.query('select * from payments where bill_id = $1 order by created_at', [id]),
        tx.query('select * from credit_notes where bill_id = $1 order by created_at', [id]),
        tx.query('select r.* from refunds r join payments p on p.id = r.payment_id where p.bill_id = $1 order by r.created_at', [id]),
      ]);
      return { ...b, balance: b.total - b.credited - (b.paid - b.refunded), lines, payments, creditNotes, refunds };
    });
  }

  @Post('bills')
  @Staff('bill:create')
  create(@Auth() p: Principal, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const b = parse(createBillSchema, body);
    return this.tenancy.run(p, (tx) => this.svc.create(tx, p, meta, b));
  }

  @Post('bills/:id/issue')
  @Staff('bill:create')
  @HttpCode(200)
  issue(@Auth() p: Principal, @Param('id') id: string, @Meta() meta: RequestMeta) {
    return this.tenancy.run(p, (tx) => this.svc.issue(tx, p, meta, uuid(id)));
  }

  @Post('bills/:id/payments')
  @Staff('payment:create')
  pay(@Auth() p: Principal, @Param('id') id: string, @Body() body: unknown, @Meta() meta: RequestMeta, @Req() req: Request) {
    const s = asStaff(p);
    const b = parse(paymentSchema, body);
    if (b.method === 'healthpay') throw badRequest('healthpay_payments_come_from_webhook');
    const idem = (req.headers['idempotency-key'] as string | undefined)?.slice(0, 100);
    return this.tenancy.run(s, (tx) => this.svc.pay(tx, s, meta, uuid(id), { ...b, idempotencyKey: idem ? `${s.userId}:${idem}` : undefined }));
  }

  @Post('bills/:id/void')
  @Staff('bill:edit')
  @HttpCode(200)
  void(@Auth() p: Principal, @Param('id') id: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const s = asStaff(p);
    const { reason } = parse(z.object({ reason: z.string().min(3).max(500) }), body);
    return this.tenancy.run(s, (tx) => this.svc.void(tx, s, meta, uuid(id), reason));
  }

  @Post('bills/:id/credit-notes')
  @Staff('bill:approve')
  credit(@Auth() p: Principal, @Param('id') id: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const s = asStaff(p);
    const b = parse(z.object({ amount: z.number().int().positive(), reason: z.string().min(3).max(500) }), body);
    return this.tenancy.run(s, (tx) => this.svc.creditNote(tx, s, meta, uuid(id), b.amount, b.reason));
  }

  @Get('bills/:id/invoice.pdf')
  @Staff('bill:view')
  async invoice(@Auth() p: Principal, @Param('id') id: string, @Query('kind') kind: string | undefined, @Meta() meta: RequestMeta, @Res() res: Response) {
    const html = await this.tenancy.run(p, async (tx) => {
      const h = await this.invoiceDoc(tx, uuid(id), kind === 'receipt' ? 'receipt' : 'invoice');
      await this.audit.record(tx, p, meta, { action: 'bill.print', entity: 'bill', entityId: id, patientId: h.patientId });
      return h.html;
    });
    res.setHeader('content-type', 'application/pdf').setHeader('cache-control', 'no-store').send(await renderPdf(html));
  }

  invoiceDoc(tx: Tx, id: string, kind: 'invoice' | 'receipt') {
    return invoiceDocument(tx, this.svc, this.patients, id, kind);
  }

  // ---- Refunds (FR-BIL-5)
  @Get('refunds')
  @Staff('refund:view')
  refunds(@Auth() p: Principal, @Query('status') status?: string) {
    return this.tenancy.run(p, (tx) =>
      tx.query(
        `select r.*, p.method as payment_method, p.receipt_number, pt.first_name_ar || ' ' || pt.family_name_ar as patient_name from refunds r join payments p on p.id = r.payment_id join patients pt on pt.id = r.patient_id
         where ($1::text is null or r.status = $1) order by r.created_at desc limit 300`,
        [status ?? null],
      ),
    );
  }

  @Post('refunds')
  @Staff('refund:create')
  requestRefund(@Auth() p: Principal, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const s = asStaff(p);
    return this.tenancy.run(s, (tx) => this.svc.requestRefund(tx, s, meta, parse(refundRequestSchema, body)));
  }

  @Post('refunds/:id/decision')
  @Staff('refund:approve')
  @HttpCode(200)
  decide(@Auth() p: Principal, @Param('id') id: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const s = asStaff(p);
    const { approve } = parse(z.object({ approve: z.boolean() }), body);
    return this.tenancy.run(s, (tx) => this.svc.approveRefund(tx, s, meta, uuid(id), approve));
  }

  @Post('refunds/:id/execute')
  @Staff('refund:create')
  @HttpCode(200)
  execute(@Auth() p: Principal, @Param('id') id: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const s = asStaff(p);
    const { reference } = parse(z.object({ reference: z.string().max(100).optional() }), body ?? {});
    return this.tenancy.run(s, (tx) => this.svc.executeRefund(tx, s, meta, uuid(id), reference));
  }

  // ---- Approvals (discounts, voids, shift variances)
  @Get('approvals')
  @Staff('bill:approve')
  approvals(@Auth() p: Principal, @Query('status') status = 'pending') {
    return this.tenancy.run(p, (tx) =>
      tx.query(`select a.*, u.name_ar as requested_by_name from approval_requests a join users u on u.id = a.requested_by where a.status = $1 order by a.created_at desc limit 200`, [status]),
    );
  }

  @Post('approvals/:id/decision')
  @Staff('bill:approve')
  @HttpCode(200)
  approval(@Auth() p: Principal, @Param('id') id: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const s = asStaff(p);
    const b = parse(z.object({ approve: z.boolean(), note: z.string().max(500).optional() }), body);
    return this.tenancy.run(s, async (tx) => {
      const a = await tx.maybeOne<{ id: string; kind: string; entity_id: string; requested_by: string; payload: { reason?: string } }>(`select * from approval_requests where id = $1 and status = 'pending' for update`, [uuid(id)]);
      if (!a) throw notFound('approval');
      if (a.requested_by === s.userId) throw forbidden('four_eyes_required');
      if (a.kind === 'shift_variance' && !s.privileges.has('shift:approve')) throw forbidden('missing_privilege');
      await tx.query(`update approval_requests set status = $2, decided_by = $3, decided_at = now(), note = $4 where id = $1`, [a.id, b.approve ? 'approved' : 'rejected', s.userId, b.note ?? null]);
      if (a.kind === 'void' && b.approve) await tx.query(`update bills set status = 'void', void_reason = $2 where id = $1 and status = 'issued' and paid = 0`, [a.entity_id, a.payload.reason ?? 'approved void']);
      if (a.kind === 'shift_variance') await tx.query(`update cashier_shifts set status = $2, approved_by = $3, approved_at = now() where id = $1 and status = 'pending_approval'`, [a.entity_id, b.approve ? 'approved' : 'pending_approval', s.userId]);
      if (a.kind === 'discount' && !b.approve) await tx.query(`update bills set status = 'void', void_reason = 'discount rejected' where id = $1 and status = 'draft'`, [a.entity_id]);
      await this.audit.record(tx, s, meta, { action: `approval.${a.kind}.${b.approve ? 'approve' : 'reject'}`, entity: 'approval_request', entityId: a.id, details: { entityId: a.entity_id } });
      return { ok: true };
    });
  }

  // ---- Cashier shifts (FR-BIL-6)
  @Get('shifts')
  @Staff('shift:view')
  shifts(@Auth() p: Principal, @Query('clinicId') clinicId?: string, @Query('mine') mine?: string) {
    const s = asStaff(p);
    return this.tenancy.run(s, (tx) =>
      tx.query(
        `select sh.*, u.name_ar as cashier_name from cashier_shifts sh join users u on u.id = sh.cashier_id
         where ($1::uuid is null or sh.clinic_id = $1) and ($2::uuid is null or sh.cashier_id = $2) order by sh.opened_at desc limit 100`,
        [clinicId ? uuid(clinicId) : null, mine === 'true' || !s.privileges.has('shift:approve') ? s.userId : null],
      ),
    );
  }

  @Get('shifts/current')
  @Staff('shift:view')
  current(@Auth() p: Principal, @Query('clinicId') clinicId: string) {
    const s = asStaff(p);
    return this.tenancy.run(s, (tx) => tx.maybeOne(`select * from cashier_shifts where cashier_id = $1 and clinic_id = $2 and status = 'open'`, [s.userId, uuid(clinicId)]));
  }

  @Post('shifts')
  @Staff('shift:create')
  open(@Auth() p: Principal, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const s = asStaff(p);
    const b = parse(openShiftSchema, body);
    if (!s.network && !s.clinicIds.includes(b.clinicId)) throw forbidden();
    return this.tenancy.run(s, async (tx) => {
      const r = await tx.one<{ id: string }>(`insert into cashier_shifts (organisation_id, clinic_id, cashier_id, opening_float) values (app_org(), $1,$2,$3) returning *`, [b.clinicId, s.userId, b.openingFloat]);
      await this.audit.record(tx, s, meta, { action: 'shift.open', entity: 'cashier_shift', entityId: r.id, clinicId: b.clinicId, details: { openingFloat: b.openingFloat } });
      return r;
    });
  }

  @Post('shifts/:id/close')
  @Staff('shift:edit')
  @HttpCode(200)
  close(@Auth() p: Principal, @Param('id') id: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const s = asStaff(p);
    const b = parse(closeShiftSchema, body);
    return this.tenancy.run(s, async (tx) => {
      const sh = await tx.maybeOne<{ id: string; cashier_id: string; clinic_id: string; opening_float: number; cash_in: number; cash_out: number; status: string }>('select * from cashier_shifts where id = $1 for update', [uuid(id)]);
      if (!sh) throw notFound('shift');
      if (sh.cashier_id !== s.userId) throw forbidden('not_your_shift');
      if (sh.status !== 'open') throw new DomainError('shift_not_open', HttpStatus.CONFLICT);
      let counted: number;
      try {
        counted = countCash(b.counts);
      } catch (e) {
        throw badRequest('invalid_counts', (e as Error).message);
      }
      const org = await tx.one<{ settings: { shiftVarianceThreshold?: number } }>('select settings from organisations where id = app_org()');
      const sum = summariseShift({ openingFloat: sh.opening_float, cashIn: sh.cash_in, cashOut: sh.cash_out, counted, varianceThreshold: org.settings.shiftVarianceThreshold ?? 1000 });
      const status = sum.needsApproval ? 'pending_approval' : 'closed';
      const r = await tx.one(
        `update cashier_shifts set status = $2, expected = $3, counted = $4, variance = $5, counts = $6, note = $7, closed_at = now() where id = $1 returning *`,
        [id, status, sum.expected, sum.counted, sum.variance, JSON.stringify(b.counts), b.note ?? null],
      );
      if (sum.needsApproval) {
        await tx.query(`insert into approval_requests (organisation_id, clinic_id, kind, entity_id, payload, requested_by) values (app_org(), $1, 'shift_variance', $2, $3, $4)`, [sh.clinic_id, id, JSON.stringify({ variance: sum.variance }), s.userId]);
        await tx.query(`insert into tasks (organisation_id, clinic_id, kind, title, entity_id, assignee_role) values (app_org(), $1, 'shift_variance', $2, $3, 'clinic_manager')`, [sh.clinic_id, `Shift variance ${sum.variance} piastres`, id]);
      }
      await this.audit.record(tx, s, meta, { action: 'shift.close', entity: 'cashier_shift', entityId: id, clinicId: sh.clinic_id, details: { ...sum } });
      return { ...r, summary: sum };
    });
  }

  @Get('shifts/:id/report.pdf')
  @Staff('shift:view')
  async report(@Auth() p: Principal, @Param('id') id: string, @Res() res: Response) {
    const s = asStaff(p);
    const html = await this.tenancy.run(s, async (tx) => {
      const sh = await tx.maybeOne<{ id: string; clinic_id: string; cashier_id: string; opened_at: Date; closed_at: Date | null; opening_float: number; cash_in: number; cash_out: number; expected: number; counted: number; variance: number; counts: Record<string, number>; approved_by: string | null }>(
        'select * from cashier_shifts where id = $1',
        [uuid(id)],
      );
      if (!sh) throw notFound('shift');
      if (sh.cashier_id !== s.userId && !s.privileges.has('shift:approve')) throw forbidden();
      if (!sh.closed_at) throw new DomainError('shift_not_closed', HttpStatus.CONFLICT);
      const cashier = await tx.one<{ name_ar: string }>('select name_ar from users where id = $1', [sh.cashier_id]);
      const approver = sh.approved_by ? await tx.one<{ name_ar: string }>('select name_ar from users where id = $1', [sh.approved_by]) : null;
      const pays = await tx.query<{ receipt_number: string; method: string; amount: number }>('select receipt_number, method, amount from payments where shift_id = $1 order by created_at', [id]);
      return shiftReportHtml({
        clinic: await clinicHeader(tx, sh.clinic_id), cashier: cashier.name_ar, openedAt: new Date(sh.opened_at), closedAt: new Date(sh.closed_at), openingFloat: sh.opening_float,
        cashIn: sh.cash_in, cashOut: sh.cash_out, expected: sh.expected, counted: sh.counted, variance: sh.variance, counts: sh.counts, payments: pays.map((x) => ({ receiptNumber: x.receipt_number, method: METHOD_LABEL[x.method] ?? x.method, amount: x.amount })), approvedBy: approver?.name_ar,
      });
    });
    res.setHeader('content-type', 'application/pdf').setHeader('cache-control', 'no-store').send(await renderPdf(html));
  }

  // ---- Packages & statements
  @Get('patients/:id/packages')
  @Staff('bill:view')
  packages(@Auth() p: Principal, @Param('id') id: string) {
    return this.tenancy.run(p, async (tx) => {
      await visiblePatient(tx, id);
      return tx.query(`select pb.*, pk.name_ar, pk.name_en from package_balances pb join packages pk on pk.id = pb.package_id where pb.patient_id = $1 order by pb.created_at desc`, [id]);
    });
  }

  /** FR-BIL-9 patient balance and statement. */
  @Get('patients/:id/statement')
  @Staff('bill:view')
  statement(@Auth() p: Principal, @Param('id') id: string) {
    return this.tenancy.run(p, async (tx) => {
      await visiblePatient(tx, id);
      const bills = await tx.query<{ total: number; credited: number; paid: number; refunded: number }>(`select id, number, status, total, credited, paid, refunded, issued_at from bills where patient_id = $1 and status not in ('draft','void') order by issued_at`, [uuid(id)]);
      const balance = bills.reduce((a, b) => a + (b.total - b.credited - (b.paid - b.refunded)), 0);
      return { bills, balance };
    });
  }

  @Get('reports/outstanding')
  @Staff('report:view')
  outstanding(@Auth() p: Principal, @Query('clinicId') clinicId?: string) {
    return this.tenancy.run(p, (tx) =>
      tx.query(
        `select b.id, b.number, b.clinic_id, b.patient_id, p.first_name_ar || ' ' || p.family_name_ar as patient_name, p.mrn, b.total - b.credited - (b.paid - b.refunded) as balance, b.issued_at
         from bills b join patients p on p.id = b.patient_id
         where b.status in ('issued','partially_paid') and ($1::uuid is null or b.clinic_id = $1) order by b.issued_at`,
        [clinicId ? uuid(clinicId) : null],
      ),
    );
  }
}

export async function invoiceDocument(tx: Tx, billing: BillingService, patients: PatientsService, id: string, kind: 'invoice' | 'receipt') {
  const b = await billing.get(tx, id);
  if (!b.number) throw new DomainError('bill_not_issued', HttpStatus.CONFLICT);
  const lines = await tx.query<{ description: string; qty: number; unit_price: number; discount: number; vat: number; total: number }>('select * from bill_lines where bill_id = $1 order by position', [id]);
  const payments = await tx.query<{ method: string; amount: number; receipt_number: string; created_at: Date }>(`select * from payments where bill_id = $1 and status = 'captured' order by created_at`, [id]);
  const pt = await tx.one<{ first_name_ar: string; father_name_ar: string; family_name_ar: string; mrn: string }>('select * from patients where id = $1', [b.patient_id]);
  const le = b.legal_entity_id ? await tx.one<{ name_ar: string; name_en: string; tax_registration_number: string | null; commercial_register: string | null }>('select * from legal_entities where id = $1', [b.legal_entity_id]) : null;
  const c = await tx.one<{ invoice_footer: string }>('select invoice_footer from clinics where id = $1', [b.clinic_id]);
  return {
    patientId: b.patient_id,
    html: invoiceHtml({
      kind, locale: 'ar', clinic: await clinicHeader(tx, b.clinic_id),
      legalEntity: { nameAr: le?.name_ar ?? '', nameEn: le?.name_en ?? '', taxRegistrationNumber: le?.tax_registration_number, commercialRegister: le?.commercial_register },
      number: b.number, issuedAt: new Date(), patient: { name: patients.fullName(pt), mrn: pt.mrn },
      lines: lines.map((l) => ({ description: l.description, qty: l.qty, unitPrice: l.unit_price, discount: l.discount, vat: l.vat, total: l.total })),
      totals: { subtotal: b.subtotal, discount: b.discount, vat: b.vat, total: b.total - b.credited, paid: b.paid - b.refunded, balance: b.total - b.credited - (b.paid - b.refunded) },
      payments: payments.map((x) => ({ method: METHOD_LABEL[x.method] ?? x.method, amount: x.amount, receiptNumber: x.receipt_number, at: new Date(x.created_at) })),
      footer: c.invoice_footer,
    }),
  };
}

