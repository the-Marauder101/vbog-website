-- Migration 23: V8b — Lead tags
-- Adds a tags array to leads and updates the client update RPC.

-- 1. Add tags column
alter table pravah_revenue_leads
  add column if not exists tags text[] not null default '{}';

create index if not exists idx_revenue_leads_tags
  on pravah_revenue_leads using gin (tags);

-- 2. Replace client update lead RPC to accept tags
create or replace function pravah_client_update_lead(
  p_lead_id   uuid,
  p_stage     text    default null,
  p_notes     text    default null,
  p_email     text    default null,
  p_phone     text    default null,
  p_tags      text[]  default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_client uuid;
begin
  select m.client_id into v_client
    from pravah_memberships m
   where m.auth_uid = auth.uid() and m.active and m.role = 'client_admin'
   limit 1;
  if v_client is null then raise exception 'Not a client admin'; end if;

  if not exists (
    select 1 from pravah_revenue_leads
     where id = p_lead_id and client_id = v_client
  ) then raise exception 'Lead not found or does not belong to your client'; end if;

  update pravah_revenue_leads set
    stage            = coalesce(p_stage, stage),
    notes            = coalesce(p_notes, notes),
    email            = coalesce(p_email, email),
    phone            = coalesce(p_phone, phone),
    tags             = coalesce(p_tags, tags),
    last_activity_at = now()
  where id = p_lead_id;
end;
$$;

revoke all on function pravah_client_update_lead(uuid,text,text,text,text,text[]) from public, anon;
grant execute on function pravah_client_update_lead(uuid,text,text,text,text,text[]) to authenticated;
