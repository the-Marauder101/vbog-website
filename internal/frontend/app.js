const API = "";

function $(id) { return document.getElementById(id); }

async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.detail || `HTTP ${res.status}`);
  return data;
}

function toast(msg, type = "info") {
  const el = document.createElement("div");
  el.className = "toast toast-" + (type === "success" ? "ok" : type === "error" ? "err" : "info");
  el.textContent = msg;
  $("toasts").appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

function timeAgo(iso) {
  if (!iso) return "";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  return Math.floor(s / 86400) + "d ago";
}

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s || "";
  return d.innerHTML;
}

function togglePanel(id) {
  $(id).classList.toggle("hidden");
}

function relClass(score) {
  if (score >= 8) return "rel-high";
  if (score >= 4) return "rel-med";
  return "rel-low";
}

// ---- Stats ----

async function loadStats() {
  try {
    const s = await api("/api/stats");
    $("stats-bar").innerHTML = [
      `<div class="stat"><span class="n">${s.total}</span>Total</div>`,
      `<div class="stat s-new"><span class="n">${s.by_status.new || 0}</span>New</div>`,
      `<div class="stat s-reviewing"><span class="n">${s.by_status.reviewing || 0}</span>Reviewing</div>`,
      `<div class="stat s-commented"><span class="n">${s.by_status.commented || 0}</span>Commented</div>`,
      `<div class="stat s-dismissed"><span class="n">${s.by_status.dismissed || 0}</span>Dismissed</div>`,
    ].join("");

    const sel = $("filter-subreddit");
    const cur = sel.value;
    sel.innerHTML = '<option value="">All</option>';
    Object.entries(s.by_subreddit || {}).forEach(([sub, cnt]) => {
      sel.innerHTML += `<option value="${esc(sub)}"${sub === cur ? " selected" : ""}>r/${esc(sub)} (${cnt})</option>`;
    });

    $("onboarding").classList.toggle("hidden", s.total > 0);
  } catch (e) {
    console.error("Stats:", e);
  }
}

// ---- Posts ----

async function loadPosts() {
  try {
    const status = $("filter-status").value;
    const sub = $("filter-subreddit").value;
    let q = "?limit=100";
    if (status) q += `&status=${status}`;
    if (sub) q += `&subreddit=${sub}`;

    const data = await api("/api/posts" + q);
    $("post-count").textContent = data.count + " posts";

    const container = $("posts-container");

    if (!data.posts.length) {
      container.innerHTML = '<div class="empty-state"><p>No posts match these filters.</p></div>';
      return;
    }

    container.innerHTML = data.posts.map(p => `
      <div class="post-card" onclick="openDetail(${p.id})">
        <div class="post-card-top">
          <span class="badge badge-${p.status}">${p.status}</span>
          <span class="post-sub">r/${esc(p.subreddit)}</span>
          <span class="post-score">${p.score} pts &middot; ${p.num_comments} comments</span>
          <span class="relevance ${relClass(p.relevance_score)}">${p.relevance_score.toFixed(0)} rel</span>
          <span class="post-time">${timeAgo(p.flagged_at)}</span>
        </div>
        <div class="post-card-title"><a href="${esc(p.url)}" target="_blank" onclick="event.stopPropagation()">${esc(p.title)}</a></div>
        <div class="post-card-tags">
          ${(p.matched_keywords||[]).map(k => `<span class="tag-kw">${esc(k)}</span>`).join("")}
          ${(p.matched_intents||[]).map(i => `<span class="tag-intent">${esc(i)}</span>`).join("")}
        </div>
        <div class="post-card-actions" onclick="event.stopPropagation()">
          <button class="btn-sm" onclick="setStatus(${p.id},'reviewing')">Review</button>
          <button class="btn-sm" onclick="setStatus(${p.id},'commented')">Commented</button>
          <button class="btn-sm" onclick="setStatus(${p.id},'dismissed')">Dismiss</button>
        </div>
      </div>
    `).join("");
  } catch (e) {
    console.error("Posts:", e);
    $("posts-container").innerHTML = '<div class="empty-state"><p>Failed to load posts.</p></div>';
  }
}

