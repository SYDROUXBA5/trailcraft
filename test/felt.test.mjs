/* The wind on the ground: the handler's word put in place of the forecast's.

   A handler ran a trail with the wind on the ground blowing from the exact
   opposite side to the forecast, and every view of that run (the plume, the
   coach, the replay, the grade and what the dog's drift record learned) was
   built on the forecast. The correction is kept on the session as windFelt
   and laid over the forecast in field.js windAt, the one place every view
   reads a run's wind. These check the correction itself, where it travels
   (links, kept runs, crash copies, a second run), what it does to the drift
   record, and, by lifting the grade and the map code out of app.js as
   wind.test.mjs does, that every reader of a run's wind reads the same one. */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import {
  windAt, forecastAt, laidWind, feltWeather, cleanWindFelt, makeWindFelt, windFeltFor, feltMoment,
  feltTurn, windTrusted, nearestPoint, windWords, forecastSaid, CALM_MS, WIND_FELT_V, FLAT, stability, regime,
  feltPanel, FELT_POINTS, feltPicked, feltSame, sameFelt,
} from '../public/field.js';
import {
  createStore, teachesDrift, driftRows, rebankRows, runAgain, patchSession, targetById, APPROACH_V,
} from '../public/store.js';
import { packDraft, unpackDraft } from '../public/draft.js';
import { trailModel, encodeShared, decodeShared, sessionFromModel, keptSession, resultSentence, liveMeta, detailSections } from '../public/share.js';
import { mergeOne, RUN_FIELDS } from '../public/sync-core.js';
import { unwalkedPlan } from '../public/debrief.js';
import { predictedOffsets } from '../public/sim.js';
import { changed } from '../public/params.js';
import {
  lineCorrect, signedOffsets, meanSigned, medianAbs, sideShares, sideOfDrift, sideAgreement,
  approachToWind, bearing, dist, fmtDur, fmtShort,
} from '../public/geo.js';

let pass = 0;
const t = async (name, fn) => { await fn(); pass++; console.log(`  ok  ${name}`); };
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

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

const fakeBackend = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};

/* A trail laid at 08:00 in a forecast northerly, run an hour later. */
const T0 = Date.UTC(2026, 8, 20, 8, 0);
const RUN = T0 + 60 * 60e3;
const northerly = (over = {}) => ({
  time: '2026-09-20T08:00', temp: 12, soil_temp: 11, wind_speed: 4, wind_gusts: 7, wind_direction: 0,
  series: Array.from({ length: 16 }, (_, i) => ({ t: T0 - 30 * 60e3 + i * 15 * 60e3, temp: 12, soil_temp: 11,
    wind_speed: 4, wind_gusts: 7, wind_direction: 0 })),
  ...over,
});
const felt = (mode, extra = {}) => ({ v: WIND_FELT_V, mode, ref: 0, at: RUN, ...extra });

/* ── The correction ─────────────────────────────────────────────────── */

await t('cleanWindFelt keeps what the app writes and nothing else', () => {
  assert.deepEqual(cleanWindFelt({ v: 1, mode: 'from', from: 180, ref: 3.5, at: RUN }),
    { v: 1, mode: 'from', from: 180, ref: 3.5, at: RUN });
  assert.deepEqual(cleanWindFelt({ v: 1, mode: 'swirl', ref: 12, at: RUN, note: '<b>hi</b>', from: 90 }),
    { v: 1, mode: 'swirl', ref: 12, at: RUN }, 'a direction and a stranger’s key are dropped from a swirl');
  assert.deepEqual(cleanWindFelt({ v: 1, mode: 'calm', at: RUN }), { v: 1, mode: 'calm', at: RUN }, 'a calm needs no forecast');
  assert.deepEqual(cleanWindFelt({ v: 1, mode: 'forecast', ref: 400, at: RUN }), { v: 1, mode: 'forecast', at: RUN },
    'a ref that is no bearing is only lost where nothing turns by it');
  for (const bad of [
    null, undefined, 'from', 3, [], [felt('from', { from: 180 })],
    { mode: 'from', from: 180, ref: 0, at: RUN },                    // no version
    { v: 2, mode: 'from', from: 180, ref: 0, at: RUN },              // a newer build's
    felt('sideways'), felt('from', { from: 170 }), felt('from', { from: 360 }), felt('from', { from: -45 }),
    felt('from', { from: '180' }), felt('from', { from: NaN }), felt('from', { from: 180, ref: 360 }),
    felt('from', { from: 180, ref: -1 }), felt('from', { from: 180, ref: null }), felt('calm', { at: 'today' }),
    felt('calm', { at: Infinity }),
  ]) assert.equal(cleanWindFelt(bad), null, JSON.stringify(bad));
});

await t('the choices a handler makes, as they are kept', () => {
  assert.deepEqual(makeWindFelt('opposite', 10, RUN), { v: 1, mode: 'from', from: 180, ref: 10, at: RUN },
    'opposite is kept as the point it names, so it reads plainly later');
  assert.equal(makeWindFelt('opposite', 350, RUN).from, 180);
  assert.equal(makeWindFelt('opposite', 360, RUN).ref, 0, 'Open-Meteo’s 360 is north');
  assert.equal(makeWindFelt('opposite', 250, RUN).from, 90);
  assert.equal(makeWindFelt(100, 0, RUN).from, 90, 'a tapped bearing goes to its point of the compass');
  assert.equal(makeWindFelt(315, 0, RUN).from, 315);
  assert.equal(makeWindFelt('opposite', null, RUN), null, 'no forecast direction: nothing to be opposite to');
  assert.equal(makeWindFelt(90, undefined, RUN), null, 'nor to turn');
  assert.deepEqual(makeWindFelt('calm', undefined, RUN), { v: 1, mode: 'calm', at: RUN });
  assert.equal(makeWindFelt('nonsense', 0, RUN), null);
  assert.deepEqual([0, 22, 23, 67, 338, 359].map(nearestPoint), [0, 0, 45, 45, 0, 0]);
  assert.equal(feltTurn(makeWindFelt(270, 30, RUN)), 240);
  assert.equal(feltTurn(makeWindFelt('swirl', 30, RUN)), 0);
  assert.equal(windTrusted(null), true, 'no word from the handler: the forecast, as ever');
  assert.deepEqual(['forecast', 'from', 'swirl', 'calm'].map(m => windTrusted(felt(m, { from: 90 }))), [true, true, false, false]);

  /* Set against the forecast at the run's start once there is a run, and
     against the forecast now while it happens. */
  const before = { data: { weather: northerly({ series: northerly().series.map(e => ({ ...e, wind_direction: e.t < RUN ? 0 : 90 })) }) } };
  assert.equal(feltMoment(before, RUN - 20 * 60e3), RUN - 20 * 60e3);
  assert.equal(windFeltFor(before, 'opposite', RUN - 20 * 60e3).ref, 0);
  const after = { data: { ...before.data, trackStarted: RUN + 5 * 60e3 } };
  assert.equal(feltMoment(after, RUN + 9e6), RUN + 5 * 60e3);
  const late = windFeltFor(after, 'opposite', RUN + 9e6);
  assert.deepEqual([late.ref, late.from, late.at], [90, 270, RUN + 9e6], 'the forecast at the run’s start, set now');
});

