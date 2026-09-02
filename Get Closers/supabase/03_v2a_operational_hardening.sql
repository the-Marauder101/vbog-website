-- Pravah V2A — operational hardening and Vyom client foundation
-- Run after 01_pravah_core.sql. Safe to re-run.

-- ═══ CLIENT IDENTITY INBOX ═══════════════════════════════════════════════

create table if not exists pravah_client_sync_inbox (
  id                    uuid primary key default gen_random_uuid(),
  source_system         text not null default 'vyom' check (source_system in ('vyom')),
  source_client_id      uuid not null,
  source_name           text not null,
  source_name_normalized text not null,
  source_active         boolean not null default true,
  source_payload        jsonb not null default '{}',
  status                text not null default 'new'
                        check (status in ('new','linked','conflict','ignored')),
  linked_client_id      uuid references clients(id) on delete set null,
  last_seen_at          timestamptz not null default now(),
  linked_at             timestamptz,
  linked_by             uuid,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (source_system, source_client_id)
);

create unique index if not exists pravah_one_vyom_link_per_client
  on pravah_client_sync_inbox(linked_client_id)
  where source_system = 'vyom' and linked_client_id is not null and status = 'linked';

alter table pravah_client_sync_inbox enable row level security;
alter table pravah_client_sync_inbox force row level security;
revoke all on pravah_client_sync_inbox from anon, authenticated;
grant select on pravah_client_sync_inbox to authenticated;

drop policy if exists pravah_sync_internal_read on pravah_client_sync_inbox;
create policy pravah_sync_internal_read on pravah_client_sync_inbox for select to authenticated
  using (pravah_is_internal());

-- Free-text client creation is retired. Existing records remain intact.
revoke execute on function pravah_create_client(text) from authenticated;

-- ═══ OPERATIONAL EVIDENCE ════════════════════════════════════════════════

alter table pravah_client_profiles
  add column if not exists client_visible_notes text,
  add column if not exists archived_at timestamptz,
  add column if not exists archive_reason text;

alter table pravah_performance_reports
  add column if not exists followups_completed int check (followups_completed >= 0),
  add column if not exists meetings_booked int check (meetings_booked >= 0),
  add column if not exists verified_cash_collected numeric check (verified_cash_collected >= 0),
  add column if not exists cash_verification_status text not null default 'unverified'
    check (cash_verification_status in ('unverified','pending','verified','rejected')),
  add column if not exists verification_source text,
  add column if not exists verification_reference text,
  add column if not exists verification_url text,
  add column if not exists verified_at timestamptz,
  add column if not exists verified_by uuid,
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid,
  add column if not exists void_reason text;

alter table pravah_client_checkins
  add column if not exists client_visible_summary text,
  add column if not exists internal_notes text;

alter table pravah_actions
  add column if not exists checkin_id uuid references pravah_client_checkins(id) on delete set null,
  add column if not exists completion_note text,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancellation_reason text;

create table if not exists pravah_placement_states (
  placement_id uuid primary key references placements(id) on delete cascade,
  client_id    uuid not null references clients(id) on delete cascade,
  state        text not null default 'active' check (state in ('active','ended','void')),
  ended_on     date,
  reason       text,
  changed_by   uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

insert into pravah_placement_states(placement_id, client_id)
select p.id, r.client_id from placements p join requirements r on r.id = p.requirement_id
on conflict (placement_id) do nothing;

alter table pravah_placement_states enable row level security;
alter table pravah_placement_states force row level security;
revoke all on pravah_placement_states from anon, authenticated;
grant select on pravah_placement_states to authenticated;

drop policy if exists pravah_placement_state_internal_write on pravah_placement_states;
create policy pravah_placement_state_internal_write on pravah_placement_states for all to authenticated
  using (pravah_is_internal()) with check (pravah_is_internal());
drop policy if exists pravah_placement_state_client_read on pravah_placement_states;
create policy pravah_placement_state_client_read on pravah_placement_states for select to authenticated
  using (pravah_can_access_client(client_id));

create or replace function pravah_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from pravah_memberships
    where auth_uid = auth.uid() and client_id is null and role = 'gc_admin' and active
  );
