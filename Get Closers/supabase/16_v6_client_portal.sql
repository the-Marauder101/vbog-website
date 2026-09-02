-- Pravah V6 — client and closer portal.
-- Run after V1–V5 Pravah migrations. Safe to re-run.
-- V6 activates the dormant client_admin / client_viewer roles,
-- adds a closer membership role, builds an invitation workflow,
-- and opens scoped read access via RLS for external users.

create extension if not exists pgcrypto;

-- ═══ 1. EXPAND MEMBERSHIP ROLES ═════════════════════════════════════════════
-- Add 'closer' as a valid membership role. Closers are tied to a specific
-- client (via their placement), so client_id is required just like
-- client_admin / client_viewer.

alter table pravah_memberships
  drop constraint if exists pravah_memberships_role_check;
alter table pravah_memberships
  add constraint pravah_memberships_role_check
  check (role in (
    'gc_admin','operations','trainer','client_success',
    'client_admin','client_viewer','closer'
  ));

-- The existing row-level check enforces client_id presence for non-internal
-- roles. Extend it to include 'closer'.
alter table pravah_memberships
  drop constraint if exists pravah_memberships_check;
alter table pravah_memberships
  add constraint pravah_memberships_check check (
    (role in ('gc_admin','operations','trainer','client_success') and client_id is null)
    or (role in ('client_admin','client_viewer','closer') and client_id is not null)
  );

-- Closer memberships may also need a placement reference for scoping.
-- We add it as nullable — client_admin/client_viewer don't need it.
alter table pravah_memberships
  add column if not exists placement_id uuid references placements(id) on delete set null;

-- ═══ 2. INVITATIONS TABLE ═══════════════════════════════════════════════════

create table if not exists pravah_invitations (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references clients(id) on delete cascade,
  email       text not null,
  role        text not null check (role in ('client_admin','client_viewer','closer')),
  token       text unique not null default encode(gen_random_bytes(32), 'hex'),
  placement_id uuid references placements(id) on delete set null,
  invited_by  uuid not null default auth.uid(),
  accepted_at timestamptz,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now(),
  unique (client_id, email)
);

create index if not exists pravah_invitations_token_idx on pravah_invitations(token) where accepted_at is null and revoked_at is null;
create index if not exists pravah_invitations_client_idx on pravah_invitations(client_id, created_at desc);

alter table pravah_invitations enable row level security;
alter table pravah_invitations force row level security;
revoke all on pravah_invitations from anon, authenticated;
grant select on pravah_invitations to authenticated;

drop policy if exists pravah_invitations_internal_read on pravah_invitations;
create policy pravah_invitations_internal_read on pravah_invitations for select to authenticated
  using (pravah_is_internal());

drop policy if exists pravah_invitations_internal_write on pravah_invitations;
create policy pravah_invitations_internal_write on pravah_invitations for all to authenticated
  using (pravah_is_internal()) with check (pravah_is_internal());

-- ═══ 3. HELPER FUNCTIONS ════════════════════════════════════════════════════

