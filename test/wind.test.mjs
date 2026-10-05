/* One wind per moment on every map screen.

   The plume, the band and the coach on the run, replay and show-on-map
   screens are drawn in the wind of the moment shown. The wind panel, the
   compass arrow and the air streaks went on showing the wind the trail was
   laid in, so one screen could show two winds blowing opposite ways. The
   panel's code is lifted out of app.js and run here against small fakes of
   the page, as screens.test.mjs does, and these are walked through:

   - a screen about a run shows that run's wind, labelled with its own time;
   - the replay's panel follows its clock, but is not redrawn every frame;
   - a slow forecast for the air here lands only on the screen that asked;
   - the laid-time weather arriving late during a run is drawn at the run's
     moment, and gives the coach its scent;
   - a shared run carries the run's own weather to whoever opens it;
   - air here taken for a run with none of its own only stands in, and the
     trail's own forecast comes first once it lands. */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { windAt, laidWind, feltPanel, feltWeather, feltOf, forecastAt, seriesCovers, windFeltFor, WIND_FELT_V } from '../public/field.js';
import { cardinal, fmtSpeed, fmtTemp, forecastNote, fmtDur } from '../public/geo.js';
import { unwalkedPlan, noLineYet } from '../public/debrief.js';
import { trailModel, encodeShared, decodeShared, sessionFromModel } from '../public/share.js';

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

function fakeEl() {
  return { hidden: false, textContent: '', style: {}, classList: { toggle() {} }, setAttribute() {} };
}

/* A trail laid at 08:00 in a westerly that has swung round to an easterly by
   the time the dog runs at 09:30, all inside the laid forecast's series. */
const T0 = Date.UTC(2026, 8, 25, 8, 0);
const RUN = T0 + 90 * 60e3;
const dirAt = (min) => (min < 60 ? 270 : 90);
const laidWx = {
  time: '2026-09-25T08:00', temp: 11, soil_temp: 10, wind_speed: 3, wind_direction: 270,
  series: [0, 15, 30, 45, 60, 75, 90, 105, 120].map(m => ({ t: T0 + m * 60e3, temp: 11, soil_temp: 10,
    wind_speed: 3 + m / 60, wind_direction: dirAt(m) })),
};
const ranSession = () => ({ id: 'ran', startedAt: T0, targetId: 'person',
  data: { weather: laidWx, trackStarted: RUN } });

/* The panel, the forecast for here, and the answer that decides between them. */
function panel() {
  const els = new Map();
  const asks = [];
  const sb = {
    $: (id) => { if (!els.has(id)) els.set(id, fakeEl()); return els.get(id); },
    window: {},
    MAP_SCREENS: ['scrLay', 'scrDraw', 'scrRun', 'scrShowMap', 'scrReplay'],
    currentScreen: 'scrReplay',
    fmtWind: (ms) => fmtSpeed(ms), cardinal, fahr: () => false, fmtTemp, forecastNote,
    compass: {}, paintRose() {}, wxGap() {}, paintWxFelt() {}, feltPanel,
    air: { wx: null }, airStart(wx) { sb.air.wx = wx; },
    windAt, laidWind, feltWeather, feltOf, forecastAt, seriesCovers, lastFix: null, WX_WAIT: 10000,
    run: { session: null, startedAt: 0 }, rec: { on: false, kind: null },
    runAirChanged: (s) => { sb.changed = (sb.changed ?? 0) + 1; sb.weatherPanelFor(s, sb.run.startedAt); },
    navigator: { geolocation: { getCurrentPosition: (res) => res({ coords: { latitude: 51.2, longitude: -2.6 } }) } },
    // Each ask for the air here waits until the test answers it.
    fetchWeather: () => new Promise((res) => asks.push(res)),
  };
  vm.createContext(sb);
  vm.runInContext([
    between('const wxNow = ', '\nfunction weatherHere('),
    'var wxWatch = null;',
    between('const wxShown = ', 'function showWeather('),
    decl('function showWeather('),
    decl('function followWeather('),
    decl('function weatherHere('),
    decl('async function askWeatherHere('),
    decl('function weatherPanelFor('),
    decl('function adoptHere('),
  ].join('\n'), sb);
  const shown = () => ({ dir: sb.$('wxDir').textContent, note: sb.$('wxNote').textContent, air: sb.air.wx });
  const gen = () => vm.runInContext('wxShown.gen', sb);
  const settle = () => new Promise(r => setTimeout(r, 0));
  return { sb, asks, shown, gen, settle };
}

