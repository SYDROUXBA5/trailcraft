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

import { dist, bearing, project, pathLen, fmtDist, crossTrackSigned } from './geo.js';
import { blockStep, outside } from './walls.js';
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
export function incidentDoc({ name, lkp, k9Uid, uid, now, lastSeenAt = null, pace = null, brief = null }) {
  return {
    name: cleanIncidentName(name) || 'Incident',
    lkp: placeOf(lkp),
    k9Uid: typeof k9Uid === 'string' && k9Uid ? k9Uid : null,
    startedBy: uid, startedAt: now, endedAt: null, status: 'active', summary: null,
    lastSeenAt: cleanLastSeen(lastSeenAt, now), pace: cleanPace(pace), brief: cleanBrief(brief),
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
    lastSeenAt: cleanLastSeen(d.lastSeenAt, d.startedAt),
    pace: cleanPace(d.pace),
    brief: cleanBrief(d.brief),
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
  /* Taken back: kept, crossed out in the log, off the map. Both halves or neither. */
  const off = typeof d.withdrawnBy === 'string' && d.withdrawnBy && finite(d.withdrawnAt)
    ? { withdrawnBy: d.withdrawnBy, withdrawnAt: d.withdrawnAt } : {};
  if (MARKS[d.kind].line) {
    const pts = Array.isArray(d.pts) ? d.pts.slice(0, LINE_MAX).filter(isPlace).map(p => ({ lat: p.lat, lon: p.lon })) : [];
    return pts.length >= 2 ? { id, kind: d.kind, by, at: d.at, pts, label, ...off } : null;
  }
  if (!isPlace(d)) return null;
  return { id, kind: d.kind, by, at: d.at, lat: d.lat, lon: d.lon, label, ...off };
}

/** Whether `uid` may put a mark of this kind on this incident: the scent
    calls are the trailing team's alone (as the rules say). */
export const mayMark = (inc, uid, kind) => !!inc && inc.status === 'active' && MARK_KINDS.includes(kind)
  && (!K9_MARKS.includes(kind) || inc.k9Uid === uid);
/** Whether `uid` may take a mark back: their own, or anyone's if Command,
    and only once (a withdrawn mark stays withdrawn). */
export const mayUnmark = (mark, uid, command) => !!mark && !finite(mark.withdrawnAt) && (mark.by === uid || !!command);
/** Whether a mark still stands at `t`: made by then and not yet withdrawn. */
export const standing = (m, t = Infinity) => m.at <= t && !(finite(m.withdrawnAt) && m.withdrawnAt <= t);
/** The marks still standing at `t`: what the map draws. */
export const standingOf = (marks, t = Infinity) => [...(marks?.values?.() ?? [])].filter(m => standing(m, t));

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
/** A distance in the handler's own units (Settings → distances): the same
    one switch the run screen reads, so a chief set to miles never sees
    metres on one screen and yards on the next. */
export const metresWords = (m, imperial = false) =>
  (imperial ? fmtDist(m, true) : m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);

/* ── Words for the command screen ───────────────────────────────────────
   Short, so they read on a phone strip, out loud, and across a room. */

/** What the command screen says when the K9 team calls: "K9-1, lost it". */
export function callWords(kind, callSign) {
  const said = { indication: 'indication', lost: 'lost it', refound: 're-found' }[kind];
  return said ? `${callSign || 'K9 team'}, ${said}` : '';
}

/** The phone's one-line incident strip:
    "K9-1 Rex · heading E · Re-found 1 min ago · 10 min since seen". The
    time is the card's clock: from last seen when Command said, else from
    the opening. `warn` is the perimeter warning, kept short with its
    "rough guide", since the strip is all a folded phone shows. */
export function stripWords({ k9, info, call, now, seenMs = null, warn = '' }) {
  const bits = [k9 ? `${k9.callSign}${k9.dog ? ` ${k9.dog}` : ''}` : 'No K9 team'];
  if (info?.heading != null) bits.push(`heading ${info.compass}`);
  else if (!info?.lengthM) bits.push('on the way');
  if (call) bits.push(`${MARKS[call.kind].label} ${elapsedWords(Math.max(0, now - call.at))} ago`);
  if (warn) bits.push(`${warn.replace(/^Perimeter now inside/, 'Inside')} (rough guide)`);
  bits.push(finite(seenMs) ? `${elapsedWords(Math.max(0, seenMs))} since seen` : elapsedWords(info?.elapsedMs ?? 0));
  return bits.join(' · ');
}

/** A line for each unit on the incident gone grey: the app has stopped
    hearing from it, which is a reason to call it, not a reason to worry. */
export function quietLines(rows, now) {
  return (rows || []).filter(r => r.pos && r.fresh === 'stale')
    .map(r => `${r.callSign}: no update from the app for ${Math.max(2, Math.floor((now - r.pos.at) / 60e3))} min, check by radio`);
}

/* ── Following the K9 team on the command map ───────────────────────────
   The map keeps the team, the last known point and any perimeter in view on
   its own, until someone moves it by hand; then it leaves them be. */

/** What following keeps in view: the team, the point, the perimeter lines. */
export function followPoints({ inc, marks, k9 }) {
  if (!inc) return [];
  const pts = [inc.lkp];
  if (k9) pts.push({ lat: k9.lat, lon: k9.lon });
  for (const mk of marks || []) if (MARKS[mk.kind]?.line && mk.pts) pts.push(...mk.pts);
  return pts;
}

/** Whether every point (in screen pixels) is inside the part of the map not
    covered by the panel: `pad` is how much each edge has under it. */
export function allInView(screenPts, size, pad) {
  return screenPts.every(p => p.x >= pad.left && p.x <= size.w - pad.right && p.y >= pad.top && p.y <= size.h - pad.bottom);
}

/* ── Last seen, and how far the person could be by now ─────────────────
   Command says when the person was last seen and how they left. From the
   last known point a ring grows at that pace: the ground they could have
   covered, which is a rough guide to how big the perimeter must be, not
   where the person is. The paces are a guess anyone may change on their own
   device; they never move or shrink a perimeter. */
export const PACES = {
  walk: { label: 'Walking', kmh: 5, min: 1, max: 10, range: 'walking range' },
  run: { label: 'Running', kmh: 10, min: 3, max: 25, range: 'running range' },
  vehicle: { label: 'Vehicle', kmh: 40, min: 5, max: 130, range: 'driving range' },
};
export const PACE_KEYS = ['walk', 'run', 'vehicle'];
export const DIR_MAX = 40;      // the brief's direction of travel (the rules say the same)
export const DESC_MAX = 160;    // the brief's description (likewise)
/* Last seen at most two days before the incident opened: older than that,
   a ring from the clock means nothing. */
export const SEEN_BACK_MS = 48 * 3600e3;
/* A ring past this is no use on a town map, and would draw half a county. */
export const REACH_CAP_M = 30000;

export const cleanPace = (v) => (PACE_KEYS.includes(v) ? v : null);
/** When the person was last seen, kept between two days before the
    incident opened and the moment it opened; null when not said. */
export function cleanLastSeen(v, startedAt) {
  if (!finite(v) || !finite(startedAt)) return null;
  return Math.round(Math.min(startedAt, Math.max(startedAt - SEEN_BACK_MS, v)));
}
/** The handler's brief: the way the person went, what they look like, and
    whether there is a scent article. Null when there is nothing in it. */
export function cleanBrief(b) {
  if (!b || typeof b !== 'object') return null;
  const dir = tidy(b.dir, DIR_MAX), desc = tidy(b.desc, DESC_MAX);
  const article = b.article === true || b.article === false ? b.article : null;
  return dir || desc || article != null ? { dir, desc, article } : null;
}
/** This device's paces, km/h, each kept to a sensible span. */
export function cleanPaces(p) {
  const out = {};
  for (const k of PACE_KEYS) {
    const v = Number(p?.[k]);
    out[k] = Number.isFinite(v) && v > 0 ? Math.min(PACES[k].max, Math.max(PACES[k].min, Math.round(v * 10) / 10)) : PACES[k].kmh;
  }
  return out;
}
/** When the clock starts: last seen if Command said, else the incident's opening. */
export const seenAt = (inc) => (finite(inc?.lastSeenAt) ? inc.lastSeenAt : inc?.startedAt ?? 0);

/* A typed time up to this far ahead of now is a slip (a fast phone, a
   typo), not yesterday: the form says so rather than draw a day-long ring. */
export const AHEAD_MS = 12 * 3600e3;
/** "13:52" typed in the form, as the last time it was that o'clock up to
    `now` (a time well ahead of now, "23:50" at 14:20, is yesterday's). Null
    when it is not a time; NaN when it is later than now today, so the form
    can say "That time is after now". */
export function lastSeenFrom(hhmm, now) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm ?? '').trim());
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  const d = new Date(now);
  d.setHours(Number(m[1]), Number(m[2]), 0, 0);
  let t = d.getTime();
  if (t > now + 60e3) {
    if (t - now <= AHEAD_MS) return NaN;
    t -= 864e5;
  }
  return t;
}
const two = (v) => String(v).padStart(2, '0');
/** "14:04", the time of day a log line happened. */
export function hhmm(t) {
  const d = new Date(t);
  return `${two(d.getHours())}:${two(d.getMinutes())}`;
}

