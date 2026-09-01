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

**Build status:** implemented in code. Production activation requires running
the reviewed migration and verification queries in Supabase.

## V2 — Product Connections

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
