# Pravah application

Open `index.html` directly or serve this folder with any static server.

V1 connects the product shell to the existing Closer-Match Supabase project.
It uses approved staff authentication, default-deny Row Level Security, and
audited write functions.

## Test

From this directory:

```bash
node test/report-parser.test.cjs
node test/v1-contract.test.cjs
```

## Current workflows

1. Sign in using an approved Nikash staff account.
2. Add or select clients already shared with Nikash.
3. Record a placement against an assessed candidate and client role.
4. Start and update ten-day training.
5. Set closer targets.
6. Paste and normalize WhatsApp reports into live performance records.
7. Copy concise updates back to WhatsApp and mark them shared.
8. Record client check-ins, create actions, and close completed actions.

Run the one-time SQL setup in [`../supabase/`](../supabase/) before first use.
Only the Supabase publishable key is permitted in browser code.
