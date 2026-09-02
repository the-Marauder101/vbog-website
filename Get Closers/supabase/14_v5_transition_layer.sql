-- Pravah V5 — transition layer for Sheets, CSV and CRM imports.
-- Additive and safe to re-run. V5 preserves source rows and only replays
-- validated call-log rows into the V4 canonical revenue model.

create table if not exists pravah_import_profiles (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  source_system text not null,
  name text not null,
  parser_key text not null check (parser_key in ('ceo_dashboard_callyzer','csv_generic','crm_generic')),
  active boolean not null default true,
  config jsonb not null default '{}',
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(client_id, source_system, name)
);

create table if not exists pravah_import_mapping_versions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references pravah_import_profiles(id) on delete cascade,
  version_no int not null check (version_no > 0),
  field_mapping jsonb not null default '{}',
  stage_mapping jsonb not null default '{}',
  active boolean not null default true,
  notes text,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  unique(profile_id, version_no)
);

create table if not exists pravah_import_batches (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references pravah_import_profiles(id) on delete restrict,
  mapping_version_id uuid not null references pravah_import_mapping_versions(id) on delete restrict,
  source_filename text,
  source_checksum text,
  status text not null default 'staged' check (status in ('staged','validated','replayed','needs_repair','failed')),
  row_count int not null default 0 check (row_count >= 0),
  valid_count int not null default 0 check (valid_count >= 0),
  repair_count int not null default 0 check (repair_count >= 0),
  imported_count int not null default 0 check (imported_count >= 0),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  validated_at timestamptz,
  replayed_at timestamptz,
  unique(profile_id, source_checksum)
);

create table if not exists pravah_import_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references pravah_import_batches(id) on delete restrict,
  profile_id uuid not null references pravah_import_profiles(id) on delete restrict,
  mapping_version_id uuid not null references pravah_import_mapping_versions(id) on delete restrict,
  row_number int not null check (row_number > 0),
  source_record_key text not null,
  raw_payload jsonb not null,
  normalized_payload jsonb,
  validation_errors jsonb not null default '[]',
  status text not null default 'staged' check (status in ('staged','valid','needs_repair','imported','duplicate','failed')),
  revenue_lead_id uuid references pravah_revenue_leads(id) on delete set null,
  revenue_activity_id uuid references pravah_revenue_activities(id) on delete set null,
  created_at timestamptz not null default now(),
  validated_at timestamptz,
  imported_at timestamptz,
  unique(profile_id, source_record_key),
  unique(batch_id, row_number)
);

create table if not exists pravah_import_replays (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references pravah_import_batches(id) on delete restrict,
  status text not null default 'running' check (status in ('running','completed','failed')),
  attempted_count int not null default 0,
  imported_count int not null default 0,
  duplicate_count int not null default 0,
  repair_count int not null default 0,
  failure_note text,
  initiated_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists pravah_import_profiles_client_idx on pravah_import_profiles(client_id,active);
create index if not exists pravah_import_batches_profile_idx on pravah_import_batches(profile_id,created_at desc);
create index if not exists pravah_import_rows_batch_status_idx on pravah_import_rows(batch_id,status,row_number);
create index if not exists pravah_import_rows_profile_key_idx on pravah_import_rows(profile_id,source_record_key);
create index if not exists pravah_import_replays_batch_idx on pravah_import_replays(batch_id,created_at desc);

do $$
declare t text;
begin
  foreach t in array array['pravah_import_profiles','pravah_import_mapping_versions','pravah_import_batches','pravah_import_rows','pravah_import_replays'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('revoke all on %I from anon, authenticated', t);
    execute format('grant select on %I to authenticated', t);
  end loop;
end $$;

drop policy if exists pravah_import_profiles_internal_read on pravah_import_profiles;
create policy pravah_import_profiles_internal_read on pravah_import_profiles for select to authenticated using (pravah_is_internal());
drop policy if exists pravah_import_mapping_versions_internal_read on pravah_import_mapping_versions;
create policy pravah_import_mapping_versions_internal_read on pravah_import_mapping_versions for select to authenticated using (pravah_is_internal());
drop policy if exists pravah_import_batches_internal_read on pravah_import_batches;
create policy pravah_import_batches_internal_read on pravah_import_batches for select to authenticated using (pravah_is_internal());
drop policy if exists pravah_import_rows_internal_read on pravah_import_rows;
create policy pravah_import_rows_internal_read on pravah_import_rows for select to authenticated using (pravah_is_internal());
drop policy if exists pravah_import_replays_internal_read on pravah_import_replays;
create policy pravah_import_replays_internal_read on pravah_import_replays for select to authenticated using (pravah_is_internal());

create or replace function pravah_import_create_profile(
  p_client_id uuid, p_source_system text, p_name text, p_parser_key text,
  p_config jsonb default '{}', p_field_mapping jsonb default '{}', p_stage_mapping jsonb default '{}', p_notes text default null
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_profile uuid; v_mapping uuid;
begin
  if not pravah_is_internal() or not pravah_can_access_client(p_client_id) then raise exception 'Pravah staff access required.'; end if;
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
  if not pravah_is_internal() or v_client is null or not pravah_can_access_client(v_client) then raise exception 'Active import profile access required.'; end if;
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
declare b pravah_import_batches%rowtype; r pravah_import_rows%rowtype; v_errors jsonb; v_normalized jsonb; v_stage text; v_status text; v_valid int:=0; v_repair int:=0;
begin
  select * into b from pravah_import_batches where id=p_batch_id for update;
  if b.id is null or not pravah_is_internal() or not pravah_can_access_client((select client_id from pravah_import_profiles where id=b.profile_id)) then raise exception 'Import batch access required.'; end if;
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
  if b.id is null or not pravah_is_internal() or not pravah_can_access_client(v_client) then raise exception 'Import batch access required.'; end if;
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

do $$
declare signature text;
begin
  foreach signature in array array[
    'pravah_import_create_profile(uuid,text,text,text,jsonb,jsonb,jsonb,text)',
    'pravah_import_stage_rows(uuid,uuid,text,text,jsonb)',
    'pravah_import_validate_batch(uuid)',
    'pravah_import_replay_batch(uuid)'
  ] loop
    execute format('revoke all on function %s from public',signature);
    execute format('grant execute on function %s to authenticated',signature);
  end loop;
end $$;

notify pgrst, 'reload schema';
