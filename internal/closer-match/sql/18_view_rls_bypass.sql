-- ═══════════════════════════════════════════════════════════════════════════
-- 18 — CRITICAL: every view was bypassing RLS
--
-- WHAT WAS WRONG
--
-- In Postgres, a view runs with the privileges of its OWNER unless it is created
-- with `security_invoker = true`. Every view here is owned by `postgres`, and
-- none of them set it. So reading a view executed as `postgres` and the row
-- policies on the underlying tables were **never consulted**. On top of that,
-- Supabase's default privileges grant `anon` and `authenticated` everything on
-- new objects in `public`, and a view is a new object in `public`.
--
-- Together those two facts meant the publishable key — which ships in
-- `js/config.js`, is in the repo, and is in every visitor's browser — could read
-- straight through the console's views. Verified against the live project with
-- nothing but that key:
--
--   GET /rest/v1/v_candidate_queue   200  candidate names, flags, eligibility
--   GET /rest/v1/v_requirements      200  client names, ticket sizes, targets, best match %
--   GET /rest/v1/v_keying_links      200  LIVE KEYING TOKENS
--   GET /rest/v1/v_console_clean     200  (empty only because there are no matches yet —
--                                         it projects dimension scores and match percentages)
--
-- That is R1 and C10 broken: scores did leave the building, and a keying token
-- was readable by anyone, which would let a stranger key as an invited expert.
-- It has been true since the first view was created.
--
-- WHY THE EXISTING AUDIT COULD NOT SEE IT
--
-- `v_c10_audit` checks POLICIES — it looks for a policy admitting a non-staff
-- principal, and there is none, which is why every previous check passed. The
-- hole was not a policy. It was a view that never asked about policies at all.
-- An audit only ever covers the mechanism you thought of.
--
-- WHY THE BROWSER QA COULD NOT SEE IT EITHER
--
-- Every test signed in first. A signed-in staff user gets the same rows through
-- either mechanism, so the tests could not tell the two apart. The candidate
-- surface was tested as anon, but only against the three RPCs it actually calls
-- — never against a view it had no reason to call. The lesson from §7f had the
-- right shape and too narrow a scope: it is not enough to walk in through the
-- user's door. **You have to try the doors the user never uses.**
--
-- THE FIX
--
--   1. `security_invoker = true` on every view in public, applied in a loop so
--      no view can be missed, including ones added later.
--   2. `anon` loses every privilege on every view and table in public. It does
--      not need any: the candidate, client, keyer and supplement surfaces reach
--      the database exclusively through SECURITY DEFINER functions (§4).
--   3. Default privileges changed so a view created tomorrow is not granted to
--      anon the moment it exists.
--   4. `v_rls_bypass_audit`, which must always be empty, so this class of hole
--      is auditable rather than merely fixed.
--
-- A consequence worth stating: `v_group_differences` and `v_group_gaps` read
-- `monitoring_attributes`, which §14.3 restricts to admin and psych. Until now a
-- recruiter could read group data through those views. Now they cannot. That is
-- not a regression; it is the isolation §14.3 asked for, finally holding.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Every view runs as its caller ───────────────────────────────────────
do $$
declare v record; n int := 0;
begin
  for v in select c.relname from pg_class c
           join pg_namespace ns on ns.oid = c.relnamespace
           where ns.nspname = 'public' and c.relkind = 'v'
  loop
    execute format('alter view public.%I set (security_invoker = true)', v.relname);
    n := n + 1;
  end loop;
  raise notice 'security_invoker set on % views', n;
end $$;

-- ── 2. anon holds nothing in public ────────────────────────────────────────
-- The candidate surface needs no table or view access whatsoever; it calls
-- start_assessment / save_response / finish_assessment, and the client, keyer
-- and supplement surfaces are the same shape. Function grants are untouched.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- ── 3. authenticated: read the views, write only through the tables ────────
-- A view is not a write surface here; every mutation goes to a table (where RLS
-- applies) or through an RPC.
do $$
declare v record;
begin
  for v in select c.relname from pg_class c
           join pg_namespace ns on ns.oid = c.relnamespace
           where ns.nspname = 'public' and c.relkind = 'v'
  loop
    execute format('revoke all on public.%I from authenticated', v.relname);
    execute format('grant select on public.%I to authenticated', v.relname);
  end loop;
end $$;

-- ── 4. And for everything created from here on ─────────────────────────────
-- Migrations run as postgres, so this is the role whose defaults matter.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;

-- ═══ THE AUDIT THAT WOULD HAVE CAUGHT THIS ═════════════════════════════════
-- Sits beside v_c10_audit and must also always be empty. v_c10_audit asks "does
-- a policy admit the wrong principal"; this asks "can anything reach the rows
-- without a policy being consulted at all".
create or replace view v_rls_bypass_audit as
-- (a) a view that still runs as its owner, so base-table RLS is skipped
select 'view runs as owner — base-table RLS is skipped'::text as problem,
       c.relname::text as object,
       'alter view public.' || c.relname || ' set (security_invoker = true)' as fix
from pg_class c
join pg_namespace ns on ns.oid = c.relnamespace
where ns.nspname = 'public' and c.relkind = 'v'
  and coalesce((select option_value from pg_options_to_table(c.reloptions)
                where option_name = 'security_invoker'), 'false') <> 'true'
union all
-- (b) anon holding any privilege on anything in public
select 'anon holds ' || g.privilege_type || ' — the publishable key is public',
       g.table_name::text,
       'revoke ' || g.privilege_type || ' on public.' || g.table_name || ' from anon'
from information_schema.role_table_grants g
where g.table_schema = 'public' and g.grantee = 'anon'
union all
-- (c) a table with RLS off, or not forced, among the ones that hold scores
select 'row security not forced on a scoring table', t.relname::text,
       'alter table public.' || t.relname || ' force row level security'
from pg_class t
join pg_namespace ns on ns.oid = t.relnamespace
where ns.nspname = 'public' and t.relkind = 'r'
  and t.relname in ('candidate_profile','matches','client_target_profile',
                    'interview_ratings','candidate_responses','monitoring_attributes',
                    'item_options','keying_tokens','assessment_tokens')
  and not (t.relrowsecurity and t.relforcerowsecurity);

grant select on v_rls_bypass_audit to authenticated;
alter view v_rls_bypass_audit set (security_invoker = true);

-- ═══ ASSERTIONS — the migration fails rather than half-applying ════════════
do $$
declare v int; r record;
begin
  select count(*) into v from v_rls_bypass_audit;
  if v > 0 then
    for r in select * from v_rls_bypass_audit limit 8 loop
      raise warning 'STILL OPEN: % on % — %', r.problem, r.object, r.fix;
    end loop;
    raise exception 'v_rls_bypass_audit is not empty (% row(s)) — the bypass is not closed', v;
  end if;

  -- The console must still be able to read what it needs. Checked structurally:
  -- authenticated holds SELECT on every view, and holds nothing beyond it.
  select count(*) into v
  from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
  where ns.nspname = 'public' and c.relkind = 'v'
    and not has_table_privilege('authenticated', c.oid, 'select');
  if v > 0 then raise exception '% view(s) are no longer readable by staff', v; end if;

  raise notice 'sql/18 ok — no view bypasses RLS, anon holds nothing, audit empty';
end $$;
