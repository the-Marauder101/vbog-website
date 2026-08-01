-- ═══════════════════════════════════════════════════════════════════════════
-- Candidate scoring — PRD v3.0 §7.2
--
--   Unipolar (RES DRV DSC CLS_C CLS_F CCH INT):
--     raw   = Σ item_keys                            -- −4 … +8
--     score = round((raw + 4) / 12 × 100)
--     score = clamp(score + BF_adjustment, 0, 100)   -- RES, DRV, DSC only
--
--   Bipolar (MOT STY):
--     score = (count of 100-pole picks / 5) × 100    -- 0,20,40,60,80,100
--
-- A SQL function over candidate_responses joined to item_options. Recomputable
-- at any time — which is why raw responses are stored, not just scores.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Banded-parameter lookup (convention documented in 02) ──────────────────
create or replace function param_band(p_group text, p_input numeric)
returns numeric language sql stable as $$
  select param_value
  from dimension_params
  where param_group = p_group
    and param_key::numeric <= p_input
  order by param_key::numeric desc
  limit 1;
$$;

-- ── Scalar-parameter lookup ────────────────────────────────────────────────
create or replace function param(p_group text, p_key text)
returns numeric language sql stable as $$
  select param_value from dimension_params
  where param_group = p_group and param_key = p_key;
$$;

-- ═══ THE SCORING FUNCTION ══════════════════════════════════════════════════
-- Computes nine scores and the four flags for one session, and upserts
-- candidate_profile. Returns the profile row.

create or replace function compute_candidate_profile(p_session_id uuid)
returns candidate_profile
language plpgsql as $$
declare
  v_candidate   uuid;
  v_bank        text;
  v_scores      jsonb := '{}'::jsonb;
  v_flags       text[] := '{}';
  v_dim         record;
  v_raw         numeric;
  v_n_items     int;
  v_score       numeric;
  v_bf          numeric;
  v_pole100     int;
  v_fc_items    int;
  v_sd_true     int;
  v_seconds     numeric;
  v_median      numeric;
  v_run         int;
  v_mot         numeric;
  v_sty         numeric;
  v_profile     candidate_profile;
