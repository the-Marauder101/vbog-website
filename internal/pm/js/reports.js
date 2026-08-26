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
// v22 adds the report TYPE (§17): activity (counts), movement (the cards that
// moved) or snapshot (the cards in a status right now), with status/client
// filters and a per-card detail picker. Counts answer "how much"; the other two
// answer "which", which is what a report usually needs to be actionable.
//
// Sending itself is entirely in the database (sql/15): a pg_cron job asks every
// five minutes which reports are due in their own timezone. This file never
// sends anything — it configures, previews, and fires test sends.

const Reports = (() => {
  let project = null;
  let members = [];
  let configs = [];
  let channels = [];
  let clients = [];
  let defaults = {}; // report_type -> the built-in message for it
  let runs = [];
  let editing = null; // config being edited, null = creating
  let deleteArmedFor = null;

  const SCOPE_LABELS = { hiring: "Hiring", ops: "Ops", both: "Hiring + Ops" };

  // The three questions a report can answer. Activity is what shipped first —
  // "what did the team do today". The other two exist because counts alone
  // can't say WHICH cards, and that is usually the question worth asking.
  const TYPES = {
    activity: {
      label: "Activity — who added and moved what",
      hint: "Counts per person, per stage. The original daily digest.",
    },
    movement: {
      label: "Movement — the cards that moved today",
      hint: "Lists each card that changed status in the window, with the move it made.",
    },
    snapshot: {
      label: "Status — the cards sitting in a status right now",
      hint: "A point-in-time list. Ignores the time window: it reports what is there when it sends.",
    },
  };

  // What each card can carry in a movement or status report.
  const DETAIL_FIELDS = [
    ["client", "Client"],
    ["assignee", "Assignee"],
    ["days", "Days in stage"],
    ["actor", "Who moved it"],
    ["status", "Current status"],
    ["email", "Email"],
    ["time", "Date"],
  ];
  const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]; // ISO 1–7
  // A short list beats a free-form timezone box; the DB accepts any IANA name
  // if one is ever needed beyond these.
  const TIMEZONES = [
    "Asia/Kolkata", "Asia/Dubai", "Europe/London", "America/New_York",
    "America/Los_Angeles", "Australia/Sydney", "UTC",
  ];

  // What a template can contain. Kept beside the SQL that substitutes them —
  // adding one means a line here and a `replace()` in daily_report_text.
  const PLACEHOLDERS = [
    ["{project}", "the project name"],
    ["{date}", "the day being reported, e.g. Mon 10 Aug 2026"],
    ["{timezone}", "the report's timezone"],
    ["{summary}", "Added 14 · Moved 6"],
    ["{added_total}", "just the number added"],
    ["{moved_total}", "just the number moved"],
    ["{people}", "how many people were active"],
    ["{added}", "the per-person added breakdown, with its heading"],
    ["{moved}", "the per-person moved breakdown, with its heading"],
    ["{pipeline}", "how many cards sit in each stage"],
    ["{clients}", "the client-tag breakdown"],
    ["{vs_yesterday}", "the comparison line against yesterday"],
    ["{cards}", "the card list — movement and status reports only"],
    ["{card_total}", "how many cards matched, before the listing cap"],
    ["{status_list}", "the statuses the report was filtered to"],
  ];

  // Statuses the pickers offer. A "both" report can filter on either side of the
  // board, so the two lists are merged and de-duplicated rather than chosen
  // between — a status name is unique enough to stand on its own.
  function projectStatuses() {
    const scope = document.getElementById("rp-scope")?.value || "both";
    const hiring = project?.statuses || [];
    const ops = project?.ops_statuses || [];
    const list =
      scope === "ops" ? ops : scope === "hiring" ? hiring : [...hiring, ...ops];
    return [...new Set(list)];
  }

  async function init(proj, mems) {
    project = proj;
    members = (mems || []).filter((m) => m.active);
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
    document.getElementById("rp-template-reset").addEventListener("click", () => {
      document.getElementById("rp-template").value = currentDefault();
    });
    document.getElementById("rp-type").addEventListener("change", onTypeChange);
    // Changing the scope changes which statuses exist to filter on, and any
    // already-picked status from the other side of the board stops applying.
    document.getElementById("rp-scope").addEventListener("change", () => {
      renderStatusPickers(readStatusPicks());
    });
    document.getElementById("rp-placeholders").innerHTML = PLACEHOLDERS.map(
      ([tag, what]) => `<li><code>${UI.esc(tag)}</code> — ${UI.esc(what)}</li>`
    ).join("");
  }

  async function open() {
    document.getElementById("report-project-name").textContent = project.name;
    try {
      const tplTypes = Object.keys(TYPES);
      let tpls;
      [configs, channels, runs, clients, ...tpls] = await Promise.all([
        API.getReportConfigs(project.id),
        API.getSlackChannels(),
        API.getReportRuns(project.id).catch(() => []),
        API.getClients().catch(() => []),
        ...tplTypes.map((t) => API.getDefaultReportTemplate(t).catch(() => "")),
      ]);
      defaults = Object.fromEntries(tplTypes.map((t, i) => [t, tpls[i] || ""]));
    } catch (e) {
      UI.toast(
        /does not exist|relation|schema cache/i.test(e.message)
          ? "Daily reports need the 15–18 SQL migrations — run them in Supabase first."
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
                    ${
                      c.report_type && c.report_type !== "activity"
                        ? `<span class="status-chip" style="margin-left:4px;">${UI.esc(
                            c.report_type === "movement" ? "Movement" : "Status"
                          )}</span>`
                        : ""
                    }
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

  const currentType = () => document.getElementById("rp-type").value || "activity";
  const currentDefault = () => defaults[currentType()] || defaults.activity || "";

  const chips = (host, items, picked, attr) => {
    document.getElementById(host).innerHTML = items.length
      ? items
          .map(
            ([val, label]) =>
              `<label class="day-chip"><input type="checkbox" data-${attr}="${UI.esc(val)}" ${
                picked.includes(val) ? "checked" : ""
              }> ${UI.esc(label)}</label>`
          )
          .join("")
      : '<span class="form-hint" style="margin:0;">Nothing to pick yet.</span>';
  };

  const readChips = (host, attr) =>
    [...document.querySelectorAll(`#${host} input:checked`)].map((el) => el.dataset[attr]);

  const readStatusPicks = () => ({
    to: readChips("rp-statuses", "status"),
    from: readChips("rp-from-statuses", "status"),
  });

  // Re-rendered whenever the scope changes, keeping any pick that still exists.
  function renderStatusPickers(picks) {
    const opts = projectStatuses().map((s) => [s, s]);
    const keep = (list) => (list || []).filter((s) => opts.some(([v]) => v === s));
    chips("rp-statuses", opts, keep(picks?.to), "status");
    chips("rp-from-statuses", opts, keep(picks?.from), "status");
  }

  // Switching type re-labels the pickers and — only if the message is still the
  // untouched default — swaps in the default written for the new type. An edited
  // message is never overwritten; losing typed wording to a dropdown would be
  // its own bug.
  function onTypeChange() {
    const type = currentType();
    const box = document.getElementById("rp-template");
    const untouched = Object.values(defaults).some((d) => d && box.value.trim() === d.trim());
    if (untouched || !box.value.trim()) box.value = currentDefault();
    applyTypeUi(type);
  }

  function applyTypeUi(type) {
    document.getElementById("rp-type-hint").textContent = TYPES[type]?.hint || "";
    document.getElementById("rp-filter-block").hidden = type === "activity";
    document.getElementById("rp-include-note").hidden = type === "activity";
    // A snapshot has no "from" — it isn't looking at movement at all.
    document.getElementById("rp-from-group").hidden = type !== "movement";
    document.getElementById("rp-status-label").textContent =
      type === "movement" ? "Moved into" : "In status";
    document.getElementById("rp-status-hint").textContent =
      type === "movement"
        ? "Nothing selected = any destination."
        : "Nothing selected = every status on the board.";
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

    const typeSel = document.getElementById("rp-type");
    const type = cfg?.report_type || "activity";
    typeSel.innerHTML = Object.entries(TYPES)
      .map(([v, t]) => `<option value="${v}" ${v === type ? "selected" : ""}>${UI.esc(t.label)}</option>`)
      .join("");
    UI.enhanceSelect(typeSel);

    renderStatusPickers({ to: cfg?.filter_statuses, from: cfg?.filter_from_statuses });
    chips(
      "rp-client-filter",
      clients.filter((c) => c.active || (cfg?.filter_clients || []).includes(c.name)).map((c) => [c.name, c.name]),
      cfg?.filter_clients || [],
      "client"
    );
    chips("rp-details", DETAIL_FIELDS, cfg?.detail_fields || ["client", "assignee"], "detail");
    document.getElementById("rp-max").value = cfg?.max_cards ?? 40;
    applyTypeUi(type);

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

    // Empty selection = everyone, which is why nothing is checked by default.
    const picked = cfg?.member_ids || [];
    document.getElementById("rp-members").innerHTML = members.length
      ? members
          .map(
            (m) =>
              `<label class="day-chip"><input type="checkbox" data-member="${m.id}" ${
                picked.includes(m.id) ? "checked" : ""
              }> ${UI.esc(m.name)}</label>`
          )
          .join("")
      : '<span class="form-hint" style="margin:0;">No active members.</span>';

    document.getElementById("rp-template").value = cfg?.template || currentDefault();

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
    const memberIds = [...document.querySelectorAll("#rp-members input:checked")].map(
      (el) => el.dataset.member
    );
    // Store NULL rather than a copy of the default, so a report that was never
    // customised keeps following the default if it ever changes.
    const tpl = document.getElementById("rp-template").value.trim();
    const picks = readStatusPicks();
    return {
      project_id: project.id,
      member_ids: memberIds,
      template: tpl && tpl !== currentDefault().trim() ? tpl : null,
      channel_id: document.getElementById("rp-channel").value || null,
      label: document.getElementById("rp-label").value.trim(),
      scope: document.getElementById("rp-scope").value,
      report_type: currentType(),
      filter_statuses: picks.to,
      // A snapshot has no source status; sending one would silently narrow the
      // report the moment somebody switched the type back to movement.
      filter_from_statuses: currentType() === "movement" ? picks.from : [],
      filter_clients: readChips("rp-client-filter", "client"),
      detail_fields: readChips("rp-details", "detail"),
      max_cards: Math.min(200, Math.max(1, Number(document.getElementById("rp-max").value) || 40)),
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
      // Preview the whole form as currently typed, not as last saved — the type
      // and its filters included, otherwise you'd have to commit an edit to find
      // out what it looks like.
      const r = await API.previewReport(
        editing.id,
        document.getElementById("rp-template").value,
        readForm()
      );
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
    // Only the activity report is built entirely out of these blocks; the other
    // two carry a card list, so an all-unchecked movement report is still fine.
    if (
      fields.report_type === "activity" &&
      !fields.include_added &&
      !fields.include_moved &&
      !fields.include_snapshot
    ) {
      UI.toast("Pick at least one thing to include, or the message would be empty.");
      valid = false;
    }
    if (fields.report_type === "snapshot" && !fields.filter_statuses.length) {
      UI.toast("Pick at least one status — a status report over every status is just the board.");
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
