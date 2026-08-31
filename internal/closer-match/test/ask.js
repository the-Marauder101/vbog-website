// ASK — the interview scorecard, and the claim that it does not touch the match
// score.
//
// Run: node test/ask.js
//
// The whole design rests on one promise: ASK is a second, independent reading
// that sits BESIDE the questionnaire and never inside it. A promise like that is
// worth nothing unless something checks it, so the load-bearing assertion here
// captures every match composite and every profile score before an ASK scorecard
// is submitted and requires them byte-identical afterwards.
//
// The rest drives the real surface: run an R2 in a browser, drop out halfway,
// come back, finish, submit, and read it on the candidate page.
const { suite, rest, rpc, flat } = require("./harness");

// The server, browser, Supabase route handler, credential check and sign-in all
// live in ./harness.js. This suite needs an ADMIN login, not just any staff
// login: it drives the add-staff form, which is only rendered for admins. A
// recruiter login fails here as a 30s timeout on an invisible #team-name, which
// reads like a broken test rather than the wrong role.
const refused = (s, t) => s >= 400 && /staff only|permission denied for function/.test(t || "");

async function cleanup(p) {
  try {
    await p.evaluate(async () => {
      const h = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${sessionStorage.getItem("nikash_token")}` };
      const cards = await (await fetch(`${SUPABASE_URL}/rest/v1/ask_scorecards?select=id,client_context&client_context=like.ZZ_QA*`, { headers: h })).json();
      for (const c of cards) await fetch(`${SUPABASE_URL}/rest/v1/ask_scorecards?id=eq.${c.id}`, { method: "DELETE", headers: h });
      const st = await (await fetch(`${SUPABASE_URL}/rest/v1/staff?select=id&email=like.zz-qa-%2A`, { headers: h })).json();
      for (const s of st) await fetch(`${SUPABASE_URL}/rest/v1/staff?id=eq.${s.id}`, { method: "DELETE", headers: h });
    });
  } catch (_) { /* best effort — never mask the original failure */ }
}

suite("ASK SUITE", 8098, async ({ p, base, E, P, check, errs }) => {
  const B = base;

  await p.goto(`${B}/nikash.html`, { waitUntil: "domcontentloaded" });
  await p.waitForSelector("#v-signin:not([hidden])", { timeout: 20000 });
  await p.fill("#si-email", E); await p.fill("#si-pass", P);
  await p.click("#btn-signin");
  await p.waitForSelector("#v-reqs:not([hidden])", { timeout: 20000 });

  // ══ 1. THE STAFF PANEL ═══════════════════════════════════════════════════
  await p.click("#nav-team"); await p.waitForSelector("#v-team:not([hidden])", { timeout: 20000 });
  await p.waitForTimeout(900);
  check("the team screen lists who has access",
        (await p.$$("#team-list .cand")).length > 0,
        `${(await p.$$("#team-list .cand")).length} rows`);

  const teamTxt = (await p.textContent("#v-team")).replace(/\s+/g, " ");
  check("it explains that they create their own login",
        /They create their own login with the same email/.test(teamTxt), "");
  // Only the roles actually on screen. The first version looked for the recruiter
  // sentence before a recruiter existed — asserting against a row the fixture had
  // not created yet, which is a test bug that reads exactly like a product bug.
  check("and says what each role on screen can actually do",
        /keying rounds, re-keys and retention/.test(teamTxt) &&
        /not a console account/.test(teamTxt),
        "admin + keyer wording present");

  const newEmail = `zz-qa-${Date.now()}@example.org`;
  await p.fill("#team-name", "ZZ QA Recruit");
  await p.fill("#team-email", newEmail);
  await p.selectOption("#team-role", "recruiter");
  await p.click("#btn-add-staff");
  await p.waitForFunction(() => /can now create a login|error/i.test(
    document.getElementById("team-state").textContent), { timeout: 30000 });
  const added = await rest(p, `staff?select=email,role,active,auth_uid&email=eq.${newEmail}`);
  check("adding a colleague works from the console, no SQL editor",
        added.length === 1 && added[0].role === "recruiter" && added[0].active,
        JSON.stringify(added[0] || {}));
  check("and they show as waiting until they sign up",
        added[0] && added[0].auth_uid === null,
        `auth_uid ${added[0] && added[0].auth_uid}`);

  const afterAdd = (await p.textContent("#v-team")).replace(/\s+/g, " ");
  check("and the recruiter row explains what a recruiter can do",
        /candidate links, client intake, shortlists/.test(afterAdd), "");
  check("a colleague who has not signed up yet is marked as such",
        /has not signed up yet/.test(afterAdd), "");

  // The refusals that matter. Both are enforced in the database, so both are
  // tested against the database rather than against the button being hidden.
  const me = (await rest(p, `staff?select=id&email=eq.${E}`))[0];
  const self = await rpc(p, "set_staff_active", { p_id: me.id, p_active: false });
  check("you cannot remove your own access",
        self.status >= 400 && /your own access/.test(JSON.stringify(self.body)),
        JSON.stringify(self.body).slice(0, 100));

  const admins = await rest(p, "staff?select=id&role=eq.admin&active=is.true");
  if (admins.length === 1) {
    const demote = await rpc(p, "set_staff_role", { p_id: admins[0].id, p_role: "recruiter" });
    check("and you cannot demote the last admin",
          demote.status >= 400 && /last admin/.test(JSON.stringify(demote.body)),
          JSON.stringify(demote.body).slice(0, 100));
  } else {
    check("and you cannot demote the last admin", true,
          `${admins.length} admins exist — the guard is exercised by the SQL assertion`);
  }

  const badRole = await rpc(p, "add_staff", { p_email: "x@y.com", p_name: "X", p_role: "keyer" });
  check("a keyer cannot be added as a console account",
        badRole.status >= 400 && /admin, recruiter or psych/.test(JSON.stringify(badRole.body)),
        JSON.stringify(badRole.body).slice(0, 90));

  // ══ 2. THE BANK ══════════════════════════════════════════════════════════
  const r1 = (await rpc(p, "get_ask_bank", { p_round: "r1" })).body;
  const r2 = (await rpc(p, "get_ask_bank", { p_round: "r2" })).body;
  const count = (bank) => (bank.attributes || []).reduce((n, a) => n + a.questions.length, 0);

  check("R1 serves the 15-question screen", count(r1) === 15 && r1.attributes.length === 5,
        `${count(r1)} questions across ${r1.attributes.length} attributes`);
  check("R2 serves all 42", count(r2) === 42 && r2.attributes.length === 14,
        `${count(r2)} questions across ${r2.attributes.length} attributes`);
  check("R1 is exactly the priority attributes",
        r1.attributes.every(a => a.priority), "");

  const allQs = r2.attributes.flatMap(a => a.questions);
  check("every question carries four anchors scored 0-3",
        allQs.every(q => q.options.length === 4 &&
          q.options.map(o => o.score).join() === "0,1,2,3"),
        `${allQs.filter(q => q.options.length !== 4).length} malformed`);
  check("every anchor has both a label and a description",
        allQs.every(q => q.options.every(o => o.label && o.description)), "");
  check("the wording survived the move out of the HTML file",
        allQs.some(q => /dial count on a normal day/.test(q.prompt)) &&
        allQs.some(q => q.options.some(o => /explain what changed the connect rate/.test(o.description))),
        "checked against two verbatim strings from the original");
  check("the two reference questions are marked as such",
        allQs.filter(q => q.is_reference).length === 2,
        allQs.filter(q => q.is_reference).map(q => q.id).join(", "));
  check("and the interviewer hints came across",
        allQs.filter(q => q.hint).length === 42, `${allQs.filter(q => q.hint).length} of 42`);

  // ══ 3. THE LOAD-BEARING CLAIM: ASK DOES NOT MOVE A MATCH SCORE ═══════════
  const target = (await rest(p, "v_candidate_queue?select=id,full_name&scores=not.is.null&limit=1"))[0];
  check("there is a scored candidate to run ASK against", !!target, target && target.full_name);

  const before = {
    matches: await rest(p, "matches?select=requirement_id,candidate_id,composite,quality_score,fit_score&order=requirement_id,candidate_id"),
    profiles: await rest(p, "candidate_profile?select=candidate_id,scores&order=candidate_id"),
  };

  // ══ 4. RUN AN R2 IN A REAL BROWSER ═══════════════════════════════════════
  await p.goto(`${B}/ask.html?cand=${target.id}&round=r2`, { waitUntil: "domcontentloaded" });
  await p.waitForSelector("#v-start:not([hidden])", { timeout: 20000 });
  const startTxt = (await p.textContent("#v-start")).replace(/\s+/g, " ");
  check("the start screen says what the round is and how it is scored",
        /All fourteen attributes/.test(startTxt) && /42 questions/.test(startTxt) &&
        /scored 0–3 against a written anchor/.test(startTxt), startTxt.slice(0, 110));

  await p.fill("#start-client", "ZZ_QA context");
  await p.click("#btn-begin");
  await p.waitForSelector("#v-q:not([hidden])", { timeout: 20000 });

  const firstPrompt = await p.textContent("#q-prompt");
  const hintTxt = (await p.textContent("#q-hint")).replace(/\s+/g, " ");
  check("a question shows its interviewer hint, not just the question",
        /What you're listening for/.test(hintTxt) && hintTxt.length > 60, hintTxt.slice(0, 90));
  check("the four anchors are the only way to score",
        (await p.$$("#q-options .option")).length === 4, "");

  // Answer the first six by keyboard, which is how it will actually be used.
  for (let i = 0; i < 6; i++) {
    await p.keyboard.press(String(i % 4));
    await p.waitForTimeout(220);
    await p.keyboard.press("ArrowRight");
    await p.waitForTimeout(220);
  }
  const sixIn = (await rest(p, `ask_scorecards?select=id&client_context=eq.ZZ_QA%20context`))[0];
  const saved6 = await rest(p, `ask_scores?select=question_id,score,question_text,option_label&scorecard_id=eq.${sixIn.id}`);
  check("every answer is written the moment it is given",
        saved6.length === 6, `${saved6.length} saved after 6 answers`);
  check("and it stores the wording it was scored against",
        saved6.every(s => s.question_text && s.option_label),
        JSON.stringify(saved6[0] || {}).slice(0, 120));

  // ══ 5. A DROPPED CALL LOSES NOTHING ══════════════════════════════════════
  await p.goto(`${B}/ask.html?cand=${target.id}&round=r2`, { waitUntil: "domcontentloaded" });
  await p.waitForSelector("#v-start:not([hidden])", { timeout: 20000 });
  check("reopening says it will pick up where you left off",
        /Picking up where you left off/.test(await p.textContent("#start-resume")), "");
  await p.click("#btn-begin");
  await p.waitForSelector("#v-q:not([hidden])", { timeout: 20000 });
  const whereNow = (await p.textContent("#q-where")).replace(/\s+/g, " ");
  check("and it resumes at the first unanswered question, not at the top",
        /7 of 42/.test(whereNow) && (await p.textContent("#q-prompt")) !== firstPrompt,
        whereNow.slice(0, 60));

  // ══ 6. FINISH IT ═════════════════════════════════════════════════════════
  const card = sixIn.id;
  const bankQs = allQs.map(q => ({ id: q.id, ref: q.is_reference }));
  for (const q of bankQs) {
    if (q.ref) continue;                       // reference questions stay open
    if (saved6.some(s => s.question_id === q.id)) continue;
    await rpc(p, "save_ask_score", { p_scorecard: card, p_question: q.id, p_score: 2,
                                     p_note: null });
  }

  const early = await rpc(p, "submit_ask", { p_scorecard: card });
  check("submitting succeeds with only the reference questions outstanding",
        early.status === 200 && early.body.submitted === true, JSON.stringify(early.body).slice(0, 110));
  check("and it says how many reference questions are still open",
        early.body.outstanding_refs === 2 && /previous manager/.test(early.body.note || ""),
        `${early.body.outstanding_refs} outstanding`);

  const frozen = (await rest(p, `ask_scorecards?select=total,max_total,pct,attributes&id=eq.${card}`))[0];
  check("the total is frozen on the scorecard, not recomputed on read",
        frozen.total != null && frozen.max_total === 126 && frozen.attributes != null,
        `${frozen.total} of ${frozen.max_total} (${frozen.pct}%)`);

  const locked = await rpc(p, "save_ask_score", { p_scorecard: card, p_question: bankQs[0].id, p_score: 0 });
  check("a submitted scorecard refuses further edits",
        locked.status >= 400 && /was submitted on/.test(JSON.stringify(locked.body)),
        JSON.stringify(locked.body).slice(0, 90));

  // ══ 7. THE CLAIM, CHECKED ════════════════════════════════════════════════
  const after = {
    matches: await rest(p, "matches?select=requirement_id,candidate_id,composite,quality_score,fit_score&order=requirement_id,candidate_id"),
    profiles: await rest(p, "candidate_profile?select=candidate_id,scores&order=candidate_id"),
  };
  check("SUBMITTING AN ASK SCORECARD MOVES NO MATCH SCORE",
        JSON.stringify(before.matches) === JSON.stringify(after.matches),
        `${before.matches.length} match rows compared`);
  check("and no questionnaire profile",
        JSON.stringify(before.profiles) === JSON.stringify(after.profiles),
        `${before.profiles.length} profiles compared`);

  const golden = await rpc(p, "run_golden_cases");
  check("golden cases still 19/19",
        Array.isArray(golden.body) && golden.body.filter(g => g.passed).length === 19,
        `${(golden.body || []).filter(g => g.passed).length}/${(golden.body || []).length}`);

  // ══ 8. A LATE REFERENCE ANSWER ═══════════════════════════════════════════
  const refQ = bankQs.find(q => q.ref);
  const late = await rpc(p, "score_ask_reference", { p_scorecard: card, p_question: refQ.id, p_score: 3 });
  check("a reference answer can land after submitting and updates the total",
        late.status === 200 && late.body.total > frozen.total,
        `${frozen.total} → ${late.body.total}`);
  const notRef = await rpc(p, "score_ask_reference", { p_scorecard: card, p_question: bankQs.find(q => !q.ref).id, p_score: 3 });
  check("but an ordinary question cannot be reopened that way",
        notRef.status >= 400 && /Only the reference questions/.test(JSON.stringify(notRef.body)),
        JSON.stringify(notRef.body).slice(0, 90));

  // ══ 9. A REWORDING MUST NOT MOVE A FINISHED SCORECARD ════════════════════
  const victim = bankQs.find(q => !q.ref).id;
  const originalPrompt = allQs.find(q => q.id === victim).prompt;
  await p.evaluate(async ([id, txt]) => {
    await fetch(`${SUPABASE_URL}/rest/v1/ask_questions?id=eq.${id}`, { method: "PATCH",
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${sessionStorage.getItem("nikash_token")}`,
        "Content-Type": "application/json" }, body: JSON.stringify({ prompt: txt }) });
  }, [victim, "ZZ_QA reworded prompt"]);

  const afterEdit = (await rest(p, `ask_scorecards?select=total&id=eq.${card}`))[0];
  check("rewording a question does not move a finished scorecard's total",
        afterEdit.total === late.body.total, `${late.body.total} → ${afterEdit.total}`);
  const stored = (await rest(p, `ask_scores?select=question_text&scorecard_id=eq.${card}&question_id=eq.${victim}`))[0];
  check("and the answer still reads against the wording it was scored against",
        stored.question_text === originalPrompt,
        `kept "${(stored.question_text || "").slice(0, 45)}…"`);

  await p.evaluate(async ([id, txt]) => {
    await fetch(`${SUPABASE_URL}/rest/v1/ask_questions?id=eq.${id}`, { method: "PATCH",
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${sessionStorage.getItem("nikash_token")}`,
        "Content-Type": "application/json" }, body: JSON.stringify({ prompt: txt }) });
  }, [victim, originalPrompt]);

  // ══ 10. ON THE CANDIDATE PAGE ════════════════════════════════════════════
  await p.goto(`${B}/nikash.html`, { waitUntil: "domcontentloaded" });
  await p.waitForSelector("#v-signin:not([hidden]), #v-reqs:not([hidden])", { timeout: 20000 });
  if (await p.isVisible("#v-signin")) {
    await p.fill("#si-email", E); await p.fill("#si-pass", P); await p.click("#btn-signin");
    await p.waitForSelector("#v-reqs:not([hidden])", { timeout: 20000 });
  }
  await p.click("#nav-queue"); await p.waitForSelector("#v-queue:not([hidden])", { timeout: 20000 });
  await p.waitForTimeout(1500);

  const queueTxt = (await p.textContent("#queue-list")).replace(/\s+/g, " ");
  check("the queue row carries an ASK chip beside the match percentage",
        /ASK R2 [\d.]+%/.test(queueTxt), (queueTxt.match(/ASK R2 [\d.]+%[^·]*/) || [""])[0].slice(0, 60));

  await p.click(`#queue-list [data-cand="${target.id}"]`);
  await p.waitForSelector("#v-cand:not([hidden])", { timeout: 20000 });
  await p.waitForTimeout(1000);
  const cd = (await p.textContent("#cd-body")).replace(/\s+/g, " ");

  check("the candidate page shows the ASK scorecard",
        /ASK interview/.test(cd) && /R2 — full/.test(cd) && /Priority attributes/.test(cd), "");
  check("with who ran it and when",
        /run by /.test(cd), (cd.match(/run by [^·]{0,40}/) || [""])[0]);
  check("and the outstanding reference question is called out",
        /reference question/.test(cd), (cd.match(/\d+ reference question[^<]{0,20}/) || [""])[0]);
  check("the disagreement block explains what a gap means",
        /Where the interview and the questionnaire disagree/.test(cd) &&
        /one of them is wrong/.test(cd), "");
  check("and says the threshold is provisional rather than derived",
        /stated guess rather than a derived one/.test(cd), "");
  check("gaps are shown with both readings side by side",
        /ASK \d+% \(\d+\/\d+\) vs .+ \d+\. \d+ points apart|ASK \d+%/.test(cd),
        (cd.match(/ASK \d+% \([^)]*\) vs [^.]{0,40}/) || [""])[0]);
  check("running ASK is offered from the candidate page",
        (await p.$$('#cd-body a[href^="ask.html"]')).length >= 2, "");

  // The nine dimensions must not have grown an ASK attribute.
  const dims = await p.evaluate(() =>
    [...document.querySelectorAll("#cd-body .dim .cand-name")].map(n => n.textContent.trim()));
  check("ASK attributes did not leak into the nine dimensions",
        dims.length === 9 && !dims.some(d => /Coachability$/.test(d) && dims.filter(x => x === d).length > 1),
        `${dims.length} dimensions`);

  // ══ 11. STILL SOUND ══════════════════════════════════════════════════════
  const anon = await p.evaluate(async () => {
    const g = async (fn, body) => { const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: "POST",
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
      return { s: r.status, t: (await r.text()).slice(0, 200) }; };
    const tbl = await fetch(`${SUPABASE_URL}/rest/v1/ask_questions?select=prompt`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } });
    return { bank: await g("get_ask_bank", { p_round: "r2" }),
             tableStatus: tbl.status,
             start: await g("start_ask", { p_candidate_id: "00000000-0000-0000-0000-000000000000", p_round: "r2" }),
             staff: await g("list_staff", {}),
             add: await g("add_staff", { p_email: "a@b.com", p_name: "A", p_role: "admin" }),
             table: { s: tbl.status, n: ((await tbl.json()) || []).length } };
  });
  // Read the STATUS. A refused request returns an error object, so asking it for
  // .length gave undefined and the assertion failed on a correct refusal — the
  // test reporting a hole that was not there.
  check("the ASK bank is not readable without a session",
        refused(anon.bank.s, anon.bank.t) && anon.tableStatus >= 400,
        `rpc ${anon.bank.s}, table ${anon.tableStatus}`);
  check("and nobody can start a scorecard or add staff anonymously",
        refused(anon.start.s, anon.start.t) && refused(anon.staff.s, anon.staff.t) &&
        refused(anon.add.s, anon.add.t),
        JSON.stringify({ start: anon.start.s, list: anon.staff.s, add: anon.add.s }));

  const audits = await p.evaluate(async () => {
    const g = async (v) => (await (await fetch(`${SUPABASE_URL}/rest/v1/${v}?select=*`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${sessionStorage.getItem("nikash_token")}` } })).json()).length;
    return { bypass: await g("v_rls_bypass_audit"), c10: await g("v_c10_audit"),
             empty: await g("v_empty_profile_audit"), fn: await g("v_function_grant_audit"),
             lockout: await g("v_staff_lockout_audit") };
  });
  check("every audit is empty", Object.values(audits).every(n => n === 0), JSON.stringify(audits));
  check("no JS errors", errs.length === 0, errs.join(" | "));

}, async ({ p, check }) => {
  // Cleanup runs on the failure path too — the harness puts it in a `finally`.
  // An earlier version of this suite deleted its fixtures only after the last
  // assertion passed, so one aborted run left three synthetic candidates behind
  // and broke a different suite on the next pass.
  await cleanup(p);
  const left = await rest(p, "ask_scorecards?select=id&client_context=like.ZZ_QA*");
  check("the test cleans up after itself", left.length === 0, `${left.length} left behind`);
});
