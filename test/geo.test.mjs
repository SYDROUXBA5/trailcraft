import assert from 'node:assert/strict';
import {
  dist, project, pathLen, cardinal, driftMetres, driftPolygon, meanOffset, filterFixes,
  densify, timestamps,
} from '../public/geo.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log(`  ok  ${name}`); };
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

const WELLS = { lat: 51.2094, lon: -2.6449 };

t('dist: zero for identical points', () => {
  assert.equal(dist(WELLS, { ...WELLS }), 0);
});

t('dist: one degree of latitude is ~111.2 km', () => {
  near(dist({ lat: 51, lon: 0 }, { lat: 52, lon: 0 }), 111195, 200, 'lat degree');
});

t('project: round-trips to the requested distance', () => {
  for (const brg of [0, 45, 90, 180, 271, 359]) {
    near(dist(WELLS, project(WELLS, brg, 100)), 100, 0.5, `bearing ${brg}`);
  }
});

t('project: north increases latitude, east increases longitude', () => {
  assert.ok(project(WELLS, 0, 500).lat > WELLS.lat);
  assert.ok(project(WELLS, 90, 500).lon > WELLS.lon);
  assert.ok(project(WELLS, 180, 500).lat < WELLS.lat);
});

t('pathLen: sums leg by leg', () => {
  const a = WELLS, b = project(a, 90, 300), c = project(b, 0, 400);
  near(pathLen([a, b, c]), 700, 1, 'path length');
});

t('pathLen: degenerate inputs are zero, not NaN', () => {
  assert.equal(pathLen([]), 0);
  assert.equal(pathLen([WELLS]), 0);
});

t('cardinal: compass boxes map correctly', () => {
  assert.equal(cardinal(0), 'N');
  assert.equal(cardinal(90), 'E');
  assert.equal(cardinal(180), 'S');
  assert.equal(cardinal(270), 'W');
  assert.equal(cardinal(360), 'N');   // wraps
  assert.equal(cardinal(45), 'NE');
});

t('driftMetres: grows with age and wind, and is capped', () => {
  assert.ok(driftMetres(3, 2) > driftMetres(3, 0.5), 'older drifts further');
  assert.ok(driftMetres(6, 1) > driftMetres(2, 1), 'windier drifts further');
  assert.ok(driftMetres(40, 12) <= 120, 'capped at 120 m');
  assert.ok(driftMetres(0, 5) === 0, 'no wind, no drift');
});

t('driftPolygon: offsets downwind, not upwind', () => {
  const now = Date.now();
  const trail = [
    { ...WELLS, t: now - 3.6e6 },
    { ...project(WELLS, 90, 200), t: now },
  ];
  // Wind FROM the north (0°) must push scent TOWARD the south.
  const poly = driftPolygon(trail, { wind_speed: 4, wind_direction: 0 });
  const ring = poly.features[0].geometry.coordinates[0];
  const offsetLats = ring.slice(trail.length, trail.length * 2).map(c => c[1]);
  assert.ok(Math.min(...offsetLats) < WELLS.lat, 'drifted south');
});

t('driftPolygon: closed ring, degenerate input safe', () => {
  const now = Date.now();
  const trail = [{ ...WELLS, t: now - 1e6 }, { ...project(WELLS, 45, 150), t: now }];
  const ring = driftPolygon(trail, { wind_speed: 3, wind_direction: 200 })
    .features[0].geometry.coordinates[0];
  assert.deepEqual(ring[0], ring[ring.length - 1], 'ring is closed');
  assert.equal(driftPolygon([], { wind_speed: 3 }).features.length, 0);
  assert.equal(driftPolygon(trail, null).features.length, 0);
});

t('meanOffset: identical paths offset by zero', () => {
  const p = [WELLS, project(WELLS, 90, 100), project(WELLS, 90, 200)];
  near(meanOffset(p, p), 0, 0.001, 'identical');
  assert.equal(meanOffset([], p), null);
});

t('meanOffset: parallel path offset by its separation', () => {
  const runner = [WELLS, project(WELLS, 90, 500)];
  const dog = runner.map(p => project(p, 0, 12));   // 12 m north throughout
  near(meanOffset(runner, dog), 12, 0.5, 'parallel offset');
});

