(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PravahReportParser = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const aliases = {
    closer_name: ["closer", "closer name", "name", "sales rep", "rep"],
    client_name: ["client", "client name", "company", "account"],
    report_date: ["date", "report date", "reporting date", "day"],
    calls_attempted: ["calls", "calls made", "total calls", "dials", "attempts"],
    connected_calls: ["connected", "connections", "calls connected", "answered"],
    qualified_opportunities: ["qualified", "positive leads", "hot leads", "opportunities"],
    sales_count: ["sales", "closed", "sales closed", "deals", "enrolled"],
    revenue_generated: ["revenue", "sales value", "booked revenue", "amount sold"],
    cash_collected: ["cash", "cash collected", "collections", "amount collected"],
    blocker: ["blocker", "blockers", "challenge", "issue", "support needed"],
    next_period_plan: ["next step", "next steps", "plan", "tomorrow", "action"]
  };

  const lookup = Object.entries(aliases).reduce(function (map, entry) {
    entry[1].forEach(function (label) { map[normalizeLabel(label)] = entry[0]; });
    return map;
  }, {});

  const numericFields = new Set([
    "calls_attempted", "connected_calls", "qualified_opportunities",
    "sales_count", "revenue_generated", "cash_collected"
  ]);

  function normalizeLabel(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[\*_#]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function numericValue(value) {
    const stripped = String(value || "").replace(/[^0-9.-]/g, "");
    if (!stripped || stripped === "." || stripped === "-") return null;
    const number = Number(stripped);
    return Number.isFinite(number) ? number : null;
  }

  function splitLine(line) {
    const colon = line.match(/^\s*([^:]{1,45})\s*:\s*(.+?)\s*$/);
    if (colon) return [colon[1], colon[2]];
    const dash = line.match(/^\s*([^-–—]{1,45})\s+[-–—]\s+(.+?)\s*$/);
    return dash ? [dash[1], dash[2]] : null;
  }

  function parseReport(text) {
    const data = {};
    const unknown = [];
    const duplicates = [];

    String(text || "").split(/\r?\n/).forEach(function (rawLine) {
      const line = rawLine.replace(/^\s*[-•]\s*/, "").trim();
      if (!line) return;
      const parts = splitLine(line);
      if (!parts) { unknown.push(line); return; }
      const canonical = lookup[normalizeLabel(parts[0])];
      if (!canonical) { unknown.push(line); return; }
      if (Object.prototype.hasOwnProperty.call(data, canonical)) duplicates.push(canonical);
      const value = numericFields.has(canonical) ? numericValue(parts[1]) : parts[1].trim();
      if (value !== null && value !== "") data[canonical] = value;
    });

    const recognized = Object.keys(data).length;
    const errors = [];
    if (!recognized) errors.push("No recognized fields found. Use one ‘label: value’ line per item.");
    if (!data.closer_name) errors.push("Add a closer name before saving.");
    if (!data.report_date) data.report_date = new Date().toISOString().slice(0, 10);

    return { data, recognized, unknown, duplicates, errors, valid: recognized > 0 && Boolean(data.closer_name) };
  }

  function formatCurrency(value) {
    if (value === undefined || value === null || value === "") return "—";
    return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(Number(value));
  }

  function whatsappMessage(data) {
    const lines = [
      "*Closer Update — " + (data.closer_name || "Unnamed") + "*",
      [data.client_name, data.report_date].filter(Boolean).join(" · "),
      "",
      "Calls: " + (data.calls_attempted ?? "—") + " | Connected: " + (data.connected_calls ?? "—"),
      "Sales: " + (data.sales_count ?? "—") + " | Revenue: " + formatCurrency(data.revenue_generated),
      "Cash collected: " + formatCurrency(data.cash_collected)
    ];
    if (data.blocker) lines.push("Blocker: " + data.blocker);
    if (data.next_period_plan) lines.push("Next: " + data.next_period_plan);
    return lines.filter(function (line, index) { return line || index === 2; }).join("\n");
  }

  return { parseReport, whatsappMessage, normalizeLabel };
});
