// js/assess.js — candidate assessment flow.
//
// State lives in `S`. Every answer is written through save_response() the moment
// it is picked, so a dropped connection or a closed tab costs at most the item
// currently on screen.
//
// THINGS THIS FILE MUST NOT DO, and the reason:
//   · show a dimension name — the vocabulary leaks into the candidate pool and
//     contaminates every future assessment (PRD §11.4)
//   · describe any block as an honesty, integrity or personality check — that
//     framing makes the keyed answers obvious and destroys the items
//   · allow back-navigation across a block boundary — a candidate who sees the
//     fast-close framing must not be able to revise their considered-purchase
//     answers in light of it, since the key inverts between them (PRD §5)
//   · hold or display a score — it never receives one

const S = {
  token: new URLSearchParams(location.search).get("t"),
  items: [],
  answers: {},          // item_id -> option_key
  i: 0,                 // index into items
  startedAt: Date.now(),
  itemShownAt: 0,
  blocksSeen: new Set(),
  blockFloor: 0,        // no Back below this index — the current block's first item
  submitting: false,
};

// Block titles are about the SALES SITUATION, never the construct. "Block F —
// Sales Integrity" would hand the candidate the key.
const BLOCK_INTRO = {
  A:  { title: "Working through a hard day",      note: "Six short situations." },
  B:  { title: "Targets and numbers",             note: "Six short situations." },
  C:  { title: "Keeping track of your pipeline",  note: "Six short situations." },
  D:  { title: "A larger, considered sale",       note: "Four situations." },
  D2: { title: "A fast inbound call",             note: "Four situations. The setup is different from the last set — read the framing carefully." },
  E:  { title: "Feedback and coaching",           note: "Four situations." },
  F:  { title: "Judgement calls",                 note: "Four situations." },
  G:  { title: "How you like to work",            note: "Five quick either/or choices. Both options are reasonable — pick the one that is more like you." },
  H:  { title: "How you deal with people",        note: "Five quick either/or choices. Both options are reasonable — pick the one that is more like you." },
};

const el = (id) => document.getElementById(id);

function show(name) {
  document.querySelectorAll(".screen").forEach((s) => {
    s.hidden = true;
    s.classList.remove("enter");
  });
  const target = el("screen-" + name);
  target.hidden = false;
  // One authored moment: a short rise as each screen arrives. The default state
  // is fully visible, so nothing depends on the animation to be readable.
  void target.offsetWidth;
  target.classList.add("enter");
  el("nav").hidden = name !== "item";
  window.scrollTo(0, 0);
}

function setSave(text, state) {
  const s = el("savestate");
  s.textContent = text;
  if (state) s.dataset.state = state;
  else delete s.dataset.state;
}

function fail(msg) {
  el("error-text").textContent = msg;
  show("error");
}

