-- Row-level security (MT-1..MT-4, SEC-1). Deny by default: the application role has no BYPASSRLS
-- and does not own any table; every business table has RLS enabled with explicit policies.
--
-- Session settings (set per transaction by the API, see packages/db/src/tenant.ts):
--   app.org_id      organisation of the request
--   app.mode        staff | patient | public | system
--   app.network     on when the staff user holds a network role (owner/director/accountant)
--   app.clinic_ids  comma list of clinic memberships (staff)
--   app.patient_ids comma list of patients the patient account may access (self + confirmed links)
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'hf_app') then
    create role hf_app nologin nobypassrls;
  end if;
end $$;

grant usage on schema public to hf_app;
grant select on specialties, icd10_codes, drugs, lab_tests to hf_app;

create or replace function hf_staff_pred(org uuid, clinic uuid, clinic_scoped boolean) returns boolean
language sql stable as $$
  select org = app_org()
     and app_mode() in ('staff', 'system')
     and (not clinic_scoped or app_mode() = 'system' or app_is_network() or clinic = any(app_clinics()))
$$;

do $$
declare
  t text;
  -- Class A: public catalogue (readable by public/patient sessions of the org, writable by staff)
  public_org text[] := array['clinic_specialties','doctor_profiles','doctor_specialties','services','doctor_services',
                             'packages','schedule_profiles','articles','consent_versions','custom_field_defs','feature_flags'];
  public_clinic text[] := array['price_list_items','doctor_sessions'];
  -- Class B: staff/system only
  staff_org text[] := array['legal_entities','secret_settings','number_sequences','staff_memberships','encounter_templates',
                            'prescription_templates','otp_codes','refresh_tokens','patient_accounts','commission_rules',
                            'commission_statements','provider_transactions','reconciliation_runs','message_templates',
                            'message_events','device_tokens','breaches','import_batches','import_rows'];
  staff_clinic text[] := array['cashier_shifts','appointment_events','approval_requests','tasks'];
  -- Class C: patient data (staff scoped + patient self/family access)
  patient_org text[] := array['patient_contacts','patient_links','encounters','addenda','medical_history_items','orders',
                              'documents','prescriptions','package_balances','package_consumptions','messages',
                              'notification_preferences','consents','data_requests'];
  patient_clinic text[] := array['appointments','queue_tickets','waitlist','follow_ups','bills','credit_notes','payments',
                                 'refunds','payment_intents','reviews'];
begin
  foreach t in array public_org || public_clinic || staff_org || staff_clinic || patient_org || patient_clinic loop
    execute format('alter table %I enable row level security', t);
    execute format('grant select, insert, update, delete on %I to hf_app', t);
  end loop;

  foreach t in array public_org loop
    execute format($f$create policy p_read on %I for select using (organisation_id = app_org() and app_mode() in ('public','patient'))$f$, t);
    execute format($f$create policy p_staff on %I for all using (hf_staff_pred(organisation_id, null, false)) with check (hf_staff_pred(organisation_id, null, false))$f$, t);
  end loop;
  foreach t in array public_clinic loop
    execute format($f$create policy p_read on %I for select using (organisation_id = app_org() and app_mode() in ('public','patient'))$f$, t);
    execute format($f$create policy p_staff on %I for all using (hf_staff_pred(organisation_id, clinic_id, true)) with check (hf_staff_pred(organisation_id, clinic_id, true))$f$, t);
  end loop;
  foreach t in array staff_org loop
    execute format($f$create policy p_staff on %I for all using (hf_staff_pred(organisation_id, null, false)) with check (hf_staff_pred(organisation_id, null, false))$f$, t);
  end loop;
  foreach t in array staff_clinic loop
    execute format($f$create policy p_staff on %I for all using (hf_staff_pred(organisation_id, clinic_id, true)) with check (hf_staff_pred(organisation_id, clinic_id, true))$f$, t);
  end loop;
  foreach t in array patient_org loop
    execute format($f$create policy p_staff on %I for all using (hf_staff_pred(organisation_id, null, false)) with check (hf_staff_pred(organisation_id, null, false))$f$, t);
    execute format($f$create policy p_patient on %I for all using (organisation_id = app_org() and app_mode() = 'patient' and patient_id = any(app_patients())) with check (organisation_id = app_org() and app_mode() = 'patient' and patient_id = any(app_patients()))$f$, t);
  end loop;
  foreach t in array patient_clinic loop
    execute format($f$create policy p_staff on %I for all using (hf_staff_pred(organisation_id, clinic_id, true)) with check (hf_staff_pred(organisation_id, clinic_id, true))$f$, t);
    execute format($f$create policy p_patient on %I for all using (organisation_id = app_org() and app_mode() = 'patient' and patient_id = any(app_patients())) with check (organisation_id = app_org() and app_mode() = 'patient' and patient_id = any(app_patients()))$f$, t);
  end loop;
