-- Pravah V4 verification. Run after 11_v4_revenue_engine.sql.
-- Expected: all canonical revenue tables exist, RLS is forced, stages are seeded,
-- and write/dashboard RPCs are executable by authenticated users.

select c.relname as table_name,
       c.relrowsecurity as rls_enabled,
       c.relforcerowsecurity as forced_rls
from pg_class c
join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public'
  and c.relname in (
    'pravah_revenue_stages','pravah_revenue_leads','pravah_revenue_activities',
    'pravah_revenue_deals','pravah_revenue_sales','pravah_revenue_payments',
    'pravah_revenue_adjustments'
  )
order by c.relname;

select code,label,sort_order,terminal,active
from pravah_revenue_stages
order by sort_order;

select proname
from pg_proc p
join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and proname in (
    'pravah_revenue_create_lead','pravah_revenue_log_activity',
    'pravah_revenue_create_deal','pravah_revenue_record_sale',
    'pravah_revenue_record_payment','pravah_revenue_verify_payment',
    'pravah_revenue_record_adjustment','pravah_revenue_dashboard'
  )
order by proname;

select tablename,policyname,cmd
from pg_policies
where schemaname='public'
  and tablename like 'pravah_revenue_%'
order by tablename,policyname;

select count(*) as expected_stage_count
from pravah_revenue_stages
where active;
