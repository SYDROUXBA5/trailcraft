/* A trail's route laid again (store.js: canLayAgain, routeCorners, routeOf,
   planSession).

   What is pinned: a walked line becomes a plan's corners, thinned so the
   GPS wobble goes and every real corner stays; a plan nobody walked keeps
   exactly the corners that were drawn; hide searches have no route; and the
   new lay is a new session that carries the route, where it came from and
   its name, and nothing of the first day: no track, result, weather, wind
   felt, debrief, folders, hides or contamination. A plan drawn by finger is
   built by the same function and comes out as it always did. */

import assert from 'node:assert/strict';
import { canLayAgain, routeCorners, routeOf, planSession, runAgain,
         ROUTE_TOLS_M, ROUTE_MAX_CORNERS } from '../public/store.js';
import { RUN_FIELDS } from '../public/sync-core.js';
import { project, dist, simplify, pathLen } from '../public/geo.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log(`  ok  ${name}`); };

const A = { lat: 51.2094, lon: -2.6453 };      // Wells, near enough
const NOW = new Date(2026, 8, 28, 15, 0).getTime();

/* A fix every 2 m along legs of [bearing, metres], wobbling up to `wob`
   metres either side the way a phone's GPS does, with the time, accuracy and
   height a recorded fix carries. The wobble is fixed, not random, so the
   test says the same thing every run. */
function walked(legs, { wob = 1.5, from = A } = {}) {
  const out = [];
  const corners = [{ ...from }];
  let at = { ...from }, i = 0;
  for (const [brg, m] of legs) {
    for (let d = 0; d < m; d += 2) {
      const on = project(at, brg, d);
      const side = wob * Math.sin(i * 1.7) * Math.cos(i * 0.31);
      out.push({ ...project(on, brg + 90, side), t: NOW - 3600e3 + i * 1500, acc: 4, alt: 60 });
      i++;
    }
    at = project(at, brg, m);
    corners.push({ ...at });
  }
  out.push({ ...at, t: NOW - 3600e3 + i * 1500, acc: 4, alt: 60 });
  return { line: out, corners };
}

const nearest = (pts, p) => Math.min(...pts.map(q => dist(q, p)));

t('a walked line becomes its corners: the wobble goes, every corner stays', () => {
  const { line, corners } = walked([[0, 120], [90, 80], [180, 60]]);
  const got = routeCorners({ id: 's1', targetId: 'person', data: { trail: line } });
  assert.ok(line.length > 100, `a real walk has a fix every couple of metres (${line.length})`);
  assert.ok(got.length >= 4 && got.length <= 6, `four corners walked, ${got.length} kept`);
  for (const c of corners) assert.ok(nearest(got, c) < 4, 'each corner walked is one of the plan’s corners');
  assert.deepEqual(got[0], { lat: line[0].lat, lon: line[0].lon }, 'it starts where the trail started');
  assert.deepEqual(got.at(-1), { lat: line.at(-1).lat, lon: line.at(-1).lon }, 'and ends where the layer stood');
  // Nothing walked is more than the tolerance off the plan.
  const kept = simplify(line, ROUTE_TOLS_M[0]);
  assert.equal(got.length, kept.length);
  for (const c of got) assert.deepEqual(Object.keys(c).sort(), ['lat', 'lon'], 'no time, accuracy or height from the first lay');
});

t('a long wobbly trail is thinned harder, but never past a lane’s width', () => {
  /* A kilometre east with a bump off the line every 20 m, each reaching
     6.5 m out: kept as corners at 5 m, dropped at 8 m. Then a real corner. */
  const line = [];
  let i = 0;
  for (let d = 0; d <= 1000; d += 2, i++) {
    const phase = d % 20;
    const off = phase < 10 ? phase * 0.65 : (20 - phase) * 0.65;
    line.push({ ...project(project(A, 90, d), 0, off), t: NOW + i * 1000 });
  }
  const turn = project(A, 90, 1000);
  for (let d = 2; d <= 100; d += 2) line.push({ ...project(turn, 0, d), t: NOW + (i++) * 1000 });
  assert.ok(simplify(line, ROUTE_TOLS_M[0]).length > ROUTE_MAX_CORNERS, 'too many to number at the first tolerance');
  const got = routeCorners({ targetId: 'person', data: { trail: line } });
  assert.ok(got.length <= ROUTE_MAX_CORNERS, `${got.length} corners`);
  assert.ok(nearest(got, turn) < 8, 'the real corner is still there');

  /* A trail that really does turn sixty times keeps every turn: the
     tolerance stops growing long before it would cut one. */
  const legs = Array.from({ length: 60 }, (_, k) => [k % 2 ? 135 : 45, 40]);
  const zig = walked(legs, { wob: 1 });
  const all = routeCorners({ targetId: 'person', data: { trail: zig.line } });
  assert.ok(all.length > ROUTE_MAX_CORNERS);
  for (const c of zig.corners) assert.ok(nearest(all, c) < 4, 'no real turn is cut to fit a number');
  assert.equal(ROUTE_TOLS_M.at(-1), 12);
});

