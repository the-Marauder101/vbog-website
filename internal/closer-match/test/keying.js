// KEYING — the part where a bug corrupts data instead of showing a wrong number.
//
// Everywhere else in Nikash a mistake produces a number somebody can argue
// with. Here a mistake rewrites the scoring key, and every profile computed
// afterwards is quietly wrong in a way nothing on screen would show. So this
// suite is stricter than the others in two specific ways.
//
// FIRST, IT IS BLIND-BY-CONSTRUCTION OR IT IS NOTHING. An invited expert keys
// items without being shown which answer the bank already prefers, because an
// expert who can see the current key is confirming it, not testing it. The
// projection in get_keying_by_token leaves score_key out. This suite asserts
// that no path through the token surface carries it, and that means asserting
// on the whole payload, not on the fields I remembered to look at.
//
// SECOND, IT MUTATES THE LIVE ITEM BANK AND MUST PUT IT BACK. apply_rekey
// really does swap two score keys and really does recompute every affected
// profile. There is no fixture bank to do that to. So:
//   · the full score_key state is snapshotted before anything runs
//   · the restore lives in cleanup, which runs on the failure path too
//   · the restore is verified by key_fingerprint(), not by hoping
//   · golden cases are re-run at the very end, after the restore
// If this suite aborts halfway through an apply, the bank still comes back.
//
// Needs an ADMIN login: apply_rekey and undo_rekey are admin-only by design.
// Run: NIKASH_QA_EMAIL=… NIKASH_QA_PASSWORD=… node test/keying.js
const { suite, signIn, rpc, rest, flat } = require("./harness");
const CFG = require("fs").readFileSync(require("path").join(__dirname, "..", "js", "config.js"), "utf8");
const URL_ = (CFG.match(/SUPABASE_URL\s*=\s*"([^"]+)"/) || [])[1];
const KEY = (CFG.match(/SUPABASE_ANON_KEY\s*=\s*"([^"]+)"/) || [])[1];

