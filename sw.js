/* Offline shell. Trails happen where there is no signal, so the app itself must
   survive with none. Map tiles cache opportunistically as you pan an area. */
const V = 'trailcraft-v10';
/* Every module the app cannot start without. app.js is an ES module and its
   imports are separate requests — listing only app.js precaches a shell that
   cannot boot, which shows up as a working app that dies the first time it is
   opened with no signal. Which is a wood. Which is where it is used.

   Paths are RELATIVE (resolved against this worker's own URL) so the same app
   serves from a domain root on the LAN and from /trailcraft/ on GitHub Pages
   without either deployment breaking the other. */
const SHELL = [
  './', 'index.html', 'app.css', 'manifest.webmanifest', 'token.js',
  'app.js', 'geo.js', 'field.js', 'sim.js', 'wind.js', 'gesture.js', 'team.js',
  'design.js', 'card.js', 'engine-demo.js', 'vendor/qrcode.js', 'vendor/jsQR.js', 'build.txt',
];
const VENDOR = [
  'https://api.mapbox.com/mapbox-gl-js/v3.14.0/mapbox-gl.js',
  'https://api.mapbox.com/mapbox-gl-js/v3.14.0/mapbox-gl.css',
  'https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.min.js',
  'https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.min.css',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(V)
    .then(c => Promise.all([...SHELL, ...VENDOR].map(u => c.add(u).catch(() => {}))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== V).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

const cacheable = (url) =>
  /mapbox|openstreetmap|jsdelivr/.test(url.hostname);

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // Never cache weather — a stale reading in a training record is worse than none.
  if (url.hostname === 'api.open-meteo.com') return;

  // App shell: network-first, so an edit always lands. Cache is the offline
  // fallback, not the source of truth.
  if (url.origin === location.origin) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          if (res.ok) { const copy = res.clone(); caches.open(V).then(c => c.put(e.request, copy)); }
          return res;
        })
        .catch(() => caches.match(e.request).then(hit => hit || caches.match('index.html')))
    );
    return;
  }

  // Tiles and pinned vendor files are immutable — cache-first is correct, and
  // it is what makes the map usable in a wood with no signal.
  if (!cacheable(url)) return;
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(V).then(c => c.put(e.request, copy)); }
      return res;
    }))
  );
});
