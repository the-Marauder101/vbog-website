// js/console.js — Nikash internal console.
//
// Renders the only surface in the system that shows a score. Two rules shape
// every view here:
//
//   · A number never appears without its reason. The composite is unvalidated,
//     so the sentence explaining it is never smaller than the number.
//   · Concerns render at the same weight as reasons, always visible. A shortlist
//     that only shows strengths is a sales document, not an assessment.
//
// There is no reject control anywhere, because `matches` has no column to hold
// one. Excluded candidates render dimmed, name every failing filter, and can
// still be advanced.

const el = (id) => document.getElementById(id);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const VIEWS = ["signin", "reqs", "req", "queue", "cand", "health", "guide", "place", "supp", "loading"];

function view(name) {
  VIEWS.forEach((v) => {
    const n = el("v-" + v);
    if (n) { n.hidden = true; n.classList.remove("enter"); }
  });
  const t = el("v-" + name);
  t.hidden = false;
  void t.offsetWidth;
  t.classList.add("enter");
  el("masthead").hidden = name === "signin";
  markNav(name);
  window.scrollTo(0, 0);
}

// The nav had no active state at all, so the console never told you which
// screen you were on. `aria-current` is both the announcement a screen reader
// needs and the hook the streak under the active item hangs off. A shortlist is
// still "Requirements", because that is where you came from and where Back goes.
const NAV_OF = { reqs: "nav-reqs", req: "nav-reqs", queue: "nav-queue", cand: "nav-queue",
                 health: "nav-health", place: "nav-place", supp: "nav-supp",
                 guide: "nav-guide" };

function markNav(name) {
  Object.values(NAV_OF).forEach((id) => el(id) && el(id).removeAttribute("aria-current"));
  const active = NAV_OF[name] && el(NAV_OF[name]);
  if (active) active.setAttribute("aria-current", "page");
}

function rupees(n) {
  const v = Number(n);
  if (!isFinite(v)) return "—";
  if (v >= 100000) return "₹" + (v / 100000).toFixed(v % 100000 === 0 ? 0 : 2) + "L";
  if (v >= 1000) return "₹" + Math.round(v / 1000) + "k";
  return "₹" + v;
}
const cycle = (d) => (Number(d) === 0 ? "same-day" : `${d}-day`);

// Dates were left to the browser's locale, which renders "8/1/2026" — ambiguous
// everywhere and back to front for the people reading it. Money is already
// formatted en-IN; dates now match, and spell the month so there is nothing to
// misread.
const onDate = (v) => (v
  ? new Date(v).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
  : "—");

// ═══ SIGN IN ═══════════════════════════════════════════════════════════════

async function afterSignIn() {
  // Signing up grants nothing. Access exists only once an admin has added a
  // staff row, which link_staff_account() binds to this auth user.
  //
  // This used to decide by running loadRequirements() and seeing whether it
  // threw — which is not an authorisation check. RLS is silent: it filters rows
  // rather than raising, so a stranger who signed up got a console that merely
  // happened to be empty, with the whole navigation bar available. Permission is
  // now a POSITIVE answer from the database, and nothing loads without it.
  await sbRpc("link_staff_account").catch(() => null);
  let me = null;
  try { me = await sbRpc("whoami"); } catch (_) { /* fall through to refusal */ }

  if (!me || me.staff !== true) {
    sbSignOut();
    el("signin-error").hidden = false;
    el("signin-error").innerHTML = `<span class="label">No access</span>` +
      esc((me && me.reason) || "This account is not a staff account.");
    return view("signin");
  }

  try {
    await loadRequirements();
  } catch (e) {
    sbSignOut();
    el("signin-error").hidden = false;
    el("signin-error").innerHTML = `<span class="label">Could not load the console</span>${esc(e.message)}`;
    view("signin");
  }
}

el("btn-signin").addEventListener("click", async () => {
  el("signin-error").hidden = true;
  const b = el("btn-signin"); b.disabled = true; b.textContent = "Signing in…";
  try {
    await sbSignIn(el("si-email").value.trim(), el("si-pass").value);
    await afterSignIn();
  } catch (e) {
    el("signin-error").hidden = false;
    el("signin-error").innerHTML = `<span class="label">Could not sign in</span>${esc(e.message)}`;
  } finally {
    b.disabled = false; b.textContent = "Sign in";
  }
});

el("btn-signup").addEventListener("click", async () => {
  el("signin-error").hidden = true;
  const email = el("si-email").value.trim(), pass = el("si-pass").value;
  try {
    // An account that already exists is not a failure worth a dead end. People
    // are told to "sign up at nikash.html with that email", forget they already
    // did, and press the wrong button — so fall through to signing in and let the
    // password decide.
    try { await sbSignUp(email, pass); }
    catch (e) { if (!/already registered|already exists/i.test(e.message)) throw e; }
    await sbSignIn(email, pass);
    await afterSignIn();
  } catch (e) {
    el("signin-error").hidden = false;
    el("signin-error").innerHTML = `<span class="label">Could not create the account</span>${esc(e.message)}`;
  }
});

el("nav-signout").addEventListener("click", (e) => { e.preventDefault(); sbSignOut(); view("signin"); });

// ═══ REQUIREMENTS ══════════════════════════════════════════════════════════

