-- Distinguish cover the patient withdrew from cover the clinic rejected (both are inactive and unverified).
alter table patient_coverages
  add column withdrawn_at timestamptz,
  add column rejected_at timestamptz;
