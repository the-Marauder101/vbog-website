// js/interview.js — Step 4, the verification call.
//
// One rule shapes the whole flow: predicted ratings first, actual ratings next,
// scores last. The database enforces it (reveal_scores refuses until ratings are
// submitted, and interviews carries a CHECK), so this page cannot leak a score
// early even if it tried.
//
// Nothing here re-measures the eight dimensions. The four jobs are verify,
// work-sample, resolve requirement-specific concerns, and close the
// non-psychometric gaps.

const el = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const Q = new URLSearchParams(location.search);
const S = { req: Q.get("req"), cand: Q.get("cand"), setup: null, interviewId: null };

// Playbook §6.1 — behaviourally anchored. Pick the description that matches what
// happened, not a gut number. The anchors are the whole point of the sheet.
const ELEMENTS = [
  ["discovery", "Discovery",
   "asked about the situation before mentioning the offer, questions built on prior answers, found something you hadn't volunteered",
   "two or three standard questions then pitched",
   "pitched immediately, or asked and ignored the answers"],
  ["objections", "Objection handling",
   "explored each objection before answering, answered the actual concern, did not concede price",
   "answered reasonably but took them at face value",
   "conceded, deflected, or argued"],
  ["close", "Close attempt",
   "asked clearly for the decision, handled the deferral directly, proposed a specific next commitment",
   "asked but accepted the deferral without testing it",
   "never asked, or asked so softly it wasn't a request"],
  ["composure", "Composure",
   "held frame throughout, comfortable with silence, tone unchanged under pressure",
   "mostly steady, some rushing at pressure points",
   "deferential, flustered, or filled every pause"],
  ["communication", "Communication",
   "clear, well-paced, adjusted register to the buyer",
   "understandable, occasional unclear passages",
   "repeatedly hard to follow, or register mismatched"],
];

// §3.1 — the pipeline maths. Un-Googleable, un-coachable, and the recovered
// cognitive measure. T3 is the sharpest: most candidates say yes.
const TECHNICAL = [
  ["pipeline_math", "Pipeline maths — ask all three, no calculator",
   ["You need ₹5,00,000 this month. Your ticket is ₹50,000. You close 3 out of every 10 calls. How many calls do you need? <strong>→ 34</strong>",
    "Only 60% of booked calls show up. How many do you need booked? <strong>→ 57</strong>",
    "Your offer is ₹1,00,000 and you're closing 3 in 10. You give a 15% discount. How many must you now close out of 10 to hold the same revenue? <strong>→ 4 in 10</strong>",
    "You need ₹5,00,000. Your open pipeline is ₹8,00,000. Enough? <strong>→ No. At 30% that's ₹2.4L expected; you need ₹16–17L.</strong> Someone who has carried a number says \"depends on my close rate\" before you finish the question."]],
  ["metrics", "Metrics literacy",
   ["Walk me through the numbers you personally tracked last month.",
    "What's the difference between a lead and a qualified lead in how you worked?",
    "If they run paid ads: spend ₹2,00,000, 400 leads, 40 calls booked, 12 closed at ₹50,000 → CPL ₹500 · CAC ₹16,667 · ROAS 3×"]],
  ["systems", "Systems and tooling",
   ["What did you use to track deals, and what were the actual fields or columns?",
    "How often did you update it, and at what point in the day?",
    "If you joined a company with no CRM and leads arriving on WhatsApp, what would you have built by the end of week two? <em>This is the one that matters — it corroborates process discipline directly.</em>"]],
  ["followup", "Follow-up architecture",
   ["A prospect says 'not now, maybe next quarter.' Describe your exact follow-up from that moment.",
    "How many touches before you stop, and what makes you stop? <em>No stopping rule means he never follows up or never lets go. Both cost money.</em>"]],
  ["objections", "Objection craft — specifics, not theory",
   ["What are the three objections you actually heard most in your last role?",
    "For each: give me your literal words in response. <em>Weak candidates give categories. Strong ones give sentences, because they've said them four hundred times.</em>"]],
  ["vertical", "Vertical / domain",
   ["Client-specific, written at onboarding. Enough to establish whether they can hold a conversation with this client's buyer."]],
];

function view(n) {
  ["gate", "error", "predict", "call", "reveal", "loading"].forEach((v) => {
    const x = el("v-" + v); x.hidden = true; x.classList.remove("enter");
  });
  const t = el("v-" + n); t.hidden = false; void t.offsetWidth; t.classList.add("enter");
  window.scrollTo(0, 0);
}
function setSave(t, st) {
  const s = el("savestate"); s.textContent = t;
  if (st) s.dataset.state = st; else delete s.dataset.state;
}
function fail(m) { el("error-text").textContent = m; view("error"); }

// ═══ 1. PREDICT ════════════════════════════════════════════════════════════

function renderPredict() {
  el("predict-body").innerHTML = ELEMENTS.map(([k, label]) => `
    <div class="field">
      <label for="p-${k}">${esc(label)}</label>
      <span class="help">What do you expect, 1 to 5, from the profile alone?</span>
      <select id="p-${k}">
        <option value="">—</option>
        ${[1, 2, 3, 4, 5].map((n) => `<option value="${n}">${n}</option>`).join("")}
      </select>
    </div>`).join("");
}

