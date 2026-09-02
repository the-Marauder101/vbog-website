-- Pravah V6B — Team management functions.
-- Run after 16_v6_client_portal.sql. Safe to re-run.
-- Allows gc_admin users to manage internal staff memberships from the UI
-- instead of requiring direct Supabase console access.

-- 1. List all internal staff memberships (admin only).
create or replace function pravah_list_staff_members()
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  if not pravah_is_admin() then raise exception 'Administrator access required.'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', m.id,
      'auth_uid', m.auth_uid,
      'email', u.email,
      'display_name', m.display_name,
      'role', m.role,
      'active', m.active,
      'created_at', m.created_at
    ) order by m.active desc, m.display_name nulls last)
    from pravah_memberships m
    join auth.users u on u.id = m.auth_uid
    where m.client_id is null
  ), '[]'::jsonb);
end $$;
revoke all on function pravah_list_staff_members() from public;
grant execute on function pravah_list_staff_members() to authenticated;

-- 2. Add a staff member by email. The person must already have a Supabase Auth account.
create or replace function pravah_add_staff_member(
  p_email text,
  p_role text default 'operations',
  p_display_name text default null
) returns uuid language plpgsql security definer set search_path=public as $$
declare
  v_auth_uid uuid;
  v_id uuid;
begin
  if not pravah_is_admin() then raise exception 'Administrator access required.'; end if;
  if p_role not in ('gc_admin','operations','trainer','client_success') then
    raise exception 'Invalid internal role. Must be gc_admin, operations, trainer, or client_success.';
  end if;

  select id into v_auth_uid from auth.users where lower(email) = lower(btrim(p_email)) limit 1;
  if v_auth_uid is null then
    raise exception 'No account found for %. The person must sign up first, then you can add them here.', p_email;
  end if;

  insert into pravah_memberships(auth_uid, role, display_name, active)
  values (v_auth_uid, p_role, coalesce(nullif(btrim(p_display_name),''), btrim(p_email)), true)
  on conflict (auth_uid) where client_id is null
  do update set role = excluded.role, display_name = excluded.display_name, active = true
  returning id into v_id;

  return v_id;
end $$;
revoke all on function pravah_add_staff_member(text,text,text) from public;
grant execute on function pravah_add_staff_member(text,text,text) to authenticated;

-- 3. Update a staff member's role, display name, or active status.
create or replace function pravah_update_staff_member(
  p_membership_id uuid,
  p_role text default null,
  p_display_name text default null,
  p_active boolean default null
) returns void language plpgsql security definer set search_path=public as $$
begin
  if not pravah_is_admin() then raise exception 'Administrator access required.'; end if;
  if p_role is not null and p_role not in ('gc_admin','operations','trainer','client_success') then
    raise exception 'Invalid internal role.';
  end if;

  update pravah_memberships set
    role = coalesce(p_role, role),
    display_name = coalesce(nullif(btrim(p_display_name),''), display_name),
    active = coalesce(p_active, active)
  where id = p_membership_id and client_id is null;

  if not found then raise exception 'Staff member not found.'; end if;
end $$;
revoke all on function pravah_update_staff_member(uuid,text,text,boolean) from public;
grant execute on function pravah_update_staff_member(uuid,text,text,boolean) to authenticated;

-- 4. Deactivate a staff member (soft delete).
create or replace function pravah_deactivate_staff_member(p_membership_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not pravah_is_admin() then raise exception 'Administrator access required.'; end if;

  update pravah_memberships set active = false
  where id = p_membership_id and client_id is null;

  if not found then raise exception 'Staff member not found.'; end if;
end $$;
revoke all on function pravah_deactivate_staff_member(uuid) from public;
grant execute on function pravah_deactivate_staff_member(uuid) to authenticated;
