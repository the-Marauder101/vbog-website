const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const html = fs.readFileSync(path.join(root, "pravah/index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "pravah/js/app.js"), "utf8");
const sql = fs.readFileSync(path.join(root, "supabase/05_v2b_candidate_outcomes.sql"), "utf8");
const verify = fs.readFileSync(path.join(root, "supabase/06_verify_v2b.sql"), "utf8");
const edge = fs.readFileSync(path.join(root, "supabase/functions/pravah-sync-vyom/index.ts"), "utf8");
const vyomSql = fs.readFileSync(path.resolve(root, "../internal/pm/sql/21_pravah_candidate_outbox.sql"), "utf8");
const vyomHtml = fs.readFileSync(path.resolve(root, "../internal/pm/board.html"), "utf8");
const vyomApp = fs.readFileSync(path.resolve(root, "../internal/pm/js/board.js"), "utf8");

for (const id of ["candidate-sync-rows", "outcome-rows"]) {
  assert.match(html, new RegExp(`id=["']${id}["']`), `missing V2B interface: ${id}`);
}
for (const table of ["pravah_candidate_sync_inbox", "pravah_integration_events"]) {
  assert.match(sql, new RegExp(`create table if not exists ${table}\\b`));
  assert.match(verify, new RegExp(table));
}
for (const rpc of ["pravah_link_vyom_candidate", "pravah_complete_candidate_handoff", "pravah_record_outcome"]) {
  assert.match(sql, new RegExp(`function ${rpc}\\(`), `missing V2B RPC: ${rpc}`);
  assert.match(app, new RegExp(`["']${rpc}["']`), `V2B RPC not used: ${rpc}`);
}
assert.match(vyomSql, /Placed - Handoff to Pravah/);
assert.match(vyomSql, /create table if not exists pravah_candidate_outbox/);
assert.match(vyomSql, /create table if not exists pravah_milestone_receipts/);
assert.match(vyomSql, /revoke all on pravah_candidate_outbox from anon, authenticated/);
assert.match(edge, /pravah_candidate_handoff/);
assert.match(edge, /deliverMilestones/);
assert.match(edge, /pravah_milestone_receipts/);
assert.match(sql, /source_system in \('nikash','pravah'\)/);
assert.match(vyomHtml, /id="t-pravah-group"/);
assert.match(vyomApp, /pravah_status/);
assert.doesNotMatch(sql, /insert\s+into\s+candidates/i, "Pravah must not create Nikash candidates");
assert.doesNotMatch(edge, /sbp_[a-f0-9]{20,}|sb_secret_[A-Za-z0-9_-]+/);

console.log("v2b-contract: all tests passed");
