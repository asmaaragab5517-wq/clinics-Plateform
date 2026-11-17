-- SaaS platform administration (BR-20, FR-ADM-1) and public API keys (FR-INT-3).
-- Platform tables have no organisation_id; the app role reaches them only through SECURITY DEFINER functions.
create table platform_admins (
  id uuid primary key default uuid_generate_v7(),
  keycloak_sub text not null unique,
  email text not null unique,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create table plans (
  code text primary key,
  name_ar text not null,
  name_en text not null,
  monthly_price integer not null,
  limits jsonb not null default '{}', -- clinics, staff, smsPerMonth, storageGb
  is_active boolean not null default true
);
create table org_subscriptions (
  organisation_id uuid primary key references organisations(id),
  plan_code text not null references plans(code),
  status text not null default 'trial' check (status in ('trial','active','past_due','cancelled')),
  current_period_end date not null,
  updated_at timestamptz not null default now()
);
create table platform_invoices (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  period_start date not null,
  period_end date not null,
  plan_code text not null,
  amount integer not null,
  usage jsonb not null default '{}',
  status text not null default 'open' check (status in ('open','paid','void')),
  checkout_url text,
  provider_order_id text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organisation_id, period_start)
);
create table platform_announcements (
  id uuid primary key default uuid_generate_v7(),
  title_ar text not null,
  title_en text not null default '',
  body_ar text not null,
  body_en text not null default '',
  severity text not null default 'info' check (severity in ('info','warning','maintenance')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_by uuid references platform_admins(id),
  created_at timestamptz not null default now()
);
create table support_access (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  admin_id uuid not null references platform_admins(id),
  reason text not null,
  hours integer not null check (hours between 1 and 72),
  status text not null default 'requested' check (status in ('requested','approved','rejected','revoked','expired')),
  decided_by uuid references users(id),
  decided_at timestamptz,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now()
);
create table api_keys (
  id uuid primary key default uuid_generate_v7(),
  organisation_id uuid not null references organisations(id),
  name text not null,
  prefix text not null,
  key_hash text not null unique,
  scopes text[] not null,
  expires_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);
alter table api_keys enable row level security;
grant select, insert, update on api_keys to hf_app;
create policy p_staff on api_keys for all using (hf_staff_pred(organisation_id, null, false)) with check (hf_staff_pred(organisation_id, null, false));
alter table support_access enable row level security;
grant select, update on support_access to hf_app;
create policy p_staff on support_access for all using (hf_staff_pred(organisation_id, null, false)) with check (hf_staff_pred(organisation_id, null, false));
grant select on platform_announcements to hf_app; -- shown to every staff user; contains no tenant data

-- ---- Identity lookups (pre-tenant)
create or replace function platform_admin_identity(p_sub text) returns table (id uuid, email text, name text)
language sql stable security definer set search_path = public as $$ select id, email, name from platform_admins where keycloak_sub = p_sub and is_active $$;
create or replace function api_key_identity(p_hash text) returns table (id uuid, organisation_id uuid, scopes text[])
language sql security definer set search_path = public as $$
  update api_keys k set last_used_at = now() from organisations o
  where k.key_hash = p_hash and k.revoked_at is null and (k.expires_at is null or k.expires_at > now()) and o.id = k.organisation_id and o.status = 'active'
  returning k.id, k.organisation_id, k.scopes
$$;
create or replace function support_identity(p_access uuid, p_admin uuid) returns table (organisation_id uuid, ends_at timestamptz)
language sql stable security definer set search_path = public as $$
  select organisation_id, ends_at from support_access where id = p_access and admin_id = p_admin and status = 'approved' and now() between starts_at and ends_at
$$;

-- ---- Platform operations (called only from platform-admin routes)
create or replace function platform_orgs() returns table (id uuid, slug text, name_ar text, name_en text, status text, created_at timestamptz, plan_code text, sub_status text, period_end date,
  clinics int, staff int, patients int, appointments_30d int, sms_segments_30d int, sms_cost_30d int, storage_bytes bigint)
language sql stable security definer set search_path = public as $$
  select o.id, o.slug, o.name_ar, o.name_en, o.status, o.created_at, s.plan_code, s.status, s.current_period_end,
    (select count(*)::int from clinics c where c.organisation_id = o.id and c.is_active),
    (select count(*)::int from users u where u.organisation_id = o.id and u.status = 'active'),
    (select count(*)::int from patients p where p.organisation_id = o.id and p.merged_into_id is null),
    (select count(*)::int from appointments a where a.organisation_id = o.id and a.created_at > now() - interval '30 days'),
    (select coalesce(sum(segments), 0)::int from messages m where m.organisation_id = o.id and m.channel = 'sms' and m.created_at > now() - interval '30 days'),
    (select coalesce(sum(cost), 0)::int from messages m where m.organisation_id = o.id and m.created_at > now() - interval '30 days'),
    (select coalesce(sum(size_bytes), 0)::bigint from documents d where d.organisation_id = o.id)
  from organisations o left join org_subscriptions s on s.organisation_id = o.id order by o.created_at
$$;

create or replace function platform_create_org(p_slug text, p_name_ar text, p_name_en text, p_plan text, p_owner_email text, p_owner_name text, p_owner_sub text, p_trial_days int)
returns table (organisation_id uuid, owner_id uuid)
language plpgsql security definer set search_path = public as $$
declare org uuid; owner uuid;
begin
  insert into organisations (name_ar, name_en, slug, settings) values (p_name_ar, p_name_en, p_slug,
    '{"defaultLocale":"ar","digitStyle":"western","booking":{"leadMinutes":60,"cancellationCutoffHours":6,"maxReschedules":2,"depositPercent":100,"holdMinutes":10,"noShowAfterMinutes":30},"reminders":{"hoursBefore":[24,2]},"discountApprovalPercent":20,"shiftVarianceThreshold":1000,"queueNotifyPositions":3,"mrnFormat":"HF-{n:6}"}')
    returning id into org;
  insert into users (organisation_id, keycloak_sub, email, name_ar, name_en, status) values (org, p_owner_sub, p_owner_email, p_owner_name, p_owner_name, 'active') returning id into owner;
  insert into staff_memberships (organisation_id, user_id, clinic_id, role) values (org, owner, null, 'owner');
  insert into org_subscriptions (organisation_id, plan_code, status, current_period_end) values (org, p_plan, 'trial', current_date + p_trial_days);
  insert into consent_versions (organisation_id, type, version, text_ar, text_en)
    select org, t, 1, 'نص الموافقة - مسودة تنتظر مراجعة المستشار القانوني.', 'Consent text - draft pending counsel review.'
    from unnest(array['health_data','messaging','marketing','telemedicine','itqan_sharing']) t;
  return query select org, owner;
end $$;

create or replace function platform_set_org(p_org uuid, p_status text, p_plan text, p_sub_status text, p_period_end date) returns void
language sql security definer set search_path = public as $$
  update organisations set status = coalesce(p_status, status) where id = p_org;
  update org_subscriptions set plan_code = coalesce(p_plan, plan_code), status = coalesce(p_sub_status, status), current_period_end = coalesce(p_period_end, current_period_end), updated_at = now() where organisation_id = p_org;
$$;

create or replace function platform_request_support(p_org uuid, p_admin uuid, p_reason text, p_hours int) returns uuid
language sql security definer set search_path = public as $$
  insert into support_access (organisation_id, admin_id, reason, hours) values (p_org, p_admin, p_reason, p_hours) returning id
$$;
create or replace function platform_support_list(p_admin uuid) returns setof support_access
language sql stable security definer set search_path = public as $$ select * from support_access where admin_id = p_admin order by created_at desc limit 200 $$;

create or replace function platform_upsert_invoice(p_org uuid, p_start date, p_end date) returns setof platform_invoices
language plpgsql security definer set search_path = public as $$
declare s org_subscriptions; pl plans; seg int; extra int;
begin
  select * into s from org_subscriptions where organisation_id = p_org;
  if s is null then return; end if;
  select * into pl from plans where code = s.plan_code;
  select coalesce(sum(segments), 0) into seg from messages where organisation_id = p_org and channel = 'sms' and created_at >= p_start and created_at < p_end + 1;
  extra := greatest(0, seg - coalesce((pl.limits->>'smsPerMonth')::int, 0)) * coalesce((pl.limits->>'smsOveragePrice')::int, 0);
  return query insert into platform_invoices (organisation_id, period_start, period_end, plan_code, amount, usage)
    values (p_org, p_start, p_end, pl.code, pl.monthly_price + extra, jsonb_build_object('smsSegments', seg, 'smsOverage', extra))
    on conflict (organisation_id, period_start) do update set amount = excluded.amount, usage = excluded.usage where platform_invoices.status = 'open'
    returning *;
end $$;
create or replace function platform_invoice_checkout(p_id uuid, p_order text, p_url text) returns void
language sql security definer set search_path = public as $$ update platform_invoices set provider_order_id = p_order, checkout_url = p_url where id = p_id and status = 'open' $$;
create or replace function platform_invoice_paid(p_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare org uuid;
begin
  update platform_invoices set status = 'paid', paid_at = now() where id = p_id and status = 'open' returning organisation_id into org;
  if org is not null then
    update org_subscriptions set status = 'active', current_period_end = greatest(current_period_end, (select period_end from platform_invoices where id = p_id) + 30) where organisation_id = org;
  end if;
  return org;
end $$;
create or replace function platform_invoices_for(p_org uuid) returns setof platform_invoices
language sql stable security definer set search_path = public as $$ select * from platform_invoices where p_org is null or organisation_id = p_org order by period_start desc limit 500 $$;
create or replace function platform_announce(p_admin uuid, p_title_ar text, p_title_en text, p_body_ar text, p_body_en text, p_severity text, p_starts timestamptz, p_ends timestamptz) returns uuid
language sql security definer set search_path = public as $$
  insert into platform_announcements (title_ar, title_en, body_ar, body_en, severity, starts_at, ends_at, created_by) values (p_title_ar, p_title_en, p_body_ar, p_body_en, p_severity, p_starts, p_ends, p_admin) returning id
$$;
create or replace function platform_admin_sub(p_email text) returns table (keycloak_sub text)
language sql stable security definer set search_path = public as $$ select keycloak_sub from platform_admins where email = p_email and is_active $$;
create or replace function platform_plans() returns setof plans language sql stable security definer set search_path = public as $$ select * from plans order by monthly_price $$;
create or replace function org_subscription() returns table (plan_code text, status text, current_period_end date, limits jsonb, name_ar text, name_en text)
language sql stable security definer set search_path = public as $$
  select s.plan_code, s.status, s.current_period_end, p.limits, p.name_ar, p.name_en from org_subscriptions s join plans p on p.code = s.plan_code where s.organisation_id = app_org()
$$;

revoke all on function platform_admin_identity, api_key_identity, support_identity, platform_orgs, platform_create_org, platform_set_org, platform_request_support,
  platform_support_list, platform_upsert_invoice, platform_invoice_checkout, platform_invoice_paid, platform_invoices_for, platform_announce, org_subscription, platform_plans, platform_admin_sub from public;
grant execute on function platform_admin_identity, api_key_identity, support_identity, platform_orgs, platform_create_org, platform_set_org, platform_request_support,
  platform_support_list, platform_upsert_invoice, platform_invoice_checkout, platform_invoice_paid, platform_invoices_for, platform_announce, org_subscription, platform_plans, platform_admin_sub to hf_app;

insert into plans (code, name_ar, name_en, monthly_price, limits) values
  ('starter', 'الأساسية', 'Starter', 150000, '{"clinics":1,"staff":10,"smsPerMonth":1000,"smsOveragePrice":30,"storageGb":10}'),
  ('network', 'الشبكة', 'Network', 450000, '{"clinics":5,"staff":60,"smsPerMonth":5000,"smsOveragePrice":25,"storageGb":100}'),
  ('enterprise', 'المؤسسات', 'Enterprise', 1200000, '{"clinics":50,"staff":500,"smsPerMonth":30000,"smsOveragePrice":20,"storageGb":1000}');
-- Existing organisations (our own network) start on Enterprise.
insert into org_subscriptions (organisation_id, plan_code, status, current_period_end) select id, 'enterprise', 'active', current_date + 365 from organisations on conflict do nothing;
