# Google Sheet Schema — "VBOG Booking System"

The spreadsheet is created **automatically** by running `initialSetup()`
(see `docs/SETUP.md`) — you never need to build it by hand. This file
documents the exact structure for reference, or for rebuilding manually if
you ever want to.

The script reads columns **by header name**, so column order can change but
header text must match exactly.

---

## Tab 1: `clients` — one row per availability window (rows sharing a slug = one booking link)

Header row (copy-paste-able):

```
slug	client_name	contact_email	allowed_days	start_time	end_time	durations	active	timezone	notes_for_client
```

| Column | Type | Description | Example |
|---|---|---|---|
| `slug` | text | URL identifier: lowercase letters/digits/hyphens, unique. Becomes `v-bog.com/book/<slug>` | `acme` |
| `client_name` | text | Display name on the booking page | `Acme Corp` |
| `contact_email` | text | Client's email — reference only in v1 (never exposed by the API, not used for sending) | `ops@acme.com` |
| `allowed_days` | text | Comma-separated: `Mon,Tue,Wed,Thu,Fri,Sat,Sun` | `Mon,Wed,Fri` |
| `start_time` | text (`@` format) | Daily window start, 24h `HH:MM` | `10:00` |
| `end_time` | text (`@` format) | Daily window end, 24h `HH:MM` | `17:00` |
| `durations` | text | Comma-separated minutes | `30,60` |
| `active` | boolean text | `TRUE` = link live, `FALSE` = link shows "not available" | `TRUE` |
| `timezone` | text | IANA name; the daily window is interpreted in this timezone and slots are displayed in it | `Asia/Kolkata` |
| `notes_for_client` | text | Optional message on confirmation screen + email | `Please be on time.` |

Rules: new row = live immediately; `active=FALSE` on the first row kills the
link instantly.

**Multiple windows per client:** several rows may share one slug. The FIRST
row is the client (identity fields + window #1); each following row adds
another daily window and only its `allowed_days` / `start_time` / `end_time`
/ `active` are read (blank `allowed_days` inherits the first row's days;
blank `active` means on, `FALSE` switches that window off). Full guide:
`docs/ADDING-CLIENT.md`.

---

## Tab 2: `bookings` — append-only log, machine-written

**Do not edit by hand** (deleting old/test rows is fine).

Header row:

```
booking_id	slug	client_name	booker_name	booker_email	booker_phone	booking_date	booking_time	duration_mins	calendar_event_id	created_at	reminder_sent
```

| Column | Description |
|---|---|
| `booking_id` | UUID generated at booking time |
| `slug` | Which booking link was used |
| `client_name` | Copied from `clients` at booking time |
| `booker_name` / `booker_email` / `booker_phone` | What the person entered (phone optional) |
| `booking_date` | `YYYY-MM-DD` (in the client's timezone) |
| `booking_time` | `HH:MM` 24h (in the client's timezone) |
| `duration_mins` | Selected duration |
| `calendar_event_id` | Google Calendar event ID on Account 1 (for future cancellation tooling) |
| `created_at` | ISO timestamp of when the booking was made |
| `reminder_sent` | Empty → reminder pending; `TRUE` → sent (or meeting already passed) |

---

## Tab 3: `accounts` — which calendars to check

| Column | Description | Example |
|---|---|---|
| `account_id` | Short label, your reference only | `account2` |
| `email` | The Google account's email | `me2@gmail.com` |
| `is_primary` | `TRUE` on exactly ONE row — the account that owns the script and receives booking events | `FALSE` |
| `authorized` | `TRUE` = include this calendar in availability checks. Keep `FALSE` until `auditConfig` confirms the calendar is shared & readable (fail-closed). | `TRUE` |
| `calendar_id` | Usually same as `email`. `primary` also works for Account 1. Use a specific calendar ID to check a non-default calendar within the account. | `me2@gmail.com` |

Adding an account = share the calendar with Account 1 + add a row here
(full walkthrough: `docs/ADDING-ACCOUNT.md`).
