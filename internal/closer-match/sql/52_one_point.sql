-- ═══════════════════════════════════════════════════════════════════════════
-- 52 — R1, R2 and the questionnaire, equated to one number
--
-- *"equate r1, r2 and the tests — to equate out of a single point."*
--
-- Three readings have been sitting beside each other with a line underneath
-- saying they are deliberately not combined. That was the right call while they
-- were incommensurable. They are not incommensurable, and this file says exactly
-- why, because the reason is what makes the single number honest rather than an
-- average of three things that mean different things.
--
-- ── R1 AND R2 ARE NOT TWO READINGS ────────────────────────────────────────
--
-- They are **one instrument at two scopes.** Same bank, same anchors, same 0–3
-- scale; R1 asks 8 of the questions and R2 asks 37. So they do not need equating,
-- they need **merging**: one answer set per candidate, most recent score per
-- question, and a coverage figure that says how much of the bank was reached.
--
-- That matters right now, because the flow is changing to "team runs a 15-minute
-- R1, then R2 if it looks worth it". Today `get_ask_fit` reads only the most
-- recent submitted scorecard, so a candidate with an R1 from a colleague and an
-- R2 from later would have the R1 silently discarded — 8 scored answers thrown
-- away for no reason other than that they arrived on a different row.
--
-- ── THE QUESTIONNAIRE IS A DIFFERENT INSTRUMENT, ON THE SAME SCALE ────────
--
-- sql/49 established the basis: both produce *the proportion of the attainable
-- maximum on that trait* — the questionnaire via `(raw + 4) / 12 × 100`, ASK via
-- `points / (3 × questions asked) × 100`. Different means, same kind of quantity.
--
-- So the three meet **per dimension**, not per composite. For each of the nine,
-- there may be a questionnaire level, an interview level, or both; they are
-- combined once, and then §9.4 runs **once** on the result.
--
-- ── WHY PER DIMENSION AND NOT PER COMPOSITE ──────────────────────────────
--
-- Because it removes the assumption sql/50 had to make. §9.4 is
-- `(0.6 × Quality + 0.4 × Fit) × confidence`, and Fit is MOT and STY, which the
-- interview never touches. Averaging an interview composite with a test composite
-- would carry sql/50's stretch — "assume they are on target for deal motion and
-- interpersonal style" — into a candidate for whom the questionnaire had already
-- MEASURED deal motion and interpersonal style. It would be discarding a real
-- number in favour of an assumption, inside an average, invisibly.
--
-- Merging first fixes that. MOT and STY come from the questionnaire when there is
-- one, so the single point runs on the **real** formula, with the real fit half,
-- and the stretch survives only as the fallback for a candidate who has been
-- interviewed and never tested. `one_basis` says which of the two happened, every
-- time, and it is on the screen rather than in a footnote.
--
-- ── WHEN BOTH INSTRUMENTS SPEAK, THE ONE WITH MORE EVIDENCE COUNTS MORE ───
--
-- The combination is an **evidence-weighted mean**: each reading is weighted by
-- the number of items actually behind it for that dimension. Not a preference for
-- one instrument, and not a fixed 50/50 — a fact about how much was measured,
-- recomputed per candidate per dimension from what was really answered.
--
--     DSC:  questionnaire 5 items, interview 6 questions  → 45% / 55%
--     INT:  questionnaire 4 items, interview 2 questions  → 67% / 33%
--     RES:  questionnaire 5 items, interview 2 questions  → 71% / 29%
--     MOT:  questionnaire 5 items, interview 0            → the questionnaire alone
--
-- An 8-question R1 therefore moves the number a little and a 37-question R2 moves
-- it a lot, with nothing anywhere that had to be told so. A half-finished R2
-- counts for exactly the questions it actually asked.
--
-- > **A weight nobody derived will end up wherever it was first typed.** This one
-- > is derived from the item counts, so it cannot drift away from the evidence,
-- > and it needs no tuning when the bank changes.
--
-- ── WHAT IS LOST, SAID PLAINLY ────────────────────────────────────────────
--
-- Disagreement. §7ae's argument has been that two readings are worth more apart
-- than averaged, because the gap is the most informative thing they produce, and
-- a single point does average them. That argument has not become wrong.
--
-- So the gap is not destroyed, it is **demoted**: `get_ask_fit` still returns both
-- composites, both quality halves, the per-dimension gap and the corroborated /
-- contested verdict, and the console still shows them under the single number.
-- One point to rank on, the workings underneath. What this file refuses to do is
-- produce the single point while hiding the fact that two instruments disagreed
-- about the person it describes.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. §9.3, once ──────────────────────────────────────────────────────────
-- The quality half got its single definition in sql/49. The fit half now needs
-- one too, because this file is about to become its second caller — and a second
-- implementation of §9.3 would drift from the first exactly as surely.
create or replace function fit_from_levels(p_target_profile_id uuid, p_levels jsonb)
returns jsonb language plpgsql stable set search_path = public as $$
declare
  v_tp      client_target_profile;
  v_dim     text;
  v_w       numeric;
  v_target  numeric;
  v_cand    numeric;
  v_num     numeric := 0;
  v_den     numeric := 0;
  v_total_w numeric := 0;
  v_seen    text[] := '{}';
  v_missing text[] := '{}';
  v_delta   numeric;
  v_reasons  jsonb := '[]'::jsonb;
  v_concerns jsonb := '[]'::jsonb;
