-- ═══════════════════════════════════════════════════════════════════════════
-- The last two surfaces: §13 blind re-keying, and Step 4 the verification call.
-- Plus a bug fix: golden-case fixtures were showing in the live console.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── BUG FIX ────────────────────────────────────────────────────────────────
-- v_candidate_queue filtered ZZ_FIXTURE rows; v_requirements did not, so seven
-- test requirements appeared in the real console. Fixtures must never be
-- visible in an operational view — a recruiter cannot tell them apart.
create or replace view v_requirements as
select r.id, r.title, r.status, r.ticket_size, r.cycle_days, r.roleplay_pack, r.opened_at,
       c.business_name, c.id as client_id,
       tp.confidence, tp.benchmark_source, tp.required_levels, tp.bipolar_targets,
       tp.cls_blend, tp.benchmark_conflicts,
       (select count(*) from matches m where m.requirement_id = r.id and m.hard_filter_pass) as eligible,
       (select count(*) from matches m where m.requirement_id = r.id) as assessed,
       (select round(max(m.composite) * 100, 1) from matches m
          where m.requirement_id = r.id and m.hard_filter_pass) as best_pct
from requirements r
join clients c on c.id = r.client_id
left join client_target_profile tp on tp.id = r.target_profile_id
where c.business_name not like 'ZZ_FIXTURE%';

create or replace view v_console_clean as
select * from v_console
where full_name not like 'ZZ_FIXTURE%' and full_name not like 'ZZ_E2E%';

grant select on v_console_clean to authenticated;

-- ═══ §13 BLIND RE-KEYING ═══════════════════════════════════════════════════
-- Three experts key all 28 SJT items independently, WITHOUT seeing the existing
-- keys. That blindness is the entire value, so it is enforced server-side: the
-- function that serves items to a keyer does not select score_key at all.

