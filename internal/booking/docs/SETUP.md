# VBOG Booking System — First-Time Setup

Total time: **about 15 minutes**. You only do this once.

You will: ① create an Apps Script project and paste in the code, ② run one
function that builds your Google Sheet automatically, ③ deploy it as a web
app, ④ paste the web app URL into the website. That's it.

> **Sign in as Account 1** (your primary Google account — the one whose
> calendar should receive the bookings) for every step below.

---

## Step 1 — Create the Apps Script project

1. Go to **[script.google.com](https://script.google.com)**.
2. Click **+ New project** (top left).
3. Click the project name **"Untitled project"** (top left) and rename it to
   `VBOG Booking`.

## Step 2 — Show the manifest file

1. Click the **⚙️ gear icon** ("Project Settings") in the left sidebar.
2. Tick **"Show `appsscript.json` manifest file in editor"**.
3. Click the **`< >` Editor** icon in the left sidebar to go back to the code.

## Step 3 — Paste in the code (9 files + manifest)

All files live in this repo under `internal/booking/apps-script/`.

1. First, click on **`appsscript.json`** in the editor's file list, select
   everything in it, delete it, and paste in the contents of our
   **`appsscript.json`**. This pre-enables the Calendar service and sets your
   timezone.
2. Click on **`Code.gs`** in the file list, delete its placeholder content,
   and paste in our **`Code.gs`**.
3. For each of the remaining 8 files, click the **＋** next to "Files", choose
   **Script**, type the name **without** the `.gs` ending, press Enter, then
   paste the file's contents in (replacing the empty `function myFunction()`):

   - `Config`
   - `Utils`
   - `Sheet`
   - `Calendar`
   - `Availability`
   - `Booking`
   - `Email`
   - `Setup`

4. Press **Ctrl+S / Cmd+S** (or the 💾 icon) to save everything.

> If the editor complains about the manifest: sidebar **Services ＋** →
> find **Google Calendar API** → Add (identifier must be `Calendar`). This is
> normally done for you by the manifest paste in step 1.

## Step 4 — Run the installer

1. In the toolbar dropdown (next to "Debug"), select **`initialSetup`**.
2. Click **▶ Run**.
3. A window appears: **"Authorization required"** → click **Review
   permissions** → pick your Account 1.
4. Google will warn **"Google hasn't verified this app"** — this is normal
   for your own private script. Click **Advanced** → **Go to VBOG Booking
   (unsafe)** → **Allow**.
5. Watch the **Execution log** at the bottom. When it finishes you'll see
   `SETUP COMPLETE` and a link to your new **"VBOG Booking System"**
   spreadsheet. **Open that link and bookmark the Sheet** — it's your admin
   panel from now on.

The installer has now:
- created the Sheet with the `clients`, `bookings`, and `accounts` tabs,
- added a sample client (`test-client`) and your Account 1 calendar,
- installed the hourly reminder-email trigger.

Running `initialSetup` again later is safe — it repairs, never deletes.

## Step 5 — Deploy as a web app

1. Click **Deploy** (blue button, top right) → **New deployment**.
2. Click the **⚙️ gear** next to "Select type" → choose **Web app**.
3. Fill in:
   - Description: `v1`
   - Execute as: **Me**
   - Who has access: **Anyone**
4. Click **Deploy**, then **copy the Web app URL** (it ends in `/exec`).

## Step 6 — Smoke test

Open a new browser tab and paste:

```
<YOUR-WEB-APP-URL>?action=ping
```

You should see: `{"ok":true,"data":{"status":"ok","version":1,...}}`

Also try:

```
<YOUR-WEB-APP-URL>?action=getClient&slug=test-client
```

You should see the sample client's config as JSON.

## Step 7 — Connect the website

1. In this repo, open **`book/config.js`** (you can edit it directly on
   github.com — press `.` or use the ✏️ edit button).
2. Replace `PASTE_YOUR_WEB_APP_URL_HERE` with your web app URL.
3. Make sure `MOCK_MODE` is `false`.
4. Commit to the `main` branch. GitHub Pages redeploys automatically
   (~1 minute).

## Step 8 — Book a test meeting

1. Open **`https://v-bog.com/book/test-client`**.
2. Walk through: duration → date → time → your details (use your real email).
3. Confirm, then check that all four things happened:
   - a confirmation screen appeared,
   - an event landed on Account 1's Google Calendar (with you as guest),
   - a row appeared in the Sheet's `bookings` tab,
   - a confirmation email arrived.

## Step 9 — Add your other calendar accounts

Follow **[ADDING-ACCOUNT.md](ADDING-ACCOUNT.md)** for Account 2 (and any
future accounts). ~2 minutes each, no code.

## Step 10 — Add your first real client

Follow **[ADDING-CLIENT.md](ADDING-CLIENT.md)**. ~2 minutes, no code.
When you're done testing, set the `test-client` row's `active` to `FALSE`.

---

## ⚠️ The one gotcha to remember

**Editing the Apps Script code later does NOT update the live API.**
After any code change you must publish a new version:

> **Deploy → Manage deployments → ✏️ (edit) → Version: "New version" → Deploy**

The URL stays the same; only the code behind it updates. You can verify which
version is live at any time with `<url>?action=ping` (check the `version`
number, which we bump in `Config.gs` when the code changes).

---

## Full verification checklist (optional but recommended)

1. `?action=ping` returns `ok:true`.
2. `?action=getClient&slug=test-client` returns config — and does **not**
   contain any email address.
3. Create a busy event on Account 1's calendar → that time disappears from
   the booking page.
4. Create a busy event on a shared secondary calendar → that time disappears
   too (after ADDING-ACCOUNT setup).
5. Mark a calendar event as **Free** (not Busy) → it does *not* block slots.
6. Book a slot → calendar event + `bookings` row + confirmation email.
7. Open the same slot in two tabs, book in both → the second gets
   "slot was just taken".
8. The booked slot no longer appears on the booking page.
9. Today's already-past times never appear.
10. Dates beyond 60 days are not selectable.
11. Days not in `allowed_days` are greyed out.
12. Set `active=FALSE` on a client → their link shows the "not available"
    screen.
13. A booking ~23h away gets exactly one reminder email within the hour
    (check `reminder_sent` flips to TRUE, and no duplicate the next hour).
14. `v-bog.com/book/test-client` (pretty URL) lands on the booking page.
15. A nonsense URL like `v-bog.com/no-such-page` shows the branded 404.
