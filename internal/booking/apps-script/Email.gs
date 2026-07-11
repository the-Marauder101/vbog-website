/**
 * Email.gs — Confirmation email (instant) and reminder email (~24h before),
 * both sent from Account 1 via MailApp. No third-party email service.
 *
 * sendPendingReminders() is the hourly trigger target installed by
 * initialSetup(). It is idempotent: reminder_sent is checked before and set
 * immediately after each send, so re-runs never duplicate emails.
 */

var DAY_LONG_ = { Sun: 'Sunday', Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday',
  Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday' };
var MONTHS_ = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

/** '2026-07-15' → 'Wednesday, 15 July 2026' (timezone-independent). */
function formatDateLong_(dateStr) {
  var p = dateStr.split('-');
  return DAY_LONG_[weekdayOfDateStr(dateStr)] + ', ' +
    Number(p[2]) + ' ' + MONTHS_[Number(p[1]) - 1] + ' ' + Number(p[0]);
}

/** '14:30' → '2:30 PM'. */
function formatTime12h_(hm) {
  var p = hm.split(':');
  var h = Number(p[0]);
  var suffix = h >= 12 ? 'PM' : 'AM';
  var h12 = h % 12 === 0 ? 12 : h % 12;
  return h12 + ':' + p[1] + ' ' + suffix;
}

/**
 * One branded HTML template for both email kinds. Inline CSS only, no remote
 * images (best deliverability). kind: 'confirmation' | 'reminder'.
 */
function buildEmailHtml_(kind, booking, client) {
  var isReminder = kind === 'reminder';
  var heading = isReminder ? 'Your meeting is tomorrow' : 'Your meeting is confirmed';
  var intro = isReminder
    ? 'just a reminder that you have a meeting coming up.'
    : 'your meeting is confirmed. The details are below, and a calendar invite is on its way.';
  var notes = !isReminder && client && client.notes_for_client
    ? '<p style="margin:16px 0 0;padding:12px 16px;background:#fff7f2;border-left:3px solid #ff4d00;color:#333;">' +
      escapeHtml_(client.notes_for_client) + '</p>'
    : '';
  var footerNote = isReminder ? '' :
    '<p style="margin:16px 0 0;color:#666;">You’ll also receive a reminder 24 hours before the meeting.</p>';

  var row = function (label, value) {
    return '<tr>' +
      '<td style="padding:6px 16px 6px 0;color:#666;white-space:nowrap;">' + label + '</td>' +
      '<td style="padding:6px 0;color:#0a0a0a;font-weight:600;">' + value + '</td></tr>';
  };

  return '' +
    '<div style="background:#f8f5ee;padding:32px 16px;font-family:Arial,Helvetica,sans-serif;">' +
    '<div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;">' +
    '<div style="height:4px;background:#ff4d00;"></div>' +
    '<div style="padding:28px 28px 32px;">' +
    '<p style="margin:0 0 20px;font-size:18px;font-weight:800;color:#0a0a0a;">Depesh Vyas.</p>' +
    '<h1 style="margin:0 0 8px;font-size:22px;color:#0a0a0a;">' + heading + '</h1>' +
    '<p style="margin:0 0 20px;color:#333;">Hi ' + escapeHtml_(booking.booker_name) + ', ' + intro + '</p>' +
    '<table style="border-collapse:collapse;font-size:15px;">' +
    row('Date', formatDateLong_(booking.booking_date)) +
    row('Time', formatTime12h_(booking.booking_time) + ' (' + escapeHtml_(booking.timezone_display || '') + ')') +
    row('Duration', booking.duration_mins + ' minutes') +
    row('With', escapeHtml_(FROM_NAME) + ', VBOG') +
    '</table>' +
    notes + footerNote +
    '<p style="margin:28px 0 0;color:#0a0a0a;">— ' + escapeHtml_(FROM_NAME) + '<br>' +
    '<span style="color:#666;">' + escapeHtml_(BRAND_LINE) + '</span></p>' +
    '</div></div></div>';
}

/** Minimal HTML escaping for user-supplied strings embedded in emails. */
function escapeHtml_(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Sent immediately after a successful booking. */
function sendConfirmationEmail(booking, client) {
  booking.timezone_display = client.timezone;
  MailApp.sendEmail({
    to: booking.booker_email,
    subject: 'Your meeting with ' + FROM_NAME + ' is confirmed — ' +
      formatDateLong_(booking.booking_date) + ' at ' + formatTime12h_(booking.booking_time),
    htmlBody: buildEmailHtml_('confirmation', booking, client),
    name: FROM_NAME
  });
}

/** Sent by the hourly trigger ~24h before the meeting. */
function sendReminderEmail(booking, client) {
  booking.timezone_display = client ? client.timezone : DEFAULT_TIMEZONE;
  MailApp.sendEmail({
    to: booking.booker_email,
    subject: 'Reminder: your meeting with ' + FROM_NAME + ' is tomorrow at ' +
      formatTime12h_(booking.booking_time),
    htmlBody: buildEmailHtml_('reminder', booking, client),
    name: FROM_NAME
  });
}

/**
 * HOURLY TRIGGER TARGET (installed by initialSetup).
 * For every booking whose reminder hasn't been sent:
 *   - if the meeting starts within the next REMINDER_HOURS_BEFORE hours → send
 *     the reminder, then immediately mark reminder_sent=TRUE
 *   - if the meeting is already in the past → mark TRUE without sending, so
 *     old rows never get scanned again (keeps this fast forever)
 *   - otherwise (still far in the future) → leave for a later run
 * Each row is processed in its own try/catch so one bad row can't block the rest.
 */
function sendPendingReminders() {
  var pending = getPendingReminders();
  if (!pending.length) return;

  // Cache client lookups (for timezone/name) — one sheet read, reused per slug.
  var clientCache = {};

  var now = Date.now();
  var windowMs = REMINDER_HOURS_BEFORE * 3600 * 1000;

  pending.forEach(function (row) {
    try {
      var dateStr = String(row.booking_date || '').trim();
      var timeStr = normalizeTime_(row.booking_time);
      if (!isValidDateStr(dateStr) || !timeStr) {
        console.warn('bookings row ' + row.__row + ': unreadable date/time, skipping');
        return;
      }

      var slug = String(row.slug || '').trim().toLowerCase();
      if (!(slug in clientCache)) clientCache[slug] = getClientBySlug(slug);
      var client = clientCache[slug];
      var tz = client ? client.timezone : DEFAULT_TIMEZONE;

      var start = wallTimeToDate(dateStr, timeStr, tz);
      if (!start) return;
      var startMs = start.getTime();

      if (startMs <= now) {
        // Meeting already happened — close the row out, never email.
        markReminderSent(row.__row);
        return;
      }
      if (startMs - now <= windowMs) {
        sendReminderEmail({
          booker_name: String(row.booker_name || '').trim(),
          booker_email: String(row.booker_email || '').trim(),
          booking_date: dateStr,
          booking_time: timeStr,
          duration_mins: String(row.duration_mins || '').trim()
        }, client);
        markReminderSent(row.__row); // set immediately → idempotent under re-runs
      }
      // else: not due yet, a later hourly run will pick it up.
    } catch (e) {
      console.error('Reminder failed for bookings row ' + row.__row + ': ' + e);
    }
  });
}
