/* Getting around, run for real.

   The screens, the back arrow, the wind panel and the footprints' timer are
   glue inside app.js, which only runs with a map and a phone around it. So
   the very code is lifted out of app.js and run here in a sandbox, with the
   phone's history, the page and the map as small fakes, and the flows that
   went wrong are walked through:

   - a screen's own Done, Save or Back went FORWARD, so the arrow on the page
     it returned to led straight back into the screen just closed (Settings
     and the bench sent you to each other for ever);
   - laying or drawing a trail showed the last run's saved wind as today's;
   - leaving "Scan walked card" by the top arrow left the scan waiting for a
     walked card, so every later Trail Card was refused;
   - an emptied map kept its footprint count, and the timer that makes them
     breathe repainted the map all through a blind run;
   - in the iPhone app the coach's calls cannot play with the screen dark,
     which the app did not say and did nothing about. */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { stepPoints, forecastNote } from '../public/geo.js';

let pass = 0;
const t = async (name, fn) => { await fn(); pass++; console.log(`  ok  ${name}`); };

const js = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

/** app.js from one marker up to (not including) the next. */
function between(from, to) {
  const i = js.indexOf(from);
  const j = js.indexOf(to, i + from.length);
  assert.ok(i >= 0 && j > i, `app.js still has ${from.trim().slice(0, 40)}`);
  return js.slice(i, j);
}

/** A top-level declaration, from its head to the brace that closes it at the margin. */
function decl(head) {
  const i = js.indexOf(`\n${head}`);
  assert.ok(i >= 0, `app.js still has ${head}`);
  const end = js.slice(i + 1).search(/\n\};?\n/);
  return js.slice(i + 1, i + 1 + end + 3);
}

/** The function handed to a call, as written: `$('x').addEventListener('click', <this>)`.
    Read bracket by bracket, stepping over strings and comments. `at` picks
    one call of several with the same head. */
function argFn(head, at = js.indexOf(head)) {
  const i = at;
  assert.ok(i >= 0 && js.startsWith(head, i), `app.js still has ${head}`);
  let k = i + head.length, depth = 0;
  for (; k < js.length; k++) {
    const c = js[k];
    if (c === '/' && js[k + 1] === '/') { k = js.indexOf('\n', k); continue; }
    if (c === '/' && js[k + 1] === '*') { k = js.indexOf('*/', k) + 1; continue; }
    if (c === "'" || c === '"' || c === '`') {
      for (k++; js[k] !== c; k++) if (js[k] === '\\') k++;
      continue;
    }
    if ('({['.includes(c)) depth++;
    else if (')}]'.includes(c)) { if (!depth) break; depth--; }
  }
  return js.slice(i + head.length, k);
}
const onClick = (id) => argFn(`$('${id}').addEventListener('click', `);

/** An element that takes whatever the code does to it. */
function fakeEl() {
  return {
    hidden: false, textContent: '', value: '', innerHTML: '', dataset: {}, style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], scrollIntoView() {},
  };
}

/** The phone's history: forward entries, and Back that fires popstate. */
function fakeHistory() {
  const h = {
    entries: [{ state: null }], i: 0, onPop: null,
    get state() { return h.entries[h.i].state; },
    pushState(state) { h.entries.length = h.i + 1; h.entries.push({ state }); h.i++; },
    back() { if (h.i > 0) { h.i--; h.onPop?.(); } },
  };
  return h;
}

/* The screens, the arrow and the close buttons, with everything they call
   that draws or fetches replaced by a note of what was asked. */
