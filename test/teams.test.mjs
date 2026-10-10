/* Teams on screen (public/teams.js): the words and small sums between the
   level engine and the pages. Run with `node test/teams.test.mjs`. */
import assert from 'node:assert/strict';
import {
  MOTIONS, motionChoice, motionOn, COAT_IDS, DEFAULT_LOOK, coatFor, teamLook, makeTeam, putTeam, dropTeam, withBest,
  restartTeam, levelChip, chipStage, proven, meterWords, teamTitle, earnedName, pairName, stageBar, standing, stoneStatus, inUnits, checkRows, newWords,
  levelCard, stoneLabel, tryRows, teamStates, LEVEL_FIELDS, LEFT_FIELD, levelFields, levelNeeds, stickyLevel, stickyLevelFrom, tryStamp, LEFT_AGO, leftAgoLabel,
  plainWhy, debriefWouldFix, resultLine, takenBack, shownLevel,
} from '../public/teams.js';
import { LADDER_V1, PRESETS, STARTS, SETTINGS, SETTING_FROM, newTeam, teamOf, teamsOf, teamLevel, judge, levelSpec, dayKey } from '../public/levels.js';
import { project } from '../public/geo.js';
import { COATS, JACKETS, HATS } from '../public/pixel-team.js';
import { createStore, dogsOf, dogsWorkedBy, askDelete } from '../public/store.js';
import { RUN_FIELDS } from '../public/sync-core.js';
import { readFileSync } from 'node:fs';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log(`  ok  ${name}`); };

const NOW = Date.UTC(2026, 9, 10, 12);
/** What the engine says of a team with no runs, placed by `preset`. */
const fresh = (preset = 'new') => {
  const team = { ...newTeam({ handlerId: 'h', dogId: 'd', preset, now: NOW - 1000 }), dogId: 'd' };
  return teamLevel([], team, { now: NOW });
};
/** The same, as if it had gone on to pass up to `passed`. Only the fields
    the page reads are changed; the engine's own sums are tested in levels. */
const at = (passed, preset = 'new') => {
  const lv = fresh(preset);
  const level = Math.min(100, passed + 1), spec = levelSpec(level);
  return { ...lv, passed, level, done: passed >= 100, earned: passed, stage: spec.stage, name: passed ? levelSpec(passed).name : null,
    next: passed >= 100 ? null : { level, spec, whatsNew: [], checklist: judge(spec, null).checklist, bestTryId: null } };
};

t('Animations: the address wins over the setting, and On moves whatever the phone says', () => {
  assert.deepEqual(MOTIONS.map(m => m.id), ['auto', 'on', 'off']);
  assert.equal(motionChoice('off', 'on'), 'on', '?motion=on on a phone set to Off');
  assert.equal(motionChoice('on', 'nonsense'), 'on', 'a word that is not one of the three is ignored');
  assert.equal(motionChoice(undefined), 'auto', 'a phone that never chose follows itself');
  assert.equal(motionChoice('sometimes'), 'auto');
  assert.equal(motionOn('auto', true), false, 'Auto with Reduce Motion on is still');
  assert.equal(motionOn('auto', false), true);
  assert.equal(motionOn('on', true), true, 'On animates with Reduce Motion on: that is what it is for');
  assert.equal(motionOn('off', false), false);
});

t('the looks named here are the ones the pixel art can draw', () => {
  assert.deepEqual([...COAT_IDS], COATS.map(c => c.id), 'every coat, in the art’s own order');
  assert.ok(JACKETS.some(j => j.id === DEFAULT_LOOK.jacket) && HATS.some(h => h.id === DEFAULT_LOOK.hat));
  assert.ok(COAT_IDS.includes(DEFAULT_LOOK.coat));
});

t('a breed as typed finds its coat', () => {
  const cases = [
    ['Bloodhound', 'bloodhound-red'], ['bloodhound (black & tan)', 'bloodhound-bt'], ['Liver and tan Bloodhound', 'bloodhound-liver'],
    ['Belgian Malinois', 'malinois'], ['Malinois x', 'malinois'], ['German Shepherd', 'shepherd'], ['GSD', 'shepherd'],
    ['Labrador', 'lab-yellow'], ['black lab', 'lab-black'], ['Chocolate Labrador', 'lab-chocolate'],
    ['Beagle', 'beagle'], ['English Springer Spaniel', 'springer'], ['Cocker', 'springer'],
    ['Golden retriever', 'lab-yellow'], ['Bavarian Mountain Hound', 'bloodhound-red'],
    ['', 'bloodhound-red'], [null, 'bloodhound-red'], ['Collie', 'bloodhound-red'],
  ];
  for (const [breed, coat] of cases) assert.equal(coatFor(breed), coat, String(breed));
  for (const [, coat] of cases) assert.ok(COAT_IDS.includes(coat));
});

t('a team wears what was chosen, the breed’s coat until then, and its stage’s harness', () => {
  assert.deepEqual(teamLook(null, { breed: 'Malinois' }), { coat: 'malinois', jacket: 'navy', hat: 'cap', stage: 'hot' });
  const team = { look: { coat: 'beagle', jacket: 'red', hat: 'none', harness: null } };
  assert.deepEqual(teamLook(team, { breed: 'Malinois' }, 'cold'), { coat: 'beagle', jacket: 'red', hat: 'none', stage: 'cold' });
  assert.equal(teamLook({ look: { coat: 'unicorn' } }, { breed: 'Beagle' }).coat, 'beagle', 'a coat the art does not have falls back to the breed');
});

t('a new team keeps its hat, starts where its preset says, and has passed nothing', () => {
  const made = makeTeam({ handlerId: 'h', dogId: 'd', preset: 'mtg1', now: NOW, look: { coat: 'shepherd', jacket: 'red', hat: 'beanie' } });
  assert.equal(made.startLevel, 26);
  assert.equal(made.placedAt, NOW);
  assert.deepEqual(made.look, { coat: 'shepherd', jacket: 'red', harness: null, hat: 'beanie' });
  assert.deepEqual(made.best, { v: 1, level: 0, at: null });
  assert.equal(makeTeam({ handlerId: 'h', dogId: 'd', preset: 'new', now: NOW }).look.hat, null);
});

