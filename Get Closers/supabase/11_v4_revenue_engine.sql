-- Pravah V4 — Client Revenue Engine / customer-centric CRM foundation.
-- Run after the V1–V3 Pravah migrations. Safe to re-run.
-- V4 establishes canonical client-owned revenue records. External Sheet/CRM
-- mapping belongs to V5; restricted client/closer portals belong to V6.

create extension if not exists pgcrypto;

-- ═══ CANONICAL PIPELINE TAXONOMY ══════════════════════════════════════════
create table if not exists pravah_revenue_stages (
  code        text primary key,
  label       text not null,
  sort_order  int not null,
  terminal    boolean not null default false,
  active      boolean not null default true
);

insert into pravah_revenue_stages(code,label,sort_order,terminal) values
  ('new','New',10,false),
  ('contacted','Contacted',20,false),
  ('qualified','Qualified',30,false),
  ('booked','Call / Meeting Booked',40,false),
  ('proposal','Proposal',50,false),
  ('negotiation','Negotiation',60,false),
  ('won','Won',70,true),
  ('lost','Lost',80,true),
  ('nurture','Nurture',90,false)
on conflict (code) do update set label=excluded.label,sort_order=excluded.sort_order,terminal=excluded.terminal,active=excluded.active;

create table if not exists pravah_revenue_leads (
  id                  uuid primary key default gen_random_uuid(),
  client_id           uuid not null references clients(id) on delete cascade,
  owner_placement_id  uuid references placements(id) on delete set null,
  external_key        text,
  full_name           text not null,
  email               text,
  phone               text,
  company_name        text,
  source              text,
  stage               text not null default 'new' references pravah_revenue_stages(code),
  status              text not null default 'active' check (status in ('active','won','lost','archived')),
  first_contact_at    timestamptz,
  last_activity_at    timestamptz,
  notes               text,
  metadata            jsonb not null default '{}',
  source_system       text not null default 'pravah',
  source_record_key   text,
  created_by          uuid not null default auth.uid(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (client_id, external_key),
  unique (client_id, source_system, source_record_key)
);

create table if not exists pravah_revenue_activities (
  id                  uuid primary key default gen_random_uuid(),
  client_id           uuid not null references clients(id) on delete cascade,
  lead_id             uuid not null references pravah_revenue_leads(id) on delete cascade,
  placement_id        uuid references placements(id) on delete set null,
  activity_type       text not null check (activity_type in ('call','whatsapp','email','meeting','follow_up','note')),
  occurred_at         timestamptz not null default now(),
  outcome             text,
  duration_seconds    int check (duration_seconds is null or duration_seconds >= 0),
  notes               text,
  source_system       text not null default 'pravah',
  source_record_key   text,
  metadata            jsonb not null default '{}',
  created_by          uuid not null default auth.uid(),
  created_at          timestamptz not null default now(),
  unique (client_id, source_system, source_record_key)
);

create table if not exists pravah_revenue_deals (
  id                  uuid primary key default gen_random_uuid(),
  client_id           uuid not null references clients(id) on delete cascade,
  lead_id             uuid not null references pravah_revenue_leads(id) on delete cascade,
  placement_id        uuid references placements(id) on delete set null,
  title               text not null,
  stage               text not null default 'qualified' references pravah_revenue_stages(code),
  value               numeric not null default 0 check (value >= 0),
  currency            text not null default 'INR',
  status              text not null default 'open' check (status in ('open','won','lost','cancelled')),
  opened_at           timestamptz not null default now(),
  expected_close_on   date,
  closed_at           timestamptz,
  notes               text,
  metadata            jsonb not null default '{}',
  source_system       text not null default 'pravah',
  source_record_key   text,
  created_by          uuid not null default auth.uid(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (client_id, source_system, source_record_key)
);

create table if not exists pravah_revenue_sales (
  id                  uuid primary key default gen_random_uuid(),
  client_id           uuid not null references clients(id) on delete cascade,
  deal_id             uuid references pravah_revenue_deals(id) on delete set null,
  lead_id             uuid references pravah_revenue_leads(id) on delete set null,
  placement_id        uuid references placements(id) on delete set null,
  sale_date           date not null default current_date,
  gross_amount        numeric not null check (gross_amount >= 0),
  discount_amount     numeric not null default 0 check (discount_amount >= 0),
  net_amount          numeric not null check (net_amount >= 0),
  currency            text not null default 'INR',
  status              text not null default 'booked' check (status in ('booked','refunded','cancelled')),
  notes               text,
  metadata            jsonb not null default '{}',
  source_system       text not null default 'pravah',
  source_record_key   text,
  created_by          uuid not null default auth.uid(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (net_amount <= gross_amount),
  unique (client_id, source_system, source_record_key)
);

create table if not exists pravah_revenue_payments (
  id                  uuid primary key default gen_random_uuid(),
  client_id           uuid not null references clients(id) on delete cascade,
  sale_id             uuid not null references pravah_revenue_sales(id) on delete cascade,
  payment_date        date not null default current_date,
  amount              numeric not null check (amount >= 0),
  currency            text not null default 'INR',
  status              text not null default 'pending' check (status in ('pending','verified','reversed')),
  evidence_url        text,
  evidence_note       text,
  verified_by         uuid,
  verified_at         timestamptz,
  source_system       text not null default 'pravah',
  source_record_key   text,
  metadata            jsonb not null default '{}',
  created_by          uuid not null default auth.uid(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (client_id, source_system, source_record_key)
);

create table if not exists pravah_revenue_adjustments (
  id                  uuid primary key default gen_random_uuid(),
  client_id           uuid not null references clients(id) on delete cascade,
  sale_id             uuid not null references pravah_revenue_sales(id) on delete cascade,
  adjustment_type     text not null check (adjustment_type in ('refund','cancellation','writeoff')),
  amount              numeric not null check (amount >= 0),
  adjustment_date     date not null default current_date,
  reason              text not null,
  status              text not null default 'approved' check (status in ('pending','approved','voided')),
  source_system       text not null default 'pravah',
  source_record_key   text,
  created_by          uuid not null default auth.uid(),
  created_at          timestamptz not null default now(),
  unique (client_id, source_system, source_record_key)
);

create index if not exists pravah_revenue_leads_client_stage_idx on pravah_revenue_leads(client_id,stage,status);
create index if not exists pravah_revenue_leads_owner_idx on pravah_revenue_leads(owner_placement_id,status);
create index if not exists pravah_revenue_activities_lead_idx on pravah_revenue_activities(lead_id,occurred_at desc);
create index if not exists pravah_revenue_deals_client_stage_idx on pravah_revenue_deals(client_id,stage,status);
create index if not exists pravah_revenue_deals_owner_idx on pravah_revenue_deals(placement_id,status);
create index if not exists pravah_revenue_sales_client_date_idx on pravah_revenue_sales(client_id,sale_date desc);
create index if not exists pravah_revenue_sales_owner_idx on pravah_revenue_sales(placement_id,sale_date desc);
create index if not exists pravah_revenue_payments_client_date_idx on pravah_revenue_payments(client_id,payment_date desc,status);
create index if not exists pravah_revenue_adjustments_sale_idx on pravah_revenue_adjustments(sale_id,adjustment_date desc,status);

-- ═══ SECURITY ═════════════════════════════════════════════════════════════
-- V4 is staff-operated. V6 will add restricted client/closer read policies.
do $$
declare t text;
begin
  foreach t in array array[
    'pravah_revenue_stages','pravah_revenue_leads','pravah_revenue_activities',
    'pravah_revenue_deals','pravah_revenue_sales','pravah_revenue_payments',
    'pravah_revenue_adjustments'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('revoke all on %I from anon, authenticated', t);
  end loop;
end $$;

drop policy if exists pravah_revenue_stages_internal_read on pravah_revenue_stages;
create policy pravah_revenue_stages_internal_read on pravah_revenue_stages for select to authenticated using (pravah_is_internal());
grant select on pravah_revenue_stages to authenticated;

drop policy if exists pravah_revenue_leads_internal_read on pravah_revenue_leads;
create policy pravah_revenue_leads_internal_read on pravah_revenue_leads for select to authenticated using (pravah_is_internal());
grant select on pravah_revenue_leads to authenticated;

drop policy if exists pravah_revenue_activities_internal_read on pravah_revenue_activities;
create policy pravah_revenue_activities_internal_read on pravah_revenue_activities for select to authenticated using (pravah_is_internal());
grant select on pravah_revenue_activities to authenticated;

drop policy if exists pravah_revenue_deals_internal_read on pravah_revenue_deals;
create policy pravah_revenue_deals_internal_read on pravah_revenue_deals for select to authenticated using (pravah_is_internal());
grant select on pravah_revenue_deals to authenticated;

drop policy if exists pravah_revenue_sales_internal_read on pravah_revenue_sales;
create policy pravah_revenue_sales_internal_read on pravah_revenue_sales for select to authenticated using (pravah_is_internal());
grant select on pravah_revenue_sales to authenticated;

drop policy if exists pravah_revenue_payments_internal_read on pravah_revenue_payments;
create policy pravah_revenue_payments_internal_read on pravah_revenue_payments for select to authenticated using (pravah_is_internal());
grant select on pravah_revenue_payments to authenticated;

drop policy if exists pravah_revenue_adjustments_internal_read on pravah_revenue_adjustments;
create policy pravah_revenue_adjustments_internal_read on pravah_revenue_adjustments for select to authenticated using (pravah_is_internal());
grant select on pravah_revenue_adjustments to authenticated;

-- ═══ WRITE CONTRACTS ══════════════════════════════════════════════════════
create or replace function pravah_revenue_create_lead(
  p_client_id uuid, p_full_name text, p_email text default null, p_phone text default null,
  p_company_name text default null, p_source text default null, p_owner_placement_id uuid default null,
  p_stage text default 'new', p_notes text default null, p_source_system text default 'pravah',
  p_source_record_key text default null, p_metadata jsonb default '{}'
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
  if not pravah_is_internal() then raise exception 'Pravah staff access required.'; end if;
  if not exists(select 1 from clients where id=p_client_id) then raise exception 'Client does not exist.'; end if;
  if p_owner_placement_id is not null and not exists(
    select 1 from placements p join requirements r on r.id=p.requirement_id where p.id=p_owner_placement_id and r.client_id=p_client_id
  ) then raise exception 'Closer placement does not belong to this client.'; end if;
  if not exists(select 1 from pravah_revenue_stages where code=p_stage and active) then raise exception 'Invalid revenue stage.'; end if;
  select id into v_id from pravah_revenue_leads where client_id=p_client_id and p_source_record_key is not null and source_system=p_source_system and source_record_key=p_source_record_key limit 1;
  if v_id is not null then return v_id; end if;
  insert into pravah_revenue_leads(client_id,owner_placement_id,full_name,email,phone,company_name,source,stage,notes,source_system,source_record_key,metadata)
  values(p_client_id,p_owner_placement_id,trim(p_full_name),nullif(trim(p_email),''),nullif(trim(p_phone),''),nullif(trim(p_company_name),''),nullif(trim(p_source),''),p_stage,p_notes,p_source_system,p_source_record_key,coalesce(p_metadata,'{}'))
  returning id into v_id;
  insert into pravah_audit_events(client_id,entity_type,entity_id,action,actor_uid,payload) values(p_client_id,'revenue_lead',v_id::text,'create',auth.uid(),jsonb_build_object('source_system',p_source_system,'source_record_key',p_source_record_key));
  return v_id;
end $$;
revoke all on function pravah_revenue_create_lead(uuid,text,text,text,text,text,uuid,text,text,text,text,jsonb) from public;
grant execute on function pravah_revenue_create_lead(uuid,text,text,text,text,text,uuid,text,text,text,text,jsonb) to authenticated;

create or replace function pravah_revenue_log_activity(
  p_client_id uuid, p_lead_id uuid, p_activity_type text, p_occurred_at timestamptz default now(),
  p_placement_id uuid default null, p_outcome text default null, p_duration_seconds int default null,
  p_notes text default null, p_source_system text default 'pravah', p_source_record_key text default null, p_metadata jsonb default '{}'
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
  if not pravah_is_internal() then raise exception 'Pravah staff access required.'; end if;
  if not exists(select 1 from pravah_revenue_leads where id=p_lead_id and client_id=p_client_id) then raise exception 'Lead/client mismatch.'; end if;
  if p_placement_id is not null and not exists(select 1 from placements p join requirements r on r.id=p.requirement_id where p.id=p_placement_id and r.client_id=p_client_id) then raise exception 'Closer/client mismatch.'; end if;
  select id into v_id from pravah_revenue_activities where client_id=p_client_id and p_source_record_key is not null and source_system=p_source_system and source_record_key=p_source_record_key limit 1;
  if v_id is not null then return v_id; end if;
  insert into pravah_revenue_activities(client_id,lead_id,placement_id,activity_type,occurred_at,outcome,duration_seconds,notes,source_system,source_record_key,metadata)
  values(p_client_id,p_lead_id,p_placement_id,p_activity_type,p_occurred_at,p_outcome,p_duration_seconds,p_notes,p_source_system,p_source_record_key,coalesce(p_metadata,'{}'))
  returning id into v_id;
  update pravah_revenue_leads set last_activity_at=p_occurred_at, first_contact_at=coalesce(first_contact_at,p_occurred_at), updated_at=now() where id=p_lead_id;
  insert into pravah_audit_events(client_id,entity_type,entity_id,action,actor_uid,payload) values(p_client_id,'revenue_activity',v_id::text,'create',auth.uid(),jsonb_build_object('lead_id',p_lead_id,'activity_type',p_activity_type));
  return v_id;
end $$;
revoke all on function pravah_revenue_log_activity(uuid,uuid,text,timestamptz,uuid,text,int,text,text,text,jsonb) from public;
grant execute on function pravah_revenue_log_activity(uuid,uuid,text,timestamptz,uuid,text,int,text,text,text,jsonb) to authenticated;

create or replace function pravah_revenue_create_deal(
  p_client_id uuid, p_lead_id uuid, p_title text, p_value numeric default 0, p_currency text default 'INR',
  p_placement_id uuid default null, p_stage text default 'qualified', p_expected_close_on date default null,
  p_notes text default null, p_source_system text default 'pravah', p_source_record_key text default null, p_metadata jsonb default '{}'
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
  if not pravah_is_internal() then raise exception 'Pravah staff access required.'; end if;
  if not exists(select 1 from pravah_revenue_leads where id=p_lead_id and client_id=p_client_id) then raise exception 'Lead/client mismatch.'; end if;
  if p_placement_id is not null and not exists(select 1 from placements p join requirements r on r.id=p.requirement_id where p.id=p_placement_id and r.client_id=p_client_id) then raise exception 'Closer/client mismatch.'; end if;
  if not exists(select 1 from pravah_revenue_stages where code=p_stage and active) then raise exception 'Invalid revenue stage.'; end if;
  select id into v_id from pravah_revenue_deals where client_id=p_client_id and p_source_record_key is not null and source_system=p_source_system and source_record_key=p_source_record_key limit 1;
  if v_id is not null then return v_id; end if;
  insert into pravah_revenue_deals(client_id,lead_id,placement_id,title,value,currency,stage,expected_close_on,notes,source_system,source_record_key,metadata)
  values(p_client_id,p_lead_id,p_placement_id,trim(p_title),p_value,p_currency,p_stage,p_expected_close_on,p_notes,p_source_system,p_source_record_key,coalesce(p_metadata,'{}'))
  returning id into v_id;
  insert into pravah_audit_events(client_id,entity_type,entity_id,action,actor_uid,payload) values(p_client_id,'revenue_deal',v_id::text,'create',auth.uid(),jsonb_build_object('lead_id',p_lead_id,'value',p_value));
  return v_id;
end $$;
revoke all on function pravah_revenue_create_deal(uuid,uuid,text,numeric,text,uuid,text,date,text,text,text,jsonb) from public;
grant execute on function pravah_revenue_create_deal(uuid,uuid,text,numeric,text,uuid,text,date,text,text,text,jsonb) to authenticated;

create or replace function pravah_revenue_record_sale(
  p_client_id uuid, p_deal_id uuid default null, p_lead_id uuid default null, p_placement_id uuid default null,
  p_sale_date date default current_date, p_gross_amount numeric default 0, p_discount_amount numeric default 0,
  p_net_amount numeric default 0, p_currency text default 'INR', p_status text default 'booked',
  p_notes text default null, p_source_system text default 'pravah', p_source_record_key text default null, p_metadata jsonb default '{}'
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
  if not pravah_is_internal() then raise exception 'Pravah staff access required.'; end if;
  if p_deal_id is not null and not exists(select 1 from pravah_revenue_deals where id=p_deal_id and client_id=p_client_id) then raise exception 'Deal/client mismatch.'; end if;
  if p_lead_id is not null and not exists(select 1 from pravah_revenue_leads where id=p_lead_id and client_id=p_client_id) then raise exception 'Lead/client mismatch.'; end if;
  if p_placement_id is not null and not exists(select 1 from placements p join requirements r on r.id=p.requirement_id where p.id=p_placement_id and r.client_id=p_client_id) then raise exception 'Closer/client mismatch.'; end if;
  if p_net_amount > p_gross_amount then raise exception 'Net amount cannot exceed gross amount.'; end if;
  select id into v_id from pravah_revenue_sales where client_id=p_client_id and p_source_record_key is not null and source_system=p_source_system and source_record_key=p_source_record_key limit 1;
  if v_id is not null then return v_id; end if;
  insert into pravah_revenue_sales(client_id,deal_id,lead_id,placement_id,sale_date,gross_amount,discount_amount,net_amount,currency,status,notes,source_system,source_record_key,metadata)
  values(p_client_id,p_deal_id,p_lead_id,p_placement_id,p_sale_date,p_gross_amount,p_discount_amount,p_net_amount,p_currency,p_status,p_notes,p_source_system,p_source_record_key,coalesce(p_metadata,'{}'))
  returning id into v_id;
  if p_deal_id is not null then update pravah_revenue_deals set status=case when p_status='booked' then 'won' when p_status='cancelled' then 'cancelled' else status end, stage=case when p_status='booked' then 'won' else stage end, closed_at=case when p_status in ('booked','cancelled') then coalesce(closed_at,now()) else closed_at end, updated_at=now() where id=p_deal_id; end if;
  if p_lead_id is not null and p_status='booked' then update pravah_revenue_leads set status='won',stage='won',updated_at=now() where id=p_lead_id; end if;
  insert into pravah_audit_events(client_id,entity_type,entity_id,action,actor_uid,payload) values(p_client_id,'revenue_sale',v_id::text,'create',auth.uid(),jsonb_build_object('net_amount',p_net_amount,'currency',p_currency));
  return v_id;
end $$;
revoke all on function pravah_revenue_record_sale(uuid,uuid,uuid,uuid,date,numeric,numeric,numeric,text,text,text,text,text,jsonb) from public;
grant execute on function pravah_revenue_record_sale(uuid,uuid,uuid,uuid,date,numeric,numeric,numeric,text,text,text,text,text,jsonb) to authenticated;

create or replace function pravah_revenue_record_payment(
  p_client_id uuid, p_sale_id uuid, p_payment_date date default current_date, p_amount numeric default 0,
  p_currency text default 'INR', p_status text default 'pending', p_evidence_url text default null,
  p_evidence_note text default null, p_source_system text default 'pravah', p_source_record_key text default null, p_metadata jsonb default '{}'
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
  if not pravah_is_internal() then raise exception 'Pravah staff access required.'; end if;
  if not exists(select 1 from pravah_revenue_sales where id=p_sale_id and client_id=p_client_id) then raise exception 'Sale/client mismatch.'; end if;
  select id into v_id from pravah_revenue_payments where client_id=p_client_id and p_source_record_key is not null and source_system=p_source_system and source_record_key=p_source_record_key limit 1;
  if v_id is not null then return v_id; end if;
  insert into pravah_revenue_payments(client_id,sale_id,payment_date,amount,currency,status,evidence_url,evidence_note,source_system,source_record_key,metadata)
  values(p_client_id,p_sale_id,p_payment_date,p_amount,p_currency,p_status,p_evidence_url,p_evidence_note,p_source_system,p_source_record_key,coalesce(p_metadata,'{}'))
  returning id into v_id;
  insert into pravah_audit_events(client_id,entity_type,entity_id,action,actor_uid,payload) values(p_client_id,'revenue_payment',v_id::text,'create',auth.uid(),jsonb_build_object('sale_id',p_sale_id,'amount',p_amount,'status',p_status));
  return v_id;
end $$;
revoke all on function pravah_revenue_record_payment(uuid,uuid,date,numeric,text,text,text,text,text,text,jsonb) from public;
grant execute on function pravah_revenue_record_payment(uuid,uuid,date,numeric,text,text,text,text,text,text,jsonb) to authenticated;

create or replace function pravah_revenue_verify_payment(p_payment_id uuid, p_evidence_url text default null, p_evidence_note text default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_client uuid; v_role text;
begin
  v_role := pravah_my_role();
  if v_role not in ('gc_admin','client_success') then raise exception 'Only admin or client success staff may verify payments.'; end if;
  select client_id into v_client from pravah_revenue_payments where id=p_payment_id;
  if v_client is null then raise exception 'Payment not found.'; end if;
  update pravah_revenue_payments set status='verified',evidence_url=coalesce(p_evidence_url,evidence_url),evidence_note=coalesce(p_evidence_note,evidence_note),verified_by=auth.uid(),verified_at=now(),updated_at=now() where id=p_payment_id;
  insert into pravah_audit_events(client_id,entity_type,entity_id,action,actor_uid,payload) values(v_client,'revenue_payment',p_payment_id::text,'verify',auth.uid(),jsonb_build_object('evidence_url',p_evidence_url));
  return p_payment_id;
end $$;
revoke all on function pravah_revenue_verify_payment(uuid,text,text) from public;
grant execute on function pravah_revenue_verify_payment(uuid,text,text) to authenticated;

create or replace function pravah_revenue_record_adjustment(
  p_client_id uuid, p_sale_id uuid, p_adjustment_type text, p_amount numeric,
  p_adjustment_date date default current_date, p_reason text default null, p_status text default 'approved',
  p_source_system text default 'pravah', p_source_record_key text default null
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
  if not pravah_is_internal() then raise exception 'Pravah staff access required.'; end if;
  if not exists(select 1 from pravah_revenue_sales where id=p_sale_id and client_id=p_client_id) then raise exception 'Sale/client mismatch.'; end if;
  select id into v_id from pravah_revenue_adjustments where client_id=p_client_id and p_source_record_key is not null and source_system=p_source_system and source_record_key=p_source_record_key limit 1;
  if v_id is not null then return v_id; end if;
  insert into pravah_revenue_adjustments(client_id,sale_id,adjustment_type,amount,adjustment_date,reason,status,source_system,source_record_key)
  values(p_client_id,p_sale_id,p_adjustment_type,p_amount,p_adjustment_date,coalesce(nullif(trim(p_reason),''),'No reason supplied'),p_status,p_source_system,p_source_record_key)
  returning id into v_id;
  insert into pravah_audit_events(client_id,entity_type,entity_id,action,actor_uid,payload) values(p_client_id,'revenue_adjustment',v_id::text,'create',auth.uid(),jsonb_build_object('sale_id',p_sale_id,'type',p_adjustment_type,'amount',p_amount));
  return v_id;
end $$;
revoke all on function pravah_revenue_record_adjustment(uuid,uuid,text,numeric,date,text,text,text,text) from public;
grant execute on function pravah_revenue_record_adjustment(uuid,uuid,text,numeric,date,text,text,text,text) to authenticated;

-- ═══ DASHBOARD CONTRACT ═══════════════════════════════════════════════════
create or replace function pravah_revenue_dashboard(
  p_period_start date default date_trunc('month',current_date)::date,
  p_period_end date default current_date,
  p_client_id uuid default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_result jsonb;
begin
  if not pravah_is_internal() then raise exception 'Pravah staff access required.'; end if;
  if p_period_end < p_period_start then raise exception 'Period end must be on or after period start.'; end if;
  with
  sales as (
    select s.* from pravah_revenue_sales s
    where (p_client_id is null or s.client_id=p_client_id) and s.sale_date between p_period_start and p_period_end and s.status <> 'cancelled'
  ),
  payments as (
    select p.* from pravah_revenue_payments p
    where (p_client_id is null or p.client_id=p_client_id) and p.payment_date between p_period_start and p_period_end and p.status='verified'
  ),
  pipeline as (
    select coalesce(sum(d.value),0) value from pravah_revenue_deals d
    where (p_client_id is null or d.client_id=p_client_id) and d.status='open' and d.opened_at::date<=p_period_end
  ),
  outstanding as (
    select coalesce(sum(greatest(0,s.net_amount - coalesce((select sum(p.amount) from pravah_revenue_payments p where p.sale_id=s.id and p.status='verified'),0) - coalesce((select sum(a.amount) from pravah_revenue_adjustments a where a.sale_id=s.id and a.status='approved'),0))),0) value
    from pravah_revenue_sales s
    where (p_client_id is null or s.client_id=p_client_id) and s.sale_date<=p_period_end and s.status<>'cancelled'
  ),
  funnel as (
    select st.code,st.label,st.sort_order,count(l.id)::numeric count
    from pravah_revenue_stages st left join pravah_revenue_leads l on l.stage=st.code and (p_client_id is null or l.client_id=p_client_id) and l.status<>'archived'
    group by st.code,st.label,st.sort_order
    order by st.sort_order
  ),
  client_rows as (
    select c.id client_id,c.business_name,
      coalesce((select count(*) from pravah_revenue_leads l where l.client_id=c.id and l.status<>'archived'),0) leads,
      coalesce((select sum(s.net_amount) from pravah_revenue_sales s where s.client_id=c.id and s.sale_date between p_period_start and p_period_end and s.status<>'cancelled'),0) revenue,
      coalesce((select sum(p.amount) from pravah_revenue_payments p where p.client_id=c.id and p.payment_date between p_period_start and p_period_end and p.status='verified'),0) cash,
      coalesce((select count(*) from pravah_revenue_sales s where s.client_id=c.id and s.sale_date between p_period_start and p_period_end and s.status<>'cancelled'),0) sales,
      coalesce((select sum(d.value) from pravah_revenue_deals d where d.client_id=c.id and d.status='open'),0) pipeline
    from clients c
    where p_client_id is null or c.id=p_client_id
    order by revenue desc, c.business_name
  ),
  closer_rows as (
    select p.id placement_id,coalesce(vp.closer_name,'Unassigned') closer_name,coalesce(vp.business_name,c.business_name) business_name,
      coalesce((select count(*) from pravah_revenue_leads l where l.owner_placement_id=p.id and l.status<>'archived'),0) leads,
      coalesce((select sum(s.net_amount) from pravah_revenue_sales s where s.placement_id=p.id and s.sale_date between p_period_start and p_period_end and s.status<>'cancelled'),0) revenue,
      coalesce((select sum(pm.amount) from pravah_revenue_payments pm join pravah_revenue_sales s on s.id=pm.sale_id where s.placement_id=p.id and pm.payment_date between p_period_start and p_period_end and pm.status='verified'),0) cash,
      coalesce((select count(*) from pravah_revenue_sales s where s.placement_id=p.id and s.sale_date between p_period_start and p_period_end and s.status<>'cancelled'),0) sales
    from placements p
    join requirements r on r.id=p.requirement_id
    join clients c on c.id=r.client_id
    left join pravah_v_placements vp on vp.placement_id=p.id
    where p_client_id is null or r.client_id=p_client_id
    order by revenue desc, closer_name
  )
  select jsonb_build_object(
    'period_start',p_period_start,'period_end',p_period_end,
    'headline',jsonb_build_object(
      'active_leads',(select count(*) from pravah_revenue_leads l where (p_client_id is null or l.client_id=p_client_id) and l.status='active'),
      'pipeline_value',(select value from pipeline),
      'sales_count',(select count(*) from sales),
      'booked_revenue',coalesce((select sum(net_amount) from sales),0),
      'verified_cash',coalesce((select sum(amount) from payments),0),
      'outstanding',(select value from outstanding),
      'conversion_rate',case when (select count(*) from pravah_revenue_deals d where (p_client_id is null or d.client_id=p_client_id) and d.closed_at::date between p_period_start and p_period_end and d.status in ('won','lost'))=0 then null else round((select count(*)::numeric from pravah_revenue_deals d where (p_client_id is null or d.client_id=p_client_id) and d.closed_at::date between p_period_start and p_period_end and d.status='won')/(select count(*)::numeric from pravah_revenue_deals d where (p_client_id is null or d.client_id=p_client_id) and d.closed_at::date between p_period_start and p_period_end and d.status in ('won','lost'))*100,1) end
    ),
    'funnel',coalesce((select jsonb_agg(to_jsonb(funnel)) from funnel),'[]'::jsonb),
    'clients',coalesce((select jsonb_agg(to_jsonb(client_rows)) from client_rows),'[]'::jsonb),
    'closers',coalesce((select jsonb_agg(to_jsonb(closer_rows)) from closer_rows),'[]'::jsonb)
  ) into v_result;
  return v_result;
end $$;
revoke all on function pravah_revenue_dashboard(date,date,uuid) from public;
grant execute on function pravah_revenue_dashboard(date,date,uuid) to authenticated;

-- Simple contract query for operators and CI.
comment on table pravah_revenue_leads is 'Canonical customer/lead record. External mapping belongs to V5.';
comment on table pravah_revenue_activities is 'Canonical customer activity/call log. External ingestion may write source keys through the V4 RPC.';
comment on table pravah_revenue_deals is 'Canonical pipeline opportunity.';
comment on table pravah_revenue_sales is 'Canonical booked sale. Revenue is not cash until payment evidence is verified.';
comment on table pravah_revenue_payments is 'Canonical payment evidence. Only verified payments count as official cash.';
comment on table pravah_revenue_adjustments is 'Refund, cancellation and write-off adjustments against a sale.';
