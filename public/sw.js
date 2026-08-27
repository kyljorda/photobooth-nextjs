// Bump this on every deploy that changes cached assets.
const CACHE_NAME = 'vsc-v2';
const PRECACHE = ['/', '/manifest.json', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Order submissions must never be served from cache.
  if (url.pathname.startsWith('/api/')) return;

  // Network-first for page loads: the old cache-first strategy could pin users
  // to a stale build for as long as their cache survived.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((c) => c.put(request, clone)).catch(() => {});
          return response;
        })
        .catch(() => caches.match(request).then((c) => c || caches.match('/')))
    );
    return;
  }

  // Cache-first for hashed static assets, which are immutable by build.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((c) => c.put(request, clone)).catch(() => {});
        }
        return response;
      });
    })
  );
});
