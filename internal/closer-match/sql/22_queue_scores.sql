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

-- ── v_candidate_queue lives in sql/33 ──────────────────────────────────────────
-- It used to be redefined here. Four files defined `v_candidate_queue` and two
-- defined `v_console_clean`, so the live schema depended on which migration ran
-- most recently — re-applying this file silently reverted later fixes. Both are
-- now defined once, in the highest-numbered migration, so numeric order puts
-- them last and no earlier file can undo them. Edit them there. See sql/33.

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
