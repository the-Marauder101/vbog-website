// HARNESS — the parts every suite needs, defined once.
//
// Four suites were each about to carry their own copy of "serve the directory,
// launch Chromium, route Supabase through Node, sign in, collect results". That
// is the same shape as four files defining `v_console_clean` (§7ab): the copies
// do not stay identical, and the one that drifts is the one you are not reading
// when a test goes red. So it lives here.
//
// WHY THE ROUTE HANDLER EXISTS. Chromium in this container does not use the
// egress proxy, so a page's own fetch to Supabase or to a font CDN dies at TLS.
// Every such request is intercepted and replayed through Node's fetch, which
// does use the proxy, then fulfilled. Without this nothing loads at all and
// every suite fails for a reason that has nothing to do with the code.
const { chromium } = require("/opt/node22/lib/node_modules/playwright");
const http = require("http"), fs = require("fs"), path = require("path");

const ROOT = path.resolve(__dirname, "..");
const CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };

// No default credentials. A password committed to a repository is a live
// password, and a staff account reads every candidate's scores. Create a login
// through the Team panel, then:
//   NIKASH_QA_EMAIL=… NIKASH_QA_PASSWORD=… node test/<suite>.js
// Suites that drive the add-staff form need an ADMIN login; they say so.
function credentials() {
  const E = process.env.NIKASH_QA_EMAIL, P = process.env.NIKASH_QA_PASSWORD;
  if (!E || !P) {
    console.error("Set NIKASH_QA_EMAIL and NIKASH_QA_PASSWORD (a staff login).");
    process.exit(2);
  }
  return { E, P };
}

function serve(port) {
  const server = http.createServer((q, r) => {
    const u = q.url.split("?")[0];
    const f = path.join(ROOT, u === "/" ? "index.html" : u);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
    r.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "text/plain" });
    r.end(fs.readFileSync(f));
  });
  return new Promise(res => server.listen(port, () => res(server)));
}

async function route(page) {
  await page.route(/supabase\.co|fonts\.googleapis|fonts\.gstatic|api\.fontshare/, async r => {
    try {
      const q = r.request();
      const res = await fetch(q.url(), { method: q.method(), headers: q.headers(), body: q.postData() || undefined });
      r.fulfill({
        status: res.status,
        headers: {
          "content-type": res.headers.get("content-type") || "application/json",
          "access-control-allow-origin": "*",
        },
        body: Buffer.from(await res.arrayBuffer()),
      });
    } catch (e) { r.abort(); }
  });
}

// ── Talking to the database from inside the page ────────────────────────────
// Deliberately through the page rather than through Node: it uses the same
// publishable key, the same session token and the same RLS path the real app
// uses. A test that reaches the database by a privileged side door proves
// nothing about what a signed-in member of staff can actually see.
const rest = (p, q) => p.evaluate(async (q) => {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${q}`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${sessionStorage.getItem("nikash_token")}` } });
  const t = await r.text(); try { return JSON.parse(t); } catch { return t; }
}, q);

const rpc = (p, fn, args) => p.evaluate(async ([fn, args]) => {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${sessionStorage.getItem("nikash_token")}`,
               "Content-Type": "application/json" },
    body: JSON.stringify(args || {}) });
  const t = await r.text();
  try { return { status: r.status, body: JSON.parse(t) }; } catch { return { status: r.status, body: t }; }
}, [fn, args]);

// The same call with no session at all — the anon key as its own bearer, which
// is exactly what a stranger with the published key has.
const anonRpc = (p, fn, args) => p.evaluate(async ([fn, args]) => {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
               "Content-Type": "application/json" },
    body: JSON.stringify(args || {}) });
  return r.status;
}, [fn, args]);

const anonRows = (p, tbl) => p.evaluate(async (tbl) => {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${tbl}?select=*&limit=1`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } });
  const j = await r.json().catch(() => null);
  return { status: r.status, rows: Array.isArray(j) ? j.length : 0 };
}, tbl);

const insert = (p, tbl, row) => p.evaluate(async ([tbl, row]) => {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${tbl}`, {
    method: "POST",
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${sessionStorage.getItem("nikash_token")}`,
               "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(row) });
  const t = await r.text(); try { return { status: r.status, body: JSON.parse(t) }; } catch { return { status: r.status, body: t }; }
}, [tbl, row]);

const flat = (s) => String(s || "").replace(/\s+/g, " ");

// ── Signing in ─────────────────────────────────────────────────────────────
async function signIn(p, base, E, P) {
  await p.goto(`${base}/nikash.html`, { waitUntil: "domcontentloaded" });
  await p.waitForSelector("#v-signin:not([hidden])", { timeout: 20000 });
  await p.fill("#si-email", E); await p.fill("#si-pass", P);
  await p.click("#btn-signin");
  await p.waitForSelector("#v-reqs:not([hidden])", { timeout: 25000 });
}

// ── Running a suite ────────────────────────────────────────────────────────
// `body` gets everything it needs and returns nothing; `cleanup` ALWAYS runs.
//
// A suite that only tidies up when it passes tidies up on exactly the runs
// where it did not need to. One aborted run of an earlier suite left three
// synthetic candidates behind and broke a different suite on the next pass, so
// cleanup is in a `finally` and its result is itself asserted.
async function suite(name, port, body, cleanup) {
  const { E, P } = credentials();
  const results = [];
  const check = (n, pass, detail) => results.push({ name: n, pass: !!pass, detail: String(detail == null ? "" : detail) });

  const server = await serve(port);
  const b = await chromium.launch({ executablePath: CHROME });
  const ctx = await b.newContext({ viewport: { width: 1360, height: 1200 } });
  const p = await ctx.newPage();
  await route(p);
  const errs = [];
  p.on("pageerror", e => errs.push(e.message));
  p.on("dialog", d => d.accept());

  const base = `http://127.0.0.1:${port}`;
  let aborted = null;
  try {
    await body({ p, ctx, b, base, E, P, check, errs, results });
  } catch (e) {
    aborted = e;
  } finally {
    if (cleanup) {
      try { await cleanup({ p, base, check, E, P }); }
      catch (e) { check("cleanup ran", false, e.message); }
    }
    console.log(JSON.stringify(results, null, 1));
    const bad = results.filter(r => !r.pass);
    if (aborted) console.error(`${name} ABORTED: ${aborted.message}`);
    // The abort marker goes on the SAME line as the count. An earlier run of the
    // ASK suite printed "43/43 passed" underneath its own abort notice, and
    // 43/43 is what a person reading the tail of the output takes away — even
    // though eight assertions after the abort never ran at all. A count of what
    // was checked is not a result unless it says whether the run finished.
    console.error(`${results.length - bad.length}/${results.length} passed` +
                  (aborted ? "  — RUN DID NOT FINISH, assertions after the abort never ran" : ""));
    await b.close().catch(() => {});
    server.close();
    process.exit(aborted || bad.length ? 1 : 0);
  }
}

module.exports = { suite, signIn, route, serve, credentials, rest, rpc, anonRpc, anonRows, insert, flat, ROOT, CHROME };
