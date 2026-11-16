alter table messages add column attempts integer not null default 0;
create index if not exists appointments_start_status_idx on appointments (status, start_at);
create index if not exists follow_ups_due_idx on follow_ups (status, due_date);
