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
| Blind item keying | `keying.html` | staff, §13 gate |
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

## Two visual worlds

The console, keying and verification-call surfaces follow **Vyom's** design
language, so staff moving between the two internal tools stay in one world. The
client role brief, the candidate assessment and the supplement follow **v-bog.com's
brand**, because those are seen from outside. Stylesheets: `nikash.css` (internal)
and `brand.css` / `assess.css` (external).

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
| 2 | Match + rank | ranked requirements |
| 3 | Client supplement — **top 2 requirements only** | supplement verdict |
| 4 | Verification call: technical + role-play + psych probes | interview ratings |
| 5 | Sent to client | placement + outcomes |

## Database setup

Run the files in `sql/` in numeric order (01→15) in the Supabase SQL Editor. All
are idempotent. The project is already set up; this is for rebuilding on a fresh
one.

After any parameter change:

```sql
select * from run_golden_cases();
```

**Nothing ships unless every row passes.** 19 cases currently, covering the
CLS-blend frame split, band boundaries, the cycle override, hard-filter naming,
the scoring arithmetic end to end, and the confidence multiplier.

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
| `select * from v_c10_audit` | **Must always be empty** — any row is a score exposed to a non-staff principal |
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

## If the console says your session expired

Access tokens last an hour. The app now refreshes them silently, so this should
not happen — but if it ever does, sign out and back in. Nothing is lost:
everything is already in the database.

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
