// js/intake.js — client intake.
//
// Six steps, autosaved. Every question is phrased in the client's own terms —
// ticket size, cycle length, what their best rep was like — and the mapping onto
// dimensions happens in Postgres (compute_target_profile), never here. A client
// should never have to think in the vocabulary of the instrument.
//
// The forced-rank control exists because §6.1 is explicit that free text must
// not be the primary input: "nobody has to code prose into dimensions".

const el = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Exposed deliberately: holds only the client's own draft answers, no keys or
// scores, and it is what makes a stuck intake diagnosable in the field.
const S = window.__S = {
  token: new URLSearchParams(location.search).get("t"),
  form: null,
  d: {},          // the payload under construction
  step: 0,
};

function show(name) {
  ["loading", "error", "done", "form"].forEach((v) => {
    const n = el("v-" + v); n.hidden = true; n.classList.remove("enter");
  });
  const t = el("v-" + name); t.hidden = false;
  void t.offsetWidth; t.classList.add("enter");
  window.scrollTo(0, 0);
}
function fail(msg) { el("error-text").textContent = msg; show("error"); }
function setSave(text, state) {
  const s = el("savestate"); s.textContent = text;
  if (state) s.dataset.state = state; else delete s.dataset.state;
}

// ═══ STEPS ═════════════════════════════════════════════════════════════════
// Ordered so the easy factual questions come first and the judgement calls come
// once the client is warmed up. The forced-rank is step 4, not step 1.

const STEPS = [
  {
    title: "The deal",
    lede: "These four numbers do more work than anything else in the brief — they tell us whether this is a fast close or a long, considered sale, and those need different people.",
    body: () => `
      ${field("role_title", "text", "What do you call this role?", "Appears on the brief internally. e.g. Senior Closer, Inside Sales")}
      ${field("ticket_size", "number", "Typical deal value (₹)", "The price of one sale, not a monthly target.")}
      ${field("cycle_days", "number", "Days from first conversation to closed", "Enter 0 if it usually closes on the first call.")}
      ${field("leads_per_day", "number", "Leads a closer works per day", "Roughly. 20+ is high volume; under 3 is account work.")}
      ${field("expected_days_to_first_close", "number", "Days you'd expect a new hire to take to close their first deal",
              "This becomes the yardstick we measure the placement against, so a rough honest number is better than a flattering one.")}`,
  },
  {
    title: "The buyer",
    lede: "Who the closer will actually be talking to.",
    body: () => `
      <div class="field">
        <span class="q">How does your buyer usually respond best?</span>
        <span class="help">There is no better answer here — it decides which style we look for, and a mismatch either way is a bad fit.</span>
        ${radio("buyer_response", [
          [1, "Straight to the point", "Wants the facts, the price and a decision. Small talk is friction."],
          [2, "Mostly businesslike", "A little warmth, then down to business."],
          [3, "Balanced", "Depends on the person."],
          [4, "Wants a rapport first", "Buys from someone they like and trust."],
          [5, "Strongly relationship-led", "Nothing progresses until there is a personal connection."],
        ])}
      </div>
      ${yesno("buyer_is_senior", "Is the buyer usually a business owner or a senior professional?",
              "Selling upward needs someone who can hold their frame with someone older, wealthier or running a bigger company.")}
      ${field("cold_outbound_pct", "number", "What % of the pipeline is cold outbound?",
              "0 if every lead comes in warm; 100 if they start from a list.")}`,
  },
  {
    title: "How the work gets tracked",
    lede: "This tells us how much self-built discipline the role needs.",
    body: () => `
      ${yesno("has_crm", "Do you have a CRM the closer will use?",
              "A spreadsheet the closer maintains themselves counts as no.")}
      ${field("followup_rate_pct", "number", "Of warm leads who don't buy, what % actually get followed up?",
              "An honest guess. Under 40% tells us the role needs someone who builds their own follow-up system.")}
      ${yesno("refund_policy_exists", "Do you offer a written refund or money-back policy?",
              "If yes, we weight honesty about that policy more heavily.")}`,
  },
  {
    title: "What actually matters",
    lede: "Two separate lists. Pick exactly three qualities that most separate someone who succeeds here from someone who doesn't, and optionally up to two that matter least. A quality can go in one list or the other, not both.",
    body: () => `
      <div class="field">
        <span class="q">The three that matter most <span class="tally mono" id="tally-top"></span></span>
        <span class="help">Pick exactly three. Tap one again to remove it. The numbers
          only show what you picked — all three count equally.</span>
        <div class="rank-grid" id="rank-top"></div>
      </div>
      <div class="field">
        <span class="q">Anything that matters least here? <span class="muted">(optional)</span>
          <span class="tally mono" id="tally-bottom"></span></span>
        <span class="help">Up to two, and you can leave this empty. We still measure these
          — we just weight them lower for this role. The three you picked above are greyed
          out here, because a quality cannot matter both most and least.</span>
        <div class="rank-grid" id="rank-bottom"></div>
      </div>`,
    after: renderRanks,
  },
  {
    title: "The offer to the closer",
    lede: "Pay structure predicts whether a good closer stays. A strong performer on the wrong contract leaves in month three, and that looks like a bad match when it was a bad deal.",
    body: () => `
      <div class="field">
        <span class="q">How is this role paid?</span>
        ${(S.form.comp_bands || []).map((b) => `
          <label class="opt"><input type="radio" name="comp_band" data-key="comp_band" value="${b.index}"
            ${String(S.d.comp_band) === String(b.index) ? "checked" : ""}>
            <span class="t">${esc(b.label)}<em>${b.fixed}% fixed / ${b.variable}% variable</em></span></label>`).join("")}
      </div>
      <div class="row">
        ${field("salary_min", "number", "Fixed pay, from (₹/year)", "")}
        ${field("salary_max", "number", "Fixed pay, up to (₹/year)", "")}
      </div>`,
  },
  {
    title: "Non-negotiables",
    lede: "Anything here excludes a candidate before we look at fit — so keep it to what genuinely rules someone out. We show you near-misses separately so you can waive one.",
    body: () => `
      ${field("hf_locations", "text", "Which cities can they be based in?",
              "Comma separated. Leave blank if location doesn't matter.")}
      <div class="field">
        <span class="q">Work mode</span>
        ${radio("hf_work_mode", [["", "Doesn't matter", ""], ["onsite", "On-site", ""],
                                 ["hybrid", "Hybrid", ""], ["remote", "Remote", ""]], true)}
      </div>
      ${field("hf_language", "text", "Which languages must they be fluent in?",
              "e.g. en, hi — each one is checked separately. Leave blank to skip. " +
              "We check spoken fluency live in the interview, not on a form.")}
      ${field("hf_join_by_days", "number", "How many days can you wait for them to join?",
              "Leave blank if flexible. A candidate a fortnight over this still shows up, marked as a near-miss.")}
      ${field("hf_min_years", "number", "Minimum years of closing experience", "Leave blank if none.")}
      <div class="field">
        <span class="q">Anything else we should read? <span class="muted">(optional)</span></span>
        <span class="help">Your best closer and what made them good; the objections you hear most; who has failed here and why. This is for us to read, not for the scoring.</span>
        <textarea id="f-notes" placeholder="Free text">${esc(S.d.notes || "")}</textarea>
      </div>`,
  },
];

