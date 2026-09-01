/* The flow field and the scent simulation, checked headlessly.

   These are the parts that decide what the app tells a handler, so they get
   exercised here rather than eyeballed on a phone. Every terrain below is
   synthetic and exact, which is the point: on real ground you can never tell
   whether a wrong answer came from the model or from the hill. */

import assert from 'node:assert/strict';
import {
  FLAT, buildTerrain, normOf, sample, stability, synoptic, flowAt,
  scentLife, solarPosition, insolation, regime, lerpDir, wxAt,
} from '../public/field.js';
import { driftFrom, predictedOffsets, ScentSim, NOSE, AIRBORNE } from '../public/sim.js';
import { dist, scentOffset } from '../public/geo.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log(`  ok  ${name}`); };
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

const WELLS = { lat: 51.2094, lon: -2.6449 };
const BBOX = { west: -2.6500, east: -2.6398, north: 51.2140, south: 51.2048 };

/** n×n terrain from h(x,y), x east 0→1, y south 0→1. */
function make(n, cell, f) {
  const h = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++)
    h[j * n + i] = f(i / (n - 1), j / (n - 1));
  return buildTerrain(h, n, cell, BBOX);
}
const NEUTRAL   = stability(13, 13);
const INVERSION = stability(9, 14);      // ground 5 °C colder than air
const CONVECT   = stability(19, 13);     // ground 6 °C warmer

/* ── terrain ──────────────────────────────────────────────────────── */

t('buildTerrain: rejects unusable input rather than inventing terrain', () => {
  assert.equal(buildTerrain(null, 32, 10), FLAT);
  assert.equal(buildTerrain(new Float32Array(4), 2, 10), FLAT);
  assert.equal(buildTerrain(new Float32Array(9), 3, 0), FLAT);
  const holed = new Float32Array(9).fill(5); holed[4] = NaN;
  assert.equal(buildTerrain(holed, 3, 10), FLAT, 'one bad sample voids the grid');
});

t('buildTerrain: gradient points uphill in both axes', () => {
  const east = make(33, 10, (x) => 100 * x);          // rises to the east
  near(sample(east.gx, 33, 0.5, 0.5), 100 / (32 * 10), 1e-3, 'east gradient');
  near(sample(east.gy, 33, 0.5, 0.5), 0, 1e-6, 'no north/south gradient');

  const south = make(33, 10, (_x, y) => 100 * y);     // rises to the south
  assert.ok(sample(south.gy, 33, 0.5, 0.5) > 0, 'gy positive when ground rises southward');
});

t('buildTerrain: exposure separates ridge from hollow', () => {
  const T = make(49, 8, (x, y) => 30 * Math.exp(-(((x-0.3)**2 + (y-0.3)**2) / 0.02))
                                - 30 * Math.exp(-(((x-0.7)**2 + (y-0.7)**2) / 0.02)));
  assert.ok(sample(T.expo, 49, 0.3, 0.3) > 0, 'hill top is exposed');
  assert.ok(sample(T.expo, 49, 0.7, 0.7) < 0, 'hollow is sheltered');
});

t('normOf: corners land where they should', () => {
  const T = make(9, 10, () => 0);
  const nw = normOf(T, BBOX.north, BBOX.west);
  near(nw.x, 0, 1e-9, 'nw x'); near(nw.y, 0, 1e-9, 'nw y');
  const se = normOf(T, BBOX.south, BBOX.east);
  near(se.x, 1, 1e-9, 'se x'); near(se.y, 1, 1e-9, 'se y');
});

/* ── weather in time ──────────────────────────────────────────────── */

t('lerpDir: interpolates the short way round the compass', () => {
  near(lerpDir(350, 10, 0.5), 0, 1e-9, 'across north');
  near(lerpDir(10, 350, 0.5), 0, 1e-9, 'and back again');
  near(lerpDir(90, 180, 0.5), 135, 1e-9, 'ordinary case');
  near(lerpDir(0, 0, 0.5), 0, 1e-9, 'no change');
  assert.equal(lerpDir(null, 42, 0.5), 42, 'missing start falls back');
});