-- Restore pravah_can_access_client to honour client memberships.
-- V2a narrowed this to internal-only; V6 re-opens it for portal roles.
create or replace function pravah_can_access_client(p_client_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select pravah_is_internal() or exists (
    select 1 from pravah_memberships
    where auth_uid = auth.uid() and client_id = p_client_id and active
      and role in ('client_admin','client_viewer','closer')
  );
$$;

-- Return TRUE if the caller holds a client-side role for the given client.
create or replace function pravah_is_client_role(p_client_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from pravah_memberships
    where auth_uid = auth.uid() and client_id = p_client_id and active
      and role in ('client_admin','client_viewer')
  );
$$;

-- Return TRUE if the caller is client_admin for the given client.
create or replace function pravah_is_client_admin(p_client_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from pravah_memberships
    where auth_uid = auth.uid() and client_id = p_client_id and active
      and role = 'client_admin'
  );
$$;

-- Return all placement IDs the caller owns as a closer.
-- A closer's membership row carries placement_id; fall back to matching
-- via candidate.email = auth.email (if candidates ever get auth accounts).
create or replace function pravah_my_placement_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select m.placement_id
  from pravah_memberships m
  where m.auth_uid = auth.uid()
    and m.active
    and m.role = 'closer'
    and m.placement_id is not null;
$$;

-- Return the single client_id a closer/client user is scoped to (first match).
create or replace function pravah_my_client_id() returns uuid
language sql stable security definer set search_path = public as $$
  select client_id from pravah_memberships
  where auth_uid = auth.uid() and active
    and role in ('client_admin','client_viewer','closer')
  limit 1;
$$;

do $$
begin
  revoke all on function pravah_is_client_role(uuid)  from public;
  revoke all on function pravah_is_client_admin(uuid) from public;
  revoke all on function pravah_my_placement_ids()    from public;
  revoke all on function pravah_my_client_id()        from public;
  grant execute on function pravah_is_client_role(uuid)  to authenticated;
  grant execute on function pravah_is_client_admin(uuid) to authenticated;
  grant execute on function pravah_my_placement_ids()    to authenticated;
  grant execute on function pravah_my_client_id()        to authenticated;
end $$;

-- ═══ 4. UPGRADE pravah_context FOR PORTAL USERS ═════════════════════════════

create or replace function pravah_context() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_internal pravah_memberships%rowtype;
  v_external pravah_memberships%rowtype;
begin
  -- Try internal membership first (existing behaviour).
  select * into v_internal from pravah_memberships
  where auth_uid = auth.uid() and active and client_id is null
  order by case role when 'gc_admin' then 0 else 1 end
  limit 1;

  if v_internal.id is not null then
    return jsonb_build_object(
      'authorized', true,
      'role', v_internal.role,
      'display_name', coalesce(v_internal.display_name, v_internal.role),
      'client_id', null,
      'is_internal', true,
      'is_admin', v_internal.role = 'gc_admin'
    );
  end if;

  -- Try external (client/closer) membership.
  select * into v_external from pravah_memberships
  where auth_uid = auth.uid() and active and client_id is not null
  order by case role when 'client_admin' then 0 when 'client_viewer' then 1 else 2 end
  limit 1;

  if v_external.id is not null then
    return jsonb_build_object(
      'authorized', true,
      'role', v_external.role,
      'display_name', coalesce(v_external.display_name, v_external.role),
      'client_id', v_external.client_id,
      'is_internal', false,
      'is_admin', false,
      'is_client_admin', v_external.role = 'client_admin',
      'is_closer', v_external.role = 'closer',
      'placement_id', v_external.placement_id
    );
  end if;

  return jsonb_build_object('authorized', false, 'portal_status', 'not_activated');
end $$;

-- ═══ 5. CLIENT-SCOPED READ POLICIES ════════════════════════════════════════
-- For tables that already have pravah_client_read via pravah_can_access_client,
-- the restored function already covers client_admin/client_viewer/closer.
-- Tables in V1 core (pravah_client_profiles, pravah_training, etc.) already
-- have: policy pravah_client_read USING (pravah_can_access_client(client_id))
-- so those will start working for portal users automatically.
--
-- Revenue tables (V4) only have internal-read policies — add client read.

do $$
declare t text;
begin
  foreach t in array array[
    'pravah_revenue_leads','pravah_revenue_activities','pravah_revenue_deals',
    'pravah_revenue_sales','pravah_revenue_payments','pravah_revenue_adjustments'
  ] loop
    execute format('drop policy if exists pravah_revenue_%s_client_read on %I', replace(t,'pravah_revenue_',''), t);
    execute format(
      'create policy pravah_revenue_%s_client_read on %I for select to authenticated using (
        exists (
          select 1 from pravah_memberships m
          where m.auth_uid = auth.uid() and m.active
            and m.client_id = %I.client_id
            and m.role in (''client_admin'',''client_viewer'')
        )
      )', replace(t,'pravah_revenue_',''), t, t
    );
  end loop;
end $$;

-- Revenue stages are a shared taxonomy — make them readable by all authenticated.
drop policy if exists pravah_revenue_stages_portal_read on pravah_revenue_stages;
create policy pravah_revenue_stages_portal_read on pravah_revenue_stages
  for select to authenticated using (true);

-- Import tables: add client-read policies (read-only, client_admin/viewer only).
do $$
declare t text;
begin
  foreach t in array array['pravah_import_profiles','pravah_import_batches','pravah_import_rows','pravah_import_replays'] loop
    execute format('drop policy if exists pravah_%s_client_read on %I', replace(t,'pravah_',''), t);
  end loop;
