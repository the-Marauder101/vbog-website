# Pravah V2A Deployment and Operator Runbook

This runbook is written so a future maintainer can deploy, verify, test and
recover V2A without returning to the original conversation.

## What V2A changes

- Vyom becomes the source of client identity.
- Pravah receives a refreshable client inbox and requires verified linking.
- closer reports use fixed questions;
- reported cash is separated from verified cash;
- clients gain check-in/action history and notes;
- corrections use archive, void, complete or cancel instead of silent erasure.

## Deployment order

Do not publish the V2A frontend before its database migration is active.

1. Deploy `supabase/03_v2a_operational_hardening.sql` to the Closer-Match
   (Nikash/Pravah) Supabase project.
2. Run `supabase/04_verify_v2a.sql`.
3. Deploy `../internal/pm/sql/20_pravah_client_outbox.sql` to the Vyom Supabase
   project.
4. Deploy `supabase/functions/pravah-sync-vyom` to the Closer-Match project.
5. Set the following Edge Function secrets:
   - `VYOM_SUPABASE_URL`
   - `VYOM_SERVICE_ROLE_KEY`
6. Publish the static Pravah frontend.
7. Sign in as a Get Closers administrator and complete the smoke test below.

The Supabase project automatically supplies `SUPABASE_URL`,
`SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` to its Edge Function. None
of these values belongs in GitHub or browser code.

## Smoke test

1. Open **Data & connections** and press **Refresh from Vyom**.
2. Confirm current Vyom clients appear without exposing integration secrets.
3. Pick one client with an obvious existing Nikash record and verify the link.
4. Activate one client with no existing Nikash record.
5. Confirm neither action creates a duplicate after another refresh.
6. Open an active closer and submit the fixed-question report form.
7. Copy the generated WhatsApp summary.
8. Confirm reported cash is marked `unverified`.
9. Verify the cash with a source and reference; confirm the official cash total
   changes only now.
10. Add a client check-in with two actions and different due dates.
11. Complete one action with a completion note and cancel the other with a
    cancellation reason.
12. Void a test report and confirm it remains visible but leaves KPIs.

## Handling a possible duplicate

Never decide from spelling alone. Compare the Vyom client context with the
existing Nikash client/requirement. Use **Choose existing** only when they are
the same organization. Otherwise activate a new client.

## Corrections and deletion

- Use **Void** for an incorrect placement or report.
- Use **Archive** when a client engagement ends.
- Use **Cancel** for an action no longer required.
- Permanent client deletion is an admin-only convenience for an unused record.
  The database refuses deletion if any requirement, history, action or Vyom
  link exists.

## Rollback

Do not drop V2A tables after real data exists.

1. If the Vyom bridge fails, leave the inbox in place and disable or undeploy
   only the `pravah-sync-vyom` Edge Function. Pravah core workflows continue.
2. If the frontend must be rolled back, deploy the previous static version.
   The additive V2A columns and tables can remain safely unused.
3. Do not re-enable `pravah_create_client(text)` merely to bypass a sync issue.
   Resolve the bridge or record the client in Vyom first.
4. Never delete verification, void or audit records as rollback.

## Current access boundary

Only approved internal staff can use V2A. Client and closer memberships remain
dormant until their own restricted views and portals are implemented. This is
intentional, not an incomplete RLS workaround.
