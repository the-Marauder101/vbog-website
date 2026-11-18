# Rich Alloys Purchase Portal: product requirements

Owner: Depesh Vyas (V-BOG) · Client: Rich Alloys India Pvt Ltd (Himanshu Jain) · Written 16 Nov 2026 · Status: slice 1 built; schema live on Supabase project `rqxjjrpngybglmhzlmtj` (Mumbai) since 18 Nov 2026, app not yet hosted

This is the single document any new chat or developer follows to continue the build. It replaces the
"Google Sheets first" direction in the older project brief (see section 3).

## 1. How to use this document

Order of truth when sources disagree:

1. Depesh's latest messages
2. This PRD
3. `Rich_Alloys_VBOG_Project_Brief_for_Claude (1).md` (ignore any older .docx brief)
4. Source documents: PO, invoice bundle, DNs 114–116, notebook photos, call transcripts, the Proposal and Agreement

Working rules for anyone continuing:

- Direct, opinionated answers. Recommend, don't list options.
- Never invent weights, rates or amounts. Use the documents or ask.
- Tally is the book of record. The portal calculates, approves and exports; it reconciles to Tally.
- Purchase side only, one site (Palghar melting unit + Mumbai office). Flag scope creep immediately.
- When a new fact contradicts this PRD, say so and update the PRD in the same change.
- Every change must keep `tests/run_local.sh` printing `ALL CHECKS PASSED`.
- Client team communication is often in Hindi; drafts for them in simple Hindi or Hinglish when asked.
- Calls with Himanshu are on Fathom in Hindi; only transcripts can be read, and English transcripts of both calls are in Project files.

## 2. The business and the problem

**V-BOG** (Vyas Business Operations Group, v-bog.com) implements operations for founders; it does not hand over
decks. Engagement model: audit, game plan, implementation (60–90 days), optional scaling partnership.
Principles told to clients: fix one or two systems at a time; everything must show in profit or revenue and
survive the next scale level. Sprint pod: Depesh, Sahil, Sarika.

**Rich Alloys India Private Limited** (GSTIN 27AAMCR8303C1ZF; Plot 33/34/35, Aamgaon Industrial Estate,
Talasari–Sanjan Road, Palghar, Maharashtra 401606). About two years old. Buys copper scrap (domestic and
imports), sorts into 6–7 grades (OC, Lal, others), melts into bars and squares, sells to large buyers (Adani,
Hindalco, Birla Copper, Vedanta Sterlite, Precision Wire). Turnover about ₹200 cr, margin about 1%: a 1%
loss is the whole margin. Cash-flow-driven; uses LCs and bank discounting. Theft risk is high.

**People in the purchase flow**

| Person | Where | Role today | Portal role |
| --- | --- | --- | --- |
| Himanshu Jain | Founder | Negotiates every deal by phone; holds payables and cash in his head | `owner` |
| Deal-book owner (unconfirmed) | — | Nominally keeps the deal book | `deal_desk` |
| Watchman | Factory gate | Truck, seal, driver photos | `gate` |
| Sanjay | Factory | Inward, weighing, sorting oversight, weight and rejection report. Already overloaded | `factory` |
| Sorting lead (unnamed) | Factory | Grades material, reports bad material to Sanjay | `factory` |
| Return handler (unnamed) | Factory | Takes rejected material to the transporter | `factory` |
| Tinu Anand | Factory accountant | Billing; raises the debit notes (in Tally format) | `factory_accounts` |
| Niti | Mumbai office | Tally entry, reconciliation, double-payment checks | `ho_accounts` |
| V-BOG | — | Admin and support | `vbog_admin` |

**What Himanshu cares about:** speed and trust with suppliers (he tells them of shortfalls immediately, with
photos), never paying more or less than correct, and being able to defend every transaction to GST, Income Tax
or ED. He wants an implementer, not a guru. He said he does not want new software for its own sake, so the
portal is pitched as "your notebook and DNs in one click".

