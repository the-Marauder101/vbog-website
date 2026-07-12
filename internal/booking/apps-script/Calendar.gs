/**
 * Calendar.gs — Reading busy intervals across ALL accounts, and creating the
 * booking event on Account 1's calendar.
 *
 * Busy reading uses the Advanced Calendar service (Calendar.Freebusy.query):
 *  - one API call covers every calendar,
 *  - it respects event transparency (events marked "Free" don't block slots,
 *    all-day birthday/holiday markers don't wipe out whole days),
 *  - it works for calendars that were merely SHARED with Account 1
 *    (free/busy permission is enough — no OAuth, no subscribing needed).
 * The service is enabled by the appsscript.json manifest in this folder.
 */

/**
 * Returns merged busy intervals [{start:ms, end:ms}, ...] across the given
 * calendar IDs between two Date instants.
 * Throws CALENDAR_ERROR if any calendar can't be read (fail closed: better to
 * show an error than to offer slots that might double-book).
 */
function getBusyIntervals(calendarIds, startDate, endDate) {
  var response;
  try {
    response = Calendar.Freebusy.query({
      timeMin: startDate.toISOString(),
      timeMax: endDate.toISOString(),
      items: calendarIds.map(function (id) { return { id: id }; })
    });
  } catch (e) {
    console.error('Freebusy query failed: ' + e);
    throw tagged_('CALENDAR_ERROR', 'Could not read calendars.');
  }

  var intervals = [];
  for (var i = 0; i < calendarIds.length; i++) {
    var cal = response.calendars && response.calendars[calendarIds[i]];
    if (!cal) continue;
    // A per-calendar error means it isn't shared with this account (yet).
    if (cal.errors && cal.errors.length) {
      console.error('Calendar "' + calendarIds[i] + '" unreadable: ' +
        JSON.stringify(cal.errors) +
        ' — is it shared with this account? (see docs/ADDING-ACCOUNT.md)');
      throw tagged_('CALENDAR_ERROR', 'One of the calendars could not be read.');
    }
    (cal.busy || []).forEach(function (b) {
      intervals.push({ start: Date.parse(b.start), end: Date.parse(b.end) });
    });
  }
  return mergeIntervals_(intervals);
}

/**
 * Sorts intervals by start and merges overlapping/adjacent ones. Deduplicates
 * the same meeting mirrored on several calendars and makes the per-slot
 * overlap test simpler.
 */
function mergeIntervals_(intervals) {
  if (intervals.length < 2) return intervals;
  intervals.sort(function (a, b) { return a.start - b.start; });
  var merged = [intervals[0]];
  for (var i = 1; i < intervals.length; i++) {
    var last = merged[merged.length - 1];
    if (intervals[i].start <= last.end) {
      last.end = Math.max(last.end, intervals[i].end); // overlap → extend
    } else {
      merged.push(intervals[i]);
    }
  }
  return merged;
}

/**
 * Creates the meeting on Account 1's default calendar with the booker added
 * as a guest (they get a Google Calendar invite on top of our branded
 * confirmation email). Returns the calendar event ID for the bookings log.
 */
function createCalendarEvent(client, booking, startDate, endDate) {
  var title = 'Meeting — ' + booking.booker_name + ' (' + client.client_name + ')';
  var description =
    'Booked via v-bog.com/book/' + client.slug + '\n' +
    'Booking ID: ' + booking.booking_id + '\n' +
    'Name: ' + booking.booker_name + '\n' +
    'Email: ' + booking.booker_email + '\n' +
    (booking.booker_phone ? 'Phone: ' + booking.booker_phone + '\n' : '');

  var event = CalendarApp.getDefaultCalendar().createEvent(
    title, startDate, endDate,
    { guests: booking.booker_email, sendInvites: true, description: description }
  );
  return event.getId();
}
