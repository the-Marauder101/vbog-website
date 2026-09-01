// ═══ ASK — the R2 interview scorecard ══════════════════════════════════════
//
// Ported from internal/ASK/index.html, which was a single self-contained file
// with the 42 questions hard-coded in it. They now come from the database
// (sql/35), so the team can reword a question without a deploy — and, more
// importantly, so a scorecard is attached to a candidate rather than to a JSON
// file on somebody's laptop.
//
// What is deliberately unchanged from the standalone tool: one question per
// screen, the four anchors as the only way to score, keyboard entry, per-question
// notes, and the priority attributes surfaced first in the result. That design
// worked; the problem was never the interview, it was everything around it.
//
// The one behavioural change: every answer is written the moment it is given,
// the way js/assess.js does it. An interview is a live call — the browser will
// be closed mid-flow, and losing twenty minutes of somebody's judgement because
// a laptop slept is not an acceptable failure.

const el = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const P = new URLSearchParams(location.search);
const CAND = P.get("cand");
const ROUND = (P.get("round") || "r2").toLowerCase() === "r1" ? "r1" : "r2";

// ── TWO MODES, ONE SCREEN ──────────────────────────────────────────────────
// `interview` is the call with the candidate. `reference` is the call with their
// previous manager, which happens days later or not at all, and which used to
// have nowhere to go: score_ask_reference() existed in the database from the
// start and nothing ever called it. See sql/40.
//
// The two share everything that matters — one question per screen, the four
// anchors, notes, keyboard entry — so reference mode is a different source and a
// different save call, not a second interview surface. Two surfaces would drift.
const MODE = P.get("mode") === "ref" ? "reference" : "interview";
const CARD = P.get("card");          // reference mode addresses a scorecard directly

const S = {
  scorecard: null,
  candidate: "",
  flat: [],        // every question in scope, flattened, in order
  answers: {},     // question_id -> { score, note }
  i: 0,
  bank: null,
  refs: null,      // reference mode: the get_ask_references payload
};

function view(name) {
  document.querySelectorAll(".screen").forEach((s) => (s.hidden = true));
  const t = el("v-" + name);
  if (t) t.hidden = false;
  window.scrollTo(0, 0);
}

function fail(msg) {
  el("error-text").textContent = msg;
  view("error");
}

function setSave(text, state) {
  const s = el("savestate");
  s.textContent = text;
  if (state) s.dataset.state = state; else delete s.dataset.state;
}

// ═══ THE BANK ══════════════════════════════════════════════════════════════

function flatten(bank) {
  const flat = [];
  (bank.attributes || []).forEach((a) => {
    (a.questions || []).forEach((q) => {
      // The two reference questions are put to the previous manager, not to the
      // person on the call. They used to sit inline in the interview with a note
      // saying "leave this unscored for now", which is a question you scroll past
      // forty times and then forget exists. They have their own flow now.
      if (q.is_reference) return;
      flat.push({ attr: a, q });
    });
  });
  return flat;
}

// ═══ ONE QUESTION ══════════════════════════════════════════════════════════

