// js/keying.js — §13 blind re-keying, for staff and for invited keyers.
//
// The one thing this file must never do is show the existing key. It cannot:
// neither get_keying_items() nor get_keying_by_token() projects score_key, so
// the data is not here to leak. That is deliberate — a UI that merely hides the
// key would be one bug away from destroying the only pre-launch validation
// available.
//
// TWO CALLERS, ONE ITEM FLOW. A signed-in expert and an invited one answer the
// same 28 items in the same widget; only the three RPCs underneath differ. That
// pairing lives in one object, `api`, bound once at boot — so the item flow has
// no idea which door the person came through and cannot drift between them.

const el = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const TOKEN = new URLSearchParams(location.search).get("t");
const S = { round: null, items: [], i: 0 };

const api = TOKEN ? {
  get:   ()          => sbRpc("get_keying_by_token", { p_token: TOKEN }),
  save:  (item, b, w, n) => sbRpc("save_keying_by_token",
                              { p_token: TOKEN, p_item: item, p_best: b, p_worst: w, p_note: n }),
  clear: (item)      => sbRpc("clear_keying_by_token", { p_token: TOKEN, p_item: item }),
} : {
  get:   ()          => sbRpc("get_keying_items", { p_round: S.round }),
  save:  (item, b, w, n) => sbRpc("save_keying",
                              { p_round: S.round, p_item: item, p_best: b, p_worst: w, p_note: n }),
  clear: (item)      => sbRpc("clear_keying", { p_round: S.round, p_item: item }),
};

function view(n) {
  ["gate", "token", "pick", "key", "agree", "loading"].forEach((v) => {
    const x = el("v-" + v); x.hidden = true; x.classList.remove("enter");
  });
  const t = el("v-" + n); t.hidden = false; void t.offsetWidth; t.classList.add("enter");
  window.scrollTo(0, 0);
}
function setSave(t, st) {
  const s = el("savestate"); s.textContent = t;
  if (st) s.dataset.state = st; else delete s.dataset.state;
}

// ═══ ROUNDS ════════════════════════════════════════════════════════════════

