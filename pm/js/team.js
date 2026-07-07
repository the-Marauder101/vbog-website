// All Tasks: master list of every task across every active project.
// Read-only with filters — click a row to open its project board.

(() => {
  const content = document.getElementById("tasks-content");
  const filters = { project: "", assignee: "", due: "all", q: "" };
  let tasks = []; // rows with embedded `projects` object
  let members = [];

  async function load() {
    try {
      [tasks, members] = await Promise.all([API.getAllTasks(), API.getMembers()]);
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

    document.getElementById("filter-due").innerHTML = UI.dateFilterOptions
      .map(([v, label]) => `<option value="${v}">${label}</option>`)
      .join("");

    const bind = (id, key) =>
      document.getElementById(id).addEventListener(id === "filter-search" ? "input" : "change", (e) => {
        filters[key] = e.target.value;
        render();
      });
    bind("filter-project", "project");
    bind("filter-assignee", "assignee");
    bind("filter-due", "due");
    bind("filter-search", "q");

    document.getElementById("filter-clear").addEventListener("click", () => {
      Object.assign(filters, { project: "", assignee: "", due: "all", q: "" });
      document.getElementById("filter-project").value = "";
      document.getElementById("filter-assignee").value = "";
      document.getElementById("filter-due").value = "all";
      document.getElementById("filter-search").value = "";
      render();
    });
  }

  function filtersActive() {
    return filters.project !== "" || filters.assignee !== "" || filters.due !== "all" || filters.q !== "";
  }

  function visibleTasks() {
    const q = filters.q.trim().toLowerCase();
    return tasks.filter((t) => {
      if (filters.project && t.projects.id !== filters.project) return false;
      if (filters.assignee === "none" && t.assignee_id) return false;
      if (filters.assignee && filters.assignee !== "none" && t.assignee_id !== filters.assignee) return false;
      if (!UI.matchesDateFilter(t.due_date, filters.due)) return false;
      if (q && !t.title.toLowerCase().includes(q)) return false;
      return true;
    });
  }

  function render() {
    const shown = visibleTasks();
    document.getElementById("filter-project").classList.toggle("on", filters.project !== "");
    document.getElementById("filter-assignee").classList.toggle("on", filters.assignee !== "");
    document.getElementById("filter-due").classList.toggle("on", filters.due !== "all");
    document.getElementById("filter-clear").hidden = !filtersActive();
    document.getElementById("filter-count").textContent = filtersActive()
      ? `Showing ${shown.length} of ${tasks.length} tasks`
      : `${tasks.length} task${tasks.length === 1 ? "" : "s"}`;

    if (shown.length === 0) {
      content.innerHTML = `<div class="empty-state"><p>${
        tasks.length === 0 ? "No tasks yet — create some from a project board." : "No tasks match these filters."
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
                    ${UI.esc(t.projects.name)}
                  </td>
                  <td>${t.source === "zapier" ? '<span class="zapier-dot" title="Created via Zapier"></span>' : ""}${UI.esc(t.title)}</td>
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
