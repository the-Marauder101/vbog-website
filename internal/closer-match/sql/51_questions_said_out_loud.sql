-- ═══════════════════════════════════════════════════════════════════════════
-- 51 — the questions, rewritten to be said rather than read
--
-- *"Some of the questions are a mouthful."*
--
-- They are, and the reason is visible in the lengths: the worst offender runs to
-- 142 characters and three clauses. It reads perfectly well on a page. Said aloud
-- on a call, forty minutes in, the interviewer either trails off halfway or
-- paraphrases it — and a paraphrased question is a different question that is
-- still being scored against the same anchors.
--
-- ── WHAT IS BEING CHANGED, AND WHAT IS NOT ────────────────────────────────
--
-- Only the **prompt** — the sentence the interviewer says. Not one anchor, not
-- one option, not one hint, not one attribute mapping.
--
-- That split matters because of what does the measuring. sql/35 made the point
-- that "the wording IS the instrument" and refused to retype the bank by hand for
-- exactly that reason. But it is the **anchors** that are the instrument: "Names
-- five distinct objections roughly as a buyer would say them, and pairs most of
-- them with something specific they actually did" is what turns an answer into a
-- 2. The prompt's job is only to get the candidate talking about the right thing.
--
-- So a prompt can be tightened without changing what is measured, PROVIDED it
-- still asks for everything the anchors score. Which is the trap:
--
-- > **A shorter question that drops a detail its anchors depend on is not a
-- > tidier question, it is a broken one.** `objection-4`'s anchors count to five
-- > and score the buyer's own words and the move made in reply. Trim "five" and
-- > the 2-anchor can never be reached; trim "what you said back" and the 0-anchor
-- > fires on answers that deserved better.
--
-- Every rewrite below was checked against its own anchors, and the assertions at
-- the bottom re-check the mechanical half of that: every numeral in the old
-- prompt has to survive into the new one, so "the next 14 days", "your next 60
-- seconds", "3–5 minutes" and "the 20th … 40% … 10 days" cannot quietly go
-- missing while the sentence gets shorter.
--
-- ── HISTORY IS SAFE ───────────────────────────────────────────────────────
--
-- `ask_scores` snapshots `question_text` at the moment a score is recorded
-- (sql/35), so the eight scorecards already submitted keep the wording they were
-- actually scored against. The bank revision bumps on its trigger, so scorecards
-- can still be grouped by which version they used. Nothing already measured moves.
-- ═══════════════════════════════════════════════════════════════════════════

create temporary table q_rewrite (id text primary key, prompt text not null) on commit drop;

insert into q_rewrite (id, prompt) values

-- ── The three-clause ones. Same ask, one breath. ──────────────────────────
('objection-4',
 'Your top five objections. The buyer''s exact words, and what you said back to each.'),
('followup-1',
 '"Let me think about it" — and they''re gone. Every touch over the next 14 days: when, and on what channel.'),
('objection-1',
 'How do you tell a real "let me think" from a polite no?'),
('eq-3',
 'A call where they agreed with everything and you knew they wouldn''t buy. What were you reading?'),
('ownership-1',
 'Last time you caught your own numbers slipping before your manager did — what did you do that week?'),
('discovery-1',
 '3–5 minutes into a call, how do you know whether this one closes? What are you reading?'),
('coach-3',
 'Say I tell you tomorrow that your discovery is the weakest part of your call. What happens next?'),
('crm-2',
 'I open your last CRM and read a call note from three weeks ago. What''s in it?'),

-- ── The nearly-there ones, where a few words were doing nothing. ──────────
('eq-1',
 'Mid-call: "I need to discuss this with my wife." Your next 60 seconds?'),
('target-1',
 'It''s the 20th and you''re at 40% of target. What changes for the last 10 days?'),
('closing-2',
 'The exact words you use to ask for the payment. Say it to me the way you''d say it on a call.'),
('dialing-1',
 'Your real dial count on a normal day — and how many of those connected?'),
('pressure-2',
 'The most aggressive prospect you''ve handled. What did they do, and what did you say?'),
('consistency-2',
 'What does a bad day at work actually look like for you — and what do you do about it?'),