async function loadRounds() {
  const rounds = await sbFetch("keying_rounds?order=created_at.desc");
  const agree = await sbFetch("v_keying_agreement?order=item_id.asc").catch(() => []);

  el("rounds").innerHTML = rounds.length
    ? rounds.map((r) => `
      <div class="req">
        <span class="title"><a href="#" data-round="${esc(r.id)}">${esc(r.label)}</a></span>
        <span class="meta small">${r.open ? "open" : "closed"} · bank ${esc(r.bank_version)}</span>
        <span class="figures"><span class="mono muted">${r.open ? "key it →" : "closed"}</span></span>
        <div class="actions" style="grid-column:1/-1;margin-top:10px">
          <button class="btn-quiet btn-small" data-rn="${esc(r.id)}" data-label="${esc(r.label)}">Rename</button>
          <button class="btn-quiet btn-small" data-toggle="${esc(r.id)}" data-open="${r.open}">
            ${r.open ? "Close round" : "Reopen"}</button>
          <button class="btn-quiet btn-small" data-rdel="${esc(r.id)}" data-label="${esc(r.label)}">Delete</button>
          <span class="savestate" data-kslot="${esc(r.id)}"></span>
        </div>
      </div>`).join("")
    : `<div class="empty"><h3>No rounds yet</h3><p class="muted">Create one below,
       then send each expert a link to the same round.</p></div>`;

  el("rounds").querySelectorAll("[data-round]").forEach((a) =>
    a.addEventListener("click", (e) => { e.preventDefault(); openRound(a.dataset.round); }));

  const kslot = (id) => document.querySelector(`[data-kslot="${id}"]`);
  const kfail = (id, m) => { kslot(id).textContent = m; kslot(id).dataset.state = "error"; };

  el("rounds").querySelectorAll("[data-rn]").forEach((b) =>
    b.addEventListener("click", async () => {
      const next = prompt("Rename this round:", b.dataset.label);
      if (next === null || !next.trim()) return;
      try { await sbRpc("rename_keying_round", { p_id: b.dataset.rn, p_label: next.trim() }); await loadRounds(); }
      catch (e) { kfail(b.dataset.rn, e.message); }
    }));

  // Closing a round stops further keying without losing what was submitted —
  // which is what you want once the three experts are done.
  el("rounds").querySelectorAll("[data-toggle]").forEach((b) =>
    b.addEventListener("click", async () => {
      const open = b.dataset.open !== "true";
      try { await sbRpc("set_keying_round_open", { p_id: b.dataset.toggle, p_open: open }); await loadRounds(); }
      catch (e) { kfail(b.dataset.toggle, e.message); }
    }));

  el("rounds").querySelectorAll("[data-rdel]").forEach((b) =>
    b.addEventListener("click", async () => {
      if (!confirm(`Delete the round "${b.dataset.label}"?\n\n` +
        `Every expert's submitted keys for this round go with it, and the agreement ` +
        `report loses them. The item bank itself is untouched.`)) return;
      try {
        const r = await sbRpc("delete_keying_round", { p_id: b.dataset.rdel });
        await loadRounds();
        if (r) console.info(`Deleted ${r.deleted}: ${r.submissions} submissions from ${r.experts} expert(s)`);
      } catch (e) { kfail(b.dataset.rdel, e.message); }
    }));

  if (agree.length) {
    const split = agree.filter((a) => a.verdict.startsWith("split")).length;
    const disagree = agree.filter((a) => a.verdict.includes("DISAGREES")).length;
    el("rounds").insertAdjacentHTML("afterend", `
      <div class="callout plain" style="margin-top:14px">
        <span class="label">Agreement so far</span>
        ${agree.length} item${agree.length === 1 ? "" : "s"} keyed by at least one expert ·
        ${split} split · ${disagree} unanimous but disagreeing with the current key.
        <a href="#" id="see-agree">See the breakdown</a>
      </div>`);
    el("see-agree").addEventListener("click", (e) => { e.preventDefault(); showAgreement(); });
  }
  await loadKeyerLinks(rounds);
  view("pick");
}

// ═══ KEYER LINKS (admin) ═══════════════════════════════════════════════════
// §13 stalls when one of the three experts never finishes, and that is invisible
// unless it is on screen. So the list shows progress per keyer, not just who was
// invited.

const KL_ORIGIN = location.origin + location.pathname.replace(/[^/]*$/, "");