$$;
revoke all on function pravah_is_admin() from public;
grant execute on function pravah_is_admin() to authenticated;

-- ═══ ROLE-AWARE CONTEXT AND READ MODELS ══════════════════════════════════

-- Client memberships are reserved but deliberately dormant until the
-- client-safe read contract and portal ship. An authenticated account must
-- never gain raw operational access merely because a future role exists.
create or replace function pravah_can_access_client(p_client_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select pravah_is_internal();
$$;

create or replace function pravah_context() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_membership pravah_memberships%rowtype;
begin
  select * into v_membership from pravah_memberships
  where auth_uid = auth.uid() and active and client_id is null
  order by case role when 'gc_admin' then 0 else 1 end
  limit 1;
  if v_membership.id is null then
    return jsonb_build_object('authorized', false, 'portal_status', 'not_activated');
  end if;
  return jsonb_build_object(
    'authorized', true,
    'role', v_membership.role,
    'display_name', coalesce(v_membership.display_name, v_membership.role),
    'client_id', null,
    'is_internal', true,
    'is_admin', v_membership.role = 'gc_admin'
  );
end $$;

create or replace view pravah_v_clients with (security_invoker = true) as
select c.id, c.business_name,
       coalesce(cp.status, 'onboarding') as status,
       coalesce(cp.health, 'unknown') as health,
       cp.reporting_currency, cp.checkin_cadence,
       (select max(ci.occurred_at) from pravah_client_checkins ci where ci.client_id = c.id) as last_checkin_at,
       (select count(*) from pravah_training t where t.client_id = c.id and t.status in ('active','passed')) as active_closers,
       (select count(*) from pravah_actions a where a.client_id = c.id and a.status not in ('done','cancelled')) as open_actions,
       cp.notes, cp.client_visible_notes, cp.archived_at, cp.archive_reason,
       sync.source_client_id as vyom_client_id,
       case when sync.id is null then 'unlinked' else 'linked' end as vyom_link_status
from clients c
left join pravah_client_profiles cp on cp.client_id = c.id
left join pravah_client_sync_inbox sync on sync.linked_client_id = c.id and sync.status = 'linked'
where pravah_can_access_client(c.id)
  and (
    sync.id is not null
    or exists (select 1 from requirements r join placements p on p.requirement_id = r.id where r.client_id = c.id)
    or exists (select 1 from pravah_client_checkins ci where ci.client_id = c.id)
    or exists (select 1 from pravah_actions a where a.client_id = c.id)
  );

create or replace view pravah_v_placements with (security_invoker = true) as
select p.id as placement_id, p.candidate_id, cand.full_name as closer_name,
       p.requirement_id, r.title as role_title, r.client_id, c.business_name,
       p.joined_on, t.id as training_id, coalesce(t.status, 'not_started') as training_status,
       t.expected_completion_on, t.product_ready, t.roleplay_rating, t.risk_level,
       (select tc.checkpoint_on from pravah_training_checkpoints tc where tc.training_id = t.id order by tc.created_at desc limit 1) as last_checkpoint_on,
       (select tc.outcome from pravah_training_checkpoints tc where tc.training_id = t.id order by tc.created_at desc limit 1) as last_checkpoint_outcome,
       coalesce((select sum(pr.sales_count) from pravah_performance_reports pr where pr.placement_id = p.id and pr.voided_at is null), 0) as total_sales,
       coalesce((select sum(pr.verified_cash_collected) from pravah_performance_reports pr where pr.placement_id = p.id and pr.voided_at is null and pr.cash_verification_status = 'verified'), 0) as total_cash,
       coalesce(ps.state, 'active') as placement_state, ps.reason as placement_state_reason,
       coalesce((select sum(pr.cash_collected) from pravah_performance_reports pr where pr.placement_id = p.id and pr.voided_at is null), 0) as reported_cash,
       coalesce((select sum(pr.verified_cash_collected) from pravah_performance_reports pr where pr.placement_id = p.id and pr.voided_at is null and pr.cash_verification_status = 'verified'), 0) as verified_cash
from placements p
join candidates cand on cand.id = p.candidate_id
join requirements r on r.id = p.requirement_id
join clients c on c.id = r.client_id
left join pravah_training t on t.placement_id = p.id
left join pravah_placement_states ps on ps.placement_id = p.id
where pravah_can_access_client(r.client_id);

create or replace view pravah_v_reports with (security_invoker = true) as
select pr.id, pr.placement_id, pr.client_id, pr.period_start, pr.period_end,
       pr.calls_attempted, pr.connected_calls, pr.qualified_opportunities,
       pr.sales_count, pr.revenue_generated, pr.cash_collected,
       pr.pipeline_value, pr.currency, pr.blocker, pr.support_required,
       pr.next_period_plan, pr.source_type, pr.source_text, pr.shared_at,
       pr.created_by, pr.created_at, pr.updated_at,
       cand.full_name as closer_name, c.business_name,
       case when tg.target_value > 0 then
         round((case tg.target_unit
           when 'sales' then coalesce(pr.sales_count, 0)
           when 'cash' then coalesce(pr.verified_cash_collected, 0)
           else coalesce(pr.revenue_generated, 0) end / tg.target_value) * 100, 1)
       end as target_attainment_pct,
       pr.followups_completed, pr.meetings_booked, pr.verified_cash_collected,
       pr.cash_verification_status, pr.verification_source,
       pr.verification_reference, pr.verification_url, pr.verified_at,
       pr.verified_by, pr.voided_at, pr.voided_by, pr.void_reason
from pravah_performance_reports pr
join placements p on p.id = pr.placement_id
join candidates cand on cand.id = p.candidate_id
join clients c on c.id = pr.client_id
left join lateral (
  select t.* from pravah_targets t
  where t.placement_id = pr.placement_id
    and pr.period_start >= t.period_start and pr.period_end <= t.period_end
  order by t.period_start desc limit 1
) tg on true
where pravah_can_access_client(pr.client_id);

create or replace view pravah_v_attention with (security_invoker = true) as
select 'action'::text as item_type, a.id::text as item_id, a.client_id,
       c.business_name as context, a.title,
       case when a.due_on < current_date then 'overdue' else a.priority end as severity,
       a.due_on, a.created_at
from pravah_actions a join clients c on c.id = a.client_id
where a.status not in ('done','cancelled') and pravah_can_access_client(a.client_id)
union all
select 'training'::text, t.id::text, t.client_id, c.business_name,
       cand.full_name || ' · training ' || replace(t.status, '_', ' '),
       case when t.risk_level = 'high' then 'critical' else t.risk_level end,
       t.expected_completion_on, t.created_at
from pravah_training t
join placements p on p.id = t.placement_id
join candidates cand on cand.id = p.candidate_id
join clients c on c.id = t.client_id
left join pravah_placement_states ps on ps.placement_id = p.id
where t.status in ('active','extended') and t.risk_level <> 'none'
  and coalesce(ps.state, 'active') = 'active'
  and pravah_can_access_client(t.client_id);

create or replace view pravah_v_checkins with (security_invoker = true) as
select ci.*, c.business_name,
       coalesce(pm.display_name, 'Get Closers staff') as created_by_name
from pravah_client_checkins ci
join clients c on c.id = ci.client_id
left join pravah_memberships pm on pm.auth_uid = ci.created_by and pm.client_id is null
where pravah_can_access_client(ci.client_id);

create or replace view pravah_v_actions with (security_invoker = true) as
select a.*, c.business_name,
       coalesce(owner_pm.display_name, 'Unassigned') as owner_name,
       coalesce(creator_pm.display_name, 'Get Closers staff') as created_by_name
from pravah_actions a
join clients c on c.id = a.client_id
left join pravah_memberships owner_pm on owner_pm.auth_uid = a.owner_uid and owner_pm.client_id is null
left join pravah_memberships creator_pm on creator_pm.auth_uid = a.created_by and creator_pm.client_id is null
where pravah_can_access_client(a.client_id);

create or replace view pravah_v_client_sync_inbox with (security_invoker = true) as
select s.*,
       exact_match.id as suggested_client_id,
       exact_match.business_name as suggested_client_name
from pravah_client_sync_inbox s
left join lateral (
  select c.id, c.business_name from clients c
  where regexp_replace(lower(c.business_name), '[^a-z0-9]+', '', 'g') = s.source_name_normalized
  order by c.created_at asc limit 1
) exact_match on true
where pravah_is_internal();

grant select on pravah_v_clients, pravah_v_placements, pravah_v_reports,
  pravah_v_checkins, pravah_v_actions, pravah_v_client_sync_inbox to authenticated;

-- ═══ WRITE API ════════════════════════════════════════════════════════════

create or replace function pravah_link_vyom_client(
  p_source_client_id uuid, p_existing_client_id uuid default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_source pravah_client_sync_inbox%rowtype; v_client uuid; v_clash uuid;
begin
  if not pravah_is_internal() then raise exception 'Pravah staff access required.'; end if;
  select * into v_source from pravah_client_sync_inbox
  where source_system = 'vyom' and source_client_id = p_source_client_id for update;
  if v_source.id is null then raise exception 'Vyom client is not in the sync inbox.'; end if;
  if p_existing_client_id is not null then
    select id into v_client from clients where id = p_existing_client_id;
    if v_client is null then raise exception 'Selected Pravah client does not exist.'; end if;
  else
    select id into v_clash from clients
    where regexp_replace(lower(business_name), '[^a-z0-9]+', '', 'g') = v_source.source_name_normalized
    limit 1;
    if v_clash is not null then
      raise exception 'A similar client already exists. Verify and link that record instead.';
    end if;
    insert into clients(business_name) values (v_source.source_name) returning id into v_client;
  end if;
  insert into pravah_client_profiles(client_id, status)
  values (v_client, case when v_source.source_active then 'active' else 'paused' end)
  on conflict (client_id) do nothing;
  update pravah_client_sync_inbox set status = 'linked', linked_client_id = v_client,
    linked_at = now(), linked_by = auth.uid(), updated_at = now()
  where id = v_source.id;
  perform pravah_audit(v_client, 'client_link', v_source.id::text, 'linked_to_vyom',
    jsonb_build_object('vyom_client_id', p_source_client_id, 'source_name', v_source.source_name));
  return v_client;
end $$;

create or replace function pravah_ignore_vyom_client(p_source_client_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not pravah_is_admin() then raise exception 'Pravah administrator access required.'; end if;
  update pravah_client_sync_inbox set status = 'ignored', linked_client_id = null,
    linked_at = null, linked_by = auth.uid(), updated_at = now()
  where source_system = 'vyom' and source_client_id = p_source_client_id;
  if not found then raise exception 'Vyom client is not in the sync inbox.'; end if;
end $$;

create or replace function pravah_submit_report(
  p_placement_id uuid, p_period_start date, p_period_end date,
  p_calls_attempted int default null, p_connected_calls int default null,
  p_followups_completed int default null, p_qualified_opportunities int default null,
  p_meetings_booked int default null, p_sales_count int default null,
  p_revenue_generated numeric default null, p_cash_reported numeric default null,
  p_currency text default 'INR', p_blocker text default null,
  p_support_required text default null, p_next_period_plan text default null,
  p_additional_notes text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_client uuid;
begin
  if not pravah_is_internal() then raise exception 'Pravah staff access required.'; end if;
  if p_period_end < p_period_start then raise exception 'Period end cannot be before period start.'; end if;
  v_client := pravah_resolve_client_for_placement(p_placement_id);
  if v_client is null then raise exception 'Placement does not resolve to a client.'; end if;
  insert into pravah_performance_reports(
    placement_id, client_id, period_start, period_end, calls_attempted,
    connected_calls, followups_completed, qualified_opportunities, meetings_booked,
    sales_count, revenue_generated, cash_collected, currency, blocker,
    support_required, next_period_plan, source_type, source_text,
    cash_verification_status, voided_at, voided_by, void_reason
  ) values (
    p_placement_id, v_client, p_period_start, p_period_end, p_calls_attempted,
    p_connected_calls, p_followups_completed, p_qualified_opportunities, p_meetings_booked,
    p_sales_count, p_revenue_generated, p_cash_reported, p_currency, p_blocker,
    p_support_required, p_next_period_plan, 'manual', p_additional_notes,
    'unverified', null, null, null
  ) on conflict (placement_id, period_start, period_end) do update set
    calls_attempted = excluded.calls_attempted,
    connected_calls = excluded.connected_calls,
    followups_completed = excluded.followups_completed,
    qualified_opportunities = excluded.qualified_opportunities,
    meetings_booked = excluded.meetings_booked,
    sales_count = excluded.sales_count,
    revenue_generated = excluded.revenue_generated,
    cash_collected = excluded.cash_collected,
    currency = excluded.currency,
    blocker = excluded.blocker,
    support_required = excluded.support_required,
    next_period_plan = excluded.next_period_plan,
    source_type = excluded.source_type,
    source_text = excluded.source_text,
    cash_verification_status = 'unverified',
    verified_cash_collected = null,
    verification_source = null,
    verification_reference = null,
    verification_url = null,
    verified_at = null,
    verified_by = null,
    voided_at = null,
    voided_by = null,
    void_reason = null,
    updated_at = now()
  returning id into v_id;
  perform pravah_audit(v_client, 'performance_report', v_id::text, 'submitted',
    jsonb_build_object('source', 'structured_form', 'cash_status', 'unverified'));
  return v_id;
end $$;

create or replace function pravah_verify_report_cash(
  p_report_id uuid, p_verified_cash numeric, p_source text,
  p_reference text default null, p_url text default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_client uuid;
begin
  if not pravah_is_internal() then raise exception 'Pravah staff access required.'; end if;
  if nullif(btrim(p_source), '') is null then raise exception 'Verification source is required.'; end if;
  update pravah_performance_reports set
    verified_cash_collected = p_verified_cash,
    cash_verification_status = 'verified', verification_source = p_source,
    verification_reference = p_reference, verification_url = p_url,
    verified_at = now(), verified_by = auth.uid(), updated_at = now()
  where id = p_report_id and voided_at is null returning client_id into v_client;
  if v_client is null then raise exception 'Active report not found.'; end if;
  perform pravah_audit(v_client, 'performance_report', p_report_id::text, 'cash_verified',
    jsonb_build_object('source', p_source, 'reference', p_reference));
end $$;

create or replace function pravah_record_checkin_v2(
  p_client_id uuid, p_health text, p_satisfaction int, p_summary text,
  p_client_visible_summary text default null, p_internal_notes text default null,
  p_material_issue text default null, p_root_cause text default null,
  p_actions jsonb default '[]'
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; item jsonb; v_action uuid;
begin
  if not pravah_is_internal() then raise exception 'Pravah staff access required.'; end if;
  insert into pravah_client_checkins(
    client_id, health, satisfaction, summary, client_visible_summary,
    internal_notes, material_issue, root_cause
  ) values (
    p_client_id, p_health, p_satisfaction, p_summary, p_client_visible_summary,
    p_internal_notes, p_material_issue, p_root_cause
  ) returning id into v_id;
  insert into pravah_client_profiles(client_id, health) values (p_client_id, p_health)
  on conflict (client_id) do update set health = excluded.health, updated_at = now();
  for item in select value from jsonb_array_elements(coalesce(p_actions, '[]')) loop
    if nullif(btrim(item->>'title'), '') is not null then
      insert into pravah_actions(client_id, checkin_id, title, detail, priority, due_on, owner_uid)
      values (p_client_id, v_id, item->>'title', nullif(item->>'detail',''),
        coalesce(nullif(item->>'priority',''), 'normal'), nullif(item->>'due_on','')::date, auth.uid())
      returning id into v_action;
      perform pravah_audit(p_client_id, 'action', v_action::text, 'created_from_checkin',
        jsonb_build_object('checkin_id', v_id));
    end if;
  end loop;
  perform pravah_audit(p_client_id, 'client_checkin', v_id::text, 'created');
  return v_id;
end $$;

create or replace function pravah_update_client_profile(
  p_client_id uuid, p_status text, p_checkin_cadence text,
  p_internal_notes text default null, p_client_visible_notes text default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not pravah_is_internal() then raise exception 'Pravah staff access required.'; end if;
  insert into pravah_client_profiles(client_id, status, checkin_cadence, notes, client_visible_notes)
  values (p_client_id, p_status, p_checkin_cadence, p_internal_notes, p_client_visible_notes)
  on conflict (client_id) do update set status = excluded.status,
    checkin_cadence = excluded.checkin_cadence, notes = excluded.notes,
    client_visible_notes = excluded.client_visible_notes, updated_at = now();
  perform pravah_audit(p_client_id, 'client_profile', p_client_id::text, 'updated');
end $$;

create or replace function pravah_update_action(
  p_action_id uuid, p_status text, p_completion_note text default null,
  p_cancellation_reason text default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_client uuid;
begin
  if not pravah_is_internal() then raise exception 'Pravah staff access required.'; end if;
  if p_status = 'done' and nullif(btrim(coalesce(p_completion_note,'')), '') is null then
    raise exception 'Completion note is required.';
  end if;
  if p_status = 'cancelled' and nullif(btrim(coalesce(p_cancellation_reason,'')), '') is null then
    raise exception 'Cancellation reason is required.';
  end if;
  update pravah_actions set status = p_status,
    completion_note = case when p_status = 'done' then p_completion_note else completion_note end,
    completed_at = case when p_status = 'done' then now() else completed_at end,
    cancellation_reason = case when p_status = 'cancelled' then p_cancellation_reason else cancellation_reason end,
    cancelled_at = case when p_status = 'cancelled' then now() else cancelled_at end,
    updated_at = now()
  where id = p_action_id returning client_id into v_client;
  if v_client is null then raise exception 'Action not found.'; end if;
  perform pravah_audit(v_client, 'action', p_action_id::text, p_status,
    jsonb_build_object('completion_note', p_completion_note, 'cancellation_reason', p_cancellation_reason));
end $$;

create or replace function pravah_void_report(p_report_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_client uuid;
begin
  if not pravah_is_admin() then raise exception 'Pravah administrator access required.'; end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'Void reason is required.'; end if;
  update pravah_performance_reports set voided_at = now(), voided_by = auth.uid(),
    void_reason = p_reason, updated_at = now()
  where id = p_report_id returning client_id into v_client;
  if v_client is null then raise exception 'Report not found.'; end if;
  perform pravah_audit(v_client, 'performance_report', p_report_id::text, 'voided',
    jsonb_build_object('reason', p_reason));
end $$;

create or replace function pravah_set_placement_state(
  p_placement_id uuid, p_state text, p_reason text, p_ended_on date default current_date
) returns void language plpgsql security definer set search_path = public as $$
declare v_client uuid;
begin
  if not pravah_is_admin() then raise exception 'Pravah administrator access required.'; end if;
  if p_state not in ('active','ended','void') then raise exception 'Invalid placement state.'; end if;
  if p_state <> 'active' and nullif(btrim(p_reason), '') is null then raise exception 'Reason is required.'; end if;
  v_client := pravah_resolve_client_for_placement(p_placement_id);
  insert into pravah_placement_states(placement_id, client_id, state, ended_on, reason, changed_by)
  values (p_placement_id, v_client, p_state,
    case when p_state = 'active' then null else p_ended_on end,
    case when p_state = 'active' then null else p_reason end, auth.uid())
  on conflict (placement_id) do update set state = excluded.state, ended_on = excluded.ended_on,
    reason = excluded.reason, changed_by = auth.uid(), updated_at = now();
  perform pravah_audit(v_client, 'placement', p_placement_id::text, 'state_changed',
    jsonb_build_object('state', p_state, 'reason', p_reason));
end $$;

create or replace function pravah_archive_client(p_client_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not pravah_is_admin() then raise exception 'Pravah administrator access required.'; end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'Archive reason is required.'; end if;
  update pravah_client_profiles set status = 'ended', archived_at = now(),
    archive_reason = p_reason, updated_at = now() where client_id = p_client_id;
  if not found then raise exception 'Client profile not found.'; end if;
  perform pravah_audit(p_client_id, 'client_profile', p_client_id::text, 'archived',
    jsonb_build_object('reason', p_reason));
end $$;

create or replace function pravah_delete_unused_client(p_client_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  if not pravah_is_admin() then raise exception 'Pravah administrator access required.'; end if;
  select business_name into v_name from clients where id = p_client_id;
  if v_name is null then raise exception 'Client not found.'; end if;
  if exists (select 1 from requirements where client_id = p_client_id)
     or exists (select 1 from pravah_client_checkins where client_id = p_client_id)
     or exists (select 1 from pravah_actions where client_id = p_client_id)
     or exists (select 1 from pravah_client_sync_inbox where linked_client_id = p_client_id and status = 'linked') then
    raise exception 'Client has linked history. Archive it instead.';
  end if;
  perform pravah_audit(p_client_id, 'client', p_client_id::text, 'deleted_unused',
    jsonb_build_object('business_name', v_name));
  delete from clients where id = p_client_id;
end $$;

create or replace function pravah_dashboard() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not coalesce((pravah_context()->>'authorized')::boolean, false)
    then jsonb_build_object('authorized', false)
    else jsonb_build_object(
      'authorized', true,
      'active_clients', (select count(*) from pravah_v_clients where status in ('onboarding','active','at_risk')),
      'active_closers', (select count(*) from pravah_training t left join pravah_placement_states ps on ps.placement_id = t.placement_id where t.status in ('active','passed') and coalesce(ps.state,'active') = 'active' and pravah_can_access_client(t.client_id)),
      'training_pass_rate', (select round(100.0 * count(*) filter (where status = 'passed') / nullif(count(*) filter (where status in ('passed','failed')), 0), 1) from pravah_training where pravah_can_access_client(client_id)),
      'closers_on_target', (select round(100.0 * count(*) filter (where target_attainment_pct >= 100) / nullif(count(*) filter (where target_attainment_pct is not null), 0), 1) from pravah_v_reports where voided_at is null),
      'open_actions', (select count(*) from pravah_actions where status not in ('done','cancelled') and pravah_can_access_client(client_id)),
      'at_risk_clients', (select count(*) from pravah_client_profiles where health = 'at_risk' and pravah_can_access_client(client_id))
    ) end;
$$;

do $$
declare signature text;
begin
  foreach signature in array array[
    'pravah_link_vyom_client(uuid,uuid)',
    'pravah_ignore_vyom_client(uuid)',
    'pravah_submit_report(uuid,date,date,int,int,int,int,int,int,numeric,numeric,text,text,text,text,text)',
    'pravah_verify_report_cash(uuid,numeric,text,text,text)',
    'pravah_record_checkin_v2(uuid,text,int,text,text,text,text,text,jsonb)',
    'pravah_update_client_profile(uuid,text,text,text,text)',
    'pravah_update_action(uuid,text,text,text)',
    'pravah_void_report(uuid,text)',
    'pravah_set_placement_state(uuid,text,text,date)',
    'pravah_archive_client(uuid,text)',
    'pravah_delete_unused_client(uuid)'
  ] loop
    execute format('revoke all on function %s from public', signature);
    execute format('grant execute on function %s to authenticated', signature);
  end loop;
end $$;

notify pgrst, 'reload schema';