**Pains this product must remove**

| Pain | Today | Done means |
| --- | --- | --- |
| Compliance exposure | Wants 10–15 documents per purchase, cannot see which exist; Rich Alloys' own receiving proof is not kept consistently | Checklist per purchase on both sides, gaps visible daily, a pack that can be pulled for any notice |
| No live payables | In his head and a self-built Excel; partial payments when funds are short | Per supplier, bill by bill: invoice, DNs, TDS, paid, balance, due date |
| Tally reconciliation | Tally books only what is physically documented; advances, provisional payments and TDS sit outside | One export per transaction; a daily view of portal vs Tally |
| Triple entry of DNs | Each DN recorded at the factory, in Tally in Mumbai, then in Excel | Entered once, calculated, approved, exported |
| Founder time | 4–6 hours a day producing numbers only he can | Team runs it; he books deals and approves |

Also raised: no deal book others can read; supplier invoices not checked against the agreed rate; transport
bills checked by hand; the supplier's invoice charges 18% interest on late payment, so due dates cost money.

## 3. Decisions already made

| # | Decision | Why |
| --- | --- | --- |
| 1 | Custom portal, not Google Sheets | Depesh's call, 16 Nov. Uploads, approvals and one-click documents are what a sheet cannot do. Overrides the brief's "Sheets first" principle |
| 2 | Supabase backend (Postgres, Auth, Storage) | Depesh's call |
| 3 | Mobile-first web page; standalone app later | Depesh's call. Staff use phones at the gate and on the floor |
| 4 | Code, not Lovable | Lovable cannot adopt an existing repo and wants to manage the backend through prompts; money logic must sit in tested SQL |
| 5 | Lives in folder `Rich_Alloys` inside the V-BOG website repo | Depesh's call |
| 6 | All money and weight maths in database views | A screen bug must never change a rupee |
| 7 | Tally issues the numbered DN; the portal calculates, approves and exports it | Today's DNs are Tally printouts (RAI/DN/26-27/…). Two number series would break "Tally is the truth". Proposed by Claude, not objected to; confirm the import method after seeing Tally with Niti |
| 8 | Email + password login for v0 | Works on day one. Phone login needs an SMS provider and Indian SMS registration; revisit later |
| 9 | Suppliers get no login in v1 | They keep sending on WhatsApp; staff upload |
| 10 | Dedicated new Supabase project for Rich Alloys | Table names like `profiles` collide with other apps; `setup.sql` refuses to run otherwise |
| 11 | Plant is a field from day one; data structure reusable for sales | Second factory and sales side are future paid extensions |
| 12 | Pricing is out of the solution discussion | Depesh's instruction |

## 4. Scope

**In (v1, purchase side, Palghar + Mumbai office):** deal book, document collection and approval, inward
weights and sorting, debit note calculation and approval, material returns, accounts payable, Tally export
and reconciliation view.

**Out, do not design or promise:** sales, receivables, sales-side cash flow, other plants, imports and LCs
(flow not yet walked through), factory production and planning, hedging, statutory or tax advice, anything
inside the bank's LC systems, supplier logins, a native app. The signed agreement text reads as if sales is
included; Depesh's confirmed scope (purchase only, one site) wins, and the 30 Nov plan must say so.

## 5. How a purchase works today

