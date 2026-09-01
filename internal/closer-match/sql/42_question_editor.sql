-- ═══════════════════════════════════════════════════════════════════════════
-- 42 — editing the questions without opening a database console
--
-- The ASK bank went into the database (sql/35) so the team could reword a
-- question without a deploy. That was half the sentence. The other half — a
-- screen to do it on — was never built, so "editable" meant "editable by
-- somebody with a SQL console", which is one person and a bad afternoon.
--
-- ── WHAT IS AND IS NOT EDITABLE ───────────────────────────────────────────
--
-- Editable: the question prompt, the interviewer hint, and the four anchors'
-- labels and descriptions. These are wording. Wording is the instrument, so this
-- is not a small power — but it is the power the team needs, and withholding it
-- does not make the wording better, it just makes it slower to fix.
--
-- **Not editable: the score on an anchor.** Each question has exactly four
-- anchors scored 0, 1, 2, 3, and that structure is what makes an attribute total
-- comparable across candidates and interviewers. You can change what a "2" reads
-- like; you cannot make an anchor worth 5. That is a schema constraint, not a
-- permission — `ask_options` is keyed on (question_id, score).
--
-- **Not deletable: anything anybody has been scored against.** A question can be
-- deactivated, which takes it out of future interviews and leaves every past
-- scorecard exactly as it was. Deleting it would cascade `ask_scores` and quietly
-- rewrite history. The guard refuses and says how many scorecards would lose an
-- answer.
--
-- ── WHY PAST SCORECARDS DO NOT MOVE ───────────────────────────────────────
--
-- Every `ask_scores` row snapshots the prompt and the chosen anchor's label at
-- the moment it was recorded (sql/35), and submitted totals are frozen. So a
-- reword in May cannot change what a March scorecard says or what it came to.
-- `test/ask.js` has asserted exactly this since the ASK suite was written; this
-- migration is what makes the assertion earn its keep, because until now nobody
-- could reword anything anyway.
--
-- ── WHO ───────────────────────────────────────────────────────────────────
--
-- Admin only, not any staff. A recruiter running interviews should not be able to
-- change the instrument they are being measured against halfway through a round.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── First, the trigger that made editing impossible from a browser ────────
--
-- `bump_ask_bank_revision()` did this:
--
--     update ask_bank_meta set bank_revision = bank_revision + 1, updated_at = now();
--
-- No WHERE clause — harmless in principle, `ask_bank_meta` has a single row
-- pinned by `only_row`. But Supabase enables **safeupdate** for statements that
-- arrive through PostgREST, which rejects any WHERE-less UPDATE with
-- `21000: UPDATE requires a WHERE clause`. The trigger fires inside the editing
-- function, so every edit failed — and failed with an error about an UPDATE the
-- caller never wrote, on a table they had not heard of.
--
-- It had never fired from a browser before, because until this file there was no
-- way to edit the bank from one. Same shape as everything else found this week:
-- the code was correct in the only context anybody had run it in.
create or replace function bump_ask_bank_revision()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- `where only_row` is the WHERE clause safeupdate wants, and it is also the
  -- honest predicate: this table has one row and that column is what says so.
  update ask_bank_meta set bank_revision = bank_revision + 1, updated_at = now()
  where only_row;
  return null;
end $$;

-- ── The whole bank, for editing ───────────────────────────────────────────
-- Deliberately not `get_ask_bank`: that one serves an interview and must return
-- only what is live and in scope. This returns everything, active or not, with
-- the usage counts an editor needs in order to warn before a change matters.
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
            'sort_order', q.sort_order,
            -- How many recorded answers exist against this question. An editor
            -- that does not say "this has been used forty times" invites a
            -- reword that nobody realises is a change of meaning.
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

