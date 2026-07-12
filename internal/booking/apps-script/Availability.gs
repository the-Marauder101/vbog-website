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
 * Steps:
 *  1. validate the date (range + allowed weekday)
 *  2. sanity-check the daily window (start < end) — misconfigured rows just
 *     return no slots instead of crashing
 *  3. fetch busy intervals across ALL authorized calendars for the whole day
 *     (client-tz midnight to next midnight, so odd-length DST days are covered)
 *  4. generate candidates from start_time stepping by duration while the whole
 *     slot still fits before end_time (remainders are naturally dropped)
 *  5. drop candidates that are in the past (or inside MIN_NOTICE_MINS),
 *     nonexistent due to DST, or overlapping any busy interval
 */
function computeSlots(client, dateStr, duration) {
  validateDateParam_(client, dateStr);

  if (!client.start_time || !client.end_time) return [];
  var startMin = hmToMinutes(client.start_time);
  var endMin = hmToMinutes(client.end_time);
  if (startMin >= endMin) return [];

  var tz = client.timezone;
  var dayStart = wallTimeToDate(dateStr, '00:00', tz);
  var nextDay = addDaysToDateStr(dateStr, 1);
  var dayEnd = wallTimeToDate(nextDay, '00:00', tz);
  if (!dayStart || !dayEnd) return []; // midnight itself skipped by DST — vanishingly rare

  var busy = getBusyIntervals(getAuthorizedCalendarIds(), dayStart, dayEnd);
  var earliestAllowed = Date.now() + MIN_NOTICE_MINS * 60000;

  var open = [];
  for (var m = startMin; m + duration <= endMin; m += duration) {
    var hm = minutesToHm(m);
    var slotStart = wallTimeToDate(dateStr, hm, tz);
    if (!slotStart) continue; // wall time skipped by DST spring-forward
    var startMs = slotStart.getTime();
    var endMs = startMs + duration * 60000;

    if (startMs <= earliestAllowed) continue; // already past / too little notice

    // Strict overlap test: a meeting ending exactly at slot start (or starting
    // exactly at slot end) does NOT block — back-to-back bookings are allowed.
    var blocked = busy.some(function (b) {
      return startMs < b.end && endMs > b.start;
    });
    if (!blocked) open.push(hm);
  }
  return open;
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
