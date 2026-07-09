# Vyom — VBOG's task & project management tool

Vyom (Sanskrit: "sky") is the first tool in VBOG's internal universe — a Kanban task
manager for the whole team, replacing Asana. Lives at **https://v-bog.com/internal/pm/**.

> 🧭 **Building or changing anything? Read [`ARCHITECTURE.md`](ARCHITECTURE.md) first.**
> It's the developer handbook: how every file works, the database schema, the coding
> conventions, the bugs already fixed once, and the roadmap for the next version.
> This README only covers what the tool does and how to operate it.

- **Frontend**: static HTML/CSS/JS (no framework, no build step) — deploys with the main site via GitHub Pages
- **Backend**: Supabase (PostgreSQL + auto REST API), project `mejebezwvyfkhufkgkej`
- **Login**: every user signs in with an assigned **Login ID** (managed in Settings).
  Roles: Admin / Member / External (clients — see only projects granted to them).
  Note: this is a UX gate for an internal tool, not hardened auth — details in ARCHITECTURE.md §4.

## Pages

| Page | What it does |
|---|---|
| `login.html` | Sign-in gate — enter your Login ID. Stays signed in per device; Logout in the nav. |
| `vyom.html` (index.html redirects here) | Dashboard — project cards with task/overdue counts, type badge (Internal/Client), tag chips, and a tag filter. Create/edit/archive projects with **custom status columns per project**. |
| `board.html?project=<id>` | Kanban board — one column per status, drag-and-drop, task modal with **@mentions** in notes. Filters: assignee, due date (presets + custom range). |
| `team.html` | All Tasks — master list across every project. Filter by project, assignee, due date, or title search. |
| `settings.html` | **Admin only.** Users & access (add users, roles, login IDs, per-project access for externals), the central **tag registry**, and Zapier integrations. |

Every page also has the **Inbox** (bell icon): notifications (task assignments,
@mentions — each with a read/unread toggle) and My Tasks (your open work grouped by
due date).

## Current users

Managed in Settings → Users & access. Each user has a Login ID for the sign-in gate,
an access level, and (for externals) a list of granted projects.

## Database

Supabase project `mejebezwvyfkhufkgkej` — already set up. To rebuild on a fresh
project, run the files in `sql/` in numeric order (01→07) in the SQL Editor; all are
idempotent. Schema details in ARCHITECTURE.md §3.

If the frontend shows "Database not set up", the migrations haven't been run.

Credentials live in `js/config.js` — the **Publishable key only** (safe for frontend).
**Never put the Secret key or any personal access token in this repo.**

## Zapier integration — self-serve, no Supabase access needed

Everything is managed from **Settings** in the app.

### App → Google Sheets (outgoing)
1. In Zapier: create a Zap with trigger **Webhooks by Zapier → Catch Hook**; copy the URL.
2. In the app: Settings → *Send tasks to Zapier / Google Sheets* → paste it, pick a
   project scope and events, click **Send test**.
3. Payloads arrive with human-readable names (project_name, assignee_name) — no lookups needed.

### Google Sheets → app (incoming)
Settings → *Create tasks from Google Sheets* generates the exact Zapier "Custom
Request" setup for any project — endpoint, headers, JSON body with real IDs — each
block with a copy button. Tasks created this way show a teal dot on their card.

## Deploy

Push to `main` → GitHub Pages → live at `v-bog.com/internal/pm/` in a minute or two.
No build step. The pages are `noindex` and not linked from the public site.
**Remember to bump the `?v=N` asset version in all five HTML files on every release**
(see ARCHITECTURE.md §5.4).
