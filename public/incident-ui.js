/* An incident on the squad map: Command starts it, every member is told and
   shown the map, the K9 team's trail and calls appear as they happen, the
   others draw a perimeter and drop points round it, and once it is ended it
   can be played back for the debrief.

   It draws on top of the command map (squad-ui.js onCommandPaint) and works
   the same way for a real squad in the cloud and for the pretend one the
   demo runs on this device. The rules of it are in incident.js, the cloud in
   incident-cloud.js.

   Incident names, call signs and labels were typed on other people's
   phones. They reach the page through textContent, or through html``
   (squad-ui.js), which escapes every value put into it. */

import { isCommand } from './squad.js';
import { project } from './geo.js';
import { MARKS, countWords, DRAW_TOOLS, RUN_MARKS, LINE_MAX, activeOf, pastOf, trailInfo, aheadLine, elapsedWords, clockWords,
         metresWords, summarise, mayMark, mayUnmark, mayShareRun, trackBuffer, buildReplay, replayAt, createSimIncident,
         cleanIncidentName } from './incident.js';
import { startIncident, endIncident, watchIncidents, watchIncident, putMark, removeMark, putTrack,
         loadIncident } from './incident-cloud.js';
import { html, put, onCommandPaint, commandView, onSquadChange, onPositionSent, setViewOverride, squadState,
         openCommand, viewNow, fitOnMap, paintCommandNow, setSimSpeed, setLeadUnit, foldPanel } from './squad-ui.js';

const EMPTY = { type: 'FeatureCollection', features: [] };
const SIM_ME = 'you';
/* How often a member's movements go to the cloud during an incident: the
   trailing team's often, as everyone watches that line grow; the rest once a
   minute, as nobody looks at those until the debrief. */
const TRAIL_FLUSH_MS = 10e3;
const TRACK_FLUSH_MS = 60e3;

let ctx = null;
const I = {
  sid: null,                // the squad followed
  incidents: new Map(),     // every incident of the squad, active and ended
  active: null,             // the one in force
  marks: new Map(),
  trail: [],                // the K9 team's line
  stopAll: null, stopOne: null,
  seen: new Set(),          // incidents already announced on this phone
  hidden: new Set(),        // banners put away by the person
  sim: null,                // the pretend incident
  simEnded: null,           // the last pretend incident, ended, for its replay
  form: null,               // { name, lkp, k9Uid } while Command fills it in
  tool: null,               // { kind, pts } while drawing
  replay: null,             // { rp, t, playing, speed, timer, scene }
  on: false,                // drawing on the command map
  markers: new Map(),       // mark id → { marker, el, sig }
  pins: new Map(),          // 'lkp' | 'form' → marker
  panelKey: '',
  buf: null, bufFor: null, flushAt: 0,
  run: { for: 0, idx: 0, wps: 0 },
  consent: null,            // the incident this phone's handler pressed Start trailing for
  tick: 0,
  foldedFor: null,          // the incident the phone's panel was folded for, once
};
/* The last pretend incident, ended, with the pretend squad it ran on: kept
   when the map closes, so the debrief replay is not lost to one tap on
   Close. Cleared when a new pretend incident starts. */
let lastSim = null;

const $ = (id) => ctx.$(id);
const map = () => ctx.getMap();
const sq = () => squadState();
const meUid = () => (sq().sim ? SIM_ME : sq().me);
const amCommand = () => !!sq().sim || isCommand(sq().member);

/* ── Which incident is on the map ─────────────────────────────────────── */
/** The incident drawn right now: the replay's, the pretend one, or the
    squad's own, with its marks and the trail so far. */
function shown() {
  if (I.replay) {
    const s = I.replay.scene || replayAt(I.replay.rp, I.replay.t);
    return { inc: I.replay.rp.inc, marks: s.marks, trail: s.trail, now: I.replay.t, replay: true };
  }
  if (sq().sim) {
    const si = I.sim;
    return si ? { inc: si.inc, marks: [...si.marks.values()], trail: si.trail, now: viewNow(), sim: true }
              : { inc: null, marks: [], trail: [], now: viewNow(), sim: true };
  }
  return { inc: I.active, marks: [...I.marks.values()], trail: I.trail, now: Date.now() };
}

/** Who a uid is, in the words of the map: a call sign. */
function who(uid, members) {
  if (uid === SIM_ME && sq().sim) return 'You';
  const m = members?.get(uid);
  return m ? m.callSign : 'A member';
}

/* ── Following the squad's incidents ─────────────────────────────────── */
async function follow(sid) {
  I.stopAll?.(); I.stopAll = null;
  I.stopOne?.(); I.stopOne = null;
  I.incidents = new Map(); I.active = null; I.marks = new Map(); I.trail = [];
  stopContributing();
  I.sid = sid;
  if (!sid) return paintOutside();
  let h;
  try { h = await ctx.handle(); } catch { h = null; }
  if (!h || I.sid !== sid) return;
  I.stopAll = watchIncidents(h, sid, (all) => {
    if (I.sid !== sid) return;
    I.incidents = all;
    const a = activeOf(all);
    if (a?.id !== I.active?.id) setActive(h, sid, a);
    else I.active = a;
    paintOutside();
    if (sq().view) paintCommandNow();
  });
}

function setActive(h, sid, a) {
  const was = I.active;
  I.stopOne?.(); I.stopOne = null;
  if (was) {
    /* The last of this phone's movements goes before the door shuts. */
    flush(true);
    stopContributing();
    const ended = I.incidents.get(was.id);
    if (ended?.status === 'ended') ctx.toast(`${ended.name}: incident ended`);
  }
  I.active = a;
  I.marks = new Map(); I.trail = [];
  I.tool = null;
  if (!a) return;
  I.stopOne = watchIncident(h, sid, a, ({ marks, trail }) => {
    if (I.active?.id !== a.id) return;
    I.marks = marks; I.trail = trail;
    if (sq().view) paintCommandNow();
  });
  startContributing(a);
  announce(a);
}

