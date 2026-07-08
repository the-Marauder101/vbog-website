// Settings: team member management (add, activate/deactivate, guarded delete).

(() => {
  const tableHost = document.getElementById("members-table");
  const form = document.getElementById("add-member-form");
  let members = [];
  let projects = [];
  let webhooks = [];
  let deleteArmedFor = null;
  let webhookDeleteArmedFor = null;

  async function load() {
    try {
      [members, projects, webhooks] = await Promise.all([
        API.getMembers(),
        API.getProjects(),
        API.getWebhooks(),
      ]);
      render();
      initIntegrations();
    } catch (e) {
      tableHost.innerHTML = "";
      UI.toast(e.message);
    }
  }

  function render() {
    if (members.length === 0) {
      tableHost.innerHTML = `<div class="empty-state"><p>No team members yet — add one above.</p></div>`;
      return;
    }
    tableHost.innerHTML = `
      <table class="data-table">
        <thead>
          <tr><th>Name</th><th>Role</th><th>Active</th><th style="width:130px;"></th></tr>
        </thead>
        <tbody>
          ${members
            .map(
              (m) => `
              <tr class="${m.active ? "" : "inactive-row"}" data-id="${m.id}">
                <td style="font-weight:600;">${UI.esc(m.name)}</td>
                <td>${UI.esc(m.role || "—")}</td>
                <td>
                  <label class="switch">
                    <input type="checkbox" data-toggle="${m.id}" ${m.active ? "checked" : ""}>
                    <span class="slider"></span>
                  </label>
                </td>
                <td style="text-align:right;">
                  <button class="btn btn-danger" data-delete="${m.id}" style="padding:5px 10px;font-size:13px;">
                    ${deleteArmedFor === m.id ? "Confirm delete" : "Delete"}
                  </button>
                </td>
              </tr>`
            )
            .join("")}
        </tbody>
      </table>`;

    tableHost.querySelectorAll("[data-toggle]").forEach((input) => {
      input.addEventListener("change", async () => {
        const id = input.dataset.toggle;
        const active = input.checked;
        try {
          const updated = await API.updateMember(id, { active });
          members = members.map((m) => (m.id === id ? updated : m));
          UI.toast(active ? "Member activated." : "Member deactivated — hidden from assignee dropdowns.", "success");
          render();
        } catch (e) {
          input.checked = !active;
          UI.toast(e.message);
        }
      });
    });

    tableHost.querySelectorAll("[data-delete]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.delete;
        const member = members.find((m) => m.id === id);
        try {
          if (deleteArmedFor !== id) {
            // Guard: members with task assignments cannot be deleted (PRD F-09)
            const hasTasks = await API.memberHasTasks(id);
            if (hasTasks) {
              UI.toast(`${member.name} has tasks assigned. Reassign those tasks first, or deactivate instead.`);
              return;
            }
            deleteArmedFor = id;
            btn.textContent = "Confirm delete";
            btn.classList.add("confirming");
            return;
          }
          await API.deleteMember(id);
          members = members.filter((m) => m.id !== id);
          deleteArmedFor = null;
          UI.toast("Member deleted.", "success");
          render();
        } catch (e) {
          UI.toast(e.message);
        }
      });
    });
  }

  // ================= Integrations =================

  function activeProjects() {
    return projects.filter((p) => !p.archived);
  }

  function initIntegrations() {
    const opts = activeProjects()
      .map((p) => `<option value="${p.id}">${UI.esc(p.name)}</option>`)
      .join("");
    document.getElementById("w-project").innerHTML = `<option value="">All projects</option>` + opts;
    document.getElementById("snippet-project").innerHTML = `<option value="">Choose a project…</option>` + opts;
    UI.enhanceSelect(document.getElementById("w-project"));
    UI.enhanceSelect(document.getElementById("snippet-project"));
    renderWebhooks();
  }

  function projectName(id) {
    return projects.find((p) => p.id === id)?.name || "(deleted project)";
  }

  const EVENT_LABELS = { INSERT: "Created", UPDATE: "Updated", DELETE: "Deleted" };

  function renderWebhooks() {
    const host = document.getElementById("webhooks-table");
    if (webhooks.length === 0) {
      host.innerHTML = `<div class="form-hint">No webhooks yet — your first one takes about a minute to set up.</div>`;
      return;
    }
    host.innerHTML = `
      <table class="data-table">
        <thead>
          <tr><th>Label</th><th>URL</th><th>Scope</th><th>Events</th><th>Active</th><th style="width:190px;"></th></tr>
        </thead>
        <tbody>
          ${webhooks
            .map((w) => {
              const shortUrl = w.url.length > 34 ? w.url.slice(0, 34) + "…" : w.url;
              return `
              <tr class="${w.active ? "" : "inactive-row"}">
                <td style="font-weight:600;">${UI.esc(w.label)}</td>
                <td title="${UI.esc(w.url)}" style="color:var(--muted);font-size:13px;">${UI.esc(shortUrl)}</td>
                <td>${w.project_id ? UI.esc(projectName(w.project_id)) : "All projects"}</td>
                <td style="font-size:13px;">${w.events.map((e) => EVENT_LABELS[e] || e).join(", ")}</td>
                <td>
                  <label class="switch">
                    <input type="checkbox" data-wh-toggle="${w.id}" ${w.active ? "checked" : ""}>
                    <span class="slider"></span>
                  </label>
                </td>
                <td style="text-align:right;white-space:nowrap;">
                  <button class="btn btn-secondary" data-wh-test="${w.id}" style="padding:5px 10px;font-size:13px;">Send test</button>
                  <button class="btn btn-danger" data-wh-delete="${w.id}" style="padding:5px 10px;font-size:13px;">
                    ${webhookDeleteArmedFor === w.id ? "Confirm delete" : "Delete"}
                  </button>
                </td>
              </tr>`;
            })
            .join("")}
        </tbody>
      </table>`;

    host.querySelectorAll("[data-wh-toggle]").forEach((input) => {
      input.addEventListener("change", async () => {
        const id = input.dataset.whToggle;
        const active = input.checked;
        try {
          const updated = await API.updateWebhook(id, { active });
          webhooks = webhooks.map((w) => (w.id === id ? updated : w));
          UI.toast(active ? "Webhook activated." : "Webhook paused — no events will be sent.", "success");
          renderWebhooks();
        } catch (e) {
          input.checked = !active;
          UI.toast(e.message);
        }
      });
    });

    host.querySelectorAll("[data-wh-test]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        btn.textContent = "Sending…";
        try {
          await API.sendTestWebhook(btn.dataset.whTest);
          UI.toast("Test sent — check your Zap's trigger test in a few seconds.", "success");
        } catch (e) {
          UI.toast(e.message);
        }
        btn.disabled = false;
        btn.textContent = "Send test";
      });
    });

    host.querySelectorAll("[data-wh-delete]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.whDelete;
        if (webhookDeleteArmedFor !== id) {
          webhookDeleteArmedFor = id;
          btn.textContent = "Confirm delete";
          btn.classList.add("confirming");
          return;
        }
        try {
          await API.deleteWebhook(id);
          webhooks = webhooks.filter((w) => w.id !== id);
          webhookDeleteArmedFor = null;
          UI.toast("Webhook deleted.", "success");
          renderWebhooks();
        } catch (e) {
          UI.toast(e.message);
        }
      });
    });
  }

  document.getElementById("add-webhook-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const whForm = e.currentTarget;
    UI.clearFieldErrors(whForm);
    const labelInput = document.getElementById("w-label");
    const urlInput = document.getElementById("w-url");
    const label = labelInput.value.trim();
    const url = urlInput.value.trim();
    let valid = true;
    if (!label) {
      UI.fieldError(labelInput, "Label is required.");
      valid = false;
    }
    if (!/^https:\/\/.+/.test(url)) {
      UI.fieldError(urlInput, "Enter a valid https:// webhook URL.");
      valid = false;
    }
    const events = [
      document.getElementById("w-ev-insert").checked && "INSERT",
      document.getElementById("w-ev-update").checked && "UPDATE",
      document.getElementById("w-ev-delete").checked && "DELETE",
    ].filter(Boolean);
    if (events.length === 0) {
      UI.toast("Pick at least one event (created / updated / deleted).");
      valid = false;
    }
    if (!valid) return;

    try {
      const created = await API.createWebhook({
        label,
        url,
        project_id: document.getElementById("w-project").value || null,
        events,
      });
      webhooks.push(created);
      labelInput.value = "";
      urlInput.value = "";
      UI.toast("Webhook added — use Send test to verify it.", "success");
      renderWebhooks();
    } catch (err) {
      UI.toast(err.message);
    }
  });

  // ---- Incoming (Sheets -> app) snippet generator ----
  document.getElementById("snippet-project").addEventListener("change", (e) => {
    const out = document.getElementById("snippet-output");
    const project = projects.find((p) => p.id === e.target.value);
    if (!project) {
      out.hidden = true;
      return;
    }
    const activeMembers = members.filter((m) => m.active);
    const bodyTemplate = {
      project_id: project.id,
      title: "REPLACE with the task name from your sheet",
      notes: "REPLACE with notes, or delete this line",
      status: project.statuses[0],
      assignee_id: "REPLACE with a member ID from the list below, or delete this line",
      due_date: "REPLACE with date as YYYY-MM-DD, or delete this line",
      source: "zapier",
      external_id: "REPLACE with the sheet row ID",
    };
    const block = (title, content, hint) => `
      <div class="snippet-label">${UI.esc(title)}${hint ? ` <span class="form-hint" style="display:inline">${UI.esc(hint)}</span>` : ""}</div>
      <div class="code-block"><button class="copy-btn" type="button">Copy</button><pre>${UI.esc(content)}</pre></div>`;

    out.hidden = false;
    out.innerHTML =
      block("1 — Method + URL", `POST ${SUPABASE_URL}/rest/v1/tasks`) +
      block(
        "2 — Headers (add all four)",
        `apikey: ${SUPABASE_ANON_KEY}\nAuthorization: Bearer ${SUPABASE_ANON_KEY}\nContent-Type: application/json\nPrefer: return=representation`
      ) +
      block("3 — Data (JSON body)", JSON.stringify(bodyTemplate, null, 2), "map your sheet columns into the REPLACE values") +
      block(
        "Reference — valid statuses for this project",
        project.statuses.join("\n")
      ) +
      block(
        "Reference — member IDs for assignee_id",
        activeMembers.map((m) => `${m.name}: ${m.id}`).join("\n")
      );

    out.querySelectorAll(".copy-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(btn.nextElementSibling.textContent);
          btn.textContent = "Copied!";
          setTimeout(() => (btn.textContent = "Copy"), 1500);
        } catch (_) {
          UI.toast("Could not copy — select the text manually.");
        }
      });
    });
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    UI.clearFieldErrors(form);
    const nameInput = document.getElementById("m-name");
    const name = nameInput.value.trim();
    if (!name) {
      UI.fieldError(nameInput, "Name is required.");
      return;
    }
    if (members.some((m) => m.name.toLowerCase() === name.toLowerCase())) {
      UI.fieldError(nameInput, "A member with this name already exists.");
      return;
    }
    try {
      const created = await API.createMember({
        name,
        role: document.getElementById("m-role").value.trim() || null,
      });
      members.push(created);
      members.sort((a, b) => a.name.localeCompare(b.name));
      nameInput.value = "";
      document.getElementById("m-role").value = "";
      UI.toast("Member added.", "success");
      render();
    } catch (err) {
      UI.toast(err.message);
    }
  });

  load();
})();
