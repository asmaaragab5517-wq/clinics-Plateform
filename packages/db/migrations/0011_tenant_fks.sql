-- Tenant-bound foreign keys (MT-1 defence in depth). Plain FK checks run as the table owner and ignore RLS,
-- so a row could reference another organisation's entity. Every single-column FK between two
-- organisation-scoped tables gets a composite (organisation_id, fk) → (organisation_id, id) twin.
do $$
declare
  r record;
  uq text;
begin
  for r in
    select c.conname, c.conrelid::regclass::text as child, c.confrelid::regclass::text as parent,
           a.attname as col, pa.attname as pcol
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    join pg_attribute pa on pa.attrelid = c.confrelid and pa.attnum = c.confkey[1]
    where c.contype = 'f' and array_length(c.conkey, 1) = 1 and c.connamespace = 'public'::regnamespace
      and a.attname <> 'organisation_id'
      and c.confrelid::regclass::text <> 'organisations'
      and exists (select 1 from information_schema.columns x where x.table_schema = 'public' and x.table_name = c.conrelid::regclass::text and x.column_name = 'organisation_id')
      and exists (select 1 from information_schema.columns x where x.table_schema = 'public' and x.table_name = c.confrelid::regclass::text and x.column_name = 'organisation_id')
  loop
    uq := r.parent || '_org_' || r.pcol || '_uq';
    if not exists (select 1 from pg_constraint where conname = uq) then
      execute format('alter table %I add constraint %I unique (organisation_id, %I)', r.parent, uq, r.pcol);
    end if;
    execute format('alter table %I add constraint %I foreign key (organisation_id, %I) references %I (organisation_id, %I)',
      r.child, left(r.conname, 55) || '_org', r.col, r.parent, r.pcol);
  end loop;
end $$;
