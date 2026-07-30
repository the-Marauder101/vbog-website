# Closer–Match — closer-to-client matching system

VBOG's second internal tool. Assess a sales closer **once** against eight
constructs; match that one profile against **every** open client requirement,
with the reasoning shown.

> 🧭 **Building or changing anything? Read [`ARCHITECTURE.md`](ARCHITECTURE.md) first.**
> It covers how each file works, which PRD decisions were deviated from and why,
> and the open findings that need a product decision.

- **Frontend**: static HTML/CSS/JS, no framework, no build step — deploys with the
  main site via GitHub Pages
- **Backend**: Supabase project `zglavicybcjctogspbap` (`Closer-Match`)
- **Zero AI at runtime, zero API cost.** All scoring is deterministic arithmetic
  in Postgres functions

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

Run the files in `sql/` in numeric order (01→08) in the Supabase SQL Editor. All
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

## Status

Phase 0 and the database half of Phase 1 are complete and verified live: schema,
dictionary, all 44 items with keys, scoring, target profiles, the match engine,
golden cases, RLS, and a scheduled 24-month retention purge.

**Not yet built:** the three frontend surfaces (client intake, candidate test,
internal console), the §13 keying surface, and the Step 4 interview surface.

**Blocked on input:** the §15.1 consent notice needs the firm's legal name, the
deletion/withdrawal email, and a named grievance officer with an email address.
The candidate test cannot honestly go live without them.

**Open findings needing a decision:** see ARCHITECTURE.md §5 — the CLS band-edge
step size and the cycle adjustment's magnitude both behave as specified but do not
match the intent stated in PRD §14.1.
