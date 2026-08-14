-- ═══════════════════════════════════════════════════════════════════════════
-- 29 — the other half of the comparison
--
-- Found by reading the live shortlists rather than the code. All fifteen rows
-- across three real requirements said the candidate does not pass, every one
-- with the same two reasons:
--
--     language: en, hi below fluent
--     work mode: cannot do remote
--
-- That is not five candidates who happen to share two disqualifications. It is
-- **`candidates.direct_fields` being null for every real candidate**, because
-- nothing in the system has ever written it. The column has existed since
-- `sql/01`; the golden-case fixtures set it; no surface, anywhere, collects it.
-- §9.1 has been comparing a client's requirements against an empty object since
-- the day it was written, and the engine dutifully reported the result.
--
-- ── THE SECOND BUG, WHICH IS THE MORE INTERESTING ONE ──────────────────────
--
-- With `direct_fields = {}`, four of the six filters silently PASSED and two
-- FAILED. Not by design — by SQL semantics:
--
--     (null)::numeric > 350000   →  NULL  →  `if NULL then` never fires
--
-- So salary, notice period, years of experience and location said "fine", while
-- language and work mode — written as `not (... = any(...))` — said "no". The
-- same absence of the same data produced approval four times and rejection
-- twice, in one function, silently.
--
-- > **Unknown is not a value. A filter that cannot run has not passed.**
--
-- So a check now has three outcomes, and the third is visible: `fails` for a
-- definite mismatch, `unknown` for a check that could not be run, and
-- `hard_filter_pass` meaning *confirmed eligible* rather than *nothing objected*.
-- A recruiter reading "work mode not recorded" can go and ask. A recruiter
-- reading "cannot do remote" goes and apologises to a candidate who never said
-- any such thing.
--
-- ── AND WHAT THE FIXTURES WERE RELYING ON ──────────────────────────────────
--
-- Twelve of the thirteen golden-case fixtures have no `direct_fields` at all.
-- They passed the one fixture requirement that has hard filters *by the same
-- accident* — null comparisons yielding NULL. Making unknown visible would have
-- turned them all ineligible and broken the suite, which is the suite doing its
-- job: it caught that its own fixtures depended on undefined behaviour. They now
-- state their eligibility explicitly instead of inheriting it from a quirk.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Three outcomes, not two ─────────────────────────────────────────────
create or replace function hard_filter_check(p_candidate jsonb, p_filters jsonb)
returns jsonb language plpgsql stable as $$
declare
  fails   text[] := '{}';
  unknown text[] := '{}';
  lang jsonb; c jsonb;
