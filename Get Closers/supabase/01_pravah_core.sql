-- Pravah V1 Core
-- Run after the existing internal/closer-match/sql migrations.
-- Safe to re-run. Existing Nikash candidate, client, requirement and placement
-- records remain canonical; operational data is isolated under pravah_*.

create extension if not exists pgcrypto;

-- ═══ ACCESS ═══════════════════════════════════════════════════════════════

create table if not exists pravah_memberships (
  id          uuid primary key default gen_random_uuid(),
  auth_uid    uuid not null,
  client_id   uuid references clients(id) on delete cascade,
  role        text not null check (role in (
                'gc_admin','operations','trainer','client_success',
                'client_admin','client_viewer'
              )),
  display_name text,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  check (
    (role in ('gc_admin','operations','trainer','client_success') and client_id is null)
    or (role in ('client_admin','client_viewer') and client_id is not null)
  )
);

create unique index if not exists pravah_one_internal_membership
  on pravah_memberships(auth_uid) where client_id is null;
create unique index if not exists pravah_one_client_membership
  on pravah_memberships(auth_uid, client_id) where client_id is not null;

-- Existing approved Nikash staff become internal Pravah users. Creating a
-- Supabase Auth account alone still grants nothing.
insert into pravah_memberships (auth_uid, role, display_name)
select s.auth_uid,
       case when s.role = 'admin' then 'gc_admin' else 'operations' end,
       coalesce(s.full_name, s.email)
from staff s
where s.auth_uid is not null and s.active
on conflict do nothing;

create or replace function pravah_sync_staff_membership() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.auth_uid is null then return new; end if;
  update pravah_memberships set
    role = case
      when new.role = 'admin' then 'gc_admin'
      when pravah_memberships.role = 'gc_admin' then 'operations'
      else pravah_memberships.role
    end,
    display_name = coalesce(new.full_name, new.email),
    active = new.active
  where auth_uid = new.auth_uid and client_id is null;
  if not found then
    insert into pravah_memberships(auth_uid, role, display_name, active)
    values (
      new.auth_uid,
      case when new.role = 'admin' then 'gc_admin' else 'operations' end,
      coalesce(new.full_name, new.email),
      new.active
    );
  end if;
  return new;
end $$;

drop trigger if exists pravah_staff_membership_sync on staff;
create trigger pravah_staff_membership_sync after insert or update of auth_uid, role, active, full_name, email
on staff for each row execute function pravah_sync_staff_membership();

create or replace function pravah_my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from pravah_memberships
  where auth_uid = auth.uid() and client_id is null and active
  order by case role when 'gc_admin' then 1 else 2 end
  limit 1;
$$;

create or replace function pravah_is_internal() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from pravah_memberships
    where auth_uid = auth.uid() and client_id is null and active
      and role in ('gc_admin','operations','trainer','client_success')
  );
$$;

