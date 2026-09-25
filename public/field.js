/* The flow field — the one function everything else reads.

   Weather models give us a single wind vector for the whole field: GFS is a
   0.25° grid, about 28 km, so an entire trail sits inside one cell. That number
   is all the wind data that exists at any price.

   But the *terrain* under that trail is 10 m data. Bending a coarse wind field
   around real ground is standard meteorological downscaling — it is genuinely
   closer to the truth than the raw number, which is the whole argument for
   doing this at all.

   Four things act on the air here:
     1. deflection  — air cannot drive into a hillside, so it follows the contour
     2. drainage    — cold dense air runs downhill hard under an inversion
     3. scent-creep — the ground-hugging scent film slides a little downhill on
                      any slope, in nearly any air (a handler's rule, and true)
     4. shelter     — ridges accelerate the flow, hollows go slack

   Everything in this file is pure: no DOM, no map, no globals. That is not
   tidiness, it is the reason the maths can be checked in Node instead of being
   eyeballed on a phone in a field. */

import { PV, stabilityStops, creepOf } from './params.js';

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
    keep moving on the last known air rather than stop dead. `out` is for the
    plume's hot loop, which asks this for every parcel at every step and
    would otherwise make a fresh object each time. */
export function normOf(T, lat, lon, out = { x: 0, y: 0 }) {
  const b = T?.bbox;
  if (!b) { out.x = 0.5; out.y = 0.5; return out; }
  out.x = Math.min(1, Math.max(0, (lon - b.west) / (b.east - b.west || 1e-9)));
  out.y = Math.min(1, Math.max(0, (b.north - lat) / (b.north - b.south || 1e-9)));
  return out;
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

/** Does a weather record's series really reach this moment? Within its first
    and last sample, give or take one sample's width. Outside that, wxAt can
    only repeat the nearest end — a guess, however exact it looks. */
export function seriesCovers(weather, when, slackMs = 20 * 60e3) {
  const s = weather?.series;
  if (!Array.isArray(s) || !s.length || !Number.isFinite(when)) return false;
  return when >= s[0].t - slackMs && when <= s[s.length - 1].t + slackMs;
}

/** The wind at one moment of a run, from what the session holds, and whether
    it truly is that moment's. Every view of a run reads it here — the coach
    while it happens, the plume on Reveal, the replay as its clock moves, and
    the grade — so none of them can put the scent on a different side from
    the others. The run's own weather (fetched when the laid series did not
    reach the run) comes first, then the laid series. */
export function windAt(session, when) {
  const d = session?.data ?? {};
  for (const w of [d.runWeather, d.weather]) {
    if (seriesCovers(w, when)) return { wx: wxAt(w, when), exact: true };
  }
  return { wx: d.runWeather ?? d.weather ?? null, exact: false };
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
  const S = stabilityStops();
  if (soilT == null || airT == null) {
    return { dT: 0, key: 'unknown', label: 'unknown', mix: 1, drain: 0, life: 1,
             plain: 'No ground temperature recorded, so stability is unknown.' };
  }
  const dT = soilT - airT;
  const R = (key, label, mix, drain, life, plain) => ({ dT, key, label, mix, drain, life, plain });

  if (dT > S.bounds[0]) return R('convective+', 'strongly convective', S.mix[0], S.drain[0], S.life[0],
    'Ground is much warmer than the air. Scent lifts fast and breaks into pockets — expect the dog high-headed and casting wide.');
  if (dT > S.bounds[1]) return R('convective',  'convective',          S.mix[1], S.drain[1], S.life[1],
    'Ground is warmer than the air. Scent rises and disperses; the workable band widens quickly.');
  if (dT > S.bounds[2]) return R('neutral',     'neutral',             S.mix[2], S.drain[2], S.life[2],
    'Ground and air are close. Textbook downwind cone.');
  if (dT > S.bounds[3]) return R('stable',      'stable',              S.mix[3], S.drain[3], S.life[3],
    'Ground is cooler than the air. A lid on the air — scent stays low and holds its line.');
  return         R('inversion',   'strong inversion',    S.mix[4], S.drain[4], S.life[4],
    'Strong inversion. Scent hugs the ground and runs downhill into hollows; trails stay workable far longer than usual.');
}

/* ── The flow field ───────────────────────────────────────────────── */

/* Downslope scent-creep weight per stability regime — how much of the
   ground-hugging scent film survives to slide downhill. */
/* Live from the bench (params.js stabilityStops). The defaults are the
   values this model shipped with; every one of them was chosen, not measured. */

/** Metres per second the synoptic wind blows, as an east/south vector.
    `out` as for flowAt, which calls this first thing every time. */
export function synoptic(speedMs, fromDeg, out = { u: 0, v: 0 }) {
  const to = ((fromDeg ?? 0) + 180) * Math.PI / 180;    // direction it blows TOWARD
  out.u = Math.sin(to) * (speedMs ?? 0);
  out.v = -Math.cos(to) * (speedMs ?? 0);
  return out;
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
  const s = synoptic(wx?.wind_speed, wx?.wind_direction, out);   // `out` is written again below
  let u = s.u, v = s.v;

  if (T && !T.flat) {
    const n = T.n;
    const gx = sample(T.gx, n, x, y), gy = sample(T.gy, n, x, y);
    /* Math.sqrt, not Math.hypot: V8 boxes both of hypot's arguments on the
       heap, and this runs for every parcel at every step. The two agree to
       the last bit or so for any slope a hill can have. */
    const gm = Math.sqrt(gx * gx + gy * gy);

    if (gm > 1e-4) {
      const ux = gx / gm, uy = gy / gm;        // unit vector pointing UPHILL
      const up = u * ux + v * uy;              // + = wind driving into the slope

      /* Deflection. Deliberately gentle — this is Somerset, not an alpine face.
         Turned up much past this the field spins into vortices, which looks more
         impressive and is less true. */
      const k = PV.deflect * Math.min(1, gm * PV.slopeSat);
      u -= k * up * ux;
      v -= k * up * uy;
      const cx = -uy, cy = ux;                                  // along the contour
      const sgn = (u * cx + v * cy) >= 0 ? 1 : -1;              // whichever way it was already going
      u += k * Math.abs(up) * cx * sgn * PV.contour;
      v += k * Math.abs(up) * cy * sgn * PV.contour;

      /* Drainage. Under a stable layer the cold air is a river: at dawn with
         the ground 3 °C colder than the air, the wind number can say 0.8 m/s
         from the north while the air at nose height runs downhill regardless. */
      if (st && st.drain > 0 && st.dT < 0) {
        const d = Math.min(PV.drainCap, PV.drainGain * gm * st.drain * (-st.dT) * 0.5);
        u -= ux * d;
        v -= uy * d;
      }

      /* Scent-creep — the handler's rule the pure meteorology misses: the
         scent-carrying film hugging the ground is cool and heavy, and it
         slides downhill on ANY slope in nearly ANY air, not only under an
         inversion. Small beside true drainage and easily owned by a real
         wind, but never zero on a hillside: strongest in stable air, still
         present in neutral, mostly lifted away once the sun has the ground
         cooking. */
      const creep = Math.min(PV.creepCap, gm * PV.creepGain * (creepOf(st?.key) ?? 0.3));
      u -= ux * creep;
      v -= uy * creep;
    }

    // Shelter and speed-up: ridges expose, hollows go slack.
    const ex = sample(T.expo, n, x, y);
    const m = Math.max(PV.expoFloor, Math.min(PV.expoCeil, 1 + ex * PV.expoGain));
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

/** How hard it is raining, in mm per hour. Every weather record holds
    `precipitation` exactly as Open-Meteo's 15-minute series gives it: the
    rain that fell in the 15 minutes before, in mm, not a rate. The rain
    dials are in mm/h, and reading the one as the other made steady 2 mm/h
    rain arrive as 0.5, under the 0.6 drizzle line, so rain four times too
    heavy still counted as the light rain that refreshes scent. Scaled here,
    once, so every record already saved reads right as it is. */
export const RAIN_SUMS_PER_HOUR = 4;
export function rainRate(wx) {
  const p = wx?.precipitation;
  return Number.isFinite(p) && p > 0 ? p * RAIN_SUMS_PER_HOUR : 0;
}

/* How long a scent pool stays workable, in minutes. Humid, cool, still and
   stable holds it for hours; hot, dry, windy and convective strips it in tens
   of minutes.

   Light rain HELPS — it re-wets the surface and refreshes scent. Heavy rain
   destroys it. That is counterintuitive enough to be worth encoding, and it is
   the sort of detail that decides whether an instructor trusts the rest. */
export function scentLife(wx, st) {
  const hum = wx?.humidity ?? 70;
  const wind = wx?.wind_speed ?? 0;
  const rain = rainRate(wx);
  const soil = wx?.soil_temp;

  const fHum  = PV.humA + hum / PV.humB;
  const fWind = 1 / (1 + wind / PV.windHalf);
  const fHot  = soil == null ? 1 : 1 / (1 + Math.max(0, soil - PV.hotKnee) / PV.hotScale);
  const fRain = rain <= 0 ? 1 : rain < PV.rainDrizzle ? PV.rainBoost
              : 1 / (1 + (rain - PV.rainDrizzle) * PV.rainDecay);

  return Math.max(PV.lifeFloor, PV.lifeBase * fHum * fWind * fHot * fRain * (st?.life ?? 1));
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
  if (!st) return { key: 'wind', word: 'downwind' };
  if (!T || T.flat) return { key: 'wind', word: 'downwind' };

  // Downhill only leads if it actually beats the synoptic wind over this
  // ground — counting both true drainage and the always-on scent-creep, so a
  // steep hillside in calm stable air reads "downhill" like it works.
  const s = synoptic(wx?.wind_speed, wx?.wind_direction);
  const windMag = Math.hypot(s.u, s.v);
  let downMag = 0;
  const step = 1 / 8;
  for (let y = step / 2; y < 1; y += step) for (let x = step / 2; x < 1; x += step) {
    const gm = Math.hypot(sample(T.gx, T.n, x, y), sample(T.gy, T.n, x, y));
    /* The same two formulas as flowAt. They MUST read the same dials: an
       earlier version kept its own copies, so a bench could move the map
       while this verdict word went on saying something else. */
    const drain = (st.drain > 0 && st.dT < 0)
      ? Math.min(PV.drainCap, PV.drainGain * gm * st.drain * (-st.dT) * 0.5) : 0;
    const creep = Math.min(PV.creepCap, gm * PV.creepGain * (creepOf(st.key) ?? 0.3));
    downMag = Math.max(downMag, drain + creep);
  }
  return downMag > windMag
    ? { key: 'drain', word: 'downhill' }
    : { key: 'wind', word: 'downwind' };
}
