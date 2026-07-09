// Soft login gate: identifies who is using Vyom (localStorage), gates pages,
// and scopes what external users can see. Not real authentication — a UX gate.

const Auth = {
  KEY: "vyom_user",
  _allowed: undefined, // cached project-id allowlist for externals (null = all)

  user() {
    try {
      return JSON.parse(localStorage.getItem(Auth.KEY));
    } catch (_) {
      return null;
    }
  },

  save(member) {
    localStorage.setItem(
      Auth.KEY,
      JSON.stringify({ id: member.id, name: member.name, user_role: member.user_role })
    );
  },

  logout() {
    localStorage.removeItem(Auth.KEY);
    window.location.href = "login.html";
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
      window.location.replace("login.html");
      return false;
    }
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
    chip.querySelector(".user-logout").addEventListener("click", Auth.logout);
    right.appendChild(chip);
  },
};
