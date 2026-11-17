import { Body, Controller, Get, HttpCode, Inject, Injectable, Logger, Param, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Tx } from '@hf/db';
import { addDays, localDate, zonedToUtc } from '@hf/shared';
import { Public, Webhook } from '../common/decorators';
import { forbidden, notFound } from '../common/errors';
import { AuditService, Tenancy } from '../common/services';
import { CONFIG, type Config } from '../config';
import { FakeHealthPayClient, HEALTHPAY, signHealthPayPayload, verifyHealthPaySignature, type HealthPayClient, type WebhookEvent } from '../integrations/healthpay';
import { AppointmentsService, type ApptRow } from './appointments.service';
import { AvailabilityService } from './availability.service';
import { BillingService } from './billing.service';

@Injectable()
export class PaymentsService {
  private readonly log = new Logger('Payments');
  constructor(
    private readonly tenancy: Tenancy,
    private readonly billing: BillingService,
    private readonly appointments: AppointmentsService,
    private readonly availability: AvailabilityService,
    private readonly audit: AuditService,
    @Inject(HEALTHPAY) private readonly healthpay: HealthPayClient,
    @Inject(CONFIG) private readonly cfg: Config,
  ) {}

  /** Deposit amount for an online booking: sum of service prices × deposit % (BR-9). */
  async depositFor(tx: Tx, a: ApptRow): Promise<number> {
    const policy = await this.appointments.policy(tx);
    const services = await tx.query<{ service_id: string }>('select service_id from appointment_services where appointment_id = $1', [a.id]);
    let total = 0;
    for (const s of services) total += (await this.availability.price(tx, a.clinic_id, s.service_id, a.doctor_id, localDate(new Date(a.start_at)))) ?? 0;
    return Math.round((total * policy.depositPercent) / 100);
  }

  /** FR-HP-2 step 1: create a payment intent with idempotency key and hosted checkout. */
  async createIntent(tx: Tx, a: ApptRow, phone: string) {
    const existing = await tx.maybeOne<{ id: string; checkout_url: string; amount: number; status: string }>(`select * from payment_intents where appointment_id = $1 and status in ('created','pending')`, [a.id]);
    if (existing) return existing;
    const amount = await this.depositFor(tx, a);
    const le = await tx.one<{ legal_entity_id: string | null }>('select legal_entity_id from clinics where id = $1', [a.clinic_id]);
    const intent = await tx.one<{ id: string }>(
      `insert into payment_intents (organisation_id, clinic_id, legal_entity_id, appointment_id, patient_id, amount, idempotency_key) values (app_org(), $1,$2,$3,$4,$5,$6) returning id`,
      [a.clinic_id, le.legal_entity_id, a.id, a.patient_id, amount, `appt:${a.id}`],
    );
    const merchant = await this.billing.merchantFor(tx, a.clinic_id);
    const out = await this.healthpay.createCheckout({
      merchant, orderId: intent.id, amount, description: `Appointment ${a.ref}`, customerPhone: phone,
      returnUrl: `${this.cfg.PUBLIC_SITE_URL}/ar/book/result?ref=${a.ref}&appointment=${a.id}`, idempotencyKey: `intent:${intent.id}`,
    });
    return tx.one<{ id: string; checkout_url: string; amount: number; status: string }>(
      `update payment_intents set provider_order_id = $2, checkout_url = $3, status = 'pending' where id = $1 returning id, checkout_url, amount, status`,
      [intent.id, out.providerOrderId, out.checkoutUrl],
    );
  }

  /** FR-HP-3: idempotent, out-of-order tolerant webhook processing. The webhook is the source of truth. */
  async handleWebhook(evt: WebhookEvent): Promise<'processed' | 'duplicate' | 'ignored'> {
    const orgRow = (await this.tenancy.db.raw<{ organisation_id: string }>('select organisation_id from payment_intent_org($1)', [evt.orderId]))[0];
    if (!orgRow) {
      // Platform subscription invoices use the invoice id as the order reference (BR-20 billing via HealthPay).
      if (evt.type === 'payment.captured') {
        const paid = (await this.tenancy.db.raw<{ platform_invoice_paid: string | null }>('select platform_invoice_paid($1)', [evt.orderId]).catch(() => []))[0];
        if (paid?.platform_invoice_paid) return 'processed';
      }
      this.log.warn(`webhook for unknown intent`);
      return 'ignored';
    }
    return this.tenancy.system(orgRow.organisation_id, async (tx) => {
      const ins = await tx.maybeOne(
        `insert into provider_transactions (organisation_id, provider, provider_transaction_id, event_type, payload) values (app_org(), 'healthpay', $1, $2, $3)
         on conflict (provider, provider_transaction_id, event_type) do nothing returning id`,
        [evt.id, evt.type, JSON.stringify(evt)],
      );
      if (!ins) return 'duplicate' as const;
      const intent = await tx.one<{ id: string; appointment_id: string | null; patient_id: string; clinic_id: string; amount: number; status: string; bill_id: string | null }>('select * from payment_intents where id = $1 for update', [evt.orderId]);
      if (evt.type === 'payment.failed') {
        if (intent.status !== 'captured') await tx.query(`update payment_intents set status = 'failed' where id = $1`, [intent.id]);
      } else if (evt.type === 'payment.captured') {
        if (intent.status === 'captured') return 'duplicate' as const;
        if (evt.amount !== intent.amount) this.log.warn(`amount mismatch on intent ${intent.id}`);
        await tx.query(`update payment_intents set status = 'captured' where id = $1`, [intent.id]);
        await this.capture(tx, intent, evt);
      } else if (evt.type === 'refund.completed' && evt.refundId) {
        const r = await tx.maybeOne<{ id: string }>(`select id from refunds where provider_refund_id = $1`, [evt.refundId]);
        if (r) await this.billing.completeRefund(tx, r.id);
      } else if (evt.type === 'refund.failed' && evt.refundId) {
        await tx.query(`update refunds set status = 'failed' where provider_refund_id = $1 and status = 'processing'`, [evt.refundId]);
      }
      await tx.query('update provider_transactions set processed_at = now() where provider_transaction_id = $1 and event_type = $2', [evt.id, evt.type]);
      await this.audit.record(tx, null, null, { action: `healthpay.${evt.type}`, entity: 'payment_intent', entityId: intent.id, patientId: intent.patient_id, clinicId: intent.clinic_id });
      return 'processed' as const;
    });
  }

