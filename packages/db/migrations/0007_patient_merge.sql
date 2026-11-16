-- Patient merge with a 30-day un-merge window (FR-PAT-5).
create table patient_merges (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  source_patient_id uuid not null references patients(id),
  target_patient_id uuid not null references patients(id),
  moved jsonb not null,
  reason text,
  merged_at timestamptz not null default now(),
  merged_by uuid,
  unmerged_at timestamptz,
  unmerged_by uuid
);
alter table patient_merges enable row level security;
grant select, insert, update on patient_merges to hf_app;
create policy p_staff on patient_merges for all using (hf_staff_pred(organisation_id, null, false)) with check (hf_staff_pred(organisation_id, null, false));

-- Time-boxed break-glass grants (IAM-5).
create table access_grants (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  user_id uuid not null references users(id),
  patient_id uuid not null references patients(id),
  reason text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table access_grants enable row level security;
grant select, insert on access_grants to hf_app;
create policy p_staff on access_grants for all using (hf_staff_pred(organisation_id, null, false)) with check (hf_staff_pred(organisation_id, null, false));

-- Organisation of a prescription for signed share links (the link itself carries no tenant).
create or replace function verify_rx_org(p_id uuid) returns table (organisation_id uuid)
language sql stable security definer set search_path = public as $$
  select organisation_id from prescriptions where id = p_id and status = 'issued'
$$;
revoke all on function verify_rx_org from public;
grant execute on function verify_rx_org to hf_app;