1. **Deal.** Himanshu books by phone (e.g. 10 t OC at ₹/kg + GST), notes it in a diary.
2. **PO.** Factory issues a PO. New suppliers go through KYC first.
3. **Supplier dispatch pack.** PO, tax invoice, e-invoice, e-way bill, external weighbridge slip, packing slips by grade (gross and bag weight), seal photos with GPS, transporter LR, loading photos, vehicle and driver licence checks.
4. **Receipt.** Weighed at the external weighbridge, then inside. Watchman takes seal-cutting, vehicle and driver photos.
5. **Weighing.** Each grade weighed separately; gunny bag weight deducted. Factory net vs billed net = weight short. Supplier told at once with photos.
6. **Sorting (3–4 days).** Wrong grade and foreign material found here.
7. **Rejection report.** Sanjay splits rejections into lower grade that can be kept and unusable material. Photos and calculation go to the supplier before any DN.
8. **Debit notes.** Tinu raises up to three. Rate cuts are negotiated per lot; no agreement means the lot is returned. Suppliers sometimes force acceptance of part of a return. Small off-grade lots (1–2%) go straight into the DN.
9. **Return.** Rejected material goes back with its own e-way bill, a handwritten chit and the transporter's LR. Returns from several suppliers are consolidated in one truck.
10. **Payment.** About 90% provisionally on invoice. Final = invoice − DNs − TDS − provisional. Closed bill by bill.
11. **Books.** Niti enters in Tally, checks double payment and the supplier's GST in GSTR-2B. Complete only when payment is settled and returned material has reached the supplier.

| Debit note | Trigger | Value |
| --- | --- | --- |
| Weight short | Factory net below billed net | short kg × deal rate + GST |
| Rate difference | Lower grade Rich Alloys keeps | kg × agreed rate cut + GST |
| Material return | Dirt, attachments, or lower grade the supplier won't re-rate | kg × deal rate + GST |

## 6. Reference transaction (the regression test)

PO/RA/082/26-27, Ogo Enviro Solutions Pvt Ltd (Hyderabad, GSTIN 36AAECO5492P1ZO), invoice OGOES15 of
23 Oct 2026, 18% IGST. In the system as deal `RA-082`; data in `supabase/test_data/ogo_po082.sql`.

| Line | OC (₹1,234/kg) | Lal (₹1,319/kg) |
| --- | --- | --- |
| Supplier slip gross / bags (kg) | 4,884.550 / 20.200 | 5,104.100 / 10.750 |
| Supplier billed net (kg) | 4,864.550 | 5,093.350 |
| Factory gross / bags (kg) | 4,874.900 (120 bags) / 24.700 | 5,100.100 (74 bags) / 17.800 |
| Factory net (kg) | 4,850.200 | 5,082.300 |
| Weight short (kg) | 14.350 | 11.050 |
| Sorting | lead copper 125.9 (cut ₹80), DC 27.6 (cut ₹185), attachment 131.8 (return), mitti 37.4 (return) | low quality 139.7 (cut ₹85), attachment 24.8 (return) |

| Money (₹) | Amount |
| --- | --- |
| Invoice (1,27,20,983.35 + IGST 22,89,777.00) | 1,50,10,760.35 |
| DN RAI/DN/26-27/114 weight short | 38,094.00 |
| DN RAI/DN/26-27/115 rate difference | 31,921.95 |
| DN RAI/DN/26-27/116 material return | 2,57,745.00 |
| Invoice less DNs | 1,46,82,999.40 |
| Provisional paid | 1,40,00,000.00 |
| Balance before TDS | 6,82,999.40 |

Timeline: PO 22 Oct, invoice and dispatch 23 Oct, received 25 Oct, all DNs 5 Nov, return dispatched 6 Nov
(e-way bill 202325973829, VRL LR 1079490402, 175.3 kg in 6 packages, freight ₹1,900 paid by Rich Alloys).

**What the documents revealed, and the requirement each creates**

