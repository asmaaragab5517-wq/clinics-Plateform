-- Sprint 22: generic Idempotency-Key support for staff and patient writes (check-in, queue, clocking, offline replays).
-- A key is reserved before the handler runs and the response is stored after success; kept for 24 hours.
create table idempotency_responses (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  actor_id uuid not null,
  key text not null,
  request_hash text not null,
  state text not null default 'pending' check (state in ('pending', 'done')),
  status integer,
  body jsonb,
  created_at timestamptz not null default now(),
  unique (organisation_id, actor_id, key)
);
create index idempotency_responses_created_idx on idempotency_responses (created_at);
alter table idempotency_responses enable row level security;
grant select, insert, update, delete on idempotency_responses to hf_app;
create policy p_staff on idempotency_responses for all using (hf_staff_pred(organisation_id, null, false)) with check (hf_staff_pred(organisation_id, null, false));