t('wxAt: interpolates between 15-minute samples, wind direction included', () => {
  const t0 = Date.parse('2026-08-21T08:00:00Z');
  const wx = {
    temp: 14, wind_speed: 1.5, wind_direction: 330, soil_temp: 15.3,
    series: [
      { t: t0,            temp: 14.0, wind_speed: 1.5, wind_direction: 350, soil_temp: 15.3 },
      { t: t0 + 900000,   temp: 14.2, wind_speed: 1.9, wind_direction: 10,  soil_temp: 15.5 },
    ],
  };
  const mid = wxAt(wx, t0 + 450000);
  near(mid.temp, 14.1, 1e-6, 'temperature');
  near(mid.wind_speed, 1.7, 1e-6, 'wind speed');
  near(mid.soil_temp, 15.4, 1e-6, 'soil temperature');
  near(mid.wind_direction, 0, 1e-6, 'direction crosses north correctly, not via south');
});

t('wxAt: clamps outside the series and survives sessions saved without one', () => {
  const t0 = Date.parse('2026-08-21T08:00:00Z');
  const wx = { temp: 99, series: [{ t: t0, temp: 10 }, { t: t0 + 900000, temp: 20 }] };
  assert.equal(wxAt(wx, t0 - 9e6).temp, 10, 'before the series');
  assert.equal(wxAt(wx, t0 + 9e6).temp, 20, 'after the series');

  const old = { temp: 12, wind_speed: 3 };            // saved before series existed
  assert.equal(wxAt(old, Date.now()).temp, 12, 'snapshot still works');
  assert.equal(wxAt(null, Date.now()), null, 'no weather is not a crash');
});

/* ── stability ────────────────────────────────────────────────────── */

t('stability: differential drives the regime, and unknown stays unknown', () => {
  assert.equal(stability(9, 14).key, 'inversion');
  assert.equal(stability(12, 14).key, 'stable');
  assert.equal(stability(13, 13).key, 'neutral');
  assert.equal(stability(15, 13).key, 'convective');
  assert.equal(stability(19, 13).key, 'convective+');
  assert.equal(stability(null, 13).key, 'unknown');
  near(stability(9, 14).dT, -5, 1e-9, 'differential');
});

t('stability: stable air holds scent longer and convective strips it', () => {
  assert.ok(INVERSION.life > NEUTRAL.life, 'inversion holds');
  assert.ok(CONVECT.life < NEUTRAL.life, 'convection strips');
  assert.ok(CONVECT.mix > NEUTRAL.mix, 'convection mixes harder');
  assert.equal(CONVECT.drain, 0, 'no drainage when the ground is warm');
});

/* ── flow ─────────────────────────────────────────────────────────── */

t('synoptic: wind FROM a bearing blows toward the opposite one', () => {
  const w = synoptic(5, 270);                      // from the west
  near(w.u, 5, 1e-9, 'blows east'); near(w.v, 0, 1e-9, 'not north or south');
  const n = synoptic(5, 0);                        // from the north
  near(n.u, 0, 1e-9, 'not east or west'); near(n.v, 5, 1e-9, 'blows south');
});

t('flowAt: with no terrain the flow is exactly the forecast', () => {
  const f = flowAt(FLAT, 0.5, 0.5, { wind_speed: 4, wind_direction: 270 }, NEUTRAL);
  near(f.u, 4, 1e-9, 'unchanged u'); near(f.v, 0, 1e-9, 'unchanged v');
});

t('flowAt: a hillside deflects wind driving into it', () => {
  const T = make(33, 10, (x) => 90 * x);           // rises steeply eastward
  const wx = { wind_speed: 6, wind_direction: 270 };   // blowing east, straight uphill
  const f = flowAt(T, 0.5, 0.5, wx, NEUTRAL);
  assert.ok(f.u < 6, 'uphill component is reduced');
  assert.ok(Math.abs(f.v) > 0.05, 'and some of it is redirected along the contour');
});

