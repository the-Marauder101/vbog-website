# Get Closers Product System

This directory contains the Get Closers product-family workstream:

- **Vyom** — recruitment workflow and candidate movement.
- **Nikash** — assessment, matching, and prediction.
- **Pravah** — post-selection training, placement, closer performance, client
  success, reporting, and the future client revenue operating system.

The products exchange data, but each retains a single, explicit source of
truth. They must not become editable copies of the same workflow.

## Current build status

**V0 — Foundation is implemented on the `pravah-v0-foundation` branch.**

V0 establishes product contracts before live data or automation is added:

- architecture and ownership boundaries;
- canonical identifiers and data dictionary;
- security and client-isolation model;
- Vyom and Nikash change specifications;
- CEO Dashboard audit and migration direction;
- versioned roadmap;
- initial Pravah application shell;
- living PRD and decision log.

## Start here

1. [PRD.md](PRD.md) — the living, restartable product document.
2. [ARCHITECTURE.md](ARCHITECTURE.md) — product and system boundaries.
3. [ROADMAP.md](ROADMAP.md) — versioned delivery plan.
4. [DATA_DICTIONARY.md](DATA_DICTIONARY.md) — canonical data contract.
5. [INTEGRATIONS.md](INTEGRATIONS.md) — Vyom, Nikash, and future source flows.
6. [VYOM_CHANGES.md](VYOM_CHANGES.md) — changes required in Vyom.
7. [NIKASH_CHANGES.md](NIKASH_CHANGES.md) — changes required in Nikash.
8. [SECURITY.md](SECURITY.md) — roles, client isolation, and secrets.
9. [CEO_DASHBOARD_AUDIT.md](CEO_DASHBOARD_AUDIT.md) — workbook findings.
10. [DECISIONS.md](DECISIONS.md) — durable decisions and their reasoning.
11. [UX_SCOPE.md](UX_SCOPE.md) — versioned sections, modals, and interactions.

## Application

The initial Pravah shell is in [pravah/](pravah/). It follows the repository's
existing static-frontend approach so it can deploy with the current GitHub
Pages workflow. Live persistence and authentication are intentionally deferred
until the V0 data and security contracts are approved in code.