t('a plan nobody walked is the corners that were drawn; a walked one is the walk', () => {
  const drawn = [A, project(A, 45, 80), project(A, 90, 150)].map(p => ({ lat: p.lat, lon: p.lon }));
  const plan = { id: 'p1', targetId: 'person', data: { plan: true, corners: drawn, trail: walked([[45, 80]]).line } };
  const got = routeCorners(plan);
  assert.deepEqual(got, drawn);
  assert.notEqual(got[0], drawn[0], 'copies, so nothing done to the new plan reaches the old one');

  const walk = walked([[10, 90], [100, 70]], { from: project(A, 0, 6) });
  const done = { id: 'p2', targetId: 'person',
    data: { plan: true, walked: true, corners: drawn, planTrail: walked([[45, 80]]).line, trail: walk.line } };
  const route = routeCorners(done);
  for (const c of walk.corners) assert.ok(nearest(route, c) < 4, 'the ground actually walked, not the sketch');
  assert.ok(nearest(route, drawn[1]) > 20);
});

t('only a trail with a line has a route: not a hide search, not a scrap', () => {
  const { line } = walked([[0, 60]]);
  assert.equal(canLayAgain({ targetId: 'person', data: { trail: line } }), true);
  assert.equal(canLayAgain({ targetId: 'narcotics', data: { hides: [A] } }), false, 'a hide search');
  assert.equal(canLayAgain({ targetId: 'article', data: { trail: line } }), false, 'anything set as a hide');
  assert.equal(canLayAgain({ targetId: 'person', data: { trail: line, hides: [A] } }), false);
  assert.equal(canLayAgain({ targetId: 'person', data: { trail: [line[0]] } }), false, 'one fix is not a line');
  assert.equal(canLayAgain({ targetId: 'person', deleted: true, data: { trail: line } }), false);
  assert.equal(canLayAgain({ targetId: 'person', data: { trail: 'nonsense' } }), false);
  assert.equal(canLayAgain(null), false);
  assert.equal(routeOf({ id: 'h', targetId: 'cadaver', data: { hides: [A, A] } }), null);
  assert.equal(routeOf({ id: 'z', targetId: 'person', data: { trail: [A, { ...A }] } }), null, 'a line with no length');
  assert.equal(routeOf({ id: 'q', targetId: 'person', data: { trail: [{ lat: 'x' }, { lat: NaN, lon: 1 }] } }), null);
});

/* Everything a laid, run, filed and debriefed trail can hold, each marked so
   that any of it turning up in the new session is seen. */
function fullyRun() {
  const { line } = walked([[0, 120], [90, 80]]);
  return {
    id: 'old1', handlerId: 'h1', dogId: 'rex', layerId: 'sophie', targetId: 'person',
    startedAt: line[0].t, summary: 'OLD-SUMMARY', name: 'Church lane loop', updatedAt: 123,
    data: {
      trail: line, waypoints: [{ ...line[10], note: 'OLD-WAYPOINT' }],
      weather: { wind_speed: 4.2, marker: 'OLD-WEATHER' }, runWeather: { marker: 'OLD-RUNWEATHER' },
      windFelt: { from: 200, marker: 'OLD-FELT' }, track: walked([[2, 118]]).line, trackStarted: 1,
      trackWaypoints: [{ note: 'OLD-TRACKWP' }], result: { kind: 'trail', sentence: 'OLD-RESULT' },
      coach: { on: true, marker: 'OLD-COACH' }, debrief: { note: 'OLD-DEBRIEF' }, seen: 5, revealedAt: 9,
      folders: [{ id: 'f1', name: 'OLD-FOLDER', at: 1 }], contamination: [{ who: 'OLD-CONTAM', pts: line.slice(0, 5) }],
      hides: undefined, ground: { marker: 'OLD-GROUND' }, offAt: 77, ageMin: 45, level: 'OLD-LEVEL',
    },
  };
}

