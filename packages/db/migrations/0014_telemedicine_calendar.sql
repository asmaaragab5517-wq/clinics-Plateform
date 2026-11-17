-- Telemedicine (BR-13, FR-TEL-*) and Google Calendar sync (FR-INT-2).
create table oauth_connections (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  user_id uuid not null references users(id),
  provider text not null check (provider in ('google')),
  scopes text[] not null default '{}',
  tokens_enc bytea not null,
  account_email text,
  settings jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (user_id, provider)
);

create table telemedicine_sessions (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  clinic_id uuid not null references clinics(id),
  appointment_id uuid not null unique references appointments(id),
  patient_id uuid not null references patients(id),
  doctor_id uuid not null references users(id),
  provider text not null,
  meeting_id text not null,
  host_url_enc bytea not null,
  join_url_enc bytea not null,
  passcode_enc bytea,
  status text not null default 'scheduled' check (status in ('scheduled','patient_waiting','in_progress','ended','cancelled')),
  patient_joined_at timestamptz,
  admitted_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now()
);

create table calendar_sync (
  organisation_id uuid not null references organisations(id),
  appointment_id uuid not null references appointments(id),
  doctor_id uuid not null references users(id),
  event_id text,
  fingerprint text,
  synced_at timestamptz not null default now(),
  primary key (appointment_id, doctor_id)
);

do $$
declare t text;
begin
  foreach t in array array['oauth_connections','calendar_sync'] loop
    execute format('alter table %I enable row level security', t);
    execute format('grant select, insert, update, delete on %I to hf_app', t);
    execute format($f$create policy p_staff on %I for all using (hf_staff_pred(organisation_id, null, false)) with check (hf_staff_pred(organisation_id, null, false))$f$, t);
  end loop;
end $$;
alter table telemedicine_sessions enable row level security;
grant select, insert, update, delete on telemedicine_sessions to hf_app;
create policy p_staff on telemedicine_sessions for all using (hf_staff_pred(organisation_id, clinic_id, true)) with check (hf_staff_pred(organisation_id, clinic_id, true));
create policy p_patient on telemedicine_sessions for select using (organisation_id = app_org() and app_mode() = 'patient' and patient_id = any(app_patients()));

-- OAuth callbacks arrive without a tenant; the signed state names the user, this resolves the org.
create or replace function user_org(p_user uuid) returns table (organisation_id uuid)
language sql stable security definer set search_path = public as $$ select organisation_id from users where id = p_user and status = 'active' $$;
revoke all on function user_org from public;
grant execute on function user_org to hf_app;

-- Tenant-bound FKs for the new tables (same rule as migration 0011).
alter table telemedicine_sessions add constraint tele_appt_org foreign key (organisation_id, appointment_id) references appointments (organisation_id, id);
alter table telemedicine_sessions add constraint tele_patient_org foreign key (organisation_id, patient_id) references patients (organisation_id, id);
alter table telemedicine_sessions add constraint tele_doctor_org foreign key (organisation_id, doctor_id) references users (organisation_id, id);
alter table telemedicine_sessions add constraint tele_clinic_org foreign key (organisation_id, clinic_id) references clinics (organisation_id, id);
alter table oauth_connections add constraint oauth_user_org foreign key (organisation_id, user_id) references users (organisation_id, id);
alter table calendar_sync add constraint cal_appt_org foreign key (organisation_id, appointment_id) references appointments (organisation_id, id);
alter table calendar_sync add constraint cal_doctor_org foreign key (organisation_id, doctor_id) references users (organisation_id, id);

-- One-time OAuth state nonces (FR-TEL-3): not visible to the app role, only through these functions.
create table oauth_states (
  nonce text primary key,
  user_id uuid not null references users(id),
  purpose text not null,
  expires_at timestamptz not null,
  used_at timestamptz
);
create or replace function create_oauth_state(p_nonce text, p_user uuid, p_purpose text) returns void
language sql security definer set search_path = public as $$
  insert into oauth_states (nonce, user_id, purpose, expires_at) values (p_nonce, p_user, p_purpose, now() + interval '10 minutes')
$$;
create or replace function consume_oauth_state(p_nonce text, p_purpose text) returns table (user_id uuid)
language sql security definer set search_path = public as $$
  update oauth_states set used_at = now() where nonce = p_nonce and purpose = p_purpose and used_at is null and expires_at > now() returning user_id
$$;
revoke all on function create_oauth_state, consume_oauth_state from public;
grant execute on function create_oauth_state, consume_oauth_state to hf_app;