t('flowAt: drainage runs downhill under an inversion, and only then', () => {
  const T = make(33, 10, (_x, y) => 60 * (1 - y));    // falls to the south
  const calm = { wind_speed: 0.3, wind_direction: 0 };

  const cold = flowAt(T, 0.5, 0.5, calm, INVERSION);
  assert.ok(cold.v > 0.5, `cold air should run south (downhill), got v=${cold.v}`);

  const warm = flowAt(T, 0.5, 0.5, calm, CONVECT);
  assert.ok(warm.v < cold.v, 'convective air does not drain');
  assert.ok(Math.hypot(warm.u, warm.v) < 1, 'and stays near the light forecast wind');
});

t('flowAt: drainage follows the slope, not the compass', () => {
  const north = make(33, 10, (_x, y) => 60 * y);      // rises southward → drains north
  const f = flowAt(north, 0.5, 0.5, { wind_speed: 0.2, wind_direction: 0 }, INVERSION);
  assert.ok(f.v < -0.5, `should drain north on a north-falling slope, got v=${f.v}`);
});

t('flowAt: ridges accelerate the flow and hollows go slack', () => {
  const T = make(49, 8, (x, y) => 26 * Math.exp(-(((x-0.3)**2 + (y-0.3)**2) / 0.02))
                                - 26 * Math.exp(-(((x-0.7)**2 + (y-0.7)**2) / 0.02)));
  const wx = { wind_speed: 5, wind_direction: 270 };
  const ridge = flowAt(T, 0.3, 0.3, wx, NEUTRAL);
  const hollow = flowAt(T, 0.7, 0.7, wx, NEUTRAL);
  assert.ok(Math.hypot(ridge.u, ridge.v) > Math.hypot(hollow.u, hollow.v),
    'exposed ground sees more wind than sheltered ground');
});

t('regime: names which force is actually leading', () => {
  const steep = make(33, 10, (_x, y) => 70 * (1 - y));
  assert.equal(regime(steep, [], { wind_speed: 0.4, wind_direction: 0 }, INVERSION).key, 'drain',
    'calm inversion on a slope is drainage-led');
  assert.equal(regime(steep, [], { wind_speed: 9, wind_direction: 0 }, INVERSION).key, 'wind',
    'a strong wind overwhelms drainage');
  assert.equal(regime(steep, [], { wind_speed: 0.4, wind_direction: 0 }, CONVECT).key, 'wind',
    'no drainage without a cold surface');
  assert.equal(regime(FLAT, [], { wind_speed: 0.4, wind_direction: 0 }, INVERSION).key, 'wind',
    'flat ground cannot drain');
});

/* ── scent life ───────────────────────────────────────────────────── */

t('scentLife: responds to each condition in the right direction', () => {
  const base = { humidity: 70, wind_speed: 3, soil_temp: 12, precipitation: 0 };
  const L = (o, st = NEUTRAL) => scentLife({ ...base, ...o }, st);

  assert.ok(L({ humidity: 95 }) > L({ humidity: 35 }), 'humid holds scent');
  assert.ok(L({ wind_speed: 1 }) > L({ wind_speed: 10 }), 'wind strips scent');
  assert.ok(L({ soil_temp: 8 }) > L({ soil_temp: 30 }), 'hot ground destroys scent');
  assert.ok(L({}, INVERSION) > L({}, NEUTRAL), 'stable air holds scent');
  assert.ok(L({}, CONVECT) < L({}, NEUTRAL), 'convection strips scent');
});

t('scentLife: light rain helps, heavy rain destroys', () => {
  const base = { humidity: 70, wind_speed: 3, soil_temp: 12 };
  const dry = scentLife({ ...base, precipitation: 0 }, NEUTRAL);
  const light = scentLife({ ...base, precipitation: 0.3 }, NEUTRAL);
  const heavy = scentLife({ ...base, precipitation: 6 }, NEUTRAL);
  assert.ok(light > dry, 'light rain re-wets the surface and refreshes scent');
  assert.ok(heavy < dry, 'heavy rain washes it away');
});

t('scentLife: never returns zero or a negative, whatever it is handed', () => {
  assert.ok(scentLife({}, null) > 0);
  assert.ok(scentLife(null, null) > 0);
  assert.ok(scentLife({ humidity: 0, wind_speed: 40, soil_temp: 60, precipitation: 99 }, CONVECT) >= 8);
});

/* ── sun ──────────────────────────────────────────────────────────── */

