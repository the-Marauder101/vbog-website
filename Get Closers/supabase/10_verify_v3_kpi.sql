-- Pravah V3 verification. Run after 08_v3_kpi_engine.sql and 09_v3_kpi_operations.sql.
select to_regclass('public.pravah_kra_definitions') is not null as kra_table;
select to_regclass('public.pravah_kpi_definitions') is not null as kpi_table;
select to_regclass('public.pravah_company_targets') is not null as company_target_table;
select to_regclass('public.pravah_selection_reviews') is not null as selection_table;
select to_regclass('public.pravah_insights') is not null as insights_table;
select to_regclass('public.pravah_interventions') is not null as interventions_table;
select to_regclass('public.pravah_scorecards') is not null as scorecards_table;
select to_regclass('public.pravah_kpi_overrides') is not null as overrides_table;
select count(*) as kra_count from pravah_kra_definitions where active;
select count(*) as kpi_count from pravah_kpi_definitions where active;
select sum(weight_pct) as kra_weight_total from pravah_kra_definitions where active;
select kra_code, sum(weight_pct) as kpi_weight_total from pravah_kpi_definitions where active group by kra_code order by kra_code;
select has_function_privilege('anon','public.pravah_kpi_dashboard(date,date,uuid)','execute') as anon_can_execute;
select has_function_privilege('authenticated','public.pravah_kpi_dashboard(date,date,uuid)','execute') as authenticated_can_execute;
select has_table_privilege('anon','public.pravah_scorecards','select') as anon_can_read_scorecards;
select has_table_privilege('authenticated','public.pravah_scorecards','select') as authenticated_can_read_scorecards;
select relname, relrowsecurity, relforcerowsecurity from pg_class where relname in ('pravah_kra_definitions','pravah_kpi_definitions','pravah_company_targets','pravah_selection_reviews','pravah_insights','pravah_interventions','pravah_scorecards','pravah_kpi_overrides') order by relname;