/** How far someone can go in `ms` at `kmh`, capped. */
export const reachM = (ms, kmh) => Math.min(REACH_CAP_M, (Math.max(0, ms) / 3600e3) * kmh * 1000);

/** The rings at `now`: the main one at the pace Command chose (walking when
    not said), and, for someone walking, a wider one for if they ran. */
export function reachRings({ inc, now, paces }) {
  if (!inc?.lkp) return null;
  const p = cleanPaces(paces);
  const pace = inc.pace || 'walk';
  /* A replay's moment, or now; never past the end. */
  const sinceMs = Math.max(0, Math.min(now, inc.endedAt ?? Infinity) - seenAt(inc));
  return {
    sinceMs, pace,
    main: { pace, kmh: p[pace], m: reachM(sinceMs, p[pace]) },
    wide: pace === 'walk' ? { pace: 'run', kmh: p.run, m: reachM(sinceMs, p.run) } : null,
  };
}

/** How near a drawn line comes to `c`, in metres. */
export function nearM(c, pts) {
  if (!pts?.length) return Infinity;
  if (pts.length === 1) return dist(c, pts[0]);
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) best = Math.min(best, crossTrackSigned(pts[i - 1], pts[i], c).off);
  return best;
}

/* A drawn line counts as a closed ring when its ends meet: within 30 m, or
   within a seventh of its length for a big ring drawn by hand on a phone. */
