/* ── The dog's own GPS track ──────────────────────────────────────────
   The phone records the handler, a line-length behind the dog, and the app
   grades an estimate of where the dog was (geo.js lineCorrect). A GPS collar
   records the dog itself. Garmin's dog systems (Alpha, Astro) export it from
   Garmin Explore as a GPX file, usually with the handheld's own walk and
   every dog's collar as separate, named tracks in the one file. The handler
   picks the dog's (share.js gpxTracks), and it is cut to the run's own
   clock, thinned and kept on the session (data.dogTrack, data.dogTrackFrom).
   From then on the run is measured on it rather than on the estimate.

   Pure: no screen, no store, no clock of its own. */

import { dist, simplify } from './geo.js';
import { approxBytes, toCloud, DOC_LIMIT } from './sync-core.js';

/** No more points than this are kept: a collar logging every second for an
    hour is 3600, and a session document has a megabyte for everything. */
export const DOG_TRACK_MAX_POINTS = 3000;
/** How far either side of the dog's track a moment is still read as where
    the dog was (dogAt): Found is often tapped a moment after the find, and a
    collar's clock and the phone's rarely agree to the second. Only for
    looking a moment up: the track itself is kept to the run's own clock, so
    the walk from the car before Start is never graded as part of the run. */
export const DOG_TRACK_SLACK_MS = 60e3;
/** A dog's track that starts further than this from the run's start is
    asked about: the dog is a line ahead, not a field away. */
export const DOG_START_NEAR_M = 100;
/** A dog's track covering less of the run's time than this is asked about. */
export const DOG_PART_SHARE = 0.5;
/** A collar's GPS is good to a few metres in the open, worse under trees,
    and its GPX carries no accuracy of its own. It is held to the phone's
    own standard (app.js computeResult reads 5 m or better as readable):
    a stricter figure graded every dog working close to the line as "can't
    read which side", and took those runs out of its drift learning. */
export const DOG_GPS_ACC_M = 5;
/** On the dog's own track a side is not read when the dog's median distance
    from the line is under this: the same dead band in which a single fix is
    given no side (sideShares, deadM), so a dog that mostly sat inside it
    has no side to read. */
export const DOG_NOISE_FLOOR_M = 3;
/** Share of a track's timed points that may run backwards (a segment join
    that overlaps by a second or two) before its clock is not trusted. */
const BACK_SHARE = 0.05;
/** Bytes kept free in the session's document beside the dog's track: marks,
    a debrief, contamination or the laid line come after it. */
const DOC_HEADROOM = 100_000;
/** However tight the thinning, the dog's position is kept at least this
    often: thinned by shape alone, a dog standing at a hedge for a minute
    becomes one point, and where it was at each moment of the replay is lost. */
const MAX_GAP_MS = 15e3;

