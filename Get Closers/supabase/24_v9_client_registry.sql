-- Migration 24: V9 — Unified client registry + portal visibility fix
--
-- Part A fixes the defect where every client/closer portal view returns zero
-- rows because the Nikash-owned tables they join (placements, candidates,
-- requirements) only permit pravah_is_internal() / is_staff().
--
-- Part B promotes `clients` to the canonical client anchor and builds a
-- registry around it so Pravah, Nikash and Vyom resolve one identity.
--
-- Additive only. No table dropped, no column altered, no policy removed.

-- ═══════════════════════════════════════════════════════════════════
-- PART A — Portal visibility fix
-- ═══════════════════════════════════════════════════════════════════

-- A1. Resolver functions.
-- security definer so their internal joins are not subject to the caller's
-- RLS, which would otherwise recurse through the very policies they feed.

-- Placements the caller may see.
--   closer                        -> own placement only
--   client_admin / client_viewer  -> every placement of their client
create or replace function pravah_my_visible_placement_ids()
returns setof uuid
language sql stable security definer set search_path = public as $$
  select m.placement_id
    from pravah_memberships m
   where m.auth_uid = auth.uid() and m.active
     and m.role = 'closer' and m.placement_id is not null
  union
  select p.id
    from placements p
    join requirements r on r.id = p.requirement_id
    join pravah_memberships m on m.client_id = r.client_id
   where m.auth_uid = auth.uid() and m.active
     and m.role in ('client_admin','client_viewer');
$$;

-- Requirements the caller may see.
create or replace function pravah_my_visible_requirement_ids()
returns setof uuid
language sql stable security definer set search_path = public as $$
  select r.id
    from requirements r
    join pravah_memberships m on m.client_id = r.client_id
   where m.auth_uid = auth.uid() and m.active
     and m.role in ('client_admin','client_viewer')
  union
  select p.requirement_id
    from placements p
    join pravah_memberships m on m.placement_id = p.id
   where m.auth_uid = auth.uid() and m.active
     and m.role = 'closer' and p.requirement_id is not null;
$$;

-- Candidates placed against a placement the caller may see.
create or replace function pravah_my_visible_candidate_ids()
returns setof uuid
language sql stable security definer set search_path = public as $$
  select distinct p.candidate_id
    from placements p
   where p.candidate_id is not null
     and p.id in (
       select m.placement_id from pravah_memberships m
        where m.auth_uid = auth.uid() and m.active
          and m.role = 'closer' and m.placement_id is not null
       union
       select p2.id from placements p2
         join requirements r2 on r2.id = p2.requirement_id
         join pravah_memberships m2 on m2.client_id = r2.client_id
        where m2.auth_uid = auth.uid() and m2.active
          and m2.role in ('client_admin','client_viewer')
     );
$$;

revoke all on function pravah_my_visible_placement_ids()   from public, anon;
revoke all on function pravah_my_visible_requirement_ids() from public, anon;
revoke all on function pravah_my_visible_candidate_ids()   from public, anon;
grant execute on function pravah_my_visible_placement_ids()   to authenticated;
grant execute on function pravah_my_visible_requirement_ids() to authenticated;
grant execute on function pravah_my_visible_candidate_ids()   to authenticated;

-- A2. Permissive SELECT policies. These are OR'd with the existing
-- pravah_internal_read and staff_all policies; nothing is revoked.

drop policy if exists pravah_placements_portal_read on placements;
create policy pravah_placements_portal_read on placements
  for select using (id in (select pravah_my_visible_placement_ids()));

drop policy if exists pravah_requirements_portal_read on requirements;
create policy pravah_requirements_portal_read on requirements
  for select using (id in (select pravah_my_visible_requirement_ids()));

drop policy if exists pravah_candidates_portal_read on candidates;
create policy pravah_candidates_portal_read on candidates
  for select using (id in (select pravah_my_visible_candidate_ids()));

-- ═══════════════════════════════════════════════════════════════════
-- PART B — Unified client registry
-- ═══════════════════════════════════════════════════════════════════