// ── Elapsed timer. Per-session, advisory only. There is no hard cutoff: a
// candidate who is slow because they are thinking should not be punished, and a
// fast completion is already caught server-side by the fast_completion flag.
function tickClock() {
  if (el("topbar").hidden) return;
  const s = Math.floor((Date.now() - S.startedAt) / 1000);
  el("elapsed").textContent =
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
setInterval(tickClock, 1000);

function updateProgress() {
  const done = Object.keys(S.answers).length;
  el("progress").style.transform = `scaleX(${done / S.items.length})`;
  el("counter").textContent = `Question ${Math.min(S.i + 1, S.items.length)} of ${S.items.length}`;
}

// ═══ CONSENT ═══════════════════════════════════════════════════════════════

async function loadConsent() {
  if (!S.token) return fail("This link is missing its access code. Please use the exact link the recruiter sent you.");

  let notice;
  try {
    notice = await sbRpc("get_consent_notice");
  } catch (e) {
    return fail(e.message);
  }

  // The gate: a consent notice still containing "[Firm]" is not consent, so the
  // assessment simply does not open until the settings are filled in.
  if (!notice.configured) {
    console.warn("Consent notice not configured. Missing:", notice.missing);
    return fail("This assessment isn't quite ready yet. Please let your recruiter know — they need to finish setting it up.");
  }

  const firm = notice.firm;
  el("c-intro").textContent =
    `This assessment is part of ${firm}'s hiring process for sales roles with our client companies.`;
  el("c-who").innerHTML =
    `Only ${firm}'s internal recruitment team. <span class="emphasis">Your scores are not shared with client companies.</span> ` +
    `If we recommend you to a client, we share your CV and our written recommendation — never your assessment results.`;
  el("c-choices").innerHTML =
    `You can withdraw consent or ask us to delete your data at any time by emailing ` +
    `<a href="mailto:${notice.deletion_email}">${notice.deletion_email}</a>. It means we stop processing your assessment data.`;
  el("c-grievance").innerHTML =
    `${notice.grievance_officer} — <a href="mailto:${notice.grievance_email}">${notice.grievance_email}</a>`;
  el("c-checkbox-label").textContent =
    `I have read the above and consent to ${firm} processing my assessment data for recruitment matching.`;

  el("consent-box").addEventListener("change", (e) => {
    el("btn-consent").disabled = !e.target.checked;
  });
  el("btn-consent").addEventListener("click", beginAssessment);

  // ALREADY CONSENTED? Then do not ask again. Someone who closes the tab halfway
  // through and reopens the link was being shown the whole C1 notice a second
  // time and made to tick the box again, which reads as "the tool forgot me" and
  // contradicts what we tell them: that the link resumes where they stopped.
  //
  // No new RPC for this: start_assessment() already refuses without consent, and
  // with a distinct message. Try it, and fall back to the notice only when it
  // says consent is what is missing.
  try {
    return enterTest(await sbRpc("start_assessment", { p_token: S.token }));
  } catch (e) {
    if (!/consent has not been recorded/i.test(e.message)) return fail(e.message);
  }

  show("consent");
}

// The one place the test actually starts, shared by both paths so a resumed
// session and a fresh one cannot drift apart.
function enterTest(data) {
  S.items = data.items;
  // `answered`, not `answers` — start_assessment() has always returned the map
  // under that name, and reading the wrong property silently disabled every
  // piece of resume in this file at once: the index landed on item 1, no radio
  // was pre-selected, the progress bar started at zero and the review screen
  // counted nothing. Everything downstream of this line was already correct.
  S.answers = data.answered || {};
  // Resume where they left off: the first unanswered item.
  S.i = S.items.findIndex((it) => !(it.id in S.answers));
  if (S.i < 0) S.i = S.items.length;
  S.startedAt = Date.now();
  el("topbar").hidden = false;   // the clock starts when the test does
  advance(true);
}

async function beginAssessment() {
  el("btn-consent").disabled = true;
  el("btn-consent").textContent = "Starting…";
  try {
    await sbRpc("record_consent", { p_token: S.token });
    enterTest(await sbRpc("start_assessment", { p_token: S.token }));
  } catch (e) {
    el("btn-consent").disabled = false;
    el("btn-consent").textContent = "Start the assessment";
    fail(e.message);
  }
}

// ═══ FLOW ══════════════════════════════════════════════════════════════════

// Called whenever we land on index S.i. Shows a block interstitial first if we
// are entering a block we have not introduced yet.
function advance(resuming) {
  if (S.i >= S.items.length) return showReview();

  const item = S.items[S.i];
  const block = item.block;

  if (!S.blocksSeen.has(block)) {
    S.blocksSeen.add(block);
    S.blockFloor = S.i;          // Back is now barred below this point
    return showBlockIntro(block, item, resuming);
  }
  renderItem();
}

function showBlockIntro(block, item, resuming) {
  const intro = BLOCK_INTRO[block] || { title: "Next section", note: "" };
  el("block-title").textContent = intro.title;

  // Blocks D and D2 carry the framing note from the bank, so the candidate is
  // not guessing at the sales motion. Without it, CLS_C and CLS_F are unreadable.
  if (item.framing_note) {
    el("block-framing").hidden = false;
    el("block-framing-text").textContent = item.framing_note;
  } else {
    el("block-framing").hidden = true;
  }

  let note = intro.note;
  if (S.i > 0) {
    note += " Once you continue, you won't be able to go back to the previous section.";
  }
  if (resuming && S.i > 0) {
    note = "Picking up where you left off. " + note;
  }
  el("block-note").textContent = note.trim();

  el("btn-block-go").onclick = () => renderItem();
  show("block");
}

function renderItem() {
  const item = S.items[S.i];
  S.itemShownAt = Date.now();

  const isFC = item.format === "forced_choice";

  // Repeat the framing inside the item for D and D2 — a candidate scrolling back
  // into the block after a break should not lose the setup, and the CLS key
  // inverts between those two blocks, so the setup is load-bearing.
  // Forced-choice items carry a framing_note too, but theirs is just the pick-one
  // instruction, which the hint already gives. Showing it as a callout as well
  // put the same sentence on screen three times.
  if (item.framing_note && !isFC) {
    el("item-framing").hidden = false;
    el("item-framing-text").textContent = item.framing_note;
  } else {
    el("item-framing").hidden = true;
  }

  // All ten forced-choice items share the stem "Which is more like you?", so
  // rendering it adds a line of noise above two options that are self-evidently
  // the question.
  el("item-stem").hidden = isFC;
  el("item-stem").textContent = isFC ? "" : item.stem;

  const hint = el("item-hint");
  if (isFC) {
    hint.hidden = false;
    hint.textContent = "Both are reasonable. Pick the one that is more like you.";
  } else if (item.format === "sd_check") {
    hint.hidden = false;
    hint.textContent = "True or false for you.";
  } else {
    hint.hidden = true;
  }

  const box = el("item-options");
  box.innerHTML = "";
  item.options.forEach((opt, idx) => {
    const label = document.createElement("label");
    label.className = "option" + (S.answers[item.id] === opt.key ? " selected" : "");
    const input = document.createElement("input");
    input.type = "radio";
    input.name = item.id;
    input.value = opt.key;
    input.checked = S.answers[item.id] === opt.key;
    // The input itself is the visible square marker (appearance:none in CSS),
    // so there is no decorative element to keep in sync with it.
    const span = document.createElement("span");
    span.className = "text";
    span.textContent = opt.text;
    label.append(input, span);
    // position_shown is the DISPLAYED position, which is what the straightline
    // flag needs — option order is randomised per session, so option_key would
    // miss a candidate clicking "always the second one".
    input.addEventListener("change", () => pick(item, opt.key, idx + 1));
    box.append(label);
  });

  el("btn-back").disabled = S.i <= S.blockFloor;
  el("btn-next").disabled = !(item.id in S.answers);
  el("btn-next").textContent = S.i === S.items.length - 1 ? "Finish" : "Next";
  setSave("");
  updateProgress();
  show("item");
}

async function pick(item, optionKey, position) {
  S.answers[item.id] = optionKey;

  document.querySelectorAll("#item-options .option").forEach((l) => {
    l.classList.toggle("selected", l.querySelector("input").value === optionKey);
  });
  el("btn-next").disabled = false;
  updateProgress();

  setSave("Saving…");
  try {
    await sbRpc("save_response", {
      p_token: S.token,
      p_item_id: item.id,
      p_option_key: optionKey,
      p_seconds: Math.round((Date.now() - S.itemShownAt) / 1000),
      p_position: position,
    });
    setSave("Saved", "saved");
  } catch (e) {
    // Keep the answer on screen and let them continue; the next item's save, or
    // the completeness check at submit, will surface a genuine problem. Losing a
    // selection because the network blinked would be worse than a stale label.
    setSave("Not saved — check connection", "error");
    console.error(e);
  }
}

el("btn-next").addEventListener("click", () => {
  if (S.i < S.items.length - 1) {
    S.i += 1;
    advance(false);
  } else {
    showReview();
  }
});

el("btn-back").addEventListener("click", () => {
  if (S.i > S.blockFloor) {
    S.i -= 1;
    renderItem();
  }
});

// ═══ SUBMIT ════════════════════════════════════════════════════════════════

function showReview() {
  const answered = Object.keys(S.answers).length;
  const missing = S.items.length - answered;
  const mins = Math.round((Date.now() - S.startedAt) / 60000);
  const took = mins < 1 ? "in under a minute" : `in about ${mins} minute${mins === 1 ? "" : "s"}`;

  el("review-text").textContent =
    `You answered ${answered} of ${S.items.length} questions ${took}.`;

  const warn = el("review-warn");
  if (missing > 0) {
    warn.hidden = false;
    warn.textContent =
      `${missing} question${missing === 1 ? "" : "s"} ${missing === 1 ? "is" : "are"} still unanswered. ` +
      `Submitting needs all of them — reopen this link and it will take you to the first one you missed.`;
    el("btn-submit").disabled = true;
  } else {
    warn.hidden = true;
    el("btn-submit").disabled = false;
  }
  show("review");
}

el("btn-submit").addEventListener("click", async () => {
  if (S.submitting) return;
  S.submitting = true;
  el("btn-submit").disabled = true;
  el("btn-submit").textContent = "Submitting…";
  try {
    const res = await sbRpc("finish_assessment", { p_token: S.token });
    // The server is the authority on completeness, not the browser's tally.
    if (res && res.complete === false) {
      S.submitting = false;
      el("btn-submit").textContent = "Submit my answers";
      el("review-warn").hidden = false;
      el("review-warn").textContent =
        `The server has ${res.answered} of ${res.expected} answers. Please reopen the link to finish the rest.`;
      return;
    }
    showMonitoring();
  } catch (e) {
    S.submitting = false;
    el("btn-submit").disabled = false;
    el("btn-submit").textContent = "Submit my answers";
    fail(e.message);
  }
});

// ═══ MONITORING (§14.3) ════════════════════════════════════════════════════
// Deliberately after submission and deliberately skippable. A 15-point gap
// between groups on a dimension is a fact about our items, not about closers —
// and we can only find it if we ask.

const M_GENDER = ["Woman", "Man", "Another term", "Prefer not to say"];
const M_AGE = ["Under 25", "25–34", "35–44", "45 or over", "Prefer not to say"];

function radios(host, name, opts) {
  el(host).innerHTML = opts.map((o) => `
    <label class="option"><input type="radio" name="${name}" value="${o.startsWith("Prefer") ? "" : o}">
      <span class="text">${o}</span></label>`).join("");
}

function showMonitoring() {
  radios("m-gender", "m_gender", M_GENDER);
  radios("m-age", "m_age", M_AGE);
  document.querySelectorAll('#screen-monitor input[type="radio"]').forEach((i) =>
    i.addEventListener("change", () => {
      i.closest("#screen-monitor").querySelectorAll(`input[name="${i.name}"]`).forEach((o) =>
        o.closest(".option").classList.toggle("selected", o.checked));
    }));
  show("monitor");
}

el("btn-monitor-skip").addEventListener("click", () => show("done"));

el("btn-monitor-save").addEventListener("click", async () => {
  const pick = (n) => {
    const c = document.querySelector(`#screen-monitor input[name="${n}"]:checked`);
    return c ? c.value : "";
  };
  const b = el("btn-monitor-save"); b.disabled = true;
  try {
    await sbRpc("save_monitoring", {
      p_token: S.token, p_gender: pick("m_gender"),
      p_age_band: pick("m_age"), p_region: el("m-region").value.trim(),
    });
  } catch (e) { console.error(e); }   // never block the candidate on this
  show("done");
});

// Guard against a mid-assessment tab close taking an unsaved selection with it.
window.addEventListener("beforeunload", (e) => {
  const done = Object.keys(S.answers).length;
  if (done > 0 && done < S.items.length && !S.submitting) {
    e.preventDefault();
    e.returnValue = "";
  }
});

loadConsent();