begin
  select candidate_id, bank_version into v_candidate, v_bank
  from assessment_sessions where id = p_session_id;

  if v_candidate is null then
    raise exception 'compute_candidate_profile: no such session %', p_session_id;
  end if;

  -- REFUSE TO COMPUTE NOTHING. Without this the function happily sums zero
  -- responses, produces {}, and writes that over whatever profile was there.
  --
  -- Found the hard way: apply_rekey() recomputes every completed session, and
  -- the golden-case fixtures are seeded by writing candidate_profile.scores
  -- DIRECTLY — they have no responses at all, because their purpose is to pin
  -- known score vectors against known requirements. One re-key erased twelve of
  -- them and took run_golden_cases() from 19/19 to 16/19.
  --
  -- The narrow fix was to stop apply_rekey() touching fixtures. This is the real
  -- one: any future recompute pointed at a session whose responses have gone
  -- would silently destroy that candidate's scores and leave a valid-looking row.
  -- An empty result is not a result. Recomputing something that cannot be
  -- computed is not a no-op, it is deletion.
  if not exists (select 1 from candidate_responses where session_id = p_session_id) then
    raise exception 'compute_candidate_profile: session % has no responses. '
                    'Refusing to overwrite a profile with an empty one.', p_session_id;
  end if;

  -- ── UNIPOLAR ─────────────────────────────────────────────────────────────
  for v_dim in
    select code from dimensions
    where kind = 'unipolar' and active order by code
  loop
    -- SJT items only. The BF item attached to the same dimension is an
    -- adjustment, not part of the raw sum.
    select coalesce(sum(o.score_key), 0), count(*)
      into v_raw, v_n_items
    from candidate_responses r
    join items i        on i.id = r.item_id
    join item_options o on o.item_id = r.item_id and o.option_key = r.option_key
    where r.session_id = p_session_id
      and i.dimension_code = v_dim.code
      and i.format = 'sjt';

    if v_n_items = 0 then
      continue;   -- dimension not served this session
    end if;

    -- (raw + 4) / 12 × 100 assumes the 4-item scale. Rotation draws per
    -- dimension precisely so this denominator never changes (§7.3).
    v_score := round((v_raw + 4) / 12.0 * 100);

    -- BF adjustment: RES, DRV, DSC only — driven by the BF item's own
    -- dimension_code, so adding a BF item cannot silently affect others.
    select coalesce(sum(o.score_key), 0) into v_bf
    from candidate_responses r
    join items i        on i.id = r.item_id
    join item_options o on o.item_id = r.item_id and o.option_key = r.option_key
    where r.session_id = p_session_id
      and i.dimension_code = v_dim.code
      and i.format = 'behavioural_freq';

    v_score := greatest(0, least(100, v_score + v_bf));
    v_scores := v_scores || jsonb_build_object(v_dim.code, v_score);
  end loop;

  -- ── BIPOLAR ──────────────────────────────────────────────────────────────
  for v_dim in
    select code from dimensions
    where kind = 'bipolar' and active order by code
  loop
    select count(*) filter (where o.score_key = 100), count(*)
      into v_pole100, v_fc_items
    from candidate_responses r
    join items i        on i.id = r.item_id
    join item_options o on o.item_id = r.item_id and o.option_key = r.option_key
    where r.session_id = p_session_id
      and i.dimension_code = v_dim.code
      and i.format = 'forced_choice';

    if v_fc_items = 0 then
      continue;
    end if;

    v_scores := v_scores || jsonb_build_object(
      v_dim.code, round(v_pole100::numeric / v_fc_items * 100)
    );
  end loop;

  -- ── FLAGS — surfaced, never used to reject (§7.2, item bank) ─────────────

  -- sd_high: all three social-desirability absolutes endorsed True.
  -- Two of three is common and not flagged.
  select coalesce(sum(o.score_key), 0) into v_sd_true
  from candidate_responses r
  join items i        on i.id = r.item_id
  join item_options o on o.item_id = r.item_id and o.option_key = r.option_key
  where r.session_id = p_session_id and i.format = 'sd_check';

  if v_sd_true >= param('flags','sd_high_count') then
    v_flags := array_append(v_flags, 'sd_high');
  end if;

  -- fast_completion: under 60% of the RUNNING median of completed sessions.
  -- Needs a population to be meaningful, so it stays off until 5 sessions exist.
  select sum(seconds_on_item) into v_seconds
  from candidate_responses where session_id = p_session_id;

  select percentile_cont(0.5) within group (order by t.total)
    into v_median
  from (
    select r.session_id, sum(r.seconds_on_item) as total
    from candidate_responses r
    join assessment_sessions s on s.id = r.session_id
    where s.completed_at is not null and s.id <> p_session_id
    group by r.session_id
  ) t;

  if v_median is not null
     and (select count(*) from assessment_sessions
          where completed_at is not null and id <> p_session_id) >= 5
     and v_seconds is not null
     and v_seconds < v_median * param('flags','fast_completion_ratio') then
    v_flags := array_append(v_flags, 'fast_completion');
  end if;

  -- straightline: same displayed option position for >= 6 consecutive items.
  -- Uses position_shown, not option_key, because option order is randomised
  -- per session — a candidate clicking "always the second one" is the pattern
  -- worth catching, and option_key would miss it entirely.
  with ordered as (
    select position_shown,
           row_number() over (order by answered_at, item_id) as n
    from candidate_responses
    where session_id = p_session_id and position_shown is not null
  ),
  grouped as (
    select position_shown, n - row_number() over (partition by position_shown order by n) as grp
    from ordered
  )
  select coalesce(max(c), 0) into v_run
  from (select count(*) as c from grouped group by position_shown, grp) t;

  if v_run >= param('flags','straightline_run') then
    v_flags := array_append(v_flags, 'straightline');
  end if;

  -- careless: MOT and STY both at 0 or both at 100.
  v_mot := (v_scores->>'MOT')::numeric;
  v_sty := (v_scores->>'STY')::numeric;
  if v_mot is not null and v_sty is not null
     and ((v_mot = 0 and v_sty = 0) or (v_mot = 100 and v_sty = 100)) then
    v_flags := array_append(v_flags, 'careless');
  end if;

  -- ── GUARD: never write a blended CLS ─────────────────────────────────────
  -- Also enforced by a CHECK constraint in 01. Belt and braces, because this is
  -- the invariant that keeps a candidate's score independent of which client
  -- they happened to be matched against first.
  if v_scores ? 'CLS' then
    raise exception 'compute_candidate_profile: refusing to write a blended CLS (PRD §7.2)';
  end if;

  insert into candidate_profile (candidate_id, session_id, dict_version, bank_version, scores, flags)
  values (v_candidate, p_session_id, '2.1', v_bank, v_scores, v_flags)
  on conflict (session_id) do update set
    scores = excluded.scores,
    flags = excluded.flags,
    bank_version = excluded.bank_version,
    computed_at = now()
  returning * into v_profile;

  return v_profile;