const CLOSE_M = 30;
export function isClosed(pts) {
  if (!pts || pts.length < 4) return false;
  return dist(pts[0], pts[pts.length - 1]) <= Math.max(CLOSE_M, pathLen(pts) / 7);
}
/** Whether `c` is inside the ring `pts` (a ray cast on longitude/latitude,
    near enough over a town). */
export function insideLine(c, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.lat > c.lat) !== (b.lat > c.lat) && c.lon < ((b.lon - a.lon) * (c.lat - a.lat)) / (b.lat - a.lat) + a.lon) inside = !inside;
  }
  return inside;
}

/** The perimeter lines the main ring has grown past: somewhere along them,
    the person could already be on the far side. A closed ring that does not
    go round the last known point (the inner ring a sergeant draws ahead of
    the dog, once the trail has a direction) holds nothing back from that
    point, so the ring growing past it says nothing: it is left out. An open
    line (a cordon across a road) is judged by how near it comes. */
export function passedLines({ inc, marks, reach }) {
  if (!inc?.lkp || !reach) return [];
  return (marks || []).filter(m => MARKS[m.kind]?.line && m.pts?.length >= 2
    && (!isClosed(m.pts) || insideLine(inc.lkp, m.pts))
    && reach.main.m > nearM(inc.lkp, m.pts)).map(m => m.id);
}
export const warnWords = (pace) => `Perimeter now inside ${PACES[pace]?.range || 'walking range'}`;