async function loadKeyerLinks(rounds) {
  const sel = el("kl-round");
  if (sel) {
    sel.innerHTML = rounds.map((r) =>
      `<option value="${esc(r.id)}">${esc(r.label)}${r.open ? "" : " (closed)"}</option>`).join("")
      || `<option value="">No rounds yet</option>`;
  }

  const links = await sbFetch("v_keying_links?order=issued_at.desc").catch(() => []);
  el("kl-count").textContent = `${links.length}`;
  el("kl-region").hidden = links.length === 0;
  if (!links.length) return;

  el("kl-list").innerHTML = links.map((k) => {
    const url = `${KL_ORIGIN}keying.html?t=${k.token}`;
    const state = k.revoked ? "withdrawn" : k.expired ? "expired"
                : k.keyed >= k.total ? "finished" : k.last_seen_at ? "in progress" : "not opened";
    return `
    <div class="cand" style="grid-template-columns:1fr">
      <div>
        <div class="cand-head">
          <span class="cand-name">${esc(k.full_name || k.email)}</span>
          <span class="chip ${k.revoked || k.expired ? "warn" : k.keyed >= k.total ? "strong" : ""}">${state}</span>
          <span class="spacer"></span>
          <span class="mono muted">${k.keyed} / ${k.total} keyed</span>
        </div>
        <p class="small muted" style="margin:6px 0 0">${esc(k.email)} · round ${esc(k.round_label)}
           · expires ${new Date(k.expires_at).toLocaleDateString("en-IN", { day:"numeric", month:"short", year:"numeric" })}</p>
        ${k.revoked || k.expired ? "" : `
        <input type="text" readonly value="${esc(url)}" onclick="this.select()" style="margin-top:8px">`}
        <div class="actions" style="margin-top:10px">
          ${k.revoked ? "" : `<button class="btn-quiet btn-small" data-klrev="${esc(k.token)}"
            data-name="${esc(k.full_name || k.email)}">Withdraw link</button>`}
          <span class="savestate" data-klslot="${esc(k.token)}"></span>
        </div>
      </div>
    </div>`;
  }).join("");

  el("kl-list").querySelectorAll("[data-klrev]").forEach((b) =>
    b.addEventListener("click", async () => {
      if (!confirm(`Withdraw ${b.dataset.name}'s link?\n\n` +
        `The link stops working immediately. Everything they already keyed stays ` +
        `in the agreement report — nothing is lost. Issue a new link to let them ` +
        `carry on.`)) return;
      const slot = document.querySelector(`[data-klslot="${b.dataset.klrev}"]`);
      try { await sbRpc("revoke_keying_link", { p_token: b.dataset.klrev }); await loadRounds(); }
      catch (e) { slot.textContent = e.message; slot.dataset.state = "error"; }
    }));
}

const btnKl = el("btn-kl");
if (btnKl) btnKl.addEventListener("click", async () => {
  const round = el("kl-round").value, name = el("kl-name").value.trim(),
        email = el("kl-email").value.trim();
  const st = el("kl-state");
  if (!round) { st.textContent = "Create a round first"; st.dataset.state = "error"; return; }
  st.textContent = "Creating…"; delete st.dataset.state;
  btnKl.disabled = true;
  try {
    const r = await sbRpc("create_keying_link",
      { p_round: round, p_name: name, p_email: email, p_valid_days: 21 });
    const url = `${KL_ORIGIN}keying.html?t=${r.token}`;
    el("kl-out").innerHTML = `
      <div class="callout" style="margin-top:12px">
        <span class="label">Send this to ${esc(r.name)}</span>
        <input type="text" readonly value="${esc(url)}" onclick="this.select()">
        <p class="small muted" style="margin:8px 0 0">Good for 21 days. It opens straight
           into the items — no account, no password, and it shows their name so a
           forwarded link cannot quietly overwrite somebody else's keys.</p>
      </div>`;
    el("kl-name").value = ""; el("kl-email").value = "";
    // The list is refreshed BEFORE reporting success, so "Link created" is never
    // on screen next to a list that does not yet contain the link.
    await loadRounds();
    st.textContent = "Link created"; st.dataset.state = "saved";
  } catch (e) { st.textContent = e.message; st.dataset.state = "error"; }
  finally { btnKl.disabled = false; }
});

el("btn-new-round").addEventListener("click", async () => {
  const label = el("new-round").value.trim();
  if (!label) return;
  try { await sbRpc("create_keying_round", { p_label: label }); el("new-round").value = ""; await loadRounds(); }
  catch (e) { setSave(e.message, "error"); }
});

async function openRound(id) {
  S.round = id;
  const data = await api.get();
  S.items = data.items;
  S.i = Math.max(0, S.items.findIndex((it) => !it.mine));
  if (S.i < 0) S.i = 0;
  render();
}

// ═══ ONE ITEM ══════════════════════════════════════════════════════════════

