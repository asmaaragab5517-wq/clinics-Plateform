-- HealthFlow Clinics core schema (SRS §7).
create extension if not exists pgcrypto;
create extension if not exists btree_gist;
create extension if not exists pg_trgm;

-- UUIDv7 (time-ordered) generator.
create or replace function uuid_generate_v7() returns uuid language plpgsql volatile as $$
declare
  ts bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  b bytea := gen_random_bytes(16);
begin
  b := set_byte(b, 0, ((ts >> 40) & 255)::int);
  b := set_byte(b, 1, ((ts >> 32) & 255)::int);
  b := set_byte(b, 2, ((ts >> 24) & 255)::int);
  b := set_byte(b, 3, ((ts >> 16) & 255)::int);
  b := set_byte(b, 4, ((ts >> 8) & 255)::int);
  b := set_byte(b, 5, (ts & 255)::int);
  b := set_byte(b, 6, ((get_byte(b, 6) & 15) | 112));
  b := set_byte(b, 8, ((get_byte(b, 8) & 63) | 128));
  return encode(b, 'hex')::uuid;
end $$;

create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

-- Session context helpers used by RLS policies (MT-1..4).
create or replace function app_org() returns uuid language sql stable as $$
  select nullif(current_setting('app.org_id', true), '')::uuid $$;
create or replace function app_mode() returns text language sql stable as $$
  select coalesce(nullif(current_setting('app.mode', true), ''), 'none') $$;
create or replace function app_is_network() returns boolean language sql stable as $$
  select coalesce(current_setting('app.network', true), 'off') = 'on' $$;
create or replace function app_clinics() returns uuid[] language sql stable as $$
  select coalesce(string_to_array(nullif(current_setting('app.clinic_ids', true), ''), ',')::uuid[], '{}'::uuid[]) $$;
create or replace function app_patients() returns uuid[] language sql stable as $$
  select coalesce(string_to_array(nullif(current_setting('app.patient_ids', true), ''), ',')::uuid[], '{}'::uuid[]) $$;
create or replace function app_user() returns uuid language sql stable as $$
  select nullif(current_setting('app.user_id', true), '')::uuid $$;

-- ---------------------------------------------------------------- Reference data (global, read-only to the app)
create table specialties (
  id uuid primary key default uuid_generate_v7(),
  slug text not null unique,
  name_ar text not null,
  name_en text not null,
  icon text
);
create table icd10_codes (
  code text primary key,
  title_en text not null,
  title_ar text,
  search tsvector generated always as (to_tsvector('simple', code || ' ' || title_en || ' ' || coalesce(title_ar, ''))) stored
);
create index icd10_search_idx on icd10_codes using gin (search);
create table drugs (
  id uuid primary key default uuid_generate_v7(),
  trade_name_en text not null,
  trade_name_ar text,
  active_ingredients text[] not null default '{}',
  strength text,
  form text,
  manufacturer text,
  price integer,
  source text not null default 'import',
  updated_at timestamptz not null default now()
);
create index drugs_trgm_idx on drugs using gin ((trade_name_en || ' ' || coalesce(trade_name_ar, '')) gin_trgm_ops);
create table lab_tests (
  code text primary key,
  kind text not null check (kind in ('lab', 'radiology')),
  name_en text not null,
  name_ar text
);

