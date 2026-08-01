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
    el("see-agree").addEventListener("click", (e) => { e.preventDefault(); showAgreement(agree); });
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

function showAgreement(rows) {
  el("agree-body").innerHTML = rows.map((a) => `
    <div class="cand" style="grid-template-columns:1fr">
      <div>
        <div class="cand-head">
          <span class="cand-name mono">${esc(a.item_id)}</span>
          <span class="chip">${esc(a.dimension_code)}</span>
          <span class="chip ${a.verdict.startsWith("unanimous, matches") ? "" : "warn"}">
            ${esc(a.verdict.split(" —")[0])}</span>
          <span class="spacer"></span>
          <span class="small muted">${a.n_experts} expert${a.n_experts === 1 ? "" : "s"} · chose ${esc(a.chosen)}</span>
        </div>
        ${a.verdict.startsWith("split")
          ? `<p class="small" style="margin:8px 0 0">Rewrite this one before launch — the experts did not converge.</p>`
          : a.verdict.includes("DISAGREES")
          ? `<p class="small" style="margin:8px 0 0">Unanimous on <strong>${esc(a.chosen)}</strong>,
             but the bank currently keys <strong>${esc(a.current_key)}</strong>. Re-key it.</p>` : ""}
      </div>
    </div>`).join("");
  view("agree");
}

// ═══ INVITED KEYER ═════════════════════════════════════════════════════════
// No account, no table access: everything on this path goes through the three
// token RPCs. The screen names whose link it is before anything else, because
// one link is one keyer and a shared link would overwrite somebody's work.

async function bootToken() {
  try {
    const d = await api.get();
    S.items = d.items;
    el("tk-name").textContent = d.expert_name || "this keyer";
    el("tk-round").textContent = d.round;
    el("tk-count").textContent = d.items.length;
    const done = d.items.filter((x) => x.mine).length;
    if (!d.round_open) {
      el("tk-error").hidden = false;
      el("tk-error").innerHTML =
        `<span class="label">This round is closed</span>You keyed ${done} of ` +
        `${d.items.length} items and all of it was saved. Nothing more is needed.`;
      el("btn-begin").disabled = true;
    } else if (done) {
      el("btn-begin").textContent = `Continue — ${done} of ${d.items.length} keyed`;
    }
    view("token");
  } catch (e) {
    // The RPC raises a sentence a person can act on; show it as-is.
    el("tk-error").hidden = false;
    el("tk-error").innerHTML = `<span class="label">This link does not work</span>${esc(e.message)}`;
    el("btn-begin").disabled = true;
    el("tk-name").textContent = "—";
    view("token");
  }
}

function finishedByToken() {
  const done = S.items.filter((x) => x.mine).length;
  el("tk-error").hidden = false;
  el("tk-error").className = "notice";
  el("tk-error").innerHTML =
    `<span class="label">All saved</span>You have keyed ${done} of ${S.items.length} items. ` +
    (done < S.items.length
      ? `Open the same link any time to finish the rest.`
      : `That is everything — thank you. You can close the tab.`);
  el("btn-begin").textContent = "Go back over them";
  el("btn-begin").disabled = false;
  view("token");
}

const begin = el("btn-begin");
if (begin) begin.addEventListener("click", () => {
  S.i = Math.max(0, S.items.findIndex((it) => !it.mine));
  if (S.i < 0) S.i = 0;
  render();
});

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
