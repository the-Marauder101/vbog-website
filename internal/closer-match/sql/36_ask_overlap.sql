-- ═══════════════════════════════════════════════════════════════════════════
-- 36 — where the two readings disagree
--
-- ASK and the questionnaire both measure Coachability, Closing and Discipline.
-- They measure them by completely different means: one from a candidate's own
-- answers to written scenarios, the other from a person probing for specifics
-- they cannot invent on the spot.
--
-- **That overlap is the point.** Two independent instruments pointed at the same
-- trait is the only thing in this system that can catch what neither can catch
-- alone. When they agree, the reading is worth trusting. When a candidate scores
-- 83 on Coachability in the questionnaire and 44 with a person in front of them,
-- one of three things happened — they read the test well, the interviewer was
-- weak, or the item bank is wrong about what Coachability looks like — and all
-- three are worth knowing.
--
-- This is exactly why §7x refused a second `final_keys` table and why sql/13
-- keeps the three predictors apart. Averaging two readings destroys the
-- disagreement, which is the most informative thing they produce.
--
-- ── THE THRESHOLD, AND WHY IT IS NOT DERIVED ───────────────────────────────
--
-- `zigzag` in sql/32 got its threshold from simulating 4,000 random answerers,
-- because there was a chance model to simulate. **There is no chance model here.**
-- Two instruments on different scales measured on different days by different
-- means have no null distribution I can honestly claim to know.
--
-- So the gap is ALWAYS shown, and the flag threshold is a stated guess living in
-- `dimension_params` where it can be tuned, labelled provisional everywhere it
-- appears. That is the same lesson as sql/32 arriving from the other side: the
-- fix for an underivable threshold is to say so, not to pick one that looks
-- derived. Once forty or fifty candidates carry both, the spread itself sets it.
-- ═══════════════════════════════════════════════════════════════════════════

insert into dimension_params (param_group, param_key, param_value, note) values
  ('ask', 'disagreement_points', 30,
   'PROVISIONAL. Gap in points between the ASK attribute and the questionnaire '
   'dimension before it is called out. Not derived from a null model — there '
   'is not one. Set from observed spread once ~40 candidates carry both.'),
  ('ask', 'min_overlap_n', 40,
   'How many candidates with both readings before the threshold above can be '
   'set from data rather than guessed.')
on conflict (param_group, param_key) do update set
  param_value = excluded.param_value, note = excluded.note;

-- ── Which ASK attribute reads the same trait as which dimension ────────────
-- Seeded with a proposal, and editable, because this is a judgement about what
-- the constructs mean rather than a fact about the code. Five ASK attributes map
-- to nothing — that is ASK earning its place rather than duplicating the test.
create table if not exists ask_dimension_map (
  attribute_id   text not null references ask_attributes(id) on delete cascade,
  dimension_code text not null references dimensions(code) on delete cascade,
  note           text,
  primary key (attribute_id, dimension_code)
);

alter table ask_dimension_map enable row level security;
alter table ask_dimension_map force row level security;
drop policy if exists staff_all on ask_dimension_map;
create policy staff_all on ask_dimension_map for all to authenticated
  using (is_staff()) with check (is_staff());
revoke all on ask_dimension_map from anon;

insert into ask_dimension_map (attribute_id, dimension_code, note) values
  ('closing',   'CLS_C', 'Asking for the money on a considered sale.'),
  ('closing',   'CLS_F', 'Asking for the money inside one short call.'),
  ('objection', 'CLS_C', 'Handling resistance is most of what closing a considered sale is.'),
  ('coach',     'CCH',   'Same construct, one self-reported and one probed.'),
  ('followup',  'DSC',   'Follow-up is the visible half of pipeline discipline.'),
  ('crm',       'DSC',   'The other half — whether the system gets maintained unprompted.'),
  ('target',    'DRV',   'Setting a number above the assigned one.'),
  ('dialing',   'DRV',   'Sustained activity against a target.'),
  ('pressure',  'RES',   'Holding tone and effort through a bad run.'),
  ('intent',    'INT',   'Whether they will decline a bad-fit close.')
on conflict (attribute_id, dimension_code) do update set note = excluded.note;

