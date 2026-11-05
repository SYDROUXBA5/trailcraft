/* An incident on the squad map: someone is missing or has run, Command
   starts an incident, a K9 team trails from the last known point, and every
   member sees the trail grow, the marks the team calls, and the perimeter
   the others set up around it. Ended, it is kept for the debrief and played
   back.

   The part with no screen and no cloud: the documents, cleaning what other
   phones wrote, a member's movements cut into minute-long pieces for the
   cloud, the trail's direction and age, the replay, and a pretend incident
   for the demo. Like squad.js, everything read back from the cloud was
   written by someone else's phone, so it is cleaned here before it is drawn. */

import { dist, bearing, project, pathLen } from './geo.js';
import { MARK_KINDS, K9_MARKS, INCIDENT_TTL, ROLES, cleanCallSign, compass, rng } from './squad.js';

/* ── Marks ──────────────────────────────────────────────────────────────
   short is what fits on the pin; label is the word for it everywhere else. */
export const MARKS = {
  indication: { label: 'Indication', short: 'IND', k9: true, many: 'indications' },
  lost: { label: 'Lost it', short: 'LOST', k9: true, many: 'lost it' },
  refound: { label: 'Re-found', short: 'RE', k9: true, many: 're-found' },
  article: { label: 'Article found', short: 'ART', many: 'articles found' },
  sighting: { label: 'Sighting', short: 'SEEN', many: 'sightings' },
  roadblock: { label: 'Roadblock', short: 'RB', many: 'roadblocks' },
  rally: { label: 'Rally point', short: 'RP', many: 'rally points' },
  perimeter: { label: 'Perimeter', short: '', line: true, one: 'perimeter line', many: 'perimeter lines' },
};
/** "3 roadblocks", "1 lost it". */
export const countWords = (kind, n) => `${n} ${n === 1 ? (MARKS[kind].one || MARKS[kind].label.toLowerCase()) : MARKS[kind].many}`;
/* What anyone but the trailing team can put on the map from the squad map. */
export const DRAW_TOOLS = ['perimeter', 'sighting', 'roadblock', 'rally'];
/* The run screen's own marks, as the incident knows them. Reward is the
   dog's, not the search's, and stays on the phone. */
export const RUN_MARKS = { Indication: 'indication', 'Lost it': 'lost', 'Re-found': 'refound', Article: 'article' };
export const LINE_MAX = 200;      // points in one perimeter line (the rules say the same)
export const COLUMN_MAX = 600;    // fixes in one minute of a track (likewise)
export const INCIDENT_NAME_MAX = 80;
export const LABEL_MAX = 60;

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const round6 = (v) => Math.round(v * 1e6) / 1e6;
const tidy = (s, n) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);
export const cleanIncidentName = (s) => tidy(s, INCIDENT_NAME_MAX);
export const cleanLabel = (s) => tidy(s, LABEL_MAX);
const isPlace = (p) => !!p && finite(p.lat) && finite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180;
const placeOf = (p) => ({ lat: round6(p.lat), lon: round6(p.lon) });

/* ── The cloud's documents (squad.js PATHS) ──────────────────────────── */
/** A new incident. One at a time per squad is the app's habit, not a rule:
    two at once would only be confusing, never unsafe. */
export function incidentDoc({ name, lkp, k9Uid, uid, now }) {
  return {
    name: cleanIncidentName(name) || 'Incident',
    lkp: placeOf(lkp),
    k9Uid: typeof k9Uid === 'string' && k9Uid ? k9Uid : null,
    startedBy: uid, startedAt: now, endedAt: null, status: 'active', summary: null,
    expiresAt: now + INCIDENT_TTL,
  };
}

/** An incident as another phone wrote it, or null. */
export function cleanIncident(d, id) {
  if (!d || typeof d !== 'object' || !isPlace(d.lkp) || !finite(d.startedAt)) return null;
  const s = d.summary && typeof d.summary === 'object' ? d.summary : null;
  return {
    id,
    name: cleanIncidentName(d.name) || 'Incident',
    lkp: { lat: d.lkp.lat, lon: d.lkp.lon },
    k9Uid: typeof d.k9Uid === 'string' && d.k9Uid ? d.k9Uid : null,
    startedBy: typeof d.startedBy === 'string' ? d.startedBy : '',
    startedAt: d.startedAt,
    endedAt: finite(d.endedAt) ? d.endedAt : null,
    status: d.status === 'ended' ? 'ended' : 'active',
    summary: s ? {
      durationMs: finite(s.durationMs) ? s.durationMs : 0,
      k9M: finite(s.k9M) ? s.k9M : 0,
      marks: finite(s.marks) ? s.marks : 0,
      units: finite(s.units) ? s.units : 0,
    } : null,
  };
}

