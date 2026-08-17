-- ═══════════════════════════════════════════════════════════════════════════
-- 30 — which side they sit on, and a shuffle that actually shuffles
--
-- Two requests, and checking the first one uncovered that the second was
-- already half-built and quietly broken.
--
-- ── 1. "SHOW WHICH SIDE THE CANDIDATE SITS ON" ─────────────────────────────
--
-- MOT and STY are the two dimensions with no better end. `STY 0` does not mean
-- "no interpersonal skill", it means *task-direct on all five items* — brisk,
-- to the point, respects the buyer's time. Printed as a bare `0` beside seven
-- dimensions where 0 genuinely is bad, it reads as a failing grade.
--
-- The dictionary already explains this at length. Nobody reads a dictionary
-- while scanning a list. So the side travels with the number, everywhere the
-- number appears, from one definition: `bipolar_side()`.
--
-- ── 2. "CAN WE RANDOMISE OPTIONS FOR ALL QUESTIONS?" ───────────────────────
--
-- They already were — `order by md5(o.option_key || v_session::text)`. But that
-- seed omits the ITEM, so:
--
-- > **Every one of the 44 items received the identical permutation.** For a given
-- > candidate, position 1 was always option `c`, on every single question.
--
-- Which means displayed position and option letter were perfectly correlated,
-- and the `straightline` flag — whose own comment says it uses `position_shown`
-- "because option order is randomised per session, and option_key would miss a
-- candidate clicking always the second one" — could not tell those two things
-- apart. It was detecting "picked the same letter", described as something
-- stronger. A safeguard that cannot fail is not a safeguard; this one could not
-- succeed either.
--
-- Fixed by seeding on (item, session). Now each item has its own order, so
-- position and content are independent, and the distinction the flag was written
-- to make becomes real for the first time.
--
-- ── 3. THE ORDERED SCALES SHOULD NEVER HAVE BEEN SHUFFLED ──────────────────
--
-- The shuffle applied to every format, including `behavioural_freq`, whose
-- options are a SCALE:
--
--     Five or more days · Three to four days · One to two days · None
--
-- Presented to every candidate so far as: One to two days · Five or more days ·
-- None · Three to four. A scale out of order is not neutral — it is harder to
-- read, invites mis-clicks, and every mis-click lands on a different score.
-- Three real dimensions take a behavioural-frequency item each, so this has been
-- adding noise to RES, DRV and DSC for every candidate.
--
-- **Shuffle what is unordered. Never shuffle a scale.** SJT options and the
-- either/or pairs are unordered and get shuffled. Frequency scales and
-- True/False keep their order — the second because True/False flipping between
-- items reads as a bug to the person taking it, and three items would not add
-- much signal anyway.
--
-- ── 4. AND THE ALGORITHM THAT ASKED FOR ───────────────────────────────────
--
-- *"someone random tapping will most likely give the most random answers which
--  I think we can flag by using some algo coded inside"*
--
-- Half right, and the half that is wrong matters. Random ANSWERS cannot be
-- detected from the answers alone: a genuinely mixed candidate and a random
-- tapper produce the same-looking spread, and nothing in the bank distinguishes
-- them. Telling them apart needs reversed item pairs — two items that ask the
-- same thing in opposite directions, where agreeing with both is incoherent.
-- That is item-writing, not code, and it is the honest next step.
--
-- What IS detectable, and only becomes detectable now that the shuffle varies
-- per item, is POSITION. With four options in an independent order per item,
-- chance says any one position gets picked about a quarter of the time. Somebody
-- tapping the second row lands on a different answer every time, so their
-- content looks random while their POSITION does not. `position_bias` measures
-- exactly that, and says how far above chance it is rather than asserting a
-- verdict.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Which formats may be reordered ─────────────────────────────────────────
create or replace function format_is_shufflable(p_format text)
returns boolean language sql immutable as $$
  -- SJT options are four alternative actions with no natural sequence, and the
  -- either/or pairs are two sides of one trade-off. Both are unordered.
  select p_format in ('sjt', 'forced_choice');
$$;

