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

The migration is idempotent and can be re-run. It does not contain sample
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
