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

let SB_ACCESS_TOKEN = null;   // set by auth.js after a staff sign-in

function sbSetToken(token) {
  SB_ACCESS_TOKEN = token;
}

function sbHeaders(hasBody) {
  const h = {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SB_ACCESS_TOKEN || SUPABASE_ANON_KEY}`,
  };
  if (hasBody) h["Content-Type"] = "application/json";
  return h;
}

async function sbRequest(url, { method = "GET", body } = {}) {
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
      } else if (err.message) {
        msg = err.message;
      }
    } catch (_) { /* non-JSON error body */ }
    throw new Error(msg);
  }

  if (res.status === 204) return null;
  return res.json();
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
