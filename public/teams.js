/* Teams on screen: the words and small sums that sit between the level
   engine (levels.js) and the pages that show a team. No DOM in here, so all
   of it can be tested.

   One rule runs through the whole file. A team STANDS ON the last level it
   passed and WORKS ON the next one: "L22" on a chip is the stone under its
   feet, and the card at the bottom of the board is always about the stone
   ahead. The engine names both (`passed` and `level`); nothing here adds a
   third number. */

import { fmtDist, fmtTemp } from './geo.js';
import { ownRun } from './debrief.js';
import { LADDER_V1, RULES, STARTS, SETTINGS, SETTING_FROM, levelSpec, judge, whatsNew, presetById, newTeam } from './levels.js';

/* ── Animations: Auto, On, Off ────────────────────────────────────────
   Auto follows the phone's Reduce Motion. On is there because a handler can
   keep Reduce Motion on for the rest of the phone and still want to see the
   dog trot: On really animates, whatever the phone says. */
export const MOTIONS = Object.freeze([
  Object.freeze({ id: 'auto', label: 'Auto', sub: 'Follows your phone’s Reduce Motion' }),
  Object.freeze({ id: 'on', label: 'On', sub: 'The pixel team always moves' }),
  Object.freeze({ id: 'off', label: 'Off', sub: 'Still poses and soft fades' }),
]);
const isMotion = (v) => MOTIONS.some(m => m.id === v);

/** Which of the three is in force: `?motion=` in the address wins over the
    setting, so a link can show the animation on a phone set to Off. */
export function motionChoice(setting, query = null) {
  if (isMotion(query)) return query;
  return isMotion(setting) ? setting : 'auto';
}
/** Does the pixel team move? `reduced` is the phone's own Reduce Motion. */
export const motionOn = (choice, reduced) => (choice === 'on' ? true : choice === 'off' ? false : !reduced);

/* ── The look ─────────────────────────────────────────────────────────
   The ids are pixel-team.js's own (COATS, JACKETS, HATS). They are written
   out here rather than imported so this file stays free of the drawing
   code; test/teams.test.mjs holds the two lists together. */
export const COAT_IDS = Object.freeze(['bloodhound-red', 'bloodhound-bt', 'bloodhound-liver', 'malinois', 'shepherd',
  'lab-yellow', 'lab-black', 'lab-chocolate', 'beagle', 'springer']);
export const DEFAULT_LOOK = Object.freeze({ coat: 'bloodhound-red', jacket: 'navy', hat: 'cap' });

/** The coat that suits a breed as the handler typed it, so a new team's dog
    looks like the dog. A guess, and the handler can pick another. */
export function coatFor(breed) {
  const b = String(breed ?? '').toLowerCase();
  const has = (re) => re.test(b);
  if (has(/blood\s*hound|st\.? hubert/)) {
    return has(/black/) ? 'bloodhound-bt' : has(/liver/) ? 'bloodhound-liver' : 'bloodhound-red';
  }
  if (has(/malinois|mali\b|belgian|dutch shep/)) return 'malinois';
  if (has(/shepherd|gsd|alsatian/)) return 'shepherd';
  if (has(/lab/)) return has(/black/) ? 'lab-black' : has(/choc|brown|liver/) ? 'lab-chocolate' : 'lab-yellow';
  if (has(/beagle|harrier|foxhound|basset|coonhound/)) return 'beagle';
  if (has(/springer|spaniel|cocker|setter|pointer|munsterlander/)) return 'springer';
  if (has(/retriever/)) return 'lab-yellow';
  if (has(/hound/)) return 'bloodhound-red';
  return DEFAULT_LOOK.coat;
}

/** What the pixel team wears. The harness is not chosen: it takes the
    colour of the stage the team is working in. */
export function teamLook(team, dog, stage = 'hot') {
  const l = team?.look ?? {};
  return {
    coat: COAT_IDS.includes(l.coat) ? l.coat : coatFor(dog?.breed),
    jacket: l.jacket || DEFAULT_LOOK.jacket,
    hat: l.hat || DEFAULT_LOOK.hat,
    stage,
  };
}