function render() {
  const item = S.flat[S.i];
  if (!item) return;
  const { attr, q } = item;
  const answered = S.answers[q.id];

  el("progress-fill").style.width =
    Math.round(((S.i + 1) / S.flat.length) * 100) + "%";

  const done = Object.keys(S.answers).length;
  el("q-where").innerHTML =
    `<strong>${esc(attr.name)}</strong> · ${esc(S.bank.sections[attr.section] || "")}` +
    `${attr.priority ? ` · <span class="chip">priority</span>` : ""}` +
    ` <span class="spacer"></span>` +
    `<span class="mono">${S.i + 1} of ${S.flat.length}</span> · ${done} scored`;

  el("q-prompt").textContent = q.prompt;

  // The hint is for the interviewer, never read out. It is what separates a
  // scorecard from a list of questions — it says what a real answer sounds like.
  el("q-hint").innerHTML = q.hint
    ? `<span class="label">What you're listening for</span>${esc(q.hint)}`
    : "";
  el("q-hint").hidden = !q.hint;

  // In reference mode every question is one for the previous manager, and saying
  // so on each screen is what stops it being read out to the wrong person.
  const refNote = MODE === "reference"
    ? `<div class="notice"><span class="label">Ask their previous manager, not the candidate</span>
       This is the reference call for ${esc(S.candidate)}. Each answer is saved and
       added to their ASK total the moment you score it — there is nothing to submit.</div>`
    : "";

  el("q-options").innerHTML = refNote + (q.options || []).map((o) => `
    <label class="option${answered && answered.score === o.score ? " selected" : ""}"
           data-score="${o.score}">
      <span class="opt-score mono">${o.score}</span>
      <span class="text"><strong>${esc(o.label)}</strong>
        <em>${esc(o.description)}</em></span>
    </label>`).join("");

  el("q-options").querySelectorAll("[data-score]").forEach((n) =>
    n.addEventListener("click", () => score(Number(n.dataset.score))));

  el("q-note").value = (answered && answered.note) || "";
  el("btn-prev").disabled = S.i === 0;
  el("btn-next").textContent = S.i === S.flat.length - 1 ? "See the scorecard" : "Next →";
  setSave("");
  view("q");
}

async function score(value) {
  const { q } = S.flat[S.i];
  S.answers[q.id] = { score: value, note: el("q-note").value.trim() || null };
  document.querySelectorAll("#q-options .option").forEach((n) =>
    n.classList.toggle("selected", Number(n.dataset.score) === value));
  await persist(q.id);
}

async function persist(questionId) {
  const a = S.answers[questionId];
  if (!a || a.score === undefined || a.score === null) return;
  setSave("Saving…");
  try {
    if (MODE === "reference") {
      // A reference lands on a scorecard that is usually already submitted, so it
      // cannot go through save_ask_score — that refuses to touch a finished one,
      // correctly. score_ask_reference is the one door that opens, and it returns
      // the recomputed total, which is worth showing immediately: the whole point
      // is that the number moves.
      const r = await sbRpc("score_ask_reference", {
        p_scorecard: S.scorecard,
        p_question: questionId,
        p_score: a.score,
        p_note: a.note,
      });
      S.latest = r;
      setSave(`Saved — now ${r.total} of ${r.max_total} (${r.pct}%)`, "saved");
      return;
    }
    await sbRpc("save_ask_score", {
      p_scorecard: S.scorecard,
      p_question: questionId,
      p_score: a.score,
      p_note: a.note,
    });
    setSave("Saved", "saved");
  } catch (e) {
    // Loud, because the alternative is an interviewer who thinks their last ten
    // answers are safe and finds out at the end that they are not.
    setSave(e.message, "error");
  }
}

async function move(delta) {
  const { q } = S.flat[S.i];
  const a = S.answers[q.id];
  const typed = el("q-note").value.trim() || null;
  if (a && a.note !== typed) { a.note = typed; await persist(q.id); }

  const next = S.i + delta;
  if (next < 0) return;
  if (next >= S.flat.length) return results();
  S.i = next;
  render();
}

// ═══ THE RESULT ════════════════════════════════════════════════════════════

// Computed here for the live view; the DB recomputes and freezes it on submit.
// The screen is a preview of an unsubmitted scorecard, not the record of one.
function tally() {
  const per = {};
  S.flat.forEach(({ attr, q }) => {
    const t = (per[attr.id] ||= { attr, score: 0, max: 0, unscored: 0 });
    t.max += 3;
    const a = S.answers[q.id];
    if (a && a.score !== undefined && a.score !== null) t.score += a.score;
    else t.unscored++;
  });
  const rows = Object.values(per);
  // `S.flat` no longer contains the reference questions in either mode, so this
  // counts only what was actually asked on this call — which is the same rule
  // recompute_ask_totals() applies in the database. The two have to agree or the
  // preview on screen and the frozen record disagree by two questions.
  return {
    rows,
    total: rows.reduce((n, r) => n + r.score, 0),
    max: rows.reduce((n, r) => n + r.max, 0),
    unscored: rows.reduce((n, r) => n + r.unscored, 0),
  };
}

