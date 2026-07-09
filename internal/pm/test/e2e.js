// e2e.js — Vyom's end-to-end test suite (how-to: test/README.md; docs: ../ARCHITECTURE.md §9)
//
// Drives the real UI with Playwright against the LIVE Supabase backend.
// 48 checks: login gate, projects/boards/tasks, filters, inbox + toggles,
// @mentions, roles/external scoping, tags, webhooks, cleanup.
// All test data is namespaced ("E2E ...") — pre-cleaned at start, deleted at
// the end; count assertions are scoped to the test project so live data is
// never touched or asserted against.
const { chromium } = require("playwright");

const BASE = process.env.VYOM_BASE || "http://127.0.0.1:8787/internal/pm";
const SCRATCH = process.env.VYOM_SHOTS || __dirname; // failure screenshots land here
const PROJECT_NAME = "E2E Test Project";

const results = [];
let page, context, browser;
const consoleErrors = [];

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

// Drive the custom styled dropdowns (native selects are hidden)
async function choose(selectId, opt) {
  const wrap = page.locator(`.dd:has(#${selectId})`);
  await wrap.locator(".dd-btn").click();
  const item = opt.label !== undefined
    ? wrap.locator(".dd-item", { hasText: opt.label }).first()
    : wrap.locator(`.dd-item[data-value="${opt.value}"]`);
  await item.click();
}

async function expectToast(substr) {
  const t = page.locator(".toast", { hasText: substr }).first();
  await t.waitFor({ state: "visible", timeout: 5000 });
}

(async () => {
  browser = await chromium.launch();
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
  const leftovers = await rest(`projects?name=in.("${PROJECT_NAME}","E2E Scope Other")&select=id`);
  for (const p of leftovers) await rest(`projects?id=eq.${p.id}`, { method: "DELETE" });
  const leftoverMembers = await rest(`team_members?name=in.("E2E Temp","E2E External")&select=id`);
  for (const m of leftoverMembers) await rest(`team_members?id=eq.${m.id}`, { method: "DELETE" });
  const leftoverHooks = await rest(`webhooks?label=eq.e2e%20hook&select=id`);
  for (const w of leftoverHooks) await rest(`webhooks?id=eq.${w.id}`, { method: "DELETE" });
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

  // ---------- F-02: status removal warning + removed column ----------
  await step("Removing an in-use status warns, then tasks land in a (removed) column", async () => {
    await page.goto(`${BASE}/vyom.html`);
    const card = page.locator(".project-card", { hasText: PROJECT_NAME });
    await card.waitFor();
    await card.locator(".edit-btn").click();
    // remove "Review" (holds the zapier task)
    await page.locator(".tag-editor .tag", { hasText: "Review" }).locator("button").click();
    await page.click("#project-save");
    await page.locator("#status-warning", { hasText: "Click Save again" }).waitFor({ timeout: 5000 });
    await page.click("#project-save");
    await expectToast("Project updated");
    await page.goto(`${BASE}/board.html?project=${projectId}`);
    const removedCol = page.locator(".kanban-col.removed-status");
    await removedCol.waitFor({ timeout: 8000 });
    if (!(await removedCol.locator(".task-card", { hasText: "Task from Google Sheets" }).count()))
      throw new Error("task not in removed column");
    // dragging out of the removed column into a real one works
    await dragCardToColumn(zapTaskId, "Done");
    await page
      .locator('.kanban-col[data-status="Done"] .task-card', { hasText: "Task from Google Sheets" })
      .waitFor({ timeout: 5000 });
  });

  // ---------- dashboard counts + archive ----------
  await step("Dashboard card shows task count and overdue count", async () => {
    await page.goto(`${BASE}/vyom.html`);
    const card = page.locator(".project-card", { hasText: PROJECT_NAME });
    await card.waitFor();
    const meta = await card.locator(".meta").innerText();
    if (!meta.includes("3 tasks")) throw new Error(`meta = ${meta}`);
    if (!meta.includes("1 overdue")) throw new Error(`meta = ${meta}`);
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
