# Versioned Build Roadmap

The end-state remains committed. Versions make delivery manageable.

## V0 — Foundation

- repository and documentation structure;
- living PRD and decision log;
- product authority and integration contracts;
- CEO Dashboard audit;
- canonical data dictionary;
- security and client-isolation model;
- initial Pravah shell;
- local WhatsApp report parser prototype.

**Exit gate:** another builder can explain the product boundaries and extend
the shell without returning to the original conversation.

## V1 — Pravah Core

- users and roles;
- clients;
- incoming placements;
- training and placement lifecycle;
- active closer records;
- weekly performance entry;
- client check-ins and actions;
- WhatsApp full/short report generation;
- basic overview dashboard.

**Build status:** merged and activated in production on 2026-09-02.

## V2 — Product Connections

### V2A — Operational hardening and client foundation

- Vyom client registry outbox and server-side refresh;
- verified client identity linking and duplicate reconciliation;
- structured closer report form and WhatsApp output;
- reported versus verified cash evidence;
- client detail, notes, check-ins and multi-action follow-through;
- archive/void/dependency-safe delete controls;
- admin and staff interface differences;
- client/closer roles reserved but denied until restricted portals ship.

**Build status:** merged, deployed and verified in production on 2026-09-02.

### V2B — Candidate and outcome connections

- Vyom integration outbox;
- candidate identity linking;
- automatic selected-candidate intake;
- milestone summaries back to Vyom;
- reconciliation queue;
- Nikash outcome checkpoint expansion;
- automatic Pravah-to-Nikash outcomes.

**Build status:** merged and deployed on 2026-09-02. One real placed-candidate smoke test remains the operational validation gate.

## V3 — KRA/KPI System

- six weighted KRAs;
- sixteen scored KPIs;
- configurable targets and thresholds;
- period scorecards;
- evidence and commentary;
- employee and management views;
- manager finalization and auditable overrides;
- structured technical-round attribution;
- pattern insight and intervention tracking;
- company target configuration.

**Build status:** merged and deployed on 2026-09-02. Live scorecard verification with an approved staff account remains pending.

## V4 — Client Revenue Engine

- canonical customer/lead records;
- customer activities and call-log records;
- canonical pipeline and deal stages;
- sales and revenue records;
- payment evidence and verified cash;
- refunds, cancellations and write-offs;
- client and closer revenue comparisons;
- revenue, pipeline, outstanding and conversion views;
- standalone customer-centric revenue workspace.

**Build status:** merged and deployed on 2026-09-02. One real lead-to-verified-payment acceptance test remains pending.

## V5 — Transition Layer

- CSV and Sheet import;
- mapping wizard;
- stage taxonomy mapping;
- transformations and validation;
- saved mapping versions;
- rejected-row repair;
- import audit and replay.

**Boundary:** V5 writes into the V4 canonical revenue model. It must not create a second CRM/revenue schema.

**Build status:** import foundation in review. The first profile supports CEO Dashboard / Callyzer call logs and preserves raw rows, mapping versions, validation repairs and idempotent replay.

## V6 — Client and Closer Portal

- client invitations and memberships;
- client-isolated dashboards;
- closer lead workspace;
- client admin controls;
- native lead and pipeline management.

**Build status:** merged and deployed on 2026-09-02 (migration 16). Shipped
with a latent defect: the portal views are `security_invoker` and join
Nikash-owned tables that carry no client or closer read policy, so every
portal table rendered empty while the metric cards showed correct counts.
Undetected until 2026-09-06; fixed in V9.

## V7 — Automation and Intelligence

- scheduled source synchronization;
- optional WhatsApp API/Zapier delivery;
- deeper pattern recognition and intervention intelligence;
- assessment prediction validity;
- client and closer risk signals.

**Build status:** partially delivered on 2026-09-04 as V7/V7b/V7c
(migrations 19-21): the portal launcher, client name in `pravah_context`,
and user creation via the Auth Admin API. Scheduled synchronization,
WhatsApp API/Zapier delivery, deeper pattern intelligence and risk signals
are **not built**.

## V8 — Client CRM

