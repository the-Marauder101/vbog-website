-- ═══════════════════════════════════════════════════════════════════════════
-- Client target profile — PRD v3.0 §6
--
-- Turns one client_intake row into required levels, weights, bipolar targets,
-- a CLS blend, a benchmark source and a confidence flag.
--
-- The client ranks a single CLS. The candidate has two capabilities. That
-- asymmetry is deliberate and is resolved in the engine, not here (§6.1).
--
-- ── INTAKE PAYLOAD CONTRACT ────────────────────────────────────────────────
-- {
--   "ticket_size": 95000,            -- Rs
--   "cycle_days": 45,                -- 0 = same day
--   "leads_per_day": 8,
--   "buyer_response": 4,             -- 1..5, see the note on STY below
--   "top3":    ["RES","CLS","DSC"],  -- Class 1 forced-rank, client CLS space
--   "bottom3": ["CCH"],
--   "followup_rate_pct": 35,         -- on warm non-buyers
--   "has_crm": false,
--   "cold_outbound_pct": 60,
--   "refund_policy_exists": true,
--   "buyer_is_senior": true,         -- business owner / senior professional
--   "comp_band": 3,                  -- comp_bands.band_index the client offers
--   "expected_days_to_first_close": 45,   -- MANDATORY: defines the outcome metric
--   "benchmark_source": "employee"   -- 'none' | 'employee' | 'founder'
-- }
--
-- Rankable client dimensions: RES DRV DSC CLS CCH INT. MOT and STY are targets
-- derived mechanically, never ranked — a client cannot "want more MOT".
-- ═══════════════════════════════════════════════════════════════════════════

-- ── §6.2 MOT target ────────────────────────────────────────────────────────
-- MOT_target = mean(ticket_component, cycle_component, volume_component)
create or replace function mot_target(p_ticket numeric, p_cycle_days numeric, p_leads_per_day numeric)
returns numeric language sql stable as $$
  select round((
      param_band('mot_ticket',  coalesce(p_ticket, 0))
    + param_band('mot_cycle',   coalesce(p_cycle_days, 8))
    + param_band('mot_volume',  coalesce(p_leads_per_day, 6))
  ) / 3.0);
$$;

-- ── §9.2.1 CLS blend weights ───────────────────────────────────────────────
-- Step 1 ticket band · Step 2 cycle adjustment · Step 3 normalise + clamp.
-- With the v1.1 parameter tables the clamp never actually binds; it is a guard
-- against a future parameter edit, not live behaviour.
create or replace function cls_blend(p_ticket numeric, p_cycle_days numeric)
returns jsonb language plpgsql stable as $$
declare
  base_f numeric; delta numeric;
  w_f numeric; w_c numeric; total numeric;
  lo numeric := param('cls_blend_clamp','min');
  hi numeric := param('cls_blend_clamp','max');
begin
  base_f := param_band('cls_blend_ticket', coalesce(p_ticket, 0));
  delta  := param_band('cls_blend_cycle',  coalesce(p_cycle_days, 8));

  -- A positive delta pushes toward fast; a negative delta pushes toward considered.
  w_f := base_f       + greatest(delta, 0);
  w_c := (1 - base_f) + greatest(-delta, 0);

  total := w_f + w_c;
  w_f := w_f / total;
  w_c := w_c / total;

  w_f := greatest(lo, least(hi, w_f));
  w_c := greatest(lo, least(hi, w_c));
  total := w_f + w_c;

  return jsonb_build_object(
    'w_C', round(w_c / total, 4),
    'w_F', round(w_f / total, 4)
  );
end $$;

-- ── §6.4 Benchmark means, expressed in the client's single-CLS space ───────
-- The top 1–2 existing closers (or the founder) take the same battery. Their
-- CLS_C and CLS_F are blended with THIS client's own weights, which is the only
-- coherent way to compare a two-capability candidate to a one-requirement client.
create or replace function benchmark_means(p_client_id uuid, p_blend jsonb)
returns jsonb language sql stable as $$
  select case when count(*) = 0 then null else jsonb_build_object(
    'n',     count(*),
    'RES',   round(avg((p.scores->>'RES')::numeric)),
    'DRV',   round(avg((p.scores->>'DRV')::numeric)),
    'DSC',   round(avg((p.scores->>'DSC')::numeric)),
    'CCH',   round(avg((p.scores->>'CCH')::numeric)),
    'INT',   round(avg((p.scores->>'INT')::numeric)),
    'CLS',   round(avg(
               (p_blend->>'w_C')::numeric * (p.scores->>'CLS_C')::numeric +
               (p_blend->>'w_F')::numeric * (p.scores->>'CLS_F')::numeric
             )),
    'MOT',   round(avg((p.scores->>'MOT')::numeric)),
    'STY',   round(avg((p.scores->>'STY')::numeric))
  ) end
  from candidate_profile p
  join assessment_sessions s on s.id = p.session_id
  where s.is_benchmark and s.benchmark_client_id = p_client_id;
