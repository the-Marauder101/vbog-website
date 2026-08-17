-- ═══════════════════════════════════════════════════════════════════════════
-- Dimension Dictionary v2.1 + every scoring parameter
-- Source: PRD v3.0 §5 (dictionary), §6.2, §6.3, §9.2.1, §9.4 (parameters)
--
-- §6.2: "All lookups live in dimension_params. Editable, versioned,
-- audit-logged. Nothing hardcoded in app code." This file is the only place
-- these numbers appear. Changing one here changes the engine; the trigger in
-- 01 records who changed it.
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══ THE EIGHT CONSTRUCTS / NINE SCORED COLUMNS (§5) ═══════════════════════

insert into dimensions (code, name, kind, definition, pole_0_label, pole_100_label) values
  ('RES','Resilience & Composure','unipolar',
   'Return to baseline effort and tone after losses, hostility, or a bad month.', null, null),
  ('DRV','Achievement Drive','unipolar',
   'Internally-set standards above the assigned target.', null, null),
  ('DSC','Process Discipline','unipolar',
   'Same-day logging, dated follow-ups, pipeline hygiene, self-built systems.', null, null),
  ('CLS_C','Closing Assertiveness — considered','unipolar',
   'Asking for money, holding silence and price, keeping frame with senior buyers on a multi-conversation sale.', null, null),
  ('CLS_F','Closing Assertiveness — fast','unipolar',
   'The same assertiveness as momentum: closing inside a single short inbound call.', null, null),
  ('CCH','Coachability','unipolar',
   'Behaviour change after correction, including correction they disagree with.', null, null),
  ('INT','Sales Integrity','unipolar',
   'Restraint from overselling, false scarcity, or knowingly bad-fit closes.', null, null),
  ('MOT','Deal Motion Orientation','bipolar',
   'Where the candidate naturally operates on the volume/craft axis. Neither pole is better.',
   'Pitch-forward / high-volume','Consultative / deal-craft'),
  ('STY','Interpersonal Style','bipolar',
   'How the candidate builds a buying relationship. Neither pole is better.',
   'Task-direct','Rapport-warm')
on conflict (code) do update set
  name = excluded.name,
  kind = excluded.kind,
  definition = excluded.definition,
  pole_0_label = excluded.pole_0_label,
  pole_100_label = excluded.pole_100_label;

-- ═══ PARAMETERS ════════════════════════════════════════════════════════════
-- BANDED LOOKUP CONVENTION
-- For every *_band group below, param_key is the INCLUSIVE LOWER BOUND of the
-- band and param_value is the value that applies from there up to the next
-- key. Resolve with: the row having the greatest param_key <= input.
-- Helper: param_band(group, input) — defined in 04_scoring.sql.
--
-- Where the PRD writes a band as "₹80,000 – ₹1,50,000" the upper figure is
-- inclusive, so the band above it starts at 150000.01. Every other boundary is
-- lower-inclusive as written ("₹25,000 – ₹50,000" means 25000 is in band 2).

delete from dimension_params where param_group in (
  'mot_ticket','mot_cycle','mot_volume',
  'cls_blend_ticket','cls_blend_cycle','cls_blend_clamp',
  'required_levels','moderators','weights','composite','quality',
  'confidence','flags','fit'
);

-- ── §6.2 MOT target components ─────────────────────────────────────────────
-- MOT_target = mean(ticket_component, cycle_component, volume_component)

insert into dimension_params (param_group, param_key, param_value, note) values
  ('mot_ticket','0',            0, 'under Rs 25,000'),
  ('mot_ticket','25000',       25, 'Rs 25,000 to 75,000'),
  ('mot_ticket','75000',       50, 'Rs 75,000 to 2L'),
  ('mot_ticket','200000',      75, 'Rs 2L to 5L'),
  ('mot_ticket','500000.01',  100, 'above Rs 5L'),

  ('mot_cycle','0',             0, 'same day'),
  ('mot_cycle','1',            25, '1 to 7 days'),
  ('mot_cycle','8',            50, '8 to 30 days'),
  ('mot_cycle','31',           75, '31 to 90 days'),
  ('mot_cycle','91',          100, 'over 90 days'),

  -- leads per day — inverted: high volume is the 0 pole
  ('mot_volume','0',          100, 'under 3 leads/day'),
  ('mot_volume','3',           75, '3 to 5 leads/day'),
  ('mot_volume','6',           50, '6 to 10 leads/day'),
  ('mot_volume','11',          25, '11 to 20 leads/day'),
  ('mot_volume','21',           0, 'over 20 leads/day');

