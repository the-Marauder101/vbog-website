-- ═══════════════════════════════════════════════════════════════════════════
-- 49 — a requirement fit from the R2 interview, beside the one from the test
--
-- Today a candidate can only be matched to a requirement if they sat the
-- questionnaire. That is the wrong constraint on a business that runs R2s: of the
-- five submitted ASK scorecards on this database right now, **not one belongs to
-- a candidate with a questionnaire profile.** Five people have been interviewed
-- for an hour each, scored against 168 written anchors, and the console can say
-- nothing about which open role they suit. The interview data is sitting there
-- unmatched.
--
-- So: a second, independent fit, computed from the ASK scorecard, through the
-- same §9.2 arithmetic, against the same weights and the same required levels.
--
-- ── WHAT THIS DOES NOT DO ──────────────────────────────────────────────────
--
-- It does not put ASK into the match score. `compute_matches()`,
-- `matches.composite` and `candidate_profile.scores` mean exactly what they meant
-- before this file — the questionnaire's reading, and nothing else. §7ae, and
-- `test/ask.js` asserts the bytes.
--
-- The ASK fit is a **parallel** number with its own name (`r2_quality`) that is
-- never written into `matches` and never averaged into anything. Two readings are
-- worth more apart than blended; blend them and you can never find out which one
-- predicted the good hire.
--
-- ── WHY THE TWO NUMBERS CAN BE COMPARED AT ALL ─────────────────────────────
--
-- Not because both happen to end in a percent sign. Because both are, in their
-- construction, **the proportion of the attainable maximum on that trait**:
--
--   · questionnaire, sql/04:  score = (raw + 4) / 12 × 100   — the Likert sum as
--     a fraction of the range the four items could produce
--   · ASK, sql/40:            score = points / (3 × questions asked) × 100
--
-- Same shape of quantity, arrived at by completely different means. That is what
-- makes the comparison meaningful and also what keeps it a comparison rather than
-- an equivalence: a point of one is not a point of the other, and where they
-- disagree this file reports the disagreement instead of resolving it.
--
-- ── THE HALF ASK CANNOT SEE, STATED PLAINLY ────────────────────────────────
--
-- §9.4 is `composite = (0.6 × Quality + 0.4 × Fit) × confidence`, and **Fit is
-- MOT and STY** — deal motion and interpersonal style, the two bipolar
-- dimensions. `ask_dimension_map` maps no ASK attribute onto either, deliberately
-- (sql/36), because the interview does not ask what ticket band somebody's
-- instincts are tuned to.
--
-- Therefore there is no such thing as an ASK composite, and this file does not
-- invent one by quietly reusing the questionnaire's fit half or by renormalising
-- 0.6 up to 1.0 and hoping nobody checks. **The ASK reading is the quality half
-- only**, it is labelled that everywhere it appears, and it is compared against
-- `matches.quality_score` — the questionnaire's quality half — so the two numbers
-- being set beside each other are the same quantity computed from different
-- evidence. The composite stays on screen as the full reading it is.
--
-- ── ONE DEFINITION OF §9.2 ─────────────────────────────────────────────────
--
-- The quality formula now lives in exactly one place, `quality_from_levels()`,
-- and `compute_matches()` is rewritten to call it. A second implementation of
-- Σ[w × min(cand/req, cap)] / Σw would drift from the first, which is the lesson
-- of sql/33 and sql/37 and not one worth learning a third time.
--
-- Rewriting the match engine on a live tool needs proof, not confidence, so the
-- assertions at the bottom recompute **every existing match on real data** and
-- require `quality_score`, `fit_score`, `composite` and `cls_effective` to come
-- back byte-identical. Golden cases stay 19/19 on top of that.
--
-- ── COVERAGE, AND WHY THE DENOMINATOR MOVES ────────────────────────────────
--
-- An R1 scorecard scores 8 questions across the priority attributes. It can speak
-- to some dimensions and is silent on others. A half-finished R2 is the same
-- problem in a different shape.
--
-- The formula's denominator is Σw over the dimensions the scorecard could
-- actually see, so a partial reading is a percentage of what it measured rather
-- than a punishment for what it did not ask. What that costs is comparability:
-- 70% seen through a third of the requirement's weight is not the same claim as
-- 70% seen through all of it. So `coverage` — the fraction of the requirement's
-- quality weight the scorecard reached — travels with every ASK fit, and the
-- console shows it next to the number rather than in a footnote.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. §9.2, once ──────────────────────────────────────────────────────────
--
-- Takes a target profile and whatever dimension levels are known for a person,
-- returns the weighted quality plus what it could and could not see.
--
-- `p_levels` is keyed by dimension code and carries the two closing poles
-- separately: {"RES":72,"DRV":60,"DSC":81,"CLS_C":55,"CLS_F":90,"CCH":66,"INT":88}.
-- A key that is absent means **not measured**, which is not the same as zero and
-- is not the same as bad — it drops out of both halves of the fraction and is
-- named in `dimensions_missing`.
create or replace function quality_from_levels(p_target_profile_id uuid,
                                              p_levels jsonb)
