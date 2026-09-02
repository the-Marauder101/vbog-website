# Pravah V3 Addendum — KRA / KPI Management Engine

This addendum is intentionally standalone so another builder can reconstruct the V3 decision without the original conversation. It should be merged into `PRD.md` when the product reaches the final documentation pass.

## Why V3 exists

The Get Closers team needs a management system that makes employee performance measurable from operating evidence rather than subjective monthly reviews. The approved role framework contains six KRAs with fixed weights:

| KRA | Weight |
|---|---:|
| Candidate Selection Quality | 20% |
| Training & Closer Performance | 30% |
| Placed Closer Success & Retention | 20% |
| Client Management & Satisfaction | 15% |
| Sales Intelligence / Pattern Recognition | 10% |
| Process Discipline & Reporting | 5% |

V3 turns those six KRAs into sixteen scored KPIs. The scorecard is intended first for the team member responsible for the technical interview round, closer training/counselling, and client management, while remaining configurable for future staff roles.

## Scoring rules

- KPI target is explicit and stored as configuration.
- KPI actual is calculated from Pravah evidence.
- Higher-is-better KPIs score as `min(120, actual / target × 100)`.
- 100 means target achieved.
- 120 is the stretch cap.
- KRA score is the weighted average of its KPIs.
- Overall score is the weighted average of all six KRA scores.
- Missing evidence produces `No data`, not an invented zero.
- A manager may override a KPI only with a reason and optional evidence URL.
- Finalization records the calculated score for the period without rewriting source metrics.

## KPI set

### Candidate Selection Quality — 20%

1. **CSQ-1 Final-round acceptance rate** — 60% of KRA; target 90%.
2. **CSQ-2 90-day success of selected candidates** — 40%; target 85%.

### Training & Closer Performance — 30%

3. **TCP-1 Training pass rate** — 20%; target 90%.
4. **TCP-2 Closers achieving target** — 30%; target 80%.
5. **TCP-3 Average target attainment** — 25%; target 100%.
6. **TCP-4 Company sales target achievement** — 25%; target 100%.

### Placed Closer Success & Retention — 20%

7. **PCS-1 90-day retention** — 30%; target 85%.
8. **PCS-2 6-month retention** — 30%; target 75%.
9. **PCS-3 Placed closer target attainment** — 40%; target 100%.

### Client Management & Satisfaction — 15%

10. **CMS-1 Check-in completion** — 35%; target 95%; operating expectation is four client check-ins per week.
11. **CMS-2 Client satisfaction** — 35%; target 90/100.
12. **CMS-3 Action SLA** — 30%; target 90% on-time completion.

### Sales Intelligence / Pattern Recognition — 10%

13. **SI-1 Validated pattern insights** — 40%; target 100% of the configured insight cadence.
14. **SI-2 Intervention effectiveness** — 60%; target 75% of reviewed interventions showing improvement.

### Process Discipline & Reporting — 5%

15. **PD-1 Report timeliness** — 50%; target 95% within one day of period end.
16. **PD-2 Report data completeness** — 50%; target 98% complete.

## Evidence model

The scorecard uses the following hierarchy:

1. CRM/payment evidence;
2. system-generated Pravah records;
3. client-confirmed records;
4. structured staff reports;
5. manager override with written evidence.

Closer-reported cash remains provisional. Verified cash remains the official financial KPI source.

## New V3 evidence structures

### Technical interview attribution

`pravah_selection_reviews` stores candidate, reviewer, review date, technical decision, client final decision, optional placement and source reference. This is an interim capture mechanism because the current Vyom/Nikash workflow does not yet expose a reliable technical-round reviewer event. It is designed to be populated automatically in a later integration.

### Pattern intelligence

`pravah_insights` separates observation, recurring pattern and recommendation. A pattern can be linked to a client, placement or action and later marked implemented, validated or invalidated.

### Intervention tracking

`pravah_interventions` captures problem, baseline metric/value, intervention, review date and outcome. Effectiveness is recorded as improved, no change, worse or inconclusive. This creates the evidence chain needed to judge whether counselling or an operating change worked.

### Company target

`pravah_company_targets` stores the period-level company target used by TCP-4. The company result is derived from verified operational revenue/cash records.

### Scorecard snapshot

`pravah_scorecards` stores finalized review periods. `pravah_kpi_overrides` stores any manager judgment separately from the calculated result.

## User experience

The V3 performance workspace is a focused management surface with:

- period selector;
- staff selector for administrators;
- overall score;
- six KRA cards;
- KPI actual, target and score;
- explicit data warnings;
- KPI definitions and formulas;
- technical-round evidence capture;
- company target capture;
- pattern insight capture;
- intervention capture;
- admin scorecard finalization.

The workspace is intentionally separate from the general Pravah shell in V3 so it can be validated quickly. It should be promoted into the main Pravah navigation after the scoring model is operationally validated.

## What V3 does not yet automate

- technical-round reviewer attribution from Vyom/Nikash;
- CRM/payment verification from client systems;
- automatic expected-report schedules for every closer;
- automatic insight generation.

These are explicit future integration/automation items, not hidden assumptions.

## Next phase

V4 is the Client Revenue Engine: canonical leads, activities, deals, sales and payment evidence, call-log ingestion, client CRM/Sheet normalization, and the live rebuild of the CEO Dashboard. The V3 scorecard should consume V4 verified revenue evidence without changing its KRA definitions.
