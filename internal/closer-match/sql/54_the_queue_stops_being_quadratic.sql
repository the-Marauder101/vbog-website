-- ═══════════════════════════════════════════════════════════════════════════
-- 54 — the candidate queue stops being quadratic
--
-- THE FAILURE, AS IT ACTUALLY PRESENTED
--
-- The Candidates tab stopped opening. Not the candidate detail — the tab. The
-- screen stayed hidden because `loadQueue()` awaits one request before it calls
-- `view("queue")`, and that request was returning 500:
--
--     {"code":"57014","message":"canceling statement due to statement timeout"}
--
-- `v_candidate_queue` had crossed Supabase's 8-second statement timeout.
--
-- NOT A REGRESSION FROM A MIGRATION. Nothing in sql/49–53 touches this view or
-- anything it reads at query time. What changed is the data:
--
--     then            now
--     ~30 profiles    65 profiles
--     10 open roles   23 open roles
--     250 matches     1011 matches
--     ~40 candidates  110 candidates
--
-- and the view is superlinear in all of them at once.
--
-- ── WHERE THE TIME WENT ───────────────────────────────────────────────────
--
-- Per candidate, the old definition scanned `v_console_clean` twice — once to
-- build `roles`, once more for `best_pct` — and then, **for every role row**, ran
--
--     (select count(*) from v_console_clean v2 where v2.requirement_id = …)
--
-- to fill in the "rank 3 of 17". `v_console_clean` is not a table: it resolves
-- through `v_console`, which carries a window function and a self-join on
-- `matches` for the cross-client line. So that innermost count re-derived the
-- whole console once per role per candidate. The plan showed the consequence —
-- the same subplans entered 99,078 and 92,022 times.
--
-- The rewrite computes each of those once:
--
--     req_counts   one pass over v_console_clean → how many candidates per role
--     per_cand     one pass → every candidate's roles array AND their best_pct
--
-- No column changes, no filter changes, no ordering changes. The output is
-- asserted identical to the old view's, row for row and key for key, before the
-- replacement is allowed to stand.
--
-- ── WHY IT LOOKED FINE IN TESTING AND DIED IN USE ─────────────────────────
--
-- Because the suites and every probe I ran connect as `postgres` through the
-- Management API, or as a staff user against a database with a fraction of this
-- data. Measured on the live row counts:
--
--     as postgres (RLS bypassed)        905 ms
--     as authenticated (RLS applied)   5705 ms      ← 6.3× for the same rows
--
-- Every table the view touches is default-deny with a policy that calls
-- `is_staff()`, and that cost multiplies through a plan entered ~99,000 times.
-- The functions are correctly marked STABLE; the problem is the number of
-- entries, not the per-call cost.
--
-- > **A query measured as `postgres` has not been measured.** RLS is part of the
-- > query, and on this database it is most of it. The margin that matters is the
-- > one the application's own role sees, against the row counts production
-- > actually has.
--
-- ── WHAT IS DELIBERATELY NOT DONE HERE ────────────────────────────────────
--
-- `alter role authenticated set statement_timeout` would have cleared the error
-- in one line and left a view that is still quadratic, to fail again at a row
-- count nobody is watching for. The timeout was the messenger.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Build it beside the old one and prove they agree ───────────────────
create or replace view v_candidate_queue_check
with (security_invoker = true) as
with clean as (
  -- The rows the queue is allowed to speak about: open roles, real clients.
  select v.*
  from v_console_clean v
  join requirements req on req.id = v.requirement_id
  where req.status = 'open'
    and v.business_name not like 'ZZ_FIXTURE%'
),
req_counts as (
  -- "of N" — how many candidates are ranked against each role. Counted once for
  -- every role here, rather than once per role per candidate as before.
  --
  -- Deliberately over the WHOLE of v_console_clean, not over `clean`: that is
  -- what the old correlated subquery counted, and changing the denominator while
  -- claiming to be a performance fix would silently move every "3 of 17" on the
  -- screen.
  select requirement_id, count(*) as of_n
  from v_console_clean
  group by requirement_id
),
per_cand as (
  select c.candidate_id,
         jsonb_agg(jsonb_build_object(
           'requirement_id', c.requirement_id,
           'title',          c.requirement_title,
           'business_name',  c.business_name,
           'pct',            c.composite_pct,
           'rank',           c.engine_rank,
           'of',             rc.of_n,
           'pass',           c.hard_filter_pass,
           'fails',          c.hard_filter_fails,
           'unknown',        c.hard_filter_unknown)
           -- requirement_id is a TIEBREAK, not decoration. Two roles on the same
           -- composite used to come out in whatever order the plan produced, so a
           -- candidate's role list could reshuffle between page loads — the exact
           -- defect `v_console` added a deterministic tiebreak for, which this
           -- array never got. 25 of 110 candidates currently carry a tie.
           order by c.composite_pct desc, c.requirement_id) as roles,
         max(c.composite_pct) as best_pct
  from clean c
  left join req_counts rc on rc.requirement_id = c.requirement_id
  group by c.candidate_id
)
select
  cand.id,
  cand.full_name,
  cand.created_at,
  cand.last_activity_at,
  p.computed_at as profiled_at,
  p.flags,
  (exists (select 1 from assessment_sessions s2
            where s2.candidate_id = cand.id and s2.completed_at is not null))
                                                        as assessment_complete,
  (select count(*) from matches m
     join requirements req on req.id = m.requirement_id
     join clients cl on cl.id = req.client_id
    where m.candidate_id = cand.id and m.hard_filter_pass
      and req.status = 'open' and cl.business_name not like 'ZZ_FIXTURE%')
                                                        as eligible_reqs,
  (select count(*) from requirements req
     join clients cl on cl.id = req.client_id
    where req.status = 'open' and req.target_profile_id is not null
      and cl.business_name not like 'ZZ_FIXTURE%')      as open_reqs,
  p.scores,
  coalesce(pc.roles, '[]'::jsonb)                       as roles,
  pc.best_pct,
  bipolar_sides(p.scores)                               as sides,
  (select jsonb_build_object('round', a.round, 'pct', a.pct, 'total', a.total,
                             'max_total', a.max_total, 'on', a.conducted_on)
     from ask_scorecards a
    where a.candidate_id = cand.id and a.submitted_at is not null
    order by a.submitted_at desc limit 1)               as ask
