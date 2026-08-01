# Nikash — Architecture & Developer Handbook

> **Read this before changing anything.** The PRD says *what* to build; this file
> records *how it is built*, which decisions were forced, and which questions the
> source documents left open.

**Source of truth:** `PRD v3.0 MASTER` · `item_bank_v1.1_FINAL` · `verification_call_playbook_v2`
**Status:** Phase 0 and the database half of Phase 1 are done and verified live.
**Last updated:** 30 July 2026.

---

## 1. The 60-second overview

Same shape as Vyom (`internal/pm/`): **static frontend + Supabase, no framework,
no build step.**

- **Frontend**: plain HTML/CSS/JS in this folder, deployed by the existing GitHub
  Pages workflow with the main site. Push to `main`, live in ~1 minute.
- **Backend**: Supabase project `zglavicybcjctogspbap` (`Closer-Match`,
  ap-southeast-1). Postgres 17 + PostgREST. No server of our own.
- **All scoring is in Postgres.** The frontend renders; it does not compute.

```
Browser ── sbFetch() ──> PostgREST ──> Postgres  (staff console, RLS-gated)
Browser ── sbRpc()   ──> 3 SECURITY DEFINER functions  (candidate test, no table access)
```

### Why not React/Next.js on Vercel, as PRD §8 says

PRD §8 names that stack, but its own governing constraint is that *"scoring lives
in Postgres functions and views, not application code — one inspectable place, no
drift between environments"* and *"the frontend renders; it does not compute."*
Vyom already implements exactly that shape in this repo, on a domain that is
already deploying. Adding Next.js and Vercel would buy a build step, a second
deploy target, a second account and a second place for logic to drift to, in
exchange for nothing this product needs. **Deviation taken deliberately; the
architectural constraint the PRD actually cares about is preserved.**

---

## 2. File map

| Path | Role |
|---|---|
| `sql/01_schema.sql` | Every table (PRD §8), the reveal gate, the no-blended-CLS constraint, param audit trigger |
| `sql/02_dictionary.sql` | 9 dimensions + **every** scoring parameter (§6.2, §6.3, §9.2.1, §9.4, §6.5) |
| `sql/03_item_bank.sql` | All 44 items and keys, with seed assertions that fail loudly |
| `sql/04_scoring.sql` | §7.2 scoring, the 4 flags, and the §14.2 instrument-health views |
| `sql/05_target_profile.sql` | Intake → required levels, weights, bipolar targets, CLS blend, confidence |
| `sql/06_golden_cases.sql` | §14.1 fixtures + `run_golden_cases()` — written **before** the engine |
| `sql/07_match_engine.sql` | §9 engine, `v_console`, §14.3 and §14.5 monitoring views |
| `sql/08_rls_retention.sql` | Default-deny RLS, the candidate RPC path, C3/C4 purge |
| `js/config.js` | Supabase URL + **publishable key only** |
| `js/supabase.js` | `sbFetch()` / `sbRpc()` — the only network wrappers |

Run the `sql/` files in numeric order. All are idempotent. `06` and `07` have a
circular reference by design (the fixtures call the engine, the engine is written
to satisfy the fixtures); Postgres does not validate function bodies at creation,
so the order works.

---

## 3. The three rules, and where each is physically enforced

| Rule | Enforcement — not a convention, a constraint |
|---|---|
| **R1 / C10** — scores never leave the building | No policy anywhere grants a non-staff principal read on `candidate_profile`, `matches`, `client_target_profile`, or any rating table. `v_c10_audit` lists violations and must always be empty. |
| **R2** — candidate assessed blind to any client | `start_assessment(token)` takes no client parameter. There is no code path that could vary the test by client. |
| **R3 / C9** — the system never decides | `matches` has no `rejected`, `status` or `shortlisted` column. A hard-filter failure still writes a row with `hard_filter_pass = false` and the failing filters **named**, so every exclusion is visible and overridable. |

Two more invariants worth the same treatment:

- **No blended CLS is ever stored.** `candidate_profile` carries a CHECK
  constraint `not (scores ? 'CLS')`, and `compute_candidate_profile()` raises if
  asked. Storing a blend would make a candidate's score depend on whichever
  client they were matched to first — §7.2's "toggle problem in disguise".
- **Rate before scores unlock.** The playbook says "enforced in the UI". A UI
  check is a suggestion, so `interviews` also carries a CHECK that
  `scores_revealed_at >= ratings_submitted_at`.

---

## 4. The item-key leak, and why the candidate surface has no table access

This is the one leakage vector that would be **our own fault** rather than a
WhatsApp group's. The frontend talks to PostgREST with a publishable key. If
`item_options` were readable by that key, any candidate could open devtools and
read `score_key` for all 44 items — the complete answer key, in the browser.

So `anon` has **no table access at all**, and the candidate surface goes through
exactly three `SECURITY DEFINER` functions:

| Function | Returns |
|---|---|
| `start_assessment(token)` | stems + option text, option order randomised per session, **no `score_key`** |
| `save_response(token, …)` | nothing; validates the option exists, autosaves, touches `last_activity_at` |
| `finish_assessment(token)` | `{complete: true}`. Scores server-side. The candidate never receives a score. |

`issue_assessment_token()` is staff-only and deliberately not granted to `anon`.

---

## 5. Findings — where the source documents were wrong, silent, or in tension

Recorded here because a golden case that gets quietly weakened to go green is
worse than no golden case.

### 5.1 & 5.2 — the CLS blend was a step function. **RESOLVED, `sql/09`.**

Two findings with one root cause, closed together on 31 July 2026.

**5.1 — the band edge was a cliff.** §14.1 case 2 asks that ₹79,000 vs ₹81,000
produce *"a slight shift, not a reorder."* Under §9.2.1's **banded** lookup,
crossing the ₹80,000 edge moved `w_C` by a full **0.20** in one step. Measured on
the fixtures: F6 (CLS_C 55 / CLS_F 78) and F7 (78 / 55) were exactly tied at 66.50
at ₹79,000 and separated to 61.90 vs 71.10 at ₹81,000. **They swapped.** Both have
a 23-point gap — *below* the `frame_split_flag` threshold of 25 — so neither was
flagged. The flag did not capture who was exposed.

