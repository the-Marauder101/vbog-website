// js/hr-clients.js — the client tracker on HR boards (docs: ../ARCHITECTURE.md §15)
//
// A second table beside the Roles Summary, sharing one card via tabs. One row
// per client, tracking the dates a client moves through: signed → requirement
// → profiles shared → interviews → delivered.
//
// The difference from js/hr-roles.js, and the reason this isn't just more
// columns there: columns here have a TYPE. A date column is a real date input
// and stores an ISO date, which is what makes `duration` columns possible —
// they are COMPUTED from two date columns at render time, never stored, so an
// elapsed time can't drift out of sync with the dates behind it.
//
// Column definitions live in projects.hr_client_columns; row values live in
// hr_clients.values, keyed by column key — so adding a column is a config
// change, never a migration.

const HrClients = (() => {
  let project = null;
  let rows = [];
  let columns = [];
  let editingCell = null;
  let deleteArmedFor = null;

  const DEFAULT_COLUMNS = [
    { key: "client_name", label: "Client", type: "text" },
    { key: "signed_on", label: "Signed On", type: "date" },
    { key: "requirement_on", label: "Requirement Received", type: "date" },
    { key: "first_profiles_on", label: "Profiles Shared", type: "date" },
    { key: "first_interview_on", label: "Interviews Started", type: "date" },
    { key: "delivered_on", label: "Delivered", type: "date" },
    { key: "days_to_deliver", label: "Days to Deliver", type: "duration", from: "signed_on", to: "delivered_on" },
    { key: "notes", label: "Notes", type: "text" },
  ];

  const TYPE_LABELS = { text: "Text", date: "Date", number: "Number", duration: "Elapsed days" };

  async function init(proj) {
    project = proj;
    columns = project.hr_client_columns?.length ? project.hr_client_columns : DEFAULT_COLUMNS;
    const card = document.getElementById("hr-clients-panel");
    if (!card) return;
    try {
      rows = await API.getHrClients(project.id);
    } catch (e) {
      card.innerHTML = /does not exist|relation|schema cache/i.test(e.message)
        ? '<div class="form-hint">The client tracker needs the 17_hr_client_tracker.sql migration — run it in Supabase first.</div>'
        : `<div class="form-hint">${UI.esc(e.message)}</div>`;
      return;
    }
    document.getElementById("hr-clients-add-row").addEventListener("click", addRow);
    document.getElementById("hr-clients-add-col").addEventListener("click", openAddColumn);
    render();
  }

  // ---- duration: computed, never stored ----
  const dateVal = (row, key) => {
    const v = row.values?.[key];
    return v && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;
  };

  function durationDays(row, col) {
    const a = dateVal(row, col.from);
    const b = dateVal(row, col.to);
    if (!a || !b) return null;
    return Math.round((new Date(b) - new Date(a)) / 86400000);
  }

  function durationCell(row, col) {
    const d = durationDays(row, col);
    if (d === null) {
      // Say WHICH end is missing — "—" alone sends people hunting.
      const missing = !dateVal(row, col.from) ? col.from : col.to;
      const label = columns.find((c) => c.key === missing)?.label || missing;
      return `<span class="dur-pending" title="Needs ${UI.esc(label)}">—</span>`;
    }
    const cls = d < 0 ? "dur-bad" : d <= 14 ? "dur-good" : d <= 30 ? "dur-mid" : "dur-slow";
    return `<span class="dur-chip ${cls}">${d} day${Math.abs(d) === 1 ? "" : "s"}</span>`;
  }

  function cellDisplay(row, col) {
    const raw = row.values?.[col.key] ?? "";
    if (col.type === "duration") return durationCell(row, col);
    if (col.type === "date") return raw ? UI.esc(UI.fmtDate(String(raw).slice(0, 10))) : "";
    return UI.esc(raw);
  }

  function render() {
    const wrap = document.getElementById("hr-clients-table-wrap");
    if (!rows.length) {
      wrap.innerHTML =
        '<div class="form-hint" style="padding:8px 0;">No clients tracked yet — “+ Add Client” starts a row. Fill the dates as they happen and the elapsed columns work themselves out.</div>';
      return;
    }
    const head = columns
      .map(
        (c) =>
          `<th>${UI.esc(c.label)}${
            c.type === "duration" ? '<span class="col-type">auto</span>' : ""
          }<button class="col-remove-btn" data-col-key="${UI.esc(c.key)}" title="Remove column">&times;</button></th>`
      )
      .join("");

    const body = rows
      .map((r) => {
        const cells = columns
          .map((c) =>
            c.type === "duration"
              ? `<td class="dur-cell">${cellDisplay(r, c)}</td>`
              : `<td class="editable-cell" data-row-id="${r.id}" data-col-key="${UI.esc(c.key)}" data-col-type="${UI.esc(c.type)}">${cellDisplay(r, c)}</td>`
          )
          .join("");
        return `<tr>${cells}<td class="row-actions">
          <button class="btn btn-danger" data-delete-client="${r.id}" style="padding:3px 8px;font-size:12px;">${
            deleteArmedFor === r.id ? "Confirm" : "Delete"
          }</button></td></tr>`;
      })
      .join("");

    wrap.innerHTML = `
      <div class="hr-roles-table-scroll">
        <table class="data-table hr-roles-table">
          <thead><tr>${head}<th style="width:70px;"></th></tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>`;

    wrap.querySelectorAll(".editable-cell").forEach((td) => td.addEventListener("click", () => startEdit(td)));
    wrap.querySelectorAll("[data-delete-client]").forEach((btn) =>
      btn.addEventListener("click", () => deleteRow(btn.dataset.deleteClient))
    );
    wrap.querySelectorAll(".col-remove-btn").forEach((btn) =>
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        removeColumn(btn.dataset.colKey);
      })
    );
  }

  // ---- inline editing, typed by column ----
  function startEdit(td) {
    if (editingCell) commitEdit();
    const rowId = td.dataset.rowId;
    const colKey = td.dataset.colKey;
    const type = td.dataset.colType;
    const row = rows.find((r) => r.id === rowId);
    if (!row) return;

    editingCell = td;
    td.classList.add("editing");
    const raw = row.values?.[colKey] ?? "";
    td.innerHTML = "";
    const input = document.createElement("input");
    input.className = "cell-edit-input";
    input.type = type === "date" ? "date" : type === "number" ? "number" : "text";
    input.value = type === "date" ? String(raw).slice(0, 10) : raw;
    td.appendChild(input);
    input.focus();

    input.addEventListener("blur", () => commitEdit());
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); commitEdit(); }
      if (e.key === "Escape") { cancelEdit(row, colKey); }
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
    const rowId = td.dataset.rowId;
    const colKey = td.dataset.colKey;
    const newVal = input.value.trim();
    editingCell = null;
    td.classList.remove("editing");

    const row = rows.find((r) => r.id === rowId);
    if (!row) return;
    const oldVal = row.values?.[colKey] ?? "";
    if (newVal === oldVal) {
      td.innerHTML = cellDisplay(row, columns.find((c) => c.key === colKey));
      return;
    }

    const newValues = { ...row.values, [colKey]: newVal };
    row.values = newValues; // optimistic, so the duration columns update at once
    render();
    try {
      const updated = await API.updateHrClient(rowId, { values: newValues });
      rows = rows.map((r) => (r.id === updated.id ? updated : r));
    } catch (e) {
      row.values = { ...row.values, [colKey]: oldVal };
      render();
      UI.toast(e.message);
    }
  }

  function cancelEdit(row, colKey) {
    if (!editingCell) return;
    const td = editingCell;
    editingCell = null;
    td.classList.remove("editing");
    td.innerHTML = cellDisplay(row, columns.find((c) => c.key === colKey));
  }

  async function addRow() {
    const values = {};
    columns.forEach((c) => { if (c.type !== "duration") values[c.key] = ""; });
    try {
      const created = await API.createHrClient({
        project_id: project.id,
        values,
        sort_order: rows.length,
      });
      rows.push(created);
      render();
    } catch (e) {
      UI.toast(e.message);
    }
  }

  async function deleteRow(id) {
    if (deleteArmedFor !== id) {
      deleteArmedFor = id;
      render();
      return;
    }
    try {
      await API.deleteHrClient(id);
      rows = rows.filter((r) => r.id !== id);
      deleteArmedFor = null;
      render();
      UI.toast("Client removed.", "success");
    } catch (e) {
      UI.toast(e.message);
    }
  }

  // ---- columns: the modal, because a type (and for durations, two more
  // fields) is more than a prompt() can carry ----
  function openAddColumn() {
    const dateCols = columns.filter((c) => c.type === "date");
    document.getElementById("hc-col-name").value = "";
    const typeSel = document.getElementById("hc-col-type");
    typeSel.innerHTML = Object.entries(TYPE_LABELS)
      .map(([v, l]) => `<option value="${v}">${l}</option>`)
      .join("");
    UI.enhanceSelect(typeSel);

    const fill = (id) => {
      const sel = document.getElementById(id);
      sel.innerHTML = dateCols.map((c) => `<option value="${UI.esc(c.key)}">${UI.esc(c.label)}</option>`).join("");
      UI.enhanceSelect(sel);
    };
    fill("hc-col-from");
    fill("hc-col-to");
    syncColType();
    UI.clearFieldErrors(document.getElementById("hr-client-col-form"));
    UI.openModal("hr-client-col-modal");
  }

  // "Elapsed days" needs two date columns to measure between, and is only
  // offerable once at least two exist.
  function syncColType() {
    const type = document.getElementById("hc-col-type").value;
    const isDur = type === "duration";
    document.getElementById("hc-col-range").hidden = !isDur;
    const dateCols = columns.filter((c) => c.type === "date");
    document.getElementById("hc-col-dur-warn").hidden = !(isDur && dateCols.length < 2);
    document.getElementById("hr-client-col-save").disabled = isDur && dateCols.length < 2;
  }

  async function onAddColumn(e) {
    e.preventDefault();
    const form = e.currentTarget;
    UI.clearFieldErrors(form);
    const nameInput = document.getElementById("hc-col-name");
    const label = nameInput.value.trim();
    const type = document.getElementById("hc-col-type").value;
    if (!label) {
      UI.fieldError(nameInput, "Give the column a name.");
      return;
    }
    const key = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || `col_${Date.now()}`;
    if (columns.some((c) => c.key === key)) {
      UI.fieldError(nameInput, "A column with this name already exists.");
      return;
    }
    const col = { key, label, type };
    if (type === "duration") {
      col.from = document.getElementById("hc-col-from").value;
      col.to = document.getElementById("hc-col-to").value;
      if (col.from === col.to) {
        UI.toast("Pick two different date columns to measure between.");
        return;
      }
    }
    columns = [...columns, col];
    await saveColumns();
    UI.closeModal("hr-client-col-modal");
  }

  async function removeColumn(key) {
    const col = columns.find((c) => c.key === key);
    if (!col) return;
    // A duration built on this column would silently stop computing.
    const dependents = columns.filter((c) => c.type === "duration" && (c.from === key || c.to === key));
    if (dependents.length) {
      UI.toast(
        `“${dependents[0].label}” is measured from this column — remove that one first.`
      );
      return;
    }
    if (!confirm(`Remove the “${col.label}” column? Anything stored in it is lost.`)) return;
    columns = columns.filter((c) => c.key !== key);
    for (const row of rows) {
      if (row.values?.[key] !== undefined) {
        const values = { ...row.values };
        delete values[key];
        try {
          const updated = await API.updateHrClient(row.id, { values });
          rows = rows.map((r) => (r.id === updated.id ? updated : r));
        } catch (_) { /* the column is gone from the definition either way */ }
      }
    }
    await saveColumns();
  }

  async function saveColumns() {
    try {
      await API.updateProject(project.id, { hr_client_columns: columns });
      project.hr_client_columns = columns;
      render();
      UI.toast("Columns updated.", "success");
    } catch (e) {
      UI.toast(e.message);
    }
  }

  function bindModal() {
    const form = document.getElementById("hr-client-col-form");
    if (!form) return;
    form.addEventListener("submit", onAddColumn);
    document.getElementById("hc-col-type").addEventListener("change", syncColType);
    document.getElementById("hr-client-col-cancel").addEventListener("click", () =>
      UI.closeModal("hr-client-col-modal")
    );
  }

  bindModal();
  return { init };
})();