await t('a run’s screen shows the run’s wind, labelled with the run’s time, and streaks in the same air', () => {
  const p = panel();
  p.sb.weatherPanelFor(ranSession(), RUN);
  const s = p.shown();
  assert.equal(s.dir, 'from E', 'the laid-time westerly was shown beside a plume in the easterly');
  assert.equal(s.note, forecastNote(RUN), 'the run’s wind labelled with the hour the trail was laid');
  assert.equal(s.air.wind_direction, 90, 'the streaks in the same air as the panel');

  p.sb.weatherPanelFor(ranSession(), null);
  assert.equal(p.shown().dir, 'from W', 'no moment given, as for a trail not run yet: the air it was laid in');
  assert.equal(p.shown().note, forecastNote('2026-09-25T08:00'));
});

await t('the replay’s panel follows its clock, and is only drawn again when it would read differently', () => {
  const p = panel();
  const s = ranSession();
  p.sb.weatherPanelFor(s, RUN);
  const before = p.gen();
  p.sb.followWeather(windAt(s, RUN).wx);
  p.sb.followWeather(windAt(s, RUN + 20).wx);
  assert.equal(p.gen(), before, 'the same wind in the same minute: nothing redrawn');
  p.sb.followWeather(windAt(s, T0 + 10 * 60e3).wx);
  assert.equal(p.shown().dir, 'from W', 'dragged back to before the change, the panel goes with it');
  assert.equal(p.shown().air.wind_direction, 270);
  assert.equal(p.gen(), before + 1);
  p.sb.followWeather(null);
  assert.equal(p.shown().dir, 'from W', 'no wind at a moment leaves the panel as it was');
});

await t('a slow forecast for the air here lands only on the screen that asked for it', async () => {
  const p = panel();
  p.sb.currentScreen = 'scrLay';
  p.sb.weatherPanelFor(null);
  assert.equal(p.sb.$('wxNote').textContent, 'Getting the forecast…');
  // Lay cancelled, and an old run opened on Replay while the forecast is out.
  p.sb.currentScreen = 'scrReplay';
  p.sb.weatherPanelFor(ranSession(), RUN);
  await p.settle();
  p.asks[0]({ time: '2026-09-26T15:00', wind_speed: 7, wind_direction: 0, temp: 18 });
  await p.settle();
  assert.equal(p.shown().dir, 'from E', 'today’s wind here replaced the run’s');
  assert.equal(p.shown().air.wind_direction, 90, 'and its streaks');
});

await t('two screens that want the air here share one ask, and the answer reaches the one now up', async () => {
  const p = panel();
  p.sb.currentScreen = 'scrLay';
  p.sb.weatherPanelFor(null);
  p.sb.currentScreen = 'scrDraw';
  p.sb.weatherPanelFor(null);
  await p.settle();
  assert.equal(p.asks.length, 1, 'one forecast asked for, not two');
  p.asks[0]({ time: '2026-09-26T15:00', wind_speed: 7, wind_direction: 0, temp: 18 });
  await p.settle();
  assert.equal(p.shown().dir, 'from N', 'Draw is left waiting on nothing');
  assert.equal(vm.runInContext('wxNow.wx.wind_direction', p.sb), 0, 'kept as the air here for the next quarter hour');
  assert.equal(vm.runInContext('wxNow.asking', p.sb), null, 'and the next ask is free to go');
});

