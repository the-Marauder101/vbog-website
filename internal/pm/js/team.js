// js/team.js — page logic for team.html, the All Tasks view (docs: ../ARCHITECTURE.md)
//
// Master list of every task across active projects (externals: only their
// granted projects). Filters: project, assignee, due-date presets + custom
// range, title search. Read-only — click a row to open its board.

(() => {
  if (!Auth.requireLogin()) return;
  Auth.initNav();
  Inbox.init();

  const content = document.getElementById("tasks-content");
  const filters = { project: "", assignee: "", client: "", due: "all", q: "", from: "", to: "" };
  let tasks = []; // rows with embedded `projects` object
  let members = [];
  // Sub-client tasks (projects with a parent) are OUT of this view and its
  // counts by default — they belong to a client's own clients, not to us.
  // View preference, not a filter: persisted, and ignored by "Clear filters".
  let showSubclients = localStorage.getItem("vyom_show_subclients") === "1";

  async function load() {
    try {
      const allowed = await Auth.allowedProjectIds();
      [tasks, members] = await Promise.all([API.getAllTasks(), API.getMembers()]);
      if (allowed !== null) tasks = tasks.filter((t) => allowed.includes(t.project_id));
      initFilters();
      render();
    } catch (e) {
      content.innerHTML = "";
      UI.toast(e.message);
    }
  }

  function memberName(id) {
    return members.find((m) => m.id === id)?.name || null;
  }

  function initFilters() {
    const subToggle = document.getElementById("show-subclients");
    subToggle.checked = showSubclients;
    subToggle.addEventListener("change", () => {
      showSubclients = subToggle.checked;
      localStorage.setItem("vyom_show_subclients", showSubclients ? "1" : "0");
      render();
    });
    // Hide the toggle entirely when there are no sub-client projects yet
    subToggle.parentElement.hidden = !tasks.some((t) => t.projects.parent_project_id);

    const projects = [...new Map(tasks.map((t) => [t.projects.id, t.projects])).values()]
      .sort((a, b) => a.name.localeCompare(b.name));
    document.getElementById("filter-project").innerHTML =
      `<option value="">All projects</option>` +
      projects.map((p) => `<option value="${p.id}">${UI.esc(p.name)}</option>`).join("");

    const assignedIds = new Set(tasks.map((t) => t.assignee_id).filter(Boolean));
    const options = members.filter((m) => m.active || assignedIds.has(m.id));
    document.getElementById("filter-assignee").innerHTML =
      `<option value="">Everyone</option><option value="none">Unassigned</option>` +
      options.map((m) => `<option value="${m.id}">${UI.esc(m.name)}${m.active ? "" : " (inactive)"}</option>`).join("");

    // Client tags (tasks.fields.client) — dropdown hides when nothing uses them
    const clientSel = document.getElementById("filter-client");
    const clientNames = [...new Set(tasks.map((t) => t.fields?.client).filter(Boolean))].sort(
      (a, b) => a.localeCompare(b)
    );
    clientSel.innerHTML =
      `<option value="">All clients</option><option value="none">No client</option>` +
      clientNames.map((n) => `<option value="${UI.esc(n)}">${UI.esc(n)}</option>`).join("");

    document.getElementById("filter-due").innerHTML = UI.dateFilterOptions
      .map(([v, label]) => `<option value="${v}">${label}</option>`)
      .join("");

    for (const id of ["filter-project", "filter-assignee", "filter-client", "filter-due"]) {
      UI.enhanceSelect(document.getElementById(id));
    }
    clientSel.closest(".dd").hidden = clientNames.length === 0;

    const bind = (id, key) =>
      document.getElementById(id).addEventListener(id === "filter-search" ? "input" : "change", (e) => {
        filters[key] = e.target.value;
        if (key === "due") document.getElementById("range-inputs").hidden = filters.due !== "custom";
        render();
      });
    bind("filter-project", "project");
    bind("filter-assignee", "assignee");
    bind("filter-client", "client");
    bind("filter-due", "due");
    bind("filter-search", "q");
    bind("filter-from", "from");
    bind("filter-to", "to");

    document.getElementById("filter-clear").addEventListener("click", () => {
      Object.assign(filters, { project: "", assignee: "", client: "", due: "all", q: "", from: "", to: "" });
      for (const [id, v] of [["filter-project", ""], ["filter-assignee", ""], ["filter-client", ""], ["filter-due", "all"]]) {
        const el = document.getElementById(id);
        el.value = v;
        UI.syncSelect(el);
      }
      document.getElementById("filter-search").value = "";
      document.getElementById("filter-from").value = "";
      document.getElementById("filter-to").value = "";
      document.getElementById("range-inputs").hidden = true;
      render();
    });
  }

  function filtersActive() {
    return (
      filters.project !== "" ||
      filters.assignee !== "" ||
      filters.client !== "" ||
      filters.due !== "all" ||
      filters.q !== ""
    );
  }

  // The working set: everything, minus sub-client tasks unless included.
  // All counts ("X of Y") are computed against this, so sub-client work
  // never inflates totals or reports while the toggle is off.
  function baseTasks() {
    return showSubclients ? tasks : tasks.filter((t) => !t.projects.parent_project_id);
  }

  function visibleTasks() {
    const q = filters.q.trim().toLowerCase();
    return baseTasks().filter((t) => {
      if (filters.project && t.projects.id !== filters.project) return false;
      if (filters.assignee === "none" && t.assignee_id) return false;
      if (filters.assignee && filters.assignee !== "none" && t.assignee_id !== filters.assignee) return false;
      if (filters.client === "none" && t.fields?.client) return false;
      if (filters.client && filters.client !== "none" && t.fields?.client !== filters.client) return false;
      if (!UI.matchesDateFilter(t.due_date, filters.due, { from: filters.from, to: filters.to })) return false;
      if (q && !t.title.toLowerCase().includes(q)) return false;
      return true;
    });
  }

  function render() {
    const shown = visibleTasks();
    const base = baseTasks();
    for (const [id, active] of [
      ["filter-project", filters.project !== ""],
      ["filter-assignee", filters.assignee !== ""],
      ["filter-client", filters.client !== ""],
      ["filter-due", filters.due !== "all"],
    ]) {
      const el = document.getElementById(id);
      el.classList.toggle("on", active);
      UI.syncSelect(el);
    }
    document.getElementById("filter-clear").hidden = !filtersActive();
    document.getElementById("filter-count").textContent = filtersActive()
      ? `Showing ${shown.length} of ${base.length} tasks`
      : `${base.length} task${base.length === 1 ? "" : "s"}`;

    if (shown.length === 0) {
      content.innerHTML = `<div class="empty-state"><p>${
        base.length === 0 ? "No tasks yet — create some from a project board." : "No tasks match these filters."
      }</p></div>`;
      return;
    }

    content.innerHTML = `
      <table class="data-table">
        <thead>
          <tr><th>Project</th><th>Task</th><th>Assignee</th><th>Status</th><th>Due date</th></tr>
        </thead>
        <tbody>
          ${shown
            .map((t) => {
              const overdue = UI.isOverdue(t.due_date);
              const assignee = memberName(t.assignee_id);
              return `
                <tr class="clickable" data-project="${t.projects.id}">
                  <td>
                    <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${UI.esc(t.projects.color || "#C3CAD5")};margin-right:8px;"></span>
                    ${UI.esc(t.projects.name)}${t.projects.parent_project_id ? ' <span class="subclient-tag">sub-client</span>' : ""}
                  </td>
                  <td>${t.source === "zapier" || t.source === "api" ? `<span class="zapier-dot" title="Created via ${t.source === "api" ? "the Vyom API" : "Zapier"}"></span>` : ""}${UI.esc(t.title)}${t.fields?.client ? ` <span class="client-chip" title="Client">${UI.esc(t.fields.client)}</span>` : ""}</td>
                  <td>${
                    assignee
                      ? `<span class="avatar" style="background:${UI.avatarColor(assignee)};margin-right:7px;">${UI.esc(assignee.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase())}</span>${UI.esc(assignee)}`
                      : '<span style="color:var(--muted)">Unassigned</span>'
                  }</td>
                  <td><span class="status-chip">${UI.esc(t.status)}</span></td>
                  <td class="${overdue ? "due overdue" : "due"}">${t.due_date ? UI.fmtDate(t.due_date) : "—"}</td>
                </tr>`;
            })
            .join("")}
        </tbody>
      </table>
      <div class="form-hint" style="margin-top: 12px;">Read-only view — click a row to open its project board and edit there.</div>`;

    content.querySelectorAll("tr.clickable").forEach((row) => {
      row.addEventListener("click", () => {
        window.location.href = `board.html?project=${row.dataset.project}`;
      });
    });
  }

  load();
})();
