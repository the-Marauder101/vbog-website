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

### V2B — Candidate and outcome connections

- Vyom integration outbox;
- candidate identity linking;
- automatic selected-candidate intake;
- milestone summaries back to Vyom;
- reconciliation queue;
- Nikash outcome checkpoint expansion;
- automatic Pravah-to-Nikash outcomes.

## V3 — KRA/KPI System

- six weighted KRAs;
- thirteen scored KPIs;
- targets and thresholds;
- period scorecards;
- evidence and commentary;
- employee and management views;
- report exports.

## V4 — Client Revenue Engine

- canonical lead, activity, deal, sale, and payment records;
- call-log ingestion;
- lead-stage and closer comparisons;
- sales, revenue, cash, and outstanding views;
- CEO Dashboard rebuilt as live Pravah views.

## V5 — Transition Layer

- CSV and Sheet import;
- mapping wizard;
- stage taxonomy mapping;
- transformations and validation;
- saved mapping versions;
- rejected-row repair;
- import audit and replay.

## V6 — Client and Closer Portal

- client invitations and memberships;
- client-isolated dashboards;
- closer lead workspace;
- client admin controls;
- native lead and pipeline management.

## V7 — Automation and Intelligence

- scheduled source synchronization;
- optional WhatsApp API/Zapier delivery;
- pattern recognition and intervention tracking;
- assessment prediction validity;
- client and closer risk signals.

## Release discipline

Every version includes migrations and rollback notes, permission verification,
automated tests, operator instructions, an updated PRD and decision log, no
placeholder credentials, and no silent changes to another product's authority.