async function loadRequirements() {
  const rows = await sbFetch("v_requirements?status=eq.open&order=opened_at.desc");
  el("reqs-count").textContent = `${rows.length} open`;
  el("reqs-list").innerHTML = rows.length
    ? rows.map((r) => `
      <div class="req" data-reqrow="${esc(r.id)}">
        <span class="title"><a href="#req-${esc(r.id)}" data-req="${esc(r.id)}"
          >${esc(r.business_name)} — ${esc(r.title)}</a></span>
        <span class="meta small">
          ${rupees(r.ticket_size)} · ${esc(cycle(r.cycle_days))} · ${esc(r.roleplay_pack)} pack
          · ${r.eligible} of ${r.assessed} eligible
          · confidence ${esc(r.confidence || "—")}${r.benchmark_source && r.benchmark_source !== "none"
            ? " · " + esc(r.benchmark_source) + " benchmark" : ""}
        </span>
        <span class="figures">
          ${r.best_pct != null
            ? `<span class="figure">${r.best_pct}</span><span class="figure-unit">%</span>
               <br><span class="mono muted">best match</span>`
            : `<span class="mono muted">no matches yet</span>`}
        </span>
        <div class="actions" style="grid-column:1/-1;margin-top:10px">
          <button class="btn-quiet btn-small" data-req-rename="${esc(r.id)}"
            data-title="${esc(r.title)}">Rename</button>
          <button class="btn-quiet btn-small" data-req-close="${esc(r.id)}">Close role</button>
          <button class="btn-quiet btn-small" data-req-del="${esc(r.id)}"
            data-title="${esc(r.title)}" data-client="${esc(r.business_name)}">Delete</button>
          <span class="savestate" data-rslot="${esc(r.id)}"></span>
        </div>
      </div>`).join("")
    : `<div class="empty" style="text-align:left;padding:26px 24px">
        <h3>Nothing open yet — here is the order of operations</h3>
        <ul class="evidence" style="margin-top:14px">
          <li><span class="glyph mono">1</span><span><strong>Create an intake link</strong> above and send it
            to a client. They answer six short steps about the role; the engine turns that into
            required levels. A requirement opens the moment they submit.</span></li>
          <li><span class="glyph mono">2</span><span><strong>Create a test link</strong> under Candidates and
            send it to a closer. 44 items, about 25 minutes, mobile. They never see a client,
            and one assessment is matched against every open requirement.</span></li>
          <li><span class="glyph mono">3</span><span><strong>Open the requirement</strong> to see the ranked
            shortlist, with the reasons and the concerns spelled out.</span></li>
          <li><span class="glyph mono">4</span><span><strong>Run the verification call</strong> from a
            candidate row — predictions first, then the call sheet, then the scores unlock.</span></li>
        </ul>
        <p class="disclaimer">Nothing here is ever shown to a client. They receive a CV and your
          written recommendation — never a score, a percentage, or the test.</p>
       </div>`;

  el("reqs-list").querySelectorAll("[data-req]").forEach((a) =>
    a.addEventListener("click", (e) => { e.preventDefault(); loadRequirement(a.dataset.req); }));

  const rslot = (id) => document.querySelector(`[data-rslot="${id}"]`);
  const rerr = (id) => (m) => { rslot(id).textContent = m; rslot(id).dataset.state = "error"; };

  el("reqs-list").querySelectorAll("[data-req-rename]").forEach((b) =>
    b.addEventListener("click", () => {
      const next = prompt("Rename this role:", b.dataset.title);
      if (next === null || !next.trim()) return;
      doRename("rename_requirement", { p_id: b.dataset.reqRename, p_title: next.trim() },
        loadRequirements, rerr(b.dataset.reqRename));
    }));

  el("reqs-list").querySelectorAll("[data-req-close]").forEach((b) =>
    b.addEventListener("click", () =>
      doDelete("set_requirement_status", { p_id: b.dataset.reqClose, p_status: "closed" },
        "Close this role? It stops appearing in the open list. Nothing is deleted and you can reopen it.",
        loadRequirements, rerr(b.dataset.reqClose))));

  el("reqs-list").querySelectorAll("[data-req-del]").forEach((b) =>
    b.addEventListener("click", () =>
      doDelete("delete_requirement", { p_id: b.dataset.reqDel },
        `Delete "${b.dataset.client} — ${b.dataset.title}" permanently?\n\n` +
        `This removes the role and every match computed for it. Candidate assessments are NOT affected.\n\n` +
        `If a verification call or a placement exists, the server will refuse and tell you to close it instead.`,
        loadRequirements, rerr(b.dataset.reqDel))));

  view("reqs");
}

el("btn-new-intake").addEventListener("click", async () => {
  const name = el("new-client").value.trim();
  if (!name) return;
  const b = el("btn-new-intake"); b.disabled = true;
  try {
    const r = await sbRpc("create_client_intake_link", { p_business_name: name });
    const url = `${location.origin}${location.pathname.replace(/nikash\.html$/, "")}intake.html?t=${r.token}`;
    el("intake-link").hidden = false;
    el("intake-link").innerHTML =
      `<span class="label">Intake link for ${esc(name)} — valid 21 days</span>
       <input type="text" readonly value="${esc(url)}" onclick="this.select()">`;
    el("new-client").value = "";
  } catch (e) {
    el("intake-link").hidden = false;
    el("intake-link").innerHTML = `<span class="label">Failed</span>${esc(e.message)}`;
  } finally { b.disabled = false; }
});

// ═══ ONE REQUIREMENT ═══════════════════════════════════════════════════════

async function loadRequirement(id) {
  const [req] = await sbFetch(`v_requirements?id=eq.${id}`);
  const rows = await sbFetch(
    `v_console_clean?requirement_id=eq.${id}&order=engine_rank.asc`);

  el("req-title").textContent = `${req.business_name} — ${req.title}`;
  el("req-meta").innerHTML =
    `${rupees(req.ticket_size)} · ${esc(cycle(req.cycle_days))} · ${esc(req.roleplay_pack)} role-play pack
     · CLS weighting ${Math.round(req.cls_blend.w_C * 100)}% considered /
       ${Math.round(req.cls_blend.w_F * 100)}% fast
     · intake confidence <strong>${esc(req.confidence)}</strong>`;

  // §6.4 — a stated ranking that contradicts the client's own best rep is
  // surfaced, never silently resolved.
  el("req-conflicts").innerHTML = (req.benchmark_conflicts || []).map((c) => `
    <div class="callout"><span class="label">Stated ranking vs their own benchmark</span>
      This client ranked <strong>${esc(c.dimension)}</strong>
      ${c.kind === "ranked_bottom3_but_benchmark_high" ? "bottom-3" : "top-3"},
      but their benchmark scores ${c.benchmark} against a stated requirement of
      ${c.stated_required}. Worth raising before you shortlist.</div>`).join("");

  el("req-count").textContent = `${rows.filter((r) => r.hard_filter_pass).length} eligible of ${rows.length}`;
  el("req-list").innerHTML = rows.length
    ? rows.map((r) => candidateRow(r, id)).join("")
    : `<div class="empty"><h3>Nobody assessed yet</h3>
       <p class="muted">Candidates appear here once they finish the assessment.</p></div>`;

  el("req-list").querySelectorAll("[data-decide]").forEach((btn) =>
    btn.addEventListener("click", () => decide(btn, id)));
  el("req-list").querySelectorAll("[data-supp]").forEach((btn) =>
    btn.addEventListener("click", () => sendSupplement(btn, id)));
  el("req-list").querySelectorAll("[data-place]").forEach((btn) =>
    btn.addEventListener("click", () => markPlaced(btn, id)));
  view("req");
}

