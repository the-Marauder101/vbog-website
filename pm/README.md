# VBOG PM Tool

Internal Kanban task manager for the VBOG team. Replaces Asana for tracking work
across all client projects. Lives at **https://v-bog.com/pm/**.

- **Frontend**: static HTML/CSS/JS (no framework, no build step) — deploys with the main site via GitHub Pages
- **Backend**: Supabase (PostgreSQL + auto REST API), project `mejebezwvyfkhufkgkej`
- **Phase 1**: no login — anyone with the URL has full access (accepted trade-off; auth is Phase 2)

## Pages

| Page | What it does |
|---|---|
| `index.html` | Dashboard — all projects as cards (task count, overdue count). Create/edit/archive projects with **custom status columns per project** (e.g. an HR pipeline vs a normal task pipeline). |
| `board.html?project=<id>` | Kanban board — one column per status, drag-and-drop between columns, add/edit/delete tasks. |
| `team.html` | Team View — pick a member, see all their tasks across every project (read-only). |
| `settings.html` | Team members — add, deactivate, delete (blocked while tasks are assigned). |

## Database setup

Already done for the current Supabase project (tables created 07 Jul 2026). To rebuild
on a fresh Supabase project, run these in the SQL Editor, in order:

1. `sql/01_schema.sql` — tables (`projects`, `tasks`, `team_members`) + `updated_at` trigger
2. `sql/02_seed.sql` — default team members (idempotent)
3. `sql/03_rls.sql` — RLS with open Phase-1 policies
4. `sql/04_views.sql` — `task_details` view (human-readable joins, used by Zapier Flow B)

If the frontend ever shows "Database not set up", it means these haven't been run.

Credentials live in `js/config.js` — the **Publishable key only** (safe for frontend).
Never put the Secret key in any file in this repo.

## Zapier integration

The app itself needs no changes for Zapier — both flows use Supabase's REST API directly.

### Flow A — Google Sheets → task appears in the app

Zap: **Trigger** = New/updated spreadsheet row → *(two lookup steps)* → **Action** = Webhooks by Zapier (POST).

1. **Lookup project UUID** — Webhooks step, `GET`:
   `https://mejebezwvyfkhufkgkej.supabase.co/rest/v1/projects?name=eq.{{Project Name}}&select=id`
2. **Lookup assignee UUID** (skip if unassigned) — `GET`:
   `https://mejebezwvyfkhufkgkej.supabase.co/rest/v1/team_members?name=eq.{{Assignee Name}}&select=id`
3. **Create the task** — `POST` to
   `https://mejebezwvyfkhufkgkej.supabase.co/rest/v1/tasks`

   Headers on every request:
   ```
   apikey: <publishable key from js/config.js>
   Authorization: Bearer <same key>
   Content-Type: application/json
   Prefer: return=representation
   ```
   JSON body:
   ```json
   {
     "title":       "<Task Name column>",
     "project_id":  "<id from step 1>",
     "assignee_id": "<id from step 2, or omit>",
     "due_date":    "<YYYY-MM-DD, or omit>",
     "notes":       "<Notes column, or omit>",
     "status":      "<must match one of the project's status columns, e.g. To Do>",
     "source":      "zapier",
     "external_id": "<sheet row ID, for dedup>"
   }
   ```

Tasks created this way show a teal dot on their Kanban card so the team knows they came from Sheets.

### Flow B — task created/updated in app → Google Sheets

1. In Zapier: create a Zap with trigger **Webhooks by Zapier → Catch Hook**; copy the hook URL.
2. In Supabase dashboard: **Database → Webhooks → Create webhook**
   - Table: `tasks` · Events: `INSERT`, `UPDATE` · Method: POST → paste the Zapier hook URL.
3. The payload contains UUIDs. To get readable names, add a Zapier Webhooks `GET` step:
   `https://mejebezwvyfkhufkgkej.supabase.co/rest/v1/task_details?id=eq.{{record id}}`
   (same headers as above) — returns `project_name`, `assignee_name`, `status`, `due_date`,
   `created_at`, `updated_at` for the row, ready to map into the Sheet.

## Deploy

Part of the main `vbog-website` GitHub Pages deploy — push to `main` and it's live at
`v-bog.com/pm/` in a minute or two. No build step. The page is `noindex` and not linked
from the public site.

## Phase 2 backlog (deliberately not built)

Auth/login, roles, sub-tasks, comments, attachments, notifications, mobile layout,
reporting, time tracking, client portal.
