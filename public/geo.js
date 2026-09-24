/* Pure geometry and the scent-drift model. No DOM, no globals — so this can be
   exercised headlessly in Node, which is where the maths actually gets checked. */

export const R = 6371000;
export const rad = (d) => d * Math.PI / 180;
export const deg = (r) => r * 180 / Math.PI;

/** Great-circle distance in metres. */
export function dist(a, b) {
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Project a point `m` metres along `bearing` degrees. */
export function project(pt, bearing, m) {
  const d = m / R, br = rad(bearing), lat1 = rad(pt.lat), lon1 = rad(pt.lon);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(br));
  const lon2 = lon1 + Math.atan2(
    Math.sin(br) * Math.sin(d) * Math.cos(lat1),
    Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: deg(lat2), lon: deg(lon2) };
}

export const pathLen = (p) => p.reduce((s, pt, i) => i ? s + dist(p[i - 1], pt) : 0, 0);

const COMPASS = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
export const cardinal = (d) => COMPASS[Math.round(((d % 360) / 22.5)) % 16];

/* ── Drawn trails ─────────────────────────────────────────────────────
   A trail can be tapped onto the map instead of walked — the person who laid
   it often has no phone running, and an instructor setting a trail for a
   student wants to plan it first. Two things have to be supplied that a walked
   track carries for free: density, and a clock. */

/** Fill in points along a sparse path so it carries a fix roughly every
    `spacing` metres. A drawn trail is a handful of taps at the corners; the
    scent model wants the density a walked track has, or the plume comes out in
    lumps between the taps. */
export function densify(pts, spacing = 5) {
  if (!pts || pts.length < 2) return pts ? [...pts] : [];
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const d = dist(a, b);
    if (d < 1e-6) continue;
    const n = Math.max(1, Math.round(d / spacing));
    const brg = bearing(a, b);
    for (let k = 1; k <= n; k++) {
      const q = project(a, brg, (d * k) / n);
      /* Carry the clock across the new points. Scent age is what the model
         runs on, so a position with no time is ground that emits nothing —
         a densified trail would go back to emitting only at the original
         fixes, in beads, which is the opposite of what densifying is for. */
      if (Number.isFinite(a.t) && Number.isFinite(b.t)) q.t = a.t + (b.t - a.t) * (k / n);
      if (Number.isFinite(a.dwellS)) q.dwellS = k === n ? (b.dwellS ?? 0) : 0;
      /* The ground carries across too: the new points between two fixes on
         tarmac are on tarmac (ground.js marks them `hard`). */
      if (k === n ? b.hard : a.hard) q.hard = true;
      out.push(q);
    }
  }
  return out;
}

/** Give a drawn path a clock.

    This is the part that makes a drawn trail first-class rather than
    second-best: scent age is what the whole model runs on, and a pool at the
    start of a 40-minute trail is 40 minutes older than one at the end. Walking
    pace defaults to 1.3 m/s, which is an ordinary person laying a trail. */
export function timestamps(pts, startMs, paceMs = 1.3) {
  const pace = Math.max(0.2, paceMs);
  let acc = 0;
  return pts.map((p, i) => {
    if (i) acc += dist(pts[i - 1], p);
    return { lat: p.lat, lon: p.lon, t: Math.round(startMs + (acc / pace) * 1000), acc: null, alt: null };
  });
}

/** Metres a scent pool laid `ageH` hours ago plausibly drifted at `speed` m/s. */
export function driftMetres(speed, ageH) {
  return Math.min(120, speed * 12 * Math.sqrt(Math.max(0, ageH) + 0.05));
}

/* ILLUSTRATIVE, not a physical simulation. Public weather models report wind at
   10 m over open ground; under canopy at nose height the real airflow is a
   fraction of that and can reverse. This shows the direction a scent pool most
   plausibly moved — never a claim of where it is. */
export function driftPolygon(trail, wx) {
  const EMPTY = { type: 'FeatureCollection', features: [] };
  if (!trail || trail.length < 2 || !wx) return EMPTY;
  const speed = wx.wind_speed ?? 0;
  const to = ((wx.wind_direction ?? 0) + 180) % 360;   // wind_direction is FROM
  const end = trail[trail.length - 1].t;

  const offset = trail.map(p =>
    project(p, to, driftMetres(speed, (end - p.t) / 3.6e6)));

  const ring = [...trail, ...offset.reverse()].map(p => [p.lon, p.lat]);
  ring.push(ring[0]);
  return { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] } }] };
}

