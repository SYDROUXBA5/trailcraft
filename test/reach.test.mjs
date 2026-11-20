/* Scent reach (public/reach.js): the ground a dog's nose could have had scent from.

   Checked on level ground with a wind that does not change, where the right answer can be said in a sentence:
   the reach runs upwind of the dog and nowhere else, further in more wind, and not at all in still air. */

import assert from 'node:assert/strict';
import { REACH, reachWeight, reachFrom, reachOf, reachTimes, reachCount, strideAlong } from '../public/reach.js';
import { FLAT, stability } from '../public/field.js';
import { driftFrom } from '../public/sim.js';
import { dist, project, bearing } from '../public/geo.js';

let pass = 0;
const test = (name, fn) => { fn(); pass++; console.log(`  ok  ${name}`); };

const here = { lat: 51.2, lon: -2.65 };
const air = (speed, from, gusts = speed) => ({ wind_speed: speed, wind_direction: from, wind_gusts: gusts, temp: 12, soil_temp: 12 });
const st = stability(12, 12);
const farthest = (chain, least) => chain.filter(q => q.w >= least).pop();

test('the reach runs upwind of the dog', () => {
  for (const from of [0, 90, 200, 270]) {
    const chain = reachFrom(FLAT, here, air(3, from), st);
    const end = chain[chain.length - 1];
    assert.ok(chain.length > 3, 'more than the dog itself');
    const off = Math.abs(((bearing(here, end) - from + 540) % 360) - 180);
    assert.ok(off < 2, `wind from ${from}: reach lies toward ${bearing(here, end).toFixed(0)}`);
  }
});

test('it starts at the dog at full strength and only weakens and widens', () => {
  const chain = reachFrom(FLAT, here, air(3, 270, 5), st);
  assert.equal(chain[0].w, 1);
  assert.equal(chain[0].r, REACH.nose);
  for (let i = 1; i < chain.length; i++) {
    assert.ok(chain[i].w < chain[i - 1].w, 'weaker further off');
    assert.ok(chain[i].r >= chain[i - 1].r, 'never narrower further off');
    assert.ok(dist(chain[i - 1], chain[i]) <= 1.25 * chain[i - 1].r + 0.01, 'the pieces join up');
  }
});

test('more wind reaches further, and still air reaches nowhere', () => {
  const far = (speed) => dist(here, farthest(reachFrom(FLAT, here, air(speed, 270), st), REACH.possible));
  assert.ok(far(1) < far(3) && far(3) < far(8), `${far(1).toFixed(1)} < ${far(3).toFixed(1)} < ${far(8).toFixed(1)}`);
  assert.ok(far(3) > 10 && far(3) < 40, `a moderate wind reaches tens of metres, not hundreds: ${far(3).toFixed(1)}`);
  const calm = reachFrom(FLAT, here, air(0, 0), st);
  assert.equal(calm.length, 1, 'only the ground under the nose');
  assert.equal(reachFrom(FLAT, here, null, null).length, 1, 'no weather known: the same');
});

test('it is the plume the other way round: scent from the far end of the reach lands back on the dog', () => {
  const wx = air(3, 240), chain = reachFrom(FLAT, here, wx, st);
  /* the same seconds of drift forward again, with the app's own drift */
  const end = chain[chain.length - 1];
  const sp = dist(here, end);
  const back = driftFrom(FLAT, end, sp / (dist(here, driftFrom(FLAT, here, 1, wx, st))), wx, st);
  assert.ok(dist(back, here) < 0.5, `lands ${dist(back, here).toFixed(2)} m from the dog`);
});

test('weight: all of it at the nose, less with time and with distance', () => {
  assert.equal(reachWeight(0, 0, 52), 1);
  assert.ok(reachWeight(10, 0, 52) < 1 && reachWeight(0, 10, 52) < 1);
  assert.ok(Math.abs(reachWeight(0, REACH.thin, 52) - 0.5) < 1e-9, 'halved at the distance the plume is drawn halved');
});

test('a track is walked at a steady stride, ends included, with the time carried along', () => {
  const track = [{ ...here, t: 0 }, { ...project(here, 0, 30), t: 30000 }];
  const pts = strideAlong(track);
  assert.equal(pts.length, 16);
  assert.ok(dist(pts[pts.length - 1], track[1]) < 0.01);
  assert.ok(Math.abs(pts[5].t - 10000) < 50, `10 m along is 10 s in: ${pts[5].t}`);
  assert.equal(strideAlong([]).length, 0);
  assert.equal(strideAlong([{ ...here, t: 5 }]).length, 1);
});

test('a trail upwind of the dog comes into reach as the dog passes; one downwind or far off never does', () => {
  const wx = air(3, 270, 4), track = [], near = [], far = [], lee = [];
  for (let i = 0; i <= 30; i++) {
    const q = project(here, 0, i * 2);
    track.push({ ...q, t: i * 2000 });
    near.push(project(q, 270, 6)); far.push(project(q, 270, 60)); lee.push(project(q, 90, 8));
  }
  const pieces = reachOf(FLAT, track, () => wx);
  for (let i = 1; i < pieces.length; i++) assert.ok(pieces[i].t >= pieces[i - 1].t, 'in the order walked');
  const all = (line, at = Infinity) => reachCount(reachTimes(pieces, line), at);
  assert.deepEqual(all(near), { likely: 31, possible: 31, of: 31 });
  assert.deepEqual(all(far), { likely: 0, possible: 0, of: 31 });
  assert.deepEqual(all(lee), { likely: 0, possible: 0, of: 31 });
  const half = all(near, 30000);
  assert.ok(half.likely >= 14 && half.likely <= 18, `half-way through the run, about half of it: ${half.likely}`);
  assert.equal(all(track).possible, 31, 'the ground the dog stood on is in reach');
});

test('with no wind at all the reach is only the strip the dog walked', () => {
  const track = [{ ...here, t: 0 }, { ...project(here, 0, 20), t: 20000 }];
  const pieces = reachOf(FLAT, track, () => air(0, 0));
  const at = (m) => reachCount(reachTimes(pieces, [project(project(here, 0, 10), 90, m)]), Infinity);
  assert.equal(at(1).likely, 1);
  assert.equal(at(4).possible, 0);
});

console.log(`\n${pass} passed total`);