begin
  select * into v_tp from client_target_profile where id = p_target_profile_id;
  if v_tp.id is null then
    raise exception 'fit_from_levels: no such target profile %', p_target_profile_id;
  end if;

  foreach v_dim in array array['MOT','STY'] loop
    if not (v_tp.dimension_weights ? v_dim) then
      raise exception 'fit_from_levels: target profile % has no weight for %',
        p_target_profile_id, v_dim;
    end if;
    if not (v_tp.bipolar_targets ? v_dim) then
      raise exception 'fit_from_levels: target profile % has no bipolar target for %',
        p_target_profile_id, v_dim;
    end if;

    v_w       := (v_tp.dimension_weights->>v_dim)::numeric;
    v_target  := (v_tp.bipolar_targets->>v_dim)::numeric;
    v_total_w := v_total_w + v_w;

    v_cand := (p_levels->>v_dim)::numeric;
    if v_cand is null then
      v_missing := array_append(v_missing, v_dim);
      continue;
    end if;
    v_seen := array_append(v_seen, v_dim);

    -- §9.3: bipolar, so distance from target in BOTH directions. There is no
    -- better pole on MOT or STY — being further "up" is not being better.
    v_num := v_num + v_w * abs(v_cand - v_target) / 100.0;
    v_den := v_den + v_w;

    v_delta := abs(v_cand - v_target);
    if v_delta <= 20 then
      v_reasons := v_reasons || jsonb_build_object(
        'dimension', v_dim, 'score', v_cand, 'required', v_target,
        'weight', v_w, 'rank_score', (20 - v_delta) * v_w);
    elsif v_delta >= 40 then
      v_concerns := v_concerns || jsonb_build_object(
        'dimension', v_dim, 'score', v_cand, 'required', v_target,
        'weight', v_w, 'rank_score', v_delta * v_w);
    end if;
  end loop;

  return jsonb_build_object(
    'fit',          case when v_den > 0 then 1 - (v_num / v_den) end,
    'weight_seen',  v_den,
    'weight_total', v_total_w,
    'coverage',     case when v_total_w > 0 then round(v_den / v_total_w, 4) end,
    'dimensions_seen',    to_jsonb(v_seen),
    'dimensions_missing', to_jsonb(v_missing),
    'reasons',  v_reasons,
    'concerns', v_concerns);
end $$;