await t('laid weather arriving during a run is drawn at the run’s moment, and gives the coach its scent', () => {
  const now = Date.now();
  const start = now - 20 * 60e3, laidAt = now - 110 * 60e3;
  const wx = { time: 'laid', wind_speed: 3, wind_direction: 270, temp: 11,
    series: Array.from({ length: 10 }, (_, i) => ({ t: laidAt + i * 15 * 60e3, wind_speed: 3, temp: 11,
      wind_direction: laidAt + i * 15 * 60e3 < start - 30 * 60e3 ? 270 : 90 })) };
  const calls = { plume: [], panel: [], field: [] };
  const sb = {
    run: null, rec: { on: true, kind: 'run' }, currentScreen: 'scrRun', pendingSession: null,
    db: { updateSession: () => null }, snap() {}, windAt,
    targetById: () => ({ kind: 'person' }), trailOf: (s) => s.data.trail,
    plumeStart: (trail, w) => calls.plume.push(w),
    weatherPanelFor: (s, at) => calls.panel.push(at),
    scentField: (trail, w, at) => { calls.field.push([w.wind_direction, at]); return ['scent']; },
    coach: { trail: [{ lat: 51, lon: -2 }, { lat: 51.001, lon: -2 }], field: [] },
    $: () => fakeEl(), renderShare() {}, paintFeltSheet() {}, feltOf, windFeltFor, keepDraft() {},
  };
  vm.createContext(sb);
  vm.runInContext([decl('function keepWeather('), decl('function feltHeld('), decl('function runAirChanged('),
    between('const feltSubject = ', '\n\n')].join('\n'), sb);
  const live = () => ({ id: 'r1', targetId: 'person', data: { trail: sb.coach.trail } });

  sb.run = { session: live(), revealed: true, startedAt: start };
  sb.keepWeather('r1', wx);
  assert.equal(calls.plume.length, 1);
  assert.equal(calls.plume[0].wind_direction, 90, 'the revealed scent was drawn in the laid-time snapshot');
  assert.deepEqual(calls.field.at(-1), [90, start], 'the coach reasons in the wind the dog set off in');
  assert.deepEqual(sb.coach.field, ['scent'], 'a coach that began with no weather was left with no scent');
  /* The panel is refreshed on its own, at the run's start as the scent is:
     with the plume switched off in Settings nothing else would carry the new
     wind to it. */
  assert.deepEqual(calls.panel, [start], 'the panel follows the drawn moment even if no plume draws');

  sb.run = { session: live(), revealed: false, startedAt: start };
  calls.plume.length = 0;
  calls.panel.length = 0;
  sb.keepWeather('r1', wx);
  assert.equal(calls.plume.length, 0, 'a blind run draws no scent');
  assert.deepEqual(calls.panel, [start], 'the panel shows the run’s start, not the laid snapshot');
  sb.currentScreen = 'scrResult';
  sb.keepWeather('r1', wx);
  assert.equal(calls.panel.length, 1, 'and only while the run screen is up');
});

await t('the replay’s clock moves the panel with the plume', () => {
  const followed = [];
  const s = ranSession();
  s.targetId = 'article';
  s.data.hides = [{ lat: 51, lon: -2 }];
  s.data.track = [0, 30, 60].map(k => ({ lat: 51, lon: -2, t: RUN + k * 1000 }));
  const sb = {
    replay: { s, at: RUN + 30000, from: RUN, to: RUN + 60000 },
    setDogTrack() {}, setSrc() {}, pointsOf: () => ({}), plume: { sim: null, bandWalls: 0 },
    stability: () => 'neutral', windAt, followWeather: (w) => followed.push(w),
    scentField: () => [], plumePolygon: () => ({}), paintBandWalls() {}, EMPTY: {},
    trailOf: () => [], signedOffsets: () => [], targetById: () => ({ kind: 'hide' }),
    fmtM: String, fmtDur, unwalkedPlan, ageUnknown: () => '', bandWallNote: () => '', $: () => fakeEl(), document: { activeElement: null },
    feltPanel, windWords: () => null, imp: () => false, noLineYet,
  };
  vm.createContext(sb);
  vm.runInContext([decl('function marksOf('), decl('function paintReplay(')].join('\n'), sb);
  sb.paintReplay();
  assert.equal(followed.length, 1, 'the panel and streaks stayed on the laid-time wind as the replay ran');
  assert.equal(followed[0].wind_direction, 90);
});

await t('the run screen shows the wind the dog set off in from the first frame', () => {
  const start = decl('async function startRun(');
  assert.ok(start.indexOf('run.startedAt = Date.now();') > 0
    && start.indexOf('run.startedAt = Date.now();') < start.indexOf("go('scrRun');"),
    'the moment is set before the screen goes up and asks for its wind');
  assert.match(start, /weatherPanelFor\(s, run\.startedAt\);/);
  assert.ok(!/showWeather\(s\.data\.weather\)|airStart\(s\.data\.weather\)/.test(start),
    'the laid-time snapshot is not put back over it once the GPS is on');
  assert.ok(!/showWeather\(wx\);/.test(decl('function showOnMap(')),
    'show on map leaves its panel to go(), which knows the moment');
});

