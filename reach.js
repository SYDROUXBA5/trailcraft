/* Scent reach: the ground a dog's nose could have smelled from where it walked.

   The plume asks where scent from the ground goes. This asks the question the other way round: standing where the dog
   stood, which ground is close enough upwind that its scent would still have been in the air when it arrived? Join that
   up along the whole of the dog's track and it is the ground the dog had a chance at, and what is left is ground it
   never had a chance at, however good its nose.

   Nothing here is a rule of its own. The air is the same air the plume drifts in (flowAt, stepByFlow, the share of the
   wind that reaches the nose), scent stays airborne for as long (the airborne dial, shortened by mixing, with the same
   spread of lifetimes) and thins with distance the same way the plume is drawn (parcelWeight in app.js). Only the two
   cut-offs that turn the answer into "likely" and "possible" are chosen rather than taken from the model, and the app
   says so wherever it shows them.

   It is an estimate from a forecast wind, not a measurement, and it knows nothing of walls, hedges or tree cover. */
import { normOf, flowAt, stability } from './field.js';
import { stepByFlow } from './sim.js';
import { dist } from './geo.js';
import { PV } from './params.js';

export const REACH = {
  likely: 0.5,        // at or above this share, the ground is called likely smelled
  possible: 0.2,      // at or above this, possibly. Below it, not counted at all
  thin: 22,           // metres over which scent halves in the plume's own drawing (parcelWeight)
  meanLife: 0.62,     // a parcel's airborne life, as a share of the dial (sim.js RESIDENCE)
  longLife: 1.9,      // the longest any parcel is allowed
  nose: 2.5,          // metres either side of its own track a dog's nose takes in with no wind at all
  widen: 0.08,        // how fast scent spreads sideways as it travels, per metre (a neutral day)
  stride: 2,          // metres between the places along the track the reach is worked out from
  most: 2500,         // never more of those places than this, however long the track
  edge: 0.55,         // the share of a width that is at full strength before it fades to nothing at the rim
  sweep: 6,           // how many places between one stride and the next the reach is also taken from, so its edge is not toothed
};

/** How much of the scent from ground `d` metres upwind, `secs` of drift away, is still there at the nose: 1 at the
    dog's feet, falling to nothing. `air` is the airborne seconds in this air. */
export function reachWeight(secs, d, air) {
  return Math.exp(-secs / (REACH.meanLife * Math.max(1, air))) / (1 + d / REACH.thin);
}

const _f = { u: 0, v: 0 }, _n = { x: 0, y: 0 }, _to = { lat: 0, lon: 0 };

/** From one place the nose was, the ground upwind of it: a chain of points walked back against the air, each with how
    wide the reach is there (r, metres) and how strong (w, 0..1). The first is the dog itself. */
export function reachFrom(T, p, wx, st, out = []) {
  out.length = 0;
  out.push({ lat: p.lat, lon: p.lon, r: REACH.nose, w: 1 });
  if (!wx) return out;
  const mix = Math.max(0.5, st?.mix ?? 1), air = PV.airborne / mix, longest = REACH.longLife * air;
  const wind = wx.wind_speed ?? 0, gusty = Math.max(0, ((wx.wind_gusts ?? wind) - wind) / Math.max(0.5, wind));
  const flat = !T || T.flat;
  let lat = p.lat, lon = p.lon, secs = 0, d = 0, r = REACH.nose;
  for (let k = 0; k < 24; k++) {
    if (flat) flowAt(T, 0.5, 0.5, wx, st, _f); else { normOf(T, lat, lon, _n); flowAt(T, _n.x, _n.y, wx, st, _f); }
    const sp = Math.sqrt(_f.u * _f.u + _f.v * _f.v) * PV.nose;
    if (sp < 0.02) break;                                  // still air carries nothing to the nose from any distance
    /* a step no longer than the reach is wide, so the pieces join up, and no shorter than a second of drift */
    const dt = Math.min(longest - secs, Math.max(1, 1.2 * r / sp));
    if (!(dt > 0)) break;
    /* where scent leaving here would be after dt, then the same step the other way: the ground it came from */
    stepByFlow({ lat, lon }, _f, dt, PV.nose, _to);
    lat = 2 * lat - _to.lat; lon = 2 * lon - _to.lon;
    secs += dt; d += sp * dt;
    r = REACH.nose + REACH.widen * mix * d + Math.min(PV.meanderCap, d * gusty * PV.meanderAmp);
    const w = reachWeight(secs, d, air);
    out.push({ lat, lon, r, w });
    if (w < REACH.possible * 0.5) break;                   // past anything that will be drawn or counted
  }
  return out;
}

/** The track as places a steady stride apart, each with the moment the dog was there. A collar that reports every few
    seconds leaves gaps a running dog covers in one bound; the reach has no such gaps. */
