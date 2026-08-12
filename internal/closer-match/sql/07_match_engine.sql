-- ═══════════════════════════════════════════════════════════════════════════
-- Match engine — PRD v3.0 §9
--
--   §9.1  Hard filters, binary, first. Fail = excluded WITH THE FILTER NAMED.
--   §9.2  Q = Σ[w_d × min(cand_d / req_d, 1.15)] / Σw_d
--   §9.2.1 CLS_effective = w_C × CLS_C + w_F × CLS_F   (per requirement)
--   §9.3  F = 1 − (Σ[w_d × |cand_d − target_d| / 100] / Σw_d)
--   §9.4  Match = (0.6 × Q + 0.4 × F) × confidence_multiplier
--   §9.5  Console output: top 3 reasons, top 2 concerns, frame-split note,
--         cross-client line — TEMPLATES, never generated text.
--
-- There is no rejection path in this file. A candidate who fails a hard filter
-- still gets a row, with the failing filters named, so a recruiter can override
-- a near-miss like a two-week notice gap (§2, §9.1, C9).
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══ RATIONALE TEMPLATES (§9.5) ════════════════════════════════════════════
-- "Templates, not generated text: identical phrasing every time, auditable, no
-- model dependency, no drift." The operational consequence is the point — a
-- concern that only says "DSC is low" tells a recruiter nothing.

create table if not exists dimension_templates (
  dimension_code text primary key references dimensions(code),
  strength_text  text not null,
  concern_text   text not null
);

insert into dimension_templates (dimension_code, strength_text, concern_text) values
('RES','holds effort and tone through a run of losses',
      'activity is likely to drop during a bad week, so a cold-outbound-heavy desk will stall'),
('DRV','sets a personal number above the assigned target',
      'will deliver the target and stop there — expect no upside above quota'),
('DSC','builds and maintains a pipeline system without being told to',
      'follow-ups will be missed and revived leads will be lost, especially with no CRM in place'),
('CLS_C','asks for the money and holds price with senior buyers',
      'likely to accept a deferral on a considered sale rather than resolve it on the call'),
('CLS_F','closes inside a single short inbound call',
      'will push a fast inbound lead into a callback that never converts'),
('CCH','changes behaviour after correction, including correction they disagree with',
      'coaching will not stick, so ramp will depend on what they already know'),
('INT','declines a bad-fit close and states a refund policy honestly',
      'raises mis-selling and refund exposure on a high-ticket offer'),
('MOT','deal motion matches this role''s ticket band and cycle length',
      'deal motion is pulled toward a different ticket band than this role runs'),
('STY','interpersonal style matches how this client''s buyer responds',
      'interpersonal style is a poor read for how this client''s buyer responds')
on conflict (dimension_code) do update set
  strength_text = excluded.strength_text,
  concern_text  = excluded.concern_text;

-- ═══ §9.1 HARD FILTERS ═════════════════════════════════════════════════════
-- Returns the list of FAILING filter names — empty array means pass. Naming the
-- failure is the whole point: a silent exclusion cannot be overridden.

create or replace function fluency_rank(p text) returns int
language sql immutable as $$
  select case lower(coalesce(p,''))
    when 'native' then 4 when 'fluent' then 3
    when 'conversational' then 2 when 'basic' then 1 else 0 end;
$$;

create or replace function hard_filter_fails(p_candidate jsonb, p_filters jsonb)
returns text[] language plpgsql stable as $$
declare
  fails text[] := '{}';
  lang  jsonb;
begin
  if p_filters is null or p_filters = '{}'::jsonb then
    return fails;
  end if;

  -- Language + fluency floor
  if p_filters ? 'languages_required' then
    for lang in select jsonb_array_elements(p_filters->'languages_required') loop
      if fluency_rank(p_candidate->'languages'->>(lang->>'lang'))
         < fluency_rank(lang->>'min') then
        fails := array_append(fails, format('language: %s below %s',
                 lang->>'lang', lang->>'min'));
      end if;
    end loop;
  end if;

  -- Location
  if p_filters ? 'locations'
     and not (p_candidate->>'location' = any(
       array(select jsonb_array_elements_text(p_filters->'locations')))) then
    fails := array_append(fails, format('location: %s not in the client''s list',
             coalesce(p_candidate->>'location','unstated')));
  end if;

  -- Work mode
  if p_filters ? 'work_mode'
     and not ((p_filters->>'work_mode') = any(
       array(select jsonb_array_elements_text(p_candidate->'work_mode')))) then
    fails := array_append(fails, format('work mode: cannot do %s', p_filters->>'work_mode'));
  end if;

  -- Salary band overlap
  if p_filters ? 'salary_max'
     and (p_candidate->>'salary_expectation')::numeric > (p_filters->>'salary_max')::numeric then
    fails := array_append(fails, format('salary: expects %s, band tops out at %s',
             p_candidate->>'salary_expectation', p_filters->>'salary_max'));
  end if;
  if p_filters ? 'salary_min'
     and (p_candidate->>'salary_expectation')::numeric < (p_filters->>'salary_min')::numeric then
    fails := array_append(fails, format('salary: expects %s, below the band floor %s',
             p_candidate->>'salary_expectation', p_filters->>'salary_min'));
  end if;

  -- Notice period vs join date — the classic overridable near-miss
  if p_filters ? 'join_by_days'
     and (p_candidate->>'notice_days')::numeric > (p_filters->>'join_by_days')::numeric then
    fails := array_append(fails, format('notice: %s days against a %s-day join window',
             p_candidate->>'notice_days', p_filters->>'join_by_days'));
  end if;

  -- Mandatory experience floor
  if p_filters ? 'min_years_experience'
     and (p_candidate->>'years_experience')::numeric < (p_filters->>'min_years_experience')::numeric then
    fails := array_append(fails, format('experience: %s years against a %s-year floor',
             coalesce(p_candidate->>'years_experience','0'), p_filters->>'min_years_experience'));
  end if;

  return fails;
