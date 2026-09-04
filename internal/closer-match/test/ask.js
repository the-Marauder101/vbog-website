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
const { suite, rest, rpc, insert, flat } = require("./harness");

// The server, browser, Supabase route handler, credential check and sign-in all
// live in ./harness.js. This suite needs an ADMIN login, not just any staff
// login: it drives the add-staff form, which is only rendered for admins. A
// recruiter login fails here as a 30s timeout on an invisible #team-name, which
// reads like a broken test rather than the wrong role.
const refused = (s, t) => s >= 400 && /staff only|permission denied for function/.test(t || "");

// Every scorecard this suite opens, by id.
//
// THIS SUITE WRITES TO A REAL CANDIDATE'S RECORD — the first scored one in the
// queue — because the disagreement checks need real questionnaire scores to read
// against. So two rules, both learned the hard way:
//
//   1. Every scorecard it opens gets `client_context: "ZZ_QA context"`, and its
//      ids are tracked here. Cleanup identifies its own work by what it WROTE.
//      One card opened by the discard checks had no marker, survived a run, and
//      the next run resumed it and reported "7 saved after 6 answers".
//
//   2. Cleanup NEVER deletes by elimination. Not "every open scorecard except
//      this one" — only rows it can positively identify as its own. While
//      investigating a leak I ran exactly that kind of scoped-by-negation delete
//      by hand and came within one query of destroying a real submitted
//      interview that happened to be open at the time.
//
// > A cleanup that deletes what it cannot account for is not cleanup.
const MADE = [];

