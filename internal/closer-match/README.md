# Nikash — closer-to-client matching

**निकष · touchstone** — the stone you rub gold against to read its purity.
It tells you what the metal is. It does not decide whether to buy.

VBOG's second internal tool, after Vyom.

| Surface | File | Who |
|---|---|---|
| Console — ranked shortlists, rationale, instrument health | **`nikash.html`** (`index.html` redirects here) | staff, behind auth |
| Client role brief | `intake.html?t=<token>` | the client, no account |
| Candidate assessment | `assess.html?t=<token>` | the candidate, no account |
| Client supplement | `supplement.html?t=<token>` | the candidate, no account |
| Blind item keying | `keying.html` · `keying.html?t=<token>` | staff, **or an invited expert with no account** |
| What the scores mean | `nikash.html` → Dictionary | staff |
| Verification call | `interview.html?req=&cand=` | staff, Step 4 |

`assess.html` deliberately keeps the V-BOG lockup rather than the Nikash name:
candidates are being assessed by the firm, not by a tool, and the internal name
is not theirs to carry.

Assess a sales closer **once** against eight constructs; match that one profile
against **every** open client requirement, with the reasoning shown.

> 🧭 **Building or changing anything? Read [`ARCHITECTURE.md`](ARCHITECTURE.md) first.**
> It covers how each file works, which PRD decisions were deviated from and why,
> and the open findings that need a product decision.

- **Frontend**: static HTML/CSS/JS, no framework, no build step — deploys with the
  main site via GitHub Pages
- **Backend**: Supabase project `zglavicybcjctogspbap` (`Closer-Match`)
- **Zero AI at runtime, zero API cost.** All scoring is deterministic arithmetic
  in Postgres functions

## The look

**A touchstone is a black stone; you rub gold on it and read the streak.** Ink,
V-BOG orange, warm paper. One accent, no gradients, no shadows. The streak is not
decoration — it marks *where you are*: under the wordmark, under the active nav
item, down the edge of the row you are on, inside a focused field. It never marks
quality; nothing in this console gets a green light.

Numbers are set in mono with tabular figures, because a number set in a monospace
looks measured and the same number in a heavy sans looks awarded — and these
weights are expert-set, not learned.

The mark is `img/nikash.svg`: the stone, and the tapering streak the gold leaves on
it, running off the edge because the reading does not stay on the instrument.

