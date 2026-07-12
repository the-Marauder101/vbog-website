/**
 * Booking.gs — createBooking: validate → lock → revalidate availability →
 * create calendar event → log to sheet → (outside lock) send confirmation.
 *
 * The script lock serializes concurrent bookings so two people who both saw
 * "10:00 free" cannot both get it: the second one revalidates inside the lock,
 * finds the slot gone, and receives SLOT_TAKEN.
 */

/**
 * Validates and normalizes the POSTed booking payload.
 * Returns { slug, date, time, duration, booker_name, booker_email, booker_phone }
 * or throws VALIDATION_ERROR / BAD_REQUEST with a human-readable message.
 */
function validateBookingPayload_(body) {
  var problems = [];

  var slug = sanitizeSlug(body.slug);
  if (!slug) throw tagged_('BAD_REQUEST', 'Missing or malformed slug.');

  var date = String(body.date || '').trim();
  if (!isValidDateStr(date)) throw tagged_('BAD_REQUEST', 'Invalid date.');

  var time = String(body.time || '').trim();
  if (!isValidHm(time)) throw tagged_('BAD_REQUEST', 'Invalid time.');

  var duration = parseInt(body.duration, 10);
  if (!(duration > 0)) throw tagged_('BAD_REQUEST', 'Invalid duration.');

  var name = String(body.booker_name || '').trim();
  if (name.length < 1 || name.length > 100) problems.push('name');

  var email = String(body.booker_email || '').trim();
  if (!isValidEmail(email)) problems.push('email');

  var phone = String(body.booker_phone || '').trim();
  if (phone && !(phone.length <= 30 && /^[+0-9 ()\-]+$/.test(phone))) problems.push('phone');

  if (problems.length) {
    throw tagged_('VALIDATION_ERROR', 'Please check: ' + problems.join(', ') + '.');
  }

  return {
    slug: slug, date: date, time: time, duration: duration,
    booker_name: name, booker_email: email, booker_phone: phone
  };
}

/**
 * POST {action:'createBooking', ...} handler. Returns the success data object.
 */
function handleCreateBooking(body) {
  var p = validateBookingPayload_(body);

  var client = getClientBySlug(p.slug);
  if (!client) throw tagged_('CLIENT_NOT_FOUND', 'This booking link is not active.');
  if (client.durations.indexOf(p.duration) === -1) {
    throw tagged_('INVALID_DURATION', 'That meeting length is not offered.');
  }

  var booking = null;

  // Serialize the check-then-book critical section across ALL simultaneous
  // requests to this web app. 20s wait is generous; if the lock can't be had,
  // tell the client to retry rather than risking a double booking.
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) {
    throw tagged_('BUSY', 'The system is busy — please try again in a moment.');
  }
  try {
    // Full availability recomputation INSIDE the lock — never trust the
    // slot the browser claims is free.
    var openSlots = computeSlots(client, p.date, p.duration);
    if (openSlots.indexOf(p.time) === -1) {
      throw tagged_('SLOT_TAKEN', 'This slot was just booked. Please pick another.');
    }

    var startDate = wallTimeToDate(p.date, p.time, client.timezone);
    var endDate = new Date(startDate.getTime() + p.duration * 60000);

    booking = {
      booking_id: Utilities.getUuid(),
      slug: client.slug,
      client_name: client.client_name,
      booker_name: p.booker_name,
      booker_email: p.booker_email,
      booker_phone: p.booker_phone,
      booking_date: p.date,
      booking_time: p.time,
      duration_mins: p.duration,
      calendar_event_id: '',
      created_at: new Date().toISOString(),
      reminder_sent: ''
    };

    booking.calendar_event_id = createCalendarEvent(client, booking, startDate, endDate);
    appendBooking(booking);
  } finally {
    lock.releaseLock();
  }

  // Email OUTSIDE the lock (slow I/O shouldn't block other bookings), and a
  // mail failure must never fail an already-confirmed booking.
  try {
    sendConfirmationEmail(booking, client);
  } catch (e) {
    console.error('Confirmation email failed for ' + booking.booking_id + ': ' + e);
  }

  return {
    booking_id: booking.booking_id,
    client_name: client.client_name,
    date: p.date,
    time: p.time,
    duration: p.duration,
    timezone: client.timezone
  };
}
