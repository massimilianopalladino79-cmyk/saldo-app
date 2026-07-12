// sw.js - service worker: rete-prima per i file dell'app, cache come fallback offline
const CACHE = 'saldo-v18';
const ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'version.json',
  'css/styles.css',
  'js/app.js',
  'js/store.js',
  'js/charts.js',
  'js/format.js',
  'js/xlsx-io.js',
  'js/seed.js',
  'vendor/xlsx.full.min.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-512-maskable.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.allSettled(ASSETS.map((a) => c.add(a))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const sameOrigin = new URL(req.url).origin === self.location.origin;

  // navigazioni: rete, con fallback alla shell in cache (offline)
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then((res) => {
        caches.open(CACHE).then((c) => c.put('index.html', res.clone())).catch(() => {});
        return res;
      }).catch(() => caches.match('index.html'))
    );
    return;
  }

  // file dell'app (stessa origine): RETE PRIMA -> sempre l'ultima versione quando
  // online; la cache resta come fallback offline. Elimina il ritardo di aggiornamento.
  if (sameOrigin) {
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match(req))
    );
    return;
  }

  // altre origini: cache-first
  e.respondWith(caches.match(req).then((c) => c || fetch(req)));
});













