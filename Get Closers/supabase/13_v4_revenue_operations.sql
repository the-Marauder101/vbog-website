-- Pravah V4 operational updates. Run after 11_v4_revenue_engine.sql.
-- Kept separate so the canonical schema remains easy to review and rollback.

create or replace function pravah_revenue_update_lead(
  p_lead_id uuid,
  p_stage text default null,
  p_status text default null,
  p_owner_placement_id uuid default null,
  p_notes text default null
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_client uuid; v_stage text; v_status text;
begin
  if not pravah_is_internal() then raise exception 'Pravah staff access required.'; end if;
  select client_id into v_client from pravah_revenue_leads where id=p_lead_id;
  if v_client is null then raise exception 'Lead not found.'; end if;
  if p_stage is not null and not exists(select 1 from pravah_revenue_stages where code=p_stage and active) then raise exception 'Invalid revenue stage.'; end if;
  if p_owner_placement_id is not null and not exists(select 1 from placements p join requirements r on r.id=p.requirement_id where p.id=p_owner_placement_id and r.client_id=v_client) then raise exception 'Closer/client mismatch.'; end if;
  select coalesce(p_stage,stage),coalesce(p_status,status) into v_stage,v_status from pravah_revenue_leads where id=p_lead_id;
  if v_stage='won' then v_status:='won'; elsif v_stage='lost' then v_status:='lost'; elsif v_status in ('won','lost') then v_status:='active'; end if;
  update pravah_revenue_leads set stage=v_stage,status=v_status,owner_placement_id=coalesce(p_owner_placement_id,owner_placement_id),notes=coalesce(p_notes,notes),updated_at=now() where id=p_lead_id;
  insert into pravah_audit_events(client_id,entity_type,entity_id,action,actor_uid,payload) values(v_client,'revenue_lead',p_lead_id::text,'update',auth.uid(),jsonb_build_object('stage',v_stage,'status',v_status));
  return p_lead_id;
end $$;
revoke all on function pravah_revenue_update_lead(uuid,text,text,uuid,text) from public;
grant execute on function pravah_revenue_update_lead(uuid,text,text,uuid,text) to authenticated;

create or replace function pravah_revenue_update_deal(
  p_deal_id uuid,
  p_stage text default null,
  p_status text default null,
  p_value numeric default null,
  p_expected_close_on date default null,
  p_notes text default null
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_client uuid; v_stage text; v_status text;
begin
  if not pravah_is_internal() then raise exception 'Pravah staff access required.'; end if;
  select client_id into v_client from pravah_revenue_deals where id=p_deal_id;
  if v_client is null then raise exception 'Deal not found.'; end if;
  if p_stage is not null and not exists(select 1 from pravah_revenue_stages where code=p_stage and active) then raise exception 'Invalid revenue stage.'; end if;
  if p_value is not null and p_value<0 then raise exception 'Deal value cannot be negative.'; end if;
  select coalesce(p_stage,stage),coalesce(p_status,status) into v_stage,v_status from pravah_revenue_deals where id=p_deal_id;
  if v_stage='won' then v_status:='won'; elsif v_stage='lost' then v_status:='lost'; elsif v_stage not in ('won','lost') and v_status in ('won','lost') then v_status:='open'; end if;
  update pravah_revenue_deals set stage=v_stage,status=v_status,value=coalesce(p_value,value),expected_close_on=coalesce(p_expected_close_on,expected_close_on),closed_at=case when v_status in ('won','lost','cancelled') then coalesce(closed_at,now()) else null end,notes=coalesce(p_notes,notes),updated_at=now() where id=p_deal_id;
  insert into pravah_audit_events(client_id,entity_type,entity_id,action,actor_uid,payload) values(v_client,'revenue_deal',p_deal_id::text,'update',auth.uid(),jsonb_build_object('stage',v_stage,'status',v_status));
  return p_deal_id;
end $$;
revoke all on function pravah_revenue_update_deal(uuid,text,text,numeric,date,text) from public;
grant execute on function pravah_revenue_update_deal(uuid,text,text,numeric,date,text) to authenticated;

-- Confirm the revenue model remains isolated from the import layer.
comment on function pravah_revenue_dashboard(date,date,uuid) is 'V4 canonical revenue dashboard. V5 import/mapping writes through the source-key contracts; V6 adds restricted portal reads.';
