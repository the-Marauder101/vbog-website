# Pravah V3 — KRA / KPI Definitions

## Score philosophy

The scorecard is designed to be **trackable from operating data**, not manager opinion.

- Each KRA has a fixed company-approved weight.
- Each KRA contains a small number of KPIs.
- KPI actuals come from Pravah evidence wherever possible.
- A KPI without enough evidence is shown as **No data**, not silently scored as zero.
- A KPI score is `min(120, actual / target × 100)` for higher-is-better metrics.
- 100 means target achieved; 120 means stretch cap.
- KRA score is the weighted average of its KPIs.
- Overall score is the weighted average of the six KRA scores.
- Any manager override must be recorded with a reason and evidence.

## Approved KRA weights

| KRA | Weight |
|---|---:|
| Candidate Selection Quality | 20% |
| Training & Closer Performance | 30% |
| Placed Closer Success & Retention | 20% |
| Client Management & Satisfaction | 15% |
| Sales Intelligence / Pattern Recognition | 10% |
| Process Discipline & Reporting | 5% |

## KPI catalogue

### 1. Candidate Selection Quality — 20%

- **CSQ-1 Final-round acceptance rate — 60% of KRA**
  - Target: 90%
  - Technical-round passes accepted by the client / technical-round passes.
  - Requires reviewer attribution; this is currently captured by the V3 selection-review form and is a future candidate for automatic Vyom/Nikash ingestion.
- **CSQ-2 90-day success of selected candidates — 40%**
  - Target: 85%
  - Retained M3 outcomes / M3 outcomes for candidates attributed to the reviewer.

### 2. Training & Closer Performance — 30%

- **TCP-1 Training pass rate — 20%** — target 90%.
- **TCP-2 Closers achieving target — 30%** — target 80%.
- **TCP-3 Average target attainment — 25%** — target 100%.
- **TCP-4 Company sales target achievement — 25%** — target 100%; official result uses verified cash/revenue against the configured company target.

### 3. Placed Closer Success & Retention — 20%

- **PCS-1 90-day retention — 30%** — target 85%.
- **PCS-2 6-month retention — 30%** — target 75%.
- **PCS-3 Placed closer target attainment — 40%** — target 100%.

### 4. Client Management & Satisfaction — 15%

- **CMS-1 Check-in completion — 35%** — target 95%; expected cadence is four check-ins per week for this operating role.
- **CMS-2 Client satisfaction — 35%** — target 90/100, derived from the 1–5 check-in score.
- **CMS-3 Action SLA — 30%** — target 90%; owned actions completed on or before due date.

### 5. Sales Intelligence / Pattern Recognition — 10%

- **SI-1 Validated pattern insights — 40%** — target 100% of the expected insight cadence; insight records separate observation, pattern and recommendation.
- **SI-2 Intervention effectiveness — 60%** — target 75% of reviewed interventions showing improvement.

### 6. Process Discipline & Reporting — 5%

- **PD-1 Report timeliness — 50%** — target 95%; submitted within one day of period end.
- **PD-2 Report data completeness — 50%** — target 98%; all required operating fields present.

## Evidence hierarchy

1. CRM / payment evidence
2. System-generated Pravah records
3. Client-confirmed records
4. Structured staff report
5. Manager override with written evidence

Closer-reported cash remains provisional. It must never silently replace CRM/client-verified cash in official performance KPIs.

## V3 data-gap capture

The V3 workspace includes four structured evidence forms:

- technical-round outcome;
- company target;
- pattern insight;
- intervention baseline and plan.

These are intentionally temporary capture points where the source systems do not yet provide a reliable event. The next automation batches should remove manual entry where Vyom, Nikash, or the client CRM can provide the same evidence.
