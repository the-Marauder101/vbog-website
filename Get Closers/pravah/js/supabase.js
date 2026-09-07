(function (root) {
  "use strict";
  let accessToken = null;
  let refreshToken = null;
  let refreshing = null;

  function setSession(data) {
    if (data.access_token) { accessToken = data.access_token; sessionStorage.setItem("pravah_access", data.access_token); }
    if (data.refresh_token) { refreshToken = data.refresh_token; sessionStorage.setItem("pravah_refresh", data.refresh_token); }
  }
  function restore() {
    accessToken = sessionStorage.getItem("pravah_access");
    refreshToken = sessionStorage.getItem("pravah_refresh");
    return Boolean(accessToken);
  }
  function signOut() {
    accessToken = null; refreshToken = null;
    sessionStorage.removeItem("pravah_access"); sessionStorage.removeItem("pravah_refresh");
  }
  async function auth(path, body) {
    const response = await fetch(PRAVAH_SUPABASE_URL + "/auth/v1/" + path, { method: "POST", headers: { apikey: PRAVAH_SUPABASE_ANON_KEY, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json().catch(function () { return {}; });
    if (!response.ok) throw new Error(data.error_description || data.msg || data.message || "Sign-in failed.");
    return data;
  }
  async function refresh() {
    if (!refreshToken) return false;
    if (refreshing) return refreshing;
    refreshing = auth("token?grant_type=refresh_token", { refresh_token: refreshToken }).then(function (data) { setSession(data); return true; }).catch(function () { signOut(); return false; }).finally(function () { refreshing = null; });
    return refreshing;
  }
  async function request(url, options, retried) {
    options = options || {};
    const headers = { apikey: PRAVAH_SUPABASE_ANON_KEY, Authorization: "Bearer " + (accessToken || PRAVAH_SUPABASE_ANON_KEY) };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    if (["POST", "PATCH"].includes(options.method)) headers.Prefer = "return=representation";
    let response;
    try { response = await fetch(url, { method: options.method || "GET", headers: headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) }); }
    catch (_error) { throw new Error("Could not reach Pravah. Check your connection and try again."); }
    if (response.status === 401 && !retried && refreshToken && await refresh()) return request(url, options, true);
    if (!response.ok) {
      const error = await response.json().catch(function () { return {}; });
      const wrapped = new Error(error.message || "Request failed (" + response.status + ").");
      wrapped.code = error.code || String(response.status); throw wrapped;
    }
    if (response.status === 204) return null;
    return response.json();
  }
  root.PravahApi = {
    restore: restore, signOut: signOut,
    signIn: async function (email, password) { const data = await auth("token?grant_type=password", { email: email, password: password }); setSession(data); return data; },
    fetch: function (path, options) { return request(PRAVAH_SUPABASE_URL + "/rest/v1/" + path, options); },
    rpc: function (name, args) { return request(PRAVAH_SUPABASE_URL + "/rest/v1/rpc/" + name, { method: "POST", body: args || {} }); },
    invoke: function (name, body) { return request(PRAVAH_SUPABASE_URL + "/functions/v1/" + name, { method: "POST", body: body || {} }); },
    // Changes the signed-in user's own password using their existing session.
    // Deliberately session-based, not email-based: Pravah has no SMTP, so an
    // emailed reset link would never arrive. An admin issues the first
    // password; the user replaces it here on first sign-in.
    changePassword: async function (newPassword) {
      if (!newPassword || newPassword.length < 8) throw new Error("Password must be at least 8 characters.");
      const response = await fetch(PRAVAH_SUPABASE_URL + "/auth/v1/user", {
        method: "PUT",
        headers: { apikey: PRAVAH_SUPABASE_ANON_KEY, Authorization: "Bearer " + accessToken, "Content-Type": "application/json" },
        body: JSON.stringify({ password: newPassword })
      });
      const data = await response.json().catch(function () { return {}; });
      if (!response.ok) throw new Error(data.error_description || data.msg || data.message || "Could not change password.");
      return data;
    }
  };
})(window);