/** The incident in force, if any: the newest one still active. */
export function activeOf(incidents) {
  let best = null;
  for (const i of incidents.values()) if (i.status === 'active' && (!best || i.startedAt > best.startedAt)) best = i;
  return best;
}
/** Ended incidents, newest first, for the debrief list. */
export const pastOf = (incidents) => [...incidents.values()].filter(i => i.status === 'ended')
  .sort((a, b) => (b.endedAt || b.startedAt) - (a.endedAt || a.startedAt));

/** A mark for the cloud: a point (lat, lon) or a line (pts). */
export function markDoc({ kind, uid, at, lat = null, lon = null, pts = null, label = null }) {
  const line = MARKS[kind]?.line;
  return {
    kind, by: uid, at,
    lat: line ? null : round6(lat), lon: line ? null : round6(lon),
    pts: line ? (pts || []).slice(0, LINE_MAX).map(placeOf) : null,
    label: cleanLabel(label) || null,
    expiresAt: at + INCIDENT_TTL,
  };
}

/** A mark as another phone wrote it, or null when it is not one. */
export function cleanMark(d, id) {
  if (!d || typeof d !== 'object' || !MARK_KINDS.includes(d.kind) || !finite(d.at)) return null;
  const by = typeof d.by === 'string' ? d.by : '';
  const label = cleanLabel(d.label) || null;
  if (MARKS[d.kind].line) {
    const pts = Array.isArray(d.pts) ? d.pts.slice(0, LINE_MAX).filter(isPlace).map(p => ({ lat: p.lat, lon: p.lon })) : [];
    return pts.length >= 2 ? { id, kind: d.kind, by, at: d.at, pts, label } : null;
  }
  if (!isPlace(d)) return null;
  return { id, kind: d.kind, by, at: d.at, lat: d.lat, lon: d.lon, label };
}

/** Whether `uid` may put a mark of this kind on this incident: the scent
    calls are the trailing team's alone (as the rules say). */
export const mayMark = (inc, uid, kind) => !!inc && inc.status === 'active' && MARK_KINDS.includes(kind)
  && (!K9_MARKS.includes(kind) || inc.k9Uid === uid);
/** Whether `uid` may take a mark back: their own, or anyone's if Command. */
export const mayUnmark = (mark, uid, command) => !!mark && (mark.by === uid || !!command);

/** Whether this phone's run goes into the incident, as the trail and calls
    every member sees. Only the incident's own K9 team, only while On duty
    (nothing is shared with the switch off: that is the promise), and only
    once they have pressed Start trailing for this incident (`consent`), so
    a handler picked while out on a private run is not streamed unasked. */
export const mayShareRun = ({ inc, me, onDuty, consent }) => !!inc && inc.status === 'active' && !!me
  && inc.k9Uid === me && !!onDuty && consent === inc.id;

/* ── A member's movements, a minute to a document ──────────────────────
   The replay needs everyone's movements, not just where they are now. Each
   phone keeps its own and sends them as one document per minute of the
   incident ({uid}_{minute}): the trailing team every ten seconds, so that
   the trail grows on everyone's map while they look; everyone else once a
   minute, as nobody watches those until the debrief. */
export const minuteOf = (startedAt, t) => Math.max(0, Math.min(2880, Math.floor((t - startedAt) / 60e3)));

