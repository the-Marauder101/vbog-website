/**
 * VBOG Booking — frontend configuration.
 * This is the ONLY file you need to edit after deploying the Apps Script.
 */
window.BOOKING_CONFIG = {
  // Paste your Apps Script Web App URL here (Deploy → Web app → copy URL).
  // It must end in /exec, e.g.
  // 'https://script.google.com/macros/s/AKfycb.../exec'
  APPS_SCRIPT_URL: 'PASTE_YOUR_WEB_APP_URL_HERE',

  // true = the page fakes all API responses so you can test the booking flow
  // in a browser before the Apps Script backend exists. Use slug "test-client"
  // (i.e. /book/?c=test-client). MUST be false in production.
  MOCK_MODE: false
};
