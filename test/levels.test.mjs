/* Team levels, checked headlessly: the ladder against the approved design
   (docs/superpowers/specs/2026-10-09-team-levels-design.md), what a run can
   be checked against, every verdict and the words that go with it, and where
   a team stands when its sessions are replayed.

   The ladder table is typed out again here on purpose. A level that drifts
   from the spec should fail a test, not be quietly agreed with. */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { project, pathLen } from '../public/geo.js';
import { readingSig } from '../public/ground.js';
import * as lv from '../public/levels.js';
import {
  LADDER_V1, RULES, PRESETS, STARTS, SETTINGS, levelSpec, levelName, teamName, bossTitle, stageOf, waveStart,
  timeLimitMin, timeLimitFor, whatsNew, runFacts, judge, teamLevel, teamKey, teamsOf, teamOf, newTeam, dogsInTeams,
  isLevelRun, presetById, dayKey,
} from '../public/levels.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log(`  ok  ${name}`); };

const MIN = 60000, HOUR = 3600000, DAY = 86400000;
const T0 = Date.UTC(2026, 5, 1, 12, 0, 0);          // 1 June 2026, noon: daylight in Somerset
const HOME = { lat: 51.2, lon: -2.65 };

/* ── Fixtures ─────────────────────────────────────────────────────────
   A trail is a staircase: equal legs, turning a right angle each time, a
   fix every 5 m. The dog's track follows it two metres to one side. */
function line(start, lengthM, turns, step = 5) {
  const legs = turns + 1, leg = lengthM / legs;
  const pts = [{ lat: start.lat, lon: start.lon }];
  let cur = pts[0];
  for (let k = 0; k < legs; k++) {
    const n = Math.max(1, Math.round(leg / step));
    for (let i = 1; i <= n; i++) pts.push(project(cur, k % 2 ? 90 : 0, leg * i / n));
    cur = pts[pts.length - 1];
  }
  return pts;
}

let seq = 0;
function run(o = {}) {
  const n = ++seq;
  const {
    id = `s${n}`, handlerId = 'h1', dogId = 'd1', layerId = null, targetId = 'person',
    day = 0, hour = 12, minute = 0, lengthM = 100, ageMin = 0, turns = 0,
    found = true, findMin = 8, share = found ? 1 : 0.5, debrief = {}, coach = null,
    revealedAt = null, resultSeenAt = null, temp = 15, mark = found, surf = null, contamination = null,
    levelTry = null, noLine = false, leftAgoMin, layPace = 1.3, place = null, extra = {},
  } = o;
  const trackStarted = T0 + day * DAY + (hour - 12) * HOUR + minute * MIN;
  const start = place ?? { lat: HOME.lat + n * 0.01, lon: HOME.lon };
  const shape = line(start, lengthM, turns);
  const startedAt = noLine ? trackStarted - MIN : trackStarted - ageMin * MIN;
  const trail = shape.map((p, i) => ({ ...p, t: Math.round(startedAt + (lengthM * i / (shape.length - 1)) / layPace * 1000) }));
  const upto = Math.max(2, Math.round(shape.length * share));
  const track = shape.slice(0, upto).map((p, i) => ({ lat: p.lat, lon: p.lon + 0.00003, t: Math.round(trackStarted + findMin * MIN * i / (upto - 1)) }));
  const end = track[track.length - 1];
  const data = {
    track, trackStarted, trackWaypoints: mark ? [{ kind: 'Indication', lat: end.lat, lon: end.lon, t: end.t }] : [],
    revealedAt, resultSeenAt, coach, runWeather: temp === null ? null : { temp },
    contamination: contamination ? contamination(trail) : [],
    debrief: { v: 1, outcome: found ? 'found' : 'missed', target: 'real', blind: 'open', help: 'none', start: 'article', setting: 'rural', ...debrief },
    ...(found ? { found: true } : {}), ...(levelTry ? { levelTry } : {}), ...extra,
  };
  if (noLine) { data.lineLater = true; if (leftAgoMin !== undefined) data.leftAgoMin = leftAgoMin; }
  else {
    data.trail = trail;
    data.result = { ageMin };
    if (surf) {
      data.surf = trail.map((_, i) => surf[Math.min(surf.length - 1, Math.floor(i * surf.length / trail.length))]).join('');
      data.surfSig = readingSig(trail);
    }
  }
  return { id, handlerId, dogId, layerId, targetId, startedAt, summary: '', data };
}

/* Other people's lines. */
const crossAt = (trail, share) => {
  const p = trail[Math.floor(trail.length * share)];
  return { who: 'Someone', order: 'after', laidAt: 0, points: [project(p, 90, 30), project(p, 270, 30)] };
};
const crosses = (k) => (trail) => Array.from({ length: k }, (_, i) => crossAt(trail, (i + 1) / (k + 2)));
const walkedAlong = (m) => (trail) => [...crosses(2)(trail),
  { who: 'Someone', order: 'after', laidAt: 0, points: trail.slice(2, 2 + Math.ceil(m / 5) + 1).map(p => ({ lat: p.lat, lon: p.lon + 0.00002 })) }];
const decoy = (trail) => [{ who: 'Decoy', order: 'before', laidAt: 0, points: [project(trail[0], 45, 2), project(trail[0], 45, 60)] }];

/* Three surfaces by tenths of the trail, the hard one only on the first
   straight: four turns at each fifth, none of them on tarmac. */
const NO_HARD_TURN = ['h', 'g', 'g', 'g', 'g', 'w', 'w', 'g', 'g', 'g'];

/** A run laid to meet level n exactly as the ladder asks, and found. */
function meets(n, o = {}) {
  const L = levelSpec(n);
  const base = {
    lengthM: L.lengthM + 2, ageMin: L.ageMin ? L.ageMin + 2 : 0, turns: L.turns,   // clear of every 90% boundary, so float noise decides nothing
    surf: L.surfaces >= 3 ? ['g', 'h', 'w'] : L.surfaces === 2 ? ['g', 'h'] : null,
    contamination: L.split ? decoy : L.walkAlongM ? walkedAlong(L.walkAlongM + 10) : L.crossTracks ? crosses(L.crossTracks) : null,
    hour: L.night ? 0 : 12,
    layerId: L.stranger ? `stranger-${seq + 1}` : null,
  };
  const debrief = { start: L.start, blind: L.blind ?? 'open', setting: L.setting ?? 'rural', help: 'none', ...(o.debrief ?? {}) };
  return run({ ...base, ...o, debrief });
}
/** The empty half of a pair: nothing laid, and "nobody here" called. */
const emptyRun = (o = {}) => run({ noLine: true, lengthM: 150, found: false, share: 1, mark: false,
  ...o, debrief: { target: 'control', outcome: 'blank', blind: 'double', ...(o.debrief ?? {}) } });

const TEAM = (o = {}) => ({ handlerId: 'h1', dogId: 'd1', startLevel: 1, placedAt: T0 - 400 * DAY, best: null, ...o });
const facts = (s, ctx = { sessions: [] }) => runFacts(s, ctx);
const verdictOf = (n, s, ctx) => judge(levelSpec(n), facts(s, ctx));
const item = (r, key) => r.checklist.find(c => c.key === key);

/* ── The ladder ───────────────────────────────────────────────────── */

t('the ladder is 100 frozen levels, version 1, and nothing here is called LEVELS', () => {
  assert.equal(LADDER_V1.v, 1);
  assert.equal(LADDER_V1.levels.length, 100);
  LADDER_V1.levels.forEach((l, i) => { assert.equal(l.level, i + 1); assert.equal(l.v, 1); });
  assert.ok(Object.isFrozen(LADDER_V1) && Object.isFrozen(LADDER_V1.levels) && Object.isFrozen(LADDER_V1.levels[47]) && Object.isFrozen(LADDER_V1.levels[47].also));
  assert.throws(() => { 'use strict'; LADDER_V1.levels[0].lengthM = 1; }, TypeError, 'a level cannot be edited in place');
  assert.equal(lv.LEVELS, undefined, 'store.js already exports LEVELS');
  assert.equal(levelSpec(0), null);
  assert.equal(levelSpec(101), null);
});

/* The spec's table, wave by wave: length m / age min / turns. */
const H = 60;
const TABLE = [
  [1, 'Runaway', [20, 40, 60, 90, 120], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0]],
  [6, 'Delayed release', [60, 90, 120, 150, 200], [1, 2, 3, 4, 5], [0, 0, 0, 0, 0]],
  [11, 'Article start', [120, 160, 200, 250, 300], [5, 5, 8, 10, 10], [0, 0, 0, 0, 0]],
  [16, 'Out of sight', [150, 200, 250, 300, 300], [10, 15, 20, 25, 30], [0, 0, 0, 0, 0]],
  [21, 'Turns', [250, 300, 300, 350, 350], [30, 30, 30, 30, 30], [1, 1, 2, 2, 3]],
  [26, 'Indication', [300, 350, 350, 400, 450], [30, 30, 30, 30, 30], [2, 2, 2, 2, 2]],
  [31, 'Age', [400, 400, 400, 400, 400], [45, 60, 75, 90, 105], [2, 2, 2, 2, 2]],
  [36, 'Surfaces', [400, 450, 500, 550, 600], [45, 45, 60, 60, 60], [2, 2, 3, 3, 3]],
  [41, 'Split + decoy', [400, 500, 600, 600, 600], [60, 60, 60, 90, 105], [2, 2, 3, 3, 3]],
  [46, 'Handler blind', [400, 400, 450, 450, 500], [2 * H, 2 * H, 2 * H, 2 * H, 2 * H], [3, 3, 3, 3, 3]],
  [51, 'Nobody knows', [400, 450, 500, 550, 600], [2 * H, 2 * H, 2 * H, 2 * H, 2 * H], [3, 3, 3, 3, 3]],
  [56, 'Age', [500, 500, 500, 500, 500], [2.5 * H, 3 * H, 4 * H, 6 * H, 8 * H], [3, 3, 3, 3, 3]],
  [61, 'Cross-tracks', [500, 500, 550, 600, 600], [3 * H, 3 * H, 3 * H, 3 * H, 3 * H], [3, 3, 3, 3, 3]],
  [66, 'Ground', [500, 550, 600, 650, 700], [3 * H, 3 * H, 3 * H, 3 * H, 3 * H], [3, 3, 4, 4, 4]],
  [71, 'Find the direction', [500, 550, 600, 700, 800], [3 * H, 3 * H, 3.5 * H, 4 * H, 4 * H], [3, 3, 3, 4, 4]],
  [76, 'Empty trails', [600, 600, 600, 600, 600], [3 * H, 3 * H, 3.5 * H, 4 * H, 4 * H], [3, 3, 3, 4, 4]],
  [81, 'Distance', [800, 1000, 1200, 1400, 1600], [4 * H, 4 * H, 4 * H, 4 * H, 4 * H], [5, 5, 6, 6, 7]],
  [86, 'Town + traffic', [800, 800, 900, 900, 1000], [4 * H, 4 * H, 4 * H, 4 * H, 4 * H], [4, 5, 5, 6, 6]],
  [91, 'Very old', [800, 800, 1000, 1000, 1000], [12 * H, 18 * H, 24 * H, 36 * H, 48 * H], [5, 5, 5, 5, 5]],
  [96, 'Operational', [1000, 1200, 1000, 1200, 1600], [24 * H, 24 * H, 24 * H, 24 * H, 24 * H], [6, 8, 6, 8, 10]],
];

t('every wave’s five levels match the spec: length, age and turns', () => {
  assert.equal(TABLE.length, 20);
  for (const [from, wave, len, age, turns] of TABLE) {
    for (let i = 0; i < 5; i++) {
      const l = levelSpec(from + i);
      assert.equal(l.waveName, wave, `L${from + i} wave`);
      assert.equal(l.lengthM, len[i], `L${from + i} length`);
      assert.equal(l.ageMin, age[i], `L${from + i} age`);
      assert.equal(l.turns, turns[i], `L${from + i} turns`);
      assert.equal(l.step, i + 1);
      assert.equal(waveStart(from + i), from);
    }
  }
});

t('the three stages are Hot 1-15, Warm 16-45 and Cold 46-100', () => {
  assert.deepEqual(LADDER_V1.stages.map(s => [s.key, s.from, s.to]), [['hot', 1, 15], ['warm', 16, 45], ['cold', 46, 100]]);
  for (let n = 1; n <= 100; n++) assert.equal(stageOf(n), n <= 15 ? 'hot' : n <= 45 ? 'warm' : 'cold', `L${n}`);
  assert.ok(levelSpec(46).ageMin >= 120, 'Cold is a trail of 2 h or more');
  assert.ok(LADDER_V1.levels.filter(l => l.stage === 'cold').every(l => l.ageMin >= 120));
});

