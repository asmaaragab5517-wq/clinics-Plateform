# HealthPay integration

| Item | Where |
|---|---|
| Adapter | `apps/api/src/integrations/healthpay.ts` (`HttpHealthPayClient`, `FakeHealthPayClient`) |
| Flow | `apps/api/src/modules/payments.ts` |
| Merchant credentials | per legal entity, AES-256-GCM encrypted (`PUT /v1/legal-entities/:id/healthpay`) |
| Webhook | `POST /v1/webhooks/healthpay`, header `X-HealthPay-Signature: t=<unix>,v1=<hex>` |

**To confirm during merchant onboarding (assumption in code):** endpoint paths `/v1/checkout/sessions`, `/v1/refunds`,
`/v1/transactions/search`, field names (`merchant_reference`, `checkout_url`), the signature header format and
webhook event names (`payment.captured`, `payment.failed`, `refund.completed`, `refund.failed`). Only
`HttpHealthPayClient` and `verifyHealthPaySignature` need changing if HealthPay's contract differs.

Sandbox: set `HEALTHPAY_MODE=fake` (default) — checkout links open `/v1/dev/healthpay/checkout/:id`, which posts a
signed webhook. Live: `HEALTHPAY_MODE=http`, `HEALTHPAY_BASE_URL`, `HEALTHPAY_WEBHOOK_SECRET`, and the merchant
configured per legal entity. The R1 gate requires one real small live transaction (SRS §11.1).