end $$;

-- pravah_import_profiles has client_id directly.
drop policy if exists pravah_import_profiles_client_read on pravah_import_profiles;
create policy pravah_import_profiles_client_read on pravah_import_profiles for select to authenticated
  using (
    exists (
      select 1 from pravah_memberships m
      where m.auth_uid = auth.uid() and m.active
        and m.client_id = pravah_import_profiles.client_id
        and m.role in ('client_admin','client_viewer')
    )
  );

-- ═══ 6. CLOSER-SCOPED READ POLICIES ════════════════════════════════════════
-- Closers can read their own placement-scoped data.

-- placement_states: closer sees their own placement row.
drop policy if exists pravah_placement_state_closer_read on pravah_placement_states;
create policy pravah_placement_state_closer_read on pravah_placement_states for select to authenticated
  using (placement_id in (select pravah_my_placement_ids()));

-- training: closer sees their own training records.
drop policy if exists pravah_training_closer_read on pravah_training;
create policy pravah_training_closer_read on pravah_training for select to authenticated
  using (placement_id in (select pravah_my_placement_ids()));

-- targets: closer sees their own targets.
drop policy if exists pravah_targets_closer_read on pravah_targets;
create policy pravah_targets_closer_read on pravah_targets for select to authenticated
  using (placement_id in (select pravah_my_placement_ids()));

-- performance_reports: closer sees their own reports.
drop policy if exists pravah_reports_closer_read on pravah_performance_reports;
create policy pravah_reports_closer_read on pravah_performance_reports for select to authenticated
  using (placement_id in (select pravah_my_placement_ids()));

-- revenue_leads: closer sees leads they own.
drop policy if exists pravah_revenue_leads_closer_read on pravah_revenue_leads;
create policy pravah_revenue_leads_closer_read on pravah_revenue_leads for select to authenticated
  using (owner_placement_id in (select pravah_my_placement_ids()));

-- revenue_activities: closer sees activities for their placement.
drop policy if exists pravah_revenue_activities_closer_read on pravah_revenue_activities;
create policy pravah_revenue_activities_closer_read on pravah_revenue_activities for select to authenticated
  using (placement_id in (select pravah_my_placement_ids()));

-- revenue_deals: closer sees deals for their placement.
drop policy if exists pravah_revenue_deals_closer_read on pravah_revenue_deals;
create policy pravah_revenue_deals_closer_read on pravah_revenue_deals for select to authenticated
  using (placement_id in (select pravah_my_placement_ids()));

-- revenue_sales: closer sees sales for their placement.
drop policy if exists pravah_revenue_sales_closer_read on pravah_revenue_sales;
create policy pravah_revenue_sales_closer_read on pravah_revenue_sales for select to authenticated
  using (placement_id in (select pravah_my_placement_ids()));

-- ═══ 7. INVITATION FUNCTIONS ════════════════════════════════════════════════

