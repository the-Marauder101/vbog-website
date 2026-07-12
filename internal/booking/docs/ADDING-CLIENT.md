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

## Sanity-check (recommended)

Open the Apps Script project → run **`auditConfig`** → the Execution log
lists anything wrong with the row (bad time format, unknown day name,
duplicate slug, …). No warnings = good to send.

## Rules & gotchas

- **Times must stay text.** Type `10:00` plainly. (The setup formats these
  columns as text so Sheets won't convert them, but don't paste dates in.)
- **If a duration doesn't divide the window evenly**, the leftover at the end
  is simply dropped: 10:00–18:30 with 60-min slots offers 10:00 … 17:00
  (ending 18:00), never a slot that spills past `end_time`.
- **Don't reuse a slug** for a different client later — old confirmation
  emails and bookmarks still reference it. Make a new slug instead.
- **Duplicate slugs**: the first (topmost) row wins; `auditConfig` warns you.
- **Deactivating**: set `active=FALSE` — the link instantly shows a polite
  "not available" screen. Existing bookings and reminders are unaffected.
- The booking page shows times **in the client's configured timezone** (an
  "All times are in …" caption is displayed). Pick the timezone that matches
  the client you're sending the link to.