/** Mean distance from each dog fix to the nearest point on the laid trail. */
export function meanOffset(runnerPts, dogPts) {
  if (!runnerPts?.length || !dogPts?.length) return null;
  return dogPts.reduce((acc, p) =>
    acc + Math.min(...runnerPts.map(q => dist(p, q))), 0) / dogPts.length;
}

/* The two noise filters, as one predicate. The live recorder sees fixes one at
   a time and the tests feed them in batches — both must apply the same rule, so
   there is exactly one copy of it. */
export function shouldKeep(last, fix, accCap, stillCap) {
  if (fix.acc != null && fix.acc > accCap) return false;          // device says it is poor
  if (last && dist(last, fix) < stillCap) return false;           // stationary jitter
  return true;
}

/** Returns [kept, rejected] after the two noise filters. */
export function filterFixes(fixes, accCap, stillCap) {
  const kept = [];
  let rejected = 0;
  for (const f of fixes) {
    if (shouldKeep(kept[kept.length - 1], f, accCap, stillCap)) kept.push(f);
    else rejected++;
  }
  return [kept, rejected];
}

/* ── Simplification ──────────────────────────────────────────────────
   The inverse of densify: a walked track carries a fix every couple of metres,
   and a Trail Card has one QR code's worth of room. */

/** Douglas–Peucker with a metric tolerance. First and last points always
    survive, and every dropped point lies within `tolM` metres of the polyline
    that remains — the bound a Trail Card quotes when it thins a trail. Kept
    points are the original objects, so t, acc, alt ride along untouched. */
