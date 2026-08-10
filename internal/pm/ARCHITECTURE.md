# Vyom — Architecture & Developer Handbook

> **Read this before changing anything.** It explains how every piece works, the
> conventions that keep the app stable, and the traps previous builds already hit
> (so you don't hit them again). The README covers *what Vyom does*; this file
> covers *how it's built*.

Last updated: v19 (August 2026) — daily Slack reports + a central Slack channel
registry, and the app's first scheduled job (pg_cron). Previously: v18 (July 2026) — hideable status columns, the HR **Stage Date**
(no due dates on candidate cards), and a database-written **change log** for every
task; plus the v16 client tags and the v14 status reordering, guided transition
mapping, and sub-client status inheritance.

---

## 1. The 60-second overview

Vyom is a **static frontend + Supabase backend**, no framework, no build step:

- **Frontend**: plain HTML/CSS/JS in this folder. Deployed by GitHub Pages with the
  main site — push to `main`, live at `v-bog.com/internal/pm/` in ~1 minute.
- **Backend**: Supabase project `mejebezwvyfkhufkgkej` — PostgreSQL with its
  auto-generated REST API (PostgREST). There is **no server of our own**; the browser
  talks straight to the database's REST layer.
- **No SDK**: all data access goes through one 40-line fetch wrapper
  (`js/supabase.js` → `sbFetch()`), and every query lives in `js/api.js`.

```
Browser ── sbFetch() ──> https://<project>.supabase.co/rest/v1/<table>?<filters>
                              │
                              └── Postgres (tables, views, triggers, pg_net webhooks)
```

## 2. File map — what each file is for

| File | Role |
|---|---|
| `login.html` | Sign-in gate (self-contained page, inline script) |
| `vyom.html` | Dashboard — project cards. `index.html` just redirects here |
| `board.html?project=<id>` | Kanban board. `&task=<id>` deep-links open the task modal |
| `team.html` | All Tasks — cross-project master list |
| `settings.html` | Admin-only: users & access, tags registry, Zapier webhooks |
| `js/config.js` | Supabase URL + **Publishable key** (safe for frontend — see §8) |
| `js/supabase.js` | `sbFetch()` — the only network wrapper. All errors surface as readable messages |
| `js/api.js` | Every REST query the app makes, one method per operation. **Add new queries here, never inline fetch in page code** |
| `js/ui.js` | Shared UI kit: toasts, modals, date helpers, field errors, `enhanceSelect()` custom dropdowns |
| `js/auth.js` | Login state (localStorage), page guards, role checks, nav user chip |
| `js/inbox.js` | Bell + slide-in inbox panel (notifications + My Tasks) |
| `js/reports.js` | The per-project daily Slack report: admin button, config modal, preview, test send (§13) |
| `js/changelog.js` | The change log: per-task History in the task modal + the board's project-wide History modal (read-only — §12) |
| `js/dashboard.js` | Page logic for `vyom.html` |
| `js/board.js` | Page logic for `board.html` (drag-drop, task modal, @mentions) |
| `js/team.js` | Page logic for `team.html` |
| `js/settings.js` | Page logic for `settings.html` |
| `css/style.css` | All styles, one file, sectioned with `/* ---------- */` headers |
| `sql/01…14_*.sql` | Migrations, numbered, idempotent — the full schema history |
| `img/vyom.svg` | The logo (also the favicon). Same SVG is inlined in each page's nav |

**Script load order matters** (each page loads, in order):
`config → supabase → api → ui → auth → inbox → changelog → <page>.js`
(the board additionally loads `automations`, `reports`, `hr-roles`, `hr-sla`)
(the board additionally loads `automations`, `hr-roles`, `hr-sla` before `board.js`)
Later files depend on earlier globals (`API`, `UI`, `Auth`, `Inbox`).

## 3. Database schema (Supabase / Postgres)

Run `sql/*.sql` **in numeric order** on a fresh project (SQL Editor). All are idempotent.

| Table | Purpose | Key columns |
|---|---|---|
| `projects` | One per client/workstream | `statuses jsonb` (the Kanban columns, ordered), `type` (`internal`\|`client`), `tags jsonb` (array of tag *names*), `color`, `archived`, `parent_project_id` FK (sql/08 — set = this is a **sub-client** project, one level deep), `inherit_statuses` (sql/12 — sub-client live-inherits the parent's columns, see §7), `hidden_statuses`/`hidden_ops_statuses` (sql/14 — columns an **admin** folded away for the whole project, by name; see §10) |
| `tasks` | The work items | `project_id` FK, `status` (must match a project status — enforced client-side only), `assignee_id` FK, `due_date`, `source` (`manual`\|`zapier`\|`api`), `external_id`, `fields jsonb` (sql/11 — structured per-task data, more keys later WITHOUT migrations: `email` feeds automations, `client` is the task-level client tag — see §7), `status_changed_at` (sql/13 — trigger-maintained; the HR **Stage Date**, see §11), `last_actor_id` (sql/14 — stamped by `api.js` on every write so the changelog trigger knows who acted, see §12), auto `updated_at` trigger |
| `team_members` | Every user (internal and external) | `role` = free-text job title; `user_role` = permission level (`admin`\|`member`\|`external`); `login_code` unique = what they type at the gate; `active` |
| `project_members` | Which projects an **external** user can see | composite PK (`project_id`,`member_id`), both cascade on delete |
| `notifications` | Inbox rows | `member_id` recipient, `kind` (see §6), `actor_id`, `task_id`/`project_id` (cascade — deleting a task cleans its notifications), `message`, `read`, `data jsonb` for future payloads |
| `tags` | Central tag registry | `name` unique — the *only* place tags are created, which is what prevents duplicates |
| `webhooks` | Zapier fan-out targets | `url`, `project_id` (NULL = all projects), `events jsonb`, `active` |
| `automations` | Per-project rules (sql/09) | `project_id` FK (rules NEVER cross projects), `trigger_type`, `conditions jsonb`, `action_type`, `action_config jsonb`, `active` |
| `api_keys` | Native inbound API keys (sql/10) | `project_id` FK (a key writes to ONE project), `key` unique (`vyom_…`, DB-generated), `label`, `active`, `last_used_at` |
| `hr_roles` / `hr_sla_rules` | HR roles summary card + SLA deadlines (sql/13) | both `project_id` FK, cascade on project delete |
| `slack_channels` | Registry of Slack incoming-webhook URLs (sql/15) — `label` unique, `url`, `active`. The ONLY place a Slack URL is stored; everything references a channel by id |
| `daily_report_configs` | One scheduled report per row, scoped to a project (sql/15) — channel, scope (hiring/ops/both), send time + timezone, days, content toggles, `last_sent_on` |
| `daily_report_runs` | Every run's numbers — the trend series (sql/15). Writes revoked from `anon` |
| `task_changelog` | Every task change, one row per changed FIELD (sql/14) | `task_id` (**ON DELETE SET NULL** — history outlives the task), `task_title`/`actor_name` snapshots, `actor_id`, `action` (`created`\|`updated`\|`deleted`), `field`, `old_value`, `new_value`. **Written only by a trigger**; INSERT/UPDATE/DELETE/TRUNCATE are revoked from `anon` — see §12 |

Also: `task_details` **view** (sql/04) joins human-readable names — used by webhook
payloads. `notify_task_webhooks()` **trigger** (sql/05) fires on task INSERT/UPDATE/DELETE
and POSTs to every matching webhook via `pg_net` — async, so task writes never block.

Triggers/RPCs added later: `run_task_automations()` (sql/09) fires AFTER INSERT/UPDATE on
tasks and executes matching `automations` rows — webhook POST via `pg_net`, task moves,
assignment, or inbox notifications (kind `automation`); every action is exception-wrapped so
a bad rule never blocks a save, and `pg_trigger_depth() > 2` stops rule chains from looping.
`send_test_automation()` mirrors `send_test_webhook()`. `log_task_changes()` (sql/14) fires AFTER INSERT/UPDATE/DELETE on tasks and writes the
change log; `delete_task_logged()` (sql/14, RPC) is how the frontend deletes a task, so the
log can record *who* deleted it. `ingest_task()` (sql/10, RPC,
recreated in sql/11 and sql/12) is the native inbound API: validates an `api_keys` row,
resolves the **effective** status list (the parent's for inheriting sub-clients), defaults
an unknown status to its first column, inserts the task with `source: "api"`.

**RLS is enabled but open** (`USING (true)`) on every table — Phase-1 trade-off, see §8.

## 4. Auth model — a gate, not a vault

- `login.html` looks up `team_members` by `login_code` (case-insensitive, active only)
  and stores `{id, name, user_role}` as `vyom_user` in **localStorage**. That's the
  whole session. Logout = remove the key.
- Every page script starts with `if (!Auth.requireLogin()) return;` —
  settings uses `Auth.requireAdmin()`. Then `Auth.initNav()` (user chip, hides
  Settings link for non-admins) and `Inbox.init()` (bell + panel).
- **Roles**: `admin` (everything + Settings) · `member` (all projects) ·
  `external` (only projects granted in `project_members`; no create/edit project,
  no Settings). `Auth.allowedProjectIds()` returns `null` for admin/member
  (= unrestricted) or an array for externals — every page filters through it.
- ⚠️ **This is UX-level access control, enforced in the browser.** Anyone with the
  publishable key can hit the REST API directly. Acceptable for an internal tool;
  the upgrade path (§9) is Supabase Auth + real RLS policies — the schema already
  fits that without remodeling (e.g. policies can key off `team_members`).

## 5. Frontend conventions — follow these or things break

1. **All queries live in `js/api.js`** as small named methods returning promises.
   PostgREST filter syntax: `tasks?project_id=eq.X&select=*,projects(name)`.
2. **Custom dropdowns**: never style a raw `<select>`. Call `UI.enhanceSelect(sel)` —
   it hides the native select (kept as the source of truth for `.value` and `change`
   events) and builds a styled `.dd` widget. **Re-call it after repopulating options**,
   and call `UI.syncSelect(sel)` after setting `.value` programmatically.
3. **`[hidden]` always wins**: `style.css` has `[hidden]{display:none !important}`.
   History: badges/buttons with `display:flex` silently ignored the `hidden`
   attribute and caused real bugs. Don't remove this rule.
4. **Cache busting**: every CSS/JS reference carries `?v=N`. **Bump N in all five
   HTML files on every release** — GitHub Pages caches ~10 min and users will
   otherwise run mixed old/new code (this caused "API.x is not a function" bugs).
   Current version: `v=18`.
5. **Escape everything**: any user data inserted via innerHTML goes through
   `UI.esc()`. No exceptions.
6. **Optimistic, in-place updates in async handlers** — the hard-won rule:
   *never mutate the DOM after an `await` if the user could have acted in between.*
   Update the UI at click time, then fire the network call; on failure, revert +
   toast. Also prefer updating one row in place over re-rendering a whole list
   (`applyReadState()` in inbox.js is the pattern). Violations caused three real
   bugs: mark-all-read reverting a fresh toggle, settings' initial load wiping a
   just-added member (fixed by disabling form buttons until load completes), and
   stale panel fetches clobbering toggles (fixed by an epoch counter in
   `inbox.js#open()`).
7. **Toasts for outcomes, field errors for validation** — `UI.toast(msg, "success")`
   / `UI.fieldError(input, msg)`. Errors from `sbFetch` are already human-readable.
8. **Status columns are per-project data**, not code. Board columns render from
   `project.statuses` (chips in the project modal — drag to reorder; the **last**
   column is what My Tasks treats as "done"). Editing a project's columns runs a
   **transition mapping** step: any task — in that project or a live-inheriting
   sub-client — whose status is missing from the new list must be mapped to a
   destination before the save goes through (`dashboard.js buildRemapUI()` +
   `API.moveTasksByStatus()`). A task can still end up orphaned by out-of-app
   writes; it then shows in a dimmed "(removed)" column — never silently hidden —
   and the next project edit offers to clean it up.
9. **Effective statuses**: never read `project.statuses` raw when the project may
   be an inheriting sub-client — resolve through `UI.effectiveStatuses(project,
   parent)` (board.js does this once at load, so everything downstream —
   automations editor included — sees the resolved list).

## 6. The inbox — how to extend it

`js/inbox.js` renders the bell + slide-in panel on every page.

- **Notification kinds** are a registry: `KIND_META = { mention: {...}, task_assigned: {...} }`.
  **To add a new kind**: add one entry there (icon + label), and insert rows via
  `API.notify([{member_id, kind, actor_id, task_id, project_id, message}])`.
  Unknown kinds render with a fallback icon, so old clients never crash.
- **Who creates notifications**: the *client that performs the action* (there's no
  server). `board.js#notifyForTask()` fires `task_assigned` (assignee set/changed,
  never self) and `mention` (diffed against previous notes so an edit never
  re-pings). Notifications are fire-and-forget — they never block a task save.
- **My Tasks tab** queries `API.getMyTasks(memberId)` — server-side filtered to the
  user (never fetch all tasks and filter in the browser). "Done" = the task's status
  equals the **last** status in its project's list. Groups cap at 8 rows behind a
  "Show all N" expander (`GROUP_CAP`).
- **@mentions**: plain-text convention — `@Name` in task notes, matched
  case-insensitively against member names (longest first). The composer autocomplete
  is `board.js#initMentionPicker()`.

## 7. Zapier / Google Sheets integration

Self-serve from Settings — teammates never touch Supabase:

- **Outgoing** (task events → Zapier): rows in `webhooks`; the pg_net trigger POSTs
  `{event, task: <task_details row>}` to every active, scope-matching URL.
  "Send test" calls the `send_test_webhook` RPC.
- **Incoming** (Sheets → tasks): plain REST POST to `/rest/v1/tasks` with the
  publishable key. Settings generates copy-paste Zapier setup (real project UUID,
  valid statuses, member IDs). Such tasks carry `source: "zapier"` → teal dot on cards.
- **Native API (Zapier-free, sql/10)**: Settings → "Vyom API" generates per-project keys;
  any script POSTs to `/rest/v1/rpc/ingest_task` with the anon key headers plus
  `{"p_api_key": "vyom_…", "p_title": "…"}`. The API key (not the anon key) picks the
  project. Settings shows ready curl + Google Apps Script snippets. Tasks carry
  `source: "api"` → same teal dot.

### Sub-clients & automations (added later)

- **Sub-client projects**: `projects.parent_project_id` (sql/08). Created from the project
  modal's "Parent project" dropdown (one level deep — enforced in `dashboard.js`
  `fillParentSelect()`). Dashboard nests them under the parent card; the board shows a
  "Sub-client of X" badge; **All Tasks excludes their tasks by default** — the
  "Include sub-client tasks" toggle (persisted as `vyom_show_subclients` in localStorage)
  brings them back, and all counts follow the toggle (`team.js baseTasks()`).
- **Automations**: admin-only ⚡ button on each board (`js/automations.js`) manages rules in
  the `automations` table for THAT project only. Triggers: task created / status changed
  (optionally into a specific status) / assigned / due date set. Actions: POST to webhook
  URL (the email path — point it at Zapier or a Google Apps Script that sends Gmail),
  move task, assign, or inbox-notify. Execution is 100% in Postgres (sql/09), so rules
  also fire for tasks created via the API or Zapier.
- **Client tags (`tasks.fields.client`)**: the lightweight alternative to a sub-client
  project — tag individual tasks with an end-client name instead of spinning up a whole
  child project. Free text with a datalist of names already used in that project (task
  modal, `board.js`). Filterable on the board and All Tasks ("Client" dropdown, which
  hides itself when no tasks carry a client); rows/cards show a teal `client-chip`.
  Stored in the `fields` jsonb container, so it needed **no migration** and flows into
  webhook/automation payloads and `ingest_task`'s `p_fields` automatically. "Clear
  filters" resets it like any other filter.
- **Status inheritance (sql/12)**: a sub-client can **live-inherit** the parent's status
  columns (`projects.inherit_statuses`). Resolution happens at read time —
  `UI.effectiveStatuses()` in the frontend, the same lookup inside `ingest_task()` — so
  editing the parent's columns instantly changes every inheriting child's board. The
  child's own `statuses` array is kept as a **stale snapshot**: written at creation (or
  when switching to custom, which pre-fills a copy of the parent's list), used only as a
  fallback if the parent is deleted (`parent_project_id` goes NULL via `ON DELETE SET
  NULL`) or has an empty list. Consequence: raw REST readers of `projects.statuses` see
  the snapshot, not the live list. Editing a **parent's** columns includes all inheriting
  children's tasks in the transition-mapping step (`API.getInheritingChildren()`), so a
  parent edit can never orphan a child task. Note: each task moved by the mapping fires
  the webhook + `status_changed` automation triggers once — the tasks really did change
  status.

## 8. Secrets & keys

- `js/config.js` ships the **Publishable (anon) key** — that is by design; it's the
  key class Supabase intends for browsers. Combined with open RLS it grants full
  data access (§4 caveat).
- **Never commit the Secret/service-role key or a personal access token** to this
  repo — not in code, not in docs. Migrations are run through the Supabase dashboard
  SQL Editor (or the Management API with a token kept *outside* the repo).

## 9. Testing

The E2E suite lives in **`test/e2e.js`** — Playwright driving the real UI against
live Supabase. **`test/README.md` has the run instructions and the conventions for
adding tests.** Highlights:

- All test data is namespaced ("E2E Test Project", "E2E Temp"…), pre-cleaned at
  start, deleted at the end — **live data must never be touched by assertions**;
  scope all counts to the test project.
- Drive the custom dropdowns via their `.dd-btn`/`.dd-item` elements (native selects
  are hidden). Assert outcomes in the DB via `sbFetch` inside the page.
- Keep the suite green: every new feature ships with tests (see `test/README.md`
  for the current expected pass count — **85** as of v19).

## 10. Hideable status columns (v18)

A board can be tidied without touching any data. `renderBoard()` simply skips a
hidden status; **nothing is moved, archived or deleted**.

- **Two layers, decided by role.** An **admin** toggling a column writes
  `projects.hidden_statuses` (or `hidden_ops_statuses` for the Ops tab) — a shared
  decision, so everyone's board matches. **Everyone else** writes
  `localStorage["vyom_hidden_cols_<projectId>"]` (`{hiring:[…],ops:[…]}`) — their own
  view only. What a user doesn't see is the **union** of the two, and a non-admin
  cannot unhide an admin's column (that row renders disabled, labelled
  "hidden for everyone").
- **Names, not indexes** — status lists are reorderable. The cost is that a rename
  or removal would leave a stale entry that later hides the wrong column, so
  `dashboard.js` **prunes both arrays on every project save** against the new
  status list. Keep that pruning if you touch the project form.
- **Invariants worth preserving**: the last visible column can't be hidden (an empty
  board reads as broken); the `#hidden-cols-pill` always states how many columns and
  how many tasks are parked out of view; hidden statuses stay **selectable** in the
  task modal (marked "(hidden)") with a toast when you file a card into one; and
  `(removed)` orphan columns are never hideable.

