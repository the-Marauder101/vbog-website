/**
 * Setup.gs — Owner-runnable functions. You run these from the Apps Script
 * editor (pick the function in the toolbar dropdown, press ▶ Run):
 *
 *   initialSetup()  — run ONCE when installing. Creates the spreadsheet with
 *                     all three tabs, seeds sample data, installs the hourly
 *                     reminder trigger, and prints the Sheet URL in the log.
 *                     Safe to run again — it repairs missing tabs/triggers
 *                     and never wipes existing data.
 *
 *   auditConfig()   — run any time after editing the Sheet. Logs every
 *                     problem it can find (duplicate slugs, bad times,
 *                     unreadable calendars, …). Silence = all good.
 */

/**
 * One-time installer. Idempotent: re-running repairs, never destroys.
 */
function initialSetup() {
  // ── 1. Find or create the spreadsheet ─────────────────────────────────────
  var props = PropertiesService.getScriptProperties();
  var ss;
  var sheetId = SHEET_ID_OVERRIDE || props.getProperty('SHEET_ID');
  if (sheetId) {
    ss = SpreadsheetApp.openById(sheetId);
    console.log('Using existing spreadsheet: ' + ss.getUrl());
  } else {
    ss = SpreadsheetApp.create('VBOG Booking System');
    props.setProperty('SHEET_ID', ss.getId());
    console.log('Created spreadsheet: ' + ss.getUrl());
  }
  ss.setSpreadsheetTimeZone(DEFAULT_TIMEZONE);

  // ── 2. Build tabs (only if missing) ───────────────────────────────────────
  ensureTab_(ss, TAB_CLIENTS, HEADERS_CLIENTS);
  ensureTab_(ss, TAB_BOOKINGS, HEADERS_BOOKINGS);
  ensureTab_(ss, TAB_ACCOUNTS, HEADERS_ACCOUNTS);

  // Force time-ish columns to TEXT format so Sheets never converts "09:00"
  // into a date serial behind the owner's back.
  setColumnsToText_(ss.getSheetByName(TAB_CLIENTS), HEADERS_CLIENTS, ['start_time', 'end_time']);
  setColumnsToText_(ss.getSheetByName(TAB_BOOKINGS), HEADERS_BOOKINGS, ['booking_date', 'booking_time']);

  // Remove the default empty "Sheet1" if it's still around.
  var sheet1 = ss.getSheetByName('Sheet1');
  if (sheet1 && ss.getSheets().length > 3) ss.deleteSheet(sheet1);

  // ── 3. Seed sample rows (only when the tabs are empty) ────────────────────
  var clientsTab = ss.getSheetByName(TAB_CLIENTS);
  if (clientsTab.getLastRow() === 1) {
    clientsTab.appendRow(['test-client', 'Test Client', '', 'Mon,Tue,Wed,Thu,Fri',
      '10:00', '18:00', '30,60', 'TRUE', DEFAULT_TIMEZONE,
      'This is a test booking link.']);
    console.log('Seeded sample client: slug "test-client" (Mon–Fri, 10:00–18:00, 30/60 min).');
  }

  var accountsTab = ss.getSheetByName(TAB_ACCOUNTS);
  if (accountsTab.getLastRow() === 1) {
    var myEmail = Session.getEffectiveUser().getEmail();
    accountsTab.appendRow(['account1', myEmail, 'TRUE', 'TRUE', myEmail]);
    console.log('Seeded accounts row for ' + myEmail + ' (primary, authorized).');
  }

  // ── 4. Install the hourly reminder trigger (replacing any old ones) ───────
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendPendingReminders') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendPendingReminders').timeBased().everyHours(1).create();
  console.log('Hourly reminder trigger installed.');

  // ── 5. Next steps ─────────────────────────────────────────────────────────
  console.log('');
  console.log('SETUP COMPLETE. Next:');
  console.log('1. Deploy → New deployment → Web app (Execute as: Me, Access: Anyone).');
  console.log('2. Open <deployment URL>?action=ping in a browser → expect {"ok":true,...}');
  console.log('3. Paste the deployment URL into book/config.js in the website repo.');
  console.log('4. Sheet lives at: ' + ss.getUrl());
}

