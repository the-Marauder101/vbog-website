-- Pravah V6 verification. Run after 16_v6_client_portal.sql.

-- 1. Check pravah_invitations table exists with RLS enabled/forced.
select c.relname as table_name, c.relrowsecurity as rls_enabled, c.relforcerowsecurity as forced_rls
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and c.relname = 'pravah_invitations'
order by c.relname;

-- 2. Check all V6 functions exist and have correct permissions.
select proname,
  has_function_privilege('anon', oid, 'execute') as anon_can_execute,
  has_function_privilege('authenticated', oid, 'execute') as authenticated_can_execute
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in (
    'pravah_create_invitation','pravah_accept_invitation',
    'pravah_list_invitations','pravah_revoke_invitation',
    'pravah_client_portal','pravah_closer_portal',
    'pravah_client_create_lead','pravah_client_log_activity',
    'pravah_list_portal_memberships','pravah_revoke_portal_membership',
    'pravah_is_client_role','pravah_is_client_admin',
    'pravah_my_placement_ids','pravah_my_client_id'
  )
order by proname;

-- 3. Check membership role constraint includes 'closer'.
select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'pravah_memberships'::regclass
  and conname like '%role%';

-- 4. Check placement_id column was added to memberships.
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'pravah_memberships' and column_name = 'placement_id';

-- 5. Check indexes on invitations.
select indexname from pg_indexes
where schemaname = 'public' and tablename = 'pravah_invitations'
order by indexname;

-- 6. Check RLS policies on invitations.
select policyname, cmd from pg_policies
where schemaname = 'public' and tablename = 'pravah_invitations'
order by policyname;

-- 7. Check closer and client read policies exist on key tables.
select tablename, policyname from pg_policies
where schemaname = 'public'
  and (policyname like '%closer_read%' or policyname like '%client_read%')
order by tablename, policyname;
