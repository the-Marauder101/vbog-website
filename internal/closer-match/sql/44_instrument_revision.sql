-- ═══════════════════════════════════════════════════════════════════════════
-- 44 — R1 becomes eight questions, chosen from evidence; R2 loses four; and the
--      question Depesh already asks forty-eight times gets into the bank
--
-- Three changes, one migration, because they are one decision: what the two
-- rounds are for.
--
-- ── 1. R1 IS A SET OF QUESTIONS, NOT A SET OF ATTRIBUTES ──────────────────
--
-- `ask_attributes.priority` made R1 "every question on these five attributes",
-- which is 14 questions and cannot be 8. R1's job is cheap disqualification —
-- is this person worth thirty more minutes — and that does not map onto whole
-- attributes. So the flag moves to the question.
--
-- `priority` stays on the attribute and still means "surfaced first in the
-- result", which is what the scorecard uses it for. It stops meaning "in R1".
--
-- ── 2. WHICH EIGHT ───────────────────────────────────────────────────────
--
-- From two sources that agree.
--
-- **Depesh's own scoring**, by how much each attribute separates candidates
-- (population SD across every answer recorded so far):
--
--     Closing Ability           1.15      Emotional Intelligence    0.83
--     Follow-Up Discipline      1.04      Objection Handling        0.70
--     Coachability              0.99      Ownership                 0.64  ← was in R1
--     CRM Discipline            0.94      Longevity                 0.60  ← was in R1
--     Discovery & Diagnosis     0.85      Confidence Under Pressure 0.50
--
-- Two of the five attributes that made up R1 are near the bottom. Follow-Up and
-- Coachability, which discriminate better than anything except Closing, were
-- R2-only. **This is 3–5 candidates per attribute — suggestive, not settled**,
-- and it is written here so that when there are fifty the number can be checked
-- rather than the decision inherited.
--
-- **The literature**, which independently ranks coachability, drive and
-- resilience above years of experience for sales roles, and finds that asking
-- for specific quota numbers predicts better than pedigree.
--
-- The eight, and what each is there to kill:
--
--     closing-2     the exact words used to ask for money — a work sample, and
--                   the fastest disqualifier there is: they have the words or
--                   they do not
--     objection-2   the ₹45,000 role-play — live handling, not a description of
--                   handling
--     target-2      close rate, deal size, monthly revenue — specific numbers,
--                   which is where fabrication shows
--     coach-1       the feedback that stung and what they did with it
--     discovery-1   whether they can read a call in the first five minutes
--     followup-3    how many touches before a lead is dead
--     longevity-1   the last three roles and why each ended — kept not because it
--                   discriminates (it does not) but because it is a sixty-second
--                   factual check that ends a conversation cheaply
--     intent-2      why THIS role. Genuine Intent has the second-lowest mean in
--                   the whole bank: most candidates fail it, which is exactly
--                   what a screen is for
--
-- Nothing here is permanent. The Questions screen (sql/42) toggles any of it in
-- a click, which is the point of having built it.
--
-- ── 3. THE OBJECTIONS QUESTION ───────────────────────────────────────────
--
-- Depesh asks "walk me through the top five objections you've received and
-- handled" in **forty-eight of ninety recorded interviews**, in forty-eight
-- different phrasings, and it is not in the bank. So it is asked inconsistently,
-- scored nowhere, and cannot be compared between candidates — which is the exact
-- problem ASK exists to solve.
--
-- Its anchors are written from the real answers in those transcripts, not
-- invented. The separation is stark and it is not about how many objections they
-- name: it is whether they name what the buyer actually SAID, and whether each
-- one comes with a move rather than a slogan. The weakest answers confuse an
-- objection with a rejection ("not interested", "they didn't pick up"); the
-- strongest give the buyer's own words, the move, and what it changed.
--
-- ── 4. FOUR QUESTIONS OUT ────────────────────────────────────────────────
--
-- At the measured 70 s per question (§7an), 40 questions is 47 minutes. Cutting
-- the four lowest-discrimination questions that overlap something else lands a
-- no-R1 R2 at 37 — inside the 35–38 asked for — and an R2 after an R1 at 29,
-- about 34 minutes.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Per-question R1 ────────────────────────────────────────────────────
alter table ask_questions
  add column if not exists in_r1 boolean not null default false;

comment on column ask_questions.in_r1 is
  'Asked on the R1 phone screen. Replaces ask_attributes.priority as the R1 '
  'definition: R1 is a set of questions chosen to disqualify cheaply, not every '
  'question on a set of attributes. `priority` still orders the result display.';

