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
const { suite, rest, rpc, flat } = require("./harness");

// The server, the browser, the Supabase route handler, the credentials check and
// the sign-in all live in ./harness.js — five suites needed them and five copies
// would not have stayed identical. See the note at the top of that file.
suite("REGRESSION", 8099, async ({ p, base, E, P, check, errs }) => {
  const B = base;

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
    const g = async (v) => { const r = await fetch(
      `${SUPABASE_URL}/rest/v1/${v}${v.includes("?") ? "&" : "?"}select=*`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${sessionStorage.getItem("nikash_token")}` } });
      const j = await r.json(); return Array.isArray(j) ? j.length : -1; };
    // `?ours=is.true` — the audits now cover every table in the database, and a
    // second system (34 pravah_* tables) shares this project. What this repo can
    // be held to is its own tables; the neighbour's rows are reported by
    // v_foreign_policy_audit rather than failing a suite that cannot fix them.
    return { bypass: await g("v_rls_bypass_audit?ours=is.true"),
             c10: await g("v_c10_audit?ours=is.true"),
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

  // This suite reads; it creates nothing, so there is nothing to delete. Saying
  // so beats an empty cleanup block that reads like an omission.
}, async ({ check }) => {
  check("the suite created no fixtures to clean up", true, "read-only pass");
});
