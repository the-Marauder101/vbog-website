# Pravah — Living Product Requirements Document

> **Status:** Living document. This file is updated throughout the build and
> becomes the full restart document at completion. A future builder should be
> able to read it and continue without the original conversation.

## 1. Product context

Get Closers recruits, evaluates, trains, places, and supports high-ticket sales
closers for client companies. The operating system currently spans:

- recruitment movement in Vyom;
- candidate assessment and client matching in Nikash;
- closer and client updates sent largely as WhatsApp text;
- client lead data stored in heterogeneous Google Sheets or other CRMs;
- performance reporting assembled manually or in fragile spreadsheets.

The uploaded **CEO Dashboard — MDP** workbook represents an earlier attempt to
combine call logs, individual closer sheets, midday/EOD reports, sales, and
cash collected into a company-wide view. Its operating thesis is retained; its
spreadsheet-specific implementation is not.

## 2. Vision

Pravah is the operating flow from placement to performance.

It should let Get Closers answer, without manual consolidation:

- Who was selected and placed?
- Who completed training and became sales-ready?
- Which closers are hitting target?
- What sales and cash did each closer and client produce?
- Which clients or closers require intervention?
- Did the intervention work?
- Which candidate and assessment signals predicted real success?

Long term, Pravah also provides a secure client and closer CRM for leads,
activities, deals, sales, and collections.

## 3. Product family

| Product | Primary job | Source of truth |
|---|---|---|
| Vyom | Move candidates through recruitment | Recruitment stage and movement history |
| Nikash | Assess and predict suitability | Assessment, match, and prediction evidence |
| Pravah | Operate and measure post-selection success | Training, placement, performance, clients, sales, cash, and outcomes |

### Governing principle

**Bidirectional exchange, never bidirectional control.**

A field has one owner. Other products may display it, link to it, or receive a
summary, but do not independently edit it.

## 4. Primary users

- Get Closers administrator / founder
- Recruitment manager
- Interviewer
- Trainer
- Client success manager
- Placed closer
- Client administrator
- Client viewer

## 5. Committed end-state scope

### 5.1 Get Closers operations

- incoming placements from Vyom;
- Nikash assessment context;
- training batches and checkpoints;
- product readiness and roleplay evaluation;
- placement, first sale, and retention;
- closer targets, sales, cash, and performance trends;
- counselling and improvement plans;
- client check-ins, health, issues, and actions;
- KRA/KPI scorecards;
- WhatsApp-compatible updates;
- 3/6/12-month outcome feedback to Nikash.

### 5.2 Client revenue operations

- client-isolated workspaces;
- leads and ownership;
- activities, calls, notes, and follow-ups;
- pipeline and stage history;
- deals, sales, refunds, and cancellations;
- cash collected and outstanding;
- client and closer dashboards;
- Google Sheets / CSV / CRM imports;
- reusable field and stage mappings;
- company-wide normalized reporting.

## 6. Initial product surfaces

1. Overview
2. Training & Placements
3. Active Closers
4. Clients
5. Reports
6. Data & Connections
7. Settings

V0 delivers the shell and contracts. Later versions progressively activate
these surfaces.

## 7. WhatsApp requirement

WhatsApp is a first-class output even before API automation.

Pravah must support:

- a short closer update form;
- paste-and-parse of an existing WhatsApp report;
- preview before saving;
- full and short WhatsApp message templates;
- one-click copy;
- optional "marked as shared" audit state;
- later Zapier or WhatsApp Business API delivery without changing the report
  data model.

## 8. Client access requirement

The data model is multi-client from the first live migration.

- every client-owned operational record carries a canonical client ID;
- Row Level Security isolates client data;
- closers see only assigned records;
- client administrators see only their company;
- Get Closers staff have role-appropriate portfolio access;
- browser code never contains service-role or personal access tokens.

## 9. Data normalization requirement

Clients may keep their current Sheets or CRM during transition.

Pravah stores:

1. immutable source record;
2. client-specific mapping version;
3. normalized canonical record;
4. validation and rejection result;
5. sync/import audit entry.

Client-specific columns may live in an extension payload, but company-wide
metrics use canonical fields only.

## 10. Success measures

- no recurring manual company-wide consolidation;
- WhatsApp update preparation takes under two minutes;
- every active closer has current target and performance data;
- every client has a current health state and next action;
- 30/60/90-day retention is available without retrospective research;
- Nikash receives complete 6/12-month outcomes automatically;
- data conflicts are visible and resolvable, not silently overwritten;
- adding a client's sheet does not require changing dashboard formulas.

## 11. Non-goals

- Pravah does not replace Vyom's recruitment board.
- Pravah does not become a second assessment engine.
- Nikash does not become an operations CRM.
- V1 does not require the WhatsApp Business API.
- V1 does not require clients to abandon their current CRM.

## 12. Version plan

See [ROADMAP.md](ROADMAP.md). Each version must leave behind a usable product,
complete documentation, tests, migrations, rollback notes, and an updated PRD.

## 13. Build and handoff standard

Every material decision is recorded in [DECISIONS.md](DECISIONS.md). The final
PRD will also contain:

- full historical context;
- product vision and principles;
- user roles and permissions;
- all pages, sections, modals, and workflows;
- database schema and metric formulas;
- integration contracts;
- source-system setup;
- security and operational runbooks;
- testing and deployment instructions;
- known limitations;
- future roadmap;
- restart instructions for another AI or development conversation.

## 14. Build history

### 2026-09-01 — V0 foundation

- created the isolated `Get Closers/` repository workspace;
- documented product authority, canonical data, security, integration, Vyom
  and Nikash change scope, CEO Dashboard findings, roadmap, and decisions;
- created the responsive Pravah product shell;
- implemented local paste-and-parse for WhatsApp reports;
- implemented local draft history and copy-ready WhatsApp output;
- added automated parser tests;
- added no backend credentials and no synthetic operating metrics.

## 15. Current restart point

The next build is V1 Pravah Core. Before attaching production data:

1. convert the canonical dictionary into reviewed Supabase migrations;
2. add memberships, roles, and default-deny RLS;
3. implement clients, placements, training, performance periods, check-ins,
   actions, and audit tables;
4. replace V0 local drafts with authenticated records;
5. connect the overview only after policy and metric tests pass.

The V0 interface is a product interaction prototype, not a production data
store. Its local storage can be cleared without affecting any source system.

## 16. V1 implementation

### 2026-09-02 — Pravah Core

V1 converts the V0 interaction prototype into an authenticated operating
surface while preserving the approved product boundaries.

Implemented:

- existing Nikash staff login reused for Pravah;
- dedicated Pravah memberships and roles;
- default-deny, forced Row Level Security on every Pravah table;
- client operational profiles;
- placement creation using shared Nikash candidates and requirements;
- training start, checkpoints, status, readiness, roleplay, risk, and decision fields;
- period targets;
- structured closer performance reports;
- WhatsApp text retained as report-source evidence;
- client check-ins, health, root cause, actions, and deadlines;
- attention queue;
- audited create/update/complete/share actions;
- live overview metrics;
- point-and-click SQL setup and verification.

### V1 authority detail

Pravah does not copy candidate assessments or client requirements. It reads the
existing Nikash records and creates/uses the placement handoff record with the
prediction references frozen. Operational records are stored separately under
the `pravah_` prefix.

Vyom remains unchanged in V1. Candidate movement is not editable in Pravah.
The Vyom event bridge remains V2.

### V1 activation steps

1. Merge the V1 pull request.
2. In Supabase, open the existing Closer-Match project.
3. Run `Get Closers/supabase/01_pravah_core.sql` in SQL Editor.
4. Run `02_verify_pravah_core.sql` and confirm every expectation.
5. Open Pravah and sign in with an approved Nikash staff account.
6. Record the first real placement and validate the workflow before adding the
   remaining live records.

### Current limitations after V1

- Vyom stages do not sync yet;
- client and closer portals are not enabled yet;
- no automatic Google Sheets or CRM import;
- no WhatsApp Business API delivery;
- KPI scorecards are scheduled for V3;
- 3/6/12-month Nikash outcome automation begins in V2;
- the logo remains a text mark pending final brand refinement.

## 17. V2A implementation

### Why V2A exists

The first live operator test proved the V1 persistence and security foundation,
but exposed five workflow problems:

1. a client typed in Pravah did not exist in Vyom and could create a duplicate;
2. the WhatsApp label parser allowed example names to disagree with the linked
   placement;
3. reported cash looked authoritative despite having no CRM/payment evidence;
4. check-in actions existed but were not visible as a client-owned workflow;
5. mistakes lacked understandable archive, void and delete controls.

### Approved product decisions

- Vyom's central client registry owns canonical client identity.
- Pravah removes free-text client creation and introduces a verified linking
  inbox.
- Fixed-question forms become the primary closer-report input.
- WhatsApp becomes generated output and optional source evidence.
- Reported cash and verified cash are stored and displayed separately.
- Official target achievement uses verified cash only.
- A client record contains notes, check-in history and traceable actions.
- A check-in may create multiple actions with priority and due date.
- Completing or cancelling an action requires explanatory evidence.
- Reports and placements are voided; clients are archived; only unused clients
  can be permanently deleted by an administrator.
- Client and closer portal roles remain inaccessible until restricted read
  contracts are implemented; a future role name is never treated as security.

### V2A interface

**Overview** retains portfolio KPIs and attention items. Staff can refresh the
Vyom client catalogue and record a placement.

**Training & placements** shows an explicit placement state and gives admins
an end/void flow with reason and effective date.

**Active closers** separates verified cash from closer-reported cash. Reports
are entered using fixed fields for activity, outcomes, money, blockers, support
and the next-period plan.

**Clients** is the complete Vyom-sourced operating directory. It shows active
source clients even before Pravah setup, makes **Link existing** and **Create
Pravah record** explicit on pending cards, and opens operational clients into
their status, health, notes, check-in and action timelines. Data & connections
keeps the more technical reconciliation table.

**Reports** produces a WhatsApp-ready summary, shows cash verification state,
supports evidence verification and permits admin voiding without erasure.

**Data & connections** contains the Vyom client inbox. Normalized names show a
suggested match, but staff must explicitly link or activate it.

### V2A database and bridge

The Closer-Match project receives:

- `pravah_client_sync_inbox`;
- `pravah_placement_states`;
- client profile notes/archive fields;
- report activity, verification and void fields;
- linked action/check-in closure fields;
- V2A views and audited RPCs.

The Vyom project receives `pravah_integration_outbox` and a trigger for client
create/update/delete events. A Supabase Edge Function in the Pravah project
verifies the calling staff session, reads Vyom through stored server secrets,
and refreshes the Pravah inbox. The GitHub Pages browser receives no secret.

### Role state after V2A

| Role | State |
|---|---|
| gc_admin | Active; all staff workflows and safeguarded corrections |
| operations / trainer / client_success | Active; operational workflows without destructive admin controls |
| client_admin / client_viewer | Reserved and denied pending client-safe portal views |
| closer | Not provisioned pending the closer workspace and own-record policies |
| candidate | Remains in Vyom/Nikash; Pravah begins only after placement |

## 18. V2B — Candidate and Outcome Connections

V2A is deployed. V2B closes the candidate lifecycle without turning Pravah into
a second recruitment board or a second assessment product.

### Product boundary

| Product | Owns | Receives from the other products |
|---|---|---|
| Vyom | recruitment workflow and candidate-card movement | read-only Pravah training, placement and outcome status |
| Nikash | candidate assessment history and long-term prediction validation | confirmed 3/6/12-month placement outcomes |
| Pravah | post-placement training, closer operations and client success | explicit placed-candidate handoffs and verified candidate identity |

Pravah does not change recruitment stages. Nikash does not become a placement
tracker. Vyom does not edit assessments or placement outcomes.

### Handoff workflow

1. Operations moves a genuinely joined candidate to **Placed - Handoff to
   Pravah** in the GetClosers project in Vyom.
2. The server-side sync adds the card to Pravah's candidate inbox.
3. Pravah may suggest a Nikash candidate using normalized names, but a staff
   member must explicitly verify the identity.
4. The staff member selects the already-linked client requirement and records
   the actual joining date.
5. Pravah creates the placement through the canonical placement function and
   marks the handoff complete. It never creates a Nikash candidate.
6. Training and placement milestones are queued and written back to the source
   Vyom card inside a read-only `pravah_status` namespace.

If identity or client linkage is uncertain, the item stays reconcilable in the
inbox. It is never silently matched using a name alone.

### Long-term outcome workflow

Pravah shows due and completed checkpoints at month 3, month 6 and month 12.
Authorized staff record whether the closer is retained, target achievement,
sales, cash collected, performance rating and notes. The canonical Nikash
outcome procedure calculates actual success and predictor correctness, while
Pravah adds source and confirmer audit metadata.

The same integration-event queue writes a compact outcome summary to the
source Vyom card. Failed deliveries remain visible and retry on the next sync;
they are not treated as completed.

### V2B access model