-- ── The comparison ─────────────────────────────────────────────────────────
-- ASK is a 0–3 sum per attribute; the questionnaire is 0–100 per dimension. Both
-- are put on a percentage so they can be read against each other — which is a
-- presentational convenience, NOT a claim that a point of one equals a point of
-- the other. The gap is a prompt to go and look, never an arithmetic result.
create or replace view v_ask_overlap as
select
  c.candidate_id,
  cand.full_name,
  c.id                                   as scorecard_id,
  c.round,
  m.attribute_id,
  a.name                                 as attribute,
  m.dimension_code,
  d.name                                 as dimension,
  (att->>'score')::int                   as ask_score,
  (att->>'max')::int                     as ask_max,
  round((att->>'score')::numeric / nullif((att->>'max')::int, 0) * 100, 0) as ask_pct,
  (p.scores->>m.dimension_code)::numeric as questionnaire,
  abs(round((att->>'score')::numeric / nullif((att->>'max')::int, 0) * 100, 0)
      - (p.scores->>m.dimension_code)::numeric)                            as gap,
  abs(round((att->>'score')::numeric / nullif((att->>'max')::int, 0) * 100, 0)
      - (p.scores->>m.dimension_code)::numeric)
    >= param('ask', 'disagreement_points')                                 as flagged,
  m.note
from ask_scorecards c
join candidates cand on cand.id = c.candidate_id
join lateral jsonb_array_elements(c.attributes) att on true
join ask_dimension_map m on m.attribute_id = att->>'id'
join ask_attributes a on a.id = m.attribute_id
join dimensions d on d.code = m.dimension_code
join lateral (select scores from candidate_profile
               where candidate_id = c.candidate_id
               order by computed_at desc limit 1) p on true
where c.submitted_at is not null
  and c.attributes is not null
  and p.scores ? m.dimension_code
  and (att->>'max')::int > 0;

grant select on v_ask_overlap to authenticated;

-- One candidate's disagreements, for the detail page. Widest gap first, because
-- that is the one to ask about.
create or replace function get_ask_overlap(p_candidate_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'get_ask_overlap: staff only'; end if;

  return jsonb_build_object(
    'threshold', param('ask', 'disagreement_points'),
    -- Said wherever the number is, not once in a footnote.
    'threshold_note',
      'Provisional. There is no chance model for two different instruments, so '
      'this line is a stated guess rather than a derived one. Every gap is shown '
      'regardless; only the call-out depends on the threshold.',
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'attribute', o.attribute, 'dimension', o.dimension,
        'dimension_code', o.dimension_code,
        'ask_pct', o.ask_pct, 'ask_score', o.ask_score, 'ask_max', o.ask_max,
        'questionnaire', o.questionnaire, 'gap', o.gap, 'flagged', o.flagged,
        'round', o.round, 'note', o.note)
      order by o.gap desc, o.attribute)
      from v_ask_overlap o
      where o.candidate_id = p_candidate_id
        -- The most recent submitted scorecard only. An older round is history,
        -- not a second opinion to average in.
        and o.scorecard_id = (
          select id from ask_scorecards
          where candidate_id = p_candidate_id and submitted_at is not null
          order by submitted_at desc limit 1)), '[]'::jsonb));
end $$;

grant execute on function get_ask_overlap(uuid) to authenticated;

-- ── How far off the threshold is from being knowable ───────────────────────
create or replace view v_ask_calibration as
select
  count(distinct candidate_id)                as candidates_with_both,
  param('ask', 'min_overlap_n')               as needed,
  round(avg(gap), 1)                          as mean_gap,
  round(percentile_cont(0.9) within group (order by gap)::numeric, 1) as p90_gap,
  param('ask', 'disagreement_points')         as current_threshold,
  count(distinct candidate_id) >= param('ask', 'min_overlap_n') as can_be_set_from_data
from v_ask_overlap;

grant select on v_ask_calibration to authenticated;

do $$
declare v int;
begin
  select count(*) into v from ask_dimension_map;
  if v <> 10 then raise exception 'expected 10 seeded overlap rows, found %', v; end if;

  -- Every mapped attribute and dimension must actually exist — a typo here would
  -- silently produce a comparison that never fires.
  select count(*) into v from ask_dimension_map m
  where not exists (select 1 from ask_attributes a where a.id = m.attribute_id)
     or not exists (select 1 from dimensions d where d.code = m.dimension_code);
  if v > 0 then raise exception '% overlap row(s) point at something that does not exist', v; end if;

  -- Five attributes deliberately map to nothing. If that becomes zero, somebody
  -- has mapped ASK onto the questionnaire wholesale, which would make it a
  -- second opinion about the same thing rather than an independent reading.
  select count(*) into v from ask_attributes a
  where a.active and not exists (select 1 from ask_dimension_map m where m.attribute_id = a.id);
  if v < 4 then
    raise exception 'only % ASK attribute(s) are unmapped — ASK is meant to reach '
                    'past what the questionnaire measures', v;
  end if;

  raise notice 'sql/36 ok — % attributes overlap the questionnaire, the rest are ASK''s own ground',
               (select count(distinct attribute_id) from ask_dimension_map);
end $$;