-- Seed it from the eight, and from nothing else.
update ask_questions set in_r1 = false;
update ask_questions set in_r1 = true
where id in ('closing-2', 'objection-2', 'target-2', 'coach-1',
             'discovery-1', 'followup-3', 'longevity-1', 'intent-2');

-- ── 2. The objections question ────────────────────────────────────────────
insert into ask_questions (id, attribute_id, prompt, hint, is_reference, sort_order, active)
values (
  'objection-4', 'objection',
  'Walk me through the top five objections you have received and handled — the '
  'words the buyer actually used, and what you said back to each one.',
  'Listen for the buyer''s words, not categories. "Price" is a category; "your '
  'programme is too expensive, I can get this for half elsewhere" is an objection. '
  'Then listen for a MOVE against each — a question back, a reframe, evidence, a '
  'trade — rather than "I convince them" or "I build trust". Watch for rejections '
  'smuggled in as objections: "not interested", "they didn''t pick up" and "wrong '
  'number" are not objections, and a candidate who offers them has not been close '
  'enough to a real one. Do not help. The silence while they count to five is '
  'itself the answer.',
  false, 4, true)
on conflict (id) do update set
  prompt = excluded.prompt, hint = excluded.hint,
  sort_order = excluded.sort_order, active = true;

insert into ask_options (question_id, score, label, description) values
  ('objection-4', 0, 'Cannot get to five',
   'Names one or two, or fills the gap with rejections rather than objections — '
   '"not interested", "they didn''t answer", "wrong number". Describes the '
   'objection and stops, with no account of what they said back. May ask you to '
   'narrow the question down before answering it.'),
  ('objection-4', 1, 'Categories, not objections',
   'Gets to three or four, all at category level — price, time, trust, "need to '
   'ask my husband". The handling is a slogan rather than a move: "I convince '
   'them", "I build rapport", "I explain the value". Nothing that could be '
   'repeated by somebody else on Monday.'),
  ('objection-4', 2, 'Five, in the buyer''s words, with a move on most',
   'Names five distinct objections roughly as a buyer would say them, and pairs '
   'most of them with something specific they actually did — a question back, a '
   'reframe, a piece of evidence, a concession traded for a commitment. May be '
   'thin on one or two.'),
  ('objection-4', 3, 'Five with moves, and knows which one beats them',
   'Five in the buyer''s own words, each with the move and what it changed. Can '
   'say which objection they lose most deals to and what they have changed about '
   'handling it — which means they have been counting. Distinguishes the stated '
   'objection from the real one at least once without being prompted.')
on conflict (question_id, score) do update set
  label = excluded.label, description = excluded.description;

-- ── 3. Four out ───────────────────────────────────────────────────────────
-- Each is the lowest-discrimination question on its attribute AND overlaps
-- something that stays. Deactivated, not deleted: past answers keep their rows,
-- and putting one back is a click on the Questions screen.
update ask_questions set active = false where id in (
  'pressure-3',   -- "prospect goes cold mid-call" — covered by eq-3 and objection-1
  'dialing-3',    -- "12 rejections in a row" — covered by pressure-2 on resilience
  'target-3',     -- "how do you know on the 5th" — covered by target-1
  'intent-3'      -- "what do you want to know about this role" — a good closing
                  -- question for the call, but it is not a competency and it was
                  -- being scored as one
);

-- ── 4. get_ask_bank serves R1 from the question flag ──────────────────────
create or replace function get_ask_bank(p_round text default 'r2')
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'get_ask_bank: staff only'; end if;
  if p_round not in ('r1', 'r2') then raise exception 'Round must be r1 or r2.'; end if;

  return jsonb_build_object(
    'round', p_round,
    'bank_revision', (select bank_revision from ask_bank_meta),
    'sections', jsonb_build_object(
      'sell', 'Can they actually sell?',
      'sustain', 'Can they sustain it?',
      'who', 'Who are they underneath?'),
    'attributes', coalesce((
      select jsonb_agg(x order by x->>'sort') from (
        select jsonb_build_object(
          'id', a.id, 'section', a.section, 'name', a.name, 'priority', a.priority,
          'sort', lpad(a.sort_order::text, 3, '0'),
          'skills', a.skills, 'knowledge', a.knowledge,
          'questions', (
            select coalesce(jsonb_agg(jsonb_build_object(
              'id', q.id, 'prompt', q.prompt, 'hint', q.hint,
              'is_reference', q.is_reference, 'in_r1', q.in_r1,
              'options', (
                select jsonb_agg(jsonb_build_object(
                  'score', o.score, 'label', o.label, 'description', o.description)
                  order by o.score)
                from ask_options o where o.question_id = q.id))
              order by q.sort_order), '[]'::jsonb)
            from ask_questions q
            where q.attribute_id = a.id and q.active
              -- The one line this whole change is about.
              and (p_round = 'r2' or q.in_r1))) as x
        from ask_attributes a
        where a.active
          and exists (select 1 from ask_questions q2
                      where q2.attribute_id = a.id and q2.active
                        and (p_round = 'r2' or q2.in_r1))) t), '[]'::jsonb));