/* ── Team rows on the dog ─────────────────────────────────────────────
   A dog keeps one row for each handler who runs it. These return a new list
   and never touch the one they were given: the caller saves the dog. */

const rowsOf = (dog) => (Array.isArray(dog?.teams) ? dog.teams.filter(t => t && t.handlerId != null) : []);

/** A new team with its whole look. The engine's newTeam keeps the coat and
    the jacket; the hat is the page's own, and rides along with them. */
export function makeTeam({ handlerId, dogId, preset, now, look = null }) {
  const t = newTeam({ handlerId, dogId, preset, now, look });
  return { ...t, look: { ...t.look, hat: look?.hat ?? null } };
}

/** The dog's teams with this one added, or put in place of the one its
    handler already had. */
export function putTeam(dog, team) {
  const { dogId, ...row } = team;     // teamsOf adds the dog's id for the engine; the dog does not store it
  const rows = rowsOf(dog);
  const i = rows.findIndex(t => t.handlerId === row.handlerId);
  return i < 0 ? [...rows, row] : rows.map((t, k) => (k === i ? row : t));
}
/** The dog's teams without one handler's, for when that handler is deleted. */
export const dropTeam = (dog, handlerId) => rowsOf(dog).filter(t => t.handlerId !== handlerId);

/** The dog's teams with one team's high-water mark written back, or null
    when there is nothing to write. */
export function withBest(dog, handlerId, best) {
  const rows = rowsOf(dog);
  const i = rows.findIndex(t => t.handlerId === handlerId);
  if (i < 0 || !best) return null;
  const had = rows[i].best;
  if (had && had.level === best.level && had.at === best.at && had.v === best.v) return null;
  return rows.map((t, k) => (k === i ? { ...t, best: { v: best.v, level: best.level, at: best.at } } : t));
}

/** A team started again from another level: the placement suggestion taken,
    or the handler picking another start. Nothing earned is lost, because
    `best` stays; the placement check starts afresh from now.

    Two things would otherwise be lost with the old placement, because the
    engine only looks at runs since `placedAt`, and both are handed in as
    `lv`, the team's level just before the move:
    - the runs already counted today. The daily cap is there for the dog,
      and a dog that has run its three does not get three more for a change
      on the form. `capCarry` hands the day's count on (`day` is the engine's
      own key for today, dayKey);
    - the boss title the team ran for. A team re-placed above where it
      stands has not run the bosses in between, and the engine can no longer
      tell which ones it did: `titleKept` is the boss level it had earned. */
export function restartTeam(team, { level = null, preset = null, now, lv = null, day = null }) {
  const p = preset ? presetById(preset) : null;
  const startLevel = Math.max(1, Math.min(LADDER_V1.levels.length, Math.round(level ?? p?.startLevel ?? team.startLevel)));
  const { capCarry, titleKept, ...rest } = team;
  const used = lv?.counted?.today ?? 0;
  const title = titleLevel(lv, team);
  return { ...rest, preset: p ? p.id : team.preset, startLevel, placedAt: now,
    ...(used > 0 && Number.isFinite(day) ? { capCarry: { day, used } } : {}),
    ...(title ? { titleKept: title } : {}) };
}

/* ── Where the team stands ────────────────────────────────────────── */

const STAGE_LABEL = Object.fromEntries(LADDER_V1.stages.map(s => [s.key, s.label]));
export const stageLabel = (key) => STAGE_LABEL[key] ?? '';
/** The stage of the stone under the team's feet. Before the first stone it
    is the stage it is about to walk into. */
export const stoodStage = (lv) => (lv ? levelSpec(lv.passed)?.stage ?? lv.stage : null);

/** The chip beside a dog: "L22 · Warm". A team that stands on no stone yet
    has no number to show, so its chip says where it starts. */
export function levelChip(lv) {
  if (!lv) return '';
  if (proven(lv)) return `L${lv.passed} · ${stageLabel(stoodStage(lv))}`;
  return lv.level > 1 ? `Starts at L${lv.level} · ${stageLabel(lv.stage)}` : `Start · ${stageLabel(lv.stage)}`;
}
/** The stage whose colour the chip wears: the stone stood on, or the stage
    an unproven team is about to start in. */
