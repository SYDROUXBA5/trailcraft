/* Team levels: the engine.

   A team is one handler with one dog, and it climbs 100 levels of person
   trails: Hot 1-15, Warm 16-45, Cold 46-100. This file is the whole of the
   deciding: the ladder as data, what one run can be checked against
   (runFacts), whether a run passes a level and why not when it does not
   (judge), and where a team stands, worked out from its sessions alone
   (teamLevel). The design it follows is
   docs/superpowers/specs/2026-10-09-team-levels-design.md.

   Three things it holds to on purpose:
   - Nothing here is typed in. A level is derived from the record every time,
     so editing a debrief or adding a late line puts the level right without
     anyone remembering to.
   - It is pure. No screen, no network, and no clock of its own: "now" is
     handed in, so the same sessions always give the same answer and the
     tests can say what day it is.
   - When in doubt a run is "not counted" and says why in words a handler can
     act on. A miss is only ever a trail that was laid properly and not
     solved. Nothing is ever taken away. */

import { dist, bearing, pathLen, simplify, densify, progressAlong } from './geo.js';
import { targetById, routeCorners, runAgeMin, dogAge } from './store.js';
import { unwalkedPlan, noLineYet, ownRun } from './debrief.js';
import { solarPosition, forecastAt } from './field.js';
import { applyFixes, readingFits, stretchMetres } from './ground.js';

const fin = Number.isFinite;
const okPt = (p) => fin(p?.lat) && fin(p?.lon);
const DAY_MS = 86400000;

/* ── The numbers the rules turn on ────────────────────────────────────
   Kept in one place because several are first guesses the spec says are to
   be tuned on real tracks (the turn angle and leg above all). */
export const RULES = Object.freeze({
  turnDeg: 60,          // a change of heading sharper than this is a turn
  turnLegM: 50,         // with a leg at least this long on either side of it
  lengthShare: 0.9,     // a trail must be at least this much of the level's length
  hotSlackShare: 0.1,   // Hot: within the larger of this share
  hotSlackM: 15,        // and this many metres, because short trails sit inside GPS noise
  indicationM: 30,      // an Indication mark this near the trail's end
  splitM: 10,           // a decoy line starting this near the trail
  alongNearM: 15,       // "walks along it": this near the trail, as drawn on a phone
  surfaceMinM: 20,      // a surface counts once the trail spends this long on it
  footKmh: 8,           // laid slower than this was laid on foot
  coverShare: 0.7,      // the dog's track covers at least this much of the trail
  coverM: 30,           // counting trail the dog passed within this distance of
  newPlaceM: 300,       // no earlier start by the team within this
  heatC: 25,            // above this the board warns and bosses wait
  capHot: 5,            // counted runs a day in Hot
  cap: 3,               // and everywhere else
  rustyDays: 30,
  easeAfter: 2,         // misses in a row before "Ease off"
  placementTries: 2,
  placementDrop: 5,
  limitBaseMin: 20, limitPerM: 40, limitMaxMin: 60,
});

/* ── The two new debrief answers ──────────────────────────────────────
   In order of difficulty, so a level asks for "at least this" and a team
   that works harder than it must is never refused for it. The ids are what
   the debrief saves as `start` and `setting`. */
export const STARTS = Object.freeze([
  Object.freeze({ id: 'watched', label: 'Watched' }),
  Object.freeze({ id: 'watchedArticle', label: 'Watched + article' }),
  Object.freeze({ id: 'article', label: 'Article only' }),
  Object.freeze({ id: 'told', label: 'Told directions' }),
  Object.freeze({ id: 'lkp', label: 'Last point only' }),
]);
export const SETTINGS = Object.freeze([
  Object.freeze({ id: 'rural', label: 'Rural' }),
  Object.freeze({ id: 'semi', label: 'Semi-urban' }),
  Object.freeze({ id: 'town', label: 'Town' }),
  Object.freeze({ id: 'traffic', label: 'Town + traffic' }),
]);
/** The level from which the debrief shows the Setting row. */
export const SETTING_FROM = 66;

const BLINDS = ['open', 'handler', 'double'];
const rankIn = (list, id) => list.findIndex(x => (x.id ?? x) === id);
const labelIn = (list, id) => list.find(x => x.id === id)?.label ?? null;

/* ── The ladder (LADDER v1) ───────────────────────────────────────────
   Twenty waves of five levels. Each wave turns one thing up, and its first
   level eases the others back. Lengths in metres, ages in minutes; one value
   stands for all five levels of the wave. The names are here, beside the
   numbers, so they can be edited in one place. */
const HOT_BLURB = 'the dog watches the person leave · open';
const WARM_BLURB = 'the dog is taken away · article start';
const COLD_BLURB = 'trail 2 h or more';

const WAVES_V1 = [
  { key: 'runaway', stage: 'hot', rank: 'Puppy Nose', wave: 'Runaway',
    len: [20, 40, 60, 90, 120], age: 0, turns: 0, start: 'watched',
    also: [[], [], ['The person hides at the end'], ['The person hides at the end'], ['The person hides at the end']] },
  { key: 'delayed', stage: 'hot', rank: 'Line Puller', wave: 'Delayed release',
    len: [60, 90, 120, 150, 200], age: [1, 2, 3, 4, 5], turns: 0, start: 'watched',
    also: ['The dog watches, then is held'] },
  { key: 'article', stage: 'hot', rank: 'Scent Reader', wave: 'Article start',
    len: [120, 160, 200, 250, 300], age: [5, 5, 8, 10, 10], turns: 0, start: 'watchedArticle',
    also: ['Watched, with a scent article'] },
  { key: 'outOfSight', stage: 'warm', rank: 'Seeker', wave: 'Out of sight',
    len: [150, 200, 250, 300, 300], age: [10, 15, 20, 25, 30], turns: 0 },
  { key: 'turns', stage: 'warm', rank: 'Turn Finder', wave: 'Turns',
    len: [250, 300, 300, 350, 350], age: 30, turns: [1, 1, 2, 2, 3],
    also: ['Legs of 50 m or more'] },
  { key: 'indication', stage: 'warm', rank: 'True Indicator', wave: 'Indication',
    len: [300, 350, 350, 400, 450], age: 30, turns: 2 },
  { key: 'ageWarm', stage: 'warm', rank: 'Patient Nose', wave: 'Age',
    len: 400, age: [45, 60, 75, 90, 105], turns: 2 },
  { key: 'surfaces', stage: 'warm', rank: 'Ground Reader', wave: 'Surfaces',
    len: [400, 450, 500, 550, 600], age: [45, 45, 60, 60, 60], turns: [2, 2, 3, 3, 3], surfaces: 2,
    also: ['A second surface'] },
  { key: 'split', stage: 'warm', rank: 'Decoy Breaker', wave: 'Split + decoy',
    len: [400, 500, 600, 600, 600], age: [60, 60, 60, 90, 105], turns: [2, 2, 3, 3, 3], split: true,
    also: ['A decoy walks along, then peels off'] },
  { key: 'handlerBlind', stage: 'cold', rank: 'Blind Faith', wave: 'Handler blind',
    len: [400, 400, 450, 450, 500], age: 120, turns: 3 },
  { key: 'doubleBlind', stage: 'cold', rank: 'Double Blind', wave: 'Nobody knows',
    len: [400, 450, 500, 550, 600], age: 120, turns: 3 },
  { key: 'ageCold', stage: 'cold', rank: 'Cold Nose', wave: 'Age',
    len: 500, age: [150, 180, 240, 360, 480], turns: 3 },
  { key: 'crossTracks', stage: 'cold', rank: 'Through the Crowd', wave: 'Cross-tracks',
    len: [500, 500, 550, 600, 600], age: 180, turns: 3, crossTracks: [1, 1, 2, 2, 2], walkAlongM: [0, 0, 0, 0, 50],
    also: [['1 crossing laid after the trail'], ['1 crossing laid after the trail'], ['2 crossings laid after the trail'],
      ['2 crossings laid after the trail'], ['2 crossings laid after the trail', 'Someone also walks 50 m along it']] },
  { key: 'ground', stage: 'cold', rank: 'Tarmac Hound', wave: 'Ground',
    len: [500, 550, 600, 650, 700], age: 180, turns: [3, 3, 4, 4, 4], surfaces: [2, 2, 3, 3, 3],
    hardTurn: [false, false, true, true, true], setting: [null, null, null, null, 'semi'],
    also: [[], [], ['A turn on hard ground'], ['A turn on hard ground'], ['A turn on hard ground', 'Semi-urban']] },
  { key: 'direction', stage: 'cold', rank: 'Direction Finder', wave: 'Find the direction',
    len: [500, 550, 600, 700, 800], age: [180, 180, 210, 240, 240], turns: [3, 3, 3, 4, 4],
    start: ['told', 'told', 'told', 'told', 'lkp'], directions: [2, 2, 3, 3, null],
    setting: [null, null, null, null, 'semi'], crossTracks: [0, 0, 0, 0, 2],
    also: [['Told 2 possible directions'], ['Told 2 possible directions'], ['Told 3 possible directions'],
      ['Told 3 possible directions'], ['Semi-urban', 'Last known point only', '2 cross-tracks']] },
  { key: 'empty', stage: 'cold', rank: 'Honest Nose', wave: 'Empty trails',
    len: 600, age: [180, 180, 210, 240, 240], turns: [3, 3, 3, 4, 4],
    pair: ['any', 'any', 'emptySecond', 'emptySecond', 'emptySecond'],
    also: [['A pair on the same day: one empty trail called right, one real trail found'],
      ['A pair on the same day: one empty trail called right, one real trail found'],
      ['A pair on the same day, the empty trail second'], ['A pair on the same day, the empty trail second'],
      ['A pair on the same day, the empty trail second']] },
  { key: 'distance', stage: 'cold', rank: 'Long Hauler', wave: 'Distance',
    len: [800, 1000, 1200, 1400, 1600], age: 240, turns: [5, 5, 6, 6, 7] },
  { key: 'town', stage: 'cold', rank: 'Street Trailer', wave: 'Town + traffic',
    len: [800, 800, 900, 900, 1000], age: 240, turns: [4, 5, 5, 6, 6],
    setting: ['town', 'town', 'town', 'traffic', 'traffic'],
    also: [['Junctions count as turns', 'A road crossing'], ['Junctions count as turns', 'A road crossing'],
      ['Junctions count as turns', 'A road crossing'], ['Junctions count as turns', 'A road crossing', 'Moving traffic'],
      ['Junctions count as turns', 'A road crossing', 'Moving traffic']] },
  { key: 'veryOld', stage: 'cold', rank: 'Ghost Trailer', wave: 'Very old',
    len: [800, 800, 1000, 1000, 1000], age: [720, 1080, 1440, 2160, 2880], turns: 5,
    also: [[], [], [], [], ['Other dogs cross the trail']] },
  { key: 'operational', stage: 'cold', rank: 'Mission Ready', wave: 'Operational',
    len: [1000, 1200, 1000, 1200, 1600], age: 1440, turns: [6, 8, 6, 8, 10],
    newPlace: [true, false, false, false, true], stranger: [false, true, false, false, true],
    night: [false, false, true, false, false], pair: [null, null, null, 'any', null],
    also: [['A new place'], ['A stranger lays the trail'], ['At night'],
      ['Was the person ever here? A pair on the same day: one empty trail called right, one real trail found'],
      ['A new place', 'A stranger lays the trail', 'Distractors']] },
];

