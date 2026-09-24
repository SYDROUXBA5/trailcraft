/* The service worker, run for real against a pretend network and cache.

   It is the part of the app nobody sees until the signal goes, and then it
   is the whole app. Reading its source proves little about what it does on
   one bar at a trailhead, so this runs sw.js itself in a sandbox: the
   network can answer, fail or hang file by file, the clock is moved by
   hand, and the caches are plain maps that can be looked into afterwards. */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

let pass = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);

const src = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
const BASE = 'https://example.test/trailcraft/';
const abs = (u) => new URL(u, BASE).href;
const urlOf = (r) => (typeof r === 'string' ? abs(r) : r.url).split('#')[0];

/** Enough of Request for the worker: an address, resolved as a worker would. */
class FakeRequest {
  constructor(input, init = {}) {
    this.url = urlOf(input);
    this.method = 'GET';
    this.mode = init.mode ?? 'cors';
    this.cache = init.cache ?? 'default';
  }
}

/** A cache as the Cache API keeps one: by address, in the order written. */
class FakeCache {
  constructor(world) { this.world = world; this.m = new Map(); }
  async match(r) { const hit = this.m.get(urlOf(r)); return hit ? hit.clone() : undefined; }
  async put(r, res) { const k = urlOf(r); this.m.delete(k); this.m.set(k, res.clone()); }
  async add(r) {
    const res = await this.world.fetch(r);
    if (!res.ok) throw new TypeError(`${urlOf(r)} answered ${res.status}`);
    await this.put(r, res);
  }
  async addAll(rs) {
    // All-or-nothing, as the real one is: one failure and nothing is written.
    const all = await Promise.all(rs.map(r => this.world.fetch(r)));
    if (!all.every(res => res.ok)) throw new TypeError('a file failed');
    for (let i = 0; i < rs.length; i++) await this.put(rs[i], all[i]);
  }
  async keys() { return [...this.m.keys()].map(u => new FakeRequest(u)); }
  async delete(r) { return this.m.delete(urlOf(r)); }
  async text(u) { const hit = await this.match(u); return hit ? hit.text() : undefined; }
}

/** Lets everything that can finish without the clock moving finish. */
const settle = async () => { for (let i = 0; i < 30; i++) await new Promise(r => setImmediate(r)); };

const hang = () => new Promise(() => {});

/** A server answering from a table of files; anything else is a 404. */
const serve = (files, { slow = () => false, down = false } = {}) => (url) => {
  if (down) return Promise.reject(new TypeError('offline'));
  if (slow(url)) return hang();
  const body = files[url.startsWith(BASE) ? url.slice(BASE.length) : url] ?? files[url];
  return Promise.resolve(body == null ? new Response('missing', { status: 404 }) : new Response(body));
};

function worker() {
  const listeners = {};
  const stores = new Map();
  const timers = [];
  const world = {
    net: serve({}, { down: true }),
    fetched: [],
    fetch: (r, init) => { const url = urlOf(r); world.fetched.push({ url, cache: init?.cache ?? r.cache }); return world.net(url); },
  };
  const box = {
    Request: FakeRequest, Response, URL,
    location: new URL(`${BASE}sw.js`),
    setTimeout: (fn) => { timers.push(fn); return timers.length; },
    fetch: (r, init) => world.fetch(r, init),
    caches: {
      open: async (n) => { if (!stores.has(n)) stores.set(n, new FakeCache(world)); return stores.get(n); },
      keys: async () => [...stores.keys()],
      delete: async (n) => stores.delete(n),
      match: async (r) => {
        for (const c of stores.values()) { const hit = await c.match(r); if (hit) return hit; }
      },
    },
    addEventListener: (type, fn) => { listeners[type] = fn; },
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
  };
  box.self = box;
  vm.createContext(box);
  vm.runInContext(src, box);
  const read = (expr) => vm.runInContext(expr, box);

  const lifecycle = async (type) => {
    const waits = [];
    listeners[type]({ waitUntil: p => waits.push(p) });
    await Promise.all(waits);
  };

  /** Asks the worker for a file. Quick answers come back at once; anything
      still waiting when the clock is moved on may be answered from the cache,
      and whatever is still waiting after that comes back as `later`. */
  const ask = async (u, { navigate = false, client = 'page' } = {}) => {
    const e = {
      request: { url: abs(u), method: 'GET', mode: navigate ? 'navigate' : 'cors' },
      clientId: navigate ? '' : client,
      resultingClientId: navigate ? client : '',
      respondWith(p) { this.answer = Promise.resolve(p); },
      waits: [], waitUntil(p) { this.waits.push(p); },
    };
    listeners.fetch(e);
    if (!e.answer) return { passedThrough: true };
    let out = { pending: true };
    e.answer.then(res => { out = { res }; }, err => { out = { err }; });
    await settle();
    if (out.pending) { while (timers.length) timers.shift()(); await settle(); }
    await Promise.all(e.waits);
    return { ...out, later: e.answer };
  };

  return { world, stores, read, lifecycle, ask, cache: (n) => box.caches.open(n) };
}

