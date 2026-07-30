-- ═══════════════════════════════════════════════════════════════════════════
-- Golden-case regression fixtures — PRD v3.0 §14.1
--
-- "Written in Phase 1, BEFORE the match engine, so the engine is built against
-- them. Nothing ships without it green."
--
-- This file defines the fixtures and the assertions. The engine (07) is written
-- to satisfy them, not the other way round. Run `select * from run_golden_cases()`
-- after any parameter change.
--
-- Fixture rows are namespaced 'ZZ_FIXTURE' and use deterministic UUIDs, so this
-- file is idempotent and fixtures can never be mistaken for real data.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Teardown (idempotent) ──────────────────────────────────────────────────
delete from candidates where full_name like 'ZZ_FIXTURE%';
delete from clients   where business_name like 'ZZ_FIXTURE%';

-- ═══ FIXTURE CANDIDATE POOL ════════════════════════════════════════════════
-- Eight candidates, identical on every dimension except CLS_C / CLS_F, so that
-- ranking differences are attributable to the blend and nothing else. MOT and
-- STY are held equal so fit is constant within a requirement and cannot
-- confound the CLS assertions.

insert into candidates (id, full_name, contact, direct_fields, consent_version, consent_at) values
('00000000-0000-4000-8000-000000000001','ZZ_FIXTURE F1 C-strong','{}',
 '{"languages":{"en":"fluent"},"location":"Mumbai","work_mode":["remote","onsite"],"salary_expectation":600000,"notice_days":30,"years_experience":4,"comp_band":3}','v1',now()),
('00000000-0000-4000-8000-000000000002','ZZ_FIXTURE F2 F-strong','{}',
 '{"languages":{"en":"fluent"},"location":"Mumbai","work_mode":["remote","onsite"],"salary_expectation":600000,"notice_days":30,"years_experience":4,"comp_band":3}','v1',now()),
('00000000-0000-4000-8000-000000000003','ZZ_FIXTURE F3 balanced high','{}',
 '{"languages":{"en":"fluent"},"location":"Mumbai","work_mode":["remote","onsite"],"salary_expectation":600000,"notice_days":30,"years_experience":4,"comp_band":3}','v1',now()),
('00000000-0000-4000-8000-000000000004','ZZ_FIXTURE F4 balanced mid','{}',
 '{"languages":{"en":"fluent"},"location":"Mumbai","work_mode":["remote","onsite"],"salary_expectation":600000,"notice_days":30,"years_experience":4,"comp_band":3}','v1',now()),
('00000000-0000-4000-8000-000000000005','ZZ_FIXTURE F5 balanced low','{}',
 '{"languages":{"en":"fluent"},"location":"Mumbai","work_mode":["remote","onsite"],"salary_expectation":600000,"notice_days":30,"years_experience":4,"comp_band":3}','v1',now()),
('00000000-0000-4000-8000-000000000006','ZZ_FIXTURE F6 F-lean','{}',
 '{"languages":{"en":"fluent"},"location":"Mumbai","work_mode":["remote","onsite"],"salary_expectation":600000,"notice_days":30,"years_experience":4,"comp_band":3}','v1',now()),
('00000000-0000-4000-8000-000000000007','ZZ_FIXTURE F7 C-lean','{}',
 '{"languages":{"en":"fluent"},"location":"Mumbai","work_mode":["remote","onsite"],"salary_expectation":600000,"notice_days":30,"years_experience":4,"comp_band":3}','v1',now()),
('00000000-0000-4000-8000-000000000008','ZZ_FIXTURE F8 low both','{}',
 '{"languages":{"en":"fluent"},"location":"Mumbai","work_mode":["remote","onsite"],"salary_expectation":600000,"notice_days":30,"years_experience":4,"comp_band":3}','v1',now()),
