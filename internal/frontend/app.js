const API = window.location.origin + "/api";

async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "Request failed");
  }
  return res.json();
}

function toast(msg, type = "info") {
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

function timeAgo(iso) {
  if (!iso) return "—";
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return Math.floor(diff / 60) + "m ago";
  if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
  return Math.floor(diff / 86400) + "d ago";
}

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s || "";
  return d.innerHTML;
}

function togglePanel(id) {
  const panel = document.getElementById(id);
  panel.classList.toggle("hidden");
}

// --- Stats ---

async function loadStats() {
  try {
    const stats = await api("/stats");
    const bar = document.getElementById("stats-bar");
    const items = [
      { key: "total", label: "Total", value: stats.total },
      { key: "new", label: "New", value: stats.by_status.new || 0 },
      { key: "reviewing", label: "Reviewing", value: stats.by_status.reviewing || 0 },
      { key: "commented", label: "Commented", value: stats.by_status.commented || 0 },
      { key: "dismissed", label: "Dismissed", value: stats.by_status.dismissed || 0 },
    ];
    bar.innerHTML = items
      .map(
        (s) =>
          `<div class="stat-card ${s.key}"><span class="label">${s.label}</span><span class="value">${s.value}</span></div>`
      )
      .join("");

    const subSelect = document.getElementById("filter-subreddit");
    const current = subSelect.value;
    subSelect.innerHTML = '<option value="">All</option>';
    Object.entries(stats.by_subreddit || {}).forEach(([sub, count]) => {
      const opt = document.createElement("option");
      opt.value = sub;
      opt.textContent = `r/${sub} (${count})`;
      subSelect.appendChild(opt);
    });
    subSelect.value = current;

    // Show onboarding if no posts
    document.getElementById("onboarding").classList.toggle("hidden", stats.total > 0);
  } catch (e) {
    console.error("Stats load failed:", e);
  }
}

// --- Posts ---

async function loadPosts() {
  try {
    const status = document.getElementById("filter-status").value;
    const subreddit = document.getElementById("filter-subreddit").value;
    let qs = "?limit=100";
    if (status) qs += `&status=${status}`;
    if (subreddit) qs += `&subreddit=${subreddit}`;

    const data = await api("/posts" + qs);
    const tbody = document.getElementById("posts-body");
    document.getElementById("post-count").textContent = `${data.count} posts`;

    if (!data.posts.length) {
      tbody.innerHTML =
        '<tr><td colspan="9" class="empty-state">No posts found. Click "Scan Now" to search Reddit, or adjust your filters.</td></tr>';
      return;
    }

    tbody.innerHTML = data.posts
      .map(
        (p) => `
      <tr>
        <td><span class="status-badge status-${p.status}">${p.status}</span></td>
        <td style="white-space:nowrap">r/${esc(p.subreddit)}</td>
        <td class="title-cell"><a href="${esc(p.url)}" target="_blank" title="${esc(p.title)}">${esc(p.title)}</a></td>
        <td>${p.score}</td>
        <td>${(p.matched_keywords || []).map((k) => `<span class="kw-tag">${esc(k)}</span>`).join("")}</td>
        <td>${(p.matched_intents || []).map((i) => `<span class="intent-tag">${esc(i)}</span>`).join("")}</td>
        <td class="relevance">${p.relevance_score.toFixed(1)}</td>
        <td style="white-space:nowrap">${timeAgo(p.flagged_at)}</td>
        <td>
          <div class="btn-group">
            <button class="btn-sm" onclick="openDetail(${p.id})">View</button>
            <button class="btn-sm" onclick="quickStatus(${p.id},'reviewing')">Review</button>
            <button class="btn-sm" onclick="quickStatus(${p.id},'dismissed')">Dismiss</button>
          </div>
        </td>
      </tr>`
      )
      .join("");
  } catch (e) {
    console.error("Posts load failed:", e);
    toast("Failed to load posts", "error");
  }
}

