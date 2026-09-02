-- V2B verification. Every query should return the named objects/values.

select table_name from information_schema.tables
where table_schema = 'public' and table_name in (
  'pravah_candidate_sync_inbox','pravah_integration_events'
) order by table_name;

select table_name from information_schema.views
where table_schema = 'public' and table_name in (
  'pravah_v_candidate_sync_inbox','pravah_v_outcome_checkpoints'
) order by table_name;

select routine_name from information_schema.routines
where routine_schema = 'public' and routine_name in (
  'pravah_link_vyom_candidate','pravah_complete_candidate_handoff','pravah_record_outcome'
) order by routine_name;

select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'placement_outcomes'
  and column_name in ('source_system','confirmed_by')
order by column_name;

select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'pravah_candidate_sync_inbox'
  and column_name = 'status_changed_at';
