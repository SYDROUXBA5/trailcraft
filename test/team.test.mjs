/* The team layer's decisions, checked headlessly: how a working is classed
   from the real laying-to-dog gap, how records aggregate per dog and handler,
   and how pre-team sessions are adopted by name. */

import assert from 'node:assert/strict';
import {
  trailClass, classOf, dogStats, handlerStats, attributeByName, backfillClasses,
  CLASS_BOUNDS, levelLabel,
} from '../public/team.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log(`  ok  ${name}`); };

const MIN = 60000, HOUR = 3600000;

/* ── classification ───────────────────────────────────────────────── */

t('trailClass: hot inside 30 min, warm to 3 h, cold beyond', () => {
  assert.equal(trailClass(0), 'hot', 'worked immediately');
  assert.equal(trailClass(CLASS_BOUNDS.hot), 'hot', 'boundary belongs to hot');
  assert.equal(trailClass(CLASS_BOUNDS.hot + 1), 'warm');
  assert.equal(trailClass(2 * HOUR), 'warm');
  assert.equal(trailClass(CLASS_BOUNDS.warm), 'warm', 'boundary belongs to warm');
  assert.equal(trailClass(CLASS_BOUNDS.warm + 1), 'cold');
  assert.equal(trailClass(18 * HOUR), 'cold', 'overnight trail');
});

t('trailClass: refuses to classify nonsense', () => {
  assert.equal(trailClass(null), null, 'no linked trail');
  assert.equal(trailClass(undefined), null);
  assert.equal(trailClass(NaN), null);
  // A drawn trail dated AFTER the dog ran it — a clock that ran backwards.
  assert.equal(trailClass(-5 * MIN), null);
});

t('classOf: a manual override outranks the computed class', () => {
  assert.equal(classOf({ klass: 'hot' }), 'hot');
  assert.equal(classOf({ klass: 'hot', klassManual: 'cold' }), 'cold');
  assert.equal(classOf({}), null);
  assert.equal(classOf(null), null);
});

/* ── aggregation ──────────────────────────────────────────────────── */

// ~111 m of northing per 0.001° of latitude — near-enough for stat sums.
const leg = (n) => Array.from({ length: n + 1 }, (_, i) => ({ lat: 51 + i * 0.001, lon: -2.6, t: i * 1000 }));

const SESSIONS = [
  { id: 'a', mode: 'dog', dogId: 'd1', points: leg(2), klass: 'hot' },
  { id: 'b', mode: 'dog', dogId: 'd1', points: leg(1), klass: 'hot', klassManual: 'warm' },
  { id: 'c', mode: 'dog', dogId: 'd1', points: leg(1), klass: 'cold' },
  { id: 'd', mode: 'dog', dogId: 'd2', points: leg(4), klass: null },       // free run, no linked trail
  { id: 'e', mode: 'runner', points: leg(3) },
  { id: 'f', mode: 'runner', points: leg(2), drawn: true },
];

t('dogStats: counts only that dog, honours overrides, tolerates classless runs', () => {
  const d1 = dogStats(SESSIONS, 'd1');
  assert.equal(d1.trails, 3);
  assert.equal(d1.hot, 1, 'the overridden hot moved to warm');
  assert.equal(d1.warm, 1);
  assert.equal(d1.cold, 1);
  assert.ok(d1.meters > 380 && d1.meters < 500, `4 legs ≈ 445 m, got ${d1.meters}`);

  const d2 = dogStats(SESSIONS, 'd2');
  assert.equal(d2.trails, 1);
  assert.equal(d2.hot + d2.warm + d2.cold, 0, 'a free run counts as a trail, not a class');

  const none = dogStats(SESSIONS, 'd9');
  assert.equal(none.trails, 0);
});

t('handlerStats: drawn trails are planned, not walked', () => {
  const h = handlerStats(SESSIONS);
  assert.equal(h.laid, 1);
  assert.equal(h.drawn, 1);
  assert.ok(h.meters > 280 && h.meters < 390, `3 legs ≈ 334 m walked, got ${h.meters}`);
});

/* ── adoption ─────────────────────────────────────────────────────── */

t('attributeByName: adopts by name, case-blind, never re-attributes', () => {
  const dogs = [{ id: 'd1', name: 'Nala' }, { id: 'd2', name: 'Rex' }];
  const past = [
    { mode: 'dog', dog: 'nala' },                       // typed lower-case
    { mode: 'dog', dog: ' Nala ' },                     // stray spaces
    { mode: 'dog', dog: 'Bruno' },                      // never registered
    { mode: 'dog', dog: 'Rex', dogId: 'd1' },           // already attributed — sacred
    { mode: 'runner', dog: 'Nala' },                    // runner trails have no dog
  ];
  const changed = attributeByName(past, dogs);
  assert.equal(changed, 2);
  assert.equal(past[0].dogId, 'd1');
  assert.equal(past[1].dogId, 'd1');
  assert.equal(past[2].dogId, undefined);
  assert.equal(past[3].dogId, 'd1', 'existing attribution untouched');
  assert.equal(past[4].dogId, undefined);
});

t('backfillClasses: classes old sessions from stored timestamps, once', () => {
  const past = [
    { id: 'r1', mode: 'runner', started: 1000000 },
    { id: 'g1', mode: 'dog', linkTo: 'r1', started: 1000000 + 10 * MIN },       // → hot
    { id: 'g2', mode: 'dog', linkTo: 'r1', started: 1000000 + 5 * HOUR },       // → cold
    { id: 'g3', mode: 'dog', linkTo: 'gone', started: 2000000 },                // trail deleted
    { id: 'g4', mode: 'dog', linkTo: 'r1', started: 1000000 + MIN, klass: null }, // already decided (free-run save)
  ];
  assert.equal(backfillClasses(past), 2);
  assert.equal(past[1].klass, 'hot');
  assert.equal(past[2].klass, 'cold');
  assert.equal(past[3].klass, undefined, 'no trail, no guess');
  assert.equal(past[4].klass, null, 'an explicit null is a decision, not a gap');
  assert.equal(backfillClasses(past), 0, 'second run finds nothing — idempotent');
});

t('levelLabel: labels speak the trail-class vocabulary, defaults to Hot', () => {
  assert.equal(levelLabel('cold'), 'Cold');
  assert.equal(levelLabel('warm'), 'Warm');
  assert.equal(levelLabel('bogus'), 'Hot');
  assert.equal(levelLabel(undefined), 'Hot');
});

console.log(`\n${pass} passed total`);