function bar(r) {
  const pct = r.max ? Math.round((r.score / r.max) * 100) : 0;
  return `
  <div class="req">
    <span class="title">${esc(r.attr.name)}${r.attr.priority ? ` <span class="chip">priority</span>` : ""}</span>
    <span class="meta small">${esc(S.bank.sections[r.attr.section] || "")}${
      r.unscored ? ` · <strong>${r.unscored} unscored</strong>` : ""}</span>
    <span class="figures"><span class="figure">${r.score}</span
      ><span class="figure-unit">/${r.max}</span><br
      ><span class="mono muted">${pct}%</span></span>
  </div>`;
}

function results() {
  const t = tally();
  const pct = t.max ? Math.round((t.total / t.max) * 100) : 0;

  el("res-meta").innerHTML =
    `${esc(S.candidate)} · ${ROUND === "r1" ? "R1 — screen" : "R2 — full"}` +
    ` · ${S.flat.length} questions`;
  el("res-total").textContent = t.total;
  el("res-den").textContent = " / " + t.max;
  el("res-pct").textContent = pct;

  // Reference mode has no submit and no preview: every answer is already live on
  // the scorecard, so the screen reports where the real total stands.
  if (MODE === "reference") {
    const done = Object.keys(S.answers).length;
    const live = S.latest;
    el("res-refs").hidden = false;
    el("res-refs").innerHTML = live
      ? `<span class="label">Recorded — ${esc(S.candidate)} is now ${live.total} of ${live.max_total} (${live.pct}%)</span>
         ${live.outstanding_refs
           ? `${live.outstanding_refs} reference question${live.outstanding_refs > 1 ? "s" : ""} still to ask. Come back to this link when you have it.`
           : `Both reference questions are in. The scorecard is complete.`}`
      : `<span class="label">Nothing recorded yet</span>
         Score the ${S.flat.length} question${S.flat.length > 1 ? "s" : ""} above as the call goes.
         Each one saves and updates the total immediately.`;
    el("btn-submit").hidden = true;
    el("submit-state").textContent = `${done} of ${S.flat.length} reference questions scored`;
    return;
  }

  el("res-refs").hidden = false;
  el("res-refs").innerHTML = S.outstandingRefs
    ? `<span class="label">The reference questions are a separate call</span>
       ${S.outstandingRefs} question${S.outstandingRefs > 1 ? "s" : ""} go to their previous
       manager, not the candidate, and they are not asked here. They are counted neither
       for nor against — this percentage describes the interview that actually happened.
       Record them from ${esc(S.candidate)}'s page whenever that call comes, and the
       total updates then.`
    : `<span class="label">The reference questions are already in</span>
       Both have been scored, so this scorecard is complete.`;

  const pri = t.rows.filter((r) => r.attr.priority);
  el("res-pri-region").hidden = pri.length === 0;
  el("res-pri-count").textContent = `${pri.length}`;
  el("res-pri").innerHTML = pri.map(bar).join("");

  el("res-all-count").textContent = `${t.rows.length}`;
  el("res-all").innerHTML = t.rows.map(bar).join("");

  const noted = S.flat.filter(({ q }) => S.answers[q.id] && S.answers[q.id].note);
  el("res-notes-region").hidden = noted.length === 0;
  el("res-notes").innerHTML = noted.map(({ attr, q }) => `
    <div class="callout plain">
      <span class="label">${esc(attr.name)} — ${esc(q.prompt)}</span>
      ${esc(S.answers[q.id].note)}</div>`).join("");

  el("btn-submit").disabled = t.unscored > 0;
  el("submit-state").textContent = t.unscored
    ? `${t.unscored} question${t.unscored > 1 ? "s" : ""} still unscored`
    : "";
  delete el("submit-state").dataset.state;

  el("btn-to-cand").href = `nikash.html#cand-${encodeURIComponent(CAND)}`;
  view("result");
}

// ═══ WIRING ════════════════════════════════════════════════════════════════

el("btn-prev").addEventListener("click", () => move(-1));
el("btn-next").addEventListener("click", () => move(1));
el("btn-skip").addEventListener("click", () => move(1));
el("btn-back-qs").addEventListener("click", () => { S.i = 0; render(); });