from candidates cand
left join lateral (
  select * from candidate_profile
  where candidate_id = cand.id
  order by computed_at desc limit 1) p on true
left join per_cand pc on pc.candidate_id = cand.id
where cand.full_name not like 'ZZ_FIXTURE%'
  and cand.full_name not like 'ZZ_E2E%';

grant select on v_candidate_queue_check to authenticated;

-- ── 2. Identical, or this file does not apply ─────────────────────────────
do $$
declare v_old int; v_new int; v_diff int; v_sample jsonb;
begin
  select count(*) into v_old from v_candidate_queue;
  select count(*) into v_new from v_candidate_queue_check;
  if v_old <> v_new then
    raise exception 'sql/54: the rewrite returns % rows against the old %', v_new, v_old;
  end if;

  -- Every scalar column, exactly. These are the numbers on the screen and not one
  -- of them is allowed to move.
  select count(*) into v_diff
  from v_candidate_queue o
  join v_candidate_queue_check n on n.id = o.id
  where (o.full_name, o.created_at, o.last_activity_at, o.profiled_at,
         o.assessment_complete, o.eligible_reqs, o.open_reqs, o.best_pct)
     is distinct from
        (n.full_name, n.created_at, n.last_activity_at, n.profiled_at,
         n.assessment_complete, n.eligible_reqs, n.open_reqs, n.best_pct)
     or o.flags is distinct from n.flags
     or o.scores is distinct from n.scores
     or o.sides is distinct from n.sides
     or o.ask is distinct from n.ask;
  if v_diff > 0 then
    raise exception 'sql/54: % row(s) differ on a scalar column', v_diff;
  end if;

  -- `roles` compared as a SET, because the ordering is deliberately changing and
  -- comparing it as a list would fail for the one reason that is intended.
  --
  -- The old view ordered by composite_pct alone, so ties resolved however the
  -- plan happened to produce them — 25 of these candidates carry one, and their
  -- role list could come out in a different order on each page load. The rewrite
  -- adds requirement_id as a tiebreak. Same roles, same percentages, same ranks;
  -- stable order where there used to be none.
  select count(*) into v_diff
  from v_candidate_queue o
  join v_candidate_queue_check n on n.id = o.id
  where (select jsonb_agg(x order by x->>'requirement_id') from jsonb_array_elements(o.roles) x)
     is distinct from
        (select jsonb_agg(x order by x->>'requirement_id') from jsonb_array_elements(n.roles) x);
  if v_diff > 0 then
    raise exception 'sql/54: % row(s) carry a different SET of roles, not merely a '
                    'different order. That is a behaviour change, not a tiebreak.', v_diff;
  end if;

  -- And the headline ordering still holds: strictly non-increasing by percentage.
  select count(*) into v_diff from (
    select n.id, x.pct, lag(x.pct) over (partition by n.id order by x.ord) as prev
    from v_candidate_queue_check n,
         lateral (select (e->>'pct')::numeric as pct, ordinality as ord
                  from jsonb_array_elements(n.roles) with ordinality e(e, ordinality)) x) y
  where prev is not null and pct > prev;
  if v_diff > 0 then
    raise exception 'sql/54: the roles array is no longer ordered best-first (% breaks)', v_diff;
  end if;

  raise notice 'sql/54: % queue rows agree on every value; roles identical as sets, '
               'now with a stable order on ties', v_old;
end $$;