-- ── The order one candidate sees for one item ─────────────────────────────
-- Derived, not stored: a pure function of (item, session), so a resumed session
-- shows exactly the same order it showed yesterday without a table to keep in
-- step. Storing it would be a second copy of something already determined.
create or replace function item_display_order(p_item_id text, p_session uuid)
returns text[] language sql stable as $$
  select array_agg(o.option_key order by
           case when format_is_shufflable(i.format)
                -- The ITEM is in the seed. Without it every item in a session
                -- got the same permutation, which is the bug this file fixes.
                then md5(o.option_key || p_item_id || p_session::text)
                -- A scale keeps its authored order.
                else lpad(o.sort_order::text, 6, '0') end)
  from item_options o
  join items i on i.id = o.item_id
  where o.item_id = p_item_id;
$$;

grant execute on function format_is_shufflable(text) to anon, authenticated;
grant execute on function item_display_order(text, uuid) to anon, authenticated;

-- ── Deliver the items in that order ───────────────────────────────────────
create or replace function start_assessment(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_candidate uuid;
  v_consent   text;
  v_session   uuid;
  v_items     text[];
  v_done      record;
  missing     text[];
begin
  missing := consent_settings_missing();
  if array_length(missing, 1) > 0 then
    raise exception 'This assessment is not yet configured. Please contact the recruiter.';
  end if;

  select t.candidate_id, c.consent_version into v_candidate, v_consent
  from assessment_tokens t
  join candidates c on c.id = t.candidate_id
  where t.token = p_token and t.expires_at > now();

  if v_candidate is null then
    raise exception 'This assessment link is not valid or has expired.';
  end if;

  select id, completed_at into v_done
  from assessment_sessions
  where candidate_id = v_candidate and completed_at is not null
  order by completed_at desc limit 1;

  if v_done.id is not null then
    return jsonb_build_object('already_complete', true,
                              'session_id', v_done.id,
                              'completed_at', v_done.completed_at);
  end if;

  if v_consent is null or v_consent = 'pending' then
    raise exception 'Consent has not been recorded for this assessment.';
  end if;

  select id, item_set into v_session, v_items
  from assessment_sessions
  where candidate_id = v_candidate and completed_at is null
  order by started_at desc limit 1;

  if v_session is null then
    v_items := array(select id from items where active and bank_version = '1.1' order by sort_order);
    insert into assessment_sessions (candidate_id, bank_version, item_set, started_at)
    values (v_candidate, '1.1', v_items, now())
    returning id into v_session;
  end if;

  update assessment_tokens set consumed_at = coalesce(consumed_at, now()) where token = p_token;
  update candidates set last_activity_at = now() where id = v_candidate;

  return jsonb_build_object(
    'session_id', v_session,
    'answered', (select coalesce(jsonb_object_agg(item_id, option_key), '{}'::jsonb)
                   from candidate_responses where session_id = v_session),
    'items', (
      select coalesce(jsonb_agg(x order by (x->>'sort_order')::int), '[]'::jsonb) from (
        select jsonb_build_object(
          'id', i.id,
          'format', i.format,
          'stem', i.stem,
          'framing_note', i.framing_note,
          'block', i.present_block,
          'sort_order', i.sort_order,
          'options', (
            -- One order, one definition. The client renders what it is given and
            -- is never asked where anything was — see save_response.
            select jsonb_agg(jsonb_build_object('key', k, 'text', o.option_text)
                             order by ord.n)
            from unnest(item_display_order(i.id, v_session)) with ordinality as ord(k, n)
            join item_options o on o.item_id = i.id and o.option_key = ord.k
          )
        ) as x
        from items i where i.id = any(v_items) and i.active
      ) t
    )
  );
end $$;

grant execute on function start_assessment(text) to anon;

-- ── The client no longer reports the position ─────────────────────────────
-- It was sending the index it happened to render at. The server already knows
-- the order it dealt, so asking is both redundant and trusting: a tapper's
-- browser is the last thing that should be defining the evidence against them.
-- The parameter stays in the signature so the existing call site keeps working,
-- and is ignored.
create or replace function save_response(
  p_token text, p_item_id text, p_option_key text,
  p_seconds numeric default null, p_position int default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_session uuid; v_candidate uuid; v_pos int;
begin
  select t.candidate_id, s.id into v_candidate, v_session
  from assessment_tokens t
  join assessment_sessions s on s.candidate_id = t.candidate_id and s.completed_at is null
  where t.token = p_token and t.expires_at > now()
  order by s.started_at desc limit 1;

  if v_session is null then
    raise exception 'No open assessment for this link.';
  end if;

  if not exists (select 1 from item_options where item_id = p_item_id and option_key = p_option_key) then
    raise exception 'Invalid option for item %', p_item_id;
  end if;

  select n into v_pos
  from unnest(item_display_order(p_item_id, v_session)) with ordinality as ord(k, n)
  where ord.k = p_option_key;

  insert into candidate_responses (session_id, item_id, option_key, seconds_on_item, position_shown)
  values (v_session, p_item_id, p_option_key, p_seconds, v_pos)
  on conflict (session_id, item_id) do update set
    option_key = excluded.option_key,
    seconds_on_item = excluded.seconds_on_item,
    position_shown = excluded.position_shown,
    answered_at = now();

  update candidates set last_activity_at = now() where id = v_candidate;
end $$;

grant execute on function save_response(text, text, text, numeric, int) to anon;

-- ── Which scheme a session was dealt under ───────────────────────────────
-- Sessions answered before this migration saw ONE permutation across all items,
-- so their stored `position_shown` is just the option letter under a different
-- name. Running the new measure over them would produce a confident number
-- measuring the wrong thing — Shaquib reads as 2.08× chance on the old data, and
-- that is entirely explained by his picking one letter often.
--
-- **A measure that cannot distinguish itself from the thing it replaced must say
-- so, not average over both.** The scheme is stamped on the session, and the old
-- ones are excluded by name rather than silently included.
alter table assessment_sessions
  add column if not exists order_scheme text not null default 'per_item'
  check (order_scheme in ('per_session', 'per_item'));

-- Everything that already exists was dealt the old way. This must run before any
-- new session is created, and it is safe to re-run: a session that has responses
-- and predates the fix keeps its label, and new sessions default to per_item.
update assessment_sessions s set order_scheme = 'per_session'
where s.started_at < '2026-08-13 12:00:00+00'::timestamptz
  and s.order_scheme = 'per_item';

-- ── Position bias, stated against chance ─────────────────────────────────
-- Returns the numbers rather than a yes/no, so the flag threshold and the
-- evidence for it are separable and the console can show its working.
create or replace function position_bias(p_session uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_n int; v_top int; v_pos int; v_chance numeric; v_share numeric; v_scheme text;
begin
  select order_scheme into v_scheme from assessment_sessions where id = p_session;
  if v_scheme is distinct from 'per_item' then
    return jsonb_build_object('measurable', false, 'answers', 0,
      'why', 'This assessment was dealt one option order across every question, so '
          || 'the position someone chose is the same fact as which letter they chose. '
          || 'Position can only be read separately from content for assessments taken '
          || 'after 13 Aug 2026.');
  end if;

  -- Only items whose order was genuinely shuffled. Counting the scales would
  -- credit the flag with evidence from questions that were never reordered.
  select count(*) into v_n
  from candidate_responses r join items i on i.id = r.item_id
  where r.session_id = p_session and r.position_shown is not null
    and format_is_shufflable(i.format);

  if coalesce(v_n, 0) < 10 then
    return jsonb_build_object('measurable', false, 'answers', coalesce(v_n, 0),
      'why', 'Fewer than ten reordered answers — not enough to separate a habit from chance.');
  end if;

  select r.position_shown, count(*) into v_pos, v_top
  from candidate_responses r join items i on i.id = r.item_id
  where r.session_id = p_session and r.position_shown is not null
    and format_is_shufflable(i.format)
  group by r.position_shown order by count(*) desc, r.position_shown limit 1;

  -- Chance is not a fixed 25%: the either/or items have two options and the SJT
  -- items four, so it is the mean of 1/n across the answers actually given.
  select avg(1.0 / o.n) into v_chance
  from candidate_responses r
  join items i on i.id = r.item_id
  join lateral (select count(*) as n from item_options where item_id = i.id) o on true
  where r.session_id = p_session and r.position_shown is not null
    and format_is_shufflable(i.format);

  v_share := v_top::numeric / v_n;

  return jsonb_build_object(
    'measurable', true, 'answers', v_n,
    'position', v_pos, 'times', v_top,
    'share', round(v_share, 3),
    'chance', round(v_chance, 3),
    'times_chance', round(v_share / nullif(v_chance, 0), 2));
end $$;

grant execute on function position_bias(uuid) to authenticated;

-- ── Which side of the scale, in words ────────────────────────────────────
create or replace function bipolar_side(p_code text, p_score numeric)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare d record; v_side text; v_lean text; v_label text;
begin
  select code, pole_0_label, pole_100_label, kind into d
  from dimensions where code = p_code;
  if d.code is null or d.kind <> 'bipolar' or p_score is null then return null; end if;

  -- Five bands, because five items give six possible scores and anything finer
  -- would imply a precision the instrument does not have.
  if    p_score <= 20 then v_side := 'low';      v_lean := 'fully';
  elsif p_score <  50 then v_side := 'low';      v_lean := 'leans';
  elsif p_score =  50 then v_side := 'balanced'; v_lean := 'no strong';
  elsif p_score <  80 then v_side := 'high';     v_lean := 'leans';
  else                     v_side := 'high';     v_lean := 'fully';
  end if;

  v_label := case
    when v_side = 'balanced' then 'no strong lean either way'
    when v_lean = 'fully' then 'fully ' ||
      case when v_side = 'low' then d.pole_0_label else d.pole_100_label end
    else 'leans ' ||
      case when v_side = 'low' then d.pole_0_label else d.pole_100_label end
  end;

  return jsonb_build_object(
    'side', v_side, 'lean', v_lean, 'label', v_label,
    'pole_0', d.pole_0_label, 'pole_100', d.pole_100_label,
    -- Said once, here, so no surface has to remember to add it.
    'note', 'Neither end is better. Which one fits depends on the role.');
end $$;

grant execute on function bipolar_side(text, numeric) to authenticated;

-- A whole profile's worth, for the list view.
create or replace function bipolar_sides(p_scores jsonb)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(d.code, bipolar_side(d.code, (p_scores->>d.code)::numeric)),
                  '{}'::jsonb)
  from dimensions d
  where d.active and d.kind = 'bipolar' and p_scores ? d.code;
$$;

grant execute on function bipolar_sides(jsonb) to authenticated;

-- ── Assertions ───────────────────────────────────────────────────────────
do $$
declare
  v_sess uuid := '11111111-2222-3333-4444-555555555555'::uuid;
  a text[]; b text[]; v jsonb; n int;
begin
  -- The shuffle must differ between two items in the SAME session. This is the
  -- whole bug: it did not.
  a := item_display_order('CCH-01', v_sess);
  b := item_display_order('CLS-01', v_sess);
  if a = b then
    raise exception 'two SJT items still receive the same permutation (% / %)',
                    array_to_string(a, ','), array_to_string(b, ',');
  end if;

  -- ...and must be stable for one item across calls, or a resumed session would
  -- renumber every position the candidate already answered against.
  if item_display_order('CCH-01', v_sess) <> a then
    raise exception 'item_display_order is not stable for the same (item, session)';
  end if;

  -- ...and must differ between sessions, or it is not randomised at all.
  if item_display_order('CCH-01', '99999999-8888-7777-6666-555555555555'::uuid) = a then
    raise exception 'two sessions receive the same permutation for one item';
  end if;

  -- A scale keeps its authored order, for every session.
  if item_display_order('BF-01', v_sess) <> array['a','b','c','d']
     or item_display_order('BF-01', gen_random_uuid()) <> array['a','b','c','d'] then
    raise exception 'a behavioural-frequency scale is being reordered: %',
                    array_to_string(item_display_order('BF-01', v_sess), ',');
  end if;
  -- Authored True-then-False, and it stays that way.
  if item_display_order('SD-01', v_sess) <> array['true','false'] then
    raise exception 'an sd_check item is being reordered: %',
                    array_to_string(item_display_order('SD-01', v_sess), ',');
  end if;

  -- Every shuffled item must still deal every one of its options exactly once.
  select count(*) into n from items i
  where i.active and array_length(item_display_order(i.id, v_sess), 1)
                     <> (select count(*) from item_options o where o.item_id = i.id);
  if n > 0 then raise exception '% item(s) deal the wrong number of options', n; end if;

  -- The side label must name a pole rather than a number.
  v := bipolar_side('STY', 0);
  if v->>'side' <> 'low' or v->>'label' not like 'fully %' then
    raise exception 'bipolar_side(STY, 0) is wrong: %', v;
  end if;
  if (bipolar_side('STY', 60))->>'lean' <> 'leans' then
    raise exception 'bipolar_side(STY, 60) should read as a lean, not a full pole';
  end if;
  if bipolar_side('RES', 90) is not null then
    raise exception 'bipolar_side must return null for a dimension that has a better end';
  end if;

  raise notice 'sql/30 ok — each item gets its own order, scales keep theirs, and a score names its side';
end $$;