Stylesheets: `nikash.css` (console, keying, verification call), `brand.css` and
`assess.css` (the client brief, the candidate assessment and the supplement — the
surfaces an outsider sees, which wear v-bog.com's own register). See
ARCHITECTURE.md §7b0 and §7m.

## The three rules

1. **Scores never leave the building.** Clients get a candidate and a written
   recommendation. Never a dimension score, a match percentage, or the test.
2. **The candidate is assessed with no knowledge of any client.** Everyone takes
   the identical 44 items.
3. **The system ranks and explains. It never decides.** There is no auto-reject
   path in the code, and no column that could hold one.

## The five steps

| Step | What happens | Produces |
|---|---|---|
| 1 | Candidate takes the 44-item test | 9 scores |
| 1.1 | Client completes intake | target profile |
| 1.5 | **Hard filters** — before any matching | eligibility, failing filter named |
| 2 | Match + rank — runs when a client submits **and** when a candidate finishes | ranked requirements |
| 3 | Client supplement — **top 2 requirements only** | supplement verdict |
| 4 | Verification call: technical + role-play + psych probes | interview ratings |
| 5 | Sent to client | placement + outcomes |

## Database setup

Run the files in `sql/` in numeric order (01→19) in the Supabase SQL Editor. All
are idempotent. The project is already set up; this is for rebuilding on a fresh
one.

After any parameter change:

```sql
select * from run_golden_cases();
```

**Nothing ships unless every row passes.** 19 cases currently, covering the
CLS-blend frame split, band boundaries, the cycle override, hard-filter naming,
the scoring arithmetic end to end, and the confidence multiplier.

## What the scores mean

**Dictionary** in the console. Each of the nine, in plain language: what a high
score does on the floor, what a low one does, the commercial consequence, and
which items produce it — plus the level every open role asks for.

The short version of the one that confuses everybody: **CLS_C and CLS_F are the
same trait in two different sales motions.** Closing on a considered sale (weeks,
several conversations, a senior buyer) and closing on a fast one (inside the
inbound call you are already on). A candidate can be strong at one and weak at the
other. Which one counts is decided by the client's ticket size and cycle length —
never by the candidate — which is why no blended closing score is ever stored.

## Where the results are

**Requirements → open the role** for the shortlist: rank, composite, the
quality/fit split, three reasons, the concerns, any failing hard filters, and
whether the person fits a different open role better.

**Candidates** lists everyone with their nine raw scores and, beside each name,
the match percentage against every open role — best first, with the rank and any
failing hard filter named. Scan the list; click through for the reasoning.

**Candidates → click a name** for one person in full — all nine dimensions, each
one shown *against every open role's required level*, with the gap in points and a
tick on the bar marking what the role asks for.

That "against" is the whole design. A dimension score means nothing on its own —
72 on Resilience is strong for one desk and short for another — so the page never
shows a bare number. With no open role it says so instead of rendering the table.
Bipolar dimensions (Deal Motion, Interpersonal Style) show a position between
their two poles rather than a bar filling toward 100, because neither pole is
better. Closing appears twice, considered and fast, with each role's blend weight
and the effective value — there is no single closing score, by design.

Matching runs at both ends: when a client submits their brief, and when a
candidate finishes their test. So the order does not matter — see ARCHITECTURE.md
§7q, because for a while it did.

## Health checks

| Query | Tells you |
|---|---|
| `select * from v_dimension_alpha` | Cronbach's α per dimension. <.60 rewrite; **CLS below .55 → collapse the split** |
| `select * from v_item_total_correlation` | An item pulling against its dimension (r < .15 → replace) |
| `select * from v_sd_correlation` | Are the right answers obvious? (r > .40 → rewrite) |
| `select * from v_score_distribution` | SD < 10 points → the dimension doesn't discriminate |
| `select * from v_group_gaps` | A 15-point group gap is a fact about your items, not about closers |
| `select * from v_drift_monthly` | Leakage signature: scores up + variance down + time down, together |
| `select * from v_human_agreement` | Whether the score has become a gate in practice |
| `select * from v_keying_agreement` | Where the three expert keys diverge (§13) |
| `select * from v_c10_audit` | **Must always be empty** — any row is a policy exposing a score to a non-staff principal |
| `select * from v_rls_bypass_audit` | **Must always be empty** — any row is something reachable *without* a policy being consulted at all (see ARCHITECTURE.md §7n) |
| `select * from v_unmatched_audit` | **Must always be empty** — any row is an assessed candidate missing from an open role's shortlist (§7q) |
| `select * from v_double_session_audit` | **Must always be empty** — any row is a candidate who reopened a finished link and got a fresh empty session (§7t) |
| `select * from v_empty_profile_audit` | **Must always be empty** — any row is a profile a recompute erased (§7w) |
| `select * from v_rekey_pending` | Items where every expert who keyed it agreed, and disagreed with the bank — the re-key shortlist (§7u) |
| `select * from v_outcomes_due` | Overdue outcome checkpoints. The one table everything else depends on |
| `select * from v_predictor_validity` | Which of the three predictors actually predicted retention |
| `select * from v_criterion_validity` | Do the dimensions separate known-strong from known-average closers |
| `select * from v_supplement_overlap` | Three clients asking the same thing means the dictionary is short a dimension |

## Status

**Built and verified live:** the full database (schema, dictionary, all 44 items
with keys, scoring, target profiles, match engine, golden cases, RLS, scheduled
retention purge) plus all three surfaces — candidate assessment, client intake,
and the console.

**Everything in the five-step process is now built.** Deliberately still open,
per the PRD's own list:

- **20 alternate items and bank rotation** — Phase 5, from month 3 (§7.3)
- **Extra role-play packs** for field, channel, renewals and enterprise
  multi-stakeholder — write the pack rather than stretching one (§17)
- **Fitted weights** — needs ~100 outcomes (§12). `v_predictor_validity` is
  built and will answer it when the data exists

## Writing a client supplement

Open **Supplements**, pick the client, and press **Suggest from their intake**. That
builds a draft from templates chosen against what they already told you — ticket
band, cycle length, whether they have a CRM, how much is cold outbound, whether a
refund policy exists, whether the buyer is an owner. Same intake, same draft, every
time; no model involved.

It is a starting point, not a finished supplement. **Rewrite the two vertical
questions** — a question that could apply to any industry tests nothing. Then edit,
trim to 5–8 behavioural plus 3–5 technical, and save.

## If the console says your session expired

Access tokens last an hour. The app now refreshes them silently, so this should
not happen — but if it ever does, sign out and back in. Nothing is lost:
everything is already in the database.

## Getting three experts to key the items (§13)

Every SJT key in the bank is currently one person's opinion. Three experts keying
independently is what turns it into a finding — and the most useful keyers are the
ones who do not work here.

Open **Keying**, create a round, then **Invite a keyer** with their name and email.
You get a link to send them:

```
keying.html?t=<token>
```

No account, no password. It opens straight into the 28 items, shows them whose link
it is, saves every answer as they make it, and resumes where they stopped. Good for
21 days. The list shows each keyer's progress — *not opened, in progress, finished*
— because a round stalls when one of the three never finishes and you cannot see it
otherwise. **Withdraw link** stops it immediately and keeps everything already keyed.

Send each expert their own link. Keys are attributed to the name on the link, so a
forwarded one would overwrite somebody's work — the page says so before they start.

### And then do something with it

**Keying → See the breakdown.** Every item, what the bank currently scores, what
each expert chose, and their note. Where the experts are **unanimous and disagree
with the bank**, there is a **Re-key** button.

Applying one moves the top score to the option they chose — by swapping, so the
−1/0/+1/+2 spread survives — then **recomputes every candidate profile and every
open shortlist**, because a score measured under the old key does not mean the
same thing under the new one. It is recorded in `key_changes` against your name,
and `undo_rekey()` reverses it.

Where the experts **split**, do not re-key. The item itself is ambiguous, and §13
asks for it to be rewritten before launch.

A keyer's email is **not** a console account. It gets a `staff` row so the keys can
be attributed, marked inactive, which grants nothing. If they try to sign in to the
console they are told to use their keying link instead.

## Staff access

Supabase Auth, email + password. **Creating an account grants nothing** — every
policy keys off a `staff` row, so an admin adds the person first:

```sql
insert into staff (email, full_name, role) values ('them@v-bog.com','Their Name','recruiter');
```

They then sign up at `nikash.html` with that same email and the account links
itself. Roles: `admin`, `recruiter`, `psych`. Only `admin` and `psych` can read
`monitoring_attributes` — recruiters, who make the shortlist calls, cannot see it
at all, which is the protection that matters (§14.3).

## Before the candidate test can be used — four values

The §15.1 consent notice is assembled from `app_settings`, and **the assessment
will not open until all four are filled in.** That is deliberate: a consent notice
still saying "[Firm]" is not consent. A candidate opening the link today sees
"this assessment isn't quite ready yet", and `start_assessment()` refuses.

```sql
update app_settings set value = 'Your Legal Entity Pvt Ltd' where key = 'firm_legal_name';
update app_settings set value = 'privacy@v-bog.com'         where key = 'data_deletion_email';
update app_settings set value = 'Depesh Vyas'               where key = 'grievance_officer';
update app_settings set value = 'depesh@v-bog.com'          where key = 'grievance_email';

select consent_settings_missing();   -- must return {}
```

`grievance_officer` must be a **named person**, not a role title — that is what
C1 asks for. Bump `consent_version` whenever the notice changes materially; each
candidate's `consent_version` records which text they agreed to.

## Sending a candidate the test

```sql
select issue_assessment_token('<candidate_id>', 14);   -- staff only, 14-day link
```

Then send them `https://v-bog.com/internal/closer-match/assess.html?t=<token>`.
Answers autosave per item, so the same link resumes exactly where they stopped.

**Resolved:** the CLS blend is now a continuous consideration axis (65% ticket /
35% cycle, both interpolated) rather than a step lookup — see ARCHITECTURE.md §5.1.
A ₹2,000 ticket difference now moves the blend by 0.006 instead of 0.20, and a
long cycle can genuinely correct a small ticket band. Set
`dimension_params('cls_blend_mode','interpolated')` to `0` to revert.
