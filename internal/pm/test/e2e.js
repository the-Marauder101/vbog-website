// e2e.js — Vyom's end-to-end test suite (how-to: test/README.md; docs: ../ARCHITECTURE.md §9)
//
// Drives the real UI with Playwright against the LIVE Supabase backend.
// 91 checks: login gate, projects/boards/tasks, filters, inbox + toggles,
// @mentions, roles/external scoping, tags, webhooks, client tags, status reorder +
// transition mapping, sub-client status inheritance, hideable status columns,
// the HR Stage Date and its filter, HR SLA flags, the task change log,
// the Slack channel registry, daily reports and their editable message,
// the HR client tracker, cleanup.
// All test data is namespaced ("E2E ...") — pre-cleaned at start, deleted at
// the end; count assertions are scoped to the test project so live data is
// never touched or asserted against.
const { chromium } = require("playwright");

const BASE = process.env.VYOM_BASE || "http://127.0.0.1:8787/internal/pm";
const SCRATCH = process.env.VYOM_SHOTS || __dirname; // failure screenshots land here
const PROJECT_NAME = "E2E Test Project";

const results = [];
let page, context, browser;
let adminUser = null; // captured at login; used to un-poison a failed step
const consoleErrors = [];

// A step that bails before its own cleanup used to leave the session logged in
// as whoever it switched to, so every later step ran as a non-admin and failed
// for the wrong reason. One root failure should stay one failure.
async function step(name, fn) {
  try {
    await fn();
    results.push(["PASS", name]);
    console.log("PASS:", name);
  } catch (e) {
    results.push(["FAIL", name, e.message]);
    console.log("FAIL:", name, "--", e.message.split("\n").slice(0, 12).join(" | ").slice(0, 900));
    try {
      await page.screenshot({ path: `${SCRATCH}/fail-${results.length}.png` });
    } catch (_) {}
    // Put the session back to admin. Most steps assume it, and a step that
    // switched user then threw would otherwise poison everything after it.
    // Same reasoning for a modal left open: it covers the board, so every
    // later step would fail looking for cards it can't click.
    try {
      await page.evaluate(
        (u) => {
          localStorage.setItem("vyom_user", JSON.stringify(u));
          document.querySelectorAll(".modal-overlay.open").forEach((m) => m.classList.remove("open"));
        },
        adminUser
      );
    } catch (_) {}
  }
}

// Run a query through the app's own sbFetch inside the page
function rest(path, opts) {
  return page.evaluate(
    ([p, o]) => sbFetch(p, o),
    [path, opts || {}]
  );
}

