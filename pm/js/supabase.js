// Minimal PostgREST client — no SDK, no dependencies.
// All requests go through sbFetch; errors throw with a readable message.

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
