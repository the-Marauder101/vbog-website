// INTAKE AND MATCHING — the client's half, and the shortlist it produces.
//
// The bug this suite exists because of: for a while every shortlist in the tool
// said nobody was eligible. Not because the ranking was wrong, but because a
// hard filter with nothing recorded against it counted as a fail. The client had
// asked for "fluent Hindi", no candidate had a language recorded, and the engine
// read silence as "no". **Unknown is not a value**, and the three-state filter —
// pass, fail, not-yet-known — is the fix. Half of this file is about that.
//
// The other half is the derivation rule. `hard_filters` is derived from the
// intake answers BY THE SERVER, from one function, because for a while the
// browser derived its own copy too: saving an unchanged intake wrote the stale
// browser copy back and resurrected a language-splitting bug that had already
// been fixed once. Two definitions of one thing is a race (§7ab).
//
// A client fixture is created, driven, matched and deleted. It is named
// ZZ_FIXTURE so the engine's own fixture-scoping rule keeps it away from real
// candidates — which is itself one of the things asserted here, because a
// fixture requirement once ranked eight real people.
//
// Run: NIKASH_QA_EMAIL=… NIKASH_QA_PASSWORD=… node test/intake.js
const { suite, signIn, rpc, rest, insert, flat } = require("./harness");
const CFG = require("fs").readFileSync(require("path").join(__dirname, "..", "js", "config.js"), "utf8");
const URL_ = (CFG.match(/SUPABASE_URL\s*=\s*"([^"]+)"/) || [])[1];
const KEY = (CFG.match(/SUPABASE_ANON_KEY\s*=\s*"([^"]+)"/) || [])[1];

