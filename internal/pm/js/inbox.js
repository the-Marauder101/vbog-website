// Inbox: bell in the top nav + slide-in panel with tabs (Notifications / My Tasks).
// New notification kinds only need an entry in KIND_META to render.

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
        <button class="inbox-item ${n.read ? "" : "unread"}" data-id="${n.id}"
                data-link="${n.task_id ? `board.html?project=${n.project_id}&task=${n.task_id}` : n.project_id ? `board.html?project=${n.project_id}` : ""}">
          <span class="inbox-icon inbox-icon-${UI.esc(n.kind)}">${meta.icon}</span>
          <span class="inbox-body">
            <span class="inbox-text"><strong>${UI.esc(n.actor?.name || "Someone")}</strong> ${meta.label}${n.projects?.name ? ` in <strong>${UI.esc(n.projects.name)}</strong>` : ""}</span>
            ${n.message ? `<span class="inbox-msg">${UI.esc(n.message)}</span>` : ""}
            <span class="inbox-time">${relTime(n.created_at)}</span>
          </span>
        </button>`;
      })
      .join("");
    host.querySelectorAll(".inbox-item").forEach((el) => {
      el.addEventListener("click", async () => {
        const n = notifications.find((x) => x.id === el.dataset.id);
        if (n && !n.read) {
          n.read = true;
          try { await API.markRead(n.id); } catch (_) {}
          refreshBadge();
        }
        if (el.dataset.link) window.location.href = el.dataset.link;
      });
    });
  }

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
    host.innerHTML = groups
      .filter(([, list]) => list.length)
      .map(
        ([label, list]) => `
        <div class="inbox-group">
          <div class="inbox-group-label ${label === "Overdue" ? "overdue" : ""}">${label} · ${list.length}</div>
          ${list
            .map(
              (t) => `
            <a class="inbox-task" href="board.html?project=${t.project_id}&task=${t.id}">
              <span class="inbox-task-dot" style="background:${UI.esc(t.projects?.color || "#C3CAD5")}"></span>
              <span class="inbox-task-title">${UI.esc(t.title)}</span>
              <span class="inbox-task-meta">${UI.esc(t.projects?.name || "")}${t.due_date ? ` · ${UI.fmtDate(t.due_date)}` : ""}</span>
            </a>`
            )
            .join("")}
        </div>`
      )
      .join("");
  }

  async function open() {
    panel.classList.add("open");
    document.getElementById("inbox-overlay").classList.add("open");
    const me = Auth.user();
    try {
      [notifications, myTasks] = await Promise.all([
        API.getNotifications(me.id),
        // My open tasks = assigned to me and not in the project's final (done) column
        API.getAllTasks().then((ts) =>
          ts.filter((t) => {
            if (t.assignee_id !== me.id) return false;
            const statuses = t.projects?.statuses || [];
            return t.status !== statuses[statuses.length - 1];
          })
        ),
      ]);
    } catch (e) {
      UI.toast(e.message);
      return;
    }
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
      try {
        await API.markAllRead(me.id);
        notifications.forEach((n) => (n.read = true));
        renderNotifications();
        refreshBadge();
      } catch (e) {
        UI.toast(e.message);
      }
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") close();
    });

    refreshBadge();
  }

  return { init, refreshBadge };
})();
