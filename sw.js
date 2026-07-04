// Cache version is bumped by build_pricing_app.py on every build.
const CACHE = 'eg-pricing-20260703185226-2fa6eb';
// App shell (no data file here — data is cached at runtime so the same SW works
// for both the plaintext (data.json) and encrypted (data.enc.json) bundles).
const SHELL = [
  './', './index.html', './styles.css', './app.js',
  './manifest.webmanifest', './icon-192.png', './icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k.startsWith('eg-pricing-') && k !== CACHE).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const p = new URL(e.request.url).pathname;
  // data files: network-first (fresh when online), fall back to cache offline.
  if (p.endsWith('/data.json') || p.endsWith('/data.enc.json')) {
    e.respondWith(
      fetch(e.request).then(r => {
        const copy = r.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return r;
      }).catch(() => caches.match(e.request))
    );
    return;
  }
  // App shell: network-first when online (so a code update shows on the NEXT
  // refresh, not after a double-reload), falling back to cache when offline.
  e.respondWith(
    fetch(e.request).then(r => {
      if (r && r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return r;
    }).catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
  );
});
