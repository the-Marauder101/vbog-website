// js/supabase.js — the ONE network wrapper.
//
// Same shape as internal/pm/js/supabase.js so anyone who knows Vyom already
// knows this. Two entry points:
//
//   sbFetch(path, {method, body})  → PostgREST, for staff-authenticated pages
//   sbRpc(fn, args)                → a Postgres function, for the candidate
//                                    surface (which has no table access at all)
//
// Every query in the app goes through here. No SDK, no other fetch calls.

// A Supabase access token lives for ONE HOUR. Storing only the access token
// meant the console worked for an hour after sign-in and then failed every
// action with a raw "JWT expired". The refresh token is what fixes that, so both
// are held and a 401 triggers exactly one silent refresh-and-retry.
let SB_ACCESS_TOKEN = null;
let SB_REFRESH_TOKEN = null;
let SB_REFRESHING = null;     // shared promise: parallel 401s must not each refresh

function sbSetToken(token) {
  SB_ACCESS_TOKEN = token;
}

function sbSetSession(d) {
  if (d.access_token) {
    SB_ACCESS_TOKEN = d.access_token;
    sessionStorage.setItem("nikash_token", d.access_token);
  }
  if (d.refresh_token) {
    SB_REFRESH_TOKEN = d.refresh_token;
    sessionStorage.setItem("nikash_refresh", d.refresh_token);
  }
}

// Returns true if a fresh access token is now in place.
function sbRefreshSession() {
  if (!SB_REFRESH_TOKEN) return Promise.resolve(false);
  if (SB_REFRESHING) return SB_REFRESHING;

  SB_REFRESHING = sbAuth("token?grant_type=refresh_token", { refresh_token: SB_REFRESH_TOKEN })
    .then((d) => { sbSetSession(d); return true; })
    .catch(() => { sbSignOut(); return false; })
    .finally(() => { SB_REFRESHING = null; });

  return SB_REFRESHING;
}

function sbHeaders(hasBody) {
  const h = {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SB_ACCESS_TOKEN || SUPABASE_ANON_KEY}`,
  };
  if (hasBody) h["Content-Type"] = "application/json";
  return h;
}

async function sbRequest(url, { method = "GET", body } = {}, _retried) {
  const headers = sbHeaders(body !== undefined);
  if (method === "POST" || method === "PATCH") headers.Prefer = "return=representation";

  let res;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new Error("Network error — could not reach the server.");
  }

  // Expired access token. Refresh once, silently, and replay the request. Only
  // attempted when we actually hold a refresh token, so anon calls fall through.
  if (res.status === 401 && !_retried && SB_REFRESH_TOKEN) {
    if (await sbRefreshSession()) {
      return sbRequest(url, { method, body }, true);
    }
    throw new Error("Your session expired. Please sign in again.");
  }

  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const err = await res.json();
      if (err.code === "PGRST205") {
        const banner = document.getElementById("setup-needed");
        if (banner) banner.hidden = false;
        msg = "Database not set up — run the files in closer-match/sql/ in order.";
      } else if (err.code === "42501") {
        // RLS denial. Almost always a missing sign-in rather than a bug.
        msg = "Not permitted. Sign in with a staff account.";
      } else if (err.code === "PGRST301" || /jwt (expired|invalid)/i.test(err.message || "")) {
        // Refresh already failed by the time we get here.
        msg = "Your session expired. Please sign in again.";
      } else if (err.message) {
        msg = err.message;
      }
    } catch (_) { /* non-JSON error body */ }
    throw new Error(msg);
  }

  if (res.status === 204) return null;
  return res.json();
}

// ── Auth (staff console only) ───────────────────────────────────────────────
// The token is kept in sessionStorage, not localStorage: a shared recruiter
// laptop should not stay signed into a surface that renders scores.

async function sbAuth(path, body) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
    method: "POST",
    headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error_description || data.msg || data.message || `Sign-in failed (${res.status})`);
  }
  return data;
}

async function sbSignIn(email, password) {
  const d = await sbAuth("token?grant_type=password", { email, password });
  sbSetSession(d);
  return d;
}

async function sbSignUp(email, password) {
  return sbAuth("signup", { email, password });
}

function sbRestoreToken() {
  const t = sessionStorage.getItem("nikash_token");
  const r = sessionStorage.getItem("nikash_refresh");
  if (t) SB_ACCESS_TOKEN = t;
  if (r) SB_REFRESH_TOKEN = r;
  return t;
}

function sbSignOut() {
  SB_ACCESS_TOKEN = null;
  SB_REFRESH_TOKEN = null;
  sessionStorage.removeItem("nikash_token");
  sessionStorage.removeItem("nikash_refresh");
}

// PostgREST. Filters live in the path:
//   sbFetch("requirements?status=eq.open&select=*,clients(business_name)")
function sbFetch(path, opts) {
  return sbRequest(`${SUPABASE_URL}/rest/v1/${path}`, opts);
}

// A Postgres function. The candidate surface uses only these:
//   sbRpc("start_assessment",  { p_token })
//   sbRpc("save_response",     { p_token, p_item_id, p_option_key, ... })
//   sbRpc("finish_assessment", { p_token })
function sbRpc(fn, args = {}) {
  return sbRequest(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: "POST", body: args });
}
