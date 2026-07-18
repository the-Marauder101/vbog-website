/**
 * VBOG Booking — client-side wizard.
 *
 * Plain vanilla JS, no build step (matches the rest of v-bog.com).
 * Flow:  loading → (duration) → date → slots → details → done
 *         └ deadlink (bad/inactive link)   └ SLOT_TAKEN bounces back to slots
 *
 * Talks to the Apps Script Web App defined in config.js. All requests are
 * "simple requests" (no custom headers) because Apps Script cannot answer
 * CORS preflights: GETs are plain fetches, the one POST sends its JSON as
 * text/plain and the backend parses it manually.
 */
(function () {
  'use strict';

  const CFG = window.BOOKING_CONFIG || {};
  const app = document.getElementById('app');

  // ───────────────────────────────────────────────────────────────────────────
  // State
  // ───────────────────────────────────────────────────────────────────────────

  const state = {
    step: 'loading',      // loading | deadlink | error | duration | date | slots | details | done
    slug: null,
    client: null,         // getClient payload
    duration: null,       // selected minutes
    date: null,           // selected 'YYYY-MM-DD'
    calMonth: null,       // calendar view month 'YYYY-MM'
    slots: null,          // array of 'HH:MM'
    time: null,           // selected 'HH:MM'
    form: { name: '', email: '', phone: '', subject: '', guests: '' },
    fieldErrors: {},
    notice: null,         // amber banner on the current step (e.g. slot taken)
    error: null,          // { message, retry: fn } for the error screen
    submitting: false,
    booking: null         // createBooking success payload
  };

  // ───────────────────────────────────────────────────────────────────────────
  // Small helpers
  // ───────────────────────────────────────────────────────────────────────────

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];

  // 'YYYY-MM-DD' helpers — all pure component math, no timezone ambiguity.
  const parts = (d) => d.split('-').map(Number);
  const weekdayIdx = (d) => { const p = parts(d); return new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay(); };
  const addDays = (d, n) => {
    const p = parts(d);
    const dt = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n));
    return dt.toISOString().slice(0, 10);
  };
  const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-based

  // Today in the CLIENT's timezone — a visitor in another country must not be
  // able to pick a date that is already over (or not yet startable) for Depesh.
  const todayInTz = (tz) => {
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
    } catch (e) {
      return new Date().toISOString().slice(0, 10);
    }
  };

  const fmtDateLong = (d) => {
    const p = parts(d);
    return `${DAYS_LONG[weekdayIdx(d)]}, ${p[2]} ${MONTHS[p[1] - 1]} ${p[0]}`;
  };

  const fmtTime12 = (hm) => {
    const [h, m] = hm.split(':').map(Number);
    const suffix = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
  };

  // ───────────────────────────────────────────────────────────────────────────
  // API layer — cold-start tolerant, preflight-free
  // ───────────────────────────────────────────────────────────────────────────

  const TIMEOUT_MS = 30000; // Apps Script cold starts can take several seconds

  async function call(action, params, body) {
    if (CFG.MOCK_MODE) return mockApi(action, params || {}, body);

    if (!CFG.APPS_SCRIPT_URL || CFG.APPS_SCRIPT_URL.indexOf('http') !== 0) {
      return { ok: false, error: 'NOT_CONFIGURED', message: 'Booking backend URL is not configured yet.' };
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const url = CFG.APPS_SCRIPT_URL + '?' + new URLSearchParams(Object.assign({ action }, params || {}));
    // IMPORTANT: no headers object at all. Adding e.g. Content-Type:
    // application/json would trigger a CORS preflight, which Apps Script
    // cannot answer. A bare string body goes out as text/plain — the backend
    // parses it manually.
    const opts = body
      ? { method: 'POST', body: JSON.stringify(body), redirect: 'follow', signal: ctrl.signal }
      : { method: 'GET', redirect: 'follow', signal: ctrl.signal };
    try {
      const res = await fetch(url, opts);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  // GETs are safe to retry once (idempotent) — covers cold-start hiccups.
  async function apiGet(action, params) {
    try {
      return await call(action, params);
    } catch (e) {
      return call(action, params);
    }
  }

  // The booking POST is NOT retried automatically: if the request timed out we
  // genuinely don't know whether it landed, and a blind retry would just
  // surface a confusing SLOT_TAKEN. The UI explains instead.
  const apiPost = (body) => call(null, { action: body.action }, body);

  // ───────────────────────────────────────────────────────────────────────────
  // Rendering
  // ───────────────────────────────────────────────────────────────────────────

  let loadingTimer = null;

  function render() {
    if (loadingTimer) { clearTimeout(loadingTimer); loadingTimer = null; }
    const view = views[state.step];
    app.innerHTML = view ? view() : '';
    afterRender();
  }

  const banner = () => state.notice
    ? `<div class="notice">${esc(state.notice)}</div>` : '';

  const stepTitle = (title, backStep) => `
    <div class="step-head">
      ${backStep ? `<button class="back" data-act="back" data-step="${backStep}" aria-label="Back">&larr;</button>` : ''}
      <h2>${esc(title)}</h2>
    </div>`;

  const tzCaption = () => state.client
    ? `<p class="tz-caption">All times are in ${esc(state.client.timezone)}</p>` : '';

  const views = {

    loading: () => `
      <div class="center">
        <div class="spinner" role="status" aria-label="Loading"></div>
        <p class="loading-copy">Loading…</p>
        <p class="loading-slow" id="slow-note" hidden>Still connecting — the first load can take a few seconds.</p>
      </div>`,

    deadlink: () => `
      <div class="center">
        <h2>This booking link isn&rsquo;t available</h2>
        <p class="muted">It may have been switched off or mistyped. Please contact the person who sent it to you.</p>
        <a class="btn-secondary" href="https://v-bog.com/">Go to v-bog.com</a>
      </div>`,

    error: () => `
      <div class="center">
        <h2>Something went wrong</h2>
        <p class="muted">${esc(state.error && state.error.message || 'Please try again.')}</p>
        ${state.error && state.error.retry ? '<button class="btn-primary" data-act="retry">Try again</button>' : ''}
      </div>`,

    duration: () => `
      ${stepTitle('How long should we meet?')}
      ${banner()}
      <div class="option-grid">
        ${state.client.durations.map((d) =>
          `<button class="pill big" data-act="pick-duration" data-mins="${d}">${d} minutes</button>`).join('')}
      </div>`,

    date: () => `
      ${stepTitle('Pick a date', state.client.durations.length > 1 ? 'duration' : '')}
      ${banner()}
      ${renderCalendar()}
      ${tzCaption()}`,

    slots: () => `
      ${stepTitle(fmtDateLong(state.date), 'date')}
      ${banner()}
      ${state.slots === null
        ? `<div class="center"><div class="spinner"></div><p class="loading-copy">Checking availability…</p>
           <p class="loading-slow" id="slow-note" hidden>Still checking — this can take a few seconds.</p></div>`
        : state.slots.length === 0
          ? `<p class="muted center-text">No times left on this day. Please pick another date.</p>
             <div class="center"><button class="btn-secondary" data-act="back" data-step="date">Pick another date</button></div>`
          : `<div class="option-grid slots">
              ${state.slots.map((t) =>
                `<button class="pill" data-act="pick-time" data-time="${t}">${fmtTime12(t)}</button>`).join('')}
            </div>
            ${tzCaption()}`}`,

    details: () => `
      ${stepTitle('Your details', 'slots')}
      ${banner()}
      <div class="summary-line">
        ${esc(fmtDateLong(state.date))} &middot; ${esc(fmtTime12(state.time))} &middot; ${state.duration} min
      </div>
      <form id="details-form" novalidate>
        <label>Full name
          <input name="name" type="text" autocomplete="name" maxlength="100"
            value="${esc(state.form.name)}" ${state.submitting ? 'disabled' : ''}>
          ${state.fieldErrors.name ? `<span class="field-err">${esc(state.fieldErrors.name)}</span>` : ''}
        </label>
        <label>Email
          <input name="email" type="email" autocomplete="email" maxlength="254"
            value="${esc(state.form.email)}" ${state.submitting ? 'disabled' : ''}>
          ${state.fieldErrors.email ? `<span class="field-err">${esc(state.fieldErrors.email)}</span>` : ''}
        </label>
        <label>Phone <span class="optional">Optional — for WhatsApp follow-up</span>
          <input name="phone" type="tel" autocomplete="tel" maxlength="30"
            value="${esc(state.form.phone)}" ${state.submitting ? 'disabled' : ''}>
          ${state.fieldErrors.phone ? `<span class="field-err">${esc(state.fieldErrors.phone)}</span>` : ''}
        </label>
        <label>Meeting subject <span class="optional">Optional — custom title for the calendar invite</span>
          <input name="subject" type="text" maxlength="200"
            value="${esc(state.form.subject)}" ${state.submitting ? 'disabled' : ''}>
        </label>
        <label>Additional guests <span class="optional">Optional — comma-separated email addresses</span>
          <input name="guests" type="text" maxlength="500" placeholder="e.g. colleague@company.com, partner@firm.com"
            value="${esc(state.form.guests)}" ${state.submitting ? 'disabled' : ''}>
          ${state.fieldErrors.guests ? `<span class="field-err">${esc(state.fieldErrors.guests)}</span>` : ''}
        </label>
        <button class="btn-primary submit" type="submit" ${state.submitting ? 'disabled' : ''}>
          ${state.submitting ? 'Confirming…' : 'Confirm booking'}
        </button>
      </form>`,

    done: () => `
      <div class="center done">
        <div class="check" aria-hidden="true">✓</div>
        <h2>You&rsquo;re booked!</h2>
        <p class="muted">A confirmation and calendar invite are on their way to <strong>${esc(state.form.email)}</strong>.</p>
        <div class="confirm-card">
          <div><span>Date</span><strong>${esc(fmtDateLong(state.date))}</strong></div>
          <div><span>Time</span><strong>${esc(fmtTime12(state.time))} (${esc(state.client.timezone)})</strong></div>
          <div><span>Duration</span><strong>${state.duration} minutes</strong></div>
          <div><span>With</span><strong>Depesh Vyas, VBOG</strong></div>
          ${state.form.subject.trim() ? `<div><span>Subject</span><strong>${esc(state.form.subject.trim())}</strong></div>` : ''}
        </div>
        ${state.client.notes_for_client ? `<p class="client-notes">${esc(state.client.notes_for_client)}</p>` : ''}
      </div>`
  };

  // ── Calendar (hand-built month grid, Monday-first) ─────────────────────────

  function renderCalendar() {
    const c = state.client;
    const min = todayInTz(c.timezone);
    const max = addDays(min, c.max_days_forward || 60);
    const [year, month] = state.calMonth.split('-').map(Number);

    const firstDow = (weekdayIdx(`${state.calMonth}-01`) + 6) % 7; // Monday-first offset
    const total = daysInMonth(year, month);

    const prevOk = state.calMonth > min.slice(0, 7);
    const nextOk = state.calMonth < max.slice(0, 7);

    let cells = '<div class="cal-cell head">Mo</div><div class="cal-cell head">Tu</div><div class="cal-cell head">We</div><div class="cal-cell head">Th</div><div class="cal-cell head">Fr</div><div class="cal-cell head">Sa</div><div class="cal-cell head">Su</div>';
    for (let i = 0; i < firstDow; i++) cells += '<div class="cal-cell"></div>';
    for (let d = 1; d <= total; d++) {
      const dateStr = `${state.calMonth}-${String(d).padStart(2, '0')}`;
      const allowed = c.allowed_days.includes(DAYS[weekdayIdx(dateStr)]);
      const inRange = dateStr >= min && dateStr <= max;
      const enabled = allowed && inRange;
      cells += enabled
        ? `<button class="cal-cell day" data-act="pick-date" data-date="${dateStr}">${d}</button>`
        : `<div class="cal-cell day off">${d}</div>`;
    }

    return `
      <div class="cal">
        <div class="cal-nav">
          <button class="cal-arrow" data-act="cal-prev" ${prevOk ? '' : 'disabled'} aria-label="Previous month">&larr;</button>
          <span class="cal-title">${MONTHS[month - 1]} ${year}</span>
          <button class="cal-arrow" data-act="cal-next" ${nextOk ? '' : 'disabled'} aria-label="Next month">&rarr;</button>
        </div>
        <div class="cal-grid">${cells}</div>
      </div>`;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Events (bound after every render)
  // ───────────────────────────────────────────────────────────────────────────

  function afterRender() {
    // Escalating loading copy for Apps Script cold starts.
    const slow = document.getElementById('slow-note');
    if (slow) loadingTimer = setTimeout(() => { slow.hidden = false; }, 2500);

    app.querySelectorAll('[data-act]').forEach((el) => {
      el.addEventListener('click', () => handleAction(el.dataset));
    });

    const form = document.getElementById('details-form');
    if (form) {
      form.addEventListener('submit', (e) => { e.preventDefault(); submitBooking(form); });
      // Keep typed values across re-renders without re-rendering per keystroke.
      form.addEventListener('input', () => {
        state.form.name = form.elements.name.value;
        state.form.email = form.elements.email.value;
        state.form.phone = form.elements.phone.value;
        state.form.subject = form.elements.subject.value;
        state.form.guests = form.elements.guests.value;
      });
    }
  }

  function handleAction(d) {
    switch (d.act) {
      case 'retry':
        if (state.error && state.error.retry) state.error.retry();
        break;
      case 'back':
        state.notice = null;
        if (d.step === 'date') { state.slots = null; state.time = null; }
        state.step = d.step;
        render();
        break;
      case 'pick-duration':
        state.duration = Number(d.mins);
        state.calMonth = todayInTz(state.client.timezone).slice(0, 7);
        state.step = 'date';
        render();
        break;
      case 'cal-prev':
      case 'cal-next': {
        const [y, m] = state.calMonth.split('-').map(Number);
        const shifted = new Date(Date.UTC(y, m - 1 + (d.act === 'cal-next' ? 1 : -1), 1));
        state.calMonth = shifted.toISOString().slice(0, 7);
        render();
        break;
      }
      case 'pick-date':
        state.date = d.date;
        loadSlots();
        break;
      case 'pick-time':
        state.time = d.time;
        state.notice = null;
        state.step = 'details';
        render();
        break;
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Data flows
  // ───────────────────────────────────────────────────────────────────────────

  async function loadClient() {
    state.step = 'loading';
    render();
    let res;
    try {
      res = await apiGet('getClient', { slug: state.slug });
    } catch (e) {
      state.error = { message: 'Could not reach the booking system. Check your connection and try again.', retry: loadClient };
      state.step = 'error';
      return render();
    }
    if (!res.ok) {
      if (res.error === 'CLIENT_NOT_FOUND') { state.step = 'deadlink'; return render(); }
      state.error = { message: res.message || 'Unexpected error.', retry: loadClient };
      state.step = 'error';
      return render();
    }
    state.client = res.data;
    if (!state.client.durations || state.client.durations.length === 0) {
      state.step = 'deadlink'; // misconfigured client = unusable link
      return render();
    }
    if (state.client.durations.length === 1) {
      // PRD: skip the duration step entirely when there's only one option.
      state.duration = state.client.durations[0];
      state.calMonth = todayInTz(state.client.timezone).slice(0, 7);
      state.step = 'date';
    } else {
      state.step = 'duration';
    }
    render();
  }

  async function loadSlots() {
    state.step = 'slots';
    state.slots = null;
    render();
    let res;
    try {
      res = await apiGet('getSlots', { slug: state.slug, date: state.date, duration: state.duration });
    } catch (e) {
      state.error = {
        message: 'Could not load times for that date. Please try again.',
        retry: () => { state.step = 'date'; state.error = null; render(); }
      };
      state.step = 'error';
      return render();
    }
    if (!res.ok) {
      if (res.error === 'CLIENT_NOT_FOUND') { state.step = 'deadlink'; return render(); }
      // DAY_NOT_AVAILABLE / DATE_OUT_OF_RANGE can happen if the page sat open
      // past midnight — treat like an empty day and let them re-pick.
      state.slots = [];
      state.notice = res.message || null;
      return render();
    }
    state.slots = res.data.slots;
    render();
  }

  function validateForm() {
    const errs = {};
    if (!state.form.name.trim()) errs.name = 'Please enter your name.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(state.form.email.trim())) errs.email = 'Please enter a valid email.';
    const phone = state.form.phone.trim();
    if (phone && !/^[+0-9 ()\-]{6,30}$/.test(phone)) errs.phone = 'Please enter a valid phone number.';
    const guestsRaw = state.form.guests.trim();
    if (guestsRaw) {
      const guestList = guestsRaw.split(',').map(g => g.trim()).filter(Boolean);
      if (guestList.length > 5) {
        errs.guests = 'Maximum 5 additional guests.';
      } else if (guestList.some(g => !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(g))) {
        errs.guests = 'One or more email addresses are invalid.';
      }
    }
    state.fieldErrors = errs;
    return Object.keys(errs).length === 0;
  }

  async function submitBooking(form) {
    state.form.name = form.elements.name.value;
    state.form.email = form.elements.email.value;
    state.form.phone = form.elements.phone.value;
    state.form.subject = form.elements.subject.value;
    state.form.guests = form.elements.guests.value;
    state.notice = null;
    if (!validateForm()) return render();

    state.submitting = true;
    render();

    let res;
    try {
      res = await apiPost({
        action: 'createBooking',
        slug: state.slug,
        date: state.date,
        time: state.time,
        duration: state.duration,
        booker_name: state.form.name.trim(),
        booker_email: state.form.email.trim(),
        booker_phone: state.form.phone.trim(),
        booking_subject: state.form.subject.trim(),
        extra_guests: state.form.guests.trim()
      });
    } catch (e) {
      // Timeout/network failure on a POST is ambiguous — the booking may have
      // gone through. Be honest instead of auto-retrying into SLOT_TAKEN.
      state.submitting = false;
      state.notice = 'We may have received your booking — please check your email for a confirmation before trying again.';
      return render();
    }

    state.submitting = false;
    if (res.ok) {
      state.booking = res.data;
      state.step = 'done';
      return render();
    }
    if (res.error === 'SLOT_TAKEN') {
      state.time = null;
      state.notice = 'That time was just taken. Please pick another slot.';
      return loadSlots();
    }
    if (res.error === 'CLIENT_NOT_FOUND') { state.step = 'deadlink'; return render(); }
    if (res.error === 'BUSY') {
      state.notice = 'The system is busy — please try again in a moment.';
      return render();
    }
    state.notice = res.message || 'Something went wrong. Please try again.';
    render();
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Mock API — lets the whole wizard run with no backend (config.js MOCK_MODE).
  // Test recipes:
  //   ?c=test-client → two durations, Mon–Fri
  //   ?c=solo        → single duration (duration step is skipped)
  //   ?c=anything-else → deadlink screen
  //   picking 10:00 and submitting → always SLOT_TAKEN (tests the bounce)
  //   any date ending in 9 → simulated network failure (tests timeout copy)
  // ───────────────────────────────────────────────────────────────────────────

  function mockApi(action, params, body) {
    const delay = 400 + Math.random() * 800;
    const respond = (v) => new Promise((res) => setTimeout(() => res(v), delay));
    const fail = () => new Promise((_, rej) => setTimeout(() => rej(new Error('mock network failure')), delay));
    const err = (code, message) => respond({ ok: false, error: code, message });
    const clients = {
      'test-client': {
        slug: 'test-client', client_name: 'Test Client', timezone: 'Asia/Kolkata',
        durations: [30, 60], allowed_days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
        notes_for_client: 'This is a test booking link.', max_days_forward: 60
      },
      solo: {
        slug: 'solo', client_name: 'Solo Duration Co', timezone: 'Asia/Kolkata',
        durations: [30], allowed_days: ['Mon', 'Wed', 'Fri'],
        notes_for_client: '', max_days_forward: 60
      }
    };

    if (action === 'getClient') {
      return clients[params.slug] ? respond({ ok: true, data: clients[params.slug] })
        : err('CLIENT_NOT_FOUND', 'This booking link is not active.');
    }
    if (action === 'getSlots') {
      if (/9$/.test(params.date)) return fail();
      // Deterministic pseudo-random availability seeded by the date string, so
      // each day looks different but stays stable across reloads.
      let seed = 0;
      for (let i = 0; i < params.date.length; i++) seed = (seed * 31 + params.date.charCodeAt(i)) % 997;
      const dur = Number(params.duration);
      const slots = [];
      for (let m = 10 * 60; m + dur <= 18 * 60; m += dur) {
        seed = (seed * 137 + 71) % 997;
        if (seed % 3 !== 0) {
          slots.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
        }
      }
      if (!slots.includes('10:00')) slots.unshift('10:00'); // keep the SLOT_TAKEN recipe reachable
      return respond({ ok: true, data: { date: params.date, duration: dur, timezone: 'Asia/Kolkata', slots } });
    }
    if (body && body.action === 'createBooking') {
      if (body.time === '10:00') return err('SLOT_TAKEN', 'This slot was just booked. Please pick another.');
      return respond({
        ok: true,
        data: { booking_id: 'mock-' + Date.now(), client_name: 'Test Client', date: body.date, time: body.time, duration: body.duration, timezone: 'Asia/Kolkata' }
      });
    }
    return err('BAD_REQUEST', 'Unknown mock action.');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Boot
  // ───────────────────────────────────────────────────────────────────────────

  const rawSlug = (new URLSearchParams(location.search).get('c') || '').trim().toLowerCase();
  if (!/^[a-z0-9-]{1,64}$/.test(rawSlug)) {
    state.step = 'deadlink';
    render();
  } else {
    state.slug = rawSlug;
    loadClient();
  }
})();