const fin = Number.isFinite;
const T_MIN = Date.UTC(2000, 0, 1), T_MAX = Date.UTC(2100, 0, 1);
const inEra = (ms) => fin(ms) && ms >= T_MIN && ms <= T_MAX;
const okPt = (p) => !!p && typeof p === 'object' && fin(p.lat) && fin(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180;
const plain = (msg) => Object.assign(new Error(msg), { plain: true });

/** The run's own clock: { from, to }, from trackStarted (or its first
    timed fix) to its last timed fix. Null when the run has none. */
export function runWindow(data) {
  const tr = Array.isArray(data?.track) ? data.track : [];
  let from = fin(data?.trackStarted) ? data.trackStarted : null;
  if (from === null) for (const p of tr) if (fin(p?.t)) { from = p.t; break; }
  let to = null;
  for (let i = tr.length - 1; i >= 0; i--) if (fin(tr[i]?.t)) { to = tr[i].t; break; }
  if (from === null || to === null || to < from) return null;
  return { from, to };
}

/** At most `max` points, the line's shape kept and its clock with it: the
    first, the last, every bend worth a metre or more, and one at least
    every fifteen seconds. Ever looser until it fits, then every so many. */
export function thinDogTrack(pts, max = DOG_TRACK_MAX_POINTS) {
  if (pts.length <= max) return pts.slice();
  let out = pts;
  for (let tol = 1; tol <= 64; tol *= 2) {
    const shape = new Set(simplify(pts, tol));
    out = [];
    let lastT = -Infinity;
    pts.forEach((p, i) => {
      if (shape.has(p) || i === pts.length - 1 || p.t - lastT >= MAX_GAP_MS) { out.push(p); lastT = p.t; }
    });
    if (out.length <= max) return out;
  }
  const step = Math.ceil(out.length / (max - 1));
  return out.filter((_, i) => i % step === 0 || i === out.length - 1);
}

/** A track picked from a GPX file (share.js gpxTracks), made the dog's for
    this run. `data` is the session's data. Returns { points, ask, cut,
    share, startM }: `points` the dog's track cut to the run's clock and
    thinned, `ask` the questions to put before it goes on, `cut` whether
    some of the file was outside the run. Throws a plain message when it
    cannot be used at all. `fmtM` says a distance in the handler's units. */
export function dogTrackCheck(data, picked, { fmtM = (m) => `${Math.round(m)} m` } = {}) {
  const all = Array.isArray(picked?.points) ? picked.points.filter(okPt) : [];
  if (all.length < 2) throw plain('That track has fewer than two points, so there is nothing to use.');
  const pts = timedLine(all);
  const win = runWindow(data);
  if (!win) throw plain('This run has no recorded times to line the dog’s track up with.');
  const inside = clipTo(pts, win.from, win.to);
  if (inside.length < 2) {
    /* The usual reasons, in the order they happen: another day's file, the
       handheld's track picked instead of the dog's, a clock out by an hour. */
    throw plain(pts[pts.length - 1].t < win.from || pts[0].t > win.to
      ? 'That track was not recorded during this run, so it was not added. Check it is the right file and the right day, and that the collar’s clock is right.'
      : 'That track has almost nothing recorded during this run, so it was not added. Check it is the dog’s track and not the handheld’s.');
  }
  const points = thinDogTrack(inside).map(p => ({
    lat: p.lat, lon: p.lon, t: p.t,
    ...(fin(p.ele) ? { alt: Math.round(p.ele * 10) / 10 } : fin(p.alt) ? { alt: p.alt } : {}),
  }));
  const run0 = Array.isArray(data.track) ? data.track.find(okPt) : null;
  const startM = run0 ? dist(run0, points[0]) : null;
  const span = win.to - win.from;
  const share = span > 0 ? Math.max(0, Math.min(1, (Math.min(win.to, points[points.length - 1].t) - Math.max(win.from, points[0].t)) / span)) : 1;
  const ask = [];
  if (startM !== null && startM > DOG_START_NEAR_M) {
    ask.push(`The dog’s track starts ${fmtM(startM)} from where the run started. Use it anyway?`);
  }
  if (share < DOG_PART_SHARE) {
    ask.push(`The dog’s track covers only ${Math.round(share * 100)} % of the run. Use it anyway?`);
  }
  return { points, ask, cut: pts[0].t < win.from || pts[pts.length - 1].t > win.to, share, startM };
}

/** A track's timed points in time order, or a thrown plain message. A
    point or two without a time (a collar's first fix often has none) is
    left out, as is a point stepping back a second where two segments join;
    only a track with no times to speak of, or a clock that keeps running
    backwards, is refused. Exported for the picker (share.js gpxTracks). */
export function timedLine(pts) {
  const timed = (Array.isArray(pts) ? pts : []).filter(p => inEra(p?.t));
  if (timed.length < 2) throw plain('That track has no times in it. A dog’s track without times cannot be lined up with the run.');
  const out = [];
  for (const p of timed) if (!out.length || p.t >= out[out.length - 1].t) out.push(p);
  if (timed.length - out.length > timed.length * BACK_SHARE) {
    throw plain('That track’s times jump backwards, so it cannot be lined up with the run. Check the collar’s clock.');
  }
  return out;
}

/** The part of a timed track from `from` to `to`, with a point put where
    the track crosses each end, so the dog's position at Start and at the
    end is kept even when its fixes fall either side of them. */
function clipTo(pts, from, to) {
  const out = pts.filter(p => p.t >= from && p.t <= to);
  const a = pts[0].t < from ? dogAt(pts, from, 0) : null;
  if (a && (!out.length || out[0].t > from)) out.unshift(a);
  const z = pts[pts.length - 1].t > to ? dogAt(pts, to, 0) : null;
  if (z && (!out.length || out[out.length - 1].t < to)) out.push(z);
  return out;
}

/** What a dog's track puts on the session's data. `name` is the track's
    own name in the file, or the file's. */
export function dogTrackPatch(points, name, now) {
  return {
    dogTrack: points,
    dogTrackFrom: { name: String(name ?? '').trim().slice(0, 80), points: points.length, importedAt: now },
  };
}

/** The dog's track thinned further, if it must be, so the session it goes
    on still syncs as one document (sync-core.js DOC_LIMIT): a three-hour
    trail and run already fill most of it. Null when even a few hundred
    points will not fit. `session` is the session, with or without the dog's
    track. `lineToCome` is for a blind trail whose laid line is still to be
    added: room is kept for one as long as the run's own track, as the
    laid line seldom is much longer. Called again whenever the session
    grows (app.js refitDogTrack), so a line or marks added later thin the
    dog's track rather than stop the run syncing. */
export function fitDogTrack(session, points, { lineToCome = false } = {}) {
  const data = session?.data || {};
  const base = approxBytes(toCloud({ ...session, data: { ...data, dogTrack: null, dogTrackFrom: null } }))
    + (lineToCome && Array.isArray(data.track) ? approxBytes(toCloud(data.track)) : 0);
  const perPoint = approxBytes(toCloud(points)) / Math.max(1, points.length);
  /* Room for the note beside it, and what comes after it (DOC_HEADROOM). */
  const room = Math.floor((DOC_LIMIT - base - DOC_HEADROOM) / Math.max(1, perPoint));
  if (room >= points.length) return points;
  if (room < 200) return null;
  return thinDogTrack(points, room);
}

/** What taking it off puts on the session's data. Null rather than gone, so
    the change travels to the other phones as one (sync-core.js mergeOne). */
export const DOG_TRACK_GONE = Object.freeze({ dogTrack: null, dogTrackFrom: null });

/** The dog's own track on a run, when there is one the grade can use: two
    real places or more, every one timed and in order. Otherwise null. */
export function dogTrackOf(data) {
  const pts = data?.dogTrack;
  if (!Array.isArray(pts) || pts.length < 2) return null;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (!okPt(p) || !fin(p.t) || (i && p.t < pts[i - 1].t)) return null;
  }
  return pts;
}