$$;

-- ═══ THE TARGET-PROFILE FUNCTION ═══════════════════════════════════════════

create or replace function compute_target_profile(p_intake_id uuid)
returns client_target_profile
language plpgsql as $$
declare
  v_client    uuid;
  v_p         jsonb;
  v_complete  boolean;
  v_blend     jsonb;
  v_required  jsonb := '{}'::jsonb;
  v_weights   jsonb := '{}'::jsonb;
  v_bipolar   jsonb;
  v_bench_src text;
  v_bench     jsonb;
  v_conflicts jsonb := '[]'::jsonb;
  v_confidence text;
  v_contradictory boolean;
  v_dim       text;
  v_base      numeric := param('required_levels','base');
  v_top3      numeric := param('required_levels','top3_bonus');
  v_bot3      numeric := param('required_levels','bottom3_malus');
  v_cmin      numeric := param('required_levels','clamp_min');
  v_cmax      numeric := param('required_levels','clamp_max');
  v_lvl       numeric;
  v_mod       numeric;
  v_stated    numeric;
  v_bw        numeric;
  v_out       client_target_profile;
  v_top       text[];
  v_bot       text[];
begin
  select client_id, payload, is_complete into v_client, v_p, v_complete
  from client_intake where id = p_intake_id;

  if v_client is null then
    raise exception 'compute_target_profile: no such intake %', p_intake_id;
  end if;

  v_top := coalesce(array(select jsonb_array_elements_text(v_p->'top3')), '{}');
  v_bot := coalesce(array(select jsonb_array_elements_text(v_p->'bottom3')), '{}');

  -- Forced-ranks are internally contradictory if a dimension is both wanted and
  -- unwanted. That is a low-confidence intake, not something to quietly average.
  v_contradictory := exists (select 1 from unnest(v_top) t where t = any(v_bot));

  v_blend := cls_blend((v_p->>'ticket_size')::numeric, (v_p->>'cycle_days')::numeric);

  v_bench_src := coalesce(v_p->>'benchmark_source', 'none');
  if v_bench_src <> 'none' then
    v_bench := benchmark_means(v_client, v_blend);
    if v_bench is null then
      v_bench_src := 'none';   -- claimed a benchmark but nobody took the battery
    end if;
  end if;

  -- ── §6.3 required levels + §6.1 Class 2 moderators, per dimension ────────
  foreach v_dim in array array['RES','DRV','DSC','CLS','CCH','INT']
  loop
    v_lvl := v_base;
    if v_dim = any(v_top) then v_lvl := v_lvl + v_top3; end if;
    if v_dim = any(v_bot) then v_lvl := v_lvl + v_bot3; end if;

    -- Job-context moderators, derived mechanically — no prose interpretation.
    v_mod := 0;
    if v_dim = 'DSC'
       and (coalesce((v_p->>'followup_rate_pct')::numeric, 100)
              < param('moderators','DSC_followup_threshold_pct')
            or coalesce((v_p->>'has_crm')::boolean, true) = false)
    then v_mod := param('moderators','DSC_low_followup_or_no_crm'); end if;

    if v_dim = 'RES'
       and coalesce((v_p->>'cold_outbound_pct')::numeric, 0)
             > param('moderators','RES_cold_threshold_pct')
    then v_mod := param('moderators','RES_cold_outbound'); end if;

    if v_dim = 'INT'
       and (coalesce((v_p->>'ticket_size')::numeric, 0)
              >= param('moderators','INT_ticket_threshold')
            or coalesce((v_p->>'refund_policy_exists')::boolean, false))
    then v_mod := param('moderators','INT_high_ticket_or_refund'); end if;

    if v_dim = 'CLS'
       and coalesce((v_p->>'buyer_is_senior')::boolean, false)
    then v_mod := param('moderators','CLS_senior_buyer'); end if;

    v_stated := v_lvl + v_mod;

    -- ── §6.4 benchmark handling ──────────────────────────────────────────
    if v_bench_src = 'employee' then
      -- The empirical target OVERRIDES the stated forced-rank where they conflict.
      v_lvl := (v_bench->>v_dim)::numeric;
    elsif v_bench_src = 'founder' then
      -- Founders close on authority, product knowledge and a personal stake no
      -- employee will have, so a founder benchmark is weighted, not obeyed.
      v_bw := param('confidence','founder_benchmark_weight');
      v_lvl := v_stated * (1 - v_bw) + (v_bench->>v_dim)::numeric * v_bw;
    else
      v_lvl := v_stated;
    end if;

    -- Surface the conflict rather than resolving it silently. "Client ranked
    -- Process Discipline bottom-3, but their best rep scores 81" is the kind of
    -- thing that saves a placement.
    if v_bench is not null then
      if v_dim = any(v_bot) and (v_bench->>v_dim)::numeric >= 75 then
        v_conflicts := v_conflicts || jsonb_build_object(
          'dimension', v_dim, 'kind', 'ranked_bottom3_but_benchmark_high',
          'stated_required', v_stated, 'benchmark', (v_bench->>v_dim)::numeric);
      elsif v_dim = any(v_top) and (v_bench->>v_dim)::numeric <= 50 then
        v_conflicts := v_conflicts || jsonb_build_object(
          'dimension', v_dim, 'kind', 'ranked_top3_but_benchmark_low',
          'stated_required', v_stated, 'benchmark', (v_bench->>v_dim)::numeric);
      end if;
    end if;

    v_required := v_required || jsonb_build_object(
      v_dim, round(greatest(v_cmin, least(v_cmax, v_lvl)))
    );

    -- ── §6.3 matching weights ────────────────────────────────────────────
    v_weights := v_weights || jsonb_build_object(v_dim,
      case
        when v_dim = any(v_top) then param('weights','top3')
        when v_dim = any(v_bot) then param('weights','bottom3')
        else param('weights','unranked')
      end);
  end loop;

  -- MOT and STY carry unranked weight — the client never ranks them.
  v_weights := v_weights
    || jsonb_build_object('MOT', param('weights','unranked'))
    || jsonb_build_object('STY', param('weights','unranked'));

  -- ── §6.2 / §6.1 bipolar targets ──────────────────────────────────────────
  -- STY: §6.1 says "answer × 25" against a 5-point control. Taken literally on a
  -- 1..5 scale that yields 25..125, which is out of range, so the intake stores
  -- the natural 1..5 and the mapping is (answer − 1) × 25 -> 0,25,50,75,100.
  -- Flagged rather than silently assumed.
  v_bipolar := jsonb_build_object(
    'MOT', mot_target((v_p->>'ticket_size')::numeric,
                      (v_p->>'cycle_days')::numeric,
                      (v_p->>'leads_per_day')::numeric),
    'STY', greatest(0, least(100,
             (coalesce((v_p->>'buyer_response')::numeric, 3) - 1)
             * param('moderators','STY_answer_multiplier')))
  );

  -- An employee benchmark also speaks to fit, and empirically beats a stated
  -- persona guess. Founder benchmarks do not override here either.
  if v_bench_src = 'employee' then
    v_bipolar := jsonb_build_object(
      'MOT', (v_bench->>'MOT')::numeric,
      'STY', (v_bench->>'STY')::numeric
    );
  end if;

  -- ── §6.5 confidence ──────────────────────────────────────────────────────
  v_confidence := case
    when not coalesce(v_complete, false) or v_contradictory then 'low'
    when v_bench_src = 'employee'                          then 'high'
    else 'medium'   -- complete + founder benchmark, or complete with clean ranks
  end;

  insert into client_target_profile (
    client_id, intake_id, dict_version, required_levels, dimension_weights,
    bipolar_targets, cls_blend, benchmark_source, confidence, benchmark_conflicts
  ) values (
    v_client, p_intake_id, '2.1', v_required, v_weights,
    v_bipolar, v_blend, v_bench_src, v_confidence,
    case when jsonb_array_length(v_conflicts) = 0 then null else v_conflicts end
  ) returning * into v_out;

  return v_out;
end $$;