('longevity-2',
 'Your worst 2–3 months in a sales role. What did you do during that stretch?'),
('followup-2',
 'What''s in follow-up #4 that wasn''t in #1, #2 or #3?');

-- ── Check before writing, not after ────────────────────────────────────────
do $$
declare r record; v_old text; v_missing text[]; v_num text;
begin
  -- Every id must exist and be live. A rewrite aimed at a deactivated question
  -- is a silent no-op that looks like a change.
  for r in select * from q_rewrite loop
    if not exists (select 1 from ask_questions where id = r.id and active) then
      raise exception 'sql/51: % is not an active question', r.id;
    end if;
  end loop;

  -- The mechanical half of "no scored detail was dropped": every digit run in the
  -- old prompt survives into the new one.
  for r in select w.id, w.prompt as new_prompt, q.prompt as old_prompt
           from q_rewrite w join ask_questions q on q.id = w.id loop
    v_missing := '{}';
    for v_num in select m[1] from regexp_matches(r.old_prompt, '(\d+)', 'g') m loop
      if position(v_num in r.new_prompt) = 0 then
        v_missing := array_append(v_missing, v_num);
      end if;
    end loop;
    if array_length(v_missing, 1) > 0 then
      raise exception 'sql/51: rewriting % drops the number(s) % that its scenario '
                      'depends on. old=[%] new=[%]',
        r.id, array_to_string(v_missing, ', '), r.old_prompt, r.new_prompt;
    end if;
  end loop;

  -- A rewrite that is not shorter is not a rewrite, it is a change of mind, and
  -- it should be made deliberately through the editor rather than smuggled in here.
  for r in select w.id, length(w.prompt) as n, length(q.prompt) as o
           from q_rewrite w join ask_questions q on q.id = w.id loop
    if r.n >= r.o then
      raise exception 'sql/51: % got longer (% to %), which is not what this file is for',
        r.id, r.o, r.n;
    end if;
  end loop;
end $$;

-- ── Write ──────────────────────────────────────────────────────────────────
update ask_questions q
   set prompt = w.prompt
  from q_rewrite w
 where q.id = w.id;

-- ── Assertions ─────────────────────────────────────────────────────────────
do $$
declare v_n int; v_max int; v_longest text; v_rev int;
begin
  select count(*) into v_n from ask_questions q join q_rewrite w on w.id = q.id
   where q.prompt = w.prompt;
  if v_n <> (select count(*) from q_rewrite) then
    raise exception 'sql/51: only % of % rewrites landed', v_n, (select count(*) from q_rewrite);
  end if;

  -- Nothing but the prompt moved. The anchors are the instrument, and this file
  -- is not allowed to have touched them.
  select count(*) into v_n from ask_options o join q_rewrite w on w.id = o.question_id;
  if v_n <> (select count(*) from q_rewrite) * 4 then
    raise exception 'sql/51: the rewritten questions no longer carry four anchors each (% found)', v_n;
  end if;

  -- The bank as a whole still holds its shape — the counts sql/35 and sql/44
  -- assert, unchanged by a rewording.
  select count(*) into v_n from ask_questions q join ask_attributes a on a.id = q.attribute_id
   where q.active and a.active and not q.is_reference;
  if v_n < 35 or v_n > 38 then
    raise exception 'sql/51: R2 is now % questions, outside the 35-38 the instrument was cut to', v_n;
  end if;
  select count(*) into v_n from ask_questions where active and in_r1;
  if v_n <> 8 then raise exception 'sql/51: R1 is no longer 8 questions, it is %', v_n; end if;

  select max(length(q.prompt)), (array_agg(q.id order by length(q.prompt) desc))[1]
    into v_max, v_longest
  from ask_questions q join ask_attributes a on a.id = q.attribute_id
  where q.active and a.active and not q.is_reference;

  select bank_revision into v_rev from ask_bank_meta;

  raise notice 'sql/51 ok — % prompts tightened; longest live question is now % chars (%); bank revision %',
    (select count(*) from q_rewrite), v_max, v_longest, v_rev;
end $$;