// The client's own client: published key, an intake token, no account.
const call = async (fn, args) => {
  const r = await fetch(`${URL_}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(args || {}) });
  const t = await r.text();
  let body; try { body = JSON.parse(t); } catch { body = t; }
  return { status: r.status, ok: r.status >= 200 && r.status < 300, body };
};

const BIZ = `ZZ_FIXTURE QA Intake ${Date.now()}`;

// A complete, plausible set of intake answers. The language field is the one
// that matters most: "en, hi" as one string is exactly the input that used to
// become a single required language called "en, hi", which no candidate could
// ever satisfy and which therefore failed everybody silently.
// Every value is the STRING form the browser actually posts, and every numeric
// one is a number in a string — `ticket_size: "mid"` looks reasonable and is
// rejected by the column type. Copied from the shape a real submitted intake
// carries rather than invented, which is the only way to get this right.
const ANSWERS = {
  role_title: "ZZ_QA BDE",
  ticket_size: "150000", cycle_days: "21", leads_per_day: "12",
  buyer_response: "3", comp_band: "9", expected_days_to_first_close: "45",
  top3: ["CLS", "DRV", "RES"],
  bottom3: [],
  has_crm: "true", buyer_is_senior: "true",
  cold_outbound_pct: "40", followup_rate_pct: "50",
  refund_policy_exists: "true", benchmark_source: "none", notes: "",
  hf_locations: "Pune, Mumbai",
  hf_work_mode: "hybrid",
  hf_language: "en, hi",
  hf_min_years: "3",
  hf_join_by_days: "30",
  salary_min: "800000", salary_max: "1200000",
};

suite("INTAKE SUITE", 8103, async ({ p, base, E, P, check, errs }) => {
  await signIn(p, base, E, P);

  // ══ A LINK THE CLIENT CAN OPEN ═══════════════════════════════════════════
  const link = await rpc(p, "create_client_intake_link", { p_business_name: BIZ, p_valid_days: 1 });
  const token = (link.body || {}).token || String(link.body).replace(/^"|"$/g, "");
  check("staff can create a client intake link", typeof token === "string" && token.length > 8,
        `HTTP ${link.status}`);

  const form = await call("get_intake_form", { p_token: token });
  check("and the client can open it without an account", form.ok, `HTTP ${form.status}`);
  check("it greets them by their own business name",
        form.body.business_name === BIZ, form.body.business_name);

  // ══ THE CLIENT RANKS ONE CLOSING, NOT TWO ════════════════════════════════
  // The candidate has two closing capabilities, considered and fast. The client
  // has one opinion about closing. That asymmetry is resolved in the engine and
  // must never reach the form, or the client is being asked a question about an
  // internal implementation detail.
  const rankable = form.body.rankable || [];
  const codes = rankable.map(r => r.code);
  check("the ranking list offers one Closing, not the internal split",
        codes.includes("CLS") && !codes.includes("CLS_C") && !codes.includes("CLS_F"),
        codes.join(","));
  check("and every rankable dimension is explained in plain words",
        rankable.length > 0 && rankable.every(r => r.plain && r.plain.length > 20 && !/^[A-Z_]+$/.test(r.plain)),
        `${rankable.filter(r => !r.plain).length} without an explanation`);
  check("nothing in the form leaks a score, a weight or a dimension code as a value",
        !/"(CLS_[CF]|MOT|STY)"|score_key|weight/i.test(JSON.stringify(form.body)),
        (JSON.stringify(form.body).match(/"(CLS_[CF]|MOT|STY)"|score_key|weight/i) || [""])[0]);

  // ══ A DRAFT SURVIVES CLOSING THE TAB ═════════════════════════════════════
  const draftSave = await call("save_intake_draft",
    { p_token: token, p_payload: { ticket_size: "mid", hf_locations: "Pune" } });
  check("a half-finished intake can be saved", draftSave.ok, `HTTP ${draftSave.status}`);
  const reopened = await call("get_intake_form", { p_token: token });
  check("and is there when the client comes back",
        (reopened.body.draft || {}).ticket_size === "mid",
        JSON.stringify(reopened.body.draft || {}).slice(0, 100));

  // ══ SUBMIT REFUSES AN INCOMPLETE ONE, AND SAYS WHAT IS MISSING ═══════════
  const short = await call("submit_intake", { p_token: token, p_payload: { ticket_size: "mid" } });
  check("submitting an incomplete intake is refused",
        short.ok && short.body.ok === false, JSON.stringify(short.body).slice(0, 120));
  check("and it names every missing answer rather than just the first",
        Array.isArray(short.body.missing) && short.body.missing.length >= 5,
        (short.body.missing || []).join(", "));
  check("including the outcome metric the whole feedback loop is measured against",
        (short.body.missing || []).some(m => /expected_days_to_first_close/.test(m)),
        (short.body.missing || []).join(", "));

  const wrongRank = await call("submit_intake",
    { p_token: token, p_payload: { ...ANSWERS, top3: ["CLS", "DRV"] } });
  check("picking two of three priorities is refused, not silently accepted",
        wrongRank.body.ok === false && (wrongRank.body.missing || []).some(m => /top3/.test(m)),
        (wrongRank.body.missing || []).join(", "));

  // ══ A COMPLETE ONE CREATES THE REQUIREMENT ═══════════════════════════════
  const sub = await call("submit_intake", { p_token: token, p_payload: ANSWERS });
  check("a complete intake submits", sub.ok && sub.body.ok !== false,
        JSON.stringify(sub.body).slice(0, 140));

  const clients = await rest(p, `clients?select=id,business_name&business_name=eq.${encodeURIComponent(BIZ)}`);
  check("a client row exists for the business",
        Array.isArray(clients) && clients.length === 1,
        Array.isArray(clients) ? `${clients.length} rows` : JSON.stringify(clients).slice(0, 120));
  if (!Array.isArray(clients) || !clients.length) throw new Error("no client row to test with");

  // Filtered by client rather than ordered by a column I assumed exists — the
  // first draft ordered by created_at, got an error object back, and the failure
  // arrived as "reqs.find is not a function" three lines later.
  const reqs = await rest(p,
    `requirements?select=id,title,hard_filters,target_profile_id,status,client_id&client_id=eq.${clients[0].id}`);
  check("the requirements query returns rows, not an error",
        Array.isArray(reqs), JSON.stringify(reqs).slice(0, 140));
  const req = (Array.isArray(reqs) ? reqs : [])[0];
  check("and a requirement was created from the intake", !!req, req ? req.id : "none");
  if (!req) throw new Error("no requirement to test with");
  check("with a target profile computed for it", !!(req && req.target_profile_id), "");

  // ══ THE LANGUAGE SPLIT — THE BUG THAT KEEPS COMING BACK ══════════════════
  const hf = (req && req.hard_filters) || {};
  const langs = (hf.languages_required || []).map(l => l.lang);
  check("'en, hi' becomes TWO required languages, not one called 'en, hi'",
        langs.length === 2 && langs.includes("en") && langs.includes("hi"),
        JSON.stringify(hf.languages_required || []));
  check("and 'Pune, Mumbai' becomes two locations",
        Array.isArray(hf.locations) && hf.locations.length === 2 &&
        hf.locations.includes("Pune") && hf.locations.includes("Mumbai"),
        JSON.stringify(hf.locations || []));
  check("numbers arrive as numbers, not as the strings the form sent",
        typeof hf.min_years_experience === "number" && typeof hf.salary_min === "number",
        JSON.stringify({ y: hf.min_years_experience, s: hf.salary_min }));

  // ══ THE SERVER DERIVES THE FILTERS, NOT THE CALLER ═══════════════════════
  // The load-bearing one. A caller who sends a deliberately corrupt copy of
  // hard_filters must have it ignored and rebuilt from the answers. When the
  // browser also derived this, saving an unchanged intake wrote the stale copy
  // back and undid a fix that was already in place.
  const poisoned = await rpc(p, "update_client_intake", {
    p_requirement_id: req.id,
    p_payload: { ...ANSWERS, hard_filters: { locations: ["ZZ_NOWHERE"], languages_required: [{ lang: "en, hi", min: "fluent" }] } },
  });
  check("an intake can be edited by staff", poisoned.status < 400, `HTTP ${poisoned.status}`);
  const after = await rest(p, `requirements?select=hard_filters&id=eq.${req.id}`);
  const hf2 = (after[0] || {}).hard_filters || {};
  check("A CALLER'S OWN COPY OF hard_filters IS IGNORED AND REBUILT",
        !JSON.stringify(hf2.locations || []).includes("ZZ_NOWHERE") &&
        (hf2.languages_required || []).length === 2,
        JSON.stringify(hf2).slice(0, 180));

  // ══ UNKNOWN IS NOT A VALUE ═══════════════════════════════════════════════
  const filters = { languages_required: [{ lang: "en", min: "fluent" }], locations: ["Pune"] };
  const nothingKnown = await rpc(p, "hard_filter_check", { p_candidate: {}, p_filters: filters });
  check("a candidate with nothing recorded fails nothing",
        (nothingKnown.body.fails || []).length === 0,
        JSON.stringify(nothingKnown.body.fails));
  check("but every unchecked filter is reported as unknown, by name",
        (nothingKnown.body.unknown || []).length === 2 &&
        nothingKnown.body.unknown.some(u => /language/.test(u)) &&
        nothingKnown.body.unknown.some(u => /location/.test(u)),
        JSON.stringify(nothingKnown.body.unknown));

  const reallyFails = await rpc(p, "hard_filter_check",
    { p_candidate: { languages: { en: "basic" }, location: "Delhi" }, p_filters: filters });
  check("a candidate who genuinely does not meet a filter does fail it",
        (reallyFails.body.fails || []).length === 2 && (reallyFails.body.unknown || []).length === 0,
        JSON.stringify(reallyFails.body.fails));
  check("and the failure says which language and which place, not just 'failed'",
        reallyFails.body.fails.some(f => /en/.test(f)) &&
        reallyFails.body.fails.some(f => /Delhi/.test(f)),
        JSON.stringify(reallyFails.body.fails));

  const passes = await rpc(p, "hard_filter_check",
    { p_candidate: { languages: { en: "fluent" }, location: "Pune" }, p_filters: filters });
  check("a candidate who meets everything neither fails nor is unknown",
        (passes.body.fails || []).length === 0 && (passes.body.unknown || []).length === 0,
        JSON.stringify(passes.body));

  const noFilters = await rpc(p, "hard_filter_check", { p_candidate: {}, p_filters: {} });
  check("a requirement with no filters is not a requirement everybody fails",
        (noFilters.body.fails || []).length === 0 && (noFilters.body.unknown || []).length === 0,
        JSON.stringify(noFilters.body));

  // ══ A FIXTURE REQUIREMENT DOES NOT RANK REAL PEOPLE ══════════════════════
  // A golden-case requirement once picked up seven real candidates the moment a
  // real person's facts were recorded, because an upsert never removes and
  // nothing scoped the two worlds apart.
  await rpc(p, "compute_matches", { p_requirement_id: req.id });
  const matched = await rest(p,
    `matches?select=candidate_id,composite,hard_filter_pass,hard_filter_unknown&requirement_id=eq.${req.id}`);
  const names = await rest(p, "candidates?select=id,full_name");
  const byId = Object.fromEntries(names.map(c => [c.id, c.full_name]));
  const realOnes = matched.filter(m => !/^ZZ_/.test(byId[m.candidate_id] || ""));
  check("a fixture requirement matches no real candidate",
        realOnes.length === 0,
        realOnes.map(m => byId[m.candidate_id]).join(", ") || "none");

  // ══ THREE-STATE ELIGIBILITY REACHES THE SHORTLIST ════════════════════════
  check("the match rows carry all three states, not a bare pass/fail",
        matched.every(m => "hard_filter_pass" in m && "hard_filter_unknown" in m),
        JSON.stringify(matched[0] || {}));
  check("and nobody is marked eligible while a filter is still unchecked",
        matched.every(m => !(m.hard_filter_pass === true && (m.hard_filter_unknown || []).length > 0)),
        `${matched.filter(m => m.hard_filter_pass === true && (m.hard_filter_unknown || []).length > 0).length} wrongly eligible`);

  // ══ WHAT THE CLIENT'S TOKEN CANNOT DO ════════════════════════════════════
  const reach = {
    detail: (await call("get_candidate_detail", { p_candidate_id: Object.keys(byId)[0] })).status,
    intake: (await call("get_client_intake", { p_requirement_id: req.id })).status,
    matches: (await call("compute_matches", { p_requirement_id: req.id })).status,
    resubmit: (await call("submit_intake", { p_token: token, p_payload: ANSWERS })).status,
  };
  check("a client's intake token reads no candidate and no shortlist",
        reach.detail >= 400 && reach.intake >= 400 && reach.matches >= 400,
        JSON.stringify(reach));
  check("and a submitted intake link cannot be submitted twice",
        reach.resubmit >= 400 ||
        (typeof reach.resubmit === "number" && reach.resubmit < 400 && false),
        `HTTP ${reach.resubmit}`);

  // ══ THE STAFF VIEW OF IT ═════════════════════════════════════════════════
  // Assert the shape, not a value: an earlier draft looked for the literal
  // string "mid" and went red the moment the fixture's ticket_size changed.
  // A test that names a value cannot outlive the value.
  const staffIntake = await rpc(p, "get_client_intake", { p_requirement_id: req.id });
  const readBack = (staffIntake.body || {}).payload || {};
  check("staff can read back what the client actually answered",
        staffIntake.status === 200 &&
        readBack.hf_language === ANSWERS.hf_language &&
        JSON.stringify(readBack.top3) === JSON.stringify(ANSWERS.top3),
        JSON.stringify({ lang: readBack.hf_language, top3: readBack.top3 }));
  check("and the answers come back as the client gave them, not as derived filters",
        readBack.hf_locations === ANSWERS.hf_locations,
        `${readBack.hf_locations}`);

  const missing = await rest(p, "v_missing_direct_fields?select=*&limit=5");
  check("the missing-facts view is readable and shaped right",
        Array.isArray(missing), `${(missing || []).length} rows`);

  check("no JS errors", errs.length === 0, errs.join(" | "));
}, async ({ p, check }) => {
  // ── CLEANUP, on every path ────────────────────────────────────────────────
  const gone = await p.evaluate(async () => {
    const H = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${sessionStorage.getItem("nikash_token")}`,
                "Content-Type": "application/json" };
    const cs = await (await fetch(
      `${SUPABASE_URL}/rest/v1/clients?select=id&business_name=like.ZZ_FIXTURE%20QA%20Intake*`, { headers: H })).json();
    for (const c of (Array.isArray(cs) ? cs : [])) {
      await fetch(`${SUPABASE_URL}/rest/v1/rpc/delete_client`, {
        method: "POST", headers: H, body: JSON.stringify({ p_id: c.id }) });
    }
    const still = await (await fetch(
      `${SUPABASE_URL}/rest/v1/clients?select=id&business_name=like.ZZ_FIXTURE%20QA%20Intake*`, { headers: H })).json();
    return { deleted: (cs || []).length, left: (still || []).length };
  });
  check("the suite deletes its own client, on the failure path too",
        gone.left === 0, `${gone.deleted} deleted, ${gone.left} left`);

  const golden = await rpc(p, "run_golden_cases", {});
  check("golden cases are still 19/19",
        Array.isArray(golden.body) && golden.body.filter(g => g.passed).length === 19,
        `${(golden.body || []).filter(g => g.passed).length}/${(golden.body || []).length}`);

  const un = await rest(p, "v_unmatched_audit?select=*");
  check("and no candidate is left unmatched against an open role",
        Array.isArray(un) && un.length === 0, `${(un || []).length} rows`);
});