el("q-note").addEventListener("blur", () => {
  const { q } = S.flat[S.i];
  const typed = el("q-note").value.trim() || null;
  const a = S.answers[q.id];
  // A note without a score has nowhere to live — save_ask_score needs both. The
  // note is kept in memory and written the moment the question is scored.
  if (a && a.note !== typed) { a.note = typed; persist(q.id); }
  else if (!a && typed) { S.answers[q.id] = { score: null, note: typed }; }
});

document.addEventListener("keydown", (e) => {
  if (el("v-q").hidden) return;
  if (e.target.tagName === "TEXTAREA" || e.target.tagName === "INPUT") return;
  if (e.key >= "0" && e.key <= "3") { e.preventDefault(); score(Number(e.key)); }
  else if (e.key === "ArrowRight") { e.preventDefault(); move(1); }
  else if (e.key === "ArrowLeft") { e.preventDefault(); move(-1); }
});

el("btn-submit").addEventListener("click", async () => {
  const b = el("btn-submit"), slot = el("submit-state");
  if (!confirm(
    `Submit this scorecard for ${S.candidate}?\n\n` +
    `The total is frozen at that point, so a later change to a question's wording ` +
    `cannot move it. To change an answer afterwards you run the round again.`)) return;
  b.disabled = true;
  slot.textContent = "Submitting…"; delete slot.dataset.state;
  try {
    const r = await sbRpc("submit_ask", { p_scorecard: S.scorecard });
    slot.textContent = `Submitted — ${r.total} of ${r.max_total} (${r.pct}%)` +
      (r.outstanding_refs ? ` · ${r.outstanding_refs} reference question(s) outstanding` : "");
    slot.dataset.state = "saved";
  } catch (e) {
    slot.textContent = e.message; slot.dataset.state = "error"; b.disabled = false;
  }
});

el("btn-begin").addEventListener("click", async () => {
  const b = el("btn-begin"); b.disabled = true;

  // Reference mode has nothing to start: the scorecard exists, the answers are
  // already loaded, and each score is written on the spot. Just show question one.
  if (MODE === "reference") {
    const firstUnanswered = S.flat.findIndex(({ q }) => !(q.id in S.answers));
    S.i = firstUnanswered === -1 ? 0 : firstUnanswered;
    b.disabled = false;
    return render();
  }

  try {
    const started = await sbRpc("start_ask", {
      p_candidate_id: CAND, p_round: ROUND,
      p_client_context: el("start-client").value.trim() || null,
    });
    S.scorecard = started.scorecard_id;
    S.answers = {};
    Object.entries(started.answered || {}).forEach(([k, v]) => (S.answers[k] = v));

    // Resume where they stopped, not at question one. A dropped call resumed from
    // the top is how an interviewer ends up re-asking things.
    const firstUnanswered = S.flat.findIndex(({ q }) => !(q.id in S.answers));
    S.i = firstUnanswered === -1 ? 0 : firstUnanswered;
    render();
  } catch (e) {
    fail(e.message); b.disabled = false;
  }
});

// ═══ BOOT ══════════════════════════════════════════════════════════════════

