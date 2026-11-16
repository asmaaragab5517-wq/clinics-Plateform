create or replace function payment_intent_org(p_id uuid) returns table (organisation_id uuid)
language sql stable security definer set search_path = public as $$
  select organisation_id from payment_intents where id = p_id
$$;
create or replace function message_org(p_provider_id text) returns table (organisation_id uuid, id uuid)
language sql stable security definer set search_path = public as $$
  select organisation_id, id from messages where provider_message_id = p_provider_id
$$;
create or replace function active_organisations() returns table (id uuid, slug text)
language sql stable security definer set search_path = public as $$
  select id, slug from organisations where status = 'active'
$$;
revoke all on function payment_intent_org, message_org, active_organisations from public;
grant execute on function payment_intent_org, message_org, active_organisations to hf_app;
