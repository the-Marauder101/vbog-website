/* Pravah guided tour + help drawer.
 *
 * ACCESS GATING — the whole point of this file, so stating the rules plainly:
 *
 *   1. Role comes from pravah_context() on the server. Never from the DOM,
 *      never from a query string, never from localStorage. The caller passes
 *      the context object it already fetched.
 *   2. Every step and every FAQ entry declares `roles`. If the caller's role
 *      is not in that list the entry is dropped before render — it is never
 *      hidden with CSS, and its text never reaches the DOM.
 *   3. A step whose anchor element is absent is dropped too. Role-gated
 *      controls that the server did not render therefore cannot be described.
 *      This is the second, independent gate: even a mis-tagged step cannot
 *      narrate a control the user does not have.
 *   4. Content is authored per portal. The client bundle contains no staff
 *      copy at all, so a client cannot reach it by any client-side means.
 *
 * "Seen" state lives in localStorage. It is a per-browser convenience, not
 * business data — deliberately no table and no migration for it.
 */
(function (root) {
  "use strict";

  var SEEN_PREFIX = "pravah_guide_seen_";

  function roleOf(context) {
    // Single source of truth. No fallback that could widen access.
    return (context && typeof context.role === "string") ? context.role : null;
  }

  function allowed(entry, role) {
    if (!role) return false;
    if (!entry || !Array.isArray(entry.roles) || entry.roles.length === 0) return false;
    return entry.roles.indexOf(role) !== -1;
  }

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  /* ── Tour ──────────────────────────────────────────────────────────── */
  function Tour(options) {
    var portal = options.portal;
    var role = roleOf(options.context);
    var displayName = (options.context && options.context.display_name) || "";
    var roleLabel = role ? String(role).replace(/_/g, " ") : "";

    // Gate 1: role. Gate 2: anchor must exist. Both before anything renders.
    var steps = (options.steps || [])
      .filter(function (s) { return allowed(s, role); })
      .filter(function (s) { return !s.target || document.querySelector(s.target); });

    var index = -1; // -1 is the welcome card
    var veil, cut, tip, panels = [];
    var open = false;

    function build() {
      veil = el("div", "guide-veil is-on");
      ["t", "r", "b", "l"].forEach(function () {
        var p = el("div", "guide-panel");
        panels.push(p);
        veil.appendChild(p);
      });
      cut = el("div", "guide-cut");
      veil.appendChild(cut);
      document.body.appendChild(veil);

      tip = el("div", "guide-tip");
      tip.setAttribute("role", "dialog");
      tip.setAttribute("aria-modal", "false");
      tip.setAttribute("aria-live", "polite");
      document.body.appendChild(tip);

      veil.addEventListener("click", function (e) { if (e.target === veil || panels.indexOf(e.target) !== -1) next(); });
      document.addEventListener("keydown", onKey);
      window.addEventListener("resize", reposition);
      window.addEventListener("scroll", reposition, true);
    }

    function onKey(e) {
      if (!open) return;
      if (e.key === "Escape") { e.preventDefault(); finish(); }
      else if (e.key === "ArrowRight" || e.key === "Enter") { e.preventDefault(); next(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); back(); }
    }

    function layoutSpotlight(rect) {
      var pad = 6;
      var x = rect.left - pad, y = rect.top - pad;
      var w = rect.width + pad * 2, h = rect.height + pad * 2;
      cut.style.cssText = "left:" + x + "px;top:" + y + "px;width:" + w + "px;height:" + h + "px;opacity:1";
      // top, right, bottom, left panels frame the cut-out
      panels[0].style.cssText = "left:0;top:0;right:0;height:" + Math.max(0, y) + "px";
      panels[1].style.cssText = "left:" + (x + w) + "px;top:" + y + "px;right:0;height:" + h + "px";
      panels[2].style.cssText = "left:0;top:" + (y + h) + "px;right:0;bottom:0";
      panels[3].style.cssText = "left:0;top:" + y + "px;width:" + Math.max(0, x) + "px;height:" + h + "px";
    }

    function layoutFull() {
      cut.style.opacity = "0";
      panels[0].style.cssText = "inset:0";
      panels[1].style.cssText = "display:none";
      panels[2].style.cssText = "display:none";
      panels[3].style.cssText = "display:none";
    }

    function placeTip(rect) {
      var margin = 12;
      var tw = tip.offsetWidth, th = tip.offsetHeight;
      var top, left;
      var below = rect.bottom + margin;
      if (below + th <= window.innerHeight - 8) top = below;
      else if (rect.top - margin - th >= 8) top = rect.top - margin - th;
      else top = Math.max(8, Math.min(window.innerHeight - th - 8, rect.top));
      left = rect.left + rect.width / 2 - tw / 2;
      left = Math.max(12, Math.min(window.innerWidth - tw - 12, left));
      tip.style.left = left + "px";
      tip.style.top = top + "px";
      tip.style.transform = "none";
    }

    function reposition() {
      if (!open) return;
      if (index < 0) return;
      var step = steps[index];
      var node = step.target ? document.querySelector(step.target) : null;
      if (!node) { layoutFull(); return; }
      var rect = node.getBoundingClientRect();
      layoutSpotlight(rect);
      placeTip(rect);
    }

    function renderWelcome() {
      tip.className = "guide-tip is-welcome";
      tip.innerHTML = "";
      if (roleLabel) tip.appendChild(el("span", "guide-role", roleLabel));
      tip.appendChild(el("h3", null, displayName ? "Welcome, " + displayName.split(" ")[0] + "." : "Welcome to Pravah."));
      tip.appendChild(el("p", null, options.intro || "A quick pass through each section, so you know where everything lives. About a minute."));
      var foot = el("div", "guide-foot");
      var skip = el("button", "guide-btn ghost", "Skip");
      skip.type = "button";
      skip.addEventListener("click", finish);
      var start = el("button", "guide-btn primary", steps.length ? "Start tour" : "Got it");
      start.type = "button";
      start.addEventListener("click", next);
      foot.appendChild(el("div", "guide-dots"));
      foot.appendChild(skip);
      foot.appendChild(start);
      tip.appendChild(foot);
      layoutFull();
      start.focus();
    }

    function renderStep() {
      var step = steps[index];
      if (step.view && typeof options.onView === "function") options.onView(step.view);

      tip.className = "guide-tip";
      tip.innerHTML = "";
      tip.appendChild(el("p", "guide-step", "Step " + (index + 1) + " of " + steps.length));
      tip.appendChild(el("h3", null, step.title));
      tip.appendChild(el("p", null, step.body));

      var foot = el("div", "guide-foot");
      var dots = el("div", "guide-dots");
      steps.forEach(function (_, i) { dots.appendChild(el("span", "guide-dot" + (i === index ? " on" : ""))); });
      foot.appendChild(dots);

      var skip = el("button", "guide-btn ghost", "Skip");
      skip.type = "button"; skip.addEventListener("click", finish);
      foot.appendChild(skip);

      if (index > 0) {
        var prev = el("button", "guide-btn", "Back");
        prev.type = "button"; prev.addEventListener("click", back);
        foot.appendChild(prev);
      }
      var fwd = el("button", "guide-btn primary", index === steps.length - 1 ? "Done" : "Next");
      fwd.type = "button"; fwd.addEventListener("click", next);
      foot.appendChild(fwd);
      tip.appendChild(foot);

      // let the requested view paint before measuring
      root.requestAnimationFrame(function () { reposition(); fwd.focus(); });
    }

    function next() { if (index >= steps.length - 1) { finish(); return; } index += 1; renderStep(); }
    function back() { if (index <= 0) { index = -1; renderWelcome(); return; } index -= 1; renderStep(); }

    function finish() {
      open = false;
      try { localStorage.setItem(SEEN_PREFIX + portal, "1"); } catch (_) {}
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
      if (veil && veil.parentNode) veil.parentNode.removeChild(veil);
      if (tip && tip.parentNode) tip.parentNode.removeChild(tip);
      panels = [];
      if (typeof options.onFinish === "function") options.onFinish();
    }

    function start() {
      if (open) return;
      if (!role) return;              // no verified role, no tour
      open = true; index = -1;
      build(); renderWelcome();
    }

    function seen() {
      try { return localStorage.getItem(SEEN_PREFIX + portal) === "1"; } catch (_) { return true; }
    }

    return { start: start, seen: seen, stepCount: steps.length };
  }

  /* ── Help drawer ───────────────────────────────────────────────────── */
  function Help(options) {
    var role = roleOf(options.context);
    var groups = [];

    // Same gate as the tour: filter by verified role, drop empty groups.
    (options.faq || []).forEach(function (group) {
      var items = (group.items || []).filter(function (item) { return allowed(item, role); });
      if (items.length) groups.push({ title: group.title, items: items });
    });

    var scrim = null;

    function render(query) {
      var body = scrim.querySelector(".help-body");
      body.innerHTML = "";
      var search = el("input", "help-search");
      search.type = "search";
      search.placeholder = "Search help…";
      search.value = query || "";
      search.addEventListener("input", function () { render(search.value); });
      body.appendChild(search);

      var q = (query || "").trim().toLowerCase();
      var shown = 0;

      groups.forEach(function (group) {
        var items = group.items.filter(function (item) {
          if (!q) return true;
          return (item.q + " " + item.a).toLowerCase().indexOf(q) !== -1;
        });
        if (!items.length) return;
        var wrap = el("section", "help-group");
        wrap.appendChild(el("h3", null, group.title));
        items.forEach(function (item) {
          shown += 1;
          var d = el("details", "help-q");
          var s = el("summary", null, item.q);
          d.appendChild(s);
          var ans = el("div");
          ans.innerHTML = item.a;   // authored copy only, never user input
          d.appendChild(ans);
          if (q) d.open = true;
          wrap.appendChild(d);
        });
        body.appendChild(wrap);
      });

      if (!shown) body.appendChild(el("p", "help-empty", q ? "Nothing matches “" + q + "”." : "No help topics for your account."));
      if (q) search.focus();
    }

    function close() {
      if (!scrim) return;
      document.removeEventListener("keydown", onKey);
      scrim.parentNode.removeChild(scrim);
      scrim = null;
    }
    function onKey(e) { if (e.key === "Escape") close(); }

    function openDrawer() {
      if (!role) return;            // no verified role, no help
      if (scrim) return;
      scrim = el("div", "help-scrim");
      var drawer = el("aside", "help-drawer");
      drawer.setAttribute("role", "dialog");
      drawer.setAttribute("aria-modal", "true");
      drawer.setAttribute("aria-label", "Help");

      var head = el("div", "help-head");
      var titles = el("div");
      titles.appendChild(el("p", "guide-step", (options.portalLabel || "Pravah") + " · " + String(role).replace(/_/g, " ")));
      titles.appendChild(el("h2", null, "Help"));
      head.appendChild(titles);
      var x = el("button", "help-close", "×");
      x.type = "button"; x.setAttribute("aria-label", "Close help");
      x.addEventListener("click", close);
      head.appendChild(x);
      drawer.appendChild(head);

      drawer.appendChild(el("div", "help-body"));

      var foot = el("div", "help-foot");
      foot.appendChild(el("small", null, "Something not covered here? Ask your account manager."));
      if (options.onReplayTour) {
        var replay = el("button", "guide-btn", "Replay tour");
        replay.type = "button";
        replay.addEventListener("click", function () { close(); options.onReplayTour(); });
        foot.appendChild(replay);
      }
      drawer.appendChild(foot);

      scrim.appendChild(drawer);
      scrim.addEventListener("click", function (e) { if (e.target === scrim) close(); });
      document.addEventListener("keydown", onKey);
      document.body.appendChild(scrim);
      render("");
      x.focus();
    }

    return { open: openDrawer, close: close, topicCount: groups.reduce(function (n, g) { return n + g.items.length; }, 0) };
  }

  root.PravahGuide = { Tour: Tour, Help: Help };
})(window);
