/* Offline shell. Trails happen where there is no signal, so the app itself must
   survive with none. Map tiles cache opportunistically as you pan an area. */
const V = 'trailcraft-v109';
/* Every module the app cannot start without. app.js is an ES module and its
   imports are separate requests — listing only app.js precaches a shell that
   cannot boot, which shows up as a working app that dies the first time it is
   opened with no signal. Which is a wood. Which is where it is used.

   Paths are RELATIVE (resolved against this worker's own URL) so the same app
   serves from a domain root on the LAN and from /trailcraft/ on GitHub Pages
   without either deployment breaking the other. */
const SHELL = [
  './', 'index.html', 'app.css',
  'app.js', 'geo.js', 'colours.js', 'draft.js', 'mvt.js', 'ground.js', 'params.js', 'debrief.js', 'call.js', 'field.js', 'walls.js', 'sim.js', 'card.js', 'store.js',
  'sync-core.js', 'sync.js', 'firebase-config.js', 'share.js', 'pdf.js', 'coach.js', 'native.js',
  'vendor/qrcode.js', 'vendor/jsQR.js',
];
/* Wanted, but not worth failing an update over, and none of them stops the app
   starting: the Mapbox token exists only on this Mac's own copy (it is never
   deployed, so the web app would 404 on it every time), the manifest only
   matters when adding to the home screen, and build.txt is always read from the
   network anyway. */
const EXTRAS = ['token.js', 'manifest.webmanifest', 'build.txt'];
const VENDOR = [
  'https://api.mapbox.com/mapbox-gl-js/v3.14.0/mapbox-gl.js',
  'https://api.mapbox.com/mapbox-gl-js/v3.14.0/mapbox-gl.css',
  'https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.min.js',
  'https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.min.css',
];

/* An update installs ALL of the shell or none of it. Letting the odd file fail
   and carrying on gave a worker that activated, deleted the last working cache,
   and then could not start the app at all without signal — the update turned a
   working offline app into a blank screen, in the one place it is needed.
   addAll is all-or-nothing: if any of it fails the install fails, this worker is
   thrown away, and the one already installed carries on serving. */
self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(V);
    await c.addAll(SHELL);
    await Promise.all([...EXTRAS, ...VENDOR].map(u => c.add(u).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    /* Belt and braces: the old cache is only thrown away once this one is
       proved complete. A cache that cannot start the app is worse than an old
       one that can. */
    const c = await caches.open(V);
    const whole = (await Promise.all(SHELL.map(u => c.match(u)))).every(Boolean);
    if (whole) {
      const keys = await caches.keys();
      await Promise.all(keys.filter(k => k !== V).map(k => caches.delete(k)));
    }
    await self.clients.claim();
  })());
});

const cacheable = (url) =>
  /mapbox|openstreetmap|jsdelivr|fonts\.(googleapis|gstatic)\.com/.test(url.hostname)
  // The Firebase SDK, so signing in never stands between a handler and a trail offline.
  || (url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/'));

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
        /* The page itself falls back to the shell; a missing script does not.
           Handing index.html to an import request answers a module with a page
           of HTML, and the error that follows says nothing about what is wrong. */
        .catch(() => caches.match(e.request)
          .then(hit => hit || (e.request.mode === 'navigate' ? caches.match('index.html') : undefined))
          .then(res => res || Response.error()))
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
