-- Sprint 18: prescription revocation details, patient-submitted insurance cover awaiting verification.
alter table prescriptions
  add column revoked_at timestamptz,
  add column revoked_reason text,
  add column revoked_by uuid references users(id);

alter table patient_coverages
  add column source text not null default 'staff' check (source in ('staff', 'patient')),
  add column verified_at timestamptz,
  add column verified_by uuid references users(id);
-- Cover entered by staff before this migration counts as verified.
update patient_coverages set verified_at = created_at where verified_at is null;
create index patient_coverages_unverified_idx on patient_coverages (organisation_id) where verified_at is null;
