-- Pravah V3A — KPI operations, write RPCs, roster and security hardening.
-- Run after 08_v3_kpi_engine.sql. Safe to re-run.

do $$
declare t text;
begin
  foreach t in array array['pravah_kra_definitions','pravah_kpi_definitions','pravah_company_targets'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('revoke all on %I from anon, authenticated', t);
    execute format('grant select on %I to authenticated', t);
  end loop;
end $$;

drop policy if exists pravah_kra_internal_read on pravah_kra_definitions;
create policy pravah_kra_internal_read on pravah_kra_definitions for select to authenticated using (pravah_is_internal());
drop policy if exists pravah_kpi_internal_read on pravah_kpi_definitions;
create policy pravah_kpi_internal_read on pravah_kpi_definitions for select to authenticated using (pravah_is_internal());
drop policy if exists pravah_company_target_internal_read on pravah_company_targets;
create policy pravah_company_target_internal_read on pravah_company_targets for select to authenticated using (pravah_is_internal());

create or replace function pravah_kpi_staff_roster()
returns jsonb language sql security definer set search_path=public as $$
  select coalesce(jsonb_agg(jsonb_build_object('auth_uid',auth_uid,'display_name',coalesce(display_name,role),'role',role) order by display_name nulls last),'[]'::jsonb)
  from pravah_memberships
  where active and client_id is null and pravah_is_internal();
$$;
revoke all on function pravah_kpi_staff_roster() from public;
grant execute on function pravah_kpi_staff_roster() to authenticated;

create or replace function pravah_record_selection_review(
  p_candidate_id uuid,p_review_date date,p_technical_decision text,
  p_client_final_decision text default 'pending',p_placement_id uuid default null,
  p_notes text default null,p_source_system text default 'pravah',p_source_reference text default null
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
  if not pravah_is_internal() then raise exception 'Pravah staff access required.'; end if;
  if p_technical_decision not in ('pass','fail','hold') then raise exception 'Invalid technical decision.'; end if;
  insert into pravah_selection_reviews(candidate_id,reviewer_uid,review_date,technical_decision,client_final_decision,placement_id,notes,source_system,source_reference)
  values(p_candidate_id,auth.uid(),coalesce(p_review_date,current_date),p_technical_decision,coalesce(p_client_final_decision,'pending'),p_placement_id,p_notes,coalesce(p_source_system,'pravah'),p_source_reference)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function pravah_record_selection_review(uuid,date,text,text,uuid,text,text,text) from public;
grant execute on function pravah_record_selection_review(uuid,date,text,text,uuid,text,text,text) to authenticated;

create or replace function pravah_record_insight(
  p_category text,p_observation text,p_pattern text,p_recommendation text,
  p_client_id uuid default null,p_placement_id uuid default null,p_linked_action_id uuid default null
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
  if not pravah_is_internal() then raise exception 'Pravah staff access required.'; end if;
  if p_category not in ('candidate','training','lead_quality','sales_process','cultural','client','other') then raise exception 'Invalid insight category.'; end if;
  if nullif(btrim(p_observation),'') is null or nullif(btrim(p_pattern),'') is null or nullif(btrim(p_recommendation),'') is null then raise exception 'Observation, pattern and recommendation are required.'; end if;
  insert into pravah_insights(author_uid,client_id,placement_id,category,observation,pattern,recommendation,linked_action_id)
  values(auth.uid(),p_client_id,p_placement_id,p_category,p_observation,p_pattern,p_recommendation,p_linked_action_id)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function pravah_record_insight(text,text,text,text,uuid,uuid,uuid) from public;
grant execute on function pravah_record_insight(text,text,text,text,uuid,uuid,uuid) to authenticated;

create or replace function pravah_record_intervention(
  p_client_id uuid,p_problem text,p_baseline_metric text,p_baseline_value numeric default null,
  p_intervention text default null,p_review_on date default null,p_placement_id uuid default null,p_action_id uuid default null
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
  if not pravah_is_internal() then raise exception 'Pravah staff access required.'; end if;
  if nullif(btrim(p_problem),'') is null or nullif(btrim(p_baseline_metric),'') is null or nullif(btrim(p_intervention),'') is null then raise exception 'Problem, baseline metric and intervention are required.'; end if;
  if not pravah_can_access_client(p_client_id) then raise exception 'Client is not accessible.'; end if;
  insert into pravah_interventions(client_id,placement_id,action_id,owner_uid,problem,baseline_metric,baseline_value,intervention,review_on)
  values(p_client_id,p_placement_id,p_action_id,auth.uid(),p_problem,p_baseline_metric,p_baseline_value,p_intervention,p_review_on)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function pravah_record_intervention(uuid,text,text,numeric,text,date,uuid,uuid) from public;
grant execute on function pravah_record_intervention(uuid,text,text,numeric,text,date,uuid,uuid) to authenticated;

create or replace function pravah_review_intervention(
  p_intervention_id uuid,p_effectiveness text,p_outcome_metric text default null,p_outcome_value numeric default null,p_outcome_note text default null
) returns void language plpgsql security definer set search_path=public as $$
begin
  if not pravah_is_internal() then raise exception 'Pravah staff access required.'; end if;
  if p_effectiveness not in ('improved','no_change','worse','inconclusive') then raise exception 'Invalid intervention outcome.'; end if;
  update pravah_interventions set effectiveness=p_effectiveness,outcome_metric=p_outcome_metric,outcome_value=p_outcome_value,outcome_note=p_outcome_note,reviewed_at=now(),reviewed_by=auth.uid() where id=p_intervention_id;
  if not found then raise exception 'Intervention not found.'; end if;
end $$;
revoke all on function pravah_review_intervention(uuid,text,text,numeric,text) from public;
grant execute on function pravah_review_intervention(uuid,text,text,numeric,text) to authenticated;

create or replace function pravah_set_company_target(
  p_period_start date,p_period_end date,p_target_value numeric,p_target_unit text default 'cash',p_currency text default 'INR',p_notes text default null
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
  if not pravah_is_admin() then raise exception 'Pravah administrator access required.'; end if;
  if p_period_end<p_period_start or p_target_value<0 then raise exception 'Invalid company target.'; end if;
  insert into pravah_company_targets(period_start,period_end,target_value,target_unit,currency,notes,created_by)
  values(p_period_start,p_period_end,p_target_value,p_target_unit,p_currency,p_notes,auth.uid())
  on conflict(period_start,period_end,target_unit,currency) do update set target_value=excluded.target_value,notes=excluded.notes,created_by=auth.uid()
  returning id into v_id;
  return v_id;
end $$;
revoke all on function pravah_set_company_target(date,date,numeric,text,text,text) from public;
grant execute on function pravah_set_company_target(date,date,numeric,text,text,text) to authenticated;

create or replace function pravah_update_kpi_definition_target(p_kpi_code text,p_target_value numeric)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not pravah_is_admin() then raise exception 'Pravah administrator access required.'; end if;
  if p_target_value is null or p_target_value<0 then raise exception 'Invalid KPI target.'; end if;
  update pravah_kpi_definitions set target_value=p_target_value,updated_at=now() where code=p_kpi_code and active;
  if not found then raise exception 'KPI not found.'; end if;
end $$;
revoke all on function pravah_update_kpi_definition_target(text,numeric) from public;
grant execute on function pravah_update_kpi_definition_target(text,numeric) to authenticated;