end $$;

-- ═══ INSTRUMENT HEALTH (§14.2) ═════════════════════════════════════════════
-- Runs at n=30 and quarterly thereafter. At 60 candidates/month n=30 arrives in
-- about two weeks, so these are live gates rather than aspirations.

-- Cronbach's α per dimension over the 4 SJT items.
--   α = k/(k−1) × (1 − Σσ²ᵢ / σ²ₜ)
create or replace view v_dimension_alpha as
with resp as (
  select i.dimension_code as dim, r.session_id, r.item_id, o.score_key
  from candidate_responses r
  join items i        on i.id = r.item_id
  join item_options o on o.item_id = r.item_id and o.option_key = r.option_key
  join assessment_sessions s on s.id = r.session_id
  where i.format = 'sjt' and s.completed_at is not null
),
item_var as (
  select dim, item_id, var_samp(score_key) as v from resp group by dim, item_id
),
total_var as (
  select dim, var_samp(total) as v, count(*) as n
  from (select dim, session_id, sum(score_key) as total from resp group by dim, session_id) t
  group by dim
),
k as (select dim, count(*) as k from item_var group by dim)
select
  k.dim                                   as dimension_code,
  t.n                                      as n_sessions,
  k.k                                      as n_items,
  round(
    (k.k::numeric / (k.k - 1)) * (1 - (sum(iv.v) / nullif(t.v, 0)))
  , 3)                                     as alpha,
  case
    when t.n < 30 then 'insufficient n'
    when (k.k::numeric/(k.k-1)) * (1 - (sum(iv.v)/nullif(t.v,0))) < 0.55
         and k.dim in ('CLS_C','CLS_F')    then 'COLLAPSE CLS — below .55 (§14.2)'
    when (k.k::numeric/(k.k-1)) * (1 - (sum(iv.v)/nullif(t.v,0))) < 0.60
                                           then 'rewrite — below .60'
    when (k.k::numeric/(k.k-1)) * (1 - (sum(iv.v)/nullif(t.v,0))) < 0.70
                                           then 'watch'
    else 'ok'
  end                                      as verdict
from k
join total_var t on t.dim = k.dim
join item_var iv on iv.dim = k.dim
group by k.dim, k.k, t.v, t.n;

-- Item–total correlation: an item pulling against its own dimension (r < .15).
create or replace view v_item_total_correlation as
with resp as (
  select i.dimension_code as dim, r.session_id, r.item_id, o.score_key
  from candidate_responses r
  join items i        on i.id = r.item_id
  join item_options o on o.item_id = r.item_id and o.option_key = r.option_key
  join assessment_sessions s on s.id = r.session_id
  where i.format = 'sjt' and s.completed_at is not null
),
rest as (
  select a.item_id, a.session_id, a.score_key,
         sum(b.score_key) as rest_total
  from resp a
  join resp b on b.session_id = a.session_id and b.dim = a.dim and b.item_id <> a.item_id
  group by a.item_id, a.session_id, a.score_key
)
select item_id,
       count(*)                                as n,
       round(corr(score_key, rest_total)::numeric, 3) as r_item_rest,
       case when corr(score_key, rest_total) < 0.15 then 'replace (§14.2)' else 'ok' end as verdict
from rest group by item_id;