-- B1. Canonical client identity, keyed by the existing clients.id anchor.
create table if not exists client_registry (
  client_id             uuid primary key references clients(id) on delete cascade,
  canonical_name        text not null,
  legal_name            text,
  normalized_name       text,
  status                text not null default 'active'
                          check (status in ('prospect','active','paused','churned','archived')),
  lifecycle_stage       text not null default 'onboarding'
                          check (lifecycle_stage in ('prospect','onboarding','live','at_risk','ended')),
  primary_contact_name  text,
  primary_contact_email text,
  primary_contact_phone text,
  country               text,
  reporting_currency    text not null default 'INR',
  origin_system         text not null default 'unknown'
                          check (origin_system in ('vyom','nikash','pravah','import','unknown')),
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists idx_client_registry_normalized on client_registry(normalized_name);
create index if not exists idx_client_registry_status     on client_registry(status);

-- B2. External system identifiers for one registry client.
create table if not exists client_system_links (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references clients(id) on delete cascade,
  system        text not null check (system in ('vyom','nikash','pravah','callyzer','sheets','other')),
  external_id   text not null,
  external_name text,
  link_status   text not null default 'linked'
                  check (link_status in ('linked','pending','conflict','unlinked')),
  payload       jsonb not null default '{}'::jsonb,
  linked_at     timestamptz not null default now(),
  linked_by     uuid,
  last_seen_at  timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  unique (system, external_id)
);

create index if not exists idx_client_system_links_client on client_system_links(client_id);
create index if not exists idx_client_system_links_system on client_system_links(system);

-- B3. Name normalizer, shared with the Vyom matching heuristic.
create or replace function pravah_normalize_client_name(p_name text)
returns text language sql immutable set search_path = public as $$
  select nullif(regexp_replace(lower(coalesce(p_name,'')), '[^a-z0-9]+', '', 'g'), '');
$$;

-- B4. Auto-register every client, whoever creates it.
create or replace function pravah_client_registry_sync()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into client_registry (client_id, canonical_name, normalized_name)
  values (new.id, new.business_name, pravah_normalize_client_name(new.business_name))
  on conflict (client_id) do update
    set canonical_name  = excluded.canonical_name,
        normalized_name = excluded.normalized_name,
        updated_at      = now();
  return new;
end;
$$;

drop trigger if exists trg_client_registry_sync on clients;
create trigger trg_client_registry_sync
  after insert or update of business_name on clients
  for each row execute function pravah_client_registry_sync();

-- B5. Backfill registry from existing clients.
insert into client_registry (client_id, canonical_name, normalized_name, origin_system)
select c.id, c.business_name, pravah_normalize_client_name(c.business_name), 'unknown'
  from clients c
on conflict (client_id) do nothing;

-- B6. Backfill Vyom links from the existing sync inbox, and mark origin.
insert into client_system_links (client_id, system, external_id, external_name, link_status, payload, linked_at, linked_by, last_seen_at)
select s.linked_client_id,
       'vyom',
       s.source_client_id::text,
       s.source_name,
       'linked',
       coalesce(s.source_payload, '{}'::jsonb),
       coalesce(s.linked_at, now()),
       s.linked_by,
       coalesce(s.last_seen_at, now())
  from pravah_client_sync_inbox s
 where s.linked_client_id is not null
   and s.status = 'linked'
   and s.source_client_id is not null
on conflict (system, external_id) do nothing;

update client_registry r
   set origin_system = 'vyom', updated_at = now()
 where origin_system = 'unknown'
   and exists (select 1 from client_system_links l
                where l.client_id = r.client_id and l.system = 'vyom');

-- B7. Every client is its own canonical Nikash/Pravah record.
insert into client_system_links (client_id, system, external_id, external_name, link_status)
select c.id, 'nikash', c.id::text, c.business_name, 'linked' from clients c
on conflict (system, external_id) do nothing;

-- ═══════════════════════════════════════════════════════════════════
-- B8. Data footprint — what we hold for a client, and where
-- ═══════════════════════════════════════════════════════════════════

-- client_users is Nikash-owned and carries only an is_staff() policy, so a
-- Pravah-internal user who is not Nikash staff would read a silent zero
-- through a security_invoker view. Resolve the true count through a definer.
create or replace function pravah_client_nikash_user_count(p_client_id uuid)
returns bigint
language sql stable security definer set search_path = public as $$
  select count(*) from client_users where client_id = p_client_id;
$$;
revoke all on function pravah_client_nikash_user_count(uuid) from public, anon;
grant execute on function pravah_client_nikash_user_count(uuid) to authenticated;

create or replace view pravah_v_client_data_index
with (security_invoker = true) as
select
  c.id   as client_id,
  c.business_name,
  r.status,
  r.lifecycle_stage,
  r.origin_system,
  (select count(*) from requirements q            where q.client_id = c.id) as requirements,
  (select count(*) from placements p
     join requirements q2 on q2.id = p.requirement_id
    where q2.client_id = c.id)                                              as placements,
  (select count(*) from pravah_training t         where t.client_id = c.id) as trainings,
  (select count(*) from pravah_revenue_leads l    where l.client_id = c.id) as leads,
  (select count(*) from pravah_revenue_deals d    where d.client_id = c.id) as deals,
  (select count(*) from pravah_revenue_sales s    where s.client_id = c.id) as sales,
  (select count(*) from pravah_revenue_activities a where a.client_id = c.id) as activities,
  (select count(*) from pravah_import_profiles ip where ip.client_id = c.id) as import_profiles,
  (select count(*) from pravah_client_checkins ci where ci.client_id = c.id) as checkins,
  (select count(*) from pravah_actions ac         where ac.client_id = c.id) as actions,
  (select count(*) from pravah_memberships m      where m.client_id = c.id and m.active) as portal_memberships,
  pravah_client_nikash_user_count(c.id)                                      as nikash_client_users,
  (select coalesce(array_agg(distinct l2.system order by l2.system), '{}')
     from client_system_links l2 where l2.client_id = c.id)                  as linked_systems
from clients c
left join client_registry r on r.client_id = c.id
where pravah_can_access_client(c.id);

-- ═══════════════════════════════════════════════════════════════════
-- B9. RLS
-- ═══════════════════════════════════════════════════════════════════
alter table client_registry     enable row level security;
alter table client_registry     force row level security;
alter table client_system_links enable row level security;
alter table client_system_links force row level security;

drop policy if exists client_registry_internal_all on client_registry;
create policy client_registry_internal_all on client_registry
  for all using (pravah_is_internal()) with check (pravah_is_internal());

drop policy if exists client_registry_client_read on client_registry;
create policy client_registry_client_read on client_registry
  for select using (pravah_can_access_client(client_id));

drop policy if exists client_system_links_internal_all on client_system_links;
create policy client_system_links_internal_all on client_system_links
  for all using (pravah_is_internal()) with check (pravah_is_internal());

drop policy if exists client_system_links_client_read on client_system_links;
create policy client_system_links_client_read on client_system_links
  for select using (pravah_can_access_client(client_id));

-- ═══════════════════════════════════════════════════════════════════
-- B10. Write contracts
-- ═══════════════════════════════════════════════════════════════════

create or replace function pravah_client_registry_upsert(
  p_client_id             uuid,
  p_canonical_name        text default null,
  p_legal_name            text default null,
  p_status                text default null,
  p_lifecycle_stage       text default null,
  p_primary_contact_name  text default null,
  p_primary_contact_email text default null,
  p_primary_contact_phone text default null,
  p_country               text default null,
  p_reporting_currency    text default null,
  p_origin_system         text default null,
  p_notes                 text default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not pravah_is_internal() then raise exception 'Internal access required'; end if;
  if not exists (select 1 from clients where id = p_client_id) then
    raise exception 'Client not found';
  end if;

  insert into client_registry (client_id, canonical_name, normalized_name)
  values (p_client_id,
          coalesce(p_canonical_name, (select business_name from clients where id = p_client_id)),
          pravah_normalize_client_name(coalesce(p_canonical_name, (select business_name from clients where id = p_client_id))))
  on conflict (client_id) do nothing;

  update client_registry set
    canonical_name        = coalesce(p_canonical_name, canonical_name),
    normalized_name       = pravah_normalize_client_name(coalesce(p_canonical_name, canonical_name)),
    legal_name            = coalesce(p_legal_name, legal_name),
    status                = coalesce(p_status, status),
    lifecycle_stage       = coalesce(p_lifecycle_stage, lifecycle_stage),
    primary_contact_name  = coalesce(p_primary_contact_name, primary_contact_name),
    primary_contact_email = coalesce(p_primary_contact_email, primary_contact_email),
    primary_contact_phone = coalesce(p_primary_contact_phone, primary_contact_phone),
    country               = coalesce(p_country, country),
    reporting_currency    = coalesce(p_reporting_currency, reporting_currency),
    origin_system         = coalesce(p_origin_system, origin_system),
    notes                 = coalesce(p_notes, notes),
    updated_at            = now()
  where client_id = p_client_id;
end;
$$;

create or replace function pravah_client_link_system(
  p_client_id     uuid,
  p_system        text,
  p_external_id   text,
  p_external_name text default null,
  p_payload       jsonb default '{}'::jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_existing uuid;
begin
  if not pravah_is_internal() then raise exception 'Internal access required'; end if;
  if not exists (select 1 from clients where id = p_client_id) then
    raise exception 'Client not found';
  end if;

  select client_id into v_existing from client_system_links
   where system = p_system and external_id = p_external_id;
  if v_existing is not null and v_existing <> p_client_id then
    raise exception 'External ID % in system % is already linked to a different client',
      p_external_id, p_system;
  end if;

  insert into client_system_links (client_id, system, external_id, external_name, payload, linked_by)
  values (p_client_id, p_system, p_external_id, p_external_name, coalesce(p_payload,'{}'::jsonb), auth.uid())
  on conflict (system, external_id) do update
    set external_name = coalesce(excluded.external_name, client_system_links.external_name),
        payload       = coalesce(excluded.payload, client_system_links.payload),
        link_status   = 'linked',
        last_seen_at  = now()
  returning id into v_id;

  insert into pravah_audit_events (client_id, actor_uid, entity_type, entity_id, action, payload)
  values (p_client_id, auth.uid(), 'client_system_links', v_id::text, 'client_system_linked',
          jsonb_build_object('system', p_system, 'external_id', p_external_id));

  return v_id;
end;
$$;

create or replace function pravah_client_registry_overview(p_client_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if not (pravah_is_internal() or pravah_can_access_client(p_client_id)) then
    raise exception 'Access denied for this client';
  end if;

  select jsonb_build_object(
    'client_id',    c.id,
    'business_name', c.business_name,
    'identity', coalesce(to_jsonb(r) - 'client_id', '{}'::jsonb),
    'systems', coalesce((
      select jsonb_agg(jsonb_build_object(
               'system', l.system, 'external_id', l.external_id,
               'external_name', l.external_name, 'link_status', l.link_status,
               'last_seen_at', l.last_seen_at) order by l.system)
        from client_system_links l where l.client_id = c.id), '[]'::jsonb),
    'data', jsonb_build_object(
      'requirements',    (select count(*) from requirements q where q.client_id = c.id),
      'placements',      (select count(*) from placements p join requirements q2 on q2.id = p.requirement_id where q2.client_id = c.id),
      'trainings',       (select count(*) from pravah_training t where t.client_id = c.id),
      'leads',           (select count(*) from pravah_revenue_leads le where le.client_id = c.id),
      'deals',           (select count(*) from pravah_revenue_deals d where d.client_id = c.id),
      'sales',           (select count(*) from pravah_revenue_sales s where s.client_id = c.id),
      'activities',      (select count(*) from pravah_revenue_activities a where a.client_id = c.id),
      'import_profiles', (select count(*) from pravah_import_profiles ip where ip.client_id = c.id),
      'checkins',        (select count(*) from pravah_client_checkins ci where ci.client_id = c.id),
      'actions',         (select count(*) from pravah_actions ac where ac.client_id = c.id),
      'portal_memberships',  (select count(*) from pravah_memberships m where m.client_id = c.id and m.active),
      'nikash_client_users', (select count(*) from client_users cu where cu.client_id = c.id)
    )
  ) into v
  from clients c
  left join client_registry r on r.client_id = c.id
  where c.id = p_client_id;

  if v is null then raise exception 'Client not found'; end if;
  return v;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════
-- B11. Grants
-- ═══════════════════════════════════════════════════════════════════
grant select on client_registry, client_system_links, pravah_v_client_data_index to authenticated;

revoke all on function pravah_client_registry_upsert(uuid,text,text,text,text,text,text,text,text,text,text,text) from public, anon;
revoke all on function pravah_client_link_system(uuid,text,text,text,jsonb)  from public, anon;
revoke all on function pravah_client_registry_overview(uuid)                 from public, anon;
revoke all on function pravah_normalize_client_name(text)                    from public, anon;

grant execute on function pravah_client_registry_upsert(uuid,text,text,text,text,text,text,text,text,text,text,text) to authenticated;
grant execute on function pravah_client_link_system(uuid,text,text,text,jsonb) to authenticated;
grant execute on function pravah_client_registry_overview(uuid)                to authenticated;
grant execute on function pravah_normalize_client_name(text)                   to authenticated;