t('filterFixes: rejects fixes worse than the accuracy cap', () => {
  const now = Date.now();
  const [kept, rej] = filterFixes([
    { ...WELLS, acc: 8, t: now },
    { ...project(WELLS, 90, 50), acc: 90, t: now + 1000 },   // too inaccurate
    { ...project(WELLS, 90, 100), acc: 9, t: now + 2000 },
  ], 25, 2.5);
  assert.equal(kept.length, 2);
  assert.equal(rej, 1);
});

t('filterFixes: suppresses stationary jitter', () => {
  const now = Date.now();
  // Ten fixes wobbling inside a 1.5 m circle — a handler standing still.
  const jitter = Array.from({ length: 10 }, (_, i) => ({
    ...project(WELLS, i * 36, 1.5), acc: 6, t: now + i * 1000,
  }));
  const [kept, rej] = filterFixes(jitter, 25, 2.5);
  assert.ok(kept.length <= 3, `jitter collapsed to ${kept.length} points`);
  assert.ok(rej >= 7, 'most jitter rejected');
});

t('filterFixes: genuine walking is preserved', () => {
  const now = Date.now();
  const walk = Array.from({ length: 20 }, (_, i) => ({
    ...project(WELLS, 90, i * 10), acc: 7, t: now + i * 1000,
  }));
  const [kept, rej] = filterFixes(walk, 25, 2.5);
  assert.equal(kept.length, 20, 'no real movement dropped');
  assert.equal(rej, 0);
});

console.log(`\n${pass} passed\n`);

/* ── Scent field ──────────────────────────────────────────────── */
import {
  bearing, windRegime, scentOffset, plumeWidth, scentField, plumePolygon, legSummary,
} from '../public/geo.js';

t('bearing: cardinal directions', () => {
  near(bearing({ lat: 51, lon: 0 }, { lat: 52, lon: 0 }), 0, 0.1, 'north');
  near(bearing({ lat: 51, lon: 0 }, { lat: 51, lon: 1 }), 90, 0.5, 'east');
});

t('windRegime: classifies against direction of travel', () => {
  // Heading north. Wind FROM the west blows toward the east — across, to the right.
  assert.equal(windRegime(0, 270).label, 'crosswind');
  assert.equal(windRegime(0, 270).side, 'right');
  assert.equal(windRegime(0, 90).side, 'left');
  assert.equal(windRegime(0, 180).label, 'tailwind');   // from behind, pushes forward
  assert.equal(windRegime(0, 0).label, 'headwind');     // in the face, pushes back
});

t('windRegime: along/cross components are unit-consistent', () => {
  for (const from of [0, 37, 90, 180, 271, 359]) {
    const r = windRegime(120, from);
    near(r.along ** 2 + r.cross ** 2, 1, 1e-9, 'unit vector');
  }
});

t('scentOffset: saturates rather than growing without bound', () => {
  const oneMin = scentOffset(5, 60), oneHour = scentOffset(5, 3600), oneDay = scentOffset(5, 86400);
  assert.ok(oneHour > oneMin, 'grows early');
  near(oneHour, oneDay, 0.25, 'within 2.5% of settled by an hour');
  assert.ok(oneHour / oneDay > 0.97, 'mostly settled by an hour');
  assert.ok(oneDay <= 60, 'capped');
  assert.equal(scentOffset(0, 3600), 0, 'no wind, no offset');
});

t('plumeWidth: uncertainty grows with age', () => {
  assert.ok(plumeWidth(3600, 5) > plumeWidth(60, 5), 'older is wider');
  assert.ok(plumeWidth(3600, 10) > plumeWidth(3600, 2), 'windier is wider');
});

t('scentField: crosswind pushes the workable line to the correct side', () => {
  const now = Date.now();
  // A trail walked due north.
  const trail = Array.from({ length: 12 }, (_, i) => ({
    ...project({ lat: 51.2, lon: -2.65 }, 0, i * 20), t: now - (12 - i) * 60000,
  }));
  // Wind FROM the west → scent pushed east, i.e. to the right of northward travel.
  const f = scentField(trail, { wind_speed: 6, wind_direction: 270 }, now);
  const mid = f[6];
  assert.equal(mid.regime.label, 'crosswind');
  assert.ok(mid.centre.lon > trail[6].lon, 'displaced east');
  assert.ok(mid.halfWidth > 0);
});