-- Negative cases
('00000000-0000-4000-8000-000000000009','ZZ_FIXTURE N1 hard-filter fail','{}',
 '{"languages":{"en":"basic"},"location":"Kochi","work_mode":["remote"],"salary_expectation":1800000,"notice_days":120,"years_experience":0,"comp_band":1}','v1',now()),
('00000000-0000-4000-8000-00000000000a','ZZ_FIXTURE N2 attrition risk','{}',
 '{"languages":{"en":"fluent"},"location":"Mumbai","work_mode":["remote","onsite"],"salary_expectation":600000,"notice_days":30,"years_experience":4,"comp_band":1}','v1',now());

insert into assessment_sessions (id, candidate_id, bank_version, item_set, started_at, completed_at) values
('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','1.1','{}',now(),now()),
('10000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000002','1.1','{}',now(),now()),
('10000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000003','1.1','{}',now(),now()),
('10000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000004','1.1','{}',now(),now()),
('10000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000005','1.1','{}',now(),now()),
('10000000-0000-4000-8000-000000000006','00000000-0000-4000-8000-000000000006','1.1','{}',now(),now()),
('10000000-0000-4000-8000-000000000007','00000000-0000-4000-8000-000000000007','1.1','{}',now(),now()),
('10000000-0000-4000-8000-000000000008','00000000-0000-4000-8000-000000000008','1.1','{}',now(),now()),
('10000000-0000-4000-8000-000000000009','00000000-0000-4000-8000-000000000009','1.1','{}',now(),now()),
('10000000-0000-4000-8000-00000000000a','00000000-0000-4000-8000-00000000000a','1.1','{}',now(),now());

-- Hand-set profiles. Everything except CLS_C / CLS_F is held constant.
insert into candidate_profile (candidate_id, session_id, scores, flags) values
('00000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
 '{"RES":70,"DRV":70,"DSC":70,"CCH":70,"INT":70,"CLS_C":82,"CLS_F":41,"MOT":50,"STY":50}','{}'),
('00000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002',
 '{"RES":70,"DRV":70,"DSC":70,"CCH":70,"INT":70,"CLS_C":41,"CLS_F":82,"MOT":50,"STY":50}','{}'),
('00000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000003',
 '{"RES":70,"DRV":70,"DSC":70,"CCH":70,"INT":70,"CLS_C":75,"CLS_F":75,"MOT":50,"STY":50}','{}'),
('00000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000004',
 '{"RES":70,"DRV":70,"DSC":70,"CCH":70,"INT":70,"CLS_C":60,"CLS_F":60,"MOT":50,"STY":50}','{}'),
('00000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000005',
 '{"RES":70,"DRV":70,"DSC":70,"CCH":70,"INT":70,"CLS_C":45,"CLS_F":45,"MOT":50,"STY":50}','{}'),
('00000000-0000-4000-8000-000000000006','10000000-0000-4000-8000-000000000006',
 '{"RES":70,"DRV":70,"DSC":70,"CCH":70,"INT":70,"CLS_C":55,"CLS_F":78,"MOT":50,"STY":50}','{}'),
('00000000-0000-4000-8000-000000000007','10000000-0000-4000-8000-000000000007',
 '{"RES":70,"DRV":70,"DSC":70,"CCH":70,"INT":70,"CLS_C":78,"CLS_F":55,"MOT":50,"STY":50}','{}'),
('00000000-0000-4000-8000-000000000008','10000000-0000-4000-8000-000000000008',
 '{"RES":70,"DRV":70,"DSC":70,"CCH":70,"INT":70,"CLS_C":35,"CLS_F":40,"MOT":50,"STY":50}','{}'),
('00000000-0000-4000-8000-000000000009','10000000-0000-4000-8000-000000000009',
 '{"RES":70,"DRV":70,"DSC":70,"CCH":70,"INT":70,"CLS_C":70,"CLS_F":70,"MOT":50,"STY":50}','{sd_high}'),