await t('a felt direction turns the whole forecast, its swing over the run kept', () => {
  /* The forecast backs from north to west over the hour; on the ground it
     came from the south when the handler set off. */
  const swing = northerly({ series: northerly().series.map((e, i) => ({ ...e, wind_direction: (360 - i * 10) % 360 })) });
  const s = { data: { weather: swing, windFelt: makeWindFelt(180, forecastAt({ data: { weather: swing } }, RUN).wx.wind_direction, RUN) } };
  const turn = feltTurn(s.data.windFelt);
  for (const at of [T0, T0 + 7.5 * 60e3, RUN, RUN + 37 * 60e3]) {
    const raw = forecastAt(s, at), got = windAt(s, at);
    assert.equal(got.exact, raw.exact);
    near(got.wx.wind_direction, (raw.wx.wind_direction + turn + 360) % 360, 1e-9, `turned at ${(at - T0) / 60e3} min`);
    assert.equal(got.wx.wind_speed, raw.wx.wind_speed, 'the speed is the forecast’s');
    assert.equal(got.wx.temp, raw.wx.temp);
  }
  near(windAt(s, RUN).wx.wind_direction, 180, 1e-9, 'from the south at the moment it was felt');
  near(windAt(s, RUN + 30 * 60e3).wx.wind_direction, 160, 1e-9, 'and backing with the forecast after it');
  assert.deepEqual(windAt(s, RUN).wx.series.map(e => e.wind_direction),
    swing.series.map(e => (e.wind_direction + turn + 360) % 360), 'the series it carries is turned with it');
  assert.equal(swing.series[0].wind_direction, 0, 'the saved forecast is never written over');

  /* The run's own weather comes first, and is turned the same way. */
  const own = northerly({ wind_direction: 90, series: northerly().series.map(e => ({ ...e, t: e.t + 864e5, wind_direction: 90 })) });
  const both = { data: { weather: swing, runWeather: own, windFelt: felt('from', { from: 270, ref: 90 }) } };
  assert.equal(windAt(both, RUN + 864e5).wx.wind_direction, 270);
  assert.equal(windAt(both, RUN + 5 * 864e5).exact, false);
  assert.equal(windAt(both, RUN + 5 * 864e5).wx.wind_direction, 270, 'a moment no series reaches is turned too');
  assert.equal(laidWind(both).wind_direction, 180, 'and the laid-time record');
  assert.equal(laidWind({ data: { weather: swing } }), swing, 'which is the record itself when nothing was felt');
});

await t('opposite, calm and swirl, and the forecast confirmed', () => {
  const base = { weather: northerly() };
  const opposite = windAt({ data: { ...base, windFelt: makeWindFelt('opposite', 0, RUN) } }, RUN).wx;
  assert.equal(opposite.wind_direction, 180);
  assert.equal(opposite.wind_speed, 4);

  const calm = windAt({ data: { ...base, windFelt: felt('calm') } }, RUN).wx;
  assert.deepEqual([calm.wind_speed, calm.wind_gusts, calm.wind_direction], [CALM_MS, CALM_MS, 0],
    'still air, the forecast’s direction kept to draw the arrow with');
  assert.ok(feltWeather(northerly(), felt('calm')).series.every(e => e.wind_speed === CALM_MS && e.wind_gusts === CALM_MS));
  /* The model takes still air: nothing is predicted on a side on level
     ground, and the scent is left lying on its line. */
  const trail = [0, 1, 2, 3].map(i => ({ lat: 51.2, lon: -2.65 + i * 1.4e-4, t: T0 + i * 10e3 }));
  const pred = predictedOffsets(FLAT, trail, calm, stability(11, 12), RUN);
  assert.ok(pred.every(p => p.metres === 0 && p.bearing === null), 'no drift and no side in a calm');

  const wx = northerly();
  const swirl = { data: { weather: wx, windFelt: felt('swirl') } };
  assert.equal(windAt(swirl, 9e15).wx, wx, 'a swirl draws with the forecast as it is, the same record');
  assert.equal(windAt({ data: { weather: wx, windFelt: felt('forecast') } }, 9e15).wx, wx, 'as does the forecast confirmed');
  assert.equal(windAt({ data: { weather: wx, windFelt: { mode: 'from', from: 90 } } }, 9e15).wx, wx,
    'and a windFelt that is not one changes nothing');
  assert.equal(feltWeather(null, felt('calm')), null);
});

await t('the words for each, in the handler’s units, and none when the handler said nothing', () => {
  const ten = northerly({ wind_speed: 10 / 3.6, series: northerly().series.map(e => ({ ...e, wind_speed: 10 / 3.6 })) });
  const s = (wf) => ({ data: { weather: ten, trackStarted: RUN, windFelt: wf } });
  assert.equal(windWords(s(makeWindFelt('opposite', 0, RUN))), 'Wind from S — felt on the ground (forecast: from N)');
  assert.equal(windWords(s(felt('swirl'))), 'Wind swirling on the ground (forecast: from N, 10 km/h)');
  assert.equal(windWords(s(felt('calm')), { imperial: true }), 'Calm on the ground (forecast: from N, 6 mph)');
  assert.equal(windWords(s(felt('forecast'))), 'Wind from N, as forecast');
  assert.equal(windWords(s(makeWindFelt(315, 0, RUN)), { short: true }), 'From NW, felt (forecast N)');
  assert.equal(windWords(s(felt('swirl')), { short: true }), 'Swirling, felt (forecast N)');
  assert.equal(windWords(s(felt('calm')), { short: true }), 'Calm, felt (forecast N)');
  assert.equal(windWords(s(felt('forecast')), { short: true }), 'From N, as forecast');
  assert.equal(windWords(s(null)), null, 'nothing felt: every place shows the forecast as it always has');
  assert.equal(windWords(s({ v: 1, mode: '<img src=x>', at: RUN })), null);
  assert.equal(windWords({ data: { windFelt: felt('calm', { ref: undefined }) } }), 'Calm on the ground',
    'no forecast at all: no brackets with nothing in them');
  /* A shared model carries the same records under other names. */
  assert.equal(windWords({ wx: northerly(), runAt: RUN, windFelt: felt('swirl') }),
    'Wind swirling on the ground (forecast: from N, 14 km/h)');
  assert.equal(forecastSaid(s(null), {}, RUN), 'from N, 10 km/h');
  assert.equal(forecastSaid({ data: {} }), null);
});

/* ── What the dog's record learns ───────────────────────────────────── */

await t('a swirl or a calm teaches the dog’s drift nothing, and its rows are not read', () => {
  const blind = { track: [{ t: 1 }], trackStarted: 1000 };
  assert.equal(teachesDrift(blind), true);
  assert.equal(teachesDrift({ ...blind, windFelt: makeWindFelt('opposite', 0, RUN) }), true, 'a felt direction is a direction');
  assert.equal(teachesDrift({ ...blind, windFelt: felt('forecast') }), true);
  assert.equal(teachesDrift({ ...blind, windFelt: felt('swirl') }), false);
  assert.equal(teachesDrift({ ...blind, windFelt: felt('calm') }), false);
  assert.equal(teachesDrift({ ...blind, coach: { assisted: true }, windFelt: felt('forecast') }), false, 'the other rules stand');

  const run = (t0, wf) => ({ id: `r${t0}`, dogId: 'bo', targetId: 'person', startedAt: 1,
    data: { track: [{ lat: 51, lon: -2, t: t0 }], trackStarted: t0, result: { kind: 'trail', medAbs: 4 }, ...(wf ? { windFelt: wf } : {}) } });
  const rows = [1000, 2000, 3000].map(t0 => ({ t: t0, k: 2 }));
  assert.deepEqual(driftRows(rows, [run(1000), run(2000, felt('swirl')), run(3000, felt('calm'))]).map(r => r.t), [1000]);
});