function candidateRow(r, reqId) {
  const chips = [];
  if (r.frame_split_flag) chips.push(`<span class="chip warn">frame-split</span>`);
  if (r.attrition_risk_flag) chips.push(`<span class="chip warn">comp mismatch</span>`);
  (r.flags || []).forEach((f) => chips.push(`<span class="chip">${esc(f.replace(/_/g, " "))}</span>`));

  return `
  <article class="cand${r.hard_filter_pass ? "" : " excluded"}">
    <div class="rank">${r.engine_rank}</div>
    <div>
      <div class="cand-head">
        <span class="cand-name">${esc(r.full_name)}</span>
        ${chips.join(" ")}
        <span class="spacer"></span>
        <span><span class="figure">${r.composite_pct}</span><span class="figure-unit">%</span></span>
      </div>
      <p class="small muted" style="margin:3px 0 0">
        Quality ${r.quality_pct}% of what this role requires · Fit ${r.fit_pct}% ·
        effective closing ${Math.round(r.cls_effective)}
      </p>

      ${!r.hard_filter_pass ? `
        <div class="callout plain">
          <span class="label">Outside the stated filters — overridable</span>
          ${(r.hard_filter_fails || []).map(esc).join(" · ")}
        </div>` : ""}

      <ul class="evidence">
        ${(r.top_reasons || []).map((t) =>
          `<li><span class="glyph">+</span><span>${esc(t)}</span></li>`).join("")}
        ${(r.top_concerns || []).map((t) =>
          `<li class="concern"><span class="glyph">!</span><span>${esc(t)}</span></li>`).join("")}
      </ul>

      ${r.frame_split_note ? `
        <div class="callout"><span class="label">Frame-specific closer</span>${esc(r.frame_split_note)}</div>` : ""}
      ${r.cross_client_line ? `
        <div class="callout plain"><span class="label">Fits another requirement better</span>${esc(r.cross_client_line)}</div>` : ""}

      <div class="actions" style="margin-top:14px">
        <button class="btn-quiet btn-small" data-decide="yes"
                data-cand="${esc(r.candidate_id)}" data-rank="${r.engine_rank}">Advance</button>
        <button class="btn-quiet btn-small" data-decide="no"
                data-cand="${esc(r.candidate_id)}" data-rank="${r.engine_rank}">Not this role</button>
        <a class="btn btn-quiet btn-small"
           href="interview.html?req=${esc(reqId)}&cand=${esc(r.candidate_id)}">Verification call</a>
        <button class="btn-quiet btn-small" data-supp="${esc(r.candidate_id)}">Send supplement</button>
        <button class="btn-quiet btn-small" data-place="${esc(r.candidate_id)}">Placed</button>
        <span class="savestate" data-slot="${esc(r.candidate_id)}"></span>
      </div>
    </div>
  </article>`;
}

// §14.5 depends entirely on these being written. Both answers are logged —
// declining a top-ranked candidate is as informative as advancing a low one.
async function decide(btn, reqId) {
  const slot = document.querySelector(`[data-slot="${btn.dataset.cand}"]`);
  slot.textContent = "Saving…"; slot.removeAttribute("data-state");
  try {
    await sbRpc("log_decision", {
      p_requirement_id: reqId,
      p_candidate_id: btn.dataset.cand,
      p_advanced: btn.dataset.decide === "yes",
    });
    slot.textContent = btn.dataset.decide === "yes" ? "Advanced — logged" : "Declined — logged";
    slot.dataset.state = "saved";
  } catch (e) {
    slot.textContent = e.message; slot.dataset.state = "error";
  }
}

// §2 caps supplement fan-out at two. The database refuses a third and explains
// why, so this surfaces the error verbatim rather than paraphrasing it.
async function sendSupplement(btn, reqId) {
  const slot = document.querySelector(`[data-slot="${btn.dataset.supp}"]`);
  slot.textContent = "Issuing…"; slot.removeAttribute("data-state");
  try {
    const r = await sbRpc("issue_supplement_token",
      { p_candidate_id: btn.dataset.supp, p_requirement_id: reqId });
    const base = location.pathname.replace(/nikash\.html$/, "");
    const url = `${location.origin}${base}supplement.html?t=${r.token}`;
    slot.textContent = "Link ready"; slot.dataset.state = "saved";
    btn.insertAdjacentHTML("afterend",
      `<input type="text" readonly value="${esc(url)}" onclick="this.select()" style="margin-top:8px">`);
  } catch (e) { slot.textContent = e.message; slot.dataset.state = "error"; }
}

async function markPlaced(btn, reqId) {
  const on = prompt("Joining date (YYYY-MM-DD)?", new Date().toISOString().slice(0, 10));
  if (!on) return;
  const slot = document.querySelector(`[data-slot="${btn.dataset.place}"]`);
  try {
    await sbRpc("record_placement",
      { p_requirement_id: reqId, p_candidate_id: btn.dataset.place, p_joined_on: on });
    slot.textContent = "Placement recorded"; slot.dataset.state = "saved";
  } catch (e) { slot.textContent = e.message; slot.dataset.state = "error"; }
}

// ═══ RENAME AND DELETE ══════════════════════════════════════════════════════
// Every list that can create a record can now rename and remove one. Two rules:
//
//   · A destructive action names what it will destroy, before doing it.
//   · The server, not the browser, decides what may be destroyed. It refuses
//     anything that would cascade into a placement, because outcome data cannot
//     be recreated — nobody can go back and re-observe whether a hire lasted.
//     The refusal comes back as a sentence and is shown verbatim.

async function doRename(rpc, args, after, onError) {
  try { await sbRpc(rpc, args); if (after) await after(); }
  catch (e) { (onError || alert)(e.message); }
}

async function doDelete(rpc, args, confirmText, after, onError) {
  if (!confirm(confirmText)) return;
  try {
    const r = await sbRpc(rpc, args);
    if (after) await after();
    return r;
  } catch (e) { (onError || alert)(e.message); }
}