/** A speed in the handler's own units: "5 km/h" or "3 mph". */
export const speedWords = (kmh, imperial = false) =>
  (imperial ? `${Math.round(kmh / 1.609344)} mph` : `${Math.round(kmh * 10) / 10} km/h`);

/** "Rough guide, not where the person is: walking 5 km/h, about 1.2 km." */
export function reachWords(reach, imperial = false) {
  if (!reach) return '';
  const ring = (r) => `${PACES[r.pace].label.toLowerCase()} ${speedWords(r.kmh, imperial)}, about ${metresWords(r.m, imperial)}`;
  return `Rough guide, not where the person is: ${ring(reach.main)}${reach.wide ? `; ${ring(reach.wide)} (dashed)` : ''}`;
}

/* When the team's track first comes within this of the last known point.
   It says where the team was, not what the dog did: in the cloud the track
   also holds the duty fixes sent while the handler drove or walked in, so a
   handler parked beside the point is "at" it minutes before Start trailing.
   The words say so ("at the last known point", "about"). 40 m allows for
   GPS in town and a point dropped roughly on the map. */
export const ON_SCENT_M = 40;
/** The first point of the team's track at the last known point, or null. */
export function scentStart(trail, lkp) {
  if (!lkp) return null;
  for (const p of trail || []) if (dist(p, lkp) <= ON_SCENT_M) return p;
  return null;
}

/** "Dog at the last known point about 9 min after last seen", or how long
    it has been so far. Counted from the opening when nobody said when the
    person was last seen, and it says so. */
export function onScentWords({ inc, trail, now }) {
  const from = seenAt(inc);
  const since = finite(inc?.lastSeenAt) ? 'last seen' : 'the incident opened';
  const on = scentStart(trail, inc?.lkp);
  if (on && on.t <= now) return `Dog at the last known point about ${elapsedWords(on.t - from)} after ${since}`;
  return `Dog not at the last known point yet · ${elapsedWords(Math.min(now, inc?.endedAt ?? Infinity) - from)} since ${since}`;
}

/** The brief in one line: "Heading N to the park · Grey hoodie · Scent article: yes". */
export function briefWords(brief, pace = null) {
  const bits = [];
  if (pace) bits.push(PACES[pace].label);
  if (brief?.dir) bits.push(`Heading ${brief.dir}`);
  if (brief?.desc) bits.push(brief.desc);
  if (brief?.article != null) bits.push(`Scent article: ${brief.article ? 'yes' : 'no'}`);
  return bits.join(' · ');
}

/* ── The live log ───────────────────────────────────────────────────────
   What happened, in plain words, as it happened, built from the incident,
   the K9 team's trail and the marks: nothing typed, nothing to keep up. A
   withdrawn mark stays, crossed out, with who withdrew it and when. */

/** One line of the log for a mark: "Foot 5 sighting: Person seen on foot". */
function markWords(m, by) {
  const k = MARKS[m.kind];
  const said = { lost: 'lost it', refound: 're-found it' }[m.kind] || k.one || k.label.toLowerCase();
  return `${by} ${said}${m.label ? `: ${m.label}` : ''}`;
}

