# Rich Alloys purchase portal (v2)

V-BOG build for Rich Alloys. Read `PRD.md` first: context, decisions, requirements, UI rules, plan, open questions.

## Deploy

**Your Supabase project already has an earlier version (v1 or v2) and only test data:**
1. SQL editor: run `supabase/reset_all.sql` once. Login accounts and uploaded files are kept.
2. SQL editor: paste all of `supabase/setup.sql` and run it once.
3. Run `supabase/add_user.sql` again for each person (edit the three values each time).

**New, empty project:** skip step 1.

Then:
4. Optional demo data: `supabase/test_data/ogo_po082.sql` (never in production).
5. Authentication settings: public sign-ups off.
6. Put the project URL and anon key in `deploy/config.js` and upload the `deploy/` folder to your host.

7. Staff function (needs the Supabase CLI and an access token):
   `supabase functions deploy staff-admin --project-ref <ref> --no-verify-jwt --use-api`
   Then add everyone else from the app: **Admin > Staff**. `add_user.sql` is only for the first admin.

Passwords cannot be seen by anyone, including V-BOG; a lost one is reset in Admin > Staff and shown once.

Publish only the `deploy/` folder. The rest of this folder (PRD, SQL, test data) holds client details. Today GitHub Pages publishes the whole repo, so it is public too (PRD decision 28).

## Develop

```bash
cd web && npm install && npm run dev        # keys in web/public/config.js
npm run build && rm -rf ../deploy && cp -r dist ../deploy
```

After editing `supabase/migrations/`, run `./build_setup.sh`. `setup.sql` is for a fresh project; once real data exists,
ship changes as a new migration file and run only that.

## Test

- `tests/run_local.sh` — database: Ogo figures, cash plan, stock, permissions, payment flow, v1 upgrade. Must print `ALL CHECKS PASSED`.
- `tests/e2e/` — the real app in a browser as five staff members. See its README.
