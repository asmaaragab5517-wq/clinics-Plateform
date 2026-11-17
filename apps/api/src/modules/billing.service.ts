import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { Tx } from '@hf/db';
import { billPaymentStatus, computeBill, discountPercent, formatMoney, localDate, type BillLine, type PaymentMethod, type VatStatus } from '@hf/shared';
import { DomainError, badRequest, conflict, forbidden, notFound } from '../common/errors';
import type { Principal, RequestMeta, StaffPrincipal } from '../common/principal';
import { AuditService } from '../common/services';
import { HEALTHPAY, type HealthPayClient } from '../integrations/healthpay';
import { AvailabilityService } from './availability.service';
import { MessagingService } from './messaging.service';
import type { SecretBox } from '@hf/db';
import { BOX } from '../common/services';
import { EtaService } from './eta';
import { splitCoverage } from '@hf/shared';

export interface BillRow {
  id: string; clinic_id: string; patient_id: string; appointment_id: string | null; status: string; number: string | null; total: number; paid: number; refunded: number; credited: number;
  subtotal: number; discount: number; vat: number; taxable_base: number; discount_approval_id: string | null; legal_entity_id: string | null; insurer_share: number;
}

@Injectable()
export class BillingService {
  constructor(
    private readonly availability: AvailabilityService,
    private readonly messaging: MessagingService,
    private readonly audit: AuditService,
    @Inject(HEALTHPAY) private readonly healthpay: HealthPayClient,
    @Inject(BOX) private readonly box: SecretBox,
    readonly eta: EtaService,
  ) {}

  async get(tx: Tx, id: string, lock = false): Promise<BillRow> {
    const b = await tx.maybeOne<BillRow>(`select * from bills where id = $1 ${lock ? 'for update' : ''}`, [id]);
    if (!b) throw notFound('bill');
    return b;
  }