end $$;

-- ═══ THE MATCH FUNCTION ════════════════════════════════════════════════════

create or replace function compute_matches(p_requirement_id uuid)
returns int language plpgsql as $$
declare
  v_req        requirements;
  v_tp         client_target_profile;
  v_client_comp numeric;
  v_conf_mult  numeric;
  v_cap        numeric := param('quality','over_requirement_cap');
  v_wq         numeric := param('composite','w_quality');
  v_wf         numeric := param('composite','w_fit');
  v_split      numeric := param('flags','frame_split_delta');
  v_gap        numeric := param('fit','attrition_band_gap');
  c            record;
  v_cls_eff    numeric;
  v_q_num numeric; v_q_den numeric;
  v_f_num numeric; v_f_den numeric;
  v_q numeric; v_f numeric;
  v_dim text; v_w numeric; v_req_lvl numeric; v_cand numeric;
  v_reasons jsonb; v_concerns jsonb;
  v_fails text[];
  v_unknown text[];   -- checks that could not be run at all — see sql/29
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

  -- A fixture requirement ranks fixture candidates and nothing else.
  --
  -- This was found by golden case 1a failing after a real candidate had their
  -- eligibility facts recorded: they then passed the fixture requirement's hard
  -- filters and displaced the frame-split fixture from rank 3 to rank 4. The
  -- assertion was correct and the fixture was correct — the two worlds were
  -- simply not separated in this direction. `v_console_clean` already keeps
  -- fixtures out of real shortlists; nothing kept real people out of fixture
  -- ones, so **live data could break the regression suite by being entered.**
  -- A test that the product's normal use can turn red is not a test.
  select cl.business_name like 'ZZ_FIXTURE%' into v_is_fixture
  from clients cl where cl.id = v_req.client_id;

  -- An upsert never removes. Narrowing who is ranked leaves everyone previously
  -- ranked still sitting there, so the rows have to be cleared explicitly —
  -- otherwise the fix looks applied and the old rows keep deciding the answer.
  delete from matches m
  using candidates cand
  where m.requirement_id = p_requirement_id
    and cand.id = m.candidate_id
    and (cand.full_name like 'ZZ_FIXTURE%') <> v_is_fixture;

  -- Latest profile per candidate.
  for c in
    select distinct on (p.candidate_id)
           p.candidate_id, p.scores, p.flags, cand.direct_fields
    from candidate_profile p
    join candidates cand on cand.id = p.candidate_id
    where (cand.full_name like 'ZZ_FIXTURE%') = v_is_fixture
    order by p.candidate_id, p.computed_at desc
  loop
    -- ── §9.2.1 CLS_effective — where the ticket band and cycle enter ────────
    v_cls_eff := (v_tp.cls_blend->>'w_C')::numeric * (c.scores->>'CLS_C')::numeric
               + (v_tp.cls_blend->>'w_F')::numeric * (c.scores->>'CLS_F')::numeric;

    -- ── §9.2 Quality ───────────────────────────────────────────────────────
    v_q_num := 0; v_q_den := 0;
    v_reasons := '[]'::jsonb; v_concerns := '[]'::jsonb;

    foreach v_dim in array array['RES','DRV','DSC','CLS','CCH','INT'] loop
      v_w       := (v_tp.dimension_weights->>v_dim)::numeric;
      v_req_lvl := (v_tp.required_levels->>v_dim)::numeric;
      v_cand    := case when v_dim = 'CLS' then v_cls_eff
                        else (c.scores->>v_dim)::numeric end;

      v_q_num := v_q_num + v_w * least(v_cand / nullif(v_req_lvl, 0), v_cap);
      v_q_den := v_q_den + v_w;

      -- Reason and concern candidates, scored by weighted distance from the
      -- requirement so a top-3 dimension outranks an unranked one.
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

    v_q := v_q_num / nullif(v_q_den, 0);

    -- ── §9.3 Fit — bipolar, distance from target in BOTH directions ─────────
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

    -- ── §9.1 Hard filters ──────────────────────────────────────────────────
    -- Three outcomes, not two. A check with no candidate data to read has not
    -- passed and has not failed; it is unknown, and it says so. See sql/29.
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
      -- took the UPDATE path and quietly kept a NULL. An upsert has two halves
      -- and only one of them is obvious.
      hard_filter_unknown = excluded.hard_filter_unknown,
      rationale = excluded.rationale,
      attrition_risk_flag = excluded.attrition_risk_flag,
      frame_split_flag = excluded.frame_split_flag,
      computed_at = now();

    v_n := v_n + 1;
  end loop;

  return v_n;
