-- ═══════════════════════════════════════════════════════════════════════════
-- 20 — a finished assessment was never matched against anything
--
-- THE BUG. Matching ran in exactly one direction. `submit_intake()` calls
-- `compute_matches()` when a CLIENT submits their brief, which matches the new
-- requirement against every candidate assessed so far. Nothing did the mirror
-- image: `finish_assessment()` computed the candidate's profile and stopped.
--
-- So a candidate who finished the test AFTER a role was opened produced no
-- `matches` row at all. They appeared in the queue as "assessed · 0 eligible
-- requirements", the shortlist for the open role did not contain them, and there
-- was nowhere in the console to see that their submission had landed. On a live
-- project: one candidate, 44 of 44 answered, profiled, zero matches.
--
-- The order of events decided whether the work was visible, which is not a
-- property any pipeline should have. §9 does not say "match on intake" — it says
-- one assessment is matched against every open requirement, and that is a claim
-- about both directions.
--
-- THE FIX. `finish_assessment()` now matches the finished candidate against
-- every open requirement that has a target profile. Same `compute_matches()`,
-- same arithmetic, same golden cases — the only change is that it is now called
-- from both ends of the pipeline rather than one.
--
-- COST. compute_matches() recomputes a whole requirement rather than one
-- candidate, so this is O(open requirements × assessed candidates) per finish.
-- At the stated volume — 60 candidates a month against a handful of open roles —
-- that is milliseconds, and it is worth more than a narrower per-candidate path
-- that could drift away from the one the golden cases exercise.
--
-- FAILURE IS NOT SILENT, AND NOT FATAL. A candidate's submission must be
-- recorded even if matching fails, so each requirement is attempted separately
-- and a failure is logged as a warning rather than losing the assessment. The
-- return value now says how many requirements were matched, so the caller can
-- tell "matched against nothing because nothing is open" from "matching broke".
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function finish_assessment(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_session uuid; v_answered int; v_expected int;
  v_candidate uuid; r record; v_matched int := 0; v_failed int := 0;
begin
  select s.id, array_length(s.item_set, 1), s.candidate_id
    into v_session, v_expected, v_candidate
  from assessment_tokens t
  join assessment_sessions s on s.candidate_id = t.candidate_id and s.completed_at is null
  where t.token = p_token and t.expires_at > now()
  order by s.started_at desc limit 1;

  if v_session is null then
    raise exception 'No open assessment for this link.';
  end if;

  select count(*) into v_answered from candidate_responses where session_id = v_session;
  if v_answered < v_expected then
    return jsonb_build_object('complete', false,
      'answered', v_answered, 'expected', v_expected);
  end if;

  update assessment_sessions set completed_at = now() where id = v_session;
  perform compute_candidate_profile(v_session);

  -- The half that was missing. One assessment, matched against every open role.
  -- Golden-case requirements are excluded on the same rule the console uses
  -- everywhere else: a fixture must never touch operational data. Without this a
  -- real candidate picks up seven match rows against fixture roles, which the
  -- console cannot show but `eligible_reqs` would happily count.
  for r in
    select req.id from requirements req
    join clients cl on cl.id = req.client_id
    where req.status = 'open' and req.target_profile_id is not null
      and cl.business_name not like 'ZZ_FIXTURE%'
  loop
    begin
      perform compute_matches(r.id);
      v_matched := v_matched + 1;
    exception when others then
      -- The assessment is already saved and scored. A requirement that cannot be
      -- matched right now must not cost the candidate their submission.
      v_failed := v_failed + 1;
      raise warning 'finish_assessment: could not match requirement % — %', r.id, sqlerrm;
    end;
  end loop;

  return jsonb_build_object('complete', true,
                            'matched_requirements', v_matched,
                            'failed_requirements', v_failed);
end $$;

grant execute on function finish_assessment(text) to anon;

-- ── Backfill ───────────────────────────────────────────────────────────────
-- Everyone who finished before this fix has a profile and no matches. Recompute
-- every open requirement once; compute_matches() is idempotent per requirement.
do $$
declare r record; n int := 0;
begin
  -- Clear the fixture pairings this fix would otherwise leave behind.
  delete from matches m using requirements req, clients cl, candidates cand
  where req.id = m.requirement_id and cl.id = req.client_id and cand.id = m.candidate_id
    and cl.business_name like 'ZZ_FIXTURE%'
    and cand.full_name not like 'ZZ_FIXTURE%' and cand.full_name not like 'ZZ_E2E%';

  for r in
    select req.id from requirements req
    join clients cl on cl.id = req.client_id
    where req.status = 'open' and req.target_profile_id is not null
      and cl.business_name not like 'ZZ_FIXTURE%'
  loop
    perform compute_matches(r.id);
    n := n + 1;
  end loop;
  raise notice 'backfilled % open requirement(s)', n;
end $$;

-- ── The assertion that would have caught it ────────────────────────────────
-- Any candidate with a computed profile must have a match row for every open
-- requirement. Not "should" — there is no legitimate state where an assessed
-- candidate is absent from an open role's shortlist, because exclusion is
-- recorded AS a match row with hard_filter_pass = false (R3), never as a
-- missing one.
create or replace view v_unmatched_audit as
select p.candidate_id, c.full_name, r.id as requirement_id, r.title,
       'assessed candidate missing from an open requirement'::text as problem
from (select distinct on (candidate_id) candidate_id, computed_at
        from candidate_profile order by candidate_id, computed_at desc) p
join candidates c on c.id = p.candidate_id
cross join (select req.id, req.title from requirements req
              join clients cl on cl.id = req.client_id
             where req.status = 'open' and req.target_profile_id is not null
               and cl.business_name not like 'ZZ_FIXTURE%') r
where not exists (
  select 1 from matches m
  where m.candidate_id = p.candidate_id and m.requirement_id = r.id)
  and c.full_name not like 'ZZ_FIXTURE%' and c.full_name not like 'ZZ_E2E%';

grant select on v_unmatched_audit to authenticated;
alter view v_unmatched_audit set (security_invoker = true);

-- ── And the count the queue shows ──────────────────────────────────────────
-- `eligible_reqs` counted every passing match a candidate had ever had,
-- including roles that have since closed and fixture roles. "3 eligible
-- requirements" pointing at two closed roles is worse than no number.
-- ── v_candidate_queue lives in sql/33 ──────────────────────────────────────────
-- It used to be redefined here. Four files defined `v_candidate_queue` and two
-- defined `v_console_clean`, so the live schema depended on which migration ran
-- most recently — re-applying this file silently reverted later fixes. Both are
-- now defined once, in the highest-numbered migration, so numeric order puts
-- them last and no earlier file can undo them. Edit them there. See sql/33.

alter view v_candidate_queue set (security_invoker = true);

do $$
declare v int; r record;
begin
  select count(*) into v from v_unmatched_audit;
  if v > 0 then
    for r in select * from v_unmatched_audit limit 5 loop
      raise warning 'UNMATCHED: % on "%"', r.full_name, r.title;
    end loop;
    raise exception 'v_unmatched_audit is not empty (% row(s)) — the backfill did not take', v;
  end if;
  raise notice 'sql/20 ok — finished assessments now match on both ends, backfill clean';
end $$;
