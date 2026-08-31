-- ═══════════════════════════════════════════════════════════════════════════
-- 33 — one definition per view
--
-- Found by breaking it. Adding a column to `v_candidate_queue` meant re-applying
-- sql/22, which silently reverted the fix sql/23 had made to the SAME view three
-- migrations later. Nothing errored. The view simply went back in time.
--
--     v_candidate_queue  — defined in sql/11, sql/20, sql/22 AND sql/23
--     v_console_clean    — defined in sql/15 and sql/29
--
-- **Whichever file ran last won.** Which means the live schema depended not on
-- what the migrations say but on the order somebody happened to run them in, and
-- re-applying an earlier file — a completely ordinary thing to do, and something
-- this project has done repeatedly — quietly undid later work.
--
-- This is the same shape as §7q (a security fix that decayed every time an
-- earlier migration was re-applied) and the same shape as the argument against a
-- second `final_keys` table in sql/28:
--
-- > **Two definitions of one thing is not redundancy, it is a race — and the
-- > loser is whichever one you did not run most recently.**
--
-- It bit here in the mildest possible way: `assessment_complete` reverted from
-- "any session finished" to "the newest session finished", which is exactly the
-- bug sql/23 exists to fix. Next time it could be an RLS predicate.
--
-- ── THE FIX ────────────────────────────────────────────────────────────────
--
-- Both views are defined ONCE, here, in the highest-numbered file — so numeric
-- order puts this last on a fresh database, and re-applying any earlier file
-- cannot revert it. The earlier definitions are removed and replaced with a
-- pointer, so there is nothing left to accidentally re-run.
--
-- A view that has to be edited is edited here. Not copied.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── The shortlist, minus the test rows ─────────────────────────────────────
-- Was sql/15, then sql/29. Ranked over the visible pool only, so `engine_rank`
-- counts the people a recruiter can actually see.
create or replace view v_console_clean as
select
  row_number() over (
    partition by requirement_id
    order by hard_filter_pass desc, composite_pct desc, candidate_id
  ) as engine_rank,
  requirement_id, requirement_title, business_name, candidate_id, full_name,
  composite_pct, quality_pct, fit_pct, cls_effective, confidence, benchmark_source,
  hard_filter_pass, hard_filter_fails, flags, attrition_risk_flag, frame_split_flag,
  top_reasons, top_concerns, frame_split_note, cross_client_line, weights_disclaimer,
  hard_filter_unknown,
  -- ASK travels with the candidate, not with the requirement — it is a reading of
  -- whether they can sell at all, not of their fit to this client. Shown beside
  -- the match percentage and never folded into it (sql/35).
  ask.round as ask_round,
  ask.pct   as ask_pct
from v_console
left join lateral (
  select round, pct from ask_scorecards
  where candidate_id = v_console.candidate_id and submitted_at is not null
  order by submitted_at desc limit 1) ask on true
where full_name not like 'ZZ_FIXTURE%' and full_name not like 'ZZ_E2E%';

grant select on v_console_clean to authenticated;

-- ── The requirement list ───────────────────────────────────────────────────
-- Was sql/11, then sql/12, then sql/15. The counts exclude test rows on BOTH
-- sides — a fixture candidate must not inflate "12 assessed" on a real client's
-- role, which the sql/11 version did.
create or replace view v_requirements as
select r.id, r.title, r.status, r.ticket_size, r.cycle_days, r.roleplay_pack, r.opened_at,
       c.business_name, c.id as client_id,
       tp.confidence, tp.benchmark_source, tp.required_levels, tp.bipolar_targets,
       tp.cls_blend, tp.benchmark_conflicts,
       (select count(*) from matches m
          join candidates cd on cd.id = m.candidate_id
        where m.requirement_id = r.id and m.hard_filter_pass
          and cd.full_name not like 'ZZ_FIXTURE%' and cd.full_name not like 'ZZ_E2E%') as eligible,
       (select count(*) from matches m
          join candidates cd on cd.id = m.candidate_id
        where m.requirement_id = r.id
          and cd.full_name not like 'ZZ_FIXTURE%' and cd.full_name not like 'ZZ_E2E%') as assessed,
       (select round(max(m.composite) * 100, 1) from matches m
          join candidates cd on cd.id = m.candidate_id
        where m.requirement_id = r.id and m.hard_filter_pass
          and cd.full_name not like 'ZZ_FIXTURE%' and cd.full_name not like 'ZZ_E2E%') as best_pct
from requirements r
join clients c on c.id = r.client_id
left join client_target_profile tp on tp.id = r.target_profile_id
where c.business_name not like 'ZZ_FIXTURE%';

grant select on v_requirements to authenticated;

