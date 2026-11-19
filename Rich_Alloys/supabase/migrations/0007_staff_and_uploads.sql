-- Staff management from the app, and safe upload retries.
--
-- Staff: profiles becomes the readable staff list (Supabase > Table Editor > profiles): name, login email,
-- role, active, created. Logins are created, reset and switched off from Admin > Staff through the
-- `staff-admin` edge function (supabase/functions/staff-admin), the only code holding the service key.
-- It checks the caller has 'staff_manage'. Passwords are never readable: Supabase keeps a one-way hash.
-- Only admins set or reset passwords; staff cannot change their own (decision 19).
alter table profiles
  add column email text unique,
  add column created_at timestamptz not null default now();
update profiles p set email = u.email from auth.users u where u.id = p.id and p.email is null;

insert into permissions (action, role) values ('staff_manage', 'owner'), ('staff_manage', 'vbog_admin')
on conflict do nothing;

-- Uploads retry on patchy networks. One stored file = one document row, so a retry whose first attempt
-- actually succeeded is recognised (the app treats this violation as "already done").
create unique index documents_storage_path_key on documents (storage_path);