begin
  c := coalesce(p_candidate, '{}'::jsonb);
  if p_filters is null or p_filters = '{}'::jsonb then
    return jsonb_build_object('fails', to_jsonb(fails), 'unknown', to_jsonb(unknown));
  end if;

  -- Language + fluency floor. Each required language is checked separately, so
  -- "fluent in English but not Hindi" names the one that is missing.
  if p_filters ? 'languages_required' then
    for lang in select jsonb_array_elements(p_filters->'languages_required') loop
      if not (c ? 'languages') or c->'languages' = '{}'::jsonb then
        unknown := array_append(unknown, format('language (%s): not recorded', lang->>'lang'));
      elsif fluency_rank(c->'languages'->>(lang->>'lang')) < fluency_rank(lang->>'min') then
        fails := array_append(fails, format('language: %s below %s',
                 lang->>'lang', lang->>'min'));
      end if;
    end loop;
  end if;

  -- Location
  if p_filters ? 'locations' then
    if c->>'location' is null then
      unknown := array_append(unknown, 'location: not recorded');
    elsif not (c->>'location' = any(array(select jsonb_array_elements_text(p_filters->'locations')))) then
      fails := array_append(fails, format('location: %s not in the client''s list', c->>'location'));
    end if;
  end if;

  -- Work mode
  if p_filters ? 'work_mode' then
    if not (c ? 'work_mode') or jsonb_array_length(coalesce(c->'work_mode','[]'::jsonb)) = 0 then
      unknown := array_append(unknown, 'work mode: not recorded');
    elsif not ((p_filters->>'work_mode') = any(
                array(select jsonb_array_elements_text(c->'work_mode')))) then
      fails := array_append(fails, format('work mode: cannot do %s', p_filters->>'work_mode'));
    end if;
  end if;

  -- Salary band overlap — one unknown for the pair, not two.
  if (p_filters ? 'salary_max' or p_filters ? 'salary_min') then
    if c->>'salary_expectation' is null then
      unknown := array_append(unknown, 'salary expectation: not recorded');
    else
      if p_filters ? 'salary_max'
         and (c->>'salary_expectation')::numeric > (p_filters->>'salary_max')::numeric then
        fails := array_append(fails, format('salary: expects %s, band tops out at %s',
                 c->>'salary_expectation', p_filters->>'salary_max'));
      end if;
      if p_filters ? 'salary_min'
         and (c->>'salary_expectation')::numeric < (p_filters->>'salary_min')::numeric then
        fails := array_append(fails, format('salary: expects %s, below the band floor %s',
                 c->>'salary_expectation', p_filters->>'salary_min'));
      end if;
    end if;
  end if;

  -- Notice period vs join date — the classic overridable near-miss
  if p_filters ? 'join_by_days' then
    if c->>'notice_days' is null then
      unknown := array_append(unknown, 'notice period: not recorded');
    elsif (c->>'notice_days')::numeric > (p_filters->>'join_by_days')::numeric then
      fails := array_append(fails, format('notice: %s days against a %s-day join window',
               c->>'notice_days', p_filters->>'join_by_days'));
    end if;
  end if;

  -- Mandatory experience floor
  if p_filters ? 'min_years_experience' then
    if c->>'years_experience' is null then
      unknown := array_append(unknown, 'years of experience: not recorded');
    elsif (c->>'years_experience')::numeric < (p_filters->>'min_years_experience')::numeric then
      fails := array_append(fails, format('experience: %s years against a %s-year floor',
               c->>'years_experience', p_filters->>'min_years_experience'));
    end if;
  end if;

  return jsonb_build_object('fails', to_jsonb(fails), 'unknown', to_jsonb(unknown));
end $$;

-- The old signature stays, delegating, so nothing that already calls it breaks.
create or replace function hard_filter_fails(p_candidate jsonb, p_filters jsonb)
returns text[] language sql stable as $$
  select coalesce(array(select jsonb_array_elements_text(
           hard_filter_check(p_candidate, p_filters)->'fails')), '{}');
$$;

alter table matches add column if not exists hard_filter_unknown text[];

-- ── 2. Teach the engine the third state ────────────────────────────────────
-- `compute_matches` is defined in sql/07 and that stays its only definition —
-- patching a stored function's text from a later migration leaves two versions
-- of the truth and breaks the moment the original is edited. The filter block
-- there now calls `hard_filter_check`, which this file defines. On a fresh
-- database numeric order is enough — plpgsql resolves function names at call
-- time, not at creation. On a database that already has the old body,
-- **re-apply sql/07 before this file.** The assertions at the bottom prove it
-- took either way.