function app() {
  const els = new Map();
  const history = fakeHistory();
  const air = [];
  const airAt = [];
  const sessions = new Map();
  const viewport = { content: 'width=device-width,initial-scale=1,viewport-fit=cover' };
  const sb = {
    $: (id) => { if (!els.has(id)) els.set(id, fakeEl()); return els.get(id); },
    history,
    window: { addEventListener: (type, f) => { if (type === 'popstate') history.onPop = f; } },
    document: { visibilityState: 'visible', querySelector: (q) => (q === 'meta[name="viewport"]' ? viewport : null) },
    toast() {}, snap() {}, boot() {},
    rec: { on: false, kind: null, hides: [], wx: null },
    run: { session: null }, pendingSession: null,
    replay: { s: null }, fixer: { s: null }, contam: { forSession: null },
    sessionById: (id) => sessions.get(id) ?? null,
    scan: { gen: 0 }, stopScan() {}, scanWalkedFor: null, scanCameFrom: 'scrPick',
    renderHome() {}, renderSessions() {}, renderSettings() {}, renderResult() {}, paintPick() {},
    handlerCardId: null, dogCardId: null, paintHandlerCard() {}, paintDogCard() {},
    map: { resize() {}, off() {}, getCanvas: () => ({ style: {} }) },
    weatherPanelFor: (s, at) => { air.push(s); airAt.push(at); },
    mapChromeShow() {}, stepsRun() {}, airStop() {}, hideWeather() {},
    db: { kv: { get: () => true, set() {} }, sessions: () => [...sessions.values()] },
    mapTut: { open: false }, openMapTut() {},
    closeShared() {}, closeLive() {}, closeBench() {}, closeReplay() {}, closeFix() {}, closeDraw() {},
    closeContam() {}, plumeStop() {}, stopCountdownUi() {}, setSrc() {}, EMPTY: {}, onHideTap() {},
    CD: { sid: 's1' }, renderShare() {},
    // The real openers draw a screen and then go() to it; that last step is what matters here.
    openDebrief: (s) => { sb.dbFor = s; sb.dbDraft = { flags: [] }; sb.dbSeen = {}; sb.go('scrDebrief'); },
    openPick: () => sb.go('scrPick'),
    dbFor: null, dbDraft: null, dbSeen: null, shareOutFrom: 'scrResult', signInFirstLaunch: false,
    S: { handler: null }, DEBRIEF: [], debriefDone: () => true, cleanSeen: () => null,
    guardSave: (s, f) => f(), saveSession: (s) => s, paintDebrief() {},
  };
  vm.createContext(sb);
  const src = [
    between('/* ── Screens', '/* ── Map ──'),
    decl('function leaveForm('),
    decl('function backToResult('),
    decl('function saveDebrief('),
    decl('async function openScan('),
    ...['benchDone', 'repBack', 'repDebrief', 'dbCancel', 'fixCancel', 'btnSessBack', 'btnShareOutBack',
      'btnDeleteCancel', 'btnSkipSignIn', 'btnScanBack', 'btnScanWalked', 'scrDebrief', 'cdBack']
      .map(id => `var on_${id} = ${onClick(id)};`),
    'var where = () => ({ screen: currentScreen, stack: [...navStack] });',
  ].join('\n');
  vm.runInContext(src, sb);
  const click = (id, e) => sb[`on_${id}`](e);
  return { sb, air, airAt, sessions, viewport, click, where: () => sb.where().screen, go: sb.go, arrow: sb.goBack };
}

/** Home → Settings → Sessions → one run's result: the usual way to an old run. */
function atResult(a) {
  a.go('scrHome'); a.go('scrSettings'); a.go('scrSessions'); a.go('scrResult');
}

await t('Done on the bench returns to Settings, and the arrow there goes home, not back to the bench', () => {
  const a = app();
  a.go('scrHome'); a.go('scrSettings'); a.go('scrBench');
  a.click('benchDone');
  assert.equal(a.where(), 'scrSettings');
  a.arrow();
  assert.equal(a.where(), 'scrHome', 'the arrow led back into the bench just closed');
});

await t('a saved debrief returns to the result, and the arrow there leads on, not back into the form', () => {
  const a = app();
  atResult(a);
  a.sb.openDebrief({ id: 's1', data: {} });
  a.sb.saveDebrief();
  assert.equal(a.where(), 'scrResult');
  assert.equal(a.sb.dbDraft, null);
  a.arrow();
  assert.equal(a.where(), 'scrSessions', 'the arrow led back into the saved debrief');
});

await t('a closed debrief still on screen ignores a tap instead of throwing', () => {
  const a = app();
  a.sb.dbDraft = null;
  const pick = { dataset: { pick: 'effort', v: 'good' } };
  const e = { target: { closest: (sel) => (sel === '[data-pick]' ? pick : null) } };
  assert.doesNotThrow(() => a.click('scrDebrief', e));
});

await t('Not now on a debrief opened from a replay lands on the result, and the arrow leads on', () => {
  const a = app();
  atResult(a);
  a.go('scrReplay');
  a.sb.replay.s = { id: 's1', data: {} };
  a.click('repDebrief');
  assert.equal(a.where(), 'scrDebrief');
  a.click('dbCancel');
  assert.equal(a.where(), 'scrResult');
  a.arrow();
  assert.equal(a.where(), 'scrSessions', 'neither the closed replay nor the debrief is gone back to');
});

await t('Done on a replay, Cancel on a correction, Back from sharing: the arrow never returns to them', () => {
  for (const [enter, close] of [['scrReplay', 'repBack'], ['scrFix', 'fixCancel'], ['scrShareOut', 'btnShareOutBack']]) {
    const a = app();
    atResult(a);
    a.go(enter);
    a.click(close);
    assert.equal(a.where(), 'scrResult', `${close} returns to the result`);
    a.arrow();
    assert.equal(a.where(), 'scrSessions', `the arrow after ${close} led back into ${enter}`);
  }
});

