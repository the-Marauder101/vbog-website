-- ═══════════════════════════════════════════════════════════════════════════
-- 23 — reopening a finished assessment started a brand-new empty one
--
-- Spotted on a screenshot of the candidate queue: a candidate with 44 of 44
-- answered, a computed profile and an 80.2% match was showing "NOT FINISHED"
-- and "waiting on them to finish".
--
-- THE CAUSE. `start_assessment()` looked for an INCOMPLETE session and, finding
-- none, created one:
--
--     select id into v_session from assessment_sessions
--     where candidate_id = v_candidate and completed_at is null ...
--     if v_session is null then insert ... end if;
--
-- Once a candidate finished, that query found nothing — because their session
-- was complete — so every subsequent open of the link minted a fresh empty
-- session. The queue reads the newest session, so the person flipped back to
-- "not finished" the moment they revisited their own link.
--
-- The `screen-done` copy has said *"the link will no longer open the
-- assessment"* since the day it was written. The code never kept that promise;
-- nothing checked.
--
-- WHY IT SURFACED NOW. The consent-skip in the previous change made
-- `start_assessment()` run on page load rather than on a button press, so
-- merely opening the link was enough to mint the empty session. The latent bug
-- was always there — a candidate who reopened their link after submitting would
-- have been handed all 44 items again, and their completed profile would have
-- sat behind a session that looked unfinished.
--
-- THE FIX. A completed session is terminal. `start_assessment()` now reports
-- it and creates nothing:
--
--     { already_complete: true, completed_at, session_id }
--
-- No second session, no 44 items, no way to overwrite a submitted assessment by
-- opening a link twice.
-- ═══════════════════════════════════════════════════════════════════════════

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

  -- A finished assessment is the end of the road for this link. Checked BEFORE
  -- consent, because someone who already submitted should not be asked to
  -- consent again on their way to being told they are done.
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
    -- Rotation draws PER DIMENSION (§7.3) so every dimension always receives its
    -- full item count — the reason (raw+4)/12 stays valid across bank versions.
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
            select jsonb_agg(jsonb_build_object('key', o.option_key, 'text', o.option_text)
                             order by md5(o.option_key || v_session::text))
            from item_options o where o.item_id = i.id
          )
        ) as x
        from items i where i.id = any(v_items) and i.active
      ) t
    )
  );
end $$;

grant execute on function start_assessment(text) to anon;

-- ── The queue must not be fooled by a stray session either ─────────────────
-- Defence in depth: even with the fix above, "has this person finished" should
-- be a question about whether ANY session completed, not about whichever one
-- happens to be newest.
-- ── v_candidate_queue lives in sql/33 ──────────────────────────────────────────
-- It used to be redefined here. Four files defined `v_candidate_queue` and two
-- defined `v_console_clean`, so the live schema depended on which migration ran
-- most recently — re-applying this file silently reverted later fixes. Both are
-- now defined once, in the highest-numbered migration, so numeric order puts
-- them last and no earlier file can undo them. Edit them there. See sql/33.

alter view v_candidate_queue set (security_invoker = true);

-- ── Clean up the sessions this already created ─────────────────────────────
do $$
declare v int;
begin
  with junk as (
    delete from assessment_sessions s
    where s.completed_at is null
      and not exists (select 1 from candidate_responses r where r.session_id = s.id)
      and exists (select 1 from assessment_sessions s2
                   where s2.candidate_id = s.candidate_id
                     and s2.completed_at is not null
                     and s2.started_at < s.started_at)
    returning 1
  ) select count(*) into v from junk;
  raise notice 'removed % empty session(s) created after a completed one', v;
end $$;

-- ── The assertion ──────────────────────────────────────────────────────────
create or replace view v_double_session_audit as
select s.candidate_id, c.full_name, count(*) as empty_sessions_after_completion
from assessment_sessions s
join candidates c on c.id = s.candidate_id
where s.completed_at is null
  and not exists (select 1 from candidate_responses r where r.session_id = s.id)
  and exists (select 1 from assessment_sessions s2
               where s2.candidate_id = s.candidate_id and s2.completed_at is not null)
group by s.candidate_id, c.full_name;

grant select on v_double_session_audit to authenticated;
alter view v_double_session_audit set (security_invoker = true);

do $$
declare v int;
begin
  select count(*) into v from v_double_session_audit;
  if v > 0 then raise exception 'v_double_session_audit is not empty (%)', v; end if;

  select count(*) into v from v_candidate_queue
  where profiled_at is not null and not assessment_complete;
  if v > 0 then
    raise exception '% candidate(s) have a profile but read as unfinished', v;
  end if;
  raise notice 'sql/23 ok — a finished assessment stays finished';
end $$;
