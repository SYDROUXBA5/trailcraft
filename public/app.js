/* Trailcraft — scent-work training record, paper edition.

   One person: the handler. A layer walks a trail or places a hide; the handler
   runs the dog and reads one honest sentence about what the dog did with the
   scent. The engine (geo/field/sim/card) is untouched; everything visible is
   this file. Map: Mapbox satellite + 3D with a token, MapLibre street map
   without. Weather: Open-Meteo, the one public API with soil temperature. */

import {
  pathLen, cardinal, dist, dwellFold, bearing, project, fmtDist, fmtShort, fmtSpeed, fmtTemp, unitShort, fmtWeight, kgToShown, shownToKg, fmtCoord, scentField, plumePolygon, densify, timestamps, signedOffsets, meanSigned, sideOfDrift, sideAgreement, lineCorrect, departure, timestampsEndingAt, progressAlong, splitLine, smoothBearing, medianAbs, sideShares,
} from './geo.js';
import { stepPoints } from './geo.js';
import { handlerStats } from './store.js';
import { plumePalette, stepPalette, windPalette, trackPalette, COLOUR_PRESETS, isHex, mix } from './colours.js';
import { FLAT, buildTerrain, stability, regime, flowAt, normOf } from './field.js';
import { predictedOffsets, ScentSim, driftFrom, stepByFlow } from './sim.js';
import { PARAMS, DIALS, PV, setParam, resetParams, changed, isDefault, tally, dialById } from './params.js';
import { encodeTrail, decodeTrail, cardUrl, cardFromText } from './card.js';
import { decodeTile, tileOf, tileBox } from './mvt.js';
import { GROUND_LAYERS, buildGround, surfaceAt, surfaceAlong, surfaceRows, withSpread,
         tilesCovering, spreadOf } from './ground.js';
import { sync, onSync, initSync, signInWithGoogle, signInWithApple, signOut,
         startLive, pushLive, endLive, watchLive } from './sync.js';
import { trailModel, encodeShared, decodeShared, sharedUrl, toGpx, fileBase,
         detailSections, headline, notes, liveMeta, liveModel } from './share.js';
import { buildPdf, jpegSize } from './pdf.js';
import { coachStep, initialCoach, coachPhrase, coachLine, TOL_OPTIONS, COACH_DEFAULTS } from './coach.js';
import { isNative, watchBackground, canHaptic, haptic, watchHeading } from './native.js';
import { createStore, migrateV1, TARGETS, ODOURS, targetById, targetText, verbs, uid,
         dogStats, ageBand, AGE_BANDS, LEVELS, levelById, dogAge } from './store.js';

/* The stamp a phone cannot lie about. Bump with every change. */
const BUILD = '2026-09-21d';

/* ── Settings & store ─────────────────────────────────────────────── */
const DEFAULTS = { ...COACH_DEFAULTS, accCap: 25, stillCap: 2.5, exagg: 2.4, plume: true,
  distUnits: 'metric', tempUnits: 'c', coordFormat: 'dd', theme: 'system', mapStyle: 'satellite', plumeColor: '#F5D14A', stepColor: '#0B1630', windColor: '#DCE9FF', dogColor: '#FFFFFF', trailStyle: 'steps', dogStyle: 'line', mbToken: (window.MB_TOKEN || '') };
const loadJson = (k, f) => { try { return JSON.parse(localStorage.getItem(k)) ?? f; } catch { return f; } };
let settings = { ...DEFAULTS, ...loadJson('tc.settings', {}) };
/* One "imperial" switch became three separate choices. A phone that already
   chose imperial keeps both halves of what that meant — feet and miles AND
   Fahrenheit — rather than waking up half-converted. */
{
  const raw = loadJson('tc.settings', {});
  if (raw.distUnits == null && typeof raw.imperial === 'boolean') {
    settings.distUnits = raw.imperial ? 'imperial' : 'metric';
    settings.tempUnits = raw.imperial ? 'f' : 'c';
  }
  delete settings.imperial;
}
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
/* One place asks which units, so nothing on screen can disagree with
   anything else on screen. The model never sees these. */
const imp = () => settings.distUnits === 'imperial';
const fahr = () => settings.tempUnits === 'f';
/** A place, in whichever form the handler reads and passes on. */
const fmtPlace = (lat, lon) => fmtCoord(lat, lon, settings.coordFormat);
const fmtKm = (m) => fmtDist(m, imp());
const fmtM = (m, dp = 0) => fmtShort(m, imp(), dp);
const fmtWind = (ms) => fmtSpeed(ms, imp());
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
const SCREENS = ['scrOnboardHandler', 'scrOnboardDog', 'scrTutorial', 'scrHome', 'scrHandler', 'scrLay',
  'scrConfirm', 'scrShare', 'scrContam', 'scrPick', 'scrScan', 'scrRun', 'scrResult',
  'scrShowMap', 'scrSessions', 'scrSettings', 'scrDraw', 'scrCountdown', 'scrWalk', 'scrWait', 'scrDog',
  'scrSignIn', 'scrShareOut', 'scrShared', 'scrLive', 'scrBench', 'scrReplay'];

/* The screens that are transparent chrome over the live map. */
const MAP_SCREENS = ['scrLay', 'scrConfirm', 'scrContam', 'scrRun', 'scrShowMap', 'scrDraw', 'scrWalk', 'scrLive', 'scrBench', 'scrReplay'];

/* ── Going back ───────────────────────────────────────────────────────
   Every page except home carries the same arrow, top-left, and it always
   means "the page I came from". Screens that are moments rather than
   places — a recording, a scan, the map behind a card — are never gone
   back TO; the arrow skips over them to the last real page, or home.
   Each forward step is also a browser history entry, so the phone's
   edge-swipe and the browser's back button do exactly what the arrow does. */
const TRANSIENT = new Set(['scrLay', 'scrConfirm', 'scrContam', 'scrRun', 'scrWalk', 'scrDraw', 'scrScan',
  'scrLive', 'scrShowMap', 'scrOnboardHandler', 'scrOnboardDog', 'scrTutorial', 'scrSignIn']);
const BACKABLE = ['scrShare', 'scrPick', 'scrScan', 'scrResult', 'scrSessions', 'scrSettings', 'scrDog',
  'scrShareOut', 'scrShared', 'scrCountdown', 'scrWait', 'scrOnboardHandler', 'scrOnboardDog', 'scrHandler'];
let currentScreen = null;
const navStack = [];

function goBackNow() {
  const special = { scrShared: closeShared, scrLive: closeLive }[currentScreen];
  if (special) return special();
  let prev = navStack.pop();
  while (prev && TRANSIENT.has(prev)) prev = navStack.pop();
  go(prev ?? 'scrHome', { back: true });
}
function goBack() {
  // Through the browser's history when this screen has an entry, so the
  // history and the app never disagree about where "back" leads.
  if (history.state?.tc === currentScreen) history.back();
  else goBackNow();
}
window.addEventListener('popstate', () => { if (currentScreen && currentScreen !== 'scrHome') goBackNow(); });

function go(id, { back = false } = {}) {
  stopScan();
  if (id === 'scrHome') navStack.length = 0;
  else if (!back && currentScreen && currentScreen !== id && !TRANSIENT.has(currentScreen)) {
    navStack.push(currentScreen);
    if (navStack.length > 12) navStack.shift();
    try { history.pushState({ tc: id }, ''); } catch { /* file:// and the like */ }
  }
  currentScreen = id;
  for (const s of SCREENS) $(s).hidden = s !== id;
  if (id === 'scrHome') renderHome();
  if (id === 'scrHandler' && handlerCardId) paintHandlerCard(handlerCardId);   // fresh after an edit
  // The map only needs to be right when something transparent sits over it.
  if (MAP_SCREENS.includes(id)) {
    map?.resize();
    /* The bench supplies its own weather from the dials. Letting the screen
       go looking for a forecast means that answer lands a second later and
       overwrites what the dials are asking about. */
    if (id !== 'scrBench') weatherPanelFor(run.session ?? pendingSession);
    mapChromeShow(true);
    stepsRun(true);
    if (!db.kv.get('mapTutDone') && !mapTut.open) openMapTut();
  } else {
    // Nothing on the map is worth animating while a paper screen covers it.
    airStop();
    stepsRun(false);
    hideWeather();
    mapChromeShow(false);
  }
}

/* ── Map ──────────────────────────────────────────────────────────── */

/* ── How to move the map ───────────────────────────────────────────────
   The map is 3D, and a phone gives no hint of that. Four gestures, acted
   out, the first time the map appears; again from Settings → Help. */
const MAP_TUT = [
  { g: 'pan', title: 'Move around', body: 'Drag with one finger.' },
  { g: 'zoom', title: 'Zoom', body: 'Pinch with two fingers. Double-tap to zoom in a step.' },
  { g: 'tilt', title: 'Tilt the ground', body: 'Drag up or down with two fingers. The map is 3D \u2014 tilt it to see the slopes scent runs down.' },
  { g: 'turn', title: 'Turn the map', body: 'Twist with two fingers. The GPS button at the top right brings you back onto yourself.' },
];
const mapTut = { i: 0, open: false };
function openMapTut() {
  mapTut.i = 0; mapTut.open = true;
  paintMapTut();
  $('mapTut').hidden = false;
}
function paintMapTut() {
  const c = MAP_TUT[mapTut.i], last = mapTut.i === MAP_TUT.length - 1;
  $('mapTutGest').querySelectorAll('.stage').forEach(s => s.classList.toggle('on', s.dataset.g === c.g));
  $('mapTutTitle').textContent = c.title;
  $('mapTutBody').textContent = c.body;
  $('mapTutDots').innerHTML = MAP_TUT.map((_, k) => `<span class="tut-dot${k === mapTut.i ? ' on' : ''}"></span>`).join('');
  $('mapTutNext').textContent = last ? 'Got it' : 'Next';
  $('mapTutSkip').hidden = last;
}
function closeMapTut() {
  $('mapTut').hidden = true;
  mapTut.open = false;
  db.kv.set('mapTutDone', true);
}

/* ── The map style ────────────────────────────────────────────────────
   One button, bottom right, sitting just above whatever controls the
   screen has (CSS --bar-gap is measured from the visible bottom bar). */
function styleGap() {
  const bar = MAP_SCREENS.map(id => $(id)).find(sc => sc && !sc.hidden)?.querySelector('.glass-bottom');
  const gap = bar ? Math.max(0, Math.round(window.innerHeight - bar.getBoundingClientRect().top)) : 0;
  document.documentElement.style.setProperty('--bar-gap', `${gap}px`);
}
function paintStylePick() {
  $('stylePick').querySelectorAll('[data-style]').forEach(b =>
    b.classList.toggle('selected', b.dataset.style === settings.mapStyle));
}
function closeStylePick() {
  $('stylePick').hidden = true;
  $('btnMapStyle').setAttribute('aria-expanded', 'false');
}
function toggleStylePick() {
  const open = $('stylePick').hidden;
  paintStylePick();
  $('stylePick').hidden = !open;
  $('btnMapStyle').setAttribute('aria-expanded', String(open));
}
function mapChromeShow(on) {
  if (on) headingStart(); else headingStop();           // the compass runs while a map is on screen, and only then
  $('btnMapStyle').hidden = !on || !settings.mbToken;   // the tokenless map has one style only
  $('btnRecentre').hidden = !on;
  if (!on) closeStylePick();
  styleGap();                       // now, and once more after layout settles
  requestAnimationFrame(styleGap);
}
function setMapStyle(key) {
  if (!MAP_STYLES[key]) return;
  closeStylePick();
  if (key === settings.mapStyle) return;
  settings.mapStyle = key; saveSettings();
  paintStylePick();
  if (map && settings.mbToken) map.setStyle(MAP_STYLES[key].url);   // style.load puts the overlays back
}
const EMPTY = { type: 'FeatureCollection', features: [] };
let map, mapReady = false;
let GL = mapboxgl;   // every control/bounds must come from the SAME library
const srcData = { runner: EMPTY, steps: EMPTY, dog: EMPTY, paws: EMPTY, wps: EMPTY, drift: EMPTY, start: EMPTY, hides: EMPTY, contam: EMPTY, plan: EMPTY, nose: EMPTY,
                  routeDone: EMPTY, routeAhead: EMPTY, puck: EMPTY, scent: EMPTY, wind: EMPTY,
                  flow: EMPTY, flowPulse: EMPTY, air: EMPTY, acc: EMPTY };

const SAT_STYLE = 'mapbox://styles/mapbox/standard-satellite';
/* Satellite for the field, terrain for the contours and paths, streets for
   town. All three carry the same 3D ground and the same overlays. */
