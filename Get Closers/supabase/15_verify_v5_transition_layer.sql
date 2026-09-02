-- Pravah V5 verification. Run after 14_v5_transition_layer.sql.
select c.relname as table_name,c.relrowsecurity as rls_enabled,c.relforcerowsecurity as forced_rls
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind='r' and c.relname in ('pravah_import_profiles','pravah_import_mapping_versions','pravah_import_batches','pravah_import_rows','pravah_import_replays')
order by c.relname;

select proname,has_function_privilege('anon',oid,'execute') as anon_can_execute,has_function_privilege('authenticated',oid,'execute') as authenticated_can_execute
from pg_proc where pronamespace='public'::regnamespace and proname in ('pravah_import_create_profile','pravah_import_stage_rows','pravah_import_validate_batch','pravah_import_replay_batch') order by proname;

select indexname from pg_indexes where schemaname='public' and tablename in ('pravah_import_profiles','pravah_import_batches','pravah_import_rows','pravah_import_replays') order by indexname;