function isoDaysFromNow(n) {
  const d = new Date(Date.now() + n * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// HTML5 drag-and-drop via synthetic DragEvents (deterministic)
async function dragCardToColumn(taskId, status) {
  await page.evaluate(
    ([id, st]) => {
      const src = document.querySelector(`.task-card[data-id="${id}"]`);
      const tgt = document.querySelector(`.kanban-col[data-status="${st}"]`);
      if (!src || !tgt) throw new Error("drag: src or target not found");
      const dt = new DataTransfer();
      src.dispatchEvent(new DragEvent("dragstart", { dataTransfer: dt, bubbles: true }));
      tgt.dispatchEvent(new DragEvent("dragover", { dataTransfer: dt, bubbles: true, cancelable: true }));
      tgt.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
      src.dispatchEvent(new DragEvent("dragend", { bubbles: true }));
    },
    [taskId, status]
  );
}

// Drag one status chip onto another in the project modal (reorder)
async function dragChip(fromLabel, toLabel) {
  await page.evaluate(
    ([a, b]) => {
      const chips = [...document.querySelectorAll("#status-tags .tag")];
      const byLabel = (l) => chips.find((c) => c.textContent.replace("×", "").trim() === l);
      const src = byLabel(a);
      const tgt = byLabel(b);
      if (!src || !tgt) throw new Error("dragChip: chip not found");
      const dt = new DataTransfer();
      src.dispatchEvent(new DragEvent("dragstart", { dataTransfer: dt, bubbles: true }));
      tgt.dispatchEvent(new DragEvent("dragover", { dataTransfer: dt, bubbles: true, cancelable: true }));
      tgt.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
      src.dispatchEvent(new DragEvent("dragend", { bubbles: true }));
    },
    [fromLabel, toLabel]
  );
}

// Drive the custom styled dropdowns (native selects are hidden)
async function choose(selectId, opt) {
  const wrap = page.locator(`.dd:has(#${selectId})`);
  await wrap.locator(".dd-btn").click();
  const item = opt.label !== undefined
    ? wrap.locator(".dd-item", { hasText: opt.label }).first()
    : wrap.locator(`.dd-item[data-value="${opt.value}"]`);
  await item.click();
}

// Poll until a REST query returns `n` rows. Toasts are a fragile assertion for
// "the write landed" — they auto-dismiss, and a click that fires the instant a
// page finishes loading can miss the window. The row itself cannot lie.
async function waitForRows(path, n = 1, tries = 15) {
  let rows = [];
  for (let i = 0; i < tries; i++) {
    rows = await rest(path).catch(() => []);
    if (rows.length === n) return rows;
    await page.waitForTimeout(300);
  }
  return rows;
}

async function expectToast(substr) {
  const t = page.locator(".toast", { hasText: substr }).first();
  await t.waitFor({ state: "visible", timeout: 5000 });
}

(async () => {
  // VYOM_CHROMIUM: use a system/pre-installed Chromium instead of the
  // playwright-managed download (sandboxes often pre-install one).
  browser = await chromium.launch(
    process.env.VYOM_CHROMIUM ? { executablePath: process.env.VYOM_CHROMIUM } : {}
  );
  context = await browser.newContext({
    viewport: { width: 1366, height: 850 },
    permissions: ["clipboard-read", "clipboard-write"],
  });

  // Chromium can't tunnel through the agent proxy, so forward all external
  // requests via Node's fetch (env proxy honored with NODE_USE_ENV_PROXY=1).
  const netlog = [];
  await context.route(/supabase\.co|googleapis\.com|gstatic\.com/, async (route) => {
    const req = route.request();
    if (req.url().includes("notifications")) {
      netlog.push(`${Date.now() % 100000} ${req.method()} ${req.url().slice(req.url().indexOf("/rest") + 8, 200)}`);
    }
    try {
      const headers = { ...req.headers() };
      delete headers.host;
      delete headers.connection;
      delete headers["content-length"];
      delete headers["accept-encoding"];
      const resp = await fetch(req.url(), {
        method: req.method(),
        headers,
        body: ["GET", "HEAD"].includes(req.method()) ? undefined : req.postDataBuffer(),
      });
      const body = Buffer.from(await resp.arrayBuffer());
      const outHeaders = {};
      resp.headers.forEach((v, k) => {
        if (!["content-encoding", "transfer-encoding", "content-length"].includes(k)) outHeaders[k] = v;
      });
      await route.fulfill({ status: resp.status, headers: outHeaders, body });
    } catch (e) {
      console.log("[route error]", req.url().slice(0, 80), e.message.slice(0, 120));
      await route.abort();
    }
  });
  page = await context.newPage();
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(`console: ${m.text().slice(0, 200)}`);
  });

  // Swap the logged-in user without driving the form (form is tested separately)
  async function become(code) {
    const rows = await rest(
      `team_members?login_code=eq.${code}&select=id,name,user_role`
    );
    if (!rows.length) throw new Error(`no user with code ${code}`);
    await page.evaluate(
      (u) => localStorage.setItem("vyom_user", JSON.stringify({ id: u.id, name: u.name, user_role: u.user_role })),
      rows[0]
    );
    if (rows[0].user_role === "admin") adminUser = { id: rows[0].id, name: rows[0].name, user_role: rows[0].user_role };
    return rows[0];
  }

  // ---------- Login gate ----------
  await step("Login gate: logged-out visit redirects to login", async () => {
    await page.goto(`${BASE}/vyom.html`);
    await page.waitForURL(/login\.html/, { timeout: 8000 });
  });

  await step("Login gate: wrong ID is rejected inline", async () => {
    await page.fill("#login-code", "not-a-real-id");
    await page.click(".login-btn");
    await page.locator(".field-error", { hasText: "doesn't match" }).waitFor({ timeout: 5000 });
  });

  await step("Login gate: valid ID enters Vyom with user chip + admin nav", async () => {
    await page.fill("#login-code", "Depesh"); // case-insensitive
    await page.click(".login-btn");
    await page.waitForURL(/vyom\.html/, { timeout: 8000 });
    await page.locator(".user-chip .user-name", { hasText: "Depesh" }).waitFor({ timeout: 8000 });
    if (!(await page.locator('.nav-right a[href="settings.html"]').count()))
      throw new Error("admin should see Settings link");
    if (!(await page.locator(".inbox-bell").count())) throw new Error("inbox bell missing");
  });

  // ---------- Pre-clean any leftovers from previous runs ----------
  await page.waitForLoadState("networkidle");
  const leftovers = await rest(`projects?name=in.("${PROJECT_NAME}","E2E Scope Other","E2E Sub Client","E2E HR Project")&select=id`);
  for (const p of leftovers) await rest(`projects?id=eq.${p.id}`, { method: "DELETE" });
  const leftoverMembers = await rest(`team_members?name=in.("E2E Temp","E2E External")&select=id`);
  for (const m of leftoverMembers) await rest(`team_members?id=eq.${m.id}`, { method: "DELETE" });
  const leftoverHooks = await rest(`webhooks?label=eq.e2e%20hook&select=id`);
  for (const w of leftoverHooks) await rest(`webhooks?id=eq.${w.id}`, { method: "DELETE" });
  const leftoverReports = await rest(`daily_report_configs?label=like.E2E*&select=id`).catch(() => []);
  for (const c of leftoverReports) {
    await rest(`daily_report_runs?config_id=eq.${c.id}`, { method: "DELETE" }).catch(() => {});
    await rest(`daily_report_configs?id=eq.${c.id}`, { method: "DELETE" }).catch(() => {});
  }
  const leftoverChannels = await rest(`slack_channels?label=like.E2E*&select=id`).catch(() => []);
  for (const c of leftoverChannels) await rest(`slack_channels?id=eq.${c.id}`, { method: "DELETE" }).catch(() => {});
  const leftoverClients = await rest(`clients?name=like.E2E*&select=id`).catch(() => []);
  for (const c of leftoverClients) await rest(`clients?id=eq.${c.id}`, { method: "DELETE" }).catch(() => {});
  const leftoverTags = await rest(`tags?name=eq.E2E%20Tag&select=id`);
  for (const t of leftoverTags) await rest(`tags?id=eq.${t.id}`, { method: "DELETE" });
  consoleErrors.length = 0;

  // ---------- AC-01: create project with custom statuses ----------
  await step("Dashboard loads with New Project button", async () => {
    await page.goto(`${BASE}/vyom.html`);
    await page.locator("#new-project-btn").waitFor({ timeout: 8000 });
    await page.waitForLoadState("networkidle");
  });

  await step("AC-01: create project with custom name + custom statuses", async () => {
    await page.click("#new-project-btn");
    await page.fill("#p-name", PROJECT_NAME);
    await page.fill("#p-desc", "Temporary project created by automated tests");
    // remove the 4 default statuses
    for (let i = 0; i < 4; i++) await page.locator(".tag-editor .tag button").first().click();
    for (const s of ["Backlog", "Doing", "Review", "Done"]) {
      await page.fill("#status-input", s);
      await page.press("#status-input", "Enter");
    }
    await page.locator("#swatches .swatch").nth(3).click(); // amber
    await page.click("#project-save");
    await expectToast("Project created");
    await page.locator(".project-card", { hasText: PROJECT_NAME }).waitFor({ timeout: 5000 });
  });

  await step("Duplicate project name is rejected inline", async () => {
    await page.click("#new-project-btn");
    await page.fill("#p-name", PROJECT_NAME.toLowerCase());
    await page.click("#project-save");
    await page.locator(".field-error", { hasText: "already exists" }).waitFor({ timeout: 3000 });
    await page.click("#project-cancel");
  });

  // ---------- AC-02: board with one column per status ----------
  await step("AC-02: board opens with one column per custom status, in order", async () => {
    await page.locator(".project-card", { hasText: PROJECT_NAME }).click();
    await page.waitForURL(/board\.html\?project=/);
    await page.locator(".kanban-col").first().waitFor({ timeout: 8000 });
    const titles = await page.locator(".col-title").evaluateAll((els) => els.map((e) => e.textContent.trim()));
    const expect = ["Backlog", "Doing", "Review", "Done"];
    if (JSON.stringify(titles) !== JSON.stringify(expect))
      throw new Error(`columns = ${JSON.stringify(titles)}`);
  });

  // ---------- AC-03: create task ----------
  await step("AC-03: create task with title, notes, assignee, due date", async () => {
    await page.locator('.kanban-col[data-status="Backlog"] .add-task-btn').click();
    await page.fill("#t-title", "Overdue e2e task");
    await page.fill("#t-notes", "Notes body for the overdue task");
    await choose("t-assignee", { label: "Depesh" });
    await page.fill("#t-due", isoDaysFromNow(-2));
    await page.click("#task-save");
    await expectToast("Task created");
    const card = page.locator(".task-card", { hasText: "Overdue e2e task" });
    await card.waitFor({ timeout: 5000 });
    if (!(await card.locator(".name", { hasText: "Depesh" }).count())) throw new Error("assignee not shown");
  });

  // ---------- AC-05: overdue red ----------
  await step("AC-05: overdue due date is shown in red (overdue class)", async () => {
    const due = page.locator(".task-card", { hasText: "Overdue e2e task" }).locator(".due");
    const cls = await due.getAttribute("class");
    if (!cls.includes("overdue")) throw new Error(`due classes: ${cls}`);
    const color = await due.evaluate((el) => getComputedStyle(el).color);
    if (color !== "rgb(220, 38, 38)") throw new Error(`due color: ${color}`);
  });

  await step("Tasks sort overdue-first within a column", async () => {
    await page.locator('.kanban-col[data-status="Backlog"] .add-task-btn').click();
    await page.fill("#t-title", "Future e2e task");
    await page.fill("#t-due", isoDaysFromNow(3));
    await page.click("#task-save");
    await expectToast("Task created");
    await page.locator(".task-card", { hasText: "Future e2e task" }).waitFor();
    const first = await page
      .locator('.kanban-col[data-status="Backlog"] .task-card .task-title')
      .first()
      .innerText();
    if (!first.includes("Overdue e2e task")) throw new Error(`first card = ${first}`);
    const count = await page.locator('.kanban-col[data-status="Backlog"] .col-count').innerText();
    if (count.trim() !== "2") throw new Error(`Backlog count = ${count}`);
  });

  // ---------- AC-04: drag and drop ----------
  let overdueTaskId;
  await step("AC-04: drag task between columns updates status in Supabase", async () => {
    overdueTaskId = await page
      .locator(".task-card", { hasText: "Overdue e2e task" })
      .getAttribute("data-id");
    await dragCardToColumn(overdueTaskId, "Doing");
    await page
      .locator('.kanban-col[data-status="Doing"] .task-card', { hasText: "Overdue e2e task" })
      .waitFor({ timeout: 5000 });
    await page.waitForTimeout(800); // let the PATCH land
    const rows = await rest(`tasks?id=eq.${overdueTaskId}&select=status,created_at,updated_at`);
    if (rows[0].status !== "Doing") throw new Error(`status in DB = ${rows[0].status}`);
    if (!(rows[0].updated_at > rows[0].created_at)) throw new Error("updated_at trigger did not fire");
  });

  await step("Edit task: fields load, save updates card in place", async () => {
    await page.locator(".task-card", { hasText: "Overdue e2e task" }).click();
    // Read the fields only once the modal is actually open — otherwise a click
    // that lands mid-render reads the previous (empty) state of the inputs.
    await page.locator("#task-modal.open").waitFor({ timeout: 8000 });
    const notes = await page.inputValue("#t-notes");
    if (!notes.includes("Notes body")) throw new Error("notes not loaded in modal");
    await page.fill("#t-title", "Overdue e2e task (edited)");
    await page.click("#task-save");
    await expectToast("Task updated");
    await page.locator(".task-card", { hasText: "Overdue e2e task (edited)" }).waitFor({ timeout: 5000 });
  });

  // ---------- AC-08 (simulated Zapier POST) ----------
  let projectId, depeshId, zapTaskId;
  await step("AC-08: Zapier-style REST POST creates task; teal dot + task_details view", async () => {
    projectId = new URL(page.url()).searchParams.get("project");
    depeshId = (await rest("team_members?name=eq.Depesh&select=id"))[0].id;
    const created = await rest("tasks", {
      method: "POST",
      body: {
        title: "Task from Google Sheets",
        project_id: projectId,
        assignee_id: depeshId,
        status: "Review",
        due_date: isoDaysFromNow(1),
        source: "zapier",
        external_id: "sheet-row-42",
      },
    });
    zapTaskId = created[0].id;
    await page.reload();
    const card = page.locator(".task-card", { hasText: "Task from Google Sheets" });
    await card.waitFor({ timeout: 8000 });
    if (!(await card.locator(".zapier-dot").count())) throw new Error("zapier dot missing");
    const view = await rest(`task_details?id=eq.${zapTaskId}&select=*`);
    if (view[0].project_name !== PROJECT_NAME || view[0].assignee_name !== "Depesh")
      throw new Error(`task_details = ${JSON.stringify(view[0])}`);
  });

  // ---------- board filters ----------
  await step("Board filters: assignee and due-date presets narrow the board", async () => {
    await page.goto(`${BASE}/board.html?project=${projectId}`);
    await page.locator(".task-card").first().waitFor({ timeout: 8000 });
    // 3 tasks total: overdue(Depesh), future(unassigned), zapier(+1d, Depesh)
    await choose("filter-assignee", { label: "Depesh" });
    if ((await page.locator(".task-card").count()) !== 2) throw new Error("assignee filter count wrong");
    if (await page.locator(".task-card", { hasText: "Future e2e task" }).count())
      throw new Error("unassigned task still visible");
    const countText = await page.locator("#filter-count").innerText();
    if (!countText.includes("Showing 2 of 3")) throw new Error(`count = ${countText}`);
    await choose("filter-due", { value: "overdue" });
    if ((await page.locator(".task-card").count()) !== 1) throw new Error("date filter count wrong");
    if (!(await page.locator(".task-card", { hasText: "Overdue e2e task (edited)" }).count()))
      throw new Error("wrong task shown for overdue filter");
    await choose("filter-assignee", { value: "none" }); // unassigned + overdue = 0
    if ((await page.locator(".task-card").count()) !== 0) throw new Error("combined filters wrong");
    await page.click("#filter-clear");
    if ((await page.locator(".task-card").count()) !== 3) throw new Error("clear filters failed");
    if (!(await page.locator("#filter-clear").isHidden())) throw new Error("clear button still visible");
  });

  await step("Board: custom date range filter narrows to the window", async () => {
    await choose("filter-due", { value: "custom" });
    const range = page.locator("#range-inputs");
    if (await range.isHidden()) throw new Error("range inputs not shown");
    await page.fill("#filter-from", isoDaysFromNow(-5));
    await page.fill("#filter-to", isoDaysFromNow(0));
    await page.waitForTimeout(200);
    if ((await page.locator(".task-card").count()) !== 1) throw new Error("range (past) count wrong");
    if (!(await page.locator(".task-card", { hasText: "Overdue e2e task (edited)" }).count()))
      throw new Error("wrong task in past range");
    await page.fill("#filter-from", isoDaysFromNow(1));
    await page.fill("#filter-to", isoDaysFromNow(2));
    await page.waitForTimeout(200);
    if ((await page.locator(".task-card").count()) !== 1) throw new Error("range (future) count wrong");
    if (!(await page.locator(".task-card", { hasText: "Task from Google Sheets" }).count()))
      throw new Error("wrong task in future range");
    await page.click("#filter-clear");
    if (!(await range.isHidden())) throw new Error("range inputs not hidden after clear");
    if ((await page.locator(".task-card").count()) !== 3) throw new Error("clear failed");
  });

  // ---------- clients (registry in Settings -> tasks.fields.client) ----------
  await step("Client registry: a client is added once in Settings", async () => {
    await page.goto(`${BASE}/settings.html`);
    // Wait for the submit button to be ENABLED, not for the table: #clients-table
    // is static markup that is visible long before load() has fetched anything,
    // and the buttons start disabled precisely so a fast submit can't race it.
    await page
      .locator("#add-client-form button[type=submit]:not([disabled])")
      .waitFor({ timeout: 15000 });
    await page.fill("#client-name", "E2E Acme Corp");
    await page.click("#add-client-form button[type=submit]");
    const rows = await waitForRows("clients?name=eq.E2E%20Acme%20Corp&select=*");
    if (rows.length !== 1) throw new Error(`expected 1 client, got ${rows.length}`);
    if (!rows[0].active) throw new Error("a new client should start active");
  });

  await step("Client registry: a near-duplicate spelling is refused", async () => {
    await page.fill("#client-name", "e2e acme corp");
    await page.click("#add-client-form button[type=submit]");
    await page.waitForTimeout(400);
    if (!(await page.locator(".field-error").count())) throw new Error("no inline error");
    if ((await rest("clients?name=eq.e2e%20acme%20corp&select=id")).length)
      throw new Error("a case-variant duplicate was stored");
    await page.fill("#client-name", "");
  });

  await step("Client tag: set on a task; chip shows; board filter narrows", async () => {
    await page.goto(`${BASE}/board.html?project=${projectId}`);
    await page.locator(".kanban-col").first().waitFor({ timeout: 8000 });
    // The client filter starts hidden — no task in this project has a client yet
    if (!(await page.locator('.dd:has(#filter-client)').first().isHidden()))
      throw new Error("client filter visible with no client tags");
    await page.locator(".task-card", { hasText: "Future e2e task" }).click();
    // A dropdown off the registry, not free text — that is the v18 change.
    await choose("t-client", { label: "E2E Acme Corp" });
    await page.click("#task-save");
    await expectToast("Task updated");
    const card = page.locator(".task-card", { hasText: "Future e2e task" });
    await card.locator(".client-chip", { hasText: "E2E Acme Corp" }).waitFor({ timeout: 5000 });
    const rows = await rest(`tasks?project_id=eq.${projectId}&fields->>client=eq.E2E%20Acme%20Corp&select=id`);
    if (rows.length !== 1) throw new Error("fields.client not saved in DB");
    // filter appears now and narrows the board
    await choose("filter-client", { label: "E2E Acme Corp" });
    if ((await page.locator(".task-card").count()) !== 1) throw new Error("client filter count wrong");
    await choose("filter-client", { label: "No client" });
    if ((await page.locator(".task-card").count()) !== 2) throw new Error("'No client' filter count wrong");
    await page.click("#filter-clear");
    if ((await page.locator(".task-card").count()) !== 3) throw new Error("clear did not reset client filter");
    // The card dropdown is fed by the registry, and "No client" stays available
    await page.locator(".add-task-btn").first().click();
    const opts = await page.$$eval("#t-client option", (e) => e.map((o) => o.value));
    if (!opts.includes("E2E Acme Corp")) throw new Error(`registry not offered: ${opts.join(", ")}`);
    if (opts[0] !== "") throw new Error("a card must still be saveable with no client");
    await page.click("#task-cancel");
  });

  await step("Client registry: pausing one takes it out of the card dropdown", async () => {
    const c = (await rest("clients?name=eq.E2E%20Acme%20Corp&select=id"))[0];
    await rest(`clients?id=eq.${c.id}`, { method: "PATCH", body: { active: false } });
    await page.reload();
    await page.locator(".kanban-col").first().waitFor({ timeout: 8000 });
    // A new card can no longer be filed under it...
    await page.locator(".add-task-btn").first().click();
    let opts = await page.$$eval("#t-client option", (e) => e.map((o) => o.value));
    if (opts.includes("E2E Acme Corp")) throw new Error("a paused client is still offered");
    await page.click("#task-cancel");
    // ...but the card that already uses it keeps it, rather than silently
    // blanking the field the next time somebody opens the card.
    await page.locator(".task-card", { hasText: "Future e2e task" }).click();
    opts = await page.$$eval("#t-client option", (e) => e.map((o) => o.value));
    if (!opts.includes("E2E Acme Corp")) throw new Error("an existing card lost its client");
    if ((await page.$eval("#t-client", (e) => e.value)) !== "E2E Acme Corp")
      throw new Error("the card's own client was not selected");
    await page.click("#task-cancel");
    await rest(`clients?id=eq.${c.id}`, { method: "PATCH", body: { active: true } });
  });

  await step("Client registry: owner and contact details are stored on the client", async () => {
    await page.goto(`${BASE}/settings.html`);
    await page
      .locator("#add-client-form button[type=submit]:not([disabled])")
      .waitFor({ timeout: 15000 });
    await page.click("[data-client-toggle]");
    const id = (await rest("clients?name=eq.E2E%20Acme%20Corp&select=id"))[0].id;
    await page.fill(`#cl-contact_name-${id}`, "E2E Contact");
    await page.fill(`#cl-rate-${id}`, "8.33%");
    await page.click("#clients-table");           // blur commits, like the Login ID column
    const rows = await waitForRows(
      "clients?name=eq.E2E%20Acme%20Corp&contact_name=eq.E2E%20Contact&select=rate"
    );
    if (rows.length !== 1) throw new Error("contact details not saved");
    if (rows[0].rate !== "8.33%") throw new Error(`rate = ${rows[0].rate}`);
  });

  await step("Client registry: renaming moves every card that used the old name", async () => {
    const id = (await rest("clients?name=eq.E2E%20Acme%20Corp&select=id"))[0].id;
    const before = await rest(
      `tasks?project_id=eq.${projectId}&fields->>client=eq.E2E%20Acme%20Corp&select=id`
    );
    if (!before.length) throw new Error("no card carries the client to begin with");
    const r = await rest("rpc/rename_client", {
      method: "POST",
      body: { p_client_id: id, p_new_name: "E2E Renamed Corp" },
    });
    const res = Array.isArray(r) ? r[0] : r;
    if (res.tasks !== before.length) throw new Error(`renamed ${res.tasks}, expected ${before.length}`);
    // The card must follow the rename, not be left pointing at a dead name.
    const after = await rest(
      `tasks?project_id=eq.${projectId}&fields->>client=eq.E2E%20Renamed%20Corp&select=id`
    );
    if (after.length !== before.length) throw new Error("cards did not follow the rename");
    if ((await rest(`tasks?project_id=eq.${projectId}&fields->>client=eq.E2E%20Acme%20Corp&select=id`)).length)
      throw new Error("a card kept the old name");
    await rest("rpc/rename_client", {
      method: "POST",
      body: { p_client_id: id, p_new_name: "E2E Acme Corp" },
    });
  });

  await step("Client registry: a rename onto an existing name is refused", async () => {
    const id = (await rest("clients?name=eq.E2E%20Acme%20Corp&select=id"))[0].id;
    const other = (await rest("clients?name=neq.E2E%20Acme%20Corp&select=name&limit=1"))[0];
    let refused = false;
    try {
      await rest("rpc/rename_client", {
        method: "POST",
        // Different case on purpose: near-duplicates are what the guard is for.
        body: { p_client_id: id, p_new_name: other.name.toUpperCase() },
      });
    } catch (e) {
      refused = /already exists/i.test(e.message);
    }
    if (!refused) throw new Error("a duplicate name was allowed");
    const still = await rest("clients?name=eq.E2E%20Acme%20Corp&select=id");
    if (still.length !== 1) throw new Error("the client was renamed anyway");
  });

  await step("Client tag: All Tasks filter + chip", async () => {
    await page.goto(`${BASE}/team.html`);
    await page.locator("tr.clickable").first().waitFor({ timeout: 8000 });
    await choose("filter-client", { label: "E2E Acme Corp" });
    await page.waitForTimeout(200);
    const rows = page.locator("tr.clickable");
    if ((await rows.count()) !== 1) throw new Error("All Tasks client filter wrong");
    if (!(await rows.first().locator(".client-chip", { hasText: "E2E Acme Corp" }).count()))
      throw new Error("client chip missing in All Tasks row");
    await page.click("#filter-clear");
  });

  // ---------- AC-07: All Tasks master view ----------
  await step("AC-07: All Tasks lists every task across projects with filters", async () => {
    await page.goto(`${BASE}/team.html`);
    await page.locator("tr.clickable").first().waitFor({ timeout: 8000 });
    if ((await page.locator("tr.clickable").count()) < 3) throw new Error("master list missing tasks");
    // title search
    await page.fill("#filter-search", "google sheets");
    await page.waitForTimeout(200);
    if ((await page.locator("tr.clickable").count()) !== 1) throw new Error("search filter wrong");
    await page.fill("#filter-search", "");
    // scope to the e2e project so live user data can't skew counts
    await choose("filter-project", { label: PROJECT_NAME });
    await page.waitForTimeout(200);
    if ((await page.locator("tr.clickable").count()) !== 3) throw new Error("project filter wrong");
    // assignee filter (within project)
    await choose("filter-assignee", { label: "Depesh" });
    await page.waitForTimeout(200);
    if ((await page.locator("tr.clickable").count()) !== 2) throw new Error("assignee filter wrong");
    await choose("filter-assignee", { value: "none" });
    await page.waitForTimeout(200);
    const unassignedRows = page.locator("tr.clickable");
    if ((await unassignedRows.count()) !== 1 || !(await unassignedRows.first().innerText()).includes("Future e2e task"))
      throw new Error("unassigned filter wrong");
    // date filter (within project)
    await choose("filter-assignee", { value: "" });
    await choose("filter-due", { value: "overdue" });
    await page.waitForTimeout(200);
    const row = page.locator("tr.clickable").first();
    if (!(await row.innerText()).includes("Overdue e2e task")) throw new Error("overdue filter wrong");
    const cls = await row.locator(".due").getAttribute("class");
    if (!cls.includes("overdue")) throw new Error("overdue date not red");
    // custom date range on All Tasks
    await choose("filter-due", { value: "custom" });
    await page.fill("#filter-from", isoDaysFromNow(-5));
    await page.fill("#filter-to", isoDaysFromNow(0));
    await page.waitForTimeout(200);
    if ((await page.locator("tr.clickable").count()) !== 1) throw new Error("custom range on All Tasks wrong");
    await page.click("#filter-clear");
    await page.waitForTimeout(200);
    await page.locator("tr.clickable", { hasText: "Task from Google Sheets" }).click();
    await page.waitForURL(/board\.html\?project=/);
  });

  // ---------- AC-06: team member management ----------
  await step("AC-06: add a team member from Settings", async () => {
    await page.goto(`${BASE}/settings.html`);
    await page.fill("#m-name", "E2E Temp");
    await page.fill("#m-role", "QA");
    await page.click('#add-member-form button[type="submit"]');
    await expectToast("Member added");
    await page.locator("tr", { hasText: "E2E Temp" }).waitFor({ timeout: 5000 });
  });

  await step("Delete blocked while member has tasks; allowed after unassigning", async () => {
    const tempId = (await rest("team_members?name=eq.E2E%20Temp&select=id"))[0].id;
    await rest(`tasks?id=eq.${zapTaskId}`, { method: "PATCH", body: { assignee_id: tempId } });
    const row = page.locator("tr", { hasText: "E2E Temp" });
    await row.locator("[data-delete]").click();
    await expectToast("has tasks assigned");
    await rest(`tasks?id=eq.${zapTaskId}`, { method: "PATCH", body: { assignee_id: depeshId } });
    await row.locator("[data-delete]").click(); // arm
    await row.locator("[data-delete]", { hasText: "Confirm" }).click(); // confirm
    await expectToast("Member deleted");
    await page.waitForTimeout(300);
    if (await page.locator("tr", { hasText: "E2E Temp" }).count()) throw new Error("row still present");
  });

  await step("Deactivate toggle hides member from assignee dropdown", async () => {
    const row = page.locator("tr", { hasText: "Rihen" });
    await row.locator('.switch .slider').click();
    await expectToast("deactivated");
    await page.goto(`${BASE}/board.html?project=${projectId}`);
    await page.locator(".add-task-btn").first().waitFor();
    await page.locator(".add-task-btn").first().click();
    const labels = await page.evaluate(() => [...document.querySelectorAll("#t-assignee option")].map((o) => o.textContent));
    if (labels.some((l) => l.trim() === "Rihen")) throw new Error("inactive member still in dropdown");
    await page.click("#task-cancel");
    await page.goto(`${BASE}/settings.html`);
    await page.locator("tr", { hasText: "Rihen" }).locator('.switch .slider').click();
    await expectToast("activated");
  });

  // ---------- inbox: assignment notifications ----------
  let inboxTaskId, sahilId;
  await step("Inbox: assigning a task notifies the assignee", async () => {
    sahilId = (await rest("team_members?login_code=eq.sahil&select=id"))[0].id;
    await page.goto(`${BASE}/board.html?project=${projectId}`);
    await page.locator(".add-task-btn").first().waitFor();
    await page.locator('.kanban-col[data-status="Backlog"] .add-task-btn').click();
    await page.fill("#t-title", "Inbox e2e task");
    await choose("t-assignee", { label: "Sahil" });
    await page.click("#task-save");
    await expectToast("Task created");
    await page.waitForTimeout(600); // notification insert is fire-and-forget
    const notifs = await rest(
      `notifications?member_id=eq.${sahilId}&kind=eq.task_assigned&message=eq.Inbox%20e2e%20task&select=id,task_id`
    );
    if (notifs.length !== 1) throw new Error(`expected 1 assigned notification, got ${notifs.length}`);
    inboxTaskId = notifs[0].task_id;
  });

  await step("Inbox: badge + notification visible to Sahil; click opens the task", async () => {
    await become("sahil");
    await page.goto(`${BASE}/vyom.html`);
    const badge = page.locator(".inbox-badge");
    await badge.waitFor({ state: "visible", timeout: 8000 });
    await page.locator(".inbox-bell").click();
    const item = page.locator(".inbox-item.unread", { hasText: "assigned you a task" }).first();
    await item.waitFor({ timeout: 8000 });
    if (!(await item.innerText()).includes("Depesh")) throw new Error("actor name missing");
    await item.click();
    await page.waitForURL(/board\.html\?project=.*&task=/, { timeout: 8000 });
    // deep link opens the task modal pre-filled
    await page.locator("#task-modal.open").waitFor({ timeout: 8000 });
    if ((await page.inputValue("#t-title")) !== "Inbox e2e task") throw new Error("modal not on the task");
    await page.click("#task-cancel");
  });

  await step("Inbox: My Tasks tab groups Sahil's open tasks", async () => {
    await page.locator(".inbox-bell").click();
    await page.locator('.inbox-tab[data-tab="tasks"]').click();
    const task = page.locator(".inbox-task", { hasText: "Inbox e2e task" });
    await task.waitFor({ timeout: 8000 });
    if (!(await task.innerText()).includes(PROJECT_NAME)) throw new Error("project name missing in My Tasks");
    if (!(await page.locator(".inbox-group-label", { hasText: "No due date" }).count()))
      throw new Error("due-date grouping missing");
  });

  await step("Inbox: mark all read clears the badge", async () => {
    await page.locator('.inbox-tab[data-tab="notifs"]').click();
    await page.click("#inbox-mark-all");
    await page.locator(".inbox-badge").waitFor({ state: "hidden", timeout: 5000 });
    if (await page.locator(".inbox-item.unread").count()) throw new Error("unread rows remain");
    await page.locator(".inbox-close").click();
  });

  await step("Inbox: per-notification toggle marks unread and back", async () => {
    await page.locator(".inbox-bell").click();
    const item = page.locator(".inbox-item").first();
    await item.waitFor({ timeout: 8000 });
    await item.hover();
    await item.locator(".inbox-toggle").click();
    await page.locator(".inbox-item.unread").first().waitFor({ timeout: 5000 });
    await page.locator(".inbox-badge").waitFor({ state: "visible", timeout: 5000 });
    // and back to read (DOM-level click: the row's class flips inside the
    // handler, which races Playwright's post-click hit validation)
    const diag = await page.evaluate(() => {
      const t = document.querySelector(".inbox-item.unread .inbox-toggle");
      if (t) { t.click(); return null; }
      return {
        url: location.href,
        panelOpen: !!document.querySelector(".inbox-panel.open"),
        badgeHidden: document.querySelector(".inbox-badge")?.hidden,
        notifsPane: document.querySelector("#inbox-notifs")?.innerHTML.slice(0, 400),
      };
    });
    if (diag) throw new Error("no unread toggle. state=" + JSON.stringify(diag) + " netlog=" + JSON.stringify(netlog.slice(-12)));
    await page.locator(".inbox-badge").waitFor({ state: "hidden", timeout: 5000 });
    if (await page.locator(".inbox-item.unread").count()) throw new Error("still unread after toggle back");
    await page.locator(".inbox-close").click();
  });

  await step("Inbox: My Tasks caps long groups behind Show all", async () => {
    // give Sahil 10 extra undated tasks (11 total with 'Inbox e2e task')
    const bulk = await rest("tasks", {
      method: "POST",
      body: Array.from({ length: 10 }, (_, i) => ({
        project_id: projectId, title: `bulk-mytask-${i}`, status: "Backlog",
        assignee_id: sahilId, source: "manual",
      })),
    });
    await page.keyboard.press("Escape"); // ensure panel closed even if a prior step bailed
    await page.waitForTimeout(300);
    await page.locator(".inbox-bell").click();
    await page.locator('.inbox-tab[data-tab="tasks"]').click();
    const moreBtn = page.locator(".inbox-more", { hasText: "Show all" });
    await moreBtn.waitFor({ timeout: 8000 });
    if ((await page.locator(".inbox-task").count()) !== 8)
      throw new Error(`capped count = ${await page.locator(".inbox-task").count()}`);
    await moreBtn.click();
    await page.locator(".inbox-more", { hasText: "Show less" }).waitFor({ timeout: 3000 });
    if ((await page.locator(".inbox-task").count()) !== 11)
      throw new Error(`expanded count = ${await page.locator(".inbox-task").count()}`);
    await page.locator(".inbox-more", { hasText: "Show less" }).click();
    await page.waitForTimeout(250); // collapse re-render is deferred a tick
    if ((await page.locator(".inbox-task").count()) !== 8) throw new Error("collapse failed");
    await page.locator(".inbox-close").click();
    for (const r of bulk) await rest(`tasks?id=eq.${r.id}`, { method: "DELETE" });
    await page.reload();
  });

  // ---------- @mentions ----------
  await step("Mentions: @ opens the member picker and inserts the name", async () => {
    await become("depesh");
    await page.goto(`${BASE}/board.html?project=${projectId}`);
    await page.locator(".task-card", { hasText: "Inbox e2e task" }).click();
    await page.locator("#task-modal.open").waitFor();
    await page.click("#t-notes");
    await page.type("#t-notes", "Please review this @Sa");
    const menu = page.locator("#mention-menu");
    await menu.waitFor({ state: "visible", timeout: 5000 });
    await menu.locator(".mention-item", { hasText: "Sahil" }).click();
    const val = await page.inputValue("#t-notes");
    if (!val.includes("@Sahil ")) throw new Error(`notes after pick: ${val}`);
    if (!(await menu.isHidden())) throw new Error("picker still open after pick");
  });

  await step("Mentions: saving notifies the mentioned member exactly once", async () => {
    await page.click("#task-save");
    await expectToast("Task updated");
    await page.waitForTimeout(600);
    const q = `notifications?member_id=eq.${sahilId}&kind=eq.mention&task_id=eq.${inboxTaskId}&select=id`;
    if ((await rest(q)).length !== 1) throw new Error("expected exactly 1 mention notification");
    // re-saving unchanged notes must NOT re-notify
    await page.locator(".task-card", { hasText: "Inbox e2e task" }).click();
    await page.click("#task-save");
    await expectToast("Task updated");
    await page.waitForTimeout(600);
    if ((await rest(q)).length !== 1) throw new Error("duplicate mention notification on re-save");
    // remove the extra task so later count assertions stay valid (notifications cascade)
    await rest(`tasks?id=eq.${inboxTaskId}`, { method: "DELETE" });
    await page.reload();
  });

  // ---------- project tags ----------
  await step("Tags: admin creates a tag in Settings; duplicate is rejected", async () => {
    await page.goto(`${BASE}/settings.html`);
    await page.fill("#tag-name", "E2E Tag");
    await page.click('#add-tag-form button[type="submit"]');
    await expectToast("added");
    await page.locator(".tag-chip.managed", { hasText: "E2E Tag" }).waitFor({ timeout: 5000 });
    await page.fill("#tag-name", "e2e tag"); // case-insensitive duplicate
    await page.click('#add-tag-form button[type="submit"]');
    await page.locator(".field-error", { hasText: "already exists" }).waitFor({ timeout: 3000 });
  });

  await step("Tags: project picks from the dropdown; chip shows; filter narrows", async () => {
    await page.goto(`${BASE}/vyom.html`);
    const card = page.locator(".project-card", { hasText: PROJECT_NAME });
    await card.waitFor();
    await card.locator(".edit-btn").click();
    await choose("p-tag-select", { label: "E2E Tag" });
    await page.locator("#p-tags-chips .tag-chip", { hasText: "E2E Tag" }).waitFor({ timeout: 3000 });
    await page.click("#project-save");
    await expectToast("Project updated");
    await card.locator(".card-tags .tag-chip", { hasText: "E2E Tag" }).waitFor({ timeout: 5000 });
    // filter narrows to tagged projects only
    await choose("filter-tag", { label: "E2E Tag" });
    await page.waitForTimeout(200);
    if ((await page.locator(".project-card").count()) !== 1) throw new Error("tag filter did not narrow");
    await choose("filter-tag", { label: "All tags" });
  });

  // ---------- roles: external users ----------
  let extId;
  await step("Roles: create an external user and grant one project", async () => {
    await page.goto(`${BASE}/settings.html`);
    await page.fill("#m-name", "E2E External");
    await page.fill("#m-code", "e2e-ext");
    await choose("m-access", { label: "External" });
    await page.click('#add-member-form button[type="submit"]');
    await expectToast("External user added");
    const row = page.locator("tr", { hasText: "E2E External" });
    await row.waitFor({ timeout: 5000 });
    extId = (await rest("team_members?login_code=eq.e2e-ext&select=id"))[0].id;
    const accessBtn = row.locator("[data-access]");
    if ((await accessBtn.innerText()) !== "0 projects") throw new Error("should start with 0 projects");
    await accessBtn.click();
    const pop = page.locator("#access-popover");
    await pop.waitFor({ timeout: 3000 });
    await pop.locator(".access-row", { hasText: PROJECT_NAME }).locator("input").check();
    // the grant POST is async — poll until the button label reflects it
    const deadline = Date.now() + 8000;
    while ((await accessBtn.innerText()) !== "1 project" && Date.now() < deadline)
      await page.waitForTimeout(250);
    if ((await accessBtn.innerText()) !== "1 project") throw new Error("access count not updated");
    await page.click("h1"); // close popover
    const rows = await rest(`project_members?member_id=eq.${extId}&select=project_id`);
    if (rows.length !== 1 || rows[0].project_id !== projectId) throw new Error("access row wrong in DB");
  });

  await step("Roles: external sees only granted project; no create/edit; no Settings", async () => {
    await become("e2e-ext");
    await page.goto(`${BASE}/vyom.html`);
    await page.locator(".project-card").first().waitFor({ timeout: 8000 });
    if ((await page.locator(".project-card").count()) !== 1) throw new Error("external sees extra projects");
    if (!(await page.locator(".project-card", { hasText: PROJECT_NAME }).count()))
      throw new Error("granted project missing");
    if (await page.locator("#new-project-btn").isVisible()) throw new Error("external can create projects");
    if (await page.locator(".ghost-card").count()) throw new Error("ghost card visible to external");
    if (await page.locator(".project-card .edit-btn").count()) throw new Error("external can edit project");
    if (await page.locator('.nav-right a[href="settings.html"]').count())
      throw new Error("external sees Settings link");
  });

  await step("Roles: external is blocked from other boards, Settings, and sees scoped All Tasks", async () => {
    const other = await rest(`projects?id=neq.${projectId}&select=id&limit=1`);
    if (other.length) {
      await page.goto(`${BASE}/board.html?project=${other[0].id}`);
      await page.waitForURL(/vyom\.html/, { timeout: 8000 });
    }
    await page.goto(`${BASE}/settings.html`);
    await page.waitForURL(/vyom\.html/, { timeout: 8000 });
    await page.goto(`${BASE}/team.html`);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(400);
    const rows = await page.locator("tr.clickable").count();
    const e2eRows = await page.locator("tr.clickable", { hasText: PROJECT_NAME }).count();
    if (rows !== e2eRows) throw new Error("All Tasks shows other projects' tasks to external");
    // external can still work inside their project
    await page.goto(`${BASE}/board.html?project=${projectId}`);
    await page.locator(".kanban-col").first().waitFor({ timeout: 8000 });
    if (!(await page.locator(".add-task-btn").count())) throw new Error("external cannot add tasks");
  });

  await step("Roles: login ID can be changed inline from Settings", async () => {
    await become("depesh");
    await page.goto(`${BASE}/settings.html`);
    const row = page.locator("tr", { hasText: "E2E External" });
    await row.waitFor({ timeout: 8000 });
    const input = row.locator(".login-code-input");
    await input.fill("e2e-ext-2");
    await input.blur();
    await expectToast("e2e-ext-2");
    const m = await rest(`team_members?id=eq.${extId}&select=login_code`);
    if (m[0].login_code !== "e2e-ext-2") throw new Error("login code not saved");
    // duplicate code rejected
    await input.fill("depesh");
    await input.blur();
    await expectToast("already taken");
  });

  await step("Roles: delete external user (access rows cascade)", async () => {
    const row = page.locator("tr", { hasText: "E2E External" });
    await row.locator("[data-delete]").click(); // arm
    await row.locator("[data-delete]", { hasText: "Confirm" }).click();
    await expectToast("Member deleted");
    if ((await rest(`project_members?member_id=eq.${extId}&select=project_id`)).length)
      throw new Error("access rows did not cascade");
  });

  // ---------- self-serve webhooks ----------
  const mgmtToken = process.env.SUPA_MGMT_TOKEN;
  async function mgmtQuery(sql) {
    const r = await fetch("https://api.supabase.com/v1/projects/mejebezwvyfkhufkgkej/database/query", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${mgmtToken}`,
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) Chrome/126.0",
      },
      body: JSON.stringify({ query: sql }),
    });
    if (!r.ok) throw new Error(`mgmt query ${r.status}`);
    return r.json();
  }
  // Poll pg_net's response log for an echoed delivery containing `needle`
  async function findDelivery(needle, timeoutMs = 20000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const rows = await mgmtQuery(
        `select id from net._http_response where content::text like '%${needle.replace(/'/g, "''")}%' limit 1`
      );
      if (rows.length) return true;
      await new Promise((r) => setTimeout(r, 2500));
    }
    return false;
  }

  await step("Webhooks: add via Settings UI, scoped to the e2e project", async () => {
    await page.goto(`${BASE}/settings.html`);
    await page.fill("#w-label", "e2e hook");
    await page.fill("#w-url", "https://postman-echo.com/post");
    await choose("w-project", { label: PROJECT_NAME });
    await page.click('#add-webhook-form button[type="submit"]');
    await expectToast("Webhook added");
    await page.locator("#webhooks-table tr", { hasText: "e2e hook" }).waitFor({ timeout: 5000 });
    const rows = await rest(`webhooks?label=eq.e2e%20hook&select=id,project_id,events,active`);
    if (rows.length !== 1 || rows[0].project_id !== projectId) throw new Error("webhook row wrong");
    if (JSON.stringify(rows[0].events) !== '["INSERT","UPDATE"]') throw new Error("events wrong");
  });

  await step("Webhooks: Send test button fires a delivery", async () => {
    await page.locator("#webhooks-table tr", { hasText: "e2e hook" }).locator("[data-wh-test]").click();
    await expectToast("Test sent");
    if (!(await findDelivery("Test task from Vyom"))) throw new Error("test delivery not observed");
  });

  let extraTaskIds = [];
  await step("Webhooks: task INSERT in scoped project is delivered with names", async () => {
    const t = await rest("tasks", {
      method: "POST",
      body: { project_id: projectId, title: "wh-delivery-e2e-1", status: "Backlog", source: "manual" },
    });
    extraTaskIds.push(t[0].id);
    if (!(await findDelivery("wh-delivery-e2e-1"))) throw new Error("delivery not observed");
    const hit = await mgmtQuery(
      `select content::text like '%project_name%' as named from net._http_response where content::text like '%wh-delivery-e2e-1%' limit 1`
    );
    if (!hit[0].named) throw new Error("payload missing human-readable names");
  });

  let otherProjectId;
  await step("Webhooks: task in a different project does NOT fire a scoped hook", async () => {
    const p = await rest("projects", {
      method: "POST",
      body: { name: "E2E Scope Other", statuses: ["Only"], color: "#64748B" },
    });
    otherProjectId = p[0].id;
    await rest("tasks", {
      method: "POST",
      body: { project_id: otherProjectId, title: "wh-scope-e2e-2", status: "Only", source: "manual" },
    });
    if (await findDelivery("wh-scope-e2e-2", 9000)) throw new Error("scoped hook fired for other project");
  });

  await step("Webhooks: paused hook sends nothing; delete removes it", async () => {
    const row = page.locator("#webhooks-table tr", { hasText: "e2e hook" });
    await row.locator(".switch .slider").click();
    await expectToast("paused");
    const t = await rest("tasks", {
      method: "POST",
      body: { project_id: projectId, title: "wh-paused-e2e-3", status: "Backlog", source: "manual" },
    });
    extraTaskIds.push(t[0].id);
    if (await findDelivery("wh-paused-e2e-3", 9000)) throw new Error("paused hook still fired");
    await row.locator("[data-wh-delete]").click();
    await row.locator("[data-wh-delete]", { hasText: "Confirm" }).click();
    await expectToast("Webhook deleted");
    if ((await rest("webhooks?label=eq.e2e%20hook&select=id")).length) throw new Error("row not deleted");
    // clean the extra tasks + scope project so later count assertions hold
    for (const id of extraTaskIds) await rest(`tasks?id=eq.${id}`, { method: "DELETE" });
    await rest(`projects?id=eq.${otherProjectId}`, { method: "DELETE" });
  });

  await step("Incoming snippet generator shows real project UUID and statuses", async () => {
    await choose("snippet-project", { label: PROJECT_NAME });
    const out = page.locator("#snippet-output");
    await out.waitFor({ state: "visible" });
    const text = await out.innerText();
    if (!text.includes(projectId)) throw new Error("project UUID missing from snippet");
    if (!text.includes("Backlog")) throw new Error("statuses missing from snippet");
    if (!text.includes("apikey:")) throw new Error("headers missing from snippet");
    await out.locator(".copy-btn").first().click();
    await page.locator(".copy-btn", { hasText: "Copied!" }).first().waitFor({ timeout: 3000 });
  });

  // ---------- status reordering ----------
  await step("Statuses: drag-reorder chips reorders board columns", async () => {
    await page.goto(`${BASE}/vyom.html`);
    const card = page.locator(".project-card", { hasText: PROJECT_NAME });
    await card.waitFor();
    await card.locator(".edit-btn").click();
    await dragChip("Doing", "Backlog"); // move Doing to the front
    await page.click("#project-save");
    await expectToast("Project updated");
    await page.waitForTimeout(300);
    const p = await rest(`projects?id=eq.${projectId}&select=statuses`);
    if (JSON.stringify(p[0].statuses) !== JSON.stringify(["Doing", "Backlog", "Review", "Done"]))
      throw new Error(`statuses in DB = ${JSON.stringify(p[0].statuses)}`);
    await page.goto(`${BASE}/board.html?project=${projectId}`);
    await page.locator(".kanban-col").first().waitFor({ timeout: 8000 });
    const titles = await page.locator(".col-title").evaluateAll((els) => els.map((e) => e.textContent.trim()));
    if (JSON.stringify(titles) !== JSON.stringify(["Doing", "Backlog", "Review", "Done"]))
      throw new Error(`columns = ${JSON.stringify(titles)}`);
    // restore the original order for the steps that follow
    await page.goto(`${BASE}/vyom.html`);
    await card.waitFor();
    await card.locator(".edit-btn").click();
    await dragChip("Backlog", "Doing");
    await page.click("#project-save");
    await expectToast("Project updated");
  });

  // ---------- F-02: transition mapping on status removal ----------
  await step("F-02: removing an in-use status blocks save until tasks are mapped", async () => {
    await page.goto(`${BASE}/vyom.html`);
    const card = page.locator(".project-card", { hasText: PROJECT_NAME });
    await card.waitFor();
    await card.locator(".edit-btn").click();
    // remove "Review" (holds the zapier task)
    await page.locator(".tag-editor .tag", { hasText: "Review" }).locator("button").click();
    await page.click("#project-save");
    const remap = page.locator("#status-remap");
    await remap.waitFor({ state: "visible", timeout: 5000 });
    const txt = await remap.innerText();
    if (!txt.includes("1 task in “Review”")) throw new Error(`remap text = ${txt}`);
    if ((await page.locator("#project-save").innerText()) !== "Move tasks & save")
      throw new Error("save button label not updated");
    await choose("remap-sel-0", { label: "Doing" });
    await page.click("#project-save");
    await expectToast("Moved 1 task");
    await page.waitForTimeout(400);
    const t = await rest(`tasks?id=eq.${zapTaskId}&select=status`);
    if (t[0].status !== "Doing") throw new Error(`task status in DB = ${t[0].status}`);
    await page.goto(`${BASE}/board.html?project=${projectId}`);
    await page.locator(".kanban-col").first().waitFor({ timeout: 8000 });
    if (await page.locator(".kanban-col.removed-status").count())
      throw new Error("removed column should not exist after mapping");
  });

  await step("Out-of-app orphaned status still renders as a (removed) column", async () => {
    // statuses changed outside the app can't go through the mapping — the
    // board must still show them (never hide tasks), and drag-out must work
    await rest(`tasks?id=eq.${zapTaskId}`, { method: "PATCH", body: { status: "Ghost" } });
    await page.reload();
    const removedCol = page.locator(".kanban-col.removed-status");
    await removedCol.waitFor({ timeout: 8000 });
    if (!(await removedCol.locator(".task-card", { hasText: "Task from Google Sheets" }).count()))
      throw new Error("task not in removed column");
    await dragCardToColumn(zapTaskId, "Done");
    await page
      .locator('.kanban-col[data-status="Done"] .task-card', { hasText: "Task from Google Sheets" })
      .waitFor({ timeout: 5000 });
    await page.waitForTimeout(400); // let the PATCH land
  });

  // ---------- dashboard counts + archive ----------
  await step("Dashboard card shows task count and overdue count", async () => {
    await page.goto(`${BASE}/vyom.html`);
    const card = page.locator(".project-card", { hasText: PROJECT_NAME });
    await card.waitFor();
    const meta = await card.locator(".meta").innerText();
    // Counted from the database rather than hardcoded: an earlier step that
    // bails out mid-way (the four webhook checks do exactly that when there's
    // no SUPA_MGMT_TOKEN) leaves its task behind, and that must not show up
    // here as a phantom dashboard bug.
    const rows = await rest(`tasks?project_id=eq.${projectId}&select=due_date`);
    const overdue = rows.filter((r) => r.due_date && r.due_date < isoDaysFromNow(0)).length;
    if (!meta.includes(`${rows.length} task`)) throw new Error(`meta = ${meta}; db has ${rows.length}`);
    if (!overdue) throw new Error("expected at least one overdue task by this point");
    if (!meta.includes(`${overdue} overdue`)) throw new Error(`meta = ${meta}; db has ${overdue} overdue`);
  });

  await step("F-02: archive hides project; Show archived reveals; unarchive restores", async () => {
    const card = page.locator(".project-card", { hasText: PROJECT_NAME });
    await card.locator(".edit-btn").click();
    await page.click("#archive-btn");
    await expectToast("archived");
    await page.waitForTimeout(300);
    if (await page.locator(".project-card", { hasText: PROJECT_NAME }).count())
      throw new Error("card still visible after archive");
    await page.click("#show-archived");
    const archivedCard = page.locator(".project-card.archived", { hasText: PROJECT_NAME });
    await archivedCard.waitFor({ timeout: 5000 });
    await archivedCard.locator(".edit-btn").click();
    await page.click("#archive-btn");
    await expectToast("restored");
  });

  // ---------- offline banner ----------
  await step("Offline banner appears when connection drops", async () => {
    await context.setOffline(true);
    await page.locator("#offline-banner").waitFor({ state: "visible", timeout: 5000 });
    await context.setOffline(false);
    await page.locator("#offline-banner").waitFor({ state: "hidden", timeout: 5000 });
  });

  // ---------- tag deletion propagates ----------
  await step("Tags: deleting a tag strips it from projects that use it", async () => {
    await page.goto(`${BASE}/settings.html`);
    const chip = page.locator(".tag-chip.managed", { hasText: "E2E Tag" });
    await chip.waitFor({ timeout: 8000 });
    if (!(await chip.locator(".tag-usage").innerText()).includes("1"))
      throw new Error("usage count wrong");
    await chip.locator("button").click(); // arm
    await page.locator(".tag-chip.managed", { hasText: "E2E Tag" }).locator("button").click(); // confirm
    await expectToast("deleted");
    if ((await rest("tags?name=eq.E2E%20Tag&select=id")).length) throw new Error("tag row remains");
    const p = await rest(`projects?id=eq.${projectId}&select=tags`);
    if ((p[0].tags || []).includes("E2E Tag")) throw new Error("tag not stripped from project");
  });

  // ---------- sub-client status inheritance (requires sql/12) ----------
  let subId, subTaskId;
  await step("Sub-client: inherit toggle defaults on; parent columns shown read-only", async () => {
    await page.goto(`${BASE}/vyom.html`);
    await page.locator("#new-project-btn").waitFor({ timeout: 8000 });
    await page.waitForLoadState("networkidle");
    await page.click("#new-project-btn");
    await page.fill("#p-name", "E2E Sub Client");
    await choose("p-parent", { label: PROJECT_NAME });
    await page.locator("#p-statuses-src-group").waitFor({ state: "visible", timeout: 3000 });
    if (!(await page.locator('input[name="p-statuses-src"][value="inherit"]').isChecked()))
      throw new Error("inherit not preselected for a new sub-client");
    if (!(await page.locator("#p-statuses-group").isHidden()))
      throw new Error("status editor still visible while inheriting");
    const chips = await page
      .locator("#inherited-statuses .tag")
      .evaluateAll((els) => els.map((e) => e.textContent.trim()));
    const parent = await rest(`projects?id=eq.${projectId}&select=statuses`);
    if (JSON.stringify(chips) !== JSON.stringify(parent[0].statuses))
      throw new Error(`inherited chips = ${JSON.stringify(chips)}`);
    await page.click("#project-save");
    await expectToast("Project created");
    const sub = (await rest("projects?name=eq.E2E%20Sub%20Client&select=id,inherit_statuses"))[0];
    if (!sub.inherit_statuses) throw new Error("inherit_statuses not saved");
    subId = sub.id;
  });

  await step("Sub-client board mirrors the parent's columns live", async () => {
    // add a NEW parent column out-of-band; the child board must pick it up
    // (proves live link — the child's stored snapshot doesn't have it)
    const parent = (await rest(`projects?id=eq.${projectId}&select=statuses`))[0];
    await rest(`projects?id=eq.${projectId}`, {
      method: "PATCH",
      body: { statuses: [...parent.statuses, "Extra"] },
    });
    await page.goto(`${BASE}/board.html?project=${subId}`);
    await page.locator(".kanban-col").first().waitFor({ timeout: 8000 });
    const titles = await page.locator(".col-title").evaluateAll((els) => els.map((e) => e.textContent.trim()));
    if (!titles.includes("Extra")) throw new Error(`child columns = ${JSON.stringify(titles)} (live link broken)`);
    if (!(await page.locator(".subclient-tag", { hasText: "columns inherited" }).count()))
      throw new Error("inherited badge missing");
  });

  await step("ingest_task resolves inherited statuses (parent column accepted)", async () => {
    const key = (await rest("api_keys", { method: "POST", body: { project_id: subId, label: "E2E Key" } }))[0];
    const res = await rest("rpc/ingest_task", {
      method: "POST",
      body: { p_api_key: key.key, p_title: "e2e-ingest-sub", p_status: "Extra" },
    });
    if (res.status !== "Extra")
      throw new Error(`ingested status = ${res.status} (fell back — parent list not resolved)`);
    subTaskId = res.task_id;
  });

  await step("Parent status edit includes inheriting child's tasks in the mapping", async () => {
    await page.goto(`${BASE}/vyom.html`);
    const card = page.locator(".project-card", { hasText: PROJECT_NAME }).first();
    await card.waitFor();
    await card.locator(".edit-btn").click();
    await page.locator(".tag-editor .tag", { hasText: "Extra" }).locator("button").click();
    await page.click("#project-save");
    const remap = page.locator("#status-remap");
    await remap.waitFor({ state: "visible", timeout: 5000 });
    const txt = await remap.innerText();
    if (!txt.includes("1 task in “Extra”")) throw new Error(`remap text = ${txt}`);
    if (!txt.includes("sub-client")) throw new Error("mapping does not mention inheriting sub-clients");
    await choose("remap-sel-0", { label: "Done" });
    await page.click("#project-save");
    await expectToast("project updated");
    await page.waitForTimeout(400);
    const t = await rest(`tasks?id=eq.${subTaskId}&select=status`);
    if (t[0].status !== "Done") throw new Error(`child task status = ${t[0].status}`);
  });

  await step("Sub-client: switch to custom copies parent columns; back to inherit remaps", async () => {
    await page.goto(`${BASE}/vyom.html`);
    const card = page.locator(".project-card", { hasText: PROJECT_NAME }).first();
    await card.waitFor();
    await card.locator(".sub-edit[data-subedit]").click();
    await page.locator("#project-modal.open").waitFor({ timeout: 5000 });
    await page.locator('.type-opt:has(input[name="p-statuses-src"][value="custom"])').click();
    const parent = (await rest(`projects?id=eq.${projectId}&select=statuses`))[0];
    const chips = await page
      .locator("#status-tags .tag")
      .evaluateAll((els) => els.map((e) => e.textContent.replace("×", "").trim()));
    if (JSON.stringify(chips) !== JSON.stringify(parent.statuses))
      throw new Error(`custom pre-fill = ${JSON.stringify(chips)}`);
    await page.fill("#status-input", "Child Only");
    await page.press("#status-input", "Enter");
    await page.click("#project-save");
    await expectToast("Project updated");
    // park the child's task in the custom-only column, then switch back
    await rest(`tasks?id=eq.${subTaskId}`, { method: "PATCH", body: { status: "Child Only" } });
    await card.locator(".sub-edit[data-subedit]").click();
    await page.locator("#project-modal.open").waitFor({ timeout: 5000 });
    await page.locator('.type-opt:has(input[name="p-statuses-src"][value="inherit"])').click();
    await page.click("#project-save");
    const remap = page.locator("#status-remap");
    await remap.waitFor({ state: "visible", timeout: 5000 });
    if (!(await remap.innerText()).includes("1 task in “Child Only”"))
      throw new Error(`remap text = ${await remap.innerText()}`);
    await choose("remap-sel-0", { label: "Done" });
    await page.click("#project-save");
    // Wait for the modal to CLOSE, not for a toast: the earlier save in this
    // same step also toasts "Project updated", and toast matching is
    // case-insensitive, so a still-visible stale toast let the assertions below
    // run before the second save had landed.
    await page.locator("#project-modal.open").waitFor({ state: "hidden", timeout: 8000 });
    await page.waitForTimeout(400);
    const rows = await rest(`tasks?id=eq.${subTaskId}&select=status`);
    if (rows[0].status !== "Done") throw new Error(`status = ${rows[0].status}`);
    const sub = (await rest(`projects?id=eq.${subId}&select=inherit_statuses`))[0];
    if (!sub.inherit_statuses) throw new Error("inherit flag not restored");
  });

  await step("Cleanup: delete sub-client project (cascades tasks + api keys)", async () => {
    await rest(`projects?id=eq.${subId}`, { method: "DELETE" });
    if ((await rest("api_keys?label=eq.E2E%20Key&select=id")).length)
      throw new Error("api key did not cascade");
  });

  // ---------- Hidden status columns (sql/14) ----------
  // Admin hides for the whole project; everyone else hides only for themselves.
  const colTitles = () =>
    page.$$eval(".kanban-col .col-title", (els) => els.map((e) => e.textContent.trim()));

  await step("Columns: admin hiding a column removes it and reports it in the pill", async () => {
    await become("depesh");
    await page.goto(`${BASE}/board.html?project=${projectId}`);
    await page.locator(".kanban-col").first().waitFor({ timeout: 8000 });
    const statuses = (await rest(`projects?id=eq.${projectId}&select=statuses`))[0].statuses;
    const target = statuses[1];
    await page.click("#columns-btn");
    await page.locator("#columns-modal.open").waitFor({ timeout: 5000 });
    if (!/for everyone/i.test(await page.textContent("#cols-scope-note")))
      throw new Error("admin should be told the change is project-wide");
    await page.click(`#cols-list input[data-col-status="${target}"]`);
    // The toggle PATCHes the project asynchronously; assert the DB only after
    // it has had a chance to land, or this races and reads the old value.
    await page.waitForTimeout(800);
    await page.click("#cols-close");
    if ((await colTitles()).includes(target)) throw new Error(`${target} still rendered`);
    const pill = page.locator("#hidden-cols-pill");
    await pill.waitFor({ state: "visible", timeout: 5000 });
    if (!/1 column hidden/.test(await pill.textContent()))
      throw new Error(`pill text = ${await pill.textContent()}`);
    const row = (await rest(`projects?id=eq.${projectId}&select=hidden_statuses`))[0];
    if (JSON.stringify(row.hidden_statuses) !== JSON.stringify([target]))
      throw new Error(`hidden_statuses = ${JSON.stringify(row.hidden_statuses)}`);
  });

  await step("Columns: hidden column survives reload and stays selectable on a card", async () => {
    const target = (await rest(`projects?id=eq.${projectId}&select=hidden_statuses`))[0].hidden_statuses[0];
    await page.goto(`${BASE}/board.html?project=${projectId}`);
    await page.locator(".kanban-col").first().waitFor({ timeout: 8000 });
    if ((await colTitles()).includes(target)) throw new Error("hidden column came back");
    await page.locator(".kanban-col .add-task-btn").first().click();
    await page.locator("#task-modal.open").waitFor({ timeout: 5000 });
    const opts = await page.$$eval("#t-status option", (els) => els.map((e) => e.textContent));
    if (!opts.some((o) => o === `${target} (hidden)`))
      throw new Error(`hidden status not offered: ${opts.join(", ")}`);
    await page.click("#task-cancel");
  });

  await step("Columns: the last visible column refuses to hide", async () => {
    const statuses = (await rest(`projects?id=eq.${projectId}&select=statuses`))[0].statuses;
    await page.click("#columns-btn");
    await page.locator("#columns-modal.open").waitFor({ timeout: 5000 });
    // Hide everything except the final column, then try to hide that too
    for (const s of statuses.slice(0, -1)) {
      const cb = page.locator(`#cols-list input[data-col-status="${s}"]`);
      if (await cb.isChecked()) {
        await cb.click();
        await page.waitForTimeout(220);
      }
    }
    const last = statuses[statuses.length - 1];
    await page.click(`#cols-list input[data-col-status="${last}"]`);
    await page.waitForTimeout(250);
    if (!(await page.locator(`#cols-list input[data-col-status="${last}"]`).isChecked()))
      throw new Error("the last visible column was allowed to be hidden");
    await expectToast("At least one column");
    if (!(await colTitles()).includes(last)) throw new Error("board lost its last column");
  });

  await step("Columns: Show all restores every column and clears the project's set", async () => {
    await page.click("#cols-show-all");
    await page.waitForTimeout(500);
    await page.click("#cols-close");
    const statuses = (await rest(`projects?id=eq.${projectId}&select=statuses`))[0].statuses;
    const titles = await colTitles();
    for (const s of statuses) if (!titles.includes(s)) throw new Error(`${s} missing: ${titles}`);
    if (!(await page.locator("#hidden-cols-pill").isHidden())) throw new Error("pill still visible");
    // Poll rather than assert once: the step above toggles several columns in
    // quick succession and each one PATCHes, so a fixed wait can read the row
    // while an earlier PATCH is still in flight behind the "Show all" one.
    let hidden = null;
    for (let i = 0; i < 10; i++) {
      hidden = (await rest(`projects?id=eq.${projectId}&select=hidden_statuses`))[0].hidden_statuses;
      if (JSON.stringify(hidden) === "[]") break;
      await page.waitForTimeout(300);
    }
    if (JSON.stringify(hidden) !== "[]") throw new Error(`project set not cleared: ${JSON.stringify(hidden)}`);
  });

  await step("Columns: a non-admin's hide is local and never touches the project", async () => {
    await become("sahil"); // member
    await page.goto(`${BASE}/board.html?project=${projectId}`);
    await page.locator(".kanban-col").first().waitFor({ timeout: 8000 });
    const target = (await rest(`projects?id=eq.${projectId}&select=statuses`))[0].statuses[1];
    await page.click("#columns-btn");
    await page.locator("#columns-modal.open").waitFor({ timeout: 5000 });
    if (!/only you/i.test(await page.textContent("#cols-scope-note")))
      throw new Error("member should be told the change is personal");
    await page.click(`#cols-list input[data-col-status="${target}"]`);
    await page.waitForTimeout(500);
    await page.click("#cols-close");
    if ((await colTitles()).includes(target)) throw new Error("personal hide had no effect");
    const row = (await rest(`projects?id=eq.${projectId}&select=hidden_statuses`))[0];
    if (JSON.stringify(row.hidden_statuses) !== "[]") throw new Error("a member wrote to the project row");
    const stored = await page.evaluate((id) => localStorage.getItem(`vyom_hidden_cols_${id}`), projectId);
    if (!stored || !stored.includes(target)) throw new Error(`not stored locally: ${stored}`);
  });

  await step("Columns: an admin's project-wide hide is locked for a non-admin", async () => {
    const statuses = (await rest(`projects?id=eq.${projectId}&select=statuses`))[0].statuses;
    await rest(`projects?id=eq.${projectId}`, {
      method: "PATCH",
      body: { hidden_statuses: [statuses[2]] },
    });
    await page.goto(`${BASE}/board.html?project=${projectId}`);
    await page.locator(".kanban-col").first().waitFor({ timeout: 8000 });
    await page.click("#columns-btn");
    await page.locator("#columns-modal.open").waitFor({ timeout: 5000 });
    const cb = page.locator(`#cols-list input[data-col-status="${statuses[2]}"]`);
    if (!(await cb.isDisabled())) throw new Error("a member could unhide an admin's column");
    if (!/hidden for everyone/i.test(await page.textContent(".cols-row.locked")))
      throw new Error("lock note missing");
    await page.click("#cols-close");
    const titles = await colTitles();
    if (titles.includes(statuses[1]) || titles.includes(statuses[2]))
      throw new Error(`both the personal and project hides should apply: ${titles}`);
    // Leave the board clean for the remaining checks
    await rest(`projects?id=eq.${projectId}`, { method: "PATCH", body: { hidden_statuses: [] } });
    await page.evaluate((id) => localStorage.removeItem(`vyom_hidden_cols_${id}`), projectId);
    await become("depesh");
  });

  // ---------- HR Stage Date (sql/13 status_changed_at, surfaced by sql/14) ----------
  let hrId, hrTaskId;
  await step("HR project: candidate cards have no due date, only a Stage Date", async () => {
    hrId = (
      await rest("projects", {
        method: "POST",
        body: {
          name: "E2E HR Project",
          type: "hr",
          visibility: "internal",
          statuses: ["Applied", "Interview", "Hired"],
          ops_statuses: ["To Do", "Done"],
          features: { board_tabs: true, roles_card: false, sla: false, auto_date: true },
        },
      })
    )[0].id;
    await page.goto(`${BASE}/board.html?project=${hrId}`);
    await page.locator('.kanban-col[data-status="Applied"]').waitFor({ timeout: 8000 });
    await page.click('.kanban-col[data-status="Applied"] .add-task-btn');
    await page.locator("#task-modal.open").waitFor({ timeout: 5000 });
    if (!(await page.locator("#t-due-group").isHidden())) throw new Error("due-date field should be gone");
    if (!(await page.locator("#t-stage-group").isVisible())) throw new Error("Stage Date missing");
    await page.fill("#t-title", "E2E Candidate");
    await page.click("#task-save");
    await expectToast("Task created");
    const rows = await rest(`tasks?project_id=eq.${hrId}&title=eq.E2E%20Candidate&select=*`);
    if (rows.length !== 1) throw new Error("task not created");
    hrTaskId = rows[0].id;
    if (rows[0].due_date !== null) throw new Error(`due_date = ${rows[0].due_date}`);
    if (!(await page.locator(".task-card .stage-pill").count())) throw new Error("stage pill missing");
    if (await page.locator(".task-card .due").count())
      throw new Error("a stage-dated card must never render a due pill");
  });

  await step("HR project: moving a card advances its Stage Date", async () => {
    const before = (await rest(`tasks?id=eq.${hrTaskId}&select=status_changed_at`))[0].status_changed_at;
    await dragCardToColumn(hrTaskId, "Interview");
    await page.waitForTimeout(700);
    const after = (await rest(`tasks?id=eq.${hrTaskId}&select=status,status_changed_at`))[0];
    if (after.status !== "Interview") throw new Error(`status = ${after.status}`);
    if (!(new Date(after.status_changed_at) > new Date(before)))
      throw new Error(`stage date did not advance: ${before} -> ${after.status_changed_at}`);
  });

  await step("HR project: Ops-tab cards keep real due dates", async () => {
    await page.click('.board-tab[data-tab="ops"]');
    await page.locator('.kanban-col[data-status="To Do"]').waitFor({ timeout: 5000 });
    await page.click('.kanban-col[data-status="To Do"] .add-task-btn');
    await page.locator("#task-modal.open").waitFor({ timeout: 5000 });
    if (!(await page.locator("#t-due-group").isVisible())) throw new Error("Ops cards need a due date");
    if (!(await page.locator("#t-stage-group").isHidden())) throw new Error("Ops cards shouldn't show a Stage Date");
    await page.fill("#t-title", "E2E Ops Task");
    await page.fill("#t-due", isoDaysFromNow(5));
    await page.click("#task-save");
    await expectToast("Task created");
    await page.waitForTimeout(600);
    const rows = await rest(`tasks?project_id=eq.${hrId}&title=eq.E2E%20Ops%20Task&select=due_date,fields`);
    if (!rows.length) throw new Error("the ops task was not saved");
    const row = rows[0];
    if (row.due_date !== isoDaysFromNow(5)) throw new Error(`ops due_date = ${row.due_date}`);
    if (row.fields.hr_category !== "ops") throw new Error("ops card not tagged hr_category=ops");
  });

  // ---------- HR SLA flags (sql/13) ----------
  // Regression guards: the flags used to be missing on first paint (the rules
  // were fetched after renderBoard) and invisible to non-admins entirely (the
  // fetch sat behind the admin check that guards the rule EDITOR).
  let slaCardId;
  await step("SLA: a breaching card is flagged on the first paint of the board", async () => {
    await rest(`projects?id=eq.${hrId}`, {
      method: "PATCH",
      body: { features: { board_tabs: true, roles_card: false, sla: true, auto_date: true } },
    });
    await rest("hr_sla_rules", {
      method: "POST",
      body: { project_id: hrId, from_status: "Applied", deadline_days: 4 },
    });
    slaCardId = (
      await rest("tasks", {
        method: "POST",
        body: {
          project_id: hrId,
          title: "E2E SLA Card",
          status: "Applied",
          source: "manual",
          fields: { hr_category: "candidate" },
        },
      })
    )[0].id;
    // 9 days in a 4-day stage = breach. Patching status_changed_at directly is
    // safe: the sql/13 trigger only overwrites it when the STATUS changes.
    await rest(`tasks?id=eq.${slaCardId}`, {
      method: "PATCH",
      body: { status_changed_at: new Date(Date.now() - 9 * 86400000).toISOString() },
    });
    await page.goto(`${BASE}/board.html?project=${hrId}`);
    const card = page.locator(`.task-card[data-id="${slaCardId}"]`);
    await card.waitFor({ timeout: 8000 });
    // No re-render, no waiting: it must be flagged as soon as it's drawn
    const cls = await card.getAttribute("class");
    if (!/sla-breach/.test(cls)) throw new Error(`expected sla-breach on first paint, got "${cls}"`);
  });

  await step("SLA: flags are visible to a non-admin too (rules aren't admin-only)", async () => {
    await become("sahil"); // member
    await page.goto(`${BASE}/board.html?project=${hrId}`);
    const card = page.locator(`.task-card[data-id="${slaCardId}"]`);
    await card.waitFor({ timeout: 8000 });
    const cls = await card.getAttribute("class");
    if (!/sla-breach/.test(cls)) throw new Error(`member sees no SLA flag: "${cls}"`);
    // …but the rule EDITOR stays admin-only
    if (!(await page.locator("#sla-btn").isHidden()))
      throw new Error("a member should not get the SLA Rules button");
    await become("depesh");
  });

  await step("SLA: hiding a column reports the flagged cards it takes out of view", async () => {
    await page.goto(`${BASE}/board.html?project=${hrId}`);
    await page.locator(".kanban-col").first().waitFor({ timeout: 8000 });
    await page.click("#columns-btn");
    await page.locator("#columns-modal.open").waitFor({ timeout: 5000 });
    await page.click('#cols-list input[data-col-status="Applied"]');
    await page.click("#cols-close");
    const pill = page.locator("#hidden-cols-pill");
    await pill.waitFor({ state: "visible", timeout: 5000 });
    const text = await pill.textContent();
    if (!/1 SLA-flagged/.test(text)) throw new Error(`pill should warn about the flagged card: "${text}"`);
    if (!(await pill.getAttribute("class")).includes("has-flagged"))
      throw new Error("pill missing the has-flagged treatment");
    // Restore, so the change-log steps below can still reach their card
    await page.click("#columns-btn");
    await page.locator("#columns-modal.open").waitFor({ timeout: 5000 });
    await page.click("#cols-show-all");
    await page.waitForTimeout(500);
    await page.click("#cols-close");
  });

  await step("HR project: the date filter speaks Stage Date, and still narrows", async () => {
    await page.goto(`${BASE}/board.html?project=${hrId}`);
    await page.locator(".kanban-col").first().waitFor({ timeout: 8000 });
    const opts = await page.$$eval("#filter-due option", (e) => e.map((x) => x.textContent));
    if (!opts.includes("In stage 7+ days"))
      throw new Error(`stage vocabulary missing: ${opts.join(" | ")}`);
    if (opts.includes("Overdue"))
      throw new Error("a Stage Date is not a deadline — 'Overdue' must not be offered");
    if (await page.$eval("#filter-due", (e) => e.closest(".dd").hidden))
      throw new Error("the date filter must not be hidden on an HR board");
    // Only the backdated SLA card has been in its stage for 7+ days
    await choose("filter-due", { value: "stale7" });
    await page.waitForTimeout(300);
    const shown = await page.$$eval(".task-card .task-title", (e) => e.map((x) => x.textContent.trim()));
    if (shown.length !== 1 || !shown[0].includes("E2E SLA Card"))
      throw new Error(`stale7 should leave only the 9-day card, got ${JSON.stringify(shown)}`);
    await page.click("#filter-clear");
    await page.waitForTimeout(300);
  });

  await step("HR project: the Ops tab switches the filter back to real due dates", async () => {
    await page.click('.board-tab[data-tab="ops"]');
    await page.waitForTimeout(400);
    const opts = await page.$$eval("#filter-due option", (e) => e.map((x) => x.textContent));
    if (!opts.includes("Overdue")) throw new Error(`ops tab needs due-date options: ${opts.join(" | ")}`);
    // A stage-only choice must not survive the switch
    await page.click('.board-tab[data-tab="hiring"]');
    await page.waitForTimeout(300);
    await choose("filter-due", { value: "stale14" });
    await page.click('.board-tab[data-tab="ops"]');
    await page.waitForTimeout(400);
    const val = await page.$eval("#filter-due", (e) => e.value);
    if (val !== "all") throw new Error(`expected the stale14 choice to reset, got "${val}"`);
    await page.click('.board-tab[data-tab="hiring"]');
    await page.waitForTimeout(300);
  });

  // ---------- HR client tracker (sql/17) ----------
  await step("Client tracker: tabbed beside Roles Summary, with typed columns", async () => {
    // Tabs only appear when a project has BOTH tables — with one, the card
    // shows it directly rather than a single pointless tab. Turn both on so
    // this exercises the two-table case.
    await rest(`projects?id=eq.${hrId}`, {
      method: "PATCH",
      body: { features: { board_tabs: true, roles_card: true, sla: true, auto_date: true, clients_card: true } },
    });
    await page.goto(`${BASE}/board.html?project=${hrId}`);
    await page.locator(".kanban-col").first().waitFor({ timeout: 8000 });
    if (!(await page.locator("#hr-table-tabs").isVisible()))
      throw new Error("the HR table tabs are missing");
    await page.click('.hr-table-tab[data-table="clients"]');
    await page.waitForTimeout(400);
    if (!(await page.locator("#hr-clients-panel").isVisible())) throw new Error("client panel not shown");
    if (!(await page.locator("#hr-roles-panel").isHidden())) throw new Error("roles panel still visible");
    if (!(await page.locator("#hr-clients-add-row").isVisible())) throw new Error("Add Client missing");
  });

  await step("Client tracker: an elapsed column computes from two dates", async () => {
    await page.click("#hr-clients-add-row");
    await page.waitForTimeout(900);
    const setCell = async (key, val) => {
      await page.click(`#hr-clients-table-wrap td[data-col-key="${key}"]`);
      await page.fill(`#hr-clients-table-wrap td[data-col-key="${key}"] input`, val);
      await page.keyboard.press("Enter");
      await page.waitForTimeout(700);
    };
    // client_name is a `client` column (sql/19) — a registry dropdown, not a
    // text box, so it is picked rather than typed.
    await page.click('#hr-clients-table-wrap td[data-col-key="client_name"]');
    await page.selectOption(
      '#hr-clients-table-wrap td[data-col-key="client_name"] select',
      "E2E Acme Corp"
    );
    await page.waitForTimeout(700);
    await setCell("signed_on", "2026-06-01");
    await setCell("delivered_on", "2026-06-21");
    const dur = (await page.textContent("#hr-clients-table-wrap .dur-cell")).trim();
    if (!/20 days/.test(dur)) throw new Error(`expected "20 days", got "${dur}"`);
    // …and it is stored as data, not as a computed value
    const rows = await rest(`hr_clients?project_id=eq.${hrId}&select=values`);
    if (rows[0].values.days_to_deliver !== undefined)
      throw new Error("a computed column must never be stored");
    // A client column stores the NAME, exactly as a text column did — that is
    // what keeps tracker rows groupable with the cards carrying that client.
    if (rows[0].values.client_name !== "E2E Acme Corp")
      throw new Error(`client_name = ${rows[0].values.client_name}`);
  });

  await step("Client tracker: the Client column offers the registry, not free text", async () => {
    await page.click('#hr-clients-table-wrap td[data-col-key="client_name"]');
    const cell = '#hr-clients-table-wrap td[data-col-key="client_name"]';
    if (await page.locator(`${cell} input`).count())
      throw new Error("the Client cell is still a free-text box");
    const opts = await page.$$eval(`${cell} select option`, (e) => e.map((o) => o.value));
    if (!opts.includes("E2E Acme Corp")) throw new Error(`registry not offered: ${opts.join(", ")}`);
    if (opts[0] !== "") throw new Error("a tracker row must be saveable with no client");
    // Re-pick the same value to close the editor: a no-op commit, which avoids
    // depending on Escape reaching a focused native select.
    await page.selectOption(`${cell} select`, "E2E Acme Corp");
    await page.waitForTimeout(400);
  });

  await step("Client tracker: a date column an elapsed column needs cannot be removed", async () => {
    await page.click('#hr-clients-table-wrap th .col-remove-btn[data-col-key="signed_on"]');
    await page.waitForTimeout(400);
    await expectToast("measured from this column");
    const heads = await page.$$eval("#hr-clients-table-wrap th", (e) =>
      e.map((x) => x.textContent.replace("×", "").trim())
    );
    if (!heads.some((h) => h.startsWith("Signed On"))) throw new Error("the column was removed anyway");
  });

  // ---------- Change log (sql/14) ----------
  await step("Change log: a task's History shows its creation and its moves, with the actor", async () => {
    await page.click('.board-tab[data-tab="hiring"]');
    await page.locator(`.task-card[data-id="${hrTaskId}"]`).click();
    await page.locator("#task-modal.open").waitFor({ timeout: 5000 });
    await page.click("#t-history-toggle");
    await page.locator("#t-history .cl-entry").first().waitFor({ timeout: 8000 });
    const text = await page.textContent("#t-history");
    for (const want of ["Depesh", "created this task", "Applied", "Interview"]) {
      if (!text.includes(want)) throw new Error(`history missing "${want}": ${text.slice(0, 300)}`);
    }
    await page.click("#task-cancel");
  });

  await step("Change log: the project History modal lists entries and filters them", async () => {
    await page.click("#changelog-btn");
    await page.locator("#changelog-modal.open").waitFor({ timeout: 5000 });
    await page.locator("#changelog-list .cl-entry").first().waitFor({ timeout: 8000 });
    if ((await page.locator("#changelog-list .cl-entry").count()) < 3)
      throw new Error("expected several entries");
    if (!(await page.locator(".cl-day").count())) throw new Error("day headings missing");
    await page.check("#cl-status-only");
    await page.waitForTimeout(250);
    // Creations and deletions are logged against field='status' on purpose —
    // they bookend a card's stage timeline — so the filter keeps them.
    const fields = await page.$$eval("#changelog-list .cl-entry", (els) =>
      els.map((e) => e.dataset.field));
    if (!fields.length || !fields.every((f) => f === "status"))
      throw new Error(`status-only filter leaked other fields: ${fields.join(",")}`);
    await page.fill("#cl-search", "zzz-no-such-task");
    await page.waitForTimeout(250);
    if (!/Nothing matches/i.test(await page.textContent("#changelog-list")))
      throw new Error("search filter did not narrow");
    await page.click("#changelog-close");
  });

  await step("Change log: deleting a task keeps its history, attributed to the deleter", async () => {
    // Don't inherit an open modal from a previous step's failure
    await page.keyboard.press("Escape");
    await page.locator("#changelog-modal").waitFor({ state: "hidden", timeout: 5000 });
    await page.locator(`.task-card[data-id="${hrTaskId}"]`).click();
    await page.locator("#task-modal.open").waitFor({ timeout: 5000 });
    await page.click("#task-delete");
    await page.click("#task-delete");
    await expectToast("Task deleted");
    const del = await rest(`task_changelog?project_id=eq.${hrId}&action=eq.deleted&select=*`);
    if (del.length !== 1) throw new Error(`expected 1 delete entry, got ${del.length}`);
    if (del[0].actor_name !== "Depesh") throw new Error(`delete actor = ${del[0].actor_name}`);
    if (del[0].task_title !== "E2E Candidate") throw new Error("deleted task title not kept");
    if (del[0].task_id !== null) throw new Error("task_id should be nulled once the task is gone");
    const kept = await rest(`task_changelog?project_id=eq.${hrId}&select=id`);
    if (kept.length < 3) throw new Error("earlier history was wiped with the task");
  });

  await step("Change log: the browser cannot rewrite history (append-only grants)", async () => {
    const codes = await page.evaluate(async () => {
      const out = {};
      const attempt = async (method, path, body) => {
        try {
          await sbFetch(path, { method, body });
          return "ALLOWED";
        } catch (e) {
          return e.message;
        }
      };
      out.PATCH = await attempt("PATCH", "task_changelog?field=eq.status", { new_value: "tampered" });
      out.DELETE = await attempt("DELETE", "task_changelog?field=eq.status");
      out.POST = await attempt("POST", "task_changelog", { action: "forged", task_title: "E2E forged" });
      return out;
    });
    for (const [method, msg] of Object.entries(codes)) {
      if (msg === "ALLOWED") throw new Error(`${method} on task_changelog was allowed`);
      if (!/permission denied/i.test(msg)) throw new Error(`${method} failed oddly: ${msg}`);
    }
  });

  await step("Cleanup: delete the HR project (cascades tasks and its change log)", async () => {
    await rest(`projects?id=eq.${hrId}`, { method: "DELETE" });
    if ((await rest(`task_changelog?project_id=eq.${hrId}&select=id`)).length)
      throw new Error("change log did not cascade with the project");
  });

  // ---------- Daily Slack reports (sql/15) ----------
  let chanId, cfgId;
  await step("Slack registry: a channel is added once in Settings", async () => {
    await page.goto(`${BASE}/settings.html`);
    await page
      .locator("#add-slack-form button[type=submit]:not([disabled])")
      .waitFor({ timeout: 15000 });
    await page.fill("#sc-label", "E2E Channel");
    await page.fill("#sc-url", "https://postman-echo.com/post");
    await page.click("#add-slack-form button[type=submit]");
    const rows = await waitForRows("slack_channels?label=eq.E2E%20Channel&select=*");
    if (rows.length !== 1) throw new Error(`expected 1 channel, got ${rows.length}`);
    chanId = rows[0].id;
  });

  await step("Slack registry: a non-https URL is refused", async () => {
    await page.fill("#sc-label", "E2E Bad");
    await page.fill("#sc-url", "ftp://nope");
    await page.click("#add-slack-form button[type=submit]");
    await page.waitForTimeout(400);
    if (!(await page.locator(".field-error").count())) throw new Error("no inline error");
    if ((await rest("slack_channels?label=eq.E2E%20Bad&select=id")).length)
      throw new Error("an invalid URL was stored");
    await page.fill("#sc-label", "");
    await page.fill("#sc-url", "");
  });

  await step("Daily report: created from the board, channel picked from the registry", async () => {
    await page.goto(`${BASE}/board.html?project=${projectId}`);
    await page.locator(".kanban-col").first().waitFor({ timeout: 8000 });
    await page.click("#reports-btn");
    await page.locator("#reports-modal.open").waitFor({ timeout: 5000 });
    const opts = await page.$$eval("#rp-channel option", (e) => e.map((x) => x.textContent));
    if (!opts.some((o) => o.includes("E2E Channel")))
      throw new Error(`registry not offered: ${opts.join(", ")}`);
    await page.fill("#rp-label", "E2E Report");
    await page.fill("#rp-time", "07:30");
    await page.click("#report-save");
    await expectToast("Report added");
    const rows = await rest(`daily_report_configs?project_id=eq.${projectId}&select=*`);
    if (rows.length !== 1) throw new Error(`expected 1 config, got ${rows.length}`);
    cfgId = rows[0].id;
    if (!rows[0].channel_id) throw new Error("channel not linked");
  });

  await step("Daily report: a report with nothing in it is refused", async () => {
    await page.click("[data-rp-edit]");
    await page.waitForTimeout(300);
    for (const id of ["#rp-added", "#rp-moved", "#rp-snapshot"]) {
      if (await page.isChecked(id)) await page.click(id);
    }
    await page.click("#report-save");
    await expectToast("at least one thing to include");
    await page.click("#report-form-reset");
  });

  await step("Daily report: Send test posts, records a 'test' run, keeps the real send pending", async () => {
    // Created after its send time, so the trigger rightly claimed today —
    // clear it so this asserts what it says: a TEST never advances last_sent_on.
    await rest(`daily_report_configs?id=eq.${cfgId}`, {
      method: "PATCH",
      body: { last_sent_on: null },
    });
    await page.click("[data-rp-test]");
    await expectToast("Test sent");
    await page.waitForTimeout(1500);
    const runs = await rest(`daily_report_runs?config_id=eq.${cfgId}&select=status`);
    if (runs.length !== 1 || runs[0].status !== "test")
      throw new Error(`runs = ${JSON.stringify(runs)}`);
    const cfg = (await rest(`daily_report_configs?id=eq.${cfgId}&select=last_sent_on`))[0];
    if (cfg.last_sent_on !== null)
      throw new Error(`a test must not advance last_sent_on (got ${cfg.last_sent_on})`);
  });

  await step("Daily report: the same day cannot be sent twice", async () => {
    const today = (await rest("rpc/daily_report_preview", {
      method: "POST",
      body: { p_config_id: cfgId },
    })) ? isoDaysFromNow(0) : isoDaysFromNow(0);
    const send = () =>
      rest("rpc/send_daily_report", {
        method: "POST",
        body: { p_config_id: cfgId, p_local_date: today, p_test: false },
      });
    await send();
    let refused = false;
    try {
      await send();
    } catch (e) {
      refused = /duplicate key|already exists/i.test(e.message);
    }
    if (!refused) throw new Error("a second send for the same day was allowed");
    const sent = await rest(`daily_report_runs?config_id=eq.${cfgId}&status=eq.sent&select=id`);
    if (sent.length !== 1) throw new Error(`expected exactly 1 sent run, got ${sent.length}`);
  });

  await step("Daily report: the message is editable, and an untouched default stays NULL", async () => {
    await page.click(`[data-rp-edit="${cfgId}"]`);
    await page.waitForTimeout(400);
    const tpl = await page.inputValue("#rp-template");
    if (!tpl.includes("{project}") || !tpl.includes("{added}"))
      throw new Error(`editor not prefilled with the default: ${tpl.slice(0, 60)}`);
    // Saving an untouched default must store NULL, so the report keeps
    // following the default if it ever changes.
    await page.click("#report-save");
    await page.waitForTimeout(800);
    let row = (await rest(`daily_report_configs?id=eq.${cfgId}&select=template`))[0];
    if (row.template !== null) throw new Error(`expected NULL, got ${JSON.stringify(row.template)}`);
    // Now customise it
    await page.click(`[data-rp-edit="${cfgId}"]`);
    await page.waitForTimeout(300);
    await page.fill("#rp-template", "CUSTOM {project} — {summary}");
    await page.click("#report-save");
    await page.waitForTimeout(800);
    row = (await rest(`daily_report_configs?id=eq.${cfgId}&select=template`))[0];
    if (!String(row.template).startsWith("CUSTOM")) throw new Error(`template not saved: ${row.template}`);
  });

  await step("Daily report: preview renders the custom message, unsaved edits included", async () => {
    await page.click(`[data-rp-edit="${cfgId}"]`);
    await page.waitForTimeout(300);
    await page.click("#report-preview-btn");
    await page.locator("#report-preview").waitFor({ state: "visible", timeout: 8000 });
    await page.waitForTimeout(2500);
    let text = await page.textContent("#report-preview");
    if (!text.startsWith("CUSTOM")) throw new Error(`saved template not used: ${text.slice(0, 60)}`);
    // An edit that has NOT been saved must still preview
    await page.fill("#rp-template", "UNSAVED {project}");
    await page.click("#report-preview-btn");
    await page.waitForTimeout(2500);
    text = await page.textContent("#report-preview");
    if (!text.startsWith("UNSAVED")) throw new Error(`unsaved edit not previewed: ${text.slice(0, 60)}`);
    const row = (await rest(`daily_report_configs?id=eq.${cfgId}&select=template`))[0];
    if (!String(row.template).startsWith("CUSTOM"))
      throw new Error("previewing must not save the edit");
    await page.click("#rp-template-reset");
    await page.click("#report-save");
    await page.waitForTimeout(700);
  });

  await step("Daily report: picking people filters the numbers and shows their zeroes", async () => {
    // depeshId created the e2e tasks; pick somebody who did NOT.
    const other = (await rest("team_members?user_role=eq.member&active=eq.true&select=id,name&limit=1"))[0];
    await rest(`daily_report_configs?id=eq.${cfgId}`, {
      method: "PATCH",
      body: { member_ids: [other.id] },
    });
    const preview = await rest("rpc/daily_report_preview", {
      method: "POST",
      body: { p_config_id: cfgId, p_template: null },
    });
    const text = (Array.isArray(preview) ? preview[0] : preview).text;
    if (!text.includes(`${other.name}`))
      throw new Error(`a selected person with no activity must still be listed: ${text}`);
    if (!/— 0/.test(text)) throw new Error(`expected a zero line for them: ${text}`);
    await rest(`daily_report_configs?id=eq.${cfgId}`, { method: "PATCH", body: { member_ids: [] } });
  });

  // ---------- report types, filters and card detail (sql/18) ----------
  await step("Report type: switching to Movement swaps in that type's default message", async () => {
    await page.goto(`${BASE}/board.html?project=${projectId}`);
    await page.locator(".kanban-col").first().waitFor({ timeout: 8000 });
    await page.click("#reports-btn");
    await page.locator("#reports-modal.open").waitFor({ timeout: 5000 });
    await page.click("[data-rp-edit]");
    await page.waitForTimeout(300);
    // The status pickers stay out of the way until a type actually uses them
    if (!(await page.locator("#rp-filter-block").isHidden()))
      throw new Error("an activity report should not show status filters");
    await choose("rp-type", { value: "movement" });
    await page.waitForTimeout(200);
    if (await page.locator("#rp-filter-block").isHidden())
      throw new Error("movement report has no status filters");
    const tpl = await page.inputValue("#rp-template");
    if (!tpl.includes("{cards}")) throw new Error(`movement default missing {cards}: ${tpl}`);
  });

  await step("Report type: an edited message survives a type change", async () => {
    await page.fill("#rp-template", "MINE {cards}");
    await choose("rp-type", { value: "snapshot" });
    await page.waitForTimeout(200);
    if (!(await page.inputValue("#rp-template")).startsWith("MINE"))
      throw new Error("a typed message was overwritten by the type dropdown");
    await choose("rp-type", { value: "movement" });
    await page.waitForTimeout(200);
  });

  await step("Report type: a status report with no status picked is refused", async () => {
    await choose("rp-type", { value: "snapshot" });
    await page.waitForTimeout(200);
    await page.click("#report-save");
    await expectToast("at least one status");
    await choose("rp-type", { value: "movement" });
    await page.waitForTimeout(200);
  });

  await step("Report type: movement filters, detail fields and cap are saved", async () => {
    await page.locator('#rp-statuses input[data-status="Doing"]').check();
    await page.locator('#rp-details input[data-detail="client"]').check();
    await page.locator('#rp-details input[data-detail="actor"]').check();
    await page.fill("#rp-max", "5");
    await page.click("#report-save");
    await expectToast("Report updated");
    await page.waitForTimeout(400);
    const row = (await rest(`daily_report_configs?id=eq.${cfgId}&select=*`))[0];
    if (row.report_type !== "movement") throw new Error(`report_type = ${row.report_type}`);
    if (!row.filter_statuses.includes("Doing"))
      throw new Error(`filter_statuses = ${JSON.stringify(row.filter_statuses)}`);
    if (!row.detail_fields.includes("client")) throw new Error("detail_fields not saved");
    if (row.max_cards !== 5) throw new Error(`max_cards = ${row.max_cards}`);
    if (row.template !== "MINE {cards}") throw new Error(`template = ${row.template}`);
  });

  await step("Report type: a movement report lists the cards that moved, not just counts", async () => {
    const r = await rest("rpc/daily_report_preview", {
      method: "POST",
      body: { p_config_id: cfgId },
    });
    const text = (Array.isArray(r) ? r[0] : r).text;
    // "Overdue e2e task" was dragged Backlog -> Doing earlier in this run.
    if (!text.includes("Overdue e2e task")) throw new Error(`card not listed: ${text}`);
    if (!text.includes("Doing")) throw new Error(`the move itself is missing: ${text}`);
  });

  await step("Report type: a status filter that matched nothing says so", async () => {
    const r = await rest("rpc/daily_report_preview", {
      method: "POST",
      body: { p_config_id: cfgId, p_statuses: ["Review"] },
    });
    const text = (Array.isArray(r) ? r[0] : r).text;
    if (text.includes("Overdue e2e task"))
      throw new Error(`an unsaved status filter was ignored by preview: ${text}`);
    if (!/No cards moved/i.test(text)) throw new Error(`no empty-state line: ${text}`);
  });

  await step("Report type: a status report carries the client name onto each card", async () => {
    // Wherever the client-tagged card ended up, a status report on that column
    // has to name the client — that is the "send a report with the details"
    // ask, and the reason the Client field became a registry dropdown.
    const tagged = (
      await rest(`tasks?project_id=eq.${projectId}&fields->>client=eq.E2E%20Acme%20Corp&select=status`)
    )[0];
    if (!tagged) throw new Error("the client-tagged task is gone");
    const r = await rest("rpc/daily_report_preview", {
      method: "POST",
      body: {
        p_config_id: cfgId,
        p_template: "{card_total} in {status_list}\n{cards}",
        p_report_type: "snapshot",
        p_statuses: [tagged.status],
        p_detail_fields: ["client"],
      },
    });
    const text = (Array.isArray(r) ? r[0] : r).text;
    if (!text.includes("E2E Acme Corp")) throw new Error(`client detail missing: ${text}`);
    if (!text.includes(tagged.status)) throw new Error(`{status_list} not substituted: ${text}`);
  });

  await step("Slack registry: a channel in use cannot be deleted", async () => {
    let refused = false;
    try {
      await rest(`slack_channels?id=eq.${chanId}`, { method: "DELETE" });
    } catch (e) {
      refused = /foreign key|violates/i.test(e.message);
    }
    if (!refused) throw new Error("a channel with a live report was deleted");
  });

  await step("Cleanup: reports, runs, the channel and the client", async () => {
    await rest(`daily_report_runs?config_id=eq.${cfgId}`, { method: "DELETE" }).catch(() => {});
    await rest(`daily_report_configs?id=eq.${cfgId}`, { method: "DELETE" });
    await rest(`slack_channels?id=eq.${chanId}`, { method: "DELETE" });
    if ((await rest("slack_channels?label=eq.E2E%20Channel&select=id")).length)
      throw new Error("channel not removed");
    await rest("clients?name=like.E2E*", { method: "DELETE" }).catch(() => {});
    if ((await rest("clients?name=like.E2E*&select=id").catch(() => [])).length)
      throw new Error("client not removed");
  });

  // ---------- cleanup ----------
  await step("Cleanup: delete e2e project (cascades tasks)", async () => {
    await rest(`projects?id=eq.${projectId}`, { method: "DELETE" });
    const left = await rest(`tasks?project_id=eq.${projectId}&select=id`);
    if (left.length) throw new Error("tasks not cascaded");
  });

  await step("index.html redirects to vyom.html (old links keep working)", async () => {
    await page.goto(`${BASE}/index.html`);
    await page.waitForURL(/vyom\.html/, { timeout: 5000 });
    await page.locator("#new-project-btn").waitFor({ timeout: 8000 });
  });

  // ---------- AC-12: fresh loads, zero console errors ----------
  consoleErrors.length = 0;
  await step("AC-12: no console errors on any page load", async () => {
    for (const p of ["index.html", "team.html", "settings.html", `board.html?project=${projectId}`]) {
      // board with deleted project should still not throw console errors
      await page.goto(`${BASE}/${p}`);
      await page.waitForLoadState("networkidle");
    }
    if (consoleErrors.length) throw new Error(consoleErrors.join(" | "));
  });

  await browser.close();

  const fails = results.filter((r) => r[0] === "FAIL");
  console.log(`\n==== ${results.length - fails.length}/${results.length} passed ====`);
  if (consoleErrors.length) console.log("console errors seen during run:", consoleErrors.slice(0, 10));
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error("FATAL:", e);
  process.exit(2);
});
