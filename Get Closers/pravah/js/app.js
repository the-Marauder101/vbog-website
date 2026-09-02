(function () {
  "use strict";

  const api = window.PravahApi;
  const parser = window.PravahReportParser;
  const state = {
    context: null, dashboard: {}, clients: [], placements: [], reports: [],
    attention: [], candidates: [], requirements: [], checkins: [], actions: [], syncClients: [], catalogClients: []
  };
  const byId = (id) => document.getElementById(id);
  const authScreen = byId("auth-screen");
  const accessScreen = byId("access-screen");
  const appShell = byId("app-shell");
  const formModal = byId("form-modal");
  const clientModal = byId("client-modal");
  const reportModal = byId("report-modal");
  const dynamicForm = byId("dynamic-form");
  const toast = byId("toast");
  const loadingBar = byId("loading-bar");
  let lastFocus = null;

  function esc(value) {
    return String(value ?? "—").replace(/[&<>'"]/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    })[character]);
  }
  function today() { return new Date().toISOString().slice(0, 10); }
  function addDays(date, days) { const value = new Date(date + "T00:00:00Z"); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); }
  function dateLabel(value) { if (!value) return "—"; return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value)); }
  function money(value, currency) { if (value === null || value === undefined) return "—"; return new Intl.NumberFormat("en-IN", { style: "currency", currency: currency || "INR", maximumFractionDigits: 0 }).format(Number(value)); }
  function valueOrNull(value) { return value === "" || value === null || value === undefined ? null : value; }
  function numberOrNull(value) { return valueOrNull(value) === null ? null : Number(value); }
  function badge(value) { const clean = String(value || "unknown").replaceAll("_", " "); return `<span class="badge badge-${esc(clean.replaceAll(" ", "-"))}">${esc(clean)}</span>`; }
  function option(value, label, selected) { return `<option value="${esc(value)}"${selected ? " selected" : ""}>${esc(label)}</option>`; }
  function emptyRow(columns, message) { return `<tr><td colspan="${columns}"><div class="table-empty">${esc(message)}</div></td></tr>`; }
  function setLoading(active) { loadingBar.hidden = !active; byId("sync-state").textContent = active ? "Updating…" : "Connected"; }
  function showToast(message, error) { toast.textContent = message; toast.classList.toggle("error", Boolean(error)); toast.classList.add("show"); window.setTimeout(() => toast.classList.remove("show"), 2600); }
  function isAdmin() { return Boolean(state.context?.is_admin); }
  function isInternal() { return Boolean(state.context?.is_internal); }

  function showView(name) {
    const target = byId(name) || byId("overview");
    document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view === target));
    document.querySelectorAll(".nav-link").forEach((link) => link.classList.toggle("active", link.dataset.view === target.id));
    byId("view-name").textContent = target.dataset.title;
    document.querySelector(".sidebar").classList.remove("open");
    document.querySelector(".mobile-nav").setAttribute("aria-expanded", "false");
  }
  function showSignedOut() { authScreen.hidden = false; accessScreen.hidden = true; appShell.hidden = true; }
  function showAccess(title, message) { authScreen.hidden = true; appShell.hidden = true; accessScreen.hidden = false; byId("access-title").textContent = title; byId("access-message").textContent = message; }
  function applyRoleView() {
    document.querySelectorAll("[data-internal]").forEach((node) => { node.hidden = !isInternal(); });
    document.querySelectorAll("[data-admin]").forEach((node) => { node.hidden = !isAdmin(); });
    byId("account-role").textContent = String(state.context.role || "staff").replaceAll("_", " ");
  }
  function showApp() { authScreen.hidden = true; accessScreen.hidden = true; appShell.hidden = false; byId("account-name").textContent = state.context.display_name || state.context.role; applyRoleView(); }

  async function loadApp() {
    setLoading(true);
    try {
      const context = await api.rpc("pravah_context");
      if (!context?.authorized) { showAccess("Your login works, but this Pravah workspace is not active.", "Staff access is approved through Nikash. Client and closer portals will be activated only after their restricted views are ready."); return; }
      state.context = context; showApp(); await loadData(); showView(window.location.hash.slice(1));
    } catch (error) {
      if (["PGRST202", "42883", "PGRST205"].includes(error.code)) showAccess("Pravah needs its V2A database setup.", "Run the reviewed Pravah migrations, then refresh.");
      else if (String(error.code) === "401") { api.signOut(); showSignedOut(); }
      else showAccess("Pravah could not load.", error.message);
    } finally { setLoading(false); }
  }
  async function loadData() {
    const results = await Promise.all([
      api.rpc("pravah_dashboard"), api.fetch("pravah_v_clients?select=*&order=business_name"),
      api.fetch("pravah_v_placements?select=*&order=joined_on.desc"), api.fetch("pravah_v_reports?select=*&order=period_end.desc&limit=100"),
      api.fetch("pravah_v_attention?select=*&order=due_on.asc.nullslast&limit=50"), api.fetch("candidates?select=id,full_name&order=full_name"),
      api.fetch("requirements?select=id,title,client_id,clients(business_name)&status=eq.open&order=opened_at.desc"),
      api.fetch("pravah_v_checkins?select=*&order=occurred_at.desc&limit=200"), api.fetch("pravah_v_actions?select=*&order=created_at.desc&limit=300"),
      api.fetch("pravah_v_client_sync_inbox?select=*&order=source_name"), api.fetch("clients?select=id,business_name&order=business_name")
    ]);
    [state.dashboard, state.clients, state.placements, state.reports, state.attention, state.candidates, state.requirements, state.checkins, state.actions, state.syncClients, state.catalogClients] = results;
    renderAll();
  }
  async function refreshData(message) { setLoading(true); try { await loadData(); if (message) showToast(message); } catch (error) { showToast(error.message, true); } finally { setLoading(false); } }
  async function runWrite(work, message) { setLoading(true); try { const result = await work(); await loadData(); showToast(message); return result; } catch (error) { showToast(error.message, true); throw error; } finally { setLoading(false); } }

  function renderAll() { renderMetrics(); renderAttention(); renderPlacements(); renderClients(); renderReports(); renderSyncClients(); fillReportPlacements(); }
  function renderMetrics() {
    const d = state.dashboard || {}; byId("metric-clients").textContent = d.active_clients ?? 0; byId("metric-closers").textContent = d.active_closers ?? 0;
    byId("metric-training").textContent = d.training_pass_rate == null ? "—" : d.training_pass_rate + "%"; byId("metric-target").textContent = d.closers_on_target == null ? "—" : d.closers_on_target + "%";
  }
  function renderAttention() {
    const host = byId("attention-list"); byId("attention-count").textContent = state.attention.length + " open";
    if (!state.attention.length) { host.innerHTML = '<div class="empty-state compact"><span class="empty-glyph">✓</span><h3>Nothing needs immediate attention</h3><p>Risks, blocked training and overdue actions will appear here.</p></div>'; return; }
    host.innerHTML = state.attention.map((item) => {
      const action = item.item_type === "action" && isInternal() ? `<button class="text-button" data-form="action-update" data-id="${item.item_id}">Update</button>` : "";
      return `<article class="data-item"><div><strong>${esc(item.title)}</strong><span>${esc(item.context)}</span></div><div>${badge(item.severity)}<small>${item.due_on ? "Due " + dateLabel(item.due_on) : "No due date"}</small>${action}</div></article>`;
    }).join("");
  }
  function renderPlacements() {
    const placementRows = byId("placement-rows"); const closerRows = byId("closer-rows");
    if (!state.placements.length) { placementRows.innerHTML = emptyRow(6, "No placements recorded yet."); closerRows.innerHTML = emptyRow(7, "No active closers recorded yet."); return; }
    placementRows.innerHTML = state.placements.map((p) => {
      let actions = "";
      if (isInternal() && p.placement_state === "active") {
        actions = p.training_id ? `<button class="text-button" data-form="checkpoint" data-id="${p.training_id}">Checkpoint</button><button class="text-button" data-form="training-update" data-id="${p.training_id}">Training</button>` : `<button class="text-button" data-form="training" data-id="${p.placement_id}">Start training</button>`;
        if (isAdmin()) actions += `<button class="text-button danger-link" data-form="placement-state" data-id="${p.placement_id}">End / void</button>`;
      }
      return `<tr><td><strong>${esc(p.closer_name)}</strong>${badge(p.placement_state)}</td><td>${esc(p.business_name)}<small>${esc(p.role_title || "Role not named")}</small></td><td>${dateLabel(p.joined_on)}</td><td>${badge(p.training_status)}${p.last_checkpoint_on ? `<small>${esc((p.last_checkpoint_outcome || "checkpoint").replaceAll("_", " "))} · ${dateLabel(p.last_checkpoint_on)}</small>` : ""}</td><td>${badge(p.risk_level || "none")}</td><td class="row-actions">${actions}</td></tr>`;
    }).join("");
    closerRows.innerHTML = state.placements.filter((p) => p.placement_state === "active").map((p) => `<tr><td><strong>${esc(p.closer_name)}</strong></td><td>${esc(p.business_name)}</td><td>${badge(p.training_status)}</td><td class="mono">${esc(p.total_sales)}</td><td class="mono">${money(p.verified_cash)}</td><td class="mono">${money(p.reported_cash)}</td><td class="row-actions">${isInternal() ? `<button class="text-button" data-report-placement="${p.placement_id}">Add report</button><button class="text-button" data-form="target" data-id="${p.placement_id}">Set target</button>` : ""}</td></tr>`).join("") || emptyRow(7, "No active closer placements.");
  }
  function renderClients() {
    const host = byId("client-grid");
    if (!state.clients.length) { host.innerHTML = '<div class="panel"><div class="empty-state"><span class="empty-glyph">C</span><h3>No active Pravah clients</h3><p>Refresh the Vyom client inbox, then verify and activate the correct client.</p><button class="button button-primary" data-sync-vyom data-internal>Refresh from Vyom</button></div></div>'; return; }
    host.innerHTML = state.clients.map((client) => `<article class="client-card"><div class="client-card-head"><div><p class="eyebrow">${esc(client.status)}</p><h2>${esc(client.business_name)}</h2><small class="source-line">${client.vyom_link_status === "linked" ? "Verified Vyom identity" : "Needs Vyom link"}</small></div>${badge(client.health)}</div><div class="client-stats"><div><strong>${esc(client.active_closers)}</strong><span>Active closers</span></div><div><strong>${esc(client.open_actions)}</strong><span>Open actions</span></div><div><strong>${client.last_checkin_at ? dateLabel(client.last_checkin_at) : "—"}</strong><span>Last check-in</span></div></div><div class="client-actions"><button class="button button-secondary" data-client-detail="${client.id}">Open client</button>${isInternal() ? `<button class="button button-ghost" data-form="checkin" data-id="${client.id}">Add check-in</button>` : ""}</div></article>`).join("");
  }
  function renderReports() {
    const host = byId("report-list"); if (!state.reports.length) { host.innerHTML = '<div class="report-empty">No reports yet.</div>'; return; }
    host.innerHTML = state.reports.map((r) => {
      const isVoided = Boolean(r.voided_at); const cash = r.cash_verification_status === "verified" ? money(r.verified_cash_collected, r.currency) : money(r.cash_collected, r.currency);
      return `<article class="report-item${isVoided ? " voided" : ""}"><div><strong>${esc(r.closer_name)}</strong><span>${esc(r.business_name)} · ${dateLabel(r.period_start)}–${dateLabel(r.period_end)}</span>${isVoided ? `<small>Voided: ${esc(r.void_reason)}</small>` : ""}</div><div><span>Calls / connected</span><b class="report-number">${esc(r.calls_attempted ?? "—")} / ${esc(r.connected_calls ?? "—")}</b></div><div><span>Sales / cash</span><b class="report-number">${esc(r.sales_count ?? "—")} / ${cash}</b>${badge(r.cash_verification_status)}</div><div class="report-actions"><button class="button button-secondary" data-copy-report="${r.id}" ${isVoided ? "disabled" : ""}>Copy for WhatsApp</button>${isInternal() && !isVoided ? `<button class="button button-ghost" data-form="verify-cash" data-id="${r.id}">Verify cash</button>` : ""}${isAdmin() && !isVoided ? `<button class="button button-ghost danger-link" data-form="void-report" data-id="${r.id}">Void</button>` : ""}</div></article>`;
    }).join("");
  }
  function renderSyncClients() {
    const host = byId("sync-client-rows"); if (!host) return; const visible = state.syncClients.filter((row) => row.status !== "ignored");
    if (!visible.length) { host.innerHTML = emptyRow(4, "Refresh from Vyom to load the client catalogue."); return; }
    host.innerHTML = visible.map((row) => {
      let action = "";
      if (row.status !== "linked") {
        action += row.suggested_client_id ? `<button class="button button-secondary" data-link-vyom="${row.source_client_id}" data-existing="${row.suggested_client_id}">Verify suggested link</button>` : `<button class="button button-secondary" data-link-vyom="${row.source_client_id}">Activate new</button>`;
        action += `<button class="text-button" data-form="link-client" data-id="${row.source_client_id}">Choose existing</button>`;
        if (isAdmin()) action += `<button class="text-button danger-link" data-ignore-vyom="${row.source_client_id}">Ignore</button>`;
      }
      return `<tr><td><strong>${esc(row.source_name)}</strong><small>${row.source_active ? "Active in Vyom" : "Paused in Vyom"}</small></td><td>${esc(row.suggested_client_name || "No exact match")}</td><td>${badge(row.status)}</td><td class="row-actions">${action}</td></tr>`;
    }).join("");
  }

  function fillReportPlacements(selected) { const select = byId("report-placement"); select.innerHTML = option("", "Choose closer and client") + state.placements.filter((p) => p.placement_state === "active").map((p) => option(p.placement_id, `${p.closer_name} · ${p.business_name}`, p.placement_id === selected)).join(""); }
  function openModal(modal) { lastFocus = document.activeElement; modal.hidden = false; document.body.style.overflow = "hidden"; }
  function closeModal(modal) { modal.hidden = true; document.body.style.overflow = ""; if (lastFocus) lastFocus.focus(); }
  function openReport(selectedPlacement) { const form = byId("report-form"); form.reset(); fillReportPlacements(selectedPlacement); form.elements.period_start.value = today(); form.elements.period_end.value = today(); form.elements.currency.value = "INR"; byId("report-placement").value = selectedPlacement || ""; openModal(reportModal); }
  async function saveReport(event) {
    event.preventDefault(); const form = event.currentTarget; const errorHost = form.querySelector("[data-report-error]"); const values = Object.fromEntries(new FormData(form).entries()); errorHost.textContent = "";
    if (!values.placement_id) { errorHost.textContent = "Choose the closer and client."; return; }
    if (values.period_end < values.period_start) { errorHost.textContent = "Period end cannot be before period start."; return; }
    const button = form.querySelector('[type="submit"]'); button.disabled = true;
    try {
      await runWrite(() => api.rpc("pravah_submit_report", {
        p_placement_id: values.placement_id, p_period_start: values.period_start, p_period_end: values.period_end,
        p_calls_attempted: numberOrNull(values.calls_attempted), p_connected_calls: numberOrNull(values.connected_calls), p_followups_completed: numberOrNull(values.followups_completed),
        p_qualified_opportunities: numberOrNull(values.qualified_opportunities), p_meetings_booked: numberOrNull(values.meetings_booked), p_sales_count: numberOrNull(values.sales_count),
        p_revenue_generated: numberOrNull(values.revenue_generated), p_cash_reported: numberOrNull(values.cash_reported), p_currency: values.currency,
        p_blocker: valueOrNull(values.blocker), p_support_required: valueOrNull(values.support_required), p_next_period_plan: valueOrNull(values.next_period_plan), p_additional_notes: valueOrNull(values.additional_notes)
      }), "Report saved. WhatsApp update is ready."); closeModal(reportModal);
    } catch (error) { errorHost.textContent = error.message; } finally { button.disabled = false; }
  }

  function field(name, label, type, value, attrs) { return `<label>${esc(label)}<input name="${name}" type="${type || "text"}" value="${esc(value || "")}" ${attrs || ""}></label>`; }
  function selectField(name, label, optionsHtml, attrs) { return `<label>${esc(label)}<select name="${name}" ${attrs || ""}>${optionsHtml}</select></label>`; }
  function textareaField(name, label, attrs, value) { return `<label class="full">${esc(label)}<textarea name="${name}" rows="4" ${attrs || ""}>${esc(value || "")}</textarea></label>`; }
  function formShell(fields, submitLabel, warning) { return `${warning ? `<div class="warning-box">${esc(warning)}</div>` : ""}<div class="form-grid">${fields}</div><p class="form-error" data-form-error role="alert"></p><div class="form-footer"><button class="button button-ghost" type="button" data-close-form>Cancel</button><button class="button button-primary" type="submit">${esc(submitLabel)}</button></div>`; }

  function openForm(type, id) {
    const headings = {
      placement: ["PLACEMENT", "Record placement"], training: ["TRAINING", "Start training"], checkpoint: ["TRAINING", "Add checkpoint"], "training-update": ["TRAINING", "Update training"],
      target: ["PERFORMANCE", "Set target"], checkin: ["CLIENT SUCCESS", "Record client check-in"], action: ["OWNERSHIP", "Add action"], "action-update": ["OWNERSHIP", "Update action"],
      "client-profile": ["CLIENT RECORD", "Edit operating profile"], "verify-cash": ["EVIDENCE", "Verify cash collected"], "void-report": ["CORRECTION", "Void report"],
      "placement-state": ["PLACEMENT", "End or void placement"], "archive-client": ["CLIENT RECORD", "Archive client"], "delete-client": ["DANGER ZONE", "Delete unused client"], "link-client": ["IDENTITY", "Link Vyom client"]
    };
    byId("form-modal-eyebrow").textContent = headings[type][0]; byId("form-modal-title").textContent = headings[type][1]; dynamicForm.dataset.type = type; dynamicForm.dataset.id = id || "";
    if (type === "placement") {
      const candidates = option("", "Choose candidate") + state.candidates.map((c) => option(c.id, c.full_name)).join("");
      const requirements = option("", "Choose open client role") + state.requirements.map((r) => option(r.id, `${r.clients?.business_name ? r.clients.business_name + " · " : ""}${r.title || "Untitled role"}`)).join("");
      dynamicForm.innerHTML = formShell(selectField("candidate_id", "Candidate from Nikash", candidates, "required") + selectField("requirement_id", "Client role from Nikash", requirements, "required") + field("joined_on", "Joined on", "date", today(), "required"), "Record placement");
    }
    if (type === "training") dynamicForm.innerHTML = formShell(field("started_on", "Started on", "date", today(), "required") + field("expected_completion_on", "Expected completion", "date", addDays(today(), 9), "required"), "Start training");
    if (type === "checkpoint") dynamicForm.innerHTML = formShell(field("checkpoint_on", "Checkpoint date", "date", today(), "required") + selectField("checkpoint_type", "Checkpoint type", ["attendance","product","roleplay","call_review","counselling","decision"].map((v) => option(v, v.replaceAll("_", " "))).join(""), "required") + field("rating", "Rating (1–5)", "number", "", 'min="1" max="5" step="0.1"') + selectField("outcome", "Outcome", ["on_track","watch","blocked","passed","failed"].map((v) => option(v, v.replaceAll("_", " "))).join(""), "required") + textareaField("note", "What happened and what changes next?", "required"), "Save checkpoint");
    if (type === "training-update") {
      const training = state.placements.find((p) => p.training_id === id) || {};
      dynamicForm.innerHTML = formShell(selectField("status", "Status", ["active","passed","extended","failed","withdrawn"].map((v) => option(v, v.replaceAll("_", " "), training.training_status === v)).join(""), "required") + selectField("risk_level", "Risk", ["none","watch","high"].map((v) => option(v, v, training.risk_level === v)).join(""), "required") + selectField("product_ready", "Product ready", option("", "Not decided", training.product_ready == null) + option("true", "Yes", training.product_ready === true) + option("false", "No", training.product_ready === false)) + field("roleplay_rating", "Roleplay rating (1–5)", "number", training.roleplay_rating || "", 'min="1" max="5" step="0.1"') + textareaField("decision_note", "Decision note"), "Save training update");
    }
    if (type === "target") dynamicForm.innerHTML = formShell(field("period_start", "Period start", "date", today(), "required") + field("period_end", "Period end", "date", addDays(today(), 29), "required") + selectField("target_unit", "Target type", option("revenue", "Revenue") + option("cash", "Verified cash collected") + option("sales", "Sales count"), "required") + field("target_value", "Target", "number", "", 'min="0" step="0.01" required') + field("currency", "Currency", "text", "INR", "required"), "Save target");
    if (type === "checkin") {
      const actionFields = [1, 2, 3].map((n) => `<div class="full action-builder"><strong>Action ${n}${n === 1 ? "" : " (optional)"}</strong><div class="form-grid three">${field(`action_${n}`, "Action", "text")}${field(`action_${n}_due`, "Due date", "date")}${selectField(`action_${n}_priority`, "Priority", ["normal","high","critical","low"].map((v) => option(v, v)).join(""))}</div></div>`).join("");
      dynamicForm.innerHTML = formShell(selectField("health", "Client health", option("healthy", "Healthy") + option("watch", "Watch") + option("at_risk", "At risk"), "required") + field("satisfaction", "Satisfaction (1–5)", "number", "", 'min="1" max="5"') + textareaField("summary", "What was discussed?", "required") + textareaField("client_visible_summary", "Summary safe to share with client") + textareaField("internal_notes", "Internal Get Closers notes") + textareaField("material_issue", "Material issue") + textareaField("root_cause", "Root cause") + actionFields, "Save check-in and actions");
    }
    if (type === "action") dynamicForm.innerHTML = formShell(field("title", "Action", "text", "", "required") + selectField("priority", "Priority", ["low","normal","high","critical"].map((v) => option(v, v, v === "normal")).join(""), "required") + field("due_on", "Due on", "date") + textareaField("detail", "Detail"), "Create action");
    if (type === "action-update") { const action = state.actions.find((a) => a.id === id) || {}; dynamicForm.innerHTML = formShell(`<div class="full record-context"><strong>${esc(action.title || "Action")}</strong><span>${esc(action.business_name || "")}</span></div>` + selectField("status", "Status", ["open","in_progress","blocked","done","cancelled"].map((v) => option(v, v.replaceAll("_", " "), action.status === v)).join(""), "required") + textareaField("completion_note", "Completion note (required when done)") + textareaField("cancellation_reason", "Cancellation reason (required when cancelled)"), "Update action"); }
    if (type === "client-profile") { const client = state.clients.find((c) => c.id === id) || {}; dynamicForm.innerHTML = formShell(selectField("status", "Operating status", ["onboarding","active","at_risk","paused","ended"].map((v) => option(v, v.replaceAll("_", " "), client.status === v)).join(""), "required") + selectField("checkin_cadence", "Check-in cadence", ["weekly","fortnightly","monthly"].map((v) => option(v, v, client.checkin_cadence === v)).join(""), "required") + textareaField("internal_notes", "Internal Get Closers notes", "", client.notes) + textareaField("client_visible_notes", "Notes safe to share with the client", "", client.client_visible_notes), "Save client profile"); }
    if (type === "verify-cash") dynamicForm.innerHTML = formShell(field("verified_cash", "Verified cash collected", "number", "", 'min="0" step="0.01" required') + selectField("source", "Evidence source", option("client_crm", "Client CRM") + option("google_sheet", "Google Sheet") + option("payment_gateway", "Payment gateway") + option("client_confirmation", "Client confirmation"), "required") + field("reference", "Deal / payment reference", "text") + field("url", "Proof or source URL", "url"), "Verify cash", "Only evidence-backed cash appears in official target achievement.");
    if (type === "void-report") dynamicForm.innerHTML = formShell(textareaField("reason", "Why is this report invalid?", "required"), "Void report", "The report stays in the audit history and is removed from KPIs.");
    if (type === "placement-state") dynamicForm.innerHTML = formShell(selectField("state", "New state", option("ended", "Ended") + option("void", "Void / entered by mistake"), "required") + field("ended_on", "Effective date", "date", today(), "required") + textareaField("reason", "Reason", "required"), "Confirm state change", "This does not erase training or reporting evidence.");
    if (type === "archive-client") dynamicForm.innerHTML = formShell(textareaField("reason", "Archive reason", "required"), "Archive client", "The client and its history remain searchable.");
    if (type === "delete-client") dynamicForm.innerHTML = formShell(field("confirmation", "Type DELETE to confirm", "text", "", "required"), "Delete unused client", "Deletion works only when no role, placement, check-in, action or Vyom link exists.");
    if (type === "link-client") { const row = state.syncClients.find((x) => x.source_client_id === id) || {}; const clients = option("", "Choose an existing Pravah/Nikash client") + state.catalogClients.map((c) => option(c.id, c.business_name, c.id === row.suggested_client_id)).join(""); dynamicForm.innerHTML = formShell(`<div class="full record-context"><strong>Vyom: ${esc(row.source_name)}</strong><span>Verify the identity—names alone are not treated as proof.</span></div>` + selectField("existing_client_id", "Existing client", clients, "required"), "Link verified identity"); }
    openModal(formModal);
  }

  async function submitDynamicForm(event) {
    event.preventDefault(); const type = dynamicForm.dataset.type; const id = dynamicForm.dataset.id; const values = Object.fromEntries(new FormData(dynamicForm).entries()); const submit = dynamicForm.querySelector('[type="submit"]'); const errorHost = dynamicForm.querySelector("[data-form-error]"); submit.disabled = true; errorHost.textContent = "";
    try {
      if (type === "placement") await api.rpc("pravah_create_placement", { p_candidate_id: values.candidate_id, p_requirement_id: values.requirement_id, p_joined_on: values.joined_on });
      if (type === "training") await api.rpc("pravah_start_training", { p_placement_id: id, p_started_on: values.started_on, p_expected_completion_on: values.expected_completion_on });
      if (type === "checkpoint") await api.rpc("pravah_add_training_checkpoint", { p_training_id: id, p_checkpoint_type: values.checkpoint_type, p_rating: numberOrNull(values.rating), p_outcome: values.outcome, p_note: values.note, p_checkpoint_on: values.checkpoint_on });
      if (type === "training-update") await api.rpc("pravah_update_training", { p_training_id: id, p_status: values.status, p_risk_level: values.risk_level, p_product_ready: values.product_ready === "" ? null : values.product_ready === "true", p_roleplay_rating: numberOrNull(values.roleplay_rating), p_decision_note: valueOrNull(values.decision_note) });
      if (type === "target") await api.rpc("pravah_set_target", { p_placement_id: id, p_period_start: values.period_start, p_period_end: values.period_end, p_target_value: Number(values.target_value), p_target_unit: values.target_unit, p_currency: values.currency });
      if (type === "checkin") { const actions = [1, 2, 3].filter((n) => values[`action_${n}`]?.trim()).map((n) => ({ title: values[`action_${n}`].trim(), due_on: values[`action_${n}_due`] || null, priority: values[`action_${n}_priority`] || "normal" })); await api.rpc("pravah_record_checkin_v2", { p_client_id: id, p_health: values.health, p_satisfaction: numberOrNull(values.satisfaction), p_summary: values.summary, p_client_visible_summary: valueOrNull(values.client_visible_summary), p_internal_notes: valueOrNull(values.internal_notes), p_material_issue: valueOrNull(values.material_issue), p_root_cause: valueOrNull(values.root_cause), p_actions: actions }); }
      if (type === "action") await api.rpc("pravah_create_action", { p_client_id: id, p_title: values.title, p_due_on: valueOrNull(values.due_on), p_placement_id: null, p_priority: values.priority, p_detail: valueOrNull(values.detail) });
      if (type === "action-update") await api.rpc("pravah_update_action", { p_action_id: id, p_status: values.status, p_completion_note: valueOrNull(values.completion_note), p_cancellation_reason: valueOrNull(values.cancellation_reason) });
      if (type === "client-profile") await api.rpc("pravah_update_client_profile", { p_client_id: id, p_status: values.status, p_checkin_cadence: values.checkin_cadence, p_internal_notes: valueOrNull(values.internal_notes), p_client_visible_notes: valueOrNull(values.client_visible_notes) });
      if (type === "verify-cash") await api.rpc("pravah_verify_report_cash", { p_report_id: id, p_verified_cash: Number(values.verified_cash), p_source: values.source, p_reference: valueOrNull(values.reference), p_url: valueOrNull(values.url) });
      if (type === "void-report") await api.rpc("pravah_void_report", { p_report_id: id, p_reason: values.reason });
      if (type === "placement-state") await api.rpc("pravah_set_placement_state", { p_placement_id: id, p_state: values.state, p_reason: values.reason, p_ended_on: values.ended_on });
      if (type === "archive-client") await api.rpc("pravah_archive_client", { p_client_id: id, p_reason: values.reason });
      if (type === "delete-client") { if (values.confirmation !== "DELETE") throw new Error("Type DELETE exactly to confirm."); await api.rpc("pravah_delete_unused_client", { p_client_id: id }); }
      if (type === "link-client") await api.rpc("pravah_link_vyom_client", { p_source_client_id: id, p_existing_client_id: values.existing_client_id });
      closeModal(formModal); await refreshData("Saved");
    } catch (error) { errorHost.textContent = error.message; } finally { submit.disabled = false; }
  }

  function openClientDetail(id) {
    const client = state.clients.find((c) => c.id === id); if (!client) return; byId("client-modal-title").textContent = client.business_name;
    const checkins = state.checkins.filter((row) => row.client_id === id); const actions = state.actions.filter((row) => row.client_id === id);
    byId("client-detail").innerHTML = `<div class="client-detail-summary"><div><span>Status</span>${badge(client.status)}</div><div><span>Health</span>${badge(client.health)}</div><div><span>Vyom identity</span>${badge(client.vyom_link_status)}</div><div><span>Check-in cadence</span><strong>${esc(client.checkin_cadence || "weekly")}</strong></div></div><div class="client-detail-actions" data-internal><button class="button button-primary" data-form="checkin" data-id="${id}">Add check-in</button><button class="button button-secondary" data-form="action" data-id="${id}">Add action</button><button class="button button-secondary" data-form="client-profile" data-id="${id}">Edit notes &amp; profile</button>${isAdmin() ? `<button class="button button-ghost danger-link" data-form="archive-client" data-id="${id}">Archive</button><button class="button button-ghost danger-link" data-form="delete-client" data-id="${id}">Delete if unused</button>` : ""}</div><div class="detail-grid"><section><h3>Actions</h3>${actions.length ? actions.map((a) => `<article class="timeline-item"><div><strong>${esc(a.title)}</strong>${badge(a.status)}</div><p>${esc(a.detail || "No additional detail")}</p><small>${esc(a.owner_name)} · ${a.due_on ? "Due " + dateLabel(a.due_on) : "No due date"}</small>${isInternal() && !["done","cancelled"].includes(a.status) ? `<button class="text-button" data-form="action-update" data-id="${a.id}">Update action</button>` : ""}</article>`).join("") : '<p class="detail-empty">No actions recorded.</p>'}</section><section><h3>Check-in history</h3>${checkins.length ? checkins.map((ci) => `<article class="timeline-item"><div><strong>${dateLabel(ci.occurred_at)}</strong>${badge(ci.health)}</div><p>${esc(ci.summary)}</p>${ci.material_issue ? `<small>Issue: ${esc(ci.material_issue)}</small>` : ""}${ci.root_cause ? `<small>Root cause: ${esc(ci.root_cause)}</small>` : ""}${ci.internal_notes ? `<small class="internal-note">Internal: ${esc(ci.internal_notes)}</small>` : ""}</article>`).join("") : '<p class="detail-empty">No check-ins recorded.</p>'}</section></div>`;
    openModal(clientModal); applyRoleView();
  }
  async function refreshVyom() { await runWrite(() => api.invoke("pravah-sync-vyom"), "Vyom client inbox refreshed"); }
  async function linkVyom(sourceId, existingId) { await runWrite(() => api.rpc("pravah_link_vyom_client", { p_source_client_id: sourceId, p_existing_client_id: existingId || null }), existingId ? "Client identity linked" : "Vyom client activated"); }
  async function ignoreVyom(sourceId) { await runWrite(() => api.rpc("pravah_ignore_vyom_client", { p_source_client_id: sourceId }), "Vyom client ignored"); }
  async function copyReport(id) { const report = state.reports.find((item) => item.id === id); if (!report || report.voided_at) return; try { await navigator.clipboard.writeText(parser.whatsappMessage(report)); showToast("WhatsApp update copied"); } catch (_error) { showToast("Copy was blocked by this browser", true); } }
  async function markShared(id) { await runWrite(() => api.rpc("pravah_mark_report_shared", { p_report_id: id }), "Marked as shared"); }
  function signOut() { api.signOut(); window.location.hash = ""; showSignedOut(); }

  byId("signin-form").addEventListener("submit", async (event) => { event.preventDefault(); const errorHost = byId("signin-error"); const button = event.currentTarget.querySelector("button"); const values = new FormData(event.currentTarget); button.disabled = true; errorHost.textContent = ""; try { await api.signIn(values.get("email"), values.get("password")); await loadApp(); } catch (error) { errorHost.textContent = error.message; } finally { button.disabled = false; } });
  byId("report-form").addEventListener("submit", saveReport); dynamicForm.addEventListener("submit", submitDynamicForm);
  document.querySelectorAll("[data-signout]").forEach((button) => button.addEventListener("click", signOut));
  document.querySelectorAll("[data-close-report]").forEach((button) => button.addEventListener("click", () => closeModal(reportModal)));
  document.querySelectorAll("[data-close-client]").forEach((button) => button.addEventListener("click", () => closeModal(clientModal)));
  formModal.addEventListener("click", (event) => { if (event.target === formModal || event.target.closest("[data-close-form]")) closeModal(formModal); }); reportModal.addEventListener("click", (event) => { if (event.target === reportModal) closeModal(reportModal); }); clientModal.addEventListener("click", (event) => { if (event.target === clientModal) closeModal(clientModal); });
  document.addEventListener("click", (event) => {
    const formButton = event.target.closest("[data-form]"); const reportButton = event.target.closest("[data-report-placement]"); const copyButton = event.target.closest("[data-copy-report]"); const sharedButton = event.target.closest("[data-shared-report]"); const clientButton = event.target.closest("[data-client-detail]"); const syncButton = event.target.closest("[data-sync-vyom]"); const linkButton = event.target.closest("[data-link-vyom]"); const ignoreButton = event.target.closest("[data-ignore-vyom]");
    if (formButton) { if (!clientModal.hidden) closeModal(clientModal); openForm(formButton.dataset.form, formButton.dataset.id); } if (reportButton) openReport(reportButton.dataset.reportPlacement); if (copyButton) copyReport(copyButton.dataset.copyReport); if (sharedButton) markShared(sharedButton.dataset.sharedReport).catch(() => {}); if (clientButton) openClientDetail(clientButton.dataset.clientDetail); if (syncButton) refreshVyom().catch(() => {}); if (linkButton) linkVyom(linkButton.dataset.linkVyom, linkButton.dataset.existing).catch(() => {}); if (ignoreButton) ignoreVyom(ignoreButton.dataset.ignoreVyom).catch(() => {}); if (event.target.closest("[data-open-report]")) openReport();
  });
  document.addEventListener("keydown", (event) => { if (event.key !== "Escape") return; if (!reportModal.hidden) closeModal(reportModal); if (!formModal.hidden) closeModal(formModal); if (!clientModal.hidden) closeModal(clientModal); });
  document.querySelector(".mobile-nav").addEventListener("click", (event) => { const sidebar = document.querySelector(".sidebar"); sidebar.classList.toggle("open"); event.currentTarget.setAttribute("aria-expanded", String(sidebar.classList.contains("open"))); });
  window.addEventListener("hashchange", () => { if (!appShell.hidden) showView(window.location.hash.slice(1)); });
  if (api.restore()) loadApp(); else showSignedOut();
})();
