# CEO Dashboard Workbook Audit

## Source reviewed

CEO Dashboard - MDP [draft] (1).xlsx

## Intended operating model

The workbook combines call-log exports, individual closer lead sheets, and
midday/EOD reports. It calculates leads assigned, call and connection metrics,
lead dispositions, sales, revenue, cash, remaining payment, and conversion.

## Why the implementation is brittle

- separate staging sheet for each closer;
- Google-only IMPORTRANGE dependencies;
- names repeated as join keys;
- inconsistent columns and statuses;
- duplicated team metrics;
- formulas tied to closer names;
- some Yogesh and Ekta formulas reference Alok's date column;
- no schema version or validation layer;
- imported workbook displays NAME, VALUE, and division errors.

## Pravah migration decision

The workbook is a requirements source, not a production database.

Pravah preserves the metrics, closer/team comparisons, call-log enrichment,
midday/EOD reporting, and revenue/cash visibility. It replaces per-closer
formulas with canonical records, names as joins with stable IDs, implicit
columns with saved mappings, silent failures with reconciliation, and repeated
formulas with database views and defined metric formulas.
