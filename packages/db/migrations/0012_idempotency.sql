-- Retry-safe payments and walk-ins (a replay after a lost response must not record twice).
alter table payments add column idempotency_key text;
create unique index payments_idem_uq on payments (organisation_id, idempotency_key) where idempotency_key is not null;