export function trackBuffer(startedAt) {
  const minutes = new Map();   // n → { lat: [], lon: [], t: [] }
  const dirty = new Set();
  let lastT = -Infinity;
  return {
    /** A fix, if it is newer than the last one kept. */
    add(p) {
      if (!isPlace(p) || !finite(p.t) || p.t <= lastT) return false;
      const n = minuteOf(startedAt, p.t);
      let m = minutes.get(n);
      if (!m) minutes.set(n, (m = { lat: [], lon: [], t: [] }));
      if (m.t.length >= COLUMN_MAX) return false;
      m.lat.push(round6(p.lat)); m.lon.push(round6(p.lon)); m.t.push(Math.round(p.t));
      lastT = p.t;
      dirty.add(n);
      return true;
    },
    /** The minutes changed since they were last taken, to send. */
    take() {
      const out = [...dirty].sort((a, b) => a - b).map(n => ({ n, ...copy(minutes.get(n)) }));
      dirty.clear();
      return out;
    },
    /** A send that failed goes back in the queue. */
    again(n) { if (minutes.has(n)) dirty.add(n); },
    get pending() { return dirty.size; },
  };
}
const copy = (m) => ({ lat: m.lat.slice(), lon: m.lon.slice(), t: m.t.slice() });

/** A minute of someone's track as their phone wrote it: the fixes in order,
    each a place. The account is the one in the document's name, whatever it
    says inside. */
export function cleanTrack(d, id) {
  if (!d || typeof d !== 'object') return null;
  const uid = String(id).replace(/_\d+$/, '');
  const n = Number(String(id).slice(uid.length + 1));
  if (!uid || !Number.isInteger(n)) return null;
  const lat = Array.isArray(d.lat) ? d.lat : [], lon = Array.isArray(d.lon) ? d.lon : [], t = Array.isArray(d.t) ? d.t : [];
  const pts = [];
  for (let i = 0; i < Math.min(lat.length, lon.length, t.length, COLUMN_MAX); i++) {
    const p = { lat: lat[i], lon: lon[i], t: t[i] };
    if (isPlace(p) && finite(p.t)) pts.push(p);
  }
  return { uid, n, pts, callSign: cleanCallSign(d.cs) || '', role: ROLES[d.role] ? d.role : '' };
}

/** Minutes of tracks → one line per member, in time order. */
export function joinTracks(tracks) {
  const by = new Map();
  for (const tr of tracks) {
    if (!tr) continue;
    let u = by.get(tr.uid);
    if (!u) by.set(tr.uid, (u = { uid: tr.uid, callSign: '', role: '', pts: [] }));
    if (tr.callSign) u.callSign = tr.callSign;
    if (tr.role) u.role = tr.role;
    u.pts.push(...tr.pts);
  }
  for (const u of by.values()) {
    u.pts.sort((a, b) => a.t - b.t);
    u.pts = u.pts.filter((p, i, a) => i === 0 || p.t > a[i - 1].t);
  }
  return by;
}

/* ── The trail, as the squad reads it ──────────────────────────────────
   Which way the team is going is worked over the last 40 m or so, not the
   last two fixes: a dog casting across a few metres would swing the arrow
   about and send officers the wrong way. */
export function trailInfo(trail, inc, now) {
  const elapsedMs = Math.max(0, (inc?.endedAt ?? now) - (inc?.startedAt ?? now));
  if (!trail?.length) return { elapsedMs, heading: null, compass: '', lengthM: 0, fromLkpM: null, head: null };
  const head = trail[trail.length - 1];
  let back = null;
  for (let i = trail.length - 2; i >= 0; i--) {
    if (dist(trail[i], head) >= 40) { back = trail[i]; break; }
  }
  const heading = back ? bearing(back, head) : null;
  return {
    elapsedMs, heading, compass: compass(heading), lengthM: Math.round(pathLen(trail)),
    fromLkpM: inc?.lkp ? Math.round(dist(inc.lkp, head)) : null, head,
  };
}

/** A line ahead of the team, the way it is going: where officers might get
    in front. Nothing when the way is not yet known. */
export const aheadLine = (info, m = 150) =>
  (info?.head && info.heading != null ? [info.head, project(info.head, info.heading, m)] : null);

/** "40 s", "12 min", "1 h 05". */
export function elapsedWords(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
}
/** A replay clock: "03:20" or "1:03:20". */
export function clockWords(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const two = (v) => String(v).padStart(2, '0');
  return h ? `${h}:${two(m)}:${two(r)}` : `${two(m)}:${two(r)}`;
}
export const metresWords = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);

