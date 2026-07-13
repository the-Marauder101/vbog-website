// js/automations.js — per-project automation rules UI (docs: ../ARCHITECTURE.md)
//
// Loaded by board.html; board.js calls Automations.init(project, members) once
// the project is loaded. Admin-only: the ⚡ button stays hidden for everyone
// else. Rules live in the `automations` table and are EXECUTED by the
// run_task_automations() Postgres trigger (sql/09_automations.sql) — this
// file is only the editor. Scoped to one project by construction.

const Automations = (() => {
  let project = null;
  let members = [];
  let rules = [];
  let editing = null; // rule being edited, null = creating
  let deleteArmedFor = null;

  const TRIGGER_LABELS = {
    task_created: "Task created",
    status_changed: "Status changes",
    assignee_changed: "Task assigned",
    due_date_set: "Due date set",
  };
  const ACTION_LABELS = {
    // call_webhook POSTs the task_details payload to any URL — used for the Gmail
    // Apps Script bridge (see ARCHITECTURE.md §7 "Gmail Apps Script bridge").
    // Recipient = task.fields.email (Contact email box in the task modal).
    call_webhook: "send to webhook",
    set_status: "move task",
    set_assignee: "assign task",
    notify_user: "notify in inbox",
  };

  function memberName(id) {
    return members.find((m) => m.id === id)?.name || "(removed member)";
  }

  function describe(r) {
    let when = TRIGGER_LABELS[r.trigger_type] || r.trigger_type;
    if (r.trigger_type === "status_changed" && r.conditions?.to_status) {
      when += ` to “${r.conditions.to_status}”`;
    }
    let then = ACTION_LABELS[r.action_type] || r.action_type;
    if (r.action_type === "set_status") then += ` to “${r.action_config?.status || "?"}”`;
    if (r.action_type === "set_assignee" || r.action_type === "notify_user") {
      then += ` — ${memberName(r.action_config?.member_id)}`;
    }
    return { when, then };
  }

  function renderList() {
    const host = document.getElementById("automations-list");
    if (!rules.length) {
      host.innerHTML = `<div class="form-hint">No rules yet for this project — add your first one below.</div>`;
      return;
    }
    host.innerHTML = `
      <table class="data-table">
        <thead><tr><th>Rule</th><th>When</th><th>Then</th><th>On</th><th style="width:170px;"></th></tr></thead>
        <tbody>
          ${rules
            .map((r) => {
              const d = describe(r);
              return `
              <tr class="${r.active ? "" : "inactive-row"}">
                <td style="font-weight:600;">${UI.esc(r.name)}</td>
                <td style="font-size:13px;">${UI.esc(d.when)}</td>
                <td style="font-size:13px;">${UI.esc(d.then)}</td>
                <td>
                  <label class="switch">
                    <input type="checkbox" data-auto-toggle="${r.id}" ${r.active ? "checked" : ""}>
                    <span class="slider"></span>
                  </label>
                </td>
                <td style="text-align:right;white-space:nowrap;">
                  ${r.action_type === "call_webhook" ? `<button class="btn btn-secondary" data-auto-test="${r.id}" style="padding:4px 8px;font-size:12px;">Test</button>` : ""}
                  <button class="btn btn-secondary" data-auto-edit="${r.id}" style="padding:4px 8px;font-size:12px;">Edit</button>
                  <button class="btn btn-danger" data-auto-delete="${r.id}" style="padding:4px 8px;font-size:12px;">${deleteArmedFor === r.id ? "Confirm" : "Delete"}</button>
                </td>
              </tr>`;
            })
            .join("")}
        </tbody>
      </table>`;

    host.querySelectorAll("[data-auto-toggle]").forEach((input) => {
      input.addEventListener("change", async () => {
        const id = input.dataset.autoToggle;
        try {
          const updated = await API.updateAutomation(id, { active: input.checked });
          rules = rules.map((r) => (r.id === id ? updated : r));
          UI.toast(updated.active ? "Rule activated." : "Rule paused.", "success");
        } catch (e) {
          input.checked = !input.checked;
          UI.toast(e.message);
        }
      });
    });

    host.querySelectorAll("[data-auto-test]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        try {
          await API.sendTestAutomation(btn.dataset.autoTest);
          UI.toast("Test sent — check the receiving end in a few seconds.", "success");
        } catch (e) {
          UI.toast(e.message);
        }
        btn.disabled = false;
      });
    });

    host.querySelectorAll("[data-auto-edit]").forEach((btn) => {
      btn.addEventListener("click", () => fillForm(rules.find((r) => r.id === btn.dataset.autoEdit)));
    });

    host.querySelectorAll("[data-auto-delete]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.autoDelete;
        if (deleteArmedFor !== id) {
          deleteArmedFor = id;
          renderList();
          return;
        }
        try {
          await API.deleteAutomation(id);
          rules = rules.filter((r) => r.id !== id);
          deleteArmedFor = null;
          if (editing?.id === id) fillForm(null);
          UI.toast("Rule deleted.", "success");
          renderList();
        } catch (e) {
          UI.toast(e.message);
        }
      });
    });
  }

  // Show/hide the condition + config fields that match the selected
  // trigger/action, so the form only ever asks for what's needed.
  function syncFormVisibility() {
    const trigger = document.getElementById("a-trigger").value;
    const action = document.getElementById("a-action").value;
    document.getElementById("a-cond-status-group").hidden = trigger !== "status_changed";
    document.getElementById("a-cfg-url-group").hidden = action !== "call_webhook";
    document.getElementById("a-cfg-status-group").hidden = action !== "set_status";
    document.getElementById("a-cfg-member-group").hidden =
      action !== "set_assignee" && action !== "notify_user";
    document.getElementById("a-cfg-message-group").hidden = action !== "notify_user";
  }

  function fillForm(rule) {
    editing = rule || null;
    deleteArmedFor = null;
    const form = document.getElementById("automation-form");
    UI.clearFieldErrors(form);
    document.getElementById("automation-form-title").textContent = rule ? `Editing “${rule.name}”` : "New rule";
    document.getElementById("automation-save").textContent = rule ? "Save Changes" : "Add Rule";
    document.getElementById("automation-form-reset").hidden = !rule;
    document.getElementById("a-name").value = rule?.name || "";
    setSelect("a-trigger", rule?.trigger_type || "task_created");
    setSelect("a-to-status", rule?.conditions?.to_status || "");
    setSelect("a-action", rule?.action_type || "call_webhook");
    document.getElementById("a-url").value = rule?.action_config?.url || "";
    setSelect("a-set-status", rule?.action_config?.status || project.statuses[0]);
    setSelect("a-member", rule?.action_config?.member_id || "");
    document.getElementById("a-message").value = rule?.action_config?.message || "";
    syncFormVisibility();
  }

  function setSelect(id, value) {
    const el = document.getElementById(id);
    el.value = value;
    UI.syncSelect(el);
  }

  function fillSelects() {
    const statusOpts = project.statuses
      .map((s) => `<option value="${UI.esc(s)}">${UI.esc(s)}</option>`)
      .join("");
    document.getElementById("a-to-status").innerHTML = `<option value="">Any status</option>` + statusOpts;
    document.getElementById("a-set-status").innerHTML = statusOpts;
    document.getElementById("a-member").innerHTML = members
      .filter((m) => m.active)
      .map((m) => `<option value="${m.id}">${UI.esc(m.name)}</option>`)
      .join("");
    for (const id of ["a-trigger", "a-action", "a-to-status", "a-set-status", "a-member"]) {
      UI.enhanceSelect(document.getElementById(id));
    }
  }

  async function open() {
    try {
      rules = await API.getAutomations(project.id);
    } catch (e) {
      UI.toast(/does not exist|relation/i.test(e.message)
        ? "Automations need the 09_automations.sql migration — run it in Supabase first."
        : e.message);
      return;
    }
    document.getElementById("auto-project-name").textContent = project.name;
    fillForm(null);
    renderList();
    UI.openModal("automations-modal");
  }

  async function onSubmit(e) {
    e.preventDefault();
    const form = e.currentTarget;
    UI.clearFieldErrors(form);
    const nameInput = document.getElementById("a-name");
    const name = nameInput.value.trim();
    const trigger = document.getElementById("a-trigger").value;
    const action = document.getElementById("a-action").value;
    let valid = true;

    if (!name) {
      UI.fieldError(nameInput, "Give this rule a name.");
      valid = false;
    }
    const conditions = {};
    if (trigger === "status_changed") {
      const to = document.getElementById("a-to-status").value;
      if (to) conditions.to_status = to;
    }
    const config = {};
    if (action === "call_webhook") {
      const urlInput = document.getElementById("a-url");
      const url = urlInput.value.trim();
      if (!/^https:\/\/.+/.test(url)) {
        UI.fieldError(urlInput, "Enter a valid https:// URL.");
        valid = false;
      }
      config.url = url;
    } else if (action === "set_status") {
      config.status = document.getElementById("a-set-status").value;
    } else if (action === "set_assignee" || action === "notify_user") {
      config.member_id = document.getElementById("a-member").value;
      if (!config.member_id) {
        UI.toast("Pick a team member for this action.");
        valid = false;
      }
      if (action === "notify_user") {
        const msg = document.getElementById("a-message").value.trim();
        if (msg) config.message = msg;
      }
    }
    if (action === "set_status" && trigger === "status_changed" && conditions.to_status === config.status) {
      UI.toast("This rule would move the task to the status it just entered — pick a different one.");
      valid = false;
    }
    if (!valid) return;

    const fields = {
      project_id: project.id,
      name,
      trigger_type: trigger,
      conditions,
      action_type: action,
      action_config: config,
    };
    try {
      if (editing) {
        const updated = await API.updateAutomation(editing.id, fields);
        rules = rules.map((r) => (r.id === updated.id ? updated : r));
        UI.toast("Rule updated.", "success");
      } else {
        const created = await API.createAutomation(fields);
        rules.push(created);
        UI.toast("Rule added — it's live now.", "success");
      }
      fillForm(null);
      renderList();
    } catch (err) {
      UI.toast(err.message);
    }
  }

  function init(proj, mems) {
    project = proj;
    members = mems;
    const btn = document.getElementById("automations-btn");
    if (!btn || !Auth.isAdmin()) return;
    btn.hidden = false;
    fillSelects();
    btn.addEventListener("click", open);
    document.getElementById("automation-form").addEventListener("submit", onSubmit);
    document.getElementById("automations-close").addEventListener("click", () => UI.closeModal("automations-modal"));
    document.getElementById("automation-form-reset").addEventListener("click", () => fillForm(null));
    document.getElementById("a-trigger").addEventListener("change", syncFormVisibility);
    document.getElementById("a-action").addEventListener("change", syncFormVisibility);
  }

  return { init };
})();
