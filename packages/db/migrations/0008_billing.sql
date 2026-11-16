alter table bills add column credited integer not null default 0;
alter table refunds add column method text;
alter table refunds add column reference text;
create index payments_shift_idx on payments (shift_id);
