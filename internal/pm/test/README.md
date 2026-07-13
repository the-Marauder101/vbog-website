# Vyom E2E test suite

`e2e.js` drives the real UI (Playwright + Chromium) against the **live Supabase
backend**. It creates namespaced test data ("E2E Test Project", "E2E Temp",
"E2E External", "E2E Tag", "E2E Sub Client"), pre-cleans leftovers from crashed
runs, and deletes
everything at the end — your real projects and tasks are never touched.

## Run it

```bash
# 1. serve the repo root (from the repository root directory)
python3 -m http.server 8787 &

# 2. install playwright once (any recent version; downloads Chromium on install)
npm install playwright

# 3. run the suite
SUPA_MGMT_TOKEN=<your-supabase-personal-access-token> node internal/pm/test/e2e.js
```

- `SUPA_MGMT_TOKEN` is optional — without it, the four webhook-delivery checks
  fail with `mgmt query 401` (they read pg_net's delivery log via the Supabase
  Management API); everything else still runs. **Never commit this token.**
- `VYOM_BASE` overrides the app URL (default `http://127.0.0.1:8787/internal/pm`).
- `VYOM_SHOTS` overrides where failure screenshots are written (default: this folder).
- `VYOM_CHROMIUM` points at a pre-installed Chromium binary if the
  playwright-managed download isn't available (e.g. sandboxed environments).

Expected output ends with `==== 56/56 passed ====` and exit code 0.
(The sub-client status-inheritance steps need `sql/12_status_inheritance.sql`
applied to the live database first.)

## Conventions when adding tests

- Wrap each check in `await step("name", async () => { ... })` — failures
  screenshot automatically and don't stop the run.
- Drive the custom dropdowns with the `choose(selectId, {label|value})` helper —
  the native `<select>` elements are hidden (see ARCHITECTURE.md §5.2).
- Assert database outcomes through `rest(path, opts)` (runs `sbFetch` inside the
  page) — not through UI state alone.
- Scope every count assertion to the E2E project; live user data must never
  affect a test result.
- Clean up any rows you create, and add matching pre-clean lines at the top so
  a crashed run can't poison the next one.
