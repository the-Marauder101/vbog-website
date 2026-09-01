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
| gc_admin | All Get Closers data and configuration |
| recruitment_manager | Recruitment context and candidate linking |
| interviewer | Assigned interview evidence |
| trainer | Assigned trainees and training decisions |
| client_success | Assigned clients, closers, check-ins, and actions |
| closer | Own profile, assigned leads, and own reports |
| client_admin | Own client workspace and users |
| client_viewer | Read-only own-client reporting |

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
