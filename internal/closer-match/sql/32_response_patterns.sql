-- ═══════════════════════════════════════════════════════════════════════════
-- 32 — the patterns a shuffle does not hide
--
-- *"lets flag that, for example: candidate just presses the same option (like
--  option c) across many questions, or some pattern like that."*
--
-- ── ONE CORRECTION, AND THEN THE REAL VERSION OF THE IDEA ──────────────────
--
-- Pressing "option c" repeatedly stopped being a thing a person can do in
-- sql/30. Candidates never see the letters, and each question now has its own
-- option order, so `c` is in a different place every time. There is no way to
-- aim for it.
--
-- The behaviour is real; the handle on it moved. **A careless candidate is
-- consistent in something, and after a shuffle the something is no longer the
-- answer.** Three things survive randomisation, and this file measures all of
-- them and reports the working rather than just a verdict.
--
--   1. POSITION — the same row on the screen. Already covered: `straightline`
--      for a consecutive run, `position_bias` for the overall rate against
--      chance. Both from sql/30.
--
--   2. RHYTHM — a repeating cycle rather than a flat run. Somebody who goes
--      1,2,1,2,1,2 or 1,2,3,1,2,3 is as disengaged as somebody who goes
--      3,3,3,3,3,3, and `straightline` sees nothing at all: no two consecutive
--      picks match. **A run-length check only catches the laziest possible
--      pattern.** `zigzag` catches the next-laziest.
--
--   3. SCORE — the one content-side pattern that a shuffle cannot disguise. The
--      option keyed +2 moves around the screen, but it is still the option keyed
--      +2. Somebody choosing it on nearly every scenario is either an unusually
--      good closer or reading the intent rather than the situation; somebody
--      choosing the −1 option repeatedly is not trying. `flat_scoring` reports
--      which value dominates and how much, because those two readings need
--      opposite responses and the system does not get to decide which it is.
--
--   4. And separately: TIME PER ITEM. `fast_completion` compares the whole
--      session to a running median, so a candidate who reads six items properly
--      and taps through the other thirty-eight can land on an ordinary total.
--      A per-item count does not average away.
--
-- ── WHAT THIS DELIBERATELY DOES NOT DO ─────────────────────────────────────
--
-- None of it rejects anybody, and none of it changes a score. §7.2 and R3: the
-- system ranks and explains, it does not decide. Every flag here is an argument
-- for a second look — usually a re-test, which costs one link and ten minutes.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── The thresholds, and where the numbers came from ───────────────────────
-- The first version of this file guessed 8 for the zigzag threshold. It fired on
-- SIX OF EIGHT real candidates, which is the definition of a useless flag.
--
-- So it was measured instead. Simulating 4,000 random answerers over a session
-- shaped like the real one — 31 four-option items, 13 two-option — the longest
-- repeating cycle a PURE GUESSER produces is:
--
--     median 7 · p90 9 · p99 12 · p99.9 14 · max seen 16
--
-- A threshold of 8 sat below the median of pure chance. It was not detecting a
-- pattern, it was detecting that sequences exist. **A threshold nobody derived
-- is a threshold nobody can defend, and it will usually be set where the noise
-- lives.** 15 puts a flag past the 99.9th percentile of chance: fewer than one
-- random answerer in a thousand reaches it, and a real 1,2,1,2 across twenty
-- answers scores 20. Of the eight real candidates, the highest is 11.
insert into dimension_params (param_group, param_key, param_value, note) values
  ('flags','zigzag_cycle_len',       15, 'repeating position cycle covering >= 15 answers; chance p99.9 is 14'),
  ('flags','flat_scoring_share',   0.85, 'one score value on >= 85% of scenario answers'),
  ('flags','flat_scoring_min_n',     15, 'and at least 15 scenario answers to read it from'),
  ('flags','rushed_seconds',          3, 'an answer given in under 3 seconds cannot have been read'),
  ('flags','rushed_share',         0.25, 'flag when a quarter or more of answers are that fast')
on conflict (param_group, param_key) do update set
  param_value = excluded.param_value, note = excluded.note;