/* Seen once per phone, so that opening the app again does not throw the
   map up again for an incident already looked at. */
function loadSeen() { try { for (const id of ctx.kv.get('squadIncSeen', []) || []) I.seen.add(id); } catch { /* none */ } }
function saveSeen() { try { ctx.kv.set('squadIncSeen', [...I.seen].slice(-20)); } catch { /* full */ } }

/** A new incident: a banner on every screen, and the map opened, unless a
    recording is going (a run must not be swept off the screen) or this is
    the phone that started it. */
function announce(a) {
  if (I.seen.has(a.id)) return;
  I.seen.add(a.id); saveSeen();
  if (a.startedBy === sq().me) return;
  navigator.vibrate?.([120, 80, 120]);
  paintBanner();
  if (!ctx.busy() && !sq().view) { openCommand(); setTimeout(fitIncident, 800); }
}

/* ── This phone's share of the incident ──────────────────────────────── */
/* Every member on duty sends their movements, for the replay; the trailing
   team's, which come from the run screen's recording when a run is going
   (it records every few metres, far finer than the duty positions), are
   the trail everyone watches. */
function startContributing(a) {
  I.buf = trackBuffer(a.startedAt);
  I.bufFor = a.id;
  I.run = { for: 0, idx: 0, wps: 0 };
  I.flushAt = Date.now() + TRAIL_FLUSH_MS;
  const fix = sq().fix;
  if (sq().onDuty && fix) I.buf.add({ lat: fix.lat, lon: fix.lon, t: Math.max(fix.at, a.startedAt) });
  clearInterval(I.tick);
  I.tick = setInterval(everySecond, 1000);
}
function stopContributing() {
  clearInterval(I.tick); I.tick = 0;
  I.buf = null; I.bufFor = null;
  I.consent = null;
}

const trailing = () => !!I.active && I.active.k9Uid === sq().me;
/** This phone's run is the incident's trail right now (incident.js mayShareRun). */
const sharingRun = () => mayShareRun({ inc: I.active, me: sq().me, onDuty: sq().onDuty, consent: I.consent });
function runGoing() {
  const r = ctx.runState();
  return r.on && r.kind === 'run' ? r : null;
}

function onSent(fix) {
  if (!I.buf || !sq().onDuty || (sharingRun() && runGoing())) return;
  I.buf.add(fix);
}

function everySecond() {
  const a = I.active;
  if (!a || !I.buf) return;
  /* Off duty, or picked but not yet said yes with Start trailing: the run
     stays on this phone. */
  const r = sharingRun() ? runGoing() : null;
  if (r) {
    /* A run started before the incident (it happens: the team was already
       out) counts from the incident's start. */
    if (I.run.for !== r.startedAt) I.run = { for: r.startedAt, idx: 0, wps: 0 };
    for (; I.run.idx < r.pts.length; I.run.idx++) {
      const p = r.pts[I.run.idx];
      if (p.t >= a.startedAt) I.buf.add({ lat: p.lat, lon: p.lon, t: p.t });
    }
    for (; I.run.wps < r.wps.length; I.run.wps++) {
      const w = r.wps[I.run.wps];
      const kind = RUN_MARKS[w.kind];
      if (kind && w.t >= a.startedAt) cloudMark(kind, { lat: w.lat, lon: w.lon });
    }
  }
  if (Date.now() >= I.flushAt) {
    I.flushAt = Date.now() + (r ? TRAIL_FLUSH_MS : (trailing() ? TRAIL_FLUSH_MS : TRACK_FLUSH_MS));
    flush();
  }
  paintBanner();
}

async function flush(all = false) {
  const a = I.active;
  const buf = I.buf;
  if (!a || !buf || !buf.pending || I.bufFor !== a.id) return;
  /* Switched off duty: what is waiting stays on the phone. */
  if (!sq().onDuty) return;
  let h;
  try { h = await ctx.handle(); } catch { h = null; }
  if (!h) return;
  const m = sq().member;
  for (const doc of buf.take()) {
    putTrack(h, I.sid, a.id, doc, { callSign: m?.callSign || '', role: m?.role || 'officer' })
      .catch(() => { if (!all) buf.again(doc.n); });
  }
}

/* ── Doing things ─────────────────────────────────────────────────────── */
async function cloudMark(kind, geom, label = null) {
  const a = I.active;
  if (!a) return;
  try {
    const h = await ctx.handle();
    if (!h) throw new Error('Sign in first');
    await putMark(h, I.sid, a.id, { kind, ...geom, label });
  } catch (e) {
    ctx.toast(String(e?.code || '').includes('permission') ? 'The squad refused that mark' : (e?.message || 'Could not add the mark'));
  }
}

function addMark(kind, geom) {
  const v = shown();
  if (!v.inc || v.inc.status !== 'active' || v.replay) return;
  if (v.sim) {
    I.sim.addMark({ kind, by: SIM_ME, at: viewNow(), ...geom });
  } else {
    if (!mayMark(v.inc, meUid(), kind)) return ctx.toast('Only the trailing team calls the scent');
    cloudMark(kind, geom);
  }
  ctx.toast(`${MARKS[kind].label} added`);
  paintCommandNow();
}

