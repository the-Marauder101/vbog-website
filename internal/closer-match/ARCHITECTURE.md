# Closer–Match — Architecture & Developer Handbook

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