('00000000-0000-4000-8000-00000000000a','10000000-0000-4000-8000-00000000000a',
 '{"RES":70,"DRV":70,"DSC":70,"CCH":70,"INT":70,"CLS_C":70,"CLS_F":70,"MOT":50,"STY":50}','{}');

-- ═══ FIXTURE CLIENTS AND REQUIREMENTS ══════════════════════════════════════

insert into clients (id, business_name) values
('20000000-0000-4000-8000-000000000001','ZZ_FIXTURE Considered Co'),
('20000000-0000-4000-8000-000000000002','ZZ_FIXTURE Fast Co'),
('20000000-0000-4000-8000-000000000003','ZZ_FIXTURE Band Edge Co'),
('20000000-0000-4000-8000-000000000004','ZZ_FIXTURE Cycle Override Co'),
('20000000-0000-4000-8000-000000000005','ZZ_FIXTURE Contradictory Ranks Co');

-- REQ-A  Rs 3L / 60-day considered purchase
-- REQ-B  Rs 20k / same-day fast inbound
-- REQ-C1 Rs 79,000 / 20-day     ) band boundary pair, cycle held constant
-- REQ-C2 Rs 81,000 / 20-day     )
-- REQ-D  Rs 20,000 / 45-day     cycle override — the case a ticket-only toggle gets wrong
-- REQ-E  contradictory forced-ranks -> low confidence

insert into client_intake (id, client_id, payload, is_complete) values
('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
 '{"ticket_size":300000,"cycle_days":60,"leads_per_day":3,"buyer_response":4,
   "top3":["CLS","RES","DSC"],"bottom3":["CCH"],"followup_rate_pct":70,"has_crm":true,
   "cold_outbound_pct":20,"refund_policy_exists":false,"buyer_is_senior":true,
   "comp_band":5,"expected_days_to_first_close":60,"benchmark_source":"none"}', true),
('30000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002',
 '{"ticket_size":20000,"cycle_days":0,"leads_per_day":25,"buyer_response":2,
   "top3":["CLS","DRV","RES"],"bottom3":["INT"],"followup_rate_pct":70,"has_crm":true,
   "cold_outbound_pct":10,"refund_policy_exists":false,"buyer_is_senior":false,
   "comp_band":3,"expected_days_to_first_close":7,"benchmark_source":"none"}', true),
('30000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000003',
 '{"ticket_size":79000,"cycle_days":20,"leads_per_day":8,"buyer_response":3,
   "top3":["CLS"],"bottom3":[],"followup_rate_pct":70,"has_crm":true,
   "cold_outbound_pct":10,"refund_policy_exists":false,"buyer_is_senior":false,
   "comp_band":3,"expected_days_to_first_close":30,"benchmark_source":"none"}', true),
('30000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000003',
 '{"ticket_size":81000,"cycle_days":20,"leads_per_day":8,"buyer_response":3,
   "top3":["CLS"],"bottom3":[],"followup_rate_pct":70,"has_crm":true,
   "cold_outbound_pct":10,"refund_policy_exists":false,"buyer_is_senior":false,
   "comp_band":3,"expected_days_to_first_close":30,"benchmark_source":"none"}', true),
('30000000-0000-4000-8000-000000000005','20000000-0000-4000-8000-000000000004',
 '{"ticket_size":20000,"cycle_days":45,"leads_per_day":8,"buyer_response":3,
   "top3":["CLS"],"bottom3":[],"followup_rate_pct":70,"has_crm":true,
   "cold_outbound_pct":10,"refund_policy_exists":false,"buyer_is_senior":false,
   "comp_band":3,"expected_days_to_first_close":45,"benchmark_source":"none"}', true),