export function strideAlong(track, stride = REACH.stride) {
  const pts = (track || []).filter(p => p && Number.isFinite(p.lat) && Number.isFinite(p.lon));
  if (!pts.length) return [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += dist(pts[i - 1], pts[i]);
  const step = Math.max(stride, total / REACH.most);
  const out = [{ lat: pts[0].lat, lon: pts[0].lon, t: pts[0].t ?? 0 }];
  let left = step;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], len = dist(a, b);
    let at = left;
    while (at <= len && len > 0) {
      const k = at / len;
      out.push({ lat: a.lat + (b.lat - a.lat) * k, lon: a.lon + (b.lon - a.lon) * k, t: (a.t ?? 0) + ((b.t ?? 0) - (a.t ?? 0)) * k });
      at += step;
    }
    left = at - len;
  }
  const end = pts[pts.length - 1], last = out[out.length - 1];
  if (dist(last, end) > 0.3) out.push({ lat: end.lat, lon: end.lon, t: end.t ?? 0 });
  return out;
}

/** The reach of a whole track, in the order it was walked: pieces of ground, each a strip from `a` to `b` (lat, lon,
    r, w at each end) with the moment `t` the dog was there to smell it. `windFor(t)` gives the air at that moment. */
export function reachOf(T, track, windFor) {
  const pieces = [], chain = [], pts = strideAlong(track);
  for (let k = 0; k < pts.length; k++) {
    const p = pts[k], next = pts[k + 1] || p;
    const wx = windFor(p.t);
    const st = wx ? stability(wx.soil_temp, wx.temp) : null;
    reachFrom(T, p, wx, st, chain);
    /* `step` is how far the nose went before the next place the reach is worked out from. The dog did not jump there:
       the same strip is swept along that step when it is drawn and counted, or an edge lying across the wind comes out
       toothed, one tooth a stride. */
    const step = { lat: next.lat - p.lat, lon: next.lon - p.lon };
    if (chain.length === 1) pieces.push({ a: chain[0], b: chain[0], t: p.t, step });
    for (let i = 1; i < chain.length; i++) pieces.push({ a: chain[i - 1], b: chain[i], t: p.t, step });
  }
  return pieces;
}

/* How strong the reach of one piece is at a point, both in metres on a flat sheet. The same sum the picture is drawn
   with (glow.js), so the count and the picture cannot disagree. */
function strengthAt(px, py, ax, ay, bx, by, a, b, tx = 0, ty = 0) {
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy, n = tx || ty ? REACH.sweep : 1;
  let best = 0;
  for (let k = 0; k < n; k++) {                            // the strip, at each of a few places along the nose's step
    const f = n > 1 ? k / (n - 1) : 0, x = px - tx * f, y = py - ty * f;
    const h = L2 > 1e-6 ? Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / L2)) : 0;
    const ex = x - (ax + dx * h), ey = y - (ay + dy * h), r = a.r + (b.r - a.r) * h, q = Math.sqrt(ex * ex + ey * ey) / r;
    if (q >= 1) continue;
    let s = 1;
    if (q > REACH.edge) { const u = (q - REACH.edge) / (1 - REACH.edge); s = 1 - u * u * (3 - 2 * u); }
    best = Math.max(best, (a.w + (b.w - a.w) * h) * s);
  }
  return best;
}

/** For each of `points` (the laid trail, or the hides), the first moment it came within the dog's reach: `likely` and
    `possible`, each a time or Infinity if it never did. */
export function reachTimes(pieces, points) {
  const out = (points || []).map(() => ({ likely: Infinity, possible: Infinity }));
  if (!pieces.length || !out.length) return out;
  const o = pieces[0].a, mLat = 111320, mLon = 111320 * Math.cos(o.lat * Math.PI / 180);
  const X = (q) => (q.lon - o.lon) * mLon, Y = (q) => (q.lat - o.lat) * mLat;
  const P = points.map(q => [X(q), Y(q)]);
  for (const pc of pieces) {
    const ax = X(pc.a), ay = Y(pc.a), bx = X(pc.b), by = Y(pc.b), R = Math.max(pc.a.r, pc.b.r);
    const tx = (pc.step?.lon ?? 0) * mLon, ty = (pc.step?.lat ?? 0) * mLat;
    const x0 = Math.min(ax, bx) - R + Math.min(0, tx), x1 = Math.max(ax, bx) + R + Math.max(0, tx);
    const y0 = Math.min(ay, by) - R + Math.min(0, ty), y1 = Math.max(ay, by) + R + Math.max(0, ty);
    for (let i = 0; i < P.length; i++) {
      const got = out[i];
      if (got.likely <= pc.t) continue;                    // already had it, and earlier
      const px = P[i][0], py = P[i][1];
      if (px < x0 || px > x1 || py < y0 || py > y1) continue;
      const v = strengthAt(px, py, ax, ay, bx, by, pc.a, pc.b, tx, ty);
      if (v >= REACH.likely) got.likely = Math.min(got.likely, pc.t);
      if (v >= REACH.possible) got.possible = Math.min(got.possible, pc.t);
    }
  }
  return out;
}

/** Of those points, how many were within reach by the moment `at`. */
export function reachCount(times, at) {
  let likely = 0, possible = 0;
  /* never in reach is kept as Infinity, which must not pass for "by the end" when `at` is Infinity too */
  for (const t of times) { if (t.likely < Infinity && t.likely <= at) likely++; if (t.possible < Infinity && t.possible <= at) possible++; }
  return { likely, possible, of: times.length };
}
