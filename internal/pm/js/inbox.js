// js/inbox.js — bell + slide-in inbox panel (full docs: ../ARCHITECTURE.md §6)
//
// Tabs: Notifications (rows from the notifications table, per-row read/unread
// toggle, mark-all-read) and My Tasks (API.getMyTasks — server-side filtered,
// grouped by due date, capped at GROUP_CAP behind "Show all" expanders).
// TO ADD A NOTIFICATION KIND: one entry in KIND_META + insert rows via
// API.notify() from wherever the action happens. Unknown kinds render with a
// fallback icon, so old clients never crash.
// HARD-WON RULES (see handbook §5.6): update rows in place (applyReadState),
// never mutate the DOM after an await the user could have outrun, and open()
// is epoch-guarded so stale fetches can't clobber fresh toggles.

const Inbox = (() => {
  const KIND_META = {
    mention: { icon: "@", label: "mentioned you" },
    task_assigned: { icon: "&#10148;", label: "assigned you a task" },
  };

  let panel, badge, notifications = [], myTasks = [];

  function relTime(iso) {
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
    return UI.fmtDate(iso.slice(0, 10));
  }

  async function refreshBadge() {
    const me = Auth.user();
    if (!me) return;
    try {
      const n = await API.getUnreadCount(me.id);
      badge.textContent = n > 9 ? "9+" : n;
      badge.hidden = n === 0;
    } catch (_) { /* badge is best-effort */ }
  }

  function taskLink(t) {
    return `board.html?project=${t.project_id}${t.task_id ? `&task=${t.task_id}` : ""}`;
  }

  function renderNotifications() {
    const host = panel.querySelector("#inbox-notifs");
    if (!notifications.length) {
      host.innerHTML = `<div class="inbox-empty">Nothing here yet.<br>Mentions and task assignments will land in this inbox.</div>`;
      return;
    }
    host.innerHTML = notifications
      .map((n) => {
        const meta = KIND_META[n.kind] || { icon: "&#8226;", label: n.kind };
        return `
        <div class="inbox-item ${n.read ? "" : "unread"}" data-id="${n.id}" role="button" tabindex="0"
             data-link="${n.task_id ? `board.html?project=${n.project_id}&task=${n.task_id}` : n.project_id ? `board.html?project=${n.project_id}` : ""}">
          <span class="inbox-icon inbox-icon-${UI.esc(n.kind)}">${meta.icon}</span>
          <span class="inbox-body">
            <span class="inbox-text"><strong>${UI.esc(n.actor?.name || "Someone")}</strong> ${meta.label}${n.projects?.name ? ` in <strong>${UI.esc(n.projects.name)}</strong>` : ""}</span>
            ${n.message ? `<span class="inbox-msg">${UI.esc(n.message)}</span>` : ""}
            <span class="inbox-time">${relTime(n.created_at)}</span>
          </span>
          <button class="inbox-toggle" title="${n.read ? "Mark as unread" : "Mark as read"}"
                  aria-label="${n.read ? "Mark as unread" : "Mark as read"}"><span class="dot"></span></button>
        </div>`;
      })
      .join("");
    host.querySelectorAll(".inbox-item").forEach((el) => {
      const n = notifications.find((x) => x.id === el.dataset.id);
      // read/unread toggle — lets people keep items "to come back to".
      // Update the row in place: replacing the whole list mid-click would
      // destroy the button being clicked (and lose scroll position).
      el.querySelector(".inbox-toggle").addEventListener("click", async (e) => {
        e.stopPropagation();
        n.read = !n.read;
        applyReadState(el, n.read);
        try {
          await API.setRead(n.id, n.read);
        } catch (_) {
          n.read = !n.read;
          applyReadState(el, n.read);
        }
        refreshBadge();
      });
      el.addEventListener("click", async (e) => {
        // A click that started on the toggle can surface here as a
        // common-ancestor click (mousedown on button, mouseup on row, target
        // = the row) — never treat that as "open the task"
        if (e.target.closest(".inbox-toggle")) return;
        const tb = el.querySelector(".inbox-toggle")?.getBoundingClientRect();
        if (tb && e.clientX >= tb.left && e.clientX <= tb.right && e.clientY >= tb.top && e.clientY <= tb.bottom) return;
        if (n && !n.read) {
          n.read = true;
          applyReadState(el, true);
          try { await API.setRead(n.id, true); } catch (_) {}
          refreshBadge();
        }
        if (el.dataset.link) window.location.href = el.dataset.link;
      });
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); el.click(); }
      });
    });
  }

  function applyReadState(el, read) {
    el.classList.toggle("unread", !read);
    const btn = el.querySelector(".inbox-toggle");
    btn.title = read ? "Mark as unread" : "Mark as read";
    btn.setAttribute("aria-label", btn.title);
  }

  // Groups show up to GROUP_CAP tasks; the rest sit behind a "Show all" expander
  // so a heavy workload never turns the panel into an endless scroll.
  const GROUP_CAP = 8;
  const expandedGroups = new Set();

  function renderMyTasks() {
    const host = panel.querySelector("#inbox-tasks");
    const open = myTasks;
    if (!open.length) {
      host.innerHTML = `<div class="inbox-empty">No tasks assigned to you. Enjoy the calm.</div>`;
      return;
    }
    const today = UI.todayIso();
    const groups = [
      ["Overdue", open.filter((t) => t.due_date && t.due_date < today)],
      ["Today", open.filter((t) => t.due_date === today)],
      ["Upcoming", open.filter((t) => t.due_date && t.due_date > today)],
      ["No due date", open.filter((t) => !t.due_date)],
    ];
    const taskRow = (t) => `
      <a class="inbox-task" href="board.html?project=${t.project_id}&task=${t.id}">
        <span class="inbox-task-dot" style="background:${UI.esc(t.projects?.color || "#C3CAD5")}"></span>
        <span class="inbox-task-title">${UI.esc(t.title)}</span>
        <span class="inbox-task-meta">${UI.esc(t.projects?.name || "")}${t.due_date ? ` · ${UI.fmtDate(t.due_date)}` : ""}</span>
      </a>`;
    host.innerHTML = groups
      .filter(([, list]) => list.length)
      .map(([label, list]) => {
        const expanded = expandedGroups.has(label);
        const shown = expanded ? list : list.slice(0, GROUP_CAP);
        const hidden = list.length - shown.length;
        return `
        <div class="inbox-group">
          <div class="inbox-group-label ${label === "Overdue" ? "overdue" : ""}">${label} · ${list.length}</div>
          ${shown.map(taskRow).join("")}
          ${hidden > 0 ? `<button class="inbox-more" data-group="${UI.esc(label)}">Show all ${list.length} &darr;</button>` : ""}
          ${expanded && list.length > GROUP_CAP ? `<button class="inbox-more" data-collapse="${UI.esc(label)}">Show less &uarr;</button>` : ""}
        </div>`;
      })
      .join("");
    host.querySelectorAll(".inbox-more").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.dataset.group) expandedGroups.add(btn.dataset.group);
        else expandedGroups.delete(btn.dataset.collapse);
        // re-render after the click finishes dispatching — replacing the list
        // now would destroy the button mid-click
        setTimeout(renderMyTasks, 0);
      });
    });
  }

  let openEpoch = 0;

  async function open() {
    const epoch = ++openEpoch;
    panel.classList.add("open");
    document.getElementById("inbox-overlay").classList.add("open");
    // Replace stale rows with a loading state while the refresh is in flight —
    // otherwise a quick toggle on an old row gets clobbered by the re-render.
    panel.querySelector("#inbox-notifs").innerHTML = '<div class="loading">Loading…</div>';
    panel.querySelector("#inbox-tasks").innerHTML = '<div class="loading">Loading…</div>';
    const me = Auth.user();
    let fresh;
    try {
      fresh = await Promise.all([
        API.getNotifications(me.id),
        // My open tasks = assigned to me and not in the project's final (done)
        // column — the parent's final column for inheriting sub-clients
        // (parent embed comes from API.getMyTasks).
        API.getMyTasks(me.id).then((ts) =>
          ts.filter((t) => {
            const statuses = UI.effectiveStatuses(t.projects, t.projects?.parent);
            return t.status !== statuses[statuses.length - 1];
          })
        ),
      ]);
    } catch (e) {
      UI.toast(e.message);
      return;
    }
    // A newer open() superseded this fetch — rendering now would overwrite
    // any read/unread change the user made since the newer render
    if (epoch !== openEpoch) return;
    [notifications, myTasks] = fresh;
    renderNotifications();
    renderMyTasks();
    refreshBadge();
  }

  function close() {
    panel.classList.remove("open");
    document.getElementById("inbox-overlay").classList.remove("open");
  }

  function init() {
    const me = Auth.user();
    if (!me) return;
    const right = document.querySelector(".nav-right");
    if (!right) return;

    const bellWrap = document.createElement("button");
    bellWrap.className = "inbox-bell";
    bellWrap.title = "Inbox";
    bellWrap.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
      <span class="inbox-badge" hidden></span>`;
    right.insertBefore(bellWrap, right.firstChild);
    badge = bellWrap.querySelector(".inbox-badge");

    const overlay = document.createElement("div");
    overlay.id = "inbox-overlay";
    overlay.addEventListener("click", close);
    document.body.appendChild(overlay);

    panel = document.createElement("aside");
    panel.className = "inbox-panel";
    panel.innerHTML = `
      <div class="inbox-head">
        <h2>Inbox</h2>
        <div class="inbox-head-actions">
          <button class="btn-link" id="inbox-mark-all">Mark all read</button>
          <button class="inbox-close" aria-label="Close inbox">&times;</button>
        </div>
      </div>
      <div class="inbox-tabs">
        <button class="inbox-tab active" data-tab="notifs">Notifications</button>
        <button class="inbox-tab" data-tab="tasks">My Tasks</button>
      </div>
      <div class="inbox-pane" id="inbox-notifs"><div class="loading">Loading…</div></div>
      <div class="inbox-pane" id="inbox-tasks" hidden><div class="loading">Loading…</div></div>`;
    document.body.appendChild(panel);

    bellWrap.addEventListener("click", open);
    panel.querySelector(".inbox-close").addEventListener("click", close);
    panel.querySelectorAll(".inbox-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        panel.querySelectorAll(".inbox-tab").forEach((t) => t.classList.toggle("active", t === tab));
        panel.querySelector("#inbox-notifs").hidden = tab.dataset.tab !== "notifs";
        panel.querySelector("#inbox-tasks").hidden = tab.dataset.tab !== "tasks";
      });
    });
    panel.querySelector("#inbox-mark-all").addEventListener("click", async () => {
      // Optimistic: update rows at click time. Mutating the DOM after the
      // await would clobber anything the user toggled while the PATCH flew.
      notifications.forEach((n) => (n.read = true));
      panel.querySelectorAll("#inbox-notifs .inbox-item").forEach((el) => applyReadState(el, true));
      try {
        await API.markAllRead(me.id);
      } catch (e) {
        UI.toast(e.message);
      }
      refreshBadge();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") close();
    });

    refreshBadge();
  }

  return { init, refreshBadge };
})();
