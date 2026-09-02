# Pravah V4 — Client Revenue Engine / Customer-Centric CRM Addendum

## Purpose

V4 establishes the canonical revenue operating layer inside Pravah. It turns the
client/customer flow into structured records that can later feed client portals,
closer workspaces, the CEO dashboard and the KRA/KPI engine.

V4 is deliberately **not** a generic CRM clone. Its core flow is:

**Client → Lead / Customer → Activity / Call → Deal → Sale → Payment → Verified cash**

## Product boundary

- **Vyom** remains the recruitment authority.
- **Nikash** remains the assessment/prediction authority.
- **Pravah** owns post-selection operations and the canonical client revenue layer.
- **V5** owns ingestion, field mapping, stage mapping, transformation, validation,
  rejected-row repair and import replay for heterogeneous Sheets/CRMs.
- **V6** owns restricted client and closer portals.

The V4 schema is designed so V5 and V6 can be added without changing the core
revenue concepts.

## Canonical entities

### Lead / customer

One client-owned customer record. Stores contact information, source, canonical
pipeline stage, owner placement/closer, activity timestamps and preserved source
metadata.

### Activity

A timestamped customer interaction. Types include call, WhatsApp, email, meeting,
follow-up and note. External source keys make future ingestion idempotent.

### Deal

An opportunity attached to a customer. Stores stage, value, expected close date,
owner and status. Open deal value is pipeline, not revenue.

### Sale

A booked commercial outcome. Gross, discount and net amounts are separated.
Creating a booked sale can close the associated deal and move the customer to won.

### Payment

A cash event attached to a sale. Payments begin as pending evidence. Only verified
payments count as official cash in revenue dashboards.

### Adjustment

A refund, cancellation or write-off against a sale. This prevents the dashboard
from treating every booked sale as permanently collectible.

## Canonical stage taxonomy

`new → contacted → qualified → booked → proposal → negotiation → won / lost`

`nurture` is retained as a non-terminal reactivation state.

External stage names do not enter the canonical model directly. V5 will map them.

## Evidence hierarchy

1. CRM/payment evidence
2. System-generated Pravah records
3. Client-confirmed records
4. Structured staff reports
5. Manager override with written evidence

A closer's reported cash is not automatically official cash.

## Dashboard contract

V4 exposes a single dashboard procedure for a selected date range and optional
client:

- active leads;
- open pipeline value;
- sales count;
- booked revenue;
- verified cash;
- outstanding balance;
- closed-deal conversion rate;
- funnel counts;
- client comparison;
- closer comparison.

Client and closer comparisons are derived from canonical client/placement links,
not manually maintained dashboard formulas.

## Write contract

Browser writes go through reviewed RPCs rather than direct table mutation:

- create lead;
- log activity;
- create deal;
- update lead stage/status;
- update deal stage/status;
- record sale;
- record payment;
- verify payment;
- record adjustment.

Source-system and source-record keys are supported from the beginning so V5 can
replay imports safely.

## Security

V4 revenue tables use default-deny, forced RLS. V4 exposes staff-only operational
reads. Client and closer memberships remain unable to read these tables until V6
ships purpose-built restricted views/policies.

The browser contains no service-role credentials or source-system secrets.

## Interface

The V4 workspace lives at:

`/Get%20Closers/pravah/revenue/`

It contains:

- Revenue Dashboard;
- Customers & Leads;
- Pipeline;
- Sales & Cash;
- date/client filtering;
- lead stage controls;
- deal stage controls;
- activity logging;
- sale/payment capture;
- payment verification for authorized roles.

## Explicit non-goals for V4

- no generic contact-enrichment engine;
- no automatic Sheet/CRM field mapping;
- no client-facing portal;
- no closer-facing portal;
- no WhatsApp Business API dependency;
- no replacement of Vyom or Nikash;
- no silent conversion of reported cash into verified cash.

## Next phases

**V5 — Transition Layer:** source adapters, CSV/Sheet import, mapping wizard,
stage taxonomy mapping, transformations, validation, saved mapping versions,
rejected-row repair, audit and replay.

**V6 — Client and Closer Portal:** invitations, memberships, row-level isolation,
client dashboards and closer lead workspaces.

**V7 — Automation and Intelligence:** scheduled synchronization, optional WhatsApp
API/Zapier delivery, deeper pattern recognition and risk signals.
