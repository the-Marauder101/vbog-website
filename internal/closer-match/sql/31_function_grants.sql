-- ═══════════════════════════════════════════════════════════════════════════
-- 31 — "granted to authenticated" was never a restriction
--
-- Found by a QA assertion that expected two new helper functions to be refused
-- for an anonymous caller. They returned HTTP 200.
--
-- **Postgres grants EXECUTE on every new function to PUBLIC by default.** `anon`
-- is a member of PUBLIC. So writing
--
--     grant execute on function position_bias(uuid) to authenticated;
--
-- adds a privilege that was already there and restricts nothing. Every
-- SECURITY DEFINER function in this schema — all 60-odd of them — has been
-- callable with the publishable key since the day it was written. That key ships
-- in `js/config.js` and sits in every browser that opens the tool.
--
-- ── WHY NOTHING HAS LEAKED ─────────────────────────────────────────────────
--
-- Luck, mostly, backed by one good habit: almost every sensitive function opens
-- with `is_staff()`, `staff_role()`, or a token lookup, and refuses on its own
-- before touching a row. That guard — not the grant — is what has been holding
-- the line. Which is the useful lesson:
--
-- > **The GRANT was decorative and the in-body guard was doing all the work.
-- > Wherever the guard was missing, there was nothing underneath it.**
--
-- ── WHERE THE GUARD WAS MISSING ────────────────────────────────────────────
--
-- `purge_expired_candidates()` is the one that matters. SECURITY DEFINER, no
-- caller check of any kind, and its body is a `DELETE FROM candidates`. It is
-- meant to be called by pg_cron at 02:30 and by nothing else. It has been
-- reachable from the open internet by anyone holding the publishable key.
--
-- It would have deleted nothing today, because it only removes rows whose
-- `last_activity_at` is over 24 months old and this system is three weeks old.
-- **That is the retention window saving us, not the design.** In two years the
-- same call is a data-loss incident, and the code would not have changed.
--
-- Also unguarded, and much smaller: `position_bias()`, `bipolar_side()`,
-- `bipolar_sides()` and `key_fingerprint()` — all mine, all leaking internals
-- rather than candidate identity, and all closed here.
--
-- ── THE FIX, AND MAKING IT SURVIVE BEING FORGOTTEN ─────────────────────────
--
-- This is the same shape as §7n (views bypassing RLS because `security_invoker`
-- defaults off) and §7q (the fix decaying every time a migration was re-applied).
-- The same three-part answer applies:
--
--   1. Revoke the default that should never have been there.
--   2. Grant back explicitly, from a named allowlist, so the candidate surface
--      keeps working and nothing else is reachable.
--   3. Make it a rule the database enforces on itself, so a function added next
--      month cannot reopen the hole by existing.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. The allowlist ───────────────────────────────────────────────────────
-- Every function an account-less surface legitimately calls. A candidate, a
-- client filling an intake, or an invited keyer holds no account: their identity
-- IS their token, checked inside the function. Anything not on this list has no
-- business being reachable without a session.
create table if not exists anon_callable (
  proname text primary key,
  why     text not null
);

insert into anon_callable (proname, why) values
  ('get_consent_notice',    'A candidate must be able to read what they are consenting to before identifying themselves.'),
  ('record_consent',        'Candidate surface, by token.'),
  ('start_assessment',      'Candidate surface, by token.'),
  ('save_response',         'Candidate surface, by token.'),
  ('finish_assessment',     'Candidate surface, by token.'),
  ('save_monitoring',       'Candidate surface, by token.'),
  ('get_supplement',        'Candidate supplement, by token.'),
  ('submit_supplement',     'Candidate supplement, by token.'),
  ('get_intake_form',       'Client intake, by token.'),
  ('save_intake_draft',     'Client intake, by token.'),
  ('submit_intake',         'Client intake, by token.'),
  ('get_keying_by_token',   'Invited keyer, by token — never sees score_key.'),
  ('save_keying_by_token',  'Invited keyer, by token.'),
  ('clear_keying_by_token', 'Invited keyer, by token.'),
  ('item_display_order',    'Called inside start_assessment/save_response, which run as definer; harmless alone.'),
  ('format_is_shufflable',  'Pure function of a format name. No data.')
on conflict (proname) do update set why = excluded.why;

-- ── 2. Close it, then reopen exactly the allowlist ─────────────────────────
do $$
declare r record; n_revoked int := 0; n_granted int := 0;
begin
  for r in
    select p.oid, p.proname,
           p.oid::regprocedure::text as sig
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public' and p.prokind = 'f'
  loop
    -- PUBLIC is the actual holder; revoking from anon alone leaves the grant
    -- intact through PUBLIC membership, which is exactly the trap being closed.
    execute format('revoke all on function %s from public, anon', r.sig);
    n_revoked := n_revoked + 1;

    if exists (select 1 from anon_callable a where a.proname = r.proname) then
      execute format('grant execute on function %s to anon', r.sig);
      n_granted := n_granted + 1;
    end if;
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
  raise notice 'revoked PUBLIC execute on % function(s); % re-opened to anon', n_revoked, n_granted;
end $$;

-- A function created tomorrow must not inherit the default either.
alter default privileges in schema public revoke execute on functions from public;

