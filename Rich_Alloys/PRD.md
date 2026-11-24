# Rich Alloys Purchase Portal: product requirements (v2)

Owner: Depesh Vyas (V-BOG) · Client: Rich Alloys India Pvt Ltd (Himanshu Jain) · Updated 18 Nov 2026
Status: v2.2 live on Supabase project `rqxjjrpngybglmhzlmtj` (Mumbai) since 19 Nov 2026, with Ogo test data, served at
v-bog.com/Rich_Alloys/deploy/. Section 7a items 1–5 built 19 Nov (stock opens 1 Nov 2026); items 6–7 partly. Section 7b (supplier types) built 20 Nov. Section 7c (Tinu's stock statement) built 20 Nov. Unbooked trucks and late bookings built 20 Nov (5a). Includes staff management and upload reliability from the interim build (decisions 25–28).

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
| 29 | An opening entry starts an item's stock: movements dated before it are already inside it and stop counting. Stock opened 1 Nov 2026 from Tinu's 31 Oct closings, so the Ogo lot of 25 Oct is not counted twice | Claude, 19 Nov, from 7a item 4 |
| 30 | **Every source that brings material in is a supplier**: domestic sellers, the Mumbai branch, import sellers, job workers. Each delivery is a lot with weights, sorting, rejections and documents. The money steps apply only where money is owed for the material (section 7b). (Numbered 25 in Depesh's draft; renumbered because 25–29 were already in use.) | Depesh, 20 Nov |
| 31 | A truck that arrives without a booking is recorded and tallied in full (lot, tax invoice, debit notes, payable, cash plan, ledger, both Tally queues, stock). Its deal is marked unbooked; the rate comes from the invoice until someone with `rate_confirm` (owner, vbog_admin) confirms or corrects it | Depesh, 20 Nov |
| 32 | **Every invoice rate that differs from the deal is flagged**, over or under. Himanshu or Tinu (`price_decide`: owner, vbog_admin, factory_accounts) chooses one of two: **accept the invoice rate** (the deal takes it, recorded in its rate history) or **keep the agreed rate** (if the invoice is higher, a debit note for the difference × billed kg + GST; if lower, nothing is raised and the supplier bills the difference). Deal rates stay editable at any time from the deal itself, with a history of who changed what and why. **A truck's price is fixed when it enters the factory** (the deal rate at that moment, then confirmed if the invoice differs); later deal changes apply only to trucks still to come, and **only Himanshu (`rate_confirm`) changes a truck's price** once it is in, on the lot. Debit notes wait until the truck's price is confirmed; a price cannot change under an approved debit note (cancel it first) | Depesh, 20 Nov |
| 33 | Every save or edit shows a visible "Saved" confirmation | Depesh, 23 Nov |
| 34 | Payment terms can be set per lot (over the deal's and supplier's). A **hold** (% and days; supplier default, deal or lot override; per lot or across the supplier's bills) limits payment to 100 − hold %: alert when that is reached, alert again when the held balance falls due Y days later | Depesh, 23 Nov |
| 35 | **Supplier onboarding**: a checklist (steps to be given by Depesh; empty until then), onboarded or not, shown wherever the supplier is chosen; recurring reminders per supplier alert the chosen person (Himanshu by default) on Home | Depesh, 23 Nov |
| 36 | A **PO is issued after the deal is booked**, never typed at booking. Numbered in the PO/RA/NNN/YY-YY series, downloadable as a PDF (basic design until the final one is given); re-issue when rates change | Depesh, 23 Nov |
| 37 | One table of every lot: supplier, weights, rates, each debit note, GST, income-tax TDS and GST TDS, paid and pending. TDS is recorded as income tax or GST | Depesh, 23 Nov |
| 38 | Production can be started (material used) and closed later (output weighed). Stock position: in the factory, in production, booked and still to come; on Himanshu's Home and the Stock page | Depesh, 23 Nov |
| 39 | **All rates in the portal exclude GST**; GST is always added on top (labels say so) | Depesh, 24 Nov |
| 40 | **Docs tab** for Himanshu: vendor compliance, every invoice's documents, every debit note; one tap downloads a complete .zip per invoice, per supplier or per month of debit notes (files, PO, DNs as PDFs, index). Admin moves to ⚙ in the top bar | Depesh, 24 Nov |
| 41 | **Vendor compliance gate**: a deal can be booked only with an onboarded supplier, or one Himanshu has overridden (long-standing but not fully compliant) after typing his password again; compliance files are kept on the supplier, per onboarding step | Depesh, 24 Nov |
| 42 | **Open pricing**: a deal is booked at a fixed price or open (to be fixed later, e.g. against LME), with a basis and "fix within X days"; each truck gets a fix-by date (changeable per truck) and an alert; debit notes wait until its price is fixed | Depesh, 24 Nov |
| 43 | **One truck can carry material from several deals** of the same supplier (each grade names its deal); deals and lots show each other | Depesh, 24 Nov |
| 44 | Supplier document checklist: "Vahan vehicle check" becomes **RC of vehicle**; **FASTag history** added (required); QA/QC report (factory) and supplier credit note (optional) added | Depesh, 24 Nov |
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

### 5a. Booking a supply, and trucks that come without one (built 20 Nov, `0011_unbooked_arrivals.sql`)

- **Booking** (step 1 above): Himanshu books on Lots > "+ New deal": supplier, grades, quantity, agreed rate, PO,
  expected arrival, GST, terms. It shows under Lots > On the way with kg still to come, and in the cash plan.
- **Late**: a booking past its expected date with material still to come shows "Late N days" on Lots and on the deal,
  and appears on Home as "Booked supplies that are late" for whoever can book deals.
- **"+ Truck arrived"** (Lots, for anyone with `inward_edit`) asks one question: which booked deal (opens its arrival form),
  not booked, or from the branch / an import seller / a job worker (section 7b).
- **Not booked**: one form (supplier, or a new one with GSTIN; invoice number, date, GST; per grade the supplier's slip
  and billed weights and the invoice rate, our weighbridge; invoice photo). It creates an unbooked deal from the invoice
  and the lot, which then goes through everything a booked truck does. The lot shows "Not booked: rate to confirm".
- **Rate confirmation**: Himanshu's Home lists "Trucks that came without a booking: confirm the rate". On the deal he
  confirms it, or corrects it to the phone rate first; debit notes then use his rate and the invoice rate shows as
  different from the deal on the lot. His confirmation is the truck's price (section 5b); debit notes wait for it.

### 5b. Rates and invoice rate differences (decision 32, built 20 Nov, `0012_prices.sql`, `0013_truck_price.sql`)

Hierarchy: **Deal** (what Himanshu agreed on the phone: supplier, one or more grades, each with quantity and rate) →
one or more **Lots** (each truck, with its invoice) → reductions on each lot (weight short, sorting: mitti, goni,
attachments, rejects; rate cuts; returns) → debit notes → payment.

- **Changing the deal rate** (anyone with `deal_edit`): on the deal, tap the rate (✎), type the new one, ✓. It applies
  to trucks still to come. Every change is kept in "Rate history" under the table: old → new, booked / deal changed /
  invoice rate accepted / confirmed (unbooked) / truck price changed (with the lot), who, when, and the invoice or note.
- **A truck's price** (`lot_lines.agreed_rate`) is fixed the moment the lot is logged (the truck has entered the
  factory): the deal rate at that time. The lot's summary shows "Price for this truck" per grade (invoice rate and our
  price) to anyone with `money_view`. Only Himanshu (`rate_confirm`: owner, vbog_admin) can change it: tap ✎ on the lot;
  it is logged as "truck price changed". His price counts as the decision, so no question is raised; if it is below
  the invoice rate, the excess is debited. Nobody can type a truck's price any other way (database trigger).
- **The price comes first**: no debit note on a truck can be approved while its invoice rate difference is open or,
  for an unbooked truck, before Himanshu confirms its price. Once a debit note is approved the truck's price is locked;
  cancel the note to change it. (The lot dashboard planned next will show "price to confirm" as its own stage.)
- **Arrival**: the invoice rate is typed from the invoice; it is never pre-filled from the deal (pre-filling hid
  differences). If it differs from the agreed rate the form says so in red while typing.
- **Decision**: a lot whose invoice rate differs from its deal shows one card with both choices on Home ("Invoice rate
  differs from the deal", top of the work list), on the lot and on the deal: grade, invoice and agreed rates, ₹/kg × kg
  and the total with GST. "Accept invoice rate" sets this truck's price to the invoice rate and the deal's rate too,
  for trucks still to come. "Keep agreed rate" raises a debit note of type
  "Invoice rate above agreed" when the invoice is higher; it needs no sorting to finish and has no stock effect. Others
  see "Himanshu or Tinu will decide this." The lot stays at "DN to approve" until it is decided.
- Only domestic lots on a tax invoice are checked (branch, import and job work carry no money, section 7b).

### 5c. Holds, onboarding, PO, lot table, stock position (decisions 33–38, built 23 Nov, `0014_holds_onboarding_po_stock.sql`)

- **Saved**: every save shows a green "Saved" banner for 2.5 s (also "File uploaded" when the upload queue finishes one).
- **Lot payment terms**: the lot's first tab has "Payment terms" with "Set for this lot" (provisional %, days, balance
  days, hold % and release days). Empty fields fall back to the deal, then the supplier.
- **Hold** (`v_payment_holds`): paid counts every payment not rejected. Limit = (net payable: invoice − DNs − TDS) ×
  (100 − hold)%. Status: paying → holding (limit reached on the date the payments crossed it) → release due (that date +
  hold days) → cleared. Home: "Payment limit reached: hold the rest" (until "Noted" is tapped on the lot) and "Held
  payments now due". The payment form shows how much can be paid now and warns when an amount goes past the limit.
  Scope per supplier: each lot, or all the supplier's bills together (advances count).
- **Onboarding**: Admin > Onboarding holds the steps (none yet). Supplier page (`#/supplier/<id>`, linked from the deal,
  Admin > Suppliers and Home): tick steps, "Mark as onboarded" once every required step is done, reopen if needed.
  New deal marks suppliers "not onboarded"; Home lists not-onboarded suppliers that have a deal (`supplier_onboard`:
  owner, vbog_admin, factory_accounts, ho_accounts). Nothing is blocked until the process is defined.
- **Reminders**: per supplier, every N days/weeks/months/years, for a role (default Himanshu). Due ones are on that
  person's Home with "Done"; done logs it and moves the date on (past today if missed).
- **PO**: New deal has no PO field. The deal shows "PO not issued yet" and Home lists "Booked: issue the PO". "Issue PO"
  suggests the next number (editable, unique), issues it and downloads the PDF (company, supplier, delivery, grades,
  qty, rate, GST, total, terms, conditions, signatory). If a rate changes after issue, the deal asks to re-issue (Rev 2…).
- **Lot table**: Lots > Table (remembered per phone): one row per lot with the columns in decision 37, totals, CSV.
  Money columns only for `money_view`.
- **Production**: leave "Made" empty to save it as in production; "Production done: enter what was made" closes it.
  Output enters stock on the closing date. **Stock position** (`v_stock_position`): in factory (stock today), in
  production (used in runs not closed), booked (deal kg still to come), total.

### 5d. Docs, vendor compliance, open price, several deals per truck (decisions 39–44, built 24 Nov, `0015_compliance_docs_open_price.sql`)

- **Docs** (bottom bar; `money_view`, `supplier_onboard` or `doc_approve`). Three tabs:
  - *Vendor compliance*: every supplier with Onboarded / Overridden / Not onboarded, steps done, compliance files, files in
    all, and "Download all" (compliance files, each deal's files and PO, each invoice's files and DNs, index.csv).
  - *Invoices*: every lot with its invoice, deals, number of files, DNs and QA/QC; "Download" gives that invoice's pack
    (supplier documents, our weighbridge/sorting/QA-QC, PO, DN PDFs, index.csv). A truck's pack includes its deals' files.
  - *Debit notes*: "To raise" (calculated, not approved) and "Raised" by month, each with its PDF, "credit note
    received" when the supplier's CN is uploaded on the lot, and "Download all for the month". DN PDFs use a basic layout
    (CGST+SGST for Maharashtra suppliers, else IGST) until Rich Alloys' DN/CN formats arrive.
  - Packages are built on the phone (`web/src/pack.ts`, JSZip and jsPDF loaded only then). Files missing in storage are
    listed in index.csv instead of failing the pack.
- **Compliance** (supplier page): each onboarding step has its files (photo/PDF through the upload queue; stored under
  `suppliers/<id>/<step>/`, `documents.supplier_id`), plus "Other compliance documents". `create_deal` refuses a domestic
  supplier that is neither onboarded nor overridden (app users; data loads are not checked). Himanshu
  (`compliance_override`, owner only by default) can override from the supplier page or straight from New deal: reason +
  his password; the app signs him in again and the database accepts the override only if the token shows a password
  sign-in in the last 5 minutes (`signed_in_recently()`). Override and its removal are logged.
- **Open price**: New deal has "Fixed price / Open (LME, fix later)". Open: rates may be left empty, price basis text and
  "fix within N days" (default 7). A truck on an open line gets no price (`lot_lines.agreed_rate` empty) and
  `lots.price_fix_by` = arrival + N. Lot shows "Price open · fix by …" (Himanshu can change the date) and Home lists
  "Open prices to fix" from that date (at once if no date). Himanshu fixes a truck on the lot (✎), or the whole deal on
  the deal page (every open truck takes it). Tinu can set the deal rate but cannot fix trucks already in. After fixing,
  invoice-rate differences are handled as in 5b. Debit notes and the lot's "DN to approve" wait while the price is open.
  The PO shows "Open *" with the basis.
- **Several deals per truck**: arrival form "+ Material from another deal on this truck" adds the grades of another open
  deal of the same supplier (one grade once per truck). `lot_lines.deal_id` names each line's deal; prices, received kg,
  still-to-come and stock "booked" follow it; the lot header lists every deal and the deal page lists every truck that
  carried its material (`v_lots.deal_ids`).
- **D-0001** was never missing: the Ogo deal was created as D-0001 and renamed to RA-082 (Rich Alloys' own number) when
  its documents were loaded.

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

## 7a. What Tinu's stock and production sheets show (Apr–Oct 2026)

Source: the 14 workbooks Tinu sends Niti monthly, cleaned into `Tinu_stock_Apr-Oct_2026_clean.xlsx`
(Project files; it holds client data, so keep it out of any public repo). 631 stock movements, 67 production days.

**What holds up**
- Every sheet adds up and every month carries into the next. October closings: copper scrap 105,380.660 kg, copper wire
  6,701.620, phosphorus copper 2,670.000, copper ingot 10,893.850, copper strips 0, copper ingot 74031900 0.
- Production report and stock ledger agree on scrap consumed and ingots produced every month.
- Purchases are booked at the supplier's billed net (OGOES15 = 9,957.900 kg on 25 Oct), and debit notes take kg off
  stock, exactly as the portal does.

**What does not**
- April consumption dated 4–5 Apr in the production report, 1–2 Apr in the stock ledger.
- Dates typed into the wrong month (21.05.20226; 10.09 in June; 10.07 and 11.07 in August).
- April opening scrap 38,620.73 in the 31 Mar statement vs 38,650.23 in the ledger; April's summary notes its own 2,501.40 kg gap.
- Party names vary for the same party, and no GSTINs are recorded.

- Copper ingot is also *bought*: 33 purchases, 545.5 t in 7 months, besides 822.8 t
  produced. 575.5 t moved from Copper ingot to Copper ingot 74031900 (open question 23).
- Checked 19 Nov against the workbook: October closings, monthly balances (no differences), 631 movements, 67 production
  days, 35 scrap sales (429.6 t), 3 import receipts (95.1 t), OGOES15 at 9,957.900 kg on 25 Oct.

**What it changes in the portal** (status 19 Nov after each item)
1. Stock items, named as in these sheets: Copper scrap, Copper wire, Copper strips, Phosphorus copper, Copper ingot,
   Copper ingot (74031900), Copper dross/slag, Copper ash. (Plastic scrap appears once in a summary; confirm.) Replaces
   the four starting items. Wire is bought and consumed alongside scrap. **Built** (`0008_stock_7a.sql`; codes kept, names changed).
2. Stock movements beyond supplier lots, quantity only, each with date, party, document number:
   transfer from the Mumbai branch (delivery note; 39 in 7 months: 95.7 t of scrap in, 21.1 t back out), job work received (KBS Industries, Mehtacop),
   import receipt on a bill of entry (Alcumet, Alco Metal; the import process itself stays out of scope),
   sale/dispatch (scrap is also sold on: 35 sales, ~430 t), item-to-item transfer (Copper ingot to Copper ingot 74031900),
   credit note received. Without these the portal's stock cannot match Tinu's. **Narrowed by 7b** (branch, import and
   job-work receipts are now lots). **Built**: Stock > Other stock entry, each with
   party and document number, item-to-item in one step (`transfer_stock`); summary columns follow Tinu's monthly layout.
3. Production: dross and ash are booked as fixed percentages of what was consumed (1.5% / 0.5% in April; 3.5% / 1.5% and
   6.5% / 1.5% later), so input always equals output and real melting yield is never measured. The production form keeps
   the actual figures entered and shows yield % (ingot ÷ consumed); it must not force input = output. **Built**:
   `v_production_runs` gives yield and "not accounted for" kg per run (Tinu's 2 Oct run: 95.00%, balanced by his percentages).
4. Opening stock: start the portal on 1 Nov 2026 with the October closings above as opening entries. The Apr–Oct
   history stays in the workbook; importing it is optional. **Built and loaded live** (`test_data/opening_2026_11.sql`), with
   dross/slag 17,457.000 and ash 8,051.640 from the October production report. Scrap 30 Nov: 105,179.960 kg after the
   Ogo DNs of 5 Nov. Plastic scrap (−29,020 kg in his sheet) is not loaded: question 24.
5. Dates: warn when a date is outside the current month or in the future. **Built** for every date that records an event
   (arrival, payment, sorting, return, TDS, production, stock entry); invoice dates warn only when in the future.
6. Supplier master keyed on GSTIN. The sheets show 49 scrap supplier *spellings*; the same party is often written
   several ways, so the real count is lower. Collect GSTINs, then merge the spellings. **Partly**: GSTIN shape checked in
   the database and in both supplier forms; merging spellings waits for the GSTINs.
7. Regression: a test loading the October closings and November movements must reproduce Tinu's November sheet
   during the parallel run. **Ready**: the 1 Nov opening is loaded; `tests/checks_7a.sql` covers the mechanics. The
   November sheet is needed to write the check itself.

## 7b. Supplier types (decision 30)

Each supplier has a type. The physical steps are the same for all; the money steps differ.

| Type | Examples from Tinu's sheets | Lot, weights, sorting, documents | Rejected material | Invoice, payment, cash plan, ledger, TDS |
| --- | --- | --- | --- | --- |
| Domestic purchase | RS Industries, Ogo, Rajput Metallica | Yes | Debit note (money and kg) | Yes |
| Own branch | Rich Alloys, Mumbai (delivery notes) | Yes | Shortage / return note, kg only (a company cannot debit itself) | No: same company, no sale |
| Import | Alcumet Trading, Alco Metal Trading (bill of entry) | Yes, from arrival at Palghar | Claim note, kg only for now | No: paid through LC; imports stay out of scope |
| Job worker | KBS Industries, Mehtacop Refinery (material returned after processing) | Yes; also shows what was sent vs returned | Shortage note, kg only | Their service bill only, if Himanshu wants it tracked |

Not suppliers: customers returning goods (the credit notes from HKL Industries are sales returns; sales side, out of scope).

What this changes in the build:
- `suppliers.type` (domestic, branch, import, job_work); the arrival form asks for a delivery note, bill of entry or challan instead of a tax invoice when the type is not domestic.
- Lots from non-domestic suppliers skip the invoice, payable, cash plan, ledger and TDS; their notes carry kg, not rupees, and still reduce stock.
- The Mumbai branch also needs Mumbai-side documents (who sent it, vehicle, weight at dispatch) so transfer shortages show up.
- Item 2 of section 7a narrows: transfers from Mumbai, imports and job-work receipts become lots; only sales/dispatch, item-to-item transfers and sales returns stay as plain stock movements.

**Built 20 Nov** (`0009_supplier_types.sql`):
- `suppliers.supplier_type` (domestic, branch, import, job_work; named `supplier_type`, not `type`). Admin > Suppliers
  can now add a supplier directly, with its type; the new-deal form lists domestic suppliers only.
- The inward document has a kind (`invoices.doc_kind`): tax invoice, delivery note, bill of entry, challan. It follows
  the supplier type and carries no money for non-domestic lots.
- Lots > "+ From branch / import / job work": one form, no deal needed (`create_receipt` makes one behind the scenes).
  Asks for the document number and date, the weight on their document ("weight sent from Mumbai" for the branch),
  our weighbridge gross and bags, who sent it at Mumbai, and a photo of the document (through the upload queue).
  Shortage or excess shows live.
- Notes on non-domestic lots are kg only and named "Shortage / return note" (branch, job work) or "Claim note"
  (import). They still take kg off stock and go to factory Tally. No Payment tab, no office-Tally tick.
- Money views (payable, cash plan, ledger, supplier balance, invoice register, GST by month, office-Tally queue,
  2B task) count tax invoices only.
- Stock > Other stock entry keeps sales/dispatch, sales returns (credit notes), item-to-item, opening and correction,
  plus two outward kinds 7b did not list: **to the Mumbai branch** and **sent for job work** (question 27). Both name
  the supplier, so Stock shows a "With job workers" panel: sent, came back, still with them (`v_job_work`).
- The document checklist follows the supplier type (question 26): PO, tax invoice and e-invoice for domestic only;
  delivery note, bill of entry or challan required for their type; everything else for all.
- Not built: Mumbai weighing at dispatch beyond the delivery-note weight, job-work service bills (question 19).

## 7c. Tinu's monthly stock statement (Stock_analysis_2627.xlsx)

Source: the stock statement Tinu keeps for 2026-27 (Project files; client data, keep out of any public repo). One table
per month, April to November, and a year total, for nine items, in these columns:
OP BALANCE · PURCHASE · TRANSFER RECED · MFG · Recipt Note · Recd Process Job Wrk · CREDIT NOTE · TOTAL · SALE ·
Transfer to · Debit Note · Del Note To Rich Mum · Send to Labour Job · Consumption · Closing Balance.
It is the summary his stock and production sheets roll up into, and every month adds up ("diff 0").

**What it shows**
- Branch receipts ("Recipt Note", 86.6 t in the year) and job-work returns ("Recd Process Job Wrk", 62.4 t) are their
  own columns, not purchases. Imports are inside PURCHASE.
- Plastic scrap is a real item: 7,865 kg at April opening, then received, transferred in from copper scrap and sold;
  **0 at the end of October**. The −29,020 kg in the October production report is an error there (question 24).
- Copper ingot is bought (545.5 t), produced (822.8 t), sent to and received back from job work (24.9 t in Sept) and
  has small debit notes, so bought ingots are domestic lots with weights and DNs (question 23, partly answered).
- Dross/slag receives material from job work (8,000 kg in June, 2,300 kg in July, remarks "Copper Dross (Ann)") and
  from copper ash (2,500 and 1,570 kg, item-to-item).
- The second ingot item is "Copper Ingots(74031200)" here but "COPPER INGOT_74031900" in the stock sheet (question 29).
- Copper scrap closes October at **105,380.75 kg** here, but 105,380.66 kg in the stock ledger and production report.
  The 0.09 kg gap starts in May and carries through. The portal opens at 105,380.660 until Tally settles it (question 28).

**Built 20 Nov** (`0010_stock_statement.sql`)
- `stock_summary` returns Tinu's columns. Lots fall into PURCHASE (domestic, import), Recipt Note (branch) or
  Recd Process Job Wrk (job work) by supplier type. Corrections show in their own column only when there are any.
- Stock > "Stock statement" prints the month in his layout (company header, his column headings); "Download (CSV)"
  gives the same table. This replaces the sheet once the parallel run shows it matching.
- Item Plastic scrap added (opening 0, so nothing to load).
- Job-work returns of ingots or dross need grades mapped to those items (Admin > Grades) before Tinu records them as lots.

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
| `suppliers.supplier_type`, `invoices.doc_kind`, `lots.sent_by`, `stock_moves.supplier_id`, `doc_types.supplier_types` | Supplier types (7b) |
| `stock_moves.party`, `.doc_no`, `.transfer_id`; kinds for branch, job work, import receipt, sale, credit note, item-to-item | Stock movements beyond lots (7a) |
| `tally_marks.amount_at_mark`, `documents.lot_id` | Amount when ticked (to detect later changes); invoice photo per lot |
| `deal_rate_history`, `price_decisions`, `lot_lines.agreed_rate` | Every rate change on a deal (old, new, why, lot, note, who, when); each invoice-rate decision (accept or keep, who, when); the rate a settled truck is pinned to |
| `documents.supplier_id, onboarding_step`; `suppliers.compliance_override_at/by/reason` | Compliance files on the supplier; override |
| `deal_lines.rate_per_kg` empty = open; `deals.price_basis, price_fix_days`; `lots.price_fix_by`; `lot_lines.deal_id` | Open pricing; several deals per truck |
| `payment_hold_acks`; `suppliers/deals/lots.hold_pct, hold_days`, `suppliers.hold_scope` | Payment hold settings and "noted" alerts |
| `onboarding_steps`, `supplier_onboarding`, `suppliers.onboarded_at/by`; `reminders`, `reminder_log` | Onboarding checklist and status; recurring reminders and when each was done |
| `deals.po_issued_at/by, po_revision`; `tds.kind` (it, gst); `production_runs.status, closed_on` | PO step; TDS type; production open or closed |
| `gstr2b_imports`, `gstr2b_lines` | Uploaded 2B months and their lines, with the matched invoice |
| `documents`, `audit_log` | Files and their status; every change logged |

Views: `v_lot_lines`, `v_dn_calc(_lines)`, `v_sorting_exceptions`, `v_payable`, `v_tally_missing`, `v_doc_gaps`,
`v_lots` (stage), `v_deals_incoming`, `v_ledger_lines`, `v_supplier_balance`, `v_cash_plan`, `v_gst_month`,
`v_stock_moves` (opening starts an item), `v_production_runs` (yield), `v_job_work` (sent vs back), `v_tally_dn_export`, `v_gstr2b_recon`, `v_tally_changes`, `v_tally_queue`, `v_invoice_register`, `v_price_diffs` (invoice rate vs deal rate, open or decided), `v_payment_holds`, `v_lot_register`, `v_stock_position`, `v_doc_index` (every file with supplier, deal, lot, invoice, step), `v_tasks` (each person's to-do list). Function `stock_summary(from, to)`.

Actions (functions): `create_deal`, `create_lot`, `close_lot`, `reopen_lot`, `approve_dn`, `cancel_note`,
`set_note_tally_no`, `mark_tally`, `unmark_tally`, `reconcile_payment`, `reject_payment`, `confirm_ledger`,
`clear_tally_change`, `override_compliance`, `clear_compliance_override`, `supplier_compliance`, `ack_payment_hold`, `set_onboarding_step`, `set_supplier_onboarded`, `complete_reminder`, `suggest_po_no`, `issue_po`, `close_production`, `set_deal_rate`, `decide_price`, `confirm_deal_rate`, `create_unbooked_lot`, `set_invoice_2b`, `import_gstr2b`, `save_production`, `verify_document`, `approve_document`, `reject_document`.

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

## 10a. iPhone and Android apps (planned, iPhone first)

**Now (23 Nov): installable web app for the team, for testing and QA.** No store, no accounts. The site has a web app
manifest, icons and a service worker (`web/public/manifest.webmanifest`, `sw.js`): Android/Chrome shows "Install
app" (Home card, or Chrome menu > Install app), iPhone uses Safari > Share > Add to Home Screen. It opens full screen
from its own icon, uses the same database and login, updates itself on every deploy (pages network-first; built files
cached), and opens offline to the last screen shell (data still needs the network; photos wait in the upload queue).
An Android .apk can be built the same way later if a file to send is wanted. The store apps below replace it.

The same React app, wrapped with **Capacitor** (one codebase: the website, the iPhone app and the Android app stay
identical). The app bundles the screens and talks to the same Supabase project.

What has to change in the code (in a `web/` Capacitor project, `ios/` and `android/` folders):
- Downloads (PO PDF, CSV, printed statements) go through the phone's share sheet (Capacitor Filesystem + Share), because
  an app's web view cannot "download" a file the way a browser does.
- Camera and photo picker for invoices keep using the upload queue; the app asks for camera and photo permission.
- **Push notifications** (the real "alert Himanshu"): Apple Push (APNs) and Firebase for Android; a Supabase function
  sends a push for new Home items (reminders due, payment limit reached or due, price to decide, PO to issue).
- Safe-area padding (notch, home bar), app icon and splash screen, sign-in kept on the phone.

Builds: GitHub Actions on a macOS runner builds and signs the iPhone app and uploads it to TestFlight on every merge, so
no Mac is needed; Android builds on Linux into an .aab for Google Play (or an .apk to install directly).

Needed from Rich Alloys / V-BOG (not code):
1. **Apple Developer Program** membership (USD 99 a year). In the company's name needs a D-U-N-S number (free, can
   take 1–2 weeks); an individual account is faster but shows the person's name as the seller.
2. App name, bundle ID (e.g. com.richalloys.purchase), icon (1024 × 1024 PNG).
3. An **App Store Connect API key** (Admin creates it in App Store Connect > Users and Access > Integrations) and
   permission to store it as a GitHub Actions secret, for automatic TestFlight uploads.
4. How staff get it: **TestFlight** (up to 100 internal testers, no review, each build lasts 90 days; simplest to start)
   or an **unlisted App Store** listing (review once; a link only staff know). Apple needs a privacy policy URL and a
   demo login for review.
5. Android: a **Google Play Console** account (USD 25 once), or install the .apk directly on staff phones.


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
- `tests/checks_booking.sql`: an unbooked truck from a new supplier is a full purchase (tax invoice at weights x invoice
  rate + GST, payable, both Tally queues, stock); Tinu is not asked to confirm and cannot; Himanshu is; his corrected rate
  drives the weight-short DN; no rate change under an approved DN; a booking 3 days past its date is late and on the
  to-do list. Proven to fail when the rate permission is removed.
- `tests/checks_prices.sql`: a deal for OC and Lal; truck 1 invoiced OC ₹50/kg above is flagged (₹1,00,000 + GST =
  ₹1,18,000), Lal at the agreed rate is not; Sanjay cannot decide or change a rate; Tinu keeps the agreed rate and the
  ₹1,18,000 debit note is approved before sorting and reduces the payable, not stock; truck 2 at the same rate is
  accepted by Himanshu, the deal moves to ₹1,250 with history, truck 1 stays at ₹1,200; truck 3 under the rate raises no
  note; a rate edit with a note is logged with who. `0013`: the truck price is fixed on entry; the weight-short DN waits
  for the price decision and then uses ₹1,200; a deal change after truck 3 is in leaves truck 3 alone and truck 4 takes
  it; Tinu cannot change a truck's price and nobody can write it directly; Himanshu can, logged with his note, and it
  needs no further decision; no truck price change under an approved DN. Proven to fail without the entry pin. Browser role play (360 px, Hindi): Himanshu books OC and Lal in one
  deal, raises OC on the deal, Sanjay's arrival form flags the invoice rate, Tinu keeps the agreed rate from Home,
  Himanshu accepts the next truck from Home in Hindi; no sideways scrolling.
- `tests/checks_0014.sql`: Ogo in the lot table (invoice less DNs ₹1,46,82,999.40, balance ₹6,82,999.40; no money for
  Sanjay); PO numbering after PO/RA/082, issue, re-issue, one use per number, Sanjay cannot; hold 10%/15 days on a
  ₹14,16,000 lot: limit ₹12,74,400, holding from the crossing payment, alert, noted, over-limit flag, release due with
  ₹1,40,600, cleared, lot override 80%, supplier-wide limit; TDS split; onboarding steps named when missing, then
  onboarded, Sanjay cannot; a reminder missed for two months is due for Himanshu only and moves past today when done;
  production started (500 kg out of stock into production) and closed (yield 94%), once. Browser: PO issued from the
  deal with the PDF downloaded and "Saved" shown; role play at 360 px in English and Hindi of every new screen.
- `tests/checks_0015.sql`: RC/FASTag/QC/CN document types, compliance files not counted as deal gaps; booking refused
  for a supplier not onboarded (also one added while booking); Tinu cannot override; Himanshu's override refused with a
  password typed an hour ago, refused without a reason, accepted with a fresh sign-in, logged with his name; removal
  blocks again; a compliance file indexed under the supplier and step; open price deal (no rate recorded), a missing rate
  without "open" refused; open truck: no price, fix-by arrival + 10, no comparison, DN refused, Tinu's deal rate leaves
  it open, on Himanshu's list when due, fixed at ₹1,190 (logged), invoice ₹1,200 debited ₹10/kg, weight short at ₹1,190;
  fixing an open deal fixes both its trucks; one truck with OC from deal A and Lal from deal B at B's rate, received kg
  per deal, deal B lists the truck, another supplier's deal refused, a grade twice refused. Browser role play: new
  supplier blocked then overridden with password while booking an open-price deal, Tinu blocked without the override
  option, one truck with two deals, Himanshu fixes the open price on the lot, a GST certificate uploaded on a step,
  supplier / invoice / month-of-DN zips downloaded and listed.
- `tests/checks_7a.sql` also checks Tinu's statement arithmetic for every item; `checks_7b.sql` checks that a branch
  delivery is a Recipt Note and job work sits in its own columns, not in PURCHASE.
- `tests/checks_7b.sql`: a branch delivery (Tinu's delivery note 37, 2,505 kg) on a delivery note with no money, its
  5 kg shortage note in kg only, no payable/cash/ledger/register rows, factory Tally only, stock up 2,505 and down 5,
  domestic still needs a deal, job work sent 1,000 / back 950, checklist by type, Ogo balance unchanged. Proven to
  fail when branch lots leak into payables.
- `tests/checks_7a.sql` (run by `run_local.sh` after loading the 1 Nov opening): opening = Tinu's closing, the Ogo lot not
  counted twice, DN kg taken off, Tinu's 2 Oct yield, input need not equal output, every movement kind in its column,
  opening + in − out = closing for every item, one-sided transfers and sales that add stock refused, GSTIN shape.
  Proven to fail when the opening rule is removed. `tests/e2e/run.py` passes on the 7a build (19 Nov).
- `tests/e2e/run.py` passed on 19 Nov on the merged v2.2 (PostgREST 12.2.3, Python Playwright 1.63.0, installed by the
  environment's setup script): DNs ₹7,080 / ₹1,180 / ₹14,160, ledger ₹10,90,179.40, cash ₹10.90 L open, register photo ✓
  factory ✓ PUR-501 office ✗, copper scrap 10,242.200 kg, watchman sees no money screens, no sideways scrolling, no errors.
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
| 22 | Who may add staff and reset passwords (default: owner, vbog_admin) | Permissions |
| 17 | Does Tinu post factory Tally entries from the portal screen, and when does his own Excel stop? Agree the cutover date with him | Source of truth |
| 18 | Are dross and ash weighed or set as a percentage? Who sets the percentage? (Yield is Himanshu's margin) | Production |
| 19 | Decided: every source is a supplier (decision 30). Still to confirm: does Mumbai weigh at dispatch, and who at Mumbai uploads the delivery note? Do job-work bills need tracking? | Supplier types |
| 20 | Scrap sold on (~430 t in 7 months): does it pass through sorting, or is it back-to-back trading? | Stock |
| 21 | What are the 2,501.40 kg April gap and the 29.50 kg April opening difference? | Stock history |
| 26 | Document checklist per supplier type (built as a proposal, see 7b): is it right for the branch, imports and job work? | Documents |
| 27 | Material sent out to the Mumbai branch and to job workers is kept as a stock movement naming the supplier (7b listed only sales, item-to-item and sales returns). Confirm | Stock |
| 30 | ~~An invoice rate above the agreed rate raises no debit note. Should it?~~ Answered (decision 32): every difference is flagged; accept the invoice rate or keep the agreed rate with a debit note. Still open: the exact DN and CN formats Depesh will send, to be recreated exactly | DNs |
| 24 | Plastic scrap: the stock statement shows 0 at 31 Oct (portal agrees, item added); the October production report shows −29,020 kg. Confirm the report figure is an error | Stock opening |
| 28 | Copper scrap at 31 Oct: 105,380.75 kg (stock statement) or 105,380.66 kg (stock ledger, production report)? Which does Tally show? The portal opened at 105,380.66 | Stock opening |
| 29 | The second ingot item: HSN 74031200 (stock statement, production report heading) or 74031900 (stock sheet)? | Stock masters |
| 23 | Copper ingot is bought as well as produced (545.5 t in 7 months). Do bought ingots come in through the portal as lots (with weights and DNs, but no sorting)? And why do 575.5 t move to "Copper ingot 74031900"? | Stock, scope |
| 15 | If 2B is switched on later: test with a real JSON from Niti (the parser has only seen a sample) | GST (optional) |
| 16 | GST API later: which GSP (or the provider Rich Alloys' consultants already use), cost, and who enters the OTP each 6 hours or 30 days | GST |

## 14. Risks

- Adoption: if entry is slower than the notebook, it will not be used. Measure time per arrival and per sorting entry in the parallel run.
- Two Tallys: ticks show what is entered where, but the portal cannot see inside Tally until import is built.
- Scope: production is now in; imports, sales and other sites will be asked for next. Section 7a item 2 brings branch
  transfers, import receipts and sales into *stock* as quantity-only movements (no prices, buyers or import process);
  keep it at that.
- Public folder: the whole `Rich_Alloys` folder is currently public through GitHub Pages (decision 28). Scrub client
  details or serve only `deploy/` before real data or wider sharing.
- Invoice totals are readable by every staff member (needed for weights); payments, ledger and cash are not.

## 15. Glossary

OC, Lal: scrap grades · DC, lead copper, low quality: lower grades kept at a rate cut · mitti, attachment, iron,
dhaagi, kachra, reti: rejected material · goni: gunny bag · weight short/excess: our net vs billed net · DN/CN:
debit/credit note · deal: what was agreed on the phone (grades, kg, rate) · lot: one truck against a deal · provisional: part payment on invoice · LR: lorry receipt · GSTR-2B: auto-drafted input-tax statement ·
TDS: tax deducted at source · Tally Silver / cloud: factory and office Tally.