| Finding | Requirement |
| --- | --- |
| Mitti: 37.4 kg sorted, 18.7 kg debited; about ₹27,229 not recovered, no reason recorded | A debited quantity cannot differ from the sorted quantity without a written reason; exceptions are listed with their rupee value |
| Weight short comes from bag weight (supplier 20.2 / 10.75 kg vs factory 24.7 / 17.8 kg) | Capture both bag weights |
| Packing slip nets to 4,864.350 kg, invoice bills 4,864.550 kg | Automatic slip-vs-invoice check |
| Notebook header reads 4,864.85 instead of 4,864.55 | No hand-copying: one entry, calculated onwards |
| DN 115 shows amounts only, no quantity or rate | Every DN working shows quantity, rate and amount per line |
| DNs 114 and 116 are rounded to the rupee, DN 115 is not | Rounding is a switch per DN until the rule is confirmed |
| Return freight ₹1,900 paid by Rich Alloys, no recovery shown | Record freight, who paid, and whether recovered |
| Supplier invoice charges 18% on late payment | Due date per bill in payables |
| Rich Alloys' own proof (factory weighbridge slip, receipt photos, seal-cutting photo, sorting report) is absent | These are required documents on the checklist |

## 7. Product requirements by module

Status: **Built** = in this folder and tested; **Schema** = tables and maths exist, no screen yet; **Planned** = not started.

### 7.1 Sign-in and roles (Built)
- Email and password. No public sign-up; V-BOG creates users and assigns one role each.
- A signed-in person without a role sees a clear message and no data.
- English and Hindi toggle, remembered on the device.
- **Staff screen (Built, 18 Nov):** `owner` and `vbog_admin` add a login (name, email or short login ID, role,
  temporary password), change a role, reset a password, switch a login off or back on. **Placeholder until
  Himanshu confirms who may manage staff.** Nobody can remove their own admin access or switch themselves off.
- Staff without email get a short login ID (e.g. `sanjay`), stored as `sanjay@staff.richalloys.v-bog.com`. No mail is
  ever sent to it. They sign in by typing just the ID.
- Passwords are never visible anywhere, including to V-BOG: Supabase stores only a one-way hash. The temporary
  password is shown once, with WhatsApp and copy buttons; a lost password is reset, not looked up.
- Switching off a login bans it in Supabase Auth and sets `profiles.active = false`, so an open session reads
  nothing at once. Every staff change is written to the audit log.

### 7.2 Deal book (Schema; screen planned, slice 5)
- One deal = one ID (`deal_no`) used everywhere, from phone deal to final payment.
- Fields: supplier, plant, deal date, PO number and date, per grade quantity and agreed rate, status, notes.
- Status: booked → po_issued → in_transit → received → sorted → dn_approved → settled → closed (or cancelled).
- Supplier master with GSTIN, state, KYC status (pending, verified, blocked), provisional %, credit days.
- Must flag an invoice whose rate differs from the agreed rate (`rate_vs_deal` exists in `v_inward`).

### 7.3 Document collection and approval (Built, slice 1)
- Checklist per deal in three groups: from the supplier (12), at our factory (4), material return (4, shown only when a return exists). Full list in `0002_masters.sql`, each with a Hindi label.
- Anyone on staff can add photos or PDFs (up to 20 MB) from a phone, several at once.
- Each file moves uploaded → verified → approved, or rejected with a mandatory reason. A rejected document needs a fresh upload.
- A checklist item is complete only when at least one of its files is approved.
- Verify and reject: `factory_accounts`, `ho_accounts`, `owner`, `vbog_admin`. Approve: `ho_accounts`, `owner`, `vbog_admin`. **Placeholder until Himanshu confirms.**
- Deal list shows the count of pending documents per deal; the deal page shows "N of M approved".
- Files are private; opened through links that expire in two minutes. Every status change is written to the audit log.
- Later: one-tap "transaction pack" (all approved documents for a deal as one PDF or ZIP) for GST/IT/ED notices.

### 7.4 Inward and sorting (Schema; screen planned, slice 2)
- Mirrors Himanshu's notebook page line for line, per grade: supplier slip gross and bags, billed net, factory gross, bag count, factory bag weight. Net and weight short are calculated, never typed.
- Sorting lines per grade: category (lead copper, DC, low quality, attachment, mitti; list is editable master data), kg, action (rate difference or return), rate cut, quantity to debit.
- Quantity to debit defaults to the sorted quantity; changing it demands a reason.
- Must be no slower than the notebook for Sanjay: number keypad, large fields, one grade per card.
- Photos of rejected material attach to the sorting line (planned).