  private async capture(tx: Tx, intent: { id: string; appointment_id: string | null; patient_id: string; clinic_id: string; amount: number }, evt: WebhookEvent) {
    if (!intent.appointment_id) return;
    const a = await this.appointments.get(tx, intent.appointment_id);
    let slotKept = a.status === 'requested' || a.status === 'booked' || a.status === 'confirmed';
    if (a.status === 'requested') await this.appointments.transition(tx, null, null, a.id, 'booked');
    else if (a.status === 'cancelled') {
      // Hold expired before the webhook arrived: re-take the slot if still free, otherwise refund.
      await tx.query('savepoint revive');
      try {
        await tx.query(`update appointments set status = 'booked', cancel_reason = null, cancelled_by = null where id = $1`, [a.id]);
        await tx.query('release savepoint revive');
        await this.appointments.notifyBooked(tx, { ...a, status: 'booked' });
        slotKept = true;
      } catch (e) {
        await tx.query('rollback to savepoint revive');
        if ((e as { code?: string }).code !== '23P01') throw e;
      }
    }
    const services = await tx.query<{ service_id: string }>('select service_id from appointment_services where appointment_id = $1', [a.id]);
    const bill = await this.billing.create(tx, { kind: 'public', orgId: tx.ctx.orgId }, null, {
      clinicId: a.clinic_id, patientId: a.patient_id, appointmentId: a.id, lines: services.map((s) => ({ serviceId: s.service_id, qty: 1 })),
    });
    await this.billing.issue(tx, { kind: 'public', orgId: tx.ctx.orgId }, null, bill.id);
    const fresh = await this.billing.get(tx, bill.id);
    const amount = Math.min(evt.amount, fresh.total - fresh.paid);
    const pay = amount > 0 ? await this.billing.pay(tx, null, null, bill.id, { method: 'healthpay', amount, providerTransactionId: evt.id, reference: evt.providerOrderId }) : null;
    await tx.query('update payment_intents set bill_id = $2 where id = $1', [intent.id, bill.id]);
    if (!slotKept && pay) {
      await this.billing.requestRefund(tx, null, null, { paymentId: pay.id, amount, reason: 'slot_lost_after_hold_expiry' });
    }
  }

  /** FR-HP-5: provider transactions vs captured payments per clinic and day. */
  async reconcile(orgId: string, date: string) {
    return this.tenancy.system(orgId, async (tx) => {
      const clinics = await tx.query<{ id: string }>('select id from clinics where legal_entity_id is not null');
      const runs = [];
      for (const c of clinics) {
        const merchant = await this.billing.merchantFor(tx, c.id);
        const provider = (await this.healthpay.listTransactions({ merchant, date })).filter((t) => t.status === 'captured');
        const captured = await tx.query<{ provider_transaction_id: string; amount: number; intent_id: string | null }>(
          `select p.provider_transaction_id, p.amount, i.id as intent_id from payments p left join payment_intents i on i.bill_id = p.bill_id
           where p.clinic_id = $1 and p.method = 'healthpay' and p.status = 'captured' and p.created_at >= $2 and p.created_at < $3`,
          [c.id, zonedToUtc(date, '00:00'), zonedToUtc(addDays(date, 1), '00:00')],
        );
        const intents = new Set(captured.map((x) => x.intent_id));
        const mine = provider.filter((t) => intents.has(t.orderId) || captured.some((x) => x.provider_transaction_id === t.providerTransactionId));
        const mismatches = [
          ...captured.filter((x) => !provider.some((t) => t.providerTransactionId === x.provider_transaction_id && t.amount === x.amount)).map((x) => ({ kind: 'missing_at_provider', txn: x.provider_transaction_id, amount: x.amount })),
          ...mine.filter((t) => !captured.some((x) => x.provider_transaction_id === t.providerTransactionId)).map((t) => ({ kind: 'missing_locally', txn: t.providerTransactionId, amount: t.amount })),
        ];
        runs.push(
          await tx.one(
            `insert into reconciliation_runs (organisation_id, clinic_id, run_date, provider_total, captured_total, mismatches) values (app_org(), $1,$2,$3,$4,$5) returning *`,
            [c.id, date, mine.reduce((a, t) => a + t.amount, 0), captured.reduce((a, x) => a + x.amount, 0), JSON.stringify(mismatches)],
          ),
        );
      }
      return runs;
    });
  }

