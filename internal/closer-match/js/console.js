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

const VIEWS = ["signin", "reqs", "req", "queue", "cand", "health", "guide", "dict", "place", "supp", "loading"];

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
                 // A scorecard is still "Candidates" — it belongs to a person, and
                 // that is where Back goes.
                 ask: "nav-queue",
                 health: "nav-health", place: "nav-place", supp: "nav-supp",
                 guide: "nav-guide", dict: "nav-dict", team: "nav-team",
                 questions: "nav-questions" };

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
  const b = el("btn-signup"); b.disabled = true; b.textContent = "Creating…";
  try {
    // A button labelled "Create account" must create an account. An earlier
    // version quietly fell through to signing in when the email already existed,
    // on the reasoning that people forget and press the wrong button — which is
    // true, and still not a licence for the button to do something other than
    // what it says. Pressing Create and landing inside the tool teaches you that
    // the label is decoration.
    await sbSignUp(email, pass);
    await sbSignIn(email, pass);
    await afterSignIn();
  } catch (e) {
    el("signin-error").hidden = false;
    el("signin-error").innerHTML = /already registered|already exists/i.test(e.message)
      ? `<span class="label">That account already exists</span>` +
        `${esc(email)} already has a password set. Use <strong>Sign in</strong> instead — ` +
        `and if you have forgotten it, an admin can reset it in Supabase.`
      : `<span class="label">Could not create the account</span>${esc(e.message)}`;
  } finally {
    b.disabled = false; b.textContent = "Create account";
  }
});

// ═══ TEAM ══════════════════════════════════════════════════════════════════
// Adding a colleague was a SQL insert until this existed, which made every
// delegation — handing R1 to the team, handing R2 to the team — wait on somebody
// opening a database console. See sql/34.
//
// The refusals that matter (you cannot remove your own access; you cannot remove
// the last admin) are enforced in the database, not here. A confirm() dialog is a
// suggestion, and the failure mode is being locked out of the screen that would
// let you back in.

const ROLE_MEANS = {
  admin: "the whole pipeline, plus keying rounds, re-keys and retention",
  recruiter: "candidate links, client intake, shortlists, interviews, placements",
  psych: "same access as a recruiter",
  keyer: "invited to key items — not a console account",
};

// ═══ THE QUESTIONS ═════════════════════════════════════════════════════════
//
// Editing the instrument from inside the tool. Three things this screen has to be
// honest about, because all three are easy to get wrong quietly:
//
//   · a reword does NOT change any finished scorecard. Every recorded answer
//     snapshots the wording it was scored against, so the count of past uses is
//     shown next to each question — a question used forty times is one to reword
//     carefully, not one the screen should let you change without saying so.
//   · an anchor's SCORE is not editable. Four anchors, 0 to 3, is what makes one
//     attribute total comparable to another. You change what a 2 reads like.
//   · the priority toggles are the R1/R2 split, which is now also the length of
//     Depesh's interview — so the screen shows both counts as they change.
let Q_BANK = null;

async function loadQuestions() {
  view("loading");
  try { Q_BANK = await sbRpc("get_ask_editor"); }
  catch (e) {
    el("q-summary").innerHTML = `<span class="label">Could not load the bank</span>${esc(e.message)}`;
    el("q-editor").innerHTML = "";
    return view("questions");
  }
  renderQuestions();
  view("questions");
}

function questionCounts(b) {
  const live = (b.attributes || []).filter((a) => a.active);
  const qs = (only) => live.filter(only).reduce((n, a) =>
    n + (a.questions || []).filter((q) => q.active && !q.is_reference).length, 0);
  return {
    r1: qs((a) => a.priority),
    r2rest: qs((a) => !a.priority),
    refs: live.reduce((n, a) =>
      n + (a.questions || []).filter((q) => q.active && q.is_reference).length, 0),
  };
}

function renderQuestions() {
  const b = Q_BANK;
  const c = questionCounts(b);
  const mins = (n) => Math.round((n * 70) / 60);

  // 70 seconds per question is measured, not assumed — v_ask_pacing reads it off
  // the answer timestamps. Showing the minute cost next to the question count is
  // the whole reason the R1 split is a decision anybody can make.
  el("q-summary").innerHTML = `
    <span class="label">What the two rounds cost right now</span>
    <strong>R1 — ${c.r1} questions</strong>, about ${mins(c.r1)} minutes, run by whoever
    does the phone screen. <strong>R2 — ${c.r2rest} questions</strong>, about
    ${mins(c.r2rest)} minutes, because an R2 after a submitted R1 does not ask
    again what R1 already scored. Plus ${c.refs} reference question${c.refs === 1 ? "" : "s"}
    for their previous manager, on a separate call.
    <br><br>
    At about 70 seconds a question — measured from your own interviews, not
    estimated — the whole bank in one sitting is ${mins(c.r1 + c.r2rest)} minutes.
    Splitting it is what gets your part inside 30.
    ${b.can_edit ? "" : `<br><br><strong>You are signed in as a recruiter, so this
      screen is read-only.</strong> Changing the instrument is an admin action.`}`;

  el("q-editor").innerHTML = (b.attributes || []).map((a) => {
    const qs = (a.questions || []);
    const liveQs = qs.filter((q) => q.active && !q.is_reference).length;
    return `
    <div class="region">
      <div class="region-head">
        <h2>${esc(a.name)}</h2>
        <span class="count mono">${liveQs}</span>
      </div>
      <div class="panel" style="margin-bottom:12px">
        <div class="cand-head">
          <span class="chip">${esc(b.sections[a.section] || a.section)}</span>
          ${a.priority ? `<span class="chip strong">in R1</span>` : `<span class="chip">R2 only</span>`}
          ${a.active ? "" : `<span class="chip warn">not in use</span>`}
          <span class="spacer"></span>
          ${b.can_edit ? `
            <button class="btn-quiet btn-small" data-attr-prio="${esc(a.id)}"
              data-to="${a.priority ? "false" : "true"}"
              >${a.priority ? "Move out of R1" : "Put in R1"}</button>
            <button class="btn-quiet btn-small" data-attr-active="${esc(a.id)}"
              data-to="${a.active ? "false" : "true"}"
              >${a.active ? "Take out of use" : "Put back in use"}</button>` : ""}
          <span class="savestate" data-aslot="${esc(a.id)}"></span>
        </div>
      </div>
      ${qs.map((q) => `
        <div class="panel dim" style="margin-bottom:10px">
          <div class="cand-head">
            <span class="cand-name mono">${esc(q.id)}</span>
            ${q.is_reference ? `<span class="chip">reference call</span>` : ""}
            ${q.active ? "" : `<span class="chip warn">not in use</span>`}
            ${q.times_scored
              ? `<span class="chip">scored ${q.times_scored}×</span>`
              : `<span class="chip">never used</span>`}
            <span class="spacer"></span>
            ${b.can_edit ? `
              <button class="btn-quiet btn-small" data-q-active="${esc(q.id)}"
                data-to="${q.active ? "false" : "true"}"
                >${q.active ? "Take out of use" : "Put back in use"}</button>` : ""}
          </div>

          <div class="field" style="margin:10px 0 0">
            <label for="qp-${esc(q.id)}">The question, as it is asked</label>
            <textarea id="qp-${esc(q.id)}" rows="2" data-qprompt="${esc(q.id)}"
              ${b.can_edit ? "" : "readonly"}>${esc(q.prompt)}</textarea>
          </div>
          <div class="field" style="margin:8px 0 0">
            <label for="qh-${esc(q.id)}">What the interviewer is listening for</label>
            <span class="help">Never read out. It is what separates a scorecard
              from a list of questions.</span>
            <textarea id="qh-${esc(q.id)}" rows="2" data-qhint="${esc(q.id)}"
              ${b.can_edit ? "" : "readonly"}>${esc(q.hint || "")}</textarea>
          </div>
          ${b.can_edit ? `
            <div class="actions" style="margin-top:8px">
              <button class="btn-quiet btn-small" data-qsave="${esc(q.id)}">Save the question</button>
              <span class="savestate" data-qslot="${esc(q.id)}"></span>
            </div>` : ""}

          <p class="small muted" style="margin:14px 0 6px"><strong>The four anchors.</strong>
            The score is fixed — you are rewriting what each one reads like.</p>
          ${(q.options || []).map((o) => `
            <div class="panel plain" style="margin-bottom:8px">
              <div class="cand-head">
                <span class="glyph mono">${o.score}</span>
                <span class="spacer"></span>
                ${b.can_edit ? `
                  <button class="btn-quiet btn-small"
                    data-osave="${esc(q.id)}" data-score="${o.score}">Save anchor</button>
                  <span class="savestate" data-oslot="${esc(q.id)}-${o.score}"></span>` : ""}
              </div>
              <div class="field" style="margin:8px 0 0">
                <label for="ol-${esc(q.id)}-${o.score}">Short label</label>
                <input type="text" id="ol-${esc(q.id)}-${o.score}"
                  data-olabel="${esc(q.id)}-${o.score}" value="${esc(o.label)}"
                  ${b.can_edit ? "" : "readonly"}>
              </div>
              <div class="field" style="margin:8px 0 0">
                <label for="od-${esc(q.id)}-${o.score}">The behaviour it describes</label>
                <textarea id="od-${esc(q.id)}-${o.score}" rows="2"
                  data-odesc="${esc(q.id)}-${o.score}"
                  ${b.can_edit ? "" : "readonly"}>${esc(o.description)}</textarea>
              </div>
            </div>`).join("")}
        </div>`).join("")}
    </div>`;
  }).join("");

  if (Q_BANK.can_edit) bindQuestionEditor();
}