async function takeBack(mark, about = '') {
  const v = shown();
  if (v.replay || !mayUnmark(mark, meUid(), amCommand())) return;
  if (!confirm(`${about ? `${about}\n\n` : ''}Remove this ${MARKS[mark.kind].label.toLowerCase()}?`)) return;
  if (v.sim) { I.sim.removeMark(mark.id); paintCommandNow(); return; }
  try {
    const h = await ctx.handle();
    await removeMark(h, I.sid, v.inc.id, mark.id);
  } catch { ctx.toast('Could not remove it'); }
}

function openForm() {
  const st = commandView();
  /* The team to trail: the first K9 handler on duty, if there is one. */
  const k9s = k9Options(st);
  I.form = { name: 'Missing person', lkp: null, k9Uid: k9s.find(k => k.on)?.uid ?? k9s[0]?.uid ?? null };
  I.tool = null;
  paintCommandNow();
}

function k9Options(st) {
  const out = [];
  for (const m of st.members.values()) {
    if (m.role !== 'k9') continue;
    out.push({ uid: m.uid, callSign: m.callSign, dog: m.dog, on: st.positions.has(m.uid) });
  }
  return out.sort((a, b) => Number(b.on) - Number(a.on) || a.callSign.localeCompare(b.callSign));
}

async function doStart() {
  const f = I.form;
  if (!f) return;
  const box = $('cmdIncident');
  const err = (t) => { const e = box.querySelector('[data-inc-err]'); if (e) e.textContent = t; };
  const input = box.querySelector('[data-inc-name]');
  f.name = cleanIncidentName(input ? input.value : f.name);
  if (!f.name) return err('Give the incident a name');
  if (!f.lkp) return err('Tap the map where the person was last seen');
  const st = commandView();
  if (st.sim) {
    I.sim = createSimIncident({ sim: st.sim, lkp: f.lkp, k9Uid: f.k9Uid || 'sim-1', name: f.name, now: viewNow(),
                                seed: (Date.now() / 1000) | 0, by: SIM_ME });
    I.simEnded = null; lastSim = null;
    /* Four times real speed: a trail that takes twenty minutes plays out in
       five while the chief watches. The switch beside it goes back to ×1. */
    setSimSpeed(4);
    I.form = null;
    demoBanner(I.sim.inc);
    fitIncident();
    paintCommandNow();
    return;
  }
  const btn = box.querySelector('[data-inc-act="go"]');
  if (btn) btn.disabled = true;
  try {
    const h = await ctx.handle();
    if (!h) throw new Error('Sign in first');
    const inc = await startIncident(h, I.sid, { name: f.name, lkp: f.lkp, k9Uid: f.k9Uid });
    I.seen.add(inc.id); saveSeen();
    I.form = null;
    fitIncident();
    ctx.toast(`${inc.name} started. Every member is being told`);
    paintCommandNow();
  } catch (e) {
    err(String(e?.code || '').includes('permission') ? 'Only Command can start an incident' : (e?.message || 'Could not start it'));
    if (btn) btn.disabled = false;
  }
}

/** A quick pretend incident for the demo: a last known point a short walk
    from the first K9 team, so the trail starts without a long wait. */
function quickSim() {
  const st = commandView();
  if (!st.sim) return;
  const k9 = st.sim.unit('sim-1');
  const lkp = { lat: k9.lat + 0.0009, lon: k9.lon + 0.0006 };
  I.form = { name: 'Missing person', lkp, k9Uid: 'sim-1' };
  I.panelKey = '';
  paintPanel(st);
  doStart();
}

async function doEnd() {
  const v = shown();
  if (!v.inc || v.inc.status !== 'active') return;
  if (!confirm(`End “${v.inc.name}”? It is kept for the debrief, with a replay of everyone’s movements.`)) return;
  I.tool = null;
  if (v.sim) {
    I.sim.end(viewNow());
    I.simEnded = I.sim;
    lastSim = { ended: I.sim, members: commandView().sim.members() };
    I.sim = null;
    ctx.toast('Incident ended. Replay it for the debrief');
    paintCommandNow();
    return;
  }
  try {
    const h = await ctx.handle();
    const st = commandView();
    const units = [...st.positions.keys()].length;
    await endIncident(h, I.sid, v.inc, summarise({ inc: v.inc, trail: I.trail, marks: I.marks, units, now: Date.now() }));
  } catch (e) {
    ctx.toast(String(e?.code || '').includes('permission') ? 'Only Command can end it' : (e?.message || 'Could not end it'));
  }
}

/** The incident's ground in view: the last known point, the trail, every
    mark and the trailing team, with room round them. */
function fitIncident() {
  const v = shown();
  if (!v.inc) return;
  const st = commandView();
  const pts = [v.inc.lkp, ...v.trail];
  for (const mk of v.marks) pts.push(...(mk.pts || [mk]));
  const k9 = v.inc.k9Uid ? st.positions.get(v.inc.k9Uid) : null;
  if (k9) pts.push(k9);
  /* Never closer in than a few hundred metres round the point: the ground
     officers will close off, not just the spot. */
  pts.push(...ringAround(v.inc.lkp));
  fitOnMap(pts, 17);
}
const ringAround = (c) => [0, 90, 180, 270].map(b => project(c, b, 250));

/* ── Replay ───────────────────────────────────────────────────────────── */
const REPLAY_SPEEDS = [10, 30, 60, 120];
const REPLAY_STEP_MS = 250;