### 7.5 Debit notes (Schema + approval function; screen planned, slice 3)
- The three DNs are calculated from inward and sorting data (`v_dn_calc`, `v_dn_calc_lines`).
- One tap approves a DN: lines and amounts are frozen, approver and time recorded (`approve_dn`).
- Rounding to the rupee is chosen per DN until the rule is confirmed.
- Output 1: a supplier-facing DN working (PDF) with quantity, rate, amount per line and photos.
- Output 2: the Tally export row(s). Tally issues the DN number; Tinu or Niti types that number back against the DN (`tally_dn_no`), status moves approved → exported → booked_in_tally.
- DN approval is closed to all app users until this slice ships (tested).

### 7.6 Material returns (Schema; screen planned, slice 3)
- Per return: date, kg, packages, e-way bill number, transporter, LR number, freight, who paid, recovered or not, delivered date.
- A deal is not complete until returned material is delivered.

### 7.7 Payables (Schema; screen planned, slice 4)
- Per bill: invoice total − debit notes − deductions (TDS) − payments = balance, with due date (`v_payable`).
- Rolled up per supplier. Payments typed as advance, provisional or final, with bank reference.
- TDS is entered, never assumed, with a flag for whether it shows on the income tax portal.
- Later: a payment plan view (what is due this week against cash available).

### 7.8 Tally export and reconciliation (Export view built; rest planned, slice 5)
- `v_tally_dn_export`: one row per DN line with party, GSTIN, invoice reference, quantities, rates, totals.
- Start with a file Niti enters from; move to direct Tally import once the Tally version and ledger structure are known.
- Reconciliation view: items in the portal not yet in Tally (`payments.in_tally`, DN status), and a double-payment check.

## 8. Data model

All in schema `public`, defined in `supabase/migrations/0001_schema.sql`.

| Table | Holds |
| --- | --- |
| `plants`, `grades`, `sort_categories`, `doc_types` | Master data |
| `profiles` | The staff list: name, login email, role, plant, active, created (id = Supabase auth user id). Read it in Table Editor |
| `suppliers` | Supplier master and KYC status |
| `deals`, `deal_lines` | The deal and its agreed quantity and rate per grade |
| `invoices`, `invoice_lines` | Supplier invoice and the supplier's own weights per grade |
| `receipts`, `receipt_lines` | Factory weights per grade (net is a generated column) |
| `sorting_lines` | Sorting results and what is debited, with reason when they differ |
| `debit_notes`, `debit_note_lines` | Approved DNs, frozen at approval |
| `returns`, `payments`, `deductions` | Return dispatch, money paid, TDS and similar |
| `documents` | Uploaded files and their status |
| `audit_log` | Who did what, when |

| View | Answers |
| --- | --- |
| `v_inward` | Supplier vs factory weights, weight short, slip-vs-invoice gap, rate vs deal |
| `v_dn_calc_lines`, `v_dn_calc` | What each DN should be |
| `v_sorting_exceptions` | Sorted but not debited, and its value |
| `v_payable` | Balance per bill |
| `v_doc_gaps` | Required documents not yet approved, per deal |
| `v_tally_dn_export` | DN rows for Tally |

Calculation rules: net = gross − bags; weight short = billed net − factory net (only when positive);
DN taxable = Σ kg × rate; GST = taxable × invoice GST rate; total = exact or rounded to the rupee.
Precision: kg to 3 decimals, rates to 3, money to 2.

Access rules (`0003_access.sql`, `0004_storage.sql`): the anonymous key can read nothing; any staff member
can read everything; deal desk roles can write suppliers, deals and deal lines; any staff member can insert a
document as themselves in status "uploaded"; document status changes only through `verify_document`,
`approve_document`, `reject_document`; everything else is writable by the service role only until its slice
ships. Each new slice adds its own write rules and its own access tests. `profiles` is written only by the
`staff-admin` edge function (`supabase/functions/staff-admin`), the one piece of code holding the service key; it
checks the caller's role itself. A switched-off profile reads and writes nothing (`is_staff()` and `my_role()` check `active`).