export const chipStage = (lv) => (!lv ? '' : lv.done ? 'cold' : proven(lv) ? stoodStage(lv) : lv.stage);

/** Has the team passed a level of its own since it was placed? The engine
    stands a team placed by a preset on the stone below its start, which is
    where to draw it, but that stone's number and name are not its to wear:
    until its first pass a team placed at 16 "starts at level 16", it is not
    "L15, Scent Reader V". */
export const proven = (lv) => !!lv && (lv.done || (lv.passed >= 1 && lv.earned >= (lv.placement?.startLevel ?? 1)));

/** The name a team has earned, or what to call it before it has one. A team
    moved up by hand keeps the name of the last level it passed itself. */
export const earnedName = (lv) => (!lv ? 'New team' : proven(lv) ? lv.name || 'New team'
  : lv.earned > 0 ? levelSpec(lv.earned)?.name ?? 'New team' : 'New team');

/** "Level 22 of 100", or where a team that has passed nothing of its own is
    about to start. */
export function meterWords(lv) {
  if (!lv) return '';
  if (proven(lv)) return `Level ${lv.passed} of ${LADDER_V1.levels.length}`;
  return lv.level > 1 ? `Starts at level ${lv.level}` : 'At the start';
}

/* The boss whose title the team carries, as a level, or 0. The engine's own
   is only believed for a boss at or above where the team is placed now: for
   a team moved up by hand it can name one in the gap it stepped over. Below
   that, the title it had when it was moved (restartTeam) still stands. */
function titleLevel(lv, team) {
  const own = lv && Number.isFinite(lv.titleLevel) && lv.titleLevel >= (lv.placement?.startLevel ?? 1) ? lv.titleLevel : 0;
  const kept = Number.isFinite(team?.titleKept) && levelSpec(team.titleKept)?.boss ? team.titleKept : 0;
  return Math.max(own, kept);
}
/** The boss title a team carries ("Trail Hound"), or null. */
export const teamTitle = (lv, team = null) => { const n = titleLevel(lv, team); return n ? levelSpec(n)?.title ?? null : null; };
/** "Rémi & Rex", or whichever of the two there is. */
export const pairName = (handlerName, dogName) =>
  [handlerName, dogName].map(x => (typeof x === 'string' ? x.trim() : '')).filter(Boolean).join(' & ');

/** The Hot, Warm and Cold bar: each stage as wide as its share of the
    ladder, filled as far as the team has passed. */
export function stageBar(passed) {
  return LADDER_V1.stages.map(s => {
    const span = s.to - s.from + 1;
    return { key: s.key, label: s.label, span, fill: Math.max(0, Math.min(1, (passed - s.from + 1) / span)) };
  });
}

/** Where to draw the team: on the last stone it passed itself, or, when it
    has passed none, on the path just before the stone it starts at. A new
    team waits at the trailhead, before stone 1. */
export function standing(lv) {
  const start = lv?.placement?.startLevel ?? 1;
  if (!lv) return { before: 1 };
  if (lv.done) return { on: LADDER_V1.levels.length };
  return lv.passed >= start ? { on: lv.passed } : { before: lv.level };
}

/** A stone seen from this team: passed by its own runs, stepped over by the
    preset it started from, the one it is working on, or still ahead. */
export function stoneStatus(level, lv) {
  if (!lv) return 'ahead';
  if (level <= lv.passed) return level >= (lv.placement?.startLevel ?? 1) ? 'passed' : 'skipped';
  return !lv.done && level === lv.level ? 'next' : 'ahead';
}

/* ── The app's units ──────────────────────────────────────────────────
   The engine speaks metres and Celsius. Its sentences are shown as they are
   in metric, and with each length re-said in the app's own imperial words
   otherwise: "96 of 120 m, too short" becomes "105 of 131 yd, too short". */

/* A level's length stays in yards right up to a mile. The app's own words
   switch to miles and one decimal at half a mile, and then 900 m and 1000 m
   both read "0.6 mi": the card said "New: 0.6 mi" of a level whose length
   looked the same as the one before. The longest trail on the ladder is
   under a mile, so every step now reads differently. */
