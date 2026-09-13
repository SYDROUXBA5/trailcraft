/* Trailcraft — scent-work training record, paper edition.

   One person: the handler. A layer walks a trail or places a hide; the handler
   runs the dog and reads one honest sentence about what the dog did with the
   scent. The engine (geo/field/sim/card) is untouched; everything visible is
   this file. Map: Mapbox satellite + 3D with a token, MapLibre street map
   without. Weather: Open-Meteo, the one public API with soil temperature. */

import {
  pathLen, cardinal, dist, dwellFold, bearing,
  scentField, plumePolygon, densify, timestamps,
  signedOffsets, meanSigned, sideOfDrift, sideAgreement, lineCorrect, departure,
} from './geo.js';
import { FLAT, buildTerrain, stability, regime } from './field.js';
import { predictedOffsets } from './sim.js';
import { encodeTrail, decodeTrail } from './card.js';
import { createStore, migrateV1, TARGETS, targetById, verbs, uid } from './store.js';

/* The stamp a phone cannot lie about. Bump with every change. */
const BUILD = '2026-09-13e';

/* ── Settings & store ─────────────────────────────────────────────── */
const DEFAULTS = { accCap: 25, stillCap: 2.5, exagg: 2.4, mbToken: (window.MB_TOKEN || '') };
const loadJson = (k, f) => { try { return JSON.parse(localStorage.getItem(k)) ?? f; } catch { return f; } };
let settings = { ...DEFAULTS, ...loadJson('tc.settings', {}) };
const saveSettings = () => localStorage.setItem('tc.settings', JSON.stringify(settings));

/* A device can be handed its Mapbox token in the app's own link (#mbt=pk.xxx),
   because the token cannot ship inside the public repository. */
{
  const mbt = new URLSearchParams(location.hash.slice(1)).get('mbt');
  if (mbt && /^pk\./.test(mbt)) {
    settings.mbToken = mbt;
    saveSettings();
    history.replaceState(null, '', location.pathname + location.search);
  }
}

const db = createStore(localStorage);
const migrated = migrateV1(localStorage, db);

/** The resolved state every screen reads. Refreshed after every write. */
let S = db.snapshot();
const snap = () => { S = db.snapshot(); return S; };

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtDur = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const fmtKm = (m) => m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
const fmtWhen = (t) => new Date(t).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

const toast = (msg) => {
  const t = $('toast'); t.textContent = msg; t.hidden = false;
  requestAnimationFrame(() => t.classList.add('show'));
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    t.classList.remove('show');
    toast._gone = setTimeout(() => { t.hidden = true; }, 200);
  }, 2100);
  clearTimeout(toast._gone);
};

/* Photos live in localStorage, so they are cropped square and downscaled hard:
   an avatar needs 320px, not a 12-megapixel original. */
