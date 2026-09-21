import assert from 'node:assert/strict';
import { CONFIDENCE, CALL_V, MIN_PER_BAND, stampCall, confidenceOf, labelOf,
         callsIn, firstCall, scorable, calibration, calibrationLosses,
         calibrationLine } from '../public/call.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log(`  ok  ${name}`); };
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg} (${a} vs ${b})`);

/** A session with one called indication and a debrief. */
const sess = ({ conf = 'sure', seen = false, blind = 'handler',
                outcome = 'found', t: at = 1000, extra = [] } = {}) => ({
  data: {
    trackWaypoints: [
      ...extra,
      { kind: 'Indication', lat: 51, lon: -2.6, t: at, call: { v: CALL_V, conf, seen, at } },
    ],
    debrief: outcome === null ? undefined : { outcome, target: 'real', blind },
  },
});

/** n sessions in a band, `right` of them correct. */
const band = (conf, n, right) => Array.from({ length: n }, (_, i) =>
  sess({ conf, outcome: i < right ? 'found' : 'false' }));

t('three bands, each claiming less than the one above it', () => {
  assert.deepEqual(CONFIDENCE.map(c => c.v), ['sure', 'fairly', 'unsure']);
  for (let i = 1; i < CONFIDENCE.length; i++) {
    assert.ok(CONFIDENCE[i].p < CONFIDENCE[i - 1].p, 'claims fall as the words weaken');
  }
  /* Nobody is ever certain; a band that can only ever be wrong is useless. */
  assert.ok(CONFIDENCE[0].p < 1, '"Certain" does not claim certainty');
  for (const c of CONFIDENCE) {
    assert.ok(c.label.length <= 12, `"${c.label}" fits a button in the rain`);
    assert.ok(c.why, `${c.v} says what it means`);
  }
  assert.equal(labelOf('sure'), 'Certain');
  assert.equal(labelOf('nonsense'), null);
  assert.equal(confidenceOf('fairly').p, 0.7);
});

t('the stamp records whether the answer was already on the map', () => {
  assert.equal(stampCall('sure', false).seen, false);
  assert.equal(stampCall('sure', true).seen, true);
  assert.equal(stampCall(null, false).conf, null, 'a skipped question is not a confidence');
  assert.equal(stampCall('sure', undefined).seen, false);
  assert.equal(stampCall('sure', false).v, CALL_V);
});

t('only called indications count, earliest first', () => {
  const s = sess({ t: 5000, extra: [
    { kind: 'Lost it', lat: 51, lon: -2.6, t: 100, call: { conf: 'sure', seen: false } },
    { kind: 'Indication', lat: 51, lon: -2.6, t: 9000, call: { conf: 'unsure', seen: false } },
    { kind: 'Indication', lat: 51, lon: -2.6, t: 200 },   // marked before the question shipped
  ] });
  assert.deepEqual(callsIn(s).map(w => w.t), [5000, 9000], 'other kinds and uncalled marks drop out');
  assert.equal(firstCall(s).t, 5000, 'the first commitment is the one that pairs with the outcome');
  assert.equal(firstCall({ data: {} }), null);
  assert.deepEqual(callsIn(null), []);
});

t('a call only counts when the handler could not have known', () => {
  assert.deepEqual(scorable(sess()), { conf: 'sure', right: true, at: 1000 });
  assert.equal(scorable(sess({ outcome: 'false' })).right, false);

  assert.equal(scorable(sess({ seen: true })), null, 'the trail was on screen — that is reading, not calling');
  assert.equal(scorable(sess({ blind: 'open' })), null, 'the handler knew the answer');
  assert.equal(scorable(sess({ outcome: null })), null, 'never debriefed');
  for (const o of ['missed', 'blank', 'aborted']) {
    assert.equal(scorable(sess({ outcome: o })), null, `${o} does not say whether the call was right`);
  }
  assert.equal(scorable(sess({ blind: 'double' })).right, true, 'double-blind counts');
  assert.equal(scorable({ data: {} }), null);
});

t('a band reports a rate only once there is enough behind it', () => {
  const cal = calibration([...band('sure', 6, 4), ...band('fairly', 2, 2)]);
  assert.equal(cal.calls, 8);

  const sure = cal.bands.find(b => b.v === 'sure');
  assert.equal(sure.n, 6);
  assert.equal(sure.right, 4);
  assert.equal(sure.enough, true);
  near(sure.rate, 4 / 6, 'hit rate');
  near(sure.gap, 4 / 6 - 0.9, 'gap against what the word claims');
  assert.equal(sure.verdict, 'running hot', 'says Certain, is right two thirds of the time');

  const fairly = cal.bands.find(b => b.v === 'fairly');
  assert.equal(fairly.enough, false);
  assert.equal(fairly.rate, null, 'no rate is published on two runs');
  assert.equal(fairly.verdict, 'not enough yet');
  assert.equal(fairly.needs, MIN_PER_BAND - 2);

  /* Every band is present even with nothing in it, so a thin record reads as
     thin rather than as clean. */
  assert.equal(cal.bands.length, CONFIDENCE.length);
  assert.equal(cal.bands.find(b => b.v === 'unsure').n, 0);
  assert.equal(cal.ready, true);
  near(cal.bias, 4 / 6 - 0.9, 'one scored band, so the bias is its gap');
});

t('well-calibrated and under-claiming both read correctly', () => {
  const ok = calibration(band('fairly', 10, 7));          // claims 0.70, hits 0.70
  assert.equal(ok.bands.find(b => b.v === 'fairly').verdict, 'about right');
  assert.equal(calibrationLine(ok), 'How sure you say you are matches how often you’re right.');

  const cold = calibration(band('unsure', 10, 9));        // claims 0.50, hits 0.90
  assert.equal(cold.bands.find(b => b.v === 'unsure').verdict, 'running cold');
  assert.ok(calibrationLine(cold).includes('better than you give yourself credit for'));

  const hot = calibration(band('sure', 6, 4));
  assert.equal(calibrationLine(hot),
    'When you say “Certain”, you’re right 4 times in 6 (67%). That’s less often than “Certain” should mean.');
});

t('an empty or thin record says so instead of inventing a finding', () => {
  const none = calibration([]);
  assert.equal(none.calls, 0);
  assert.equal(none.ready, false);
  assert.equal(none.bias, null);
  assert.equal(calibrationLine(none), 'No blind calls yet.');
  assert.equal(calibrationLine(null), 'No blind calls yet.');

  const thin = calibration(band('sure', 1, 1));
  assert.equal(calibrationLine(thin), '1 blind call so far. Too few yet to say how well you read your dog.');
  assert.ok(calibrationLine(calibration(band('sure', 3, 1))).startsWith('3 blind calls'));
  assert.equal(calibration(null).calls, 0);
});

t('discarded runs are counted, so a thin curve is explained not hidden', () => {
  const l = calibrationLosses([
    sess(),                                  // usable
    sess({ seen: true }),                    // trail was on screen
    sess({ blind: 'open' }),                 // handler knew
    sess({ outcome: null }),                 // no debrief
    { data: { trackWaypoints: [] } },        // no call at all — not a loss, never had one
  ]);
  assert.equal(l.total, 4, 'only runs that carried a call');
  assert.equal(l.seen, 1);
  assert.equal(l.notBlind, 1);
  assert.equal(l.noDebrief, 1);
  assert.deepEqual(calibrationLosses([]), { total: 0, seen: 0, notBlind: 0, noDebrief: 0 });
});

t('a run kept from someone else’s link never counts as your call', () => {
  const theirs = (s) => ({ ...s, data: { ...s.data, imported: { from: 'A student', at: 1 } } });
  assert.equal(scorable(theirs(sess())), null, 'their call is not your call');

  /* Six of their confident misses must not make you look overconfident. */
  const mine = band('sure', 5, 5);
  const cal = calibration([...mine, ...band('sure', 6, 0).map(theirs)]);
  assert.equal(cal.calls, 5, 'only your own runs are counted');
  /* Folded in, their misses would make it 5 of 11 — "running hot". */
  assert.equal(cal.bands.find(b => b.v === 'sure').verdict, 'about right', '5 of 5 against a 0.9 claim');

  assert.equal(calibrationLosses([sess(), theirs(sess({ blind: 'open' }))]).total, 1,
    'and they are not counted as your losses either');
});

console.log(`\n${pass} passed total\n`);