-- ── §9.2.1 CLS blend — Step 1, base w_F from ticket band ───────────────────
-- w_C is always 1 − w_F before the cycle adjustment.

insert into dimension_params (param_group, param_key, param_value, note) values
  ('cls_blend_ticket','0',           0.85, 'under Rs 25,000 -> w_F 0.85 / w_C 0.15'),
  ('cls_blend_ticket','25000',       0.70, 'Rs 25,000-50,000 -> w_F 0.70 / w_C 0.30'),
  ('cls_blend_ticket','50000',       0.50, 'Rs 50,000-80,000 -> w_F 0.50 / w_C 0.50'),
  ('cls_blend_ticket','80000',       0.30, 'Rs 80,000-1.5L -> w_F 0.30 / w_C 0.70'),
  ('cls_blend_ticket','150000.01',   0.15, 'above Rs 1.5L -> w_F 0.15 / w_C 0.85');

-- ── §9.2.1 CLS blend — Step 2, cycle adjustment, expressed as a w_F delta ──
-- Ticket alone under-specifies the job: Rs 40k on one inbound call and Rs 40k
-- over six weeks with three stakeholders are different roles needing different
-- people. This is the step a ticket-only toggle would have got wrong.

insert into dimension_params (param_group, param_key, param_value, note) values
  ('cls_blend_cycle','0',    0.15, 'same-day close: w_F += 0.15'),
  ('cls_blend_cycle','1',    0.05, '1-7 days: w_F += 0.05'),
  ('cls_blend_cycle','8',    0.00, '8-30 days: no change'),
  ('cls_blend_cycle','31',  -0.10, '31-90 days: w_C += 0.10'),
  ('cls_blend_cycle','91',  -0.15, 'over 90 days: w_C += 0.15');

-- ── §9.2.1 Step 3 clamp ────────────────────────────────────────────────────
insert into dimension_params (param_group, param_key, param_value, note) values
  ('cls_blend_clamp','min', 0.10, 'each weight clamped to at least 0.10'),
  ('cls_blend_clamp','max', 0.90, 'each weight clamped to at most 0.90');

-- ── §6.3 Required levels ───────────────────────────────────────────────────
insert into dimension_params (param_group, param_key, param_value, note) values
  ('required_levels','base',        60, 'base_required'),
  ('required_levels','top3_bonus',  15, '+15 if in client top-3 forced-rank'),
  ('required_levels','bottom3_malus',-15,'-15 if in client bottom-3 forced-rank'),
  ('required_levels','clamp_min',   40, 'clamped to [40, 90]'),
  ('required_levels','clamp_max',   90, 'clamped to [40, 90]');

-- ── §6.1 Class 2 job-context moderators ────────────────────────────────────
insert into dimension_params (param_group, param_key, param_value, note) values
  ('moderators','DSC_low_followup_or_no_crm', 10, 'follow-up rate <40% OR no CRM -> DSC +10'),
  ('moderators','RES_cold_outbound',          10, 'cold outbound >50% of pipeline -> RES +10'),
  ('moderators','INT_high_ticket_or_refund',  10, 'ticket >= Rs 1L or a refund policy exists -> INT +10'),
  ('moderators','CLS_senior_buyer',           10, 'business owner / senior professional buyer -> CLS +10'),
  ('moderators','DSC_followup_threshold_pct', 40, 'the <40% in the DSC rule'),
  ('moderators','RES_cold_threshold_pct',     50, 'the >50% in the RES rule'),
  ('moderators','INT_ticket_threshold',   100000, 'the Rs 1L in the INT rule'),
  ('moderators','STY_answer_multiplier',      25, 'STY target = buyer-response 5-point answer x 25');

