// js/board.js — page logic for board.html (full docs: ../ARCHITECTURE.md)
//
// Columns render from project.statuses (per-project data, not code); tasks with
// a status no longer in the list get a dimmed "(removed)" column — never hidden.
// Drag-drop updates optimistically and reverts on failure. ?task=<id> deep-links
// (from inbox notifications) open the task modal directly.
// @MENTIONS: initMentionPicker() = the @ autocomplete in the notes field;
// notifyForTask() diffs mentions against previous notes and fires inbox
// notifications (mention + task_assigned) — fire-and-forget, never blocks a save.
// HIDDEN COLUMNS: an admin folds a column away for the whole project
// (projects.hidden_statuses); everyone else folds it away just for themselves
// (localStorage). Both are view state — no task is ever moved or deleted, and
// the "N columns hidden" pill keeps that honest. See §10 of the handbook.
// STAGE DATE: HR cards have no due date. They show tasks.status_changed_at —
// the moment the card entered the stage it's in — which is read-only by design.

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
  const filters = { assignee: "", client: "", due: "all", from: "", to: "" };
  let activeTab = "hiring"; // "hiring" | "ops" (only matters for HR projects with board_tabs)
  // Personal hidden columns: {hiring: [...], ops: [...]} of status NAMES, per
  // project, per browser. Names not indexes — status lists get reordered.
  const HIDE_KEY = `vyom_hidden_cols_${projectId}`;
  let myHidden = loadMyHidden();

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
      if (typeof Changelog !== "undefined") Changelog.initBoard(project);
      if (typeof Reports !== "undefined") Reports.init(project, members);
      initColumnsControl();
      // HR features
      if (hasFeature("board_tabs")) initBoardTabs();
      if (hasFeature("roles_card") && typeof HrRoles !== "undefined") HrRoles.init(project);
      if (hasFeature("clients_card") && typeof HrClients !== "undefined") HrClients.init(project);
      if (hasFeature("roles_card") || hasFeature("clients_card")) initHrTableTabs();
      // Awaited on purpose: SLA rules have to be in memory before the first
      // renderBoard(), or no card is flagged until something re-renders.
      if (hasFeature("sla") && typeof HrSla !== "undefined") await HrSla.init(project, members);
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

  // ---- HR feature helpers ----
  function hasFeature(key) {
    return UI.hasFeature(project, key);
  }

  // ---- Stage Date (HR): the read-only replacement for a due date ----
  // For an existing card the mode follows the card itself (Ops-tab work keeps
  // real due dates); for a card being created it follows the tab we're on.
  function stageMode(task) {
    return UI.stageDateMode(
      project,
      task || { fields: { hr_category: activeTab === "ops" ? "ops" : "candidate" } }
    );
  }

  // ---- Hidden status columns ----
  function loadMyHidden() {
    try {
      const raw = JSON.parse(localStorage.getItem(HIDE_KEY));
      return {
        hiring: Array.isArray(raw?.hiring) ? raw.hiring : [],
        ops: Array.isArray(raw?.ops) ? raw.ops : [],
      };
    } catch (_) {
      return { hiring: [], ops: [] };
    }
  }

  function saveMyHidden() {
    try {
      localStorage.setItem(HIDE_KEY, JSON.stringify(myHidden));
    } catch (_) { /* private mode / quota — the board still works, just unsaved */ }
  }

  const tabKey = () => (hasFeature("board_tabs") && activeTab === "ops" ? "ops" : "hiring");

  // Set by an admin, applies to everyone. The column may not exist yet on
  // pre-migration rows, hence the array guards.
  function projectHidden() {
    const raw = tabKey() === "ops" ? project?.hidden_ops_statuses : project?.hidden_statuses;
    return Array.isArray(raw) ? raw : [];
  }

  const myHiddenList = () => myHidden[tabKey()] || [];

  // What the current user doesn't see: the project's hidden set plus their own.
  function hiddenStatuses() {
    return [...new Set([...projectHidden(), ...myHiddenList()])];
  }

  const isHidden = (status) => hiddenStatuses().includes(status);

  // Has the 14 migration been applied? Until it has, only personal hiding
  // works — same graceful degradation as the sub-client/inherit guards.
  const hiddenColExists = () => !!project && "hidden_statuses" in project;

  function activeStatuses() {
    if (hasFeature("board_tabs") && activeTab === "ops") {
      return project.ops_statuses?.length ? project.ops_statuses : ["To Do", "In Progress", "Done"];
    }
    return project.statuses;
  }

  function isHiringTab() { return !hasFeature("board_tabs") || activeTab === "hiring"; }

  function taskMatchesTab(task) {
    if (!hasFeature("board_tabs")) return true;
    const cat = task.fields?.hr_category;
    if (activeTab === "ops") return cat === "ops";
    return cat !== "ops";
  }

  function initBoardTabs() {
    const tabBar = document.getElementById("board-tabs");
    if (!tabBar) return;
    tabBar.hidden = false;
    tabBar.querySelectorAll(".board-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        activeTab = btn.dataset.tab;
        tabBar.querySelectorAll(".board-tab").forEach((b) => b.classList.toggle("active", b === btn));
        // Hiring uses Stage Dates, Ops uses due dates — the date filter has to
        // be rebuilt for the tab we just moved to.
        fillDateFilter();
        // Show/hide roles card on tab switch
        // The HR tables belong to the hiring side of the board only.
        const card = document.getElementById("hr-roles-card");
        if (card) card.hidden = activeTab !== "hiring" || !(hasFeature("roles_card") || hasFeature("clients_card"));
        renderBoard();
      });
    });
  }

  // ---- Columns modal (show / hide status columns) ----
  // Admins change the project's own hidden set, so the whole team sees the
  // same tidied board. Everyone else changes their personal set. That split is
  // the whole design: one shared decision, plus a private one on top of it.
  function adminScope() {
    return Auth.isAdmin() && hiddenColExists();
  }

  function initColumnsControl() {
    document.getElementById("columns-btn").addEventListener("click", openColumnsModal);
    document.getElementById("cols-close").addEventListener("click", () => UI.closeModal("columns-modal"));
    document.getElementById("hidden-cols-pill").addEventListener("click", openColumnsModal);
    document.getElementById("cols-show-all").addEventListener("click", async () => {
      myHidden[tabKey()] = [];
      saveMyHidden();
      if (adminScope() && projectHidden().length) {
        await setProjectHidden([]);
      }
      renderColumnsList();
      renderBoard();
    });
  }

  // Persist the project-level set (admins only). Optimistic like every other
  // write here: update in place, revert on failure.
  async function setProjectHidden(list) {
    const key = tabKey() === "ops" ? "hidden_ops_statuses" : "hidden_statuses";
    const prev = projectHidden();
    project[key] = list;
    renderBoard();
    try {
      await API.updateProject(project.id, { [key]: list });
    } catch (e) {
      project[key] = prev;
      renderColumnsList();
      renderBoard();
      UI.toast(`Could not save hidden columns: ${e.message}`);
    }
  }

  function openColumnsModal() {
    document.getElementById("cols-scope-note").innerHTML = adminScope()
      ? "You're an admin, so hiding a column here hides it <strong>for everyone</strong> on this project."
      : hiddenColExists()
        ? "Hiding a column here affects <strong>only you</strong>, in this browser. Columns an admin has hidden for the whole project are marked below."
        : "Hiding a column here affects <strong>only you</strong>, in this browser. (Project-wide hiding needs the 14_hidden_statuses_changelog.sql migration.)";
    renderColumnsList();
    UI.openModal("columns-modal");
  }

  function renderColumnsList() {
    const host = document.getElementById("cols-list");
    const tabTasks = tasks.filter(taskMatchesTab);
    const statuses = activeStatuses();
    const byAdmin = projectHidden();
    host.innerHTML = statuses
      .map((s) => {
        const n = tabTasks.filter((t) => t.status === s).length;
        // A non-admin can't undo an admin's decision — the row explains why
        // rather than silently doing nothing when clicked.
        const locked = !adminScope() && byAdmin.includes(s);
        const visible = !isHidden(s);
        return `
          <label class="cols-row${locked ? " locked" : ""}">
            <input type="checkbox" data-col-status="${UI.esc(s)}" ${visible ? "checked" : ""} ${locked ? "disabled" : ""}>
            <span class="cols-name">${UI.esc(s)}</span>
            <span class="cols-count">${n} task${n === 1 ? "" : "s"}</span>
            ${locked ? '<span class="cols-note">hidden for everyone</span>' : ""}
          </label>`;
      })
      .join("");

    host.querySelectorAll("[data-col-status]").forEach((cb) => {
      cb.addEventListener("change", () => onColumnToggle(cb));
    });
  }

  async function onColumnToggle(cb) {
    const status = cb.dataset.colStatus;
    const hide = !cb.checked;
    // Never let the board become empty — an all-hidden board looks broken.
    if (hide && activeStatuses().filter((s) => !isHidden(s)).length <= 1) {
      cb.checked = true;
      UI.toast("At least one column has to stay visible.");
      return;
    }
    if (adminScope()) {
      const next = hide
        ? [...projectHidden(), status]
        : projectHidden().filter((s) => s !== status);
      await setProjectHidden(next);
      // An admin unhiding a column shouldn't have it stay hidden by their own
      // older personal setting.
      if (!hide) {
        myHidden[tabKey()] = myHiddenList().filter((s) => s !== status);
        saveMyHidden();
      }
    } else {
      myHidden[tabKey()] = hide
        ? [...myHiddenList(), status]
        : myHiddenList().filter((s) => s !== status);
      saveMyHidden();
    }
    renderColumnsList();
    renderBoard();
  }

  // Roles Summary and the Client Tracker share one card. Only the tabs the
  // project actually has are shown, so a board with one of them shows no tabs
  // at all rather than a single pointless one.
  function initHrTableTabs() {
    const card = document.getElementById("hr-roles-card");
    const tabs = document.getElementById("hr-table-tabs");
    if (!card || !tabs) return;
    card.hidden = false;
    const has = { roles: hasFeature("roles_card"), clients: hasFeature("clients_card") };
    tabs.querySelectorAll(".hr-table-tab").forEach((btn) => {
      btn.hidden = !has[btn.dataset.table];
      btn.addEventListener("click", () => showHrTable(btn.dataset.table));
    });
    tabs.hidden = !(has.roles && has.clients);
    showHrTable(has.roles ? "roles" : "clients");
  }

  function showHrTable(which) {
    for (const [name, panel, actions] of [
      ["roles", "hr-roles-panel", "hr-roles-actions"],
      ["clients", "hr-clients-panel", "hr-clients-actions"],
    ]) {
      document.getElementById(panel).hidden = name !== which;
      document.getElementById(actions).hidden = name !== which;
    }
    document
      .querySelectorAll("#hr-table-tabs .hr-table-tab")
      .forEach((b) => b.classList.toggle("active", b.dataset.table === which));
  }

  function memberName(id) {
    return members.find((m) => m.id === id)?.name || null;
  }

  function sortTasks(list) {
    // Stage-date columns sort oldest-first: the card that has sat in this
    // stage longest is the one that needs attention, which is exactly what
    // the SLA flags are about.
    if (stageMode(list[0])) {
      return [...list].sort((a, b) =>
        String(UI.stageDateTs(a)) < String(UI.stageDateTs(b)) ? -1 : 1
      );
    }
    // Due date ascending (overdue naturally first), tasks without a due
    // date last, ties broken by creation time. (PRD F-04)
    return [...list].sort((a, b) => {
      if (a.due_date && b.due_date && a.due_date !== b.due_date) return a.due_date < b.due_date ? -1 : 1;
      if (a.due_date && !b.due_date) return -1;
      if (!a.due_date && b.due_date) return 1;
      return a.created_at < b.created_at ? -1 : 1;
    });
  }

  // ---- Client tags (stored in tasks.fields.client — no extra table) ----
  // Distinct client names used in this project, for the filter + datalist
  function clientNames() {
    return [...new Set(tasks.map((t) => t.fields?.client).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b)
    );
  }

  // (Re)build the client filter's options. Called at load and after every
  // task save/delete, since those can introduce or retire a client name.
  // The whole dropdown hides when the project doesn't use client tags.
  function refreshClientFilter() {
    const sel = document.getElementById("filter-client");
    const names = clientNames();
    sel.innerHTML =
      `<option value="">All clients</option><option value="none">No client</option>` +
      names.map((n) => `<option value="${UI.esc(n)}">${UI.esc(n)}</option>`).join("");
    sel.value = names.includes(filters.client) || filters.client === "none" ? filters.client : "";
    filters.client = sel.value;
    UI.enhanceSelect(sel);
    sel.closest(".dd").hidden = names.length === 0;
  }

  // ---- The date filter changes meaning with the board ----
  // Due dates on a normal board; Stage Dates on an HR hiring tab, where
  // "Overdue" would be nonsense. Same control either way — it is rebuilt when
  // the mode changes (i.e. on the HR tab switch), and a selection that has no
  // meaning in the new vocabulary falls back to "all" rather than silently
  // filtering everything out.
  function fillDateFilter() {
    const sel = document.getElementById("filter-due");
    const stage = stageMode();
    const opts = stage ? UI.stageFilterOptions : UI.dateFilterOptions;
    if (!opts.some(([v]) => v === filters.due)) {
      filters.due = "all";
      filters.from = "";
      filters.to = "";
      document.getElementById("filter-from").value = "";
      document.getElementById("filter-to").value = "";
    }
    sel.innerHTML = opts
      .map(([v, label]) => `<option value="${v}" ${v === filters.due ? "selected" : ""}>${UI.esc(label)}</option>`)
      .join("");
    const aria = stage ? "Filter by stage date" : "Filter by due date";
    sel.setAttribute("aria-label", aria);
    UI.enhanceSelect(sel);
    sel.closest(".dd")?.querySelector(".dd-btn")?.setAttribute("aria-label", aria);
    document.getElementById("range-inputs").hidden = filters.due !== "custom";
  }

  // ---- Filters (assignee + client + due date) ----
  function initFilters() {
    refreshClientFilter();
    document.getElementById("filter-client").addEventListener("change", (e) => {
      filters.client = e.target.value;
      renderBoard();
    });
    const assigneeSel = document.getElementById("filter-assignee");
    // Active members plus anyone (now inactive) still assigned to a task here
    const assignedIds = new Set(tasks.map((t) => t.assignee_id).filter(Boolean));
    const options = members.filter((m) => m.active || assignedIds.has(m.id));
    assigneeSel.innerHTML =
      `<option value="">Everyone</option><option value="none">Unassigned</option>` +
      options.map((m) => `<option value="${m.id}">${UI.esc(m.name)}${m.active ? "" : " (inactive)"}</option>`).join("");

    fillDateFilter();

    UI.enhanceSelect(assigneeSel);

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
      Object.assign(filters, { assignee: "", client: "", due: "all", from: "", to: "" });
      assigneeSel.value = "";
      const clientSel = document.getElementById("filter-client");
      clientSel.value = "";
      const dueSel = document.getElementById("filter-due");
      dueSel.value = "all";
      UI.syncSelect(assigneeSel);
      UI.syncSelect(clientSel);
      UI.syncSelect(dueSel);
      document.getElementById("filter-from").value = "";
      document.getElementById("filter-to").value = "";
      document.getElementById("range-inputs").hidden = true;
      renderBoard();
    });
  }

  function filtersActive() {
    return filters.assignee !== "" || filters.client !== "" || filters.due !== "all";
  }

  function visibleTasks() {
    return tasks.filter((t) => {
      if (filters.assignee === "none" && t.assignee_id) return false;
      if (filters.assignee && filters.assignee !== "none" && t.assignee_id !== filters.assignee) return false;
      if (filters.client === "none" && t.fields?.client) return false;
      if (filters.client && filters.client !== "none" && t.fields?.client !== filters.client) return false;
      return UI.matchesDateFilter(t.due_date, filters.due, { from: filters.from, to: filters.to });
    });
  }

  function renderBoard() {
    const tabTasks = tasks.filter(taskMatchesTab);
    // Every filter is ANDed — assignee AND client AND date all narrow together.
    const range = { from: filters.from, to: filters.to };
    const byStage = stageMode();
    const shown = tabTasks.filter((t) => {
      if (filters.assignee === "none" && t.assignee_id) return false;
      if (filters.assignee && filters.assignee !== "none" && t.assignee_id !== filters.assignee) return false;
      if (filters.client === "none" && t.fields?.client) return false;
      if (filters.client && filters.client !== "none" && t.fields?.client !== filters.client) return false;
      return byStage
        ? UI.matchesStageFilter(UI.stageDateIso(t), filters.due, range)
        : UI.matchesDateFilter(t.due_date, filters.due, range);
    });

    const statuses = activeStatuses();
    const hidden = hiddenStatuses();
    // Statuses no longer in the active list but still on tasks get their
    // own dimmed column so no task ever silently disappears. Orphans are
    // never hideable — they're already the exception that needs looking at.
    const orphanStatuses = [...new Set(tabTasks.map((t) => t.status))].filter(
      (s) => !statuses.includes(s)
    );

    boardEl.innerHTML = "";
    for (const status of statuses) {
      if (hidden.includes(status)) continue;
      renderColumn(status, false, shown);
    }
    for (const status of orphanStatuses) renderColumn(status, true, shown);

    // Hidden columns are a view choice, so say so out loud and make it one
    // click to get them back. The count of parked tasks is part of the point.
    const hiddenHere = statuses.filter((s) => hidden.includes(s));
    const pill = document.getElementById("hidden-cols-pill");
    const parkedTasks = tabTasks.filter((t) => hiddenHere.includes(t.status));
    // An SLA breach inside a folded-away column would otherwise be invisible —
    // exactly the thing SLA rules exist to prevent. Surface the count.
    const parkedFlagged =
      hasFeature("sla") && isHiringTab() && typeof HrSla !== "undefined"
        ? parkedTasks.filter((t) => ["warning", "breach"].includes(HrSla.slaState(t)?.level)).length
        : 0;
    pill.hidden = hiddenHere.length === 0;
    pill.textContent =
      `${hiddenHere.length} column${hiddenHere.length === 1 ? "" : "s"} hidden` +
      (parkedTasks.length ? ` · ${parkedTasks.length} task${parkedTasks.length === 1 ? "" : "s"}` : "") +
      (parkedFlagged ? ` · ${parkedFlagged} SLA-flagged` : "");
    pill.classList.toggle("has-flagged", parkedFlagged > 0);
    pill.title =
      `Hidden: ${hiddenHere.join(", ")} — click to manage` +
      (parkedFlagged
        ? `\n${parkedFlagged} card${parkedFlagged === 1 ? " is" : "s are"} past or near an SLA deadline in a hidden column.`
        : "");

    const clearBtn = document.getElementById("filter-clear");
    const countEl = document.getElementById("filter-count");
    clearBtn.hidden = !filtersActive();
    countEl.hidden = !filtersActive();
    countEl.textContent = filtersActive() ? `Showing ${shown.length} of ${tabTasks.length} tasks` : "";
    document.getElementById("filter-assignee").classList.toggle("on", filters.assignee !== "");
    document.getElementById("filter-client").classList.toggle("on", filters.client !== "");
    document.getElementById("filter-due").classList.toggle("on", filters.due !== "all");
    UI.syncSelect(document.getElementById("filter-assignee"));
    UI.syncSelect(document.getElementById("filter-client"));
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
    const stage = stageMode(task);
    const stageIso = stage ? UI.stageDateIso(task) : null;
    // Stage date pill: a measurement, never a deadline, so it never turns red.
    const dateChip = stage
      ? stageIso
        ? `<span class="stage-pill" title="In this stage since ${UI.esc(UI.fmtDateTime(UI.stageDateTs(task)))}">${UI.stageIcon}${UI.esc(UI.fmtDate(stageIso))}</span>`
        : ""
      : task.due_date
        ? `<span class="due ${overdue ? "overdue" : ""}">${UI.fmtDate(task.due_date)}</span>`
        : "";
    const notesInd = task.notes
      ? '<span class="notes-ind" title="Has notes"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h10"/></svg></span>'
      : "";
    el.innerHTML = `
      <div class="task-title">${task.source === "zapier" || task.source === "api" ? `<span class="zapier-dot" title="Created via ${task.source === "api" ? "the Vyom API" : "Zapier / Google Sheets"}"></span>` : ""}${UI.esc(task.title)}${notesInd}</div>
      ${task.fields?.client ? `<div class="task-client"><span class="client-chip" title="Client">${UI.esc(task.fields.client)}</span></div>` : ""}
      <div class="task-meta">
        <span class="assignee">
          <span class="avatar ${assignee ? "" : "unassigned"}"${assignee ? ` style="background:${UI.avatarColor(assignee)}"` : ""}>${UI.esc(initials)}</span>
          <span class="name">${UI.esc(assignee || "Unassigned")}</span>
        </span>
        ${dateChip}
      </div>`;

    if (hasFeature("sla") && isHiringTab() && typeof HrSla !== "undefined") {
      const sla = HrSla.slaState(task);
      if (sla?.level === "warning") el.classList.add("sla-warning");
      if (sla?.level === "breach") el.classList.add("sla-breach");
    }

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
    if (!activeStatuses().includes(newStatus)) {
      UI.toast("That column is not a valid status for this project.");
      return;
    }
    const oldStatus = task.status;
    task.status = newStatus; // optimistic
    // The Stage Date IS the move date, so show it immediately rather than
    // leaving yesterday's date on a card that just moved.
    const oldStageTs = task.status_changed_at;
    task.status_changed_at = new Date().toISOString();
    renderBoard();
    try {
      const updated = await API.updateTask(taskId, { status: newStatus });
      // Take the server's timestamp, but only if the user hasn't moved this
      // card again in the meantime (handbook §5.6).
      if (updated && task.status === newStatus) {
        task.status_changed_at = updated.status_changed_at;
      }
    } catch (e) {
      task.status = oldStatus; // revert
      task.status_changed_at = oldStageTs;
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
    // Hidden columns stay selectable — hiding a column must never stop you
    // from filing a card in it — but they're labelled so the card doesn't
    // seem to vanish afterwards.
    statusSel.innerHTML = activeStatuses()
      .map(
        (s) =>
          `<option value="${UI.esc(s)}" ${s === selectedStatus ? "selected" : ""}>${UI.esc(s)}${isHidden(s) ? " (hidden)" : ""}</option>`
      )
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
    document.getElementById("t-client").value = task ? task.fields?.client || "" : "";
    // Suggest client names already used in this project (free text still allowed)
    document.getElementById("t-client-list").innerHTML = clientNames()
      .map((n) => `<option value="${UI.esc(n)}"></option>`)
      .join("");
    document.getElementById("t-email").value = task ? task.fields?.email || "" : "";

    // Due date vs Stage Date: exactly one of the two groups is ever shown.
    const stage = stageMode(task);
    document.getElementById("t-due-group").hidden = stage;
    document.getElementById("t-stage-group").hidden = !stage;
    document.getElementById("t-due").value = task ? task.due_date || "" : "";
    if (stage) {
      const ts = task ? UI.stageDateTs(task) : null;
      document.getElementById("t-stage-date").textContent = task
        ? UI.fmtDateTime(ts) || "—"
        : "Set when you create this card";
      document.getElementById("t-stage-hint").textContent = task
        ? "Set automatically — it becomes the date of the move every time this card changes status. Not editable by hand; see History below for every previous stage."
        : "This card's Stage Date will be right now, and will update itself each time the card moves to another status.";
    }

    fillSelects(task ? task.status : presetStatus, task ? task.assignee_id : "");

    // History: collapsed by default and loaded only when opened, so the modal
    // stays as fast as it was for people who don't need it.
    const histGroup = document.getElementById("t-history-group");
    const histPanel = document.getElementById("t-history");
    const histToggle = document.getElementById("t-history-toggle");
    histGroup.hidden = !task;
    histPanel.hidden = true;
    histPanel.innerHTML = "";
    histToggle.setAttribute("aria-expanded", "false");
    histToggle.classList.remove("open");

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
    const client = document.getElementById("t-client").value.trim();
    if (client) customFields.client = client;
    else delete customFields.client;
    if (hasFeature("board_tabs") && !editingTask) {
      customFields.hr_category = activeTab === "ops" ? "ops" : "candidate";
    }

    // hr_category is set above for new cards, so the stage-date decision has
    // to be made against the values we're about to save, not the old row.
    const savingStage = UI.stageDateMode(project, { fields: customFields });

    const fields = {
      title,
      notes: document.getElementById("t-notes").value.trim() || null,
      status: document.getElementById("t-status").value,
      assignee_id: document.getElementById("t-assignee").value || null,
      // Stage-date cards have no due date at all. Clearing it (rather than
      // leaving a stale one behind) is deliberate: it's what makes the field
      // gone rather than merely hidden — and the change log records it.
      due_date: savingStage ? null : document.getElementById("t-due").value || null,
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
      refreshClientFilter(); // a save can add/retire a client name
      renderBoard();
      // Filing a card in a hidden column would otherwise look like the save
      // silently failed.
      if (isHidden(fields.status)) {
        UI.toast(`Saved in “${fields.status}” — that column is hidden on this board.`);
      }
    } catch (err) {
      UI.toast(err.message);
    }
  });

  // Lazy-load the per-task history the first time it's expanded
  document.getElementById("t-history-toggle").addEventListener("click", () => {
    const panel = document.getElementById("t-history");
    const toggle = document.getElementById("t-history-toggle");
    const open = panel.hidden;
    panel.hidden = !open;
    toggle.classList.toggle("open", open);
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    if (open && !panel.innerHTML && editingTask) {
      Changelog.renderTask(panel, editingTask.id);
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
      refreshClientFilter();
      renderBoard();
    } catch (err) {
      UI.toast(err.message);
    }
  });

  document.getElementById("task-cancel").addEventListener("click", () => UI.closeModal("task-modal"));

  initMentionPicker();
  load();
})();
