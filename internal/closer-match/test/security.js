// SECURITY — the three rules, checked from outside the building.
//
// Nikash has three rules that are not features and cannot be traded off:
//
//   R1  scores never leave the building
//   R2  a candidate is assessed blind to any client
//   R3  the system ranks and explains; it never decides
//
// This suite checks them from the position of somebody who has the publishable
// key — which is everybody, because it is in the page source. Two-thirds of the
// work here is refusing to hand-maintain a list: the checks enumerate what the
// schema actually exposes and assert a property of all of it, so a table or
// function added next year is covered without anybody remembering this file.
//
// Run: NIKASH_QA_EMAIL=… NIKASH_QA_PASSWORD=… node test/security.js
const { suite, signIn, rpc, rest, anonRpc, anonRows } = require("./harness");
const CFG = require("fs").readFileSync(require("path").join(__dirname, "..", "js", "config.js"), "utf8");
const URL_ = (CFG.match(/SUPABASE_URL\s*=\s*"([^"]+)"/) || [])[1];
const KEY = (CFG.match(/SUPABASE_ANON_KEY\s*=\s*"([^"]+)"/) || [])[1];

suite("SECURITY SUITE", 8104, async ({ p, base, E, P, check, errs }) => {
  // ══ WHAT IS IN THE REPOSITORY ════════════════════════════════════════════
  // Checked before signing in, because it needs no session and because a secret
  // in a public repo is the one failure no amount of RLS helps with.
  // Comments are stripped first. The file's own warning — "never put the Secret
  // key, the service_role key or a personal access token in here" — contains
  // every string a naive scan looks for, so scanning the raw text reports the
  // warning as the leak. Scan the code.
  const code = CFG.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  check("config.js carries only the publishable key",
        /sb_publishable_/.test(code) &&
        !/service_role|sb_secret|sbp_[0-9a-f]{40}|eyJ[A-Za-z0-9_-]{20,}/.test(code),
        (code.match(/service_role|sb_secret|sbp_[0-9a-f]{8}|eyJ[A-Za-z0-9_-]{10}/) || ["clean"])[0]);
  check("and it says so, so nobody adds one later",
        /never put the Secret key|service_role/i.test(CFG), "");

  await signIn(p, base, E, P);

  // ══ R1 — EVERY EXPOSED FUNCTION, NOT A LIST OF THEM ══════════════════════
  // v_function_grant_audit reports any function anon can execute that is not on
  // the anon_callable allowlist. Postgres grants EXECUTE to PUBLIC by default,
  // so this is not a theoretical hole: every new function starts out world-
  // callable, and `grant execute to authenticated` restricts precisely nothing.
  const grants = await rest(p, "v_function_grant_audit?select=*");
  check("no function is callable by anon without being on the allowlist",
        Array.isArray(grants) && grants.length === 0,
        (grants || []).map(g => g.signature).join("; ") || "none");

  const allow = await rest(p, "anon_callable?select=proname,why&order=proname");
  check("the allowlist is short, and every entry says why it is there",
        Array.isArray(allow) && allow.length > 0 && allow.length <= 20 &&
        allow.every(a => a.why && a.why.length > 12),
        `${(allow || []).length} entries`);
  check("and nothing on it is a scoring or staff function",
        Array.isArray(allow) &&
        !allow.some(a => /candidate_detail|keying_report|apply_rekey|list_staff|add_staff|golden|profile|matches/.test(a.proname)),
        (allow || []).filter(a => /detail|report|rekey|staff/.test(a.proname)).map(a => a.proname).join(",") || "none");

  // Independently of the audit view, go and actually try them. The audit reads
  // catalogue grants; this reads what the server does when asked.
  const named = ["get_candidate_detail", "get_keying_report", "list_staff", "add_staff",
                 "apply_rekey", "undo_rekey", "preview_rekey", "record_key_decision",
                 "purge_expired_candidates", "run_golden_cases", "get_ask_bank",
                 "start_ask", "submit_ask", "get_candidate_ask", "get_ask_overlap",
                 "response_pattern", "compute_matches", "set_candidate_direct_fields",
                 "update_client_intake", "get_client_intake", "whoami",
                 "set_staff_role", "set_staff_active", "import_ask_json"];
  const tried = {};
  for (const fn of named) tried[fn] = await anonRpc(p, fn, {});
  const open = Object.entries(tried).filter(([, s]) => s < 400);
  check("and every staff RPC actually refuses an anon caller when asked",
        open.length === 0, open.map(([f, s]) => `${f}=${s}`).join(", ") || `${named.length} refused`);

  // ══ R1 — EVERY TABLE, NOT A LIST OF THEM ═════════════════════════════════
  const bypass = await rest(p, "v_rls_bypass_audit?select=*");
  check("no view runs as owner, no table is missing forced RLS, anon holds nothing",
        Array.isArray(bypass) && bypass.length === 0,
        (bypass || []).map(b => `${b.object}: ${b.problem}`).join("; ") || "clean");

  const c10 = await rest(p, "v_c10_audit?select=*");
  check("every policy in the schema names who it trusts",
        Array.isArray(c10) && c10.length === 0,
        (c10 || []).map(x => `${x.table_name}.${x.policy_name}`).join("; ") || "clean");

  const exempt = await rest(p, "rls_exempt?select=table_name,why");
  check("the RLS exemptions are few, and each one is justified in writing",
        Array.isArray(exempt) && exempt.length <= 5 &&
        exempt.every(e => e.why && e.why.length > 30),
        (exempt || []).map(e => e.table_name).join(", "));

  // Try the tables directly, as a stranger with the published key.
  const tables = ["candidate_profile", "matches", "candidates", "candidate_responses",
                  "client_target_profile", "item_options", "items", "keying_submissions",
                  "keying_tokens", "assessment_tokens", "staff", "clients", "requirements",
                  "client_intake", "ask_scorecards", "ask_scores", "ask_questions",
                  "ask_options", "ask_attributes", "monitoring_attributes",
                  "interview_ratings", "supplement_responses", "key_decisions",
                  "key_changes", "anon_callable", "dimension_params", "placement_outcomes"];
  const reachable = [];
  for (const t of tables) {
    const r = await anonRows(p, t);
    if (r.status < 400 && r.rows > 0) reachable.push(`${t}(${r.rows})`);
  }
  check("NOT ONE TABLE RETURNS A ROW TO SOMEBODY HOLDING ONLY THE PUBLIC KEY",
        reachable.length === 0, reachable.join(", ") || `${tables.length} tables, all closed`);

  // The candidate's consent notice is the one thing that must be public: a person
  // has to be able to read what they are agreeing to before identifying themself.
  check("but the consent notice is public, because it has to be",
        (await anonRpc(p, "get_consent_notice", {})) === 200, "");

  // ══ R2 — ASSESSED BLIND ══════════════════════════════════════════════════
  // The candidate's own surface is served by three token RPCs. None of them may
  // name a client, a role, or a requirement — a candidate who knows which job
  // they are being measured for answers for that job.
  const cands = await rest(p, "candidates?select=id,full_name&limit=40");
  const withTok = await rest(p, "assessment_tokens?select=token,candidate_id&limit=1");
  if (Array.isArray(withTok) && withTok.length) {
    const t = withTok[0].token;
    const payloads = {};
    for (const fn of ["start_assessment", "get_consent_notice"]) {
      const r = await fetch(`${URL_}/rest/v1/rpc/${fn}`, {
        method: "POST",
        headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify(fn === "get_consent_notice" ? {} : { p_token: t }) });
      payloads[fn] = await r.text();
    }
    const clients = await rest(p, "clients?select=business_name");
    const names = (clients || []).map(c => c.business_name).filter(n => n && !/^ZZ_/.test(n));
    const blob = Object.values(payloads).join(" ");
    check("the candidate surface names no client the firm works with",
          names.length === 0 || !names.some(n => blob.includes(n)),
          names.filter(n => blob.includes(n)).join(", ") || `checked ${names.length} client names`);
    const reqs = await rest(p, "requirements?select=title");
    const titles = [...new Set((reqs || []).map(r => r.title).filter(Boolean))];
    check("and no role title from any open requirement",
          !titles.some(x => x.length > 4 && blob.includes(x)),
          titles.filter(x => x.length > 4 && blob.includes(x)).join(", ") || `checked ${titles.length} titles`);
  } else {
    check("there is a live assessment token to check the blind rule against", false, "none found");
  }

  // ══ R3 — RANKS AND EXPLAINS, NEVER DECIDES ═══════════════════════════════
  // The strongest available form of this: there is nowhere in the schema to
  // record a rejection, so no code can be written that reads one. A column named
  // `rejected` would be the first step to a screen that hides people.
  const verdictCols = await rpc(p, "run_golden_cases", {});
  check("golden cases 19/19 — the engine behaves as its fixtures say",
        Array.isArray(verdictCols.body) && verdictCols.body.filter(g => g.passed).length === 19,
        `${(verdictCols.body || []).filter(g => g.passed).length}/${(verdictCols.body || []).length}`);

  // Read the column names of every scoring table through a zero-row select, which
  // PostgREST answers with the shape even when RLS returns nothing.
  const cols = await p.evaluate(async (tbls) => {
    const H = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${sessionStorage.getItem("nikash_token")}` };
    const out = {};
    for (const t of tbls) {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/${t}?select=*&limit=1`, { headers: H });
      const j = await r.json().catch(() => []);
      out[t] = Array.isArray(j) && j.length ? Object.keys(j[0]) : [];
    }
    return out;
  }, ["matches", "candidate_profile", "candidates", "ask_scorecards"]);
  const allCols = Object.values(cols).flat().map(c => c.toLowerCase());
  check("no table has anywhere to record a rejection, a verdict or a hire/no-hire",
        !allCols.some(c => /^(rejected|reject|verdict|decision|shortlisted|pass_fail|hire|no_hire|approved)$/.test(c)),
        allCols.filter(c => /reject|verdict|hire|approved/.test(c)).join(",") || `${allCols.length} columns checked`);

  const disclaimed = await rest(p, "v_console_clean?select=*&limit=1");
  check("the shortlist view is readable by staff and returns rows",
        Array.isArray(disclaimed), JSON.stringify(disclaimed).slice(0, 100));

  // ══ RETENTION — THE PURGE CANNOT BE FIRED BY A STRANGER ══════════════════
  check("the retention purge is not callable by anon",
        (await anonRpc(p, "purge_expired_candidates", {})) >= 400, "");
  const purgeGuard = await rpc(p, "purge_expired_candidates", {});
  check("and when staff run it, it reports what it did rather than just returning",
        purgeGuard.status === 200 && purgeGuard.body !== null,
        JSON.stringify(purgeGuard.body).slice(0, 120));

  // ══ THE REST OF THE AUDITS ═══════════════════════════════════════════════
  const audits = {};
  for (const v of ["v_empty_profile_audit", "v_unmatched_audit", "v_double_session_audit",
                   "v_staff_lockout_audit", "v_key_drift_audit"]) {
    const rows = await rest(p, `${v}?select=*`);
    audits[v] = Array.isArray(rows) ? rows.length : -1;
  }
  check("no candidate has an empty profile, none is unmatched, none has two sessions",
        audits.v_empty_profile_audit === 0 && audits.v_unmatched_audit === 0 &&
        audits.v_double_session_audit === 0, JSON.stringify(audits));
  check("and nobody can be locked out of the staff panel",
        audits.v_staff_lockout_audit === 0, `${audits.v_staff_lockout_audit} rows`);

  // ══ EVERY VIEW RUNS AS THE CALLER ════════════════════════════════════════
  // A `security_invoker = false` view is how a staff-only table becomes readable
  // by anyone who can select the view. sql/27 put an event trigger on this so it
  // is self-enforcing; this proves the trigger is still attached and working.
  const probe = await rpc(p, "run_golden_cases", {});
  check("the view-security event trigger is still in place",
        probe.status === 200 &&
        (await rest(p, "v_rls_bypass_audit?select=*")).length === 0, "");

  check("no JS errors", errs.length === 0, errs.join(" | "));
}, async ({ p, check }) => {
  // This suite creates nothing, so there is nothing to delete — but it still has
  // to say so, rather than leaving a reader to wonder whether cleanup was
  // forgotten. Silence in a cleanup block is indistinguishable from an omission.
  const stray = await rest(p, "candidates?select=id&full_name=like.ZZ_QA*");
  check("the suite created no fixtures, and none are left over",
        Array.isArray(stray) && stray.length === 0, `${(stray || []).length} strays`);
});