async function quickStatus(id, status) {
  try {
    await api(`/posts/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
    toast(`Marked as ${status}`, "success");
    loadPosts();
    loadStats();
  } catch (e) {
    toast(e.message, "error");
  }
}

// --- Detail Modal ---

async function openDetail(id) {
  try {
    const p = await api(`/posts/${id}`);
    const modal = document.getElementById("modal");

    document.getElementById("modal-body").innerHTML = `
      <h3>${esc(p.title)}</h3>
      <div class="detail-grid">
        <span class="label">Subreddit</span><span>r/${esc(p.subreddit)}</span>
        <span class="label">Author</span><span>u/${esc(p.author)}</span>
        <span class="label">Reddit Score</span><span>${p.score} upvotes, ${p.num_comments} comments</span>
        <span class="label">Relevance</span><span class="relevance">${p.relevance_score.toFixed(1)}</span>
        <span class="label">Keywords</span><span>${(p.matched_keywords || []).map((k) => `<span class="kw-tag">${esc(k)}</span>`).join(" ")}</span>
        <span class="label">Intent</span><span>${(p.matched_intents || []).length ? (p.matched_intents || []).map((i) => `<span class="intent-tag">${esc(i)}</span>`).join(" ") : '<span style="color:var(--text-dim)">None detected</span>'}</span>
        <span class="label">Status</span><span><span class="status-badge status-${p.status}">${p.status}</span></span>
        <span class="label">Assigned To</span><span>${esc(p.assigned_to) || '<span style="color:var(--text-dim)">Unassigned</span>'}</span>
        <span class="label">Link</span><span><a href="${esc(p.url)}" target="_blank">${esc(p.url)}</a></span>
      </div>

      ${p.body ? `<div class="detail-body">${esc(p.body)}</div>` : ""}

      <div class="detail-notes">
        <label>Team Notes</label>
        <textarea id="detail-notes" placeholder="Add context, draft a reply, note who's handling this...">${esc(p.notes)}</textarea>
      </div>

      <div class="detail-actions">
        <button onclick="updateDetail(${p.id},'reviewing')">Mark Reviewing</button>
        <button onclick="updateDetail(${p.id},'commented')">Mark Commented</button>
        <button onclick="updateDetail(${p.id},'dismissed')">Dismiss</button>
        <button onclick="saveNotes(${p.id})">Save Notes</button>
        <button onclick="sendReminder(${p.id})">WhatsApp Reminder</button>
      </div>
    `;

    modal.classList.remove("hidden");
  } catch (e) {
    toast(e.message, "error");
  }
}

function closeModal() {
  document.getElementById("modal").classList.add("hidden");
}

async function updateDetail(id, status) {
  await quickStatus(id, status);
  closeModal();
}

async function saveNotes(id) {
  try {
    await api(`/posts/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ notes: document.getElementById("detail-notes").value }),
    });
    toast("Notes saved", "success");
  } catch (e) {
    toast(e.message, "error");
  }
}

async function sendReminder(id) {
  try {
    const res = await api(`/remind/${id}`, { method: "POST" });
    toast(res.sent ? "WhatsApp reminder sent!" : "Failed to send", res.sent ? "success" : "error");
  } catch (e) {
    toast(e.message, "error");
  }
}

// --- Scan ---

function renderLog(lines) {
  const el = document.getElementById("scan-log");
  el.innerHTML = lines
    .map((line) => {
      let cls = "log-line";
      if (line.includes("Error") || line.includes("error") || line.includes("not configured"))
        cls += " error";
      else if (line.includes("complete") || line.includes("new posts saved") || line.includes("Results:"))
        cls += " highlight";
      else if (line.includes("Searching") || line.includes("Starting"))
        cls += " info";
      return `<div class="${cls}">${esc(line)}</div>`;
    })
    .join("");
  el.scrollTop = el.scrollHeight;
}

async function triggerScan() {
  const btn = document.getElementById("btn-scan");
  const logPanel = document.getElementById("scan-log-panel");

  btn.innerHTML = '<span class="btn-icon">&#9654;</span> Scanning...';
  btn.disabled = true;

  // Show the scan log panel
  logPanel.classList.remove("hidden");
  document.getElementById("scan-log").innerHTML =
    '<div class="log-line info"><span class="spinner"></span>Scan starting... searching all of Reddit for your keywords</div>';

  try {
    const res = await api("/scan", { method: "POST" });

    renderLog(res.log || []);

    if (res.new_posts > 0) {
      toast(`Found ${res.new_posts} new high-intent posts!`, "success");
    } else if (res.total_matched > 0) {
      toast(`${res.total_matched} posts matched but all were already tracked`, "info");
    } else {
      toast("No matching posts found. Try broadening your keywords.", "info");
    }

    loadPosts();
    loadStats();
  } catch (e) {
    document.getElementById("scan-log").innerHTML = `<div class="log-line error">Scan failed: ${esc(e.message)}</div>`;
    toast("Scan failed: " + e.message, "error");
  } finally {
    btn.innerHTML = '<span class="btn-icon">&#9654;</span> Scan Now';
    btn.disabled = false;
  }
}

// --- Settings ---

async function loadConfig() {
  try {
    const data = await api("/config");
    const cfg = data.config;
    document.getElementById("cfg-keywords").value = cfg.keywords || "";
    document.getElementById("cfg-intents").value = cfg.high_intent_phrases || "";
    document.getElementById("cfg-require-intent").value = cfg.require_intent || "true";
    document.getElementById("cfg-max-posts").value = cfg.max_posts_per_poll || "25";
  } catch (e) {
    console.error("Config load failed:", e);
  }
}

async function saveConfig(key, elementId) {
  const el = document.getElementById(elementId);
  const value = el.value.trim();
  try {
    await api("/config", {
      method: "PUT",
      body: JSON.stringify({ key, value }),
    });
    toast(`${key.replace(/_/g, " ")} updated!`, "success");
  } catch (e) {
    toast(e.message, "error");
  }
}

// --- Init ---

document.addEventListener("DOMContentLoaded", () => {
  loadStats();
  loadPosts();
  loadConfig();

  setInterval(() => {
    loadStats();
    loadPosts();
  }, 120000);
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeModal();
});