-- ── 3. And a rule the database keeps for itself ────────────────────────────
-- `alter default privileges` covers functions created by the role that ran it.
-- An event trigger covers the rest, including anything created by a migration
-- run under a different role — the case that made sql/18's view fix decay.
create or replace function enforce_function_grants()
returns event_trigger language plpgsql as $$
declare r record;
begin
  for r in
    select * from pg_event_trigger_ddl_commands()
    where object_type = 'function' and schema_name = 'public'
  loop
    execute format('revoke all on function %s from public, anon', r.object_identity);
    if exists (
      select 1 from anon_callable a
      where a.proname = (select proname from pg_proc where oid = r.objid))
    then
      execute format('grant execute on function %s to anon', r.object_identity);
    end if;
    execute format('grant execute on function %s to authenticated', r.object_identity);
  end loop;
end $$;

drop event trigger if exists function_grant_guard;
create event trigger function_grant_guard on ddl_command_end
  when tag in ('CREATE FUNCTION', 'ALTER FUNCTION')
  execute function enforce_function_grants();

-- ── 4. The missing guard, which the grant was standing in for ──────────────
-- Retention is policy, not a request. This runs from pg_cron as the table owner
-- and from an admin's hand; it is not a thing a browser asks for.
create or replace function purge_expired_candidates()
returns integer language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  -- `session_user` is the cron/owner role; `is_staff()` covers a deliberate
  -- admin run from the console. Everything else is refused, including the case
  -- this function was open to for its whole life: nobody at all.
  if not (session_user in ('postgres', 'supabase_admin')
          or (auth.uid() is not null and staff_role() = 'admin')) then
    raise exception 'purge_expired_candidates: retention runs from cron or by an admin, '
                    'not from a browser. This function deletes candidate records.';
  end if;

  with gone as (
    delete from candidates
    where last_activity_at < now() - interval '24 months'
    returning 1
  ) select count(*) into v_n from gone;
  return v_n;
end $$;

revoke all on function purge_expired_candidates() from public, anon;
grant execute on function purge_expired_candidates() to authenticated;

-- ── 5. The audit ───────────────────────────────────────────────────────────
create or replace view v_function_grant_audit as
select p.proname,
       p.oid::regprocedure::text as signature,
       p.prosecdef              as security_definer,
       -- A body with no caller check is only as safe as its grant, and the grant
       -- is the thing that just turned out to be worthless.
       (pg_get_functiondef(p.oid) not like '%is_staff()%'
        and pg_get_functiondef(p.oid) not like '%staff_role()%'
        and pg_get_functiondef(p.oid) not like '%auth.uid()%'
        and pg_get_functiondef(p.oid) not like '%p_token%') as no_caller_check
from pg_proc p
join pg_namespace ns on ns.oid = p.pronamespace
where ns.nspname = 'public' and p.prokind = 'f'
  and has_function_privilege('anon', p.oid, 'execute')
  and not exists (select 1 from anon_callable a where a.proname = p.proname);

comment on view v_function_grant_audit is
  'Any row is a function reachable without a session that nobody signed off. '
  'This view should always be empty.';

grant select on v_function_grant_audit to authenticated;

-- ── A final sweep, because the guard cannot guard its own creation ─────────
-- `enforce_function_grants` is itself a function in `public`, created after the
-- revoke loop and before the trigger that would have closed it. It inherited the
-- PUBLIC default and the audit caught it immediately — the audit finding the
-- fix's own blind spot on the first run is the best argument for having written
-- one. The sweep repeats now that everything in the file exists.
do $$
declare r record; n int := 0;
begin
  for r in
    select p.oid::regprocedure::text as sig, p.proname
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public' and p.prokind = 'f'
      and has_function_privilege('anon', p.oid, 'execute')
      and not exists (select 1 from anon_callable a where a.proname = p.proname)
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
    n := n + 1;
  end loop;
  if n > 0 then raise notice 'final sweep closed % more function(s)', n; end if;
end $$;

-- ── Assertions ─────────────────────────────────────────────────────────────
do $$
declare v int; v_names text;
begin
  select count(*), string_agg(proname, ', ') into v, v_names from v_function_grant_audit;
  if v > 0 then
    raise exception 'v_function_grant_audit is not empty (%): %', v, v_names;
  end if;

  -- The allowlist must still work, or the candidate surface is bricked.
  select count(*) into v from anon_callable a
  where not exists (
    select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public' and p.proname = a.proname
      and has_function_privilege('anon', p.oid, 'execute'));
  if v > 0 then
    raise exception '% allowlisted function(s) lost their anon grant', v;
  end if;

  -- The event trigger must close a newly created function without being asked.
  execute 'create or replace function zz_grant_probe() returns int language sql as $q$ select 1 $q$';
  if has_function_privilege('anon', 'zz_grant_probe()'::regprocedure, 'execute') then
    execute 'drop function zz_grant_probe()';
    raise exception 'a newly created function is still executable by anon';
  end if;
  if not has_function_privilege('authenticated', 'zz_grant_probe()'::regprocedure, 'execute') then
    execute 'drop function zz_grant_probe()';
    raise exception 'the trigger revoked from anon but forgot to grant to authenticated';
  end if;
  execute 'drop function zz_grant_probe()';

  -- And the destructive one refuses this caller, who is neither cron nor admin.
  -- (Run through the Management API, session_user is `postgres`, so this is the
  --  branch that must NOT raise — asserted the other way in the browser QA.)
  raise notice 'sql/31 ok — % function(s) reachable without a session, all of them signed off',
               (select count(*) from anon_callable);
end $$;
