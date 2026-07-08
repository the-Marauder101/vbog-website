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
  setTimeout(() => el.remove(), 3000);
}

function timeAgo(iso) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return Math.floor(diff / 60) + "m ago";
  if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
  return Math.floor(diff / 86400) + "d ago";
}

// --- Stats ---
async function loadStats() {
  try {
    const stats = await api("/stats");
    const bar = document.getElementById("stats-bar");
    const statuses = [
      { key: "new", label: "New" },
      { key: "reviewing", label: "Reviewing" },
      { key: "commented", label: "Commented" },
      { key: "dismissed", label: "Dismissed" },
    ];
    bar.innerHTML =
      `<div class="stat-card"><span class="label">Total</span><span class="value">${stats.total}</span></div>` +
      statuses
        .map(
          (s) =>
            `<div class="stat-card ${s.key}"><span class="label">${s.label}</span><span class="value">${stats.by_status[s.key] || 0}</span></div>`
        )
        .join("");

    const subSelect = document.getElementById("filter-subreddit");
    const current = subSelect.value;
    subSelect.innerHTML = '<option value="">All</option>';
    Object.keys(stats.by_subreddit || {}).forEach((sub) => {
      const opt = document.createElement("option");
      opt.value = sub;
      opt.textContent = `r/${sub} (${stats.by_subreddit[sub]})`;
      subSelect.appendChild(opt);
    });
    subSelect.value = current;
  } catch (e) {
    console.error("Failed to load stats:", e);
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
        '<tr><td colspan="9" style="text-align:center;padding:2rem;color:var(--text-dim)">No posts found. Click "Scan Now" or adjust your filters.</td></tr>';
      return;
    }

    tbody.innerHTML = data.posts
      .map(
        (p) => `
      <tr>
        <td><span class="status-badge status-${p.status}">${p.status}</span></td>
        <td>r/${esc(p.subreddit)}</td>
        <td class="title-cell"><a href="${esc(p.url)}" target="_blank" title="${esc(p.title)}">${esc(p.title)}</a></td>
        <td>${p.score}</td>
        <td>${(p.matched_keywords || []).map((k) => `<span class="kw-tag">${esc(k)}</span>`).join("")}</td>
        <td>${(p.matched_intents || []).map((i) => `<span class="intent-tag">${esc(i)}</span>`).join("")}</td>
        <td class="relevance">${p.relevance_score.toFixed(1)}</td>
        <td>${timeAgo(p.flagged_at)}</td>
        <td class="actions-cell">
          <button onclick="openDetail(${p.id})">View</button>
          <button onclick="quickStatus(${p.id},'reviewing')">Review</button>
          <button onclick="quickStatus(${p.id},'dismissed')">Dismiss</button>
        </td>
      </tr>`
      )
      .join("");
  } catch (e) {
    console.error("Failed to load posts:", e);
    toast("Failed to load posts", "error");
  }
}

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s || "";
  return d.innerHTML;
}

async function quickStatus(id, status) {
  try {
    await api(`/posts/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
    toast(`Post marked as ${status}`, "success");
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
    const body = document.getElementById("modal-body");

    body.innerHTML = `
      <h3>${esc(p.title)}</h3>
      <div class="detail-row"><span class="label">Subreddit</span><span>r/${esc(p.subreddit)}</span></div>
      <div class="detail-row"><span class="label">Author</span><span>u/${esc(p.author)}</span></div>
      <div class="detail-row"><span class="label">Reddit Score</span><span>${p.score} | ${p.num_comments} comments</span></div>
      <div class="detail-row"><span class="label">Relevance</span><span class="relevance">${p.relevance_score.toFixed(1)}</span></div>
      <div class="detail-row"><span class="label">Keywords</span><span>${(p.matched_keywords || []).map((k) => `<span class="kw-tag">${esc(k)}</span>`).join(" ")}</span></div>
      <div class="detail-row"><span class="label">Intent Phrases</span><span>${(p.matched_intents || []).map((i) => `<span class="intent-tag">${esc(i)}</span>`).join(" ")}</span></div>
      <div class="detail-row"><span class="label">Status</span><span><span class="status-badge status-${p.status}">${p.status}</span></span></div>
      <div class="detail-row"><span class="label">Assigned To</span><span>${esc(p.assigned_to) || "—"}</span></div>
      <div class="detail-row"><span class="label">URL</span><span><a href="${esc(p.url)}" target="_blank" style="color:var(--accent)">${esc(p.url)}</a></span></div>

      ${p.body ? `<div class="detail-body">${esc(p.body)}</div>` : ""}

      <div class="detail-notes">
        <label style="font-size:0.85rem;color:var(--text-dim)">Team Notes</label>
        <textarea id="detail-notes">${esc(p.notes)}</textarea>
      </div>

      <div class="detail-actions">
        <button onclick="updateDetail(${p.id},'reviewing')">Mark Reviewing</button>
        <button onclick="updateDetail(${p.id},'commented')">Mark Commented</button>
        <button onclick="updateDetail(${p.id},'dismissed')">Dismiss</button>
        <button onclick="saveNotes(${p.id})">Save Notes</button>
        <button onclick="sendReminder(${p.id})">Send WhatsApp Reminder</button>
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
  const notes = document.getElementById("detail-notes").value;
  try {
    await api(`/posts/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ notes }),
    });
    toast("Notes saved", "success");
  } catch (e) {
    toast(e.message, "error");
  }
}

async function sendReminder(id) {
  try {
    const res = await api(`/remind/${id}`, { method: "POST" });
    toast(res.sent ? "WhatsApp reminder sent" : "Failed to send reminder", res.sent ? "success" : "error");
  } catch (e) {
    toast(e.message, "error");
  }
}

// --- Scan ---
async function triggerScan() {
  const btn = document.getElementById("btn-scan");
  btn.textContent = "Scanning...";
  btn.disabled = true;
  try {
    const res = await api("/scan", { method: "POST" });
    toast(`Scan complete: ${res.new_posts} new posts found`, "success");
    loadPosts();
    loadStats();
  } catch (e) {
    toast("Scan failed: " + e.message, "error");
  } finally {
    btn.textContent = "Scan Now";
    btn.disabled = false;
  }
}

// --- Settings ---
function toggleSettings() {
  document.getElementById("settings-panel").classList.toggle("hidden");
}

async function loadConfig() {
  try {
    const data = await api("/config");
    const cfg = data.config;
    document.getElementById("cfg-subreddits").value = cfg.subreddits || "";
    document.getElementById("cfg-keywords").value = cfg.keywords || "";
    document.getElementById("cfg-intents").value = cfg.high_intent_phrases || "";
    document.getElementById("cfg-min-kw").value = cfg.min_keyword_matches || "1";
    document.getElementById("cfg-require-intent").value = cfg.require_intent || "true";
    document.getElementById("cfg-max-posts").value = cfg.max_posts_per_poll || "25";
  } catch (e) {
    console.error("Failed to load config:", e);
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
    toast(`${key} updated`, "success");
  } catch (e) {
    toast(e.message, "error");
  }
}

// --- Init ---
document.addEventListener("DOMContentLoaded", () => {
  loadStats();
  loadPosts();
  loadConfig();

  // Auto-refresh every 2 minutes
  setInterval(() => {
    loadStats();
    loadPosts();
  }, 120000);
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeModal();
});