/* The four levels that close a stage: what the trail is called, and the
   title the team carries for passing it. */
const BOSSES_V1 = [
  { level: 15, name: 'First Trail', title: 'Trail Hound', also: ['The dog shows the find'] },
  { level: 45, name: 'The Fork', title: 'Warm Trailer', also: [] },
  { level: 75, name: 'The Town', title: 'Town Hound', also: [] },
  { level: 100, name: 'Mission Ready', title: 'Master Trailer', also: [] },
];

const STAGES_V1 = [
  { key: 'hot', label: 'Hot', from: 1, to: 15, blurb: HOT_BLURB },
  { key: 'warm', label: 'Warm', from: 16, to: 45, blurb: WARM_BLURB },
  { key: 'cold', label: 'Cold', from: 46, to: 100, blurb: COLD_BLURB },
];

const ROMAN = ['I', 'II', 'III', 'IV', 'V'];

/** The time a dog has to find the person: 20 min and a minute for every 40 m
    of trail, never more than an hour. Whole minutes, rounded up. */
export function timeLimitMin(lengthM) {
  if (!fin(lengthM)) return RULES.limitBaseMin;
  return Math.min(RULES.limitMaxMin, Math.ceil(RULES.limitBaseMin + lengthM / RULES.limitPerM));
}

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Object.keys(o)) deepFreeze(o[k]);
  }
  return o;
}

function buildLadder(v, waves, bosses, stages) {
  const levels = [];
  waves.forEach((w, wi) => {
    for (let i = 0; i < 5; i++) {
      const n = wi * 5 + i + 1;
      const pick = (x, dflt) => (x === undefined ? dflt : Array.isArray(x) ? x[i] : x);
      const boss = bosses.find(b => b.level === n) ?? null;
      const lengthM = pick(w.len);
      const alsoW = w.also ?? [];
      const also = Array.isArray(alsoW[0]) ? (alsoW[i] ?? []) : alsoW;
      levels.push({
        v, level: n, stage: w.stage, wave: wi, waveKey: w.key, waveName: w.wave,
        rank: w.rank, step: i + 1, roman: ROMAN[i], name: `${w.rank} ${ROMAN[i]}`,
        lengthM, ageMin: pick(w.age), turns: pick(w.turns, 0),
        /* The rules that stay on once they start. */
        start: pick(w.start, 'article'),
        watched: n <= 15,
        coachOff: n >= 16,
        indication: n >= 26 || n === 15,
        blind: n >= 51 ? 'double' : n >= 46 ? 'handler' : null,
        timeLimitMin: n >= 16 ? timeLimitMin(lengthM) : null,
        minDogMonths: n >= 91 ? 24 : n >= 61 ? 18 : n >= 46 ? 15 : 0,
        /* What the wave turns up. */
        surfaces: pick(w.surfaces, 0), hardTurn: pick(w.hardTurn, false), setting: pick(w.setting, null),
        crossTracks: pick(w.crossTracks, 0), walkAlongM: pick(w.walkAlongM, 0),
        split: !!w.split, decoy: !!w.split,
        directions: pick(w.directions, null), pair: pick(w.pair, null),
        night: pick(w.night, false), newPlace: pick(w.newPlace, false), stranger: pick(w.stranger, false),
        distractors: n === 100,
        boss: !!boss, bossName: boss?.name ?? null, title: boss?.title ?? null,
        also: [...also, ...(boss?.also ?? [])],
      });
    }
  });
  return deepFreeze({
    v, levels,
    waves: waves.map((w, wi) => ({ index: wi, key: w.key, stage: w.stage, rank: w.rank, wave: w.wave, from: wi * 5 + 1, to: wi * 5 + 5 })),
    stages: stages.map(s => ({ ...s })),
    bosses: bosses.map(b => ({ level: b.level, name: b.name, title: b.title })),
  });
}

/** The ladder, version 1: frozen, so nothing can lower a level by accident.
    A change to what a level asks is a new version beside this one, and a
    team's high-water mark carries it across (teamLevel). */
export const LADDER_V1 = buildLadder(1, WAVES_V1, BOSSES_V1, STAGES_V1);

const topOf = (ladder) => ladder.levels.length;
const clampLevel = (n, ladder) => Math.max(1, Math.min(topOf(ladder), Math.round(fin(n) ? n : 1)));

/** One level's line of the ladder, or null outside it. */
export const levelSpec = (n, ladder = LADDER_V1) => (Number.isInteger(n) ? ladder.levels[n - 1] ?? null : null);
/** hot | warm | cold for a level number. */
export const stageOf = (n, ladder = LADDER_V1) => levelSpec(n, ladder)?.stage ?? null;
/** The first level of the wave a level sits in. */
export const waveStart = (n, ladder = LADDER_V1) => { const l = levelSpec(n, ladder); return l ? l.wave * 5 + 1 : null; };
/** A level's name: the wave's rank and where in the wave, "Blind Faith III". */
export const levelName = (n, ladder = LADDER_V1) => levelSpec(n, ladder)?.name ?? null;

/** What the team is called once it has passed level `n`: "Rémi & Rex ·
    Blind Faith III". A name is earned, so `n` is the last level passed
    (teamLevel's `passed`), not the one being worked on; before the first
    pass (n 0) there is no rank and the two names stand alone. Any part that
    is missing is left out rather than shown as a blank. */
export function teamName(handlerName, dogName, n, ladder = LADDER_V1) {
  const who = [handlerName, dogName].map(x => (typeof x === 'string' ? x.trim() : '')).filter(Boolean).join(' & ');
  return [who, levelName(n, ladder)].filter(Boolean).join(' · ');
}

/** The title a team carries: the last boss it passed itself. `passed` is
    the highest level it has passed and `from` the level it was placed at,
    because a boss a preset stepped over was never run. */
export function bossTitle(passed, ladder = LADDER_V1, from = 1) {
  let out = null;
  for (const b of ladder.bosses) if (b.level >= from && b.level <= passed) out = b;
  return out ? { level: out.level, name: out.name, title: out.title } : null;
}

const ASK_KEYS = ['lengthM', 'ageMin', 'turns', 'surfaces', 'crossTracks', 'walkAlongM'];
/** What a level asks that the one before it did not, as checklist keys, so
    the card can show what is new in gold. */
export function whatsNew(n, ladder = LADDER_V1) {
  const l = levelSpec(n, ladder), p = levelSpec(n - 1, ladder);
  if (!l) return [];
  if (!p) return ['length'];
  const out = [];
  const keyOf = { lengthM: 'length', ageMin: 'age', walkAlongM: 'walkAlong' };
  for (const k of ASK_KEYS) if (l[k] > p[k]) out.push(keyOf[k] ?? k);
  if (rankIn(STARTS, l.start) > rankIn(STARTS, p.start)) out.push('start');
  if (BLINDS.indexOf(l.blind ?? 'open') > BLINDS.indexOf(p.blind ?? 'open')) out.push('blind');
  if (rankIn(SETTINGS, l.setting) > rankIn(SETTINGS, p.setting)) out.push('setting');
  for (const k of ['hardTurn', 'split', 'night', 'newPlace', 'stranger', 'indication', 'boss']) if (l[k] && !p[k]) out.push(k);
  if (l.coachOff && !p.coachOff) out.push('coach', 'found');
  if (l.pair && l.pair !== p.pair) out.push('pair');
  return out;
}

/* ── Teams ────────────────────────────────────────────────────────────
   Teams are kept on the dog (dog.teams), one per handler who runs it. */

/** Where a new team starts, by what the dog can already do. */
export const PRESETS = Object.freeze([
  Object.freeze({ id: 'new', label: 'New dog', startLevel: 1 }),
  Object.freeze({ id: 'runaways', label: 'Loves runaways', startLevel: 6 }),
  Object.freeze({ id: 'article', label: 'Article starter', startLevel: 11 }),
  Object.freeze({ id: 'outOfSight', label: 'Trails out of sight', startLevel: 16 }),
  Object.freeze({ id: 'mtg1', label: 'Passed MTG 1', startLevel: 26 }),
  Object.freeze({ id: 'mtg2', label: 'Passed MTG 2', startLevel: 41 }),
  Object.freeze({ id: 'experienced', label: 'Experienced', startLevel: 46 }),
]);
export const presetById = (id) => PRESETS.find(p => p.id === id) ?? PRESETS[0];