**5.2 — cycle could not correct the ticket band.** §14.1 case 3 wants a ₹20,000 /
45-day requirement to raise `w_C` *"enough that a CLS_C-strong candidate isn't
penalised."* Measured under v1: `w_C` rose 0.130 → 0.227, moving a
CLS_C-82 / CLS_F-41 candidate's effective CLS 46.3 → **50.3, only +4.0 points**
against a required 75. Directionally right, practically useless. The cause was
scale: ticket controlled a range of 0.70, cycle adjusted by at most ±0.15. §9.2.1
Step 2 exists precisely to catch "₹40k on one call vs ₹40k over six weeks with
three stakeholders", and additively it could not.

**The fix — one continuous consideration axis.** The owner's instruction on 5.1
was "if the difference is ₹2,000, don't move the candidate a whole grade."
Snapping to the lower band satisfies that for one pair and recreates it at the
next boundary, because the cliff *is* the steps. So both components are now
interpolated positions on a single axis:

```
consideration_index ∈ [0,1]     0 = pure fast momentum · 1 = pure deal-craft
index_ticket = interpolated over ticket anchors, in log10(ticket)
index_cycle  = interpolated over cycle-day anchors, linear in days
w_C = 0.65 × index_ticket + 0.35 × index_cycle,  clamped to [0.10, 0.90]
```

Ticket interpolates in **log space** because ticket size spans orders of
magnitude — ₹10k→20k is a different kind of jump from ₹3L→3.1L, and linear
interpolation would let the top band swallow the axis. Anchors are set so each
reproduces the v1 `w_C` at the middle of its band, so v2 is a smoothing of v1
rather than a different opinion. The **0.65 / 0.35** split is expert-set like
every other weight (§9.4): ticket stays primary, cycle gets enough authority to
correct a band that misdescribes the job.

Measured after the change:

| | v1 stepped | v2 interpolated |
|---|---|---|
| `w_C` step across the ₹80k edge | **0.20** | **0.0057** |
| Reorder across that edge | F6/F7 swap | **none, all 10 candidates** |
| ₹20k: same-day → 45-day, effective CLS | +4.0 | **+9.5** (46.7 → 56.2) |
| ₹20k/same-day effective CLS vs §9.5's worked example ("47") | 46.4 | **46.7** |

Golden cases `2b`, `2c` and `3b` were **strengthened** as a result — `2b` now
asserts no reorder for *every* candidate rather than only band-invariant ones, and
`3b` requires the cycle rise to exceed 8 points rather than merely be positive.
A test that only passes because it was weakened is not a test.

**Rollback:** set `dimension_params('cls_blend_mode','interpolated')` to `0` for
exact original §9.2.1 behaviour. The v1 tables are retained; the golden cases run
against whichever mode is active, and `2b`/`2c`/`3b` will fail under v1 — which
is the honest outcome, since v1 is what they were written to catch.

### 5.3 STY target — ambiguity resolved, flagging it

§6.1 says STY target = "buyer-response 5-point answer **× 25**". On a 1–5 scale
that yields 25–125, out of range. Implemented as **(answer − 1) × 25** → 0/25/50/75/100,
with the intake storing the natural 1–5. If the intended scale was 0–4, the form
changes, not the function.

### 5.4 The comp ladder did not exist

§9.3's attrition flag needs to measure "more than two bands from the client's
structure", but no document defines the bands. Five are defined in
`comp_bands` (02), from fully-fixed to commission-only. The engine reads
`band_index`, not the labels — **replace the labels with VBOG's real ladder**.

Note a consequence: with a 5-band ladder, a client sitting at band 3 can never be
more than 2 bands from any candidate, so the flag can only ever fire for clients
at bands 1–2 or 4–5. That is arguably correct (a balanced structure suits most
people) but it is a property of the ladder, not a designed threshold.

### 5.5 Additions beyond PRD §8's table list

Each is either named-but-unspecified in the PRD, or required by the playbook:

| Addition | Why |
|---|---|
| `staff` | §8 specifies "Supabase Auth + RLS by staff role" but gives no table |
| `assessment_tokens` | §8 specifies single-use signed tokens but gives no storage |
| `client_users` | §8 specifies magic-link intake but nothing maps a user to a client |
| `requirements.ticket_size`, `.cycle_days` | §9.5's rationale must say "this req is ₹22k / same-day"; §14.1 varies exactly these |
| `interview_contradictions` | Playbook §5.4 calls contradictions the cheapest early warning of a bad item. It only helps if recorded somewhere deliberate |
| `keying_rounds`, `keying_submissions` | §13's three-expert blind re-key needs somewhere to put the submissions |
| `dimension_templates` | §9.5 requires template-generated rationale with the operational consequence spelled out |
| `comp_bands` | §5.4 above |

### 5.6 Deterministic ranking

`v_console` ranks by `composite desc, candidate_id`. Without the tiebreak, equal
composites reshuffle between refreshes and the same shortlist reads differently
each time a recruiter reloads it. Found by golden case 2b.

---

## 6. What is verified, and what is merely written

**Verified live against the database (19/19 golden cases green):**

- The frame-split canary in *both* directions — the same profile ranks **#1** on
  ₹3L/60-day (effective CLS 76.4) and **#8 of 10** on ₹20k/same-day (46.4). §9.5's
  worked example predicts "effective CLS is 47"; the engine produces 46.4.
- Scoring end to end from raw responses: all-best answers → 100 on every unipolar
  dimension, all-worst → 0.
- Hard-filter failure naming all six failing filters, with the row still present.
- Contradictory forced-ranks → low confidence. Quality cap biting at 1.15.
- The 24-month retention purge is **actually scheduled** in `cron.job`, not just
  defined as a function.
- Rename, delete, the delete refusals, the keying-round lifecycle and supplement
  drafting — 21 RPC assertions and 25 UI assertions, all green (§7l).

**Written but not yet exercised by real data:** the §14.2 instrument-health views
(need n=30 — at ~60 candidates/month, about two weeks), §14.3 group-difference
monitoring (needs volunteers), §14.5 human agreement (needs logged decisions),
and the whole §12 feedback loop, which is empty by design.

---

## 7. Human gates that no amount of code closes

Stated here because they are the difference between a working instrument and a
plausible one.

1. **§13 three-expert blind re-key.** Every key in the bank is currently one
   person's opinion. Two more experienced sales people must key all 28 SJT items
   without seeing the existing keys; `v_keying_agreement` then reports unanimous /
   disagrees-with-current-key / split. Items that split get rewritten **before**
   launch. Tooling is built; the two people are not substitutable.
2. **`placement_outcomes` must actually get filled in.** §18 names it as the most
   likely single point of failure and §12 calls it the asset. Needs a named owner
   in the account-management cadence before Phase 4.
3. **Per-client supplements and vertical technical questions** are human-authored
   (§10, playbook §3.6).
