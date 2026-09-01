-- ═══════════════════════════════════════════════════════════════════════════
-- 43 — R1 carries into R2, because asking the same fourteen questions twice is
--      why the interview runs an hour
--
-- Measured from the first three real interviews, not estimated:
--
--     Shobha Pathak   40 questions   42 min   65 s/question
--     Akshit Malik    40 questions   49 min   75 s/question
--     Gaurav Singh    15 questions   23 min  100 s/question (first sitting)
--
-- So the working pace is roughly 70 s per question — you ask, they answer for
-- half a minute, you pick an anchor. That is not slow; it is what a behaviourally
-- anchored question costs. **40 questions × 70 s is 47 minutes and no interface
-- change gets that under 40.** The arithmetic is the constraint, not the UI.
--
-- The structural waste: R1 is the five priority attributes (14 questions). R2 is
-- all fourteen attributes (40 questions) — **including those same five.** Run both
-- as designed and the candidate answers the R1 questions twice, once to the team
-- and once again to Depesh. Nobody had run an R1 yet, so nobody had noticed.
--
--     R1   14 questions   ~17 min   team, on the phone
--     R2   26 questions   ~30 min   the rest, and only the rest
--
-- Same 40 questions, same coverage, no reduction in the instrument — split across
-- two calls and two people, which is the entire point of putting ASK in the
-- team's hands. Depesh's part fits in 30 minutes.
--
-- ── HOW ───────────────────────────────────────────────────────────────────
--
-- When an R2 is started for a candidate with a SUBMITTED R1, that R1's answers
-- are copied onto the new R2 scorecard, each row stamped with `carried_from`.
-- Three things follow for free, which is why it is done this way rather than by
-- teaching every reader about two scorecards:
--
--   · the interview flow already resumes at the first unanswered question, so the
--     interviewer opens it and lands on question 15 with nothing to skip past
--   · `recompute_ask_totals()` already sums the rows, so the R2 total covers all
--     forty without knowing anything about R1
--   · one scorecard is one complete reading of a person, which is what a reader
--     wants, while `carried_from` keeps the provenance so the review screen can
--     say who actually scored each answer and on which call
--
-- Nothing is copied from an UNSUBMITTED R1: a half-finished screen is not a
-- reading, and carrying it forward would freeze a judgement its author had not
-- finished making.
-- ═══════════════════════════════════════════════════════════════════════════

alter table ask_scores
  add column if not exists carried_from uuid references ask_scorecards(id) on delete set null;

comment on column ask_scores.carried_from is
  'The R1 scorecard this answer was scored on, when it was carried into an R2 so '
  'the same question is not asked twice. Null means it was scored on this '
  'scorecard. on delete set null: losing the provenance is bad, losing the answer '
  'would be worse.';

create index if not exists ask_scores_carried_from_idx
  on ask_scores (carried_from) where carried_from is not null;