const yards = (m) => {
  const yd = Math.round(Number(m) * 1.0936133);
  return yd < 1760 ? `${yd.toLocaleString('en-GB')} yd` : fmtDist(Number(m), true);
};
/** Two lengths said together share a unit when they can: "105 of 131 yd". */
function pairIn(a, b) {
  const A = yards(a), B = yards(b);
  const ua = A.split(' ')[1], ub = B.split(' ')[1];
  return ua === ub ? `${A.split(' ')[0]} of ${B}` : `${A} of ${B}`;
}
export function inUnits(text, imperial = false) {
  if (!imperial || typeof text !== 'string') return text ?? '';
  return text
    .replace(/(\d+(?:\.\d+)?) of (\d+(?:\.\d+)?) m\b/g, (_, a, b) => pairIn(a, b))
    .replace(/(\d+(?:\.\d+)?) m\b/g, (_, a) => yards(a))
    .replace(/(\d+(?:\.\d+)?) km\/h\b/g, (_, a) => `${Math.round(Number(a) * 0.621371)} mph`);
}

/* ── The card: what the next level asks ─────────────────────────────── */

/* What is new at a level that has no row of its own on the checklist. */
const NEW_WORDS = { coach: 'coach off', boss: 'boss level' };
/* Rows whose "got" is a figure worth showing beside what was asked. */
const FIGURES = new Set(['length', 'age', 'turns', 'surfaces', 'crossTracks', 'walkAlong']);

/** The checklist as rows to draw. `news` are the keys new at this level,
    shown in gold. A row from a real try carries what the run managed. */
export function checkRows(checklist, news = [], { imperial = false } = {}) {
  return (checklist || []).map(c => ({
    key: c.key,
    text: inUnits(c.text, imperial),
    ok: !!c.ok,
    isNew: news.includes(c.key),
    got: !c.ok && c.got != null && FIGURES.has(c.key) ? inUnits(String(c.got), imperial) : null,
  }));
}

/** "New: 250 m · 1 turn": what this level asks that the one before did not.
    Empty when it only asks for the same again. */
export function newWords(level, { imperial = false } = {}) {
  const spec = levelSpec(level);
  if (!spec) return [];
  const rows = judge(spec, null).checklist;
  const out = [];
  for (const k of whatsNew(level)) {
    if (k === 'boss') { out.push(`boss: ${spec.bossName}`); continue; }
    const row = rows.find(r => r.key === k);
    const words = row ? inUnits(row.text, imperial) : NEW_WORDS[k];
    if (words && !out.includes(words)) out.push(words);
  }
  return out;
}

/** Everything the card says about one level, whoever is asking: the next
    one, or a stone that was tapped. */
export function levelCard(level, lv = null, { imperial = false } = {}) {
  const spec = levelSpec(level);
  if (!spec) return null;
  const status = stoneStatus(level, lv);
  const isNext = status === 'next';
  const news = whatsNew(level);
  /* The next level shows the team's nearest try at it; any other stone shows
     what it asks, ticked when the team has been past it. */
  const list = isNext && lv?.next ? lv.next.checklist : judge(spec, null).checklist;
  const rows = checkRows(list, news, { imperial });
  if (status === 'passed') for (const r of rows) { r.ok = true; r.got = null; }
  return {
    level, status, name: spec.name, stage: spec.stage, stageLabel: stageLabel(spec.stage),
    boss: spec.boss, bossName: spec.bossName, title: spec.title,
    kicker: `${{ next: 'Next', passed: 'Passed', skipped: 'Before your start', ahead: 'Ahead' }[status]} · level ${level}`,
    news: newWords(level, { imperial }),
    also: spec.also.map(a => inUnits(a, imperial)),
    rows,
  };
}

