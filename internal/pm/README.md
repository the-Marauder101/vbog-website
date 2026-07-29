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
| `vyom.html` (index.html redirects here) | Dashboard — project cards with task/overdue counts, type badge (Internal/Client), tag chips, and a tag filter. Create/edit/archive projects with **custom status columns per project** — drag the chips to reorder columns; removing a column that still has tasks walks you through moving them (no task is ever stranded). |
| `board.html?project=<id>` | Kanban board — one column per status, drag-and-drop, task modal with **@mentions** in notes and a **Client** tag (label a task with the end client it's for — lighter than a sub-client project). Filters: assignee, client, due date (presets + custom range). **Columns** hides/shows status columns; **History** shows every recorded change to the project's tasks. |
| `team.html` | All Tasks — master list across every project. Filter by project, assignee, client, due date, or title search. |
| `settings.html` | **Admin only.** Users & access (add users, roles, login IDs, per-project access for externals), the central **tag registry**, and Zapier integrations. |

Every page also has the **Inbox** (bell icon): notifications (task assignments,
@mentions — each with a read/unread toggle) and My Tasks (your open work grouped by
due date).

## Current users

Managed in Settings → Users & access. Each user has a Login ID for the sign-in gate,
an access level, and (for externals) a list of granted projects.

## Database

Supabase project `mejebezwvyfkhufkgkej` — already set up. To rebuild on a fresh
project, run the files in `sql/` in numeric order (01→14) in the SQL Editor; all are
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

## Vyom API — create tasks without Zapier

Settings → *Vyom API* generates per-project API keys. Any script (Google Apps
Script, curl, a form backend) creates tasks with one HTTPS POST to
`…/rest/v1/rpc/ingest_task` — the **Setup** button next to each key shows ready
copy-paste snippets, including a complete Apps Script function. The key decides
which project tasks land in; revoke or pause it anytime from the same table.
Tasks created this way show the same teal dot (`source: "api"`).

## Sub-client projects (clients of clients)

When a client has their own internal clients, give each of those a project with a
**Parent project** set (project modal). Sub-client projects nest under their parent
on the dashboard and their tasks are **excluded from All Tasks and its counts by
default** — flip "Include sub-client tasks" in the All Tasks filter bar to see them
(the choice is remembered per browser).

**Don't need a whole child project?** Use the task-level **Client** tag instead:
open any task and fill the Client field (it suggests names already used in that
project). The board and All Tasks each get a Client filter, and tagged tasks show
a teal client chip. Sub-client projects remain the right tool when a client needs
their own board, statuses, or external access.

Sub-clients can either **inherit the parent's status columns** (the default — the
child's board always mirrors the parent's columns, live) or define **custom**
columns of their own; pick in the project modal's "Status columns source" toggle.
Switching to custom starts from a copy of the parent's columns. Editing a parent's
columns includes inheriting sub-clients' tasks in the guided move step.

## Hiding status columns

Long pipelines get unwieldy. Open any board → **Columns** and untick a column to fold
it away. Nothing moves and nothing is deleted: the tasks stay exactly where they are,
the pill in the filter bar always says how many columns (and how many tasks) are out
of view, and you can still file a card into a hidden column from the card itself.

Who it affects depends on who does it:

- **Admins** hide a column **for the whole project** — everyone's board matches.
- **Everyone else** hides it **just for themselves**, in that browser. A column an
  admin has hidden project-wide is marked as such and can't be un-hidden by a
  non-admin.

Each board tab has its own list, so hiding an HR "Rejected" hiring stage doesn't touch
the Ops tab. **Show all** brings everything back.

## HR projects: the Stage Date (instead of due dates)

Candidate cards in an HR project have **no due date**. A hiring pipeline doesn't work
in deadlines per card — what you want to know is how long someone has been sitting at
a stage. So the field is replaced by a read-only **Stage Date**: the date the card
entered the status it's in now.

- Set automatically when the card is created, and **rewritten every time the card
  moves** to another status — by drag-and-drop, from the card, or by an automation.
- **Not editable by hand**, on purpose: it's a measurement, not a plan. It never shows
  as "overdue".
- Cards sort oldest-in-stage first, so whatever is going stale rises to the top (this
  is the same timestamp the SLA rules use).
- The **Ops tab keeps normal due dates** — that's ordinary internal work.
- Every previous stage and its date is in the card's **History**.

**SLA rules use the same date.** Set them from **SLA Rules** on the board (admin only):
"a card in this status must move within N days". Cards get an amber stripe as they
approach the deadline and a red one once they pass it — visible to **everyone** on the
board, not just admins. If a flagged card sits in a column you've hidden, the
hidden-columns pill turns amber and says how many are out of sight.

Toggle it per project with "Stage Date instead of due dates" in the project modal's
HR Features (on by default for HR projects).

## History — the change log

Every change to every task, in every project, is recorded: who did it, what changed,
from what to what, and when. Two ways in:

- **A single card**: open it and expand **History** at the bottom of the modal.
- **A whole project**: the **History** button on the board. Search by task or person,
  or tick "Status moves only" to read a pipeline's movement on its own.

Changes made by **Zapier, the Vyom API and automation rules are logged too** (the log
is written inside the database, not by the browser), and they're labelled as such
rather than being blamed on a person. A deleted task keeps its history — the trail
outlives the card. Nothing in the app can edit or erase a log entry.

## Automations (per-project rules)

Open any board as an admin → **⚡ Automations**. Rules are scoped to that project
only — a hiring pipeline's rules never touch another client. Triggers: task created,
status change (optionally into one specific column), task assigned, due date set.
Actions: POST to a webhook URL (for emails: point it at a Google Apps Script web app
that sends Gmail, or a Zapier hook), move the task, assign someone, or send an inbox
notification. Rules run inside the database, so they also fire for tasks created via
the API or Zapier.

For candidate/contact emails, put the address in the task's **Contact email** field
(task modal) — it travels in webhook payloads as `task.fields.email`, so the receiving
script never has to fish addresses out of free-text notes. `fields` is a generic
container: future needs (doc URLs, etc.) become new keys, not new columns.

## Deploy

Push to `main` → GitHub Pages → live at `v-bog.com/internal/pm/` in a minute or two.
No build step. The pages are `noindex` and not linked from the public site.
**Remember to bump the `?v=N` asset version in all five HTML files on every release**
(see ARCHITECTURE.md §5.4).
