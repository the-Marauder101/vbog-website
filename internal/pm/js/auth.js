// js/auth.js — login state, page guards, roles (full docs: ../ARCHITECTURE.md §4)
//
// Session = {id, name, user_role, login_code, epoch} in localStorage under
// "vyom_user" (set by login.html, cleared by Logout). Roles: admin | member | external.
// Every page script starts with Auth.requireLogin() (settings: requireAdmin()),
// then Auth.initNav() for the user chip + admin-only Settings link.
// Auth.allowedProjectIds(): null = unrestricted (admin/member); array of
// project ids for externals — all pages filter their data through it.
//
// Sessions are re-checked against team_members (Auth.verify): on page load,
// when the tab regains focus, and every minute. If the member's login ID was
// changed or cleared, or they were deactivated, they are signed out.
// To sign EVERYONE out (e.g. after rotating IDs), bump EPOCH and release.
// ⚠ This is browser-enforced access control, not security (see handbook §4).

const Auth = {
  KEY: "vyom_user",
  EPOCH: 3, // bump to invalidate every existing session
  VERIFY_EVERY_MS: 60 * 1000,
  _allowed: undefined, // cached project-id allowlist for externals (null = all)
  _watching: false,

  // A session missing its login_code, or from an older EPOCH, is not a session.
  user() {
    let u;
    try {
      u = JSON.parse(localStorage.getItem(Auth.KEY));
    } catch (_) {
      return null;
    }
    if (!u || !u.id || !u.login_code || u.epoch !== Auth.EPOCH) return null;
    return u;
  },

  save(member) {
    localStorage.setItem(
      Auth.KEY,
      JSON.stringify({
        id: member.id,
        name: member.name,
        user_role: member.user_role,
        login_code: member.login_code,
        epoch: Auth.EPOCH,
      })
    );
  },

  logout(reason) {
    localStorage.removeItem(Auth.KEY);
    window.location.replace(reason ? `login.html?signedout=${reason}` : "login.html");
  },

  // Confirm the stored session still matches an active member with the same
  // login ID. Only a definite "no match" signs out — a network blip does not.
  async verify() {
    const me = Auth.user();
    if (!me) return Auth.logout("expired");
    let rows;
    try {
      rows = await sbFetch(
        `team_members?id=eq.${encodeURIComponent(me.id)}` +
          `&login_code=eq.${encodeURIComponent(me.login_code)}` +
          `&active=eq.true&select=id,name,user_role,login_code`
      );
    } catch (_) {
      return; // offline / server hiccup — try again on the next check
    }
    if (!rows.length) return Auth.logout("expired");
    const fresh = rows[0];
    if (fresh.name !== me.name || fresh.user_role !== me.user_role) {
      Auth.save(fresh); // role or name changed — reload so guards/nav apply
      window.location.reload();
    }
  },

  _watch() {
    if (Auth._watching) return;
    Auth._watching = true;
    Auth.verify();
    setInterval(Auth.verify, Auth.VERIFY_EVERY_MS);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) Auth.verify();
    });
    // Logged out in another tab → follow immediately.
    window.addEventListener("storage", (e) => {
      if (e.key === Auth.KEY && !Auth.user()) window.location.replace("login.html");
    });
  },

  isAdmin() {
    return Auth.user()?.user_role === "admin";
  },

  isExternal() {
    return Auth.user()?.user_role === "external";
  },

  // Redirect to the gate when not logged in. Call at the top of every page.
  requireLogin() {
    if (!Auth.user()) {
      localStorage.removeItem(Auth.KEY); // drop stale/old-format sessions
      window.location.replace("login.html");
      return false;
    }
    Auth._watch();
    return true;
  },

  requireAdmin() {
    if (!Auth.requireLogin()) return false;
    if (!Auth.isAdmin()) {
      window.location.replace("vyom.html");
      return false;
    }
    return true;
  },

  // null = unrestricted (admin/member); array of project ids for externals.
  async allowedProjectIds() {
    if (Auth._allowed !== undefined) return Auth._allowed;
    if (!Auth.isExternal()) {
      Auth._allowed = null;
      return null;
    }
    const rows = await sbFetch(`project_members?member_id=eq.${Auth.user().id}&select=project_id`);
    Auth._allowed = rows.map((r) => r.project_id);
    return Auth._allowed;
  },

  canSeeProject(projectId, allowed) {
    return allowed === null || allowed.includes(projectId);
  },

  // Nav chrome shared by all pages: user chip, logout, admin-only Settings link.
  initNav() {
    const me = Auth.user();
    if (!me) return;
    const right = document.querySelector(".nav-right");
    if (!right) return;
    if (!Auth.isAdmin()) right.querySelector('a[href="settings.html"]')?.remove();
    const chip = document.createElement("div");
    chip.className = "user-chip";
    chip.innerHTML = `
      <span class="user-avatar" style="background:${UI.avatarColor(me.name)}">${UI.esc(me.name.slice(0, 1).toUpperCase())}</span>
      <span class="user-name">${UI.esc(me.name)}</span>
      <button class="btn-link user-logout" title="Log out">Logout</button>`;
    chip.querySelector(".user-logout").addEventListener("click", () => Auth.logout());
    right.appendChild(chip);
  },
};