/** A stone read aloud: "Level 8, Line Puller III, 120 m, 3 min old, next". */
export function stoneLabel(level, lv = null, { imperial = false } = {}) {
  const spec = levelSpec(level);
  if (!spec) return `Level ${level}`;
  const asks = judge(spec, null).checklist.filter(c => c.key === 'length' || c.key === 'age').map(c => inUnits(c.text, imperial));
  const state = { next: 'next', passed: 'passed', skipped: 'before your start', ahead: 'ahead' }[stoneStatus(level, lv)];
  return [`Level ${level}`, spec.name, spec.boss ? `boss: ${spec.bossName}` : null, ...asks, state].filter(Boolean).join(', ');
}

/* ── The last three tries ───────────────────────────────────────────── */

const TRY_KIND = { pass: 'yes', miss: 'miss', notCounted: 'no' };
const TRY_MARK = { yes: '✓', miss: '✕', no: '–' };
const TRY_SAYS = { yes: 'Counted', miss: 'Missed', no: 'Not counted' };

/** The tries as rows: a mark, when, and the engine's own reason. `when`
    turns a time into the app's short date. */
export function tryRows(tries, { imperial = false, when = null, noLine = null } = {}) {
  return (tries || []).map(t => {
    const kind = TRY_KIND[t.verdict] ?? 'no';
    return {
      id: t.id, kind, mark: TRY_MARK[kind], says: TRY_SAYS[kind], level: t.level,
      when: when && Number.isFinite(t.at) ? when(t.at) : '',
      why: plainWhy(t.why, { imperial, noLine: !!noLine?.(t.id) }),
    };
  });
}

/* The engine names what a debrief did not answer in its own words ("start
   type"); the debrief's rows are headed otherwise ("Start"). The handler is
   sent to look for the row, so the reason uses the heading they will find. */
const ROW_NAMES = [['start type', 'Start'], ['help given', 'Help you gave'], ['who knew the route', 'Who knew the answer'], ['setting', 'Setting']];
const UNANSWERED = /\b(start type|help given|who knew the route|setting) is not answered in the debrief/;
const NO_AGE = 'trail age unknown';
const LEFT_UNSAID = 'nobody said how long ago the person left';

/** The engine's reason, in the app's units and the debrief's own headings.
    `noLine`: the run has no laid trail, so its only age is the handler's
    "the person left _ min ago", and an unknown age means that was not said. */
export function plainWhy(why, { imperial = false, noLine = false } = {}) {
  let out = inUnits(why || '', imperial)
    .replace(UNANSWERED, (_, k) => `“${ROW_NAMES.find(r => r[0] === k)[1]}” is not answered in the debrief`);
  if (noLine) out = out.replace(NO_AGE, LEFT_UNSAID);
  return out;
}

/** Can the handler make this try count by answering something in the
    debrief? True when the reason it gave is an answer that is missing. */
export const debriefWouldFix = (tryRec, { noLine = false } = {}) =>
  !!tryRec && tryRec.verdict !== 'pass' && (UNANSWERED.test(tryRec.why || '') || (noLine && (tryRec.why || '').includes(NO_AGE)));

/* ── What a run did, and the moment it earns ──────────────────────────
   After a run is kept, its result says in one line what it did for the
   team, and a level passed is played once on the board. "Once" is kept on
   the team's own row (`shown`, the highest level whose passing has been
   played), so it travels with the dog to another phone. */

/** The highest level whose passing this team has already been shown. */
export const shownLevel = (team) => (Number.isFinite(team?.shown) ? team.shown : 0);

/** The dog's teams with this handler's marked as shown up to `level`, or
    null when that is nothing new. */
export function withShown(dog, handlerId, level) {
  const rows = rowsOf(dog);
  const i = rows.findIndex(t => t.handlerId === handlerId);
  if (i < 0 || !Number.isFinite(level) || level <= shownLevel(rows[i])) return null;
  return rows.map((t, k) => (k === i ? { ...t, shown: level } : t));
}

/**
 * The moment to play, or null. `events` are ALL the team's events from
 * teamLevel(), `lv` what teamLevel() says now, `shown` the team's
 * shownLevel. It is the level-up that put the team where it stands,
 * whichever run earned it, and only if that has not been shown: nothing is
 * played twice, and nothing for a level the team has since moved past.
 *
 * It used to look only at the run just saved. A level can be passed by
 * another run than the one in hand: two debriefs written out of order (the
 * first run's answers let the second one pass the next level), or a surface
 * put right. Those were never played at all.
 */
