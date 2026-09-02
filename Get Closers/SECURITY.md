# Security and Access Model

## Principles

1. Browser code contains only publishable keys.
2. Personal access, service-role, and integration secrets never enter GitHub.
3. Every client-owned row carries a client ID.
4. Row Level Security is default-deny for live Pravah tables.
5. Cross-project writes run server-side.
6. Assessment scores follow Nikash's existing restrictions.
7. Every material update records actor, source, and time.

## Roles

| Role | Scope |
|---|---|
| gc_admin | All Get Closers data and future configuration |
| operations | Internal clients, placements, reports, and actions |
| trainer | Assigned trainees and training decisions |
| client_success | Assigned clients, check-ins, and actions |
| client_admin | Own client workspace and future user management |
| client_viewer | Read-only own-client reporting |

V1 activates internal staff roles. Client roles exist in the data contract but
their portal is not enabled until V6.

## Client isolation

- membership maps auth user to client and role;
- policies use stable IDs, never email text comparisons;
- Get Closers portfolio access is explicit;
- exports and reports use the same policy-filtered views;
- source payloads remain isolated even when canonical metrics are aggregated.

## Integration secrets

Secrets are configured outside source code. The application provides a
human-readable connection status, last sync, and error state without revealing
the credential.

## V1 enforcement

- all nine `pravah_*` tables have enabled and forced RLS;
- material browser writes use narrow security-definer functions;
- direct insert/update/delete privileges are not granted to browser roles;
- helper and trigger functions are revoked from PUBLIC;
- every material V1 write adds an audit event;
- existing staff membership is synchronized from approved Nikash staff;
- a Supabase Auth account without a membership has no Pravah access.

## V2A enforcement

- client and closer portal roles remain dormant and cannot read operational
  records yet;
- free-text Pravah client creation is revoked;
- cross-project Vyom access occurs only inside a staff-authenticated Edge
  Function using stored secrets;
- client links require a human verification action;
- closer-reported cash is excluded from official cash KPIs until verified;
- void/archive/delete operations require reasons and, where destructive,
  administrator access.

## V2B enforcement

- a Vyom offer/client-round stage cannot create a Pravah placement;
- candidate names suggest a Nikash match but never link automatically;
- candidate creation and assessment remain unavailable in Pravah;
- client and requirement IDs are checked together before placement creation;
- cross-project credentials remain inside the existing staff-authenticated Edge
  Function;
- Vyom receives a short milestone summary, not performance reports or scores;
- event retries are idempotent and retain the last error;
- client and closer portal permissions remain dormant.