-- ── §6.3 Matching weights ──────────────────────────────────────────────────
insert into dimension_params (param_group, param_key, param_value, note) values
  ('weights','top3',     3.0, 'client top-3 forced-rank'),
  ('weights','unranked', 1.0, 'not ranked either way'),
  ('weights','bottom3',  0.5, 'client bottom-3 forced-rank');

-- ── §9.2 / §9.4 Composite ──────────────────────────────────────────────────
-- EXPERT-SET, NOT LEARNED. §9.4 requires this be labelled as such wherever it
-- appears in the UI. Becomes fittable when §12 has ~100 outcomes.
insert into dimension_params (param_group, param_key, param_value, note) values
  ('quality','over_requirement_cap', 1.15,
   'min(candidate/required, 1.15) — exceeding a requirement helps a little, not unboundedly'),
  ('composite','w_quality', 0.6, 'EXPERT-SET, not learned (§9.4)'),
  ('composite','w_fit',     0.4, 'EXPERT-SET, not learned (§9.4)');

-- ── §6.5 Confidence multipliers ────────────────────────────────────────────
-- Shown beside every match score. A confident-looking number on a thin intake
-- is the most dangerous output this system can produce.
insert into dimension_params (param_group, param_key, param_value, note) values
  ('confidence','high',   1.00, 'intake complete + employee benchmark'),
  ('confidence','medium', 0.94, 'complete + founder benchmark, or complete with clean forced-ranks'),
  ('confidence','low',    0.85, 'intake incomplete, or forced-ranks internally contradictory'),
  ('confidence','founder_benchmark_weight', 0.5,
   '§6.4 founder-derived benchmarks weighted 0.5 rather than overriding');

-- ── §7.2 / item bank Flag thresholds ───────────────────────────────────────
insert into dimension_params (param_group, param_key, param_value, note) values
  ('flags','sd_high_count',            3, 'all three SD absolutes endorsed True'),
  ('flags','fast_completion_ratio',  0.60, 'under 60% of the running median session time'),
  ('flags','straightline_run',          6, 'same option position for >= 6 consecutive items'),
  -- Two conditions, both required. The ratio alone fires on small samples where
  -- landing on one row twice too often is ordinary luck; the absolute share alone
  -- fires on two-option items where half is exactly chance. See sql/30.
  ('flags','position_bias_ratio',      2.0, 'same screen position chosen >= 2x the chance rate'),
  ('flags','position_bias_min_share', 0.55, 'and on at least 55% of reordered answers'),
  ('flags','frame_split_delta',        25, '|CLS_C - CLS_F| >= 25 -> frame_split_flag');

-- ── §9.3 Fit and attrition ─────────────────────────────────────────────────
insert into dimension_params (param_group, param_key, param_value, note) values
  ('fit','attrition_band_gap', 2,
   'candidate comp preference more than this many bands from the client structure');

-- ═══ COMP LADDER (§7.5, §9.3) ══════════════════════════════════════════════
-- Not defined in any of the three source documents; §9.3 needs a band scale to
-- measure "more than two bands from the client's structure" against. Five bands
-- on the fixed-to-variable axis. Replace the labels if VBOG's real ladder
-- differs — the engine reads band_index, not the text.

create table if not exists comp_bands (
  band_index int primary key,
  label      text not null,
  fixed_pct  int not null,
  variable_pct int not null
);

insert into comp_bands (band_index, label, fixed_pct, variable_pct) values
  (1,'Fully fixed — no variable component',            100,  0),
  (2,'Mostly fixed with a small incentive',             80, 20),
  (3,'Balanced fixed and variable',                     60, 40),
  (4,'Variable-led with a retainer',                    40, 60),
  (5,'Commission-only / pure variable',                 10, 90)
on conflict (band_index) do update set
  label = excluded.label, fixed_pct = excluded.fixed_pct, variable_pct = excluded.variable_pct;
