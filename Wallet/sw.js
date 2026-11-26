// Service worker Nusa Card.
// Naikkan CACHE_VERSION setiap kali Nusa-Card.html diperbarui.
const CACHE_VERSION = 'nusacard-v1';
const APP_SHELL = [
  './Nusa-Card.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png'
];
// Hanya library statis yang boleh di-cache. API/explorer TIDAK pernah di-cache.
const STATIC_HOSTS = ['cdnjs.cloudflare.com', 'iili.io'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_VERSION).then((c) => c.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const isStatic = STATIC_HOSTS.includes(url.hostname);
  if (!sameOrigin && !isStatic) return; // API node/explorer: langsung ke jaringan

  if (sameOrigin) {
    // Halaman & file aplikasi: jaringan dulu, cache sebagai cadangan offline
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('./Nusa-Card.html')))
    );
  } else {
    // Library CDN & logo: cache dulu agar cepat dan tetap jalan offline
    e.respondWith(
      caches.match(req).then((hit) =>
        hit || fetch(req).then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
          return res;
        })
      )
    );
  }
});
