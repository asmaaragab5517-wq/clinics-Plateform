-- Sprint 20: clock-in location verdicts and an explicit overtime decision.
-- Only the verdict and distance are stored, never raw coordinates or IP addresses.
alter table attendance_records
  add column clock_in_check text check (clock_in_check in ('ok', 'outside', 'unverified')),
  add column clock_in_check_detail jsonb,
  add column clock_out_check text check (clock_out_check in ('ok', 'outside', 'unverified')),
  add column clock_out_check_detail jsonb,
  add column overtime_status text not null default 'pending' check (overtime_status in ('pending', 'approved', 'rejected')),
  add column overtime_decided_by uuid references users(id),
  add column overtime_decided_at timestamptz;
update attendance_records set overtime_status = 'approved' where overtime_approved;
alter table attendance_records add constraint attendance_overtime_consistent check (overtime_approved = (overtime_status = 'approved'));
alter table attendance_records add constraint attendance_records_overtime_decided_by_org_fk foreign key (organisation_id, overtime_decided_by) references users (organisation_id, id);
