-- ═══════════════════════════════════════════════════════════════════════════
-- 40 — the reference check becomes its own flow, and stops diluting the score
--
-- Two of the 42 ASK questions are put to the candidate's PREVIOUS MANAGER, not to
-- the candidate: `consistency-3` ("how did their output in month 1 compare to
-- month 4?") and `longevity-3` ("would you rehire them?"). They land days later,
-- on a different call, with a different person, or never.
--
-- The design already half-knew this. `submit_ask` excludes them from its
-- completeness check, so an interview can be submitted with them outstanding, and
-- `score_ask_reference()` exists to score one afterwards and fold it back into
-- the total. **Nothing in the frontend has ever called that function.** The
-- plumbing was built and no tap was fitted — the same failure as §7ak, found the
-- same way: by somebody trying to use the tool.
--
-- ── AND THE SCORE WAS DILUTED ─────────────────────────────────────────────
--
-- Worse, and only visible in live data. The first real submitted scorecard:
--
--     Shobha Pathak · R2 · 40 answered · total 38 · max_total 126 · 30.2%
--
-- 126 is 42 × 3. The denominator counts **all forty-two** questions, including
-- the two nobody has asked yet. So the reported percentage is not "how she did";
-- it is "how she did, against a ceiling that includes two unasked questions".
-- 38/120 is 31.7%. The gap is small here and it is always in the same direction:
-- every scorecard understates until the references land, and references often
-- never land.
--
-- > **A percentage has to describe what was actually measured.** A question that
-- > was never asked belongs in neither the numerator nor the denominator.
--
-- So: a question counts toward the total and the maximum when it was in scope to
-- be asked of the candidate, or when it is a reference question that has actually
-- been scored. Score a reference later and it joins numerator and denominator at
-- the same moment — which is exactly "add it back into the scoring", and is
-- honest at every point in between rather than only at the end.
--
-- ── ONE DEFINITION OF THE ARITHMETIC ──────────────────────────────────────
--
-- `submit_ask` and `score_ask_reference` each carried their own copy of the
-- totalling query — two definitions of one thing (§7ab), which would have meant
-- a scorecard whose total depended on which function last touched it. Both now
-- call `recompute_ask_totals()`.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── The arithmetic, once ──────────────────────────────────────────────────
-- `p_mark_submitted` exists because of the `ask_frozen_together` CHECK:
--
--     (submitted_at IS NULL AND total IS NULL AND max_total IS NULL AND attributes IS NULL)
--  OR (submitted_at IS NOT NULL AND total IS NOT NULL AND …)
--
-- The first draft of submit_ask stamped `submitted_at` and then called this to
-- fill the totals — two statements, and between them the row was submitted with
-- no total, which is exactly the state the constraint forbids. It refused, as it
-- should have: the constraint is what stops a submitted scorecard existing
-- without a frozen number. So the stamp and the totals go in one UPDATE.
drop function if exists recompute_ask_totals(uuid);
create or replace function recompute_ask_totals(p_scorecard uuid,
                                                p_mark_submitted boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_round text; v_total int; v_max int; v_attrs jsonb; v_refs int; v_ref_done int;
begin
  select round into v_round from ask_scorecards where id = p_scorecard;
  if v_round is null then raise exception 'No such scorecard.'; end if;

  -- `in_scope` is the whole rule, and it is written once: a question counts if it
  -- was for the candidate, or if it is a reference question that has been scored.
  select jsonb_agg(x order by x->>'sort'),
         sum((x->>'score')::int), sum((x->>'max')::int)
    into v_attrs, v_total, v_max
  from (
    select jsonb_build_object(
      'id', aid, 'name', aname, 'section', asec, 'priority', apri,
      'sort', lpad(asort::text, 3, '0'),
      'score', coalesce(sum(score) filter (where in_scope), 0),
      'max', count(*) filter (where in_scope) * 3,
      'unscored', count(*) filter (where in_scope and score is null),
      'refs_outstanding', count(*) filter (where is_ref and score is null)) as x
    from (
      select a.id as aid, a.name as aname, a.section as asec,
             a.priority as apri, a.sort_order as asort,
             q.is_reference as is_ref, s.score,
             (not q.is_reference or s.question_id is not null) as in_scope
      from ask_attributes a
      join ask_questions q on q.attribute_id = a.id and q.active
      left join ask_scores s on s.scorecard_id = p_scorecard and s.question_id = q.id
      where a.active and (v_round = 'r2' or a.priority)
    ) r
    group by aid, aname, asec, apri, asort) t;

  select count(*) filter (where s.question_id is null),
         count(*) filter (where s.question_id is not null)
    into v_refs, v_ref_done
  from ask_questions q
  join ask_attributes a on a.id = q.attribute_id
  left join ask_scores s on s.scorecard_id = p_scorecard and s.question_id = q.id
  where q.active and a.active and q.is_reference and (v_round = 'r2' or a.priority);

  update ask_scorecards set
    total = v_total, max_total = v_max,
    pct = round(v_total::numeric / nullif(v_max, 0) * 100, 1),
    attributes = v_attrs,
    submitted_at = case when p_mark_submitted then now() else submitted_at end
  where id = p_scorecard;

  return jsonb_build_object(
    'total', v_total, 'max_total', v_max,
    'pct', round(v_total::numeric / nullif(v_max, 0) * 100, 1),
    'outstanding_refs', v_refs, 'references_scored', v_ref_done);
end $$;

-- ── Submit, using it ──────────────────────────────────────────────────────
create or replace function submit_ask(p_scorecard uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_card ask_scorecards; v_missing int; v_res jsonb;
begin
  if not is_staff() then raise exception 'submit_ask: staff only'; end if;
  select * into v_card from ask_scorecards where id = p_scorecard;
  if v_card.id is null then raise exception 'No such scorecard.'; end if;
  if v_card.submitted_at is not null then
    raise exception 'Already submitted on %.', to_char(v_card.submitted_at, 'DD Mon YYYY');
  end if;

  -- Everything in scope except the reference questions, which are asked of a
  -- previous manager and may land days later, or never.
  select count(*) into v_missing
  from ask_questions q
  join ask_attributes a on a.id = q.attribute_id
  where q.active and a.active and not q.is_reference
    and (v_card.round = 'r2' or a.priority)
    and not exists (select 1 from ask_scores s
                     where s.scorecard_id = p_scorecard and s.question_id = q.id);

  if v_missing > 0 then
    raise exception '% question(s) still unanswered. Score them, or use the '
                    'skip control — a blank is not a zero.', v_missing;
  end if;

  v_res := recompute_ask_totals(p_scorecard, true);

  return v_res || jsonb_build_object('submitted', true,
    'note', case when (v_res->>'outstanding_refs')::int > 0
      then (v_res->>'outstanding_refs') || ' reference question(s) still to put to '
           || 'their previous manager. They are not counted for or against — the '
           || 'score describes the interview that happened. Record them from the '
           || 'candidate page whenever the call comes.'
      else null end);
end $$;

-- ── Scoring a reference afterwards ────────────────────────────────────────
create or replace function score_ask_reference(p_scorecard uuid, p_question text,
                                               p_score int, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ref boolean; v_prompt text; v_label text;
begin
  if not is_staff() then raise exception 'score_ask_reference: staff only'; end if;

  select is_reference, prompt into v_ref, v_prompt from ask_questions where id = p_question;
  if v_prompt is null then raise exception 'No such question: %', p_question; end if;
  if not v_ref then
    raise exception 'Only the reference questions can be scored after submitting.';
  end if;
  if not exists (select 1 from ask_scorecards where id = p_scorecard) then
    raise exception 'No such scorecard.';
  end if;

  select label into v_label from ask_options where question_id = p_question and score = p_score;
  if v_label is null then raise exception 'Score % is not an anchor on %.', p_score, p_question; end if;

  insert into ask_scores (scorecard_id, question_id, score, note, question_text, option_label)
  values (p_scorecard, p_question, p_score, nullif(btrim(p_note), ''), v_prompt, v_label)
  on conflict (scorecard_id, question_id) do update set
    score = excluded.score, note = excluded.note,
    question_text = excluded.question_text, option_label = excluded.option_label,
    answered_at = now();

  -- The moment it is scored it joins both the numerator and the denominator.
  return recompute_ask_totals(p_scorecard);
end $$;

-- ── What the reference call needs, and nothing else ───────────────────────
-- A separate surface wants a small payload: which questions, what the anchors
-- are, what has already been recorded, and who this is about. It does not want
-- the other forty questions.
create or replace function get_ask_references(p_scorecard uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not is_staff() then raise exception 'get_ask_references: staff only'; end if;

  select jsonb_build_object(
    'scorecard_id', sc.id,
    'candidate', c.full_name,
    'candidate_id', c.id,
    'round', sc.round,
    'submitted_at', sc.submitted_at,
    'conducted_on', sc.conducted_on,
    'interviewer', st.full_name,
    'pct', sc.pct, 'total', sc.total, 'max_total', sc.max_total,
    'questions', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', q.id, 'prompt', q.prompt, 'hint', q.hint,
        'attribute', a.name,
        'scored', s.question_id is not null,
        'score', s.score, 'note', s.note,
        'options', (select jsonb_agg(jsonb_build_object(
                      'score', o.score, 'label', o.label, 'description', o.description)
                      order by o.score)
                    from ask_options o where o.question_id = q.id))
        order by q.sort_order), '[]'::jsonb)
      from ask_questions q
      join ask_attributes a on a.id = q.attribute_id
      left join ask_scores s on s.scorecard_id = sc.id and s.question_id = q.id
      where q.active and a.active and q.is_reference
        and (sc.round = 'r2' or a.priority)))
  into v
  from ask_scorecards sc
  join candidates c on c.id = sc.candidate_id
  left join staff st on st.id = sc.interviewer_id
  where sc.id = p_scorecard;

  if v is null then raise exception 'No such scorecard.'; end if;
  return v;
end $$;

-- ── Throwing away an empty re-run ─────────────────────────────────────────
-- Live data showed a second R2 scorecard opened fourteen seconds after the first
-- was submitted — a "Run R2 again" click on the results screen. It has no
-- answers, but it is now the open card for that candidate and round, so the next
-- person to press Run R2 resumes an empty one instead of seeing the finished
-- interview. Deleting a scorecard that was never written to costs nothing and
-- removes the trap.
create or replace function discard_ask(p_scorecard uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_card ask_scorecards; v_n int;
begin
  if not is_staff() then raise exception 'discard_ask: staff only'; end if;
  select * into v_card from ask_scorecards where id = p_scorecard;
  if v_card.id is null then raise exception 'No such scorecard.'; end if;
  if v_card.submitted_at is not null then
    raise exception 'That interview was submitted on %. A finished scorecard is a '
                    'record and is not thrown away.', to_char(v_card.submitted_at, 'DD Mon YYYY');
  end if;

  select count(*) into v_n from ask_scores where scorecard_id = p_scorecard;
  if v_n > 0 then
    raise exception 'That scorecard has % answer(s) on it. Finish it or leave it '
                    'open — this only discards one nothing was recorded on.', v_n;
  end if;

  delete from ask_scorecards where id = p_scorecard;
  return jsonb_build_object('discarded', true);
end $$;

revoke all on function recompute_ask_totals(uuid, boolean) from public;
revoke all on function get_ask_references(uuid) from public;
revoke all on function discard_ask(uuid) from public;
grant execute on function recompute_ask_totals(uuid, boolean) to authenticated;
grant execute on function get_ask_references(uuid) to authenticated;
grant execute on function discard_ask(uuid) to authenticated;

-- ── Put the existing scorecards on the new arithmetic ─────────────────────
do $$
declare r record; v jsonb;
begin
  for r in select id, pct as old_pct, max_total as old_max from ask_scorecards
           where submitted_at is not null
  loop
    v := recompute_ask_totals(r.id);
    raise notice 'sql/40: rescored % — max % → %, pct % → %',
      r.id, r.old_max, v->>'max_total', r.old_pct, v->>'pct';
  end loop;
end $$;

-- ── Assertions ────────────────────────────────────────────────────────────
do $$
declare
  v_cand uuid; v_card uuid; v_q text; v_res jsonb; v_n int;
  v_ref1 text; v_ref2 text; v_max_no_refs int; v_dup uuid;
begin
  if not is_staff() then
    -- The Management API connects as `postgres`, which is correctly not staff.
    -- Assert what can be asserted without an identity: that both totalling paths
    -- now go through one function rather than carrying their own copy.
    if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname in ('submit_ask','score_ask_reference')
          and pg_get_functiondef(p.oid) like '%recompute_ask_totals(p_scorecard%') <> 2 then
      raise exception 'submit_ask and score_ask_reference do not both call '
                      'recompute_ask_totals — the arithmetic is defined twice again';
    end if;
    raise notice 'sql/40: one definition of the totals confirmed; behaviour covered by test/ask.js';
    return;
  end if;

  select id into v_ref1 from ask_questions where id = 'consistency-3';
  select id into v_ref2 from ask_questions where id = 'longevity-3';
  if v_ref1 is null or v_ref2 is null then
    raise exception 'the two reference questions are not where this migration expects them';
  end if;

  insert into candidates (full_name, contact, consent_version, consent_at)
  values ('ZZ_FIXTURE ref flow', '{}'::jsonb, 'pending', now()) returning id into v_cand;

  v_card := (start_ask(v_cand, 'r2')->>'scorecard_id')::uuid;

  -- Answer every candidate-facing question with a 3, leaving both references out.
  for v_q in select q.id from ask_questions q where q.active and not q.is_reference loop
    perform save_ask_score(v_card, v_q, 3, null);
  end loop;

  v_res := submit_ask(v_card);

  select count(*) * 3 into v_max_no_refs from ask_questions q
  join ask_attributes a on a.id = q.attribute_id
  where q.active and a.active and not q.is_reference;

  if (v_res->>'max_total')::int <> v_max_no_refs then
    raise exception 'an unasked reference question is still in the denominator: max % expected %',
      v_res->>'max_total', v_max_no_refs;
  end if;
  if (v_res->>'pct')::numeric <> 100 then
    raise exception 'a candidate who scored the top anchor on every question asked '
                    'should read 100%%, got %%%', v_res->>'pct';
  end if;
  if (v_res->>'outstanding_refs')::int <> 2 then
    raise exception 'expected 2 outstanding references, got %', v_res->>'outstanding_refs';
  end if;

  -- Now the reference call comes in, days later.
  v_res := score_ask_reference(v_card, v_ref1, 0, 'ZZ_FIXTURE');
  if (v_res->>'max_total')::int <> v_max_no_refs + 3 then
    raise exception 'scoring a reference did not add it to the denominator';
  end if;
  if (v_res->>'outstanding_refs')::int <> 1 then
    raise exception 'expected 1 outstanding reference after scoring one, got %',
      v_res->>'outstanding_refs';
  end if;
  if (v_res->>'pct')::numeric >= 100 then
    raise exception 'a zero-scored reference must pull the percentage below 100, got %',
      v_res->>'pct';
  end if;

  -- And the stored row agrees with what was returned — the breakdown is frozen
  -- on the scorecard, so a surface reading the table must see the same thing.
  select max_total into v_n from ask_scorecards where id = v_card;
  if v_n <> (v_res->>'max_total')::int then
    raise exception 'the stored max_total disagrees with what score_ask_reference returned';
  end if;

  -- An interview question cannot be sneaked in through the reference door.
  begin
    perform score_ask_reference(v_card, (select id from ask_questions
                                         where active and not is_reference limit 1), 3, null);
    raise exception 'score_ask_reference accepted a non-reference question';
  exception when others then
    if sqlerrm not like '%Only the reference questions%' then raise; end if;
  end;

  -- A submitted scorecard still refuses ordinary edits.
  begin
    perform save_ask_score(v_card, (select id from ask_questions
                                    where active and not is_reference limit 1), 0, null);
    raise exception 'save_ask_score edited a submitted scorecard';
  exception when others then
    if sqlerrm not like '%was submitted on%' then raise; end if;
  end;

  -- discard_ask: an empty re-run goes, a written-on one does not.
  v_dup := (start_ask(v_cand, 'r2')->>'scorecard_id')::uuid;
  if v_dup = v_card then raise exception 'a new open scorecard was not created'; end if;
  perform discard_ask(v_dup);
  if exists (select 1 from ask_scorecards where id = v_dup) then
    raise exception 'discard_ask did not delete an empty scorecard';
  end if;

  v_dup := (start_ask(v_cand, 'r2')->>'scorecard_id')::uuid;
  perform save_ask_score(v_dup, (select id from ask_questions
                                 where active and not is_reference limit 1), 2, null);
  begin
    perform discard_ask(v_dup);
    raise exception 'discard_ask threw away a scorecard with an answer on it';
  exception when others then
    if sqlerrm not like '%answer(s) on it%' then raise; end if;
  end;

  begin
    perform discard_ask(v_card);
    raise exception 'discard_ask threw away a submitted scorecard';
  exception when others then
    if sqlerrm not like '%is a record and is not thrown away%' then raise; end if;
  end;

  -- get_ask_references serves the small payload and nothing else.
  v_res := get_ask_references(v_card);
  if jsonb_array_length(v_res->'questions') <> 2 then
    raise exception 'get_ask_references returned % questions, expected 2',
      jsonb_array_length(v_res->'questions');
  end if;
  if not (v_res->'questions'->0 ? 'options') then
    raise exception 'the reference questions arrive without their anchors';
  end if;

  raise notice 'sql/40: reference flow verified end to end';

  perform purge_candidate(v_cand);
  if exists (select 1 from candidates where id = v_cand) then
    raise exception 'the fixture candidate was not removed';
  end if;
end $$;
