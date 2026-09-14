-- ═══════════════════════════════════════════════════════════════════════════
-- 50 — the interview gets a composite, and a match stops going stale
--
-- Two changes, both asked for directly.
--
-- ── 1. THE R2 READING IS NOW A COMPOSITE ──────────────────────────────────
--
-- sql/49 refused to give the interview a composite. §9.4 is
-- `(0.6 × Quality + 0.4 × Fit) × confidence`, the interview measures nothing that
-- reaches Fit, and so the interview number was published as the quality half only
-- and compared against the test's quality half.
--
-- That was the cautious reading of an honest problem, and it has a real cost on a
-- screen: the R2 column and the Test column were different quantities sitting an
-- inch apart, and the one number a person actually wants — which role does this
-- candidate suit best — was the one the table would not print.
--
-- So the weight is renormalised. `r2_composite_pct = quality × confidence`: the
-- 0.6 that quality carries in §9.4 is stretched to 1.0 over the evidence the
-- interview has. Same arithmetic, same weights, same required levels, with the
-- fit term removed rather than guessed.
--
-- **What that assumes, said once and then said again on the screen.** Removing
-- the fit term is arithmetically identical to assuming the candidate sits exactly
-- on target for deal motion and interpersonal style. That is the most generous
-- assumption available, so where fit is genuinely poor the R2 composite reads
-- HIGH — and it reads high precisely for the candidates the questionnaire exists
-- to catch. The mitigation is not a disclaimer, it is that the quality-versus-
-- quality comparison stays on the row: that pair is like-for-like, and it is what
-- the agreement verdict is still computed from. The composite is for ranking; the
-- quality pair is for trusting.
--
-- ── 2. A MATCH IS A FUNCTION OF THREE TIMESTAMPED INPUTS ──────────────────
--
-- sql/49 found, by accident, that the shortlist can sit behind the profiles:
-- re-running the engine turned up two match rows that should already have
-- existed. That file caught them up and said plainly it had not fixed the cause.
-- This one fixes the cause.
--
-- A `matches` row is a pure function of exactly three things, and every one of
-- them is timestamped:
--
--   · `candidate_profile.computed_at`     — the candidate's scores
--   · `client_target_profile.computed_at` — the weights and required levels
--   · `requirements.opened_at`            — the role itself
--
-- So staleness is not a matter of judgement. A row is stale if it was computed
-- before any of its three inputs, and a pair with no row at all is the same
-- failure with the row missing. `v_match_staleness_audit` states both, with the
-- reason; `refresh_stale_matches()` fixes exactly what the audit names and does
-- nothing at all when the audit is empty, which is what makes it safe to call
-- from a screen that loads often.
--
-- `finish_assessment` already re-matched every open role, and that is why this
-- was hard to see: the hole is everywhere ELSE. A target profile recomputed for a
-- requirement that already existed, a re-key that produces new profiles, a
-- requirement opened after the candidates were scored — none of those run
-- `finish_assessment`, and every one of them leaves a number on screen that is
-- quietly out of date.
--
-- > **Do not fix a stale cache by remembering to refresh it.** Derive whether it
-- > is stale from the inputs it was built from, make that derivation a view
-- > anybody can read, and let the fix be "recompute what the view names".
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. The interview's composite ───────────────────────────────────────────
create or replace function get_ask_fit(p_candidate_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_card    ask_scorecards;
  v_levels  jsonb;
  v_thresh  numeric := param('ask', 'disagreement_points');
  v_rows    jsonb := '[]'::jsonb;
  r         record;
  v_qual    jsonb;
  v_r2      numeric;
  v_r2_comp numeric;
  v_test    numeric;
  v_test_comp numeric;
  v_gap     numeric;
  v_verdict text;
  v_combined numeric;
begin
  if not is_staff() then raise exception 'get_ask_fit: staff only'; end if;

  -- The most recent submitted scorecard. An earlier round is history, not a
  -- second opinion to fold in — the same rule get_ask_overlap uses.
  select * into v_card from ask_scorecards
  where candidate_id = p_candidate_id and submitted_at is not null
  order by submitted_at desc limit 1;

  if v_card.id is not null then
    v_levels := ask_levels(v_card.id);
  end if;

  for r in
    select req.id as requirement_id, req.title, req.target_profile_id,
           cl.business_name,
           tp.confidence,
           param('confidence', tp.confidence) as conf_mult,
           m.quality_score, m.composite, m.fit_score,
           m.hard_filter_pass, m.hard_filter_fails, m.hard_filter_unknown
    from requirements req
    join clients cl on cl.id = req.client_id
    join client_target_profile tp on tp.id = req.target_profile_id
    left join matches m on m.requirement_id = req.id and m.candidate_id = p_candidate_id
    where req.status = 'open'
      and cl.business_name not like 'ZZ_FIXTURE%'
    order by cl.business_name, req.title
  loop
    v_test      := case when r.quality_score is not null
                        then round(r.quality_score * 100, 1) end;
    v_test_comp := case when r.composite is not null
                        then round(r.composite * 100, 1) end;

    v_qual := case when v_levels is not null and v_levels <> '{}'::jsonb
                   then quality_from_levels(r.target_profile_id, v_levels) end;
    v_r2   := case when v_qual is not null and (v_qual->>'quality') is not null
                   then round((v_qual->>'quality')::numeric * 100, 1) end;

    -- The stretch. §9.4's 0.6 becomes 1.0 over the evidence the interview has;
    -- the confidence multiplier still applies, because that is a property of how
    -- well the ROLE is specified and has nothing to do with which instrument
    -- read the candidate.
    v_r2_comp := case when v_qual is not null and (v_qual->>'quality') is not null
                      then round((v_qual->>'quality')::numeric * r.conf_mult * 100, 1) end;

    -- The gap and the verdict stay on quality-versus-quality. That pair is the
    -- same quantity measured two ways; composite-versus-composite is not, because
    -- one of them has had a term removed. Agreement is a claim about measurement
    -- and has to be made where the measurement is comparable.
    v_gap := case when v_test is not null and v_r2 is not null
                  then abs(v_test - v_r2) end;

    v_verdict := case
      when v_test is null and v_r2 is null then 'no reading'
      when v_r2 is null   then 'test only'
      when v_test is null then 'interview only'
      when v_gap >= v_thresh then 'contested'
      else 'corroborated'
    end;

    -- Ranked on composites, and still the level both readings support rather
    -- than the flattering one.
    v_combined := case
      when v_test_comp is null and v_r2_comp is null then null
      when v_r2_comp is null   then v_test_comp
      when v_test_comp is null then v_r2_comp
      else least(v_test_comp, v_r2_comp)
    end;

    v_rows := v_rows || jsonb_build_object(
      'requirement_id', r.requirement_id,
      'title', r.title,
      'business_name', r.business_name,

      'composite_pct', v_test_comp,
      'test_quality_pct', v_test,
      'test_fit_pct', case when r.fit_score is not null
                           then round(r.fit_score * 100, 1) end,

      -- The interview: a composite to rank on, and the quality half to trust.
      'r2_composite_pct', v_r2_comp,
      'r2_quality_pct', v_r2,
      'r2_round', case when v_r2 is not null then v_card.round end,
      'r2_coverage', case when v_qual is not null then (v_qual->>'coverage')::numeric end,
      'r2_dimensions_seen', case when v_qual is not null
                                 then v_qual->'dimensions_seen' end,
      'r2_dimensions_missing', case when v_qual is not null
                                    then v_qual->'dimensions_missing' end,
      'confidence', r.confidence,

      'gap', v_gap,
      'verdict', v_verdict,
      'combined_pct', v_combined,

      'hard_filter_pass', r.hard_filter_pass,
      'hard_filter_fails', r.hard_filter_fails,
      'hard_filter_unknown', r.hard_filter_unknown);
  end loop;

  return jsonb_build_object(
    'scorecard_id', v_card.id,
    'round', v_card.round,
    'conducted_on', v_card.conducted_on,
    'ask_pct', v_card.pct,
    'threshold', v_thresh,
    'threshold_note',
      'Provisional, as in sql/36. There is no null model for two instruments on '
      'different evidence, so the line between "corroborated" and "contested" is '
      'a stated guess. Every gap is shown regardless.',
    'r2_composite_note',
      'The interview measures nothing that reaches the fit half of the match, so '
      'its composite stretches the quality weight from 0.6 to 1.0 — which is the '
      'same as assuming the candidate sits on target for deal motion and '
      'interpersonal style. That is the most generous assumption available, so '
      'where fit is genuinely poor this number reads high. The quality pair '
      'beside it is like-for-like and is what the agreement verdict is computed '
      'from.',
    'rows', v_rows);
end $$;

revoke all on function get_ask_fit(uuid) from public;
grant execute on function get_ask_fit(uuid) to authenticated;

-- The requirement direction, carrying the same composite.
--
-- Dropped rather than replaced: `CREATE OR REPLACE VIEW` can only append columns
-- at the end, and the composite belongs beside the quality figure it is derived
-- from rather than trailing the row. Safe here in a way it is not for `v_console`
-- — this view is one migration old and nothing depends on it, which the
-- assertions check by recreating it and then reading it.
drop view if exists v_two_readings;
create view v_two_readings as
with cards as (
  select distinct on (s.candidate_id)
         s.id, s.candidate_id, s.round, s.pct, s.conducted_on
  from ask_scorecards s
  where s.submitted_at is not null and s.attributes is not null
  order by s.candidate_id, s.submitted_at desc
)
select
  req.id                as requirement_id,
  req.title             as requirement_title,
  cl.business_name,
  cand.id               as candidate_id,
  cand.full_name,
  k.round               as r2_round,
  k.conducted_on,
  k.pct                 as ask_pct,
  round(m.quality_score * 100, 1) as test_quality_pct,
  round(m.composite * 100, 1)     as composite_pct,
  round((q.j->>'quality')::numeric * 100, 1) as r2_quality_pct,
  round((q.j->>'quality')::numeric * param('confidence', tp.confidence) * 100, 1)
                                  as r2_composite_pct,
  (q.j->>'coverage')::numeric     as r2_coverage,
  case
    when m.quality_score is null and (q.j->>'quality') is null then 'no reading'
    when (q.j->>'quality') is null then 'test only'
    when m.quality_score is null   then 'interview only'
    when abs(round(m.quality_score * 100, 1) - round((q.j->>'quality')::numeric * 100, 1))
         >= param('ask', 'disagreement_points') then 'contested'
    else 'corroborated'
  end as verdict,
  least(round(m.composite * 100, 1),
        round((q.j->>'quality')::numeric * param('confidence', tp.confidence) * 100, 1))
                                  as both_support_pct,
  m.hard_filter_pass
from cards k
join candidates cand on cand.id = k.candidate_id
cross join requirements req
join clients cl on cl.id = req.client_id
join client_target_profile tp on tp.id = req.target_profile_id
left join matches m on m.requirement_id = req.id and m.candidate_id = k.candidate_id
left join lateral (
  select quality_from_levels(req.target_profile_id, ask_levels(k.id)) as j
) q on true
where req.status = 'open'
  and cl.business_name not like 'ZZ_FIXTURE%'
  and cand.full_name not like 'ZZ_FIXTURE%';

comment on view v_two_readings is
  'Every candidate with a submitted ASK scorecard against every open '
  'requirement, with the questionnaire fit and the interview fit side by side. '
  'The interview composite stretches quality from 0.6 to 1.0 because the '
  'interview reaches nothing in the fit half — see sql/50. '
  'Contains scores — internal only, never a client surface (R1 / C10).';

grant select on v_two_readings to authenticated;

-- ── 2. Staleness, derived rather than remembered ───────────────────────────
--
-- One row per thing that is wrong, naming which input overtook the match. A pair
-- that has never been computed is reported as `missing`, because "no row" and
-- "old row" are the same failure with the same fix and splitting them across two
-- surfaces means one of them gets watched and the other does not.
create or replace view v_match_staleness_audit as
with pool as (
  select distinct on (p.candidate_id)
         p.candidate_id, p.computed_at as profile_at
  from candidate_profile p
  join candidates c on c.id = p.candidate_id
  where c.full_name not like 'ZZ_FIXTURE%'
  order by p.candidate_id, p.computed_at desc
),
reqs as (
  select req.id as requirement_id, req.title, req.opened_at, tp.computed_at as tp_at
  from requirements req
  join clients cl on cl.id = req.client_id
  join client_target_profile tp on tp.id = req.target_profile_id
  where req.status = 'open'
    and cl.business_name not like 'ZZ_FIXTURE%'
)
select
  r.requirement_id,
  r.title,
  p.candidate_id,
  cand.full_name,
  m.computed_at as matched_at,
  greatest(p.profile_at, r.tp_at, coalesce(r.opened_at, r.tp_at)) as newest_input_at,
  case
    when m.candidate_id is null then 'never matched'
    when m.computed_at < p.profile_at then 'the candidate was re-scored after this match'
    when m.computed_at < r.tp_at then 'the role''s target profile was recomputed after this match'
    else 'the role was opened after this match'
  end as why
from pool p
cross join reqs r
join candidates cand on cand.id = p.candidate_id
left join matches m on m.candidate_id = p.candidate_id and m.requirement_id = r.requirement_id
where m.candidate_id is null
   or m.computed_at < greatest(p.profile_at, r.tp_at, coalesce(r.opened_at, r.tp_at));

comment on view v_match_staleness_audit is
  'A match is a pure function of the candidate profile, the target profile and '
  'the requirement, all three of which are timestamped — so a match computed '
  'before any of them is out of date, and a pair with no row never ran at all. '
  'Empty is the only correct state; refresh_stale_matches() makes it so.';

grant select on v_match_staleness_audit to authenticated;

-- Fixes exactly what the audit names, and returns how much it did.
--
-- Deliberately a no-op when the audit is empty: it recomputes the requirements
-- the view implicates and no others, so calling it on a screen that loads often
-- costs one cheap query in the normal case. That is what lets freshness be a
-- property of the system rather than something somebody has to remember.
create or replace function refresh_stale_matches()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_reqs uuid[]; v_rows int; v_r uuid; v_n int := 0;
begin
  if not is_staff() then raise exception 'refresh_stale_matches: staff only'; end if;

  select array_agg(distinct requirement_id), count(*)
    into v_reqs, v_rows from v_match_staleness_audit;

  if v_reqs is null then
    return jsonb_build_object('stale_rows', 0, 'requirements_recomputed', 0);
  end if;

  foreach v_r in array v_reqs loop
    perform compute_matches(v_r);
    v_n := v_n + 1;
  end loop;

  return jsonb_build_object('stale_rows', v_rows, 'requirements_recomputed', v_n);
end $$;

revoke all on function refresh_stale_matches() from public;
grant execute on function refresh_stale_matches() to authenticated;

notify pgrst, 'reload schema';

-- Catch up whatever is stale right now, as part of applying this file. The
-- assertions below then require the audit to be empty, so the migration cannot
-- report success while leaving an out-of-date number on a screen.
do $$
declare v jsonb; v_req uuid; v_n int := 0;
begin
  if is_staff() then
    v := refresh_stale_matches();
    raise notice 'sql/50: refreshed % stale row(s) across % requirement(s)',
      v->>'stale_rows', v->>'requirements_recomputed';
  else
    -- The Management API runs as `postgres`, which is not staff, so the guarded
    -- function is unreachable here. The work it does is not guarded.
    for v_req in select distinct requirement_id from v_match_staleness_audit loop
      perform compute_matches(v_req);
      v_n := v_n + 1;
    end loop;
    raise notice 'sql/50: recomputed % requirement(s) directly', v_n;
  end if;
end $$;

-- ── Assertions ─────────────────────────────────────────────────────────────
do $$
declare
  v_left int; v_tp uuid; v_conf text; v_mult numeric; v_q jsonb; v_n int;
begin
  -- ── The audit is the point: it must be empty after the sweep ────────────
  select count(*) into v_left from v_match_staleness_audit;
  if v_left > 0 then
    raise exception 'sql/50: % match row(s) are still stale after the refresh: %',
      v_left, (select jsonb_agg(jsonb_build_object('who', full_name, 'role', title, 'why', why))
               from (select * from v_match_staleness_audit limit 5) x);
  end if;

  -- And it must be capable of firing. Proved by provoking it in a subtransaction
  -- that is rolled back, the same way sql/38 proves its arms — an audit nobody
  -- has ever seen go red is a query, not a check.
  begin
    update matches set computed_at = '2001-01-01'
    where (requirement_id, candidate_id) in (
      select requirement_id, candidate_id from matches limit 1);
    select count(*) into v_left from v_match_staleness_audit;
    if v_left = 0 then
      raise exception 'sql/50: a match dated 2001 is not reported as stale — the audit cannot fire';
    end if;
    raise exception 'sql/50: rollback the provocation';
  exception when others then
    if position('rollback the provocation' in sqlerrm) = 0 then raise; end if;
  end;

  select count(*) into v_left from v_match_staleness_audit;
  if v_left > 0 then
    raise exception 'sql/50: the provocation did not roll back';
  end if;

  -- ── The stretch is the stretch, not something else ──────────────────────
  select req.target_profile_id, tp.confidence into v_tp, v_conf
  from requirements req join client_target_profile tp on tp.id = req.target_profile_id
  where req.status = 'open' limit 1;

  if v_tp is not null then
    v_mult := param('confidence', v_conf);
    v_q := quality_from_levels(v_tp,
      '{"RES":100,"DRV":100,"DSC":100,"CLS_C":100,"CLS_F":100,"CCH":100,"INT":100}'::jsonb);

    if v_mult is null then
      raise exception 'sql/50: confidence % has no multiplier', v_conf;
    end if;

    -- "Stretch to 1.0" has a second reading — dividing the quality half by 0.6,
    -- i.e. multiplying by 1.667 — which is a different number entirely and would
    -- look perfectly plausible on screen. The composite must be quality scaled
    -- ONLY by confidence, so it can never exceed quality itself.
    if v_mult > 1 then
      raise exception 'sql/50: a confidence multiplier above 1 would inflate every '
                      'interview composite past its own quality reading (% for %)',
                      v_mult, v_conf;
    end if;
    if round((v_q->>'quality')::numeric * v_mult, 6)
       > round((v_q->>'quality')::numeric, 6) then
      raise exception 'sql/50: the interview composite came out above its quality reading';
    end if;
  end if;

  -- ── Both surfaces carry the composite ───────────────────────────────────
  select count(*) into v_n
  from regexp_matches(
    (select pg_get_functiondef(p.oid) from pg_proc p
      join pg_namespace ns on ns.oid = p.pronamespace
      where ns.nspname = 'public' and p.proname = 'get_ask_fit'),
    'r2_composite_pct', 'g');
  if v_n < 1 then raise exception 'get_ask_fit does not return an interview composite'; end if;

  if not exists (select 1 from information_schema.columns
                 where table_name = 'v_two_readings' and column_name = 'r2_composite_pct') then
    raise exception 'v_two_readings does not carry the interview composite';
  end if;

  -- ── Nothing new is reachable without a session ──────────────────────────
  if exists (select 1 from information_schema.role_routine_grants
             where grantee = 'anon' and routine_name = 'refresh_stale_matches') then
    raise exception 'anon can refresh matches';
  end if;

  raise notice 'sql/50 ok — the interview ranks on a composite, and staleness is '
               'derived from the three inputs a match is made of';
end $$;