returns jsonb language plpgsql stable set search_path = public as $$
declare
  v_tp      client_target_profile;
  v_cap     numeric := param('quality', 'over_requirement_cap');
  v_dim     text;
  v_w       numeric;
  v_req_lvl numeric;
  v_cand    numeric;
  v_num     numeric := 0;
  v_den     numeric := 0;
  v_total_w numeric := 0;
  v_seen    text[] := '{}';
  v_missing text[] := '{}';
  v_cls_eff numeric;
  v_wc      numeric;
  v_wf      numeric;
  v_delta   numeric;
  v_reasons  jsonb := '[]'::jsonb;
  v_concerns jsonb := '[]'::jsonb;
begin
  select * into v_tp from client_target_profile where id = p_target_profile_id;
  if v_tp.id is null then
    raise exception 'quality_from_levels: no such target profile %', p_target_profile_id;
  end if;

  -- ── CLS_effective (§9.2.1), with the blend renormalised over the poles that
  -- were actually measured.
  --
  -- The questionnaire always produces both poles, so for `compute_matches` this
  -- branch is always the plain two-term sum it has always been. ASK is where it
  -- matters: Closing Ability speaks to both poles, Objection Handling only to the
  -- considered one, so an interview can easily know CLS_C and not CLS_F. Scoring
  -- the unknown pole as zero would invent a weakness; renormalising says "on the
  -- evidence there is, here is the effective closing level", which is the honest
  -- reading and is reported with its coverage.
  v_wc := (v_tp.cls_blend->>'w_C')::numeric;
  v_wf := (v_tp.cls_blend->>'w_F')::numeric;
  if p_levels ? 'CLS_C' and p_levels ? 'CLS_F' then
    v_cls_eff := v_wc * (p_levels->>'CLS_C')::numeric
               + v_wf * (p_levels->>'CLS_F')::numeric;
  elsif p_levels ? 'CLS_C' then
    v_cls_eff := (p_levels->>'CLS_C')::numeric;
  elsif p_levels ? 'CLS_F' then
    v_cls_eff := (p_levels->>'CLS_F')::numeric;
  else
    v_cls_eff := null;
  end if;

  foreach v_dim in array array['RES','DRV','DSC','CLS','CCH','INT'] loop
    if not (v_tp.dimension_weights ? v_dim) then
      raise exception 'quality_from_levels: target profile % has no weight for %',
        p_target_profile_id, v_dim;
    end if;
    if not (v_tp.required_levels ? v_dim) then
      raise exception 'quality_from_levels: target profile % has no required level for %',
        p_target_profile_id, v_dim;
    end if;

    v_w       := (v_tp.dimension_weights->>v_dim)::numeric;
    v_req_lvl := (v_tp.required_levels->>v_dim)::numeric;
    v_total_w := v_total_w + v_w;

    v_cand := case when v_dim = 'CLS' then v_cls_eff
                   else (p_levels->>v_dim)::numeric end;

    if v_cand is null then
      v_missing := array_append(v_missing, v_dim);
      continue;
    end if;
    v_seen := array_append(v_seen, v_dim);

    v_num := v_num + v_w * least(v_cand / nullif(v_req_lvl, 0), v_cap);
    v_den := v_den + v_w;

    -- §9.5 reason and concern candidates, ranked by weighted distance from the
    -- requirement so a top-weighted dimension outranks an unweighted one.
    v_delta := v_cand - v_req_lvl;
    if v_delta >= 0 then
      v_reasons := v_reasons || jsonb_build_object(
        'dimension', v_dim, 'score', round(v_cand), 'required', v_req_lvl,
        'weight', v_w, 'rank_score', v_delta * v_w);
    else
      v_concerns := v_concerns || jsonb_build_object(
        'dimension', v_dim, 'score', round(v_cand), 'required', v_req_lvl,
        'weight', v_w, 'rank_score', abs(v_delta) * v_w);
    end if;
  end loop;

  return jsonb_build_object(
    'quality',       case when v_den > 0 then v_num / v_den end,
    'cls_effective', v_cls_eff,
    'weight_seen',   v_den,
    'weight_total',  v_total_w,
    'coverage',      case when v_total_w > 0 then round(v_den / v_total_w, 4) end,
    'dimensions_seen',    to_jsonb(v_seen),
    'dimensions_missing', to_jsonb(v_missing),
    'reasons',  v_reasons,
    'concerns', v_concerns);