-- ── start_ask, carrying R1 forward ────────────────────────────────────────
create or replace function start_ask(p_candidate_id uuid, p_round text,
                                     p_client_context text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_id uuid; v_staff uuid; v_name text; v_new boolean := false;
  v_r1 uuid; v_r1_by text; v_r1_on date; v_carried int := 0;
begin
  if not is_staff() then raise exception 'start_ask: staff only'; end if;
  if p_round not in ('r1', 'r2') then raise exception 'Round must be r1 or r2.'; end if;

  select full_name into v_name from candidates where id = p_candidate_id;
  if v_name is null then raise exception 'No such candidate.'; end if;
  select id into v_staff from staff where auth_uid = auth.uid();

  -- Resume the open one if there is one. A dropped call mid-interview is the
  -- normal case, not the exception.
  select id into v_id from ask_scorecards
  where candidate_id = p_candidate_id and round = p_round and submitted_at is null;

  if v_id is null then
    insert into ask_scorecards (candidate_id, round, interviewer_id, client_context,
                                bank_revision)
    values (p_candidate_id, p_round, v_staff, nullif(btrim(p_client_context), ''),
            (select bank_revision from ask_bank_meta))
    returning id into v_id;
    v_new := true;

    -- ── The carry-forward, on a fresh R2 only ────────────────────────────
    -- Only on creation: a resumed scorecard has already had this done, and doing
    -- it again would overwrite answers the interviewer has since changed.
    if p_round = 'r2' then
      select sc.id, st.full_name, sc.conducted_on
        into v_r1, v_r1_by, v_r1_on
      from ask_scorecards sc
      left join staff st on st.id = sc.interviewer_id
      where sc.candidate_id = p_candidate_id and sc.round = 'r1'
        and sc.submitted_at is not null
      order by sc.submitted_at desc limit 1;

      if v_r1 is not null then
        insert into ask_scores (scorecard_id, question_id, score, note,
                                question_text, option_label, carried_from)
        select v_id, s.question_id, s.score, s.note,
               s.question_text, s.option_label, v_r1
        from ask_scores s
        join ask_questions q on q.id = s.question_id
        join ask_attributes a on a.id = q.attribute_id
        -- Only the attributes R1 is actually responsible for. If R1 somehow
        -- carries an answer to a non-priority question, that is not a reading
        -- this R2 should inherit — R2 is going to ask it properly.
        where s.scorecard_id = v_r1 and a.priority and q.active and a.active
        on conflict (scorecard_id, question_id) do nothing;
        v_carried := (select count(*) from ask_scores where scorecard_id = v_id);
      end if;
    end if;
  elsif p_client_context is not null then
    update ask_scorecards set client_context = nullif(btrim(p_client_context), '')
    where id = v_id;
  end if;

  -- On a resumed card, report the carry-forward that happened when it was created.
  if not v_new and p_round = 'r2' then
    -- No max() over uuid in Postgres. The first draft used one and every resume
    -- of an R2 failed with "function max(uuid) does not exist" — which reached the
    -- browser as the interview screen simply never appearing.
    select count(*) into v_carried
    from ask_scores s where s.scorecard_id = v_id and s.carried_from is not null;
    select s.carried_from into v_r1
    from ask_scores s where s.scorecard_id = v_id and s.carried_from is not null
    limit 1;
    if v_r1 is not null then
      select st.full_name, sc.conducted_on into v_r1_by, v_r1_on
      from ask_scorecards sc left join staff st on st.id = sc.interviewer_id
      where sc.id = v_r1;
    end if;
  end if;

  return jsonb_build_object(
    'scorecard_id', v_id, 'resumed', not v_new,
    'candidate', v_name, 'round', p_round,
    -- What the interviewer needs to know before they start talking: how much of
    -- this has already been answered by somebody else, and by whom.
    'carried', jsonb_build_object(
      'from', v_r1, 'count', coalesce(v_carried, 0),
      'by', v_r1_by, 'on', v_r1_on,
      'remaining', (
        select count(*) from ask_questions q
        join ask_attributes a on a.id = q.attribute_id
        where q.active and a.active and not q.is_reference
          and (p_round = 'r2' or a.priority)
          and not exists (select 1 from ask_scores s
                          where s.scorecard_id = v_id and s.question_id = q.id))),
    'answered', coalesce((
      select jsonb_object_agg(question_id, jsonb_build_object(
        'score', score, 'note', note,
        -- The flow greys these out rather than hiding them: an interviewer should
        -- be able to see what the phone screen concluded, and to overrule it.
        'carried', carried_from is not null))
      from ask_scores where scorecard_id = v_id), '{}'::jsonb));
end $$;

-- ── The review screen needs the provenance too ────────────────────────────
create or replace function get_ask_scorecard(p_scorecard uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not is_staff() then raise exception 'get_ask_scorecard: staff only'; end if;

  select jsonb_build_object(
    'id', c.id, 'candidate_id', c.candidate_id, 'candidate', cand.full_name,
    'round', c.round, 'interviewer', st.full_name,
    'client_context', c.client_context, 'conducted_on', c.conducted_on,
    'started_at', c.started_at, 'submitted_at', c.submitted_at,
    'bank_revision', c.bank_revision,
    'total', c.total, 'max_total', c.max_total, 'pct', c.pct,
    'attributes', c.attributes,
    'carried_count', (select count(*) from ask_scores s
                      where s.scorecard_id = c.id and s.carried_from is not null),
    'outstanding_refs', (
      select count(*) from ask_questions q
      join ask_attributes a on a.id = q.attribute_id
      where q.is_reference and q.active and a.active
        and (c.round = 'r2' or a.priority)
        and not exists (select 1 from ask_scores s
                         where s.scorecard_id = c.id and s.question_id = q.id)),
    -- The answers as they were given, against the wording they were given
    -- against. Never re-joined to the live bank.
    'answers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'question_id', s.question_id, 'question', s.question_text,
        'score', s.score, 'chose', s.option_label, 'note', s.note,
        'attribute', q.attribute_id, 'is_reference', q.is_reference,
        -- Who actually formed this judgement, and on which call. Without this a
        -- reader credits the whole scorecard to whoever ran R2.
        'carried', s.carried_from is not null,
        'carried_by', (select st2.full_name from ask_scorecards sc2
                       left join staff st2 on st2.id = sc2.interviewer_id
                       where sc2.id = s.carried_from),
        'carried_round', (select upper(sc2.round) from ask_scorecards sc2
                          where sc2.id = s.carried_from))
      order by a2.sort_order, q.sort_order)
      from ask_scores s
      join ask_questions q on q.id = s.question_id
      join ask_attributes a2 on a2.id = q.attribute_id
      where s.scorecard_id = c.id), '[]'::jsonb))
  into v
  from ask_scorecards c
  join candidates cand on cand.id = c.candidate_id
  left join staff st on st.id = c.interviewer_id
  where c.id = p_scorecard;

  if v is null then raise exception 'No such scorecard.'; end if;
  return v;
