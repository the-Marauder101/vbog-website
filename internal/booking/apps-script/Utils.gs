/**
 * Utils.gs — Date/time helpers, validators, and the tagged-error pattern.
 *
 * TIMEZONE RULE for this whole project: never trust the server's local
 * timezone. All wall-clock ("what the client sees") arithmetic happens in the
 * client's IANA timezone via Utilities.formatDate, and all comparisons happen
 * on real epoch-millisecond instants.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Tagged errors — thrown deep in the code, mapped to API error codes in Code.gs
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates an Error carrying a machine-readable code (e.g. 'SLOT_TAKEN') so the
 * doGet/doPost catch-blocks can build the right JSON error envelope.
 */
function tagged_(code, message) {
  var err = new Error(message || code);
  err.code = code;
  return err;
}

// ─────────────────────────────────────────────────────────────────────────────
// Timezone-aware date/time conversion
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Converts a wall-clock time in a given timezone to a real Date instant.
 * e.g. wallTimeToDate('2026-07-15', '10:00', 'Asia/Kolkata')
 *      → the Date at 2026-07-15T10:00 IST (04:30 UTC).
 *
 * Two-pass algorithm: guess the instant as if the wall time were UTC, look at
 * what wall time that instant actually shows in the target timezone, then
 * shift by the difference. A second pass handles the rare case where the
 * shift itself crosses a DST boundary.
 *
 * Returns null if the wall time does not exist in that timezone (the skipped
 * hour on a DST spring-forward day) — callers should drop such slots.
 */
function wallTimeToDate(dateStr, hm, tz) {
  var wanted = Date.parse(dateStr + 'T' + hm + ':00Z'); // wall time read as UTC
  if (isNaN(wanted)) return null;
  var guess = new Date(wanted);
  for (var i = 0; i < 2; i++) {
    // What wall time does our current guess actually display in tz?
    var seen = Utilities.formatDate(guess, tz, "yyyy-MM-dd'T'HH:mm:ss");
    var diff = wanted - Date.parse(seen + 'Z');
    if (diff === 0) return guess;
    guess = new Date(guess.getTime() + diff);
  }
  // Still not matching after two corrections → the wall time doesn't exist.
  return null;
}

/**
 * Today's date as 'YYYY-MM-DD' in the given timezone (NOT the server's).
 */
function todayStrInTz(tz) {
  return Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
}

/**
 * Adds n days to a 'YYYY-MM-DD' string using pure UTC component math, so the
 * result never depends on any timezone or DST. Returns 'YYYY-MM-DD'.
 */
function addDaysToDateStr(dateStr, n) {
  var p = dateStr.split('-');
  var d = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]) + n));
  return Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd');
}

/**
 * Weekday name ('Sun'..'Sat') of a 'YYYY-MM-DD' string, timezone-independent.
 */
function weekdayOfDateStr(dateStr) {
  var p = dateStr.split('-');
  var d = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])));
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()];
}

/** 'HH:MM' → minutes since midnight. Assumes already-validated input. */
function hmToMinutes(hm) {
  var p = hm.split(':');
  return Number(p[0]) * 60 + Number(p[1]);
}

/** Minutes since midnight → 'HH:MM' (zero-padded). */
function minutesToHm(mins) {
  var h = Math.floor(mins / 60);
  var m = mins % 60;
  return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
}

// ─────────────────────────────────────────────────────────────────────────────
// Validators
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pragmatic email check: something@something.tld, no spaces. Deliberately not
 * RFC-complete — good enough to catch typos without rejecting real addresses.
 */
function isValidEmail(s) {
  return typeof s === 'string' && s.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);
}

/**
 * Normalizes a slug (trim + lowercase) and returns it, or null if it isn't
 * slug-shaped. Slugs are lowercase letters/digits/hyphens, max 64 chars.
 */
function sanitizeSlug(s) {
  if (typeof s !== 'string') return null;
  var slug = s.trim().toLowerCase();
  return /^[a-z0-9-]{1,64}$/.test(slug) ? slug : null;
}

/**
 * True if s is a real calendar date in 'YYYY-MM-DD' form (rejects 2026-02-31).
 */
function isValidDateStr(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  var p = s.split('-');
  var d = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])));
  // Round-trip: if the components changed, the input was an impossible date.
  return Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd') === s;
}

/** True if s looks like 'HH:MM' 24-hour. */
function isValidHm(s) {
  return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

/**
 * True if tz is a usable IANA timezone name. The V8 runtime's Intl throws on
 * invalid names, which is the most reliable check available in Apps Script.
 */
function isValidTimezone(tz) {
  if (typeof tz !== 'string' || !tz) return false;
  try {
    // V8 runtime: Intl throws on invalid IANA names — the most reliable check.
    Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch (e) {
    return false;
  }
}
