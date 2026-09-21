/* Buildings as walls: scent at nose height goes round them, never through,
   and nothing a building does can reach the grading. */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { wallIndex, wallAt, blockStep, leeFactor, bandInWalls } from '../public/walls.js';
import { driftFrom, ScentSim } from '../public/sim.js';
import { buildGround } from '../public/ground.js';
import { FLAT, stability } from '../public/field.js';
import { PV, resetParams, setParam, applyPreset, presetById, DEFAULTS, dialById } from '../public/params.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log(`  ok  ${name}`); };

/* Metres east (x) and north (y) of a fixed spot, to lat/lon and back. */
const REF = { lat: 51.2, lon: -2.6 };
const KX = 111320 * Math.cos((REF.lat * Math.PI) / 180);
const at = (x, y) => ({ lat: REF.lat + y / 111320, lon: REF.lon + x / KX });
const xy = (p) => [(p.lon - REF.lon) * KX, (p.lat - REF.lat) * 111320];
const box = (x0, y0, x1, y1, h = null) => ({
  rings: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]].map(([x, y]) => { const p = at(x, y); return [p.lon, p.lat]; })],
  h,
});

/* A 20 m square house, and the wind blowing from the west, towards it. */
const house = () => wallIndex([box(0, 0, 20, 20)], REF);
const wx = { wind_speed: 6, wind_direction: 270, wind_gusts: 6, temp: 12, soil_temp: 12 };
const st = stability(wx.soil_temp, wx.temp);

t('building outlines become walls, and a point knows which one it is in', () => {
  const W = wallIndex([box(0, 0, 20, 20), box(40, 0, 60, 20)], REF);
  assert.equal(W.walls.length, 2);
  assert.equal(wallAt(W, at(10, 10)), 0);
  assert.equal(wallAt(W, at(50, 10)), 1);
  assert.equal(wallAt(W, at(30, 10)), -1, 'the gap between them is open');
  assert.equal(wallIndex([], REF), null);
  assert.equal(wallIndex([{ rings: [[[0, 0], [0, 0]]] }], REF), null, 'a degenerate outline is not a wall');

  /* A courtyard: the ring with a hole in it is open ground in the middle. */
  const yard = { rings: [box(0, 0, 30, 30).rings[0], box(10, 10, 20, 20).rings[0]] };
  const Y = wallIndex([yard], REF);
  assert.equal(wallAt(Y, at(5, 5)), 0);
  assert.equal(wallAt(Y, at(15, 15)), -1, 'the courtyard is open');
});

t('a step into a wall stops short of it, and a glancing one slides along it and round the corner', () => {
  const W = house();
  const square = blockStep(W, at(-10, 10), at(30, 10));
  assert.equal(wallAt(W, square), -1, 'never inside');
  assert.ok(xy(square)[0] < 0, 'stopped on the near side of the wall');

  /* Heading north-east into the west wall: it slides north, past the corner. */
  const glance = blockStep(W, at(-10, 5), at(30, 25));
  const [gx, gy] = xy(glance);
  assert.equal(wallAt(W, glance), -1);
  assert.ok(gx < 0.5, 'still west of the wall');
  assert.ok(gy > 20, `slid along the wall and past the corner (y ${gy.toFixed(1)})`);
});

t('a thin building cannot be jumped in one long step', () => {
  const W = wallIndex([box(0, 0, 3, 20)], REF);          // a 3 m deep wing
  const p = blockStep(W, at(-10, 10), at(13, 10));        // one 23 m step clean across it
  assert.ok(xy(p)[0] < 0, 'stopped at the near wall instead of tunnelling through');
});

t('a head-on hit splits towards the nearer end of the building, it is not pinned to the wall', () => {
  const W = house();
  const south = blockStep(W, at(-0.5, 5), at(9.5, 5));    // square on, south of the middle
  const north = blockStep(W, at(-0.5, 15), at(9.5, 15));  // square on, north of the middle
  assert.ok(xy(south)[1] < 5 - 1, 'the southern half goes south');
  assert.ok(xy(north)[1] > 15 + 1, 'the northern half goes north');
  assert.equal(wallAt(W, south), -1);
  assert.equal(wallAt(W, north), -1);
});

t('a slide into the neighbour in a terrace stops at that wall too', () => {
  /* The house, and another building diagonally below-left sharing its corner. */
  const W = wallIndex([box(0, 0, 20, 20), box(-20, -20, 0, 0)], REF);
  const p = blockStep(W, at(-10, 10), at(10, -2));
  assert.equal(wallAt(W, p), -1, 'not inside either building');
});

t('the building a trail point sits inside does not trap its own scent', () => {
  const W = house();
  const inside = at(10, 10);
  const skip = wallAt(W, inside);
  assert.equal(skip, 0);
  const p = blockStep(W, inside, at(40, 10), skip);
  assert.ok(Math.abs(xy(p)[0] - 40) < 0.01, 'GPS against a wall is not a reason to lose the scent');
});