async function setStatus(id, status) {
  try {
    await api(`/api/posts/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
    toast("Marked as " + status, "success");
    loadPosts();
    loadStats();
  } catch (e) { toast(e.message, "error"); }
}

// ---- Detail Modal ----

async function openDetail(id) {
  try {
    const p = await api(`/api/posts/${id}`);
    $("modal-body").innerHTML = `
      <h3>${esc(p.title)}</h3>
      <div class="detail-grid">
        <span class="dl">Subreddit</span><span>r/${esc(p.subreddit)}</span>
        <span class="dl">Author</span><span>u/${esc(p.author)}</span>
        <span class="dl">Score</span><span>${p.score} pts &middot; ${p.num_comments} comments</span>
        <span class="dl">Relevance</span><span class="relevance ${relClass(p.relevance_score)}">${p.relevance_score.toFixed(1)}</span>
        <span class="dl">Keywords</span><span>${(p.matched_keywords||[]).map(k=>`<span class="tag-kw">${esc(k)}</span>`).join(" ")}</span>
        <span class="dl">Intent</span><span>${(p.matched_intents||[]).length ? (p.matched_intents||[]).map(i=>`<span class="tag-intent">${esc(i)}</span>`).join(" ") : '<span style="color:var(--text3)">none</span>'}</span>
        <span class="dl">Status</span><span><span class="badge badge-${p.status}">${p.status}</span></span>
        <span class="dl">Assigned</span><span>${esc(p.assigned_to) || '<span style="color:var(--text3)">unassigned</span>'}</span>
        <span class="dl">Link</span><span><a href="${esc(p.url)}" target="_blank">Open on Reddit</a></span>
      </div>
      ${p.body ? `<div class="detail-body">${esc(p.body)}</div>` : ""}
      <div class="detail-notes">
        <label>Team Notes</label>
        <textarea id="detail-notes" placeholder="Draft a reply, add context...">${esc(p.notes)}</textarea>
      </div>
      <div class="detail-actions">
        <button onclick="updateAndClose(${p.id},'reviewing')">Mark Reviewing</button>
        <button onclick="updateAndClose(${p.id},'commented')">Mark Commented</button>
        <button onclick="updateAndClose(${p.id},'dismissed')">Dismiss</button>
        <button onclick="saveNotes(${p.id})">Save Notes</button>
        <button onclick="sendReminder(${p.id})">WhatsApp Reminder</button>
      </div>
    `;
    $("modal").classList.remove("hidden");
  } catch (e) { toast(e.message, "error"); }
}

function closeModal() { $("modal").classList.add("hidden"); }

async function updateAndClose(id, status) {
  await setStatus(id, status);
  closeModal();
}

async function saveNotes(id) {
  try {
    await api(`/api/posts/${id}`, { method: "PATCH", body: JSON.stringify({ notes: $("detail-notes").value }) });
    toast("Notes saved", "success");
  } catch (e) { toast(e.message, "error"); }
}

async function sendReminder(id) {
  try {
    const r = await api(`/api/remind/${id}`, { method: "POST" });
    toast(r.sent ? "WhatsApp reminder sent!" : "Failed to send", r.sent ? "success" : "error");
  } catch (e) { toast(e.message, "error"); }
}

// ---- Scan with SSE ----

function startScan() {
  const btn = $("btn-scan");
  const feed = $("scan-feed");
  const log = $("scan-log");

  btn.textContent = "Scanning...";
  btn.disabled = true;
  feed.classList.remove("hidden");
  log.innerHTML = '<div class="entry searching"><span class="spinner"></span>Connecting to Reddit...</div>';
  $("scan-title").textContent = "Scanning...";
  $("scan-counter").textContent = "";

  const es = new EventSource("/api/scan/stream");
  let newCount = 0;
  let total = 0;

  es.onmessage = function(e) {
    let data;
    try { data = JSON.parse(e.data); } catch { return; }

    if (data.type === "progress") {
      log.innerHTML += `<div class="entry searching">[${data.current}/${data.total}] Searching "${esc(data.keyword)}" in ${esc(data.target)}...</div>`;
      $("scan-title").textContent = `Scanning "${data.keyword}"...`;
      log.scrollTop = log.scrollHeight;
    }

    else if (data.type === "post_found") {
      total++;
      if (data.is_new) newCount++;
      $("scan-counter").textContent = `${newCount} new / ${total} total`;
      const label = data.is_new ? "NEW" : "dup";
      const cls = data.is_new ? "found" : "";
      log.innerHTML += `<div class="entry ${cls}">${label}: r/${esc(data.post.subreddit)} — ${esc(data.post.title).slice(0, 80)}</div>`;
      log.scrollTop = log.scrollHeight;
      if (data.is_new) loadPosts();
    }

    else if (data.type === "status") {
      log.innerHTML += `<div class="entry searching">${esc(data.message)}</div>`;
      log.scrollTop = log.scrollHeight;
    }

    else if (data.type === "error") {
      log.innerHTML += `<div class="entry error">Error: ${esc(data.message)}</div>`;
      log.scrollTop = log.scrollHeight;
    }

    else if (data.type === "done" || data.type === "summary") {
      es.close();
      btn.textContent = "Scan Now";
      btn.disabled = false;
      $("scan-title").textContent = "Scan Complete";
      log.innerHTML += `<div class="entry done">Done: ${newCount} new posts saved, ${total} total matched</div>`;
      log.scrollTop = log.scrollHeight;

      if (newCount > 0) {
        toast(`Found ${newCount} new leads!`, "success");
      } else if (total > 0) {
        toast(`${total} matches found, all already tracked`, "info");
      } else {
        toast("No matching posts. Try broader keywords or disable intent filter.", "info");
      }

      loadPosts();
      loadStats();
    }
  };

  es.onerror = function() {
    es.close();
    btn.textContent = "Scan Now";
    btn.disabled = false;
    $("scan-title").textContent = "Scan Failed";
    log.innerHTML += '<div class="entry error">Connection lost. Check if the server is running.</div>';

    if (total > 0) {
      loadPosts();
      loadStats();
    }
  };
}

// ---- Config ----

async function loadConfig() {
  try {
    const d = await api("/api/config");
    const c = d.config;
    $("cfg-keywords").value = c.keywords || "";
    $("cfg-intents").value = c.high_intent_phrases || "";
    $("cfg-subreddits").value = c.subreddits || "";
    $("cfg-time-filter").value = c.time_filter || "7d";
    $("cfg-require-intent").value = c.require_intent || "true";
    $("cfg-max-posts").value = c.max_posts_per_poll || "25";
  } catch (e) {
    console.error("Config load:", e);
  }
}

async function saveConfig(key, elId) {
  const value = $(elId).value.trim();
  if (key === "keywords" && !value) {
    toast("Keywords cannot be empty", "error");
    return;
  }
  try {
    await api("/api/config", { method: "PUT", body: JSON.stringify({ key, value }) });
    toast(key.replace(/_/g, " ") + " saved!", "success");
  } catch (e) {
    toast("Save failed: " + e.message, "error");
  }
}

// ---- Init ----

document.addEventListener("DOMContentLoaded", () => {
  loadStats();
  loadPosts();
  loadConfig();
  setInterval(() => { loadStats(); loadPosts(); }, 120000);
});

document.addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); });
