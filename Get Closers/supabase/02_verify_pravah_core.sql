-- Pravah V1 verification. Every query should return the expected value noted.

-- 1. All Pravah tables have RLS enabled and forced. Expect 9 rows, all true.
select relname, relrowsecurity, relforcerowsecurity
from pg_class
where relname in (
  'pravah_memberships','pravah_client_profiles','pravah_training',
  'pravah_training_checkpoints','pravah_targets','pravah_performance_reports',
  'pravah_client_checkins','pravah_actions','pravah_audit_events'
)
order by relname;

-- 2. No anon table grants. Expect zero rows.
select table_name, privilege_type
from information_schema.role_table_grants
where grantee = 'anon' and table_name like 'pravah_%';

-- 2b. No Pravah function is executable by PUBLIC or anon. Expect zero rows.
select routine_name, grantee, privilege_type
from information_schema.role_routine_grants
where routine_name like 'pravah_%' and grantee in ('PUBLIC','anon');

-- 3. Every active linked Nikash staff user has an internal membership.
-- Expect zero rows after setup.
select s.id, s.email
from staff s
where s.active and s.auth_uid is not null
  and not exists (
    select 1 from pravah_memberships pm
    where pm.auth_uid = s.auth_uid and pm.client_id is null and pm.active
  );

-- 4. No operational record disagrees with its placement's client. Expect 0.
select 'training' as source, count(*) as conflicts
from pravah_training t
where t.client_id <> pravah_resolve_client_for_placement(t.placement_id)
union all
select 'targets', count(*) from pravah_targets t
where t.client_id <> pravah_resolve_client_for_placement(t.placement_id)
union all
select 'reports', count(*) from pravah_performance_reports r
where r.client_id <> pravah_resolve_client_for_placement(r.placement_id);

-- 5. Security-definer functions pin search_path. Expect zero rows.
select p.proname
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like 'pravah_%'
  and p.prosecdef
  and not exists (
    select 1 from unnest(coalesce(p.proconfig, array[]::text[])) x
    where x = 'search_path=public'
  );