create or replace function pravah_create_invitation(
  p_client_id uuid,
  p_email text,
  p_role text,
  p_placement_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_inv pravah_invitations%rowtype;
begin
  -- Only gc_admin can create invitations.
  if not pravah_is_admin() then
    raise exception 'Admin access required to create invitations.';
  end if;
  if not exists (select 1 from clients where id = p_client_id) then
    raise exception 'Client does not exist.';
  end if;
  if p_role not in ('client_admin','client_viewer','closer') then
    raise exception 'Invalid invitation role. Must be client_admin, client_viewer, or closer.';
  end if;
  if p_role = 'closer' and p_placement_id is null then
    raise exception 'Closer invitations require a placement_id.';
  end if;
  if p_placement_id is not null and not exists (
    select 1 from placements p join requirements r on r.id = p.requirement_id
    where p.id = p_placement_id and r.client_id = p_client_id
  ) then
    raise exception 'Placement does not belong to this client.';
  end if;

  -- Upsert: if already invited and not yet accepted/revoked, return existing.
  select * into v_inv from pravah_invitations
  where client_id = p_client_id and email = lower(trim(p_email));

  if v_inv.id is not null then
    if v_inv.accepted_at is not null then
      raise exception 'This email has already accepted an invitation for this client.';
    end if;
    if v_inv.revoked_at is not null then
      -- Re-invite: clear revocation, refresh token and role.
      update pravah_invitations set
        revoked_at = null,
        role = p_role,
        placement_id = p_placement_id,
        token = encode(gen_random_bytes(32), 'hex'),
        invited_by = auth.uid(),
        created_at = now()
      where id = v_inv.id
      returning * into v_inv;
    else
      -- Pending invite exists — update role if changed.
      update pravah_invitations set
        role = p_role,
        placement_id = p_placement_id,
        invited_by = auth.uid()
      where id = v_inv.id
      returning * into v_inv;
    end if;
  else
    insert into pravah_invitations(client_id, email, role, placement_id)
    values (p_client_id, lower(trim(p_email)), p_role, p_placement_id)
    returning * into v_inv;
  end if;

  insert into pravah_audit_events(client_id, entity_type, entity_id, action, actor_uid, payload)
  values (p_client_id, 'invitation', v_inv.id::text, 'create', auth.uid(),
    jsonb_build_object('email', v_inv.email, 'role', v_inv.role, 'token', v_inv.token));

  return jsonb_build_object(
    'id', v_inv.id,
    'token', v_inv.token,
    'email', v_inv.email,
    'role', v_inv.role,
    'client_id', v_inv.client_id
  );
end $$;

create or replace function pravah_accept_invitation(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_inv pravah_invitations%rowtype;
  v_membership_id uuid;
  v_display text;
begin
  select * into v_inv from pravah_invitations
  where token = p_token and accepted_at is null and revoked_at is null;

  if v_inv.id is null then
    raise exception 'Invalid or expired invitation token.';
  end if;

  -- Check the caller's email matches the invitation.
  if lower(auth.jwt()->>'email') <> lower(v_inv.email) then
    raise exception 'This invitation was sent to a different email address.';
  end if;

  -- Mark invitation as accepted.
  update pravah_invitations set accepted_at = now() where id = v_inv.id;

  -- Create or reactivate membership.
  v_display := coalesce(auth.jwt()->'user_metadata'->>'full_name', auth.jwt()->>'email');

  -- Check for existing membership for this user + client.
  select id into v_membership_id from pravah_memberships
  where auth_uid = auth.uid() and client_id = v_inv.client_id;

  if v_membership_id is not null then
    update pravah_memberships set
      role = v_inv.role,
      placement_id = v_inv.placement_id,
      active = true,
      display_name = coalesce(display_name, v_display)
    where id = v_membership_id;
  else
    insert into pravah_memberships(auth_uid, client_id, role, placement_id, display_name)
    values (auth.uid(), v_inv.client_id, v_inv.role, v_inv.placement_id, v_display)
    returning id into v_membership_id;
  end if;

  insert into pravah_audit_events(client_id, entity_type, entity_id, action, actor_uid, payload)
  values (v_inv.client_id, 'invitation', v_inv.id::text, 'accept', auth.uid(),
    jsonb_build_object('membership_id', v_membership_id, 'role', v_inv.role));

  return jsonb_build_object(
    'accepted', true,
    'role', v_inv.role,
    'client_id', v_inv.client_id,
    'membership_id', v_membership_id
  );
end $$;

create or replace function pravah_list_invitations(p_client_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not pravah_is_admin() and not pravah_is_client_admin(p_client_id) then
    raise exception 'Admin access required to list invitations.';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', i.id,
      'email', i.email,
      'role', i.role,
      'placement_id', i.placement_id,
      'status', case
        when i.revoked_at is not null then 'revoked'
        when i.accepted_at is not null then 'accepted'
        else 'pending'
      end,
      'created_at', i.created_at,
      'accepted_at', i.accepted_at,
      'revoked_at', i.revoked_at
    ) order by i.created_at desc)
    from pravah_invitations i
    where i.client_id = p_client_id
  ), '[]'::jsonb);
end $$;