-- ── The candidate queue ────────────────────────────────────────────────────
-- Was sql/11, then sql/20, then sql/22, then sql/23. Carries, in order of when
-- each was added: the completion state (sql/23 — ANY finished session, not the
-- newest), the eligible/open counts (sql/20), the nine scores and per-role
-- standings (sql/22), and the bipolar side labels (sql/30).
create or replace view v_candidate_queue as
select cand.id, cand.full_name, cand.created_at, cand.last_activity_at,
       p.computed_at as profiled_at, p.flags,

       -- sql/23: ANY completed session. Asking about the newest one let a stray
       -- session make a finished candidate look unfinished.
       exists (select 1 from assessment_sessions s2
                where s2.candidate_id = cand.id and s2.completed_at is not null)
                                                                as assessment_complete,

       (select count(*) from matches m
          join requirements req on req.id = m.requirement_id
          join clients cl on cl.id = req.client_id
        where m.candidate_id = cand.id and m.hard_filter_pass
          and req.status = 'open'
          and cl.business_name not like 'ZZ_FIXTURE%')          as eligible_reqs,

       (select count(*) from requirements req
          join clients cl on cl.id = req.client_id
        where req.status = 'open' and req.target_profile_id is not null
          and cl.business_name not like 'ZZ_FIXTURE%')           as open_reqs,

       p.scores,

       (select coalesce(jsonb_agg(jsonb_build_object(
                 'requirement_id', v.requirement_id,
                 'title', v.requirement_title,
                 'business_name', v.business_name,
                 'pct', v.composite_pct,
                 'rank', v.engine_rank,
                 'of', (select count(*) from v_console_clean v2
                         where v2.requirement_id = v.requirement_id),
                 'pass', v.hard_filter_pass,
                 'fails', v.hard_filter_fails,
                 'unknown', v.hard_filter_unknown)
               order by v.composite_pct desc), '[]'::jsonb)
        from v_console_clean v
        join requirements req on req.id = v.requirement_id
        where v.candidate_id = cand.id and req.status = 'open'
          and v.business_name not like 'ZZ_FIXTURE%')            as roles,

       (select max(v.composite_pct)
        from v_console_clean v
        join requirements req on req.id = v.requirement_id
        where v.candidate_id = cand.id and req.status = 'open'
          and v.business_name not like 'ZZ_FIXTURE%')            as best_pct,

       bipolar_sides(p.scores)                                   as sides,

       -- The latest submitted ASK scorecard, for the chip on the row. Appended
       -- rather than placed beside `scores`: CREATE OR REPLACE VIEW can only add
       -- columns at the end, and this view has dependents.
       (select jsonb_build_object(
                 'round', a.round, 'pct', a.pct,
                 'total', a.total, 'max_total', a.max_total,
                 'on', a.conducted_on)
        from ask_scorecards a
        where a.candidate_id = cand.id and a.submitted_at is not null
        order by a.submitted_at desc limit 1)                     as ask

from candidates cand
left join lateral (
  select * from candidate_profile where candidate_id = cand.id order by computed_at desc limit 1
) p on true
-- Both prefixes, matching v_console_clean above. They disagreed: the queue hid
-- only ZZ_FIXTURE while the shortlist hid ZZ_E2E as well, so a test candidate
-- appeared in the queue carrying no roles — a row that reads as a real person
-- the engine has ignored. Two views with two ideas of what counts as a test row
-- will eventually show you one of them.
where cand.full_name not like 'ZZ_FIXTURE%' and cand.full_name not like 'ZZ_E2E%';

grant select on v_candidate_queue to authenticated;

-- ── Assertions ─────────────────────────────────────────────────────────────
do $$
declare v int;
begin
  -- The sql/23 behaviour must be the one in force. This is the exact column that
  -- silently reverted, so it is the one worth checking by hand.
  if pg_get_viewdef('v_candidate_queue'::regclass, true) not like '%EXISTS%assessment_sessions%' then
    raise exception 'v_candidate_queue lost the sql/23 fix again — assessment_complete '
                    'is reading the newest session rather than any completed one';
  end if;

  -- And the sql/30 and sql/29 additions must both still be present, which is the
  -- other half of the same problem: a revert loses whichever came later.
  if pg_get_viewdef('v_candidate_queue'::regclass, true) not like '%bipolar_sides%' then
    raise exception 'v_candidate_queue lost the side labels';
  end if;
  if pg_get_viewdef('v_console_clean'::regclass, true) not like '%hard_filter_unknown%' then
    raise exception 'v_console_clean lost the unknown-filter column';
  end if;

  -- No test row may reach either view.
  select count(*) into v from v_candidate_queue
  where full_name like 'ZZ_FIXTURE%' or full_name like 'ZZ_E2E%';
  if v > 0 then raise exception '% test row(s) visible in the candidate queue', v; end if;

  select count(*) into v from v_console_clean
  where full_name like 'ZZ_FIXTURE%' or full_name like 'ZZ_E2E%';
  if v > 0 then raise exception '% test row(s) visible in the shortlist', v; end if;

  select count(*) into v from v_rls_bypass_audit;
  if v > 0 then raise exception 'v_rls_bypass_audit is not empty (%)', v; end if;

  raise notice 'sql/33 ok — one definition each, and the later fixes survived';
end $$;