t('drifting scent goes round a building instead of through it', () => {
  resetParams();
  const W = house();
  const open = driftFrom(FLAT, at(-10, 5), 30, wx, st);
  const walled = driftFrom(FLAT, at(-10, 5), 30, wx, st, 5, W);
  assert.ok(xy(open)[0] > 20, 'with no buildings it goes straight through, as before');
  assert.equal(wallAt(W, walled), -1);
  const [x, y] = xy(walled);
  assert.ok(y < 0, `it went round the south side (y ${y.toFixed(1)})`);
  assert.ok(x > 0, `and kept going downwind past the front of the house (x ${x.toFixed(1)})`);
  assert.deepEqual(driftFrom(FLAT, at(-10, 5), 30, wx, st, 5, null), open, 'no walls is exactly the old answer');
});

t('a cloud of scent upwind of a house has nothing inside the house', () => {
  resetParams();
  const W = house();
  const trail = [0, 4, 8, 12, 16, 20].map((y, i) => ({ ...at(-8, y), t: i * 1000 }));
  const count = (walls) => {
    const sim = new ScentSim().seed(trail);
    sim.walls = walls;
    sim.advance(FLAT, wx, st, 120000);
    return sim.parts.filter(p => wallAt(W, p) >= 0).length;
  };
  assert.ok(count(null) > 0, 'with no walls some of the cloud sits inside the house');
  assert.equal(count(W), 0, 'with walls none of it does');
});

t('THE GRADING NEVER SEES A BUILDING: predictedOffsets calls driftFrom without walls', () => {
  const src = readFileSync(new URL('../public/sim.js', import.meta.url), 'utf8');
  const start = src.indexOf('export function predictedOffsets');
  assert.ok(start > 0);
  const body = src.slice(start, src.indexOf('\n}\n', start));
  const calls = [...body.matchAll(/driftFrom\(([^;]*?)\);/g)].map(m => m[1].split(',').length);
  assert.ok(calls.length >= 1, 'it still drifts');
  for (const n of calls) assert.equal(n, 5, 'five arguments: no steps, no walls');
  assert.ok(!/walls/i.test(body), 'the word does not appear in the grading at all');
});

t('the pocket behind a building ships switched off', () => {
  resetParams();
  assert.equal(DEFAULTS.wakeSlow, 1, 'no shelter by default');
  assert.equal(leeFactor(house(), at(21, 10), 90, PV.wakeLen, PV.wakeSlow, PV.wakeH), 1);
  for (const id of ['wallSlide', 'wakeSlow', 'wakeLen', 'wakeH']) {
    assert.equal(dialById(id).prov, 'guess', `${id} is marked as a guess`);
  }
});

t('with the pocket on, only the air just downwind of the building slows', () => {
  const W = house();                        // no height on the map, so hDef (6 m) is used
  const f = (x, y) => leeFactor(W, at(x, y), 90, 2, 0.3, 6);   // air going east
  assert.ok(Math.abs(f(21, 10) - (0.3 + 0.7 / 144)) < 1e-9, 'right against the downwind wall');
  assert.ok(f(26, 10) > f(21, 10), 'recovering further out');
  assert.equal(f(33, 10), 1, 'past two building heights (12 m) it is open air');
  assert.equal(f(-5, 10), 1, 'upwind is untouched');
  assert.equal(f(25, 30), 1, 'beside the pocket, out of the building’s shadow, is untouched');

  const tall = wallIndex([box(0, 0, 20, 20, 10)], REF);         // the map says 10 m
  assert.ok(leeFactor(tall, at(35, 10), 90, 2, 0.3, 6) < 1, 'a taller building throws a longer pocket');
});

t('the building-wake experiment slows drifting scent behind the house', () => {
  const W = house();
  const behind = at(21, 10);
  try {
    resetParams();
    const off = driftFrom(FLAT, behind, 20, wx, st, 5, W);
    assert.equal(applyPreset('wakeRule'), true);
    assert.equal(presetById('wakeRule').set.wakeSlow, 0.3);
    const on = driftFrom(FLAT, behind, 20, wx, st, 5, W);
    const far = (p) => xy(p)[0] - 21;
    assert.ok(far(on) < far(off) * 0.8, `it lingers: ${far(on).toFixed(1)} m against ${far(off).toFixed(1)} m`);
  } finally { resetParams(); }
});

t('underground and raised buildings are not walls; heights come through', () => {
  const ring = box(0, 0, 10, 10).rings;
  const g = buildGround([{ kind: 'streets', box: [-3, 51, -2, 52], building: [
    { type: 3, props: { height: 9 }, geom: ring },
    { type: 3, props: { underground: 'true' }, geom: ring },
    { type: 3, props: { min_height: 4, height: 8 }, geom: ring },        // a covered passage
    { type: 3, props: {}, geom: ring },
  ] }]);
  assert.equal(g.walls.length, 2, 'the car park under the ground and the passage over it are open air');
  assert.equal(g.walls[0].h, 9);
  assert.equal(g.walls[1].h, null, 'no height on the map is no height, not a guess');
  assert.equal(g.zones.length, 4, 'all four still count as built-up surroundings');
});

t('where the band runs through a building is found, not hidden', () => {
  const W = house();
  const field = [-10, -5, 2, 8, 14, 25, 30].map(x => ({ centre: at(x, 10) }));
  const r = bandInWalls(W, field);
  assert.equal(r.count, 1);
  assert.equal(r.pieces.length, 1);
  assert.equal(r.pieces[0].length, 3, 'the three centre points inside the house');
  assert.deepEqual(bandInWalls(null, field), { count: 0, pieces: [] });
});

console.log(`\n${pass} passed total\n`);
