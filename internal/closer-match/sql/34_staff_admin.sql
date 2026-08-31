-- ═══════════════════════════════════════════════════════════════════════════
-- 34 — adding a colleague should not require a database console
--
-- Asked directly: *"how do I add a new staff member to be able to sign into
-- Nikash and generate links, send to candidates and conduct client onboarding?"*
--
-- The honest answer today is: open the Supabase SQL editor and write an INSERT.
-- That is a poor answer for a tool that has a console, and it is a blocker rather
-- than an inconvenience — the whole point of putting ASK into Nikash is to hand
-- R2 to the team, and the team cannot run anything until somebody can let them in.
--
-- ── THE ROLES, AS THEY ACTUALLY BEHAVE ─────────────────────────────────────
--
--   recruiter  everything the pipeline needs — candidate links, client intake
--              links, shortlists, the interview surfaces, placements, outcomes.
--   admin      the above, plus keying rounds and keyer links, applying or undoing
--              a re-key, and the retention purge. A re-key moves every score in
--              the system, so this is the small list.
--   psych      same gates as recruiter today; kept because §13 anticipates it.
--   keyer      NOT a console account. `create_keying_link` writes these rows with
--              `auth_uid = null, active = false` so an invited expert's keys can be
--              attributed to a name. `whoami()` already refuses them by name.
--
-- ── THE LOCKOUT, WHICH IS THE ONLY REAL RISK HERE ──────────────────────────
--
-- Every mutation below is admin-only, so a console that can remove admins can
-- remove its last one — and then nobody can add anybody, including themselves,
-- and the only way back is the SQL editor this file exists to avoid.
--
-- > **A screen that can lock everyone out of itself has to refuse the last step,
-- > not warn about it.**
--
-- So: you cannot deactivate yourself, and you cannot deactivate or demote the
-- last active admin. Both are enforced here, not in the browser, because a
-- confirm() dialog is a suggestion.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Who is on the team ─────────────────────────────────────────────────────
-- `linked` is the fact that actually matters day to day: a staff row without an
-- auth_uid is somebody who has been added but has not created their login yet,
-- and that is the state every new joiner sits in for a few minutes. Saying so
-- turns "it isn't working" into "they haven't signed up yet".
create or replace function list_staff()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'list_staff: staff only'; end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', s.id,
      'full_name', s.full_name,
      'email', s.email,
      'role', s.role,
      'active', s.active,
      'linked', s.auth_uid is not null,
      'is_you', s.auth_uid = auth.uid(),
      'created_at', s.created_at,
      'state', case
        when s.role = 'keyer' then 'invited to key items — not a console account'
        when not s.active then 'access removed'
        when s.auth_uid is null then 'added, waiting for them to create their login'
        else 'active' end)
    order by (s.role = 'keyer'), s.active desc, lower(coalesce(s.full_name, s.email)))
    from staff s), '[]'::jsonb);
end $$;

grant execute on function list_staff() to authenticated;

-- ── Add one ────────────────────────────────────────────────────────────────
create or replace function add_staff(p_email text, p_name text, p_role text default 'recruiter')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_email text; v_existing staff; v_id uuid;
begin
  if staff_role() <> 'admin' then raise exception 'add_staff: admin only'; end if;

  v_email := lower(btrim(coalesce(p_email, '')));
  if v_email = '' then raise exception 'An email address is required.'; end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception '"%" does not look like an email address.', p_email;
  end if;
  if coalesce(btrim(p_name), '') = '' then
    raise exception 'A name is required — decisions get logged against it.';
  end if;
  -- 'keyer' is deliberately absent: those rows are created by create_keying_link,
  -- which also mints the token. Adding one here would make an account-less row
  -- that nobody could use and nothing would explain.
  if p_role not in ('admin', 'recruiter', 'psych') then
    raise exception 'Role must be admin, recruiter or psych — got "%".', p_role;
  end if;

  select * into v_existing from staff where lower(email) = v_email;

  if v_existing.id is not null then
    -- Re-adding somebody who was removed is the common case, and it must restore
    -- rather than fail: their name is already attached to decisions they logged.
    if not v_existing.active then
      update staff set active = true, role = p_role, full_name = btrim(p_name)
      where id = v_existing.id;
      return jsonb_build_object('added', false, 'restored', true, 'id', v_existing.id,
        'message', btrim(p_name) || ' had access before — it has been restored as ' || p_role || '.');
    end if;
    raise exception '% already has access as %.', v_existing.email, v_existing.role;
  end if;

  insert into staff (full_name, email, role, active)
  values (btrim(p_name), v_email, p_role, true)
  returning id into v_id;

  return jsonb_build_object('added', true, 'id', v_id, 'email', v_email, 'role', p_role,
    'message', btrim(p_name) || ' can now create a login with ' || v_email ||
               ' and will be let straight in.');
