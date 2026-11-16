-- Identity lookups performed before the tenant is known (staff token → user, memberships, org privilege overrides).
create or replace function staff_identity(p_sub text)
returns table (user_id uuid, organisation_id uuid, status text, name_ar text, name_en text, last_strong_auth_at timestamptz,
               memberships jsonb, privilege_overrides jsonb)
language sql stable security definer set search_path = public as $$
  select u.id, u.organisation_id, u.status, u.name_ar, u.name_en, u.last_strong_auth_at,
         coalesce((select jsonb_agg(jsonb_build_object('role', m.role, 'clinicId', m.clinic_id)) from staff_memberships m where m.user_id = u.id), '[]'),
         o.privilege_overrides
  from users u join organisations o on o.id = u.organisation_id
  where u.keycloak_sub = p_sub
$$;
revoke all on function staff_identity from public;
grant execute on function staff_identity to hf_app;
