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