t('team rows on the dog: added, replaced, removed and marked, never in place', () => {
  const owner = makeTeam({ handlerId: 'owner', dogId: 'd', preset: 'new', now: NOW });
  const trainer = makeTeam({ handlerId: 'trainer', dogId: 'd', preset: 'mtg1', now: NOW });
  const dog = { id: 'd', handlerId: 'owner', name: 'Rex', teams: [owner] };
  const both = putTeam(dog, trainer);
  assert.equal(both.length, 2, 'a dog can be in more than one team');
  assert.equal(dog.teams.length, 1, 'the dog it was given is not touched');
  assert.equal(teamOf({ ...dog, teams: both }, 'trainer').startLevel, 26);

  /* teamsOf hands the engine the dog's id on each row; the dog does not store it. */
  const fromEngine = teamsOf({ ...dog, teams: both }).find(x => x.handlerId === 'trainer');
  const again = putTeam({ ...dog, teams: both }, { ...fromEngine, look: { ...fromEngine.look, jacket: 'plum' } });
  assert.equal(again.length, 2, 'the same handler again replaces their row');
  assert.equal(again[1].look.jacket, 'plum');
  assert.ok(!('dogId' in again[1]));

  assert.deepEqual(putTeam({ id: 'x' }, owner).map(r => r.handlerId), ['owner'], 'a dog with no teams yet');
  assert.deepEqual(dropTeam({ ...dog, teams: both }, 'trainer').map(r => r.handlerId), ['owner']);

  const best = { v: 1, level: 27, at: NOW };
  const marked = withBest({ ...dog, teams: both }, 'trainer', best);
  assert.deepEqual(marked[1].best, best);
  assert.deepEqual(marked[0].best, owner.best, 'the other team is left alone');
  assert.equal(withBest({ ...dog, teams: marked }, 'trainer', best), null, 'nothing to write when it already says so');
  assert.equal(withBest(dog, 'stranger', best), null, 'nor for a handler who is not in a team with the dog');
});

t('a team started again keeps what it earned and is placed afresh', () => {
  const team = { ...makeTeam({ handlerId: 'h', dogId: 'd', preset: 'mtg1', now: NOW }), best: { v: 1, level: 0, at: null } };
  const lower = restartTeam(team, { level: 21, now: NOW + 5 });
  assert.equal(lower.startLevel, 21);
  assert.equal(lower.placedAt, NOW + 5, 'the placement check starts again from now');
  assert.equal(lower.preset, 'mtg1', 'what the handler said the dog could do is still on record');
  assert.deepEqual(lower.best, team.best);
  const other = restartTeam({ ...team, best: { v: 1, level: 27, at: NOW } }, { preset: 'runaways', now: NOW + 9 });
  assert.deepEqual([other.preset, other.startLevel, other.best.level], ['runaways', 6, 27]);
  assert.equal(restartTeam(team, { level: 0, now: NOW }).startLevel, 1, 'never below the first level');
  assert.equal(restartTeam(team, { level: 500, now: NOW }).startLevel, 100);
});

t('the level on the chip is the stone the team stands on', () => {
  assert.equal(levelChip(fresh()), 'Start · Hot', 'a new team stands on no stone yet');
  assert.equal(earnedName(fresh()), 'New team', 'and has earned no name');
  assert.equal(levelChip(at(22)), 'L22 · Warm');
  assert.equal(levelChip(at(15)), 'L15 · Hot', 'on the boss stone, still in the meadow it has just crossed');
  assert.equal(levelChip(at(100)), 'L100 · Cold');
  assert.equal(levelChip(null), '');
  assert.equal(pairName(' Rémi ', 'Rex'), 'Rémi & Rex');
  assert.equal(pairName('', 'Rex'), 'Rex');
});

t('a team placed by a preset wears no level, name or title it has not earned', () => {
  /* Placed at 26, nothing passed: the engine stands it on 25, which is where
     it is drawn. It is not "L25, Turn Finder V" for having picked a preset. */
  const placed = fresh('mtg1');
  assert.equal(placed.passed, 25);
  assert.equal(proven(placed), false);
  assert.equal(levelChip(placed), 'Starts at L26 · Warm');
  assert.equal(chipStage(placed), 'warm');
  assert.equal(earnedName(placed), 'New team');
  assert.equal(meterWords(placed), 'Starts at level 26');
  const cold = fresh('experienced');
  assert.deepEqual([levelChip(cold), earnedName(cold), chipStage(cold)], ['Starts at L46 · Cold', 'New team', 'cold']);
  /* Its first pass is its own, and from then on it is where it stands. */
  const passed = { ...placed, passed: 26, level: 27, earned: 26, name: levelSpec(26).name, placement: { ...placed.placement, state: 'passed' } };
  assert.equal(proven(passed), true);
  assert.deepEqual([levelChip(passed), earnedName(passed), meterWords(passed)], ['L26 · Warm', levelSpec(26).name, 'Level 26 of 100']);
  /* A new team, and one that has climbed from the bottom. */
  assert.deepEqual([proven(fresh()), meterWords(fresh()), chipStage(fresh())], [false, 'At the start', 'hot']);
  assert.deepEqual([proven(at(22)), meterWords(at(22)), chipStage(at(22)), chipStage(at(100))], [true, 'Level 22 of 100', 'warm', 'cold']);
  /* Moved up by hand from 21 to 46: it keeps the name of the last level it
     passed itself, and the title of the boss it ran for. */
  const team = { ...makeTeam({ handlerId: 'h', dogId: 'd', preset: 'new', now: NOW - 9e6 }), dogId: 'd', best: { v: 1, level: 21, at: NOW - 8e6 } };
  const was = teamLevel([], team, { now: NOW });
  assert.deepEqual([was.passed, was.title, teamTitle(was, team)], [21, 'Trail Hound', 'Trail Hound']);
  const moved = restartTeam(team, { preset: 'experienced', now: NOW, lv: was, day: dayKey(NOW, 0) });
  assert.equal(moved.titleKept, 15);
  const lv = teamLevel([], moved, { now: NOW });
  assert.deepEqual([lv.passed, lv.earned, lv.title], [45, 21, null], 'the engine alone has lost the title');
  assert.deepEqual([earnedName(lv), levelChip(lv), meterWords(lv), teamTitle(lv, moved)], [levelSpec(21).name, 'Starts at L46 · Cold', 'Starts at level 46', 'Trail Hound']);
  /* A boss in the gap it stepped over is not its title, whatever the engine says for a moment. */
  assert.equal(teamTitle({ ...lv, earned: 46, passed: 46, level: 47, title: 'x', titleLevel: 45 }, moved), 'Trail Hound');
  assert.equal(teamTitle(fresh('experienced'), null), null);
  assert.equal(teamTitle(null, null), null);
});

t('a team placed again today hands on the runs it has counted', () => {
  const team = { ...makeTeam({ handlerId: 'h', dogId: 'd', preset: 'experienced', now: NOW - 9e6 }), dogId: 'd' };
  const lv = { ...teamLevel([], team, { now: NOW }), counted: { today: 2, max: 3, left: 1 } };
  const moved = restartTeam(team, { level: 41, now: NOW, lv, day: dayKey(NOW, 0) });
  assert.deepEqual(moved.capCarry, { day: dayKey(NOW, 0), used: 2 });
  assert.equal(teamLevel([], moved, { now: NOW, tzMin: 0 }).counted.today, 2, 'the engine counts them');
  /* Nothing counted, nothing carried; and an old carry does not ride on. */
  assert.equal('capCarry' in restartTeam(moved, { level: 36, now: NOW + 864e5, lv: { counted: { today: 0 } }, day: dayKey(NOW + 864e5, 0) }), false);
  assert.equal('capCarry' in restartTeam(team, { level: 41, now: NOW }), false);
});

