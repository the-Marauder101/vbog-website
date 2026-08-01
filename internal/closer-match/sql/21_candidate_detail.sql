-- ═══════════════════════════════════════════════════════════════════════════
-- 21 — the per-candidate view
--
-- Asked for directly, and worth building carefully, because a page of nine
-- numbers with nothing to read them against is the exact artefact this system
-- was designed not to produce. "72 on Resilience" is strong for one desk and
-- short for another; on its own it is a number looking for a decision to become.
--
-- So this returns scores WITH their targets, always:
--
--   · Every unipolar dimension carries the required level from every open role,
--     the gap in points, and whether it meets. If no role is open, the payload
--     says so and the page says so — it does not quietly show bare numbers.
--   · Bipolar dimensions (MOT, STY) carry a TARGET and a DISTANCE, never a
--     "score", because neither pole is better and a bar filling toward 100 would
--     imply otherwise. §6.3.
--   · CLS_C and CLS_F are shown separately with each role's blend weights, and
--     the effective value the engine actually used. No blended CLS is stored
--     anywhere (§7.2), so the only honest way to show it is per role.
--   · Every flag arrives with the sentence explaining what it means and what it
--     does NOT mean. `fast_completion` reads as an accusation without one.
--
-- STAFF ONLY, and the single most score-dense payload in the system. R1/C10 is
-- structural: SECURITY DEFINER with an is_staff() guard, granted to
-- `authenticated` and never to `anon`.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function get_candidate_detail(p_candidate_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cand    record;
  v_prof    record;
  v_session record;
  v_open    int;
  v_result  jsonb;
begin
  if not is_staff() then raise exception 'get_candidate_detail: staff only'; end if;

  select * into v_cand from candidates where id = p_candidate_id;
  if v_cand.id is null then raise exception 'No such candidate.'; end if;

  select * into v_prof from candidate_profile
  where candidate_id = p_candidate_id order by computed_at desc limit 1;

  select s.*,
         (select sum(seconds_on_item) from candidate_responses where session_id = s.id) as seconds,
         (select count(*) from candidate_responses where session_id = s.id)             as answered
    into v_session
  from assessment_sessions s
  where s.candidate_id = p_candidate_id order by s.started_at desc limit 1;

  select count(*) into v_open
  from requirements req join clients cl on cl.id = req.client_id
  where req.status = 'open' and req.target_profile_id is not null
    and cl.business_name not like 'ZZ_FIXTURE%';

  v_result := jsonb_build_object(
    'candidate', jsonb_build_object(
      'id', v_cand.id, 'full_name', v_cand.full_name,
      'created_at', v_cand.created_at, 'consent_at', v_cand.consent_at,
      'consent_version', v_cand.consent_version,
      'last_activity_at', v_cand.last_activity_at,
      'direct_fields', coalesce(v_cand.direct_fields, '{}'::jsonb)),
    'assessment', case when v_session.id is null then null else jsonb_build_object(
      'started_at', v_session.started_at,
      'completed_at', v_session.completed_at,
      'answered', v_session.answered,
      'expected', array_length(v_session.item_set, 1),
      'minutes', case when v_session.seconds is null then null
                      else round(v_session.seconds / 60.0, 0) end,
      'bank_version', v_session.bank_version) end,
    'profiled_at', v_prof.computed_at,
    'open_reqs', v_open,
    'dict_version', v_prof.dict_version
  );

  if v_prof.id is null then
    -- Nothing to show and a reason why, rather than an empty table.
    return v_result || jsonb_build_object(
      'scored', false,
      'reason', case
        when v_session.id is null then 'They have not opened their assessment link yet.'
        when v_session.completed_at is null then
          'They are part-way through — ' || coalesce(v_session.answered, 0) || ' of ' ||
          coalesce(array_length(v_session.item_set, 1), 44) ||
          ' answered. Scores are computed when they submit.'
        else 'The assessment finished but no profile was computed. That is a bug — check the logs.'
      end,
      'dimensions', '[]'::jsonb, 'roles', '[]'::jsonb, 'flags', '[]'::jsonb);
  end if;

  return v_result || jsonb_build_object(
    'scored', true,

    -- ── One row per dimension, each carrying its targets ──────────────────
    'dimensions', (
      select coalesce(jsonb_agg(d order by d->>'sort'), '[]'::jsonb) from (
        select jsonb_build_object(
          'code', dim.code,
          'name', dim.name,
          'kind', dim.kind,
          'definition', dim.definition,
          'pole_0', dim.pole_0_label,
          'pole_100', dim.pole_100_label,
          'score', (v_prof.scores->>dim.code)::numeric,
          'sort', case dim.code
                    when 'CLS_C' then '1' when 'CLS_F' then '2' when 'RES' then '3'
                    when 'DRV'   then '4' when 'DSC'   then '5' when 'CCH' then '6'
                    when 'INT'   then '7' when 'MOT'   then '8' else '9' end,
          'targets', (
            select coalesce(jsonb_agg(t order by t->>'title'), '[]'::jsonb) from (
              select jsonb_build_object(
                'requirement_id', req.id,
                'title', req.title,
                'business_name', cl.business_name,
                -- Bipolar: a target to sit near, not a bar to clear (§6.3).
                'target', case when dim.kind = 'bipolar'
                               then (tp.bipolar_targets->>dim.code)::numeric
                               when dim.code in ('CLS_C','CLS_F')
                               then (tp.required_levels->>'CLS')::numeric
                               else (tp.required_levels->>dim.code)::numeric end,
                'distance', case when dim.kind = 'bipolar'
                                 then abs((v_prof.scores->>dim.code)::numeric
                                          - (tp.bipolar_targets->>dim.code)::numeric)
                                 else null end,
                'delta', case when dim.kind = 'bipolar' then null
                              when dim.code in ('CLS_C','CLS_F')
                              then (v_prof.scores->>dim.code)::numeric
                                   - (tp.required_levels->>'CLS')::numeric
                              else (v_prof.scores->>dim.code)::numeric
                                   - (tp.required_levels->>dim.code)::numeric end,
                -- The blend weights, so CLS_C and CLS_F can be read honestly:
                -- neither is "the" closing score, the role decides the mix.
                'w', case when dim.code = 'CLS_C' then (tp.cls_blend->>'w_C')::numeric
                          when dim.code = 'CLS_F' then (tp.cls_blend->>'w_F')::numeric
                          else null end,
                'cls_effective', case when dim.code in ('CLS_C','CLS_F')
                  then round((tp.cls_blend->>'w_C')::numeric * (v_prof.scores->>'CLS_C')::numeric
                           + (tp.cls_blend->>'w_F')::numeric * (v_prof.scores->>'CLS_F')::numeric, 1)
                  else null end
              ) as t
              from requirements req
              join clients cl on cl.id = req.client_id
              join client_target_profile tp on tp.id = req.target_profile_id
              where req.status = 'open' and cl.business_name not like 'ZZ_FIXTURE%'
                and (case when dim.kind = 'bipolar'
                          then tp.bipolar_targets ? dim.code
                          when dim.code in ('CLS_C','CLS_F')
                          then tp.required_levels ? 'CLS'
                          else tp.required_levels ? dim.code end)
            ) x)
        ) as d
        from dimensions dim
        where dim.active and v_prof.scores ? dim.code
      ) y),

    -- ── Where they actually stand, per open role ──────────────────────────
    -- Read from v_console_clean rather than `matches`: rank is COMPUTED there,
    -- over the visible pool only, and re-deriving it here would be a second
    -- implementation of the same ordering waiting to disagree with the first.
    'roles', (
      select coalesce(jsonb_agg(r order by (r->>'rank')::int), '[]'::jsonb) from (
        select jsonb_build_object(
          'requirement_id', v.requirement_id,
          'title', v.requirement_title,
          'business_name', v.business_name,
          'rank', v.engine_rank,
          'of', (select count(*) from v_console_clean v2
                  where v2.requirement_id = v.requirement_id),
          'composite_pct', v.composite_pct,
          'quality_pct', v.quality_pct,
          'fit_pct', v.fit_pct,
          'cls_effective', v.cls_effective,
          'hard_filter_pass', v.hard_filter_pass,
          'hard_filter_fails', v.hard_filter_fails,
          'confidence', v.confidence,
          'cross_client_line', v.cross_client_line
        ) as r
        from v_console_clean v
        join requirements req on req.id = v.requirement_id
        where v.candidate_id = p_candidate_id
          and req.status = 'open'
          and v.business_name not like 'ZZ_FIXTURE%'
      ) z),

    -- ── Flags, each with what it means and what it does not ───────────────
    'flags', (
      select coalesce(jsonb_agg(jsonb_build_object('code', f, 'meaning', m)), '[]'::jsonb)
      from unnest(coalesce(v_prof.flags, '{}')) f
      cross join lateral (select case f
        when 'sd_high' then
          'Endorsed all three "always true of me" absolutes. Reads as impression '
          'management, but plenty of honest people do it under pressure — treat it '
          'as something to probe on the call, not as dishonesty.'
        when 'fast_completion' then
          'Finished well under the running median time. Could be a fast reader, '
          'could be clicking through. The role-play in Step 4 settles it.'
        when 'straightline' then
          'Picked the same screen position six or more times in a row. Option order '
          'is randomised per person, so this is a pattern in the clicking rather '
          'than in the answers.'
        when 'careless' then
          'Both bipolar dimensions pinned to the same extreme, which is close to '
          'impossible to mean. Worth re-testing before reading anything else here.'
        else 'No description recorded for this flag.' end as m)),

    'disclaimer',
      'These weights are expert-set, not learned from outcomes. Every number here '
      'is read against a role''s stated requirement — on its own it is not a verdict, '
      'and nothing on this page is ever shown to a client.'
  );
end $$;

grant execute on function get_candidate_detail(uuid) to authenticated;

do $$
declare v jsonb; v_id uuid;
begin
  -- The guard, checked the way a browser would hit it: auth.uid() is null here,
  -- so this must refuse rather than return a payload full of scores.
  begin
    select id into v_id from candidates limit 1;
    v := get_candidate_detail(v_id);
    raise exception 'get_candidate_detail returned data with no signed-in user';
  exception when sqlstate 'P0001' then
    if sqlerrm not like '%staff only%' then raise; end if;
  end;
  raise notice 'sql/21 ok — per-candidate detail, staff-gated';
end $$;