await t('a run graded again puts its drift row right, in place, and sets it aside when it no longer banks', () => {
  const rows = [{ t: 1, k: 1 }, { t: 2, k: 2 }, { t: 3, k: 3 }];
  assert.deepEqual(rebankRows(rows, 2, { t: 2, k: 9 }), [{ t: 1, k: 1 }, { t: 2, k: 9 }, { t: 3, k: 3 }], 'in the order they were run');
  assert.deepEqual(rebankRows([...rows, { t: 2, k: 5 }], 2, { t: 2, k: 9 }).map(r => r.k), [1, 9, 3], 'one row per run, however many it had');
  assert.deepEqual(rebankRows(rows, 4, { t: 4, k: 4 }).map(r => r.t), [1, 2, 3, 4], 'a run that banked nothing before adds its row');
  assert.deepEqual(rebankRows(rows, 2, null), [{ t: 1, k: 1 }, { t: 2, k: 2, skip: true }, { t: 3, k: 3 }]);
  assert.deepEqual(rebankRows(rebankRows(rows, 2, null), 2, { t: 2, k: 7 })[1], { t: 2, k: 7 }, 'banking again takes it back');
  assert.deepEqual(rebankRows(null, 2, null), []);

  const db = createStore(fakeBackend());
  const seen = [];
  db.onChange((table, v) => { if (table === 'calibration') seen.push(v.rows.length); });
  db.addCalibration('bo', { t: 1, k: 1 });
  db.addCalibration('bo', { t: 2, k: 2 });
  db.addCalibration('bo', { t: 2, k: 6 }, { replace: true });
  assert.deepEqual(db.calibration('bo'), [{ t: 1, k: 1 }, { t: 2, k: 6 }]);
  db.setAsideDrift('bo', 2);
  assert.deepEqual(db.calibration('bo')[1], { t: 2, k: 6, skip: true });
  const before = seen.length;
  db.setAsideDrift('bo', 2);
  db.setAsideDrift('bo', 99);
  db.setAsideDrift(null, 1);
  assert.equal(seen.length, before, 'nothing to set aside writes nothing and tells nobody');
});

/* ── Where it travels ───────────────────────────────────────────────── */

await t('a link carries it, a kept run keeps it, and an old link still opens', async () => {
  const trail = [0, 1, 2].map(i => ({ lat: 51.2, lon: -2.65 + i * 1.4e-4, t: T0 + i * 10e3 }));
  const track = [0, 1, 2].map(i => ({ lat: 51.2, lon: -2.65 + i * 1.4e-4, t: RUN + i * 10e3 }));
  const wf = makeWindFelt('opposite', 0, RUN);
  const mine = { id: 's', startedAt: T0, targetId: 'person',
    data: { trail, track, trackStarted: RUN, trackWaypoints: [], weather: northerly(), windFelt: wf } };
  const m = await decodeShared(await encodeShared(trailModel(mine, {})));
  assert.deepEqual(m.windFelt, wf);
  const theirs = sessionFromModel(m);
  assert.deepEqual(theirs.data.windFelt, wf);
  assert.equal(windAt(theirs, RUN).wx.wind_direction, windAt(mine, RUN).wx.wind_direction, 'their replay in the wind felt here');
  assert.equal(windAt(theirs, RUN).wx.wind_direction, 180);
  assert.deepEqual(keptSession(m, { id: 'k', at: RUN }).data.windFelt, wf, 'kept on their phone with the run');
  assert.equal(windWords(m), 'Wind from S — felt on the ground (forecast: from N)', 'and said on the shared page');

  /* A link made before it was carried, and one carrying junk. */
  const old = { ...trailModel({ ...mine, data: { ...mine.data, windFelt: undefined } }, {}) };
  delete old.windFelt;
  const o = await decodeShared(await encodeShared(old));
  assert.equal(o.windFelt, null);
  assert.equal(sessionFromModel(o).data.windFelt, undefined);
  assert.equal(windAt(sessionFromModel(o), RUN).wx.wind_direction, 0, 'read in the forecast, as it always was');
  const junk = await decodeShared(await encodeShared({ ...trailModel(mine, {}), windFelt: { v: 1, mode: 'from', from: 10, ref: 0, at: RUN } }));
  assert.equal(junk.windFelt, null, 'a direction that is not a point of the compass does not open as one');
  const odd = await decodeShared(await encodeShared({ ...trailModel(mine, {}), windFelt: { ...wf, note: '<b>x</b>', __x__: 1 } }));
  assert.deepEqual(odd.windFelt, wf, 'only the fields the app writes');

  /* Never on the live document: the cloud takes only the fields its rules list. */
  assert.ok(!('windFelt' in liveMeta(trailModel(mine, {}), RUN)));
});

await t('a crash copy of a run carries it, and nothing else does', () => {
  const pts = [0, 1, 2].map(i => ({ lat: 51.2, lon: -2.65 + i * 1e-4, t: RUN + i * 1000 }));
  const wf = felt('swirl');
  const d = unpackDraft(JSON.parse(JSON.stringify(packDraft({ kind: 'run', startedAt: RUN, sessionId: 's1', pts, windFelt: wf }, RUN))));
  assert.deepEqual(d.windFelt, wf);
  assert.equal(unpackDraft(packDraft({ kind: 'run', startedAt: RUN, sessionId: 's1', pts }, RUN)).windFelt, null);
  assert.equal(unpackDraft(packDraft({ kind: 'run', startedAt: RUN, pts, windFelt: { mode: 'calm' } }, RUN)).windFelt, null,
    'a copy half written or from elsewhere brings none');
  assert.ok(!('windFelt' in packDraft({ kind: 'lay', startedAt: RUN, pts, windFelt: wf }, RUN)), 'a trail being laid has no run to feel');
  const older = packDraft({ kind: 'run', startedAt: RUN, pts }, RUN);
  delete older.windFelt;
  assert.equal(unpackDraft(older).windFelt, null, 'a copy written before it was carried still comes back');
});

