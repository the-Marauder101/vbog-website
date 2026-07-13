# Adding a Client (Booking Link)

One row in the Sheet = one live booking link. **No code, ~2 minutes.**

## Add the row

Open the **VBOG Booking System** spreadsheet → `clients` tab → add a row:

| Column | What to enter | Example |
|---|---|---|
| `slug` | The link name: lowercase letters, digits, hyphens only. No spaces. Must be unique. | `acme` |
| `client_name` | Name shown on their booking page | `Acme Corp` |
| `contact_email` | Client's email — for your records only (not used by the system in v1) | `ops@acme.com` |
| `allowed_days` | Days they may book, comma-separated, three-letter | `Mon,Wed,Fri` |
| `start_time` | Daily window start, 24-hour `HH:MM`, **typed as text** | `10:00` |
| `end_time` | Daily window end, 24-hour `HH:MM` | `17:00` |
| `durations` | Meeting lengths in minutes, comma-separated | `30,60` or just `60` |
| `active` | `TRUE` to go live, `FALSE` to switch the link off | `TRUE` |
| `timezone` | IANA timezone the windows are defined in | `Asia/Kolkata` |
| `notes_for_client` | Optional message shown on their confirmation screen and email | `Please be on time.` |

Common timezones: `Asia/Kolkata`, `Asia/Dubai`, `Europe/London`,
`America/New_York`, `America/Los_Angeles`, `Asia/Singapore`.
(Full list: search "IANA timezone list".)

The link is live **immediately**:

```
https://v-bog.com/book/<slug>        e.g.  https://v-bog.com/book/acme
```

## Multiple time windows (e.g. mornings + afternoons)

One row = one daily window. To offer more than one window, **add another row
with the same slug** directly below — each extra row adds a window:

| slug | client_name | contact_email | allowed_days | start_time | end_time | durations | active | timezone | notes_for_client |
|---|---|---|---|---|---|---|---|---|---|
| `acme` | `Acme Corp` | `ops@acme.com` | `Mon,Tue,Wed,Thu,Fri` | `10:00` | `12:00` | `30,60` | `TRUE` | `Asia/Kolkata` | |
| `acme` | | | | `15:00` | `17:00` | | | | |
| `acme` | | | `Sat` | `11:00` | `13:00` | | | | |

That gives Acme: 10–12 every weekday, **plus** 15–17 every weekday, **plus**
11–13 on Saturdays.

How extra rows work:

- Only **`allowed_days`, `start_time`, `end_time`, `active`** are read on
  extra rows. Name, email, durations, timezone, and notes always come from
  the **first** row — leave them blank on extra rows.
- `allowed_days` left blank → the window uses the first row's days.
- `active` left blank → the window is on. Write `FALSE` to switch just that
  window off (the first row's `active=FALSE` kills the whole link).
- The first row must stay first — it's the one that defines the client.

## Sanity-check (recommended)

Open the Apps Script project → run **`auditConfig`** → the Execution log
lists anything wrong with the row (bad time format, unknown day name,
overlapping windows, …). No warnings = good to send.

## Rules & gotchas

- **Times must stay text.** Type `10:00` plainly. (The setup formats these
  columns as text so Sheets won't convert them, but don't paste dates in.)
- **If a duration doesn't divide the window evenly**, the leftover at the end
  is simply dropped: 10:00–18:30 with 60-min slots offers 10:00 … 17:00
  (ending 18:00), never a slot that spills past `end_time`.
- **Don't reuse a slug** for a different client later — old confirmation
  emails and bookmarks still reference it. Make a new slug instead. (Extra
  rows with the same slug are fine — that's how you add windows, see above.)
- **Deactivating**: set `active=FALSE` — the link instantly shows a polite
  "not available" screen. Existing bookings and reminders are unaffected.
- The booking page shows times **in the client's configured timezone** (an
  "All times are in …" caption is displayed). Pick the timezone that matches
  the client you're sending the link to.