## 9. UI and UX requirements

**Who it is for:** a watchman or supervisor on a mid-range Android phone, one hand, outdoors, patchy network,
more comfortable in Hindi than English. Then an accountant on a phone or laptop.

**Principles**
- Phone first at 360 px wide; works up to laptop (content column max 640 px).
- One job per screen. The next thing to do is the most visible thing.
- No slower than the notebook or WhatsApp. If a step adds taps without removing work elsewhere, cut it.
- Status is always shown in words with colour as a second signal, never colour alone.
- Every action a person takes is confirmed on screen; every error says what to do next.
- Nothing typed twice. Calculated values are shown, never editable.
- Hindi and English for every label, including master data (`name_hi`).

**Visual language** (in `web/src/styles.css`; keep new screens consistent)

| Token | Value | Use |
| --- | --- | --- |
| Paper / sheet | `#f6f1e7` / `#fffdf8` | Page and card backgrounds (ledger paper) |
| Ink / soft | `#1f1b16` / `#6d6459` | Text and secondary text |
| Copper | `#a8521c` | The one accent: primary buttons, section titles, upload |
| OK | `#2f6b3f` on `#e2efe1` | Approved, complete |
| Waiting | `#7a4f00` on `#f6e7c4` | Uploaded, verified, demo banner |
| Problem | `#9c2b1c` on `#f6dcd6` | Rejected, errors, destructive buttons |
| None | `#6d6459` on `#ebe4d6` | Missing |

- Type: Mukta (Latin + Devanagari), 17 px base, 1.45 line height; headings 1.6 rem and 1.05 rem. Numbers in tabular figures.
- Touch targets at least 44 px high; primary actions 48 px or more.
- Rows carry a left edge in the status colour; status chip on the right.
- Dates as "16 Nov 2026, 5:52 pm". Weights with 3 decimals and "kg". Money in Indian grouping (1,50,10,760.35).
- Visible keyboard focus; text contrast at least 4.5:1; respects reduced-motion.

**Screens**

| Screen | Status | Must do |
| --- | --- | --- |
| Sign in | Built | Email, password, clear error |
| Deals | Built | List with supplier, PO, date, pending-document count; tap opens the deal |
| Deal documents | Built | Progress bar, three groups, tap a row to see files, add, view, verify, approve, reject with reason |
| Deal tabs (Documents, Weights, Debit notes, Payment) | Planned | One deal, four tabs, same header |
| Weights and sorting entry | Planned | Notebook layout per grade; live weight short; sorting lines with reason prompt |
| Debit notes | Planned | Three cards with lines and totals, rounding switch, approve, download working, mark Tally number |
| Payables | Planned | Per supplier and per bill; overdue first |
| New deal | Planned | Supplier, grades, quantity, rate; under one minute |
| Staff | Built | List with role, login, last sign-in; add staff; change role; reset password; switch off. Shown to owner and V-BOG admin only |
| Admin | Planned | Suppliers, master lists |

States every screen must handle: loading, empty, error with retry, no permission, offline or slow upload
(show progress, never lose a photo silently).

Checked so far in a phone-sized browser (360 and 390 px) in demo mode: sign in, deal list, checklist, upload,
verify, reject with reason, Hindi labels, gate role sees no verify button, no sideways scrolling.

## 10. Architecture and repository

- **Database:** Supabase Postgres. Logic in views and a few functions. Row-level security on every table.
- **Server code:** one edge function, `staff-admin`, for creating and managing logins (needs the service key).
- **Files:** Supabase Storage, private bucket `deal-docs`, path `<deal_no>/<doc_type>/<timestamp>-<name>`.
- **Web app:** React 18 + TypeScript + Vite, no router, plain CSS. Every data call goes through `web/src/api.ts`,
  which has a live implementation (Supabase) and a demo implementation (in-memory Ogo data, used when no keys are set).