export function momentFor(events, lv, shown = 0) {
  if (!lv) return null;
  const up = (events || []).filter(e => e.type === 'levelUp' && e.passed?.length && e.passed[e.passed.length - 1] === lv.passed).pop();
  if (!up) return null;
  const level = lv.passed;
  if (level <= shown) return null;
  const boss = (events || []).filter(e => e.type === 'boss' && e.sessionId === up.sessionId).pop() ?? null;
  return {
    kind: boss ? 'boss' : 'levelup', level, from: up.from, passed: up.passed.slice(), done: !!up.done,
    name: up.toName, fromName: up.fromName ?? null, sessionId: up.sessionId,
    title: boss?.title ?? null, bossName: boss?.bossName ?? null, bossLevel: boss?.level ?? null,
  };
}

/** A level taken back, or null when there is nothing to take back.

    The high-water mark (`best`) is a floor the engine never lowers, so that
    a changed ladder or a lost phone cannot cost a team a level. But it is
    written the moment a run passes, and a debrief saved with yesterday's
    answer still in a sticky row passes a level that the handler puts right
    a minute later: the board then showed a level whose only try read
    "Missed". So when the run in hand is the very one that set the mark
    (`runEnd` is its end, which is what the mark is dated by) and the record
    without the floor (`free`, teamLevel with best: null) no longer reaches
    it, the mark comes down to what the record shows. `shown` comes down
    with it, so the real pass is celebrated when it comes, and `resetAt`
    says this was done on purpose (sync-core.js mergeTeams). A mark set by
    any other run, or from before the team was last placed, is left alone. */
export function takenBack(team, free, runEnd, now) {
  const b = team?.best;
  if (!b || !(b.level > 0) || !Number.isFinite(b.at) || b.at !== runEnd) return null;
  if (Number.isFinite(team.placedAt) && b.at < team.placedAt) return null;
  if (!free?.best || !(free.best.level < b.level)) return null;
  return { ...team, best: { v: free.best.v, level: free.best.level, at: free.best.at },
    shown: Math.min(shownLevel(team), free.best.level), resetAt: now };
}

/** The team as it stood before a moment's run: what the board is put back
    to, so the moment can be played forward from it. */
export function beforeMoment(lv, m) {
  return { passed: m.from - 1, level: m.from, done: false, placement: lv?.placement ?? null, easeOff: null, counted: null };
}

/** How a list of levels reads: "Level 8", "Levels 8 and 9", "Levels 8 to 10". */
export const levelsSaid = (ns) => (ns.length === 1 ? `Level ${ns[0]}` : ns.length === 2 ? `Levels ${ns[0]} and ${ns[1]}` : `Levels ${ns[0]} to ${ns[ns.length - 1]}`);

/**
 * The one line under a run's result: { kind, mark, text } or null when the
 * run is nobody's try. kind: 'up' (it passed a level), 'yes' (it counts and
 * passed nothing new), 'miss', 'no' (not counted). `tryRec` is the run's
 * row among the team's last tries, if it is still one of them.
 */
export function resultLine(tryRec, events, { imperial = false, noLine = false } = {}) {
  const up = (events || []).find(e => e.type === 'levelUp');
  if (up && up.passed?.length) {
    const boss = (events || []).filter(e => e.type === 'boss').pop();
    return { kind: 'up', mark: '★', text: `${levelsSaid(up.passed)} passed · ${boss ? `${up.toName} · ${boss.title}` : up.toName}` };
  }
  if (!tryRec) return null;
  const kind = TRY_KIND[tryRec.verdict] ?? 'no';
  const why = plainWhy(tryRec.why, { imperial, noLine }).replace(/^(Passed|Missed|Not counted):\s*/, '');
  const says = kind === 'yes' ? 'Counts' : TRY_SAYS[kind];
  return { kind, mark: TRY_MARK[kind], text: why ? `${says}: ${why}` : says };
}

