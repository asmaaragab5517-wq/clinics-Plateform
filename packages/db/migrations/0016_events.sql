-- Patient voice and safety registers feeding ITQAN (BR-18, FR-INT-1, FR-REV-3).
create table complaints (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  clinic_id uuid not null references clinics(id),
  patient_id uuid references patients(id),
  channel text not null check (channel in ('reception','phone','portal','app','email','review')),
  category text not null check (category in ('waiting_time','staff_behaviour','clinical_care','billing','facility','communication','other')),
  description text not null,
  status text not null default 'open' check (status in ('open','in_progress','resolved','closed')),
  resolution text,
  created_at timestamptz not null default now(), created_by uuid,
  resolved_at timestamptz
);
create table incidents (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  clinic_id uuid not null references clinics(id),
  patient_id uuid references patients(id),
  category text not null check (category in ('medication_error','fall','misidentification','infection_control','equipment','privacy','other')),
  severity text not null check (severity in ('near_miss','no_harm','minor','moderate','severe','death')),
  description text not null,
  occurred_at timestamptz not null,
  actions_taken text,
  status text not null default 'reported' check (status in ('reported','investigating','closed')),
  created_at timestamptz not null default now(), created_by uuid
);
create table webhook_endpoints (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  name text not null,
  url text not null,
  secret_enc bytea not null,
  events text[] not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create table outbound_events (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  endpoint_id uuid not null references webhook_endpoints(id) on delete cascade,
  event text not null,
  payload jsonb not null,
  status text not null default 'queued' check (status in ('queued','delivered','failed')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_status integer,
  delivered_at timestamptz,
  created_at timestamptz not null default now()
);
create index outbound_events_queue_idx on outbound_events (status, next_attempt_at);

alter table complaints enable row level security;
alter table incidents enable row level security;
grant select, insert, update, delete on complaints, incidents to hf_app;
create policy p_staff on complaints for all using (hf_staff_pred(organisation_id, clinic_id, true)) with check (hf_staff_pred(organisation_id, clinic_id, true));
create policy p_patient on complaints for all using (organisation_id = app_org() and app_mode() = 'patient' and patient_id = any(app_patients())) with check (organisation_id = app_org() and app_mode() = 'patient' and patient_id = any(app_patients()));
create policy p_staff on incidents for all using (hf_staff_pred(organisation_id, clinic_id, true)) with check (hf_staff_pred(organisation_id, clinic_id, true));
do $$
declare t text;
begin
  foreach t in array array['webhook_endpoints','outbound_events'] loop
    execute format('alter table %I enable row level security', t);
    execute format('grant select, insert, update, delete on %I to hf_app', t);
    execute format($f$create policy p_staff on %I for all using (hf_staff_pred(organisation_id, null, false)) with check (hf_staff_pred(organisation_id, null, false))$f$, t);
  end loop;
end $$;
alter table complaints add constraint complaints_clinic_org foreign key (organisation_id, clinic_id) references clinics (organisation_id, id);
alter table complaints add constraint complaints_patient_org foreign key (organisation_id, patient_id) references patients (organisation_id, id);
alter table incidents add constraint incidents_clinic_org foreign key (organisation_id, clinic_id) references clinics (organisation_id, id);
alter table incidents add constraint incidents_patient_org foreign key (organisation_id, patient_id) references patients (organisation_id, id);
alter table webhook_endpoints add constraint webhook_endpoints_org_id_uq unique (organisation_id, id);
alter table outbound_events add constraint outbound_events_endpoint_org foreign key (organisation_id, endpoint_id) references webhook_endpoints (organisation_id, id);
