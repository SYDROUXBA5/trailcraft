/* The coach, checked fix by fix: quiet on the line, a single soft word at
   the edge, a clear call when the dog is off — and never a word for GPS
   noise, nor for a dog that is simply working the scent downwind. */

import assert from 'node:assert/strict';
import {
  coachStep, initialCoach, corridor, dogPosition, coachPhrase, coachLine,
  QUIET_MS, STILL_MS, PLAN_EXTRA_M,
} from '../public/coach.js';
import { scentField, project, dist } from '../public/geo.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log(`  ok  ${name}`); };

/* A trail due north, 600 m, a point every 10 m, laid an hour ago. */
const T0 = Date.parse('2026-09-16T12:00:00Z');
const A = { lat: 51.2, lon: -2.6 };
const trail = Array.from({ length: 61 }, (_, i) => ({ ...project(A, 0, i * 10), t: T0 + i * 8000 }));
const NOW = T0 + 3600e3;

/** The phone `along` metres up the trail and `right` metres to its right. */
const at = (along, right, acc = 5) => ({ ...project(project(A, 0, along), 90, right), acc });

/** Walk the coach through fixes 2 s apart; returns every alert and the end state. */
function run(fixes, opts = {}, state = initialCoach(), start = NOW) {
  const alerts = [];
  let now = start;
  for (const fix of fixes) {
    const r = coachStep(state, { fix, heading: 0, trail, now, ...opts });
    state = r.state;
    if (r.alert) alerts.push({ ...r.alert, at: now - start, status: state.status });
    now += 2000;
  }
  return { alerts, state, now };
}

t('on the line: nothing to say', () => {
  const { alerts, state } = run([at(10, 0), at(30, 2), at(50, -3), at(70, 1)]);
  assert.deepEqual(alerts, []);
  assert.equal(state.status, 'on');
});

t('drifting to the edge gets one soft word, and only once per excursion', () => {
  const { alerts, state } = run([at(10, 2), at(30, 16), at(50, 17), at(70, 5), at(90, 4), at(110, 16)]);
  assert.deepEqual(alerts.map(a => a.kind), ['edge', 'edge']);
  assert.equal(alerts[0].side, 'right');
  assert.equal(state.status, 'edge');
});

t('off the trail: called on the second fix, repeated every ten seconds, "still" after thirty', () => {
  const fixes = [at(10, 0), at(30, 30), at(50, 30)];
  const { alerts, state, now } = run(fixes);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].kind, 'off');
  assert.equal(alerts[0].at, 4000, 'not on the first outside fix — on the second');
  assert.equal(alerts[0].side, 'right');
  assert.equal(alerts[0].metres, 30);

  // The dog stands still off the trail: no fixes, the clock alone.
  let st = state, tick = now, kinds = [];
  for (let i = 0; i < 40; i++) {
    const r = coachStep(st, { trail, now: tick });
    st = r.state;
    if (r.alert) kinds.push([tick - now, r.alert.kind]);
    tick += 1000;
  }
  assert.ok(kinds.length >= 3, 'repeats came');
  assert.ok(kinds.every(([ms], i) => i === 0 || ms - kinds[i - 1][0] >= QUIET_MS), 'never closer than ten seconds');
  assert.equal(kinds[0][1], 'off');
  assert.ok(kinds.some(([, k]) => k === 'still'), '"still off" once it has gone on');
  assert.ok(kinds.find(([, k]) => k === 'still')[0] >= STILL_MS - QUIET_MS);
});

t('coming back inside the corridor is said once, then quiet', () => {
  const { alerts, state } = run([at(10, 0), at(30, 30), at(50, 30), at(70, 15), at(90, 15), at(110, 3)]);
  assert.deepEqual(alerts.map(a => a.kind), ['off', 'back']);
  assert.equal(alerts[1].at, 6000);
  assert.equal(state.status, 'on');
});

t('GPS noise is not an excursion', () => {
  // 40 m out but the phone says ±30 m: 40 − 30 = 10, inside a 20 m corridor.
  const noisy = run([at(10, 0), at(30, 40, 30), at(50, 40, 30), at(70, 40, 30)]);
  assert.deepEqual(noisy.alerts, [], 'not even the soft word — a ±30 m fix says nothing');
  assert.equal(noisy.state.status, 'on');
  // One clean fix a whole corridor out is enough on its own.
  const clear = run([at(10, 0), at(30, 70, 4)]);
  assert.equal(clear.alerts[0]?.kind, 'off');
  assert.equal(clear.alerts[0].at, 2000);
});