await t('Back from the session list, Keep my account, and Not now on sign-in: one press of the arrow goes home', () => {
  for (const [enter, close] of [['scrSessions', 'btnSessBack'], ['scrDelete', 'btnDeleteCancel'], ['scrSignIn', 'btnSkipSignIn']]) {
    const a = app();
    a.go('scrHome'); a.go('scrSettings'); a.go(enter);
    a.click(close);
    assert.equal(a.where(), 'scrSettings', `${close} returns to Settings`);
    a.arrow();
    assert.equal(a.where(), 'scrHome', `after ${close}, the arrow on Settings did not go home`);
  }
});

await t('Back on the countdown returns to sharing, and the arrow there goes home, not into a stopped countdown', () => {
  const a = app();
  a.sessions.set('s1', { id: 's1', data: {} });
  a.go('scrHome'); a.go('scrShare'); a.go('scrCountdown');
  a.click('cdBack');
  assert.equal(a.where(), 'scrShare');
  assert.ok(!a.sb.where().stack.includes('scrCountdown'), 'the stopped countdown is not in the history');
  a.arrow();
  assert.equal(a.where(), 'scrHome', 'the arrow led back into the countdown just closed');
});

await t('Back from the scanner returns to Pick, and the arrow there goes home', () => {
  const a = app();
  a.go('scrHome'); a.go('scrPick');
  a.sb.openScan('scrPick');
  assert.equal(a.where(), 'scrScan');
  a.click('btnScanBack');
  assert.equal(a.where(), 'scrPick');
  a.arrow();
  assert.equal(a.where(), 'scrHome');
});

await t('a walked-card scan left by the top arrow is over: the next scan takes any card', () => {
  const a = app();
  atResult(a);
  a.sb.run.session = { id: 'plan1', data: {} };
  a.click('btnScanWalked');
  assert.equal(a.where(), 'scrScan');
  assert.equal(a.sb.scanWalkedFor, 'plan1', 'the scan knows which plan it is for');
  a.arrow();                               // the top arrow, not the Back button under the camera
  assert.equal(a.where(), 'scrResult');
  assert.equal(a.sb.scanWalkedFor, null, 'the scan still waited for plan1’s walked card');
  a.go('scrHome'); a.go('scrPick');
  a.sb.openScan('scrPick');
  assert.equal(a.sb.scanWalkedFor, null, 'a fresh scan inherited the old purpose');
});

await t('laying, drawing and walking show the air here now, never the last run’s saved wind', () => {
  const a = app();
  const old = { id: 'old', data: { weather: { wind_speed: 6, wind_direction: 200, time: '2026-09-20T14:00' } } };
  a.sb.run.session = old;                  // a run finished, or opened from the list, earlier today
  a.go('scrHome');
  for (const id of ['scrLay', 'scrDraw', 'scrWalk']) {
    a.air.length = 0;
    a.go(id);
    assert.deepEqual(a.air, [null], `${id} showed the old trail’s wind`);
    a.go('scrHome');
  }
});

await t('each other map screen shows the air of the trail it is about', () => {
  const a = app();
  const s = (id) => ({ id, data: { weather: { wind_speed: 1, time: '2026-09-20T09:00' } } });
  const run = s('run'), contam = s('contam'), rep = s('rep'), fix = s('fix'), stale = s('stale');
  a.sessions.set('contam', contam);
  a.sb.run.session = stale;
  a.sb.contam.forSession = 'contam';
  a.sb.replay.s = rep;
  a.sb.fixer.s = fix;
  const shown = (id) => { a.go('scrHome'); a.air.length = 0; a.go(id); return a.air[0]; };
  assert.equal(shown('scrContam'), contam, 'contamination: the trail being contaminated');
  assert.equal(shown('scrReplay'), rep);
  assert.equal(shown('scrFix'), fix);
  a.sb.run.session = run;
  assert.equal(shown('scrRun'), run);
  assert.equal(shown('scrShowMap'), run);

  // Confirming a lay: that lay's own forecast, fetched at its first fix; a hide set has none.
  const wx = { wind_speed: 3, time: '2026-09-24T10:00' };
  Object.assign(a.sb.rec, { kind: 'lay', wx });
  assert.equal(shown('scrConfirm')?.data?.weather, wx);
  Object.assign(a.sb.rec, { kind: 'hide', wx });
  assert.equal(shown('scrConfirm'), null);
  assert.equal(shown('scrBench'), undefined, 'the bench brings its own weather from the dials');
});

