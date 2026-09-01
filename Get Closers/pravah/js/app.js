(function () {
  "use strict";
  const api = window.PravahApi;
  const parser = window.PravahReportParser;
  const state = { context: null, dashboard: {}, clients: [], placements: [], reports: [], attention: [], candidates: [], requirements: [] };
  const authScreen = document.getElementById("auth-screen");
  const accessScreen = document.getElementById("access-screen");
  const appShell = document.getElementById("app-shell");
  const formModal = document.getElementById("form-modal");
  const reportModal = document.getElementById("report-modal");
  const dynamicForm = document.getElementById("dynamic-form");
  const reportInput = document.getElementById("report-input");
  const reportPreview = document.getElementById("report-preview");
  const parseMessage = document.getElementById("parse-message");
  const saveReportButton = document.querySelector("[data-save-report]");
  const toast = document.getElementById("toast");
  const loadingBar = document.getElementById("loading-bar");
  let parsedDraft = null;
  let lastFocus = null;

  const example = ["Closer: Aisha", "Client: Acme", "Calls: 47", "Connected: 19", "Positive leads: 5", "Sales: 2", "Revenue: 150000", "Cash collected: 80000", "Blocker: More qualified leads needed", "Next step: Review follow-ups tomorrow"].join("\n");
  const labels = { closer_name: "Closer", client_name: "Client", report_date: "Date", calls_attempted: "Calls", connected_calls: "Connected", qualified_opportunities: "Qualified", sales_count: "Sales", revenue_generated: "Revenue", cash_collected: "Cash collected", blocker: "Blocker", next_period_plan: "Next step" };

  function escapeHtml(value) {
    return String(value ?? "—").replace(/[&<>'"]/g, function (character) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]; });
  }
  function today() { return new Date().toISOString().slice(0, 10); }
  function addDays(date, days) { const value = new Date(date + "T00:00:00Z"); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); }
  function money(value, currency) { if (value === null || value === undefined) return "—"; return new Intl.NumberFormat("en-IN", { style: "currency", currency: currency || "INR", maximumFractionDigits: 0 }).format(Number(value)); }
  function dateLabel(value) { if (!value) return "—"; return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value)); }
  function badge(value) { const clean = String(value || "unknown").replaceAll("_", " "); return '<span class="badge badge-' + escapeHtml(clean.replaceAll(" ", "-")) + '">' + escapeHtml(clean) + '</span>'; }
  function option(value, label, selected) { return '<option value="' + escapeHtml(value) + '"' + (selected ? " selected" : "") + '>' + escapeHtml(label) + '</option>'; }
  function emptyRow(columns, message) { return '<tr><td colspan="' + columns + '"><div class="table-empty">' + escapeHtml(message) + '</div></td></tr>'; }
  function setLoading(active) { loadingBar.hidden = !active; document.getElementById("sync-state").textContent = active ? "Updating…" : "Connected"; }
  function showToast(message, error) { toast.textContent = message; toast.classList.toggle("error", Boolean(error)); toast.classList.add("show"); window.setTimeout(function () { toast.classList.remove("show"); }, 2200); }

  function showView(name) {
    const target = document.getElementById(name) || document.getElementById("overview");
    document.querySelectorAll(".view").forEach(function (view) { view.classList.toggle("active", view === target); });
    document.querySelectorAll(".nav-link").forEach(function (link) { link.classList.toggle("active", link.dataset.view === target.id); });
    document.getElementById("view-name").textContent = target.dataset.title;
    document.querySelector(".sidebar").classList.remove("open");
    document.querySelector(".mobile-nav").setAttribute("aria-expanded", "false");
  }

  function showSignedOut() { authScreen.hidden = false; accessScreen.hidden = true; appShell.hidden = true; }
  function showAccess(title, message) {
    authScreen.hidden = true; appShell.hidden = true; accessScreen.hidden = false;
    document.getElementById("access-title").textContent = title;
    document.getElementById("access-message").textContent = message;
  }
  function showApp() {
    authScreen.hidden = true; accessScreen.hidden = true; appShell.hidden = false;
    document.getElementById("account-name").textContent = state.context.display_name || state.context.role;
  }

  async function loadApp() {
    setLoading(true);
    try {
      const context = await api.rpc("pravah_context");
      if (!context || !context.authorized) { showAccess("Your login works, but Pravah access is not active.", "Ask a Get Closers administrator to add your approved membership."); return; }
      state.context = context; showApp(); await loadData(); showView(window.location.hash.slice(1));
    } catch (error) {
      if (["PGRST202", "42883", "PGRST205"].includes(error.code)) showAccess("Pravah needs its one-time database setup.", "Run Get Closers/supabase/01_pravah_core.sql in the Closer-Match Supabase SQL Editor, then refresh.");
      else if (String(error.code) === "401") { api.signOut(); showSignedOut(); }
      else showAccess("Pravah could not load.", error.message);
    } finally { setLoading(false); }
  }

  async function loadData() {
    const results = await Promise.all([
      api.rpc("pravah_dashboard"),
      api.fetch("pravah_v_clients?select=*&order=business_name"),
      api.fetch("pravah_v_placements?select=*&order=joined_on.desc"),
      api.fetch("pravah_v_reports?select=*&order=period_end.desc&limit=100"),
      api.fetch("pravah_v_attention?select=*&order=due_on.asc.nullslast&limit=25"),
      api.fetch("candidates?select=id,full_name&order=full_name"),
      api.fetch("requirements?select=id,title,client_id,clients(business_name)&status=eq.open&order=opened_at.desc")
    ]);
    [state.dashboard, state.clients, state.placements, state.reports, state.attention, state.candidates, state.requirements] = results;
    renderAll();
  }

  function renderAll() { renderMetrics(); renderAttention(); renderPlacements(); renderClients(); renderReports(); fillReportPlacements(); }
  function renderMetrics() {
    const d = state.dashboard || {};
    document.getElementById("metric-clients").textContent = d.active_clients ?? 0;
    document.getElementById("metric-closers").textContent = d.active_closers ?? 0;
    document.getElementById("metric-training").textContent = d.training_pass_rate == null ? "—" : d.training_pass_rate + "%";
    document.getElementById("metric-target").textContent = d.closers_on_target == null ? "—" : d.closers_on_target + "%";
  }
  function renderAttention() {
    const host = document.getElementById("attention-list");
    document.getElementById("attention-count").textContent = state.attention.length + " open";
    if (!state.attention.length) { host.innerHTML = '<div class="empty-state compact"><span class="empty-glyph">✓</span><h3>Nothing needs immediate attention</h3><p>Risks, blocked training and overdue actions will appear here.</p></div>'; return; }
    host.innerHTML = state.attention.map(function (item) { const complete = item.item_type === "action" ? '<button class="text-button" data-complete-action="' + item.item_id + '">Mark done</button>' : ""; return '<article class="data-item"><div><strong>' + escapeHtml(item.title) + '</strong><span>' + escapeHtml(item.context) + '</span></div><div>' + badge(item.severity) + '<small>' + (item.due_on ? "Due " + dateLabel(item.due_on) : "No due date") + '</small>' + complete + '</div></article>'; }).join("");
  }
  function renderPlacements() {
    const placementRows = document.getElementById("placement-rows");
    const closerRows = document.getElementById("closer-rows");
    if (!state.placements.length) {
      placementRows.innerHTML = emptyRow(6, "No placements recorded yet.");
      closerRows.innerHTML = emptyRow(6, "No active closers recorded yet."); return;
    }
    placementRows.innerHTML = state.placements.map(function (p) {
      const action = p.training_id ? '<button class="text-button" data-form="checkpoint" data-id="' + p.training_id + '">Add checkpoint</button><button class="text-button" data-form="training-update" data-id="' + p.training_id + '">Update training</button>' : '<button class="text-button" data-form="training" data-id="' + p.placement_id + '">Start training</button>';
      const checkpoint = p.last_checkpoint_on ? '<small>' + escapeHtml((p.last_checkpoint_outcome || "checkpoint").replaceAll("_", " ")) + ' · ' + dateLabel(p.last_checkpoint_on) + '</small>' : "";
      return '<tr><td><strong>' + escapeHtml(p.closer_name) + '</strong></td><td>' + escapeHtml(p.business_name) + '<small>' + escapeHtml(p.role_title || "Role not named") + '</small></td><td>' + dateLabel(p.joined_on) + '</td><td>' + badge(p.training_status) + checkpoint + '</td><td>' + badge(p.risk_level || "none") + '</td><td class="row-actions">' + action + '</td></tr>';
    }).join("");
    closerRows.innerHTML = state.placements.map(function (p) {
      return '<tr><td><strong>' + escapeHtml(p.closer_name) + '</strong></td><td>' + escapeHtml(p.business_name) + '</td><td>' + badge(p.training_status) + '</td><td class="mono">' + escapeHtml(p.total_sales) + '</td><td class="mono">' + money(p.total_cash) + '</td><td class="row-actions"><button class="text-button" data-report-placement="' + p.placement_id + '">Add report</button><button class="text-button" data-form="target" data-id="' + p.placement_id + '">Set target</button></td></tr>';
    }).join("");
  }
  function renderClients() {
    const host = document.getElementById("client-grid");
    if (!state.clients.length) { host.innerHTML = '<div class="panel"><div class="empty-state"><span class="empty-glyph">C</span><h3>No clients in Pravah yet</h3><p>Add the first client to begin operating their placements and check-ins.</p><button class="button button-primary" data-form="client">Add client</button></div></div>'; return; }
    host.innerHTML = state.clients.map(function (client) {
      return '<article class="client-card"><div class="client-card-head"><div><p class="eyebrow">' + escapeHtml(client.status) + '</p><h2>' + escapeHtml(client.business_name) + '</h2></div>' + badge(client.health) + '</div><div class="client-stats"><div><strong>' + escapeHtml(client.active_closers) + '</strong><span>Active closers</span></div><div><strong>' + escapeHtml(client.open_actions) + '</strong><span>Open actions</span></div><div><strong>' + (client.last_checkin_at ? dateLabel(client.last_checkin_at) : "—") + '</strong><span>Last check-in</span></div></div><div class="client-actions"><button class="button button-secondary" data-form="checkin" data-id="' + client.id + '">Add check-in</button><button class="button button-ghost" data-form="action" data-id="' + client.id + '">Add action</button></div></article>';
    }).join("");
  }
  function renderReports() {
    const host = document.getElementById("report-list");
    if (!state.reports.length) { host.innerHTML = '<div class="report-empty">No reports yet. Paste the first WhatsApp update or enter one manually.</div>'; return; }
    host.innerHTML = state.reports.map(function (r) {
      return '<article class="report-item"><div><strong>' + escapeHtml(r.closer_name) + '</strong><span>' + escapeHtml(r.business_name) + ' · ' + dateLabel(r.period_start) + '–' + dateLabel(r.period_end) + '</span></div><div><span>Calls / connected</span><b class="report-number">' + escapeHtml(r.calls_attempted ?? "—") + ' / ' + escapeHtml(r.connected_calls ?? "—") + '</b></div><div><span>Sales / cash</span><b class="report-number">' + escapeHtml(r.sales_count ?? "—") + ' / ' + money(r.cash_collected, r.currency) + '</b></div><div class="report-actions"><button class="button button-secondary" data-copy-report="' + r.id + '">Copy for WhatsApp</button><button class="button button-ghost" data-shared-report="' + r.id + '">' + (r.shared_at ? "Shared ✓" : "Mark shared") + '</button></div></article>';
    }).join("");
  }

  function fillReportPlacements(selected) {
    const select = document.getElementById("report-placement");
    select.innerHTML = option("", "Choose closer and client") + state.placements.map(function (p) { return option(p.placement_id, p.closer_name + " · " + p.business_name, p.placement_id === selected); }).join("");
  }
  function openModal(modal) { lastFocus = document.activeElement; modal.hidden = false; document.body.style.overflow = "hidden"; }
  function closeModal(modal) { modal.hidden = true; document.body.style.overflow = ""; if (lastFocus) lastFocus.focus(); }
  function openReport(selectedPlacement) {
    fillReportPlacements(selectedPlacement); const now = today();
    document.getElementById("report-period-start").value = now; document.getElementById("report-period-end").value = now;
    parsedDraft = null; reportPreview.hidden = true; reportPreview.innerHTML = ""; parseMessage.textContent = ""; saveReportButton.disabled = true;
    openModal(reportModal); window.setTimeout(function () { reportInput.focus(); }, 0);
  }
  function previewReport() {
    const result = parser.parseReport(reportInput.value);
    const selected = state.placements.find(function (p) { return p.placement_id === document.getElementById("report-placement").value; });
    if (!result.data.closer_name && selected) result.data.closer_name = selected.closer_name;
    if (!result.data.client_name && selected) result.data.client_name = selected.business_name;
    const usable = result.recognized > 0 && Boolean(selected);
    parsedDraft = usable ? result.data : null; saveReportButton.disabled = !usable;
    reportPreview.hidden = result.recognized === 0;
    reportPreview.innerHTML = Object.keys(result.data).map(function (key) { return "<div><span>" + escapeHtml(labels[key] || key) + "</span><strong>" + escapeHtml(result.data[key]) + "</strong></div>"; }).join("");
    const notes = [];
    if (!selected) notes.push("Choose the closer and client.");
    if (!result.recognized) notes.push("No recognized metrics found."); else notes.push(result.recognized + " fields recognized.");
    if (result.unknown.length) notes.push(result.unknown.length + " line(s) remain in the source text only.");
    parseMessage.textContent = notes.join(" ");
  }
  async function saveReport() {
    if (!parsedDraft) return;
    const placementId = document.getElementById("report-placement").value;
    const args = {
      p_placement_id: placementId, p_period_start: document.getElementById("report-period-start").value,
      p_period_end: document.getElementById("report-period-end").value,
      p_calls_attempted: parsedDraft.calls_attempted ?? null, p_connected_calls: parsedDraft.connected_calls ?? null,
      p_qualified_opportunities: parsedDraft.qualified_opportunities ?? null, p_sales_count: parsedDraft.sales_count ?? null,
      p_revenue_generated: parsedDraft.revenue_generated ?? null, p_cash_collected: parsedDraft.cash_collected ?? null,
      p_pipeline_value: null, p_currency: "INR", p_blocker: parsedDraft.blocker || null,
      p_support_required: null, p_next_period_plan: parsedDraft.next_period_plan || null,
      p_source_type: "whatsapp", p_source_text: reportInput.value
    };
    await runWrite(function () { return api.rpc("pravah_save_report", args); }, "Report saved");
    reportInput.value = ""; closeModal(reportModal);
  }

  function field(name, label, type, value, attrs) { return '<label>' + escapeHtml(label) + '<input name="' + name + '" type="' + (type || "text") + '" value="' + escapeHtml(value || "") + '" ' + (attrs || "") + '></label>'; }
  function selectField(name, label, optionsHtml, attrs) { return '<label>' + escapeHtml(label) + '<select name="' + name + '" ' + (attrs || "") + '>' + optionsHtml + '</select></label>'; }
  function textareaField(name, label, attrs) { return '<label class="full">' + escapeHtml(label) + '<textarea name="' + name + '" rows="4" ' + (attrs || "") + '></textarea></label>'; }
  function formShell(fields, submitLabel) { return '<div class="form-grid">' + fields + '</div><p class="form-error" data-form-error role="alert"></p><div class="form-footer"><button class="button button-ghost" type="button" data-close-form>Cancel</button><button class="button button-primary" type="submit">' + escapeHtml(submitLabel) + '</button></div>'; }

  function openForm(type, id) {
    const headings = { client: ["CLIENT", "Add client"], placement: ["PLACEMENT", "Record placement"], training: ["TRAINING", "Start training"], checkpoint: ["TRAINING", "Add checkpoint"], "training-update": ["TRAINING", "Update training"], target: ["PERFORMANCE", "Set target"], checkin: ["CLIENT SUCCESS", "Add client check-in"], action: ["OWNERSHIP", "Add action"] };
    document.getElementById("form-modal-eyebrow").textContent = headings[type][0]; document.getElementById("form-modal-title").textContent = headings[type][1];
    dynamicForm.dataset.type = type; dynamicForm.dataset.id = id || "";
    if (type === "client") dynamicForm.innerHTML = formShell(field("business_name", "Business name", "text", "", "required autofocus"), "Add client");
    if (type === "placement") {
      const candidates = option("", "Choose candidate") + state.candidates.map(function (c) { return option(c.id, c.full_name); }).join("");
      const requirements = option("", "Choose open client role") + state.requirements.map(function (r) { return option(r.id, (r.clients && r.clients.business_name ? r.clients.business_name + " · " : "") + (r.title || "Untitled role")); }).join("");
      dynamicForm.innerHTML = formShell(selectField("candidate_id", "Candidate from Nikash", candidates, "required") + selectField("requirement_id", "Client role from Nikash", requirements, "required") + field("joined_on", "Joined on", "date", today(), "required"), "Record placement");
    }
    if (type === "training") dynamicForm.innerHTML = formShell(field("started_on", "Started on", "date", today(), "required") + field("expected_completion_on", "Expected completion", "date", addDays(today(), 9), "required"), "Start training");
    if (type === "checkpoint") dynamicForm.innerHTML = formShell(field("checkpoint_on", "Checkpoint date", "date", today(), "required") + selectField("checkpoint_type", "Checkpoint type", ["attendance","product","roleplay","call_review","counselling","decision"].map(function (v) { return option(v, v.replaceAll("_", " ")); }).join(""), "required") + field("rating", "Rating (1–5)", "number", "", 'min="1" max="5" step="0.1"') + selectField("outcome", "Outcome", ["on_track","watch","blocked","passed","failed"].map(function (v) { return option(v, v.replaceAll("_", " ")); }).join(""), "required") + textareaField("note", "What happened and what changes next?", "required"), "Save checkpoint");
    if (type === "training-update") {
      const training = state.placements.find(function (p) { return p.training_id === id; }) || {};
      dynamicForm.innerHTML = formShell(selectField("status", "Status", ["active","passed","extended","failed","withdrawn"].map(function (v) { return option(v, v.replaceAll("_", " "), training.training_status === v); }).join(""), "required") + selectField("risk_level", "Risk", ["none","watch","high"].map(function (v) { return option(v, v, training.risk_level === v); }).join(""), "required") + selectField("product_ready", "Product ready", option("", "Not decided", training.product_ready == null) + option("true", "Yes", training.product_ready === true) + option("false", "No", training.product_ready === false)) + field("roleplay_rating", "Roleplay rating (1–5)", "number", training.roleplay_rating || "", 'min="1" max="5" step="0.1"') + textareaField("decision_note", "Decision note"), "Save training update");
    }
    if (type === "target") dynamicForm.innerHTML = formShell(field("period_start", "Period start", "date", today(), "required") + field("period_end", "Period end", "date", addDays(today(), 29), "required") + selectField("target_unit", "Target type", option("revenue", "Revenue") + option("cash", "Cash collected") + option("sales", "Sales count"), "required") + field("target_value", "Target", "number", "", 'min="0" step="0.01" required') + field("currency", "Currency", "text", "INR", "required"), "Save target");
    if (type === "checkin") dynamicForm.innerHTML = formShell(selectField("health", "Client health", option("healthy", "Healthy") + option("watch", "Watch") + option("at_risk", "At risk"), "required") + field("satisfaction", "Satisfaction (1–5)", "number", "", 'min="1" max="5"') + textareaField("summary", "Check-in summary", "required") + textareaField("material_issue", "Material issue") + textareaField("root_cause", "Root cause") + textareaField("next_action", "Next action") + field("action_due_on", "Action due", "date"), "Save check-in");
    if (type === "action") dynamicForm.innerHTML = formShell(field("title", "Action", "text", "", "required") + selectField("priority", "Priority", ["low","normal","high","critical"].map(function (v) { return option(v, v, v === "normal"); }).join(""), "required") + field("due_on", "Due on", "date") + textareaField("detail", "Detail"), "Create action");
    openModal(formModal);
  }

  async function submitDynamicForm(event) {
    event.preventDefault(); const type = dynamicForm.dataset.type; const id = dynamicForm.dataset.id; const values = Object.fromEntries(new FormData(dynamicForm).entries());
    const submit = dynamicForm.querySelector('[type="submit"]'); const errorHost = dynamicForm.querySelector("[data-form-error]"); submit.disabled = true; errorHost.textContent = "";
    try {
      if (type === "client") await api.rpc("pravah_create_client", { p_business_name: values.business_name });
      if (type === "placement") await api.rpc("pravah_create_placement", { p_candidate_id: values.candidate_id, p_requirement_id: values.requirement_id, p_joined_on: values.joined_on });
      if (type === "training") await api.rpc("pravah_start_training", { p_placement_id: id, p_started_on: values.started_on, p_expected_completion_on: values.expected_completion_on });
      if (type === "checkpoint") await api.rpc("pravah_add_training_checkpoint", { p_training_id: id, p_checkpoint_type: values.checkpoint_type, p_rating: values.rating || null, p_outcome: values.outcome, p_note: values.note, p_checkpoint_on: values.checkpoint_on });
      if (type === "training-update") await api.rpc("pravah_update_training", { p_training_id: id, p_status: values.status, p_risk_level: values.risk_level, p_product_ready: values.product_ready === "" ? null : values.product_ready === "true", p_roleplay_rating: values.roleplay_rating || null, p_decision_note: values.decision_note || null });
      if (type === "target") await api.rpc("pravah_set_target", { p_placement_id: id, p_period_start: values.period_start, p_period_end: values.period_end, p_target_value: values.target_value, p_target_unit: values.target_unit, p_currency: values.currency });
      if (type === "checkin") await api.rpc("pravah_record_checkin", { p_client_id: id, p_health: values.health, p_satisfaction: values.satisfaction || null, p_summary: values.summary, p_material_issue: values.material_issue || null, p_root_cause: values.root_cause || null, p_next_action: values.next_action || null, p_action_due_on: values.action_due_on || null });
      if (type === "action") await api.rpc("pravah_create_action", { p_client_id: id, p_title: values.title, p_due_on: values.due_on || null, p_placement_id: null, p_priority: values.priority, p_detail: values.detail || null });
      closeModal(formModal); showToast("Saved"); await refreshData();
    } catch (error) { errorHost.textContent = error.message; }
    finally { submit.disabled = false; }
  }

  async function refreshData() { setLoading(true); try { await loadData(); } catch (error) { showToast(error.message, true); } finally { setLoading(false); } }
  async function runWrite(work, message) { setLoading(true); try { await work(); showToast(message); await loadData(); } catch (error) { showToast(error.message, true); throw error; } finally { setLoading(false); } }
  async function copyReport(id) {
    const report = state.reports.find(function (item) { return item.id === id; }); if (!report) return;
    try { await navigator.clipboard.writeText(parser.whatsappMessage(report)); showToast("WhatsApp update copied"); }
    catch (_error) { showToast("Copy was blocked by this browser", true); }
  }
  async function markShared(id) { await runWrite(function () { return api.rpc("pravah_mark_report_shared", { p_report_id: id }); }, "Marked as shared"); }
  async function completeAction(id) { await runWrite(function () { return api.rpc("pravah_complete_action", { p_action_id: id }); }, "Action completed"); }
  function signOut() { api.signOut(); window.location.hash = ""; showSignedOut(); }

  document.getElementById("signin-form").addEventListener("submit", async function (event) {
    event.preventDefault(); const errorHost = document.getElementById("signin-error"); const button = event.currentTarget.querySelector("button"); const values = new FormData(event.currentTarget); button.disabled = true; errorHost.textContent = "";
    try { await api.signIn(values.get("email"), values.get("password")); await loadApp(); }
    catch (error) { errorHost.textContent = error.message; }
    finally { button.disabled = false; }
  });
  document.querySelectorAll("[data-signout]").forEach(function (button) { button.addEventListener("click", signOut); });
  document.querySelectorAll("[data-open-report]").forEach(function (button) { button.addEventListener("click", function () { openReport(); }); });
  document.querySelector("[data-close-report]").addEventListener("click", function () { closeModal(reportModal); });
  document.querySelector("[data-fill-example]").addEventListener("click", function () { reportInput.value = example; previewReport(); });
  document.querySelector("[data-preview-report]").addEventListener("click", previewReport);
  saveReportButton.addEventListener("click", function () { saveReport().catch(function () {}); });
  reportInput.addEventListener("input", function () { parsedDraft = null; saveReportButton.disabled = true; });
  reportModal.addEventListener("click", function (event) { if (event.target === reportModal) closeModal(reportModal); });
  formModal.addEventListener("click", function (event) { if (event.target === formModal || event.target.closest("[data-close-form]")) closeModal(formModal); });
  dynamicForm.addEventListener("submit", submitDynamicForm);
  document.addEventListener("click", function (event) {
    const formButton = event.target.closest("[data-form]"); const reportButton = event.target.closest("[data-report-placement]"); const copyButton = event.target.closest("[data-copy-report]"); const sharedButton = event.target.closest("[data-shared-report]"); const completeButton = event.target.closest("[data-complete-action]");
    if (formButton) openForm(formButton.dataset.form, formButton.dataset.id);
    if (reportButton) openReport(reportButton.dataset.reportPlacement);
    if (copyButton) copyReport(copyButton.dataset.copyReport);
    if (sharedButton) markShared(sharedButton.dataset.sharedReport).catch(function () {});
    if (completeButton) completeAction(completeButton.dataset.completeAction).catch(function () {});
  });
  document.addEventListener("keydown", function (event) { if (event.key === "Escape") { if (!reportModal.hidden) closeModal(reportModal); if (!formModal.hidden) closeModal(formModal); } });
  document.querySelector(".mobile-nav").addEventListener("click", function (event) { const sidebar = document.querySelector(".sidebar"); sidebar.classList.toggle("open"); event.currentTarget.setAttribute("aria-expanded", String(sidebar.classList.contains("open"))); });
  window.addEventListener("hashchange", function () { if (!appShell.hidden) showView(window.location.hash.slice(1)); });

  if (api.restore()) loadApp(); else showSignedOut();
})();
