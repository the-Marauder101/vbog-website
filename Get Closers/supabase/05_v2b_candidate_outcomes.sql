-- Pravah V2B — candidate handoffs, milestone writeback and Nikash outcomes.
-- Run after 03_v2a_operational_hardening.sql. Safe to re-run.

create table if not exists pravah_candidate_sync_inbox (
  id                       uuid primary key default gen_random_uuid(),
  source_system            text not null default 'vyom' check (source_system = 'vyom'),
  source_task_id           uuid not null,
  source_project_id        uuid not null,
  source_name              text not null,
  source_name_normalized   text not null,
  source_email             text,
  source_client_id         uuid,
  source_client_name       text,
  source_status            text not null,
  source_payload           jsonb not null default '{}',
  status                   text not null default 'new'
                           check (status in ('new','linked','conflict','ignored','placed')),
  linked_candidate_id      uuid references candidates(id) on delete set null,
  linked_client_id         uuid references clients(id) on delete set null,
  linked_requirement_id    uuid references requirements(id) on delete set null,
  placement_id             uuid references placements(id) on delete set null,
  last_seen_at             timestamptz not null default now(),
  linked_at                timestamptz,
  linked_by                uuid,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  status_changed_at        timestamptz,
  unique (source_system, source_task_id)
);

create unique index if not exists pravah_one_vyom_task_per_placement
  on pravah_candidate_sync_inbox(placement_id) where placement_id is not null;
alter table pravah_candidate_sync_inbox enable row level security;
alter table pravah_candidate_sync_inbox force row level security;
revoke all on pravah_candidate_sync_inbox from anon, authenticated;
grant select on pravah_candidate_sync_inbox to authenticated;
drop policy if exists pravah_candidate_sync_internal_read on pravah_candidate_sync_inbox;
create policy pravah_candidate_sync_internal_read on pravah_candidate_sync_inbox for select to authenticated
  using (pravah_is_internal());

create table if not exists pravah_integration_events (
  id              uuid primary key default gen_random_uuid(),
  destination     text not null check (destination in ('vyom')),
  source_task_id  uuid not null,
  event_type      text not null check (event_type in (
                    'placement.created','training.started','training.updated',
                    'placement.ended','outcome.recorded'
                  )),
  idempotency_key text not null unique,
  payload          jsonb not null default '{}',
  status           text not null default 'pending' check (status in ('pending','processing','delivered','failed')),
  attempt_count    int not null default 0,
  last_error       text,
  occurred_at      timestamptz not null default now(),
  delivered_at     timestamptz
);

create index if not exists pravah_integration_events_status_idx
  on pravah_integration_events(status, occurred_at);
alter table pravah_integration_events enable row level security;
alter table pravah_integration_events force row level security;
revoke all on pravah_integration_events from anon, authenticated;

alter table placement_outcomes
  add column if not exists source_system text not null default 'nikash'
    check (source_system in ('nikash','pravah')),
  add column if not exists confirmed_by uuid;

create or replace view pravah_v_candidate_sync_inbox with (security_invoker = true) as
select s.*,
       suggestion.id as suggested_candidate_id,
       suggestion.full_name as suggested_candidate_name,
       linked_candidate.full_name as linked_candidate_name,
       client_link.linked_client_id as resolved_client_id,
       resolved_client.business_name as resolved_client_name,
       case
         when s.source_client_id is null then 'missing_client_on_vyom_card'
         when client_link.linked_client_id is null then 'client_not_linked'
         else 'ready'
       end as client_link_state
from pravah_candidate_sync_inbox s
left join lateral (
  select min(c.id::text)::uuid as id, min(c.full_name) as full_name
  from candidates c
  where regexp_replace(lower(c.full_name), '[^a-z0-9]+', '', 'g') = s.source_name_normalized
  having count(*) = 1
) suggestion on true
left join pravah_client_sync_inbox client_link
  on client_link.source_client_id = s.source_client_id and client_link.status = 'linked'
left join clients resolved_client on resolved_client.id = client_link.linked_client_id
left join candidates linked_candidate on linked_candidate.id = s.linked_candidate_id
where pravah_is_internal();

create or replace view pravah_v_outcome_checkpoints with (security_invoker = true) as
select p.id as placement_id, r.client_id, c.business_name, cand.full_name as closer_name,
       p.joined_on, cp.checkpoint,
       (p.joined_on + case cp.checkpoint when 'm3' then 90 when 'm6' then 180 else 365 end)::date as due_on,
       case
         when o.id is not null then 'recorded'
         when current_date >= (p.joined_on + case cp.checkpoint when 'm3' then 90 when 'm6' then 180 else 365 end)::date then 'due'
         else 'upcoming'
       end as checkpoint_state,
       o.retained, o.exit_type, o.exit_reason, o.days_to_first_close,
       o.quota_attainment_pct, o.client_satisfaction, o.client_notes,
       o.source_system, o.recorded_at,
       greatest(0, (current_date - (p.joined_on + case cp.checkpoint when 'm3' then 90 when 'm6' then 180 else 365 end)::date))::int as days_overdue,
       (select (min(pr.period_end) - p.joined_on)::int
          from pravah_performance_reports pr
         where pr.placement_id = p.id and pr.voided_at is null and coalesce(pr.sales_count, 0) > 0
       ) as suggested_days_to_first_close
