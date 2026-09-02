# Vyom Changes Required for Pravah

Vyom remains the only place where recruitment stages are moved.

## V1 compatibility additions

- stable candidate ID exposed in candidate detail;
- canonical client and requirement references where available;
- read-only Pravah milestone panel after selection;
- deep link to the corresponding Pravah placement;
- integration outbox recording candidate and stage events;
- delivery state, retry count, and last error for each event.

## V2A implementation

- the central `clients` registry is confirmed as the owner of client identity;
- client create/update/delete events enter `pravah_integration_outbox`;
- existing clients receive idempotent bootstrap events;
- the outbox is unavailable to anonymous and ordinary authenticated browser
  roles;
- the HR client lifecycle table continues to reference the central registry
  and is not treated as a second identity source.

## Events Vyom publishes

- candidate observed;
- recruitment stage changed;
- selected for onboarding;
- candidate-client assignment changed;
- candidate withdrawn or lost.

## Summaries Vyom receives

- training state;
- placement state;
- active/ended state;
- latest Pravah milestone and link.

## V2B implementation

- adds `Placed - Handoff to Pravah` to the GetClosers hiring board;
- publishes only cards deliberately moved into that stage;
- retains source events in `pravah_candidate_outbox` with retries and stable IDs;
- receives idempotent summaries in `pravah_milestone_receipts`;
- displays the latest `pravah_status` on the candidate card and edit modal;
- keeps that status read-only and leaves all recruitment-stage controls in Vyom.

## Explicit exclusions

- no training workflow inside Vyom;
- no closer performance dashboard inside Vyom;
- no editing of Pravah milestones;
- no direct browser-to-browser database writes.