end $$;

-- ── How long each round actually takes, from the answers themselves ───────
-- The decision above was made from three interviews read by hand. Once there are
-- thirty it should be readable on a screen, and it should be the thing that says
-- whether R1 and R2 are the right lengths — not a number anybody remembers.
create or replace view v_ask_pacing as
select
  sc.round,
  count(*) as interviews,
  round(avg(x.answers)) as avg_questions,
  round(avg(x.minutes)) as avg_minutes,
  round(avg(x.seconds_per_answer)) as avg_seconds_per_answer,
  round(percentile_cont(0.5) within group (order by x.minutes)) as median_minutes
from ask_scorecards sc
join lateral (
  select count(*) as answers,
         extract(epoch from (max(s.answered_at) - min(s.answered_at))) / 60 as minutes,
         extract(epoch from (max(s.answered_at) - min(s.answered_at)))
           / nullif(count(*) - 1, 0) as seconds_per_answer
  from ask_scores s
  where s.scorecard_id = sc.id and s.carried_from is null
) x on true
where sc.submitted_at is not null and x.answers > 1
group by sc.round;

alter view v_ask_pacing set (security_invoker = true);
revoke all on v_ask_pacing from anon;
grant select on v_ask_pacing to authenticated;

-- ── Assertions ────────────────────────────────────────────────────────────
do $$
declare
  v_cand uuid; v_r1 uuid; v_r2 uuid; v_q text; v_res jsonb;
  v_r1_qs int; v_r2_only int; v_carried int; v_src text;