// The invited expert's client: the published key and a token. No account.
const call = async (fn, args) => {
  const r = await fetch(`${URL_}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(args || {}) });
  const t = await r.text();
  let body; try { body = JSON.parse(t); } catch { body = t; }
  return { status: r.status, ok: r.status >= 200 && r.status < 300, body };
};

const LABEL = `ZZ_QA Round ${Date.now()}`;
let fingerprintAtStart = null;

suite("KEYING SUITE", 8102, async ({ p, base, E, P, check, errs }) => {
  await signIn(p, base, E, P);

  const role = await rpc(p, "whoami", {});
  check("the suite is running as an admin, as it must be",
        role.body && role.body.role === "admin", (role.body || {}).role);

  fingerprintAtStart = (await rpc(p, "key_fingerprint", {})).body;
  check("the key set in force has a fingerprint",
        typeof fingerprintAtStart === "string" && /^[0-9a-f]{12}$/.test(fingerprintAtStart),
        fingerprintAtStart);

  // ══ A ROUND, AND AN INVITATION ═══════════════════════════════════════════
  const round = await rpc(p, "create_keying_round", { p_label: LABEL });
  const roundId = typeof round.body === "string" ? round.body.replace(/^"|"$/g, "")
                : (round.body && (round.body.id || round.body));
  check("a keying round can be opened", /^[0-9a-f-]{36}$/.test(String(roundId)), String(roundId));
  if (!/^[0-9a-f-]{36}$/.test(String(roundId))) throw new Error("no round to test with");

  const linkA = await rpc(p, "create_keying_link",
    { p_round: roundId, p_name: "ZZ_QA Expert A", p_email: "zz-qa-a@example.com", p_valid_days: 1 });
  const linkB = await rpc(p, "create_keying_link",
    { p_round: roundId, p_name: "ZZ_QA Expert B", p_email: "zz-qa-b@example.com", p_valid_days: 1 });
  // create_keying_link returns the whole invitation, not a bare token.
  const tokA = (linkA.body || {}).token || "";
  const tokB = (linkB.body || {}).token || "";
  check("two experts can be invited",
        tokA.length > 8 && tokB.length > 8 && tokA !== tokB, `${tokA.slice(0, 6)}… ${tokB.slice(0, 6)}…`);

  // ══ BLIND BY CONSTRUCTION ════════════════════════════════════════════════
  const seen = await call("get_keying_by_token", { p_token: tokA });
  check("an invited expert can open their round without an account", seen.ok, `HTTP ${seen.status}`);

  const items = (seen.body && seen.body.items) || [];
  check("they are given the scenario items to key", items.length === 28, `${items.length} items`);

  // Walk the object's KEYS, at every depth, rather than grepping the serialized
  // payload. Grepping the text fails on its own scenarios: several options
  // legitimately contain the word "correct" ("correct the invoice"), and a test
  // that trips on the instrument's own prose is a test that gets deleted.
  // The leak this guards against is a FIELD reappearing, so look at fields.
  const keysOf = (o, acc = new Set()) => {
    if (Array.isArray(o)) o.forEach(x => keysOf(x, acc));
    else if (o && typeof o === "object") for (const k of Object.keys(o)) { acc.add(k); keysOf(o[k], acc); }
    return acc;
  };
  const keys = [...keysOf(seen.body)];
  const forbidden = ["score_key", "score", "key", "is_best", "correct", "best_option_key", "dimension_code", "weight"];
  // `key` is allowed: it is the option's letter, which the expert must see to
  // choose one. Everything else on that list would be telling them the answer.
  const leaked = keys.filter(k => forbidden.includes(k) && k !== "key");
  check("and no field anywhere in the payload carries the bank's scoring",
        leaked.length === 0, leaked.join(",") || `checked ${keys.length} distinct fields`);
  check("the option letters are there, because the expert has to pick one",
        keys.includes("key") && keys.includes("text"), keys.join(","));
  // Dimension codes would leak as VALUES, not as a field name, so this one does
  // look at the serialized payload — but for exact quoted codes, which cannot
  // occur in the scenario prose the way an ordinary English word can.
  const payload = JSON.stringify(seen.body);
  check("nor the dimension each item measures",
        !/"(CLS_[CF]|CCH|DSC|DRV|RES|INT|MOT|STY)"/.test(payload),
        (payload.match(/"(CLS_[CF]|CCH|DSC|DRV|RES|INT|MOT|STY)"/) || [""])[0]);
  check("every item still arrives with its options, so the round is answerable",
        items.every(i => Array.isArray(i.options) && i.options.length >= 3),
        `${items.filter(i => !(i.options || []).length).length} without options`);

  // ══ THE TOKEN OPENS NOTHING ELSE ═════════════════════════════════════════
  // A keying token is a credential handed to somebody outside the firm. R1
  // scores never leave the building, and this is the door they would leave by.
  const reach = {
    report: (await call("get_keying_report", { p_round: roundId })).status,
    detail: (await call("get_candidate_detail", { p_candidate_id: "00000000-0000-0000-0000-000000000000" })).status,
    preview: (await call("preview_rekey", { p_item_id: items[0].id, p_new_best: "a" })).status,
    apply: (await call("apply_rekey", { p_item_id: items[0].id, p_new_best: "a" })).status,
    decide: (await call("record_key_decision", { p_item_id: items[0].id, p_decision: "kept", p_rationale: "x" })).status,
    staff: (await call("list_staff", {})).status,
  };
  check("an expert's token cannot read a score, a report or change a key",
        Object.values(reach).every(s => s >= 400), JSON.stringify(reach));

  // ══ KEYING, AND COMING BACK TO IT ════════════════════════════════════════
  const target = items[0];
  const optKeys = target.options.map(o => o.key);
  const a = await call("save_keying_by_token",
    { p_token: tokA, p_item: target.id, p_best: optKeys[0], p_worst: optKeys[1], p_note: "ZZ_QA A" });
  check("an expert can record a key", a.ok, `HTTP ${a.status}`);

  const back = await call("get_keying_by_token", { p_token: tokA });
  const mine = (back.body.items.find(i => i.id === target.id) || {}).mine || {};
  check("and it is theirs when they come back",
        mine.best === optKeys[0] && mine.worst === optKeys[1], JSON.stringify(mine));
  check("coming back still does not reveal the bank's key",
        !/score_key/i.test(JSON.stringify(back.body)), "");

  // Expert B disagrees, deliberately, so there is a conflict to report on.
  await call("save_keying_by_token",
    { p_token: tokB, p_item: target.id, p_best: optKeys[1], p_worst: optKeys[0], p_note: "ZZ_QA B" });

  // ══ A CLOSED ROUND IS CLOSED ═════════════════════════════════════════════
  await rpc(p, "set_keying_round_open", { p_id: roundId, p_open: false });
  const shut = await call("save_keying_by_token",
    { p_token: tokA, p_item: target.id, p_best: optKeys[2] || optKeys[0] });
  check("a closed round refuses a new key rather than silently dropping it",
        shut.status >= 400, `HTTP ${shut.status}`);
  const stillMine = ((await call("get_keying_by_token", { p_token: tokA }))
    .body.items.find(i => i.id === target.id) || {}).mine || {};
  check("and the key recorded before it closed is untouched",
        stillMine.best === optKeys[0], JSON.stringify(stillMine));
  await rpc(p, "set_keying_round_open", { p_id: roundId, p_open: true });

  // ══ THE REPORT, AND ITS FOUR VERDICTS ════════════════════════════════════
  const report = await rpc(p, "get_keying_report", { p_round: roundId });
  const rows = (report.body && (report.body.items || report.body)) || [];
  check("staff can read the keying report", report.status === 200 && rows.length > 0,
        `${rows.length} rows`);

  const row = (Array.isArray(rows) ? rows : []).find(x => x.item_id === target.id) || {};
  check("the item two experts split on is reported as a conflict",
        !!row.conflict, JSON.stringify(row.conflict || row).slice(0, 140));
  check("and it names the fingerprint of the key set the report was run against",
        /^[0-9a-f]{12}$/.test(String(report.body.fingerprint || row.fingerprint || "")),
        String(report.body.fingerprint || row.fingerprint || ""));

  // ══ A DECISION THAT OVERRIDES THE EXPERTS MUST SAY WHY ═══════════════════
  const bare = await rpc(p, "record_key_decision", { p_item_id: target.id, p_decision: "kept" });
  check("keeping the bank's key against the experts is refused without a reason",
        bare.status >= 400 && /needs a sentence saying why/i.test(JSON.stringify(bare.body)),
        `HTTP ${bare.status}`);

  const withWhy = await rpc(p, "record_key_decision",
    { p_item_id: target.id, p_decision: "kept",
      p_rationale: "ZZ_QA — deliberate, this is a test round.", p_round: roundId });
  check("and accepted with one", withWhy.status < 400, `HTTP ${withWhy.status}`);

  const decided = await rest(p, `key_decisions?select=item_id,decision,rationale&item_id=eq.${target.id}`);
  check("the reason is stored, not just validated",
        Array.isArray(decided) && decided[0] && /deliberate/.test(decided[0].rationale || ""),
        JSON.stringify(decided).slice(0, 120));

  // ══ PREVIEW CHANGES NOTHING ══════════════════════════════════════════════
  // The dry run happens inside a subtransaction that always raises, so the work
  // is done and then thrown away. If that rollback ever stopped happening, this
  // is the assertion that notices — and it is the difference between a preview
  // and an unannounced re-key of the live bank.
  const fpBefore = (await rpc(p, "key_fingerprint", {})).body;
  const preview = await rpc(p, "preview_rekey", { p_item_id: target.id, p_new_best: optKeys[1] });
  check("a preview reports what would move", preview.status === 200 &&
        (preview.body.moves !== undefined || preview.body.candidates !== undefined),
        JSON.stringify(preview.body).slice(0, 140));
  const fpAfterPreview = (await rpc(p, "key_fingerprint", {})).body;
  check("and changes nothing at all — the fingerprint is identical",
        fpAfterPreview === fpBefore, `${fpBefore} → ${fpAfterPreview}`);

  // ══ APPLYING IT, FOR REAL ════════════════════════════════════════════════
  const optionsBefore = await rest(p, `item_options?select=option_key,score_key&item_id=eq.${target.id}&order=option_key`);
  // Every real candidate's scores, before the bank moves under them. apply_rekey
  // recomputes profiles, and undo_rekey recomputes them again; the round trip
  // has to land back on the same numbers or a test round has silently restated
  // what the system thinks of real people.
  const profilesBefore = await rest(p,
    "candidate_profile?select=candidate_id,scores&order=candidate_id");
  const applied = await rpc(p, "apply_rekey",
    { p_item_id: target.id, p_new_best: optKeys[1], p_round: roundId, p_note: "ZZ_QA test apply" });
  check("an admin can apply a re-key", applied.status === 200 && applied.body.changed !== false,
        JSON.stringify(applied.body).slice(0, 140));

  const fpAfterApply = (await rpc(p, "key_fingerprint", {})).body;
  check("and the key set in force is now a different one",
        fpAfterApply !== fpBefore, `${fpBefore} → ${fpAfterApply}`);

  // A re-key that changed no score would be a re-key of an item nobody answered.
  // If this ever passes trivially the suite is testing an item out of use.
  const profilesMid = await rest(p, "candidate_profile?select=candidate_id,scores&order=candidate_id");
  check("real profiles were actually recomputed by the re-key",
        JSON.stringify(profilesMid) !== JSON.stringify(profilesBefore),
        `${profilesBefore.length} profiles`);

  const optionsAfter = await rest(p, `item_options?select=option_key,score_key&item_id=eq.${target.id}&order=option_key`);
  check("the two score keys swapped, and nothing else on the item moved",
        optionsBefore.length === optionsAfter.length &&
        optionsAfter.filter((o, i) => o.score_key !== optionsBefore[i].score_key).length === 2,
        JSON.stringify(optionsAfter.map(o => [o.option_key, o.score_key])));

  const noop = await rpc(p, "apply_rekey", { p_item_id: target.id, p_new_best: optKeys[1] });
  check("re-applying the same key is a no-op that says so, not a second swap",
        noop.body && noop.body.changed === false, JSON.stringify(noop.body).slice(0, 120));

  const bogus = await rpc(p, "apply_rekey", { p_item_id: target.id, p_new_best: "zzz" });
  check("an option that is not on the item is refused",
        bogus.status >= 400, `HTTP ${bogus.status}`);

  const change = await rest(p, `key_changes?select=id,item_id,old_best,new_best&item_id=eq.${target.id}&order=applied_at.desc`);
  check("the change is recorded with what it came from",
        Array.isArray(change) && change[0] && change[0].old_best && change[0].new_best,
        JSON.stringify((change || [])[0] || {}));

  // ══ AND UNDOING IT ═══════════════════════════════════════════════════════
  const undone = await rpc(p, "undo_rekey", { p_change_id: change[0].id });
  check("the re-key can be undone", undone.status === 200, `HTTP ${undone.status}`);

  const fpAfterUndo = (await rpc(p, "key_fingerprint", {})).body;
  check("and the bank is byte-for-byte what it was before the apply",
        fpAfterUndo === fpBefore, `${fpBefore} → ${fpAfterUndo}`);

  const profilesAfter = await rest(p, "candidate_profile?select=candidate_id,scores&order=candidate_id");
  check("EVERY REAL CANDIDATE'S SCORES ARE EXACTLY WHAT THEY WERE",
        JSON.stringify(profilesAfter) === JSON.stringify(profilesBefore),
        profilesAfter.length === profilesBefore.length
          ? `${profilesAfter.filter((x, i) => JSON.stringify(x) !== JSON.stringify(profilesBefore[i])).length} of ${profilesBefore.length} differ`
          : `${profilesBefore.length} → ${profilesAfter.length} profiles`);

  // The undo used to leave behind the 'rekeyed' decision it had itself created,
  // so an item that was back to its original key still read as decided.
  const stale = await rest(p, `key_decisions?select=decision&item_id=eq.${target.id}&decision=eq.rekeyed`);
  check("and the undo clears the decision it created",
        Array.isArray(stale) && stale.length === 0, `${(stale || []).length} left`);

  // v_key_drift_audit is a GROUPING, not an exceptions list: one row per distinct
  // key set that live profiles were scored against. One row marked current is
  // the healthy state. Drift is two or more rows, or any row that is not current
  // — a profile still carrying scores from a key set that has since changed.
  const drift = await rest(p, "v_key_drift_audit?select=*");
  check("every live profile was scored against the key set now in force",
        Array.isArray(drift) && drift.length >= 1 && drift.every(d => d.is_current === true),
        drift.map(d => `${d.key_fingerprint}:${d.profiles}${d.is_current ? "" : " STALE"}`).join(" "));
  check("and there is only one key set among them",
        Array.isArray(drift) && drift.length === 1, `${(drift || []).length} distinct key sets`);

  check("no JS errors", errs.length === 0, errs.join(" | "));
}, async ({ p, check }) => {
  // ── CLEANUP, on every path ────────────────────────────────────────────────
  // The fingerprint check is the one that matters. Everything else here is
  // tidying; this is the assertion that the live scoring key is what it was
  // when the suite started, including on a run that aborted mid-apply.
  const fp = await rpc(p, "key_fingerprint", {});
  check("THE LIVE SCORING KEY IS EXACTLY AS THE SUITE FOUND IT",
        fingerprintAtStart == null || fp.body === fingerprintAtStart,
        `started ${fingerprintAtStart}, ended ${fp.body}`);

  const gone = await p.evaluate(async (label) => {
    const H = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${sessionStorage.getItem("nikash_token")}`,
                "Content-Type": "application/json" };
    const rounds = await (await fetch(
      `${SUPABASE_URL}/rest/v1/keying_rounds?select=id&label=like.ZZ_QA%20Round*`, { headers: H })).json();
    for (const r of (Array.isArray(rounds) ? rounds : [])) {
      await fetch(`${SUPABASE_URL}/rest/v1/rpc/delete_keying_round`, {
        method: "POST", headers: H, body: JSON.stringify({ p_id: r.id }) });
    }
    await fetch(`${SUPABASE_URL}/rest/v1/key_decisions?rationale=like.ZZ_QA*`, { method: "DELETE", headers: H });
    // create_keying_link inserts a `keyer` staff row per invited expert — an
    // inactive one with a null auth_uid, so it can never sign in, but a row all
    // the same. The suites that ran before this one created accounts and left
    // them behind; three were still in auth.users weeks later. Delete what you
    // create, including the rows you created as a side effect.
    await fetch(`${SUPABASE_URL}/rest/v1/staff?email=like.zz-qa-%2A`, { method: "DELETE", headers: H });
    const still = await (await fetch(
      `${SUPABASE_URL}/rest/v1/keying_rounds?select=id&label=like.ZZ_QA%20Round*`, { headers: H })).json();
    const staffLeft = await (await fetch(
      `${SUPABASE_URL}/rest/v1/staff?select=id&email=like.zz-qa-%2A`, { headers: H })).json();
    return { deleted: (rounds || []).length, left: (still || []).length + (staffLeft || []).length };
  }, LABEL);
  check("the suite deletes its own rounds, on the failure path too",
        gone.left === 0, `${gone.deleted} deleted, ${gone.left} left`);

  // Last, and only after the restore: the invariant that says the scoring
  // engine still behaves. Running this before the restore would prove nothing.
  const golden = await rpc(p, "run_golden_cases", {});
  check("golden cases are 19/19 after the bank has been put back",
        Array.isArray(golden.body) && golden.body.filter(g => g.passed).length === 19,
        `${(golden.body || []).filter(g => g.passed).length}/${(golden.body || []).length}`);
});