4. **Step 4 independence.** In a one-person operation it is unrecoverable.
   `interviews.predicted_ratings` preserves the divergence record instead, which
   is the part that tells you whether the instrument works.

---

## 7a. Candidate surface — what it enforces, and how it was verified

`assess.html` + `js/assess.js` + `css/assess.css`. Mobile-first, one item per
screen, autosave per item.

Rules it exists to honour, each of which would be invisible if broken:

| Rule | How |
|---|---|
| No back-navigation **between** blocks | `S.blockFloor` is set to the first index of each block on entry; Back is disabled at or below it. Verified barred at all 9 block starts. Matters because the CLS key **inverts** between blocks D and D2 — a candidate who sees the fast-close framing must not be able to revise their considered-purchase answers in light of it |
| Never name a dimension | Block titles describe the sales situation ("Judgement calls", not "Sales Integrity"). §11.4 — the vocabulary leaks into the pool and contaminates every future assessment |
| Never frame it as an honesty test | No block is labelled as such anywhere in the UI |
| Framing notes on D and D2 | Shown on the block interstitial *and* repeated on each item, so a candidate returning after a break does not lose the setup |
| Option order randomised | Server-side, seeded per session. `position_shown` records the **displayed** position, which is what the `straightline` flag needs — `option_key` would miss someone always clicking the second option |
| Resume | The first unanswered item, from the server's own record of answers |
| No score reaches the browser | `finish_assessment()` returns `{complete: true}`. There is nothing to leak |

**Verified in a real browser** (Chromium, 390×844) end to end: consent gate blocks
until ticked, all 44 items walked, every answer autosaved, submitted, and the
database received 44 responses each with `seconds_on_item` and `position_shown`,
the recorded `consent_version`, nine computed scores with no blended CLS, and the
`fast_completion` and `straightline` flags correctly raised on a bot-speed run.

Note for anyone re-running that harness: Chromium in the dev container does not
use the egress proxy, so its direct connection to Supabase hangs. The harness
routes `**/rest/v1/**` through Node, which does respect `HTTPS_PROXY` and the CA
bundle. Do not "fix" this by disabling TLS verification.

## 7b0. One family, two registers

The repo holds design languages for three surfaces and this tool uses all three,
split by who is looking:

| Sheet | Used by | Register |
|---|---|---|
| `css/nikash.css` | console, keying, verification call | **the workshop** — ink `#141416`, V-BOG orange `#FF4D00`, 3px radius, hairlines, no shadows, mono readouts |
| `css/brand.css` | client role brief, candidate supplement | **v-bog.com's** — warm off-white, orange, zero radius, zero shadows, Satoshi at display size |
| `css/assess.css` | candidate assessment | v-bog.com's, mobile-first |

All three now sit in one family — V-BOG's ink and V-BOG's orange, on V-BOG's warm
paper — and differ in register rather than in palette. The outward-facing sheets are
spacious and loud, because they are the firm introducing itself. The console is
dense, square-cornered and set in mono wherever a number appears, because it is the
same firm at work. See §7m for why this replaced a straight copy of Vyom's navy.

Bright `#FF4D00` measures **3.04:1** on paper: enough for a non-text mark or
display-size type, not enough for body copy. So the bright orange is confined to
streaks, fills, bars and the wordmark's period, and anything carrying words uses
`#C43C00` at 4.84:1. Checked by measurement in both colour schemes, not by eye.

The four form-follows-function rules were unchanged by the repaint, because they
govern hierarchy and behaviour rather than colour. They are asserted in QA against
the new palette: rank and score carry no saturated colour at all (the audit fails
the run if they do), concerns still render beside reasons, there is still no reject
control.

## 7b. Visual system — candidate surface

**Visual authority is `index.html` on v-bog.com, not Vyom.** The repo holds two
palettes: the marketing brand (warm off-white, orange) and Vyom's internal blue.
This surface is seen by **external candidates**, so it wears the brand.

The brand system, taken verbatim:

| | |
|---|---|
| Radius | **0** — the site has exactly one `border-radius` and it is a 50% dot. Square is the language, not a rounding default |
| Shadows | **none, anywhere on the site.** Depth is 1px lines and offset |
| Hover | `translate(-2px, -2px)` — the brand's one physical gesture |
| Type | Satoshi 900 display · Inter body · DM Mono 11px small labels |
| Colour | `--off #f7f5f2` canvas · `--ink #0a0a0a` · `--accent #ff4d00` · `--line #e0dcd6` |

**One deliberate departure.** The site's primary button is white on `#ff4d00`,
which measures **3.33:1** — below AA for text at that size. Text-bearing fills
here use `#cc3d00` (**4.96:1** with white); bright `#ff4d00` is kept for non-text
elements (progress rule, selection marker) where the 3:1 UI-component threshold
applies and 3.09:1 clears it. Same palette, legible.

Decisions worth keeping:

- **Brand at the door, instrument inside.** The lockup appears on the consent,
  error and completion screens. During the 44 items the header carries only two
  measurements (question count, elapsed) in DM Mono — mono for measurement, not
  as a technical costume.
- **The input *is* the marker.** `appearance: none` on the real radio, styled as
  a 20px square, filled via `background-clip: content-box` rather than `::after`
  (pseudo-elements on replaced elements are not guaranteed). No visually-hidden
  input: native keyboard behaviour, a real hit target, one element to reason
  about. An earlier hidden-input version broke automated interaction, which is a
  fair proxy for breaking assistive interaction.
- **Marker fill is `--off`, not `--white`** — the option card is already white,
  so a white marker was invisible. Caught by screenshot, not by code review.
- **Progress uses `scaleX`, not `width`** — animating width relayouts the sticky
  header on every answer.
- **The clock starts when the test does**, not while the consent notice is being
  read. The top bar is hidden until the first item.
- **Dark scheme derived from the brand's own darks** (`#141414` / `#1e1e1e`), not
  generic greys, because candidates take this on a phone in the evening. On dark,
  the legible pairing inverts: ink on bright orange is 7.4:1 where white would
  be 3.2:1.
- One authored motion moment: a 0.34s rise per screen, from an already-visible
  default, disabled under `prefers-reduced-motion`.

Known accepted warning: the design detector flags Inter as an overused face. It
is VBOG's actual brand body font; incumbent brand truth outranks a genericness
warning.

## 7c. Console and intake — how form follows function

Four rules shape every view, and each is a consequence of something the PRD
insists on rather than a style preference. They live at the top of `nikash.css`.

