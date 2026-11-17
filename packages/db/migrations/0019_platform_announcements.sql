create or replace function platform_announcements_list() returns setof platform_announcements
language sql stable security definer set search_path = public as $$ select * from platform_announcements order by starts_at desc limit 200 $$;
create or replace function platform_announcement_withdraw(p_id uuid) returns void
language sql security definer set search_path = public as $$ update platform_announcements set ends_at = least(ends_at, now()) where id = p_id $$;
revoke all on function platform_announcements_list, platform_announcement_withdraw from public;
grant execute on function platform_announcements_list, platform_announcement_withdraw to hf_app;