  /** FR-BIL-1/2: lines priced from the clinic price list, VAT per service, totals in piastres. */
  async create(tx: Tx, actor: Principal, meta: RequestMeta | null, input: { clinicId: string; patientId: string; appointmentId?: string; encounterId?: string; lines: BillLine[]; coverageId?: string; approvalNumber?: string }) {
    const date = localDate(new Date());
    let doctorId: string | null = null;
    if (input.appointmentId) {
      const a = await tx.maybeOne<{ doctor_id: string; patient_id: string; clinic_id: string }>('select doctor_id, patient_id, clinic_id from appointments where id = $1', [input.appointmentId]);
      if (!a || a.patient_id !== input.patientId || a.clinic_id !== input.clinicId) throw badRequest('appointment_mismatch');
      doctorId = a.doctor_id;
    } else if (input.encounterId) {
      const e = await tx.maybeOne<{ doctor_id: string; patient_id: string }>('select doctor_id, patient_id from encounters where id = $1', [input.encounterId]);
      if (!e || e.patient_id !== input.patientId) throw badRequest('encounter_mismatch');
      doctorId = e.doctor_id;
    }
    const resolved: { description: string; serviceId: string | null; packageId: string | null; qty: number; unitPrice: number; vat: VatStatus; discount?: BillLine['discount'] }[] = [];
    for (const l of input.lines) {
      if (l.serviceId) {
        const s = await tx.maybeOne<{ name_ar: string; vat: VatStatus }>('select name_ar, vat from services where id = $1', [l.serviceId]);
        if (!s) throw badRequest('invalid_service');
        const price = await this.availability.price(tx, input.clinicId, l.serviceId, doctorId, date);
        if (price === null && l.unitPrice === undefined) throw badRequest('no_price_for_service', l.serviceId);
        // Manual price differing from the list price counts as a discount needing the same approval path.
        const unit = price ?? l.unitPrice!;
        resolved.push({ description: l.description ?? s.name_ar, serviceId: l.serviceId, packageId: null, qty: l.qty, unitPrice: unit, vat: s.vat, discount: l.discount });
      } else if (l.packageId) {
        const pk = await tx.maybeOne<{ name_ar: string; price: number; vat: VatStatus }>('select p.name_ar, p.price, s.vat from packages p join services s on s.id = p.service_id where p.id = $1 and p.is_active', [l.packageId]);
        if (!pk) throw badRequest('invalid_package');
        resolved.push({ description: pk.name_ar, serviceId: null, packageId: l.packageId, qty: l.qty, unitPrice: pk.price, vat: pk.vat, discount: l.discount });
      } else {
        if (!l.description || l.unitPrice === undefined) throw badRequest('consumable_requires_description_and_price');
        resolved.push({ description: l.description, serviceId: null, packageId: null, qty: l.qty, unitPrice: l.unitPrice, vat: l.vat ?? 'taxable', discount: l.discount });
      }
    }
    const totals = computeBill(resolved.map((r) => ({ qty: r.qty, unitPrice: r.unitPrice, vat: r.vat, discount: r.discount })));
    // FR-BIL-11: insurer / patient split from the patient's active coverage.
    let insurerShare = 0;
    if (input.coverageId) {
      const cov = await tx.maybeOne<{ coverage_percent: number; copay_fixed: number; type_overrides: Record<string, number>; excluded_service_ids: string[]; requires_approval: boolean }>(
        `select pp.coverage_percent, pp.copay_fixed, pp.type_overrides, pp.excluded_service_ids, pp.requires_approval from patient_coverages pc join payer_plans pp on pp.id = pc.plan_id
         join payers py on py.id = pp.payer_id
         where pc.id = $1 and pc.patient_id = $2 and pc.is_active and pp.is_active and py.is_active and pc.valid_from <= $3::date and (pc.valid_to is null or pc.valid_to >= $3::date)`,
        [input.coverageId, input.patientId, date],
      );
      if (!cov) throw badRequest('coverage_not_valid');
      if (cov.requires_approval && !input.approvalNumber) throw badRequest('approval_number_required');
      const types = new Map((await tx.query<{ id: string; type: string }>('select id, type from services where id = any($1::uuid[])', [resolved.map((r) => r.serviceId).filter(Boolean)])).map((s) => [s.id, s.type]));
      insurerShare = splitCoverage(
        { coveragePercent: Number(cov.coverage_percent), copayFixed: cov.copay_fixed, typeOverrides: cov.type_overrides, excludedServiceIds: cov.excluded_service_ids },
        resolved.map((r, i) => ({ serviceId: r.serviceId, serviceType: r.serviceId ? (types.get(r.serviceId) ?? null) : null, total: totals.lines[i]!.total })),
      ).insurer;
    }
    const org = await tx.one<{ settings: { discountApprovalPercent?: number } }>('select settings from organisations where id = app_org()');
    const threshold = org.settings.discountApprovalPercent ?? 20;
    const needsApproval = discountPercent(totals) > threshold && !(actor.kind === 'staff' && actor.privileges.has('bill:approve'));
    const le = await tx.one<{ legal_entity_id: string | null }>('select legal_entity_id from clinics where id = $1', [input.clinicId]);
    const actorId = actor.kind === 'staff' ? actor.userId : null;
    const bill = await tx.one<BillRow>(
      `insert into bills (organisation_id, clinic_id, legal_entity_id, patient_id, appointment_id, encounter_id, subtotal, discount, taxable_base, vat, total, created_by, coverage_id, approval_number, insurer_share)
       values (app_org(), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning *`,
      [input.clinicId, le.legal_entity_id, input.patientId, input.appointmentId ?? null, input.encounterId ?? null, totals.subtotal, totals.discount, totals.taxableBase, totals.vat, totals.total, actorId, input.coverageId ?? null, input.approvalNumber ?? null, insurerShare],
    );
    for (const [i, r] of resolved.entries()) {
      const t = totals.lines[i]!;
      await tx.query(
        `insert into bill_lines (organisation_id, bill_id, position, service_id, package_id, description, qty, unit_price, discount_type, discount_value, vat_status, gross, discount, net, vat, total, doctor_id)
         values (app_org(), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [bill.id, i, r.serviceId, r.packageId, r.description, r.qty, r.unitPrice, r.discount?.type ?? null, r.discount?.value ?? null, r.vat, t.gross, t.discount, t.net, t.vat, t.total, doctorId],
      );
    }
    if (needsApproval) {
      const ap = await tx.one<{ id: string }>(
        `insert into approval_requests (organisation_id, clinic_id, kind, entity_id, payload, requested_by) values (app_org(), $1, 'discount', $2, $3, $4) returning id`,
        [input.clinicId, bill.id, JSON.stringify({ discountPercent: discountPercent(totals), discount: totals.discount }), actorId],
      );
      await tx.query('update bills set discount_approval_id = $2 where id = $1', [bill.id, ap.id]);
      bill.discount_approval_id = ap.id;
    }
    await this.audit.record(tx, actor, meta, { action: 'bill.create', entity: 'bill', entityId: bill.id, patientId: input.patientId, clinicId: input.clinicId, details: { total: totals.total, needsApproval } });
    return { ...bill, needsApproval };
  }

  async issue(tx: Tx, actor: Principal, meta: RequestMeta | null, id: string) {
    const b = await this.get(tx, id, true);
    if (b.status !== 'draft') throw new DomainError('bill_not_draft', HttpStatus.CONFLICT);
    if (b.discount_approval_id) {
      const ap = await tx.one<{ status: string }>('select status from approval_requests where id = $1', [b.discount_approval_id]);
      if (ap.status !== 'approved') throw new DomainError('discount_approval_pending', HttpStatus.CONFLICT);
    }
    const c = await tx.one<{ receipt_prefix: string }>('select receipt_prefix from clinics where id = $1', [b.clinic_id]);
    const n = await tx.one<{ n: number }>('select next_number($1) as n', [`invoice:${b.clinic_id}`]);
    const number = `${c.receipt_prefix}-INV-${String(n.n).padStart(6, '0')}`;
    const r = await tx.one<BillRow>(`update bills set status = case when total = 0 then 'paid' else 'issued' end, number = $2, issued_at = now() where id = $1 returning *`, [id, number]);
    await this.audit.record(tx, actor, meta, { action: 'bill.issue', entity: 'bill', entityId: id, patientId: b.patient_id, clinicId: b.clinic_id, details: { number } });
    return r;
  }

  async openShift(tx: Tx, cashierId: string, clinicId: string) {
    return tx.maybeOne<{ id: string }>(`select id from cashier_shifts where cashier_id = $1 and clinic_id = $2 and status = 'open'`, [cashierId, clinicId]);
  }

  /** FR-BIL-4 payments. Cash requires the cashier's open shift (FR-BIL-6). */
  async pay(tx: Tx, actor: StaffPrincipal | null, meta: RequestMeta | null, billId: string, p: { method: PaymentMethod | 'insurance'; amount: number; reference?: string; cardLast4?: string; packageBalanceId?: string; providerTransactionId?: string; idempotencyKey?: string }) {
    const b = await this.get(tx, billId, true);
    if (p.idempotencyKey) {
      const prior = await tx.maybeOne<{ id: string; amount: number; receipt_number: string; bill_id: string }>('select * from payments where idempotency_key = $1', [p.idempotencyKey]);
      if (prior) {
        if (prior.bill_id !== billId) throw badRequest('idempotency_key_reused');
        return { ...prior, billStatus: b.status as ReturnType<typeof billPaymentStatus>, replayed: true };
      }
    }
    if (!['issued', 'partially_paid'].includes(b.status)) throw new DomainError('bill_not_payable', HttpStatus.CONFLICT);
    const balance = b.total - b.credited - (b.paid - b.refunded);
    if (p.amount > balance) throw new DomainError('amount_exceeds_balance', HttpStatus.UNPROCESSABLE_ENTITY, { balance });
    if (b.insurer_share > 0 && p.method !== 'insurance') {
      // The patient pays only their share; the insurer share is settled through claims.
      const patientPaid = (await tx.one<{ s: number }>(`select coalesce(sum(amount - refunded), 0)::int as s from payments where bill_id = $1 and method <> 'insurance' and status = 'captured'`, [b.id])).s;
      const patientDue = b.total - b.credited - b.insurer_share - patientPaid;
      if (p.amount > patientDue) throw new DomainError('amount_exceeds_patient_share', HttpStatus.UNPROCESSABLE_ENTITY, { patientDue });
    }
    let shiftId: string | null = null;
    if (p.method === 'cash') {
      if (!actor) throw forbidden();
      const shift = await this.openShift(tx, actor.userId, b.clinic_id);
      if (!shift) throw new DomainError('no_open_shift', HttpStatus.CONFLICT);
      shiftId = shift.id;
      await tx.query('update cashier_shifts set cash_in = cash_in + $2 where id = $1', [shift.id, p.amount]);
    }
    if (p.method === 'card_at_clinic' && !p.reference) throw badRequest('pos_reference_required');
    if (p.method === 'bank_transfer' && !p.reference) throw badRequest('transfer_reference_required');
    if (p.method === 'package_balance') {
      if (!p.packageBalanceId) throw badRequest('package_balance_required');
      const pb = await tx.maybeOne<{ id: string; patient_id: string; sessions_used: number; sessions_total: number; expires_on: string; family_shareable: boolean }>(
        `select pb.*, pk.family_shareable from package_balances pb join packages pk on pk.id = pb.package_id where pb.id = $1 for update of pb`,
        [p.packageBalanceId],
      );
      if (!pb || pb.sessions_used >= pb.sessions_total || pb.expires_on < localDate(new Date())) throw new DomainError('package_balance_unavailable', HttpStatus.CONFLICT);
      if (pb.patient_id !== b.patient_id && !pb.family_shareable) throw forbidden('package_not_shareable');
      await tx.query('update package_balances set sessions_used = sessions_used + 1 where id = $1', [pb.id]);
      await tx.query('insert into package_consumptions (organisation_id, package_balance_id, appointment_id, patient_id, created_by) values (app_org(), $1,$2,$3,$4)', [pb.id, b.appointment_id, b.patient_id, actor?.userId ?? null]);
    }
    if (p.method === 'healthpay' && !p.providerTransactionId) throw badRequest('healthpay_payments_come_from_webhook');
    const c = await tx.one<{ receipt_prefix: string }>('select receipt_prefix from clinics where id = $1', [b.clinic_id]);
    const n = await tx.one<{ n: number }>('select next_number($1) as n', [`receipt:${b.clinic_id}`]);
    const receipt = `${c.receipt_prefix}-${String(n.n).padStart(7, '0')}`;
    const pay = await tx.one<{ id: string; amount: number; receipt_number: string }>(
      `insert into payments (organisation_id, clinic_id, bill_id, patient_id, shift_id, method, amount, reference, card_last4, package_balance_id, receipt_number, provider_transaction_id, created_by, idempotency_key)
       values (app_org(), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning *`,
      [b.clinic_id, b.id, b.patient_id, shiftId, p.method, p.amount, p.reference ?? null, p.cardLast4 ?? null, p.packageBalanceId ?? null, receipt, p.providerTransactionId ?? null, actor?.userId ?? null, p.idempotencyKey ?? null],
    );
    const paid = b.paid + p.amount;
    const status = billPaymentStatus(b.total - b.credited, paid, b.refunded);
    await tx.query('update bills set paid = $2, status = $3 where id = $1', [b.id, paid, status]);
    if (status === 'paid') {
      await this.activatePackages(tx, b.id, b.patient_id);
      await this.eta.enqueue(tx, b.id); // FR-BIL-10 B2C e-receipt
    }
    await this.messaging.enqueue(tx, { event: 'payment_received', patientId: b.patient_id, clinicId: b.clinic_id, dedupeKey: `pay:${pay.id}`, data: { path: '/invoices' }, vars: { amount: formatMoney(p.amount, 'ar'), receipt } });
    await this.audit.record(tx, actor, meta, { action: 'payment.create', entity: 'payment', entityId: pay.id, patientId: b.patient_id, clinicId: b.clinic_id, details: { method: p.method, amount: p.amount } });
    return { ...pay, billStatus: status };
  }

  /** FR-BIL-7: purchasing a package creates its session balance once fully paid. */
  private async activatePackages(tx: Tx, billId: string, patientId: string) {
    const lines = await tx.query<{ package_id: string; qty: number; sessions: number; validity_days: number }>(
      `select l.package_id, l.qty, p.sessions, p.validity_days from bill_lines l join packages p on p.id = l.package_id where l.bill_id = $1`,
      [billId],
    );
    for (const l of lines) {
      const exists = await tx.maybeOne('select 1 from package_balances where bill_id = $1 and package_id = $2', [billId, l.package_id]);
      if (exists) continue;
      for (let i = 0; i < l.qty; i++) {
        await tx.query(`insert into package_balances (organisation_id, package_id, patient_id, bill_id, sessions_total, expires_on) values (app_org(), $1,$2,$3,$4, current_date + $5::int)`, [l.package_id, patientId, billId, l.sessions, l.validity_days]);
      }
    }
  }

  async requestRefund(tx: Tx, actor: StaffPrincipal | null, meta: RequestMeta | null, input: { paymentId: string; amount: number; reason: string }) {
    const p = await tx.maybeOne<{ id: string; amount: number; refunded: number; clinic_id: string; patient_id: string; method: string }>('select * from payments where id = $1 for update', [input.paymentId]);
    if (!p) throw notFound('payment');
    const pending = await tx.one<{ s: number }>(`select coalesce(sum(amount), 0)::int as s from refunds where payment_id = $1 and status in ('requested','approved','processing')`, [p.id]);
    if (input.amount > p.amount - p.refunded - pending.s) throw new DomainError('refund_exceeds_payment', HttpStatus.UNPROCESSABLE_ENTITY);
    const r = await tx.one<{ id: string }>(
      `insert into refunds (organisation_id, clinic_id, payment_id, patient_id, amount, reason, requested_by, method) values (app_org(), $1,$2,$3,$4,$5,$6,$7) returning *`,
      [p.clinic_id, p.id, p.patient_id, input.amount, input.reason, actor?.userId ?? null, p.method],
    );
    await this.audit.record(tx, actor, meta, { action: 'refund.request', entity: 'refund', entityId: r.id, patientId: p.patient_id, clinicId: p.clinic_id, details: { amount: input.amount } });
    return r;
  }

  /** FR-BIL-5: approval by Accountant/Manager. HealthPay refunds execute via API immediately. */
  async approveRefund(tx: Tx, actor: StaffPrincipal, meta: RequestMeta | null, refundId: string, approve: boolean) {
    const r = await tx.maybeOne<{ id: string; status: string; payment_id: string; amount: number; requested_by: string | null; clinic_id: string; patient_id: string }>('select * from refunds where id = $1 for update', [refundId]);
    if (!r) throw notFound('refund');
    if (r.status !== 'requested') throw new DomainError('refund_not_pending', HttpStatus.CONFLICT);
    if (r.requested_by === actor.userId) throw forbidden('four_eyes_required');
    if (!approve) {
      await tx.query(`update refunds set status = 'rejected', approved_by = $2 where id = $1`, [r.id, actor.userId]);
      await this.audit.record(tx, actor, meta, { action: 'refund.reject', entity: 'refund', entityId: r.id, patientId: r.patient_id });
      return { status: 'rejected' };
    }
    await tx.query(`update refunds set status = 'approved', approved_by = $2 where id = $1`, [r.id, actor.userId]);
    const pay = await tx.one<{ method: string; provider_transaction_id: string | null; bill_id: string; clinic_id: string }>('select * from payments where id = $1', [r.payment_id]);
    if (pay.method === 'healthpay') {
      const merchant = await this.merchantFor(tx, pay.clinic_id);
      const out = await this.healthpay.refund({ merchant, providerTransactionId: pay.provider_transaction_id!, amount: r.amount, idempotencyKey: `refund:${r.id}` });
      await tx.query(`update refunds set status = $2, provider_refund_id = $3 where id = $1`, [r.id, out.status === 'completed' ? 'processing' : 'processing', out.refundId]);
      if (out.status === 'completed') await this.completeRefund(tx, r.id);
    }
    await this.audit.record(tx, actor, meta, { action: 'refund.approve', entity: 'refund', entityId: r.id, patientId: r.patient_id, clinicId: r.clinic_id });
    return tx.one('select * from refunds where id = $1', [r.id]);
  }

  /** Cash/card refunds are executed by the cashier from their open shift. */
  async executeRefund(tx: Tx, actor: StaffPrincipal, meta: RequestMeta | null, refundId: string, reference?: string) {
    const r = await tx.maybeOne<{ id: string; status: string; payment_id: string; amount: number; clinic_id: string; patient_id: string }>('select * from refunds where id = $1 for update', [refundId]);
    if (!r) throw notFound('refund');
    if (r.status !== 'approved') throw new DomainError('refund_not_approved', HttpStatus.CONFLICT);
    const pay = await tx.one<{ method: string }>('select method from payments where id = $1', [r.payment_id]);
    if (pay.method === 'healthpay') throw new DomainError('healthpay_refund_is_automatic', HttpStatus.CONFLICT);
    if (pay.method === 'cash') {
      const shift = await this.openShift(tx, actor.userId, r.clinic_id);
      if (!shift) throw new DomainError('no_open_shift', HttpStatus.CONFLICT);
      await tx.query('update cashier_shifts set cash_out = cash_out + $2 where id = $1', [shift.id, r.amount]);
      await tx.query('update refunds set shift_id = $2 where id = $1', [r.id, shift.id]);
    } else if (!reference) throw badRequest('reference_required');
    await tx.query('update refunds set reference = $2 where id = $1', [r.id, reference ?? null]);
    await this.completeRefund(tx, r.id);
    await this.audit.record(tx, actor, meta, { action: 'refund.execute', entity: 'refund', entityId: r.id, patientId: r.patient_id, clinicId: r.clinic_id });
    return tx.one('select * from refunds where id = $1', [r.id]);
  }

  async completeRefund(tx: Tx, refundId: string) {
    const r = await tx.one<{ payment_id: string; amount: number; status: string }>(`update refunds set status = 'completed', completed_at = now() where id = $1 and status <> 'completed' returning payment_id, amount, status`, [refundId]).catch(() => null);
    if (!r) return;
    const pay = await tx.one<{ bill_id: string }>('update payments set refunded = refunded + $2 where id = $1 returning bill_id', [r.payment_id, r.amount]);
    const b = await tx.one<BillRow>('update bills set refunded = refunded + $2 where id = $1 returning *', [pay.bill_id, r.amount]);
    await tx.query('update bills set status = $2 where id = $1', [b.id, billPaymentStatus(b.total - b.credited, b.paid, b.refunded)]);
  }

  async merchantFor(tx: Tx, clinicId: string): Promise<{ apiKey: string; merchantId: string } | null> {
    const le = await tx.maybeOne<{ id: string; healthpay_config_enc: Buffer | null }>('select le.id, le.healthpay_config_enc from clinics c join legal_entities le on le.id = c.legal_entity_id where c.id = $1', [clinicId]);
    if (!le?.healthpay_config_enc) return null;
    return JSON.parse(this.box.decrypt(le.healthpay_config_enc, `healthpay:${le.id}`));
  }

  /** Cancel a draft immediately; voiding an issued, unpaid bill needs approval (FR-BIL-3). */
  async void(tx: Tx, actor: StaffPrincipal, meta: RequestMeta | null, id: string, reason: string) {
    const b = await this.get(tx, id, true);
    if (b.status === 'draft' || (b.status === 'issued' && b.paid === 0 && actor.privileges.has('bill:approve'))) {
      await tx.query(`update bills set status = 'void', void_reason = $2 where id = $1`, [id, reason]);
      await this.audit.record(tx, actor, meta, { action: 'bill.void', entity: 'bill', entityId: id, patientId: b.patient_id, clinicId: b.clinic_id, reason });
      return { status: 'void' };
    }
    if (b.status !== 'issued' || b.paid > 0) throw new DomainError('bill_not_voidable', HttpStatus.CONFLICT);
    const existing = await tx.maybeOne(`select id from approval_requests where kind = 'void' and entity_id = $1 and status = 'pending'`, [id]);
    if (existing) throw conflict('void_already_requested');
    const ap = await tx.one(`insert into approval_requests (organisation_id, clinic_id, kind, entity_id, payload, requested_by) values (app_org(), $1, 'void', $2, $3, $4) returning *`, [b.clinic_id, id, JSON.stringify({ reason }), actor.userId]);
    await this.audit.record(tx, actor, meta, { action: 'bill.void_requested', entity: 'bill', entityId: id, reason });
    return { status: 'pending_approval', approval: ap };
  }

  async creditNote(tx: Tx, actor: StaffPrincipal, meta: RequestMeta | null, id: string, amount: number, reason: string) {
    const b = await this.get(tx, id, true);
    if (!['issued', 'partially_paid', 'paid'].includes(b.status)) throw new DomainError('bill_not_issued', HttpStatus.CONFLICT);
    if (amount > b.total - b.credited) throw new DomainError('credit_exceeds_total', HttpStatus.UNPROCESSABLE_ENTITY);
    const c = await tx.one<{ receipt_prefix: string }>('select receipt_prefix from clinics where id = $1', [b.clinic_id]);
    const n = await tx.one<{ n: number }>('select next_number($1) as n', [`credit:${b.clinic_id}`]);
    const cn = await tx.one(
      `insert into credit_notes (organisation_id, clinic_id, bill_id, patient_id, number, amount, reason, created_by) values (app_org(), $1,$2,$3,$4,$5,$6,$7) returning *`,
      [b.clinic_id, id, b.patient_id, `${c.receipt_prefix}-CN-${String(n.n).padStart(6, '0')}`, amount, reason, actor.userId],
    );
    const credited = b.credited + amount;
    await tx.query('update bills set credited = $2, status = $3 where id = $1', [id, credited, billPaymentStatus(b.total - credited, b.paid, b.refunded)]);
    await this.audit.record(tx, actor, meta, { action: 'bill.credit_note', entity: 'bill', entityId: id, patientId: b.patient_id, clinicId: b.clinic_id, reason, details: { amount } });
    return cn;
  }
}
