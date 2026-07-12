/**
 * Code.gs — Web app entry points. Routes every request by its `action`
 * parameter, converts tagged errors into the JSON error envelope, and never
 * lets an exception escape as an HTML error page.
 *
 * API envelope (every response, always JSON):
 *   success: { "ok": true,  "data": { ... } }
 *   failure: { "ok": false, "error": "CODE", "message": "human text" }
 *
 * CORS note: Apps Script cannot set CORS headers or answer OPTIONS preflight.
 * GET responses work cross-origin as-is. The frontend therefore sends POSTs
 * as "simple requests" (Content-Type text/plain, no custom headers) and this
 * file parses the JSON body manually from e.postData.contents.
 */

/** Wraps any object as a JSON text response. */
function jsonOut_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Success envelope. */
function okOut_(data) {
  return jsonOut_({ ok: true, data: data });
}

/** Error envelope. */
function errOut_(code, message) {
  return jsonOut_({ ok: false, error: code, message: message || code });
}

/** Maps a caught exception to an error response, logging unexpected ones. */
function errorToResponse_(e) {
  if (e && e.code) return errOut_(e.code, e.message);
  console.error('Unhandled error: ' + (e && e.stack ? e.stack : e));
  return errOut_('INTERNAL_ERROR', 'Something went wrong. Please try again.');
}

/**
 * GET router.
 *   ?action=ping                      → deployment smoke test
 *   ?action=getClient&slug=…          → public client config
 *   ?action=getSlots&slug=…&date=…&duration=… → open slots
 */
function doGet(e) {
  try {
    var params = (e && e.parameter) || {};
    switch (params.action) {
      case 'ping':
        return okOut_({ status: 'ok', version: VERSION, time: new Date().toISOString() });
      case 'getClient':
        return okOut_(handleGetClient(params));
      case 'getSlots':
        return okOut_(handleGetSlots(params));
      default:
        return errOut_('BAD_REQUEST', 'Unknown or missing action.');
    }
  } catch (err) {
    return errorToResponse_(err);
  }
}

/**
 * POST router. Body must be a JSON string (sent as text/plain — see CORS note).
 *   { "action": "createBooking", ... } → book a slot
 */
function doPost(e) {
  try {
    var raw = e && e.postData && e.postData.contents;
    if (!raw || raw.length > 4096) {
      return errOut_('BAD_REQUEST', 'Missing or oversized request body.');
    }
    var body;
    try {
      body = JSON.parse(raw);
    } catch (parseErr) {
      return errOut_('BAD_REQUEST', 'Body is not valid JSON.');
    }
    if (!body || typeof body !== 'object') {
      return errOut_('BAD_REQUEST', 'Body must be a JSON object.');
    }

    var action = body.action || (e.parameter && e.parameter.action);
    switch (action) {
      case 'createBooking':
        return okOut_(handleCreateBooking(body));
      default:
        return errOut_('BAD_REQUEST', 'Unknown or missing action.');
    }
  } catch (err) {
    return errorToResponse_(err);
  }
}
