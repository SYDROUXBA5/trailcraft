/* The flow field — the one function everything else reads.

   Weather models give us a single wind vector for the whole field: GFS is a
   0.25° grid, about 28 km, so an entire trail sits inside one cell. That number
   is all the wind data that exists at any price.

   But the *terrain* under that trail is 10 m data. Bending a coarse wind field
   around real ground is standard meteorological downscaling — it is genuinely
   closer to the truth than the raw number, which is the whole argument for
   doing this at all.

   Three things act on the air here:
     1. deflection — air cannot drive into a hillside, so it follows the contour
     2. drainage   — cold dense air slides downhill, but only under an inversion
     3. shelter    — ridges accelerate the flow, hollows go slack

   Everything in this file is pure: no DOM, no map, no globals. That is not
   tidiness, it is the reason the maths can be checked in Node instead of being
   eyeballed on a phone in a field. */

/* ── Terrain ──────────────────────────────────────────────────────── */

/** A terrain with no relief. Used when the DEM is unavailable — the flow then
    reduces to the plain synoptic wind, which is honest: with no elevation data
    we know nothing the forecast didn't already tell us. */
export const FLAT = { n: 2, cell: 1, h: new Float32Array(4), gx: new Float32Array(4),
                      gy: new Float32Array(4), expo: new Float32Array(4), flat: true };

/**
 * Build a terrain grid from raw elevations.
 * @param {ArrayLike<number>} h   n×n elevations in metres, row-major, north row first
 * @param {number} n              grid size
 * @param {number} cell           ground distance between samples, in metres
 * @param {object} [bbox]         { west, east, north, south } in degrees, so the
 *                                grid can place itself on the earth
 */
export function buildTerrain(h, n, cell, bbox) {
  if (!h || n < 3 || !(cell > 0)) return FLAT;

  const H = Float32Array.from(h);
  // A single null anywhere means the DEM did not load; a half-built terrain is
  // worse than none, because it invents cliffs at the boundary.
  for (let i = 0; i < H.length; i++) if (!Number.isFinite(H[i])) return FLAT;

  const at = (i, j) => H[Math.min(n - 1, Math.max(0, j)) * n + Math.min(n - 1, Math.max(0, i))];
  const gx = new Float32Array(n * n), gy = new Float32Array(n * n), expo = new Float32Array(n * n);

  // Neighbourhood radius for exposure, in cells. Roughly 60 m either way, which
  // is the scale a hedge line or a hollow actually shelters over.
  const R = Math.max(2, Math.round(60 / cell));

  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    gx[j * n + i] = (at(i + 1, j) - at(i - 1, j)) / (2 * cell);   // + = rises eastward
    gy[j * n + i] = (at(i, j + 1) - at(i, j - 1)) / (2 * cell);   // + = rises southward

    let sum = 0, cnt = 0;
    for (let d = -R; d <= R; d += Math.max(1, R >> 1))
      for (let e = -R; e <= R; e += Math.max(1, R >> 1)) { sum += at(i + e, j + d); cnt++; }
    expo[j * n + i] = H[j * n + i] - sum / cnt;   // + = ridge, − = hollow
  }
  return { n, cell, h: H, gx, gy, expo, bbox: bbox || null, flat: false };
}

/** Where a coordinate sits in the grid: 0,0 is the north-west corner. Points
    outside the grid clamp, because a particle that drifts off the edge should
    keep moving on the last known air rather than stop dead. */
export function normOf(T, lat, lon) {
  const b = T?.bbox;
  if (!b) return { x: 0.5, y: 0.5 };
  return {
    x: Math.min(1, Math.max(0, (lon - b.west) / (b.east - b.west || 1e-9))),
    y: Math.min(1, Math.max(0, (b.north - lat) / (b.north - b.south || 1e-9))),
  };
}

