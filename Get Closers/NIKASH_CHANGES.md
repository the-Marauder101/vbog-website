# Nikash Changes Required for Pravah

Nikash remains the owner of assessments, matching logic, and prediction
evidence. Pravah supplies observed outcomes so predictions can be validated.

## V1 compatibility additions

- stable candidate, client, requirement, and prediction IDs;
- freeze the prediction version used at placement;
- outcome checkpoint structure for 3, 6, and 12 months;
- read-only outcome timeline on the relevant prediction/candidate;
- deep link to the Pravah placement, subject to role permissions.

## V2A compatibility

Nikash's existing `clients` rows are not renamed or automatically merged.
Pravah's Vyom client inbox links a verified Vyom UUID to the correct shared
Nikash/Pravah client UUID. A normalized-name suggestion is never sufficient to
change assessment or requirement ownership.

## Outcome fields Pravah supplies

- joined date and training result;
- first sale timing;
- retained status;
- target achievement;
- client health/satisfaction;
- exit date, type, and reason;
- checkpoint period and evidence source.

## Explicit exclusions

- no candidate-stage management inside Nikash;
- no closer monitoring workspace inside Nikash;
- no recomputation of historical predictions after outcomes arrive;
- no client lead CRM inside Nikash.