await t('a shared run carries the run’s own weather, and the one who opens it replays it in that wind', async () => {
  const laidAt = T0 - 26 * 3600e3;
  const runWeather = { time: '2026-09-25T09:30', wind_speed: 6, wind_direction: 90, temp: 9,
    series: Array.from({ length: 49 }, (_, i) => ({ t: RUN - 6 * 3600e3 + i * 15 * 60e3, wind_speed: 6, wind_direction: 90, temp: 9 })) };
  const trail = [{ lat: 51.2, lon: -2.6, t: laidAt }, { lat: 51.201, lon: -2.6, t: laidAt + 60e3 }];
  const track = [0, 60, 600].map(k => ({ lat: 51.2, lon: -2.6, t: RUN + k * 1000 }));
  const mine = { id: 's', startedAt: laidAt, targetId: 'person', data: {
    trail, track, trackStarted: RUN, trackWaypoints: [], contamination: [],
    weather: { ...laidWx, series: laidWx.series.map(e => ({ ...e, t: e.t - 26 * 3600e3 })) }, runWeather } };
  const m = await decodeShared(await encodeShared(trailModel(mine, {})));

  const theirs = sessionFromModel(m);
  const w = windAt(theirs, RUN);
  assert.equal(w.exact, true, 'the recipient had only the laid weather, a day before the run');
  assert.equal(w.wx.wind_direction, 90);
  assert.deepEqual(windAt(theirs, RUN).wx.wind_direction, windAt(mine, RUN).wx.wind_direction,
    'their replay and show on map in the same wind as the handler’s own');
});

await t('a run with no forecast of its own takes the air here, and the panel says the wind felt on it', async () => {
  /* A Trail Card scanned and run at once: no laid weather yet. The handler
     has said it is calm on the ground. */
  const START = Date.UTC(2026, 8, 26, 14, 0);
  const calm = { v: WIND_FELT_V, mode: 'calm', at: START + 60e3 };
  const here = (from) => ({ time: '2026-09-26T14:00', wind_speed: 6, wind_direction: 200, temp: 15,
    series: [0, 1, 2, 3].map(i => ({ t: from + i * 15 * 60e3, wind_speed: 6, wind_direction: 200, temp: 15 })) });
  const card = () => ({ id: 'card', targetId: 'person', startedAt: T0,
    data: { trail: [{ lat: 51.2, lon: -2.6 }], weather: null, windFelt: calm } });

  const p = panel();
  const live = card();
  Object.assign(p.sb, { currentScreen: 'scrRun' });
  Object.assign(p.sb.run, { session: live, startedAt: START });
  Object.assign(p.sb.rec, { on: true, kind: 'run' });
  p.sb.weatherPanelFor(live, START);
  await p.settle();
  const wx = here(START - 15 * 60e3);
  p.asks[0](wx);
  await p.settle();
  assert.deepEqual({ ...live.data.runWeather }, { ...wx, standIn: 1 }, 'the run’s forecast now, marked as only standing in');
  assert.equal(p.sb.changed, 1, 'and everything on the run screen drawn again in it');
  assert.equal(windAt(live, START).wx.wind_speed, 0, 'in the calm the handler felt');
  assert.deepEqual([p.shown().dir, p.sb.compass.wind], ['calm', null], 'a calm says so, with no arrow');

  /* Air here that does not reach the run's start is only shown, never kept,
     and still in the words of the wind felt on the ground. */
  const q = panel();
  const other = card();
  Object.assign(q.sb, { currentScreen: 'scrRun' });
  Object.assign(q.sb.run, { session: other, startedAt: START });
  Object.assign(q.sb.rec, { on: true, kind: 'run' });
  q.sb.weatherPanelFor(other, START);
  await q.settle();
  q.asks[0](here(START + 864e5));
  await q.settle();
  assert.equal(other.data.runWeather, undefined);
  assert.deepEqual([q.shown().dir, q.sb.compass.wind, q.sb.$('wxSpeed').textContent], ['calm', null, fmtSpeed(0)]);
});