/** What is kept on the incident when it ends, for the list of past ones. */
export function summarise({ inc, trail, marks, units, now }) {
  return {
    durationMs: Math.max(0, now - inc.startedAt),
    k9M: Math.round(pathLen(trail || [])),
    marks: marks ? marks.size ?? marks.length ?? 0 : 0,
    units: units || 0,
  };
}

/* ── Replay ─────────────────────────────────────────────────────────────
   Everyone's movements and every mark, played back against the incident's
   own clock. A member is drawn where their track says they were, moved
   smoothly between fixes; a long gap (a phone in a dead spot) is not
   bridged with a made-up straight line, so they stay put and go amber and
   then grey as they would have on the live map. */
const BRIDGE_MS = 90e3;

export function buildReplay({ inc, tracks, marks, members }) {
  const lines = tracks instanceof Map ? tracks : joinTracks(tracks);
  const units = [];
  for (const u of lines.values()) {
    if (!u.pts.length) continue;
    const m = members?.get(u.uid);
    units.push({
      uid: u.uid,
      callSign: m?.callSign || u.callSign || 'Unit',
      role: m?.role || u.role || 'officer',
      name: m?.name || '',
      dog: m?.dog || null,
      pts: u.pts,
    });
  }
  const ms = [...(marks instanceof Map ? marks.values() : marks || [])].sort((a, b) => a.at - b.at);
  const last = Math.max(inc.endedAt || 0, ...units.map(u => u.pts[u.pts.length - 1].t), ...ms.map(m => m.at));
  return { inc, start: inc.startedAt, end: Math.max(inc.startedAt + 1000, last), units, marks: ms };
}

/** Where one member was at `t`, or null before their first fix. */
export function placeAt(pts, t) {
  if (!pts.length || t < pts[0].t) return null;
  let lo = 0, hi = pts.length - 1;
  if (t >= pts[hi].t) return withHdg(pts, hi, { lat: pts[hi].lat, lon: pts[hi].lon, at: pts[hi].t, spd: 0 });
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (pts[mid].t <= t) lo = mid; else hi = mid; }
  const a = pts[lo], b = pts[hi];
  const gap = b.t - a.t;
  if (gap > BRIDGE_MS) return withHdg(pts, lo, { lat: a.lat, lon: a.lon, at: a.t, spd: 0 });
  const k = gap > 0 ? (t - a.t) / gap : 0;
  const d = dist(a, b);
  return { lat: a.lat + (b.lat - a.lat) * k, lon: a.lon + (b.lon - a.lon) * k, at: t,
           spd: gap > 0 ? d / (gap / 1000) : 0, hdg: d > 1 ? bearing(a, b) : null };
}
function withHdg(pts, i, p) {
  for (let j = i - 1; j >= 0; j--) if (dist(pts[j], pts[i]) > 1) return { ...p, hdg: bearing(pts[j], pts[i]) };
  return { ...p, hdg: null };
}

/** The whole scene at `t`: where everyone was (as positions the command map
    draws), the members, the marks made by then, and the K9 trail so far. */
export function replayAt(rp, t) {
  const positions = new Map(), members = new Map();
  let trail = [];
  for (const u of rp.units) {
    members.set(u.uid, { uid: u.uid, role: u.role, callSign: u.callSign, name: u.name, dog: u.dog, joinedAt: 0 });
    const p = placeAt(u.pts, t);
    if (p) positions.set(u.uid, { uid: u.uid, acc: null, ...p });
    if (u.uid === rp.inc.k9Uid) {
      trail = u.pts.filter(q => q.t <= t);
      if (p && trail.length && p.at === t && t > trail[trail.length - 1].t) trail = [...trail, { lat: p.lat, lon: p.lon, t }];
    }
  }
  return { positions, members, marks: rp.marks.filter(m => m.at <= t), trail };
}

/* ── A pretend incident ─────────────────────────────────────────────────
   For the demo, on this device only, on top of the pretend squad
   (squad.js createSim). The K9 team goes to the last known point and works
   a trail from it: a wandering line that overshoots a turn, where the dog
   loses the scent, casts about and picks it up again, and ends where the
   person is. The team calls lost it, re-found and the final indication as a
   handler would. Once the way the trail is heading is plain, the sergeant
   sets a perimeter round the ground ahead and a rally point behind, the cars
   go to roadblocks on it, and a foot officer reports a sighting. Everyone's
   movements are kept for the replay, as the real phones would send them. */

