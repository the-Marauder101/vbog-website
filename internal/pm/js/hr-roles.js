// js/hr-roles.js — Roles summary card for HR project boards
//
// Loaded by board.html; board.js calls HrRoles.init(project) when the project
// has the roles_card feature enabled. Renders an inline-editable table above
// the Kanban columns. Column definitions live in project.hr_role_columns;
// row data lives in the hr_roles table (values JSONB keyed by column key).

const HrRoles = (() => {
  let project = null;
  let roles = [];
  let columns = [];
  let editingCell = null;

  const DEFAULT_COLUMNS = [
    { key: "client_name", label: "Client Name" },
    { key: "role_title", label: "Role Title" },
    { key: "openings", label: "# Openings" },
    { key: "salary_range", label: "Salary Range" },
    { key: "notes", label: "Notes" },
  ];

  async function init(proj) {
    project = proj;
    columns = project.hr_role_columns?.length ? project.hr_role_columns : DEFAULT_COLUMNS;
    const card = document.getElementById("hr-roles-card");
    if (!card) return;
    card.hidden = false;
    try {
      roles = await API.getHrRoles(project.id);
    } catch (e) {
      if (/does not exist|relation/i.test(e.message)) {
        card.querySelector(".hr-roles-body").innerHTML =
          '<div class="form-hint">Roles card needs the 13_hr_projects.sql migration — run it in Supabase first.</div>';
        return;
      }
      UI.toast(e.message);
      return;
    }
    document.getElementById("hr-roles-add-row").addEventListener("click", addRow);
    document.getElementById("hr-roles-add-col").addEventListener("click", openAddColumnModal);
    render();
  }

  function show() {
    const card = document.getElementById("hr-roles-card");
    if (card) card.hidden = false;
  }

  function hide() {
    const card = document.getElementById("hr-roles-card");
    if (card) card.hidden = true;
  }

  function render() {
    const wrap = document.getElementById("hr-roles-table-wrap");
    if (!roles.length) {
      wrap.innerHTML = '<div class="form-hint" style="padding:8px 0;">No roles yet — click "+ Add Role" to start tracking open positions.</div>';
      return;
    }
    const colHeaders = columns.map((c) =>
      `<th>${UI.esc(c.label)}<button class="col-remove-btn" data-col-key="${UI.esc(c.key)}" title="Remove column">&times;</button></th>`
    ).join("");
    const rows = roles.map((r) => {
      const cells = columns.map((c) => {
        const val = r.values?.[c.key] ?? "";
        return `<td class="editable-cell" data-role-id="${r.id}" data-col-key="${c.key}">${UI.esc(val)}</td>`;
      }).join("");
      return `<tr>${cells}<td class="row-actions">
        <button class="btn btn-danger" data-delete-role="${r.id}" style="padding:3px 8px;font-size:12px;">Delete</button>
      </td></tr>`;
    }).join("");
    wrap.innerHTML = `
      <div class="hr-roles-table-scroll">
        <table class="data-table hr-roles-table">
          <thead><tr>${colHeaders}<th style="width:70px;"></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
    bindEvents(wrap);
  }

  function bindEvents(wrap) {
    wrap.querySelectorAll(".editable-cell").forEach((td) => {
      td.addEventListener("click", () => startEdit(td));
    });
    wrap.querySelectorAll("[data-delete-role]").forEach((btn) => {
      btn.addEventListener("click", () => deleteRow(btn.dataset.deleteRole));
    });
    wrap.querySelectorAll(".col-remove-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        removeColumn(btn.dataset.colKey);
      });
    });
  }

  function startEdit(td) {
    if (editingCell) commitEdit();
    editingCell = td;
    const val = td.textContent;
    td.classList.add("editing");
    td.innerHTML = "";
    const input = document.createElement("input");
    input.type = "text";
    input.value = val;
    input.className = "cell-edit-input";
    td.appendChild(input);
    input.focus();
    input.addEventListener("blur", () => commitEdit());
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); commitEdit(); }
      if (e.key === "Escape") { cancelEdit(val); }
      if (e.key === "Tab") {
        e.preventDefault();
        commitEdit();
        const next = e.shiftKey ? td.previousElementSibling : td.nextElementSibling;
        if (next?.classList.contains("editable-cell")) startEdit(next);
      }
    });
  }

  async function commitEdit() {
    if (!editingCell) return;
    const td = editingCell;
    const input = td.querySelector("input");
    if (!input) return;
    const newVal = input.value.trim();
    const roleId = td.dataset.roleId;
    const colKey = td.dataset.colKey;
    editingCell = null;
    td.classList.remove("editing");
    td.textContent = newVal;
    const role = roles.find((r) => r.id === roleId);
    if (!role) return;
    const oldVal = role.values?.[colKey] ?? "";
    if (newVal === oldVal) return;
    const newValues = { ...role.values, [colKey]: newVal };
    try {
      const updated = await API.updateHrRole(roleId, { values: newValues });
      roles = roles.map((r) => (r.id === updated.id ? updated : r));
    } catch (e) {
      td.textContent = oldVal;
      UI.toast(e.message);
    }
  }

  function cancelEdit(originalVal) {
    if (!editingCell) return;
    const td = editingCell;
    editingCell = null;
    td.classList.remove("editing");
    td.textContent = originalVal;
  }

  async function addRow() {
    const values = {};
    columns.forEach((c) => { values[c.key] = ""; });
    try {
      const created = await API.createHrRole({
        project_id: project.id,
        values,
        sort_order: roles.length,
      });
      roles.push(created);
      render();
    } catch (e) {
      UI.toast(e.message);
    }
  }

  async function deleteRow(roleId) {
    if (!confirm("Delete this role row?")) return;
    try {
      await API.deleteHrRole(roleId);
      roles = roles.filter((r) => r.id !== roleId);
      render();
      UI.toast("Role removed.", "success");
    } catch (e) {
      UI.toast(e.message);
    }
  }

  function openAddColumnModal() {
    const name = prompt("New column name:");
    if (!name?.trim()) return;
    const label = name.trim();
    const key = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    if (columns.some((c) => c.key === key)) {
      UI.toast("A column with that key already exists.");
      return;
    }
    columns.push({ key, label });
    saveColumns();
  }

  async function removeColumn(key) {
    if (!confirm(`Remove the "${columns.find((c) => c.key === key)?.label}" column? Data in this column will be lost.`)) return;
    columns = columns.filter((c) => c.key !== key);
    for (const role of roles) {
      if (role.values?.[key] !== undefined) {
        const newValues = { ...role.values };
        delete newValues[key];
        try {
          const updated = await API.updateHrRole(role.id, { values: newValues });
          roles = roles.map((r) => (r.id === updated.id ? updated : r));
        } catch (_) {}
      }
    }
    saveColumns();
  }

  async function saveColumns() {
    try {
      await API.updateProject(project.id, { hr_role_columns: columns });
      project.hr_role_columns = columns;
      render();
      UI.toast("Columns updated.", "success");
    } catch (e) {
      UI.toast(e.message);
    }
  }

  return { init, show, hide };
})();
