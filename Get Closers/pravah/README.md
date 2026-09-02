# Pravah application

Open `index.html` directly or serve this folder with any static server.

V1 connects the product shell to the existing Closer-Match Supabase project.
V2A hardens the first live workflows and introduces the verified Vyom client
inbox.
It uses approved staff authentication, default-deny Row Level Security, and
audited write functions.

## Test

From this directory:

```bash
node test/report-parser.test.cjs
node test/v1-contract.test.cjs
node test/v2a-contract.test.cjs
```

## Current workflows

1. Sign in using an approved Nikash staff account.
2. Refresh the Vyom client inbox and verify a link or activation.
3. Record a placement against an assessed candidate and client role.
4. Start and update ten-day training.
5. Set closer targets.
6. Complete the fixed-question report form.
7. Copy the generated update back to WhatsApp.
8. Verify cash only against retained CRM/Sheet/payment evidence.
9. Record client check-ins with one or more owned actions.
10. Complete or cancel actions with a closure note.

Client and closer memberships are intentionally not activated in V2A. Their
restricted portals arrive only after purpose-built safe read models exist.

Run the one-time SQL setup in [`../supabase/`](../supabase/) before first use.
Only the Supabase publishable key is permitted in browser code.