// ═══ SUPPLEMENT SUGGESTION ══════════════════════════════════════════════════
// §10 keeps the supplement human-authored. This produces a DRAFT from templates
// selected against the client's own intake — the same mechanism §9.5 uses for
// the match rationale: identical phrasing every time, auditable, no model.
// It writes into the textarea; nothing is saved until the recruiter saves it.

async function suggestSupplement(clientId) {
  const slot = document.querySelector(`[data-sslot="${clientId}"]`);
  slot.textContent = "Building a draft…"; slot.removeAttribute("data-state");
  try {
    const r = await sbRpc("suggest_supplement", { p_client_id: clientId });
    if (!r.ok) { slot.textContent = r.reason; slot.dataset.state = "error"; return; }

    const box = el("si-" + clientId);
    const lines = r.items.map((i) => (i.kind === "technical" ? "tech: " : "") + i.prompt);
    box.value = lines.join("\n");

    const b = r.because;
    const why = el("why-" + clientId);
    why.hidden = false;
    why.innerHTML =
      `<span class="label">Drafted from this client's intake — edit before saving</span>` +
      `${r.items.length} questions, chosen because: ` +
      [`ticket ${b.ticket_size ? "₹" + Number(b.ticket_size).toLocaleString("en-IN") : "—"}`,
       `${b.cycle_days}-day cycle`,
       b.has_crm === "false" ? "no CRM" : "has a CRM",
       `${b.cold_outbound_pct}% cold outbound`,
       b.refund_policy_exists === "true" ? "refund policy exists" : "no refund policy",
       b.buyer_is_senior === "true" ? "senior/owner buyer" : "non-senior buyer",
      ].join(" · ") +
      `<br><br>These are a starting point, not a finished supplement. The two ` +
      `<code>vertical</code> questions in particular need replacing with something ` +
      `specific to what this client sells — a generic version tests nothing.` +
      `<ul class="evidence" style="margin-top:10px">` +
      r.items.map((i) => `<li><span class="glyph">${i.kind === "technical" ? "T" : "B"}</span>
        <span><strong>${esc(i.prompt)}</strong><br><span class="muted">${esc(i.why)}</span></span></li>`).join("") +
      `</ul>`;

    const nB = r.items.filter((i) => i.kind === "behavioural").length;
    const nT = r.items.filter((i) => i.kind === "technical").length;
    slot.textContent = `Draft ready — ${nB} behavioural, ${nT} technical`;
    slot.dataset.state = "saved";
    // §10 caps a supplement at 5-8 behavioural plus 3-5 technical.
    if (nB > 8 || nT > 5) {
      slot.textContent += " · over the §10 cap, trim before saving";
      slot.dataset.state = "error";
    }
  } catch (e) { slot.textContent = e.message; slot.dataset.state = "error"; }
}

// ═══ PLACEMENTS AND OUTCOMES (§12) ═════════════════════════════════════════
// §18 names an empty placement_outcomes as the most likely single point of
// failure. Code cannot make anyone fill it in; it can make the gap impossible
// to overlook, which is what the overdue list is for.

async function loadPlacements() {
  const [due, places, valid] = await Promise.all([
    sbFetch("v_outcomes_due?order=days_overdue.desc"),
    sbFetch("v_placements"),
    sbFetch("v_predictor_validity"),
  ]);

  el("due-count").textContent = due.length ? `${due.length} overdue` : "all current";
  el("due-list").innerHTML = due.length
    ? due.map((d) => `
      <div class="cand" style="grid-template-columns:1fr">
        <div>
          <div class="cand-head">
            <span class="cand-name">${esc(d.full_name)}</span>
            <span class="chip warn">${esc(d.checkpoint)} · ${d.days_overdue} days late</span>
            <span class="spacer"></span>
            <span class="small muted">${esc(d.business_name)} — ${esc(d.title)} · joined ${esc(d.joined_on)}</span>
          </div>
          <div class="actions" style="margin-top:12px">
            <button class="btn-quiet btn-small" data-out="${esc(d.placement_id)}"
              data-cp="${esc(d.checkpoint)}" data-ret="1">Still there</button>
            <button class="btn-quiet btn-small" data-out="${esc(d.placement_id)}"
              data-cp="${esc(d.checkpoint)}" data-ret="0">Gone</button>
            <span class="savestate" data-oslot="${esc(d.placement_id)}${esc(d.checkpoint)}"></span>
          </div>
        </div>
      </div>`).join("")
    : `<div class="empty"><p class="muted">Nothing overdue. Checkpoints appear here at
       3, 6 and 12 months after a joining date.</p></div>`;

  el("due-list").querySelectorAll("[data-out]").forEach((b) =>
    b.addEventListener("click", () => recordOutcome(b)));

  el("place-count").textContent = `${places.length}`;
  el("place-list").innerHTML = places.length
    ? places.map((p) => `
      <div class="cand" style="grid-template-columns:1fr">
        <div class="cand-head">
          <span class="cand-name">${esc(p.full_name)}</span>
          ${p.retained_so_far === false ? `<span class="chip warn">exited</span>` : ""}
          <span class="spacer"></span>
          <span class="small muted">${esc(p.business_name)} · joined ${esc(p.joined_on)} ·
            predicted ${p.predicted_pct ?? "—"}% · ${p.outcomes_recorded} of 3 checkpoints</span>
        </div>
      </div>`).join("")
    : `<div class="empty"><p class="muted">No placements yet. Mark one from a shortlist row.</p></div>`;

  const v = valid[0] || {};
  el("validity-body").innerHTML = `
    <div class="panel">
      <p class="small muted">${esc(v.verdict || "no data yet")}</p>
      <ul class="evidence" style="margin-top:10px">
        <li><span class="glyph mono">${v.composite_vs_retention ?? "—"}</span><span>Engine composite vs retention</span></li>
        <li><span class="glyph mono">${v.interview_vs_retention ?? "—"}</span><span>Role-play mean vs retention</span></li>
        <li><span class="glyph mono">${v.technical_vs_retention ?? "—"}</span><span>Technical mean vs retention</span></li>
      </ul>
      <p class="disclaimer">Kept apart on purpose. Merging them is what would make
        "which of the three actually predicted this?" unanswerable — and that answer
        is worth more than any of them individually.</p>
    </div>`;
  view("place");
}