function render() {
  const it = S.items[S.i];
  el("steps").innerHTML = S.items.map((x, i) =>
    `<span class="${x.mine ? "done" : i === S.i ? "now" : ""}"></span>`).join("");
  el("counter").textContent =
    `Item ${S.i + 1} of ${S.items.length} · ${S.items.filter((x) => x.mine).length} keyed`;

  if (it.framing_note) { el("framing").hidden = false; el("framing-text").textContent = it.framing_note; }
  else el("framing").hidden = true;
  el("stem").textContent = it.stem;

  const opts = (group) => it.options.map((o) => `
    <label class="opt"><input type="radio" name="${group}" value="${esc(o.key)}"
      ${it.mine && it.mine[group === "best" ? "best" : "worst"] === o.key ? "checked" : ""}>
      <span class="t">${esc(o.text)}</span></label>`).join("");
  el("best").innerHTML = opts("best");
  el("worst").innerHTML = opts("worst");
  el("note").value = (it.mine && it.mine.note) || "";

  el("best").querySelectorAll("input").forEach((i) => i.addEventListener("change", save));
  el("worst").querySelectorAll("input").forEach((i) => i.addEventListener("change", save));
  el("note").addEventListener("change", save);

  const clear = el("btn-clear");
  if (clear) clear.disabled = !it.mine;
  el("btn-prev").disabled = S.i === 0;
  el("btn-next").disabled = !document.querySelector('input[name="best"]:checked');
  el("btn-next").textContent = S.i === S.items.length - 1 ? "Finish" : "Next";
  view("key");
}

async function save() {
  const best = document.querySelector('input[name="best"]:checked');
  if (!best) return;
  el("btn-next").disabled = false;
  const worst = document.querySelector('input[name="worst"]:checked');
  setSave("Saving…");
  try {
    await api.save(S.items[S.i].id, best.value,
                   worst ? worst.value : null, el("note").value || null);
    S.items[S.i].mine = { best: best.value, worst: worst ? worst.value : null, note: el("note").value };
    setSave("Saved", "saved");
  } catch (e) { setSave(e.message, "error"); }
}

el("btn-clear").addEventListener("click", async () => {
  // Undo one answer without disturbing the rest of the round.
  try {
    await api.clear(S.items[S.i].id);
    S.items[S.i].mine = null;
    setSave("Cleared", "saved");
    render();
  } catch (e) { setSave(e.message, "error"); }
});

el("btn-prev").addEventListener("click", () => { if (S.i > 0) { S.i--; render(); } });
el("btn-next").addEventListener("click", async () => {
  await save();
  if (S.i < S.items.length - 1) { S.i++; render(); }
  else if (TOKEN) finishedByToken();
  else loadRounds();
});

// ═══ AGREEMENT ═════════════════════════════════════════════════════════════
// What the experts actually chose, item by item, against what the bank scores —
// and the button that does something about it.
//
// Until now the keys went nowhere. Submissions were recorded, a count was
// reported, and no code path anywhere wrote item_options.score_key. Three
// experts could agree an item was keyed wrong and the bank would keep the wrong
// key forever. §13 exists to turn one person's opinion into a finding; a finding
// that cannot be applied is a survey.

const KEYSCORE = { "2": "best", "1": "good", "0": "weak", "-1": "worst" };

// Four verdicts, not three. A 2-of-3 majority and a 3-way split used to be the
// same category — "split" — and they call for opposite actions: one is a
// judgement call an admin can override, the other says the item is broken.
const VERDICT = {
  unanimous_agrees:    { label: "agrees with the bank", tone: "strong" },
  unanimous_disagrees: { label: "all agree the bank is wrong", tone: "warn" },
  majority:            { label: "majority, not unanimous", tone: "warn" },
  split:               { label: "split — rewrite it", tone: "warn" },
};

const DECISION = {
  rekeyed:         "re-keyed",
  kept:            "kept as-is",
  rewrite_pending: "marked for rewrite",
  rewritten:       "rewritten",
  deferred:        "deferred",
};

function verdictOf(it) {
  if (!it.n_experts) return { label: "not keyed yet", tone: "" };
  return VERDICT[it.conflict] || { label: "keyed", tone: "" };
}

