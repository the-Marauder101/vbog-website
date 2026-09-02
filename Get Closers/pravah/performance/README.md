# Pravah Performance Workspace

V3 introduces a focused KRA/KPI management workspace at:

`/Get%20Closers/pravah/performance/`

It reuses Pravah's browser-safe Supabase configuration and authenticated staff session. It does not contain service-role credentials.

## What it does

- loads the six-KRA scorecard;
- calculates KPI actuals from Pravah operational records;
- shows target, score and data source;
- exposes evidence gaps instead of silently scoring missing data as zero;
- captures the temporary technical-round attribution required for Candidate Selection Quality;
- captures company targets;
- captures pattern insights;
- captures interventions and review plans;
- allows administrators to finalize a period.

## Integration note

The workspace is deliberately standalone for V3 validation. Once the score model has been used on real operating data, promote it into the main Pravah navigation and replace the temporary selection-review capture with the authoritative Vyom/Nikash event.
