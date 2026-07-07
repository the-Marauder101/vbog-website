// Kanban board: columns from project.statuses, drag-and-drop, task modal.

(() => {
  const projectId = new URLSearchParams(window.location.search).get("project");
  const boardEl = document.getElementById("board");
  const form = document.getElementById("task-form");

  let project = null;
  let tasks = [];
  let members = [];
  let editingTask = null; // null = creating
  let deleteArmed = false;
  const filters = { assignee: "", due: "all" };

  if (!projectId) {
    window.location.replace("index.html");
    return;
  }

  async function load() {
    try {
      [project, tasks, members] = await Promise.all([
        API.getProject(projectId),
        API.getTasks(projectId),
        API.getMembers(),
      ]);
      if (!project) {
        document.getElementById("board-title").textContent = "Project not found";
        UI.toast("This project does not exist (it may have been deleted).");
        return;
      }
      document.title = `${project.name} — VBOG PM`;
      document.getElementById("board-title").textContent = project.name;
      document.getElementById("board-desc").textContent = project.description || "";
      initFilters();
      renderBoard();
    } catch (e) {
      UI.toast(e.message);
    }
  }

  function memberName(id) {
    return members.find((m) => m.id === id)?.name || null;
  }

  function sortTasks(list) {
    // Due date ascending (overdue naturally first), tasks without a due
    // date last, ties broken by creation time. (PRD F-04)
    return [...list].sort((a, b) => {
      if (a.due_date && b.due_date && a.due_date !== b.due_date) return a.due_date < b.due_date ? -1 : 1;
      if (a.due_date && !b.due_date) return -1;
      if (!a.due_date && b.due_date) return 1;
      return a.created_at < b.created_at ? -1 : 1;
    });
  }

  // ---- Filters (assignee + due date) ----
  function initFilters() {
    const assigneeSel = document.getElementById("filter-assignee");
    // Active members plus anyone (now inactive) still assigned to a task here
    const assignedIds = new Set(tasks.map((t) => t.assignee_id).filter(Boolean));
    const options = members.filter((m) => m.active || assignedIds.has(m.id));
    assigneeSel.innerHTML =
      `<option value="">Everyone</option><option value="none">Unassigned</option>` +
      options.map((m) => `<option value="${m.id}">${UI.esc(m.name)}${m.active ? "" : " (inactive)"}</option>`).join("");

    document.getElementById("filter-due").innerHTML = UI.dateFilterOptions
      .map(([v, label]) => `<option value="${v}">${label}</option>`)
      .join("");

    assigneeSel.addEventListener("change", () => { filters.assignee = assigneeSel.value; renderBoard(); });
    document.getElementById("filter-due").addEventListener("change", (e) => {
      filters.due = e.target.value;
      renderBoard();
    });
    document.getElementById("filter-clear").addEventListener("click", () => {
      filters.assignee = "";
      filters.due = "all";
      assigneeSel.value = "";
      document.getElementById("filter-due").value = "all";
      renderBoard();
    });
  }

  function filtersActive() {
    return filters.assignee !== "" || filters.due !== "all";
  }

  function visibleTasks() {
    return tasks.filter((t) => {
      if (filters.assignee === "none" && t.assignee_id) return false;
      if (filters.assignee && filters.assignee !== "none" && t.assignee_id !== filters.assignee) return false;
      return UI.matchesDateFilter(t.due_date, filters.due);
    });
  }

  function renderBoard() {
    const shown = visibleTasks();

    // Statuses no longer in the project's list but still on tasks get their
    // own dimmed column so no task ever silently disappears.
    const orphanStatuses = [...new Set(tasks.map((t) => t.status))].filter(
      (s) => !project.statuses.includes(s)
    );

    boardEl.innerHTML = "";
    for (const status of project.statuses) renderColumn(status, false, shown);
    for (const status of orphanStatuses) renderColumn(status, true, shown);

    const clearBtn = document.getElementById("filter-clear");
    const countEl = document.getElementById("filter-count");
    clearBtn.hidden = !filtersActive();
    countEl.hidden = !filtersActive();
    countEl.textContent = filtersActive() ? `Showing ${shown.length} of ${tasks.length} tasks` : "";
    document.getElementById("filter-assignee").classList.toggle("on", filters.assignee !== "");
    document.getElementById("filter-due").classList.toggle("on", filters.due !== "all");
  }

  function renderColumn(status, isRemoved, shown) {
    const colTasks = sortTasks(shown.filter((t) => t.status === status));
    const col = document.createElement("div");
    col.className = "kanban-col" + (isRemoved ? " removed-status" : "");
    col.dataset.status = status;
    col.innerHTML = `
      <div class="col-header">
        <span class="col-title">${UI.esc(status)}${isRemoved ? ' <span class="removed-note">(removed)</span>' : ""}</span>
        <span class="col-count">${colTasks.length}</span>
      </div>
      <div class="col-tasks"></div>
      ${isRemoved ? "" : `<button class="add-task-btn" data-status="${UI.esc(status)}">+ Add Task</button>`}
    `;

    const tasksHost = col.querySelector(".col-tasks");
    for (const task of colTasks) tasksHost.appendChild(taskCard(task));

    col.querySelector(".add-task-btn")?.addEventListener("click", () => openTaskModal(null, status));

    if (!isRemoved) {
      // Drop target (removed columns are not valid statuses — no drops)
      col.addEventListener("dragover", (e) => {
        e.preventDefault();
        col.classList.add("drag-over");
      });
      col.addEventListener("dragleave", (e) => {
        if (!col.contains(e.relatedTarget)) col.classList.remove("drag-over");
      });
      col.addEventListener("drop", (e) => {
        e.preventDefault();
        col.classList.remove("drag-over");
        onDrop(e.dataTransfer.getData("text/plain"), status);
      });
    }
    boardEl.appendChild(col);
  }

  function taskCard(task) {
    const el = document.createElement("div");
    el.className = "task-card";
    el.draggable = true;
    el.dataset.id = task.id;
    const assignee = memberName(task.assignee_id);
    const initials = assignee
      ? assignee.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase()
      : "?";
    const overdue = UI.isOverdue(task.due_date);
    const notesInd = task.notes
      ? '<span class="notes-ind" title="Has notes"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h10"/></svg></span>'
      : "";
    el.innerHTML = `
      <div class="task-title">${task.source === "zapier" ? '<span class="zapier-dot" title="Created via Zapier / Google Sheets"></span>' : ""}${UI.esc(task.title)}${notesInd}</div>
      <div class="task-meta">
        <span class="assignee">
          <span class="avatar ${assignee ? "" : "unassigned"}"${assignee ? ` style="background:${UI.avatarColor(assignee)}"` : ""}>${UI.esc(initials)}</span>
          <span class="name">${UI.esc(assignee || "Unassigned")}</span>
        </span>
        ${task.due_date ? `<span class="due ${overdue ? "overdue" : ""}">${UI.fmtDate(task.due_date)}</span>` : ""}
      </div>`;

    el.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", task.id);
      e.dataTransfer.effectAllowed = "move";
      el.classList.add("dragging");
    });
    el.addEventListener("dragend", () => el.classList.remove("dragging"));
    el.addEventListener("click", () => openTaskModal(task));
    return el;
  }

  async function onDrop(taskId, newStatus) {
    const task = tasks.find((t) => t.id === taskId);
    if (!task || task.status === newStatus) return;
    // Client-side guard (PRD §13): never write a status outside the project's list
    if (!project.statuses.includes(newStatus)) {
      UI.toast("That column is not a valid status for this project.");
      return;
    }
    const oldStatus = task.status;
    task.status = newStatus; // optimistic
    renderBoard();
    try {
      await API.updateTask(taskId, { status: newStatus });
    } catch (e) {
      task.status = oldStatus; // revert
      renderBoard();
      UI.toast(`Could not move task: ${e.message}`);
    }
  }

  // ---- Task modal ----
  function fillSelects(selectedStatus, selectedAssignee) {
    const statusSel = document.getElementById("t-status");
    statusSel.innerHTML = project.statuses
      .map((s) => `<option value="${UI.esc(s)}" ${s === selectedStatus ? "selected" : ""}>${UI.esc(s)}</option>`)
      .join("");

    const assigneeSel = document.getElementById("t-assignee");
    const options = members.filter((m) => m.active || m.id === selectedAssignee);
    assigneeSel.innerHTML =
      `<option value="">Unassigned</option>` +
      options
        .map(
          (m) =>
            `<option value="${m.id}" ${m.id === selectedAssignee ? "selected" : ""}>${UI.esc(m.name)}${m.active ? "" : " (inactive)"}</option>`
        )
        .join("");
  }

  function openTaskModal(task, presetStatus) {
    editingTask = task || null;
    deleteArmed = false;
    UI.clearFieldErrors(form);

    document.getElementById("task-modal-title").textContent = task ? "Edit Task" : "New Task";
    document.getElementById("task-save").textContent = task ? "Save Changes" : "Create Task";
    document.getElementById("t-title").value = task ? task.title : "";
    document.getElementById("t-notes").value = task ? task.notes || "" : "";
    document.getElementById("t-due").value = task ? task.due_date || "" : "";
    fillSelects(task ? task.status : presetStatus, task ? task.assignee_id : "");

    const delBtn = document.getElementById("task-delete");
    delBtn.hidden = !task;
    delBtn.textContent = "Delete task";
    delBtn.classList.remove("confirming");

    UI.openModal("task-modal");
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    UI.clearFieldErrors(form);

    const titleInput = document.getElementById("t-title");
    const title = titleInput.value.trim();
    if (!title) {
      UI.fieldError(titleInput, "Title is required.");
      return;
    }

    const fields = {
      title,
      notes: document.getElementById("t-notes").value.trim() || null,
      status: document.getElementById("t-status").value,
      assignee_id: document.getElementById("t-assignee").value || null,
      due_date: document.getElementById("t-due").value || null,
    };

    try {
      if (editingTask) {
        const updated = await API.updateTask(editingTask.id, fields);
        tasks = tasks.map((t) => (t.id === updated.id ? updated : t));
        UI.toast("Task updated.", "success");
      } else {
        const created = await API.createTask({ ...fields, project_id: projectId, source: "manual" });
        tasks.push(created);
        UI.toast("Task created.", "success");
      }
      UI.closeModal("task-modal");
      renderBoard();
    } catch (err) {
      UI.toast(err.message);
    }
  });

  document.getElementById("task-delete").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    if (!deleteArmed) {
      deleteArmed = true;
      btn.textContent = "Click again to confirm";
      btn.classList.add("confirming");
      return;
    }
    try {
      await API.deleteTask(editingTask.id);
      tasks = tasks.filter((t) => t.id !== editingTask.id);
      UI.closeModal("task-modal");
      UI.toast("Task deleted.", "success");
      renderBoard();
    } catch (err) {
      UI.toast(err.message);
    }
  });

  document.getElementById("task-cancel").addEventListener("click", () => UI.closeModal("task-modal"));

  load();
})();