- approved internal staff can review and complete candidate handoffs;
- only internal staff can record long-term outcomes;
- browser roles cannot read Vyom outbox or milestone-receipt tables;
- the Vyom service key remains an Edge Function secret;
- client, closer and candidate accounts remain denied from general staff views.

### V2B release contents

- Vyom explicit handoff state, candidate outbox and milestone receipts;
- Pravah candidate inbox, human-verification and placement handoff procedures;
- reliable outbound integration-event queue with retry metadata;
- M3/M6/M12 outcome view and recording procedure backed by Nikash;
- read-only Pravah status on Vyom cards;
- Data & connections and Training & placements interface additions;
- verification SQL, contract tests and an operator/deployment runbook.

## 19. Current restart point after V2B

Deploy V2B in the order documented in `V2B_RUNBOOK.md`: Vyom migration,
Pravah/Nikash migration, verification, updated Edge Function, then frontend.
Smoke-test one real placed candidate end to end. Do not manufacture production
candidate, placement or outcome data merely to test the path.

The next batch after V2B is V3: the management scorecard and KRA/KPI engine.
It should consume verified operational records from V1–V2B, not add parallel
manual trackers. Client-portal and closer-portal activation remain later,
purpose-built phases with restricted read models.

## 20. V3 and V4 deployment status

V3 and V4 are deployed in the existing Closer-Match project. V3 provides the
KRA/KPI engine; V4 provides the canonical revenue model. Both retain forced RLS
and staff-only write contracts. The remaining production gate is an approved
staff acceptance test using genuine operating records, not manufactured data.

## 21. V5 — Transition Layer

V5 is the controlled bridge from Sheets, CSV exports and CRM exports into V4.
Each import belongs to one canonical client and contains an immutable raw row,
source key, mapping version, normalized preview, validation result and replay
receipt. The first profile is CEO Dashboard / Callyzer plus Daily Update.

Call Log IDs are activity source keys. Client number/name form the proposed lead
identity. CRM status must have an explicit V4 stage mapping. Ambiguous identity,
unknown stage or malformed rows enter a repair queue. Daily reported cash stays
evidence only and never becomes verified cash without V4 payment evidence.

## 22. V8 — Client CRM

V8 opens the existing V4/V5 revenue and import contracts to `client_admin`
accounts and builds the full client-facing CRM interface. No new tables are
created; V8 writes into the canonical revenue model through security-definer
RPCs with explicit client-scoped access checks.

### Product boundary

V8 does not create a parallel CRM schema. Every lead, deal, sale, activity
and import row lives in the existing V4/V5 tables. Client administrators
write through dedicated RPCs that enforce `client_id` ownership. The
internal staff portal retains its own views and write contracts unchanged.

### Client portal views

| # | View | Purpose |
|---|---|---|
| 01 | Dashboard | Six metric cards (closers, leads, revenue, cash, pipeline, actions), lead funnel, closer roster, recent check-ins |
| 02 | Leads & customers | Full lead register with search by name/email/phone, stage filter, inline stage update, lead detail slideout with contact info, deals, sales, and activity timeline |
| 03 | Pipeline | Open deals table with inline stage update, deal detail slideout with associated sales and timeline |
| 04 | Sales & cash | Four metric cards (booked, MTD, verified cash, MTD cash), recent sales table |
| 05 | Import | Three-step CSV/Callyzer import wizard: setup, preview and field/stage mapping, validation and replay |
| 06 | Closers | Assigned closer register and performance reports |
| 07 | Actions & history | Open actions and full check-in history |

### Write contracts opened to client_admin

- `pravah_client_create_lead` — insert lead scoped to the client's own ID;
- `pravah_client_update_lead` — update stage, notes, email, phone on own leads;
- `pravah_client_create_deal` — create a deal linked to an own lead;
- `pravah_client_update_deal` — update deal stage and notes;
- `pravah_client_record_sale` — record a sale against own lead/deal;
- `pravah_client_log_activity` — log a call, WhatsApp, email, meeting, follow-up or note;
- `pravah_import_create_profile`, `pravah_import_stage_rows`,
  `pravah_import_validate_batch`, `pravah_import_replay_batch` — full import
  pipeline scoped to the client's own data.

### Import support

The import wizard supports Callyzer call logs, generic CSV, and CRM exports.
Auto-mapping recognizes common column names (name, phone, email, status,
date, duration, notes). Stage mapping translates source CRM statuses to
canonical V4 pipeline stages. Validation catches malformed rows; valid rows
are imported idempotently with duplicate detection via source record keys.

### Additional CRM features

- Deal detail slideout with associated sales and activity timeline;
- Bulk lead selection with stage update across selected leads;
- CSV export for leads and sales data (includes tags);
- Lead tags — `tags text[]` column with GIN index, editable in the lead
  edit modal, displayed as badges in the lead register and detail slideout,
  filterable via dropdown;
- Dashboard trend charts — 8-week bar charts for leads created and sales
  recorded, computed client-side from existing data;
- Debounced search across name, email and phone fields;
- Responsive layout down to mobile widths.

### Security model

All V8 RPCs are `security definer` with explicit checks:
- caller must hold a valid session;
- caller role must be `client_admin`;
- target records must belong to the caller's own `client_id`.

RLS policies on import tables grant client_admin read/write access scoped
to their own client ID. Table-level grants permit insert and update only
through the RPC layer.

### Database isolation audit (completed)

Every Pravah table (22 tables) has RLS **enabled and forced**. Client
isolation follows a shared-table model with row-level security, not
separate tables per client. Key findings:

1. **All revenue tables** (`leads`, `activities`, `deals`, `sales`,
   `payments`, `adjustments`) have `client_id NOT NULL` with FK to
   `clients(id)` and RLS policies joining through `pravah_memberships` to
   verify the caller's client.
2. **All write RPCs** are `security definer` with `SET search_path = public`,
   revoke PUBLIC/anon, grant only to authenticated. Every RPC validates
   cross-entity ownership (lead/client mismatch, deal/client mismatch).
3. **Import tables** without direct `client_id` (`mapping_versions`,
   `batches`, `rows`, `replays`) derive client through FK chains to
   `pravah_import_profiles.client_id`. RLS policies join through these
   chains.
4. **All views** use `security_invoker = true` and add explicit
   `pravah_can_access_client()` filters.
5. **`pravah_context()`** derives `client_id` purely from `auth.uid()`
   against the membership table — never from user input.
6. **No cross-client joins** exist without proper filtering.
7. **`anon` role** has zero access to any Pravah table or function.

Minor notes for awareness (not blockers):
- `pravah_audit_events` has no client-scoped read policy (only internal).
  Client admins cannot see their own audit trail. Intentional but could be
  extended in a future pass.
