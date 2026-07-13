# Vyom — Architecture & Developer Handbook

> **Read this before changing anything.** It explains how every piece works, the
> conventions that keep the app stable, and the traps previous builds already hit
> (so you don't hit them again). The README covers *what Vyom does*; this file
> covers *how it's built*.

Last updated: v16 (July 2026) — client tags on tasks + form polish; plus the v14
status reordering, guided transition mapping, and sub-client status inheritance.

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
| `js/dashboard.js` | Page logic for `vyom.html` |
| `js/board.js` | Page logic for `board.html` (drag-drop, task modal, @mentions) |
| `js/team.js` | Page logic for `team.html` |
| `js/settings.js` | Page logic for `settings.html` |
| `css/style.css` | All styles, one file, sectioned with `/* ---------- */` headers |
| `sql/01…12_*.sql` | Migrations, numbered, idempotent — the full schema history |
| `img/vyom.svg` | The logo (also the favicon). Same SVG is inlined in each page's nav |

**Script load order matters** (each page loads, in order):
`config → supabase → api → ui → auth → inbox → <page>.js`
Later files depend on earlier globals (`API`, `UI`, `Auth`, `Inbox`).

## 3. Database schema (Supabase / Postgres)

Run `sql/*.sql` **in numeric order** on a fresh project (SQL Editor). All are idempotent.

| Table | Purpose | Key columns |
|---|---|---|
| `projects` | One per client/workstream | `statuses jsonb` (the Kanban columns, ordered), `type` (`internal`\|`client`), `tags jsonb` (array of tag *names*), `color`, `archived`, `parent_project_id` FK (sql/08 — set = this is a **sub-client** project, one level deep), `inherit_statuses` (sql/12 — sub-client live-inherits the parent's columns, see §7) |
| `tasks` | The work items | `project_id` FK, `status` (must match a project status — enforced client-side only), `assignee_id` FK, `due_date`, `source` (`manual`\|`zapier`\|`api`), `external_id`, `fields jsonb` (sql/11 — structured per-task data, more keys later WITHOUT migrations: `email` feeds automations, `client` is the task-level client tag — see §7), auto `updated_at` trigger |
| `team_members` | Every user (internal and external) | `role` = free-text job title; `user_role` = permission level (`admin`\|`member`\|`external`); `login_code` unique = what they type at the gate; `active` |
| `project_members` | Which projects an **external** user can see | composite PK (`project_id`,`member_id`), both cascade on delete |
| `notifications` | Inbox rows | `member_id` recipient, `kind` (see §6), `actor_id`, `task_id`/`project_id` (cascade — deleting a task cleans its notifications), `message`, `read`, `data jsonb` for future payloads |
| `tags` | Central tag registry | `name` unique — the *only* place tags are created, which is what prevents duplicates |
| `webhooks` | Zapier fan-out targets | `url`, `project_id` (NULL = all projects), `events jsonb`, `active` |
| `automations` | Per-project rules (sql/09) | `project_id` FK (rules NEVER cross projects), `trigger_type`, `conditions jsonb`, `action_type`, `action_config jsonb`, `active` |
| `api_keys` | Native inbound API keys (sql/10) | `project_id` FK (a key writes to ONE project), `key` unique (`vyom_…`, DB-generated), `label`, `active`, `last_used_at` |

Also: `task_details` **view** (sql/04) joins human-readable names — used by webhook
payloads. `notify_task_webhooks()` **trigger** (sql/05) fires on task INSERT/UPDATE/DELETE
and POSTs to every matching webhook via `pg_net` — async, so task writes never block.

Triggers/RPCs added later: `run_task_automations()` (sql/09) fires AFTER INSERT/UPDATE on
tasks and executes matching `automations` rows — webhook POST via `pg_net`, task moves,
assignment, or inbox notifications (kind `automation`); every action is exception-wrapped so
a bad rule never blocks a save, and `pg_trigger_depth() > 2` stops rule chains from looping.
`send_test_automation()` mirrors `send_test_webhook()`. `ingest_task()` (sql/10, RPC,
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
   Current version: `v=16`.
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
  for the current expected pass count).

## 10. Roadmap notes for the next builder

Deliberately not built yet, in rough priority order — the schema anticipates them:

1. **Real auth**: Supabase Auth (magic link or password) mapped to `team_members`,
   then rewrite RLS policies per role. Everything else keeps working.
2. **Client portal polish**: externals already work (role + `project_members`);
   what's missing is invite-flow niceties (e.g. emailing the login link).
3. **New notification kinds**: comments, due-date reminders (`kind` + `data jsonb`
   are ready; reminders would need a scheduled function — Supabase cron/pg_cron).
4. **Comments on tasks**: new `task_comments` table; reuse the mention parser and
   `notify()`; add a `comment` kind.
5. **Attachments**: Supabase Storage bucket; store paths on tasks.
6. **Mobile layout**: CSS is desktop-first (≥1024px); the board needs a rethink.
7. Sub-tasks, reporting, time tracking — nothing blocks them.

When you ship: bump `?v=N` everywhere (§5.4), add a numbered `sql/NN_*.sql` for any
schema change (idempotent, run it yourself, commit the file), extend the E2E suite,
and update **this file** — it's only useful if it stays true.
