// The page (index.html) is fetched network-first so a new release shows up on the next load; hashed assets and other files are
// stale-while-revalidate. Everything falls back to the cache, so solo play against bots works offline.
const CACHE = "cards-v2";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));
self.addEventListener("fetch", (e) => {
  const r = e.request;
  if (r.method !== "GET" || new URL(r.url).origin !== location.origin) return;
  const page = r.mode === "navigate" || r.destination === "document" || /\/(sw\.js|manifest\.webmanifest)$/.test(new URL(r.url).pathname);
  e.respondWith(caches.open(CACHE).then(async (c) => {
    const hit = await c.match(r);
    const net = fetch(r).then((res) => { if (res.ok) c.put(r, res.clone()); return res; }).catch(() => hit);
    return page ? net.then((res) => res ?? hit) : hit || net;
  }));
});