create or replace function pravah_revoke_invitation(p_invitation_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_inv pravah_invitations%rowtype;
begin
  if not pravah_is_admin() then
    raise exception 'Admin access required to revoke invitations.';
  end if;

  select * into v_inv from pravah_invitations where id = p_invitation_id;
  if v_inv.id is null then raise exception 'Invitation not found.'; end if;
  if v_inv.accepted_at is not null then raise exception 'Cannot revoke an already-accepted invitation.'; end if;
  if v_inv.revoked_at is not null then return; end if; -- already revoked

  update pravah_invitations set revoked_at = now() where id = p_invitation_id;

  insert into pravah_audit_events(client_id, entity_type, entity_id, action, actor_uid, payload)
  values (v_inv.client_id, 'invitation', v_inv.id::text, 'revoke', auth.uid(), '{}');
end $$;

do $$
begin
  revoke all on function pravah_create_invitation(uuid,text,text,uuid) from public;
  revoke all on function pravah_accept_invitation(text) from public;
  revoke all on function pravah_list_invitations(uuid) from public;
  revoke all on function pravah_revoke_invitation(uuid) from public;
  grant execute on function pravah_create_invitation(uuid,text,text,uuid) to authenticated;
  grant execute on function pravah_accept_invitation(text) to authenticated;
  grant execute on function pravah_list_invitations(uuid) to authenticated;
  grant execute on function pravah_revoke_invitation(uuid) to authenticated;
end $$;

-- ═══ 8. CLIENT PORTAL DASHBOARD ═════════════════════════════════════════════

create or replace function pravah_client_portal() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_client_id uuid;
  v_role text;
begin
  select m.client_id, m.role into v_client_id, v_role
  from pravah_memberships m
  where m.auth_uid = auth.uid() and m.active
    and m.role in ('client_admin','client_viewer')
  limit 1;

  if v_client_id is null then
    return jsonb_build_object('authorized', false);
  end if;

  return jsonb_build_object(
    'authorized', true,
    'role', v_role,
    'client_id', v_client_id,
    'client_name', (select c.business_name from clients c where c.id = v_client_id),
    'active_closers', (
      select count(distinct t.placement_id)
      from pravah_training t
      left join pravah_placement_states ps on ps.placement_id = t.placement_id
      where t.client_id = v_client_id
        and t.status in ('active','passed')
        and coalesce(ps.state, 'active') = 'active'
    ),
    'total_revenue', (
      select coalesce(sum(s.net_amount), 0)
      from pravah_revenue_sales s
      where s.client_id = v_client_id and s.status = 'booked'
    ),
    'total_cash', (
      select coalesce(sum(py.amount), 0)
      from pravah_revenue_payments py
      where py.client_id = v_client_id and py.status = 'verified'
    ),
    'active_leads', (
      select count(*)
      from pravah_revenue_leads l
      where l.client_id = v_client_id and l.status = 'active'
    ),
    'open_deals', (
      select count(*)
      from pravah_revenue_deals d
      where d.client_id = v_client_id and d.status = 'open'
    ),
    'open_actions', (
      select count(*)
      from pravah_actions a
      where a.client_id = v_client_id and a.status not in ('done','cancelled')
    ),
    'recent_checkins', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ci.id,
        'occurred_at', ci.occurred_at,
        'health', ci.health,
        'summary', ci.summary
      ) order by ci.occurred_at desc)
      from (
        select * from pravah_client_checkins
        where client_id = v_client_id
        order by occurred_at desc limit 5
      ) ci
    ), '[]'::jsonb),
    'mtd_revenue', (
      select coalesce(sum(s.net_amount), 0)
      from pravah_revenue_sales s
      where s.client_id = v_client_id
        and s.status = 'booked'
        and s.sale_date >= date_trunc('month', current_date)::date
    ),
    'mtd_cash', (
      select coalesce(sum(py.amount), 0)
      from pravah_revenue_payments py
      where py.client_id = v_client_id
        and py.status = 'verified'
        and py.payment_date >= date_trunc('month', current_date)::date
    )
  );
end $$;

revoke all on function pravah_client_portal() from public;
grant execute on function pravah_client_portal() to authenticated;

-- ═══ 9. CLOSER PORTAL DASHBOARD ═════════════════════════════════════════════

create or replace function pravah_closer_portal() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_membership pravah_memberships%rowtype;
  v_placement_id uuid;
  v_client_id uuid;
