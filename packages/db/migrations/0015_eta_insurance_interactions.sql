-- ---------------------------------------------------------------- Drug interactions (FR-RX-3, R2): global reference data
create table drug_interactions (
  id uuid primary key default uuid_generate_v7(),
  ingredient_a text not null,
  ingredient_b text not null,
  severity text not null check (severity in ('minor','moderate','major','contraindicated')),
  description_en text not null,
  description_ar text,
  source text not null default 'import',
  check (ingredient_a < ingredient_b),
  unique (ingredient_a, ingredient_b)
);
grant select on drug_interactions to hf_app;

-- ---------------------------------------------------------------- Insurance / TPA (FR-BIL-11)
create table payers (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  code text not null,
  name_ar text not null,
  name_en text not null default '',
  kind text not null check (kind in ('insurer','tpa','corporate')),
  contact jsonb not null default '{}',
  claim_format text not null default 'standard',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organisation_id, code)
);
create table payer_plans (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  payer_id uuid not null references payers(id),
  name text not null,
  coverage_percent numeric(5,2) not null check (coverage_percent between 0 and 100),
  copay_fixed integer not null default 0,
  type_overrides jsonb not null default '{}', -- service type → coverage percent
  excluded_service_ids uuid[] not null default '{}',
  requires_approval boolean not null default false,
  annual_limit integer,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create table patient_coverages (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  patient_id uuid not null references patients(id),
  plan_id uuid not null references payer_plans(id),
  member_number text not null,
  valid_from date not null,
  valid_to date,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table bills add column coverage_id uuid references patient_coverages(id);
alter table bills add column approval_number text;
alter table bills add column insurer_share integer not null default 0;
alter table bills add column claim_item_id uuid;
alter table payments drop constraint payments_method_check;
alter table payments add constraint payments_method_check check (method in ('cash','card_at_clinic','healthpay','package_balance','bank_transfer','insurance'));

create table claim_batches (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  payer_id uuid not null references payers(id),
  number text not null,
  period_from date not null,
  period_to date not null,
  status text not null default 'draft' check (status in ('draft','submitted','partially_paid','paid','rejected')),
  total integer not null default 0,
  paid integer not null default 0,
  submitted_at timestamptz,
  created_at timestamptz not null default now(), created_by uuid,
  unique (organisation_id, number)
);
create table claim_items (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  batch_id uuid not null references claim_batches(id) on delete cascade,
  bill_id uuid not null unique references bills(id),
  clinic_id uuid not null references clinics(id),
  patient_id uuid not null references patients(id),
  amount integer not null,
  paid integer not null default 0,
  status text not null default 'claimed' check (status in ('claimed','paid','partially_paid','rejected')),
  rejection_reason text
);

-- ---------------------------------------------------------------- ETA e-receipts (FR-BIL-10)
alter table legal_entities add column eta_config_enc bytea;
alter table legal_entities add column eta_mode text not null default 'preprod' check (eta_mode in ('preprod','prod'));
create table eta_receipts (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  legal_entity_id uuid not null references legal_entities(id),
  clinic_id uuid not null references clinics(id),
  bill_id uuid not null unique references bills(id),
  receipt_number text not null,
  uuid text,
  previous_uuid text,
  issued_at timestamptz not null,
  payload jsonb not null,
  status text not null default 'queued' check (status in ('queued','submitted','valid','invalid','failed')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  submission_id text,
  errors jsonb,
  submitted_at timestamptz,
  created_at timestamptz not null default now()
);
create index eta_receipts_queue_idx on eta_receipts (status, next_attempt_at);

do $$
declare t text;
begin
  foreach t in array array['payers','payer_plans','claim_batches'] loop
    execute format('alter table %I enable row level security', t);
    execute format('grant select, insert, update, delete on %I to hf_app', t);
    execute format($f$create policy p_staff on %I for all using (hf_staff_pred(organisation_id, null, false)) with check (hf_staff_pred(organisation_id, null, false))$f$, t);
  end loop;
  foreach t in array array['claim_items','eta_receipts'] loop
    execute format('alter table %I enable row level security', t);
    execute format('grant select, insert, update, delete on %I to hf_app', t);
    execute format($f$create policy p_staff on %I for all using (hf_staff_pred(organisation_id, clinic_id, true)) with check (hf_staff_pred(organisation_id, clinic_id, true))$f$, t);
  end loop;
end $$;
alter table patient_coverages enable row level security;
grant select, insert, update, delete on patient_coverages to hf_app;
create policy p_staff on patient_coverages for all using (hf_staff_pred(organisation_id, null, false)) with check (hf_staff_pred(organisation_id, null, false));
create policy p_patient on patient_coverages for select using (organisation_id = app_org() and app_mode() = 'patient' and patient_id = any(app_patients()));

-- Tenant-bound FKs for the new tables (migration 0011 rule).
do $$
declare r record;
begin
  for r in select * from (values
    ('payer_plans','payer_id','payers'), ('patient_coverages','patient_id','patients'), ('patient_coverages','plan_id','payer_plans'),
    ('bills','coverage_id','patient_coverages'), ('claim_batches','payer_id','payers'), ('claim_items','batch_id','claim_batches'),
    ('claim_items','bill_id','bills'), ('claim_items','clinic_id','clinics'), ('claim_items','patient_id','patients'),
    ('eta_receipts','legal_entity_id','legal_entities'), ('eta_receipts','clinic_id','clinics'), ('eta_receipts','bill_id','bills')) v(child, col, parent)
  loop
    if not exists (select 1 from pg_constraint where conname = r.parent || '_org_id_uq') then
      execute format('alter table %I add constraint %I unique (organisation_id, id)', r.parent, r.parent || '_org_id_uq');
    end if;
    execute format('alter table %I add constraint %I foreign key (organisation_id, %I) references %I (organisation_id, id)', r.child, r.child || '_' || r.col || '_org', r.col, r.parent);
  end loop;
end $$;
