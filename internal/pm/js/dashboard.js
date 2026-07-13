// js/dashboard.js — page logic for vyom.html (full docs: ../ARCHITECTURE.md)
//
// Project cards (task/overdue counts, type badge, tag chips) + the create/edit
// modal: name, description, Internal/Client type, tags (picked from the central
// registry — no free text, so names never duplicate), custom status columns
// (become the Kanban columns), accent color, archive.
// Externals: projects filtered to Auth.allowedProjectIds(); create/edit hidden.

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
  let remapPlan = null; // rows shown in #status-remap; null = no pending mapping
  let statusSource = "custom"; // "inherit" | "custom" (mirrors the p-statuses-src radios)
  let statusTagsDirty = false; // user touched chips this modal session
  let lastParentVal = ""; // previous #p-parent value, for unlink pre-fill

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

    // Sub-clients don't get their own cards — they render as clickable chips
    // inside the parent's card, so ten sub-clients never crowd the grid.
    // A sub whose parent isn't visible (archived/filtered out) falls back to
    // rendering as its own card with a badge, so it can never disappear.
    const visibleIds = new Set(visible.map((p) => p.id));
    const subsOf = (id) =>
      projects.filter((p) => p.parent_project_id === id && (showArchived || !p.archived));
    const ordered = visible.filter(
      (p) => !(p.parent_project_id && visibleIds.has(p.parent_project_id))
    );

    const ghost = isExternal ? "" : `<button class="ghost-card" id="ghost-new-project">+ New Project</button>`;
    grid.innerHTML = ordered.map((p) => {
      const tasks = taskSummaries.filter((t) => t.project_id === p.id);
      const overdue = tasks.filter((t) => UI.isOverdue(t.due_date)).length;
      const tagChips = (p.tags || [])
        .map((t) => `<span class="tag-chip">${UI.esc(t)}</span>`)
        .join("");
      const parent = p.parent_project_id ? projects.find((x) => x.id === p.parent_project_id) : null;
      // Cards stay compact no matter how many sub-clients a client has:
      // show the first few, fold the rest behind a "+ N more" row.
      const SUBS_SHOWN = 3;
      const subs = subsOf(p.id);
      const subChips =
        subs
          .map((s, i) => {
            const n = taskSummaries.filter((t) => t.project_id === s.id).length;
            const nOverdue = taskSummaries.filter((t) => t.project_id === s.id && UI.isOverdue(t.due_date)).length;
            return `<button type="button" class="sub-link${i >= SUBS_SHOWN ? " sub-extra" : ""}" ${i >= SUBS_SHOWN ? "hidden " : ""}data-sub="${s.id}" title="Open ${UI.esc(s.name)}">
              <span class="access-dot" style="background:${UI.esc(s.color || "#C3CAD5")}"></span>
              <span class="sub-name">${UI.esc(s.name)}</span>
              ${nOverdue ? `<span class="overdue-count">${nOverdue} overdue</span>` : ""}
              <span class="sub-count">${n} task${n === 1 ? "" : "s"}</span>
              ${isExternal ? "" : `<span class="sub-edit" data-subedit="${s.id}" title="Edit ${UI.esc(s.name)}">&#9998;</span>`}
            </button>`;
          })
          .join("") +
        (subs.length > SUBS_SHOWN
          ? `<button type="button" class="sub-more">+ ${subs.length - SUBS_SHOWN} more</button>`
          : "");
      return `
        <div class="project-card ${p.archived ? "archived" : ""} ${parent ? "sub-project" : ""}" data-id="${p.id}">
          <div class="accent-bar" style="background:${UI.esc(p.color || "#C3CAD5")}"></div>
          ${isExternal ? "" : `<button class="edit-btn" data-edit="${p.id}" title="Edit project" aria-label="Edit project">&#9998;</button>`}
          <div class="card-body">
            <h3>${UI.esc(p.name)}${p.archived ? '<span class="archived-tag">Archived</span>' : ""}${parent ? `<span class="subclient-tag" title="Sub-client of ${UI.esc(parent.name)}">&#8627; ${UI.esc(parent.name)}</span>` : `<span class="project-type-tag ${p.type === 'client' ? 'client' : 'internal'}">${p.type === 'client' ? 'Client' : 'Internal'}</span>`}</h3>
            <div class="desc">${UI.esc(p.description || "")}</div>
            ${tagChips ? `<div class="card-tags">${tagChips}</div>` : ""}
            <div class="meta">
              <span>${tasks.length} task${tasks.length === 1 ? "" : "s"}</span>
              ${overdue ? `<span class="overdue-count">${overdue} overdue</span>` : ""}
            </div>
            ${subChips ? `<div class="sub-list"><span class="sub-list-label">Sub-clients</span>${subChips}</div>` : ""}
          </div>
        </div>`;
    }).join("") + ghost;

    document.getElementById("ghost-new-project")?.addEventListener("click", () => openProjectModal(null));
    grid.querySelectorAll(".project-card").forEach((card) => {
      card.addEventListener("click", () => {
        window.location.href = `board.html?project=${card.dataset.id}`;
      });
    });
    grid.querySelectorAll(".sub-link").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        window.location.href = `board.html?project=${btn.dataset.sub}`;
      });
    });
    grid.querySelectorAll(".sub-more").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        btn.closest(".sub-list").querySelectorAll(".sub-extra").forEach((el) => (el.hidden = false));
        btn.remove();
      });
    });
    grid.querySelectorAll(".sub-edit").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        openProjectModal(projects.find((p) => p.id === el.dataset.subedit));
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
  // Any change to the chip list invalidates a pending transition mapping —
  // the mapping's counts and destination options were built for the old list.
  function statusTagsChanged() {
    statusTagsDirty = true;
    resetRemap();
  }

  function renderTags() {
    const editor = document.getElementById("status-tags");
    editor.querySelectorAll(".tag").forEach((t) => t.remove());
    const input = document.getElementById("status-input");
    statusTags.forEach((tag, i) => {
      const el = document.createElement("span");
      el.className = "tag";
      el.draggable = true;
      el.innerHTML = `${UI.esc(tag)}<button type="button" data-i="${i}" aria-label="Remove ${UI.esc(tag)}">&times;</button>`;
      el.querySelector("button").addEventListener("click", () => {
        statusTags.splice(i, 1);
        statusTagsChanged();
        renderTags();
      });
      // Drag a chip onto another to reorder — same HTML5 DnD the board uses.
      el.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("text/plain", String(i));
        e.dataTransfer.effectAllowed = "move";
        el.classList.add("dragging");
      });
      el.addEventListener("dragend", () => el.classList.remove("dragging"));
      el.addEventListener("dragover", (e) => e.preventDefault());
      el.addEventListener("drop", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const from = Number(e.dataTransfer.getData("text/plain"));
        if (!Number.isInteger(from) || from === i) return;
        const [moved] = statusTags.splice(from, 1);
        statusTags.splice(i, 0, moved);
        statusTagsChanged();
        renderTags();
      });
      editor.insertBefore(el, input);
    });
  }

  function addTagFromInput() {
    const input = document.getElementById("status-input");
    // Support comma-separated paste: "To Do, Doing, Done"
    const parts = input.value.split(",").map((s) => s.trim()).filter(Boolean);
    let added = false;
    for (const p of parts) {
      if (!statusTags.some((t) => t.toLowerCase() === p.toLowerCase())) {
        statusTags.push(p);
        added = true;
      }
    }
    input.value = "";
    if (added) statusTagsChanged();
    renderTags();
  }

  document.getElementById("status-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTagFromInput();
    } else if (e.key === "Backspace" && e.target.value === "" && statusTags.length) {
      statusTags.pop();
      statusTagsChanged();
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

  // ---- Parent project (sub-client) dropdown ----
  // One level deep only: a project that has children, or is itself a child,
  // can't be offered as/assigned a parent respectively.
  function fillParentSelect(project) {
    const sel = document.getElementById("p-parent");
    const hasChildren = project && projects.some((p) => p.parent_project_id === project.id);
    const candidates = hasChildren
      ? []
      : projects.filter(
          (p) => !p.archived && !p.parent_project_id && p.id !== project?.id
        );
    sel.innerHTML =
      `<option value="">None — this is a direct client / internal project</option>` +
      candidates.map((p) => `<option value="${p.id}">${UI.esc(p.name)}</option>`).join("");
    sel.value = project?.parent_project_id || "";
    sel.disabled = hasChildren;
    UI.enhanceSelect(sel);
    UI.syncSelect(sel);
  }

  // ---- Status source (inherit from parent vs custom) ----
  const parentOf = (id) => projects.find((p) => p.id === id) || null;
  // inherit_statuses ships in sql/12 — the whole toggle stays hidden until the
  // column exists, same graceful degradation as the parent_project_id guard.
  const inheritColExists = () => projects.some((p) => "inherit_statuses" in p);

  function resetRemap() {
    remapPlan = null;
    document.getElementById("status-remap").hidden = true;
    document.getElementById("project-save").textContent = editingProject
      ? "Save Changes"
      : "Create Project";
  }

  // Show/hide the source toggle + swap the editable chip editor for the
  // read-only inherited view. Called on open and whenever parent/source change.
  function syncStatusSource() {
    const parentVal = document.getElementById("p-parent").value;
    const showToggle = !!parentVal && inheritColExists();
    document.getElementById("p-statuses-src-group").hidden = !showToggle;
    document.querySelectorAll('input[name="p-statuses-src"]').forEach((r) => {
      r.checked = r.value === statusSource;
    });
    const inherit = showToggle && statusSource === "inherit";
    document.getElementById("p-statuses-group").hidden = inherit;
    document.getElementById("p-inherited-group").hidden = !inherit;
    if (inherit) {
      const parent = parentOf(parentVal);
      document.getElementById("inherited-statuses").innerHTML = (parent?.statuses || [])
        .map((s) => `<span class="tag">${UI.esc(s)}</span>`)
        .join("");
    }
  }

  // One row per removed-but-in-use status: "N tasks in 'X' → [destination]".
  // Rows for statuses that were ALREADY orphaned (a "(removed)" column) get a
  // note — saving cleans those up too. remapPlan holds the rows until save.
  function buildRemapUI(needed, targets, includesChildren) {
    document.getElementById("remap-intro").textContent =
      "These columns are being removed but still have tasks" +
      (includesChildren ? " (including inheriting sub-clients)" : "") +
      " — pick where each should move:";
    const host = document.getElementById("remap-rows");
    host.innerHTML = "";
    needed.forEach((r, idx) => {
      const row = document.createElement("div");
      row.className = "remap-row";
      row.innerHTML =
        `<span class="remap-label">${r.count} task${r.count === 1 ? "" : "s"} in “${UI.esc(r.status)}”` +
        (r.preexisting ? ' <span class="remap-note">(already removed)</span>' : "") +
        `</span><span class="remap-arrow">→</span>`;
      const sel = document.createElement("select");
      sel.id = `remap-sel-${idx}`;
      sel.setAttribute("aria-label", `Move tasks from ${r.status} to`);
      sel.innerHTML = targets
        .map((t) => `<option value="${UI.esc(t)}">${UI.esc(t)}</option>`)
        .join("");
      const wrap = document.createElement("div");
      wrap.className = "remap-select";
      wrap.appendChild(sel);
      row.appendChild(wrap);
      host.appendChild(row);
      UI.enhanceSelect(sel);
      r.selId = sel.id;
    });
    document.getElementById("status-remap").hidden = false;
    document.getElementById("project-save").textContent = "Move tasks & save";
    remapPlan = needed;
  }

  document.querySelectorAll('input[name="p-statuses-src"]').forEach((r) =>
    r.addEventListener("change", () => {
      if (!r.checked) return;
      statusSource = r.value;
      if (statusSource === "custom" && !statusTagsDirty) {
        // Going custom starts from a copy of the parent's current columns
        const parent = parentOf(document.getElementById("p-parent").value);
        if (parent?.statuses?.length) {
          statusTags = [...parent.statuses];
          renderTags();
        }
      }
      resetRemap();
      syncStatusSource();
    })
  );

  document.getElementById("p-parent").addEventListener("change", () => {
    const val = document.getElementById("p-parent").value;
    if (!val && statusSource === "inherit") {
      // Parent unlinked while inheriting: keep working with the columns we
      // were showing (a copy of the old parent's list) and go custom.
      statusSource = "custom";
      const oldParent = parentOf(lastParentVal);
      if (!statusTagsDirty && oldParent?.statuses?.length) {
        statusTags = [...oldParent.statuses];
        renderTags();
      }
    }
    lastParentVal = val;
    resetRemap();
    syncStatusSource();
  });

  // ---- Modal ----
  function openProjectModal(project) {
    editingProject = project || null;
    statusTagsDirty = false;
    lastParentVal = project?.parent_project_id || "";
    // New sub-clients default to inheriting the moment a parent is picked;
    // existing projects reflect their stored choice.
    statusSource = project ? (project.inherit_statuses ? "inherit" : "custom") : "inherit";
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
    fillParentSelect(project);
    resetRemap();
    syncStatusSource();

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
    const parentVal = document.getElementById("p-parent").value || null;
    const inheritOn = !!parentVal && statusSource === "inherit" && inheritColExists();
    const parent = inheritOn ? parentOf(parentVal) : null;
    // The list the project's tasks must live in after this save
    const newEffective = inheritOn ? parent?.statuses || [] : statusTags;

    if (!inheritOn && statusTags.length === 0) {
      UI.fieldError(document.getElementById("status-input"), "Add at least one status column.");
      valid = false;
    }
    if (inheritOn && newEffective.length === 0) {
      UI.toast("The parent project has no status columns to inherit.");
      valid = false;
    }
    if (!valid) return;

    const fields = {
      name,
      description: document.getElementById("p-desc").value.trim() || null,
      // While inheriting, the stored array is a snapshot/fallback only: kept
      // as-is on edits, seeded from the parent on create (see ARCHITECTURE.md)
      statuses: inheritOn ? (editingProject ? editingProject.statuses : [...newEffective]) : statusTags,
      color: selectedColor,
      type: document.querySelector('input[name="p-type"]:checked')?.value || "internal",
      tags: projectTags,
    };
    // Only send parent_project_id once the 08 migration has added the column
    // (a POST with an unknown column would fail the whole save).
    if (projects.length === 0 || projects.some((p) => "parent_project_id" in p)) {
      fields.parent_project_id = parentVal;
    } else if (parentVal) {
      UI.toast("Sub-client projects need the 08_subclients.sql migration — run it in Supabase first.");
      return;
    }
    // Same guard for inherit_statuses (12_status_inheritance.sql)
    if (inheritColExists()) fields.inherit_statuses = inheritOn;

    try {
      if (editingProject) {
        // Transition mapping (PRD F-02, v14): any task — here or in a
        // live-inheriting sub-client — whose status is missing from the new
        // effective list must be mapped to a destination before saving.
        // Covers removals, case-changing renames, inherit/custom switches,
        // and opportunistically cleans up pre-existing "(removed)" orphans.
        let scopeIds = [editingProject.id];
        let children = [];
        if (inheritColExists()) {
          children = await API.getInheritingChildren(editingProject.id);
          scopeIds = scopeIds.concat(children.map((c) => c.id));
        }
        const rows = await API.getTasksByProjects(scopeIds);
        const needed = [...new Set(rows.map((r) => r.status))]
          .filter((s) => !newEffective.includes(s))
          .map((s) => ({
            status: s,
            count: rows.filter((r) => r.status === s).length,
            preexisting: !editingProject.statuses.includes(s),
          }));
        if (needed.length && !remapPlan) {
          buildRemapUI(needed, newEffective, children.length > 0);
          return; // save blocked until every removed status has a destination
        }
        let movedCount = 0;
        if (remapPlan) {
          for (const r of remapPlan) {
            await API.moveTasksByStatus(scopeIds, r.status, document.getElementById(r.selId).value);
            movedCount += r.count;
          }
        }
        const updated = await API.updateProject(editingProject.id, fields);
        projects = projects.map((p) => (p.id === updated.id ? updated : p));
        UI.toast(
          movedCount
            ? `Moved ${movedCount} task${movedCount === 1 ? "" : "s"} · project updated.`
            : "Project updated.",
          "success"
        );
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