t('solarPosition: sun is high at UK midsummer noon and below the horizon at night', () => {
  const noon = solarPosition(Date.UTC(2026, 5, 21, 12, 0), WELLS.lat, WELLS.lon);
  assert.ok(noon.elevation > 45, `midsummer noon should be high, got ${noon.elevation}`);
  assert.ok(noon.azimuth > 140 && noon.azimuth < 220, `should be roughly south, got ${noon.azimuth}`);

  const night = solarPosition(Date.UTC(2026, 5, 21, 1, 0), WELLS.lat, WELLS.lon);
  assert.ok(night.elevation < 0, `1 am should be below the horizon, got ${night.elevation}`);
});

t('insolation: a south-facing slope catches more sun than a north-facing one', () => {
  const sun = solarPosition(Date.UTC(2026, 5, 21, 12, 0), WELLS.lat, WELLS.lon);
  const southFacing = make(33, 10, (_x, y) => 60 * (1 - y));   // drops to the south
  const northFacing = make(33, 10, (_x, y) => 60 * y);         // drops to the north
  assert.ok(insolation(southFacing, 0.5, 0.5, sun) > insolation(northFacing, 0.5, 0.5, sun),
    'the south side of the hedge is the one being heated');
  assert.equal(insolation(southFacing, 0.5, 0.5, { elevation: -5, azimuth: 180 }), 0,
    'no sun below the horizon');
});

/* ── scent simulation ─────────────────────────────────────────────── */

t('driftFrom: no airborne time means no displacement', () => {
  const d = driftFrom(FLAT, WELLS, 0, { wind_speed: 8, wind_direction: 270 }, NEUTRAL);
  assert.equal(dist(WELLS, d), 0);
});

t('driftFrom: scent goes downwind, at roughly wind × time × nose factor', () => {
  const wx = { wind_speed: 5, wind_direction: 270 };     // from the west
  const d = driftFrom(FLAT, WELLS, 40, wx, NEUTRAL);
  assert.ok(d.lon > WELLS.lon, 'displaced eastward, i.e. downwind');
  near(dist(WELLS, d), 5 * 40 * NOSE, 1.5, 'distance matches wind × time × nose factor');
});

t('driftFrom: displacement stays at the scale a dog works, not kilometres', () => {
  const wx = { wind_speed: 6, wind_direction: 270 };
  const full = driftFrom(FLAT, WELLS, AIRBORNE, wx, NEUTRAL);
  assert.ok(dist(WELLS, full) < 120,
    `a full airborne life must stay in tens of metres, got ${dist(WELLS, full).toFixed(0)} m`);
});

t('predictedOffsets: capped, and older trail predicts further than fresh', () => {
  const t0 = Date.parse('2026-08-24T07:00:00Z');
  const trail = [];
  for (let i = 0; i < 12; i++) trail.push({ lat: WELLS.lat, lon: WELLS.lon + i * 2e-4, t: t0 + i * 60000 });
  const wx = { wind_speed: 7, wind_direction: 180 };

  const fresh = predictedOffsets(FLAT, trail, wx, NEUTRAL, t0 + 3 * 60000);
  const old   = predictedOffsets(FLAT, trail, wx, NEUTRAL, t0 + 90 * 60000);
  assert.ok(old[0].metres > fresh[0].metres, 'an older trail has drifted further');
  for (const o of old) assert.ok(o.metres <= 60, 'never claims more than the cap');
});

t('predictedOffsets: predicts the workable core, not the faint edge of the plume', () => {
  /* The distinction that makes the verdict worth having. An earlier version
     predicted where a mid-life particle reaches — the edge of the band — and
     claimed 34 m where the honest answer was about 9. A dog works the core.

     Pinned against geo.js's scentOffset, which is the only constant here with
     any field history behind it. */
  const t0 = Date.parse('2026-08-24T07:00:00Z');
  const trail = [];
  for (let i = 0; i < 20; i++) trail.push({ lat: WELLS.lat, lon: WELLS.lon + i * 1e-4, t: t0 + i * 30000 });
  const wx = { wind_speed: 5, wind_direction: 270 };

  const worked = t0 + 3600e3;                      // an hour old, fully settled
  const got = predictedOffsets(FLAT, trail, wx, NEUTRAL, worked);
  const meanM = got.reduce((a, p) => a + p.metres, 0) / got.length;

  near(meanM, scentOffset(5, 3600), 2,
    'neutral prediction should agree with the existing calibrated model');
  assert.ok(meanM < 15, `5 m/s must not predict tens of metres, got ${meanM.toFixed(1)} m`);
});

