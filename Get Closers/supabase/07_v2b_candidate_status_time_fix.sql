-- Pravah V2B hotfix — retain the source Vyom status-change timestamp.
-- Safe to run whether or not candidate handoffs already exist.

alter table pravah_candidate_sync_inbox
  add column if not exists status_changed_at timestamptz;

update pravah_candidate_sync_inbox
set status_changed_at = coalesce(status_changed_at, last_seen_at, updated_at, created_at)
where status_changed_at is null;

-- PostgreSQL expands `s.*` when a view is created, so adding a base-table
-- column does not make it visible in the already-compiled view. Recreate the
-- view to expose the timestamp used by Pravah's ordered handoff query.
drop view if exists pravah_v_candidate_sync_inbox;
create view pravah_v_candidate_sync_inbox with (security_invoker = true) as
select s.*,
       suggestion.id as suggested_candidate_id,
       suggestion.full_name as suggested_candidate_name,
       linked_candidate.full_name as linked_candidate_name,
       client_link.linked_client_id as resolved_client_id,
       resolved_client.business_name as resolved_client_name,
       case
         when s.source_client_id is null then 'missing_client_on_vyom_card'
         when client_link.linked_client_id is null then 'client_not_linked'
         else 'ready'
       end as client_link_state
from pravah_candidate_sync_inbox s
left join lateral (
  select min(c.id::text)::uuid as id, min(c.full_name) as full_name
  from candidates c
  where regexp_replace(lower(c.full_name), '[^a-z0-9]+', '', 'g') = s.source_name_normalized
  having count(*) = 1
) suggestion on true
left join pravah_client_sync_inbox client_link
  on client_link.source_client_id = s.source_client_id and client_link.status = 'linked'
left join clients resolved_client on resolved_client.id = client_link.linked_client_id
left join candidates linked_candidate on linked_candidate.id = s.linked_candidate_id
where pravah_is_internal();

grant select on pravah_v_candidate_sync_inbox to authenticated;
