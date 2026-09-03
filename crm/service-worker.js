const CACHE_VERSION = "vc-imob-shell-g1-20260902b";
const SHELL_CACHE = CACHE_VERSION;
const OFFLINE_URL = new URL("./offline.html", self.location).href;
const SAFE_SHELL = [
  "./offline.html",
  "./css/crm.css",
  "./css/billing.css",
  "./css/history.css",
  "./css/kanban.css",
  "./css/phase-f.css",
  "./css/phase-g.css",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(SHELL_CACHE).then(cache => cache.addAll(SAFE_SHELL)));
});

self.addEventListener("activate", event => {
  event.waitUntil(Promise.all([
    caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith("vc-imob-") && key !== SHELL_CACHE).map(key => caches.delete(key)))),
    self.clients.claim()
  ]));
});

function isSafeStaticRequest(request, url) {
  if (request.method !== "GET" || url.origin !== self.location.origin) return false;
  if (!url.pathname.startsWith("/crm/")) return false;
  return /\.(?:css|js|png|svg|ico|webmanifest)$/.test(url.pathname);
}

self.addEventListener("fetch", event => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET") return;

  if (request.mode === "navigate" && url.origin === self.location.origin && url.pathname.startsWith("/crm/")) {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
    return;
  }

  if (!isSafeStaticRequest(request, url)) return;
  event.respondWith(fetch(request).then(response => {
    if (!response.ok || response.type !== "basic") return response;
    const copy = response.clone();
    caches.open(SHELL_CACHE).then(cache => cache.put(request, copy));
    return response;
  }).catch(() => caches.match(request)));
});

self.addEventListener("message", event => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});
