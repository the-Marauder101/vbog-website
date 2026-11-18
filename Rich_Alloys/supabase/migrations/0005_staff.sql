-- Staff directory. `profiles` becomes the one readable list of who has access:
-- name, login email, role, plant, active, created. Open it in Supabase > Table Editor > profiles.
-- Passwords are never stored here or anywhere readable: Supabase keeps only a one-way hash.
-- Logins are created, reset and switched off from the app's Staff screen through the
-- `staff-admin` edge function (supabase/functions/staff-admin), which alone holds the service key.

alter table profiles
  add column email text unique,
  add column active boolean not null default true,
  add column created_at timestamptz not null default now();

update profiles p set email = u.email from auth.users u where u.id = p.id and p.email is null;

-- A switched-off person reads nothing and can do nothing, even with a session still open.
create or replace function my_role() returns text
language sql stable security definer set search_path = public as
$$ select role from profiles where id = auth.uid() and active $$;

create or replace function is_staff() returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from profiles where id = auth.uid() and active) $$;

-- Must match MANAGERS in supabase/functions/staff-admin/index.ts and canManageStaff in web/src/types.ts.
-- Placeholder until Himanshu confirms who may add staff.
create or replace function can_manage_staff() returns boolean
language sql stable security definer set search_path = public as
$$ select coalesce(my_role() in ('owner','vbog_admin'), false) $$;

revoke execute on function can_manage_staff() from public, anon;
grant execute on function can_manage_staff() to authenticated;
