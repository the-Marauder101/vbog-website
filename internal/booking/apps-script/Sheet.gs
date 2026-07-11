/**
 * Sheet.gs — Every read/write against the Google Sheet lives here.
 * No other file touches SpreadsheetApp (except Setup.gs, which builds tabs).
 *
 * Reads are defensive: values are trimmed, booleans accept TRUE/true/1,
 * times accept text or accidental Date cells, and rows are keyed by header
 * name so reordering columns in the Sheet never breaks the code.
 */

/** Opens the configured spreadsheet. */
function getSpreadsheet_() {
  return SpreadsheetApp.openById(getSheetId_());
}

/**
 * Reads a whole tab and returns an array of row objects keyed by header name,
 * with every cell coerced to a trimmed string (Dates are kept as Dates so
 * normalizeTime_ can recover the wall time as typed).
 * Also records the 1-based sheet row number on each object as __row.
 */
function readTab_(name) {
  var sheet = getSpreadsheet_().getSheetByName(name);
  if (!sheet) throw tagged_('INTERNAL_ERROR', 'Missing tab "' + name + '" — run initialSetup().');
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  var headers = values[0].map(function (h) { return String(h).trim(); });
  var rows = [];
  for (var r = 1; r < values.length; r++) {
    var obj = { __row: r + 1 };
    var empty = true;
    for (var c = 0; c < headers.length; c++) {
      var v = values[r][c];
      if (v instanceof Date) {
        obj[headers[c]] = v; // let time-aware code decide how to format
      } else {
        obj[headers[c]] = String(v).trim();
      }
      if (obj[headers[c]] !== '' && obj[headers[c]] != null) empty = false;
    }
    if (!empty) rows.push(obj);
  }
  return rows;
}

/** Loose boolean: TRUE / true / 'TRUE ' / 1 / 'yes' all count as true. */
function truthy_(v) {
  var s = String(v).trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes';
}

/**
 * Accepts a time cell that is either text ('9:00' / '09:00') or a Date (Sheets
 * auto-converted it) and returns canonical 'HH:MM', or null if unusable.
 * For Date cells we format in the SPREADSHEET's timezone, which is how the
 * value was typed by the owner.
 */
function normalizeTime_(v) {
  if (v instanceof Date) {
    var tz = getSpreadsheet_().getSpreadsheetTimeZone();
    return Utilities.formatDate(v, tz, 'HH:mm');
  }
  var s = String(v).trim();
  var m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  var h = Number(m[1]), min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return (h < 10 ? '0' : '') + h + ':' + m[2];
}

var CANONICAL_DAYS_ = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * Turns a raw clients row into a clean, validated client object:
 *   { slug, client_name, contact_email, allowed_days:['Mon',..],
 *     start_time:'HH:MM', end_time:'HH:MM', durations:[30,60],
 *     active:bool, timezone, notes_for_client }
 * Bad fragments are dropped (and logged) rather than crashing the request.
 */
function normalizeClient_(row) {
  var client = {
    slug: String(row.slug || '').trim().toLowerCase(),
    client_name: String(row.client_name || '').trim(),
    contact_email: String(row.contact_email || '').trim(),
    active: truthy_(row.active),
    notes_for_client: String(row.notes_for_client || '').trim()
  };

  // allowed_days: 'Mon, tue ,WED' → ['Mon','Tue','Wed']; unknown tokens dropped.
  client.allowed_days = String(row.allowed_days || '').split(',')
    .map(function (d) {
      var t = d.trim().toLowerCase();
      for (var i = 0; i < CANONICAL_DAYS_.length; i++) {
        if (CANONICAL_DAYS_[i].toLowerCase() === t) return CANONICAL_DAYS_[i];
      }
      if (t) console.warn('clients row ' + row.__row + ': unknown day "' + d + '" ignored');
      return null;
    })
    .filter(function (d) { return d; });

  // durations: '30, 60' → [30, 60]; non-positive/non-numeric dropped.
  client.durations = String(row.durations || '').split(',')
    .map(function (n) { return parseInt(n.trim(), 10); })
    .filter(function (n) {
      if (n > 0 && n <= 24 * 60) return true;
      return false;
    });

  client.start_time = normalizeTime_(row.start_time);
  client.end_time = normalizeTime_(row.end_time);

  // Timezone: fall back to the default rather than failing the whole client.
  var tz = String(row.timezone || '').trim();
  if (!isValidTimezone(tz)) {
    if (tz) console.warn('clients row ' + row.__row + ': invalid timezone "' + tz + '", using ' + DEFAULT_TIMEZONE);
    tz = DEFAULT_TIMEZONE;
  }
  client.timezone = tz;

  return client;
}