async function openReplay(source) {
  let rp;
  try {
    if (source === 'sim') {
      if (!lastSim) return;
      rp = lastSim.ended.replay(lastSim.members);
    } else {
      const inc = I.incidents.get(source);
      if (!inc) return;
      const h = await ctx.handle();
      if (!h) throw new Error('Sign in first');
      const { tracks, marks } = await loadIncident(h, I.sid, inc.id);
      rp = buildReplay({ inc, tracks, marks, members: sq().members });
    }
  } catch (e) { ctx.toast(e?.message || 'Could not load the replay'); return; }
  closeReplay(false);
  if (!sq().view) openCommand();
  const dur = rp.end - rp.start;
  /* Fast enough that a whole incident plays in about a minute. */
  const speed = REPLAY_SPEEDS.find(s => dur / s <= 75e3) ?? REPLAY_SPEEDS[REPLAY_SPEEDS.length - 1];
  I.replay = { rp, t: rp.start, playing: true, speed, timer: 0, scene: null, fitted: false };
  I.form = null; I.tool = null;
  setViewOverride(() => {
    const r = I.replay;
    if (!r) return null;
    r.scene = replayAt(r.rp, r.t);
    return { name: `Replay · ${r.rp.inc.name}`, members: r.scene.members, positions: r.scene.positions, now: r.t };
  });
  playReplay(true);
}

/** The whole of a replay in view: everyone's movements and every mark. */
function fitReplay() {
  const r = I.replay;
  if (!r) return;
  /* The incident's ground, not every patrol driven before it began. */
  const pts = [...ringAround(r.rp.inc.lkp)];
  const k9 = r.rp.units.find(u => u.uid === r.rp.inc.k9Uid);
  if (k9) pts.push(...k9.pts);
  for (const mk of r.rp.marks) pts.push(...(mk.pts || [mk]));
  fitOnMap(pts, 17);
}

function playReplay(on) {
  const r = I.replay;
  if (!r) return;
  clearInterval(r.timer); r.timer = 0;
  r.playing = on;
  if (on) {
    if (r.t >= r.rp.end) r.t = r.rp.start;
    r.timer = setInterval(() => {
      r.t = Math.min(r.rp.end, r.t + REPLAY_STEP_MS * r.speed);
      if (r.t >= r.rp.end) playReplay(false);
      paintCommandNow();
    }, REPLAY_STEP_MS);
  }
  paintCommandNow();
}

function closeReplay(repaint = true) {
  if (!I.replay) return;
  clearInterval(I.replay.timer);
  I.replay = null;
  setViewOverride(null);
  if (repaint) paintCommandNow();
}

/* ── The command map's incident layer ─────────────────────────────────── */
/* Lines (the trail, the way ahead, perimeters) are map layers; points (the
   last known point, the team's calls, roadblocks) are markers of their own,
   with their words in textContent, because the street map without a Mapbox
   key has no fonts to write labels with. */
const LAYERS = [
  { id: 'inc-lines', src: 'inc-lines', type: 'line', paint: { 'line-color': '#D93025', 'line-width': 4, 'line-dasharray': [2, 1.2] } },
  { id: 'inc-draft', src: 'inc-draft', type: 'line', paint: { 'line-color': '#D93025', 'line-width': 3, 'line-dasharray': [1, 1] } },
  { id: 'inc-draft-pts', src: 'inc-draft-pts', type: 'circle',
    paint: { 'circle-radius': 6, 'circle-color': '#ffffff', 'circle-stroke-color': '#D93025', 'circle-stroke-width': 3 } },
  { id: 'inc-trail-case', src: 'inc-trail', type: 'line', paint: { 'line-color': '#ffffff', 'line-width': 9, 'line-opacity': 0.85 } },
  { id: 'inc-trail', src: 'inc-trail', type: 'line', paint: { 'line-color': '#D9822B', 'line-width': 5 } },
  { id: 'inc-ahead', src: 'inc-ahead', type: 'line', paint: { 'line-color': '#D9822B', 'line-width': 3, 'line-dasharray': [1.5, 1.5] } },
];
const SOURCES = ['inc-lines', 'inc-draft', 'inc-draft-pts', 'inc-trail', 'inc-ahead'];

function ensureLayers(m) {
  if (!m.isStyleLoaded?.()) return false;
  for (const id of SOURCES) if (!m.getSource(id)) m.addSource(id, { type: 'geojson', data: EMPTY });
  for (const l of LAYERS) {
    if (m.getLayer(l.id)) continue;
    m.addLayer({ id: l.id, type: l.type, source: l.src, paint: l.paint,
                 ...(l.type === 'line' ? { layout: { 'line-cap': 'round', 'line-join': 'round' } } : {}) });
  }
  return true;
}
function dropLayers(m) {
  if (!m) return;
  for (const l of LAYERS) { try { if (m.getLayer(l.id)) m.removeLayer(l.id); } catch { /* style gone */ } }
  for (const id of SOURCES) { try { if (m.getSource(id)) m.removeSource(id); } catch { /* style gone */ } }
}
const setData = (m, id, data) => m.getSource(id)?.setData(data);
const lineFeature = (pts, props = {}) => ({ type: 'Feature', properties: props,
  geometry: { type: 'LineString', coordinates: pts.map(p => [p.lon, p.lat]) } });
const lines = (list) => ({ type: 'FeatureCollection', features: list.filter(Boolean) });

function paintLayers(v) {
  const { map: m } = map();
  if (!m || !ensureLayers(m)) return;
  const perim = v.marks.filter(x => MARKS[x.kind]?.line && x.pts?.length >= 2);
  setData(m, 'inc-lines', lines(perim.map(x => lineFeature(x.pts, { id: x.id }))));
  setData(m, 'inc-trail', lines(v.trail.length >= 2 ? [lineFeature(v.trail)] : []));
  const ahead = v.inc?.status === 'active' || v.replay ? aheadLine(trailInfo(v.trail, v.inc, v.now)) : null;
  setData(m, 'inc-ahead', lines(ahead ? [lineFeature(ahead)] : []));
  const draft = I.tool?.kind === 'perimeter' ? I.tool.pts : [];
  setData(m, 'inc-draft', lines(draft.length >= 2 ? [lineFeature(draft)] : []));
  setData(m, 'inc-draft-pts', { type: 'FeatureCollection', features: draft.map(p => ({ type: 'Feature', properties: {},
    geometry: { type: 'Point', coordinates: [p.lon, p.lat] } })) });
}

