const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const html = fs.readFileSync(path.join(root, "pravah/index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "pravah/js/app.js"), "utf8");
const api = fs.readFileSync(path.join(root, "pravah/js/supabase.js"), "utf8");
const sql = fs.readFileSync(path.join(root, "supabase/03_v2a_operational_hardening.sql"), "utf8");
const vyomSql = fs.readFileSync(path.resolve(root, "../internal/pm/sql/20_pravah_client_outbox.sql"), "utf8");
const edge = fs.readFileSync(path.join(root, "supabase/functions/pravah-sync-vyom/index.ts"), "utf8");

for (const id of ["report-form", "client-modal", "client-detail", "sync-client-rows"]) {
  assert.match(html, new RegExp(`id=["']${id}["']`), `missing V2A interface: ${id}`);
}
for (const field of [
  "calls_attempted", "connected_calls", "followups_completed", "qualified_opportunities",
  "meetings_booked", "sales_count", "revenue_generated", "cash_reported",
  "blocker", "support_required", "next_period_plan"
]) assert.match(html, new RegExp(`name=["']${field}["']`), `missing structured report field: ${field}`);

assert.doesNotMatch(html, /data-form=["']client["']/);
assert.doesNotMatch(html, /data-fill-example|Use example|Paste WhatsApp report/);
assert.match(html, /Cash reported by closer/);
assert.match(html, /CRM-verified cash|client-verified cash/);

for (const table of ["pravah_client_sync_inbox", "pravah_placement_states"]) {
  assert.match(sql, new RegExp(`create table if not exists ${table}\\b`));
}
for (const rpc of [
  "pravah_link_vyom_client", "pravah_submit_report", "pravah_verify_report_cash",
  "pravah_record_checkin_v2", "pravah_update_client_profile", "pravah_update_action",
  "pravah_void_report", "pravah_set_placement_state", "pravah_archive_client",
  "pravah_delete_unused_client"
]) {
  assert.match(sql, new RegExp(`function ${rpc}\\(`), `missing V2A RPC: ${rpc}`);
  assert.match(app, new RegExp(`["']${rpc}["']`), `V2A RPC not used: ${rpc}`);
}
assert.match(sql, /revoke execute on function pravah_create_client\(text\) from authenticated/);
assert.match(sql, /cash_verification_status/);
assert.match(sql, /verified_cash_collected/);
assert.match(sql, /Client and closer portals will be activated only after their restricted views are ready|portal_status/);
assert.match(api, /\/functions\/v1\//);

assert.match(vyomSql, /create table if not exists pravah_integration_outbox/);
assert.match(vyomSql, /idempotency_key text not null unique/);
assert.match(vyomSql, /revoke all on pravah_integration_outbox from anon, authenticated/);
assert.match(edge, /pravah_context/);
assert.match(edge, /VYOM_SERVICE_ROLE_KEY/);
assert.match(edge, /pravah_client_sync_inbox/);
assert.doesNotMatch(edge, /sbp_[a-f0-9]{20,}|sb_secret_[A-Za-z0-9_-]+/);

const ids = [...html.matchAll(/\bid=["']([^"']+)["']/g)].map((match) => match[1]);
assert.equal(new Set(ids).size, ids.length, "HTML IDs must remain unique");
assert.equal((sql.match(/\$\$/g) || []).length % 2, 0, "SQL dollar quotes must be balanced");

console.log("v2a-contract: all tests passed");