/**
 * Finds an ACTIVE client by slug (case-insensitive, trimmed).
 * First matching row wins if there are duplicates (auditConfig flags those).
 * Returns the normalized client object, or null if not found / inactive —
 * callers treat both identically (CLIENT_NOT_FOUND) so booking links never
 * reveal whether a slug exists.
 */
function getClientBySlug(slug) {
  var rows = readTab_(TAB_CLIENTS);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].slug || '').trim().toLowerCase() === slug) {
      var client = normalizeClient_(rows[i]);
      return client.active ? client : null;
    }
  }
  return null;
}

/**
 * Calendar IDs to include in busy checks: accounts rows with authorized=TRUE.
 * calendar_id falls back to the email column. 'primary' maps to the calendar
 * of the account running the script (Account 1).
 * FAIL-CLOSED: rows with authorized=FALSE are excluded entirely, so a calendar
 * is never half-configured into showing wrong availability.
 */
function getAuthorizedCalendarIds() {
  var rows = readTab_(TAB_ACCOUNTS);
  var ids = [];
  for (var i = 0; i < rows.length; i++) {
    if (!truthy_(rows[i].authorized)) continue;
    var id = String(rows[i].calendar_id || '').trim() || String(rows[i].email || '').trim();
    if (!id) continue;
    if (id.toLowerCase() === 'primary') id = Session.getEffectiveUser().getEmail();
    ids.push(id);
  }
  if (ids.length === 0) {
    throw tagged_('CALENDAR_ERROR',
      'No authorized calendars in the accounts tab — bookings are paused until at least one row has authorized=TRUE.');
  }
  return ids;
}

/**
 * Guards a value against Sheets formula injection: anything starting with
 * = + - @ gets a leading apostrophe so Sheets stores it as literal text.
 */
function sheetSafe_(v) {
  var s = String(v == null ? '' : v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

/**
 * Appends one booking to the bookings tab, in exact header order.
 * Called while holding the script lock (see Booking.gs).
 */
function appendBooking(b) {
  var sheet = getSpreadsheet_().getSheetByName(TAB_BOOKINGS);
  if (!sheet) throw tagged_('INTERNAL_ERROR', 'Missing tab "' + TAB_BOOKINGS + '"');
  sheet.appendRow(HEADERS_BOOKINGS.map(function (h) { return sheetSafe_(b[h]); }));
}

/**
 * Rows from the bookings tab that have not had their reminder sent yet.
 * Returns raw row objects (with __row) — Email.gs decides who is actually due.
 */
function getPendingReminders() {
  return readTab_(TAB_BOOKINGS).filter(function (r) {
    return !truthy_(r.reminder_sent);
  });
}

/**
 * Marks reminder_sent=TRUE on a specific sheet row (1-based index carried on
 * the row object from readTab_). Written immediately after each send so a
 * crash mid-run cannot cause duplicate reminders for already-notified rows.
 */
function markReminderSent(rowIndex) {
  var sheet = getSpreadsheet_().getSheetByName(TAB_BOOKINGS);
  var col = HEADERS_BOOKINGS.indexOf('reminder_sent') + 1;
  sheet.getRange(rowIndex, col).setValue('TRUE');
}
