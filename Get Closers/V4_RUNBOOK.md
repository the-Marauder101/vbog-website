# Pravah V4 Runbook

## Deployment order

1. Merge the V4 pull request.
2. In the existing Closer-Match Supabase project, run:
   - `supabase/11_v4_revenue_engine.sql`
   - `supabase/13_v4_revenue_operations.sql`
3. Run `supabase/12_verify_v4_revenue.sql`.
4. Open `/Get%20Closers/pravah/revenue/` and sign in with an approved internal
   Pravah account.
5. Verify the dashboard loads with no records and no permission errors.
6. Create one **real** lead, log one real activity, create one real deal, and
   record a real sale/payment only when the operating record actually exists.
   Do not manufacture production revenue merely to test the workflow.
7. Verify one payment against real evidence and confirm that verified cash is
   reflected in the dashboard.

## Verification expectations

`12_verify_v4_revenue.sql` should show:

- seven revenue tables;
- RLS enabled and forced on all seven;
- eight active canonical stages;
- all V4 write/dashboard functions present;
- read policies restricted to internal Pravah staff.

## Operating rules

### Lead

Create one canonical lead per customer/client combination. Preserve the source
system and source record key whenever the record came from another system.

### Activity

Calls and other customer interactions are activities attached to the canonical
lead. A source key makes future imports idempotent.

### Deal

A deal is pipeline until it becomes won. Changing a stage does not create
revenue.

### Sale

A sale is booked revenue. It is not proof of cash collection.

### Payment

A payment starts as pending. Only a permitted verifier can mark it verified.
The evidence URL/note should point to the actual client, CRM, payment or receipt
evidence.

### Refund / cancellation / write-off

Use an adjustment against the sale rather than editing history to make the
numbers look right.

## Failure handling

- **Client mismatch:** stop. Do not create a duplicate client; use the existing
  client identity from the canonical client registry.
- **Closer mismatch:** stop. A placement must belong to the selected client.
- **Duplicate source key:** the write contract returns the existing canonical
  record instead of creating a duplicate.
- **Payment without evidence:** leave it pending; do not count it as official cash.
- **Uncertain source mapping:** wait for V5 mapping/reconciliation rather than
  forcing a best-effort field match.

## Rollback

V4 migrations are additive. If V4 must be disabled, stop linking the revenue
workspace from navigation and revoke execution of the V4 RPCs for authenticated
users. Do not delete canonical revenue records as a rollback mechanism.

Dropping the V4 tables is intentionally not an operator step because V4 records
may already be referenced by downstream reporting.

## Next release

V5 adds the transition layer for heterogeneous Google Sheets/CSV/CRM sources.
It should write into the V4 canonical model through source-keyed contracts and
never create a second revenue schema.
