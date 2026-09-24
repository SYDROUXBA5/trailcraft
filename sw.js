/* Offline shell. Trails happen where there is no signal, so the app itself must
   survive with none. Map tiles cache opportunistically as you pan an area. */
const V = 'trailcraft-v110';
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
   matters when adding to the home screen, and build.txt only stamps which build
   this cache holds (see sameBuild), so a cache without it is simply never
   assumed to match the server. */
const EXTRAS = ['token.js', 'manifest.webmanifest', 'build.txt'];
const VENDOR = [
  'https://api.mapbox.com/mapbox-gl-js/v3.14.0/mapbox-gl.js',
  'https://api.mapbox.com/mapbox-gl-js/v3.14.0/mapbox-gl.css',
  'https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.min.js',
  'https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.min.css',
];

/* Map tiles, and the pinned map and sign-in libraries, live apart from the app
   in a cache no update deletes. They used to share V, so every update threw
   away every tile the handler had panned over the night before, and the map
   was blank in the wood the morning after an update they never noticed.
   The name must never start 'trailcraft-v': activate clears those. */
const TILES = 'trailcraft-tiles';
/* Tiles pile up as the map is panned, so the oldest go once there are more
   than this: several training areas' worth, at every zoom. */
const TILE_LIMIT = 3000;

/* How long the network gets before the copy on the phone is used instead.
   One bar at a trailhead does not fail, it crawls: with no limit the page,
   then each wave of its modules, waited on the phone's own network timeout,
   and the app sat blank for minutes with every file it needed already here. */
const PATIENCE = 3000;

/* Straight from the server, never from the browser's own cache. That cache
   keeps files for ten minutes on GitHub Pages, and a shell that took
   yesterday's app.js from it beside today's call.js cannot start. */
const fresh = (u) => new Request(u, { cache: 'reload' });

/* An update installs ALL of the shell or none of it. Letting the odd file fail
   and carrying on gave a worker that activated, deleted the last working cache,
   and then could not start the app at all without signal — the update turned a
   working offline app into a blank screen, in the one place it is needed.
   addAll is all-or-nothing: if any of it fails the install fails, this worker is
   thrown away, and the one already installed carries on serving. */
self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(V);
    await c.addAll(SHELL.map(fresh));
    await Promise.all(EXTRAS.map(u => c.add(fresh(u)).catch(() => {})));
    // Pinned versions never change, so one already kept is not fetched again.
    const tiles = await caches.open(TILES);
    await Promise.all(VENDOR.map(u => tiles.match(u).then(hit => hit || tiles.add(u)).catch(() => {})));
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
      /* Only this app's own old versions. The tiles are meant to outlive an
         update, and a cache some other code keeps (Mapbox keeps its own tile
         store) is not this worker's to clear. */
      const keys = await caches.keys();
      await Promise.all(keys.filter(k => k.startsWith('trailcraft-v') && k !== V).map(k => caches.delete(k)));
    }
    await trimTiles();
    await self.clients.claim();
  })());
});

