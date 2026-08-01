-- ═══════════════════════════════════════════════════════════════════════════
-- 22 — scores in the candidate list
--
-- Asked for, twice, and the second time explicitly: *"maybe I can just see
-- scores? it is all data for me."*
--
-- The friction was mine, not the PRD's. R1 says scores never reach a CLIENT;
-- it says nothing about the firm that produced them. Rule 1 — a number never
-- appears without its reason — is a design principle I imposed to stop a score
-- becoming a verdict by accident, and it is worth keeping where the tool is
-- persuading somebody. It is not worth keeping when the owner of the data is
-- trying to read their own instrument. So the queue now carries:
--
--   · the nine raw dimension scores, in mono, on every assessed row
--   · every open role this candidate has been matched against, with the match
--     percentage and rank
--
-- What is deliberately NOT relaxed: nothing here reaches a client, `v_c10_audit`
-- still governs that, and the per-role numbers still travel WITH the role they
-- belong to — a match percentage detached from the requirement it was computed
-- against is not a smaller truth, it is a different one.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace view v_candidate_queue as
select cand.id, cand.full_name, cand.created_at, cand.last_activity_at,
       p.computed_at as profiled_at, p.flags,
       s.completed_at is not null as assessment_complete,

       (select count(*) from matches m
          join requirements req on req.id = m.requirement_id
          join clients cl on cl.id = req.client_id
        where m.candidate_id = cand.id and m.hard_filter_pass
          and req.status = 'open'
          and cl.business_name not like 'ZZ_FIXTURE%')          as eligible_reqs,

       (select count(*) from requirements req
          join clients cl on cl.id = req.client_id
        where req.status = 'open' and req.target_profile_id is not null
          and cl.business_name not like 'ZZ_FIXTURE%')           as open_reqs,

       -- The nine, raw. Mono strip on the row; the detail page is still where
       -- each one is read against its target.
       p.scores,

       -- Every open role, with where they landed on it. Ordered best first so
       -- the row's headline number is the one worth reading.
       (select coalesce(jsonb_agg(jsonb_build_object(
                 'requirement_id', v.requirement_id,
                 'title', v.requirement_title,
                 'business_name', v.business_name,
                 'pct', v.composite_pct,
                 'rank', v.engine_rank,
                 'of', (select count(*) from v_console_clean v2
                         where v2.requirement_id = v.requirement_id),
                 'pass', v.hard_filter_pass,
                 'fails', v.hard_filter_fails)
               order by v.composite_pct desc), '[]'::jsonb)
        from v_console_clean v
        join requirements req on req.id = v.requirement_id
        where v.candidate_id = cand.id and req.status = 'open'
          and v.business_name not like 'ZZ_FIXTURE%')            as roles,

       (select max(v.composite_pct)
        from v_console_clean v
        join requirements req on req.id = v.requirement_id
        where v.candidate_id = cand.id and req.status = 'open'
          and v.business_name not like 'ZZ_FIXTURE%')            as best_pct

from candidates cand
left join lateral (
  select * from candidate_profile where candidate_id = cand.id order by computed_at desc limit 1
) p on true
left join lateral (
  select * from assessment_sessions where candidate_id = cand.id order by started_at desc limit 1
) s on true
where cand.full_name not like 'ZZ_FIXTURE%';

grant select on v_candidate_queue to authenticated;
alter view v_candidate_queue set (security_invoker = true);

do $$
declare v int;
begin
  -- The relaxation must not have reached past staff. Both audits still empty.
  select count(*) into v from v_rls_bypass_audit;
  if v > 0 then raise exception 'v_rls_bypass_audit is not empty (%)', v; end if;
  select count(*) into v from v_c10_audit;
  if v > 0 then raise exception 'v_c10_audit is not empty (%)', v; end if;
  raise notice 'sql/22 ok — scores on the queue, nothing new reachable';
end $$;