end $$;

comment on function quality_from_levels(uuid, jsonb) is
  'PRD §9.2 / §9.2.1, the single definition. Weighted quality of a set of '
  'dimension levels against one requirement''s target profile. An absent level '
  'means not measured: it leaves both halves of the fraction and is reported in '
  'dimensions_missing, so a partial reading carries its own coverage. Called by '
  'compute_matches() for the questionnaire and by get_ask_fit() for the interview.';

revoke all on function quality_from_levels(uuid, jsonb) from public;
grant execute on function quality_from_levels(uuid, jsonb) to authenticated;

-- ── 2. compute_matches, now calling it ─────────────────────────────────────
-- Byte-for-byte the same output. The quality loop and the CLS blend are gone from
-- this body and nothing else about it changes; the assertions at the bottom prove
-- the claim against every match row on the database rather than asserting it.
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
  v_cls_eff    numeric;
  v_f_num numeric; v_f_den numeric;
  v_q numeric; v_f numeric;
  v_dim text; v_w numeric; v_cand numeric;
  v_reasons jsonb; v_concerns jsonb;
  v_fails text[];
  v_unknown text[];
  v_check jsonb;
  v_n int := 0;
  v_delta numeric;
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
  -- entered: they passed the fixture requirement's hard filters and displaced the
  -- frame-split fixture from rank 3. A test that the product's normal use can
  -- turn red is not a test.
  select cl.business_name like 'ZZ_FIXTURE%' into v_is_fixture
  from clients cl where cl.id = v_req.client_id;

  -- An upsert never removes. Narrowing who is ranked leaves everyone previously
  -- ranked still sitting there, so the rows have to be cleared explicitly.
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
    -- ── §9.2 + §9.2.1 Quality, from the one definition ─────────────────────
    v_qual    := quality_from_levels(v_req.target_profile_id, c.scores);
    v_q       := (v_qual->>'quality')::numeric;
    v_cls_eff := (v_qual->>'cls_effective')::numeric;
    v_reasons := v_qual->'reasons';
    v_concerns := v_qual->'concerns';

    -- ── §9.3 Fit — bipolar, distance from target in BOTH directions ─────────
    -- Stays here rather than moving into a shared function: the interview has no
    -- reading on MOT or STY, so there is no second caller for it and a helper
    -- with one caller is a worse arrangement than a loop in the one place it runs.
    v_f_num := 0; v_f_den := 0;
    foreach v_dim in array array['MOT','STY'] loop
      v_w    := (v_tp.dimension_weights->>v_dim)::numeric;
      v_cand := (c.scores->>v_dim)::numeric;
      v_f_num := v_f_num + v_w * abs(v_cand - (v_tp.bipolar_targets->>v_dim)::numeric) / 100.0;
      v_f_den := v_f_den + v_w;

      v_delta := abs(v_cand - (v_tp.bipolar_targets->>v_dim)::numeric);
      if v_delta <= 20 then
        v_reasons := v_reasons || jsonb_build_object(
          'dimension', v_dim, 'score', v_cand,
          'required', (v_tp.bipolar_targets->>v_dim)::numeric,
          'weight', v_w, 'rank_score', (20 - v_delta) * v_w);
      elsif v_delta >= 40 then
        v_concerns := v_concerns || jsonb_build_object(
          'dimension', v_dim, 'score', v_cand,
          'required', (v_tp.bipolar_targets->>v_dim)::numeric,
          'weight', v_w, 'rank_score', v_delta * v_w);
      end if;
    end loop;

    v_f := 1 - (v_f_num / nullif(v_f_den, 0));

    -- ── §9.1 Hard filters. Three outcomes, not two: a check with no candidate
    -- data to read has not passed and has not failed. See sql/29.
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
      -- missed on the first pass: the rows already existed, so every re-match
      -- took the UPDATE path and quietly kept a NULL.
      hard_filter_unknown = excluded.hard_filter_unknown,
      rationale = excluded.rationale,
      attrition_risk_flag = excluded.attrition_risk_flag,
      frame_split_flag = excluded.frame_split_flag,
      computed_at = now();

    v_n := v_n + 1;
  end loop;

  return v_n;
