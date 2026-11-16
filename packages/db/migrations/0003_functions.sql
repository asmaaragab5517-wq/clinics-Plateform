-- Tamper-evident audit log (FR-PRV-3): per-organisation sequence with SHA-256 hash chain, serialised writes.
create or replace function audit_canonical(a audit_log) returns text language sql immutable as $$
  select concat_ws('|', a.organisation_id::text, a.seq::text,
    to_char(a.at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
    a.actor_type, coalesce(a.actor_id::text, ''), coalesce(a.role, ''), a.action, a.entity,
    coalesce(a.entity_id, ''), coalesce(a.patient_id::text, ''), coalesce(a.clinic_id::text, ''),
    coalesce(a.ip, ''), coalesce(a.user_agent, ''), coalesce(a.reason, ''), coalesce(a.details::text, ''))
$$;

create or replace function audit_append(
  p_actor_type text, p_actor_id uuid, p_role text, p_action text, p_entity text, p_entity_id text,
  p_patient_id uuid, p_clinic_id uuid, p_ip text, p_user_agent text, p_reason text, p_details jsonb
) returns bigint language plpgsql security definer set search_path = public as $$
declare
  org uuid := app_org();
  last audit_log;
  rec audit_log;
begin
  if org is null then raise exception 'audit_append requires app.org_id'; end if;
  perform pg_advisory_xact_lock(hashtextextended('audit:' || org::text, 0));
  select * into last from audit_log where organisation_id = org order by seq desc limit 1;
  rec.organisation_id := org;
  rec.seq := coalesce(last.seq, 0) + 1;
  rec.at := date_trunc('microseconds', clock_timestamp());
  rec.actor_type := p_actor_type; rec.actor_id := p_actor_id; rec.role := p_role;
  rec.action := p_action; rec.entity := p_entity; rec.entity_id := p_entity_id;
  rec.patient_id := p_patient_id; rec.clinic_id := p_clinic_id; rec.ip := p_ip; rec.user_agent := p_user_agent;
  rec.reason := p_reason; rec.details := p_details;
  rec.prev_hash := coalesce(last.hash, repeat('0', 64));
  rec.hash := encode(digest(rec.prev_hash || '|' || audit_canonical(rec), 'sha256'), 'hex');
  insert into audit_log select rec.*;
  return rec.seq;
end $$;

-- Returns the first sequence number whose hash does not verify, or null when the chain is intact.
create or replace function audit_verify(p_org uuid) returns bigint language plpgsql security definer set search_path = public as $$
declare
  r audit_log;
  prev text := repeat('0', 64);
  expect_seq bigint := 1;
begin
  for r in select * from audit_log where organisation_id = p_org order by seq loop
    if r.seq <> expect_seq or r.prev_hash <> prev
       or r.hash <> encode(digest(r.prev_hash || '|' || audit_canonical(r), 'sha256'), 'hex') then
      return r.seq;
    end if;
    prev := r.hash;
    expect_seq := expect_seq + 1;
  end loop;
  return null;
end $$;

create or replace function audit_block_mutation() returns trigger language plpgsql as $$
begin raise exception 'audit_log is append-only'; end $$;
create trigger audit_no_update before update or delete or truncate on audit_log
  for each statement execute function audit_block_mutation();

-- Capacity-occupying bookings per doctor and slot start, without exposing patient rows (used by public slot search).
create or replace function slot_booked_counts(p_doctor_ids uuid[], p_from timestamptz, p_to timestamptz)
returns table (doctor_id uuid, start_at timestamptz, booked bigint)
language sql stable security definer set search_path = public as $$
  select a.doctor_id, a.start_at, count(*)
  from appointments a
  where a.organisation_id = app_org()
    and a.doctor_id = any(p_doctor_ids)
    and a.start_at >= p_from and a.start_at < p_to
    and a.status in ('requested','booked','confirmed','checked_in','in_consultation','completed')
    and not a.is_walk_in
  group by a.doctor_id, a.start_at
$$;

-- Atomic counters (MRN, receipt numbers, queue tickets).
create or replace function next_number(p_scope text) returns bigint language plpgsql security definer set search_path = public as $$
declare v bigint;
begin
  if app_org() is null then raise exception 'next_number requires app.org_id'; end if;
  insert into number_sequences (organisation_id, scope, value) values (app_org(), p_scope, 1)
  on conflict (organisation_id, scope) do update set value = number_sequences.value + 1
  returning value into v;
  return v;
end $$;

-- Public prescription verification shows validity only, never contents (FR-RX-5).
create or replace function verify_prescription(p_code text)
returns table (valid boolean, issued_at timestamptz, doctor_name text, clinic_name text)
language sql stable security definer set search_path = public as $$
  select p.status = 'issued', p.issued_at, u.name_ar, c.name_ar
  from prescriptions p join users u on u.id = p.doctor_id join clinics c on c.id = p.clinic_id
  where p.verify_code = p_code
$$;

revoke all on function audit_append, audit_verify, slot_booked_counts, next_number, verify_prescription from public;
grant execute on function audit_append, audit_verify, slot_booked_counts, next_number, verify_prescription to hf_app;
grant execute on function app_org, app_mode, app_is_network, app_clinics, app_patients, app_user, hf_staff_pred, uuid_generate_v7 to hf_app;