t('laid again: the route, where it came from and its name, and nothing of the first day', () => {
  const src = fullyRun();
  const route = routeOf(src);
  assert.deepEqual(Object.keys(route).sort(), ['corners', 'fromSession', 'name']);
  assert.equal(route.fromSession, 'old1');
  assert.equal(route.name, 'Church lane loop');

  const s = planSession({ id: 'new1', handlerId: 'h2', layerId: 'tom', ageMin: 5, now: NOW,
    summary: 'NEW-SUMMARY', ...route });
  assert.equal(s.id, 'new1');
  assert.equal(s.handlerId, 'h2', 'handled by whoever is chosen now');
  assert.equal(s.layerId, 'tom', 'laid by whoever is chosen now');
  assert.equal(s.dogId, null, 'the dog is the one that runs it, picked when it runs');
  assert.equal(s.targetId, 'person');
  assert.equal(s.name, 'Church lane loop');
  assert.ok(!('updatedAt' in s) && !('deleted' in s));
  assert.deepEqual(Object.keys(s.data).sort(),
    ['ageMin', 'contamination', 'corners', 'fromSession', 'plan', 'trail', 'waypoints', 'weather']);
  assert.equal(s.data.plan, true);
  assert.equal(s.data.ageMin, 5, 'its own head start, not the first day’s');
  assert.equal(s.data.weather, null, 'its own weather arrives when it is laid');
  assert.deepEqual(s.data.contamination, []);
  assert.deepEqual(s.data.waypoints, []);
  assert.equal(s.data.fromSession, 'old1');
  for (const k of RUN_FIELDS) assert.ok(!(k in s.data), `no ${k}`);
  for (const k of ['folders', 'hides', 'walked', 'planTrail', 'offAt', 'revealedAt', 'ground', 'imported', 'planOf', 'level']) {
    assert.ok(!(k in s.data), `no ${k}`);
  }
  const text = JSON.stringify(s);
  assert.ok(!/OLD-/.test(text), `nothing marked from the first day: ${text.match(/OLD-\w+/)?.[0]}`);
  assert.ok(!src.data.trail.some(p => s.data.trail.includes(p)), 'no fix object shared with the first lay');

  // The line is a drawn plan's: densified, and just laid, finishing now.
  assert.equal(s.data.trail.at(-1).t, NOW);
  assert.equal(s.startedAt, s.data.trail[0].t);
  assert.ok(s.data.trail.every((p, i) => !i || dist(s.data.trail[i - 1], p) <= 5.01));
  assert.ok(Math.abs(pathLen(s.data.trail) - pathLen(s.data.corners)) < 0.5);
  assert.deepEqual(s.data.trail[0].lat, route.corners[0].lat);

  // The first trail is untouched.
  assert.deepEqual(src, fullyRun());
});

t('a plan drawn by finger is built by the same function, exactly as before', () => {
  const corners = [A, project(A, 30, 60), project(A, 80, 120)].map(p => ({ lat: p.lat, lon: p.lon }));
  const s = planSession({ id: 'd1', handlerId: 'h1', layerId: 'sophie', corners, ageMin: 10, now: NOW, summary: 'x' });
  assert.deepEqual(Object.keys(s).sort(), ['data', 'dogId', 'handlerId', 'id', 'layerId', 'startedAt', 'summary', 'targetId']);
  assert.deepEqual(Object.keys(s.data).sort(), ['ageMin', 'contamination', 'corners', 'plan', 'trail', 'waypoints', 'weather']);
  assert.equal(s.data.corners, corners);
  assert.equal(planSession({ id: 'd2', handlerId: 'h1', corners, ageMin: 0, now: NOW, summary: 'x' }).layerId, null);
});

t('a route laid again is still that route when the next dog runs it', () => {
  const s = planSession({ id: 'n', handlerId: 'h', layerId: 'l', ageMin: 10, now: NOW, summary: 's', ...routeOf(fullyRun()) });
  const again = runAgain({ ...s, dogId: 'rex', data: { ...s.data, track: [A], result: { kind: 'trail' } } }, { id: 'n2', summary: 'Run again' });
  assert.equal(again.data.fromSession, 'old1');
  assert.equal(again.data.planOf, 'n', 'and the plan it was drawn as');
  assert.equal(again.name, 'Church lane loop');
  assert.ok(!('track' in again.data) && !('result' in again.data));
});

console.log(`\n${pass} passed total\n`);