/* ── The states, in plain words ───────────────────────────────────────
   Each is something the engine has worked out and the handler should hear
   once, on the card: never a penalty, always what to do next. */

const runs = (n) => `${n} counted run${n === 1 ? '' : 's'}`;

export function teamStates(lv, { imperial = false, fahrenheit = false, dogName = 'The dog' } = {}) {
  if (!lv) return [];
  const out = [];
  const say = (key, tone, title, text, action = null) => out.push({ key, tone, title, text, action });
  if (lv.done) say('done', 'gold', 'Every level passed', 'All 100 stones carry your paw.');

  /* One instruction at a time. Each pair below used to be shown together
     and said two different things: stay at this level and it is too soon for
     this level; start five lower and run the level five lower; run an easier
     one next and nothing more counts today. */
  const p = lv.placement;
  const c = lv.counted;
  const capped = !!c && c.today > 0 && c.left === 0;
  if (p?.state === 'pending' && !lv.gate) {
    say('placement', 'info', 'Placement check',
      `You started at level ${p.startLevel}. Pass it within your next ${runs(p.triesLeft)} to stay here.`);
  } else if (p?.state === 'suggest') {
    say('placement', 'warn', 'Start a little lower?',
      `${RULES.placementTries} counted runs at level ${p.startLevel} without a pass. Level ${p.suggest} would suit better for now. Nothing is lost.`,
      { id: 'placeLower', label: `Start at level ${p.suggest}`, level: p.suggest });
  }
  if (lv.easeOff && p?.state !== 'suggest') {
    say('easeOff', 'warn', 'Ease off', capped
      ? `${lv.easeOff.misses} misses in a row. End on an easy find for fun; it will not count today.`
      : `${lv.easeOff.misses} misses in a row. Run level ${lv.easeOff.suggest} next, so the day ends on a find.`);
  }
  if (lv.rusty) {
    const d = lv.rusty.days;
    say('rusty', 'info', 'Rusty',
      `${Number.isFinite(d) ? `${d} days` : 'A while'} since a counted run. One pass at level ${lv.rusty.suggest} clears it.`);
  }
  if (lv.heat) {
    const limit = fmtTemp(RULES.heatC, fahrenheit);
    say('heat', 'warn', 'Hot day',
      `${fmtTemp(lv.heat.tempC, fahrenheit)} on the last run, above ${limit}. Keep it short, with shade and water.`
      + (lv.heat.bossWaits ? ' The boss waits for a cooler run.' : ''));
  }
  if (lv.gate) {
    say('gate', 'info', 'Not yet, for the dog’s sake',
      `Level ${lv.gate.level} is for dogs from ${lv.gate.needMonths} months. ${dogName} is ${lv.gate.months}.`);
  }
  if (c && c.today > 0) {
    if (capped) {
      say('cap', 'warn', 'Enough for today',
        `${runs(c.today)} today, and ${c.max} is the limit.${lv.easeOff && p?.state !== 'suggest' ? '' : ' Any more today is play: it will not count.'}`);
    } else {
      say('cap', 'quiet', 'Today', `${runs(c.today)} today, ${c.left} more can count.`);
    }
  }
  return out.map(s => ({ ...s, text: inUnits(s.text, imperial) }));
}

/* ── The debrief's two level rows ─────────────────────────────────────
   Shaped like debrief.js's own fields so one template draws them all. They
   live here because debrief.js cannot read the ladder without the ladder
   reading it back. Both are sticky: a team starts the same way all morning. */

const START_FIELD = Object.freeze({
  id: 'start', label: 'Start', sticky: true, tag: 'for the level',
  why: 'What the dog had to start from. The level asks for it, and only you saw it.',
  options: STARTS.map(s => ({ v: s.id, label: s.label })),
});
const SETTING_FIELD = Object.freeze({
  id: 'setting', label: 'Setting', sticky: true, tag: 'for the level',
  why: `Where the trail ran. Asked from level ${SETTING_FROM}.`,
  options: SETTINGS.map(s => ({ v: s.id, label: s.label })),
});
export const LEVEL_FIELDS = Object.freeze([START_FIELD, SETTING_FIELD]);

