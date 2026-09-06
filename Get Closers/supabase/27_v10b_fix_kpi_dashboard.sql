-- Migration 27: V10b — Fix pravah_kpi_dashboard (never worked since V3)
--
-- pravah_kpi_dashboard references pravah_training.trainer_id in two places.
-- That column has never existed: 01_pravah_core.sql defines it as
-- trainer_uid. The function has therefore thrown on every single call since
-- migration 08 shipped on 2026-09-02:
--
--   ERROR 42703: column t.trainer_id does not exist
--   HINT: Perhaps you meant to reference the column "t.trainer_uid".
--
-- Consequence: the entire staff KRA/KPI scorecard has been non-functional
-- since it shipped. The /performance/ portal throws on load, which is why
-- pravah_scorecards holds zero rows — not because the feature went unused,
-- but because it could never run.
--
-- This is a pre-existing defect, unrelated to V10. Found while verifying
-- migration 26 for regressions.
--
-- Fix: the function body below is the live definition with both
-- trainer_id references corrected to trainer_uid. Nothing else is changed.

CREATE OR REPLACE FUNCTION public.pravah_kpi_dashboard(p_period_start date DEFAULT (date_trunc('month'::text, (CURRENT_DATE)::timestamp with time zone))::date, p_period_end date DEFAULT CURRENT_DATE, p_staff_uid uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_staff uuid := coalesce(p_staff_uid, auth.uid());
  v_result jsonb;
begin
  if not pravah_is_internal() then raise exception 'Pravah staff access required.'; end if;
  if p_period_end < p_period_start then raise exception 'Period end must be on or after period start.'; end if;

  with
  staff as (
    select auth_uid, display_name, role from pravah_memberships
    where active and client_id is null and auth_uid=v_staff limit 1
  ),
  selected as (
    select sr.id, sr.candidate_id, sr.technical_decision, sr.client_final_decision, sr.placement_id
    from pravah_selection_reviews sr where sr.reviewer_uid=v_staff and sr.review_date between p_period_start and p_period_end
  ),
  m3 as (
    select sr.id review_id, o.retained from selected sr join placement_outcomes o on o.placement_id=sr.placement_id and o.checkpoint='m3'
  ),
  trainings as (
    select t.* from pravah_training t
    where t.trainer_uid=v_staff and coalesce(t.started_at::date,t.created_at::date) between p_period_start and p_period_end
  ),
  managed_placements as (
    select distinct p.id,r.client_id from placements p join requirements r on r.id=p.requirement_id left join pravah_training t on t.placement_id=p.id
    where t.trainer_uid=v_staff or exists (select 1 from pravah_client_checkins ci where ci.client_id=r.client_id and ci.created_by=v_staff and ci.occurred_at::date between p_period_start and p_period_end)
  ),
  latest_reports as (
    select pr.*,mp.id managed_placement_id from pravah_performance_reports pr join managed_placements mp on mp.id=pr.placement_id
    where pr.period_start<=p_period_end and pr.period_end>=p_period_start and pr.voided_at is null
  ),
  report_attainment as (
    select lr.placement_id,
      case when tg.target_value>0 then case tg.target_unit when 'cash' then coalesce(lr.verified_cash_collected,0)/tg.target_value*100 when 'sales' then coalesce(lr.sales_count,0)/tg.target_value*100 else coalesce(lr.revenue_generated,0)/tg.target_value*100 end end attainment
    from latest_reports lr left join lateral (
      select t.* from pravah_targets t where t.placement_id=lr.placement_id and lr.period_start>=t.period_start and lr.period_end<=t.period_end order by t.period_start desc limit 1
    ) tg on true
  ),
  company_result as (
    select coalesce(sum(pr.verified_cash_collected),0) value from pravah_performance_reports pr
    where pr.period_start>=p_period_start and pr.period_end<=p_period_end and pr.voided_at is null and pr.cash_verification_status='verified'
  ),
  company_target as (
    select coalesce(sum(ct.target_value),0) value from pravah_company_targets ct where ct.period_start>=p_period_start and ct.period_end<=p_period_end
  ),
  checkins as (
    select count(*)::numeric actual from pravah_client_checkins ci where ci.created_by=v_staff and ci.occurred_at::date between p_period_start and p_period_end
  ),
  actions as (
    select count(*) filter(where a.status='done' and a.due_on is not null and a.completed_at::date<=a.due_on)::numeric on_time,
           count(*) filter(where a.status='done')::numeric done
    from pravah_actions a where a.owner_uid=v_staff and a.created_at::date between p_period_start and p_period_end
  ),
  insights as (
    select count(*) filter(where i.validation_status in ('implemented','validated'))::numeric validated,count(*)::numeric total
    from pravah_insights i where i.author_uid=v_staff and i.created_at::date between p_period_start and p_period_end
  ),
  interventions as (
    select count(*) filter(where effectiveness='improved')::numeric improved,count(*) filter(where effectiveness<>'pending')::numeric reviewed
    from pravah_interventions i where i.owner_uid=v_staff and i.created_at::date between p_period_start and p_period_end
  ),
  kpi_actuals as (
    select 'CSQ-1' code,case when count(*) filter(where technical_decision='pass')>0 then count(*) filter(where technical_decision='pass' and client_final_decision='accepted')::numeric/count(*) filter(where technical_decision='pass')*100 end actual from selected
    union all select 'CSQ-2',case when count(*)>0 then count(*) filter(where retained)::numeric/count(*)*100 end from m3
    union all select 'TCP-1',case when count(*) filter(where status in ('passed','failed'))>0 then count(*) filter(where status='passed')::numeric/count(*) filter(where status in ('passed','failed'))*100 end from trainings
    union all select 'TCP-2',case when count(*)>0 then count(*) filter(where attainment>=100)::numeric/count(*)*100 end from (select distinct placement_id,max(attainment) attainment from report_attainment group by placement_id)x
    union all select 'TCP-3',avg(attainment) from report_attainment where attainment is not null
    union all select 'TCP-4',case when (select value from company_target)>0 then (select value from company_result)/(select value from company_target)*100 end
    union all select 'PCS-1',case when count(*)>0 then count(*) filter(where o.retained)::numeric/count(*)*100 end from managed_placements mp join placement_outcomes o on o.placement_id=mp.id and o.checkpoint='m3'
    union all select 'PCS-2',case when count(*)>0 then count(*) filter(where o.retained)::numeric/count(*)*100 end from managed_placements mp join placement_outcomes o on o.placement_id=mp.id and o.checkpoint='m6'
    union all select 'PCS-3',avg(attainment) from report_attainment where attainment is not null
    union all select 'CMS-1',least(100,(select actual from checkins)/greatest(1,4*ceil(extract(day from(p_period_end-p_period_start+1))/7))*100)
    union all select 'CMS-2',avg(ci.satisfaction)::numeric/5*100 from pravah_client_checkins ci where ci.created_by=v_staff and ci.occurred_at::date between p_period_start and p_period_end and ci.satisfaction is not null
    union all select 'CMS-3',case when (select done from actions)>0 then (select on_time from actions)/(select done from actions)*100 end
    union all select 'SI-1',case when (select total from insights)>0 then (select validated from insights)/(select total from insights)*100 end
    union all select 'SI-2',case when (select reviewed from interventions)>0 then (select improved from interventions)/(select reviewed from interventions)*100 end
    union all select 'PD-1',case when count(*)>0 then count(*) filter(where pr.created_at::date<=pr.period_end+1)::numeric/count(*)*100 end from pravah_performance_reports pr where pr.created_by=v_staff and pr.period_start>=p_period_start and pr.period_end<=p_period_end and pr.voided_at is null
    union all select 'PD-2',case when count(*)>0 then count(*) filter(where pr.calls_attempted is not null and pr.connected_calls is not null and pr.sales_count is not null and pr.revenue_generated is not null and pr.cash_collected is not null and pr.blocker is not null and pr.support_required is not null and pr.next_period_plan is not null)::numeric/count(*)*100 end from pravah_performance_reports pr where pr.created_by=v_staff and pr.period_start>=p_period_start and pr.period_end<=p_period_end and pr.voided_at is null
  ),
  scored as (
    select k.code,k.name,k.kra_code,k.weight_pct,k.target_value,k.target_unit,k.data_source,k.formula,a.actual,
      case when a.actual is null or k.target_value is null then null else least(120,greatest(0,a.actual/k.target_value*100)) end score
    from pravah_kpi_definitions k left join kpi_actuals a using(code) where k.active
  ),
  with_kra as (
    select k.code,k.name,k.weight_pct,round(sum(s.score*(s.weight_pct/100.0))::numeric,2) kra_score,
      jsonb_agg(jsonb_build_object('code',s.code,'name',s.name,'weight_pct',s.weight_pct,'target',s.target_value,'actual',s.actual,'score',s.score,'data_source',s.data_source,'formula',s.formula) order by s.sort_order) kpis
    from pravah_kra_definitions k join scored s on s.kra_code=k.code where k.active group by k.code,k.name,k.weight_pct,k.sort_order
  )
  select jsonb_build_object(
    'staff',(select to_jsonb(staff) from staff),
    'period',jsonb_build_object('start',p_period_start,'end',p_period_end),
    'kras',coalesce((select jsonb_agg(jsonb_build_object('code',code,'name',name,'weight_pct',weight_pct,'score',kra_score,'kpis',kpis) order by code) from with_kra),'[]'::jsonb),
    'overall_score',(select round(sum(kra_score*(weight_pct/100.0))::numeric,2) from with_kra),
    'data_warnings',jsonb_build_array(
      case when not exists(select 1 from selected) then 'No technical interview attribution recorded for this period.' end,
      case when not exists(select 1 from company_target where value>0) then 'No company sales target configured for this period.' end,
      case when not exists(select 1 from pravah_insights where author_uid=v_staff and created_at::date between p_period_start and p_period_end) then 'No pattern insights recorded for this period.' end
    )
  ) into v_result;
  return v_result;
end $function$;


-- Verification — expect a scorecard document rather than an error:
--   select pravah_kpi_dashboard('2026-09-01','2026-09-30', null);

-- ═══════════════════════════════════════════════════════════════════
-- PART B — Closer scorecard: unscoreable must read "no data", not zero
-- ═══════════════════════════════════════════════════════════════════
-- As first written in migration 26, pravah_closer_scorecard coalesced an
-- unscoreable KRA to 0. A closer with no target set therefore saw 0.0 and
-- would reasonably read it as failure, when the truth is that the KRA cannot
-- be scored at all. That contradicts the principle the staff scorecard already
-- states: "missing data stays visible instead of becoming a zero."
--
-- Each KRA now returns null when its inputs cannot support a score, and the
-- overall score is a weighted average across only the scoreable KRAs,
-- renormalised so the remaining weights still total 100. If nothing is
-- scoreable, overall is null rather than zero.

create or replace function pravah_closer_scorecard(
  p_placement_id uuid default null,
  p_period_start date default null,
  p_period_end   date default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_placement uuid := p_placement_id;
  v_start date := coalesce(p_period_start, date_trunc('month', current_date)::date);
  v_end   date := coalesce(p_period_end, current_date);
  v_target numeric;
  v_calls bigint; v_conn bigint; v_qual bigint; v_meet bigint;
  v_sales bigint; v_cash numeric;
  v_slots bigint; v_complete bigint; v_days int;
  v_overall numeric; v_wsum numeric := 0; v_acc numeric := 0;
  s_act numeric; s_pipe numeric; s_rev numeric; s_disc numeric;
  v_warn jsonb := '[]'::jsonb;
begin
  if v_placement is null then
    select m.placement_id into v_placement from pravah_memberships m
     where m.auth_uid = auth.uid() and m.active and m.role = 'closer' limit 1;
  end if;
  if v_placement is null then raise exception 'No placement resolved'; end if;
  if not (pravah_is_internal()
          or v_placement in (select pravah_my_visible_placement_ids())) then
    raise exception 'Access denied for this placement';
  end if;

  -- closer submissions are the source of truth (PRD 25.2)
  select coalesce(sum(calls_attempted),0), coalesce(sum(connected_calls),0),
         coalesce(sum(qualified_opportunities),0), coalesce(sum(meetings_booked),0),
         coalesce(sum(sales_count),0), coalesce(sum(cash_collected),0),
         count(*),
         count(*) filter (where calls_attempted is not null and sales_count is not null and cash_collected is not null)
    into v_calls, v_conn, v_qual, v_meet, v_sales, v_cash, v_slots, v_complete
    from pravah_performance_reports
   where placement_id = v_placement
     and period_start between v_start and v_end
     and submitted_by_role = 'closer'
     and report_slot in ('midday','eod')
     and voided_at is null;

  select sum(target_value) into v_target from pravah_targets
   where placement_id = v_placement and period_start >= v_start and period_end <= v_end;

  v_days := greatest(1, (v_end - v_start) + 1);

  -- Activity: needs a target for attainment, and dials for connect rate.
  if v_target > 0 and v_slots > 0 then
    s_act := round((least(120, v_calls / v_target * 100) * 0.6
                  + case when v_calls > 0 then least(120, (v_conn::numeric / v_calls * 100) / 35 * 100) else 0 end * 0.4)::numeric, 1);
  end if;

  -- Pipeline: needs at least one submission to mean anything.
  if v_slots > 0 then
    s_pipe := round((least(120, v_qual) * 0.6 + least(120, v_meet) * 0.4)::numeric, 1);
  end if;

  -- Revenue: needs a target.
  if v_target > 0 then
    s_rev := round((least(120, v_sales / v_target * 100) * 0.5
                  + least(120, v_cash  / v_target * 100) * 0.5)::numeric, 1);
  end if;

  -- Discipline is always scoreable: not submitting is itself the measurement.
  s_disc := round((least(120, v_slots::numeric / (v_days * 2) * 100) * 0.6
                 + case when v_slots > 0 then least(120, v_complete::numeric / v_slots * 100) else 0 end * 0.4)::numeric, 1);

  -- weighted average across scoreable KRAs only, renormalised
  if s_act  is not null then v_acc := v_acc + s_act  * 30; v_wsum := v_wsum + 30; end if;
  if s_pipe is not null then v_acc := v_acc + s_pipe * 20; v_wsum := v_wsum + 20; end if;
  if s_rev  is not null then v_acc := v_acc + s_rev  * 35; v_wsum := v_wsum + 35; end if;
  if s_disc is not null then v_acc := v_acc + s_disc * 15; v_wsum := v_wsum + 15; end if;
  if v_wsum > 0 then v_overall := round((v_acc / v_wsum)::numeric, 1); end if;

  if v_target is null or v_target = 0 then
    v_warn := v_warn || to_jsonb(array['No target set for this period — Activity and Revenue cannot be scored.']);
  end if;
  if v_slots = 0 then
    v_warn := v_warn || to_jsonb(array['No reports submitted in this period.']);
  end if;

  return jsonb_build_object(
    'placement_id', v_placement,
    'period', jsonb_build_object('start', v_start, 'end', v_end),
    'overall_score', v_overall,
    'target_value', v_target,
    'kras', jsonb_build_array(
      jsonb_build_object('code','cl_activity','name','Activity','weight_pct',30,'score',s_act,
        'detail', jsonb_build_object('calls_attempted',v_calls,'connected_calls',v_conn,'target',v_target)),
      jsonb_build_object('code','cl_pipeline','name','Pipeline','weight_pct',20,'score',s_pipe,
        'detail', jsonb_build_object('qualified_opportunities',v_qual,'meetings_booked',v_meet)),
      jsonb_build_object('code','cl_revenue','name','Revenue','weight_pct',35,'score',s_rev,
        'detail', jsonb_build_object('sales_count',v_sales,'cash_collected',v_cash,'target',v_target)),
      jsonb_build_object('code','cl_discipline','name','Discipline','weight_pct',15,'score',s_disc,
        'detail', jsonb_build_object('slots_submitted',v_slots,'slots_expected',v_days*2,'complete',v_complete))
    ),
    'data_warnings', v_warn
  );
end;
$$;

revoke all on function pravah_closer_scorecard(uuid,date,date) from public, anon;
grant execute on function pravah_closer_scorecard(uuid,date,date) to authenticated;
