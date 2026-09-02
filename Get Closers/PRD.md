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
