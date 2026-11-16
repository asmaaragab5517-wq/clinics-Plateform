# ADR 0006: HealthPay signed webhook is the source of truth

Online booking creates a `requested` appointment holding the slot for 10 minutes and a payment intent with an
idempotency key. The patient's redirect back is informational only. The signed webhook (HMAC-SHA256 over
`timestamp.body`, 5-minute tolerance) is processed idempotently (`provider_transactions` unique on provider id and
event type): it books the appointment, issues the bill and receipt. If the hold already expired, the slot is re-taken
when still free, otherwise a refund request is raised automatically. A daily job reconciles provider transactions
against captured payments per clinic.