t('the four bosses close the stages, with their names, titles and extra asks', () => {
  assert.deepEqual(LADDER_V1.levels.filter(l => l.boss).map(l => [l.level, l.bossName, l.title]), [
    [15, 'First Trail', 'Trail Hound'], [45, 'The Fork', 'Warm Trailer'], [75, 'The Town', 'Town Hound'], [100, 'Mission Ready', 'Master Trailer'],
  ]);
  assert.deepEqual(LADDER_V1.bosses.map(b => b.level), [15, 45, 75, 100]);
  const b15 = levelSpec(15), b45 = levelSpec(45), b75 = levelSpec(75), b100 = levelSpec(100);
  assert.ok(b15.indication, 'First Trail: the dog shows the find');
  assert.equal(b15.start, 'watchedArticle');
  assert.ok(b45.split && b45.decoy, 'The Fork: a decoy peels off');
  assert.deepEqual([b45.lengthM, b45.ageMin, b45.turns], [600, 105, 3]);
  assert.deepEqual([b75.setting, b75.start, b75.crossTracks], ['semi', 'lkp', 2], 'The Town: semi-urban, last known point, 2 cross-tracks');
  assert.deepEqual([b100.newPlace, b100.stranger, b100.distractors, b100.night], [true, true, true, false], 'Mission Ready: new place, stranger, distractors');
  assert.deepEqual([b100.lengthM, b100.ageMin, b100.turns], [1600, 1440, 10]);
});

t('the rules that stay on switch on at L16, L26, L46 and L51', () => {
  assert.ok(levelSpec(15).watched && !levelSpec(16).watched, 'the dog watches the person leave: L1-15 only');
  assert.ok(!levelSpec(15).coachOff && levelSpec(16).coachOff, 'coach off from L16');
  assert.ok(LADDER_V1.levels.slice(15).every(l => l.coachOff));
  assert.ok(!levelSpec(25).indication && levelSpec(26).indication, 'an indication from L26');
  assert.ok(LADDER_V1.levels.slice(25).every(l => l.indication));
  assert.equal(levelSpec(45).blind, null);
  assert.equal(levelSpec(46).blind, 'handler', 'handler-blind from L46');
  assert.equal(levelSpec(50).blind, 'handler');
  assert.equal(levelSpec(51).blind, 'double', 'nobody knows from L51');
  assert.ok(LADDER_V1.levels.slice(50).every(l => l.blind === 'double'));
  assert.ok(LADDER_V1.levels.slice(0, 10).every(l => l.start === 'watched'));
  assert.ok(LADDER_V1.levels.slice(10, 15).every(l => l.start === 'watchedArticle'));
  assert.ok(LADDER_V1.levels.slice(15, 70).every(l => l.start === 'article'), 'the dog is taken away: an article start');
});

t('the time limit starts at L16: 20 min and one per 40 m, an hour at most', () => {
  assert.ok(LADDER_V1.levels.slice(0, 15).every(l => l.timeLimitMin === null), 'Hot has no limit');
  assert.equal(timeLimitMin(300), 28, 'the spec’s own example');
  assert.equal(timeLimitMin(150), 24);
  assert.equal(timeLimitMin(400), 30);
  assert.equal(timeLimitMin(1600), 60);
  assert.equal(timeLimitMin(5000), 60, 'never more than an hour');
  assert.equal(levelSpec(16).timeLimitMin, 24);
  assert.equal(levelSpec(23).timeLimitMin, 28);
  assert.equal(levelSpec(100).timeLimitMin, 60);
  for (const l of LADDER_V1.levels.slice(15)) assert.equal(l.timeLimitMin, Math.min(60, Math.ceil(20 + l.lengthM / 40)), `L${l.level}`);
  assert.equal(timeLimitFor(levelSpec(10), 500), null);
  assert.equal(timeLimitFor(levelSpec(23), 500), 33, 'a trail laid longer than asked keeps its minute per 40 m');
  assert.equal(timeLimitFor(levelSpec(23), 280), 28, 'and one laid a little short is not given less than the level’s');
});

t('what each wave turns up is on the ladder', () => {
  const of = (from, key) => [0, 1, 2, 3, 4].map(i => levelSpec(from + i)[key]);
  assert.deepEqual(of(36, 'surfaces'), [2, 2, 2, 2, 2], 'a second surface');
  assert.deepEqual(of(41, 'split'), [true, true, true, true, true]);
  assert.deepEqual(of(61, 'crossTracks'), [1, 1, 2, 2, 2]);
  assert.deepEqual(of(61, 'walkAlongM'), [0, 0, 0, 0, 50], 'at L65 someone also walks 50 m along it');
  assert.deepEqual(of(66, 'surfaces'), [2, 2, 3, 3, 3]);
  assert.deepEqual(of(66, 'hardTurn'), [false, false, true, true, true], 'a turn on hard ground from L68');
  assert.deepEqual(of(66, 'setting'), [null, null, null, null, 'semi'], 'L70 is semi-urban');
  assert.deepEqual(of(71, 'start'), ['told', 'told', 'told', 'told', 'lkp']);
  assert.deepEqual(of(71, 'directions'), [2, 2, 3, 3, null]);
  assert.deepEqual(of(76, 'pair'), ['any', 'any', 'emptySecond', 'emptySecond', 'emptySecond']);
  assert.deepEqual(of(86, 'setting'), ['town', 'town', 'town', 'traffic', 'traffic'], 'a road crossing from L86, moving traffic from L89');
  assert.deepEqual(of(86, 'also').map(a => a.includes('A road crossing')), [true, true, true, true, true], 'the road crossing stays on to L90');
  assert.deepEqual(of(86, 'also').map(a => a.includes('Moving traffic')), [false, false, false, true, true]);
  assert.deepEqual(of(86, 'also').map(a => a.includes('Junctions count as turns')), [true, true, true, true, true]);
  assert.deepEqual(of(96, 'newPlace'), [true, false, false, false, true]);
  assert.deepEqual(of(96, 'stranger'), [false, true, false, false, true]);
  assert.deepEqual(of(96, 'night'), [false, false, true, false, false]);
  assert.deepEqual(of(96, 'pair'), [null, null, null, 'any', null], 'L99: was the person ever here?');
  assert.deepEqual(LADDER_V1.levels.filter(l => l.pair).map(l => l.level), [76, 77, 78, 79, 80, 99]);
  assert.ok(levelSpec(3).also.includes('The person hides at the end') && !levelSpec(2).also.length);
  assert.ok(levelSpec(95).also.includes('Other dogs cross the trail'));
  assert.ok(levelSpec(21).also.includes('Legs of 50 m or more'));
  assert.equal(RULES.turnLegM, 50);
  assert.equal(RULES.turnDeg, 60);
});

t('the dog’s age gates: Cold from 15 months, L61 from 18, L91 from 24', () => {
  const g = (n) => levelSpec(n).minDogMonths;
  assert.deepEqual([g(1), g(45), g(46), g(60), g(61), g(90), g(91), g(100)], [0, 0, 15, 15, 18, 18, 24, 24]);
});

t('names: every wave has its rank, I to V, and a team is named for the last level it passed', () => {
  assert.deepEqual(LADDER_V1.waves.map(w => w.rank), [
    'Puppy Nose', 'Line Puller', 'Scent Reader',
    'Seeker', 'Turn Finder', 'True Indicator', 'Patient Nose', 'Ground Reader', 'Decoy Breaker',
    'Blind Faith', 'Double Blind', 'Cold Nose', 'Through the Crowd', 'Tarmac Hound', 'Direction Finder',
    'Honest Nose', 'Long Hauler', 'Street Trailer', 'Ghost Trailer', 'Mission Ready']);
  assert.equal(levelName(1), 'Puppy Nose I');
  assert.equal(levelName(14), 'Scent Reader IV');
  assert.equal(levelName(48), 'Blind Faith III');
  assert.equal(levelName(100), 'Mission Ready V');
  assert.equal(levelName(0), null);
  assert.equal(teamName('Rémi', 'Rex', 48), 'Rémi & Rex · Blind Faith III');
  assert.equal(teamName('', 'Rex', 1), 'Rex · Puppy Nose I');
  assert.equal(teamName('Rémi', 'Rex', 0), 'Rémi & Rex', 'nothing passed yet: no rank to carry');
  assert.equal(new Set(LADDER_V1.levels.map(l => l.name)).size, 100, 'every level passed gives a new name');
  assert.equal(bossTitle(14), null);
  assert.equal(bossTitle(15).title, 'Trail Hound');
  assert.equal(bossTitle(74).title, 'Warm Trailer');
  assert.equal(bossTitle(100).title, 'Master Trailer');
  assert.equal(bossTitle(50, LADDER_V1, 46), null, 'a boss a preset stepped over was never run');
});

t('presets, starts and settings are the spec’s', () => {
  assert.deepEqual(PRESETS.map(p => [p.label, p.startLevel]), [
    ['New dog', 1], ['Loves runaways', 6], ['Article starter', 11], ['Trails out of sight', 16],
    ['Passed MTG 1', 26], ['Passed MTG 2', 41], ['Experienced', 46]]);
  assert.equal(presetById('mtg2').startLevel, 41);
  assert.equal(presetById('nonsense').startLevel, 1);
  assert.deepEqual(STARTS.map(s => s.label), ['Watched', 'Watched + article', 'Article only', 'Told directions', 'Last point only']);
  assert.deepEqual(SETTINGS.map(s => s.label), ['Rural', 'Semi-urban', 'Town', 'Town + traffic']);
  assert.equal(lv.SETTING_FROM, 66);
});

t('what is new at a level is named, for the gold on the card', () => {
  assert.deepEqual(whatsNew(1), ['length']);
  assert.deepEqual(whatsNew(2), ['length']);
  assert.ok(whatsNew(16).includes('coach') && whatsNew(16).includes('start') && whatsNew(16).includes('found'));
  assert.deepEqual(whatsNew(21), ['turns']);
  assert.ok(whatsNew(26).includes('indication'));
  assert.ok(whatsNew(46).includes('blind') && whatsNew(51).includes('blind'));
  assert.ok(whatsNew(98).includes('night'));
  assert.ok(whatsNew(76).includes('pair'));
});

/* ── Teams ────────────────────────────────────────────────────────── */

t('teams live on the dog, one per handler, and a dog shows for every handler in a team with it', () => {
  const made = newTeam({ handlerId: 'h2', dogId: 'd1', preset: 'mtg1', now: T0, look: { coat: 'lab-black' } });
  assert.deepEqual(made, { id: teamKey('h2', 'd1'), handlerId: 'h2', preset: 'mtg1', startLevel: 26, placedAt: T0,
    look: { coat: 'lab-black', jacket: null, harness: null }, best: { v: 1, level: 0, at: null } });
  const dog = { id: 'd1', handlerId: 'h1', teams: [newTeam({ handlerId: 'h1', dogId: 'd1', now: T0 }), made, null, { preset: 'new' }] };
  assert.deepEqual(teamsOf(dog).map(x => [x.handlerId, x.dogId, x.startLevel]), [['h1', 'd1', 1], ['h2', 'd1', 26]]);
  assert.equal(teamOf(dog, 'h2').startLevel, 26);
  assert.equal(teamOf(dog, 'h9'), null);
  assert.deepEqual(teamsOf({ id: 'd2' }), []);
  const dogs = [dog, { id: 'd2', handlerId: 'h2' }, { id: 'd3', handlerId: 'h3' }];
  assert.deepEqual(dogsInTeams(dogs, 'h2').map(d => d.id), ['d1', 'd2'], 'the trainer sees the client’s dog too');
  assert.deepEqual(dogsInTeams(dogs, 'h3').map(d => d.id), ['d3']);
});

/* ── What a run is checked against ─────────────────────────────────── */

t('turns: counted over a full leg, so clean corners count and noise does not', () => {
  const turnsIn = (o) => facts(run(o)).turns;
  assert.equal(turnsIn({ lengthM: 300, turns: 0 }), 0);
  assert.equal(turnsIn({ lengthM: 300, turns: 1 }), 1);
  assert.equal(turnsIn({ lengthM: 350, turns: 3 }), 3);
  assert.equal(turnsIn({ lengthM: 1600, turns: 10 }), 10);
  assert.equal(turnsIn({ lengthM: 120, turns: 3 }), 0, 'legs of 30 m are not legs: a turn needs 50 m either side');

  /* The same two-turn trail with every fix knocked up to 3 m off, the way a
     phone under trees records it. */
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 - 0.5; };
  const noisy = (turns) => {
    const s = run({ lengthM: 360, turns });
    s.data.trail = s.data.trail.map(p => ({ ...p, lat: p.lat + rnd() * 0.00005, lon: p.lon + rnd() * 0.00008 }));
    return facts(s).turns;
  };
  assert.equal(noisy(2), 2, 'two real turns survive the wobble');
  assert.equal(noisy(0), 0, 'and a straight trail does not grow any');

  /* A long gentle curve: a quarter circle of 150 m radius is no turn. */
  const curve = run({ lengthM: 240 });
  const c = project(HOME, 90, 150);
  curve.data.trail = Array.from({ length: 48 }, (_, i) => ({ ...project(c, 270 + i * 90 / 47, 150), t: curve.startedAt + i * 4000 }));
  assert.equal(facts(curve).turns, 0);
  /* The same quarter turn made in three small corners over 20 m is one. */
  const bend = run({ lengthM: 200 });
  const a = project(HOME, 0, 90), b = project(a, 30, 10), c2 = project(b, 60, 10);
  const leg = (from, brg, m) => Array.from({ length: m / 5 }, (_, i) => project(from, brg, (i + 1) * 5));
  bend.data.trail = [HOME, ...leg(HOME, 0, 90), b, c2, ...leg(c2, 90, 90)].map((p, i) => ({ lat: p.lat, lon: p.lon, t: bend.startedAt + i * 4000 }));
  assert.equal(facts(bend).turns, 1);
  assert.ok(facts(bend).turnList[0].deg > 60);

  /* A layer who stops leaves a knot: the phone keeps every fix more than
     2.5 m from the last, and standing under trees the fixes wander. Tens of
     metres of line that go nowhere must not read as turns. Twenty knots,
     each a slow drift some 5 m wide, three minutes long. */
  const knot = (centre, k) => {
    let s2 = 1000 + k * 7919;
    const r = () => { s2 = (s2 * 1103515245 + 12345) % 2147483648; return s2 / 2147483648 - 0.5; };
    const out = [];
    let x = 0, y = 0, last = centre;
    for (let i = 0; i < 180; i++) {
      x = x * 0.9 + r() * 5; y = y * 0.9 + r() * 5;
      const p = project(project(centre, 0, y), 90, x);
      if (pathLen([last, p]) > 2.5) { out.push(p); last = p; }
    }
    return out;
  };
  const withKnot = (turns, at, k) => {
    const s = run({ lengthM: 400, turns });
    const tr = s.data.trail, i = at === 'end' ? tr.length - 1 : at;
    const pts = [...tr.slice(0, i + 1), ...knot(tr[i], k), ...tr.slice(i + 1)];
    s.data.trail = pts.map((p, j) => ({ lat: p.lat, lon: p.lon, t: s.startedAt + j * 2000 }));
    return facts(s);
  };
  for (let k = 0; k < 20; k++) {
    const mid = withKnot(0, 40, k);
    assert.ok(mid.lengthM > 480, 'the knot is a good stretch of line: ' + Math.round(mid.lengthM) + ' m for a 400 m trail');
    assert.equal(mid.turns, 0, 'a three-minute stop half-way down a straight trail is no turn (knot ' + k + ')');
    assert.equal(withKnot(0, 'end', k).turns, 0, 'nor is waiting at the end before Stop (knot ' + k + ')');
    assert.equal(withKnot(3, 20, k).turns, 3, 'a stop on a corner does not add a turn to the three walked (knot ' + k + ')');
  }
});