end $$;

grant execute on function add_staff(text, text, text) to authenticated;

-- ── Change a role, or take access away ─────────────────────────────────────
create or replace function set_staff_role(p_id uuid, p_role text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v staff; v_admins int;
begin
  if staff_role() <> 'admin' then raise exception 'set_staff_role: admin only'; end if;
  select * into v from staff where id = p_id;
  if v.id is null then raise exception 'No such staff member.'; end if;
  if v.role = 'keyer' then
    raise exception 'That row is an invited keyer, not a console account. '
                    'Add them as staff separately if they need to sign in.';
  end if;
  if p_role not in ('admin', 'recruiter', 'psych') then
    raise exception 'Role must be admin, recruiter or psych — got "%".', p_role;
  end if;

  if v.role = 'admin' and p_role <> 'admin' then
    select count(*) into v_admins from staff where role = 'admin' and active and id <> p_id;
    if v_admins = 0 then
      raise exception 'This is the last admin. Promote somebody else first, or '
                      'there will be nobody who can add staff, run a keying round '
                      'or apply a re-key.';
    end if;
  end if;

  update staff set role = p_role where id = p_id;
  return jsonb_build_object('id', p_id, 'role', p_role, 'name', v.full_name);
end $$;

grant execute on function set_staff_role(uuid, text) to authenticated;

create or replace function set_staff_active(p_id uuid, p_active boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v staff; v_admins int;
begin
  if staff_role() <> 'admin' then raise exception 'set_staff_active: admin only'; end if;
  select * into v from staff where id = p_id;
  if v.id is null then raise exception 'No such staff member.'; end if;

  if not p_active then
    if v.auth_uid = auth.uid() then
      raise exception 'You cannot remove your own access — ask another admin.';
    end if;
    if v.role = 'admin' then
      select count(*) into v_admins from staff where role = 'admin' and active and id <> p_id;
      if v_admins = 0 then
        raise exception 'This is the last active admin. Removing them locks '
                        'everybody out of adding staff.';
      end if;
    end if;
  end if;

  -- Deactivate, never delete. Their name stays on every decision they logged,
  -- every key they submitted and every placement they recorded; deleting the row
  -- would null those out (`on delete set null`) and quietly rewrite the record.
  update staff set active = p_active where id = p_id;
  return jsonb_build_object('id', p_id, 'active', p_active, 'name', v.full_name);
end $$;

grant execute on function set_staff_active(uuid, boolean) to authenticated;

-- ── The audit ──────────────────────────────────────────────────────────────
create or replace view v_staff_lockout_audit as
select count(*) as active_admins
from staff where role = 'admin' and active
having count(*) = 0;

comment on view v_staff_lockout_audit is
  'A row here means there is no active admin and nobody can add staff, run a '
  'keying round or apply a re-key. This view should always be empty.';

grant select on v_staff_lockout_audit to authenticated;

do $$
declare v int;
begin
  select count(*) into v from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('list_staff', 'add_staff', 'set_staff_role', 'set_staff_active');
  if v <> 4 then raise exception 'expected 4 staff-admin functions, found %', v; end if;

  select count(*) into v from v_staff_lockout_audit;
  if v > 0 then raise exception 'there is no active admin'; end if;

  -- Every one of these is staff-gated in its body; sql/31's event trigger takes
  -- care of the grant. Prove anon cannot reach them rather than assuming it.
  select count(*) into v from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('list_staff', 'add_staff', 'set_staff_role', 'set_staff_active')
    and has_function_privilege('anon', p.oid, 'execute');
  if v > 0 then raise exception '% staff-admin function(s) are reachable by anon', v; end if;

  raise notice 'sql/34 ok — staff can be added from the console, and the last admin cannot be removed';
end $$;
