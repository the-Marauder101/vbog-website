# Pravah database setup

Pravah V1 uses the same Supabase project as Nikash so candidates, clients,
requirements, predictions, and frozen placement references do not need to be
copied between databases.

## Point-and-click setup

1. Sign in to Supabase.
2. Open the existing **Closer-Match** project.
3. Open **SQL Editor** and choose **New query**.
4. Copy all of `01_pravah_core.sql`, paste it, and press **Run** once.
5. Open another new query, paste `02_verify_pravah_core.sql`, and press **Run**.
6. Confirm the verification results match the notes above each query.
7. Sign into Pravah using an existing approved Nikash staff login.

## V2A activation

After V1 is active:

1. Run `03_v2a_operational_hardening.sql` in the Closer-Match project.
2. Run `04_verify_v2a.sql` and confirm every expectation.
3. Run `internal/pm/sql/20_pravah_client_outbox.sql` in the Vyom project.
4. Deploy `functions/pravah-sync-vyom` to the Closer-Match project.
5. Configure `VYOM_SUPABASE_URL` and `VYOM_SERVICE_ROLE_KEY` as Edge Function
   secrets. Never place either value in frontend code or GitHub.
6. Open Data & connections in Pravah, refresh the inbox, and verify links.

The project maintainer can perform steps 1–5 through the deployment tooling;
operators only use the point-and-click refresh and link controls.

## V2B activation

After V2A is live, follow [`../V2B_RUNBOOK.md`](../V2B_RUNBOOK.md). The required
order is:

1. run `internal/pm/sql/21_pravah_candidate_outbox.sql` in Vyom;
2. run `05_v2b_candidate_outcomes.sql` in Closer-Match;
3. run `06_verify_v2b.sql` in Closer-Match;
4. deploy the updated `functions/pravah-sync-vyom` function;
5. deploy the frontend and complete the smoke test.

The Vyom migration must precede the updated function because the function reads
the new candidate handoff view and writes to the new milestone-receipt table.

The migrations are idempotent and can be re-run. They do not contain sample
clients, fake closers, passwords, secret keys, or destructive cleanup.

## First-user rule

The migration copies already linked, active Nikash staff into Pravah access:

- Nikash `admin` → Pravah `gc_admin`
- other active Nikash staff → Pravah `operations`

Creating a Supabase Auth account by itself grants no access. A person must have
an approved active membership.

## Rollback approach

Do not drop the tables after real data exists. If V1 must be paused, disable
memberships instead:

```sql
update pravah_memberships set active = false;
```

This preserves every operational and audit record while making the application
inaccessible. A future corrective migration should be appended rather than
rewriting a migration that has already run.
