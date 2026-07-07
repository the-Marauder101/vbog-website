// Shared UI helpers: toasts, modals, dates, escaping, offline banner.

const UI = {
  // HTML-escape untrusted strings before inserting into innerHTML
  esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  },

  // "2026-07-07" -> "07 Jul 2026"
  fmtDate(iso) {
    if (!iso) return "";
    const [y, m, d] = iso.split("-").map(Number);
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return `${String(d).padStart(2, "0")} ${months[m - 1]} ${y}`;
  },

  todayIso(offsetDays = 0) {
    const d = new Date(Date.now() + offsetDays * 86400000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  },

  isOverdue(iso) {
    return !!iso && iso < UI.todayIso();
  },

  // Due-date filter presets shared by the board and All Tasks views
  dateFilterOptions: [
    ["all", "All dates"],
    ["overdue", "Overdue"],
    ["today", "Due today"],
    ["week", "Next 7 days"],
    ["month", "Next 30 days"],
    ["none", "No due date"],
  ],

  // Deterministic avatar colour per member name
  avatarColor(name) {
    const palette = ["#0F3460", "#7C3AED", "#0E7490", "#15803D", "#B45309", "#BE185D", "#4338CA"];
    let h = 0;
    for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return palette[h % palette.length];
  },

  matchesDateFilter(due, key) {
    const today = UI.todayIso();
    switch (key) {
      case "overdue": return !!due && due < today;
      case "today":   return due === today;
      case "week":    return !!due && due >= today && due <= UI.todayIso(7);
      case "month":   return !!due && due >= today && due <= UI.todayIso(30);
      case "none":    return !due;
      default:        return true; // "all"
    }
  },

  toast(message, type = "error") {
    let host = document.getElementById("toasts");
    if (!host) {
      host = document.createElement("div");
      host.id = "toasts";
      document.body.appendChild(host);
    }
    const el = document.createElement("div");
    el.className = `toast toast-${type}`;
    el.innerHTML = `<span>${UI.esc(message)}</span><button class="toast-close" aria-label="Dismiss">&times;</button>`;
    el.querySelector(".toast-close").addEventListener("click", () => el.remove());
    host.appendChild(el);
    setTimeout(() => el.remove(), 4000);
  },

  openModal(id) {
    const m = document.getElementById(id);
    m.classList.add("open");
    const first = m.querySelector("input, textarea, select");
    if (first) setTimeout(() => first.focus(), 50);
  },

  closeModal(id) {
    document.getElementById(id).classList.remove("open");
  },

  // Mark a field invalid with a message below it
  fieldError(input, message) {
    input.classList.add("invalid");
    let msg = input.parentElement.querySelector(".field-error");
    if (!msg) {
      msg = document.createElement("div");
      msg.className = "field-error";
      input.parentElement.appendChild(msg);
    }
    msg.textContent = message;
  },

  clearFieldErrors(form) {
    form.querySelectorAll(".invalid").forEach((el) => el.classList.remove("invalid"));
    form.querySelectorAll(".field-error").forEach((el) => el.remove());
  },
};

// Close any open modal on overlay click or Escape
document.addEventListener("click", (e) => {
  if (e.target.classList && e.target.classList.contains("modal-overlay")) {
    e.target.classList.remove("open");
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    document.querySelectorAll(".modal-overlay.open").forEach((m) => m.classList.remove("open"));
  }
});

// Offline banner
window.addEventListener("offline", () => {
  document.getElementById("offline-banner")?.removeAttribute("hidden");
});
window.addEventListener("online", () => {
  document.getElementById("offline-banner")?.setAttribute("hidden", "");
});