comment on function fit_from_levels(uuid, jsonb) is
  'PRD §9.3, the single definition. Bipolar distance from target on MOT and STY. '
  'An absent level means not measured: it leaves both halves of the fraction and '
  'is reported in dimensions_missing. Called by compute_matches() and one_fit().';

revoke all on function fit_from_levels(uuid, jsonb) from public;
grant execute on function fit_from_levels(uuid, jsonb) to authenticated;

-- compute_matches, now calling both halves rather than inlining one of them.
create or replace function compute_matches(p_requirement_id uuid)
returns int language plpgsql as $$
declare
  v_req        requirements;
  v_tp         client_target_profile;
  v_client_comp numeric;
  v_conf_mult  numeric;
  v_wq         numeric := param('composite','w_quality');
  v_wf         numeric := param('composite','w_fit');
  v_split      numeric := param('flags','frame_split_delta');
  v_gap        numeric := param('fit','attrition_band_gap');
  c            record;
  v_qual       jsonb;
  v_fitj       jsonb;
  v_cls_eff    numeric;
  v_q numeric; v_f numeric;
  v_reasons jsonb; v_concerns jsonb;
  v_fails text[];
  v_unknown text[];
  v_check jsonb;
  v_n int := 0;
  v_is_fixture boolean;
begin
  select * into v_req from requirements where id = p_requirement_id;
  if v_req.id is null then
    raise exception 'compute_matches: no such requirement %', p_requirement_id;
  end if;

  select * into v_tp from client_target_profile where id = v_req.target_profile_id;
  if v_tp.id is null then
    raise exception 'compute_matches: requirement % has no target profile', p_requirement_id;
  end if;

  v_conf_mult   := param('confidence', v_tp.confidence);
  select (payload->>'comp_band')::numeric into v_client_comp
  from client_intake where id = v_tp.intake_id;

  -- A fixture requirement ranks fixture candidates and nothing else. Found by
  -- golden case 1a going red once a real candidate's eligibility facts were
  -- entered. A test that the product's normal use can turn red is not a test.
  select cl.business_name like 'ZZ_FIXTURE%' into v_is_fixture
  from clients cl where cl.id = v_req.client_id;

  -- An upsert never removes, so narrowing who is ranked has to clear explicitly.
  delete from matches m
  using candidates cand
  where m.requirement_id = p_requirement_id
    and cand.id = m.candidate_id
    and (cand.full_name like 'ZZ_FIXTURE%') <> v_is_fixture;

  for c in
    select distinct on (p.candidate_id)
           p.candidate_id, p.scores, p.flags, cand.direct_fields
    from candidate_profile p
    join candidates cand on cand.id = p.candidate_id
    where (cand.full_name like 'ZZ_FIXTURE%') = v_is_fixture
    order by p.candidate_id, p.computed_at desc
  loop
    -- §9.2 + §9.2.1, and §9.3, each from its one definition.
    v_qual    := quality_from_levels(v_req.target_profile_id, c.scores);
    v_fitj    := fit_from_levels(v_req.target_profile_id, c.scores);
    v_q       := (v_qual->>'quality')::numeric;
    v_f       := (v_fitj->>'fit')::numeric;
    v_cls_eff := (v_qual->>'cls_effective')::numeric;
    v_reasons  := (v_qual->'reasons')  || (v_fitj->'reasons');
    v_concerns := (v_qual->'concerns') || (v_fitj->'concerns');

    -- §9.1 Hard filters. Three outcomes, not two: a check with no candidate data
    -- to read has not passed and has not failed. See sql/29.
    v_check   := hard_filter_check(coalesce(c.direct_fields, '{}'::jsonb), v_req.hard_filters);
    v_fails   := coalesce(array(select jsonb_array_elements_text(v_check->'fails')), '{}');
    v_unknown := coalesce(array(select jsonb_array_elements_text(v_check->'unknown')), '{}');

    insert into matches (
      requirement_id, candidate_id, cls_effective, quality_score, fit_score,
      composite, confidence_multiplier, hard_filter_pass, hard_filter_fails, hard_filter_unknown,
      rationale, attrition_risk_flag, frame_split_flag, computed_at
    ) values (
      p_requirement_id, c.candidate_id, round(v_cls_eff, 2),
      round(v_q, 4), round(v_f, 4),
      round((v_wq * v_q + v_wf * v_f) * v_conf_mult, 4),
      v_conf_mult,
      array_length(v_fails, 1) is null and array_length(v_unknown, 1) is null,
      v_fails, v_unknown,
      jsonb_build_object(
        'reasons',  v_reasons,
        'concerns', v_concerns,
        'weights_are_expert_set', true,   -- §9.4: must be labelled as such in the UI
        'cls_blend', v_tp.cls_blend,
        'confidence', v_tp.confidence,
        'benchmark_source', v_tp.benchmark_source
      ),
      -- §9.3 attrition risk: independent of score. A great closer on the wrong
      -- comp contract leaves in month three, and that failure looks like a bad
      -- match when it was a bad contract.
      abs(coalesce((c.direct_fields->>'comp_band')::numeric, v_client_comp)
          - coalesce(v_client_comp, 3)) > v_gap,
      abs((c.scores->>'CLS_C')::numeric - (c.scores->>'CLS_F')::numeric) >= v_split,
      now()
    )
    on conflict (requirement_id, candidate_id) do update set
      cls_effective = excluded.cls_effective,
      quality_score = excluded.quality_score,
      fit_score = excluded.fit_score,
      composite = excluded.composite,
      confidence_multiplier = excluded.confidence_multiplier,
      hard_filter_pass = excluded.hard_filter_pass,
      hard_filter_fails = excluded.hard_filter_fails,
      -- Every column added to the INSERT must be added here too. This one was
      -- missed on the first pass and every re-match quietly kept a NULL.
      hard_filter_unknown = excluded.hard_filter_unknown,
      rationale = excluded.rationale,
      attrition_risk_flag = excluded.attrition_risk_flag,
      frame_split_flag = excluded.frame_split_flag,
      computed_at = now();

    v_n := v_n + 1;
  end loop;

  return v_n;
