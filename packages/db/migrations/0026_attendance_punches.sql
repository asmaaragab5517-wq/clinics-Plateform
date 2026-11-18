-- Sprint 21: several clock-in/out pairs per day (split shifts, stepping out). clock_in/clock_out keep the first
-- arrival and the last departure (null while a pair is open) for reports and older clients.
alter table attendance_records add column punches jsonb not null default '[]';
update attendance_records set punches = jsonb_build_array(jsonb_build_object('in', clock_in, 'out', clock_out))
where clock_in is not null;
