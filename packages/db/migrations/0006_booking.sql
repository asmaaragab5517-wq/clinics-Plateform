-- Capacity slot indexes already taken for a doctor's time range (booking from patient sessions cannot see other patients' rows).
create or replace function used_slot_indexes(p_doctor uuid, p_start timestamptz, p_end timestamptz, p_exclude uuid default null)
returns setof smallint language sql stable security definer set search_path = public as $$
  select a.slot_index from appointments a
  where a.organisation_id = app_org() and a.doctor_id = p_doctor and a.id is distinct from p_exclude
    and tstzrange(a.start_at, a.end_at) && tstzrange(p_start, p_end)
    and a.status in ('requested','booked','confirmed','checked_in','in_consultation','completed') and not a.is_walk_in
$$;
revoke all on function used_slot_indexes from public;
grant execute on function used_slot_indexes to hf_app;

create index if not exists appointments_doctor_time_idx on appointments using gist (doctor_id, tstzrange(start_at, end_at));
create index if not exists messages_queue_idx on messages (status, scheduled_for) where status = 'queued';
