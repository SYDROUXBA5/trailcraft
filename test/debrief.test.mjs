import assert from 'node:assert/strict';
import { DEBRIEF, FLAGS, NOTE_TAGS, DEBRIEF_V, blankDebrief, debriefDone, debriefLine,
         labelOf, fieldById, debriefRates, varietyGaps, toldField, toldOf, stickyDebrief } from '../public/debrief.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log(`  ok  ${name}`); };

const run = (d) => ({ data: { debrief: d } });
const full = (over = {}) => ({ ...blankDebrief(), outcome: 'found', target: 'real',
  blind: 'handler', help: 'none', response: 'clear', ...over });

t('the fields are the ones the real score sheets agree on, and nothing the phone already knows', () => {
  assert.deepEqual(DEBRIEF.map(f => f.id), ['outcome', 'target', 'blind', 'help', 'response']);
  for (const f of DEBRIEF) {
    assert.ok(f.label && f.why, `${f.id} says what it is and why it is asked`);
    assert.ok(f.options.length >= 3, `${f.id} has real choices`);
    assert.equal(new Set(f.options.map(o => o.v)).size, f.options.length, `${f.id} has no duplicate values`);
    for (const o of f.options) assert.ok(o.label.length <= 28, `"${o.label}" fits a chip`);
  }
  /* Asking for something the app measures is how a form stops being used. */
  const asked = JSON.stringify(DEBRIEF).toLowerCase();
  for (const already of ['run time', 'distance', 'weather', 'wind speed', 'trail age', 'how long']) {
    assert.ok(!asked.includes(already), `does not ask for ${already} — the phone recorded it`);
  }
  assert.ok(!asked.includes('score') && !asked.includes('points'),
    'no score and no points: this is not a sanctioning body');
});

t('a blank carries sticky fields forward and nothing else', () => {
  const last = full({ blind: 'double', help: 'led', outcome: 'missed' });
  const d = blankDebrief(last);
  assert.equal(d.blind, 'double', 'how blind it was carries over — a class runs the same way all morning');
  assert.equal(d.outcome, null, 'but the outcome never does');
  assert.equal(d.help, null);
  assert.deepEqual(d.flags, []);
  assert.equal(d.v, DEBRIEF_V);
  assert.equal(blankDebrief().blind, null);
  assert.equal(blankDebrief(null).outcome, null);
});

t('done means the two required fields, not all five', () => {
  assert.equal(debriefDone(null), false);
  assert.equal(debriefDone(blankDebrief()), false);
  assert.equal(debriefDone({ outcome: 'found' }), false, 'outcome alone is not enough');
  assert.equal(debriefDone({ outcome: 'found', target: 'real' }), true, 'outcome and what was out there');
  assert.equal(debriefDone(full()), true);
  assert.deepEqual(DEBRIEF.filter(f => f.required).map(f => f.id), ['outcome', 'target']);
});

t('the headline reads as a sentence, and never hides that the handler knew', () => {
  assert.equal(debriefLine(full()), 'Found it · you did not know · no help · clear, unprompted');
  assert.equal(debriefLine(full({ blind: 'open' })), 'Found it · you knew · no help · clear, unprompted');
  assert.equal(debriefLine(full({ blind: 'double', target: 'control', outcome: 'blank' })),
    'Correctly found nothing · on a blank · nobody knew · no help · clear, unprompted');
  assert.ok(debriefLine(full({ help: 'led' })).includes('help: i chose the way'));
  assert.equal(debriefLine(null), '');
  assert.equal(labelOf('outcome', 'false'), 'Called it wrong');
  assert.equal(labelOf('outcome', 'nonsense'), null);
  assert.equal(fieldById('blind').options.length, 3);
});

t('rates: a blank search counts as a success, and only unaided runs count as tested', () => {
  const sessions = [
    run(full()),                                            // found, real, handler-blind
    run(full({ outcome: 'missed' })),                       // missed, real
    run(full({ target: 'control', outcome: 'blank' })),     // correctly found nothing
    run(full({ target: 'control', outcome: 'false' })),     // called an empty field
    run(full({ blind: 'open', help: 'led' })),              // a training run
    run({ outcome: null }),                                 // never debriefed
  ];
  const r = debriefRates(sessions);
  assert.equal(r.runs, 5, 'the undebriefed run is not counted');
  assert.equal(r.tested, 4, 'only runs the handler could not steer');
  assert.equal(r.findRate, 2 / 3, 'found 2 of 3 real trails');
  assert.equal(r.blankRate, 1 / 2, 'called 1 of 2 blanks correctly');
  assert.equal(r.falseCalls, 1);
  assert.equal(r.blanksRun, 2);
  assert.equal(r.unaided, 4);
  assert.deepEqual(debriefRates([]), { runs: 0, tested: 0, found: 0, falseCalls: 0,
    findRate: null, blankRate: null, unaided: 0, clearAtSource: 0, blanksRun: 0 });
  assert.equal(debriefRates(null).runs, 0);
});

