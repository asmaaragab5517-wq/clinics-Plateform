-- Sprint 21: night overtime (paid at its own rate) and the unused-leave payout when employment ends.
alter table attendance_records add column overtime_night_minutes integer not null default 0;
alter table payroll_adjustments drop constraint payroll_adjustments_kind_check;
alter table payroll_adjustments add constraint payroll_adjustments_kind_check
  check (kind in ('bonus', 'allowance', 'overtime', 'reimbursement', 'deduction', 'advance', 'advance_repayment', 'leave_encashment'));
