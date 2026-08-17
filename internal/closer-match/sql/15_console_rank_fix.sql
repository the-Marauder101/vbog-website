-- ═══════════════════════════════════════════════════════════════════════════
-- FIX: shortlist ranks were numbered over a pool that included test fixtures.
--
-- v_console ranks every match for a requirement, then v_console_clean filtered
-- the golden-case fixtures out afterwards. So a real two-candidate shortlist
-- rendered as ranks 1 and 13, under a heading reading "1 eligible of 2". The
-- number was true and useless: it counted rows the recruiter cannot see.
--
-- Rank now runs over the rows actually rendered. Ordering is unchanged — hard
-- filter passes first, then composite, then candidate_id as a deterministic
-- tiebreak so a reload cannot reshuffle equal scores.
--
-- DROP then CREATE, because CREATE OR REPLACE VIEW cannot change column order,
-- and engine_rank has to be computed here rather than inherited.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── v_console_clean lives in sql/33 ────────────────────────────────────────
-- It used to be redefined here. Several files defined it, so the live schema
-- depended on which migration ran most recently and re-applying an earlier one
-- silently reverted later work. Defined once now, in the highest-numbered
-- migration. Edit it there. See sql/33.


do $$
declare v_bad int;
begin
  -- Every visible shortlist must start at 1 and have no gaps.
  select count(*) into v_bad from (
    select requirement_id, count(*) as n, max(engine_rank) as top
    from v_console_clean group by requirement_id
  ) t where t.n <> t.top;
  if v_bad > 0 then
    raise exception '% requirement(s) still have gapped shortlist ranks', v_bad;
  end if;
  raise notice 'Shortlist ranks are contiguous within every requirement.';
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Same bug, second place: the requirements list counted fixture candidates in
-- its eligible/assessed totals and best-match figure, so a real one-candidate
-- requirement read "10 of 14 eligible". Counts now match what the shortlist
-- shows, which is the only number a recruiter can act on.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── v_requirements lives in sql/33 ─────────────────────────────────────────
-- Three files defined it and only the last excluded test rows from its counts.
-- Defined once now, in the highest-numbered migration. Edit it there.


do $$
declare v_bad int;
begin
  -- The list's "eligible of assessed" must agree with the shortlist it links to.
  select count(*) into v_bad
  from v_requirements q
  where q.assessed <> (select count(*) from v_console_clean k where k.requirement_id = q.id);
  if v_bad > 0 then
    raise exception '% requirement(s) still count rows the shortlist does not show', v_bad;
  end if;
  raise notice 'Requirement counts agree with the visible shortlist.';
end $$;
