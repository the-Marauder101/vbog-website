# Canonical Data Dictionary — V0

This is the initial cross-product contract. Table-level SQL is added with the
first live migration.

## Canonical identifiers

| Field | Meaning |
|---|---|
| person_id | One human across all products |
| candidate_id | Recruitment/assessment identity |
| vyom_task_id | Candidate card controlled by Vyom |
| nikash_candidate_id | Assessment identity controlled by Nikash |
| placement_id | Candidate-client-role placement |
| closer_id | Post-placement operating identity |
| client_id | Canonical client/tenant |
| requirement_id | Client role/requirement |
| source_record_id | Identifier in Sheet, CRM, or call source |

Names and phone numbers are matching attributes, not durable identifiers.

## Training

- training_batch_id
- started_at / expected_completion_at / completed_at
- status: planned / active / passed / extended / failed / withdrawn
- product_ready / roleplay_rating / trainer_id / risk_level / decision_note

## Performance period

- closer_id / client_id / period_start / period_end
- target_value / target_unit
- sales_count / revenue_generated / cash_collected / currency
- calls_attempted / connected_calls / qualified_opportunities / pipeline_value
- blocker / support_required / next_period_plan / source_type

## Client success

- client_health / satisfaction / checkin_at / checkin_owner
- material_issue / root_cause / next_action / action_owner / action_due_at
- resolved_at

## Lead and revenue engine

- lead_id / client_id / closer_id
- lead_name / phone / email / source / assigned_at
- canonical_stage / source_stage / last_activity_at / next_followup_at
- deal_value / won_at / lost_at / lost_reason
- sale_id / payment_id / amount_due / amount_collected / payment_at / currency
- source_payload / mapping_version

## Canonical initial pipeline

The taxonomy remains configurable, but company-wide reporting starts with:

1. New
2. Attempted
3. Connected
4. Follow-up
5. Qualified
6. Call booked
7. Proposal / payment link
8. Won
9. Lost
10. Invalid

Client-specific labels map into this taxonomy without being destroyed.

## V1 physical mapping

| Canonical concept | V1 table |
|---|---|
| Approved access | pravah_memberships |
| Client operating state | pravah_client_profiles |
| Placement handoff | placements (shared) |
| Training lifecycle | pravah_training |
| Training evidence | pravah_training_checkpoints |
| Period target | pravah_targets |
| Closer result | pravah_performance_reports |
| Client health meeting | pravah_client_checkins |
| Corrective/follow-up work | pravah_actions |
| Material change history | pravah_audit_events |

Client ID is derived from the placement on training, target, and report writes.
The browser cannot choose a conflicting client relationship.