t('a run’s own record is read into facts', () => {
  const s = run({ lengthM: 300, ageMin: 32, turns: 2, findMin: 12, temp: 18 });
  const f = facts(s);
  assert.ok(f.person && f.ran && !f.noLine && !f.unwalked);
  assert.ok(Math.abs(f.lengthM - 300) < 1 && Math.abs(f.lengthM - pathLen(s.data.trail)) < 1e-9);
  assert.equal(f.lengthFrom, 'trail');
  assert.equal(f.ageMin, 32);
  assert.equal(f.turns, 2);
  assert.equal(f.found, true);
  assert.equal(f.findMin, 12);
  assert.ok(f.indication && f.indicationM < 5);
  assert.equal(f.blind, 'open');
  assert.equal(f.help, 'none');
  assert.equal(f.start, 'article');
  assert.equal(f.setting, 'rural');
  assert.equal(f.peeked, false);
  assert.equal(f.coach, false);
  assert.equal(f.night, false);
  assert.equal(f.tempC, 18);
  assert.ok(f.onFoot && f.layKmh > 4 && f.layKmh < 5);
  assert.equal(f.coverage, 1);
  assert.equal(f.timesOk, true);
  assert.equal(f.surfaces, null, 'no reading of the ground is unknown, not zero');
  assert.deepEqual([f.crossTracks, f.split, f.alongM], [0, false, 0]);
  assert.deepEqual([f.empty, f.decoy, f.aborted], [false, false, false]);
  assert.equal(f.handlerId, 'h1');
  assert.equal(f.dogId, 'd1');
  assert.ok(Object.isFrozen(f));
  assert.equal(runFacts(s, {}).newPlace, null, 'without the team’s record a new place is unknown');
  assert.equal(runFacts(null), null);
});

t('facts: surfaces, cross-tracks, a split, a walk along, night and the marks', () => {
  assert.equal(facts(run({ lengthM: 400, turns: 2, surf: ['g', 'h'] })).surfaces, 2);
  assert.equal(facts(run({ lengthM: 400, turns: 2, surf: ['g'] })).surfaces, 1);
  const three = facts(run({ lengthM: 600, turns: 4, surf: ['g', 'h', 'w'] }));
  assert.deepEqual([three.surfaces, three.surfaceIds, three.hardTurns], [3, ['g', 'h', 'w'], 2]);
  assert.equal(facts(run({ lengthM: 600, turns: 4, surf: NO_HARD_TURN })).hardTurns, 0, 'tarmac only on the first straight');
  assert.equal(facts(run({ lengthM: 600, turns: 4, surf: NO_HARD_TURN })).surfaces, 3);
  /* A handler’s own correction counts, with no map reading at all. */
  const fixed = run({ lengthM: 400 });
  const tr = fixed.data.trail;
  fixed.data.surfFix = [{ v: 1, id: 'f1', as: 'h', from: { lat: tr[40].lat, lon: tr[40].lon }, to: { lat: tr[70].lat, lon: tr[70].lon }, fromM: 200, toM: 350 }];
  assert.deepEqual(facts(fixed).surfaceIds, ['h']);

  assert.equal(facts(run({ lengthM: 500, contamination: crosses(2) })).crossTracks, 2);
  const along = facts(run({ lengthM: 500, contamination: walkedAlong(60) }));
  assert.equal(along.crossTracks, 3);
  assert.ok(along.alongM >= 50 && along.alongM <= 70, `walked ${along.alongM} m along it`);
  assert.equal(facts(run({ lengthM: 500, contamination: crosses(2) })).alongM <= 30, true, 'a crossing is not a walk along');
  const sp = facts(run({ lengthM: 400, contamination: decoy }));
  assert.deepEqual([sp.split, sp.crossTracks], [true, 0], 'a line laid before, starting on the trail, is the decoy');
  const far = facts(run({ lengthM: 400, contamination: (trail) => [{ who: 'x', order: 'before', points: [project(trail[0], 90, 40), project(trail[0], 90, 90)] }] }));
  assert.equal(far.split, false, 'one that starts 40 m away is not');

  assert.equal(facts(run({ hour: 0 })).night, true, 'midnight in June');
  assert.equal(facts(run({ hour: 12 })).night, false);
  assert.equal(facts(run({ mark: false })).indication, false);
  const farMark = run({ lengthM: 300 });
  farMark.data.trackWaypoints = [{ kind: 'Indication', ...project(farMark.data.trail[farMark.data.trail.length - 1], 0, 45), t: 1 }];
  assert.equal(facts(farMark).indication, false, 'an indication 45 m from the end is not at the find');
});

t('facts: peeking, the coach, and how it ended', () => {
  const shown = run({ findMin: 10 });
  shown.data.revealedAt = shown.data.trackStarted + 252000;
  assert.deepEqual([facts(shown).peeked, facts(shown).peekKind, facts(shown).peekMs], [true, 'shown', 252000]);
  const before = run();
  before.data.revealedAt = before.data.trackStarted - HOUR;
  assert.equal(facts(before).peeked, true, 'seen on an earlier run of the same line');
  const after = run({ findMin: 10 });
  after.data.resultSeenAt = after.data.trackStarted + 11 * MIN;
  assert.equal(facts(after).peeked, false, 'the result seen after Found is not a peek');
  const early = run({ findMin: 10 });
  early.data.resultSeenAt = early.data.trackStarted + 5 * MIN;
  assert.deepEqual([facts(early).peeked, facts(early).peekKind], [true, 'result']);
  assert.equal(facts(run({ coach: { assisted: true } })).coach, true);
  assert.equal(facts(run({ coach: { assisted: false } })).coach, false);

  assert.equal(facts(run({ found: false })).found, false);
  const noDebrief = run();
  delete noDebrief.data.debrief;
  assert.equal(facts(noDebrief).found, true, 'ended on Found, not yet debriefed');
  const corrected = run({ debrief: { outcome: 'missed' } });
  assert.equal(facts(corrected).found, false, 'the debrief has the last word over a Found tapped by mistake');
  assert.equal(facts(run({ found: false, debrief: { outcome: 'aborted' } })).aborted, true);
  const e = facts(emptyRun());
  assert.deepEqual([e.empty, e.emptyCalled, e.found], [true, true, false]);
  assert.equal(facts(run({ debrief: { target: 'decoy' } })).decoy, true);
});

t('unknown ages stay unknown: a drawn plan nobody walked, an untimed line, a run with no grade', () => {
  const plan = run({ lengthM: 300, ageMin: 40 });
  plan.data.plan = true;                               // graded against the drawn line; `walked` never set
  assert.deepEqual([facts(plan).ageMin, facts(plan).unwalked], [null, true]);
  const walked = run({ lengthM: 300, ageMin: 40, extra: { plan: true, walked: true } });
  assert.deepEqual([facts(walked).ageMin, facts(walked).unwalked], [40, false]);
  const gpx = run({ lengthM: 300, ageMin: 40, extra: { drawn: true, lineAdded: { via: 'gpx', timed: false } } });
  gpx.data.trail = gpx.data.trail.map(({ lat, lon }) => ({ lat, lon }));
  const g = facts(gpx);
  assert.deepEqual([g.ageMin, g.unwalked, g.layKmh, g.onFoot], [null, true, null, null]);
  const ungraded = run({ lengthM: 300, ageMin: 40, turns: 1 });
  delete ungraded.data.result;
  assert.equal(facts(ungraded).ageMin, null);

  assert.equal(judge(levelSpec(22), facts(plan)).why, 'Not counted: the trail was drawn, not walked');
  assert.equal(judge(levelSpec(22), facts(gpx)).why, 'Not counted: the trail was drawn, not walked');
  const r = judge(levelSpec(22), facts(Object.assign(ungraded, { id: 'ungraded-2' })));
  assert.deepEqual([r.verdict, r.why], ['notCounted', 'Not counted: trail age unknown']);
  assert.equal(judge(levelSpec(3), facts(plan)).verdict, 'notCounted', 'even where no age is asked, a sketch is not a trail');
});

t('a new place and a stranger come from the team’s earlier runs', () => {
  const here = { lat: 51.3, lon: -2.5 };
  const first = run({ day: 0, place: here, layerId: 'anna' });
  const near = run({ day: 1, place: project(here, 45, 250), layerId: 'anna' });
  const away = run({ day: 2, place: project(here, 45, 700), layerId: 'ben' });
  const all = [away, near, first];
  assert.deepEqual([facts(first, { sessions: all }).newPlace, facts(first, { sessions: all }).stranger], [true, true], 'nothing earlier');
  assert.deepEqual([facts(near, { sessions: all }).newPlace, facts(near, { sessions: all }).stranger], [false, false]);
  assert.deepEqual([facts(away, { sessions: all }).newPlace, facts(away, { sessions: all }).stranger], [true, true]);
  assert.equal(facts(run({ day: 3 }), { sessions: all }).stranger, false, 'a trail the handler laid has no stranger');
  /* A stranger’s trail normally comes from the stranger’s own phone, as a
     Trail Card or a line added to a Blind trail. Those carry no layer id,
     only the sender’s name, and the name is the layer. */
  const card = (from, day) => run({ day, extra: { imported: { from, at: T0 - 30 * DAY } } });
  const bob = card('Bob', 6), bobAgain = card(' bob ', 7), nobody = card('another phone', 8);
  assert.deepEqual([bob.layerId, isLevelRun(bob), facts(bob, { sessions: all }).layerKey, facts(bob, { sessions: all }).stranger], [null, true, 'card:bob', true]);
  assert.equal(facts(bobAgain, { sessions: [bob, bobAgain] }).stranger, false, 'a second card from the same name is no stranger');
  assert.deepEqual([facts(nobody, { sessions: [] }).layerKey, facts(nobody, { sessions: [] }).stranger], [null, false], 'a card with no name on it names nobody');
  const added = run({ day: 9, extra: { lineLater: true, lineAdded: { at: T0, via: 'card', from: 'Cara', timed: true } } });
  assert.deepEqual([facts(added, { sessions: [bob] }).layerKey, facts(added, { sessions: [bob] }).stranger], ['card:cara', true]);
  assert.equal(facts(run({ day: 3, layerId: 'anna' }), { sessions: [] }).layerKey, 'anna', 'a layer picked on this phone is its id');
  /* Another handler’s runs with the same dog are another team’s. */
  const theirs = run({ day: 0, hour: 9, place: here, layerId: 'cara', handlerId: 'h2' });
  const mine = run({ day: 4, place: here, layerId: 'cara' });
  const f = facts(mine, { sessions: [theirs, mine] });
  assert.deepEqual([f.newPlace, f.stranger], [true, true]);
  assert.equal(facts(run({ day: 5 }), { sessions: [], dog: { dob: T0 - 500 * DAY } }).dogMonths, 16);
});

/* ── Judging ──────────────────────────────────────────────────────── */

t('a good run passes, and says what it was', () => {
  const r = verdictOf(22, meets(22, { lengthM: 310, ageMin: 32, findMin: 12 }));
  assert.equal(r.verdict, 'pass');
  assert.equal(r.why, 'Passed: 310 m, 32 min old, found in 12 min');
  assert.equal(r.level, 22);
  assert.deepEqual(r.checklist.map(c => [c.key, c.text, c.ok]), [
    ['length', '300 m', true], ['age', '30 min old', true], ['turns', '1 turn', true],
    ['start', 'article start', true], ['found', 'found within 28 min', true]]);
  assert.deepEqual(item(r, 'length'), { key: 'length', label: 'Length', text: '300 m', need: '300 m', got: '310 m', ok: true });
  assert.equal(verdictOf(1, meets(1)).why, 'Passed: 22 m, found in 8 min');
});

