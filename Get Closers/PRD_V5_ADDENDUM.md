# Pravah V5 — Transition Layer Addendum

V5 replaces spreadsheet-only staging with client-scoped, source-keyed import
profiles. Every import keeps its raw payload, mapping version, validation result,
repair state and replay audit.

The first profile is **CEO Dashboard / Callyzer + Daily Update**. Call logs become
canonical V4 lead activities only after client identity, contact key and stage
mapping pass validation. Daily reports are retained as source evidence and are
not treated as verified cash or authoritative revenue.

## Non-negotiables

- Source data is immutable after staging.
- A source record key is required for idempotency.
- Client ownership is chosen on the profile, never inferred from a spreadsheet.
- Unknown CRM stages go to repair; they are never guessed.
- V5 writes to V4 canonical records, not a second revenue schema.
- Client/closer portals remain V6.