await t('each map screen about a run shows the wind at the moment it is about, not the laid-time wind', () => {
  /* The plume, the band and the coach on these screens are drawn in the wind
     of their own moment. The panel, the arrow and the streaks were handed
     the session alone, so they showed the wind the trail was laid in. */
  const a = app();
  const T = Date.UTC(2026, 8, 25, 9, 30);
  const wx = { wind_speed: 2, time: '2026-09-25T08:00' };
  const ran = { id: 'ran', data: { weather: wx, trackStarted: T } };
  const laid = { id: 'laid', data: { weather: wx } };
  const moment = (id) => { a.go('scrHome'); a.air.length = 0; a.airAt.length = 0; a.go(id); return a.airAt[0]; };

  a.sb.replay.s = ran;
  a.sb.replay.at = T + 7 * 60e3;
  assert.equal(moment('scrReplay'), T + 7 * 60e3, 'the replay: its own clock');

  a.sb.run.session = ran;
  assert.equal(moment('scrShowMap'), T, 'show on map, for a run: the moment the dog set off');
  a.sb.run.session = null;
  a.sb.pendingSession = laid;
  assert.equal(moment('scrShowMap'), null, 'show on map, for a trail not run yet: the air it was laid in');

  Object.assign(a.sb.run, { session: ran, startedAt: T, airAt: T });
  assert.equal(moment('scrRun'), T, 'the run screen: the start of the run');
  a.sb.run.airAt = T + 12 * 60e3;
  assert.equal(moment('scrRun'), T + 12 * 60e3, 'and once Reveal has drawn the scent, the moment it was drawn');
  a.sb.run.session = null;
  assert.equal(moment('scrRun'), null, 'a trail waiting on the run screen with no run yet: its laid-time air');
  assert.equal(moment('scrLay'), null);
});

await t('a new lay forgets the last lay’s forecast', () => {
  assert.match(decl('function startLay('), /rec\.wx = null;/);
});

await t('a forecast from another day carries its date; one from today only its time', () => {
  const now = new Date(2026, 8, 24, 16, 30).getTime();
  const hm = (d) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const today = new Date(2026, 8, 24, 14, 0);
  assert.equal(forecastNote('2026-09-24T14:00', now), `10 m forecast, ${hm(today)}`);
  const before = new Date(2026, 8, 20, 14, 0);
  assert.equal(forecastNote('2026-09-20T14:00', now),
    `10 m forecast, ${before.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${hm(before)}`);
  assert.equal(forecastNote(undefined, now), '10 m forecast');
  assert.equal(forecastNote('not a time', now), '10 m forecast');
  assert.equal(forecastNote(today.getTime(), now), `10 m forecast, ${hm(today)}`, 'a moment read off the series');
  assert.match(js, /\$\('wxNote'\)\.textContent = forecastNote\(wx\.t \?\? wx\.time\);/, 'the panel uses it');
});

await t('an emptied map stops the footprints’ timer, and the next map screen does not restart it', () => {
  const timers = new Set();
  let next = 1;
  const sb = {
    stepPoints, EMPTY: { type: 'FeatureCollection', features: [] },
    MAP_SCREENS: ['scrRun', 'scrShowMap'], currentScreen: 'scrShowMap',
    settings: { trailStyle: 'steps' }, mapReady: false, map: null,
    lineOf: (pts) => ({ pts }), stepPalette: () => ({}),
    setInterval: () => { const id = next++; timers.add(id); return id; },
    clearInterval: (id) => { timers.delete(id); },
  };
  sb.srcData = { runner: sb.EMPTY, steps: sb.EMPTY, dog: sb.EMPTY };
  vm.createContext(sb);
  vm.runInContext([
    js.match(/\nconst STRIDE_M = .*\n/)[0], js.match(/\nconst LIT = .*\n/)[0],
    js.match(/\nconst steps = .*\n/)[0],
    decl('function stepsOf('), decl('function setTrail('), decl('function stepsPaint('),
    decl('function stepsTick('), decl('function stepsRun('), decl('function setSrc('), decl('const clearMap = '),
    'var api = { setTrail, clearMap, stepsRun, steps };',
  ].join('\n'), sb);
  const { setTrail, clearMap, stepsRun, steps } = sb.api;
  const line = Array.from({ length: 20 }, (_, i) => ({ lat: 51.2 + i * 0.00005, lon: -2.6, t: i * 1000 }));
  setTrail(line);
  assert.ok(steps.n > 0 && timers.size === 1, 'a trail on the map breathes');
  clearMap();
  assert.equal(steps.n, 0, 'the count went with the footprints');
  assert.equal(timers.size, 0, 'the timer stopped with them');
  stepsRun(true);                          // what go() does on the next map screen, a blind run's
  assert.equal(timers.size, 0, 'nothing to breathe, so nothing repaints');
});