function pinEl(cls, short, tagText) {
  const el = document.createElement('div');
  el.className = `inc-mark ${cls}`;
  const pin = document.createElement('span');
  pin.className = 'inc-pin';
  pin.textContent = short;
  const tag = document.createElement('span');
  tag.className = 'inc-mark-tag';
  tag.textContent = tagText;
  el.append(pin, tag);
  return { el, pin, tag };
}

const PIN_W = 44;   // about the widest pin ("LOST"), so a pin moved aside clears the one it sat on
function paintPins(v, members) {
  const g = map();
  if (!g.map || !g.GL) return;
  const keep = new Set();
  /* The last known point first: the calls move aside for it, never it for them. */
  const placed = v.inc ? [g.map.project([v.inc.lkp.lon, v.inc.lkp.lat])] : [];
  const marks = v.marks.filter(x => !MARKS[x.kind]?.line).sort((a, b) => a.at - b.at);
  for (const mk of marks) {
    keep.add(mk.id);
    const since = v.inc ? `+${elapsedWords(mk.at - v.inc.startedAt)}` : '';
    const text = `${mk.label || MARKS[mk.kind].label} · ${who(mk.by, members)} · ${since}`;
    let p = I.markers.get(mk.id);
    if (!p) {
      const parts = pinEl(`inc-k-${mk.kind}`, MARKS[mk.kind].short, text);
      parts.el.addEventListener('click', (e) => onPinClick(e, mk.id));
      p = { ...parts, mk, marker: new g.GL.Marker({ element: parts.el, anchor: 'bottom' }).setLngLat([mk.lon, mk.lat]).addTo(g.map) };
      I.markers.set(mk.id, p);
    }
    p.mk = mk;
    p.text = text;
    if (p.tag.textContent !== text) p.tag.textContent = text;
    p.el.setAttribute('aria-label', text);
    /* The team's calls fall within a few metres of each other: a pin that
       would sit on one already drawn moves along beside it. */
    const at = g.map.project([mk.lon, mk.lat]);
    const k = placed.filter(q => Math.abs(q.x - at.x) < PIN_W && Math.abs(q.y - at.y) < 24).length;
    placed.push(at);
    if (p.shift !== k) { p.shift = k; p.marker.setOffset([k * PIN_W, 0]); }
  }
  for (const [id, p] of I.markers) if (!keep.has(id)) { p.marker.remove(); I.markers.delete(id); }
  /* LKP is what police call it, and needs no tag to crowd the others. */
  pin('lkp', v.inc ? v.inc.lkp : null, 'inc-k-lkp');
  pin('form', I.form?.lkp ?? null, 'inc-k-lkp inc-draft-pin');
}

/* A tap on a pin. While drawing, it is a point of the drawing like any
   other tap on the map; otherwise it says what the pin is, who put it there
   and when, the only way to read that on a phone (the tags are hidden
   there), with Remove for whoever may take it back. */
function onPinClick(e, id) {
  const p = I.markers.get(id);
  if (!p) return;
  if (I.tool || I.form) {
    e.stopPropagation();
    onMapClick({ lngLat: { lat: p.mk.lat, lng: p.mk.lon }, point: null });
    return;
  }
  e.stopPropagation();
  const v = shown();
  const may = !v.replay && v.inc?.status === 'active' && mayUnmark(p.mk, meUid(), amCommand());
  if (!may) { ctx.toast(p.text); return; }
  takeBack(p.mk, p.text);
}

function pin(key, at, cls) {
  const g = map();
  let p = I.pins.get(key);
  if (!at) { if (p) { p.marker.remove(); I.pins.delete(key); } return; }
  if (!p) {
    const parts = pinEl(cls, 'LKP', '');
    parts.el.setAttribute('aria-label', 'Last known point');
    p = { ...parts, marker: new g.GL.Marker({ element: parts.el, anchor: 'bottom' }).setLngLat([at.lon, at.lat]).addTo(g.map) };
    I.pins.set(key, p);
  }
  p.marker.setLngLat([at.lon, at.lat]);
}

function onMapClick(e) {
  const p = { lat: e.lngLat.lat, lon: e.lngLat.lng };
  if (I.replay) return;
  if (I.form) { I.form.lkp = p; paintCommandNow(); return; }
  if (I.tool) {
    if (I.tool.kind === 'perimeter') {
      if (I.tool.pts.length < LINE_MAX) I.tool.pts.push(p);
      paintCommandNow();
    } else {
      const kind = I.tool.kind;
      I.tool = null;
      addMark(kind, p);
    }
    return;
  }
  /* A tap on a perimeter line offers to take it back. */
  const m = map().map;
  const hit = m?.queryRenderedFeatures?.(e.point, { layers: ['inc-lines'] })?.[0];
  const id = hit?.properties?.id;
  const mark = id ? shown().marks.find(x => x.id === id) : null;
  if (mark) takeBack(mark);
}

function setCursor() {
  const c = map().map?.getCanvas?.();
  if (c) c.style.cursor = I.form || I.tool ? 'crosshair' : '';
}

function teardown() {
  const { map: m } = map();
  if (I.on) { m?.off('click', onMapClick); I.on = false; }
  for (const p of I.markers.values()) p.marker.remove();
  I.markers.clear();
  for (const p of I.pins.values()) p.marker.remove();
  I.pins.clear();
  dropLayers(m);
  I.form = null; I.tool = null;
  closeReplay(false);
  /* The pretend squad has gone with the map, and a running pretend incident
     with it; an ended one stays in lastSim for its replay. */
  I.sim = null; I.simEnded = null;
  I.foldedFor = null;
  setLeadUnit(null);
  I.panelKey = '';
  const box = $('cmdIncident');
  if (box) { box.hidden = true; box.textContent = ''; }
  if (m) { const c = m.getCanvas?.(); if (c) c.style.cursor = ''; }
  paintBanner();
}