-- ── 3. Somewhere for the facts to live ─────────────────────────────────────
-- §7.5's asked-not-tested fields. Recorded rather than measured, so they are
-- kept apart from `scores` and never touch the profile.
create or replace function set_candidate_direct_fields(p_candidate_id uuid, p_fields jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_name text; v_reqs int := 0; r record; k text; v text;
  v_clean jsonb := '{}'::jsonb;
begin
  if not is_staff() then raise exception 'set_candidate_direct_fields: staff only'; end if;
  select full_name into v_name from candidates where id = p_candidate_id;
  if v_name is null then raise exception 'No such candidate.'; end if;

  -- Validate rather than trust. A silently mis-shaped field would read as
  -- "not recorded" forever, which is the failure this migration exists to end.
  if p_fields ? 'languages' then
    if jsonb_typeof(p_fields->'languages') <> 'object' then
      raise exception 'languages must be an object like {"en":"fluent"}';
    end if;
    for k, v in select * from jsonb_each_text(p_fields->'languages') loop
      if fluency_rank(v) = 0 then
        raise exception 'Fluency for % must be one of native, fluent, conversational, basic — got "%"', k, v;
      end if;
    end loop;
  end if;
  if p_fields ? 'work_mode' and jsonb_typeof(p_fields->'work_mode') <> 'array' then
    raise exception 'work_mode must be a list, e.g. ["remote","hybrid"]';
  end if;
  foreach k in array array['salary_expectation','notice_days','years_experience','comp_band'] loop
    if p_fields ? k and jsonb_typeof(p_fields->k) not in ('number','null') then
      raise exception '% must be a number', k;
    end if;
  end loop;

  -- Drop empties so a blank box reads as "not recorded" rather than as a value.
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into v_clean
  from jsonb_each(p_fields)
  where value is not null and value <> 'null'::jsonb
    and value <> '""'::jsonb and value <> '[]'::jsonb and value <> '{}'::jsonb;

  update candidates set direct_fields = nullif(v_clean, '{}'::jsonb) where id = p_candidate_id;

  -- Eligibility just changed, so every open shortlist holding this candidate is
  -- now stale. Recompute rather than leave the console showing the old answer.
  for r in
    select req.id from requirements req
    join clients cl on cl.id = req.client_id
    where req.status = 'open' and req.target_profile_id is not null
      and cl.business_name not like 'ZZ_FIXTURE%'
  loop
    perform compute_matches(r.id);
    v_reqs := v_reqs + 1;
  end loop;

  return jsonb_build_object('saved', v_name, 'fields', v_clean, 'requirements_rematched', v_reqs);
end $$;

grant execute on function set_candidate_direct_fields(uuid, jsonb) to authenticated;

-- ── 4. The client's answers, readable and correctable ──────────────────────
-- Requested directly: *"give me an edit option in the requirements of clients,
-- so that I can see and edit their client intake response."* A client fills the
-- intake once, from memory, often with a number in the wrong unit — and until
-- now the only repair was a new intake link and a second requirement.
create or replace function get_client_intake(p_requirement_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if not is_staff() then raise exception 'get_client_intake: staff only'; end if;

  select jsonb_build_object(
    'requirement_id', r.id, 'title', r.title, 'business_name', cl.business_name,
    'client_id', cl.id, 'intake_id', i.id,
    'submitted_at', i.submitted_at, 'payload', i.payload,
    'hard_filters', r.hard_filters,
    'confidence', tp.confidence, 'benchmark_source', tp.benchmark_source)
  into v
  from requirements r
  join clients cl on cl.id = r.client_id
  left join client_target_profile tp on tp.id = r.target_profile_id
  left join lateral (select * from client_intake ci
                      where ci.client_id = cl.id and ci.is_complete
                      order by ci.submitted_at desc limit 1) i on true
  where r.id = p_requirement_id;

  if v is null then raise exception 'No such requirement.'; end if;
  return v;
end $$;

grant execute on function get_client_intake(uuid) to authenticated;

-- Hard filters are DERIVED from the hf_* answers. Deriving them in the browser
-- and again in the intake form gave two dialects of the same rule, and the
-- QA caught the consequence immediately: saving an unchanged intake wrote back
-- the payload's own stale `hard_filters`, which still keyed `"en, hi"` as one
-- language — resurrecting a bug this very migration had just repaired.
--
-- > **A derived value that anyone may also supply is not derived. It is a
-- > suggestion, and it will be wrong exactly when it matters.**
--
-- So the server derives it, from the answers, always, and ignores whatever the
-- caller sent under that key.
create or replace function derive_hard_filters(p jsonb)
returns jsonb language plpgsql immutable as $$
declare hf jsonb := '{}'::jsonb; part text; langs jsonb := '[]'::jsonb; locs text[] := '{}';
begin
  if coalesce(btrim(p->>'hf_locations'), '') <> '' then
    foreach part in array string_to_array(p->>'hf_locations', ',') loop
      if btrim(part) <> '' then locs := array_append(locs, btrim(part)); end if;
    end loop;
    if array_length(locs, 1) > 0 then hf := hf || jsonb_build_object('locations', to_jsonb(locs)); end if;
  end if;

  if coalesce(btrim(p->>'hf_work_mode'), '') <> '' then
    hf := hf || jsonb_build_object('work_mode', p->>'hf_work_mode');
  end if;

  if coalesce(btrim(p->>'hf_language'), '') <> '' then
    foreach part in array string_to_array(p->>'hf_language', ',') loop
      if btrim(part) <> '' then
        langs := langs || jsonb_build_object('lang', lower(btrim(part)), 'min', 'fluent');
      end if;
    end loop;
    if jsonb_array_length(langs) > 0 then
      hf := hf || jsonb_build_object('languages_required', langs);
    end if;
  end if;

  if coalesce(btrim(p->>'hf_join_by_days'), '') <> '' then
    hf := hf || jsonb_build_object('join_by_days', (p->>'hf_join_by_days')::numeric);
  end if;
  if coalesce(btrim(p->>'hf_min_years'), '') <> '' then
    hf := hf || jsonb_build_object('min_years_experience', (p->>'hf_min_years')::numeric);
  end if;
  if coalesce(btrim(p->>'salary_min'), '') <> '' then
    hf := hf || jsonb_build_object('salary_min', (p->>'salary_min')::numeric);
  end if;
  if coalesce(btrim(p->>'salary_max'), '') <> '' then
    hf := hf || jsonb_build_object('salary_max', (p->>'salary_max')::numeric);
  end if;

  return hf;
end $$;

grant execute on function derive_hard_filters(jsonb) to authenticated;

create or replace function update_client_intake(p_requirement_id uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_client uuid; v_intake uuid; v_tp client_target_profile; v_n int;
  v_old jsonb; v_changed text[] := '{}'; k text;
begin
  if not is_staff() then raise exception 'update_client_intake: staff only'; end if;

  select r.client_id into v_client from requirements r where r.id = p_requirement_id;
  if v_client is null then raise exception 'No such requirement.'; end if;

  select id, payload into v_intake, v_old from client_intake
  where client_id = v_client and is_complete order by submitted_at desc limit 1;
  if v_intake is null then raise exception 'This client has no completed intake to edit.'; end if;

  if jsonb_array_length(coalesce(p_payload->'top3','[]'::jsonb)) <> 3 then
    raise exception 'The intake still needs exactly three "most like this role" statements.';
  end if;

  -- Derived, never accepted. See derive_hard_filters above.
  p_payload := p_payload || jsonb_build_object('hard_filters', derive_hard_filters(p_payload));

  for k in select jsonb_object_keys(p_payload) loop
    if (v_old->k) is distinct from (p_payload->k) then v_changed := array_append(v_changed, k); end if;
  end loop;

  update client_intake set payload = p_payload where id = v_intake;

  -- The target profile is DERIVED from these answers, so editing them without
  -- recomputing it would leave a requirement whose stated inputs no longer
  -- produce its own targets. Recompute, repoint, rematch — in that order.
  v_tp := compute_target_profile(v_intake);

  update requirements set
    target_profile_id = v_tp.id,
    title        = coalesce(nullif(btrim(p_payload->>'role_title'), ''), title),
    ticket_size  = coalesce((p_payload->>'ticket_size')::numeric, ticket_size),
    cycle_days   = coalesce((p_payload->>'cycle_days')::int, cycle_days),
    hard_filters = p_payload->'hard_filters',
    roleplay_pack = case when (p_payload->>'ticket_size')::numeric < 50000 then 'fast'
                         when (p_payload->>'ticket_size')::numeric <= 150000 then 'mid'
                         else 'considered' end
  where id = p_requirement_id;

  v_n := compute_matches(p_requirement_id);

  return jsonb_build_object('ok', true, 'changed', v_changed,
                            'candidates_ranked', v_n, 'confidence', v_tp.confidence);
end $$;

grant execute on function update_client_intake(uuid, jsonb) to authenticated;

-- ── 5. Repairs to data already in the building ─────────────────────────────

-- "en, hi" was typed into a field that asked for one language, and stored as a
-- single key. `languages->>'en, hi'` matches nothing, so the check could never
-- pass even once candidates had languages recorded. Split them.
update requirements r set hard_filters = jsonb_set(
  r.hard_filters, '{languages_required}',
  (select jsonb_agg(jsonb_build_object('lang', btrim(part), 'min', e->>'min'))
   from jsonb_array_elements(r.hard_filters->'languages_required') e,
        lateral unnest(string_to_array(e->>'lang', ',')) part
   where btrim(part) <> ''))
where r.hard_filters ? 'languages_required'
  and exists (select 1 from jsonb_array_elements(r.hard_filters->'languages_required') e
               where e->>'lang' like '%,%');

-- ...and in the payload it was derived from. Repairing only the derived copy
-- left the source still wrong, so the next edit would have put it straight back
-- — which is exactly what the QA caught.
update client_intake ci
set payload = ci.payload || jsonb_build_object('hard_filters', derive_hard_filters(ci.payload))
where ci.is_complete
  and (ci.payload->'hard_filters') is distinct from derive_hard_filters(ci.payload);

-- The fixtures stated no eligibility facts and passed on a null comparison.
-- Now that unknown is visible, they have to say what they are. N1 is the
-- deliberate hard-filter failure and keeps its own contradictory profile.
update candidates set direct_fields = jsonb_build_object(
  'languages', jsonb_build_object('en', 'fluent'),
  'work_mode', jsonb_build_array('onsite', 'hybrid', 'remote'),
  'location', 'Mumbai',
  'salary_expectation', 600000,
  'notice_days', 30,
  'years_experience', 5)
where full_name like 'ZZ_FIXTURE%' and direct_fields is null;

-- ── 6. See who is blocked on a missing fact rather than a real mismatch ────
create or replace view v_missing_direct_fields as
select c.id as candidate_id, c.full_name,
       c.direct_fields is null as nothing_recorded,
       (select count(*) from matches m where m.candidate_id = c.id
         and array_length(m.hard_filter_unknown, 1) > 0) as shortlists_blocked,
       (select array_agg(distinct u) from matches m,
          lateral unnest(coalesce(m.hard_filter_unknown, '{}')) u
         where m.candidate_id = c.id) as missing
from candidates c
where c.full_name not like 'ZZ_FIXTURE%' and c.full_name not like 'ZZ_E2E%'
  and exists (select 1 from candidate_profile p where p.candidate_id = c.id)
  and exists (select 1 from matches m where m.candidate_id = c.id
               and array_length(m.hard_filter_unknown, 1) > 0);

grant select on v_missing_direct_fields to authenticated;

-- ── 7. Carry the third state all the way to the screen ────────────────────
-- A state the engine computes and the view drops is a state that does not
-- exist. `v_console` selects `m.*` so it already carries the column;
-- `v_console_clean` enumerates its columns and had to be told. Same for
-- `get_candidate_detail`, which is edited in sql/21 — **re-apply sql/21 with
-- this file** rather than rewriting the function from here.
-- `v_candidate_queue` is built on this view, so dropping it would take the queue
-- with it. CREATE OR REPLACE keeps the dependency intact — at the price of only
-- being allowed to ADD columns, and only at the end. Hence the new column
-- sitting apart from the two it belongs beside.
-- ── v_console_clean lives in sql/33 ──────────────────────────────────────────
-- It used to be redefined here. Four files defined `v_candidate_queue` and two
-- defined `v_console_clean`, so the live schema depended on which migration ran
-- most recently — re-applying this file silently reverted later fixes. Both are
-- now defined once, in the highest-numbered migration, so numeric order puts
-- them last and no earlier file can undo them. Edit them there. See sql/33.


-- ── Rematch everything, so the console stops lying immediately ─────────────
do $$
declare r record; v int;
begin
  for r in select id from requirements where status = 'open' and target_profile_id is not null
  loop perform compute_matches(r.id); end loop;

  -- Nobody may be failed for a check that was never run.
  select count(*) into v from matches
  where 'work mode: cannot do remote' = any(hard_filter_fails)
    and candidate_id in (select id from candidates where direct_fields is null);
  if v > 0 then raise exception '% match(es) still fail a filter on absent data', v; end if;

  select count(*) into v from pg_proc
  where proname in ('hard_filter_check','set_candidate_direct_fields',
                    'get_client_intake','update_client_intake');
  if v <> 4 then raise exception 'expected 4 new functions, found %', v; end if;

  -- No requirement may still carry a comma-jammed language.
  -- The alias must not be `r`: plpgsql resolves a bare `r.x` to the loop
  -- variable declared above, not to the table alias, and reports the column as
  -- missing from a record that never had it.
  select count(*) into v from requirements req
  where exists (select 1 from jsonb_array_elements(coalesce(req.hard_filters->'languages_required','[]'::jsonb)) e
                 where e->>'lang' like '%,%');
  if v > 0 then raise exception '% requirement(s) still key a language as "en, hi"', v; end if;

  raise notice 'sql/29 ok — a filter that cannot run no longer reports a verdict';
end $$;