1. **A number never appears without its reason.** The composite is unvalidated
   (§4 rules out predictive-validity claims), so `.figure` is 26px, not 56px, and
   the sentence explaining a score is never smaller than the score. A hero metric
   would be a confidence this instrument has not earned.
2. **Concerns are not decoration.** Reasons and concerns render in the same
   column at the same weight, always visible, never behind a disclosure. A
   shortlist that shows only strengths is a sales document.
3. **Exclusion is visible and reversible.** No reject control exists, because
   `matches` has no column to hold one. A hard-filter failure renders dimmed and
   still names every failing filter — overriding a two-week notice gap is the
   designed behaviour (§2).
4. **Rank is typography, not colour.** No red-amber-green anywhere. A traffic
   light on an unvalidated score reads as a verdict. Position carries rank.

### Intake design

Six steps, autosaved, phrased entirely in the client's own terms — ticket size,
cycle length, how their buyer responds. **The mapping onto dimensions happens in
Postgres, never in the browser**: a client should never have to think in the
instrument's vocabulary, and §6.1 is explicit that free text must not be the
primary input, so the prose box is last and optional.

The client ranks a **single** closing ability; the candidate is measured on two.
That asymmetry is resolved in the engine and never surfaces on the form.

**Gender Preference is absent by design** (§6.6). Forced-rank enforces exactly
three, and a dimension ranked top is disabled in the bottom list.

### Intake auth — a deviation from §8

§8 specifies a magic link. That needs SMTP this project does not have and would
make every client contact an auth user. Intake uses a staff-issued signed token
instead — resumable, revocable, no account, and the client never touches a table.
`client_users` remains for a future magic-link path.

### Staff auth

Supabase Auth, email + password, autoconfirm on (no SMTP). **Signing up grants
nothing**: every policy keys off a `staff` row that only an admin inserts, and
`link_staff_account()` binds an auth user to a pre-created staff record by email.
Tokens live in `sessionStorage`, not `localStorage` — a shared recruiter laptop
should not stay signed into the one surface that renders scores.

## 7d. The last four gaps, and how each is enforced

| Gap | Where | Enforcement worth knowing |
|---|---|---|
| §10 client supplement | `supplement.html` + Supplements view | Fan-out **capped at two** in `issue_supplement_token()` — a third is refused with the reason, rather than trusted to a recruiter counting in their head. `v_supplement_overlap` flags when three clients ask the same thing, which is the §17 tripwire for a missing dimension. |
| §12 placements and outcomes | Placements view | `record_placement()` freezes `match_id` and `interview_id`, so the outcome can always be compared to what was predicted. `record_outcome()` copies the **three predictors separately** from that frozen prediction. `v_outcomes_due` lists overdue checkpoints — the only real mitigation for §18's named point of failure. |
| Criterion validity | `mark_benchmark()` | Tags a benchmark taker with their real performance tier, feeding `v_criterion_validity`. Concurrent, not predictive, and labelled as such — but answerable in a fortnight rather than two years. |
| §14.3 monitoring | End of `assess.html` | Asked **after** submission, so answering cannot affect anything, and written through the candidate's own token so no staff member links a face to a row. Table stays RLS-isolated to admin/psych; recruiters cannot read it at all. |

## 7e. A branch-recovery incident worth recording

The PR containing the keying and interview surfaces was merged at an earlier
commit than the branch head, and restarting the branch from `main` with
`checkout -B` **discarded that unmerged commit**. It was recovered with
`cherry-pick`, but two edits made against the wrong base had already silently
no-oped, because their anchor text only existed in the dropped commit.

The lesson is in the tooling, not the git: **a string-replace edit that finds no
match must fail loudly.** Every scripted edit in this repo now asserts its
anchor exists before writing. A silent no-op looks exactly like success.

## 7f. Two bugs that only a real user found

Both shipped through four rounds of green QA. Worth recording because the reason
they survived is the same reason in each case.

### The console died after an hour

Supabase access tokens live for **one hour**. `sbSignIn` stored the access token
and threw the refresh token away, so the console worked until the token aged out
and then failed every action with a raw `JWT expired`. Fixed: both tokens are
held, a 401 triggers exactly one silent refresh-and-retry through a shared
promise so parallel requests cannot each refresh, and an unrecoverable session
returns to sign-in with a sentence rather than jargon.

Every automated run signed in and finished inside a minute, so no test ever
reached the second hour. Now tested by corrupting the stored access token, which
produces the identical 401.

### Every token the console minted was broken

Supabase installs pgcrypto into the `extensions` schema. All SECURITY DEFINER
functions here pin `search_path = public` — correct hardening, since an unpinned
path on a definer function is a privilege-escalation vector — but that made
`gen_random_bytes()` invisible to them. `issue_assessment_token`,
`create_client_intake_link` and `issue_supplement_token` all failed with
`function gen_random_bytes(integer) does not exist`. That is **every link the
console hands out.** Fixed in `sql/14` by appending `extensions` to those three
search paths, with an assertion that fails the migration if any pgcrypto-using
definer function lacks it.

It survived because **every test seeded its own tokens with direct SQL through
the Management API**, which runs as a superuser whose search_path already
includes `extensions`. The staff RPC — the thing a recruiter actually clicks —
was never called. A test that sets up its fixtures through a different door than
the user walks through is not testing the door.

**The standing rule this produces:** a test may read through any door, but it
must *create* through the same one the user does. QA now clicks "Create intake
link" and "Create test link" rather than inserting tokens.

## 7g. The dark-mode bug that light mode could not show

The client intake's forced-rank titles rendered **dark on a dark card** — unreadable
— while the description underneath was fine. The split is the clue: `.p` sets its
own colour, the title did not.

Neither `.rank-item` nor the base `button` declared a `color`, so both inherited
the UA's `buttontext`, which stays dark in the dark scheme. In light mode dark text
on a white card looks correct, so the omission was invisible in every screenshot
taken until a user opened it on a dark-mode machine.

**Rule:** every interactive element states its own colour. Inheriting is fine for
`<div>` and `<p>`, which take `body`'s colour; it is never fine for `<button>`,
`<input>`, `<select>` or `<textarea>`, which have UA defaults that ignore the
scheme.

**The systematic guard** is a dark-mode contrast audit in QA that walks up for each
element's real backdrop, computes the WCAG ratio, and applies the right floor
(4.5:1, or 3:1 for large text). It covers both stylesheets and fails the run on any
element below its floor. A visual check cannot catch this reliably; a measurement
can. Worst ratio was dark-on-dark before the fix, 14.92:1 after.

