// js/ui.js — shared UI kit used by every page (full docs: ../ARCHITECTURE.md §5)
//
// UI.esc()            escape ALL user data before innerHTML (no exceptions)
// UI.toast()/fieldError()  outcomes vs validation messages
// UI.enhanceSelect()  turns a native <select> into the styled .dd dropdown;
//                     the native select stays (hidden) as the source of truth —
//                     re-call after repopulating options; UI.syncSelect() after
//                     setting .value programmatically
// UI.matchesDateFilter()/dateFilterOptions  shared due-date filter logic
// Also: modal open/close, offline banner, avatar colors, date formatting.

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
    ["custom", "Custom range…"],
    ["none", "No due date"],
  ],

  // Deterministic avatar colour per member name
  avatarColor(name) {
    const palette = ["#0F3460", "#7C3AED", "#0E7490", "#15803D", "#B45309", "#BE185D", "#4338CA"];
    let h = 0;
    for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return palette[h % palette.length];
  },

  // `range` = {from, to} (ISO date strings), used when key === "custom"
  matchesDateFilter(due, key, range) {
    const today = UI.todayIso();
    switch (key) {
      case "overdue": return !!due && due < today;
      case "today":   return due === today;
      case "week":    return !!due && due >= today && due <= UI.todayIso(7);
      case "month":   return !!due && due >= today && due <= UI.todayIso(30);
      case "none":    return !due;
      case "custom": {
        if (!range || (!range.from && !range.to)) return true; // no bounds yet
        if (!due) return false;
        if (range.from && due < range.from) return false;
        if (range.to && due > range.to) return false;
        return true;
      }
      default: return true; // "all"
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

  // Replace a native <select> with a styled dropdown. The native element
  // stays in the DOM (hidden) as the source of truth: pages keep reading
  // .value and listening for 'change' exactly as before. Call again after
  // repopulating the select's options to rebuild the menu.
  enhanceSelect(sel) {
    let wrap = sel.closest(".dd");
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.className = "dd" + (sel.classList.contains("filter-select") ? " dd-pill" : "");
      sel.parentNode.insertBefore(wrap, sel);
      wrap.appendChild(sel);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "dd-btn";
      if (sel.getAttribute("aria-label")) btn.setAttribute("aria-label", sel.getAttribute("aria-label"));
      wrap.appendChild(btn);
      const menu = document.createElement("div");
      menu.className = "dd-menu";
      wrap.appendChild(menu);

      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const wasOpen = wrap.classList.contains("open");
        document.querySelectorAll(".dd.open").forEach((d) => d.classList.remove("open"));
        if (!wasOpen) wrap.classList.add("open");
      });
      btn.addEventListener("keydown", (e) => {
        if (e.key === "Escape") wrap.classList.remove("open");
        if (e.key === "ArrowDown" && wrap.classList.contains("open")) {
          e.preventDefault();
          menu.querySelector(".dd-item")?.focus();
        }
      });
      menu.addEventListener("keydown", (e) => {
        const items = [...menu.querySelectorAll(".dd-item")];
        const i = items.indexOf(document.activeElement);
        if (e.key === "ArrowDown") { e.preventDefault(); items[Math.min(i + 1, items.length - 1)]?.focus(); }
        if (e.key === "ArrowUp") { e.preventDefault(); items[Math.max(i - 1, 0)]?.focus(); }
        if (e.key === "Escape") { wrap.classList.remove("open"); btn.focus(); }
      });
      // keep the button label + accent in sync when code sets sel.value
      sel.addEventListener("change", () => UI.syncSelect(sel));
      sel.style.display = "none";
    }
    // (re)build the menu from current options
    const menu = wrap.querySelector(".dd-menu");
    menu.innerHTML = "";
    [...sel.options].forEach((opt) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "dd-item";
      item.dataset.value = opt.value;
      item.textContent = opt.textContent;
      item.addEventListener("click", () => {
        sel.value = opt.value;
        wrap.classList.remove("open");
        sel.dispatchEvent(new Event("change", { bubbles: true }));
      });
      menu.appendChild(item);
    });
    UI.syncSelect(sel);
  },

  syncSelect(sel) {
    const wrap = sel.closest(".dd");
    if (!wrap) return;
    const btn = wrap.querySelector(".dd-btn");
    const current = sel.options[sel.selectedIndex];
    btn.textContent = current ? current.textContent : "";
    btn.classList.toggle("on", sel.classList.contains("on"));
    wrap.querySelectorAll(".dd-item").forEach((it) => {
      it.classList.toggle("selected", it.dataset.value === sel.value);
    });
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

// Close any open styled dropdown on outside click
document.addEventListener("click", () => {
  document.querySelectorAll(".dd.open").forEach((d) => d.classList.remove("open"));
});

// Close any open modal on overlay click or Escape
document.addEventListener("click", (e) => {
  if (e.target.classList && e.target.classList.contains("modal-overlay")) {
    e.target.classList.remove("open");
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    document.querySelectorAll(".modal-overlay.open").forEach((m) => m.classList.remove("open"));
    document.querySelectorAll(".dd.open").forEach((d) => d.classList.remove("open"));
  }
});

// Offline banner
window.addEventListener("offline", () => {
  document.getElementById("offline-banner")?.removeAttribute("hidden");
});
window.addEventListener("online", () => {
  document.getElementById("offline-banner")?.setAttribute("hidden", "");
});
