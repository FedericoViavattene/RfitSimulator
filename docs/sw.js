/*
  sw.js — service worker for the Riftbound Deck Simulator PWA.

  IMPORTANT for future updates: bump CACHE_NAME (e.g. 'riftbound-sim-v2')
  every time index.html/app.js/engine.js/style.css or the bundled data files
  change. That's what makes an update show up on the phone: a new cache name
  makes every device throw away its old cached copies and fetch fresh ones
  the next time the app is opened with a network connection. Forgetting to
  bump it means a phone that already has the app installed keeps the old
  version even after GitHub Pages has the new one.
*/
const CACHE_NAME = 'riftbound-sim-v2';

const CORE_ASSETS = [
  '.',
  'index.html',
  'style.css',
  'app.js',
  'engine.js',
  'manifest.webmanifest',
  'carddatabase.json',
  'decks.json',
  'banned.json',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-512-maskable.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(names => Promise.all(
        names.filter(name => name !== CACHE_NAME).map(name => caches.delete(name))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  if (req.mode === 'navigate') {
    // Page loads: try the network first so a phone with signal always gets
    // the latest index.html, falling back to the cached copy when offline.
    event.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then(cached => cached || caches.match('index.html')))
    );
    return;
  }

  // Everything else (css/js/json/icons): cache-first, updating the cache in
  // the background when the network has a fresher copy.
  event.respondWith(
    caches.match(req).then(cached => {
      const network = fetch(req).then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