/** The pretend scent line from `lkp`: points about 12 m apart. */
export function scentPath({ lkp, seed = 3, lengthM = 650 }) {
  const r = rng(seed);
  let hdg = r() * 360;
  const pts = [{ lat: lkp.lat, lon: lkp.lon }];
  let walked = 0, here = lkp;
  const step = () => { here = project(here, hdg, 12); pts.push(here); walked += 12; };
  const turnAt = lengthM * (0.35 + r() * 0.1);
  let lostAt = -1, refoundAt = -1;
  while (walked < lengthM) {
    if (lostAt < 0 && walked >= turnAt) {
      /* The person turned; the dog carries on past the turn, loses it,
         swings round in a loop and comes back to where it turned. */
      const turnPt = here;
      const turnIdx = pts.length - 1;
      const over = hdg;
      for (let i = 0; i < 4; i++) { here = project(here, over, 12); pts.push(here); }
      lostAt = pts.length - 1;
      for (let a = 60; a <= 300; a += 60) { pts.push(project(here, over + a, 14)); }
      pts.push(turnPt);
      refoundAt = pts.length - 1;
      here = turnPt;
      walked = pathLen(pts.slice(0, turnIdx + 1));
      hdg = (over + (r() < 0.5 ? -70 : 70) + 360) % 360;
      step();
      continue;
    }
    hdg = (hdg + (r() - 0.5) * 40 + 360) % 360;
    step();
  }
  return { pts, lostAt, refoundAt };
}

/** A ring of `n` points round `c`, `m` metres out: a perimeter. */
export const ring = (c, m, n = 10) => {
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push(project(c, (360 / n) * i, m));
  return pts;
};

const SIM_MARKS_BY = { sgt: 'sim-7', carA: 'sim-3', carB: 'sim-4', footA: 'sim-5', footB: 'sim-6', k9b: 'sim-2' };