(async () => {
  view("loading");
  if (MODE === "reference" && !CARD) {
    return fail("This reference link has no scorecard on it. Open it from the candidate's page.");
  }
  if (MODE === "interview" && !CAND) {
    return fail("This link has no candidate on it. Open the scorecard from a candidate's page.");
  }
  if (!sbRestoreToken()) return view("gate");

  let me;
  try { me = await sbRpc("whoami"); } catch (_) { return view("gate"); }
  if (!me || me.staff !== true) {
    return fail((me && me.reason) || "This account is not a staff account.");
  }

  // ── REFERENCE MODE ───────────────────────────────────────────────────────
  // A much smaller boot: one call, two questions, no bank and no start_ask —
  // the scorecard already exists and is usually already submitted.
  if (MODE === "reference") {
    try {
      const r = await sbRpc("get_ask_references", { p_scorecard: CARD });
      S.refs = r;
      S.scorecard = r.scorecard_id;
      S.candidate = r.candidate || "this candidate";
      S.bank = { sections: {} };
      S.flat = (r.questions || []).map((q) => ({
        attr: { id: q.id, name: q.attribute, section: "", priority: false }, q,
      }));
      if (!S.flat.length) {
        return fail("This round has no reference questions.");
      }
      (r.questions || []).forEach((q) => {
        if (q.scored) S.answers[q.id] = { score: q.score, note: q.note || null };
      });

      el("start-title").textContent = `Reference call · ${S.candidate}`;
      el("start-sub").textContent =
        "For their previous manager — not the candidate.";
      el("start-scope").innerHTML =
        `<strong>${S.flat.length} question${S.flat.length > 1 ? "s" : ""}</strong>, scored 0–3 against the ` +
        `same written anchors as the interview. Each one saves and joins ` +
        `${esc(S.candidate)}'s ASK total the moment you score it — there is nothing to ` +
        `submit, and you can close this and come back.` +
        (r.pct != null
          ? ` They currently stand at <strong>${r.total} of ${r.max_total} (${r.pct}%)</strong> ` +
            `from the interview alone.`
          : "");

      const already = (r.questions || []).filter((q) => q.scored).length;
      if (already) {
        el("start-resume").hidden = false;
        el("start-resume").innerHTML =
          `<span class="label">${already} of ${S.flat.length} already recorded</span>
           Scoring one again replaces the previous answer and the total updates.`;
      }
      el("btn-begin").textContent = "Start the reference call →";
      return view("start");
    } catch (e) {
      return fail(e.message);
    }
  }

  try {
    S.bank = await sbRpc("get_ask_bank", { p_round: ROUND });
    S.flat = flatten(S.bank);
    if (!S.flat.length) return fail("The ASK question bank is empty.");

    // How many reference questions are in scope for this round but not asked
    // here. The results screen says so rather than leaving a reader to wonder
    // why the denominator is 120 and not 126.
    S.outstandingRefs = (S.bank.attributes || [])
      .flatMap((a) => a.questions || []).filter((q) => q.is_reference).length;

    // Peek at the scorecard state without creating one, so the start screen can
    // say whether this is a fresh run or a resume.
    const existing = await sbRpc("get_candidate_ask", { p_candidate_id: CAND });
    const open = (existing || []).find((c) => c.round === ROUND && !c.submitted_at);
    const done = (existing || []).filter((c) => c.round === ROUND && c.submitted_at);

    const [cand] = await sbFetch(`candidates?select=full_name&id=eq.${CAND}`);
    S.candidate = (cand && cand.full_name) || "this candidate";

    el("start-title").textContent =
      `${ROUND === "r1" ? "R1 — screen" : "R2 — full"} · ${S.candidate}`;
    el("start-sub").textContent = ROUND === "r1"
      ? "The five priority attributes. Sized for a 20–25 minute call."
      : "All fourteen attributes. Behavioural validation and client fit — run this once they have cleared R1.";
    el("start-scope").innerHTML =
      `<strong>${S.flat.length} questions</strong> across ` +
      `<strong>${(S.bank.attributes || []).length} attributes</strong>. ` +
      `Each is scored 0–3 against a written anchor — you pick the description that ` +
      `matches what they actually said, rather than forming an impression and ` +
      `giving it a number.`;

    if (open) {
      el("start-resume").hidden = false;
      el("start-resume").innerHTML =
        `<span class="label">Picking up where you left off</span>
         An unfinished ${ROUND.toUpperCase()} for ${esc(S.candidate)} is already open. Starting
         will resume it at the first unanswered question.`;
    } else if (done.length) {
      el("start-resume").hidden = false;
      el("start-resume").innerHTML =
        `<span class="label">${esc(S.candidate)} already has a submitted ${ROUND.toUpperCase()}</span>
         Scored ${done[0].total} of ${done[0].max_total} (${done[0].pct}%). Starting begins a
         second, separate scorecard — the first one is kept.`;
    }

    const other = ROUND === "r1" ? "r2" : "r1";
    el("btn-switch").textContent =
      other === "r1" ? "Run the shorter R1 screen instead" : "Run the full R2 instead";
    el("btn-switch").href = `ask.html?cand=${encodeURIComponent(CAND)}&round=${other}`;

    view("start");
  } catch (e) {
    fail(e.message);
  }
})();