/** Bilinear sample of one of a terrain's grids at normalised (x, y). */
export function sample(grid, n, x, y) {
  const fx = Math.min(n - 1.001, Math.max(0, x * (n - 1)));
  const fy = Math.min(n - 1.001, Math.max(0, y * (n - 1)));
  const i = fx | 0, j = fy | 0, tx = fx - i, ty = fy - j;
  return (grid[j * n + i] * (1 - tx) + grid[j * n + i + 1] * tx) * (1 - ty)
       + (grid[(j + 1) * n + i] * (1 - tx) + grid[(j + 1) * n + i + 1] * tx) * ty;
}

/* ── Weather in time ──────────────────────────────────────────────── */

/* Conditions are not a snapshot. Over one Somerset morning the ground can go
   from level with the air to 2.3 °C warmer while the wind backs 26° and
   doubles — so a trail laid at 08:00 and worked at 09:30 is worked in different
   air from the air it was laid in. Open-Meteo serves this at 15-minute
   resolution, including soil temperature, so the model can follow it. */

/** Interpolate a compass bearing the short way round. Averaging 350° and 10°
    arithmetically gives 180° — the exact opposite of the answer. */
export function lerpDir(a, b, t) {
  if (a == null) return b;
  if (b == null) return a;
  const d = (((b - a) % 360) + 540) % 360 - 180;
  return (a + d * t + 360) % 360;
}

const LERP_KEYS = ['temp', 'humidity', 'dew_point', 'wind_speed', 'wind_gusts',
                   'soil_temp', 'precipitation', 'pressure'];

/**
 * Conditions at an instant, interpolated between 15-minute samples.
 * Falls back to the stored snapshot for sessions saved before series existed,
 * or saved offline — which is why this returns something usable either way.
 */
export function wxAt(weather, when) {
  if (!weather) return null;
  const s = weather.series;
  if (!Array.isArray(s) || s.length === 0) return weather;
  if (s.length === 1 || when <= s[0].t) return { ...weather, ...s[0] };
  if (when >= s[s.length - 1].t) return { ...weather, ...s[s.length - 1] };

  let i = 0;
  while (i < s.length - 2 && s[i + 1].t < when) i++;
  const a = s[i], b = s[i + 1];
  const span = b.t - a.t;
  const t = span > 0 ? (when - a.t) / span : 0;

  const out = { ...weather, t: when };
  for (const k of LERP_KEYS) {
    out[k] = (a[k] == null || b[k] == null) ? (a[k] ?? b[k]) : a[k] + (b[k] - a[k]) * t;
  }
  out.wind_direction = lerpDir(a.wind_direction, b.wind_direction, t);
  return out;
}

/* ── Stability ────────────────────────────────────────────────────── */

/* The single most useful number in scent work, and the one no competitor
   computes: how the ground temperature compares to the air above it.

   Ground warmer than air  → the air over it rises. Scent lifts off the ground,
                             breaks into pockets, disperses upward.
   Ground cooler than air  → a lid sits on the air. Scent stays low, persists,
                             and runs downhill like water.

   This is atmospheric stability, and Open-Meteo hands us both numbers free. */

/** @param {number} soilT ground temperature °C @param {number} airT air temperature °C */
export function stability(soilT, airT) {
  if (soilT == null || airT == null) {
    return { dT: 0, key: 'unknown', label: 'unknown', mix: 1, drain: 0, life: 1,
             plain: 'No ground temperature recorded, so stability is unknown.' };
  }
  const dT = soilT - airT;
  const R = (key, label, mix, drain, life, plain) => ({ dT, key, label, mix, drain, life, plain });

  if (dT >  3) return R('convective+', 'strongly convective', 1.9, 0,   0.34,
    'Ground is much warmer than the air. Scent lifts fast and breaks into pockets — expect the dog high-headed and casting wide.');
  if (dT >  1) return R('convective',  'convective',          1.4, 0,   0.58,
    'Ground is warmer than the air. Scent rises and disperses; the workable band widens quickly.');
  if (dT > -1) return R('neutral',     'neutral',             1.0, 0.1, 1.0,
    'Ground and air are close. Textbook downwind cone.');
  if (dT > -3) return R('stable',      'stable',              0.62, 0.7, 1.7,
    'Ground is cooler than the air. A lid on the air — scent stays low and holds its line.');
  return         R('inversion',   'strong inversion',    0.40, 1.0, 2.6,
    'Strong inversion. Scent hugs the ground and runs downhill into hollows; trails stay workable far longer than usual.');
}

