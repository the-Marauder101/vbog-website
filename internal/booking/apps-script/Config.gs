/**
 * Config.gs — All tunable constants for the VBOG Booking System.
 *
 * This is the ONLY file you might want to tweak values in.
 * Everything else reads from here.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Spreadsheet
// ─────────────────────────────────────────────────────────────────────────────

// Leave blank. initialSetup() (in Setup.gs) creates the spreadsheet for you and
// remembers its ID automatically. Only fill this in if you already have a
// "VBOG Booking System" spreadsheet and want to force the script to use it —
// paste the long ID from its URL between the quotes.
var SHEET_ID_OVERRIDE = '';

// ─────────────────────────────────────────────────────────────────────────────
// Booking rules
// ─────────────────────────────────────────────────────────────────────────────

// How many days into the future clients are allowed to book.
var MAX_DAYS_FORWARD = 60;

// How many hours before the meeting the reminder email goes out.
// The reminder trigger runs hourly, so in practice it lands 23–24h before.
var REMINDER_HOURS_BEFORE = 24;

// Minimum notice (in minutes) required to book a slot. 0 = a client can book a
// slot that starts one minute from now. Set to e.g. 60 to require an hour's
// notice, 1440 for a full day.
var MIN_NOTICE_MINS = 0;

// ─────────────────────────────────────────────────────────────────────────────
// Identity / emails
// ─────────────────────────────────────────────────────────────────────────────

// Name shown as the email sender and in email signatures.
var FROM_NAME = 'Depesh Vyas';

// Company/brand line used in emails.
var BRAND_LINE = 'VBOG | v-bog.com';

// Fallback timezone when a client row has a missing/invalid timezone.
// Must be an IANA timezone name.
var DEFAULT_TIMEZONE = 'Asia/Kolkata';

// ─────────────────────────────────────────────────────────────────────────────
// Internals (no need to touch)
// ─────────────────────────────────────────────────────────────────────────────

// Bumped when the API code changes; returned by ?action=ping so you can check
// which version is actually deployed.
var VERSION = 1;

// Names of the three tabs in the spreadsheet.
var TAB_CLIENTS = 'clients';
var TAB_BOOKINGS = 'bookings';
var TAB_ACCOUNTS = 'accounts';

// Exact header rows for each tab. Setup.gs writes these; Sheet.gs reads by
// header name, so column ORDER can change but header TEXT must not.
var HEADERS_CLIENTS = ['slug', 'client_name', 'contact_email', 'allowed_days',
  'start_time', 'end_time', 'durations', 'active', 'timezone', 'notes_for_client',
  'buffer_mins'];
var HEADERS_BOOKINGS = ['booking_id', 'slug', 'client_name', 'booker_name',
  'booker_email', 'booker_phone', 'booking_date', 'booking_time',
  'duration_mins', 'calendar_event_id', 'created_at', 'reminder_sent',
  'booking_subject', 'extra_guests'];
var HEADERS_ACCOUNTS = ['account_id', 'email', 'is_primary', 'authorized', 'calendar_id'];

/**
 * Returns the spreadsheet ID to use: the override if set, otherwise the ID
 * stored by initialSetup(). Throws a clear error if neither exists yet.
 */
function getSheetId_() {
  if (SHEET_ID_OVERRIDE) return SHEET_ID_OVERRIDE;
  var stored = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (stored) return stored;
  throw tagged_('INTERNAL_ERROR',
    'No spreadsheet configured. Open Setup.gs and run initialSetup() once.');
}
