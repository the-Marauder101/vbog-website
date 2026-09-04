-- Pravah V7C — User creation from within Pravah.
-- Two flows:
--   1. Internal staff: invite via magic link (no password needed).
--   2. External users (closer/client): create with email + password directly.
--
-- Requires: extensions http (for Auth Admin API calls), supabase_vault.
-- Safe to re-run.

-- Store the service role key in vault (idempotent).
-- The key never leaves the database; only security-definer admin functions read it.
do $$
begin
  if not exists (
    select 1 from vault.secrets where name = 'service_role_key'
  ) then
    perform vault.create_secret(
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpnbGF2aWN5YmNqY3RvZ3NwYmFwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NTQzMzYwOCwiZXhwIjoyMTAxMDA5NjA4fQ._cMrgaxMyB9kr5wq7FxHdX4laC1X7ORywAynJ9FfPB8',
      'service_role_key',
      'Supabase service role key for auth admin operations'
    );
  end if;
end $$;

-- Helper: read the service role key from vault.
create or replace function pravah_service_key()
returns text language sql stable security definer set search_path=public as $$
  select decrypted_secret from vault.decrypted_secrets
  where name = 'service_role_key' limit 1;
$$;
revoke all on function pravah_service_key() from public;

-- 1. Invite internal staff — sends a magic-link email, creates membership.
create or replace function pravah_invite_staff(
  p_email text,
  p_role text default 'operations',
  p_display_name text default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_key text;
  v_response extensions.http_response;
  v_body jsonb;
  v_auth_uid uuid;
  v_membership_id uuid;
begin
  if not pravah_is_admin() then
    raise exception 'Administrator access required.';
  end if;
  if p_role not in ('gc_admin','operations','trainer','client_success') then
    raise exception 'Invalid internal role. Must be gc_admin, operations, trainer, or client_success.';
  end if;

  -- Check if user already has an auth account.
  select id into v_auth_uid from auth.users
  where lower(email) = lower(btrim(p_email)) limit 1;

  if v_auth_uid is not null then
    -- User exists — just create/update the membership.
    insert into pravah_memberships(auth_uid, role, display_name, active)
    values (v_auth_uid, p_role, coalesce(nullif(btrim(p_display_name),''), btrim(p_email)), true)
    on conflict (auth_uid) where client_id is null
    do update set role = excluded.role, display_name = excluded.display_name, active = true
    returning id into v_membership_id;

    return jsonb_build_object('status', 'existing_user', 'membership_id', v_membership_id);
  end if;

  -- New user — invite via Auth Admin API.
  v_key := pravah_service_key();
  if v_key is null then
    raise exception 'Service key not configured. Contact system administrator.';
  end if;

  select * into v_response from extensions.http((
    'POST',
    'https://zglavicybcjctogspbap.supabase.co/auth/v1/invite',
    array[
      extensions.http_header('apikey', v_key),
      extensions.http_header('Authorization', 'Bearer ' || v_key)
    ],
    'application/json',
    jsonb_build_object('email', btrim(p_email))::text
  )::extensions.http_request);

  if v_response.status not between 200 and 299 then
    v_body := v_response.content::jsonb;
    raise exception 'Could not invite user: %', coalesce(v_body->>'msg', v_body->>'message', v_response.content);
  end if;

  v_body := v_response.content::jsonb;
  v_auth_uid := (v_body->>'id')::uuid;

  -- Create membership for the newly invited user.
  insert into pravah_memberships(auth_uid, role, display_name, active)
  values (v_auth_uid, p_role, coalesce(nullif(btrim(p_display_name),''), btrim(p_email)), true)
  on conflict (auth_uid) where client_id is null
  do update set role = excluded.role, display_name = excluded.display_name, active = true
  returning id into v_membership_id;

  return jsonb_build_object('status', 'invited', 'membership_id', v_membership_id);
end $$;
revoke all on function pravah_invite_staff(text,text,text) from public;
grant execute on function pravah_invite_staff(text,text,text) to authenticated;

-- 2. Create external user (closer/client) with email + password.
create or replace function pravah_create_portal_user(
  p_email text,
  p_password text,
  p_role text,
  p_client_id uuid,
  p_display_name text default null,
  p_placement_id uuid default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_key text;
  v_response extensions.http_response;
  v_body jsonb;
  v_auth_uid uuid;
  v_membership_id uuid;
begin
  if not pravah_is_admin() then
    raise exception 'Administrator access required.';
  end if;
  if p_role not in ('closer','client_admin','client_viewer') then
    raise exception 'Invalid external role. Must be closer, client_admin, or client_viewer.';
  end if;
  if p_client_id is null then
    raise exception 'Client ID is required for external users.';
  end if;
  if p_role = 'closer' and p_placement_id is null then
    raise exception 'Placement ID is required for closer accounts.';
  end if;
  if length(p_password) < 8 then
    raise exception 'Password must be at least 8 characters.';
  end if;

  -- Check if user already has an auth account.
  select id into v_auth_uid from auth.users
  where lower(email) = lower(btrim(p_email)) limit 1;

  if v_auth_uid is not null then
    -- User exists — just create/update the membership.
    insert into pravah_memberships(auth_uid, role, client_id, placement_id, display_name, active)
    values (v_auth_uid, p_role, p_client_id, p_placement_id,
            coalesce(nullif(btrim(p_display_name),''), btrim(p_email)), true)
    on conflict (auth_uid, client_id) where client_id is not null
    do update set role = excluded.role, placement_id = excluded.placement_id,
                  display_name = excluded.display_name, active = true
    returning id into v_membership_id;

    return jsonb_build_object('status', 'existing_user', 'membership_id', v_membership_id);
  end if;

  -- New user — create via Auth Admin API with confirmed email.
  v_key := pravah_service_key();
  if v_key is null then
    raise exception 'Service key not configured. Contact system administrator.';
  end if;

  select * into v_response from extensions.http((
    'POST',
    'https://zglavicybcjctogspbap.supabase.co/auth/v1/admin/users',
    array[
      extensions.http_header('apikey', v_key),
      extensions.http_header('Authorization', 'Bearer ' || v_key)
    ],
    'application/json',
    jsonb_build_object(
      'email', btrim(p_email),
      'password', p_password,
      'email_confirm', true
    )::text
  )::extensions.http_request);

  if v_response.status not between 200 and 299 then
    v_body := v_response.content::jsonb;
    raise exception 'Could not create user: %', coalesce(v_body->>'msg', v_body->>'message', v_response.content);
  end if;

  v_body := v_response.content::jsonb;
  v_auth_uid := (v_body->>'id')::uuid;

  -- Create membership for the new user.
  insert into pravah_memberships(auth_uid, role, client_id, placement_id, display_name, active)
  values (v_auth_uid, p_role, p_client_id, p_placement_id,
          coalesce(nullif(btrim(p_display_name),''), btrim(p_email)), true)
  returning id into v_membership_id;

  return jsonb_build_object('status', 'created', 'membership_id', v_membership_id);
end $$;
revoke all on function pravah_create_portal_user(text,text,text,uuid,text,uuid) from public;
grant execute on function pravah_create_portal_user(text,text,text,uuid,text,uuid) to authenticated;
