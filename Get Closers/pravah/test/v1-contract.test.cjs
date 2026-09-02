const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const html = fs.readFileSync(path.join(root, "pravah/index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "pravah/js/app.js"), "utf8");
const config = fs.readFileSync(path.join(root, "pravah/js/config.js"), "utf8");
const sql = fs.readFileSync(path.join(root, "supabase/01_pravah_core.sql"), "utf8");

for (const id of ["auth-screen", "app-shell", "placement-rows", "client-grid", "report-list", "report-modal", "form-modal"]) {
  assert.match(html, new RegExp(`id=["']${id}["']`), `missing interface contract: ${id}`);
}
const ids = [...html.matchAll(/\bid=["']([^"']+)["']/g)].map((match) => match[1]);
assert.equal(new Set(ids).size, ids.length, "HTML IDs must be unique");

assert.ok(html.indexOf("js/config.js") < html.indexOf("js/supabase.js"));
assert.ok(html.indexOf("js/supabase.js") < html.indexOf("js/app.js"));
assert.match(config, /sb_publishable_/);
assert.doesNotMatch(config, /service_role|sbp_[a-f0-9]{20,}|secret[_-]?key/i);

for (const table of [
  "pravah_memberships", "pravah_client_profiles", "pravah_training",
  "pravah_training_checkpoints", "pravah_targets", "pravah_performance_reports",
  "pravah_client_checkins", "pravah_actions", "pravah_audit_events"
]) {
  assert.match(sql, new RegExp(`create table if not exists ${table}\\b`), `missing table: ${table}`);
  assert.match(sql, new RegExp(`alter table %I (?:enable|force) row level security`), "RLS loop missing");
}

for (const rpc of [
  "pravah_context", "pravah_create_placement",
  "pravah_start_training", "pravah_update_training",
  "pravah_add_training_checkpoint",
  "pravah_create_action", "pravah_set_target",
  "pravah_mark_report_shared", "pravah_dashboard"
]) {
  assert.match(sql, new RegExp(`function ${rpc}\\(`), `missing RPC: ${rpc}`);
  assert.match(app, new RegExp(`["']${rpc}["']`), `RPC not used by application: ${rpc}`);
}
assert.match(sql, /function pravah_create_client\(/, "V1 migration remains reproducible");
for (const retiredRpc of ["pravah_save_report", "pravah_record_checkin", "pravah_complete_action"]) {
  assert.match(sql, new RegExp(`function ${retiredRpc}\\(`), `V1 migration lost: ${retiredRpc}`);
}

assert.match(sql, /force row level security/);
assert.match(sql, /revoke all on function pravah_context\(\) from public/);
assert.match(sql, /revoke all on function pravah_audit\(uuid,text,text,text,jsonb\) from public/);
assert.doesNotMatch(sql, /grant (?:insert|update|delete)[^;]*pravah_/i);
assert.match(sql, /where pravah_can_access_client\(c\.id\)/);
assert.match(app, /same approved staff account you use for Nikash|pravah_context/);

const securityDefiners = [...sql.matchAll(/function\s+(pravah_[a-z0-9_]+)\([^$]*?security definer/gis)].map((match) => match[1]);
for (const functionName of new Set(securityDefiners)) {
  assert.match(sql, new RegExp(`revoke all on function ${functionName}\\(`), `security-definer function remains PUBLIC: ${functionName}`);
}
assert.equal((sql.match(/\$\$/g) || []).length % 2, 0, "SQL dollar quotes must be balanced");

console.log("v1-contract: all tests passed");
