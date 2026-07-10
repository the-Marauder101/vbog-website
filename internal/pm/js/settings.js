// js/settings.js — page logic for settings.html, ADMIN ONLY (docs: ../ARCHITECTURE.md §4, §7)
//
// 1. Users & access: add users (name, job role, login ID, access level),
//    inline login-ID editing, role dropdown, per-project access popover for
//    externals (project_members table), activate/deactivate, guarded delete.
// 2. Project tags: the central registry feeding every tag dropdown — deleting
//    a tag also strips it from projects that use it.
// 3. Zapier: outgoing webhooks table + incoming setup-snippet generator.
// NOTE: the add-form submit buttons start disabled in the HTML and are enabled
// after load() — a fast submit used to race the initial fetch and get wiped.

(() => {
  if (!Auth.requireAdmin()) return;
  Auth.initNav();
  Inbox.init();

  const tableHost = document.getElementById("members-table");
  const form = document.getElementById("add-member-form");
  let members = [];
  let projects = [];
  let webhooks = [];
  let tags = [];
  let access = []; // [{member_id, project_id}] for external users
  let apiKeys = [];
  let apiKeysAvailable = true; // false until sql/10_api_ingest.sql has been run
  let deleteArmedFor = null;
  let webhookDeleteArmedFor = null;
  let tagDeleteArmedFor = null;
  let apiKeyDeleteArmedFor = null;

  const ROLE_LABELS = { admin: "Admin", member: "Member", external: "External" };

  async function load() {
    try {
      [members, projects, webhooks, tags, access] = await Promise.all([
        API.getMembers(),
        API.getProjects(),
        API.getWebhooks(),
        API.getTags(),
        API.getAllProjectAccess(),
      ]);
      // Separate fetch: the api_keys table only exists after sql/10 has run,
      // and its absence must not take down the rest of the Settings page.
      try {
        apiKeys = await API.getApiKeys();
      } catch (_) {
        apiKeysAvailable = false;
      }
      render();
      renderTags();
      initIntegrations();
      initApiKeys();
      // Data is authoritative now — accept form submits (buttons start disabled
      // so a fast submit can't race the initial load and get clobbered)
      document.querySelectorAll('form button[type="submit"]').forEach((b) => (b.disabled = false));
    } catch (e) {
      tableHost.innerHTML = "";
      UI.toast(e.message);
    }
  }

  function memberAccess(memberId) {
    return access.filter((a) => a.member_id === memberId).map((a) => a.project_id);
  }

  function render() {
    if (members.length === 0) {
      tableHost.innerHTML = `<div class="empty-state"><p>No team members yet — add one above.</p></div>`;
      return;
    }
    tableHost.innerHTML = `
      <table class="data-table">
        <thead>
          <tr><th>Name</th><th>Job role</th><th>Login ID</th><th>Access</th><th>Projects</th><th>Active</th><th style="width:130px;"></th></tr>
        </thead>
        <tbody>
          ${members
            .map((m) => {
              const isMe = m.id === Auth.user().id;
              const projCount = memberAccess(m.id).length;
              return `
              <tr class="${m.active ? "" : "inactive-row"}" data-id="${m.id}">
                <td style="font-weight:600;">${UI.esc(m.name)}${isMe ? ' <span class="you-tag">you</span>' : ""}</td>
                <td>${UI.esc(m.role || "—")}</td>
                <td><input type="text" class="login-code-input" data-code="${m.id}" value="${UI.esc(m.login_code || "")}" placeholder="none" autocomplete="off"></td>
                <td>
                  <select data-role="${m.id}" ${isMe ? "disabled" : ""}>
                    ${Object.entries(ROLE_LABELS)
                      .map(([v, l]) => `<option value="${v}" ${m.user_role === v ? "selected" : ""}>${l}</option>`)
                      .join("")}
                  </select>
                </td>
                <td>
                  ${
                    m.user_role === "external"
                      ? `<button class="btn btn-secondary access-btn" data-access="${m.id}" style="padding:5px 10px;font-size:13px;">${projCount} project${projCount === 1 ? "" : "s"}</button>`
                      : '<span class="form-hint" style="margin:0;">All projects</span>'
                  }
                </td>
                <td>
                  <label class="switch">
                    <input type="checkbox" data-toggle="${m.id}" ${m.active ? "checked" : ""} ${isMe ? "disabled" : ""}>
                    <span class="slider"></span>
                  </label>
                </td>
                <td style="text-align:right;">
                  ${isMe ? "" : `<button class="btn btn-danger" data-delete="${m.id}" style="padding:5px 10px;font-size:13px;">${deleteArmedFor === m.id ? "Confirm delete" : "Delete"}</button>`}
                </td>
              </tr>`;
            })
            .join("")}
        </tbody>
      </table>`;

    // Login ID inline edit (saved on blur / Enter)
    tableHost.querySelectorAll("[data-code]").forEach((input) => {
      const save = async () => {
        const id = input.dataset.code;
        const member = members.find((m) => m.id === id);
        const code = input.value.trim().toLowerCase() || null;
        if (code === (member.login_code || null)) return;
        try {
          const updated = await API.updateMember(id, { login_code: code });
          members = members.map((m) => (m.id === id ? updated : m));
          UI.toast(code ? `Login ID for ${member.name} is now “${code}”.` : `${member.name} can no longer log in (no ID).`, "success");
        } catch (e) {
          input.value = member.login_code || "";
          UI.toast(/duplicate|unique/i.test(e.message) ? "That login ID is already taken." : e.message);
        }
      };
      input.addEventListener("blur", save);
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") input.blur(); });
    });

    // Access level dropdown
    tableHost.querySelectorAll("select[data-role]").forEach((sel) => {
      UI.enhanceSelect(sel);
      sel.addEventListener("change", async () => {
        const id = sel.dataset.role;
        try {
          const updated = await API.updateMember(id, { user_role: sel.value });
          members = members.map((m) => (m.id === id ? updated : m));
          UI.toast(`${updated.name} is now ${ROLE_LABELS[updated.user_role]}.`, "success");
          render();
        } catch (e) {
          UI.toast(e.message);
        }
      });
    });

    // Project access popover for externals
    tableHost.querySelectorAll("[data-access]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        openAccessPopover(btn, btn.dataset.access);
      });
    });

    tableHost.querySelectorAll("[data-toggle]").forEach((input) => {
      input.addEventListener("change", async () => {
        const id = input.dataset.toggle;
        const active = input.checked;
        try {
          const updated = await API.updateMember(id, { active });
          members = members.map((m) => (m.id === id ? updated : m));
          UI.toast(active ? "Member activated." : "Member deactivated — hidden from assignee dropdowns and locked out.", "success");
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

  // Checklist popover: which projects an external user can see
  function openAccessPopover(anchor, memberId) {
    document.getElementById("access-popover")?.remove();
    const mine = new Set(memberAccess(memberId));
    const pop = document.createElement("div");
    pop.id = "access-popover";
    pop.className = "access-popover";
    const activeProjects = projects.filter((p) => !p.archived);
    pop.innerHTML = activeProjects.length
      ? activeProjects
          .map(
            (p) => `
          <label class="access-row">
            <input type="checkbox" data-pid="${p.id}" ${mine.has(p.id) ? "checked" : ""}>
            <span class="access-dot" style="background:${UI.esc(p.color || "#C3CAD5")}"></span>
            ${UI.esc(p.name)}
          </label>`
          )
          .join("")
      : '<div class="form-hint" style="margin:8px;">No active projects.</div>';
    document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect();
    pop.style.top = `${r.bottom + window.scrollY + 6}px`;
    pop.style.left = `${Math.min(r.left + window.scrollX, window.innerWidth - 280)}px`;

    pop.querySelectorAll("input[data-pid]").forEach((cb) => {
      cb.addEventListener("change", async () => {
        const pid = cb.dataset.pid;
        try {
          if (cb.checked) {
            await API.addProjectAccess(memberId, pid);
            access.push({ member_id: memberId, project_id: pid });
          } else {
            await API.removeProjectAccess(memberId, pid);
            access = access.filter((a) => !(a.member_id === memberId && a.project_id === pid));
          }
          const n = memberAccess(memberId).length;
          anchor.textContent = `${n} project${n === 1 ? "" : "s"}`;
        } catch (e) {
          cb.checked = !cb.checked;
          UI.toast(e.message);
        }
      });
    });

    const closeOnOutside = (e) => {
      if (!pop.contains(e.target)) {
        pop.remove();
        document.removeEventListener("click", closeOnOutside);
      }
    };
    setTimeout(() => document.addEventListener("click", closeOnOutside), 0);
  }

  // ================= Project tags =================

  function renderTags() {
    const host = document.getElementById("tags-table");
    if (!host) return;
    const usage = (name) => projects.filter((p) => (p.tags || []).includes(name)).length;
    host.innerHTML = tags.length
      ? `<div class="tags-list">${tags
          .map((t) => {
            const n = usage(t.name);
            return `
            <span class="tag-chip managed">
              ${UI.esc(t.name)}
              <span class="tag-usage">${n}</span>
              <button type="button" data-tag-delete="${t.id}" title="${tagDeleteArmedFor === t.id ? "Click again to confirm" : "Delete tag"}" class="${tagDeleteArmedFor === t.id ? "confirming" : ""}">&times;</button>
            </span>`;
          })
          .join("")}</div>`
      : `<div class="form-hint">No tags yet — add your first one above (e.g. Marketing, HR, Ops).</div>`;

    host.querySelectorAll("[data-tag-delete]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.tagDelete;
        const tag = tags.find((t) => t.id === id);
        if (tagDeleteArmedFor !== id) {
          tagDeleteArmedFor = id;
          renderTags();
          return;
        }
        try {
          await API.deleteTag(id);
          // Strip the deleted name from any projects still carrying it
          const affected = projects.filter((p) => (p.tags || []).includes(tag.name));
          for (const p of affected) {
            const next = p.tags.filter((x) => x !== tag.name);
            await API.updateProject(p.id, { tags: next });
            p.tags = next;
          }
          tags = tags.filter((t) => t.id !== id);
          tagDeleteArmedFor = null;
          UI.toast(`Tag “${tag.name}” deleted${affected.length ? ` and removed from ${affected.length} project${affected.length === 1 ? "" : "s"}` : ""}.`, "success");
          renderTags();
        } catch (e) {
          UI.toast(e.message);
        }
      });
    });
  }

  document.getElementById("add-tag-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = document.getElementById("tag-name");
    UI.clearFieldErrors(e.target);
    const name = input.value.trim();
    if (!name) {
      UI.fieldError(input, "Tag name is required.");
      return;
    }
    if (tags.some((t) => t.name.toLowerCase() === name.toLowerCase())) {
      UI.fieldError(input, "That tag already exists.");
      return;
    }
    try {
      const created = await API.createTag(name);
      tags.push(created);
      tags.sort((a, b) => a.name.localeCompare(b.name));
      input.value = "";
      UI.toast(`Tag “${created.name}” added.`, "success");
      renderTags();
    } catch (err) {
      UI.toast(err.message);
    }
  });

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

  // ================= Vyom API keys (native inbound API) =================

  function initApiKeys() {
    const sel = document.getElementById("k-project");
    if (!sel) return;
    if (!apiKeysAvailable) {
      document.getElementById("apikeys-table").innerHTML =
        `<div class="warn-box">API keys need the <code>10_api_ingest.sql</code> migration — run it in the Supabase SQL Editor, then reload.</div>`;
      document.getElementById("add-apikey-form").querySelector("button[type=submit]").disabled = true;
      return;
    }
    sel.innerHTML =
      `<option value="">Choose a project…</option>` +
      activeProjects().map((p) => `<option value="${p.id}">${UI.esc(p.name)}</option>`).join("");
    UI.enhanceSelect(sel);
    renderApiKeys();
  }

  function renderApiKeys() {
    const host = document.getElementById("apikeys-table");
    if (apiKeys.length === 0) {
      host.innerHTML = `<div class="form-hint">No API keys yet — generate one above to start creating tasks from your own scripts.</div>`;
      document.getElementById("apikey-snippets").hidden = true;
      return;
    }
    host.innerHTML = `
      <table class="data-table">
        <thead>
          <tr><th>Label</th><th>Project</th><th>Key</th><th>Last used</th><th>Active</th><th style="width:190px;"></th></tr>
        </thead>
        <tbody>
          ${apiKeys
            .map(
              (k) => `
              <tr class="${k.active ? "" : "inactive-row"}">
                <td style="font-weight:600;">${UI.esc(k.label)}</td>
                <td>${UI.esc(projectName(k.project_id))}</td>
                <td style="font-family:monospace;font-size:12px;" title="Click Copy for the full key">${UI.esc(k.key.slice(0, 12))}…</td>
                <td style="font-size:13px;color:var(--muted);">${k.last_used_at ? UI.fmtDate(k.last_used_at.slice(0, 10)) : "never"}</td>
                <td>
                  <label class="switch">
                    <input type="checkbox" data-key-toggle="${k.id}" ${k.active ? "checked" : ""}>
                    <span class="slider"></span>
                  </label>
                </td>
                <td style="text-align:right;white-space:nowrap;">
                  <button class="btn btn-secondary" data-key-copy="${k.id}" style="padding:5px 10px;font-size:13px;">Copy</button>
                  <button class="btn btn-secondary" data-key-snippet="${k.id}" style="padding:5px 10px;font-size:13px;">Setup</button>
                  <button class="btn btn-danger" data-key-delete="${k.id}" style="padding:5px 10px;font-size:13px;">${apiKeyDeleteArmedFor === k.id ? "Confirm" : "Revoke"}</button>
                </td>
              </tr>`
            )
            .join("")}
        </tbody>
      </table>`;

    host.querySelectorAll("[data-key-toggle]").forEach((input) => {
      input.addEventListener("change", async () => {
        const id = input.dataset.keyToggle;
        try {
          const updated = await API.updateApiKey(id, { active: input.checked });
          apiKeys = apiKeys.map((k) => (k.id === id ? updated : k));
          UI.toast(updated.active ? "Key activated." : "Key paused — requests with it will be rejected.", "success");
          renderApiKeys();
        } catch (e) {
          input.checked = !input.checked;
          UI.toast(e.message);
        }
      });
    });

    host.querySelectorAll("[data-key-copy]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const k = apiKeys.find((x) => x.id === btn.dataset.keyCopy);
        try {
          await navigator.clipboard.writeText(k.key);
          UI.toast("API key copied.", "success");
        } catch (_) {
          UI.toast("Could not copy — open Setup and copy from there.");
        }
      });
    });

    host.querySelectorAll("[data-key-snippet]").forEach((btn) => {
      btn.addEventListener("click", () => showApiSnippets(apiKeys.find((x) => x.id === btn.dataset.keySnippet)));
    });

    host.querySelectorAll("[data-key-delete]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.keyDelete;
        if (apiKeyDeleteArmedFor !== id) {
          apiKeyDeleteArmedFor = id;
          renderApiKeys();
          return;
        }
        try {
          await API.deleteApiKey(id);
          apiKeys = apiKeys.filter((k) => k.id !== id);
          apiKeyDeleteArmedFor = null;
          UI.toast("Key revoked — any script using it stops working now.", "success");
          renderApiKeys();
        } catch (e) {
          UI.toast(e.message);
        }
      });
    });
  }

  function showApiSnippets(k) {
    const out = document.getElementById("apikey-snippets");
    const project = projects.find((p) => p.id === k.project_id);
    const endpoint = `${SUPABASE_URL}/rest/v1/rpc/ingest_task`;
    const body = {
      p_api_key: k.key,
      p_title: "REPLACE with the task name",
      p_notes: "REPLACE with notes, or delete this line",
      p_status: project?.statuses?.[0] || "To Do",
      p_due_date: "REPLACE as YYYY-MM-DD, or delete this line",
      p_external_id: "REPLACE with your row/record ID, or delete this line",
      p_fields: { email: "REPLACE with contact email for automations, or delete p_fields" },
    };
    const curl = `curl -X POST '${endpoint}' \\
  -H 'apikey: ${SUPABASE_ANON_KEY}' \\
  -H 'Authorization: Bearer ${SUPABASE_ANON_KEY}' \\
  -H 'Content-Type: application/json' \\
  -d '{"p_api_key":"${k.key}","p_title":"My first API task"}'`;
    const appsScript = `// Google Apps Script — send one row to Vyom as a task
function createVyomTask(title, notes, dueDate, contactEmail) {
  const res = UrlFetchApp.fetch("${endpoint}", {
    method: "post",
    contentType: "application/json",
    headers: {
      apikey: "${SUPABASE_ANON_KEY}",
      Authorization: "Bearer ${SUPABASE_ANON_KEY}",
    },
    payload: JSON.stringify({
      p_api_key: "${k.key}",
      p_title: title,
      p_notes: notes || null,
      p_due_date: dueDate || null, // "YYYY-MM-DD"
      p_fields: contactEmail ? { email: contactEmail } : {}, // used by email automations
    }),
  });
  Logger.log(res.getContentText()); // {"ok":true,"task_id":"…"}
}`;
    const block = (title, content) => `
      <div class="snippet-label">${UI.esc(title)}</div>
      <div class="code-block"><button class="copy-btn" type="button">Copy</button><pre>${UI.esc(content)}</pre></div>`;

    out.hidden = false;
    out.innerHTML =
      `<div class="snippet-label" style="font-weight:600;">Setup for “${UI.esc(k.label)}” → ${UI.esc(projectName(k.project_id))}</div>` +
      block("Endpoint", `POST ${endpoint}`) +
      block("JSON body (only p_api_key and p_title are required)", JSON.stringify(body, null, 2)) +
      block("curl example", curl) +
      block("Google Apps Script example", appsScript);

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
    out.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  document.getElementById("add-apikey-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const kForm = e.currentTarget;
    UI.clearFieldErrors(kForm);
    const labelInput = document.getElementById("k-label");
    const projSel = document.getElementById("k-project");
    const label = labelInput.value.trim();
    let valid = true;
    if (!projSel.value) {
      UI.toast("Pick which project this key can create tasks in.");
      valid = false;
    }
    if (!label) {
      UI.fieldError(labelInput, "Label is required (what will use this key?).");
      valid = false;
    }
    if (!valid) return;
    try {
      const created = await API.createApiKey({ project_id: projSel.value, label });
      apiKeys.push(created);
      labelInput.value = "";
      UI.toast("Key generated — open Setup for copy-paste snippets.", "success");
      renderApiKeys();
      showApiSnippets(created);
    } catch (err) {
      UI.toast(err.message);
    }
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
    const codeInput = document.getElementById("m-code");
    const loginCode = codeInput.value.trim().toLowerCase() || null;
    if (loginCode && members.some((m) => (m.login_code || "").toLowerCase() === loginCode)) {
      UI.fieldError(codeInput, "That login ID is already taken.");
      return;
    }
    try {
      const created = await API.createMember({
        name,
        role: document.getElementById("m-role").value.trim() || null,
        login_code: loginCode,
        user_role: document.getElementById("m-access").value,
      });
      members.push(created);
      members.sort((a, b) => a.name.localeCompare(b.name));
      nameInput.value = "";
      document.getElementById("m-role").value = "";
      codeInput.value = "";
      const accessSel = document.getElementById("m-access");
      accessSel.value = "member";
      UI.syncSelect(accessSel);
      UI.toast(created.user_role === "external"
        ? "External user added — now pick which projects they can see."
        : "Member added.", "success");
      render();
    } catch (err) {
      UI.toast(err.message);
    }
  });

  UI.enhanceSelect(document.getElementById("m-access"));

  load();
})();
