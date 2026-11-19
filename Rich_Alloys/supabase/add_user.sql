-- First admin only. Everyone else is added in the app: Admin > Staff.
-- First create the person in Supabase: Authentication > Users > Add user (email + password, tick "Auto confirm user").
-- Then edit the three values below and run.
-- Roles: owner, deal_desk, gate, factory, factory_accounts, ho_accounts, vbog_admin
insert into profiles (id, email, full_name, role, plant_id)
select u.id, u.email, 'Full Name', 'vbog_admin', (select id from plants where name = 'Palghar')
from auth.users u
where u.email = 'person@example.com'
on conflict (id) do update set full_name = excluded.full_name, role = excluded.role, email = excluded.email, active = true;