await t('in the app the screen is held only while the coach is on, and let go when it goes off', async () => {
  const asked = [];
  const sb = {
    isNative: () => true, coach: { on: false }, rec: { on: true, lock: null, kind: 'run' },
    document: { visibilityState: 'visible' },
    navigator: { wakeLock: { request: async (kind) => {
      asked.push(kind);
      return { released: false, async release() { this.released = true; }, addEventListener() {} };
    } } },
  };
  vm.createContext(sb);
  vm.runInContext([decl('async function holdScreen('), decl('async function letScreenGo(')].join('\n'), sb);
  await sb.holdScreen();
  assert.equal(asked.length, 0, 'a blind run in the app records with the screen dark');
  sb.coach.on = true;
  await sb.holdScreen();
  assert.equal(asked.join(), 'screen', 'a coached run keeps the screen on, where its calls can play');
  const lock = sb.rec.lock;
  await sb.letScreenGo();
  assert.ok(lock.released && sb.rec.lock === null, 'and lets it go');
  sb.rec.kind = 'lay';
  await sb.holdScreen();
  assert.equal(asked.length, 1, 'a lay goes in the pocket, even with the coach left on by a run that never started');
  sb.isNative = () => false; sb.coach.on = false;
  await sb.holdScreen();
  assert.equal(asked.length, 2, 'a web recording holds it whatever the coach does');
});

await t('a coach call made while the app’s screen was dark is counted, and said once the screen is back', () => {
  const toasts = [], listeners = [];
  const sb = {
    isNative: () => true, coach: { missed: 0, sounds: null }, settings: {}, BUZZ: {},
    document: { visibilityState: 'hidden', addEventListener: (type, f) => listeners.push([type, f]) },
    navigator: {}, haptic() {}, coachSpeak() {}, coachPhrase: () => '', imp: () => false,
    holdScreen() {}, toast: (m) => toasts.push(m), setTimeout,
  };
  vm.createContext(sb);
  const head = "document.addEventListener('visibilitychange', ";
  const at = js.indexOf(`${head}() => {\n  if (document.visibilityState !== 'visible') return;\n  holdScreen();`);
  vm.runInContext([decl('function coachDeliver('), `${head}${argFn(head, at)});`].join('\n'), sb);
  sb.coachDeliver({ kind: 'off' });
  sb.coachDeliver({ kind: 'back' });
  assert.equal(sb.coach.missed, 2);
  sb.document.visibilityState = 'visible';
  const [[type, back]] = listeners;
  assert.equal(type, 'visibilitychange');
  back();
  assert.deepEqual(toasts, ['The screen was dark, so 2 coach calls could not play']);
  assert.equal(sb.coach.missed, 0, 'said once');
  back();
  assert.equal(toasts.length, 1);
  sb.isNative = () => false;
  sb.document.visibilityState = 'hidden';
  sb.coachDeliver({ kind: 'off' });
  assert.equal(sb.coach.missed, 0, 'a web page is not the app: nothing is claimed about it');
});

await t('a map screen holds the page at its own size, and the way back lets it be pinched again', () => {
  /* A page pinched on a map screen could not be pinched back: the map takes
     every touch. So every way onto a map screen caps the scale, and every way
     off it, the arrow and the phone's back gesture included, lifts the cap. */
  const a = app();
  const capped = () => /maximum-scale=1/.test(a.viewport.content);
  a.go('scrHome');
  assert.ok(!capped(), 'home can be pinched');
  a.go('scrReplay');
  assert.ok(capped(), 'a replay cannot');
  a.arrow();
  assert.equal(a.where(), 'scrHome');
  assert.ok(!capped(), 'back by the arrow, home can be pinched again');
  a.go('scrSettings'); a.go('scrBench');
  assert.ok(capped());
  a.sb.history.back();                         // the phone's own back gesture
  assert.equal(a.where(), 'scrSettings');
  assert.ok(!capped(), 'and by the back gesture');
  a.go('scrWait');
  assert.ok(!capped(), 'the waiting screen is paper too, whatever its colour');
  assert.equal(a.viewport.content.match(/maximum-scale/g)?.length ?? 0, 0, 'never stacked up');
  a.go('scrRun'); a.go('scrShowMap');
  assert.equal(a.viewport.content.match(/maximum-scale/g).length, 1, 'once, however many map screens in a row');
});

console.log(`\n${pass} passed total\n`);
