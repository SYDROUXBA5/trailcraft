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
         cleanIncidentName, callWords, stripWords, quietLines, followPoints, allInView, standingOf, PACES, PACE_KEYS,
         DIR_MAX, DESC_MAX, cleanPaces, cleanBrief, seenAt, lastSeenFrom, hhmm, reachRings, passedLines, warnWords,
         reachWords, onScentWords, briefWords, logLines, ring } from './incident.js';
import { startIncident, endIncident, watchIncidents, watchIncident, putMark, withdrawMark, putTrack,
         loadIncident, updateSeen } from './incident-cloud.js';
import { html, put, onCommandPaint, commandView, onSquadChange, onPositionSent, setViewOverride, squadState,
         openCommand, viewNow, fitOnMap, paintCommandNow, setSimSpeed, setLeadUnit, foldPanel, mapPad, onLook, wallOn,
         onWall } from './squad-ui.js';
import { ask, form } from './sheet.js';

const EMPTY = { type: 'FeatureCollection', features: [] };
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
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
  follow: { paused: false, at: 0, for: null },  // the map following the K9 team, until a hand moves it
  said: { for: null, ids: new Set() },          // K9 calls already spoken on this screen
  voice: true,              // the command screen speaks the K9 team's calls
  wallKey: '',
  paces: cleanPaces(null),  // km/h for the reach rings, this device's own guess
  log: [], logKey: '',      // the live log as last drawn, for a tap on a line
  reachTag: null,           // the ring's "rough guide" tag on the map
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
const imperial = () => !!ctx.imperial?.();
const distWords = (m) => metresWords(m, imperial());

/* ── Which incident is on the map ─────────────────────────────────────── */
/** The incident drawn right now: the replay's, the pretend one, or the
    squad's own, with its marks and the trail so far. */
