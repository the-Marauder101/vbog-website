// js/hr-sla.js — SLA tracking for HR project boards
//
// Loaded by board.html; board.js calls HrSla.init(project, members) when the
// project has the sla feature enabled. Provides slaState(task) for visual
// indicators on task cards, and a modal for CRUD of SLA rules.
//
// SLA rule: "tasks in status X must move within N days."
// Computed from task.status_changed_at (set by the DB trigger in sql/13).

const HrSla = (() => {
  let project = null;
  let members = [];
  let rules = [];
  let editing = null;
  let deleteArmedFor = null;

  async function init(proj, mems) {
    project = proj;
    members = mems;
    const btn = document.getElementById("sla-btn");
    if (!btn || !Auth.isAdmin()) return;
    btn.hidden = false;
    try {
      rules = await API.getSlaRules(project.id);
    } catch (e) {
      if (/does not exist|relation/i.test(e.message)) {
        btn.hidden = true;
        return;
      }
    }
    btn.addEventListener("click", openModal);
    document.getElementById("sla-form").addEventListener("submit", onSubmit);
    document.getElementById("sla-close").addEventListener("click", () => UI.closeModal("sla-modal"));
    document.getElementById("sla-form-reset").addEventListener("click", () => fillForm(null));
  }

  function slaState(task) {
    if (!rules.length || !task.status_changed_at) return null;
    const rule = rules.find((r) => r.from_status === task.status);
    if (!rule) return null;
    const changedAt = new Date(task.status_changed_at);
    const now = new Date();
    const elapsedMs = now - changedAt;
    const elapsedDays = elapsedMs / 86400000;
    const deadline = rule.deadline_days;
    const daysLeft = deadline - elapsedDays;
    if (elapsedDays >= deadline) return { level: "breach", daysLeft: Math.floor(daysLeft), rule };
    if (elapsedDays >= deadline * 0.75) return { level: "warning", daysLeft: Math.ceil(daysLeft), rule };
    return { level: "ok", daysLeft: Math.ceil(daysLeft), rule };
  }

  function getRules() { return rules; }

  function openModal() {
    document.getElementById("sla-project-name").textContent = project.name;
    fillForm(null);
    renderList();
    UI.openModal("sla-modal");
  }

  function renderList() {
    const host = document.getElementById("sla-list");
    if (!rules.length) {
      host.innerHTML = '<div class="form-hint">No SLA rules yet — add your first one below.</div>';
      return;
    }
    host.innerHTML = `
      <table class="data-table">
        <thead><tr><th>Status</th><th>Deadline</th><th style="width:140px;"></th></tr></thead>
        <tbody>
          ${rules.map((r) => `
            <tr>
              <td style="font-weight:600;">${UI.esc(r.from_status)}</td>
              <td>${r.deadline_days} day${r.deadline_days === 1 ? "" : "s"}</td>
              <td style="text-align:right;white-space:nowrap;">
                <button class="btn btn-secondary" data-sla-edit="${r.id}" style="padding:4px 8px;font-size:12px;">Edit</button>
                <button class="btn btn-danger" data-sla-delete="${r.id}" style="padding:4px 8px;font-size:12px;">${deleteArmedFor === r.id ? "Confirm" : "Delete"}</button>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>`;

    host.querySelectorAll("[data-sla-edit]").forEach((btn) => {
      btn.addEventListener("click", () => fillForm(rules.find((r) => r.id === btn.dataset.slaEdit)));
    });

    host.querySelectorAll("[data-sla-delete]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.slaDelete;
        if (deleteArmedFor !== id) {
          deleteArmedFor = id;
          renderList();
          return;
        }
        try {
          await API.deleteSlaRule(id);
          rules = rules.filter((r) => r.id !== id);
          deleteArmedFor = null;
          if (editing?.id === id) fillForm(null);
          UI.toast("SLA rule deleted.", "success");
          renderList();
        } catch (e) {
          UI.toast(e.message);
        }
      });
    });
  }

  function fillForm(rule) {
    editing = rule || null;
    deleteArmedFor = null;
    const form = document.getElementById("sla-form");
    UI.clearFieldErrors(form);
    document.getElementById("sla-form-title").textContent = rule ? `Editing rule` : "New rule";
    document.getElementById("sla-save").textContent = rule ? "Save Changes" : "Add Rule";
    document.getElementById("sla-form-reset").hidden = !rule;

    const statusSel = document.getElementById("sla-status");
    statusSel.innerHTML = project.statuses
      .map((s) => `<option value="${UI.esc(s)}" ${s === rule?.from_status ? "selected" : ""}>${UI.esc(s)}</option>`)
      .join("");
    UI.enhanceSelect(statusSel);

    document.getElementById("sla-days").value = rule?.deadline_days || 2;
  }

  async function onSubmit(e) {
    e.preventDefault();
    const form = e.currentTarget;
    UI.clearFieldErrors(form);

    const fromStatus = document.getElementById("sla-status").value;
    const daysInput = document.getElementById("sla-days");
    const days = parseInt(daysInput.value, 10);
    let valid = true;

    if (!days || days < 1) {
      UI.fieldError(daysInput, "Enter at least 1 day.");
      valid = false;
    }
    if (!valid) return;

    const fields = {
      project_id: project.id,
      from_status: fromStatus,
      deadline_days: days,
    };

    try {
      if (editing) {
        const updated = await API.updateSlaRule(editing.id, fields);
        rules = rules.map((r) => (r.id === updated.id ? updated : r));
        UI.toast("SLA rule updated.", "success");
      } else {
        if (rules.some((r) => r.from_status === fromStatus)) {
          UI.toast("A rule for this status already exists — edit or delete it first.");
          return;
        }
        const created = await API.createSlaRule(fields);
        rules.push(created);
        UI.toast("SLA rule added.", "success");
      }
      fillForm(null);
      renderList();
    } catch (err) {
      UI.toast(err.message);
    }
  }

  return { init, slaState, getRules };
})();