create or replace function pravah_can_access_client(p_client_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select pravah_is_internal() or exists (
    select 1 from pravah_memberships
    where auth_uid = auth.uid() and client_id = p_client_id and active
  );
$$;

revoke all on function pravah_my_role() from public;
revoke all on function pravah_is_internal() from public;
revoke all on function pravah_can_access_client(uuid) from public;
grant execute on function pravah_my_role() to authenticated;
grant execute on function pravah_is_internal() to authenticated;
grant execute on function pravah_can_access_client(uuid) to authenticated;

-- ═══ OPERATIONAL TABLES ═══════════════════════════════════════════════════

create table if not exists pravah_client_profiles (
  client_id          uuid primary key references clients(id) on delete cascade,
  status             text not null default 'active'
                     check (status in ('onboarding','active','at_risk','paused','ended')),
  health             text not null default 'unknown'
                     check (health in ('unknown','healthy','watch','at_risk')),
  account_owner_uid  uuid,
  reporting_currency text not null default 'INR',
  checkin_cadence    text not null default 'weekly'
                     check (checkin_cadence in ('weekly','fortnightly','monthly')),
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

insert into pravah_client_profiles(client_id)
select id from clients
on conflict (client_id) do nothing;

create table if not exists pravah_training (
  id                     uuid primary key default gen_random_uuid(),
  placement_id           uuid not null unique references placements(id) on delete cascade,
  client_id              uuid not null references clients(id) on delete cascade,
  status                 text not null default 'planned'
                         check (status in ('planned','active','passed','extended','failed','withdrawn')),
  started_on             date,
  expected_completion_on date,
  completed_on           date,
  trainer_uid            uuid,
  product_ready          boolean,
  roleplay_rating        numeric check (roleplay_rating between 1 and 5),
  risk_level             text not null default 'none'
                         check (risk_level in ('none','watch','high')),
  decision_note          text,
  created_by             uuid not null default auth.uid(),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  check (completed_on is null or started_on is null or completed_on >= started_on)
);

create table if not exists pravah_training_checkpoints (
  id              uuid primary key default gen_random_uuid(),
  training_id     uuid not null references pravah_training(id) on delete cascade,
  client_id       uuid not null references clients(id) on delete cascade,
  checkpoint_on   date not null default current_date,
  checkpoint_type text not null check (checkpoint_type in (
                    'attendance','product','roleplay','call_review','counselling','decision'
                  )),
  rating          numeric check (rating between 1 and 5),
  outcome         text check (outcome in ('on_track','watch','blocked','passed','failed')),
  note            text not null,
  created_by      uuid not null default auth.uid(),
  created_at      timestamptz not null default now()
);

create table if not exists pravah_targets (
  id            uuid primary key default gen_random_uuid(),
  placement_id  uuid not null references placements(id) on delete cascade,
  client_id     uuid not null references clients(id) on delete cascade,
  period_start  date not null,
  period_end    date not null,
  target_value  numeric not null check (target_value >= 0),
  target_unit   text not null default 'revenue'
                check (target_unit in ('revenue','cash','sales')),
  currency      text not null default 'INR',
  created_by    uuid not null default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (placement_id, period_start, period_end, target_unit),
  check (period_end >= period_start)
);

create table if not exists pravah_performance_reports (
  id                      uuid primary key default gen_random_uuid(),
  placement_id            uuid not null references placements(id) on delete cascade,
  client_id               uuid not null references clients(id) on delete cascade,
  period_start            date not null,
  period_end              date not null,
  calls_attempted         int check (calls_attempted >= 0),
  connected_calls         int check (connected_calls >= 0),
  qualified_opportunities int check (qualified_opportunities >= 0),
  sales_count             int check (sales_count >= 0),
  revenue_generated       numeric check (revenue_generated >= 0),
  cash_collected          numeric check (cash_collected >= 0),
  pipeline_value          numeric check (pipeline_value >= 0),
  currency                text not null default 'INR',
  blocker                 text,
  support_required        text,
  next_period_plan        text,
  source_type             text not null default 'manual'
                          check (source_type in ('manual','whatsapp','sheet','crm','api')),
  source_text             text,
  shared_at               timestamptz,
  created_by              uuid not null default auth.uid(),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (placement_id, period_start, period_end),
  check (period_end >= period_start),
  check (connected_calls is null or calls_attempted is null or connected_calls <= calls_attempted)
);

create table if not exists pravah_client_checkins (
  id                  uuid primary key default gen_random_uuid(),
  client_id           uuid not null references clients(id) on delete cascade,
  occurred_at         timestamptz not null default now(),
  health              text not null check (health in ('healthy','watch','at_risk')),
  satisfaction        int check (satisfaction between 1 and 5),
  summary             text not null,
  material_issue      text,
  root_cause          text,
  next_action         text,
  action_owner_uid    uuid,
  action_due_on       date,
  created_by          uuid not null default auth.uid(),
  created_at          timestamptz not null default now()
);

create table if not exists pravah_actions (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid not null references clients(id) on delete cascade,
  placement_id   uuid references placements(id) on delete cascade,
  title          text not null,
  detail         text,
  priority       text not null default 'normal'
                 check (priority in ('low','normal','high','critical')),
  status         text not null default 'open'
                 check (status in ('open','in_progress','blocked','done','cancelled')),
  owner_uid      uuid,
  due_on         date,
  completed_at   timestamptz,
  created_by     uuid not null default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists pravah_audit_events (
  id          bigserial primary key,
  client_id   uuid references clients(id) on delete set null,
  entity_type text not null,
  entity_id   text not null,
  action      text not null,
  actor_uid   uuid,
  source      text not null default 'pravah',
  payload     jsonb not null default '{}',
  created_at  timestamptz not null default now()
);

create index if not exists pravah_training_client_idx on pravah_training(client_id, status);
create index if not exists pravah_reports_client_period_idx on pravah_performance_reports(client_id, period_end desc);
create index if not exists pravah_checkins_client_idx on pravah_client_checkins(client_id, occurred_at desc);
create index if not exists pravah_actions_due_idx on pravah_actions(status, due_on) where status not in ('done','cancelled');
create index if not exists pravah_audit_entity_idx on pravah_audit_events(entity_type, entity_id, created_at desc);

-- Keep placement/client relationships canonical even when writes arrive from
-- a form, WhatsApp parser, Sheet mapping or future API.
create or replace function pravah_resolve_client_for_placement(p_placement_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select r.client_id
  from placements p join requirements r on r.id = p.requirement_id
  where p.id = p_placement_id;
$$;

create or replace function pravah_fill_client_id() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_client uuid;
begin
  v_client := pravah_resolve_client_for_placement(new.placement_id);
  if v_client is null then raise exception 'Placement does not resolve to a client.'; end if;
  new.client_id := v_client;
  return new;
end $$;

drop trigger if exists pravah_training_client on pravah_training;
create trigger pravah_training_client before insert or update of placement_id
on pravah_training for each row execute function pravah_fill_client_id();

drop trigger if exists pravah_target_client on pravah_targets;
create trigger pravah_target_client before insert or update of placement_id
on pravah_targets for each row execute function pravah_fill_client_id();

drop trigger if exists pravah_report_client on pravah_performance_reports;
create trigger pravah_report_client before insert or update of placement_id
on pravah_performance_reports for each row execute function pravah_fill_client_id();

create or replace function pravah_fill_checkpoint_client() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_client uuid;
begin
  select client_id into v_client from pravah_training where id = new.training_id;
  if v_client is null then raise exception 'Training record does not resolve to a client.'; end if;
  new.client_id := v_client;
  return new;
end $$;

drop trigger if exists pravah_checkpoint_client on pravah_training_checkpoints;
create trigger pravah_checkpoint_client before insert or update of training_id
on pravah_training_checkpoints for each row execute function pravah_fill_checkpoint_client();

-- ═══ ROW LEVEL SECURITY ═══════════════════════════════════════════════════

do $$
declare t text;
begin
  foreach t in array array[
    'pravah_memberships','pravah_client_profiles','pravah_training',
    'pravah_training_checkpoints','pravah_targets','pravah_performance_reports',
    'pravah_client_checkins','pravah_actions','pravah_audit_events'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;
end $$;

revoke all on
  pravah_memberships, pravah_client_profiles, pravah_training,
  pravah_training_checkpoints, pravah_targets, pravah_performance_reports,
  pravah_client_checkins, pravah_actions, pravah_audit_events
from anon, authenticated;
revoke all on sequence pravah_audit_events_id_seq from anon, authenticated;

drop policy if exists pravah_membership_self_read on pravah_memberships;
create policy pravah_membership_self_read on pravah_memberships for select to authenticated
  using (auth_uid = auth.uid() or pravah_my_role() = 'gc_admin');
drop policy if exists pravah_membership_admin_write on pravah_memberships;
create policy pravah_membership_admin_write on pravah_memberships for all to authenticated
  using (pravah_my_role() = 'gc_admin') with check (pravah_my_role() = 'gc_admin');

do $$
declare t text;
begin
  foreach t in array array[
    'pravah_client_profiles','pravah_training','pravah_training_checkpoints',
    'pravah_targets','pravah_performance_reports','pravah_client_checkins','pravah_actions'
  ] loop
    execute format('drop policy if exists pravah_internal_write on %I', t);
    execute format(
      'create policy pravah_internal_write on %I for all to authenticated using (pravah_is_internal()) with check (pravah_is_internal())', t
    );
    execute format('drop policy if exists pravah_client_read on %I', t);
    execute format(
      'create policy pravah_client_read on %I for select to authenticated using (pravah_can_access_client(client_id))', t
    );
  end loop;
end $$;

drop policy if exists pravah_audit_internal on pravah_audit_events;
create policy pravah_audit_internal on pravah_audit_events for select to authenticated
  using (pravah_is_internal());
drop policy if exists pravah_audit_insert on pravah_audit_events;
create policy pravah_audit_insert on pravah_audit_events for insert to authenticated
  with check (pravah_is_internal());

-- Allow approved Pravah internal users to use the shared handoff records. This
-- does not expose scores to clients or candidates.
drop policy if exists pravah_internal_clients on clients;
create policy pravah_internal_clients on clients for all to authenticated
  using (pravah_is_internal()) with check (pravah_is_internal());
drop policy if exists pravah_client_own_client on clients;
create policy pravah_client_own_client on clients for select to authenticated
  using (pravah_can_access_client(id));

do $$
declare t text;
begin
  foreach t in array array['candidates','requirements','placements'] loop
    execute format('drop policy if exists pravah_internal_read on %I', t);
    execute format('create policy pravah_internal_read on %I for select to authenticated using (pravah_is_internal())', t);
  end loop;
end $$;

grant select on clients to authenticated;
grant select on candidates, requirements, placements to authenticated;
grant select on
  pravah_memberships, pravah_client_profiles, pravah_training,
  pravah_training_checkpoints, pravah_targets, pravah_performance_reports,
  pravah_client_checkins, pravah_actions to authenticated;
grant select on pravah_audit_events to authenticated;

-- ═══ READ MODELS ══════════════════════════════════════════════════════════

create or replace view pravah_v_clients with (security_invoker = true) as
select c.id, c.business_name,
       coalesce(cp.status, 'onboarding') as status,
       coalesce(cp.health, 'unknown') as health,
       cp.reporting_currency, cp.checkin_cadence,
       (select max(ci.occurred_at) from pravah_client_checkins ci where ci.client_id = c.id) as last_checkin_at,
       (select count(*) from pravah_training t where t.client_id = c.id and t.status in ('active','passed')) as active_closers,
       (select count(*) from pravah_actions a where a.client_id = c.id and a.status not in ('done','cancelled')) as open_actions
from clients c left join pravah_client_profiles cp on cp.client_id = c.id
where pravah_can_access_client(c.id);

create or replace view pravah_v_placements with (security_invoker = true) as
select p.id as placement_id, p.candidate_id, cand.full_name as closer_name,
       p.requirement_id, r.title as role_title, r.client_id, c.business_name,
       p.joined_on, t.id as training_id, coalesce(t.status, 'not_started') as training_status,
       t.expected_completion_on, t.product_ready, t.roleplay_rating, t.risk_level,
       (select tc.checkpoint_on from pravah_training_checkpoints tc where tc.training_id = t.id order by tc.created_at desc limit 1) as last_checkpoint_on,
       (select tc.outcome from pravah_training_checkpoints tc where tc.training_id = t.id order by tc.created_at desc limit 1) as last_checkpoint_outcome,
       coalesce((select sum(pr.sales_count) from pravah_performance_reports pr where pr.placement_id = p.id), 0) as total_sales,
       coalesce((select sum(pr.cash_collected) from pravah_performance_reports pr where pr.placement_id = p.id), 0) as total_cash
from placements p
join candidates cand on cand.id = p.candidate_id
join requirements r on r.id = p.requirement_id
join clients c on c.id = r.client_id
left join pravah_training t on t.placement_id = p.id
where pravah_is_internal();

create or replace view pravah_v_reports with (security_invoker = true) as
select pr.*, cand.full_name as closer_name, c.business_name,
       case when tg.target_value > 0 then
         round((case tg.target_unit
           when 'sales' then coalesce(pr.sales_count, 0)
           when 'cash' then coalesce(pr.cash_collected, 0)
           else coalesce(pr.revenue_generated, 0) end / tg.target_value) * 100, 1)
       end as target_attainment_pct
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
where t.status in ('active','extended') and t.risk_level <> 'none'
  and pravah_can_access_client(t.client_id);

grant select on pravah_v_clients, pravah_v_placements, pravah_v_reports, pravah_v_attention to authenticated;

-- ═══ WRITE API ════════════════════════════════════════════════════════════

create or replace function pravah_audit(
  p_client_id uuid, p_entity_type text, p_entity_id text,
  p_action text, p_payload jsonb default '{}'
) returns void language sql security definer set search_path = public as $$
  insert into pravah_audit_events(client_id, entity_type, entity_id, action, actor_uid, payload)
  values (p_client_id, p_entity_type, p_entity_id, p_action, auth.uid(), coalesce(p_payload, '{}'));
$$;

create or replace function pravah_context() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_role text;
begin
  v_role := pravah_my_role();
  if v_role is null then
    return jsonb_build_object('authorized', false);
  end if;
  return jsonb_build_object(
    'authorized', true,
    'role', v_role,
    'display_name', (select display_name from pravah_memberships
      where auth_uid = auth.uid() and client_id is null and active limit 1)
  );
end $$;

create or replace function pravah_create_client(p_business_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not pravah_is_internal() then raise exception 'Pravah staff access required.'; end if;
  if nullif(btrim(p_business_name), '') is null then raise exception 'Client name is required.'; end if;
  insert into clients(business_name) values (btrim(p_business_name)) returning id into v_id;
  insert into pravah_client_profiles(client_id) values (v_id);
  perform pravah_audit(v_id, 'client', v_id::text, 'created');
  return v_id;
end $$;

create or replace function pravah_create_placement(
  p_candidate_id uuid, p_requirement_id uuid, p_joined_on date
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_match uuid; v_interview uuid; v_client uuid;
begin
  if not pravah_is_internal() then raise exception 'Pravah staff access required.'; end if;
  select client_id into v_client from requirements where id = p_requirement_id;
  if v_client is null then raise exception 'Requirement not found.'; end if;
  select id into v_id from placements
    where requirement_id = p_requirement_id and candidate_id = p_candidate_id limit 1;
  if v_id is null then
    select id into v_match from matches where requirement_id = p_requirement_id and candidate_id = p_candidate_id;
    select id into v_interview from interviews where requirement_id = p_requirement_id and candidate_id = p_candidate_id order by conducted_at desc limit 1;
    insert into placements(requirement_id, candidate_id, match_id, interview_id, joined_on)
    values (p_requirement_id, p_candidate_id, v_match, v_interview, p_joined_on)
    returning id into v_id;
    update requirements set status = 'filled' where id = p_requirement_id;
    perform pravah_audit(v_client, 'placement', v_id::text, 'created', jsonb_build_object('source','manual'));
  end if;
  return v_id;
end $$;

create or replace function pravah_start_training(
  p_placement_id uuid, p_started_on date, p_expected_completion_on date
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_client uuid;
begin
  if not pravah_is_internal() then raise exception 'Pravah staff access required.'; end if;
  v_client := pravah_resolve_client_for_placement(p_placement_id);
  insert into pravah_training(placement_id, client_id, status, started_on, expected_completion_on, trainer_uid)
  values (p_placement_id, v_client, 'active', p_started_on, p_expected_completion_on, auth.uid())
  on conflict (placement_id) do update set
    status = 'active', started_on = excluded.started_on,
    expected_completion_on = excluded.expected_completion_on,
    trainer_uid = excluded.trainer_uid, updated_at = now()
  returning id into v_id;
  perform pravah_audit(v_client, 'training', v_id::text, 'started');
  return v_id;
end $$;

create or replace function pravah_update_training(
  p_training_id uuid, p_status text, p_risk_level text default 'none',
  p_product_ready boolean default null, p_roleplay_rating numeric default null,
  p_decision_note text default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_client uuid;
begin
  if not pravah_is_internal() then raise exception 'Pravah staff access required.'; end if;
  update pravah_training set status = p_status, risk_level = p_risk_level,
    product_ready = p_product_ready, roleplay_rating = p_roleplay_rating,
    decision_note = p_decision_note,
    completed_on = case when p_status in ('passed','failed','withdrawn') then coalesce(completed_on, current_date) else completed_on end,
    updated_at = now()
  where id = p_training_id returning client_id into v_client;
  if v_client is null then raise exception 'Training record not found.'; end if;
  perform pravah_audit(v_client, 'training', p_training_id::text, 'updated', jsonb_build_object('status', p_status));
end $$;

create or replace function pravah_add_training_checkpoint(
  p_training_id uuid, p_checkpoint_type text, p_rating numeric,
  p_outcome text, p_note text, p_checkpoint_on date default current_date
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_client uuid;
begin
  if not pravah_is_internal() then raise exception 'Pravah staff access required.'; end if;
  select client_id into v_client from pravah_training where id = p_training_id;
  if v_client is null then raise exception 'Training record not found.'; end if;
  insert into pravah_training_checkpoints(
    training_id, client_id, checkpoint_on, checkpoint_type, rating, outcome, note
  ) values (
    p_training_id, v_client, p_checkpoint_on, p_checkpoint_type, p_rating, p_outcome, p_note
  ) returning id into v_id;
  perform pravah_audit(v_client, 'training_checkpoint', v_id::text, 'created', jsonb_build_object('type', p_checkpoint_type));
  return v_id;
end $$;

create or replace function pravah_save_report(
  p_placement_id uuid, p_period_start date, p_period_end date,
  p_calls_attempted int default null, p_connected_calls int default null,
  p_qualified_opportunities int default null, p_sales_count int default null,
  p_revenue_generated numeric default null, p_cash_collected numeric default null,
  p_pipeline_value numeric default null, p_currency text default 'INR',
  p_blocker text default null, p_support_required text default null,
  p_next_period_plan text default null, p_source_type text default 'manual',
  p_source_text text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_client uuid;
begin
  if not pravah_is_internal() then raise exception 'Pravah staff access required.'; end if;
  v_client := pravah_resolve_client_for_placement(p_placement_id);
  insert into pravah_performance_reports(
    placement_id, client_id, period_start, period_end, calls_attempted,
    connected_calls, qualified_opportunities, sales_count, revenue_generated,
    cash_collected, pipeline_value, currency, blocker, support_required,
    next_period_plan, source_type, source_text
  ) values (
    p_placement_id, v_client, p_period_start, p_period_end, p_calls_attempted,
    p_connected_calls, p_qualified_opportunities, p_sales_count, p_revenue_generated,
    p_cash_collected, p_pipeline_value, p_currency, p_blocker, p_support_required,
    p_next_period_plan, p_source_type, p_source_text
  ) on conflict (placement_id, period_start, period_end) do update set
    calls_attempted = excluded.calls_attempted,
    connected_calls = excluded.connected_calls,
    qualified_opportunities = excluded.qualified_opportunities,
    sales_count = excluded.sales_count,
    revenue_generated = excluded.revenue_generated,
    cash_collected = excluded.cash_collected,
    pipeline_value = excluded.pipeline_value,
    currency = excluded.currency,
    blocker = excluded.blocker,
    support_required = excluded.support_required,
    next_period_plan = excluded.next_period_plan,
    source_type = excluded.source_type,
    source_text = excluded.source_text,
    updated_at = now()
  returning id into v_id;
  perform pravah_audit(v_client, 'performance_report', v_id::text, 'saved', jsonb_build_object('source', p_source_type));
  return v_id;
end $$;

create or replace function pravah_record_checkin(
  p_client_id uuid, p_health text, p_satisfaction int, p_summary text,
  p_material_issue text default null, p_root_cause text default null,
  p_next_action text default null, p_action_due_on date default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not pravah_is_internal() then raise exception 'Pravah staff access required.'; end if;
  insert into pravah_client_checkins(
    client_id, health, satisfaction, summary, material_issue, root_cause,
    next_action, action_owner_uid, action_due_on
  ) values (
    p_client_id, p_health, p_satisfaction, p_summary, p_material_issue,
    p_root_cause, p_next_action, auth.uid(), p_action_due_on
  ) returning id into v_id;
  insert into pravah_client_profiles(client_id, health) values (p_client_id, p_health)
  on conflict (client_id) do update set health = excluded.health, updated_at = now();
  if nullif(btrim(coalesce(p_next_action, '')), '') is not null then
    insert into pravah_actions(client_id, title, due_on, owner_uid)
    values (p_client_id, p_next_action, p_action_due_on, auth.uid());
  end if;
  perform pravah_audit(p_client_id, 'client_checkin', v_id::text, 'created');
  return v_id;
end $$;

create or replace function pravah_create_action(
  p_client_id uuid, p_title text, p_due_on date default null,
  p_placement_id uuid default null, p_priority text default 'normal',
  p_detail text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not pravah_is_internal() then raise exception 'Pravah staff access required.'; end if;
  insert into pravah_actions(client_id, placement_id, title, due_on, priority, detail, owner_uid)
  values (p_client_id, p_placement_id, p_title, p_due_on, p_priority, p_detail, auth.uid())
  returning id into v_id;
  perform pravah_audit(p_client_id, 'action', v_id::text, 'created');
  return v_id;
end $$;

create or replace function pravah_set_target(
  p_placement_id uuid, p_period_start date, p_period_end date,
  p_target_value numeric, p_target_unit text default 'revenue',
  p_currency text default 'INR'
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_client uuid;
begin
  if not pravah_is_internal() then raise exception 'Pravah staff access required.'; end if;
  v_client := pravah_resolve_client_for_placement(p_placement_id);
  insert into pravah_targets(
    placement_id, client_id, period_start, period_end, target_value, target_unit, currency
  ) values (
    p_placement_id, v_client, p_period_start, p_period_end, p_target_value, p_target_unit, p_currency
  ) on conflict (placement_id, period_start, period_end, target_unit) do update set
    target_value = excluded.target_value, currency = excluded.currency, updated_at = now()
  returning id into v_id;
  perform pravah_audit(v_client, 'target', v_id::text, 'saved', jsonb_build_object('unit', p_target_unit));
  return v_id;
end $$;

create or replace function pravah_complete_action(p_action_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_client uuid;
begin
  if not pravah_is_internal() then raise exception 'Pravah staff access required.'; end if;
  update pravah_actions set status = 'done', completed_at = now(), updated_at = now()
  where id = p_action_id returning client_id into v_client;
  if v_client is null then raise exception 'Action not found.'; end if;
  perform pravah_audit(v_client, 'action', p_action_id::text, 'completed');
end $$;

create or replace function pravah_mark_report_shared(p_report_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_client uuid;
begin
  if not pravah_is_internal() then raise exception 'Pravah staff access required.'; end if;
  update pravah_performance_reports set shared_at = now(), updated_at = now()
  where id = p_report_id returning client_id into v_client;
  if v_client is null then raise exception 'Report not found.'; end if;
  perform pravah_audit(v_client, 'performance_report', p_report_id::text, 'marked_shared');
end $$;

create or replace function pravah_dashboard() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not pravah_is_internal() then jsonb_build_object('authorized', false)
  else jsonb_build_object(
    'authorized', true,
    'active_clients', (select count(*) from pravah_client_profiles where status in ('onboarding','active','at_risk')),
    'active_closers', (select count(*) from pravah_training where status in ('active','passed')),
    'training_pass_rate', (select round(100.0 * count(*) filter (where status = 'passed') / nullif(count(*) filter (where status in ('passed','failed')), 0), 1) from pravah_training),
    'closers_on_target', (select round(100.0 * count(*) filter (where target_attainment_pct >= 100) / nullif(count(*) filter (where target_attainment_pct is not null), 0), 1) from pravah_v_reports),
    'open_actions', (select count(*) from pravah_actions where status not in ('done','cancelled')),
    'at_risk_clients', (select count(*) from pravah_client_profiles where health = 'at_risk')
  ) end;
$$;

revoke all on function pravah_resolve_client_for_placement(uuid) from public;
revoke all on function pravah_sync_staff_membership() from public;
revoke all on function pravah_fill_client_id() from public;
revoke all on function pravah_fill_checkpoint_client() from public;
revoke all on function pravah_audit(uuid,text,text,text,jsonb) from public;

revoke all on function pravah_context() from public;
revoke all on function pravah_create_client(text) from public;
revoke all on function pravah_create_placement(uuid,uuid,date) from public;
revoke all on function pravah_start_training(uuid,date,date) from public;
revoke all on function pravah_update_training(uuid,text,text,boolean,numeric,text) from public;
revoke all on function pravah_add_training_checkpoint(uuid,text,numeric,text,text,date) from public;
revoke all on function pravah_save_report(uuid,date,date,int,int,int,int,numeric,numeric,numeric,text,text,text,text,text,text) from public;
revoke all on function pravah_record_checkin(uuid,text,int,text,text,text,text,date) from public;
revoke all on function pravah_create_action(uuid,text,date,uuid,text,text) from public;
revoke all on function pravah_set_target(uuid,date,date,numeric,text,text) from public;
revoke all on function pravah_complete_action(uuid) from public;
revoke all on function pravah_mark_report_shared(uuid) from public;
revoke all on function pravah_dashboard() from public;

grant execute on function pravah_context() to authenticated;
grant execute on function pravah_create_client(text) to authenticated;
grant execute on function pravah_create_placement(uuid,uuid,date) to authenticated;
grant execute on function pravah_start_training(uuid,date,date) to authenticated;
grant execute on function pravah_update_training(uuid,text,text,boolean,numeric,text) to authenticated;
grant execute on function pravah_add_training_checkpoint(uuid,text,numeric,text,text,date) to authenticated;
grant execute on function pravah_save_report(uuid,date,date,int,int,int,int,numeric,numeric,numeric,text,text,text,text,text,text) to authenticated;
grant execute on function pravah_record_checkin(uuid,text,int,text,text,text,text,date) to authenticated;
grant execute on function pravah_create_action(uuid,text,date,uuid,text,text) to authenticated;
grant execute on function pravah_set_target(uuid,date,date,numeric,text,text) to authenticated;
grant execute on function pravah_complete_action(uuid) to authenticated;
grant execute on function pravah_mark_report_shared(uuid) to authenticated;
grant execute on function pravah_dashboard() to authenticated;

notify pgrst, 'reload schema';