from placements p
join requirements r on r.id = p.requirement_id
join clients c on c.id = r.client_id
join candidates cand on cand.id = p.candidate_id
cross join (values ('m3'),('m6'),('m12')) cp(checkpoint)
left join placement_outcomes o on o.placement_id = p.id and o.checkpoint = cp.checkpoint
where pravah_can_access_client(r.client_id);

grant select on pravah_v_candidate_sync_inbox, pravah_v_outcome_checkpoints to authenticated;

create or replace function pravah_link_vyom_candidate(
  p_source_task_id uuid, p_existing_candidate_id uuid
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_source pravah_candidate_sync_inbox%rowtype; v_candidate uuid;
begin
  if not pravah_is_internal() then raise exception 'Pravah staff access required.'; end if;
  select * into v_source from pravah_candidate_sync_inbox
  where source_system = 'vyom' and source_task_id = p_source_task_id for update;
  if v_source.id is null then raise exception 'Vyom candidate is not in the handoff inbox.'; end if;
  select id into v_candidate from candidates where id = p_existing_candidate_id;
  if v_candidate is null then raise exception 'Selected Nikash candidate does not exist.'; end if;
  update pravah_candidate_sync_inbox set status = case when placement_id is null then 'linked' else 'placed' end,
    linked_candidate_id = v_candidate, linked_at = now(), linked_by = auth.uid(), updated_at = now()
  where id = v_source.id;
  perform pravah_audit(v_source.linked_client_id, 'candidate_link', v_source.id::text, 'linked_to_vyom',
    jsonb_build_object('vyom_task_id', p_source_task_id, 'candidate_id', v_candidate));
  return v_candidate;
end $$;

create or replace function pravah_ignore_vyom_candidate(p_source_task_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not pravah_is_admin() then raise exception 'Pravah administrator access required.'; end if;
  update pravah_candidate_sync_inbox set status = 'ignored', linked_candidate_id = null,
    linked_at = null, linked_by = auth.uid(), updated_at = now()
  where source_system = 'vyom' and source_task_id = p_source_task_id and placement_id is null;
  if not found then raise exception 'Candidate handoff cannot be ignored.'; end if;
end $$;

create or replace function pravah_complete_candidate_handoff(
  p_source_task_id uuid, p_requirement_id uuid, p_joined_on date
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_source pravah_candidate_sync_inbox%rowtype; v_requirement requirements%rowtype; v_client uuid; v_placement uuid;
begin
  if not pravah_is_internal() then raise exception 'Pravah staff access required.'; end if;
  select * into v_source from pravah_candidate_sync_inbox
  where source_system = 'vyom' and source_task_id = p_source_task_id for update;
  if v_source.id is null or v_source.linked_candidate_id is null then
    raise exception 'Verify the Nikash candidate identity first.';
  end if;
  if v_source.source_status <> 'Placed - Handoff to Pravah' then
    raise exception 'The Vyom card is not in the handoff stage.';
  end if;
  select linked_client_id into v_client from pravah_client_sync_inbox
  where source_client_id = v_source.source_client_id and status = 'linked';
  if v_client is null then raise exception 'Link the Vyom client before completing this handoff.'; end if;
  select * into v_requirement from requirements where id = p_requirement_id;
  if v_requirement.id is null or v_requirement.client_id <> v_client then
    raise exception 'Choose a Nikash requirement belonging to the linked client.';
  end if;
  v_placement := pravah_create_placement(v_source.linked_candidate_id, p_requirement_id, p_joined_on);
  update pravah_candidate_sync_inbox set status = 'placed', linked_client_id = v_client,
    linked_requirement_id = p_requirement_id, placement_id = v_placement, updated_at = now()
  where id = v_source.id;
  insert into pravah_integration_events(destination, source_task_id, event_type, idempotency_key, payload)
  values ('vyom', p_source_task_id, 'placement.created',
    'pravah:placement:' || v_placement::text || ':created',
    jsonb_build_object('placement_id', v_placement, 'summary', 'Placed · Pravah handoff complete',
      'joined_on', p_joined_on, 'client_id', v_client))
  on conflict (idempotency_key) do nothing;
  return v_placement;
end $$;

create or replace function pravah_record_outcome(
  p_placement_id uuid, p_checkpoint text, p_retained boolean,
  p_exit_type text default null, p_exit_reason text default null,
  p_days_to_first_close int default null, p_quota_pct numeric default null,
  p_satisfaction int default null, p_notes text default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_client uuid; v_source_task uuid; v_summary text;
begin
  if not pravah_is_internal() then raise exception 'Pravah staff access required.'; end if;
  if p_checkpoint not in ('m3','m6','m12') then raise exception 'Checkpoint must be m3, m6 or m12.'; end if;
  if not p_retained and nullif(btrim(coalesce(p_exit_reason, '')), '') is null then
    raise exception 'Exit reason is required when the closer is not retained.';
  end if;
  v_client := pravah_resolve_client_for_placement(p_placement_id);
  if v_client is null then raise exception 'Placement does not exist.'; end if;
  perform record_outcome(p_placement_id, p_checkpoint, p_retained, p_exit_type,
    p_exit_reason, p_days_to_first_close, p_quota_pct, p_satisfaction, p_notes);
  update placement_outcomes set source_system = 'pravah', confirmed_by = auth.uid()
  where placement_id = p_placement_id and checkpoint = p_checkpoint;
  perform pravah_audit(v_client, 'placement_outcome', p_placement_id::text, 'recorded',
    jsonb_build_object('checkpoint', p_checkpoint, 'retained', p_retained));
  select source_task_id into v_source_task from pravah_candidate_sync_inbox
  where placement_id = p_placement_id;
  if v_source_task is not null then
    v_summary := upper(p_checkpoint) || ' outcome · ' || case when p_retained then 'retained' else 'not retained' end;
    insert into pravah_integration_events(destination, source_task_id, event_type, idempotency_key, payload)
    values ('vyom', v_source_task, 'outcome.recorded',
      'pravah:outcome:' || p_placement_id::text || ':' || p_checkpoint,
      jsonb_build_object('placement_id', p_placement_id, 'checkpoint', p_checkpoint,
        'retained', p_retained, 'summary', v_summary))
    on conflict (idempotency_key) do update set payload = excluded.payload,
      status = 'pending', last_error = null, occurred_at = now(), delivered_at = null;
  end if;
end $$;

create or replace function pravah_enqueue_training_milestone() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_task uuid; v_summary text; v_event text; v_key text;
begin
  if tg_op = 'UPDATE' and old.status is not distinct from new.status then return new; end if;
  select source_task_id into v_task from pravah_candidate_sync_inbox where placement_id = new.placement_id;
  if v_task is null then return new; end if;
  v_event := case when new.status = 'active' then 'training.started' else 'training.updated' end;
  v_summary := 'Training · ' || replace(initcap(new.status), '_', ' ');
  v_key := 'pravah:training:' || new.id::text || ':' || new.status;
  insert into pravah_integration_events(destination, source_task_id, event_type, idempotency_key, payload)
  values ('vyom', v_task, v_event, v_key,
    jsonb_build_object('training_id', new.id, 'placement_id', new.placement_id,
      'status', new.status, 'summary', v_summary, 'completed_on', new.completed_on))
  on conflict (idempotency_key) do update set payload = excluded.payload,
    status = 'pending', last_error = null, occurred_at = now(), delivered_at = null;
  return new;
end $$;

revoke all on function pravah_enqueue_training_milestone() from public;
drop trigger if exists pravah_training_milestone_outbox on pravah_training;
create trigger pravah_training_milestone_outbox after insert or update of status on pravah_training
for each row execute function pravah_enqueue_training_milestone();

create or replace function pravah_enqueue_placement_state() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_task uuid;
begin
  if tg_op = 'UPDATE' and old.state is not distinct from new.state then return new; end if;
  if new.state = 'active' then return new; end if;
  select source_task_id into v_task from pravah_candidate_sync_inbox where placement_id = new.placement_id;
  if v_task is null then return new; end if;
  insert into pravah_integration_events(destination, source_task_id, event_type, idempotency_key, payload)
  values ('vyom', v_task, 'placement.ended',
    'pravah:placement:' || new.placement_id::text || ':' || new.state,
    jsonb_build_object('placement_id', new.placement_id, 'state', new.state,
      'summary', 'Placement · ' || initcap(new.state), 'reason', new.reason, 'ended_on', new.ended_on))
  on conflict (idempotency_key) do update set payload = excluded.payload,
    status = 'pending', last_error = null, occurred_at = now(), delivered_at = null;
  return new;
end $$;

revoke all on function pravah_enqueue_placement_state() from public;
drop trigger if exists pravah_placement_state_outbox on pravah_placement_states;
create trigger pravah_placement_state_outbox after insert or update of state on pravah_placement_states
for each row execute function pravah_enqueue_placement_state();

grant execute on function pravah_link_vyom_candidate(uuid, uuid),
  pravah_ignore_vyom_candidate(uuid), pravah_complete_candidate_handoff(uuid, uuid, date),
  pravah_record_outcome(uuid, text, boolean, text, text, int, numeric, int, text)
to authenticated;
