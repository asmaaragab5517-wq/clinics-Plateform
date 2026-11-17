-- AI assistance (BR-19, FR-EMR-9): doctor-approved drafts only; nothing is written to the record without approval.
create table ai_drafts (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  clinic_id uuid not null references clinics(id),
  patient_id uuid not null references patients(id),
  doctor_id uuid not null references users(id),
  encounter_id uuid references encounters(id),
  prescription_id uuid references prescriptions(id),
  kind text not null check (kind in ('encounter_note','patient_summary','rx_instructions')),
  source text not null check (source in ('text','audio','record')),
  input_enc bytea,                       -- dictation transcript, encrypted (PHI)
  output jsonb not null,
  warnings jsonb not null default '[]',
  model text not null,
  served_model text,
  prompt_version text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  status text not null default 'pending' check (status in ('pending','approved','rejected','expired')),
  decided_at timestamptz,
  applied jsonb,
  created_at timestamptz not null default now()
);
create index ai_drafts_encounter_idx on ai_drafts (encounter_id, created_at desc);
alter table ai_drafts enable row level security;
grant select, insert, update on ai_drafts to hf_app;
create policy p_staff on ai_drafts for all using (hf_staff_pred(organisation_id, clinic_id, true)) with check (hf_staff_pred(organisation_id, clinic_id, true));
alter table ai_drafts add constraint ai_clinic_org foreign key (organisation_id, clinic_id) references clinics (organisation_id, id);
alter table ai_drafts add constraint ai_patient_org foreign key (organisation_id, patient_id) references patients (organisation_id, id);
alter table ai_drafts add constraint ai_doctor_org foreign key (organisation_id, doctor_id) references users (organisation_id, id);
alter table ai_drafts add constraint ai_encounter_org foreign key (organisation_id, encounter_id) references encounters (organisation_id, id);
alter table ai_drafts add constraint ai_rx_org foreign key (organisation_id, prescription_id) references prescriptions (organisation_id, id);
