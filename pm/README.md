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
| `board.html?project=<id>` | Kanban board — one column per status, drag-and-drop between columns, add/edit/delete tasks. Filter by assignee and due date (overdue / today / next 7 or 30 days / no date). |
| `team.html` | All Tasks — master list of every task across every project (read-only). Filter by project, assignee, due date, or title search; click a row to open its board. |
| `settings.html` | Team members (add, deactivate, delete) + **Integrations**: self-serve Zapier webhooks and copy-paste setup snippets for Google Sheets. |

## Database setup

Already done for the current Supabase project (tables created 07 Jul 2026). To rebuild
on a fresh Supabase project, run these in the SQL Editor, in order:

1. `sql/01_schema.sql` — tables (`projects`, `tasks`, `team_members`) + `updated_at` trigger
2. `sql/02_seed.sql` — default team members (idempotent)
3. `sql/03_rls.sql` — RLS with open Phase-1 policies
4. `sql/04_views.sql` — `task_details` view (human-readable joins, used in webhook payloads)
5. `sql/05_webhooks.sql` — `webhooks` table, pg_net fan-out trigger, and the `send_test_webhook` RPC

If the frontend ever shows "Database not set up", it means these haven't been run.

Credentials live in `js/config.js` — the **Publishable key only** (safe for frontend).
Never put the Secret key in any file in this repo.

## Zapier integration — self-serve, no Supabase access needed

Everything is managed from **Settings → Integrations** in the app.

### App → Google Sheets (outgoing)

1. In Zapier: create a Zap with trigger **Webhooks by Zapier → Catch Hook**; copy the hook URL.
2. In the app: Settings → *Send tasks to Zapier / Google Sheets* → paste the URL, give it a
   label, choose a project scope (one project or all) and which events to send
   (task created / updated / deleted). Click **Send test** to fire a sample payload.
3. Map fields in Zapier. The payload already contains human-readable names — no lookup steps:
   ```json
   {
     "event": "INSERT",
     "task": {
       "id": "…", "title": "…", "notes": "…", "status": "…",
       "due_date": "…", "project_name": "…", "assignee_name": "…",
       "source": "…", "external_id": "…", "created_at": "…", "updated_at": "…"
     }
   }
   ```

Under the hood: a `webhooks` table plus a pg_net trigger on `tasks` — the database POSTs to
every registered URL asynchronously, so task writes never slow down or fail because of a
webhook. Anyone on the team can add as many webhooks as they like from the UI.

### Google Sheets → app (incoming)

The Zap action is **Webhooks by Zapier → Custom Request**. Settings → *Create tasks from
Google Sheets* generates the exact setup for any project — endpoint, headers, and a JSON
body template pre-filled with the project's real UUID, its valid status names, and member
IDs — each with a copy button. Tasks created this way show a teal dot on their Kanban card.

## Deploy

Part of the main `vbog-website` GitHub Pages deploy — push to `main` and it's live at
`v-bog.com/pm/` in a minute or two. No build step. The page is `noindex` and not linked
from the public site.

## Phase 2 backlog (deliberately not built)

Auth/login, roles, sub-tasks, comments, attachments, notifications, mobile layout,
reporting, time tracking, client portal.