/** The log up to `now` (a replay's moment, or Infinity), oldest first. Each
    line is { key, t, time, text, at: { lat, lon }, pts (a line's points, for
    a tap to show it whole), withdrawn }. `who(uid)`
    names a member; `team` is the K9 team as the log names it ("K9-1 Rex"). */
export function logLines({ inc, marks, trail, who, team = '', now = Infinity }) {
  if (!inc) return [];
  const name = (uid) => (uid ? who(uid) : 'Command');
  const out = [];
  const push = (key, t, at, text, withdrawn = null, pts = null) =>
    out.push({ key, t, time: hhmm(t), text, at: at ? { lat: at.lat, lon: at.lon } : null, pts, withdrawn });
  if (finite(inc.lastSeenAt) && inc.lastSeenAt < inc.startedAt && inc.lastSeenAt <= now) {
    push('seen', inc.lastSeenAt, inc.lkp, `Last seen${inc.pace ? `, ${PACES[inc.pace].label.toLowerCase()}` : ''}`);
  }
  if (inc.startedAt <= now) push('open', inc.startedAt, inc.lkp, `Incident opened by ${name(inc.startedBy)}`);
  const on = scentStart(trail, inc.lkp);
  if (on && on.t <= now) push('trail', on.t, on, `${team || name(inc.k9Uid)} at the last known point`);
  for (const m of marks?.values?.() ?? []) {
    if (!(m.at <= now)) continue;
    const off = finite(m.withdrawnAt) && m.withdrawnAt <= now ? `withdrawn by ${name(m.withdrawnBy)}, ${hhmm(m.withdrawnAt)}` : null;
    const line = MARKS[m.kind]?.line ? m.pts : null;
    push(`m:${m.id}`, m.at, line ? line[0] : m, markWords(m, name(m.by)), off, line);
  }
  if (finite(inc.endedAt) && inc.endedAt <= now) push('end', inc.endedAt, null, 'Incident ended');
  const rank = { seen: 0, open: 1, trail: 2, end: 9 };
  return out.sort((a, b) => a.t - b.t || (rank[a.key] ?? 5) - (rank[b.key] ?? 5));
}