begin
  select * into v_membership from pravah_memberships
  where auth_uid = auth.uid() and active and role = 'closer'
  limit 1;

  if v_membership.id is null then
    return jsonb_build_object('authorized', false);
  end if;

  v_placement_id := v_membership.placement_id;
  v_client_id := v_membership.client_id;

  return jsonb_build_object(
    'authorized', true,
    'role', 'closer',
    'client_id', v_client_id,
    'placement_id', v_placement_id,
    'client_name', (select c.business_name from clients c where c.id = v_client_id),
    'closer_name', coalesce(v_membership.display_name, 'Closer'),
    'placement_state', (
      select coalesce(ps.state, 'active')
      from pravah_placement_states ps where ps.placement_id = v_placement_id
    ),
    'training_status', (
      select coalesce(t.status, 'not_started')
      from pravah_training t where t.placement_id = v_placement_id
    ),
    'active_leads', (
      select count(*)
      from pravah_revenue_leads l
      where l.owner_placement_id = v_placement_id and l.status = 'active'
    ),
    'total_sales', (
      select count(*)
      from pravah_revenue_sales s
      where s.placement_id = v_placement_id and s.status = 'booked'
    ),
    'total_revenue', (
      select coalesce(sum(s.net_amount), 0)
      from pravah_revenue_sales s
      where s.placement_id = v_placement_id and s.status = 'booked'
    ),
    'total_cash', (
      select coalesce(sum(py.amount), 0)
      from pravah_revenue_payments py
      join pravah_revenue_sales s on s.id = py.sale_id
      where s.placement_id = v_placement_id and py.status = 'verified'
    ),
    'mtd_revenue', (
      select coalesce(sum(s.net_amount), 0)
      from pravah_revenue_sales s
      where s.placement_id = v_placement_id
        and s.status = 'booked'
        and s.sale_date >= date_trunc('month', current_date)::date
    ),
    'current_targets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', tg.id,
        'period_start', tg.period_start,
        'period_end', tg.period_end,
        'target_value', tg.target_value,
        'target_unit', tg.target_unit,
        'currency', tg.currency
      ) order by tg.period_start desc)
      from (
        select * from pravah_targets
        where placement_id = v_placement_id
          and period_end >= current_date
        order by period_start desc limit 3
      ) tg
    ), '[]'::jsonb),
    'recent_activities', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id,
        'activity_type', a.activity_type,
        'occurred_at', a.occurred_at,
        'outcome', a.outcome,
        'lead_name', l.full_name
      ) order by a.occurred_at desc)
      from (
        select * from pravah_revenue_activities
        where placement_id = v_placement_id
        order by occurred_at desc limit 10
      ) a
      join pravah_revenue_leads l on l.id = a.lead_id
    ), '[]'::jsonb)
  );
end $$;

revoke all on function pravah_closer_portal() from public;
grant execute on function pravah_closer_portal() to authenticated;

-- ═══ 10. CLIENT WRITE FUNCTIONS ═════════════════════════════════════════════
-- client_admin can create leads and log activities for their client.

