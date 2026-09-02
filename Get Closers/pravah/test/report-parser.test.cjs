const assert = require("node:assert/strict");
const { parseReport, whatsappMessage } = require("../js/report-parser.js");

const result = parseReport([
  "Closer Name: Aisha",
  "Company - Acme",
  "Calls made: 47",
  "Connected: 19",
  "Positive leads: 5",
  "Closed: 2",
  "Revenue: ₹1,50,000",
  "Cash: 80000",
  "Blocker: Need better leads"
].join("\n"));

assert.equal(result.valid, true);
assert.equal(result.data.closer_name, "Aisha");
assert.equal(result.data.client_name, "Acme");
assert.equal(result.data.calls_attempted, 47);
assert.equal(result.data.qualified_opportunities, 5);
assert.equal(result.data.sales_count, 2);
assert.equal(result.data.revenue_generated, 150000);
assert.equal(result.data.cash_collected, 80000);

const message = whatsappMessage(result.data);
assert.match(message, /Closer Update — Aisha/);
assert.match(message, /Sales: 2/);
assert.match(message, /Cash reported: 80,000 \(unverified\)/);

const invalid = parseReport("hello world");
assert.equal(invalid.valid, false);
assert.equal(invalid.recognized, 0);

console.log("report-parser: all tests passed");
