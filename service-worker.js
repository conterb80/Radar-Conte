const VERSION = 'radar-conte-p16';
const APP_SHELL = [
  '/Radar-Conte/',
  '/Radar-Conte/index.html',
  '/Radar-Conte/styles.css?v=16',
  '/Radar-Conte/app.js?v=16',
  '/Radar-Conte/manifest.webmanifest',
  '/Radar-Conte/manifest.json',
  '/Radar-Conte/icons/icon-192.png',
  '/Radar-Conte/icons/icon-512.png',
  '/Radar-Conte/icons/icon-maskable-192.png',
  '/Radar-Conte/icons/icon-maskable-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(VERSION)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== VERSION).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  if (url.origin !== self.location.origin) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const copy = response.clone();
          caches.open(VERSION).then(cache => cache.put('/Radar-Conte/index.html', copy));
          return response;
        })
        .catch(() => caches.match('/Radar-Conte/index.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request, { ignoreSearch: true })
      .then(cached => cached || fetch(event.request).then(response => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(VERSION).then(cache => cache.put(event.request, copy));
        }
        return response;
      }))
  );
});
