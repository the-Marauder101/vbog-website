# Rich Alloys purchase portal

V-BOG build for Rich Alloys (Palghar). Read `PRD.md` first: it holds the context, decisions, requirements,
UI rules, build plan and open questions.

## Deploy in six steps

1. Create a **new, empty** Supabase project.
2. SQL editor: paste all of `supabase/setup.sql` and run it once.
3. Optional demo data: run `supabase/test_data/ogo_po082.sql` (never in production).
4. Authentication: turn off public sign-ups. Add each user, then run `supabase/add_user.sql` (edit the three values) to give them a role.
5. Paste the project URL and anon key into `deploy/config.js`. Never the service_role key.
6. Upload the `deploy/` folder to any static host (a subdomain such as `richalloys.v-bog.com` is best).

With `config.js` left empty the app runs in demo mode on sample data, so the screens can be shown before Supabase exists.

## Develop

```bash
cd web
npm install
npm run dev                                   # keys in public/config.js, or leave empty for demo mode
npm run build && rm -rf ../deploy && cp -r dist ../deploy
```

After editing any file in `supabase/migrations/`, run `./build_setup.sh` to regenerate `supabase/setup.sql`.
`setup.sql` is for a fresh project; on a project that already has data, run only the new migration.

## Test

```bash
tests/run_local.sh        # needs local Postgres 15+ and psql; must print ALL CHECKS PASSED
```

## Not yet verified on a live Supabase project

Sign-in, file upload and the storage rules have only been checked against local stand-ins. After step 6,
sign in, upload a photo, view it, verify, approve, and reject one with a reason.
