# Booking System — Changelog

## 2026-07-18 — Per-client buffer interval between meetings

**Files changed:** `Config.gs`, `Sheet.gs`, `Availability.gs`

New optional `buffer_mins` column on the `clients` sheet tab. Sets the minimum
gap (in minutes) between meetings for that client. Affects both slot generation
(slots are spaced by `duration + buffer`) and busy-interval checks (existing
calendar events also respect the buffer). Blank or 0 = no buffer (back-to-back,
same as before).

### Migration (one-time, manual)

1. Open the Google Sheet → `clients` tab → add `buffer_mins` as a column header
   at the end of row 1.
2. Fill in the desired buffer for each client (e.g. `15`). Leave blank for no buffer.
3. Copy the updated `.gs` files into the Apps Script editor and deploy a new version.

---

## 2026-07-18 — Custom subject line & additional guests

**Files changed:** `Config.gs`, `Booking.gs`, `Calendar.gs`, `book/app.js`

Two new optional fields on the booking form:

1. **Meeting subject** — booker can set a custom title for the calendar invite.
   If left blank, the default "Meeting — Name (Client)" is used.
2. **Additional guests** — booker can add up to 5 extra email addresses
   (comma-separated) who will also receive the calendar invite.

### Migration (one-time, manual)

1. Open the Google Sheet → `bookings` tab → add two new column headers at the
   end of row 1: `booking_subject` and `extra_guests`.
2. Copy the updated `.gs` files into the Apps Script editor and deploy a new
   version of the web app.
3. The frontend (`book/app.js`) deploys automatically via GitHub Pages.