create or replace function pravah_client_create_lead(
  p_full_name text,
  p_email text default null,
  p_phone text default null,
  p_company_name text default null,
  p_source text default null,
  p_notes text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_client_id uuid;
  v_id uuid;
begin
  select m.client_id into v_client_id from pravah_memberships m
  where m.auth_uid = auth.uid() and m.active and m.role = 'client_admin'
  limit 1;

  if v_client_id is null then
    raise exception 'Client admin access required.';
  end if;

  insert into pravah_revenue_leads(
    client_id, full_name, email, phone, company_name, source, notes,
    source_system, created_by
  )
  values (
    v_client_id, trim(p_full_name), nullif(trim(p_email),''), nullif(trim(p_phone),''),
    nullif(trim(p_company_name),''), nullif(trim(p_source),''), p_notes,
    'client_portal', auth.uid()
  )
  returning id into v_id;

  insert into pravah_audit_events(client_id, entity_type, entity_id, action, actor_uid, payload)
  values (v_client_id, 'revenue_lead', v_id::text, 'create', auth.uid(),
    jsonb_build_object('source_system', 'client_portal'));

  return v_id;
end $$;

create or replace function pravah_client_log_activity(
  p_lead_id uuid,
  p_activity_type text,
  p_occurred_at timestamptz default now(),
  p_outcome text default null,
  p_duration_seconds int default null,
  p_notes text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_client_id uuid;
  v_lead_client uuid;
  v_id uuid;
begin
  select m.client_id into v_client_id from pravah_memberships m
  where m.auth_uid = auth.uid() and m.active and m.role = 'client_admin'
  limit 1;

  if v_client_id is null then
    raise exception 'Client admin access required.';
  end if;

  select client_id into v_lead_client from pravah_revenue_leads where id = p_lead_id;
  if v_lead_client is null or v_lead_client <> v_client_id then
    raise exception 'Lead does not belong to your client.';
  end if;

  insert into pravah_revenue_activities(
    client_id, lead_id, activity_type, occurred_at, outcome,
    duration_seconds, notes, source_system, created_by
  )
  values (
    v_client_id, p_lead_id, p_activity_type, p_occurred_at, p_outcome,
    p_duration_seconds, p_notes, 'client_portal', auth.uid()
  )
  returning id into v_id;

  update pravah_revenue_leads
  set last_activity_at = p_occurred_at,
      first_contact_at = coalesce(first_contact_at, p_occurred_at),
      updated_at = now()
  where id = p_lead_id;

  insert into pravah_audit_events(client_id, entity_type, entity_id, action, actor_uid, payload)
  values (v_client_id, 'revenue_activity', v_id::text, 'create', auth.uid(),
    jsonb_build_object('lead_id', p_lead_id, 'activity_type', p_activity_type, 'source_system', 'client_portal'));

  return v_id;
end $$;

do $$
begin
  revoke all on function pravah_client_create_lead(text,text,text,text,text,text) from public;
  revoke all on function pravah_client_log_activity(uuid,text,timestamptz,text,int,text) from public;
  grant execute on function pravah_client_create_lead(text,text,text,text,text,text) to authenticated;
  grant execute on function pravah_client_log_activity(uuid,text,timestamptz,text,int,text) to authenticated;
end $$;

-- ═══ 11. ADMIN PORTAL LISTING FUNCTIONS ═════════════════════════════════════

create or replace function pravah_list_portal_memberships() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not pravah_is_admin() then
    raise exception 'Admin access required.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', m.id,
      'email', (select email from auth.users u where u.id = m.auth_uid),
      'display_name', m.display_name,
      'role', m.role,
      'client_id', m.client_id,
      'business_name', coalesce((select c.business_name from clients c where c.id = m.client_id), '—'),
      'placement_id', m.placement_id,
      'created_at', m.created_at
    ) order by m.created_at desc)
    from pravah_memberships m
    where m.active and m.role in ('client_admin','client_viewer','closer')
  ), '[]'::jsonb);
end $$;

create or replace function pravah_list_invitations() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not pravah_is_admin() then
    raise exception 'Admin access required.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', i.id,
      'email', i.email,
      'role', i.role,
      'token', i.token,
      'client_id', i.client_id,
      'business_name', coalesce((select c.business_name from clients c where c.id = i.client_id), '—'),
      'placement_id', i.placement_id,
      'created_at', i.created_at
    ) order by i.created_at desc)
    from pravah_invitations i
    where i.accepted_at is null and i.revoked_at is null
  ), '[]'::jsonb);
end $$;

create or replace function pravah_revoke_portal_membership(p_membership_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_m pravah_memberships%rowtype;
begin
  if not pravah_is_admin() then
    raise exception 'Admin access required.';
  end if;
  select * into v_m from pravah_memberships where id = p_membership_id;
  if v_m.id is null then raise exception 'Membership not found.'; end if;
  if v_m.role not in ('client_admin','client_viewer','closer') then
    raise exception 'Cannot revoke internal memberships from this endpoint.';
  end if;
  update pravah_memberships set active = false where id = p_membership_id;
  insert into pravah_audit_events(client_id, entity_type, entity_id, action, actor_uid, payload)
  values (v_m.client_id, 'membership', v_m.id::text, 'revoke', auth.uid(),
    jsonb_build_object('role', v_m.role));
end $$;

do $$
begin
  revoke all on function pravah_list_portal_memberships() from public;
  revoke all on function pravah_list_invitations() from public;
  revoke all on function pravah_revoke_portal_membership(uuid) from public;
  grant execute on function pravah_list_portal_memberships() to authenticated;
  grant execute on function pravah_list_invitations() to authenticated;
  grant execute on function pravah_revoke_portal_membership(uuid) to authenticated;
end $$;

-- ═══ 12. GRANT TABLE ACCESS FOR FUNCTIONS ══════════════════════════════════
grant insert, update on pravah_invitations to authenticated;
grant insert on pravah_memberships to authenticated;
grant update on pravah_memberships to authenticated;

-- ═══ DONE ═══════════════════════════════════════════════════════════════════
