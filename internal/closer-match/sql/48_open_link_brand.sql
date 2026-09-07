-- ═══════════════════════════════════════════════════════════════════════════
-- 48 — the open link wears Get Closers; a sent link still wears V-BOG
--
-- Two decisions, taken deliberately, and one place where they collide.
--
--   · The public application journey is **Get Closers**. That is the brand a
--     stranger answering a job post should see.
--   · A link sent to a named candidate stays **V-BOG**, because that is how
--     those candidates were approached.
--   · The consent notice names **Get Closers** for everybody, because that is
--     the entity that holds and processes candidate data.
--
-- ── THE COLLISION, STATED RATHER THAN HIDDEN ──────────────────────────────
--
-- A candidate who was sent a per-candidate link now sees the V-BOG wordmark at
-- the top of the page and reads "…consent to Get Closers processing my
-- assessment data" in the notice below it. Those are the two decisions above,
-- both applied faithfully, meeting on one screen.
--
-- It is not a bug and it is not silently smoothed over here: the consent notice
-- names a **legal person**, and the wordmark is a **brand**. They are allowed to
-- differ and frequently do. But it is the kind of thing a candidate asks about,
-- and it is written down so the answer is on hand — and so that if the intent
-- was actually "V-BOG is gone everywhere", one line in `app_settings` and one
-- edit to `assess.html` finishes the job.
--
-- ── HOW THE PAGE KNOWS WHICH BRAND ────────────────────────────────────────
--
-- From `candidates.source`, resolved server-side from the token — NOT from a
-- query parameter passed along by apply.html. A parameter is lost on a refresh
-- from a bookmark, survives being edited by hand, and would make the brand a
-- property of the URL rather than of the person. `get_consent_notice(p_token)`
-- returns the same notice it always did, plus the brand for that candidate.
--
-- The token is not required. Called with nothing it behaves exactly as before,
-- which is what the candidate surface does before it has a token and what
-- `test/security.js` checks is still publicly readable.
-- ═══════════════════════════════════════════════════════════════════════════

update app_settings set value = 'Get Closers' where key = 'firm_legal_name';

-- The old zero-argument form has to go, or PostgREST sees two overloads and
-- resolves the wrong one depending on whether a body was sent.
drop function if exists get_consent_notice();

create or replace function get_consent_notice(p_token text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s jsonb; missing text[]; v_brand text := 'vbog';
begin
  missing := consent_settings_missing();
  select jsonb_object_agg(key, value) into s from app_settings;

  if array_length(missing, 1) > 0 then
    return jsonb_build_object('configured', false, 'missing', missing);
  end if;

  -- Which brand this particular candidate is being addressed under. Derived from
  -- how they entered, so it cannot be changed by editing the address bar and
  -- cannot be lost by reopening the link from a bookmark.
  if p_token is not null then
    select case when c.source = 'open_link' then 'getclosers' else 'vbog' end
      into v_brand
    from assessment_tokens t
    join candidates c on c.id = t.candidate_id
    where t.token = p_token;
    v_brand := coalesce(v_brand, 'vbog');
  end if;

  return jsonb_build_object(
    'configured', true,
    'version', s->>'consent_version',
    'firm', s->>'firm_legal_name',
    'deletion_email', s->>'data_deletion_email',
    'grievance_officer', s->>'grievance_officer',
    'grievance_email', s->>'grievance_email',
    -- 'vbog' or 'getclosers'. Cosmetic: it selects a wordmark and a page title.
    -- Every word with legal weight comes from `firm` above, which is one value
    -- for everybody.
    'brand', v_brand
  );
end $$;

revoke all on function get_consent_notice(text) from public;
grant execute on function get_consent_notice(text) to anon, authenticated;

-- The allowlist keys on the name, so the entry still covers it — but the reason
-- is worth restating now that it takes an argument.
insert into anon_callable (proname, why) values
  ('get_consent_notice',
   'A candidate must be able to read what they are consenting to before '
   'identifying themselves. Takes an optional token, which only selects which '
   'wordmark the page shows — every word with legal weight is the same for '
   'everybody, and an unknown token falls back rather than erroring.')
on conflict (proname) do update set why = excluded.why;

-- ── Assertions ────────────────────────────────────────────────────────────
do $$
declare v_cand uuid; v_tok text; v jsonb;
begin
  -- The firm name is the load-bearing one: it is what the candidate agrees to.
  if (get_consent_notice()->>'firm') <> 'Get Closers' then
    raise exception 'the consent notice still names %', get_consent_notice()->>'firm';
  end if;
  if not (get_consent_notice()->>'configured')::boolean then
    raise exception 'the consent notice is no longer fully configured: %',
      get_consent_notice()->>'missing';
  end if;

  -- Called with nothing, exactly as before, and defaulting to the internal brand.
  if (get_consent_notice()->>'brand') <> 'vbog' then
    raise exception 'the no-token notice does not default to the internal brand';
  end if;
  -- An unknown token must fall back, not error: a stale bookmark is not an
  -- occasion for a stack trace on a candidate's screen.
  if (get_consent_notice('no-such-token')->>'brand') <> 'vbog' then
    raise exception 'an unknown token does not fall back to the internal brand';
  end if;

  if not is_staff() then
    raise notice 'sql/48: firm is Get Closers; the per-candidate brand is covered by test/apply.js';
    return;
  end if;

  -- A staff-created candidate keeps the internal brand.
  insert into candidates (full_name, contact, consent_version, consent_at)
  values ('ZZ_FIXTURE brand sent', '{}'::jsonb, 'pending', now()) returning id into v_cand;
  v_tok := issue_assessment_token(v_cand, 1);
  if (get_consent_notice(v_tok)->>'brand') <> 'vbog' then
    raise exception 'a candidate sent a link does not get the internal brand';
  end if;
  perform purge_candidate(v_cand);

  -- One who applied through the open link gets the public one.
  insert into candidates (full_name, contact, consent_version, consent_at, source)
  values ('ZZ_FIXTURE brand open', '{}'::jsonb, 'pending', now(), 'open_link')
  returning id into v_cand;
  v_tok := issue_assessment_token(v_cand, 1);
  v := get_consent_notice(v_tok);
  if (v->>'brand') <> 'getclosers' then
    raise exception 'an open-link applicant does not get the public brand';
  end if;
  -- And the words with legal weight are the same ones either way.
  if (v->>'firm') <> 'Get Closers'
     or (v->>'grievance_email') <> (get_consent_notice()->>'grievance_email') then
    raise exception 'the notice differs by brand in something other than the wordmark';
  end if;
  perform purge_candidate(v_cand);

  raise notice 'sql/48: brand resolves from candidates.source, firm is one value for everybody';
end $$;