// ═══ CONTROL BUILDERS ══════════════════════════════════════════════════════

function field(key, type, label, help) {
  return `<div class="field">
    <label for="f-${key}">${esc(label)}</label>
    ${help ? `<span class="help">${esc(help)}</span>` : ""}
    <input type="${type}" id="f-${key}" data-key="${key}"
           ${type === "number" ? 'inputmode="numeric" min="0"' : ""}
           value="${esc(S.d[key] ?? "")}">
  </div>`;
}

function radio(key, opts, allowBlank) {
  return opts.map(([val, label, help]) => `
    <label class="opt"><input type="radio" name="${key}" data-key="${key}" value="${esc(val)}"
      ${String(S.d[key] ?? (allowBlank ? "" : null)) === String(val) ? "checked" : ""}>
      <span class="t">${esc(label)}${help ? `<em>${esc(help)}</em>` : ""}</span></label>`).join("");
}

function yesno(key, label, help) {
  return `<div class="field">
    <span class="q">${esc(label)}</span>
    ${help ? `<span class="help">${esc(help)}</span>` : ""}
    ${radio(key, [["true", "Yes", ""], ["false", "No", ""]])}
  </div>`;
}

// Forced-rank. Selection ORDER is shown, because "which three" and "in what
// order" are different answers and the engine weights them the same either way —
// but the client's sense of priority is worth capturing and showing back.
function renderRanks() {
  // Built ONCE, then updated in place. The earlier version replaced both grids'
  // innerHTML on every tap, which meant a tap landing mid-rerender hit a detached
  // node and was silently lost — easy to trigger by selecting quickly on a phone.
  // Nothing is recreated now, so a click can never miss its target.
  const build = (host, key) => {
    el(host).innerHTML = (S.form.rankable || []).map((d) => `
      <button type="button" class="rank-item" data-code="${d.code}" data-key="${key}" aria-pressed="false">
        <span class="pos"></span>
        <span><span class="n">${esc(d.name)}</span><br><span class="p">${esc(d.plain)}</span>
          <span class="why"></span></span>
      </button>`).join("");
  };

  // Two caps, two lists, and a quality may sit in only one of them. All three of
  // those facts were true before and none of them were visible, which is why a
  // correct control read as a broken one. Each disabled row now states WHICH
  // reason applies, and each list shows how full it is.
  const LABEL = { top3: "one of the three that matter most", bottom3: "one that matters least" };
  const CAP = { top3: 3, bottom3: 2 };

  const paint = () => {
    [["rank-top", "top3"], ["rank-bottom", "bottom3"]].forEach(([host, key]) => {
      const other = key === "top3" ? "bottom3" : "top3";
      const mine = S.d[key] || [];
      const full = mine.length >= CAP[key];

      el(host).querySelectorAll(".rank-item").forEach((b) => {
        const at = mine.indexOf(b.dataset.code);
        const inOther = (S.d[other] || []).includes(b.dataset.code);
        b.setAttribute("aria-pressed", at >= 0 ? "true" : "false");
        b.querySelector(".pos").textContent = at >= 0 ? at + 1 : "";
        const why = b.querySelector(".why");

        if (at < 0 && inOther) {
          b.disabled = true;
          why.textContent = `Already chosen as ${LABEL[other]}`;
        } else if (at < 0 && full) {
          // Tapping a fourth used to do nothing at all, which looks like a fault.
          b.disabled = true;
          why.textContent = `${CAP[key] === 3 ? "Three" : "Two"} already chosen — remove one to pick this instead`;
        } else {
          b.disabled = false;
          why.textContent = "";
        }
      });

      const tally = el(key === "top3" ? "tally-top" : "tally-bottom");
      if (tally) {
        tally.textContent = `${mine.length} of ${CAP[key]} chosen`;
        if (mine.length === CAP[key]) tally.dataset.state = "done";
        else delete tally.dataset.state;
      }
    });
  };

  ["rank-top", "rank-bottom"].forEach((host, i) => {
    const key = i === 0 ? "top3" : "bottom3";
    build(host, key);
    el(host).addEventListener("click", (e) => {
      const b = e.target.closest(".rank-item");
      if (!b || b.disabled) return;
      const list = S.d[key] || [];
      const at = list.indexOf(b.dataset.code);
      if (at >= 0) list.splice(at, 1);
      else if (list.length < CAP[key]) list.push(b.dataset.code);
      S.d[key] = list;
      paint();
      save();
    });
  });
  paint();
}

