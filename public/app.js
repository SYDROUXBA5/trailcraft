import {
  pathLen, cardinal, meanOffset, shouldKeep, dist,
  scentField, plumePolygon, legSummary, scentOffset,
  densify, timestamps,
} from './geo.js';
import { WindOverlay, blowsToward } from './wind.js';
import {
  FLAT, buildTerrain, normOf, flowAt, stability, scentLife,
  solarPosition, insolation, regime, wxAt,
} from './field.js';
import { rubberband, velocityFrom, chooseTarget, Spring } from './gesture.js';
import { ScentSim, predictedOffsets } from './sim.js';
import {
  LEVELS, levelLabel, trailClass, classOf, dogStats, handlerStats,
  attributeByName, backfillClasses,
} from './team.js';
import { analyseDesign } from './design.js';
import { encodeTrail, decodeTrail } from './card.js';

/* Trailcraft — scent-work training record.
   Map: MapLibre + free OpenFreeMap vector tiles + free AWS Terrarium DEM (no keys).
   Weather: Open-Meteo (no key) — the only public API that returns soil temperature. */

/* Shown in Settings. The service worker keeps an offline copy of the app, and
   an offline copy that fell behind looks identical to the current one — a
   missing feature then reads as a bug. This stamp is how a phone stops being
   able to lie about what it is running. Bump it with every change. */
const BUILD = '2026-08-28f';

const S = {
  sessions: 'tc.sessions', settings: 'tc.settings', team: 'tc.team',
};
const DEFAULTS = { dogName: '', accCap: 25, stillCap: 2.5, exagg: 2.4,
  mbToken: (window.MB_TOKEN || ''), basemap: 'satellite', wind: false,
  sheetDown: false, liveScent: true };

const load = (k, f) => { try { return JSON.parse(localStorage.getItem(k)) ?? f; } catch { return f; } };
const save = (k, v) => localStorage.setItem(k, JSON.stringify(v));

let settings = { ...DEFAULTS, ...load(S.settings, {}) };

/* A device can be handed its Mapbox token in the app's own link —
   …/trailcraft/#mbt=pk.xxx — because the token cannot ship inside the public
   repository. Stored once, stripped from the address bar, persists forever. */
{
  const mbt = new URLSearchParams(location.hash.slice(1)).get('mbt');
  if (mbt && /^pk\./.test(mbt)) {
    settings.mbToken = mbt;
    save(S.settings, settings);
    history.replaceState(null, '', location.pathname + location.search);
  }
}

/* Raising a default does nothing for anyone who has already run the app — their
   saved value wins forever. Terrain exaggeration was raised for depth, so nudge
   the people still sitting on the old default across, and only them: an exact
   match means nobody ever moved that slider deliberately. */
if (settings.exagg === 1.6) {
  settings.exagg = DEFAULTS.exagg;
  save(S.settings, settings);
}
let sessions = load(S.sessions, []);
/* Sessions from before classification existed carry the timestamps but not
   the class — compute it once from what was stored. */
if (backfillClasses(sessions)) save(S.sessions, sessions);

/* Who holds the line and who runs it. One handler per phone — this is a
   personal field record, not an account system. */
let team = { handler: null, dogs: [], lastDog: null, ...load(S.team, {}) };
const dogById = (id) => team.dogs.find(d => d.id === id);
const activeDog = () =>
  dogById(team.lastDog) || team.dogs[0] || null;

const $ = (id) => document.getElementById(id);

const fmtDur = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
/* Class-driven rather than [hidden], so entry and exit both get to play. A
   message replacing another retargets the same transition instead of snapping —
   which matters for a element that fires dozens of times a session. */
const toast = (msg) => {
  const t = $('toast'); t.textContent = msg; t.hidden = false;
  requestAnimationFrame(() => t.classList.add('show'));
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    t.classList.remove('show');
    toast._gone = setTimeout(() => { t.hidden = true; }, 200);
  }, 1900);
  clearTimeout(toast._gone);
};

/* ── Map ──────────────────────────────────────────────────────────── */
const EMPTY = { type: 'FeatureCollection', features: [] };
let map, mapReady = false;

// Last data pushed to each source. A style swap wipes sources, so keep a copy.
const srcData = { drift: EMPTY, runner: EMPTY, dog: EMPTY, wps: EMPTY, design: EMPTY };

const STYLES = {
  satellite: 'mapbox://styles/mapbox/standard-satellite',   // tree cover, hedge lines, field edges
  outdoors: 'mapbox://styles/mapbox/outdoors-v12',          // contours and paths
};

// If Mapbox is unreachable (bad token, no network), fall back to plain raster
// tiles rather than showing the handler an empty screen in a field.
const RASTER_FALLBACK = {
  version: 8,
  sources: { osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
                    tileSize: 256, attribution: '© OpenStreetMap contributors' } },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};

function buildMap() {
  /* mapbox-gl THROWS in its constructor when accessToken is empty — for ANY
     style, even one whose sources never touch Mapbox (the library bills per
     map load and checks first). An uncaught throw here takes the whole app
     down: no buttons, no onboarding, no Settings — which is exactly where the
     token would be pasted. So a tokenless install gets a placeholder string
     to satisfy the constructor and an OSM style that makes no Mapbox calls,
     and the app boots. */
  const noToken = !settings.mbToken;
  mapboxgl.accessToken = settings.mbToken || 'pk.tokenless';
  map = new mapboxgl.Map({
    container: 'map',
    style: noToken ? RASTER_FALLBACK : (STYLES[settings.basemap] || STYLES.satellite),
    center: [-2.6449, 51.2094],   // Wells, Somerset — replaced by first fix
    zoom: 15, pitch: 68, maxPitch: 85, attributionControl: { compact: true },
  });
  if (noToken) setTimeout(() =>
    toast('Basic map — paste your Mapbox token in Settings for satellite & 3D'), 1200);
  map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'top-right');
  map.addControl(new mapboxgl.GeolocateControl({
    positionOptions: { enableHighAccuracy: true }, trackUserLocation: true, showAccuracyCircle: true,
  }), 'top-right');

  map.on('load', addOverlays);
  map.on('moveend', () => ensureWx());
  map.on('resize', () => windFx?.running && windFx.resize());
  setTimeout(watchForBlankMap, 9000);

  // MapLibre measures the container once at construction, which can happen
  // before layout settles (and again whenever the phone rotates or the URL bar
  // collapses). Keep the canvas pinned to the real container size.
  new ResizeObserver(() => map.resize()).observe(document.getElementById('map'));
  window.addEventListener('orientationchange', () => setTimeout(() => map.resize(), 250));
}