/** Every file the worker installs, each stamped with a build. */
function buildOf(w, tag) {
  const files = { 'build.txt': tag, 'manifest.webmanifest': '{}' };
  for (const u of w.read('SHELL')) files[abs(u).slice(BASE.length)] = `${u} @ ${tag}`;
  for (const u of w.read('VENDOR')) files[u] = 'pinned library';
  return files;
}

async function installed(tag = 'A') {
  const w = worker();
  w.world.net = serve(buildOf(w, tag));
  await w.lifecycle('install');
  await w.lifecycle('activate');
  return w;
}

const bodyOf = async (out) => {
  assert.ok(out.res, 'the worker answered');
  return out.res.text();
};

/* ── Install and activate ─────────────────────────────────────────── */

t('an update installs the whole shell straight from the server, or none of it', async () => {
  const w = worker();
  const files = buildOf(w, 'A');
  w.world.net = serve(files);
  await w.lifecycle('install');
  const V = w.read('V');
  const shell = await w.cache(V);
  for (const u of w.read('SHELL')) assert.equal(await shell.text(u), files[abs(u).slice(BASE.length)], `${u} is kept`);
  /* The browser's own cache holds files for ten minutes: an install taken
     partly from it can hold two builds. */
  const shellFetches = w.world.fetched.filter(f => f.url.startsWith(BASE));
  assert.ok(shellFetches.length >= w.read('SHELL').length);
  assert.ok(shellFetches.every(f => f.cache === 'reload'), 'every shell file comes from the server itself');

  const broken = worker();
  const partial = buildOf(broken, 'B');
  delete partial['call.js'];
  broken.world.net = serve(partial);
  await assert.rejects(broken.lifecycle('install'), 'one missing file fails the whole install');
  assert.deepEqual([...(await broken.cache(broken.read('V'))).m.keys()], [], 'and nothing of it is kept');
});

t('an update clears only its own old versions, and the map tiles outlive it', async () => {
  const w = worker();
  const V = w.read('V');
  const TILES = w.read('TILES');
  assert.ok(!TILES.startsWith('trailcraft-v'), 'the tile cache is never taken for an old version');
  const tile = 'https://api.mapbox.com/v4/mapbox.satellite/17/64000/42000@2x.webp?access_token=pk.x';
  await (await w.cache('trailcraft-v1')).put('app.js', new Response('old'));
  await (await w.cache(TILES)).put(tile, new Response('tile'));
  await (await w.cache('mapbox-tiles')).put(tile, new Response('mapbox keeps its own'));
  w.world.net = serve(buildOf(w, 'A'));
  await w.lifecycle('install');
  await w.lifecycle('activate');
  assert.deepEqual([...w.stores.keys()].sort(), ['mapbox-tiles', TILES, V].sort());
  assert.equal(await (await w.cache(TILES)).text(tile), 'tile', 'the tile panned over last night is still here');
});

t('an old version is kept while the new one is incomplete', async () => {
  const w = worker();
  await (await w.cache('trailcraft-v1')).put('app.js', new Response('old'));
  await (await w.cache(w.read('V'))).put('index.html', new Response('half an install'));
  await w.lifecycle('activate');
  assert.ok(w.stores.has('trailcraft-v1'));
});

/* ── Map tiles ────────────────────────────────────────────────────── */

t('a tile cached yesterday is found today, though Mapbox has changed its billing token', async () => {
  const w = await installed();
  const at = (sku) => `https://api.mapbox.com/v4/mapbox.satellite/17/64000/42000@2x.webp?sku=${sku}&access_token=pk.x`;
  w.world.net = serve({ [at('yesterday')]: 'the tile' });
  assert.equal(await bodyOf(await w.ask(at('yesterday'))), 'the tile');
  w.world.net = serve({}, { down: true });
  assert.equal(await bodyOf(await w.ask(at('today'))), 'the tile', 'found without the network');
});

