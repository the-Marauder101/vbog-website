# Integration Contracts

## 1. Vyom → Pravah

Candidate observed, recruitment stage changed, selected for onboarding, lost
or withdrawn, and candidate-client assignment changed.

Pravah stores the source event and updates read-only recruitment context.

V2A activates the client-identity subset first:

1. Vyom records client changes in an internal outbox.
2. Staff click **Refresh from Vyom** in Pravah.
3. A server-side function verifies the staff session and refreshes the inbox.
4. A person links the suggested record or activates a new operating client.
5. The mapping retains both UUIDs; names never become the durable join.

## 2. Pravah → Vyom

Placement recorded, training started, training passed/extended/failed, closer
active, and placement ended.

These appear as milestone summaries and deep links. They do not create a
second recruitment workflow.

## 3. Nikash → Pravah

- candidate identity;
- assessment completion;
- match and requirement context;
- permitted prediction evidence;
- verification interview evidence.

## 4. Pravah → Nikash

- joined date;
- training outcome;
- first sale timing;
- retained status;
- quota attainment;
- client satisfaction;
- exit type and reason;
- 3/6/12-month outcome.

Outcome writeback uses the existing prediction record frozen at placement.

## 5. Sheets and CRM sources

The initial route is upload or paste source data, choose a client mapping, map
columns and stages, preview normalized records, repair rejected rows, commit an
idempotent import, and retain the source plus mapping version.

Automatic source polling is added only after the manual path is reliable.

Cash from closer reports is never promoted to verified cash by an import. A
source record must retain its CRM/Sheet/payment reference and pass validation.
