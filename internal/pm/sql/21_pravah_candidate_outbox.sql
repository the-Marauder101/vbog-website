-- Vyom → Pravah candidate handoff and Pravah → Vyom milestone receipts.
-- Run after sql/20_pravah_client_outbox.sql. Safe to re-run.

-- A card reaches Pravah only through an explicit, operator-controlled stage.
-- Offer Letter Sent is not treated as joined or placed.
update projects
set statuses = statuses || '["Placed - Handoff to Pravah"]'::jsonb
where (name ilike '%get closers%' or name ilike '%getclosers%')
  and type = 'hr'
  and not (statuses ? 'Placed - Handoff to Pravah');

create table if not exists pravah_candidate_outbox (
  id              uuid primary key default gen_random_uuid(),
  event_type      text not null check (event_type in ('candidate.handoff_ready','candidate.updated')),
  task_id          uuid not null references tasks(id) on delete cascade,
  project_id       uuid not null references projects(id) on delete cascade,
  idempotency_key text not null unique,
  payload          jsonb not null,
  status           text not null default 'pending' check (status in ('pending','processing','delivered','failed')),
  attempt_count    int not null default 0,
  last_error       text,
  occurred_at      timestamptz not null default now(),
  processed_at     timestamptz
);

create index if not exists pravah_candidate_outbox_status_idx
  on pravah_candidate_outbox(status, occurred_at);
alter table pravah_candidate_outbox enable row level security;
revoke all on pravah_candidate_outbox from anon, authenticated;

create table if not exists pravah_milestone_receipts (
  id              uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  source_task_id  uuid not null references tasks(id) on delete cascade,
  event_type      text not null,
  summary         text not null,
  payload         jsonb not null default '{}',
  received_at     timestamptz not null default now()
);

create index if not exists pravah_milestone_receipts_task_idx
  on pravah_milestone_receipts(source_task_id, received_at desc);
alter table pravah_milestone_receipts enable row level security;
revoke all on pravah_milestone_receipts from anon, authenticated;

create or replace function enqueue_pravah_candidate_event() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_project projects%rowtype; v_event text; v_time timestamptz := clock_timestamp();
begin
  select * into v_project from projects where id = new.project_id;
  if v_project.id is null
     or not (v_project.name ilike '%get closers%' or v_project.name ilike '%getclosers%')
     or coalesce(new.fields->>'hr_category', 'candidate') <> 'candidate'
     or new.status <> 'Placed - Handoff to Pravah' then
    return new;
  end if;

  if tg_op = 'INSERT' or old.status is distinct from new.status then
    v_event := 'candidate.handoff_ready';
  elsif old.title is not distinct from new.title
        and old.notes is not distinct from new.notes
        and old.fields is not distinct from new.fields then
    return new;
  else
    v_event := 'candidate.updated';
  end if;

  insert into pravah_candidate_outbox(event_type, task_id, project_id, idempotency_key, payload, occurred_at)
  values (
    v_event, new.id, new.project_id,
    'vyom:candidate:' || new.id::text || ':' || floor(extract(epoch from v_time) * 1000000)::bigint::text,
    jsonb_build_object(
      'task_id', new.id, 'project_id', new.project_id, 'name', new.title,
      'email', nullif(btrim(new.fields->>'email'), ''),
      'client_name', nullif(btrim(new.fields->>'client'), ''),
      'status', new.status, 'notes', new.notes,
      'status_changed_at', new.status_changed_at, 'updated_at', new.updated_at
    ), v_time
  );
  return new;
end $$;

revoke all on function enqueue_pravah_candidate_event() from public;
drop trigger if exists tasks_pravah_candidate_outbox on tasks;
create trigger tasks_pravah_candidate_outbox
after insert or update of status, title, notes, fields on tasks
for each row execute function enqueue_pravah_candidate_event();

create or replace view pravah_candidate_handoff as
select t.id as source_task_id, t.project_id as source_project_id,
       t.title as candidate_name, nullif(btrim(t.fields->>'email'), '') as candidate_email,
       c.id as source_client_id, nullif(btrim(t.fields->>'client'), '') as source_client_name,
       t.status as source_status, t.status_changed_at, t.updated_at,
       jsonb_build_object('notes', t.notes, 'fields', t.fields, 'assignee_id', t.assignee_id) as source_payload
from tasks t
join projects p on p.id = t.project_id
left join clients c on lower(c.name) = lower(nullif(btrim(t.fields->>'client'), ''))
where (p.name ilike '%get closers%' or p.name ilike '%getclosers%')
  and coalesce(t.fields->>'hr_category', 'candidate') = 'candidate'
  and t.status = 'Placed - Handoff to Pravah';

revoke all on pravah_candidate_handoff from anon, authenticated;

-- Existing cards already in the handoff column are immediately discoverable.
insert into pravah_candidate_outbox(event_type, task_id, project_id, idempotency_key, payload)
select 'candidate.handoff_ready', h.source_task_id, h.source_project_id,
       'vyom:candidate:' || h.source_task_id::text || ':bootstrap-v2b',
       jsonb_build_object('task_id', h.source_task_id, 'project_id', h.source_project_id,
         'name', h.candidate_name, 'email', h.candidate_email,
         'client_name', h.source_client_name, 'status', h.source_status,
         'status_changed_at', h.status_changed_at, 'updated_at', h.updated_at)
from pravah_candidate_handoff h
on conflict (idempotency_key) do nothing;