/* ── The flow field ───────────────────────────────────────────────── */

/** Metres per second the synoptic wind blows, as an east/south vector. */
export function synoptic(speedMs, fromDeg) {
  const to = ((fromDeg ?? 0) + 180) * Math.PI / 180;    // direction it blows TOWARD
  return { u: Math.sin(to) * (speedMs ?? 0), v: -Math.cos(to) * (speedMs ?? 0) };
}

/**
 * Air movement at a point, in metres/second.
 * @param {object} T   terrain from buildTerrain
 * @param {number} x   normalised east→west position, 0 at the west edge
 * @param {number} y   normalised north→south position, 0 at the north edge
 * @param {object} wx  { wind_speed, wind_direction }
 * @param {object} st  from stability()
 * @param {object} [out] optional target, to avoid allocating in a render loop
 * @returns {{u:number, v:number}} u = eastward m/s, v = southward m/s
 */
export function flowAt(T, x, y, wx, st, out = { u: 0, v: 0 }) {
  const s = synoptic(wx?.wind_speed, wx?.wind_direction);
  let u = s.u, v = s.v;

  if (T && !T.flat) {
    const n = T.n;
    const gx = sample(T.gx, n, x, y), gy = sample(T.gy, n, x, y);
    const gm = Math.hypot(gx, gy);

    if (gm > 1e-4) {
      const ux = gx / gm, uy = gy / gm;        // unit vector pointing UPHILL
      const up = u * ux + v * uy;              // + = wind driving into the slope

      /* Deflection. Deliberately gentle — this is Somerset, not an alpine face.
         Turned up much past this the field spins into vortices, which looks more
         impressive and is less true. */
      const k = 0.52 * Math.min(1, gm * 1.7);
      u -= k * up * ux;
      v -= k * up * uy;
      const cx = -uy, cy = ux;                                  // along the contour
      const sgn = (u * cx + v * cy) >= 0 ? 1 : -1;              // whichever way it was already going
      u += k * Math.abs(up) * cx * sgn * 0.34;
      v += k * Math.abs(up) * cy * sgn * 0.34;

      /* Drainage. Only under a stable layer, and this is the case where the
         forecast is simply wrong: at dawn with the ground 3 °C colder than the
         air, the wind number can say 0.8 m/s from the north while the air at
         nose height runs downhill regardless of it. */
      if (st && st.drain > 0 && st.dT < 0) {
        const d = Math.min(1.6, 2.6 * gm * st.drain * (-st.dT) * 0.5);
        u -= ux * d;
        v -= uy * d;
      }
    }

    // Shelter and speed-up: ridges expose, hollows go slack.
    const ex = sample(T.expo, n, x, y);
    const m = Math.max(0.28, Math.min(1.7, 1 + ex * 0.052));
    u *= m; v *= m;
  }

  out.u = u; out.v = v;
  return out;
}

/** Speed of the flow at a point, in m/s. */
export function flowSpeed(T, x, y, wx, st) {
  const f = flowAt(T, x, y, wx, st, _tmp);
  return Math.hypot(f.u, f.v);
}
const _tmp = { u: 0, v: 0 };

/* ── Scent life ───────────────────────────────────────────────────── */

/* How long a scent pool stays workable, in minutes. Humid, cool, still and
   stable holds it for hours; hot, dry, windy and convective strips it in tens
   of minutes.

   Light rain HELPS — it re-wets the surface and refreshes scent. Heavy rain
   destroys it. That is counterintuitive enough to be worth encoding, and it is
   the sort of detail that decides whether an instructor trusts the rest. */
