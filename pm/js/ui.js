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

  isOverdue(iso) {
    if (!iso) return false;
    const today = new Date();
    const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    return iso < todayIso;
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