t('every level can be passed by a run laid as the ladder asks, and not by one for the level before', () => {
  for (let n = 1; n <= 100; n++) {
    const L = levelSpec(n);
    if (L.pair) continue;
    const s = meets(n);
    const r = judge(L, facts(s, { sessions: [] }));
    assert.equal(r.verdict, 'pass', `L${n}: ${r.why}`);
    assert.ok(r.checklist.every(c => c.ok), `L${n} checklist`);
  }
  /* Climbing is real: within a wave the run that only just meets a level
     does not pass the next one, wherever the next asks for more. */
  let harder = 0;
  for (let n = 1; n < 100; n++) {
    const L = levelSpec(n), N = levelSpec(n + 1);
    if (L.pair || N.pair || N.wave !== L.wave) continue;
    /* "At least 90% of the length" means a level only 10% longer is met by
       the same trail; those ride along, as the spec's multi-level pass says. */
    const least = N.stage === 'hot' ? N.lengthM - Math.max(0.1 * N.lengthM, 15) : 0.9 * N.lengthM;
    if (least <= L.lengthM && N.ageMin <= L.ageMin && N.turns <= L.turns && N.crossTracks <= L.crossTracks
      && N.surfaces <= L.surfaces && N.walkAlongM <= L.walkAlongM && N.hardTurn === L.hardTurn && N.setting === L.setting
      && N.start === L.start && N.boss === L.boss && N.night === L.night && N.newPlace === L.newPlace && N.stranger === L.stranger) continue;
    harder++;
    const s = meets(n, { lengthM: L.lengthM - 1, ageMin: L.ageMin, mark: L.indication });
    assert.notEqual(judge(N, facts(s, { sessions: [] })).verdict, 'pass', `a bare L${n} run should not pass L${n + 1}`);
  }
  assert.ok(harder > 40, `${harder} steps checked`);
});

t('not counted: laid too short, with the metres', () => {
  const r = verdictOf(5, meets(5, { lengthM: 96.4 }));
  assert.deepEqual([r.verdict, r.why], ['notCounted', 'Not counted: 96 of 120 m, too short']);
  assert.equal(item(r, 'length').ok, false);
  assert.equal(item(r, 'length').got, '96 m');
  /* Hot is within the larger of 10% and 15 m; from Warm it is 90%. */
  assert.equal(verdictOf(5, meets(5, { lengthM: 106 })).verdict, 'pass');
  assert.equal(verdictOf(1, meets(1, { lengthM: 6 })).verdict, 'pass', '20 m less 15 m of GPS noise');
  assert.equal(verdictOf(1, meets(1, { lengthM: 4 })).verdict, 'notCounted');
  assert.equal(verdictOf(15, meets(15, { lengthM: 271 })).verdict, 'pass', '300 m less 10%');
  assert.equal(verdictOf(15, meets(15, { lengthM: 268 })).verdict, 'notCounted');
  assert.equal(verdictOf(20, meets(20, { lengthM: 271 })).verdict, 'pass', '90% of 300 m');
  assert.equal(verdictOf(20, meets(20, { lengthM: 268.4 })).why, 'Not counted: 268 of 300 m, too short');
  /* Not solved and too short is still not counted: never a miss. */
  assert.equal(verdictOf(20, meets(20, { lengthM: 200, found: false })).verdict, 'notCounted');
});

t('not counted: too fresh, too few turns', () => {
  assert.equal(verdictOf(22, meets(22, { ageMin: 20 })).why, 'Not counted: 20 of 30 min, too fresh');
  assert.equal(verdictOf(46, meets(46, { ageMin: 95 })).why, 'Not counted: 1.5 of 2 h, too fresh');
  assert.equal(verdictOf(22, meets(22, { ageMin: 30 })).verdict, 'pass', 'at least the age');
  assert.equal(verdictOf(23, meets(23, { turns: 1 })).why, 'Not counted: 1 of 2 turns');
  assert.equal(verdictOf(21, meets(21, { turns: 0 })).why, 'Not counted: 0 of 1 turn');
  assert.equal(verdictOf(21, meets(21, { turns: 3 })).verdict, 'pass', 'more than asked is fine');
});

t('not counted: peeking, in the handler’s own words', () => {
  const s = meets(22);
  s.data.revealedAt = s.data.trackStarted + 4 * MIN + 12000;
  assert.deepEqual([verdictOf(22, s).verdict, verdictOf(22, s).why], ['notCounted', 'Not counted: trail shown at 4:12']);
  const again = meets(22);
  again.data.revealedAt = again.data.trackStarted - DAY;
  assert.equal(verdictOf(22, again).why, 'Not counted: the trail had been seen before the run');
  const seen = meets(22);
  seen.data.resultSeenAt = seen.data.trackStarted + 3 * MIN;
  assert.equal(verdictOf(22, seen).why, 'Not counted: the answer was seen before the end');
  /* Show trail pressed while standing at the end, before Found is tapped.
     Standing still adds no fix, so the last fix kept (the run's "end") is
     from before the look: it is a peek all the same. */
  const atEnd = meets(22);
  const lastFix = atEnd.data.track[atEnd.data.track.length - 1];
  lastFix.dwellS = 180;
  atEnd.data.revealedAt = lastFix.t + MIN;
  assert.deepEqual([facts(atEnd).peeked, facts(atEnd).peekKind, verdictOf(22, atEnd).why], [true, 'shown', 'Not counted: trail shown at 9:00']);
  /* The answer seen once the run is over is no peek. */
  const afterwards = meets(22);
  afterwards.data.resultSeenAt = afterwards.data.track[afterwards.data.track.length - 1].t + 5000;
  assert.equal(verdictOf(22, afterwards).verdict, 'pass');
  const hot = meets(4);
  hot.data.revealedAt = hot.data.trackStarted + 30000;
  assert.equal(verdictOf(4, hot).why, 'Not counted: trail shown at 0:30', 'Show trail is a peek in Hot too');
});

t('the coach is allowed in Hot and off from L16; help beyond the line stops a run counting', () => {
  const coached = (n) => { const s = meets(n, { coach: { assisted: true } }); s.data.revealedAt = s.data.trackStarted + 5000; return s; };
  assert.equal(verdictOf(10, coached(10)).verdict, 'pass', 'the coach stamps the same moment Show trail does, and is not a peek in Hot');
  assert.equal(verdictOf(16, meets(16, { coach: { assisted: true } })).why, 'Not counted: the coach was on');
  assert.equal(verdictOf(16, meets(16, { debrief: { help: 'verbal' } })).why, 'Not counted: help was given (a word at a decision)');
  assert.equal(verdictOf(16, meets(16, { debrief: { help: 'led' } })).why, 'Not counted: help was given (the handler chose the way)');
  assert.equal(verdictOf(16, meets(16, { debrief: { help: 'line' } })).verdict, 'pass', 'line handling only is no help');
  assert.equal(verdictOf(16, meets(16, { debrief: { help: null } })).why, 'Not counted: help given is not answered in the debrief');
  assert.equal(verdictOf(12, meets(12, { debrief: { help: 'verbal' } })).verdict, 'pass', 'Hot does not ask');
});

t('a trail that was not solved is a miss, even when the handler then showed it or took over', () => {
  /* The usual end of a lost trail: Show trail, and walk the dog to its person. */
  const shown = meets(20, { found: false, findMin: 25 });
  shown.data.revealedAt = shown.data.trackStarted + 20 * MIN;
  assert.deepEqual([verdictOf(20, shown).verdict, verdictOf(20, shown).why], ['miss', 'Missed: not found within 28 min, trail shown at 20:00']);
  assert.equal(item(verdictOf(20, shown), 'peek').ok, false, 'the peek is still on the checklist');
  const led = meets(20, { found: false, debrief: { help: 'led' } });
  assert.deepEqual([verdictOf(20, led).verdict, verdictOf(20, led).why], ['miss', 'Missed: not found within 28 min, help was given (the handler chose the way)']);
  const seenBefore = meets(20, { found: false });
  seenBefore.data.revealedAt = seenBefore.data.trackStarted - DAY;
  assert.equal(verdictOf(20, seenBefore).verdict, 'miss');
  /* A find with a look or with help stays not counted. */
  const peekFound = meets(20);
  peekFound.data.revealedAt = peekFound.data.trackStarted + 2 * MIN;
  assert.equal(verdictOf(20, peekFound).verdict, 'notCounted');
  assert.equal(verdictOf(20, meets(20, { debrief: { help: 'led' } })).verdict, 'notCounted');
  /* So does everything that is not about the solving: a run stopped for the
     dog, the coach on, help not answered, a trail laid too short. */
  const stopped = meets(20, { found: false, debrief: { outcome: 'aborted' } });
  stopped.data.revealedAt = stopped.data.trackStarted + MIN;
  assert.equal(verdictOf(20, stopped).why, 'Not counted: stopped for the dog, which is never a miss');
  const coached = meets(20, { found: false, coach: { assisted: true } });
  coached.data.revealedAt = coached.data.trackStarted + 5000;
  assert.equal(verdictOf(20, coached).why, 'Not counted: the coach was on');
  assert.equal(verdictOf(20, meets(20, { found: false, debrief: { help: null } })).why, 'Not counted: help given is not answered in the debrief');
  const short = meets(20, { found: false, lengthM: 150 });
  short.data.revealedAt = short.data.trackStarted + MIN;
  assert.equal(verdictOf(20, short).why, 'Not counted: 150 of 300 m, too short');
});

t('missed: laid right and not solved', () => {
  const lost = verdictOf(22, meets(22, { found: false }));
  assert.deepEqual([lost.verdict, lost.why], ['miss', 'Missed: not found within 28 min']);
  assert.equal(item(lost, 'found').ok, false);
  assert.ok(lost.checklist.filter(c => c.key !== 'found').every(c => c.ok), 'everything about the lay is ticked');
  const late = verdictOf(22, meets(22, { findMin: 31 }));
  assert.deepEqual([late.verdict, late.why], ['miss', 'Missed: found in 31 min, the limit is 28 min']);
  assert.equal(verdictOf(22, meets(22, { findMin: 28 })).verdict, 'pass', 'on the limit is inside it');
  assert.equal(verdictOf(8, meets(8, { found: false })).why, 'Missed: not found', 'Hot has no clock');
  assert.equal(verdictOf(8, meets(8, { findMin: 90 })).verdict, 'pass');
  assert.equal(verdictOf(22, meets(22, { debrief: { outcome: 'false' } })).verdict, 'miss', 'a wrong call is a miss');
  /* A dog that lost it half-way covered half the trail. That is a miss, not
     a run thrown out by the honesty check. */
  assert.ok(facts(meets(22, { found: false })).coverage < 0.7);
});

t('a run stopped for the dog is never a miss', () => {
  const r = verdictOf(22, meets(22, { found: false, debrief: { outcome: 'aborted' } }));
  assert.deepEqual([r.verdict, r.why], ['notCounted', 'Not counted: stopped for the dog, which is never a miss']);
});

t('from L26 a find needs its Indication mark; at the L15 boss too', () => {
  const none = verdictOf(26, meets(26, { mark: false }));
  assert.deepEqual([none.verdict, none.why], ['miss', 'Missed: no Indication mark within 30 m of the find']);
  assert.equal(item(none, 'indication').ok, false);
  assert.equal(verdictOf(25, meets(25, { mark: false })).verdict, 'pass', 'not asked before L26');
  assert.equal(verdictOf(15, meets(15, { mark: false })).verdict, 'miss', 'First Trail: the dog shows the find');
  assert.equal(verdictOf(14, meets(14, { mark: false })).verdict, 'pass');
});

t('blind work: the handler from L46, nobody from L51', () => {
  assert.equal(verdictOf(46, meets(46, { debrief: { blind: 'open' } })).why, 'Not counted: the handler knew the route');
  assert.equal(verdictOf(46, meets(46, { debrief: { blind: 'double' } })).verdict, 'pass', 'blinder than asked is fine');
  assert.equal(verdictOf(51, meets(51, { debrief: { blind: 'handler' } })).why, 'Not counted: someone there knew the route');
  assert.equal(verdictOf(51, meets(51, { debrief: { blind: null } })).why, 'Not counted: who knew the route is not answered in the debrief');
  assert.equal(item(verdictOf(51, meets(51)), 'blind').text, 'nobody knows the route');
  assert.equal(verdictOf(45, meets(45, { debrief: { blind: 'open' } })).verdict, 'pass', 'blind work only in Cold');
});

t('the start type and the setting must be right, and answered', () => {
  assert.equal(verdictOf(16, meets(16, { debrief: { start: 'watched' } })).why, 'Not counted: start was Watched, this level needs Article only');
  assert.equal(verdictOf(12, meets(12, { debrief: { start: 'watched' } })).why, 'Not counted: start was Watched, this level needs Watched + article');
  assert.equal(verdictOf(3, meets(3, { debrief: { start: 'article' } })).verdict, 'pass', 'a harder start than asked is fine');
  assert.equal(verdictOf(3, meets(3, { debrief: { start: null } })).why, 'Not counted: start type is not answered in the debrief');
  assert.equal(verdictOf(72, meets(72, { debrief: { start: 'article' } })).why, 'Not counted: start was Article only, this level needs Told directions');
  assert.equal(verdictOf(75, meets(75, { debrief: { start: 'told' } })).why, 'Not counted: start was Told directions, this level needs Last point only');
  assert.equal(item(verdictOf(73, meets(73)), 'start').text, 'told 3 directions');
  assert.equal(verdictOf(70, meets(70, { debrief: { setting: 'rural' } })).why, 'Not counted: setting was Rural, this level needs Semi-urban');
  assert.equal(verdictOf(89, meets(89, { debrief: { setting: 'town' } })).why, 'Not counted: setting was Town, this level needs Town + traffic');
  assert.equal(verdictOf(86, meets(86, { debrief: { setting: 'traffic' } })).verdict, 'pass');
  assert.equal(verdictOf(86, meets(86, { debrief: { setting: null } })).why, 'Not counted: setting is not answered in the debrief');
});

