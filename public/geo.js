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
    for (let k = 1; k <= n; k++) out.push(project(a, brg, (d * k) / n));
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

/** How far the workable line sits from the true line. Saturates: the ground
    keeps emitting, so the offset settles rather than growing without bound. */
export function scentOffset(windMs, ageS, k = DRIFT_PER_MS) {
  const settle = 1 - Math.exp(-Math.max(0, ageS) / 900);   // ~15 min to steady state
  return Math.min(60, (windMs ?? 0) * k * settle);
}

/** Half-width of the plume — the uncertainty. Grows with age and wind. */
export function plumeWidth(ageS, windMs) {
  return Math.min(50, 2 + 0.06 * Math.sqrt(Math.max(0, ageS)) * (1 + (windMs ?? 0) / 6));
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
    const off = scentOffset(U, ageS, k);

    // Split the offset into across-track and along-track parts.
    let c = project(p, (hdg + 90) % 360, off * reg.cross);
    c = project(c, hdg, off * reg.along);
    return { centre: c, halfWidth: plumeWidth(ageS, U), heading: hdg, regime: reg, ageS };
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
