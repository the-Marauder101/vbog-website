-- Pravah V2A verification. Every query should satisfy its expectation.

-- Expect 2 rows, both RLS enabled and forced.
select relname, relrowsecurity, relforcerowsecurity from pg_class
where relname in ('pravah_client_sync_inbox','pravah_placement_states') order by relname;

-- Expect zero anonymous grants across all Pravah tables/functions.
select table_name, privilege_type from information_schema.role_table_grants
where grantee = 'anon' and table_name like 'pravah_%';
select routine_name, grantee from information_schema.role_routine_grants
where routine_name like 'pravah_%' and grantee in ('PUBLIC','anon');

-- Expect the listed columns.
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'pravah_performance_reports'
  and column_name in ('followups_completed','meetings_booked','verified_cash_collected',
    'cash_verification_status','verification_source','verification_reference',
    'verification_url','verified_at','voided_at','void_reason')
order by column_name;

-- Expect zero: a linked inbox item must have a linked client and timestamp.
select id from pravah_client_sync_inbox
where status = 'linked' and (linked_client_id is null or linked_at is null);

-- Expect zero: verified cash must retain a source and verification timestamp.
select id from pravah_performance_reports
where cash_verification_status = 'verified'
  and (verified_cash_collected is null or verification_source is null or verified_at is null);

-- Expect zero insecure security-definer functions.
select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like 'pravah_%' and p.prosecdef
  and not exists (
    select 1 from unnest(coalesce(p.proconfig, array[]::text[])) x
    where x = 'search_path=public'
  );
