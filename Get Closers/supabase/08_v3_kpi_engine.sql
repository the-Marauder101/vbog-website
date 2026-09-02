-- Pravah V3 — KRA/KPI management engine.
-- Run after 07_v2b_candidate_status_time_fix.sql. Safe to re-run.
-- V3 consumes existing operational records; it does not create a parallel manual tracker.

create table if not exists pravah_kra_definitions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  weight_pct numeric(5,2) not null check (weight_pct >= 0 and weight_pct <= 100),
  description text,
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists pravah_kpi_definitions (
  id uuid primary key default gen_random_uuid(),
  kra_code text not null references pravah_kra_definitions(code) on update cascade,
  code text not null unique,
  name text not null,
  description text not null,
  weight_pct numeric(5,2) not null check (weight_pct >= 0 and weight_pct <= 100),
  target_value numeric,
  target_unit text,
  direction text not null default 'higher_is_better' check (direction in ('higher_is_better','lower_is_better')),
  data_source text not null,
  formula text not null,
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists pravah_company_targets (
  id uuid primary key default gen_random_uuid(),
  period_start date not null,
  period_end date not null,
  target_value numeric not null check (target_value >= 0),
  target_unit text not null default 'cash',
  currency text not null default 'INR',
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (period_start, period_end, target_unit, currency)
);

create table if not exists pravah_selection_reviews (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references candidates(id) on delete restrict,
  reviewer_uid uuid not null,
  review_date date not null default current_date,
  technical_decision text not null check (technical_decision in ('pass','fail','hold')),
  client_final_decision text check (client_final_decision in ('accepted','rejected','withdrawn','pending')),
  placement_id uuid references placements(id) on delete set null,
  notes text,
  source_system text not null default 'pravah' check (source_system in ('pravah','vyom','nikash')),
  source_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table pravah_selection_reviews enable row level security;
alter table pravah_selection_reviews force row level security;
revoke all on pravah_selection_reviews from anon, authenticated;
grant select on pravah_selection_reviews to authenticated;
drop policy if exists pravah_selection_reviews_internal_read on pravah_selection_reviews;
create policy pravah_selection_reviews_internal_read on pravah_selection_reviews for select to authenticated
  using (pravah_is_internal());

create table if not exists pravah_insights (
  id uuid primary key default gen_random_uuid(),
  author_uid uuid not null,
  client_id uuid references clients(id) on delete set null,
  placement_id uuid references placements(id) on delete set null,
  category text not null check (category in ('candidate','training','lead_quality','sales_process','cultural','client','other')),
  observation text not null,
  pattern text not null,
  recommendation text not null,
  linked_action_id uuid references pravah_actions(id) on delete set null,
  validation_status text not null default 'open'
    check (validation_status in ('open','implemented','validated','invalidated')),
  outcome_note text,
  created_at timestamptz not null default now(),
  validated_at timestamptz,
  validated_by uuid
);
alter table pravah_insights enable row level security;
alter table pravah_insights force row level security;
revoke all on pravah_insights from anon, authenticated;
grant select on pravah_insights to authenticated;
drop policy if exists pravah_insights_internal_read on pravah_insights;
create policy pravah_insights_internal_read on pravah_insights for select to authenticated
  using (pravah_is_internal());

create table if not exists pravah_interventions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  placement_id uuid references placements(id) on delete set null,
  action_id uuid references pravah_actions(id) on delete set null,
  owner_uid uuid not null,
  problem text not null,
  baseline_metric text not null,
  baseline_value numeric,
  intervention text not null,
  review_on date,
  outcome_metric text,
  outcome_value numeric,
  effectiveness text not null default 'pending'
    check (effectiveness in ('pending','improved','no_change','worse','inconclusive')),
  outcome_note text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid
);
alter table pravah_interventions enable row level security;
alter table pravah_interventions force row level security;
revoke all on pravah_interventions from anon, authenticated;
grant select on pravah_interventions to authenticated;
drop policy if exists pravah_interventions_internal_read on pravah_interventions;
create policy pravah_interventions_internal_read on pravah_interventions for select to authenticated
  using (pravah_is_internal());

create table if not exists pravah_scorecards (
  id uuid primary key default gen_random_uuid(),
  staff_uid uuid not null,
  period_start date not null,
  period_end date not null,
  status text not null default 'draft' check (status in ('draft','final')),
  overall_score numeric(6,2),
  notes text,
  created_by uuid,
  finalized_by uuid,
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (staff_uid, period_start, period_end)
);
alter table pravah_scorecards enable row level security;
alter table pravah_scorecards force row level security;
revoke all on pravah_scorecards from anon, authenticated;
grant select on pravah_scorecards to authenticated;
drop policy if exists pravah_scorecards_internal_read on pravah_scorecards;
create policy pravah_scorecards_internal_read on pravah_scorecards for select to authenticated
  using (pravah_is_internal());

create table if not exists pravah_kpi_overrides (
  id uuid primary key default gen_random_uuid(),
  scorecard_id uuid not null references pravah_scorecards(id) on delete cascade,
  kpi_code text not null references pravah_kpi_definitions(code),
  override_score numeric(6,2) not null check (override_score >= 0 and override_score <= 120),
  reason text not null,
  evidence_url text,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  unique(scorecard_id, kpi_code)
);
alter table pravah_kpi_overrides enable row level security;
alter table pravah_kpi_overrides force row level security;
revoke all on pravah_kpi_overrides from anon, authenticated;
grant select on pravah_kpi_overrides to authenticated;
drop policy if exists pravah_kpi_overrides_internal_read on pravah_kpi_overrides;
create policy pravah_kpi_overrides_internal_read on pravah_kpi_overrides for select to authenticated
  using (pravah_is_internal());

insert into pravah_kra_definitions(code,name,weight_pct,description,sort_order) values
('candidate_selection','Candidate Selection Quality',20,'Quality of the technical interview and downstream candidate success.',1),
('training_performance','Training & Closer Performance',30,'Training quality and measurable closer sales performance.',2),
('closer_success','Placed Closer Success & Retention',20,'Retention and sustained performance of placed closers.',3),
('client_management','Client Management & Satisfaction',15,'Cadence, satisfaction and follow-through with clients.',4),
('sales_intelligence','Sales Intelligence / Pattern Recognition',10,'Ability to identify recurring patterns and turn them into interventions.',5),
('process_discipline','Process Discipline & Reporting',5,'Timely, complete and auditable reporting.',6)
on conflict (code) do update set name=excluded.name, weight_pct=excluded.weight_pct, description=excluded.description, sort_order=excluded.sort_order, updated_at=now();

insert into pravah_kpi_definitions(kra_code,code,name,description,weight_pct,target_value,target_unit,data_source,formula,sort_order) values
('candidate_selection','CSQ-1','Final-round acceptance rate','Percentage of technical-round passes that the client accepts in the final round.',60,90,'percent','selection_reviews','accepted technical passes / technical passes × 100',1),
('candidate_selection','CSQ-2','90-day success of selected candidates','Percentage of placed candidates attributed to this reviewer who are retained at the 90-day checkpoint.',40,85,'percent','selection_reviews + placement_outcomes','retained at M3 / due M3 outcomes × 100',2),
('training_performance','TCP-1','Training pass rate','Percentage of assigned trainees who complete training with a pass decision.',20,90,'percent','training','passed trainings / completed training decisions × 100',1),
('training_performance','TCP-2','Closers achieving target','Percentage of active managed closers reaching at least 100% of target.',30,80,'percent','performance_reports','closers with attainment >= 100 / active managed closers × 100',2),
('training_performance','TCP-3','Average target attainment','Average target attainment across active managed closers, using verified cash where the target unit is cash.',25,100,'percent','performance_reports + targets','average closer target attainment × 100',3),
('training_performance','TCP-4','Company sales target achievement','Company-level verified cash/revenue against the configured company target.',25,100,'percent','company_targets + performance_reports','verified company result / company target × 100',4),
('closer_success','PCS-1','90-day retention','Percentage of attributed placed closers retained at the M3 checkpoint.',30,85,'percent','placement_outcomes','retained at M3 / due M3 outcomes × 100',1),
('closer_success','PCS-2','6-month retention','Percentage of attributed placed closers retained at the M6 checkpoint.',30,75,'percent','placement_outcomes','retained at M6 / due M6 outcomes × 100',2),
('closer_success','PCS-3','Placed closer target attainment','Average target attainment for attributed placed closers during the period.',40,100,'percent','performance_reports + targets','average attributed closer attainment × 100',3),
('client_management','CMS-1','Check-in completion','Percentage of expected client check-ins completed by the responsible staff member.',35,95,'percent','client_checkins','completed expected check-ins / expected check-ins × 100',1),
('client_management','CMS-2','Client satisfaction','Average client satisfaction normalized to 100.',35,90,'percent','client_checkins','average satisfaction / 5 × 100',2),
('client_management','CMS-3','Action SLA','Percentage of owned client actions completed on or before the due date.',30,90,'percent','actions','on-time completed owned actions / completed owned actions × 100',3),
('sales_intelligence','SI-1','Validated pattern insights','Percentage of expected monthly insights that are implemented or validated.',40,100,'percent','insights','validated/implemented insights / expected insights × 100',1),
('sales_intelligence','SI-2','Intervention effectiveness','Percentage of reviewed interventions showing measurable improvement.',60,75,'percent','interventions','improved interventions / reviewed interventions × 100',2),
('process_discipline','PD-1','Report timeliness','Percentage of required closer reports submitted within one day of period end.',50,95,'percent','performance_reports','reports submitted within SLA / required reports × 100',1),
('process_discipline','PD-2','Report data completeness','Percentage of submitted non-void reports with all required operating fields populated.',50,98,'percent','performance_reports','complete reports / submitted reports × 100',2)
on conflict (code) do update set kra_code=excluded.kra_code,name=excluded.name,description=excluded.description,weight_pct=excluded.weight_pct,target_value=excluded.target_value,target_unit=excluded.target_unit,data_source=excluded.data_source,formula=excluded.formula,sort_order=excluded.sort_order,updated_at=now();

create or replace function pravah_kpi_dashboard(p_period_start date default date_trunc('month', current_date)::date, p_period_end date default current_date, p_staff_uid uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
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
    where t.trainer_id=v_staff and coalesce(t.started_at::date,t.created_at::date) between p_period_start and p_period_end
  ),
  managed_placements as (
    select distinct p.id,r.client_id from placements p join requirements r on r.id=p.requirement_id left join pravah_training t on t.placement_id=p.id
    where t.trainer_id=v_staff or exists (select 1 from pravah_client_checkins ci where ci.client_id=r.client_id and ci.created_by=v_staff and ci.occurred_at::date between p_period_start and p_period_end)
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
end $$;
revoke all on function pravah_kpi_dashboard(date,date,uuid) from public;
grant execute on function pravah_kpi_dashboard(date,date,uuid) to authenticated;

create or replace function pravah_finalize_scorecard(p_staff_uid uuid,p_period_start date,p_period_end date,p_notes text default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid; v_score numeric;
begin
  if not pravah_is_admin() then raise exception 'Pravah administrator access required.'; end if;
  v_score := (pravah_kpi_dashboard(p_period_start,p_period_end,p_staff_uid)->>'overall_score')::numeric;
  insert into pravah_scorecards(staff_uid,period_start,period_end,status,overall_score,notes,created_by,finalized_by,finalized_at)
  values(p_staff_uid,p_period_start,p_period_end,'final',v_score,p_notes,auth.uid(),auth.uid(),now())
  on conflict(staff_uid,period_start,period_end) do update set status='final',overall_score=excluded.overall_score,notes=excluded.notes,finalized_by=auth.uid(),finalized_at=now(),updated_at=now()
  returning id into v_id;
  return v_id;
end $$;
revoke all on function pravah_finalize_scorecard(uuid,date,date,text) from public;
grant execute on function pravah_finalize_scorecard(uuid,date,date,text) to authenticated;

create or replace function pravah_set_kpi_override(p_scorecard_id uuid,p_kpi_code text,p_score numeric,p_reason text,p_evidence_url text default null)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not pravah_is_admin() then raise exception 'Pravah administrator access required.'; end if;
  if p_score<0 or p_score>120 then raise exception 'Override score must be between 0 and 120.'; end if;
  if nullif(btrim(p_reason),'') is null then raise exception 'Override reason is required.'; end if;
  insert into pravah_kpi_overrides(scorecard_id,kpi_code,override_score,reason,evidence_url,created_by)
  values(p_scorecard_id,p_kpi_code,p_score,p_reason,p_evidence_url,auth.uid())
  on conflict(scorecard_id,kpi_code) do update set override_score=excluded.override_score,reason=excluded.reason,evidence_url=excluded.evidence_url,created_by=auth.uid(),created_at=now();
end $$;
revoke all on function pravah_set_kpi_override(uuid,text,numeric,text,text) from public;
grant execute on function pravah_set_kpi_override(uuid,text,numeric,text,text) to authenticated;