/** A pretend incident on the pretend squad `sim`, starting at `now`. */
export function createSimIncident({ sim, lkp, k9Uid = 'sim-1', name = 'Missing person', now, seed = 3, by = 'you' }) {
  const inc = { ...cleanIncident(incidentDoc({ name, lkp, k9Uid, uid: by, now }), `sim-${now}`) };
  const scent = scentPath({ lkp, seed });
  const marks = new Map();
  const tracks = new Map();   // uid → [{ lat, lon, t }]
  const done = new Set();     // script steps already played
  let markN = 0;
  let phase = 'responding';
  let posts = null;

  const add = (m) => { const id = `m${++markN}`; marks.set(id, { id, label: null, ...m }); return id; };
  const k9 = () => sim.unit(k9Uid);
  /* A team far off would walk for minutes before anything happened while
     the chief watched; it starts a short walk from the point instead, as a
     team called to it would be by the time the map mattered. */
  const u0 = k9();
  if (u0 && dist(u0, lkp) > 80) sim.place?.(k9Uid, project(lkp, bearing(lkp, u0), 60));
  sim.goTo(k9Uid, lkp);

  function record(t) {
    for (const u of sim.units) {
      if (!u.report) continue;
      const line = tracks.get(u.uid) || [];
      const last = line[line.length - 1];
      if (!last || u.report.at > last.t) { line.push({ lat: u.report.lat, lon: u.report.lon, t: u.report.at }); tracks.set(u.uid, line); }
    }
    /* The trail is the K9 team's own line: where the handler actually is,
       every step, as the run screen records it, not only each report. */
    if (phase !== 'responding') {
      const u = k9();
      const tr = si.trail;
      if (u && (!tr.length || dist(tr[tr.length - 1], u) >= 3)) tr.push({ lat: u.lat, lon: u.lon, t });
    }
  }

  function script(t) {
    const u = k9();
    if (!u) return;
    if (phase === 'responding' && dist(u, lkp) < 8) {
      phase = 'trailing';
      si.trailStart = t;
      sim.follow(k9Uid, scent.pts);
      return;
    }
    if (phase !== 'trailing') return;
    const at = sim.pathAt(k9Uid);
    const once = (key, fn) => { if (!done.has(key)) { done.add(key); fn(); } };
    if (at > scent.lostAt && scent.lostAt > 0) {
      once('lost', () => add({ kind: 'lost', by: k9Uid, at: t, lat: scent.pts[scent.lostAt].lat, lon: scent.pts[scent.lostAt].lon }));
    }
    if (at > scent.refoundAt && scent.refoundAt > 0) {
      once('refound', () => add({ kind: 'refound', by: k9Uid, at: t, lat: u.lat, lon: u.lon }));
    }
    /* Once the trail has picked up again and settled on a heading, the
       ground ahead is plain enough to set a perimeter round. */
    if (at > scent.refoundAt + 4 && scent.refoundAt > 0) {
      once('perimeter', () => {
        const ahead = scent.pts.slice(at);
        const end = scent.pts[scent.pts.length - 1];
        const mid = { lat: (u.lat + end.lat) / 2, lon: (u.lon + end.lon) / 2 };
        const radius = Math.max(...ahead.map(p => dist(mid, p)), 80) + 90;
        const line = ring(mid, radius, 12);
        add({ kind: 'perimeter', by: SIM_MARKS_BY.sgt, at: t, pts: line, label: 'Inner perimeter' });
        const dir = bearing(u, end);
        posts = {
          carA: project(mid, dir - 70, radius),
          carB: project(mid, dir + 70, radius),
          footA: project(mid, dir, radius),
          rally: project(lkp, (dir + 180) % 360, 60),
        };
        add({ kind: 'rally', by: SIM_MARKS_BY.sgt, at: t, lat: posts.rally.lat, lon: posts.rally.lon, label: null });
        sim.goTo(SIM_MARKS_BY.carA, posts.carA);
        sim.goTo(SIM_MARKS_BY.carB, posts.carB);
        sim.goTo(SIM_MARKS_BY.footA, posts.footA);
        sim.goTo(SIM_MARKS_BY.k9b, posts.rally);
        sim.goTo(SIM_MARKS_BY.footB, project(end, dir + 100, 70));
      });
    }
    if (posts) {
      for (const key of ['carA', 'carB']) {
        const car = sim.unit(SIM_MARKS_BY[key]);
        if (car && dist(car, posts[key]) < 10) once(`rb-${key}`, () => add({ kind: 'roadblock', by: car.uid, at: t, lat: car.lat, lon: car.lon }));
      }
    }
    if (at >= Math.floor(scent.pts.length * 0.8)) {
      const seen = project(scent.pts[scent.pts.length - 1], 30, 25);
      once('sighting', () => add({ kind: 'sighting', by: SIM_MARKS_BY.footB, at: t, lat: seen.lat, lon: seen.lon,
                                   label: 'Person seen on foot' }));
    }
    if (at >= scent.pts.length - 1 && dist(u, scent.pts[scent.pts.length - 1]) < 7) {
      once('found', () => { add({ kind: 'indication', by: k9Uid, at: t, lat: u.lat, lon: u.lon, label: 'Person found' }); phase = 'found'; });
    }
  }

  const si = {
    inc, scent, marks, tracks, trail: [], trailStart: 0,
    get phase() { return phase; },
    /** Play the incident on to the pretend squad's clock. */
    step(t) {
      if (inc.status !== 'active') return si;
      record(t);
      script(t);
      return si;
    },
    /** A mark the person at the screen drew (as Command). */
    addMark(m) { return add(m); },
    removeMark(id) { marks.delete(id); },
    end(t) {
      if (inc.status !== 'active') return si;
      record(t);
      inc.status = 'ended';
      inc.endedAt = t;
      inc.summary = summarise({ inc, trail: si.trail, marks, units: tracks.size, now: t });
      return si;
    },
    /** Everything the replay needs, as the cloud would hand it back. */
    replay(members) {
      const lines = new Map();
      for (const [uid, pts] of tracks) {
        lines.set(uid, { uid, callSign: '', role: '', pts: uid === k9Uid ? mergeTrail(pts, si.trail) : pts.slice() });
      }
      return buildReplay({ inc, tracks: lines, marks, members });
    },
  };
  return si;
}

/* The K9 team's fine trail and its five-second reports, as one line. */
const mergeTrail = (reports, trail) => [...reports, ...trail].sort((a, b) => a.t - b.t)
  .filter((p, i, a) => i === 0 || p.t > a[i - 1].t);
