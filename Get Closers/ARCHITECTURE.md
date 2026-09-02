# Product and System Architecture

## 1. Authority model

| Domain | Owner | Other products may |
|---|---|---|
| Recruitment stage | Vyom | Read, deep-link, receive event |
| Candidate movement history | Vyom | Read |
| Assessment responses and scores | Nikash | Read only where role permits |
| Match and prediction evidence | Nikash | Read and correlate with outcomes |
| Training and placement lifecycle | Pravah | Receive milestone summary |
| Closer targets and results | Pravah | Read aggregate outcomes |
| Client health and check-ins | Pravah | Read aggregate status |
| Leads, deals, sales, and cash | Pravah | Receive source updates |
| Client identity and recruitment account | Vyom | Link and read |

No interface should provide an edit control for a field owned by another
product.

## 2. Deployment shape

All product source remains in the existing VBOG GitHub Pages repository.

- plain HTML, CSS, and JavaScript;
- no framework or build step for the product frontend;
- Supabase/PostgREST for live persistence;
- database calculations and views for KPIs;
- server-side functions for cross-project writes;
- publishable browser keys only;
- no secret keys in GitHub or browser code.

## 3. Database placement

Pravah will initially use the existing Closer-Match Supabase project because it
needs direct relationships to Nikash candidates, clients, requirements,
interviews, placements, and outcomes.

Pravah-specific tables are isolated by naming, permissions, and documentation.
Nikash scoring logic remains untouched.

Vyom uses a separate Supabase project. Its exchange with Pravah therefore goes
through an authenticated server-side integration.

V2A implements the first server-side bridge as a Supabase Edge Function in the
Pravah project. The browser sends the signed-in staff token to the function;
the function verifies `pravah_context`, reads Vyom with a stored server secret,
and writes only to the Pravah client inbox. No cross-project secret ships in
GitHub Pages.

## 4. Integration reliability

Cross-system events use a stable event ID, source system and record ID, event
type, schema version, occurred-at time, idempotency key, payload, processing
status, attempt count, last error, and processed-at time.

Retries must not create duplicate candidates, placements, sales, or payments.

## 5. Reconciliation

Pravah provides a human-readable reconciliation queue for unlinked people,
multiple matches, stale source records, invalid client mappings, conflicting
milestones, rejected import rows, and failed outbound summaries.

Resolving a conflict creates an audit record. It never rewrites source history
without naming the source and actor.

## 6. V1 physical model

The shared Closer-Match project contains two types of record:

| Record | Physical owner | Pravah behavior |
|---|---|---|
| candidates | Nikash | read-only context |
| clients | shared client identity | reuse; add separate operational profile |
| requirements | Nikash | read-only role context |
| matches/interviews | Nikash | freeze references at placement |
| placements | handoff contract | create once; never duplicate |
| pravah_training | Pravah | operational authority |
| pravah_targets/reports | Pravah | operational authority |
| pravah_client_checkins/actions | Pravah | operational authority |
| pravah_audit_events | Pravah | immutable activity evidence |

The browser has select access needed for approved views. Material writes go
through audited database functions. V1 adds no second assessment, candidate
movement board, or client lead CRM.

## 7. V2A client identity model

Vyom's `clients.id` and the shared Nikash/Pravah `clients.id` are different
identifiers. `pravah_client_sync_inbox` stores the durable mapping. Normalized
names are hints only. A staff member must activate a new record or link an
existing one.

Vyom also writes client mutations to `pravah_integration_outbox`. V2A refreshes
current state on demand; V2B can consume the outbox incrementally without
changing the identity contract.

## 8. V2B candidate and outcome model

Vyom gains one explicit source stage: `Placed - Handoff to Pravah`. Offer
letters, client rounds and BGV are not treated as placements. Moving a candidate
card into the handoff stage publishes its stable task UUID, name, optional email
and canonical Vyom client UUID. It does not create a placement by itself.

`pravah_candidate_sync_inbox` retains that source identity. Staff verify the
existing Nikash candidate, verify the previously linked client and choose the
correct Nikash requirement plus actual joining date. Only then does Pravah use
the shared placement contract.

Training, placement and outcome changes enter `pravah_integration_events`.
The staff-authenticated Edge Function delivers idempotent, non-editable milestone
summaries to the source Vyom task. Full training and sales data stays in Pravah.

Because Pravah and Nikash share the Closer-Match database, confirmed M3, M6 and
M12 outcomes write directly to Nikash's existing `placement_outcomes` table.
The frozen match and interview references remain unchanged.