/** What is kept on the incident when it ends, for the list of past ones. */
export function summarise({ inc, trail, marks, units, now }) {
  return {
    durationMs: Math.max(0, now - inc.startedAt),
    k9M: Math.round(pathLen(trail || [])),
    marks: standingOf(marks).length,
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
  /* The map shows what stood at that moment; the log, everything said by
     then, a withdrawn mark crossed out from the moment it was withdrawn. */
  return { positions, members, marks: standingOf(rp.marks, t), said: rp.marks.filter(m => m.at <= t), trail };
}

/* ── A pretend incident ─────────────────────────────────────────────────
   For the demo, on this device only, on top of the pretend squad
   (squad.js createSim). Two halves, kept apart on purpose:

   - The world. Where the pretend person walked (the hidden scent line) and
     where they are now. Only what could really sense the person reads it:
     the pretend dog's nose (the team works the line, overshoots a turn,
     loses it, casts and picks it up again), the handler's calls on what the
     dog shows, and an officer close enough to see the person.
   - The pretend sergeant. He knows what a real one would: the last known
     point, the K9 team's track and calls as they come in, where his own
     units are, and the clock. He contains wide at once, as doctrine says,
     then tightens round the ground ahead once the trail has settled after a
     re-find, and withdraws the wide line. He never reads the hidden line.

   Walkers, the dog and the person keep out of buildings when the map has
   them (walls.js). Everyone's movements are kept for the replay, as the
   real phones would send them. */

/** The pretend scent line from `lkp`: points about 12 m apart, none of its
    steps through a building when `walls` (walls.js wallIndex) are known. */
export function scentPath({ lkp, seed = 3, lengthM = 650, walls = null }) {
  const r = rng(seed);
  let hdg = r() * 360;
  const first = walls ? outside(walls, lkp) : lkp;
  const pts = [{ lat: first.lat, lon: first.lon }];
  let walked = 0, here = pts[0];
  /* blockStep hands back the very point it was given when nothing is in
     the way. Blocked, the person bears off the way that is open, as anyone
     walking along a street does. No random draw is spent on it, so without
     walls the line is the one it always was for its seed. */
  const clear = (a, b) => !walls || blockStep(walls, a, b) === b;
  const step = () => {
    let next = project(here, hdg, 12);
    if (!clear(here, next)) {
      for (const turn of [30, -30, 60, -60, 90, -90, 135, -135, 180]) {
        const h = (hdg + turn + 360) % 360, q = project(here, h, 12);
        if (clear(here, q)) { hdg = h; next = q; break; }
      }
    }
    here = next; pts.push(here); walked += 12;
  };
  const turnAt = lengthM * (0.35 + r() * 0.1);
  let lostAt = -1, refoundAt = -1;
  while (walked < lengthM) {
    if (lostAt < 0 && walked >= turnAt) {
      /* The person turned; the dog carries on past the turn, loses it,
         swings round in a loop and comes back to where it turned. */
      const turnPt = here;
      const turnIdx = pts.length - 1;
      const over = hdg;
      for (let i = 0; i < 4; i++) {
        const q = project(here, over, 12);
        if (!clear(here, q)) break;
        here = q; pts.push(here);
      }
      lostAt = pts.length - 1;
      const lostPt = here;
      for (let a = 60; a <= 300; a += 60) {
        const q = project(lostPt, over + a, 14);
        if (clear(pts[pts.length - 1], q)) pts.push(q);
      }
      /* Back by the way it came if the loop ended behind a corner. */
      if (!clear(pts[pts.length - 1], turnPt)) pts.push(lostPt);
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
/* The sergeant's numbers. Wide: a ring round the last known point, set a
   short beat after the call so the chief sees it go up. Tight: once the
   team has gone `settleM` past a re-find it called (or `anywayM` of trail
   with no loss at all), a smaller ring centred a little ahead of the team,
   the way its own track is heading. Tried on forty seeds, the tight ring
   held the pretend person about nine times in ten: like a real one, it is
   a judgement, not a certainty. */
export const SGT = { wideAfterMs: 20e3, wideM: 450, tightAheadM: 150, tightM: 250, settleM: 100, anywayM: 600 };
/* How far an officer on a post can pick out a person in a street. */
const SEE_M = 150;

/** A pretend incident on the pretend squad `sim`, starting at `now`. */
export function createSimIncident({ sim, lkp, k9Uid = 'sim-1', name = 'Missing person', now, seed = 3, by = 'you',
                                    lastSeenAt = null, pace = null, brief = null }) {
  const inc = { ...cleanIncident(incidentDoc({ name, lkp, k9Uid, uid: by, now, lastSeenAt, pace, brief }), `sim-${now}`) };
  let walls = sim.walls || null;
  const marks = new Map();
  const tracks = new Map();   // uid → [{ lat, lon, t }]
  const done = new Set();     // script steps already played
  let markN = 0;
  let phase = 'responding';

  const add = (m) => { const id = `m${++markN}`; marks.set(id, { id, label: null, ...m }); return id; };
  /* Taken back as the cloud does it: kept, with who and when, for the log. */
  const withdraw = (id, who, t) => {
    const m = marks.get(id);
    if (m && !finite(m.withdrawnAt)) marks.set(id, { ...m, withdrawnBy: who, withdrawnAt: t });
  };
  const once = (key, fn) => { if (!done.has(key)) { done.add(key); fn(); } };
  const k9 = () => sim.unit(k9Uid);
  /* Open ground near a point: a post or a rally point is never inside a building. */
  const openAt = (p) => (walls ? outside(walls, p) : p);
  const clearLine = (a, b) => !walls || blockStep(walls, a, b) === b;

  /* ── The world's half ── */
  let scent = scentPath({ lkp, seed, walls });
  let start = scent.pts[0];
  let person = scent.pts[scent.pts.length - 1];
  /* The buildings come from the map a few seconds after the pretend squad
     starts. If they arrive while the team is still on its way, the line is
     laid again round them, before the dog has put a nose to it. */
  function rewall() {
    walls = sim.walls;
    scent = scentPath({ lkp, seed, walls });
    start = scent.pts[0];
    person = scent.pts[scent.pts.length - 1];
    const u = k9();
    if (u && dist(u, start) > 15) placeNear(u);
    sim.goTo(k9Uid, start);
  }

  /* A team far off would walk for minutes before anything happened while
     the chief watched; it starts a short walk from the point instead, as a
     team called to it would be by the time the map mattered: from a spot
     with a clear walk in, if a building stands in the way. */
  function placeNear(u) {
    const from = bearing(start, u);
    const far = Math.min(60, dist(u, start));
    let spot = project(start, from, far);
    if (walls) {
      for (const turn of [0, 40, -40, 80, -80, 120, -120, 160, -160]) {
        const q = project(start, from + turn, far);
        if (outside(walls, q) === q && clearLine(q, start)) { spot = q; break; }
      }
    }
    sim.place?.(k9Uid, spot);
  }
  const u0 = k9();
  if (u0 && (dist(u0, start) > 80 || (walls && !clearLine(u0, start)))) placeNear(u0);
  sim.goTo(k9Uid, start);

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

  function world(t) {
    const u = k9();
    if (!u) return;
    if (phase === 'responding' && dist(u, start) < 8) {
      phase = 'trailing';
      si.trailStart = t;
      sim.follow(k9Uid, scent.pts);
      return;
    }
    if (phase !== 'trailing') return;
    const at = sim.pathAt(k9Uid);
    if (at > scent.lostAt && scent.lostAt > 0) {
      once('lost', () => add({ kind: 'lost', by: k9Uid, at: t, lat: scent.pts[scent.lostAt].lat, lon: scent.pts[scent.lostAt].lon }));
    }
    if (at > scent.refoundAt && scent.refoundAt > 0) {
      once('refound', () => add({ kind: 'refound', by: k9Uid, at: t, lat: u.lat, lon: u.lon }));
    }
    /* An officer on a post close enough to see the person says so. */
    if (sgt.posts) {
      for (const key of ['footA', 'footB', 'carA', 'carB']) {
        const o = sim.unit(SIM_MARKS_BY[key]);
        if (!o || dist(o, sgt.posts[key]) > 15 || dist(o, person) > SEE_M) continue;
        const seen = project(person, bearing(person, o), 10);
        once('sighting', () => add({ kind: 'sighting', by: o.uid, at: t, lat: seen.lat, lon: seen.lon, label: 'Person seen on foot' }));
      }
    }
    if (at >= scent.pts.length - 1 && dist(u, person) < 7) {
      once('found', () => { add({ kind: 'indication', by: k9Uid, at: t, lat: u.lat, lon: u.lon, label: 'Person found' }); phase = 'found'; });
    }
  }

  /* ── The sergeant's half: never the hidden line ── */
  const sgt = { stage: 'none', wide: [], posts: null };
  function post(posts) {
    sgt.posts = posts;
    for (const key of ['carA', 'carB', 'footA', 'footB']) sim.goTo(SIM_MARKS_BY[key], posts[key]);
  }
  function sergeant(t) {
    if (sgt.stage === 'none' && t >= now + SGT.wideAfterMs) {
      sgt.stage = 'wide';
      sgt.wide.push(add({ kind: 'perimeter', by: SIM_MARKS_BY.sgt, at: t, pts: ring(lkp, SGT.wideM, 12), label: 'Wide perimeter' }));
      /* Nothing yet says which way the person went: the posts go evenly
         round, and the rally point is on the side Command came in from. */
      const boss = sim.unit(SIM_MARKS_BY.sgt);
      const rally = openAt(project(lkp, boss ? bearing(lkp, boss) : 180, 60));
      add({ kind: 'rally', by: SIM_MARKS_BY.sgt, at: t, lat: rally.lat, lon: rally.lon, label: null });
      sim.goTo(SIM_MARKS_BY.k9b, rally);
      post({
        carA: project(lkp, 45, SGT.wideM), carB: project(lkp, 225, SGT.wideM),
        footA: openAt(project(lkp, 135, SGT.wideM)), footB: openAt(project(lkp, 315, SGT.wideM)),
      });
    }
    if (sgt.stage === 'wide' && phase !== 'responding') {
      /* What a sergeant can see: the re-find the handler called, and the
         track the team has walked since. */
      const re = [...marks.values()].find(m => m.kind === 'refound');
      const info = trailInfo(si.trail, inc, t);
      const since = re ? pathLen(si.trail.filter(p => p.t >= re.at)) : 0;
      const mid = info.heading != null ? project(info.head, info.heading, SGT.tightAheadM) : null;
      const tight = mid ? ring(mid, SGT.tightM, 12) : null;
      /* He waits while the inner ring would still take in the last known
         point: the team is barely clear of it, and a ring round the point
         is the wide one's job. A long trail tightens anyway. */
      const clear = tight && (!insideLine(lkp, tight) || info.lengthM >= SGT.anywayM);
      if (clear && (since >= SGT.settleM || info.lengthM >= SGT.anywayM)) {
        sgt.stage = 'tight';
        for (const id of sgt.wide) withdraw(id, SIM_MARKS_BY.sgt, t);
        sgt.wide = [];
        add({ kind: 'perimeter', by: SIM_MARKS_BY.sgt, at: t, pts: tight, label: 'Inner perimeter' });
        const h = info.heading;
        post({
          carA: project(mid, h - 70, SGT.tightM), carB: project(mid, h + 70, SGT.tightM),
          footA: openAt(project(mid, h, SGT.tightM)), footB: openAt(project(mid, h - 125, SGT.tightM)),
        });
      }
    }
    /* A car at its post calls in a roadblock there. */
    if (sgt.posts) {
      for (const key of ['carA', 'carB']) {
        const car = sim.unit(SIM_MARKS_BY[key]);
        if (!car || dist(car, sgt.posts[key]) >= 10) continue;
        once(`rb-${sgt.stage}-${key}`, () => {
          const id = add({ kind: 'roadblock', by: car.uid, at: t, lat: car.lat, lon: car.lon });
          if (sgt.stage === 'wide') sgt.wide.push(id);
        });
      }
    }
  }

  const si = {
    inc, marks, tracks, trail: [], trailStart: 0,
    get phase() { return phase; },
    /* The hidden line is not on the object anyone draws from: it is handed
       out only for the end-of-scenario "where the pretend person walked". */
    hiddenRoute: () => scent.pts.slice(),
    /** Play the incident on to the pretend squad's clock. */
    step(t) {
      if (inc.status !== 'active') return si;
      if (!walls && sim.walls && phase === 'responding') rewall();
      record(t);
      world(t);
      sergeant(t);
      return si;
    },
    /** A mark the person at the screen drew (as Command). */
    addMark(m) { return add(m); },
    /** Taken back by `who` at `t`: off the map, crossed out in the log. */
    removeMark(id, who = by, t = null) { withdraw(id, who, finite(t) ? t : Date.now()); },
    /** Command corrects when the person was last seen, how they left, the brief. */
    setSeen({ lastSeenAt, pace, brief }) {
      inc.lastSeenAt = cleanLastSeen(lastSeenAt, inc.startedAt);
      inc.pace = cleanPace(pace);
      inc.brief = cleanBrief(brief);
    },
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