-- ── Editing a question ────────────────────────────────────────────────────
create or replace function update_ask_question(p_id text, p_prompt text,
                                               p_hint text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_used int;
begin
  if staff_role() <> 'admin' then
    raise exception 'Only an admin can change the questions. A recruiter running '
                    'interviews should not be able to move the instrument they '
                    'are being measured against.';
  end if;
  if coalesce(btrim(p_prompt), '') = '' then
    raise exception 'A question needs a prompt. Deactivate it instead of emptying it.';
  end if;
  if not exists (select 1 from ask_questions where id = p_id) then
    raise exception 'No such question: %', p_id;
  end if;

  select count(*) into v_used from ask_scores where question_id = p_id;

  update ask_questions
  set prompt = btrim(p_prompt), hint = nullif(btrim(p_hint), '')
  where id = p_id;

  -- The trigger from sql/35 bumps bank_revision, so scorecards can be grouped by
  -- which wording they were run against.
  return jsonb_build_object(
    'id', p_id, 'saved', true,
    'bank_revision', (select bank_revision from ask_bank_meta),
    'already_scored', v_used,
    'note', case when v_used > 0
      then v_used || ' recorded answer(s) keep the wording they were scored '
           'against. Only interviews from now on will use the new wording.'
      else null end);
end $$;

-- ── Editing an anchor ─────────────────────────────────────────────────────
-- The score is the address, not the payload: you say which of the four anchors
-- you are rewriting, and you rewrite its words.
create or replace function update_ask_option(p_question text, p_score int,
                                             p_label text, p_description text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if staff_role() <> 'admin' then
    raise exception 'Only an admin can change the anchors.';
  end if;
  if p_score not between 0 and 3 then
    raise exception 'An anchor is scored 0, 1, 2 or 3. The four-point scale is what '
                    'makes one attribute total comparable to another.';
  end if;
  if coalesce(btrim(p_label), '') = '' or coalesce(btrim(p_description), '') = '' then
    raise exception 'An anchor needs both a short label and the behaviour it '
                    'describes. A blank anchor is one an interviewer cannot pick '
                    'honestly, so it becomes the one nobody picks.';
  end if;
  if not exists (select 1 from ask_options where question_id = p_question and score = p_score) then
    raise exception 'Question % has no anchor scored %', p_question, p_score;
  end if;

  update ask_options
  set label = btrim(p_label), description = btrim(p_description)
  where question_id = p_question and score = p_score;

  return jsonb_build_object('question', p_question, 'score', p_score, 'saved', true,
    'bank_revision', (select bank_revision from ask_bank_meta));
end $$;

-- ── Taking a question out of use, and putting it back ─────────────────────
create or replace function set_ask_question_active(p_id text, p_active boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_attr text; v_left int; v_used int; v_ref boolean;
begin
  if staff_role() <> 'admin' then
    raise exception 'Only an admin can take a question out of use.';
  end if;
  select attribute_id, is_reference into v_attr, v_ref
  from ask_questions where id = p_id;
  if v_attr is null then raise exception 'No such question: %', p_id; end if;

  -- An attribute with no questions left is an attribute scored 0 out of 0, which
  -- reads as a real reading of zero on every screen that shows it.
  if not p_active then
    select count(*) into v_left from ask_questions q
    where q.attribute_id = v_attr and q.active and q.id <> p_id and not q.is_reference;
    if v_left = 0 and not v_ref then
      raise exception 'That is the last active question on this attribute. An '
                      'attribute with nothing to ask scores 0 out of 0, which reads '
                      'as a real result. Deactivate the whole attribute instead.';
    end if;
  end if;

  select count(*) into v_used from ask_scores where question_id = p_id;
  update ask_questions set active = p_active where id = p_id;

  return jsonb_build_object('id', p_id, 'active', p_active,
    'bank_revision', (select bank_revision from ask_bank_meta),
    'past_answers_kept', v_used,
    'note', case when not p_active and v_used > 0
      then v_used || ' past answer(s) are untouched — deactivating removes it from '
           'future interviews, it does not rewrite finished ones.'
      else null end);
end $$;

create or replace function set_ask_attribute_active(p_id text, p_active boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_left int;
begin
  if staff_role() <> 'admin' then
    raise exception 'Only an admin can take an attribute out of use.';
  end if;
  if not exists (select 1 from ask_attributes where id = p_id) then
    raise exception 'No such attribute: %', p_id;
  end if;

  if not p_active then
    select count(*) into v_left from ask_attributes where active and id <> p_id;
    if v_left = 0 then
      raise exception 'That is the last active attribute. An interview has to ask '
                      'about something.';
    end if;
  end if;

  update ask_attributes set active = p_active where id = p_id;
  return jsonb_build_object('id', p_id, 'active', p_active,
    'bank_revision', (select bank_revision from ask_bank_meta));
end $$;

-- ── Which attributes make up R1 ───────────────────────────────────────────
-- This is the control that decides how long the phone screen is, and — after
-- sql/43 — how much of R2 is left to do. Worth a guard at both ends: an R1 with
-- nothing in it is not a screen, and an R1 that is the whole bank is not a screen
-- either, it is R2 with a different name.
create or replace function set_ask_attribute_priority(p_id text, p_priority boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_n int; v_q int; v_total int;
begin
  if staff_role() <> 'admin' then
    raise exception 'Only an admin can change what R1 asks about.';
  end if;
  if not exists (select 1 from ask_attributes where id = p_id) then
    raise exception 'No such attribute: %', p_id;
  end if;

  update ask_attributes set priority = p_priority where id = p_id;

  select count(*) filter (where priority), count(*) into v_n, v_total
  from ask_attributes where active;

  if v_n = 0 then
    update ask_attributes set priority = not p_priority where id = p_id;
    raise exception 'R1 would have no attributes left. The phone screen has to ask '
                    'about something — put one back first.';
  end if;
  if v_n = v_total then
    update ask_attributes set priority = not p_priority where id = p_id;
    raise exception 'That would make R1 the entire bank, which is R2 with a '
                    'different name. Leave at least one attribute for the longer '
                    'interview.';
  end if;

  select count(*) into v_q from ask_questions q
  join ask_attributes a on a.id = q.attribute_id
  where q.active and a.active and a.priority and not q.is_reference;

  return jsonb_build_object('id', p_id, 'priority', p_priority,
    'r1_attributes', v_n, 'r1_questions', v_q,
    'r2_remaining_questions', (
      select count(*) from ask_questions q
      join ask_attributes a on a.id = q.attribute_id
      where q.active and a.active and not a.priority and not q.is_reference),
    'bank_revision', (select bank_revision from ask_bank_meta));
end $$;

revoke all on function get_ask_editor() from public;
revoke all on function update_ask_question(text, text, text) from public;
revoke all on function update_ask_option(text, int, text, text) from public;
revoke all on function set_ask_question_active(text, boolean) from public;
revoke all on function set_ask_attribute_active(text, boolean) from public;
revoke all on function set_ask_attribute_priority(text, boolean) from public;
grant execute on function get_ask_editor() to authenticated;
grant execute on function update_ask_question(text, text, text) to authenticated;
grant execute on function update_ask_option(text, int, text, text) to authenticated;
grant execute on function set_ask_question_active(text, boolean) to authenticated;
grant execute on function set_ask_attribute_active(text, boolean) to authenticated;
grant execute on function set_ask_attribute_priority(text, boolean) to authenticated;

-- ── Assertions ────────────────────────────────────────────────────────────
do $$
declare
  v jsonb; v_rev0 int; v_rev1 int; v_q text; v_before text;
  v_attr text; v_prio_before boolean;
begin
  if not is_staff() then
    -- Applied through the Management API there is no staff identity, so the
    -- behavioural half runs in test/ask.js. What can be checked here is that the
    -- editor cannot reach the one thing it must never reach: an anchor's score.
    if exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'update_ask_option'
        and pg_get_functiondef(p.oid) like '%update ask_options set%score =%') then
      raise exception 'update_ask_option can write an anchor score — the 0-3 scale '
                      'is what makes attribute totals comparable and must not be editable';
    end if;
    raise notice 'sql/42: editor functions created; behaviour covered by test/ask.js';
    return;
  end if;

  v := get_ask_editor();
  if jsonb_array_length(v->'attributes') <> 14 then
    raise exception 'the editor sees % attributes, expected 14', jsonb_array_length(v->'attributes');
  end if;

  select id, prompt into v_q, v_before from ask_questions where active and not is_reference
  order by sort_order limit 1;
  select bank_revision into v_rev0 from ask_bank_meta;

  perform update_ask_question(v_q, 'ZZ_FIXTURE reworded', 'ZZ_FIXTURE hint');
  select bank_revision into v_rev1 from ask_bank_meta;
  if v_rev1 <= v_rev0 then
    raise exception 'editing a question did not bump the bank revision';
  end if;
  perform update_ask_question(v_q, v_before, (select hint from ask_questions where id = v_q));

  -- An anchor outside 0-3 must be refused rather than silently clamped.
  begin
    perform update_ask_option(v_q, 5, 'x', 'y');
    raise exception 'update_ask_option accepted a score of 5';
  exception when others then
    if sqlerrm not like '%scored 0, 1, 2 or 3%' then raise; end if;
  end;

  -- A blank anchor is the one nobody can pick honestly.
  begin
    perform update_ask_option(v_q, 2, '', 'y');
    raise exception 'update_ask_option accepted a blank label';
  exception when others then
    if sqlerrm not like '%short label%' then raise; end if;
  end;

  -- The R1-composition guards are NOT probed here. Doing so means clearing the
  -- priority flag on live attributes and putting it back from a list written in
  -- this file — and a restore list is a second definition of which attributes make
  -- up R1, which would be wrong the first time somebody changed one. A migration
  -- has no business mutating the live instrument to prove a guard. test/ask.js
  -- probes both guards against a fixture attribute it creates and deletes.
  --
  -- What is safe to assert is that the guards exist in the function at all.
  if (select pg_get_functiondef(p.oid) from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'set_ask_attribute_priority')
     not like '%no attributes left%' then
    raise exception 'set_ask_attribute_priority has lost its empty-R1 guard';
  end if;
  if (select pg_get_functiondef(p.oid) from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'set_ask_attribute_priority')
     not like '%entire bank%' then
    raise exception 'set_ask_attribute_priority has lost its whole-bank guard';
  end if;

  raise notice 'sql/42: editor verified';
end $$;
