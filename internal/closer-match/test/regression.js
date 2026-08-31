// REGRESSION — every staff surface still loads and still says what it should.
//
// WHY THIS EXISTS, AND WHY IT LIVES IN THE REPO.
//
// Eight QA suites (qa10 through qa20, ~230 assertions) were written over the
// course of building this tool and every one of them lived in an ephemeral
// scratchpad directory. The container was recycled and they are gone. The tests
// that guarded this system were the only part of it that was never version
// controlled, which is exactly backwards.
//
// > **A test that is not in the repository is not a test, it is a memory.**
//
// This file does not pretend to be those eight suites. It is a broad smoke pass
// over every staff surface, checking that each screen loads, renders its key
// content, and has not lost a region — the class of breakage that a change to a
// shared view or to the candidate page can cause. It runs alongside `ask.js`,
// which does the deep work on the newest feature.
//
// Run: node test/regression.js   (needs a staff login and a served copy of the app)
const { chromium } = require("/opt/node22/lib/node_modules/playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const ROOT = path.resolve(__dirname, "..");
// No default credentials. A password committed to a repository is a live
// password, and a test account is still an account with staff read on every
// candidate's scores. Create a staff login through the Team panel, then:
//   NIKASH_QA_EMAIL=… NIKASH_QA_PASSWORD=… node test/regression.js
const E = process.env.NIKASH_QA_EMAIL, P = process.env.NIKASH_QA_PASSWORD;
if (!E || !P) { console.error("Set NIKASH_QA_EMAIL and NIKASH_QA_PASSWORD (a staff login)."); process.exit(2); }
const PORT = 8099;
const T = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };
const server = http.createServer((q, r) => { const u = q.url.split("?")[0];
  const f = path.join(ROOT, u === "/" ? "index.html" : u);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { "Content-Type": T[path.extname(f)] || "text/plain" }); r.end(fs.readFileSync(f)); });
const results = []; const check = (n, p, d) => results.push({ name: n, pass: !!p, detail: String(d == null ? "" : d) });
async function route(page) { await page.route(/supabase\.co|fonts\.googleapis|fonts\.gstatic|api\.fontshare/, async r => {
  try { const q = r.request(); const res = await fetch(q.url(), { method: q.method(), headers: q.headers(), body: q.postData() || undefined });
  r.fulfill({ status: res.status, headers: { "content-type": res.headers.get("content-type") || "application/json", "access-control-allow-origin": "*" }, body: Buffer.from(await res.arrayBuffer()) }); } catch (e) { r.abort(); } }); }