const MAP_STYLES = {
  satellite: { name: 'Satellite', url: SAT_STYLE },
  terrain:   { name: 'Terrain',   url: 'mapbox://styles/mapbox/outdoors-v12' },
  streets:   { name: 'Streets',   url: 'mapbox://styles/mapbox/streets-v12' },
};
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
    style: noToken ? RASTER_FALLBACK : (MAP_STYLES[settings.mapStyle] ?? MAP_STYLES.satellite).url,
    center: [-2.6449, 51.2094], zoom: 15, pitch: 55, maxPitch: 85,
    attributionControl: { compact: true },
  });
  /* No GeolocateControl. The arrow puck already shows where you are with the
     real accuracy ring around it, and the re-centre button brings the camera
     back — a third control doing the same job only took the top right corner
     that messages now need. */
  /* On every style, not just the first: a style swap drops every source,
     layer and image the app added, and this puts them all back. */
  map.on('style.load', addOverlays);
  // Touching the map means they want to look around; stop chasing them.
  map.on('dragstart', releaseFollow);
  map.on('zoomstart', (e) => { if (e.originalEvent) releaseFollow(); });
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
  /* The wind, everywhere. Not the scent — the air the scent is riding on.
     Thin white streaks across the whole view, each one a parcel of air being
     moved by the SAME flow field the plume is built from, so where the
     ground turns the wind you can watch it turn. Faint on purpose: this is
     the condition the work is happening in, not the work. */
  /* Each parcel is a wisp: faint at its tail, strongest at its head, thin and
     soft, brighter in stronger wind, over a faint dark under-glow so it holds
     on bright grass as well as in dark woods. The fade is built from four
     short pieces per wisp, each a little stronger than the last (airFrame):
     Mapbox's own line-gradient rendered these as almost fully transparent,
     and a gradient with data-driven width and opacity overruns the vertex
     attributes a phone GPU offers. Its colour is the handler's. */
  add({ id: 'air-shade', type: 'line', source: 'air',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#0B1630',
                 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 3, 17, 3.6, 19, 4.6],
                 'line-opacity': ['min', 1, ['*', ['get', 'a'], 0.5]],
                 'line-blur': 2 } });
  add({ id: 'air-streaks', type: 'line', source: 'air',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#DCE9FF',
                 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 1.5, 17, 1.8, 19, 2.4],
                 'line-opacity': ['min', 1, ['*', ['get', 'a'], 1.5]],
                 'line-blur': 0.5 } });

  /* The air itself, drawn as scent rather than as a stain.

     A density field said the right thing and looked wrong: solid colour over
     the ground claims the model knows the shape of every square metre, and it
     hides the very terrain that decides where scent goes. Grain is the honest
     picture — each speck is one parcel the model is carrying, thick against
     the line and scattering out to individual specks at the edge, with the
     ground visible the whole way through. Where you can count them is exactly
     where the model has stopped being sure. */
  add({ id: 'scent-glow', type: 'circle', source: 'scent',
        paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 2.2, 17, 5, 19, 9],
                 'circle-color': '#E9902F',
                 'circle-opacity': ['*', ['get', 's'], 0.20],
                 'circle-blur': 1 } });
  add({ id: 'scent-dots', type: 'circle', source: 'scent',
        paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 0.7, 17, 1.5, 19, 2.6],
                 'circle-color': ['interpolate', ['linear'], ['get', 's'],
                   0, '#C9761E', 0.45, '#F2B03C', 1, '#FFE7A8'],
                 'circle-opacity': ['+', 0.25, ['*', ['get', 's'], 0.7]],
                 'circle-blur': 0.18 } });

  /* The flow itself: a few arrows traced through the SAME drift the parcels
     follow, so they are the model's streamlines rather than a decorative
     arrow pointing whichever way the forecast says. Each is a brushed
     shape, not a stroked line: strokes of the same outline laid over one
     another, each starting further along, so it is a whisper where it
     leaves the trail and solid at the head (paintFlow). Filled shapes
     because a line cannot taper, and because a head drawn as part of the
     shape can never sit crooked on its shaft. */
  add({ id: 'flow-shadow', type: 'fill', source: 'flow',
        paint: { 'fill-color': '#050B1A', 'fill-opacity': 0.26, 'fill-antialias': true,
                 'fill-translate': [1.2, 2], 'fill-translate-anchor': 'viewport' } });
  add({ id: 'flow-fill', type: 'fill', source: 'flow',
        paint: { 'fill-color': '#FFEDBE', 'fill-opacity': 0.4, 'fill-antialias': true } });
  /* The light that runs along each one, tail to head, at the wind's pace. */
  add({ id: 'flow-pulse', type: 'fill', source: 'flowPulse',
        paint: { 'fill-color': '#FFFBEF', 'fill-opacity': ['get', 'o'], 'fill-antialias': true } });
  /* The line you DREW, once the walked card has replaced it. A sketch, not
     a record: thin, pale and dashed, and drawn under the real trail, because
     what the layer actually walked is the thing that laid scent. Seeing both
     is how you find the corner they turned the wrong way. */
  add({ id: 'plan-casing', type: 'line', source: 'plan',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#0B1630', 'line-width': 7, 'line-opacity': 0.55, 'line-blur': 0.5 } });
  add({ id: 'plan-line', type: 'line', source: 'plan',
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: { 'line-color': '#BFD8FF', 'line-width': 3.2, 'line-opacity': 0.98, 'line-dasharray': [2.2, 1.8] } });
  add({ id: 'contam-line', type: 'line', source: 'contam',
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: { 'line-color': '#C8B8E8', 'line-width': 3.5, 'line-opacity': 0.9, 'line-dasharray': [1, 1.4] } });
  /* The trail is footprints, not a line: the layer walked it, and the prints
     say so — and which way. One print every stride (see setTrail), thinned
     by zoom so they never pile up, left and right feet on their own sides,
     and lit one after another from the start so the trail reads as walked.
     The dog's track stays a solid, dark-cased line, so colour is never the
     only difference between the two. */
  /* The same trail as a plain line or as stripes, for whoever prefers them:
     Settings → On the map picks one of the three (applyMapColours). */
  add({ id: 'runner-casing', type: 'line', source: 'runner',
        layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' },
        paint: { 'line-color': '#FFFFFF', 'line-width': 8, 'line-opacity': 0.55 } });
  add({ id: 'runner-line', type: 'line', source: 'runner',
        layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' },
        paint: { 'line-color': '#0B1630', 'line-width': 5, 'line-opacity': 0.98 } });
  add({ id: 'runner-dash', type: 'line', source: 'runner',
        layout: { 'line-cap': 'butt', 'line-join': 'round', visibility: 'none' },
        paint: { 'line-color': '#0B1630', 'line-width': 5, 'line-opacity': 0.98, 'line-dasharray': [2.2, 1.4] } });
  if (!map.hasImage('print')) map.addImage('print', printSdf(), { pixelRatio: 2, sdf: true });
  const every = (k) => ['==', ['%', ['get', 'i'], k], 0];
  const side = (k) => ['case', ['==', ['%', ['/', ['get', 'i'], k], 2], 0], ['literal', [-5, 0]], ['literal', [5, 0]]];
  add({ id: 'runner-steps', type: 'symbol', source: 'steps',
        filter: ['step', ['zoom'], every(64), 14, every(32), 15, every(16), 16, every(8), 17, every(4), 18, every(2), 19, true],
        layout: { 'icon-image': 'print', 'icon-rotate': ['get', 'b'],
                  'icon-offset': ['step', ['zoom'], side(64), 14, side(32), 15, side(16), 16, side(8), 17, side(4), 18, side(2), 19, side(1)],
                  'icon-size': ['interpolate', ['linear'], ['zoom'], 13, 0.55, 16, 0.85, 18, 1.2, 20, 1.8],
                  'icon-rotation-alignment': 'map', 'icon-pitch-alignment': 'map',
                  'icon-allow-overlap': true, 'icon-ignore-placement': true },
        paint: { 'icon-color': '#F5D14A', 'icon-halo-color': '#0B1630', 'icon-halo-width': 1.4, 'icon-opacity': 0.98 } });
  add({ id: 'dog-casing', type: 'line', source: 'dog',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#0B1630', 'line-width': 8, 'line-opacity': 0.55 } });
  add({ id: 'dog-line', type: 'line', source: 'dog',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#FFFFFF', 'line-width': 4.5, 'line-opacity': 0.98 } });
  add({ id: 'dog-dash', type: 'line', source: 'dog',
        layout: { 'line-cap': 'butt', 'line-join': 'round', visibility: 'none' },
        paint: { 'line-color': '#FFFFFF', 'line-width': 4.5, 'line-opacity': 0.98, 'line-dasharray': [2, 1.5] } });
  /* The dog's track as paw prints: the same thinning and turning as the
     footprints, a narrower gait. */
  if (!map.hasImage('paw')) map.addImage('paw', pawSdf(), { pixelRatio: 2, sdf: true });
  const pawSide = (k) => ['case', ['==', ['%', ['/', ['get', 'i'], k], 2], 0], ['literal', [-3.5, 0]], ['literal', [3.5, 0]]];
  add({ id: 'dog-paws', type: 'symbol', source: 'paws',
        filter: ['step', ['zoom'], every(64), 14, every(32), 15, every(16), 16, every(8), 17, every(4), 18, every(2), 19, true],
        layout: { 'icon-image': 'paw', 'icon-rotate': ['get', 'b'], visibility: 'none',
                  'icon-offset': ['step', ['zoom'], pawSide(64), 14, pawSide(32), 15, pawSide(16), 16, pawSide(8), 17, pawSide(4), 18, pawSide(2), 19, pawSide(1)],
                  'icon-size': ['interpolate', ['linear'], ['zoom'], 13, 0.4, 16, 0.62, 18, 0.88, 20, 1.28],
                  'icon-rotation-alignment': 'map', 'icon-pitch-alignment': 'map',
                  'icon-allow-overlap': true, 'icon-ignore-placement': true },
        paint: { 'icon-color': '#FFFFFF', 'icon-halo-color': '#0B1630', 'icon-halo-width': 1.4, 'icon-opacity': 0.98 } });
  /* The route you are following, in the grammar every navigation app uses:
     a dark casing so it survives any imagery, a bright core, and the part
     you have already walked dimmed to grey — seeing the split is how you
     know the phone has actually found you on the line. */
  const wide = (z15, z17, z19) => ['interpolate', ['linear'], ['zoom'], 15, z15, 17, z17, 19, z19];
  add({ id: 'route-done', type: 'line', source: 'routeDone',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#7C8880', 'line-width': wide(7, 12, 20), 'line-opacity': 0.5 } });
  add({ id: 'route-glow', type: 'line', source: 'routeAhead',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#0B1630', 'line-width': wide(18, 30, 48), 'line-opacity': 0.28, 'line-blur': 10 } });
  add({ id: 'route-casing', type: 'line', source: 'routeAhead',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#14284B', 'line-width': wide(13, 22, 36), 'line-opacity': 0.95 } });
  add({ id: 'route-core', type: 'line', source: 'routeAhead',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#57C766', 'line-width': wide(8, 14, 24), 'line-opacity': 1 } });

  add({ id: 'hide-dots', type: 'circle', source: 'hides',
        paint: { 'circle-radius': 9, 'circle-color': '#C99A2E',
                 'circle-stroke-width': 2.5, 'circle-stroke-color': '#FFFFFF' } });
  add({ id: 'nose-halo', type: 'circle', source: 'nose',
        paint: { 'circle-radius': 15, 'circle-color': '#FFFFFF', 'circle-opacity': 0.22, 'circle-blur': 0.6 } });
  add({ id: 'nose-dot', type: 'circle', source: 'nose',
        paint: { 'circle-radius': 8, 'circle-color': '#FFFFFF',
                 'circle-stroke-width': 3, 'circle-stroke-color': '#0B1630' } });
  add({ id: 'start-dot', type: 'circle', source: 'start',
        paint: { 'circle-radius': 9, 'circle-color': '#2F9E44',
                 'circle-stroke-width': 2.5, 'circle-stroke-color': '#FFFFFF' } });
  add({ id: 'start-text', type: 'symbol', source: 'start',
        layout: { 'text-field': 'Start', 'text-size': 12, 'text-offset': [0, 1.3], 'text-anchor': 'top' },
        paint: { 'text-color': '#FFFFFF', 'text-halo-color': '#0B1630', 'text-halo-width': 1.6 } });
  add({ id: 'wp-dots', type: 'circle', source: 'wps',
        paint: { 'circle-radius': 7, 'circle-color': '#FFFFFF',
                 'circle-stroke-width': 2, 'circle-stroke-color': '#0B1630' } });
  add({ id: 'wp-text', type: 'symbol', source: 'wps',
        layout: { 'text-field': ['get', 'kind'], 'text-size': 11, 'text-offset': [0, 1.4], 'text-anchor': 'top' },
        paint: { 'text-color': '#FFFFFF', 'text-halo-color': '#0B1630', 'text-halo-width': 1.6 } });

  /* The air, moving. The plume says where scent has got to; it cannot say
     that the air is going anywhere, and a still picture of moving air
     teaches the wrong thing. These parcels are released at the line and
     stream downwind on the same modelled flow the plume is built from, at
     REAL speed — so what you watch is the drift, not an impression of it. */
  add({ id: 'wind-tracers', type: 'circle', source: 'wind',
        paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 1.1, 17, 2.4, 19, 4],
                 'circle-color': '#F1D27A',
                 'circle-opacity': ['*', ['get', 'a'], 0.9],
                 'circle-blur': 0.35 } });

  /* You: an arrow, not a dot. A dot says where you are; an arrow says which
     way you are facing, which is the half of the question you are actually
     asking when you look down at a phone in a field. */
  if (!map.hasImage('puck')) map.addImage('puck', puckImage(), { pixelRatio: 2 });
  /* The accuracy ring is drawn in METRES, not pixels, so it means something:
     it is the circle the phone says you are somewhere inside. A ring you can
     see is the difference between "the map is wrong" and "the fix is loose". */
  add({ id: 'puck-acc-fill', type: 'fill', source: 'acc',
        paint: { 'fill-color': '#2F9E44', 'fill-opacity': 0.13 } });
  add({ id: 'puck-acc-edge', type: 'line', source: 'acc',
        paint: { 'line-color': '#FFFFFF', 'line-width': 1.4, 'line-opacity': 0.5 } });
  add({ id: 'puck-arrow', type: 'symbol', source: 'puck',
        layout: { 'icon-image': 'puck',
                  'icon-size': ['interpolate', ['linear'], ['zoom'], 14, 0.5, 17, 0.8, 19, 1.05],
                  'icon-allow-overlap': true,
                  'icon-ignore-placement': true, 'icon-rotate': ['get', 'brg'],
                  'icon-rotation-alignment': 'map', 'icon-pitch-alignment': 'map' } });

  mapReady = true;
  applyMapColours();
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

/** The heading arrow, drawn at load rather than fetched — one less file to
    ship, and it stays sharp on a retina screen. Points up; the layer spins
    it. A white collar keeps it readable on grass, tarmac and snow alike. */
/** A circle on the ground, in metres. */
function circlePoly(centre, radiusM, n = 48) {
  if (!centre || !(radiusM > 0)) return EMPTY;
  const ring = [];
  for (let i = 0; i <= n; i++) {
    const q = project(centre, (i / n) * 360, radiusM);
    ring.push([q.lon, q.lat]);
  }
  return { type: 'FeatureCollection', features: [{
    type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] } }] };
}

/** Put you on the map: the arrow, and the circle you are somewhere inside. */
function paintMe(lat, lon, acc, brg = null) {
  setSrc('puck', { type: 'FeatureCollection', features: [{
    type: 'Feature',
    properties: { brg: brg ?? 0 },
    geometry: { type: 'Point', coordinates: [lon, lat] } }] });
  setSrc('acc', Number.isFinite(acc) && acc > 1 ? circlePoly({ lat, lon }, acc) : EMPTY);
}

/* ── Finding you ──────────────────────────────────────────────────────
   The first fix a phone gives is the worst fix of the session. The radio
   wakes, answers from whatever it has — often a cached or mast-derived
   position — and then tightens over the next several seconds as it acquires
   satellites. Asking once and centring on the answer is what puts the map
   beside you instead of on you.

   So this keeps a short high-accuracy watch open and re-centres every time a
   TIGHTER fix arrives, never a looser one, until the fix is as good as a
   phone gets or the window closes. */
const locate = { watch: 0, timer: 0, best: Infinity };
let lastFix = null;   // the newest position any watch has handed over

function locateMe({ zoom = 17.5, settleMs = 12000, good = 8 } = {}) {
  locateStop();
  if (!navigator.geolocation || !window.isSecureContext) return;
  locate.best = Infinity;
  locate.watch = navigator.geolocation.watchPosition((p) => {
    if (rec.on) return locateStop();          // the recording watch owns the map now
    const acc = p.coords.accuracy ?? 9999;
    if (acc > locate.best) return;            // never move to a worse answer
    locate.best = acc;
    const { latitude: lat, longitude: lon } = p.coords;
    lastFix = { lat, lon, t: Date.now() };
    paintMe(lat, lon, acc);
    map.easeTo({ center: [lon, lat], zoom, duration: 700, essential: true });
    if (acc <= good) locateStop();            // as tight as it gets: stop burning the radio
  }, () => { /* the HUD and the GPS check say why */ },
     { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
  clearTimeout(locate.timer);
  locate.timer = setTimeout(locateStop, settleMs);
}
function locateStop() {
  if (locate.watch) navigator.geolocation?.clearWatch(locate.watch);
  clearTimeout(locate.timer);
  locate.watch = 0; locate.timer = 0;
}
function puckImage() {
  const S = 96, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const chevron = () => {
    g.beginPath();
    g.moveTo(S / 2, 14);                 // nose
    g.lineTo(S - 20, S - 20);            // right shoulder
    g.lineTo(S / 2, S - 34);             // tail notch
    g.lineTo(20, S - 20);                // left shoulder
    g.closePath();
  };
  g.shadowColor = 'rgba(0,0,0,0.45)'; g.shadowBlur = 10; g.shadowOffsetY = 2;
  chevron(); g.fillStyle = '#FFFFFF'; g.fill();
  g.shadowColor = 'transparent';
  g.lineWidth = 7; g.strokeStyle = '#FFFFFF'; g.lineJoin = 'round'; chevron(); g.stroke();
  chevron(); g.fillStyle = '#2F9E44'; g.fill();
  return g.getImageData(0, 0, S, S);
}

/* A small shape as a signed-distance field, so the map can colour and halo
   each icon on its own (a raster icon could only fade). 48 × 48 at
   pixelRatio 2; alpha 0.75 is the edge, the way Mapbox reads an SDF. */
function sdfFrom(draw) {
  const S = 48, R = 8, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  draw(g, S);
  const a = g.getImageData(0, 0, S, S).data;
  const inside = new Uint8Array(S * S);
  for (let i = 0; i < S * S; i++) inside[i] = a[i * 4 + 3] > 127 ? 1 : 0;
  const edge = [];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    if (!inside[y * S + x]) continue;
    if (x === 0 || y === 0 || x === S - 1 || y === S - 1 ||
        !inside[y * S + x - 1] || !inside[y * S + x + 1] || !inside[(y - 1) * S + x] || !inside[(y + 1) * S + x]) edge.push(x, y);
  }
  const out = g.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let d2 = Infinity;
    for (let e = 0; e < edge.length; e += 2) {
      const dx = x - edge[e], dy = y - edge[e + 1], q = dx * dx + dy * dy;
      if (q < d2) d2 = q;
    }
    const d = inside[y * S + x] ? -Math.sqrt(d2) : Math.sqrt(d2);
    const k = (y * S + x) * 4;
    out.data[k] = out.data[k + 1] = out.data[k + 2] = 255;
    out.data[k + 3] = Math.max(0, Math.min(255, Math.round(255 * (0.75 - d / R))));
  }
  return out;
}
const ell = (g, x, y, rx, ry, rot = 0) => { g.beginPath(); g.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2); g.fill(); };
/* One shoe print, toes up: the ball and the heel. */
const printSdf = () => sdfFrom((g, S) => { ell(g, S / 2, 16, 8, 10.5); ell(g, S / 2, 35, 5.5, 6.5); });
/* One paw print, toes up: the pad and four toes. */
const pawSdf = () => sdfFrom((g, S) => {
  ell(g, S / 2, 31, 9.5, 8);
  ell(g, 11.5, 20, 4, 5.2, -0.45); ell(g, 19.5, 12.5, 4.2, 5.6, -0.15);
  ell(g, 28.5, 12.5, 4.2, 5.6, 0.15); ell(g, 36.5, 20, 4, 5.2, 0.45);
});

const lineOf = (pts) => !pts || pts.length < 2 ? EMPTY : {
  type: 'FeatureCollection',
  features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: pts.map(p => [p.lon, p.lat]) } }],
};

/* The laid trail, as footprints: one print every stride. A bright step walks
   the prints from the start to the end and round again, so the trail reads
   as walked, and which way. Prints stay where they are; only the light
   moves (paint, not layout — nothing is laid out again per tick). */
const STRIDE_M = 2;
const LIT = 6;                       // prints either side of the walking step that glow
const steps = { n: 0, f: -1e9, timer: 0 };
function stepsOf(pts) {
  const s = stepPoints(pts, STRIDE_M);
  return !s.length ? EMPTY : { type: 'FeatureCollection', features: s.map(p => ({
    type: 'Feature', properties: { i: p.i, b: Math.round(p.b) },
    geometry: { type: 'Point', coordinates: [p.lon, p.lat] } })) };
}
function setTrail(pts) {
  setSrc('runner', lineOf(pts));      // for the line and stripes styles
  const fc = stepsOf(pts);
  setSrc('steps', fc);
  steps.n = fc === EMPTY ? 0 : fc.features.length;
  stepsRun(MAP_SCREENS.includes(currentScreen));
}
/* The dog's track: a line for the line and stripes styles, points for paws. */
function setDogTrack(pts) {
  setSrc('dog', lineOf(pts));
  const s = settings.dogStyle === 'paws' ? stepPoints(pts, 2.5) : [];
  setSrc('paws', !s.length ? EMPTY : { type: 'FeatureCollection', features: s.map(q => ({
    type: 'Feature', properties: { i: q.i, b: Math.round(q.b) },
    geometry: { type: 'Point', coordinates: [q.lon, q.lat] } })) });
  dogTrackPts = pts || null;
}
let dogTrackPts = null;
function stepsPaint() {
  if (!mapReady || !map.getLayer('runner-steps')) return;
  const c = stepPalette(settings.stepColor);
  const near = ['<', ['abs', ['-', ['get', 'i'], steps.f]], LIT];
  map.setPaintProperty('runner-steps', 'icon-color', ['case', near, c.lit, c.base]);
  map.setPaintProperty('runner-steps', 'icon-halo-color', ['case', near, c.haloLit, c.halo]);
  map.setPaintProperty('runner-steps', 'icon-halo-width', ['case', near, c.haloLitWidth, c.haloWidth]);
}
/* The handler's colours for the scent and the footprints, onto the layers
   that draw them: when a style has loaded (the layers are new) and whenever
   a swatch is tapped. The report and the small maps keep their own. */
function applyMapColours() {
  if (!mapReady) return;
  const p = plumePalette(settings.plumeColor);
  if (map.getLayer('scent-glow')) map.setPaintProperty('scent-glow', 'circle-color', p.base);
  if (map.getLayer('scent-dots')) map.setPaintProperty('scent-dots', 'circle-color',
    ['interpolate', ['linear'], ['get', 's'], 0, p.dark, 0.45, p.base, 1, p.light]);
  if (map.getLayer('flow-fill')) map.setPaintProperty('flow-fill', 'fill-color', mix(p.base, '#FFFFFF', 0.62));
  const wc = windPalette(settings.windColor);
  if (map.getLayer('air-streaks')) map.setPaintProperty('air-streaks', 'line-color', wc.base);
  /* Which drawing of the trail and of the dog's track is showing. */
  const vis = (id, on) => { if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'); };
  const paint = (id, prop, v) => { if (map.getLayer(id)) map.setPaintProperty(id, prop, v); };
  const ts = settings.trailStyle, ds = settings.dogStyle;
  vis('runner-steps', ts === 'steps'); vis('runner-casing', ts !== 'steps');
  vis('runner-line', ts === 'line'); vis('runner-dash', ts === 'stripes');
  vis('dog-paws', ds === 'paws'); vis('dog-casing', ds !== 'paws');
  vis('dog-line', ds === 'line'); vis('dog-dash', ds === 'stripes');
  const tp = trackPalette(settings.stepColor, '#0B1630'), dp = trackPalette(settings.dogColor);
  paint('runner-line', 'line-color', tp.base); paint('runner-dash', 'line-color', tp.base); paint('runner-casing', 'line-color', tp.casing);
  paint('dog-line', 'line-color', dp.base); paint('dog-dash', 'line-color', dp.base); paint('dog-casing', 'line-color', dp.casing);
  paint('dog-paws', 'icon-color', dp.base); paint('dog-paws', 'icon-halo-color', dp.casing);
  stepsPaint();
}
/* A style of drawing, chosen in Settings. Paw prints are points, so the
   dog's track is rebuilt when they are switched on. */
function setLook(key, v) {
  settings[key] = v; saveSettings();
  if (key === 'dogStyle' && dogTrackPts) setDogTrack(dogTrackPts);
  paintColourRows(); applyMapColours();
  stepsRun(MAP_SCREENS.includes(currentScreen));
}
const WIND_PRESETS = [{ name: 'Air', hex: '#DCE9FF' }, ...COLOUR_PRESETS.filter(c => c.hex !== '#FFFFFF')];
function paintColourRows() {
  const row = (id, key, presets) => {
    const cur = String(settings[key]).toUpperCase();
    const custom = !presets.some(c => c.hex === cur);
    $(id).innerHTML = presets.map(c =>
      `<button type="button" class="swatch${c.hex === cur ? ' selected' : ''}" data-colour="${c.hex}" style="--c:${c.hex}" aria-label="${c.name}" title="${c.name}"></button>`).join('')
      + `<label class="swatch custom${custom ? ' selected' : ''}" title="Any colour" style="--c:${custom ? cur : 'transparent'}"><input type="color" value="${cur}" aria-label="Choose any colour"></label>`;
  };
  row('plumeRow', 'plumeColor', COLOUR_PRESETS);
  row('stepRow', 'stepColor', COLOUR_PRESETS);
  row('dogRow', 'dogColor', COLOUR_PRESETS);
  row('windRow', 'windColor', WIND_PRESETS);
  for (const [dot, key] of [['plumeDot', 'plumeColor'], ['stepDot', 'stepColor'], ['dogDot', 'dogColor'], ['windDot', 'windColor']]) {
    $(dot).style.background = settings[key];
  }
  $('trailStyleSeg').querySelectorAll('[data-trail-style]').forEach(b => b.classList.toggle('on', b.dataset.trailStyle === settings.trailStyle));
  $('dogStyleSeg').querySelectorAll('[data-dog-style]').forEach(b => b.classList.toggle('on', b.dataset.dogStyle === settings.dogStyle));
}
function setColour(key, hex) {
  if (!isHex(hex)) return;
  settings[key] = hex.toUpperCase(); saveSettings();
  paintColourRows(); applyMapColours();
}
function stepsTick() {
  steps.f = steps.f > steps.n + LIT ? -LIT * 4 : steps.f + 1;   // a breath past the end, then from the start
  stepsPaint();
}
function stepsRun(on) {
  if (on && steps.n && settings.trailStyle === 'steps') {
    if (!steps.timer) { steps.f = -LIT; steps.timer = setInterval(stepsTick, 90); }
    return;
  }
  clearInterval(steps.timer); steps.timer = 0;
  steps.f = -1e9; stepsPaint();
}
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
  $('scrOnboardHandler').querySelector('.display').textContent = 'You, the handler';
  $('scrOnboardHandler').querySelector('p.body').textContent = 'Trailcraft records what your dog does with a scent. It starts with who is holding the line. Other handlers can be added later.';
  $('scrOnboardHandler').classList.toggle('first-launch', firstLaunch);
  $('obHandlerNext').textContent = firstLaunch ? 'Next: your dog' : 'Save';
  $('obHandlerLayOnly').hidden = !firstLaunch;   // the person who only lays: a name, then straight in
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
  $('scrOnboardHandler').querySelector('p.body').textContent = 'The person who lays the trail or sets the hides. A name is enough — more people can be added later.';
  $('scrOnboardHandler').classList.remove('first-launch');
  $('obHandlerNext').textContent = 'Save';
  $('obHandlerLayOnly').hidden = true;
  paintObAva('obHandlerAva', existing?.name);
  go('scrOnboardHandler');
}

function saveHandlerForm(layOnly = false) {
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
  if (obMode.firstLaunch) {
    /* Someone here only to lay trails needs no dog: the trail card they make
       goes to whoever runs one. The dog step is skipped, not lost — a dog can
       be added from the home screen any day. */
    if (layOnly === true) { db.kv.set('layerOnly', true); snap(); return openTutorial(false); }
    return openDogForm({ firstLaunch: true });
  }
  leaveForm(obMode.returnTo);
}

/* A saved form leaves the way it was entered when that is where it is headed,
   so the history and the stack stay honest: one press of the arrow on
   Settings afterwards, not two. The arrow itself is plain goBack. */
function leaveForm(to = 'scrHome') {
  if (navStack[navStack.length - 1] === to) return goBack();
  go(to);
}

let obDogLevel = 'Hot';
let obDogSex = null;
function openDogForm({ id = null, handlerId = null, returnTo = null, firstLaunch = false } = {}) {
  obMode = { type: 'dog', id, handlerId: handlerId ?? S.handler?.id, returnTo, firstLaunch };
  const existing = id ? db.dogs.byId(id) : null;
  obPhoto = existing?.photo ?? null;
  obDogLevel = existing?.level ?? 'Hot';
  obDogSex = existing?.sex ?? null;
  $('obDogName').value = existing?.name ?? '';
  $('obDogBreed').value = existing?.breed ?? '';
  // A date input speaks ISO and nothing else, whatever the phone displays.
  $('obDogDob').value = existing?.dob ? new Date(existing.dob).toISOString().slice(0, 10) : '';
  $('obDogDob').max = new Date().toISOString().slice(0, 10);   // no dog is born tomorrow
  paintDogUnits();
  const shown = kgToShown(existing?.weightKg, imp());
  $('obDogWeight').value = shown ? shown.toFixed(1) : '';
  $('obDogLine').value = lineShown(existing?.lineM ?? 10);
  paintDogSex();
  $('scrOnboardDog').querySelector('.label').textContent = firstLaunch ? 'Step 2 of 3' : 'Dog';
  $('scrOnboardDog').classList.toggle('first-launch', firstLaunch);
  $('obDogTitle').textContent = firstLaunch ? 'Your dog' : (existing ? existing.name : 'A new dog');
  $('obDogSub').hidden = !firstLaunch;
  $('obDogNext').textContent = firstLaunch ? 'Next: how it works' : 'Save';
  paintDogLevel();
  paintObAva('obDogAva', existing?.name);
  go('scrOnboardDog');
}

/* Units on the dog form itself: the same setting as in Settings, switchable
   where the numbers are typed. What is already typed is converted, so a
   number keeps its meaning when the unit under it changes. */
const lineShown = (m) => imp() ? Math.round(m / 0.3048 * 2) / 2 : m;
function paintDogUnits() {
  const im = imp();
  $('obDogUnits').querySelectorAll('[data-units]').forEach(b =>
    b.classList.toggle('on', (b.dataset.units === 'imperial') === im));
  $('obDogWeightUnit').textContent = im ? 'lb' : 'kg';
  const ll = document.querySelector('label[for="obDogLine"]');
  if (ll) ll.textContent = `Line length, ${im ? 'feet' : 'metres'}`;
  $('obDogLine').max = im ? 130 : 40;
}
function setDogUnits(units) {
  if (units === settings.distUnits) return;
  const toImp = units === 'imperial';
  const w = parseFloat(String($('obDogWeight').value).replace(',', '.'));
  const l = parseFloat(String($('obDogLine').value).replace(',', '.'));
  settings.distUnits = units; saveSettings();
  if (Number.isFinite(w)) $('obDogWeight').value = (toImp ? w * 2.20462 : w / 2.20462).toFixed(1);
  if (Number.isFinite(l)) $('obDogLine').value = String(Math.round((toImp ? l / 0.3048 : l * 0.3048) * 2) / 2);
  paintDogUnits();
}

function paintDogSex() {
  $('obDogSex').querySelectorAll('[data-sex]').forEach(b =>
    b.classList.toggle('selected', b.dataset.sex === obDogSex));
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
  const lineTyped = Math.max(0, parseFloat(String($('obDogLine').value).replace(',', '.')) || 0);
  const lineM = Math.round((imp() ? lineTyped * 0.3048 : lineTyped) * 10) / 10;   // stored in metres whatever was typed
  const id = obMode.id ?? uid();
  const dobStr = $('obDogDob').value;
  const wShown = parseFloat(String($('obDogWeight').value).replace(',', '.'));
  /* Weight is stored in kilograms whatever the handler types in, so switching
     units later re-reads the same dog rather than a heavier one. */
  const weightKg = Number.isFinite(wShown) && wShown > 0 ? shownToKg(wShown, imp()) : null;
  db.dogs.upsert({
    id, handlerId: obMode.handlerId, name, photo: obPhoto, level: obDogLevel, lineM,
    breed: $('obDogBreed').value.trim() || null,
    sex: obDogSex,
    dob: dobStr ? Date.parse(`${dobStr}T12:00:00`) : null,
    weightKg,
    chip: (obMode.id ? db.dogs.byId(obMode.id)?.chip : null) ?? null,   // no longer asked for; kept if it was ever entered
  });
  db.kv.set('lastDogId', id);
  snap();
  if (obMode.firstLaunch) return openTutorial(false);
  leaveForm(obMode.returnTo);
}

/* ── Tutorial: five cards a handler would say to another handler ──── */
const TUT_CARDS = [
  { k: '01', title: 'Two people, one dog.', body: 'Someone walks a trail and waits at the end. You run the dog along it. Trailcraft records both, and the weather that day.' },
  { k: '02', title: 'Draw the line with your finger.', body: 'Tap the corners from start to finish, then Save plan and pick how long it ages before the dog starts. Now, 5, 10, or any number you type.' },
  { k: '03', title: 'The other phone walks it.', body: 'They scan the code and their phone guides them down your line. The clock starts when they leave, on both phones, and they hand back the trail they really walked. No signal needed.' },
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

/* A mark for each trail age. Drawn here as plain shapes so they carry the
   meaning without a font or an image file: frost for cold, a low sun for
   warm, a flame for hot. */
const LEVEL_ICON = {
  cold: `<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="none"
      stroke="currentColor" stroke-width="2" stroke-linecap="round">
      <path d="M12 3v18M4.5 7.5l15 9M19.5 7.5l-15 9"/>
      <path d="M12 6.6 9.9 4.8M12 6.6l2.1-1.8M12 17.4l-2.1 1.8M12 17.4l2.1 1.8"/></svg>`,
  warm: `<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="none"
      stroke="currentColor" stroke-width="2" stroke-linecap="round">
      <circle cx="12" cy="13" r="4"/>
      <path d="M12 4.5v2M4.8 13h2M17.2 13h2M6.9 7.9l1.4 1.4M17.1 7.9l-1.4 1.4"/></svg>`,
  hot:  `<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="none"
      stroke="currentColor" stroke-width="2" stroke-linejoin="round">
      <path d="M12 3c3.2 3.4 5.5 6.2 5.5 9.4a5.5 5.5 0 0 1-11 0C6.5 9.2 8.8 6.4 12 3z"/>
      <path d="M12 20a2.6 2.6 0 0 1-2.6-2.6c0-1.6 1.2-2.6 2.6-4.3 1.4 1.7 2.6 2.7 2.6 4.3A2.6 2.6 0 0 1 12 20z"/></svg>`,
};

/** Bring the chosen chip into view. These rows scroll sideways, and a
    selection sitting off the right-hand edge is a decision the handler
    cannot see they have made. */
function showSelectedChip(row) {
  if (!row || row.hidden) return;
  const sel = row.querySelector('.selected');
  if (!sel) return;
  /* Measured, not computed from offsetLeft: the row is not a positioned
     parent, so a chip's offsetLeft is relative to something further up and
     the arithmetic lands in the wrong place. Rects are always the truth. */
  const box = row.getBoundingClientRect(), chip = sel.getBoundingClientRect();
  row.scrollLeft += (chip.left + chip.width / 2) - (box.left + box.width / 2);
}

/* Narcotics and Explosives open a second row, the way A person opens "who
   lays it": which odour, from the ones detection dogs are certified on, or
   typed when it is not there. Other is only ever typed. The field is part of
   the page rather than painted here, so repainting the rows never takes the
   keyboard away from someone half way through a word. */
let odourTyping = false;
let odoursFor = null;
function paintOdours() {
  const { target, odour } = S;
  const set = ODOURS[target.id];
  const custom = !!set && (odourTyping || (!!odour && !set.list.includes(odour)));
  $('lblOdour').hidden = !set;
  $('rowOdours').hidden = !set;
  if (set) {
    $('lblOdour').textContent = set.ask;
    $('rowOdours').innerHTML = set.list.map(o =>
      `<button class="chip odour${!custom && o === odour ? ' selected' : ''}" data-odour="${esc(o)}">${esc(o)}</button>`).join('')
      + `<button class="chip odour${custom ? ' selected' : ' ghost'}" data-odour-other>${custom ? 'Other' : '+ Other'}</button>`;
    /* One row, two lists: coming from the far end of the other list, a list
       with nothing chosen yet should open at its beginning. */
    if (odoursFor !== target.id) $('rowOdours').scrollLeft = 0;
  }
  odoursFor = target.id;
  const field = $('otherTarget');
  const typing = target.id === 'other' || custom;
  field.hidden = !typing;
  if (!typing) return;
  field.placeholder = set ? set.name : 'What is the dog looking for?';
  const typed = set && set.list.includes(odour) ? '' : odour;
  if (document.activeElement !== field) field.value = typed;
}

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
    `<button class="chip plain${t.id === target.id ? ' selected' : ''}" data-target="${t.id}" aria-label="${esc(t.label)}: ${esc(t.sub)}"><b>${esc(t.label)}</b></button>`).join('');
  paintOdours();

  /* Trail age belongs to a person and only to a person: a hide has no walk
     behind it to age — it sits there from the moment it is placed. */
  const isPerson = target.kind === 'person';
  $('lblLevel').hidden = !isPerson;
  $('rowLevels').hidden = !isPerson;
  if (isPerson) {
    $('rowLevels').innerHTML = LEVELS.map(l =>
      `<button class="chip lvl lvl-${l.id}${l.id === S.level.id ? ' selected' : ''}" data-trail-level="${l.id}" aria-label="${esc(l.label)}: ${esc(l.sub)}">
        <span class="lvl-mark">${LEVEL_ICON[l.id]}</span>
        <span class="who"><b>${esc(l.label)}</b></span>
      </button>`).join('');
  }

  $('lblSetter').textContent = v.setter;
  /* No "Just me" for a person. You cannot be the handler and the one being
     searched for at the same time — somebody else has to walk away and be
     found. A hide is different: you can place that yourself. */
  $('rowLayers').innerHTML =
    (isPerson ? '' : `<button class="chip${!layer ? ' selected' : ''}" data-layer=""><span class="who"><b>Just me</b><i class="sub">single phone</i></span></button>`)
    + layers.map(l =>
      `<button class="chip${l.id === layer?.id ? ' selected' : ''}" data-layer="${l.id}">${avaHtml(l)}<span class="who"><b>${esc(l.name)}</b></span></button>`).join('')
    + `<button class="chip ghost" data-add-layer>+ Add person</button>`;

  const setter = layer ? layer.name : handler.name;
  $('btnLayLabel').textContent = v.lay;
  const solo = S.layerOnly && !dog;             // lays for someone else's dog: no run, no 'who lays'
  $('btnLaySub').textContent = solo
    ? (isPerson ? `You walk it — the handler scans your card and runs the dog`
                : `You place it — hides stay on this phone for now`)
    : !isPerson
    ? `${setter} places it, ${handler.name} searches with ${dog?.name ?? 'the dog'}`
    : layer
      ? `${layer.name} walks it, ${handler.name} runs ${dog?.name ?? 'the dog'}`
      : 'Choose who lays it — it cannot be you';
  $('btnRun').hidden = solo;
  $('lblSetter').hidden = solo;
  $('rowLayers').hidden = solo;
  for (const id of ['rowHandlers', 'rowDogs', 'rowTargets', 'rowOdours', 'rowLevels', 'rowLayers']) {
    showSelectedChip($(id));
  }

  $('btnRunLabel').textContent = v.run;
  $('btnRunSub').textContent = v.runSub;
  /* Scanning has its own button because it is how the OTHER phone joins in,
     and burying it under "Run a trail" made the layer hunt for it. Hides have
     no card format yet, so it only shows where it can do something. */
  $('btnScanHome').hidden = target.kind !== 'person';

  const recent = S.sessions.slice(0, 6);
  $('recentList').innerHTML = recent.length ? recent.map(sessionCard).join('')
    : `<div class="card"><p class="body muted">Nothing yet. After each run, one line about what the dog did appears here.</p></div>`;
}

function sessionCard(s) {
  const d = S.dogs.find(x => x.id === s.dogId);
  return `<div class="card" data-open-session="${s.id}">
    <div class="meta"><span>${fmtWhen(s.startedAt)}</span><span>${esc(d?.name ?? '')}${d ? ' · ' : ''}${esc(targetText(s))}</span></div>
    <div class="story">${esc(s.summary)}</div>
  </div>`;
}

/* ── Lay a trail / Set a hide ─────────────────────────────────────── */
const rec = { on: false, kind: null, pts: [], wps: [], hides: [], started: 0, dropped: 0, wx: null, watch: null, lock: null, tick: 0 };
let pendingSession = null;   // built at Confirm, shared/run afterwards

function gpsHudText() {
  if (!rec.pts.length && rec.dropped) return accWarning();
  const m = pathLen(rec.pts);
  return `Recording · ${fmtDur(Date.now() - rec.started)} · ${fmtKm(m)}`;
}

/* Fixes arriving and every one of them rejected looks, from the outside,
   exactly like no GPS at all. Say which it is, and say the number that
   decides it — otherwise the phone is just "broken". */
const fmtAcc = (a) => fmtDist(a, imp());
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
  $('btnLayStart').hidden = t.kind === 'hide';
  $('btnLayStop').hidden = true;
  $('layDot').hidden = true;
  $('layHudText').textContent = t.kind === 'hide' ? 'Place each hide' : 'Ready';
  $('layCaption').textContent = t.kind === 'hide'
    ? 'Each hide is stamped with the time you place it'
    : 'Tap Start, then draw the line with your finger';
  go('scrLay');
  if (t.kind === 'hide') {
    map.getCanvas().style.cursor = 'crosshair';
    map.on('click', onHideTap);
    $('btnLayStop').textContent = 'Done';
  } else {
    $('btnLayStop').textContent = 'Stop';
  }
  // On the handler, and staying on them as the fix tightens.
  locateMe();
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

/* ── The plume, live ──────────────────────────────────────────────────
   Scent is the thing this app is about, and until now it only appeared once
   the run was over. Watching it leave the line as you walk is the whole
   lesson: which way it goes, how fast it spreads, how much of it there is.

   It is a MODEL, and it is drawn as one — a crowd of parcels whose edges are
   where the model stops being sure, never a hard-edged corridor. And it is
   drawn only when there is real weather to drive it: no weather, no plume,
   because a guessed plume is worse than none. */
const plume = { sim: null, tick: 0, T: FLAT, wx: null, st: null, trail: null, tAt: 0, tLen: 0, clock: null };

/* ── The ground under the trail ───────────────────────────────────────
   Woods, grass, crop, hard surface: read from the same map data the map is
   drawn from (ground.js has the rules, mvt.js reads the tiles). Two uses —
   metres per surface on the trail card and the result, and a plume drawn
   half as wide over hard ground. A handful of small tiles per trail, asked
   for once and kept for the session; with no signal nothing is saved and the
   next look at the trail asks again. Needs the Mapbox token: the plain map
   has no such data behind it. */
const TILESETS = { streets: 'mapbox.mapbox-streets-v8', terrain: 'mapbox.mapbox-terrain-v2' };
const groundTiles = new Map();          // 'kind/z/x/y' → Promise of a decoded tile
const SURF_V = 1;

function groundTile(kind, z, x, y) {
  const key = `${kind}/${z}/${x}/${y}`;
  if (groundTiles.has(key)) return groundTiles.get(key);
  const job = (async () => {
    const res = await fetch(`https://api.mapbox.com/v4/${TILESETS[kind]}/${z}/${x}/${y}.mvt?access_token=${settings.mbToken}`);
    if (!res.ok && res.status !== 404) throw new Error(`ground tile ${res.status}`);
    const t = res.ok ? decodeTile(new Uint8Array(await res.arrayBuffer()), z, x, y, GROUND_LAYERS[kind]) : {};
    t.kind = kind;
    t.box = tileBox(z, x, y);
    return t;
  })();
  groundTiles.set(key, job);
  job.catch(() => groundTiles.delete(key));            // a failed ask is asked again next time
  if (groundTiles.size > 60) groundTiles.delete(groundTiles.keys().next().value);
  return job;
}

async function groundFor(pts) {
  if (!settings.mbToken || !pts?.length) return null;
  const tiles = await Promise.all([
    ...tilesCovering(pts, tileOf).map(t => groundTile('streets', t.z, t.x, t.y)),
    ...tilesCovering(pts, tileOf, { zooms: [14, 13, 12] }).map(t => groundTile('terrain', t.z, t.x, t.y)),
  ]);
  return buildGround(tiles);
}

/* The letters belong to one exact trail. A walked card replaces the drawn
   line with a different one, and letters for the old line would then colour
   the wrong ground — so they carry the trail's fingerprint. */
const surfSig = (pts) => `${SURF_V}:${pts.length}:${pts[0].lat.toFixed(5)},${pts[0].lon.toFixed(5)}:${pts[pts.length - 1].lat.toFixed(5)},${pts[pts.length - 1].lon.toFixed(5)}`;
const surfValid = (s) => { const t = s?.data?.trail; return !!t && t.length > 1 && s.data.surfSig === surfSig(t) && s.data.surf?.length === t.length; };
/** The session's trail, with hard ground marked for the plume and the band. */
const trailOf = (s) => (surfValid(s) ? withSpread(s.data.trail, s.data.surf) : s.data.trail);

const surfBusy = new Map();             // session id → the ask in flight
function fillSurfaces(s) {
  const pts = s?.data?.trail;
  if (!pts || pts.length < 2 || !settings.mbToken || navigator.onLine === false) return Promise.resolve(null);
  if (surfValid(s)) return Promise.resolve(s);
  if (surfBusy.has(s.id)) return surfBusy.get(s.id);
  const job = (async () => {
    try {
      const ground = await groundFor(pts);
      if (!ground || s.data.trail !== pts) return null;              // the trail was replaced while we asked
      const { letters, metres } = surfaceAlong(ground, pts);
      Object.assign(s.data, { surf: letters, surfM: metres, surfSig: surfSig(pts) });   // whoever holds this session sees it
      const kept = db.sessions().find(x => x.id === s.id);
      if (kept && kept.data.trail?.length === pts.length) {
        db.updateSession(s.id, { data: { ...kept.data, surf: letters, surfM: metres, surfSig: surfSig(pts) } });
        snap();
      }
      return s;
    } catch { return null; }            // offline, or no room to save: the next look asks again
    finally { surfBusy.delete(s.id); }
  })();
  surfBusy.set(s.id, job);
  return job;
}

function groundHtml(s) {
  const rows = surfaceRows(s.data.surfM);
  if (!rows.length) return '';
  return `<span class="label">Ground</span>
    <div class="surf-bar" aria-hidden="true">${rows.map(r => `<i class="gs-${r.id}" style="flex:${r.share.toFixed(4)}"></i>`).join('')}</div>
    <div class="surf-rows">${rows.map(r =>
      `<div><i class="gs-${r.id}"></i><span>${esc(r.label)}</span><b>${fmtKm(r.metres)}</b><em>${Math.round(r.share * 100)}%</em></div>`).join('')}</div>
    <p class="body small muted">Read from the map, not from the ground: a track or a yard nobody drew is missed. Scent is drawn half as wide over hard surface.</p>`;
}
/** Show it if it is known; if not, ask, and fill the box in when the answer
    comes — provided the box is still showing the same trail. */
function paintGround(id, s) {
  const el = $(id);
  el.dataset.sid = s.id;
  el.innerHTML = surfValid(s) ? groundHtml(s) : '';
  el.hidden = !el.innerHTML;
  if (surfValid(s)) return;
  fillSurfaces(s).then(f => {
    if (!f || el.dataset.sid !== s.id) return;
    el.innerHTML = groundHtml(f);
    el.hidden = !el.innerHTML;
  });
}

/* While laying, each fix is read against the tile it stands in, so the live
   plume already narrows on tarmac. The tile is asked for once as the walker
   enters it; until it answers the ground counts as ordinary. */
const liveGround = { key: '', ground: null };
function liveSpread(pt) {
  if (!settings.mbToken) return 1;
  const t = tileOf(pt.lat, pt.lon, 15), key = `${t.x}/${t.y}`;
  if (key !== liveGround.key) {
    liveGround.key = key;
    groundFor([pt]).then(g => { if (liveGround.key === key) liveGround.ground = g; }).catch(() => {});
  }
  return liveGround.ground ? spreadOf(surfaceAt(liveGround.ground, pt)) : 1;
}

/* The ground the air is running over.

   flowAt already deflects wind around slopes, runs cold air downhill under a
   stable layer, and creeps the scent-carrying film downhill on ANY slope —
   but only if it is handed a real terrain grid. It was being handed FLAT
   everywhere except the first seconds of a lay, so all of that was switched
   off exactly where it matters.

   The grid is built around the trail so far, and rebuilt as the trail walks
   out of it — a 90 m margin around the first fix is no use 400 m later. */
async function plumeTerrain(force = false) {
  if (!plume.trail?.length) return;
  const len = pathLen(plume.trail);
  const stale = force || !plume.tAt
    || (Date.now() - plume.tAt > 45000 && len - plume.tLen > 120);
  if (!stale) return;
  plume.tAt = Date.now();
  plume.tLen = len;
  try {
    const T = await terrainFor(plume.trail);
    if (plume.sim) plume.T = T;
  } catch { /* flat is honest when the DEM will not answer */ }
}

function plumeStart(trail, wx, T) {
  plumeStop();
  if (!settings.plume || !wx) return;
  plume.sim = new ScentSim();
  /* Every few metres, not every GPS fix. A fix arrives when the walker moves,
     so at a slow pace the emission points stand far enough apart to read as
     separate puffs. Sampling the SAME line more finely does not change the
     physics — each parcel drifts by the same rules — it just stops the
     picture showing the sampling instead of the scent. */
  plume.sim.seed(plumeSamples(trail));
  plume.wx = wx;
  plume.T = T || FLAT;
  plume.st = stability(wx.soil_temp, wx.temp);
  plume.trail = trail ? [...trail] : [];
  plume.T = T || FLAT;
  plume.tAt = 0; plume.tLen = 0;
  plumeTerrain(true);
  airStart(wx, plume.T);
  showWeather(wx);
  /* 400 ms, not faster. The parcels move at wind speed — metres in a second
     — so redrawing them oftener buys nothing and costs a phone in a pocket.
     The tracers on top are what carry the motion. */
  plume.tick = setInterval(plumeFrame, 400);
  plumeFrame();
  tracersStart();
}
/** How finely the line is sampled for emission: a point every 3 m, and the
    whole thing re-walked a few times so the parcels at any one spot span the
    full range of ages rather than a handful of them. Capped, because a long
    trail must not turn the phone into a heater. */
function plumeSamples(trail) {
  if (!trail || trail.length < 2) return trail || [];
  const fine = densify(trail, 2);
  const passes = fine.length > 900 ? 2 : fine.length > 400 ? 3 : 5;
  const out = [];
  for (let i = 0; i < passes; i++) out.push(...fine);
  return out;
}

/** New ground, one fix at a time — append, never reseed, or it flickers. */
function plumeAdd(pt) {
  if (!plume.sim) return;
  const last = plume.trail[plume.trail.length - 1];
  plume.trail.push(pt);
  // Fill in the ground actually covered since the last fix, at the same
  // spacing the rest of the line was sampled at.
  plume.sim.append(last ? plumeSamples([last, pt]) : [pt]);
}
function plumeStop() {
  tracersStop();
  clearInterval(plume.tick); plume.tick = 0;
  plume.sim = null; plume.trail = null;
  setSrc('scent', EMPTY);
  setSrc('flow', EMPTY);
  setSrc('flowPulse', EMPTY);
  flow.arcs = [];
  setSrc('drift', EMPTY);
}
/* ── The wind, over the whole map ─────────────────────────────────────
   Separate from the plume on purpose. The plume is where the scent is; this
   is what the air is doing everywhere, including over ground the trail never
   touched — which is exactly what you want to know before you decide where
   to cast a dog.

   Each streak is a parcel pushed by flowAt, so with a terrain grid loaded it
   bends round slopes and runs downhill in cold still air, rather than every
   arrow on screen pointing the same way the forecast does. */
/* A streak is the path a parcel of air took over the last TAIL_SPAN seconds.
   Sampling it per frame made it 0.26 m long at a walking-pace wind — true,
   and invisible. Sampling every AIR_STEP seconds over AIR_TAIL samples gives
   a streak that is still exactly the real path, just long enough to read. */
/* Few, short and faint. This is the CONDITION the work is happening in, not
   the work: it has to be readable at a glance and then forgettable, or it
   competes with the plume for the one thing the screen is actually for. */
const AIR_N = 60, AIR_LIFE = 20, AIR_STEP = 0.35, AIR_TAIL = 14, AIR_FRAME_MS = 32;
const AIR_FULL_MS = 8;   // wind speed at which a wisp is at its longest and brightest
const WISP_FADE = [0.12, 0.32, 0.62, 1];   // tail to head
const air = { on: false, wx: null, st: null, T: FLAT, pts: [], raf: 0, last: 0 };

function airStart(wx, T) {
  if (!wx || !settings.plume) return airStop();
  air.wx = wx;
  air.st = stability(wx.soil_temp, wx.temp);
  if (T) air.T = T;
  if (air.on) return;
  air.on = true;
  air.pts = [];
  air.last = performance.now();
  air.raf = requestAnimationFrame(airFrame);
}
/* Say what is driving the picture, and what it is not.

   The streaks are not a measurement of the air in this field. They are a
   forecast model's 10 m open-ground wind for this place and time, bent by
   the app's own terrain model. A dog handler deciding where to cast is
   entitled to know which parts of that are data. */
/* ── The air, on screen ───────────────────────────────────────────────
   Wind direction, wind speed and temperature, on every map screen, because
   all three change what a dog can do and none of them are guessable from
   looking at a map.

   The arrow points where the air is GOING. A weather service reports the
   direction wind comes FROM, which is right on a chart and a trap on a map:
   a handler reads an arrow as "that way". */
/* The HUD pill sits in the top row beside the panel, so it needs the panel's
   measured width (CSS --wx-w) to know where its own left edge is. */
function wxGap() {
  const p = $('wxPanel');
  const on = p && !p.hidden;
  document.documentElement.style.setProperty('--wx-gap', on ? `${Math.round(p.offsetHeight) + 8}px` : '0px');
  document.documentElement.style.setProperty('--wx-w', on ? `${Math.round(p.offsetWidth)}px` : '0px');
}
let wxWatch = null;
function showWeather(wx) {
  const p = $('wxPanel');
  if (!p) return;
  // A late answer must not surface over a paper screen.
  if (!MAP_SCREENS.includes(currentScreen)) { p.hidden = true; $('wxRose').hidden = true; wxGap(); return; }
  p.hidden = false;
  $('wxRose').hidden = false;
  if (!wxWatch && 'ResizeObserver' in window) { wxWatch = new ResizeObserver(wxGap); wxWatch.observe(p); }
  if (!wx || wx.wind_speed == null) {
    /* The panel stays: the compass works without a forecast, and an empty
       corner says "broken" where "nothing yet" is the truth. */
    $('wxSpeed').textContent = '\u2014';
    $('wxDir').textContent = 'wind unknown';
    $('wxTemp').textContent = '';
    compass.wind = null; paintRose();
    $('wxNote').textContent = wxNow.asking ? 'Getting the forecast\u2026' : 'No forecast \u2014 tap to retry';
    wxGap(); return;
  }
  $('wxSpeed').textContent = fmtWind(wx.wind_speed);
  /* The arrow says where the air is GOING; the words say where it is coming
     FROM, which is how every forecast reports it. Both are on screen because
     either alone gets misread — an arrow with a bare "SSW" beside it is a
     handler guessing which of the two they are looking at. */
  $('wxDir').textContent = `from ${cardinal(wx.wind_direction)}`;
  $('wxTemp').textContent = fmtTemp(wx.temp, fahr());
  // The arrow points where the air is GOING, in the real world once the compass is live.
  compass.wind = Number.isFinite(wx.wind_direction) ? (wx.wind_direction + 180) % 360 : null;
  paintRose();
  $('wxNote').textContent = wx.time
    ? `10 m forecast, ${new Date(wx.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    : '10 m forecast';
  wxGap();
  /* The wind moves on every map screen once it is known, not only when a
     plume runs: laying a trail is exactly when you want to see it. */
  airStart(wx);
}
const hideWeather = () => { const p = $('wxPanel'); if (p) p.hidden = true; $('wxRose').hidden = true; wxGap(); };

/* ── The compass ──────────────────────────────────────────────────────
   The dial turns so N sits on true north where the handler stands, the
   figure in the middle is the way the top of the phone is pointing, and the
   blue marker rides the dial, so it shows where the air is going in the
   field, not on the screen.

   Where the heading comes from, best first:
   - inside the iPhone app, Core Location through the shell's own plugin. It
     starts by itself with the first map and needs nobody's permission again;
   - in a browser, the device-orientation events. An iPhone hands those out
     only after a permission asked for inside a tap, and forgets the answer
     at every launch — so the first tap anywhere on a map screen asks, as
     well as a tap on the compass itself.
   It runs only while a map is on screen and the app is in front: a compass
   chip left on in a pocket is battery for nothing. */
const compass = { heading: null, on: false, starting: false, stop: null, denied: false, granted: false, wind: null, ring: 0, arrow: 0, raf: 0 };

/** The nearest way round: 350° → 10° is a 20° turn, not 340°. */
const unwrapTo = (prev, target) => prev + ((((target - prev) % 360) + 540) % 360) - 180;

function paintRose() {
  const ring = $('wxRoseRing'), arrow = $('wxArrow'), rose = $('wxRose');
  if (!ring || !arrow || !rose) return;
  const live = compass.heading != null;
  compass.ring = unwrapTo(compass.ring, -(compass.heading ?? 0));
  ring.style.transform = `rotate(${compass.ring.toFixed(1)}deg)`;
  if (compass.wind != null) {
    compass.arrow = unwrapTo(compass.arrow, compass.wind);
    arrow.style.transform = `rotate(${compass.arrow.toFixed(1)}deg)`;
    arrow.style.opacity = '1';
  } else {
    arrow.style.opacity = '0';
  }
  rose.classList.toggle('live', live);
  const deg = live ? Math.round(((compass.heading % 360) + 360) % 360) % 360 : null;
  const degText = live ? `${deg}\u00B0` : '\u2014';
  if ($('wxDeg').textContent !== degText) $('wxDeg').textContent = degText;
  /* Not live in a browser means nobody has been asked yet: say what to do. */
  const word = live ? cardinal(deg) : (compass.on || compass.starting ? '' : 'TAP');
  if ($('wxCard').textContent !== word) $('wxCard').textContent = word;
  rose.setAttribute('aria-label', live ? `Compass. Heading ${deg} degrees, ${cardinal(deg)}.` : 'Compass. Tap to start it.');
}

function onHeading(h) {
  compass.heading = smoothBearing(compass.heading, h, 0.35);
  if (!compass.raf) compass.raf = requestAnimationFrame(() => { compass.raf = 0; paintRose(); });
}
function onOrientation(e) {
  let h = null;
  if (Number.isFinite(e.webkitCompassHeading)) h = e.webkitCompassHeading;      // iPhone: clockwise from north
  else if (e.absolute && Number.isFinite(e.alpha)) h = (360 - e.alpha) % 360;   // Android: alpha runs the other way
  if (h != null) onHeading(h);
}

/** @param gesture  called from inside a tap — the only time an iPhone browser may be asked
    @param loud     say so when the answer is no (a tap on the compass itself) */
async function headingStart({ gesture = false, loud = false } = {}) {
  if (compass.on || compass.starting) return;
  compass.starting = true;
  try {
    const stop = await watchHeading(onHeading);
    if (stop) { compass.stop = stop; compass.on = true; return; }

    const DOE = window.DeviceOrientationEvent;
    if (!DOE) { if (loud) toast('This device has no compass the browser can read'); return; }
    /* Once it has said yes, a browser keeps saying yes until the page goes —
       so coming back from the background needs no second tap. */
    if (typeof DOE.requestPermission === 'function' && !compass.granted) {
      if (!gesture || (compass.denied && !loud)) return;      // cannot ask now, or already told no
      let answer = 'denied';
      try { answer = await DOE.requestPermission(); } catch { /* asked outside a tap */ }
      if (answer !== 'granted') {
        compass.denied = true;
        if (loud) toast('The compass needs motion access \u2014 allow it when the phone asks');
        return;
      }
      compass.granted = true;
    }
    window.addEventListener('deviceorientationabsolute', onOrientation);
    window.addEventListener('deviceorientation', onOrientation);
    compass.stop = () => {
      window.removeEventListener('deviceorientationabsolute', onOrientation);
      window.removeEventListener('deviceorientation', onOrientation);
    };
    compass.on = true;
  } finally {
    compass.starting = false;
    paintRose();
  }
}

function headingStop() {
  if (!compass.on) return;
  try { compass.stop?.(); } catch { /* it is going anyway */ }
  compass.stop = null;
  compass.on = false;
  compass.heading = null;          // a dial frozen on the last heading would be a lie the moment the phone turns
  paintRose();
}

/* "At all times on the map" means the panel cannot wait for a session to
   carry weather with it — drawing a line, or just looking around, has no
   session yet. So the app keeps one reading for where it currently is and
   refreshes it every quarter hour, which is far finer than a forecast
   actually changes. A session's own weather still wins where there is one:
   looking at a trail from last week should show last week's air. */
const wxNow = { at: 0, wx: null, asking: false };

async function weatherHere(hint = null) {
  if (wxNow.wx && Date.now() - wxNow.at < 15 * 60000) return wxNow.wx;
  if (wxNow.asking) return wxNow.wx;
  wxNow.asking = true;
  try {
    /* Where "here" is, cheapest first: a fix the app already holds, then
       the trail's own start, and only then a fresh ask of the browser —
       which inside the iPhone shell is the one that can be refused. */
    let at = lastFix && Date.now() - lastFix.t < 5 * 60000 ? lastFix : hint;
    if (!at) {
      const pos = await new Promise((res, rej) => navigator.geolocation
        ? navigator.geolocation.getCurrentPosition(res, rej,
            { enableHighAccuracy: false, maximumAge: 300000, timeout: 12000 })
        : rej(new Error('no gps')));
      at = { lat: pos.coords.latitude, lon: pos.coords.longitude };
    }
    const wx = await fetchWeather(at.lat, at.lon, Date.now());
    wxNow.wx = wx; wxNow.at = Date.now();
    return wx;
  } catch { return wxNow.wx; }          // offline or blocked: the panel stays away
  finally { wxNow.asking = false; }
}

/** Show whatever is most true for this screen: the session's air if it has
    any, otherwise the air here now. */
function weatherPanelFor(session) {
  const own = session?.data?.weather;
  if (own) return showWeather(own);
  const d = session?.data;
  const t = d?.trail?.[0] ?? d?.plan?.[0] ?? d?.track?.[0];
  const asked = weatherHere(t ? { lat: t.lat, lon: t.lon } : null);   // marks itself as asking at once
  showWeather(wxNow.wx);                     // the panel now; the numbers follow
  asked.then(wx => showWeather(wx));
}

function airStop() {
  air.on = false;
  cancelAnimationFrame(air.raf); air.raf = 0;
  air.pts = [];
  setSrc('air', EMPTY);
}

/** Somewhere on SCREEN, at a random point in its life so the field is full
    on the first frame instead of arriving as one wave.

    Screen space, not a lat/lon box: the map is pitched, so its bounding box
    reaches to the horizon and scattering parcels across it put almost all of
    them kilometres away, leaving a handful of streaks on an empty view. */
function airSpawn(fresh = false) {
  const c = map.getCanvas();
  const ll = map.unproject([Math.random() * c.clientWidth, Math.random() * c.clientHeight]);
  return {
    lat: ll.lat, lon: ll.lng,
    age: fresh ? 0 : Math.random() * AIR_LIFE,
    tail: [], since: 0,
  };
}

function airFrame(now) {
  if (!air.on || !map) return;
  // A fixed pace, not every frame: smoother on a phone and kinder to it.
  if (now - air.last < AIR_FRAME_MS) { air.raf = requestAnimationFrame(airFrame); return; }
  const dt = Math.min(0.1, (now - air.last) / 1000);
  air.last = now;
  const c = map.getCanvas();
  const W = c.clientWidth, H = c.clientHeight;
  const inView = (p) => {
    const q = map.project([p.lon, p.lat]);
    return q.x > -60 && q.x < W + 60 && q.y > -60 && q.y < H + 60;
  };

  while (air.pts.length < AIR_N) air.pts.push(airSpawn());

  /* True pace when zoomed in. Zoomed out, a real breeze crosses a pixel or two
     a second and the wisps shrink to specks, so the clock runs faster there:
     the direction and the bending round the ground stay the model's, the
     speed on screen stays readable. */
  const mpp = 78271.517 * Math.cos(map.getCenter().lat * Math.PI / 180) / 2 ** map.getZoom();
  const pace = Math.max(1, mpp / 0.35);

  const feats = [];
  for (const p of air.pts) {
    p.age += dt;
    if (p.age > AIR_LIFE || !inView(p)) { Object.assign(p, airSpawn(true)); continue; }

    const n = normOf(air.T, p.lat, p.lon);
    const f = flowAt(air.T, n.x, n.y, air.wx, air.st);
    /* Through the same mover the scent uses, at the full flow rate — the air
       itself is not held back by the ground the way scent at nose height is.
       Doing this arithmetic here by hand is what had the streaks running
       north while the plume ran south. */
    const next = stepByFlow(p, f, dt * pace, 1);
    p.lat = next.lat; p.lon = next.lon;
    p.w = Math.min(1, Math.hypot(f.u, f.v) / AIR_FULL_MS);   // how hard it blows here, 0..1

    p.since += dt;
    if (p.since >= AIR_STEP || !p.tail.length) {
      p.since = 0;
      p.tail.push([p.lon, p.lat]);
      if (p.tail.length > AIR_TAIL) p.tail.shift();
    }
    if (p.tail.length < 2) continue;

    // Fade in as it appears and out as it goes, so nothing pops.
    /* Four pieces from tail to head, each stronger than the last: that is the
       fade. The head is where the parcel is NOW, not at the last sample. */
    const t = p.age / AIR_LIFE;
    const base = Math.min(1, Math.min(t * 5, (1 - t) * 4)) * (0.55 + 0.45 * (p.w ?? 0.5));
    const line = [...p.tail, [p.lon, p.lat]];
    const spans = line.length - 1;
    const cuts = [0, Math.floor(spans * 0.4), Math.floor(spans * 0.7), Math.floor(spans * 0.88), spans];
    for (let s = 0; s < 4; s++) {
      if (cuts[s + 1] <= cuts[s]) continue;
      feats.push({
        type: 'Feature',
        properties: { a: base * WISP_FADE[s] },
        geometry: { type: 'LineString', coordinates: line.slice(cuts[s], cuts[s + 1] + 1) },
      });
    }
  }
  setSrc('air', { type: 'FeatureCollection', features: feats });
  air.raf = requestAnimationFrame(airFrame);
}

/* ── The scent bench ──────────────────────────────────────────────────
   The model as an instrument: a trail on the map, and every number the model
   runs on as a dial underneath. It exists because an audit found the model
   carried about ninety numbers, almost none of them measured, and no way for
   anyone to see which was which or what each one did.

   So the sheet is drawn FROM the registry (params.js), not written out by
   hand. A dial that exists in the model appears here; one that does not,
   does not. And every dial wears where it came from, because forty sliders
   with no provenance would read as "configurable, therefore right".

   Two redraw tiers. The particle cloud recomputes on its own 400 ms tick and
   picks up most dials for free. The BAND does not — it is drawn once per
   session render — so anything touching the band needs an explicit repaint,
   or a live dial looks dead, which is worse than no dial. */
const bench = { on: false, trail: null, wx: null, open: false };

/** A demo trail: a dog-leg on open ground near wherever the map is looking,
    so the wind can be turned against it and the band watched swinging. */
function benchTrail(centre) {
  const legs = [[20, 170], [70, 150], [95, 120], [60, 190]];   // bearing, metres
  const pts = [{ lat: centre.lat, lon: centre.lon }];
  for (const [brg, m] of legs) {
    const step = 4;
    for (let d = step; d <= m; d += step) pts.push(project(pts[pts.length - 1], brg, step));
  }
  return pts;
}

/** The weather the bench is asking about, built from the dials rather than a
    forecast. Same shape the rest of the model expects. */
function benchWx() {
  return {
    wind_speed: PV.wind, wind_direction: PV.dir, wind_gusts: Math.max(PV.wind, PV.gust),
    temp: PV.air, soil_temp: PV.soil, humidity: PV.hum, precipitation: PV.rain,
    dew_point: PV.air - 2, time: null,
  };
}

/** Stamp the trail's clock so "trail age" means what the dial says, and the
    last point carries the dwell so the end pool is the size it claims. */
function benchStamp() {
  const now = Date.now();
  const ageMs = PV.age * 60000;
  const n = bench.trail.length;
  bench.trail.forEach((p, i) => { p.t = now - ageMs + (i / Math.max(1, n - 1)) * Math.min(ageMs, n * 900); });
  bench.trail[n - 1].dwellS = PV.dwell * 60;
  return bench.trail;
}

function benchPaint() {
  if (!bench.on || !bench.trail) return;
  const trail = benchStamp();
  const wx = benchWx();
  bench.wx = wx;
  const st = stability(wx.soil_temp, wx.temp);

  setTrail(trail);
  setSrc('start', pointsOf([trail[0]]));

  /* Tier two: the band is not on the plume tick, so it is repainted here on
     every change. Without this the geo dials would look inert while being
     perfectly alive. */
  const field = scentField(trail, wx, Date.now());
  setSrc('drift', field.length ? plumePolygon(field) : EMPTY);

  plumeStart(trail, wx, plume.T);
  showWeather(wx);

  benchReadout(st, field, trail, Math.round(scentLifeOf(wx, st)));
}

/** Which side of the line the band sits on, by majority along the trail. The
    side is the only thing this model says that could turn out to be wrong,
    so it belongs in the readout beside the metres. */
function benchSide(field) {
  let n = 0;
  for (const f of field) n += f.regime.cross > 0.15 ? 1 : f.regime.cross < -0.15 ? -1 : 0;
  return n > field.length * 0.15 ? 'right' : n < -field.length * 0.15 ? 'left' : null;
}

/** The full line at the width it needs, and one word in the pill. The pill
    sits in a narrow column between the weather box and the compass, so a
    whole sentence in it wraps to six lines and covers the map. */
function benchReadout(st, field, trail, life) {
  const i = Math.floor(field.length / 2);
  const off = field.length ? dist(trail[i], field[i].centre) : 0;
  const w = field.length ? field[i].halfWidth : 0;
  const side = benchSide(field);
  $('benchHudText').textContent = st.label;
  $('benchRead').innerHTML = `${side ? `<b>${side}</b> of the line \u00b7 ` : 'no side \u00b7 '}` +
    `<b>${off.toFixed(0)} m</b> off the line · <b>±${w.toFixed(0)} m</b> wide · workable <b>${life} min</b>`;
}

/* scentLife is not exported under that name here; field.js owns it and the
   plume already uses it, so ask it the same way the plume does. */
const scentLifeOf = (wx, st) => {
  const hum = wx?.humidity ?? 70, wind = wx?.wind_speed ?? 0, rain = wx?.precipitation ?? 0, soil = wx?.soil_temp;
  const fHum = PV.humA + hum / PV.humB;
  const fWind = 1 / (1 + wind / PV.windHalf);
  const fHot = soil == null ? 1 : 1 / (1 + Math.max(0, soil - PV.hotKnee) / PV.hotScale);
  const fRain = rain <= 0 ? 1 : rain < PV.rainDrizzle ? PV.rainBoost : 1 / (1 + (rain - PV.rainDrizzle) * PV.rainDecay);
  return Math.max(PV.lifeFloor, PV.lifeBase * fHum * fWind * fHot * fRain * (st?.life ?? 1));
};

const BADGE = { input: 'measured', yours: 'yours', guess: 'guess', drawing: 'drawing only' };

function dialHtml(d) {
  const v = PV[d.id];
  const moved = v !== d.def;
  return `<div class="dial${moved ? ' moved' : ''}" data-dial="${d.id}">
    <div class="top"><span class="nm">${esc(d.label)}</span>
      <span class="badge ${d.prov}">${BADGE[d.prov]}</span>
      <span class="val" data-val="${d.id}">${fmtDial(d, v)}</span></div>
    <input type="range" min="${d.min}" max="${d.max}" step="${d.step}" value="${v}" data-set="${d.id}" aria-label="${esc(d.label)}">
    <p class="note">Moves ${esc(d.moves)}.${d.note ? ' ' + esc(d.note) : ''}</p>
  </div>`;
}
const fmtDial = (d, v) => `${Number(v).toFixed(d.step < 0.05 ? 3 : d.step < 1 ? 2 : 0)}${d.unit ? ' ' + d.unit : ''}`;

function paintBench() {
  const t = tally();
  $('benchTally').textContent = `${t.input} measured · ${t.yours} yours · ${t.guess} guessed`;
  $('benchBody').innerHTML = PARAMS.map((g, i) => {
    const n = g.dials.filter(d => PV[d.id] !== d.def).length;
    return `<details class="bench-grp${g.kind === 'drawing' ? ' draw' : ''}"${i === 0 ? ' open' : ''}>
      <summary><b>${esc(g.title)}</b><span class="cnt">${g.dials.length} dials${n ? ` · ${n} moved` : ''}</span></summary>
      <p class="why">${esc(g.why)}${g.id === 'flow' && plume.T?.flat
        ? ' <b style="color:#F1C77A">Flat here \u2014 nothing in this group bites until the map has elevation for this spot.</b>' : ''}</p>
      ${g.dials.map(dialHtml).join('')}
    </details>`;
  }).join('');
}

/** Everything except reseeding the cloud: the band, the weather the plume is
    running against, and the readout. Safe to call on every frame of a drag. */
function benchPaintLight() {
  if (!bench.on || !bench.trail) return;
  const wx = benchWx();
  bench.wx = wx;
  plume.wx = wx;
  plume.st = stability(wx.soil_temp, wx.temp);
  const st = plume.st;
  const field = scentField(bench.trail, wx, Date.now());
  setSrc('drift', field.length ? plumePolygon(field) : EMPTY);
  paintFlow();
  airStart(wx, plume.T);
  showWeather(wx);
  benchReadout(st, field, bench.trail, Math.round(scentLifeOf(wx, st)));
}

function openBench() {
  bench.on = true;
  clearMap();
  const c = map.getCenter();
  bench.trail = benchTrail({ lat: c.lat, lon: c.lng });
  paintBench();
  go('scrBench');
  fitTo(bench.trail, []);
  benchPaint();
}
function closeBench() {
  bench.on = false;
  bench.trail = null;
  /* The dials do NOT follow you out. predictedOffsets reads the same live
     values the bench drives, so a run graded after a session on the bench
     would carry whatever was left set, be banked into the dog's
     calibration, and be saved with no record of it. A bench is for asking
     questions; nothing it does may reach a real record. */
  if (!isDefault()) toast('Dials back to defaults \u2014 the bench never changes a real run');
  resetParams();
  plumeStop();
  clearMap();
}

/* ── Replay ───────────────────────────────────────────────────────────
   The run again, against the scent as it was AT THAT MOMENT — not as it is
   now. That distinction is the whole value of the screen: a handler watching
   the dog swing wide at four minutes wants to see the plume that was
   actually there at four minutes, not the one that has since drifted another
   forty metres downwind.

   The engine has always been able to answer this. ScentSim.advance() takes
   the clock as an argument, and the comment above it has said "the replay
   clock, not the real one" since it was written. Nothing had ever passed it
   one. Here that argument finally gets used: plume.clock overrides
   Date.now(), and scrubbing is simply setting it. */
const replay = { s: null, from: 0, to: 0, at: 0, playing: false, speed: 4, raf: 0, last: 0 };
const REPLAY_SPEEDS = [1, 4, 10, 30];

function openReplay(s) {
  const track = s?.data?.track;
  if (!(track?.length > 1)) return toast('No run recorded on this one');
  replay.s = s;
  replay.from = track[0].t;
  replay.to = track[track.length - 1].t;
  replay.at = replay.to;
  replay.speed = 4;
  replayPause();

  clearMap();
  setTrail(trailOf(s));
  setSrc('start', pointsOf([s.data.trail[0]]));
  if (s.data.planTrail?.length > 1) setSrc('plan', lineOf(s.data.planTrail));
  if (s.data.weather) plumeStart(trailOf(s), s.data.weather, plume.T);
  $('repSpeed').textContent = `${replay.speed}×`;

  go('scrReplay');
  fitTo(s.data.trail || [], track, s.data.planTrail || []);
  paintReplay();
}

function closeReplay() {
  replayPause();
  replay.s = null;
  plume.clock = null;          // hand the plume back to the real clock
  plumeStop();
  clearMap();
}

/** Everything as it stood at `replay.at`. */
function paintReplay() {
  const s = replay.s;
  if (!s) return;
  const at = replay.at;
  const track = s.data.track;

  // The dog's track, only as far as it had got by then.
  let i = 0;
  while (i < track.length && track[i].t <= at) i++;
  const sofar = track.slice(0, Math.max(2, i));
  setDogTrack(sofar);
  setSrc('nose', pointsOf([sofar[sofar.length - 1]]));

  // Marks appear when they were pressed, not before.
  setSrc('wps', pointsOf((s.data.trackWaypoints || []).filter(w => w.t <= at), 'kind'));

  /* The scent as it was. plumeFrame reads plume.clock, so setting it and
     painting one frame shows that instant instead of this one. */
  if (plume.sim) { plume.clock = at; plumeFrame(); }
  if (s.data.weather) {
    const field = scentField(trailOf(s), s.data.weather, at);
    setSrc('drift', field.length ? plumePolygon(field) : EMPTY);
  }

  const el = Math.max(0, Math.round((at - replay.from) / 1000));
  const ageMin = Math.max(0, Math.round((at - s.startedAt) / 60000));
  const here = sofar[sofar.length - 1];
  const off = s.data.trail?.length > 1
    ? signedOffsets(s.data.trail, [here]).filter(Number.isFinite)[0] : null;
  $('repHudText').textContent = `${Math.floor(el / 60)}:${String(el % 60).padStart(2, '0')}`;
  $('repCaption').textContent = `Trail ${ageMin} min old here`
    + (off == null ? '' : ` · dog ${fmtM(Math.abs(off))} ${off >= 0 ? 'right' : 'left'} of the line`);
  const f = replay.to > replay.from ? (at - replay.from) / (replay.to - replay.from) : 1;
  const sc = $('repScrub');
  if (document.activeElement !== sc) sc.value = String(Math.round(f * 1000));
}

function replayPlay() {
  if (replay.playing || !replay.s) return;
  if (replay.at >= replay.to) replay.at = replay.from;      // at the end, start again
  replay.playing = true;
  replay.last = performance.now();
  $('repPlay').innerHTML = '&#10073;&#10073;';
  $('repPlay').setAttribute('aria-label', 'Pause');
  const step = (now) => {
    if (!replay.playing) return;
    const dt = Math.min(500, now - replay.last);      // a backgrounded tab must not leap
    replay.last = now;
    replay.at = Math.min(replay.to, replay.at + dt * replay.speed);
    paintReplay();
    if (replay.at >= replay.to) return replayPause();
    replay.raf = requestAnimationFrame(step);
  };
  replay.raf = requestAnimationFrame(step);
}

function replayPause() {
  replay.playing = false;
  cancelAnimationFrame(replay.raf);
  replay.raf = 0;
  const b = $('repPlay');
  if (b) { b.innerHTML = '&#9654;'; b.setAttribute('aria-label', 'Play'); }
}

/* ── Wind tracers ─────────────────────────────────────────────────────
   Few enough to move every frame, which is the whole point of them: the
   heatmap can only be redrawn a few times a second, and a plume that never
   visibly moves reads as a stain rather than as air.

   They run at REAL time. Speeding them up would make a 4 km/h breeze look
   like a gale, and the one thing this app must not do is dress its own
   numbers up as something livelier than they are. */
const TRACERS = 160;
const windDots = { list: [], raf: 0, last: 0 };

function tracersStart() {
  tracersStop();
  if (!plume.sim || !plume.wx || !plume.trail?.length) return;
  windDots.last = performance.now();
  windDots.raf = requestAnimationFrame(tracerFrame);
}
function tracersStop() {
  cancelAnimationFrame(windDots.raf);
  windDots.raf = 0;
  windDots.list = [];
  setSrc('wind', EMPTY);
}
/** A parcel lifting off a random piece of the line, at a random point in its
    airborne life — so the stream is continuous from the first frame instead
    of arriving as one pulse. */
function tracerSpawn(fresh = false) {
  const line = plume.trail;
  const g = line[Math.floor(Math.random() * line.length)];
  return { glat: g.lat, glon: g.lon, age: fresh ? 0 : Math.random() * PV.airborne };
}
function tracerFrame(now) {
  if (!plume.sim || !plume.trail?.length) return tracersStop();
  const dt = Math.min(0.5, (now - windDots.last) / 1000);
  windDots.last = now;
  while (windDots.list.length < TRACERS) windDots.list.push(tracerSpawn());

  const feats = [];
  for (const p of windDots.list) {
    p.age += dt;
    if (p.age >= PV.airborne) Object.assign(p, tracerSpawn(true));
    const d = driftFrom(plume.T, { lat: p.glat, lon: p.glon }, p.age, plume.wx, plume.st, 3);
    feats.push({
      type: 'Feature',
      // Brightest as it leaves the ground, gone by the time it has spread.
      properties: { a: Math.max(0, 1 - p.age / PV.airborne) ** 1.4 },
      geometry: { type: 'Point', coordinates: [d.lon, d.lat] },
    });
  }
  setSrc('wind', { type: 'FeatureCollection', features: feats });
  if (now - flow.last >= 32) { flow.last = now; paintFlowPulse(now); }
  windDots.raf = requestAnimationFrame(tracerFrame);
}

/** How much scent a parcel represents where it now sits.

    Strength alone is not enough, because it says how much scent is left, not
    how thinly it is spread. A plume WIDENS as it travels: the same scent
    occupies more and more air, so concentration falls with distance from the
    ground it came off even while the parcel is still "strong".

    Without this the picture comes out backwards. Drift saturates with time,
    so parcels bunch up at the far edge of their travel, and a density plot
    reads that pile-up as the hottest part of the plume — putting the brightest
    air at the outer boundary, which is the opposite of how scent behaves.

    Dividing by the spread puts it back the right way round: burning against
    the line, fading out as it goes. */
function parcelWeight(s) {
  const d = dist({ lat: s.hlat, lon: s.hlon }, { lat: s.lat, lon: s.lon });
  return Math.min(1, s.str / (1 + d / 22));
}

/* ── Flow arrows ──────────────────────────────────────────────────────
   A handful of arrows traced through the very drift the parcels are
   following, so they show what the air is doing HERE — bending with the
   ground, and only half as far over hard surface — rather than repeating
   the forecast's one wind direction.

   Drawn in screen pixels and built in metres: the map only fills shapes on
   the ground, so each repaint asks how many metres a pixel is worth at this
   zoom and sizes the brush to suit. Pinching stretches them with the map
   for a moment, and the next repaint (a fraction of a second) sets them
   right again. */
const FLOW_SAMPLES = 16;
const FLOW_STROKES = [0, 0.3, 0.55, 0.76];      // where each layer of the brush stroke begins
const flow = { arcs: [], mpp: 1, last: 0 };

const metresPerPixel = (lat) => (78271.517 * Math.cos((lat * Math.PI) / 180)) / 2 ** map.getZoom();
const smooth = (x) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };

/** A point and heading at share `t` (0…1) of an arc's length. */
function alongArc(arc, t) {
  const want = Math.max(0, Math.min(1, t)) * arc.len;
  let i = 1;
  while (i < arc.cum.length - 1 && arc.cum[i] < want) i++;
  const a = arc.pts[i - 1], b = arc.pts[i], seg = arc.cum[i] - arc.cum[i - 1] || 1;
  const f = (want - arc.cum[i - 1]) / seg;
  return { lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f, brg: arc.brg[i - 1] + shortTurn(arc.brg[i - 1], arc.brg[Math.min(i, arc.brg.length - 1)]) * f };
}
const shortTurn = (from, to) => ((((to - from) % 360) + 540) % 360) - 180;

/** The brush: a hair where it leaves the trail, full width where the head sits. */
const flowWidth = (arc, t) => arc.px * (1.5 + 5.2 * t ** 1.25);

/** One filled shape from `t0` to `t1` along an arc. `width(t)` is in pixels.
    With `head`, it ends in a swept arrowhead instead of a point. */
function flowShape(arc, t0, t1, width, head) {
  const left = [], right = [];
  const n = Math.max(4, Math.round((t1 - t0) * FLOW_SAMPLES));
  for (let k = 0; k <= n; k++) {
    const t = t0 + ((t1 - t0) * k) / n;
    const c = alongArc(arc, t), half = (width(t) * flow.mpp) / 2;
    const l = project(c, (c.brg + 270) % 360, half), r = project(c, (c.brg + 90) % 360, half);
    left.push([l.lon, l.lat]); right.push([r.lon, r.lat]);
  }
  let cap = [];
  if (head) {
    const e = alongArc(arc, 1), u = arc.px * flow.mpp;
    const at = (fwd, side) => { const q = project(project(e, e.brg, fwd * u), (e.brg + 90) % 360, side * u); return [q.lon, q.lat]; };
    // Barbs swept back behind the shoulder and a long fine tip: a drawn arrow, not a triangle.
    cap = [at(-5.5, -9.6), at(17.5, 0), at(-5.5, 9.6)];
  }
  const ring = [...left, ...cap, ...right.reverse()];
  ring.push(ring[0]);
  return { type: 'Polygon', coordinates: [ring] };
}

function paintFlow() {
  const line = plume.trail;
  if (!line || line.length < 2 || !plume.wx) { setSrc('flow', EMPTY); setSrc('flowPulse', EMPTY); flow.arcs = []; return; }
  flow.mpp = metresPerPixel(line[0].lat);
  const N = Math.max(2, Math.min(6, Math.round(pathLen(line) / 140)));
  const arcs = [];
  for (let a = 0; a < N; a++) {
    const seed = line[Math.floor(((a + 0.5) / N) * (line.length - 1))];
    if (!seed) continue;
    const reach = PV.airborne * 0.55 * (seed.spread ?? 1);     // hard ground carries it half as far
    const pts = [];
    for (let k = 0; k <= FLOW_SAMPLES; k++) {
      pts.push(driftFrom(plume.T, seed, (k / FLOW_SAMPLES) * reach, plume.wx, plume.st, 3));
    }
    const cum = [0];
    for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + dist(pts[k - 1], pts[k]));
    const len = cum[cum.length - 1], lenPx = len / flow.mpp;
    /* Still air, or the whole trail a thumbnail: an arrow too short to have
       a shaft is a blot, and says nothing the plume does not. */
    if (!(lenPx > 34)) continue;
    const brg = pts.slice(1).map((q, k) => bearing(pts[k], q));
    // Longer arrows get a bolder brush, within reason, so they never look like wire.
    arcs.push({ pts, cum, len, brg, px: Math.max(0.85, Math.min(1.7, lenPx / 150)), i: a });
  }
  flow.arcs = arcs;
  const feats = [];
  for (const arc of arcs) {
    for (const t0 of FLOW_STROKES) {
      // Each stroke opens from a point over the first fifth of its own length, inside the same outline.
      const width = (t) => flowWidth(arc, t) * smooth((t - t0) / 0.2 + (t0 === 0 ? 0.25 : 0));
      feats.push({ type: 'Feature', properties: {}, geometry: flowShape(arc, t0, 1, width, true) });
    }
  }
  setSrc('flow', { type: 'FeatureCollection', features: feats });
  if (!windDots.raf) paintFlowPulse(performance.now());     // no animation loop running: still show them lit once
}

/** The light along each arrow. One pass takes longer in a breeze than in a
    wind, the arrows take turns rather than blinking together, and the head
    catches the light as it arrives. */
function paintFlowPulse(now) {
  if (!flow.arcs.length) { setSrc('flowPulse', EMPTY); return; }
  const U = plume.wx?.wind_speed ?? 0;
  const period = Math.max(1.6, Math.min(4.2, 9 / Math.max(1, U)));      // seconds, tail to head
  const feats = [];
  for (const arc of flow.arcs) {
    const ph = ((now / 1000 / period) + arc.i * 0.37) % 1.5;              // the last third is rest
    if (ph < 1) {
      const c = ph, L = 0.2;                                             // a lens a fifth of the arrow long
      const t0 = Math.max(0, c - L), t1 = Math.min(1, c + L * 0.4);
      if (t1 - t0 > 0.03) {
        const width = (t) => flowWidth(arc, t) * 0.78 * Math.sin(Math.PI * Math.max(0, Math.min(1, (t - t0) / (t1 - t0)))) ** 0.7;
        feats.push({ type: 'Feature', properties: { o: 0.9 * Math.sin(Math.PI * Math.min(1, ph * 1.05)) ** 0.6 },
          geometry: flowShape(arc, t0, t1, width, false) });
      }
    }
    const glow = Math.max(0, 1 - Math.abs(ph - 1.02) / 0.22);             // peaks as the light reaches the head
    if (glow > 0.02) {
      feats.push({ type: 'Feature', properties: { o: 0.75 * glow },
        geometry: flowShape(arc, 0.9, 1, (t) => flowWidth(arc, t), true) });
    }
  }
  setSrc('flowPulse', { type: 'FeatureCollection', features: feats });
}

function plumeFrame() {
  if (!plume.sim) return;
  const now = plume.clock ?? Date.now();
  plume.sim.prune(now, plume.wx, plume.st, { max: 9000 });
  plume.sim.advance(plume.T, plume.wx, plume.st, now);
  const live = plume.sim.drawable().filter(s => s.str >= 0.03);
  setSrc('scent', { type: 'FeatureCollection', features: live.map(s => ({
    type: 'Feature',
    properties: { s: parcelWeight(s) },
    geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
  })) });
  paintFlow();
  plumeTerrain();
  air.T = plume.T;
}

/* ── Following ────────────────────────────────────────────────────────
   Course-up, tilted, moving with you: the view a person expects when they
   are walking somewhere, not the north-up chart they expect when planning.
   It yields the moment the map is touched — looking around is not a bug —
   and the re-centre button takes it back. */
const nav = { follow: false, brg: null, onRoute: null, courseUp: false };

/* Course-up ONLY when following a route. On a dog run the map stays
   north-up: this app tells you the wind pushed scent to the RIGHT of the
   line, and a map that quietly rotates makes that sentence a puzzle. */
function startFollowing(routePts, { courseUp = false } = {}) {
  nav.follow = true;
  nav.brg = null;
  nav.onRoute = routePts || null;
  nav.courseUp = courseUp;
  $('btnRecentre').classList.remove('nudge');
  if (courseUp) map.dragRotate?.disable?.();
}
function stopFollowing() {
  nav.follow = false;
  nav.onRoute = null;
  nav.courseUp = false;
  $('btnRecentre').classList.remove('nudge');
  map.dragRotate?.enable?.();
  map.easeTo({ bearing: 0, pitch: 55, duration: 400 });
  setSrc('puck', EMPTY);
  setSrc('routeDone', EMPTY);
  setSrc('routeAhead', EMPTY);
}
/** A drag means they want to look; stop chasing them around the screen. */
function releaseFollow() {
  if (!nav.follow) return;
  nav.follow = false;
  $('btnRecentre').classList.add('nudge');
}
function recentre() {
  nav.follow = true;
  $('btnRecentre').classList.remove('nudge');
  const last = rec.pts[rec.pts.length - 1];
  if (last) map.easeTo({ center: [last.lon, last.lat], zoom: 17.5, pitch: 62,
                         bearing: nav.courseUp ? (nav.brg ?? map.getBearing()) : map.getBearing(),
                         duration: 600 });
}
/* The GPS button, top right of every map screen. While something is being
   recorded it brings the camera back onto you and keeps it there; the rest
   of the time it finds you from cold. */
function locateTap() {
  if (rec.on) {
    if (rec.pts.length) return recentre();
    return toast('No fix yet \u2014 open sky helps');
  }
  locateMe({ zoom: 17.5 });
}

/** Paint you onto the map, and the route as walked-behind / bright-ahead. */
function paintNav() {
  const last = rec.pts[rec.pts.length - 1];
  if (!last) return;
  const prev = rec.pts.length > 1 ? rec.pts[rec.pts.length - 2] : null;
  const raw = prev && dist(prev, last) > 1.5 ? bearing(prev, last) : null;
  nav.brg = smoothBearing(nav.brg, raw ?? nav.brg);

  paintMe(last.lat, last.lon, last.acc, nav.brg ?? 0);

  if (nav.onRoute) {
    const [done, ahead] = splitLine(nav.onRoute, last);
    setSrc('routeDone', lineOf(done));
    setSrc('routeAhead', lineOf(ahead));
  }
  if (nav.follow) {
    const cam = { center: [last.lon, last.lat], zoom: 17.5, pitch: 62, duration: 900, essential: true };
    if (nav.courseUp && nav.brg != null) cam.bearing = nav.brg;
    map.easeTo(cam);
  }
}

function onFix(pos) {
  const { latitude: lat, longitude: lon, accuracy: acc, altitude: alt } = pos.coords;
  lastFix = { lat, lon, t: Date.now() };
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
  if (rec.kind === 'lay') { const sp = liveSpread(pt); if (sp !== 1) pt.spread = sp; }
  rec.pts.push(pt);
  if (rec.kind === 'lay') setTrail(rec.pts);
  if (rec.kind === 'run') setDogTrack(rec.pts);
  paintNav();
  if (rec.kind === 'run') coachOnFix(pt);
  if (rec.kind === 'lay') {
    if (rec.pts.length === 1) {
      /* The plume needs real weather, and the first fix is the first moment
         there is somewhere to ask about. It joins a second or two in. */
      fetchWeather(lat, lon, pt.t)
        .then(wx => { rec.wx = wx; plumeStart(rec.pts, wx); })
        .catch(() => toast('No weather — the plume needs it, so it stays off'));
    } else {
      plumeAdd(pt);
    }
  }
  if (rec.pts.length === 1 && !nav.follow) map.easeTo({ center: [lon, lat], zoom: 17 });
}

async function startWatch(hudId) {
  headingStart({ gesture: true });   // still inside the tap that started this, which is when an iPhone browser allows the ask
  /* Inside the iOS app the shell records in the background: the phone can
     go in a pocket with the screen dark and every fix still arrives. */
  if (isNative()) {
    locateStop();
    rec.on = true; rec.pts = []; rec.dropped = 0; rec.started = Date.now();
    try {
      rec.bg = await watchBackground(onFix,
        (e) => toast(e?.code === 'NOT_AUTHORIZED' ? 'Location is off for Trailcraft — allow it in Settings' : 'GPS error'),
        { message: 'Recording — the phone can go in your pocket' });
    } catch { rec.bg = null; }
    if (!rec.bg) { rec.on = false; toast('Could not start GPS'); return false; }
    clearInterval(rec.tick);
    rec.tick = setInterval(() => { const el = $(hudId); const txt = hudText(); if (el) el.textContent = txt; }, 1000);
    return true;
  }
  if (!navigator.geolocation) { toast('No GPS on this device'); return false; }
  if (!window.isSecureContext) { toast('Needs https to read GPS'); return false; }
  try {
    const perm = await navigator.permissions?.query({ name: 'geolocation' });
    if (perm?.state === 'denied') {
      toast('Location blocked. Allow it for this site, then reload');
      return false;
    }
  } catch { /* Permissions API optional */ }
  locateStop();
  rec.on = true; rec.pts = []; rec.dropped = 0; rec.started = Date.now();
  try { rec.lock = await navigator.wakeLock?.request('screen'); } catch { /* not fatal */ }
  rec.watch = navigator.geolocation.watchPosition(onFix,
    (e) => toast(e.code === 1 ? 'Location blocked — nothing recorded'
      : e.code === 3 ? 'No fix yet — open sky helps' : 'GPS error'),
    { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
  clearInterval(rec.tick);
  rec.tick = setInterval(() => { const el = $(hudId); const txt = hudText(); if (el) el.textContent = txt; }, 1000);
  return true;
}

let hudText = gpsHudText;

async function stopWatch() {
  rec.on = false;
  if (rec.bg) { try { await rec.bg.stop(); } catch { /* already gone */ } rec.bg = null; }
  navigator.geolocation?.clearWatch(rec.watch);
  clearInterval(rec.tick);
  try { await rec.lock?.release(); } catch { /* already gone */ }
  rec.lock = null;
}

async function layStart() {
  hudText = gpsHudText;
  if (!(await startWatch('layHudText'))) return;
  startFollowing(null);
  $('btnLayStart').hidden = true;
  $('btnLayStop').hidden = false;
  $('layDot').hidden = false;
  $('layHudText').textContent = 'Waiting for a fix…';
  toast('Laying — the phone can go in your pocket');
}

async function layStop() {
  stopFollowing();
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
  setTrail(rec.pts);
  fitTo(rec.pts);
  go('scrConfirm');
}

async function confirmLay() {
  const t = S.target;
  const isHide = rec.kind === 'hide';
  const origin = isHide ? rec.hides[0] : rec.pts[0];
  const startedAt = isHide ? rec.hides[0].t : rec.pts[0].t;
  rec.pts.forEach(p => { delete p._seen; delete p.spread; });   // the ground is saved once, as letters (fillSurfaces)

  const s = {
    id: uid(), handlerId: S.handler.id, dogId: null,
    layerId: S.layer?.id ?? null, targetId: t.id, odour: S.odour || null, startedAt,
    summary: isHide
      ? `${rec.hides.length} hide${rec.hides.length === 1 ? '' : 's'} set, not searched yet.`
      : `${fmtKm(pathLen(rec.pts))} trail laid, not run yet.`,
    data: isHide
      ? { hides: rec.hides, weather: null }
      : { trail: rec.pts, waypoints: rec.wps, weather: null, contamination: [] },
  };
  guardSave(s, () => db.addSession(s));
  snap();
  pendingSession = s;
  plumeStop();              // the share screen is paper; the map is behind it
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
  plumeStop();
  clearMap();
  pendingSession = null;
  go('scrHome');
}

/* ── Share ────────────────────────────────────────────────────────── */
/* ── The card's little map ────────────────────────────────────────────
   A line floating on a blank panel says nothing about WHERE the trail was,
   which is half of what a record is for. The ground goes behind it.

   The picture is a Mapbox static image of the AREA, and the line is drawn
   over it here on the phone. That ordering is the point: Mapbox is asked for
   a square of countryside, exactly as the live map already asks it for
   tiles, and the trail itself never leaves the phone. Handing the path to
   their overlay API would have been one line of code and would have posted
   the trail to a server. */
const MINI_W = 300, MINI_H = 170;

/** Web Mercator, normalised to [0,1] — the projection the static image uses,
    so the line lands where the ground actually is. */
function merc(p) {
  const lat = Math.max(-85, Math.min(85, p.lat)) * Math.PI / 180;
  return {
    x: (p.lon + 180) / 360,
    y: (1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2,
  };
}

/** Centre and zoom that fit these points in the card, with a margin. */
function miniView(pts, W = MINI_W, H = MINI_H) {
  const m = pts.map(merc);
  const x1 = Math.min(...m.map(p => p.x)), x2 = Math.max(...m.map(p => p.x));
  const y1 = Math.min(...m.map(p => p.y)), y2 = Math.max(...m.map(p => p.y));
  const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
  const dx = Math.max(x2 - x1, 1e-9), dy = Math.max(y2 - y1, 1e-9);
  // 512 px world tiles, the same as the GL map; 0.78 leaves a margin.
  const z = Math.max(1, Math.min(18,
    Math.floor(Math.log2(Math.min(W * 0.78 / (dx * 512), H * 0.78 / (dy * 512))) * 100) / 100));
  const world = 512 * Math.pow(2, z);
  const lonC = cx * 360 - 180;
  const latC = Math.atan(Math.sinh(Math.PI * (1 - 2 * cy))) * 180 / Math.PI;
  return {
    z, lonC, latC,
    at: (p) => {
      const q = merc(p);
      return [(q.x - cx) * world + W / 2, (q.y - cy) * world + H / 2];
    },
  };
}

/** The satellite square behind the line — null without a token, and the card
    keeps its plain panel rather than showing a broken picture. */
function miniImgUrl(view, W = MINI_W, H = MINI_H) {
  const tok = (settings.mbToken || '').trim();
  if (!/^pk\./.test(tok)) return null;
  return `https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/static/`
    + `${view.lonC.toFixed(6)},${view.latC.toFixed(6)},${view.z},0/`
    + `${W}x${H}@2x?access_token=${encodeURIComponent(tok)}`;
}

function miniMapSvg(pts, view) {
  if (!pts || pts.length < 2) return '';
  const v = view || miniView(pts);
  const d = pts.map((p, i) => {
    const [x, y] = v.at(p);
    return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const [ax, ay] = v.at(pts[0]);
  const [bx, by] = v.at(pts[pts.length - 1]);
  // A dark casing so the line survives whatever the imagery happens to be.
  return `<path d="${d}" fill="none" stroke="#0B1630" stroke-width="6.5" stroke-opacity="0.5"
      stroke-linecap="round" stroke-linejoin="round"/>
    <path d="${d}" fill="none" stroke="#F5D14A" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${ax.toFixed(1)}" cy="${ay.toFixed(1)}" r="5.5" fill="#2F9E44" stroke="#FFFFFF" stroke-width="2"/>
    <circle cx="${bx.toFixed(1)}" cy="${by.toFixed(1)}" r="5.5" fill="#C99A2E" stroke="#FFFFFF" stroke-width="2"/>`;
}

/** Put the ground behind the line, if there is a token and a signal. */
function paintMini(pts) {
  const img = $('shareMiniImg');
  if (!pts || pts.length < 2) { img.hidden = true; $('shareMini').innerHTML = ''; return; }
  const view = miniView(pts);
  $('shareMini').innerHTML = miniMapSvg(pts, view);
  const url = miniImgUrl(view);
  img.hidden = true;
  if (!url) return;
  img.onload = () => { img.hidden = false; };
  img.onerror = () => { img.hidden = true; };   // offline: the panel, not a broken frame
  img.src = url;
}

function renderShare(s) {
  paintWhere(s);
  paintGround('shareGround', s);
  const isHide = targetById(s.targetId).kind === 'hide';
  const isPlan = !!s.data.plan;
  $('shareTitle').textContent = isHide ? 'Hide set' : isPlan ? 'Trail planned' : 'Trail laid';
  $('btnRunHere').textContent = isHide ? 'Search it on this phone' : 'Run it on this phone';
  $('btnContam').hidden = isHide;
  /* A plan is a drawn sketch with no walked times behind it — modelling scent
     off it would dress a guess as a measurement. */
  /* A drawn plan has no walked times behind it, so no plume. Once the walked
     card is in, it has real ones — and that is exactly when it is worth
     looking at. */
  $('btnSharePlume').hidden = isHide || (isPlan && !s.data.walked) || !s.data.weather;
  $('btnOff').hidden = !isPlan;
  if (isPlan) {
    $('btnOff').textContent = s.data.offAt
      ? 'Open the countdown' : `${cap(layerName(s))} is off — start the countdown`;
  }

  const wx = s.data.weather;
  const laid = new Date(s.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (isHide) {
    $('shareMiniImg').hidden = true;
    $('shareMini').innerHTML = (s.data.hides || []).map((h, i) =>
      `<circle cx="${40 + i * 40}" cy="85" r="7" fill="#C99A2E"/>`).join('');
    $('shareMeta').textContent = `${targetText(s)} · ${s.data.hides.length} hide${s.data.hides.length === 1 ? '' : 's'} · set ${laid}`
      + (wx?.wind_speed != null ? ` · wind ${fmtWind(wx.wind_speed)} ${cardinal(wx.wind_direction)}` : '');
    /* Hide cards are not in the QR codec yet — single-phone hides for now. */
    $('shareQrCard').hidden = true;
  } else {
    $('shareQrCard').hidden = false;
    paintMini(s.data.trail);
    const mins = fmtDur(s.data.trail[s.data.trail.length - 1].t - s.data.trail[0].t);
    $('shareMeta').textContent = isPlan
      ? `${fmtKm(pathLen(s.data.trail))} plan · ${ageWords(s.data.ageMin)}`
        + (wx?.wind_speed != null ? ` · wind ${fmtWind(wx.wind_speed)} ${cardinal(wx.wind_direction)}` : '')
      : `${fmtKm(pathLen(s.data.trail))} · ${mins} · laid ${laid}`
        + (wx?.wind_speed != null ? ` · wind ${fmtWind(wx.wind_speed)} ${cardinal(wx.wind_direction)}` : '');
    renderShareQr(s);
  }
}

/** How the wait reads in a sentence. Zero is not "+0 min". */
const ageWords = (m) => (m == null ? 'dog starts +10 min'
  : m <= 0 ? 'dog starts as soon as they are clear'
  : `dog starts +${m} min`);

/** Where the trail starts, or where each hide is — in the handler's chosen
    format, and one tap puts it on the clipboard to send to whoever needs it. */
function paintWhere(s) {
  const el = $('shareWhere');
  if (!el) return;
  const rows = [];
  if (s.data?.hides?.length) {
    s.data.hides.forEach((h, i) => rows.push({ k: `Hide ${i + 1}`, lat: h.lat, lon: h.lon }));
  } else if (s.data?.trail?.length) {
    const t = s.data.trail;
    rows.push({ k: 'Start', lat: t[0].lat, lon: t[0].lon });
    rows.push({ k: 'End', lat: t[t.length - 1].lat, lon: t[t.length - 1].lon });
  }
  el.innerHTML = rows.map(r => {
    const text = fmtPlace(r.lat, r.lon);
    return `<button type="button" class="where-row" data-copy="${esc(text)}">
      <span>${esc(r.k)}</span><b>${esc(text)}</b></button>`;
  }).join('');
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
    qr.addData(cardUrl(card, SHARE_BASE), 'Byte');
    qr.make();
    $('shareQr').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
    const who = S.layers.find(l => l.id !== s.layerId)?.name;
    $('shareQrCaption').textContent = s.data.plan
      ? `Point the other phone's camera at this — it opens Trailcraft and walks them along the line`
      : `Point the other phone's camera at this — the trail travels inside the code, no signal needed`;
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
  setTrail(s.data.trail);
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

const draw = { pts: [], ageMin: 10, step: 'map' };

/** The ageing choice, and the one chip whose label changes. */
function paintAge() {
  $('ageRow').querySelectorAll('.age-chip').forEach(b => {
    const custom = b.dataset.age === 'custom';
    const mine = custom
      ? ![0, 5, 10].includes(draw.ageMin)
      : Number(b.dataset.age) === draw.ageMin;
    b.classList.toggle('selected', mine);
    if (custom) b.textContent = mine ? `${draw.ageMin} min` : 'Custom';
  });
  $('drawConfirmSub').textContent = draw.ageMin
    ? `The dog starts ${draw.ageMin} min after the trail is laid`
    : 'The dog starts as soon as the trail is laid';
}

/* Two steps on one map. Drawing first, with nothing on the sheet but Save —
   the head start is a question for afterwards, and asking it early only took
   map away from the finger. Save plan then asks it, over the finished line. */
function drawStep(step) {
  draw.step = step;
  const age = step === 'age';
  $('ageCard').hidden = !age;
  $('drawConfirm').hidden = !age;
  $('drawBackRow').hidden = !age;
  $('drawSave').hidden = age;
  $('drawTools').hidden = age;
  map.getCanvas().style.cursor = age ? '' : 'crosshair';
  paintDraw();
  styleGap();
  requestAnimationFrame(styleGap);
}

function openDraw() {
  clearMap();
  /* Corners are tapped by finger, so the map has to be on the handler before
     the first tap — drawing from wherever the map happened to be sitting puts
     the whole trail in the wrong field. */
  locateMe({ zoom: 17 });
  draw.pts = [];
  draw.ageMin = 10;
  $('ageCustom').hidden = true;
  $('ageMins').value = '';
  paintAge();
  map.on('click', onDrawTap);
  drawStep('map');
  go('scrDraw');
}
function onDrawTap(e) {
  if (draw.step !== 'map') return;             // choosing the head start: the line is finished
  const pt = { lat: e.lngLat.lat, lon: e.lngLat.lng };
  const prev = draw.pts[draw.pts.length - 1];
  if (prev && dist(prev, pt) > 5000) return toast('That corner is km away — zoom in');
  draw.pts.push(pt);
  navigator.vibrate?.(15);
  paintDraw();
}
function paintDraw() {
  setTrail(draw.pts);
  /* The first tap is the green Start and says so; the corners after it count
     from 1. It is kept out of the numbered dots, or a white dot and a "1"
     would sit on top of the start and hide both. */
  setSrc('wps', pointsOf(draw.pts.slice(1).map((pt, i) => ({ ...pt, kind: String(i + 1) })), 'kind'));
  setSrc('start', pointsOf(draw.pts.slice(0, 1)));
  const n = draw.pts.length;
  $('drawText').textContent = n < 2
    ? (n === 0 ? 'Tap where the trail starts' : 'Now tap the first corner')
    : `${n - 1} corner${n === 2 ? '' : 's'} · ${fmtKm(pathLen(draw.pts))}`;
  $('drawSave').disabled = n < 2;
}
function closeDraw() {
  map.off('click', onDrawTap);
  map.getCanvas().style.cursor = '';
}
function saveDrawPlan() {
  if (draw.pts.length < 2) return;
  closeDraw();
  /* Densify, then a provisional walking clock anchored at the END: a trail
     that has just been drawn is a trail that has just been LAID, finishing
     where the layer now stands. Anchored at the start instead, most of the
     line sat in the future — ground carrying no scent yet — so the plume
     crept along it at walking pace instead of simply being there.

     These times are provisional either way; the real ones arrive with the
     walked card. */
  const planPts = timestampsEndingAt(densify(draw.pts, 5), Date.now(), 1.3);
  const sess = {
    id: uid(), handlerId: S.handler.id, dogId: null,
    layerId: S.layer?.id ?? null, targetId: 'person', startedAt: planPts[0].t,
    summary: `${fmtKm(pathLen(planPts))} trail planned, not walked yet.`,
    data: { plan: true, ageMin: draw.ageMin, corners: draw.pts, trail: planPts,
            waypoints: [], weather: null, contamination: [] },
  };
  guardSave(sess, () => db.addSession(sess));
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
  /* The route layers own this line now — drawing it as a plain trail as well
     put two lines in the same place saying different things. */
  setSrc('routeAhead', lineOf(card.points));
  setSrc('start', pointsOf([card.points[0]]));
  setSrc('hides', pointsOf([card.points[card.points.length - 1]]));   // B, in ember
  fitTo(card.points);
  hudText = walkHud;
  navSay('—', '', 'Walk to the green start dot', '');
  go('scrWalk');
  startFollowing(card.points, { courseUp: true });
  startWatch('navSink').then(ok => { if (!ok) { stopFollowing(); go('scrHome'); } });
  toast(`${card.from ? card.from + '’s' : 'The'} plan — walk the line, start to finish`);
}

function walkHud() {
  const A = walk.card.points[0], B = walk.card.points[walk.card.points.length - 1];
  const last = rec.pts[rec.pts.length - 1];
  if (!last) { navSay('—', '', accWarning(), ''); return ''; }
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

  /* Before departure the destination is the START; after it, the END. The
     big number is always the distance to whichever one you are heading for,
     because that is the only number a walking person reads. */
  const pr = progressAlong(walk.card.points, last);
  const toGo = walk.offAt ? (pr ? pr.remaining : dB) : dA;
  const [n, u] = toGo >= 1000 ? [(toGo / 1000).toFixed(1), 'km'] : [String(Math.round(toGo)), 'm'];

  if (!walk.offAt) {
    navSay(n, u, dA < 40 ? 'At the start — walk on' : 'To the start of the trail',
      dA < 40 ? 'The clock starts when you leave' : '');
    return '';
  }
  const off = pr ? pr.off : null;
  const left = (walk.offAt + (walk.card.ageMin ?? 10) * 60000) - Date.now();
  const clock = left > 0 ? `Dog starts in ${fmtDur(left)}` : 'The dog is on its way';
  navSay(n, u,
    off == null || off < 8 ? 'On the line' : `${fmtM(off)} off the line`,
    clock);
  return '';
}

/** The banner: one big number, one instruction, one quiet line under it. */
function navSay(num, unit, instr, sub) {
  $('navDist').textContent = num;
  $('navUnit').textContent = unit;
  $('navInstr').textContent = instr;
  $('navSub').textContent = sub || '';
  $('navBanner').classList.toggle('off-line', /off the line/.test(instr));
}

async function finishWalk() {
  if (!walk.card) { stopFollowing(); return go('scrHome'); }
  const B = walk.card.points[walk.card.points.length - 1];
  const last = rec.pts[rec.pts.length - 1];
  if (last && dist(last, B) > 60 &&
      !confirm(`You are ${fmtM(dist(last, B))} from the drawn end. Finish here anyway?`)) return;
  await stopWatch();
  stopFollowing();
  rec.pts.forEach(pt => delete pt._seen);
  walk.done = true;

  const walked = rec.pts.length >= 2 ? rec.pts : walk.card.points;
  if (rec.pts.length < 2) toast('No GPS track of the walk — the card will carry the drawn line');

  // Her own record of the walk stays on her phone.
  const own = {
    id: uid(), handlerId: S.handler.id, dogId: null, layerId: null,
    targetId: 'person', startedAt: walked[0].t,
    summary: `Walked ${walk.card.from ? walk.card.from + '’s' : 'a'} plan — ${fmtKm(pathLen(walked))}.`,
    data: { trail: walked, waypoints: [], weather: null, contamination: [], walkOf: true },
  };
  guardSave(own, () => db.addSession(own));
  snap();

  // The card the handler scans after the find: the trail as it was REALLY walked.
  try {
    const cardStr = await encodeTrail({ points: walked, waypoints: [], from: S.handler?.name ?? '', kind: 2 }, {});
    const qr = window.qrcode?.(0, 'M');
    qr.addData(cardUrl(cardStr, SHARE_BASE), 'Byte');
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

  const walkedPatch = {
    startedAt: card.started,
    data: { ...s.data, planTrail: plan, trail: card.points, walked: true, walkedFrom: card.from },
  };
  const savedWalk = guardSave(s, () => saveSession(s, walkedPatch));
  snap();
  let s2 = savedWalk ?? { ...s, ...walkedPatch };
  toast(`The real walked line from ${card.from || 'the layer'} — re-grading`);
  if (s2.data.track) {
    const result = await computeResult(s2, s2.data.track, s2.data.trackWaypoints || [], s2.data.trackStarted, { bank: true });
    guardSave(s2, () => saveSession(s2, { summary: result.sentence, data: { ...s2.data, result } }));
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
      <div class="story">${esc(targetText(s))} · ${age} old</div>
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
  liveState = null;
  paintLiveBtn();
  fillSurfaces(s);              // ready by the time Reveal wants the plume
  coachStart(s);
  if (db.usage().bytes > STORAGE_MB * 0.8 * 1048576) toast('Storage nearly full — delete old sessions in Settings soon');

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
    const base = `${dogName} · ${fmtDur(Date.now() - rec.started)} · ${t.kind === 'person' ? 'trail' : 'hide'} ${age} old`;
    return coach.line ? `${base} · ${coach.line}` : base;
  };
  $('btnReveal').textContent = t.kind === 'person' ? 'Reveal trail' : 'Reveal hides';
  go('scrRun');
  if (!(await startWatch('runHudText'))) return go('scrHome');
  startFollowing(null);
  /* Wind, even on a blind run: it says nothing about where the trail is, and
     it is the first thing you want before deciding where to cast. */
  airStart(s.data.weather);
  showWeather(s.data.weather);
  terrainFor(s.data.trail || s.data.hides || []).then(T => { air.T = T; }).catch(() => {});
  $('runHudText').textContent = hudText();
  toast(t.kind === 'person' ? 'Running blind — the trail is hidden' : 'Searching');
}

function toggleReveal() {
  const s = run.session;
  run.revealed = !run.revealed;
  const t = targetById(s.targetId);
  if (t.kind === 'person') {
    setTrail(run.revealed ? s.data.trail : null);
    /* The plume is the trail, drawn in air. Showing it before Reveal would
       hand the handler the answer, so it waits for the same button. */
    if (run.revealed) plumeStart(trailOf(s), s.data.weather);
    else plumeStop();
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
  const coachRecord = coachSummary();
  coachStop();
  stopFollowing();
  plumeStop();
  airStop();
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
  liveEnd(result);
  const patch = {
    dogId: S.dog?.id ?? null,
    handlerId: S.handler.id,
    summary: result.sentence,
    data: { ...s.data, track: rec.pts, trackStarted: run.startedAt, trackWaypoints: rec.wps, result, coach: coachRecord },
  };
  /* If the phone refuses the save, the run stays in memory and on screen:
     the result still shows, it can be sent as a link or a file, and the
     save can be retried once there is room. */
  const saved = guardSave({ ...s, ...patch }, () => saveSession(s, patch));
  snap();
  run.session = saved ?? { ...s, ...patch };
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
  /* The phone's track, projected a line-length ahead: an ESTIMATE of where
     the dog was, never a measurement. It is called the track throughout. */
  const corrected = lineCorrect(track, dogRow?.lineM ?? 0);
  const offs = signedOffsets(trail, corrected);
  const mean = meanSigned(offs);
  const medAbs = medianAbs(offs);
  const shares = sideShares(corrected, offs, { deadM: 3 });
  const accs = track.map(p => p.acc).filter(Number.isFinite).sort((a, b) => a - b);
  const accMed = accs.length ? accs[accs.length >> 1] : null;
  // A sideways difference smaller than the GPS's own uncertainty is not readable.
  const noisy = Number.isFinite(accMed) && Number.isFinite(medAbs) && accMed > Math.max(5, medAbs);
  const mainSide = !shares ? null : shares.left > shares.right * 1.25 ? 'left' : shares.right > shares.left * 1.25 ? 'right' : null;

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
  const moved = changed();
  const offBaseline = Object.keys(moved).length > 0;
  if (bank && !offBaseline) {
    db.addCalibration(dogRow?.id, {
      t: startedAt, predSide, mean, wind: wx?.wind_speed ?? null,
      stability: st?.label ?? null, k,
    });
  }

  const sideWord = mean == null ? '' : mean > 0 ? 'right' : 'left';

  /* Two layers, kept apart. RECORDED: what the track did, in numbers the
     GPS can actually support. MODELLED: what the forecast wind suggests —
     an explanation offered, never a verdict on the dog. */
  let sentence;
  if (medAbs == null || !shares) sentence = `${dogName} ran, but the track could not be compared with the line.`;
  else if (noisy) sentence = `${dogName}’s track sat about ${fmtM(medAbs)} from the line, but GPS uncertainty (±${fmtM(accMed)}) is too large to read which side.`;
  else if (shares.on >= 0.7) sentence = `${dogName}’s track stayed within ${fmtM(3)} of the line for ${Math.round(shares.on * 100)} % of the run.`;
  else if (mainSide) sentence = `${dogName}’s track ran mainly to the ${mainSide} of the line — typically ${fmtM(medAbs)} from it.`;
  else sentence = `${dogName}’s track worked both sides of the line — typically ${fmtM(medAbs)} from it.`;

  let modelled = '';
  if (predSide !== 0) {
    const predWord = predSide > 0 ? 'right' : 'left';
    modelled = `The forecast wind suggests drift to the ${predWord}.`;
    if (mainSide && !noisy) {
      modelled += mainSide === predWord
        ? ' The track sits on that side.'
        : ' The track sits on the other side — worth reviewing the local conditions and what the dog was doing.';
    }
  } else if (wx) {
    modelled = 'The forecast wind ran along the trail, so it suggests no side.';
  } else {
    modelled = 'No weather was recorded for this trail, so the model has nothing to suggest.';
  }

  return {
    kind: 'trail', sentence, modelled, mean, medAbs, shares, accMed, noisy, mainSide,
    side: sideWord || null, predSide, agree, ageMin,
    regimeWord: reg?.word ?? null, regimeKey: reg?.key ?? null,
    stability: st?.label ?? null, stabilityPlain: st?.plain ?? null,
    wind: wx ? { speed: wx.wind_speed, from: wx.wind_direction } : null,
    /* Which model produced this. `mv` is the app that graded it; `mp` is any
       dial that was not where it shipped, and is absent on every normal run.
       Without these a result cannot be reproduced, and a picture that cannot
       be reproduced is not a record of anything. */
    mv: BUILD, ...(offBaseline ? { mp: moved } : {}),
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

/** A result saved before the wording changed carries only a signed mean and
    a sentence that claimed too much. Its numbers still read; its sentence
    is rebuilt in today's words rather than shown as it was. */
function legacySentence(r, dogName) {
  if (!Number.isFinite(r.mean)) return `${dogName} ran, but the track could not be compared with the line.`;
  const a = Math.abs(r.mean);
  return a < 3
    ? `${dogName}’s track stayed close to the line — under ${fmtM(3)} from it on average.`
    : `${dogName}’s track sat mainly to the ${r.side ?? (r.mean > 0 ? 'right' : 'left')} of the line — about ${fmtM(a)} from it on average.`;
}

function renderResult(s) {
  paintGround('resGround', s);
  const r = s.data.result;
  const d = S.dogs.find(x => x.id === s.dogId);
  $('resWho').textContent = `${d?.name ?? ''} · ${fmtWhen(s.startedAt)}`;
  $('resSentence').textContent = r.kind === 'trail' && !Number.isFinite(r.medAbs)
    ? legacySentence(r, d?.name ?? 'The dog') : r.sentence;

  const cell = (b, i, sub = '') =>
    `<div><b>${b}</b><i>${i}</i>${sub ? `<span class="sub-line">${sub}</span>` : ''}</div>`;

  if (r.kind === 'search') {
    $('resGrid').innerHTML =
      cell(r.toFirst != null ? fmtDur(r.toFirst) : '—', 'to first indication') +
      cell(r.catchM != null ? `${r.catchM} m` : '—', 'from the hide') +
      cell(`${r.ageMin} min`, 'hide age at start') +
      cell(r.approach ?? '—', 'approach vs wind');
  } else {
    /* Older results carry only a signed mean; they still read. */
    const typical = Number.isFinite(r.medAbs) ? r.medAbs : Number.isFinite(r.mean) ? Math.abs(r.mean) : null;
    const pc = (x) => `${Math.round(x * 100)} %`;
    const sideCell = r.shares
      ? (r.mainSide ? cell(pc(r.shares[r.mainSide]), `of the time ${r.mainSide}`, `${pc(r.shares.on)} within ${fmtM(3)}`)
                    : cell(pc(r.shares.on), 'of the time on the line', `${pc(r.shares.left)} left · ${pc(r.shares.right)} right`))
      : cell(r.side ? cap(r.side) : '—', 'mainly');
    /* Four recorded facts — nothing modelled sits in this grid. */
    const tr = s.data.track ?? [];
    const dur = tr.length > 1 && Number.isFinite(tr[0].t) ? tr[tr.length - 1].t - tr[0].t : null;
    $('resGrid').innerHTML =
      cell(typical != null ? fmtM(typical, 1) : '—', 'typical distance from the line',
        r.noisy && Number.isFinite(r.accMed) ? `GPS ±${fmtM(r.accMed)}` : '') +
      sideCell +
      cell(`${r.ageMin} min`, 'trail age at start') +
      cell(dur != null ? fmtDur(dur) : '—', 'run', tr.length > 1 ? fmtKm(pathLen(tr)) : '');
  }
  const modelled = r.modelled
    ?? (r.predSide ? `The forecast wind suggests drift to the ${r.predSide > 0 ? 'right' : 'left'}.` : '');
  // What the model thinks moved the scent: only worth a word when it was not the wind.
  const mover = r.regimeKey === 'drain' ? ' Cold air draining downhill, not the wind, is what the model thinks moved it.' : '';
  $('resModel').textContent = (modelled + mover).trim();
  $('resModelLabel').hidden = !$('resModel').textContent && !r.stabilityPlain;
  $('resStability').textContent = r.stabilityPlain ?? '';
  $('resCoach').textContent = coachWords(s.data.coach);

  /* A plan-graded run says so. Grading a dog against a line drawn with a
     finger is a sketch of a verdict, and it is not allowed to look like the
     real one — nor to teach the dog's calibration anything. */
  const provisional = !!s.data.plan && !s.data.walked;
  $('btnScanWalked').hidden = !provisional;
  $('btnReplay').hidden = !(s.data.track?.length > 1);
  const note = $('resProvisional');
  note.hidden = !s.data.plan;
  if (s.data.plan) {
    if (provisional) {
      note.textContent = `Graded against the line you drew, not the walk itself. Nothing is banked to ${S.dog?.name ?? 'this dog'}’s calibration until you scan the layer’s walked card.`;
    } else {
      /* The walk is the record now. Say how far it drifted from the sketch,
         because a dog that looks wrong against the plan may have been exactly
         right against the ground — and Show on map draws both lines. */
      const w = walkVsPlan(s);
      const who = s.data.walkedFrom || 'the layer';
      note.textContent = `Graded against the trail ${who} actually walked.`
        + (w && w.med >= 3
          ? ` It sat about ${fmtM(w.med)} off the line you drew, and as much as ${fmtM(w.worst)} ${w.side} of it. Show on map draws both.`
          : w ? ' It followed your line closely.' : '');
    }
  }
}
/** How far the layer's walk sat from the line you drew, in metres: the
    median distance, and the worst single point. The same measure used to
    grade the dog against the trail — pointed at the layer instead. */
function walkVsPlan(s) {
  const plan = s?.data?.planTrail, walk = s?.data?.trail;
  if (!(plan?.length > 1) || !(walk?.length > 1)) return null;
  /* signedOffsets returns plain NUMBERS, + right of the line and − left —
     not objects. Reading a field off them leaves the worst point silently
     at zero, which is the kind of wrong that looks fine on screen. */
  const offs = signedOffsets(plan, walk).filter(Number.isFinite);
  if (!offs.length) return null;
  let worst = 0;
  for (const o of offs) if (Math.abs(o) > Math.abs(worst)) worst = o;
  return { med: medianAbs(offs), worst: Math.abs(worst), side: worst >= 0 ? 'right' : 'left' };
}

const cap = (w) => w ? w.charAt(0).toUpperCase() + w.slice(1) : w;

/* ── Show on map: the ONLY place the plume band appears ───────────── */
let mapCameFrom = 'scrResult';

function showOnMap(from = 'scrResult') {
  const s = run.session ?? pendingSession;
  if (!s) return;
  mapCameFrom = from;
  const t = targetById(s.targetId);
  clearMap();
  const wx = s.data.weather;
  if (t.kind === 'person') {
    setTrail(s.data.trail);
    setSrc('start', pointsOf([s.data.trail[0]]));
    if (s.data.planTrail?.length > 1) setSrc('plan', lineOf(s.data.planTrail));
    if (s.data.contamination?.length) {
      setSrc('contam', { type: 'FeatureCollection',
        features: s.data.contamination.map(c => lineOf(c.points).features[0]).filter(Boolean) });
    }
    if (wx) {
      /* The general model for every dog. A per-dog drift figure is still
         collected (dog card: "observed track patterns") but no longer fed
         back in — a model tuned on the track it is asked to explain would
         only learn to agree with it. */
      const field = scentField(trailOf(s), wx, s.data.trackStarted ?? undefined);
      if (field.length) setSrc('drift', plumePolygon(field));
      // ...and the air itself, moving, as it was when the dog worked it.
      plumeStart(trailOf(s), wx);
      showWeather(wx);
    }
  } else {
    setSrc('hides', pointsOf(s.data.hides));
  }
  if (s.data.track) {
    setDogTrack(s.data.track);
    setSrc('wps', pointsOf(s.data.trackWaypoints || [], 'kind'));
  }
  fitTo(s.data.trail || s.data.hides || [], s.data.track || [], s.data.planTrail || []);
  const planShown = s.data.planTrail?.length > 1;
  $('showMapText').textContent = planShown
    ? 'Dashed blue: your plan. Footprints: the real walk, and what the scent is modelled from.'
    : t.kind === 'hide'
    ? 'Hides and the search track'
    : !wx ? 'No weather saved for this trail, so no plume'
    : 'Modelled scent, ageing in real time. The width is the uncertainty, never narrowed.';
  go('scrShowMap');
}

/* ── A save that failed ───────────────────────────────────────────────
   The store throws rather than swallows. This is where the handler learns
   of it and keeps what is on screen: the unsaved record stays in memory,
   can be sent as a link or a file right away, and the save is retried once
   room has been made. A two-second toast would be the wrong shape for this
   message, so it is a banner that stays until dismissed. */
let saveTrouble = null;   // { session, retry, err }

/** Save a session whether or not it exists yet; returns what is now stored. */
function saveSession(s, patch) {
  const merged = { ...s, ...patch, data: { ...(s.data || {}), ...(patch.data || {}) } };
  if (db.sessions().some(x => x.id === s.id)) db.updateSession(s.id, patch);
  else db.addSession(merged);
  return db.sessions().find(x => x.id === s.id) ?? merged;
}

function guardSave(session, fn) {
  try {
    const v = fn();
    if (saveTrouble && saveTrouble.session?.id === session?.id) hideSaveTrouble();
    return v;
  } catch (e) {
    if (e?.name !== 'SaveError') throw e;
    saveTrouble = { session, retry: fn, err: e };
    showSaveTrouble(e);
    return null;
  }
}

function showSaveTrouble(e) {
  const hasTrail = !!(saveTrouble?.session?.data?.trail || saveTrouble?.session?.data?.hides);
  $('saveTroubleTitle').textContent = e.full ? 'Couldn’t save — the phone has no room left' : 'Couldn’t save this';
  $('saveTroubleText').textContent = e.full
    ? (hasTrail
      ? 'It is still here on screen. Send it as a link or a GPX now, then free some space (Settings → All sessions → delete old ones) and try again.'
      : 'Free some space (Settings → All sessions → delete old ones) and try again.')
    : `${e.message}.${hasTrail ? ' It is still here on screen — send it as a link or a GPX now, then try again.' : ' Try again in a moment.'}`;
  $('saveLink').hidden = !hasTrail;
  $('saveGpx').hidden = !hasTrail;
  $('saveRetry').hidden = !saveTrouble?.retry;
  $('saveTrouble').hidden = false;
}
function hideSaveTrouble() { saveTrouble = null; $('saveTrouble').hidden = true; }

function retrySave() {
  if (!saveTrouble?.retry) return hideSaveTrouble();
  try {
    saveTrouble.retry();
    hideSaveTrouble();
    snap();
    toast('Saved');
  } catch (e) {
    if (e?.name !== 'SaveError') throw e;
    showSaveTrouble(e);
    toast(e.full ? 'Still no room — delete an old session first' : 'Still could not save');
  }
}

/** How much of the phone's room the records take, said in Settings. Safari
    allows about five megabytes to a web app; the iOS app has far more. */
const STORAGE_MB = isNative() ? 50 : 5;
function paintStorageLine() {
  const el = $('storageLine');
  if (!el) return;
  const mb = db.usage().bytes / 1048576;
  const nearly = mb > STORAGE_MB * 0.8;
  el.textContent = `Records use ${mb < 0.1 ? 'under 0.1' : mb.toFixed(1)} MB of the roughly ${STORAGE_MB} MB allowed here${nearly ? ' — delete old sessions soon' : ''}.`;
  el.classList.toggle('warn', nearly);
}

/* ── Sharing beyond this phone ────────────────────────────────────────
   A link with the whole trail inside it, a GPX file, a PDF report, or a
   live view of a run — all read from one model (share.js), so they can
   never disagree with each other or with the result card. */
/* Links and QR codes name the public site, never this copy's own address:
   the Desktop file is file://, the iOS app is capacitor://localhost, and a
   card carrying either would open nothing on the other phone. */
const PUBLIC_BASE = 'https://sydrouxba5.github.io/trailcraft/';
const SHARE_BASE = /^https?:$/.test(location.protocol) ? location.href.replace(/[#?].*$/, '') : PUBLIC_BASE;
let shareOutSession = null, shareOutFrom = 'scrResult';
let sharedModel = null, sharedSession = null, sharedFrom = null;

/** A session as the plain model the sharers read: names, not ids. */
function modelOf(s) {
  return trailModel(s, {
    dog: S.dogs.find(d => d.id === s.dogId) ?? null,
    handler: S.handlers.find(h => h.id === s.handlerId) ?? S.handler ?? null,
    layer: S.layers.find(l => l.id === s.layerId) ?? null,
  });
}
const unitsForText = () => ({ imperial: imp(), fahrenheit: fahr(), coord: settings.coordFormat, when: fmtWhen });
const metaLine = (m) => [m.dog?.name, fmtWhen(m.runAt ?? m.laidAt ?? Date.now()),
  m.handler ? `handler ${m.handler}` : null].filter(Boolean).join(' · ');

function openShareOut(s, from) {
  shareOutSession = s;
  shareOutFrom = from;
  const m = modelOf(s);
  $('shareOutTitle').textContent = m.track
    ? `${m.dog?.name ?? 'The dog'}’s run`
    : m.kind === 'search' ? 'The hides' : 'The laid trail';
  $('shareOutMeta').textContent = metaLine(m);
  $('shareLinkOut').hidden = true;
  go('scrShareOut');
}

/** The trail as a link: the phone's share sheet if it has one, else the
    clipboard. Sending is the user's tap in the sheet, never this code's. */
async function sendLink(m) {
  let code;
  try { code = await encodeShared(m); } catch (e) { return toast(e.message); }
  const url = sharedUrl(code, SHARE_BASE);
  if (navigator.share) {
    try { await navigator.share({ title: 'Trailcraft', text: headline(m), url }); return; }
    catch (e) { if (e?.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(url); toast('Link copied — paste it anywhere'); }
  catch {
    /* No share sheet and no clipboard (a desktop browser that refused it):
       the link itself, in a box, is the one fallback that always works. */
    const box = $('shareLinkOut');
    box.value = url; box.hidden = false; box.focus(); box.select();
    toast('Copy the link from the box');
  }
}

/** A file, through the share sheet where there is one (Files, AirDrop,
    Mail…), else a plain download. */
async function deliverFile(bytes, name, type) {
  const file = new File([bytes], name, { type });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; }
    catch (e) { if (e?.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  toast(`Saved ${name}`);
}
const saveGpx = (m) => deliverFile(toGpx(m), `${fileBase(m)}.gpx`, 'application/gpx+xml');

/* The report's map: the same static square as the share card, larger, with
   the lines drawn in vector over it — so the picture is only a picture. */
const RPT_W = 600, RPT_H = 340;
const INKC = [0.059, 0.122, 0.239];
async function reportMap(m) {
  const all = [m.trail, m.hides, m.track, ...m.contamination.map(c => c.points)].filter(Boolean).flat();
  if (!all.length) return null;
  const view = miniView(all.length > 1 ? all : [all[0], all[0]], RPT_W, RPT_H);
  const at = (p) => { const [x, y] = view.at(p); return [x / RPT_W, y / RPT_H]; };
  const paths = [], dots = [];
  m.contamination.forEach(c => paths.push({ pts: c.points.map(at), stroke: [0.78, 0.72, 0.91], width: 1.8, dash: [3, 3] }));
  // The dog's track under the trail: where they overlap, the line that was laid must still show.
  if (m.track) paths.push({ pts: m.track.map(at), stroke: [1, 1, 1], casing: INKC, width: 2.2 });
  if (m.trail) paths.push({ pts: m.trail.map(at), stroke: [0.96, 0.82, 0.29], casing: INKC, width: 2.6,
    dash: m.plan && !m.walked ? [4, 3] : null });
  (m.hides ?? []).forEach(h => { const [x, y] = at(h); dots.push({ x, y, fill: [0.79, 0.6, 0.18], r: 4.5 }); });
  (m.wps ?? []).forEach(w => { const [x, y] = at(w); dots.push({ x, y, fill: [1, 1, 1], rim: INKC, r: 2.6 }); });
  if (m.trail) {
    const [ax, ay] = at(m.trail[0]), [bx, by] = at(m.trail[m.trail.length - 1]);
    dots.push({ x: ax, y: ay, fill: [0.18, 0.62, 0.27], r: 4.5 }, { x: bx, y: by, fill: [0.79, 0.6, 0.18], r: 4.5 });
  }
  const pic = await staticJpeg(view).catch(() => null);   // offline, no token: paper instead
  return { aspect: RPT_W / RPT_H, ...(pic ?? {}), paths, dots };
}
async function staticJpeg(view) {
  const url = miniImgUrl(view, RPT_W, RPT_H);
  if (!url) return null;
  /* The map server answers with a JPEG, which goes into the file exactly as
     it came. Anything else is drawn through a canvas and re-encoded. */
  const res = await fetch(url);
  if (!res.ok) return null;
  const bytes = new Uint8Array(await res.arrayBuffer());
  const size = jpegSize(bytes);
  if (size) return { jpeg: bytes, jpegW: size.w, jpegH: size.h };
  const img = new Image();
  img.crossOrigin = 'anonymous';
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  c.getContext('2d').drawImage(img, 0, 0);
  const blob = await new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('no picture'))), 'image/jpeg', 0.84));
  return { jpeg: new Uint8Array(await blob.arrayBuffer()), jpegW: c.width, jpegH: c.height };
}

async function savePdf(m) {
  toast('Making the report…');
  const search = m.kind === 'search';
  const map = await reportMap(m);
  const bytes = buildPdf({
    title: `${search ? 'Search' : 'Trail'} report${m.dog?.name ? ` — ${m.dog.name}` : ''}`,
    eyebrow: `Trailcraft · ${search ? 'search' : 'trail'} report`,
    headline: headline(m),
    meta: metaLine(m),
    map,
    sections: detailSections(m, unitsForText()),
    notes: notes(m),
    footer: 'Trailcraft · sydrouxba5.github.io/trailcraft',
    date: m.runAt ?? m.laidAt ?? Date.now(),
  });
  return deliverFile(bytes, `${fileBase(m)}.pdf`, 'application/pdf');
}

/* ── A trail someone sent ─────────────────────────────────────────── */

/** The model dressed as a session, so the map screen can show it exactly
    as it shows this phone's own. */
function sessionFromModel(m) {
  return {
    id: 'shared', targetId: m.kind === 'search' ? 'article' : 'person',
    startedAt: m.laidAt ?? Date.now(), dogId: null, handlerId: null, layerId: null, summary: headline(m),
    data: {
      trail: m.trail ?? undefined, hides: m.hides ?? undefined, contamination: m.contamination ?? [],
      weather: m.wx ?? null, track: m.track ?? undefined, trackWaypoints: m.wps ?? [],
      trackStarted: m.runAt ?? undefined, result: m.result ?? undefined, plan: m.plan, walked: m.walked, k: m.k,
    },
  };
}

function paintSharedMini(m) {
  const img = $('sharedMiniImg'), svg = $('sharedMini');
  const all = [m.trail, m.hides, m.track].filter(Boolean).flat();
  if (!all.length) { img.hidden = true; svg.innerHTML = ''; return; }
  const view = miniView(all.length > 1 ? all : [all[0], all[0]]);
  const line = (pts, color, w, dashed) => {
    if (!pts || pts.length < 2) return '';
    const d = pts.map((p, i) => { const [x, y] = view.at(p); return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`; }).join(' ');
    return `<path d="${d}" fill="none" stroke="#0B1630" stroke-width="${w + 3}" stroke-opacity="0.5" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="${d}" fill="none" stroke="${color}" stroke-width="${w}"${dashed ? ' stroke-dasharray="5 3"' : ''} stroke-linecap="round" stroke-linejoin="round"/>`;
  };
  const dot = (p, fill) => { const [x, y] = view.at(p); return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5.5" fill="${fill}" stroke="#FFFFFF" stroke-width="2"/>`; };
  // The dog's track under the trail, so the line that was laid always shows.
  svg.innerHTML = line(m.track, '#FFFFFF', 2.6) + line(m.trail, '#F5D14A', 3.2, m.plan && !m.walked)
    + (m.hides ?? []).map(h => dot(h, '#C99A2E')).join('')
    + (m.trail ? dot(m.trail[0], '#2F9E44') + dot(m.trail[m.trail.length - 1], '#C99A2E') : '');
  const url = miniImgUrl(view);
  img.hidden = true;
  if (!url) return;
  img.onload = () => { img.hidden = false; };
  img.onerror = () => { img.hidden = true; };
  img.src = url;
}

function openShared(m, from = null) {
  sharedModel = m;
  sharedSession = sessionFromModel(m);
  sharedFrom = from;
  run.session = null;
  $('sharedHead').textContent = headline(m);
  $('sharedMeta').textContent = metaLine(m);
  paintSharedMini(m);
  $('sharedDetails').innerHTML = detailSections(m, unitsForText()).map(sec =>
    `<div class="facts"><span class="label">${esc(sec.title)}</span>`
    + sec.rows.map(([k, v]) => `<div class="fact"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')
    + (sec.note ? `<p class="body small muted">${esc(sec.note)}</p>` : '') + '</div>').join('');
  $('sharedNotes').textContent = notes(m).join(' ');
  go('scrShared');
}

function closeShared() {
  if (sharedFrom === 'scrLive') return go('scrLive');
  sharedModel = null; sharedSession = null; pendingSession = null;
  plumeStop(); clearMap();
  boot();
}

/** A link in the address: a shared trail or a live run. Handled before the
    app's own boot, because whoever opened it may have no records at all. */
function openFromHash() {
  const h = location.hash || '';
  const clear = () => history.replaceState(null, '', location.pathname + location.search);
  if (h.startsWith('#t=')) {
    clear();
    decodeShared(h.slice(3)).then(m => openShared(m)).catch(e => { toast(e.message); boot(); });
    return true;
  }
  if (h.startsWith('#live=')) {
    clear();
    openLive(h.slice(6).replace(/[^A-Za-z0-9_-]/g, ''));
    return true;
  }
  return false;
}

/* ── Live: publishing a run, and following one ────────────────────── */
let liveState = null;   // this phone's own live run: { id, url, timer }
let liveWatch = null;   // following someone else's: the unsubscribe
const liveView = { model: null, tick: 0, fitted: false };

function paintLiveBtn() {
  const b = $('btnLive');
  b.hidden = !sync.configured;
  b.classList.toggle('on', !!liveState);
  b.textContent = liveState ? '● Live — send the link again' : 'Share live';
}

async function goLive() {
  if (!sync.user) return toast('Sign in (Settings → Account) to share a run live');
  if (!run.session) return;
  if (!liveState) {
    try {
      const id = await startLive(liveMeta(modelOf(run.session), run.startedAt));
      liveState = { id, url: `${SHARE_BASE}#live=${id}`, timer: setInterval(() => pushLive(rec.pts, rec.wps), 10000) };
      pushLive(rec.pts, rec.wps);
      paintLiveBtn();
    } catch (e) { return toast(e?.message || 'Could not go live'); }
  }
  const { url } = liveState;
  if (navigator.share) {
    try { await navigator.share({ title: 'Trailcraft — live', text: `${S.dog?.name ?? 'The dog'} is running now`, url }); return; }
    catch (e) { if (e?.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(url); toast('Live link copied'); } catch { toast(url); }
}

function liveEnd(result) {
  if (!liveState) return;
  clearInterval(liveState.timer);
  liveState = null;
  paintLiveBtn();
  endLive({ result, track: rec.pts, wps: rec.wps }).catch(() => toast('The live link did not get the result — no signal'));
}

async function openLive(id) {
  clearMap();
  run.session = null; pendingSession = null;
  liveView.model = null; liveView.fitted = false;
  $('liveDot').hidden = false;
  $('liveHudText').textContent = 'Connecting…';
  $('liveNote').textContent = '';
  $('btnLiveDetails').hidden = true;
  go('scrLive');
  clearInterval(liveView.tick);
  liveView.tick = setInterval(paintLiveHud, 1000);
  liveWatch = await watchLive(id, (u) => {
    if (u.error) { $('liveDot').hidden = true; $('liveHudText').textContent = u.error; return; }
    const m = liveModel(u.meta, u.chunks);
    liveView.model = m;
    pendingSession = sessionFromModel(m);
    if (m.kind === 'search') setSrc('hides', pointsOf(m.hides || []));
    else {
      setTrail(m.trail);
      if (m.trail) setSrc('start', pointsOf([m.trail[0]]));
      if (m.contamination.length) setSrc('contam', { type: 'FeatureCollection',
        features: m.contamination.map(c => lineOf(c.points).features[0]).filter(Boolean) });
    }
    setDogTrack(m.track);
    setSrc('wps', pointsOf(m.wps, 'kind'));
    $('btnLiveDetails').hidden = false;
    const fitAll = () => fitTo(m.trail || m.hides || [], m.track || []);
    if (!liveView.fitted) {
      liveView.fitted = true;
      if (mapReady) fitAll(); else map?.once('load', fitAll);
      weatherPanelFor(pendingSession);
    } else if (m.ended) fitAll();
    else if (m.track && mapReady) map.easeTo({ center: [m.track[m.track.length - 1].lon, m.track[m.track.length - 1].lat], duration: 600 });
    paintLiveHud();
  });
}

function paintLiveHud() {
  const m = liveView.model;
  if (!m) return;
  const dog = m.dog?.name ?? 'The dog';
  const last = m.track?.[m.track.length - 1];
  const ago = last ? Math.round((Date.now() - last.t) / 1000) : null;
  $('liveDot').hidden = m.ended;
  $('liveHudText').textContent = m.ended
    ? `${dog} · finished${m.track ? ` · ${fmtKm(pathLen(m.track))}` : ''}`
    : `${dog} · live${m.track ? ` · ${fmtKm(pathLen(m.track))}` : ''}`;
  $('liveNote').textContent = m.ended ? headline(m)
    : !last ? 'Waiting for the first fix…'
    : ago < 15 ? 'Updated just now'
    : ago < 120 ? `Updated ${ago} s ago`
    : `Nothing from the phone for ${Math.round(ago / 60)} min`;
}

function closeLive() {
  liveWatch?.(); liveWatch = null;
  clearInterval(liveView.tick); liveView.tick = 0;
  liveView.model = null;
  pendingSession = null;
  clearMap();
  boot();
}

/* ── The coach ────────────────────────────────────────────────────────
   Decisions come from coach.js. This is the part that has a browser: the
   run's trail and scent field, the sounds, the voice, the pill and the HUD. */
const coach = { on: false, trail: null, field: [], plan: false, state: null, reading: null,
                status: 'on', line: '', tick: 0, sounds: null, unlocked: false,
                everOn: false, used: null, shadow: null };

/* Two silent coaches run on EVERY trail run, blind or assisted: a plain
   corridor and the experimental scent corridor. They never speak; they only
   log what they would have called, so the review can show it — and so the
   scent adjustment can be judged on runs it did not influence. */
const shadowInput = (fix, scent) => ({
  fix, heading: nav.brg, lineM: S.dog?.lineM ?? 0, trail: coach.trail,
  field: scent ? coach.field : [], tolM: Number(settings.coachTol) || 20,
  scent, plan: coach.plan, now: Date.now(),
});
function shadowStep(fix) {
  if (!coach.shadow || !coach.trail) return;
  for (const key of ['plain', 'scent']) {
    const r = coachStep(coach.shadow[key], shadowInput(fix, key === 'scent'));
    coach.shadow[key] = r.state;
    if (r.alert && (r.alert.kind === 'off' || r.alert.kind === 'back')) {
      coach.shadow.log[key].push({ kind: r.alert.kind, t: Date.now() - run.startedAt, metres: r.alert.metres, side: r.alert.side });
    }
  }
}

/** What the run's record keeps about coaching: whether it was assisted, with
    what, how often it spoke — and what the silent coaches would have said. */
function coachSummary() {
  if (!coach.trail) return null;
  const count = (log) => log.filter(a => a.kind === 'off').length;
  return {
    assisted: coach.everOn,
    tolM: coach.used?.tolM ?? (Number(settings.coachTol) || 20),
    scent: !!coach.used?.scent,
    calls: coach.everOn ? (coach.state?.excursions ?? 0) : 0,
    shadow: coach.shadow ? {
      tolM: Number(settings.coachTol) || 20,
      plain: count(coach.shadow.log.plain),
      scent: count(coach.shadow.log.scent),
      plainLog: coach.shadow.log.plain.slice(0, 60),
      scentLog: coach.shadow.log.scent.slice(0, 60),
    } : null,
  };
}

/** The coach line on the result card. */
function coachWords(c) {
  if (!c) return '';
  const n = (k) => `${k} call${k === 1 ? '' : 's'}`;
  if (c.assisted) {
    return `Assisted run — the coach was on with a ${fmtM(c.tolM)} corridor${c.scent ? ' and the experimental scent corridor' : ''}, and made ${n(c.calls ?? 0)}.`;
  }
  const sh = c.shadow;
  if (!sh) return 'Blind run — no prompts.';
  return `Blind run — no prompts. Had the coach been on: ${n(sh.plain)} with a ${fmtM(sh.tolM)} corridor, ${n(sh.scent)} with the scent corridor.`;
}

/** Tones as WAV files played through <audio>, not the Web Audio API: on an
    iPhone a media element plays through the ring/silent switch, and a coach
    that goes quiet because the switch is on silent is no coach. */
function wavUrl(notes) {
  const rate = 22050;
  const total = notes.reduce((n, x) => n + Math.round(x.ms * rate / 1000), 0);
  const pcm = new Int16Array(total);
  let at = 0;
  for (const x of notes) {
    const len = Math.round(x.ms * rate / 1000), fade = rate * 0.008;
    for (let i = 0; i < len; i++) {
      const env = Math.min(1, i / fade, (len - i) / fade);
      pcm[at + i] = Math.sin(2 * Math.PI * x.f * i / rate) * env * (x.gain ?? 0.5) * 32767;
    }
    at += len;
  }
  const buf = new ArrayBuffer(44 + pcm.length * 2);
  const v = new DataView(buf);
  const tag = (o, t) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  tag(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); tag(8, 'WAVE');
  tag(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  tag(36, 'data'); v.setUint32(40, pcm.length * 2, true);
  new Int16Array(buf, 44).set(pcm);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

const SOUNDS = {
  edge: [{ f: 880, ms: 70, gain: 0.35 }, { f: 0, ms: 70 }, { f: 880, ms: 70, gain: 0.35 }],
  off:  [{ f: 660, ms: 140, gain: 0.6 }, { f: 0, ms: 50 }, { f: 520, ms: 180, gain: 0.6 }, { f: 0, ms: 50 }, { f: 520, ms: 180, gain: 0.6 }],
  back: [{ f: 523, ms: 110, gain: 0.5 }, { f: 0, ms: 30 }, { f: 784, ms: 220, gain: 0.5 }],
};
const BUZZ = { edge: [40], off: [120, 80, 120, 80, 220], still: [120, 80, 120, 80, 220], back: [60, 60, 60] };

/** Runs inside the first touch on the page: every sound is started once,
    muted, which is what lets it play later without a touch. */
function audioUnlock() {
  if (coach.unlocked) return;
  coach.unlocked = true;
  try {
    coach.sounds = Object.fromEntries(Object.entries(SOUNDS).map(([k, notes]) => {
      const a = new Audio(wavUrl(notes));
      a.preload = 'auto';
      a.muted = true;
      a.play().then(() => { a.pause(); a.currentTime = 0; a.muted = false; }).catch(() => { a.muted = false; });
      return [k, a];
    }));
  } catch { coach.sounds = null; }
  try {
    if ('speechSynthesis' in window) {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      speechSynthesis.speak(u);
    }
  } catch { /* no voice on this phone */ }
}

function coachSpeak(text) {
  if (!('speechSynthesis' in window)) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = navigator.language || 'en-GB';
    u.rate = 1.05;
    speechSynthesis.speak(u);
  } catch { /* nothing to do */ }
}

function coachDeliver(alert) {
  const kind = alert.kind === 'still' ? 'off' : alert.kind;
  if (settings.coachSound && coach.sounds?.[kind]) {
    const a = coach.sounds[kind];
    try { a.currentTime = 0; a.play().catch(() => {}); } catch { /* not primed */ }
  }
  if (settings.coachVibrate) {
    if (navigator.vibrate) navigator.vibrate(BUZZ[alert.kind] || [80]);
    else haptic(alert.kind);           // the iOS app can; a web page on an iPhone cannot
  }
  if (settings.coachVoice && alert.kind !== 'edge') {
    // After the tone, so the two do not talk over each other.
    setTimeout(() => coachSpeak(coachPhrase(alert, { imperial: imp() })), settings.coachSound ? 450 : 0);
  }
}

const coachInput = (fix) => ({
  fix, heading: nav.brg, lineM: S.dog?.lineM ?? 0, trail: coach.trail,
  field: settings.coachScent ? coach.field : [], tolM: Number(settings.coachTol) || 20,
  scent: !!settings.coachScent, plan: coach.plan, now: Date.now(),
});

function coachStart(s) {
  coachStop();
  const t = targetById(s.targetId);
  coach.trail = t.kind === 'person' && s.data.trail?.length > 1 ? s.data.trail : null;
  coach.plan = !!s.data.plan && !s.data.walked;
  coach.state = initialCoach();
  coach.reading = null; coach.status = 'on'; coach.line = '';
  coach.everOn = false; coach.used = null;
  coach.shadow = coach.trail ? { plain: initialCoach(), scent: initialCoach(), log: { plain: [], scent: [] } } : null;
  const wx = s.data.weather;
  coach.field = wx && coach.trail ? scentField(trailOf(s), wx, run.startedAt) : [];
  if (coach.trail && wx && !surfValid(s)) {
    fillSurfaces(s).then(f => { if (f && run.session?.id === s.id) coach.field = scentField(trailOf(s), wx, run.startedAt); });
  }
  clearInterval(coach.shadowTick);
  coach.shadowTick = coach.trail ? setInterval(() => { if (rec.on) shadowStep(null); }, 1000) : 0;
  coachSync();
}

/** Bring the running coach in line with the settings, without losing its place. */
function coachSync() {
  const want = !!(settings.coachOn && coach.trail && rec.kind === 'run');
  if (want && !coach.on) {
    coach.on = true;
    coach.everOn = true;
    coach.used = { tolM: Number(settings.coachTol) || 20, scent: !!settings.coachScent };
    coach.state ??= initialCoach();
    clearInterval(coach.tick);
    coach.tick = setInterval(() => { if (rec.on) coachApply(coachStep(coach.state, coachInput(null))); }, 1000);
  }
  if (want && coach.on) {
    coach.used = { tolM: Number(settings.coachTol) || 20, scent: !!settings.coachScent || !!coach.used?.scent };
  } else if (!want && coach.on) {
    coach.on = false;
    clearInterval(coach.tick); coach.tick = 0;
    coach.status = 'on'; coach.line = '';
  }
  paintCoachHud();
}

function coachOnFix(pt) {
  shadowStep(pt);
  if (!coach.on) return;
  coachApply(coachStep(coach.state, coachInput(pt)));
}

function coachApply(r) {
  coach.state = r.state;
  coach.reading = r.reading;
  coach.status = r.state.status;
  coach.line = !r.reading ? ''
    : settings.coachShow ? coachLine(r.reading, coach.status, { imperial: imp() })
    : coach.status === 'off' ? 'Off the trail' : '';
  if (r.alert) coachDeliver(r.alert);
  paintCoachHud();
}

function coachStop() {
  clearInterval(coach.tick); coach.tick = 0; clearInterval(coach.shadowTick); coach.shadowTick = 0;
  coach.on = false; coach.trail = null; coach.field = []; coach.state = null; coach.shadow = null;
  coach.reading = null; coach.status = 'on'; coach.line = '';
  try { speechSynthesis?.cancel(); } catch { /* fine */ }
  // The run screen stays up while the result is worked out: leave it calm.
  $('runHud').classList.remove('off');
  const el = $('runHudText'); if (el && rec.kind === 'run') el.textContent = hudText();
  const b = $('btnCoach'); b.hidden = true; b.classList.remove('alert');
}

/** The corridor as the handler reads it: the option's round number. */
function tolLabel(m = settings.coachTol) {
  const opts = TOL_OPTIONS[imp() ? 'imperial' : 'metric'];
  const i = opts.reduce((b, v, k) => (Math.abs(v - m) < Math.abs(opts[b] - m) ? k : b), 0);
  return imp() ? `${[30, 60, 100, 150][i]} ft` : `${opts[i]} m`;
}

function paintCoachHud() {
  const el = $('runHudText');
  if (el && rec.kind === 'run' && rec.on) el.textContent = hudText();
  $('runHud').classList.toggle('off', coach.on && coach.status === 'off');
  const b = $('btnCoach');
  b.hidden = !coach.trail;
  b.classList.toggle('on', coach.on);
  b.classList.toggle('alert', coach.on && coach.status === 'off');
  b.textContent = !coach.on ? 'Blind run' : coach.status === 'off' ? 'Off the trail' : `Coach · ${tolLabel()}`;
}

function paintCoachControls() {
  const opts = TOL_OPTIONS[imp() ? 'imperial' : 'metric'];
  // A value from the other unit system snaps to the nearest round option here.
  const near = opts.reduce((b, v) => (Math.abs(v - settings.coachTol) < Math.abs(b - settings.coachTol) ? v : b), opts[0]);
  if (Math.abs(near - settings.coachTol) > 0.01) { settings.coachTol = near; saveSettings(); }
  for (const id of ['coachOn', 'coachScent', 'coachVoice', 'coachSound', 'coachVibrate', 'coachShow']) {
    $(id).checked = settings[id] !== false;
  }
  $('coachControls').querySelectorAll('[data-tol]').forEach((chip, i) => {
    chip.textContent = imp() ? `${[30, 60, 100, 150][i]} ft` : `${opts[i]} m`;
    chip.classList.toggle('selected', opts[i] === settings.coachTol);
  });
  const on = settings.coachOn !== false;
  $('coachControls').querySelectorAll('[data-coach]').forEach(b => {
    const sel = (b.dataset.coach === '1') === on;
    b.classList.toggle('selected', sel);
    b.setAttribute('aria-checked', String(sel));
  });
  $('coachWhen').classList.toggle('off', !on);
  const canBuzz = typeof navigator.vibrate === 'function' || canHaptic();
  $('coachVibrateRow').hidden = !canBuzz;
  $('coachNote').textContent = canBuzz
    ? 'Turn the volume up. Calls come at most every ten seconds, not for a single stray GPS fix, and twice at most while you stand still.'
    : 'iPhones do not let a web app vibrate, so the coach uses sound and voice. Turn the volume up — the tones play even with the ring/silent switch on silent. Calls come at most every ten seconds, not for a single stray GPS fix, and twice at most while you stand still.';
}

/* The in-run sheet shows the very same controls: the node moves. */
function openCoachSheet() {
  paintCoachControls();
  $('coachSheetBody').append($('coachControls'));
  $('coachSheet').hidden = false;
}
function closeCoachSheet() {
  $('coachHome').append($('coachControls'));
  $('coachSheet').hidden = true;
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

let scanCameFrom = 'scrPick';

async function openScan(from = 'scrPick') {
  scanCameFrom = from;
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
  try { card = await decodeTrail(cardFromText(data)); }
  catch (err) {
    $('scanState').textContent = `${err.message} Still scanning…`;
    toast(err.message);
    return false;
  }

  /* A walked trail belongs to a plan, and it can arrive either way: from the
     button on the result card, or from the phone's camera with no context at
     all. Find the plan it belongs to rather than quietly filing it as a new
     trail — a walk with nothing to compare it against is not a session. */
  if (card.kind === 2) {
    const waiting = scanWalkedFor
      ?? db.sessions().find(x => x.data.plan && !x.data.walked && x.data.track)?.id
      ?? db.sessions().find(x => x.data.plan && !x.data.walked)?.id
      ?? null;
    scanWalkedFor = null;
    stopScan();
    if (!waiting) {
      toast('That is a walked trail, but no plan on this phone is waiting for one');
      return false;
    }
    return applyWalked(waiting, card);
  }
  if (scanWalkedFor) {
    $('scanState').textContent = 'That is a plan, not a walked trail. Still scanning…';
    return false;
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
  guardSave(s, () => db.addSession(s));
  snap();
  toast(`Trail from ${s.data.imported.from} — ${fmtKm(pathLen(card.points))}`);
  // The card carries the REAL laid time; that moment's weather makes ageing true.
  fetchWeather(card.points[0].lat, card.points[0].lon, card.started)
    .then(wx => { db.updateSession(s.id, { data: { ...s.data, weather: wx } }); snap(); })
    .catch(() => { /* offline — joins later */ });
  startRun(s);
  return true;
}

/* ── One dog's record ─────────────────────────────────────────────────
   The question this answers is "is this dog getting better?", and it answers
   it by counting rather than by opinion. Everything here is derived from the
   sessions already on the phone — nothing new is stored, so it cannot drift
   out of step with the runs it describes. */
let dogCardId = null;

/* ── The handler card ─────────────────────────────────────────────────
   Tap the handler already chosen on the home screen and this opens: who
   they are, and everything their runs add up to on this phone. */
let handlerCardId = null;
const fmtHours = (sec) => {
  const m = Math.round(sec / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
};
function ringHtml(st) {
  const total = AGE_BANDS.reduce((n, b) => n + st.bands[b.key], 0);
  if (!total) return `<p class="body small muted">No graded runs yet. The ring fills in as trails are run.</p>`;
  const r = 46, C = 2 * Math.PI * r;
  let off = 0;
  const arcs = AGE_BANDS.map(b => {
    const len = C * st.bands[b.key] / total;
    const el = `<circle class="ring-${b.key}" cx="60" cy="60" r="${r}" fill="none" stroke-width="14" stroke-linecap="butt"
      stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 60 60)"/>`;
    off += len;
    return el;
  }).join('');
  const legend = AGE_BANDS.map(b =>
    `<div class="ring-row"><span class="ring-dot ring-${b.key}"></span><b>${esc(b.label)}</b><span class="ring-n">${st.bands[b.key]}</span><i>${esc(b.blurb)}</i></div>`).join('');
  return `<div class="ring-wrap">
    <svg viewBox="0 0 120 120" class="ring" aria-hidden="true">
      <circle cx="60" cy="60" r="${r}" fill="none" stroke="var(--border)" stroke-width="14"/>${arcs}
      <text x="60" y="57" text-anchor="middle" class="ring-big">${total}</text>
      <text x="60" y="72" text-anchor="middle" class="ring-small">graded</text>
    </svg>
    <div class="ring-legend">${legend}</div>
  </div>` + (st.unknownAge
    ? `<p class="body small muted" style="margin-top:10px">${st.unknownAge} run${st.unknownAge === 1 ? '' : 's'} had no weather, so no age was worked out.</p>` : '');
}
function paintHandlerCard(id) {
  const h = db.handlers.byId(id);
  if (!h) return;
  snap();
  const st = handlerStats(id, S.sessions);
  const dogs = S.dogs.filter(d => d.handlerId === id);
  $('hAva').innerHTML = avaHtml(h, 'big');
  $('hName').textContent = h.name;
  $('hSub').textContent = [
    dogs.length ? `${dogs.length} dog${dogs.length === 1 ? '' : 's'}` : 'No dog yet',
    st.firstAt ? `handling since ${new Date(st.firstAt).toLocaleDateString([], { month: 'short', year: 'numeric' })}` : null,
  ].filter(Boolean).join(' \u00b7 ');
  const cell = (big, small) => `<div class="cell"><b>${big}</b><span>${esc(small)}</span></div>`;
  $('hGrid').innerHTML =
    cell(st.runs, st.runs === 1 ? 'trail run' : 'trails run')
    + cell(st.runs ? fmtKm(st.metres) : '\u2014', 'run in total')
    + cell(st.runs ? fmtHours(st.seconds) : '\u2014', 'on the trail')
    + cell(st.laid, st.laid === 1 ? 'trail laid' : 'trails laid')
    + cell(st.runs ? fmtKm(st.longest) : '\u2014', 'longest run')
    + cell(st.medOff != null ? fmtM(st.medOff) : '\u2014', 'typical distance from the line')
    + (st.assisted + st.blind ? cell(`${st.assisted}\u2009/\u2009${st.blind}`, 'assisted / blind runs') : '');
  $('hRing').innerHTML = ringHtml(st);
  $('hDogsLabel').textContent = dogs.length ? `Dogs \u00b7 ${dogs.length}` : 'Dogs';
  $('hDogs').innerHTML = dogs.length ? dogs.map(d => {
    const n = st.dogs[d.id] || 0;
    return `<div class="card person-row" data-dog-card="${d.id}">${avaHtml(d)}<span class="who"><b>${esc(d.name)}</b><i class="sub">${n} run${n === 1 ? '' : 's'} \u00b7 ${esc(d.level)}</i></span></div>`;
  }).join('') : `<div class="card"><p class="body muted">No dog on this handler yet. Add one from the home screen.</p></div>`;
  const runs = S.sessions.filter(x => x.handlerId === id && x.data?.track);
  $('hRunsLabel').textContent = runs.length ? `Every trail \u00b7 ${runs.length}` : 'Every trail';
  $('hRuns').innerHTML = runs.length ? runs.map(x => {
    const d = S.dogs.find(z => z.id === x.dogId);
    const band = ageBand(x.data.result?.ageMin);
    return `<div class="card" data-open-session="${x.id}">
      <div class="meta"><span>${fmtWhen(x.data.trackStarted ?? x.startedAt)}</span><span>${esc(d?.name ?? '')}${d ? ' \u00b7 ' : ''}${fmtKm(pathLen(x.data.track || []))}${band ? ' \u00b7 ' + esc(band.label) : ''}</span></div>
      <p class="body small">${esc(x.data.result?.sentence ?? x.summary ?? '')}</p>
    </div>`;
  }).join('') : `<div class="card"><p class="body muted">No trail run yet.</p></div>`;
}
function openHandlerCard(id) {
  handlerCardId = id;
  paintHandlerCard(id);
  go('scrHandler');
}

function openDogCard(id) {
  const d = db.dogs.byId(id);
  if (!d) return;
  dogCardId = id;
  snap();
  const st = dogStats(id, S.sessions, db.calibration(id));

  /* innerHTML into a wrapper, never outerHTML on the thing itself: replacing
     an element by its own outerHTML throws away the id the next render needs
     to find it, and the failure only shows on the SECOND open. */
  $('dogAva').innerHTML = avaHtml(d, 'big');
  $('dogName').textContent = d.name;
  const age = dogAge(d.dob);
  $('dogSub').textContent = [d.breed, d.sex, age?.text].filter(Boolean).join(' · ')
    || 'Tap Edit to fill in the details';

  /* Everything that identifies the dog, in one place. A row is only here if
     it has something in it — an empty record padded with dashes reads as a
     form that was never filled in rather than a dog that was never measured. */
  const fact = (k, v) => v ? `<div class="fact"><span>${esc(k)}</span><b>${esc(v)}</b></div>` : '';
  $('dogAbout').innerHTML =
    fact('Breed', d.breed)
    + fact('Sex', d.sex)
    + fact('Age', age ? `${age.text}  ·  born ${new Date(d.dob).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}` : null)
    + fact('Weight', Number.isFinite(d.weightKg) && d.weightKg > 0 ? fmtWeight(d.weightKg, imp()) : null)
    + fact('Microchip', d.chip)
    + fact('Trail level', `${d.level} — ${levelById(d.level).sub}`)
    + fact('Line length', fmtM(d.lineM))
    + fact('First ran', st.firstAt ? new Date(st.firstAt).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) : null)
    || `<p class="body muted">Nothing recorded yet. Tap <b>Edit this dog</b> to add breed, age and weight.</p>`;

  const cell = (big, small) => `<div class="cell"><b>${big}</b><span>${esc(small)}</span></div>`;
  $('dogGrid').innerHTML = st.runs
    ? cell(st.runs, st.runs === 1 ? 'trail run' : 'trails run')
      + cell(fmtKm(st.metres), 'worked in total')
      + cell(fmtKm(st.longest), 'longest single run')
      + cell(st.lastAt ? ageWord(Date.now() - st.lastAt) + ' ago' : '—', 'last run')
    : cell('0', 'trails run') + cell('—', 'worked in total')
      + cell('—', 'longest single run') + cell('—', 'last run');

  /* A bar rather than three numbers: the shape of a dog's training is the
     point, and the shape is what you are looking for. */
  const total = AGE_BANDS.reduce((n, b) => n + st.bands[b.key], 0);
  $('dogBands').innerHTML = total
    ? AGE_BANDS.map(b => {
        const n = st.bands[b.key];
        const pct = Math.round((n / total) * 100);
        return `<div class="band">
          <div class="band-top"><b>${b.label}</b><i>${b.blurb}</i><span>${n}</span></div>
          <div class="band-rail"><span class="band-fill band-${b.key}" style="width:${pct}%"></span></div>
        </div>`;
      }).join('') + (st.unknownAge
        ? `<p class="body small muted">${st.unknownAge} run${st.unknownAge === 1 ? '' : 's'} had no weather, so no age was worked out.</p>`
        : '')
    : `<p class="body small muted">No graded runs yet. The bands fill in as ${esc(d.name)} works trails.</p>`;

  /* An observation of the TRACK, said as such. It is not fed back into the
     scent model: a model tuned to the runs it is asked to explain would only
     learn to agree with them. It stays silent until it has evidence — five
     runs — because a figure from two is a guess wearing a decimal point. */
  const k = db.dogDrift(id);
  $('dogCal').innerHTML = k != null
    ? `Across ${st.calRows} run${st.calRows === 1 ? '' : 's'} with wind, ${esc(d.name)}\u2019s track has sat about
       <b>${fmtM(k, 1)} off the line per m/s of wind</b>, once the trail had aged.
       An observation of the track, not a measurement of scent — it does not change the model.`
    : `Not enough runs with wind yet to say — ${st.calRows} of 5.`;

  /* Every trail, not a recent handful. This is the record — the reason to
     keep one is being able to look back further than you can remember. */
  const runs = S.sessions.filter(x => x.dogId === id && x.data?.track);
  $('dogRunsLabel').textContent = runs.length
    ? `Every trail · ${runs.length}` : 'Every trail';
  $('dogRuns').innerHTML = runs.length ? runs.map(x => {
    const band = ageBand(x.data.result?.ageMin);
    const len = fmtKm(pathLen(x.data.track || []));
    return `<div class="card" data-open-session="${x.id}">
      <div class="meta"><span>${fmtWhen(x.data.trackStarted ?? x.startedAt)}</span>
        <span>${band ? `${band.label} · ` : ''}${len}</span></div>
      <div class="story">${esc(x.summary || '')}</div>
    </div>`;
  }).join('') : `<div class="card"><p class="body muted">Nothing run yet.</p></div>`;

  go('scrDog');
}

/* ── Settings ─────────────────────────────────────────────────────── */
function renderSettings() {
  snap();
  $('setPeople').innerHTML = S.handlers.map(h => {
    const team = S.dogs.filter(d => d.handlerId === h.id);
    return `<div class="card set-card">
      <button class="set-row" data-edit-handler="${h.id}">${avaHtml(h)}<span class="who"><b>${esc(h.name)}</b></span></button>
      ${team.map(d => `<button class="set-row" data-dog-card="${d.id}">${avaHtml(d)}<span class="who"><b>${esc(d.name)}</b><i>${esc(d.level)} · ${fmtM(d.lineM)} line</i></span></button>`).join('')}
      <button class="btn ghost small" data-add-dog-for="${h.id}">Add a dog for ${esc(h.name)}</button>
    </div>`;
  }).join('') + `<button class="btn ghost small" id="setAddHandler">Add handler</button>`;

  $('setLayers').innerHTML = (S.layers.length
    ? S.layers.map(l => `<div class="card set-card"><button class="set-row" data-edit-layer="${l.id}">${avaHtml(l)}<span class="who"><b>${esc(l.name)}</b></span></button></div>`).join('')
    : `<p class="body small muted">None yet.</p>`)
    + `<button class="btn ghost small" id="setAddLayer">Add person</button>`;

  $('plumeOn').checked = settings.plume !== false;
  paintCoachControls();
  paintStorageLine();
  paintColourRows();
  paintUnitSettings();
  paintAppearance();
  renderAccount();
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

/* ── Appearance ───────────────────────────────────────────────────────
   Device default follows the phone, including when the phone changes its
   mind at sunset. The attribute is always the RESOLVED theme, so a dark
   phone on "Device default" gets exactly the same dark as choosing Dark. */
const darkQuery = matchMedia('(prefers-color-scheme: dark)');
const resolvedTheme = () => settings.theme === 'dark' ? 'dark'
  : settings.theme === 'light' ? 'light'
  : (darkQuery.matches ? 'dark' : 'light');

function applyTheme() {
  const t = resolvedTheme();
  document.documentElement.dataset.theme = t;
  $('themeColor')?.setAttribute('content', t === 'dark' ? '#0B1630' : '#F6F7FA');
  paintAppearance();
}
darkQuery.addEventListener?.('change', () => { if (settings.theme === 'system') applyTheme(); });

function paintAppearance() {
  const list = $('appearanceSettings');
  if (!list) return;
  const phone = darkQuery.matches ? 'dark' : 'light';
  const example = {
    system: `Follows your phone — ${phone} right now`,
    light: 'Paper and moss, best in bright sun',
    dark: 'Night field, easier on the eyes at dawn and dusk',
  };
  list.querySelectorAll('.check-row').forEach(row => {
    const on = row.dataset.value === settings.theme;
    row.classList.toggle('on', on);
    row.setAttribute('aria-pressed', String(on));
    const ex = row.querySelector('[data-theme-example]');
    if (ex) ex.textContent = example[row.dataset.value] ?? '';
  });
}

/* ── Units ────────────────────────────────────────────────────────────
   Three separate choices, because they are three separate habits: plenty of
   handlers think in miles and Celsius at once, and a coordinate format is
   about whoever the location is being sent to.

   Each option shows the app's own numbers in that form, so the choice is
   made by looking rather than by knowing what "DMS" stands for. */
function paintUnitSettings() {
  const lastStart = S.sessions.find(x => x.data?.trail?.length)?.data.trail[0];
  const here = lastStart ?? { lat: 51.2094, lon: -2.6449 };
  const example = {
    metric: `${fmtDist(1240, false)} trail · ${fmtShort(9.2, false, 1)} off the line · ${fmtSpeed(3.3, false)} wind`,
    imperial: `${fmtDist(1240, true)} trail · ${fmtShort(9.2, true, 1)} off the line · ${fmtSpeed(3.3, true)} wind`,
    c: `${fmtTemp(19, false)} air · ${fmtTemp(11, false)} soil`,
    f: `${fmtTemp(19, true)} air · ${fmtTemp(11, true)} soil`,
    dd: fmtCoord(here.lat, here.lon, 'dd'),
    dms: fmtCoord(here.lat, here.lon, 'dms'),
  };
  $('unitSettings').querySelectorAll('[data-setting]').forEach(list => {
    const chosen = settings[list.dataset.setting];
    list.querySelectorAll('.check-row').forEach(row => {
      const on = row.dataset.value === chosen;
      row.classList.toggle('on', on);
      row.setAttribute('aria-pressed', String(on));
    });
  });
  $('unitSettings').querySelectorAll('[data-example]').forEach(el => {
    el.textContent = example[el.dataset.example] ?? '';
  });
}

/* ── Account ──────────────────────────────────────────────────────────
   Signing in is optional and stays optional: the app is whole without it.
   What it adds is that the records survive the phone. */
let signInFirstLaunch = false;

function openSignIn({ firstLaunch = false } = {}) {
  signInFirstLaunch = firstLaunch;
  $('btnApple').hidden = !sync.apple;
  $('btnSkipSignIn').textContent = firstLaunch ? 'Use without an account' : 'Not now';
  $('signInError').hidden = true;
  go('scrSignIn');
}

function when(t) {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
}

function renderAccount() {
  const card = $('accountCard');
  if (!card) return;
  if (!sync.configured) {
    card.innerHTML = `<p class="body">Backup and sync</p>
      <p class="body small muted">Not switched on yet. Your trails are on this phone only.</p>`;
  } else if (!sync.user) {
    card.innerHTML = `<p class="body small muted">Sign in to back up your dogs and trails, and have them on any phone.</p>
      <button type="button" class="btn moss" data-account="signin">Sign in</button>`;
  } else {
    const u = sync.user;
    const dot = sync.status === 'synced' ? 'ok' : sync.status === 'error' ? 'bad' : 'busy';
    const line = sync.status === 'synced' ? `Backed up ${when(sync.lastSync)}`
      : sync.status === 'error' ? esc(sync.error || 'Not backed up')
      : 'Backing up…';
    const face = u.photo
      ? `<img src="${esc(u.photo)}" alt="" referrerpolicy="no-referrer">`
      : avaHtml({ name: u.name || u.email || '?' });
    card.innerHTML = `<div class="account-who">${face}<div><b>${esc(u.name || 'Signed in')}</b><i>${esc(u.email || '')}</i></div></div>
      <div class="sync-line"><span class="sync-dot ${dot}"></span><span>${line}</span></div>
      <button type="button" class="btn ghost small" data-account="signout">Sign out</button>`;
  }
  // The privacy line says what is actually true right now.
  const where = $('dataWhere');
  if (where) where.textContent = sync.user
    ? 'Everything lives on this phone, and is backed up to your account. Only you can read it.'
    : 'Everything lives on this phone. Nothing is uploaded.';
}

onSync((st) => {
  renderAccount();
  const err = $('signInError');
  if (err) { err.textContent = st.error || ''; err.hidden = !st.error || $('scrSignIn').hidden; }
  /* Signed in from the sign-in screen and the account had records: they are
     on the phone now, so carry on as if they had always been there. */
  if (st.user && st.status === 'synced' && !$('scrSignIn').hidden) {
    db.kv.set('signInAnswered', true);
    snap();
    if (signInFirstLaunch) return boot();
    renderSettings();
    go('scrSettings');
  }
});

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
  $('obHandlerNext').addEventListener('click', () => saveHandlerForm());
  $('obHandlerLayOnly').addEventListener('click', () => saveHandlerForm(true));
  $('obDogUnits').addEventListener('click', (e) => { const b = e.target.closest('[data-units]'); if (b) setDogUnits(b.dataset.units); });
  $('coachModeRow').addEventListener('click', (e) => {
    const b = e.target.closest('[data-coach]');
    if (!b) return;
    const want = b.dataset.coach === '1';
    if ($('coachOn').checked !== want) { $('coachOn').checked = want; $('coachOn').dispatchEvent(new Event('change', { bubbles: true })); }
    paintCoachControls();
  });
  $('obDogPhoto').addEventListener('click', () => photoTo('obDogAva'));
  $('obDogPhoto2').addEventListener('click', () => photoTo('obDogAva'));
  $('obDogSex').addEventListener('click', (e) => {
    const b = e.target.closest('[data-sex]');
    if (b) { obDogSex = obDogSex === b.dataset.sex ? null : b.dataset.sex; paintDogSex(); }
  });
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
  /* Saved as it is typed and never repainted from here: the rows stay put and
     the keyboard stays up until the handler is finished with it. */
  $('otherTarget').addEventListener('input', (e) => {
    db.kv.set(`odour.${S.target.id}`, e.target.value.trim().slice(0, 40));
    snap();
  });
  $('otherTarget').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
  $('scrHome').addEventListener('click', (e) => {
    const h = e.target.closest('[data-handler]');
    if (h) {
      if (h.classList.contains('selected')) return openHandlerCard(h.dataset.handler);   // the chosen one again: their card
      db.kv.set('lastHandlerId', h.dataset.handler); return renderHome();
    }
    if (e.target.closest('[data-add-handler]')) return openHandlerForm({ returnTo: 'scrHome' });
    const d = e.target.closest('[data-dog]');
    if (d) {
      /* Tapping another dog picks it; tapping the one already picked opens
         its record. Selecting has to stay a single tap — it is the thing
         done most — so the card hangs off the tap that currently does
         nothing at all.

         The test is what the chip LOOKS like, not what a snapshot says it
         should be: the handler is answering the screen in front of them. */
      if (d.classList.contains('selected')) return openDogCard(d.dataset.dog);
      db.kv.set('lastDogId', d.dataset.dog);
      return renderHome();
    }
    if (e.target.closest('[data-add-dog]')) return openDogForm({ returnTo: 'scrHome' });
    const t = e.target.closest('[data-target]');
    if (t) {
      db.kv.set('lastTargetId', t.dataset.target);
      odourTyping = false;
      $('otherTarget').blur();      // let go first, or it keeps the last target's word
      renderHome();
      /* Inside the tap, or an iPhone will not raise the keyboard. */
      if (t.dataset.target === 'other') $('otherTarget').focus();
      return;
    }
    const od = e.target.closest('[data-odour]');
    if (od) { odourTyping = false; db.kv.set(`odour.${S.target.id}`, od.dataset.odour); return renderHome(); }
    if (e.target.closest('[data-odour-other]')) {
      odourTyping = true;
      if (ODOURS[S.target.id]?.list.includes(S.odour)) db.kv.set(`odour.${S.target.id}`, '');
      renderHome();
      return $('otherTarget').focus();
    }
    const lv = e.target.closest('[data-trail-level]');
    if (lv) { db.kv.set('lastLevel', lv.dataset.trailLevel); return renderHome(); }
    const l = e.target.closest('[data-layer]');
    if (l) { db.kv.set('lastLayerId', l.dataset.layer || null); return renderHome(); }
    if (e.target.closest('[data-add-layer]')) return openLayerForm({ returnTo: 'scrHome' });
    const open = e.target.closest('[data-open-session]');
    if (open) return openSession(open.dataset.openSession);
  });
  $('btnLay').addEventListener('click', () => {
    const solo = S.layerOnly && !S.dog;          // here to lay for someone else's dog
    if (!S.dog && !solo) return toast('Add a dog first');
    /* A person trail needs a person. You cannot be the handler and the one
       being found — somebody has to walk away and wait to be reached. */
    if (S.target.kind === 'person' && !S.layer && !solo) {
      return toast('Choose who lays the trail — it cannot be you');
    }
    startLay();
  });
  $('btnRun').addEventListener('click', () => { if (S.dog) openPick(); else toast('Add a dog first'); });

  // Lay
  /* Start means "begin laying", and for a person trail that is drawing the
     line with a finger — the layer walks it afterwards, guided by their own
     phone, and their GPS is the one that records what was really walked.
     Two buttons here only ever asked the handler a question they had already
     answered on the home screen. */
  $('btnLayStart').addEventListener('click', () => {
    if (S.target.kind === 'person') return openDraw();
    layStart();
  });
  $('btnLayStop').addEventListener('click', layStop);
  $('btnLayCancel').addEventListener('click', async () => {
    await stopWatch();
    stopFollowing();
    plumeStop();
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
  $('shareWhere').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-copy]');
    if (!b) return;
    try {
      await navigator.clipboard.writeText(b.dataset.copy);
      toast('Copied');
    } catch {
      toast(b.dataset.copy);          // no clipboard: at least show it big enough to read out
    }
  });
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

  // Draw a plan — reached from Start on the lay screen.
  /* Custom opens a field in the card, not a system prompt. window.prompt is
     blocked outright in a home-screen web app on iOS, which is exactly where
     this runs — the button looked like it did nothing because it could not
     do anything. */
  $('ageRow').addEventListener('click', (e) => {
    const b = e.target.closest('[data-age]');
    if (!b) return;
    if (b.dataset.age === 'custom') {
      $('ageCustom').hidden = false;
      $('ageMins').value = String(draw.ageMin);
      $('ageMins').focus();
      $('ageMins').select?.();
      return;
    }
    draw.ageMin = Number(b.dataset.age);
    $('ageCustom').hidden = true;
    paintAge();
  });
  const setCustomAge = () => {
    const mins = Number($('ageMins').value);
    if (!Number.isFinite(mins) || mins < 0 || mins > 1440) return toast('Between 0 and 1440 minutes');
    draw.ageMin = Math.round(mins);
    $('ageCustom').hidden = true;
    paintAge();
  };
  $('ageSet').addEventListener('click', setCustomAge);
  $('ageMins').addEventListener('keydown', (e) => { if (e.key === 'Enter') setCustomAge(); });
  $('drawUndo').addEventListener('click', () => { draw.pts.pop(); paintDraw(); });
  $('drawCancel').addEventListener('click', () => { closeDraw(); clearMap(); go('scrHome'); });
  $('drawSave').addEventListener('click', () => { if (draw.pts.length > 1) drawStep('age'); });
  $('drawConfirm').addEventListener('click', saveDrawPlan);
  $('drawBack').addEventListener('click', () => drawStep('map'));

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

  $('btnRecentre').addEventListener('click', locateTap);

  // The layer's walk
  $('btnInPlace').addEventListener('click', finishWalk);
  $('walkCancel').addEventListener('click', async () => {
    if (rec.pts.length > 1 && !confirm('Cancel this walk? The handler gets no walked card.')) return;
    await stopWatch();
    stopFollowing();
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
  $('btnScan').addEventListener('click', () => openScan('scrPick'));
  $('btnScanWalked').addEventListener('click', () => {
    if (!run.session) return;
    scanWalkedFor = run.session.id;
    openScan('scrResult');
  });
  $('btnPickBack').addEventListener('click', () => go('scrHome'));
  $('btnScanHome').addEventListener('click', () => openScan('scrHome'));
  $('btnScanBack').addEventListener('click', () => {
    stopScan();
    if (scanWalkedFor) { scanWalkedFor = null; return go('scrResult'); }
    if (scanCameFrom === 'scrHome') return go('scrHome');
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
  $('btnCoach').addEventListener('click', openCoachSheet);
  $('btnCoachDone').addEventListener('click', closeCoachSheet);
  $('saveRetry').addEventListener('click', retrySave);
  $('wxRose').addEventListener('click', () => headingStart({ gesture: true, loud: true }));
  /* An iPhone browser only hands out its compass after being asked inside a
     tap. Nobody knows to tap a compass, so the first tap on any map screen
     asks — once; after a no, only the compass itself asks again. */
  document.addEventListener('click', (e) => {
    if (e.target.closest?.('#wxRose')) return;          // its own tap asks out loud; this one must not get in first
    if (!compass.on && MAP_SCREENS.includes(currentScreen)) headingStart({ gesture: true });
  }, true);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) headingStop();
    else if (MAP_SCREENS.includes(currentScreen)) headingStart();
  });
  $('saveLater').addEventListener('click', () => { $('saveTrouble').hidden = true; });
  $('saveLink').addEventListener('click', () => saveTrouble?.session && sendLink(modelOf(saveTrouble.session)));
  $('saveGpx').addEventListener('click', () => saveTrouble?.session && saveGpx(modelOf(saveTrouble.session)));
  // A save that fails somewhere unguarded (a weather update, a preference) still gets said.
  const netSave = (e) => { const err = e.reason ?? e.error; if (err?.name === 'SaveError') { e.preventDefault?.(); saveTrouble = { session: null, retry: null, err }; showSaveTrouble(err); } };
  window.addEventListener('unhandledrejection', netSave);
  window.addEventListener('error', netSave);
  $('coachControls').addEventListener('change', (e) => {
    const box = e.target.closest('input[type="checkbox"]');
    if (!box) return;
    settings[box.id] = box.checked;
    saveSettings();
    coachSync();
  });
  $('coachControls').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-tol]');
    if (!chip) return;
    settings.coachTol = TOL_OPTIONS[imp() ? 'imperial' : 'metric'][Number(chip.dataset.tol)];
    saveSettings();
    paintCoachControls();
    paintCoachHud();
  });
  // Sound and speech are only allowed after a touch: the first one anywhere unlocks them.
  document.addEventListener('pointerdown', audioUnlock, { once: true });
  $('wpRow').addEventListener('click', (e) => {
    const b = e.target.closest('[data-wp]');
    if (b) addWaypoint(b.dataset.wp);
  });

  // Result
  $('btnShowMap').addEventListener('click', () => showOnMap('scrResult'));
  $('btnSharePlume').addEventListener('click', () => {
    if (pendingSession) { run.session = null; showOnMap('scrShare'); }
  });
  $('btnShowMapBack').addEventListener('click', () => { plumeStop(); go(mapCameFrom); });

  // Sharing beyond this phone
  $('btnShareOut').addEventListener('click', () => run.session && openShareOut(run.session, 'scrResult'));
  $('btnShareMore').addEventListener('click', () => pendingSession && openShareOut(pendingSession, 'scrShare'));
  $('btnShareOutBack').addEventListener('click', () => go(shareOutFrom));
  $('btnSendLink').addEventListener('click', () => shareOutSession && sendLink(modelOf(shareOutSession)));
  $('btnSaveGpx').addEventListener('click', () => shareOutSession && saveGpx(modelOf(shareOutSession)));
  $('btnSavePdf').addEventListener('click', () => shareOutSession && savePdf(modelOf(shareOutSession)));
  $('btnSharedMap').addEventListener('click', () => { if (sharedSession) { pendingSession = sharedSession; showOnMap('scrShared'); } });
  $('btnSharedGpx').addEventListener('click', () => sharedModel && saveGpx(sharedModel));
  $('btnSharedPdf').addEventListener('click', () => sharedModel && savePdf(sharedModel));
  $('btnSharedClose').addEventListener('click', closeShared);
  $('btnLive').addEventListener('click', goLive);
  $('btnLiveDetails').addEventListener('click', () => liveView.model && openShared(liveView.model, 'scrLive'));
  $('btnLiveClose').addEventListener('click', closeLive);
  $('btnResDone').addEventListener('click', () => { clearMap(); go('scrHome'); });

  // Sessions
  $('dogBack').addEventListener('click', () => go('scrHome'));
  $('hBack').addEventListener('click', () => go('scrHome'));
  $('hEdit').addEventListener('click', () => { if (handlerCardId) openHandlerForm({ id: handlerCardId, returnTo: 'scrHandler' }); });
  $('hDogs').addEventListener('click', (e) => { const dc = e.target.closest('[data-dog-card]'); if (dc) openDogCard(dc.dataset.dogCard); });
  $('hRuns').addEventListener('click', (e) => { const open = e.target.closest('[data-open-session]'); if (open) openSession(open.dataset.openSession); });
  $('dogEdit').addEventListener('click', () => {
    const d = db.dogs.byId(dogCardId);
    if (d) openDogForm({ id: d.id, handlerId: d.handlerId, returnTo: 'scrHome' });
  });
  $('dogRuns').addEventListener('click', (e) => {
    const open = e.target.closest('[data-open-session]');
    if (open) openSession(open.dataset.openSession);
  });

  $('btnSessBack').addEventListener('click', () => { renderSettings(); go('scrSettings'); });
  $('sessionList').addEventListener('click', (e) => {
    const open = e.target.closest('[data-open-session]');
    if (open) openSession(open.dataset.openSession);
  });

  // Settings
  $('btnSetDone').addEventListener('click', () => go('scrHome'));
  $('btnAllSessions').addEventListener('click', () => { renderSessions(); go('scrSessions'); });
  $('btnTutorial').addEventListener('click', () => openTutorial(true));
  $('btnMapTut').addEventListener('click', openMapTut);

  /* The bench. Delegated, because the sheet is drawn from the registry and
     re-drawn whenever a group folds — listeners bound to each slider would
     be lost every repaint. `input` fires all the way through a drag, which
     is the whole point: the picture must move under the finger. */
  $('btnReplay').addEventListener('click', () => openReplay(run.session ?? pendingSession));
  $('repBack').addEventListener('click', () => { closeReplay(); go('scrResult'); });
  $('repPlay').addEventListener('click', () => (replay.playing ? replayPause() : replayPlay()));
  $('repSpeed').addEventListener('click', () => {
    const i = (REPLAY_SPEEDS.indexOf(replay.speed) + 1) % REPLAY_SPEEDS.length;
    replay.speed = REPLAY_SPEEDS[i];
    $('repSpeed').textContent = `${replay.speed}\u00d7`;
  });
  /* Dragging is scrubbing: take the clock off the playhead the moment a
     finger lands, or play and drag fight each other. */
  $('repScrub').addEventListener('pointerdown', replayPause);
  $('repScrub').addEventListener('input', (e) => {
    if (!replay.s) return;
    const f = Number(e.target.value) / 1000;
    replay.at = replay.from + f * (replay.to - replay.from);
    paintReplay();
  });

  $('btnBench').addEventListener('click', openBench);
  $('benchDone').addEventListener('click', () => { closeBench(); go('scrSettings'); });
  $('benchGrab').addEventListener('click', () => {
    bench.open = !bench.open;
    $('benchSheet').classList.toggle('open', bench.open);
    $('benchGrab').setAttribute('aria-expanded', String(bench.open));
    styleGap();
  });
  $('benchReset').addEventListener('click', () => {
    resetParams();
    paintBench();
    benchPaint();
    toast('Every dial back to the number it shipped with');
  });
  $('benchBody').addEventListener('input', (e) => {
    const id = e.target.dataset?.set;
    if (!id || !setParam(id, e.target.value)) return;
    const d = dialById(id);
    const out = $('benchBody').querySelector(`[data-val="${id}"]`);
    if (out) out.textContent = fmtDial(d, PV[id]);
    e.target.closest('.dial')?.classList.toggle('moved', PV[id] !== d.def);
    /* The particle cloud is rebuilt only when a dial changes what a particle
       IS — count, spacing, life. Everything else the running tick absorbs,
       and reseeding on every frame of a drag would strobe. */
    if (['perPoint', 'poolParts', 'sampleM', 'age', 'dwell'].includes(id)) benchPaint();
    else benchPaintLight();
  });
  $('mapTutNext').addEventListener('click', () => { if (mapTut.i >= MAP_TUT.length - 1) closeMapTut(); else { mapTut.i++; paintMapTut(); } });
  $('mapTutSkip').addEventListener('click', closeMapTut);
  $('btnGpsCheck').addEventListener('click', gpsCheck);
  $('scrSettings').addEventListener('click', (e) => {
    const eh = e.target.closest('[data-edit-handler]');
    if (eh) return openHandlerForm({ id: eh.dataset.editHandler, returnTo: 'scrSettings' });
    const dc = e.target.closest('[data-dog-card]');
    if (dc) return openDogCard(dc.dataset.dogCard);
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
  $('appearanceSettings').addEventListener('click', (e) => {
    const row = e.target.closest('.check-row');
    if (!row) return;
    settings.theme = row.dataset.value;
    saveSettings();
    applyTheme();
  });
  $('btnGoogle').addEventListener('click', () => signInWithGoogle());
  $('btnApple').addEventListener('click', () => signInWithApple());
  $('btnSkipSignIn').addEventListener('click', () => {
    db.kv.set('signInAnswered', true);
    if (signInFirstLaunch) return boot();
    go('scrSettings');
  });
  $('accountCard').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-account]');
    if (!b) return;
    if (b.dataset.account === 'signin') return openSignIn();
    if (b.dataset.account === 'signout') {
      if (!confirm('Sign out? Your trails stay on this phone; they just stop backing up.')) return;
      await signOut();
      toast('Signed out — everything is still on this phone');
    }
  });
  $('unitSettings').addEventListener('click', (e) => {
    const row = e.target.closest('.check-row');
    const list = row?.closest('[data-setting]');
    if (!row || !list) return;
    settings[list.dataset.setting] = row.dataset.value;
    saveSettings();
    paintUnitSettings();
    paintCoachControls();
  });
  $('plumeOn').addEventListener('change', () => {
    settings.plume = $('plumeOn').checked;
    saveSettings();
    if (!settings.plume) plumeStop();
  });
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

/* A link the camera app opened: the card is in the fragment, which never
   left this phone. Take it, then strip it from the address so a reload does
   not import the same trail twice and it stops trailing around in history. */
async function importFromLink() {
  const raw = location.hash || '';
  if (!raw.startsWith('#c=')) return false;
  const card = cardFromText(raw);
  history.replaceState(null, '', location.pathname + location.search);
  if (!card.startsWith('TC')) return false;
  return handleCard(card);
}

/* ── Boot ─────────────────────────────────────────────────────────── */
function boot() {
  applyTheme();          // the head script already painted it; this keeps it in step
  snap();
  if (openFromHash()) return;   // a trail someone sent: that first, the app's own business after
  /* A brand-new phone is offered sign-in before anything else, because if
     there is an account, everything the handler set up on their last phone
     comes back and onboarding is not needed at all. Offered once: "use
     without an account" is a real answer and is remembered. */
  if (!S.handler && sync.configured && !db.kv.get('signInAnswered')) {
    return openSignIn({ firstLaunch: true });
  }
  if (!S.handler) return openHandlerForm({ firstLaunch: true });
  if (!S.team.length && !S.dogs.length && !S.layerOnly) return openDogForm({ firstLaunch: true });
  if (!S.tutorialDone) return openTutorial(false);
  go('scrHome');
  importFromLink();
}

/* The colour swatches in Settings: a tap on a preset, or the picker at the end. */
for (const [id, key] of [['plumeRow', 'plumeColor'], ['stepRow', 'stepColor'], ['dogRow', 'dogColor'], ['windRow', 'windColor']]) {
  $(id).addEventListener('click', (e) => { const b = e.target.closest('[data-colour]'); if (b) setColour(key, b.dataset.colour); });
  $(id).addEventListener('input', (e) => { if (e.target.type === 'color') setColour(key, e.target.value); });
}
/* Custom unfolds a row of choices; the style buttons pick how a track is drawn. */
$('lookCard').addEventListener('click', (e) => {
  const c = e.target.closest('[data-custom]');
  if (c) {
    const r = document.getElementById(c.dataset.custom);
    r.hidden = !r.hidden;
    c.textContent = r.hidden ? 'Custom' : 'Done';
    return;
  }
  const ts = e.target.closest('[data-trail-style]');
  if (ts) return setLook('trailStyle', ts.dataset.trailStyle);
  const ds = e.target.closest('[data-dog-style]');
  if (ds) return setLook('dogStyle', ds.dataset.dogStyle);
});
/* The map style button and its three choices; tapping anywhere else folds them away. */
$('btnMapStyle').addEventListener('click', toggleStylePick);
$('stylePick').addEventListener('click', (e) => { const b = e.target.closest('[data-style]'); if (b) setMapStyle(b.dataset.style); });
document.addEventListener('pointerdown', (e) => {
  if (!$('stylePick').hidden && !e.target.closest('#stylePick, #btnMapStyle')) closeStylePick();
});
window.addEventListener('resize', styleGap);
if ('ResizeObserver' in window) {
  for (const id of MAP_SCREENS) { const bar = $(id)?.querySelector('.glass-bottom'); if (bar) new ResizeObserver(styleGap).observe(bar); }
}
$('wxNote').addEventListener('click', () => { if (!wxNow.wx) weatherPanelFor(run.session ?? pendingSession); });

/* The arrow, placed once on every page that can be left. */
for (const id of BACKABLE) {
  const page = $(id)?.querySelector('.page');
  if (!page || page.querySelector('.back-btn')) continue;
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'back-btn';
  b.setAttribute('aria-label', 'Back');
  b.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M14.5 5.5 8 12l6.5 6.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  b.addEventListener('click', goBack);
  page.prepend(b);
}
buildMap();
wire();
initSync(db);            // does nothing until a Firebase config exists; before boot so a live link can wait on it
boot();
checkForUpdate();
if (migrated) toast('Your team and trails came along to the new Trailcraft');
if (!settings.mbToken) setTimeout(() =>
  toast('Basic map — paste your Mapbox token in Settings for satellite & 3D'), 1500);

if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* cache is a bonus */ });
  /* A new version takes over the cache at once (the worker skips waiting and
     claims the page), but the page keeps running the old code until it
     reloads. Reload for them when they are idle on the home screen; anywhere
     else, say so and the next open has it. Never on the very first install —
     there is nothing to replace, and someone may be typing their name. */
  const hadSw = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadSw) return;
    if (currentScreen === 'scrHome' && !rec.on) location.reload();
    else toast('A new version is ready \u2014 it loads next time you open the app');
  });
}