## 7h. Forced-rank: rebuilt on every tap, so taps went missing

Selecting three qualities in quick succession dropped one. `renderRanks` replaced
both grids' `innerHTML` on every click, so a tap landing mid-rerender hit a
detached node and vanished — trivially reproducible on a phone, and it showed up as
"the selection looks broken".

The grid is now built once and updated in place: `aria-pressed`, the order badge and
the disabled state are set on existing nodes. Nothing is recreated, so a click can
never miss its target. Cheaper per tap as well.

QA now fires three taps with no waits between them and asserts all three register
**in order**, which is the condition the old implementation failed.

## 7i. The forced-rank rules were correct and invisible

Reported as "the selection looked broken", and the greying "random". It was
neither — it was three true rules, none of which the page stated:

| Rule | Was it visible? |
|---|---|
| "Matter most" takes **exactly 3** | No counter, no cap shown |
| "Matter least" takes **up to 2**, optional | Buried in help text |
| A quality can sit in **one list or the other**, never both | Rows simply greyed, with no reason |

So a client who picked three could see rows greying in the *other* list and
reasonably conclude the cap was shared across both sections — and tapping a fourth
in a full list did **nothing at all**, which is indistinguishable from a fault.

Fixed by making each rule state itself:

- A live tally per list: "3 of 3 chosen", "0 of 2 chosen".
- Every disabled row says **which** of the two reasons applies — "Already chosen as
  one of the three that matter most", or "Three already chosen — remove one to pick
  this instead". A disabled control with no stated reason is indistinguishable from
  a broken one.
- The lede now says there are two separate lists and that a quality goes in one or
  the other.

**One copy correction while in here.** The help text said "Pick exactly three, in
order", implying tap order carried weight. It does not — §6.3 gives every top-3
dimension the same +15 and the same 3.0 weight. Promising precision the scoring
does not have is worse than saying nothing, so it now reads "the numbers only show
what you picked — all three count equally".

**What the QA gap was.** The mechanics were tested from the first build: three taps
register in order, and a top-ranked dimension is blocked in the bottom list. Both
passed. What was never asserted is that a *person* could tell why a row was
unavailable. Behaviour was covered; legibility was not. There are now assertions
that each list reports how full it is, that a cap-blocked row explains the cap,
that a cross-list-blocked row explains the other list, and that five of the six
qualities can be placed across the two lists — the thing that was actually in doubt.

## 7j. Rename and delete — and the one thing delete must refuse

Every list that can create a record can now rename and remove one: requirements,
candidates, clients, supplements, keying rounds. Two rules shape all of them.

**A destructive action names what it destroys, before doing it.** Not "are you
sure" — the actual consequence: which records go, and which explicitly do not.
Deleting a client removes their roles and matches but *not* candidate assessments,
and the confirmation says so.

**The server decides what may be destroyed, not the browser.** `assert_no_placements()`
refuses any delete that would cascade into a placement, because outcome data cannot
be recreated — a candidate can retake a test and a client can refill an intake, but
nobody can go back and re-observe whether a hire lasted three months. §12 calls that
table the asset; this is what stops a stray click from spending it. Two further
refusals in the same spirit: a requirement with completed verification calls (an
hour of judgement per call), and a supplement with candidate answers.

`delete_candidate()` is also the **C3 withdrawal-and-deletion path**, so it has to
exist regardless of convenience. It cascades by construction, since every child
table declares `ON DELETE CASCADE`.

Keying rounds additionally get open/close, because closing is the normal end of a
round — the three experts finish, you stop further keying, and every submission is
retained for the agreement report. A keyer can also clear their own answer on one
item without disturbing the round.

## 7k. The supplement was never auto-generated — and now it drafts itself

§10 specifies the supplement as *"written by the psych function at client
onboarding"*, so human-authored was always the design. But "I don't know what to
ask" is a fair objection, and the answer is the mechanism §9.5 already uses for the
match rationale: **templates selected deterministically, not text generated.**

`supplement_templates` holds a library, each row carrying a condition. `suggest_supplement()`
reads the client's own submitted intake and returns the matching draft:

| Condition | Fires when | Adds |
|---|---|---|
| `always` | every client | offer comprehension, motivation, expected objection |
| `ticket_high` | ticket ≥ ₹1.5L | status-gap composure, multi-stakeholder — the §17 gaps |
| `ticket_low` | ticket < ₹50k | volume discipline |
| `cycle_short` | cycle ≤ 7 days | a rehearsed deferral answer at speed |
| `no_crm` | client has no CRM | what they would build in two weeks |
| `cold_heavy` | cold outbound > 50% | cold-open craft, which the 44 items never reach |
| `refund_policy` | a written policy exists | what they tell a prospect who asks |
| `senior_buyer` | owner or senior professional | naming a deferral rather than accepting it |
| `vertical` | always | two placeholders that **must** be rewritten per client |

Same intake, same draft, every time — auditable, no model dependency. It writes
into the textarea and saves nothing; the recruiter edits and saves. The panel shows
which intake facts drove each choice, and warns if the draft exceeds §10's cap of
5–8 behavioural plus 3–5 technical.

The two `vertical` rows are deliberately generic and labelled as needing
replacement. A vertical question that could apply to any industry tests nothing,
and §3.6 expects these to be written per client at onboarding.

## 7l. The bug in the suggester, and what found it

`sql/16` shipped with the rename/delete/suggest surface unverified at runtime — the
migration asserted its own state on the way in, and I said so in the commit rather
than claiming otherwise. Running it as a signed-in recruiter found a real fault on
the first call:

```
HTTP 400  22P02  malformed array literal: "ticket_high"
```

`v_conds text[] := array['always']` followed by `v_conds := v_conds || 'ticket_high'`
looks like appending a string to an array. It is not. The literal is `unknown`, and
Postgres resolves `text[] || unknown` toward the **array-array** operator, so it
tries to parse `ticket_high` as an array literal and fails. Every condition after
`always` was dead, which means every client would have received the same seven
generic questions and nothing else — the exact failure the feature exists to avoid,
and one that would have looked like working software. Fixed by casting each appended
literal to `::text`, which selects the element-append operator.

Two things about how it was caught matter more than the fix:

**The Management API could not have found it.** `suggest_supplement()` correctly
refuses when `auth.uid()` is null, so running it as superuser returns
`suggest_supplement: staff only` — a pass-looking result from a door no user walks
through. This is the same lesson as the pgcrypto failure in §7f: **a test may read
through any door, but it must create through the one the user does.**

