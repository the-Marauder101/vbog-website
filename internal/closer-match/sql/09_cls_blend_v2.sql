-- ═══════════════════════════════════════════════════════════════════════════
-- CLS blend v2 — continuous consideration axis
-- Supersedes the behaviour of §9.2.1 Steps 1–2. Closes findings 5.1 and 5.2 in
-- ARCHITECTURE.md. Decided by the product owner, 31 July 2026.
--
-- WHY THIS REPLACES THE STEPPED LOOKUP
--
-- Finding 5.1 — the stepped ticket table moves w_C by a full 0.20 at a band
-- edge, so Rs 79,000 and Rs 81,000 produced materially different blends and
-- reordered candidates whose CLS gap was below the frame_split_flag threshold.
-- The owner's instruction was "if the difference is Rs 2,000, don't move the
-- candidate a whole grade". Snapping to the lower band satisfies that for one
-- pair and recreates it at the next boundary, because the cliff is the steps
-- themselves. Interpolation removes it everywhere: Rs 2,000 at the 80k edge now
-- moves w_C by 0.005 instead of 0.20.
--
-- Finding 5.2 — ticket controlled a range of 0.70 while cycle could adjust by at
-- most 0.15, so cycle could not correct a ticket band that misdescribed the job.
-- A Rs 20,000 offer closing over 45 days IS a considered sale; §9.2.1 Step 2
-- exists precisely to catch that, and additively it could not.
--
-- THE MODEL
--   consideration_index ∈ [0,1]   0 = pure fast momentum · 1 = pure deal-craft
--   index_ticket = interpolated over ticket anchors, in log10(ticket)
--   index_cycle  = interpolated over cycle-day anchors, linear in days
--   w_C = 0.65 × index_ticket + 0.35 × index_cycle     then clamped
--   w_F = 1 − w_C
--
-- Ticket interpolates in LOG space because ticket size spans orders of
-- magnitude — Rs 10k→20k is a different kind of jump from Rs 3L→3.1L, and
-- linear interpolation would treat the top band as almost the whole axis.
--
-- The 0.65 / 0.35 split is EXPERT-SET, not learned (§9.4), like every other
-- weight in this system. It keeps ticket primary — the PRD makes it Step 1 —
-- while giving cycle enough authority to actually move a misdescribed role.
-- Fittable once §12 has outcomes.
--
-- The v1 stepped tables in 02 are left in place. Set
-- dimension_params('cls_blend_mode','interpolated') to 0 to roll back to exact
-- §9.2.1 behaviour; the golden cases run against whichever mode is active.
-- ═══════════════════════════════════════════════════════════════════════════

delete from dimension_params where param_group in
  ('cls_blend_mode','cls_ticket_anchor','cls_cycle_anchor','cls_component_weight');

insert into dimension_params (param_group, param_key, param_value, note) values
  ('cls_blend_mode','interpolated', 1,
   '1 = continuous consideration axis (v2). 0 = §9.2.1 stepped tables (v1).');

-- ── Ticket anchors: (ticket, consideration index) ──────────────────────────
-- Anchored so each anchor reproduces the v1 w_C for the middle of its band.
-- v1 w_C by band: <25k 0.15 · 25-50k 0.30 · 50-80k 0.50 · 80-150k 0.70 · >150k 0.85
insert into dimension_params (param_group, param_key, param_value, note) values
  ('cls_ticket_anchor','12500',  0.15, 'mid of the under-25k band'),
  ('cls_ticket_anchor','37500',  0.30, 'mid of 25k-50k'),
  ('cls_ticket_anchor','65000',  0.50, 'mid of 50k-80k'),
  ('cls_ticket_anchor','115000', 0.70, 'mid of 80k-1.5L'),
  ('cls_ticket_anchor','300000', 0.85, 'representative of above 1.5L');

-- ── Cycle anchors: (days, consideration index) ─────────────────────────────
insert into dimension_params (param_group, param_key, param_value, note) values
  ('cls_cycle_anchor','0',   0.00, 'same-day close'),
  ('cls_cycle_anchor','4',   0.25, 'mid of 1-7 days'),
  ('cls_cycle_anchor','19',  0.50, 'mid of 8-30 days'),
  ('cls_cycle_anchor','60',  0.75, 'mid of 31-90 days'),
  ('cls_cycle_anchor','120', 1.00, 'beyond 90 days');

