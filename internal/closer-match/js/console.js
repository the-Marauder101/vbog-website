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

const VIEWS = ["signin", "reqs", "req", "queue", "health", "loading"];

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
  window.scrollTo(0, 0);
}

function rupees(n) {
  const v = Number(n);
  if (!isFinite(v)) return "—";
  if (v >= 100000) return "₹" + (v / 100000).toFixed(v % 100000 === 0 ? 0 : 2) + "L";
  if (v >= 1000) return "₹" + Math.round(v / 1000) + "k";
  return "₹" + v;
}
const cycle = (d) => (Number(d) === 0 ? "same-day" : `${d}-day`);

// ═══ SIGN IN ═══════════════════════════════════════════════════════════════

async function afterSignIn() {
  // Signing up grants nothing. Access exists only once an admin has added a
  // staff row, which link_staff_account() binds to this auth user.
  const link = await sbRpc("link_staff_account").catch(() => null);
  try {
    await loadRequirements();
  } catch (e) {
    sbSignOut();
    const why = link && link.linked === false ? link.reason : e.message;
    el("signin-error").hidden = false;
    el("signin-error").innerHTML =
      `<span class="label">No access</span>${esc(why)}`;
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
  try {
    await sbSignUp(el("si-email").value.trim(), el("si-pass").value);
    await sbSignIn(el("si-email").value.trim(), el("si-pass").value);
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
      <a class="req" href="#req-${esc(r.id)}" data-req="${esc(r.id)}">
        <span class="title">${esc(r.business_name)} — ${esc(r.title)}</span>
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
      </a>`).join("")
    : `<div class="empty"><h3>No open requirements</h3>
       <p class="muted">Start a client intake above. A requirement opens when the
       client submits it.</p></div>`;

  el("reqs-list").querySelectorAll("[data-req]").forEach((a) =>
    a.addEventListener("click", (e) => { e.preventDefault(); loadRequirement(a.dataset.req); }));
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
    `v_console?requirement_id=eq.${id}&order=engine_rank.asc`);

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
        Quality ${r.quality_pct}% · Fit ${r.fit_pct}% · effective closing ${Math.round(r.cls_effective)}
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

el("btn-back-reqs").addEventListener("click", loadRequirements);

// ═══ CANDIDATE QUEUE ═══════════════════════════════════════════════════════

async function loadQueue() {
  const rows = await sbFetch("v_candidate_queue?order=created_at.desc&limit=100");
  el("queue-count").textContent = `${rows.length}`;
  el("queue-list").innerHTML = rows.length
    ? rows.map((c) => `
      <div class="cand" style="grid-template-columns:1fr">
        <div>
          <div class="cand-head">
            <span class="cand-name">${esc(c.full_name)}</span>
            ${c.assessment_complete
              ? `<span class="chip strong">assessed</span>`
              : `<span class="chip">not finished</span>`}
            ${(c.flags || []).map((f) => `<span class="chip">${esc(f.replace(/_/g, " "))}</span>`).join(" ")}
            <span class="spacer"></span>
            <span class="small muted">${c.eligible_reqs} eligible requirement${c.eligible_reqs === 1 ? "" : "s"}</span>
          </div>
        </div>
      </div>`).join("")
    : `<div class="empty"><h3>No candidates yet</h3>
       <p class="muted">Create a test link above.</p></div>`;
  view("queue");
}

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

el("nav-reqs").addEventListener("click", (e) => { e.preventDefault(); loadRequirements(); });
el("nav-queue").addEventListener("click", (e) => { e.preventDefault(); loadQueue(); });
el("nav-health").addEventListener("click", (e) => { e.preventDefault(); loadHealth(); });

// ═══ BOOT ══════════════════════════════════════════════════════════════════
(async () => {
  if (sbRestoreToken()) {
    try { await loadRequirements(); return; } catch (_) { sbSignOut(); }
  }
  view("signin");
})();