## 11. The HR Stage Date (v18)

HR candidate cards have **no due date**. A hiring pipeline doesn't have deadlines
per card — what matters is *how long has this candidate sat here* — so the field is
replaced by a read-only **Stage Date**: `tasks.status_changed_at`, maintained by the
sql/13 trigger, falling back to `created_at`.

- **Never editable by hand.** It is a measurement, not a plan. It's set when the card
  is created and rewritten on every status change, including moves made by drag-drop,
  automations, Zapier and the API. Its full history is in the change log (§12).
- Gated by the per-project `features.auto_date` flag (labelled "Stage Date instead of
  due dates" in the project modal) via `UI.stageDateMode(project, task)`. **Ops-tab
  cards are excluded** — that's ordinary internal work and keeps real deadlines.
- Consequences to respect: the pill is styled deliberately *unlike* `.due` and must
  **never** turn red — "overdue" is meaningless here. The board's due-date filter
  hides itself (and resets to "All dates") in Stage Date mode. Saving a stage-date
  card writes `due_date: null`, so switching a project to Stage Date clears due dates
  as cards are saved — the change log records each one. Sorting flips to
  oldest-in-stage first, which matches what the SLA flags are for. My Tasks still
  groups by due date, so stage-dated cards land under "No due date".
- **The board's date filter is not removed in this mode — it is re-vocabularised.**
  `fillDateFilter()` swaps `UI.dateFilterOptions` for `UI.stageFilterOptions`
  ("Entered today", "In stage 7+ days", …) and `renderBoard()` matches with
  `UI.matchesStageFilter()` instead of `matchesDateFilter()`. v18 originally *hid*
  the control, which read as "the filters are broken" — don't do that again. The
  HR tab switch rebuilds it, and a selection with no meaning in the new vocabulary
  (`stale7` on an Ops tab) falls back to "all" rather than silently hiding every
  card. All filters remain ANDed.

**SLA rules read the same timestamp** (`hr_sla_rules`, sql/13): "cards in status X
must move within N days", flagged on the card as `sla-warning` (≥75% of the deadline)
or `sla-breach`. Three traps, all fixed in v18 — don't reintroduce them:

1. `board.js` must **await** `HrSla.init()` before the first `renderBoard()`. It
   fetches the rules, so an un-awaited init paints an unflagged board and the flags
   only appear once something else re-renders it.
2. The rules must load for **every** user. Only the rule *editor* (the SLA Rules
   button and modal) is admin-only — the flags are for whoever works the board, and
   putting the fetch behind the admin check meant members never saw one.
3. A hidden column can hide a breach, which defeats the point of an SLA. The
   hidden-columns pill therefore counts flagged cards that are out of view and turns
   amber when there are any.

## 12. The change log (v18)

`task_changelog` records **every** change to **every** task in **every** project —
one row per changed field, so "Depesh moved R1 Selected → R2 Rejected" is one row.

- **Written by a Postgres trigger, not by the client.** That's the whole design: work
  arriving from Zapier, the Vyom API or an automation rule is logged identically to a
  click, and no page can forget to log. Bookkeeping columns (`updated_at`,
  `status_changed_at`, `last_actor_id`) are not tracked, so stamping the actor alone
  never writes a row. `fields` jsonb is diffed **per key**, so future keys are logged
  with no migration.
- **Attribution without a server**: `api.js` merges `last_actor_id` into every task
  INSERT/PATCH (same request — no extra round trip, no phantom webhook fires). Deletes
  can't work that way (the row is gone before the trigger reads it), so
  `API.deleteTask()` calls the `delete_task_logged` RPC, which puts the actor in a
  transaction-local setting first. When `pg_trigger_depth() > 1` the change came from
  an automation, so the actor is recorded as "Automation" rather than the last human
  to touch the card; `source` supplies "Vyom API" / "Zapier".
- **History outlives its task**: `task_id` is `ON DELETE SET NULL` and `task_title` is
  a snapshot, so a deleted task's trail survives (deleting a *project* does cascade).
- **Append-only from a browser**: INSERT/UPDATE/DELETE/TRUNCATE are revoked from
  `anon`, so the publishable key can read history but never rewrite it. The trigger is
  `SECURITY DEFINER`, so it is unaffected. **Don't "fix" a permission error by granting
  these back** — that would make the audit trail forgeable.
- **To add a field to the log**: nothing, if it lives in `fields` jsonb. For a new
  column, add one `IF NEW.x IS DISTINCT FROM OLD.x` block to `log_task_changes()` and a
  label to `FIELD_LABELS` in `changelog.js`. Unknown fields already render with a
  prettified key, so old clients never break.

## 13. Daily Slack reports (v19)

A per-project digest posted on a schedule: who added how many cards and into which
stage, who moved what, and where the pipeline stands. Configured from a board button
next to SLA Rules; nobody touches Supabase.

- **Data source is `task_changelog`, not a new pipeline.** `field='status'` alone is a
  card's whole stage history (§12), so the report is a `GROUP BY` — no counters to keep
  in sync, and the report can never disagree with the History modal.
- **Slack URLs live in one place**: `slack_channels`, managed in Settings like the tag
  registry. Reports reference `channel_id`, so rotating a URL is one edit and a new
  Slack message is configuration rather than code. The FK is `ON DELETE RESTRICT` — a
  channel a live report depends on can't be deleted out from under it.
- **One cron job, many timezones.** `cron.schedule('vyom-daily-reports', '*/5 * * * *')`
  runs `run_due_daily_reports()`, which asks each config whether `now()` in *its*
  timezone is past its send time. Cron expressions have no timezone and run in UTC, so
  one job per report would drift by an hour twice a year in any DST zone. Send time is
  stored as `time` + `timezone`, never a timestamptz, for the same reason.
- **Exactly once, three guards.** `send_daily_report()` inserts the `daily_report_runs`
  row *before* posting, in one transaction: the `(config_id, local_date)` unique index
  makes a concurrent second attempt fail before Slack is touched, and because pg_net's
  enqueue is a table insert, a later rollback un-sends it. Then `last_sent_on`
  short-circuits the 5-minute job, and `FOR UPDATE … SKIP LOCKED` stops overlapping
  ticks. Re-running the migration can't double-send: `last_sent_on` lives in a data
  table that `CREATE TABLE IF NOT EXISTS` leaves alone.
- **A config created after its send time claims today** (validation trigger), or setting
  one up at 20:30 would fire five minutes later for a day nobody was measuring.
- **Two traps the aggregation exists to avoid.** Machine actors are filtered **by name**
  (`'Automation','Vyom API','Zapier','Unknown'`), never by `actor_id IS NULL` — actor_id
  is `ON DELETE SET NULL`, so deleting a departed employee would otherwise reclassify
  their work as automation. And `hr_category` lives on `tasks`, not the log, so orphaned
  rows (task deleted the same day) fall back to whether the status name belongs to
  `ops_statuses`.
- **`run_due_daily_reports` is REVOKEd from `anon`** — the publishable key ships in
  `config.js`, and this would otherwise be a "send to everyone" button. Don't grant it.
- Rendering is a pure function (`daily_report_text`), so Send test, the modal preview and
  the real 19:00 send are byte-for-byte identical. `daily_report_reconcile()` runs hourly
  and flips a run to `failed` when `net._http_response` shows Slack rejected it — pg_net
  is fire-and-forget, so without it a revoked webhook would look like success forever.

## 14. Roadmap notes for the next builder

Deliberately not built yet, in rough priority order — the schema anticipates them:

1. **Real auth**: Supabase Auth (magic link or password) mapped to `team_members`,
   then rewrite RLS policies per role. Everything else keeps working.
2. **Client portal polish**: externals already work (role + `project_members`);
   what's missing is invite-flow niceties (e.g. emailing the login link).
3. **New notification kinds**: comments, due-date reminders (`kind` + `data jsonb`
   are ready). pg_cron is now installed (§13), so a scheduled reminder is a new function
   plus one `cron.schedule` line — the hard part is done.
   A "stuck in stage too long" reminder is now cheap — `status_changed_at` is the
   input the SLA rules already use.
4. **Comments on tasks**: new `task_comments` table; reuse the mention parser and
   `notify()`; add a `comment` kind.
5. **Attachments**: Supabase Storage bucket; store paths on tasks.
6. **Mobile layout**: CSS is desktop-first (≥1024px); the board needs a rethink.
7. Sub-tasks, reporting, time tracking — nothing blocks them. `task_changelog` is
   the natural source for cycle-time reporting (time per stage per candidate).

When you ship: bump `?v=N` everywhere (§5.4), add a numbered `sql/NN_*.sql` for any
schema change (idempotent, run it yourself, commit the file), extend the E2E suite,
and update **this file** — it's only useful if it stays true.
