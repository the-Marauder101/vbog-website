// sw.js — what makes Nikash installable as a phone app, and nothing more.
//
// ── WHAT IT DELIBERATELY DOES NOT DO ──────────────────────────────────────
//
// It does not cache Nikash's code, and it never touches candidate data.
//
// Caching the app shell is the usual reason to have a service worker, and here it
// would be a hazard. Earlier in this project the live database ran ahead of the
// deployed code for days, and the mismatch cost hours to diagnose. A worker that
// served yesterday's JavaScript from a phone's cache would recreate that exact
// split on every phone that had the app, silently, until each one happened to
// update. Every request for code therefore goes to the network, as it would in a
// browser tab, and a merge reaches the app the next time it is opened.
//
// Candidate data is cross-origin (Supabase) and this worker ignores every
// cross-origin request outright, so none of it can ever land in a cache on a
// device. That matters for a tool holding personal data that people have
// consented to have held in one place.
//
// ── WHAT IT DOES ──────────────────────────────────────────────────────────
//
// Exactly one thing: when a staff page cannot be reached, it shows offline.html —
// a plain "you're offline" — instead of the browser's own error screen, which in
// an installed app looks like the app is broken.
//
// It only does that for the staff pages. The candidate and client pages in this
// folder (assess, apply, intake, supplement, keying) are never intercepted, so
// nothing here can change what a candidate sees, even on a phone that has the
// staff app installed.
//
// To change this file safely: bump VERSION, so the old worker's cache is removed.

const VERSION = "nikash-offline-v1";
const OFFLINE = "offline.html";
const STAFF_PAGES = /\/(nikash|ask|interview)\.html$/;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((c) => c.add(new Request(OFFLINE, { cache: "reload" })))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || req.mode !== "navigate") return;   // only page loads

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;               // never Supabase
  if (!STAFF_PAGES.test(url.pathname)) return;                   // never a candidate page

  // Straight to the network, exactly as a browser would. The cache is consulted
  // only when the network has failed, and only for the offline notice.
  event.respondWith(
    fetch(req).catch(() =>
      caches.open(VERSION).then((c) => c.match(OFFLINE)).then((r) =>
        r || new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } })))
  );
});