t('the bar is as wide as each stage and filled as far as the team has passed', () => {
  assert.deepEqual(stageBar(0).map(b => [b.key, b.span, b.fill]), [['hot', 15, 0], ['warm', 30, 0], ['cold', 55, 0]]);
  const b = stageBar(22);
  assert.equal(b[0].fill, 1);
  assert.ok(Math.abs(b[1].fill - 7 / 30) < 1e-9, '7 of the 30 Warm levels');
  assert.equal(b[2].fill, 0);
  assert.deepEqual(stageBar(100).map(x => x.fill), [1, 1, 1]);
});

t('the team stands on the last stone it passed itself, or just short of where it starts', () => {
  assert.deepEqual(standing(fresh()), { before: 1 }, 'a new team waits at the trailhead');
  assert.deepEqual(standing(fresh('mtg1')), { before: 26 }, 'a placed team stands just before its starting stone');
  assert.deepEqual(standing(at(7)), { on: 7 });
  assert.deepEqual(standing({ ...at(26, 'mtg1') }), { on: 26 }, 'once it has passed its first stone it is on it');
  assert.deepEqual(standing(at(100)), { on: 100 });
  assert.deepEqual(standing(null), { before: 1 });
});

t('a stone is passed, stepped over by the preset, next, or ahead', () => {
  const lv = at(27, 'mtg1');
  assert.equal(stoneStatus(27, lv), 'passed');
  assert.equal(stoneStatus(26, lv), 'passed');
  assert.equal(stoneStatus(25, lv), 'skipped', 'a level the preset stepped over was never run');
  assert.equal(stoneStatus(28, lv), 'next');
  assert.equal(stoneStatus(29, lv), 'ahead');
  assert.equal(stoneStatus(100, at(100)), 'passed');
  assert.equal(stoneStatus(5, null), 'ahead', 'with no team every stone is still ahead');
});

t('lengths are said in the app’s units, and nothing else is touched', () => {
  assert.equal(inUnits('300 m', false), '300 m', 'metric is the engine’s own words');
  assert.equal(inUnits('300 m', true), '328 yd');
  assert.equal(inUnits('1600 m', true), '1,750 yd', 'yards right up to a mile');
  assert.equal(inUnits('1700 m', true), '1.1 mi');
  /* No two neighbouring levels with different lengths read the same: 900 m
     and 1000 m were both "0.6 mi", and the card said "New: 0.6 mi". */
  for (let n = 2; n <= 100; n++) {
    const a = levelSpec(n - 1).lengthM, b = levelSpec(n).lengthM;
    if (a !== b) assert.notEqual(inUnits(`${a} m`, true), inUnits(`${b} m`, true), `L${n - 1} and L${n}`);
  }
  assert.deepEqual(levelCard(90, null, { imperial: true }).news, ['1,094 yd']);
  assert.equal(inUnits('Not counted: 96 of 120 m, too short', true), 'Not counted: 105 of 131 yd, too short');
  assert.equal(inUnits('found within 28 min', true), 'found within 28 min', 'minutes are not metres');
  assert.equal(inUnits('30 min old', true), '30 min old');
  assert.equal(inUnits('no earlier start within 300 m', true), 'no earlier start within 328 yd');
  assert.equal(inUnits('a mark within 30 m of the end', true), 'a mark within 33 yd of the end');
  assert.equal(inUnits('laid at 9 km/h', true), 'laid at 6 mph');
  assert.equal(inUnits(null, true), '');
});

t('the checklist: ticked or not, what is new in gold, and how near the best try came', () => {
  const blank = judge(22, null).checklist;
  const rows = checkRows(blank, ['turns']);
  assert.deepEqual(rows.map(r => r.key), blank.map(c => c.key));
  assert.ok(rows.every(r => !r.ok && r.got === null), 'a blank checklist has nothing ticked');
  assert.deepEqual(rows.filter(r => r.isNew).map(r => r.key), ['turns']);
  const tried = blank.map(c => (c.key === 'length' ? { ...c, got: '250 m', ok: false } : c.key === 'age' ? { ...c, got: '31 min', ok: true }
    : c.key === 'start' ? { ...c, got: 'Watched', ok: false } : c));
  const shown = checkRows(tried, [], { imperial: true });
  const by = (k) => shown.find(r => r.key === k);
  assert.equal(by('length').text, inUnits(blank.find(c => c.key === 'length').text, true));
  assert.equal(by('length').got, '273 yd', 'what the best try managed, in the app’s units');
  assert.equal(by('age').got, null, 'a ticked row needs no "so far"');
  assert.equal(by('start').got, null, 'only figures are shown beside what was asked');
});

t('what is new at a level, in the words of its checklist', () => {
  assert.deepEqual(newWords(1), ['20 m']);
  assert.deepEqual(newWords(16), ['article start', 'coach off', 'found within 24 min']);
  assert.deepEqual(newWords(21), ['1 turn']);
  assert.deepEqual(newWords(15), ['300 m', 'indication at the find', 'boss: First Trail']);
  assert.deepEqual(newWords(21, { imperial: true }), ['1 turn']);
  assert.deepEqual(newWords(2, { imperial: true }), ['44 yd']);
  assert.deepEqual(newWords(101), []);
  for (let n = 1; n <= 100; n++) assert.ok(newWords(n).every(w => typeof w === 'string' && w), `level ${n}`);
});

t('the card for the next level, a passed stone, one stepped over and one ahead', () => {
  const lv = at(27, 'mtg1');
  const next = levelCard(28, lv);
  assert.equal(next.kicker, 'Next · level 28');
  assert.equal(next.name, levelSpec(28).name);
  assert.equal(next.stageLabel, 'Warm');
  assert.deepEqual(next.rows.map(r => r.key), lv.next.checklist.map(c => c.key), 'the next level shows the engine’s own checklist');
  const passed = levelCard(26, lv);
  assert.equal(passed.kicker, 'Passed · level 26');
  assert.ok(passed.rows.every(r => r.ok), 'a passed stone is all ticks');
  const skipped = levelCard(12, lv);
  assert.equal(skipped.kicker, 'Before your start · level 12');
  assert.ok(skipped.rows.every(r => !r.ok), 'a level never run is not ticked');
  const ahead = levelCard(75, lv);
  assert.equal(ahead.kicker, 'Ahead · level 75');
  assert.deepEqual([ahead.boss, ahead.bossName, ahead.title], [true, 'The Town', 'Town Hound']);
  assert.deepEqual(ahead.also, levelSpec(75).also);
  assert.equal(levelCard(8, null).status, 'ahead', 'a pair that is not a team sees what each stone asks');
  assert.equal(levelCard(0, lv), null);
  for (let n = 1; n <= 100; n++) assert.ok(levelCard(n, lv).rows.length >= 3, `level ${n} has a checklist`);
});