-- ── 3. Replace, and drop the scaffold ─────────────────────────────────────
-- Same columns, same order, same names — so CREATE OR REPLACE is allowed and
-- nothing that reads this view needs to know it changed.
create or replace view v_candidate_queue
with (security_invoker = true) as
with clean as (
  select v.*
  from v_console_clean v
  join requirements req on req.id = v.requirement_id
  where req.status = 'open'
    and v.business_name not like 'ZZ_FIXTURE%'
),
req_counts as (
  select requirement_id, count(*) as of_n
  from v_console_clean
  group by requirement_id
),
per_cand as (
  select c.candidate_id,
         jsonb_agg(jsonb_build_object(
           'requirement_id', c.requirement_id,
           'title',          c.requirement_title,
           'business_name',  c.business_name,
           'pct',            c.composite_pct,
           'rank',           c.engine_rank,
           'of',             rc.of_n,
           'pass',           c.hard_filter_pass,
           'fails',          c.hard_filter_fails,
           'unknown',        c.hard_filter_unknown)
           -- requirement_id is a TIEBREAK, not decoration. Two roles on the same
           -- composite used to come out in whatever order the plan produced, so a
           -- candidate's role list could reshuffle between page loads — the exact
           -- defect `v_console` added a deterministic tiebreak for, which this
           -- array never got. 25 of 110 candidates currently carry a tie.
           order by c.composite_pct desc, c.requirement_id) as roles,
         max(c.composite_pct) as best_pct
  from clean c
  left join req_counts rc on rc.requirement_id = c.requirement_id
  group by c.candidate_id
)
select
  cand.id,
  cand.full_name,
  cand.created_at,
  cand.last_activity_at,
  p.computed_at as profiled_at,
  p.flags,
  (exists (select 1 from assessment_sessions s2
            where s2.candidate_id = cand.id and s2.completed_at is not null))
                                                        as assessment_complete,
  (select count(*) from matches m
     join requirements req on req.id = m.requirement_id
     join clients cl on cl.id = req.client_id
    where m.candidate_id = cand.id and m.hard_filter_pass
      and req.status = 'open' and cl.business_name not like 'ZZ_FIXTURE%')
                                                        as eligible_reqs,
  (select count(*) from requirements req
     join clients cl on cl.id = req.client_id
    where req.status = 'open' and req.target_profile_id is not null
      and cl.business_name not like 'ZZ_FIXTURE%')      as open_reqs,
  p.scores,
  coalesce(pc.roles, '[]'::jsonb)                       as roles,
  pc.best_pct,
  bipolar_sides(p.scores)                               as sides,
  (select jsonb_build_object('round', a.round, 'pct', a.pct, 'total', a.total,
                             'max_total', a.max_total, 'on', a.conducted_on)
     from ask_scorecards a
    where a.candidate_id = cand.id and a.submitted_at is not null
    order by a.submitted_at desc limit 1)               as ask
from candidates cand
left join lateral (
  select * from candidate_profile
  where candidate_id = cand.id
  order by computed_at desc limit 1) p on true
left join per_cand pc on pc.candidate_id = cand.id
where cand.full_name not like 'ZZ_FIXTURE%'
  and cand.full_name not like 'ZZ_E2E%';

drop view if exists v_candidate_queue_check;

comment on view v_candidate_queue is
  'The candidate list. Rewritten in sql/54 to compute the per-role candidate '
  'counts and each candidate''s roles in one pass each, rather than re-deriving '
  'the console once per role per candidate. Contains scores — internal only, '
  'never a client surface (R1 / C10).';

notify pgrst, 'reload schema';

-- ── 4. Fast enough as the role that actually calls it ─────────────────────
-- Measured as `authenticated` with RLS applied, because that is the only
-- measurement that was ever going to catch this.
do $$
declare v_ms numeric; v_t timestamptz; v_n int;
begin
  perform set_config('request.jwt.claims',
    (select json_build_object('sub', auth_uid, 'role', 'authenticated')::text
       from staff where active and auth_uid is not null limit 1), true);

  if current_setting('request.jwt.claims', true) is null then
    raise notice 'sql/54: no linked staff account to measure as — skipping the RLS timing';
    return;
  end if;

  set local role authenticated;
  v_t := clock_timestamp();
  select count(*) into v_n from (
    select * from v_candidate_queue order by created_at desc limit 100) x;
  v_ms := extract(milliseconds from (clock_timestamp() - v_t))
        + 1000 * extract(second from (clock_timestamp() - v_t));
  reset role;

  raise notice 'sql/54: queue returns % rows in % ms as authenticated (was 5705 ms)',
    v_n, round(v_ms);

  -- Supabase cancels at 8000 ms. Half of that is the line: closer than this and
  -- the next twenty candidates put it back where it started.
  if v_ms > 4000 then
    raise exception 'sql/54: the queue still takes % ms as authenticated, against '
                    'an 8000 ms statement timeout. Not fixed.', round(v_ms);
  end if;
end $$;