el("btn-predict").addEventListener("click", async () => {
  const pred = {};
  ELEMENTS.forEach(([k]) => { const v = el("p-" + k).value; if (v) pred[k] = Number(v); });
  if (Object.keys(pred).length < ELEMENTS.length) {
    setSave("Predict all five first", "error"); return;
  }
  try {
    S.interviewId = await sbRpc("save_predicted_ratings",
      { p_requirement_id: S.req, p_candidate_id: S.cand, p_predicted: pred });
    setSave("Predictions locked", "saved");
    renderCall();
  } catch (e) { setSave(e.message, "error"); }
});

// ═══ 2. CALL SHEET ═════════════════════════════════════════════════════════

function renderCall() {
  el("technical-body").innerHTML = TECHNICAL.map(([k, label, qs]) => `
    <div class="panel">
      <h3>${esc(label)}</h3>
      <ul class="evidence">${qs.map((q) => `<li><span class="glyph">·</span><span>${q}</span></li>`).join("")}</ul>
      <div class="field" style="margin:14px 0 0">
        <label for="t-${k}">Rating</label>
        <select id="t-${k}"><option value="">—</option>
          ${[1, 2, 3, 4, 5].map((n) => `<option value="${n}">${n}</option>`).join("")}</select>
      </div>
    </div>`).join("");

  const p = S.setup.pack;
  el("pack-body").innerHTML = p ? `
    <div class="panel">
      <h3>${esc(p.label)}</h3>
      <p><strong>Offer.</strong> ${esc(p.offer)}</p>
      <p><strong>Buyer.</strong> ${esc(p.buyer)}</p>
      <p><strong>Motion.</strong> ${esc(p.motion)}</p>
      <div class="callout"><span class="label">Same three objections, same order, every candidate</span>
        Improvising destroys the comparison — a candidate who got an easy prospect
        will out-score one who got a hard prospect, and you will read that as ability.
        <ul class="evidence" style="margin-top:9px">
          ${p.objections.map((o) => `<li><span class="glyph mono">${esc(o.at)}</span><span>“${esc(o.line)}”</span></li>`).join("")}
        </ul>
      </div>
      <div class="callout plain"><span class="label">Watch for</span>
        <ul class="evidence">${p.watch_for.map((w) => `<li><span class="glyph">·</span><span>${esc(w)}</span></li>`).join("")}</ul>
      </div>
      <div class="callout plain"><span class="label">Interviewer discipline</span>
        Do not help — silence is data. Answer a good discovery question honestly and
        fully; reward good behaviour with information, which is what a real prospect
        does. Stay in character. <strong>If they never attempt a close, let the clock
        run out. Do not prompt.</strong> That non-attempt is the single most
        informative outcome in this block, and one nudge destroys it.
      </div>
    </div>` : `<div class="empty"><p class="muted">No pack set on this requirement.</p></div>`;

  el("probes-body").innerHTML = (S.setup.probes || []).map((pr, i) => `
    <div class="panel">
      <div class="cand-head">
        <span class="chip ${pr.type === "concern" ? "warn" : ""}">${esc(pr.type)}</span>
        ${pr.flag ? `<span class="chip warn">${esc(pr.flag.replace(/_/g, " "))}</span>` : ""}
      </div>
      <p style="margin-top:10px"><strong>“${esc(pr.probe)}”</strong></p>
      ${pr.follow_up ? `<p class="small"><em>Mandatory follow-up:</em> “${esc(pr.follow_up)}”
        — the follow-up is where inflation collapses.</p>` : ""}
      ${pr.listening_for ? `<p class="small muted">Listening for: ${esc(pr.listening_for)}</p>` : ""}
      <div class="field" style="margin:12px 0 0">
        <label for="pr-${i}">Outcome</label>
        <select id="pr-${i}" data-dim="${esc(pr.dimension || "")}" data-type="${esc(pr.type)}">
          <option value="">—</option>
          <option value="corroborates">Corroborates — specifics that couldn't be invented</option>
          <option value="thin">Thin — plausible but generic; no detail survived the follow-up</option>
          <option value="contradicts">Contradicts — conflicts with itself or the profile</option>
        </select>
      </div>
    </div>`).join("") +
    `<p class="disclaimer">Never name a dimension to the candidate. Not "your
     process discipline score", not "the assessment showed". The vocabulary leaks
     into the candidate pool and contaminates every future assessment.</p>`;

  el("ratings-body").innerHTML = ELEMENTS.map(([k, label, a5, a3, a1]) => `
    <div class="panel">
      <h3>${esc(label)}</h3>
      <ul class="evidence">
        <li><span class="glyph mono">5</span><span>${esc(a5)}</span></li>
        <li><span class="glyph mono">3</span><span>${esc(a3)}</span></li>
        <li><span class="glyph mono">1</span><span>${esc(a1)}</span></li>
      </ul>
      <div class="row" style="margin-top:13px">
        <div class="field" style="margin:0">
          <label for="r-${k}">Rating</label>
          <select id="r-${k}"><option value="">—</option>
            ${[1, 2, 3, 4, 5].map((n) => `<option value="${n}">${n}</option>`).join("")}</select>
        </div>
        <div class="field" style="margin:0">
          <label for="rn-${k}">Note</label>
          <input type="text" id="rn-${k}">
        </div>
      </div>
    </div>`).join("");

  view("call");
}