/** Creates a tab with a frozen, bold header row if it doesn't exist. */
function ensureTab_(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    console.log('Created tab: ' + name);
  }
  // (Re)write the header row so header text is always exact.
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  sheet.setFrozenRows(1);
}

/** Applies plain-text number format to the named columns (whole column). */
function setColumnsToText_(sheet, headers, columnNames) {
  columnNames.forEach(function (name) {
    var idx = headers.indexOf(name) + 1;
    if (idx > 0) sheet.getRange(1, idx, sheet.getMaxRows(), 1).setNumberFormat('@');
  });
}

/**
 * Configuration health check — run after every Sheet edit if you want peace
 * of mind. Everything it logs is a real problem; no output (beyond the final
 * line) means the config is clean.
 */
function auditConfig() {
  var issues = 0;
  var warn = function (msg) { console.warn('⚠ ' + msg); issues++; };

  // ── clients tab ───────────────────────────────────────────────────────────
  var clients = readTab_(TAB_CLIENTS);
  var seenSlugs = {};
  clients.forEach(function (row) {
    var where = 'clients row ' + row.__row;
    var slug = sanitizeSlug(String(row.slug || ''));
    if (!slug) { warn(where + ': slug "' + row.slug + '" is not valid (lowercase letters/digits/hyphens only)'); return; }
    if (seenSlugs[slug]) warn(where + ': duplicate slug "' + slug + '" — row ' + seenSlugs[slug] + ' will always win');
    else seenSlugs[slug] = row.__row;

    var c = normalizeClient_(row);
    if (!c.client_name) warn(where + ': client_name is empty');
    if (!c.allowed_days.length) warn(where + ': no valid allowed_days (use Mon,Tue,Wed,Thu,Fri,Sat,Sun)');
    if (!c.durations.length) warn(where + ': no valid durations (e.g. "30,60")');
    if (!c.start_time) warn(where + ': start_time unreadable (use HH:MM, e.g. 10:00)');
    if (!c.end_time) warn(where + ': end_time unreadable (use HH:MM, e.g. 17:00)');
    if (c.start_time && c.end_time && hmToMinutes(c.start_time) >= hmToMinutes(c.end_time)) {
      warn(where + ': start_time is not before end_time — this client will show no slots');
    }
    if (String(row.timezone || '').trim() && !isValidTimezone(String(row.timezone).trim())) {
      warn(where + ': timezone "' + row.timezone + '" invalid, falling back to ' + DEFAULT_TIMEZONE);
    }
  });

  // ── accounts tab ──────────────────────────────────────────────────────────
  var accounts = readTab_(TAB_ACCOUNTS);
  var primaries = accounts.filter(function (r) { return truthy_(r.is_primary); });
  if (primaries.length !== 1) warn('accounts: exactly one row should have is_primary=TRUE (found ' + primaries.length + ')');

  var authorized = accounts.filter(function (r) { return truthy_(r.authorized); });
  if (!authorized.length) warn('accounts: no authorized calendars — all availability checks will fail');

  // Probe each authorized calendar with a real freebusy call so sharing
  // problems surface HERE, not when a client is mid-booking.
  authorized.forEach(function (r) {
    var id = String(r.calendar_id || '').trim() || String(r.email || '').trim();
    if (id.toLowerCase() === 'primary') id = Session.getEffectiveUser().getEmail();
    try {
      var now = new Date();
      var resp = Calendar.Freebusy.query({
        timeMin: now.toISOString(),
        timeMax: new Date(now.getTime() + 3600000).toISOString(),
        items: [{ id: id }]
      });
      var cal = resp.calendars && resp.calendars[id];
      if (cal && cal.errors && cal.errors.length) {
        warn('accounts row ' + r.__row + ': calendar "' + id + '" NOT readable — share it with this account first (docs/ADDING-ACCOUNT.md), or set authorized=FALSE');
      } else {
        console.log('✓ calendar "' + id + '" readable');
      }
    } catch (e) {
      warn('accounts row ' + r.__row + ': freebusy probe failed for "' + id + '": ' + e);
    }
  });

  console.log(issues === 0 ? '✓ auditConfig: no problems found.' : 'auditConfig: ' + issues + ' problem(s) above.');
}