- Revenue table INSERT/UPDATE grants are broad (`authenticated`) but safe
  because no INSERT RLS policy matches for non-internal users. Writes go
  through SECURITY DEFINER RPCs only.
- Service role key is hardcoded in `21_v7c_user_creation.sql` source file.
  It is stored in Supabase vault at runtime, but visible in repo history.

### KPI impact

Client revenue data written through V8 flows into V3 KRA/KPI scorecards
and V4 company-wide revenue views. Verified cash requires V4 payment
evidence regardless of the entry path.

### Migrations

- `22_v8_client_crm.sql` — client write RPCs, import RPC access checks,
  import table RLS policies for client access.
- `23_v8b_lead_tags.sql` — adds `tags text[]` column with GIN index to
  `pravah_revenue_leads`, updates `pravah_client_update_lead` to accept
  `p_tags` parameter. **Deploy before using tags in the UI.**

### Notes for the next pass

The following items are ready for the next builder:

1. **Deploy migration 23** (`23_v8b_lead_tags.sql`) to production via
   Supabase SQL editor. Until deployed, the tag filter and tag editing in
   the UI will not work (the column doesn't exist yet).
2. **Audit trail for client admins** — consider adding a client-scoped read
   policy on `pravah_audit_events` so client admins can see actions taken
   on their own data.
3. **Bulk delete** — the UI shows a "Delete selected" button but the RPC
   does not exist yet. Needs a `pravah_client_delete_lead` function with
   proper cascading (activities, deals, sales).
4. **Service role key rotation** — the key in `21_v7c_user_creation.sql` is
   in repo history. Consider rotating it and moving to environment
   variables or a secrets manager.
5. **Lead create with tags** — `pravah_client_create_lead` does not accept
   tags yet. Add a `p_tags text[]` parameter if needed.
6. **Server-side trend data** — the dashboard trend charts compute client-
   side from the 500-lead / 250-sale fetch limit. For clients with more
   data, consider a server-side aggregation RPC.
7. **Payment and adjustment closer policies** — `pravah_revenue_payments`
   and `pravah_revenue_adjustments` have no closer read policy. Closers
   cannot see payment details. This is likely intentional but should be
   confirmed.

## 23. V9 — Unified client registry and portal visibility fix

V9 resolves two defects found during the pre-launch database audit: a
portal visibility break that made client and closer portals silently
render empty tables, and the absence of a single canonical client identity
shared across Pravah, Nikash and Vyom.

### 23.1 Defect — portal views return zero rows

**Symptom.** The client dashboard metric cards report correct values
(`Active closers: 1`) while every table below them renders its empty state
("No closers assigned yet"). The same break affects the closer portal.

**Root cause.** The V6 portal views (`pravah_v_placements`,
`pravah_v_reports`, `pravah_v_clients`, `pravah_v_attention`) are declared
`security_invoker = true`, so the caller's RLS applies to every table the
view joins. Those views join three Nikash-owned tables — `placements`,
`candidates` and `requirements` — whose only SELECT policies are
`pravah_is_internal()` and `is_staff()`. A `client_admin`, `client_viewer`
or `closer` therefore reads zero rows from them, and the join collapses to
an empty result. The view's own `pravah_can_access_client()` filter passes;
the underlying RLS is what blocks it.

The metric cards disagree because `pravah_client_portal()` and
`pravah_closer_portal()` are `security definer` and bypass RLS entirely.
The portal has been reporting counts it could not display since V6.

`pravah_v_clients` fails the same way for a second reason: its `WHERE`
clause requires an `EXISTS` over `requirements`/`placements`, which is
RLS-blocked for portal users, so no client row is ever returned.

**Fix.** Add permissive SELECT policies to `requirements`, `placements` and
`candidates` scoped through three new `security definer` resolver
functions. Permissive policies are OR'd with the existing internal and
staff policies, so Nikash access is unchanged and nothing is revoked.

| Function | Returns |
|---|---|
| `pravah_my_visible_placement_ids()` | closer → own placement only; client_admin/client_viewer → every placement of their client |
| `pravah_my_visible_requirement_ids()` | requirements behind those placements, plus all client requirements for client roles |
| `pravah_my_visible_candidate_ids()` | candidates placed against those placements |

Each resolver is `security definer` so its internal joins are not subject
to the caller's RLS, which avoids policy recursion.

### 23.2 Unified client registry

**Problem.** Client identity is fragmented across three systems:

| System | Client store | Identifier |
|---|---|---|
| Nikash | `clients` (shared project) | canonical `clients.id` |
| Pravah | `clients` + `pravah_client_profiles` | same `clients.id` |
| Vyom | separate Supabase project | its own `clients.id`, unrelated |

The Vyom mapping exists only inside `pravah_client_sync_inbox`, which is a
staging inbox for a refresh workflow, not a registry: it holds 15 source
rows of which 2 are linked, and it is Pravah-private. There is no single
place that answers "who is this client, what are their IDs in every
system, and what data do we hold for them".

`clients` itself carries only `id`, `business_name` and `created_at`, and
is the target of 29 foreign keys. It cannot be replaced or restructured.

**Design.** `clients` is promoted to the canonical anchor and the registry
is built around it. No existing column, constraint or foreign key changes.

- **`client_registry`** — one row per client, keyed by `client_id`
  referencing `clients(id)`. Holds the canonical identity that all three
  products read: canonical and legal name, normalized name for matching,
  status and lifecycle stage, primary contact, country, reporting
  currency, and `origin_system` recording where the client first appeared.
- **`client_system_links`** — one row per (system, external id). Maps a
  registry client to its identifier in `vyom`, `nikash`, `pravah`,
  `callyzer` or any future source, with link status, last-seen time and
  the source payload. Unique on `(system, external_id)` so a Vyom client
  can never be linked to two registry clients.
- **`pravah_v_client_data_index`** — a live view answering "what do we hold
  for this client": counts of requirements, placements, leads, deals,
  sales, activities, import profiles, check-ins, actions, portal
  memberships and Nikash `client_users`, plus the linked system list.

**Automatic registration.** A trigger on `clients` creates the registry row
on insert, so any client added by Nikash, Pravah or the Vyom bridge is
registered without a code change in that product. A backfill populates the
registry and the Vyom links from existing `clients` and
`pravah_client_sync_inbox` rows.

**Vyom flow.** When a client is created in Vyom, the existing Edge Function
bridge writes to `pravah_client_sync_inbox` as it does today. Linking that
inbox row now also writes a `client_system_links` row through
`pravah_client_link_system()`, so the registry becomes the durable record
and the inbox returns to being a staging area. Names remain hints; the
UUID pair is the join.

**Write contracts.**

- `pravah_client_registry_upsert(...)` — internal only; create or update
  canonical identity.
- `pravah_client_link_system(p_client_id, p_system, p_external_id, ...)` —
  internal only; idempotent link or relink with audit.
- `pravah_client_registry_overview(p_client_id)` — internal, or a client
  admin for their own client; returns identity, system links and data
  footprint as one JSON document.

**Apparent duplication, not a live problem.** Nikash's `client_users` and
Pravah's `pravah_memberships` both map auth users to clients, but
`client_users` holds **zero rows** — nothing uses it. `pravah_memberships`
is the only live mapping. No consolidation work is warranted; the registry
data index surfaces both counts so the situation stays visible if
`client_users` ever starts being written.

### 23.3 Security model

`client_registry` and `client_system_links` have RLS enabled and forced.
Internal staff read and write; a client admin reads only their own
registry row and links. `anon` has no access. All registry RPCs are
`security definer` with `set search_path = public`, revoke PUBLIC and
anon, and grant execute to `authenticated` only.

### 23.4 Migrations

`24_v9_client_registry.sql` — portal visibility policies, resolver
functions, registry tables, trigger, backfill, data index view and
registry RPCs. Additive only: no table is dropped, no column is altered,
no policy is removed.

`25_v9b_fix_function_overloads.sql` — hotfix. Migration 23 added `p_tags`
to `pravah_client_update_lead` with `create or replace function`. Changing
the signature creates a **second** function rather than replacing the
first, and both overloads accept `{p_lead_id, p_stage}` with everything
else defaulted. PostgREST could not disambiguate and returned `PGRST203`,
breaking the inline lead stage dropdown and bulk stage update in the
client portal. The edit-lead modal was unaffected because it sends
`p_tags`, which resolves uniquely. Migration 25 drops the pre-tags
5-argument version.

`pravah_list_invitations` carries a similar zero-arg / one-arg pair but is
**not** ambiguous and is deliberately left alone: the one-argument form has
no default, so an empty body can only match the zero-argument form. Both
are live callers.

**Lesson for future migrations:** adding a parameter to an existing
function is not a replace. Either keep the signature identical, or drop the
old signature explicitly in the same migration.

### 23.4.1 Deployment status — verified 2026-09-06

Migrations 23 and 24 applied to production and verified by direct query:

| Check | Result |
|---|---|
| `tags` column + GIN index | present |
| Three visibility resolvers | present |
| Three portal SELECT policies | present |
| `client_registry`, `client_system_links` | created |
| `pravah_v_client_data_index` | created |
| Registry backfill | 19 of 19 clients |
| Vyom links carried from sync inbox | 2 |
| Nikash self-links | 19 |
| Registry trigger | active |

Portal visibility defect confirmed fixed:

| Caller | `pravah_v_placements` before | after |
|---|---|---|
| client_admin @ NMT | 0 rows | 1 row (correct closer, client, training status) |
| closer @ NMT | 0 rows | 1 row (own placement only) |
| gc_admin (internal) | 1 row | 1 row (no regression) |

`pravah_v_clients` and `pravah_v_reports` also populate for the client
admin (1 and 2 rows) where both previously returned zero.

Migration 25 applied and verified 2026-09-06: `pravah_client_update_lead`
now has exactly one signature (the 6-argument form); the previously
`PGRST203` call `{p_lead_id, p_stage}` resolves; `pravah_list_invitations`
correctly still carries both of its non-ambiguous signatures.

With migrations 22 through 25 applied, the client portal is functionally
complete: every view renders, every write contract resolves.

## 24. Open architectural gap — two sources of truth for sales and cash

This is the largest unresolved issue in the system and it predates V8. It
is recorded here because it is a design decision, not a defect to patch.

Sales and cash are written and read through two independent paths that
never meet:

| Surface | Sales source | Cash source |
|---|---|---|
| Client dashboard metric cards (`pravah_client_portal`) | `pravah_revenue_sales` | `pravah_revenue_payments` |
| Closer roster on that same page (`pravah_v_placements`) | `pravah_performance_reports.sales_count` | `pravah_performance_reports.verified_cash_collected` |
| Closer portal (`pravah_closer_portal`) | `pravah_revenue_sales` | `pravah_revenue_payments` |
| KRA/KPI scorecards (`pravah_kpi_dashboard`) | `pravah_performance_reports` | `pravah_performance_reports` |

`pravah_performance_reports` is written only by `pravah_save_report` and
`pravah_submit_report` — the manual weekly closer report. Nothing writes it
from `pravah_revenue_sales`. A sale recorded in the client CRM therefore
never reaches the closer roster or any scorecard, and a weekly report never
reaches client booked revenue. The two figures diverge permanently.

**PRD section 22 previously claimed V8 revenue "flows into V3 KRA/KPI
scorecards". That claim is incorrect** and is retained here only so the
record is honest. It does not flow.

The visible consequence: once the V9 portal fix lands and the closer roster
renders, a client will see `Booked revenue ₹0` on a metric card directly
above a roster row reporting 1,002 sales, because the card reads the CRM
and the row reads the weekly reports.

**Resolution required before launch — pick one direction:**

1. **CRM is the source.** Derive `pravah_performance_reports` from
   `pravah_revenue_sales` on a period boundary; the weekly form becomes an
   adjustment/commentary layer. KPIs then measure real CRM activity.
2. **Reports remain the source.** Point the client and closer metric cards
   at `pravah_performance_reports` so every surface agrees, and treat the
   CRM as pipeline management that does not feed measurement.

Option 1 matches the product vision (§2: "no manual company-wide
consolidation"). Option 2 is the smaller change. Either is acceptable;
shipping neither is not, because the contradiction is client-visible.

### 23.5 Notes for the next pass

1. **Purge non-production data.** Five `ZZ_FIXTURE` clients and a
   performance report with `sales_count = 1000` are live in the production
   database and will surface in client-facing views.
2. **KRA/KPI engine is inert.** Six KRAs and sixteen KPI definitions exist;
   `pravah_scorecards`, `pravah_targets` and `pravah_company_targets` all
   hold zero rows. V3 shipped but has never been used. Either activate it
   with real targets or mark it explicitly parked.
3. **Front-end swallows load failures.** `pravah/js/app.js` wraps its portal
   fetches in `catch (_) { … = [] }`, rendering an empty state instead of
   surfacing the error. This is the same failure mode as the V9 RLS defect:
   the system prefers showing nothing over showing a problem. Surface load
   errors to the user.
4. **`pravah_list_invitations` is overloaded** with a zero-argument and a
   `p_client_id uuid` signature. PostgREST currently resolves it from the
   request body, but a future caller passing an unexpected key will get an
   ambiguity error. Collapse to one signature.
5. **Push registry identity into Vyom.** Vyom currently learns nothing back
   from the registry. A return path would let Vyom display the canonical
   client ID.
6. **Backfill `origin_system` accurately.** The initial backfill marks
   pre-existing clients `unknown` unless a Vyom link exists; historical
   provenance may be recoverable from audit events.
7. **Rotate the service role key.** It is hardcoded in
   `21_v7c_user_creation.sql` and therefore in repository history.

## 25. V10 — Closer daily reporting, dual-entry reconciliation, closer KPIs

V10 resolves the §24 source-of-truth question and builds the reporting loop
that Get Closers actually runs today. It is the largest behavioural change
since V1 because it moves closers from being *reported on* to *reporting*.

### 25.1 The real-world process being modelled

Each placed closer submits **two reports every working day**:

| Slot | Time | Contents |
|---|---|---|
| Midday | ~15:00 | calls made, positive leads, closed deals, cash collected — as of that moment |
| EOD | end of day | the same figures, as of close |

Both are cumulative snapshots of the same day, not increments. Their
purpose is twofold: measuring output, and confirming the closer is actually
working through the day.

Today these are typed into WhatsApp by the closer. Pravah's job is to
become the place they are submitted, and to hand staff a formatted message
to paste into WhatsApp — not to replace the WhatsApp channel itself.

### 25.2 §24 resolved — closer submission is the source of truth

**Decision:** the closer's own submission is treated as real data. A staff
member may submit their own figures for the same slot; where the two
disagree, the discrepancy is **flagged immediately**, not reconciled
silently.

Rationale: KPIs measure the closer, so the closer's own numbers are the
measured artefact. Staff figures become a check on that claim rather than a
substitute for it. Revenue is the most important metric in the business and
must never carry contested values quietly.

This supersedes the two options recorded in §24. It is closest to
"CRM is the source" in spirit — measurement follows real submitted
activity — but the submitting party is the closer, not the CRM.

### 25.3 Schema problem this exposes

`pravah_performance_reports` already carries every field the daily report
needs: `calls_attempted`, `connected_calls`, `qualified_opportunities`,
`meetings_booked`, `followups_completed`, `sales_count`,
`revenue_generated`, `cash_collected`, `pipeline_value`, plus `blocker`,
`support_required`, `next_period_plan`, and a full verification and void
chain. **No new reporting table is required.**

The blocker is a single constraint:

```
UNIQUE (placement_id, period_start, period_end)
```

Two reports on the same day both have `period_start = period_end = today`,
so the second insert fails. Dual entry makes it worse: closer-midday,
staff-midday, closer-eod and staff-eod are four rows sharing one key.

**Fix:** add `report_slot` and `submitted_by_role`, and widen the unique key
to `(placement_id, period_start, period_end, report_slot, submitted_by_role)`.
Existing rows backfill to `report_slot = 'period'`,
`submitted_by_role = 'staff'`, which preserves their current meaning.

### 25.4 Discrepancy flagging

When a closer row and a staff row exist for the same placement, date and
slot, the pair is compared on the figures that matter — `sales_count`,
`cash_collected`, `revenue_generated`. Any difference raises a flag
**on write**, not on a schedule, because contested revenue must not sit
unexamined even for an hour.

The flag is surfaced in the ops Overview attention queue and on the client
record. Resolving it is an explicit staff action that records which figure
was accepted and why, leaving both original rows intact.

### 25.5 Closer KPIs — design, and why it does not disturb the existing model

The existing six KRAs and sixteen KPIs measure **Get Closers internal
staff** — recruiters, trainers, client success. A placed closer currently
has no scorecard; their performance only rolls up into a staff member's
score through PCS-3, TCP-2 and TCP-3.

Closer scorecards are added **without touching the staff model** by
scoping definitions to a subject:

- `pravah_kra_definitions.subject` and `pravah_kpi_definitions.subject`,
  both defaulting to `'staff'`. Every existing row keeps its meaning, and
  weights are summed *within* a subject, so the staff scorecard is
  arithmetically unchanged.
- `pravah_scorecards` gains a nullable `placement_id` alongside its
  existing `staff_uid`, with a check that exactly one is set, plus the same
  `subject` marker. The table currently holds zero rows, so this carries no
  migration risk.

**Four closer KRAs**, deliberately fewer than the staff six:

| KRA | Weight | Measures | Source |
|---|---|---|---|
| Activity | 30% | calls attempted vs target, connect rate | daily reports |
| Pipeline | 20% | qualified opportunities, meetings booked | daily reports |
| Revenue | 35% | sales count and cash collected vs target | daily reports + targets |
| Discipline | 15% | both slots submitted, submitted on time, fields complete | daily reports |

Every closer KPI reads data the daily reports already produce. Nothing new
is collected.

Per-closer targets need no work: `pravah_targets` is already keyed on
`placement_id` with `period_start`, `period_end`, `target_value`,
`target_unit` and `currency`. Different closers can carry different targets
in different units, which the Revenue and Activity KRAs read directly.

### 25.6 WhatsApp output

V0 built a WhatsApp report parser and V1 a formatted output, but both live
in the **ops portal** only — the closer side never received them. V10 gives
the closer's submission a formatted WhatsApp block with one-click copy, so
the closer submits in Pravah and staff paste the generated message. The
existing `shared_at` column already records that a report was shared.

### 25.7 Client alert thresholds

Sale-gap and check-in alerting must vary per client, because B2B and B2C
cycles differ.

- `pravah_client_profiles.sale_gap_alert_days` — default **4**.
- `checkin_cadence` already exists and drives the check-in alert.
- Both are editable **only by an admin**, from the client detail drawer in
  ops. Staff cannot change them.

These feed the existing Overview attention queue rather than a new alerting
system. The queue today flags only overdue actions and high training risk;
V10 adds sale-gap, overdue check-in, and revenue discrepancy.

### 25.8 Client visibility gate removed

`pravah_v_clients` filtered its output to clients having a Vyom link, a
placement, a check-in or an action. With 20 clients in production only 3
passed, hiding 17 — including newly created ones — and making the client
edit, check-in, archive and delete actions unreachable for them. The filter
is removed; all accessible clients list, with sparse ones marked rather
than hidden.

### 25.9 Client identity — confirmed single-table

Recorded because it is mission-critical and was explicitly confirmed:

```
Nikash (requirements)  →  clients row            ← THE single client table
        ↓
Vyom (client tracker)  →  its own id  →  client_system_links
        ↓
"Placed - Handoff to Pravah"  →  placement  →  Pravah operates
```

`clients` is the only client table and is the target of 29 foreign keys.
`client_system_links` carries `unique (system, external_id)`, so one Vyom
client can never map to two Pravah clients, and
`pravah_client_link_system` rejects relinking an external id to a different
client. Linking stays a **deliberate manual step** performed by the
founder; the system surfaces unlinked records but does not auto-link, since
a wrong automatic match is worse than an unlinked one.

### 25.10 Migration

`26_v10_closer_reporting.sql`.

`26_v10_closer_reporting.sql` — nine parts:

| Part | Contents |
|---|---|
| A | `sale_gap_alert_days` on `pravah_client_profiles`, default 4 |
| B | `pravah_v_clients` rebuilt without the visibility gate; adds `has_activity` |
| C | `pravah_set_client_alert_thresholds` — admin-only, audited |
| D | `report_slot`, `submitted_by_role`, `submitted_at`, discrepancy columns; unique key widened |
| E | `pravah_check_report_discrepancy` trigger + `pravah_resolve_report_discrepancy` |
| F | `pravah_closer_submit_report` + closer own-report read policy |
| G | `subject` on KRA/KPI definitions and scorecards; four closer KRAs, eight closer KPIs |
| H | `pravah_closer_scorecard` |
| I | `pravah_v_revenue_alerts` — discrepancy, sale gap, unverified cash |

Ordering matters: Part A must precede Part B because the rebuilt view reads
the new column.

### 25.11 Design notes worth carrying forward

- **A closer may only report their own placement**, resolved from
  `pravah_memberships`, never passed in. They cannot backdate beyond
  yesterday; older corrections are a staff action, so the audit trail stays
  meaningful.
- **Re-submitting a slot updates it** rather than erroring, because a closer
  correcting a typo at 15:05 is normal. The `submitted_at` timestamp moves;
  the discrepancy check re-runs.
- **Resolving a discrepancy edits neither original row.** Both are marked
  resolved with the accepted side and a mandatory note. The claim and the
  correction both remain visible.
- **Scorecards read only closer-submitted rows.** Staff figures are a check,
  not the measured artefact, so including them would let a staff correction
  silently change a closer's score.
- **`pravah_scorecards` needed a partial unique index** for closer rows: its
  existing `UNIQUE (staff_uid, period_start, period_end)` does not constrain
  rows where `staff_uid` is null, since Postgres treats nulls as distinct.
- **Closer KRA codes carry a `cl_` prefix** because `code` is globally unique
  across both subjects.

### 25.12 Deployment verification — 2026-09-06

Migration 26 applied to production after two corrections (see 25.13). Verified
by direct query:

| Check | Result |
|---|---|
| `sale_gap_alert_days` on client profiles | present |
| 8 new columns on `pravah_performance_reports` | all present |
| New composite unique index | present |
| Old `UNIQUE (placement_id, period_start, period_end)` | removed |
| Discrepancy trigger | active |
| 6 new functions | all present |
| `pravah_v_revenue_alerts` | created |
| Closer scorecard partial unique index | present |

Behaviour:

| Check | Before | After |
|---|---|---|
| Clients visible in ops | 3 of 20 | **20** (4 with activity, 16 sparse) |
| Staff KRAs / total weight | 6 / 100 | 6 / 100 — **unchanged** |
| Closer KRAs / total weight | — | 4 / 100 |
| Closer KPIs per KRA | — | 2 each, summing 100 |
| Existing staff reports | 2 rows | 2 rows, backfilled to `('period','staff')`, 1,002 sales intact |
| `pravah_closer_scorecard` as closer | — | resolves own placement, returns 4 KRAs |
| `pravah_v_revenue_alerts` | — | correctly flags NMT sale gap at the 4-day default |
| client_admin / closer portal reads | working | working — no regression |

### 25.13 Three deploy failures, one root cause

V10 took three attempts to land. Recording the pattern because it is the same
mistake each time — writing SQL against an assumed schema instead of a
verified one.

1. **Migration 23** used `create or replace function` to add a parameter.
   Changing a signature creates a *second* function; both overloads then
   matched the same request body and PostgREST returned `PGRST203`, breaking
   the client portal's inline stage dropdown and bulk update. Fixed in 25.
2. **Migration 26, attempt 1** — `42P16`: `create or replace view` can only
   *append* columns, never reorder or rename. A new column had been inserted
   mid-list.
3. **Migration 26, attempt 2** — the closer KPI seed used
   `direction = 'higher_better'`; the check constraint permits only
   `'higher_is_better'`.

Each would have been caught by one query before writing. The standing rule
for future migrations: **verify the live schema before writing DDL against
it** — column order for views, exact enum spellings for check constraints,
and whether a function signature change implies a new overload.

## 26. V10b — Two correctness fixes found during verification

### 26.1 The staff KRA/KPI scorecard has never worked

Verifying V10 for regressions surfaced a **pre-existing defect that predates
all of it**:

```
ERROR 42703: column t.trainer_id does not exist
HINT: Perhaps you meant to reference the column "t.trainer_uid".
```

`pravah_kpi_dashboard` references `pravah_training.trainer_id` in two places.
That column has never existed — `01_pravah_core.sql` defines it as
`trainer_uid`. The function has therefore thrown on **every call since
migration 08 shipped on 2026-09-02**.

This revises an earlier finding in this document. Section 24 recorded that
the KRA/KPI engine was "inert — shipped but never used". The truth is
sharper: it could never run. `/performance/` throws on load, and
`pravah_scorecards` holds zero rows because writing one was impossible, not
because nobody tried.

It also explains why V3's exit gate — "live scorecard verification with an
approved staff account" — was never closed. The gate was never closeable.

**Fix:** migration 27 replaces the function with its live definition, both
references corrected to `trainer_uid`. Nothing else in the body changes.

### 26.2 Closer scorecard showed zero for unscoreable KRAs

As written in migration 26, `pravah_closer_scorecard` coalesced an
unscoreable KRA to `0`. A closer with no target set would have seen `0.0` on
Activity and Revenue and reasonably read it as failure, when the truth is
those KRAs cannot be scored at all.

That contradicts the principle the staff scorecard already states on its own
face: *"missing data stays visible instead of becoming a zero."*

**Fix:** each KRA returns `null` when its inputs cannot support a score. The
overall score is a weighted average across only the scoreable KRAs,
renormalised so the remaining weights still total 100; it is `null` when
nothing is scoreable. Discipline remains always scoreable — not submitting is
itself the measurement. The closer portal already renders `null` as an em
dash, so no front-end change was required.

### 26.3 Migration

`27_v10b_fix_kpi_dashboard.sql` — Part A restores `pravah_kpi_dashboard`;
Part B replaces `pravah_closer_scorecard`.

### 26.4 Fourth deploy failure — missing statement terminator

Migration 27 failed its first run:

```
ERROR 42601: syntax error at or near "create"
LINE 149: create or replace function pravah_closer_scorecard(
```

Part A's body was taken from `pg_get_functiondef()`, whose output ends
`end $function$` with **no trailing semicolon**. Part A therefore ran
straight into Part B's `create`. Fixed by terminating the statement.

Worth carrying forward: `pg_get_functiondef()` is the right way to
faithfully reproduce a live function, but its output is not a runnable
statement on its own. Always append the terminator when concatenating it
with anything else.

## 27. Launch readiness

Audited 2026-09-06 against production.

### 27.1 Clean

- Every table in the database has RLS enabled.
- **No Pravah function is callable by `anon`.**
- `pravah_integration_events` has RLS with zero policies — fully locked to
  the service role, which is intentional for the Edge Function bridge.
- `pravah_list_invitations` remains the only overloaded Pravah function, and
  it is verified non-ambiguous: the one-argument form has no default, so an
  empty body can only match the zero-argument form.

### 27.2 Non-production data still live — must clear before launch

| Item | Count |
|---|---|
| `ZZ_FIXTURE` clients | 5 |
| Performance report with `sales_count = 1000` | 1 |
| `depesh_*_test` memberships | 2 |
| `ZZ_QA Suite` staff memberships | 3 |

*(An earlier draft of this document said twelve fixture clients. The
verified count is five; corrected here and in the roadmap.)*

The `sales_count = 1000` report is the most visible: with the V9 portal fix
live, a client now sees a roster row reporting 1,002 sales beside a booked
revenue figure drawn from the CRM.

### 27.3 Outstanding before launch

1. Purge the non-production rows above.
2. Rotate the service role key exposed in `21_v7c_user_creation.sql`.
3. Close the three validation gates — V2B placed-candidate smoke test, V3
   scorecard verification (now possible for the first time, once migration
   27 lands), V4 lead-to-verified-payment.
4. Build the two remaining items from the V10 conversation: reusable import
   mappings, and source + activity analytics.

### 27.4 `pravah_kpi_dashboard` carried two wrong column names, not one

Applying migration 27 fixed `trainer_id` → `trainer_uid` and immediately
revealed a second reference of exactly the same kind in the same function:
`t.started_at`, where `pravah_training` defines `started_on`.

Rather than continue fixing one per deploy, **every aliased column reference
in the function was checked against `information_schema`**: twenty-six
references across eleven tables. `t.started_at` was the only remaining one
that does not resolve. Migration 28 fixes it, and should be the last of its
kind for this function.

Two lessons, both already visible in 25.13 but sharper here:

1. **A fix that reveals another error of the same class is a signal to audit
   the whole surface, not to patch again.** Four separate deploys were spent
   on what one systematic check would have caught.
2. **Automated reference checking needs care with aliases.** The first pass
   flagged five problems; three were false positives, because
   `pravah_training` and `pravah_targets` both bind to `t` in different
   scopes, and `pravah_insights` and `pravah_interventions` both bind to `i`.
   Each candidate was verified individually before concluding.

This also explains the shape of the original defect. The V3 KPI engine was
written against an assumed schema and never executed even once — two wrong
column names in a single function survive only if the code has never run.

## 28. V10e — Staff and admin account creation

### 28.1 The actual defect

Portal access for `client_admin`, `client_viewer` and `closer` had been
working all along. **Staff and admin accounts were the ones that could not be
added.** This section corrects an earlier misdiagnosis in this document,
which treated the two as one problem and led with the wrong one.

The cause is an asymmetry between two functions built on different
mechanisms, only one of which works without email:

| Function | Password param | Endpoint | Sends email | Works today |
|---|---|---|---|---|
| `pravah_create_portal_user` | yes | `/auth/v1/admin/users` | no | **yes** |
| `pravah_invite_staff` | no | `/auth/v1/invite` | yes | **no** |

`pravah_invite_staff` depends entirely on an invitation email arriving. The
project has no SMTP (`smtp_host` null), leaving only Supabase's development
sender, and `mailer_autoconfirm` is true. Staff invitations therefore never
reach anyone.

The ops portal made this worse by promising something that had never
happened. The add-staff form read: *"A magic-link email will be sent."*
Nothing in the codebase had ever sent one to a staff member.

### 28.2 Fix

`pravah_create_staff_user(p_email, p_role, p_display_name, p_password)` gives
internal roles the identical password-based path that already works for
external ones: `POST /auth/v1/admin/users` with `email_confirm`, then an
internal membership row (`client_id` null, conflicting on the
`pravah_one_internal_membership` index). Admin-only, audited, minimum
8-character password.

`pravah_invite_staff` is **left in place untouched**, so it resumes working
the moment SMTP is configured. V10e adds an alternative rather than removing
a capability.

The add-staff form now takes a temporary password, calls the new RPC, and
states plainly that no email is sent.

### 28.3 Self-service password change

With passwords issued by an administrator and no email available for reset,
an issued password would otherwise be permanent. `PravahApi.changePassword`
calls `PUT /auth/v1/user` with the caller's own session token — deliberately
session-based, since an emailed reset link cannot arrive and, until this
session, would have pointed at `localhost:3000`.

All three portals — ops, client and closer — now carry a **Password** control
beside Sign out.

### 28.4 Auth configuration applied

| Setting | Was | Now | Reason |
|---|---|---|---|
| `site_url` | `http://localhost:3000` | `https://v-bog.com` | every link-based flow pointed at localhost |
| `uri_allow_list` | empty | `https://v-bog.com/**` | redirects to the real site were rejected |
| `mailer_autoconfirm` | `true` | `true` — unchanged | setting it false without SMTP would strand new users awaiting an email that cannot send |
| `smtp_host` | null | null — unchanged | deliberately deferred; the account flow needs no email |

Note that `password_min_length` is 6 at the Supabase level while both
`pravah_create_staff_user` and the change-password screen enforce 8. The
application is deliberately stricter than the platform.

### 28.5 The onboarding flow, end to end, with no email

1. An administrator creates the account — staff via **Team → Add to team**,
   client or closer via **Portal** — setting a temporary password.
2. The administrator sends the portal URL, email and temporary password
   directly, over WhatsApp, which is the channel the team already uses.
3. The person signs in and replaces the password from the **Password**
   control.

`copyInviteLink` remains in the ops portal and produces a token URL, but the
client-side accept-invitation handler was never built, so that path is not
the recommended one.

### 28.6 Migration

`30_v10e_staff_password_creation.sql`.
