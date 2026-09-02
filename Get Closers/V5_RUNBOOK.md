# Pravah V5 Runbook — Transition Layer

## Scope

V5 imports heterogeneous source rows into a repairable staging area and replays
only validated call-log records into V4's canonical lead/activity model. It does
not create a parallel CRM or silently promote reported cash to verified cash.

## Deployment

1. Merge the V5 PR.
2. In the existing Closer-Match Supabase project run `supabase/14_v5_transition_layer.sql`.
3. Run `supabase/15_verify_v5_transition_layer.sql`.
4. Create a client-scoped import profile with the `ceo_dashboard_callyzer` parser.
5. Upload or paste one small real export, validate it, repair rejected rows, then replay.

## CEO Dashboard / Callyzer profile

- Use Call Logs ID as `source_record_key`.
- Use client number as `contact_key`; retain the original client name and notes.
- Map CRM statuses explicitly to V4 stages. Unknown statuses must remain in the repair queue.
- Preserve recording URLs, reminders, source timestamps and raw source payload.
- Daily EOD/Midday reports are staged for review. Their cash field remains reported evidence, never verified cash.

## Replay safety

Rows are immutable and source-keyed. Replaying a successful batch is idempotent:
an existing activity becomes `duplicate`, rather than creating another activity.
Never edit canonical revenue history to fix a source-file error; repair the staged
row/mapping and replay a new batch.