insert into dimension_params (param_group, param_key, param_value, note) values
  ('cls_component_weight','ticket', 0.65, 'EXPERT-SET (§9.4). Ticket stays primary.'),
  ('cls_component_weight','cycle',  0.35, 'EXPERT-SET (§9.4). Enough authority to correct a misdescribed band.');

-- ── Piecewise-linear interpolation over an anchor group ────────────────────
-- p_log = true interpolates in log10 space (ticket); false is linear (days).
-- Outside the anchor range the nearest anchor value is held, so an extreme
-- input degrades to the edge value rather than extrapolating off the scale.
create or replace function param_interp(p_group text, p_input numeric, p_log boolean default false)
returns numeric language plpgsql stable as $$
declare
  x  numeric := case when p_log then log(10, greatest(p_input, 1)) else p_input end;
  lo record; hi record;
begin
  select param_key::numeric as k, param_value as v into lo
  from dimension_params
  where param_group = p_group and param_key::numeric <= p_input
  order by param_key::numeric desc limit 1;

  select param_key::numeric as k, param_value as v into hi
  from dimension_params
  where param_group = p_group and param_key::numeric >= p_input
  order by param_key::numeric asc limit 1;

  if lo is null then return hi.v; end if;   -- below the first anchor
  if hi is null then return lo.v; end if;   -- above the last anchor
  if lo.k = hi.k then return lo.v; end if;  -- exactly on an anchor

  return lo.v + (hi.v - lo.v) * (
    (x - case when p_log then log(10, greatest(lo.k, 1)) else lo.k end)
    / nullif(
        (case when p_log then log(10, greatest(hi.k, 1)) else hi.k end)
      - (case when p_log then log(10, greatest(lo.k, 1)) else lo.k end), 0)
  );
end $$;

-- ── The blend ──────────────────────────────────────────────────────────────
create or replace function cls_blend(p_ticket numeric, p_cycle_days numeric)
returns jsonb language plpgsql stable as $$
declare
  base_f numeric; delta numeric;
  idx_t numeric; idx_c numeric;
  w_f numeric; w_c numeric; total numeric;
  lo numeric := param('cls_blend_clamp','min');
  hi numeric := param('cls_blend_clamp','max');
begin
  if coalesce(param('cls_blend_mode','interpolated'), 1) = 1 then
    -- ── v2: continuous consideration axis ────────────────────────────────
    idx_t := param_interp('cls_ticket_anchor', coalesce(p_ticket, 12500), true);
    idx_c := param_interp('cls_cycle_anchor',  coalesce(p_cycle_days, 19), false);

    w_c := param('cls_component_weight','ticket') * idx_t
         + param('cls_component_weight','cycle')  * idx_c;
    w_c := greatest(lo, least(hi, w_c));
    w_f := 1 - w_c;
  else
    -- ── v1: exact §9.2.1 stepped behaviour, retained for rollback ────────
    base_f := param_band('cls_blend_ticket', coalesce(p_ticket, 0));
    delta  := param_band('cls_blend_cycle',  coalesce(p_cycle_days, 8));
    w_f := base_f       + greatest(delta, 0);
    w_c := (1 - base_f) + greatest(-delta, 0);
    total := w_f + w_c;
    w_f := greatest(lo, least(hi, w_f / total));
    w_c := greatest(lo, least(hi, w_c / total));
    total := w_f + w_c;
    w_f := w_f / total;
    w_c := w_c / total;
  end if;

  return jsonb_build_object('w_C', round(w_c, 4), 'w_F', round(w_f, 4));
end $$;

comment on function cls_blend(numeric, numeric) is
  'PRD §9.2.1 as revised 31 Jul 2026: continuous consideration axis, 65% ticket '
  '/ 35% cycle, both interpolated. Set cls_blend_mode.interpolated = 0 to revert '
  'to the original stepped tables. See sql/09 header and ARCHITECTURE.md §5.';

-- Every target profile already computed was built on v1 weights. Recompute the
-- blend in place so existing requirements are not silently running old maths,
-- then re-run the engine for every open requirement.
update client_target_profile tp
set cls_blend = cls_blend(
      (ci.payload->>'ticket_size')::numeric,
      (ci.payload->>'cycle_days')::numeric)
from client_intake ci
where ci.id = tp.intake_id;

do $$
declare r record; begin
  for r in select id from requirements loop
    perform compute_matches(r.id);
  end loop;
end $$;
