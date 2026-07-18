# Booking System — Changelog

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
