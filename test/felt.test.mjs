/* The wind on the ground: the handler's word put in place of the forecast's.

   A handler ran a trail with the wind on the ground blowing from the exact
   opposite side to the forecast, and every view of that run (the plume, the
   coach, the replay, the grade and what the dog's drift record learned) was
   built on the forecast. The correction is kept on the session as windFelt
   and laid over the forecast in field.js windAt, the one place every view
   reads a run's wind. These check the correction itself, where it travels
   (links, kept runs, crash copies, a second run), what it does to the drift
   record. */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import {
  windAt, forecastAt, laidWind, feltWeather, cleanWindFelt, makeWindFelt, windFeltFor, feltMoment,
  feltTurn, windTrusted, nearestPoint, windWords, forecastSaid, CALM_MS, WIND_FELT_V, FLAT, stability, regime,
} from '../public/field.js';
import {
  createStore, teachesDrift, driftRows, rebankRows, runAgain, patchSession, targetById, APPROACH_V,
} from '../public/store.js';
import { packDraft, unpackDraft } from '../public/draft.js';
import { trailModel, encodeShared, decodeShared, sessionFromModel, keptSession, resultSentence, liveMeta } from '../public/share.js';
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

console.log(`\n${pass} passed total\n`);
