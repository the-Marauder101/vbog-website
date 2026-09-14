-- ═══════════════════════════════════════════════════════════════════════════
-- 53 — the single point, on the surfaces that show fits
--
-- sql/52 built it. This puts it where it is read, and demotes what it replaces.
--
-- The row a recruiter now sees per role is:
--
--     FIT 81.4%          ← the one number: R1, R2 and the questionnaire, merged
--                          per dimension and run once through §9.4
--     test 78.2 · R2 92.6 · both readings agree · full
--                        ← the workings, kept underneath
--
-- `combined_pct` — sql/49's "lower of the two composites" — is gone. It answered
-- the same question worse: it compared two composites, one of which had had its
-- fit half removed, and took the smaller. The merge does not have to choose
-- between them because it never splits them in the first place.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function get_ask_fit(p_candidate_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_card    ask_scorecards;
  v_merged  jsonb;
  v_levels  jsonb;
  v_thresh  numeric := param('ask', 'disagreement_points');
  v_rows    jsonb := '[]'::jsonb;
  r         record;
  v_qual    jsonb;
  v_one     jsonb;
  v_r2      numeric;
  v_r2_comp numeric;
  v_test    numeric;
  v_test_comp numeric;
  v_gap     numeric;
  v_verdict text;
  v_best    numeric := null;
  v_best_title text;
begin
  if not is_staff() then raise exception 'get_ask_fit: staff only'; end if;

  -- Kept for the R2-only column and for the header: which rounds exist, what the
  -- headline ASK percentage was. The SINGLE POINT does not come from here — it
  -- comes from `one_fit`, which merges every submitted round with the
  -- questionnaire before it computes anything.
  select * into v_card from ask_scorecards
  where candidate_id = p_candidate_id and submitted_at is not null
  order by submitted_at desc limit 1;

  v_merged := ask_levels_merged(p_candidate_id);
  v_levels := (
    select coalesce(jsonb_object_agg(k, (v->>'level')::numeric), '{}'::jsonb)
    from jsonb_each(v_merged->'dimensions') e(k, v));

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

    -- The interview on its own, from every round merged rather than the latest
    -- scorecard alone — an R1 from a colleague is evidence, not a row to skip.
    v_qual := case when v_levels <> '{}'::jsonb
                   then quality_from_levels(r.target_profile_id, v_levels) end;
    v_r2   := case when v_qual is not null and (v_qual->>'quality') is not null
                   then round((v_qual->>'quality')::numeric * 100, 1) end;
    v_r2_comp := case when v_r2 is not null
                      then round((v_qual->>'quality')::numeric * r.conf_mult * 100, 1) end;

    -- THE SINGLE POINT.
    v_one := one_fit(r.target_profile_id, p_candidate_id);

    -- Agreement stays on quality-versus-quality: the same quantity measured two
    -- ways. It is now a note about the evidence rather than the ranking number,
    -- which is the right place for it — but it is still computed and still shown,
    -- because a single point that hides a 40-point disagreement is a worse
    -- number than two that admit one.
    v_gap := case when v_test is not null and v_r2 is not null
                  then abs(v_test - v_r2) end;
    v_verdict := case
      when v_test is null and v_r2 is null then 'no reading'
      when v_r2 is null   then 'test only'
      when v_test is null then 'interview only'
      when v_gap >= v_thresh then 'contested'
      else 'corroborated'
    end;

    if (v_one->>'pct') is not null
       and (v_best is null or (v_one->>'pct')::numeric > v_best) then
      v_best := (v_one->>'pct')::numeric;
      v_best_title := r.business_name || ' — ' || r.title;
    end if;

    v_rows := v_rows || jsonb_build_object(
      'requirement_id', r.requirement_id,
      'title', r.title,
      'business_name', r.business_name,

      -- The one number, and how much of it rests on an assumption.
      'one_pct',   (v_one->>'pct')::numeric,
      'one_basis', v_one->>'basis',
      'one_basis_note', v_one->>'basis_note',
      'one_quality_pct', (v_one->>'quality_pct')::numeric,
      'one_fit_pct',     (v_one->>'fit_pct')::numeric,
      'one_sources',     v_one->'sources',
      'levels',          v_one->'levels',

      -- The workings.
      'composite_pct', v_test_comp,
      'test_quality_pct', v_test,
      'test_fit_pct', case when r.fit_score is not null
                           then round(r.fit_score * 100, 1) end,
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

      'hard_filter_pass', r.hard_filter_pass,
      'hard_filter_fails', r.hard_filter_fails,
      'hard_filter_unknown', r.hard_filter_unknown);
  end loop;

  return jsonb_build_object(
    'scorecard_id', v_card.id,
    'round', v_card.round,
    'conducted_on', v_card.conducted_on,
    'ask_pct', v_card.pct,
    -- What the interview half is actually built from, across every round.
    'rounds_merged', v_merged->'rounds',
    'questions_scored', v_merged->'questions_scored',
    -- The candidate's own single number: their best role.
    'best_pct', v_best,
    'best_role', v_best_title,
    'threshold', v_thresh,
    'threshold_note',
      'Provisional, as in sql/36. There is no null model for two instruments on '
      'different evidence, so the line between "corroborated" and "contested" is '
      'a stated guess. Every gap is shown regardless.',
    'one_point_note',
      'One number per role. R1 and R2 are the same bank at different lengths, so '
      'every submitted round is merged into one answer set; that meets the '
      'questionnaire dimension by dimension, weighted by how many items each put '
      'behind it; and the result runs through the ordinary match once. Where the '
      'questionnaire is missing, deal motion and interpersonal style are unknown '
      'and the quality weight is stretched — which the basis on each row says.',
    'rows', v_rows);
end $$;

revoke all on function get_ask_fit(uuid) from public;
grant execute on function get_ask_fit(uuid) to authenticated;

-- The requirement direction, carrying the same single point.
drop view if exists v_two_readings;
create view v_two_readings as
with people as (
  select distinct c.candidate_id
  from ask_scorecards c
  where c.submitted_at is not null and c.attributes is not null
),
latest as (
  select distinct on (s.candidate_id) s.candidate_id, s.round, s.pct, s.conducted_on
  from ask_scorecards s
  where s.submitted_at is not null
  order by s.candidate_id, s.submitted_at desc
)
select
  req.id                as requirement_id,
  req.title             as requirement_title,
  cl.business_name,
  cand.id               as candidate_id,
  cand.full_name,
  (o.j->>'pct')::numeric          as one_pct,
  o.j->>'basis'                   as one_basis,
  l.round               as r2_round,
  l.conducted_on,
  l.pct                 as ask_pct,
  round(m.quality_score * 100, 1) as test_quality_pct,
  round(m.composite * 100, 1)     as composite_pct,
  (o.j->>'quality_pct')::numeric  as one_quality_pct,
  (o.j->>'fit_pct')::numeric      as one_fit_pct,
  m.hard_filter_pass
from people k
join candidates cand on cand.id = k.candidate_id
join latest l on l.candidate_id = k.candidate_id
cross join requirements req
join clients cl on cl.id = req.client_id
left join matches m on m.requirement_id = req.id and m.candidate_id = k.candidate_id
left join lateral (select one_fit(req.target_profile_id, k.candidate_id) as j) o on true
where req.status = 'open'
  and cl.business_name not like 'ZZ_FIXTURE%'
  and cand.full_name not like 'ZZ_FIXTURE%';

comment on view v_two_readings is
  'Every interviewed candidate against every open requirement, with the single '
  'point (R1 + R2 + questionnaire, merged per dimension and run once through '
  '§9.4) and the readings it was built from. `one_basis` says whether the fit '
  'half was measured or stretched — see sql/52. '
  'Contains scores — internal only, never a client surface (R1 / C10).';

grant select on v_two_readings to authenticated;

notify pgrst, 'reload schema';

do $$
declare v_n int;
begin
  if not exists (select 1 from information_schema.columns
                 where table_name = 'v_two_readings' and column_name = 'one_pct') then
    raise exception 'v_two_readings does not carry the single point';
  end if;

  -- sql/49's combined_pct answered the same question worse and must be gone, not
  -- sitting beside its replacement where somebody could read either.
  select count(*) into v_n from regexp_matches(
    (select pg_get_functiondef(p.oid) from pg_proc p
      join pg_namespace ns on ns.oid = p.pronamespace
      where ns.nspname = 'public' and p.proname = 'get_ask_fit'),
    'combined_pct', 'g');
  if v_n > 0 then
    raise exception 'sql/53: get_ask_fit still returns combined_pct alongside one_pct';
  end if;

  raise notice 'sql/53 ok — one number per role, and the candidate''s best role with it';
end $$;
