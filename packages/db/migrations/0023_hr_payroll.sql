-- Sprint 19: staff HR (contracts, attendance, leave, hourly permissions, public holidays) and payroll.
-- Money is integer piastres. Clinic-scoped tables follow the staff clinic predicate, so a clinic manager sees their
-- clinic's staff; salary data (contracts, payroll) is organisation-level and guarded by payroll privileges in the API.

create table employment_contracts (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  user_id uuid not null references users(id),
  clinic_id uuid not null references clinics(id), -- home clinic: attendance and approvals belong to it
  job_title_ar text not null,
  job_title_en text not null default '',
  employment_type text not null check (employment_type in ('full_time', 'part_time', 'contractor')),
  pay_basis text not null check (pay_basis in ('monthly', 'hourly', 'commission_only')),
  start_date date not null,
  end_date date,
  base_salary integer not null default 0 check (base_salary >= 0),
  allowances jsonb not null default '[]',
  insurable_wage integer check (insurable_wage >= 0),
  social_insurance_number text,
  bank_name text,
  iban_enc bytea,
  iban_last4 text,
  work_pattern jsonb not null,
  date_of_birth date,
  status text not null default 'active' check (status in ('active', 'ended')),
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date is null or end_date >= start_date)
);
create unique index employment_contracts_one_active on employment_contracts (user_id) where status = 'active';

create table public_holidays (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  holiday_date date not null,
  name_ar text not null,
  name_en text not null default '',
  unique (organisation_id, holiday_date)
);

create table attendance_records (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  user_id uuid not null references users(id),
  clinic_id uuid not null references clinics(id),
  work_date date not null,
  clock_in timestamptz,
  clock_out timestamptz,
  source text not null default 'console' check (source in ('console', 'mobile', 'manual', 'system')),
  status text not null default 'open' check (status in ('open', 'complete', 'incomplete', 'absent', 'on_leave', 'holiday', 'rest_day')),
  late_minutes integer not null default 0,
  early_leave_minutes integer not null default 0,
  worked_minutes integer not null default 0,
  overtime_minutes integer not null default 0,
  rest_day boolean not null default false,
  overtime_approved boolean not null default false,
  note text,
  adjusted_by uuid references users(id),
  adjusted_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, work_date),
  check (clock_out is null or clock_in is null or clock_out >= clock_in)
);
create index attendance_records_clinic_date_idx on attendance_records (clinic_id, work_date);

create table leave_types (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  code text not null,
  name_ar text not null,
  name_en text not null default '',
  paid boolean not null default true,
  uses_annual_balance boolean not null default false,
  annual_quota numeric(6, 2),
  max_consecutive_days numeric(6, 2),
  is_active boolean not null default true,
  unique (organisation_id, code)
);

create table leave_balances (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  user_id uuid not null references users(id),
  year integer not null,
  entitled numeric(6, 2) not null default 0,
  carried numeric(6, 2) not null default 0,
  adjusted numeric(6, 2) not null default 0,
  adjusted_note text,
  unique (user_id, year)
);

create table leave_requests (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  user_id uuid not null references users(id),
  clinic_id uuid not null references clinics(id),
  leave_type_id uuid not null references leave_types(id),
  start_date date not null,
  end_date date not null,
  days numeric(6, 2) not null,
  reason text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  requested_by uuid references users(id),
  decided_by uuid references users(id),
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  check (end_date >= start_date)
);
create index leave_requests_user_idx on leave_requests (user_id, start_date);

create table permission_requests (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  user_id uuid not null references users(id),
  clinic_id uuid not null references clinics(id),
  work_date date not null,
  kind text not null check (kind in ('late_arrival', 'early_leave', 'during_day')),
  start_time time not null,
  end_time time not null,
  minutes integer not null,
  reason text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  requested_by uuid references users(id),
  decided_by uuid references users(id),
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  check (end_time > start_time)
);
create index permission_requests_user_idx on permission_requests (user_id, work_date);

create table payroll_runs (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  period date not null, -- first day of the month
  status text not null default 'draft' check (status in ('draft', 'approved', 'paid', 'cancelled')),
  totals jsonb not null default '{}',
  warnings jsonb not null default '[]',
  created_by uuid references users(id),
  calculated_at timestamptz,
  approved_by uuid references users(id),
  approved_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  check (extract(day from period) = 1)
);
create unique index payroll_runs_one_per_period on payroll_runs (organisation_id, period) where status <> 'cancelled';