t('surfaces, cross-tracks, the decoy, night, a new place and a stranger are each asked where the ladder says', () => {
  assert.equal(verdictOf(36, meets(36, { surf: ['g'] })).why, 'Not counted: 1 of 2 surfaces');
  assert.equal(verdictOf(36, meets(36, { surf: null })).why, 'Not counted: the ground was not read, so its surfaces are unknown');
  assert.equal(verdictOf(68, meets(68, { surf: NO_HARD_TURN })).why, 'Not counted: no turn on hard ground');
  assert.equal(verdictOf(62, meets(62, { contamination: null })).why, 'Not counted: 0 of 1 cross-track laid after the trail');
  assert.equal(verdictOf(63, meets(63, { contamination: crosses(1) })).why, 'Not counted: 1 of 2 cross-tracks laid after the trail');
  assert.equal(verdictOf(65, meets(65, { contamination: crosses(2) })).why, 'Not counted: nobody walked 50 m along the trail after it was laid');
  assert.equal(verdictOf(41, meets(41, { contamination: null })).why, 'Not counted: no decoy line starting on the trail');
  assert.equal(verdictOf(98, meets(98, { hour: 12 })).why, 'Not counted: run in daylight');
  const here = { lat: 51.4, lon: -2.4 };
  const earlier = run({ day: -3, place: here });
  assert.equal(verdictOf(96, meets(96, { place: project(here, 0, 100) }), { sessions: [earlier] }).why,
    'Not counted: this team has started within 300 m of here before');
  assert.equal(verdictOf(97, meets(97, { layerId: null })).why, 'Not counted: no layer is named on the trail, so the app cannot tell that a stranger laid it');
  const fromCard = meets(97, { layerId: null, extra: { imported: { from: 'Bob (never laid for us)', at: T0 - 30 * DAY } } });
  assert.equal(verdictOf(97, fromCard).verdict, 'pass', 'a trail run from a stranger’s Trail Card is a stranger’s trail');
  const known = run({ day: -3, layerId: 'anna' });
  assert.equal(verdictOf(97, meets(97, { layerId: 'anna' }), { sessions: [known] }).why, 'Not counted: this layer has laid for the team before');
  assert.equal(verdictOf(40, meets(40, { debrief: { target: 'decoy' } })).why, 'Not counted: a decoy trail, not the person’s own');
  assert.equal(verdictOf(40, emptyRun()).why, 'Not counted: an empty trail only counts as half of a pair, from L76');
});

t('the quiet honesty checks: laid on foot, the dog on the trail, the times in order', () => {
  assert.equal(verdictOf(22, meets(22, { layPace: 5 })).why, 'Not counted: the trail was laid at 18 km/h, not on foot');
  assert.equal(verdictOf(5, meets(5, { layPace: 5 })).verdict, 'pass', 'not checked in Hot');
  const elsewhere = meets(22);
  elsewhere.data.track = elsewhere.data.track.map((p, i, a) => (i < a.length * 0.4 ? p : { ...p, lat: p.lat + 0.002 }));
  const r = verdictOf(22, elsewhere);
  assert.equal(r.verdict, 'notCounted');
  assert.match(r.why, /^Not counted: the dog’s track covers \d\d% of the trail$/);
  const backwards = meets(22);
  backwards.startedAt = backwards.data.trackStarted + HOUR;
  assert.equal(verdictOf(22, backwards).why, 'Not counted: its times do not run in order');
  /* None of the three shows on a clean run’s checklist. */
  assert.ok(!verdictOf(22, meets(22)).checklist.some(c => ['onFoot', 'coverage', 'times', 'peek', 'coach', 'help'].includes(c.key)));
  assert.ok(verdictOf(22, meets(22, { layPace: 5 })).checklist.some(c => c.key === 'onFoot' && !c.ok), 'a broken one does');
});

t('above 25 °C a boss waits for a cooler run; other levels still count', () => {
  const r = verdictOf(15, meets(15, { temp: 27 }));
  assert.deepEqual([r.verdict, r.why], ['notCounted', 'Not counted: 27 °C, a boss level waits for a cooler run']);
  assert.equal(verdictOf(15, meets(15, { temp: 27, found: false })).verdict, 'notCounted', 'and is never a miss in the heat');
  assert.equal(verdictOf(15, meets(15, { temp: 25 })).verdict, 'pass');
  assert.equal(verdictOf(15, meets(15, { temp: null })).verdict, 'pass', 'no forecast is not held against the team');
  assert.equal(verdictOf(14, meets(14, { temp: 31 })).verdict, 'pass');
});

t('the heat at the run is read where the app keeps it: the laid forecast, when it reaches the run', () => {
  /* The app fetches a run's own weather only when the laid forecast does not
     reach it, so an ordinary run has data.weather and no data.runWeather. */
  const series = (s, temp, fromH, toH) => {
    const out = [];
    for (let h = fromH; h <= toH; h++) out.push({ t: s.data.trackStarted + h * HOUR, temp });
    return out;
  };
  const boss = meets(15, { temp: null });
  boss.data.weather = { temp: 12, series: series(boss, 31, -6, 6) };
  assert.equal(facts(boss).tempC, 31);
  assert.equal(verdictOf(15, boss).why, 'Not counted: 31 °C, a boss level waits for a cooler run');
  const s = teamLevel([boss], TEAM({ startLevel: 15 }), { now: boss.data.trackStarted + HOUR });
  assert.deepEqual([s.level, s.events.length, s.heat], [15, 0, { tempC: 31, bossWaits: true }]);
  /* Laid weather that lands late is picked up: the facts are read again. */
  const late = meets(15, { temp: null });
  assert.equal(facts(late).tempC, null);
  late.data.weather = { temp: 29, series: series(late, 29, -6, 6) };
  assert.equal(facts(late).tempC, 29);
  /* A forecast that stops short of the run is the air at the lay, another
     day's for an old trail: it is not taken for the run's. */
  const old = meets(100, { temp: null });
  old.data.weather = { temp: 33, series: series(old, 33, -30, -18) };
  assert.equal(facts(old).tempC, null);
  old.data.runWeather = { temp: 14, series: series(old, 14, -1, 2) };
  assert.equal(facts(old).tempC, 14, 'the run’s own forecast, where there is one');
});

t('the dog’s age gates hold a young dog back, only when a birth date is entered', () => {
  const at = (months) => ({ sessions: [], dog: { dob: T0 - Math.round(months * 30.5) * DAY } });
  assert.equal(verdictOf(46, meets(46), at(13)).why, 'Not counted: the dog is 13 months old, Cold starts at 15 months');
  assert.equal(verdictOf(46, meets(46), at(16)).verdict, 'pass');
  assert.equal(verdictOf(61, meets(61), at(16)).why, 'Not counted: the dog is 16 months old, L61 and up wait until 18 months');
  assert.equal(verdictOf(91, meets(91), at(20)).why, 'Not counted: the dog is 20 months old, L91 and up wait until 24 months');
  assert.equal(verdictOf(91, meets(91), at(30)).verdict, 'pass');
  assert.equal(verdictOf(91, meets(91), { sessions: [] }).verdict, 'pass', 'no birth date, no gate');
  assert.equal(verdictOf(45, meets(45), at(8)).verdict, 'pass', 'Hot and Warm have none');
});

t('a Hot run with no laid line: length from the dog’s track, age from "person left"', () => {
  const s = run({ noLine: true, lengthM: 62, debrief: { start: 'watched' } });
  const f = facts(s);
  assert.deepEqual([f.noLine, f.lengthFrom, f.ageMin, f.turns, f.coverage], [true, 'track', null, null, null]);
  assert.ok(Math.abs(f.lengthM - 62) < 1);
  assert.equal(verdictOf(3, s).verdict, 'pass', 'L1-5 ask no age');
  assert.equal(verdictOf(3, s).why, 'Passed: 62 m, found in 8 min');
  /* The track runs on until Found is tapped: the fuss at the person, and
     the phone's wander while it sits there, are not trail. A 20 m runaway
     reached in 15 s, then a minute and a half of play on the spot. */
  for (let k = 0; k < 10; k++) {
    let sd = 500 + k * 104729;
    const r = () => { sd = (sd * 1103515245 + 12345) % 2147483648; return sd / 2147483648 - 0.5; };
    const dash = run({ noLine: true, lengthM: 20, day: -30 - k, findMin: 0.25, debrief: { start: 'watched' } });
    const tk = dash.data.track, end = tk[tk.length - 1];
    let x = 0, y = 0, last = end;
    for (let i = 1; i <= 90; i++) {
      x = x * 0.8 + r() * 6; y = y * 0.8 + r() * 6;
      const p = project(project(end, 0, y), 90, x);
      if (pathLen([last, p]) > 2.5) { tk.push({ lat: p.lat, lon: p.lon, t: end.t + i * 1000 }); last = p; }
    }
    assert.ok(pathLen(tk) > 45, 'the whole track is ' + Math.round(pathLen(tk)) + ' m, enough to pass L3');
    const fd = facts(dash);
    assert.ok(fd.lengthM >= 15 && fd.lengthM < 35, 'a 20 m runaway reads as ' + Math.round(fd.lengthM) + ' m (seed ' + k + ')');
    assert.equal(verdictOf(3, dash).verdict, 'notCounted', 'and does not pass L3 (45 m)');
    /* L2 asks 40 m and Hot allows 15 m of slack, so wander can still carry a
       20 m run over that line: that slack is the spec's own. L3 it never is. */
    assert.ok(teamLevel([dash], TEAM(), { now: T0 }).level <= 3, 'one 20 m run takes L1, at most L2 inside the slack, never L3 and on');
  }
  const noAge = run({ noLine: true, lengthM: 125, debrief: { start: 'watched' } });
  assert.equal(verdictOf(8, noAge).why, 'Not counted: trail age unknown');
  const timed = run({ noLine: true, lengthM: 125.4, leftAgoMin: 3, debrief: { start: 'watched' } });
  assert.equal(facts(timed).ageMin, 3);
  assert.equal(verdictOf(8, timed).verdict, 'pass');
  assert.equal(verdictOf(9, timed).why, 'Not counted: 125 of 150 m, too short');
  /* Outside Hot there is nothing to check the dog against. */
  const warm = run({ noLine: true, lengthM: 200, leftAgoMin: 15 });
  assert.equal(verdictOf(16, warm).why, 'Not counted: no laid trail to check it against');
  /* Once the layer’s line is added it is an ordinary run. */
  const lined = run({ lengthM: 200, ageMin: 12, extra: { lineLater: true } });
  assert.deepEqual([facts(lined).noLine, facts(lined).ageMin, verdictOf(16, lined).verdict], [false, 12, 'pass']);
});

t('a level with no try yet has a blank checklist', () => {
  const r = judge(levelSpec(22), null);
  assert.deepEqual([r.verdict, r.why], ['notCounted', '']);
  assert.deepEqual(r.checklist.map(c => [c.text, c.got, c.ok]), [
    ['300 m', null, false], ['30 min old', null, false], ['1 turn', null, false], ['article start', null, false], ['found within 28 min', null, false]]);
  assert.deepEqual(judge(levelSpec(1), null).checklist.map(c => c.text), ['20 m', 'watched start', 'found']);
  assert.deepEqual(judge(levelSpec(75), null).checklist.map(c => c.key),
    ['length', 'age', 'turns', 'start', 'blind', 'setting', 'crossTracks', 'found', 'indication']);
  assert.ok(judge(levelSpec(78), null).checklist.some(c => c.key === 'pair'));
  assert.equal(judge(null, null), null);
  assert.deepEqual(judge(22, null), judge(levelSpec(22), null), 'a level number will do');
  assert.equal(teamLevel([meets(1)], null, { now: T0 }).level, 1, 'no team, no tries');
});

/* ── Where a team stands ──────────────────────────────────────────── */

const NOW = T0 + 40 * DAY;
const stand = (sessions, team = TEAM(), opts = {}) => teamLevel(sessions, team, { now: NOW, ...opts });

t('a new team stands on L1 with no name yet, and what L1 asks', () => {
  const s = stand([]);
  assert.deepEqual([s.level, s.done, s.passed, s.name, s.stage, s.rank, s.roman], [1, false, 0, null, 'hot', null, null]);
  assert.equal(s.next.spec.name, 'Puppy Nose I', 'the name to be earned is on the next level');
  assert.equal(s.title, null);
  assert.equal(s.next.spec, levelSpec(1));
  assert.deepEqual(s.next.checklist.map(c => [c.text, c.ok]), [['20 m', false], ['watched start', false], ['found', false]]);
  assert.deepEqual(s.tries, []);
  assert.deepEqual(s.events, []);
  assert.deepEqual(s.counted, { today: 0, max: 5, left: 5 });
  assert.deepEqual([s.easeOff, s.rusty, s.heat, s.gate], [null, null, null, null]);
  assert.equal(s.placement.state, 'none');
  assert.deepEqual(s.best, { v: 1, level: 0, at: null });
  assert.equal(s.bestChanged, false);
});