el("btn-submit").addEventListener("click", async () => {
  const ratings = {}, technical = {}, probes = {};
  let missing = [];
  ELEMENTS.forEach(([k, label]) => {
    const v = el("r-" + k).value;
    if (!v) missing.push(label);
    else ratings[k] = { rating: Number(v), note: el("rn-" + k).value || null };
  });
  TECHNICAL.forEach(([k]) => {
    const v = el("t-" + k).value;
    if (v) technical[k] = { rating: Number(v), note: null };
  });
  (S.setup.probes || []).forEach((pr, i) => {
    const s = el("pr-" + i);
    if (s.value) probes[`${s.dataset.dim}|${s.dataset.type}`] = { outcome: s.value, note: null };
  });

  if (missing.length) {
    el("submit-error").hidden = false;
    el("submit-error").innerHTML =
      `<span class="label">Rate all five role-play elements first</span>Missing: ${esc(missing.join(", "))}`;
    return;
  }

  const b = el("btn-submit"); b.disabled = true; b.textContent = "Submitting…";
  try {
    await sbRpc("submit_interview", {
      p_interview_id: S.interviewId, p_ratings: ratings, p_technical: technical,
      p_probes: probes, p_consent: el("consent-rec").checked,
    });
    await doReveal();
  } catch (e) {
    b.disabled = false; b.textContent = "Submit ratings";
    el("submit-error").hidden = false;
    el("submit-error").innerHTML = `<span class="label">Could not submit</span>${esc(e.message)}`;
  }
});

// ═══ 3. REVEAL ═════════════════════════════════════════════════════════════

async function doReveal() {
  const r = await sbRpc("reveal_scores", { p_interview_id: S.interviewId });
  const mean = r.decision.roleplay_mean, anyOne = r.decision.any_element_at_1;

  const rows = ELEMENTS.map(([k, label]) => {
    const pred = r.predicted && r.predicted[k], act = r.actual && r.actual[k];
    const d = pred != null && act != null ? act - pred : null;
    return `<li><span class="glyph mono">${d == null ? "·" : d > 0 ? "+" + d : d}</span>
      <span>${esc(label)} — predicted ${pred ?? "—"}, actual ${act ?? "—"}</span></li>`;
  }).join("");

  el("reveal-body").innerHTML = `
    <div class="panel">
      <h3>Predicted vs actual</h3>
      <p class="small muted">This divergence is the part that tells you whether the
         instrument works. Large gaps in one direction, repeatedly, mean either the
         profile or your reading of a call is off.</p>
      <ul class="evidence">${rows}</ul>
    </div>
    <div class="panel">
      <h3>The decision floor</h3>
      <p class="small muted">Playbook §7. A floor, not a decision procedure —
         everything between is your judgement.</p>
      <ul class="evidence">
        <li><span class="glyph">${mean >= 3.5 ? "+" : "!"}</span><span>Role-play mean ${mean} — needs ≥ 3.5</span></li>
        <li><span class="glyph">${anyOne ? "!" : "+"}</span><span>${anyOne ? "An element is rated 1 — do not send" : "No element at 1"}</span></li>
      </ul>
      <p class="disclaimer">What reaches the client: CV, your written
        recommendation, and the role-play recording if they ask and the candidate
        consented. <strong>No dimension scores. No match percentage. No rating
        sheet. No technical answers.</strong></p>
    </div>
    <div class="panel">
      <h3>The profile, now unsealed</h3>
      <ul class="evidence">${Object.entries(r.scores || {})
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `<li><span class="glyph mono">${v}</span><span>${esc(k)}</span></li>`).join("")}</ul>
    </div>`;
  view("reveal");
}

el("btn-contra").addEventListener("click", async () => {
  const t = el("contra").value.trim();
  if (!t) return;
  try {
    await sbRpc("log_contradiction", { p_interview_id: S.interviewId, p_dimension: "", p_description: t });
    el("contra").value = ""; setSave("Logged for the psych function", "saved");
  } catch (e) { setSave(e.message, "error"); }
});

// ═══ BOOT ══════════════════════════════════════════════════════════════════
(async () => {
  if (!sbRestoreToken()) return view("gate");
  if (!S.req || !S.cand) return fail("Open this from a candidate row in the console.");
  try {
    S.setup = await sbRpc("get_interview_setup", { p_requirement_id: S.req, p_candidate_id: S.cand });
  } catch (e) { return fail(e.message); }

  S.interviewId = S.setup.interview_id;
  if (S.setup.ratings_submitted) return doReveal();
  if (S.setup.predicted_ratings) { renderCall(); return; }
  renderPredict();
  view("predict");
})();