- **Config:** `config.js` next to `index.html` holds the Supabase URL and anon key, read at run time.
- **Hosting:** any static host. Recommended: its own subdomain (e.g. `richalloys.v-bog.com`), separate from the marketing site.

```
Rich_Alloys/
  PRD.md                      this document
  README.md                   setup and deploy steps
  build_setup.sh              rebuilds supabase/setup.sql from the migrations
  supabase/
    setup.sql                 PASTE THIS into Supabase (generated; do not edit)
    add_user.sql              give a person a role
    migrations/0001..0004     source of setup.sql
    test_data/ogo_po082.sql   demo and regression data, not for production
  tests/                      local Postgres run of setup.sql + checks
  web/                        app source
  deploy/                     prebuilt copy of the app, ready to upload
```

## 11. Deploying

1. Create a **new, empty** Supabase project (region: Mumbai).
2. SQL editor: paste all of `supabase/setup.sql`, run once. It is one transaction; on any error nothing is created.
3. Optional, for a demo: run `supabase/test_data/ogo_po082.sql`. Never in production.
4. Authentication settings: turn off "Allow new users to sign up".
5. Deploy the staff function: `supabase functions deploy staff-admin --project-ref <ref> --no-verify-jwt --use-api`.
   Create the first admin in Authentication → Users → Add user, then edit and run `supabase/add_user.sql`.
   Everyone else is added from the app's Staff screen.
6. Put the project URL and anon key in `deploy/config.js` (never the service_role key).
7. Upload the `deploy/` folder to the host, or point the host at `Rich_Alloys/web` (build `npm run build`, output `dist`).
8. First-run check on the live project: sign in, upload one photo, view it, verify, approve, reject another with a reason.

18 Nov 2026: steps 1 to 6 done on project `Rich Alloys` (ref `rqxjjrpngybglmhzlmtj`, ap-south-1). Confirmed live:
20 tables all with RLS, 7 views, 24 table rules, bucket `deal-docs` (private, 20 MB) with its two rules, 20 document
types all with Hindi labels, anon key cannot read deals, `approve_dn` closed to app users. `0005_staff.sql` run on its
own afterwards. Ogo demo data loaded (with placeholder PDFs behind its 16 documents): **delete before go-live.** One
user: Depesh (`vbog_admin`). Verified live in a 360 px browser and by direct calls: sign-in, deal list, view a file,
upload, every staff action, role refusals, switched-off login refused and reading nothing. Not yet hosted.

## 12. Testing and quality bar

- `tests/run_local.sh` runs the exact paste-in file on local Postgres with stand-ins for Supabase auth and storage, loads Ogo, and asserts:
  weight short per grade; DN 114, 115, 116 totals; invoice less DNs; balance; the mitti exception; four missing documents;
  anonymous key reads nothing; non-staff read nothing; gate can upload but not verify; factory accounts cannot approve;
  no direct status edits; DN approval closed; storage bucket and rules exist; every document has a Hindi label;
  no direct role edits; only owner and vbog_admin manage staff; a switched-off login reads and uploads nothing.
- The test was proven to fail when an expected amount is changed.
- Rule: every closed transaction received from Rich Alloys is added as test data plus checks. A release that changes a past rupee does not ship.
- Each slice adds access tests for its new write rules and a phone-sized browser run of its screens.

## 13. Build plan

| Slice | Contents | Status |
| --- | --- | --- |
| 0 | Schema, calculations, Ogo regression test | Done |
| 1 | Sign-in, roles, deal list, document upload, verify, approve, reject, staff management | Built; live on Supabase, not yet hosted |
| 2 | Inward weights and sorting entry (notebook layout), sorting exceptions | Next |
| 3 | DN approval screen, supplier DN working PDF, returns, Tally DN number capture | Planned |
| 4 | Payables: payments, deductions, per-supplier view, due dates | Planned |
| 5 | New-deal screen and deal book, admin screens, Tally export file, reconciliation view | Planned |
| 6 | Transaction pack download, payment plan, direct Tally import | Later |

