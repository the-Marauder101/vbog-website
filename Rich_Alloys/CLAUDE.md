# Rich Alloys purchase portal: instructions for Claude Code

Read PRD.md first. It is the single source for what to build and why. If something you are asked to do contradicts it,
say so before coding, and update PRD.md in the same change as the code.

Rules:
- All money and weight maths lives in SQL (supabase/migrations). Screens capture and display only.
- Never invent weights, rates or amounts. Test data comes only from client documents (supabase/test_data, PRD section 6 and 7a).
- Tally is the book of record; the portal is the source document. See PRD section 3a before adding any screen that
  re-enters something already kept in Tally.
- Purchase side, one site. Flag anything that reaches into sales, imports or other sites.
- Every migration change: run ./build_setup.sh, then tests/run_local.sh must print ALL CHECKS PASSED.
- Every UI change: tests/e2e/run.py must pass (see tests/e2e/README.md; PostgREST and Python Playwright come from the
  environment's setup script). Check screens at 360 px and in Hindi.
- setup.sql is for a fresh project. Once real data exists, ship schema changes as a new numbered migration only.
- Only deploy/ should be public, but today GitHub Pages publishes the whole V-BOG website repo, so this folder is public
  too (PRD decision 28). Never commit client spreadsheets, invoices or photos; keep them in Project files.
- Done: PRD 7a, 7b, 7c, 5a (unbooked trucks, late bookings), 5b (rate history, invoice rate decisions) and 5c (holds,
  onboarding, reminders, PO, lot table, stock position). Next: onboarding steps, DN/CN and PO designs from Depesh, the
  lot dashboard, the iPhone and Android apps (PRD 10a), answers to PRD section 13, then the parallel run.
