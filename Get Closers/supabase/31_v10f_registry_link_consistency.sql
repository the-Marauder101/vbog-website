-- Migration 31: V10f — Stop the client registry drifting from the sync inbox
--
-- A defect introduced by V9, and by this document overstating what V9 did.
--
-- PRD 25.9 / section 23 claim: "Linking that inbox row now also writes a
-- client_system_links row through pravah_client_link_system(), so the
-- registry becomes the durable record and the inbox returns to being a
-- staging area."
--
-- That was never built. Migration 24 backfilled client_system_links once,
-- from the rows that happened to be linked at that moment, and nothing has
-- kept it current since. pravah_link_vyom_client writes only to
-- pravah_client_sync_inbox.
--
-- The drift was immediate and is already visible:
--
--   pravah_client_sync_inbox where status='linked'  -> 3
--   client_system_links where system='vyom'         -> 2
--
-- One client was linked after the backfill and never reached the registry.
-- Left alone, the table the PRD calls the canonical cross-system record
-- would quietly diverge from reality with every link — the exact failure the
-- registry was built to prevent.
--
-- Two parts: make the link path write the registry, then repair the gap.

-- ═══════════════════════════════════════════════════════════════════
-- PART A — pravah_link_vyom_client also records the registry link
-- ═══════════════════════════════════════════════════════════════════
-- The body below is the live definition with one insert added before the
-- return. Nothing else changes. The upsert is idempotent, so re-linking the
-- same pair is safe, and the unique (system, external_id) constraint still
-- prevents one Vyom client mapping to two Pravah clients.

create or replace function pravah_link_vyom_client(
  p_source_client_id   uuid,
  p_existing_client_id uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_source pravah_client_sync_inbox%rowtype;
  v_client uuid;
  v_clash  uuid;
begin
  if not pravah_is_internal() then
    raise exception 'Pravah staff access required.';
  end if;

  select * into v_source from pravah_client_sync_inbox
   where source_system = 'vyom' and source_client_id = p_source_client_id
   for update;
  if v_source.id is null then
    raise exception 'Vyom client is not in the sync inbox.';
  end if;

  if p_existing_client_id is not null then
    select id into v_client from clients where id = p_existing_client_id;
    if v_client is null then
      raise exception 'Selected Pravah client does not exist.';
    end if;
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

  update pravah_client_sync_inbox set
    status = 'linked', linked_client_id = v_client, linked_at = now(),
    linked_by = auth.uid(), updated_at = now()
  where id = v_source.id;

  -- ADDED IN V10f: the registry is the durable cross-system record, so the
  -- link must land there too rather than only in the staging inbox.
  insert into client_system_links
    (client_id, system, external_id, external_name, link_status, payload, linked_by, last_seen_at)
  values (v_client, 'vyom', p_source_client_id::text, v_source.source_name, 'linked',
          coalesce(v_source.source_payload, '{}'::jsonb), auth.uid(), now())
  on conflict (system, external_id) do update
    set client_id     = excluded.client_id,
        external_name = coalesce(excluded.external_name, client_system_links.external_name),
        link_status   = 'linked',
        last_seen_at  = now();

  perform pravah_audit(v_client, 'client_link', v_source.id::text, 'linked_to_vyom',
    jsonb_build_object('vyom_client_id', p_source_client_id, 'source_name', v_source.source_name));

  return v_client;
end;
$$;

revoke all on function pravah_link_vyom_client(uuid,uuid) from public, anon;
grant execute on function pravah_link_vyom_client(uuid,uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════
-- PART B — repair the existing gap
-- ═══════════════════════════════════════════════════════════════════
insert into client_system_links
  (client_id, system, external_id, external_name, link_status, payload, linked_at, linked_by, last_seen_at)
select s.linked_client_id, 'vyom', s.source_client_id::text, s.source_name, 'linked',
       coalesce(s.source_payload, '{}'::jsonb),
       coalesce(s.linked_at, now()), s.linked_by, coalesce(s.last_seen_at, now())
  from pravah_client_sync_inbox s
 where s.status = 'linked'
   and s.linked_client_id is not null
   and s.source_client_id is not null
on conflict (system, external_id) do nothing;

-- ═══════════════════════════════════════════════════════════════════
-- PART C — a check that makes future drift visible instead of silent
-- ═══════════════════════════════════════════════════════════════════
create or replace view pravah_v_registry_drift
with (security_invoker = true) as
select
  s.source_system,
  s.source_client_id,
  s.source_name,
  s.linked_client_id,
  c.business_name,
  'linked in sync inbox but absent from client_system_links'::text as issue
from pravah_client_sync_inbox s
left join clients c on c.id = s.linked_client_id
where s.status = 'linked'
  and s.linked_client_id is not null
  and not exists (
    select 1 from client_system_links l
     where l.system = s.source_system
       and l.external_id = s.source_client_id::text
  );

grant select on pravah_v_registry_drift to authenticated;

comment on view pravah_v_registry_drift is
  'Should always be empty. Any row means a Vyom link reached the staging inbox but not the canonical registry.';

-- Verification — both counts must match, and the drift view must be empty:
--   select (select count(*) from pravah_client_sync_inbox where status='linked') inbox,
--          (select count(*) from client_system_links where system='vyom') registry,
--          (select count(*) from pravah_v_registry_drift) drift;