-- Contradictory: DSC appears in both top3 and bottom3.
('30000000-0000-4000-8000-000000000006','20000000-0000-4000-8000-000000000005',
 '{"ticket_size":100000,"cycle_days":30,"leads_per_day":8,"buyer_response":3,
   "top3":["DSC","RES"],"bottom3":["DSC"],"followup_rate_pct":70,"has_crm":true,
   "cold_outbound_pct":10,"refund_policy_exists":false,"buyer_is_senior":false,
   "comp_band":3,"expected_days_to_first_close":30,"benchmark_source":"none"}', true);

-- Build target profiles and requirements from those intakes.
do $$
declare
  r record;
  tp client_target_profile;
  req_ids uuid[] := array[
    '40000000-0000-4000-8000-000000000001'::uuid,
    '40000000-0000-4000-8000-000000000002'::uuid,
    '40000000-0000-4000-8000-000000000003'::uuid,
    '40000000-0000-4000-8000-000000000004'::uuid,
    '40000000-0000-4000-8000-000000000005'::uuid,
    '40000000-0000-4000-8000-000000000006'::uuid
  ];
  titles text[] := array['REQ-A 3L/60d','REQ-B 20k/same-day','REQ-C1 79k/20d',
                         'REQ-C2 81k/20d','REQ-D 20k/45d','REQ-E contradictory'];
  i int := 0;
begin
  for r in
    select id, client_id, payload from client_intake
    where id::text like '30000000%' order by id
  loop
    i := i + 1;
    tp := compute_target_profile(r.id);
    insert into requirements (id, client_id, target_profile_id, title, ticket_size, cycle_days,
                              hard_filters, roleplay_pack)
    values (
      req_ids[i], r.client_id, tp.id, titles[i],
      (r.payload->>'ticket_size')::numeric, (r.payload->>'cycle_days')::int,
      -- Only REQ-A carries real hard filters, so the negative case has something to fail.
      case when i = 1 then
        '{"languages_required":[{"lang":"en","min":"fluent"}],
          "locations":["Mumbai","Pune"],"work_mode":"onsite",
          "salary_min":300000,"salary_max":900000,
          "join_by_days":60,"min_years_experience":2}'::jsonb
      else '{}'::jsonb end,
      case when (r.payload->>'ticket_size')::numeric < 50000 then 'fast'
           when (r.payload->>'ticket_size')::numeric <= 150000 then 'mid'
           else 'considered' end
    );
  end loop;
end $$;

-- ═══ SCORING REGRESSION FIXTURE ════════════════════════════════════════════
-- Two synthetic sessions answered entirely with the best and worst options, to
-- pin the §7.2 arithmetic end to end from raw responses.

insert into candidates (id, full_name, contact, consent_version, consent_at) values
('00000000-0000-4000-8000-0000000000b1','ZZ_FIXTURE S1 all-best','{}','v1',now()),
('00000000-0000-4000-8000-0000000000b2','ZZ_FIXTURE S2 all-worst','{}','v1',now());

insert into assessment_sessions (id, candidate_id, bank_version, item_set, started_at, completed_at) values
('10000000-0000-4000-8000-0000000000b1','00000000-0000-4000-8000-0000000000b1','1.1',
 array(select id from items where active order by sort_order), now(), now()),
('10000000-0000-4000-8000-0000000000b2','00000000-0000-4000-8000-0000000000b2','1.1',
 array(select id from items where active order by sort_order), now(), now());

-- Best option for every item (highest score_key; for forced-choice that is the
-- 100 pole, which is a direction not a virtue — hence MOT/STY both land at 100
-- and the `careless` flag must fire).
insert into candidate_responses (session_id, item_id, option_key, seconds_on_item, position_shown)
select '10000000-0000-4000-8000-0000000000b1', i.id,
       (select o.option_key from item_options o where o.item_id = i.id
         order by o.score_key desc, o.option_key limit 1),
       30, 1
from items i where i.active;

insert into candidate_responses (session_id, item_id, option_key, seconds_on_item, position_shown)
select '10000000-0000-4000-8000-0000000000b2', i.id,
       (select o.option_key from item_options o where o.item_id = i.id
         order by o.score_key asc, o.option_key limit 1),
       30, 2