/** Where the dog was at `t`, along its own track, or null when the track
    does not reach that moment (allowing the slack it was cut with). */
export function dogAt(pts, t, slack = DOG_TRACK_SLACK_MS) {
  if (!Array.isArray(pts) || pts.length < 1 || !fin(t)) return null;
  const a = pts[0], z = pts[pts.length - 1];
  if (t < a.t - slack || t > z.t + slack) return null;
  if (t <= a.t) return { lat: a.lat, lon: a.lon, t };
  if (t >= z.t) return { lat: z.lat, lon: z.lon, t };
  let lo = 0, hi = pts.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (pts[mid].t <= t) lo = mid; else hi = mid;
  }
  const p = pts[lo], q = pts[hi];
  const f = q.t > p.t ? (t - p.t) / (q.t - p.t) : 0;
  return { lat: p.lat + (q.lat - p.lat) * f, lon: p.lon + (q.lon - p.lon) * f, t };
}

/** The dog's track as far as it had got at `t`, for the replay. Nothing
    before its first fix: a collar switched on after Start has no place for
    the dog yet, and its next fix is still in the future. */
export function dogTrackUntil(pts, t) {
  let i = 0;
  while (i < pts.length && pts[i].t <= t) i++;
  return i === 0 ? [] : pts.slice(0, Math.max(2, i));
}

/** A dog's track from a backup or another phone, made safe to keep, on
    `data` in place: one that is not a usable timed line goes, with its
    note, rather than standing as a track the grade cannot read; one longer
    than the app would ever write is thinned; the note is rebuilt from the
    track. Points that are not places are for the caller to refuse. */
export function cleanDogTrack(data) {
  if (!data || typeof data !== 'object') return data;
  if (data.dogTrack == null && data.dogTrackFrom == null) return data;
  const pts = dogTrackOf(data);
  if (!pts) {
    if ('dogTrack' in data) data.dogTrack = null;
    if ('dogTrackFrom' in data) data.dogTrackFrom = null;
    return data;
  }
  const kept = thinDogTrack(pts).map(p => ({ lat: p.lat, lon: p.lon, t: p.t, ...(fin(p.alt) ? { alt: p.alt } : {}) }));
  const was = data.dogTrackFrom && typeof data.dogTrackFrom === 'object' && !Array.isArray(data.dogTrackFrom) ? data.dogTrackFrom : {};
  data.dogTrack = kept;
  data.dogTrackFrom = {
    name: typeof was.name === 'string' ? was.name.slice(0, 80) : '',
    points: kept.length,
    importedAt: inEra(was.importedAt) ? was.importedAt : kept[kept.length - 1].t,
  };
  return data;
}
