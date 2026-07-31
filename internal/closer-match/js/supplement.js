// js/supplement.js — §10 client supplement, candidate side.
//
// Free-text answers to client-authored questions. There is no key and no
// scoring here: a human reads these and records Pass / Concern / Fail, because
// they are client-specific and cannot be compared across candidates the way the
// 44 core items can.

const el = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const S = { token: new URLSearchParams(location.search).get("t"), items: [], d: {} };

function show(n) {
  ["loading", "error", "done", "form"].forEach((v) => {
    const x = el("v-" + v); x.hidden = true; x.classList.remove("enter");
  });
  const t = el("v-" + n); t.hidden = false; void t.offsetWidth; t.classList.add("enter");
  window.scrollTo(0, 0);
}
function fail(m) { el("error-text").textContent = m; show("error"); }
function setSave(t, st) {
  const s = el("savestate"); s.textContent = t;
  if (st) s.dataset.state = st; else delete s.dataset.state;
}

function render() {
  el("lede").textContent =
    `${S.items.length} short questions, specific to this role. Written answers — ` +
    `there are no right answers here, we are checking fit for how this client sells.`;
  el("body").innerHTML = S.items.map((it, i) => `
    <div class="field">
      <label for="q-${i}">${esc(it.prompt)}</label>
      ${it.kind === "technical" ? `<span class="help">Answer as specifically as you can.</span>` : ""}
      <textarea id="q-${i}" data-i="${i}">${esc(S.d["q" + i] || "")}</textarea>
    </div>`).join("");

  el("body").querySelectorAll("textarea").forEach((t) =>
    t.addEventListener("change", () => { collect(); save(false); }));
  show("form");
}

function collect() {
  el("body").querySelectorAll("textarea").forEach((t) => { S.d["q" + t.dataset.i] = t.value; });
}

async function save(final) {
  setSave("Saving…");
  try {
    await sbRpc("submit_supplement", { p_token: S.token, p_payload: S.d, p_final: !!final });
    setSave(final ? "Sent" : "Saved", "saved");
    return true;
  } catch (e) { setSave("Not saved", "error"); console.error(e); return false; }
}

el("btn-submit").addEventListener("click", async () => {
  collect();
  const blank = S.items.map((_, i) => i).filter((i) => !(S.d["q" + i] || "").trim());
  if (blank.length) {
    el("form-error").hidden = false;
    el("form-error").innerHTML =
      `<span class="label">${blank.length} question${blank.length === 1 ? "" : "s"} still blank</span>` +
      `A short answer is fine — a blank one tells us nothing.`;
    return;
  }
  const b = el("btn-submit"); b.disabled = true; b.textContent = "Sending…";
  if (await save(true)) show("done");
  else { b.disabled = false; b.textContent = "Send my answers"; }
});

(async () => {
  if (!S.token) return fail("This link is missing its access code.");
  let data;
  try { data = await sbRpc("get_supplement", { p_token: S.token }); }
  catch (e) { return fail(e.message); }
  if (data.submitted) return show("done");
  S.items = data.items || [];
  S.d = data.draft || {};
  render();
})();