**A failing check must print the body, not the status.** The first run reported
`HTTP 400` and nothing else, which named a symptom common to a dozen causes and sent
me guessing at schema caches. Printing the response body identified it in one line.
Every check in the QA scripts now carries the body on failure.

### Verified live, 25 UI assertions plus 21 RPC assertions

Both suites pass in full. The UI pass clicks rather than calls: Suggest → draft in
the textarea → Save → reload → draft unchanged; rename a client, a candidate and a
round; cancel a confirm and observe nothing deleted; blank rename dropped before it
reaches the server; and the guard that matters — deleting a **placed** candidate
shows `Cannot delete: 1 placement(s) reference this…` verbatim beside the row,
styled as an error, with the row still present. 19/19 golden cases still green and
`v_c10_audit` still empty afterwards.

## 7m. The repaint — why Vyom's palette was the wrong thing to copy

The instruction two rounds earlier was "make it closer to Vyom", and what shipped
was a faithful copy: navy `#0F3460`, cyan `#00B4D8`, 10px radius, soft navy
shadows, Vyom's cosmic gradient hairline. Technically correct, and it had no
character. The verdict when it came back was exact — *"the dark blue background
isn't great… it is missing some real character… you got the UI for Vyom bang on in
one go."*

**The diagnosis matters more than the fix.** Vyom has character because its look is
derived from its **name**: व्योम is sky, so the mark is a world with an orbit, the
accent is the cyan of a planet's limb, and the nav carries a cyan→violet hairline
like a spectrum. None of that is transferable. Copying the palette imported the
*output* of that reasoning while leaving the reasoning behind — which is why the
result read as a navy admin panel rather than as a tool with a point of view.

So Nikash now derives its look the same way Vyom did, from निकष:

> A touchstone is a black stone. You rub gold on it and read the streak.

- **Ink and one orange streak.** No second accent, no gradient, no shadow. The
  ground is V-BOG's warm paper `#F6F4F1`, not a cold grey.
- **The streak is the interaction language, not decoration.** It marks *where you
  are*: on the masthead's bottom edge under the wordmark, under the active nav
  item, down the leading edge of the row under the cursor, inside a focused field,
  under the primary button, on the current step. It never marks quality — rule 4
  still holds, and QA fails the run if a rank or a score carries any saturated
  colour at all.
- **Numbers are readings.** `.figure` is DM Mono with tabular figures, and every
  meta label and chip is mono uppercase. A number set in a monospace looks
  measured; the same number in a heavy sans looks awarded. That is rule 1 done
  with type instead of with size.
- **Satoshi 900 for headings**, which is what gives a heading a voice rather than
  a weight.
- **3px radius and hairline borders.** Depth previously came from shadows, which
  is why every surface sat the same distance away and the page read as cards
  adrift. A rule now runs from each region heading to the right margin, and the
  page has a spine.

**What is genuinely shared with Vyom is the grammar, not the palette:** sticky
masthead, wordmark plus a coloured dot, mono descriptor beside it, nav on the
right, region head then rule then rows. A recruiter moving between the two tools
recognises the layout instantly. That is what makes a toolset feel related;
matching hex codes never was.

### The logo — `img/nikash.svg`

Vyom has a mark, so Nikash without one looked unfinished. The mark is the stone
and the streak the gold leaves on it. Three decisions did the work, and the first
two drafts are worth recording because they failed for instructive reasons:

- **Draft 1** — a rounded-square stone with a bold diagonal and a fainter one
  behind it. Read as an app icon with `//` on it. A rounded square is UI chrome,
  not an object, and two constant-width parallels are a code comment.
- **Draft 2** — three unequal bars, meant as "several samples compared on one
  stone". Read as a hamburger menu on a circle.
- **Shipped** — an irregular silhouette with a flatter base, so it reads as
  something resting on a surface; **one streak that tapers**, drawn as a filled
  path wide where the metal bites and narrow where it lifts, because a
  constant-width diagonal reads as a slash *through* the stone rather than a mark
  *on* it; and the narrow end **crosses the edge and continues**, because the
  reading does not stay on the instrument. Verified legible at 16px, and carrying
  a rim in dark mode via a `prefers-color-scheme` block inside the SVG, since an
  ink stone on a dark ground otherwise loses its edge.

### Two fixes that came with the repaint

- **The nav had no active state at all.** The console could not tell you which
  screen you were on. `view()` now sets `aria-current="page"`, which is both the
  screen-reader announcement and the hook the streak hangs off. A shortlist marks
  *Requirements*, because that is where Back goes.
- **`.row` was a `1fr 1fr` grid.** Every use of it on these pages is an input plus
  a button, so "Create intake link" was stretched to half the panel. It is a flex
  row now: the field takes the space, the button takes what it needs.

### Verified — 37 assertions, both colour schemes

Every view in both light and dark, with contrast **measured**: for each
text-bearing element the audit climbs the tree to the real backdrop, computes the
WCAG ratio and applies the correct floor for the computed size, failing the run on
anything below. 1,384 elements audited per scheme across eight screens, zero
failures — including the inverted stone card on the sign-in screen, which is
exactly where a contrast bug would hide. Plus: the streak's geometry checked
against the masthead's own bottom edge rather than a hard-coded offset (the first
attempt computed `(62 − 28) / 2` by hand and hung the streak 30px into the page);
the active marker proven to *move* rather than be hard-coded; no horizontal scroll
at 380px; and create/rename/delete re-run through the buttons, since `view()`
changed.

## 7n. Every view was bypassing RLS. Found while adding keying links.

The most serious defect in the project so far, present since the first view was
created, and invisible to every check that existed.

### What was wrong

A Postgres view runs with the privileges of its **owner** unless created with
`security_invoker = true`. Every view here was owned by `postgres` and none set
it, so reading a view executed as `postgres` and the row policies on the
underlying tables **were never consulted**. Separately, Supabase's default
privileges grant `anon` and `authenticated` everything on new objects in
`public`, and a view is a new object in `public`.

Verified against the live project with nothing but the publishable key — the one
that ships in `js/config.js`, sits in this repo, and is in every visitor's
browser:

| Request | Result |
|---|---|
| `GET /rest/v1/v_candidate_queue` | **200** — candidate names, flags, eligibility counts |
| `GET /rest/v1/v_requirements` | **200** — client names, ticket sizes, target profiles, best match % |
| `GET /rest/v1/v_keying_links` | **200** — **live keying tokens** |
| `GET /rest/v1/v_console_clean` | **200** — empty only because no matches exist yet; it projects dimension scores and match percentages |

