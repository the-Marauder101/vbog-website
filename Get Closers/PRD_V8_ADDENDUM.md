# Pravah V8 — Client CRM

## Purpose

V8 turns the client portal from a read-only dashboard into a complete CRM that
replaces Google Sheets for client lead management, pipeline tracking, and
performance visibility. Every feature feeds the existing V3 KRA/KPI engine and
V4 revenue model — no parallel schema.

## Product boundary

- V4 canonical revenue tables remain the single source of truth.
- V5 import infrastructure is reused for client-side CSV/Callyzer imports.
- V3 scorecards consume the same verified revenue/activity records.
- V8 does not add new tables — it opens existing write contracts to
  `client_admin` and builds the interface.

## Client CRM capabilities

### Lead management
- Full lead register with search and stage filter.
- Lead detail view: contact info, stage, full activity timeline, associated
  deals, and inline editing.
- Add lead (manual entry).
- Update lead stage, notes, and contact details.
- Activity logging from lead detail (call, WhatsApp, email, meeting, follow-up,
  note).

### Pipeline and deals
- Open deals table with inline stage management.
- Create deal from any lead.
- Update deal stage and expected close date.
- Deal value tracking in client currency.

### Sales and cash
- Sale recording against leads and deals.
- Payment evidence capture (pending → verified by GC staff).
- Sales history with status tracking.

### CSV / Callyzer import
- 3-step import wizard: setup → preview & map → import.
- File upload or paste CSV data.
- Auto-mapping of common header names to canonical fields.
- Manual field mapping override per column.
- Stage mapping: map client CRM status values to canonical pipeline stages.
- Callyzer call-log format support (parser key: `ceo_dashboard_callyzer`).
- Generic CSV and CRM format support.
- Saved mapping profiles per client for repeat imports.
- Validation with repair queue for rows missing required fields.
- Idempotent import via source record keys — no duplicates on re-import.
- Import audit trail.

### Enhanced dashboard
- Funnel visualization showing lead counts per pipeline stage.
- MTD revenue and cash metrics alongside totals.
- Active closer roster with sales and cash.
- Recent check-in health timeline.

### Search and filter
- Text search across lead name, email, phone.
- Stage filter on leads and deals.
- Instant client-side filtering — no server round-trip.

## SQL changes (migration 22)

New `client_admin` write RPCs:
- `pravah_client_update_lead(p_lead_id, p_stage, p_notes)` — update own leads.
- `pravah_client_create_deal(...)` — create deal for own leads.
- `pravah_client_update_deal(p_deal_id, p_stage)` — update own deals.
- `pravah_client_record_sale(...)` — record sale for own leads/deals.

Import RPCs updated to accept `client_admin` in addition to internal staff:
- `pravah_import_create_profile` — `client_admin` can create profiles for own client.
- `pravah_import_stage_rows` — `client_admin` can stage rows for own profiles.
- `pravah_import_validate_batch` — `client_admin` can validate own batches.
- `pravah_import_replay_batch` — `client_admin` can replay own batches.

Import table RLS policies updated to allow `client_admin` read/write on own
client's import data.

## Security model

- `client_admin` writes are scoped to their own `client_id` — enforced in
  every RPC via `pravah_my_client_id()`.
- `client_viewer` remains read-only — no write access.
- `closer` portal is unchanged.
- All writes go through `security definer` RPCs with explicit ownership checks.
- Import profiles, batches, and rows are client-isolated via RLS.
- Source data immutability is preserved — raw payloads are never modified.

## Interface structure

| # | View | Content |
|---|---|---|
| 01 | Dashboard | KPI cards (closers, revenue, cash, leads, pipeline, actions), funnel, roster, check-ins |
| 02 | Leads | Search + stage filter, lead table with inline stage, lead detail slide-out with activity timeline |
| 03 | Pipeline | Open deals table, inline stage update, create deal |
| 04 | Sales & cash | Sales register, payment evidence, sale recording |
| 05 | Import | 3-step CSV/Callyzer wizard with field and stage mapping |
| 06 | Closers | Closer roster, performance reports |
| 07 | Actions | Open actions, check-in history |

## Callyzer integration

Callyzer is the primary call-tracking tool used by Get Closers clients. The
import wizard supports Callyzer CSV exports with automatic header recognition:

| Callyzer column | Maps to |
|---|---|
| Client Name / Name | `full_name` |
| Client Number / Phone / Mobile | `contact_key` |
| Call Type / Type | `activity_type` |
| Call Date / Date / Timestamp | `occurred_at` |
| Duration / Call Duration | `duration_seconds` |
| Status / CRM Status | `crm_status` (mapped to canonical stage) |
| Notes / Remarks | `note` |

The parser key `ceo_dashboard_callyzer` triggers Callyzer-aware auto-mapping.

## KPI and reporting impact

All client portal writes flow through the same V4 canonical tables that feed:
- V3 KRA/KPI scorecard calculations (TCP-2 closers achieving target, TCP-3
  average target attainment, CMS-1 check-in completion).
- Performance reports (calls attempted, sales count, cash collected).
- Revenue dashboard (pipeline value, booked revenue, verified cash).
- Company-wide normalized reporting.

No separate client-side metrics — a lead created in the client portal and a lead
created by ops staff are the same record.

## Explicit non-goals for V8

- No client-side payment verification (remains GC staff only).
- No lead assignment/reassignment by client (closer assignment is ops).
- No client-side adjustment/refund recording.
- No real-time sync with external CRMs (import is manual CSV).
- No WhatsApp Business API integration.
- No closer portal changes.