/** The one id a handler and dog pair has. A pair is a team once and only
    once, so the id is made from the two rather than drawn at random: two
    phones that each make the same team offline then agree. */
export const teamKey = (handlerId, dogId) => `${handlerId}~${dogId}`;

/** A team as it is kept on the dog. `now` is when it was placed. */
export function newTeam({ handlerId, dogId, preset = 'new', now, look = null }) {
  const p = presetById(preset);
  return {
    id: teamKey(handlerId, dogId), handlerId, preset: p.id, startLevel: p.startLevel, placedAt: now,
    look: { coat: look?.coat ?? null, jacket: look?.jacket ?? null, harness: look?.harness ?? null },
    best: { v: LADDER_V1.v, level: 0, at: null },
  };
}

/** A dog's teams, each carrying the dog's id so it can be handed straight to
    teamLevel. A row with no handler is not a team. */
export function teamsOf(dog) {
  if (!dog || !Array.isArray(dog.teams)) return [];
  return dog.teams.filter(t => t && t.handlerId != null).map(t => ({ ...t, dogId: dog.id }));
}
/** The team one handler has with a dog, or null. */
export const teamOf = (dog, handlerId) => teamsOf(dog).find(t => t.handlerId === handlerId) ?? null;

/** The dogs a handler works: their own, and any they are in a team with. A
    trainer running a client's dog during board-and-train sees it in their
    own list without the dog changing hands. */
export function dogsInTeams(dogs, handlerId) {
  return (dogs || []).filter(d => d && (d.handlerId === handlerId
    || (Array.isArray(d.teams) && d.teams.some(t => t?.handlerId === handlerId))));
}

/* ── What one run can be checked against ────────────────────────────── */

const fmtM = (m) => `${Math.floor(m)} m`;
/* An age in the words the ladder uses: minutes under two hours, hours after.
   Rounded down, so a trail a minute short never reads as the full age. */
const fmtAge = (min, asHours = min >= 120) => (asHours ? `${Math.floor(min / 6) / 10} h` : `${Math.floor(min)} min`);
const fmtClock = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The calendar day a moment falls on, as one number, at a place whose clock
    is `offMin` minutes ahead of UTC. The day is worked out from the offset
    handed in and never from the zone of the phone doing the reading: the
    daily cap and "the same day" for a pair would otherwise give one answer
    in North Carolina and another in Somerset for the very same sessions,
    and the higher of the two would be saved as the team's best. */
export function dayKey(t, offMin = 0) {
  const d = new Date(t + (fin(offMin) ? offMin : 0) * 60000);
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}

/* The offset a run's day is counted by: the one the phone stamped when the
   run began (data.tzMin, minutes ahead of UTC), and for a run from before
   that stamp the sun's own time where the trail started, an hour for every
   15 degrees of longitude. That is within an hour or so of the clock on the
   wall, and it is the same on every phone that reads the run. */
function tzMinOf(d, startPt) {
  if (fin(d.tzMin) && Math.abs(d.tzMin) <= 14 * 60) return d.tzMin;
  return startPt ? Math.round(startPt.lon / 15) * 60 : 0;
}

/** Whether a session is a person trail that this phone's handler ran: not a
    hide search, not a trail only laid, and not someone else's run kept from
    a link. */
export function isLevelRun(s) {
  const d = s?.data;
  if (!d || s.deleted) return false;
  if (targetById(s.targetId).kind !== 'person' || d.hides?.length) return false;
  if (!fin(d.trackStarted) || !Array.isArray(d.track) || d.track.filter(okPt).length < 2) return false;
  return ownRun(s);
}

/* Turns: places where the heading changes by more than turnDeg, measured
   over a full leg on either side rather than between neighbouring fixes.
   Measuring across the leg is what makes it hold up on a real track: GPS
   wobble cancels over 50 m, a bend walked as three small corners still reads
   as the one turn it was, and a long gentle curve reads as none.

   The leg is 50 m over the ground, as the crow flies from the corner, and
   not 50 m of line. A layer who stops for a few minutes leaves a knot of
   wandering fixes: tens of metres of line that go nowhere. Measured along
   the line, both legs of a corner inside the knot end inside the knot too,
   and their headings are noise, so a dead-straight trail read as one to
   three turns. Measured over the ground, each leg has to leave the knot to
   get its 50 m, and lands on the trail either side of it.

   A corner the line never gets 50 m away from, on one side or the other,
   has no leg to measure (which is every corner near either end, and the
   whole of a knot left by waiting at the end). Of two candidates closer
   than a leg only the sharper is kept, so a turn is never counted twice. */
function turnsOf(corners) {
  const n = corners.length;
  if (n < 3) return [];
  const leg = RULES.turnLegM;
  const along = [0];
  for (let i = 1; i < n; i++) along.push(along[i - 1] + dist(corners[i - 1], corners[i]));
  /* Where the line first stands a leg away from corner i, walking it
     backwards (step -1) or onwards (step 1); null when it never does. */
  const reach = (i, step) => {
    let prev = 0, from = corners[i];
    for (let j = i + step; j >= 0 && j < n; j += step) {
      const m = dist(corners[i], corners[j]);
      if (m >= leg) {
        const k = m > prev ? (leg - prev) / (m - prev) : 1;
        return { lat: from.lat + (corners[j].lat - from.lat) * k, lon: from.lon + (corners[j].lon - from.lon) * k };
      }
      prev = m; from = corners[j];
    }
    return null;
  };
  const cands = [];
  for (let i = 1; i < n - 1; i++) {
    const a = reach(i, -1);
    if (!a) continue;
    const b = reach(i, 1);
    if (!b) continue;
    const deg = Math.abs(((bearing(corners[i], b) - bearing(a, corners[i]) + 540) % 360) - 180);
    if (deg > RULES.turnDeg) cands.push({ i, alongM: along[i], deg });
  }
  cands.sort((x, y) => y.deg - x.deg || x.alongM - y.alongM);
  const kept = [];
  for (const c of cands) if (kept.every(k => dist(corners[k.i], corners[c.i]) >= leg)) kept.push(c);
  return kept.sort((x, y) => x.alongM - y.alongM);
}

/* How far the dog got on a run with no laid line: the length of its route
   out to the furthest point it reached from the start, thinned so GPS
   wander adds nothing. The whole track will not do. It runs from Start to
   the tap on Found, so the praise and the play at the person, and every
   wandering fix while the phone sat there, were being counted as trail: a
   20 m runaway with a minute and a half of fuss read as 40 to 120 m and
   passed levels it never ran. */
function reachLen(track) {
  const thin = simplify(track, 10);
  let far = 0, farI = 0;
  for (let i = 1; i < thin.length; i++) {
    const m = dist(thin[0], thin[i]);
    if (m > far) { far = m; farI = i; }
  }
  return pathLen(thin.slice(0, farI + 1));
}

/* Who laid a run's trail, as one key, or null when the record does not say.
   A layer picked on this phone is its id. A trail that came from another
   phone (a Trail Card, or a line added to a Blind trail) carries no layer
   id at all, only the sender's name, and that is how a stranger's trail
   normally arrives: so the name stands for the layer. "another phone" is
   the app's own words for a card with no name on it, and names nobody. */
function layerKeyOf(s) {
  if (s.layerId != null) return s.layerId;
  const from = s.data?.imported?.from || s.data?.lineAdded?.from;
  return typeof from === 'string' && from.trim() && from !== 'another phone' ? `card:${from.trim().toLowerCase()}` : null;
}

/* The air at the run. The app only fetches a forecast for the run itself
   (runWeather) when the one fetched at the lay does not reach that far,
   which is some six hours: so for every Hot and Warm run, and most of Cold,
   the run's temperature is in the laid weather's series and nowhere else.
   forecastAt is how the rest of the app reads it. The laid weather is only
   believed when its series truly covers the run: its single figure is the
   air when the trail was laid, which for an old trail is another day's. */
function tempAtRun(s) {
  const d = s.data || {};
  const w = fin(d.trackStarted) ? forecastAt(s, d.trackStarted) : null;
  if (w && w.exact && fin(w.wx?.temp)) return w.wx.temp;
  return fin(d.runWeather?.temp) ? d.runWeather.temp : null;
}

/* How much of the trail the dog's track passed near. Both are laid flat on
   a plane at the trail's own latitude and the track is dropped into a grid,
   so each stretch of trail looks only at the track beside it: a long run is
   not compared fix by fix against a long trail. */