create table payslips (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  run_id uuid not null references payroll_runs(id) on delete cascade,
  user_id uuid not null references users(id),
  clinic_id uuid not null references clinics(id),
  contract_id uuid not null references employment_contracts(id),
  gross integer not null,
  deductions integer not null,
  net integer not null,
  employer_cost integer not null,
  lines jsonb not null,
  inputs jsonb not null,
  warnings jsonb not null default '[]',
  created_at timestamptz not null default now(),
  unique (run_id, user_id)
);

create table payroll_adjustments (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  user_id uuid not null references users(id),
  period date not null,
  kind text not null check (kind in ('bonus', 'allowance', 'overtime', 'reimbursement', 'deduction', 'advance', 'advance_repayment')),
  amount integer not null check (amount > 0),
  taxable boolean not null default true,
  note text,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  check (extract(day from period) = 1)
);
create index payroll_adjustments_period_idx on payroll_adjustments (organisation_id, period);

-- Row-level security
do $$
declare t text;
begin
  foreach t in array array['attendance_records', 'leave_requests', 'permission_requests'] loop
    execute format('alter table %I enable row level security', t);
    execute format('grant select, insert, update, delete on %I to hf_app', t);
    execute format($f$create policy p_staff on %I for all using (hf_staff_pred(organisation_id, clinic_id, true)) with check (hf_staff_pred(organisation_id, clinic_id, true))$f$, t);
  end loop;
  foreach t in array array['employment_contracts', 'public_holidays', 'leave_types', 'leave_balances', 'payroll_runs', 'payslips', 'payroll_adjustments'] loop
    execute format('alter table %I enable row level security', t);
    execute format('grant select, insert, update, delete on %I to hf_app', t);
    execute format($f$create policy p_staff on %I for all using (hf_staff_pred(organisation_id, null, false)) with check (hf_staff_pred(organisation_id, null, false))$f$, t);
  end loop;
end $$;

-- Tenant-bound foreign keys for the new tables (migration 0011 rule).
do $$
declare
  r record;
  uq text;
begin
  for r in
    select c.conname, c.conrelid::regclass::text as child, c.confrelid::regclass::text as parent, a.attname as col, pa.attname as pcol
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    join pg_attribute pa on pa.attrelid = c.confrelid and pa.attnum = c.confkey[1]
    where c.contype = 'f' and array_length(c.conkey, 1) = 1 and c.connamespace = 'public'::regnamespace
      and a.attname <> 'organisation_id' and c.confrelid::regclass::text <> 'organisations'
      and c.conrelid::regclass::text in ('employment_contracts', 'public_holidays', 'attendance_records', 'leave_types', 'leave_balances',
                                         'leave_requests', 'permission_requests', 'payroll_runs', 'payslips', 'payroll_adjustments')
  loop
    uq := r.parent || '_org_' || r.pcol || '_uq';
    if not exists (select 1 from pg_constraint where conname = uq) then
      execute format('alter table %I add constraint %I unique (organisation_id, %I)', r.parent, uq, r.pcol);
    end if;
    execute format('alter table %I add constraint %I foreign key (organisation_id, %I) references %I (organisation_id, %I)',
                   r.child, r.child || '_' || r.col || '_org_fk', r.col, r.parent, r.pcol);
  end loop;
end $$;

-- Default leave types for every existing organisation (new organisations get them on first use of the HR API).
insert into leave_types (organisation_id, code, name_ar, name_en, paid, uses_annual_balance, annual_quota, max_consecutive_days)
select o.id, v.code, v.name_ar, v.name_en, v.paid, v.uses_annual_balance, v.annual_quota, v.max_consecutive_days
from organisations o cross join (values
  ('annual', 'إجازة اعتيادية', 'Annual leave', true, true, null::numeric, null::numeric),
  ('casual', 'إجازة عارضة', 'Casual leave', true, true, 7, 2),
  ('sick', 'إجازة مرضية', 'Sick leave', true, false, null, null),
  ('unpaid', 'إجازة بدون أجر', 'Unpaid leave', false, false, null, null),
  ('maternity', 'إجازة وضع', 'Maternity leave', true, false, 120, 120),
  ('hajj', 'إجازة حج', 'Hajj leave', true, false, 30, 30),
  ('exam', 'إجازة امتحانات', 'Exam leave', true, false, null, null),
  ('bereavement', 'إجازة وفاة', 'Bereavement leave', true, false, 3, 3)
) as v(code, name_ar, name_en, paid, uses_annual_balance, annual_quota, max_consecutive_days)
on conflict do nothing;