That is R1 and C10 broken. Scores did leave the building, and a keying token was
readable by anyone, which would have let a stranger key items as an invited
expert and quietly corrupt the only pre-launch validation the instrument has.

### Why nothing caught it

**`v_c10_audit` audits policies.** It looks for a policy admitting a non-staff
principal, and there is none — which is why every previous check passed. The hole
was not a policy. It was a mechanism that never consulted policies at all. *An
audit only ever covers the mechanism you thought of.*

**Every browser test signed in first.** A signed-in staff user gets the same rows
through either mechanism, so no test could tell them apart. The candidate surface
*was* tested as `anon`, but only against the three RPCs it actually calls — never
against a view it had no reason to call.

The §7f lesson — *a test may read through any door, but it must create through
the one the user does* — had the right shape and too narrow a scope. The full
version:

> **You have to try the doors the user never uses.** An attacker is not
> constrained to your call graph.

### The fix — `sql/18`

1. `security_invoker = true` on every view in `public`, applied in a loop so none
   can be missed, including ones added later.
2. `anon` loses every privilege on every table and view in `public`. It needs
   none: the candidate, client, keyer and supplement surfaces reach the database
   exclusively through `SECURITY DEFINER` functions (§4).
3. Default privileges changed, so a view created tomorrow is not granted to
   `anon` the moment it exists.
4. **`v_rls_bypass_audit`**, which must always be empty — beside `v_c10_audit`,
   asking the question the other one does not: *can anything reach these rows
   without a policy being consulted?*

A consequence worth stating plainly: `v_group_differences` and `v_group_gaps`
read `monitoring_attributes`, which §14.3 restricts to admin and psych. Until now
a **recruiter could read group data through those views**. Now they cannot. That
is not a regression — it is the isolation §14.3 asked for, finally holding.

## 7o. Two more, each exposed by the previous fix

Closing one hole made the next one visible. Worth recording as a pattern: a
system with a bypass in it hides the bugs downstream of the bypass.

### The console had no authorisation check at all — `sql/19`

`afterSignIn()` decided you were staff by running `loadRequirements()` and seeing
whether it threw. Before `sql/18` that inference was wrong in the dangerous
direction: the view bypassed RLS, so a stranger who signed up saw **real
requirements**. After `sql/18` it was wrong in the merely embarrassing direction:
RLS returns zero rows, zero rows is not an exception, so a stranger landed inside
an empty console with the whole navigation bar available.

Both are the same mistake. **An empty result is not a denial.** Postgres RLS is
deliberately silent — it filters rows rather than raising — so any client that
treats "no error" as "permitted" has no authorisation check whatsoever.

Permission is now a positive answer from the database: `whoami()` returns
`{staff, role, name, reason}`, `SECURITY DEFINER` so a non-staff caller can still
be told no, and nothing loads without `staff === true`. The restored-token path on
boot goes through the same check, because reloading the page is not a second way
in. An invited keyer who signs up with their invited email is told, in words, to
use their keying link instead.

### Resume had never worked on the candidate assessment

`start_assessment()` returns the answer map as `answered`. `js/assess.js` read
`data.answers`. One wrong property name silently disabled every piece of resume
in the file at once: the index landed on item 1, no option was pre-selected, the
progress bar started at zero, and the review screen counted nothing. Everything
downstream of that line was already correct.

So a candidate who closed the tab at question 30 came back to question 1 with a
blank sheet and re-answered all 44 items — while the README promised the link
"resumes exactly where they stopped". `save_response()` upserts, so no data was
corrupted; the cost was paid entirely by the candidate.

Two things made it invisible: `|| {}` turned the undefined into a plausible empty
state instead of an error, and every test had checked that the page *loaded*
rather than what it loaded *with*. The check now asserts the resumed position and
the progress bar, not the absence of a crash.

While there: a returning candidate was also shown the whole §15.1 consent notice
again and made to re-tick the box. `start_assessment()` already refuses without
consent and with a distinct message, so the page now tries it first and falls
back to the notice only when consent is what is actually missing.

## 7p. Keying by link — `sql/17`

§13 wants three experts keying all 28 SJT items blind, and the most independent
keyers are the ones who do not work here. Until now keying required a Supabase
account plus a `staff` row, which means handing an outsider a login to the tool
that renders every score in the system — a bad trade for half a day of work. So
keying now follows the pattern the other three external surfaces already use:

```
keying.html?t=<token>     no account, no table access, nothing reachable but the items
```

Four things this could have broken, and how each is held:

| | How |
|---|---|
| **Blindness** | `get_keying_by_token()` does not select `score_key`, exactly as `get_keying_items()` does not. `sql/17` asserts it on every deploy — with SQL comments stripped first, because both functions carry a comment *saying* the key is absent and the first version of the assertion matched its own documentation. |
| **Nothing else reachable** | Three `SECURITY DEFINER` RPCs, granted to `anon`; no table grant. QA probes 41 views and tables with the publishable key and all 41 refuse. |
| **A link is not an account** | Each keyer gets a `staff` row so keys can be attributed and `v_keying_agreement` works unchanged — with `auth_uid = null`, `active = false`, `role = 'keyer'`. `is_staff()` requires `auth_uid = auth.uid() AND active`, so the row grants exactly nothing. If that email signs up for real it links and is still inactive. |
| **One link, one keyer** | `keying_submissions` is keyed on (round, expert, item), so two people sharing a link would silently overwrite each other. The link is minted per named keyer and the page shows **whose it is**, in the open, before they answer anything. |

The console lists every link with progress (`keyed / total`) and a state — not
opened, in progress, finished, expired, withdrawn — because §13 stalls when one of
the three never finishes and that is invisible unless it is on screen. Withdrawing
a link stops it immediately and keeps everything already keyed.

### Verified — 39 assertions, two browser contexts

The admin issues the link in one context; a **separate** anonymous context with no
session opens it. Sharing one context would have let a leftover token do the work
and proved nothing. Covered end to end: the link opens with no sign-in, names its
keyer, offers all 28 items, saves an answer, resumes on the first *unkeyed* item
after a reload, clears an answer, shows progress back to the admin, feeds the
agreement report, refuses a withdrawn link and a made-up token with sentences a
person can act on, and never — in 16.5KB of payload — mentions `score_key`.

## 7q. A finished assessment was never matched against anything

Found by the owner asking a plain question — *"where do I see candidate results,
the ones who have submitted?"* — with one candidate on the live project who had
answered 44 of 44 and appeared nowhere.

### The bug

