(function () {
  "use strict";

  const storageKey = "pravah.v0.reportDrafts";
  const parser = window.PravahReportParser;
  const modal = document.getElementById("report-modal");
  const input = document.getElementById("report-input");
  const preview = document.getElementById("report-preview");
  const parseMessage = document.getElementById("parse-message");
  const saveButton = document.querySelector("[data-save-report]");
  const reportList = document.getElementById("report-list");
  const toast = document.getElementById("toast");
  let parsedDraft = null;
  let lastFocus = null;

  const labels = {
    closer_name: "Closer", client_name: "Client", report_date: "Date",
    calls_attempted: "Calls", connected_calls: "Connected",
    qualified_opportunities: "Qualified", sales_count: "Sales",
    revenue_generated: "Revenue", cash_collected: "Cash collected",
    blocker: "Blocker", next_period_plan: "Next step"
  };

  const example = [
    "Closer: Aisha", "Client: Acme", "Date: 01 Sep 2026", "Calls: 47",
    "Connected: 19", "Positive leads: 5", "Sales: 2", "Revenue: 150000",
    "Cash collected: 80000", "Blocker: More qualified leads needed",
    "Next step: Review follow-ups tomorrow"
  ].join("\n");

  function escapeHtml(value) {
    return String(value ?? "—").replace(/[&<>'"]/g, function (character) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character];
    });
  }

  function showView(name) {
    const target = document.getElementById(name) || document.getElementById("overview");
    document.querySelectorAll(".view").forEach(function (view) { view.classList.toggle("active", view === target); });
    document.querySelectorAll(".nav-link").forEach(function (link) { link.classList.toggle("active", link.dataset.view === target.id); });
    document.getElementById("view-name").textContent = target.dataset.title;
    document.querySelector(".sidebar").classList.remove("open");
    document.querySelector(".mobile-nav").setAttribute("aria-expanded", "false");
  }

  function openModal() {
    lastFocus = document.activeElement;
    modal.hidden = false;
    document.body.style.overflow = "hidden";
    window.setTimeout(function () { input.focus(); }, 0);
  }

  function closeModal() {
    modal.hidden = true;
    document.body.style.overflow = "";
    parsedDraft = null;
    preview.hidden = true;
    preview.innerHTML = "";
    parseMessage.textContent = "";
    saveButton.disabled = true;
    if (lastFocus) lastFocus.focus();
  }

  function previewReport() {
    const result = parser.parseReport(input.value);
    parsedDraft = result.valid ? result.data : null;
    saveButton.disabled = !result.valid;
    preview.hidden = result.recognized === 0;
    preview.innerHTML = Object.keys(result.data).map(function (key) {
      return "<div><span>" + escapeHtml(labels[key] || key) + "</span><strong>" + escapeHtml(result.data[key]) + "</strong></div>";
    }).join("");

    const notes = [];
    if (result.errors.length) notes.push(result.errors.join(" "));
    else notes.push(result.recognized + " fields recognized. Review them before saving.");
    if (result.unknown.length) notes.push(result.unknown.length + " line(s) will remain unstructured in this prototype.");
    if (result.duplicates.length) notes.push("Later duplicate values replaced earlier ones.");
    parseMessage.textContent = notes.join(" ");
  }

  function getReports() {
    try { return JSON.parse(localStorage.getItem(storageKey) || "[]"); }
    catch (_error) { return []; }
  }

  function saveReports(reports) {
    localStorage.setItem(storageKey, JSON.stringify(reports));
  }

  function saveReport() {
    if (!parsedDraft) return;
    const reports = getReports();
    reports.unshift({ id: Date.now(), saved_at: new Date().toISOString(), data: parsedDraft });
    saveReports(reports.slice(0, 30));
    input.value = "";
    closeModal();
    renderReports();
    window.location.hash = "reports";
    showToast("Local draft saved");
  }

  function renderReports() {
    const reports = getReports();
    if (!reports.length) {
      reportList.innerHTML = '<div class="report-empty">No local drafts yet. Paste the first WhatsApp update to test the workflow.</div>';
      return;
    }
    reportList.innerHTML = reports.map(function (report) {
      const data = report.data;
      return '<article class="report-item">' +
        '<div><strong>' + escapeHtml(data.closer_name) + '</strong><span>' + escapeHtml(data.client_name || "Client not supplied") + ' · ' + escapeHtml(data.report_date) + '</span></div>' +
        '<div><span>Calls / connected</span><b class="report-number">' + escapeHtml(data.calls_attempted ?? "—") + ' / ' + escapeHtml(data.connected_calls ?? "—") + '</b></div>' +
        '<div><span>Sales / cash</span><b class="report-number">' + escapeHtml(data.sales_count ?? "—") + ' / ' + escapeHtml(data.cash_collected ?? "—") + '</b></div>' +
        '<div class="report-actions"><button class="button button-secondary" type="button" data-copy-report="' + report.id + '">Copy for WhatsApp</button><button class="button button-ghost" type="button" data-delete-report="' + report.id + '">Remove</button></div>' +
        '</article>';
    }).join("");
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("show");
    window.setTimeout(function () { toast.classList.remove("show"); }, 1800);
  }

  async function copyReport(id) {
    const report = getReports().find(function (item) { return String(item.id) === String(id); });
    if (!report) return;
    try {
      await navigator.clipboard.writeText(parser.whatsappMessage(report.data));
      showToast("WhatsApp update copied");
    } catch (_error) {
      showToast("Copy was blocked by this browser");
    }
  }

  document.querySelectorAll("[data-open-report]").forEach(function (button) { button.addEventListener("click", openModal); });
  document.querySelector("[data-close-report]").addEventListener("click", closeModal);
  document.querySelector("[data-fill-example]").addEventListener("click", function () { input.value = example; previewReport(); });
  document.querySelector("[data-preview-report]").addEventListener("click", previewReport);
  saveButton.addEventListener("click", saveReport);
  input.addEventListener("input", function () { saveButton.disabled = true; parsedDraft = null; });
  modal.addEventListener("click", function (event) { if (event.target === modal) closeModal(); });
  document.addEventListener("keydown", function (event) { if (event.key === "Escape" && !modal.hidden) closeModal(); });

  document.querySelector(".mobile-nav").addEventListener("click", function (event) {
    const sidebar = document.querySelector(".sidebar");
    sidebar.classList.toggle("open");
    event.currentTarget.setAttribute("aria-expanded", String(sidebar.classList.contains("open")));
  });

  reportList.addEventListener("click", function (event) {
    const copyButton = event.target.closest("[data-copy-report]");
    const deleteButton = event.target.closest("[data-delete-report]");
    if (copyButton) copyReport(copyButton.dataset.copyReport);
    if (deleteButton) {
      saveReports(getReports().filter(function (item) { return String(item.id) !== deleteButton.dataset.deleteReport; }));
      renderReports();
      showToast("Local draft removed");
    }
  });

  window.addEventListener("hashchange", function () { showView(window.location.hash.slice(1)); });
  renderReports();
  showView(window.location.hash.slice(1));
})();