t('one good run passes the level, and the try says why', () => {
  const a = meets(1, { day: 0 });
  const s = stand([a]);
  assert.deepEqual([s.level, s.name, s.rank, s.roman, s.passed], [2, 'Puppy Nose I', 'Puppy Nose', 'I', 1]);
  assert.deepEqual(s.tries.map(x => [x.id, x.level, x.verdict, x.why, x.passed]), [[a.id, 1, 'pass', 'Passed: 22 m, found in 8 min', [1]]]);
  assert.deepEqual(s.events.map(e => [e.type, e.from, e.to, e.fromName, e.toName, e.sessionId]),
    [['levelUp', 1, 2, null, 'Puppy Nose I', a.id]]);
  /* The next pass flips the name it had for the one it has just earned. */
  const b = meets(2, { day: 1 });
  const up = stand([a, b]);
  assert.deepEqual([up.name, up.events[1].fromName, up.events[1].toName], ['Puppy Nose II', 'Puppy Nose I', 'Puppy Nose II']);
  assert.equal(up.name, levelName(up.passed));
  assert.deepEqual(s.best, { v: 1, level: 1, at: a.data.track[a.data.track.length - 1].t });
  assert.equal(s.bestChanged, true);
});

t('a run passes every later level in its wave that it also meets, and never into the next wave', () => {
  /* 205 m watched and 6 min old meets all of L1-5, and all of L6-10 too. */
  const big = run({ day: 0, lengthM: 205, ageMin: 6, debrief: { start: 'watched' } });
  const s = stand([big]);
  assert.equal(s.level, 6, 'stops at the wave’s end');
  assert.deepEqual(s.tries[0].passed, [1, 2, 3, 4, 5]);
  assert.deepEqual(s.events.map(e => [e.type, e.from, e.to, e.passed]), [['levelUp', 1, 6, [1, 2, 3, 4, 5]]]);
  assert.equal(s.name, 'Puppy Nose V');
  assert.deepEqual([s.events[0].fromName, s.events[0].toName], [null, 'Puppy Nose V'], 'the name of the highest level the run passed');
  /* The same run again the next day takes the next wave. */
  const again = run({ day: 1, lengthM: 205, ageMin: 6, debrief: { start: 'watched' } });
  assert.equal(stand([big, again]).level, 11);
  /* It stops at the first level it does not meet, even if it meets a later one. */
  const part = run({ day: 0, lengthM: 65, debrief: { start: 'watched' } });
  assert.deepEqual(stand([part]).tries[0].passed, [1, 2, 3]);
  assert.equal(stand([part]).level, 4);
  const turny = meets(21, { day: 0, lengthM: 300, turns: 1 });
  const st = stand([turny], TEAM({ startLevel: 21 }));
  assert.deepEqual([st.level, st.tries[0].passed], [23, [21, 22]], 'one turn passes the two one-turn levels and no more');
});

t('a not-counted run moves nothing and is never a miss', () => {
  const short = meets(22, { day: 0, lengthM: 200 });
  const s = stand([short], TEAM({ startLevel: 22 }));
  assert.equal(s.level, 22);
  assert.deepEqual([s.tries[0].verdict, s.tries[0].why], ['notCounted', 'Not counted: 200 of 300 m, too short']);
  assert.equal(s.counted.today, 0);
  assert.equal(s.easeOff, null);
  assert.equal(s.placement.triesLeft, 2, 'nor is it one of the placement tries');
  assert.equal(item(s.next, 'length')?.ok ?? item({ checklist: s.next.checklist }, 'length').ok, false);
  assert.equal(s.next.bestTryId, short.id);
});

t('the card’s checklist is the best of the recent tries at the level', () => {
  const far = meets(23, { day: 0, lengthM: 200, turns: 0, found: false });
  const near = meets(23, { day: 1, found: false });
  const worse = meets(23, { day: 2, ageMin: 5, turns: 1 });
  const s = stand([far, near, worse], TEAM({ startLevel: 23 }));
  assert.equal(s.next.bestTryId, near.id);
  assert.deepEqual(s.next.checklist.map(c => [c.text, c.ok]),
    [['300 m', true], ['30 min old', true], ['2 turns', true], ['article start', true], ['found within 28 min', false]]);
  assert.deepEqual(s.tries.map(x => x.id), [worse.id, near.id, far.id], 'the last three, newest first');
  assert.deepEqual(s.tries.map(x => x.verdict), ['notCounted', 'miss', 'notCounted']);
});

t('two misses in a row: Ease off, with an easier run suggested, and nothing taken away', () => {
  const m1 = meets(23, { day: 0, found: false }), m2 = meets(23, { day: 1, found: false });
  const one = stand([m1], TEAM({ startLevel: 23 }));
  assert.equal(one.easeOff, null);
  const two = stand([m1, m2], TEAM({ startLevel: 23 }));
  assert.deepEqual(two.easeOff, { misses: 2, suggest: 21 }, 'a run from the start of the wave');
  assert.equal(two.level, 23, 'a level is never taken away');
  /* A not-counted run in between does not break the row. */
  const nc = meets(23, { day: 1, hour: 9, lengthM: 100 });
  assert.equal(stand([m1, nc, m2], TEAM({ startLevel: 23 })).easeOff.misses, 2);
  /* The easier run, found, ends the day on a find and clears it. It is a
     pass "again": the team stays on L23. */
  const easy = meets(21, { day: 2 });
  const eased = stand([m1, m2, easy], TEAM({ startLevel: 23 }));
  assert.deepEqual([eased.level, eased.easeOff], [23, null]);
  assert.deepEqual([eased.tries[0].verdict, eased.tries[0].level, eased.tries[0].again, eased.tries[0].passed], ['pass', 21, true, []]);
  assert.match(eased.tries[0].why, /^Passed: .* \(L21 again\)$/);
  assert.deepEqual(eased.events, [], 'and it is no level-up');
  /* On the first level of a wave the easier run is the start of the wave
     before: never the level just below, which is that wave's hardest. */
  const w1 = meets(21, { day: 0, found: false }), w2 = meets(21, { day: 1, found: false });
  assert.deepEqual(stand([w1, w2], TEAM({ startLevel: 21 })).easeOff, { misses: 2, suggest: 16 });
  const backAWave = stand([w1, w2, meets(16, { day: 2 })], TEAM({ startLevel: 21 }));
  assert.deepEqual([backAWave.easeOff, backAWave.level, backAWave.tries[0].again, backAWave.tries[0].level], [null, 21, true, 16]);
  /* Whatever level a team misses twice on, the run suggested is the first of
     a wave, easier than the level missed, and never a boss. A placed team is
     told one thing: Ease off and the placement check name the same level. */
  for (let n = 2; n <= 100; n++) {
    const L = levelSpec(n);
    /* One half of a pair unsolved is a miss like any other; days apart so the cap never comes into it. */
    const misses = [meets(n, { day: -20, found: false }), meets(n, { day: -10, found: false })];
    const st = stand(misses, TEAM({ startLevel: n, placedAt: T0 - 100 * DAY }));
    assert.equal(st.easeOff?.misses, 2, 'L' + n + ' two misses');
    const to = levelSpec(st.easeOff.suggest);
    assert.ok(!to.boss && to.step === 1 && to.level < n, 'L' + n + ' eases to L' + to.level);
    assert.ok(to.lengthM <= L.lengthM && to.ageMin <= L.ageMin, 'L' + to.level + ' asks no more than L' + n);
    if (L.step === 1) assert.equal(st.easeOff.suggest, st.placement.suggest, 'L' + n + ': one suggestion, not two');
  }
  for (const p of PRESETS.filter(x => x.startLevel > 1)) {
    const st = stand([meets(p.startLevel, { day: -20, found: false }), meets(p.startLevel, { day: -10, found: false })],
      TEAM({ startLevel: p.startLevel, placedAt: T0 - 100 * DAY }));
    assert.deepEqual([st.placement.state, st.easeOff.suggest], ['suggest', st.placement.suggest], p.label);
  }
  /* Misses that ended with the trail shown, or the handler taking over,
     are misses: Ease off and the placement check both see them. */
  const rescued = [0, 1].map(i => { const s = meets(20, { day: i, found: false, findMin: 25 }); s.data.revealedAt = s.data.trackStarted + 20 * MIN; return s; });
  const placed20 = TEAM({ startLevel: 20, placedAt: T0 - DAY });
  const r1 = stand([rescued[0]], placed20), r2 = stand(rescued, placed20);
  assert.deepEqual([r1.tries[0].verdict, r1.easeOff, r1.placement.triesLeft], ['miss', null, 1]);
  assert.deepEqual([r2.easeOff, r2.placement.state, r2.placement.suggest], [{ misses: 2, suggest: 16 }, 'suggest', 15]);
  assert.equal(teamLevel(rescued, placed20, { now: rescued[1].data.trackStarted + HOUR }).counted.today, 1, 'and each is a counted run');
  const ledTwice = [0, 1].map(i => meets(20, { day: i, found: false, debrief: { help: 'led' } }));
  assert.deepEqual([stand(ledTwice, placed20).easeOff?.misses, stand(ledTwice, placed20).placement.state], [2, 'suggest']);
  /* A pass at the level clears it as well. */
  assert.equal(stand([m1, m2, meets(23, { day: 2 })], TEAM({ startLevel: 23 })).easeOff, null);
});

t('the stamp on a run decides which level an unsolved trail is a miss at', () => {
  const team = TEAM({ startLevel: 23 });
  /* Laid for L21 (one turn), not found. Unstamped, it does not meet L23 and
     is simply not counted. Stamped as a try at L21, it is a miss there. */
  const plain = meets(21, { day: 0, lengthM: 300, found: false });
  assert.deepEqual([stand([plain], team).tries[0].verdict, stand([plain], team).tries[0].why],
    ['notCounted', 'Not counted: 1 of 2 turns']);
  const stamped = meets(21, { day: 0, lengthM: 300, found: false, levelTry: { v: 1, level: 21 } });
  const s = stand([stamped], team);
  assert.deepEqual([s.tries[0].verdict, s.tries[0].level, s.tries[0].why], ['miss', 21, 'Missed: not found within 28 min']);
  assert.equal(s.level, 23);
  assert.equal(s.counted.today, 0);
  assert.equal(stand([stamped], team, { now: T0 + HOUR }).counted.today, 1, 'a miss is a counted run');
  /* A stamped run that is good enough for the team’s own level passes it. */
  const better = meets(23, { day: 0, levelTry: { v: 1, level: 21 } });
  assert.equal(stand([better], team).level, 24);
  /* A stamp from another ladder version is ignored. */
  const other = meets(21, { day: 0, lengthM: 300, found: false, levelTry: { v: 2, level: 21 } });
  assert.equal(stand([other], team).tries[0].verdict, 'notCounted');
  /* A stamp above the team: the run was a try up there, and unsolved it is
     no miss down here. A team that took the placement suggestion (L26 down
     to L21) does not arrive with its two misses at L26 held against L21. */
  const up26 = [0, 1].map(i => meets(26, { day: i, found: false, levelTry: { v: 1, level: 26 } }));
  const placedAt = T0 - DAY;
  const before = stand(up26, TEAM({ startLevel: 26, placedAt }));
  assert.deepEqual([before.easeOff?.misses, before.placement.state, before.placement.suggest], [2, 'suggest', 21]);
  const moved = stand(up26, TEAM({ startLevel: 21, placedAt }));
  assert.deepEqual(moved.tries.map(x => [x.level, x.verdict, x.why]),
    [[21, 'notCounted', 'Not counted: it was a try at L26, before the team moved down'],
      [21, 'notCounted', 'Not counted: it was a try at L26, before the team moved down']]);
  assert.deepEqual([moved.easeOff, moved.placement], [null, { state: 'pending', startLevel: 21, triesLeft: 2, suggest: null }]);
  assert.equal(teamLevel(up26, TEAM({ startLevel: 21, placedAt }), { now: up26[1].data.trackStarted + HOUR }).counted.today, 0);
  /* Found, a run stamped higher still passes what it meets. */
  assert.equal(stand([meets(26, { day: 0, levelTry: { v: 1, level: 26 } })], TEAM({ startLevel: 21, placedAt })).level > 21, true);
});

t('placement: a placed team has two counted tries to pass where it was put', () => {
  const team = TEAM({ startLevel: 26, placedAt: T0 - DAY });
  assert.deepEqual(stand([], team).placement, { state: 'pending', startLevel: 26, triesLeft: 2, suggest: null });
  assert.deepEqual([stand([], team).level, stand([], team).name, stand([], team).passed], [26, 'Turn Finder V', 25]);
  const m1 = meets(26, { day: 0, found: false }), m2 = meets(26, { day: 1, found: false });
  assert.equal(stand([m1], team).placement.triesLeft, 1);
  const failed = stand([m1, m2], team);
  assert.deepEqual(failed.placement, { state: 'suggest', startLevel: 26, triesLeft: 0, suggest: 21 }, 'five levels lower');
  assert.equal(failed.level, 26, 'it is a suggestion; nothing is lost');
  assert.equal(stand([m1, meets(26, { day: 1 })], team).placement.state, 'passed');
  assert.equal(stand([m1, m2, meets(26, { day: 2 })], team).placement.state, 'passed', 'passing later settles it');
  assert.equal(stand([m1, m2], TEAM({ startLevel: 3, placedAt: T0 - DAY })).placement.suggest, 1, 'never below L1');
  /* Runs from before the team was placed are history, not tries. */
  const old = meets(26, { day: -5 });
  const s = stand([old], team);
  assert.deepEqual([s.level, s.tries.length, s.placement.triesLeft], [26, 0, 2]);
});

