# Pravah V3 Runbook

## Purpose

V3 turns the approved Get Closers six-KRA framework into an auditable scorecard. It consumes V1/V2 operational records and adds only the evidence structures that the source systems do not yet provide.

## Deployment order

1. Merge the V3 PR.
2. In the Pravah Supabase project, run `supabase/08_v3_kpi_engine.sql`.
3. Run `supabase/09_v3_kpi_operations.sql`.
4. Run `supabase/10_verify_v3_kpi.sql`.
5. Open `/Get%20Closers/pravah/performance/` and sign in with an approved Pravah staff account.

No browser credential or service-role key is required.

## First configuration

An administrator should configure the company target for the review period. The scorecard will show a warning until this exists.

For the technical interview KPI, record the technical-round outcome and final client decision. This is intentionally structured as an interim source until the event can be populated automatically from Vyom/Nikash.

For sales intelligence, record pattern insights using three separate fields: observation, recurring pattern, recommendation. Use interventions when the team changes an operating variable and needs to measure whether the change worked.

## Reading the score

- 100 = target achieved.
- 80–99.9 = below target but not critical.
- <80 = material underperformance.
- >100 = above target.
- 120 = stretch cap.
- `—` = insufficient evidence; investigate the data gap rather than assuming failure.

## Scorecard finalization

An admin can finalize a period for a staff member. Finalization stores the calculated overall score and review note. It does not rewrite source metrics.

Manager overrides remain separate and require a reason/evidence so the audit trail distinguishes operating performance from management judgment.

## Important limitation

V3 is the management scorecard, not yet the complete CRM. Verified cash still depends on V2A/V4 CRM or client-source integration. Candidate selection attribution is currently captured by the V3 form and should later be ingested automatically from the technical interview workflow.

## Rollback

V3 is additive. To roll back application behaviour, revert the V3 frontend commit. Do not drop V3 tables solely to hide the feature; scorecard history and evidence are intentionally retained. If a database rollback is required, take a backup and remove V3 objects only after confirming no later migration depends on them.
