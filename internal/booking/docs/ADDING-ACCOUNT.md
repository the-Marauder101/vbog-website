# Adding a Google Calendar Account

Adds another Google account's calendar to the availability check, so its busy
times block booking slots. **No code, no OAuth, ~2 minutes.**

> How it works: the account simply *shares its calendar* with Account 1.
> The booking script runs as Account 1 and can then read the shared
> calendar's busy times directly. Nothing to authorize, nothing that expires.

## Step 1 — Share the calendar with Account 1

Do this **signed in as the account you're adding** (e.g. Account 2):

1. Open [Google Calendar](https://calendar.google.com) on desktop.
2. In the left sidebar under **My calendars**, hover the account's main
   calendar → **⋮** → **Settings and sharing**.
3. Scroll to **Share with specific people or groups** → **+ Add people and
   groups**.
4. Enter **Account 1's email address**.
5. Permission: **"See only free/busy (hide details)"** is enough. (Choosing
   "See all event details" also works — the booking system only ever reads
   busy/free.)
6. Click **Send**.

## Step 2 — Add the row in the Sheet

In the **VBOG Booking System** spreadsheet → `accounts` tab, add a row:

| account_id | email | is_primary | authorized | calendar_id |
|---|---|---|---|---|
| `account2` | `that-account@gmail.com` | `FALSE` | `FALSE` | `that-account@gmail.com` |

- `account_id`: any short label, just for your own reference.
- `is_primary`: always `FALSE` — only Account 1 (where bookings are created)
  is `TRUE`, and only one row may be `TRUE`.
- `authorized`: leave **FALSE** for now — the calendar isn't checked until
  you flip this, so a half-configured account can never corrupt availability.
- `calendar_id`: normally the same as the email. Only different if you want
  a specific secondary calendar within that account (find its ID under
  Settings → "Integrate calendar" → Calendar ID).

## Step 3 — Verify, then switch it on

1. Open the Apps Script project ([script.google.com](https://script.google.com)
   → VBOG Booking).
2. Select **`auditConfig`** in the toolbar dropdown → **▶ Run**.
3. Check the Execution log:
   - `✓ calendar "that-account@gmail.com" readable` → sharing works.
   - A warning saying the calendar is **NOT readable** → the share hasn't
     landed yet. Re-check Step 1 (and give Google a minute), then run
     `auditConfig` again.
4. Once the probe passes, set the row's `authorized` to **TRUE**.

Done. Every availability check now includes this calendar. Repeat for
account 3, 4, … N — same three steps each time.

## Removing an account

Set its `authorized` to `FALSE` (or delete the row). Takes effect on the next
availability request.