// One card, two postures. Unanimous-and-wrong gets a re-key button, because §13
// produced a finding and a finding you cannot apply is a survey. Everything else
// gets the same evidence and no button — only a recorded decision — because the
// point of a disagreement is that the system should not resolve it for you.
function conflictCard(i, actionable) {
  const target = i.top_choice;
  const cur = (i.options || []).find((o) => o.key === i.current_best) || {};
  const nxt = (i.options || []).find((o) => o.key === target) || {};
  const tally = (i.picks || []).reduce((m, p) => (m[p.best] = (m[p.best] || 0) + 1, m), {});
  const spread = Object.keys(tally).sort()
    .map((k) => `${tally[k]}× ${k}`).join(" · ");
  const v = verdictOf(i);

  return `
  <div class="cand" style="grid-template-columns:1fr">
    <div>
      <div class="cand-head">
        <span class="cand-name mono">${esc(i.item_id)}</span>
        <span class="chip">${esc(i.dimension)}</span>
        <span class="chip ${v.tone}">${esc(v.label)}</span>
        <span class="spacer"></span>
        <span class="small muted">${esc(spread)}</span>
      </div>
      <p class="small" style="margin:10px 0 0">${esc(i.stem)}</p>
      <ul class="evidence" style="margin-top:10px">
        <li><span class="glyph mono">−</span><span><strong>Bank keys ${esc(i.current_best)}</strong>
          — ${esc(cur.text || "")}</span></li>
        <li><span class="glyph mono">+</span><span><strong>${
          actionable ? "Experts chose" : "Most chose"} ${esc(target)}</strong>
          — ${esc(nxt.text || "")}</span></li>
      </ul>
      ${(i.picks || []).filter((p) => p.note).map((p) => `
        <div class="callout plain" style="margin-top:10px">
          <span class="label">${esc(p.expert)} wrote</span>${esc(p.note)}</div>`).join("")}
      ${i.decision ? `<p class="small muted" style="margin-top:10px">Decision on record:
        <strong>${esc(DECISION[i.decision] || i.decision)}</strong>${
          i.decided_by ? ` by ${esc(i.decided_by)}` : ""}${
          i.rationale ? ` — “${esc(i.rationale)}”` : ""}.</p>` : ""}
      <div class="actions" style="margin-top:12px">
        <button class="btn-quiet btn-small" data-preview="${esc(i.item_id)}"
          data-best="${esc(target)}">See what this would change</button>
        ${actionable
          ? `<button class="btn-primary btn-small" data-apply="${esc(i.item_id)}"
               data-best="${esc(target)}" data-old="${esc(i.current_best)}"
               >Re-key to ${esc(target)}</button>
             <button class="btn-quiet btn-small" data-decide="${esc(i.item_id)}"
               data-decision="kept">Keep the bank as it is</button>`
          : `<button class="btn-quiet btn-small" data-decide="${esc(i.item_id)}"
               data-decision="rewrite_pending">Mark for rewrite</button>
             <button class="btn-quiet btn-small" data-decide="${esc(i.item_id)}"
               data-decision="deferred">Defer</button>
             <button class="btn-quiet btn-small" data-apply="${esc(i.item_id)}"
               data-best="${esc(target)}" data-old="${esc(i.current_best)}"
               data-override="1">Override and re-key to ${esc(target)}</button>`}
        <span class="savestate" data-aslot="${esc(i.item_id)}"></span>
      </div>
      <div class="small" data-pslot="${esc(i.item_id)}" style="margin-top:10px"></div>
    </div>
  </div>`;
}