t('a stone read aloud says its level, name, what it asks and where the team is', () => {
  assert.equal(stoneLabel(8, at(7)), 'Level 8, Line Puller III, 120 m, 3 min old, next');
  assert.equal(stoneLabel(15, at(7)), 'Level 15, Scent Reader V, boss: First Trail, 300 m, 10 min old, ahead');
  assert.equal(stoneLabel(3, at(7)), 'Level 3, Puppy Nose III, 60 m, passed');
  assert.equal(stoneLabel(3, fresh('mtg1')), 'Level 3, Puppy Nose III, 60 m, before your start');
  assert.equal(stoneLabel(8, at(7), { imperial: true }), 'Level 8, Line Puller III, 131 yd, 3 min old, next');
});

t('the last tries say whether each counted, and why, in the engine’s words', () => {
  const rows = tryRows([
    { id: 'c', at: NOW, level: 8, verdict: 'pass', why: 'Passed: 122 m, 3 min old, found in 2 min' },
    { id: 'b', at: NOW - 864e5, level: 8, verdict: 'miss', why: 'Missed: not found' },
    { id: 'a', at: NOW - 2 * 864e5, level: 8, verdict: 'notCounted', why: 'Not counted: 96 of 120 m, too short' },
  ], { imperial: true, when: (x) => `d${(NOW - x) / 864e5}` });
  assert.deepEqual(rows.map(r => [r.kind, r.mark, r.says, r.when]), [['yes', '✓', 'Counted', 'd0'], ['miss', '✕', 'Missed', 'd1'], ['no', '–', 'Not counted', 'd2']]);
  assert.equal(rows[0].why, 'Passed: 133 yd, 3 min old, found in 2 min');
  assert.equal(rows[2].why, 'Not counted: 105 of 131 yd, too short');
  assert.deepEqual(tryRows(null), []);
});

t('each state the engine reports is said once, in plain words, with what to do', () => {
  assert.deepEqual(teamStates(fresh()), [], 'a new team at level 1 has nothing to be told');
  const keys = (lv, o) => teamStates(lv, o).map(s => s.key);

  const pending = teamStates(fresh('mtg1'));
  assert.deepEqual(pending.map(s => s.key), ['placement']);
  assert.match(pending[0].text, /^You started at level 26\. Pass it within your next 2 counted runs to stay here\.$/);
  assert.equal(pending[0].action, null);

  const suggest = teamStates({ ...fresh('mtg1'), placement: { state: 'suggest', startLevel: 26, triesLeft: 0, suggest: 21 } })[0];
  assert.match(suggest.text, /Level 21 would suit better for now\. Nothing is lost\./);
  assert.deepEqual(suggest.action, { id: 'placeLower', label: 'Start at level 21', level: 21 }, 'a suggestion, taken with one tap');

  const ease = teamStates({ ...at(22), easeOff: { misses: 2, suggest: 21 } }).find(s => s.key === 'easeOff');
  assert.equal(ease.title, 'Ease off');
  assert.equal(ease.text, '2 misses in a row. Run level 21 next, so the day ends on a find.');

  const rusty = teamStates({ ...at(22), rusty: { since: NOW - 40 * 864e5, days: 40, suggest: 21 } }).find(s => s.key === 'rusty');
  assert.equal(rusty.text, '40 days since a counted run. One pass at level 21 clears it.');

  const heat = teamStates({ ...at(14), heat: { tempC: 27.4, bossWaits: true } }).find(s => s.key === 'heat');
  assert.equal(heat.text, '27 °C on the last run, above 25 °C. Keep it short, with shade and water. The boss waits for a cooler run.');
  const heatF = teamStates({ ...at(12), heat: { tempC: 27.4, bossWaits: false } }, { fahrenheit: true }).find(s => s.key === 'heat');
  assert.equal(heatF.text, '81 °F on the last run, above 77 °F. Keep it short, with shade and water.');

  const gate = teamStates({ ...at(45), gate: { level: 46, months: 13, needMonths: 15 } }, { dogName: 'Rex' }).find(s => s.key === 'gate');
  assert.equal(gate.text, 'Level 46 is for dogs from 15 months. Rex is 13.');

  const some = teamStates({ ...at(3), counted: { today: 2, max: 5, left: 3 } }).find(s => s.key === 'cap');
  assert.deepEqual([some.tone, some.text], ['quiet', '2 counted runs today, 3 more can count.']);
  const full = teamStates({ ...at(22), counted: { today: 3, max: 3, left: 0 } }).find(s => s.key === 'cap');
  assert.deepEqual([full.tone, full.title], ['warn', 'Enough for today']);
  assert.match(full.text, /3 counted runs today, and 3 is the limit\./);

  assert.deepEqual(keys(at(100)), ['done']);
  assert.deepEqual(teamStates(null), []);
});

t('the card never gives two instructions that contradict each other', () => {
  const keys = (lv) => teamStates(lv, { dogName: 'Rex' }).map(s => s.key);
  /* Too young for the level it was placed at: "not yet", and no "pass it
     within two runs to stay here" above it. */
  const young = { ...fresh('experienced'), gate: { level: 46, months: 13, needMonths: 15 } };
  assert.deepEqual(keys(young), ['gate']);
  /* Two placement misses: start five lower, said once. */
  const placed = { ...fresh('experienced'), placement: { state: 'suggest', startLevel: 46, triesLeft: 0, suggest: 41 }, easeOff: { misses: 2, suggest: 41 },
    counted: { today: 2, max: 3, left: 1 } };
  assert.deepEqual(keys(placed), ['placement', 'cap']);
  /* Three misses today in Cold: no "run level 56 next" beside "nothing more counts". */
  const spent = teamStates({ ...at(59), easeOff: { misses: 3, suggest: 56 }, counted: { today: 3, max: 3, left: 0 } });
  assert.deepEqual(spent.map(s => s.key), ['easeOff', 'cap']);
  assert.equal(spent[0].text, '3 misses in a row. End on an easy find for fun; it will not count today.');
  assert.equal(spent[1].text, '3 counted runs today, and 3 is the limit.');
  /* The cap alone still says what it means. */
  assert.match(teamStates({ ...at(59), counted: { today: 3, max: 3, left: 0 } })[0].text, /Any more today is play: it will not count\.$/);
});

t('the debrief asks Start of a team’s run, and Setting from level 66', () => {
  assert.deepEqual(LEVEL_FIELDS.map(f => f.id), ['start', 'setting']);
  assert.deepEqual(LEVEL_FIELDS[0].options.map(o => o.v), STARTS.map(s => s.id), 'the ids the engine reads');
  assert.deepEqual(LEVEL_FIELDS[1].options.map(o => o.v), SETTINGS.map(s => s.id));
  assert.ok(LEVEL_FIELDS.every(f => f.sticky && !f.required && f.label && f.why), 'sticky, never required to save, and explained');
  assert.deepEqual(levelFields(null), [], 'a run that is nobody’s try is asked nothing more');
  assert.deepEqual(levelFields(7).map(f => f.id), ['start']);
  assert.deepEqual(levelFields(SETTING_FROM - 1).map(f => f.id), ['start']);
  assert.deepEqual(levelFields(SETTING_FROM).map(f => f.id), ['start', 'setting']);
  assert.deepEqual(levelFields(null, { start: 'watched' }).map(f => f.id), ['start'], 'an answer already given can still be seen');
  assert.deepEqual(levelFields(7, { setting: 'town' }).map(f => f.id), ['start', 'setting']);
  /* A runaway nobody laid, in Hot: how long ago the person left is asked here too. */
  assert.deepEqual(levelFields(7, null, { noLine: true }).map(f => f.id), ['start', 'leftAgo']);
  assert.deepEqual(levelFields(20, null, { noLine: true }).map(f => f.id), ['start'], 'from Warm a level needs a laid trail');
  assert.deepEqual(LEFT_FIELD.options.map(o => Number(o.v)), [...LEFT_AGO]);
  assert.equal(LEFT_FIELD.sticky, false, 'never carried from the last runaway');
});