async function recordOutcome(b) {
  const retained = b.dataset.ret === "1";
  const slot = document.querySelector(`[data-oslot="${b.dataset.out}${b.dataset.cp}"]`);
  const args = { p_placement_id: b.dataset.out, p_checkpoint: b.dataset.cp, p_retained: retained };
  if (!retained) {
    const type = prompt("Voluntary or involuntary?", "voluntary");
    if (!type) return;
    args.p_exit_type = type.toLowerCase().startsWith("i") ? "involuntary" : "voluntary";
    args.p_exit_reason = prompt("Reason, in a line?") || null;
  } else {
    const d = prompt("Days to first closed deal? (blank to skip)");
    if (d) args.p_days_to_first_close = Number(d);
    const q = prompt("Quota attainment %? (blank to skip)");
    if (q) args.p_quota_pct = Number(q);
    const s = prompt("Client satisfaction, 1-5? (blank to skip)");
    if (s) args.p_satisfaction = Number(s);
  }
  slot.textContent = "Saving…"; slot.removeAttribute("data-state");
  try { await sbRpc("record_outcome", args); await loadPlacements(); }
  catch (e) { slot.textContent = e.message; slot.dataset.state = "error"; }
}

// ═══ CLIENT SUPPLEMENTS (§10) ══════════════════════════════════════════════

async function loadSupplements() {
  const [clients, supps, overlap] = await Promise.all([
    sbFetch("clients?select=id,business_name&order=business_name.asc"),
    sbFetch("v_supplements"),
    sbFetch("v_supplement_overlap").catch(() => []),
  ]);
  const real = clients.filter((c) => !c.business_name.startsWith("ZZ_FIXTURE"));
  const byClient = Object.fromEntries(supps.map((s) => [s.client_id, s]));

  el("supp-count").textContent = `${supps.length} of ${real.length} clients`;
  el("supp-list").innerHTML = real.length
    ? real.map((c) => {
        const s = byClient[c.id];
        const items = s ? s.items : [];
        const text = items.map((i) => (i.kind === "technical" ? "tech: " : "") + i.prompt).join("\n");
        return `
        <div class="panel">
          <div class="cand-head">
            <span class="cand-name">${esc(c.business_name)}</span>
            ${s ? `<span class="chip">${s.n_items} items</span>` : `<span class="chip warn">not written</span>`}
            ${s && s.unscored ? `<span class="chip warn">${s.unscored} unscored</span>` : ""}
          </div>
          <div class="field" style="margin:14px 0 0">
            <label for="si-${esc(c.id)}">One question per line. Prefix a vertical or
              technical one with <code>tech:</code></label>
            <textarea id="si-${esc(c.id)}" rows="7">${esc(text)}</textarea>
          </div>
          <div class="notice" id="why-${esc(c.id)}" hidden style="margin:12px 0"></div>
          <div class="actions">
            <button class="btn-primary btn-small" data-suggest="${esc(c.id)}">Suggest from their intake</button>
            <button class="btn-quiet btn-small" data-save-supp="${esc(c.id)}">Save</button>
            <span class="spacer"></span>
            <button class="btn-quiet btn-small" data-client-rename="${esc(c.id)}"
              data-name="${esc(c.business_name)}">Rename client</button>
            ${s ? `<button class="btn-quiet btn-small" data-supp-del="${esc(c.id)}"
              data-name="${esc(c.business_name)}">Delete questions</button>` : ""}
            <button class="btn-quiet btn-small" data-client-del="${esc(c.id)}"
              data-name="${esc(c.business_name)}">Delete client</button>
          </div>
          <span class="savestate" data-sslot="${esc(c.id)}"></span>
        </div>`;
      }).join("")
    : `<div class="empty"><p class="muted">No clients yet.</p></div>`;

  el("supp-list").querySelectorAll("[data-save-supp]").forEach((b) =>
    b.addEventListener("click", async () => {
      const id = b.dataset.saveSupp;
      const slot = document.querySelector(`[data-sslot="${id}"]`);
      const items = el("si-" + id).value.split("\n").map((l) => l.trim()).filter(Boolean)
        .map((l) => l.toLowerCase().startsWith("tech:")
          ? { kind: "technical", prompt: l.slice(5).trim() }
          : { kind: "behavioural", prompt: l });
      slot.textContent = "Saving…"; slot.removeAttribute("data-state");
      try {
        await sbRpc("save_supplement", { p_client_id: id, p_items: items });
        slot.textContent = `Saved — ${items.length} items`; slot.dataset.state = "saved";
      } catch (e) { slot.textContent = e.message; slot.dataset.state = "error"; }
    }));

  const sslot = (id) => document.querySelector(`[data-sslot="${id}"]`);
  const serr = (id) => (m) => { sslot(id).textContent = m; sslot(id).dataset.state = "error"; };

  el("supp-list").querySelectorAll("[data-suggest]").forEach((b) =>
    b.addEventListener("click", () => suggestSupplement(b.dataset.suggest)));

  el("supp-list").querySelectorAll("[data-client-rename]").forEach((b) =>
    b.addEventListener("click", () => {
      const next = prompt("Rename this client:", b.dataset.name);
      if (next === null || !next.trim()) return;
      doRename("rename_client", { p_id: b.dataset.clientRename, p_name: next.trim() },
        loadSupplements, serr(b.dataset.clientRename));
    }));

  el("supp-list").querySelectorAll("[data-supp-del]").forEach((b) =>
    b.addEventListener("click", () =>
      doDelete("delete_supplement", { p_client_id: b.dataset.suppDel },
        `Delete the supplement questions for ${b.dataset.name}?\n\n` +
        `The questions go; the client and their roles stay. If any candidate has already ` +
        `answered them, the server will refuse — edit the questions instead.`,
        loadSupplements, serr(b.dataset.suppDel))));

  el("supp-list").querySelectorAll("[data-client-del]").forEach((b) =>
    b.addEventListener("click", () =>
      doDelete("delete_client", { p_id: b.dataset.clientDel },
        `Delete ${b.dataset.name} entirely?\n\n` +
        `This removes the client, their intake, every role they opened and every match ` +
        `for those roles. Candidate assessments are NOT affected.\n\n` +
        `If anyone has been placed with them, the server will refuse.`,
        loadSupplements, serr(b.dataset.clientDel))));

  if (overlap.length) {
    el("supp-overlap-region").hidden = false;
    el("supp-overlap").innerHTML = overlap.map((o) => `
      <div class="panel">
        <div class="cand-head"><span class="chip ${o.clients_asking >= 3 ? "warn" : ""}">${o.clients_asking} clients</span></div>
        <p class="small" style="margin-top:8px">${esc(o.prompt)}</p>
        ${o.clients_asking >= 3 ? `<p class="small"><strong>${esc(o.verdict)}</strong></p>` : ""}
      </div>`).join("");
  }
  view("supp");
}