end $$;

-- ── 5. Everything that decided scope by `a.priority` now uses `q.in_r1` ───
-- submit_ask, recompute_ask_totals, score_ask_reference, get_ask_references and
-- start_ask each carried `(round = 'r2' or a.priority)`. Leaving any one of them
-- on the old rule would mean a scorecard whose total disagreed with the questions
-- it asked, which is the §7ab failure in its most expensive form.
do $$
declare r record; v_src text; v_new text; v_n int := 0;
begin
  for r in
    select p.oid, p.proname from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('submit_ask', 'recompute_ask_totals', 'score_ask_reference',
                        'get_ask_references', 'start_ask', 'get_candidate_ask',
                        'get_ask_scorecard')
  loop
    v_src := pg_get_functiondef(r.oid);
    v_new := v_src;
    v_new := replace(v_new, '(v_round = ''r2'' or a.priority)', '(v_round = ''r2'' or q.in_r1)');
    v_new := replace(v_new, '(v_card.round = ''r2'' or a.priority)', '(v_card.round = ''r2'' or q.in_r1)');
    v_new := replace(v_new, '(sc.round = ''r2'' or a.priority)', '(sc.round = ''r2'' or q.in_r1)');
    v_new := replace(v_new, '(c.round = ''r2'' or at2.priority)', '(c.round = ''r2'' or q.in_r1)');
    v_new := replace(v_new, '(c.round = ''r2'' or a.priority)', '(c.round = ''r2'' or q.in_r1)');
    v_new := replace(v_new, '(p_round = ''r2'' or a.priority)', '(p_round = ''r2'' or q.in_r1)');
    if v_new <> v_src then
      execute v_new;
      v_n := v_n + 1;
    end if;
  end loop;
  raise notice 'sql/44: % functions moved from attribute-priority to question-level R1', v_n;
end $$;

-- start_ask carried R1 forward filtered on `a.priority`, which is now the wrong
-- rule twice over: it would carry questions R1 never asked, and miss ones it did.
-- The right rule is simply "whatever the R1 actually scored".
do $$
declare v_src text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_src from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'start_ask';

  v_new := replace(v_src,
    'where s.scorecard_id = v_r1 and a.priority and q.active and a.active',
    -- Everything the R1 scored, because that is exactly what must not be asked
    -- again. No second opinion about which questions R1 was supposed to cover.
    'where s.scorecard_id = v_r1 and q.active and a.active');

  if v_new = v_src then
    raise warning 'start_ask carry-forward filter not found — check it by hand';
  else
    execute v_new;
  end if;
end $$;

