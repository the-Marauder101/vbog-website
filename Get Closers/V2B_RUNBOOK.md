# Pravah V2B deployment and operator runbook

V2B connects explicit placed-candidate handoffs from Vyom to Pravah and writes
training, placement and 3/6/12-month outcome milestones back to the source Vyom
card. Long-term outcomes remain canonical in Nikash's shared database.

## Before deployment

- Confirm V1 and V2A are live.
- Confirm the `pravah-sync-vyom` function has `VYOM_SUPABASE_URL` and
  `VYOM_SERVICE_ROLE_KEY` configured as server-side secrets.
- Confirm at least one Vyom client has been explicitly linked to its Pravah
  client. Candidate handoff cannot complete without this link.
- Do not paste service keys or personal access tokens into SQL, browser code,
  GitHub, screenshots or operator notes.

## Deployment order

1. In the **Vyom** Supabase project, run
   `internal/pm/sql/21_pravah_candidate_outbox.sql`.
2. In the **Closer-Match / Pravah / Nikash** Supabase project, run
   `Get Closers/supabase/05_v2b_candidate_outcomes.sql`.
3. In that same project, run `Get Closers/supabase/06_verify_v2b.sql` and confirm
   the expected objects, grants and policies.
4. Deploy the updated `Get Closers/supabase/functions/pravah-sync-vyom`
   function to the Closer-Match project.
5. Deploy the Vyom and Pravah frontend files.

This order is mandatory: the updated function reads and writes V2B objects in
both projects.

## First end-to-end smoke test

Use one real closer who has actually joined. Do not create a fake production
candidate or outcome.

1. In Vyom, open the candidate card and confirm its client and email where
   available.
2. Move the card to **Placed - Handoff to Pravah**.
3. In Pravah, open **Data & connections** and select **Refresh from Vyom**.
4. Find the candidate in **Placed-candidate handoffs**.
5. Verify the correct existing Nikash candidate. A suggested name is not proof.
6. Confirm the client is linked. If it is not, link the client first.
7. Select the correct open client requirement, enter the actual joining date
   and complete the handoff.
8. Confirm the placement appears in **Training & placements**.
9. Start or update training, refresh the integration, and confirm the source
   Vyom card shows the Pravah milestone chip and detail.
10. For an outcome that is genuinely due, record the checkpoint in Pravah and
    confirm it appears in Nikash placement outcomes and on the Vyom card.

## Reconciliation rules

- **No candidate match:** leave the handoff pending until the candidate exists
  in Nikash. Pravah must not create the candidate.
- **Ambiguous suggested match:** inspect the source details and explicitly link
  the right identity. Never accept a normalized-name suggestion blindly.
- **No client or requirement:** link/activate the Vyom client first, then create
  or select the correct requirement in Nikash/Pravah.
- **Wrong handoff:** an admin may ignore the inbox item with a reason; do not
  delete source recruitment history.
- **Failed Vyom writeback:** leave the event in failed state and refresh again
  after correcting the connection. Delivery attempts and the latest error are
  retained.
- **Wrong outcome:** correct it through the controlled outcome workflow. Do not
  alter frozen placement references or erase audit history.

## Safe rollback

After real data exists, do not drop V2B tables or rewrite applied migrations.
If outbound sync must be paused, roll back the Edge Function version or stop
invoking it while preserving queued events. If candidate intake must pause,
stop moving cards to the explicit handoff state. Ship corrective changes as a
new forward migration.

## Evidence to retain

- output of `06_verify_v2b.sql`;
- Edge Function deployment version;
- the source Vyom card used for the smoke test;
- the linked candidate, client requirement and placement IDs;
- confirmation of one delivered milestone;
- confirmation that no key or token entered frontend assets or commits.