function coverageOf(trail, track) {
  if (trail.length < 2 || track.length < 2) return null;
  const o = trail[0], kx = Math.cos(o.lat * Math.PI / 180) * 111320, ky = 111320;
  const X = (p) => (p.lon - o.lon) * kx, Y = (p) => (p.lat - o.lat) * ky;
  const cell = RULES.coverM, grid = new Map();
  const put = (x, y) => {
    const k = `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
    const g = grid.get(k);
    if (g) g.push(x, y); else grid.set(k, [x, y]);
  };
  let px = X(track[0]), py = Y(track[0]);
  put(px, py);
  for (let i = 1; i < track.length; i++) {
    const x = X(track[i]), y = Y(track[i]);
    /* A gap between fixes is walked in half-cell steps so the dog is not
       lost between them, but not without end: a fix that jumped a kilometre
       is a GPS fault, not ground covered. */
    const steps = Math.min(40, Math.max(1, Math.ceil(Math.hypot(x - px, y - py) / (cell / 2))));
    for (let k = 1; k <= steps; k++) put(px + (x - px) * k / steps, py + (y - py) * k / steps);
    px = x; py = y;
  }
  const near = (x, y) => {
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const g = grid.get(`${cx + dx},${cy + dy}`);
      if (!g) continue;
      for (let j = 0; j < g.length; j += 2) if (Math.hypot(g[j] - x, g[j + 1] - y) <= cell) return true;
    }
    return false;
  };
  let all = 0, hit = 0;
  const STEP = 10;
  let ax = X(trail[0]), ay = Y(trail[0]);
  all++; if (near(ax, ay)) hit++;
  let carry = 0;
  for (let i = 1; i < trail.length; i++) {
    const bx = X(trail[i]), by = Y(trail[i]);
    const d = Math.hypot(bx - ax, by - ay);
    let m = STEP - carry;
    while (m <= d) {
      const x = ax + (bx - ax) * m / d, y = ay + (by - ay) * m / d;
      all++; if (near(x, y)) hit++;
      m += STEP;
    }
    carry = (carry + d) % STEP;
    ax = bx; ay = by;
  }
  return all ? hit / all : null;
}

/* Everything a run's own record says, with nothing that depends on the
   team's other runs. This is the costly half (it reads the whole trail and
   track), so it is kept per session and made again only when something it
   reads has changed. The app edits sessions in place as well as replacing
   them, so the session being the same object is not proof it is unchanged:
   the signature is. */
const FACTS = new WeakMap();
function signature(s) {
  const d = s.data || {}, b = d.debrief || {};
  const w = Array.isArray(d.trackWaypoints) ? d.trackWaypoints : [];
  let marks = 0;
  for (const x of w) if (x?.kind === 'Indication') marks += (x.t || 0) % 1e7 + (x.lat || 0) * 1e5 + (x.lon || 0) * 1e5;
  const tk = Array.isArray(d.track) ? d.track : [], tr = Array.isArray(d.trail) ? d.trail : [];
  const lastT = (a) => (a.length ? a[a.length - 1]?.t : null);
  const fixes = Array.isArray(d.surfFix) ? d.surfFix.map(f => `${f?.as}${f?.fromM}-${f?.toM}`).join(',') : '';
  const lines = Array.isArray(d.contamination) ? d.contamination.map(c => `${c?.order}${c?.points?.length}`).join(',') : '';
  return [s.id, s.handlerId, s.dogId, s.layerId, s.targetId, s.startedAt, s.deleted ? 1 : 0, d.trackStarted,
    tr.length, lastT(tr), tk.length, lastT(tk), d.revealedAt, d.resultSeenAt, d.found, d.leftAgoMin, d.coach?.assisted,
    d.runWeather?.temp, d.runWeather?.series?.length, d.runWeather?.standIn ? 1 : 0, d.weather?.temp, d.weather?.series?.length,
    d.tzMin, d.imported?.from, d.lineAdded?.from,
    lines, w.length, marks, d.surfSig, fixes, d.result?.ageMin,
    d.walked, d.plan ? 1 : 0, d.drawn ? 1 : 0, d.lineLater, d.hides?.length, d.imported?.at,
    b.outcome, b.target, b.blind, b.help, b.start, b.setting, d.levelTry?.v, d.levelTry?.level].join('|');
}

function baseFacts(s) {
  const sig = signature(s);
  const held = FACTS.get(s);
  if (held && held.sig === sig) return held.facts;
  const facts = Object.freeze(readFacts(s));
  FACTS.set(s, { sig, facts });
  return facts;
}

function readFacts(s) {
  const d = s.data || {}, b = d.debrief || {};
  const rawTrail = Array.isArray(d.trail) ? d.trail : [];
  const trail = rawTrail.filter(okPt);
  const track = Array.isArray(d.track) ? d.track.filter(okPt) : [];
  const hasLine = trail.length > 1;
  const noLine = noLineYet(d) || (!hasLine && !d.plan);
  const unwalked = unwalkedPlan(d);
  const ran = track.length > 1 && fin(d.trackStarted);
  const at = ran ? d.trackStarted : fin(s.startedAt) ? s.startedAt : null;
  let endAt = at;
  for (let i = track.length - 1; i >= 0; i--) if (fin(track[i].t)) { endAt = track[i].t; break; }
  const startPt = hasLine ? trail[0] : track[0] ?? null;
  const endPt = hasLine ? trail[trail.length - 1] : track.length ? track[track.length - 1] : null;

  /* Length. A Hot runaway nobody recorded has no line, so how far the dog
     got stands in for it; anywhere else there is nothing to measure. */
  const lengthM = hasLine ? pathLen(trail) : ran ? reachLen(track) : null;
  const ageMin = hasLine ? runAgeMin(s) : fin(d.leftAgoMin) && d.leftAgoMin >= 0 ? d.leftAgoMin : null;

  /* Turns, and the ground under each. A corner is one of the trail's own
     fixes, so it is found again by its position to read its surface. */
  const corners = hasLine ? routeCorners(s) : [];
  const turnList = turnsOf(corners);
  let surfaces = null, surfaceIds = [], hardTurns = null;
  const fixes = Array.isArray(d.surfFix) ? d.surfFix : [];
  const fits = hasLine && readingFits(d);
  if (hasLine && trail.length === rawTrail.length && (fits || fixes.length)) {
    const letters = applyFixes(rawTrail, fits ? d.surf : null, fixes).letters;
    const metres = stretchMetres(rawTrail, letters, 0, rawTrail.length - 1);
    surfaceIds = Object.keys(metres).filter(k => k !== 'u' && metres[k] >= RULES.surfaceMinM).sort();
    surfaces = surfaceIds.length;
    const index = new Map(rawTrail.map((p, i) => [`${p.lat},${p.lon}`, i]));
    hardTurns = 0;
    for (const t of turnList) {
      const i = index.get(`${corners[t.i].lat},${corners[t.i].lon}`);
      t.hard = i !== undefined && [i - 1, i, i + 1].some(j => letters[j] === 'h');
      if (t.hard) hardTurns++;
    }
  }

  /* Other people's lines. After the trail is a cross-track; before it, and
     starting on it, is the decoy who walked along and peeled off. */
  const lines = Array.isArray(d.contamination) ? d.contamination.filter(c => Array.isArray(c?.points) && c.points.filter(okPt).length > 1) : [];
  const thin = hasLine && lines.length ? simplify(trail, 2) : null;
  const off = (p) => progressAlong(thin, p)?.off ?? Infinity;
  let crossTracks = 0, alongM = 0, split = false;
  for (const c of lines) {
    const pts = c.points.filter(okPt);
    if (c.order === 'after') {
      crossTracks++;
      if (!thin) continue;
      const fine = densify(pts, 5);
      let run = 0, was = off(fine[0]) <= RULES.alongNearM;
      for (let i = 1; i < fine.length; i++) {
        const is = off(fine[i]) <= RULES.alongNearM;
        if (is && was) run += dist(fine[i - 1], fine[i]);
        was = is;
      }
      alongM = Math.max(alongM, run);
    } else if (thin && off(pts[0]) <= RULES.splitM) split = true;
  }

  /* How it ended. The debrief is the handler's word and has the last say;
     a run closed on Found with no debrief yet is a find. */
  const outcome = typeof b.outcome === 'string' ? b.outcome : null;
  const found = outcome ? outcome === 'found' : d.found === true;
  const target = typeof b.target === 'string' ? b.target : null;
  const findMs = ran && fin(endAt) ? Math.max(0, endAt - d.trackStarted) : null;

  let indicationM = null;
  if (endPt) for (const w of Array.isArray(d.trackWaypoints) ? d.trackWaypoints : []) {
    if (w?.kind !== 'Indication' || !okPt(w)) continue;
    const m = dist(w, endPt);
    if (indicationM === null || m < indicationM) indicationM = m;
  }

  /* Peeking: the trail on screen, or the answer seen, before the run was
     over. A trail shown on an earlier run of the same line counts: having
     seen it once, the handler knows it.

     Show trail is a peek whenever it is stamped at all, with no comparing
     against the end of the run. The app only ever stamps it during a run,
     and the run's "end" here is the last fix it kept, which is when the
     handler arrived at the last spot and not when Found was tapped:
     standing still adds no fix. Compared against that, a look taken while
     the dog hesitated near the person was let through. The answer seen is
     stamped after Found on an honest run, so that one is still compared. */
  const shownAt = fin(d.revealedAt) && d.revealedAt > 0 ? d.revealedAt : null;
  const seenAt = fin(d.resultSeenAt) && d.resultSeenAt > 0 ? d.resultSeenAt : null;
  const shown = shownAt !== null;
  const seen = seenAt !== null && fin(endAt) && seenAt < endAt;
  const peekKind = shown ? 'shown' : seen ? 'result' : null;
  const peekAt = shown ? shownAt : seen ? seenAt : null;

  /* Laid on foot, from the trail's own clock. A line with no times cannot
     say, and its age is unknown anyway, which is what stops it counting. */
  let layKmh = null;
  if (hasLine) {
    const timed = trail.filter(p => fin(p.t));
    const span = timed.length > 1 ? timed[timed.length - 1].t - timed[0].t : 0;
    if (span > 0) layKmh = pathLen(trail) / (span / 1000) * 3.6;
  }
  let trailEnd = null;
  for (let i = trail.length - 1; i >= 0 && trailEnd === null; i--) if (fin(trail[i].t)) trailEnd = trail[i].t;
  let backwards = false;
  for (let i = 1; i < track.length && !backwards; i++) if (fin(track[i].t) && fin(track[i - 1].t) && track[i].t < track[i - 1].t - 1000) backwards = true;
  const timesOk = !backwards
    && (!fin(s.startedAt) || !fin(d.trackStarted) || s.startedAt <= d.trackStarted)
    && (!ran || !fin(endAt) || endAt >= d.trackStarted)
    && (trailEnd === null || !fin(endAt) || trailEnd <= endAt);

  const sun = startPt && fin(at) ? solarPosition(new Date(at), startPt.lat, startPt.lon).elevation : null;
  const lt = d.levelTry;
  const tzMin = tzMinOf(d, startPt);

  return {
    id: s.id, at, endAt, tzMin, day: fin(at) ? dayKey(at, tzMin) : null,
    handlerId: s.handlerId ?? null, dogId: s.dogId ?? null, layerId: s.layerId ?? null, layerKey: layerKeyOf(s),
    person: targetById(s.targetId).kind === 'person' && !d.hides?.length, ran,
    noLine, unwalked,
    lengthM, lengthFrom: hasLine ? 'trail' : ran ? 'track' : null, ageMin: fin(ageMin) ? ageMin : null,
    turns: hasLine ? turnList.length : null,
    turnList: Object.freeze(turnList.map(t => Object.freeze({ alongM: Math.round(t.alongM), deg: Math.round(t.deg), hard: t.hard ?? null }))),
    hardTurns, surfaces, surfaceIds: Object.freeze(surfaceIds),
    crossTracks, alongM: Math.round(alongM), split,
    outcome, found, findMs, findMin: findMs === null ? null : findMs / 60000,
    indication: indicationM !== null && indicationM <= RULES.indicationM, indicationM,
    blind: BLINDS.includes(b.blind) ? b.blind : null,
    peeked: peekKind !== null, peekKind, peekMs: peekAt !== null && fin(d.trackStarted) ? peekAt - d.trackStarted : null,
    coach: d.coach?.assisted === true, help: typeof b.help === 'string' ? b.help : null,
    start: rankIn(STARTS, b.start) >= 0 ? b.start : null,
    setting: rankIn(SETTINGS, b.setting) >= 0 ? b.setting : null,
    target, empty: target === 'control', emptyCalled: target === 'control' && outcome === 'blank', decoy: target === 'decoy',
    aborted: outcome === 'aborted',
    night: sun === null ? null : sun <= 0, sunElevation: sun,
    tempC: tempAtRun(s),
    layKmh, onFoot: layKmh === null ? null : layKmh < RULES.footKmh,
    coverage: hasLine && ran ? coverageOf(trail, track) : null,
    timesOk,
    startPt: startPt ? Object.freeze({ lat: startPt.lat, lon: startPt.lon }) : null,
    levelTry: lt && fin(lt.v) && Number.isInteger(lt.level) ? Object.freeze({ v: lt.v, level: lt.level }) : null,
    /* Filled in from the team's other runs and the dog (runFacts). */
    newPlace: null, stranger: null, dogMonths: null,
  };
}

/* Where a run started, without reading the rest of it. */
function startOf(s) {
  const tr = s?.data?.trail, tk = s?.data?.track;
  if (Array.isArray(tr) && tr.length > 1) { const p = tr.find(okPt); if (p) return p; }
  return Array.isArray(tk) ? tk.find(okPt) ?? null : null;
}
const runAtOf = (s) => (fin(s?.data?.trackStarted) ? s.data.trackStarted : fin(s?.startedAt) ? s.startedAt : null);
const monthsAt = (dog, at) => (dog && fin(dog.dob) && fin(at) ? dogAge(dog.dob, at)?.totalMonths ?? null : null);

/** Everything a level can be checked against, read from one session.
    `ctx.sessions` is the record it sits in (any sessions: only this team's
    earlier runs are looked at) and decides "a new place" and "a stranger";
    without it those two are unknown (null), never assumed. `ctx.dog` gives
    the dog's age on the day, when it has a birth date. */
export function runFacts(session, ctx = {}) {
  if (!session?.data) return null;
  const base = baseFacts(session);
  let newPlace = null, stranger = null;
  if (Array.isArray(ctx.sessions) && fin(base.at)) {
    const earlier = ctx.sessions.filter(e => e && e.id !== session.id && e.handlerId === session.handlerId
      && e.dogId === session.dogId && isLevelRun(e) && runAtOf(e) < base.at);
    newPlace = base.startPt ? !earlier.some(e => { const p = startOf(e); return p && dist(p, base.startPt) <= RULES.newPlaceM; }) : null;
    stranger = base.layerKey !== null && !earlier.some(e => layerKeyOf(e) === base.layerKey);
  }
  return Object.freeze({ ...base, newPlace, stranger, dogMonths: monthsAt(ctx.dog, base.at) });
}

/* ── Judging one run against one level ──────────────────────────────── */

const HELP_WORDS = { verbal: 'a word at a decision', led: 'the handler chose the way' };
const START_TEXT = { watched: 'watched start', watchedArticle: 'watched + article', article: 'article start', told: 'told the directions', lkp: 'last known point only' };
const SETTING_TEXT = { rural: 'rural', semi: 'semi-urban', town: 'town', traffic: 'town + traffic' };
const SHOW_ORDER = ['length', 'age', 'turns', 'start', 'blind', 'surfaces', 'hardTurn', 'setting', 'crossTracks', 'walkAlong',
  'split', 'night', 'newPlace', 'stranger', 'pair', 'found', 'indication'];

/** The time limit a run is held to at a level: none in Hot, and otherwise
    by the level's length, or the trail's own when it was laid longer, so a
    team that lays more than it must is not given less time per metre. */
export function timeLimitFor(level, lengthM = null) {
  if (!level || level.timeLimitMin === null) return null;
  return fin(lengthM) && lengthM > level.lengthM ? timeLimitMin(lengthM) : level.timeLimitMin;
}

/* Every check a level makes of a run, in the order its reasons are given.
   kind 'gate' failing means the run is not counted; kind 'solve' failing
   means it was a fair try and a miss. `ask` marks what the level asks for,
   which is always on the checklist; the rest only appear when they fail.
   With no run (f null) it is the level's blank checklist. */
function checksFor(L, f) {
  const out = [];
  const none = !f;
  const add = (key, kind, ask, label, text, need, got, ok, why) => {
    if (none && !ask) return;
    out.push({ key, kind, ask, label, text, need, got: none ? null : got, ok: !none && !!ok, why });
  };
  const hot = L.stage === 'hot';
  const F = f || {};

  add('person', 'gate', false, 'Person trail', 'a person trail', 'a person trail that was run', null,
    F.person && F.ran, 'not a person trail that was run');
  add('aborted', 'gate', false, 'Finished', 'run to the end', 'not stopped', F.aborted ? 'stopped' : 'finished',
    !F.aborted, 'stopped for the dog, which is never a miss');
  add('target', 'gate', false, 'A real trail', 'the person’s own trail', 'a real trail', F.target,
    !F.decoy && !F.empty,
    F.decoy ? 'a decoy trail, not the person’s own' : 'an empty trail only counts as half of a pair, from L76');
  add('line', 'gate', false, 'Laid trail', 'a laid trail', 'a walked line', F.unwalked ? 'drawn' : F.noLine ? 'none' : 'walked',
    !F.unwalked && !(F.noLine && !hot),
    F.unwalked ? 'the trail was drawn, not walked' : 'no laid trail to check it against');

  /* The coach reads out where the trail is and stamps the same moment Show
     trail does. It is allowed in Hot, so there a trail "shown" by a run with
     the coach on is the coach and not a peek. */
  const coachShown = hot && F.coach && F.peekKind === 'shown';
  add('peek', 'gate', false, 'No peeking', 'no peeking', 'the trail not shown', F.peeked ? 'seen' : 'not seen',
    !F.peeked || coachShown,
    F.peekKind === 'result' ? 'the answer was seen before the end'
      : fin(F.peekMs) && F.peekMs >= 0 ? `trail shown at ${fmtClock(F.peekMs)}` : 'the trail had been seen before the run');
  if (L.coachOff) {
    add('coach', 'gate', false, 'Coach off', 'coach off', 'off', F.coach ? 'on' : 'off', !F.coach, 'the coach was on');
    add('help', 'gate', false, 'Help', 'no help beyond the line', 'none or line only', F.help,
      F.help === 'none' || F.help === 'line',
      F.help ? `help was given (${HELP_WORDS[F.help] ?? F.help})` : 'help given is not answered in the debrief');
  }
  if (L.blind) {
    add('blind', 'gate', true, 'Blind', L.blind === 'double' ? 'nobody knows the route' : 'handler blind',
      L.blind === 'double' ? 'nobody there knew' : 'the handler did not know', F.blind,
      BLINDS.indexOf(F.blind) >= BLINDS.indexOf(L.blind),
      !F.blind ? 'who knew the route is not answered in the debrief'
        : F.blind === 'open' ? 'the handler knew the route' : 'someone there knew the route');
  }

  const least = hot ? L.lengthM - Math.max(RULES.hotSlackShare * L.lengthM, RULES.hotSlackM) : RULES.lengthShare * L.lengthM;
  /* To the nearest metre, but a trail that falls short is never rounded up
     to the mark it missed. */
  const longEnough = fin(F.lengthM) && F.lengthM >= least;
  const shownM = fin(F.lengthM) ? (longEnough ? Math.round(F.lengthM) : Math.min(Math.round(F.lengthM), Math.ceil(least) - 1)) : null;
  add('length', 'gate', true, 'Length', `${L.lengthM} m`, `${L.lengthM} m`, shownM === null ? null : `${shownM} m`, longEnough,
    shownM === null ? 'no trail to measure' : `${shownM} of ${L.lengthM} m, too short`);
  if (L.ageMin > 0) {
    const hrs = L.ageMin >= 120;
    add('age', 'gate', true, 'Trail age', `${fmtAge(L.ageMin)} old`, fmtAge(L.ageMin), fin(F.ageMin) ? fmtAge(F.ageMin, hrs) : null,
      fin(F.ageMin) && F.ageMin >= L.ageMin,
      fin(F.ageMin) ? `${fmtAge(F.ageMin, hrs).replace(/ (min|h)$/, '')} of ${fmtAge(L.ageMin)}, too fresh` : 'trail age unknown');
  }
  if (L.turns > 0) {
    add('turns', 'gate', true, 'Turns', plural(L.turns, 'turn'), String(L.turns), fin(F.turns) ? String(F.turns) : null,
      fin(F.turns) && F.turns >= L.turns, `${F.turns ?? 0} of ${plural(L.turns, 'turn')}`);
  }
  add('start', 'gate', true, 'Start', L.directions ? `told ${L.directions} directions` : START_TEXT[L.start],
    labelIn(STARTS, L.start), labelIn(STARTS, F.start),
    rankIn(STARTS, F.start) >= rankIn(STARTS, L.start),
    F.start ? `start was ${labelIn(STARTS, F.start)}, this level needs ${labelIn(STARTS, L.start)}` : 'start type is not answered in the debrief');
  if (L.surfaces > 1) {
    add('surfaces', 'gate', true, 'Surfaces', `${L.surfaces} surfaces`, String(L.surfaces), fin(F.surfaces) ? String(F.surfaces) : null,
      fin(F.surfaces) && F.surfaces >= L.surfaces,
      fin(F.surfaces) ? `${F.surfaces} of ${L.surfaces} surfaces` : 'the ground was not read, so its surfaces are unknown');
  }
  if (L.hardTurn) {
    add('hardTurn', 'gate', true, 'Hard-ground turn', 'a turn on hard ground', 'a turn on hard ground',
      fin(F.hardTurns) ? String(F.hardTurns) : null, F.hardTurns > 0,
      fin(F.hardTurns) ? 'no turn on hard ground' : 'the ground was not read, so its surfaces are unknown');
  }
  if (L.setting) {
    add('setting', 'gate', true, 'Setting', SETTING_TEXT[L.setting], labelIn(SETTINGS, L.setting), labelIn(SETTINGS, F.setting),
      rankIn(SETTINGS, F.setting) >= rankIn(SETTINGS, L.setting),
      F.setting ? `setting was ${labelIn(SETTINGS, F.setting)}, this level needs ${labelIn(SETTINGS, L.setting)}` : 'setting is not answered in the debrief');
  }
  if (L.crossTracks > 0) {
    add('crossTracks', 'gate', true, 'Cross-tracks', plural(L.crossTracks, 'cross-track'), String(L.crossTracks), String(F.crossTracks ?? 0),
      F.crossTracks >= L.crossTracks, `${F.crossTracks ?? 0} of ${plural(L.crossTracks, 'cross-track')} laid after the trail`);
  }
  if (L.walkAlongM > 0) {
    add('walkAlong', 'gate', true, 'Walked along', `${L.walkAlongM} m walked along it`, `${L.walkAlongM} m`, `${F.alongM ?? 0} m`,
      F.alongM >= L.walkAlongM, `nobody walked ${L.walkAlongM} m along the trail after it was laid`);
  }
  if (L.split) {
    add('split', 'gate', true, 'Decoy', 'a decoy that peels off', 'a decoy line starting on the trail', F.split ? 'yes' : 'no',
      F.split, 'no decoy line starting on the trail');
  }
  if (L.night) {
    add('night', 'gate', true, 'Night', 'at night', 'after dark', F.night === null || F.night === undefined ? null : F.night ? 'night' : 'day',
      F.night === true, F.night === false ? 'run in daylight' : 'no position to tell night from day');
  }
  if (L.newPlace) {
    add('newPlace', 'gate', true, 'New place', 'a new place', 'no earlier start within 300 m', F.newPlace === true ? 'new' : F.newPlace === false ? 'known' : null,
      F.newPlace === true, F.newPlace === false ? 'this team has started within 300 m of here before' : 'the team’s earlier runs are not known');
  }
  if (L.stranger) {
    add('stranger', 'gate', true, 'Stranger', 'a stranger lays it', 'a layer new to the team', F.stranger === true ? 'new' : F.stranger === false ? 'known' : null,
      F.stranger === true, (F.layerKey ?? null) === null ? 'no layer is named on the trail, so the app cannot tell that a stranger laid it'
        : 'this layer has laid for the team before');
  }

  if (L.minDogMonths > 0 && fin(F.dogMonths)) {
    const gate = L.minDogMonths === 15 ? 'Cold starts' : `L${L.minDogMonths === 18 ? 61 : 91} and up wait`;
    add('dogAge', 'gate', false, 'Dog’s age', `${L.minDogMonths} months old`, `${L.minDogMonths} months`, `${F.dogMonths} months`,
      F.dogMonths >= L.minDogMonths,
      `the dog is ${F.dogMonths} months old, ${gate} ${L.minDogMonths === 15 ? 'at' : 'until'} ${L.minDogMonths} months`);
  }
  if (L.boss && fin(F.tempC)) {
    add('heat', 'gate', false, 'Heat', `${RULES.heatC} °C or cooler`, `${RULES.heatC} °C or cooler`, `${Math.round(F.tempC)} °C`,
      F.tempC <= RULES.heatC, `${Math.round(F.tempC)} °C, a boss level waits for a cooler run`);
  }
  if (!hot && fin(F.layKmh)) {
    add('onFoot', 'gate', false, 'Laid on foot', 'laid on foot', `under ${RULES.footKmh} km/h`, `${Math.round(F.layKmh)} km/h`,
      F.layKmh < RULES.footKmh, `the trail was laid at ${Math.round(F.layKmh)} km/h, not on foot`);
  }
  add('times', 'gate', false, 'Times', 'times in order', 'in order', F.timesOk ? 'in order' : 'out of order', F.timesOk,
    'its times do not run in order');

  const limit = timeLimitFor(L, F.lengthM);
  const inTime = limit === null || (fin(F.findMs) && F.findMs <= limit * 60000);
  const took = fin(F.findMs) ? Math.max(1, Math.ceil(F.findMs / 60000)) : null;
  add('found', 'solve', true, 'Found', limit === null ? 'found' : `found within ${limit} min`,
    limit === null ? 'found' : `within ${limit} min`, F.found ? (took === null ? 'found' : `${took} min`) : 'not found',
    F.found && inTime,
    !F.found ? (limit === null ? 'not found' : `not found within ${limit} min`) : `found in ${took} min, the limit is ${limit} min`);
  if (L.indication) {
    add('indication', 'solve', true, 'Indication', 'indication at the find', `a mark within ${RULES.indicationM} m of the end`,
      fin(F.indicationM) ? fmtM(F.indicationM) : 'no mark', F.indication,
      `no Indication mark within ${RULES.indicationM} m of the find`);
  }
  /* Only asked of a run that claims a find. A dog that lost the trail
     half-way covered half of it, and that is a miss, not a run to throw out. */
  if (F.found && fin(F.coverage)) {
    add('coverage', 'gate', false, 'Dog’s track', 'the dog worked the trail', `${Math.round(RULES.coverShare * 100)}% of the trail`,
      `${Math.round(F.coverage * 100)}%`, F.coverage >= RULES.coverShare,
      `the dog’s track covers ${Math.round(F.coverage * 100)}% of the trail`);
  }
  return out;
}

const publicItem = ({ key, label, text, need, got, ok }) => ({ key, label, text, need, got, ok });
function checklistOf(checks, extra = []) {
  const asks = [...checks.filter(c => c.ask), ...extra.filter(c => c.ask)];
  asks.sort((a, b) => SHOW_ORDER.indexOf(a.key) - SHOW_ORDER.indexOf(b.key));
  const failed = [...checks, ...extra].filter(c => !c.ask && !c.ok);
  return [...asks, ...failed].map(publicItem);
}

function passWords(L, f) {
  const bits = [`${Math.round(f.lengthM)} m`];
  if (L.ageMin > 0 && fin(f.ageMin)) bits.push(`${fmtAge(f.ageMin, L.ageMin >= 120)} old`);
  if (fin(f.findMs)) bits.push(`found in ${Math.max(1, Math.ceil(f.findMs / 60000))} min`);
  return `Passed: ${bits.join(', ')}`;
}

/* A trail the dog did not solve is a miss even when the handler then showed
   the trail or took over to get the dog to its person: that is simply how a
   lost trail ends, and it is the very run the welfare rules are for. Were it
   "not counted" for the peek, Ease off, the placement check and the daily
   cap would never see a team's hardest days. So on an unsolved run those
   two do not stop it counting; they are named after the miss instead. A
   find with a peek or with help is still not counted, and so is everything
   about how the trail was laid. */
function soloVerdict(L, f) {
  const checks = checksFor(L, f);
  const unsolved = !f.found && !f.aborted;
  const rescue = (c) => unsolved && (c.key === 'peek' || (c.key === 'help' && !!f.help));
  const gate = checks.find(c => c.kind === 'gate' && !c.ok && !rescue(c));
  const solve = checks.find(c => c.kind === 'solve' && !c.ok);
  if (gate) return { verdict: 'notCounted', why: `Not counted: ${gate.why}`, checks, fail: gate.key };
  if (solve) {
    const after = checks.find(c => c.kind === 'gate' && !c.ok && rescue(c));
    return { verdict: 'miss', why: `Missed: ${solve.why}${after ? `, ${after.why}` : ''}`, checks, fail: solve.key };
  }
  return { verdict: 'pass', why: passWords(L, f), checks, fail: null };
}

/* The empty half of a pair on its own: was it a fair, blind run, and was
   "nobody here" called right. It has no trail, so none of the laying checks
   apply. 'ok' is a good half still waiting for its real trail. */
function emptyVerdict(L, e) {
  const not = (why, fail) => ({ verdict: 'notCounted', why: `Not counted: ${why}`, fail });
  if (!e.person || !e.ran) return not('not a person trail that was run', 'person');
  if (e.aborted) return not('stopped for the dog, which is never a miss', 'aborted');
  if (e.peeked) return not('the answer was seen before the end', 'peek');
  if (e.coach) return not('the coach was on', 'coach');
  if (e.help !== 'none' && e.help !== 'line') return not(e.help ? `help was given (${HELP_WORDS[e.help] ?? e.help})` : 'help given is not answered in the debrief', 'help');
  if (BLINDS.indexOf(e.blind) < BLINDS.indexOf(L.blind)) return not(e.blind ? 'someone there knew it was the empty one' : 'who knew the route is not answered in the debrief', 'blind');
  if (L.minDogMonths > 0 && fin(e.dogMonths) && e.dogMonths < L.minDogMonths) return not(`the dog is ${e.dogMonths} months old, this level waits until ${L.minDogMonths} months`, 'dogAge');
  if (!e.timesOk) return not('its times do not run in order', 'times');
  if (!e.emptyCalled) return { verdict: 'miss', why: 'Missed: the empty trail was called wrong', fail: 'found' };
  return { verdict: 'ok', why: '', fail: null };
}

const pairItem = (L, ok, got) => ({
  key: 'pair', kind: 'gate', ask: true, label: 'Empty trail',
  text: L.pair === 'emptySecond' ? 'an empty trail after it, called right' : 'an empty trail the same day, called right',
  need: L.pair === 'emptySecond' ? 'one empty trail called right, run second on the same day' : 'one empty trail called right on the same day',
  got, ok, why: '',
});

/* A level passed by a pair: one real trail found and one empty trail called
   right, on the same day. Either half can be the run in hand; the other, if
   it has been run, is the partner. */
function judgePair(L, f, partner) {
  const base = { level: L.level, pending: null };
  if (f.empty) {
    const e = emptyVerdict(L, f);
    const blank = checksFor(L, null);
    if (e.verdict !== 'ok') return { ...base, verdict: e.verdict, why: e.why, checklist: checklistOf(blank, [pairItem(L, false, 'called wrong')]) };
    const r = partner && !partner.empty ? soloVerdict(L, partner) : null;
    const sameDay = partner && partner.day === f.day;
    const ordered = partner && (L.pair !== 'emptySecond' || f.at > partner.at);
    if (r && r.verdict === 'pass' && sameDay && ordered) {
      return { ...base, verdict: 'pass', why: `${r.why}, and the empty trail called right`, checklist: checklistOf(r.checks, [pairItem(L, true, 'called right')]) };
    }
    return { ...base, verdict: 'notCounted', pending: 'real',
      why: L.pair === 'emptySecond' ? 'Not counted yet: at this level the real trail is run first, then the empty one'
        : 'Not counted yet: it needs its real trail found on the same day',
      checklist: checklistOf(r ? r.checks : blank, [pairItem(L, true, 'called right')]) };
  }
  const r = soloVerdict(L, f);
  const e = partner && partner.empty ? emptyVerdict(L, partner) : null;
  const sameDay = partner && partner.day === f.day;
  const ordered = partner && (L.pair !== 'emptySecond' || partner.at > f.at);
  const good = !!e && e.verdict === 'ok' && sameDay && ordered;
  const checklist = checklistOf(r.checks, [pairItem(L, good, good ? 'called right' : e && e.verdict === 'ok' && sameDay ? 'run first' : null)]);
  if (r.verdict !== 'pass') return { ...base, verdict: r.verdict, why: r.why, checklist };
  if (good) return { ...base, verdict: 'pass', why: `${r.why}, and the empty trail called right`, checklist };
  return { ...base, verdict: 'notCounted', pending: 'empty',
    why: L.pair === 'emptySecond' ? 'Not counted yet: it needs an empty trail called right after it, on the same day'
      : 'Not counted yet: it needs an empty trail called right on the same day',
    checklist };
}

/** One run against one level.
    -> { level, verdict: 'pass' | 'miss' | 'notCounted', checklist, why, pending }
    `checklist` is what the level asks, each with what the run gave and
    whether that is enough, followed by any quiet rule the run broke. `why`
    is one line a handler can read. With no run (`facts` null) it is the
    level's blank checklist. For the empty-trail levels `opts.partner` is the
    facts of the other half of the pair, and `pending` says which half a good
    run is still waiting for ('empty' or 'real'). */
export function judge(level, facts, opts = {}) {
  if (typeof level === 'number') level = levelSpec(level, opts.ladder ?? LADDER_V1);
  if (!level) return null;
  if (!facts) {
    const checks = checksFor(level, null);
    return { level: level.level, verdict: 'notCounted', why: '', pending: null,
      checklist: checklistOf(checks, level.pair ? [pairItem(level, false, null)] : []) };
  }
  if (level.pair) return judgePair(level, facts, opts.partner ?? null);
  const r = soloVerdict(level, facts);
  return { level: level.level, verdict: r.verdict, why: r.why, pending: null, checklist: checklistOf(r.checks) };
}

/* ── Where a team stands ────────────────────────────────────────────── */

/* Earlier starts, kept in a coarse grid so "has this team started near here
   before" looks at the handful of starts in the neighbouring cells and not
   at every run the team has ever made. A cell is over a kilometre of
   latitude and, below 80 degrees north, more than 300 m of longitude, so
   anything within 300 m is in the cell or one beside it. */
function placeIndex() {
  const cells = new Map();
  const key = (a, b) => `${a},${b}`;
  const cellOf = (p) => [Math.floor(p.lat / 0.01), Math.floor(p.lon / 0.02)];
  return {
    add(p) {
      if (!p) return;
      const [a, b] = cellOf(p), k = key(a, b);
      const g = cells.get(k);
      if (g) g.push(p); else cells.set(k, [p]);
    },
    near(p) {
      const [a, b] = cellOf(p);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
        const g = cells.get(key(a + i, b + j));
        if (g && g.some(q => dist(p, q) <= RULES.newPlaceM)) return true;
      }
      return false;
    },
  };
}

/** A team's standing, worked out from its sessions and nothing else.

    `team` is { handlerId, dogId, startLevel, placedAt, best } as kept on the
    dog (teamsOf). `opts.now` is the moment to judge "today" and "rusty" by;
    this never reads the clock itself, nor the phone's time zone:
    `opts.tzMin` is the minutes ahead of UTC to count "today" by, and
    without it the newest run's own offset is used. `opts.dog` gives the
    birth date for the age gates. `opts.since` limits `events` to those at
    or after a moment, so the app can play what the run just saved has earned.

    Returns the current level (1-100, with `done` once L100 is passed) and
    its stage, the name the team has earned (that of the last level passed;
    null before the first), the next level's spec with a checklist against the best
    recent try, the last three tries with why each did or did not count, the
    welfare states (ease off, rusty, the daily cap, heat, the dog's age), the
    placement check, the high-water mark to save back on the team, and the
    level-ups as events. */
export function teamLevel(sessions, team, opts = {}) {
  const ladder = opts.ladder ?? LADDER_V1;
  const top = topOf(ladder);
  const L = (n) => ladder.levels[n - 1];
  const dog = opts.dog ?? null;
  const start = clampLevel(team?.startLevel, ladder);
  const placedAt = fin(team?.placedAt) ? team.placedAt : -Infinity;
  const kept = team?.best && fin(team.best.level) && team.best.level > 0
    ? { v: fin(team.best.v) ? team.best.v : ladder.v, level: Math.min(top, Math.floor(team.best.level)), at: fin(team.best.at) ? team.best.at : null }
    : null;

  /* The team's own runs, oldest first. Another handler with the same dog is
     another team, and a hide search is not on this ladder at all. */
  const runs = [];
  for (const s of sessions || []) {
    if (!s || team?.handlerId == null || team.dogId == null) continue;
    if (s.handlerId !== team.handlerId || s.dogId !== team.dogId || !isLevelRun(s)) continue;
    runs.push(s);
  }
  runs.sort((a, b) => a.data.trackStarted - b.data.trackStarted || (String(a.id) < String(b.id) ? -1 : 1));
  const now = fin(opts.now) ? opts.now : runs.length ? runs[runs.length - 1].data.trackStarted : 0;

  let cur = start;                 // the level being worked on; top + 1 once every level is passed
  let highest = 0, highestAt = null;
  let missStreak = 0, rusty = false, lastCounted = null;
  let placedCounted = 0;
  const dayCount = new Map();
  /* A team placed again today (the placement suggestion taken) has already
     run today: the runs before `placedAt` are skipped below, so the count
     they made is handed on, or the dog would get a second day's allowance. */
  if (fin(team?.capCarry?.day) && team.capCarry.used > 0) dayCount.set(team.capCarry.day, team.capCarry.used);
  let waiting = [];                // good halves of a pair, waiting for the other
  const recs = [], events = [];
  const places = placeIndex(), layers = new Set();
  const rustyMs = RULES.rustyDays * DAY_MS;
  /* The easier run "Ease off" suggests: the start of the wave. A team already
     on the start of its wave is sent to the start of the wave before, never
     to the level just below it: that level is the hardest of its wave, often
     longer and older than the one just missed twice, and at L16, L46 and L76
     it is a boss, which cannot end a hot day on a find at all. */
  const easeLevel = (n) => { const ws = waveStart(n, ladder); return n === ws ? waveStart(Math.max(1, n - 1), ladder) : ws; };

  for (const s of runs) {
    const base = baseFacts(s);
    const facts = Object.freeze({ ...base,
      newPlace: base.startPt ? !places.near(base.startPt) : null,
      stranger: base.layerKey !== null && !layers.has(base.layerKey),
      dogMonths: monthsAt(dog, base.at) });
    places.add(base.startPt);
    if (base.layerKey !== null) layers.add(base.layerKey);
    /* Runs from before the team was placed are its history (they make a
       place known and a layer familiar) but are not tries at a level. */
    if (base.at < placedAt) continue;
    /* The high-water mark is a floor from the moment it was earned: a run
       after it is a try at the level above it, whatever a replay under a
       changed ladder or a deleted session would say. */
    if (kept && (kept.at === null || kept.at <= base.at)) cur = Math.max(cur, kept.level + 1);

    const rec = { id: s.id, at: base.at, endAt: base.endAt, tzMin: base.tzMin, level: Math.min(cur, top), verdict: 'notCounted', why: '',
      checklist: [], passed: [], again: false, pairWith: null, hot: fin(base.tempC) && base.tempC > RULES.heatC ? base.tempC : null };
    recs.push(rec);
    if (cur > top) { rec.why = 'Not counted: every level is already passed'; continue; }

    if (lastCounted !== null && base.at - lastCounted > rustyMs) rusty = true;
    waiting = waiting.filter(w => w.facts.day === base.day && !w.used);

    /* Which levels this run is tried at. Its own level first. Below that:
       the start of the wave while the team is rusty, the easier run "Ease
       off" suggests, and the level stamped on the run when it began, if the
       handler chose to run a lower one. */
    const stamp = base.levelTry && base.levelTry.v === ladder.v && base.levelTry.level >= 1 && base.levelTry.level <= top ? base.levelTry.level : null;
    const target = stamp !== null && stamp < cur ? stamp : cur;
    const lower = [];
    if (rusty) lower.push(waveStart(cur, ladder));
    if (missStreak >= RULES.easeAfter) lower.push(easeLevel(cur));
    lower.push(target);
    const tryAt = (n) => {
      const spec = L(n);
      if (!spec.pair) return { n, r: judge(spec, facts), partner: null };
      let last = null;
      for (let i = waiting.length - 1; i >= 0; i--) {
        const w = waiting[i];
        if (w.used || w.facts.empty === facts.empty) continue;
        const r = judge(spec, facts, { partner: w.facts });
        if (r.verdict === 'pass') return { n, r, partner: w };
        last = last ?? { n, r, partner: null };
      }
      return last ?? { n, r: judge(spec, facts), partner: null };
    };
    let res = tryAt(cur);
    let advance = res.r.verdict === 'pass';
    if (!advance) {
      let again = null;
      for (const n of lower) {
        if (n >= cur || again) continue;
        const x = tryAt(n);
        if (x.r.verdict === 'pass') again = x;
      }
      res = again ?? (target < cur ? tryAt(target) : res);
    }

    /* The daily cap, for the dog's sake: past it a run is not counted,
       however good. A pair is two runs. */
    const cap = L(cur).stage === 'hot' ? RULES.capHot : RULES.cap;
    const used = dayCount.get(base.day) ?? 0;
    const need = res.partner ? 2 : 1;
    let verdict = res.r.verdict, why = res.r.why;
    /* A run stamped as a try at a level above where the team now stands was
       laid for that level, before the team was moved down (the placement
       suggestion taken) or its record changed. Unsolved, it was a miss up
       there and is not one down here: a team that has just eased down must
       not arrive with two misses and "Ease off" already against a level it
       has never run. Found, it still passes whatever it meets. */
    if (stamp !== null && stamp > cur && verdict === 'miss') {
      verdict = 'notCounted';
      why = `Not counted: it was a try at L${stamp}, before the team moved down`;
    }
    if (verdict !== 'notCounted' && used + need > cap) {
      verdict = 'notCounted'; advance = false;
      /* A single run only trips the cap when the day is full. A pair can trip
         it one short, and both halves are then told the same true thing. */
      why = need > 1
        ? `Not counted: ${plural(used, 'run')} already counted today and a pair is two more, the limit is ${cap}`
        : `Not counted: ${plural(cap, 'run')} already counted today, the dog has done enough`;
      if (res.partner) res.partner.rec.why = why;
    }
    rec.level = res.n; rec.verdict = verdict; rec.why = why; rec.checklist = res.r.checklist;

    if (verdict === 'notCounted') {
      if (res.r.pending && why === res.r.why) waiting.push({ facts, rec, used: false });
      continue;
    }
    dayCount.set(base.day, used + need);
    lastCounted = base.at;
    placedCounted += need;
    if (verdict === 'miss') { missStreak++; continue; }

    missStreak = 0;
    if (res.partner) {
      res.partner.used = true;
      rec.pairWith = res.partner.rec.id;
      Object.assign(res.partner.rec, { verdict: 'pass', why, level: res.n, checklist: res.r.checklist, pairWith: s.id });
    }
    if (!advance) {
      /* A pass below the team's level: a refresher. It moves nothing, but it
         is a find to end on, and at the start of the wave it clears Rusty. */
      rec.again = true;
      rec.why = `${why} (L${res.n} again)`;
      if (res.partner) res.partner.rec.again = true;
      if (res.n >= waveStart(cur, ladder)) rusty = false;
      continue;
    }

    /* One good run passes its level, and every later level in the same wave
       that it also meets, one after the other. Never into the next wave:
       each wave brings a skill that has to be shown on its own. The pair's
       real trail is the one measured, whichever half came last. */
    const real = facts.empty && res.partner ? res.partner.facts : facts;
    const mate = res.partner ? (facts.empty ? facts : res.partner.facts) : null;
    const passed = [cur];
    let n = cur + 1;
    while (n <= top && L(n).wave === L(cur).wave) {
      if (judge(L(n), real, { partner: mate }).verdict !== 'pass') break;
      passed.push(n);
      n++;
    }
    const from = cur;
    cur = n;
    highest = passed[passed.length - 1]; highestAt = base.endAt ?? base.at;
    rusty = false;
    rec.passed = passed;
    if (res.partner) res.partner.rec.passed = passed;
    const done = cur > top;
    /* The names are those of levels passed: what the team was called going
       in (nothing, before its first pass) and what this run has earned. */
    events.push({ type: 'levelUp', at: highestAt, sessionId: s.id, from, to: Math.min(cur, top), done, passed,
      fromName: from > 1 ? levelName(from - 1, ladder) : null, toName: levelName(highest, ladder),
      fromStage: L(from).stage, toStage: L(Math.min(cur, top)).stage, stageChanged: !done && L(from).stage !== L(cur).stage });
    for (const p of passed) {
      if (L(p).boss) events.push({ type: 'boss', at: highestAt, sessionId: s.id, level: p, bossName: L(p).bossName, title: L(p).title, stage: L(p).stage });
    }
  }

  /* The high-water mark: what the record now shows, or what was already
     earned, whichever is higher. It only ever rises. */
  if (kept) cur = Math.max(cur, kept.level + 1);
  const earned = Math.max(highest, kept ? kept.level : 0);
  const rose = highest > (kept ? kept.level : 0);
  const best = rose ? { v: Math.max(ladder.v, kept ? kept.v : ladder.v), level: highest, at: highestAt }
    : kept ? { ...kept } : { v: ladder.v, level: 0, at: null };

  const done = cur > top;
  const level = Math.min(cur, top);
  const spec = L(level);
  /* A team is named for the last level it passed, so every pass brings a
     new name and the name on the card is one it has earned. The level it is
     working on is `next`, with the name still to be won. A team that has
     passed nothing has no name yet; a placed team carries the name of the
     level below where it was put. */
  const stood = done ? top : level - 1;
  const named = stood >= 1 ? L(stood) : null;
  /* "Today" by the clock where the team is: the offset handed in, or the
     newest run's own. Never the reading phone's zone (dayKey). */
  const nowOff = fin(opts.tzMin) ? opts.tzMin : runs.length ? baseFacts(runs[runs.length - 1]).tzMin : 0;
  const today = dayKey(now, nowOff);
  const capMax = spec.stage === 'hot' ? RULES.capHot : RULES.cap;
  const usedToday = dayCount.get(today) ?? 0;

  if (lastCounted !== null && now - lastCounted > rustyMs) rusty = true;
  const months = monthsAt(dog, now);
  const lastRec = recs.length ? recs[recs.length - 1] : null;

  /* The checklist the card shows: the best of the last three tries at this
     level, so the handler sees how near they have come, not only the latest
     slip. Level with one another, the newest wins. */
  let bestTry = null;
  if (!done) {
    const mine = recs.filter(r => r.level === level && !r.again && r.verdict !== 'pass').slice(-3);
    for (const r of mine) {
      const score = r.checklist.filter(c => c.ok).length;
      if (!bestTry || score >= bestTry.score) bestTry = { score, rec: r };
    }
  }

  const placement = start <= 1 ? { state: 'none', startLevel: start, triesLeft: 0, suggest: null }
    : earned >= start ? { state: 'passed', startLevel: start, triesLeft: 0, suggest: null }
    : placedCounted >= RULES.placementTries ? { state: 'suggest', startLevel: start, triesLeft: 0, suggest: Math.max(1, start - RULES.placementDrop) }
    : { state: 'pending', startLevel: start, triesLeft: RULES.placementTries - placedCounted, suggest: null };

  const since = fin(opts.since) ? opts.since : -Infinity;
  const title = bossTitle(earned, ladder, Math.min(start, kept ? kept.level + 1 : start));
  const out = (r) => ({ id: r.id, at: r.at, level: r.level, verdict: r.verdict, why: r.why, passed: r.passed,
    again: r.again, pairWith: r.pairWith, hot: r.hot, checklist: r.checklist });

  return {
    v: ladder.v, handlerId: team?.handlerId ?? null, dogId: team?.dogId ?? null,
    level, done, passed: done ? top : level - 1, earned,
    name: named ? named.name : null, rank: named ? named.rank : null, roman: named ? named.roman : null,
    stage: spec.stage, wave: spec.wave, waveName: spec.waveName,
    boss: spec.boss, title: title ? title.title : null, titleLevel: title ? title.level : null,
    next: done ? null : {
      level, spec, whatsNew: whatsNew(level, ladder),
      checklist: bestTry ? bestTry.rec.checklist : judge(spec, null).checklist,
      bestTryId: bestTry ? bestTry.rec.id : null,
    },
    tries: recs.slice(-3).reverse().map(out),
    counted: { today: usedToday, max: capMax, left: Math.max(0, capMax - usedToday) },
    placement,
    easeOff: !done && missStreak >= RULES.easeAfter ? { misses: missStreak, suggest: easeLevel(level) } : null,
    rusty: !done && rusty ? { since: lastCounted, days: lastCounted === null ? null : Math.floor((now - lastCounted) / DAY_MS), suggest: waveStart(level, ladder) } : null,
    heat: lastRec && lastRec.hot !== null && dayKey(lastRec.at, nowOff) === today ? { tempC: lastRec.hot, bossWaits: spec.boss } : null,
    gate: !done && spec.minDogMonths > 0 && months !== null && months < spec.minDogMonths
      ? { level, months, needMonths: spec.minDogMonths } : null,
    best, bestChanged: rose,
    events: events.filter(e => e.at >= since),
  };
}