t('predictedOffsets: stable air drifts further sideways than convective', () => {
  const t0 = Date.parse('2026-08-24T07:00:00Z');
  const trail = [];
  for (let i = 0; i < 12; i++) trail.push({ lat: WELLS.lat, lon: WELLS.lon + i * 1e-4, t: t0 + i * 30000 });
  const wx = { wind_speed: 5, wind_direction: 270 };
  const worked = t0 + 3600e3;
  const mean = (st) => {
    const o = predictedOffsets(FLAT, trail, wx, st, worked);
    return o.reduce((a, p) => a + p.metres, 0) / o.length;
  };
  assert.ok(mean(INVERSION) > mean(NEUTRAL), 'a lid on the air keeps scent drifting sideways');
  assert.ok(mean(CONVECT) < mean(NEUTRAL), 'convection lifts it out of the working layer');
});

t('ScentSim.append: laying live adds ground without disturbing what is there', () => {
  /* Laying a trail live delivers points one fix at a time. Reseeding on each
     one would reset every particle's phase and make the plume flicker, so this
     pins that existing particles survive untouched. */
  const t0 = Date.parse('2026-08-24T07:00:00Z');
  const leg = (n, from) => Array.from({ length: n }, (_, i) => ({
    lat: WELLS.lat, lon: WELLS.lon + (from + i) * 2e-4, t: t0 + (from + i) * 30000,
  }));

  const sim = new ScentSim().seed(leg(4, 0));
  const first = sim.parts.length;
  const snapshot = sim.parts.slice(0, first).map(p => ({ ...p }));

  sim.append(leg(3, 4));
  assert.ok(sim.parts.length > first, 'new ground adds particles');
  assert.equal(sim.trail.length, 7, 'and joins the trail');

  for (let i = 0; i < first; i++) {
    assert.equal(sim.parts[i].phase, snapshot[i].phase, 'existing phase is untouched');
    assert.equal(sim.parts[i].born, snapshot[i].born, 'existing birth time is untouched');
    assert.equal(sim.parts[i].hlat, snapshot[i].hlat, 'existing source is untouched');
  }

  // Appending to a fresh sim must behave the same as seeding it.
  const a = new ScentSim().seed(leg(5, 0)).parts.length;
  const b = new ScentSim().seed([]).append(leg(5, 0)).parts.length;
  assert.equal(a, b, 'seed and append agree');
  assert.equal(new ScentSim().seed(leg(2, 0)).append(null).trail.length, 2, 'null append is safe');
});

t('ScentSim: seeds from a trail, fades with age, and never moves its source', () => {
  const t0 = Date.parse('2026-08-24T07:00:00Z');
  const trail = [];
  for (let i = 0; i < 8; i++) trail.push({ lat: WELLS.lat, lon: WELLS.lon + i * 2e-4, t: t0 + i * 60000 });

  const sim = new ScentSim().seed(trail);
  assert.ok(sim.parts.length > trail.length, 'several particles per trail point');

  const wx = { wind_speed: 4, wind_direction: 270, humidity: 70, soil_temp: 12 };
  sim.advance(FLAT, wx, NEUTRAL, t0 + 10 * 60000);
  const early = sim.visible().length;
  const src = { lat: sim.parts[0].hlat, lon: sim.parts[0].hlon };

  sim.advance(FLAT, wx, NEUTRAL, t0 + 400 * 60000);
  assert.ok(sim.visible().length < early, 'an old trail has less workable scent on it');
  assert.equal(sim.parts[0].hlat, src.lat, 'the ground source never moves');
  assert.equal(sim.parts[0].hlon, src.lon, 'the ground source never moves');

  sim.advance(FLAT, wx, NEUTRAL, t0 - 60000);
  assert.equal(sim.visible().length, 0, 'no scent before the runner walked past');
});

console.log(`\n${pass} passed total`);