function shown() {
  /* marks: what stands, which the map draws; said: every mark made, the
     withdrawn ones too, which the log keeps crossed out. */
  if (I.replay) {
    const s = I.replay.scene || replayAt(I.replay.rp, I.replay.t);
    return { inc: I.replay.rp.inc, marks: s.marks, said: s.said, trail: s.trail, now: I.replay.t, replay: true };
  }
  if (sq().sim) {
    const si = I.sim;
    return si ? { inc: si.inc, marks: standingOf(si.marks), said: [...si.marks.values()], trail: si.trail, now: viewNow(), sim: true }
              : { inc: null, marks: [], said: [], trail: [], now: viewNow(), sim: true };
  }
  return { inc: I.active, marks: standingOf(I.marks), said: [...I.marks.values()], trail: I.trail, now: Date.now() };
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

/* Taking a mark back withdraws it: it goes off the map and stays in the log,
   crossed out, with who withdrew it and when (incident-cloud.js withdrawMark). */
async function takeBack(mark, about = '') {
  const v = shown();
  if (v.replay || !mayUnmark(mark, meUid(), amCommand())) return;
  const body = `${about ? `${about}. ` : ''}It comes off the map and stays in the incident log, crossed out.`;
  if (!await ask({ title: `Withdraw this ${(MARKS[mark.kind].one || MARKS[mark.kind].label).toLowerCase()}?`, body, yes: 'Withdraw', danger: true })) return;
  /* The sheet was up a while: the incident may have ended under it. */
  if (shown().inc?.id !== v.inc?.id || v.inc?.status !== 'active') return;
  if (v.sim) { I.sim.removeMark(mark.id, SIM_ME, viewNow()); paintCommandNow(); return; }
  try {
    const h = await ctx.handle();
    await withdrawMark(h, I.sid, v.inc.id, mark.id);
  } catch { ctx.toast('Could not withdraw it'); }
}

/* The description is personal data every member reads: said where it is typed. */
const DESC_HINT = 'Every squad member sees this. Keep it short.';

function openForm() {
  const st = commandView();
  /* The team to trail: the first K9 handler on duty, if there is one. */
  const k9s = k9Options(st);
  I.form = { name: 'Missing person', lkp: null, k9Uid: k9s.find(k => k.on)?.uid ?? k9s[0]?.uid ?? null,
             seen: '', pace: null, dir: '', desc: '', article: null };
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

/* What is typed in the form is read back before the panel is drawn again
   (a tap on a chip redraws it), so nothing typed is lost. */
function readForm(box) {
  const f = I.form;
  if (!f || !box) return;
  const val = (k) => box.querySelector(`[data-inc-${k}]`)?.value;
  for (const [k, field] of [['name', 'name'], ['seen', 'seen'], ['dir', 'dir'], ['desc', 'desc']]) {
    const v = val(field);
    if (v != null) f[k] = v;
  }
}

async function doStart() {
  const f = I.form;
  if (!f) return;
  const box = $('cmdIncident');
  const err = (t) => { const e = box.querySelector('[data-inc-err]'); if (e) e.textContent = t; };
  readForm(box);
  f.name = cleanIncidentName(f.name);
  if (!f.name) return err('Give the incident a name');
  if (!f.lkp) return err('Tap the map where the person was last seen');
  const st = commandView();
  const now = st.sim ? viewNow() : Date.now();
  /* Empty: last seen as the incident opens. */
  const lastSeenAt = f.seenAt ?? (f.seen ? lastSeenFrom(f.seen, now) : null);
  if (f.seen && lastSeenAt == null) return err('Last seen: a time like 14:05, or leave it empty for now');
  if (Number.isNaN(lastSeenAt)) return err('That time is after now');
  const seen = { lastSeenAt, pace: f.pace, brief: cleanBrief({ dir: f.dir, desc: f.desc, article: f.article }) };
  if (st.sim) {
    I.sim = createSimIncident({ sim: st.sim, lkp: f.lkp, k9Uid: f.k9Uid || 'sim-1', name: f.name, now,
                                seed: (Date.now() / 1000) | 0, by: SIM_ME, ...seen });
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
    const inc = await startIncident(h, I.sid, { name: f.name, lkp: f.lkp, k9Uid: f.k9Uid, ...seen });
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
  /* Seen walking off a minute before the call: the ring has a head start,
     as in a real call, and passes the sergeant's wide perimeter about a
     minute into the demo at ×4, a moment in the story rather than a warning
     that is on from the start. */
  I.form = { name: 'Missing person', lkp, k9Uid: 'sim-1', seen: '', seenAt: viewNow() - 60e3, pace: 'walk',
             dir: 'east, towards the shops', desc: 'Man, about 30, grey hoodie, dark jeans', article: true };
  I.panelKey = '';
  paintPanel(st);
  doStart();
}

async function doEnd() {
  const v = shown();
  if (!v.inc || v.inc.status !== 'active') return;
  if (!await ask({ title: `End “${v.inc.name}”?`, body: 'It is kept for the debrief, with a replay of everyone’s movements.', yes: 'End incident', danger: true })) return;
  /* The sheet was up a while: the incident may have ended under it. */
  const now = shown();
  if (!now.inc || now.inc.id !== v.inc.id || now.inc.status !== 'active') return;
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
/* The reach rings sit under everything else of the incident's: a soft fill
   and edge at the pace Command chose, and a dashed ring for if they ran. A
   perimeter line the main ring has grown past turns amber. */
const RING_C = '#4F5BD5';
const WARN_C = '#F2A900';
const LAYERS = [
  { id: 'inc-reach-fill', src: 'inc-reach', type: 'fill', paint: { 'fill-color': RING_C, 'fill-opacity': 0.1 } },
  { id: 'inc-reach-edge', src: 'inc-reach', type: 'line', paint: { 'line-color': RING_C, 'line-width': 2, 'line-opacity': 0.8 } },
  { id: 'inc-reach-wide', src: 'inc-reach-wide', type: 'line',
    paint: { 'line-color': RING_C, 'line-width': 2, 'line-opacity': 0.7, 'line-dasharray': [2, 2] } },
  { id: 'inc-lines', src: 'inc-lines', type: 'line',
    paint: { 'line-color': ['case', ['boolean', ['get', 'warn'], false], WARN_C, '#D93025'], 'line-width': 4, 'line-dasharray': [2, 1.2] } },
  { id: 'inc-draft', src: 'inc-draft', type: 'line', paint: { 'line-color': '#D93025', 'line-width': 3, 'line-dasharray': [1, 1] } },
  { id: 'inc-draft-pts', src: 'inc-draft-pts', type: 'circle',
    paint: { 'circle-radius': 6, 'circle-color': '#ffffff', 'circle-stroke-color': '#D93025', 'circle-stroke-width': 3 } },
  { id: 'inc-trail-case', src: 'inc-trail', type: 'line', paint: { 'line-color': '#ffffff', 'line-width': 9, 'line-opacity': 0.85 } },
  { id: 'inc-trail', src: 'inc-trail', type: 'line', paint: { 'line-color': '#D9822B', 'line-width': 5 } },
  { id: 'inc-ahead', src: 'inc-ahead', type: 'line', paint: { 'line-color': '#D9822B', 'line-width': 3, 'line-dasharray': [1.5, 1.5] } },
];
const SOURCES = ['inc-reach', 'inc-reach-wide', 'inc-lines', 'inc-draft', 'inc-draft-pts', 'inc-trail', 'inc-ahead'];

function ensureLayers(m) {
  if (!m.isStyleLoaded?.()) return false;
  for (const id of SOURCES) if (!m.getSource(id)) m.addSource(id, { type: 'geojson', data: EMPTY });
  /* Mapbox's own maps light their layers with the time of day: the
     incident's lines glow at full strength, so Wall mode's night look dims
     the map round them and not them. (MapLibre, the map with no key, has no
     such setting and would refuse it.) */
  const lit = typeof m.setConfigProperty === 'function';
  for (const l of LAYERS) {
    if (m.getLayer(l.id)) continue;
    const paint = lit ? { ...l.paint, [`${l.type}-emissive-strength`]: 1 } : l.paint;
    /* In order, under any the style already has above them. */
    const above = LAYERS.slice(LAYERS.indexOf(l) + 1).find(x => m.getLayer(x.id));
    m.addLayer({ id: l.id, type: l.type, source: l.src, paint,
                 ...(l.type === 'line' ? { layout: { 'line-cap': 'round', 'line-join': 'round' } } : {}) }, above?.id);
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

const polygon = (pts) => ({ type: 'Feature', properties: {},
  geometry: { type: 'Polygon', coordinates: [pts.map(p => [p.lon, p.lat])] } });

function paintLayers(v) {
  const { map: m } = map();
  if (!m || !ensureLayers(m)) return;
  const rn = reachNow(v);
  const passed = new Set(rn.passed);
  const perim = v.marks.filter(x => MARKS[x.kind]?.line && x.pts?.length >= 2);
  setData(m, 'inc-lines', lines(perim.map(x => lineFeature(x.pts, { id: x.id, warn: passed.has(x.id) }))));
  const main = rn.reach?.main.m >= 1 ? ring(v.inc.lkp, rn.reach.main.m, 72) : null;
  setData(m, 'inc-reach', lines(main ? [polygon(main)] : []));
  const wide = rn.reach?.wide?.m >= 1 ? ring(v.inc.lkp, rn.reach.wide.m, 72) : null;
  setData(m, 'inc-reach-wide', lines(wide ? [lineFeature(wide)] : []));
  paintReachTag(main, rn.reach);
  setData(m, 'inc-trail', lines(v.trail.length >= 2 ? [lineFeature(v.trail)] : []));
  const ahead = v.inc?.status === 'active' || v.replay ? aheadLine(trailInfo(v.trail, v.inc, v.now)) : null;
  setData(m, 'inc-ahead', lines(ahead ? [lineFeature(ahead)] : []));
  const draft = I.tool?.kind === 'perimeter' ? I.tool.pts : [];
  setData(m, 'inc-draft', lines(draft.length >= 2 ? [lineFeature(draft)] : []));
  setData(m, 'inc-draft-pts', { type: 'FeatureCollection', features: draft.map(p => ({ type: 'Feature', properties: {},
    geometry: { type: 'Point', coordinates: [p.lon, p.lat] } })) });
}

/* A small tag on the ring's edge, so the chief never reads the ring as
   where the person is. On a phone it is the only caveat the map shows, so
   it goes on whichever edge it can be read whole: west first (the status
   pill covers the north, the panel the south), then east, south, north;
   inside the ring each time. Hidden when no edge is on screen. */
const TAG_SPOTS = [
  { i: 54, anchor: 'left', offset: [6, 0] },     // west
  { i: 18, anchor: 'right', offset: [-6, 0] },   // east
  { i: 36, anchor: 'bottom', offset: [0, -6] },  // south (the ring runs clockwise from north)
  { i: 0, anchor: 'top', offset: [0, 6] },       // north
];
function paintReachTag(main, reach) {
  const g = map();
  if (!main || !g.map || !g.GL) { I.reachTag?.marker.remove(); I.reachTag = null; return; }
  const text = `${PACES[reach.pace].label} range · rough guide`;
  if (!I.reachTag) {
    const el = document.createElement('div');
    el.className = 'inc-reach-tag';
    el.setAttribute('aria-hidden', 'true');
    I.reachTag = { el, spot: null, marker: new g.GL.Marker({ element: el, anchor: 'left', offset: [6, 0] }).setLngLat([main[54].lon, main[54].lat]).addTo(g.map) };
  }
  const tag = I.reachTag;
  if (tag.el.textContent !== text) tag.el.textContent = text;
  const box = g.map.getCanvas();
  const W = box.clientWidth, H = box.clientHeight;
  const tw = tag.el.offsetWidth || 160, th = tag.el.offsetHeight || 20;
  const pad = mapPad();
  /* The Wall box (clock and log) sits over a corner of the map, not along a
     whole side, so the padding alone lets the tag slide under it: the tag
     must clear its box as well, or the caveat is hidden on the big screen. */
  const wb = wallOn() ? $('cmdWall') : null;
  const cr = box.getBoundingClientRect();
  const wr = wb && !wb.hidden ? wb.getBoundingClientRect() : null;
  const under = (x0, y0) => !!wr && wr.width > 0 &&
    x0 + cr.left < wr.right + 6 && x0 + tw + cr.left > wr.left - 6 &&
    y0 + cr.top < wr.bottom + 6 && y0 + th + cr.top > wr.top - 6;
  /* Where the tag's box would be for each edge, inside what the panel leaves. */
  const fits = (s) => {
    const p = g.map.project([main[s.i].lon, main[s.i].lat]);
    const x0 = s.anchor === 'left' ? p.x + 6 : s.anchor === 'right' ? p.x - 6 - tw : p.x - tw / 2;
    const y0 = s.anchor === 'bottom' ? p.y - 6 - th : s.anchor === 'top' ? p.y + 6 : p.y - th / 2;
    return x0 >= 4 && y0 >= Math.min(pad.top, H / 3) && x0 + tw <= W - Math.min(pad.right, W / 2) - 4 &&
      y0 + th <= H - Math.min(pad.bottom, H / 2) - 4 && !under(x0, y0);
  };
  const spot = TAG_SPOTS.find(fits) || null;
  tag.el.hidden = !spot;
  if (!spot) return;
  /* Mapbox anchors a marker once: a different edge means a new marker. */
  if (tag.spot !== spot) {
    tag.marker.remove();
    tag.marker = new g.GL.Marker({ element: tag.el, anchor: spot.anchor, offset: spot.offset })
      .setLngLat([main[spot.i].lon, main[spot.i].lat]).addTo(g.map);
    tag.spot = spot;
  }
  tag.marker.setLngLat([main[spot.i].lon, main[spot.i].lat]);
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
  }
  /* The team's calls fall within a few metres of each other: a pin that
     would sit on one already drawn moves along beside it. Sized from the
     pins as drawn (Wall mode makes them half as big again), so a pin moved
     aside clears the widest; and the latest call is always on top, so a
     newer "RE" never hides under an older "LOST". */
  let w = PIN_W, h = 24;
  for (const mk of marks) {
    const pe = I.markers.get(mk.id).pin;
    w = Math.max(w, pe.offsetWidth + 4);
    h = Math.max(h, pe.offsetHeight);
  }
  marks.forEach((mk, n) => {
    const p = I.markers.get(mk.id);
    const at = g.map.project([mk.lon, mk.lat]);
    const k = placed.filter(q => Math.abs(q.x - at.x) < w && Math.abs(q.y - at.y) < h).length;
    placed.push(at);
    if (p.shift !== k || p.w !== w) { p.shift = k; p.w = w; p.marker.setOffset([k * w, 0]); }
    const z = String(1 + n);
    if (p.el.style.zIndex !== z) p.el.style.zIndex = z;
  });
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
  if (I.on) { m?.off('click', onMapClick); handsOff(m); I.on = false; }
  I.follow = { paused: false, at: 0, for: null };
  const fb = $('cmdFollow');
  if (fb) fb.hidden = true;
  for (const p of I.markers.values()) p.marker.remove();
  I.markers.clear();
  for (const p of I.pins.values()) p.marker.remove();
  I.pins.clear();
  I.reachTag?.marker.remove(); I.reachTag = null;
  I.log = []; I.logKey = '';
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
  if (!I.on && m) { m.on('click', onMapClick); handsOn(m); I.on = true; }
  if (I.sim) I.sim.step(viewNow());
  const v = shown();
  const live = v.inc && v.inc.status === 'active' && !v.replay ? v.inc : null;
  setLeadUnit(v.inc?.k9Uid ?? null);
  $('cmdPanel')?.classList.toggle('inc-on', !!live);
  /* Close in, Wall mode's short pins show their details again. */
  if (m) $('map').classList.toggle('map-zoomed', m.getZoom() >= 17);
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
  followTeam(v, st, live);
  speakCalls(v, st, live);
  paintWall(v, st);
  paintBanner();
}

/* ── Following the K9 team ───────────────────────────────────────────────
   During an incident the map keeps the team, the last known point and the
   perimeter in view by itself. A hand on the map (a drag, a pinch, a wheel,
   a tap on a unit in the list) means someone wants to look elsewhere: the
   map stops following and a Follow K9 button brings it back. Drawing a line
   or setting a point never moves the map under the finger either. */
const FOLLOW_GAP_MS = 2500;
function onHand(e) {
  /* Only the person's own moves: the map easing itself has no originalEvent. */
  if (e && !e.originalEvent) return;
  pauseFollow();
}
function pauseFollow() {
  if (I.follow.paused || !followable()) return;
  I.follow.paused = true;
  paintFollowBtn();
}
const HAND_EVENTS = ['dragstart', 'zoomstart', 'rotatestart', 'pitchstart'];
function handsOn(m) { for (const ev of HAND_EVENTS) m.on(ev, onHand); }
function handsOff(m) { for (const ev of HAND_EVENTS) m?.off(ev, onHand); }
/** There is a live incident with a team on the map to follow. */
function followable() {
  const v = shown();
  return !!(v.inc && v.inc.status === 'active' && !v.replay && v.inc.k9Uid);
}
function paintFollowBtn() {
  const b = $('cmdFollow');
  if (b) b.hidden = !(I.follow.paused && followable());
}
function resumeFollow() {
  I.follow.paused = false;
  I.follow.at = 0;
  paintFollowBtn();
  followTeam(shown(), commandView(), shown().inc, true);
}
function followTeam(v, st, live, force = false) {
  const g = map();
  if (!g.map || !live || !live.k9Uid) return paintFollowBtn();
  /* A new incident follows from the start, whatever the last one was left at. */
  if (I.follow.for !== live.id) I.follow = { paused: false, at: Date.now(), for: live.id };
  paintFollowBtn();
  if (I.follow.paused || I.tool || I.form || g.map.isMoving?.()) return;
  if (!force && Date.now() - I.follow.at < FOLLOW_GAP_MS) return;
  const k9 = st.positions?.get(live.k9Uid) ?? null;
  const pts = followPoints({ inc: live, marks: v.marks, k9 });
  const c = g.map.getCanvas?.();
  const size = { w: c?.clientWidth || window.innerWidth, h: c?.clientHeight || window.innerHeight };
  const onScreen = pts.map(p => g.map.project([p.lon, p.lat]));
  if (!force && allInView(onScreen, size, mapPad())) return;
  I.follow.at = Date.now();
  /* Room round the team and the point, so the map does not move again at
     the team's very next step. */
  const room = [];
  if (k9) for (const b of [0, 90, 180, 270]) room.push(project(k9, b, 80));
  for (const b of [0, 90, 180, 270]) room.push(project(live.lkp, b, 120));
  fitOnMap([...pts, ...room], 17);
}

/* ── Hearing the K9 team's calls ─────────────────────────────────────────
   The command screen says each call of the team out loud in the coach's
   voice ("K9-1, lost it"), so Command hears it without watching the map.
   Calls already made when the screen opens are not said; a handler does not
   hear their own. It can be switched off on the incident card. */
function speakCalls(v, st, live) {
  if (!live) return;
  if (I.said.for !== live.id) {
    I.said = { for: live.id, ids: new Set(v.marks.filter(mk => MARKS[mk.kind]?.k9).map(mk => mk.id)) };
    return;
  }
  const fresh = v.marks.filter(mk => MARKS[mk.kind]?.k9 && !I.said.ids.has(mk.id)).sort((a, b) => a.at - b.at);
  if (!fresh.length) return;
  for (const mk of fresh) I.said.ids.add(mk.id);
  if (!I.voice || !ctx.speak) return;
  const words = fresh.filter(mk => mk.by !== meUid()).map(mk => callWords(mk.kind, who(mk.by, st.members)));
  if (words.length) { try { ctx.speak(words.join('. ')); } catch { /* no voice here */ } }
}
function setVoice(on) {
  I.voice = !!on;
  try { ctx.kv.set('squadVoice', I.voice); } catch { /* full */ }
  paintCommandNow();
}

/* ── Wall mode's side (squad-ui.js draws the clock) ──────────────────────
   The incident and its latest lines, in big type. */
/* The last five lines of the live log, newest first as on the card, a
   withdrawn one crossed out; and the time since last seen with the
   perimeter warning. With no last-seen time given it says so, rather than
   show a last-seen clock nobody gave. */
function paintWall(v, st) {
  if (!wallOn()) { I.wallKey = ''; return; }
  const head = $('cmdWallInc');
  const line = v.inc
    ? `${v.inc.name} · ${v.replay ? 'replay' : v.inc.status === 'active' ? `${elapsedWords(v.now - v.inc.startedAt)} since start` : 'ended'}`
    : 'No incident';
  if (head.textContent !== line) head.textContent = line;
  const seen = $('cmdWallSeen');
  const rn = reachNow(v);
  const upTo = v.inc ? Math.min(v.now, v.inc.endedAt ?? Infinity) : 0;
  const since = !v.inc ? '' : finite(v.inc.lastSeenAt) ? `${elapsedWords(upTo - v.inc.lastSeenAt)} since last seen`
    : `Opened ${elapsedWords(upTo - v.inc.startedAt)} ago · last seen not given`;
  const seenLine = v.inc ? `${since}${rn.warn ? ` · ${rn.warn} · rough guide` : ''}` : '';
  if (seen.textContent !== seenLine) seen.textContent = seenLine;
  seen.classList.toggle('warn', !!rn.warn);
  const lines = v.inc ? logOf(v, st.members).filter(l => !l.ahead).slice(-5).reverse() : [];
  const key = lines.map(l => `${l.key}|${l.text}|${l.withdrawn || ''}`).join('\n');
  if (key === I.wallKey) return;
  I.wallKey = key;
  put($('cmdWallLog'), html`${lines.map(l => html`<li class="${l.withdrawn ? 'inc-log-off' : ''}"><span class="inc-log-text">${l.time} ${l.text}</span>${l.withdrawn ? html` <i class="inc-log-why">${l.withdrawn}</i>` : ''}</li>`)}`);
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
    k9s.map(k => [k.uid, k.on]), I.form?.k9Uid, !!I.form?.lkp, I.form?.pace, I.form?.article, I.replay?.playing, I.replay?.speed, I.voice]);
  if (md === 'none' && !cmd && !lastEnded) { box.hidden = true; I.panelKey = ''; return; }
  box.hidden = false;
  if (key !== I.panelKey) {
    I.panelKey = key;
    I.logKey = '';
    put(box, panelHtml(md, { st, v, me, cmd, lastEnded, running, k9s }));
  }
  paintLive(box, st, v);
  paintLog(box, st, v);
}

function panelHtml(md, { st, v, me, cmd, lastEnded, running, k9s }) {
  if (md === 'replay') {
    const r = I.replay;
    return html`<div class="inc-card inc-replay">
      <p class="inc-kicker">Debrief replay</p>
      <h3 class="inc-name">${r.rp.inc.name}</h3>
      <input type="range" class="inc-scrub" data-inc-scrub min="0" max="${Math.round((r.rp.end - r.rp.start) / 1000)}" step="1" value="0" aria-label="Replay time">
      <p class="inc-clock" data-inc-text="clock"></p>
      <p class="inc-onscent" data-inc-text="onScent"></p>
      <p class="inc-warn" data-inc-text="warn"></p>
      <div class="inc-tools">
        <button type="button" class="btn small moss" data-inc-act="play">${r.playing ? 'Pause' : 'Play'}</button>
        <button type="button" class="btn ghost small" data-inc-act="speed">×${r.speed}</button>
        <button type="button" class="btn ghost small" data-inc-act="unreplay">Back to live</button>
      </div>
      ${logHtml()}
    </div>`;
  }
  if (md === 'form') {
    const f = I.form;
    return html`<div class="inc-card">
      <p class="inc-kicker">Start an incident</p>
      <label class="inc-field">Name<input type="text" data-inc-name maxlength="80" value="${f.name}" autocomplete="off"></label>
      <p class="inc-hint">${f.lkp ? 'Last known point set. Tap the map again to move it.' : 'Tap the map where the person was last seen.'}</p>
      <label class="inc-field">Last seen at<input type="time" data-inc-seen value="${f.seen}"></label>
      <p class="inc-hint">Leave it empty for when the incident opens.</p>
      <p class="inc-label">How they left</p>
      <div class="inc-chips">${[...PACE_KEYS.map(k => [k, PACES[k].label]), ['', 'Not known']].map(([k, t]) => html`<button type="button" class="chip" data-inc-pace="${k}" aria-pressed="${String((f.pace || '') === k)}">${t}</button>`)}</div>
      <p class="inc-label">Handler’s brief</p>
      <label class="inc-field">Direction of travel<input type="text" data-inc-dir maxlength="${DIR_MAX}" value="${f.dir}" placeholder="north, towards the station" autocomplete="off"></label>
      <label class="inc-field">Description<input type="text" data-inc-desc maxlength="${DESC_MAX}" value="${f.desc}" placeholder="what they look like, what they wear" autocomplete="off"></label>
      <p class="inc-hint">${DESC_HINT}</p>
      <p class="inc-label">Scent article</p>
      <div class="inc-chips">${[['yes', 'Yes'], ['no', 'No'], ['', 'Not known']].map(([k, t]) => html`<button type="button" class="chip" data-inc-art="${k}" aria-pressed="${String(artKey(f.article) === k)}">${t}</button>`)}</div>
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
      <button type="button" class="inc-strip" data-inc-act="unfold" aria-label="Show the incident card"><span class="inc-dot" aria-hidden="true"></span><span data-inc-text="strip"></span></button>
      <p class="inc-kicker"><span class="inc-dot" aria-hidden="true"></span> Incident</p>
      <h3 class="inc-name">${inc.name}</h3>
      <p class="inc-seen"><b class="inc-seen-clock" data-inc-text="seenClock"></b><span class="inc-seen-sub" data-inc-text="seenSub"></span></p>
      <p class="inc-warn" data-inc-text="warn" role="status"></p>
      <p class="inc-team"><b>${team}</b> <span data-inc-text="state"></span></p>
      <p class="inc-onscent" data-inc-text="onScent"></p>
      <p class="inc-facts" data-inc-text="facts"></p>
      <p class="inc-brief" data-inc-text="brief"></p>
      <p class="inc-reach" data-inc-text="reach"></p>
      <p class="inc-quiet" data-inc-text="quiet"></p>
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
        ${cmd ? html`<button type="button" class="btn ghost small" data-inc-act="seen">Last seen &amp; brief</button>` : ''}
        <button type="button" class="btn ghost small" data-inc-act="paces">Paces</button>
        ${ctx.speak ? html`<button type="button" class="btn ghost small" data-inc-act="voice" aria-pressed="${String(I.voice)}">${I.voice ? 'Voice on' : 'Voice off'}</button>` : ''}
        ${cmd ? html`<button type="button" class="btn danger small" data-inc-act="end">End incident</button>` : ''}
      </div>
      ${logHtml()}
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

const artKey = (a) => (a === true ? 'yes' : a === false ? 'no' : '');

/** The rings and the perimeter lines they have passed, for what is on the
    map now (a replay's moment included). */
function reachNow(v) {
  if (!v.inc) return { reach: null, passed: [], warn: '' };
  const reach = reachRings({ inc: v.inc, now: v.now, paces: I.paces });
  const passed = passedLines({ inc: v.inc, marks: v.marks, reach });
  return { reach, passed, warn: passed.length ? warnWords(reach.pace) : '' };
}

/* ── The live log ─────────────────────────────────────────────────────────
   Built from the incident, the trail and every mark (incident.js logLines),
   newest first on the card. A tap on a line takes the map there, and in a
   replay the slider to that moment too. */
const logHtml = () => html`<p class="inc-label">Log</p><ol class="inc-log" data-inc-log aria-label="Incident log"></ol>`;

function logOf(v, members) {
  if (!v.inc) return [];
  const k9 = v.inc.k9Uid ? members?.get(v.inc.k9Uid) : null;
  const team = k9 ? `${k9.callSign}${k9.dog ? ` ${k9.dog}` : ''}` : '';
  const base = { inc: v.inc, who: (uid) => who(uid, members), team };
  if (!v.replay || !I.replay) return logLines({ ...base, marks: v.said || v.marks, trail: v.trail });
  /* A replay lists the whole incident, so a tap can jump forward as well as
     back, and no line arrives under a finger: what had happened by the
     slider's moment as it stood then, and what is still to come, dimmed. */
  const rp = I.replay.rp;
  const past = logLines({ ...base, marks: v.said, trail: v.trail, now: v.now });
  const unit = rp.units.find(u => u.uid === rp.inc.k9Uid);
  const ahead = logLines({ ...base, marks: rp.marks, trail: unit ? unit.pts : [], now: Infinity })
    .filter(l => l.t > v.now).map(l => ({ ...l, withdrawn: null, ahead: true }));
  return [...past, ...ahead];
}

function paintLog(box, st, v) {
  const el = box.querySelector('[data-inc-log]');
  if (!el) return;
  const lines = logOf(v, st.members);
  /* In a replay, the latest line by the slider's moment is marked. */
  let at = -1;
  if (v.replay) lines.forEach((l, i) => { if (!l.ahead) at = i; });
  const key = `${at}\n${lines.map(l => `${l.key}|${l.time}|${l.text}|${l.withdrawn || ''}|${l.ahead ? 1 : 0}`).join('\n')}`;
  if (key === I.logKey) return;
  I.logKey = key;
  I.log = lines;
  const cls = (l, i) => [l.withdrawn ? 'inc-log-off' : '', l.ahead ? 'inc-log-ahead' : '', i === at ? 'inc-log-now' : ''].filter(Boolean).join(' ');
  put(el, html`${lines.map((l, i) => html`<li class="${cls(l, i)}"><button type="button" class="inc-log-line" data-inc-log-i="${i}"${i === at ? html` aria-current="true"` : ''}><time>${l.time}</time> <span class="inc-log-text">${l.text}</span>${l.withdrawn ? html` <i class="inc-log-why">${l.withdrawn}</i>` : ''}</button></li>`).reverse()}`);
}

/** A tap on a line of the log. */
function onLogLine(i) {
  const l = I.log[i];
  if (!l) return;
  if (I.replay) {
    const r = I.replay;
    playReplay(false);
    r.t = Math.max(r.rp.start, Math.min(r.rp.end, l.t));
    paintCommandNow();
  } else {
    pauseFollow();
  }
  if (l.pts?.length) fitOnMap(l.pts, 17);
  else if (l.at) fitOnMap([l.at]);
}

/* ── Last seen, the brief and the paces, changed after the start ───────── */
async function editSeen() {
  const v = shown();
  if (!v.inc || v.inc.status !== 'active' || v.replay || !amCommand()) return;
  const inc = v.inc;
  const got = await form({
    title: 'Last seen and the brief',
    body: 'The clock and the rings start from last seen.',
    fields: [
      /* Only what Command said: an empty time and "Not known" stay so on
         Save, rather than the opening time and walking being written in. */
      { key: 'seen', label: 'Last seen at', type: 'time', value: finite(inc.lastSeenAt) ? hhmm(inc.lastSeenAt) : '',
        hint: 'Empty: not known, the clock runs from when the incident opened.' },
      { key: 'pace', label: 'How they left', value: inc.pace || '',
        choices: [{ value: '', text: 'Not known' }, ...PACE_KEYS.map(k => ({ value: k, text: PACES[k].label }))] },
      { key: 'dir', label: 'Direction of travel', value: inc.brief?.dir || '', max: DIR_MAX },
      { key: 'desc', label: 'Description', value: inc.brief?.desc || '', max: DESC_MAX, hint: DESC_HINT },
      { key: 'art', label: 'Scent article', value: artKey(inc.brief?.article ?? null),
        choices: [{ value: '', text: 'Not known' }, { value: 'yes', text: 'Yes' }, { value: 'no', text: 'No' }] },
    ],
    yes: 'Save',
  });
  if (!got) return;
  /* The sheet was up a while: the incident may have ended under it. */
  const now = shown();
  if (!now.inc || now.inc.id !== inc.id || now.inc.status !== 'active') return;
  const t = got.seen ? lastSeenFrom(got.seen, now.now) : null;
  if (got.seen && t == null) return ctx.toast('Last seen: a time like 14:05');
  if (Number.isNaN(t)) return ctx.toast('That time is after now');
  /* Refused rather than quietly moved to the opening: the clock and the
     rings hang on it, so Command should see it was not taken. */
  if (t != null && t > inc.startedAt) return ctx.toast('Last seen can’t be after the incident opened');
  const patch = { lastSeenAt: t, pace: got.pace || null,
                  brief: cleanBrief({ dir: got.dir, desc: got.desc, article: got.art === 'yes' ? true : got.art === 'no' ? false : null }) };
  if (now.sim) { I.sim.setSeen(patch); paintCommandNow(); return; }
  try {
    const h = await ctx.handle();
    await updateSeen(h, I.sid, now.inc, patch);
  } catch (e) {
    ctx.toast(String(e?.code || '').includes('permission') ? 'Only Command can change it' : 'Could not save it');
  }
}

async function editPaces() {
  const unit = imperial() ? 'mph' : 'km/h';
  const shownPace = (kmh) => String(imperial() ? Math.round(kmh / 1.609344) : kmh);
  const got = await form({
    title: 'Paces for the rings',
    body: `How far someone could go in an hour, in ${unit}.`,
    fields: PACE_KEYS.map(k => ({ key: k, label: PACES[k].label, value: shownPace(I.paces[k]), max: 5, inputmode: 'decimal' })),
    note: 'A rough guide, on this device only. It never moves or shrinks a perimeter: Command decides.',
    yes: 'Save', grid: true,
  });
  if (!got) return;
  const kmh = {};
  for (const k of PACE_KEYS) {
    const n = Number(String(got[k]).replace(',', '.'));
    kmh[k] = imperial() ? n * 1.609344 : n;
  }
  I.paces = cleanPaces(kmh);
  try { ctx.kv.set('squadPaces', I.paces); } catch { /* full */ }
  paintCommandNow();
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
    text('onScent', onScentWords({ inc: v.inc, trail: v.trail, now: v.now }));
    text('warn', reachNow(v).warn);
  }
  if (v.inc && v.inc.status === 'active' && !I.replay) {
    const info = trailInfo(v.trail, v.inc, v.now);
    const going = v.trail.length >= 2;
    /* The team's last call on the scent is what the others act on. */
    const call = v.marks.filter(mk => MARKS[mk.kind].k9).sort((a, b) => b.at - a.at)[0];
    const lastCall = call ? ` · last call: ${MARKS[call.kind].label}, ${elapsedWords(v.now - call.at)} ago` : '';
    text('state', going ? `${info.heading != null ? `trailing, heading ${info.compass}` : 'trailing'}${lastCall}` : 'on the way to the last known point');
    const bits = [`${elapsedWords(info.elapsedMs)} since start`];
    if (going) bits.push(`${distWords(info.lengthM)} of trail`, `${distWords(info.fromLkpM)} from the last known point`);
    const counts = {};
    for (const mk of v.marks) counts[mk.kind] = (counts[mk.kind] || 0) + 1;
    const said = Object.keys(counts).map(k => countWords(k, counts[k]));
    if (said.length) bits.push(said.join(', '));
    text('facts', bits.join(' · '));
    const k9 = v.inc.k9Uid ? st.members.get(v.inc.k9Uid) : null;
    /* The clock from last seen, and how far that is at the chosen pace. */
    const rn = reachNow(v);
    /* The folded phone strip carries the same clock and warning as the card. */
    text('strip', stripWords({ k9, info, call, now: v.now, warn: rn.warn,
                               seenMs: finite(v.inc.lastSeenAt) ? v.now - v.inc.lastSeenAt : null }));
    box.querySelector('.inc-strip')?.classList.toggle('warn', !!rn.warn);
    text('quiet', quietLines(st.rows, v.now).join('\n'));
    const from = seenAt(v.inc);
    text('seenClock', clockWords(v.now - from));
    text('seenSub', ` since last seen at ${hhmm(from)}${from === v.inc.startedAt ? ' (when the incident opened)' : ''}`);
    text('warn', rn.warn);
    text('onScent', onScentWords({ inc: v.inc, trail: v.trail, now: v.now }));
    text('brief', briefWords(v.inc.brief, v.inc.pace));
    text('reach', reachWords(rn.reach, imperial()));
  }
}

function onPanelClick(e) {
  const box0 = $('cmdIncident');
  const k9 = e.target.closest('[data-inc-k9]');
  if (k9 && I.form) { readForm(box0); I.form.k9Uid = k9.dataset.incK9 || null; return paintCommandNow(); }
  const pace = e.target.closest('[data-inc-pace]');
  if (pace && I.form) { readForm(box0); I.form.pace = pace.dataset.incPace || null; return paintCommandNow(); }
  const art = e.target.closest('[data-inc-art]');
  if (art && I.form) {
    readForm(box0);
    I.form.article = art.dataset.incArt === 'yes' ? true : art.dataset.incArt === 'no' ? false : null;
    return paintCommandNow();
  }
  const line = e.target.closest('[data-inc-log-i]');
  if (line) return onLogLine(Number(line.dataset.incLogI));
  const b = e.target.closest('[data-inc-act]');
  if (!b) return;
  const act = b.dataset.incAct;
  if (I.form) readForm(box0);
  if (act === 'start') return openForm();
  if (act === 'quick') return quickSim();
  if (act === 'cancel') { I.form = null; return paintCommandNow(); }
  if (act === 'go') return doStart();
  if (act === 'end') return doEnd();
  if (act === 'fit') return fitIncident();
  if (act === 'unfold') return foldPanel(false);
  if (act === 'voice') return setVoice(!I.voice);
  if (act === 'seen') return editSeen();
  if (act === 'paces') return editPaces();
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
    <span class="sq-who"><b>${i.name}</b><i>${new Date(i.startedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}${i.summary ? ` · ${elapsedWords(i.summary.durationMs)} · ${distWords(i.summary.k9M)} of trail` : ''}</i></span>
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
  try { I.voice = ctx.kv.get('squadVoice', true) !== false; } catch { /* the default */ }
  try { I.paces = cleanPaces(ctx.kv.get('squadPaces', null)); } catch { /* the defaults */ }
  onLook(pauseFollow);
  onWall(() => { I.wallKey = ''; I.follow.at = 0; if (sq().view) paintCommandNow(); });
  $('cmdFollow').addEventListener('click', resumeFollow);
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