function bindQuestionEditor() {
  const body = el("q-editor");
  const say = (sel, text, state) => {
    const s = body.querySelector(sel);
    if (!s) return;
    s.textContent = text;
    if (state) s.dataset.state = state; else delete s.dataset.state;
  };

  body.querySelectorAll("[data-qsave]").forEach((b) =>
    b.addEventListener("click", async () => {
      const id = b.dataset.qsave;
      b.disabled = true;
      say(`[data-qslot="${id}"]`, "Saving…");
      try {
        const r = await sbRpc("update_ask_question", {
          p_id: id,
          p_prompt: body.querySelector(`[data-qprompt="${id}"]`).value,
          p_hint: body.querySelector(`[data-qhint="${id}"]`).value,
        });
        // The note is the important half: it says the past is untouched, which is
        // the question anybody rewording a used question actually has.
        say(`[data-qslot="${id}"]`, r.note || "Saved", "saved");
      } catch (e) { say(`[data-qslot="${id}"]`, e.message, "error"); }
      finally { b.disabled = false; }
    }));

  body.querySelectorAll("[data-osave]").forEach((b) =>
    b.addEventListener("click", async () => {
      const id = b.dataset.osave, score = Number(b.dataset.score);
      b.disabled = true;
      say(`[data-oslot="${id}-${score}"]`, "Saving…");
      try {
        await sbRpc("update_ask_option", {
          p_question: id, p_score: score,
          p_label: body.querySelector(`[data-olabel="${id}-${score}"]`).value,
          p_description: body.querySelector(`[data-odesc="${id}-${score}"]`).value,
        });
        say(`[data-oslot="${id}-${score}"]`, "Saved", "saved");
      } catch (e) { say(`[data-oslot="${id}-${score}"]`, e.message, "error"); }
      finally { b.disabled = false; }
    }));

  // The three toggles all reload, because each one changes the counts at the top
  // and a stale header on this screen is a wrong interview length.
  const toggle = (attr, fn, arg, slot) =>
    body.querySelectorAll(`[${attr}]`).forEach((b) =>
      b.addEventListener("click", async () => {
        const id = b.getAttribute(attr), to = b.dataset.to === "true";
        b.disabled = true;
        say(slot(id), "Saving…");
        try {
          await sbRpc(fn, { ...arg(id, to) });
          await loadQuestions();
        } catch (e) { say(slot(id), e.message, "error"); b.disabled = false; }
      }));

  toggle("data-q-active", "set_ask_question_active",
         (id, to) => ({ p_id: id, p_active: to }), (id) => `[data-qslot="${id}"]`);
  toggle("data-attr-active", "set_ask_attribute_active",
         (id, to) => ({ p_id: id, p_active: to }), (id) => `[data-aslot="${id}"]`);
  toggle("data-attr-prio", "set_ask_attribute_priority",
         (id, to) => ({ p_id: id, p_priority: to }), (id) => `[data-aslot="${id}"]`);
}

const navQuestions = el("nav-questions");
if (navQuestions) navQuestions.addEventListener("click", (e) => { e.preventDefault(); loadQuestions(); });