t('rusty after 30 days without a counted run; one pass at the start of the wave clears it', () => {
  const team = TEAM({ startLevel: 21 });
  const up = meets(21, { day: 0, lengthM: 300, turns: 1 });               // passes 21 and 22: the team is on L23
  assert.equal(stand([up], team, { now: T0 + 29 * DAY }).rusty, null);
  const r = stand([up], team, { now: T0 + 31 * DAY });
  assert.deepEqual(r.rusty, { since: up.data.trackStarted, days: 31, suggest: 21 });
  assert.equal(r.level, 23, 'rusty takes nothing away');
  assert.equal(stand([], team, { now: T0 + 400 * DAY }).rusty, null, 'a team that has never run is not rusty');
  /* A not-counted run does not make the team fresh again. */
  const nc = meets(23, { day: 40, lengthM: 100 });
  assert.notEqual(stand([up, nc], team, { now: T0 + 41 * DAY }).rusty, null);
  /* A run back at the start of the wave, found, clears it and stays on L23. */
  const back = meets(21, { day: 40 });
  const cleared = stand([up, back], team, { now: T0 + 41 * DAY });
  assert.deepEqual([cleared.rusty, cleared.level, cleared.tries[0].again, cleared.tries[0].level], [null, 23, true, 21]);
  /* So does simply passing the level. */
  assert.equal(stand([up, meets(23, { day: 40 })], team, { now: T0 + 41 * DAY }).rusty, null);
  /* A miss after the gap is a counted run, but rusty stays until a pass. */
  const missed = stand([up, meets(23, { day: 40, found: false })], team, { now: T0 + 41 * DAY });
  assert.deepEqual([missed.rusty?.suggest, missed.rusty?.days], [21, 1]);
});

t('the daily cap: three counted runs a day, five in Hot', () => {
  const team = TEAM({ startLevel: 23 });
  const day = [0, 1, 2, 3].map(i => meets(23, { day: 0, hour: 8 + i, found: false }));
  const s = stand(day, team, { now: T0 });
  assert.deepEqual(s.counted, { today: 3, max: 3, left: 0 });
  assert.deepEqual(s.tries[0].verdict, 'notCounted');
  assert.equal(s.tries[0].why, 'Not counted: 3 runs already counted today, the dog has done enough');
  /* The fourth would have passed: it still waits for tomorrow. */
  const good = [...day.slice(0, 3), meets(23, { day: 0, hour: 14 })];
  assert.equal(stand(good, team, { now: T0 }).level, 23);
  assert.equal(stand([...day.slice(0, 3), meets(23, { day: 1 })], team, { now: T0 + DAY }).level, 24, 'the next day counts again');
  /* Not-counted runs use none of the cap. */
  const mixed = [meets(23, { day: 0, hour: 7, lengthM: 100 }), meets(23, { day: 0, hour: 8, lengthM: 100 }),
    meets(23, { day: 0, hour: 9, lengthM: 100 }), meets(23, { day: 0, hour: 10 })];
  assert.equal(stand(mixed, team, { now: T0 }).level, 24);
  /* Hot: five. */
  const hot = TEAM({ startLevel: 8 });
  const six = [0, 1, 2, 3, 4, 5].map(i => meets(8, { day: 0, hour: 7 + i, found: false }));
  const h = stand(six, hot, { now: T0 });
  assert.deepEqual(h.counted, { today: 5, max: 5, left: 0 });
  assert.equal(h.tries[0].why, 'Not counted: 5 runs already counted today, the dog has done enough');
  assert.equal(h.tries[1].verdict, 'miss');
  /* A pair is two runs, so it can be refused with only two counted. Both
     halves then say so, and say the true number. */
  const t76 = TEAM({ startLevel: 76 });
  const dayOf = [meets(76, { day: 0, hour: 7, found: false }), meets(76, { day: 0, hour: 9, found: false }),
    meets(76, { day: 0, hour: 11 }), emptyRun({ day: 0, hour: 13 })];
  const p = stand(dayOf, t76, { now: T0 + 2 * HOUR });
  const pairWhy = 'Not counted: 2 runs already counted today and a pair is two more, the limit is 3';
  assert.deepEqual([p.level, p.counted.today], [76, 2]);
  assert.deepEqual(p.tries.map(x => [x.id, x.verdict, x.why]),
    [[dayOf[3].id, 'notCounted', pairWhy], [dayOf[2].id, 'notCounted', pairWhy], [dayOf[1].id, 'miss', 'Missed: not found within 36 min']]);
  /* With room for both, the same pair passes. */
  assert.equal(stand(dayOf.slice(1), t76, { now: T0 + 2 * HOUR }).level, 78);
});

t('heat: the board warns, and a boss waits even at the end of a good run', () => {
  /* A warm day’s run good enough for L11 to L15: it takes four and stops at the boss. */
  const hotDay = meets(15, { day: 0, temp: 28 });
  const s = stand([hotDay], TEAM({ startLevel: 11 }), { now: T0 + HOUR });
  assert.deepEqual([s.level, s.tries[0].passed], [15, [11, 12, 13, 14]]);
  assert.deepEqual(s.heat, { tempC: 28, bossWaits: true });
  assert.equal(s.title, null);
  const cool = meets(15, { day: 1, temp: 14 });
  const c = stand([hotDay, cool], TEAM({ startLevel: 11 }), { now: T0 + DAY + HOUR });
  assert.deepEqual([c.level, c.title, c.heat], [16, 'Trail Hound', null]);
  assert.equal(stand([hotDay], TEAM({ startLevel: 11 }), { now: T0 + 3 * DAY }).heat, null, 'the warning is for the day');
});

t('passing a boss gives the title and a boss event; the stage changes', () => {
  const s = stand([meets(15, { day: 0 })], TEAM({ startLevel: 15 }));
  assert.deepEqual([s.level, s.stage, s.name, s.title, s.titleLevel], [16, 'warm', 'Scent Reader V', 'Trail Hound', 15]);
  assert.deepEqual([s.events[0].fromName, s.events[0].toName], ['Scent Reader IV', 'Scent Reader V']);
  assert.deepEqual(s.events.map(e => e.type), ['levelUp', 'boss']);
  assert.deepEqual([s.events[0].fromStage, s.events[0].toStage, s.events[0].stageChanged], ['hot', 'warm', true]);
  assert.deepEqual([s.events[1].level, s.events[1].bossName, s.events[1].title], [15, 'First Trail', 'Trail Hound']);
  /* A team placed above a boss never ran it and does not carry its title. */
  assert.equal(stand([meets(46, { day: 0 })], TEAM({ startLevel: 46 })).title, null);
  /* The last level: done, and it too brings a new name. */
  const end = stand([meets(100, { day: 0 })], TEAM({ startLevel: 100 }));
  assert.deepEqual([end.level, end.done, end.passed, end.name, end.title, end.next], [100, true, 100, 'Mission Ready V', 'Master Trailer', null]);
  assert.deepEqual([end.events[0].to, end.events[0].done, end.events[1].title], [100, true, 'Master Trailer']);
  assert.deepEqual([end.events[0].fromName, end.events[0].toName], ['Mission Ready IV', 'Mission Ready V']);
  assert.equal(stand([], TEAM({ startLevel: 100 })).name, 'Mission Ready IV', 'before the boss is run the top name is not yet earned');
  /* No level-up ever flips a name for itself. */
  const climb = stand([1, 2, 3, 4, 5, 6].map((n, i) => meets(n, { day: i })));
  assert.ok(climb.events.length >= 5 && climb.events.every(e => e.type !== 'levelUp' || e.fromName !== e.toName));
  const after = stand([meets(100, { day: 0 }), meets(100, { day: 1 })], TEAM({ startLevel: 100 }));
  assert.equal(after.tries[0].why, 'Not counted: every level is already passed');
});

t('events since a moment: what the run just saved has earned', () => {
  const a = meets(1, { day: 0 }), b = meets(2, { day: 1 });
  const all = stand([a, b]);
  assert.deepEqual(all.events.map(e => [e.from, e.to]), [[1, 2], [2, 3]]);
  const fresh = stand([a, b], TEAM(), { since: b.data.trackStarted });
  assert.deepEqual(fresh.events.map(e => [e.from, e.to, e.sessionId]), [[2, 3, b.id]]);
  assert.deepEqual(stand([a, b], TEAM(), { since: NOW }).events, []);
});

t('the dog’s age gates in a team: the run waits, and the board says until when', () => {
  const dog = { id: 'd1', dob: T0 - 400 * DAY };                   // 13 months on the day
  const s = stand([meets(46, { day: 0 })], TEAM({ startLevel: 46 }), { dog, now: T0 + DAY });
  assert.equal(s.level, 46);
  assert.equal(s.tries[0].why, 'Not counted: the dog is 13 months old, Cold starts at 15 months');
  assert.deepEqual(s.gate, { level: 46, months: 13, needMonths: 15 });
  const older = { id: 'd1', dob: T0 - 600 * DAY };
  const o = stand([meets(46, { day: 0, lengthM: 400 })], TEAM({ startLevel: 46 }), { dog: older, now: T0 + DAY });
  assert.deepEqual([o.level, o.gate], [48, null], 'L46 and L47 ask the same, so one run takes both');
  /* A wave that crosses a gate stops at it: L60 passes, L61 waits for 18 months. */
  assert.equal(stand([meets(60, { day: 0 })], TEAM({ startLevel: 60 }), { dog: { dob: T0 - 500 * DAY }, now: T0 + DAY }).gate.needMonths, 18);
  assert.equal(stand([meets(46, { day: 0, lengthM: 400 })], TEAM({ startLevel: 46 }), { now: T0 + DAY }).level, 48, 'no birth date, no gate');
});

t('the high-water mark never goes down', () => {
  /* Earned, then the sessions are gone (a new phone, a deleted run). */
  const kept = { v: 1, level: 30, at: T0 - 10 * DAY };
  const s = stand([], TEAM({ best: kept }));
  assert.deepEqual([s.level, s.name, s.earned], [31, 'True Indicator V', 30]);
  assert.deepEqual(s.best, kept);
  assert.equal(s.bestChanged, false);
  assert.equal(s.title, 'Trail Hound', 'the bosses on the way were passed');
  /* The next run is a try at L31, not at L1. */
  const up = stand([meets(31, { day: 0 })], TEAM({ best: kept }));
  assert.deepEqual([up.level, up.best.level, up.bestChanged, up.tries[0].passed], [32, 31, true, [31]]);
  /* A replay that comes out lower leaves it where it was. */
  const low = stand([meets(1, { day: 0 })], TEAM({ best: kept }));
  assert.deepEqual([low.level, low.best], [31, kept]);
  /* A stricter ladder later cannot lower it either, and keeps the version it was earned under. */
  const strict = { ...LADDER_V1, v: 2, levels: LADDER_V1.levels.map(l => ({ ...l, v: 2, lengthM: l.lengthM * 2 })) };
  const runs = [meets(1, { day: 0 }), meets(2, { day: 1 }), meets(3, { day: 2 })];
  const v1 = stand(runs);
  assert.equal(v1.level, 4);
  const v2 = stand(runs, TEAM({ best: v1.best }), { ladder: strict });
  assert.deepEqual([v2.level, v2.best, v2.bestChanged], [4, v1.best, false]);
  assert.equal(v2.v, 2);
  /* And what is earned under the new one is stamped with it. */
  const more = stand([...runs, run({ day: 3, lengthM: 190, debrief: { start: 'watched' } })], TEAM({ best: v1.best }), { ladder: strict });
  assert.deepEqual([more.level, more.best.v, more.best.level], [5, 2, 4]);
  /* A mark with no date is a floor from the start. */
  assert.equal(stand([meets(31, { day: 0 })], TEAM({ best: { v: 1, level: 30 } })).level, 32);
});