/* How long ago a runaway's person left, asked again on the debrief of a run
   with no laid trail: it is that run's only age, the Blind trail screen asks
   it before the run where it is easy to miss, and without it the run could
   never be made to count. Its answer is a number kept on the run itself
   (data.leftAgoMin), not in the debrief; the row only borrows the template. */
export const LEFT_AGO = Object.freeze([0, 1, 2, 3, 4, 5, 8, 10]);
export const leftAgoLabel = (m) => (m === 0 ? 'Just now' : `${m} min ago`);
export const LEFT_FIELD = Object.freeze({
  id: 'leftAgo', label: 'The person left', sticky: false, tag: 'for the level',
  why: 'How long before the dog was let go. With no laid trail, it is the only age this run has.',
  options: LEFT_AGO.map(m => ({ v: String(m), label: leftAgoLabel(m) })),
});

/** The rows to ask on this run's debrief. `level` is the level the run was
    a try at (its stamp), or the team's own when it carries none; null means
    no team ran it, and nothing is asked. A row already answered stays, so an
    old answer can still be seen and changed. `noLine`: the run has no laid
    trail (a runaway nobody recorded), which only Hot allows. */
export function levelFields(level, debrief = null, { noLine = false } = {}) {
  const out = [];
  const on = Number.isInteger(level);
  if (on || debrief?.start) out.push(START_FIELD);
  if (on && noLine && levelSpec(level)?.stage === 'hot') out.push(LEFT_FIELD);
  if ((on && level >= SETTING_FROM) || debrief?.setting) out.push(SETTING_FIELD);
  return out;
}

/** The debrief rows a run must have answered to count as a try at `level`,
    by id, in the order to ask them. The engine refuses a run without them
    ("not answered in the debrief"), so the debrief has to ask for them as
    plainly as it asks for the outcome: Start at every level, the help given
    once the coach is off, who knew the route once the level is run blind,
    the setting at the levels that name one (the row is offered from level
    66, and sticky), and a runaway's age once the level wants one. */
export function levelNeeds(level, { noLine = false } = {}) {
  const spec = levelSpec(level);
  if (!spec) return [];
  const out = ['start'];
  if (noLine && spec.stage === 'hot' && spec.ageMin > 0) out.push('leftAgo');
  if (spec.coachOff) out.push('help');
  if (spec.blind) out.push('blind');
  if (spec.setting) out.push('setting');
  return out;
}

/** A fresh debrief's level answers, carried over from the handler's last. */
export function stickyLevel(fields, last) {
  const out = {};
  for (const f of fields || []) if (f.sticky && last?.[f.id] && f.options.some(o => o.v === last[f.id])) out[f.id] = last[f.id];
  return out;
}

/** The same, looked for further back: each sticky level row takes the
    answer from the newest of this handler's own runs that has one, this
    dog's before any other's. The handler's single newest debrief is not
    enough here: after a hide search, or a trail with a dog that is not a
    team, it has no Start at all, the next team trail opened with Start
    blank, and nothing counts without it. `sessions` are newest first. */
export function stickyLevelFrom(sessions, session, fields) {
  const out = {};
  const want = (fields || []).filter(f => f.sticky);
  if (!want.length || !session?.handlerId) return out;
  for (const sameDog of [true, false]) {
    for (const x of sessions || []) {
      if (want.every(f => f.id in out)) return out;
      if (!x || x.id === session.id || x.handlerId !== session.handlerId || !ownRun(x)) continue;
      if (sameDog && x.dogId !== session.dogId) continue;
      const d = x.data?.debrief;
      if (!d) continue;
      for (const f of want) if (!(f.id in out) && d[f.id] && f.options.some(o => o.v === d[f.id])) out[f.id] = d[f.id];
    }
  }
  return out;
}

/* ── The stamp on a run ───────────────────────────────────────────── */

/** What a run about to start is a try at. Null once every level is passed,
    or when nobody is a team: the run is then simply a run. */
export const tryStamp = (lv) => (lv && !lv.done ? { v: lv.v, level: lv.level } : null);