create or replace function create_keying_round(p_label text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if staff_role() <> 'admin' then raise exception 'create_keying_round: admin only'; end if;
  insert into keying_rounds (label) values (p_label) returning id into v_id;
  return v_id;
end $$;

-- Items for the signed-in expert, with their own progress. No keys, ever.
create or replace function get_keying_items(p_round uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_staff uuid;
begin
  select id into v_staff from staff where auth_uid = auth.uid() and active;
  if v_staff is null then raise exception 'get_keying_items: staff only'; end if;

  return jsonb_build_object(
    'round', (select label from keying_rounds where id = p_round),
    'expert_id', v_staff,
    'items', (
      select coalesce(jsonb_agg(x order by (x->>'sort_order')::int), '[]'::jsonb) from (
        select jsonb_build_object(
          'id', i.id, 'stem', i.stem, 'framing_note', i.framing_note,
          'sort_order', i.sort_order,
          -- score_key is deliberately absent from this projection.
          'options', (select jsonb_agg(jsonb_build_object('key', o.option_key, 'text', o.option_text)
                                       order by o.option_key)
                      from item_options o where o.item_id = i.id),
          'mine', (select jsonb_build_object('best', k.best_option_key, 'worst', k.worst_option_key,
                                             'note', k.note)
                   from keying_submissions k
                   where k.round_id = p_round and k.expert_id = v_staff and k.item_id = i.id)
        ) as x
        from items i where i.active and i.format = 'sjt'
      ) t)
  );
end $$;

create or replace function save_keying(p_round uuid, p_item text, p_best text,
                                       p_worst text default null, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_staff uuid;
begin
  select id into v_staff from staff where auth_uid = auth.uid() and active;
  if v_staff is null then raise exception 'save_keying: staff only'; end if;
  if not exists (select 1 from keying_rounds where id = p_round and open) then
    raise exception 'This keying round is closed.';
  end if;

  insert into keying_submissions (round_id, expert_id, item_id, best_option_key, worst_option_key, note)
  values (p_round, v_staff, p_item, p_best, p_worst, p_note)
  on conflict (round_id, expert_id, item_id) do update set
    best_option_key = excluded.best_option_key,
    worst_option_key = excluded.worst_option_key,
    note = excluded.note, submitted_at = now();
end $$;

grant execute on function create_keying_round(text)                       to authenticated;
grant execute on function get_keying_items(uuid)                          to authenticated;
grant execute on function save_keying(uuid, text, text, text, text)       to authenticated;
grant select on keying_rounds, v_keying_agreement to authenticated;

-- ═══ STEP 4 — THE VERIFICATION CALL ════════════════════════════════════════
-- Playbook §5: the engine selects five probes — two verification (the two
-- highest unipolar scores), two concern (the two furthest below requirement),
-- one flag probe. Template lookup on score deltas, no AI.

create table if not exists probe_templates (
  dimension_code text references dimensions(code),
  probe_type     text check (probe_type in ('verify','concern','flag')),
  probe          text not null,
  follow_up      text,
  listening_for  text,
  primary key (dimension_code, probe_type)
);

alter table probe_templates enable row level security;
alter table probe_templates force row level security;
drop policy if exists probe_templates_staff on probe_templates;
create policy probe_templates_staff on probe_templates for select to authenticated using (is_staff());

delete from probe_templates;
insert into probe_templates (dimension_code, probe_type, probe, follow_up, listening_for) values
-- §5.1 verification probes. Every one has a MANDATORY follow-up, because the
-- follow-up is where inflation collapses.
('RES','verify','Tell me about the worst week you''ve had in sales. Take me day by day.',
 'What were your call numbers on each of those days?', null),
('DRV','verify','What number did you personally aim for last quarter, and where did it come from?',
 'What did you do in the final week of a month you''d already hit?', null),
('DSC','verify','Describe exactly how you tracked your pipeline. What columns, what cadence?',
 'Tell me about a lead you revived after a long gap. How did you know to call that day?', null),
('CLS_C','verify','Tell me about the largest deal you''ve closed. What was the moment it turned?',
 'When did you last hold your price under real pressure, and what did the prospect do?', null),
('CLS_F','verify','What''s the shortest sales cycle you''ve worked? Walk me through a typical close.',
 'How many of those did you close on the first call, out of ten?', null),
('CCH','verify','What''s the most recent thing a manager told you to change?',
 'What changed in your numbers after you did it?', null),
('INT','verify','Tell me about a deal you walked away from.',
 'What did that cost you that month, and what did your manager say?', null),
-- §5.2 concern probes. Not to catch them out — to establish whether the gap is
-- real and whether it matters in this role.
('RES','concern','When you hit a run of no''s, what actually happens to your day?', null,
 'Whether activity drops, and whether he knows it drops'),
('DRV','concern','What made you leave your last role?', null, 'Ambition or comfort'),
('DSC','concern','This client has no CRM and leads arrive on WhatsApp. What would your first two weeks look like?',
 null, 'Builds a system unprompted, or waits to be given one'),
('CLS_C','concern','When have you had to sell to someone senior to you? How did that go?', null,
 'Deference, over-explaining, seeking approval mid-pitch'),
('CLS_F','concern','How do you handle a prospect who wants to think about it on a low-ticket call?',
 null, 'Any tool other than "follow up later"'),
('CCH','concern','Tell me about feedback you disagreed with. What did you do?', null,
 'Whether disagreement ends in testing or ignoring'),
('INT','concern','Have you ever been asked to sell something you weren''t sure about?', null,
 'Whether he noticed the question at all');

-- MOT and STY get no probe. Fit dimensions, not deficits — a mismatch is
-- discussed with the recruiter, never framed to the candidate as a weakness.

create table if not exists flag_probes (
  flag  text primary key,
  probe text not null,
  reading text not null
);
alter table flag_probes enable row level security;
alter table flag_probes force row level security;
drop policy if exists flag_probes_staff on flag_probes;
create policy flag_probes_staff on flag_probes for select to authenticated using (is_staff());

delete from flag_probes;
insert into flag_probes (flag, probe, reading) values
('sd_high','Which part of selling are you genuinely worst at?',
 'Cannot name one confirms the flag. Specific, unflattering and credible clears it.'),
('fast_completion','How long did the assessment take you? What did you think of it?',
 'Whether he engaged with it at all.'),
('straightline','How did you find the format of the assessment?',
 'Whether the pattern was disengagement or a genuine reading of each item.'),
('careless','Talk me through how you decided on the either/or questions.',
 'Whether the extremes were considered answers or a rush to finish.');

-- Role-play packs, playbook §4. Band-matched, three scripted objections in a
-- FIXED order — improvising destroys comparability between candidates.
create table if not exists roleplay_packs (
  pack       text primary key check (pack in ('fast','mid','considered')),
  label      text not null,
  offer      text not null,
  buyer      text not null,
  motion     text not null,
  objections jsonb not null,
  watch_for  jsonb not null
);
alter table roleplay_packs enable row level security;
alter table roleplay_packs force row level security;
drop policy if exists roleplay_packs_staff on roleplay_packs;
create policy roleplay_packs_staff on roleplay_packs for select to authenticated using (is_staff());

delete from roleplay_packs;
insert into roleplay_packs (pack, label, offer, buyer, motion, objections, watch_for) values
('fast','Pack 1 — Fast close (under ₹50,000)',
 '₹24,000, three-month online upskilling programme, weekly live sessions, placement support.',
 '27, mid-size IT services firm, ₹6.5L/year, enquired via an Instagram ad two days ago, hasn''t spoken to anyone yet.',
 'Inbound, warm, one-call close expected. Genuinely interested but not yet convinced.',
 '[{"at":"~min 5","line":"Actually I''ve been seeing a lot of these. What makes yours different?"},
   {"at":"~min 10","line":"₹24,000 is more than I was expecting. Is there a discount?"},
   {"at":"~min 15","line":"Let me talk to my wife and get back to you tomorrow."}]',
 '["Does he ask anything before pitching",
   "Holds price on #2 or reaches for a discount",
   "On #3, resolves on the call or accepts the deferral",
   "Asks for the close at all"]'),
('mid','Pack 2 — Mid-market (₹50,000 – ₹1,50,000)',
 '₹95,000, six-month done-with-you programme, fortnightly 1:1s plus a peer group.',
 '34, two-year-old D2C brand doing roughly ₹8L a month, attended a webinar last week, second conversation.',
 'Two-to-three touches, moderate consideration.',
 '[{"at":"~min 5","line":"I looked at your website — how is this different from just hiring a consultant?"},
   {"at":"~min 10","line":"My cash flow is tight for the next two months. Can we start in October?"},
   {"at":"~min 15","line":"I was burned by a similar programme last year. How do I know this won''t be the same?"}]',
 '["Diagnoses the business before positioning",
   "Treats #2 as a real constraint or a brush-off — it IS real, reward whoever tests it rather than assuming",
   "Whether #3 gets defensiveness or curiosity"]'),
('considered','Pack 3 — Considered purchase (above ₹1,50,000)',
 '₹3,20,000, twelve-month advisory engagement, monthly strategy sessions, quarterly on-site.',
 '48, owns a manufacturing business, ₹40Cr turnover, referred by an existing client, third conversation, has seen the proposal.',
 'Long cycle, high status gap, close attempt expected this call.',
 '[{"at":"~min 5","line":"Walk me through what I''m actually paying for. Three lakhs is a real number."},
   {"at":"~min 11","line":"I''ll need to run this past my brother — he handles the finance side."},
   {"at":"~min 16","line":"Send me a revised proposal with a payment plan and I''ll look at it."}]',
 '["Composure with a buyer older, wealthier and running a larger business — holds frame or slides into deference",
   "On #2, tries to get the brother into the conversation",
   "On #3, accepts the deferral or names it"]');

