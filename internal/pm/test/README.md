# Vyom E2E test suite

`e2e.js` drives the real UI (Playwright + Chromium) against the **live Supabase
backend**. It creates namespaced test data ("E2E Test Project", "E2E Temp",
"E2E External", "E2E Tag", "E2E Sub Client", "E2E Channel", "E2E Report",
"E2E Acme Corp"), pre-cleans leftovers from crashed
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

Expected output ends with `==== 105/105 passed ====` and exit code 0.
(The sub-client status-inheritance steps need `sql/12_status_inheritance.sql`
applied to the live database first; the hidden-column, Stage Date and change-log
steps need `sql/14_hidden_statuses_changelog.sql`; the daily-report steps need
`sql/15`–`sql/16`, the client-tracker steps `sql/17`, and the client-registry and
report-type steps `sql/18_report_types_clients.sql`; the client rename and
tracker-dropdown steps need `sql/19_client_hub.sql`.)

**Run one copy at a time.** The suite talks to the live database, and its pre-clean
deletes anything named `E2E*` — so a second concurrent run wipes the first one's
fixtures mid-flight and both collapse into failures that have nothing to do with the
code.

## Conventions when adding tests

- Wrap each check in `await step("name", async () => { ... })` — failures
  screenshot automatically and don't stop the run.
- Drive the custom dropdowns with the `choose(selectId, {label|value})` helper —
  the native `<select>` elements are hidden (see ARCHITECTURE.md §5.2).
- Assert database outcomes through `rest(path, opts)` (runs `sbFetch` inside the
  page) — not through UI state alone.
- Scope every count assertion to the E2E project; live user data must never
  affect a test result.
- **Scope row locators to their table** (`#members-table tr`, not `tr`). Settings
  now renders several tables, and the Clients table's Owner dropdown contains
  every member name — so a page-wide `tr` filtered by a person's name matches
  client rows too.
- Clean up any rows you create, and add matching pre-clean lines at the top so
  a crashed run can't poison the next one.