function addOverlays() {
  /* Terrain, fog and 3D objects are Mapbox services — with no real token their
     tile requests would just 401. The trails, plume and design layers below
     are plain GeoJSON and work on any style, so a tokenless map still shows
     the actual training record. */
  if (settings.mbToken) {
    if (!map.getSource('dem')) {
      map.addSource('dem', {
        type: 'raster-dem', url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
        tileSize: 512, maxzoom: 14,
      });
    }
    map.setTerrain({ source: 'dem', exaggeration: Number(settings.exagg) });

    /* Haze on the far ground is what makes a ridge read as distant rather than
       as a texture. Wrapped because it only exists on styles that support it. */
    try {
      map.setFog({
        range: [1, 12], color: '#1b2430', 'high-color': '#2b3a4d',
        'horizon-blend': 0.22, 'space-color': '#0b0f16', 'star-intensity': 0,
      });
    } catch { /* style without atmosphere — no loss */ }

    // Standard styles can draw real buildings and landmarks on the terrain.
    for (const [k, v] of [['show3dObjects', true], ['showPointOfInterestLabels', false]]) {
      try { map.setConfigProperty('basemap', k, v); } catch { /* not a Standard style */ }
    }
  }

  applyWind();

  for (const id of ['drift', 'runner', 'dog', 'wps', 'design']) {
    if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: srcData[id] });
  }
  const add = (spec) => { if (!map.getLayer(spec.id)) map.addLayer(spec); };
  /* The uncertainty band. 0.17 opacity vanished on bright satellite ground —
     the one place it is used. Filled stronger, plus a dashed edge so the
     envelope reads as a shape even where the fill sits on pale grass. */
  add({ id: 'drift-fill', type: 'fill', source: 'drift',
        paint: { 'fill-color': '#2E7CF6', 'fill-opacity': 0.3 } });
  add({ id: 'drift-edge', type: 'line', source: 'drift',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#2E7CF6', 'line-width': 1.6, 'line-opacity': 0.55,
                 'line-dasharray': [1.5, 1.8] } });
  /* A dark casing under each track. Amber on sunlit grass measures under 2:1 —
     the line is legible on a desk and vanishes in a field, which is the only
     place it matters. The casing gives it a constant edge over any imagery.

     The two tracks also differ in FORM, not just colour: the laid trail is
     dashed, the dog's line solid. Colour alone is not a distinction everyone
     can see. */
  add({ id: 'runner-casing', type: 'line', source: 'runner',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#0d1117', 'line-width': 8.5, 'line-opacity': 0.6 } });
  add({ id: 'runner-line', type: 'line', source: 'runner',
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: { 'line-color': '#f0a92c', 'line-width': 4.5, 'line-opacity': 0.98,
                 'line-dasharray': [2.2, 1.4] } });
  /* Draw-mode leg grading paints OVER the dashed runner line: solid colour per
     wind regime. Red for downwind is deliberate — free scent is the design
     flaw, so it gets the alarm colour; crosswind (the training gold) gets the
     working blue; into-wind the calm green. */
  add({ id: 'design-line', type: 'line', source: 'design',
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: { 'line-width': 4.5, 'line-opacity': 0.98,
                 // Must match the sheet's leg legend exactly, or the legend lies.
                 'line-color': ['match', ['get', 'k'],
                   'tailwind', '#E8446F', 'headwind', '#17B389', '#2E7CF6'] } });
  add({ id: 'dog-casing', type: 'line', source: 'dog',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#0d1117', 'line-width': 8.5, 'line-opacity': 0.6 } });
  add({ id: 'dog-line', type: 'line', source: 'dog',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#3fb950', 'line-width': 4.5, 'line-opacity': 0.98 } });
  add({ id: 'wp-dots', type: 'circle', source: 'wps',
        paint: { 'circle-radius': 7, 'circle-color': '#58a6ff',
                 'circle-stroke-width': 2, 'circle-stroke-color': '#0d1117' } });
  add({ id: 'wp-text', type: 'symbol', source: 'wps',
        layout: { 'text-field': ['get', 'kind'], 'text-size': 11, 'text-offset': [0, 1.4], 'text-anchor': 'top' },
        paint: { 'text-color': '#f0f6fc', 'text-halo-color': '#0d1117', 'text-halo-width': 1.6 } });

  mapReady = true;
  for (const id of Object.keys(srcData)) map.getSource(id)?.setData(srcData[id]);
  map.resize();
  ensureWx(true);
  setInterval(() => ensureWx(), 300000);
}

/* MapLibre requests tiles from inside its rAF render loop, so a hidden tab
   never loads anything — that is not a failure, just a paused tab. Only treat a
   still-empty map as broken once the page is actually visible. */
function watchForBlankMap() {
  if (mapReady) return;
  if (document.visibilityState !== 'visible') return setTimeout(watchForBlankMap, 5000);
  toast('Vector tiles unavailable — using fallback map');
  map.setStyle(RASTER_FALLBACK);
  map.once('styledata', addOverlays);
}

/* Wind drawn over the trail itself.

   Mapbox's hosted GFS tileset stops at zoom 2 and GFS is a 28 km grid, so there
   is nothing to sample at trail scale. But that also means the field is uniform
   here — so we render a uniform flow from the one vector we do have, which is
   exactly what the data supports. When a session is open this shows the wind as
   it was when THAT trail was laid, not the wind now. */
let windFx = null;
let currentWx = null;

function windSource() {
  return currentWx && currentWx.wind_direction != null ? currentWx : null;
}

function applyWind() {
  if (!windFx) windFx = new WindOverlay($('windCanvas'), map);
  const read = $('windRead');

  if (!settings.wind) {
    windFx.stop();
    read.hidden = true;
    return;
  }

  const wx = windSource();
  if (!wx) {
    // Nothing to draw yet — fetch for wherever the map is looking.
    const c = map.getCenter();
    read.hidden = false;
    read.innerHTML = 'Fetching wind…';
    fetchWeather(c.lat, c.lng, Date.now())
      .then(w => { currentWx = w; applyWind(); })
      .catch(() => { read.innerHTML = 'Wind unavailable offline'; });
    return;
  }

  windFx.setWind(wx.wind_speed, wx.wind_direction);
  windFx.start();

  const to = blowsToward(wx.wind_direction);
  read.hidden = false;
  read.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <g transform="rotate(${to} 8 8)"><path d="M8 1 L11.5 13 L8 10.5 L4.5 13 Z" fill="#ffffff"/></g>
    </svg>
    from <b>${cardinal(wx.wind_direction)}</b> at <b>${(wx.wind_speed ?? 0).toFixed(1)}</b> m/s
    — scent drifts <b>${cardinal(to)}</b>`;
}

/* ── Wind badge ───────────────────────────────────────────────────── */

/* Wind speed, on the map, all the time. It was only ever shown inside the
   record sheet and only when the Wind layer was switched on — so the moment you
   dropped the sheet to see the ground, the number you were standing there to
   read went with it. */
const WB = { at: 0, lat: null, lon: null, busy: false };

function paintWindBadge(wx) {
  const el = $('windBadge');
  if (!wx || wx.wind_speed == null) { el.hidden = true; return; }
  el.hidden = false;

  const to = blowsToward(wx.wind_direction);
  $('wbArrow').setAttribute('transform', `rotate(${to} 11 11)`);
  $('wbSpeed').textContent = wx.wind_speed.toFixed(1);

  const gust = wx.wind_gusts != null && wx.wind_gusts > wx.wind_speed + 0.4
    ? ` &middot; gusting <b>${wx.wind_gusts.toFixed(1)}</b>` : '';
  $('wbSub').innerHTML =
    `from <b>${cardinal(wx.wind_direction)}</b>${gust}<br>scent drifts <b>${cardinal(to)}</b>`;
}

/** Keep a reading for wherever the map is looking. Refetched when it goes stale
    or when the map has moved far enough that the old cell no longer applies. */
async function ensureWx(force) {
  if (!mapReady || WB.busy) return;
  const c = map.getCenter();
  const moved = WB.lat == null ? Infinity : dist({ lat: WB.lat, lon: WB.lon }, { lat: c.lat, lon: c.lng });
  if (!force && Date.now() - WB.at < 600000 && moved < 2000) return;

  WB.busy = true;
  try {
    const wx = await fetchWeather(c.lat, c.lng, Date.now());
    currentWx = wx;
    WB.at = Date.now(); WB.lat = c.lat; WB.lon = c.lng;
    paintWindBadge(wx);
    if (settings.wind && !LIVE.on) applyWind();
  } catch { /* offline — keep whatever was last known rather than blanking it */ }
  WB.busy = false;
}

/** The HUD owns the top strip while recording, so the badge steps below it. */
function placeWindBadge() {
  $('windBadge').classList.toggle('below-hud', !$('hud').hidden);
}

const lineOf = (pts) => pts.length < 2 ? EMPTY : {
  type: 'FeatureCollection',
  features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: pts.map(p => [p.lon, p.lat]) } }],
};
function setSrc(id, data) {
  srcData[id] = data;
  if (mapReady && map.getSource(id)) map.getSource(id).setData(data);
}

function fitTo(...groups) {
  const pts = groups.flat().filter(Boolean);
  if (pts.length < 2 || !mapReady) return;
  const b = new mapboxgl.LngLatBounds();
  pts.forEach(p => b.extend([p.lon, p.lat]));
  map.fitBounds(b, { padding: 70, pitch: 62, duration: 900 });
}

/* ── Weather (Open-Meteo, no API key) ─────────────────────────────── */

/* Every one of these is served at 15-minute resolution, soil temperature
   included — verified against the live API, not assumed. That matters more than
   it sounds: over one Somerset morning the ground goes from level with the air
   to 2.3 °C warmer while the wind backs 26° and doubles. A trail laid at 08:00
   and worked at 09:30 is worked in different air from the air it was laid in,
   and an hourly snapshot cannot see that at all. */
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

/** How far either side of the trail to keep 15-minute samples. A trail can be
    laid in the morning and worked hours later, and the replay needs the whole
    span — but there is no point carrying a week of it into localStorage. */
const SERIES_SPAN = 6 * 3600e3;

async function fetchWeather(lat, lon, when) {
  /* forecast_days=3: a trail can be DESIGNED for tomorrow (draw mode grades on
     the laid-at time), so the series must reach into the forecast. With only
     today requested, the nearest-sample fallback silently graded tomorrow's
     trail on tonight's wind — labelled as forecast. The gap field below is the
     honesty rail for whatever still falls outside the window. */
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}`
    + `&minutely_15=${WX_VARS}&past_days=2&forecast_days=3&timezone=auto&wind_speed_unit=ms`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`weather ${res.status}`);
  const j = await res.json();

  const block = j.minutely_15 || j.hourly;
  if (!block?.time?.length) throw new Error('weather: empty response');
  const times = block.time.map(t => new Date(t).getTime());

  // The sample nearest the moment the trail was laid — this stays the headline
  // snapshot, so sessions saved before the series existed still read the same.
  let best = 0, bestGap = Infinity;
  times.forEach((t, i) => { const g = Math.abs(t - when); if (g < bestGap) { bestGap = g; best = i; } });
  const at = (k, i = best) => block[MAP_VARS[k]]?.[i] ?? null;

  // How far the nearest sample sits from the asked-for moment. Zero in normal
  // use; large when the moment falls outside the ±2/+3-day window — callers
  // must say so rather than present a neighbouring day's weather as the truth.
  const snapshot = { time: block.time[best], gap: bestGap };
  for (const k of Object.keys(MAP_VARS)) snapshot[k] = at(k);

  // …and the run of samples around it, so the replay can follow the wind veering
  // and the ground warming while the trail sat there ageing.
  const series = [];
  times.forEach((t, i) => {
    if (Math.abs(t - when) > SERIES_SPAN) return;
    const s = { t };
    for (const k of Object.keys(MAP_VARS)) s[k] = at(k, i);
    if (s.wind_speed != null || s.temp != null) series.push(s);
  });

  return { ...snapshot, series };
}


/* ── Recorder ─────────────────────────────────────────────────────── */
const rec = { on: false, mode: 'runner', pts: [], wps: [], started: 0, dropped: 0, watch: null, lock: null, linkTo: null };

function gpsClass(acc) {
  if (acc == null) return ['', 'Waiting for fix'];
  if (acc <= 10) return ['ok', 'Strong fix'];
  if (acc <= Number(settings.accCap)) return ['mid', 'Usable fix'];
  return ['', 'Weak — rejecting'];
}

function onFix(pos) {
  const { latitude: lat, longitude: lon, accuracy: acc, altitude: alt } = pos.coords;
  const [cls, label] = gpsClass(acc);
  $('fixDot').className = `dot ${cls}`;
  $('fixText').textContent = label;
  $('fixAcc').textContent = acc != null ? `±${acc.toFixed(0)} m` : '—';
  if (!rec.on) return;

  const pt = { lat, lon, t: pos.timestamp || Date.now(), acc, alt: alt ?? null };
  const last = rec.pts[rec.pts.length - 1];

  // Same predicate the tests exercise: reject poor fixes, and suppress the
  // stationary jitter that otherwise scribbles the track while you read the dog.
  if (!shouldKeep(last, pt, Number(settings.accCap), Number(settings.stillCap))) {
    rec.dropped++; return updateHud();
  }

  rec.pts.push(pt);
  setSrc(rec.mode, lineOf(rec.pts));
  if (rec.pts.length === 1) {
    map.easeTo({ center: [lon, lat], zoom: 17 });
    startLive();                 // first fix is the earliest we know where we are
  } else {
    liveAppend();                // every step after that starts emitting
  }
  updateHud();
}

function updateHud() {
  $('statDist').textContent = Math.round(pathLen(rec.pts));
  $('statTime').textContent = fmtDur(Date.now() - rec.started);
  $('statPts').textContent = rec.pts.length;
  $('statDrop').textContent = rec.dropped;
}

/* Location refused, told plainly and with the way out. Both recording modes
   need GPS — the dog's line IS the measurement the verdict is built from — so
   this is a hard stop, not a warning to work around. */
function locationBlocked() {
  if (rec.on) stopRec('Location blocked — nothing recorded');
  $('hud').hidden = true;
  placeWindBadge();
  toast('Location blocked. Tap aA → Website Settings → Location → Ask, then reload');
}

async function startRec() {
  if (!navigator.geolocation) return toast('No GPS on this device');
  if (!window.isSecureContext) return toast('Needs https — run: npm run cert');

  /* Ask before committing to a recording. Starting one that can never get a fix
     means walking an entire trail and finding out at the end that nothing was
     saved — which is the single worst thing this app could do to somebody. */
  try {
    const perm = await navigator.permissions?.query({ name: 'geolocation' });
    if (perm?.state === 'denied') return locationBlocked();
  } catch { /* Permissions API is optional — the watch error path still catches it */ }

  rec.on = true; rec.pts = []; rec.wps = []; rec.dropped = 0; rec.started = Date.now();
  stopAgeing();
  /* A preview plume is already running off the trail being worked, and it is the
     right one — the dog is about to work that ground. Hand it over rather than
     tearing it down and rebuilding the same particles. */
  LIVE.preview = false;
  /* Clear the map for a fresh track — except, in Dog mode, the trail being
     worked. That line is the whole reference you are out there to follow, and
     wiping it the instant you press Start is the opposite of useful. */
  const keep = (rec.mode === 'dog' && rec.linkTo) ? byId(rec.linkTo) : null;
  setSrc('runner', keep?.points?.length ? lineOf(keep.points) : EMPTY);
  setSrc('dog', EMPTY); setSrc('wps', EMPTY); setSrc('drift', EMPTY);

  $('btnRecord').classList.add('live');
  $('recordLabel').textContent = 'Stop';
  $('hud').hidden = false;
  $('waypoints').hidden = false;
  placeWindBadge();
  $('modeRow').style.pointerEvents = 'none';
  $('modeRow').style.opacity = '.5';

  try { rec.lock = await navigator.wakeLock?.request('screen'); } catch { /* not fatal */ }
  rec.watch = navigator.geolocation.watchPosition(onFix,
    (e) => {
      if (e.code === 1) return locationBlocked();          // denied — stop, don't limp on
      toast(e.code === 3 ? 'No fix yet — open sky helps' : 'GPS error');
    },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });

  clearInterval(rec.tick); rec.tick = setInterval(updateHud, 1000);

  /* A recorder that has seen nothing at all after half a minute is not "waiting
     for a fix", it is broken. Say so while there is still time to fix it,
     rather than at the end of the trail. */
  clearTimeout(rec.deaf);
  rec.deaf = setTimeout(() => {
    if (rec.on && rec.pts.length === 0 && rec.dropped === 0) {
      toast('No GPS after 30s — check location permission');
    }
  }, 30000);
  toast(rec.mode === 'runner' ? 'Laying trail' : 'Working trail');
}

async function stopRec(reason) {
  rec.on = false;
  stopLive();
  navigator.geolocation.clearWatch(rec.watch);
  clearInterval(rec.tick);
  clearTimeout(rec.deaf);
  try { await rec.lock?.release(); } catch { /* already gone */ }
  rec.lock = null;

  $('btnRecord').classList.remove('live');
  $('recordLabel').textContent = 'Start';
  $('waypoints').hidden = true;
  $('modeRow').style.pointerEvents = '';
  $('modeRow').style.opacity = '';

  if (rec.pts.length < 2) { $('hud').hidden = true; placeWindBadge(); return toast(reason || 'Too short to save'); }

  const who = rec.mode === 'dog' ? activeDog() : null;
  const s = {
    id: `s${Date.now()}`, mode: rec.mode,
    dog: who?.name || settings.dogName || 'Unnamed', dogId: who?.id || null,
    started: rec.started, ended: Date.now(), points: rec.pts, waypoints: rec.wps,
    linkTo: rec.mode === 'dog' ? rec.linkTo : null, weather: null,
  };

  /* Hot, warm or cold — from the real gap between the trail being laid and the
     dog starting, never self-reported. Stored so the record survives even if
     the linked trail is later deleted. */
  if (s.mode === 'dog' && s.linkTo) {
    const laid = byId(s.linkTo);
    if (laid) s.klass = trailClass(s.started - laid.started);
  }

  try {
    s.weather = await fetchWeather(rec.pts[0].lat, rec.pts[0].lon, rec.started);
  } catch {
    toast('Saved — weather unavailable offline');
  }

  sessions.unshift(s); save(S.sessions, sessions);
  $('hud').hidden = true;
  placeWindBadge();
  renderSessions();
  openDetail(s.id);
}

function addWaypoint(kind) {
  const last = rec.pts[rec.pts.length - 1];
  if (!last) return toast('No fix yet');
  rec.wps.push({ kind, lat: last.lat, lon: last.lon, t: Date.now() });
  setSrc('wps', {
    type: 'FeatureCollection',
    features: rec.wps.map(w => ({
      type: 'Feature', properties: { kind: w.kind },
      geometry: { type: 'Point', coordinates: [w.lon, w.lat] },
    })),
  });
  navigator.vibrate?.(35);
  toast(kind);
}

/* ── Session rendering ────────────────────────────────────────────── */
const byId = (id) => sessions.find(s => s.id === id);

/* An entity's face, or its initial where no photo was given. */
const avatarHtml = (ent, cls = '') => {
  const init = esc((ent?.name || '?').trim().charAt(0).toUpperCase() || '?');
  const style = ent?.photo ? ` style="background-image:url(${ent.photo})"` : '';
  return `<span class="avatar ${cls}${ent?.photo ? ' has-photo' : ''}"${style}>${init}</span>`;
};

const klassPill = (k) =>
  k ? `<span class="pill klass ${k}">${k} trail</span>` : '';

/* One dog at a time, or the whole pack. Filter is view state, not data. */
let sessFilter = null;

function renderFilterRow() {
  const row = $('sessFilter');
  const worked = new Set(sessions.filter(s => s.dogId).map(s => s.dogId));
  const show = team.dogs.length >= 2 && worked.size >= 1;
  row.hidden = !show;
  if (!show) { sessFilter = null; return; }
  if (sessFilter && !dogById(sessFilter)) sessFilter = null;
  row.innerHTML = [
    `<button class="chip" data-filterdog="" aria-pressed="${!sessFilter}">All</button>`,
    ...team.dogs.map(d =>
      `<button class="chip" data-filterdog="${d.id}" aria-pressed="${sessFilter === d.id}">${esc(d.name)}</button>`),
  ].join('');
}

function renderSessions() {
  const el = $('sessionList');
  renderFilterRow();
  if (!sessions.length) {
    el.innerHTML = '<p class="empty">No trails yet.<br>Record a runner trail, then work it with the dog.</p>';
    return;
  }
  const shown = sessFilter ? sessions.filter(s => s.dogId === sessFilter) : sessions;
  if (!shown.length) {
    el.innerHTML = `<p class="empty">${esc(dogById(sessFilter)?.name || 'This dog')} has no trails yet.</p>`;
    return;
  }
  el.innerHTML = shown.map(s => {
    const d = Math.round(pathLen(s.points));
    const mins = fmtDur(s.ended - s.started);
    const wx = s.weather;
    const who = s.dogId ? dogById(s.dogId) : null;
    return `<div class="card" data-open="${s.id}">
      <div class="card-top">
        ${s.mode === 'dog' ? avatarHtml(who || { name: s.dog }, 'mini') : ''}
        <h3>${s.mode === 'runner' ? 'Runner trail' : `Dog — ${esc(s.dog)}`}</h3>
        <time>${new Date(s.started).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</time>
      </div>
      <div class="card-meta">
        <span class="pill ${s.mode}">${d} m</span>
        ${klassPill(classOf(s))}
        ${s.imported ? `<span class="pill">from ${esc(s.imported.from)}</span>` : ''}
        ${s.drawn ? '<span class="pill drawn">drawn</span>' : ''}
        <span class="pill">${mins}</span>
        ${s.waypoints.length ? `<span class="pill">${s.waypoints.length} marks</span>` : ''}
        ${wx?.temp != null ? `<span class="pill">${wx.temp.toFixed(1)}°C</span>` : ''}
        ${wx?.wind_speed != null ? `<span class="pill">${wx.wind_speed.toFixed(1)} m/s ${cardinal(wx.wind_direction)}</span>` : ''}
      </div>
    </div>`;
  }).join('');
}

const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let detailId = null;   // which session the detail view currently shows

function openDetail(id) {
  const s = byId(id); if (!s) return;
  detailId = id;
  const linked = s.linkTo ? byId(s.linkTo) : sessions.find(x => x.linkTo === s.id);
  const runner = s.mode === 'runner' ? s : linked;
  const dog = s.mode === 'dog' ? s : linked;
  const wx = (runner || s).weather;

  show('viewDetail');
  $('detailTitle').textContent = s.mode === 'runner' ? 'Runner trail' : `Dog — ${s.dog}`;

  setSrc('runner', runner ? lineOf(runner.points) : EMPTY);
  setSrc('dog', dog ? lineOf(dog.points) : EMPTY);
  // Scent field resolved against the direction the runner was travelling.
  const field = (runner && wx) ? scentField(runner.points, wx, dog?.started) : [];
  setSrc('drift', field.length ? plumePolygon(field) : EMPTY);
  setSrc('wps', {
    type: 'FeatureCollection',
    features: (s.waypoints || []).map(w => ({
      type: 'Feature', properties: { kind: w.kind }, geometry: { type: 'Point', coordinates: [w.lon, w.lat] },
    })),
  });
  fitTo(runner?.points || [], dog?.points || []);

  /* The plume, live, on the trail being looked at — not only in replay. The
     particles run off the laid ground under CURRENT weather: what is left of
     this trail right now, which is the question a detail view answers. */
  if (!rec.on && runner?.points?.length) {
    if (LIVE.on && LIVE.preview) stopLive();
    startLive({ trail: runner.points, origin: runner.points[0] });
  }

  // Animate the wind as it was when THIS trail was laid, not as it is now.
  if (wx) { currentWx = wx; if (settings.wind) applyWind(); }

  // Mean separation between the laid trail and the dog's actual path.
  const dev = (runner && dog) ? meanOffset(runner.points, dog.points) : null;

  const w = (v, u, l, dp = 1) => v == null ? '' :
    `<div><b>${Number(v).toFixed(dp)}${u}</b><i>${l}</i></div>`;

  $('detailBody').innerHTML = `
    <div class="wx">
      <div><b>${Math.round(pathLen(s.points))}m</b><i>length</i></div>
      <div><b>${fmtDur(s.ended - s.started)}</b><i>duration</i></div>
      ${dev != null ? `<div><b>${dev.toFixed(1)}m</b><i>mean offset</i></div>` : ''}
      ${runner && dog ? `<div><b>${fmtDur(dog.started - runner.started)}</b><i>trail age</i></div>` : ''}
    </div>

    ${dog ? klassRow(dog) : ''}

    ${runner ? `<button class="replay-btn" data-replay="${s.id}">
      ▶ Replay with scent &amp; wind
      <em>watch the plume drift and the dog cross it</em>
    </button>` : ''}

    ${(runner && !dog) ? `<div class="worknow">
      <span>Work this trail</span>
      <div class="worknow-row">
        <button data-work="${runner.id}" data-in="0">Now</button>
        <button data-work="${runner.id}" data-in="10">10 min</button>
        <button data-work="${runner.id}" data-in="20">20 min</button>
        <button data-work="${runner.id}" data-in="45">45 min</button>
        <button data-work="${runner.id}" data-in="custom">Custom</button>
      </div>
    </div>` : ''}

    ${(runner || s).drawn ? `<p class="hint">This trail was <b>drawn, not recorded</b>.
      Its shape is as accurate as the taps, and its timing assumes a steady
      ${(((runner || s).points.length > 1)
        ? (pathLen((runner || s).points) / (((runner || s).ended - (runner || s).started) / 1000)).toFixed(1)
        : '1.3')} m/s. The weather and the scent model are real either way.</p>` : ''}

    <h2 class="sec">Conditions when laid</h2>
    ${(wx?.gap ?? 0) > 2 * 3600e3 ? `<p class="hint"><b>Weather data ends
      ${Math.round(wx.gap / 3600e3)} h short of the laid time</b> — the nearest
      available sample is shown, and the scent read leans on it.</p>` : ''}
    ${wx ? `<div class="wx">
      ${w(wx.temp, '°C', 'air temp')}
      ${w(wx.soil_temp, '°C', 'ground temp')}
      ${w(wx.humidity, '%', 'humidity', 0)}
      ${w(wx.dew_point, '°C', 'dew point')}
      ${w(wx.wind_speed, ' m/s', 'wind')}
      ${w(wx.wind_gusts, ' m/s', 'gusts')}
      ${w(wx.precipitation, ' mm', 'rain')}
      ${w(wx.pressure, ' hPa', 'pressure', 0)}
    </div>
    ${wx.wind_direction != null ? compass(wx) : ''}
    ${field.length ? windOnTrail(field, wx, dev) : ''}
    ${wx.soil_temp != null && wx.temp != null ? `<p class="hint">
      Ground is ${Math.abs(wx.soil_temp - wx.temp).toFixed(1)}°C
      ${wx.soil_temp > wx.temp ? 'warmer' : 'cooler'} than the air —
      scent tends to ${wx.soil_temp > wx.temp ? 'rise off the ground' : 'stay low and pool'}.
    </p>` : ''}` : '<p class="hint">No weather recorded — you were offline when this saved.</p>'}

    <h2 class="sec">Marks</h2>
    ${s.waypoints.length
      ? `<div class="card-meta">${s.waypoints.map(x =>
          `<span class="pill">${esc(x.kind)} · ${new Date(x.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>`).join('')}</div>`
      : '<p class="hint">None.</p>'}

    ${s.imported ? `<p class="hint">Received as a <b>Trail Card</b> from
      ${esc(s.imported.from)}${s.approx ? ` — the line was thinned to fit the code (within ~${s.tol || 10} m)` : ''}.
      The laid time is the original one, so ageing and class read true.</p>` : ''}

    <h2 class="sec">Export</h2>
    <div class="row-btns">
      ${s.mode === 'runner' ? `<button class="ghost" data-card="${s.id}">Trail Card</button>` : ''}
      <button class="ghost" data-gpx="${s.id}">Download GPX</button>
      <button class="danger" data-del="${s.id}">Delete</button>
    </div>
    <p class="hint">Scent drift is illustrative. Weather models report wind at 10&nbsp;m
      over open ground; under canopy at nose height the real airflow is weaker and
      can run the other way. Use it to explain the dog's line, not to predict it.</p>`;
}

/* Hot / warm / cold for this working — computed from real timestamps, with the
   handler able to overrule (a re-laid line, a wrong drawn-at time). Tapping
   the computed class again clears the override, so auto is always one tap
   away and the timestamps stay the source of truth. */
function klassRow(dogSess) {
  const cur = classOf(dogSess);
  if (!cur && !dogSess.linkTo) return '';         // free run — nothing to classify
  const overridden = dogSess.klassManual && dogSess.klassManual !== dogSess.klass;
  return `<div class="klass-row">
    <span>Trail class</span>
    <div class="klass-btns">
      ${['hot', 'warm', 'cold'].map(k =>
        `<button class="${cur === k ? `klass ${k}` : ''}" data-setklass="${k}"
          data-sid="${dogSess.id}" aria-pressed="${cur === k}">${k}</button>`).join('')}
    </div>
    ${overridden ? `<p class="hint">Reclassified by hand — from the timestamps it was
      ${dogSess.klass ?? 'unclassifiable'}. Tap ${dogSess.klass ? `<b>${dogSess.klass}</b>` : 'it'} to go back to automatic.</p>` : ''}
  </div>`;
}

/* Plain-language read of how the wind sat against the trail, and an honest
   comparison of what the model predicted against what the dog actually did. */
function windOnTrail(field, wx, dev) {
  const legs = legSummary(field);
  if (!legs.length) return '';
  const ageS = field[0].ageS;
  const predicted = scentOffset(wx.wind_speed ?? 0, ageS);
  const dominant = legs.reduce((a, b) => (b.n > a.n ? b : a));

  const say = {
    crosswind: `pushed <b>${dominant.side} of the line</b> — expect the dog working a parallel track`,
    headwind: 'pushed <b>back down the trail</b> — expect the dog to hang behind the true position',
    tailwind: 'pushed <b>forward up the trail</b> — expect the dog ahead of it, and cutting corners',
  }[dominant.label];

  return `<h2 class="sec">Wind on the trail</h2>
    <div class="card-meta">${legs.map(l =>
      `<span class="pill">${l.label}${l.label === 'crosswind' ? ' · ' + l.side : ''}</span>`).join('')}</div>
    <p class="hint">Mostly <b>${dominant.label}</b>: scent ${say}.
      At ${(wx.wind_speed ?? 0).toFixed(1)} m/s the model puts the workable line
      about <b>${predicted.toFixed(0)} m</b> off the true trail.</p>
    ${dev != null ? `<p class="hint">Your dog actually averaged
      <b>${dev.toFixed(1)} m</b> from the line
      ${Math.abs(dev - predicted) < 4 ? '— close to the model.'
        : dev < predicted ? '— tighter than the model predicted, so the drift factor is set too high for this ground.'
        : '— wider than the model predicted, so the drift factor is set too low for this ground.'}
      Enough trails and this calibrates itself.</p>` : ''}`;
}

function compass(wx) {
  const to = ((wx.wind_direction ?? 0) + 180) % 360;
  return `<div class="compass">
    <svg width="66" height="66" viewBox="0 0 66 66" aria-hidden="true">
      <circle cx="33" cy="33" r="30" fill="none" stroke="#DCE4F0" stroke-width="2"/>
      <text x="33" y="12" fill="#8B96AA" font-size="9" text-anchor="middle">N</text>
      <g transform="rotate(${to} 33 33)">
        <path d="M33 12 L39 42 L33 37 L27 42 Z" fill="#2E7CF6"/>
      </g>
    </svg>
    <p>Wind from <b>${cardinal(wx.wind_direction)}</b>
      (${Math.round(wx.wind_direction)}°) at ${wx.wind_speed?.toFixed(1)} m/s.<br>
      Scent drifts toward <b>${cardinal(to)}</b>.</p>
  </div>`;
}

/* ── GPX ──────────────────────────────────────────────────────────── */
function downloadGPX(id) {
  const s = byId(id); if (!s) return;
  const pts = s.points.map(p =>
    `   <trkpt lat="${p.lat.toFixed(7)}" lon="${p.lon.toFixed(7)}">` +
    (p.alt != null ? `<ele>${p.alt.toFixed(1)}</ele>` : '') +
    `<time>${new Date(p.t).toISOString()}</time></trkpt>`).join('\n');
  const wps = (s.waypoints || []).map(w =>
    ` <wpt lat="${w.lat.toFixed(7)}" lon="${w.lon.toFixed(7)}"><name>${esc(w.kind)}</name>` +
    `<time>${new Date(w.t).toISOString()}</time></wpt>`).join('\n');

  const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Trailcraft" xmlns="http://www.topografix.com/GPX/1/1">
 <metadata><name>${esc(s.mode)} — ${esc(s.dog)}</name><time>${new Date(s.started).toISOString()}</time></metadata>
${wps}
 <trk><name>${esc(s.mode)}</name><trkseg>
${pts}
 </trkseg></trk>
</gpx>`;

  const url = URL.createObjectURL(new Blob([gpx], { type: 'application/gpx+xml' }));
  const a = document.createElement('a');
  a.href = url; a.download = `trailcraft-${s.id}.gpx`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ── Terrain ──────────────────────────────────────────────────────── */

/* The wind data is a 28 km cell. The ground under it is 10 m data. Bending the
   coarse wind around real terrain is what makes the flow field worth having, so
   the first thing the replay needs is an elevation grid over the trail.

   Mapbox already loads a DEM for the 3D view, and queryTerrainElevation reads
   straight out of it — no second download, no tile decoding. It returns null
   for tiles that have not loaded yet, which is why this waits for idle and
   gives up honestly rather than building a terrain full of holes. */
const TERRAIN_N = 44;
let terrain = FLAT;

function squareBbox(points, marginM = 90) {
  let west = Infinity, east = -Infinity, north = -Infinity, south = Infinity;
  for (const p of points) {
    west = Math.min(west, p.lon); east = Math.max(east, p.lon);
    north = Math.max(north, p.lat); south = Math.min(south, p.lat);
  }
  const cLat = (north + south) / 2, cLon = (west + east) / 2;
  const mLat = 111320, mLon = 111320 * Math.cos(cLat * Math.PI / 180) || 1;
  // Square in metres, because buildTerrain assumes one cell size in both axes.
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
    // A partial grid is worse than none: it invents cliffs where the data stops.
    if (e == null || !Number.isFinite(e)) return FLAT;
    h[j * n + i] = e;
  }
  return buildTerrain(h, n, b.side / (n - 1), b);
}

/** The flow field as a plain (lat, lon) → {u, v} function, for the wind overlay. */
const fieldFor = (T, wx, st) => (lat, lon) => {
  const p = normOf(T, lat, lon);
  return flowAt(T, p.x, p.y, wx, st);
};

/* ── Scent overlay ────────────────────────────────────────────────── */

/* One pre-rendered blob, stamped per particle.

   Building a radial gradient per particle meant ~770 gradient objects every
   frame — comfortably the most expensive thing in the render loop, and the
   likeliest reason a phone would drop frames. The gradient never changes shape,
   only size and opacity, so it is built once and drawn scaled. */
function makeScentSprite(size = 64) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const x = c.getContext('2d'), r = size / 2;
  const g = x.createRadialGradient(r, r, 0, r, r, r);
  g.addColorStop(0, 'rgba(255,201,96,1)');
  g.addColorStop(0.45, 'rgba(247,148,44,0.45)');
  g.addColorStop(1, 'rgba(228,96,36,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, size, size);
  return c;
}

/* The plume is not drawn. It is the density of the particles sim.js moves, so
   it has holes, streaks and pools because the air does. Rendering it is the
   only part of scent that touches the DOM. */
class ScentOverlay {
  constructor(canvas, map) {
    this.canvas = canvas; this.map = map; this.ctx = canvas.getContext('2d');
  }
  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    this.canvas.width = Math.max(1, w * dpr); this.canvas.height = Math.max(1, h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = w; this.h = h;

    // Density accumulates in its own buffer, at the same scale.
    this.buf = this.buf || document.createElement('canvas');
    this.buf.width = this.canvas.width; this.buf.height = this.canvas.height;
    this.bctx = this.buf.getContext('2d');
    this.bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.sprite = this.sprite || makeScentSprite();
  }
  clear() { this.ctx?.clearRect(0, 0, this.w || 0, this.h || 0); }

  render(parts, mix = 1) {
    if (!this.w) this.resize();
    const { ctx, bctx } = this;
    ctx.clearRect(0, 0, this.w, this.h);
    if (!bctx) return;

    /* Accumulate the density in an isolated buffer, then composite it once.

       Adding particles straight onto the map washes bright satellite imagery to
       white — amber over sunlit grass just goes pale. Accumulating first keeps
       the plume reading as scent over any basemap. */
    bctx.clearRect(0, 0, this.w, this.h);
    bctx.globalCompositeOperation = 'lighter';

    let drawn = 0;
    for (const s of parts) {
      if (s.str < 0.02) continue;
      let p;
      try { p = this.map.project([s.lon, s.lat]); } catch { continue; }
      if (p.x < -60 || p.x > this.w + 60 || p.y < -60 || p.y > this.h + 60) continue;

      // Spread grows with how long the particle has been airborne, and faster
      // when the air is convective. This width IS the uncertainty.
      const rad = 5 + s.phase * 20 * mix;
      bctx.globalAlpha = Math.min(0.95, s.str * 0.9);
      bctx.drawImage(this.sprite, p.x - rad, p.y - rad, rad * 2, rad * 2);
      drawn++;
    }
    bctx.globalAlpha = 1;
    bctx.globalCompositeOperation = 'source-over';

    if (drawn) {
      ctx.globalAlpha = 0.88;
      ctx.drawImage(this.buf, 0, 0, this.w, this.h);
      ctx.globalAlpha = 1;
    }
    this.drawn = drawn;
  }
}

/* ── Ground layers ────────────────────────────────────────────────── */

/* Windy paints temperature as a smooth global gradient. Copied here that would
   be a flat wash over a 400 m field — a surface implying spatial detail the
   data does not have. So only things that genuinely vary at trail scale get
   painted; air temperature, humidity and pressure stay as numbers.

   Drawn as a Mapbox image source over the terrain's own bbox, which gets
   rotation and pitch handled for free. */
const LAYER_RES = 220;
let layerCanvas = null;

function paintLayer(kind, T, wx, st, when) {
  if (!T || T.flat || kind === 'none') return null;
  if (!layerCanvas) {
    layerCanvas = document.createElement('canvas');
    layerCanvas.width = layerCanvas.height = LAYER_RES;
  }
  const c = layerCanvas.getContext('2d');
  const img = c.createImageData(LAYER_RES, LAYER_RES);
  const d = img.data;

  const mid = T.bbox ? (T.bbox.north + T.bbox.south) / 2 : 51.2;
  const midLon = T.bbox ? (T.bbox.west + T.bbox.east) / 2 : -2.6;
  const sun = solarPosition(when, mid, midLon);
  const f = { u: 0, v: 0 }, e = 1 / (LAYER_RES - 1);

  for (let j = 0; j < LAYER_RES; j++) for (let i = 0; i < LAYER_RES; i++) {
    const x = i / (LAYER_RES - 1), y = j / (LAYER_RES - 1), o = (j * LAYER_RES + i) * 4;
    let r = 0, g = 0, b = 0, a = 0;

    if (kind === 'sun') {
      const t = Math.pow(insolation(T, x, y, sun), 0.8);
      r = 250; g = 186; b = 66; a = t * 190;
    } else if (kind === 'slope') {
      const gm = Math.hypot(sampleT(T.gx, T.n, x, y), sampleT(T.gy, T.n, x, y));
      r = 190; g = 200; b = 214; a = Math.min(1, gm * 3.4) * 165;
    } else if (kind === 'shelter') {
      flowAt(T, x, y, wx, st, f);
      const rel = Math.hypot(f.u, f.v) / Math.max(0.2, wx?.wind_speed || 0.2);
      r = 128; g = 116; b = 212; a = Math.max(0, 1 - rel) * 195;
    } else if (kind === 'pool') {
      // Convergence of the flow: where the air, and the scent it carries, collects.
      let div = 0;
      flowAt(T, x + e, y, wx, st, f); div += f.u;
      flowAt(T, x - e, y, wx, st, f); div -= f.u;
      flowAt(T, x, y + e, wx, st, f); div += f.v;
      flowAt(T, x, y - e, wx, st, f); div -= f.v;
      const ex = sampleT(T.expo, T.n, x, y);
      const conv = Math.max(0, -div) * 0.5 + Math.max(0, -ex) * 0.028;
      r = 58; g = 132; b = 226; a = Math.min(1, conv * (st?.drain ?? 0) * 1.5) * 215;
    }
    d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = a;
  }
  c.putImageData(img, 0, 0);
  return layerCanvas.toDataURL();
}

// Local alias so the layer painter does not need its own import of `sample`.
const sampleT = (grid, n, x, y) => {
  const fx = Math.min(n - 1.001, Math.max(0, x * (n - 1)));
  const fy = Math.min(n - 1.001, Math.max(0, y * (n - 1)));
  const i = fx | 0, j = fy | 0, tx = fx - i, ty = fy - j;
  return (grid[j * n + i] * (1 - tx) + grid[j * n + i + 1] * tx) * (1 - ty)
       + (grid[(j + 1) * n + i] * (1 - tx) + grid[(j + 1) * n + i + 1] * tx) * ty;
};

/** Which layers are worth offering right now. A layer that isn't a factor today
    should say so, not invent structure — that's what makes the others credible. */
function layerAvailability(T, wx, st) {
  const hasTerrain = !!T && !T.flat;
  const sun = T?.bbox ? solarPosition(Date.now(), (T.bbox.north + T.bbox.south) / 2,
                                      (T.bbox.west + T.bbox.east) / 2) : null;
  return {
    pool:    { ok: hasTerrain && (st?.drain ?? 0) > 0.3 && (st?.dT ?? 0) < -0.6,
               why: !hasTerrain ? 'no terrain' : 'not today' },
    sun:     { ok: hasTerrain, why: 'no terrain' },
    shelter: { ok: hasTerrain && (wx?.wind_speed ?? 0) > 0.5, why: !hasTerrain ? 'no terrain' : 'no wind' },
    slope:   { ok: hasTerrain, why: 'no terrain' },
  };
}

/* ── Live scent ───────────────────────────────────────────────────── */

/* The plume while you are still laying the trail.

   Every step you take starts emitting from the moment you take it, so the plume
   builds behind you — freshest at your feet, oldest at the start, already
   bleeding off downwind. In Dog mode it shows the plume of the trail being
   worked, which is the one the dog is actually in.

   Same engine as the replay, with one difference: the clock is now. Ages come
   from each point's own timestamp, but the flow moving that scent is the
   weather at this minute, because that is what is moving it. */
const LIVE = {
  on: false, sim: null, T: FLAT, wx: null, st: null, fx: null,
  raf: 0, lastAdv: 0, wxAt: 0, seeded: 0, rebuiltAt: 0,
};

/**
 * @param {object} [opts]
 * @param {Array}  [opts.trail]  ground to emit from. Defaults to whatever is
 *   being recorded — or, in Dog mode, the trail being worked.
 * @param {object} [opts.origin] where to read weather and terrain from. Lets the
 *   plume run before a single fix has arrived, which is what makes it possible
 *   to walk up to an aged trail and see it waiting for you.
 */
async function startLive(opts = {}) {
  if (LIVE.on || !settings.liveScent) return;

  const source = opts.trail
    || ((rec.mode === 'dog' && rec.linkTo) ? byId(rec.linkTo)?.points : rec.pts);
  const first = opts.origin || source?.[0] || rec.pts[0];
  if (!first || !source?.length) return;   // nothing to emit from yet
  LIVE.on = true;
  LIVE.preview = !rec.on;                  // showing a trail rather than recording one

  try {
    LIVE.wx = await fetchWeather(first.lat, first.lon, Date.now());
    LIVE.wxAt = Date.now();
  } catch { /* offline — the plume waits rather than inventing a wind */ }
  LIVE.st = stability(LIVE.wx?.soil_temp, LIVE.wx?.temp);
  if (LIVE.wx) paintWindBadge(LIVE.wx);

  // A generous square around where we started, so an ordinary trail stays inside it.
  LIVE.T = await terrainFor([first], 400);
  terrain = LIVE.T;

  LIVE.sim = new ScentSim().seed(source);
  // A fixed source trail never grows; only ground you are laying yourself does.
  LIVE.seeded = (opts.trail || rec.mode === 'dog') ? Infinity : rec.pts.length;

  if (!LIVE.fx) LIVE.fx = new ScentOverlay($('scentCanvas'), map);
  $('scentCanvas').hidden = false;
  LIVE.fx.resize();

  if (!windFx) windFx = new WindOverlay($('windCanvas'), map);
  windFx.setField(fieldFor(LIVE.T, LIVE.wx, LIVE.st));
  windFx.start();

  cancelAnimationFrame(LIVE.raf);
  LIVE.raf = requestAnimationFrame(liveFrame);
}

/** New ground laid since the last fix. Appending keeps existing particles' phase
    intact, which is what stops the plume flickering as you walk. */
function liveAppend() {
  if (!LIVE.on || !LIVE.sim || rec.mode === 'dog') return;
  const fresh = rec.pts.slice(LIVE.seeded);
  if (!fresh.length) return;
  LIVE.sim.append(fresh);
  LIVE.seeded = rec.pts.length;

  // Walked off the edge of the terrain we solved? Rebuild, but not constantly.
  const b = LIVE.T?.bbox, p = fresh[fresh.length - 1];
  if (b && Date.now() - LIVE.rebuiltAt > 45000 &&
      (p.lat > b.north || p.lat < b.south || p.lon < b.west || p.lon > b.east)) {
    LIVE.rebuiltAt = Date.now();
    terrainFor(rec.pts, 400).then(T => { LIVE.T = terrain = T; });
  }
}

function liveFrame(now) {
  if (!LIVE.on) return;

  // Conditions genuinely move: the 15-minute data is there to be used.
  if (rec.pts[0] && Date.now() - LIVE.wxAt > 600000) {
    LIVE.wxAt = Date.now();
    fetchWeather(rec.pts[0].lat, rec.pts[0].lon, Date.now())
      .then(w => {
        LIVE.wx = w;
        LIVE.st = stability(w?.soil_temp, w?.temp);
        windFx?.setField(fieldFor(LIVE.T, LIVE.wx, LIVE.st));
        paintWindBadge(w);
      })
      .catch(() => { /* keep the last good reading */ });
  }

  // 4 Hz, not every frame — this runs on a phone in someone's hand for an hour.
  if (!LIVE.lastAdv || now - LIVE.lastAdv > 250) {
    LIVE.sim.advance(LIVE.T, LIVE.wx, LIVE.st, Date.now());
    LIVE.lastAdv = now;
  }
  if (!LIVE.lastState || now - LIVE.lastState > 1500) {
    paintScentState();
    LIVE.lastState = now;
  }
  LIVE.fx.render(LIVE.sim.parts, LIVE.st?.mix ?? 1);
  LIVE.raf = requestAnimationFrame(liveFrame);
}

/* An empty plume and a broken app look exactly alike on screen, and that is the
   most damaging thing this could get wrong: a handler who thinks the app failed
   loses the reading, and a handler who thinks the trail is fine works dead
   ground. So when there is nothing left, it says so and says why. */
function paintScentState() {
  const el = $('scentState');
  if (!LIVE.on || !LIVE.sim || !LIVE.wx) { el.hidden = true; return; }

  const live = LIVE.sim.parts.reduce((n, p) => n + (p.str >= 0.02 ? 1 : 0), 0);
  const life = Math.round(scentLife(LIVE.wx, LIVE.st));
  const oldest = LIVE.sim.trail[0]?.t;
  const ageMin = oldest ? Math.round((Date.now() - oldest) / 60000) : 0;

  el.hidden = false;
  el.classList.toggle('cold', live === 0);
  el.classList.toggle('below-hud', !$('hud').hidden);

  el.innerHTML = live === 0
    ? `<span class="k">No workable scent</span>
       This trail is <b>${ageMin} min</b> old and scent life here is
       <b>${life} min</b>. ${LIVE.st?.dT > 1
         ? 'Ground is warmer than the air, so it has lifted and gone.'
         : 'Conditions have stripped it.'}`
    : `<span class="k">Scent</span>
       <b>${life} min</b> of life &middot; trail is <b>${ageMin} min</b> old`;
}

/* ── Walking up to an aged trail ──────────────────────────────────── */

/* Lay a trail, walk away, come back twenty minutes later — and the trail should
   be there waiting, with the plume that has been drifting off it the whole time.
   That means the live overlay has to run with no recording at all: the ground is
   already laid, so there is nothing to wait for a GPS fix to tell us. */
async function previewTrail() {
  if (rec.on) return;                        // a live recording drives its own plume
  if (LIVE.on && LIVE.preview) stopLive();

  const t = (rec.mode === 'dog' && rec.linkTo) ? byId(rec.linkTo) : null;
  if (!t?.points?.length) { setSrc('runner', EMPTY); return; }

  setSrc('runner', lineOf(t.points));
  setSrc('dog', EMPTY);
  fitTo(t.points);
  await startLive({ trail: t.points, origin: t.points[0] });
}

/* Ageing. Mantrailing deliberately lets a trail sit, and how long is a training
   decision — so it is a timer you set, not a number you remember. */
const AGE = { id: null, until: 0, tick: 0 };

function stopAgeing() {
  clearInterval(AGE.tick);
  AGE.tick = 0; AGE.until = 0; AGE.id = null;
  $('ageChip').hidden = true;
}

function tickAgeing() {
  const left = AGE.until - Date.now();
  if (left <= 0) {
    stopAgeing();
    navigator.vibrate?.([90, 60, 90]);
    toast('Trail is ready — start the dog');
    return;
  }
  const s = Math.round(left / 1000);
  // The class the trail is RIGHT NOW, ageing live under the countdown.
  const laid = byId(AGE.id);
  const k = laid ? trailClass(Date.now() - laid.started) : null;
  $('ageChip').hidden = false;
  $('ageChip').innerHTML =
    `<b>${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}</b>` +
    `<i>until you work it${k ? ` · <span class="klass ${k}">${k}</span> now` : ''}</i>`;
}

function startAgeing(id, minutes) {
  AGE.id = id;
  AGE.until = Date.now() + minutes * 60000;
  clearInterval(AGE.tick);
  AGE.tick = setInterval(tickAgeing, 1000);
  tickAgeing();
}

/** Put the app in front of this trail, in Dog mode, ready to work it. */
function armWork(trailId, minutes) {
  const s = byId(trailId);
  if (!s) return toast('That trail is gone');

  rec.mode = 'dog';
  document.querySelectorAll('.mode').forEach(x =>
    x.setAttribute('aria-pressed', String(x.dataset.mode === 'dog')));
  $('trailPicker').hidden = false;
  refreshDogPicker();
  refreshTrailPicker();
  $('trailSelect').value = trailId;
  rec.linkTo = trailId;

  show(null);                                // out of the panel, back to the ground
  document.querySelectorAll('.tabs button').forEach(x =>
    x.classList.toggle('active', x.dataset.view === 'map'));

  if (minutes > 0) { startAgeing(trailId, minutes); toast(`Working this trail in ${minutes} min`); }
  else { stopAgeing(); toast('Dog mode — press Start when you are on the line'); }

  previewTrail();
}

function stopLive() {
  LIVE.on = false;
  LIVE.preview = false;
  $('scentState').hidden = true;
  cancelAnimationFrame(LIVE.raf);
  LIVE.fx?.clear();
  $('scentCanvas').hidden = true;
  windFx?.setField(null);
  if (settings.wind) applyWind(); else windFx?.stop();
}

/* ── Replay ───────────────────────────────────────────────────────── */

/* One clock drives everything: the trails, the plume, the wind particles, the
   instruments and the verdict all read the same instant. That is the whole
   reason the picture is coherent rather than a pile of overlays. */
const RP = {
  on: false, runner: null, dog: null, T: FLAT, sim: null, scentFx: null,
  t: 0, t0: 0, t1: 0, playing: false, raf: 0, lastAdv: 0, lastDraw: 0,
  layer: 'none', wx: null, st: null, predicted: null,
};

const RP_SPEED = 90;    // replay seconds per real second — a 2 h session in ~80 s

async function openReplay(id) {
  const s = byId(id); if (!s) return;
  const linked = s.linkTo ? byId(s.linkTo) : sessions.find(x => x.linkTo === s.id);
  const runner = s.mode === 'runner' ? s : linked;
  const dog = s.mode === 'dog' ? s : linked;
  if (!runner) return toast('Replay needs the runner trail this dog worked');

  // Replay owns the scent canvas; the detail-view preview plume must let go.
  if (LIVE.on && LIVE.preview) stopLive();

  show(null);
  // The record sheet is not one of the panels show() manages, and it owns the
  // bottom third of the screen — exactly where the transport bar goes.
  $('sheetRecord').hidden = true;
  $('replay').hidden = false;
  $('rpBuild').hidden = false;
  RP.on = true; RP.runner = runner; RP.dog = dog;
  RP.t0 = runner.started;
  RP.t1 = dog ? dog.ended : runner.ended + 3600e3;
  RP.t = RP.t0;
  RP.layer = 'none';
  RP.playing = false;

  fitTo(runner.points, dog?.points || []);
  RP.T = await terrainFor([...runner.points, ...(dog?.points || [])]);
  terrain = RP.T;

  // The static drift ribbon from the detail view is superseded here: the plume
  // is now the particle density, and showing both claims two different answers.
  setSrc('drift', EMPTY);

  RP.sim = new ScentSim().seed(runner.points);
  if (!RP.scentFx) RP.scentFx = new ScentOverlay($('scentCanvas'), map);
  $('scentCanvas').hidden = false;
  RP.scentFx.resize();

  if (!windFx) windFx = new WindOverlay($('windCanvas'), map);
  windFx.start();

  RP.predicted = null;
  $('rpBuild').hidden = true;
  $('rpTerrain').textContent = RP.T.flat
    ? 'No elevation data — flow is the plain forecast'
    : `Terrain ${TERRAIN_N}×${TERRAIN_N} over ${Math.round(squareBbox(runner.points).side)} m`;

  // Order matters: availability depends on the conditions, so the clock has to
  // be set before the layer list can decide what is a factor today.
  setReplayTime(RP.t0);
  renderLayerButtons();
  cancelAnimationFrame(RP.raf);
  RP.raf = requestAnimationFrame(replayFrame);
}

function closeReplay() {
  RP.on = false; RP.playing = false;
  cancelAnimationFrame(RP.raf);
  $('replay').hidden = true;
  $('sheetRecord').hidden = false;
  $('scentCanvas').hidden = true;
  RP.scentFx?.clear();
  windFx?.stop();
  windFx?.setField(null);
  setLayerImage(null);
  // Put the wind back the way the user's own setting had it.
  if (settings.wind) applyWind();
  show('viewDetail');
}

function setReplayTime(t) {
  RP.t = Math.max(RP.t0, Math.min(RP.t1, t));
  const span = RP.t1 - RP.t0 || 1;
  $('rpScrub').value = Math.round(((RP.t - RP.t0) / span) * 1000);

  RP.wx = wxAt(RP.runner.weather, RP.t);
  RP.st = stability(RP.wx?.soil_temp, RP.wx?.temp);

  const laying = RP.t <= RP.runner.ended;
  const working = RP.dog && RP.t >= RP.dog.started;
  $('rpStage').textContent = laying ? 'Runner laying' : working ? 'Dog working' : 'Trail ageing';
  $('rpClock').textContent = new Date(RP.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  $('rpElapsed').textContent = fmtDur(RP.t - RP.t0);

  RP.lastAdv = 0; RP.lastDraw = 0;

  /* Draw the readouts here as well as in the animation loop.

     They used to update only inside requestAnimationFrame, which meant they
     went blank whenever rAF was suspended — a backgrounded tab, a locked phone,
     Low Power Mode. Scrubbing still worked, so you got a moving trail beside an
     empty instrument strip. During playback the loop throttles this instead, so
     it does not run twice a frame. */
  if (!RP.playing) { drawReplayTracks(); updateReplayPanels(); }
}

function replayFrame(now) {
  if (!RP.on) return;

  if (RP.playing) {
    const dt = RP.lastFrame ? (now - RP.lastFrame) : 16;
    RP.t += dt * RP_SPEED;
    if (RP.t >= RP.t1) { RP.t = RP.t1; setPlayingRP(false); }
    setReplayTime(RP.t);
  }
  RP.lastFrame = now;

  // Advection is the expensive part, so it runs at ~8 Hz while the projection
  // and the drawing run every frame. On a phone that is the difference between
  // 60 fps and a slideshow.
  if (!RP.lastAdv || now - RP.lastAdv > 120) {
    RP.sim.advance(RP.T, RP.wx, RP.st, RP.t);
    RP.lastAdv = now;
    windFx?.setField(fieldFor(RP.T, RP.wx, RP.st));
  }
  RP.scentFx.render(RP.sim.parts, RP.st?.mix ?? 1);

  if (!RP.lastDraw || now - RP.lastDraw > 200) {
    drawReplayTracks();
    updateReplayPanels();
    // Conditions drift over a session, so a layer can stop being a factor part
    // way through. Only redraw the list when that actually changes.
    const sig = JSON.stringify(layerAvailability(RP.T, RP.wx, RP.st));
    if (sig !== RP.availSig) { RP.availSig = sig; renderLayerButtons(); }

    /* Repaint the ground layer only when the conditions actually moved. Pooling
       costs four flowAt calls per pixel, so redrawing it on every frame would be
       roughly a million flow evaluations a second — fine on a laptop, fatal on a
       phone. A coarse signature is enough: conditions drift over minutes. */
    if (RP.layer !== 'none') {
      const lsig = [RP.layer,
        Math.round((RP.wx?.wind_direction ?? 0) / 8),
        Math.round((RP.wx?.wind_speed ?? 0) * 2),
        Math.round((RP.st?.dT ?? 0) * 2),
        Math.round(RP.t / 9e5)].join(',');
      if (lsig !== RP.layerSig) {
        RP.layerSig = lsig;
        setLayerImage(paintLayer(RP.layer, RP.T, RP.wx, RP.st, RP.t));
      }
    }
    RP.lastDraw = now;
  }
  RP.raf = requestAnimationFrame(replayFrame);
}

function drawReplayTracks() {
  const laid = RP.runner.points.filter(p => p.t <= RP.t);
  setSrc('runner', lineOf(laid));
  const worked = RP.dog ? RP.dog.points.filter(p => p.t <= RP.t) : [];
  setSrc('dog', lineOf(worked));
  setSrc('wps', {
    type: 'FeatureCollection',
    features: [...(RP.runner.waypoints || []), ...(RP.dog?.waypoints || [])]
      .filter(w => w.t <= RP.t)
      .map(w => ({ type: 'Feature', properties: { kind: w.kind },
                   geometry: { type: 'Point', coordinates: [w.lon, w.lat] } })),
  });
}

function setPlayingRP(v) {
  RP.playing = v;
  RP.lastFrame = 0;
  $('rpPlay').innerHTML = v ? '❚❚' : '▶';
  $('rpPlay').setAttribute('aria-label', v ? 'Pause' : 'Play');
}

/* ── Replay panels ────────────────────────────────────────────────── */

const LAYERS = [
  { key: 'pool',    name: 'Pooling',      swatch: '#3a84e2', tag: 'new' },
  { key: 'sun',     name: 'Sun & shade',  swatch: '#e8b84c', tag: 'new' },
  { key: 'shelter', name: 'Shelter',      swatch: '#8b7fd4' },
  { key: 'slope',   name: 'Slope',        swatch: '#7d8590' },
];

function renderLayerButtons() {
  const avail = layerAvailability(RP.T, RP.wx, RP.st);
  $('rpLayers').innerHTML = LAYERS.map(l => {
    const a = avail[l.key];
    return `<button class="rp-layer${a.ok ? '' : ' off'}" data-layer="${l.key}"
              aria-pressed="${String(RP.layer === l.key)}" ${a.ok ? '' : 'disabled'}>
        <span class="sw" style="background:${l.swatch};color:${l.swatch}"></span>${l.name}
        ${a.ok ? (l.tag ? '<span class="tag">new</span>' : '') : `<span class="why">${a.why}</span>`}
      </button>`;
  }).join('');
}

function setLayerImage(url) {
  const id = 'groundlayer';
  if (!url) {
    if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(id)) map.removeSource(id);
    return;
  }
  const b = RP.T.bbox;
  const coords = [[b.west, b.north], [b.east, b.north], [b.east, b.south], [b.west, b.south]];
  if (map.getSource(id)) {
    map.getSource(id).updateImage({ url, coordinates: coords });
  } else {
    map.addSource(id, { type: 'image', url, coordinates: coords });
    map.addLayer({ id, type: 'raster', source: id,
                   paint: { 'raster-opacity': 0.62, 'raster-fade-duration': 120 } },
                 map.getLayer('runner-line') ? 'runner-line' : undefined);
  }
}

function chooseLayer(key) {
  RP.layer = RP.layer === key ? 'none' : key;
  RP.layerSig = null;                       // force one repaint on the switch
  renderLayerButtons();
  setLayerImage(RP.layer === 'none' ? null : paintLayer(RP.layer, RP.T, RP.wx, RP.st, RP.t));
}

function updateReplayPanels() {
  const wx = RP.wx, st = RP.st;
  const reg = regime(RP.T, RP.runner.points, wx, st);
  const life = scentLife(wx, st);

  const cell = (k, v, u = '') => `<div class="rp-cell"><i>${k}</i><b>${v}${u ? `<s>${u}</s>` : ''}</b></div>`;
  const n = (v, dp = 1) => v == null ? '—' : Number(v).toFixed(dp);

  $('rpInst').innerHTML =
    cell('air', n(wx?.temp), '°C') +
    cell('ground', n(wx?.soil_temp), '°C') +
    cell('humidity', n(wx?.humidity, 0), '%') +
    cell('wind', n(wx?.wind_speed), 'm/s') +
    cell('from', wx?.wind_direction == null ? '—' : cardinal(wx.wind_direction)) +
    cell('rain', n(wx?.precipitation, 1), 'mm') +
    cell('scent life', Math.round(life), 'min');

  /* Rain is the counterintuitive one, and it was driving scent life invisibly.
     Light rain HELPS — it re-wets the surface and refreshes scent — while heavy
     rain washes it away. A handler who cancels a session because it is drizzling
     is cancelling the best conditions of the week. */
  const rain = wx?.precipitation ?? 0;
  const rainNote = rain <= 0 ? ''
    : rain < 0.6
      ? ` <b class="good">Light rain is refreshing the surface</b> — scent is better than it looks.`
      : ` <b class="bad">Heavy rain is washing scent off the ground.</b>`;

  $('rpRegime').innerHTML =
    `<b class="${reg.key}">${st.label}</b> · scent moves <b>${reg.word}</b>
     <p>${st.plain}${rainNote}</p>`;

  // Verdict — only once the dog has actually worked enough of it to grade.
  const worked = RP.dog ? RP.dog.points.filter(p => p.t <= RP.t) : [];
  /* .off (not [hidden]) so the card can rise in — the moment the dog has
     worked enough trail to grade is the payoff of the whole session. */
  if (worked.length < 6) { $('rpVerdict').classList.add('off'); return; }
  const wasOff = $('rpVerdict').classList.contains('off');
  $('rpVerdict').hidden = false;
  if (wasOff) requestAnimationFrame(() => $('rpVerdict').classList.remove('off'));
  else $('rpVerdict').classList.remove('off');

  const obs = meanOffset(RP.runner.points, worked);
  if (!RP.predicted || RP.predictedAt !== RP.layer + worked.length) {
    RP.predicted = predictedOffsets(RP.T, RP.runner.points, wx, st, RP.t);
    RP.predictedAt = RP.layer + worked.length;
  }
  const pred = RP.predicted.length
    ? RP.predicted.reduce((a, p) => a + p.metres, 0) / RP.predicted.length : 0;
  const err = obs - pred;

  $('rpVerdict').innerHTML = `
    <i>Verdict</i>
    <div class="rp-big"><b>${obs.toFixed(1)}</b><span>m mean offset</span></div>
    <p>Model predicted <b>${pred.toFixed(1)} m</b> ${reg.word}. Dog held
      <b>${obs.toFixed(1)} m</b> —
      ${Math.abs(err) < 1.5 ? 'within tolerance.'
        : err > 0 ? `model <b>under-predicted by ${err.toFixed(1)} m</b>.`
                  : `model <b>over-predicted by ${(-err).toFixed(1)} m</b>.`}</p>
    <p class="rp-note">Every constant in this model is a literature guess until
      your own trails correct it. The dog's position is taken from the handler's
      phone, so it carries the length of the line as error.</p>`;
}

/* ── Bottom sheet ─────────────────────────────────────────────────── */

/* The sheet takes half a phone screen, which is the wrong half when you are
   standing in a field trying to see where the trail goes — and it is worse in
   draw mode, where the thing it covers is the map you are tapping. So it drops
   away and leaves its handle behind. The choice is remembered. */
function setSheetDown(down, which) {
  const sheet = $(which === 'draw' ? 'drawSheet' : 'sheetRecord');
  const btn = $(which === 'draw' ? 'drawToggle' : 'sheetToggle');
  const lbl = $(which === 'draw' ? 'drawLabel' : 'sheetLabel');

  sheet.classList.toggle('down', down);
  btn.setAttribute('aria-expanded', String(!down));

  if (which === 'draw' && down) {
    // Collapsed while drawing, the handle is the only status left — so it
    // carries the count rather than a label nobody needs to read twice.
    const n = draw.pts.length;
    lbl.textContent = n ? `${n} corner${n === 1 ? '' : 's'} · tap the map` : 'Tap the map';
  } else {
    lbl.textContent = down ? 'Show controls' : 'Hide controls';
  }

  if (which !== 'draw') { settings.sheetDown = down; save(S.settings, settings); }
}
const sheetIsDown = (which) =>
  $(which === 'draw' ? 'drawSheet' : 'sheetRecord').classList.contains('down');

/* ── Dragging the sheet ───────────────────────────────────────────────

   The tap toggle stays, but a drawer on a touch screen should be a thing you
   hold: 1:1 under the finger from wherever it was grabbed, rubber-banding past
   its ends, and — on release — handing the finger's velocity to a spring that
   projects where the gesture was GOING. A flick commits even when the sheet
   has barely moved. Grabbing it mid-flight catches it exactly where it is.

   The physics lives in gesture.js and is tested in Node; this is only the
   pointer wiring. */
function makeSheetDraggable(which) {
  const sheet = $(which === 'draw' ? 'drawSheet' : 'sheetRecord');
  const handle = $(which === 'draw' ? 'drawToggle' : 'sheetToggle');
  const spring = new Spring();
  let raf = 0, drag = null, moved = false;

  const downY = () =>
    Math.max(1, sheet.getBoundingClientRect().height -
      (parseFloat(getComputedStyle(sheet).getPropertyValue('--peek')) || 44));

  const currentY = () => {
    if (raf) return spring.x;                       // mid-flight — grab it where it is
    return sheetIsDown(which) ? downY() : 0;
  };

  const paint = (y) => { sheet.style.transform = `translateY(${y}px)`; };

  const stopSpring = () => { cancelAnimationFrame(raf); raf = 0; };

  function settle(target, velocity) {
    const D = downY();
    // Bounce is earned by momentum: a flick gets the drawer tuning, a plain
    // release settles critically damped. (Apple: drawer 0.8 / 0.3.)
    const flicked = Math.abs(velocity) > 300;
    const s = new Spring(flicked ? { dampingRatio: 0.8, response: 0.3 }
                                 : { dampingRatio: 1, response: 0.32 });
    s.x = spring.x; s.v = velocity; s.target = target;
    spring.k = s.k; spring.c = s.c; spring.v = s.v; spring.target = target;

    // A hidden tab has no frames to animate with — snap, honestly.
    if (document.visibilityState === 'hidden' ||
        matchMedia('(prefers-reduced-motion: reduce)').matches) {
      finish(target); return;
    }

    let last = performance.now();
    const tick = (now) => {
      spring.step((now - last) / 1000); last = now;
      if (spring.done) { finish(target); return; }
      paint(spring.x);
      raf = requestAnimationFrame(tick);
    };
    stopSpring();
    raf = requestAnimationFrame(tick);
  }

  function finish(target) {
    stopSpring();
    spring.x = target;
    // Hand the transform back to the CSS state without a flicker: the class is
    // set while .dragging (transition: none) still holds, then both clear.
    sheet.classList.add('dragging');
    setSheetDown(target !== 0, which);
    sheet.style.transform = '';
    requestAnimationFrame(() => sheet.classList.remove('dragging'));
  }

  handle.addEventListener('pointerdown', (e) => {
    if (e.button) return;
    const y0 = currentY();
    stopSpring();
    spring.x = y0;
    drag = { id: e.pointerId, startPointer: e.clientY, startSheet: y0, samples: [] };
    moved = false;
    sheet.classList.add('dragging');
    paint(y0);
    // Last, and guarded: capture can throw on a pointer the browser has lost
    // track of, and nothing above should die with it. Without capture the drag
    // still works — it just ends if the finger leaves the handle.
    try { handle.setPointerCapture(e.pointerId); } catch { /* degrade gracefully */ }
  });

  handle.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const delta = e.clientY - drag.startPointer;
    if (!moved && Math.abs(delta) < 10) return;      // hysteresis — taps stay taps
    moved = true;

    const D = downY();
    let y = drag.startSheet + delta;
    // Past either end the sheet resists instead of stopping dead.
    if (y < 0) y = rubberband(y, D);
    else if (y > D) y = D + rubberband(y - D, D);

    spring.x = y;
    drag.samples.push({ t: e.timeStamp, y: e.clientY });
    if (drag.samples.length > 8) drag.samples.shift();
    paint(y);
  });

  const release = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const D = downY();
    if (!moved) {
      // A clean tap: let the click handler do its job, undo our takeover.
      sheet.classList.remove('dragging');
      sheet.style.transform = '';
      drag = null;
      return;
    }
    const v = velocityFrom(drag.samples);
    drag = null;
    settle(chooseTarget(spring.x, v, [0, D]), v);
  };
  handle.addEventListener('pointerup', release);
  handle.addEventListener('pointercancel', release);

  // A drag is not a tap: swallow the click the browser fires after pointerup.
  handle.addEventListener('click', (e) => {
    if (moved) { e.stopImmediatePropagation(); e.preventDefault(); moved = false; }
  }, true);
}

/* ── Draw a trail ─────────────────────────────────────────────────── */

/* Most trails are laid by somebody with no phone running, and an instructor
   setting one for a student wants to plan it before walking it. A drawn line is
   missing the two things a walked track carries for free — density and a clock —
   so densify() fills it in and timestamps() paces it. Scent age is what the
   whole model runs on, so without the clock a drawn trail would be useless. */
const draw = { on: false, pts: [], wx: null, wxFor: '' };

/* Weather for the trail being DESIGNED — at its laid-at time (which may be in
   the future: Open-Meteo's series covers the forecast, so a trail sketched
   tonight for dawn is graded on dawn's wind). Keyed on place + quarter-hour so
   tapping corners never refetches; changing the laid-at time does. */
function ensureDrawWx() {
  const p = draw.pts[0];
  if (!p) return;
  const when = new Date($('drawWhen').value).getTime() || Date.now();
  const key = `${p.lat.toFixed(3)},${p.lon.toFixed(3)}|${Math.round(when / 900000)}`;
  if (key === draw.wxFor) return;
  draw.wxFor = key;
  draw.wx = null; draw.wxFail = false;
  updateDraw();
  fetchWeather(p.lat, p.lon, when)
    .then(wx => { if (draw.on && draw.wxFor === key) { draw.wx = wx; updateDraw(); } })
    .catch(() => {
      if (draw.on && draw.wxFor === key) {
        // Failure must not be cached like success, or one dropped request
        // leaves the whole draw session ungraded: the next tap retries.
        draw.wxFor = '';
        draw.wxFail = true;
        updateDraw();
      }
    });
}

function openDraw() {
  draw.on = true; draw.pts = []; draw.wx = null; draw.wxFor = ''; draw.wxFail = false;
  // A plume previewing some OTHER trail must not haunt the one being drawn.
  if (LIVE.on && LIVE.preview) stopLive();
  $('sheetRecord').hidden = true;
  $('drawSheet').hidden = false;

  // Default to 90 minutes ago: an ordinary amount of ageing, and it means the
  // weather lookup lands on real observations rather than a forecast.
  const d = new Date(Date.now() - 90 * 60000);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  $('drawWhen').value = d.toISOString().slice(0, 16);

  for (const id of ['runner', 'dog', 'drift', 'wps']) setSrc(id, EMPTY);
  map.getCanvas().style.cursor = 'crosshair';
  map.on('click', onDrawClick);
  updateDraw();
}

function closeDraw() {
  draw.on = false;
  map.off('click', onDrawClick);
  map.getCanvas().style.cursor = '';
  if (LIVE.on && LIVE.preview) stopLive();   // the unsaved line's plume goes with it
  setSrc('design', EMPTY);
  setSrc('drift', EMPTY);
  $('drawSheet').hidden = true;
  $('sheetRecord').hidden = false;
}

function onDrawClick(e) {
  if (!draw.on) return;
  const p = { lat: e.lngLat.lat, lon: e.lngLat.lng };
  /* A stray tap on a zoomed-out map would densify a 100 km "leg" into tens of
     thousands of points, synchronously, on every later tap. No real trail leg
     is 5 km between corners — refuse it as the misclick it is. */
  const prev = draw.pts[draw.pts.length - 1];
  if (prev) {
    const d = dist(prev, p);
    if (d > 5000) return toast(`That corner is ${(d / 1000).toFixed(1)} km away — zoom in`);
  }
  draw.pts.push(p);
  navigator.vibrate?.(15);
  updateDraw();
  ensureDrawWx();          // first tap fixes the place; later taps hit the cache
}

function updateDraw() {
  const pace = Number($('drawPace').value) || 1.3;
  const len = pathLen(draw.pts);
  $('drawPts').textContent = draw.pts.length;
  $('drawLen').textContent = Math.round(len);
  $('drawDur').textContent = fmtDur((len / Math.max(0.2, pace)) * 1000);
  $('drawPaceVal').textContent = pace.toFixed(1);
  $('drawSave').disabled = draw.pts.length < 2;
  $('drawHint').textContent = draw.pts.length === 0
    ? 'Tap the map at each corner of the line that was walked.'
    : draw.pts.length === 1
      ? 'Now tap where it went next.'
      : 'Keep tapping, or save. Undo removes the last corner.';

  // Collapsed, the handle is the only readout left — keep the count on it.
  if (sheetIsDown('draw')) setSheetDown(true, 'draw');

  setSrc('runner', lineOf(draw.pts));
  setSrc('wps', {
    type: 'FeatureCollection',
    features: draw.pts.map((p, i) => ({
      type: 'Feature', properties: { kind: String(i + 1) },
      geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
    })),
  });
  paintDesign();
}

/* The living plume for the line being DRAWN. The first two corners start the
   full particle sim (weather + terrain fetched once for this draw session);
   every corner, undo, pace or laid-at change after that just re-seeds the
   existing sim — the particles' state is a pure function of the points' ages,
   so a re-seed lands mid-development instead of restarting the plume. */
let drawPlumeStarting = false;
async function syncDrawPlume(points) {
  if (!settings.liveScent || rec.on) return;
  if (!LIVE.on) {
    if (drawPlumeStarting) return;
    drawPlumeStarting = true;
    try { await startLive({ trail: points, origin: points[0] }); }
    finally { drawPlumeStarting = false; }
    return;
  }
  if (LIVE.preview && LIVE.sim && draw.on) LIVE.sim.seed(points);
}

/* The instructor's read, live while the line is still being tapped: each leg
   coloured by what the wind at the LAID time makes of it, the plume the dog
   would meet, objective chips the design earns, and the one weakest aspect.
   No weather yet (or none available) says so — an unlabelled line is honest,
   a guessed label is not. */
function paintDesign() {
  const readEl = $('drawRead');
  if (draw.pts.length < 2) {
    setSrc('design', EMPTY); setSrc('drift', EMPTY);
    if (LIVE.on && LIVE.preview) stopLive();     // undone back below a line
    readEl.hidden = true;
    return;
  }
  readEl.hidden = false;

  if (!draw.wx) {
    setSrc('design', EMPTY); setSrc('drift', EMPTY);
    $('drawChips').innerHTML = '';
    $('drawAdvice').textContent = draw.wxFail
      ? 'No weather available — legs stay unlabelled rather than guessed.'
      : 'Reading the wind at that time…';
    return;
  }

  const pace = Number($('drawPace').value) || 1.3;
  const when = new Date($('drawWhen').value).getTime() || Date.now();
  const points = timestamps(densify(draw.pts, 5), when, pace);
  /* An aged trail is graded as worked now; a future-dated plan as worked right
     after laying — the earliest honest assumption for a plan. */
  const worked = when < Date.now() ? Date.now() : undefined;
  const field = scentField(points, draw.wx, worked);
  setSrc('drift', plumePolygon(field));
  syncDrawPlume(points);

  const st = stability(draw.wx.soil_temp, draw.wx.temp);
  const metresOf = (leg) => pathLen(points.slice(leg.i0, leg.i1 + 1));
  const d = analyseDesign(field, draw.wx, st, metresOf);

  setSrc('design', {
    type: 'FeatureCollection',
    features: d.legs.map(l => ({
      type: 'Feature', properties: { k: l.label },
      geometry: { type: 'LineString',
        coordinates: points.slice(l.i0, l.i1 + 1).map(p => [p.lon, p.lat]) },
    })),
  });

  $('drawChips').innerHTML = d.chips.map(c => `<span class="pill">${esc(c)}</span>`).join('');
  const src = when > Date.now() ? 'forecast' : 'recorded';
  // A laid-at beyond the weather window would otherwise be graded on the
  // nearest day's samples and presented as truth. Say what actually happened.
  const gapNote = (draw.wx.gap ?? 0) > 2 * 3600e3
    ? ` <b>Weather data ends ${Math.round(draw.wx.gap / 3600e3)} h short of that time</b> — nearest sample used.`
    : '';
  $('drawAdvice').innerHTML =
    (d.advice ? `${esc(d.advice)}<br>` : '') +
    `<b>${(draw.wx.wind_speed ?? 0).toFixed(1)} m/s</b> from ${cardinal(draw.wx.wind_direction ?? 0)} at laid time (${src}).${gapNote}`;
}

async function saveDraw() {
  if (saveDraw.busy) return;               // the weather await leaves the button live
  if (draw.pts.length < 2) return toast('Tap at least two corners');
  saveDraw.busy = true;
  $('drawSave').disabled = true;
  try {
    await saveDrawInner();
  } finally {
    saveDraw.busy = false;
    $('drawSave').disabled = false;
  }
}

async function saveDrawInner() {
  const pace = Number($('drawPace').value) || 1.3;
  const whenVal = $('drawWhen').value;
  const when = whenVal ? new Date(whenVal).getTime() : Date.now() - 90 * 60000;
  if (!Number.isFinite(when)) return toast('That laid-at time is not valid');

  // Fill the corners in to walked-track density, then pace a clock along it.
  const points = timestamps(densify(draw.pts, 5), when, pace);

  const s = {
    id: `s${Date.now()}`, mode: 'runner', dog: '—', drawn: true,
    started: points[0].t, ended: points[points.length - 1].t,
    points, waypoints: [], linkTo: null, weather: null,
  };

  // The design pass already fetched this exact place-and-time — reuse it.
  if (draw.wx) s.weather = draw.wx;
  else {
    try {
      s.weather = await fetchWeather(points[0].lat, points[0].lon, s.started);
    } catch {
      toast('Saved — weather unavailable offline');
    }
  }

  sessions.unshift(s); save(S.sessions, sessions);
  closeDraw();
  renderSessions();
  openDetail(s.id);
  toast(`Trail drawn — ${Math.round(pathLen(points))} m`);
}

/* ── Team ─────────────────────────────────────────────────────────── */

/* Photos live in localStorage next to everything else, so they are cropped
   square and downscaled hard before storing — an avatar needs 320px, not a
   12-megapixel original that would blow the 5MB quota on its own. */
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
        (img.width - side) / 2, (img.height - side) / 2, side, side,
        0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      cb(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(img.src); toast('Could not read that photo'); };
    img.src = URL.createObjectURL(f);
  };
  inp.click();
}

const fmtKm = (m) => m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`;

function renderTeam() {
  const body = $('teamBody');
  $('btnEditTeam').hidden = !team.handler;
  if (!team.handler) {
    body.innerHTML = `<p class="empty">Nobody registered yet.</p>
      <button class="record" id="btnSetupNow">Register handler &amp; dogs</button>`;
    return;
  }
  const hs = handlerStats(sessions);
  body.innerHTML = `
    <div class="team-card">
      ${avatarHtml(team.handler, 'big')}
      <div class="who">
        <h3>${esc(team.handler.name)}</h3>
        <div class="lvl">Handler</div>
        <div class="card-meta">
          <span class="pill runner">${hs.laid} laid</span>
          ${hs.drawn ? `<span class="pill">${hs.drawn} drawn</span>` : ''}
          <span class="pill">${fmtKm(hs.meters)}</span>
        </div>
      </div>
    </div>

    <h2 class="sec">Dogs</h2>
    ${team.dogs.map(d => {
      const st = dogStats(sessions, d.id);
      return `<div class="team-card" data-dogtrails="${d.id}" role="button" tabindex="0">
        ${avatarHtml(d, 'big')}
        <div class="who">
          <h3>${esc(d.name)}</h3>
          <div class="lvl">${levelLabel(d.level)}</div>
          <div class="card-meta">
            <span class="pill dog">${st.trails} trail${st.trails === 1 ? '' : 's'}</span>
            ${['hot', 'warm', 'cold'].map(k =>
              st[k] ? `<span class="pill klass ${k}">${st[k]} ${k}</span>` : '').join('')}
            ${st.meters ? `<span class="pill">${fmtKm(st.meters)}</span>` : ''}
          </div>
        </div>
      </div>`;
    }).join('')}
    <p class="hint">Hot inside 30 min of laying, warm to 3 h, cold beyond —
      classed from each trail's real timestamps, not self-reported. Tap a dog
      for its trails.</p>`;
}

/* The editor works on a copy, so Cancel costs nothing. */
let setup = null;

function paintHandlerAvatar() {
  const a = $('handlerAvatar'), h = setup.handler;
  a.classList.toggle('has-photo', !!h.photo);
  a.style.backgroundImage = h.photo ? `url(${h.photo})` : '';
  a.textContent = (h.name || '?').trim().charAt(0).toUpperCase() || '?';
}

function renderDogRows() {
  $('dogRows').innerHTML = setup.dogs.map((d, i) => `
    <div class="dog-row">
      <button class="avatar-btn" data-dogphoto="${i}" aria-label="Photo of ${esc(d.name || 'dog')}">
        ${avatarHtml(d)}
      </button>
      <input type="text" placeholder="Dog's name" value="${esc(d.name)}" data-dogname="${i}">
      <select data-doglevel="${i}" aria-label="Level">
        ${LEVELS.map(l => `<option value="${l.id}"${d.level === l.id ? ' selected' : ''}>${l.label}</option>`).join('')}
      </select>
      <button class="x" data-dogdel="${i}" aria-label="Remove dog">×</button>
    </div>`).join('');
}

function openSetup(first = false) {
  setup = {
    handler: { name: team.handler?.name || '', photo: team.handler?.photo || null },
    dogs: team.dogs.length
      ? team.dogs.map(d => ({ ...d }))
      // Seed from the old single dog-name setting, so nothing typed is retyped.
      : [{ id: `d${Date.now()}`, name: settings.dogName || '', level: 'novice', photo: null }],
  };
  $('setupTitle').textContent = first ? 'Welcome — your team' : 'Edit team';
  $('setupSkip').textContent = first ? 'Later' : 'Cancel';
  $('handlerName').value = setup.handler.name;
  paintHandlerAvatar();
  renderDogRows();
  show('viewSetup');
}

function saveSetup() {
  const name = setup.handler.name.trim();
  if (!name) return toast('The handler needs a name');
  const dogs = setup.dogs.map(d => ({ ...d, name: d.name.trim() })).filter(d => d.name);
  if (!dogs.length) return toast('Register at least one dog');

  team = {
    handler: { name, photo: setup.handler.photo }, dogs,
    lastDog: dogs.some(d => d.id === team.lastDog) ? team.lastDog : dogs[0].id,
  };
  try { save(S.team, team); }
  catch { return toast('Photos too big to store — pick smaller ones'); }

  // Sessions recorded before the team existed: adopt them by dog name.
  const adopted = attributeByName(sessions, dogs);
  if (adopted) save(S.sessions, sessions);

  setup = null;
  refreshDogPicker();
  renderTeam(); show('viewTeam'); tabTo('team');
  toast(adopted ? `Team saved — ${adopted} past trail${adopted === 1 ? '' : 's'} attributed` : 'Team saved');
}

/* Which dog is on the line. Hidden below two dogs — a choice of one is noise. */
function refreshDogPicker() {
  const showIt = rec.mode === 'dog' && team.dogs.length >= 2;
  $('dogPicker').hidden = !showIt;
  if (!showIt) return;
  const sel = activeDog()?.id;
  $('dogChips').innerHTML = team.dogs.map(d =>
    `<button class="dog-chip" data-pickdog="${d.id}" aria-pressed="${d.id === sel}">
      ${avatarHtml(d, 'mini')}${esc(d.name)}
    </button>`).join('');
}

const tabTo = (view) => document.querySelectorAll('.tabs button').forEach(x =>
  x.classList.toggle('active', x.dataset.view === view));

/* ── Trail Cards ──────────────────────────────────────────────────── */

/** Show a trail as a QR the next phone can scan. */
async function openCard(id) {
  const s = byId(id); if (!s) return;
  let card;
  const info = {};
  try {
    card = await encodeTrail({
      points: s.points, waypoints: s.waypoints, drawn: !!s.drawn,
      from: team.handler?.name || '',
    }, info);
  } catch (err) {
    return toast(err.message);
  }
  const qr = window.qrcode?.(0, 'M');
  if (!qr) return toast('QR library missing — hard refresh the app');
  qr.addData(card, 'Byte');
  qr.make();
  $('cardQr').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  const laid = new Date(s.started).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  // The caveats quote what the encoder actually did, not a guess.
  $('cardMeta').textContent =
    `${Math.round(pathLen(s.points))} m · laid ${laid}` +
    (team.handler?.name ? ` · from ${team.handler.name}` : '') +
    (info.tol ? ` · line thinned to fit the code (within ~${info.tol} m)` : '') +
    (info.wpsKept < info.wpsTotal ? ` · last ${info.wpsKept} of ${info.wpsTotal} marks fit` : '');
  show('cardModal');
}

/* Scanning runs the camera through the vendored decoder — never a network.
   An interval rather than rAF: iOS throttles rAF the moment the sheet or a
   permission prompt overlaps the page, and a scanner that silently stops
   scanning reads as broken.

   The generation counter is the cancellation story. getUserMedia can sit for
   seconds behind the iOS permission prompt; if the modal was closed (or scan
   restarted) in the meantime, the continuation must stop the stream it was
   just granted and walk away — otherwise the camera light stays on behind a
   hidden modal, silently importing any QR that passes the lens. */
const scan = { stream: null, tick: 0, gen: 0 };

function stopScan() {
  scan.gen++;                    // invalidate any in-flight openScan continuation
  clearInterval(scan.tick); scan.tick = 0;
  scan.stream?.getTracks().forEach(t => t.stop());
  scan.stream = null;
  const v = $('scanVideo');
  if (v) { v.srcObject = null; v.hidden = true; }
}

async function openScan() {
  show('scanModal');
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
  if (gen !== scan.gen || $('scanModal').hidden) {
    stream.getTracks().forEach(t => t.stop());
    return;
  }
  scan.stream = stream;
  const v = $('scanVideo');
  v.srcObject = stream; v.hidden = false;
  await v.play().catch(() => { /* autoplay policies — the frame grab still works */ });
  if (gen !== scan.gen) return;            // stopScan already released the tracks

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
      // Pause, don't tear down: a wrong QR (someone's Wi-Fi poster) must leave
      // the camera running so the right card can still be scanned.
      clearInterval(scan.tick); scan.tick = 0;
      const ok = await handleCard(hit.data);
      if (ok) return stopScan();
      if (gen === scan.gen && scan.stream && !$('scanModal').hidden) {
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

/** Import a scanned card. Returns true on success — the camera path uses this
    to decide between stopping and resuming the scan. */
async function handleCard(data) {
  let card;
  try { card = await decodeTrail(data); }
  catch (err) {
    $('scanState').textContent = `${err.message} Still scanning…`;
    toast(err.message);
    return false;
  }

  const s = {
    id: `s${Date.now()}`, mode: 'runner', dog: '—',
    drawn: !!card.drawn, approx: !!card.approx, tol: card.tol || 0,
    imported: { from: card.from || 'another phone', at: Date.now() },
    started: card.started, ended: card.ended,
    points: card.points, waypoints: card.waypoints, linkTo: null, weather: null,
  };
  sessions.unshift(s);
  try { save(S.sessions, sessions); }
  catch {
    sessions.shift();
    toast('Storage full — free space in Settings before importing');
    return false;
  }
  renderSessions();
  openDetail(s.id);
  toast(`Trail from ${s.imported.from} — ${Math.round(pathLen(s.points))} m`);

  // The card carries the REAL laid time, so fetch that moment's weather —
  // ageing, plume and hot/warm/cold all read true on the student's phone too.
  try {
    s.weather = await fetchWeather(s.points[0].lat, s.points[0].lon, s.started);
    save(S.sessions, sessions);
    // Refresh only if the user is still LOOKING at this trail — a slow fetch
    // must never yank them away from whatever they navigated to since.
    if (!$('viewDetail').hidden && detailId === s.id) openDetail(s.id);
  } catch { /* offline — weather joins when it can */ }
  return true;
}

/* ── Views ────────────────────────────────────────────────────────── */
function show(view) {
  stopScan();
  for (const v of ['viewSessions', 'viewDetail', 'viewSettings', 'viewTeam', 'viewSetup',
                   'cardModal', 'scanModal']) $(v).hidden = true;
  if (view) $(view).hidden = false;
}

function refreshTrailPicker() {
  const runners = sessions.filter(s => s.mode === 'runner').slice(0, 25);
  $('trailSelect').innerHTML = runners.length
    ? runners.map(s => `<option value="${s.id}">${new Date(s.started).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · ${Math.round(pathLen(s.points))}m</option>`).join('')
    : '<option value="">No runner trail recorded yet</option>';
  rec.linkTo = $('trailSelect').value || null;
}

/* ── Wiring ───────────────────────────────────────────────────────── */
function wire() {
  document.querySelectorAll('.mode').forEach(b => b.addEventListener('click', () => {
    rec.mode = b.dataset.mode;
    document.querySelectorAll('.mode').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    $('trailPicker').hidden = rec.mode !== 'dog';
    refreshDogPicker();
    if (rec.mode === 'dog') refreshTrailPicker();
    else stopAgeing();
    previewTrail();          // show the trail, and the plume already coming off it
  }));

  document.querySelectorAll('.chip[data-style]').forEach(b => b.addEventListener('click', () => {
    settings.basemap = b.dataset.style; save(S.settings, settings);
    document.querySelectorAll('.chip[data-style]').forEach(x =>
      x.setAttribute('aria-pressed', String(x === b)));
    mapReady = false;
    map.setStyle(STYLES[settings.basemap]);
    map.once('styledata', addOverlays);
  }));

  const wt = $('windToggle');
  wt.setAttribute('aria-pressed', String(!!settings.wind));
  wt.addEventListener('click', () => {
    settings.wind = !settings.wind; save(S.settings, settings);
    wt.setAttribute('aria-pressed', String(settings.wind));
    applyWind();
  });

  /* Live scent while recording. On by default, because it is the reason the
     app exists — but it runs a particle sim for the length of a session, so it
     stays a switch rather than something you cannot turn off. */
  const sc = $('scentToggle');
  sc.setAttribute('aria-pressed', String(settings.liveScent !== false));
  sc.addEventListener('click', () => {
    settings.liveScent = !settings.liveScent;
    save(S.settings, settings);
    sc.setAttribute('aria-pressed', String(settings.liveScent));
    if (!settings.liveScent) stopLive();
    else if (rec.on) startLive();
    toast(settings.liveScent ? 'Scent shown while recording' : 'Scent hidden');
  });

  $('trailSelect').addEventListener('change', e => {
    rec.linkTo = e.target.value || null;
    stopAgeing();
    previewTrail();
  });
  $('btnRecord').addEventListener('click', () => rec.on ? stopRec() : startRec());
  document.querySelectorAll('.wp').forEach(b => b.addEventListener('click', () => addWaypoint(b.dataset.wp)));

  document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('active', x === b));
    const v = b.dataset.view;
    if (v === 'map') show(null);
    if (v === 'sessions') { renderSessions(); show('viewSessions'); }
    if (v === 'team') { renderTeam(); show('viewTeam'); }
    if (v === 'settings') { fillSettings(); show('viewSettings'); }
  }));

  document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => {
    show(null);
    document.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('active', x.dataset.view === 'map'));
  }));

  /* Bottom sheets drop out of the way of the map — by tap or by hand. */
  $('sheetToggle').addEventListener('click', () => setSheetDown(!sheetIsDown(), 'record'));
  $('drawToggle').addEventListener('click', () => setSheetDown(!sheetIsDown('draw'), 'draw'));
  makeSheetDraggable('record');
  makeSheetDraggable('draw');

  /* Draw a trail. */
  $('btnDraw').addEventListener('click', openDraw);
  $('drawCancel').addEventListener('click', () => { closeDraw(); setSrc('runner', EMPTY); setSrc('wps', EMPTY); });
  $('drawUndo').addEventListener('click', () => { draw.pts.pop(); updateDraw(); });
  $('drawClear').addEventListener('click', () => { draw.pts = []; updateDraw(); });
  $('drawPace').addEventListener('input', updateDraw);
  $('drawWhen').addEventListener('input', () => { ensureDrawWx(); updateDraw(); });
  $('drawSave').addEventListener('click', saveDraw);

  /* Replay transport. One clock: the scrubber sets it, everything reads it. */
  $('rpPlay').addEventListener('click', () => {
    if (RP.t >= RP.t1) setReplayTime(RP.t0);
    setPlayingRP(!RP.playing);
  });
  $('rpScrub').addEventListener('input', (e) => {
    setPlayingRP(false);
    setReplayTime(RP.t0 + (Number(e.target.value) / 1000) * (RP.t1 - RP.t0));
  });
  $('rpClose').addEventListener('click', closeReplay);
  $('rpLayers').addEventListener('click', (e) => {
    const b = e.target.closest('[data-layer]');
    if (b && !b.disabled) chooseLayer(b.dataset.layer);
  });
  window.addEventListener('resize', () => RP.on && RP.scentFx?.resize());

  document.addEventListener('click', (e) => {
    /* Trail-class override. Tapping the computed class clears the override. */
    const kb = e.target.closest('[data-setklass]');
    if (kb) {
      const s = byId(kb.dataset.sid); if (!s) return;
      const k = kb.dataset.setklass;
      if (s.klass === k || s.klassManual === k) delete s.klassManual;
      else s.klassManual = k;
      save(S.sessions, sessions);
      return openDetail(s.id);
    }
    const fd = e.target.closest('[data-filterdog]');
    if (fd) { sessFilter = fd.dataset.filterdog || null; return renderSessions(); }
    const pd = e.target.closest('[data-pickdog]');
    if (pd) {
      team.lastDog = pd.dataset.pickdog;
      try { save(S.team, team); } catch { /* photos already stored; ignore */ }
      return refreshDogPicker();
    }
    const dt = e.target.closest('[data-dogtrails]');
    if (dt) {
      sessFilter = dt.dataset.dogtrails;
      renderSessions(); show('viewSessions'); return tabTo('sessions');
    }
    if (e.target.closest('#btnSetupNow')) return openSetup(false);
    const card = e.target.closest('[data-card]');
    if (card) return openCard(card.dataset.card);
    const work = e.target.closest('[data-work]');
    if (work) {
      let mins = Number(work.dataset.in);
      if (work.dataset.in === 'custom') {
        const v = prompt('Work the trail in how many minutes?', '90');
        if (v == null || v.trim() === '') return;
        mins = Number(v);
        if (!Number.isFinite(mins) || mins < 0) return toast('Minutes, as a number');
        mins = Math.min(mins, 24 * 60);        // past a day, just start a new trail
      }
      return armWork(work.dataset.work, mins);
    }
    const rp = e.target.closest('[data-replay]');
    if (rp) return openReplay(rp.dataset.replay);
    const open = e.target.closest('[data-open]');
    if (open) return openDetail(open.dataset.open);
    const gpx = e.target.closest('[data-gpx]');
    if (gpx) return downloadGPX(gpx.dataset.gpx);
    const del = e.target.closest('[data-del]');
    if (del && confirm('Delete this trail permanently?')) {
      sessions = sessions.filter(s => s.id !== del.dataset.del);
      save(S.sessions, sessions); renderSessions(); show('viewSessions');
    }
  });

  /* Team editor. */
  $('btnEditTeam').addEventListener('click', () => openSetup(false));
  $('handlerPhotoBtn').addEventListener('click', () =>
    pickPhoto(p => { setup.handler.photo = p; paintHandlerAvatar(); }));
  $('handlerName').addEventListener('input', (e) => {
    setup.handler.name = e.target.value; paintHandlerAvatar();
  });
  $('btnAddDog').addEventListener('click', () => {
    setup.dogs.push({ id: `d${Date.now()}_${setup.dogs.length}`, name: '', level: 'novice', photo: null });
    renderDogRows();
  });
  $('dogRows').addEventListener('input', (e) => {
    const { dogname, doglevel } = e.target.dataset;
    if (dogname != null) setup.dogs[dogname].name = e.target.value;
    if (doglevel != null) setup.dogs[doglevel].level = e.target.value;
  });
  $('dogRows').addEventListener('click', (e) => {
    const p = e.target.closest('[data-dogphoto]');
    if (p) return pickPhoto(ph => { setup.dogs[p.dataset.dogphoto].photo = ph; renderDogRows(); });
    const x = e.target.closest('[data-dogdel]');
    if (x) { setup.dogs.splice(Number(x.dataset.dogdel), 1); renderDogRows(); }
  });
  /* Trail Cards. */
  $('btnScanCard').addEventListener('click', openScan);
  $('scanFromPhoto').addEventListener('click', () => $('scanFile').click());
  $('scanFile').addEventListener('change', (e) => {
    scanPhoto(e.target.files?.[0]);
    e.target.value = '';       // else re-picking the same photo fires nothing
  });

  $('setupSave').addEventListener('click', saveSetup);
  $('setupSkip').addEventListener('click', () => {
    settings.teamSkipped = true; save(S.settings, settings);
    setup = null; show(null); tabTo('map');
  });

  const bind = (id, key, fmt) => {
    const el = $(id);
    el.addEventListener('input', () => {
      settings[key] = el.type === 'range' ? Number(el.value) : el.value;
      save(S.settings, settings);
      if (fmt) $(fmt).textContent = el.value;
      if (key === 'exagg' && mapReady) map.setTerrain({ source: 'dem', exaggeration: Number(el.value) });
      // A token pasted into Settings upgrades the map right now, not after a
      // reload nobody knows to do.
      if (key === 'mbToken' && el.value.startsWith('pk.') && el.value.length > 60) {
        mapboxgl.accessToken = el.value;
        mapReady = false;
        map.setStyle(STYLES[settings.basemap] || STYLES.satellite);
        map.once('styledata', addOverlays);
        toast('Satellite map on');
      }
    });
  };
  bind('accCap', 'accCap', 'accCapVal');
  bind('stillCap', 'stillCap', 'stillCapVal'); bind('exagg', 'exagg', 'exaggVal');
  bind('mbToken', 'mbToken');

  $('btnExportAll').addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(sessions, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = `trailcraft-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  $('btnWipe').addEventListener('click', () => {
    if (!confirm('Delete every trail on this device? This cannot be undone.')) return;
    sessions = []; save(S.sessions, sessions); renderSessions(); toast('All trails deleted');
  });
}

function fillSettings() {
  $('accCap').value = settings.accCap; $('accCapVal').textContent = settings.accCap;
  $('stillCap').value = settings.stillCap; $('stillCapVal').textContent = settings.stillCap;
  $('exagg').value = settings.exagg; $('exaggVal').textContent = settings.exagg;
  $('mbToken').value = settings.mbToken;
  document.querySelectorAll('.chip[data-style]').forEach(x =>
    x.setAttribute('aria-pressed', String(x.dataset.style === settings.basemap)));
  $('storageNote').textContent =
    `${sessions.length} trail${sessions.length === 1 ? '' : 's'} stored on this device only. · Build ${BUILD}`;
}

/* ?demo=1 — seed one realistic runner/dog pair with live weather, so the app
   can be shown without walking a field first. */
async function seedDemo() {
  const { buildDemo, dogTrail } = await import('./demo.js');
  const q = new URLSearchParams(location.search);
  const lat = parseFloat(q.get('lat')), lon = parseFloat(q.get('lon'));
  const opts = { totalM: Math.max(100, parseFloat(q.get('len')) || 800) };
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    opts.start = { lat, lon };
    opts.baseAlt = parseFloat(q.get('alt')) || 0;
  }
  const { laidAt, workedAt, runner } = buildDemo(Date.now(), opts);

  let wx = null;
  try { wx = await fetchWeather(runner[0].lat, runner[0].lon, laidAt); }
  catch { toast('Demo loaded — weather unavailable'); }

  const dog = dogTrail(runner, workedAt, wx?.wind_direction ?? 250);
  const at = (i) => {
    const j = Math.min(Math.max(0, i), dog.length - 1);
    return { lat: dog[j].lat, lon: dog[j].lon, t: dog[j].t };
  };
  const RID = 's_demo_runner', DID = 's_demo_dog';

  sessions = sessions.filter(s => !s.id.startsWith('s_demo'));
  const demoDog = activeDog();
  sessions.unshift(
    { id: DID, mode: 'dog', dog: demoDog?.name || settings.dogName || 'Nala',
      dogId: demoDog?.id || null, klass: trailClass(workedAt - laidAt),
      started: workedAt, ended: dog[dog.length - 1].t, points: dog, linkTo: RID, weather: wx,
      waypoints: [
        { kind: 'lost', ...at(Math.floor(dog.length * 0.55)) },
        { kind: 'refound', ...at(Math.floor(dog.length * 0.68)) },
        { kind: 'indication', ...at(dog.length - 1) },
      ] },
    { id: RID, mode: 'runner', dog: '—',
      started: laidAt, ended: runner[runner.length - 1].t, points: runner,
      waypoints: [], linkTo: null, weather: wx },
  );
  save(S.sessions, sessions);
  renderSessions();

  if (!mapReady) await new Promise(r => map.once('load', r));
  openDetail(DID);
}

/* An iOS home-screen app resumes from memory for days without ever reloading —
   the one path the network-first service worker cannot help. So on every
   resume, ask the server what the current build is; behind, reload — unless a
   recording, replay or half-drawn trail is live, in which case say so instead
   (reloading mid-trail would destroy the track, which outranks any update). */
async function checkForUpdate() {
  try {
    const r = await fetch('build.txt', { cache: 'no-store' });
    if (!r.ok) return;
    const remote = (await r.text()).trim();
    if (!remote || remote === BUILD) return;
    const busy = rec.on || RP.on || draw.on;
    // One attempt per build: if the reload did not move BUILD forward, looping
    // on it would brick the app on a mismatched deploy.
    const tried = sessionStorage.getItem('tc.updateTried');
    if (busy || tried === remote) return toast(`Update ${remote} ready — close and reopen the app`);
    sessionStorage.setItem('tc.updateTried', remote);
    /* On a CDN host the plain reload would re-serve the same stale files for
       up to its cache max-age and the loop guard would then give up. Prime the
       HTTP cache with forced fetches first, so the reload boots the update. */
    await Promise.all(['./', 'app.js', 'app.css', 'sw.js']
      .map(u => fetch(u, { cache: 'reload' }).catch(() => {})));
    location.reload();
  } catch { /* offline — nothing to compare against */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') checkForUpdate();
});

buildMap();
wire();
setSheetDown(!!settings.sheetDown, 'record');
renderSessions();
refreshDogPicker();
checkForUpdate();
/* First launch: register the team before anything else — skippable, because a
   registration wall standing between a handler and a field would be absurd. */
if (!team.handler && !settings.teamSkipped) openSetup(true);
if (new URLSearchParams(location.search).has('demo')) seedDemo();

if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* offline cache is a bonus */ });
}