end $$;

-- ── 2. Every interview a candidate has ever finished, as one answer set ────
--
-- Not "the most recent scorecard" — every submitted one, merged. R1 and R2 are
-- the same bank, so an R1 answer and an R2 answer to the same question are two
-- readings of one item and the later one wins. An R1 question that R2 never got
-- to still counts; that is the whole reason for merging rather than picking.
--
-- Reference questions are included when they have been scored, on the same rule
-- `recompute_ask_totals` uses (sql/40): a reference answer is real evidence the
-- moment it exists, and invisible before that.
create or replace function ask_levels_merged(p_candidate_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_out jsonb; v_rounds text[]; v_scored int;
begin
  if not is_staff() then raise exception 'ask_levels_merged: staff only'; end if;

  with answers as (
    -- One row per question: the latest score the candidate has on it, across
    -- every scorecard they have finished.
    select distinct on (s.question_id)
           s.question_id, s.score, q.attribute_id, c.round
    from ask_scorecards c
    join ask_scores s on s.scorecard_id = c.id
    join ask_questions q on q.id = s.question_id
    join ask_attributes a on a.id = q.attribute_id
    where c.candidate_id = p_candidate_id
      and c.submitted_at is not null
      and s.score is not null
      and q.active and a.active
    order by s.question_id, c.submitted_at desc, s.answered_at desc
  ),
  per_dim as (
    select m.dimension_code,
           sum(x.score)::numeric as pts,
           count(*)              as n
    from answers x
    join ask_dimension_map m on m.attribute_id = x.attribute_id
    group by m.dimension_code
  )
  select
    jsonb_object_agg(d.dimension_code,
      jsonb_build_object('level', round(d.pts / (d.n * 3) * 100, 1), 'items', d.n)),
    (select array_agg(distinct round order by round) from answers),
    (select count(*) from answers)
  into v_out, v_rounds, v_scored
  from per_dim d;

  return jsonb_build_object(
    'dimensions', coalesce(v_out, '{}'::jsonb),
    'rounds', coalesce(to_jsonb(v_rounds), '[]'::jsonb),
    'questions_scored', coalesce(v_scored, 0));
end $$;

revoke all on function ask_levels_merged(uuid) from public;
grant execute on function ask_levels_merged(uuid) to authenticated;

-- ── 3. One set of levels, from everything that has been measured ───────────
--
-- Per dimension: the questionnaire's level, the interview's level, or a mean of
-- the two weighted by how many items sit behind each. The provenance travels with
-- it — which instruments spoke, and how much each was carrying — because a 72
-- from five test items and two interview questions is a different kind of 72 from
-- one built on eleven, and the screen should be able to say so.
create or replace function candidate_levels(p_candidate_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_ask     jsonb;
  v_test    jsonb;
  v_out     jsonb := '{}'::jsonb;
  d         record;
  v_t       numeric; v_a numeric;
  v_ti      int;     v_ai int;
  v_level   numeric;
  v_source  text;
begin
  if not is_staff() then raise exception 'candidate_levels: staff only'; end if;

  v_ask := ask_levels_merged(p_candidate_id) -> 'dimensions';

  select p.scores into v_test from candidate_profile p
  where p.candidate_id = p_candidate_id
  order by p.computed_at desc limit 1;

  for d in select code from dimensions where active order by code loop
    v_t := case when v_test ? d.code then (v_test->>d.code)::numeric end;
    v_a := case when v_ask ? d.code then (v_ask->d.code->>'level')::numeric end;
    v_ai := coalesce((v_ask->d.code->>'items')::int, 0);

    -- How many live items the questionnaire actually puts behind this dimension,
    -- read from the bank rather than assumed — the bank is editable, and a weight
    -- that stops matching the instrument is worse than no weight at all.
    select count(*) into v_ti from items i where i.dimension_code = d.code and i.active;
    if v_t is null then v_ti := 0; end if;

    if v_t is null and v_a is null then
      continue;                                  -- nobody measured it: say nothing
    elsif v_a is null then
      v_level := v_t; v_source := 'questionnaire';
    elsif v_t is null then
      v_level := v_a; v_source := 'interview';
    else
      v_level := round((v_t * v_ti + v_a * v_ai) / nullif(v_ti + v_ai, 0), 1);
      v_source := 'both';
    end if;

    v_out := v_out || jsonb_build_object(d.code, jsonb_build_object(
      'level', v_level,
      'source', v_source,
      'questionnaire', v_t,
      'interview', v_a,
      'questionnaire_items', v_ti,
      'interview_items', v_ai));
  end loop;

  return v_out;
end $$;

revoke all on function candidate_levels(uuid) from public;
grant execute on function candidate_levels(uuid) to authenticated;

-- Flattened to `{dim: level}` for the two scoring functions, which take levels
-- and know nothing about where a level came from.
create or replace function levels_flat(p_levels jsonb)
returns jsonb language sql immutable set search_path = public as $$
  select coalesce(jsonb_object_agg(k, (v->>'level')::numeric), '{}'::jsonb)
  from jsonb_each(p_levels) e(k, v)
  where v->>'level' is not null;
$$;

revoke all on function levels_flat(jsonb) from public;
grant execute on function levels_flat(jsonb) to authenticated;

-- ── 4. The single point ────────────────────────────────────────────────────
create or replace function one_fit(p_target_profile_id uuid, p_candidate_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_levels jsonb; v_flat jsonb; v_q jsonb; v_f jsonb;
  v_tp client_target_profile;
  v_conf numeric; v_wq numeric; v_wf numeric;
  v_quality numeric; v_fit numeric; v_comp numeric;
  v_basis text; v_srcs text[];
begin
  if not is_staff() then raise exception 'one_fit: staff only'; end if;

  select * into v_tp from client_target_profile where id = p_target_profile_id;
  if v_tp.id is null then
    raise exception 'one_fit: no such target profile %', p_target_profile_id;
  end if;

  v_levels := candidate_levels(p_candidate_id);
  v_flat   := levels_flat(v_levels);
  if v_flat = '{}'::jsonb then
    return jsonb_build_object('pct', null, 'basis', 'nothing measured');
  end if;

  v_conf := param('confidence', v_tp.confidence);
  v_wq   := param('composite', 'w_quality');
  v_wf   := param('composite', 'w_fit');

  v_q := quality_from_levels(p_target_profile_id, v_flat);
  v_f := fit_from_levels(p_target_profile_id, v_flat);
  v_quality := (v_q->>'quality')::numeric;
  v_fit     := (v_f->>'fit')::numeric;

  -- The real §9.4 whenever the fit half was measured at all; sql/50's stretch
  -- only when it was not. Which one ran is reported, never inferred from the
  -- number — the two are indistinguishable once printed.
  if v_fit is not null then
    v_comp  := (v_wq * v_quality + v_wf * v_fit) * v_conf;
    v_basis := case when (v_f->>'coverage')::numeric >= 1
                    then 'full' else 'partial fit' end;
  elsif v_quality is not null then
    v_comp  := v_quality * v_conf;
    v_basis := 'quality stretched';
  else
    return jsonb_build_object('pct', null, 'basis', 'nothing measured');
  end if;

  select array_agg(distinct v->>'source') into v_srcs from jsonb_each(v_levels) e(k, v);

  return jsonb_build_object(
    'pct',   round(v_comp * 100, 1),
    'basis', v_basis,
    'quality_pct', case when v_quality is not null then round(v_quality * 100, 1) end,
    'fit_pct',     case when v_fit is not null then round(v_fit * 100, 1) end,
    'quality_coverage', (v_q->>'coverage')::numeric,
    'fit_coverage',     (v_f->>'coverage')::numeric,
    'sources', to_jsonb(v_srcs),
    'levels', v_levels,
    'basis_note', case v_basis
      when 'full' then
        'Every dimension the role weights was measured, so this is the ordinary '
        'match: 60% quality against the required levels, 40% fit against deal '
        'motion and interpersonal style.'
      when 'partial fit' then
        'Only part of the fit half was measured. The fit term is normalised over '
        'what was there, so this leans on less evidence than it looks like.'
      else
        'Nobody has measured deal motion or interpersonal style for this '
        'candidate, so the fit half is absent and the quality weight is '
        'stretched from 60% to 100%. That is the same as assuming they sit on '
        'target for both, which is the most generous assumption available — a '
        'questionnaire would settle it.'
    end);
end $$;

revoke all on function one_fit(uuid, uuid) from public;
grant execute on function one_fit(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';

-- ── Assertions ─────────────────────────────────────────────────────────────
do $$
declare
  v_before jsonb; v_after jsonb; v_req uuid; v_bad int; v_sample jsonb;
  v_tp uuid; v_cand uuid; v_one jsonb; v_lv jsonb; v_n int;
begin
  -- ── compute_matches still produces the same numbers ─────────────────────
  -- Written as a comparison of VALUES on the pairs that already existed, not of
  -- sets: sql/49 learned that the row count legitimately grows when a candidate
  -- has been scored since the last match, and a set comparison cannot tell that
  -- from a score moving.
  select jsonb_object_agg(requirement_id::text || ':' || candidate_id::text,
           jsonb_build_object('q', quality_score, 'f', fit_score,
                              'x', composite, 'cls', cls_effective))
    into v_before from matches;

  if v_before is not null then
    for v_req in select distinct requirement_id from matches loop
      perform compute_matches(v_req);
    end loop;
    select jsonb_object_agg(requirement_id::text || ':' || candidate_id::text,
             jsonb_build_object('q', quality_score, 'f', fit_score,
                                'x', composite, 'cls', cls_effective))
      into v_after from matches;

    select count(*), jsonb_agg(jsonb_build_object(
             'pair', key, 'was', v_before -> key, 'now', v_after -> key))
      into v_bad, v_sample
    from jsonb_object_keys(v_before) key
    where v_after ? key and v_after -> key <> v_before -> key;

    if v_bad > 0 then
      raise exception 'sql/52: extracting the fit half MOVED % score row(s). Refusing. %',
        v_bad, v_sample;
    end if;
    raise notice 'sql/52: % match rows unchanged by moving §9.3 into fit_from_levels',
      (select count(*) from jsonb_object_keys(v_before));
  end if;

  select req.target_profile_id into v_tp from requirements req
  where req.status = 'open' limit 1;

  if v_tp is not null then
    -- ── An absent bipolar level is not a zero ─────────────────────────────
    v_lv := fit_from_levels(v_tp, '{"MOT":50,"STY":50}'::jsonb);
    if (v_lv->>'coverage')::numeric <> 1 then
      raise exception 'both bipolar levels do not read as full fit coverage: %', v_lv;
    end if;
    v_lv := fit_from_levels(v_tp, '{"MOT":50}'::jsonb);
    if (v_lv->>'coverage')::numeric >= 1 or (v_lv->>'fit') is null then
      raise exception 'one bipolar level did not read as partial coverage: %', v_lv;
    end if;
    v_lv := fit_from_levels(v_tp, '{}'::jsonb);
    if (v_lv->>'fit') is not null then
      raise exception 'no bipolar levels produced a fit number: %', v_lv;
    end if;

    -- A candidate sitting exactly on both targets is a perfect fit, and one at
    -- the far end of both is not. Cheap, and it catches a sign flip — which would
    -- otherwise show up as a plausible-looking number ranking people backwards.
    if (fit_from_levels(v_tp, jsonb_build_object(
          'MOT', (select bipolar_targets->>'MOT' from client_target_profile where id = v_tp),
          'STY', (select bipolar_targets->>'STY' from client_target_profile where id = v_tp)))
        ->>'fit')::numeric <> 1 then
      raise exception 'sql/52: a candidate on both bipolar targets does not score a perfect fit';
    end if;
  end if;

  -- ── The single point, on real people ────────────────────────────────────
  if is_staff() then
    for v_cand in
      select distinct c.candidate_id from ask_scorecards c
      where c.submitted_at is not null limit 5
    loop
      v_one := one_fit(v_tp, v_cand);
      if (v_one->>'pct') is null then
        raise exception 'sql/52: a submitted interview produced no single point for %', v_cand;
      end if;
      if (v_one->>'basis') not in ('full', 'partial fit', 'quality stretched') then
        raise exception 'sql/52: unknown basis % for %', v_one->>'basis', v_cand;
      end if;
      -- The basis must match the evidence rather than being decorative.
      if (v_one->>'basis') = 'full' and (v_one->>'fit_pct') is null then
        raise exception 'sql/52: basis says full but there is no fit reading for %', v_cand;
      end if;
      if (v_one->>'basis') = 'quality stretched' and (v_one->>'fit_pct') is not null then
        raise exception 'sql/52: basis says stretched but a fit reading exists for %', v_cand;
      end if;
    end loop;
    raise notice 'sql/52: every submitted interview yields a single point';
  else
    raise notice 'sql/52: one_fit and the merge are is_staff() guarded — covered by test/ask.js';
  end if;

  -- ── Nothing new is reachable without a session ──────────────────────────
  select count(*) into v_n from information_schema.role_routine_grants
  where grantee = 'anon'
    and routine_name in ('fit_from_levels','ask_levels_merged','candidate_levels',
                         'levels_flat','one_fit');
  if v_n > 0 then raise exception 'sql/52: anon can reach % of the new functions', v_n; end if;

  raise notice 'sql/52 ok — R1, R2 and the questionnaire meet per dimension and '
               'leave as one number, with the workings kept';
end $$;
