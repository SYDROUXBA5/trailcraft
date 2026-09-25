import assert from 'node:assert/strict';
import { CONFIDENCE, CALL_V, MIN_PER_BAND, stampCall, confidenceOf, labelOf,
         callsIn, firstCall, scorable, calibration, calibrationLosses,
         calibrationLine, callVerdict, runsOf, firstCallWasFind, AT_FIND_M, OFF_FIND_M } from '../public/call.js';
import { project } from '../public/geo.js';
import { labelOf as outcomeLabel } from '../public/debrief.js';
import { readFileSync } from 'node:fs';

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

/* Looking at the answer and then hiding it again does not make the next call
   a blind one. The run screen stamps that on the call; this is the second
   lock, on the record itself, for runs stamped before it learned to. */
t('a call made after the answer was shown is never counted, however it was stamped', () => {
  const shown = (revealedAt, at = 1000) => {
    const s = sess({ t: at });
    s.data.revealedAt = revealedAt;
    return s;
  };
  assert.equal(scorable(shown(900)), null, 'the trail had been on screen before the call');
  assert.equal(scorable(shown(1000)), null, 'shown the same moment: not blind either');
  assert.deepEqual(scorable(shown(1500)), { conf: 'sure', right: true, at: 1000 },
    'called first, looked afterwards: that is a blind call');
  assert.ok(scorable(shown(null)), 'a run that was never revealed still counts');
  assert.ok(scorable(shown(0)), 'and so does one whose reveal was never recorded');
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
  assert.deepEqual(calibrationLosses([]),
    { total: 0, seen: 0, helped: 0, notBlind: 0, blindUnasked: 0, noDebrief: 0, laterFind: 0 });
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

/* The coach reads out the distance to the real trail while the dog works.
   With it on there is no such thing as a blind call, whatever the run screen
   managed to stamp on it. */
t('a call made with the coach running is never banked', () => {
  const helped = (s) => ({ ...s, data: { ...s.data, coach: { assisted: true, tolM: 20 } } });
  assert.equal(scorable(helped(sess())), null);
  assert.equal(callVerdict(helped(sess())).why, 'helped');
  assert.ok(scorable({ ...sess(), data: { ...sess().data, coach: { assisted: false } } }),
    'the coach switched on and never used does not spoil the run');
  const l = calibrationLosses([sess(), helped(sess())]);
  assert.equal(l.helped, 1);
  assert.equal(l.seen, 1, 'and it is counted among the calls that could not be blind');
});

/* A trail someone else laid, sent as a Trail Card and run here, is the
   blindest run there is. It used to be thrown away with the runs kept from
   other people's links, because both are marked "imported". */
t('a trail that arrived as a card and was run here is your own blind call', () => {
  const card = (s, { ranAfter = true } = {}) => ({
    ...s,
    data: { ...s.data, imported: { from: 'Sophie', at: 500 }, trackStarted: ranAfter ? 900 : 100 },
  });
  assert.deepEqual(scorable(card(sess())), { conf: 'sure', right: true, at: 1000 },
    'you ran it after it arrived: your call');
  assert.equal(scorable(card(sess(), { ranAfter: false })), null,
    'a whole run kept from someone else carries their call, made before it got here');
  assert.equal(callVerdict(card(sess(), { ranAfter: false })).why, 'someone-elses');
  const cal = calibration([card(sess()), card(sess())]);
  assert.equal(cal.calls, 2, 'card-run trails build your record like any other');
});

/* The question can sit open while the answer goes up on screen. What counts
   is when the handler answered, not when they were asked. */
t('the moment that matters is when the call was given', () => {
  const late = sess({ t: 1000 });
  late.data.trackWaypoints.at(-1).call.at = 2000;   // answered after the reveal
  late.data.revealedAt = 1500;
  assert.equal(scorable(late), null, 'marked at 1000, answered at 2000, revealed at 1500');
  const early = sess({ t: 1000 });
  early.data.trackWaypoints.at(-1).call.at = 1100;
  early.data.revealedAt = 1500;
  assert.ok(scorable(early), 'answered before the reveal: it counts');
});

t('calibration is one handler’s, never the whole phone’s', () => {
  /* A trainer's phone running a class: A calls "Certain" five times and is
     right three, B five times and right five. Over every session on the
     phone, each was told "right 8 times in 10", which is neither of them. */
  const as = (who, rows) => rows.map(s => ({ ...s, handlerId: who }));
  const all = [...as('A', band('sure', 5, 3)), ...as('B', band('sure', 5, 5))];
  const a = calibration(runsOf(all, 'A')).bands.find(b => b.v === 'sure');
  const b = calibration(runsOf(all, 'B')).bands.find(b => b.v === 'sure');
  assert.deepEqual([a.n, a.right], [5, 3]);
  assert.deepEqual([b.n, b.right], [5, 5]);
  assert.match(calibrationLine(calibration(runsOf(all, 'A'))), /right 3 times in 5/);
  assert.deepEqual(runsOf(all, null), [], 'no handler, no record');
  assert.deepEqual(runsOf(null, 'A'), []);
});

/* The first call was scored against how the whole run ended. "Certain" forty
   metres from the hide, nothing there, the dog works on and finds it, and the
   debrief says "Found it": that was banked as a right "Certain", and an
   over-confident handler was told they read their dog well. */
t('a first call is only right when it was made where the find was', () => {
  const HIDE = { lat: 51, lon: -2.6 };
  /* A blind search, the first call `m` metres from the hide. */
  const search = (m, { acc = 4, approx = false, more = [], outcome = 'found' } = {}) => {
    const at = project(HIDE, 90, m);
    return {
      data: {
        hides: [HIDE, project(HIDE, 0, 200)],
        track: [{ ...at, t: 900, acc }, { ...at, t: 1100, acc }],
        trackWaypoints: [
          { kind: 'Indication', lat: at.lat, lon: at.lon, t: 1000, ...(approx ? { approx: true } : {}),
            call: { v: CALL_V, conf: 'sure', seen: false, at: 1000 } },
          ...more,
        ],
        debrief: { outcome, target: 'real', blind: 'handler' },
      },
    };
  };
  /* The find, marked at the hide after the first call. */
  const later = { kind: 'Indication', lat: HIDE.lat, lon: HIDE.lon, t: 2000 };
  assert.deepEqual(scorable(search(40, { more: [later] })), { conf: 'sure', right: false, at: 1000 },
    'forty metres off and found later: a wrong call, not a right one');
  assert.equal(firstCallWasFind(search(40, { more: [later] })), false);
  assert.deepEqual(scorable(search(4)), { conf: 'sure', right: true, at: 1000 }, 'at the hide: right');
  assert.equal(scorable(search(AT_FIND_M - 1)).right, true, 'just inside the find counts');
  assert.equal(callVerdict(search(22, { more: [later] })).why, 'later-find', 'between the two the map cannot say, so nothing is scored');
  assert.equal(callVerdict(search(40, { acc: 20, more: [later] })).why, 'later-find',
    'a poor fix makes a far call less certainly wrong, never right');
  assert.equal(scorable(search(OFF_FIND_M + 25, { acc: 20, more: [later] })).right, false);
  assert.equal(scorable(search(40, { outcome: 'false' })).right, false, 'called it wrong is wrong wherever it was');
  const early = { ...later, t: 500 };
  assert.equal(firstCallWasFind(search(40, { more: [early] })), null,
    'an Indication at the hide before the call does not show the call missed the find');
  const approxLater = { ...later, approx: true };
  assert.equal(firstCallWasFind(search(40, { more: [approxLater] })), null,
    'nor does one made after the GPS dropped out, which is only where the phone last was');

  /* A mark made after the GPS dropped out is where the phone last was, not
     where the call was: the marks decide, as they did before. */
  assert.equal(scorable(search(40, { approx: true })).right, true, 'the only indication of a found run');
  assert.equal(callVerdict(search(40, { approx: true, more: [later] })).why, 'later-find',
    'with a second indication, the find may have been that one');

  /* No map at all, and the exact case the review ran: a second, uncalled
     indication after the first. */
  const bare = sess({ extra: [] });
  bare.data.trackWaypoints.push({ kind: 'Indication', lat: 51.001, lon: -2.6, t: 5000 });
  assert.equal(scorable(bare), null);
  assert.equal(callVerdict(bare).why, 'later-find');
  assert.equal(scorable(sess()).right, true, 'one indication and a find, with nothing to measure against, is as it was');

  const lost = calibrationLosses([search(4), search(22, { more: [later] }), bare]);
  assert.equal(lost.laterFind, 2);
  assert.equal(lost.total, 3, 'out of every call of your own');
});

t('on a trail the find is at the end the layer walked to, not the end of a drawn line', () => {
  const START = { lat: 51, lon: -2.6 };
  const end = project(START, 0, 300);
  const trail = [START, project(START, 0, 150), end];
  const run = (m, extra = {}) => {
    const at = project(end, 180, m);
    return {
      data: {
        trail, ...extra,
        track: [{ ...at, t: 1000, acc: 5 }],
        trackWaypoints: [{ kind: 'Indication', lat: at.lat, lon: at.lon, t: 1000,
          call: { v: CALL_V, conf: 'fairly', seen: false, at: 1000 } }],
        debrief: { outcome: 'found', target: 'real', blind: 'double' },
      },
    };
  };
  /* The dog reached the person, and the handler marked it there. */
  const atEnd = (extra = {}) => { const r = run(150, extra); r.data.trackWaypoints.push({ kind: 'Indication', lat: end.lat, lon: end.lon, t: 2000 }); return r; };
  assert.equal(scorable(run(8)).right, true, 'a line\u2019s length short of the person');
  assert.equal(scorable(atEnd()).right, false, 'halfway down the trail was not the find, and the find at the end says so');
  assert.equal(scorable(atEnd({ plan: true, walked: true })).right, false, 'a walked plan\u2019s end is real');
  assert.equal(scorable(run(150, { plan: true })).right, true,
    'a drawn line\u2019s end is only where a finger stopped, so the marks decide');
  assert.equal(scorable(atEnd({ plan: true })), null, 'and a second mark leaves it unscored');
  /* This used to be null: the only mark of a find was never scored wrong.
     But a laid trail's end is where the layer's phone stopped, a fix and not
     a tap, and a call half the trail short of it was not the find. */
  assert.equal(scorable(run(150)).right, false, 'the only mark, plainly short of a laid trail\u2019s end, was wrong');
});

/* The review's case: one hide placed with a tap on the map, one Indication
   36 m from it, the debrief says "Found it", the handler did not know. The
   screen said "The dog found it, but not where you called it, so that call
   was wrong" — about the only call of the find. A tapped hide can be tens of
   metres out, and nothing else on the run says the find was anywhere else. */
t('the only call of a found run is never scored wrong', () => {
  const HIDE = { lat: 51, lon: -2.6 };
  const at = project(HIDE, 90, 36);
  const s = {
    data: {
      hides: [HIDE],
      track: [{ ...at, t: 900, acc: 4 }, { ...at, t: 1100, acc: 4 }],
      trackWaypoints: [{ kind: 'Indication', lat: at.lat, lon: at.lon, t: 1000,
        call: { v: CALL_V, conf: 'sure', seen: false, at: 1000 } }],
      debrief: { outcome: 'found', target: 'real', blind: 'handler' },
    },
  };
  assert.equal(firstCallWasFind(s), null, 'not wrong: not scored');
  assert.equal(callVerdict(s).why, 'later-find');
  assert.equal(scorable(s), null);
  const far = { ...s, data: { ...s.data, trackWaypoints: s.data.trackWaypoints.map(w => ({ ...w, ...project(HIDE, 90, 400) })) } };
  assert.equal(firstCallWasFind(far), null, 'however far off');
  const close = { ...s, data: { ...s.data, trackWaypoints: s.data.trackWaypoints.map(w => ({ ...w, ...project(HIDE, 90, 9) })) } };
  assert.equal(firstCallWasFind(close), true, 'near the hide it is the find');
});

/* A drawn trail that arrived as a Trail Card carries `drawn`, not `plan`, and
   was scored against the end of its drawn line as if a layer had walked it.
   Then, with no target at all, its only call was taken as the find wherever
   it was made, and a "Certain" 500 m short was banked as right for good: no
   walked card ever comes for a drawn card to put it straight. Its end is
   now what a hide tapped onto the map is, a place a finger put. */
t('a drawn card\u2019s end is where a finger put it, as a tapped hide is', () => {
  const START = { lat: 51, lon: -2.6 };
  const end = project(START, 0, 300);
  const at = project(end, 180, 150);
  const s = {
    data: {
      trail: [START, end], drawn: true, imported: { from: 'Kim', at: 1 },
      track: [{ ...at, t: 1000, acc: 5 }],
      trackWaypoints: [
        { kind: 'Indication', lat: at.lat, lon: at.lon, t: 1000, call: { v: CALL_V, conf: 'fairly', seen: false, at: 1000 } },
        { kind: 'Indication', lat: end.lat, lon: end.lon, t: 2000 },
      ],
      trackStarted: 500,
      debrief: { outcome: 'found', target: 'real', blind: 'handler' },
    },
  };
  /* Both of these were read from the marks alone: two left it open, and one
     was the find, however far off. */
  assert.equal(firstCallWasFind(s), false, 'a later mark at the drawn end shows the find was there');
  s.data.trackWaypoints.pop();
  assert.equal(firstCallWasFind(s), null, 'the only mark, far from the drawn end: not scored, not right');
  const far = { ...s, data: { ...s.data, trackWaypoints: s.data.trackWaypoints.map(w => ({ ...w, ...project(end, 180, 500) })) } };
  assert.equal(callVerdict(far).why, 'later-find', 'a "Certain" 500 m short is not banked as a right call');
  const close = { ...s, data: { ...s.data, trackWaypoints: s.data.trackWaypoints.map(w => ({ ...w, ...project(end, 180, 6) })) } };
  assert.equal(firstCallWasFind(close), true, 'at the drawn end it is the find');
  assert.equal(firstCallWasFind({ ...s, data: { ...s.data, walked: true } }), false,
    'once walked, the end is a fix, and a far call is wrong');
});

/* The review's case, on a trail saved as confirmLay saves it: ten found runs,
   one "Certain" each, six at the end and four 170 m short. Scoring only the
   runs with a second mark at the end read "about right" (6 of 6), where the
   handler was right 6 times in 10. The second mark is optional, so this
   hid the very over-confidence the call is there to catch. */
t('against a GPS-placed target, the only call of a find is wrong when it was plainly elsewhere', () => {
  const START = { lat: 51, lon: -2.6 };
  const end = { ...project(START, 0, 400), t: 5000, acc: 6 };
  const trail = [{ ...START, t: 1000, acc: 5 }, { ...project(START, 0, 200), t: 3000, acc: 5 }, end];
  const run = (short) => {
    const at = project(end, 180, short);
    return {
      data: {
        trail, track: [{ ...at, t: 9000, acc: 5 }],
        trackWaypoints: [{ kind: 'Indication', lat: at.lat, lon: at.lon, t: 9000,
          call: { v: CALL_V, conf: 'sure', seen: false, at: 9000 } }],
        debrief: { outcome: 'found', target: 'real', blind: 'handler' },
      },
    };
  };
  const runs = [...Array(6)].map(() => run(3)).concat([...Array(4)].map(() => run(170)));
  const sure = calibration(runs).bands.find(b => b.v === 'sure');
  assert.deepEqual([sure.n, sure.right, sure.verdict], [10, 6, 'running hot']);
  assert.equal(calibrationLosses(runs).laterFind, 0);
  assert.equal(firstCallWasFind(run(40)), null, 'within both fixes\u2019 uncertainty of thirty metres: not scored');
  assert.equal(firstCallWasFind(run(45)), false, 'past it: wrong');

  /* A hide dropped at the layer's feet is a fix too; one tapped onto the map
     is not, and keeps the rule for a finger. */
  const HIDE = { lat: 51, lon: -2.6 };
  const search = (hide) => {
    const at = project(HIDE, 90, 80);
    return {
      data: {
        hides: [hide], track: [{ ...at, t: 1000, acc: 4 }],
        trackWaypoints: [{ kind: 'Indication', lat: at.lat, lon: at.lon, t: 1000,
          call: { v: CALL_V, conf: 'sure', seen: false, at: 1000 } }],
        debrief: { outcome: 'found', target: 'real', blind: 'handler' },
      },
    };
  };
  assert.equal(firstCallWasFind(search({ ...HIDE, t: 1, gps: true, acc: 8 })), false, 'dropped at the feet, 80 m off');
  assert.equal(firstCallWasFind(search({ ...HIDE, t: 1, gps: true, acc: 60 })), null, 'unless its own fix was that poor');
  assert.equal(firstCallWasFind(search({ ...HIDE, t: 1 })), null, 'tapped onto the map');
});

/* "Who knew the answer" is not required, and a handler's first debrief has
   nothing sticky to fill it from, so it can be saved blank. The result card
   then said "Blind run — no prompts" (ranBlind) and, in the call block on
   the same card, "because you knew the answer", which nobody had said. */
t('a debrief that does not say who knew is not read as "you knew"', () => {
  const blank = sess({ blind: null });
  assert.equal(callVerdict(blank).why, 'blind-unasked');
  assert.equal(scorable(blank), null, 'still not counted: nothing says the call was blind');
  const unset = sess();
  delete unset.data.debrief.blind;
  assert.equal(callVerdict(unset).why, 'blind-unasked', 'a debrief saved before the field existed');
  assert.equal(callVerdict(sess({ blind: 'open' })).why, 'notblind', 'only "I knew" is "you knew"');
  const l = calibrationLosses([blank, sess({ blind: 'open' })]);
  assert.deepEqual([l.blindUnasked, l.notBlind, l.total], [1, 1, 2]);

  /* The call block itself, lifted from app.js and run against the real maths. */
  const js = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const i = js.indexOf('\nfunction paintCallBlock(s) {');
  assert.ok(i >= 0, 'app.js still has paintCallBlock');
  const src = js.slice(i, js.indexOf('\n}', i + 1) + 2);
  const said = (s) => {
    const els = {};
    const $ = (id) => (els[id] ??= { hidden: false, textContent: '' });
    new Function('$', 'firstCall', 'confidenceOf', 'labelOf', 'firstCallWasFind', 'callVerdict',
      'calibrationLine', 'calibration', 'runsOf', 'db', 'S', `${src}\npaintCallBlock(arguments[11]);`)(
      $, firstCall, confidenceOf, outcomeLabel, firstCallWasFind, callVerdict,
      calibrationLine, calibration, runsOf, { sessions: () => [] }, { handler: null }, s);
    return els.callSummary.textContent;
  };
  assert.match(said(blank), /the debrief doesn’t say who knew the answer/);
  assert.doesNotMatch(said(blank), /because you knew/);
  assert.match(said(sess({ blind: 'open' })), /because you knew the answer/);
});

console.log(`\n${pass} passed total\n`);
