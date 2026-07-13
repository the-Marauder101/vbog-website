// js/board.js — page logic for board.html (full docs: ../ARCHITECTURE.md)
//
// Columns render from project.statuses (per-project data, not code); tasks with
// a status no longer in the list get a dimmed "(removed)" column — never hidden.
// Drag-drop updates optimistically and reverts on failure. ?task=<id> deep-links
// (from inbox notifications) open the task modal directly.
// @MENTIONS: initMentionPicker() = the @ autocomplete in the notes field;
// notifyForTask() diffs mentions against previous notes and fires inbox
// notifications (mention + task_assigned) — fire-and-forget, never blocks a save.

(() => {
  if (!Auth.requireLogin()) return;
  Auth.initNav();
  Inbox.init();

  const params = new URLSearchParams(window.location.search);
  const projectId = params.get("project");
  const openTaskId = params.get("task"); // deep link from inbox notifications
  const boardEl = document.getElementById("board");
  const form = document.getElementById("task-form");

  let project = null;
  let tasks = [];
  let members = [];
  let editingTask = null; // null = creating
  let deleteArmed = false;
  const filters = { assignee: "", due: "all", from: "", to: "" };

  if (!projectId) {
    window.location.replace("vyom.html");
    return;
  }

  async function load() {
    try {
      const allowed = await Auth.allowedProjectIds();
      if (!Auth.canSeeProject(projectId, allowed)) {
        UI.toast("You don't have access to this project.");
        setTimeout(() => window.location.replace("vyom.html"), 800);
        return;
      }
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
      document.title = `${project.name} — Vyom`;
      document.getElementById("board-title").textContent = project.name;
      document.getElementById("board-desc").textContent = project.description || "";
      if (project.parent_project_id) {
        // Awaited (unlike the purely cosmetic badge it used to be): an
        // inheriting sub-client's columns ARE the parent's statuses, so the
        // board can't render before the parent is known.
        const parent = await API.getProject(project.parent_project_id).catch(() => null);
        if (project.inherit_statuses) {
          // Local resolution only — board.js never PATCHes the project, so
          // this can't leak the parent's list into the child's stored row.
          project.statuses = UI.effectiveStatuses(project, parent);
        }
        if (parent) {
          const tag = document.createElement("a");
          tag.className = "subclient-tag";
          tag.href = `board.html?project=${parent.id}`;
          tag.title = `Open ${parent.name}'s board`;
          tag.textContent = `↰ ${parent.name}${project.inherit_statuses ? " · columns inherited" : ""}`;
          document.getElementById("board-title").appendChild(tag);
        }
      } else {
        // Parent board: quick-jump chips to each sub-client's board
        API.getSubProjects(project.id)
          .then((subs) => {
            if (allowed !== null) subs = subs.filter((s) => allowed.includes(s.id));
            if (!subs.length) return;
            const host = document.createElement("div");
            host.className = "sub-list";
            host.innerHTML =
              `<span class="sub-list-label">Sub-clients</span>` +
              subs
                .map(
                  (s) => `<a class="sub-link" href="board.html?project=${s.id}" title="Open ${UI.esc(s.name)}">
                    <span class="access-dot" style="background:${UI.esc(s.color || "#C3CAD5")}"></span><span class="sub-name">${UI.esc(s.name)}</span>
                  </a>`
                )
                .join("");
            document.getElementById("board-desc").after(host);
          })
          .catch(() => {});
      }
      if (typeof Automations !== "undefined") Automations.init(project, members);
      initFilters();
      renderBoard();
      if (openTaskId) {
        const t = tasks.find((x) => x.id === openTaskId);
        if (t) openTaskModal(t);
      }
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

    UI.enhanceSelect(assigneeSel);
    UI.enhanceSelect(document.getElementById("filter-due"));

    assigneeSel.addEventListener("change", () => { filters.assignee = assigneeSel.value; renderBoard(); });
    document.getElementById("filter-due").addEventListener("change", (e) => {
      filters.due = e.target.value;
      document.getElementById("range-inputs").hidden = filters.due !== "custom";
      renderBoard();
    });
    for (const id of ["filter-from", "filter-to"]) {
      document.getElementById(id).addEventListener("change", (e) => {
        filters[id === "filter-from" ? "from" : "to"] = e.target.value;
        renderBoard();
      });
    }
    document.getElementById("filter-clear").addEventListener("click", () => {
      Object.assign(filters, { assignee: "", due: "all", from: "", to: "" });
      assigneeSel.value = "";
      const dueSel = document.getElementById("filter-due");
      dueSel.value = "all";
      UI.syncSelect(assigneeSel);
      UI.syncSelect(dueSel);
      document.getElementById("filter-from").value = "";
      document.getElementById("filter-to").value = "";
      document.getElementById("range-inputs").hidden = true;
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
      return UI.matchesDateFilter(t.due_date, filters.due, { from: filters.from, to: filters.to });
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
    UI.syncSelect(document.getElementById("filter-assignee"));
    UI.syncSelect(document.getElementById("filter-due"));
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
      <div class="task-title">${task.source === "zapier" || task.source === "api" ? `<span class="zapier-dot" title="Created via ${task.source === "api" ? "the Vyom API" : "Zapier / Google Sheets"}"></span>` : ""}${UI.esc(task.title)}${notesInd}</div>
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

  // ---- @mention autocomplete in the notes field ----
  function initMentionPicker() {
    const ta = document.getElementById("t-notes");
    let menu = document.getElementById("mention-menu");
    if (!menu) {
      menu = document.createElement("div");
      menu.id = "mention-menu";
      menu.className = "mention-menu";
      menu.hidden = true;
      ta.parentElement.style.position = "relative";
      ta.parentElement.appendChild(menu);
    }

    function currentMentionQuery() {
      const upToCaret = ta.value.slice(0, ta.selectionStart);
      const m = upToCaret.match(/@([\w ]{0,30})$/);
      return m ? m[1] : null;
    }

    function hide() {
      menu.hidden = true;
    }

    function show() {
      const q = currentMentionQuery();
      if (q === null) return hide();
      const matches = members.filter(
        (m) => m.active && m.name.toLowerCase().startsWith(q.toLowerCase())
      );
      if (!matches.length) return hide();
      menu.innerHTML = matches
        .map(
          (m) => `
          <button type="button" class="mention-item" data-name="${UI.esc(m.name)}">
            <span class="avatar" style="background:${UI.avatarColor(m.name)}">${UI.esc(m.name[0].toUpperCase())}</span>
            ${UI.esc(m.name)}
          </button>`
        )
        .join("");
      menu.hidden = false;
      menu.querySelectorAll(".mention-item").forEach((item) => {
        item.addEventListener("mousedown", (e) => {
          e.preventDefault(); // keep textarea focus
          const upToCaret = ta.value.slice(0, ta.selectionStart);
          const rest = ta.value.slice(ta.selectionStart);
          const replaced = upToCaret.replace(/@[\w ]{0,30}$/, `@${item.dataset.name} `);
          ta.value = replaced + rest;
          ta.selectionStart = ta.selectionEnd = replaced.length;
          hide();
          ta.focus();
        });
      });
    }

    ta.addEventListener("input", show);
    ta.addEventListener("blur", () => setTimeout(hide, 150));
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Escape") hide();
      if ((e.key === "Enter" || e.key === "Tab") && !menu.hidden) {
        const first = menu.querySelector(".mention-item");
        if (first) {
          e.preventDefault();
          first.dispatchEvent(new MouseEvent("mousedown"));
        }
      }
    });
  }

  // Members whose @Name appears in `text` (longest names first so
  // "Sarika Rao" wins over a hypothetical "Sarika")
  function mentionedMembers(text) {
    if (!text) return [];
    const lower = text.toLowerCase();
    return members
      .slice()
      .sort((a, b) => b.name.length - a.name.length)
      .filter((m) => lower.includes(`@${m.name.toLowerCase()}`));
  }

  // Inbox notifications for a saved task: new mentions + new assignee.
  async function notifyForTask(task, prevNotes, prevAssignee) {
    const me = Auth.user();
    const rows = [];

    const before = new Set(mentionedMembers(prevNotes).map((m) => m.id));
    for (const m of mentionedMembers(task.notes)) {
      if (!before.has(m.id) && m.id !== me.id) {
        rows.push({
          member_id: m.id,
          kind: "mention",
          actor_id: me.id,
          task_id: task.id,
          project_id: projectId,
          message: task.title,
        });
      }
    }

    if (task.assignee_id && task.assignee_id !== prevAssignee && task.assignee_id !== me.id) {
      rows.push({
        member_id: task.assignee_id,
        kind: "task_assigned",
        actor_id: me.id,
        task_id: task.id,
        project_id: projectId,
        message: task.title,
      });
    }

    if (rows.length) {
      try {
        await API.notify(rows);
      } catch (_) { /* notifications are best-effort; never block a save */ }
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
    UI.enhanceSelect(document.getElementById("t-status"));
    UI.enhanceSelect(assigneeSel);
  }

  function openTaskModal(task, presetStatus) {
    editingTask = task || null;
    deleteArmed = false;
    UI.clearFieldErrors(form);

    document.getElementById("task-modal-title").textContent = task ? "Edit Task" : "New Task";
    document.getElementById("task-save").textContent = task ? "Save Changes" : "Create Task";
    document.getElementById("t-title").value = task ? task.title : "";
    document.getElementById("t-notes").value = task ? task.notes || "" : "";
    document.getElementById("t-email").value = task ? task.fields?.email || "" : "";
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

    const emailInput = document.getElementById("t-email");
    const email = emailInput.value.trim();
    if (email && !/^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(email)) {
      UI.fieldError(emailInput, "That doesn't look like a valid email address.");
      return;
    }
    // Merge into the task's fields container — future keys (doc URLs etc.)
    // survive an email edit untouched.
    const customFields = { ...(editingTask?.fields || {}) };
    if (email) customFields.email = email;
    else delete customFields.email;

    const fields = {
      title,
      notes: document.getElementById("t-notes").value.trim() || null,
      status: document.getElementById("t-status").value,
      assignee_id: document.getElementById("t-assignee").value || null,
      due_date: document.getElementById("t-due").value || null,
      fields: customFields,
    };

    try {
      if (editingTask) {
        const prevNotes = editingTask.notes;
        const prevAssignee = editingTask.assignee_id;
        const updated = await API.updateTask(editingTask.id, fields);
        tasks = tasks.map((t) => (t.id === updated.id ? updated : t));
        UI.toast("Task updated.", "success");
        notifyForTask(updated, prevNotes, prevAssignee);
      } else {
        const created = await API.createTask({ ...fields, project_id: projectId, source: "manual" });
        tasks.push(created);
        UI.toast("Task created.", "success");
        notifyForTask(created, null, null);
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

  initMentionPicker();
  load();
})();
