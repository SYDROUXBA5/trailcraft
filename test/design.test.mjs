/* The draw-mode design grader, checked headlessly: leg grouping with no
   holes, honest chips, and advice that names the actual weakest leg. */

import assert from 'node:assert/strict';
import { legRanges, regimeMix, regimeTurns, analyseDesign } from '../public/design.js';
import { scentField, timestamps, densify, pathLen } from '../public/geo.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log(`  ok  ${name}`); };

/* A synthetic field: n points of one regime, spliced from real labels. */
const run = (label, side, n) =>
  Array.from({ length: n }, () => ({ regime: { label, side } }));

/* A real field from a drawn L-shape: north leg then east leg, wind from the
   west (270°) — the north leg is pure crosswind, the east leg pure tailwind. */
function elShape() {
  const corners = [
    { lat: 51.2, lon: -2.6 },
    { lat: 51.2045, lon: -2.6 },                          // ~500 m north
    { lat: 51.2045, lon: -2.5928 },                       // ~500 m east
  ];
  const pts = timestamps(densify(corners, 5), Date.now() - 3600000, 1.3);
  const wx = { wind_speed: 4, wind_direction: 270 };
  return { pts, field: scentField(pts, wx, Date.now()), wx };
}

t('legRanges: groups regimes with index ranges and leaves no holes', () => {
  const field = [...run('crosswind', 'right', 10), ...run('tailwind', 'right', 8)];
  const legs = legRanges(field);
  assert.equal(legs.length, 2);
  assert.equal(legs[0].i0, 0);
  assert.equal(legs[legs.length - 1].i1, field.length - 1, 'last leg reaches the end');
  for (let i = 1; i < legs.length; i++) {
    assert.equal(legs[i].i0, legs[i - 1].i1 + 1, 'legs tile the field exactly');
  }
});

t('legRanges: corner flicker folds into a neighbour instead of a gap', () => {
  const field = [
    ...run('crosswind', 'right', 10),
    ...run('headwind', 'left', 2),                        // 2-point flicker at a corner
    ...run('crosswind', 'right', 10),
  ];
  const legs = legRanges(field);
  assert.equal(legs[legs.length - 1].i1, field.length - 1);
  for (let i = 1; i < legs.length; i++) assert.equal(legs[i].i0, legs[i - 1].i1 + 1);
  assert.ok(legs.length <= 3, 'flicker did not multiply the legs');
});

t('an L across a west wind reads as crosswind then tailwind', () => {
  const { field } = elShape();
  const legs = legRanges(field);
  const labels = legs.map(l => l.label);
  assert.ok(labels.includes('crosswind'), `north leg is crosswind, got ${labels}`);
  assert.ok(labels.includes('tailwind'), `east leg is tailwind, got ${labels}`);
  const mix = regimeMix(field);
  assert.ok(mix.crosswind > 0.35 && mix.tailwind > 0.35, 'both legs carry real weight');
  assert.equal(regimeTurns(legs), 1, 'one wind-change corner');
});

t('analyseDesign: names the downwind leg and how long it is', () => {
  const { field, wx } = elShape();
  const metresOf = (leg) => {
    let m = 0;
    for (let i = leg.i0 + 1; i <= leg.i1; i++) m += 5;    // densified at 5 m spacing
    return m;
  };
  const d = analyseDesign(field, wx, null, metresOf);
  assert.ok(d.advice, 'a 500 m downwind leg deserves advice');
  assert.match(d.advice, /downwind/, d.advice);
  assert.match(d.advice, /Leg \d/, 'advice names which leg');
  assert.ok(d.chips.includes('crosswind discrimination'), `chips: ${d.chips}`);
});

t('analyseDesign: praises a genuinely cross design instead of inventing faults', () => {
  // Straight north line, west wind: all crosswind — nothing to fix.
  const corners = [{ lat: 51.2, lon: -2.6 }, { lat: 51.209, lon: -2.6 }];
  const pts = timestamps(densify(corners, 5), Date.now() - 3600000, 1.3);
  const field = scentField(pts, { wind_speed: 4, wind_direction: 270 }, Date.now());
  const d = analyseDesign(field, { wind_speed: 4, wind_direction: 270 }, null, () => 900);
  assert.ok(d.chips.includes('crosswind discrimination'));
  assert.match(d.advice ?? '', /Good design|Add a turn/, `got: ${d.advice}`);
});

t('analyseDesign: stability regimes add their chips', () => {
  const { field, wx } = elShape();
  const inv = analyseDesign(field, wx, { key: 'inversion' }, () => 0);
  assert.ok(inv.chips.some(c => /pooling/.test(c)));
  const conv = analyseDesign(field, wx, { key: 'convective' }, () => 0);
  assert.ok(conv.chips.some(c => /lifting/.test(c)));
});

t('legRanges: side flicker cannot shred a downwind stretch', () => {
  // A pure tailwind run whose near-zero cross component wobbles left/right
  // every couple of points — one leg, not a fold under the wrong label.
  const field = [];
  for (let i = 0; i < 20; i++) field.push({ regime: { label: 'tailwind', side: i % 2 ? 'left' : 'right' } });
  const legs = legRanges(field);
  assert.equal(legs.length, 1, `one downwind leg, got ${legs.length}`);
  assert.equal(legs[0].label, 'tailwind');
});

t('legRanges: when every run is tiny, one dominant leg beats an unlabelled line', () => {
  const field = [];
  for (let i = 0; i < 12; i++) {
    field.push({ regime: { label: i % 2 ? 'crosswind' : 'headwind', side: i % 2 ? 'right' : '' } });
  }
  // Alternating every point: no run reaches minPts. The map must still paint.
  const legs = legRanges(field, 4);
  assert.ok(legs.length >= 1, 'never an empty labelling for a real line');
  assert.equal(legs[0].i0, 0);
  assert.equal(legs[legs.length - 1].i1, field.length - 1);
});

t('analyseDesign: refuses to grade without weather or enough line', () => {
  assert.deepEqual(analyseDesign([], { wind_speed: 3 }, null).chips, []);
  assert.equal(analyseDesign(null, null, null).advice, null);
  const { field } = elShape();
  assert.deepEqual(analyseDesign(field, null, null).legs, [], 'no wind, no claims');
});

console.log(`\n${pass} passed total`);