-- ── 6. The editor toggles a question in and out of R1 ─────────────────────
create or replace function set_ask_question_in_r1(p_id text, p_in_r1 boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_n int; v_rest int;
begin
  if staff_role() <> 'admin' then
    raise exception 'Only an admin can change what R1 asks.';
  end if;
  if not exists (select 1 from ask_questions where id = p_id) then
    raise exception 'No such question: %', p_id;
  end if;
  if (select is_reference from ask_questions where id = p_id) and p_in_r1 then
    raise exception 'A reference question is put to a previous manager, not to the '
                    'candidate on a phone screen. It cannot be in R1.';
  end if;

  update ask_questions set in_r1 = p_in_r1 where id = p_id;

  select count(*) into v_n from ask_questions q join ask_attributes a on a.id = q.attribute_id
  where q.active and a.active and q.in_r1 and not q.is_reference;

  if v_n = 0 then
    update ask_questions set in_r1 = not p_in_r1 where id = p_id;
    raise exception 'R1 would have no questions left. A screen that asks nothing '
                    'cannot screen anybody — put one back first.';
  end if;

  select count(*) into v_rest from ask_questions q join ask_attributes a on a.id = q.attribute_id
  where q.active and a.active and not q.is_reference;

  return jsonb_build_object('id', p_id, 'in_r1', p_in_r1,
    'r1_questions', v_n, 'r2_questions', v_rest,
    'r2_after_r1', v_rest - v_n,
    -- 70 seconds a question, measured in §7an and re-readable in v_ask_pacing.
    'r1_minutes', round(v_n * 70 / 60.0),
    'r2_after_r1_minutes', round((v_rest - v_n) * 70 / 60.0),
    'bank_revision', (select bank_revision from ask_bank_meta));
end $$;

revoke all on function set_ask_question_in_r1(text, boolean) from public;
grant execute on function set_ask_question_in_r1(text, boolean) to authenticated;

-- The editor payload needs the flag too.
create or replace function get_ask_editor()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'get_ask_editor: staff only'; end if;

  return jsonb_build_object(
    'bank_revision', (select bank_revision from ask_bank_meta),
    'can_edit', staff_role() = 'admin',
    'sections', jsonb_build_object(
      'sell', 'Can they actually sell?',
      'sustain', 'Can they sustain it?',
      'who', 'Who are they underneath?'),
    'attributes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'section', a.section, 'name', a.name,
        'priority', a.priority, 'active', a.active, 'sort_order', a.sort_order,
        'questions', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'id', q.id, 'prompt', q.prompt, 'hint', q.hint,
            'is_reference', q.is_reference, 'active', q.active,
            'in_r1', q.in_r1, 'sort_order', q.sort_order,
            'times_scored', (select count(*) from ask_scores s where s.question_id = q.id),
            'options', (
              select coalesce(jsonb_agg(jsonb_build_object(
                'score', o.score, 'label', o.label, 'description', o.description)
                order by o.score), '[]'::jsonb)
              from ask_options o where o.question_id = q.id))
            order by q.sort_order), '[]'::jsonb)
          from ask_questions q where q.attribute_id = a.id))
      order by a.sort_order)
      from ask_attributes a), '[]'::jsonb));
end $$;

-- ── Assertions ────────────────────────────────────────────────────────────
do $$
declare v_r1 int; v_r2 int; v_opts int; v_src text;
begin
  select count(*) into v_r1 from ask_questions q join ask_attributes a on a.id = q.attribute_id
  where q.active and a.active and q.in_r1 and not q.is_reference;
  if v_r1 <> 8 then raise exception 'R1 is % questions, expected 8', v_r1; end if;

  select count(*) into v_r2 from ask_questions q join ask_attributes a on a.id = q.attribute_id
  where q.active and a.active and not q.is_reference;
  if v_r2 < 35 or v_r2 > 38 then
    raise exception 'R2 is % questions, outside the 35-38 asked for', v_r2;
  end if;

  -- The new question is complete, or it is worse than not being there.
  select count(*) into v_opts from ask_options where question_id = 'objection-4';
  if v_opts <> 4 then
    raise exception 'objection-4 has % anchors, expected 4', v_opts;
  end if;
  if exists (select 1 from ask_options where question_id = 'objection-4'
             and (coalesce(btrim(label), '') = '' or coalesce(btrim(description), '') = '')) then
    raise exception 'objection-4 has a blank anchor';
  end if;
  if (select count(distinct score) from ask_options where question_id = 'objection-4') <> 4 then
    raise exception 'objection-4 does not have one anchor at each of 0,1,2,3';
  end if;

  -- No reference question can be in R1.
  if exists (select 1 from ask_questions where in_r1 and is_reference) then
    raise exception 'a reference question is in R1';
  end if;

  -- And nothing is left deciding scope by the old rule.
  for v_src in
    select pg_get_functiondef(p.oid) from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('submit_ask', 'recompute_ask_totals', 'score_ask_reference',
                        'get_ask_references', 'get_ask_bank', 'get_candidate_ask')
  loop
    if v_src like '%or a.priority)%' or v_src like '%or at2.priority)%' then
      raise exception 'a scoring function still decides round scope by attribute '
                      'priority — its total would disagree with the questions asked';
    end if;
  end loop;

  raise notice 'sql/44: R1 % questions (~% min), R2 % (~% min), R2 after R1 % (~% min)',
    v_r1, round(v_r1 * 70 / 60.0), v_r2, round(v_r2 * 70 / 60.0),
    v_r2 - v_r1, round((v_r2 - v_r1) * 70 / 60.0);
end $$;