el("nav-place").addEventListener("click", (e) => { e.preventDefault(); loadPlacements(); });
el("nav-supp").addEventListener("click", (e) => { e.preventDefault(); loadSupplements(); });

el("btn-back-reqs").addEventListener("click", loadRequirements);

// ═══ CANDIDATE QUEUE ═══════════════════════════════════════════════════════

// "0 eligible requirements" was the same sentence whether nothing was open, the
// person had not finished, or they were open and failed every filter. Those need
// three different actions from a recruiter, so they get three different lines —
// and the last one says where to look, because an excluded candidate is still ON
// the shortlist (R3) rather than missing from it.
function queueStatus(c) {
  if (!c.assessment_complete) return "waiting on them to finish";
  if (!c.open_reqs) return "assessed · no open roles to match against yet";
  if (c.eligible_reqs) {
    return `${c.eligible_reqs} of ${c.open_reqs} open role${c.open_reqs === 1 ? "" : "s"} — see the shortlist`;
  }
  return `assessed · passes no filter on ${c.open_reqs === 1 ? "the open role" : `any of ${c.open_reqs} open roles`}, still listed with the reason`;
}

async function loadQueue() {
  const rows = await sbFetch("v_candidate_queue?order=created_at.desc&limit=100");
  el("queue-count").textContent = `${rows.length}`;
  el("queue-list").innerHTML = rows.length
    ? rows.map((c) => `
      <div class="cand" style="grid-template-columns:1fr">
        <div>
          <div class="cand-head">
            <span class="cand-name"><a href="#cand-${esc(c.id)}" data-cand="${esc(c.id)}"
              >${esc(c.full_name)}</a></span>
            ${c.assessment_complete
              ? `<span class="chip strong">assessed</span>`
              : `<span class="chip">not finished</span>`}
            ${(c.flags || []).map((f) => `<span class="chip">${esc(f.replace(/_/g, " "))}</span>`).join(" ")}
            <span class="spacer"></span>
            <span class="small muted">${queueStatus(c)}</span>
          </div>
          <div class="actions" style="margin-top:10px">
            <button class="btn-quiet btn-small" data-cand-rename="${esc(c.id)}"
              data-name="${esc(c.full_name)}">Rename</button>
            <button class="btn-quiet btn-small" data-cand-del="${esc(c.id)}"
              data-name="${esc(c.full_name)}">Delete all their data</button>
            <span class="savestate" data-cslot="${esc(c.id)}"></span>
          </div>
        </div>
      </div>`).join("")
    : `<div class="empty"><h3>No candidates yet</h3>
       <p class="muted">Create a test link above.</p></div>`;

  el("queue-list").querySelectorAll("[data-cand]").forEach((a) =>
    a.addEventListener("click", (e) => { e.preventDefault(); openCandidate(a.dataset.cand); }));

  const cslot = (id) => document.querySelector(`[data-cslot="${id}"]`);
  const cerr = (id) => (m) => { cslot(id).textContent = m; cslot(id).dataset.state = "error"; };

  el("queue-list").querySelectorAll("[data-cand-rename]").forEach((b) =>
    b.addEventListener("click", () => {
      const next = prompt("Rename this candidate:", b.dataset.name);
      if (next === null || !next.trim()) return;
      doRename("rename_candidate", { p_id: b.dataset.candRename, p_name: next.trim() },
        loadQueue, cerr(b.dataset.candRename));
    }));

  // This is also the C3 withdrawal-and-deletion path, so it must exist whether
  // or not it is convenient: a candidate who asks to be removed gets removed.
  el("queue-list").querySelectorAll("[data-cand-del]").forEach((b) =>
    b.addEventListener("click", () =>
      doDelete("delete_candidate", { p_id: b.dataset.candDel },
        `Delete everything held on ${b.dataset.name}?\n\n` +
        `Their answers, scores, flags, match rows and interview records all go, permanently. ` +
        `This is the same action to take when someone asks to withdraw consent.\n\n` +
        `If they have been placed, the server will refuse — that outcome data cannot be recreated.`,
        loadQueue, cerr(b.dataset.candDel))));

  view("queue");
}

// ═══ ONE CANDIDATE ═════════════════════════════════════════════════════════
// The only screen that shows all nine scores at once, and the one most likely to
// be misread. Three rules shape it:
//
//   · A score is never shown alone. Every dimension carries the required level
//     from every open role, the gap, and whether it meets. With no open role the
//     page says so instead of rendering a table that looks like a verdict.
//   · Bipolar dimensions get a target and a distance, never a filled bar —
//     neither pole is better, and a bar growing toward 100 would claim otherwise.
//   · CLS_C and CLS_F are shown with the role's blend weights. Neither is "the"
//     closing score; the role decides the mix, which is why no blend is stored.

const num = (v) => (v === null || v === undefined ? null : Number(v));

// One bar per dimension: ink fill to the score, a tick per role target. Position
// carries the meaning, not colour — rule 4 holds here too.
function scoreBar(score, targets, bipolar) {
  const ticks = targets.map((t) => {
    const at = num(bipolar ? t.target : t.target);
    if (at === null) return "";
    return `<span class="tick" style="left:${Math.max(0, Math.min(100, at))}%"
              title="${esc(t.business_name)} — ${esc(t.title)}: ${at}"></span>`;
  }).join("");
  return `<span class="meter${bipolar ? " meter-bipolar" : ""}">
    <span class="meter-fill" style="width:${Math.max(0, Math.min(100, score))}%"></span>
    ${bipolar ? `<span class="meter-dot" style="left:${Math.max(0, Math.min(100, score))}%"></span>` : ""}
    ${ticks}</span>`;
}

function targetLine(d, t) {
  const who = `${esc(t.business_name)} — ${esc(t.title)}`;
  if (d.kind === "bipolar") {
    const dist = num(t.distance);
    return `${who}: sits best near <strong>${t.target}</strong> · this candidate is
            <strong>${dist}</strong> away${dist <= 15 ? " — close" : ""}`;
  }
  const delta = num(t.delta);
  const bit = delta >= 0
    ? `<strong>meets ${t.target}</strong>, ${delta} above`
    : `<strong>needs ${t.target}</strong>, ${Math.abs(delta)} short`;
  if (t.w !== null && t.w !== undefined) {
    return `${who}: ${bit} · this role weights it
            <strong>${Math.round(num(t.w) * 100)}%</strong> of closing,
            effective ${t.cls_effective}`;
  }
  return `${who}: ${bit}`;
}