t('the empty-trail pair: one real trail found and one empty trail called right, the same day', () => {
  const team = TEAM({ startLevel: 76 });
  const real = (o = {}) => meets(76, { day: 0, hour: 9, ...o });
  /* The real trail alone waits for its pair. */
  const alone = stand([real()], team, { now: T0 });
  assert.equal(alone.level, 76);
  assert.deepEqual([alone.tries[0].verdict, alone.tries[0].why],
    ['notCounted', 'Not counted yet: it needs an empty trail called right on the same day']);
  assert.deepEqual(item({ checklist: alone.next.checklist }, 'pair').ok, false);
  assert.equal(alone.counted.today, 0);
  /* So does the empty one. */
  const justEmpty = stand([emptyRun({ day: 0, hour: 9 })], team, { now: T0 });
  assert.equal(justEmpty.tries[0].why, 'Not counted yet: it needs its real trail found on the same day');

  /* Empty first, then the real one: L76 and L77 take any order. The pair is
     one good run, and both halves read as passed. */
  const e1 = emptyRun({ day: 0, hour: 8 }), r1 = real();
  const any = stand([e1, r1], team, { now: T0 });
  assert.equal(any.level, 78, 'L78 wants the empty one second');
  assert.deepEqual(any.tries.map(x => [x.id, x.verdict, x.pairWith, x.passed]), [[r1.id, 'pass', e1.id, [76, 77]], [e1.id, 'pass', r1.id, [76, 77]]]);
  assert.match(any.tries[0].why, /^Passed: 602 m, 3 h old, found in 8 min, and the empty trail called right$/);
  assert.deepEqual(any.events.map(e => [e.from, e.to, e.sessionId]), [[76, 78, r1.id]]);
  assert.equal(any.counted.today, 2, 'a pair is two counted runs');

  /* Real first, then empty, laid for L80: the whole wave. */
  const r2 = meets(80, { day: 0, hour: 9 }), e2 = emptyRun({ day: 0, hour: 11 });
  const whole = stand([r2, e2], team, { now: T0 });
  assert.deepEqual([whole.level, whole.tries[0].passed, whole.name], [81, [76, 77, 78, 79, 80], 'Honest Nose V']);
  assert.equal(whole.events[0].sessionId, e2.id, 'the level-up is when the pair is complete');

  /* On different days they are not a pair. */
  assert.equal(stand([real(), emptyRun({ day: 1, hour: 9 })], team, { now: T0 + DAY }).level, 76);
  /* At L78 the empty one must come second. */
  const t78 = TEAM({ startLevel: 78 });
  const wrongOrder = stand([emptyRun({ day: 0, hour: 8 }), meets(78, { day: 0, hour: 10 })], t78, { now: T0 });
  assert.equal(wrongOrder.level, 78);
  assert.equal(wrongOrder.tries[0].why, 'Not counted yet: it needs an empty trail called right after it, on the same day');
  assert.equal(stand([emptyRun({ day: 0, hour: 8 })], t78, { now: T0 }).tries[0].why,
    'Not counted yet: at this level the real trail is run first, then the empty one');
  assert.equal(stand([meets(78, { day: 0, hour: 8 }), emptyRun({ day: 0, hour: 10 })], t78, { now: T0 }).level, 79);

  /* An empty trail called wrong is a miss; so is the real trail not found. */
  const falseCall = stand([emptyRun({ day: 0, hour: 8, debrief: { outcome: 'false' } })], team, { now: T0 });
  assert.deepEqual([falseCall.tries[0].verdict, falseCall.tries[0].why], ['miss', 'Missed: the empty trail was called wrong']);
  assert.equal(stand([real({ found: false })], team, { now: T0 }).tries[0].verdict, 'miss');
  /* The empty half is a blind run like any other. */
  assert.equal(stand([emptyRun({ day: 0, hour: 8, debrief: { blind: 'handler' } }), real()], team, { now: T0 }).level, 76);
  assert.equal(stand([emptyRun({ day: 0, hour: 8, debrief: { help: 'verbal' } }), real()], team, { now: T0 }).level, 76);
  /* One empty trail pairs with one real trail, not two. */
  const two = stand([emptyRun({ day: 0, hour: 7 }), meets(76, { day: 0, hour: 8, lengthM: 600, ageMin: 180 }), meets(77, { day: 0, hour: 10 })],
    TEAM({ startLevel: 76 }), { now: T0 });
  assert.equal(two.level, 78);
  /* L99 is a pair too, in any order, and a single run cannot take it. */
  const t98 = TEAM({ startLevel: 98 });
  const night = meets(100, { day: 0, hour: 0 });
  assert.deepEqual(stand([night], t98, { now: T0 }).tries[0].passed, [98], 'L98 passes; L99 waits for its empty trail');
  const t99 = TEAM({ startLevel: 99 });
  assert.equal(stand([emptyRun({ day: 0, hour: 8 }), meets(99, { day: 0, hour: 10 })], t99, { now: T0 }).level, 100);
});

t('the same dog with another handler is another team, with its own level', () => {
  const mine = [meets(1, { day: 0 }), meets(2, { day: 1 })];
  const theirs = [run({ day: 0, hour: 9, lengthM: 205, ageMin: 6, debrief: { start: 'watched' }, handlerId: 'h2' })];
  const all = [...mine, ...theirs];
  assert.equal(stand(all, TEAM()).level, 3);
  assert.equal(stand(all, TEAM({ handlerId: 'h2' })).level, 6);
  assert.equal(stand(all, TEAM({ handlerId: 'h2' })).tries.length, 1);
  assert.equal(stand(all, TEAM({ dogId: 'd2' })).level, 1, 'and the same handler with another dog');
  assert.equal(stand(all, TEAM({ handlerId: 'h3' })).tries.length, 0);
});

t('hide searches, trails only laid, deleted runs and other people’s runs are not tries', () => {
  const hide = meets(1, { day: 0, targetId: 'narcotics' });
  const withHides = meets(1, { day: 0, hour: 9, extra: { hides: [{ lat: 51, lon: -2 }] } });
  const laidOnly = meets(1, { day: 0, hour: 10 });
  delete laidOnly.data.track; delete laidOnly.data.trackStarted;
  const deleted = { ...meets(1, { day: 0, hour: 11 }), deleted: true };
  const kept = meets(1, { day: 0, hour: 13, extra: { imported: { at: T0 + 2 * DAY } } });   // someone else’s whole run, kept from a link
  for (const s of [hide, withHides, laidOnly, deleted, kept]) assert.equal(isLevelRun(s), false);
  const s = stand([hide, withHides, laidOnly, deleted, kept]);
  assert.deepEqual([s.level, s.tries.length, s.counted.today], [1, 0, 0]);
  assert.equal(judge(levelSpec(1), facts(hide)).why, 'Not counted: not a person trail that was run');
  /* A trail that came as a card and was then run here is the team’s own. */
  const card = meets(1, { day: 0, extra: { imported: { at: T0 - DAY } } });
  assert.equal(isLevelRun(card), true);
  assert.equal(stand([card]).level, 2);
});

t('a new place and a stranger are worked out inside the team’s own record', () => {
  const team = TEAM({ startLevel: 96, placedAt: T0 });
  const here = { lat: 51.6, lon: -2.2 };
  const before = run({ day: -20, place: here, layerId: 'anna' });           // history from before the team was placed
  const same = stand([before, meets(96, { day: 1, place: project(here, 10, 120) })], team);
  assert.equal(same.tries[0].why, 'Not counted: this team has started within 300 m of here before');
  assert.equal(stand([before, meets(96, { day: 1 })], team).level, 97);
  const t97 = TEAM({ startLevel: 97, placedAt: T0 });
  assert.equal(stand([before, meets(97, { day: 1, layerId: 'anna' })], t97).tries[0].why, 'Not counted: this layer has laid for the team before');
  assert.equal(stand([before, meets(97, { day: 1, layerId: 'zed' })], t97).level, 98);
  /* The team’s record and a single run’s facts agree. */
  const again = meets(96, { day: 2, place: project(here, 200, 80) });
  assert.equal(runFacts(again, { sessions: [before, again] }).newPlace, false);
});

t('the same sessions always give the same standing, in any order, with no clock of its own', () => {
  const sessions = [meets(1, { day: 0 }), meets(2, { day: 1, found: false }), meets(2, { day: 2 }), run({ day: 3, lengthM: 30 }),
    meets(3, { day: 4, hour: 8 }), meets(4, { day: 4, hour: 10, found: false }), meets(4, { day: 6, temp: 30 })];
  const realNow = Date.now;
  Date.now = () => { throw new Error('levels.js must not read the clock'); };
  let a, b, c;
  try {
    a = stand(sessions);
    b = stand(sessions);
    c = stand([...sessions].reverse());
    judge(levelSpec(20), runFacts(sessions[0], { sessions }));
  } finally { Date.now = realNow; }
  assert.deepEqual(a, b);
  assert.deepEqual(a, c);
  assert.equal(a.level, 5);
  assert.equal(JSON.stringify(a), JSON.stringify(c));
  /* A debrief edited in place is seen: the facts are not stuck on the old answer. */
  const s = meets(22, { day: 0, debrief: { outcome: 'missed' } });
  const team = TEAM({ startLevel: 22 });
  assert.equal(stand([s], team).level, 22);
  s.data.debrief.outcome = 'found';
  assert.equal(stand([s], team).level, 23);
  /* With no `now` it falls back on the record, never on the clock. */
  assert.equal(teamLevel(sessions, TEAM()).level, 5);
  const src = readFileSync(new URL('../public/levels.js', import.meta.url), 'utf8');
  assert.ok(!/Date\.now\(/.test(src), 'no Date.now() in the engine');
  assert.ok(!/\bdocument\b|\bwindow\b|\bfetch\(|localStorage/.test(src.replace(/\/\*[\s\S]*?\*\//g, '')), 'no screen, no network, no storage');
  assert.ok(!/export (const|function) LEVELS\b/.test(src));
});

t('a run’s day is its own, whatever time zone the phone reading it is in', () => {
  /* One North Carolina evening, 18:00 to 21:30 EDT: three misses, then a
     find. It straddles midnight in Somerset. */
  const NC = { lat: 35.3, lon: -80.7 };
  const eve = (h, m, o = {}) => meets(16, { place: project(NC, 0, h * 400), day: 0, hour: h + 4, minute: m, ...o });
  const evening = [eve(18, 0, { found: false }), eve(19, 0, { found: false }), eve(20, 30, { found: false }), eve(21, 30)];
  const pairDay = [emptyRun({ place: NC, day: 5, hour: 21 }), meets(76, { place: project(NC, 0, 900), day: 5, hour: 24, minute: 30 })];
  const read = (zone) => {
    const was = process.env.TZ;
    process.env.TZ = zone;
    try {
      return JSON.stringify([
        teamLevel(evening, TEAM({ startLevel: 16 }), { now: evening[3].data.trackStarted + HOUR }),
        teamLevel(pairDay, TEAM({ startLevel: 76 }), { now: pairDay[1].data.trackStarted + HOUR }),
        evening.map(s => runFacts(s, { sessions: evening }).day),
      ]);
    } finally { if (was === undefined) delete process.env.TZ; else process.env.TZ = was; }
  };
  const zones = ['America/New_York', 'Europe/London', 'UTC', 'Pacific/Auckland'].map(read);
  assert.ok(zones.every(z => z === zones[0]), 'the same sessions, the same standing, in every zone');
  const [night, pair, days] = JSON.parse(zones[0]);
  assert.deepEqual(days, [20260601, 20260601, 20260601, 20260601], 'one evening is one day where it was run');
  assert.deepEqual([night.level, night.tries[0].verdict, night.tries[0].why, night.counted.today],
    [16, 'notCounted', 'Not counted: 3 runs already counted today, the dog has done enough', 3]);
  assert.deepEqual([pair.level, pair.counted.today], [78, 2], 'the pair is one day’s pair, though midnight UTC falls between its halves');
  /* The phone's own stamp wins over the trail's longitude. */
  const stamped = meets(16, { day: 0, hour: 23, minute: 30, extra: { tzMin: 60 } });      // 23:30 UTC is 00:30 BST the next day
  assert.deepEqual([facts(stamped).tzMin, facts(stamped).day, facts(meets(16, { day: 0, hour: 23, minute: 30 })).day], [60, 20260602, 20260601]);
  assert.equal(dayKey(Date.UTC(2026, 0, 1, 2, 0), -300), 20251231);
  assert.equal(dayKey(Date.UTC(2026, 0, 1, 2, 0)), 20260101);
  /* "Today" is counted by the offset handed in, or by the newest run's own. */
  const one = [meets(16, { day: 0, hour: 23, minute: 30, found: false, extra: { tzMin: 60 } })];
  const at = one[0].data.trackStarted + 10 * MIN;
  assert.equal(teamLevel(one, TEAM({ startLevel: 16 }), { now: at }).counted.today, 1);
  assert.equal(teamLevel(one, TEAM({ startLevel: 16 }), { now: at, tzMin: 60 }).counted.today, 1);
  assert.equal(teamLevel(one, TEAM({ startLevel: 16 }), { now: at, tzMin: -300 }).counted.today, 0);
});

t('two thousand sessions are no trouble', () => {
  const many = [];
  for (let i = 0; i < 2000; i++) {
    const kind = i % 4;
    if (kind === 0) many.push(run({ day: i, lengthM: 300, ageMin: 30, turns: 2, targetId: 'narcotics' }));
    else if (kind === 1) many.push(run({ day: i, lengthM: 300, ageMin: 30, turns: 2, handlerId: 'h2' }));
    else many.push(run({ day: i, lengthM: 300 + (i % 7) * 40, ageMin: 30 + (i % 5) * 10, turns: i % 4, found: i % 3 !== 0,
      contamination: i % 10 === 2 ? crosses(2) : null, surf: i % 6 === 2 ? ['g', 'h'] : null }));
  }
  const team = TEAM({ startLevel: 16 });
  const now = T0 + 2001 * DAY;
  const t0 = process.hrtime.bigint();
  const first = teamLevel(many, team, { now });
  const cold = Number(process.hrtime.bigint() - t0) / 1e6;
  const t1 = process.hrtime.bigint();
  const second = teamLevel(many, team, { now });
  const warm = Number(process.hrtime.bigint() - t1) / 1e6;
  assert.deepEqual(first, second);
  assert.ok(first.level > 16, `the team climbed to L${first.level}`);
  assert.ok(cold < 4000, `first pass took ${Math.round(cold)} ms`);
  assert.ok(warm < 1000, `a second pass, with each run already read, took ${Math.round(warm)} ms`);
});

console.log(`\nlevels: ${pass} checks passed`);
