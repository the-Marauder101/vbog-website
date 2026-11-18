# Rich Alloys purchase portal

V-BOG build for Rich Alloys (Palghar). Read `PRD.md` first: it holds the context, decisions, requirements,
UI rules, build plan and open questions.

## Deploy in six steps

1. Create a **new, empty** Supabase project.
2. SQL editor: paste all of `supabase/setup.sql` and run it once.
3. Optional demo data: run `supabase/test_data/ogo_po082.sql` (never in production).
4. Authentication: turn off public sign-ups. Deploy the staff function:
   `supabase functions deploy staff-admin --project-ref <ref> --no-verify-jwt --use-api`.
   Create the first admin in Authentication > Users, then run `supabase/add_user.sql` (edit the three values).
   Add everyone else from the app: **Staff > Add staff**.
5. Paste the project URL and anon key into `deploy/config.js`. Never the service_role key.
6. Upload the `deploy/` folder to any static host (a subdomain such as `richalloys.v-bog.com` is best).

With `config.js` left empty the app runs in demo mode on sample data, so the screens can be shown before Supabase exists.

## Staff and passwords

- The staff list is the `profiles` table (Supabase > Table Editor > profiles): name, login, role, active, created.
- Passwords cannot be seen by anyone, including V-BOG. Supabase stores only a one-way hash. The app shows a
  temporary password once when a login is created or reset; if it is lost, reset it from the Staff screen.
- Staff without email get a short login ID (e.g. `sanjay`) and sign in with just that.

## Develop

```bash
cd web
npm install
npm run dev                                   # keys in public/config.js, or leave empty for demo mode
npm run build && cp ../deploy/config.js /tmp/ra-config.js && rm -rf ../deploy && cp -r dist ../deploy && cp /tmp/ra-config.js ../deploy/config.js
```

Screens: `App.tsx` (sections) → `Deals`, `DealPage` (tabs: `DealDocs`, `Weights`, `DebitNotes`, `PaymentTab`), `Payables`, `Tally`, `Admin`.
Data calls: `api.ts` (sign-in, documents, staff) and `data.ts` (everything else, live only). Uploads: `uploads.ts`.

After editing any file in `supabase/migrations/`, run `./build_setup.sh` to regenerate `supabase/setup.sql`.
`setup.sql` is for a fresh project; on a project that already has data, run only the new migration.

## Test

```bash
tests/run_local.sh        # needs local Postgres 15+ and psql; must print ALL CHECKS PASSED
```

## Live project

Supabase project `Rich Alloys` (ref `rqxjjrpngybglmhzlmtj`, Mumbai). `deploy/config.js` points at it.
It holds the Ogo demo deal: delete it before staff start entering real deals. See PRD section 11.
