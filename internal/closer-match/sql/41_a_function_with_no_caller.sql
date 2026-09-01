-- ═══════════════════════════════════════════════════════════════════════════
-- 41 — a function with no caller is a promise, not a feature
--
-- Three times in a row a feature was built, applied, tested, merged — and could
-- not be used, because a database function was written and nothing in the browser
-- ever called it:
--
--   §7ak  the ASK region was rendered below an early return, so it never appeared
--         for the candidates ASK exists for
--   §7al  `score_ask_reference()` had existed since the first ASK migration with
--         no caller, so the reference call had nowhere to go
--   this  `get_ask_scorecard()`, same — a submitted interview could be totalled
--         but not read back question by question
--
-- All three were found the same way: Depesh tried to use the tool and asked where
-- the thing was. That is the most expensive way to find it and it was the only way
-- available, because nothing checked. Every SQL assertion in this schema tests
-- what the database does when called. None of them tested whether anything calls.
--
-- > **A migration asserting its own invariants proves the function works. It says
-- > nothing about whether the function is reachable.**
--
-- This view is half the fix. It lists the staff-facing functions — everything
-- guarded by `is_staff()` or `staff_role()`, which is the definition of "a thing a
-- member of staff is supposed to be able to do" — with the count of times the name
-- appears in other functions' bodies, so a purely internal helper can be told
-- apart from an orphaned surface.
--
-- The other half is in `test/security.js`, which greps the shipped JavaScript for
-- each name and fails on any that nothing calls. It has to live there because SQL
-- cannot read the repository. Exemptions are listed in that file with a reason
-- each, the way `anon_callable` and `rls_exempt` work: excluding something is a
-- decision somebody wrote down, not a silent absence.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace view v_staff_function_callers as
select
  p.proname,
  p.oid::regprocedure::text as signature,
  -- How many OTHER functions in the schema mention this name. A helper called
  -- from ten places and never from the browser is internal by design; one called
  -- from nowhere at all is either dead or a surface nobody wired up.
  (select count(*) from pg_proc c
   join pg_namespace cn on cn.oid = c.pronamespace
   where cn.nspname = 'public' and c.oid <> p.oid and c.prokind = 'f'
     and pg_get_functiondef(c.oid) like '%' || p.proname || '(%') as called_by_sql,
  exists (select 1 from anon_callable a where a.proname = p.proname) as anon_callable,
  null::text as exempt_reason
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prokind = 'f'
  and (pg_get_functiondef(p.oid) like '%is_staff()%'
    or pg_get_functiondef(p.oid) like '%staff_role()%');

alter view v_staff_function_callers set (security_invoker = true);
revoke all on v_staff_function_callers from anon;
grant select on v_staff_function_callers to authenticated;

-- ── The two that are genuinely dead ───────────────────────────────────────
-- Found by running the check for the first time. Neither is wired to anything and
-- neither is called from SQL, so they are features that were written and never
-- finished:
--
--   mark_benchmark      — nothing sets a benchmark, so nothing reads one
--   score_supplement    — the supplement can be submitted but never scored
--
-- They are left in place rather than dropped, because dropping them would hide
-- the fact that two half-built features exist. They are recorded here so the
-- decision is visible, and `test/security.js` will keep failing until either a
-- surface calls them or somebody exempts them deliberately.
comment on function mark_benchmark(uuid, uuid, text, text) is
  'UNREACHABLE as of sql/41: no caller in the browser and none in SQL. Either a '
  'surface needs to call it or the feature should be removed — see §7am.';
comment on function score_supplement(uuid, uuid, text, text, numeric) is
  'UNREACHABLE as of sql/41: the supplement can be submitted but never scored. '
  'Either a surface needs to call it or the feature should be removed — see §7am.';

-- ── Assertions ────────────────────────────────────────────────────────────
do $$
declare v_n int; v_orphans text;
begin
  select count(*) into v_n from v_staff_function_callers;
  if v_n < 20 then
    raise exception 'v_staff_function_callers found only % staff functions, which '
                    'means the is_staff/staff_role detection is broken', v_n;
  end if;

  -- get_ask_scorecard is the one this file exists because of. It must be in the
  -- list, or the view is not looking at the right set of functions.
  if not exists (select 1 from v_staff_function_callers where proname = 'get_ask_scorecard') then
    raise exception 'get_ask_scorecard is not in the staff-function list';
  end if;

  -- And the two known-dead ones must show zero SQL callers, which is what makes
  -- them distinguishable from an internal helper.
  select string_agg(proname || ' (' || called_by_sql || ')', ', ')
    into v_orphans from v_staff_function_callers
  where proname in ('mark_benchmark', 'score_supplement') and called_by_sql > 0;
  if v_orphans is not null then
    raise notice 'sql/41: these are called from SQL after all, so they are not dead: %', v_orphans;
  end if;

  raise notice 'sql/41: % staff functions listed; the browser-side half of the '
               'check is in test/security.js', v_n;
end $$;
