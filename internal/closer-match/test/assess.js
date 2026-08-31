// ASSESSMENT — the candidate journey, end to end, by the door a candidate uses.
//
// This is the only surface in Nikash used by someone who is not staff, has no
// account, and will never see the result. Everything about it is load-bearing:
// the consent gate, the fact that scores are computed only after submission,
// the block boundary that Back cannot cross, and the rule that a submitted link
// does not hand out a fresh test.
//
// The suite drives the candidate path through the PUBLISHABLE key and a token,
// with no session — because that is exactly what a candidate has. A test that
// reaches this flow through a staff session proves nothing about it.
//
// Run: NIKASH_QA_EMAIL=… NIKASH_QA_PASSWORD=… node test/assess.js
const { suite, signIn, rpc, insert, flat } = require("./harness");
const CFG = require("fs").readFileSync(require("path").join(__dirname, "..", "js", "config.js"), "utf8");
const URL_ = (CFG.match(/SUPABASE_URL\s*=\s*"([^"]+)"/) || [])[1];
const KEY = (CFG.match(/SUPABASE_ANON_KEY\s*=\s*"([^"]+)"/) || [])[1];

// The candidate's own client: anon key as its own bearer, a token for identity.
const call = async (fn, args) => {
  const r = await fetch(`${URL_}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(args || {}) });
  const t = await r.text();
  let body; try { body = JSON.parse(t); } catch { body = t; }
  // 204 is a success here. A void RPC returns no content, and treating "not 200"
  // as failure is how the first run of this suite reported twelve red checks off
  // one save that had in fact worked.
  return { status: r.status, ok: r.status >= 200 && r.status < 300, body };
};

const NAME = `ZZ_QA Assess ${Date.now()}`;
let candId = null, token = null;

suite("ASSESS SUITE", 8101, async ({ p, base, E, P, check, errs }) => {
  await signIn(p, base, E, P);

  // ══ A CANDIDATE AND A LINK ═══════════════════════════════════════════════
  const made = await insert(p, "candidates", {
    full_name: NAME, contact: {}, consent_version: "pending",
    consent_at: new Date().toISOString(),
  });
  candId = Array.isArray(made.body) && made.body[0] && made.body[0].id;
  check("staff can create a candidate", !!candId, `HTTP ${made.status}`);
  if (!candId) throw new Error("no candidate to test with");

  const tok = await rpc(p, "issue_assessment_token", { p_candidate_id: candId, p_valid_days: 1 });
  token = typeof tok.body === "string" ? tok.body.replace(/^"|"$/g, "") : tok.body;
  check("and issue an assessment link", typeof token === "string" && token.length > 8, `HTTP ${tok.status}`);

  // ══ THE CANDIDATE PAGE BEFORE THERE ARE ANY SCORES ═══════════════════════
  // The state this suite's own candidate is in right now — created, no
  // questionnaire — is the normal state of every candidate at R1 and R2, because
  // ASK runs BEFORE the questionnaire in the pipeline it serves.
  //
  // This was not tested, and the feature was broken in it. `regression.js`
  // asserts the ASK region exists on the candidate page, but it deliberately
  // opens a row that has a score strip so its nine-dimension assertions have
  // something to read. Every ASK assertion therefore ran against the one state
  // where ASK already worked, while the console returned early on `!d.scored`
  // and never rendered the region for anybody else. See sql/39.
  const detailUnscored = await rpc(p, "get_candidate_detail", { p_candidate_id: candId });
  check("an unscored candidate's detail still carries the ASK keys",
        detailUnscored.body && detailUnscored.body.scored === false &&
        Array.isArray(detailUnscored.body.ask) && "ask_overlap" in detailUnscored.body,
        `scored=${(detailUnscored.body || {}).scored} ask=${JSON.stringify((detailUnscored.body || {}).ask)}`);
  check("and still says why there are no scores",
        !!(detailUnscored.body || {}).reason, (detailUnscored.body || {}).reason);

  await p.click("#nav-queue");
  await p.waitForSelector("#v-queue:not([hidden])", { timeout: 20000 });
  await p.waitForTimeout(1500);
  await p.click(`#queue-list [data-cand="${candId}"]`);
  await p.waitForSelector("#v-cand:not([hidden])", { timeout: 20000 });
  await p.waitForTimeout(900);
  const unscoredPage = flat(await p.textContent("#cd-body"));

  check("THE CANDIDATE PAGE OFFERS THE R2 INTERVIEW BEFORE ANY QUESTIONNAIRE",
        /ASK interview/.test(unscoredPage) &&
        (await p.$$(`#cd-body a[href*="ask.html"][href*="round=r2"]`)).length > 0,
        unscoredPage.slice(0, 130));
  check("and the R1 phone screen too",
        (await p.$$(`#cd-body a[href*="ask.html"][href*="round=r1"]`)).length > 0, "");
  check("it explains what the two rounds are, to somebody running one for the first time",
        /15-question phone screen/.test(unscoredPage) && /full 42/.test(unscoredPage), "");
  check("the page is honest that there are no questionnaire scores",
        /No questionnaire scores yet/.test(unscoredPage) &&
        /not opened their assessment link/.test(unscoredPage), "");
  check("and shows no dimension, match or flag it does not have",
        (await p.$$("#cd-body .dim")).length === 0 &&
        !/Against the open roles/.test(unscoredPage), "");
  check("the stated facts are still editable at this stage",
        (await p.$$("#df-region [data-df]")).length >= 4,
        `${(await p.$$("#df-region [data-df]")).length} fields`);

  // The queue row itself, so an interviewer does not have to open a candidate.
  await p.click("#nav-queue");
  await p.waitForSelector("#v-queue:not([hidden])", { timeout: 20000 });
  await p.waitForTimeout(1200);
  check("and the queue row itself offers to start an interview",
        (await p.$$(`#queue-list a[href*="ask.html"][href*="round=r2"]`)).length > 0, "");
  check("with the row saying no interview has happened yet",
        /no ASK interview yet/.test(flat(await p.textContent("#queue-list"))), "");

  // ══ THE CONSENT GATE ═════════════════════════════════════════════════════
  // Nothing about a person is collected before they have agreed to it. The gate
  // is in the database, not in the page, so that closing the page and calling
  // the RPC directly does not get around it.
  const before = await call("start_assessment", { p_token: token });
  check("the test refuses to start before consent is recorded",
        before.status >= 400 && /consent has not been recorded/i.test(JSON.stringify(before.body)),
        `HTTP ${before.status}`);

  const notice = await call("get_consent_notice", {});
  check("but the consent notice itself is readable without consenting",
        notice.ok, `HTTP ${notice.status}`);
  const noticeText = JSON.stringify(notice.body);
  check("and the notice has no unfilled placeholders",
        !/\[[A-Z_ ]{3,}\]|TBD|XXXX|<firm>/i.test(noticeText),
        (noticeText.match(/\[[A-Z_ ]{3,}\]/) || [""])[0]);

  await call("record_consent", { p_token: token });
  const started = await call("start_assessment", { p_token: token });
  check("and starts once consent is recorded", started.ok, `HTTP ${started.status}`);

  const items = (started.body && started.body.items) || [];
  check("the whole bank is served in one sitting", items.length === 44, `${items.length} items`);
  check("every item carries a stem and its options",
        items.length > 0 && items.every(i => i.stem && Array.isArray(i.options) && i.options.length >= 2),
        `${items.filter(i => !i.stem || !(i.options || []).length).length} malformed`);

  // ══ NOTHING NAMES ITS OWN PURPOSE ════════════════════════════════════════
  // A block called "integrity check" tells the candidate exactly which answers
  // to fake. The rule is in js/assess.js's header; this is what enforces it.
  const blockText = JSON.stringify(items.map(i => [i.block, i.framing_note, i.stem]));
  check("no block announces itself as an honesty or personality check",
        !/honesty|integrity check|personality (test|check)|lie scale|social desirability/i.test(blockText),
        (blockText.match(/honesty|integrity check|personality test|lie scale/i) || [""])[0]);

  // ══ THE OPTION ORDER IS PER SESSION ══════════════════════════════════════
  // Two different sessions must see a shufflable item's options in different
  // orders, or the shuffle is decorative. Seeded on (item, session), so it is
  // stable within a sitting and different between them.
  const shufflable = items.filter(i => i.format === "sjt" || i.format === "forced_choice");
  check("most of the bank is shufflable", shufflable.length >= 30, `${shufflable.length} of ${items.length}`);

  const orderNow = shufflable.slice(0, 12).map(i => i.options.map(o => o.key).join(""));
  const again = await call("start_assessment", { p_token: token });
  const sameSitting = ((again.body && again.body.items) || [])
    .filter(i => i.format === "sjt" || i.format === "forced_choice")
    .slice(0, 12).map(i => i.options.map(o => o.key).join(""));
  check("the order is stable within one sitting",
        JSON.stringify(orderNow) === JSON.stringify(sameSitting),
        `${orderNow.filter((x, n) => x !== sameSitting[n]).length} of 12 moved`);

  check("and it is not the bank's own order for every item",
        orderNow.some(o => o !== [...o].sort().join("")),
        orderNow.slice(0, 4).join(" "));

  // ══ ANSWERING, AND RESUMING ══════════════════════════════════════════════
  // Deliberately a spread of scores rather than one value, so this candidate
  // does not trip the flat-scoring flag that a later assertion checks fires on
  // a candidate who deserves it.
  const half = items.slice(0, 20);
  for (const it of half) {
    const pick = it.options[(it.sort_order || 0) % it.options.length];
    const r = await call("save_response", {
      p_token: token, p_item_id: it.id, p_option_key: pick.key,
      p_seconds: 9 + ((it.sort_order || 0) % 7),
      // A lie. The client does not get to say where the option was shown; the
      // server derives it. If this number survived, position_bias() would be
      // reporting whatever a careless answerer's browser chose to send.
      p_position: 99,
    });
    if (!r.ok) { check("saving an answer works", false, `HTTP ${r.status} on ${it.id}`); break; }
  }
  check("answers save one at a time", true, `${half.length} saved`);

  const resumed = await call("start_assessment", { p_token: token });
  const answered = (resumed.body && resumed.body.answered) || {};
  check("reopening the link resumes with every answer still there",
        Object.keys(answered).length === half.length,
        `${Object.keys(answered).length} of ${half.length}`);
  check("and the answers are the ones that were given",
        half.every(it => answered[it.id] !== undefined),
        `${half.filter(it => answered[it.id] === undefined).length} lost`);

  // ══ THE CLIENT DOES NOT GET TO SAY WHERE AN OPTION WAS ═══════════════════
  const pos = await rpc(p, "get_candidate_detail", { p_candidate_id: candId });
  const positions = await p.evaluate(async ([id]) => {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/candidate_responses?select=position_shown&limit=200`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${sessionStorage.getItem("nikash_token")}` } });
    const j = await r.json(); return Array.isArray(j) ? j.map(x => x.position_shown) : [];
  }, [candId]);
  check("the position an option was shown at is derived, not accepted from the browser",
        !positions.includes(99), `${positions.filter(x => x === 99).length} rows carry the value we sent`);

  // ══ SUBMIT REFUSES WHILE INCOMPLETE ══════════════════════════════════════
  const early = await call("finish_assessment", { p_token: token });
  check("submitting an incomplete test does not complete it",
        early.ok && early.body && early.body.complete === false,
        JSON.stringify(early.body).slice(0, 90));
  check("and it says how many are left rather than just refusing",
        early.body && early.body.expected - early.body.answered === items.length - half.length,
        `${early.body && early.body.answered}/${early.body && early.body.expected}`);

  const profileEarly = await p.evaluate(async (id) => {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/candidate_profile?select=scores&candidate_id=eq.${id}`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${sessionStorage.getItem("nikash_token")}` } });
    const j = await r.json(); return Array.isArray(j) ? j.length : -1;
  }, candId);
  check("and no score exists for a test that was never submitted", profileEarly === 0, `${profileEarly} rows`);

  // ══ THE UI, ON THE LINK ITSELF ═══════════════════════════════════════════
  const cp = await p.context().newPage();
  await require("./harness").route(cp);
  const cerrs = []; cp.on("pageerror", e => cerrs.push(e.message));
  await cp.goto(`${base}/assess.html?t=${token}`, { waitUntil: "domcontentloaded" });
  await cp.waitForSelector("#screen-item:not([hidden]), #screen-block:not([hidden])", { timeout: 25000 });
  await cp.waitForTimeout(600);

  if (await cp.isVisible("#screen-block")) await cp.click("#btn-block-go");
  await cp.waitForSelector("#screen-item:not([hidden])", { timeout: 20000 });

  check("the link resumes on screen at the first unanswered question",
        /Question 21 of 44/.test(flat(await cp.textContent("#counter"))),
        flat(await cp.textContent("#counter")));

  check("Back cannot cross into the block before it",
        await cp.evaluate(() => { const b = document.getElementById("btn-back");
          return b.disabled || b.hidden || getComputedStyle(b).display === "none"; }), "");

  const shown = flat(await cp.textContent("#screen-item"));
  check("the candidate is never shown a score, a dimension code or a right answer",
        !/\b(CLS_[CF]|CCH|DSC|DRV|RES|INT|MOT|STY)\b/.test(shown) &&
        !/correct answer|score|points|best answer/i.test(shown),
        (shown.match(/CLS_[CF]|CCH|score|points/i) || [""])[0]);

  check("and the page carries no JS errors", cerrs.length === 0, cerrs.join(" | "));
  await cp.close();

  // ══ FINISH IT ════════════════════════════════════════════════════════════
  for (const it of items.slice(20)) {
    const pick = it.options[((it.sort_order || 0) + 1) % it.options.length];
    await call("save_response", { p_token: token, p_item_id: it.id, p_option_key: pick.key, p_seconds: 11 });
  }
  const done = await call("finish_assessment", { p_token: token });
  check("a complete test submits", done.ok && done.body && done.body.complete === true,
        JSON.stringify(done.body).slice(0, 90));
  check("and it is matched against the open roles on the way out",
        done.body && done.body.matched_requirements > 0 && done.body.failed_requirements === 0,
        JSON.stringify(done.body));

  // ══ A SUBMITTED LINK IS SPENT ════════════════════════════════════════════
  // Until sql/23 reopening a finished link handed out a fresh 44 items and
  // opened a second session, which is how one person ends up with two profiles.
  const after = await call("start_assessment", { p_token: token });
  check("reopening a submitted link does not hand out a fresh test",
        after.ok && after.body && after.body.already_complete === true,
        JSON.stringify(after.body).slice(0, 90));

  const sessions = await p.evaluate(async (id) => {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/assessment_sessions?select=id,completed_at&candidate_id=eq.${id}`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${sessionStorage.getItem("nikash_token")}` } });
    return await r.json();
  }, candId);
  check("one sitting produced exactly one session",
        Array.isArray(sessions) && sessions.length === 1 && !!sessions[0].completed_at,
        `${(sessions || []).length} sessions`);

  const dbl = await p.evaluate(async () => (await (await fetch(
    `${SUPABASE_URL}/rest/v1/v_double_session_audit?select=*`,
    { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${sessionStorage.getItem("nikash_token")}` } })).json()).length);
  check("and the double-session audit stays empty", dbl === 0, `${dbl} rows`);

  // ══ THE SCORE EXISTS NOW, AND IS SHAPED RIGHT ════════════════════════════
  const detail = await rpc(p, "get_candidate_detail", { p_candidate_id: candId });
  const d = detail.body || {};
  // One row per dimension, each carrying its own score and side — not a flat
  // `scores` map. Asserting the shape the function actually returns rather than
  // the one that would be convenient is the whole point of reading it here.
  const dims = d.dimensions || [];
  check("the profile is marked scored", d.scored === true, `scored=${d.scored}`);
  check("all nine dimensions come back", dims.length === 9,
        dims.map(x => x.code).join(","));
  check("every score is a number in range",
        dims.length === 9 && dims.every(x => typeof x.score === "number" && x.score >= 0 && x.score <= 100),
        JSON.stringify(dims.map(x => [x.code, x.score])));
  // `side` is non-null for exactly the two dimensions with no better end, so a
  // surface can render it blindly and get nothing where nothing applies.
  const sided = dims.filter(x => x.side);
  check("exactly the two no-better-end dimensions name a side",
        sided.length === 2 && sided.every(x => x.code === "MOT" || x.code === "STY"),
        sided.map(x => `${x.code}=${x.side}`).join(" "));
  // Poles are a bipolar-only idea: a unipolar dimension has a low end and a high
  // end, not two named ends, and inventing labels for it would be the same
  // mistake as calling one side of MOT better. So the two sets must coincide
  // exactly — every dimension with poles is bipolar, and every bipolar one has
  // both poles and a side.
  const poled = dims.filter(x => x.pole_0 || x.pole_100);
  check("poles are named on exactly the bipolar dimensions, and on no others",
        poled.length === 2 && poled.every(x => x.pole_0 && x.pole_100 && x.kind === "bipolar") &&
        dims.filter(x => x.kind === "bipolar").length === 2,
        poled.map(x => `${x.code}: ${x.pole_0} ↔ ${x.pole_100}`).join(" | "));
  check("and a dimension has a side if and only if it has poles",
        dims.every(x => !!x.side === !!x.pole_0),
        dims.filter(x => !!x.side !== !!x.pole_0).map(x => x.code).join(",") || "consistent");

  // ══ WHAT THE CANDIDATE STILL CANNOT SEE ══════════════════════════════════
  // The token is the candidate's only credential and it must not open anything
  // that carries a judgement of them.
  const leaks = {
    detail: (await call("get_candidate_detail", { p_candidate_id: candId })).status,
    pattern: (await call("response_pattern", { p_session: sessions[0].id })).status,
    report: (await call("get_keying_report", {})).status,
  };
  check("the candidate's own token opens nothing that carries a score",
        Object.values(leaks).every(s => s >= 400), JSON.stringify(leaks));

  // ══ THE CARELESS-ANSWERING FLAGS ACTUALLY FIRE ═══════════════════════════
  // A flag nobody has ever seen fire is a flag nobody knows is wired up. This
  // builds a candidate who answers every scenario the same way and checks the
  // flat-scoring flag catches them — and that it does not fire on the spread
  // answerer above, which is the half that makes it worth having.
  const flatMade = await insert(p, "candidates", {
    full_name: `${NAME} FLAT`, contact: {}, consent_version: "pending",
    consent_at: new Date().toISOString() });
  const flatId = flatMade.body[0].id;
  const ftokR = await rpc(p, "issue_assessment_token", { p_candidate_id: flatId, p_valid_days: 1 });
  const ftok = String(ftokR.body).replace(/^"|"$/g, "");
  await call("record_consent", { p_token: ftok });
  const fstart = await call("start_assessment", { p_token: ftok });
  for (const it of fstart.body.items) {
    // Always the first option on screen — the "just tap down the left" answerer.
    await call("save_response", { p_token: ftok, p_item_id: it.id, p_option_key: it.options[0].key, p_seconds: 2 });
  }
  await call("finish_assessment", { p_token: ftok });

  // `response_pattern()` returns the MEASUREMENTS. The flags themselves are
  // decided in compute_candidate_profile and stored on the profile, so that is
  // where to read them — which also proves they were persisted rather than
  // merely computable, and that is the half that can actually break.
  const pats = await p.evaluate(async ([a, b]) => {
    const H = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${sessionStorage.getItem("nikash_token")}`,
                "Content-Type": "application/json" };
    const g = async (id) => {
      const s = await (await fetch(
        `${SUPABASE_URL}/rest/v1/assessment_sessions?select=id&candidate_id=eq.${id}`, { headers: H })).json();
      const prof = await (await fetch(
        `${SUPABASE_URL}/rest/v1/candidate_profile?select=flags&candidate_id=eq.${id}`, { headers: H })).json();
      const meas = await (await fetch(`${SUPABASE_URL}/rest/v1/rpc/response_pattern`, {
        method: "POST", headers: H, body: JSON.stringify({ p_session: s[0].id }) })).json();
      return { flags: (prof[0] || {}).flags || [], meas };
    };
    return { flatOne: await g(a), spread: await g(b) };
  }, [flatId, candId]);

  // Two separate claims. The measurement crossed the threshold, AND the flag
  // that watches that threshold ended up on the profile. A test that only
  // checked the second would pass on a hard-coded flag.
  check("tapping the first option 44 times in a row is measured as such",
        pats.flatOne.meas.speed.share >= 0.25 &&
        pats.flatOne.meas.rhythm.covering >= pats.flatOne.meas.rhythm.threshold,
        `speed ${pats.flatOne.meas.speed.share}, cycle covering ${pats.flatOne.meas.rhythm.covering}`);
  check("and the flags for it are on the profile",
        pats.flatOne.flags.includes("rushed") && pats.flatOne.flags.includes("zigzag"),
        pats.flatOne.flags.join(","));
  check("the spread answerer is measured below every threshold",
        pats.spread.meas.speed.share < 0.25 &&
        pats.spread.meas.rhythm.covering < pats.spread.meas.rhythm.threshold,
        `speed ${pats.spread.meas.speed.share}, cycle covering ${pats.spread.meas.rhythm.covering}`);
  check("and carries none of the three careless flags",
        !["rushed", "zigzag", "flat_scoring"].some(f => pats.spread.flags.includes(f)),
        pats.spread.flags.join(",") || "no flags");
  check("the flags stay descriptions, not verdicts — no reject column exists",
        (await p.evaluate(async () => (await (await fetch(
          `${SUPABASE_URL}/rest/v1/rpc/run_golden_cases`, { method: "POST",
          headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${sessionStorage.getItem("nikash_token")}`,
                     "Content-Type": "application/json" }, body: "{}" })).json()).filter(g => g.passed).length)) === 19,
        "golden cases still 19/19 after two new candidates");

  check("no JS errors", errs.length === 0, errs.join(" | "));
}, async ({ p, check }) => {
  // ── CLEANUP, on every path ────────────────────────────────────────────────
  const left = await p.evaluate(async (name) => {
    const H = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${sessionStorage.getItem("nikash_token")}`,
                "Content-Type": "application/json" };
    const found = await (await fetch(
      `${SUPABASE_URL}/rest/v1/candidates?select=id&full_name=like.ZZ_QA%20Assess*`, { headers: H })).json();
    for (const c of (Array.isArray(found) ? found : [])) {
      await fetch(`${SUPABASE_URL}/rest/v1/rpc/purge_candidate`, {
        method: "POST", headers: H, body: JSON.stringify({ p_candidate_id: c.id }) });
    }
    const still = await (await fetch(
      `${SUPABASE_URL}/rest/v1/candidates?select=id&full_name=like.ZZ_QA%20Assess*`, { headers: H })).json();
    return { purged: (found || []).length, left: (still || []).length };
  }, NAME);
  check("the suite deletes its own candidates, on the failure path too",
        left.left === 0, `${left.purged} purged, ${left.left} left behind`);
});
