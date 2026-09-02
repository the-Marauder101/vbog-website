# Durable Product Decisions

## D-001 — Pravah is a separate product

Pravah is not a Nikash tab and not a Vyom feature. It owns a distinct
post-selection operating lifecycle and a future client revenue system.

## D-002 — Exchange is bidirectional; authority is not

Systems exchange relevant facts both ways, but a field is edited only in its
owner product. Full two-way editing creates last-writer conflicts.

## D-003 — Vyom controls recruitment

Pravah displays Vyom status read-only and deep-links to the card.

## D-004 — Nikash controls assessment

Pravah receives prediction context and sends outcomes; it does not recompute or
edit assessment evidence.

## D-005 — Pravah initially shares Nikash's Supabase project

Candidates, clients, requirements, placements, and outcomes can be related
directly. The Nikash scoring subsystem remains isolated.

## D-006 — WhatsApp copy/paste ships before API automation

This matches current behavior, avoids Meta/API setup, and creates structured
data immediately.

## D-007 — Client isolation is designed before the client portal

Adding tenancy after data exists is unsafe and expensive.

## D-008 — Client data is normalized, not forcibly standardized at source

Existing Sheet/CRM fields map into a canonical contract. Original values and
mapping versions remain auditable.

## D-009 — The CEO Dashboard is a requirements source

Its metrics and data-source ideas are committed; its fragile formula structure
will not be reproduced.

## D-010 — The PRD is maintained throughout the build

The final PRD must be sufficient to restart the project in another development
or AI conversation.

## D-011 — Existing approved staff authentication is reused

V1 bootstraps Pravah access from active, linked Nikash staff accounts. A new
Supabase Auth account alone never grants access.

## D-012 — Shared handoff records, isolated operating records

Candidates, clients, requirements, and frozen placement references are shared
inside the Closer-Match project. Training, reports, check-ins, targets, actions,
and audits use dedicated `pravah_` tables.

## D-013 — Every operational write is auditable

The browser calls narrow database functions for material writes. Hiding a
button is not authorization, and direct browser writes are not the preferred
operating path.

## D-014 — Vyom owns canonical client identity

Clients are created, named, paused and maintained in Vyom's central registry.
Pravah activates a linked operating profile only after a human verifies the
identity. Free-text client creation in Pravah is retired.

## D-015 — Names suggest; people verify

Normalized client names may produce a suggested match, but they never create a
link automatically. A verified link retains both system identifiers and an
audit event. This prevents NMT/Newmetech-style silent duplicates.

## D-016 — Closer reports are forms first

Fixed questions are the production capture path. WhatsApp remains an output
and optional source attachment, not an unvalidated schema. Example content is
not saveable into production.

## D-017 — Reported cash is not official cash

Closer-reported cash remains provisional. KPI and target calculations use only
cash carrying a verification source, timestamp and actor. CRM, Sheet, payment
gateway or client confirmation can provide the evidence.

## D-018 — Corrections preserve history

Reports and placements are voided; active clients are archived; actions are
completed or cancelled with a note. Permanent deletion is restricted to an
unused client and an administrator.

## D-019 — Client and closer roles remain dormant until safe

Role names and tenant relationships may exist before portal delivery, but they
do not authorize raw operational reads. Client and closer access activates only
with purpose-built restricted views in the portal version.