async function loadTeam() {
  view("loading");
  let rows;
  try { rows = await sbRpc("list_staff"); }
  catch (e) {
    el("team-list").innerHTML = `<div class="notice notice-error">${esc(e.message)}</div>`;
    return view("team");
  }

  const me = rows.find((r) => r.is_you);
  const admin = me && me.role === "admin" && me.active;
  el("team-add-region").hidden = !admin;

  el("team-count").textContent = `${rows.filter((r) => r.active && r.role !== "keyer").length}`;
  el("team-list").innerHTML = rows.map((r) => `
    <div class="cand${r.active ? "" : " excluded"}" style="grid-template-columns:1fr">
      <div>
        <div class="cand-head">
          <span class="cand-name">${esc(r.full_name || r.email)}</span>
          <span class="chip">${esc(r.role)}</span>
          ${r.is_you ? `<span class="chip">you</span>` : ""}
          ${!r.linked && r.active && r.role !== "keyer"
            ? `<span class="chip warn">has not signed up yet</span>` : ""}
          <span class="spacer"></span>
          <span class="small muted mono">${esc(r.email)}</span>
        </div>
        <p class="small muted" style="margin:4px 0 0">
          ${esc(r.state)} · ${esc(ROLE_MEANS[r.role] || "")}</p>
        ${admin && r.role !== "keyer" ? `
          <div class="actions" style="margin-top:10px">
            ${r.active ? `
              <select data-role-for="${esc(r.id)}" style="width:auto">
                ${["admin", "recruiter", "psych"].map((x) =>
                  `<option value="${x}"${x === r.role ? " selected" : ""}>${x}</option>`).join("")}
              </select>
              ${r.is_you ? "" :
                `<button class="btn-quiet btn-small" data-off="${esc(r.id)}"
                   data-name="${esc(r.full_name || r.email)}">Remove access</button>`}`
              : `<button class="btn-quiet btn-small" data-on="${esc(r.id)}">Restore access</button>`}
            <span class="savestate" data-tslot="${esc(r.id)}"></span>
          </div>` : ""}
      </div>
    </div>`).join("");

  el("team-list").querySelectorAll("[data-role-for]").forEach((sel) =>
    sel.addEventListener("change", async () => {
      const id = sel.dataset.roleFor, slot = document.querySelector(`[data-tslot="${id}"]`);
      slot.textContent = "Saving…"; delete slot.dataset.state;
      try { await sbRpc("set_staff_role", { p_id: id, p_role: sel.value }); await loadTeam(); }
      catch (e) { slot.textContent = e.message; slot.dataset.state = "error"; }
    }));

  el("team-list").querySelectorAll("[data-off]").forEach((b) =>
    b.addEventListener("click", async () => {
      const id = b.dataset.off, slot = document.querySelector(`[data-tslot="${id}"]`);
      if (!confirm(
        `Remove ${b.dataset.name}'s access?\n\n` +
        `Their name stays on every decision, key and placement they recorded — the ` +
        `row is deactivated, never deleted, so the record does not quietly change.`)) return;
      slot.textContent = "Saving…"; delete slot.dataset.state;
      try { await sbRpc("set_staff_active", { p_id: id, p_active: false }); await loadTeam(); }
      catch (e) { slot.textContent = e.message; slot.dataset.state = "error"; }
    }));

  el("team-list").querySelectorAll("[data-on]").forEach((b) =>
    b.addEventListener("click", async () => {
      const id = b.dataset.on, slot = document.querySelector(`[data-tslot="${id}"]`);
      slot.textContent = "Saving…"; delete slot.dataset.state;
      try { await sbRpc("set_staff_active", { p_id: id, p_active: true }); await loadTeam(); }
      catch (e) { slot.textContent = e.message; slot.dataset.state = "error"; }
    }));

  view("team");
}

const addStaffBtn = el("btn-add-staff");
if (addStaffBtn) addStaffBtn.addEventListener("click", async () => {
  const slot = el("team-state");
  addStaffBtn.disabled = true;
  slot.textContent = "Adding…"; delete slot.dataset.state;
  try {
    const r = await sbRpc("add_staff", {
      p_email: el("team-email").value.trim(),
      p_name: el("team-name").value.trim(),
      p_role: el("team-role").value,
    });
    el("team-email").value = ""; el("team-name").value = "";
    await loadTeam();
    el("team-state").textContent = r.message;
    el("team-state").dataset.state = "saved";
  } catch (e) {
    slot.textContent = e.message; slot.dataset.state = "error";
  } finally { addStaffBtn.disabled = false; }
});

const navTeam = el("nav-team");
if (navTeam) navTeam.addEventListener("click", (e) => { e.preventDefault(); loadTeam(); });

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

// ═══ THE CLIENT'S OWN ANSWERS ══════════════════════════════════════════════
// Requested directly, and it fixes a real class of error rather than just being
// convenient: one of the three live clients entered a monthly salary into a box
// labelled per year, which silently disqualifies every candidate against it. A
// client fills the intake once, from memory. There has to be a way to correct it
// that is not "send another link and open a second requirement".
//
// Editing re-derives the target profile, because the profile is COMPUTED from
// these answers. Leaving it alone would produce a requirement whose stated
// inputs no longer generate its own targets — the worst kind of wrong, since
// everything still looks consistent.

const INTAKE_LABELS = {
  role_title: "Role title", ticket_size: "Typical deal value (₹)",
  cycle_days: "Days from first contact to close", leads_per_day: "Leads a closer gets a day",
  cold_outbound_pct: "Cold outbound (%)", followup_rate_pct: "Deals needing follow-up (%)",
  buyer_response: "How their buyer responds", buyer_is_senior: "Buyer is senior",
  has_crm: "They have a CRM", refund_policy_exists: "A refund policy exists",
  comp_band: "Comp band", salary_min: "Fixed pay, from (₹/year)",
  salary_max: "Fixed pay, up to (₹/year)",
  expected_days_to_first_close: "Expected days to first close",
  hf_language: "Languages required (comma-separated)", hf_locations: "Cities (comma-separated)",
  hf_work_mode: "Work mode", hf_join_by_days: "Days they can wait for a joiner",
  hf_min_years: "Minimum years of experience", notes: "Notes",
};
// top3/bottom3 are the forced-rank answers and the whole basis of the target
// profile. They are shown, never edited here — re-ranking them by typing into a
// box would lose the constraint that makes a forced rank mean anything.
const INTAKE_READONLY = ["top3", "bottom3", "benchmark_source", "hard_filters"];

let INTAKE = null;

async function loadClientIntake(requirementId) {
  el("intake-edit").hidden = true;
  el("btn-edit-intake").textContent = "Edit";
  try {
    INTAKE = await sbRpc("get_client_intake", { p_requirement_id: requirementId });
  } catch (e) {
    el("intake-view").innerHTML = `<div class="notice"><span class="label">Could not load the intake</span>${esc(e.message)}</div>`;
    return;
  }
  const p = (INTAKE && INTAKE.payload) || null;
  if (!p) {
    el("intake-view").innerHTML =
      `<div class="empty"><h3>No intake on file</h3><p class="muted">This requirement was
       not created from a completed intake form.</p></div>`;
    el("btn-edit-intake").hidden = true;
    return;
  }
  el("btn-edit-intake").hidden = false;

  const hf = INTAKE.hard_filters || {};
  el("intake-view").innerHTML = `
    <p class="small muted">Submitted ${onDate(INTAKE.submitted_at)} · intake confidence
       <strong>${esc(INTAKE.confidence || "—")}</strong></p>
    <div class="panel">
      <div class="fields">
        ${Object.keys(INTAKE_LABELS).filter((k) => p[k] !== undefined && p[k] !== "" && p[k] !== null)
          .map((k) => `<label><span>${esc(INTAKE_LABELS[k])}</span>
            <input type="text" readonly value="${esc(String(p[k]))}"></label>`).join("")}
      </div>
      <ul class="evidence" style="margin-top:14px">
        <li><span class="glyph">+</span><span><strong>Most like this role</strong> —
          ${(p.top3 || []).map(esc).join(" · ") || "—"}</span></li>
        <li><span class="glyph mono">−</span><span><strong>Least like this role</strong> —
          ${(p.bottom3 || []).map(esc).join(" · ") || "—"}</span></li>
        <li><span class="glyph mono">=</span><span><strong>Hard filters as stored</strong> —
          ${esc(JSON.stringify(hf))}</span></li>
      </ul>
    </div>`;
}

