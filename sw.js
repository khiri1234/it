// Minimal service worker — exists mainly so the browser considers this installable as a
// PWA. Deliberately network-first (never cache-first): this app's data is live Firestore
// sync, and the app shell itself changes often, so serving a stale cached index.html by
// default would be worse than just requiring a connection. The cache only kicks in as a
// fallback when the network request fails (offline, or a flaky connection).
const CACHE_NAME = 'the-h-shell-v1';
const SHELL_FILES = ['./index.html', './manifest.webmanifest'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).catch(() => {}));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) => Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return; // leave Firebase/Firestore/CDN requests alone

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(() => {});
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || Response.error()))
  );
});