t('the debrief asks for every answer the level will not count a run without', () => {
  assert.deepEqual(levelNeeds(1), ['start']);
  assert.deepEqual(levelNeeds(15), ['start']);
  assert.deepEqual(levelNeeds(16), ['start', 'help'], 'the coach is off from 16, so the help given must be said');
  assert.deepEqual(levelNeeds(46), ['start', 'help', 'blind'], 'and from 46 who knew the route');
  assert.deepEqual(levelNeeds(SETTING_FROM), ['start', 'help', 'blind'], 'the setting row is offered from 66, and needed only where a level names one');
  assert.deepEqual(levelNeeds(70), ['start', 'help', 'blind', 'setting']);
  assert.deepEqual(levelNeeds(3, { noLine: true }), ['start'], 'the first five levels ask no age');
  assert.deepEqual(levelNeeds(6, { noLine: true }), ['start', 'leftAgo']);
  assert.deepEqual(levelNeeds(null), []);
  /* Held against the engine: a perfect run with exactly those answered is
     never refused for a missing answer, and without any one of them it is. */
  for (const n of [1, 16, 46, 70, 88, 100]) {
    const L = levelSpec(n);
    const full = { start: L.start, help: 'none', blind: L.blind ?? 'open', setting: L.setting ?? 'rural' };
    for (const id of levelNeeds(n)) {
      const facts = { ...full, [id]: null };
      const why = judge(L, { ran: true, person: true, found: true, coach: false, peeked: false, ...facts }).checklist;
      assert.ok(why.some(c => c.key === id && !c.ok), `L${n} checks ${id}`);
    }
  }
  /* The reason names the row as the debrief heads it, and the result line can open the debrief. */
  assert.equal(plainWhy('Not counted: start type is not answered in the debrief'), 'Not counted: “Start” is not answered in the debrief');
  assert.equal(plainWhy('Not counted: help given is not answered in the debrief'), 'Not counted: “Help you gave” is not answered in the debrief');
  assert.equal(plainWhy('Not counted: who knew the route is not answered in the debrief'), 'Not counted: “Who knew the answer” is not answered in the debrief');
  assert.equal(plainWhy('Not counted: setting is not answered in the debrief'), 'Not counted: “Setting” is not answered in the debrief');
  assert.equal(plainWhy('Not counted: setting was Rural, this level needs Town'), 'Not counted: setting was Rural, this level needs Town');
  const unanswered = { id: 'a', verdict: 'notCounted', why: 'Not counted: start type is not answered in the debrief' };
  assert.equal(debriefWouldFix(unanswered), true);
  assert.equal(debriefWouldFix({ id: 'b', verdict: 'miss', why: 'Missed: not found' }), false);
  assert.equal(debriefWouldFix(null), false);
  assert.equal(resultLine(unanswered, []).text, 'Not counted: “Start” is not answered in the debrief');
  /* A runaway with no age: the reason says what was not said, and where to say it. */
  const noAge = { id: 'c', verdict: 'notCounted', why: 'Not counted: trail age unknown' };
  assert.equal(resultLine(noAge, [], { noLine: true }).text, 'Not counted: nobody said how long ago the person left');
  assert.equal(resultLine(noAge, []).text, 'Not counted: trail age unknown', 'a laid trail with no age is another matter');
  assert.deepEqual([debriefWouldFix(noAge, { noLine: true }), debriefWouldFix(noAge)], [true, false]);
  assert.equal(tryRows([noAge], { noLine: (id) => id === 'c' })[0].why, 'Not counted: nobody said how long ago the person left');
  /* The debrief's own rows by those names. */
  const debriefSrc = readFileSync(new URL('../public/debrief.js', import.meta.url), 'utf8');
  for (const label of ['Help you gave', 'Who knew the answer']) assert.ok(debriefSrc.includes(`label: '${label}'`), label);
});

t('the level rows remember the handler’s last answers, and only real ones', () => {
  const both = levelFields(70);
  assert.deepEqual(stickyLevel(both, { start: 'article', setting: 'semi', outcome: 'found' }), { start: 'article', setting: 'semi' });
  assert.deepEqual(stickyLevel(levelFields(7), { start: 'article', setting: 'semi' }), { start: 'article' }, 'only the rows this debrief asks');
  assert.deepEqual(stickyLevel(both, { start: 'teleported' }), {}, 'an answer that is not an option is not carried');
  assert.deepEqual(stickyLevel(both, null), {});
  assert.deepEqual(stickyLevel([], { start: 'article' }), {});
});

t('Start is still remembered after a hide search, or a trail with another dog, came in between', () => {
  const own = (id, dogId, debrief, more = {}) => ({ id, handlerId: 'h', dogId, data: { debrief }, ...more });
  const fields = levelFields(70);
  const now = { id: 'now', handlerId: 'h', dogId: 'rex', data: {} };
  /* Newest first, as the store hands them over. */
  const sessions = [
    own('hides', 'rex', { outcome: 'found' }),                                  // a hide search: no Start in it
    own('fen', 'fen', { outcome: 'found', start: 'watched', setting: 'town' }),  // another dog
    own('rex1', 'rex', { outcome: 'found', start: 'article' }),                  // this dog, further back
    own('theirs', 'rex', { start: 'lastPoint', setting: 'semi' }, { handlerId: 'other' }),
  ];
  assert.deepEqual(stickyLevel(fields, sessions[0].data.debrief), {}, 'the last debrief alone has nothing to hand on');
  assert.deepEqual(stickyLevelFrom(sessions, now, fields), { start: 'article', setting: 'town' },
    'each row from the newest run that has it, this dog’s first, and never another handler’s');
  assert.deepEqual(stickyLevelFrom(sessions, now, levelFields(7)), { start: 'article' });
  assert.deepEqual(stickyLevelFrom([now, own('x', 'rex', { start: 'teleported' })], now, fields), {}, 'not the run itself, and only real answers');
  assert.deepEqual(stickyLevelFrom(sessions, now, [LEFT_FIELD]), {}, 'a runaway’s age is never carried');
  assert.deepEqual(stickyLevelFrom(null, now, fields), {});
});

t('a run is stamped with the level its team is on, and nothing when there is none', () => {
  assert.deepEqual(tryStamp(fresh()), { v: LADDER_V1.v, level: 1 });
  assert.deepEqual(tryStamp(fresh('experienced')), { v: 1, level: 46 });
  assert.equal(tryStamp(at(100)), null, 'every level passed: a run is simply a run');
  assert.equal(tryStamp(null), null);
});