function intakeEditor() {
  const p = INTAKE.payload || {};
  el("intake-edit").innerHTML = `
    <div class="notice"><span class="label">Editing changes the shortlist</span>
      The target profile is derived from these answers, so saving recomputes it and
      re-ranks every candidate against this role. The forced-rank answers are shown
      but not editable — re-ranking them by typing would lose the constraint that
      makes a forced rank mean anything. Re-issue an intake link for that.</div>
    <div class="panel">
      <div class="fields">
        ${Object.keys(INTAKE_LABELS).map((k) => `
          <label><span>${esc(INTAKE_LABELS[k])}</span>
            <input type="${typeof p[k] === "number" || /_(pct|days|size|min|max|years)$/.test(k)
              ? "number" : "text"}" data-ik="${esc(k)}"
              value="${esc(p[k] === undefined || p[k] === null ? "" : String(p[k]))}"></label>`).join("")}
      </div>
      <div class="actions" style="margin-top:14px">
        <button class="btn-primary btn-small" id="btn-save-intake">Save and re-rank</button>
        <button class="btn-quiet btn-small" id="btn-cancel-intake">Cancel</button>
        <span class="savestate" id="intake-state"></span>
      </div>
    </div>`;

  el("btn-cancel-intake").addEventListener("click", () => {
    el("intake-edit").hidden = true; el("btn-edit-intake").textContent = "Edit";
  });

  el("btn-save-intake").addEventListener("click", async () => {
    const slot = el("intake-state"), btn = el("btn-save-intake");
    const payload = { ...INTAKE.payload };
    document.querySelectorAll("[data-ik]").forEach((i) => {
      const k = i.dataset.ik, v = i.value.trim();
      if (v === "") { delete payload[k]; return; }
      payload[k] = i.type === "number" ? Number(v) : v;
    });

    // hard_filters is DERIVED, and the server derives it — see
    // derive_hard_filters in sql/29. Computing it here as well would give two
    // dialects of one rule, and the QA caught exactly that: a browser that sent
    // the payload's own stale copy put the "en, hi" bug straight back.
    delete payload.hard_filters;

    const yearly = Number(payload.salary_max || payload.salary_min || 0);
    if (yearly && yearly < 100000 &&
        !confirm(`₹${yearly.toLocaleString("en-IN")} a year is below a plausible annual ` +
                 `salary — this is the box a client already filled in monthly.\n\n` +
                 `OK to save as typed, Cancel to fix it.`)) return;

    btn.disabled = true;
    slot.textContent = "Recomputing the target profile and re-ranking…"; delete slot.dataset.state;
    try {
      const r = await sbRpc("update_client_intake",
        { p_requirement_id: INTAKE.requirement_id, p_payload: payload });
      slot.textContent = `Saved — ${r.changed.length} field${r.changed.length === 1 ? "" : "s"} changed, ` +
                         `${r.candidates_ranked} candidate${r.candidates_ranked === 1 ? "" : "s"} re-ranked`;
      slot.dataset.state = "saved";
      await loadRequirement(INTAKE.requirement_id);
    } catch (e) {
      slot.textContent = e.message; slot.dataset.state = "error"; btn.disabled = false;
    }
  });
}