end $$;

-- ═══ §9.5 CONSOLE ══════════════════════════════════════════════════════════
-- Everything a recruiter sees for one requirement, phrased from templates.

create or replace view v_console as
with ranked as (
  select m.*,
         r.title as requirement_title, r.ticket_size, r.cycle_days, r.status,
         cl.business_name,
         cand.full_name,
         p.scores, p.flags,
         -- candidate_id is a deterministic tiebreak: without it, equal composites
         -- reshuffle between refreshes and the same shortlist reads differently
         -- every time a recruiter reloads it.
         row_number() over (partition by m.requirement_id
                      order by m.hard_filter_pass desc, m.composite desc, m.candidate_id) as engine_rank
  from matches m
  join requirements r on r.id = m.requirement_id
  join clients cl     on cl.id = r.client_id
  join candidates cand on cand.id = m.candidate_id
  join lateral (
    select scores, flags from candidate_profile
    where candidate_id = m.candidate_id order by computed_at desc limit 1
  ) p on true
),
-- The cross-client line is the entire payoff of a shared dimension space;
-- nothing single-client can produce it. Computed live, never frozen.
best_elsewhere as (
  select m.candidate_id, m.requirement_id,
         o.requirement_id as other_req, o.composite as other_composite,
         orq.title as other_title
  from matches m
  join matches o on o.candidate_id = m.candidate_id and o.requirement_id <> m.requirement_id
  join requirements orq on orq.id = o.requirement_id
  where o.hard_filter_pass and orq.status = 'open'
    and o.composite > m.composite + 0.05
)
select
  r.requirement_id,
  r.requirement_title,
  r.business_name,
  r.candidate_id,
  r.full_name,
  r.engine_rank,
  round(r.composite * 100, 1)      as composite_pct,
  round(r.quality_score * 100, 1)  as quality_pct,
  round(r.fit_score * 100, 1)      as fit_pct,
  r.cls_effective,
  r.rationale->>'confidence'       as confidence,
  r.rationale->>'benchmark_source' as benchmark_source,
  r.hard_filter_pass,
  r.hard_filter_fails,
  r.flags,
  r.attrition_risk_flag,
  r.frame_split_flag,

  -- Top 3 reasons
  (select array_agg(format('%s %s against a required %s — %s',
            d.name, x->>'score', x->>'required', t.strength_text)
            order by (x->>'rank_score')::numeric desc)
     from jsonb_array_elements(r.rationale->'reasons') x
     join dimensions d on d.code = x->>'dimension'
     join dimension_templates t on t.dimension_code = x->>'dimension'
     where (x->>'rank_score')::numeric in (
       select (y->>'rank_score')::numeric
       from jsonb_array_elements(r.rationale->'reasons') y
       order by (y->>'rank_score')::numeric desc limit 3)
  ) as top_reasons,

  -- Top 2 concerns, with the operational consequence spelled out
  (select array_agg(format('%s %s against a required %s — %s',
            d.name, x->>'score', x->>'required', t.concern_text)
            order by (x->>'rank_score')::numeric desc)
     from jsonb_array_elements(r.rationale->'concerns') x
     join dimensions d on d.code = x->>'dimension'
     join dimension_templates t on t.dimension_code = x->>'dimension'
     where (x->>'rank_score')::numeric in (
       select (y->>'rank_score')::numeric
       from jsonb_array_elements(r.rationale->'concerns') y
       order by (y->>'rank_score')::numeric desc limit 2)
  ) as top_concerns,

  -- Frame-split note (§9.5's worked example, from data)
  case when r.frame_split_flag then
    format('Frame-specific closer: %s on considered purchases (%s), %s on fast momentum (%s). '
           || 'This req is %s / %s, so effective CLS is %s against a required %s.',
      case when (r.scores->>'CLS_C')::numeric > (r.scores->>'CLS_F')::numeric then 'strong' else 'weak' end,
      r.scores->>'CLS_C',
      case when (r.scores->>'CLS_C')::numeric > (r.scores->>'CLS_F')::numeric then 'weak' else 'strong' end,
      r.scores->>'CLS_F',
      case when r.ticket_size >= 100000
           then '₹' || round(r.ticket_size/100000, 2) || 'L'
           else '₹' || round(r.ticket_size/1000) || 'k' end,
      case when r.cycle_days = 0 then 'same-day' else r.cycle_days || '-day' end,
      round(r.cls_effective),
      (select required_levels->>'CLS' from client_target_profile tp
        join requirements rq on rq.target_profile_id = tp.id
        where rq.id = r.requirement_id))
  end as frame_split_note,

  -- Cross-client line
  (select format('Scores higher on %s — composite %s there vs %s here.',
            b.other_title, round(b.other_composite * 100, 1), round(r.composite * 100, 1))
     from best_elsewhere b
     where b.candidate_id = r.candidate_id and b.requirement_id = r.requirement_id
     order by b.other_composite desc limit 1
  ) as cross_client_line,

  -- §9.4 requires this be visible wherever the number is.
  'Weights are expert-set, not learned from outcomes.' as weights_disclaimer,

  -- Appended rather than placed beside hard_filter_fails where it belongs:
  -- CREATE OR REPLACE VIEW can only add columns at the end, and v_console has
  -- two dependent views that dropping it would take with it. See sql/29.
  r.hard_filter_unknown
from ranked r;

comment on view v_console is
  'PRD §9.5. Ranked shortlist per requirement with template-generated rationale. '
  'Contains scores — internal only, never exposed to a client surface (R1 / C10).';

-- ═══ §14.5 HUMAN-AGREEMENT TRACKING ════════════════════════════════════════
-- "Does anyone ever advance a low-ranked candidate? If the answer becomes
-- never, the score has become a gate in practice despite no gate in the code.
-- That is the failure R3 exists to prevent, and this query is how you detect it."

create or replace view v_human_agreement as
select
  count(*)                                                          as decisions_logged,
  round(avg(case when (engine_rank <= 5) = recruiter_advanced then 1 else 0 end) * 100, 1)
                                                                     as agreement_pct,
  count(*) filter (where recruiter_advanced and engine_rank > 5)     as low_ranked_advanced,
  count(*) filter (where not recruiter_advanced and engine_rank <= 5) as top_ranked_declined,
  case
    when count(*) < 20 then 'insufficient decisions logged'
    when count(*) filter (where recruiter_advanced and engine_rank > 5) = 0
      then 'WARNING: no low-ranked candidate has ever been advanced — the score '
        || 'has become a gate in practice despite no gate in the code (§14.5, R3)'
    when avg(case when (engine_rank <= 5) = recruiter_advanced then 1 else 0 end) > 0.95
      then 'agreement very high — either it works, or recruiters have stopped thinking'
    when avg(case when (engine_rank <= 5) = recruiter_advanced then 1 else 0 end) < 0.40
      then 'agreement very low — engine or weights likely wrong'
    else 'healthy'
  end                                                                as verdict
from recruiter_decisions;

-- ═══ §14.3 GROUP-DIFFERENCE MONITORING ═════════════════════════════════════
-- Reads monitoring_attributes. NEVER joined into the matching path — this view
-- is the only place the two ever meet, and it is read-only and aggregate.
-- "A 15-point gap on a dimension is not a fact about closers — it is a fact
-- about your items, and you rewrite them."

create or replace view v_group_differences as
with s as (
  select ma.gender, ma.age_band, ma.region, d.code as dimension_code,
         (p.scores->>d.code)::numeric as score
  from monitoring_attributes ma
  join candidate_profile p on p.candidate_id = ma.candidate_id
  cross join dimensions d
  where d.active and p.scores ? d.code
)
select 'gender' as attribute, coalesce(gender,'(not stated)') as grp,
       dimension_code, count(*) as n, round(avg(score),1) as mean_score
from s group by 1,2,3
union all
select 'age_band', coalesce(age_band,'(not stated)'), dimension_code, count(*), round(avg(score),1)
from s group by 1,2,3
union all
select 'region', coalesce(region,'(not stated)'), dimension_code, count(*), round(avg(score),1)
from s group by 1,2,3;

create or replace view v_group_gaps as
select attribute, dimension_code,
       max(mean_score) - min(mean_score) as gap,
       case when max(mean_score) - min(mean_score) >= 15
            then 'REWRITE THE ITEMS — 15-point gap (§14.3)' else 'ok' end as verdict
from v_group_differences
where n >= 10
group by attribute, dimension_code
having max(mean_score) - min(mean_score) >= 10
order by gap desc;
