# Rich Alloys Purchase Portal: product requirements (v2)

Owner: Depesh Vyas (V-BOG) · Client: Rich Alloys India Pvt Ltd (Himanshu Jain) · Updated 18 Nov 2026
Status: v2.2 live on Supabase project `rqxjjrpngybglmhzlmtj` (Mumbai) since 19 Nov 2026, with Ogo test data, served at
v-bog.com/Rich_Alloys/deploy/. Includes staff management and upload reliability from the interim build (decisions 25–28).

This is the single document a new chat or developer follows to continue the build. It overrides the older
project brief where they differ (section 3 lists what changed).

## 1. How to use this document

Order of truth: Depesh's latest messages → this PRD → `Rich_Alloys_VBOG_Project_Brief_for_Claude (1).md` →
source documents (PO, invoice bundle, DNs 114–116, notebook photos, call transcripts, Proposal and Agreement).

Working rules:
- Direct, opinionated answers. Recommend, don't list options.
- Never invent weights, rates or amounts. Use the documents or ask. Tax sections and rates are entered by people, never assumed.
- Tally is the book of record. There are two Tallys (section 2); every figure reconciles to the right one.
- Flag scope creep immediately. When a new fact contradicts this PRD, say so and update the PRD in the same change.
- Every change keeps `tests/run_local.sh` printing `ALL CHECKS PASSED`; UI changes keep `tests/e2e/run.py` passing.
- Pricing is not part of solution discussions (Depesh's instruction).
- Fathom has the Himanshu calls in Hindi; only transcripts can be read. Transcripts of all calls are in Project files.

## 2. The business

**V-BOG** (v-bog.com) implements operations for founders. Sprint pod: Depesh, Sahil, Sarika.

**Rich Alloys India Private Limited**, GSTIN 27AAMCR8303C1ZF, Plot 33/34/35 Aamgaon Industrial Estate,
Talasari–Sanjan Road, Palghar 401606. Buys copper scrap from ~25 domestic suppliers (and imports), sorts it,
melts it into ingots (plus gross/slag and other by-products), sells to large buyers. Turnover ~₹200 cr at ~1% margin.

**People**

| Person | Where | What they do | Portal role |
| --- | --- | --- | --- |
| Himanshu Jain | Founder | Books every deal by phone; pays big copper suppliers himself, net of TDS; plans cash | `owner` |
| Tinu Anand | Palghar factory | Factory accountant: inward, stock, production, consumption, dispatch, debit notes, in **factory Tally (Silver)**; keeps his own Excel mirroring it; scans and emails invoices to Niti; works on a desktop PC | `factory_accounts` |
| Niti Chopra | Mumbai office | Accounts in **office Tally (cloud)**: purchase/sale invoices, DN/CN, TDS, GST working, supplier ledger matching, small payments; checks bank statement morning and evening | `ho_accounts` |
| Sanjay | Factory | Supervisor: weighing, sorting oversight, rejection report. Overloaded. Did not pick up for his call | `factory` |
| Sorting supervisor (unnamed) | Factory | Keeps a side tally per lot of kachra, gross, reti, iron, brass | `factory` |
| Watchman | Gate | Truck, seal, driver photos | `gate` |
| Vinod | Sakinaka (Mumbai) branch | Sends that branch's bills and stock to Niti | out of scope |
| Aakash, Shashank | Visiting consultants | Check GST/TDS working, file returns | none |
| V-BOG | — | Admin and support | `vbog_admin` |

**Two Tallys.** Factory Tally Silver (Tinu: stock, inward, production, DNs) and office Tally cloud (Niti: accounts,
payments, TDS). They do not sync and their stock does not match. The portal records, per entry, whether it is in
the factory Tally, the office Tally, or both.

## 3. Decisions

| # | Decision | Source |
| --- | --- | --- |
| 1 | Custom portal on Supabase, mobile web page served from Depesh's site; app later | Depesh |
| 2 | Code, not Lovable; folder `Rich_Alloys` in the V-BOG website repo | Depesh |
| 3 | All money and weight maths in database views and functions; screens capture and display only | Claude, accepted |
| 4 | **Every inward is a lot.** A deal can have several lots; status follows the lot through sorting, DN, Tally and payment | Depesh, 18 Nov |
| 5 | Sorting is recorded inside the lot over several days; categories are managed in Admin (add, rename, switch off) | Depesh, 18 Nov |
| 6 | Weight-short and return DNs reduce stock; rate-difference DNs do not | Depesh, 18 Nov |
| 7 | The portal replaces the invoice and "material arrived" emails. Every invoice, DN, payment, TDS entry and production run shows whether it is in factory Tally and/or office Tally | Depesh, 18 Nov |
| 8 | Himanshu, Tinu or Niti can record a payment; Niti reconciles it against the bank statement; only reconciled payments reduce what is owed. The portal is the live supplier ledger, checked against the supplier's own ledger | Depesh, 18 Nov |
| 9 | GST and TDS details are captured per invoice so paid vs pending is visible | Depesh, 18 Nov |
| 10 | **Production and consumption are in scope**, and stock is tallied here against Tally | Depesh, 18 Nov. Scope change: the agreement lists production as out; the 30 Nov plan must include it |
| 11 | Cash plan: cash needed for received lots and deals still on the way, by due date, from payment terms per supplier, overridable per deal and per lot | Depesh, 18 Nov |
| 12 | Imports and LCs are out of scope | Depesh, 18 Nov |
| 13 | Factory screens must be one-tap simple on phone and desktop; few choices; nothing to remember | Depesh, 18 Nov |
| 14 | New-staff onboarding later; build the system first | Depesh, 18 Nov |
| 15 | Tally numbers the debit note; the portal calculates, approves, prints the working and stores the Tally number | Claude, not objected |
| 16 | Stock dispatch is recorded as quantity only (no sale price, buyer or receivable) so finished-goods stock stays true without building sales | Claude, to confirm |
| 17 | Payment terms model: provisional % paid N days after invoice, balance M days after invoice | Claude, to confirm with Himanshu |
| 18 | Email + password login; who-can-do-what lives in a permissions table editable in Admin | Claude |
| 19 | One "Payables" section (Cash needed · Payments · Supplier ledgers · GST and TDS) instead of separate Cash and Money | Depesh, 18 Nov |
| 20 | GSTR-2B is **off by default**. 2B reconciliation is Niti's job in office Tally; a manual upload here would duplicate it. The upload-and-match is built and kept behind the `gst_2b` permission. Revisit with a GSP API, where the fetch is automatic and costs nobody time | Depesh, 19 Nov |
| 21 | One source per fact (section 3a). The portal replaces the source documents (notebook, emails, invoice-tracker Excel), not Tally | Depesh and Claude, 19 Nov |
| 22 | A Tally screen with one queue per Tally (what to enter, with the voucher details), an invoice register, and a "changed after entry: correct in Tally" list | 19 Nov, to make decision 21 work |
| 23 | Invoice photo taken in the arrival form and kept against that lot (replaces emailed scans) | 19 Nov |
| 24 | TDS is entered with the payment as the amount actually deducted (section optional). TDS deposit, challans and GST-by-month stay in office Tally and are not in the portal | 19 Nov |
| 25 | Only admins set or reset passwords; staff cannot change their own | Depesh, 18 Nov |
| 26 | Staff are added from the app (Admin > Staff), not in Supabase. Staff without email get a short login ID (e.g. `sanjay`, stored as `sanjay@staff.richalloys.v-bog.com`; no mail is sent to it) | Depesh, 18 Nov |
| 27 | Uploads never lose a file silently: saved on the phone, progress shown, retried when the network returns. This includes the invoice photo in the arrival form | Depesh, 18 Nov |
| 28 | The portal lives in the public V-BOG website repo so GitHub Pages can serve it; client details in the PRD and test data are accepted there for now and will be scrubbed later | Depesh, 18 Nov |

## 3a. Source of truth

The risk: Tinu sends sheets to Niti, Niti reconciles them, and if the portal becomes a third copy nobody knows which is right.
The rule that prevents it: **every fact is entered once, by the person who sees it happen. Everything downstream copies it and records that it did.**
The portal takes the place of the notebook page, the emailed scans, the "material arrived" messages and the invoice-tracker Excel.
It does not take the place of Tally.

| Fact | Entered once, in | Book of record | How the two are checked |
| --- | --- | --- | --- |
| What arrived, weights, bags | Portal, at the gate / weighbridge | Factory Tally (Tinu posts from the portal) | Factory Tally tick; stock closing vs Tally |
| Sorting, returns | Portal, on the floor | Factory Tally via the DN | DN Tally ticks |
| Debit note amount | Portal (calculated, Tinu approves) | Both Tallys; Tally issues the DN number | Tally number stored on the DN; factory and office ticks |
| Supplier invoice (number, date, totals, scan) | Portal, on arrival | Office Tally (Niti posts) | Office Tally tick |
| Payment | Portal, by whoever paid | Bank statement for money; office Tally for books | Niti reconciles to the bank; office tick; supplier ledger check |
| Production, consumption | Portal | Factory Tally | Stock closing vs Tally |
| TDS, GST, ledgers, returns filing | Office Tally (Niti, consultants) | Office Tally | Portal keeps only the TDS amount per bill, because it changes what is owed |

When the portal and Tally disagree, find where the chain broke. A physical fact (weight, sorting, arrival) is corrected
at its origin in the portal and Tally is corrected to match. An accounting fact (voucher, tax, ledger) is corrected in
Tally and the portal amount is corrected to match. Tally stays the final book either way.

How the portal makes this work:
- **Tally screen, one queue per Tally.** Factory queue: purchase invoices (as inward), debit notes, production. Office queue: purchase invoices, debit notes, reconciled payments, TDS. Each item opens with what to type into Tally (party, GSTIN, invoice, Tally stock item, kg, rate, taxable, IGST or CGST/SGST by the supplier's state, total, stock kg out for DNs) and the invoice photo. Saving records the voucher number.
- **Every tick remembers the amount.** If the entry changes later (DN cancelled, invoice corrected, TDS removed), it reappears at the top of that queue as "Changed after entry: correct in Tally", showing old and new amounts, until someone confirms the correction.
- **Invoice register.** Every purchase invoice for a month with photo ✓, factory Tally ✓ (voucher), office Tally ✓ (voucher). Replaces the shared invoice-tracker Excel; downloadable.
- **Invoice photo at arrival.** Taken in the arrival form, stored against the lot. It goes through the upload queue (decision 27), so a weak signal at the weighbridge delays it but never loses it.

What changes for people: Tinu stops emailing invoice scans and "material arrived" messages; he uploads and records in
the portal. Niti stops reconciling Tinu's sheets; her day becomes the portal's "enter in office Tally" queue plus
bank reconciliation. The pay-to-cash Excel stays (out of scope). Tinu's own stock and production Excel is retired only
after the Stock screen matches factory Tally for the full parallel run.

The only time two sources exist is the two-week parallel run. It is deliberate, has a fixed end date, and ends in a
cutover after which the sheets stop.

## 4. Scope

In: deals, lots (inward), sorting, debit notes, returns, documents, payments and reconciliation, supplier ledger,
GST/TDS status, two-Tally tracking, production and consumption, stock vs Tally, cash plan, admin of masters and permissions.

Out: sales and receivables, imports and LCs, other plants and the Sakinaka branch, pay-to-cash factory expenses,
supplier logins, tax computation or advice, anything inside bank systems, supplier-level yield (not traceable today
because lots are mixed in melting).

## 5. How it works (the flow the portal follows)

1. **Deal** (Himanshu or anyone with `deal_edit`): supplier, grades, quantity, agreed rate, PO, expected arrival, GST, optional terms. Shows as "on the way".
2. **Material arrived** (Tinu/Sanjay): one form per truck: invoice number and date, per grade the supplier's slip gross, slip bags, billed net, billed rate, and our weighbridge gross, bag count and bag weight. Weight short or excess shows live. Saving creates the lot, the invoice and stock inward at billed weight. "All material for this deal has arrived" closes the deal's incoming balance.
3. **Sorting** (Sanjay/Tinu): over days, add results: what was found (category buttons), kg, keep at a lower rate (with ₹/kg cut) or return. Debiting a different kg needs a reason. "Sorting finished" closes the lot.
4. **Debit notes** (Tinu): weight short (any time), rate difference and return (after sorting closes) are calculated. One tap approves each, optional rounding to the rupee. Approved DNs lock the lot's weights, reduce stock (weight short, return), print a working for the supplier, export as CSV for Tally, and take the Tally DN number.
5. **Return**: dispatch with e-way bill, transporter, LR, freight and who paid; mark delivered.
6. **Tally**: each Tally has a queue of entries to post, with voucher details and the invoice photo; saving the voucher number ticks it. Entries changed after posting come back as corrections. The invoice register shows every bill's photo and both ticks.
7. **Payment**: anyone allowed records it (amount, date, mode, UTR, against which bill or as advance, and the TDS deducted from that bill). Niti marks it "matches bank statement" or sends it back with a reason; a corrected payment returns to her. Reconciled payments are frozen.
8. **Ledger**: per supplier, invoices less DNs, TDS and reconciled payments, with a running ledger. Niti records "their ledger says X as on date"; the portal stores the difference.
9. **TDS**: the amount deducted per bill, usually entered with the payment; it reduces what is owed. Deposits, challans and GST working stay in office Tally.
   **GSTR-2B (optional, off by default; decision 20)**: Niti downloads the month's 2B JSON from the GST portal and uploads it. Each B2B invoice is matched to our purchase invoice by supplier GSTIN + invoice number (spaces, slashes and dashes ignored); matches tick "seen in 2B". Four lists: amount differs, our invoices not in 2B (chase before paying the balance), in 2B but not in the portal (other purchases or a missed arrival), supplier credit/debit notes (our DNs should come back as their credit notes). Re-uploading a month replaces it. A manual "seen in 2B" remains for invoice numbers the supplier typed differently.
10. **Production**: date, items consumed and kg, items produced and kg. Stock per item per month: opening, in, out, closing, compared with the Tally closing typed in.
11. **Cash needed** (Payables, first tab): overdue, next 7 days, weekly bars for 4/8/12 weeks, every amount listed with supplier, lot or deal, tranche and due date.

Lot stages: Received → Sorting → DN to approve → Tally entry pending → Payment pending → Settled.

## 6. Reference transaction and what the documents taught

PO/RA/082/26-27, Ogo Enviro Solutions (GSTIN 36AAECO5492P1ZO), invoice OGOES15 of 23 Oct 2026, OC 5 t at ₹1,234 and Lal 5 t at ₹1,319, 18% IGST.
Loaded as deal RA-082, lot L-0001 in `supabase/test_data/ogo_po082.sql`, created through the same functions the app uses.

| Check | Value |
| --- | --- |
| Weight short OC / Lal | 14.350 / 11.050 kg |
| DN 114 / 115 / 116 | ₹38,094.00 / ₹31,921.95 / ₹2,57,745.00 |
| Invoice less DNs | ₹1,46,82,999.40 |
| Balance after ₹1.4 cr reconciled | ₹6,82,999.40 (also the supplier ledger and cash plan figure) |
| Mitti sorted 37.4, debited 18.7 | ₹27,229.44 not recovered, flagged |
| Copper scrap stock after DNs | 9,757.200 kg (billed 9,957.900 − short 25.400 − returned 175.300) |

Requirements born from the documents: both bag weights captured; slip-vs-invoice and rate-vs-deal checks; reason
required when debited ≠ sorted; DN lines show kg, rate and amount; rounding per DN (114 and 116 rounded, 115 not);
return freight and who paid; due dates (supplier charges 18% late interest).

## 7. Facts from the Niti and Tinu calls (18 Nov)

- Two Tallys, not synced (section 2).
- Tinu enters inward in a shared Excel, then factory Tally immediately; stock is booked at invoice quantity and the DN later takes kg off.
- DNs usually take 15–25 days, mostly at month end, because a 25 t lot takes 1–2 weeks to sort at 10–15 t a day and lots from many suppliers are mixed in melting. A 5 t lot can be settled the same day. Each supplier's bags are kept as a separate batch.
- Sorting finds iron, goni (bags), mitti, dhaagi, kachra, reti, brass and more. Grades can come in over billed weight as well as under.
- Tinu sends Niti invoice scans as they arrive, plus three daily Excels (stock, pay-to-cash, an invoice tracker so no invoice is missed for TDS/GST). Supplier document packs stay with Tinu, often on paper.
- Niti matches each supplier's ledger before paying, books payments and TDS from the bank statement, prepares the monthly GST working for the consultants. Nobody but Himanshu sees cash needs.
- Niti's biggest pain is imports (CHA follow-ups, high seas) — out of scope.
- Tinu's production sheet: copper ingot from copper scrap plus phosphorus copper, with copper gross/slag and another by-product; opening and closing tally with Tally to the gram.

## 8. Data model (Postgres, `supabase/migrations`)

| Table | Holds |
| --- | --- |
| `plants`, `profiles`, `permissions` | Site; staff (name, login email, role, active, created: the readable staff list in Table Editor); which role may do which action |
| `items`, `grades`, `sort_categories`, `doc_types` | Masters (Tally stock items; grades map to an item; sorting categories; document checklist), each with Hindi name and on/off |
| `suppliers` | GSTIN, KYC, default payment terms |
| `deals`, `deal_lines` | Booking: agreed qty and rate per grade; terms override; receiving complete |
| `invoices`, `invoice_lines` | Supplier invoice; billed and slip weights per grade; GSTR-2B status |
| `lots`, `lot_lines` | Each truck: received date, vehicle, terms override, sorting closed; our weights per grade |
| `sorting_lines` | Sorting results by date, category, kg, action, rate cut, debited kg, reason |
| `notes`, `note_lines` | Approved DNs frozen with lines, stock kg, Tally number; cancel with reason |
| `returns` | Return dispatch and delivery |
| `payments`, `tds`, `ledger_confirmations` | Money, deductions, supplier ledger checks |
| `tally_marks` | Entity, book (factory/office), voucher ref, who, when |
| `production_runs`, `production_lines`, `stock_moves`, `stock_tally_checks` | Production, other stock entries (opening, other inward, dispatch, correction with reason), Tally closing |
| `tally_marks.amount_at_mark`, `documents.lot_id` | Amount when ticked (to detect later changes); invoice photo per lot |
| `gstr2b_imports`, `gstr2b_lines` | Uploaded 2B months and their lines, with the matched invoice |
| `documents`, `audit_log` | Files and their status; every change logged |

Views: `v_lot_lines`, `v_dn_calc(_lines)`, `v_sorting_exceptions`, `v_payable`, `v_tally_missing`, `v_doc_gaps`,
`v_lots` (stage), `v_deals_incoming`, `v_ledger_lines`, `v_supplier_balance`, `v_cash_plan`, `v_gst_month`,
`v_stock_moves`, `v_tally_dn_export`, `v_gstr2b_recon`, `v_tally_changes`, `v_tally_queue`, `v_invoice_register`, `v_tasks` (each person's to-do list). Function `stock_summary(from, to)`.

Actions (functions): `create_deal`, `create_lot`, `close_lot`, `reopen_lot`, `approve_dn`, `cancel_note`,
`set_note_tally_no`, `mark_tally`, `unmark_tally`, `reconcile_payment`, `reject_payment`, `confirm_ledger`,
`clear_tally_change`, `set_invoice_2b`, `import_gstr2b`, `save_production`, `verify_document`, `approve_document`, `reject_document`.

Staff management (`0007_staff_and_uploads.sql`, `supabase/functions/staff-admin`): the edge function is the only code
holding the service key. It checks the caller's role has `staff_manage` (owner and vbog_admin by default), then creates
logins, changes roles, resets passwords (shown once, with WhatsApp and copy buttons) and switches logins off (Auth ban
plus `profiles.active = false`, so an open session reads nothing at once). Nobody changes their own role or switches
themselves off. Every action goes to `audit_log`. Passwords are never readable anywhere: Supabase stores a one-way hash.
`documents.storage_path` is unique, so a retried upload never creates a second row.

Rules enforced in the database: anonymous key reads nothing; money (payments, TDS, ledger, payables, cash plan, GST)
only for `money_view`; writes need the action in `permissions`; sorting locked once a lot is closed; weights and invoice
locked once a DN is approved; new payments always start unreconciled and any edit sends them back; reconciled payments
frozen; nobody can change their own role.

Cash plan maths: received lot = invoice total − DNs − TDS; provisional tranche = invoice × % due invoice date + days;
balance due invoice date + days; payments (reconciled or waiting) applied to provisional first. On-the-way deal =
remaining kg × agreed rate × (1 + GST), base date = expected arrival. Missing terms put the full amount on the base
date and are flagged.

## 9. UI and UX

For a watchman or supervisor on a mid-range Android phone, one hand, outdoors, patchy data, more at home in Hindi;
and Tinu and Niti on desktop PCs.

- Phone first at 360 px; desktop layout from 900 px (top navigation, wider tables). Bottom navigation on phones.
- Each person sees only their screens (Home, Lots, plus Payables, Tally, Stock, Admin by permission) and a Home list of exactly what is waiting for them, one tap from each item.
- One job per form. Big option buttons instead of dropdowns where choices are few (sorting categories, actions).
- Never type a number twice; calculated values shown live (weight short while entering arrival, TDS amount, DN totals).
- Status always in words plus colour; left edge colour on rows; stepper on each lot.
- English/Hindi toggle on every screen, including master names.
- Photos shrunk on the phone before upload (max 1,800 px, JPEG).
- Uploads (`web/src/uploads.ts`), for documents and the arrival invoice photo: each file is saved on the phone
  (IndexedDB) after shrinking and before any network call, sent one at a time with a progress bar, waits when the
  network drops and goes up by itself when it returns (also after the tab is closed and reopened by the same person).
  A refused file stays on screen with the reason in plain words and Try now / Remove. A banner shows files not yet
  uploaded; the page warns before closing. File links open inside the tap so phone browsers do not block them.
- Sign-in takes an email or a short login ID.
- Errors say what to do next; destructive actions ask for a reason or confirmation.
- Visual language: ledger paper `#f6f1e7`, ink `#1f1b16`, one copper accent `#a8521c`; green/amber/red/blue status pairs; Mukta (Latin + Devanagari); 44 px minimum touch targets; tabular figures; Indian number grouping.

## 10. Repository and deployment

```
Rich_Alloys/
  PRD.md, README.md, build_setup.sh
  supabase/setup.sql          paste into Supabase (generated)
  supabase/reset_all.sql      one time while only test data exists: clears v1 or v2
  supabase/functions/staff-admin   edge function for Admin > Staff (deploy with the Supabase CLI)
  supabase/add_user.sql       give a person a role
  supabase/migrations/        source of setup.sql
  supabase/test_data/         Ogo transaction (test only)
  tests/run_local.sh          database checks
  tests/e2e/                  browser test with a local Supabase stand-in
  web/                        React + TypeScript + Vite source
  deploy/                     built app to upload (config.js holds URL and anon key)
```

Deploy: see README. Done on the live project 19 Nov: `reset_all.sql` + `setup.sql` + first admin + Ogo data in one
transaction (dry-run first on a copy of the live schema). Everyone else is added in Admin > Staff.
Today GitHub Pages publishes the whole repo, so this folder (PRD, SQL, test data) is public too (decision 28).
Recommended later: serve only `deploy/`, on its own subdomain.

## 11. Testing

- Database (`tests/run_local.sh`): Ogo figures, mitti exception, stock, cash plan with and without terms, new deal and lot through the app functions, weight-short DN on a new lot, permissions per role (anon, no profile, gate, factory, factory accounts, HO accounts, owner), payment reject/correct/reconcile/freeze, ledger snapshot, admin category change, audit, v1→v2 upgrade. Proven to fail when an expected figure changes.
- Browser (`tests/e2e`): Tinu books a deal with terms, records arrival with an invoice photo (short 5 kg), sorts (mitti, lead copper), closes, approves three DNs (₹7,080 / ₹1,180 / ₹14,160), posts the invoice and a DN from the factory Tally queue (voucher shows IGST 18% for a Telangana supplier), cancels the posted DN and sees it come back as "correct in Tally", clears it, re-approves, records ₹24 L payment with ₹2,400 TDS; Niti reconciles, posts the payment from the office Tally queue, checks the ledger (₹10,90,179.40), sees no 2B upload (off by default; the matching is covered in the database checks); Himanshu sees cash (₹10.90 L open) and the invoice register (photo ✓, factory ✓ PUR-501, office ✗), adds a sorting category, enters production and sees stock (copper scrap 10,242.200 kg); watchman in Hindi sees no money screens; Sanjay sorts in Hindi on a 360 px screen with no sideways scrolling.
- Database checks also cover staff management (only `staff_manage` roles, nobody promotes themselves) and the unique
  storage path. `tests/v1_setup.sql` is the exact schema the live project ran before v2.2, so the upgrade is proven
  from what is really there.
- Live run, 19 Nov, 360 px: sign-in; every screen with no sideways scrolling; Ogo figures (DNs 114–116, balance
  ₹6,82,999.40, Payables cash ₹6.83 L, copper scrap 9,757.200 kg); a new deal and arrival with an invoice photo (short
  5.000 kg shown live), the photo went up through the queue and is linked to the new lot; the Tally queue's "View
  invoice photo" opened it. 18 Nov (v2.0, same code paths): upload survived a dropped network; Admin > Staff created,
  used and switched off a gate login. Live then reset to the Ogo-only state.
- `tests/e2e/run.py` was not run in the merge sessions (PostgREST and Python Playwright could not be installed there).
  Run it before the next UI change.
- Rule: every closed transaction from Rich Alloys becomes test data plus checks.

## 12. Plan

| Step | Status |
| --- | --- |
| v1: documents slice | Deployed at v-bog.com/Rich_Alloys/deploy/ |
| v2: everything in section 5 | Built and tested locally |
| Deploy v2 and run the first live check | Done 18 Nov (v2.0), 19 Nov (v2.2) |
| Staff management in the app, reliable uploads | Done 18 Nov |
| On the visit: confirm open questions, collect 3–5 closed transactions as tests, get Tinu's sheets and Niti's invoice tracker, record a real lot end to end with Tinu | Next |
| Parallel run two weeks: notebook, Excel and Tally carry on; portal must match daily | Then |
| Tally import (not just CSV) once Tally version and ledgers are known, GSTR-2B fetch through a GSP API, transaction pack download, WhatsApp alerts | Later |

## 13. Open questions

| # | Question | Affects |
| --- | --- | --- |
| 1 | Payment terms per supplier (provisional %, days) and is "days after invoice" the right base? | Cash plan |
| 2 | Which Tally issues the DN number (RAI/DN/…): factory or office? | DN flow |
| 3 | Who verifies and approves documents (now: Tinu verifies, Himanshu approves) and who approves DNs (now: Tinu) | Permissions |
| 4 | DN rounding rule | DNs |
| 5 | Default action for iron, dhaagi, kachra, reti; how brass is handled | Sorting masters |
| 6 | What happens with weight excess: paid, credited, ignored? | Payables |
| 7 | TDS sections and rates (agreement says 0.1%; calls mention 2% and 0.1%) | Tax |
| 8 | Exact Tally stock item names and the third production by-product | Stock masters |
| 9 | Is stock dispatch by quantity enough for finished goods (decision 16)? | Stock |
| 10 | Why DN 116 carries 18.7 kg of mitti against 37.4 kg sorted | Concessions |
| 11 | Does Sakinaka buy scrap? (If yes, a future site) | Scope |
| 12 | Factory-side document list (four assumed) | Documents |
| 13 | Who bears return freight and is it recovered | Returns |
| 14 | Do factory staff have email addresses for login? (Short login IDs work without one) | Go-live |
| 18 | Who may add staff and reset passwords (default: owner, vbog_admin) | Permissions |
| 17 | Does Tinu post factory Tally entries from the portal screen, and when does his own Excel stop? Agree the cutover date with him | Source of truth |
| 15 | If 2B is switched on later: test with a real JSON from Niti (the parser has only seen a sample) | GST (optional) |
| 16 | GST API later: which GSP (or the provider Rich Alloys' consultants already use), cost, and who enters the OTP each 6 hours or 30 days | GST |

## 14. Risks

- Adoption: if entry is slower than the notebook, it will not be used. Measure time per arrival and per sorting entry in the parallel run.
- Two Tallys: ticks show what is entered where, but the portal cannot see inside Tally until import is built.
- Scope: production is now in; imports, sales and other sites will be asked for next.
- Public folder: the whole `Rich_Alloys` folder is currently public through GitHub Pages (decision 28). Scrub client
  details or serve only `deploy/` before real data or wider sharing.
- Invoice totals are readable by every staff member (needed for weights); payments, ledger and cash are not.

## 15. Glossary

OC, Lal: scrap grades · DC, lead copper, low quality: lower grades kept at a rate cut · mitti, attachment, iron,
dhaagi, kachra, reti: rejected material · goni: gunny bag · weight short/excess: our net vs billed net · DN/CN:
debit/credit note · provisional: part payment on invoice · LR: lorry receipt · GSTR-2B: auto-drafted input-tax statement ·
TDS: tax deducted at source · Tally Silver / cloud: factory and office Tally.
