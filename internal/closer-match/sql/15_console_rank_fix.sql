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

drop view if exists v_console_clean;

create view v_console_clean as
select
  row_number() over (
    partition by requirement_id
    order by hard_filter_pass desc, composite_pct desc, candidate_id
  ) as engine_rank,
  requirement_id, requirement_title, business_name, candidate_id, full_name,
  composite_pct, quality_pct, fit_pct, cls_effective, confidence, benchmark_source,
  hard_filter_pass, hard_filter_fails, flags, attrition_risk_flag, frame_split_flag,
  top_reasons, top_concerns, frame_split_note, cross_client_line, weights_disclaimer
from v_console
where full_name not like 'ZZ_FIXTURE%' and full_name not like 'ZZ_E2E%';

grant select on v_console_clean to authenticated;

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

create or replace view v_requirements as
select r.id, r.title, r.status, r.ticket_size, r.cycle_days, r.roleplay_pack, r.opened_at,
       c.business_name, c.id as client_id,
       tp.confidence, tp.benchmark_source, tp.required_levels, tp.bipolar_targets,
       tp.cls_blend, tp.benchmark_conflicts,
       (select count(*) from matches m
          join candidates cd on cd.id = m.candidate_id
        where m.requirement_id = r.id and m.hard_filter_pass
          and cd.full_name not like 'ZZ_FIXTURE%' and cd.full_name not like 'ZZ_E2E%') as eligible,
       (select count(*) from matches m
          join candidates cd on cd.id = m.candidate_id
        where m.requirement_id = r.id
          and cd.full_name not like 'ZZ_FIXTURE%' and cd.full_name not like 'ZZ_E2E%') as assessed,
       (select round(max(m.composite) * 100, 1) from matches m
          join candidates cd on cd.id = m.candidate_id
        where m.requirement_id = r.id and m.hard_filter_pass
          and cd.full_name not like 'ZZ_FIXTURE%' and cd.full_name not like 'ZZ_E2E%') as best_pct
from requirements r
join clients c on c.id = r.client_id
left join client_target_profile tp on tp.id = r.target_profile_id
where c.business_name not like 'ZZ_FIXTURE%';

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
