-- Migration 30: V10e — Create staff and admin accounts without email
--
-- The problem, stated precisely: portal users and staff were built on two
-- different mechanisms, and only one of them works.
--
--   pravah_create_portal_user(email, role, client, placement, display, PASSWORD)
--     -> POST /auth/v1/admin/users with email_confirm
--     -> creates a usable account immediately, sends no email.
--     This is why client_admin and closer access has been working.
--
--   pravah_invite_staff(email, role, display)          -- no password
--     -> POST /auth/v1/invite
--     -> depends entirely on an invitation email being delivered.
--     The project has no SMTP configured (smtp_host is null), so the only
--     sender available is Supabase's development one, and mailer_autoconfirm
--     is true. Staff invitations therefore never arrive, which is why staff
--     and admin accounts could not be added.
--
-- Fix: give internal roles the same password-based path that already works
-- for external ones. pravah_invite_staff is left in place untouched, so it
-- resumes working the moment SMTP is configured — this adds an alternative,
-- it does not remove a capability.

create or replace function pravah_create_staff_user(
  p_email        text,
  p_role         text default 'operations',
  p_display_name text default null,
  p_password     text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_key          text;
  v_response     extensions.http_response;
  v_body         jsonb;
  v_auth_uid     uuid;
  v_membership_id uuid;
begin
  if not pravah_is_admin() then
    raise exception 'Administrator access required.';
  end if;

  if p_role not in ('gc_admin','operations','trainer','client_success') then
    raise exception 'Invalid internal role. Must be gc_admin, operations, trainer, or client_success.';
  end if;

  if coalesce(length(p_password),0) < 8 then
    raise exception 'Password must be at least 8 characters.';
  end if;

  -- Already has an auth account: attach the internal membership only.
  -- pravah_one_internal_membership is the unique index behind this conflict.
  select id into v_auth_uid from auth.users
   where lower(email) = lower(btrim(p_email)) limit 1;

  if v_auth_uid is not null then
    insert into pravah_memberships(auth_uid, role, display_name, active)
    values (v_auth_uid, p_role,
            coalesce(nullif(btrim(p_display_name),''), btrim(p_email)), true)
    on conflict (auth_uid) where client_id is null
      do update set role = excluded.role,
                    display_name = excluded.display_name,
                    active = true
    returning id into v_membership_id;

    insert into pravah_audit_events (client_id, actor_uid, entity_type, entity_id, action, payload)
    values (null, auth.uid(), 'pravah_memberships', v_membership_id::text,
            'staff_membership_attached',
            jsonb_build_object('email', btrim(p_email), 'role', p_role));

    return jsonb_build_object('status','existing_user','membership_id',v_membership_id);
  end if;

  v_key := pravah_service_key();
  if v_key is null then
    raise exception 'Service key not configured. Contact system administrator.';
  end if;

  -- email_confirm: the account is usable at once, no confirmation mail needed
  select * into v_response from extensions.http((
    'POST',
    'https://zglavicybcjctogspbap.supabase.co/auth/v1/admin/users',
    array[extensions.http_header('apikey', v_key),
          extensions.http_header('Authorization', 'Bearer ' || v_key)],
    'application/json',
    jsonb_build_object('email', btrim(p_email),
                       'password', p_password,
                       'email_confirm', true)::text
  )::extensions.http_request);

  if v_response.status not between 200 and 299 then
    v_body := v_response.content::jsonb;
    raise exception 'Could not create staff user: %',
      coalesce(v_body->>'msg', v_body->>'message', v_response.content);
  end if;

  v_body := v_response.content::jsonb;
  v_auth_uid := (v_body->>'id')::uuid;

  insert into pravah_memberships(auth_uid, role, display_name, active)
  values (v_auth_uid, p_role,
          coalesce(nullif(btrim(p_display_name),''), btrim(p_email)), true)
  on conflict (auth_uid) where client_id is null
    do update set role = excluded.role,
                  display_name = excluded.display_name,
                  active = true
  returning id into v_membership_id;

  insert into pravah_audit_events (client_id, actor_uid, entity_type, entity_id, action, payload)
  values (null, auth.uid(), 'pravah_memberships', v_membership_id::text,
          'staff_user_created',
          jsonb_build_object('email', btrim(p_email), 'role', p_role));

  return jsonb_build_object('status','created','membership_id',v_membership_id);
end;
$$;

revoke all on function pravah_create_staff_user(text,text,text,text) from public, anon;
grant execute on function pravah_create_staff_user(text,text,text,text) to authenticated;

comment on function pravah_create_staff_user(text,text,text,text) is
  'Creates an internal staff or admin account with an administrator-issued password. No email is sent. Use pravah_invite_staff instead once SMTP is configured.';

-- Verification:
--   select pg_get_function_arguments(p.oid) from pg_proc p
--     join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname='public' and p.proname='pravah_create_staff_user';