-- Correlation with the SD index: are the right answers obvious? (r > .40)
create or replace view v_sd_correlation as
with sd as (
  select r.session_id, sum(o.score_key) as sd_index
  from candidate_responses r
  join items i        on i.id = r.item_id
  join item_options o on o.item_id = r.item_id and o.option_key = r.option_key
  where i.format = 'sd_check'
  group by r.session_id
),
dim as (
  select i.dimension_code as dim, r.session_id, sum(o.score_key) as raw
  from candidate_responses r
  join items i        on i.id = r.item_id
  join item_options o on o.item_id = r.item_id and o.option_key = r.option_key
  where i.format = 'sjt'
  group by i.dimension_code, r.session_id
)
select d.dim as dimension_code,
       count(*)                                   as n,
       round(corr(d.raw, s.sd_index)::numeric, 3) as r_with_sd,
       case when corr(d.raw, s.sd_index) > 0.40
            then 'transparent and being gamed — rewrite (§14.2)' else 'ok' end as verdict
from dim d join sd s on s.session_id = d.session_id
group by d.dim;

-- Inter-dimension correlation: two dimensions measuring one construct (r > .80).
create or replace view v_inter_dimension_correlation as
with dim as (
  select i.dimension_code as dim, r.session_id, sum(o.score_key) as raw
  from candidate_responses r
  join items i        on i.id = r.item_id
  join item_options o on o.item_id = r.item_id and o.option_key = r.option_key
  where i.format = 'sjt'
  group by i.dimension_code, r.session_id
)
select a.dim as dim_a, b.dim as dim_b,
       count(*)                                as n,
       round(corr(a.raw, b.raw)::numeric, 3)   as r,
       case when corr(a.raw, b.raw) > 0.80 then 'consider merging (§14.2)' else 'ok' end as verdict
from dim a join dim b on b.session_id = a.session_id and a.dim < b.dim
group by a.dim, b.dim;

-- Score distribution: SD < 10 points means the dimension does not discriminate.
create or replace view v_score_distribution as
select d.code as dimension_code,
       count(*)                                                     as n,
       round(avg((p.scores->>d.code)::numeric), 1)                   as mean,
       round(stddev_samp((p.scores->>d.code)::numeric), 1)           as sd,
       min((p.scores->>d.code)::numeric)                             as min,
       max((p.scores->>d.code)::numeric)                             as max,
       case when stddev_samp((p.scores->>d.code)::numeric) < 10
            then 'too easy — no discrimination (§14.2)' else 'ok' end as verdict
from candidate_profile p
cross join dimensions d
where d.active and p.scores ? d.code
group by d.code;

-- §14.4 drift and leakage — the signature is all three moving together:
-- mean composite up, variance down, completion time down.
create or replace view v_drift_monthly as
select date_trunc('month', s.completed_at)::date               as month,
       count(*)                                                as n_sessions,
       round(avg(t.total_seconds)/60.0, 1)                      as median_minutes,
       round(avg(t.mean_unipolar), 1)                           as mean_unipolar_score,
       round(stddev_samp(t.mean_unipolar), 1)                   as score_variance
from assessment_sessions s
join (
  select r.session_id,
         sum(r.seconds_on_item) as total_seconds,
         avg(case when i.format = 'sjt' then o.score_key end) as mean_unipolar
  from candidate_responses r
  join items i        on i.id = r.item_id
  join item_options o on o.item_id = r.item_id and o.option_key = r.option_key
  group by r.session_id
) t on t.session_id = s.id
where s.completed_at is not null
group by 1 order by 1;

-- §13 three-expert keying agreement. Items where all three agree are solid;
-- items where they split are the ones to rewrite BEFORE launch.
create or replace view v_keying_agreement as
select k.item_id,
       i.dimension_code,
       count(distinct k.expert_id)                          as n_experts,
       count(distinct k.best_option_key)                    as n_distinct_answers,
       string_agg(distinct k.best_option_key, '/' order by k.best_option_key) as chosen,
       (select o.option_key from item_options o
         where o.item_id = k.item_id order by o.score_key desc limit 1) as current_key,
       case
         when count(distinct k.best_option_key) = 1
              and min(k.best_option_key) = (select o.option_key from item_options o
                                             where o.item_id = k.item_id
                                             order by o.score_key desc limit 1)
           then 'unanimous, matches current key'
         when count(distinct k.best_option_key) = 1
           then 'unanimous, DISAGREES with current key — rekey'
         else 'split — rewrite before launch (§13)'
       end as verdict
from keying_submissions k
join items i on i.id = k.item_id
group by k.item_id, i.dimension_code;