async function openCandidate(id) {
  view("loading");
  let d;
  try { d = await sbRpc("get_candidate_detail", { p_candidate_id: id }); }
  catch (e) {
    el("cd-name").textContent = "Could not load this candidate";
    el("cd-meta").textContent = e.message;
    el("cd-body").innerHTML = ""; el("cd-disclaimer").textContent = "";
    return view("cand");
  }

  const c = d.candidate, a = d.assessment;
  el("cd-name").textContent = c.full_name;
  el("cd-meta").innerHTML = [
    a && a.completed_at ? `assessed ${onDate(a.completed_at)}` : null,
    a && a.minutes ? `${a.minutes} minutes` : null,
    a ? `${a.answered} of ${a.expected} answered` : null,
    c.consent_at ? `consented ${onDate(c.consent_at)}` : null,
  ].filter(Boolean).map(esc).join(" · ");

  if (!d.scored) {
    el("cd-body").innerHTML = `<div class="notice"><span class="label">Nothing to show yet</span>${esc(d.reason)}</div>`;
    el("cd-disclaimer").textContent = "";
    return view("cand");
  }

  // Where they stand, before any dimension is shown — the number that matters
  // is the one against a role, not the nine underneath it.
  const roles = d.roles || [];
  const rolesHtml = roles.length ? `
    <div class="region">
      <div class="region-head"><h2>Against the open roles</h2>
        <span class="count mono">${roles.length}</span></div>
      ${roles.map((r) => `
        <div class="req">
          <span class="title"><a href="#req-${esc(r.requirement_id)}"
            data-cdreq="${esc(r.requirement_id)}">${esc(r.business_name)} — ${esc(r.title)}</a></span>
          <span class="meta small">rank ${r.rank} of ${r.of} · quality ${r.quality_pct}% ·
            fit ${r.fit_pct}% · confidence ${esc(r.confidence || "—")}
            ${r.hard_filter_pass ? "" : ` · <strong>outside the stated filters</strong>:
              ${(r.hard_filter_fails || []).map(esc).join(" · ")}`}</span>
          <span class="figures"><span class="figure">${r.composite_pct}</span
            ><span class="figure-unit">%</span><br><span class="mono muted">match</span></span>
        </div>`).join("")}
    </div>` : `
    <div class="callout"><span class="label">No open role to read these against</span>
      Nine numbers on their own are not an assessment — 72 on Resilience is strong for
      one desk and short for another. The scores below are shown for completeness;
      they mean something once a client opens a role and the engine has a required
      level to compare each one to.</div>`;

  const flagsHtml = (d.flags || []).length ? `
    <div class="region">
      <div class="region-head"><h2>Flags</h2><span class="count mono">${d.flags.length}</span></div>
      <ul class="evidence">
        ${d.flags.map((f) => `<li><span class="glyph mono">!</span>
          <span><strong>${esc(f.code.replace(/_/g, " "))}</strong> — ${esc(f.meaning)}</span></li>`).join("")}
      </ul>
      <p class="small muted" style="margin-top:10px">A flag is something to ask about on
        the call. None of them changes a score, and none of them excludes anybody.</p>
    </div>` : "";

  const dims = (d.dimensions || []).map((dim) => {
    const score = num(dim.score);
    const targets = dim.targets || [];
    return `
      <div class="panel dim">
        <div class="cand-head">
          <span class="cand-name">${esc(dim.name)}</span>
          <span class="chip">${esc(dim.code)}</span>
          ${dim.kind === "bipolar" ? `<span class="chip">no better pole</span>` : ""}
          <span class="spacer"></span>
          <span class="figure">${score}</span>
        </div>
        ${scoreBar(score, targets, dim.kind === "bipolar")}
        ${dim.kind === "bipolar"
          ? `<div class="poles small muted"><span>${esc(dim.pole_0 || "0")}</span>
             <span>${esc(dim.pole_100 || "100")}</span></div>` : ""}
        <p class="small muted" style="margin:8px 0 0">${esc(dim.definition || "")}</p>
        ${targets.length
          ? `<ul class="evidence" style="margin-top:10px">
              ${targets.map((t) => `<li><span class="glyph mono">${
                dim.kind === "bipolar" ? "~" : (num(t.delta) >= 0 ? "+" : "!")
              }</span><span>${targetLine(dim, t)}</span></li>`).join("")}
             </ul>`
          : `<p class="small muted" style="margin-top:8px">No open role states a
             requirement for this one.</p>`}
      </div>`;
  }).join("");

  el("cd-body").innerHTML = rolesHtml + flagsHtml + `
    <div class="region">
      <div class="region-head"><h2>The nine, against what each role asks for</h2>
        <span class="count mono">${(d.dimensions || []).length}</span></div>
      ${dims}
    </div>`;
  el("cd-disclaimer").textContent = d.disclaimer || "";

  el("cd-body").querySelectorAll("[data-cdreq]").forEach((x) =>
    x.addEventListener("click", (e) => { e.preventDefault(); loadRequirement(x.dataset.cdreq); }));

  view("cand");
}

el("btn-back-queue").addEventListener("click", loadQueue);

el("btn-new-cand").addEventListener("click", async () => {
  const name = el("new-cand").value.trim();
  if (!name) return;
  const b = el("btn-new-cand"); b.disabled = true;
  try {
    const [c] = await sbFetch("candidates", {
      method: "POST",
      body: { full_name: name, contact: {}, consent_version: "pending", consent_at: new Date().toISOString() },
    });
    const token = await sbRpc("issue_assessment_token", { p_candidate_id: c.id, p_valid_days: 14 });
    const url = `${location.origin}${location.pathname.replace(/nikash\.html$/, "")}assess.html?t=${token}`;
    el("cand-link").hidden = false;
    el("cand-link").innerHTML =
      `<span class="label">Assessment link for ${esc(name)} — valid 14 days</span>
       <input type="text" readonly value="${esc(url)}" onclick="this.select()">`;
    el("new-cand").value = "";
    await loadQueue();
  } catch (e) {
    el("cand-link").hidden = false;
    el("cand-link").innerHTML = `<span class="label">Failed</span>${esc(e.message)}`;
  } finally { b.disabled = false; }
});