function pickPhoto(cb) {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*';
  inp.onchange = () => {
    const f = inp.files?.[0]; if (!f) return;
    const img = new Image();
    img.onload = () => {
      const side = Math.min(img.width, img.height);
      const c = document.createElement('canvas');
      c.width = c.height = Math.min(320, side || 320);
      c.getContext('2d').drawImage(img,
        (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      cb(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(img.src); toast('Could not read that photo'); };
    img.src = URL.createObjectURL(f);
  };
  inp.click();
}

const avaHtml = (ent, cls = '') => {
  const init = esc((ent?.name || '?').trim().charAt(0).toUpperCase() || '?');
  const style = ent?.photo ? ` style="background-image:url(${ent.photo})"` : '';
  return `<span class="ava ${cls}${ent?.photo ? ' has-photo' : ''}"${style}>${init}</span>`;
};

/* ── Screens ──────────────────────────────────────────────────────── */
const SCREENS = ['scrOnboardHandler', 'scrOnboardDog', 'scrTutorial', 'scrHome', 'scrLay',
  'scrConfirm', 'scrShare', 'scrContam', 'scrPick', 'scrScan', 'scrRun', 'scrResult',
  'scrShowMap', 'scrSessions', 'scrSettings', 'scrDraw', 'scrCountdown', 'scrWalk', 'scrWait'];

function go(id) {
  stopScan();
  for (const s of SCREENS) $(s).hidden = s !== id;
  if (id === 'scrHome') renderHome();
  // The map only needs to be right when something transparent sits over it.
  if (['scrLay', 'scrConfirm', 'scrContam', 'scrRun', 'scrShowMap', 'scrDraw', 'scrWalk'].includes(id)) map?.resize();
}

/* ── Map ──────────────────────────────────────────────────────────── */
const EMPTY = { type: 'FeatureCollection', features: [] };
let map, mapReady = false;
let GL = mapboxgl;   // every control/bounds must come from the SAME library
const srcData = { runner: EMPTY, dog: EMPTY, wps: EMPTY, drift: EMPTY, start: EMPTY, hides: EMPTY, contam: EMPTY };

const SAT_STYLE = 'mapbox://styles/mapbox/standard-satellite';
const RASTER_FALLBACK = {
  version: 8,
  sources: { osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
                    tileSize: 256, attribution: '© OpenStreetMap contributors' } },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};

function buildMap() {
  /* mapbox-gl v3 demands a VALID token even for foreign styles, so the
     tokenless install runs MapLibre with plain OSM tiles instead. */
  const noToken = !settings.mbToken;
  GL = (noToken && typeof maplibregl !== 'undefined') ? maplibregl : mapboxgl;
  if (GL === mapboxgl) mapboxgl.accessToken = settings.mbToken || 'pk.tokenless';
  map = new GL.Map({
    container: 'map',
    style: noToken ? RASTER_FALLBACK : SAT_STYLE,
    center: [-2.6449, 51.2094], zoom: 15, pitch: 55, maxPitch: 85,
    attributionControl: { compact: true },
  });
  map.addControl(new GL.GeolocateControl({
    positionOptions: { enableHighAccuracy: true }, trackUserLocation: true, showAccuracyCircle: true,
  }), 'top-right');
  map.on('load', addOverlays);
  setTimeout(watchForBlankMap, 9000);
  new ResizeObserver(() => map.resize()).observe($('map'));
  window.addEventListener('orientationchange', () => setTimeout(() => map.resize(), 250));
}

function addOverlays() {
  if (settings.mbToken) {
    if (!map.getSource('dem')) {
      map.addSource('dem', { type: 'raster-dem', url: 'mapbox://mapbox.mapbox-terrain-dem-v1', tileSize: 512, maxzoom: 14 });
    }
    map.setTerrain({ source: 'dem', exaggeration: Number(settings.exagg) });
    try { map.setConfigProperty('basemap', 'showPointOfInterestLabels', false); } catch { /* not Standard */ }
  }
  for (const id of Object.keys(srcData)) {
    if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: srcData[id] });
  }
  const add = (spec) => { if (!map.getLayer(spec.id)) map.addLayer(spec); };

  // The uncertainty band — filled soft, edged dashed, and only ever shown on
  // the result map. Its width is uncertainty; nothing here narrows it.
  add({ id: 'drift-fill', type: 'fill', source: 'drift',
        paint: { 'fill-color': '#62B6FF', 'fill-opacity': 0.28 } });
  add({ id: 'drift-edge', type: 'line', source: 'drift',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#62B6FF', 'line-width': 1.6, 'line-opacity': 0.55, 'line-dasharray': [1.5, 1.8] } });
  // Contamination trails: same family as the laid trail, visibly not it.
  add({ id: 'contam-line', type: 'line', source: 'contam',
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: { 'line-color': '#C8B8E8', 'line-width': 3.5, 'line-opacity': 0.9, 'line-dasharray': [1, 1.4] } });
  // Dark casings keep both tracks legible over any imagery; the trail is
  // dashed and the dog solid, so colour is never the only difference.
  add({ id: 'runner-casing', type: 'line', source: 'runner',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#17201A', 'line-width': 8, 'line-opacity': 0.55 } });
  add({ id: 'runner-line', type: 'line', source: 'runner',
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: { 'line-color': '#9FDB4F', 'line-width': 4.5, 'line-opacity': 0.98, 'line-dasharray': [2.2, 1.4] } });
  add({ id: 'dog-casing', type: 'line', source: 'dog',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#17201A', 'line-width': 8, 'line-opacity': 0.55 } });
  add({ id: 'dog-line', type: 'line', source: 'dog',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#E8793F', 'line-width': 4.5, 'line-opacity': 0.98 } });
  add({ id: 'hide-dots', type: 'circle', source: 'hides',
        paint: { 'circle-radius': 9, 'circle-color': '#D9662B',
                 'circle-stroke-width': 2.5, 'circle-stroke-color': '#FFFDF8' } });
  add({ id: 'start-dot', type: 'circle', source: 'start',
        paint: { 'circle-radius': 9, 'circle-color': '#2F9E44',
                 'circle-stroke-width': 2.5, 'circle-stroke-color': '#FFFDF8' } });
  add({ id: 'start-text', type: 'symbol', source: 'start',
        layout: { 'text-field': 'Start', 'text-size': 12, 'text-offset': [0, 1.3], 'text-anchor': 'top' },
        paint: { 'text-color': '#FFFDF8', 'text-halo-color': '#17201A', 'text-halo-width': 1.6 } });
  add({ id: 'wp-dots', type: 'circle', source: 'wps',
        paint: { 'circle-radius': 7, 'circle-color': '#FFFDF8',
                 'circle-stroke-width': 2, 'circle-stroke-color': '#17201A' } });
  add({ id: 'wp-text', type: 'symbol', source: 'wps',
        layout: { 'text-field': ['get', 'kind'], 'text-size': 11, 'text-offset': [0, 1.4], 'text-anchor': 'top' },
        paint: { 'text-color': '#FFFDF8', 'text-halo-color': '#17201A', 'text-halo-width': 1.6 } });

  mapReady = true;
  for (const id of Object.keys(srcData)) map.getSource(id)?.setData(srcData[id]);
  map.resize();
}

/* MapLibre requests tiles from inside its rAF loop, so a hidden tab loads
   nothing — only treat an empty map as broken once the page is visible. */
function watchForBlankMap() {
  if (mapReady) return;
  if (document.visibilityState !== 'visible') return setTimeout(watchForBlankMap, 5000);
  toast('Map style would not load — using the basic map');
  map.setStyle(RASTER_FALLBACK);
  map.once('styledata', addOverlays);
}

const lineOf = (pts) => !pts || pts.length < 2 ? EMPTY : {
  type: 'FeatureCollection',
  features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: pts.map(p => [p.lon, p.lat]) } }],
};
const pointsOf = (pts, kindKey) => ({
  type: 'FeatureCollection',
  features: (pts || []).map(p => ({
    type: 'Feature', properties: kindKey ? { kind: p[kindKey] } : {},
    geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
  })),
});
function setSrc(id, data) {
  srcData[id] = data;
  if (mapReady && map.getSource(id)) map.getSource(id).setData(data);
}
const clearMap = () => { for (const id of Object.keys(srcData)) setSrc(id, EMPTY); };

function fitTo(...groups) {
  const pts = groups.flat().filter(Boolean);
  if (!pts.length || !mapReady) return;
  if (pts.length === 1) return map.easeTo({ center: [pts[0].lon, pts[0].lat], zoom: 16 });
  const b = new GL.LngLatBounds();
  pts.forEach(p => b.extend([p.lon, p.lat]));
  map.fitBounds(b, { padding: 80, pitch: 45, duration: 700 });
}

/* ── Weather (Open-Meteo, 15-minute series incl. soil temperature) ── */
const WX_VARS = [
  'temperature_2m', 'relative_humidity_2m', 'dew_point_2m', 'wind_speed_10m',
  'wind_direction_10m', 'wind_gusts_10m', 'soil_temperature_0cm',
  'precipitation', 'surface_pressure',
].join(',');
const MAP_VARS = {
  temp: 'temperature_2m', humidity: 'relative_humidity_2m', dew_point: 'dew_point_2m',
  wind_speed: 'wind_speed_10m', wind_direction: 'wind_direction_10m',
  wind_gusts: 'wind_gusts_10m', soil_temp: 'soil_temperature_0cm',
  precipitation: 'precipitation', pressure: 'surface_pressure',
};
const SERIES_SPAN = 6 * 3600e3;

async function fetchWeather(lat, lon, when) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}`
    + `&minutely_15=${WX_VARS}&past_days=2&forecast_days=3&timezone=auto&wind_speed_unit=ms`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`weather ${res.status}`);
  const j = await res.json();
  const block = j.minutely_15 || j.hourly;
  if (!block?.time?.length) throw new Error('weather: empty response');
  const times = block.time.map(t => new Date(t).getTime());
  let best = 0, bestGap = Infinity;
  times.forEach((t, i) => { const g = Math.abs(t - when); if (g < bestGap) { bestGap = g; best = i; } });
  const at = (k, i = best) => block[MAP_VARS[k]]?.[i] ?? null;
  const snapshot = { time: block.time[best], gap: bestGap };
  for (const k of Object.keys(MAP_VARS)) snapshot[k] = at(k);
  const series = [];
  times.forEach((t, i) => {
    if (Math.abs(t - when) > SERIES_SPAN) return;
    const s = { t };
    for (const k of Object.keys(MAP_VARS)) s[k] = at(k, i);
    if (s.wind_speed != null || s.temp != null) series.push(s);
  });
  return { ...snapshot, series };
}

/* ── Terrain (read straight out of the map's own DEM) ─────────────── */
const TERRAIN_N = 44;

function squareBbox(points, marginM = 90) {
  let west = Infinity, east = -Infinity, north = -Infinity, south = Infinity;
  for (const p of points) {
    west = Math.min(west, p.lon); east = Math.max(east, p.lon);
    north = Math.max(north, p.lat); south = Math.min(south, p.lat);
  }
  const cLat = (north + south) / 2, cLon = (west + east) / 2;
  const mLat = 111320, mLon = 111320 * Math.cos(cLat * Math.PI / 180) || 1;
  const side = Math.max((east - west) * mLon, (north - south) * mLat) + marginM * 2;
  const hLon = side / 2 / mLon, hLat = side / 2 / mLat;
  return { west: cLon - hLon, east: cLon + hLon, north: cLat + hLat, south: cLat - hLat, side };
}

function waitIdle(ms) {
  return new Promise((res) => {
    if (map.isStyleLoaded?.() && map.areTilesLoaded?.()) return res();
    const done = () => { clearTimeout(tm); map.off('idle', done); res(); };
    const tm = setTimeout(done, ms);
    map.on('idle', done);
  });
}

async function terrainFor(points, marginM = 90) {
  if (!points?.length || !mapReady || typeof map.queryTerrainElevation !== 'function') return FLAT;
  const b = squareBbox(points, marginM);
  await waitIdle(3000);
  const n = TERRAIN_N, h = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const lat = b.north - (b.north - b.south) * (j / (n - 1));
    const lon = b.west + (b.east - b.west) * (i / (n - 1));
    let e = null;
    try { e = map.queryTerrainElevation({ lng: lon, lat }, { exaggerated: false }); } catch { /* not ready */ }
    if (e == null || !Number.isFinite(e)) return FLAT;   // a partial grid invents cliffs
    h[j * n + i] = e;
  }
  return buildTerrain(h, n, b.side / (n - 1), b);
}

/* ── Onboarding ───────────────────────────────────────────────────── */

/* One pair of forms serves first launch AND later edits: obMode says which. */
let obMode = { type: 'handler', id: null, returnTo: null };
let obPhoto = null;

function openHandlerForm({ id = null, returnTo = null, firstLaunch = false } = {}) {
  obMode = { type: 'handler', id, returnTo, firstLaunch };
  const existing = id ? db.handlers.byId(id) : null;
  obPhoto = existing?.photo ?? null;
  $('obHandlerName').value = existing?.name ?? '';
  $('scrOnboardHandler').querySelector('.label').textContent = firstLaunch ? 'Step 1 of 3' : 'Handler';
  $('obHandlerNext').textContent = firstLaunch ? 'Next: your dog' : 'Save';
  paintObAva('obHandlerAva', existing?.name);
  go('scrOnboardHandler');
}

function openLayerForm({ id = null, returnTo = 'scrHome' } = {}) {
  obMode = { type: 'layer', id, returnTo };
  const existing = id ? db.layers.byId(id) : null;
  obPhoto = existing?.photo ?? null;
  $('obHandlerName').value = existing?.name ?? '';
  $('scrOnboardHandler').querySelector('.label').textContent = 'Lays trails or sets hides';
  $('scrOnboardHandler').querySelector('.display').textContent = 'Who lays for you';
  $('obHandlerNext').textContent = 'Save';
  paintObAva('obHandlerAva', existing?.name);
  go('scrOnboardHandler');
}

function saveHandlerForm() {
  const name = $('obHandlerName').value.trim();
  if (!name) return toast('A name is enough — add one');
  if (obMode.type === 'layer') {
    db.layers.upsert({ id: obMode.id ?? uid(), name, photo: obPhoto });
  } else {
    const id = obMode.id ?? uid();
    db.handlers.upsert({ id, name, photo: obPhoto });
    db.kv.set('lastHandlerId', id);
  }
  snap();
  // Reset the shared form's wording for its next use.
  $('scrOnboardHandler').querySelector('.display').textContent = 'You, the handler';
  if (obMode.firstLaunch) return openDogForm({ firstLaunch: true });
  go(obMode.returnTo || 'scrHome');
}

let obDogLevel = 'Hot';
function openDogForm({ id = null, handlerId = null, returnTo = null, firstLaunch = false } = {}) {
  obMode = { type: 'dog', id, handlerId: handlerId ?? S.handler?.id, returnTo, firstLaunch };
  const existing = id ? db.dogs.byId(id) : null;
  obPhoto = existing?.photo ?? null;
  obDogLevel = existing?.level ?? 'Hot';
  $('obDogName').value = existing?.name ?? '';
  $('obDogLine').value = existing?.lineM ?? 10;
  $('scrOnboardDog').querySelector('.label').textContent = firstLaunch ? 'Step 2 of 3' : 'Dog';
  $('obDogTitle').textContent = firstLaunch ? 'Your dog' : (existing ? existing.name : 'A new dog');
  $('obDogSub').hidden = !firstLaunch;
  $('obDogNext').textContent = firstLaunch ? 'Next: how it works' : 'Save';
  paintDogLevel();
  paintObAva('obDogAva', existing?.name);
  go('scrOnboardDog');
}

function paintDogLevel() {
  $('obDogLevel').querySelectorAll('.radio-card').forEach(b =>
    b.classList.toggle('selected', b.dataset.level === obDogLevel));
}
function paintObAva(id, name) {
  const a = $(id);
  a.classList.toggle('has-photo', !!obPhoto);
  a.style.backgroundImage = obPhoto ? `url(${obPhoto})` : '';
  a.textContent = (name || '?').trim().charAt(0).toUpperCase() || '+';
}

function saveDogForm() {
  const name = $('obDogName').value.trim();
  if (!name) return toast("The dog needs a name");
  const lineM = Math.max(0, parseFloat(String($('obDogLine').value).replace(',', '.')) || 0);
  const id = obMode.id ?? uid();
  db.dogs.upsert({ id, handlerId: obMode.handlerId, name, photo: obPhoto, level: obDogLevel, lineM });
  db.kv.set('lastDogId', id);
  snap();
  if (obMode.firstLaunch) return openTutorial(false);
  go(obMode.returnTo || 'scrHome');
}

/* ── Tutorial: five cards a handler would say to another handler ──── */
const TUT_CARDS = [
  { k: '01', title: 'Two people, one dog.', body: 'Someone walks a trail and waits at the end. You run the dog along it. Trailcraft records both, and the weather that day.' },
  { k: '02', title: 'Lay it with the phone in your pocket.', body: 'Press Start, walk, press Stop. The recording keeps going with the screen locked. Standing still does not scribble the line.' },
  { k: '03', title: 'Hand it over with a card.', body: 'The trail becomes a code on the screen. The handler scans it and their phone knows the trail, when it was laid, and the wind at the time. No signal needed.' },
  { k: '04', title: 'Run blind.', body: 'While the dog works, the trail stays hidden. Mark what you see: an indication, a loss, a re-find, an article. Your line length is already accounted for.' },
  { k: '05', title: 'Then read one sentence.', body: '"Bo worked 9 m right of the line. The wind pushed scent right." The model explains what the dog did. It never claims to know where scent is.' },
];
let tut = { i: 0, replay: false };

function openTutorial(replay) {
  tut = { i: 0, replay };
  $('tutSkip').textContent = replay ? 'Close' : 'Skip';
  paintTut();
  go('scrTutorial');
}
function paintTut() {
  const c = TUT_CARDS[tut.i], last = tut.i === TUT_CARDS.length - 1;
  $('tutK').textContent = c.k;
  $('tutTitle').textContent = c.title;
  $('tutBody').textContent = c.body;
  $('tutDots').innerHTML = TUT_CARDS.map((_, k) => `<span class="tut-dot${k === tut.i ? ' on' : ''}"></span>`).join('');
  $('tutNext').textContent = last ? (tut.replay ? 'Done' : 'Start using Trailcraft') : 'Next';
}
function finishTutorial() {
  db.kv.set('tutorialDone', true);
  snap();
  go(tut.replay ? 'scrSettings' : 'scrHome');
}

/* ── Home ─────────────────────────────────────────────────────────── */
const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Morning' : h < 18 ? 'Afternoon' : 'Evening';
};

function renderHome() {
  snap();
  const { handler, handlers, team, dog, layers, layer, target } = S;
  if (!handler) return;
  const v = verbs(target);

  $('homeGreet').textContent = `${greeting()}, ${handler.name}`;
  $('homeSettings').innerHTML = avaHtml(handler);

  $('rowHandlers').innerHTML = handlers.map(h =>
    `<button class="chip${h.id === handler.id ? ' selected' : ''}" data-handler="${h.id}">${avaHtml(h)}${esc(h.name)}</button>`).join('')
    + `<button class="chip ghost" data-add-handler>+ Add handler</button>`;

  $('lblDogs').textContent = `${handler.name}'s dogs`;
  $('rowDogs').innerHTML = team.map(d =>
    `<button class="chip${d.id === dog?.id ? ' selected' : ''}" data-dog="${d.id}">${avaHtml(d)}<span class="who">${esc(d.name)}<i class="sub">${esc(d.level)}</i></span></button>`).join('')
    + `<button class="chip ghost" data-add-dog>+ Add dog</button>`;

  $('rowTargets').innerHTML = TARGETS.map(t =>
    `<button class="chip plain${t.id === target.id ? ' selected' : ''}" data-target="${t.id}"><b>${esc(t.label)}</b><i>${esc(t.sub)}</i></button>`).join('');

  $('lblSetter').textContent = v.setter;
  $('rowLayers').innerHTML =
    `<button class="chip${!layer ? ' selected' : ''}" data-layer=""><span class="who">Just me<i class="sub">single phone</i></span></button>`
    + layers.map(l =>
      `<button class="chip${l.id === layer?.id ? ' selected' : ''}" data-layer="${l.id}">${avaHtml(l)}${esc(l.name)}</button>`).join('')
    + `<button class="chip ghost" data-add-layer>+ Add person</button>`;

  const setter = layer ? layer.name : handler.name;
  $('btnLayLabel').textContent = v.lay;
  $('btnLaySub').textContent = target.kind === 'person'
    ? `${setter} walks it, ${handler.name} runs ${dog?.name ?? 'the dog'}`
    : `${setter} places it, ${handler.name} searches with ${dog?.name ?? 'the dog'}`;
  $('btnRunLabel').textContent = v.run;
  $('btnRunSub').textContent = v.runSub;

  const recent = S.sessions.slice(0, 6);
  $('recentList').innerHTML = recent.length ? recent.map(sessionCard).join('')
    : `<div class="card"><p class="body muted">Nothing yet. After each run, one line about what the dog did appears here.</p></div>`;
}

function sessionCard(s) {
  const d = S.dogs.find(x => x.id === s.dogId);
  return `<div class="card" data-open-session="${s.id}">
    <div class="meta"><span>${fmtWhen(s.startedAt)}</span><span>${esc(d?.name ?? '')}${d ? ' · ' : ''}${esc(targetById(s.targetId).label)}</span></div>
    <div class="story">${esc(s.summary)}</div>
  </div>`;
}

/* ── Lay a trail / Set a hide ─────────────────────────────────────── */
const rec = { on: false, kind: null, pts: [], wps: [], hides: [], started: 0, dropped: 0, watch: null, lock: null, tick: 0 };
let pendingSession = null;   // built at Confirm, shared/run afterwards

function gpsHudText() {
  if (!rec.pts.length && rec.dropped) return accWarning();
  const m = pathLen(rec.pts);
  return `Recording · ${fmtDur(Date.now() - rec.started)} · ${fmtKm(m)}`;
}

/* Fixes arriving and every one of them rejected looks, from the outside,
   exactly like no GPS at all. Say which it is, and say the number that
   decides it — otherwise the phone is just "broken". */
const fmtAcc = (a) => (a >= 1000 ? `${(a / 1000).toFixed(1)} km` : `${Math.round(a)} m`);
function accWarning() {
  if (rec.lastAcc == null) return 'Waiting for a fix…';
  return `GPS says ±${fmtAcc(rec.lastAcc)} — worse than the ${settings.accCap} m cap, `
    + `so nothing is being kept. Turn on Precise Location for this app, or raise the cap in Settings.`;
}

function startLay() {
  const t = S.target;
  clearMap();
  pendingSession = null;
  rec.kind = t.kind === 'person' ? 'lay' : 'hide';
  rec.pts = []; rec.wps = []; rec.hides = []; rec.dropped = 0;
  $('hideTools').hidden = t.kind !== 'hide';
  $('btnDrawPlan').hidden = t.kind === 'hide';
  $('btnLayStart').hidden = t.kind === 'hide';
  $('btnLayStop').hidden = true;
  $('layDot').hidden = true;
  $('layHudText').textContent = t.kind === 'hide' ? 'Place each hide' : 'Ready';
  $('layCaption').textContent = t.kind === 'hide'
    ? 'Each hide is stamped with the time you place it' : 'Phone can go in your pocket';
  go('scrLay');
  if (t.kind === 'hide') {
    map.getCanvas().style.cursor = 'crosshair';
    map.on('click', onHideTap);
    $('btnLayStop').textContent = 'Done';
  } else {
    $('btnLayStop').textContent = 'Stop';
  }
  // Centre on the handler without waiting for a recording to begin.
  navigator.geolocation?.getCurrentPosition(
    p => map.easeTo({ center: [p.coords.longitude, p.coords.latitude], zoom: 16 }),
    () => {}, { enableHighAccuracy: true, timeout: 8000 });
}

function onHideTap(e) {
  rec.hides.push({ lat: e.lngLat.lat, lon: e.lngLat.lng, t: Date.now() });
  navigator.vibrate?.(20);
  paintHides();
}
function paintHides() {
  setSrc('hides', pointsOf(rec.hides));
  const n = rec.hides.length;
  $('layHudText').textContent = n ? `${n} hide${n === 1 ? '' : 's'} placed` : 'Place each hide';
  $('btnLayStop').hidden = n === 0;
}
function dropHideAtFeet() {
  navigator.geolocation?.getCurrentPosition(p => {
    rec.hides.push({ lat: p.coords.latitude, lon: p.coords.longitude, t: Date.now() });
    navigator.vibrate?.(20);
    paintHides();
    map.easeTo({ center: [p.coords.longitude, p.coords.latitude] });
  }, () => toast('No GPS fix — tap the map instead'), { enableHighAccuracy: true, timeout: 10000 });
}

function onFix(pos) {
  const { latitude: lat, longitude: lon, accuracy: acc, altitude: alt } = pos.coords;
  if (!rec.on) return;
  const pt = { lat, lon, t: pos.timestamp || Date.now(), acc, alt: alt ?? null };
  const last = rec.pts[rec.pts.length - 1];
  /* Stillness is not noise — it is the strongest source on the trail. A
     stationary fix folds its seconds into the last kept point's dwell, and
     the engine emits more from it. Only device-poor fixes are dropped. */
  const verdict = dwellFold(last, pt, Number(settings.accCap), Number(settings.stillCap));
  if (verdict === 'drop') { rec.dropped++; rec.lastAcc = acc; return; }
  if (verdict === 'dwell') {
    last.dwellS = (last.dwellS ?? 0) + Math.max(0, (pt.t - (last._seen ?? last.t)) / 1000);
    last._seen = pt.t;
    return;
  }
  pt.dwellS = 0;
  rec.pts.push(pt);
  if (rec.kind === 'lay') setSrc('runner', lineOf(rec.pts));
  if (rec.kind === 'run') setSrc('dog', lineOf(rec.pts));
  if (rec.kind === 'walk') setSrc('dog', lineOf(rec.pts));
  if (rec.pts.length === 1) map.easeTo({ center: [lon, lat], zoom: 17 });
}

async function startWatch(hudId) {
  if (!navigator.geolocation) { toast('No GPS on this device'); return false; }
  if (!window.isSecureContext) { toast('Needs https to read GPS'); return false; }
  try {
    const perm = await navigator.permissions?.query({ name: 'geolocation' });
    if (perm?.state === 'denied') {
      toast('Location blocked. Allow it for this site, then reload');
      return false;
    }
  } catch { /* Permissions API optional */ }
  rec.on = true; rec.pts = []; rec.dropped = 0; rec.started = Date.now();
  try { rec.lock = await navigator.wakeLock?.request('screen'); } catch { /* not fatal */ }
  rec.watch = navigator.geolocation.watchPosition(onFix,
    (e) => toast(e.code === 1 ? 'Location blocked — nothing recorded'
      : e.code === 3 ? 'No fix yet — open sky helps' : 'GPS error'),
    { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
  clearInterval(rec.tick);
  rec.tick = setInterval(() => { $(hudId).textContent = hudText(); }, 1000);
  return true;
}

let hudText = gpsHudText;

async function stopWatch() {
  rec.on = false;
  navigator.geolocation?.clearWatch(rec.watch);
  clearInterval(rec.tick);
  try { await rec.lock?.release(); } catch { /* already gone */ }
  rec.lock = null;
}

async function layStart() {
  hudText = gpsHudText;
  if (!(await startWatch('layHudText'))) return;
  $('btnLayStart').hidden = true;
  $('btnLayStop').hidden = false;
  $('layDot').hidden = false;
  $('layHudText').textContent = 'Waiting for a fix…';
  toast('Laying — the phone can go in your pocket');
}

async function layStop() {
  if (rec.kind === 'hide') {
    map.off('click', onHideTap);
    map.getCanvas().style.cursor = '';
    if (!rec.hides.length) return go('scrHome');
    $('confirmText').textContent = `${rec.hides.length} hide${rec.hides.length === 1 ? '' : 's'} set`;
    fitTo(rec.hides);
    return go('scrConfirm');
  }
  await stopWatch();
  if (rec.pts.length < 2) {
    toast('Too short to keep — nothing saved');
    return go('scrHome');
  }
  $('confirmText').textContent =
    `${fmtKm(pathLen(rec.pts))} · ${fmtDur(rec.pts[rec.pts.length - 1].t - rec.pts[0].t)}`;
  setSrc('runner', lineOf(rec.pts));
  fitTo(rec.pts);
  go('scrConfirm');
}

async function confirmLay() {
  const t = S.target;
  const isHide = rec.kind === 'hide';
  const origin = isHide ? rec.hides[0] : rec.pts[0];
  const startedAt = isHide ? rec.hides[0].t : rec.pts[0].t;
  rec.pts.forEach(p => delete p._seen);

  const s = {
    id: uid(), handlerId: S.handler.id, dogId: null,
    layerId: S.layer?.id ?? null, targetId: t.id, startedAt,
    summary: isHide
      ? `${rec.hides.length} hide${rec.hides.length === 1 ? '' : 's'} set, not searched yet.`
      : `${fmtKm(pathLen(rec.pts))} trail laid, not run yet.`,
    data: isHide
      ? { hides: rec.hides, weather: null }
      : { trail: rec.pts, waypoints: rec.wps, weather: null, contamination: [] },
  };
  db.addSession(s);
  snap();
  pendingSession = s;
  go('scrShare');
  renderShare(s);

  // Weather and soil temperature, fetched silently on confirm.
  try {
    const wx = await fetchWeather(origin.lat, origin.lon, startedAt);
    db.updateSession(s.id, { data: { ...s.data, weather: wx } });
    pendingSession = db.sessions().find(x => x.id === s.id);
    snap();
    if (!$('scrShare').hidden) renderShare(pendingSession);
  } catch { /* offline — weather joins when it can */ }
}

function discardLay() {
  clearMap();
  pendingSession = null;
  go('scrHome');
}

/* ── Share ────────────────────────────────────────────────────────── */
function miniMapSvg(pts) {
  if (!pts || pts.length < 2) return '';
  const lats = pts.map(p => p.lat), lons = pts.map(p => p.lon);
  const mnLa = Math.min(...lats), mxLa = Math.max(...lats);
  const mnLo = Math.min(...lons), mxLo = Math.max(...lons);
  const cos = Math.cos(((mnLa + mxLa) / 2) * Math.PI / 180);
  const spanX = Math.max(1e-6, (mxLo - mnLo) * cos), spanY = Math.max(1e-6, mxLa - mnLa);
  const scale = Math.min(272 / spanX, 142 / spanY);
  const X = (p) => 14 + ((p.lon - mnLo) * cos - (spanX - 272 / scale) / 2 * 0) * scale + (272 - spanX * scale) / 2;
  const Y = (p) => 14 + (mxLa - p.lat) * scale + (142 - spanY * scale) / 2;
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p).toFixed(1)},${Y(p).toFixed(1)}`).join(' ');
  const a = pts[0], b = pts[pts.length - 1];
  return `<path d="${d}" fill="none" stroke="#2F9E44" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${X(a).toFixed(1)}" cy="${Y(a).toFixed(1)}" r="5" fill="#2F4A3A"/>
    <circle cx="${X(b).toFixed(1)}" cy="${Y(b).toFixed(1)}" r="5" fill="#D9662B"/>`;
}

function renderShare(s) {
  const isHide = targetById(s.targetId).kind === 'hide';
  const isPlan = !!s.data.plan;
  $('shareTitle').textContent = isHide ? 'Hide set' : isPlan ? 'Trail planned' : 'Trail laid';
  $('btnRunHere').textContent = isHide ? 'Search it on this phone' : 'Run it on this phone';
  $('btnContam').hidden = isHide;
  $('btnOff').hidden = !isPlan;
  if (isPlan) {
    $('btnOff').textContent = s.data.offAt
      ? 'Open the countdown' : `${cap(layerName(s))} is off — start the countdown`;
  }

  const wx = s.data.weather;
  const laid = new Date(s.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (isHide) {
    $('shareMini').innerHTML = (s.data.hides || []).map((h, i) =>
      `<circle cx="${40 + i * 40}" cy="85" r="7" fill="#D9662B"/>`).join('');
    $('shareMeta').textContent = `${s.data.hides.length} hide${s.data.hides.length === 1 ? '' : 's'} · set ${laid}`
      + (wx?.wind_speed != null ? ` · wind ${(wx.wind_speed * 3.6).toFixed(0)} km/h ${cardinal(wx.wind_direction)}` : '');
    /* Hide cards are not in the QR codec yet — single-phone hides for now. */
    $('shareQrCard').hidden = true;
  } else {
    $('shareQrCard').hidden = false;
    $('shareMini').innerHTML = miniMapSvg(s.data.trail);
    const mins = fmtDur(s.data.trail[s.data.trail.length - 1].t - s.data.trail[0].t);
    $('shareMeta').textContent = isPlan
      ? `${fmtKm(pathLen(s.data.trail))} plan · dog starts +${s.data.ageMin ?? 10} min`
        + (wx?.wind_speed != null ? ` · wind ${(wx.wind_speed * 3.6).toFixed(0)} km/h ${cardinal(wx.wind_direction)}` : '')
      : `${fmtKm(pathLen(s.data.trail))} · ${mins} · laid ${laid}`
        + (wx?.wind_speed != null ? ` · wind ${(wx.wind_speed * 3.6).toFixed(0)} km/h ${cardinal(wx.wind_direction)}` : '');
    renderShareQr(s);
  }
}

const layerName = (s) => S.layers.find(l => l.id === s.layerId)?.name ?? 'the layer';

async function renderShareQr(s) {
  const from = (S.layers.find(l => l.id === s.layerId)?.name) || S.handler?.name || '';
  try {
    const card = await encodeTrail({
      points: s.data.trail, waypoints: s.data.waypoints || [],
      drawn: !!s.data.drawn || !!s.data.plan, from,
      ...(s.data.plan ? { kind: 1, ageMin: s.data.ageMin ?? 10 } : {}),
    }, {});
    const qr = window.qrcode?.(0, 'M');
    if (!qr) throw new Error('QR library missing — hard refresh once online');
    qr.addData(card, 'Byte');
    qr.make();
    $('shareQr').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
    const who = S.layers.find(l => l.id !== s.layerId)?.name;
    $('shareQrCaption').textContent = s.data.plan
      ? `${layerName(s)} scans this — her phone walks her along the line, corner by corner`
      : `The other phone scans this — the trail travels inside the code, no signal needed`;
  } catch (err) {
    $('shareQr').innerHTML = '';
    $('shareQrCaption').textContent = err.message;
  }
}

/* ── Contamination trails (drawn before the run) ──────────────────── */
const contam = { pts: [], forSession: null };

function openContam(s) {
  contam.pts = [];
  contam.forSession = s.id;
  setSrc('runner', lineOf(s.data.trail));
  setSrc('contam', lineOf([]));
  setSrc('wps', EMPTY);
  fitTo(s.data.trail);
  // Who walked it: any known person; when: an hour ago by default.
  $('contamWho').innerHTML =
    S.layers.map(l => `<option value="${l.id}">${esc(l.name)}</option>`).join('')
    + `<option value="">${esc(S.handler?.name ?? 'Me')}</option>`;
  const d = new Date(Date.now() - 60 * 60000);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  $('contamWhen').value = d.toISOString().slice(0, 16);
  map.getCanvas().style.cursor = 'crosshair';
  map.on('click', onContamTap);
  paintContam();
  go('scrContam');
}

function onContamTap(e) {
  const p = { lat: e.lngLat.lat, lon: e.lngLat.lng };
  const prev = contam.pts[contam.pts.length - 1];
  if (prev && dist(prev, p) > 5000) return toast('That corner is km away — zoom in');
  contam.pts.push(p);
  navigator.vibrate?.(15);
  paintContam();
}
function paintContam() {
  setSrc('contam', lineOf(contam.pts));
  setSrc('wps', pointsOf(contam.pts.map((p, i) => ({ ...p, kind: String(i + 1) })), 'kind'));
  $('contamText').textContent = contam.pts.length < 2
    ? 'Tap the corners of the extra trail' : `${contam.pts.length} corners`;
  $('contamSave').disabled = contam.pts.length < 2;
}
function closeContam() {
  map.off('click', onContamTap);
  map.getCanvas().style.cursor = '';
  setSrc('wps', EMPTY);
}
function saveContam() {
  const s = db.sessions().find(x => x.id === contam.forSession);
  if (!s) return go('scrHome');
  const whenVal = $('contamWhen').value;
  const laidAt = whenVal ? new Date(whenVal).getTime() : Date.now() - 3600e3;
  if (!Number.isFinite(laidAt)) return toast('That time is not valid');
  const whoId = $('contamWho').value || null;
  const who = whoId ? (db.layers.byId(whoId)?.name ?? 'Someone') : (S.handler?.name ?? 'Me');
  // densify + timestamps give the drawn line the clock the engine runs on.
  const points = timestamps(densify(contam.pts, 5), laidAt, 1.3);
  const list = [...(s.data.contamination || []), { who, laidAt, points }];
  db.updateSession(s.id, { data: { ...s.data, contamination: list } });
  snap();
  closeContam();
  pendingSession = db.sessions().find(x => x.id === s.id);
  toast(`Contamination trail saved — ${who}, ${fmtWhen(laidAt)}`);
  go('scrShare');
  renderShare(pendingSession);
}


/* ── The relay: draw → guide → countdown on both → walked card back ─
   The handler draws the trail with a finger, A to B. The layer scans the
   plan and their phone walks them along it, recording where they REALLY
   walked. The countdown — the trail’s age — starts the moment the layer
   leaves the departure point, on both phones. When the dog finds them, the
   walked trail comes back as a second card and the verdict is graded
   against the truth on the ground, not the sketch. */

const draw = { pts: [], ageMin: 10 };

function openDraw() {
  clearMap();
  draw.pts = [];
  draw.ageMin = 10;
  $('ageRow').querySelectorAll('.age-chip').forEach(b =>
    b.classList.toggle('selected', b.dataset.age === '10'));
  map.getCanvas().style.cursor = 'crosshair';
  map.on('click', onDrawTap);
  paintDraw();
  go('scrDraw');
}
function onDrawTap(e) {
  const pt = { lat: e.lngLat.lat, lon: e.lngLat.lng };
  const prev = draw.pts[draw.pts.length - 1];
  if (prev && dist(prev, pt) > 5000) return toast('That corner is km away — zoom in');
  draw.pts.push(pt);
  navigator.vibrate?.(15);
  paintDraw();
}
function paintDraw() {
  setSrc('runner', lineOf(draw.pts));
  setSrc('wps', pointsOf(draw.pts.map((pt, i) => ({ ...pt, kind: i === 0 ? 'A' : String(i + 1) })), 'kind'));
  if (draw.pts.length) setSrc('start', pointsOf([draw.pts[0]]));
  const n = draw.pts.length;
  $('drawText').textContent = n < 2
    ? (n === 0 ? 'Tap the map at each corner — A to B' : 'Now tap where it goes next')
    : `${n} corners · ${fmtKm(pathLen(draw.pts))}`;
  $('drawSave').disabled = n < 2;
}
function closeDraw() {
  map.off('click', onDrawTap);
  map.getCanvas().style.cursor = '';
}
function saveDrawPlan() {
  if (draw.pts.length < 2) return;
  closeDraw();
  // densify + a provisional walking clock: the REAL clock arrives with the
  // walked card. The provisional one keeps the card format honest.
  const planPts = timestamps(densify(draw.pts, 5), Date.now(), 1.3);
  const sess = {
    id: uid(), handlerId: S.handler.id, dogId: null,
    layerId: S.layer?.id ?? null, targetId: 'person', startedAt: Date.now(),
    summary: `${fmtKm(pathLen(planPts))} trail planned, not walked yet.`,
    data: { plan: true, ageMin: draw.ageMin, corners: draw.pts, trail: planPts,
            waypoints: [], weather: null, contamination: [] },
  };
  db.addSession(sess);
  snap();
  pendingSession = sess;
  go('scrShare');
  renderShare(sess);
  fetchWeather(planPts[0].lat, planPts[0].lon, Date.now())
    .then(wx => {
      db.updateSession(sess.id, { data: { ...sess.data, weather: wx } });
      pendingSession = db.sessions().find(x => x.id === sess.id);
      snap();
      if (!$('scrShare').hidden) renderShare(pendingSession);
    })
    .catch(() => { /* offline — joins later */ });
}

/* ── Handler countdown ── */
const CD = { sid: null, tick: 0 };

function openCountdown(s) {
  CD.sid = s.id;
  clearInterval(CD.tick);
  CD.tick = setInterval(paintCountdown, 500);
  $('cdSub').textContent = `${S.dog?.name ?? 'The dog'} starts when it hits zero. ` +
    `Counting from the moment you marked ${layerName(s)} off.`;
  paintCountdown();
  go('scrCountdown');
}
function paintCountdown() {
  const s = db.sessions().find(x => x.id === CD.sid);
  if (!s) { clearInterval(CD.tick); return; }
  const left = (s.data.offAt + (s.data.ageMin ?? 10) * 60000) - Date.now();
  const clock = $('cdClock');
  if (left <= 0) {
    clock.textContent = '0:00';
    clock.classList.add('ready');
    $('cdLabel').textContent = 'Trail is ready';
    $('cdStart').textContent = 'Start the dog';
    if (!CD.buzzed) { CD.buzzed = true; navigator.vibrate?.([90, 60, 90]); }
  } else {
    clock.textContent = fmtDur(left);
    clock.classList.remove('ready');
    $('cdLabel').textContent = 'Trail ageing';
    $('cdStart').textContent = 'Start early';
  }
}
function stopCountdownUi() { clearInterval(CD.tick); CD.tick = 0; CD.buzzed = false; }

/* ── The layer’s guided walk ── */
const walk = { card: null, atStart: false, offAt: 0, done: false, tick: 0 };

function startWalk(card) {
  walk.card = card;
  walk.atStart = false;
  walk.offAt = 0;
  walk.done = false;
  rec.kind = 'walk';
  clearMap();
  setSrc('runner', lineOf(card.points));
  setSrc('start', pointsOf([card.points[0]]));
  setSrc('hides', pointsOf([card.points[card.points.length - 1]]));   // B, in ember
  fitTo(card.points);
  hudText = walkHud;
  go('scrWalk');
  startWatch('walkText').then(ok => { if (!ok) go('scrHome'); });
  toast(`${card.from ? card.from + '’s' : 'The'} plan — walk the line, A to B`);
}

function walkHud() {
  const A = walk.card.points[0], B = walk.card.points[walk.card.points.length - 1];
  const last = rec.pts[rec.pts.length - 1];
  if (!last) return accWarning();
  const dA = dist(last, A), dB = dist(last, B);

  /* The countdown arms at the departure point and fires on LEAVING it —
     which is the moment the trail starts existing, and ageing. The decision
     itself lives in geo.js, where it can be tested without a phone. */
  const st = departure(walk, { d: dA, t: last.t, walked: pathLen(rec.pts), firstT: rec.pts[0].t });
  walk.atStart = st.atStart;
  if (st.offAt && !walk.offAt) {
    walk.offAt = st.offAt;
    navigator.vibrate?.(60);
    toast('Off you go — the countdown is running on both phones');
  }

  const offs = signedOffsets(walk.card.points, [last]);
  const offLine = offs.length ? Math.abs(offs[0]) : null;
  const bits = [];
  if (!walk.offAt) bits.push(dA < 40 ? 'At the start — walk on' : `${Math.round(dA)} m to the start`);
  else {
    if (offLine != null) bits.push(offLine < 8 ? 'On the line' : `${Math.round(offLine)} m off the line`);
    bits.push(`${Math.round(dB)} m to the end`);
    const left = (walk.offAt + (walk.card.ageMin ?? 10) * 60000) - Date.now();
    bits.push(left > 0 ? `dog in ${fmtDur(left)}` : 'dog is coming');
  }
  return bits.join(' · ');
}

async function finishWalk() {
  const B = walk.card.points[walk.card.points.length - 1];
  const last = rec.pts[rec.pts.length - 1];
  if (last && dist(last, B) > 60 &&
      !confirm(`You are ${Math.round(dist(last, B))} m from the drawn end. Finish here anyway?`)) return;
  await stopWatch();
  rec.pts.forEach(pt => delete pt._seen);
  walk.done = true;

  const walked = rec.pts.length >= 2 ? rec.pts : walk.card.points;
  if (rec.pts.length < 2) toast('No GPS track of the walk — the card will carry the drawn line');

  // Her own record of the walk stays on her phone.
  db.addSession({
    id: uid(), handlerId: S.handler.id, dogId: null, layerId: null,
    targetId: 'person', startedAt: walked[0].t,
    summary: `Walked ${walk.card.from ? walk.card.from + '’s' : 'a'} plan — ${fmtKm(pathLen(walked))}.`,
    data: { trail: walked, waypoints: [], weather: null, contamination: [], walkOf: true },
  });
  snap();

  // The card the handler scans after the find: the trail as it was REALLY walked.
  try {
    const cardStr = await encodeTrail({ points: walked, waypoints: [], from: S.handler?.name ?? '', kind: 2 }, {});
    const qr = window.qrcode?.(0, 'M');
    qr.addData(cardStr, 'Byte');
    qr.make();
    $('waitQr').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  } catch (err) {
    $('waitQr').innerHTML = `<p style="font:600 13px sans-serif;padding:20px">${esc(err.message)}</p>`;
  }
  clearInterval(walk.tick);
  walk.tick = setInterval(paintWait, 500);
  paintWait();
  go('scrWait');
}
function paintWait() {
  const base = walk.offAt || (rec.pts[0]?.t ?? Date.now());
  const left = (base + (walk.card?.ageMin ?? 10) * 60000) - Date.now();
  $('waitClock').textContent = left > 0 ? fmtDur(left) : '0:00';
  $('waitClock').classList.toggle('ready', left <= 0);
  $('waitSub').textContent = left > 0
    ? 'The dog starts when this hits zero. Stay put.'
    : 'The dog is on its way. Stay exactly where you are.';
}

/* ── The walked card, back on the handler’s phone ── */
let scanWalkedFor = null;    // session id waiting for its walked card

async function applyWalked(sessionId, card) {
  const s = db.sessions().find(x => x.id === sessionId);
  if (!s) return false;
  const plan = s.data.trail;
  if (dist(card.points[0], plan[0]) > 300 &&
      !confirm('That walk starts a long way from this plan. Use it anyway?')) return false;

  db.updateSession(s.id, {
    startedAt: card.started,
    data: { ...s.data, planTrail: plan, trail: card.points, walked: true, walkedFrom: card.from },
  });
  snap();
  let s2 = db.sessions().find(x => x.id === s.id);
  toast(`The real walked line from ${card.from || 'the layer'} — re-grading`);
  if (s2.data.track) {
    const result = await computeResult(s2, s2.data.track, s2.data.trackWaypoints || [], s2.data.trackStarted, { bank: true });
    db.updateSession(s2.id, { summary: result.sentence, data: { ...s2.data, result } });
    snap();
    s2 = db.sessions().find(x => x.id === s.id);
  }
  run.session = s2;
  renderResult(s2);
  go('scrResult');
  return true;
}

/* ── Pick what to run ─────────────────────────────────────────────── */
function openPick() {
  const t = S.target;
  const v = verbs(t);
  $('pickTitle').textContent = v.run;
  $('pickLabel').textContent = t.kind === 'hide' ? 'Set on this phone' : 'Laid on this phone';
  const candidates = S.sessions
    .filter(s => targetById(s.targetId).kind === t.kind && !s.data.track)
    .slice(0, 12);
  $('pickList').innerHTML = candidates.length ? candidates.map(s => {
    const what = t.kind === 'hide'
      ? `${s.data.hides?.length ?? 0} hides`
      : `${fmtKm(pathLen(s.data.trail || []))}`;
    const age = ageWord(Date.now() - s.startedAt);
    return `<div class="card" data-run-session="${s.id}">
      <div class="meta"><span>${fmtWhen(s.startedAt)}</span><span>${what}</span></div>
      <div class="story">${esc(targetById(s.targetId).label)} · ${age} old</div>
    </div>`;
  }).join('') : `<div class="card"><p class="body muted">Nothing waiting. ${t.kind === 'hide' ? 'Set a hide first.' : 'Lay a trail first, or scan a card.'}</p></div>`;
  go('scrPick');
}

const ageWord = (ms) => {
  const m = Math.round(ms / 60000);
  return m < 60 ? `${m} min` : m < 60 * 24 ? `${(m / 60).toFixed(1)} h` : `${Math.round(m / 1440)} d`;
};

/* ── Run / Search ─────────────────────────────────────────────────── */
const run = { session: null, revealed: false, startedAt: 0 };

async function startRun(s) {
  const t = targetById(s.targetId);
  run.session = s;
  run.revealed = false;
  run.startedAt = Date.now();
  rec.kind = 'run';
  rec.wps = [];
  clearMap();

  if (t.kind === 'person') {
    // Only the start of the trail. The line itself stays hidden: run blind.
    setSrc('start', pointsOf([s.data.trail[0]]));
    fitTo([s.data.trail[0]]);
  } else if (s.data.hides?.length) {
    // Not even a flag for a search — knowing where it is defeats it.
    fitTo(s.data.hides.length > 1 ? s.data.hides : [s.data.hides[0]]);
  }

  hudText = () => {
    const dogName = S.dog?.name ?? 'Dog';
    const age = ageWord(Date.now() - s.startedAt);
    return `${dogName} · ${fmtDur(Date.now() - rec.started)} · ${t.kind === 'person' ? 'trail' : 'hide'} ${age} old`;
  };
  $('btnReveal').textContent = t.kind === 'person' ? 'Reveal trail' : 'Reveal hides';
  go('scrRun');
  if (!(await startWatch('runHudText'))) return go('scrHome');
  $('runHudText').textContent = hudText();
  toast(t.kind === 'person' ? 'Running blind — the trail is hidden' : 'Searching');
}

function toggleReveal() {
  const s = run.session;
  run.revealed = !run.revealed;
  const t = targetById(s.targetId);
  if (t.kind === 'person') {
    setSrc('runner', run.revealed ? lineOf(s.data.trail) : EMPTY);
    setSrc('contam', run.revealed
      ? { type: 'FeatureCollection',
          features: (s.data.contamination || []).map(c => lineOf(c.points).features[0]).filter(Boolean) }
      : EMPTY);
  } else {
    setSrc('hides', run.revealed ? pointsOf(s.data.hides) : EMPTY);
  }
  $('btnReveal').textContent = run.revealed
    ? 'Hide it again'
    : (t.kind === 'person' ? 'Reveal trail' : 'Reveal hides');
}

function addWaypoint(kind) {
  const last = rec.pts[rec.pts.length - 1];
  if (!last) return toast('No fix yet');
  rec.wps.push({ kind, lat: last.lat, lon: last.lon, t: Date.now() });
  setSrc('wps', pointsOf(rec.wps, 'kind'));
  navigator.vibrate?.(35);
  toast(kind);
}

async function stopRun() {
  await stopWatch();
  const s = run.session;
  if (!s) return go('scrHome');
  if (rec.pts.length < 2) {
    toast('Too short to grade — nothing saved');
    return go('scrHome');
  }
  rec.pts.forEach(p => delete p._seen);
  /* A plan-graded run is provisional: the drawn line is a sketch, so it
     neither banks calibration nor gets the last word — the walked card does. */
  const provisional = !!s.data.plan && !s.data.walked;
  const result = await computeResult(s, rec.pts, rec.wps, run.startedAt, { bank: !provisional });
  db.updateSession(s.id, {
    dogId: S.dog?.id ?? null,
    handlerId: S.handler.id,
    summary: result.sentence,
    data: { ...s.data, track: rec.pts, trackStarted: run.startedAt, trackWaypoints: rec.wps, result },
  });
  snap();
  run.session = db.sessions().find(x => x.id === s.id);
  renderResult(run.session);
  go('scrResult');
}

/* ── The result: one sentence first, numbers second ───────────────── */

/** Travel bearing at trail point i, from the neighbours that exist. */
function travelBrg(trail, i) {
  const a = trail[Math.max(0, i - 1)], b = trail[Math.min(trail.length - 1, i + 1)];
  return dist(a, b) > 0.5 ? bearing(a, b) : null;
}

async function computeResult(s, track, wps, startedAt, { bank = true } = {}) {
  const t = targetById(s.targetId);
  const dogRow = S.dog;
  const dogName = dogRow?.name ?? 'The dog';
  const ageMin = Math.max(0, Math.round((startedAt - s.startedAt) / 60000));

  // The wind that moved scent during THIS run.
  let wx = s.data.weather;
  try { wx = await fetchWeather(track[0].lat, track[0].lon, startedAt); } catch { /* keep laid-time weather */ }
  const st = stability(wx?.soil_temp, wx?.temp);

  if (t.kind === 'hide') return searchResult(s, track, wps, startedAt, wx, dogName, ageMin);

  const trail = s.data.trail;
  // The dog is a line-length ahead of the phone. Correct before grading.
  const corrected = lineCorrect(track, dogRow?.lineM ?? 0);
  const offs = signedOffsets(trail, corrected);
  const mean = meanSigned(offs);

  // The model's predicted side, point by point, then by majority.
  let T = FLAT;
  try { T = await terrainFor(trail); } catch { /* flat is honest */ }
  let predSide = 0;
  let reg = null;
  if (wx) {
    const pred = predictedOffsets(T, trail, wx, st, startedAt);
    let sum = 0;
    pred.forEach((p, i) => {
      const tb = travelBrg(trail, i);
      if (tb != null && p.bearing != null) sum += sideOfDrift(tb, p.bearing);
    });
    predSide = sum > pred.length * 0.15 ? 1 : sum < -pred.length * 0.15 ? -1 : 0;
    try { reg = regime(T, trail, wx, st); } catch { reg = null; }
  }
  const agree = sideAgreement(offs, predSide);

  /* Bank this run for the dog's own drift constant. k is only computed when
     the run can actually speak to it: real wind, a real offset, real ageing. */
  const settle = 1 - Math.exp(-Math.max(0, (startedAt - s.startedAt) / 1000) / 900);
  const k = (wx?.wind_speed > 0.5 && mean != null && Math.abs(mean) > 1 && settle > 0.05)
    ? Math.abs(mean) / (wx.wind_speed * settle) : null;
  if (bank) {
    db.addCalibration(dogRow?.id, {
      t: startedAt, predSide, mean, wind: wx?.wind_speed ?? null,
      stability: st?.label ?? null, k,
    });
  }

  const sideWord = mean == null ? '' : mean > 0 ? 'right' : 'left';
  const mAbs = mean == null ? 0 : Math.abs(mean);

  // Side first, magnitude second — that order is the point.
  let sentence;
  if (mean == null) sentence = `${dogName} ran, but the track could not be graded.`;
  else if (mAbs < 3) sentence = `${dogName} held the line — under 3 m from it on average.`;
  else sentence = `${dogName} worked about ${Math.round(mAbs)} m to the ${sideWord} of the line.`;

  if (predSide !== 0) {
    sentence += ` The wind pushed scent ${predSide > 0 ? 'right' : 'left'}.`;
    if (agree != null && agree >= 0.6 && mAbs >= 3) sentence += ' The dog was on the scent.';
    else if (agree != null && agree < 0.4 && mAbs >= 3) sentence += ' The dog worked the other side — worth a second look.';
  } else if (wx) {
    sentence += ' The wind ran along the trail, so the model predicts no side.';
  }

  return {
    kind: 'trail', sentence, mean, side: sideWord || null, predSide, agree, ageMin,
    regimeWord: reg?.word ?? null, regimeKey: reg?.key ?? null,
    stability: st?.label ?? null, stabilityPlain: st?.plain ?? null,
    wind: wx ? { speed: wx.wind_speed, from: wx.wind_direction } : null,
  };
}

function searchResult(s, track, wps, startedAt, wx, dogName, ageMin) {
  const hides = s.data.hides || [];
  const ind = wps.find(w => w.kind === 'Indication');
  const st = stability(wx?.soil_temp, wx?.temp);

  let sentence, toFirst = null, catchM = null, approach = null;
  if (!ind) {
    sentence = `${dogName} searched ${fmtDur(Date.now() - rec.started)} — no indication marked.`;
  } else {
    toFirst = ind.t - rec.started;
    const nearest = hides.reduce((best, h) => {
      const d = dist(ind, h);
      return !best || d < best.d ? { h, d } : best;
    }, null);
    catchM = nearest ? Math.round(nearest.d) : null;
    // Approach direction over the last ~20 m into the indication.
    const idx = track.findIndex(p => p.t >= ind.t);
    const path = track.slice(0, idx < 0 ? track.length : idx + 1);
    let back = path.length - 1;
    while (back > 0 && dist(path[back], path[path.length - 1]) < 20) back--;
    if (path.length > 1 && wx?.wind_direction != null) {
      const ab = bearing(path[back], path[path.length - 1]);
      const into = (wx.wind_direction) % 360;              // walking toward where wind comes FROM
      const off = Math.abs(((ab - into + 540) % 360) - 180);
      approach = off > 135 ? 'into the wind' : off < 45 ? 'with the wind' : 'across the wind';
    }
    sentence = `${dogName} indicated in ${fmtDur(toFirst)}`
      + (catchM != null ? `, ${catchM} m from the hide` : '')
      + (approach ? `, coming ${approach}.` : '.');
  }
  return {
    kind: 'search', sentence, toFirst, catchM, approach, ageMin,
    stability: st?.label ?? null, stabilityPlain: st?.plain ?? null,
    wind: wx ? { speed: wx.wind_speed, from: wx.wind_direction } : null,
  };
}

function renderResult(s) {
  const r = s.data.result;
  const d = S.dogs.find(x => x.id === s.dogId);
  $('resWho').textContent = `${d?.name ?? ''} · ${fmtWhen(s.startedAt)}`;
  $('resSentence').textContent = r.sentence;

  const cell = (b, i, sub = '') =>
    `<div><b>${b}</b><i>${i}</i>${sub ? `<span class="sub-line">${sub}</span>` : ''}</div>`;

  if (r.kind === 'search') {
    $('resGrid').innerHTML =
      cell(r.toFirst != null ? fmtDur(r.toFirst) : '—', 'to first indication') +
      cell(r.catchM != null ? `${r.catchM} m` : '—', 'from the hide') +
      cell(`${r.ageMin} min`, 'hide age at start') +
      cell(r.approach ?? '—', 'approach vs wind');
  } else {
    const sideCell = r.predSide === 0
      ? '—'
      : r.agree == null ? (r.side ? cap(r.side) : '—')
        : `${cap(r.side ?? '—')} <span class="${r.agree >= 0.6 ? 'ok' : 'no'}">${r.agree >= 0.6 ? '✓' : '✗'}</span>`;
    $('resGrid').innerHTML =
      cell(r.mean != null ? `${Math.abs(r.mean).toFixed(1)} m` : '—', 'mean offset') +
      cell(sideCell, 'side agrees') +
      cell(`${r.ageMin} min`, 'trail age at start') +
      // Regime and stability share a cell but NEVER a number.
      cell(r.regimeWord ? cap(r.regimeWord) : '—', 'regime', r.stability ? esc(r.stability) : '');
  }
  $('resStability').textContent = r.stabilityPlain ?? '';

  /* A plan-graded run says so. Grading a dog against a line drawn with a
     finger is a sketch of a verdict, and it is not allowed to look like the
     real one — nor to teach the dog's calibration anything. */
  const provisional = !!s.data.plan && !s.data.walked;
  $('btnScanWalked').hidden = !provisional;
  const note = $('resProvisional');
  note.hidden = !s.data.plan;
  if (s.data.plan) {
    note.textContent = provisional
      ? `Graded against the line you drew, not the walk itself. Nothing is banked to ${S.dog?.name ?? 'this dog'}’s calibration until you scan the layer’s walked card.`
      : `Graded against the trail ${s.data.walkedFrom || 'the layer'} actually walked.`;
  }
}
const cap = (w) => w ? w.charAt(0).toUpperCase() + w.slice(1) : w;

/* ── Show on map: the ONLY place the plume band appears ───────────── */
function showOnMap() {
  const s = run.session ?? pendingSession;
  if (!s) return;
  const t = targetById(s.targetId);
  clearMap();
  const wx = s.data.weather;
  if (t.kind === 'person') {
    setSrc('runner', lineOf(s.data.trail));
    setSrc('start', pointsOf([s.data.trail[0]]));
    if (s.data.contamination?.length) {
      setSrc('contam', { type: 'FeatureCollection',
        features: s.data.contamination.map(c => lineOf(c.points).features[0]).filter(Boolean) });
    }
    if (wx) {
      // The dog's own calibrated drift, once five runs have earned it.
      const k = db.dogDrift(s.dogId);
      const field = k != null
        ? scentField(s.data.trail, wx, s.data.trackStarted ?? undefined, k)
        : scentField(s.data.trail, wx, s.data.trackStarted ?? undefined);
      if (field.length) setSrc('drift', plumePolygon(field));
    }
  } else {
    setSrc('hides', pointsOf(s.data.hides));
  }
  if (s.data.track) {
    setSrc('dog', lineOf(s.data.track));
    setSrc('wps', pointsOf(s.data.trackWaypoints || [], 'kind'));
  }
  fitTo(s.data.trail || s.data.hides || [], s.data.track || []);
  $('showMapText').textContent = wx && t.kind === 'person'
    ? 'The band is where scent MAY sit — its width is the uncertainty'
    : (t.kind === 'hide' ? 'Hides and the search track' : 'No weather was saved for this one');
  go('scrShowMap');
}

/* ── Sessions & result reopening ──────────────────────────────────── */
function openSession(id) {
  const s = db.sessions().find(x => x.id === id);
  if (!s) return;
  if (s.data.result) {
    run.session = s;
    renderResult(s);
    go('scrResult');
  } else {
    pendingSession = s;
    go('scrShare');
    renderShare(s);
  }
}

function renderSessions() {
  const all = S.sessions;
  $('sessionList').innerHTML = all.length
    ? all.map(sessionCard).join('')
    : `<div class="card"><p class="body muted">No sessions yet.</p></div>`;
}

/* ── Scan ─────────────────────────────────────────────────────────── */
const scan = { stream: null, tick: 0, gen: 0 };

function stopScan() {
  scan.gen++;
  clearInterval(scan.tick); scan.tick = 0;
  scan.stream?.getTracks().forEach(t => t.stop());
  scan.stream = null;
  const v = $('scanVideo');
  if (v) { v.srcObject = null; v.hidden = true; }
}

async function openScan() {
  go('scrScan');
  const gen = ++scan.gen;
  $('scanState').textContent = 'Point the camera at a Trail Card.';
  if (!window.jsQR) {
    $('scanState').textContent = 'Scanner library missing — open the app online once, then retry.';
    return;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false,
    });
  } catch {
    if (gen === scan.gen) $('scanState').textContent = 'No camera — use "From a photo instead".';
    return;
  }
  if (gen !== scan.gen || $('scrScan').hidden) {
    stream.getTracks().forEach(t => t.stop());
    return;
  }
  scan.stream = stream;
  const v = $('scanVideo');
  v.srcObject = stream; v.hidden = false;
  await v.play().catch(() => { /* frame grabs still work */ });
  if (gen !== scan.gen) return;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const startTick = () => {
    scan.tick = setInterval(async () => {
      if (!v.videoWidth) return;
      c.width = v.videoWidth; c.height = v.videoHeight;
      ctx.drawImage(v, 0, 0);
      const img = ctx.getImageData(0, 0, c.width, c.height);
      const hit = window.jsQR?.(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
      if (!hit?.data) return;
      clearInterval(scan.tick); scan.tick = 0;
      const ok = await handleCard(hit.data);
      if (ok) return stopScan();
      if (gen === scan.gen && scan.stream && !$('scrScan').hidden) {
        setTimeout(() => { if (gen === scan.gen && scan.stream && !scan.tick) startTick(); }, 1200);
      }
    }, 250);
  };
  startTick();
}

async function scanPhoto(file) {
  if (!file) return;
  if (!window.jsQR) return $('scanState').textContent = 'Scanner library missing — open the app online once, then retry.';
  try {
    const bmp = await createImageBitmap(file);
    const c = document.createElement('canvas');
    c.width = bmp.width; c.height = bmp.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(bmp, 0, 0);
    const img = ctx.getImageData(0, 0, c.width, c.height);
    const hit = window.jsQR?.(img.data, img.width, img.height);
    if (!hit?.data) return $('scanState').textContent = 'No QR code found in that photo.';
    handleCard(hit.data);
  } catch {
    $('scanState').textContent = 'Could not read that photo.';
  }
}

/** A scanned card becomes a session and the run starts on it right away.
    Three kinds arrive at this door: a PLAN, which tells this phone to walk its
    owner along the line; a WALKED trail, which replaces the plan it came from
    and re-grades the run against the truth on the ground; and a plain laid
    trail, which is simply run. */
async function handleCard(data) {
  let card;
  try { card = await decodeTrail(data); }
  catch (err) {
    $('scanState').textContent = `${err.message} Still scanning…`;
    toast(err.message);
    return false;
  }

  if (scanWalkedFor) {
    if (card.kind !== 2) {
      $('scanState').textContent = 'That is a plan, not a walked trail. Still scanning…';
      return false;
    }
    const waiting = scanWalkedFor;
    scanWalkedFor = null;
    stopScan();
    return applyWalked(waiting, card);
  }
  if (card.kind === 1) {
    if (!card.points || card.points.length < 2) return false;
    stopScan();
    startWalk(card);
    return true;
  }

  const s = {
    id: uid(), handlerId: S.handler.id, dogId: null, layerId: null,
    targetId: 'person', startedAt: card.started,
    summary: `${fmtKm(pathLen(card.points))} trail from ${card.from || 'another phone'}, not run yet.`,
    data: { trail: card.points, waypoints: card.waypoints || [], weather: null,
            contamination: [], drawn: !!card.drawn, imported: { from: card.from || 'another phone', at: Date.now() } },
  };
  db.addSession(s);
  snap();
  toast(`Trail from ${s.data.imported.from} — ${fmtKm(pathLen(card.points))}`);
  // The card carries the REAL laid time; that moment's weather makes ageing true.
  fetchWeather(card.points[0].lat, card.points[0].lon, card.started)
    .then(wx => { db.updateSession(s.id, { data: { ...s.data, weather: wx } }); snap(); })
    .catch(() => { /* offline — joins later */ });
  startRun(s);
  return true;
}

/* ── Settings ─────────────────────────────────────────────────────── */
function renderSettings() {
  snap();
  $('setPeople').innerHTML = S.handlers.map(h => {
    const team = S.dogs.filter(d => d.handlerId === h.id);
    return `<div class="card set-card">
      <button class="set-row" data-edit-handler="${h.id}">${avaHtml(h)}<span class="who"><b>${esc(h.name)}</b></span></button>
      ${team.map(d => `<button class="set-row" data-edit-dog="${d.id}">${avaHtml(d)}<span class="who"><b>${esc(d.name)}</b><i>${esc(d.level)} · ${d.lineM} m line</i></span></button>`).join('')}
      <button class="btn ghost small" data-add-dog-for="${h.id}">Add a dog for ${esc(h.name)}</button>
    </div>`;
  }).join('') + `<button class="btn ghost small" id="setAddHandler">Add handler</button>`;

  $('setLayers').innerHTML = (S.layers.length
    ? S.layers.map(l => `<div class="card set-card"><button class="set-row" data-edit-layer="${l.id}">${avaHtml(l)}<span class="who"><b>${esc(l.name)}</b></span></button></div>`).join('')
    : `<p class="body small muted">None yet.</p>`)
    + `<button class="btn ghost small" id="setAddLayer">Add person</button>`;

  $('accCap').value = settings.accCap; $('accCapVal').textContent = settings.accCap;
  $('stillCap').value = settings.stillCap; $('stillCapVal').textContent = settings.stillCap;
  $('mbToken').value = settings.mbToken;
  $('gpsReport').hidden = true;
  $('buildNote').textContent = `${S.sessions.length} session${S.sessions.length === 1 ? '' : 's'} on this phone · Build ${BUILD}`;
}

/* ── Why the GPS is not working ───────────────────────────────────
   Three different failures look identical from the field — the page is not
   on https, the phone refused permission, or every fix is arriving too
   coarse to keep. Standing in a wet field guessing between them is not a
   thing this app should ask of anyone, so it checks and says which. */
async function gpsCheck() {
  const out = $('gpsReport');
  out.hidden = false;
  out.className = 'body small';
  out.textContent = 'Checking…';

  if (!navigator.geolocation) return gpsSay(out, 'bad', 'This browser has no GPS at all. Open Trailcraft in Safari or Chrome.');
  if (!window.isSecureContext) {
    return gpsSay(out, 'bad', `This page is on ${location.protocol}//${location.host}, which phones will not give GPS to. `
      + 'Open the https address instead.');
  }
  try {
    const perm = await navigator.permissions?.query({ name: 'geolocation' });
    if (perm?.state === 'denied') {
      return gpsSay(out, 'bad', 'This phone has blocked location for Trailcraft. '
        + 'iPhone: Settings → Privacy & Security → Location Services → Safari Websites → While Using. '
        + 'Then reload this page and allow it when asked.');
    }
  } catch { /* Permissions API is optional; the fix attempt below decides */ }

  const fix = await new Promise((res) => navigator.geolocation.getCurrentPosition(
    p => res({ ok: true, acc: p.coords.accuracy }),
    e => res({ ok: false, code: e.code }),
    { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }));

  if (!fix.ok) {
    if (fix.code === 1) return gpsSay(out, 'bad', 'Location was refused. Allow it for this site, then reload.');
    if (fix.code === 3) return gpsSay(out, 'bad', 'No fix within 20 seconds. Indoors or under heavy cover this is normal — try again outside.');
    return gpsSay(out, 'bad', 'The phone could not get a position at all.');
  }

  const cap = Number(settings.accCap);
  if (fix.acc > cap) {
    return gpsSay(out, 'bad', `GPS works, but it says ±${fmtAcc(fix.acc)} and Trailcraft only keeps fixes better than ${cap} m — `
      + 'so every one is thrown away and nothing records. That number means Precise Location is off: '
      + 'iPhone Settings → Privacy & Security → Location Services → Safari Websites → Precise Location ON. '
      + 'Standing still under trees can also do it; step into the open and check again.');
  }
  gpsSay(out, 'good', `GPS is working — ±${fmtAcc(fix.acc)}, well inside the ${cap} m cap. Nothing wrong here.`);
}

function gpsSay(el, verdict, text) {
  el.className = `body small ${verdict === 'good' ? 'gps-good' : 'gps-bad'}`;
  el.textContent = text;
}

/* ── Self-update ──────────────────────────────────────────────────── */
async function checkForUpdate() {
  try {
    const r = await fetch('build.txt', { cache: 'no-store' });
    if (!r.ok) return;
    const remote = (await r.text()).trim();
    if (!remote || remote === BUILD) return;
    const busy = rec.on;
    const tried = sessionStorage.getItem('tc.updateTried');
    if (busy || tried === remote) return toast(`Update ${remote} ready — close and reopen the app`);
    sessionStorage.setItem('tc.updateTried', remote);
    await Promise.all(['./', 'app.js', 'app.css', 'sw.js']
      .map(u => fetch(u, { cache: 'reload' }).catch(() => {})));
    location.reload();
  } catch { /* offline */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') checkForUpdate();
});

/* ── Wiring ───────────────────────────────────────────────────────── */
function wire() {
  // Onboarding forms
  const photoTo = (avaId) => pickPhoto(p => { obPhoto = p; paintObAva(avaId, $(avaId).textContent); });
  $('obHandlerPhoto').addEventListener('click', () => photoTo('obHandlerAva'));
  $('obHandlerPhoto2').addEventListener('click', () => photoTo('obHandlerAva'));
  $('obHandlerNext').addEventListener('click', saveHandlerForm);
  $('obDogPhoto').addEventListener('click', () => photoTo('obDogAva'));
  $('obDogPhoto2').addEventListener('click', () => photoTo('obDogAva'));
  $('obDogLevel').addEventListener('click', (e) => {
    const b = e.target.closest('[data-level]');
    if (b) { obDogLevel = b.dataset.level; paintDogLevel(); }
  });
  $('obDogNext').addEventListener('click', saveDogForm);

  // Tutorial
  $('tutNext').addEventListener('click', () => {
    if (tut.i === TUT_CARDS.length - 1) return finishTutorial();
    tut.i++; paintTut();
  });
  $('tutSkip').addEventListener('click', finishTutorial);

  // Home
  $('homeSettings').addEventListener('click', () => { renderSettings(); go('scrSettings'); });
  $('scrHome').addEventListener('click', (e) => {
    const h = e.target.closest('[data-handler]');
    if (h) { db.kv.set('lastHandlerId', h.dataset.handler); return renderHome(); }
    if (e.target.closest('[data-add-handler]')) return openHandlerForm({ returnTo: 'scrHome' });
    const d = e.target.closest('[data-dog]');
    if (d) { db.kv.set('lastDogId', d.dataset.dog); return renderHome(); }
    if (e.target.closest('[data-add-dog]')) return openDogForm({ returnTo: 'scrHome' });
    const t = e.target.closest('[data-target]');
    if (t) { db.kv.set('lastTargetId', t.dataset.target); return renderHome(); }
    const l = e.target.closest('[data-layer]');
    if (l) { db.kv.set('lastLayerId', l.dataset.layer || null); return renderHome(); }
    if (e.target.closest('[data-add-layer]')) return openLayerForm({ returnTo: 'scrHome' });
    const open = e.target.closest('[data-open-session]');
    if (open) return openSession(open.dataset.openSession);
  });
  $('btnLay').addEventListener('click', () => { if (S.dog) startLay(); else toast('Add a dog first'); });
  $('btnRun').addEventListener('click', () => { if (S.dog) openPick(); else toast('Add a dog first'); });

  // Lay
  $('btnLayStart').addEventListener('click', layStart);
  $('btnLayStop').addEventListener('click', layStop);
  $('btnLayCancel').addEventListener('click', async () => {
    await stopWatch();
    if (rec.kind === 'hide') { map.off('click', onHideTap); map.getCanvas().style.cursor = ''; }
    clearMap();
    go('scrHome');
  });
  $('btnDropHide').addEventListener('click', dropHideAtFeet);

  // Confirm
  $('btnConfirm').addEventListener('click', confirmLay);
  $('btnDiscard').addEventListener('click', discardLay);

  // Share
  $('btnContam').addEventListener('click', () => pendingSession && openContam(pendingSession));
  $('btnRunHere').addEventListener('click', () => pendingSession && startRun(pendingSession));
  $('btnShareDone').addEventListener('click', () => { clearMap(); go('scrHome'); });

  // Contamination
  $('contamUndo').addEventListener('click', () => { contam.pts.pop(); paintContam(); });
  $('contamCancel').addEventListener('click', () => {
    closeContam();
    setSrc('contam', EMPTY);
    go('scrShare');
    if (pendingSession) renderShare(pendingSession);
  });
  $('contamSave').addEventListener('click', saveContam);

  // Draw a plan
  $('btnDrawPlan').addEventListener('click', openDraw);
  $('ageRow').addEventListener('click', (e) => {
    const b = e.target.closest('[data-age]');
    if (!b) return;
    if (b.dataset.age === 'custom') {
      const mins = Number(prompt('Dog starts after how many minutes?', String(draw.ageMin)));
      if (!Number.isFinite(mins) || mins < 1 || mins > 1440) return toast('Between 1 and 1440 minutes');
      draw.ageMin = Math.round(mins);
      b.textContent = `${draw.ageMin} min`;
    } else {
      draw.ageMin = Number(b.dataset.age);
    }
    $('ageRow').querySelectorAll('.age-chip').forEach(c => c.classList.toggle('selected', c === b));
  });
  $('drawUndo').addEventListener('click', () => { draw.pts.pop(); paintDraw(); });
  $('drawCancel').addEventListener('click', () => { closeDraw(); clearMap(); go('scrHome'); });
  $('drawSave').addEventListener('click', saveDrawPlan);

  // The countdown, on the handler's phone
  $('btnOff').addEventListener('click', () => {
    if (!pendingSession) return;
    if (!pendingSession.data.offAt) {
      db.updateSession(pendingSession.id, { data: { ...pendingSession.data, offAt: Date.now() } });
      snap();
      pendingSession = db.sessions().find(x => x.id === pendingSession.id);
    }
    openCountdown(pendingSession);
  });
  $('cdStart').addEventListener('click', () => {
    const s = db.sessions().find(x => x.id === CD.sid);
    stopCountdownUi();
    if (s) startRun(s);
  });
  $('cdBack').addEventListener('click', () => {
    stopCountdownUi();
    const s = db.sessions().find(x => x.id === CD.sid);
    if (s) { pendingSession = s; renderShare(s); }
    go('scrShare');
  });

  // The layer's walk
  $('btnInPlace').addEventListener('click', finishWalk);
  $('walkCancel').addEventListener('click', async () => {
    if (rec.pts.length > 1 && !confirm('Cancel this walk? The handler gets no walked card.')) return;
    await stopWatch();
    walk.card = null;
    clearMap();
    go('scrHome');
  });
  $('waitDone').addEventListener('click', () => {
    clearInterval(walk.tick); walk.tick = 0;
    clearMap();
    go('scrHome');
  });

  // Pick / scan
  $('btnScan').addEventListener('click', openScan);
  $('btnScanWalked').addEventListener('click', () => {
    if (!run.session) return;
    scanWalkedFor = run.session.id;
    openScan();
  });
  $('btnPickBack').addEventListener('click', () => go('scrHome'));
  $('btnScanBack').addEventListener('click', () => {
    stopScan();
    if (scanWalkedFor) { scanWalkedFor = null; return go('scrResult'); }
    openPick();
  });
  $('scanFromPhoto').addEventListener('click', () => $('scanFile').click());
  $('scanFile').addEventListener('change', (e) => {
    scanPhoto(e.target.files?.[0]);
    e.target.value = '';
  });
  $('pickList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-run-session]');
    if (b) startRun(db.sessions().find(x => x.id === b.dataset.runSession));
  });

  // Run
  $('btnReveal').addEventListener('click', toggleReveal);
  $('btnRunStop').addEventListener('click', stopRun);
  $('wpRow').addEventListener('click', (e) => {
    const b = e.target.closest('[data-wp]');
    if (b) addWaypoint(b.dataset.wp);
  });

  // Result
  $('btnShowMap').addEventListener('click', showOnMap);
  $('btnShowMapBack').addEventListener('click', () => go('scrResult'));
  $('btnResDone').addEventListener('click', () => { clearMap(); go('scrHome'); });

  // Sessions
  $('btnSessBack').addEventListener('click', () => { renderSettings(); go('scrSettings'); });
  $('sessionList').addEventListener('click', (e) => {
    const open = e.target.closest('[data-open-session]');
    if (open) openSession(open.dataset.openSession);
  });

  // Settings
  $('btnSetDone').addEventListener('click', () => go('scrHome'));
  $('btnAllSessions').addEventListener('click', () => { renderSessions(); go('scrSessions'); });
  $('btnTutorial').addEventListener('click', () => openTutorial(true));
  $('btnGpsCheck').addEventListener('click', gpsCheck);
  $('scrSettings').addEventListener('click', (e) => {
    const eh = e.target.closest('[data-edit-handler]');
    if (eh) return openHandlerForm({ id: eh.dataset.editHandler, returnTo: 'scrSettings' });
    const ed = e.target.closest('[data-edit-dog]');
    if (ed) {
      const dog = db.dogs.byId(ed.dataset.editDog);
      return openDogForm({ id: dog.id, handlerId: dog.handlerId, returnTo: 'scrSettings' });
    }
    const ad = e.target.closest('[data-add-dog-for]');
    if (ad) return openDogForm({ handlerId: ad.dataset.addDogFor, returnTo: 'scrSettings' });
    const el = e.target.closest('[data-edit-layer]');
    if (el) return openLayerForm({ id: el.dataset.editLayer, returnTo: 'scrSettings' });
    if (e.target.closest('#setAddHandler')) return openHandlerForm({ returnTo: 'scrSettings' });
    if (e.target.closest('#setAddLayer')) return openLayerForm({ returnTo: 'scrSettings' });
  });

  const bind = (id, key, fmtId) => {
    $(id).addEventListener('input', () => {
      settings[key] = $(id).type === 'range' ? Number($(id).value) : $(id).value;
      saveSettings();
      if (fmtId) $(fmtId).textContent = $(id).value;
    });
  };
  bind('accCap', 'accCap', 'accCapVal');
  bind('stillCap', 'stillCap', 'stillCapVal');
  bind('mbToken', 'mbToken');
  $('mbToken').addEventListener('change', () => {
    const tok = (settings.mbToken || '').trim();
    if (!/^pk\./.test(tok)) return;
    toast('Satellite & 3D on — restarting the map');
    setTimeout(() => location.reload(), 800);
  });

  $('btnExportAll').addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([db.exportAll()], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = `trailcraft-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  $('btnWipe').addEventListener('click', () => {
    if (!confirm(`Wipe everything? ${S.sessions.length} sessions, ${S.dogs.length} dogs and all profiles. Export first if you want to keep them.`)) return;
    db.wipeAll();
    snap();
    boot();
  });
}

/* ── Boot ─────────────────────────────────────────────────────────── */
function boot() {
  snap();
  if (!S.handler) return openHandlerForm({ firstLaunch: true });
  if (!S.team.length && !S.dogs.length) return openDogForm({ firstLaunch: true });
  if (!S.tutorialDone) return openTutorial(false);
  go('scrHome');
}

buildMap();
wire();
boot();
checkForUpdate();
if (migrated) toast('Your team and trails came along to the new Trailcraft');
if (!settings.mbToken) setTimeout(() =>
  toast('Basic map — paste your Mapbox token in Settings for satellite & 3D'), 1500);

if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* cache is a bonus */ });
}