- full lead register with search, stage filter, and lead detail slide-out;
- inline lead editing (stage, contact, notes);
- deal creation and pipeline management from client portal;
- sale recording against leads and deals;
- CSV/Callyzer import wizard with field and stage mapping;
- enhanced dashboard with funnel visualization and MTD metrics;
- client_admin write contracts for leads, deals, sales, and imports;
- import RPCs opened to client_admin with client-scoped access.

**Boundary:** V8 does not add new tables — it opens existing V4/V5 write
contracts to `client_admin` and builds the full CRM interface.

**Build status:** merged and deployed. Migration 22 (write contracts and
import RLS) applied 2026-09-06; migration 23 (lead tags) applied
2026-09-06. Deal detail slideout, bulk stage actions, CSV export, lead tags
and 8-week dashboard trend charts all shipped.

## V9 — Client registry and portal repair

- portal visibility fix: SELECT policies on `placements`, `candidates` and
  `requirements` for client and closer roles, via three security-definer
  resolvers;
- `client_registry` — canonical client identity anchored on `clients.id`;
- `client_system_links` — external IDs per system, unique on
  `(system, external_id)`;
- `pravah_v_client_data_index` — what data exists for a client, and where;
- auto-registration trigger on `clients`, plus backfill from `clients` and
  `pravah_client_sync_inbox`;
- registry upsert / link / overview RPCs.

**Boundary:** `clients` is the target of 29 foreign keys and is not
restructured. V9 promotes it to the canonical anchor and builds around it.

**Build status:** merged and deployed 2026-09-06 (migration 24), verified
against production. Registry backfilled 19 of 19 clients; 2 Vyom links
carried from the sync inbox. Portal visibility confirmed fixed for
`client_admin` and `closer` with no regression for internal roles.

### V9b — Overload hotfix

Migration 23 added `p_tags` to `pravah_client_update_lead` with
`create or replace function`. Changing a signature creates a second
function rather than replacing the first, and both overloads accepted
`{p_lead_id, p_stage}`, so PostgREST returned `PGRST203`. This broke the
inline lead stage dropdown and bulk stage update in the client portal.

**Build status:** merged and deployed 2026-09-06 (migration 25), verified.
The pre-tags 5-argument version is dropped; one signature remains.

## V10 — Closer daily reporting and closer KPIs

- closer-submitted midday and EOD daily reports;
- dual-entry reconciliation with immediate discrepancy flagging;
- closer KRA/KPI scorecards, scoped so the staff model is untouched;
- WhatsApp output on the closer side;
- per-client sale-gap alert thresholds, admin-only;
- client visibility gate removed.

**Boundary:** V10 adds no reporting table. `pravah_performance_reports`
already carried every field; only its uniqueness constraint changed.

**Build status:** merged and deployed 2026-09-06 (migration 26, after two
corrected attempts). Verified: 20 of 20 clients visible (was 3), staff KRAs
unchanged at 6/100, closer KRAs 4/100, existing reports backfilled intact.

### V10b — Correctness fixes found during verification

- `pravah_kpi_dashboard` referenced `pravah_training.trainer_id`, a column
  that has never existed (it is `trainer_uid`). The staff KRA/KPI scorecard
  has therefore thrown on every call since migration 08 shipped on
  2026-09-02 — it was never merely unused, it could never run;
- `pravah_closer_scorecard` scored unscoreable KRAs as zero instead of
  reporting no data.

**Build status:** migration 27 — pending deployment.

## Not yet scheduled

Carried forward and not attached to any version:

- **Sales/cash source of truth** (PRD §24) — the CRM and the KRA/KPI engine
  measure the same facts through two paths that never meet. A product
  decision, not a patch.
- **Validation gates never closed** — V2B placed-candidate smoke test, V3
  live scorecard verification, V4 lead-to-verified-payment acceptance test.
- **Production hygiene** — purge `ZZ_FIXTURE` clients and the
  `sales_count = 1000` test report; rotate the service role key exposed in
  `21_v7c_user_creation.sql`.

## Release discipline

Every version includes migrations and rollback notes, permission verification,
automated tests, operator instructions, an updated PRD/addendum and decision
log, no placeholder credentials, and no silent changes to another product's
authority.
