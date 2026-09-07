// APPLY — the one open link, and the fact that it is a door anybody can push.
//
// Every other write in this system is made by a member of staff or by somebody
// holding a token minted for them by name. `open_link_apply()` is the exception:
// it is anon-callable and it INSERTS. So most of this file is not "does it work"
// — it is the four things that hold it shut, each exercised the way somebody
// abusing it would.
//
// The whole flow is driven through the PUBLISHABLE key with no session, because
// that is exactly what an applicant has.
//
// Run: NIKASH_QA_EMAIL=… NIKASH_QA_PASSWORD=… node test/apply.js   (admin login)
const { suite, signIn, rpc, rest, anonRpc, flat } = require("./harness");
const CFG = require("fs").readFileSync(require("path").join(__dirname, "..", "js", "config.js"), "utf8");
const URL_ = (CFG.match(/SUPABASE_URL\s*=\s*"([^"]+)"/) || [])[1];
const KEY = (CFG.match(/SUPABASE_ANON_KEY\s*=\s*"([^"]+)"/) || [])[1];

// The applicant's own client: published key as its own bearer, no session.
const call = async (fn, args) => {
  const r = await fetch(`${URL_}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(args || {}) });
  const t = await r.text();
  let body; try { body = JSON.parse(t); } catch { body = t; }
  return { status: r.status, ok: r.status >= 200 && r.status < 300, body };
};

const STAMP = Date.now();
const NAME = `ZZ_QA Apply ${STAMP}`;
let linkId = null;

suite("APPLY SUITE", 8105, async ({ p, base, E, P, check, errs }) => {
  await signIn(p, base, E, P);

  // ══ MINTING ══════════════════════════════════════════════════════════════
  const made = await rpc(p, "create_open_link",
    { p_label: NAME, p_valid_days: 30, p_max_uses: 3, p_burst_per_hour: 40 });
  check("an admin can create a public application link",
        made.status === 200 && made.body.slug, `HTTP ${made.status}`);
  const slug = made.body.slug;
  linkId = made.body.id;

  check("the slug is long enough not to be guessed",
        typeof slug === "string" && slug.length >= 24, `${(slug || "").length} chars`);
  const noLabel = await rpc(p, "create_open_link", { p_label: "  " });
  check("a link without a label is refused — you will have several",
        noLabel.status >= 400 && /label/.test(JSON.stringify(noLabel.body)),
        JSON.stringify(noLabel.body).slice(0, 80));

  // ══ WHAT A STRANGER SEES ═════════════════════════════════════════════════
  const open = await call("get_open_link", { p_slug: slug });
  check("the link says it is open, and what it is for, with no session at all",
        open.ok && open.body.ok === true && open.body.label === NAME,
        JSON.stringify(open.body).slice(0, 90));
  check("and it returns nothing else — no counts, no ids, no candidates",
        Object.keys(open.body).sort().join(",") === "label,ok",
        Object.keys(open.body).join(","));

  const bogus = await call("get_open_link", { p_slug: "not-a-real-slug" });
  check("an unknown slug gets the same shape as a closed one, not an error",
        bogus.ok && bogus.body.ok === false && !!bogus.body.reason,
        JSON.stringify(bogus.body).slice(0, 90));

  // ══ APPLYING ═════════════════════════════════════════════════════════════
  const email = `zz.qa.${STAMP}@example.com`;
  const first = await call("open_link_apply",
    { p_slug: slug, p_name: `${NAME} One`, p_email: ` ${email.toUpperCase()} ` });
  check("APPLYING RETURNS A TEST TOKEN AND NOTHING ELSE",
        first.ok && first.body.ok === true && typeof first.body.token === "string" &&
        first.body.token.length > 8,
        JSON.stringify(first.body).slice(0, 110));
  check("and it does not leak a candidate id, a score or a count",
        !("candidate_id" in first.body) && !("id" in first.body) &&
        !JSON.stringify(first.body).match(/score|pct|composite/i),
        Object.keys(first.body).join(","));

  // The token has to actually work, or the page redirects into a dead end.
  const started = await call("start_assessment", { p_token: first.body.token });
  check("the token they get is refused until they consent, like every other one",
        started.status >= 400 && /consent has not been recorded/i.test(JSON.stringify(started.body)),
        `HTTP ${started.status}`);
  await call("record_consent", { p_token: first.body.token });
  const go = await call("start_assessment", { p_token: first.body.token });
  check("and then opens the same 44-item assessment everybody else takes",
        go.ok && (go.body.items || []).length === 44,
        `${((go.body || {}).items || []).length} items`);

  // ══ THEY LAND WITH EVERYBODY ELSE ════════════════════════════════════════
  const inQueue = await rest(p, `v_candidate_queue?select=id,full_name&full_name=eq.${encodeURIComponent(NAME + " One")}`);
  check("the applicant is in the same candidate queue as everybody else",
        Array.isArray(inQueue) && inQueue.length === 1, `${(inQueue || []).length} rows`);
  const row = await rest(p, `candidates?select=id,source,contact&full_name=eq.${encodeURIComponent(NAME + " One")}`);
  check("with their email stored, lowercased and trimmed",
        row[0] && row[0].contact.email === email, JSON.stringify(row[0] && row[0].contact));
  check("and where they came from recorded",
        row[0] && row[0].source === "open_link", (row[0] || {}).source);

  // ══ 1. DEDUPE — THE SAME PERSON IS ONE CANDIDATE ═════════════════════════
  const again = await call("open_link_apply",
    { p_slug: slug, p_name: "Someone Else Entirely", p_email: email });
  check("APPLYING TWICE WITH ONE EMAIL DOES NOT CREATE A SECOND CANDIDATE",
        again.ok && again.body.returning === true,
        JSON.stringify(again.body).slice(0, 90));
  check("and hands back the SAME token, so they resume rather than restart",
        again.body.token === first.body.token, "");
  const dupes = await rest(p, `candidates?select=id&contact->>email=eq.${email}`);
  check("one email, one row",
        Array.isArray(dupes) && dupes.length === 1, `${(dupes || []).length} rows`);
  check("and a second application cannot rename the person",
        (await rest(p, `candidates?select=full_name&contact->>email=eq.${email}`))[0].full_name
          === `${NAME} One`, "");

  // ══ 2. RUBBISH IS REFUSED ════════════════════════════════════════════════
  const junk = {
    shortName: await call("open_link_apply", { p_slug: slug, p_name: "A", p_email: `zz.a.${STAMP}@example.com` }),
    noAt: await call("open_link_apply", { p_slug: slug, p_name: "ZZ_QA Nope", p_email: "nope" }),
    spaceEmail: await call("open_link_apply", { p_slug: slug, p_name: "ZZ_QA Nope", p_email: "a b@c.com" }),
    empty: await call("open_link_apply", { p_slug: slug, p_name: "", p_email: "" }),
  };
  check("a one-character name, a malformed email and a blank form are all refused",
        Object.values(junk).every(r => r.status >= 400),
        JSON.stringify(Object.fromEntries(Object.entries(junk).map(([k, v]) => [k, v.status]))));

  // ══ 3. THE CAP CLOSES THE LINK ═══════════════════════════════════════════
  await call("open_link_apply", { p_slug: slug, p_name: `${NAME} Two`, p_email: `zz.qa.2.${STAMP}@example.com` });
  await call("open_link_apply", { p_slug: slug, p_name: `${NAME} Three`, p_email: `zz.qa.3.${STAMP}@example.com` });
  const overCap = await call("open_link_apply",
    { p_slug: slug, p_name: `${NAME} Four`, p_email: `zz.qa.4.${STAMP}@example.com` });
  check("a link capped at three refuses the fourth applicant",
        overCap.status >= 400 && /number of applicants/.test(JSON.stringify(overCap.body)),
        JSON.stringify(overCap.body).slice(0, 90));
  check("and says so before they type, not after",
        (await call("get_open_link", { p_slug: slug })).body.ok === false, "");

  // The one that matters more than the cap: somebody who already started must
  // still get back in after the link fills up. They are not a new applicant.
  const returner = await call("open_link_apply",
    { p_slug: slug, p_name: `${NAME} One`, p_email: email });
  check("BUT SOMEBODY WHO ALREADY STARTED STILL GETS BACK IN",
        returner.ok && returner.body.returning === true &&
        returner.body.token === first.body.token,
        JSON.stringify(returner.body).slice(0, 90));

  // ══ 4. THE OFF SWITCH ════════════════════════════════════════════════════
  const shut = await rpc(p, "set_open_link_active", { p_id: linkId, p_active: false });
  check("an admin can close a link immediately", shut.status === 200, `HTTP ${shut.status}`);
  const afterShut = await call("open_link_apply",
    { p_slug: slug, p_name: `${NAME} Five`, p_email: `zz.qa.5.${STAMP}@example.com` });
  check("and a closed link accepts nothing, not even a returning applicant",
        afterShut.status >= 400 && /not open/.test(JSON.stringify(afterShut.body)),
        JSON.stringify(afterShut.body).slice(0, 90));
  await rpc(p, "set_open_link_active", { p_id: linkId, p_active: true });

  // ══ IT READS NOTHING ═════════════════════════════════════════════════════
  // The two anon-callable functions are the only new public surface. Neither may
  // become a way to enumerate candidates or reach a score.
  const reach = {
    list: await anonRpc(p, "list_open_links", {}),
    create: await anonRpc(p, "create_open_link", { p_label: "x" }),
    close: await anonRpc(p, "set_open_link_active", { p_id: linkId, p_active: false }),
    links: await anonRpc(p, "get_candidate_links", { p_candidate_id: row[0].id }),
    detail: await anonRpc(p, "get_candidate_detail", { p_candidate_id: row[0].id }),
    revoke: await anonRpc(p, "revoke_assessment_token", { p_token: first.body.token }),
  };
  check("nothing around the link is callable without a session",
        Object.values(reach).every(s => s >= 400), JSON.stringify(reach));

  const tables = ["open_links", "open_link_uses"];
  const seen = [];
  for (const t of tables) {
    const r = await fetch(`${URL_}/rest/v1/${t}?select=*&limit=1`,
      { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
    const j = await r.json().catch(() => null);
    if (r.status < 400 && Array.isArray(j) && j.length) seen.push(t);
  }
  check("and the link tables return nothing to the published key",
        seen.length === 0, seen.join(", ") || "both closed");

  check("the new anon functions are on the allowlist with a written reason",
        (await rest(p, "anon_callable?select=proname,why&proname=in.(get_open_link,open_link_apply)"))
          .filter(a => a.why && a.why.length > 30).length === 2, "");

  // ══ THE STAFF VIEW ═══════════════════════════════════════════════════════
  const listed = await rpc(p, "list_open_links", {});
  const mine = (listed.body || []).find(l => l.id === linkId);
  check("the link list shows how many applied and how many finished",
        mine && mine.used === 3 && typeof mine.completed === "number",
        JSON.stringify(mine && { used: mine.used, completed: mine.completed, cap: mine.max_uses }));

  await p.goto(`${base}/nikash.html`, { waitUntil: "domcontentloaded" });
  await p.waitForSelector("#v-reqs:not([hidden])", { timeout: 25000 });
  await p.click("#nav-links");
  await p.waitForSelector("#v-links:not([hidden])", { timeout: 20000 });
  await p.waitForTimeout(900);
  const panel = flat(await p.textContent("#v-links"));
  check("the Apply links screen lists them with a copyable URL",
        panel.includes(NAME) &&
        (await p.$$("#ol-list input[readonly]")).length >= 1, panel.slice(0, 110));
  check("and explains that these are separate from the per-candidate test links",
        /per-candidate test links you send\s*yourself are unchanged/.test(panel), "");

  // ══ THE APPLICANT'S PAGE ═════════════════════════════════════════════════
  // Its own link, uncapped. The one above is deliberately full by this point, so
  // reusing it would test the closed screen and call it the open one.
  const uiLink = await rpc(p, "create_open_link",
    { p_label: `${NAME} UI`, p_valid_days: 30, p_max_uses: null, p_burst_per_hour: 40 });
  const uiSlug = uiLink.body.slug;

  const ap = await p.context().newPage();
  await require("./harness").route(ap);
  const aerrs = []; ap.on("pageerror", e => aerrs.push(e.message));
  await ap.goto(`${base}/apply.html?k=${uiSlug}`, { waitUntil: "domcontentloaded" });
  await ap.waitForSelector("#screen-form:not([hidden]), #screen-closed:not([hidden])", { timeout: 25000 });
  check("the apply page opens for a stranger with no session",
        await ap.isVisible("#screen-form"),
        flat(await ap.textContent("#screen-closed").catch(() => "")).slice(0, 90));
  const form = flat(await ap.textContent("#screen-form"));
  check("it asks for exactly two things and says how long the test takes",
        (await ap.$$("#screen-form input")).length === 2 && /25 minutes/.test(form),
        `${(await ap.$$("#screen-form input")).length} inputs`);
  check("and warns that consent comes before any question",
        /agree to how your answers are used before any\s*question/.test(form), "");
  check("no score, no dimension and no candidate name is on the page",
        !/\b(CLS_[CF]|CCH|DSC|DRV|RES|INT|MOT|STY)\b/.test(form) && !form.includes(email),
        "");
  check("no JS errors on the applicant's page", aerrs.length === 0, aerrs.join(" | "));

  await ap.fill("#ap-name", "A");
  await ap.click("#btn-apply");
  await ap.waitForTimeout(400);
  check("a bad name is caught on the page before it reaches the server",
        await ap.isVisible("#ap-error"), flat(await ap.textContent("#ap-error")));

  // And the whole way through: name, email, into the assessment.
  await ap.fill("#ap-name", `${NAME} Six`);
  await ap.fill("#ap-email", `zz.qa.6.${STAMP}@example.com`);
  await ap.click("#btn-apply");
  await ap.waitForURL(/assess\.html\?t=/, { timeout: 25000 }).catch(() => {});
  check("APPLYING ON THE PAGE LANDS THEM IN THE ASSESSMENT",
        /assess\.html\?t=/.test(ap.url()), ap.url().slice(-60));
  await ap.waitForSelector("#screen-consent:not([hidden]), #screen-item:not([hidden])",
                           { timeout: 25000 });
  check("and the first thing they see is the consent notice",
        await ap.isVisible("#screen-consent"), "");
  await ap.close();

  check("no JS errors", errs.length === 0, errs.join(" | "));
}, async ({ p, check }) => {
  // ── CLEANUP, on every path ────────────────────────────────────────────────
  const left = await p.evaluate(async (name) => {
    const H = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${sessionStorage.getItem("nikash_token")}`,
                "Content-Type": "application/json" };
    const cands = await (await fetch(
      `${SUPABASE_URL}/rest/v1/candidates?select=id&full_name=like.ZZ_QA%20Apply*`, { headers: H })).json();
    for (const c of (Array.isArray(cands) ? cands : [])) {
      await fetch(`${SUPABASE_URL}/rest/v1/rpc/purge_candidate`, {
        method: "POST", headers: H, body: JSON.stringify({ p_candidate_id: c.id }) });
    }
    await fetch(`${SUPABASE_URL}/rest/v1/open_links?label=like.ZZ_QA%20Apply*`,
                { method: "DELETE", headers: H });
    const stillC = await (await fetch(
      `${SUPABASE_URL}/rest/v1/candidates?select=id&full_name=like.ZZ_QA%20Apply*`, { headers: H })).json();
    const stillL = await (await fetch(
      `${SUPABASE_URL}/rest/v1/open_links?select=id&label=like.ZZ_QA%20Apply*`, { headers: H })).json();
    return { candidates: (stillC || []).length, links: (stillL || []).length };
  }, NAME);
  check("the suite deletes its own applicants and its own link",
        left.candidates === 0 && left.links === 0,
        `${left.candidates} candidates, ${left.links} links left`);
});