t('variety gaps name what has never been asked of the dog', () => {
  assert.deepEqual(varietyGaps([]), []);

  const flattered = Array.from({ length: 6 }, () => run(full({ blind: 'open', help: 'led', target: 'real' })));
  const g = varietyGaps(flattered);
  assert.ok(g.some(x => x.includes('knew the answer')), 'never run blind');
  assert.ok(g.some(x => x.includes('blank')), 'never run on an empty field');
  assert.ok(g.some(x => x.includes('without help')), 'never run unaided');

  const honest = [
    run(full({ blind: 'double' })),
    run(full({ target: 'control', outcome: 'blank' })),
    run(full({ help: 'none' })),
  ];
  assert.deepEqual(varietyGaps(honest), [], 'a varied record has nothing to warn about');

  /* Five or more flattering runs earns the double-blind warning; a handful
     does not, because everyone starts somewhere. */
  const five = Array.from({ length: 5 }, () => run(full({ blind: 'handler', target: 'control', outcome: 'blank' })));
  assert.ok(varietyGaps(five).some(x => x.includes('double-blind')));
  assert.ok(!varietyGaps(five.slice(0, 2)).some(x => x.includes('double-blind')));
});

t('flags and note tags are short, unique and optional', () => {
  for (const list of [FLAGS, NOTE_TAGS]) {
    assert.equal(new Set(list.map(x => x.v)).size, list.length);
    for (const x of list) assert.ok(x.label.length <= 14, `"${x.label}" fits a chip`);
  }
  const d = blankDebrief();
  assert.deepEqual(d.flags, []);
  assert.equal(d.noteTag, null);
  assert.equal(d.note, '');
  assert.equal(debriefDone({ outcome: 'found', target: 'real' }), true, 'neither is ever required');
});

t('a run kept from someone else’s link is never counted as yours', () => {
  const theirs = (d) => ({ data: { debrief: d, imported: { from: 'A student', at: 1 } } });
  const r = debriefRates([run(full()), theirs(full({ outcome: 'missed' })), theirs(full({ outcome: 'false' }))]);
  assert.equal(r.runs, 1, 'only your own run');
  assert.equal(r.findRate, 1, 'their misses do not lower your find rate');
  assert.equal(r.falseCalls, 0);
  /* Their blind double-blank run must not tick off your variety gaps. */
  const gaps = varietyGaps([run(full({ blind: 'open', target: 'real' })),
    theirs(full({ blind: 'double', target: 'control', outcome: 'blank' }))]);
  assert.ok(gaps.some(x => x.includes('knew the answer')), 'you still have never run blind');
  assert.ok(gaps.some(x => x.includes('blank')), 'and still never run a blank');
});

t('what someone else reads never says I or you', () => {
  /* A student's run arrives on the instructor's phone. "Help you gave: I chose
     the way" would tell the instructor they did something they did not. */
  const firstPerson = /\b(I|you|your|me|my)\b/i;
  for (const f of DEBRIEF) {
    assert.ok(!firstPerson.test(toldField(f.id)), `field "${toldField(f.id)}" is third person`);
    for (const o of f.options) {
      assert.ok(!firstPerson.test(toldOf(f.id, o.v)), `${f.id}.${o.v} "${toldOf(f.id, o.v)}" is third person`);
    }
  }
  assert.equal(toldField('help'), 'Help given');
  assert.equal(toldOf('blind', 'handler'), 'The handler did not');
  assert.equal(toldOf('outcome', 'found'), 'Found it', 'neutral labels are used as they are');
  assert.equal(labelOf('blind', 'handler'), 'I did not', 'the handler’s own form is unchanged');
  assert.equal(toldOf('blind', 'nonsense'), null);
  assert.equal(toldField('nonsense'), null);
});

t('the sticky answers come from this handler’s own last debrief', () => {
  /* They came from the newest debrief on the phone, whoever's it was, so one
     handler's "Nobody there knew" was already picked on the next handler's
     run, and a run kept from someone else's link did the same. */
  const mine = { id: 'm', handlerId: 'A', data: { debrief: full({ blind: 'handler' }) } };
  const theirs = { id: 'o', handlerId: 'B', data: { debrief: full({ blind: 'double' }) } };
  const kept = { id: 'k', handlerId: 'A', data: { imported: { at: 5 }, debrief: full({ blind: 'double' }) } };
  const now = { id: 'n', handlerId: 'A', data: {} };
  const sessions = [kept, theirs, now, mine];     // newest first
  assert.equal(stickyDebrief(sessions, now)?.blind, 'handler', 'skips B, and the kept run');
  assert.equal(blankDebrief(stickyDebrief(sessions, now)).blind, 'handler');
  assert.equal(stickyDebrief([theirs, now], now), null, 'nothing of their own yet: nothing filled in');
  assert.equal(stickyDebrief(sessions, { id: 'x', data: {} }), null, 'a run with no handler borrows nothing');
  assert.equal(stickyDebrief([now], now), null, 'never its own');
});

console.log(`\n${pass} passed total\n`);
