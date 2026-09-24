import assert from 'node:assert/strict';
import {
  dist, project, pathLen, cardinal, driftMetres, driftPolygon, meanOffset, filterFixes, densify, timestamps, crossTrackSigned, signedOffsets, meanSigned, sideOfDrift, sideAgreement, lineCorrect, dwellFold, foldFixes, departure, progressAlong, splitLine, smoothBearing, fmtDist, fmtShort, fmtSpeed, fmtTemp, timestampsEndingAt, fmtWeight, kgToShown, shownToKg, fmtCoord, medianAbs, sideShares,
} from '../public/geo.js';

import { stepPoints, dist as distM, contamTimed, CONTAM_GAP, trailFrom, walkedOfTrail, gpsTrouble } from '../public/geo.js';

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
  bearing, windRegime, scentOffset, plumeWidth, scentField, plumePolygon, legSummary, approachToWind,
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

t('approachToWind: heading toward where the wind comes from is into the wind', () => {
  /* It was back to front: a dog heading west into a westerly was written up
     as "coming with the wind". */
  assert.equal(approachToWind(270, 270), 'into the wind', 'nose to a westerly');
  assert.equal(approachToWind(90, 270), 'with the wind', 'the westerly behind it');
  assert.equal(approachToWind(0, 270), 'across the wind');
  assert.equal(approachToWind(350, 20), 'into the wind', 'wraps across north');
  assert.equal(approachToWind(10, null), null, 'no wind recorded, no word');
  assert.equal(approachToWind(null, 270), null);
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


t('crossTrackSigned: right of travel is +, left is −, on the line is 0', () => {
  const a = WELLS, b = project(a, 0, 200);         // travel due north
  const right = project(project(a, 0, 100), 90, 12);
  const left  = project(project(a, 0, 100), 270, 12);
  near(crossTrackSigned(a, b, right).signed, 12, 0.2, 'east of a northbound leg is right');
  near(crossTrackSigned(a, b, left).signed, -12, 0.2, 'west of it is left');
  near(crossTrackSigned(a, b, project(a, 0, 60)).signed, 0, 0.2, 'on the line');
  assert.equal(crossTrackSigned(a, a, right).signed, 0, 'a degenerate segment has no side');
});

t('signedOffsets: a dog held right of an L-shaped trail reads + all the way', () => {
  const a = WELLS, b = project(a, 0, 300), c = project(b, 90, 300);
  const trail = [a, b, c];
  // Walk beside the trail, 10 m to its right, along both legs.
  const track = [];
  for (let m = 20; m < 300; m += 40) track.push(project(project(a, 0, m), 90, 10));
  for (let m = 20; m < 300; m += 40) track.push(project(project(b, 90, m), 180, 10));
  const offs = signedOffsets(trail, track);
  assert.ok(offs.every(o => o > 0), `all right of the line: ${offs.map(o => o.toFixed(1))}`);
  near(meanSigned(offs), 10, 1.2, 'mean signed offset');
  assert.deepEqual(signedOffsets([a], track), [], 'one point is not a trail');
  assert.equal(meanSigned([]), null, 'no fixes, no mean');
});

t('sideOfDrift: crosswind picks a side, head- and tailwind refuse to', () => {
  assert.equal(sideOfDrift(0, 90), 1, 'drift east of northbound travel is right');
  assert.equal(sideOfDrift(0, 270), -1, 'drift west is left');
  assert.equal(sideOfDrift(0, 5), 0, 'nearly along: no side');
  assert.equal(sideOfDrift(0, 176), 0, 'nearly against: no side');
  assert.equal(sideOfDrift(350, 80), 1, 'wraps across north');
});

t('sideAgreement: scores decisive fixes only, and never fakes a score', () => {
  near(sideAgreement([5, 8, 3, -4, 6], 1), 0.8, 0.01, 'four of five on the predicted side');
  assert.equal(sideAgreement([0.4, -0.9, 1.0], 1), null, 'all inside the dead zone say nothing');
  assert.equal(sideAgreement([5, 6], 0), null, 'no predicted side, no score');
  near(sideAgreement([-5, -6, 2], -1), 2 / 3, 0.01, 'left predictions score too');
});

t('lineCorrect: fixes move one line-length along the heading of travel', () => {
  const track = [0, 50, 100, 150].map(m => ({ ...project(WELLS, 0, m), t: m }));
  const out = lineCorrect(track, 10);
  for (let i = 0; i < track.length; i++) {
    near(dist(track[i], out[i]), 10, 0.3, `fix ${i} projected by the line`);
    assert.ok(out[i].lat > track[i].lat, 'projected forward, i.e. north');
    assert.equal(out[i].t, track[i].t, 'timestamps ride along');
  }
  // Standing still at the end keeps the last real heading instead of inventing one.
  const still = [...track, { ...track[3] }];
  const out2 = lineCorrect(still, 10);
  near(dist(still[4], out2[4]), 10, 0.3, 'stationary fix still projects');
  assert.equal(lineCorrect(track, 0).length, 4, 'zero line is a no-op copy');
  near(dist(lineCorrect(track, 0)[1], track[1]), 0, 0.01, 'and does not move fixes');
});

/* A handler walking exactly down a 200 m trail, fixes kept 2.5 m apart, each
   off by up to a metre either side, the way GPS wanders. */
const wobble = [0.8, -0.6, 1.0, -0.2, -0.9, 0.4, 0.7, -1.0, 0.1, -0.5, 0.9, -0.8, 0.3, 0.6, -0.7, -0.1, 1.0, -0.4, 0.2, -0.9];
const onLine = (lengthM = 200, stepM = 2.5) => {
  const pts = [];
  for (let m = 0, i = 0; m <= lengthM + 1e-9; m += stepM, i++) {
    pts.push({ ...project(project(WELLS, 0, m), 90, wobble[i % wobble.length]), t: 1e12 + i * 2000, dwellS: 0 });
  }
  return pts;
};
const straightTrail = (lengthM = 200) => [WELLS, project(WELLS, 0, lengthM / 2), project(WELLS, 0, lengthM)];

t('lineCorrect: a metre of GPS wobble stays about a metre, not four', () => {
  /* The heading used to come from one kept fix to the next, 2.5 m apart, and
     be carried 10 m ahead: any sideways wobble came out four times bigger. */
  const track = onLine(), trail = straightTrail();
  const raw = signedOffsets(trail, track, { withinEnds: true });
  const offs = signedOffsets(trail, lineCorrect(track, 10), { withinEnds: true });
  assert.ok(medianAbs(raw) <= 1, 'the walk itself is within a metre');
  assert.ok(medianAbs(offs) < 1.5, `typical offset after the line: ${medianAbs(offs).toFixed(2)} m`);
  assert.ok(Math.max(...offs.filter(Number.isFinite).map(Math.abs)) < 3, 'no fix is pushed 3 m off');
  const sh = sideShares(lineCorrect(track, 10), offs);
  assert.ok(sh.on > 0.95, `on the line ${sh.on.toFixed(2)} of the time`);
});

t('lineCorrect: the start borrows the way the handler set off; too short a walk is left alone', () => {
  const track = [0, 2.5, 5, 7.5, 10, 12.5].map((m, i) => ({ ...project(WELLS, 90, m), t: i }));
  const out = lineCorrect(track, 10);
  near(bearing(track[0], out[0]), 90, 0.5, 'the first fix points east, as the walk does');
  near(dist(track[0], out[0]), 10, 0.3, 'by a line-length');
  const short = track.slice(0, 3);
  assert.deepEqual(lineCorrect(short, 10).map(p => [p.lat, p.lon]), short.map(p => [p.lat, p.lon]),
    'never a line-length from anywhere: no heading to project along');
});

t('grading: standing at the find is not time spent left or right of the line', () => {
  /* The reward at the runner folded into the last fix's dwell, and the line
     put that fix 10 m past the end, on a side picked by noise. A 90 s reward
     took a run from mostly on the line to "mostly worked one side". */
  const track = onLine(), trail = straightTrail();
  track[track.length - 1].dwellS = 90;
  const corrected = lineCorrect(track, 10);
  const offs = signedOffsets(trail, corrected, { withinEnds: true });
  const sh = sideShares(corrected, offs, { deadM: 3 });
  assert.ok(sh.on > 0.95, `on the line ${sh.on.toFixed(2)} of the time`);
  assert.ok(Math.max(sh.left, sh.right) < 0.05, 'and no side to speak of');
});

t('signedOffsets withinEnds: behind the start and past the end have no side', () => {
  const a = WELLS, b = project(a, 0, 100), c = project(b, 90, 100);
  const trail = [a, b, c];
  const beside = project(project(a, 0, 50), 90, 6);
  const behind = project(project(a, 180, 8), 90, 0.3);
  const past = project(project(c, 90, 10), 0, 0.3);
  const [x, y, z] = signedOffsets(trail, [beside, behind, past], { withinEnds: true });
  near(x, 6, 0.2, 'beside the first leg reads as usual');
  assert.ok(Number.isNaN(y), 'behind the start');
  assert.ok(Number.isNaN(z), 'past the end');
  const plain = signedOffsets(trail, [behind, past]);
  assert.ok(plain.every(Number.isFinite), 'without the option nothing changes');
  near(Math.abs(plain[1]), 10, 0.2, 'the clamped distance, mostly how far past the end');
});


t('foldFixes: standing still becomes dwell on the last point, not lost fixes', () => {
  const at = (m, t, acc = 5) => ({ ...project(WELLS, 0, m), t: t * 1000, acc });
  const fixes = [
    at(0, 0), at(10, 8),
    // Two minutes shuffling on the spot: jitter under the stillness cap.
    { ...project(project(WELLS, 0, 10), 90, 0.8), t: 68000, acc: 5 },
    { ...project(project(WELLS, 0, 10), 270, 0.9), t: 128000, acc: 5 },
    at(11, 130, 99),                  // device-poor: genuinely dropped
    at(30, 140),
  ];
  const [kept, dropped] = foldFixes(fixes, 25, 2.5);
  assert.equal(kept.length, 3, 'three real positions');
  assert.equal(dropped, 1, 'only the poor fix is dropped');
  near(kept[1].dwellS, 120, 1, 'two minutes of standing folded into the pause point');
  assert.equal(kept[0].dwellS, 0, 'walked-through points carry no dwell');
  assert.equal(kept[1]._lastSeen, undefined, 'bookkeeping does not leak into the data');
  assert.equal(dwellFold(kept[2], at(30.5, 141), 25, 2.5), 'dwell', 'the predicate agrees with the fold');
});

t('departure: the clock starts when she leaves, not when she wobbles', () => {
  // Standing at the start, GPS wandering 8 m either side of it.
  let st = null;
  for (const d of [6, 18, 9, 22, 11, 30, 14]) st = departure(st, { d, t: 1000, walked: 3, firstT: 1000 });
  assert.equal(st.atStart, true, 'she is armed — she was inside 25 m');
  assert.equal(st.offAt, 0, 'a wobble out to 30 m is not a departure');

  // Now she walks away.
  st = departure(st, { d: 44, t: 5000, walked: 44, firstT: 1000 });
  assert.equal(st.offAt, 5000, 'the clock starts at the fix that cleared 40 m');

  // And it happens exactly once, even as she carries on.
  st = departure(st, { d: 300, t: 9000, walked: 300, firstT: 1000 });
  assert.equal(st.offAt, 5000, 'the departure does not move once it has happened');
});

t('departure: a start she never stood near still starts the clock', () => {
  // Every fix 50 m from the drawn A — trees, a wall, or an A drawn a bit out.
  // Without the fallback the countdown would never begin and the whole
  // session would be silently ruined.
  let st = null;
  for (const [d, walked, tt] of [[50, 0, 1000], [52, 20, 3000], [61, 45, 5000], [80, 70, 7000]]) {
    st = departure(st, { d, t: tt, walked, firstT: 1000 });
  }
  assert.equal(st.offAt, 1000, 'she is taken to have left at her first fix');

  // Short of the fallback distance it stays silent rather than guessing.
  let q = null;
  for (const [d, walked, tt] of [[50, 0, 1000], [55, 30, 3000]]) {
    q = departure(q, { d, t: tt, walked, firstT: 1000 });
  }
  assert.equal(q.offAt, 0, '30 m of walking is not yet evidence of a departure');
});

t('departure: the countdown reads from the moment she left', () => {
  const st = departure({ atStart: true, offAt: 0 }, { d: 90, t: 60000, walked: 90, firstT: 0 });
  const ageMin = 20;
  assert.equal(st.offAt + ageMin * 60000 - 60000, 20 * 60000, 'zero is 20 min after she left');
  assert.ok(st.offAt + ageMin * 60000 > 60000, 'and it is in the future the moment it starts');
});

/* The layer's walk, in metres east (x) and north (y) of the drawn start. */
const KX = 111320 * Math.cos(WELLS.lat * Math.PI / 180);
const walkAt = (x, y, t) => ({ lat: WELLS.lat + y / 111320, lon: WELLS.lon + x / KX, t });
const T0 = Date.UTC(2026, 8, 20, 9);
const PLAN = [walkAt(0, 0, T0), walkAt(150, 0, T0), walkAt(300, 0, T0)];

/** Every fix at 1 Hz along `path(s)`, fed to departure as walkHud feeds it. */
function walkDeparture(path, secs) {
  const pts = [];
  let st = { atStart: false, offAt: 0 }, firedAt = null;
  for (let s = 0; s <= secs; s++) {
    const [x, y] = path(s);
    const p = walkAt(x, y, T0 + s * 1000);
    pts.push(p);
    if (st.offAt) continue;
    st = departure(st, { d: dist(p, PLAN[0]), t: p.t, ...walkedOfTrail(pts, PLAN) });
    if (st.offAt) firedAt = { s, x, y };
  }
  return { st, firedAt, pts };
}

t('departure: the walk from the car park to the start does not start the clock', () => {
  // Parked 150 m short of a start drawn behind a wall: she never gets within
  // 25 m of it (the nearest she comes is 30 m), so only the fallback can fire.
  // Before, it counted the walk to the start as trail and fired 89 m short.
  const { st, firedAt } = walkDeparture(s => [-150 + 1.3 * s, -30], 300);
  assert.ok(firedAt, 'it does fire once she is walking the trail');
  assert.ok(firedAt.x >= 55, `not before she has walked the trail itself (fired at x=${firedAt.x.toFixed(0)} m)`);
  near(st.offAt, T0 + 115000, 1000, 'and the trail is timed from when she was by the start');
});

t('departure: walking straight through the start still fires on leaving it', () => {
  const { st, firedAt } = walkDeparture(s => [-150 + 1.3 * s, 0], 300);
  assert.ok(firedAt.x > 40 && firedAt.x < 43, `the fix that clears 40 m (x=${firedAt.x.toFixed(1)})`);
  assert.equal(st.offAt, T0 + firedAt.s * 1000);
});

t('departure: wandering about behind the start is not a departure', () => {
  // 80 m of pacing up and down 30 m behind A, never along the line.
  const { st } = walkDeparture(s => [-30 - 20 * Math.abs(Math.sin(s / 10)), -30 + (s % 20)], 80);
  assert.equal(st.offAt, 0, 'no progress along the plan, no clock');
});

t('trailFrom: the walked trail starts at the start, not at the car', () => {
  const { st, pts } = walkDeparture(s => [-150 + 1.3 * s, -30], 346);
  const i = trailFrom(pts, PLAN[0], st.offAt);
  const trail = pts.slice(i);
  assert.ok(dist(trail[0], PLAN[0]) < 31, 'its first point is the one nearest the drawn start');
  near(pathLen(trail), 300, 3, 'the trail is the 300 m walked from there, without the 150 m before it');
  assert.equal(trail[0].t, st.offAt, 'and it begins when the countdown did');

  // A loop that finishes back by the start: the start is where she began it.
  const loop = [...Array(120).keys()].map(s => walkAt(-100 + 1.3 * s, 3, T0 + s * 1000))
    .concat([walkAt(60, 30, T0 + 200e3), walkAt(0, 30, T0 + 250e3), walkAt(0, 1, T0 + 280e3)]);
  const armed = departure(departure(null, { d: 3, t: T0 + 77e3, walked: 0 }), { d: 45, t: T0 + 111e3, walked: 45 });
  const j = trailFrom(loop, PLAN[0], armed.offAt);
  assert.ok(j < 120 && loop[j].t <= armed.offAt, 'not the end of the loop, which is nearer the start');
});

t('gpsTrouble: a recording that is keeping nothing says so', () => {
  const now = T0 + 600e3;
  const fix = (ago, extra = {}) => ({ lat: 51, lon: -2, t: now - ago, ...extra });
  assert.equal(gpsTrouble({ last: fix(2000), now }), null, 'fixes arriving: nothing to say');
  assert.equal(gpsTrouble({ startedAt: now - 5000, now }), null, 'the first few seconds are not a fault');
  assert.deepEqual(gpsTrouble({ startedAt: now - 20000, now }), { why: 'none', ms: 20000 }, 'no fix at all for 20 s');
  assert.equal(gpsTrouble({ startedAt: now - 3000, droppedAt: now - 1000, now }).why, 'poor',
    'every fix so far refused for accuracy: said at once');
  assert.deepEqual(gpsTrouble({ last: fix(30000), droppedAt: now - 1000, now }), { why: 'poor', ms: 30000 },
    'fixes still arriving, all of them too poor to keep');
  assert.equal(gpsTrouble({ last: fix(30000), droppedAt: now - 40000, now }).why, 'none', 'no fixes arriving at all');
  assert.equal(gpsTrouble({ last: fix(300000, { _seen: now - 2000 }), now }), null,
    'standing still is being recorded, however long ago the point was first kept');
  assert.equal(gpsTrouble({ last: fix(1000), blocked: true, now }).why, 'blocked', 'location refused outright');
});

t('progressAlong: how far in, how far left, and how far off', () => {
  // 300 m north, then 400 m east — an L, 700 m of walking.
  const L = [{ lat: 51.20, lon: -2.60 },
             { lat: 51.20 + 300 / 111320, lon: -2.60 },
             { lat: 51.20 + 300 / 111320, lon: -2.60 + 400 / (111320 * Math.cos(51.20 * Math.PI / 180)) }];
  const pr = progressAlong(L, { lat: 51.20 + 150 / 111320, lon: -2.60 });
  assert.equal(pr.i, 1, 'halfway up the first leg');
  assert.ok(Math.abs(pr.along - 150) < 3, `150 m in, got ${pr.along.toFixed(1)}`);
  assert.ok(Math.abs(pr.remaining - 550) < 4, `550 m left, got ${pr.remaining.toFixed(1)}`);
  assert.ok(pr.off < 1, 'standing on the line reads as on it');

  // Twenty metres to the side of the same spot.
  const off = progressAlong(L, { lat: 51.20 + 150 / 111320, lon: -2.60 + 20 / (111320 * Math.cos(51.20 * Math.PI / 180)) });
  assert.ok(Math.abs(off.off - 20) < 1.5, `20 m off the line, got ${off.off.toFixed(1)}`);
  assert.ok(Math.abs(off.along - 150) < 3, 'being off to the side does not change how far along you are');

  assert.equal(progressAlong([], { lat: 0, lon: 0 }), null, 'no line, no progress');
});

t('splitLine: behind and ahead meet exactly where you stand', () => {
  const L = [{ lat: 51.20, lon: -2.60 },
             { lat: 51.20 + 300 / 111320, lon: -2.60 },
             { lat: 51.20 + 300 / 111320, lon: -2.59 }];
  const me = { lat: 51.20 + 150 / 111320, lon: -2.60 };
  const [behind, ahead] = splitLine(L, me);
  assert.deepEqual(behind[behind.length - 1], ahead[0], 'the cut is one point, shared');
  assert.ok(Math.abs(pathLen(behind) + pathLen(ahead) - pathLen(L)) < 1,
    'the two halves still add up to the whole route');
  assert.ok(pathLen(behind) > 140 && pathLen(behind) < 160, 'behind is the 150 m walked');
  assert.equal(behind.length, 2);
  assert.equal(ahead.length, 3, 'ahead keeps the corner it has not reached yet');
});

t('smoothBearing: crosses north the short way, never spins', () => {
  // 350° to 10° is 20° clockwise through north, not 340° back through south.
  const b = smoothBearing(350, 10, 0.5);
  assert.ok(b >= 359 || b <= 1, `expected to land near 0, got ${b}`);

  // It damps: one jumpy fix moves the heading a fraction of the way.
  const damped = smoothBearing(0, 90, 0.25);
  assert.ok(Math.abs(damped - 22.5) < 0.01, `a quarter of the turn, got ${damped}`);

  assert.equal(smoothBearing(null, 42, 0.3), 42, 'the first heading is taken whole');
  assert.equal(smoothBearing(42, null, 0.3), 42, 'a fix with no course leaves it alone');
  assert.equal(smoothBearing(0, 370, 1), 10, 'an angle past 360 is read as the direction it means');
  assert.equal(smoothBearing(10, 370, 1), 10, 'and a heading already pointing there does not move');
});

t('densify: the new points carry the clock, or they emit nothing', () => {
  /* A densified point with no time is ground the scent model cannot age, so
     it contributes no scent at all — and a plume drawn from it beads back at
     the original fixes instead of running continuously along the line. */
  const a = { lat: 51.20, lon: -2.60, t: 1000 };
  const b = { lat: 51.20 + 100 / 111320, lon: -2.60, t: 101000 };   // 100 m, 100 s
  const out = densify([a, b], 10);

  assert.ok(out.length >= 10, `expected ~11 points, got ${out.length}`);
  assert.ok(out.every(p => Number.isFinite(p.t)), 'every point has a time');
  for (let i = 1; i < out.length; i++) {
    assert.ok(out[i].t > out[i - 1].t, 'and the times only ever go forward');
  }
  assert.equal(out[0].t, 1000, 'the first point is untouched');
  assert.equal(out[out.length - 1].t, 101000, 'and so is the last');
  // Halfway along 100 m at a steady pace is halfway through the 100 s.
  const mid = out[Math.floor(out.length / 2)];
  assert.ok(Math.abs(mid.t - 51000) < 6000, `midpoint near 51 s, got ${mid.t}`);

  // A path with no clock at all still densifies; it just has no times to carry.
  const bare = densify([{ lat: 51.20, lon: -2.60 }, { lat: 51.201, lon: -2.60 }], 20);
  assert.ok(bare.length > 2 && bare.every(p => p.t === undefined), 'no clock in, no clock out');
});

t('units: the model stays in metres, the edge speaks the handler\u2019s language', () => {
  // Metric: the unit changes with the scale, because a 4 km trail in metres
  // is a number nobody reads.
  assert.equal(fmtDist(274), '274 m');
  assert.equal(fmtDist(1240), '1.2 km');
  assert.equal(fmtDist(14800), '15 km', 'past ten, the decimal is noise');

  // Imperial: yards up close, miles once it is a distance you would drive.
  assert.equal(fmtDist(274, true), '300 yd');
  assert.equal(fmtDist(1609.34, true), '1.0 mi');
  assert.equal(fmtDist(100, true), '109 yd');
  assert.equal(fmtDist(332, true), '363 yd', 'a third of a kilometre is yards you can pace, not "0.2 mi"');
  assert.equal(fmtDist(700, true), '766 yd');
  assert.equal(fmtDist(805, true), '0.5 mi', 'half a mile is where it switches');
  assert.equal(fmtDist(24140, true), '15 mi');

  // Short measures never change unit: they are read against each other.
  assert.equal(fmtShort(9.2, false, 1), '9.2 m');
  assert.equal(fmtShort(9.2, true, 1), '30.2 ft');
  assert.equal(fmtShort(10, true), '33 ft');

  // Wind comes out of the forecast in m/s.
  assert.equal(fmtSpeed(2.2), '8 km/h');
  assert.equal(fmtSpeed(2.2, true), '5 mph');

  assert.equal(fmtTemp(12), '12 \u00b0C');
  assert.equal(fmtTemp(12, true), '54 \u00b0F');

  // Nothing is ever rendered as NaN.
  for (const f of [fmtDist, fmtShort, fmtSpeed, fmtTemp]) {
    assert.equal(f(null), '—');
    assert.equal(f(undefined, true), '—');
  }
});

t('timestampsEndingAt: a drawn trail has just been laid, not just begun', () => {
  /* Anchored at the start, most of a drawn line sits in the FUTURE — ground
     with no scent on it yet — so the plume materialises along the trail at
     walking pace. Anchored at the end, the whole line is already laid, the
     start is its oldest ground, and the layer is standing at the far end. */
  const now = 1_700_000_000_000;
  const line = densify([{ lat: 51.20, lon: -2.60 },
                        { lat: 51.20 + 500 / 111320, lon: -2.60 }], 5);
  const pts = timestampsEndingAt(line, now, 1.3);

  assert.equal(pts.length, line.length);
  assert.ok(pts.every(p => p.t <= now), 'not one point is in the future');
  assert.ok(Math.abs(pts[pts.length - 1].t - now) < 1500, 'the trail finishes now');

  // 500 m at 1.3 m/s is about 385 s of walking, and the start is that old.
  const spanS = (pts[pts.length - 1].t - pts[0].t) / 1000;
  assert.ok(Math.abs(spanS - 385) < 20, `the walk took about 385 s, got ${spanS.toFixed(0)}`);
  assert.ok(pts[0].t < pts[Math.floor(pts.length / 2)].t, 'and it ages from the start');

  // Compare against the old behaviour, which is what caused the creep.
  const fromStart = timestamps(line, now, 1.3);
  assert.ok(fromStart.filter(p => p.t > now).length > line.length * 0.9,
    'anchored at the start, almost the whole line would be in the future');

  assert.deepEqual(timestampsEndingAt([], now), []);
});

t('weight: kept in kilograms, shown in whichever the handler reads', () => {
  assert.equal(fmtWeight(30), '30.0 kg');
  assert.equal(fmtWeight(30, true), '66.1 lb');
  assert.equal(fmtWeight(0), '—', 'an unrecorded weight is not zero kilograms');
  assert.equal(fmtWeight(null, true), '—');

  // A number typed in pounds comes back as the same number in pounds.
  const kg = shownToKg(66.1, true);
  assert.ok(Math.abs(kgToShown(kg, true) - 66.1) < 0.01);
  assert.equal(kgToShown(30, false), 30, 'metric is stored exactly as typed');
  assert.equal(shownToKg(null, true), null);
});

t('fmtCoord: decimal or degrees-minutes-seconds, both pasteable', () => {
  // Wells: five decimals is about a metre, as honest as a phone gets.
  assert.equal(fmtCoord(51.2094, -2.6449, 'dd'), '51.20940, -2.64490');
  assert.equal(fmtCoord(51.2094, -2.6449, 'dms'), `51°12'33.8"N 2°38'41.6"W`);

  // Hemispheres follow the sign, and the sign is dropped from the numbers.
  assert.equal(fmtCoord(-33.8568, 151.2153, 'dms'), `33°51'24.5"S 151°12'55.1"E`);

  // Rounding carries rather than printing an impossible 60 seconds.
  const edge = fmtCoord(51.99999999, 0.5, 'dms');
  assert.ok(edge.startsWith(`52°00'00.0"N`), `carried to the next degree, got ${edge}`);
  assert.ok(!/60\.0"/.test(edge), 'never 60 seconds');

  // Nothing to show beats a wrong place.
  assert.equal(fmtCoord(null, 0), '—');
  assert.equal(fmtCoord(91, 0), '—');
  assert.equal(fmtCoord(0, 181, 'dms'), '—');
});

t('medianAbs: a dog casting both sides cannot average to "held the line"', () => {
  assert.equal(medianAbs([15, -15, 15, -15]), 15);
  assert.equal(medianAbs([1, 2, 3, 100]), 2.5);
  assert.equal(medianAbs([]), null);
  assert.equal(medianAbs([NaN, -4]), 4);
});

t('sideShares: time-weighted, dead zone counts as on the line, a long gap is capped', () => {
  const t0 = 1e12;
  const track = [
    { t: t0, dwellS: 0 }, { t: t0 + 1000, dwellS: 0 }, { t: t0 + 2000, dwellS: 8 },   // 1 s, 1 s, 1+8 s
    { t: t0 + 3000, dwellS: 0 }, { t: t0 + 60000, dwellS: 0 },                          // 57 s gap → 10 s cap, last = 1 s
  ];
  const sh = sideShares(track, [10, 10, -2, -8, -8]);
  // right: 1+1 = 2 s; on: 9 s (dwell); left: 10 (capped gap) + 1 = 11 s → total 22
  assert.ok(Math.abs(sh.right - 2 / 22) < 1e-9);
  assert.ok(Math.abs(sh.on - 9 / 22) < 1e-9);
  assert.ok(Math.abs(sh.left - 11 / 22) < 1e-9);
  assert.equal(sideShares(track, [1, 2]), null, 'lengths must match');
  assert.equal(sideShares([], []), null);
});

t('sideShares: a fix with no offset weighs nothing, and the last fix’s dwell is not work', () => {
  const t0 = 1e12;
  const track = [
    { t: t0, dwellS: 0 }, { t: t0 + 2000, dwellS: 0 }, { t: t0 + 4000, dwellS: 0 }, { t: t0 + 6000, dwellS: 90 },
  ];
  // 2 s right, 2 s on, then 2 s and a 90 s stand past the end of the trail.
  const sh = sideShares(track, [5, 1, NaN, NaN]);
  assert.ok(Math.abs(sh.right - 0.5) < 1e-9 && Math.abs(sh.on - 0.5) < 1e-9, JSON.stringify(sh));
  // Beside the line, the last fix still counts, but for its second, not its 90 s.
  const end = sideShares(track, [5, 1, 1, -5]);
  assert.ok(Math.abs(end.left - 1 / 7) < 1e-9, `the stand is left out: ${end.left}`);
  assert.equal(sideShares(track, [NaN, NaN, NaN, NaN]), null, 'nothing beside the trail, nothing to share');
  near(meanSigned([4, NaN, -2]), 1, 1e-9, 'the mean skips them too');
  assert.equal(meanSigned([NaN]), null);
});

t('stepPoints: a print every stride along the track, the bearing of travel on each', () => {
  // 30 m due east, then 12 m due north, from Wells
  const a = { lat: 51.2094, lon: -2.6449 };
  const east = { lat: a.lat, lon: a.lon + 30 / (111320 * Math.cos(a.lat * Math.PI / 180)) };
  const north = { lat: east.lat + 12 / 111320, lon: east.lon };
  const s = stepPoints([a, east, north], 3);
  assert.ok(s.length >= 14 && s.length <= 15, `about 14 prints over 42 m, got ${s.length}`);
  assert.ok(s.every((p, k) => p.i === k), 'indices run in order');
  assert.ok(distM(s[0], a) < 0.01, 'the first print is on the start');
  for (let k = 1; k < s.length; k++) {
    if (s[k].b === s[k - 1].b) assert.ok(Math.abs(distM(s[k - 1], s[k]) - 3) < 0.05, `stride ${k}`);
  }
  assert.ok(Math.abs(s[0].b - 90) < 1, 'east first');
  const last = s[s.length - 1].b;
  assert.ok(Math.min(last, 360 - last) < 1, 'north last');
  assert.ok(distM(s[s.length - 1], north) <= 3.01, 'the last print is within a stride of the end');
  assert.deepEqual(stepPoints([a], 3), []);
  assert.deepEqual(stepPoints(null, 3), []);
});

/* Contamination is timed from the main trail: the handler picks before or after, not a clock. */
{
  const T0 = Date.UTC(2026, 8, 22, 9, 0);
  const main = timestamps(densify([WELLS, project(WELLS, 90, 300)], 5), T0, 1.3);
  const tEnd = main[main.length - 1].t;
  const cross = [project(WELLS, 0, 80), project(project(WELLS, 90, 150), 180, 80)];

  t('contamination laid before is finished before the main trail starts', () => {
    const c = contamTimed(main, cross, 'before', tEnd + 20 * 60e3);
    assert.ok(c.length > 2);
    assert.equal(c[c.length - 1].t, T0 - CONTAM_GAP, 'it ends the gap before the main trail begins');
    assert.ok(c.every((p, i) => !i || p.t > c[i - 1].t), 'walked in order');
  });

  t('contamination laid after starts once the main trail ends, and is fresher', () => {
    const later = contamTimed(main, cross, 'after', tEnd + 60 * 60e3);
    assert.equal(later[0].t, tEnd + 60e3, 'long after: a minute after the main trail ends');
    const soon = contamTimed(main, cross, 'after', tEnd + 30e3);
    assert.equal(soon[0].t, tEnd, 'straight after: never before the main trail ends');
    for (const c of [later, soon]) assert.ok(c[0].t >= tEnd && c[0].t > main[0].t);
  });

  t('contamination with no main trail times falls back to now, and a single tap is no trail', () => {
    const now = T0 + 5 * 60e3;
    const c = contamTimed([{ lat: 51.2, lon: -2.6 }], cross, 'before', now);
    assert.equal(c[c.length - 1].t, now - CONTAM_GAP);
    assert.deepEqual(contamTimed(main, [cross[0]], 'after', now), []);
  });
}

console.log(`\n${pass} passed total\n`);
