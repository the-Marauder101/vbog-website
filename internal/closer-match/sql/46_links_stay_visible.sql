-- ═══════════════════════════════════════════════════════════════════════════
-- 46 — a link you did not copy is not a link you have lost
--
-- `issue_assessment_token()` returns the token exactly once, the console prints
-- it into a box, and if you navigate away before copying it the link is gone.
-- Not expired, not revoked — gone, because nothing ever showed it again. The only
-- recovery was to issue a second one, which leaves the first live and the
-- candidate holding whichever arrived first.
--
-- The token is not a secret from staff. It is a secret from everybody else, and
-- it already lives in a table only staff can read. There was never a reason to
-- show it once; that was an accident of the function returning it rather than a
-- decision that it should be write-only.
--
-- So: `get_candidate_links()` returns every link a candidate has, with enough
-- state to know which one to send — issued when, expires when, used or not, and
-- whether the assessment behind it is finished. And `revoke_assessment_token()`
-- exists so that issuing a replacement can actually retire the old one instead
-- of leaving two live links to the same test.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function get_candidate_links(p_candidate_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not is_staff() then raise exception 'get_candidate_links: staff only'; end if;
  if not exists (select 1 from candidates where id = p_candidate_id) then
    raise exception 'No such candidate.';
  end if;

  select jsonb_build_object(
    'assessment', coalesce((
      select jsonb_agg(jsonb_build_object(
        'token', t.token,
        'issued_at', t.issued_at,
        'expires_at', t.expires_at,
        'consumed_at', t.consumed_at,
        'expired', t.expires_at <= now(),
        -- A token whose assessment is finished should not be re-sent, and the
        -- page needs to be able to say so rather than showing a live-looking URL
        -- that opens on "you have already completed this".
        'assessment_complete', exists (
          select 1 from assessment_sessions s
          where s.candidate_id = p_candidate_id and s.completed_at is not null),
        'answered', coalesce((
          select count(*) from candidate_responses r
          join assessment_sessions s on s.id = r.session_id
          where s.candidate_id = p_candidate_id), 0))
      order by t.issued_at desc)
    from assessment_tokens t where t.candidate_id = p_candidate_id), '[]'::jsonb),

    'supplement', coalesce((
      select jsonb_agg(jsonb_build_object(
        'token', t.token, 'issued_at', t.issued_at, 'expires_at', t.expires_at,
        'expired', t.expires_at <= now(),
        'submitted_at', t.submitted_at)
      order by t.issued_at desc)
    from supplement_tokens t where t.candidate_id = p_candidate_id), '[]'::jsonb))
  into v;

  return v;
end $$;

-- ── Retiring one ──────────────────────────────────────────────────────────
-- Issuing a replacement without retiring the old one leaves two live links to
-- the same assessment, and the candidate uses whichever email they open first.
create or replace function revoke_assessment_token(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cand uuid; v_done boolean;
begin
  if not is_staff() then raise exception 'revoke_assessment_token: staff only'; end if;

  select candidate_id into v_cand from assessment_tokens where token = p_token;
  if v_cand is null then raise exception 'No such link.'; end if;

  select exists (select 1 from assessment_sessions s
                 where s.candidate_id = v_cand and s.completed_at is not null)
    into v_done;

  -- Expire rather than delete. A deleted token cannot be told apart from one that
  -- never existed, and "who did we send this to and when" is worth keeping.
  update assessment_tokens set expires_at = now() where token = p_token;

  return jsonb_build_object('revoked', true, 'candidate_id', v_cand,
    'note', case when v_done
      then 'Their assessment is already submitted, so this link was spent anyway.'
      else 'That link will no longer open the assessment. Issue a new one if they still need to take it.'
    end);
end $$;

revoke all on function get_candidate_links(uuid) from public;
revoke all on function revoke_assessment_token(text) from public;
grant execute on function get_candidate_links(uuid) to authenticated;
grant execute on function revoke_assessment_token(text) to authenticated;

-- ── Assertions ────────────────────────────────────────────────────────────
do $$
declare v_cand uuid; v_tok text; v jsonb;
begin
  if not is_staff() then
    if (select pg_get_functiondef(p.oid) from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'get_candidate_links')
       not like '%assessment_tokens%' then
      raise exception 'get_candidate_links does not read the tokens';
    end if;
    raise notice 'sql/46: created; behaviour covered by test/assess.js';
    return;
  end if;

  insert into candidates (full_name, contact, consent_version, consent_at)
  values ('ZZ_FIXTURE link visibility', '{}'::jsonb, 'pending', now()) returning id into v_cand;

  v := get_candidate_links(v_cand);
  if jsonb_array_length(v->'assessment') <> 0 then
    raise exception 'a candidate with no link has %', jsonb_array_length(v->'assessment');
  end if;

  v_tok := issue_assessment_token(v_cand, 14);
  v := get_candidate_links(v_cand);
  if jsonb_array_length(v->'assessment') <> 1 then
    raise exception 'the issued link is not listed';
  end if;
  if v->'assessment'->0->>'token' <> v_tok then
    raise exception 'the listed token is not the one that was issued';
  end if;
  if (v->'assessment'->0->>'expired')::boolean then
    raise exception 'a link issued for 14 days reads as expired';
  end if;

  -- The whole point: it is still there on a second look.
  v := get_candidate_links(v_cand);
  if v->'assessment'->0->>'token' <> v_tok then
    raise exception 'the link was not there the second time it was asked for';
  end if;

  perform revoke_assessment_token(v_tok);
  v := get_candidate_links(v_cand);
  if not (v->'assessment'->0->>'expired')::boolean then
    raise exception 'a revoked link does not read as expired';
  end if;
  -- Revoked, not vanished.
  if jsonb_array_length(v->'assessment') <> 1 then
    raise exception 'revoking deleted the record of the link';
  end if;

  perform purge_candidate(v_cand);
  raise notice 'sql/46: links stay visible';
end $$;
