-- Dental chart per visit (FR-EMR-3 Dentistry, R2)
alter table encounters add column dental_chart jsonb;

-- Cached next free online slot per doctor and clinic, refreshed by the worker (FR-WEB-2 "next available").
create table doctor_next_slot (
  organisation_id uuid not null references organisations(id),
  doctor_id uuid not null references users(id),
  clinic_id uuid not null references clinics(id),
  next_start timestamptz,
  computed_at timestamptz not null default now(),
  primary key (doctor_id, clinic_id)
);
alter table doctor_next_slot enable row level security;
grant select, insert, update, delete on doctor_next_slot to hf_app;
create policy p_read on doctor_next_slot for select using (organisation_id = app_org() and app_mode() in ('public','patient'));
create policy p_staff on doctor_next_slot for all using (hf_staff_pred(organisation_id, null, false)) with check (hf_staff_pred(organisation_id, null, false));
alter table doctor_next_slot add constraint dns_doctor_org foreign key (organisation_id, doctor_id) references users (organisation_id, id);
alter table doctor_next_slot add constraint dns_clinic_org foreign key (organisation_id, clinic_id) references clinics (organisation_id, id);

-- Push deep links: structured data delivered with the notification (path convention in docs/integrations/push.md).
alter table messages add column data jsonb;