// ═══ RENDER / COLLECT ══════════════════════════════════════════════════════

function renderStep() {
  const s = STEPS[S.step];
  el("steps").innerHTML = STEPS.map((_, i) =>
    `<span class="${i < S.step ? "done" : i === S.step ? "now" : ""}"></span>`).join("");
  el("step-of").textContent = `Step ${S.step + 1} of ${STEPS.length}`;
  el("step-title").textContent = s.title;
  el("step-lede").textContent = s.lede;
  el("step-body").innerHTML = s.body();
  el("form-error").hidden = true;
  if (s.after) s.after();

  el("step-body").querySelectorAll("[data-key]").forEach((i) =>
    i.addEventListener("change", () => { collect(); save(); }));

  el("btn-prev").disabled = S.step === 0;
  el("btn-next").textContent = S.step === STEPS.length - 1 ? "Submit the brief" : "Continue";
  show("form");
}

function collect() {
  el("step-body").querySelectorAll("input[data-key]").forEach((i) => {
    if (i.type === "radio") { if (i.checked) S.d[i.dataset.key] = i.value; }
    else S.d[i.dataset.key] = i.value;
  });
  const notes = el("f-notes");
  if (notes) S.d.notes = notes.value;
}

async function save() {
  setSave("Saving…");
  try { await sbRpc("save_intake_draft", { p_token: S.token, p_payload: S.d }); setSave("Saved", "saved"); }
  catch (e) { setSave("Not saved", "error"); console.error(e); }
}

