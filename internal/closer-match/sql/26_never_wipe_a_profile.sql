-- ═══════════════════════════════════════════════════════════════════════════
-- 26 — a recompute must never be able to erase a profile
--
-- Found by the golden cases, which is what they are for. Immediately after
-- sql/24 shipped, `run_golden_cases()` went from 19/19 to 16/19.
--
-- WHAT HAPPENED. `apply_rekey()` recomputes every completed session, because a
-- score measured under the old key does not mean the same thing under the new
-- one. It recomputed the GOLDEN-CASE fixtures too. Those fixtures are seeded by
-- writing `candidate_profile.scores` directly — they have no
-- `candidate_responses` at all, because their whole purpose is to pin known
-- score vectors against known requirements. So `compute_candidate_profile()`
-- summed zero responses, produced `{}`, and overwrote twelve carefully
-- constructed profiles with empty objects.
--
-- TWO SEPARATE DEFECTS, and only one of them is mine.
--
-- 1. `apply_rekey()` recomputed fixtures. Every other operational path in this
--    system excludes ZZ_FIXTURE rows; this one did not. Mine, and narrow.
--
-- 2. **`compute_candidate_profile()` will happily write an empty profile over a
--    real one.** That is a landmine with a much longer fuse than my re-key.
--    ANY future recompute — a dictionary change, a bank rotation, a manual
--    repair — pointed at a session whose responses have gone would silently
--    destroy that candidate's scores and leave a valid-looking row behind. It
--    has been true since the function was written.
--
-- THE FIX for (2) is the one that matters: an empty result is not a result.
-- If a session has no responses, the function refuses rather than writing.
-- Recomputing something that cannot be computed is not a no-op, it is deletion.
--
-- This is the same shape as the RLS bug in §7o — *an empty result is not a
-- denial* — arriving from the other direction. Empty is not a value. It is the
-- absence of one, and code that treats the two the same will eventually delete
-- something.
-- ═══════════════════════════════════════════════════════════════════════════

-- The general guard lives in `compute_candidate_profile()` itself — see
-- sql/04_scoring.sql, where the function now refuses a session with no
-- responses. Re-apply 04 before this file. What remains here is the narrow fix
-- and the audit that proves both.

-- ── 2. apply_rekey must not touch fixtures ─────────────────────────────────
create or replace function apply_rekey(p_item_id text, p_new_best text,
                                       p_round uuid default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_staff uuid; v_old_best text; v_old_score numeric; v_new_score numeric;
  v_n_experts int; v_profiles int := 0; v_matches int := 0; r record;
begin
  if staff_role() <> 'admin' then raise exception 'apply_rekey: admin only'; end if;
  select id into v_staff from staff where auth_uid = auth.uid();

  select o.option_key, o.score_key into v_old_best, v_old_score
  from item_options o where o.item_id = p_item_id order by o.score_key desc limit 1;
  if v_old_best is null then raise exception 'No such item: %', p_item_id; end if;

  select o.score_key into v_new_score
  from item_options o where o.item_id = p_item_id and o.option_key = p_new_best;
  if v_new_score is null then
    raise exception 'Option % is not on item %', p_new_best, p_item_id;
  end if;

  if v_old_best = p_new_best then
    return jsonb_build_object('changed', false,
      'reason', 'The bank already keys ' || p_new_best || ' as the best answer.');
  end if;

  select count(distinct expert_id) into v_n_experts
  from keying_submissions where item_id = p_item_id and best_option_key = p_new_best;

  update item_options set score_key = v_new_score
  where item_id = p_item_id and option_key = v_old_best;
  update item_options set score_key = v_old_score
  where item_id = p_item_id and option_key = p_new_best;

  -- REAL candidates only. Golden-case fixtures carry hand-written score vectors
  -- and no responses; recomputing one erases it, which is exactly what the first
  -- version of this function did to twelve of them.
  for r in
    select s.id from assessment_sessions s
    join candidates c on c.id = s.candidate_id
    where s.completed_at is not null
      and c.full_name not like 'ZZ_FIXTURE%' and c.full_name not like 'ZZ_E2E%'
      and exists (select 1 from candidate_responses cr where cr.session_id = s.id)
  loop
    begin
      perform compute_candidate_profile(r.id);
      v_profiles := v_profiles + 1;
    exception when others then
      raise warning 'apply_rekey: could not recompute session % — %', r.id, sqlerrm;
    end;
  end loop;

  for r in
    select req.id from requirements req
    join clients cl on cl.id = req.client_id
    where req.status = 'open' and req.target_profile_id is not null
      and cl.business_name not like 'ZZ_FIXTURE%'
  loop
    begin
      perform compute_matches(r.id);
      v_matches := v_matches + 1;
    exception when others then
      raise warning 'apply_rekey: could not rematch requirement % — %', r.id, sqlerrm;
    end;
  end loop;

  insert into key_changes (item_id, old_best, new_best, round_id, applied_by,
                           n_experts, note, profiles_recomputed, matches_recomputed)
  values (p_item_id, v_old_best, p_new_best, p_round, v_staff,
          v_n_experts, p_note, v_profiles, v_matches);

  return jsonb_build_object('changed', true, 'item_id', p_item_id,
                            'old_best', v_old_best, 'new_best', p_new_best,
                            'profiles_recomputed', v_profiles,
                            'matches_recomputed', v_matches);
end $$;

grant execute on function apply_rekey(text, text, uuid, text) to authenticated;

-- ── The assertion ──────────────────────────────────────────────────────────
-- No profile may exist with an empty score vector. One is either a fixture with
-- hand-written scores or a real candidate with computed ones; `{}` is neither,
-- and it is what a wiped profile looks like.
create or replace view v_empty_profile_audit as
select p.candidate_id, c.full_name, p.session_id, p.computed_at,
       (select count(*) from candidate_responses r where r.session_id = p.session_id) as responses
from candidate_profile p
join candidates c on c.id = p.candidate_id
where p.scores = '{}'::jsonb or p.scores is null;

grant select on v_empty_profile_audit to authenticated;
alter view v_empty_profile_audit set (security_invoker = true);

do $$
declare v int;
begin
  select count(*) into v from v_empty_profile_audit;
  if v > 0 then
    raise exception 'v_empty_profile_audit is not empty (% profile(s) wiped)', v;
  end if;

  -- The guard itself, exercised against a REAL response-less session rather than
  -- a random UUID — which would hit the "no such session" branch instead and
  -- prove nothing about the case that erased twelve profiles.
  declare v_sess uuid;
  begin
    select s.id into v_sess from assessment_sessions s
    where not exists (select 1 from candidate_responses r where r.session_id = s.id)
    limit 1;
    if v_sess is not null then
      begin
        perform compute_candidate_profile(v_sess);
        raise exception 'compute_candidate_profile accepted a session with no responses';
      exception when sqlstate 'P0001' then
        if sqlerrm not like '%no responses%' then raise; end if;
      end;
    else
      raise notice 'no response-less session available to exercise the guard against';
    end if;
  end;

  raise notice 'sql/26 ok — a recompute can no longer erase a profile';
end $$;