Matching ran in exactly one direction. `submit_intake()` calls `compute_matches()`
when a **client** submits their brief, matching the new requirement against every
candidate assessed so far. Nothing did the mirror image: `finish_assessment()`
computed the candidate's profile and stopped.

So a candidate who finished the test **after** a role was opened produced no
`matches` row at all. The queue said "assessed · 0 eligible requirements", the
shortlist for the open role was empty, and there was nowhere in the console to
see that their submission had landed. Whether the work was visible depended on
the order of two events, which is not a property any pipeline should have. §9
does not say "match on intake" — it says one assessment is matched against every
open requirement, and that is a claim about both directions.

### Why the tests missed it

Every prior QA run created the candidate **and** the requirement inside the same
script, and the golden cases call `compute_matches()` explicitly because they
exist to exercise the arithmetic. So the fixtures always ran intake-last or
invoked the engine by hand. Nobody ever ran the real sequence: *open a role
today, have somebody finish the test tomorrow.*

Which is the same failure mode as §7f and §7n, in its third costume:

> A test that constructs its own world in one order never discovers that the
> product depends on that order.

### The fix — `sql/20`

`finish_assessment()` now matches against every open, non-fixture requirement
that has a target profile. Same `compute_matches()`, same arithmetic, same golden
cases; the only change is that it is called from both ends of the pipeline. Each
requirement is attempted separately and a failure is logged as a warning rather
than raised — the assessment is already saved and scored, and a requirement that
cannot be matched right now must not cost the candidate their submission. The
return value reports `matched_requirements` and `failed_requirements`, so
"matched against nothing because nothing is open" is distinguishable from
"matching broke".

**`v_unmatched_audit`** is the assertion that would have caught it: any candidate
with a computed profile who is missing from an open requirement. It must always
be empty — there is no legitimate state where an assessed candidate is absent
from an open role's shortlist, because exclusion is recorded **as** a match row
with `hard_filter_pass = false` (R3), never as a missing one.

### Two things fixed alongside it

**Fixture requirements were being matched too.** The golden-case roles are
`status = 'open'`, so the first version of the fix gave every real candidate
seven match rows against ZZ_FIXTURE roles. The console cannot display them
(`v_requirements` filters fixture clients) but `eligible_reqs` counted them
happily. Excluded on the same rule used everywhere else.

**`eligible_reqs` counted history, not the present.** It counted every passing
match a candidate had ever had, including roles since closed. "3 eligible
requirements" pointing at two closed roles is worse than no number. It now counts
open, non-fixture roles only, and the view also returns `open_reqs` so the queue
can distinguish four states that used to render as the same "0 eligible":

| State | What the queue says now |
|---|---|
| Not finished | *waiting on them to finish* |
| Assessed, nothing open | *assessed · no open roles to match against yet* |
| Assessed, eligible somewhere | *1 of 2 open roles — see the shortlist* |
| Assessed, passes no filter | *assessed · passes no filter on the open role, still listed with the reason* |

The last line matters most. A recruiter reading "0 eligible" would reasonably
conclude the candidate is not on the shortlist. Under R3 they are — set aside,
with every failing filter named, and advanceable. The copy now says so.

## 7r. The per-candidate view, built so it cannot become a verdict

Asked for directly. Worth recording *how* it was built, because a page of nine
numbers with nothing to read them against is precisely the artefact this system
was designed not to produce — and the easiest one to produce by accident.

**A score is never shown alone.** Every dimension carries the required level from
every open role, the gap in points, and whether it meets. The QA asserts this
structurally, not by reading copy: it walks each rendered dimension and fails if
any of them has no target line. With no open role the page says so in a callout —
*"nine numbers on their own are not an assessment; 72 on Resilience is strong for
one desk and short for another"* — rather than quietly rendering the table.

**Bipolar dimensions get a dot, not a bar.** §6.3 says neither pole of MOT or STY
is better. A bar filling toward 100 claims otherwise, whatever the caption says,
so `.meter-bipolar` hides the fill entirely and shows a position marker between
the two pole labels. The line reads "sits best near 17 · this candidate is 3
away", never "20 out of 100". QA asserts the fill is `display: none` and the dot
and pole labels are present, because this one is a visual claim and copy cannot
carry it.

**The bar's tick is the target, and the target is the only orange on the page.**
The streak marks position, never quality (rule 4) — here it marks *what the role
requires*, which is a fact about the client, not a judgement about the person.

**CLS is shown twice and blended never.** `CLS_C` and `CLS_F` each appear with the
role's weight and the effective value the engine used — "this role weights it 28%
of closing, effective 55.7". There is no single closing score to show, because
storing one would make a candidate's score depend on which client they met first
(§7.2), and the page would rather show the mechanism than invent a number.

**Flags carry their own caveat.** `fast_completion` on its own reads as an
accusation; with *"could be a fast reader, could be clicking through — the
role-play in Step 4 settles it"* it reads as something to ask about. The section
ends with the sentence that matters: none of them changes a score, and none of
them excludes anybody.

The whole payload comes from one `SECURITY DEFINER` RPC with an `is_staff()`
guard — the most score-dense object in the system, and the one where R1 is least
forgiving. Ranks are read from `v_console_clean` rather than recomputed, so there
is one implementation of the ordering rather than two waiting to disagree.

### Step 4 had never been driven in a browser

Noticed while building this, and worth stating plainly: `interview.html` was
written, applied and never once opened by a test. The reveal gate is a CHECK
constraint (`scores_revealed_at >= ratings_submitted_at`), so a page that let you
reach the scores before rating would not silently misbehave — it would fail at the
database, mid-call, with a recruiter and a candidate on the line. It is now
covered: the page loads for a real candidate-and-role pair, renders the
predict-first screen, and QA asserts no score is on screen before ratings are
submitted.

### Also fixed

Dates rendered through the browser's default locale — `8/1/2026`, ambiguous
everywhere and back to front for the people reading it. Money was already
formatted `en-IN`; dates now match and spell the month.

## 8. Next

Phase 1 remainder and Phase 2, in order:

1. Client intake form with the §6.1 forced-rank controls, writing `client_intake`
2. Candidate test surface — mobile-first, one item per screen, autosave per item,
   no back-navigation between blocks, over `sbRpc()`
3. Keying surface for §13, blind by construction
4. Internal console over `v_console`
5. Step 4 interview surface with the predicted-ratings gate

Before any of it: the consent notice needs its four fill-ins (firm name,
deletion email, named grievance officer, grievance email) — §15.1, and Phase 0
is not honestly complete without them.