const editIntakeBtn = el("btn-edit-intake");
if (editIntakeBtn) editIntakeBtn.addEventListener("click", () => {
  const open = !el("intake-edit").hidden;
  if (open) { el("intake-edit").hidden = true; editIntakeBtn.textContent = "Edit"; return; }
  intakeEditor();
  el("intake-edit").hidden = false; editIntakeBtn.textContent = "Close";
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
  el("req-list").querySelectorAll("[data-fillcand]").forEach((a) =>
    a.addEventListener("click", (e) => { e.preventDefault(); openCandidate(a.dataset.fillcand); }));
  await loadClientIntake(id);
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

      ${(r.hard_filter_fails || []).length ? `
        <div class="callout plain">
          <span class="label">Outside the stated filters — overridable</span>
          ${(r.hard_filter_fails || []).map(esc).join(" · ")}
        </div>` : ""}

      ${(r.hard_filter_unknown || []).length ? `
        <div class="callout plain">
          <span class="label">Cannot check — we never asked</span>
          ${(r.hard_filter_unknown || []).map(esc).join(" · ")}.
          <a href="#" data-fillcand="${esc(r.candidate_id)}">Record it now</a> and the
          shortlist re-ranks.
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

// The nine, in the same order as the detail page, so the eye learns one
// sequence. Short labels because this is a strip to scan, not a table to read —
// the full name and its target live one click away.
const DIMS = [
  ["CLS_C", "cls·c"], ["CLS_F", "cls·f"], ["RES", "res"], ["DRV", "drv"],
  ["DSC", "dsc"], ["CCH", "cch"], ["INT", "int"], ["MOT", "mot"], ["STY", "sty"],
];

// The two bipolar dimensions get their side printed under the number. Without
// it, `sty 0` sits beside seven dimensions where 0 genuinely is bad and reads as
// a failing grade — when it actually means "task-direct on all five items".
// Truncated to the first word of the pole label so the cell stays a cell; the
// title attribute and the detail page carry the full phrase.
function scoreStrip(scores, sides) {
  if (!scores) return "";
  return `<div class="strip mono">${DIMS.map(([k, label]) => {
    if (scores[k] === undefined) return "";
    const side = sides && sides[k];
    if (!side) return `<span><em>${label}</em>${scores[k]}</span>`;
    const short = side.label.replace(/^(fully|leans) /, "").split(/[ \/]/)[0].toLowerCase();
    return `<span class="pole" title="${esc(side.label)} — ${esc(side.note)}"
      ><em>${label}</em>${scores[k]}<i>${esc(short)}</i></span>`;
  }).join("")}
    <a href="#" class="strip-key mono" data-dict>what these mean →</a></div>`;
}

// Every open role this person has been matched against, best first. The
// percentage travels with the role it was computed against — detached from the
// requirement it is a different number, not a shorter one.
function roleLines(roles) {
  if (!roles || !roles.length) return "";
  return `<ul class="evidence" style="margin-top:10px">${roles.map((r) => `
    <li><span class="glyph mono">${r.pass ? "+" : "!"}</span><span>
      <strong>${r.pct}%</strong> · ${esc(r.business_name)} — ${esc(r.title)}
      · rank ${r.rank} of ${r.of}${r.pass ? "" :
        ` · <strong>outside the stated filters</strong>: ${(r.fails || []).map(esc).join(" · ")}`}
    </span></li>`).join("")}</ul>`;
}

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
            ${c.best_pct != null
              ? `<span class="figure">${c.best_pct}</span><span class="figure-unit">%</span>`
              : `<span class="small muted">${queueStatus(c)}</span>`}
          </div>
          ${c.best_pct != null ? `<p class="small muted" style="margin:4px 0 0">${queueStatus(c)}</p>` : ""}
          ${roleLines(c.roles)}
          ${c.ask ? `<p class="small muted" style="margin:6px 0 0">
            <span class="chip">ASK ${esc(c.ask.round.toUpperCase())} ${c.ask.pct}%</span>
            ${c.ask.total} of ${c.ask.max_total} · ${onDate(c.ask.on)}</p>`
          // Somebody whose job today is running interviews should not have to
          // open a candidate and scroll to find the button. The row says the
          // interview has not happened, and offers to start it.
          : `<p class="small muted" style="margin:6px 0 0">
            <span class="chip">no ASK interview yet</span></p>`}
          ${scoreStrip(c.scores, c.sides)}
          <div class="actions" style="margin-top:10px">
            ${askRunLinks(c.id)}
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

  el("queue-list").querySelectorAll("[data-dict]").forEach((a) =>
    a.addEventListener("click", (e) => { e.preventDefault(); loadDictionary(); }));

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

// ═══ DICTIONARY ════════════════════════════════════════════════════════════
// The construct definitions in the database were written for whoever built the
// instrument. "Behaviour change after correction" is precise and tells a
// recruiter nothing about what a 55 looks like on a Tuesday. This screen answers
// the question people actually have: what does this number mean, and what does
// it cost me if it is low.

async function loadDictionary() {
  view("loading");
  const d = await sbRpc("get_dictionary");
  el("dict-scale").textContent = d.scale;
  el("dict-caveat").textContent = d.caveat;

  el("dict-body").innerHTML = d.dimensions.map((x) => `
    <div class="panel dim">
      <div class="cand-head">
        <span class="cand-name">${esc(x.plain_name || x.name)}</span>
        <span class="chip">${esc(x.code)}</span>
        ${x.kind === "bipolar" ? `<span class="chip">fit, not quality</span>` : ""}
        <span class="spacer"></span>
        <span class="mono muted">${x.n_items} items</span>
      </div>
      <p class="small muted" style="margin:6px 0 14px">
        <strong>${esc(x.name)}</strong> — ${esc(x.definition)}</p>

      <ul class="evidence">
        <li><span class="glyph mono">${x.kind === "bipolar" ? "→" : "+"}</span>
          <span><strong>${x.kind === "bipolar" ? esc(x.pole_100 || "high end") : "High"}</strong>
          — ${esc(x.high_looks_like)}</span></li>
        <li><span class="glyph mono">${x.kind === "bipolar" ? "←" : "!"}</span>
          <span><strong>${x.kind === "bipolar" ? esc(x.pole_0 || "low end") : "Low"}</strong>
          — ${esc(x.low_looks_like)}</span></li>
        <li><span class="glyph mono">₹</span>
          <span><strong>Why it matters</strong> — ${esc(x.why_it_matters)}</span></li>
        <li><span class="glyph mono">?</span>
          <span><strong>How it is measured</strong> — ${esc(x.how_measured)}</span></li>
      </ul>

      ${(x.required_by || []).length
        ? `<div class="callout plain" style="margin-top:12px">
             <span class="label">What the open roles ask for</span>
             ${x.required_by.map((r) => `${esc(r.business_name)} — ${esc(r.title)}:
               <strong>${r.level == null ? "not stated" : r.level}</strong>`).join(" · ")}
           </div>`
        : ""}
    </div>`).join("");
  view("dict");
}

el("nav-dict").addEventListener("click", (e) => { e.preventDefault(); loadDictionary(); });

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

// ═══ ASK — THE INTERVIEW, BESIDE THE QUESTIONNAIRE ═════════════════════════
// Two independent readings of the same person, shown next to each other and
// never added together. The questionnaire measures fit against one client's
// stated needs; ASK measures whether they can sell at all. Averaging them makes
// one number that looks objective while carrying an interviewer's judgement
// inside it, and throws away the only thing neither can produce alone: the
// disagreement between them.

const ASK_SECTIONS = {
  sell: "Can they actually sell?",
  sustain: "Can they sustain it?",
  who: "Who are they underneath?",
};

// The reference call is its own flow, on its own link. Both reference questions
// are put to the candidate's previous manager, days later or never, and the score
// they carry joins the total the moment it is recorded (sql/40).
function askRefLink(cardId, outstanding) {
  if (!cardId || !outstanding) return "";
  return `<a class="btn-quiet btn-small" href="ask.html?mode=ref&card=${esc(cardId)}"
    >Record reference check (${outstanding})</a>`;
}

function askRunLinks(id) {
  return `<a class="btn-quiet btn-small" href="ask.html?cand=${esc(id)}&round=r1">Run R1 screen</a>
          <a class="btn-quiet btn-small" href="ask.html?cand=${esc(id)}&round=r2">Run R2 interview</a>`;
}

function askHtml(d, c) {
  const cards = (d.ask || []).filter((x) => x.submitted_at);
  const open = (d.ask || []).find((x) => !x.submitted_at);

  if (!cards.length) {
    return `
    <div class="region">
      <div class="region-head"><h2>ASK interview</h2><span class="count mono">0</span></div>
      <div class="empty">
        <h3>Not interviewed yet</h3>
        <p class="muted">${open
          ? `An unfinished ${esc(open.round.toUpperCase())} is open — starting again resumes it.`
          : `R1 is a 15-question phone screen. R2 is the full 42. Both are scored
             against written anchors, so two interviewers reading the same answer
             land in the same place.`}</p>
        <div class="actions" style="margin-top:12px">${askRunLinks(c.id)}</div>
      </div>
    </div>`;
  }

  // A submitted interview AND an open one at the same time. Live data showed how
  // this happens: "Run R2 again" on the results screen, pressed fourteen seconds
  // after submitting, opens an empty scorecard — and that empty one is then the
  // card Run R2 resumes, so the next person sees a blank interview instead of the
  // finished one. Say it plainly and offer to throw the empty one away.
  const strayOpen = open ? `
    <div class="notice" style="margin-top:14px">
      <span class="label">There is also an unfinished ${esc(open.round.toUpperCase())} open</span>
      Pressing Run ${esc(open.round.toUpperCase())} resumes that one rather than showing the
      submitted interview below. If it was opened by accident, discard it.
      <div class="actions" style="margin-top:10px">
        <button class="btn-quiet btn-small" data-ask-discard="${esc(open.id)}"
          >Discard the unfinished ${esc(open.round.toUpperCase())}</button>
        <span class="savestate" data-askslot="${esc(open.id)}"></span>
      </div>
    </div>` : "";

  const latest = cards[0];
  const attrs = latest.attributes || [];
  const pri = attrs.filter((a) => a.priority);
  const secs = latest.sections || {};
  const gaps = ((d.ask_overlap && d.ask_overlap.rows) || []);
  const flagged = gaps.filter((g) => g.flagged);

  const line = (a) => `<span class="mono">${esc(a.name)}</span> ${a.score}/${a.max}`;

  return `
  <div class="region">
    <div class="region-head"><h2>ASK interview</h2>
      <span class="count mono">${latest.round.toUpperCase()}</span></div>
    ${strayOpen}

    <div class="panel">
      <div class="cand-head">
        <span class="cand-name">${latest.round === "r1" ? "R1 — screen" : "R2 — full"}</span>
        ${latest.outstanding_refs
          ? `<span class="chip warn">${latest.outstanding_refs} reference question${
              latest.outstanding_refs > 1 ? "s" : ""} outstanding</span>` : ""}
        <span class="spacer"></span>
        <span><span class="figure">${latest.pct}</span><span class="figure-unit">%</span></span>
      </div>
      <p class="small muted" style="margin:4px 0 0">
        ${latest.total} of ${latest.max_total} ·
        run by ${esc(latest.interviewer || "somebody since removed")} ·
        ${onDate(latest.conducted_on)}${
          latest.client_context ? ` · for ${esc(latest.client_context)}` : ""}
      </p>

      ${pri.length ? `<ul class="evidence" style="margin-top:12px">
        <li><span class="glyph mono">★</span><span><strong>Priority attributes</strong> —
          ${pri.map(line).join(" · ")}</span></li>
        ${Object.keys(secs).length ? `<li><span class="glyph mono">=</span><span><strong>By section</strong> —
          ${Object.entries(secs).map(([k, v]) =>
            `${esc(ASK_SECTIONS[k] || k)} ${v.score}/${v.max}`).join(" · ")}</span></li>` : ""}
      </ul>` : ""}

      ${latest.outstanding_refs ? `
        <div class="notice" style="margin-top:12px">
          <span class="label">The reference call has not happened yet</span>
          ${latest.outstanding_refs} question${latest.outstanding_refs > 1 ? "s" : ""}
          go to their previous manager, not to them. Those are counted neither for nor
          against — the ${latest.pct}% above describes the interview that happened. Record
          them whenever the call comes and the total updates then.
        </div>`
      // Saying nothing when they are all in leaves a reader unable to tell a
      // complete scorecard from one where nobody has checked. Both states get a
      // sentence.
      : `<div class="notice plain" style="margin-top:12px">
          <span class="label">The reference questions are already in</span>
          Both were put to their previous manager and scored, so this ${latest.pct}%
          covers the interview and the reference call together.
        </div>`}

      <div class="actions" style="margin-top:14px">
        <button class="btn-quiet btn-small" data-ask-open="${esc(latest.id)}"
          >Read the full scorecard</button>
        ${askRefLink(latest.id, latest.outstanding_refs)}
        ${askRunLinks(c.id)}
      </div>
    </div>

    ${cards.length > 1 ? `
      <div class="panel" style="margin-top:12px">
        <div class="region-head"><h2 class="small">Earlier interviews</h2>
          <span class="count mono">${cards.length - 1}</span></div>
        ${cards.slice(1).map((k) => `
          <div class="req">
            <span class="title">${esc(String(k.round).toUpperCase())} · ${onDate(k.submitted_at)}</span>
            <span class="meta small">run by ${esc(k.interviewer || "somebody since removed")}${
              k.client_context ? ` · for ${esc(k.client_context)}` : ""}</span>
            <span class="figures"><span class="figure">${k.pct}</span
              ><span class="figure-unit">%</span></span>
            <span class="actions"><button class="btn-quiet btn-small"
              data-ask-open="${esc(k.id)}">Read it</button></span>
          </div>`).join("")}
      </div>` : ""}

    ${gaps.length ? `
      <div class="notice" style="margin-top:14px">
        <span class="label">Where the interview and the questionnaire disagree</span>
        Both measure some of the same traits, by completely different means. Agreement
        is reassurance; a large gap means one of them is wrong, and it is worth knowing
        which. Nothing here changes either number.
      </div>
      <div class="panel">
        <ul class="evidence">
          ${gaps.map((g) => `
            <li><span class="glyph mono">${g.flagged ? "!" : "="}</span><span>
              <strong>${esc(g.attribute)}</strong> — ASK <strong>${g.ask_pct}%</strong>
              (${g.ask_score}/${g.ask_max}) vs ${esc(g.dimension)}
              <strong>${g.questionnaire}</strong>. ${g.gap} points apart${
                g.flagged ? " — <strong>worth asking about</strong>" : ""}.
              <span class="muted">${esc(g.note || "")}</span>
            </span></li>`).join("")}
        </ul>
        <p class="small muted" style="margin:10px 0 0">
          Called out above ${d.ask_overlap.threshold} points.
          ${esc(d.ask_overlap.threshold_note || "")}
        </p>
      </div>` : `
      <p class="small muted" style="margin-top:10px">No overlap to compare — this
        candidate has no questionnaire scores yet, or the interview covered none of
        the attributes that map onto them.</p>`}
  </div>`;
}

// ═══ HOW THEY ANSWERED, NOT WHAT THEY ANSWERED ═════════════════════════════
// The evidence behind the flags. A chip saying "flat scoring" is an accusation
// unless you can see the number it came from and the number chance would give.
// Shown for everybody, flagged or not, because the interesting reading is often
// the near-miss — and because a measure you can only see when it fires is a
// measure you cannot calibrate.
function patternHtml(d) {
  const p = d.pattern, pos = d.position;
  if (!p || !p.answers) return "";
  const pct = (x) => x == null ? "—" : `${Math.round(x * 100)}%`;
  const sc = p.scoring || {}, sp = p.speed || {}, rh = p.rhythm || {};

  return `
  <div class="region">
    <div class="region-head"><h2>How they answered</h2>
      <span class="count mono">${p.answers}</span></div>
    <div class="notice"><span class="label">Not a score, and not a verdict</span>
      Nothing here changes a number or excludes anybody. It is the shape of the
      response trail: whether the answers look like someone reading the questions.
      Each line shows what they did next to what chance alone would produce.</div>
    <div class="panel">
      <ul class="evidence">
        <li><span class="glyph mono">≡</span><span>
          <strong>Same screen position</strong> — ${pos && pos.measurable
            ? `chose position ${pos.position} on <strong>${pct(pos.share)}</strong> of
               ${pos.answers} shuffled answers, against <strong>${pct(pos.chance)}</strong>
               by chance. That is ${pos.times_chance}× chance.`
            : `not measurable. ${esc((pos && pos.why) || "")}`}</span></li>

        <li><span class="glyph mono">~</span><span>
          <strong>Repeating rhythm</strong> — their longest repeating cycle of
          positions covers <strong>${rh.covering}</strong> answers${
            rh.cycle ? ` (a cycle of ${rh.cycle})` : ""}.
          A pure guesser reaches 7 on average and 14 at the 99.9th percentile, so
          this is flagged from <strong>${rh.threshold}</strong>.</span></li>

        <li><span class="glyph mono">${sc.share >= 0.85 ? "!" : "="}</span><span>
          <strong>Same-scoring answer</strong> — ${sc.scenario_answers
            ? `picked options worth ${sc.top_score} on <strong>${pct(sc.share)}</strong>
               of ${sc.scenario_answers} scenarios: ${esc(sc.reads_as || "")}.
               ${sc.top_score >= 2 ? `That can mean a strong closer or somebody reading
                 what the test wants — the interview settles it, not this page.` : ""}`
            : "no scenario answers to read."}</span></li>

        <li><span class="glyph mono">${sp.share >= 0.25 ? "!" : "="}</span><span>
          <strong>Time per answer</strong> — <strong>${sp.under_threshold}</strong>
          of ${sp.timed} answers came in under ${sp.seconds} seconds
          (${pct(sp.share)}). Under three seconds is less time than the question
          takes to read.</span></li>
      </ul>
    </div>
  </div>`;
}

// ═══ THE FACTS WE ASK FOR RATHER THAN MEASURE ══════════════════════════════
// §7.5's asked-not-tested fields. Nothing has ever written them, so every hard
// filter in the system has been comparing a client's requirements against an
// empty object — which is why fifteen shortlist rows all claimed the same two
// disqualifications. See sql/29.
//
// These sit apart from the nine scores on purpose. A score is measured and the
// candidate cannot argue with it; a fact is stated, and if it is wrong you
// change it. Keeping them in one panel would blur that line.

const WORK_MODES = ["onsite", "hybrid", "remote"];
const FLUENCY = ["", "basic", "conversational", "fluent", "native"];

function directFieldsHtml(c) {
  const f = c.direct_fields || {};
  const langs = f.languages || {};
  const known = Object.keys(langs).length ? Object.keys(langs) : ["en", "hi"];
  const modes = f.work_mode || [];

  return `
  <div class="region" id="df-region">
    <div class="region-head"><h2>What we asked them</h2>
      <span class="count mono">${Object.keys(f).length}</span></div>
    <div class="notice"><span class="label">Stated, not measured</span>
      These are the facts the hard filters compare against — languages, where they
      can work, money, notice. Nothing here touches a score, and nothing here is
      assessed. Until it is recorded, a filter that needs it cannot run, and the
      shortlist says so rather than guessing.</div>

    <div class="panel">
      <div class="fields">
        ${known.map((l) => `
          <label><span>Fluency in ${esc(l)}</span>
            <select data-df-lang="${esc(l)}">
              ${FLUENCY.map((v) => `<option value="${v}"${
                (langs[l] || "") === v ? " selected" : ""}>${v || "not recorded"}</option>`).join("")}
            </select></label>`).join("")}

        <label><span>Can work</span>
          <span class="opts">${WORK_MODES.map((m) => `
            <label class="opt"><input type="checkbox" data-df-mode="${m}"${
              modes.includes(m) ? " checked" : ""}> ${m}</label>`).join("")}</span></label>

        <label><span>Based in</span>
          <input type="text" data-df="location" value="${esc(f.location || "")}"
                 placeholder="City"></label>
        <label><span>Salary expectation (₹ per year)</span>
          <input type="number" data-df="salary_expectation" value="${f.salary_expectation ?? ""}"
                 placeholder="Annual, not monthly"></label>
        <label><span>Notice period (days)</span>
          <input type="number" data-df="notice_days" value="${f.notice_days ?? ""}"></label>
        <label><span>Years of closing experience</span>
          <input type="number" step="0.5" data-df="years_experience" value="${f.years_experience ?? ""}"></label>
      </div>
      <div class="actions" style="margin-top:14px">
        <button class="btn-primary btn-small" id="df-save">Save and re-rank</button>
        <span class="savestate" id="df-state"></span>
      </div>
    </div>
  </div>`;
}

function bindDirectFields(candidateId) {
  const btn = el("df-save");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    const slot = el("df-state");
    const fields = {};

    const langs = {};
    document.querySelectorAll("[data-df-lang]").forEach((s) => {
      if (s.value) langs[s.dataset.dfLang] = s.value;
    });
    if (Object.keys(langs).length) fields.languages = langs;

    const modes = [...document.querySelectorAll("[data-df-mode]")]
      .filter((c) => c.checked).map((c) => c.dataset.dfMode);
    if (modes.length) fields.work_mode = modes;

    document.querySelectorAll("[data-df]").forEach((i) => {
      const v = i.value.trim();
      if (!v) return;
      fields[i.dataset.df] = i.type === "number" ? Number(v) : v;
    });

    // A monthly figure typed into an annual box is the same mistake a client
    // made on the other side of this comparison, and it silently disqualifies
    // people. Ask rather than assume — but only ask, never correct.
    if (fields.salary_expectation && fields.salary_expectation < 60000 &&
        !confirm(`₹${fields.salary_expectation.toLocaleString("en-IN")} a year is ` +
                 `below a plausible annual salary. Did you mean per month?\n\n` +
                 `OK to save it as typed, Cancel to go back and fix it.`)) return;

    btn.disabled = true;
    slot.textContent = "Saving and re-ranking…"; delete slot.dataset.state;
    try {
      const r = await sbRpc("set_candidate_direct_fields",
        { p_candidate_id: candidateId, p_fields: fields });
      slot.textContent = `Saved — ${r.requirements_rematched} shortlist${
        r.requirements_rematched === 1 ? "" : "s"} recomputed`;
      slot.dataset.state = "saved";
      await openCandidate(candidateId);
    } catch (e) {
      slot.textContent = e.message; slot.dataset.state = "error"; btn.disabled = false;
    }
  });
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

  // ── A candidate with no questionnaire scores is not an empty page ─────────
  // ASK runs at R1 and R2. The questionnaire is the step AFTER. So a candidate
  // being interviewed has no profile — that is not an edge case, it is the
  // normal state of every candidate ASK exists for.
  //
  // This branch used to render one notice and `return`, and everything below it,
  // including the ASK region and its "Run R2 interview" link, never appeared. The
  // feature was reachable only for candidates who had already finished the step
  // that comes after it. See sql/39.
  //
  // What still cannot be shown here is anything score-derived: the nine
  // dimensions, the match against open roles, the response-pattern flags. Those
  // genuinely do not exist yet, and the notice says so. What CAN be shown is the
  // interview and the stated facts — both of which are how a candidate at this
  // stage is actually worked on.
  if (!d.scored) {
    el("cd-body").innerHTML = `
      <div class="notice">
        <span class="label">No questionnaire scores yet</span>${esc(d.reason)}
      </div>
      ${askHtml(d, c)}
      ${directFieldsHtml(c)}`;
    el("cd-disclaimer").textContent = "";
    bindDirectFields(id);
    bindAskDiscard(id);
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
            ${(r.hard_filter_fails || []).length ? ` · <strong>outside the stated filters</strong>:
              ${(r.hard_filter_fails || []).map(esc).join(" · ")}` : ""}
            ${(r.hard_filter_unknown || []).length ? ` · <strong>cannot check</strong>:
              ${(r.hard_filter_unknown || []).map(esc).join(" · ")}` : ""}</span>
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
          ${dim.side ? `<span class="chip">${esc(dim.side.label)}</span>` : ""}
          <span class="spacer"></span>
          <span class="figure">${score}</span>
        </div>
        ${scoreBar(score, targets, dim.kind === "bipolar")}
        ${dim.kind === "bipolar"
          ? `<div class="poles small muted"><span>0 · ${esc(dim.pole_0 || "")}</span>
             <span>${esc(dim.pole_100 || "")} · 100</span></div>
             ${dim.side ? `<p class="small muted" style="margin:6px 0 0">
               <strong>${score} means ${esc(dim.side.label)}.</strong>
               ${esc(dim.side.note)}</p>` : ""}` : ""}
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

  el("cd-body").innerHTML = rolesHtml + askHtml(d, c) + flagsHtml + patternHtml(d) + directFieldsHtml(c) + `
    <div class="region">
      <div class="region-head"><h2>The nine, against what each role asks for</h2>
        <span class="count mono">${(d.dimensions || []).length}</span></div>
      ${dims}
    </div>`;
  el("cd-disclaimer").textContent = d.disclaimer || "";

  el("cd-body").querySelectorAll("[data-cdreq]").forEach((x) =>
    x.addEventListener("click", (e) => { e.preventDefault(); loadRequirement(x.dataset.cdreq); }));
  bindDirectFields(id);
  bindAskDiscard(id);

  view("cand");
}

// ═══ READING A FINISHED INTERVIEW BACK ═════════════════════════════════════
//
// get_ask_scorecard() has existed since the first ASK migration and nothing has
// ever called it, so a submitted interview could be totalled but not read. The
// totals say how it went; this says what was actually said, which is the thing a
// second person needs in order to disagree with a colleague's judgement.
//
// Every answer shows the wording it was SCORED AGAINST, from the snapshot on the
// row — never re-joined to the live bank. A question reworded in May must not
// silently change what a March scorecard appears to have asked.
let ASK_BACK_TO = null;

async function loadScorecard(cardId, candidateId) {
  ASK_BACK_TO = candidateId || null;
  view("loading");
  let d;
  try { d = await sbRpc("get_ask_scorecard", { p_scorecard: cardId }); }
  catch (e) {
    el("sc-name").textContent = "Could not load this scorecard";
    el("sc-meta").textContent = e.message;
    el("sc-body").innerHTML = ""; el("sc-disclaimer").textContent = "";
    return view("ask");
  }

  const answers = d.answers || [];
  const attrs = d.attributes || [];
  const byAttr = {};
  answers.forEach((a) => (byAttr[a.attribute] ||= []).push(a));

  el("sc-name").textContent = `${d.candidate} — ASK ${String(d.round).toUpperCase()}`;
  el("sc-meta").textContent = [
    d.submitted_at ? `submitted ${onDate(d.submitted_at)}` : "not submitted yet",
    d.interviewer ? `run by ${d.interviewer}` : "interviewer since removed",
    d.conducted_on ? onDate(d.conducted_on) : null,
    d.client_context ? `for ${d.client_context}` : null,
    d.pct != null ? `${d.total} of ${d.max_total} · ${d.pct}%` : null,
  ].filter(Boolean).join(" · ");

  // One block per attribute, in the bank's own order, so a reader moving down the
  // page moves through the interview in the order it was conducted.
  const blocks = attrs.map((a) => {
    const rows = byAttr[a.id] || [];
    if (!rows.length) return "";
    return `
      <div class="panel" style="margin-bottom:14px">
        <div class="cand-head">
          <span class="cand-name">${esc(a.name)}</span>
          ${a.priority ? `<span class="chip">priority</span>` : ""}
          <span class="chip">${esc(ASK_SECTIONS[a.section] || a.section || "")}</span>
          <span class="spacer"></span>
          <span><span class="figure">${a.score}</span
            ><span class="figure-unit">/${a.max}</span></span>
        </div>
        <ul class="evidence" style="margin-top:10px">
          ${rows.map((r) => `
            <li>
              <span class="glyph mono">${r.score}</span>
              <span>
                ${esc(r.question)}
                ${r.is_reference ? ` <span class="chip">reference call</span>` : ""}
                ${r.carried ? ` <span class="chip">from ${esc(r.carried_round || "R1")}${
                  r.carried_by ? ` · ${esc(r.carried_by)}` : ""}</span>` : ""}
                <br><strong>${esc(r.chose)}</strong>
                ${r.note ? `<br><em class="muted">${esc(r.note)}</em>` : ""}
              </span>
            </li>`).join("")}
        </ul>
      </div>`;
  }).join("");

  const unanswered = attrs.reduce((n, a) => n + (a.unscored || 0), 0);

  el("sc-body").innerHTML = `
    ${d.outstanding_refs ? `
      <div class="notice">
        <span class="label">${d.outstanding_refs} reference question${d.outstanding_refs > 1 ? "s" : ""} not asked yet</span>
        Those go to their previous manager. They are counted neither for nor against,
        so the ${d.pct}% describes the interview alone.
        <div class="actions" style="margin-top:10px">${askRefLink(d.id, d.outstanding_refs)}</div>
      </div>` : ""}
    <div class="region">
      <div class="region-head"><h2>What was asked, and what was said</h2>
        <span class="count mono">${answers.length}</span></div>
      <p class="muted small" style="margin-bottom:12px">
        Each question shows the score, the anchor the interviewer picked, and any note
        they left. The wording is the wording it was scored against — if a question has
        been reworded since, this still reads as it was asked.
      </p>
      ${blocks || `<div class="empty"><h3>Nothing scored yet</h3>
        <p class="muted">This scorecard was opened but no question has been answered.</p></div>`}
    </div>
    ${unanswered ? `<div class="notice"><span class="label">${unanswered} question${unanswered > 1 ? "s" : ""} unscored</span>
      A blank is not a zero — it is counted in neither the total nor the maximum.</div>` : ""}`;

  el("sc-disclaimer").textContent =
    "ASK is a second, independent reading. It does not enter the match score, and " +
    "nothing here excludes anybody.";

  el("sc-body").querySelectorAll("[data-ask-ref]").forEach(() => {});
  view("ask");
}

el("btn-back-cand").addEventListener("click", () => {
  if (ASK_BACK_TO) return openCandidate(ASK_BACK_TO);
  return loadQueue();
});

// Throwing away an empty re-run. The server refuses if anything was scored on it
// and says how much, so the button does not need to know — and the confirm still
// asks, because "discard" next to an interview is a word worth pausing on.
function bindAskDiscard(id) {
  el("cd-body").querySelectorAll("[data-ask-open]").forEach((b) =>
    b.addEventListener("click", () => loadScorecard(b.dataset.askOpen, id)));

  el("cd-body").querySelectorAll("[data-ask-discard]").forEach((b) =>
    b.addEventListener("click", async () => {
      const card = b.dataset.askDiscard;
      const slot = el("cd-body").querySelector(`[data-askslot="${card}"]`);
      if (!confirm("Discard this unfinished interview?\n\nOnly one that nothing was " +
                   "scored on can be discarded — if anything was recorded the server " +
                   "will refuse and say so.")) return;
      b.disabled = true;
      if (slot) { slot.textContent = "Discarding…"; delete slot.dataset.state; }
      try {
        await sbRpc("discard_ask", { p_scorecard: card });
        await openCandidate(id);
      } catch (e) {
        if (slot) { slot.textContent = e.message; slot.dataset.state = "error"; }
        b.disabled = false;
      }
    }));
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