Rollout: for two weeks Sanjay keeps the notebook and Tinu raises DNs as usual while the portal runs alongside.
It replaces them only after matching every day. Each system ships with a one-page SOP and a named owner.
Collect 3–5 more closed transactions on the visit as tests.

Engagement dates: audit phase now; call with Himanshu's accountant 17 Nov 2026; on-site in Mumbai/Palghar
18–20 Nov per the agreement (another note says 20–21 Nov; confirm); written plan due 30 Nov 2026 and must
state purchase-only, one-site scope; implementation 60–90 days from a December start. Client nominates one
owner per system and gives decisions within 3 working days. Commercial terms are in the Proposal and Agreement.

## 14. Open questions

| # | Question | Blocks |
| --- | --- | --- |
| 1 | Who verifies and who approves documents? | Slice 1 go-live |
| 2 | Exact Rich Alloys-side document list (four assumed) | Slice 1 go-live |
| 3 | Deal number format (`RA-082` is a placeholder; could follow the PO number) | Slice 5 |
| 4 | DN rounding rule (114 and 116 rounded, 115 not) | Slice 3 |
| 5 | Why DN 116 carries 18.7 kg of mitti against 37.4 kg sorted | Understanding of concessions |
| 6 | TDS sections and rates (agreement says 0.1%; the 11 Nov call mentioned 2% and 0.1%) | Slice 4 |
| 7 | Payment terms per supplier, provisional %, how due dates are set | Slice 4 |
| 8 | Tally version, ledger structure, bill-wise details, advances; import method | Slices 3 and 5 |
| 9 | Who owns the deal book today and in what format | Slice 5 |
| 10 | Who bears return freight and is it recovered | Slice 3 |
| 11 | Do suppliers accept a portal-made DN working, and in what layout | Slice 3 |
| 12 | Full list of grades and sorting categories | Slice 2 |
| 13 | How many sites really exist (calls mentioned four plants and a second factory) | Future extension only |
| 14 | Import and LC flow | Out of scope until walked through |
| 15 | Do factory staff have email addresses? Short login IDs now work without one; confirm per person | Slice 1 go-live |
| 16 | Who may add staff and reset passwords (placeholder: owner, vbog_admin) | Slice 1 go-live |

## 15. Risks

- **Adoption.** Sanjay is overloaded. If entry is slower than the notebook, it will not be used. Take work away (no copying, no report writing) before adding any.
- **Two sources of truth.** Avoided only if Tally numbers the DN and the portal stores that number.
- **Scope creep.** Sales, imports and other plants will be asked for. They are separate, paid extensions.
- **Support after go-live.** Hosting, fixes and changes need an owner at V-BOG.
- **Untested on live Supabase.** First deployment needs a checked run before anyone at Rich Alloys sees it.

## 16. Glossary

| Term | Meaning |
| --- | --- |
| OC, Lal | Copper scrap grades (6–7 in total); OC is also called Berch/Birch |
| DC | A lower copper grade found in sorting; kept at a rate difference |
| Lead copper, low quality | Lower-grade material kept at a rate difference |
| Mitti | Dirt in the load; rejected |
| Attachment | Non-copper material attached to scrap; rejected |
| Weight short | Factory net below the supplier's billed net |
| DN / CN | Debit note / credit note |
| Provisional payment | About 90% paid on invoice before DNs are settled |
| LR | Lorry receipt from the transporter |
| E-way bill | GST document required to move goods, including returns |
| LC | Letter of credit, used mainly on imports |
| Tally | Rich Alloys' accounting system and book of record |
| RLS | Row-level security: database rules deciding who can read or write each row |