/** Every second while the command map is up, and on every change. */
function paint(st) {
  if (!st) return teardown();
  const { map: m } = map();
  if (!I.on && m) { m.on('click', onMapClick); I.on = true; }
  if (I.sim) I.sim.step(viewNow());
  const v = shown();
  const live = v.inc && v.inc.status === 'active' && !v.replay ? v.inc : null;
  setLeadUnit(v.inc?.k9Uid ?? null);
  /* On a phone the incident card and the map matter more than the list:
     the panel folds once when an incident comes on, and stays as the person
     leaves it after that. */
  if (live && I.foldedFor !== live.id) {
    I.foldedFor = live.id;
    if (!window.matchMedia('(min-width: 900px)').matches) foldPanel(true);
  }
  paintLayers(v);
  paintPins(v, st.members);
  paintPanel(st, v);
  setCursor();
  if (I.replay && !I.replay.fitted) { I.replay.fitted = true; fitReplay(); }
  paintBanner();
}

/* ── The panel ────────────────────────────────────────────────────────── */
function mode(v) {
  if (I.replay) return 'replay';
  if (I.form) return 'form';
  if (v.inc && v.inc.status === 'active') return 'active';
  return 'none';
}

function paintPanel(st, v = shown()) {
  const box = $('cmdIncident');
  const md = mode(v);
  const me = meUid();
  const cmd = amCommand();
  const lastEnded = st.sim ? (lastSim ? lastSim.ended.inc : null) : (pastOf(I.incidents)[0] ?? null);
  const running = !st.sim && sharingRun() && !!runGoing();
  const k9s = md === 'form' ? k9Options(st) : [];
  const key = JSON.stringify([md, v.inc?.id, I.tool?.kind, cmd, me, running, lastEnded?.id,
    k9s.map(k => [k.uid, k.on]), I.form?.k9Uid, !!I.form?.lkp, I.replay?.playing, I.replay?.speed]);
  if (md === 'none' && !cmd && !lastEnded) { box.hidden = true; I.panelKey = ''; return; }
  box.hidden = false;
  if (key !== I.panelKey) {
    I.panelKey = key;
    put(box, panelHtml(md, { st, v, me, cmd, lastEnded, running, k9s }));
  }
  paintLive(box, st, v);
}

function panelHtml(md, { st, v, me, cmd, lastEnded, running, k9s }) {
  if (md === 'replay') {
    const r = I.replay;
    return html`<div class="inc-card inc-replay">
      <p class="inc-kicker">Debrief replay</p>
      <h3 class="inc-name">${r.rp.inc.name}</h3>
      <input type="range" class="inc-scrub" data-inc-scrub min="0" max="${Math.round((r.rp.end - r.rp.start) / 1000)}" step="1" value="0" aria-label="Replay time">
      <p class="inc-clock" data-inc-text="clock"></p>
      <div class="inc-tools">
        <button type="button" class="btn small moss" data-inc-act="play">${r.playing ? 'Pause' : 'Play'}</button>
        <button type="button" class="btn ghost small" data-inc-act="speed">×${r.speed}</button>
        <button type="button" class="btn ghost small" data-inc-act="unreplay">Back to live</button>
      </div>
    </div>`;
  }
  if (md === 'form') {
    const f = I.form;
    return html`<div class="inc-card">
      <p class="inc-kicker">Start an incident</p>
      <label class="inc-field">Name<input type="text" data-inc-name maxlength="80" value="${f.name}" autocomplete="off"></label>
      <p class="inc-hint">${f.lkp ? 'Last known point set. Tap the map again to move it.' : 'Tap the map where the person was last seen.'}</p>
      <p class="inc-label">K9 team to trail</p>
      <div class="inc-chips">
        ${k9s.length ? k9s.map(k => html`<button type="button" class="chip" data-inc-k9="${k.uid}" aria-pressed="${String(f.k9Uid === k.uid)}">${k.callSign}${k.dog ? ` · ${k.dog}` : ''}${k.on ? '' : ' (off duty)'}</button>`) : ''}
        <button type="button" class="chip" data-inc-k9="" aria-pressed="${String(!f.k9Uid)}">None yet</button>
      </div>
      ${k9s.some(k => k.uid === f.k9Uid && !k.on) ? html`<p class="inc-hint">That team is off duty: nothing of theirs is shared until they go On duty and tap Start trailing.</p>` : ''}
      <p class="sq-err" data-inc-err role="alert"></p>
      <div class="inc-tools">
        <button type="button" class="btn small moss" data-inc-act="go">Start incident</button>
        <button type="button" class="btn ghost small" data-inc-act="cancel">Cancel</button>
      </div>
    </div>`;
  }
  if (md === 'active') {
    const inc = v.inc;
    const k9 = inc.k9Uid ? st.members.get(inc.k9Uid) : null;
    const team = k9 ? `${k9.callSign}${k9.dog ? ` · ${k9.dog}` : ''}` : 'No K9 team';
    const mayDraw = me !== inc.k9Uid || cmd;
    const tool = I.tool;
    return html`<div class="inc-card inc-live">
      <p class="inc-kicker"><span class="inc-dot" aria-hidden="true"></span> Incident</p>
      <h3 class="inc-name">${inc.name}</h3>
      <p class="inc-team"><b>${team}</b> <span data-inc-text="state"></span></p>
      <p class="inc-facts" data-inc-text="facts"></p>
      ${me === inc.k9Uid && !st.sim ? html`<div class="inc-tools">
        ${running ? html`<span class="inc-hint">Your run is streaming to the squad. Marks you drop on the run screen show here.</span>`
                  : html`<button type="button" class="btn small moss" data-inc-act="trail">Start trailing</button>
                     <button type="button" class="btn ghost small" data-inc-act="k9:indication">Indication</button>
                     <button type="button" class="btn ghost small" data-inc-act="k9:lost">Lost it</button>
                     <button type="button" class="btn ghost small" data-inc-act="k9:refound">Re-found</button>`}
      </div>` : ''}
      ${mayDraw && !tool ? html`<p class="inc-label">Add to the map</p>
      <div class="inc-tools">${DRAW_TOOLS.map(k => html`<button type="button" class="btn ghost small inc-tool inc-t-${k}" data-inc-act="tool:${k}">${MARKS[k].label}</button>`)}</div>` : ''}
      ${tool ? html`<p class="inc-hint">${tool.kind === 'perimeter' ? 'Tap the map along the line. Done when it is drawn.' : `Tap the map where the ${MARKS[tool.kind].label.toLowerCase()} is.`}</p>
      <div class="inc-tools">
        ${tool.kind === 'perimeter' ? html`<button type="button" class="btn small moss" data-inc-act="done">Done</button>
          <button type="button" class="btn ghost small" data-inc-act="undo">Undo point</button>` : ''}
        <button type="button" class="btn ghost small" data-inc-act="untool">Cancel</button>
      </div>` : ''}
      <div class="inc-tools">
        <button type="button" class="btn ghost small" data-inc-act="fit">Show the incident</button>
        ${cmd ? html`<button type="button" class="btn danger small" data-inc-act="end">End incident</button>` : ''}
      </div>
    </div>`;
  }
  return html`<div class="inc-card">
    ${cmd ? html`<div class="inc-tools">
      <button type="button" class="btn small ember" data-inc-act="start">Start incident</button>
      ${st.sim ? html`<button type="button" class="btn ghost small" data-inc-act="quick">Pretend incident</button>` : ''}
    </div>` : ''}
    ${lastEnded ? html`<p class="inc-last">Last incident: <b>${lastEnded.name}</b>
      <button type="button" class="btn ghost small" data-inc-act="replay" data-inc-id="${st.sim ? 'sim' : lastEnded.id}">Replay</button></p>` : ''}
  </div>`;
}

