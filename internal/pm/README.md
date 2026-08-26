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
| `board.html?project=<id>` | Kanban board — one column per status, drag-and-drop, task modal with **@mentions** in notes and a **Client** picked from the central list (label a task with the end client it's for — lighter than a sub-client project). Filters: assignee, client, due date (presets + custom range). **Columns** hides/shows status columns; **History** shows every recorded change to the project's tasks. |
| `team.html` | All Tasks — master list across every project. Filter by project, assignee, client, due date, or title search. |
| `settings.html` | **Admin only.** Users & access (add users, roles, login IDs, per-project access for externals), the central **tag registry**, the **client registry** (the list every card's Client dropdown picks from), **Slack channels**, and Zapier integrations. |

Every page also has the **Inbox** (bell icon): notifications (task assignments,
@mentions — each with a read/unread toggle) and My Tasks (your open work grouped by
due date).

## Current users

Managed in Settings → Users & access. Each user has a Login ID for the sign-in gate,
an access level, and (for externals) a list of granted projects.

## Database

Supabase project `mejebezwvyfkhufkgkej` — already set up. To rebuild on a fresh
project, run the files in `sql/` in numeric order (01→18) in the SQL Editor; all are
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
- The board's **date filter still works** on these boards — it just asks a different
  question: "Entered today", "Entered in last 7 days", "In stage 3+ / 7+ / 14+ days",
  or a custom date range. It combines with the assignee and client filters as usual,
  so "Rihen's Acme candidates stuck 7+ days" is three clicks. The Ops tab keeps the
  ordinary due-date filter (Overdue, Due today, Next 7 days…).

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

## Daily reports to Slack

Every board can post a daily summary to Slack: **who added how many cards and into which
stage**, who moved what between stages, and where the pipeline stands right now. Nothing
to run and nothing to remember — it sends itself.

**Set it up once:**

1. **Create the webhook in Slack.** Go to [api.slack.com/apps](https://api.slack.com/apps)
   → *Create New App → From scratch*, name it “Vyom” and pick your workspace. Open
   **Incoming Webhooks** in the sidebar, switch **Activate Incoming Webhooks** on, then
   **Add New Webhook to Workspace** at the bottom, choose the channel, and Allow. Copy the
   URL it gives you (`https://hooks.slack.com/services/…`).

   One URL posts to exactly one channel — for a second channel click *Add New Webhook to
   Workspace* again in the same app. Treat the URL like a password; anyone holding it can
   post to that channel.
2. **Settings → Slack channels.** Paste the URL with a name like `#hiring-updates`, then
   hit **Send test** to confirm it lands. You only do this once per channel — every report
   picks from this list, and if a URL is ever rotated you change it here and everything
   follows.
3. **Open a board → 📊 Daily Report.** Choose the channel, what the report covers
   (Hiring, Ops, or both), the send time and timezone, and which days. **Preview** shows
   the exact message; **Send test** posts it to the channel right now.

**Choose who it covers.** Leave everyone selected (the default) or pick specific people —
only their work is counted, and **anyone you pick who did nothing still appears, at zero**.
That's the point: a report that only ever shows activity can't show the lack of it.

**Edit the message itself.** The wording lives in the report, not in the code. The Message
box holds the text that gets posted, with tags that fill themselves in:

```
:wave: Good evening team — *{project}* wrap-up for {date}

{summary} across {people} people

{added}

{vs_yesterday}
```

Available tags: `{project}` `{date}` `{timezone}` `{summary}` `{added_total}`
`{moved_total}` `{people}` `{added}` `{moved}` `{pipeline}` `{clients}` `{vs_yesterday}`
`{cards}` `{card_total}` `{status_list}`.
Slack formatting works — `*bold*`, `_italic_`, `:emoji:`. A tag with nothing to report
disappears along with its blank line, so a quiet day never leaves an empty heading behind.
**Preview** shows the result before you save, and **Reset to the default message** puts the
stock wording back.

**What you can turn on or off:** cards added (by person, by stage) · cards moved
(from → to) · the pipeline snapshot · a breakdown by client tag · whether Zapier/API/
automation activity counts as work (off by default, so the numbers mean *people*) ·
whether it still posts on a day with no activity (on by default, so silence means
"nothing happened", not "the report broke").

A typical message:

```
GetClosers — Daily report

Candidates added — 8
• Anjali — 4 · R1 Rejected 4
• Sarika — 4 · R1 Selected 2, New Candidates 2

Candidates moved — 11
• Sarika — 6 · R1 Selected → R2 Awaiting R3 2, New Candidates → R1 Selected 1, …
• Anjali — 5 · R1 Selected → R2 Rejected 5

Pipeline now
R1 Rejected 106 · New Candidates 59 · R2 Rejected 17 · R1 Selected 13 · …

vs yesterday — added 9 (+5), moved 6 (+5)
```

Reports are admin-managed, and each project can have more than one — e.g. hiring to one
channel and Ops to another. The modal also shows the **last two weeks** of numbers, so
day-over-day movement is visible without leaving Vyom.

### Three kinds of report

The **Report type** dropdown at the top of the form changes what the report is *about*,
not just how it reads. Counts answer "how much"; the other two answer "which".

| Type | What it posts | Use it for |
|---|---|---|
| **Activity** | Counts per person, per stage — the original digest | "What did the team get through today?" |
| **Movement** | A line per card that changed status today, with the move it made | "Show me everything that reached R3 today" |
| **Status** | A line per card sitting in the statuses you choose, right now | "Who is still stuck in New Candidates?" |

Movement and status reports unlock three filters:

- **Moved out of / Moved into** (movement) or **In status** (status) — pick the columns
  you care about. Nothing picked on a movement report means any move; a status report
  needs at least one column, or it would just be the whole board.
- **Clients** — narrow to one or more clients. Nothing picked means all of them.
- **Show on each card** — what gets printed beside every card: **Client**, Assignee,
  Days in stage, Who moved it, Current status, Email, Date. This is how a report says
  *which client* a card belongs to rather than only how many moved.
- **Most cards to list** caps the message (Slack has a length limit). If the cap bites,
  the message says "…and 12 more" rather than quietly stopping.

Each type comes with its own default wording, and switching type swaps it in — unless
you've edited the message, in which case your text is left alone. **Preview** always
shows the form as it stands right now, including changes you haven't saved.

A movement report looks like:

```
GetClosers — Movement · Wed 26 Aug 2026

7 card(s) moved

• Gowthamraj V — New Candidates → R1 cleared · Newmetech · Sarika · by Sarika
• CHANDRIKA SHARMA — New Candidates → R1 Rejected · MDP · Sarika · by Sarika
…and 5 more
```

## Clients

Every card's **Client** field is a dropdown, filled from one central list in
**Settings → Clients**. It used to be a free-text box, which meant the same client could
arrive as “Newmetech”, “NewMeTech” and “newmetech” — three different clients as far as
every filter and report was concerned.

- **Add a client** in Settings and it appears in the dropdown on every board.
- **Pause a client** to take it out of the dropdown without touching a single existing
  card. Cards already filed under it keep their client, and still show it when you open
  them — pausing only stops *new* cards being filed there.
- **Delete** is offered only once no card uses the name. For a client with history,
  pause it instead.
- Everything already in use was added to the list automatically, so nothing changed on
  existing cards.

Not the same thing as the **HR client tracker** below — that tracks the dates one client
passes through on an HR board. This is simply the list of client names.

## HR client tracker

HR boards get a second table beside the Roles Summary — switch with the tabs on the card.
One row per client, one column per date they pass through, so "how long did that client
actually take" stops being something you reconstruct from memory.

Out of the box: Client · Signed On · Requirement Received · Profiles Shared · Interviews
Started · Delivered · **Days to Deliver** · Notes.

**Columns are yours to design.** "+ Column" asks for a name and a **type**:

| Type | What it gives you |
|---|---|
| Text | a plain box |
| Date | a real date picker |
| Number | a numeric box |
| **Elapsed days** | the days between two of your date columns, worked out for you |

Elapsed columns are marked *auto* and can't be typed into — they're calculated, so they
can never disagree with the dates behind them, and they colour themselves (fast / ordinary
/ slow) so a table of clients reads at a glance. Leave the end date blank and the column
tells you which date it's waiting for. Removing a date column that an elapsed column
measures from is refused rather than quietly breaking it.

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