async function showAgreement() {
  view("loading");
  const d = await sbRpc("get_keying_report");
  const items = d.items || [];
  const keyed = items.filter((i) => i.n_experts > 0);
  const of = (c) => keyed.filter((i) => i.conflict === c);
  const agree = of("unanimous_agrees");
  const wrong = of("unanimous_disagrees").filter((i) => i.decision !== "kept");
  const dispute = of("majority").concat(of("split"));

  el("agree-summary").innerHTML =
    `<span class="label">Where the bank stands</span>
     <strong>${agree.length}</strong> item${agree.length === 1 ? "" : "s"} the experts and the
     bank agree on · <strong>${of("unanimous_disagrees").length}</strong> the experts unanimously
     say are keyed wrong · <strong>${of("majority").length}</strong> where most but not all
     agree · <strong>${of("split").length}</strong> the experts split evenly on ·
     <strong>${items.length - keyed.length}</strong> not yet keyed by anybody.
     <br><br><span class="label">How a conflict is settled</span>
     Unanimous and the bank disagrees → re-key, one click, undoable. Most but not all →
     no automatic action; an admin may override, and has to write down why. Split evenly →
     the item is ambiguous, so §13 asks for a <strong>rewrite</strong>, not a re-score.
     ${d.fingerprint ? `<br><br><span class="label">Key set in force</span>
       <span class="mono">${esc(d.fingerprint)}</span> — every profile carries this, so two
       candidates measured either side of a re-key can be told apart.` : ""}`;

  // The actionable list.
  el("pending-region").hidden = wrong.length === 0;
  el("pending-count").textContent = `${wrong.length}`;
  el("pending-list").innerHTML = wrong.map((i) => conflictCard(i, true)).join("");

  el("dispute-region").hidden = dispute.length === 0;
  el("dispute-count").textContent = `${dispute.length}`;
  el("dispute-list").innerHTML = dispute.map((i) => conflictCard(i, false)).join("");

  // Everything, so the whole picture is inspectable rather than just the deltas.
  el("agree-count").textContent = `${items.length}`;
  el("agree-body").innerHTML = items.map((i) => {
    const v = verdictOf(i);
    return `
    <div class="cand" style="grid-template-columns:1fr">
      <div>
        <div class="cand-head">
          <span class="cand-name mono">${esc(i.item_id)}</span>
          <span class="chip">${esc(i.dimension)}</span>
          <span class="chip ${v.tone}">${esc(v.label)}</span>
          <span class="spacer"></span>
          <span class="small muted">${i.n_experts} expert${i.n_experts === 1 ? "" : "s"}</span>
        </div>
        <p class="small" style="margin:10px 0 0">${esc(i.stem)}</p>
        <ul class="evidence" style="margin-top:10px">
          ${(i.options || []).map((o) => `
            <li><span class="glyph mono">${o.score}</span><span>
              <strong>${esc(o.key)}</strong> ${esc(o.text)}
              <span class="muted">— bank scores this ${esc(KEYSCORE[String(o.score)] || o.score)}</span>
              ${(i.picks || []).some((pk) => pk.best === o.key)
                ? ` · <strong>chosen best by ${
                    (i.picks || []).filter((pk) => pk.best === o.key)
                      .map((pk) => esc(pk.expert)).join(", ")}</strong>` : ""}
              ${(i.picks || []).some((pk) => pk.worst === o.key)
                ? ` · marked worst by ${
                    (i.picks || []).filter((pk) => pk.worst === o.key)
                      .map((pk) => esc(pk.expert)).join(", ")}` : ""}
            </span></li>`).join("")}
        </ul>
        ${(i.picks || []).filter((pk) => pk.note).map((pk) => `
          <div class="callout plain" style="margin-top:10px">
            <span class="label">${esc(pk.expert)} wrote</span>${esc(pk.note)}</div>`).join("")}
        ${i.last_change
          ? `<p class="small muted" style="margin-top:10px">Re-keyed from
             <strong>${esc(i.last_change.old_best)}</strong> to
             <strong>${esc(i.last_change.new_best)}</strong> by
             ${esc(i.last_change.by || "an admin")} on
             ${new Date(i.last_change.at).toLocaleDateString("en-IN",
               { day: "numeric", month: "short", year: "numeric" })}.</p>`
          : ""}
      </div>
    </div>`;
  }).join("");

  const cards = [el("pending-list"), el("dispute-list")];
  const q = (sel) => cards.flatMap((c) => Array.from(c.querySelectorAll(sel)));

  // Look before you leap. This runs the whole re-key on the server, measures who
  // moves, and rolls it back — so the answer to "what would this do" comes from
  // doing it, not from reasoning about it.
  q("[data-preview]").forEach((b) =>
    b.addEventListener("click", async () => {
      const item = b.dataset.preview;
      const slot = document.querySelector(`[data-pslot="${item}"]`);
      b.disabled = true;
      slot.innerHTML = `<span class="muted">Working out what would change…</span>`;
      try {
        const r = await sbRpc("preview_rekey", { p_item_id: item, p_new_best: b.dataset.best });
        slot.innerHTML = r.candidates_affected === 0
          ? `<div class="callout plain"><span class="label">Nothing would move</span>
             No candidate's ${esc(r.dimension)} score changes. Either nobody has answered
             this item yet, or the change cancels out. Nothing was written.</div>`
          : `<div class="callout plain"><span class="label">${r.candidates_affected}
               candidate${r.candidates_affected === 1 ? "" : "s"} would move</span>
             <ul class="evidence" style="margin-top:8px">${
               r.moves.map((m) => `<li><span class="glyph mono">${
                 m.to > m.from ? "↑" : "↓"}</span><span>${esc(m.full_name)} — ${esc(m.dimension)}
                 <strong>${m.from} → ${m.to}</strong></span></li>`).join("")}</ul>
             <p class="small muted" style="margin:8px 0 0">Computed and rolled back. The bank
                is untouched.</p></div>`;
      } catch (e) {
        slot.innerHTML = `<span class="savestate" data-state="error">${esc(e.message)}</span>`;
      } finally { b.disabled = false; }
    }));

  // A decision is not a key. It is the record of what you concluded about an item
  // the experts disagreed on, so "disputed" stops meaning both "unexamined" and
  // "examined and left alone".
  q("[data-decide]").forEach((b) =>
    b.addEventListener("click", async () => {
      const item = b.dataset.decide, dec = b.dataset.decision;
      const slot = document.querySelector(`[data-aslot="${item}"]`);
      let why = null;
      if (dec === "kept" || dec === "rewrite_pending") {
        why = prompt(dec === "kept"
          ? `Keeping ${item} as it is means overruling what the experts found. ` +
            `Why? (One sentence — it is kept beside the item permanently.)`
          : `Marking ${item} for rewrite. What is ambiguous about it?`);
        if (why === null) return;
        if (!why.trim()) { slot.textContent = "A reason is required."; slot.dataset.state = "error"; return; }
      }
      b.disabled = true;
      slot.textContent = "Recording…"; delete slot.dataset.state;
      try {
        await sbRpc("record_key_decision",
          { p_item_id: item, p_decision: dec, p_rationale: why });
        await showAgreement();
      } catch (e) { slot.textContent = e.message; slot.dataset.state = "error"; b.disabled = false; }
    }));

  q("[data-apply]").forEach((b) =>
    b.addEventListener("click", async () => {
      const item = b.dataset.apply, slot = document.querySelector(`[data-aslot="${item}"]`);
      if (b.dataset.override && !confirm(
        `The experts did not agree on ${item}. Re-keying anyway is an override, ` +
        `not a finding.\n\nIf the item is ambiguous, the fix is to rewrite it, ` +
        `because every future candidate will meet the same ambiguity.\n\n` +
        `Continue?`)) return;
      if (!confirm(
        `Re-key ${item} so ${b.dataset.best} becomes the best answer, instead of ` +
        `${b.dataset.old}?\n\n` +
        `This edits the item bank. Every candidate profile and every open shortlist ` +
        `will be recomputed straight afterwards, because a score measured under the ` +
        `old key does not mean the same thing under the new one.\n\n` +
        `It is recorded against your name, and it can be undone.`)) return;
      b.disabled = true;
      slot.textContent = "Re-keying and recomputing…"; delete slot.dataset.state;
      try {
        const r = await sbRpc("apply_rekey", { p_item_id: item, p_new_best: b.dataset.best });
        if (r && r.changed === false) { slot.textContent = r.reason; slot.dataset.state = "error"; return; }
        // The change is in key_changes either way; this is the decision beside it,
        // so the item leaves "disputed" rather than sitting there looking untouched.
        await sbRpc("record_key_decision", { p_item_id: item, p_decision: "rekeyed" });
        await showAgreement();
      } catch (e) { slot.textContent = e.message; slot.dataset.state = "error"; b.disabled = false; }
    }));

  await showRekeys();
  view("agree");
}