await t('a second run of the trail starts without it, and a merge keeps it with its run', () => {
  const ran = { id: 'a', dogId: 'bo', targetId: 'person', startedAt: T0,
    data: { trail: [{ lat: 51, lon: -2 }], weather: northerly(), track: [{ lat: 51, lon: -2, t: RUN }], windFelt: felt('calm') } };
  const again = runAgain(ran, { id: 'b', summary: '' });
  assert.equal('windFelt' in again.data, false, 'each run’s wind is felt on its own day');
  assert.ok(again.data.weather, 'the trail’s own forecast comes along');
  assert.ok(RUN_FIELDS.includes('windFelt'));
  /* A phone that never pulled the run changed something small: the run,
     its felt wind with it, comes from the copy that has it. */
  const theirs = { ...ran, dogId: null, data: { trail: ran.data.trail, weather: ran.data.weather }, name: 'Lane', updatedAt: 9 };
  const { keep } = mergeOne({ ...ran, updatedAt: 5 }, theirs, { union: true });
  assert.equal(keep.name, 'Lane', 'the newer copy’s change stands');
  assert.deepEqual(keep.data.windFelt, felt('calm'), 'and the run keeps the wind it was felt in');
});

/* ── The app: every reader, and the re-grade ────────────────────────── */

/* An eastward trail laid at 08:00 in a forecast northerly, run at 09:00 with
   the dog 5 m south of it. The forecast puts the scent south, on the right
   of the line; felt from the south on the ground, it goes north, left. */
const trail = Array.from({ length: 20 }, (_, i) => ({ lat: 51.2, lon: -2.65 + i * 1.4e-4, t: T0 + i * 10e3 }));
const runTrack = Array.from({ length: 20 }, (_, i) => ({ lat: 51.2 - 4.5e-5, lon: -2.65 + i * 1.4e-4, t: RUN + i * 10e3, acc: 3 }));
/* A search: the dog comes in heading north to the hide. */
const hide = { lat: 51.201, lon: -2.65 };
const searchTrack = Array.from({ length: 12 }, (_, i) => ({ lat: 51.2 + i * 1e-4, lon: -2.65, t: RUN + i * 10e3, acc: 3 }));

/** The grade and everything around it, lifted out of app.js onto a real store. */
function app() {
  const db = createStore(fakeBackend());
  const drawn = { plume: [], coach: [], panel: [], followed: [], field: [] };
  const sb = {
    db, S: { dogs: [{ id: 'bo', name: 'Bo', lineM: 0 }] }, BUILD: 'test',
    rec: { kind: null, on: false, started: RUN }, run: { session: null, stopping: false, revealed: false, startedAt: RUN, airAt: 0 },
    currentScreen: 'scrResult', coach: { trail: null, field: [] },
    targetById, unwalkedPlan, windAt, cleanWindFelt, windTrusted, stability, regime, FLAT, predictedOffsets, changed,
    lineCorrect, signedOffsets, meanSigned, medianAbs, sideShares, sideOfDrift, sideAgreement, approachToWind, bearing, dist,
    fmtDur, fmtM: (m) => fmtShort(m, false), APPROACH_V, resultSentence, teachesDrift, patchSession,
    unitsForText: () => ({ imperial: false, fahrenheit: false, coord: 'dd', when: String }),
    terrainFor: () => Promise.resolve(FLAT),
    fetchWeather: () => Promise.reject(new Error('offline')), WX_WAIT: 10,
    guardSave: (s, fn) => fn(), snap() {}, keepDraft() { drawn.draft = (drawn.draft ?? 0) + 1; },
    trailOf: (s) => s.data.trail, contamSim: () => null,
    plumeStart: (tr, w) => drawn.plume.push(w.wind_direction),
    weatherPanelFor: (s, at) => drawn.panel.push(windAt(s, at).wx.wind_direction),
    scentField: (tr, w) => { drawn.field.push(w.wind_direction); return []; },
    followWeather: (w) => drawn.followed.push(w.wind_direction),
    $: () => ({ hidden: true }),   // the run screen's wind picker, shut
    Promise, Number, Math, Object, JSON, Error,
  };
  vm.createContext(sb);
  vm.runInContext([
    decl('function travelBrg('),
    between('/* `rebank` is for a run graded again', '\nfunction searchResult('),
    decl('function searchResult('),
    decl('function saveSession('),
    decl('function runAirChanged('),
    between('let feltQueue = ', '\n/* ── Pick what to run'),
  ].join('\n'), sb);
  return { sb, db, drawn };
}

const trailRun = (over = {}) => ({ id: 'run1', handlerId: 'h1', dogId: 'bo', targetId: 'person', startedAt: T0, summary: '',
  data: { trail, weather: northerly(), track: runTrack, trackStarted: RUN, trackWaypoints: [], ...over } });
const searchRun = (over = {}) => ({ id: 'find1', handlerId: 'h1', dogId: 'bo', targetId: 'article', startedAt: T0, summary: '',
  data: { hides: [hide], weather: northerly(), track: searchTrack, trackStarted: RUN,
    trackWaypoints: [{ kind: 'Indication', lat: hide.lat, lon: hide.lon, t: RUN + 110e3 }], ...over } });

await t('every reader of a run’s wind reads the one the handler felt: plume, coach, panel, replay and grade', async () => {
  const wf = makeWindFelt('opposite', 0, RUN);
  const { sb, drawn } = app();

  /* The run screen, revealed, as the wind is corrected during the run. */
  const live = trailRun({ track: undefined, trackStarted: undefined, windFelt: wf });
  Object.assign(sb.run, { session: live, revealed: true, startedAt: RUN });
  sb.coach.trail = trail;
  sb.currentScreen = 'scrRun';
  sb.runAirChanged(live);
  assert.deepEqual([drawn.plume, drawn.panel, drawn.field], [[180], [180], [180]], 'the plume, the panel and the coach’s band');

  /* The replay, at a moment of the run. */
  const rp = { replay: { s: trailRun({ windFelt: wf }), at: RUN + 60e3, from: RUN, to: RUN + 190e3 },
    setDogTrack() {}, setSrc() {}, pointsOf: () => ({}), plume: { sim: null, bandWalls: 0 }, stability, windAt,
    followWeather: (w) => drawn.followed.push(w.wind_direction), scentField: (tr, w) => { drawn.field.push(w.wind_direction); return []; },
    plumePolygon: () => ({}), paintBandWalls() {}, EMPTY: {}, trailOf: (s) => s.data.trail, signedOffsets: () => [],
    targetById, fmtM: String, fmtDur, unwalkedPlan, ageUnknown: () => '', bandWallNote: () => '',
    windWords, feltPanel, imp: () => false,
    $: () => ({ textContent: '', style: {}, classList: { toggle() {} }, setAttribute() {} }), document: { activeElement: null } };
  vm.createContext(rp);
  vm.runInContext(decl('function paintReplay('), rp);
  rp.paintReplay();
  assert.deepEqual([drawn.followed.at(-1), drawn.field.at(-1)], [180, 180], 'the replay’s panel and band');

  /* The grade: the side it expects, and the wind it quotes. */
  const graded = await sb.computeResult(trailRun({ windFelt: wf }), runTrack, [], RUN, { bank: false });
  assert.equal(graded.wind.from, 180);
  assert.equal(graded.predSide, -1, 'felt from the south, the scent went left of an eastward line');
  assert.match(graded.modelled, /^The wind felt on the ground suggests drift to the left\. The track sits on the other side/);
  const forecast = await sb.computeResult(trailRun(), runTrack, [], RUN, { bank: false });
  assert.equal(forecast.predSide, 1, 'the forecast northerly put it right');
  assert.match(forecast.modelled, /^The forecast wind suggests drift to the right\. The track sits on that side\./);

  /* And a search's approach, off the same corrected wind. */
  const find = await sb.computeResult(searchRun({ windFelt: wf }), searchTrack, searchRun().data.trackWaypoints, RUN, { bank: false });
  assert.equal(find.approach, 'with the wind', 'heading north with the wind felt from the south behind it');
  assert.equal(find.wind.from, 180);
  const byForecast = await sb.computeResult(searchRun(), searchTrack, searchRun().data.trackWaypoints, RUN, { bank: false });
  assert.equal(byForecast.approach, 'into the wind');

  /* Every one of them the same direction, and the forecast's own nowhere. */
  const all = [...drawn.plume, ...drawn.panel, ...drawn.field, ...drawn.followed, graded.wind.from, find.wind.from];
  assert.ok(all.every(d => d === 180), `one wind on every reader: ${all}`);
});

