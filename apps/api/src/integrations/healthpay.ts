import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { CONFIG, type Config } from '../config';

export interface CheckoutRequest {
  merchant: { apiKey: string; merchantId: string } | null;
  orderId: string; // our payment intent id
  amount: number; // piastres
  description: string;
  customerPhone: string;
  returnUrl: string;
  idempotencyKey: string;
}
export interface CheckoutResult {
  providerOrderId: string;
  checkoutUrl: string;
}
export interface ProviderTxn {
  providerTransactionId: string;
  orderId: string;
  amount: number;
  status: 'captured' | 'refunded' | 'failed';
  at: string;
}
export interface WebhookEvent {
  id: string; // provider transaction id
  type: 'payment.captured' | 'payment.failed' | 'refund.completed' | 'refund.failed';
  orderId: string; // our intent id (merchant reference)
  providerOrderId?: string;
  amount: number;
  refundId?: string;
  occurredAt: string;
}

/**
 * HealthPay adapter (FR-HP-*). The HTTP adapter's endpoint paths follow the HealthPay merchant API contract
 * agreed during merchant onboarding (docs/integrations/healthpay.md); the fake adapter is used in dev/test.
 * The signed webhook is the source of truth for payment state.
 */
export interface HealthPayClient {
  createCheckout(r: CheckoutRequest): Promise<CheckoutResult>;
  refund(r: { merchant: CheckoutRequest['merchant']; providerTransactionId: string; amount: number; idempotencyKey: string }): Promise<{ refundId: string; status: 'processing' | 'completed' }>;
  listTransactions(r: { merchant: CheckoutRequest['merchant']; date: string }): Promise<ProviderTxn[]>;
}

export const HEALTHPAY = Symbol('HEALTHPAY');

/** Verify `X-HealthPay-Signature: t=<unix>,v1=<hex hmac(secret, t + "." + body)>` with 5 minute tolerance (SEC-7). */
export function verifyHealthPaySignature(secret: string, header: string | undefined, rawBody: Buffer, now = Date.now()): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(',').map((kv) => kv.split('=') as [string, string]));
  const t = Number(parts.t);
  if (!t || Math.abs(now / 1000 - t) > 300 || !parts.v1) return false;
  const expected = createHmac('sha256', secret).update(`${t}.`).update(rawBody).digest('hex');
  const a = Buffer.from(parts.v1, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function signHealthPayPayload(secret: string, body: string, t = Math.floor(Date.now() / 1000)): string {
  return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
}

@Injectable()
export class HttpHealthPayClient implements HealthPayClient {
  private readonly log = new Logger('HealthPay');
  constructor(@Inject(CONFIG) private readonly cfg: Config) {}

  private async call<T>(merchant: CheckoutRequest['merchant'], path: string, body: unknown, idem?: string): Promise<T> {
    if (!merchant) throw new Error('HealthPay merchant is not configured for this legal entity');
    const res = await fetch(`${this.cfg.HEALTHPAY_BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${merchant.apiKey}`, 'x-merchant-id': merchant.merchantId, ...(idem ? { 'idempotency-key': idem } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      this.log.warn(`HealthPay ${path} failed with ${res.status}`);
      throw new Error(`healthpay_${res.status}`);
    }
    return (await res.json()) as T;
  }

  async createCheckout(r: CheckoutRequest): Promise<CheckoutResult> {
    const out = await this.call<{ id: string; checkout_url: string }>(r.merchant, '/v1/checkout/sessions', {
      merchant_reference: r.orderId, amount: r.amount, currency: 'EGP', description: r.description,
      customer: { phone: r.customerPhone }, return_url: r.returnUrl, methods: ['wallet', 'card', 'meeza'],
    }, r.idempotencyKey);
    return { providerOrderId: out.id, checkoutUrl: out.checkout_url };
  }

  async refund(r: Parameters<HealthPayClient['refund']>[0]) {
    const out = await this.call<{ id: string; status: string }>(r.merchant, '/v1/refunds', { transaction_id: r.providerTransactionId, amount: r.amount }, r.idempotencyKey);
    return { refundId: out.id, status: out.status === 'succeeded' ? ('completed' as const) : ('processing' as const) };
  }

  async listTransactions(r: Parameters<HealthPayClient['listTransactions']>[0]) {
    const out = await this.call<{ data: { id: string; merchant_reference: string; amount: number; status: string; created_at: string }[] }>(r.merchant, '/v1/transactions/search', { date: r.date });
    return out.data.map((t) => ({ providerTransactionId: t.id, orderId: t.merchant_reference, amount: t.amount, status: t.status as ProviderTxn['status'], at: t.created_at }));
  }
}

/** In-memory HealthPay used for development and automated tests. */
@Injectable()
export class FakeHealthPayClient implements HealthPayClient {
  readonly sessions = new Map<string, { orderId: string; amount: number }>();
  readonly txns: ProviderTxn[] = [];
  constructor(@Inject(CONFIG) private readonly cfg: Config) {}

  async createCheckout(r: CheckoutRequest) {
    const providerOrderId = `hp_${randomUUID()}`;
    this.sessions.set(providerOrderId, { orderId: r.orderId, amount: r.amount });
    return { providerOrderId, checkoutUrl: `${this.cfg.API_PUBLIC_URL}/v1/dev/healthpay/checkout/${providerOrderId}` };
  }
  async refund(r: Parameters<HealthPayClient['refund']>[0]) {
    this.txns.push({ providerTransactionId: `rf_${randomUUID()}`, orderId: r.providerTransactionId, amount: -r.amount, status: 'refunded', at: new Date().toISOString() });
    return { refundId: `rf_${randomUUID()}`, status: 'completed' as const };
  }
  async listTransactions() {
    return this.txns;
  }
}
