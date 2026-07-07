// Team View: read-only list of one member's tasks across all projects.

(() => {
  const select = document.getElementById("member-select");
  const content = document.getElementById("team-content");

  async function loadMembers() {
    try {
      const members = await API.getMembers();
      select.innerHTML =
        `<option value="">Select a team member…</option>` +
        members
          .map((m) => `<option value="${m.id}">${UI.esc(m.name)}${m.active ? "" : " (inactive)"}</option>`)
          .join("");
    } catch (e) {
      UI.toast(e.message);
    }
  }

  async function loadTasks(memberId) {
    content.innerHTML = `<div class="loading">Loading tasks…</div>`;
    try {
      const tasks = await API.getTasksForMember(memberId);
      if (tasks.length === 0) {
        content.innerHTML = `<div class="empty-state"><p>No tasks assigned. Enjoy the quiet.</p></div>`;
        return;
      }
      content.innerHTML = `
        <table class="data-table">
          <thead>
            <tr><th>Project</th><th>Task</th><th>Status</th><th>Due date</th></tr>
          </thead>
          <tbody>
            ${tasks
              .map((t) => {
                const overdue = UI.isOverdue(t.due_date);
                return `
                  <tr class="clickable" data-project="${t.projects.id}">
                    <td>
                      <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${UI.esc(t.projects.color || "#C3CAD5")};margin-right:8px;"></span>
                      ${UI.esc(t.projects.name)}
                    </td>
                    <td>${t.source === "zapier" ? '<span class="zapier-dot" title="Created via Zapier"></span>' : ""}${UI.esc(t.title)}</td>
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
    } catch (e) {
      content.innerHTML = "";
      UI.toast(e.message);
    }
  }

  select.addEventListener("change", () => {
    if (select.value) {
      loadTasks(select.value);
    } else {
      content.innerHTML = `<div class="empty-state"><p>Pick a team member above to see their tasks.</p></div>`;
    }
  });

  loadMembers();
})();