const B = `http://127.0.0.1:${PORT}`;
const rest = (p, q) => p.evaluate(async (q) => (await (await fetch(`${SUPABASE_URL}/rest/v1/${q}`,
  { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${sessionStorage.getItem("nikash_token")}` } })).json()), q);
const rpc = (p, fn, args) => p.evaluate(async ([fn, args]) => {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: "POST",
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${sessionStorage.getItem("nikash_token")}`,
      "Content-Type": "application/json" }, body: JSON.stringify(args || {}) });
  const t = await r.text(); try { return { status: r.status, body: JSON.parse(t) }; } catch { return { status: r.status, body: t }; }
}, [fn, args]);
const flat = (s) => String(s || "").replace(/\s+/g, " ");

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const ctx = await b.newContext({ viewport: { width: 1360, height: 1200 } });
  const p = await ctx.newPage(); await route(p);
  const errs = []; p.on("pageerror", e => errs.push(e.message)); p.on("dialog", d => d.accept());

  await p.goto(`${B}/nikash.html`, { waitUntil: "domcontentloaded" });
  await p.waitForSelector("#v-signin:not([hidden])", { timeout: 20000 });

  // ══ AUTH ═════════════════════════════════════════════════════════════════
  // "Create account" must create an account or refuse — never fall through to
  // signing in. It used to, and pressing it put you inside the tool.
  await p.fill("#si-email", E); await p.fill("#si-pass", P);
  await p.click("#btn-signup");
  await p.waitForTimeout(2500);
  check("Create account with an existing email does not sign you in",
        await p.isVisible("#v-signin"), "");
  check("and points at Sign in instead",
        /already exists/i.test(flat(await p.textContent("#signin-error").catch(() => ""))), "");

  await p.fill("#si-email", E); await p.fill("#si-pass", P);
  await p.click("#btn-signin");
  await p.waitForSelector("#v-reqs:not([hidden])", { timeout: 20000 });
  check("Sign in works", true, "");

  // ══ REQUIREMENTS AND ONE SHORTLIST ═══════════════════════════════════════
  check("the requirements list renders", (await p.$$("#reqs-list [data-req]")).length > 0,
        `${(await p.$$("#reqs-list [data-req]")).length} open`);

  await p.click("#reqs-list [data-req]");
  await p.waitForSelector("#v-req:not([hidden])", { timeout: 20000 });
  await p.waitForTimeout(1600);
  const req = flat(await p.textContent("#v-req"));
  check("a shortlist renders with its candidates", (await p.$$("#req-list .cand")).length > 0,
        `${(await p.$$("#req-list .cand")).length} rows`);
  check("it still carries the expert-set caveat",
        /expert-set, not learned from outcomes/.test(req), "");
  check("nobody is failed for a filter that was never checked",
        !/cannot do remote/.test(req) || /Cannot check/.test(req), "");
  check("the client's own intake answers are shown",
        /What the client told us/.test(req) && /Typical deal value/.test(req), "");
  check("and can be edited", await p.isVisible("#btn-edit-intake"), "");

  // ══ THE CANDIDATE QUEUE ══════════════════════════════════════════════════
  await p.click("#nav-queue"); await p.waitForSelector("#v-queue:not([hidden])", { timeout: 20000 });
  await p.waitForTimeout(1600);
  const queue = flat(await p.textContent("#queue-list"));
  check("the queue renders", (await p.$$("#queue-list .cand")).length > 0,
        `${(await p.$$("#queue-list .cand")).length} candidates`);
  check("scores are on the row", (await p.$$("#queue-list .strip")).length > 0, "");
  check("nine score cells on a scored row",
        await p.evaluate(() => { const s = document.querySelector("#queue-list .strip");
          return s ? s.querySelectorAll("span").length : 0; }) === 9, "");
  check("the two no-better-end dimensions name their side",
        /mot\s*[\d.]+\s*(pitch|consultative)/i.test(queue) &&
        /sty\s*[\d.]+\s*(task|rapport)/i.test(queue),
        (queue.match(/sty\s*[\d.]+\s*\w+/i) || [""])[0]);
  check("a match percentage travels with the role it was computed against",
        /[\d.]+% · .+ — .+/.test(queue), (queue.match(/[\d.]+% · [^·]{0,44}/) || [""])[0]);

  // ══ ONE CANDIDATE ════════════════════════════════════════════════════════
  const id = await p.evaluate(() => {
    const row = [...document.querySelectorAll("#queue-list .cand")]
      .find(r => r.querySelector(".strip") && r.querySelector("[data-cand]"));
    return row && row.querySelector("[data-cand]").dataset.cand;
  });
  check("there is an assessed candidate to open", !!id, id || "none");
  await p.click(`#queue-list [data-cand="${id}"]`);
  await p.waitForSelector("#v-cand:not([hidden])", { timeout: 20000 });
  await p.waitForTimeout(1200);
  const cd = flat(await p.textContent("#cd-body"));

  // Every region the page is supposed to have. This is the assertion that a
  // change to get_candidate_detail or to the render order actually trips.
  const regions = await p.evaluate(() =>
    [...document.querySelectorAll("#cd-body .region-head h2")].map(h => h.textContent.trim()));
  check("the candidate page has all its regions",
        ["Against the open roles", "How they answered", "What we asked them",
         "The nine, against what each role asks for", "ASK interview"]
          .every(r => regions.some(x => x === r)),
        regions.join(" | "));

  check("no dimension shows a bare number without a target",
        await p.evaluate(() => [...document.querySelectorAll("#cd-body .dim")]
          .filter(d => !d.querySelector(".evidence li") && !/No open role states/.test(d.textContent)).length) === 0, "");
  check("nine dimensions, not more",
        (await p.$$("#cd-body .dim")).length === 9, `${(await p.$$("#cd-body .dim")).length}`);
  check("bipolar dimensions say neither end is better",
        (flat(await p.textContent("#cd-body")).match(/Neither end is better/g) || []).length === 2, "");
  check("the page carries the expert-set caveat",
        /expert-set, not learned from outcomes/.test(flat(await p.textContent("#cd-disclaimer"))), "");
  check("dates are spelled, not 8/1/2026",
        !/\d+\/\d+\/\d{4}/.test(await p.textContent("#cd-meta")), await p.textContent("#cd-meta"));
  check("the response-pattern evidence states what chance produces",
        /A pure guesser reaches 7 on average/.test(cd), "");
  check("and that none of it is a verdict",
        /Nothing here changes a number or excludes anybody/.test(cd), "");
  check("the stated facts panel is editable",
        (await p.$$("#df-region [data-df]")).length >= 4, "");

  // ══ THE OTHER SCREENS ════════════════════════════════════════════════════
  for (const [nav, screen, must] of [
    ["nav-dict", "v-dict", /0 is not a low score, it is one side/],
    ["nav-health", "v-health", /./],
    ["nav-place", "v-place", /./],
    ["nav-supp", "v-supp", /./],
    ["nav-guide", "v-guide", /./],
    ["nav-team", "v-team", /They create their own login/],
  ]) {
    await p.click(`#${nav}`);
    await p.waitForSelector(`#${screen}:not([hidden])`, { timeout: 20000 });
    await p.waitForTimeout(900);
    check(`${screen.replace("v-", "")} loads`,
          must.test(flat(await p.textContent(`#${screen}`))), "");
  }

  // ══ KEYING ═══════════════════════════════════════════════════════════════
  await p.goto(`${B}/keying.html`, { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(1600);
  await p.click("#see-agree").catch(() => {});
  await p.waitForSelector("#v-agree:not([hidden])", { timeout: 20000 });
  await p.waitForTimeout(1200);
  const agree = flat(await p.textContent("#agree-summary"));
  check("the keying report separates the four kinds of conflict",
        /unanimously say are keyed wrong/.test(agree) && /where most but not all agree/.test(agree) &&
        /split evenly on/.test(agree), agree.slice(0, 120));
  check("and names the key set in force",
        /Key set in force/.test(agree) && /[0-9a-f]{12}/.test(agree), "");

  // ══ THE INVARIANTS ═══════════════════════════════════════════════════════
  const golden = await rpc(p, "run_golden_cases");
  check("golden cases 19/19",
        Array.isArray(golden.body) && golden.body.filter(g => g.passed).length === 19,
        `${(golden.body || []).filter(g => g.passed).length}/${(golden.body || []).length}`);

  const audits = await p.evaluate(async () => {
    const g = async (v) => { const r = await fetch(`${SUPABASE_URL}/rest/v1/${v}?select=*`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${sessionStorage.getItem("nikash_token")}` } });
      const j = await r.json(); return Array.isArray(j) ? j.length : -1; };
    return { bypass: await g("v_rls_bypass_audit"), c10: await g("v_c10_audit"),
             empty: await g("v_empty_profile_audit"), fn: await g("v_function_grant_audit"),
             unmatched: await g("v_unmatched_audit"), dbl: await g("v_double_session_audit"),
             lockout: await g("v_staff_lockout_audit") };
  });
  check("every audit is empty", Object.values(audits).every(n => n === 0), JSON.stringify(audits));

  // The candidate surface must reach nothing that carries a score.
  const anon = await p.evaluate(async () => {
    const g = async (fn, body) => { const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: "POST",
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json" }, body: JSON.stringify(body || {}) }); return r.status; };
    const t = async (tbl) => { const r = await fetch(`${SUPABASE_URL}/rest/v1/${tbl}?select=*&limit=1`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } });
      const j = await r.json(); return Array.isArray(j) ? j.length : 0; };
    return {
      detail: await g("get_candidate_detail", { p_candidate_id: "00000000-0000-0000-0000-000000000000" }),
      report: await g("get_keying_report", {}),
      purge: await g("purge_expired_candidates", {}),
      staff: await g("list_staff", {}),
      ask: await g("get_ask_bank", { p_round: "r2" }),
      rows: (await t("candidate_profile")) + (await t("matches")) + (await t("ask_scores")),
      consent: await g("get_consent_notice", {}),
    };
  });
  check("no score-bearing RPC is reachable without a session",
        [anon.detail, anon.report, anon.purge, anon.staff, anon.ask].every(s => s >= 400),
        JSON.stringify(anon));
  check("and no score-bearing table returns a row", anon.rows === 0, `${anon.rows} rows`);
  check("but the candidate consent notice still is", anon.consent === 200, `HTTP ${anon.consent}`);

  // ══ 380px ════════════════════════════════════════════════════════════════
  await p.goto(`${B}/nikash.html`, { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(600);
  await p.setViewportSize({ width: 380, height: 900 });
  await p.waitForTimeout(700);
  const overflow = await p.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check("no horizontal scroll at 380px", overflow <= 1, `${overflow}px`);

  check("no JS errors", errs.length === 0, errs.join(" | "));

  console.log(JSON.stringify(results, null, 1));
  const bad = results.filter(r => !r.pass);
  console.error(`${results.length - bad.length}/${results.length} passed`);
  await b.close(); server.close();
  process.exit(bad.length ? 1 : 0);
})().catch(e => {
  console.log(JSON.stringify(results, null, 1));
  console.error("REGRESSION ABORTED:", e.message); process.exit(1);
});