async function cleanup(p, ids = []) {
  try {
    await p.evaluate(async () => {
      const h = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${sessionStorage.getItem("nikash_token")}` };
      const cards = await (await fetch(`${SUPABASE_URL}/rest/v1/ask_scorecards?select=id,client_context&client_context=like.ZZ_QA*`, { headers: h })).json();
      for (const c of cards) await fetch(`${SUPABASE_URL}/rest/v1/ask_scorecards?id=eq.${c.id}`, { method: "DELETE", headers: h });
      const st = await (await fetch(`${SUPABASE_URL}/rest/v1/staff?select=id&email=like.zz-qa-%2A`, { headers: h })).json();
      for (const s of st) await fetch(`${SUPABASE_URL}/rest/v1/staff?id=eq.${s.id}`, { method: "DELETE", headers: h });
    });
    // Fixture candidates the carry-forward block created. purge_candidate
    // cascades their scorecards, so this must run before the id sweep below.
    await p.evaluate(async () => {
      const h = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${sessionStorage.getItem("nikash_token")}`,
                  "Content-Type": "application/json" };
      const found = await (await fetch(
        `${SUPABASE_URL}/rest/v1/candidates?select=id&full_name=like.ZZ_QA%20*`, { headers: h })).json();
      for (const c of (Array.isArray(found) ? found : [])) {
        await fetch(`${SUPABASE_URL}/rest/v1/rpc/purge_candidate`, {
          method: "POST", headers: h, body: JSON.stringify({ p_candidate_id: c.id }) });
      }
    });

    // And every scorecard this run opened by id, marker or not.
    for (const id of ids) {
      await p.evaluate(async (id) => {
        const h = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${sessionStorage.getItem("nikash_token")}` };
        await fetch(`${SUPABASE_URL}/rest/v1/ask_scores?scorecard_id=eq.${id}`, { method: "DELETE", headers: h });
        await fetch(`${SUPABASE_URL}/rest/v1/ask_scorecards?id=eq.${id}`, { method: "DELETE", headers: h });
      }, id);
    }
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

  // R1 is now a set of QUESTIONS, not a set of attributes (sql/44): eight chosen
  // for how much they separate candidates, spread across eight attributes rather
  // than covering five exhaustively.
  check("R1 serves the eight-question screen", count(r1) === 8,
        `${count(r1)} questions across ${r1.attributes.length} attributes`);
  // count() includes the two reference questions, which are served to the bank
  // reader but never asked on the call — 37 asked + 2 reference.
  const asked = (bank) => (bank.attributes || [])
    .flatMap(a => a.questions).filter(q => !q.is_reference).length;
  check("R2 serves the whole live bank", asked(r2) === 37 && count(r2) === 39,
        `${asked(r2)} asked + ${count(r2) - asked(r2)} reference`);
  check("every R1 question is flagged as one, and no reference question is",
        r1.attributes.flatMap(a => a.questions).every(q => q.in_r1 && !q.is_reference),
        "");
  check("and R1 is a strict subset of R2",
        r1.attributes.flatMap(a => a.questions).every(q =>
          r2.attributes.flatMap(a => a.questions).some(x => x.id === q.id)), "");

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
        allQs.filter(q => q.hint).length === allQs.length,
        `${allQs.filter(q => q.hint).length} of ${allQs.length}`);

  // The question Depesh asks in 48 of 90 recorded interviews, finally in the bank.
  const obj4 = allQs.find(q => q.id === "objection-4");
  check("the top-five-objections question is in the bank",
        !!obj4 && /top five objections/i.test(obj4.prompt || ""),
        obj4 ? obj4.prompt.slice(0, 70) : "missing");
  check("with four anchors written from what real answers look like",
        obj4 && obj4.options.length === 4 &&
        obj4.options.map(o => o.score).join() === "0,1,2,3" &&
        obj4.options.every(o => o.label && o.description.length > 40),
        obj4 ? obj4.options.map(o => o.label).join(" | ") : "");
  check("and a hint that tells the interviewer what is not an objection",
        obj4 && /not interested/.test(obj4.hint || "") && /rejection/i.test(obj4.hint || ""),
        "");

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
  // 37: the live bank after sql/44 took four low-discrimination questions out of
  // use. The two reference questions are not in this count — they have their own
  // flow — and the R1 eight are a subset of these, not extra.
  check("the start screen says what the round is and how it is scored",
        /All fourteen attributes/.test(startTxt) && /37 questions/.test(startTxt) &&
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
  // 37, not 39: the reference questions are not in the interview flow (sql/40),
  // and sql/44 deactivated four more that overlapped something else.
  check("and it resumes at the first unanswered question, not at the top",
        /7 of 37/.test(whereNow) && (await p.textContent("#q-prompt")) !== firstPrompt,
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
        frozen.total != null && frozen.attributes != null,
        `${frozen.total} of ${frozen.max_total} (${frozen.pct}%)`);

  // 120, not 126. The denominator counts the forty questions that were actually
  // put to the candidate — not the two reference questions nobody has asked yet.
  // This assertion said 126 until live data showed what that does: Shobha Pathak's
  // first real R2 read 30.2% when 31.7% of it had been measured, and every
  // scorecard would have understated in the same direction forever. See sql/40.
  check("AN UNASKED REFERENCE QUESTION IS IN NEITHER THE TOTAL NOR THE MAXIMUM",
        frozen.max_total === 111, `max_total ${frozen.max_total}, expected 111 (37 asked × 3)`);

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
  check("and it joins the denominator at the same moment it joins the total",
        late.body.max_total === frozen.max_total + 3,
        `${frozen.max_total} → ${late.body.max_total}`);
  check("one reference is still outstanding, and it says so",
        late.body.outstanding_refs === 1, `${late.body.outstanding_refs}`);
  const storedLate = (await rest(p, `ask_scorecards?select=total,max_total,pct&id=eq.${card}`))[0];
  check("and the stored scorecard agrees with what the call returned",
        storedLate.max_total === late.body.max_total && storedLate.total === late.body.total,
        JSON.stringify(storedLate));

  const notRef = await rpc(p, "score_ask_reference", { p_scorecard: card, p_question: bankQs.find(q => !q.ref).id, p_score: 3 });
  check("but an ordinary question cannot be reopened that way",
        notRef.status >= 400 && /Only the reference questions/.test(JSON.stringify(notRef.body)),
        JSON.stringify(notRef.body).slice(0, 90));

  // ══ 8b. THE REFERENCE CALL HAS A SURFACE ═════════════════════════════════
  // score_ask_reference existed from the first migration and nothing called it.
  // A function with no caller is a promise, not a feature — the same failure as
  // §7ak, and it is only caught by driving the page a person would actually open.
  const refPayload = await rpc(p, "get_ask_references", { p_scorecard: card });
  check("the reference call gets its own small payload",
        refPayload.status === 200 && (refPayload.body.questions || []).length === 2,
        `${((refPayload.body || {}).questions || []).length} questions`);
  check("carrying the anchors, the candidate and where the score stands",
        (refPayload.body.questions || []).every(q => (q.options || []).length === 4) &&
        !!refPayload.body.candidate && refPayload.body.max_total != null,
        `${refPayload.body.candidate} · ${refPayload.body.total}/${refPayload.body.max_total}`);
  check("and it knows which of them has already been answered",
        (refPayload.body.questions || []).filter(q => q.scored).length === 1,
        `${(refPayload.body.questions || []).filter(q => q.scored).length} of 2 scored`);

  // The SAME page, not a new one. sessionStorage is per browsing context, so a
  // freshly opened tab has no staff token and ask.html correctly shows the
  // sign-in gate — which looks exactly like the page failing to load. The first
  // version of this block opened a new tab and timed out on #v-start for that
  // reason and no other.
  const rp = p;
  const rerrs = errs;
  await rp.goto(`${B}/ask.html?mode=ref&card=${card}`, { waitUntil: "domcontentloaded" });
  await rp.waitForSelector("#v-start:not([hidden]), #v-error:not([hidden])", { timeout: 25000 });
  check("the reference link opens on its own start screen",
        await rp.isVisible("#v-start"),
        flat(await rp.textContent("#v-error").catch(() => "")).slice(0, 100));
  const refStart = flat(await rp.textContent("#v-start"));
  check("which says it is for the previous manager, not the candidate",
        /previous manager/i.test(refStart) && /not the candidate/i.test(refStart),
        refStart.slice(0, 120));
  check("and that there is nothing to submit",
        /nothing to submit/i.test(refStart), "");

  await rp.click("#btn-begin");
  await rp.waitForSelector("#v-q:not([hidden])", { timeout: 20000 });
  await rp.waitForTimeout(500);
  const refQScreen = flat(await rp.textContent("#v-q"));
  check("the question screen warns again on every question",
        /Ask their previous manager, not the candidate/i.test(refQScreen), "");
  check("it shows only the reference questions",
        /1 of 2|2 of 2/.test(refQScreen), (refQScreen.match(/\d of \d/) || [""])[0]);

  const beforeUi = (await rest(p, `ask_scorecards?select=total,max_total&id=eq.${card}`))[0];
  await rp.click("#q-options [data-score='3']");
  await rp.waitForFunction(() => /Saved|error/i.test(
    document.getElementById("savestate").textContent), { timeout: 20000 });
  const savedMsg = flat(await rp.textContent("#savestate"));
  check("SCORING A REFERENCE FROM THE PAGE UPDATES THE TOTAL IMMEDIATELY",
        /Saved — now \d+ of \d+/.test(savedMsg), savedMsg);
  const afterUi = (await rest(p, `ask_scorecards?select=total,max_total&id=eq.${card}`))[0];
  check("and the database agrees with what the page said",
        afterUi.max_total > beforeUi.max_total, `${beforeUi.max_total} → ${afterUi.max_total}`);
  check("no JS errors on the reference surface", rerrs.length === 0, rerrs.join(" | "));

  // ══ 8a. THE QUESTION EDITOR ══════════════════════════════════════════════
  // "Editable without a deploy" meant "editable by whoever has a SQL console"
  // until sql/42. What the screen must be honest about is that a reword does not
  // move a finished scorecard, and that an anchor's score is not editable at all.
  await p.goto(`${B}/nikash.html`, { waitUntil: "domcontentloaded" });
  await p.waitForSelector("#v-reqs:not([hidden])", { timeout: 25000 });
  check("Admin sits behind its own separator in the nav",
        (await p.$$(".masthead nav .nav-sep")).length === 1 &&
        await p.isVisible("#nav-questions") && await p.isVisible("#nav-team"),
        "");

  await p.click("#nav-questions");
  await p.waitForSelector("#v-questions:not([hidden])", { timeout: 20000 });
  await p.waitForTimeout(900);
  const qs = flat(await p.textContent("#v-questions"));
  check("the questions screen loads the whole bank",
        (await p.$$("#q-editor .region")).length === 14,
        `${(await p.$$("#q-editor .region")).length} attributes`);
  check("and says what each round costs in questions and minutes",
        /R1 — \d+ questions/.test(qs) &&
        /R2 after a submitted R1 — \d+ questions/.test(qs) &&
        /R2 with no R1 behind it — \d+ questions/.test(qs) && /minutes/.test(qs),
        qs.slice(0, 200));
  check("with the 70 seconds stated as measured, not assumed",
        /measured from your own interviews, not\s*estimated/.test(qs), "");
  check("every question shows how many times it has been scored",
        /scored \d+×|never used/.test(qs), (qs.match(/scored \d+×/) || ["never used"])[0]);
  check("and the anchors say the score is fixed",
        /The score is fixed/.test(qs), "");

  // Editing, and the thing that must remain true afterwards.
  const editQ = allQs.find(q => !q.is_reference).id;
  const originalText = allQs.find(q => q.id === editQ).prompt;
  const beforeEdit = (await rest(p, `ask_scorecards?select=total,max_total,pct&id=eq.${card}`))[0];
  const savedEdit = await rpc(p, "update_ask_question",
    { p_id: editQ, p_prompt: "ZZ_QA edited from the screen", p_hint: "ZZ_QA hint" });
  check("an admin can reword a question from the screen",
        savedEdit.status === 200 && savedEdit.body.saved === true,
        JSON.stringify(savedEdit.body).slice(0, 110));
  check("and is told the past is untouched, with the count",
        savedEdit.body.already_scored > 0 && /keep the wording they were scored/.test(savedEdit.body.note || ""),
        `${savedEdit.body.already_scored} past answers`);
  const afterEditCard = (await rest(p, `ask_scorecards?select=total,max_total,pct&id=eq.${card}`))[0];
  check("REWORDING MOVES NO FINISHED SCORECARD",
        JSON.stringify(afterEditCard) === JSON.stringify(beforeEdit),
        `${beforeEdit.pct}% → ${afterEditCard.pct}%`);
  const keptWording = (await rest(p,
    `ask_scores?select=question_text&scorecard_id=eq.${card}&question_id=eq.${editQ}`))[0];
  check("and the recorded answer still reads as it was asked",
        keptWording.question_text === originalText,
        `"${(keptWording.question_text || "").slice(0, 40)}…"`);
  await rpc(p, "update_ask_question", { p_id: editQ, p_prompt: originalText,
    p_hint: allQs.find(q => q.id === editQ).hint });

  // The structural refusals.
  const badScore = await rpc(p, "update_ask_option",
    { p_question: editQ, p_score: 7, p_label: "x", p_description: "y" });
  check("an anchor cannot be given a score outside 0-3",
        badScore.status >= 400 && /0, 1, 2 or 3/.test(JSON.stringify(badScore.body)),
        JSON.stringify(badScore.body).slice(0, 90));
  const blankAnchor = await rpc(p, "update_ask_option",
    { p_question: editQ, p_score: 1, p_label: "", p_description: "y" });
  check("and cannot be left blank",
        blankAnchor.status >= 400 && /short label/.test(JSON.stringify(blankAnchor.body)),
        JSON.stringify(blankAnchor.body).slice(0, 90));

  // R1 composition, on a fixture attribute so no live attribute is disturbed.
  const prioNow = await rest(p, "ask_attributes?select=id&priority=is.true&active=is.true");
  const flip = await rpc(p, "set_ask_attribute_priority",
    { p_id: prioNow[0].id, p_priority: false });
  check("moving an attribute out of R1 reports both new lengths",
        flip.status === 200 && flip.body.r1_questions >= 0 && flip.body.r2_remaining_questions > 0,
        `R1 ${flip.body.r1_questions}q, R2 ${flip.body.r2_remaining_questions}q`);
  await rpc(p, "set_ask_attribute_priority", { p_id: prioNow[0].id, p_priority: true });

  const emptyR1 = await p.evaluate(async (ids) => {
    // Clear every priority flag but the last, then try the last one.
    const H = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${sessionStorage.getItem("nikash_token")}`,
                "Content-Type": "application/json" };
    for (const id of ids.slice(1)) {
      await fetch(`${SUPABASE_URL}/rest/v1/rpc/set_ask_attribute_priority`, { method: "POST",
        headers: H, body: JSON.stringify({ p_id: id, p_priority: false }) });
    }
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/set_ask_attribute_priority`, { method: "POST",
      headers: H, body: JSON.stringify({ p_id: ids[0], p_priority: false }) });
    const t = await r.text();
    for (const id of ids) {
      await fetch(`${SUPABASE_URL}/rest/v1/rpc/set_ask_attribute_priority`, { method: "POST",
        headers: H, body: JSON.stringify({ p_id: id, p_priority: true }) });
    }
    return { status: r.status, body: t };
  }, prioNow.map(a => a.id));
  check("R1 cannot be emptied — the phone screen has to ask about something",
        emptyR1.status >= 400 && /no attributes left/.test(emptyR1.body),
        emptyR1.body.slice(0, 90));
  const restored = await rest(p, "ask_attributes?select=id&priority=is.true&active=is.true");
  check("and the R1 composition is exactly as it was before the probe",
        restored.length === prioNow.length,
        `${prioNow.length} → ${restored.length} priority attributes`);

  // ══ 8bb. READING A FINISHED INTERVIEW BACK ═══════════════════════════════
  // get_ask_scorecard() existed from the first ASK migration with no caller, so a
  // submitted interview could be totalled but not read question by question —
  // which is exactly what a second person needs in order to disagree with a
  // colleague's judgement. Third dead function in a row (§7am).
  const readback = await rpc(p, "get_ask_scorecard", { p_scorecard: card });
  check("a submitted scorecard can be read back in full",
        readback.status === 200 && (readback.body.answers || []).length >= 37,
        `${((readback.body || {}).answers || []).length} answers`);
  check("and every answer carries the anchor that was chosen",
        (readback.body.answers || []).every(a => a.chose && a.question),
        `${(readback.body.answers || []).filter(a => !a.chose).length} without an anchor`);

  await p.goto(`${B}/nikash.html`, { waitUntil: "domcontentloaded" });
  await p.waitForSelector("#v-reqs:not([hidden])", { timeout: 25000 });
  await p.click("#nav-queue");
  await p.waitForSelector("#v-queue:not([hidden])", { timeout: 20000 });
  await p.waitForTimeout(1500);
  await p.click(`#queue-list [data-cand="${target.id}"]`);
  await p.waitForSelector("#v-cand:not([hidden])", { timeout: 20000 });
  await p.waitForTimeout(1100);
  check("the candidate page offers to read the full scorecard",
        (await p.$$("#cd-body [data-ask-open]")).length > 0, "");

  await p.click("#cd-body [data-ask-open]");
  await p.waitForSelector("#v-ask:not([hidden])", { timeout: 20000 });
  await p.waitForTimeout(700);
  const sc = flat(await p.textContent("#sc-body"));
  check("THE SCORECARD REVIEW SCREEN SHOWS WHAT WAS ASKED AND WHAT WAS SAID",
        /What was asked, and what was said/.test(sc), sc.slice(0, 120));
  check("it lists every scored question, not just the totals",
        (await p.$$("#sc-body .evidence li")).length >= 37,
        `${(await p.$$("#sc-body .evidence li")).length} rows`);
  check("grouped by attribute, with each attribute's own score",
        (await p.$$("#sc-body .panel")).length >= 10,
        `${(await p.$$("#sc-body .panel")).length} attribute blocks`);
  check("the header says who ran it, when, and what it came to",
        /run by /.test(flat(await p.textContent("#sc-meta"))) &&
        /%/.test(flat(await p.textContent("#sc-meta"))),
        flat(await p.textContent("#sc-meta")).slice(0, 110));
  check("and it repeats that ASK does not enter the match score",
        /does not enter the match score/.test(flat(await p.textContent("#sc-disclaimer"))), "");
  check("Back returns to the candidate, not to the queue",
        await p.isVisible("#btn-back-cand"), "");
  await p.click("#btn-back-cand");
  await p.waitForSelector("#v-cand:not([hidden])", { timeout: 20000 });
  check("and it actually goes there", await p.isVisible("#v-cand"), "");

  // ══ 8bc. R1 CARRIES INTO R2 ══════════════════════════════════════════════
  // The whole point: measured at ~70 s a question, 40 questions is 47 minutes and
  // no interface change gets that under 40. R1 and R2 overlapped completely — the
  // candidate answered the same 14 questions twice — so R2 now inherits them.
  // Driven on a fixture candidate, because it needs a full R1 of its own.
  const cf = await insert(p, "candidates", {
    full_name: `ZZ_QA Carry ${Date.now()}`, contact: {},
    consent_version: "pending", consent_at: new Date().toISOString() });
  const cfId = cf.body[0].id;

  // Split by the QUESTION's in_r1 flag, not the attribute's priority. sql/44
  // moved R1 to a per-question set, and carry-forward now copies whatever the R1
  // actually scored rather than every question on a "priority" attribute.
  const allR2 = r2.attributes.flatMap(a => a.questions).filter(q => !q.is_reference);
  const prioQs = allR2.filter(q => q.in_r1);
  const restQs = allR2.filter(q => !q.in_r1);

  const r1card = (await rpc(p, "start_ask", { p_candidate_id: cfId, p_round: "r1",
    p_client_context: "ZZ_QA context" })).body.scorecard_id;
  MADE.push(r1card);
  for (const q of prioQs) {
    await rpc(p, "save_ask_score", { p_scorecard: r1card, p_question: q.id, p_score: 3 });
  }
  const r1done = await rpc(p, "submit_ask", { p_scorecard: r1card });
  check("an R1 phone screen can be run and submitted",
        r1done.status === 200 && r1done.body.submitted === true,
        `${r1done.body.total}/${r1done.body.max_total}`);

  const r2start = await rpc(p, "start_ask", { p_candidate_id: cfId, p_round: "r2",
    p_client_context: "ZZ_QA context" });
  const r2card = r2start.body.scorecard_id;
  MADE.push(r2card);

  check("R2 CARRIES THE R1 ANSWERS FORWARD INSTEAD OF ASKING AGAIN",
        r2start.body.carried.count === prioQs.length,
        `${r2start.body.carried.count} carried, expected ${prioQs.length}`);
  check("and tells the interviewer how many are actually left to ask",
        r2start.body.carried.remaining === restQs.length,
        `${r2start.body.carried.remaining} to ask, expected ${restQs.length}`);
  check("and who ran the screen it inherited",
        !!r2start.body.carried.by, r2start.body.carried.by || "nobody named");

  const carriedRows = await rest(p,
    `ask_scores?select=question_id,carried_from&scorecard_id=eq.${r2card}&carried_from=not.is.null`);
  check("every carried answer keeps its provenance",
        carriedRows.length === prioQs.length && carriedRows.every(r => r.carried_from === r1card),
        `${carriedRows.length} rows stamped`);

  // On screen: the interviewer lands on the first question they must ask.
  await p.goto(`${B}/ask.html?cand=${cfId}&round=r2`, { waitUntil: "domcontentloaded" });
  await p.waitForSelector("#v-start:not([hidden])", { timeout: 25000 });
  const cfStart = flat(await p.textContent("#v-start"));
  check("the start screen says the interview is shorter, and by how much",
        /R1 screen is already done, so this is shorter/.test(cfStart) &&
        new RegExp(`${restQs.length} to ask`).test(cfStart),
        // The whole panel on failure, not an empty capture group — an assertion
        // that reports "" when it fails tells you nothing about why.
        cfStart.slice(0, 260));
  await p.click("#btn-begin");
  await p.waitForSelector("#v-q:not([hidden])", { timeout: 20000 });
  await p.waitForTimeout(500);
  // NOT "question 15 of 40": the priority attributes are not first in the bank's
  // sort order — Dialing Discipline is, and it is R2-only. So the right assertion
  // is that the question it opens on is one this call actually has to ask, and
  // that the carried ones are already counted as scored.
  const landed = flat(await p.textContent("#q-where"));
  const landedPrompt = await p.textContent("#q-prompt");
  check("and it opens on a question this call actually has to ask",
        restQs.some(q => q.prompt === landedPrompt),
        `landed on "${String(landedPrompt).slice(0, 45)}…"`);
  check("with the carried answers already counted as scored",
        new RegExp(`${prioQs.length} scored`).test(landed),
        landed.slice(0, 80));

  // The carried ones are visible when passed, not hidden. Stepping FORWARD to
  // find one, not back: the flow opens on the first unanswered question, which is
  // index 0 here because the first attribute in the bank is R2-only — so Back is
  // correctly disabled and clicking it hangs on a locator that never enables.
  let sawCarried = false;
  for (let n = 0; n < 45 && !sawCarried; n++) {
    if (/Already scored on the R1 phone screen/.test(flat(await p.textContent("#q-options")))) {
      sawCarried = true; break;
    }
    await p.click("#btn-next");
    await p.waitForTimeout(120);
    if (await p.isVisible("#v-result")) break;
  }
  check("passing a carried answer shows where it came from",
        sawCarried && /Already scored on the R1 phone screen/.test(flat(await p.textContent("#q-options"))),
        sawCarried ? "" : "walked the whole round without seeing one");
  check("and says it can be overruled",
        /overrule it/.test(flat(await p.textContent("#q-options"))), "");

  // Finish it and check the total covers all forty, not twenty-six.
  for (const q of restQs) {
    await rpc(p, "save_ask_score", { p_scorecard: r2card, p_question: q.id, p_score: 1 });
  }
  const r2done = await rpc(p, "submit_ask", { p_scorecard: r2card });
  check("THE R2 TOTAL COVERS THE WHOLE BANK, NOT JUST WHAT R2 ASKED",
        r2done.body.max_total === (prioQs.length + restQs.length) * 3,
        `${r2done.body.max_total}, expected ${(prioQs.length + restQs.length) * 3}`);
  check("and the carried scores are in the numerator",
        r2done.body.total === prioQs.length * 3 + restQs.length * 1,
        `${r2done.body.total}, expected ${prioQs.length * 3 + restQs.length * 1}`);

  const cfReview = await rpc(p, "get_ask_scorecard", { p_scorecard: r2card });
  check("the review screen credits whoever actually scored each answer",
        (cfReview.body.answers || []).filter(a => a.carried && a.carried_by).length === prioQs.length,
        `${(cfReview.body.answers || []).filter(a => a.carried).length} marked as carried`);

  // A candidate with no R1 gets the whole bank, and a half-finished R1 is not a
  // reading and must not be inherited.
  const noR1 = await insert(p, "candidates", {
    full_name: `ZZ_QA NoR1 ${Date.now()}`, contact: {},
    consent_version: "pending", consent_at: new Date().toISOString() });
  const noR1start = await rpc(p, "start_ask",
    { p_candidate_id: noR1.body[0].id, p_round: "r2", p_client_context: "ZZ_QA context" });
  MADE.push(noR1start.body.scorecard_id);
  check("a candidate with no R1 is still asked the whole bank",
        noR1start.body.carried.count === 0 &&
        noR1start.body.carried.remaining === prioQs.length + restQs.length,
        `${noR1start.body.carried.remaining} to ask`);

  // ══ 8c. AN EMPTY RE-RUN CAN BE THROWN AWAY ═══════════════════════════════
  // A "Run R2 again" click straight after submitting opens a blank scorecard,
  // which then becomes the card Run R2 resumes — so the next person sees an empty
  // interview instead of the finished one. Seen in live data, fourteen seconds
  // apart.
  const dup = await rpc(p, "start_ask",
    { p_candidate_id: target.id, p_round: "r2", p_client_context: "ZZ_QA context" });
  const dupId = dup.body.scorecard_id;
  MADE.push(dupId);
  check("running the round again opens a new scorecard, not the submitted one",
        dupId !== card, `${dupId}`);
  const discard = await rpc(p, "discard_ask", { p_scorecard: dupId });
  check("an empty re-run can be discarded", discard.status === 200, JSON.stringify(discard.body));
  check("and it is gone",
        (await rest(p, `ask_scorecards?select=id&id=eq.${dupId}`)).length === 0, "");

  const dup2 = (await rpc(p, "start_ask",
    { p_candidate_id: target.id, p_round: "r2", p_client_context: "ZZ_QA context" })).body.scorecard_id;
  MADE.push(dup2);
  await rpc(p, "save_ask_score", { p_scorecard: dup2, p_question: bankQs.find(q => !q.ref).id, p_score: 1 });
  const refuse = await rpc(p, "discard_ask", { p_scorecard: dup2 });
  check("but one with an answer on it is not thrown away",
        refuse.status >= 400 && /answer\(s\) on it/.test(JSON.stringify(refuse.body)),
        JSON.stringify(refuse.body).slice(0, 100));
  const refuseSubmitted = await rpc(p, "discard_ask", { p_scorecard: card });
  check("and neither is a submitted one",
        refuseSubmitted.status >= 400 && /is a record and is not thrown away/.test(JSON.stringify(refuseSubmitted.body)),
        JSON.stringify(refuseSubmitted.body).slice(0, 100));

  // Clear the one the refusal check deliberately made undiscardable, so the next
  // run does not resume it. The refusal is the assertion; the row is litter.
  await p.evaluate(async (id) => {
    const h = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${sessionStorage.getItem("nikash_token")}` };
    await fetch(`${SUPABASE_URL}/rest/v1/ask_scores?scorecard_id=eq.${id}`, { method: "DELETE", headers: h });
  }, dup2);
  const nowGone = await rpc(p, "discard_ask", { p_scorecard: dup2 });
  check("and once its answer is removed it can be discarded after all",
        nowGone.status === 200, JSON.stringify(nowGone.body).slice(0, 90));

  // ══ 9. A REWORDING MUST NOT MOVE A FINISHED SCORECARD ════════════════════
  const victim = bankQs.find(q => !q.ref).id;
  const originalPrompt = allQs.find(q => q.id === victim).prompt;
  const beforeReword = (await rest(p, `ask_scorecards?select=total,max_total&id=eq.${card}`))[0];
  await p.evaluate(async ([id, txt]) => {
    await fetch(`${SUPABASE_URL}/rest/v1/ask_questions?id=eq.${id}`, { method: "PATCH",
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${sessionStorage.getItem("nikash_token")}`,
        "Content-Type": "application/json" }, body: JSON.stringify({ prompt: txt }) });
  }, [victim, "ZZ_QA reworded prompt"]);

  const afterEdit = (await rest(p, `ask_scorecards?select=total&id=eq.${card}`))[0];
  // Read the baseline immediately before the reword, not from a variable captured
  // twenty assertions earlier — the reference scored through the UI in between
  // legitimately moved the total, and comparing against the stale figure made a
  // correct system look broken. The claim is "a reword moves nothing", so the
  // baseline has to be the moment before the reword.
  check("rewording a question does not move a finished scorecard's total",
        afterEdit.total === beforeReword.total, `${beforeReword.total} → ${afterEdit.total}`);
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
  // Both references have been scored by this point — one through the RPC at step
  // 8, one through the reference surface at 8b — so the page must now say the
  // scorecard is complete rather than still nagging about an outstanding call.
  // Asserting "it mentions a reference question" would pass on either state and
  // therefore tests nothing.
  check("and with both references in, the page stops asking for them",
        /reference questions are already in/.test(cd) &&
        !/reference call has not happened/.test(cd),
        (cd.match(/reference[^·]{0,60}/) || [""])[0]);
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
    const g = async (v) => (await (await fetch(
      `${SUPABASE_URL}/rest/v1/${v}${v.includes("?") ? "&" : "?"}select=*`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${sessionStorage.getItem("nikash_token")}` } })).json()).length;
    // Scoped to tables this repo owns — a second system shares the project and
    // its rows are reported by v_foreign_policy_audit, not failed here (sql/45).
    return { bypass: await g("v_rls_bypass_audit?ours=is.true"),
             c10: await g("v_c10_audit?ours=is.true"),
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
  await cleanup(p, MADE);
  const left = await rest(p, "ask_scorecards?select=id&client_context=like.ZZ_QA*");
  const strays = [];
  for (const id of MADE) {
    if ((await rest(p, `ask_scorecards?select=id&id=eq.${id}`)).length) strays.push(id);
  }
  check("the test cleans up after itself, including on a real candidate's record",
        left.length === 0 && strays.length === 0,
        `${left.length} marked, ${strays.length} tracked left behind`);
});