await t('air here from before the phone lost signal only stands in for a run, and the trail’s own forecast comes first', async () => {
  /* The forecast for here, fetched at home five hours before a trail laid
     offline is run in a field with no signal. The phone hands back that last
     reading, and its twelve hours of series still reach the run's start. */
  const HOME = Date.UTC(2026, 8, 27, 9, 0), START = HOME + 5 * 3600e3;
  const home = { time: '2026-09-27T09:00', wind_speed: 4, wind_direction: 200, temp: 14,
    series: Array.from({ length: 49 }, (_, i) => ({ t: HOME + (i - 24) * 15 * 60e3, wind_speed: 4, wind_direction: 200, temp: 14 })) };
  const p = panel();
  let online = true;
  p.sb.fetchWeather = () => (online ? Promise.resolve(home) : Promise.reject(new Error('offline')));
  p.sb.currentScreen = 'scrLay';
  p.sb.weatherPanelFor(null);
  await p.settle();
  vm.runInContext('wxNow.at -= 5 * 3600e3', p.sb);
  online = false;
  const live = { id: 'r1', targetId: 'person', startedAt: START - 20 * 60e3,
    data: { trail: [{ lat: 51.3, lon: -2.9 }, { lat: 51.301, lon: -2.9 }], weather: null } };
  Object.assign(p.sb, { currentScreen: 'scrRun' });
  Object.assign(p.sb.run, { session: live, startedAt: START });
  Object.assign(p.sb.rec, { on: true, kind: 'run' });
  p.sb.weatherPanelFor(live, START);
  await p.settle();
  assert.equal(live.data.runWeather?.standIn, 1, 'taken for the screen, and marked as only standing in');
  assert.equal(windAt(live, START).wx.wind_direction, 200);
  assert.equal('standIn' in home, false, 'the reading kept for here is left as it was');

  /* The handler says the wind comes from the south, against the stand-in. */
  live.data.windFelt = windFeltFor({ ...live, data: { ...live.data, trackStarted: START } }, 180, START + 10 * 60e3);
  assert.equal(windAt(live, START).wx.wind_direction, 180);

  /* Signal comes back and the laid weather lands: an easterly for that
     place and time. It is read before the stand-in, and the direction the
     handler picked still blows from where they said. */
  const laid = { time: 'laid', wind_speed: 3, wind_direction: 90, temp: 11,
    series: Array.from({ length: 13 }, (_, i) => ({ t: START - 90 * 60e3 + i * 15 * 60e3, wind_speed: 3, wind_direction: 90, temp: 11 })) };
  const calls = { plume: [], panel: [] };
  const sb = {
    run: { session: live, revealed: true, startedAt: START }, rec: { on: true, kind: 'run' }, currentScreen: 'scrRun',
    pendingSession: null, db: { updateSession: () => null }, snap() {}, windAt, targetById: () => ({ kind: 'person' }),
    trailOf: (s) => s.data.trail, plumeStart: (tr, w) => calls.plume.push(w.wind_direction),
    weatherPanelFor: (s, at) => calls.panel.push(windAt(s, at).wx.wind_direction),
    scentField: () => [], coach: { trail: null, field: [] }, $: () => fakeEl(), renderShare() {}, paintFeltSheet() {},
    feltOf, windFeltFor, keepDraft() { calls.kept = (calls.kept ?? 0) + 1; },
  };
  vm.createContext(sb);
  vm.runInContext([decl('function keepWeather('), decl('function feltHeld('), decl('function runAirChanged('),
    between('const feltSubject = ', '\n\n')].join('\n'), sb);
  sb.keepWeather('r1', laid);
  assert.deepEqual(forecastAt(live, START), { wx: forecastAt({ data: { weather: laid } }, START).wx, exact: true },
    'the laid forecast, not the reading from home');
  assert.deepEqual([calls.plume, calls.panel], [[180], [180]], 'the plume and the panel from the south, as picked');
  assert.equal(live.data.windFelt.ref, 90, 'measured again against the laid forecast');
  assert.equal(calls.kept, 1, 'and kept in the crash copy');

  /* A link to the run says the same to whoever opens it. */
  const ran = { ...live, data: { ...live.data, weather: null, track: [{ lat: 51.3, lon: -2.9, t: START }, { lat: 51.301, lon: -2.9, t: START + 60e3 }],
    trackStarted: START, trackWaypoints: [], contamination: [] } };
  const theirs = sessionFromModel(await decodeShared(await encodeShared(trailModel(ran, {}))));
  assert.equal(theirs.data.runWeather.standIn, 1, 'still only standing in');
});

console.log(`\n${pass} passed total\n`);