begin
  select pg_get_functiondef(p.oid) into v_src from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'start_ask';
  if v_src not like '%carried_from%' then
    raise exception 'start_ask does not carry R1 forward';
  end if;
  if v_src not like '%submitted_at is not null%' then
    raise exception 'start_ask would carry forward an unfinished R1';
  end if;

  if not is_staff() then
    raise notice 'sql/43: carry-forward present in start_ask; behaviour covered by test/ask.js';
    return;
  end if;

  select count(*) into v_r1_qs from ask_questions q
  join ask_attributes a on a.id = q.attribute_id
  where q.active and a.active and a.priority and not q.is_reference;
  select count(*) into v_r2_only from ask_questions q
  join ask_attributes a on a.id = q.attribute_id
  where q.active and a.active and not a.priority and not q.is_reference;

  insert into candidates (full_name, contact, consent_version, consent_at)
  values ('ZZ_FIXTURE carry forward', '{}'::jsonb, 'pending', now()) returning id into v_cand;

  -- Run and submit an R1.
  v_r1 := (start_ask(v_cand, 'r1')->>'scorecard_id')::uuid;
  for v_q in
    select q.id from ask_questions q join ask_attributes a on a.id = q.attribute_id
    where q.active and a.active and a.priority and not q.is_reference
  loop
    perform save_ask_score(v_r1, v_q, 3, null);
  end loop;
  perform submit_ask(v_r1);

  -- Now the R2 that should inherit it.
  v_res := start_ask(v_cand, 'r2');
  v_r2 := (v_res->>'scorecard_id')::uuid;

  if (v_res->'carried'->>'count')::int <> v_r1_qs then
    raise exception 'R2 carried % answers forward, expected %',
      v_res->'carried'->>'count', v_r1_qs;
  end if;
  if (v_res->'carried'->>'remaining')::int <> v_r2_only then
    raise exception 'R2 says % questions remain, expected % — the interviewer '
                    'would be told the wrong length', v_res->'carried'->>'remaining', v_r2_only;
  end if;
  if (v_res->'carried'->>'by') is null then
    raise exception 'the carry-forward does not say who ran the R1';
  end if;

  -- Every carried row must be attributed, and none of them invented.
  select count(*) into v_carried from ask_scores
  where scorecard_id = v_r2 and carried_from = v_r1;
  if v_carried <> v_r1_qs then
    raise exception 'expected % rows stamped carried_from, found %', v_r1_qs, v_carried;
  end if;
  if exists (select 1 from ask_scores s join ask_questions q on q.id = s.question_id
             join ask_attributes a on a.id = q.attribute_id
             where s.scorecard_id = v_r2 and s.carried_from is not null and not a.priority) then
    raise exception 'a non-priority answer was carried forward — R2 must ask those itself';
  end if;

  -- Resuming must not re-copy, and must not clobber an overruled answer.
  perform save_ask_score(v_r2, (select q.id from ask_questions q
    join ask_attributes a on a.id = q.attribute_id
    where q.active and a.active and a.priority and not q.is_reference limit 1), 0, 'overruled');
  v_res := start_ask(v_cand, 'r2');
  if (v_res->>'resumed')::boolean is not true then
    raise exception 'starting again created a second open R2';
  end if;
  if (select score from ask_scores where scorecard_id = v_r2
      and question_id = (select q.id from ask_questions q
        join ask_attributes a on a.id = q.attribute_id
        where q.active and a.active and a.priority and not q.is_reference limit 1)) <> 0 then
    raise exception 'resuming overwrote an answer the interviewer had changed';
  end if;

  -- Finish the R2 and check the total covers all forty, not twenty-six.
  for v_q in
    select q.id from ask_questions q join ask_attributes a on a.id = q.attribute_id
    where q.active and a.active and not q.is_reference
      and not exists (select 1 from ask_scores s
                      where s.scorecard_id = v_r2 and s.question_id = q.id)
  loop
    perform save_ask_score(v_r2, v_q, 2, null);
  end loop;
  v_res := submit_ask(v_r2);
  if (v_res->>'max_total')::int <> (v_r1_qs + v_r2_only) * 3 then
    raise exception 'the R2 total covers % points, expected % — the carried '
                    'answers are not in the reading',
      v_res->>'max_total', (v_r1_qs + v_r2_only) * 3;
  end if;

  -- And an R2 with no R1 behind it carries nothing.
  perform purge_candidate(v_cand);
  insert into candidates (full_name, contact, consent_version, consent_at)
  values ('ZZ_FIXTURE no r1', '{}'::jsonb, 'pending', now()) returning id into v_cand;
  v_res := start_ask(v_cand, 'r2');
  if (v_res->'carried'->>'count')::int <> 0 then
    raise exception 'an R2 with no submitted R1 carried % answers', v_res->'carried'->>'count';
  end if;
  if (v_res->'carried'->>'remaining')::int <> v_r1_qs + v_r2_only then
    raise exception 'without an R1 the whole bank should remain, got %',
      v_res->'carried'->>'remaining';
  end if;

  -- An unfinished R1 is not a reading and must not be inherited.
  perform purge_candidate(v_cand);
  insert into candidates (full_name, contact, consent_version, consent_at)
  values ('ZZ_FIXTURE half r1', '{}'::jsonb, 'pending', now()) returning id into v_cand;
  v_r1 := (start_ask(v_cand, 'r1')->>'scorecard_id')::uuid;
  perform save_ask_score(v_r1, (select q.id from ask_questions q
    join ask_attributes a on a.id = q.attribute_id
    where q.active and a.active and a.priority and not q.is_reference limit 1), 3, null);
  v_res := start_ask(v_cand, 'r2');
  if (v_res->'carried'->>'count')::int <> 0 then
    raise exception 'an unfinished R1 was carried into R2';
  end if;

  perform purge_candidate(v_cand);
  raise notice 'sql/43: R1 carries % answers into R2, leaving % to ask', v_r1_qs, v_r2_only;
end $$;