export function simplify(pts, tolM = 4) {
  if (!pts || pts.length <= 2) return pts ? [...pts] : [];
  /* Perpendicular distances on a flat projection at the trail's own latitude:
     over the few kilometres a trail spans the projection error is millimetres,
     far below any tolerance worth simplifying with. */
  const kx = Math.cos(rad(pts[0].lat)) * R;
  const X = pts.map(p => rad(p.lon) * kx), Y = pts.map(p => rad(p.lat) * R);
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const spans = [[0, pts.length - 1]];
  while (spans.length) {
    const [i, j] = spans.pop();
    const bx = X[j] - X[i], by = Y[j] - Y[i];
    const L2 = bx * bx + by * by;
    let worst = tolM * tolM, at = -1;
    for (let k = i + 1; k < j; k++) {
      const px = X[k] - X[i], py = Y[k] - Y[i];
      // Distance to the segment, not the infinite line — the bound must hold
      // even where a span doubles back past its own chord.
      const s = L2 ? Math.max(0, Math.min(1, (px * bx + py * by) / L2)) : 0;
      const d2 = (px - s * bx) ** 2 + (py - s * by) ** 2;
      if (d2 > worst) { worst = d2; at = k; }
    }
    if (at >= 0) { keep[at] = 1; spans.push([i, at], [at, j]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/* ── Scent field ───────────────────────────────────────────────────
   A better model than plain downwind offset: decompose the wind against the
   direction the runner was travelling, because that is what decides whether
   scent lands beside the trail, behind it, or ahead of it.

   Still illustrative. Weather models report 10 m wind over open ground; canopy,
   terrain channelling and thermals all dominate at nose height and none of them
   are in the data. The width of the band is the honest part — it says "somewhere
   in here", and it grows as the trail ages. */

import { PV } from './params.js';

export const DRIFT_PER_MS = 2.0;   // metres of offset per m/s of 10 m wind

/** Bearing a→b in degrees. */
export function bearing(a, b) {
  const φ1 = rad(a.lat), φ2 = rad(b.lat), Δλ = rad(b.lon - a.lon);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** Wind resolved against a heading. `cross` is +right / −left of travel. */
export function windRegime(heading, windFromDeg) {
  const to = ((windFromDeg ?? 0) + 180) % 360;          // direction it blows TOWARD
  const rel = ((to - heading + 540) % 360) - 180;        // −180…180
  const a = Math.abs(rel);
  return {
    rel,
    along: Math.cos(rad(rel)),                           // + = pushed forward
    cross: Math.sin(rad(rel)),                           // + = pushed right
    label: a < 45 ? 'tailwind' : a > 135 ? 'headwind' : 'crosswind',
    side: Math.sin(rad(rel)) >= 0 ? 'right' : 'left',
  };
}

/** How a dog came in to a find, against the wind, in the words a search
    result uses. `windFromDeg` is where the wind blows FROM, as Open-Meteo
    gives it, so heading toward it is walking into the wind. The search result
    used to work this out on its own and named it back to front, calling a dog
    that came in nose to the wind "with the wind". Reading it off windRegime
    means it cannot disagree with the rest of the app about which way is which. */
export function approachToWind(heading, windFromDeg) {
  if (!Number.isFinite(heading) || !Number.isFinite(windFromDeg)) return null;
  const { label } = windRegime(heading, windFromDeg);
  return label === 'headwind' ? 'into the wind' : label === 'tailwind' ? 'with the wind' : 'across the wind';
}

/** How far the workable line sits from the true line. Saturates: the ground
    keeps emitting, so the offset settles rather than growing without bound. */
export function scentOffset(windMs, ageS, k = PV.driftPerMs) {
  const settle = 1 - Math.exp(-Math.max(0, ageS) / PV.settleS);
  return Math.min(PV.offsetCap, (windMs ?? 0) * k * settle);
}

/** Half-width of the plume — the uncertainty. Grows with age and wind. */
export function plumeWidth(ageS, windMs) {
  return Math.min(PV.widthCap,
    PV.widthBase + PV.widthGrow * Math.sqrt(Math.max(0, ageS)) * (1 + (windMs ?? 0) / PV.widthWind));
}

/** Per-point scent field: where the workable line sits, and how wide it is. */
export function scentField(trail, wx, workedAt, k = DRIFT_PER_MS) {
  if (!trail || trail.length < 2 || !wx) return [];
  const U = wx.wind_speed ?? 0, from = wx.wind_direction ?? 0;
  const end = workedAt ?? trail[trail.length - 1].t;

  return trail.map((p, i) => {
    const a = trail[Math.max(0, i - 1)], b = trail[Math.min(trail.length - 1, i + 1)];
    const hdg = bearing(a, b);
    const reg = windRegime(hdg, from);
    const ageS = Math.max(0, (end - p.t) / 1000);
    /* Tarmac asks two separate questions here, each its own dial and each 1
       by default: how far the band is carried (transport), and how unsure the
       model should be about it (uncertainty). Uncertainty only ever widens —
       nothing may make the band look MORE certain over ground the model
       understands less. The old single figure narrowed it, which was exactly
       backwards. */
    const hard = !!p.hard;
    const off = scentOffset(U, ageS, k) * (hard ? PV.hardCarry : 1);

    // Split the offset into across-track and along-track parts.
    let c = project(p, (hdg + 90) % 360, off * reg.cross);
    c = project(c, hdg, off * reg.along);
    return { centre: c, halfWidth: plumeWidth(ageS, U) * (hard ? Math.max(1, PV.hardDoubt) : 1),
      heading: hdg, regime: reg, ageS };
  });
}

/** The scent field as a drawable band. */
export function plumePolygon(field) {
  const EMPTY = { type: 'FeatureCollection', features: [] };
  if (!field || field.length < 2) return EMPTY;
  const left = field.map(f => project(f.centre, (f.heading + 90) % 360, f.halfWidth));
  const right = field.map(f => project(f.centre, (f.heading + 270) % 360, f.halfWidth));
  const ring = [...left, ...right.reverse()].map(p => [p.lon, p.lat]);
  ring.push(ring[0]);
  return { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] } }] };
}

/** Group the trail into legs by wind regime, for a plain-language summary. */
export function legSummary(field) {
  const out = [];
  for (const f of field) {
    const last = out[out.length - 1];
    if (last && last.label === f.regime.label && last.side === f.regime.side) { last.n++; continue; }
    out.push({ label: f.regime.label, side: f.regime.side, n: 1 });
  }
  return out.filter(l => l.n >= 4);   // ignore momentary flicker at corners
}

/* ── Signed offsets ─────────────────────────────────────────────────
   The old meanOffset measured distance and threw the sign away, so the verdict
   could say "9 m off" but never "9 m off on the side the wind predicted" —
   and the side is the whole point: it is the model's one falsifiable claim.
   Convention everywhere: + right of the direction of travel, − left. */

/** Local metres of p relative to origin o: x east, y north. Good to well past
    the few hundred metres a trail spans. */
function enu(o, p) {
  return {
    x: rad(p.lon - o.lon) * Math.cos(rad(o.lat)) * R,
    y: rad(p.lat - o.lat) * R,
  };
}

/** Signed cross-track distance of p from segment a→b, clamped to the segment.
    + right of travel a→b, − left, 0 on the line (or a degenerate segment).
    `along` is where p falls along the segment before clamping: below 0 is
    behind a, above 1 is beyond b. */
export function crossTrackSigned(a, b, p) {
  const ab = enu(a, b), ap = enu(a, p);
  const L2 = ab.x * ab.x + ab.y * ab.y;
  if (L2 < 1e-9) return { off: dist(a, p), signed: 0, along: null };   // no direction, no side
  const along = (ap.x * ab.x + ap.y * ab.y) / L2;
  const t = Math.max(0, Math.min(1, along));
  const dx = ap.x - t * ab.x, dy = ap.y - t * ab.y;
  const d = Math.hypot(dx, dy);
  // z of ab×ap: > 0 means p sits LEFT of travel (x east, y north, right-handed).
  const cross = ab.x * ap.y - ab.y * ap.x;
  return { off: d, signed: cross < 0 ? d : cross > 0 ? -d : 0, along };
}

/** Signed offset of every track point from its nearest trail segment.
    Needs a trail of at least two points; returns [] otherwise.

    With `withinEnds`, a point whose nearest place on the trail is behind the
    start or beyond the end gets NaN instead of a number. Past the end there
    is no line to be left or right of: the clamped distance is mostly how far
    past the end the point is, and its side comes from a cross product that is
    close to zero, so it is decided by GPS noise. A handler standing at the
    runner with a 10 m line put the dog 10 m past the end, and a long reward
    there read as minutes spent on one side, picked at random. */
export function signedOffsets(trail, track, { withinEnds = false } = {}) {
  if (!trail || trail.length < 2 || !track?.length) return [];
  const last = trail.length - 1;
  return track.map((p) => {
    let best = null, at = 0;
    for (let i = 1; i < trail.length; i++) {
      const c = crossTrackSigned(trail[i - 1], trail[i], p);
      if (!best || c.off < best.off) { best = c; at = i; }
    }
    if (withinEnds && best.along != null
      && ((at === 1 && best.along < 0) || (at === last && best.along > 1))) return NaN;
    return best.signed;
  });
}

/** Median of the absolute offsets: how far the track typically sat from
    the line. A mean of SIGNED offsets lets a dog casting 15 m left and
    15 m right average to zero and read as "held the line" — this cannot. */
export function medianAbs(offs) {
  const a = (offs ?? []).filter(Number.isFinite).map(Math.abs).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/** Share of the run's time spent left of, on, and right of the line. Each
    fix weighs what it stood for — its dwell plus the gap to the next fix,
    capped so one dropped stretch cannot own the answer. Within `deadM` of
    the line a fix says nothing about side and counts as "on".

    A fix with no offset (NaN: before the start or past the end of the
    trail) has no line to be on or off, so it carries no weight at all. It
    used to count as "on". The last fix's dwell is left out too: after the
    last step comes the reward at the find, or the wait before Finish is
    pressed, and that is not the dog working the trail. A 90 second reward
    used to outweigh most of a short run. */
export function sideShares(track, offs, { deadM = 3, capS = 10 } = {}) {
  if (!track?.length || !offs?.length || track.length !== offs.length) return null;
  let left = 0, on = 0, right = 0;
  track.forEach((p, i) => {
    const o = offs[i];
    if (!Number.isFinite(o)) return;
    const next = track[i + 1];
    const gap = next && Number.isFinite(next.t) && Number.isFinite(p.t) ? Math.min(capS, Math.max(0, (next.t - p.t) / 1000)) : 1;
    const w = gap + (next && p.dwellS > 0 ? p.dwellS : 0);
    if (Math.abs(o) < deadM) on += w;
    else if (o > 0) right += w;
    else left += w;
  });
  const total = left + on + right;
  if (!(total > 0)) return null;
  return { left: left / total, on: on / total, right: right / total };
}

/** Mean of signed offsets — kept for the side, never for the distance.
    A fix with no offset (NaN, off either end of the trail) is left out:
    one of them would otherwise turn the whole mean into NaN. */
export function meanSigned(offs) {
  const xs = (offs ?? []).filter(Number.isFinite);
  if (!xs.length) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Which side of the travel direction the drift bearing points to:
    +1 right, −1 left, 0 within `deadDeg` of straight along or against —
    a head- or tailwind predicts NO side, and pretending it does is a lie. */
export function sideOfDrift(travelBrg, driftBrg, deadDeg = 12) {
  const r = ((driftBrg - travelBrg) % 360 + 360) % 360;
  if (r < deadDeg || r > 360 - deadDeg || Math.abs(r - 180) < deadDeg) return 0;
  return r < 180 ? 1 : -1;
}

/** Fraction of decisive fixes that sit on the model's predicted side.
    Fixes within `deadM` of the line say nothing about side and are ignored;
    a prediction of no side (0) returns null rather than a fake score. */
export function sideAgreement(offs, predictedSide, deadM = 1.5) {
  if (!predictedSide) return null;
  const decisive = (offs ?? []).filter(o => Math.abs(o) >= deadM);
  if (!decisive.length) return null;
  return decisive.filter(o => (o > 0 ? 1 : -1) === predictedSide).length / decisive.length;
}

/* ── Line-length correction ─────────────────────────────────────────
   The phone is in the handler's hand; the dog is a line-length ahead. Grading
   the phone's track against the trail penalises the handler for their own
   line. Project each fix forward along the handler's heading before offsets
   are computed.

   The heading is taken over a stretch of the walk at least a line-length
   long, never from one kept fix to the next. Kept fixes can be only 2.5 m
   apart, and a heading read off 2.5 m and then carried 10 m ahead multiplies
   any sideways wobble between two fixes about four times over: a handler
   walking exactly on the line read as 3 m off it half the time, on a side
   chosen by the noise. Over a line-length the wobble comes through about one
   to one, whatever the line. The coach smooths its heading for the same
   reason. */
export function lineCorrect(track, lineM) {
  if (!track?.length || !(lineM > 0)) return track ? track.slice() : [];
  /* Where the dog was is where the handler got to a line-length later. The
     handler walks the dog's path a lead behind, so the handler's OWN walk,
     read a line-length ahead, follows every bend and every overshoot exactly.
     Grading happens after the run, so that later walk is already known.

     Two earlier readings both went wrong. A heading from one kept fix to the
     next (2.5 m apart) carried ten metres ahead turned a metre of GPS wobble
     into four. A heading from a line-length back fixed that, but lagged round
     every turn and put the dog on the outside of each bend, which on a trail
     that mostly turns one way reads as the dog working that side. */
  const along = [0];
  for (let i = 1; i < track.length; i++) along.push(along[i - 1] + dist(track[i - 1], track[i]));
  const total = along[along.length - 1];
  /* Never a line-length from anywhere: nothing to read ahead, nothing to
     project along. */
  if (total < lineM) return track.map(p => ({ ...p }));

  /* The last line-length has no later walk to read, so the dog carries on
     the way the walk was going over that final stretch. */
  let k = track.length - 1;
  while (k > 0 && total - along[k] < lineM) k--;
  const endHdg = bearing(track[k], track[track.length - 1]);
  const last = track[track.length - 1];

  let j = 0;
  return track.map((p, i) => {
    const want = along[i] + lineM;
    if (want <= total) {
      while (j < track.length - 2 && along[j + 1] < want) j++;
      const a = track[j], b = track[j + 1];
      const seg = along[j + 1] - along[j];
      const f = seg > 0 ? (want - along[j]) / seg : 0;
      return { ...p, lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f };
    }
    const q = project(last, endHdg, want - total);
    return { ...p, lat: q.lat, lon: q.lon };
  });
}

/* ── Dwell ──────────────────────────────────────────────────────────
   The stillness filter used to THROW AWAY stationary fixes — which is exactly
   backwards for scent: standing still is not noise, it is the strongest source
   on the trail. The fix stream now folds stillness into dwell time on the last
   kept point, and the sim scales emission with it. */

/** Classify one incoming fix against the last kept point.
    'keep'  — a real step: append it.
    'dwell' — stationary: fold its seconds into the last point's dwell.
    'drop'  — the device itself says the fix is poor: worthless either way. */
export function dwellFold(last, fix, accCap, stillCap) {
  if (fix.acc != null && fix.acc > accCap) return 'drop';
  if (last && dist(last, fix) < stillCap) return 'dwell';
  return 'keep';
}

/** Fold a whole fix stream: kept points carry `dwellS` — seconds spent
    standing at that point — and rejected-for-quality fixes are counted. */
export function foldFixes(fixes, accCap, stillCap) {
  const kept = [];
  let dropped = 0;
  for (const f of fixes) {
    const last = kept[kept.length - 1];
    const verdict = dwellFold(last, f, accCap, stillCap);
    if (verdict === 'drop') { dropped++; continue; }
    if (verdict === 'dwell') {
      last.dwellS = (last.dwellS ?? 0) + Math.max(0, (f.t - (last._lastSeen ?? last.t)) / 1000);
      last._lastSeen = f.t;
      continue;
    }
    kept.push({ ...f, dwellS: 0, _lastSeen: f.t });
  }
  kept.forEach(p => delete p._lastSeen);
  return [kept, dropped];
}

/* ── Departure ────────────────────────────────────────────────────────
   A relay trail starts existing at the moment the layer LEAVES the
   departure point, so that is the moment the ageing clock starts — on both
   phones. Deciding it is a state machine, not a threshold, and it is here
   rather than in the screen code so it can be tested without a phone. */

/** Fold one fix into the departure state. `prev` is the state so far,
    `fix` is { d, t, walked, firstT } — metres from the drawn start, the fix
    clock, metres of the trail walked so far, and the clock at which she left
    the point nearest the start (walkedOfTrail gives both).

    Hysteresis on purpose: armed only INSIDE `nearM`, fired only OUTSIDE
    `awayM`, with a dead band between, so a GPS wobble while she is standing
    at the start cannot start the clock.

    The fallback matters more in a field than the hysteresis does. If no fix
    ever lands inside `nearM` — trees, a wall, or a drawn A that was simply a
    few metres out — the clock would otherwise never start and the session
    would be silently ruined. So a layer who has plainly walked `runM` of line
    is taken to have departed from the point nearest the start. */
export function departure(prev, fix, opts = {}) {
  const { nearM = 25, awayM = 40, runM = 60 } = opts;
  const st = { atStart: !!(prev && prev.atStart), offAt: (prev && prev.offAt) || 0 };
  if (st.offAt) return st;                       // it happens once
  if (fix.d < nearM) st.atStart = true;
  if (st.atStart && fix.d > awayM) { st.offAt = fix.t; return st; }
  if (!st.atStart && fix.walked >= runM) { st.atStart = true; st.offAt = fix.firstT ?? fix.t; }
  return st;
}

/** The point where the walked trail really begins: the one she came nearest
    the drawn start at, up to the moment she left (`offAt`, when known).

    The recording starts when the plan is scanned, which is usually in a car
    park some way off. That walk to the start is not part of the trail: kept,
    it would put a leg on the handler's line that no dog ever ran, and start
    the trail's clock minutes early. Only points up to the departure are
    looked at, so a loop that finishes back by the start cannot be mistaken
    for where it began. */
export function trailFrom(pts, A, offAt = 0) {
  let at = 0, best = Infinity;
  for (let i = 0; i < (pts?.length ?? 0); i++) {
    if (offAt && pts[i].t > offAt) break;
    const d = dist(pts[i], A);
    if (d < best) { best = d; at = i; }
  }
  return at;
}

/** What the departure fallback reads: metres of the TRAIL walked, and when
    she left the point nearest its start. `walked` is the smaller of the track
    since that point and the progress along the plan, so neither the walk to
    the start (every fix is the nearest yet, so nothing counts) nor wandering
    about behind the start (no progress along the line) can start the clock. */
export function walkedOfTrail(pts, line) {
  if (!pts?.length || !line?.length) return { walked: 0, firstT: null };
  const i = trailFrom(pts, line[0]);
  const since = pathLen(pts.slice(i));
  const pr = progressAlong(line, pts[pts.length - 1]);
  return { walked: Math.min(since, pr ? pr.along : since), firstT: pts[i]._seen ?? pts[i].t };
}

/* ── A recording that has stopped recording ───────────────────────────
   A clock ticking on the screen looks exactly like a run being recorded,
   whether or not a single fix is being kept. Without being told, a handler
   finds out at Stop, when the whole run is "too short to grade". */

/** What is wrong with the GPS right now, or null when fixes are being kept.
    `last` is the newest kept point (its `_seen` moves on while she stands
    still), `droppedAt` the clock of the newest fix thrown out for accuracy,
    `blocked` whether the phone refused location outright.
    { why: 'blocked' | 'poor' | 'none', ms } — `ms` is how long since the
    last usable fix. */
export function gpsTrouble({ last = null, startedAt = 0, now = Date.now(), droppedAt = 0, blocked = false, after = 15000 } = {}) {
  if (blocked) return { why: 'blocked', ms: 0 };
  const seen = last ? (last._seen ?? last.t) : startedAt;
  const ms = Math.max(0, now - seen);
  // Every fix so far refused: that is known at once, no need to wait.
  if (!last && droppedAt) return { why: 'poor', ms };
  if (ms < after) return null;
  return { why: droppedAt > seen ? 'poor' : 'none', ms };
}

/* ── Following a route ────────────────────────────────────────────────
   A trail you are walking is a route, and a route needs three things a
   recorded line does not: where you are ON it, what is left of it, and
   which way you are facing. */

/** Where you are along a line: nearest point, which segment, how far in,
    and how far there is left to walk. Distances in metres. */
export function progressAlong(line, p) {
  if (!line || line.length < 2 || !p) return null;
  const o = line[0];
  const P = enu(o, p);
  const pts = line.map(q => enu(o, q));
  let best = { d: Infinity, i: 1, t: 0, x: pts[0].x, y: pts[0].y };
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const dx = b.x - a.x, dy = b.y - a.y;
    const L2 = dx * dx + dy * dy;
    const t = L2 ? Math.max(0, Math.min(1, ((P.x - a.x) * dx + (P.y - a.y) * dy) / L2)) : 0;
    const x = a.x + t * dx, y = a.y + t * dy;
    const d = Math.hypot(P.x - x, P.y - y);
    if (d < best.d) best = { d, i, t, x, y };
  }
  const seg = (i) => Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  let along = 0;
  for (let i = 1; i < best.i; i++) along += seg(i);
  along += Math.hypot(best.x - pts[best.i - 1].x, best.y - pts[best.i - 1].y);
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += seg(i);
  return { off: best.d, i: best.i, t: best.t, along, remaining: Math.max(0, total - along), total };
}

/** A route cut where you are standing: behind you, and ahead of you.
    Navigation dims the first and lights the second — seeing that split is
    how you know the phone has actually found you on the line. */
export function splitLine(line, p) {
  const pr = progressAlong(line, p);
  if (!pr) return [[], line ? [...line] : []];
  const a = line[pr.i - 1], b = line[pr.i];
  const here = { lat: a.lat + (b.lat - a.lat) * pr.t, lon: a.lon + (b.lon - a.lon) * pr.t };
  return [[...line.slice(0, pr.i), here], [here, ...line.slice(pr.i)]];
}

/** A heading that does not flicker. Raw GPS course jumps by tens of degrees
    between fixes; a person walking does not. Blends across the 0/360 seam,
    so facing north never spins the map the long way round. */
export function smoothBearing(prev, next, alpha = 0.3) {
  if (!Number.isFinite(next)) return Number.isFinite(prev) ? prev : null;
  const wrap = (d) => ((d % 360) + 360) % 360;
  if (!Number.isFinite(prev)) return wrap(next);
  const delta = ((next - prev + 540) % 360) - 180;
  return wrap(prev + delta * alpha);
}

/* ── Units ────────────────────────────────────────────────────────────
   The model works in metres and metres per second and always will —
   converting at the edge, once, is what keeps the arithmetic honest. These
   are the edge.

   `imperial` is one flag rather than a per-quantity choice: a handler who
   thinks in yards does not want their wind in km/h. */

const FT = 3.280839895, YD = 1.0936133, MI = 0.000621371192;

/** A trail's length: the long form, where the unit changes with the scale. */
export function fmtDist(m, imperial = false) {
  if (!Number.isFinite(m)) return '—';
  if (imperial) {
    const mi = m * MI;
    /* Yards hold until half a mile. A 350 m trail is 380 yards of work and
       "0.2 mi" tells a handler nothing — the switch belongs where the number
       stops being something you can pace out. */
    return mi >= 0.5 ? `${mi.toFixed(mi >= 10 ? 0 : 1)} mi` : `${Math.round(m * YD)} yd`;
  }
  return m >= 1000 ? `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} km` : `${Math.round(m)} m`;
}

/** A short measurement — an offset, a line, an accuracy. Never changes unit,
    because the number is being compared against other numbers like it. */
export function fmtShort(m, imperial = false, dp = 0) {
  if (!Number.isFinite(m)) return '—';
  return imperial ? `${(m * FT).toFixed(dp)} ft` : `${m.toFixed(dp)} m`;
}

/** Wind, from the metres per second the forecast is asked for. */
export function fmtSpeed(ms, imperial = false) {
  if (!Number.isFinite(ms)) return '—';
  return imperial ? `${(ms * 2.236936).toFixed(0)} mph` : `${(ms * 3.6).toFixed(0)} km/h`;
}

export function fmtTemp(c, imperial = false) {
  if (!Number.isFinite(c)) return '—';
  return imperial ? `${Math.round(c * 9 / 5 + 32)} °F` : `${Math.round(c)} °C`;
}

/** The bare unit word, for a form field's suffix. */
export const unitShort = (imperial) => (imperial ? 'ft' : 'm');

/** The same clock, anchored at the END instead of the start.

    A trail that has just been laid FINISHES now: its beginning is the oldest
    ground on it, and whoever laid it is standing at the far end. Anchoring a
    drawn line at the start instead puts most of it in the future, where it
    has no scent yet at all — and a plume drawn from that creeps into
    existence along the line at walking pace, which is not something scent
    has ever done. */
export function timestampsEndingAt(pts, endMs, paceMs = 1.3) {
  if (!pts || !pts.length) return [];
  const secs = pathLen(pts) / Math.max(0.1, paceMs);
  return timestamps(pts, endMs - secs * 1000, paceMs);
}

/* A contamination trail is timed from the main trail, not from a clock the
   handler has to set. Laid before: it is finished CONTAM_GAP before the main
   trail starts, so it is always the older scent. Laid after: it starts a
   minute after the main trail ends, or sooner if it would otherwise still be
   being walked now, and never before the main trail ends, so it is always
   the fresher scent. */
export const CONTAM_GAP = 10 * 60e3;
export function contamTimed(main, pts, order, now = Date.now(), paceMs = 1.3) {
  const d = densify(pts || [], 5);
  if (d.length < 2) return [];
  const t0 = main?.[0]?.t, t1 = main?.[main.length - 1]?.t;
  const start = Number.isFinite(t0) ? t0 : now;
  const end = Number.isFinite(t1) ? t1 : now;
  if (order === 'after') {
    const walkMs = (pathLen(d) / Math.max(0.1, paceMs)) * 1000;
    return timestamps(d, Math.max(end, Math.min(end + 60e3, now - walkMs)), paceMs);
  }
  return timestampsEndingAt(d, start - CONTAM_GAP, paceMs);
}

/* Weight, kept in kilograms and shown in whichever the handler reads. */
const LB = 2.20462262;
export const kgToShown = (kg, imperial) => (Number.isFinite(kg) ? (imperial ? kg * LB : kg) : null);
export const shownToKg = (v, imperial) => (Number.isFinite(v) ? (imperial ? v / LB : v) : null);
export function fmtWeight(kg, imperial = false) {
  if (!Number.isFinite(kg) || kg <= 0) return '—';
  return imperial ? `${(kg * LB).toFixed(1)} lb` : `${kg.toFixed(1)} kg`;
}

/* ── Coordinates ──────────────────────────────────────────────────────
   Five decimal places is about a metre, which is already better than a
   phone knows where it is. A sixth would claim a precision the fix does
   not have.

   Degrees-minutes-seconds uses plain ' and " rather than the typographic
   prime marks: those paste straight into any map app or a text message,
   and a coordinate is mostly something you give to someone else. */
function dmsPart(v, pos, neg) {
  const hemi = v < 0 ? neg : pos;
  const a = Math.abs(v);
  let d = Math.floor(a);
  let m = Math.floor((a - d) * 60);
  let s = Math.round(((a - d) * 60 - m) * 60 * 10) / 10;
  // Rounding can carry: 59.96" is a whole minute, not 60.0".
  if (s >= 60) { s -= 60; m += 1; }
  if (m >= 60) { m -= 60; d += 1; }
  return `${d}°${String(m).padStart(2, '0')}'${s.toFixed(1).padStart(4, '0')}"${hemi}`;
}

export function fmtCoord(lat, lon, format = 'dd') {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)
      || Math.abs(lat) > 90 || Math.abs(lon) > 180) return '—';
  return format === 'dms'
    ? `${dmsPart(lat, 'N', 'S')} ${dmsPart(lon, 'E', 'W')}`
    : `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

/** Footprints along a track: one point every `strideM` metres, carrying the
    bearing of travel and its index, so the map can thin them by zoom, put
    left and right feet on their own sides and light them one after another.
    The stride carries across corners, so prints never bunch at a turn. */
export function stepPoints(pts, strideM = 3) {
  const out = [];
  if (!pts || pts.length < 2 || !(strideM > 0)) return out;
  let carry = 0, i = 0;
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1], b = pts[k];
    const L = dist(a, b);
    if (!(L > 0)) continue;
    const brg = bearing(a, b);
    let d = carry;
    while (d <= L) {
      const t = d / L;
      out.push({ lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t, b: brg, i: i++ });
      d += strideM;
    }
    carry = d - L;
  }
  return out;
}