-- ── The call setup: probes chosen from the profile, WITHOUT revealing scores ──
-- This is the §11.3 gate in data form. The recruiter gets a targeted probe list
-- and the pack; the numbers stay sealed until ratings are submitted.
create or replace function get_interview_setup(p_requirement_id uuid, p_candidate_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_scores jsonb; v_flags text[]; v_req jsonb; v_blend jsonb; v_pack text;
  v_iv interviews; v_probes jsonb := '[]'::jsonb; r record;
begin
  if not is_staff() then raise exception 'get_interview_setup: staff only'; end if;

  select p.scores, p.flags into v_scores, v_flags
  from candidate_profile p where p.candidate_id = p_candidate_id
  order by p.computed_at desc limit 1;
  if v_scores is null then raise exception 'This candidate has no completed assessment yet.'; end if;

  select tp.required_levels, tp.cls_blend, r2.roleplay_pack into v_req, v_blend, v_pack
  from requirements r2 join client_target_profile tp on tp.id = r2.target_profile_id
  where r2.id = p_requirement_id;

  select * into v_iv from interviews
  where requirement_id = p_requirement_id and candidate_id = p_candidate_id;

  -- Two VERIFY probes: the two highest unipolar scores.
  for r in
    select d.code, (v_scores->>d.code)::numeric as sc
    from dimensions d where d.kind = 'unipolar' and d.active and v_scores ? d.code
    order by (v_scores->>d.code)::numeric desc limit 2
  loop
    v_probes := v_probes || (select jsonb_build_object(
      'type','verify','dimension',t.dimension_code,'probe',t.probe,
      'follow_up',t.follow_up,'listening_for',t.listening_for)
      from probe_templates t where t.dimension_code = r.code and t.probe_type = 'verify');
  end loop;

  -- Two CONCERN probes: the two furthest BELOW the requirement. CLS is compared
  -- as the blended effective value, since that is what this role actually needs.
  for r in
    select code, gap from (
      select 'RES' code, (v_scores->>'RES')::numeric - (v_req->>'RES')::numeric gap
      union all select 'DRV', (v_scores->>'DRV')::numeric - (v_req->>'DRV')::numeric
      union all select 'DSC', (v_scores->>'DSC')::numeric - (v_req->>'DSC')::numeric
      union all select 'CCH', (v_scores->>'CCH')::numeric - (v_req->>'CCH')::numeric
      union all select 'INT', (v_scores->>'INT')::numeric - (v_req->>'INT')::numeric
      union all select case when (v_blend->>'w_C')::numeric >= 0.5 then 'CLS_C' else 'CLS_F' end,
        ((v_blend->>'w_C')::numeric * (v_scores->>'CLS_C')::numeric
         + (v_blend->>'w_F')::numeric * (v_scores->>'CLS_F')::numeric) - (v_req->>'CLS')::numeric
    ) g where gap < 0 order by gap asc limit 2
  loop
    v_probes := v_probes || (select jsonb_build_object(
      'type','concern','dimension',t.dimension_code,'probe',t.probe,
      'follow_up',t.follow_up,'listening_for',t.listening_for)
      from probe_templates t where t.dimension_code = r.code and t.probe_type = 'concern');
  end loop;

  -- One FLAG probe, if any flag is set.
  v_probes := v_probes || coalesce((
    select jsonb_build_object('type','flag','dimension',null,'probe',f.probe,
                              'follow_up',null,'listening_for',f.reading,'flag',f.flag)
    from flag_probes f where f.flag = any(coalesce(v_flags, '{}')) limit 1), '{}'::jsonb);

  return jsonb_build_object(
    'interview_id', v_iv.id,
    'predicted_ratings', v_iv.predicted_ratings,
    'ratings_submitted', v_iv.ratings_submitted_at is not null,
    'scores_revealed', v_iv.scores_revealed_at is not null,
    'flags', coalesce(v_flags, '{}'),
    'pack', (select to_jsonb(rp) from roleplay_packs rp where rp.pack = v_pack),
    'probes', (select jsonb_agg(x) from jsonb_array_elements(v_probes) x where x <> '{}'::jsonb),
    'technical', (select coalesce(jsonb_agg(s.items), '[]'::jsonb) from supplements s
                  join requirements r3 on r3.client_id = s.client_id
                  where r3.id = p_requirement_id)
  );
end $$;

-- §11.3: predicted ratings are written BEFORE the call. In a one-person
-- operation independence is unrecoverable; the divergence record is what
-- survives, and it only exists if this is written first.
create or replace function save_predicted_ratings(p_requirement_id uuid, p_candidate_id uuid, p_predicted jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_staff uuid; v_pack text;
begin
  if not is_staff() then raise exception 'save_predicted_ratings: staff only'; end if;
  select id into v_staff from staff where auth_uid = auth.uid();
  select roleplay_pack into v_pack from requirements where id = p_requirement_id;

  select id into v_id from interviews
  where requirement_id = p_requirement_id and candidate_id = p_candidate_id;

  if v_id is null then
    insert into interviews (requirement_id, candidate_id, interviewer_id, roleplay_pack, predicted_ratings)
    values (p_requirement_id, p_candidate_id, v_staff, v_pack, p_predicted) returning id into v_id;
  else
    if (select ratings_submitted_at from interviews where id = v_id) is not null then
      raise exception 'Actual ratings are already submitted — predictions can no longer be changed.';
    end if;
    update interviews set predicted_ratings = p_predicted, interviewer_id = v_staff where id = v_id;
  end if;
  return v_id;
end $$;

create or replace function submit_interview(
  p_interview_id uuid, p_ratings jsonb, p_technical jsonb, p_probes jsonb, p_consent boolean
) returns void language plpgsql security definer set search_path = public as $$
declare k text;
begin
  if not is_staff() then raise exception 'submit_interview: staff only'; end if;

  delete from interview_ratings where interview_id = p_interview_id;
  for k in select jsonb_object_keys(p_ratings) loop
    insert into interview_ratings (interview_id, element, rating, note)
    values (p_interview_id, k, (p_ratings->k->>'rating')::int, p_ratings->k->>'note');
  end loop;

  delete from interview_technical where interview_id = p_interview_id;
  for k in select jsonb_object_keys(p_technical) loop
    insert into interview_technical (interview_id, element, rating, note)
    values (p_interview_id, k, (p_technical->k->>'rating')::int, p_technical->k->>'note');
  end loop;

  delete from interview_probes where interview_id = p_interview_id;
  for k in select jsonb_object_keys(p_probes) loop
    insert into interview_probes (interview_id, dimension_code, probe_type, outcome, note)
    values (p_interview_id, nullif(split_part(k, '|', 1), ''), split_part(k, '|', 2),
            p_probes->k->>'outcome', p_probes->k->>'note')
    on conflict do nothing;
  end loop;

  update interviews
  set ratings_submitted_at = now(), consent_to_record = p_consent
  where id = p_interview_id;
end $$;

-- The reveal. Enforced by the CHECK in 01 as well, so a UI bug cannot bypass it.
create or replace function reveal_scores(p_interview_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_iv interviews; v_scores jsonb;
begin
  if not is_staff() then raise exception 'reveal_scores: staff only'; end if;
  select * into v_iv from interviews where id = p_interview_id;
  if v_iv.ratings_submitted_at is null then
    raise exception 'Submit your ratings before the scores unlock (playbook §2.1).';
  end if;

  update interviews set scores_revealed_at = coalesce(scores_revealed_at, now())
  where id = p_interview_id;

  select p.scores into v_scores from candidate_profile p
  where p.candidate_id = v_iv.candidate_id order by p.computed_at desc limit 1;

  return jsonb_build_object(
    'scores', v_scores,
    'predicted', v_iv.predicted_ratings,
    'actual', (select jsonb_object_agg(element, rating) from interview_ratings
               where interview_id = p_interview_id),
    'decision', (
      -- Playbook §7 decision rule. A floor, not a decision procedure.
      select jsonb_build_object(
        'roleplay_mean', round(avg(rating), 2),
        'any_element_at_1', bool_or(rating = 1)
      ) from interview_ratings where interview_id = p_interview_id)
  );
end $$;

create or replace function log_contradiction(p_interview_id uuid, p_dimension text, p_description text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'log_contradiction: staff only'; end if;
  insert into interview_contradictions (interview_id, dimension_code, description)
  values (p_interview_id, nullif(p_dimension, ''), p_description);
end $$;

grant execute on function get_interview_setup(uuid, uuid)                        to authenticated;
grant execute on function save_predicted_ratings(uuid, uuid, jsonb)              to authenticated;
grant execute on function submit_interview(uuid, jsonb, jsonb, jsonb, boolean)   to authenticated;
grant execute on function reveal_scores(uuid)                                    to authenticated;
grant execute on function log_contradiction(uuid, text, text)                    to authenticated;
