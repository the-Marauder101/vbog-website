const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', '..');
const sql = fs.readFileSync(path.join(root, 'supabase', '08_v3_kpi_engine.sql'), 'utf8');
const ops = fs.readFileSync(path.join(root, 'supabase', '09_v3_kpi_operations.sql'), 'utf8');
const page = fs.readFileSync(path.join(__dirname, '..', 'performance', 'index.html'), 'utf8');
const prd = fs.readFileSync(path.join(root, 'V3_KPI_DEFINITIONS.md'), 'utf8');

for (const name of ['pravah_kra_definitions','pravah_kpi_definitions','pravah_company_targets','pravah_selection_reviews','pravah_insights','pravah_interventions','pravah_scorecards','pravah_kpi_overrides']) {
  if (!sql.includes(`create table if not exists ${name}`)) throw new Error(`Missing table: ${name}`);
}
for (const fn of ['pravah_kpi_dashboard','pravah_finalize_scorecard','pravah_set_kpi_override']) {
  if (!sql.includes(`function ${fn}`)) throw new Error(`Missing KPI function: ${fn}`);
}
for (const fn of ['pravah_kpi_staff_roster','pravah_record_selection_review','pravah_record_insight','pravah_record_intervention','pravah_review_intervention','pravah_set_company_target']) {
  if (!ops.includes(`function ${fn}`)) throw new Error(`Missing operations function: ${fn}`);
}
if (!ops.includes("'pravah_company_targets'") || !ops.includes("alter table %I enable row level security")) throw new Error('Company targets must have RLS.');
if (!page.includes('pravah_kpi_dashboard')) throw new Error('Performance page is not wired to KPI dashboard.');
if (!page.includes('pravah_record_selection_review')) throw new Error('Selection evidence form is missing.');
if (!prd.includes('Candidate Selection Quality')) throw new Error('KRA definitions are missing.');
console.log('V3 KPI contract checks passed.');
