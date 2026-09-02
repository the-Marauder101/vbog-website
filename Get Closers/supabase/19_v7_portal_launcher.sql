-- Pravah V7 — portal launcher.
-- Returns all active memberships for the current user so the launcher
-- page can show which portals they have access to.
-- Run after 16_v6_client_portal.sql. Safe to re-run.

create or replace function pravah_my_portals()
returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'role', m.role,
      'display_name', coalesce(m.display_name, m.role),
      'client_id', m.client_id,
      'client_name', c.business_name,
      'is_internal', m.client_id is null,
      'placement_id', m.placement_id
    ) order by (m.client_id is null) desc, m.role)
    from pravah_memberships m
    left join clients c on c.id = m.client_id
    where m.auth_uid = auth.uid() and m.active
  ), '[]'::jsonb);
end $$;
revoke all on function pravah_my_portals() from public;
grant execute on function pravah_my_portals() to authenticated;