t('"the person left" offers the ages Hot asks for', () => {
  const hot = LADDER_V1.levels.filter(l => l.stage === 'hot').map(l => l.ageMin);
  for (const m of hot) assert.ok(LEFT_AGO.includes(m), `${m} min is a Hot age`);
  assert.equal(Math.max(...LEFT_AGO), Math.max(...hot), 'and nothing longer');
  assert.equal(leftAgoLabel(0), 'Just now');
  assert.equal(leftAgoLabel(8), '8 min ago');
});

t('every preset can make a team', () => {
  for (const p of PRESETS) {
    const lv = fresh(p.id);
    assert.equal(lv.level, p.startLevel, p.label);
    assert.ok(levelChip(lv) && earnedName(lv));
    assert.ok(standing(lv).before === p.startLevel);
  }
});

/* ── In the store ─────────────────────────────────────────────────── */

const memory = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } };
};

t('a handler’s dogs are their own and any they are in a team with', () => {
  const db = createStore(memory());
  db.handlers.upsert({ id: 'owner', name: 'Sophie' });
  db.handlers.upsert({ id: 'trainer', name: 'Rémi' });
  db.dogs.upsert({ id: 'rex', handlerId: 'owner', name: 'Rex', level: 'Hot', lineM: 10 });
  db.dogs.upsert({ id: 'fly', handlerId: 'trainer', name: 'Fly', level: 'Hot', lineM: 10 });
  db.kv.set('lastHandlerId', 'trainer');
  assert.deepEqual(db.snapshot().team.map(d => d.id), ['fly'], 'before the team, only their own');

  const rex = db.dogs.byId('rex');
  db.dogs.upsert({ ...rex, teams: putTeam(rex, makeTeam({ handlerId: 'trainer', dogId: 'rex', preset: 'mtg1', now: NOW })) });
  assert.deepEqual(db.snapshot().team.map(d => d.id).sort(), ['fly', 'rex'], 'a board-and-train dog shows in the trainer’s list');
  assert.equal(db.dogs.byId('rex').handlerId, 'owner', 'without changing hands');
  assert.deepEqual(dogsWorkedBy(db.dogs.all(), 'owner').map(d => d.id), ['rex']);
  assert.deepEqual(dogsOf(db.dogs.all(), 'trainer').map(d => d.id), ['fly'], 'dogsOf is still the dogs that are theirs');

  /* Deleting the trainer takes their own dog, and only their team with Rex. */
  db.deleteHandler('trainer');
  assert.deepEqual(db.dogs.all().map(d => d.id), ['rex'], 'the client’s dog is not deleted with the trainer');
  assert.deepEqual(db.dogs.byId('rex').teams, [], 'but the team nobody holds the line of is gone');
});

t('the stamp on a run moves with the run when two phones’ copies meet', () => {
  for (const k of ['levelTry', 'tzMin', 'leftAgoMin']) assert.ok(RUN_FIELDS.includes(k), `${k} belongs to one run, not to the trail`);
});

/* ── Wired into the app ───────────────────────────────────────────── */

const js = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/app.css', import.meta.url), 'utf8');
const fnSrc = (head) => {
  const i = js.indexOf(`\n${head}`);
  assert.ok(i > 0, `app.js still has ${head}`);
  return js.slice(i, js.indexOf('\n}\n', i) + 2);
};

