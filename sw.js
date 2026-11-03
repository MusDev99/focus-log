// Service worker: caches the app shell so the dashboard opens offline.
// Paths are relative to this file so it also works under a subpath (e.g. GitHub Pages).
const CACHE = 'pomodoro-shell-v11';
const SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './audio.js',
  './timer-core.js',
  './store.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  // Only handle same-origin GETs; let everything else (e.g. fonts) pass through.
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  // Network first, fall back to the cache so fresh deploys win when online. 'no-cache' revalidates
  // with the server, so the browser's HTTP cache (10 min on GitHub Pages) can't serve a stale mix of files.
  event.respondWith(
    fetch(req, { cache: 'no-cache' })
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html')))
  );
});
