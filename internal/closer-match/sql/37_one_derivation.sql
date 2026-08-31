-- ═══════════════════════════════════════════════════════════════════════════
-- 37 — hard_filters is derived in one place, and submit_intake is that place too
--
-- sql/29 moved the hard-filter derivation into the database, because the browser
-- and the server each had a copy and saving an unchanged intake wrote the stale
-- browser copy back over a fix that was already in. `update_client_intake` was
-- changed to call `derive_hard_filters()` and to ignore whatever the caller sent.
--
-- **`submit_intake` was not.** It still does this:
--
--     coalesce(p_payload->'hard_filters', '{}'::jsonb)
--
-- So the derivation still exists twice: once in `derive_hard_filters()`, and once
-- in `js/intake.js`, which builds `hard_filters` in JavaScript and posts it. The
-- live tool is not currently wrong, because the two copies happen to agree. That
-- is not a property anybody is maintaining; it is a coincidence with a deadline.
--
-- Two things follow from it, and the second is the bad one:
--
--   1. Editing an intake and submitting one derive by different code. The
--      "en, hi" split bug was fixed in both, separately, by hand. The next such
--      fix will be applied to one of them.
--
--   2. **Any caller that is not that one form creates a requirement with no
--      hard filters at all.** Not wrong filters — absent ones. Every candidate
--      then passes location, language, work mode, salary and notice period,
--      because none of them are being asked about. A shortlist that silently
--      stopped filtering looks exactly like a shortlist that found everybody
--      suitable. This was found by a test calling submit_intake directly, which
--      is precisely what a second surface or a script would do.
--
-- The rule from §7ab, applied to the last place it had not been:
--
-- > **Two definitions of one thing is a race.**
--
-- After this, `derive_hard_filters()` is the only thing that turns intake answers
-- into hard filters, and a caller's own copy is ignored on both paths rather than
-- trusted on one of them. The browser's copy is deleted in the same change.
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare v_src text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_src from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'submit_intake';

  if v_src is null then
    raise exception 'submit_intake does not exist — apply sql/11 first';
  end if;

  if v_src like '%derive_hard_filters(p_payload)%' then
    raise notice 'submit_intake already derives its own hard filters';
    return;
  end if;

  -- Replacing the one expression, not rewriting the function. The rest of
  -- submit_intake — the required-answer check, the target profile, the roleplay
  -- pack, the token stamp — is correct and is not this change's business.
  v_new := replace(v_src,
    'coalesce(p_payload->''hard_filters'', ''{}''::jsonb)',
    -- The caller's copy is not read. Not merged with, not fallen back to:
    -- ignored. A stale or hostile `hard_filters` in the payload changes nothing.
    'derive_hard_filters(p_payload)');

  if v_new = v_src then
    raise exception 'submit_intake no longer contains the hard_filters expression '
                    'this migration was written against — read it before editing';
  end if;

  execute v_new;
end $$;

-- ── Prove it, rather than assume it ────────────────────────────────────────
-- The assertion that matters is the one about the ABSENT copy: a payload with no
-- `hard_filters` key at all must still produce filters. That is the failure this
-- migration exists to close, and it is the one that is invisible when it happens.
do $$
declare
  v_answers jsonb := jsonb_build_object(
    'hf_locations', 'Pune, Mumbai',
    'hf_language',  'en, hi',
    'hf_work_mode', 'hybrid',
    'hf_min_years', '3');
  v_derived jsonb;
  v_src text;
begin
  v_derived := derive_hard_filters(v_answers);

  if jsonb_array_length(v_derived->'languages_required') <> 2 then
    raise exception 'derive_hard_filters no longer splits a two-language answer';
  end if;
  if jsonb_array_length(v_derived->'locations') <> 2 then
    raise exception 'derive_hard_filters no longer splits a two-location answer';
  end if;

  -- A caller's copy must not survive. If this ever passes it is because
  -- submit_intake went back to trusting the payload.
  if derive_hard_filters(v_answers || jsonb_build_object(
       'hard_filters', jsonb_build_object('locations', jsonb_build_array('NOWHERE'))))
     -> 'locations' @> '["NOWHERE"]'::jsonb then
    raise exception 'derive_hard_filters is reading the caller''s own hard_filters';
  end if;

  select pg_get_functiondef(p.oid) into v_src from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'submit_intake';

  if v_src not like '%derive_hard_filters(p_payload)%' then
    raise exception 'submit_intake was not patched';
  end if;
  if v_src like '%p_payload->''hard_filters''%' then
    raise exception 'submit_intake still reads the caller''s hard_filters somewhere';
  end if;

  raise notice 'sql/37: hard_filters has one derivation, on both paths';
end $$;
