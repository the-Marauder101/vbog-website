// js/keying.js — §13 blind re-keying.
//
// The one thing this file must never do is show the existing key. It cannot:
// get_keying_items() does not project score_key, so the data is not here to
// leak. That is deliberate — a UI that merely hides the key would be one bug
// away from destroying the only pre-launch validation available.

const el = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const S = { round: null, items: [], i: 0 };

function view(n) {
  ["gate", "pick", "key", "agree", "loading"].forEach((v) => {
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
       then have each expert sign in and key the same round.</p></div>`;

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
  view("pick");
}

el("btn-new-round").addEventListener("click", async () => {
  const label = el("new-round").value.trim();
  if (!label) return;
  try { await sbRpc("create_keying_round", { p_label: label }); el("new-round").value = ""; await loadRounds(); }
  catch (e) { setSave(e.message, "error"); }
});

async function openRound(id) {
  const data = await sbRpc("get_keying_items", { p_round: id });
  S.round = id;
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
    await sbRpc("save_keying", {
      p_round: S.round, p_item: S.items[S.i].id, p_best: best.value,
      p_worst: worst ? worst.value : null, p_note: el("note").value || null,
    });
    S.items[S.i].mine = { best: best.value, worst: worst ? worst.value : null, note: el("note").value };
    setSave("Saved", "saved");
  } catch (e) { setSave(e.message, "error"); }
}

el("btn-clear").addEventListener("click", async () => {
  // Undo one answer without disturbing the rest of the round.
  try {
    await sbRpc("clear_keying", { p_round: S.round, p_item: S.items[S.i].id });
    S.items[S.i].mine = null;
    setSave("Cleared", "saved");
    render();
  } catch (e) { setSave(e.message, "error"); }
});

el("btn-prev").addEventListener("click", () => { if (S.i > 0) { S.i--; render(); } });
el("btn-next").addEventListener("click", async () => {
  await save();
  if (S.i < S.items.length - 1) { S.i++; render(); } else loadRounds();
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

// ═══ BOOT ══════════════════════════════════════════════════════════════════
(async () => {
  if (!sbRestoreToken()) return view("gate");
  try { await loadRounds(); } catch (e) { view("gate"); }
})();