// ═══ INSTRUMENT HEALTH ═════════════════════════════════════════════════════

async function loadHealth() {
  const [alpha, dist, sd, group] = await Promise.all([
    sbFetch("v_dimension_alpha?order=dimension_code.asc").catch(() => []),
    sbFetch("v_score_distribution?order=dimension_code.asc").catch(() => []),
    sbFetch("v_sd_correlation?order=dimension_code.asc").catch(() => []),
    sbFetch("v_group_gaps").catch(() => []),
  ]);

  const table = (title, note, rows, cols) => `
    <div class="region">
      <div class="region-head"><h2>${esc(title)}</h2></div>
      <p class="muted small" style="margin-bottom:12px">${note}</p>
      ${rows.length ? `<div class="panel" style="padding:0">
        ${rows.map((r, i) => `
          <div style="display:grid;grid-template-columns:90px 1fr auto;gap:14px;align-items:baseline;
                      padding:12px 20px;${i ? "border-top:1px solid var(--line)" : ""}">
            <span class="mono">${esc(r[cols[0]])}</span>
            <span class="small muted">${esc(r.verdict ?? "")}</span>
            <span class="mono">${esc(r[cols[1]] ?? "—")}</span>
          </div>`).join("")}
      </div>` : `<div class="empty"><p class="muted">Nothing to report yet.</p></div>`}
    </div>`;

  el("health-body").innerHTML =
    table("Do the items agree?", "Cronbach's α per dimension. Below .60 rewrite. " +
      "<strong>CLS below .55 means collapse the split</strong> — a frame-specific claim built on noise is worse than no split.",
      alpha, ["dimension_code", "alpha"]) +
    table("Are the right answers obvious?", "Correlation with the social-desirability index. Above .40 the item is transparent and being gamed.",
      sd, ["dimension_code", "r_with_sd"]) +
    table("Does the dimension discriminate?", "Standard deviation of scores. Under 10 points means everyone looks the same.",
      dist, ["dimension_code", "sd"]) +
    table("Group differences", "A 15-point gap is a fact about the items, not about closers. It means rewrite them.",
      group, ["dimension_code", "gap"]);
  view("health");
}

// The order of operations, always reachable. It used to appear only on an empty
// console, which meant it vanished permanently after the first requirement —
// exactly when someone new to the tool still needs it.
const GUIDE = [
  ["1", "A client tells you about the role",
   "Create an intake link and send it. Six short steps, in their language — deal size, how long a sale takes, how their buyer responds, what separated their best closer from their worst. They never see a dimension name. The engine turns those answers into required levels, a deal-motion target and a closing-style weighting. A requirement opens the moment they submit."],
  ["2", "A closer takes the assessment, once",
   "Create a test link under Candidates. 44 items, about 25 minutes, on a phone. They are assessed with no knowledge of any client, which is what makes one assessment usable against every open role — and what lets a norm base build up at all."],
  ["3", "The engine ranks and explains",
   "Open a requirement to see the shortlist. Each row carries the reasons AND the concerns, with the operational consequence spelled out, plus flags, a note when someone is a frame-specific closer, and a line if they fit a different requirement better. It orders and explains. It never decides — there is no reject button, and no column in the database that could hold one."],
  ["4", "You run the verification call",
   "From any candidate row. You write your predicted ratings first, then get the call sheet: 15 minutes technical, 20 minutes band-matched role-play with three fixed objections, 15 minutes of probes the engine picked from that person's profile. You rate what happened, and only then do the scores unlock."],
  ["5", "The client gets a person, never a number",
   "A CV and your written recommendation. Optionally the role-play recording, with consent. No dimension scores, no match percentage, no rating sheet, no test. That single rule is why the compliance surface of this tool is small."],
];

const GUIDE_NOTES = [
  ["Why the percentage is small on the screen",
   "Because it is not validated yet. There is no outcome data linking these scores to who actually succeeded, so the weights are expert-set rather than learned. The number is a sorting aid, not a verdict, and the design refuses to let it look like one."],
  ["Why concerns sit next to reasons",
   "A shortlist that only shows strengths is a sales document. If a candidate is weak somewhere that matters for this role, that belongs in the same column at the same size."],
  ["Why excluded candidates are still listed",
   "A dimmed row names every filter it failed. Someone two weeks over a notice period is often still the right hire, and that call is yours to make — so the tool shows them rather than hiding them."],
  ["What needs your attention first",
   "Instrument health needs 30 completed assessments before it means anything — about two weeks at 60 candidates a month. And placement outcomes need recording for every placement from day one; that table is the only thing that will ever turn these expert guesses into findings."],
];

async function loadGuide() {
  el("guide-body").innerHTML =
    GUIDE.map(([n, title, body]) => `
      <div class="panel">
        <div class="cand-head"><span class="mono muted">Step ${n}</span></div>
        <h3 style="margin:6px 0 8px">${esc(title)}</h3>
        <p class="small">${esc(body)}</p>
      </div>`).join("") +
    `<div class="region" style="margin-top:34px">
      <div class="region-head"><h2>Things that will look odd until explained</h2></div>
      ${GUIDE_NOTES.map(([q, a]) => `
        <div class="panel"><h3>${esc(q)}</h3><p class="small">${esc(a)}</p></div>`).join("")}
    </div>`;
  view("guide");
}

el("nav-guide").addEventListener("click", (e) => { e.preventDefault(); loadGuide(); });
el("nav-reqs").addEventListener("click", (e) => { e.preventDefault(); loadRequirements(); });
el("nav-queue").addEventListener("click", (e) => { e.preventDefault(); loadQueue(); });
el("nav-health").addEventListener("click", (e) => { e.preventDefault(); loadHealth(); });

// ═══ BOOT ══════════════════════════════════════════════════════════════════
// A restored token gets the same positive check as a fresh sign-in. Reloading
// the page is not a second way in.
(async () => {
  if (sbRestoreToken()) {
    try {
      const me = await sbRpc("whoami");
      if (me && me.staff === true) { await loadRequirements(); return; }
    } catch (_) { /* fall through */ }
    sbSignOut();
  }
  view("signin");
})();