t('a slow excursion counts after six seconds even with fixes far apart', () => {
  let state = initialCoach();
  let r = coachStep(state, { fix: at(10, 0), heading: 0, trail, now: NOW });
  r = coachStep(r.state, { fix: at(30, 30), heading: 0, trail, now: NOW + 2000 });
  assert.equal(r.alert, null);
  r = coachStep(r.state, { fix: at(32, 30), heading: 0, trail, now: NOW + 9000 });
  assert.equal(r.alert?.kind, 'off');
});

t('downwind, the corridor opens to the scent band; upwind it does not', () => {
  // A stiff wind from the west pushes scent east — to the RIGHT of a
  // northbound trail — far enough that the band is wider than 20 m.
  const wx = { wind_speed: 10, wind_direction: 270 };
  const field = scentField(trail, wx, NOW);
  const c = corridor(trail, field, 30, 20, true);
  assert.equal(c.driftSide, 'right');
  assert.ok(c.right > 20 && c.right === c.band, `right side is the band: ${c.right}`);
  assert.equal(c.left, 20);
  assert.equal(corridor(trail, field, 30, 20, false).right, 20, 'scent-awareness off: plain corridor');
  assert.equal(corridor(trail, [], 30, 20, true).right, 20, 'no weather: plain corridor');
  const light = corridor(trail, scentField(trail, { wind_speed: 2, wind_direction: 270 }, NOW), 30, 20, true);
  assert.equal(light.right, 20, 'a band narrower than the tolerance changes nothing');

  const inBand = Math.round(c.right - 3);
  const right = run([at(200, 0), at(220, inBand), at(240, inBand), at(260, inBand)], { field, tolM: 20 });
  assert.ok(!right.alerts.some(a => a.kind === 'off'), `${inBand} m downwind is on the scent`);
  const left = run([at(200, 0), at(220, -inBand), at(240, -inBand)], { field, tolM: 20 });
  assert.equal(left.alerts.find(a => a.kind === 'off')?.side, 'left', 'the same distance upwind is off');
});

t('the dog is a line-length ahead of the phone', () => {
  const p = { lat: 51.2, lon: -2.6 };
  const d = dogPosition(p, 0, 10);
  assert.ok(Math.abs(dist(p, d) - 10) < 0.05);
  assert.ok(d.lat > p.lat && Math.abs(d.lon - p.lon) < 1e-9, 'straight north');
  assert.deepEqual(dogPosition(p, null, 10), { lat: p.lat, lon: p.lon }, 'no heading: the phone');
  assert.deepEqual(dogPosition(p, 90, 0), { lat: p.lat, lon: p.lon }, 'no line: the phone');
  // Walking past the end of the trail on a 10 m line: the phone is on the
  // last point, the dog is beyond it.
  const end = run([at(580, 0), at(600, 0), at(602, 0), at(605, 0)], { lineM: 10 });
  assert.ok(end.state.last.remaining < 1);
});

t('a drawn plan gets a wider corridor', () => {
  const tight = run([at(10, 0), at(30, 25), at(50, 25)], { tolM: 20 });
  assert.equal(tight.alerts.find(a => a.kind === 'off')?.kind, 'off');
  const sketch = run([at(10, 0), at(30, 25), at(50, 25)], { tolM: 20, plan: true });
  assert.ok(!sketch.alerts.some(a => a.kind === 'off'), `plan gives ${PLAN_EXTRA_M} m more`);
});

t('past the end is said as such', () => {
  const { alerts } = run([at(590, 0), at(640, 0), at(660, 0)]);
  const off = alerts.find(a => a.kind === 'off');
  assert.equal(off?.where, 'past the end');
  assert.equal(off.at, 4000, 'the second fix past the end confirms it');
  assert.equal(coachPhrase(off), 'Off the trail, 60 metres past the end of the trail');
});

t('the words, in either unit', () => {
  const off = { kind: 'off', metres: 27, side: 'right', where: 'right' };
  assert.equal(coachPhrase(off), 'Off the trail, 25 metres to the right');
  assert.equal(coachPhrase(off, { imperial: true }), 'Off the trail, 90 feet to the right');
  assert.equal(coachPhrase({ ...off, kind: 'still', metres: 41, side: 'left', where: 'left' }), 'Still off, 40 metres to the left');
  assert.equal(coachPhrase({ kind: 'edge', metres: 16, side: 'left', where: 'left' }), 'Drifting to the left');
  assert.equal(coachPhrase({ kind: 'back' }), 'Back on the trail');
  assert.equal(coachPhrase({ kind: 'off', metres: 2, side: 'right', where: 'right' }), 'Off the trail, 5 metres to the right', 'never "0 metres"');
  const reading = { off: 27.4, side: 'right', where: 'right' };
  assert.equal(coachLine(reading, 'off'), 'Off · 27 m right');
  assert.equal(coachLine(reading, 'on', { imperial: true }), '90 ft right');
});

console.log(`\n${pass} passed total`);
