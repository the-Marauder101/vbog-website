// The portal moved to https://rich.v-bog.com. This replaces the old app's offline cache on phones that installed it:
// clear everything, step aside, and reload so the page above sends them to the new address.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) await caches.delete(k);
  await self.registration.unregister();
  for (const c of await self.clients.matchAll({ type: "window" })) c.navigate(c.url);
})()));
