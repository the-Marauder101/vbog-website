// js/app.js — registers sw.js so Nikash can be installed on a phone.
//
// Loaded by the staff pages only (nikash, ask, interview). See sw.js for what the
// worker does and, more to the point, what it deliberately does not do: it caches
// no code and no data, and only shows an offline notice when a staff page cannot
// be reached.
//
// Registration failing is never an error worth showing anybody: the console works
// exactly as before without it, it just cannot be installed or show the notice.
(function () {
  if (!("serviceWorker" in navigator)) return;
  // Service workers need a secure origin; localhost counts, so the test suites and
  // a local preview behave like the deployed site.
  if (location.protocol !== "https:" && location.hostname !== "localhost" &&
      location.hostname !== "127.0.0.1") return;
  window.addEventListener("load", function () {
    navigator.serviceWorker.register("sw.js", { scope: "./" }).catch(function () {});
  });
})();