/* What changes every second goes in by textContent, so the panel is not
   rebuilt under a finger or a cursor. */
function paintLive(box, st, v) {
  const text = (k, s) => { const el = box.querySelector(`[data-inc-text="${k}"]`); if (el && el.textContent !== s) el.textContent = s; };
  if (I.replay) {
    const r = I.replay;
    const nMarks = r.scene ? r.scene.marks.length : 0;
    text('clock', `${clockWords(r.t - r.rp.start)} of ${clockWords(r.rp.end - r.rp.start)} · ${nMarks} mark${nMarks === 1 ? '' : 's'}`);
    const s = box.querySelector('[data-inc-scrub]');
    if (s && document.activeElement !== s) s.value = String(Math.round((r.t - r.rp.start) / 1000));
  }
  if (v.inc && v.inc.status === 'active' && !I.replay) {
    const info = trailInfo(v.trail, v.inc, v.now);
    const going = v.trail.length >= 2;
    /* The team's last call on the scent is what the others act on. */
    const call = v.marks.filter(mk => MARKS[mk.kind].k9).sort((a, b) => b.at - a.at)[0];
    const lastCall = call ? ` · last call: ${MARKS[call.kind].label}, ${elapsedWords(v.now - call.at)} ago` : '';
    text('state', going ? `${info.heading != null ? `trailing, heading ${info.compass}` : 'trailing'}${lastCall}` : 'on the way to the last known point');
    const bits = [`${elapsedWords(info.elapsedMs)} since start`];
    if (going) bits.push(`${metresWords(info.lengthM)} of trail`, `${metresWords(info.fromLkpM)} from the last known point`);
    const counts = {};
    for (const mk of v.marks) counts[mk.kind] = (counts[mk.kind] || 0) + 1;
    const said = Object.keys(counts).map(k => countWords(k, counts[k]));
    if (said.length) bits.push(said.join(', '));
    text('facts', bits.join(' · '));
  }
}

function onPanelClick(e) {
  const k9 = e.target.closest('[data-inc-k9]');
  if (k9 && I.form) { I.form.k9Uid = k9.dataset.incK9 || null; return paintCommandNow(); }
  const b = e.target.closest('[data-inc-act]');
  if (!b) return;
  const act = b.dataset.incAct;
  const box = $('cmdIncident');
  if (I.form) I.form.name = box.querySelector('[data-inc-name]')?.value ?? I.form.name;
  if (act === 'start') return openForm();
  if (act === 'quick') return quickSim();
  if (act === 'cancel') { I.form = null; return paintCommandNow(); }
  if (act === 'go') return doStart();
  if (act === 'end') return doEnd();
  if (act === 'fit') return fitIncident();
  if (act === 'trail') return startTrailing();
  if (act.startsWith('k9:')) {
    const fix = sq().fix;
    if (!fix) return ctx.toast('No position yet. Switch On duty first');
    return addMark(act.slice(3), { lat: fix.lat, lon: fix.lon });
  }
  if (act.startsWith('tool:')) { I.tool = { kind: act.slice(5), pts: [] }; return paintCommandNow(); }
  if (act === 'undo') { I.tool?.pts.pop(); return paintCommandNow(); }
  if (act === 'untool') { I.tool = null; return paintCommandNow(); }
  if (act === 'done') {
    const pts = I.tool?.pts || [];
    if (pts.length < 2) return ctx.toast('Tap at least two points for a line');
    I.tool = null;
    return addMark('perimeter', { pts });
  }
  if (act === 'replay') return openReplay(b.dataset.incId);
  if (act === 'play') return playReplay(!I.replay?.playing);
  if (act === 'speed' && I.replay) {
    I.replay.speed = REPLAY_SPEEDS[(REPLAY_SPEEDS.indexOf(I.replay.speed) + 1) % REPLAY_SPEEDS.length];
    return paintCommandNow();
  }
  if (act === 'unreplay') return closeReplay();
}

