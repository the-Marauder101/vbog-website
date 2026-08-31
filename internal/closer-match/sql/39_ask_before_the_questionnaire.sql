-- ═══════════════════════════════════════════════════════════════════════════
-- 39 — ASK has to work before the questionnaire, because that is when it happens
--
-- The pipeline ASK was built to serve:
--
--     LinkedIn → CV screen → R1 phone → R2 interview → QUESTIONNAIRE → R3 → R4
--                            ▲          ▲
--                            └──────────┴── ASK runs HERE
--
-- ASK runs at R1 and R2. The questionnaire is the step AFTER. So a candidate
-- being interviewed has no `candidate_profile` row — that is not an edge case,
-- **it is the normal state of every candidate ASK is for.**
--
-- `get_candidate_detail()` returns early for such a candidate with `scored:false`
-- and a reason, and that early return carries `dimensions`, `roles` and `flags`
-- as empty arrays — but not `ask`, because sql/21 appended the ASK keys to the
-- SCORED return only. `js/console.js` then stops rendering at the same fork, so
-- the ASK region and its "Run R2 interview" link never appear.
--
-- The result: ASK was reachable for precisely the candidates who do not need it,
-- and invisible for every candidate who does. The feature shipped, the migration
-- applied, the tests passed, and it could not be used.
--
-- ── WHY THE TESTS DID NOT CATCH IT ────────────────────────────────────────
--
-- `test/regression.js` asserts the candidate page has an ASK region. It opens a
-- candidate chosen like this:
--
--     .find(r => r.querySelector(".strip") && …)   -- a row WITH scores
--
-- Deliberately a scored candidate, so the nine-dimension assertions in the same
-- block would have something to read. Every ASK assertion in the suite therefore
-- ran against the one state where ASK already worked.
--
-- > **A test that only ever exercises the state where the feature works is not
-- > testing the feature, it is testing the state.**
--
-- The fix is in three parts: this file makes the unscored branch carry the ASK
-- keys, `js/console.js` renders the region on both branches, and the suites gain
-- a candidate with no profile at all — the case that was missing.
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare v_src text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_src from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'get_candidate_detail';

  if v_src is null then
    raise exception 'get_candidate_detail does not exist — apply sql/21 first';
  end if;

  -- The unscored return is identified by the three empty arrays it ends with.
  -- Anchoring on that rather than on a line number, because the reason-building
  -- CASE above it is edited more often than this tail is.
  if v_src not like '%''dimensions'', ''[]''::jsonb, ''roles'', ''[]''::jsonb, ''flags'', ''[]''::jsonb);%' then
    raise exception 'the unscored branch of get_candidate_detail no longer ends the '
                    'way this migration expects — read it before editing';
  end if;

  v_new := replace(v_src,
    '''dimensions'', ''[]''::jsonb, ''roles'', ''[]''::jsonb, ''flags'', ''[]''::jsonb);',
    -- Same two keys the scored branch returns, so a surface can render the ASK
    -- region without first asking whether there are scores. `ask_overlap` is
    -- necessarily empty here — there is no questionnaire reading to disagree
    -- with yet — but it must be an empty array rather than absent, or every
    -- caller needs a special case for the commonest state in the system.
    '''dimensions'', ''[]''::jsonb, ''roles'', ''[]''::jsonb, ''flags'', ''[]''::jsonb,
      ''ask'', get_candidate_ask(p_candidate_id),
      ''ask_overlap'', get_ask_overlap(p_candidate_id));');

  if v_new = v_src then
    raise exception 'get_candidate_detail was not patched';
  end if;

  execute v_new;
end $$;

-- ── Prove it against a candidate who has never opened a link ───────────────
-- Built, checked and removed inside one transaction, so this leaves nothing.
do $$
declare
  v_cand uuid; v_detail jsonb; v_card uuid; v_after jsonb;
  v_q text; v_opt int; v_src text;
begin
  -- The source check runs everywhere, including from the Management API, which
  -- connects as `postgres` and so is correctly not staff. It is weaker than
  -- calling the function but it is the half that cannot be skipped.
  select pg_get_functiondef(p.oid) into v_src from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'get_candidate_detail';

  if (regexp_count(v_src, 'get_candidate_ask\(p_candidate_id\)')) < 2 then
    raise exception 'get_candidate_detail returns the ask key on % branch(es), expected 2',
      regexp_count(v_src, 'get_candidate_ask\(p_candidate_id\)');
  end if;
  if (regexp_count(v_src, 'get_ask_overlap\(p_candidate_id\)')) < 2 then
    raise exception 'get_candidate_detail returns ask_overlap on fewer than both branches';
  end if;

  -- The behavioural half needs a staff identity. Applied through the Management
  -- API there is none, so it is skipped here and covered by test/assess.js and
  -- test/ask.js, which sign in as a real member of staff.
  if not is_staff() then
    raise notice 'sql/39: source verified on both branches; the live call needs a '
                 'staff session and is covered by the test suites';
    return;
  end if;

  insert into candidates (full_name, contact, consent_version, consent_at)
  values ('ZZ_FIXTURE ask before scores', '{}'::jsonb, 'pending', now())
  returning id into v_cand;

  v_detail := get_candidate_detail(v_cand);

  if (v_detail->>'scored')::boolean is not false then
    raise exception 'fixture candidate should be unscored, got scored=%', v_detail->>'scored';
  end if;

  -- The whole point of the file.
  if not (v_detail ? 'ask') then
    raise exception 'an unscored candidate still has no ask key — the patch did not take';
  end if;
  if not (v_detail ? 'ask_overlap') then
    raise exception 'an unscored candidate has no ask_overlap key';
  end if;
  if jsonb_typeof(v_detail->'ask') <> 'array' then
    raise exception 'ask should be an array even when empty, got %', jsonb_typeof(v_detail->'ask');
  end if;

  -- And it must still say why there are no scores, rather than looking scored.
  if coalesce(v_detail->>'reason', '') = '' then
    raise exception 'the unscored branch lost its reason sentence';
  end if;

  -- Now run an actual R2 against that candidate and read it back, which is the
  -- sequence a member of staff will perform on day one: interview first, and the
  -- questionnaire days later or never.
  v_card := (start_ask(v_cand, 'r2')->>'id')::uuid;
  if v_card is null then
    raise exception 'could not start an R2 on a candidate with no profile';
  end if;

  for v_q in select q.id from ask_questions q where q.active and not q.is_reference loop
    v_opt := 2;
    perform save_ask_score(v_card, v_q, v_opt, null);
  end loop;
  perform submit_ask(v_card);

  v_after := get_candidate_detail(v_cand);
  if jsonb_array_length(v_after->'ask') < 1 then
    raise exception 'a submitted R2 does not appear on an unscored candidate''s detail';
  end if;
  if (v_after->>'scored')::boolean is not false then
    raise exception 'running an ASK interview must not make a candidate look scored — '
                    'ASK is a second reading, not a substitute for the questionnaire';
  end if;

  raise notice 'sql/39: an unscored candidate carries ask (% scorecards) and ask_overlap',
    jsonb_array_length(v_after->'ask');

  -- Undo everything. purge_candidate cascades the scorecard and its scores.
  perform purge_candidate(v_cand);
  if exists (select 1 from candidates where id = v_cand) then
    raise exception 'the fixture candidate was not removed';
  end if;
end $$;
