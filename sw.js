// Service worker: la app funciona al instante y sin conexión.

const VERSION = 'db-v4';

const SHELL = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './js/api.js',
  './js/geo.js',
  './js/sheet.js',
  './js/map.js',
  './manifest.webmanifest',
  './icons/icon.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;

  // API de precios: red primero, caché como respaldo
  if (url.hostname.endsWith('minetur.gob.es')) {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const clone = res.clone();
          caches.open(VERSION).then((c) => c.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // teselas del mapa: siempre red (demasiadas para cachear)
  if (url.hostname.endsWith('cartocdn.com')) return;

  // resto (shell, fuentes, leaflet): caché primero, red de respaldo
  e.respondWith(
    caches.match(e.request).then(
      (hit) =>
        hit ||
        fetch(e.request).then((res) => {
          if (res.ok && (url.origin === location.origin || url.hostname.includes('unpkg') || url.hostname.includes('fonts.g'))) {
            const clone = res.clone();
            caches.open(VERSION).then((c) => c.put(e.request, clone));
          }
          return res;
        })
    )
  );
});