await t('a swirl states no approach and scores no side; a calm draws still air', async () => {
  const { sb } = app();
  const find = await sb.computeResult(searchRun({ windFelt: felt('swirl') }), searchTrack, searchRun().data.trackWaypoints, RUN, { bank: false });
  assert.equal(find.approach, null, 'into or with a wind with no steady direction is not said');
  assert.doesNotMatch(find.sentence, /wind/);
  assert.match(find.sentence, /^Bo indicated in /, 'the rest of the sentence stands');

  const swirl = await sb.computeResult(trailRun({ windFelt: felt('swirl') }), runTrack, [], RUN, { bank: false });
  assert.deepEqual([swirl.predSide, swirl.agree, swirl.regimeKey], [0, null, null]);
  assert.equal(swirl.modelled, 'The wind was swirling on the ground, so the model can’t say which side the scent went.');

  const calm = await sb.computeResult(trailRun({ windFelt: felt('calm') }), runTrack, [], RUN, { bank: false });
  assert.deepEqual([calm.predSide, calm.wind.speed, calm.regimeKey], [0, CALM_MS, null]);
  assert.equal(calm.modelled, 'The air was calm on the ground, so the model suggests no side.');
  const calmFind = await sb.computeResult(searchRun({ windFelt: felt('calm') }), searchTrack, searchRun().data.trackWaypoints, RUN, { bank: false });
  assert.equal(calmFind.approach, null);
});

await t('set after the run, it is saved, the run graded again in it, and the dog’s row put right', async () => {
  const { sb, db } = app();
  db.addSession(trailRun());
  /* The first grade, at Stop, in the forecast. */
  const first = await sb.computeResult(trailRun(), runTrack, [], RUN, { bank: true });
  db.updateSession('run1', { summary: first.sentence, data: { result: first } });
  assert.deepEqual(db.calibration('bo').map(r => [r.t, r.predSide]), [[RUN, 1]]);
  const k = db.calibration('bo')[0].k;

  const s1 = await sb.setWindFelt(db.sessions()[0], makeWindFelt('opposite', 0, RUN + 3600e3));
  assert.equal(s1.data.windFelt.from, 180);
  const kept = db.sessions().find(x => x.id === 'run1');
  assert.deepEqual(kept.data.windFelt, s1.data.windFelt, 'saved with the run');
  assert.equal(kept.data.result.predSide, -1, 'graded again in the wind felt');
  assert.equal(kept.data.result.wind.from, 180);
  assert.equal(kept.summary, kept.data.result.sentence);
  assert.deepEqual(db.calibration('bo').map(r => [r.t, r.predSide, r.k, r.skip]), [[RUN, -1, k, undefined]],
    'the same one row for the run, now learned from the wind felt');

  await sb.setWindFelt(kept, felt('swirl', { at: RUN + 3700e3 }));
  const swirled = db.sessions().find(x => x.id === 'run1');
  assert.equal(swirled.data.result.predSide, 0);
  assert.deepEqual(db.calibration('bo').map(r => r.skip), [true], 'a swirl sets the row aside');
  assert.equal(db.dogDrift('bo'), null);
  assert.equal(driftRows(db.calibration('bo'), db.sessions()).length, 0);

  /* Two quick changes end on the second, whichever grade is quicker. */
  const a = sb.setWindFelt(swirled, felt('calm', { at: RUN + 3800e3 }));
  const b = sb.setWindFelt(swirled, felt('forecast', { at: RUN + 3900e3 }));
  await Promise.all([a, b]);
  const last = db.sessions().find(x => x.id === 'run1');
  assert.equal(last.data.windFelt.mode, 'forecast');
  assert.equal(last.data.result.predSide, 1);
  assert.deepEqual(db.calibration('bo').map(r => [r.predSide, r.skip]), [[1, undefined]], 'banked again, in place of the set-aside row');

  await sb.setWindFelt(last, null);
  assert.equal(db.sessions().find(x => x.id === 'run1').data.windFelt, null, 'back to the forecast, unconfirmed');
});

await t('a search graded again keeps its time to the find, and only the wind moves', async () => {
  const { sb, db } = app();
  db.addSession(searchRun());
  sb.rec.started = RUN - 4000;           // the recording began a moment before the run's clock
  const first = await sb.computeResult(searchRun(), searchTrack, searchRun().data.trackWaypoints, RUN, { bank: true });
  db.updateSession('find1', { summary: first.sentence, data: { result: first } });
  sb.rec.started = RUN + 9e6;            // a later recording, long after
  const again = await sb.setWindFelt(db.sessions()[0], makeWindFelt('opposite', 0, RUN + 3600e3));
  assert.equal(again.data.result.toFirst, first.toFirst, 'timed as its first grade was, not from a later recording');
  assert.equal(again.data.result.approach, 'with the wind');
  assert.match(again.summary, /coming with the wind\.$/);
});

await t('set during a run, it lives with the run until Stop, and nothing is graded twice', async () => {
  const { sb, db, drawn } = app();
  const laid = trailRun({ track: undefined, trackStarted: undefined, trackWaypoints: undefined });
  db.addSession(laid);
  const live = db.sessions()[0];
  Object.assign(sb.rec, { kind: 'run', on: true });
  Object.assign(sb.run, { session: live, revealed: false, startedAt: RUN });
  sb.currentScreen = 'scrRun';
  const got = await sb.setWindFelt(live, felt('calm'));
  assert.equal(got, live, 'the run’s own session, changed in place for everything holding it');
  assert.deepEqual(live.data.windFelt, felt('calm'));
  assert.equal(db.sessions()[0].data.windFelt, undefined, 'not saved until Stop keeps the run');
  assert.equal(drawn.draft, 1, 'written into the crash copy at once');
  assert.equal(drawn.panel.length, 1, 'the panel follows it');
  assert.equal(windAt(live, RUN).wx.wind_speed, CALM_MS, 'in still air');
  sb.run.stopping = true;
  assert.equal(await sb.setWindFelt(live, felt('swirl')), null, 'not while Stop is grading it');
  assert.deepEqual(live.data.windFelt, felt('calm'));
  assert.equal(await sb.setWindFelt({ id: 'nope' }, felt('calm')), null);
  assert.equal(await sb.setWindFelt(live, { mode: 'calm' }), null, 'nothing that is not a windFelt');

  /* A run kept from someone else's link is theirs. */
  db.addSession({ ...trailRun({ imported: { from: 'Anna' } }), id: 'theirs', dogId: null });
  sb.rec.on = false; sb.run.session = null; sb.run.stopping = false;
  assert.equal(await sb.setWindFelt({ id: 'theirs' }, felt('calm')), null);
  assert.equal(db.sessions().find(x => x.id === 'theirs').data.windFelt, undefined);
});

