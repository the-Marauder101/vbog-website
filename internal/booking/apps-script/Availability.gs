/**
 * Availability.gs — The core algorithm: which slots are open for a client on
 * a date? Used by BOTH the getSlots endpoint and createBooking's server-side
 * revalidation, so the preview and the commit can never disagree.
 */

/**
 * Validates the date param against the client's rules. Throws tagged errors:
 *   BAD_REQUEST        — not a real YYYY-MM-DD date
 *   DATE_OUT_OF_RANGE  — before today or beyond MAX_DAYS_FORWARD (both
 *                        evaluated in the CLIENT's timezone, not the server's)
 *   DAY_NOT_AVAILABLE  — a real date but not one of the client's allowed days
 */
function validateDateParam_(client, dateStr) {
  if (!isValidDateStr(dateStr)) throw tagged_('BAD_REQUEST', 'Invalid date.');
  var today = todayStrInTz(client.timezone);
  var max = addDaysToDateStr(today, MAX_DAYS_FORWARD);
  // ISO date strings compare correctly as plain strings.
  if (dateStr < today || dateStr > max) {
    throw tagged_('DATE_OUT_OF_RANGE', 'That date is not open for booking.');
  }
  if (client.allowed_days.indexOf(weekdayOfDateStr(dateStr)) === -1) {
    throw tagged_('DAY_NOT_AVAILABLE', 'No availability on that day of the week.');
  }
}

/**
 * Computes the open slots for a client/date/duration.
 * Returns an array of 'HH:MM' start times (wall clock, client timezone),
 * already sorted. Throws the tagged errors from validateDateParam_ plus
 * CALENDAR_ERROR if any calendar is unreadable.
 *
 * A client can have SEVERAL availability windows (one per Sheet row sharing
 * the slug — e.g. 10:00–12:00 every weekday plus 15:00–17:00 on Mon/Wed).
 *
 * Steps:
 *  1. validate the date (range + weekday must match at least one window)
 *  2. generate candidates from every window that covers this weekday:
 *     start_time stepping by duration while the whole slot fits before that
 *     window's end_time (remainders naturally dropped); dedupe across windows
 *  3. fetch busy intervals across ALL authorized calendars for the whole day
 *     (client-tz midnight to next midnight, so odd-length DST days are covered)
 *  4. drop candidates that are in the past (or inside MIN_NOTICE_MINS),
 *     nonexistent due to DST, or overlapping any busy interval
 */
function computeSlots(client, dateStr, duration) {
  validateDateParam_(client, dateStr);

  var weekday = weekdayOfDateStr(dateStr);
  var windows = client.windows.filter(function (w) {
    return w.days.indexOf(weekday) !== -1;
  });
  if (!windows.length) return []; // defensive; validateDateParam_ already gates this

  // Candidate start times from every applicable window, deduped and sorted
  // ('HH:MM' strings are zero-padded, so plain string sort is chronological).
  var seen = {};
  var candidates = [];
  windows.forEach(function (w) {
    var endMin = hmToMinutes(w.end_time);
    for (var m = hmToMinutes(w.start_time); m + duration <= endMin; m += duration) {
      var hm = minutesToHm(m);
      if (!seen[hm]) { seen[hm] = true; candidates.push(hm); }
    }
  });
  candidates.sort();
  if (!candidates.length) return [];

  var tz = client.timezone;
  var dayStart = wallTimeToDate(dateStr, '00:00', tz);
  var nextDay = addDaysToDateStr(dateStr, 1);
  var dayEnd = wallTimeToDate(nextDay, '00:00', tz);
  if (!dayStart || !dayEnd) return []; // midnight itself skipped by DST — vanishingly rare

  var busy = getBusyIntervals(getAuthorizedCalendarIds(), dayStart, dayEnd);
  var earliestAllowed = Date.now() + MIN_NOTICE_MINS * 60000;

  return candidates.filter(function (hm) {
    var slotStart = wallTimeToDate(dateStr, hm, tz);
    if (!slotStart) return false; // wall time skipped by DST spring-forward
    var startMs = slotStart.getTime();
    var endMs = startMs + duration * 60000;

    if (startMs <= earliestAllowed) return false; // already past / too little notice

    // Strict overlap test: a meeting ending exactly at slot start (or starting
    // exactly at slot end) does NOT block — back-to-back bookings are allowed.
    return !busy.some(function (b) {
      return startMs < b.end && endMs > b.start;
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// GET handlers (called from Code.gs routing)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ?action=getClient&slug=x
 * Public config the booking page needs to render. Never exposes contact_email
 * or the raw daily window.
 */
function handleGetClient(params) {
  var slug = sanitizeSlug(params.slug);
  if (!slug) throw tagged_('BAD_REQUEST', 'Missing or malformed slug.');
  var client = getClientBySlug(slug);
  if (!client) throw tagged_('CLIENT_NOT_FOUND', 'This booking link is not active.');
  return {
    slug: client.slug,
    client_name: client.client_name,
    timezone: client.timezone,
    durations: client.durations,
    allowed_days: client.allowed_days,
    notes_for_client: client.notes_for_client,
    max_days_forward: MAX_DAYS_FORWARD
  };
}

/**
 * ?action=getSlots&slug=x&date=YYYY-MM-DD&duration=N
 * The duration must be one of THAT CLIENT's configured durations — the number
 * itself is never trusted.
 */
function handleGetSlots(params) {
  var slug = sanitizeSlug(params.slug);
  if (!slug) throw tagged_('BAD_REQUEST', 'Missing or malformed slug.');
  var client = getClientBySlug(slug);
  if (!client) throw tagged_('CLIENT_NOT_FOUND', 'This booking link is not active.');

  var duration = parseInt(params.duration, 10);
  if (client.durations.indexOf(duration) === -1) {
    throw tagged_('INVALID_DURATION', 'That meeting length is not offered.');
  }

  var slots = computeSlots(client, String(params.date || ''), duration);
  return {
    date: params.date,
    duration: duration,
    timezone: client.timezone,
    slots: slots
  };
}