function onScrub(e) {
  const s = e.target.closest('[data-inc-scrub]');
  if (!s || !I.replay) return;
  I.replay.t = I.replay.rp.start + Number(s.value) * 1000;
  paintCommandNow();
}

/** The trailing team starts a run: a blind trail from where they stand,
    recorded as any run is, and streamed into the incident as it goes. */
function startTrailing() {
  if (!I.active || !trailing()) return;
  if (!sq().onDuty) return ctx.toast('Switch On duty first: your trail is shared only while you are on duty');
  I.consent = I.active.id;
  hideBanner();
  /* A run already going (the team was out when it was called) streams from
     the incident's start; otherwise a new one starts. */
  if (runGoing()) { ctx.toast('Your run is now streaming to the squad'); paintCommandNow(); return; }
  ctx.startTrail();
}

/* ── The banner, on every screen ─────────────────────────────────────── */
let demoUntil = 0, demoInc = null;
/** In the pretend squad there are no other phones to tell, so the banner
    every member would get is shown here for a few seconds instead. */
function demoBanner(inc) {
  demoInc = inc;
  demoUntil = Date.now() + 8000;
  paintBanner();
  setTimeout(paintBanner, 8100);
}

function paintBanner() {
  const b = $('incBanner');
  if (!b) return;
  const a = I.active;
  const onMap = ctx.screen() === 'scrCommand';
  if (demoInc && Date.now() < demoUntil) {
    b.hidden = false;
    $('incBannerName').textContent = `Incident: ${demoInc.name}`;
    $('incBannerSub').textContent = 'This is what every member sees: a banner, and their map opens on the incident';
    $('incBannerTrail').hidden = true;
    $('incBannerOpen').hidden = true;
    return;
  }
  demoInc = null;
  const show = !!a && !I.hidden.has(a.id) && !onMap;
  b.hidden = !show;
  if (!show) return;
  const members = sq().members;
  const k9 = a.k9Uid ? members.get(a.k9Uid) : null;
  $('incBannerName').textContent = `Incident: ${a.name}`;
  $('incBannerSub').textContent = `${k9 ? `${k9.callSign} trailing` : 'No K9 team yet'} · ${elapsedWords(Date.now() - a.startedAt)} since start`;
  $('incBannerTrail').hidden = !(trailing() && !(sharingRun() && runGoing()));
  $('incBannerOpen').hidden = false;
}
function hideBanner() { demoUntil = 0; if (I.active) I.hidden.add(I.active.id); paintBanner(); }

/* ── The squad screen's list of past incidents ───────────────────────── */
function paintOutside() {
  paintBanner();
  for (const id of ['sqSimReplay', 'sqSimReplay2']) { const b = $(id); if (b) b.hidden = !lastSim; }
  const wrap = $('sqPast');
  if (!wrap) return;
  const past = pastOf(I.incidents);
  wrap.hidden = !past.length;
  put($('sqPastList'), html`${past.slice(0, 10).map(i => html`<li class="sq-row">
    <span class="sq-who"><b>${i.name}</b><i>${new Date(i.startedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}${i.summary ? ` · ${elapsedWords(i.summary.durationMs)} · ${metresWords(i.summary.k9M)} of trail` : ''}</i></span>
    <span class="sq-tools"><button type="button" class="btn ghost small" data-inc-replay="${i.id}">Replay</button></span>
  </li>`)}`);
}

/* ── Start up ─────────────────────────────────────────────────────────── */
export function initIncidents(c) {
  ctx = c;
  loadSeen();
  onCommandPaint(paint);
  onPositionSent(onSent);
  onSquadChange((st) => {
    const sid = st.squad?.id ?? null;
    if (sid !== I.sid) follow(sid);
  });
  $('cmdIncident').addEventListener('click', onPanelClick);
  $('cmdIncident').addEventListener('input', onScrub);
  $('incBannerOpen').addEventListener('click', () => { hideBanner(); openCommand(); });
  $('incBannerHide').addEventListener('click', hideBanner);
  $('incBannerTrail').addEventListener('click', startTrailing);
  for (const id of ['sqSimReplay', 'sqSimReplay2']) $(id).addEventListener('click', replayPretend);
  $('sqPastList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-inc-replay]');
    if (b) openReplay(b.dataset.incReplay);
  });
}

/** Where the command map's weather is for: the incident's last known
    point while there is one on the map, else null. */
export function incidentAirPoint() {
  if (!ctx) return null;
  const inc = I.replay ? I.replay.rp.inc : (sq().sim ? I.sim?.inc : I.active);
  return inc?.lkp ? { lat: inc.lkp.lat, lon: inc.lkp.lon } : null;
}

/** The last pretend incident's replay, from the squad screen: the pretend
    squad comes back up and the replay plays over it. */
function replayPretend() {
  if (!lastSim) return;
  openCommand({ sim: true });
  openReplay('sim');
}

/** For a screen change: the banner shows everywhere but the map itself. */
export const incidentScreen = () => { if (ctx) paintOutside(); };