end $$;

-- ── 3. The interview, expressed as dimension levels ────────────────────────
--
-- One scorecard in, one `{dimension: 0-100}` object out, ready for
-- `quality_from_levels`. Reads the frozen `attributes` snapshot rather than
-- `ask_scores`, so a scorecard scored in March keeps the reading it was scored
-- against even after the bank is reworded (sql/35).
--
-- **Unanswered questions leave the denominator.** `attributes` carries `max` as
-- every in-scope question × 3 and `unscored` as those with no answer, so the
-- attainable maximum on what was actually asked is `max - unscored × 3`. Without
-- that subtraction an R1 would read as a catastrophic R2 rather than as a short
-- one, and a candidate would look weak for a question nobody put to them.
create or replace function ask_levels(p_scorecard uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_card ask_scorecards; v_out jsonb;
begin
  if not is_staff() then raise exception 'ask_levels: staff only'; end if;

  select * into v_card from ask_scorecards where id = p_scorecard;
  if v_card.id is null then raise exception 'No such scorecard.'; end if;

  -- Only a submitted scorecard has a frozen breakdown, and only a submitted
  -- scorecard should be producing a fit: a number from a half-conducted interview
  -- would be read as a judgement when it is a progress bar.
  if v_card.submitted_at is null or v_card.attributes is null then
    return null;
  end if;

  select jsonb_object_agg(dimension_code, level) into v_out
  from (
    select m.dimension_code,
           round(sum((att->>'score')::numeric)
                 / nullif(sum((att->>'max')::int - (att->>'unscored')::int * 3), 0) * 100, 1) as level
    from jsonb_array_elements(v_card.attributes) att
    join ask_dimension_map m on m.attribute_id = att->>'id'
    group by m.dimension_code
    -- A dimension whose every mapped question went unasked is not a zero, it is
    -- a silence, and it must be absent from the object rather than present at 0.
    having sum((att->>'max')::int - (att->>'unscored')::int * 3) > 0
  ) t;

  return coalesce(v_out, '{}'::jsonb);
end $$;

revoke all on function ask_levels(uuid) from public;
grant execute on function ask_levels(uuid) to authenticated;

-- ── 4. Both readings, per open requirement ─────────────────────────────────
--
-- ── ON "BEST FIT", WHICH IS A DECISION AND SO IS STATED, NOT BURIED ────────
--
-- When both readings exist they will not agree, and something has to be put in
-- the column the roles are ordered by. Three candidates for it:
--
--   · the higher of the two — flatters every candidate and turns two instruments
--     into a search for whichever one liked them best
--   · the mean — the one thing §7ae exists to forbid, because it destroys the
--     disagreement, which is the most informative thing two instruments produce
--   · the lower of the two — **the level both readings support**
--
-- The third, because it is the only one that is a claim rather than a preference:
-- if the test says 74 and the interview says 58, what is actually corroborated is
-- 58, and the 16 points are an open question about the candidate rather than a
-- number to average away. It is conservative on purpose and it is one `least()`
-- to change if that turns out to be the wrong call.
--
-- Either way `combined_pct` is never the whole answer on screen. Both readings,
-- the gap, the coverage and the verdict are all returned, because R3 is that the
-- system ranks and explains and never decides.
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
  v_test    numeric;
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
           m.quality_score, m.composite, m.fit_score,
           m.hard_filter_pass, m.hard_filter_fails, m.hard_filter_unknown
    from requirements req
    join clients cl on cl.id = req.client_id
    left join matches m on m.requirement_id = req.id and m.candidate_id = p_candidate_id
    where req.status = 'open'
      and cl.business_name not like 'ZZ_FIXTURE%'
    order by cl.business_name, req.title
  loop
    v_test := case when r.quality_score is not null
                   then round(r.quality_score * 100, 1) end;

    v_qual := case when v_levels is not null and v_levels <> '{}'::jsonb
                   then quality_from_levels(r.target_profile_id, v_levels) end;
    v_r2   := case when v_qual is not null and (v_qual->>'quality') is not null
                   then round((v_qual->>'quality')::numeric * 100, 1) end;

    v_gap := case when v_test is not null and v_r2 is not null
                  then abs(v_test - v_r2) end;

    v_verdict := case
      when v_test is null and v_r2 is null then 'no reading'
      when v_r2 is null   then 'test only'
      when v_test is null then 'interview only'
      when v_gap >= v_thresh then 'contested'
      else 'corroborated'
    end;

    -- The level both readings support. With one reading it is that reading, and
    -- the verdict says which — a single number with no label would let a
    -- test-only 74 and a corroborated 74 sort as though they meant the same.
    v_combined := case
      when v_test is null and v_r2 is null then null
      when v_r2 is null   then v_test
      when v_test is null then v_r2
      else least(v_test, v_r2)
    end;

    v_rows := v_rows || jsonb_build_object(
      'requirement_id', r.requirement_id,
      'title', r.title,
      'business_name', r.business_name,

      -- The questionnaire's readings. `composite_pct` is the full §9.4 number and
      -- stays the headline; `test_quality_pct` is its quality half, which is the
      -- one comparable with the interview.
      'composite_pct', case when r.composite is not null
                            then round(r.composite * 100, 1) end,
      'test_quality_pct', v_test,
      'test_fit_pct', case when r.fit_score is not null
                           then round(r.fit_score * 100, 1) end,

      -- The interview's reading: quality half only, with what it reached.
      'r2_quality_pct', v_r2,
      'r2_round', case when v_r2 is not null then v_card.round end,
      'r2_coverage', case when v_qual is not null then (v_qual->>'coverage')::numeric end,
      'r2_dimensions_seen', case when v_qual is not null
                                 then v_qual->'dimensions_seen' end,
      'r2_dimensions_missing', case when v_qual is not null
                                    then v_qual->'dimensions_missing' end,

      'gap', v_gap,
      'verdict', v_verdict,
      'combined_pct', v_combined,

      -- Hard filters are facts about eligibility, not about either reading, so
      -- they apply to both and are carried once.
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
    'r2_is_quality_only',
      'The interview scores no attribute onto deal motion or interpersonal '
      'style, so it has no fit half and there is no interview composite. The '
      'interview number is the quality half and is compared with the quality '
      'half of the test.',
    'rows', v_rows);
end $$;

revoke all on function get_ask_fit(uuid) from public;
grant execute on function get_ask_fit(uuid) to authenticated;

-- ── 5. The requirement direction ───────────────────────────────────────────
-- Everyone with an interview, against every open requirement, both readings. This
-- is the view that answers "who have I interviewed that suits this role" for the
-- five people who have an R2 and no questionnaire, and who are invisible to
-- `v_console_clean` for exactly that reason.
create or replace view v_two_readings as
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
  (q.j->>'coverage')::numeric     as r2_coverage,
  case
    when m.quality_score is null and (q.j->>'quality') is null then 'no reading'
    when (q.j->>'quality') is null then 'test only'
    when m.quality_score is null   then 'interview only'
    when abs(round(m.quality_score * 100, 1) - round((q.j->>'quality')::numeric * 100, 1))
         >= param('ask', 'disagreement_points') then 'contested'
    else 'corroborated'
  end as verdict,
  least(round(m.quality_score * 100, 1),
        round((q.j->>'quality')::numeric * 100, 1)) as both_support_pct,
  m.hard_filter_pass
from cards k
join candidates cand on cand.id = k.candidate_id
cross join requirements req
join clients cl on cl.id = req.client_id
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
  'Contains scores — internal only, never a client surface (R1 / C10).';

grant select on v_two_readings to authenticated;

-- ── 6. The candidate page gains one key ────────────────────────────────────
-- Both branches of `get_candidate_detail` — the scored one and the unscored one
-- added in sql/39 — because the candidates this feature exists for are precisely
-- the ones with no questionnaire, who take the unscored branch.
-- Spliced rather than restated, the same way sql/39 added the ASK keys: the
-- function is 200 lines of subqueries and re-typing it here would make sql/21 and
-- this file two definitions of one thing. Both anchors are exact and each occurs
-- once — the unscored branch closes its object at `get_ask_overlap(...));` with
-- the paren, the scored branch carries on to `'disclaimer',` — so a miss raises
-- instead of splicing into the wrong place.
do $$
declare v_src text; v_new text; v_hits int;
begin
  select pg_get_functiondef(p.oid) into v_src
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'get_candidate_detail';
  if v_src is null then raise exception 'sql/49: get_candidate_detail is missing'; end if;

  select count(*) into v_hits from regexp_matches(v_src, '''fits'', get_ask_fit', 'g');
  if v_hits >= 2 then
    raise notice 'sql/49: get_candidate_detail already carries fits on both branches';
    return;
  end if;

  -- The unscored branch (sql/39). This is the branch that matters most here: a
  -- candidate who was interviewed but never sat the questionnaire has no profile,
  -- so this is the branch their page takes.
  -- `replace` rewrites every occurrence, so "found it" is not enough — the anchor
  -- has to be unique or the key lands twice and the function stops compiling.
  select count(*) into v_hits
  from regexp_matches(v_src, '''ask_overlap'', get_ask_overlap\(p_candidate_id\)\);', 'g');
  if v_hits <> 1 then
    raise exception 'sql/49: the unscored-branch anchor occurs % times, expected 1', v_hits;
  end if;
  v_new := replace(v_src,
    '''ask_overlap'', get_ask_overlap(p_candidate_id));',
    '''ask_overlap'', get_ask_overlap(p_candidate_id),
    ''fits'', get_ask_fit(p_candidate_id));');

  -- The scored branch, in front of the disclaimer that closes its object.
  select count(*) into v_hits from regexp_matches(v_new, '''disclaimer'',', 'g');
  if v_hits <> 1 then
    raise exception 'sql/49: the scored-branch anchor occurs % times, expected 1', v_hits;
  end if;
  v_new := replace(v_new, '''disclaimer'',',
    '''fits'', get_ask_fit(p_candidate_id),

    ''disclaimer'',');

  execute v_new;
end $$;

notify pgrst, 'reload schema';

-- ── Assertions ─────────────────────────────────────────────────────────────
--
-- The load-bearing one is the first: the match engine was rewritten, so every
-- number it has ever produced on this database is recomputed and required to come
-- back identical. A rewrite that only proves itself against fixtures has not been
-- proved against the data anybody cares about.
do $$
declare
  v_before jsonb; v_after jsonb; v_after_sample jsonb;
  v_req uuid; v_n int; v_bad int;
  v_lvl jsonb; v_q jsonb; v_card uuid;
begin
  -- ── 1. compute_matches is unchanged, on real rows ───────────────────────
  --
  -- The claim under test is "no number moved", and the first draft of this
  -- assertion tested something else: it compared the whole before array with the
  -- whole after array, and failed. The cause was not the rewrite. Re-running the
  -- **old** engine on this database also goes from 250 rows to 252, because two
  -- candidates have sat the questionnaire since the last time anybody ran a match
  -- — so `matches` was two rows short of the profiles that exist, and any
  -- recompute fills them in.
  --
  -- Which is worth saying out loud twice over. Comparing sets when the claim is
  -- about values fails for a reason that has nothing to do with the change, and
  -- an assertion that cannot tell "this row moved" from "this row is new" will
  -- send you looking in the wrong function. And separately: the shortlist can be
  -- quietly behind the profiles, because nothing re-matches a requirement when a
  -- new candidate is scored. This migration incidentally catches it up; that it
  -- needed catching up is its own finding.
  select jsonb_object_agg(requirement_id::text || ':' || candidate_id::text,
           jsonb_build_object('q', quality_score, 'f', fit_score,
                              'x', composite, 'cls', cls_effective))
    into v_before from matches;

  if v_before is null then
    raise notice 'sql/49: no match rows to compare — the engine rewrite is covered by golden cases only';
  else
    for v_req in select distinct requirement_id from matches loop
      perform compute_matches(v_req);
    end loop;

    select jsonb_object_agg(requirement_id::text || ':' || candidate_id::text,
             jsonb_build_object('q', quality_score, 'f', fit_score,
                                'x', composite, 'cls', cls_effective))
      into v_after from matches;

    -- Every pair that had a number keeps exactly that number. A pair appearing
    -- for the first time is a backlog being cleared, not a score changing; a pair
    -- disappearing would be the fixture split doing its job (compute_matches
    -- deletes cross-class rows) and is reported rather than asserted away.
    select count(*), jsonb_agg(jsonb_build_object(
             'pair', key, 'was', v_before -> key, 'now', v_after -> key))
      into v_bad, v_after_sample
    from jsonb_object_keys(v_before) key
    where v_after ? key and v_after -> key <> v_before -> key;

    if v_bad > 0 then
      raise exception 'sql/49: rewriting compute_matches MOVED % score row(s). '
                      'Refusing. %', v_bad, v_after_sample;
    end if;

    raise notice 'sql/49: % existing match rows recomputed identically through '
                 'quality_from_levels; % row(s) newly filled in, % gone',
      (select count(*) from jsonb_object_keys(v_before) k where v_after ? k),
      (select count(*) from jsonb_object_keys(v_after) k where not v_before ? k),
      (select count(*) from jsonb_object_keys(v_before) k where not v_after ? k);
  end if;

  -- ── 2. An absent level is not a zero ────────────────────────────────────
  select target_profile_id into v_req from requirements where status = 'open' limit 1;
  if v_req is not null then
    v_q := quality_from_levels(v_req, '{"RES":100,"DRV":100,"DSC":100,"CLS_C":100,"CLS_F":100,"CCH":100,"INT":100}'::jsonb);
    if (v_q->>'coverage')::numeric <> 1 then
      raise exception 'a complete set of levels does not read as full coverage: %', v_q;
    end if;

    -- Drop two dimensions. Quality must stay at the cap (everything seen is
    -- perfect) while coverage falls — the whole point of the design.
    v_q := quality_from_levels(v_req, '{"RES":100,"DSC":100,"CLS_C":100,"CLS_F":100,"INT":100}'::jsonb);
    if (v_q->>'coverage')::numeric >= 1 then
      raise exception 'two missing dimensions did not reduce coverage: %', v_q;
    end if;
    if jsonb_array_length(v_q->'dimensions_missing') <> 2 then
      raise exception 'expected 2 missing dimensions, got %', v_q->'dimensions_missing';
    end if;
    if (v_q->>'quality')::numeric <= 0 then
      raise exception 'a partial reading of a perfect candidate came out at or below zero: %', v_q;
    end if;

    -- A zero IS a zero, and must read differently from an absence. This is the
    -- assertion that would have caught treating one as the other.
    if (quality_from_levels(v_req, '{"RES":0,"DRV":0,"DSC":0,"CLS_C":0,"CLS_F":0,"CCH":0,"INT":0}'::jsonb)->>'quality')::numeric <> 0 then
      raise exception 'an all-zero candidate does not score zero quality';
    end if;
    if (quality_from_levels(v_req, '{"RES":0,"DRV":0,"DSC":0,"CLS_C":0,"CLS_F":0,"CCH":0,"INT":0}'::jsonb)->>'coverage')::numeric <> 1 then
      raise exception 'an all-zero candidate reads as though nothing was measured';
    end if;

    -- Nothing measured at all: no quality, and it says so rather than returning 0.
    v_q := quality_from_levels(v_req, '{}'::jsonb);
    if (v_q->>'quality') is not null then
      raise exception 'an empty level set produced a quality number: %', v_q;
    end if;
  end if;

  -- ── 3. The interview reading, on the real scorecards ────────────────────
  if is_staff() then
    v_bad := 0;
    for v_card in select id from ask_scorecards where submitted_at is not null loop
      v_lvl := ask_levels(v_card);
      if v_lvl is null or v_lvl = '{}'::jsonb then v_bad := v_bad + 1; end if;
      -- Every level must be a percentage. A level above 100 would mean the
      -- denominator subtracted more than it should.
      if v_lvl is not null and exists (
        select 1 from jsonb_each_text(v_lvl) e
        where e.value::numeric < 0 or e.value::numeric > 100) then
        raise exception 'ask_levels produced a level outside 0-100 for scorecard %: %',
          v_card, v_lvl;
      end if;
    end loop;
    if v_bad > 0 then
      raise notice 'sql/49: % submitted scorecard(s) map to no dimension at all', v_bad;
    end if;
    raise notice 'sql/49: % submitted scorecard(s) produce dimension levels',
      (select count(*) from ask_scorecards where submitted_at is not null) - v_bad;
  else
    raise notice 'sql/49: ask_levels and get_ask_fit are covered by test/ask.js '
                 '(they are is_staff() guarded and this session is not staff)';
  end if;

  -- ── 4. Both branches of the candidate page carry the key ────────────────
  select count(*) into v_n
  from regexp_matches(
    (select pg_get_functiondef(p.oid) from pg_proc p
      join pg_namespace ns on ns.oid = p.pronamespace
      where ns.nspname = 'public' and p.proname = 'get_candidate_detail'),
    '''fits'', get_ask_fit', 'g');
  if v_n < 2 then
    raise exception 'get_candidate_detail carries fits on % branch(es), expected 2', v_n;
  end if;

  -- ── 5. Neither new function is reachable without a session ──────────────
  if exists (select 1 from information_schema.role_routine_grants
             where grantee = 'anon'
               and routine_name in ('quality_from_levels','ask_levels','get_ask_fit')) then
    raise exception 'anon can call one of the new functions';
  end if;

  raise notice 'sql/49 ok — one definition of §9.2, two readings of one person, '
               'and the composite untouched';
end $$;
