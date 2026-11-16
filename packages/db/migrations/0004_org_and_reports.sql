-- Resolve an organisation before a tenant context exists (public site, OTP login).
create or replace function resolve_org(p_slug_or_domain text)
returns table (id uuid, slug text, name_ar text, name_en text, settings jsonb, branding jsonb)
language sql stable security definer set search_path = public as $$
  select id, slug, name_ar, name_en, settings, branding from organisations
  where status = 'active' and (slug = p_slug_or_domain or domain = p_slug_or_domain)
$$;
revoke all on function resolve_org from public;
grant execute on function resolve_org to hf_app;

-- Reporting materialised views (FR-RPT-4). Refreshed every 5 minutes by the worker.
-- Views bypass RLS, so the app role has no direct access; it reads them only via the scoped functions below.
create materialized view mv_appointments_daily as
  select a.organisation_id, a.clinic_id, a.doctor_id,
         (a.start_at at time zone 'Africa/Cairo')::date as day,
         a.status, a.channel, count(*)::int as n,
         count(distinct a.patient_id)::int as patients
  from appointments a
  group by 1, 2, 3, 4, 5, 6;
create unique index mv_appointments_daily_uq on mv_appointments_daily (organisation_id, clinic_id, doctor_id, day, status, channel);

create materialized view mv_revenue_daily as
  select b.organisation_id, b.clinic_id, coalesce(l.doctor_id, '00000000-0000-0000-0000-000000000000'::uuid) as doctor_id,
         coalesce(l.service_id, '00000000-0000-0000-0000-000000000000'::uuid) as service_id,
         (b.issued_at at time zone 'Africa/Cairo')::date as day,
         sum(l.gross)::bigint as gross, sum(l.discount)::bigint as discount, sum(l.vat)::bigint as vat,
         sum(l.net)::bigint as net, sum(l.total)::bigint as total, count(distinct b.id)::int as bills
  from bills b join bill_lines l on l.bill_id = b.id
  where b.status not in ('draft', 'void') and b.issued_at is not null
  group by 1, 2, 3, 4, 5;
create unique index mv_revenue_daily_uq on mv_revenue_daily (organisation_id, clinic_id, doctor_id, service_id, day);

create materialized view mv_payments_daily as
  select p.organisation_id, p.clinic_id, (p.created_at at time zone 'Africa/Cairo')::date as day, p.method,
         sum(p.amount)::bigint as amount, sum(p.refunded)::bigint as refunded, count(*)::int as n
  from payments p where p.status = 'captured'
  group by 1, 2, 3, 4;
create unique index mv_payments_daily_uq on mv_payments_daily (organisation_id, clinic_id, day, method);

create materialized view mv_wait_daily as
  select q.organisation_id, q.clinic_id, q.doctor_id, q.queue_date as day,
         avg(extract(epoch from (q.served_at - q.checked_in_at)) / 60)::numeric(8,1) as avg_wait_min,
         avg(extract(epoch from (q.done_at - q.served_at)) / 60)::numeric(8,1) as avg_consult_min,
         count(*)::int as n
  from queue_tickets q where q.served_at is not null
  group by 1, 2, 3, 4;
create unique index mv_wait_daily_uq on mv_wait_daily (organisation_id, clinic_id, doctor_id, day);

create or replace function report_scope_ok(p_clinic uuid) returns boolean language sql stable as $$
  select app_mode() in ('staff', 'system') and (app_mode() = 'system' or app_is_network() or p_clinic = any(app_clinics()))
$$;

create or replace function report_appointments(p_from date, p_to date)
returns setof mv_appointments_daily language sql stable security definer set search_path = public as $$
  select * from mv_appointments_daily where organisation_id = app_org() and day between p_from and p_to and report_scope_ok(clinic_id)
$$;
create or replace function report_revenue(p_from date, p_to date)
returns setof mv_revenue_daily language sql stable security definer set search_path = public as $$
  select * from mv_revenue_daily where organisation_id = app_org() and day between p_from and p_to and report_scope_ok(clinic_id)
$$;
create or replace function report_payments(p_from date, p_to date)
returns setof mv_payments_daily language sql stable security definer set search_path = public as $$
  select * from mv_payments_daily where organisation_id = app_org() and day between p_from and p_to and report_scope_ok(clinic_id)
$$;
create or replace function report_wait(p_from date, p_to date)
returns setof mv_wait_daily language sql stable security definer set search_path = public as $$
  select * from mv_wait_daily where organisation_id = app_org() and day between p_from and p_to and report_scope_ok(clinic_id)
$$;

create or replace function refresh_reports() returns void language plpgsql security definer set search_path = public as $$
begin
  refresh materialized view concurrently mv_appointments_daily;
  refresh materialized view concurrently mv_revenue_daily;
  refresh materialized view concurrently mv_payments_daily;
  refresh materialized view concurrently mv_wait_daily;
end $$;

revoke all on mv_appointments_daily, mv_revenue_daily, mv_payments_daily, mv_wait_daily from public;
revoke all on function report_appointments, report_revenue, report_payments, report_wait, refresh_reports from public;
grant execute on function report_appointments, report_revenue, report_payments, report_wait, refresh_reports, report_scope_ok to hf_app;