t('scentField: headwind pushes scent back down the trail', () => {
  const now = Date.now();
  const trail = Array.from({ length: 12 }, (_, i) => ({
    ...project({ lat: 51.2, lon: -2.65 }, 0, i * 20), t: now - (12 - i) * 60000,
  }));
  // Wind FROM the north, against northward travel → scent displaced south.
  const f = scentField(trail, { wind_speed: 6, wind_direction: 0 }, now);
  assert.equal(f[6].regime.label, 'headwind');
  assert.ok(f[6].centre.lat < trail[6].lat, 'displaced back toward the start');
});

t('plumePolygon: closed band, safe on degenerate input', () => {
  const now = Date.now();
  const trail = Array.from({ length: 6 }, (_, i) => ({
    ...project({ lat: 51.2, lon: -2.65 }, 45, i * 25), t: now - (6 - i) * 60000,
  }));
  const ring = plumePolygon(scentField(trail, { wind_speed: 4, wind_direction: 200 }, now))
    .features[0].geometry.coordinates[0];
  assert.deepEqual(ring[0], ring[ring.length - 1], 'closed');
  assert.equal(plumePolygon([]).features.length, 0);
  assert.equal(scentField([], { wind_speed: 3 }, now).length, 0);
});

t('legSummary: collapses a trail into readable legs', () => {
  const now = Date.now();
  const trail = Array.from({ length: 20 }, (_, i) => ({
    ...project({ lat: 51.2, lon: -2.65 }, 0, i * 20), t: now - (20 - i) * 60000,
  }));
  const legs = legSummary(scentField(trail, { wind_speed: 5, wind_direction: 270 }, now));
  assert.equal(legs.length, 1, 'one straight leg, one regime');
  assert.equal(legs[0].label, 'crosswind');
});

t('densify: fills a sparse drawn line to roughly even spacing', () => {
  const a = { lat: 51.2, lon: -2.65 };
  const corners = [a, project(a, 90, 100), project(project(a, 90, 100), 0, 60)];
  const out = densify(corners, 5);

  assert.ok(out.length > 30, `should fill in, got ${out.length} points`);
  near(pathLen(out), 160, 1, 'length is preserved');
  assert.equal(out[0].lat, a.lat, 'starts where it was drawn');
  near(dist(out[out.length - 1], corners[2]), 0, 0.5, 'and ends there too');

  for (let i = 1; i < out.length; i++) {
    assert.ok(dist(out[i - 1], out[i]) <= 6, 'no gap much wider than the spacing');
  }
});

t('densify: degenerate input comes back safely, not as a crash', () => {
  assert.deepEqual(densify([]), []);
  assert.deepEqual(densify(null), []);
  assert.equal(densify([{ lat: 51.2, lon: -2.65 }]).length, 1);
  const dup = { lat: 51.2, lon: -2.65 };
  assert.equal(densify([dup, { ...dup }]).length, 1, 'a zero-length leg adds nothing');
});

t('timestamps: a drawn trail gets a clock, paced along its own length', () => {
  const a = { lat: 51.2, lon: -2.65 };
  const pts = densify([a, project(a, 90, 390)], 5);      // 390 m
  const t0 = Date.parse('2026-08-24T08:00:00Z');
  const timed = timestamps(pts, t0, 1.3);                // 390 / 1.3 = 300 s

  assert.equal(timed[0].t, t0, 'the first step happens at the stated time');
  near((timed[timed.length - 1].t - t0) / 1000, 300, 2, 'walk time is length ÷ pace');
  for (let i = 1; i < timed.length; i++) {
    assert.ok(timed[i].t >= timed[i - 1].t, 'time only ever moves forward');
  }

  // The whole point: the start of the trail is older than the end.
  const worked = timed[timed.length - 1].t;
  assert.ok(worked - timed[0].t > worked - timed[timed.length - 1].t,
    'scent at the start has been on the ground longer');
});

t('timestamps: a slower pace makes a longer-lived trail', () => {
  const a = { lat: 51.2, lon: -2.65 };
  const pts = densify([a, project(a, 90, 300)], 5);
  const t0 = Date.now();
  const slow = timestamps(pts, t0, 0.8), fast = timestamps(pts, t0, 2.5);
  assert.ok(slow[slow.length - 1].t > fast[fast.length - 1].t, 'dawdling takes longer');
  assert.ok(timestamps(pts, t0, 0).every(p => Number.isFinite(p.t)), 'zero pace cannot divide by zero');
});

console.log(`\n${pass} passed total\n`);