const cacheable = (url) =>
  /* Mapbox's count of the map being opened is a question, not a file. Kept in
     a cache that now outlives updates, it would be answered from the phone
     for good and the opens never counted. */
  !url.pathname.startsWith('/map-sessions/') && (
    /mapbox|openstreetmap|jsdelivr|fonts\.(googleapis|gstatic)\.com/.test(url.hostname)
    // The Firebase SDK, so signing in never stands between a handler and a trail offline.
    || (url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/')));

/* Mapbox adds a billing token (sku) to every tile address, and makes a new one
   each time the map opens. Kept in the address, yesterday's tiles never matched
   today's requests, and the tiles cached at home were no use in the wood. */
function tileKey(req) {
  const url = new URL(req.url);
  if (!url.searchParams.has('sku')) return req.url;
  url.searchParams.delete('sku');
  return url.href;
}

/* Only pictures are ever thrown away: tiles by their z/x/y address, and the
   small satellite squares behind session cards. The libraries, styles and
   fonts beside them are a handful of files the map cannot draw without, and
   losing one blanks the whole map rather than one corner of it. */
function isPicture(address) {
  const path = new URL(address).pathname;
  return /\/\d+\/\d+\/\d+(@\d+x)?(\.\w+)+$/.test(path) || path.includes('/static/');
}

async function trimTiles() {
  const c = await caches.open(TILES);
  const pictures = (await c.keys()).filter(r => isPicture(r.url));
  const over = pictures.length - TILE_LIMIT;
  if (over > 0) await Promise.all(pictures.slice(0, over).map(r => c.delete(r)));   // oldest first
}

const wait = (ms, value) => new Promise(done => setTimeout(() => done(value), ms));
const SLOW = Symbol('slow');

/* A page and every module it imports must come from one build. A module from
   the network beside another from an older cache fails to link, and the app
   does not start. So each page load decides once where its files come from,
   and every file it then asks for follows that decision. */
let latest = null;   // { id, fromCache, sameBuild }

function loadFor(e) {
  if (!latest) return null;   // the worker was restarted since the page loaded
  return !latest.id || latest.id === e.clientId ? latest : null;
}

/* Whether the server is still on the build this cache holds. Only then can a
   file that is slow to arrive be swapped for its cached copy without mixing. */
async function sameBuild(shell) {
  const [mine, live] = await Promise.all([
    shell.match('build.txt').then(r => r ? r.text() : null).catch(() => null),
    Promise.race([
      fetch('build.txt', { cache: 'no-store' }).then(r => r.ok ? r.text() : null),
      wait(PATIENCE, null),
    ]).catch(() => null),
  ]);
  return !!mine && !!live && mine.trim() === live.trim();
}

async function openPage(e) {
  const shell = await caches.open(V);
  const probe = sameBuild(shell);
  // Checked with the server like every module: an old page beside new modules is two builds too.
  const net = fetch(e.request, { cache: 'no-cache' }).catch(() => null);
  /* The page itself falls back to the shell; a missing script does not.
     Handing index.html to an import request answers a module with a page
     of HTML, and the error that follows says nothing about what is wrong. */
  const saved = (await shell.match(e.request)) || (await shell.match('index.html'));
  const res = saved ? await Promise.race([net, wait(PATIENCE, SLOW)]) : await net;
  const fromCache = !res || res === SLOW;
  latest = {
    id: e.resultingClientId || null,
    fromCache,
    sameBuild: fromCache ? Promise.resolve(true) : probe,
  };
  return fromCache ? (saved || Response.error()) : res;
}

async function shellFile(e) {
  const shell = await caches.open(V);
  const saved = await shell.match(e.request);
  const load = loadFor(e);
  // The page came from the phone, so everything it asks for does too.
  if (load?.fromCache) return saved || Response.error();
  /* 'no-cache' asks the server every time (a quick "unchanged" when nothing
     is), so the browser's cache cannot mix builds into one load either. */
  const net = fetch(e.request, { cache: 'no-cache' }).catch(() => null);
  if (!saved) return (await net) || Response.error();
  const first = await Promise.race([net, wait(PATIENCE, SLOW)]);
  if (first === null) return saved;         // no network at all: the copy on the phone is all there is
  if (first !== SLOW) return first;
  if (load && await load.sameBuild) return saved;
  return (await net) || saved;
}

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // Never cache weather — a stale reading in a training record is worse than none.
  if (url.hostname === 'api.open-meteo.com') return;

  if (url.origin === location.origin) {
    /* The build stamp is a question for the server. A cached answer would
       only ever say that nothing has changed. */
    if (url.pathname.endsWith('/build.txt')) return;
    /* App shell: network-first, so an edit always lands, but only for as long
       as the network is quick. Nothing here writes to the shell's cache: only
       an install does, all of it at once, so the copy kept for the wood is
       always one whole build. */
    e.respondWith(e.request.mode === 'navigate' ? openPage(e) : shellFile(e));
    return;
  }

  // Tiles and pinned vendor files are immutable — cache-first is correct, and
  // it is what makes the map usable in a wood with no signal.
  if (!cacheable(url)) return;
  e.respondWith((async () => {
    const tiles = await caches.open(TILES);
    const key = tileKey(e.request);
    const hit = await tiles.match(key, { ignoreVary: true });
    if (hit) return hit;
    /* The lettering is the one outside file the page waits on before it draws
       anything, so on one bar it gets a few seconds and then the phone's own
       letters are used. A map tile that is slow only leaves a gap in the map,
       and the map software is large enough that a slow link genuinely needs
       longer, so those wait as long as the network does. */
    const fonts = /^fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
    const res = fonts
      ? await Promise.race([fetch(e.request), wait(PATIENCE * 2, null)]) ?? Response.error()
      : await fetch(e.request);
    if (res.ok) e.waitUntil(keepTile(tiles, key, res.clone()));
    return res;
  })());
});

/* Trimmed on the first new tile after the worker starts and every 200 after,
   so the cache stays bounded between updates as well as at them. */
let kept = 0;
async function keepTile(tiles, key, res) {
  await tiles.put(key, res).catch(() => { /* a full phone: the map still shows it this time */ });
  if (kept++ % 200 === 0) await trimTiles();
}