t('the tile cache is bounded, and never trims what the map cannot draw without', async () => {
  const w = await installed();
  const TILES = w.read('TILES');
  const LIMIT = w.read('TILE_LIMIT');
  const tiles = await w.cache(TILES);
  const style = 'https://api.mapbox.com/styles/v1/mapbox/standard-satellite?access_token=pk.x';
  const glyphs = 'https://api.mapbox.com/fonts/v1/mapbox/DIN%20Pro%20Medium/0-255.pbf?access_token=pk.x';
  await tiles.put(style, new Response('style'));
  await tiles.put(glyphs, new Response('glyphs'));
  const tile = (i) => `https://api.mapbox.com/v4/mapbox.satellite/17/${i}/42000@2x.webp?access_token=pk.x`;
  for (let i = 0; i < LIMIT + 50; i++) await tiles.put(tile(i), new Response('t'));
  // A new tile arriving between updates is enough to trim it.
  w.world.net = serve({ [tile(99999)]: 'new' });
  await w.ask(tile(99999));
  const left = [...tiles.m.keys()];
  const pictures = left.filter(u => u.includes('/v4/'));
  assert.ok(pictures.length <= LIMIT, `${pictures.length} tiles kept, the limit is ${LIMIT}`);
  assert.ok(!left.includes(tile(0)), 'the oldest go first');
  assert.ok(left.includes(tile(99999)), 'the newest stays');
  assert.ok(left.includes(style) && left.includes(glyphs), 'the style and fonts are never trimmed');
  for (const u of w.read('VENDOR')) assert.ok(left.includes(u), `${u} is never trimmed`);
});

/* ── The app on a bad connection ──────────────────────────────────── */

t('on one bar the app opens from the phone instead of waiting on the network', async () => {
  const w = await installed('A');
  w.world.net = serve(buildOf(w, 'A'), { slow: () => true });
  assert.equal(await bodyOf(await w.ask('./', { navigate: true })), './ @ A');
  assert.equal(await bodyOf(await w.ask('app.js')), 'app.js @ A');
  assert.equal(await bodyOf(await w.ask('call.js')), 'call.js @ A');
});

t('a page that came from the phone takes every module from the phone, so builds never mix', async () => {
  const w = await installed('A');
  // A new build is live, and only the page itself is slow to come.
  w.world.net = serve(buildOf(w, 'B'), { slow: u => u === BASE });
  assert.equal(await bodyOf(await w.ask('./', { navigate: true })), './ @ A');
  assert.equal(await bodyOf(await w.ask('app.js')), 'app.js @ A', 'not the new build beside the old page');
  assert.equal(await bodyOf(await w.ask('call.js')), 'call.js @ A');
});

t('when the server is on a new build, a slow module waits for it instead of mixing in the old one', async () => {
  const w = await installed('A');
  let deliver;
  const late = new Promise(r => { deliver = r; });
  const files = buildOf(w, 'B');
  const net = serve(files);
  w.world.net = (u) => (u === abs('call.js') ? late : net(u));
  assert.equal(await bodyOf(await w.ask('./', { navigate: true })), './ @ B');
  const first = await w.ask('call.js');
  assert.ok(first.pending, 'the old copy is not handed over beside a new page');
  deliver(new Response(files['call.js']));
  assert.equal(await (await first.later).text(), 'call.js @ B');
});

t('on the same build, a slow module is swapped for its copy on the phone', async () => {
  const w = await installed('A');
  w.world.net = serve(buildOf(w, 'A'), { slow: u => u === abs('call.js') });
  assert.equal(await bodyOf(await w.ask('./', { navigate: true })), './ @ A');
  assert.equal(await bodyOf(await w.ask('call.js')), 'call.js @ A');
});

t('nothing fetched while the app runs is written into the copy kept for offline', async () => {
  const w = await installed('A');
  w.world.net = serve(buildOf(w, 'B'));
  await w.ask('./', { navigate: true });
  for (const u of w.read('SHELL')) if (u !== './') assert.equal(await bodyOf(await w.ask(u)), `${u} @ B`);
  const shell = await w.cache(w.read('V'));
  for (const u of w.read('SHELL')) assert.equal(await shell.text(u), `${u} @ A`, `${u} is still one whole build`);
  /* The browser keeps files for ten minutes, so it is asked to check each one
     with the server, the page as much as its modules. */
  for (const u of ['./', 'app.js']) {
    const asked = w.world.fetched.filter(f => f.url === abs(u)).pop();
    assert.equal(asked.cache, 'no-cache', `${u} is checked with the server`);
  }
});

t('with no signal a page falls back to the app, and a missing script is an error, never the page', async () => {
  const w = await installed('A');
  w.world.net = serve({}, { down: true });
  assert.equal(await bodyOf(await w.ask('./?live=abc', { navigate: true })), 'index.html @ A');
  const out = await w.ask('nothere.js');
  assert.equal(out.res.type, 'error');
});

t('the build stamp, the weather and Mapbox counting an open always go to the network', async () => {
  const w = await installed('A');
  assert.ok((await w.ask('build.txt')).passedThrough);
  assert.ok((await w.ask('https://api.open-meteo.com/v1/forecast?x=1')).passedThrough, 'weather is never cached');
  assert.ok((await w.ask('https://api.mapbox.com/map-sessions/v1?access_token=pk.x')).passedThrough,
    'nor Mapbox counting a map being opened, now that tiles are kept for good');
});

for (const [name, fn] of tests) {
  await fn();
  pass++;
  console.log(`  ok  ${name}`);
}
console.log(`\n${pass} passed total\n`);
