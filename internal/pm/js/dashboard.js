// Dashboard: project cards + create/edit/archive project modal.

(() => {
  if (!Auth.requireLogin()) return;
  Auth.initNav();
  Inbox.init();

  const SWATCH_COLORS = ["#00B4D8", "#0F3460", "#16A34A", "#F59E0B", "#DC2626", "#7C3AED", "#DB2777", "#64748B"];
  const DEFAULT_STATUSES = ["To Do", "In Progress", "Blocked", "Done"];

  let projects = [];
  let taskSummaries = []; // [{project_id, due_date}]
  let allTags = []; // registry, feeds the tag dropdowns
  let tagFilter = ""; // "" = all tags
  let editingProject = null; // null = creating
  let statusTags = [];
  let projectTags = []; // tags selected in the modal
  let selectedColor = SWATCH_COLORS[0];
  let statusWarningShown = false;

  const grid = document.getElementById("project-grid");
  const form = document.getElementById("project-form");
  const isExternal = Auth.isExternal();

  async function load() {
    try {
      const allowed = await Auth.allowedProjectIds();
      [projects, taskSummaries, allTags] = await Promise.all([
        API.getProjects(),
        API.getTaskSummaries(),
        API.getTags(),
      ]);
      if (allowed !== null) projects = projects.filter((p) => allowed.includes(p.id));
      initTagFilter();
      render();
    } catch (e) {
      grid.innerHTML = "";
      UI.toast(e.message);
    }
  }

  function initTagFilter() {
    const sel = document.getElementById("filter-tag");
    if (!sel) return;
    sel.innerHTML =
      `<option value="">All tags</option>` +
      allTags.map((t) => `<option value="${UI.esc(t.name)}">${UI.esc(t.name)}</option>`).join("");
    UI.enhanceSelect(sel);
    sel.addEventListener("change", () => {
      tagFilter = sel.value;
      sel.classList.toggle("on", tagFilter !== "");
      UI.syncSelect(sel);
      render();
    });
  }

  function render() {
    const showArchived = document.getElementById("show-archived").checked;
    const visible = projects.filter(
      (p) =>
        (showArchived || !p.archived) &&
        (!tagFilter || (p.tags || []).includes(tagFilter))
    );

    if (visible.length === 0) {
      grid.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1;">
          <h2>${isExternal ? "No projects shared with you yet" : "No projects yet"}</h2>
          <p>${isExternal ? "Ask your VBOG contact to give you access." : "Create your first project — one per client or internal workstream."}</p>
          ${isExternal ? "" : '<button class="btn btn-primary" id="empty-new-btn">+ New Project</button>'}
        </div>`;
      document.getElementById("empty-new-btn")?.addEventListener("click", () => openProjectModal(null));
      return;
    }

    const ghost = isExternal ? "" : `<button class="ghost-card" id="ghost-new-project">+ New Project</button>`;
    grid.innerHTML = visible.map((p) => {
      const tasks = taskSummaries.filter((t) => t.project_id === p.id);
      const overdue = tasks.filter((t) => UI.isOverdue(t.due_date)).length;
      const tagChips = (p.tags || [])
        .map((t) => `<span class="tag-chip">${UI.esc(t)}</span>`)
        .join("");
      return `
        <div class="project-card ${p.archived ? "archived" : ""}" data-id="${p.id}">
          <div class="accent-bar" style="background:${UI.esc(p.color || "#C3CAD5")}"></div>
          ${isExternal ? "" : `<button class="edit-btn" data-edit="${p.id}" title="Edit project" aria-label="Edit project">&#9998;</button>`}
          <div class="card-body">
            <h3>${UI.esc(p.name)}${p.archived ? '<span class="archived-tag">Archived</span>' : ""}<span class="project-type-tag ${p.type === 'client' ? 'client' : 'internal'}">${p.type === 'client' ? 'Client' : 'Internal'}</span></h3>
            <div class="desc">${UI.esc(p.description || "")}</div>
            ${tagChips ? `<div class="card-tags">${tagChips}</div>` : ""}
            <div class="meta">
              <span>${tasks.length} task${tasks.length === 1 ? "" : "s"}</span>
              ${overdue ? `<span class="overdue-count">${overdue} overdue</span>` : ""}
            </div>
          </div>
        </div>`;
    }).join("") + ghost;

    document.getElementById("ghost-new-project")?.addEventListener("click", () => openProjectModal(null));
    grid.querySelectorAll(".project-card").forEach((card) => {
      card.addEventListener("click", () => {
        window.location.href = `board.html?project=${card.dataset.id}`;
      });
    });
    grid.querySelectorAll(".edit-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        openProjectModal(projects.find((p) => p.id === btn.dataset.edit));
      });
    });
  }

  // ---- Status tag editor ----
  function renderTags() {
    const editor = document.getElementById("status-tags");
    editor.querySelectorAll(".tag").forEach((t) => t.remove());
    const input = document.getElementById("status-input");
    statusTags.forEach((tag, i) => {
      const el = document.createElement("span");
      el.className = "tag";
      el.innerHTML = `${UI.esc(tag)}<button type="button" data-i="${i}" aria-label="Remove ${UI.esc(tag)}">&times;</button>`;
      el.querySelector("button").addEventListener("click", () => {
        statusTags.splice(i, 1);
        renderTags();
      });
      editor.insertBefore(el, input);
    });
  }

  function addTagFromInput() {
    const input = document.getElementById("status-input");
    // Support comma-separated paste: "To Do, Doing, Done"
    const parts = input.value.split(",").map((s) => s.trim()).filter(Boolean);
    for (const p of parts) {
      if (!statusTags.some((t) => t.toLowerCase() === p.toLowerCase())) statusTags.push(p);
    }
    input.value = "";
    renderTags();
  }

  document.getElementById("status-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTagFromInput();
    } else if (e.key === "Backspace" && e.target.value === "" && statusTags.length) {
      statusTags.pop();
      renderTags();
    }
  });

  // ---- Project tag picker (registry dropdown -> chips; no free text) ----
  function renderProjectTags() {
    const host = document.getElementById("p-tags-chips");
    host.innerHTML = projectTags.length
      ? projectTags
          .map(
            (t, i) =>
              `<span class="tag-chip picked">${UI.esc(t)}<button type="button" data-i="${i}" aria-label="Remove ${UI.esc(t)}">&times;</button></span>`
          )
          .join("")
      : `<span class="form-hint" style="margin:0;">No tags yet — pick from the dropdown.</span>`;
    host.querySelectorAll("button").forEach((b) =>
      b.addEventListener("click", () => {
        projectTags.splice(Number(b.dataset.i), 1);
        renderProjectTags();
        fillTagSelect();
      })
    );
  }

  function fillTagSelect() {
    const sel = document.getElementById("p-tag-select");
    const remaining = allTags.filter((t) => !projectTags.includes(t.name));
    sel.innerHTML =
      `<option value="">+ Add a tag…</option>` +
      remaining.map((t) => `<option value="${UI.esc(t.name)}">${UI.esc(t.name)}</option>`).join("");
    sel.value = "";
    UI.enhanceSelect(sel);
  }

  document.getElementById("p-tag-select").addEventListener("change", (e) => {
    if (!e.target.value) return;
    projectTags.push(e.target.value);
    renderProjectTags();
    fillTagSelect();
  });

  // ---- Colour swatches ----
  function renderSwatches() {
    const host = document.getElementById("swatches");
    host.innerHTML = "";
    SWATCH_COLORS.forEach((c) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "swatch" + (c === selectedColor ? " selected" : "");
      b.style.background = c;
      b.title = c;
      b.addEventListener("click", () => {
        selectedColor = c;
        renderSwatches();
      });
      host.appendChild(b);
    });
  }

  // ---- Modal ----
  function openProjectModal(project) {
    editingProject = project || null;
    statusWarningShown = false;
    document.getElementById("status-warning").hidden = true;
    UI.clearFieldErrors(form);

    document.getElementById("project-modal-title").textContent = project ? "Edit Project" : "New Project";
    document.getElementById("project-save").textContent = project ? "Save Changes" : "Create Project";
    document.getElementById("p-name").value = project ? project.name : "";
    document.getElementById("p-desc").value = project ? project.description || "" : "";
    const typeVal = project?.type || "internal";
    document.querySelectorAll('input[name="p-type"]').forEach((r) => { r.checked = r.value === typeVal; });
    statusTags = project ? [...project.statuses] : [...DEFAULT_STATUSES];
    projectTags = project ? [...(project.tags || [])] : [];
    selectedColor = project?.color || SWATCH_COLORS[0];
    document.getElementById("status-input").value = "";
    renderProjectTags();
    fillTagSelect();

    const archiveBtn = document.getElementById("archive-btn");
    archiveBtn.hidden = !project;
    archiveBtn.textContent = project?.archived ? "Unarchive project" : "Archive project";

    renderTags();
    renderSwatches();
    UI.openModal("project-modal");
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    UI.clearFieldErrors(form);
    addTagFromInput(); // capture anything typed but not committed

    const nameInput = document.getElementById("p-name");
    const name = nameInput.value.trim();
    let valid = true;

    if (!name) {
      UI.fieldError(nameInput, "Project name is required.");
      valid = false;
    } else if (
      projects.some((p) => p.id !== editingProject?.id && p.name.toLowerCase() === name.toLowerCase())
    ) {
      UI.fieldError(nameInput, "A project with this name already exists.");
      valid = false;
    }
    if (statusTags.length === 0) {
      UI.fieldError(document.getElementById("status-input"), "Add at least one status column.");
      valid = false;
    }
    if (!valid) return;

    const fields = {
      name,
      description: document.getElementById("p-desc").value.trim() || null,
      statuses: statusTags,
      color: selectedColor,
      type: document.querySelector('input[name="p-type"]:checked')?.value || "internal",
      tags: projectTags,
    };

    try {
      if (editingProject) {
        // Warn if removing statuses that are still in use (PRD F-02)
        const removed = editingProject.statuses.filter(
          (s) => !statusTags.some((t) => t.toLowerCase() === s.toLowerCase())
        );
        if (removed.length && !statusWarningShown) {
          const tasks = await API.getTasks(editingProject.id);
          const inUse = removed
            .map((s) => ({ s, n: tasks.filter((t) => t.status === s).length }))
            .filter((x) => x.n > 0);
          if (inUse.length) {
            const warn = document.getElementById("status-warning");
            warn.hidden = false;
            warn.textContent =
              "Heads up: " +
              inUse.map((x) => `${x.n} task${x.n === 1 ? "" : "s"} in “${x.s}”`).join(", ") +
              ". These tasks keep their status and appear in a “removed” column until you move them. Click Save again to confirm.";
            statusWarningShown = true;
            return;
          }
        }
        const updated = await API.updateProject(editingProject.id, fields);
        projects = projects.map((p) => (p.id === updated.id ? updated : p));
        UI.toast("Project updated.", "success");
      } else {
        const created = await API.createProject(fields);
        projects.push(created);
        UI.toast("Project created.", "success");
      }
      UI.closeModal("project-modal");
      render();
    } catch (err) {
      UI.toast(err.message);
    }
  });

  document.getElementById("archive-btn").addEventListener("click", async () => {
    if (!editingProject) return;
    const archived = !editingProject.archived;
    try {
      const updated = await API.updateProject(editingProject.id, { archived });
      projects = projects.map((p) => (p.id === updated.id ? updated : p));
      UI.closeModal("project-modal");
      UI.toast(archived ? "Project archived." : "Project restored.", "success");
      render();
    } catch (err) {
      UI.toast(err.message);
    }
  });

  document.getElementById("new-project-btn").addEventListener("click", () => openProjectModal(null));
  document.getElementById("project-cancel").addEventListener("click", () => UI.closeModal("project-modal"));
  document.getElementById("show-archived").addEventListener("change", render);
  if (isExternal) document.getElementById("new-project-btn").hidden = true;

  load();
})();