export function scentLife(wx, st) {
  const hum = wx?.humidity ?? 70;
  const wind = wx?.wind_speed ?? 0;
  const rain = wx?.precipitation ?? 0;
  const soil = wx?.soil_temp;

  const fHum  = 0.42 + hum / 78;
  const fWind = 1 / (1 + wind / 4.2);
  const fHot  = soil == null ? 1 : 1 / (1 + Math.max(0, soil - 15) / 16);
  const fRain = rain <= 0 ? 1 : rain < 0.6 ? 1.25 : 1 / (1 + (rain - 0.6) * 1.4);

  return Math.max(8, 82 * fHum * fWind * fHot * fRain * (st?.life ?? 1));
}

/* ── Sun ──────────────────────────────────────────────────────────── */

/* Where the sun is, so the app can show which ground is being heated. This is
   not decoration: heated ground is what lifts scent, so the south-facing slope
   can be actively throwing scent upward while the north side of the same hedge
   stays cool and holds it low. That single fact explains a great many trails.

   Simplified NOAA solar position — accurate to well under a degree, which is
   far finer than anything else in this model. */
export function solarPosition(date, lat, lon) {
  const d = date instanceof Date ? date : new Date(date);
  const rad = Math.PI / 180;
  const day = (d - Date.UTC(d.getUTCFullYear(), 0, 0)) / 864e5;
  const g = (357.529 + 0.98560028 * (day + 365.25 * (d.getUTCFullYear() - 2000))) * rad;
  const decl = 23.44 * rad * Math.sin((280.46 + 0.9856474 * day) * rad
             + 2 * 0.0167 * Math.sin(g));

  const utcH = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
  const ha = ((utcH - 12) * 15 + lon) * rad;
  const φ = lat * rad;

  const el = Math.asin(Math.sin(φ) * Math.sin(decl) + Math.cos(φ) * Math.cos(decl) * Math.cos(ha));
  const az = Math.atan2(-Math.sin(ha) * Math.cos(decl),
                        Math.cos(φ) * Math.sin(decl) - Math.sin(φ) * Math.cos(decl) * Math.cos(ha));

  return { elevation: el / rad, azimuth: ((az / rad) + 360) % 360 };
}

/** How strongly the sun is hitting the ground at a point. 0 = shaded or night. */
export function insolation(T, x, y, sun) {
  if (!sun || sun.elevation <= 0) return 0;
  const el = sun.elevation * Math.PI / 180, az = sun.azimuth * Math.PI / 180;
  const lx = Math.sin(az) * Math.cos(el), ly = -Math.cos(az) * Math.cos(el), lz = Math.sin(el);

  let gx = 0, gy = 0;
  if (T && !T.flat) { gx = sample(T.gx, T.n, x, y); gy = sample(T.gy, T.n, x, y); }
  const nz = 1 / Math.sqrt(1 + gx * gx + gy * gy);
  return Math.max(0, (-gx * nz) * lx + (-gy * nz) * ly + nz * lz);
}

/* ── Regime ───────────────────────────────────────────────────────── */

/* The model has two genuinely different modes and the UI must never blur them
   into one number. "6 m downwind" and "6 m downhill" are different sentences,
   different layers, and different advice to a handler. */
export function regime(T, trailPts, wx, st) {
  if (!st || st.drain < 0.3 || st.dT >= -0.6) return { key: 'wind', word: 'downwind' };
  if (!T || T.flat) return { key: 'wind', word: 'downwind' };

  // Drainage only leads if it actually beats the synoptic wind over this ground.
  const s = synoptic(wx?.wind_speed, wx?.wind_direction);
  const windMag = Math.hypot(s.u, s.v);
  let drainMag = 0;
  const step = 1 / 8;
  for (let y = step / 2; y < 1; y += step) for (let x = step / 2; x < 1; x += step) {
    const gm = Math.hypot(sample(T.gx, T.n, x, y), sample(T.gy, T.n, x, y));
    drainMag = Math.max(drainMag, Math.min(1.6, 2.6 * gm * st.drain * (-st.dT) * 0.5));
  }
  return drainMag > windMag
    ? { key: 'drain', word: 'downhill' }
    : { key: 'wind', word: 'downwind' };
}