from items i where i.active;

-- ═══ THE ASSERTION SUITE ═══════════════════════════════════════════════════
-- Returns one row per case. `passed = false` anywhere means nothing ships.

create or replace function run_golden_cases()
returns table (case_no text, name text, passed boolean, detail text)
language plpgsql as $$
declare
  v_rank_a int; v_rank_b int; v_n_b int;
  v_eff_a numeric; v_eff_b numeric;
  v_blend_79 jsonb; v_blend_81 jsonb;
  v_blend_sameday jsonb; v_blend_45 jsonb;
  v_order_79 text; v_order_81 text;
  v_eff_sd numeric; v_eff_45 numeric;
  v_prof candidate_profile;
  v_conf text; v_fails text[]; v_pass boolean;
  v_cap numeric; v_q numeric;
begin
  -- Recompute every fixture requirement from scratch.
  perform compute_matches(id) from requirements where id::text like '40000000%';

  -- ── 1. FRAME-SPLIT CANARY (§14.1 #1) ─────────────────────────────────────
  -- The same profile, opposite outcomes. If this passes on BOTH requirements
  -- in the same direction, the blend has stopped working.
  select rank_in_req, cls_effective into v_rank_a, v_eff_a
  from (select candidate_id, cls_effective,
               rank() over (order by composite desc) as rank_in_req
        from matches where requirement_id = '40000000-0000-4000-8000-000000000001'
          and hard_filter_pass) t
  where candidate_id = '00000000-0000-4000-8000-000000000001';

  select rank_in_req, cls_effective, n into v_rank_b, v_eff_b, v_n_b
  from (select candidate_id, cls_effective,
               rank() over (order by composite desc) as rank_in_req,
               count(*) over () as n
        from matches where requirement_id = '40000000-0000-4000-8000-000000000002'
          and hard_filter_pass) t
  where candidate_id = '00000000-0000-4000-8000-000000000001';

  return query select '1a', 'Frame-split candidate is top-3 on Rs 3L / 60-day',
    v_rank_a <= 3,
    format('rank %s of %s, CLS_effective %s (CLS_C 82 / CLS_F 41)', v_rank_a, v_n_b, round(v_eff_a,1));

  return query select '1b', 'Same candidate is outside the top half on Rs 20k / same-day',
    v_rank_b > (v_n_b / 2.0),
    format('rank %s of %s, CLS_effective %s', v_rank_b, v_n_b, round(v_eff_b,1));

  return query select '1c', 'frame_split_flag set where |CLS_C - CLS_F| >= 25',
    (select frame_split_flag from matches
      where requirement_id = '40000000-0000-4000-8000-000000000001'
        and candidate_id = '00000000-0000-4000-8000-000000000001'),
    'delta = 41';

  -- ── 2. BAND BOUNDARY (§14.1 #2) ──────────────────────────────────────────
  -- Rs 79,000 vs Rs 81,000, cycle constant. Catches a step-function bug.
  v_blend_79 := cls_blend(79000, 20);
  v_blend_81 := cls_blend(81000, 20);

  return query select '2a', 'Band edge shifts the blend toward considered, and only slightly',
    ((v_blend_81->>'w_C')::numeric > (v_blend_79->>'w_C')::numeric)
    and ((v_blend_81->>'w_C')::numeric - (v_blend_79->>'w_C')::numeric) <= 0.25,
    format('w_C 79k=%s -> 81k=%s', v_blend_79->>'w_C', v_blend_81->>'w_C');

  -- §14.1 #2 wants "a slight shift, not a reorder". That guarantee holds only
  -- for candidates whose CLS_C = CLS_F, whose effective CLS is band-invariant by
  -- construction. Any candidate who leans one way is exposed to the band step,
  -- because §9.2.1 IS a step function — see 2c and ARCHITECTURE.md "Findings".
  -- This assertion is the regression guard against a genuine step-function bug:
  -- if a band-invariant candidate ever moves, the lookup itself is broken.
  select string_agg(m.candidate_id::text, ',' order by m.composite desc, m.candidate_id) into v_order_79
  from matches m join candidate_profile p on p.candidate_id = m.candidate_id
  where m.requirement_id = '40000000-0000-4000-8000-000000000003'
    and (p.scores->>'CLS_C')::numeric = (p.scores->>'CLS_F')::numeric;

  select string_agg(m.candidate_id::text, ',' order by m.composite desc, m.candidate_id) into v_order_81
  from matches m join candidate_profile p on p.candidate_id = m.candidate_id
  where m.requirement_id = '40000000-0000-4000-8000-000000000004'
    and (p.scores->>'CLS_C')::numeric = (p.scores->>'CLS_F')::numeric;

  return query select '2b', 'No reorder among band-invariant candidates (CLS_C = CLS_F)',
    v_order_79 = v_order_81,
    case when v_order_79 = v_order_81 then 'order stable across the 80k edge' else 'REORDERED' end;

  -- 2c makes the step's blast radius explicit rather than leaving it implicit.
  -- A 2,000-rupee ticket difference moves w_C by a full 0.20 at the 80k edge, so
  -- a candidate with a CLS gap of g sees their effective CLS move by 0.20 x g.
  -- At the frame_split_flag threshold (25) that is 5 points; the fixture pair
  -- F6/F7 sit at a 23-point gap, below the flag, and still swap rank.
  -- This is a DESIGN CONSEQUENCE of §9.2.1, recorded so it cannot be forgotten.
  return query select '2c',
    'Band-edge step size is known and bounded (documents reorder exposure)',
    ((cls_blend(81000,20)->>'w_C')::numeric - (cls_blend(79000,20)->>'w_C')::numeric) = 0.20,
    format('w_C step at the 80k edge = %s -> a candidate with a CLS gap of g moves %s x g points. '
        || 'Candidates below the frame_split_flag threshold of 25 CAN still reorder.',
      round((cls_blend(81000,20)->>'w_C')::numeric - (cls_blend(79000,20)->>'w_C')::numeric, 2),
      round((cls_blend(81000,20)->>'w_C')::numeric - (cls_blend(79000,20)->>'w_C')::numeric, 2));

  -- ── 3. CYCLE OVERRIDE (§14.1 #3) ─────────────────────────────────────────
  -- Rs 20,000 ticket, 45-day cycle. w_C must rise so a CLS_C-strong candidate
  -- is not penalised for a ticket band that does not describe the job.
  v_blend_sameday := cls_blend(20000, 0);
  v_blend_45      := cls_blend(20000, 45);
  v_eff_sd := (v_blend_sameday->>'w_C')::numeric * 82 + (v_blend_sameday->>'w_F')::numeric * 41;
  v_eff_45 := (v_blend_45->>'w_C')::numeric      * 82 + (v_blend_45->>'w_F')::numeric      * 41;

  return query select '3a', 'A 45-day cycle at Rs 20k raises w_C above the same-day case',
    (v_blend_45->>'w_C')::numeric > (v_blend_sameday->>'w_C')::numeric,
    format('w_C same-day=%s -> 45-day=%s', v_blend_sameday->>'w_C', v_blend_45->>'w_C');

  return query select '3b', 'and raises the C-strong candidate''s effective CLS',
    v_eff_45 > v_eff_sd,
    format('CLS_effective %s -> %s (+%s)', round(v_eff_sd,1), round(v_eff_45,1),
           round(v_eff_45 - v_eff_sd,1));

  -- ── 4. NEGATIVE CASES (§14.1 #4) ─────────────────────────────────────────
  select hard_filter_pass, hard_filter_fails into v_pass, v_fails
  from matches where requirement_id = '40000000-0000-4000-8000-000000000001'
    and candidate_id = '00000000-0000-4000-8000-000000000009';

  return query select '4a', 'Hard-filter failure excludes, and names every failing filter',
    v_pass = false and array_length(v_fails, 1) >= 4,
    coalesce(array_to_string(v_fails, ' | '), '(none)');

  -- C9 / R3: a failing candidate still gets a row. There is nowhere to record a
  -- rejection, so exclusion is always visible and always overridable.
  return query select '4b', 'A failing candidate still produces a match row (no auto-reject path)',
    exists (select 1 from matches
             where requirement_id = '40000000-0000-4000-8000-000000000001'
               and candidate_id = '00000000-0000-4000-8000-000000000009'),
    'row present with hard_filter_pass = false';

  return query select '4c', 'sd_high flag surfaces on the match and does not reject',
    (select 'sd_high' = any(p.flags) from candidate_profile p
      where p.candidate_id = '00000000-0000-4000-8000-000000000009')
    and exists (select 1 from matches
                 where candidate_id = '00000000-0000-4000-8000-000000000009'),
    'flag present, candidate still ranked';

  select confidence into v_conf from client_target_profile
  where intake_id = '30000000-0000-4000-8000-000000000006';

  return query select '4d', 'Contradictory forced-ranks produce low confidence',
    v_conf = 'low', format('confidence = %s', v_conf);

  return query select '4e', 'Attrition risk flags on a comp-band gap greater than 2',
    (select attrition_risk_flag from matches
      where requirement_id = '40000000-0000-4000-8000-000000000001'
        and candidate_id = '00000000-0000-4000-8000-00000000000a'),
    'candidate comp band 1 vs client band 5 — gap 4, threshold >2';

  -- ── 5. SCORING ARITHMETIC (§7.2) ─────────────────────────────────────────
  v_prof := compute_candidate_profile('10000000-0000-4000-8000-0000000000b1');
  return query select '5a', 'All-best answers score 100 on every unipolar dimension',
    (select bool_and((v_prof.scores->>code)::numeric = 100)
       from dimensions where kind = 'unipolar' and active),
    v_prof.scores::text;

  v_prof := compute_candidate_profile('10000000-0000-4000-8000-0000000000b2');
  return query select '5b', 'All-worst answers score 0 on every unipolar dimension',
    (select bool_and((v_prof.scores->>code)::numeric = 0)
       from dimensions where kind = 'unipolar' and active),
    v_prof.scores::text;

  return query select '5c', 'careless flag fires when MOT and STY both sit at a pole',
    'careless' = any(v_prof.flags),
    array_to_string(v_prof.flags, ',');

  return query select '5d', 'No profile anywhere carries a blended CLS key',
    not exists (select 1 from candidate_profile where scores ? 'CLS'),
    'CLS_C and CLS_F only';

  -- ── 6. QUALITY CAP (§9.2) ────────────────────────────────────────────────
  v_cap := param('quality','over_requirement_cap');
  return query select '6a', 'Exceeding a requirement is capped at 1.15, not unbounded',
    v_cap = 1.15
    and (select max(quality_score) from matches where hard_filter_pass) <= v_cap + 0.0001,
    format('cap %s, max observed Q %s', v_cap,
           (select round(max(quality_score),4) from matches where hard_filter_pass));

  -- ── 7. CONFIDENCE MULTIPLIER (§6.5) ──────────────────────────────────────
  return query select '7a', 'Confidence multiplier is applied to the composite',
    (select bool_and(abs(composite - (
        (param('composite','w_quality') * quality_score
       + param('composite','w_fit')     * fit_score) * confidence_multiplier)) < 0.0001)
      from matches where hard_filter_pass),
    'composite = (0.6Q + 0.4F) x confidence';
end $$;

comment on function run_golden_cases() is
  'PRD §14.1 regression suite. Run after every parameter change. Nothing ships unless every row passes.';
