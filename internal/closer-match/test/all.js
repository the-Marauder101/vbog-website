// Run every suite, in order, and report once.
//
// Each suite is a separate process. That is deliberate: one suite hanging on a
// selector or crashing the browser must not take the others with it, and each
// gets its own port and its own Chromium so a leaked page cannot leak sideways.
//
// The order is not arbitrary. `security` runs first, because if the schema is
// exposed nothing else is worth knowing. `keying` runs last of the mutating
// suites because it is the one that touches the live item bank, so it should not
// be interleaved with anything that reads scores. `regression` runs at the end
// as a broad sweep over whatever state the others left behind.
//
// Run: NIKASH_QA_EMAIL=… NIKASH_QA_PASSWORD=… node test/all.js
// The login must be an ADMIN — `ask` and `keying` both need it.
const { spawnSync } = require("child_process");
const path = require("path");

if (!process.env.NIKASH_QA_EMAIL || !process.env.NIKASH_QA_PASSWORD) {
  console.error("Set NIKASH_QA_EMAIL and NIKASH_QA_PASSWORD (an ADMIN staff login).");
  process.exit(2);
}

const SUITES = [
  ["security",   "the three rules, from outside the building"],
  ["assess",     "the candidate journey, by the door a candidate uses"],
  ["intake",     "the client's half, and the shortlist it produces"],
  ["ask",        "the interview scorecard, and that it moves no match score"],
  ["keying",     "the scoring key — mutates the live bank and puts it back"],
  ["regression", "every staff surface still loads and still says what it should"],
];

const totals = [];
for (const [name, what] of SUITES) {
  process.stderr.write(`\n── ${name} — ${what}\n`);
  const r = spawnSync(process.execPath, [path.join(__dirname, `${name}.js`)],
                      { encoding: "utf8", env: process.env });
  const out = r.stdout || "";
  let passed = 0, total = 0, failures = [];
  try {
    const rows = JSON.parse(out.slice(0, out.lastIndexOf("]") + 1));
    total = rows.length;
    passed = rows.filter(x => x.pass).length;
    failures = rows.filter(x => !x.pass).map(x => `${x.name} — ${x.detail}`);
  } catch (_) {
    failures = ["suite produced no readable result"];
  }
  const aborted = /ABORTED/.test(r.stderr || "");
  totals.push({ name, passed, total, aborted, failures });
  process.stderr.write(`   ${passed}/${total}${aborted ? "  ABORTED" : ""}\n`);
  for (const f of failures) process.stderr.write(`   FAIL  ${f}\n`);
}

const p = totals.reduce((n, t) => n + t.passed, 0);
const t = totals.reduce((n, x) => n + x.total, 0);
const bad = totals.filter(x => x.passed !== x.total || x.aborted);

process.stderr.write(`\n${"─".repeat(60)}\n`);
for (const s of totals) {
  process.stderr.write(
    `${s.passed === s.total && !s.aborted ? "  ok  " : "FAIL  "}${s.name.padEnd(12)}${s.passed}/${s.total}${s.aborted ? "  ABORTED" : ""}\n`);
}
process.stderr.write(`\n${p}/${t} assertions passed across ${SUITES.length} suites\n`);
process.exit(bad.length ? 1 : 0);
