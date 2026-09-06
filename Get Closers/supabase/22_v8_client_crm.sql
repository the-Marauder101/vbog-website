-- Pravah V8 — Client CRM write contracts.
-- Run after V1–V7 migrations. Safe to re-run.
-- V8 opens existing revenue write contracts to client_admin and adds
-- missing client-side RPCs for deal, lead update, sale, and import.

-- ═══ 1. CLIENT WRITE FUNCTIONS ═════════════════════════════════════════════

-- Update lead stage and/or notes (client_admin only, own client).
create or replace function pravah_client_update_lead(
  p_lead_id uuid,
  p_stage text default null,
  p_notes text default null,
  p_email text default null,
  p_phone text default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_client_id uuid; v_lead_client uuid;
begin
  select m.client_id into v_client_id from pravah_memberships m
  where m.auth_uid = auth.uid() and m.active and m.role = 'client_admin' limit 1;
  if v_client_id is null then raise exception 'Client admin access required.'; end if;

  select client_id into v_lead_client from pravah_revenue_leads where id = p_lead_id;
  if v_lead_client is null or v_lead_client <> v_client_id then
    raise exception 'Lead does not belong to your client.';
  end if;

  if p_stage is not null and not exists (select 1 from pravah_revenue_stages where code = p_stage and active) then
    raise exception 'Invalid stage code.';
  end if;

  update pravah_revenue_leads set
    stage = coalesce(p_stage, stage),
    notes = case when p_notes is not null then p_notes else notes end,
    email = case when p_email is not null then nullif(trim(p_email), '') else email end,
    phone = case when p_phone is not null then nullif(trim(p_phone), '') else phone end,
    updated_at = now()
  where id = p_lead_id;

  insert into pravah_audit_events(client_id, entity_type, entity_id, action, actor_uid, payload)
  values (v_client_id, 'revenue_lead', p_lead_id::text, 'update', auth.uid(),
    jsonb_build_object('stage', p_stage, 'source', 'client_portal'));
end $$;

-- Create deal (client_admin only, own client).
create or replace function pravah_client_create_deal(
  p_lead_id uuid,
  p_title text,
  p_value numeric default 0,
  p_currency text default 'INR',
  p_stage text default 'new',
  p_expected_close_on date default null,
  p_notes text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_client_id uuid; v_lead_client uuid; v_id uuid;
begin
  select m.client_id into v_client_id from pravah_memberships m
  where m.auth_uid = auth.uid() and m.active and m.role = 'client_admin' limit 1;
  if v_client_id is null then raise exception 'Client admin access required.'; end if;

  select client_id into v_lead_client from pravah_revenue_leads where id = p_lead_id;
  if v_lead_client is null or v_lead_client <> v_client_id then
    raise exception 'Lead does not belong to your client.';
  end if;

  insert into pravah_revenue_deals(
    client_id, lead_id, title, value, currency, stage,
    expected_close_on, notes, source_system, created_by
  ) values (
    v_client_id, p_lead_id, trim(p_title), p_value, coalesce(p_currency, 'INR'),
    coalesce(p_stage, 'new'), p_expected_close_on, p_notes,
    'client_portal', auth.uid()
  ) returning id into v_id;

  insert into pravah_audit_events(client_id, entity_type, entity_id, action, actor_uid, payload)
  values (v_client_id, 'revenue_deal', v_id::text, 'create', auth.uid(),
    jsonb_build_object('lead_id', p_lead_id, 'source', 'client_portal'));

  return v_id;
end $$;

-- Update deal stage (client_admin only, own client).
create or replace function pravah_client_update_deal(
  p_deal_id uuid,
  p_stage text default null,
  p_notes text default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_client_id uuid; v_deal_client uuid;
begin
  select m.client_id into v_client_id from pravah_memberships m
  where m.auth_uid = auth.uid() and m.active and m.role = 'client_admin' limit 1;
  if v_client_id is null then raise exception 'Client admin access required.'; end if;

  select client_id into v_deal_client from pravah_revenue_deals where id = p_deal_id;
  if v_deal_client is null or v_deal_client <> v_client_id then
    raise exception 'Deal does not belong to your client.';
  end if;

  if p_stage is not null and not exists (select 1 from pravah_revenue_stages where code = p_stage and active) then
    raise exception 'Invalid stage code.';
  end if;

  update pravah_revenue_deals set
    stage = coalesce(p_stage, stage),
    notes = case when p_notes is not null then p_notes else notes end,
    updated_at = now()
  where id = p_deal_id;

  insert into pravah_audit_events(client_id, entity_type, entity_id, action, actor_uid, payload)
  values (v_client_id, 'revenue_deal', p_deal_id::text, 'update', auth.uid(),
    jsonb_build_object('stage', p_stage, 'source', 'client_portal'));
end $$;

-- Record sale (client_admin only, own client).
create or replace function pravah_client_record_sale(
  p_lead_id uuid default null,
  p_deal_id uuid default null,
  p_sale_date date default current_date,
  p_gross_amount numeric default 0,
  p_discount_amount numeric default 0,
  p_net_amount numeric default 0,
  p_currency text default 'INR',
  p_notes text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_client_id uuid; v_id uuid; v_owner uuid;
begin
  select m.client_id into v_client_id from pravah_memberships m
  where m.auth_uid = auth.uid() and m.active and m.role = 'client_admin' limit 1;
  if v_client_id is null then raise exception 'Client admin access required.'; end if;

  if p_lead_id is not null then
    if not exists (select 1 from pravah_revenue_leads where id = p_lead_id and client_id = v_client_id) then
      raise exception 'Lead does not belong to your client.';
    end if;
  end if;
  if p_deal_id is not null then
    if not exists (select 1 from pravah_revenue_deals where id = p_deal_id and client_id = v_client_id) then
      raise exception 'Deal does not belong to your client.';
    end if;
  end if;

  insert into pravah_revenue_sales(
    client_id, deal_id, lead_id, sale_date,
    gross_amount, discount_amount, net_amount, currency,
    status, notes, source_system, created_by
  ) values (
    v_client_id, p_deal_id, p_lead_id, p_sale_date,
    p_gross_amount, p_discount_amount, p_net_amount,
    coalesce(p_currency, 'INR'), 'booked', p_notes,
    'client_portal', auth.uid()
  ) returning id into v_id;

  -- Close the deal if one is linked.
  if p_deal_id is not null then
    update pravah_revenue_deals set status = 'won', stage = 'won', closed_at = now(), updated_at = now()
    where id = p_deal_id and status = 'open';
  end if;

  insert into pravah_audit_events(client_id, entity_type, entity_id, action, actor_uid, payload)
  values (v_client_id, 'revenue_sale', v_id::text, 'create', auth.uid(),
    jsonb_build_object('source', 'client_portal'));

  return v_id;
end $$;

-- ═══ 2. OPEN IMPORT RPCS TO CLIENT_ADMIN ══════════════════════════════════
-- Re-create import functions with relaxed access: internal OR client_admin.

create or replace function pravah_import_create_profile(
  p_client_id uuid, p_source_system text, p_name text, p_parser_key text,
  p_config jsonb default '{}', p_field_mapping jsonb default '{}', p_stage_mapping jsonb default '{}', p_notes text default null
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_profile uuid; v_mapping uuid;
begin
  if not (pravah_is_internal() or pravah_is_client_admin(p_client_id)) then
    raise exception 'Staff or client admin access required.';
  end if;
  if not pravah_can_access_client(p_client_id) then raise exception 'Client access denied.'; end if;
  if nullif(btrim(p_source_system),'') is null or nullif(btrim(p_name),'') is null then raise exception 'Source system and profile name are required.'; end if;
  insert into pravah_import_profiles(client_id,source_system,name,parser_key,config)
  values(p_client_id,lower(trim(p_source_system)),trim(p_name),p_parser_key,coalesce(p_config,'{}'))
  on conflict(client_id,source_system,name) do update set parser_key=excluded.parser_key,config=excluded.config,active=true,updated_at=now()
  returning id into v_profile;
  update pravah_import_mapping_versions set active=false where profile_id=v_profile;
  insert into pravah_import_mapping_versions(profile_id,version_no,field_mapping,stage_mapping,notes)
  values(v_profile,coalesce((select max(version_no)+1 from pravah_import_mapping_versions where profile_id=v_profile),1),coalesce(p_field_mapping,'{}'),coalesce(p_stage_mapping,'{}'),p_notes)
  returning id into v_mapping;
  insert into pravah_audit_events(client_id,entity_type,entity_id,action,actor_uid,payload)
  values(p_client_id,'import_profile',v_profile::text,'mapping_version_created',auth.uid(),jsonb_build_object('mapping_version_id',v_mapping));
  return v_profile;
end $$;

create or replace function pravah_import_stage_rows(
  p_profile_id uuid, p_mapping_version_id uuid, p_source_filename text, p_source_checksum text, p_rows jsonb
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_batch uuid; v_client uuid; r jsonb; v_row int:=0; v_key text;
begin
  select client_id into v_client from pravah_import_profiles where id=p_profile_id and active;
  if v_client is null then raise exception 'Active import profile not found.'; end if;
  if not (pravah_is_internal() or pravah_is_client_admin(v_client)) then raise exception 'Staff or client admin access required.'; end if;
  if not pravah_can_access_client(v_client) then raise exception 'Client access denied.'; end if;
  if not exists(select 1 from pravah_import_mapping_versions where id=p_mapping_version_id and profile_id=p_profile_id and active) then raise exception 'Active mapping version does not belong to the profile.'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows)=0 or jsonb_array_length(p_rows)>2000 then raise exception 'Provide 1–2000 source rows.'; end if;
  if nullif(btrim(coalesce(p_source_checksum,'')),'') is null then raise exception 'A source checksum is required for idempotency.'; end if;
  insert into pravah_import_batches(profile_id,mapping_version_id,source_filename,source_checksum,row_count)
  values(p_profile_id,p_mapping_version_id,nullif(trim(p_source_filename),''),p_source_checksum,jsonb_array_length(p_rows)) returning id into v_batch;
  for r in select value from jsonb_array_elements(p_rows) loop
    v_row:=v_row+1; v_key:=nullif(btrim(coalesce(r->>'source_record_key','')),'');
    if v_key is null then raise exception 'Row % is missing source_record_key.',v_row; end if;
    insert into pravah_import_rows(batch_id,profile_id,mapping_version_id,row_number,source_record_key,raw_payload,status)
    values(v_batch,p_profile_id,p_mapping_version_id,v_row,v_key,r,'staged')
    on conflict(profile_id,source_record_key) do nothing;
  end loop;
  insert into pravah_audit_events(client_id,entity_type,entity_id,action,actor_uid,payload)
  values(v_client,'import_batch',v_batch::text,'staged',auth.uid(),jsonb_build_object('row_count',jsonb_array_length(p_rows),'checksum',p_source_checksum));
  return v_batch;
end $$;

create or replace function pravah_import_validate_batch(p_batch_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare b pravah_import_batches%rowtype; r pravah_import_rows%rowtype; v_errors jsonb; v_normalized jsonb; v_stage text; v_status text; v_valid int:=0; v_repair int:=0; v_client uuid;
begin
  select * into b from pravah_import_batches where id=p_batch_id for update;
  select client_id into v_client from pravah_import_profiles where id=b.profile_id;
  if b.id is null or not (pravah_is_internal() or pravah_is_client_admin(v_client)) or not pravah_can_access_client(v_client) then raise exception 'Import batch access required.'; end if;
  for r in select * from pravah_import_rows where batch_id=b.id and status in ('staged','needs_repair') order by row_number loop
    v_errors:='[]'::jsonb; v_normalized:=jsonb_build_object('record_type',coalesce(r.raw_payload->>'record_type','call_log'),'source_record_key',r.source_record_key);
    if coalesce(r.raw_payload->>'record_type','call_log') <> 'call_log' then
      v_errors:=jsonb_build_array(jsonb_build_object('field','record_type','message','Only call_log rows replay automatically; daily reports remain preserved for review.'));
    else
      if nullif(btrim(coalesce(r.raw_payload->>'contact_key',r.raw_payload->>'client_number','')),'') is null then v_errors:=v_errors || jsonb_build_array(jsonb_build_object('field','contact_key','message','A stable client phone or source contact key is required.')); end if;
      if nullif(btrim(coalesce(r.raw_payload->>'full_name',r.raw_payload->>'client_name','')),'') is null then v_errors:=v_errors || jsonb_build_array(jsonb_build_object('field','full_name','message','Client name is required.')); end if;
      if nullif(btrim(coalesce(r.raw_payload->>'crm_status','')),'') is null then
        v_stage:='new';
      else
        select stage_mapping->>lower(r.raw_payload->>'crm_status') into v_stage from pravah_import_mapping_versions where id=b.mapping_version_id;
        if v_stage is null or not exists(select 1 from pravah_revenue_stages where code=v_stage and active) then
          v_errors:=v_errors || jsonb_build_array(jsonb_build_object('field','crm_status','message','No approved mapping to a canonical revenue stage.'));
        end if;
      end if;
      v_normalized:=v_normalized || jsonb_build_object('lead_key','lead:'||coalesce(r.raw_payload->>'contact_key',r.raw_payload->>'client_number'),'full_name',coalesce(r.raw_payload->>'full_name',r.raw_payload->>'client_name'),'phone',coalesce(r.raw_payload->>'phone',r.raw_payload->>'client_number'),'stage',v_stage,'activity_type',coalesce(r.raw_payload->>'activity_type','call'),'occurred_at',coalesce(r.raw_payload->>'occurred_at',r.raw_payload->>'call_at',now()::text),'duration_seconds',nullif(r.raw_payload->>'duration_seconds',''),'outcome',r.raw_payload->>'crm_status','notes',r.raw_payload->>'note');
    end if;
    v_status:=case when jsonb_array_length(v_errors)=0 then 'valid' else 'needs_repair' end;
    update pravah_import_rows set normalized_payload=v_normalized,validation_errors=v_errors,status=v_status,validated_at=now() where id=r.id;
    if v_status='valid' then v_valid:=v_valid+1; else v_repair:=v_repair+1; end if;
  end loop;
  update pravah_import_batches set status=case when v_repair>0 then 'needs_repair' else 'validated' end,valid_count=v_valid,repair_count=v_repair,validated_at=now() where id=b.id;
  return jsonb_build_object('batch_id',b.id,'valid_count',v_valid,'repair_count',v_repair);
end $$;

create or replace function pravah_import_replay_batch(p_batch_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare b pravah_import_batches%rowtype; r pravah_import_rows%rowtype; v_client uuid; v_lead uuid; v_activity uuid; v_replay uuid; v_imported int:=0; v_duplicate int:=0; v_repair int:=0; v_attempted int:=0;
begin
  select * into b from pravah_import_batches where id=p_batch_id for update;
  select client_id into v_client from pravah_import_profiles where id=b.profile_id;
  if b.id is null or not (pravah_is_internal() or pravah_is_client_admin(v_client)) or not pravah_can_access_client(v_client) then raise exception 'Import batch access required.'; end if;
  perform pravah_import_validate_batch(b.id);
  insert into pravah_import_replays(batch_id,initiated_by) values(b.id,auth.uid()) returning id into v_replay;
  for r in select * from pravah_import_rows where batch_id=b.id and status='valid' order by row_number for update loop
    v_attempted:=v_attempted+1;
    select id into v_lead from pravah_revenue_leads where client_id=v_client and source_system=(select source_system from pravah_import_profiles where id=b.profile_id) and source_record_key=r.normalized_payload->>'lead_key';
    if v_lead is null then
      insert into pravah_revenue_leads(client_id,full_name,phone,source,stage,source_system,source_record_key,metadata)
      values(v_client,r.normalized_payload->>'full_name',nullif(r.normalized_payload->>'phone',''),'v5_import',r.normalized_payload->>'stage',(select source_system from pravah_import_profiles where id=b.profile_id),r.normalized_payload->>'lead_key',jsonb_build_object('import_profile_id',b.profile_id,'raw_row_id',r.id)) returning id into v_lead;
    end if;
    select id into v_activity from pravah_revenue_activities where client_id=v_client and source_system=(select source_system from pravah_import_profiles where id=b.profile_id) and source_record_key=r.source_record_key;
    if v_activity is not null then update pravah_import_rows set status='duplicate',revenue_lead_id=v_lead,revenue_activity_id=v_activity,imported_at=now() where id=r.id; v_duplicate:=v_duplicate+1;
    else
      insert into pravah_revenue_activities(client_id,lead_id,activity_type,occurred_at,outcome,duration_seconds,notes,source_system,source_record_key,metadata)
      values(v_client,v_lead,r.normalized_payload->>'activity_type',coalesce(nullif(r.normalized_payload->>'occurred_at','')::timestamptz,now()),nullif(r.normalized_payload->>'outcome',''),nullif(r.normalized_payload->>'duration_seconds','')::int,nullif(r.normalized_payload->>'notes',''),(select source_system from pravah_import_profiles where id=b.profile_id),r.source_record_key,jsonb_build_object('import_batch_id',b.id,'import_row_id',r.id,'raw_payload',r.raw_payload)) returning id into v_activity;
      update pravah_revenue_leads set last_activity_at=greatest(coalesce(last_activity_at,'epoch'::timestamptz),coalesce(nullif(r.normalized_payload->>'occurred_at','')::timestamptz,now())),first_contact_at=coalesce(first_contact_at,coalesce(nullif(r.normalized_payload->>'occurred_at','')::timestamptz,now())),updated_at=now() where id=v_lead;
      update pravah_import_rows set status='imported',revenue_lead_id=v_lead,revenue_activity_id=v_activity,imported_at=now() where id=r.id; v_imported:=v_imported+1;
    end if;
  end loop;
  select count(*) into v_repair from pravah_import_rows where batch_id=b.id and status='needs_repair';
  update pravah_import_replays set status='completed',attempted_count=v_attempted,imported_count=v_imported,duplicate_count=v_duplicate,repair_count=v_repair,completed_at=now() where id=v_replay;
  update pravah_import_batches set status=case when v_repair>0 then 'needs_repair' else 'replayed' end,imported_count=imported_count+v_imported,replayed_at=now() where id=b.id;
  insert into pravah_audit_events(client_id,entity_type,entity_id,action,actor_uid,payload) values(v_client,'import_batch',b.id::text,'replayed',auth.uid(),jsonb_build_object('imported',v_imported,'duplicates',v_duplicate,'needs_repair',v_repair));
  return jsonb_build_object('batch_id',b.id,'imported_count',v_imported,'duplicate_count',v_duplicate,'repair_count',v_repair);
exception when others then
  if v_replay is not null then update pravah_import_replays set status='failed',failure_note=sqlerrm,completed_at=now() where id=v_replay; end if;
  raise;
end $$;

-- ═══ 3. IMPORT TABLE RLS FOR CLIENT_ADMIN ═════════════════════════════════
-- Allow client_admin to read AND write import tables for their own client.

-- Profiles: client_admin can read and insert/update their own.
drop policy if exists pravah_import_profiles_client_write on pravah_import_profiles;
create policy pravah_import_profiles_client_write on pravah_import_profiles for all to authenticated
  using (
    exists (select 1 from pravah_memberships m where m.auth_uid = auth.uid() and m.active and m.client_id = pravah_import_profiles.client_id and m.role = 'client_admin')
  )
  with check (
    exists (select 1 from pravah_memberships m where m.auth_uid = auth.uid() and m.active and m.client_id = pravah_import_profiles.client_id and m.role = 'client_admin')
  );

-- Mapping versions: client_admin can read via profile join.
drop policy if exists pravah_import_mapping_versions_client_read on pravah_import_mapping_versions;
create policy pravah_import_mapping_versions_client_read on pravah_import_mapping_versions for select to authenticated
  using (
    exists (
      select 1 from pravah_import_profiles p
      join pravah_memberships m on m.client_id = p.client_id and m.auth_uid = auth.uid() and m.active and m.role in ('client_admin','client_viewer')
      where p.id = pravah_import_mapping_versions.profile_id
    )
  );

-- Batches: client_admin can read via profile join.
drop policy if exists pravah_import_batches_client_read on pravah_import_batches;
create policy pravah_import_batches_client_read on pravah_import_batches for select to authenticated
  using (
    exists (
      select 1 from pravah_import_profiles p
      join pravah_memberships m on m.client_id = p.client_id and m.auth_uid = auth.uid() and m.active and m.role in ('client_admin','client_viewer')
      where p.id = pravah_import_batches.profile_id
    )
  );

-- Rows: client_admin can read via profile join.
drop policy if exists pravah_import_rows_client_read on pravah_import_rows;
create policy pravah_import_rows_client_read on pravah_import_rows for select to authenticated
  using (
    exists (
      select 1 from pravah_import_profiles p
      join pravah_memberships m on m.client_id = p.client_id and m.auth_uid = auth.uid() and m.active and m.role in ('client_admin','client_viewer')
      where p.id = pravah_import_rows.profile_id
    )
  );

-- Replays: client_admin can read via batch->profile join.
drop policy if exists pravah_import_replays_client_read on pravah_import_replays;
create policy pravah_import_replays_client_read on pravah_import_replays for select to authenticated
  using (
    exists (
      select 1 from pravah_import_batches b
      join pravah_import_profiles p on p.id = b.profile_id
      join pravah_memberships m on m.client_id = p.client_id and m.auth_uid = auth.uid() and m.active and m.role in ('client_admin','client_viewer')
      where b.id = pravah_import_replays.batch_id
    )
  );

-- Grant insert/update on import tables for the RPCs (security definer handles access).
grant insert, update on pravah_import_profiles to authenticated;
grant insert, update on pravah_import_mapping_versions to authenticated;
grant insert, update on pravah_import_batches to authenticated;
grant insert, update on pravah_import_rows to authenticated;
grant insert on pravah_import_replays to authenticated;
grant update on pravah_import_replays to authenticated;

-- ═══ 4. GRANT PERMISSIONS ═════════════════════════════════════════════════

do $$
declare signature text;
begin
  foreach signature in array array[
    'pravah_client_update_lead(uuid,text,text,text,text)',
    'pravah_client_create_deal(uuid,text,numeric,text,text,date,text)',
    'pravah_client_update_deal(uuid,text,text)',
    'pravah_client_record_sale(uuid,uuid,date,numeric,numeric,numeric,text,text)'
  ] loop
    execute format('revoke all on function %s from public', signature);
    execute format('grant execute on function %s to authenticated', signature);
  end loop;
end $$;

-- Ensure revenue tables have insert/update grants for the client RPCs.
grant insert on pravah_revenue_deals to authenticated;
grant insert on pravah_revenue_sales to authenticated;
grant update on pravah_revenue_deals to authenticated;
grant update on pravah_revenue_leads to authenticated;

notify pgrst, 'reload schema';
