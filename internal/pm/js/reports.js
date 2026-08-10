// js/reports.js — the per-project daily Slack report (docs: ../ARCHITECTURE.md §13)
//
// Loaded by board.html; board.js calls Reports.init(project) for every board.
// Admin-only, and shaped exactly like js/hr-sla.js: a header button opens a
// modal that lists this project's reports and edits one at a time.
//
// The Slack URL is NOT typed here — channels come from the central registry in
// Settings, so a rotated URL is one edit and reports just reference a name.
// Everything else about the message is configurable: scope (hiring/ops/both),
// send time and timezone, which days, and which blocks appear.
//
// Sending itself is entirely in the database (sql/15): a pg_cron job asks every
// five minutes which reports are due in their own timezone. This file never
// sends anything — it configures, previews, and fires test sends.

const Reports = (() => {
  let project = null;
  let configs = [];
  let channels = [];
  let runs = [];
  let editing = null; // config being edited, null = creating
  let deleteArmedFor = null;

  const SCOPE_LABELS = { hiring: "Hiring", ops: "Ops", both: "Hiring + Ops" };
  const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]; // ISO 1–7
  // A short list beats a free-form timezone box; the DB accepts any IANA name
  // if one is ever needed beyond these.
  const TIMEZONES = [
    "Asia/Kolkata", "Asia/Dubai", "Europe/London", "America/New_York",
    "America/Los_Angeles", "Australia/Sydney", "UTC",
  ];

  async function init(proj) {
    project = proj;
    const btn = document.getElementById("reports-btn");
    if (!btn || !Auth.isAdmin()) return;
    btn.hidden = false;
    btn.addEventListener("click", open);
    document.getElementById("report-form").addEventListener("submit", onSubmit);
    document.getElementById("reports-close").addEventListener("click", () =>
      UI.closeModal("reports-modal")
    );
    document.getElementById("report-form-reset").addEventListener("click", () => fillForm(null));
    document.getElementById("report-preview-btn").addEventListener("click", onPreview);
  }

  async function open() {
    document.getElementById("report-project-name").textContent = project.name;
    try {
      [configs, channels, runs] = await Promise.all([
        API.getReportConfigs(project.id),
        API.getSlackChannels(),
        API.getReportRuns(project.id).catch(() => []),
      ]);
    } catch (e) {
      UI.toast(
        /does not exist|relation|schema cache/i.test(e.message)
          ? "Daily reports need the 15_daily_reports.sql migration — run it in Supabase first."
          : e.message
      );
      return;
    }
    fillForm(null);
    renderList();
    renderRuns();
    UI.openModal("reports-modal");
  }

  const channelName = (id) => channels.find((c) => c.id === id)?.label || "(deleted channel)";

  function renderList() {
    const host = document.getElementById("reports-list");
    if (!configs.length) {
      host.innerHTML =
        '<div class="form-hint">No report yet — set one up below and it posts every day on its own.</div>';
      return;
    }
    host.innerHTML = `
      <table class="data-table">
        <thead><tr><th>Report</th><th>Channel</th><th>When</th><th style="width:150px;"></th></tr></thead>
        <tbody>
          ${configs
            .map((c) => {
              const days =
                c.days_of_week?.length === 7
                  ? "daily"
                  : (c.days_of_week || []).map((d) => DAY_LABELS[d - 1]).join(" ");
              return `
                <tr class="${c.active ? "" : "inactive-row"}">
                  <td>
                    <span style="font-weight:600;">${UI.esc(c.label)}</span>
                    <span class="status-chip" style="margin-left:6px;">${UI.esc(SCOPE_LABELS[c.scope] || c.scope)}</span>
                    ${c.last_error ? `<div class="field-error" style="margin-top:4px;">${UI.esc(c.last_error)}</div>` : ""}
                  </td>
                  <td style="color:var(--muted);">${UI.esc(channelName(c.channel_id))}</td>
                  <td style="color:var(--muted);font-size:13px;">
                    ${UI.esc(String(c.send_time).slice(0, 5))} · ${UI.esc(days)}
                    <div style="font-size:12px;">${UI.esc(c.timezone)}</div>
                  </td>
                  <td style="text-align:right;white-space:nowrap;">
                    <button class="btn btn-secondary" data-rp-edit="${c.id}" style="padding:4px 8px;font-size:12px;">Edit</button>
                    <button class="btn btn-secondary" data-rp-test="${c.id}" style="padding:4px 8px;font-size:12px;">Send test</button>
                    <button class="btn btn-danger" data-rp-delete="${c.id}" style="padding:4px 8px;font-size:12px;">${
                      deleteArmedFor === c.id ? "Confirm" : "Delete"
                    }</button>
                  </td>
                </tr>`;
            })
            .join("")}
        </tbody>
      </table>`;

    host.querySelectorAll("[data-rp-edit]").forEach((btn) => {
      btn.addEventListener("click", () => fillForm(configs.find((c) => c.id === btn.dataset.rpEdit)));
    });

    host.querySelectorAll("[data-rp-test]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        btn.textContent = "Sending…";
        try {
          const r = await API.sendTestReport(btn.dataset.rpTest);
          const res = Array.isArray(r) ? r[0] : r;
          UI.toast(
            `Test sent — ${res?.added ?? 0} added, ${res?.moved ?? 0} moved today.`,
            "success"
          );
        } catch (e) {
          UI.toast(e.message);
        }
        btn.disabled = false;
        btn.textContent = "Send test";
      });
    });

    host.querySelectorAll("[data-rp-delete]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.rpDelete;
        if (deleteArmedFor !== id) {
          deleteArmedFor = id;
          renderList();
          return;
        }
        try {
          await API.deleteReportConfig(id);
          configs = configs.filter((c) => c.id !== id);
          deleteArmedFor = null;
          if (editing?.id === id) fillForm(null);
          UI.toast("Report deleted.", "success");
          renderList();
        } catch (e) {
          UI.toast(e.message);
        }
      });
    });
  }

  // The trend view: what the last two weeks actually looked like. Cheap because
  // every run stores its own totals (sql/15) rather than recomputing history.
  function renderRuns() {
    const host = document.getElementById("report-runs");
    if (!runs.length) {
      host.innerHTML =
        '<div class="form-hint">No reports sent yet — once they start, the last two weeks show here.</div>';
      return;
    }
    const max = Math.max(...runs.map((r) => Math.max(r.added_total, r.moved_total)), 1);
    host.innerHTML = `
      <table class="data-table">
        <thead><tr><th>Day</th><th style="width:70px;">Added</th><th style="width:70px;">Moved</th><th></th></tr></thead>
        <tbody>
          ${runs
            .map(
              (r) => `
            <tr>
              <td style="font-size:13px;">${UI.esc(UI.fmtDate(r.local_date))}</td>
              <td style="font-weight:600;">${r.added_total}</td>
              <td style="font-weight:600;">${r.moved_total}</td>
              <td>
                <span class="run-bar" style="width:${Math.round((r.added_total / max) * 100)}%"></span>
              </td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>`;
  }

  function fillForm(cfg) {
    editing = cfg || null;
    deleteArmedFor = null;
    const form = document.getElementById("report-form");
    UI.clearFieldErrors(form);
    document.getElementById("report-form-title").textContent = cfg ? "Editing report" : "New report";
    document.getElementById("report-save").textContent = cfg ? "Save Changes" : "Add Report";
    document.getElementById("report-form-reset").hidden = !cfg;
    document.getElementById("report-preview").hidden = true;

    document.getElementById("rp-label").value = cfg?.label || "Daily report";

    // Channels come from the registry; an empty registry is the one thing that
    // blocks setup, so say where to fix it rather than showing an empty select.
    const chanSel = document.getElementById("rp-channel");
    const usable = channels.filter((c) => c.active || c.id === cfg?.channel_id);
    chanSel.innerHTML = usable.length
      ? usable
          .map(
            (c) =>
              `<option value="${c.id}" ${c.id === cfg?.channel_id ? "selected" : ""}>${UI.esc(c.label)}${c.active ? "" : " (paused)"}</option>`
          )
          .join("")
      : `<option value="">No channels yet — add one in Settings</option>`;
    UI.enhanceSelect(chanSel);

    const scopeSel = document.getElementById("rp-scope");
    scopeSel.innerHTML = Object.entries(SCOPE_LABELS)
      .map(([v, l]) => `<option value="${v}" ${v === (cfg?.scope || "both") ? "selected" : ""}>${l}</option>`)
      .join("");
    UI.enhanceSelect(scopeSel);

    const tzSel = document.getElementById("rp-timezone");
    const tz = cfg?.timezone || "Asia/Kolkata";
    const tzList = TIMEZONES.includes(tz) ? TIMEZONES : [tz, ...TIMEZONES];
    tzSel.innerHTML = tzList
      .map((t) => `<option value="${UI.esc(t)}" ${t === tz ? "selected" : ""}>${UI.esc(t)}</option>`)
      .join("");
    UI.enhanceSelect(tzSel);

    document.getElementById("rp-time").value = String(cfg?.send_time || "19:00").slice(0, 5);

    const days = cfg?.days_of_week || [1, 2, 3, 4, 5, 6, 7];
    document.getElementById("rp-days").innerHTML = DAY_LABELS.map(
      (d, i) =>
        `<label class="day-chip"><input type="checkbox" data-day="${i + 1}" ${
          days.includes(i + 1) ? "checked" : ""
        }> ${d}</label>`
    ).join("");

    for (const [id, key, dflt] of [
      ["rp-added", "include_added", true],
      ["rp-moved", "include_moved", true],
      ["rp-snapshot", "include_snapshot", true],
      ["rp-clients", "include_clients", false],
      ["rp-machine", "include_machine_actors", false],
      ["rp-empty", "send_when_empty", true],
      ["rp-active", "active", true],
    ]) {
      document.getElementById(id).checked = cfg ? !!cfg[key] : dflt;
    }
  }

  function readForm() {
    const days = [...document.querySelectorAll("#rp-days input:checked")].map((el) =>
      Number(el.dataset.day)
    );
    return {
      project_id: project.id,
      channel_id: document.getElementById("rp-channel").value || null,
      label: document.getElementById("rp-label").value.trim(),
      scope: document.getElementById("rp-scope").value,
      send_time: document.getElementById("rp-time").value,
      timezone: document.getElementById("rp-timezone").value,
      days_of_week: days,
      include_added: document.getElementById("rp-added").checked,
      include_moved: document.getElementById("rp-moved").checked,
      include_snapshot: document.getElementById("rp-snapshot").checked,
      include_clients: document.getElementById("rp-clients").checked,
      include_machine_actors: document.getElementById("rp-machine").checked,
      send_when_empty: document.getElementById("rp-empty").checked,
      active: document.getElementById("rp-active").checked,
    };
  }

  // Preview needs a saved config (the renderer lives in the database, so the
  // message you see is byte-for-byte the one that would be posted).
  async function onPreview() {
    if (!editing) {
      UI.toast("Save the report first, then preview it.");
      return;
    }
    const host = document.getElementById("report-preview");
    host.hidden = false;
    host.textContent = "Building…";
    try {
      const r = await API.previewReport(editing.id);
      const res = Array.isArray(r) ? r[0] : r;
      host.textContent = res?.text || "(empty)";
    } catch (e) {
      host.textContent = e.message;
    }
  }

  async function onSubmit(e) {
    e.preventDefault();
    const form = e.currentTarget;
    UI.clearFieldErrors(form);
    const fields = readForm();
    let valid = true;

    if (!fields.label) {
      UI.fieldError(document.getElementById("rp-label"), "Give the report a name.");
      valid = false;
    }
    if (!fields.channel_id) {
      UI.toast("Add a Slack channel in Settings first — the report needs somewhere to post.");
      valid = false;
    }
    if (!fields.days_of_week.length) {
      UI.toast("Pick at least one day of the week.");
      valid = false;
    }
    if (!fields.include_added && !fields.include_moved && !fields.include_snapshot) {
      UI.toast("Pick at least one thing to include, or the message would be empty.");
      valid = false;
    }
    if (!valid) return;

    try {
      if (editing) {
        const updated = await API.updateReportConfig(editing.id, fields);
        configs = configs.map((c) => (c.id === updated.id ? updated : c));
        UI.toast("Report updated.", "success");
      } else {
        const created = await API.createReportConfig(fields);
        configs.push(created);
        UI.toast(
          `Report added — first one goes out at ${fields.send_time} ${fields.timezone}.`,
          "success"
        );
      }
      fillForm(null);
      renderList();
    } catch (err) {
      UI.toast(err.message);
    }
  }

  return { init };
})();