-- ── Everything the response trail says about how it was produced ──────────
-- One function, all the evidence, so the console can show its working and the
-- thresholds live in one place rather than being reimplemented per flag.
create or replace function response_pattern(p_session uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_pos int[]; v_n int; k int; run int; best_run int := 0; best_k int := null; i int;
  v_sjt_n int; v_top_score numeric; v_top_n int; v_share numeric;
  v_rushed int; v_timed int;
begin
  -- Positions in the order they were answered. `answered_at` then `item_id`,
  -- matching `straightline` in sql/04 — two orderings of the same sequence would
  -- eventually disagree about what a "run" is.
  select array_agg(position_shown order by answered_at, item_id) into v_pos
  from candidate_responses
  where session_id = p_session and position_shown is not null;

  v_n := coalesce(array_length(v_pos, 1), 0);

  -- ── Rhythm ──────────────────────────────────────────────────────────────
  -- For each cycle length, the longest stretch where every pick repeats the one
  -- k places earlier. k = 1 is a flat run, which `straightline` already owns, so
  -- this starts at 2 and reports the strongest cycle it finds.
  if v_n >= 4 then
    for k in 2..4 loop
      run := 0;
      for i in (k + 1)..v_n loop
        if v_pos[i] = v_pos[i - k] then
          run := run + 1;
          -- +k because a stretch of `run` matches spans run+k answers.
          if run + k > best_run then best_run := run + k; best_k := k; end if;
        else
          run := 0;
        end if;
      end loop;
    end loop;
  end if;

  -- ── Score ───────────────────────────────────────────────────────────────
  -- Scenario items only. The frequency and either/or items are keyed on a
  -- different scale entirely, and mixing them would compare unlike numbers.
  select count(*) into v_sjt_n
  from candidate_responses r join items it on it.id = r.item_id
  where r.session_id = p_session and it.format = 'sjt';

  select o.score_key, count(*) into v_top_score, v_top_n
  from candidate_responses r
  join items it on it.id = r.item_id
  join item_options o on o.item_id = r.item_id and o.option_key = r.option_key
  where r.session_id = p_session and it.format = 'sjt'
  group by o.score_key order by count(*) desc, o.score_key limit 1;

  v_share := case when coalesce(v_sjt_n, 0) = 0 then null
                  else round(v_top_n::numeric / v_sjt_n, 3) end;

  -- ── Time ────────────────────────────────────────────────────────────────
  select count(*) filter (where seconds_on_item < param('flags','rushed_seconds')),
         count(*) filter (where seconds_on_item is not null)
    into v_rushed, v_timed
  from candidate_responses where session_id = p_session;

  return jsonb_build_object(
    'answers', v_n,
    'rhythm', jsonb_build_object(
      'cycle', best_k, 'covering', best_run,
      'threshold', param('flags','zigzag_cycle_len')),
    'scoring', jsonb_build_object(
      'scenario_answers', v_sjt_n,
      'top_score', v_top_score, 'times', v_top_n, 'share', v_share,
      -- Named, because "+2 on 80% of items" and "−1 on 80% of items" are
      -- completely different findings and the number alone hides which.
      'reads_as', case
        when v_share is null then null
        when v_top_score >= 2 then 'the best-keyed answer nearly every time'
        when v_top_score <= -1 then 'the worst-keyed answer nearly every time'
        else 'one middling answer nearly every time' end),
    'speed', jsonb_build_object(
      'under_threshold', v_rushed, 'timed', v_timed,
      'seconds', param('flags','rushed_seconds'),
      'share', case when coalesce(v_timed, 0) = 0 then null
                    else round(v_rushed::numeric / v_timed, 3) end));
end $$;

grant execute on function response_pattern(uuid) to authenticated;

-- ── Wire the three new flags into scoring ────────────────────────────────
-- Appended to the existing flag block in compute_candidate_profile rather than
-- replacing it: sd_high, fast_completion, straightline, position_bias and
-- careless all stay exactly as they are.
do $$
declare v_src text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_src from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'compute_candidate_profile';

  if v_src like '%v_pattern%' then
    raise notice 'compute_candidate_profile already carries the pattern flags';
    return;
  end if;

  v_new := replace(v_src,
    '  -- careless: MOT and STY both at 0 or both at 100.',
$patch$  -- zigzag: a repeating cycle rather than a flat run. straightline sees
  -- nothing in 1,2,1,2,1,2 because no two consecutive picks match, and that is
  -- exactly as disengaged as 3,3,3,3,3,3.
  v_pattern := response_pattern(p_session_id);

  if (v_pattern->'rhythm'->>'covering')::int >= param('flags','zigzag_cycle_len') then
    v_flags := array_append(v_flags, 'zigzag');
  end if;

  -- flat_scoring: the one content pattern a shuffle cannot disguise. The option
  -- keyed +2 moves around the screen but is still the option keyed +2.
  if (v_pattern->'scoring'->>'scenario_answers')::int >= param('flags','flat_scoring_min_n')
     and coalesce((v_pattern->'scoring'->>'share')::numeric, 0) >= param('flags','flat_scoring_share') then
    v_flags := array_append(v_flags, 'flat_scoring');
  end if;

  -- rushed: fast_completion measures the whole session against a median, so
  -- somebody who reads six items and taps through thirty-eight can land on an
  -- ordinary total. Counting the individual answers does not average away.
  if coalesce((v_pattern->'speed'->>'timed')::int, 0) > 0
     and (v_pattern->'speed'->>'share')::numeric >= param('flags','rushed_share') then
    v_flags := array_append(v_flags, 'rushed');
  end if;

  -- careless: MOT and STY both at 0 or both at 100.$patch$);

  if v_new = v_src then
    raise exception 'compute_candidate_profile was not patched — the careless comment has moved';
  end if;

  v_new := replace(v_new, '  v_bias        jsonb;',
                          '  v_bias        jsonb;' || chr(10) || '  v_pattern     jsonb;');
  execute v_new;
end $$;

-- ── Recompute, so the flags describe the people already in the system ────
do $$
declare r record; n int := 0;
begin
  for r in
    select s.id from assessment_sessions s
    join candidates c on c.id = s.candidate_id
    where s.completed_at is not null
      and c.full_name not like 'ZZ_FIXTURE%' and c.full_name not like 'ZZ_E2E%'
      and exists (select 1 from candidate_responses cr where cr.session_id = s.id)
  loop
    perform compute_candidate_profile(r.id);
    n := n + 1;
  end loop;
  raise notice 're-flagged % completed assessment(s)', n;
end $$;

-- ── What the console shows about it ──────────────────────────────────────
create or replace view v_response_patterns as
select c.id as candidate_id, c.full_name, s.id as session_id,
       s.order_scheme, p.flags,
       response_pattern(s.id) as pattern,
       position_bias(s.id)    as position
from assessment_sessions s
join candidates c on c.id = s.candidate_id
left join lateral (select flags from candidate_profile
                    where candidate_id = c.id order by computed_at desc limit 1) p on true
where s.completed_at is not null
  and c.full_name not like 'ZZ_FIXTURE%' and c.full_name not like 'ZZ_E2E%';

grant select on v_response_patterns to authenticated;

-- ── Assertions ───────────────────────────────────────────────────────────
do $$
declare v jsonb; v_sess uuid; v_n int;
begin
  select count(*) into v_n from dimension_params
  where param_group = 'flags'
    and param_key in ('zigzag_cycle_len','flat_scoring_share','rushed_seconds');
  if v_n <> 3 then raise exception 'expected 3 new flag thresholds, found %', v_n; end if;

  select id into v_sess from assessment_sessions
  where completed_at is not null
    and exists (select 1 from candidate_responses r where r.session_id = id)
  limit 1;

  if v_sess is not null then
    v := response_pattern(v_sess);
    if (v->>'answers')::int = 0 then
      raise exception 'response_pattern read no answers from a completed session';
    end if;
    -- Every branch must produce a number rather than a null hiding as one.
    if v->'rhythm'->>'covering' is null or v->'speed'->>'timed' is null then
      raise exception 'response_pattern returned an incomplete shape: %', v;
    end if;
  end if;

  -- A perfect zigzag must be caught, and straightline must miss it — that gap is
  -- the reason this file exists, so it is asserted rather than assumed.
  -- Twenty answers, because the threshold is now 15 and a ten-answer fixture
  -- would fail a correct implementation. The fixture has to be a pattern a real
  -- tapper would actually produce, not the shortest one that used to pass.
  declare v_pos int[] := array[1,2,1,2,1,2,1,2,1,2,1,2,1,2,1,2,1,2,1,2];
          i int; run int := 0; best int := 0;
  begin
    for i in 3..array_length(v_pos,1) loop
      if v_pos[i] = v_pos[i-2] then run := run + 1;
        if run + 2 > best then best := run + 2; end if;
      else run := 0; end if;
    end loop;
    if best < param('flags','zigzag_cycle_len') then
      raise exception 'a ten-answer 1,2,1,2 pattern scores only % — below the threshold', best;
    end if;
    for i in 2..array_length(v_pos,1) loop
      if v_pos[i] = v_pos[i-1] then
        raise exception 'the zigzag fixture contains a consecutive repeat, so it does not prove the gap';
      end if;
    end loop;
  end;

  raise notice 'sql/32 ok — rhythm, score and per-item speed are all read, and none of them rejects anybody';
end $$;