  /** FR-APT-3: unpaid holds expire after the hold window and release the slot. */
  async expireHolds(orgId: string) {
    return this.tenancy.system(orgId, async (tx) => {
      const rows = await tx.query<{ id: string }>(`select id from appointments where status = 'requested' and hold_expires_at < now() for update skip locked limit 200`);
      for (const r of rows) await this.appointments.transition(tx, null, null, r.id, 'cancelled', { reason: 'hold_expired', cancelledBy: 'clinic' });
      return rows.length;
    });
  }
}

@Controller('v1')
export class PaymentsController {
  private readonly log = new Logger('HealthPayWebhook');
  constructor(
    private readonly svc: PaymentsService,
    private readonly tenancy: Tenancy,
    @Inject(HEALTHPAY) private readonly healthpay: HealthPayClient,
    @Inject(CONFIG) private readonly cfg: Config,
  ) {}

  /** Signed webhook (SEC-7). Responds 2xx only after durable processing so the provider retries failures. */
  @Post('webhooks/healthpay')
  @Webhook()
  @HttpCode(200)
  async webhook(@Req() req: Request & { rawBody?: Buffer }) {
    const raw = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
    if (!verifyHealthPaySignature(this.cfg.HEALTHPAY_WEBHOOK_SECRET, req.headers['x-healthpay-signature'] as string | undefined, raw)) throw forbidden('invalid_signature');
    const evt = JSON.parse(raw.toString('utf8')) as WebhookEvent;
    const result = await this.svc.handleWebhook(evt);
    return { result };
  }

  /** Development checkout page that simulates HealthPay and posts a signed webhook back. */
  @Get('dev/healthpay/checkout/:providerOrderId')
  @Public()
  async devCheckout(@Param('providerOrderId') id: string, @Res() res: Response) {
    if (this.cfg.isProd || !(this.healthpay instanceof FakeHealthPayClient)) throw notFound();
    const s = this.healthpay.sessions.get(id);
    if (!s) throw notFound('checkout');
    res.setHeader('content-type', 'text/html; charset=utf-8').send(`<!doctype html><html dir="rtl"><body style="font-family:sans-serif;padding:2rem">
      <h1>HealthPay (sandbox)</h1><p>المبلغ: ${(s.amount / 100).toFixed(2)} ج.م</p>
      <form method="post" action="${this.cfg.API_PUBLIC_URL}/v1/dev/healthpay/checkout/${id}/pay"><button name="outcome" value="captured">ادفع</button> <button name="outcome" value="failed">فشل</button></form></body></html>`);
  }

  @Post('dev/healthpay/checkout/:providerOrderId/pay')
  @Public()
  async devPay(@Param('providerOrderId') id: string, @Body() body: { outcome?: string }, @Res() res: Response) {
    if (this.cfg.isProd || !(this.healthpay instanceof FakeHealthPayClient)) throw notFound();
    const s = this.healthpay.sessions.get(id);
    if (!s) throw notFound('checkout');
    const evt = await simulateHealthPay(this.healthpay, this.svc, id, body?.outcome === 'failed' ? 'payment.failed' : 'payment.captured');
    const intent = (await this.tenancy.db.raw<{ organisation_id: string }>('select organisation_id from payment_intent_org($1)', [s.orderId]))[0];
    const ref = intent ? await this.tenancy.system(intent.organisation_id, (tx) => tx.maybeOne<{ ref: string }>('select a.ref from payment_intents i join appointments a on a.id = i.appointment_id where i.id = $1', [s.orderId])) : null;
    res.redirect(`${this.cfg.PUBLIC_SITE_URL}/book/result?ref=${ref?.ref ?? ''}&status=${evt.type}`);
  }
}

export async function simulateHealthPay(fake: FakeHealthPayClient, svc: PaymentsService, providerOrderId: string, type: WebhookEvent['type'] = 'payment.captured') {
  const s = fake.sessions.get(providerOrderId)!;
  const evt: WebhookEvent = { id: `txn_${providerOrderId}`, type, orderId: s.orderId, providerOrderId, amount: s.amount, occurredAt: new Date().toISOString() };
  if (type === 'payment.captured') fake.txns.push({ providerTransactionId: evt.id, orderId: s.orderId, amount: s.amount, status: 'captured', at: evt.occurredAt });
  await svc.handleWebhook(evt);
  return evt;
}

export { signHealthPayPayload };
