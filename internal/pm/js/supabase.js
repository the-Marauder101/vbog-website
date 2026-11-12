// js/supabase.js — the ONE network wrapper (full docs: ../ARCHITECTURE.md §1, §5)
//
// sbFetch(path, {method, body}) → fetch against Supabase's auto REST API
// (PostgREST). Every query in the app goes through here — no SDK, no other
// fetch calls. Filter syntax lives in the path, e.g.:
//   sbFetch("tasks?project_id=eq.<uuid>&select=*,projects(name)")
// Errors always throw with a human-readable message (shown via UI.toast).
// PGRST205 (missing tables) reveals the "Database not set up" banner.

// sbFetchAll(path) — the same thing for a query that can exceed 1000 rows.
//
// PostgREST caps a response at 1000 rows (Supabase's db-max-rows) and says so
// only in a header: an over-long result comes back looking like a complete
// one, which is how a board can quietly stop showing a sixth of its cards.
//
// Paging also needs a deterministic ORDER BY. Without one Postgres may return
// heap order, and an UPDATE rewrites the row at the END of the heap — so the
// card somebody just saved is precisely the one that falls off page one. Any
// path with no `order=` gets `id.asc` here; a path that brings its own order
// must make it unique (add `id.asc` as a tiebreaker) or rows can repeat or go
// missing across page boundaries.
async function sbFetchAll(path, { pageSize = 1000, maxPages = 50 } = {}) {
  const sep = path.includes("?") ? "&" : "?";
  const base = /[?&]order=/.test(path) ? path : `${path}${sep}order=id.asc`;
  const out = [];
  for (let page = 0; page < maxPages; page++) {
    const rows = await sbFetch(`${base}&limit=${pageSize}&offset=${page * pageSize}`);
    if (!Array.isArray(rows)) return rows;
    out.push(...rows);
    if (rows.length < pageSize) return out;
  }
  // maxPages is a runaway guard, not an expected limit — say so rather than
  // silently returning a truncated list, which is the bug this function exists
  // to prevent.
  console.warn(`sbFetchAll: stopped at ${maxPages} pages for ${path}`);
  return out;
}

async function sbFetch(path, { method = "GET", body } = {}) {
  const headers = {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (method === "POST" || method === "PATCH") headers.Prefer = "return=representation";

  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
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
        // Tables missing — backend not set up yet
        const banner = document.getElementById("setup-needed");
        if (banner) banner.hidden = false;
        msg = "Database not set up — run the files in pm/sql/ in the Supabase SQL Editor.";
      } else if (err.message) {
        msg = err.message;
      }
    } catch (_) { /* non-JSON error body */ }
    throw new Error(msg);
  }

  if (res.status === 204) return null;
  return res.json();
}
