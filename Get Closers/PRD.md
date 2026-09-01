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