// ═══ RE-KEYS APPLIED, AND UNDOING ONE ══════════════════════════════════════
// undo_rekey() has existed since sql/24 and nothing called it, while the confirm
// dialog before an apply told the reader "it can be undone". A promise in a
// dialog with no code behind it is worse than no promise: it is the reason
// somebody presses the button.
async function showRekeys() {
  const region = el("rekey-region");
  if (!region) return;
  let rows = [];
  try {
    rows = await sbFetch(
      "key_changes?select=id,item_id,old_best,new_best,applied_at,note,n_experts" +
      "&order=applied_at.desc&limit=25");
  } catch (_) { rows = []; }

  region.hidden = rows.length === 0;
  if (!rows.length) return;
  el("rekey-count").textContent = String(rows.length);

  el("rekey-list").innerHTML = rows.map((r) => `
    <div class="req">
      <span class="title mono">${esc(r.item_id)}</span>
      <span class="meta small">${esc(r.old_best)} → <strong>${esc(r.new_best)}</strong>
        · ${new Date(r.applied_at).toLocaleDateString("en-IN",
             { day: "numeric", month: "short", year: "numeric" })}${
          r.n_experts != null ? ` · ${r.n_experts} expert${r.n_experts === 1 ? "" : "s"} chose it` : ""}
        ${r.note ? ` · ${esc(r.note)}` : ""}</span>
      <span class="actions">
        <button class="btn-quiet btn-small" data-undo="${esc(r.id)}"
          data-item="${esc(r.item_id)}" data-back="${esc(r.old_best)}">Undo</button>
        <span class="savestate" data-undoslot="${esc(r.id)}"></span>
      </span>
    </div>`).join("");

  el("rekey-list").querySelectorAll("[data-undo]").forEach((b) =>
    b.addEventListener("click", async () => {
      const slot = el("rekey-list").querySelector(`[data-undoslot="${b.dataset.undo}"]`);
      if (!confirm(
        `Put ${b.dataset.item} back to ${b.dataset.back} as the best answer?\n\n` +
        `This recomputes every candidate profile and every open shortlist again, ` +
        `the same way the re-key did. The item goes back to being an open question.`)) return;
      b.disabled = true;
      if (slot) { slot.textContent = "Undoing and recomputing…"; delete slot.dataset.state; }
      try {
        await sbRpc("undo_rekey", { p_change_id: b.dataset.undo });
        await showAgreement();
      } catch (e) {
        if (slot) { slot.textContent = e.message; slot.dataset.state = "error"; }
        b.disabled = false;
      }
    }));
}

const backRounds = el("btn-back-rounds");
if (backRounds) backRounds.addEventListener("click", loadRounds);

// ═══ BOOT ══════════════════════════════════════════════════════════════════
(async () => {
  if (TOKEN) {
    // An invited keyer must never be shown a route into the console.
    const nav = el("staff-nav"); if (nav) nav.hidden = true;
    return bootToken();
  }
  if (!sbRestoreToken()) return view("gate");
  try { await loadRounds(); } catch (e) { view("gate"); }
})();
