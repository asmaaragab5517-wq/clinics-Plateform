-- Booking funnel for abandoned-booking tracking (FR-WEB-3, BRD G1 completion KPI). No PHI is stored.
create table booking_funnel (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  session_id text not null,
  channel text not null default 'site',
  step text not null check (step in ('doctor','service','slot','patient','payment','done')),
  step_index smallint not null,
  doctor_id uuid,
  clinic_id uuid,
  appointment_id uuid,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, session_id)
);
create index booking_funnel_started_idx on booking_funnel (organisation_id, started_at);
alter table booking_funnel enable row level security;
grant select, insert, update, delete on booking_funnel to hf_app;
create policy p_write on booking_funnel for all
  using (organisation_id = app_org() and app_mode() in ('public','patient','system','staff'))
  with check (organisation_id = app_org());

-- Signed consent capture at reception (FR-PRV-2 tablet signature).
alter table consents add column signature_key text;