await t('Stop saves it with the run, a recovered run takes it back, and a new run starts clean', () => {
  const stop = js.slice(js.indexOf('async function finishRun'), js.indexOf('/* ── The result'));
  assert.match(stop, /const felt = s\.data\.windFelt !== undefined \? \{ windFelt: cleanWindFelt\(s\.data\.windFelt\) \} : \{\};/);
  assert.match(stop, /revealedAt: run\.revealedAt \|\| s\.data\.revealedAt \|\| null, \.\.\.felt \} \};/, 'with the walk, before the grade');
  assert.match(stop, /\.\.\.\(runWeather \? \{ runWeather \} : \{\}\), \.\.\.felt \},/, 'and with the result');
  assert.match(decl('function keepDraft('), /windFelt: rec\.kind === 'run' \? run\.session\?\.data\?\.windFelt \?\? null : null,/);
  assert.match(decl('async function recoverKeep('), /if \(d\.windFelt\) s\.data\.windFelt = d\.windFelt;\s*\n\s*run\.session = s;/);
  assert.match(decl('async function startRun('), /if \(!run\.copy && s\.data && !had\.data\?\.windFelt\) delete s\.data\.windFelt;/);
  /* The run's own weather, fetched when the laid series did not reach it,
     is read in the felt wind too. */
  assert.match(js, /windAt\(\{ data: \{ runWeather, windFelt: s\.data\.windFelt \} \}, startedAt\)/);
});

