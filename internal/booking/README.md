# VBOG Booking System

Self-service meeting booking for v-bog.com. Each client gets a unique link
(`v-bog.com/book/<slug>`), picks a time that is genuinely free across **all**
of Depesh's Google Calendar accounts, and is confirmed automatically —
calendar event, confirmation email, and a reminder 24 hours before. Admin
interface is a Google Sheet. Runs entirely on free infrastructure.

> **Setting this up for the first time? → [docs/SETUP.md](docs/SETUP.md)**

## Architecture

```
[Google Calendar Account 1] ──┐  (calendars 2..N are simply SHARED with
[Google Calendar Account 2] ──┤   Account 1 — free/busy permission only;
[Google Calendar Account N] ──┘   no OAuth, no cloud project, nothing expires)
              │
              ▼  reads busy times (Freebusy query, one call for all)
   [Apps Script Web App]  ◄──►  [Google Sheet: clients / bookings / accounts]
    runs as Account 1
              │  JSON API (doGet/doPost)
              ▼
   [Static booking page on GitHub Pages]
    v-bog.com/book/<slug>   (vanilla JS, no build step — like the rest
              │              of this repo)
              ▼
   Client books → event on Account 1's calendar (booker added as guest)
                → row appended to `bookings` tab
                → confirmation email now, reminder email ~24h before
```

## What lives where

| Path | What |
|---|---|
| `apps-script/` | The backend. 9 `.gs` files + `appsscript.json`, copy-pasted into a script.google.com project (SETUP.md walks it). |
| `docs/SETUP.md` | One-time install, ~15 min |
| `docs/ADDING-ACCOUNT.md` | Include another Google account's calendar (~2 min, no code) |
| `docs/ADDING-CLIENT.md` | Create a new booking link (~2 min, no code) |
| `sheet-template/schema.md` | The Sheet's three tabs, column by column |
| `/book/` (repo root) | The public booking page. `config.js` holds the web app URL — the only frontend file that's ever edited. |
| `/404.html` (repo root) | Rewrites pretty URLs `/book/<slug>` → `/book/?c=<slug>` (GitHub Pages trick) and serves as the site-wide branded 404. |

## The Google Sheet is the admin panel

- **Add a client** → add a row in `clients`. Live immediately.
- **Multiple daily windows** (e.g. mornings + afternoons) → add extra rows
  with the same slug, one per window (see `docs/ADDING-CLIENT.md`).
- **Kill a link** → set `active=FALSE` on the client's first row. Dead
  immediately (shows a polite screen).
- **Add a calendar account** → share it with Account 1 + one row in `accounts`.
- **See all bookings** → the `bookings` tab (append-only, machine-written).
- After hand-editing config, run `auditConfig` in the Apps Script editor —
  it flags bad time formats, overlapping windows, unreadable calendars, etc.

## Design decisions worth knowing

- **Calendar sharing instead of OAuth.** The PRD originally called for an
  OAuth2 flow per account (cloud project, client secrets, token refresh).
  Sharing each calendar with Account 1 achieves the same read access with
  zero setup burden and zero expiry failure modes. Trade-off: the script can
  only *create* events on Account 1 — which is exactly what the spec wants.
- **Freebusy query, not `getEvents`.** Respects events marked "Free" and
  all-day transparent events (they don't block slots), works on shared
  calendars without subscribing, and covers N calendars in one call.
- **POSTs are sent as `text/plain`.** Apps Script web apps cannot answer CORS
  preflight requests, so the frontend avoids triggering one: no custom
  headers, JSON in a plain-text body, parsed manually in `doPost`.
- **Double-booking is prevented server-side.** `createBooking` takes a script
  lock, *recomputes* availability from scratch, and only then writes. Two
  people racing for the same slot: one wins, the other gets `SLOT_TAKEN` and
  is bounced back to pick again.
- **Fail closed.** If any authorized calendar can't be read, the API returns
  an error rather than showing slots that might double-book. New accounts
  stay `authorized=FALSE` until a probe (`auditConfig`) proves them readable.
- **Reminders are idempotent.** The hourly trigger only emails rows where
  `reminder_sent` is empty and flips the flag immediately after sending;
  past meetings are flagged without sending so the scan stays fast forever.
- **All times are computed in the client row's timezone** — never the
  server's, never the visitor's. The page shows an "All times are in …"
  caption. DST transitions are handled (nonexistent times are dropped).

## Known limits (v1 scope, per the PRD)

- No cancellation / rescheduling flow (the `calendar_event_id` column exists
  so this can be added later).
- No buffer time between meetings, no Meet link generation, no payments,
  no WhatsApp automation (phone number is collected for records only).
- Consumer Gmail sends ~100 emails/day (2 per booking → ~50 bookings/day),
  far above expected volume. Workspace accounts get 1,500/day.
- The booking page needs JavaScript (a `<noscript>` fallback points to
  the contact page).
- Calendly keeps working independently: its events land on a connected
  calendar, are read as busy, and are automatically excluded here.

## Testing without the backend

Set `MOCK_MODE: true` in `book/config.js` and open `/book/?c=test-client` —
the whole wizard runs against fake data. Recipes: slug `solo` skips the
duration step, booking `10:00` triggers the slot-taken bounce, any date
ending in 9 simulates a network failure. Set it back to `false` before
committing.
