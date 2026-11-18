const CACHE_PREFIX = "ryan-admission-portal-";
const CACHE_NAME = "ryan-admission-portal-20261118-09";
const SCOPE_URL = new URL(self.registration.scope);
const INDEX_URL = new URL("./index.html", SCOPE_URL);
const APP_SHELL = [
  "./index.html",
  "./project-dots.js?v=20261118-09",
  "./project-updates.json",
  "./manifest.webmanifest",
  "./og-preview-20260827-05.jpg",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL.map(
        (path) => new Request(new URL(path, SCOPE_URL), { cache: "reload" })
      )))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const requestUrl = new URL(event.request.url);
  if (!requestUrl.href.startsWith(SCOPE_URL.href)) return;

  if (event.request.mode === "navigate") {
    const isPortalPage = requestUrl.pathname === SCOPE_URL.pathname ||
      requestUrl.pathname === INDEX_URL.pathname;
    if (!isPortalPage) return;

    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      let response;
      try {
        response = await fetch(event.request);
      } catch {
        return (await cache.match(INDEX_URL.href)) || Response.error();
      }
      if (response.ok && !response.redirected) {
        await cache.put(INDEX_URL.href, response.clone()).catch(() => {});
      }
      return response;
    })());
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(event.request);
      if (cached) return cached;
      const response = await fetch(event.request);
      if (response.ok && !response.redirected) {
        await cache.put(event.request, response.clone()).catch(() => {});
      }
      return response;
    })
  );
});
