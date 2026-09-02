const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const sql = read('supabase/11_v4_revenue_engine.sql') + '\n' + read('supabase/13_v4_revenue_operations.sql');
const verify = read('supabase/12_verify_v4_revenue.sql');
const html = read('revenue/index.html');
const js = read('revenue/revenue.js');

const tables = [
  'pravah_revenue_stages', 'pravah_revenue_leads', 'pravah_revenue_activities',
  'pravah_revenue_deals', 'pravah_revenue_sales', 'pravah_revenue_payments',
  'pravah_revenue_adjustments'
];
const functions = [
  'pravah_revenue_create_lead', 'pravah_revenue_log_activity',
  'pravah_revenue_create_deal', 'pravah_revenue_update_lead',
  'pravah_revenue_update_deal', 'pravah_revenue_record_sale',
  'pravah_revenue_record_payment', 'pravah_revenue_verify_payment',
  'pravah_revenue_record_adjustment', 'pravah_revenue_dashboard'
];

for (const table of tables) {
  if (!sql.includes(`create table if not exists ${table}`)) throw new Error(`Missing table contract: ${table}`);
  if (!sql.includes(`alter table ${table} force row level security`)) throw new Error(`Missing forced RLS: ${table}`);
}
for (const fn of functions) {
  if (!sql.includes(`function ${fn}(`)) throw new Error(`Missing function contract: ${fn}`);
}
for (const stage of ['new','contacted','qualified','booked','proposal','negotiation','won','lost','nurture']) {
  if (!sql.includes(`'${stage}'`)) throw new Error(`Missing canonical stage: ${stage}`);
}
for (const marker of ['Customer / lead','Create opportunity','Record sale','Record payment','Revenue dashboard','Customers &amp; leads']) {
  if (!html.includes(marker)) throw new Error(`Missing UI marker: ${marker}`);
}
for (const marker of ['pravah_revenue_dashboard','pravah_revenue_create_lead','pravah_revenue_log_activity','pravah_revenue_record_sale','pravah_revenue_record_payment','pravah_revenue_verify_payment']) {
  if (!js.includes(marker)) throw new Error(`Missing frontend RPC: ${marker}`);
}
if (!verify.includes('forced_rls') || !verify.includes('expected_stage_count')) throw new Error('Verification script is incomplete.');
if (sql.includes('service_role') || html.includes('service_role') || js.includes('service_role')) throw new Error('Service-role credential must never reach the browser.');
console.log('V4 revenue contract checks passed.');
