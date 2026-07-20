const CACHE = 'radar-conte-p3-v1';
const CORE = ['./', './index.html', './styles.css?v=3', './app.js?v=3', './manifest.webmanifest', './icons/icon.svg'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.hostname.includes('rainviewer.com') || url.hostname.includes('openstreetmap.org') || url.hostname.includes('unpkg.com')) return;
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});