end $$;

-- Schedule exceptions: clinic_id may be null (doctor leave applies everywhere).
alter table schedule_exceptions enable row level security;
grant select, insert, update, delete on schedule_exceptions to hf_app;
create policy p_read on schedule_exceptions for select using (organisation_id = app_org() and app_mode() in ('public','patient'));
create policy p_staff on schedule_exceptions for all
  using (hf_staff_pred(organisation_id, clinic_id, clinic_id is not null))
  with check (hf_staff_pred(organisation_id, clinic_id, clinic_id is not null));

-- Clinics: public catalogue; staff without network role see only member clinics.
alter table clinics enable row level security;
grant select, insert, update, delete on clinics to hf_app;
create policy p_read on clinics for select using (organisation_id = app_org() and app_mode() in ('public','patient') and is_public and is_active);
create policy p_staff on clinics for all using (hf_staff_pred(organisation_id, id, true)) with check (hf_staff_pred(organisation_id, id, true));

-- Organisations: a session sees only its own organisation.
alter table organisations enable row level security;
grant select, update on organisations to hf_app;
create policy p_read on organisations for select using (id = app_org());
create policy p_update on organisations for update using (id = app_org() and app_mode() in ('staff','system')) with check (id = app_org());

-- Users: staff see their organisation; public sessions see only public doctors (names only are selected by the API).
alter table users enable row level security;
grant select, insert, update, delete on users to hf_app;
create policy p_staff on users for all using (hf_staff_pred(organisation_id, null, false)) with check (hf_staff_pred(organisation_id, null, false));
create policy p_read on users for select using (
  organisation_id = app_org() and app_mode() in ('public','patient')
  and exists (select 1 from doctor_profiles d where d.user_id = users.id and d.is_public));

-- Patients: the row itself.
alter table patients enable row level security;
grant select, insert, update, delete on patients to hf_app;
create policy p_staff on patients for all using (hf_staff_pred(organisation_id, null, false)) with check (hf_staff_pred(organisation_id, null, false));
create policy p_patient on patients for all
  using (organisation_id = app_org() and app_mode() = 'patient' and id = any(app_patients()))
  with check (organisation_id = app_org() and app_mode() = 'patient' and id = any(app_patients()));

-- Approved reviews are public.
create policy p_public_read on reviews for select using (organisation_id = app_org() and status = 'approved' and app_mode() in ('public','patient'));

-- Child tables inherit visibility from their parent row (subquery is itself RLS-filtered).
do $$
declare r record;
begin
  for r in select * from (values
      ('appointment_services', 'appointments', 'appointment_id'),
      ('prescription_lines', 'prescriptions', 'prescription_id'),
      ('bill_lines', 'bills', 'bill_id')) v(child, parent, fk)
  loop
    execute format('alter table %I enable row level security', r.child);
    execute format('grant select, insert, update, delete on %I to hf_app', r.child);
    execute format($f$create policy p_parent on %I for all
      using (organisation_id = app_org() and exists (select 1 from %I p where p.id = %I))
      with check (organisation_id = app_org() and exists (select 1 from %I p where p.id = %I))$f$,
      r.child, r.parent, r.fk, r.parent, r.fk);
  end loop;
end $$;

-- Audit log: readable by staff of the organisation (privilege enforced in API); written only via audit_append().
alter table audit_log enable row level security;
grant select on audit_log to hf_app;
create policy p_staff on audit_log for select using (hf_staff_pred(organisation_id, null, false));
