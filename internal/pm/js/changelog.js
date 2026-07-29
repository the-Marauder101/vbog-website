// js/changelog.js — the task change log (docs: ../ARCHITECTURE.md §12)
//
// Every task write is recorded by a database trigger into task_changelog
// (sql/14), one row per changed FIELD — so Zapier, the Vyom API, automations
// and ordinary clicks all land in the same history with no client-side
// bookkeeping. This file is read-only presentation:
//
//   Changelog.initBoard(project)   the board's "History" button + modal
//                                  (the whole project's log)
//   Changelog.renderTask(host, id) one task's history, for the task modal
//
// Nothing here writes: the table's INSERT/UPDATE/DELETE grants are revoked
// from the anon role, so history can't be rewritten from a browser.

const Changelog = (() => {
  let project = null;
  let entries = []; // the project-wide log, loaded when the modal opens
  let search = "";
  let statusOnly = false;

  // Human labels for the `field` column. Unknown keys (future fields.* keys)
  // fall back to a prettified version of the key itself, so the log never
  // shows a raw snake_case name it wasn't taught about.
  const FIELD_LABELS = {
    status: "Status",
    title: "Title",
    notes: "Notes",
    due_date: "Due date",
    assignee: "Assignee",
    client: "Client",
    email: "Contact email",
    hr_category: "Board tab",
  };

  function fieldLabel(field) {
    if (!field) return "Task";
    return FIELD_LABELS[field] || field.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
  }

  const dash = '<span class="cl-empty">—</span>';
  const val = (v) => (v === null || v === undefined || v === "" ? dash : UI.esc(trunc(v)));

  function trunc(s, max = 90) {
    const str = String(s).replace(/\s+/g, " ").trim();
    return str.length > max ? `${str.slice(0, max)}…` : str;
  }

  // One entry as a sentence. Status moves get the arrow treatment because
  // they're the ones people actually scan for.
  function describe(e) {
    if (e.action === "created") {
      return `created this task${e.new_value ? ` in <span class="cl-val">${UI.esc(e.new_value)}</span>` : ""}`;
    }
    if (e.action === "deleted") {
      return `deleted this task${e.old_value ? ` (was in <span class="cl-val">${UI.esc(e.old_value)}</span>)` : ""}`;
    }
    if (e.field === "status") {
      return `moved <span class="cl-val">${val(e.old_value)}</span> <span class="cl-arrow">&rarr;</span> <span class="cl-val cl-new">${val(e.new_value)}</span>`;
    }
    if (e.field === "assignee") {
      if (!e.new_value) return `unassigned <span class="cl-val">${val(e.old_value)}</span>`;
      return `assigned to <span class="cl-val cl-new">${val(e.new_value)}</span>`;
    }
    if (e.field === "notes") {
      if (!e.old_value) return `added notes`;
      if (!e.new_value) return `cleared the notes`;
      return `edited the notes`;
    }
    return `${UI.esc(fieldLabel(e.field))}: <span class="cl-val">${val(e.old_value)}</span> <span class="cl-arrow">&rarr;</span> <span class="cl-val cl-new">${val(e.new_value)}</span>`;
  }

  function entryRow(e, opts = {}) {
    const who = e.actor_name || "Unknown";
    // Automation / API / Zapier get a neutral badge rather than initials —
    // they're not people and shouldn't look like one.
    const isBot = !e.actor_id;
    const initials = isBot
      ? "&#9881;"
      : UI.esc(who.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase());
    return `
      <li class="cl-entry${e.action === "updated" && e.field === "status" ? " cl-status" : ""}"
          data-field="${UI.esc(e.field || "")}" data-action="${UI.esc(e.action)}">
        <span class="avatar${isBot ? " cl-bot" : ""}"${isBot ? "" : ` style="background:${UI.avatarColor(who)}"`}>${initials}</span>
        <span class="cl-body">
          ${opts.withTask && e.task_title ? `<span class="cl-task">${UI.esc(e.task_title)}</span>` : ""}
          <span class="cl-text"><strong>${UI.esc(who)}</strong> ${describe(e)}</span>
        </span>
        <time class="cl-when" title="${UI.esc(UI.fmtDateTime(e.created_at))}">${UI.esc(UI.relTime(e.created_at))}</time>
      </li>`;
  }

  // Pre-migration guard: the whole feature disappears rather than erroring.
  function isMissingTable(err) {
    return /task_changelog|does not exist|relation|PGRST205|not set up/i.test(err.message || "");
  }

  // ---- one task's history (task modal) ----
  async function renderTask(host, taskId) {
    if (!host) return;
    host.innerHTML = '<div class="form-hint">Loading history…</div>';
    let rows;
    try {
      rows = await API.getTaskChangelog(taskId);
    } catch (e) {
      host.innerHTML = `<div class="form-hint">${
        isMissingTable(e)
          ? "History needs the 14_hidden_statuses_changelog.sql migration — run it in Supabase first."
          : UI.esc(e.message)
      }</div>`;
      return;
    }
    if (!rows.length) {
      host.innerHTML =
        '<div class="form-hint">No changes recorded yet. Everything from here on is logged.</div>';
      return;
    }
    host.innerHTML = `<ul class="cl-list">${rows.map((e) => entryRow(e)).join("")}</ul>`;
  }

  // ---- the whole project's log (board modal) ----
  function initBoard(proj) {
    project = proj;
    const btn = document.getElementById("changelog-btn");
    if (!btn || Auth.isExternal()) return; // history is an internal view
    btn.hidden = false;
    btn.addEventListener("click", openModal);
    document.getElementById("changelog-close").addEventListener("click", () =>
      UI.closeModal("changelog-modal")
    );
    document.getElementById("cl-search").addEventListener("input", (e) => {
      search = e.target.value.trim().toLowerCase();
      renderList();
    });
    document.getElementById("cl-status-only").addEventListener("change", (e) => {
      statusOnly = e.target.checked;
      renderList();
    });
  }

  async function openModal() {
    document.getElementById("cl-project-name").textContent = project.name;
    UI.openModal("changelog-modal");
    const host = document.getElementById("changelog-list");
    host.innerHTML = '<div class="form-hint">Loading…</div>';
    try {
      entries = await API.getProjectChangelog(project.id);
    } catch (e) {
      host.innerHTML = `<div class="form-hint">${
        isMissingTable(e)
          ? "The change log needs the 14_hidden_statuses_changelog.sql migration — run it in Supabase first."
          : UI.esc(e.message)
      }</div>`;
      return;
    }
    renderList();
  }

  function renderList() {
    const host = document.getElementById("changelog-list");
    if (!host) return;
    const shown = entries.filter((e) => {
      // "Status moves only" keeps creations and deletions too: they're the
      // start and end of a card's stage timeline, not unrelated noise.
      if (statusOnly && e.field !== "status") return false;
      if (!search) return true;
      return (
        (e.task_title || "").toLowerCase().includes(search) ||
        (e.actor_name || "").toLowerCase().includes(search)
      );
    });
    document.getElementById("cl-count").textContent = entries.length
      ? `${shown.length} of ${entries.length} recorded change${entries.length === 1 ? "" : "s"}`
      : "";
    if (!shown.length) {
      host.innerHTML = `<div class="form-hint">${
        entries.length
          ? "Nothing matches that filter."
          : "No changes recorded for this project yet."
      }</div>`;
      return;
    }
    // Grouped by day: the log is read chronologically, and a date heading is
    // cheaper to scan than 300 identical relative timestamps.
    let html = "";
    let lastDay = null;
    for (const e of shown) {
      const day = UI.fmtDate((e.created_at || "").slice(0, 10));
      if (day !== lastDay) {
        if (lastDay !== null) html += "</ul>";
        html += `<div class="cl-day">${UI.esc(day)}</div><ul class="cl-list">`;
        lastDay = day;
      }
      html += entryRow(e, { withTask: true });
    }
    host.innerHTML = html + (lastDay === null ? "" : "</ul>");
  }

  return { initBoard, renderTask };
})();