-- ---------------------------------------------------------------- Tenancy
create table organisations (
  id uuid primary key default uuid_generate_v7(),
  name_ar text not null,
  name_en text not null default '',
  slug text not null unique,
  domain text unique,
  settings jsonb not null default '{}',
  privilege_overrides jsonb not null default '{}',
  branding jsonb not null default '{}',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table legal_entities (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  name_ar text not null,
  name_en text not null default '',
  tax_registration_number text,
  commercial_register text,
  address text,
  healthpay_config_enc bytea,
  healthpay_mode text not null default 'sandbox' check (healthpay_mode in ('sandbox', 'live')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table clinics (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  legal_entity_id uuid references legal_entities(id),
  name_ar text not null,
  name_en text not null default '',
  slug text not null,
  governorate text not null,
  city text not null,
  address_lines text not null default '',
  lat double precision,
  lng double precision,
  phones text[] not null default '{}',
  email text,
  working_hours jsonb not null default '[]',
  colours jsonb not null default '{}',
  logo_key text,
  invoice_footer text not null default '',
  receipt_prefix text not null default 'R',
  settings jsonb not null default '{}',
  is_public boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  unique (organisation_id, slug)
);
create table clinic_specialties (
  organisation_id uuid not null references organisations(id),
  clinic_id uuid not null references clinics(id),
  specialty_id uuid not null references specialties(id),
  primary key (clinic_id, specialty_id)
);

create table secret_settings (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  key text not null,
  value_enc bytea not null,
  updated_at timestamptz not null default now(),
  unique (organisation_id, key)
);

create table number_sequences (
  organisation_id uuid not null references organisations(id),
  scope text not null, -- e.g. 'mrn', 'receipt:<clinic>', 'invoice:<clinic>', 'ticket:<doctor>:<date>'
  value bigint not null default 0,
  primary key (organisation_id, scope)
);

-- ---------------------------------------------------------------- People
create table users (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  keycloak_sub text unique,
  email text,
  phone text,
  name_ar text not null,
  name_en text not null default '',
  status text not null default 'invited' check (status in ('invited', 'active', 'deactivated')),
  mfa_enrolled boolean not null default false,
  pin_hash text,
  last_login_at timestamptz,
  last_strong_auth_at timestamptz,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  unique (organisation_id, email)
);
create table staff_memberships (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  user_id uuid not null references users(id),
  clinic_id uuid references clinics(id), -- null for organisation-level roles
  role text not null check (role in ('owner','network_director','clinic_manager','doctor','nurse','receptionist','accountant')),
  created_at timestamptz not null default now(),
  unique nulls not distinct (user_id, clinic_id, role)
);
create table doctor_profiles (
  user_id uuid primary key references users(id),
  organisation_id uuid not null references organisations(id),
  slug text not null,
  title text not null check (title in ('prof', 'dr', 'consultant', 'specialist')),
  syndicate_number text not null,
  gender text check (gender in ('male', 'female')),
  languages text[] not null default '{ar}',
  bio_ar text not null default '',
  bio_en text not null default '',
  photo_key text,
  signature_key_enc bytea,
  stamp_key_enc bytea,
  qualifications jsonb not null default '[]',
  is_public boolean not null default true,
  rating_avg numeric(3,2),
  rating_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, slug)
);
create table doctor_specialties (
  organisation_id uuid not null references organisations(id),
  doctor_id uuid not null references users(id),
  specialty_id uuid not null references specialties(id),
  primary key (doctor_id, specialty_id)
);

create table patients (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  mrn text not null,
  first_name_ar text not null,
  father_name_ar text not null default '',
  grandfather_name_ar text not null default '',
  family_name_ar text not null default '',
  name_en text,
  name_search text not null default '', -- normalised Arabic + English
  national_id_enc bytea,
  national_id_bidx text,
  passport_enc bytea,
  passport_bidx text,
  nationality text not null default 'EG',
  date_of_birth date not null,
  gender text not null check (gender in ('male', 'female')),
  email text,
  governorate text,
  city text,
  address text,
  marital_status text,
  occupation text,
  emergency_contact jsonb,
  photo_key text,
  guardian_patient_id uuid references patients(id),
  custom_fields jsonb not null default '{}',
  merged_into_id uuid references patients(id),
  merged_at timestamptz,
  anonymised_at timestamptz,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz,
  unique (organisation_id, mrn)
);
create unique index patients_nid_bidx on patients (organisation_id, national_id_bidx) where national_id_bidx is not null and merged_into_id is null;
create index patients_name_trgm on patients using gin (name_search gin_trgm_ops);
create index patients_dob_idx on patients (organisation_id, date_of_birth);

create table patient_contacts (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  patient_id uuid not null references patients(id),
  phone text not null,
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);
create index patient_contacts_phone_idx on patient_contacts (organisation_id, phone);

create table patient_accounts (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  phone text not null,
  locale text not null default 'ar',
  status text not null default 'active',
  deletion_requested_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organisation_id, phone)
);
create table patient_links (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  account_id uuid not null references patient_accounts(id),
  patient_id uuid not null references patients(id),
  relation text not null check (relation in ('self', 'child', 'spouse', 'parent', 'sibling', 'other')),
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (account_id, patient_id)
);

create table otp_codes (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  phone text not null,
  purpose text not null,
  code_hash text not null,
  attempts integer not null default 0,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  ip inet,
  created_at timestamptz not null default now()
);
create index otp_phone_idx on otp_codes (organisation_id, phone, created_at desc);

create table refresh_tokens (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  account_id uuid not null references patient_accounts(id),
  token_hash text not null unique,
  family uuid not null,
  device_id text,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  replaced_by uuid,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- Catalogue
create table services (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  code text not null,
  name_ar text not null,
  name_en text not null default '',
  specialty_id uuid references specialties(id),
  duration_minutes integer not null,
  type text not null check (type in ('consultation','follow_up','procedure','package','telemedicine')),
  vat text not null check (vat in ('taxable','exempt','zero')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, code)
);
create table doctor_services (
  organisation_id uuid not null references organisations(id),
  doctor_id uuid not null references users(id),
  service_id uuid not null references services(id),
  primary key (doctor_id, service_id)
);
create table price_list_items (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  clinic_id uuid not null references clinics(id),
  service_id uuid not null references services(id),
  doctor_id uuid references users(id),
  price integer not null check (price >= 0),
  effective_from date not null,
  effective_to date,
  created_at timestamptz not null default now(),
  exclude using gist (clinic_id with =, service_id with =, coalesce(doctor_id, '00000000-0000-0000-0000-000000000000'::uuid) with =, daterange(effective_from, coalesce(effective_to, 'infinity'::date), '[]') with &&)
);
create table packages (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  service_id uuid not null references services(id),
  name_ar text not null,
  name_en text not null default '',
  sessions integer not null check (sessions > 0),
  validity_days integer not null,
  price integer not null,
  family_shareable boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create table custom_field_defs (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  entity text not null default 'patient',
  specialty_id uuid references specialties(id),
  key text not null,
  label_ar text not null,
  label_en text not null default '',
  type text not null check (type in ('text','number','date','select','multiselect','boolean','file')),
  options jsonb not null default '[]',
  required boolean not null default false,
  validation jsonb not null default '{}',
  visible_roles text[] not null default '{}',
  unique (organisation_id, entity, key)
);
create table encounter_templates (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  specialty_id uuid references specialties(id),
  doctor_id uuid references users(id),
  name_ar text not null,
  name_en text not null default '',
  sections jsonb not null default '[]',
  defaults jsonb not null default '{}',
  common_diagnoses text[] not null default '{}',
  created_at timestamptz not null default now()
);
create table prescription_templates (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  doctor_id uuid references users(id),
  name text not null,
  diagnosis_code text,
  lines jsonb not null default '[]',
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- Scheduling
create table schedule_profiles (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  name text not null,
  date_from date not null,
  date_to date not null,
  check (date_from <= date_to)
);
create table doctor_sessions (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  clinic_id uuid not null references clinics(id),
  doctor_id uuid not null references users(id),
  profile_id uuid references schedule_profiles(id),
  weekdays smallint[] not null,
  start_time time not null,
  end_time time not null,
  slot_minutes integer not null check (slot_minutes between 5 and 240),
  capacity_per_slot integer not null default 1 check (capacity_per_slot between 1 and 20),
  walk_in_reserved integer not null default 0,
  overbook_per_slot integer not null default 0,
  breaks jsonb not null default '[]',
  service_ids uuid[] not null default '{}',
  effective_from date not null,
  effective_to date,
  is_active boolean not null default true,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  check (start_time < end_time)
);
create table schedule_exceptions (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  clinic_id uuid references clinics(id),
  doctor_id uuid references users(id),
  kind text not null check (kind in ('leave','holiday','extra')),
  date date not null,
  start_time time,
  end_time time,
  session jsonb,
  reason text,
  created_at timestamptz not null default now(), created_by uuid
);

create table appointments (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  clinic_id uuid not null references clinics(id),
  doctor_id uuid not null references users(id),
  patient_id uuid not null references patients(id),
  session_id uuid references doctor_sessions(id),
  ref text not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  slot_index smallint not null default 0,
  status text not null default 'booked' check (status in ('requested','booked','confirmed','checked_in','in_consultation','completed','no_show','cancelled')),
  channel text not null,
  payment_mode text not null default 'at_clinic' check (payment_mode in ('online','at_clinic')),
  hold_expires_at timestamptz,
  is_walk_in boolean not null default false,
  reschedule_count integer not null default 0,
  cancel_reason text,
  cancelled_by text,
  notes text,
  idempotency_key text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  check (start_at < end_at),
  unique (organisation_id, ref),
  unique (organisation_id, idempotency_key),
  -- Capacity: each (doctor, slot_index) may hold one live appointment per time range (SRS §7).
  constraint appointments_no_overlap exclude using gist (
    doctor_id with =, slot_index with =, tstzrange(start_at, end_at) with &&
  ) where (status in ('requested','booked','confirmed','checked_in','in_consultation','completed') and not is_walk_in)
);
create index appointments_clinic_day_idx on appointments (clinic_id, start_at);
create index appointments_patient_idx on appointments (patient_id, start_at desc);
create index appointments_hold_idx on appointments (hold_expires_at) where status = 'requested';

create table appointment_services (
  organisation_id uuid not null references organisations(id),
  appointment_id uuid not null references appointments(id) on delete cascade,
  service_id uuid not null references services(id),
  primary key (appointment_id, service_id)
);
create table appointment_events (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  clinic_id uuid not null references clinics(id),
  appointment_id uuid not null references appointments(id),
  from_status text,
  to_status text not null,
  reason text,
  actor_type text not null,
  actor_id uuid,
  at timestamptz not null default now()
);
create table queue_tickets (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  clinic_id uuid not null references clinics(id),
  doctor_id uuid not null references users(id),
  appointment_id uuid not null unique references appointments(id),
  patient_id uuid not null references patients(id),
  queue_date date not null,
  ticket_number integer not null,
  priority text not null default 'normal' check (priority in ('emergency','elderly','booked_on_time','normal')),
  status text not null default 'waiting' check (status in ('waiting','called','serving','done','skipped')),
  checked_in_at timestamptz not null default now(),
  called_at timestamptz,
  served_at timestamptz,
  done_at timestamptz,
  notified_near boolean not null default false,
  unique (doctor_id, queue_date, ticket_number)
);
create table waitlist (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  clinic_id uuid not null references clinics(id),
  doctor_id uuid not null references users(id),
  patient_id uuid not null references patients(id),
  service_id uuid references services(id),
  earliest date not null,
  latest date,
  status text not null default 'waiting' check (status in ('waiting','offered','booked','expired','cancelled')),
  offered_at timestamptz,
  created_at timestamptz not null default now()
);
create table follow_ups (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  clinic_id uuid not null references clinics(id),
  doctor_id uuid not null references users(id),
  patient_id uuid not null references patients(id),
  encounter_id uuid,
  service_id uuid references services(id),
  due_date date not null,
  note text,
  status text not null default 'due' check (status in ('due','booked','done','dismissed')),
  appointment_id uuid references appointments(id),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- Clinical
create table encounters (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  clinic_id uuid not null references clinics(id),
  doctor_id uuid not null references users(id),
  patient_id uuid not null references patients(id),
  appointment_id uuid unique references appointments(id),
  template_id uuid references encounter_templates(id),
  status text not null default 'open' check (status in ('open','signed')),
  vitals jsonb not null default '{}',
  chief_complaint text not null default '',
  hpi text not null default '',
  examination text not null default '',
  notes text not null default '',
  diagnoses jsonb not null default '[]',
  problems jsonb not null default '[]',
  observations jsonb not null default '[]',
  body_chart jsonb,
  follow_up jsonb,
  patient_summary text,
  signed_at timestamptz,
  signed_by uuid,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid
);
create index encounters_patient_idx on encounters (patient_id, created_at desc);
create table addenda (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  encounter_id uuid not null references encounters(id),
  patient_id uuid not null references patients(id),
  body text not null,
  created_at timestamptz not null default now(),
  created_by uuid not null
);
create table medical_history_items (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  patient_id uuid not null references patients(id),
  kind text not null check (kind in ('allergy','chronic','surgery','medication','family','social','immunisation')),
  text text not null,
  severity text,
  ingredient text,
  since date,
  is_active boolean not null default true,
  created_at timestamptz not null default now(), created_by uuid
);
create table orders (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  encounter_id uuid not null references encounters(id),
  patient_id uuid not null references patients(id),
  kind text not null check (kind in ('lab','radiology')),
  test_codes text[] not null,
  note text,
  status text not null default 'ordered' check (status in ('ordered','result_received','reviewed')),
  created_at timestamptz not null default now(), created_by uuid,
  reviewed_at timestamptz, reviewed_by uuid
);
create table documents (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  patient_id uuid not null references patients(id),
  encounter_id uuid references encounters(id),
  order_id uuid references orders(id),
  kind text not null default 'report',
  title text not null,
  storage_key text not null,
  mime text not null,
  size_bytes integer not null,
  sha256 text not null,
  scan_status text not null default 'pending' check (scan_status in ('pending','clean','infected','error')),
  patient_provided boolean not null default false,
  created_at timestamptz not null default now(), created_by uuid
);
create table prescriptions (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  clinic_id uuid not null references clinics(id),
  encounter_id uuid not null references encounters(id),
  patient_id uuid not null references patients(id),
  doctor_id uuid not null references users(id),
  verify_code text not null unique,
  notes text,
  status text not null default 'draft' check (status in ('draft','issued','revoked')),
  issued_at timestamptz,
  pdf_key text,
  created_at timestamptz not null default now()
);
create table prescription_lines (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  prescription_id uuid not null references prescriptions(id) on delete cascade,
  position integer not null,
  drug_id uuid references drugs(id),
  free_text text,
  dose text not null,
  route text not null,
  frequency text not null,
  duration_days integer,
  quantity text,
  instructions_ar text not null default '',
  instructions_en text not null default '',
  warnings jsonb not null default '[]'
);

-- ---------------------------------------------------------------- Finance
create table bills (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  clinic_id uuid not null references clinics(id),
  legal_entity_id uuid references legal_entities(id),
  patient_id uuid not null references patients(id),
  appointment_id uuid references appointments(id),
  encounter_id uuid references encounters(id),
  number text,
  status text not null default 'draft' check (status in ('draft','issued','partially_paid','paid','void','refunded')),
  subtotal integer not null default 0,
  discount integer not null default 0,
  taxable_base integer not null default 0,
  vat integer not null default 0,
  total integer not null default 0,
  paid integer not null default 0,
  refunded integer not null default 0,
  discount_approval_id uuid,
  void_reason text,
  issued_at timestamptz,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  unique (clinic_id, number)
);
create index bills_patient_idx on bills (patient_id);
create table bill_lines (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  bill_id uuid not null references bills(id) on delete cascade,
  position integer not null,
  service_id uuid references services(id),
  package_id uuid references packages(id),
  description text not null,
  qty integer not null,
  unit_price integer not null,
  discount_type text,
  discount_value numeric(12,2),
  vat_status text not null,
  gross integer not null,
  discount integer not null,
  net integer not null,
  vat integer not null,
  total integer not null,
  doctor_id uuid references users(id)
);
create table credit_notes (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  clinic_id uuid not null references clinics(id),
  bill_id uuid not null references bills(id),
  patient_id uuid not null references patients(id),
  number text not null,
  amount integer not null,
  reason text not null,
  created_at timestamptz not null default now(), created_by uuid
);
create table cashier_shifts (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  clinic_id uuid not null references clinics(id),
  cashier_id uuid not null references users(id),
  status text not null default 'open' check (status in ('open','closed','pending_approval','approved')),
  opening_float integer not null,
  cash_in integer not null default 0,
  cash_out integer not null default 0,
  expected integer,
  counted integer,
  variance integer,
  counts jsonb,
  note text,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  approved_by uuid,
  approved_at timestamptz
);
create unique index one_open_shift_per_cashier on cashier_shifts (cashier_id, clinic_id) where status = 'open';
create table payments (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  clinic_id uuid not null references clinics(id),
  bill_id uuid references bills(id),
  patient_id uuid not null references patients(id),
  shift_id uuid references cashier_shifts(id),
  method text not null check (method in ('cash','card_at_clinic','healthpay','package_balance','bank_transfer')),
  amount integer not null check (amount > 0),
  refunded integer not null default 0,
  reference text,
  card_last4 text,
  package_balance_id uuid,
  receipt_number text,
  status text not null default 'captured' check (status in ('pending','captured','failed')),
  provider_transaction_id text unique,
  created_at timestamptz not null default now(), created_by uuid,
  unique (clinic_id, receipt_number)
);
create table refunds (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  clinic_id uuid not null references clinics(id),
  payment_id uuid not null references payments(id),
  patient_id uuid not null references patients(id),
  amount integer not null check (amount > 0),
  reason text not null,
  status text not null default 'requested' check (status in ('requested','approved','rejected','processing','completed','failed')),
  shift_id uuid references cashier_shifts(id),
  provider_refund_id text,
  requested_by uuid, approved_by uuid,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create table package_balances (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  package_id uuid not null references packages(id),
  patient_id uuid not null references patients(id),
  bill_id uuid references bills(id),
  sessions_total integer not null,
  sessions_used integer not null default 0 check (sessions_used >= 0),
  expires_on date not null,
  created_at timestamptz not null default now(),
  check (sessions_used <= sessions_total)
);
create table package_consumptions (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  package_balance_id uuid not null references package_balances(id),
  appointment_id uuid references appointments(id),
  patient_id uuid not null references patients(id),
  created_at timestamptz not null default now(), created_by uuid
);
create table commission_rules (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  doctor_id uuid not null references users(id),
  clinic_id uuid references clinics(id),
  service_id uuid references services(id),
  service_type text,
  rule jsonb not null,
  effective_from date not null default current_date,
  created_at timestamptz not null default now()
);
create table commission_statements (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  doctor_id uuid not null references users(id),
  clinic_id uuid references clinics(id),
  month date not null,
  revenue integer not null,
  share integer not null,
  lines jsonb not null,
  status text not null default 'draft' check (status in ('draft','approved')),
  approved_by uuid, approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique nulls not distinct (doctor_id, clinic_id, month)
);
create table approval_requests (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  clinic_id uuid references clinics(id),
  kind text not null check (kind in ('discount','void','refund','shift_variance','break_glass')),
  entity_id uuid not null,
  payload jsonb not null default '{}',
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  requested_by uuid not null,
  decided_by uuid,
  decided_at timestamptz,
  note text,
  created_at timestamptz not null default now()
);
create table payment_intents (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  clinic_id uuid not null references clinics(id),
  legal_entity_id uuid references legal_entities(id),
  appointment_id uuid references appointments(id),
  bill_id uuid references bills(id),
  patient_id uuid not null references patients(id),
  amount integer not null,
  idempotency_key text not null,
  provider_order_id text unique,
  checkout_url text,
  status text not null default 'created' check (status in ('created','pending','captured','failed','expired','refunded')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, idempotency_key)
);
create table provider_transactions (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  provider text not null default 'healthpay',
  provider_transaction_id text not null,
  event_type text not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error text,
  unique (provider, provider_transaction_id, event_type)
);
create table reconciliation_runs (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  clinic_id uuid references clinics(id),
  run_date date not null,
  provider_total integer not null,
  captured_total integer not null,
  mismatches jsonb not null default '[]',
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- Communications
create table message_templates (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  event text not null,
  channel text not null check (channel in ('sms','whatsapp','email','push')),
  locale text not null check (locale in ('ar','en')),
  body text not null,
  subject text,
  provider_template_id text,
  is_enabled boolean not null default true,
  unique (organisation_id, event, channel, locale)
);
create table messages (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  clinic_id uuid references clinics(id),
  patient_id uuid references patients(id),
  event text not null,
  channel text not null,
  recipient text not null,
  locale text not null,
  body text,
  status text not null default 'queued' check (status in ('queued','sent','delivered','failed','suppressed')),
  provider_message_id text,
  segments integer,
  cost integer,
  error text,
  scheduled_for timestamptz not null default now(),
  sent_at timestamptz,
  dedupe_key text,
  created_at timestamptz not null default now(),
  unique (organisation_id, dedupe_key)
);
create index messages_provider_idx on messages (provider_message_id);
create table message_events (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  message_id uuid not null references messages(id),
  status text not null,
  payload jsonb,
  at timestamptz not null default now()
);
create table device_tokens (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  account_id uuid references patient_accounts(id),
  user_id uuid references users(id),
  token text not null unique,
  platform text not null,
  created_at timestamptz not null default now()
);
create table notification_preferences (
  organisation_id uuid not null references organisations(id),
  patient_id uuid not null references patients(id),
  channels text[] not null default '{whatsapp,sms,push}',
  marketing_opt_out boolean not null default false,
  sms_opt_out boolean not null default false,
  whatsapp_opt_out boolean not null default false,
  primary key (patient_id)
);

-- ---------------------------------------------------------------- Privacy
create table consent_versions (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  type text not null,
  version integer not null,
  text_ar text not null,
  text_en text not null default '',
  published_at timestamptz not null default now(),
  unique (organisation_id, type, version)
);
create table consents (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  patient_id uuid not null references patients(id),
  version_id uuid not null references consent_versions(id),
  type text not null,
  granted boolean not null,
  channel text not null,
  ip inet,
  device text,
  recorded_by uuid,
  created_at timestamptz not null default now()
);
create table audit_log (
  organisation_id uuid not null references organisations(id),
  seq bigint not null,
  at timestamptz not null default clock_timestamp(),
  actor_type text not null,
  actor_id uuid,
  role text,
  action text not null,
  entity text not null,
  entity_id text,
  patient_id uuid,
  clinic_id uuid,
  ip text,
  user_agent text,
  reason text,
  details jsonb,
  prev_hash text not null,
  hash text not null,
  primary key (organisation_id, seq)
);
create index audit_patient_idx on audit_log (organisation_id, patient_id, at desc);
create table data_requests (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  patient_id uuid not null references patients(id),
  kind text not null check (kind in ('access','export','correction','erasure')),
  status text not null default 'received' check (status in ('received','in_progress','completed','rejected')),
  details text,
  due_at timestamptz not null,
  result_key text,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
create table breaches (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  title text not null,
  description text not null,
  detected_at timestamptz not null,
  contained_at timestamptz,
  reported_to_pdpc_at timestamptz,
  subjects_notified_at timestamptz,
  severity text not null default 'medium',
  affected_count integer,
  timeline jsonb not null default '[]',
  created_at timestamptz not null default now(), created_by uuid
);

-- ---------------------------------------------------------------- Other
create table reviews (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  clinic_id uuid not null references clinics(id),
  doctor_id uuid not null references users(id),
  patient_id uuid not null references patients(id),
  appointment_id uuid not null unique references appointments(id),
  rating smallint not null check (rating between 1 and 5),
  comment text,
  display_name text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  moderated_by uuid, moderated_at timestamptz,
  created_at timestamptz not null default now()
);
create table tasks (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  clinic_id uuid references clinics(id),
  kind text not null,
  title text not null,
  entity_id uuid,
  assignee_role text,
  status text not null default 'open' check (status in ('open','done')),
  created_at timestamptz not null default now()
);
create table articles (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  kind text not null default 'article' check (kind in ('article','news','page')),
  slug text not null,
  title_ar text not null,
  title_en text not null default '',
  body_ar text not null default '',
  body_en text not null default '',
  status text not null default 'draft' check (status in ('draft','published')),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, slug)
);
create table import_batches (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  entity text not null,
  status text not null default 'uploaded' check (status in ('uploaded','validated','committing','committed','failed','rolled_back')),
  dry_run_report jsonb,
  row_count integer not null default 0,
  error_count integer not null default 0,
  committed_at timestamptz,
  created_at timestamptz not null default now(), created_by uuid
);
create table import_rows (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  batch_id uuid not null references import_batches(id) on delete cascade,
  row_number integer not null,
  data jsonb not null,
  errors jsonb not null default '[]',
  created_entity_id uuid
);
create table feature_flags (
  organisation_id uuid not null references organisations(id),
  key text not null,
  enabled boolean not null default false,
  primary key (organisation_id, key)
);

-- updated_at triggers
do $$
declare t text;
begin
  for t in select table_name from information_schema.columns
           where table_schema = 'public' and column_name = 'updated_at'
             and table_name not in ('drugs')
  loop
    execute format('create trigger %I_touch before update on %I for each row execute function touch_updated_at()', t, t);
  end loop;
end $$;