t('a run is stamped as it starts, by the team picked on Home, and the stamp is saved with the run', () => {
  const start = fnSrc('async function startRun(s) {');
  assert.match(start, /run\.session = s;\s*\n\s*stampTry\(s, t\);/, 'stamped the moment the run takes its session');

  /* stampTry itself, run against a small fake. */
  const saved = [];
  const make = (lv) => new Function('S', 'levelOf', 'tryStamp', 'db', 'guardSave', 'Date', `${fnSrc('function stampTry(s, t) {')}; return stampTry;`)(
    { dog: { id: 'd' }, handler: { id: 'h' } }, () => lv, tryStamp,
    { sessions: () => [{ id: 's1' }], updateSession: (id, p) => saved.push([id, p]) }, (s, f) => f(),
    class { getTimezoneOffset() { return -60; } });
  const s = { id: 's1', data: { trail: [] } };
  make(fresh('article'))(s, { kind: 'person' });
  assert.deepEqual(s.data.levelTry, { v: 1, level: 11 }, 'the level the team is on, on the run in memory');
  assert.equal(s.data.tzMin, 60, 'and the phone’s clock against UTC');
  assert.deepEqual(saved, [['s1', { data: { levelTry: { v: 1, level: 11 }, tzMin: 60 } }]], 'written at once, so a recovered run still carries it');

  const again = { id: 's1', data: { levelTry: { v: 1, level: 11 } } };
  make(null)(again, { kind: 'person' });
  assert.equal(again.data.levelTry, null, 'a pair that is not a team clears a stamp left by an earlier run of the trail');
  const hide = { id: 's1', data: {} };
  make(fresh())(hide, { kind: 'hide' });
  assert.ok(!('levelTry' in hide.data), 'a hide search is nobody’s try');
  const unsaved = { id: 'new', data: {} };
  saved.length = 0;
  make(fresh())(unsaved, { kind: 'person' });
  assert.deepEqual([unsaved.data.levelTry.level, saved.length], [1, 0], 'a session not on the phone yet is stamped in memory only');

  const stop = js.slice(js.indexOf('async function finishRun'), js.indexOf('/* ── The result'));
  assert.match(stop, /const stamp = s\.data\.levelTry !== undefined \? \{ levelTry: s\.data\.levelTry, tzMin: s\.data\.tzMin \} : \{\};/);
  assert.match(stop, /const raw = \{ data: \{ \.\.\.stamp, track: rec\.pts,/, 'said again with the walk, in case the first write was refused');
  assert.match(stop, /data: \{ \.\.\.stamp, track: rec\.pts, trackStarted: run\.startedAt, trackWaypoints: rec\.wps, \.\.\.unseen,/, 'and with the grade');
  assert.match(stop, /go\('scrResult'\);\s*\n\s*runLevelled\(run\.session\);/, 'the level is worked out once the result is on screen');
});

t('a runaway nobody laid can say how long the person has been gone, in Hot only', () => {
  const blind = fnSrc('function startBlind() {');
  assert.ok(blind.indexOf('s.data.leftAgoMin = leftAgo') > 0 && blind.indexOf('s.data.leftAgoMin = leftAgo') < blind.indexOf('db.addSession'),
    'on the session before it is saved');
  assert.match(blind, /if \(leftAgo !== null && leftAgoAsked\(\)\) s\.data\.leftAgoMin = leftAgo;/, 'optional: unanswered, nothing is written');
  assert.match(fnSrc('function leftAgoAsked() {'), /return !!lv && !lv\.done && lv\.stage === 'hot';/);
  assert.match(fnSrc('function openPick() {'), /leftAgo = null;/, 'never carried over from the last runaway');
  assert.ok(html.indexOf('id="leftAgoBox"') < html.indexOf('id="btnBlind"'), 'asked above the button it belongs to');
});

t('what a run did to its team’s level is handed on wherever its result is shown or changed', () => {
  const levelled = fnSrc('function runLevelled(s) {');
  assert.match(levelled, /targetById\(s\.targetId\)\.kind !== 'person'\) return null;/, 'only a person trail');
  assert.match(levelled, /takeBack\(s\);\s*\n\s*const dog = /, 'a level this run no longer earns is taken back first');
  assert.match(fnSrc('function paintResultLevel(s) {'), /lv\.events\.filter\(e => e\.sessionId === s\.id\)/, 'the line under a result is that run’s own doing');
  assert.match(levelled, /levelMoment\(\{ session: s, dog, handlerId: s\.handlerId, lv,/);
  assert.match(fnSrc('function saveDebrief() {'), /runLevelled\(s2\);/, 'a debrief edit');
  assert.match(fnSrc('async function applyLine(sessionId, line) {'), /runLevelled\(s2\);/, 'an added laid trail');
  assert.ok((js.match(/\brunLevelled\(/g) || []).length >= 7, 'the run’s end, its marks, its debrief, its walked card and its line');
  /* The mark that is kept, and nothing typed: the level is always worked out. */
  assert.match(fnSrc('function levelOf(dog, handlerId) {'), /if \(lv\.bestChanged\) keepBest\(dog\.id, handlerId, lv\.best\);/);
  assert.match(fnSrc('function keepBest(dogId, handlerId, best) {'), /const teams = dog && withBest\(dog, handlerId, best\);/);
});

t('the debrief draws the level’s rows with its own, and editing a dog keeps its teams', () => {
  assert.match(fnSrc('function paintDebrief() {'), /\$\('dbFields'\)\.innerHTML = debriefRows\(\)\.map\(f => `/);
  assert.match(fnSrc('function debriefRows() {'), /const all = \[\.\.\.DEBRIEF, \.\.\.dbLevelRows\];/);
  assert.match(fnSrc('function debriefRows() {'), /return \[\.\.\.all\.filter\(f => f\.required\), \.\.\.need, /, 'what the level needs comes straight after the two every run needs');
  assert.match(fnSrc('function openDebrief(s) {'), /if \(!s\.data\.debrief\) Object\.assign\(dbDraft, stickyLevel\(dbLevelRows, last\), stickyLevelFrom\(/,
    'sticky on a fresh debrief only');
  assert.match(fnSrc('function saveDebrief() {'), /const todo = debriefTodo\(d\);\s*\n\s*if \(todo\.length\) \{/, 'Save waits for the level’s rows as it does for the outcome');
  assert.match(fnSrc('function saveDebrief() {'), /\.\.\.\(Number\.isFinite\(left\) \? \{ leftAgoMin: left \} : \{\}\),/, 'a runaway’s age goes on the run, not in the debrief');
  assert.match(fnSrc('function debriefLevelRows(s) {'), /const level = !lv \? null : Number\.isInteger\(stamped\) \? stamped : lv\.level;/,
    'the level the run was a try at; nothing asked when its pair is not a team');
  assert.match(fnSrc('function saveDogForm() {'), /\{ teams: db\.dogs\.byId\(obMode\.id\)\.teams \}/, 'the form writes the whole dog');
});

t('a team is only ever made on purpose', () => {
  /* The board for a pair that is not a team shows where one would start and
     offers to make it; nothing is saved until the form's button is pressed. */
  const now = fnSrc('function teamNow() {');
  assert.match(now, /const team = teamOf\(d, h\.id\);/);
  assert.ok(!/upsert/.test(now) && !/upsert/.test(fnSrc('function paintTeam() {')) && !/upsert/.test(fnSrc('function openTeam(handlerId, dogId) {')),
    'opening the board writes nothing');
  const made = [...js.matchAll(/makeTeam\(/g)].length;
  assert.equal(made, 1, 'one place makes a team');
  assert.match(fnSrc('function saveTeamForm() {'), /if \(had && !f\.edit\) return toast\(/, 'and never a second one for the same pair');
  assert.match(fnSrc('function moveTeam(handlerId, dogId, to) {'), /restartTeam\(team, \{ \.\.\.to, now: Date\.now\(\), lv: levelOf\(dog, handlerId\), day: dayKey\(Date\.now\(\), tzNow\(\)\) \}\)/,
    'the lower start is taken with placedAt now, and the day’s counted runs handed on');
  /* An existing team is only moved on purpose: behind its own button, to a
     start above what it has passed, and after a yes. */
  const save = fnSrc('function saveTeamForm() {');
  assert.match(save, /const moved = !!had && f\.preset != null && teamMoves\(levelOf\(dog, f\.handlerId\)\)\.some\(p => p\.id === f\.preset\);/);
  assert.match(save, /if \(!confirm\(`\$\{pair\} will start at level \$\{presetById\(f\.preset\)\.startLevel\}\. Levels already passed are kept\.`\)\) return;/);
  assert.match(fnSrc('function teamMoves(lv) {'), /TEAM_PRESETS\.filter\(p => p\.startLevel > lv\.earned && p\.startLevel !== lv\.level\)/);
  assert.match(fnSrc('function openTeamForm('), /preset: edit && team \? null : team\?\.preset \?\? 'new'/, 'opened to edit, no start is picked');
});

t('Animations: the setting, the address and the phone decide once, for the board and its rings', () => {
  assert.match(js, /const teamMotion = \(\) => motionOn\(motionChoice\(settings\.motion, motionAsked\), reducedQuery\.matches\);/);
  assert.match(js, /const motionAsked = new URLSearchParams\(location\.search\)\.get\('motion'\);/);
  assert.match(fnSrc('function applyMotion() {'), /document\.documentElement\.dataset\.motion = on \? 'on' : 'off';/);
  assert.match(fnSrc('function boot() {'), /applyMotion\(\);/);
  for (const m of MOTIONS) assert.match(html, new RegExp(`<button type="button" class="check-row" data-value="${m.id}"><span class="check-text"><b>${m.label}</b>`));
  /* The board's own loops run from the attribute, never from the phone's
     Reduce Motion alone: On has to animate on a phone that has it switched on. */
  const board = css.slice(css.indexOf('/* ── Teams and the trail board'), css.indexOf('/* ── A light gold rim'));
  const moving = [...board.matchAll(/([^{}]+)\{[^{}]*animation:[^{}]*\}/g)].map(m => m[1].trim());
  assert.ok(moving.length >= 3, 'the ring and the pointer');
  for (const sel of moving) assert.match(sel, /^html\[data-motion="on"\] /, `${sel} only moves when Animations says so`);
});

t('the board’s stones are real buttons, big enough for a thumb', () => {
  const rule = css.match(/\n\.tb-stone \{([^}]*)\}/)[1];
  const w = +rule.match(/width: (\d+)px/)[1], h = +rule.match(/height: (\d+)px/)[1];
  assert.ok(w >= 44 && h >= 44, `${w} × ${h}`);
  const boardJs = readFileSync(new URL('../public/board.js', import.meta.url), 'utf8');
  assert.match(boardJs, /const b = el\('button', 'tb-stone'\);\s*\n\s*b\.type = 'button';/);
  assert.match(boardJs, /labels\.set\(lk, stoneLabel\(l, view, \{ imperial: o\.imperial \}\)\);/, 'each says its level, name and state');
  assert.match(boardJs, /b\.setAttribute\('aria-label', labels\.get\(lk\)\);/);
  assert.match(boardJs, /b\.setAttribute\('aria-pressed', String\(l === selected\)\);/);
});

/* ── A level taken back ───────────────────────────────────────────── */
const T = Date.UTC(2026, 5, 1, 12), MINUTE = 60e3;
/** A straight person trail of level 1's length, laid and run on this phone. */
function trailRun({ id, at = T, found = true, debrief = {} }) {
  const lengthM = levelSpec(1).lengthM + 2, n = Math.round(lengthM / 5);
  const shape = Array.from({ length: n + 1 }, (_, i) => project({ lat: 51.2, lon: -2.65 }, 0, lengthM * i / n));
  const trail = shape.map((p, i) => ({ ...p, t: Math.round(at + (lengthM * i / n) / 1.3 * 1000) }));
  const track = shape.map((p, i) => ({ lat: p.lat, lon: p.lon + 0.00003, t: Math.round(at + 4 * MINUTE * i / n) }));
  const end = track[track.length - 1];
  return { id, handlerId: 'h', dogId: 'd', layerId: null, targetId: 'person', startedAt: at, updatedAt: at, summary: '',
    data: { trail, track, trackStarted: at, trackWaypoints: found ? [{ kind: 'Indication', lat: end.lat, lon: end.lon, t: end.t }] : [],
      result: { ageMin: 0 }, runWeather: { temp: 15 }, ...(found ? { found: true } : {}),
      debrief: { v: 1, outcome: found ? 'found' : 'missed', target: 'real', blind: 'open', help: 'none', start: 'watched', ...debrief } } };
}

t('a level banked by a wrong tap in the debrief comes back down when the debrief is put right', () => {
  const team = { ...makeTeam({ handlerId: 'h', dogId: 'd', preset: 'new', now: T - 864e5 }), dogId: 'd' };
  const opts = { now: T + 36e5, tzMin: 0 };
  const good = trailRun({ id: 'r1' });
  const lv = teamLevel([good], team, opts);
  assert.ok(lv.passed >= 1 && lv.bestChanged, 'saved as found, it passes');
  const banked = { ...team, best: lv.best, shown: lv.passed };
  /* A minute later the handler corrects it: the dog did not find. */
  const fixed = { ...good, data: { ...good.data, found: false, debrief: { ...good.data.debrief, outcome: 'missed' } } };
  const stuck = teamLevel([fixed], banked, opts);
  assert.equal(stuck.passed, lv.passed, 'the engine keeps the mark, on purpose: this is what the board then contradicted');
  assert.equal(stuck.tries[0].verdict, 'miss');
  const free = teamLevel([fixed], { ...banked, best: null }, opts);
  const row = takenBack(banked, free, lv.best.at, 4242);
  assert.deepEqual([row.best.level, row.shown, row.resetAt], [0, 0, 4242]);
  const after = teamLevel([fixed], row, opts);
  assert.deepEqual([after.passed, after.level, earnedName(after)], [0, 1, 'New team'], 'back at the start');
  /* Found after all: it passes again, and is celebrated again. */
  assert.ok(teamLevel([good], row, opts).bestChanged);
  assert.equal(shownLevel(row), 0);

  /* Left alone in every other case. */
  assert.equal(takenBack(banked, teamLevel([good], { ...banked, best: null }, opts), lv.best.at, 1), null, 'the run still earns it');
  assert.equal(takenBack(banked, free, lv.best.at + 1, 1), null, 'another run set the mark');
  assert.equal(takenBack({ ...banked, placedAt: lv.best.at + 1 }, free, lv.best.at, 1), null, 'a mark from before the team was last placed');
  assert.equal(takenBack({ ...team, best: null }, free, lv.best.at, 1), null);
  assert.equal(takenBack({ ...team, best: { v: 1, level: 30, at: null } }, free, null, 1), null, 'a mark with no date (a lost phone) is never lowered');
  /* Partly back: a mark of 3 whose run now only earns 1 keeps 1. */
  const part = takenBack({ ...banked, best: { ...lv.best, level: lv.best.level + 2 }, shown: lv.best.level + 2 }, teamLevel([good], { ...banked, best: null }, opts), lv.best.at, 7);
  assert.deepEqual([part.best.level, part.shown], [lv.best.level, lv.best.level]);
  /* Wired where a run's record changes, and the level is worked out afresh after it. */
  const back = fnSrc('function takeBack(s) {');
  assert.match(back, /const free = teamLevel\(S\.sessions, \{ \.\.\.team, best: null \}/);
  assert.match(back, /levelCache\.delete\(team\.id\);/);
});

t('a team’s level is worked out again when any of its runs changes, not only the newest', () => {
  const sig = fnSrc('function levelOf(dog, handlerId) {');
  assert.match(sig, /sum \+= s\.updatedAt \|\| 0;/);
  assert.match(sig, /const sig = \[dog\.updatedAt, n, sum, new Date\(\)\.toDateString\(\)\]\.join\('\|'\);/);
  /* Why the sum: two runs, the older one changed on another phone to a stamp
     still below the newest. The count and the newest stamp do not move. */
  const before = [1000, 1500], after = [1200, 1500];
  assert.equal(Math.max(...before), Math.max(...after));
  assert.notEqual(before[0] + before[1], after[0] + after[1]);
});

t('deleting a handler says which teams on other people’s dogs go with them', () => {
  const dogs = [
    { id: 'rex', handlerId: 'owner', name: 'Rex', teams: [{ handlerId: 'owner' }, { handlerId: 'trainer' }] },
    { id: 'fen', handlerId: 'owner2', name: 'Fen', teams: [{ handlerId: 'trainer' }] },
    { id: 'own', handlerId: 'trainer', name: 'Moss', teams: [{ handlerId: 'trainer' }] },
  ];
  const trainer = { id: 'trainer', name: 'Sam' };
  assert.equal(askDelete('handler', { row: trainer, dogs: dogs.slice(0, 1), sessions: [] }),
    'Delete Sam? Sam’s profile goes, and cannot be got back. Their team with Rex and its level go too.');
  assert.equal(askDelete('handler', { row: trainer, dogs, sessions: [], backedUp: true }),
    'Delete Sam and their dog Moss? Both profiles go, and cannot be got back. Their teams with Rex and Fen and their levels go too. They go from your account backup too.');
  assert.equal(askDelete('handler', { row: { id: 'owner', name: 'Jo' }, dogs, sessions: [] }),
    'Delete Jo and their dog Rex? Both profiles go, and cannot be got back.', 'a team with their own dog is the dog’s, and is already said');
});

console.log(`\nteams: ${pass} checks passed`);
