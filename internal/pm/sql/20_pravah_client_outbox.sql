-- Vyom → Pravah client identity outbox. Run after sql/19_client_hub.sql.
-- Safe to re-run. Vyom remains the owner of client identity.

alter table clients add column if not exists updated_at timestamptz not null default now();

create table if not exists pravah_integration_outbox (
  id              uuid primary key default gen_random_uuid(),
  event_type      text not null check (event_type in ('client.created','client.updated','client.deleted')),
  aggregate_type  text not null default 'client',
  aggregate_id    uuid not null,
  schema_version  int not null default 1,
  idempotency_key text not null unique,
  payload          jsonb not null,
  status           text not null default 'pending' check (status in ('pending','processing','delivered','failed')),
  attempt_count    int not null default 0,
  last_error       text,
  occurred_at      timestamptz not null default now(),
  processed_at     timestamptz
);

alter table pravah_integration_outbox enable row level security;
revoke all on pravah_integration_outbox from anon, authenticated;

create or replace function enqueue_pravah_client_event() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_row clients%rowtype; v_event text; v_time timestamptz := clock_timestamp();
begin
  v_row := case when tg_op = 'DELETE' then old else new end;
  v_event := case tg_op when 'INSERT' then 'client.created' when 'UPDATE' then 'client.updated' else 'client.deleted' end;
  insert into pravah_integration_outbox(event_type, aggregate_id, idempotency_key, payload, occurred_at)
  values (
    v_event, v_row.id,
    'vyom:client:' || v_row.id::text || ':' || floor(extract(epoch from v_time) * 1000000)::bigint::text,
    jsonb_build_object(
      'id', v_row.id, 'name', v_row.name, 'active', case when tg_op = 'DELETE' then false else v_row.active end,
      'owner_id', v_row.owner_id, 'contact_name', v_row.contact_name,
      'contact_email', v_row.contact_email, 'rate', v_row.rate,
      'notes', v_row.notes, 'occurred_at', v_time
    ), v_time
  );
  if tg_op = 'DELETE' then return old; end if;
  new.updated_at := v_time;
  return new;
end $$;

revoke all on function enqueue_pravah_client_event() from public;
drop trigger if exists clients_pravah_outbox on clients;
create trigger clients_pravah_outbox before insert or update or delete on clients
for each row execute function enqueue_pravah_client_event();

-- Seed a current-state event for every existing client. The idempotency key
-- makes this safe to re-run and gives V2A an immediate initial catalogue.
insert into pravah_integration_outbox(event_type, aggregate_id, idempotency_key, payload)
select 'client.updated', c.id, 'vyom:client:' || c.id::text || ':bootstrap-v2a',
  jsonb_build_object('id', c.id, 'name', c.name, 'active', c.active,
    'owner_id', c.owner_id, 'contact_name', c.contact_name,
    'contact_email', c.contact_email, 'rate', c.rate, 'notes', c.notes)
from clients c
on conflict (idempotency_key) do nothing;
