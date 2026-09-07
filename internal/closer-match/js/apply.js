// ═══ APPLY — one link, many applicants ═════════════════════════════════════
//
// assess.html is opened with a token minted for one named person. This is the
// other door: a durable link that goes in a job advert, opened by somebody
// nobody has met. It takes a name and an email and hands them to the assessment.
//
// The page reads nothing and holds nothing. Two RPCs, both anon-callable and both
// on the allowlist with a written reason (sql/47): one says whether the link is
// open, the other creates or finds the candidate and returns their token.
//
// The consent notice is NOT duplicated here. Consent is taken on assess.html,
// against the notice the candidate is actually agreeing to, and a second copy on
// this page would be a second thing to keep in step with the first.

const el = (id) => document.getElementById(id);
const SLUG = new URLSearchParams(location.search).get("k");

function show(name) {
  document.querySelectorAll(".screen").forEach((s) => (s.hidden = true));
  const t = el("screen-" + name);
  if (t) t.hidden = false;
  window.scrollTo(0, 0);
}

function closed(reason) {
  el("closed-text").textContent = reason;
  show("closed");
}

function fieldError(msg) {
  const e = el("ap-error");
  e.textContent = msg;
  e.hidden = !msg;
}

async function apply() {
  const b = el("btn-apply");
  const name = el("ap-name").value.trim();
  const email = el("ap-email").value.trim();

  // Checked here so the common mistakes cost nothing, and checked again in the
  // database because this page is not the only thing that can call that function.
  if (name.length < 2) {
    fieldError("Please enter your full name.");
    return el("ap-name").focus();
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    fieldError("Please enter an email address we can reach you on.");
    return el("ap-email").focus();
  }
  fieldError("");

  b.disabled = true;
  b.textContent = "Starting…";
  try {
    const r = await sbRpc("open_link_apply", {
      p_slug: SLUG, p_name: name, p_email: email,
    });
    // Straight into the assessment on the token that came back. A returning
    // applicant gets the same token they had, so this resumes rather than
    // starting them again — which is the point of deduping on email.
    location.replace(`assess.html?t=${encodeURIComponent(r.token)}`);
  } catch (e) {
    fieldError(e.message);
    b.disabled = false;
    b.textContent = "Start the assessment →";
  }
}

el("btn-apply").addEventListener("click", apply);

// Enter from either field submits, because a two-field form that needs a mouse
// is a two-field form people abandon.
["ap-name", "ap-email"].forEach((id) =>
  el(id).addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); apply(); }
  }));

(async () => {
  show("loading");
  if (!SLUG) {
    return closed("This link is missing its code. Ask whoever sent it for the full address.");
  }
  try {
    const r = await sbRpc("get_open_link", { p_slug: SLUG });
    if (!r || !r.ok) {
      return closed((r && r.reason) ||
        "This link is not open. If somebody sent it to you recently, ask them for a current one.");
    }
    if (r.label) el("form-kicker").textContent = r.label;
    show("form");
    el("ap-name").focus();
  } catch (e) {
    closed(e.message);
  }
})();