await t('no screen reads a session’s wind round windAt and laidWind', () => {
  /* The laid-time record read raw drew a trail in the forecast after the
     handler had put it right. Only a presence check is left, and the late
     write that stores the record, which this does not count. */
  const raw = [...js.matchAll(/(?:\.data|\bd\??)\??\.weather\b(?!\s*=)/g)].map(m => js.slice(m.index - 30, m.index + 30).replace(/\n/g, ' '));
  const allowed = raw.filter(l => /!s\.data\.weather\b/.test(l));
  assert.equal(allowed.length, 1, 'the check still finds the one presence check it allows');
  assert.deepEqual(raw.filter(l => !allowed.includes(l)), [], 'a raw read of the laid weather');
  assert.doesNotMatch(js, /wxAt\(/, 'the series is only ever read through windAt');
});

/* ── The screens: one picker, on the run and in the debrief ─────────── */

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/app.css', import.meta.url), 'utf8');

await t('the picker lights what was chosen, and a second tap on it takes it back', () => {
  assert.deepEqual(FELT_POINTS.map(p => p.deg), [0, 45, 90, 135, 180, 225, 270, 315]);
  assert.deepEqual(FELT_POINTS.map(p => p.abbr), ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']);
  assert.equal(FELT_POINTS[7].name, 'north-west');

  assert.deepEqual(feltPicked(null), { quick: null, from: null }, 'nothing said, nothing lit');
  assert.deepEqual(feltPicked(felt('forecast')), { quick: 'forecast', from: null });
  assert.deepEqual(feltPicked(felt('swirl')), { quick: 'swirl', from: null });
  assert.deepEqual(feltPicked(felt('calm')), { quick: 'calm', from: null });
  /* Opposite is kept as the point it names: both are lit, both are true. */
  assert.deepEqual(feltPicked(makeWindFelt('opposite', 10, RUN)), { quick: 'opposite', from: 180 });
  assert.deepEqual(feltPicked(makeWindFelt(270, 10, RUN)), { quick: null, from: 270 });
  assert.deepEqual(feltPicked({ v: 1, mode: 'from', from: 90, at: RUN }), { quick: null, from: null }, 'what cleanWindFelt refuses lights nothing');

  const opp = makeWindFelt('opposite', 0, RUN);
  assert.ok(feltSame(opp, 'opposite'));
  assert.ok(feltSame(opp, 180), 'the point it names is the same answer');
  assert.ok(!feltSame(opp, 'swirl'));
  assert.ok(!feltSame(opp, 90));
  assert.ok(feltSame(felt('calm'), 'calm'));
  assert.ok(!feltSame(null, 'forecast'), 'a first tap is never a second one');
  assert.ok(!feltSame(makeWindFelt(90, 0, RUN), 'opposite'));

  assert.ok(sameFelt(null, undefined));
  assert.ok(sameFelt(felt('swirl'), felt('swirl', { at: RUN + 5e3, ref: 90 })), 'when it was said does not matter');
  assert.ok(sameFelt(makeWindFelt('opposite', 0, RUN), makeWindFelt(180, 0, RUN + 9e3)));
  assert.ok(!sameFelt(makeWindFelt(180, 0, RUN), makeWindFelt(135, 0, RUN)));
  assert.ok(!sameFelt(felt('calm'), null));
});

await t('the air panel says a felt wind in words no wider than the forecast’s time', () => {
  const s = (wf) => ({ data: { weather: northerly(), trackStarted: RUN, windFelt: wf } });
  assert.equal(feltPanel(s(undefined)), null, 'the forecast note stands');
  assert.deepEqual(feltPanel(s(makeWindFelt('opposite', 0, RUN))), { mode: 'from', dir: null, note: 'felt · forecast N' });
  assert.deepEqual(feltPanel(s(felt('swirl'))), { mode: 'swirl', dir: 'swirling', note: 'felt · forecast N' });
  assert.deepEqual(feltPanel(s(felt('calm'))), { mode: 'calm', dir: 'calm', note: 'felt · forecast N' });
  assert.deepEqual(feltPanel(s(felt('forecast'))), { mode: 'forecast', dir: null, note: 'felt as forecast' });
  /* The status pill sits beside the panel; "10 m forecast, 14:00" is the note it had room for. */
  for (let d = 0; d < 360; d += 22.5) {
    const n = feltPanel(s(makeWindFelt('opposite', d, RUN))).note;
    assert.ok(n.length <= '10 m forecast, 14:00'.length, `${n} is wider than the note it replaces`);
  }
  assert.match(js, /\$\('wxDir'\)\.textContent = felt\?\.dir \?\? `from \$\{cardinal\(wx\.wind_direction\)\}`;/);
  assert.match(js, /felt\?\.mode !== 'calm' \? \(wx\.wind_direction \+ 180\) % 360 : null;/, 'still air has no arrow');
  assert.match(decl('function weatherPanelFor('), /if \(own\) return showWeather\(own, feltPanel\(session\)\);/);
  assert.match(decl('function paintReplay('), /followWeather\(w, feltPanel\(s\)\);/);
});

/** The picker and the run screen's handling of it, lifted out of app.js. */
function picker(extra = {}) {
  const els = new Map();
  const toasts = [], asked = [];
  const sb = {
    $: (id) => {
      if (!els.has(id)) els.set(id, { hidden: true, innerHTML: '', attrs: {}, focused: 0,
        setAttribute(k, v) { this.attrs[k] = v; }, focus() { this.focused++; } });
      return els.get(id);
    },
    currentScreen: 'scrRun', run: { session: null }, wxShown: { key: 'shown' },
    airPanel: (id) => asked.push(['airPanel', id]), toast: (m) => toasts.push(m),
    navigator: {}, imp: () => false,
    setWindFelt: async (s, f) => { asked.push(['setWindFelt', f]); s.data.windFelt = f; return s; },
    forecastAt, feltMoment, nearestPoint, windFeltFor, forecastSaid, windWords, FELT_POINTS, feltPicked, feltSame,
    Number, Promise,
  };
  Object.assign(sb, extra);
  vm.createContext(sb);
  vm.runInContext([
    js.slice(js.indexOf('\nconst esc = '), js.indexOf('\n', js.indexOf('\nconst esc = ') + 1)),
    between('const feltChangeable = ', '\n/* On the run screen.'),
    decl('function openFeltSheet('),
    decl('function paintFeltSheet('),
    decl('function closeFeltSheet('),
    decl('async function pickFeltOnRun('),
    decl('function paintWxFelt('),
  ].join('\n'), sb);
  return { sb, toasts, asked };
}
/** The buttons in some markup: their attributes and their words. */
const buttons = (h) => [...h.matchAll(/<button ([^>]*)>([^<]*)<\/button>/g)].map(([, a, text]) => ({
  text, ...Object.fromEntries([...a.matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map(([, k, v]) => [k, v ?? true])),
}));

await t('the picker: four answers and a rose, the forecast’s point marked, each button named and pressed', () => {
  const { sb } = picker();
  const s = { id: 'r', data: { weather: northerly() } };
  const h = sb.feltPickerHtml(s, makeWindFelt('opposite', 0, RUN));
  assert.match(h, /Forecast said: from N, 14 km\/h <span class="felt-dot" aria-hidden="true"><\/span>/);
  assert.match(h, /Or tap where it comes <b>from<\/b>:/);
  const b = buttons(h);
  const quick = b.filter(x => x['data-felt']), rose = b.filter(x => x['data-felt-from'] != null);
  assert.deepEqual(quick.map(x => x.text), ['As forecast', 'Opposite', 'Swirling', 'Calm']);
  assert.deepEqual(rose.map(x => x.text), ['NW', 'N', 'NE', 'W', 'E', 'SW', 'S', 'SE'], 'north at the top, as a rose');
  assert.deepEqual(rose.map(x => x['aria-label']), ['From north-west', 'From north, where the forecast has it', 'From north-east',
    'From west', 'From east', 'From south-west', 'From south', 'From south-east']);
  assert.equal(quick[1]['aria-label'], 'Opposite, from south', 'Opposite says which way that is');
  assert.deepEqual(b.filter(x => x['aria-pressed'] === 'true').map(x => x.text), ['Opposite', 'S']);
  assert.ok(b.every(x => x['aria-pressed'] === 'true' || x['aria-pressed'] === 'false'), 'every choice says whether it is pressed');
  assert.ok(b.every(x => x.class.split(' ').includes('on') === (x['aria-pressed'] === 'true')), 'lit exactly when pressed');
  assert.deepEqual(rose.filter(x => x.class.includes(' fc')).map(x => x.text), ['N'], 'the forecast’s own point, marked');
  assert.ok(b.every(x => !x.disabled));
  assert.match(h, /<div class="felt-rose" role="group" aria-label="Where the wind comes from">/);

  /* No forecast direction: nothing to agree with or turn; a swirl or a calm still can be said. */
  const none = buttons(sb.feltPickerHtml({ id: 'r', data: {} }, null));
  assert.deepEqual(none.filter(x => x.disabled).map(x => x.text), ['As forecast', 'Opposite', 'NW', 'N', 'NE', 'W', 'E', 'SW', 'S', 'SE']);
  assert.deepEqual(none.filter(x => !x.disabled).map(x => x.text), ['Swirling', 'Calm']);
  assert.ok(none.every(x => x['aria-pressed'] === 'false'));
  assert.match(sb.feltPickerHtml({ id: 'r', data: {} }, null), /No forecast wind here yet/);
});

await t('on the run: the air panel opens it, a choice goes to the run at once, and a second tap goes back', async () => {
  const { sb, toasts, asked } = picker();
  const s = { id: 'r', data: { weather: northerly() } };
  sb.run.session = s;
  sb.paintWxFelt();
  assert.equal(sb.$('wxFelt').hidden, false, 'the panel is a button on the run screen');
  assert.equal(sb.$('wxFeltHint').hidden, false, 'and says so until a wind is set');
  assert.equal(sb.$('wxFelt').attrs['aria-label'], 'Forecast wind from N, 14 km/h. Set the wind you feel on the ground');

  sb.openFeltSheet();
  assert.equal(sb.$('feltSheet').hidden, false);
  assert.match(sb.$('feltRun').innerHTML, /data-felt="opposite"/);
  assert.equal(sb.$('feltTitle').focused, 1, 'a screen reader lands on the sheet');

  await sb.pickFeltOnRun({ dataset: { felt: 'opposite' } });
  assert.deepEqual(asked.at(-1), ['setWindFelt', makeWindFelt('opposite', 0, s.data.windFelt.at)]);
  assert.equal(sb.$('feltSheet').hidden, true, 'put away so the ground can be seen');
  assert.equal(sb.$('wxFelt').focused, 1, 'focus back on the panel');
  assert.equal(toasts.at(-1), 'From S, felt (forecast N)');
  sb.paintWxFelt();
  assert.equal(sb.$('wxFeltHint').hidden, true);
  assert.equal(sb.$('wxFelt').attrs['aria-label'], 'Wind from S — felt on the ground (forecast: from N). Set the wind you feel on the ground');

  await sb.pickFeltOnRun({ dataset: { feltFrom: '180' } });
  assert.deepEqual(asked.at(-1), ['setWindFelt', null], 'the same answer again is the forecast back');
  assert.equal(toasts.at(-1), 'Back to the forecast wind');

  await sb.pickFeltOnRun({ dataset: { felt: 'swirl' }, disabled: true });
  assert.deepEqual(asked.at(-1), ['setWindFelt', null], 'a greyed button does nothing');

  /* Stop is grading: nothing changes, and the handler is told where to say it. */
  const busy = picker({ setWindFelt: async () => null });
  busy.sb.run.session = { id: 'r', data: { weather: northerly() } };
  await busy.sb.pickFeltOnRun({ dataset: { felt: 'calm' } });
  assert.match(busy.toasts.at(-1), /debrief/);

  /* Off the run screen the panel is only something to read. */
  sb.currentScreen = 'scrReplay';
  sb.paintWxFelt();
  assert.equal(sb.$('wxFelt').hidden, true);
  assert.equal(sb.$('wxFeltHint').hidden, true);
});

await t('the run screen’s picker never touches the recording or leaves the screen', () => {
  for (const head of ['function openFeltSheet(', 'function closeFeltSheet(', 'async function pickFeltOnRun(', 'function paintFeltSheet(']) {
    const body = decl(head);
    assert.doesNotMatch(body, /\bgo\(|stopWatch|stopRun|finishRun|coachStop|leaveForm/, `${head} leaves the run alone`);
  }
  assert.match(html, /<section id="scrRun"[\s\S]*<div class="felt-sheet" id="feltSheet" role="dialog" aria-labelledby="feltTitle" hidden>[\s\S]*<div id="feltRun"><\/div>[\s\S]*<\/section>\s*<!-- ── Result card/);
  assert.match(html, /<div id="wxPanel" class="wx-panel" hidden>[\s\S]*<button type="button" class="wx-hit" id="wxFelt" hidden><\/button>\s*<\/div>/);
  assert.match(js, /\$\('wxFelt'\)\.addEventListener\('click', openFeltSheet\);/);
  assert.match(js, /\$\('btnFeltDone'\)\.addEventListener\('click', closeFeltSheet\);/);
  assert.match(js, /if \(e\.key === 'Escape'\) closeFeltSheet\(\);/);
  assert.match(decl('function runAirChanged('), /if \(!\$\('feltSheet'\)\.hidden\) paintFeltSheet\(\);/, 'an open picker follows the forecast arriving');
  assert.match(decl('async function finishRun('), /closeCall\(\);\s*closeFeltSheet\(\);/);
  assert.match(js, /closeCall\(\);\s*closeFeltSheet\(\);\s*run\.startedAt = Date\.now\(\);/, 'a new run starts with it put away');
});

await t('in the debrief it is the “Wind on the ground” row, starts from the run’s, and grades again at Save only when changed', async () => {
  const paint = decl('function paintDebrief(');
  assert.match(paint, /<span class="label">Wind on the ground<\/span>/);
  assert.match(paint, /\$\{feltPickerHtml\(dbFor, dbWind\)\}/, 'the same picker as the run screen’s');
  assert.match(paint, /\+ \(feltChangeable\(dbFor\) \?/, 'not on a run kept from someone else’s link');
  assert.match(decl('function openDebrief('), /dbWind = cleanWindFelt\(s\.data\.windFelt\);/, 'prefilled from before or during the run');
  assert.match(js, /dbWind = feltSame\(dbWind, choice\) \? null : \(windFeltFor\(dbFor, choice\) \?\? dbWind\);\s*return repaintFrom\(felt, paintDebrief\);/);
  const save = decl('function saveDebrief(');
  assert.match(save, /const wind = feltChangeable\(s2\) && !sameFelt\(dbWind, s2\.data\.windFelt\) \? dbWind : undefined;/);
  assert.match(save, /if \(wind !== undefined\) regradeShown\(s2, wind\);/);
  assert.match(js, /\$\('dbCancel'\)\.addEventListener\('click', \(\) => \{ dbFor = null; dbDraft = null; dbWind = null;/);

  /* The card is drawn again once the new grade is in, if it is still the one on screen. */
  const drawn = [];
  const kept = { id: 'r', data: { weather: northerly(), trackStarted: RUN, windFelt: felt('calm') } };
  const sb = { currentScreen: 'scrResult', run: { session: kept }, pendingSession: null, toast() {}, imp: () => false, windWords,
    setWindFelt: async () => kept, renderResult: (x) => drawn.push(x) };
  vm.createContext(sb);
  vm.runInContext(decl('async function regradeShown('), sb);
  await sb.regradeShown(kept, felt('calm'));
  assert.deepEqual(drawn, [kept]);
  sb.currentScreen = 'scrHome';
  await sb.regradeShown(kept, felt('calm'));
  assert.equal(drawn.length, 1, 'not drawn over another screen');
  const changeable = vm.runInContext('feltChangeable', picker().sb);
  assert.ok(changeable({ data: { track: runTrack, result: {} } }));
  assert.ok(!changeable({ data: { track: runTrack, result: {}, imported: true } }), 'someone else’s run stays theirs');
  assert.ok(!changeable({ data: { trail } }), 'a trail not run yet has no grade to redo');
});

await t('every place a run’s wind is shown says it was felt, against what the forecast said', () => {
  assert.match(decl('function renderResult('), /const felt = windWords\(s, \{ imperial: imp\(\) \}\);/);
  assert.match(html, /<span class="label" id="resModelLabel">Modelled<\/span>\s*<p class="body small" id="resWind" hidden><\/p>/);
  assert.match(decl('function paintReplay('), /const felt = windWords\(s, \{ imperial: imp\(\), short: true \}\);[\s\S]*\+ \(felt \? ` · \$\{felt\}` : ''\)/);
  assert.match(decl('function sessionCard('), /\$\{felt \? ` · \$\{esc\(felt\)\}` : ''\}/, 'escaped, as any line in a list');

  /* The shared page and the PDF: their Weather section. */
  const base = { kind: 'trail', target: 'Person', wx: northerly(), runAt: RUN };
  const weather = (m) => detailSections(m).find(x => x.title === 'Weather');
  const plain = weather(base);
  assert.ok(!plain.rows.some(([k]) => k === 'Wind on the ground'));
  assert.equal(plain.note, 'Forecast for open ground, wind at 10 m (Open-Meteo)');
  const opp = weather({ ...base, windFelt: makeWindFelt('opposite', 0, RUN) });
  assert.deepEqual(opp.rows.find(([k]) => k === 'Wind'), ['Wind', '14 km/h from S']);
  assert.deepEqual(opp.rows.find(([k]) => k === 'Wind on the ground'), ['Wind on the ground', 'Wind from S — felt on the ground (forecast: from N)']);
  assert.match(opp.note, /as the handler felt it on the day/);
  const swirl = weather({ ...base, windFelt: felt('swirl') });
  assert.deepEqual(swirl.rows.find(([k]) => k === 'Wind'), ['Wind', '14 km/h'], 'no direction printed for a wind with none to trust');
  assert.deepEqual(swirl.rows.find(([k]) => k === 'Wind on the ground'), ['Wind on the ground', 'Wind swirling on the ground (forecast: from N, 14 km/h)']);
  const calm = weather({ ...base, windFelt: felt('calm') });
  assert.deepEqual(calm.rows.find(([k]) => k === 'Wind on the ground'), ['Wind on the ground', 'Calm on the ground (forecast: from N, 14 km/h)']);
});

await t('the picker’s targets take a gloved thumb, and it cannot push a narrow screen sideways', () => {
  const rule = (sel) => {
    const m = css.match(new RegExp(`\\n${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`));
    assert.ok(m, `app.css still has ${sel}`);
    return m[1];
  };
  assert.match(rule('.felt-quick .db-opt'), /min-height: 56px/);
  assert.match(rule('.felt-rose .db-opt'), /min-width: 0; min-height: 58px/);
  assert.match(rule('.felt-rose'), /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(rule('.felt-said'), /font-size: calc\(13\.5 \* var\(--px\)\).*overflow-wrap: anywhere/);
  assert.match(rule('.felt-ask'), /font-size: calc\(13\.5 \* var\(--px\)\)/);
  assert.match(rule('.felt-sheet'), /max-height: 80vh; overflow-y: auto;/, 'a short phone scrolls it');
  assert.match(rule('.wx-hit'), /position: absolute; inset: 0;/, 'the whole panel takes the tap');
  assert.match(rule('.wx-hint i'), /white-space: nowrap/);
});

console.log(`\n${pass} passed total\n`);