// Per-step validation. Kept client-side for a fast answer, but submit_intake
// re-checks server-side — the browser is not the authority on completeness.
function validateStep() {
  const need = [
    ["ticket_size", "cycle_days", "leads_per_day", "expected_days_to_first_close"],
    ["buyer_response", "buyer_is_senior", "cold_outbound_pct"],
    ["has_crm", "followup_rate_pct", "refund_policy_exists"],
    [], ["comp_band"], [],
  ][S.step];

  const missing = need.filter((k) => S.d[k] === undefined || String(S.d[k]).trim() === "");
  if (missing.length) return "Please answer every question on this step before continuing.";
  if (S.step === 3 && (S.d.top3 || []).length !== 3) return "Please pick exactly three.";

  // One live client typed a monthly figure into a box labelled ₹/year. Nothing
  // caught it, and the effect is invisible and total: every candidate expecting
  // a normal salary falls outside the band and the shortlist reads as though
  // nobody is suitable. A label is not a validation.
  const sal = Number(S.d.salary_max || S.d.salary_min || 0);
  if (S.step === 4 && sal > 0 && sal < 100000) {
    return `₹${sal.toLocaleString("en-IN")} a year is below India's minimum wage — ` +
           `this box is annual, not monthly. If you meant ₹${sal.toLocaleString("en-IN")} ` +
           `a month, please enter ₹${(sal * 12).toLocaleString("en-IN")}.`;
  }
  return null;
}

el("btn-prev").addEventListener("click", () => { collect(); if (S.step > 0) { S.step--; renderStep(); } });

el("btn-next").addEventListener("click", async () => {
  collect();
  const err = validateStep();
  if (err) {
    el("form-error").hidden = false;
    el("form-error").innerHTML = `<span class="label">Not quite done</span>${esc(err)}`;
    return;
  }
  await save();

  if (S.step < STEPS.length - 1) { S.step++; renderStep(); return; }

  // Assemble hard filters only from answers the client actually gave. An empty
  // field must mean "no constraint", never a filter that silently excludes.
  const hf = {};
  if (S.d.hf_locations && S.d.hf_locations.trim())
    hf.locations = S.d.hf_locations.split(",").map((x) => x.trim()).filter(Boolean);
  if (S.d.hf_work_mode) hf.work_mode = S.d.hf_work_mode;
  // The help text says "e.g. en, hi" and this used to store that whole string as
  // ONE language key. `languages->>'en, hi'` matches nothing, so the check could
  // never pass — on all three live clients. The field taught the mistake and the
  // code obeyed it. Split, exactly as locations above already did.
  if (S.d.hf_language && S.d.hf_language.trim())
    hf.languages_required = S.d.hf_language.split(",")
      .map((x) => x.trim().toLowerCase()).filter(Boolean)
      .map((lang) => ({ lang, min: "fluent" }));
  if (S.d.hf_join_by_days) hf.join_by_days = Number(S.d.hf_join_by_days);
  if (S.d.hf_min_years) hf.min_years_experience = Number(S.d.hf_min_years);
  if (S.d.salary_min) hf.salary_min = Number(S.d.salary_min);
  if (S.d.salary_max) hf.salary_max = Number(S.d.salary_max);

  const payload = { ...S.d, hard_filters: hf, benchmark_source: "none" };

  const b = el("btn-next"); b.disabled = true; b.textContent = "Submitting…";
  try {
    const res = await sbRpc("submit_intake", { p_token: S.token, p_payload: payload });
    if (!res.ok) {
      el("form-error").hidden = false;
      el("form-error").innerHTML =
        `<span class="label">Still missing</span>${res.missing.map(esc).join(", ")}`;
      b.disabled = false; b.textContent = "Submit the brief";
      return;
    }
    show("done");
  } catch (e) {
    el("form-error").hidden = false;
    el("form-error").innerHTML = `<span class="label">Could not submit</span>${esc(e.message)}`;
    b.disabled = false; b.textContent = "Submit the brief";
  }
});

// ═══ BOOT ══════════════════════════════════════════════════════════════════
(async () => {
  if (!S.token) return fail("This link is missing its access code. Use the exact link you were sent.");
  try {
    S.form = await sbRpc("get_intake_form", { p_token: S.token });
  } catch (e) { return fail(e.message); }

  if (S.form.submitted) return show("done");
  S.d = S.form.draft || {};
  S.d.top3 = S.d.top3 || [];
  S.d.bottom3 = S.d.bottom3 || [];
  renderStep();
})();
