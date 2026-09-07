-- Migration 29: V10d — pravah_kpi_dashboard, remaining defects
--
-- Migrations 27 and 28 each fixed one wrong column name in this function and
-- each revealed another fault behind it. Rather than continue one per deploy,
-- the function's entire query was extracted, its plpgsql variables replaced
-- with literals, and executed directly as a read-only SELECT until it ran
-- clean. That surfaced every remaining fault at once.
--
-- Two further pre-existing defects, both of which prove the function had
-- never executed:
--
--   1. extract(day from (p_period_end - p_period_start + 1))
--      date minus date yields an integer, not an interval, so extract() has
--      no matching signature — ERROR 42883. The intent is simply the day
--      count, so the integer is used directly.
--
--   2. order by s.sort_order in the with_kra CTE, where the scored CTE never
--      selected sort_order — ERROR 42703. k.sort_order is now carried
--      through scored.
--
-- And one regression introduced by migration 26, which is mine:
--
--   3. Migration 26 added closer KRAs and KPIs to the shared definition
--      tables, scoped by a new `subject` column. pravah_kpi_dashboard does
--      not filter on it, so once V10 landed the four closer KRAs began
--      appearing inside the staff scorecard and diluting its overall score.
--      Both CTEs now filter subject = 'staff'.
--
-- Verified against production before shipping: the query returns a document
-- with exactly six staff KRAs, no cl_* leakage, and the three expected data
-- warnings.

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
    where t.trainer_uid=v_staff and coalesce(t.started_on::date,t.created_at::date) between p_period_start and p_period_end
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
    union all select 'CMS-1',least(100,(select actual from checkins)/greatest(1,4*ceil(((p_period_end-p_period_start+1)::numeric/7)))*100)
    union all select 'CMS-2',avg(ci.satisfaction)::numeric/5*100 from pravah_client_checkins ci where ci.created_by=v_staff and ci.occurred_at::date between p_period_start and p_period_end and ci.satisfaction is not null
    union all select 'CMS-3',case when (select done from actions)>0 then (select on_time from actions)/(select done from actions)*100 end
    union all select 'SI-1',case when (select total from insights)>0 then (select validated from insights)/(select total from insights)*100 end
    union all select 'SI-2',case when (select reviewed from interventions)>0 then (select improved from interventions)/(select reviewed from interventions)*100 end
    union all select 'PD-1',case when count(*)>0 then count(*) filter(where pr.created_at::date<=pr.period_end+1)::numeric/count(*)*100 end from pravah_performance_reports pr where pr.created_by=v_staff and pr.period_start>=p_period_start and pr.period_end<=p_period_end and pr.voided_at is null
    union all select 'PD-2',case when count(*)>0 then count(*) filter(where pr.calls_attempted is not null and pr.connected_calls is not null and pr.sales_count is not null and pr.revenue_generated is not null and pr.cash_collected is not null and pr.blocker is not null and pr.support_required is not null and pr.next_period_plan is not null)::numeric/count(*)*100 end from pravah_performance_reports pr where pr.created_by=v_staff and pr.period_start>=p_period_start and pr.period_end<=p_period_end and pr.voided_at is null
  ),
  scored as (
    select k.code,k.name,k.kra_code,k.weight_pct,k.target_value,k.target_unit,k.data_source,k.formula,k.sort_order,a.actual,
      case when a.actual is null or k.target_value is null then null else least(120,greatest(0,a.actual/k.target_value*100)) end score
    from pravah_kpi_definitions k left join kpi_actuals a using(code) where k.active and k.subject='staff'
  ),
  with_kra as (
    select k.code,k.name,k.weight_pct,round(sum(s.score*(s.weight_pct/100.0))::numeric,2) kra_score,
      jsonb_agg(jsonb_build_object('code',s.code,'name',s.name,'weight_pct',s.weight_pct,'target',s.target_value,'actual',s.actual,'score',s.score,'data_source',s.data_source,'formula',s.formula) order by s.sort_order) kpis
    from pravah_kra_definitions k join scored s on s.kra_code=k.code where k.active and k.subject='staff' group by k.code,k.name,k.weight_pct,k.sort_order
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

-- Verification:
--   select jsonb_array_length(pravah_kpi_dashboard('2026-09-01','2026-09-30',null)->'kras');
--   -- expect 6, and no code beginning cl_
