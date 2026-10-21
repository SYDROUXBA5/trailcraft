/* The dog's own GPS track, imported after the run (dogtrack.js).

   A Garmin dog system (an Alpha handheld and its collars) exports one GPX
   file from Garmin Explore with the handheld's own walk and each dog's
   collar as separate, named tracks. These check the file is read safely,
   the dog's track can be picked out of it, cut to the run's own clock and
   refused in plain words when it cannot line up with the run; that it is
   kept small enough to sync, survives a merge, a backup and a restore; and,
   by lifting the grade and the re-grade out of app.js as felt.test.mjs
   does, that a run with one is measured on the dog's path, not the
   handler's, with nothing banked twice. */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import {
  dogTrackCheck, dogTrackPatch, dogTrackOf, dogAt, dogTrackUntil, thinDogTrack, fitDogTrack, cleanDogTrack, runWindow,
  DOG_TRACK_GONE, DOG_TRACK_MAX_POINTS, DOG_TRACK_SLACK_MS, DOG_GPS_ACC_M, DOG_NOISE_FLOOR_M, timedLine,
} from '../public/dogtrack.js';
import { gpxTracks, parseGpx, readGpx, GPX_READ_POINTS, GPX_MAX_BYTES, toGpx, notes, trailModel } from '../public/share.js';
import { toCloud, fromCloud, approxBytes, DOC_LIMIT, mergeOne, RUN_FIELDS, mergeCalibration, calibrationDiffers } from '../public/sync-core.js';
import { cleanResult } from '../public/share.js';
import { makeBackup, readBackup } from '../public/backup.js';
import { runFacts } from '../public/levels.js';
import { windAt, cleanWindFelt, windTrusted, feltOf, anchorFelt, FLAT, stability, regime } from '../public/field.js';
import { createStore, teachesDrift, runAgain, patchSession, targetById, APPROACH_V, driftRows } from '../public/store.js';
import { resultSentence } from '../public/share.js';
import { unwalkedPlan, ownRun, noLineYet } from '../public/debrief.js';
import { predictedOffsets } from '../public/sim.js';
import { changed } from '../public/params.js';
import {
  lineCorrect, signedOffsets, meanSigned, medianAbs, sideShares, sideOfDrift, sideAgreement,
  approachToWind, bearing, dist, fmtDur, fmtShort, project, pathLen,
} from '../public/geo.js';

let pass = 0;
const t = async (name, fn) => { await fn(); pass++; console.log(`  ok  ${name}`); };

const Parser = (() => {
  try {
    const { DOMParser } = createRequire(import.meta.url)('@xmldom/xmldom');
    /* Quiet about the broken files fed it on purpose; it still throws on them. */
    return class extends DOMParser { constructor() { super({ onError() {} }); } };
  } catch { return null; }
})();
const plainErr = (re) => (e) => e?.plain === true && re.test(e.message);

/* A trail laid eastwards at 08:00, run an hour later. */
const T0 = Date.UTC(2026, 8, 20, 8, 0);
const RUN = T0 + 60 * 60e3;
const HOME = { lat: 51.2, lon: -2.65 };
const trail = Array.from({ length: 20 }, (_, i) => ({ ...project(HOME, 90, i * 10), t: T0 + i * 10e3 }));
/* The phone, in the handler's hand: 5 m south of the line, every fix 10 s apart. */
const runTrack = trail.map((p, i) => ({ ...project(p, 180, 5), t: RUN + i * 10e3, acc: 3 }));
/* The collar, on the dog: 10 m north of the line, every 5 s from five
   minutes before Start to five minutes after the run, as a collar left on
   before and after does. */
const collar = Array.from({ length: 60 + 39 + 60 }, (_, i) => {
  const k = i - 60;                     // 0 at Start, 38 at the run's last fix
  const along = Math.max(0, Math.min(190, k * 5));
  return { ...project(project(HOME, 90, along), 0, 10), t: RUN + k * 5e3, ele: 40 + i * 0.1 };
});

const iso = (ms) => new Date(ms).toISOString().replace('.000Z', 'Z');
const trkpts = (pts) => pts.map(p => `      <trkpt lat="${p.lat.toFixed(7)}" lon="${p.lon.toFixed(7)}">`
  + (Number.isFinite(p.ele) ? `<ele>${p.ele.toFixed(2)}</ele>` : '')
  + (Number.isFinite(p.t) ? `<time>${iso(p.t)}</time>` : '')
  + '<extensions><gpxtpx:TrackPointExtension><gpxtpx:course>90</gpxtpx:course></gpxtpx:TrackPointExtension></extensions></trkpt>').join('\n');

/* Garmin Explore's export of an Alpha 200i with two collars: the handheld's
   own walk first, then each dog by name, as Garmin writes them. Bramble ran
   two hours later, so her track does not touch this run. */
const handheld = runTrack.map((p, i) => ({ lat: p.lat, lon: p.lon, t: p.t, ele: 41 + i * 0.05 }));
const bramble = Array.from({ length: 30 }, (_, i) => ({ ...project(HOME, 45, i * 8), t: RUN + 2 * 3600e3 + i * 5e3, ele: 39 }));
const GARMIN = `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<gpx xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxx="http://www.garmin.com/xmlschemas/GpxExtensions/v3"
     xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1" creator="Garmin Explore" version="1.1">
  <metadata><link href="http://www.garmin.com"><text>Garmin International</text></link><time>${iso(RUN + 3 * 3600e3)}</time></metadata>
  <trk>
    <name>Alpha 200i</name>
    <extensions><gpxx:TrackExtension><gpxx:DisplayColor>Black</gpxx:DisplayColor></gpxx:TrackExtension></extensions>
    <trkseg>
${trkpts(handheld)}
    </trkseg>
  </trk>
  <trk>
    <name>Rex</name>
    <extensions><gpxx:TrackExtension><gpxx:DisplayColor>Orange</gpxx:DisplayColor></gpxx:TrackExtension>
      <trkpt lat="10" lon="10"><time>${iso(RUN)}</time></trkpt></extensions>
    <trkseg>
${trkpts(collar.slice(0, 80))}
    </trkseg>
    <trkseg>
${trkpts(collar.slice(80))}
    </trkseg>
  </trk>
  <trk>
    <name>Bramble</name>
    <trkseg>
${trkpts(bramble)}
    </trkseg>
  </trk>
</gpx>`;

const session = (over = {}) => ({ id: 'run1', handlerId: 'h1', dogId: 'bo', targetId: 'person', startedAt: T0, summary: '', updatedAt: 5,
  data: { trail, track: runTrack, trackStarted: RUN, trackWaypoints: [], ...over } });

/* ── Reading the file ─────────────────────────────────────────────── */

await t('a Garmin file’s tracks are each listed: name, points, start and length; the extensions are not points', () => {
  if (!Parser) return console.log('      (no XML parser in this Node: GPX reading checked in the browser only)');
  const got = gpxTracks(GARMIN, Parser);
  assert.deepEqual(got.map(x => x.name), ['Alpha 200i', 'Rex', 'Bramble']);
  assert.deepEqual(got.map(x => x.count), [handheld.length, collar.length, bramble.length],
    'two segments joined, and the point hidden in the track’s extensions is not read');
  assert.ok(got.every(x => x.timed));
  assert.equal(got[1].startT, collar[0].t);
  assert.ok(Math.abs(got[1].lengthM - pathLen(collar)) < 1);
  assert.equal(got[1].points[3].ele, collar[3].ele, 'heights come with the points');
  assert.equal(got[1].points[3].t, collar[3].t);
  /* The laid-trail reader is unchanged: the first track with two points. */
  assert.equal(parseGpx(GARMIN, Parser).name, 'Alpha 200i');
});

await t('a file with no usable track, or one past what a phone should read, is refused in plain words', () => {
  if (!Parser) return;
  assert.throws(() => gpxTracks('<gpx><trk><trkseg><trkpt lat="51" lon="-2"/></trkseg></trk></gpx>', Parser), plainErr(/at least two points/));
  assert.throws(() => gpxTracks('<gpx><rte><rtept lat="51" lon="-2"/><rtept lat="51.1" lon="-2"/></rte></gpx>', Parser),
    plainErr(/no track/), 'a route is a plan, never a dog');
  assert.throws(() => gpxTracks('<kml/>', Parser), plainErr(/not a GPX file/));
  /* More points than the phone ever unpacks: counted in the text, before any parsing. */
  const many = `<gpx><trk><trkseg>${'<trkpt lat="51" lon="-2"/>'.repeat(GPX_READ_POINTS + 1)}</trkseg></trk></gpx>`;
  assert.throws(() => readGpx(many, class { parseFromString() { throw new Error('should not be parsed'); } }), plainErr(/too big to read/));
  /* Elements nested far deeper than any GPX file is. */
  const deep = `<gpx>${'<a>'.repeat(200)}${'</a>'.repeat(200)}</gpx>`;
  assert.throws(() => readGpx(deep, Parser), plainErr(/not a GPX file/));
  /* Two million empty elements of nothing. */
  const junk = `<gpx>${'<x/>'.repeat(2000001)}</gpx>`;
  assert.throws(() => readGpx(junk, Parser), plainErr(/too big to read/));
  assert.throws(() => readGpx(' '.repeat(GPX_MAX_BYTES + 1) + '<gpx/>', Parser), plainErr(/too big to read/));
  /* A name is a stranger's text: it is cut short. */
  const long = `<gpx><trk><name>${'R'.repeat(500)}</name><trkseg><trkpt lat="51" lon="-2"/><trkpt lat="51.001" lon="-2"/></trkseg></trk></gpx>`;
  assert.ok(gpxTracks(long, Parser)[0].name.length <= 80);
});

/* ── Lining it up with the run ────────────────────────────────────── */

const picked = (pts, name = 'Rex') => ({ name, points: pts, timed: true });

await t('the dog’s track is cut to the run’s own clock: the walk before Start and after the end is not the run', () => {
  const win = runWindow(session().data);
  assert.deepEqual(win, { from: RUN, to: runTrack[runTrack.length - 1].t });
  const got = dogTrackCheck(session().data, picked(collar));
  assert.equal(got.cut, true, 'what the collar logged before Start and after the end is left out');
  assert.equal(got.points[0].t, RUN, 'from Start');
  assert.equal(got.points[got.points.length - 1].t, win.to, 'to the run’s last fix');
  assert.deepEqual(Object.keys(got.points[1]).sort(), ['alt', 'lat', 'lon', 't'], 'a point is a place, a time and a height');
  /* A collar logging every 7 s crosses Start between fixes: a point is put where it crossed. */
  const sparse = collar.filter((_, i) => i % 7 === 3);
  const edge = dogTrackCheck(session().data, picked(sparse)).points;
  assert.equal(edge[0].t, RUN);
  assert.equal(edge[edge.length - 1].t, win.to);
  assert.ok(dist(edge[0], dogAt(sparse, RUN)) < 0.01, 'where its track crossed Start');
  assert.deepEqual(got.ask, [], 'it starts at the run, and covers it');
  assert.ok(got.startM < 20, `${got.startM}`);
});

await t('a track with no times, or none during the run, is refused and says why', () => {
  const untimed = collar.map(({ t, ...p }) => p);
  assert.throws(() => dogTrackCheck(session().data, { name: 'Rex', points: untimed }), plainErr(/no times in it/));
  const backwards = collar.map((p, i) => ({ ...p, t: RUN - i * 1000 }));
  assert.throws(() => dogTrackCheck(session().data, picked(backwards)), plainErr(/times jump backwards.*collar’s clock/),
    'a clock that keeps running backwards is no clock, and is not called "no times"');
  /* A collar's first fix without a time, and two segments overlapping by 2 s where they join: used, not refused. */
  const rough = collar.map((p, i) => (i === 0 ? { lat: p.lat, lon: p.lon } : i === 90 ? { ...p, t: collar[89].t - 2000 } : p));
  const used = dogTrackCheck(session().data, picked(rough)).points;
  assert.ok(used.length > 30 && used.every((p, i) => !i || p.t >= used[i - 1].t), 'in time order');
  assert.equal(timedLine(rough).length, collar.length - 2, 'the untimed fix and the step back are left out');
  if (Parser) {
    const listed = gpxTracks(`<gpx xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1"><trk><name>Rex</name><trkseg>${trkpts(rough)}</trkseg></trk></gpx>`, Parser)[0];
    assert.equal(listed.timed, true, 'and the picker says so too, not "no times"');
    assert.equal(listed.startT, collar[1].t);
  }
  assert.throws(() => dogTrackCheck(session().data, picked(bramble, 'Bramble')), plainErr(/not recorded during this run/));
  /* An hour out: a collar on the wrong time zone. */
  const zoned = collar.map(p => ({ ...p, t: p.t + 3600e3 }));
  assert.throws(() => dogTrackCheck(session().data, picked(zoned)), plainErr(/collar’s clock/));
  assert.throws(() => dogTrackCheck({ track: [] }, picked(collar)), plainErr(/no recorded times/));
  assert.throws(() => dogTrackCheck(session().data, picked(collar.slice(0, 1))), plainErr(/fewer than two points/));
});

await t('one that starts far from the run, or covers little of it, is asked about first', () => {
  const far = collar.map(p => ({ ...project(p, 0, 400), t: p.t }));
  const got = dogTrackCheck(session().data, picked(far), { fmtM: (m) => `${Math.round(m)} metres` });
  assert.equal(got.ask.length, 1);
  assert.match(got.ask[0], /^The dog’s track starts 4\d\d metres from where the run started\. Use it anyway\?$/);
  const part = collar.filter(p => p.t >= RUN + 150e3);
  const half = dogTrackCheck(session().data, picked(part));
  assert.match(half.ask[half.ask.length - 1], /covers only \d+ % of the run\. Use it anyway\?/);
});

await t('a long track is thinned, never cut short, and keeps where the dog was at least every 15 s', () => {
  const n = 12000;
  const pts = Array.from({ length: n }, (_, i) => ({ ...project(HOME, 90, (i % 600) * 0.3 + Math.floor(i / 600) * 0.01), t: RUN + i * 1000 }));
  const thin = thinDogTrack(pts);
  assert.ok(thin.length <= DOG_TRACK_MAX_POINTS && thin.length > 100, `${thin.length} points`);
  assert.equal(thin[0], pts[0]);
  assert.equal(thin[thin.length - 1], pts[n - 1], 'the end is kept');
  assert.ok(thin.every((p, i) => !i || p.t > thin[i - 1].t), 'still in time order');
  assert.ok(thinDogTrack(pts, 50).length <= 50, 'whatever the limit asked for');
  const still = Array.from({ length: 4000 }, (_, i) => ({ ...HOME, t: RUN + i * 1000 }));
  const kept = thinDogTrack(still);
  assert.ok(kept.every((p, i) => !i || p.t - kept[i - 1].t <= 15e3), 'a dog standing still is still somewhere at every moment');
});

await t('where the dog was at a moment is read along its own track', () => {
  const pts = [{ lat: 51, lon: -2, t: 1000 }, { lat: 51.001, lon: -2, t: 11000 }];
  assert.deepEqual(dogAt(pts, 6000), { lat: 51.0005, lon: -2, t: 6000 });
  assert.deepEqual(dogAt(pts, 500), { lat: 51, lon: -2, t: 500 }, 'within the slack, the end it is nearest');
  assert.equal(dogAt(pts, 1000 + 11000 + DOG_TRACK_SLACK_MS), null, 'and nowhere past it');
  assert.equal(dogTrackUntil(collar, collar[10].t).length, 11);
  assert.deepEqual(dogTrackUntil(collar, 0), [], 'before the collar’s first fix the dog has no place yet, not its next one');
  assert.equal(dogTrackUntil(collar, collar[0].t).length, 2, 'from its first fix, a line to draw');
  const src = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(src, /const here = sofar\.length \? sofar\[sofar\.length - 1\] : null;\n  setSrc\('nose', here \? pointsOf\(\[here\]\) : EMPTY\);/,
    'the replay puts no nose, and says no distance, before it');
});

/* ── Kept, synced, backed up, restored ────────────────────────────── */

await t('kept on the session: only a timed line of real places counts as the dog’s track', () => {
  const { points } = dogTrackCheck(session().data, picked(collar));
  const patch = dogTrackPatch(points, 'Rex', RUN + 3600e3);
  assert.deepEqual(patch.dogTrackFrom, { name: 'Rex', points: points.length, importedAt: RUN + 3600e3 });
  assert.equal(dogTrackOf(patch), points);
  assert.equal(dogTrackOf({ dogTrack: points.map(({ t, ...p }) => p) }), null);
  assert.equal(dogTrackOf({ dogTrack: [points[0]] }), null);
  assert.equal(dogTrackOf({ dogTrack: [{ lat: 99, lon: 0, t: 1 }, { lat: 0, lon: 0, t: 2 }] }), null);
  assert.equal(dogTrackOf({ ...DOG_TRACK_GONE }), null);
  assert.ok(RUN_FIELDS.includes('dogTrack') && RUN_FIELDS.includes('dogTrackFrom'), 'it belongs to the run, not the trail');
  const again = runAgain(session(patch), { id: 'run2', summary: '' });
  assert.equal('dogTrack' in again.data, false, 'the next dog on the trail starts without the last one’s collar');
});

await t('it travels to the cloud packed, and comes back exactly; a full session is thinned to fit', () => {
  const { points } = dogTrackCheck(session().data, picked(collar));
  const s = session(dogTrackPatch(points, 'Rex', RUN));
  const cloud = toCloud(s);
  assert.equal(typeof cloud.data.dogTrack.__pts, 'number', 'packed as columns, as the phone’s track is');
  assert.deepEqual(fromCloud(cloud), JSON.parse(JSON.stringify(s)));
  /* Three hours laid and three run, every second: most of a document already. */
  const walk = (n, t0) => Array.from({ length: n }, (_, i) => ({ lat: 51.2 + i * 1e-5, lon: -2.6 + i * 1e-5, t: t0 + i * 1000, acc: 5, alt: 42 }));
  const big = { ...session(), data: { trail: walk(10500, T0), track: walk(10500, RUN), trackStarted: RUN } };
  const fat = walk(DOG_TRACK_MAX_POINTS, RUN).map(({ acc, ...p }) => p);
  const fitted = fitDogTrack(big, fat);
  assert.ok(fitted && fitted.length < fat.length, `thinned to ${fitted?.length}`);
  assert.ok(approxBytes(toCloud({ ...big, data: { ...big.data, ...dogTrackPatch(fitted, 'Rex', RUN) } })) < DOC_LIMIT,
    'the session still syncs as one document');
  assert.equal(fitDogTrack(session(), fat), fat, 'an ordinary session takes it as it is');
  const huge = { ...big, data: { ...big.data, contamination: [{ points: walk(2500, T0) }] } };
  assert.equal(fitDogTrack(huge, fat), null, 'and one with no room says so rather than failing to sync');
  /* Room is left for what comes after: a debrief, marks, a contamination trail. */
  const after = { ...big, data: { ...big.data, ...dogTrackPatch(fitted, 'Rex', RUN), contamination: [{ points: walk(1500, T0) }] } };
  assert.ok(approxBytes(toCloud(after)) < DOC_LIMIT, 'a contamination trail added later still fits');
  /* A blind trail keeps room for the laid line still to come, as long as its run. */
  const blindBig = { ...session(), data: { track: walk(10500, RUN), trackStarted: RUN, lineLater: true } };
  const forLine = fitDogTrack(blindBig, fat, { lineToCome: true });
  assert.ok(forLine && forLine.length < fat.length, `thinned to ${forLine?.length} for the line to come`);
  const lined = { ...blindBig, data: { ...blindBig.data, trail: walk(10500, T0), ...dogTrackPatch(forLine, 'Rex', RUN) } };
  assert.ok(approxBytes(toCloud(lined)) < DOC_LIMIT, 'and the line, when it comes, still fits');
});

await t('a merge keeps it with the grade made on it, and taking it off is not undone by an older copy', () => {
  const { points } = dogTrackCheck(session().data, picked(collar));
  const withTrack = session({ ...dogTrackPatch(points, 'Rex', RUN), result: { kind: 'trail', dogTrack: true } });
  /* A phone that never pulled the run changed its name: the run, its track with it, comes across. */
  const bare = { ...session(), dogId: null, data: { trail }, name: 'Lane', updatedAt: 9 };
  const { keep } = mergeOne({ ...withTrack, updatedAt: 5 }, bare, { union: true });
  assert.equal(keep.name, 'Lane');
  assert.equal(keep.data.dogTrack.length, points.length);
  /* Taken off on one phone and graded again: the newer copy has null, and the older copy's track stays out. */
  const removed = session({ ...DOG_TRACK_GONE, result: { kind: 'trail' } });
  const merged = mergeOne({ ...withTrack, updatedAt: 5 }, { ...removed, updatedAt: 9 }, { union: true }).keep;
  assert.equal(merged.data.dogTrack, null);
  assert.equal(merged.data.dogTrackFrom, null);
});

await t('a backup carries it, and a restore checks it as it checks every other line', () => {
  const { points } = dogTrackCheck(session().data, picked(collar));
  const good = session(dogTrackPatch(points, 'Rex', RUN + 60e3));
  const back = (s) => readBackup(JSON.stringify(makeBackup({ sessions: [s] })));
  const out = back(good);
  assert.deepEqual(out.sessions[0].data.dogTrack, points);
  assert.deepEqual(out.sessions[0].data.dogTrackFrom, { name: 'Rex', points: points.length, importedAt: RUN + 60e3 });
  /* Not a list of places: the session is damaged, as with any other line. */
  const bad = back({ ...good, data: { ...good.data, dogTrack: [{ lat: 'x' }] } });
  assert.equal(bad.sessions.length, 0);
  assert.equal(bad.damaged.sessions, 1);
  assert.equal(back({ ...good, data: { ...good.data, dogTrackFrom: 'Rex' } }).damaged.sessions, 1);
  /* A time out of its era takes the line's clock, and a track with no clock goes, with its note. */
  const era = back({ ...good, data: { ...good.data, dogTrack: points.map((p, i) => (i === 3 ? { ...p, t: 1 } : p)) } });
  assert.equal(era.sessions[0].data.dogTrack, null);
  assert.equal(era.sessions[0].data.dogTrackFrom, null);
  assert.ok(era.sessions[0].data.track.length > 1, 'the rest of the run is kept');
  /* Longer than the app ever writes: thinned, and its note made true. */
  const long = Array.from({ length: 9000 }, (_, i) => ({ ...project(HOME, 90, i * 0.2), t: RUN + i * 1000 }));
  const thinned = back({ ...good, data: { ...good.data, dogTrack: long, dogTrackFrom: { name: 'Rex', points: 2, importedAt: 'soon' } } });
  const d = thinned.sessions[0].data;
  assert.ok(d.dogTrack.length <= DOG_TRACK_MAX_POINTS);
  assert.equal(d.dogTrackFrom.points, d.dogTrack.length);
  assert.equal(d.dogTrackFrom.importedAt, long[long.length - 1].t);
  assert.deepEqual(cleanDogTrack({ track: runTrack }), { track: runTrack }, 'a run without one is left alone');
});

/* ── What a run with one is measured on ───────────────────────────── */

await t('team levels read the dog’s track: the trail it covered, and where it was at the indication', () => {
  /* The handler 40 m south of the whole trail, behind a hedge; the dog on it. */
  const wide = trail.map((p, i) => ({ ...project(p, 180, 40), t: RUN + i * 10e3, acc: 3 }));
  const onLine = trail.map((p, i) => ({ lat: p.lat, lon: p.lon, t: RUN + i * 10e3 }));
  const end = trail[trail.length - 1];
  const ind = { kind: 'Indication', ...project(end, 180, 40), t: RUN + 190e3 };
  const s = { ...session({ track: wide, trackWaypoints: [ind], found: true }) };
  const phone = runFacts(s);
  assert.ok(phone.coverage < 0.2, `the phone covers ${phone.coverage}`);
  assert.equal(phone.indication, false, 'marked 40 m from the end');
  assert.equal(phone.onDogTrack, false);
  const dog = runFacts({ ...s, data: { ...s.data, dogTrack: onLine, dogTrackFrom: { name: 'Rex', points: 20, importedAt: RUN } } });
  assert.ok(dog.coverage > 0.95, `the dog covers ${dog.coverage}`);
  assert.equal(dog.indication, true, 'the dog was at the end when it was marked');
  assert.ok(dog.indicationM < 1);
  assert.equal(dog.onDogTrack, true);
  /* A runaway with no line: how far the dog got is the dog's own. */
  const blind = { ...s, data: { track: wide.slice(0, 5), trackStarted: RUN, dogTrack: onLine, lineLater: true } };
  assert.ok(Math.abs(runFacts(blind).lengthM - pathLen(onLine)) < 15);
});

/* The grade and the re-grade, lifted out of app.js onto a real store. */
const js = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
function between(from, to) {
  const i = js.indexOf(from);
  const j = js.indexOf(to, i + from.length);
  assert.ok(i >= 0 && j > i, `app.js still has ${from.trim().slice(0, 40)}`);
  return js.slice(i, j);
}
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
const northerly = () => ({
  time: '2026-09-20T08:00', temp: 12, soil_temp: 11, wind_speed: 4, wind_gusts: 7, wind_direction: 0,
  series: Array.from({ length: 16 }, (_, i) => ({ t: T0 - 30 * 60e3 + i * 15 * 60e3, temp: 12, soil_temp: 11,
    wind_speed: 4, wind_gusts: 7, wind_direction: 0 })),
});

function app() {
  const db = createStore(fakeBackend());
  const said = [], asked = [], shown = [];
  const sb = { noLineYet,
    db, S: { dogs: [{ id: 'bo', name: 'Bo', lineM: 8 }] }, BUILD: 'test',
    rec: { kind: null, on: false, started: RUN }, run: { session: null }, pendingSession: null,
    currentScreen: 'scrLog', replay: { s: null }, clipUi: { job: null },
    targetById, unwalkedPlan, ownRun, windAt, cleanWindFelt, windTrusted, feltOf, anchorFelt, stability, regime, FLAT, predictedOffsets, changed,
    lineCorrect, signedOffsets, meanSigned, medianAbs, sideShares, sideOfDrift, sideAgreement, approachToWind, bearing, dist, pathLen,
    dogTrackCheck, dogTrackPatch, dogTrackOf, dogAt, fitDogTrack, DOG_TRACK_GONE, DOG_GPS_ACC_M, DOG_NOISE_FLOOR_M,
    fmtDur, fmtM: (m) => fmtShort(m, false), fmtKm: (m) => `${(m / 1000).toFixed(2)} km`, APPROACH_V, resultSentence, teachesDrift, patchSession,
    unitsForText: () => ({ imperial: false, fahrenheit: false, coord: 'dd', when: String }),
    terrainFor: () => Promise.resolve(FLAT),
    fetchWeather: () => Promise.reject(new Error('offline')), WX_WAIT: 10,
    guardSave: (s, fn) => fn(), snap() {}, saveTrouble: null,
    toast: (m) => said.push(m), confirm: (q) => { asked.push(q); return sb.answer ?? true; }, answer: true,
    renderResult: (s) => shown.push(s), runLevelled: (s) => shown.push(['level', s.id]),
    Promise, Number, Math, Object, JSON, Error,
  };
  vm.createContext(sb);
  vm.runInContext([
    decl('function travelBrg('),
    between('/* `rebank` is for a run graded again', '\nfunction searchResult('),
    decl('function searchResult('),
    decl('function saveSession('),
    decl('function foldIntoPending('),
    decl('function keepPatch('),
    between('/* ── The dog\'s own GPS track, imported after the run', '/* ── The wind on the ground'),
    'let feltQueue = Promise.resolve();',
  ].join('\n'), sb);
  return { sb, db, said, asked, shown };
}

const graded = (over = {}) => session({ weather: northerly(), ...over });

await t('graded on the dog’s path, not the phone’s: no line added, a GPS tolerance kept, and said so', async () => {
  const { sb } = app();
  const phone = await sb.computeResult(graded(), runTrack, [], RUN, { bank: false });
  assert.equal(phone.mainSide, 'right', 'the phone, south of an eastward line, reads right');
  assert.equal(phone.dogTrack, undefined);
  const { points } = dogTrackCheck(graded().data, picked(collar));
  const dog = await sb.computeResult(graded(dogTrackPatch(points, 'Rex', RUN)), runTrack, [], RUN, { bank: false });
  assert.equal(dog.dogTrack, true, 'the result says what it was graded on');
  assert.equal(dog.mainSide, 'left', 'the collar, 10 m north, reads left');
  assert.ok(Math.abs(dog.medAbs - 10) < 1.5, `the dog’s own 10 m, with no line-length added (${dog.medAbs})`);
  assert.equal(dog.accMed, DOG_GPS_ACC_M, 'the collar’s accuracy stands in for the phone’s');
  /* Inside the dead band no fix is given a side in, a side is not read. */
  const close = collar.map(p => ({ ...project(p, 180, 8.5), t: p.t }));
  const near = await sb.computeResult(graded(dogTrackPatch(dogTrackCheck(graded().data, picked(close)).points, 'Rex', RUN)), runTrack, [], RUN, { bank: false });
  assert.ok(near.medAbs < DOG_NOISE_FLOOR_M, `${near.medAbs}`);
  assert.equal(near.noisy, true);
});

await t('a dog working close and steady on one side is read, and banked, on its collar', async () => {
  /* 4 m north of the line, every fix: closer than the old 6 m collar figure, well outside the 3 m dead band. */
  for (const off of [3.5, 4, 5]) {
    const { sb, db } = app();
    const steady = collar.map(p => ({ ...project(p, 180, 10 - off), t: p.t }));
    const s = graded(dogTrackPatch(dogTrackCheck(graded().data, picked(steady)).points, 'Rex', RUN));
    db.addSession(s);
    const r = await sb.computeResult(s, runTrack, [], RUN, { bank: true });
    assert.equal(r.mainSide, 'left', `${off} m north reads left`);
    assert.equal(r.noisy, false, `${off} m is readable on a collar (${r.medAbs})`);
    assert.equal(db.calibration('bo').length, 1, 'and is banked');
    db.updateSession('run1', { data: { result: r } });
    assert.equal(driftRows(db.calibration('bo'), db.sessions()).length, 1, 'and read');
  }
});

await t('the collar’s minute either side of the run is never graded: not the side, the length, the end or the find', async () => {
  const { sb } = app();
  /* The same collar, but its fixes in the minute before Start and after the end 50 m off to the south. */
  const wild = collar.map(p => (p.t < RUN || p.t > runTrack[runTrack.length - 1].t
    ? { ...project(p, 180, 50), t: p.t, ele: p.ele } : p));
  const tame = collar.filter(p => p.t >= RUN && p.t <= runTrack[runTrack.length - 1].t);
  const on = (pts) => graded(dogTrackPatch(dogTrackCheck(graded().data, picked(pts)).points, 'Rex', RUN));
  const a = await sb.computeResult(on(wild), runTrack, [], RUN, { bank: false });
  const b = await sb.computeResult(on(tame), runTrack, [], RUN, { bank: false });
  assert.equal(a.mainSide, b.mainSide);
  assert.ok(Math.abs(a.medAbs - b.medAbs) < 0.01, `${a.medAbs} vs ${b.medAbs}`);
  /* A runaway with no line: how far it got, where it ended, and the indication. */
  const ind = { kind: 'Indication', ...collar[98], t: runTrack[runTrack.length - 1].t };
  const facts = (pts) => runFacts({ ...session({ trackWaypoints: [ind], found: true }),
    data: { track: runTrack, trackStarted: RUN, trackWaypoints: [ind], found: true, lineLater: true,
      ...dogTrackPatch(dogTrackCheck(session().data, picked(pts)).points, 'Rex', RUN) } });
  const fa = facts(wild), fb = facts(tame);
  assert.ok(Math.abs(fa.lengthM - fb.lengthM) < 1, `${fa.lengthM} vs ${fb.lengthM}`);
  assert.deepEqual(fa.endPt, fb.endPt);
  assert.equal(fa.indicationM, fb.indicationM);
});

await t('a search measures the catch where the dog was, not where the handler marked it', async () => {
  const { sb } = app();
  const hide = project(HOME, 0, 120);
  const path = Array.from({ length: 13 }, (_, i) => ({ ...project(HOME, 0, i * 10), t: RUN + i * 10e3, acc: 3 }));
  /* The handler marks the indication 15 m back down the line. */
  const ind = { kind: 'Indication', ...project(hide, 180, 15), t: RUN + 120e3 };
  const search = { ...graded({ hides: [hide], track: path.map(p => ({ ...project(p, 180, 15), t: p.t, acc: 3 })), trackWaypoints: [ind] }), targetId: 'article' };
  const phone = await sb.computeResult(search, search.data.track, [ind], RUN, { bank: false, firstAt: RUN });
  assert.equal(phone.catchM, 15);
  const dog = await sb.computeResult({ ...search, data: { ...search.data, dogTrack: path.map(({ acc, ...p }) => p) } },
    search.data.track, [ind], RUN, { bank: false, firstAt: RUN });
  assert.equal(dog.catchM, 0);
  assert.equal(dog.dogTrack, true);
  /* A collar track that stops minutes before the indication measured nothing: the result does not claim it. */
  const short = path.slice(0, 3).map(({ acc, ...p }) => p);
  const missed = await sb.computeResult({ ...search, data: { ...search.data, dogTrack: short } },
    search.data.track, [ind], RUN, { bank: false, firstAt: RUN });
  assert.equal(missed.catchM, 15, 'measured at the handler’s mark');
  assert.equal(missed.dogTrack, undefined);
  const none = await sb.computeResult({ ...search, data: { ...search.data, dogTrack: path.map(({ acc, ...p }) => p) } },
    search.data.track, [], RUN, { bank: false, firstAt: RUN });
  assert.equal(none.dogTrack, undefined, 'nor does a search with no indication');
});

await t('imported, the run is graded again on it and its drift row put right, not added to; removed, back again', async () => {
  const { sb, db, said, shown } = app();
  db.addSession(graded());
  const first = await sb.computeResult(graded(), runTrack, [], RUN, { bank: true });
  db.updateSession('run1', { summary: first.sentence, data: { result: first } });
  assert.equal(db.calibration('bo').length, 1);
  const before = db.calibration('bo')[0].mean;

  await sb.applyDogTrack('run1', picked(collar), 'export');
  const now = db.sessions().find(x => x.id === 'run1');
  assert.equal(now.data.dogTrackFrom.name, 'Rex');
  assert.equal(now.data.dogTrack.length, now.data.dogTrackFrom.points);
  assert.equal(now.data.result.dogTrack, true);
  assert.equal(now.summary, now.data.result.sentence);
  assert.deepEqual(said.slice(-1), ['Dog’s track imported. The run is graded on it. Only the part recorded during the run is used.']);
  assert.equal(db.calibration('bo').length, 1, 'one row for the run, never two');
  assert.ok(Math.sign(db.calibration('bo')[0].mean) !== Math.sign(before), 'learned from the dog’s side of the line now');
  assert.deepEqual(shown.filter(Array.isArray), [['level', 'run1']], 'its level read again');

  sb.answer = false;
  await sb.removeDogTrack('run1');
  assert.ok(db.sessions()[0].data.dogTrack, 'kept when the handler says no');
  sb.answer = true;
  await sb.removeDogTrack('run1');
  const off = db.sessions().find(x => x.id === 'run1');
  assert.equal(off.data.dogTrack, null);
  assert.equal(off.data.result.dogTrack, undefined, 'graded on the phone again');
  assert.equal(off.data.result.mainSide, 'right');
  assert.equal(db.calibration('bo').length, 1);
  assert.equal(said[said.length - 1], 'Dog’s track removed');
});

await t('a run graded again on its collar counts once in the dog’s drift on every phone, after the cloud has its old row', async () => {
  const { sb, db } = app();
  db.addSession(graded());
  const first = await sb.computeResult(graded(), runTrack, [], RUN, { bank: true });
  db.updateSession('run1', { summary: first.sentence, data: { result: first } });
  const cloud = db.calibration('bo').map(r => ({ ...r }));      // the phone grade's row, synced
  const k1 = cloud[0].k;
  await new Promise(r => setTimeout(r, 2));                       // a later stamp, as a real re-grade is
  await sb.applyDogTrack('run1', picked(collar), 'export');
  const mine = db.calibration('bo');
  assert.equal(mine.length, 1);
  assert.notEqual(mine[0].k, k1, 'the collar changes what the run teaches');
  for (const merged of [mergeCalibration(mine, cloud), mergeCalibration(cloud, mine)]) {
    assert.equal(merged.length, 1, 'one row for the run, whichever side merges');
    assert.equal(merged[0].k, mine[0].k, 'the newer grade’s');
    assert.equal(driftRows(merged, db.sessions()).length, 1);
  }
  assert.equal(calibrationDiffers(mergeCalibration(mine, cloud), cloud), true, 'and it goes up to replace the old one');
  /* A cloud that already holds the run twice, from before rows were keyed by their run, is read once. */
  const legacy = [{ t: RUN, k: 0.4 }, { t: RUN, k: 0.2 }];
  assert.equal(mergeCalibration(legacy, []).length, 1);
  assert.deepEqual(mergeCalibration(legacy, []), mergeCalibration([], [...legacy].reverse()), 'every phone keeps the same one');
  assert.equal(driftRows(legacy, []).length, 1);
  /* Set aside later than it was banked: the setting aside wins, and a tie still keeps it aside. */
  const aside = { ...mine[0], skip: true, at: mine[0].at + 1 };
  assert.equal(mergeCalibration([aside], mine)[0].skip, true);
  assert.equal(mergeCalibration(mine, [{ ...mine[0], skip: true }])[0].skip, true);
});

await t('refused in plain words, and never on a run kept from a link or while recording', async () => {
  const { sb, db, said } = app();
  db.addSession(graded());
  await sb.applyDogTrack('run1', picked(bramble, 'Bramble'));
  assert.match(said.pop(), /not recorded during this run/);
  assert.equal(db.sessions()[0].data.dogTrack, undefined);
  sb.rec.on = true;
  await sb.applyDogTrack('run1', picked(collar));
  assert.match(said.pop(), /only go on a run recorded on this phone/);
  sb.rec.on = false;
  db.updateSession('run1', { data: { imported: { from: 'Kim', at: RUN + 3600e3 } } });
  await sb.applyDogTrack('run1', picked(collar));
  assert.match(said.pop(), /only go on a run recorded on this phone/);
  assert.equal(db.sessions()[0].data.dogTrack, undefined);
  /* Asked first, and left off when the handler says no. */
  const { sb: sb2, db: db2, asked } = app();
  db2.addSession(graded());
  sb2.answer = false;
  await sb2.applyDogTrack('run1', picked(collar.map(p => ({ ...project(p, 0, 400), t: p.t }))));
  assert.equal(asked.length, 1);
  assert.equal(db2.sessions()[0].data.dogTrack, undefined);
});

await t('a blind trail keeps it until its line comes, then is graded on it', async () => {
  const { sb, db, said } = app();
  const blind = { ...graded({ trail: undefined, lineLater: true }), data: { track: runTrack, trackStarted: RUN, trackWaypoints: [], lineLater: true } };
  db.addSession(blind);
  await sb.applyDogTrack('run1', picked(collar));
  assert.ok(db.sessions()[0].data.dogTrack.length > 1);
  assert.equal(db.sessions()[0].data.result, undefined, 'nothing graded yet');
  assert.match(said.pop(), /graded on it once the laid trail is added/);
});

await t('the GPX file and the report carry it, named as the dog’s own', () => {
  const { points } = dogTrackCheck(session().data, picked(collar));
  const s = session({ ...dogTrackPatch(points, 'Rex', RUN), result: { kind: 'trail', dogTrack: true } });
  const m = { ...trailModel(s, { dog: { name: 'Bo', lineM: 8 } }), dogTrack: points, dogTrackFrom: s.data.dogTrackFrom };
  const gpx = toGpx(m);
  assert.match(gpx, /<name>Bo’s GPS track<\/name>\s*\n\s*<desc>From the dog’s own GPS collar \(Rex\), imported after the run<\/desc>\s*\n\s*<type>Dog GPS track<\/type>/);
  /* Beside it, the phone's line is named for whose walk it is, not as a second dog. */
  assert.match(gpx, /<name>Handler’s walk \(phone\)<\/name>\s*\n\s*<desc>Recorded on the handler’s phone<\/desc>\s*\n\s*<type>Handler<\/type>/);
  assert.ok(!/Bo’s run/.test(gpx));
  assert.match(toGpx(trailModel(session(), { dog: { name: 'Bo', lineM: 8 } })), /<name>Bo’s run<\/name>/, 'without one, the run is the dog’s as before');
  assert.equal((gpx.match(/<trk>/g) || []).length, 3, 'the laid trail, the phone’s run and the dog’s track');
  if (Parser) assert.deepEqual(gpxTracks(gpx, Parser).map(x => x.count), [trail.length, runTrack.length, points.length], 'and reads back');
  assert.ok(notes(m).some(n => /^Graded on the dog’s own GPS track \(Rex\)/.test(n)));
  assert.ok(!('dogTrack' in trailModel(s, {})), 'a link carries the run, not a second track it has no room for');
  /* But it says its numbers came from a collar it does not carry. */
  const link = trailModel(s, {});
  assert.equal(cleanResult(link.result).dogTrack, true);
  assert.ok(notes(link).includes('Graded on the dog’s own GPS track, which this link does not carry; the line shown is the handler’s phone.'));
  assert.equal(cleanResult({ ...link.result, dogTrack: 'yes' }).dogTrack, false, 'only a true claims the collar');
});

await t('the GPX check is linear on junk, and steps over CDATA and comments', () => {
  const t0 = Date.now();
  assert.throws(() => readGpx('<gpx>' + '<a'.repeat(1e6), class { parseFromString() { return null; } }), plainErr(/GPX/));
  assert.throws(() => readGpx('<' + 'a'.repeat(4e6), class { parseFromString() { return null; } }), plainErr(/GPX/));
  assert.ok(Date.now() - t0 < 1000, `${Date.now() - t0} ms`);
  assert.throws(() => readGpx('<gpx><![CDATA[never closed' + '<![CDATA['.repeat(2e5), Parser || class {}), plainErr(/not a GPX file/));
  if (!Parser) return;
  /* HTML in descriptions, as many exporters write them: an unclosed <br> is not nesting. */
  const wpts = Array.from({ length: 45 }, (_, i) =>
    `<wpt lat="51.2${i}" lon="-2.6"><name>W${i}</name><desc><![CDATA[Gate<br>stile <p>left]]></desc></wpt>`).join('\n');
  const html = `<gpx xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">${wpts}<!-- <a><a><a> --><trk><name>Rex</name><trkseg>${trkpts(collar.slice(0, 40))}</trkseg></trk></gpx>`;
  assert.equal(parseGpx(html, Parser).points.length, 40);
  assert.equal(gpxTracks(html, Parser)[0].count, 40);
});

await t('a session grown after the import thins the dog’s track rather than stopping it syncing', () => {
  assert.match(js, /const refit = refitDogTrack\(patchSession\(s, patch\)\);/, 'when the laid line is added');
  assert.match(js, /const refit = refitDogTrack\(patchSession\(s, \{ data: \{ contamination: list \} \}\)\);/, 'and a contamination trail');
  assert.match(js, /fitDogTrack\(s, check\.points, \{ lineToCome: noLineYet\(s\.data\) \}\)/, 'room kept for a blind trail’s line');
  const sb = { fitDogTrack, dogTrackOf, dogTrackPatch, DOG_TRACK_GONE, Number, Date };
  vm.createContext(sb);
  vm.runInContext(decl('function refitDogTrack('), sb);
  const walk = (n, t0) => Array.from({ length: n }, (_, i) => ({ lat: 51.2 + i * 1e-5, lon: -2.6 + i * 1e-5, t: t0 + i * 1000, alt: 42 }));
  const dog = walk(DOG_TRACK_MAX_POINTS, RUN);
  assert.equal(sb.refitDogTrack(session(dogTrackPatch(dog, 'Rex', RUN))), null, 'room enough: left as it is');
  const grown = { ...session(), data: { trail: walk(13000, T0), track: walk(13000, RUN), trackStarted: RUN, ...dogTrackPatch(dog, 'Rex', RUN) } };
  const thinner = sb.refitDogTrack(grown);
  assert.ok(thinner.dogTrack.length < dog.length);
  assert.deepEqual(JSON.parse(JSON.stringify(thinner.dogTrackFrom)), { name: 'Rex', points: thinner.dogTrack.length, importedAt: RUN });
  assert.ok(approxBytes(toCloud({ ...grown, data: { ...grown.data, ...thinner } })) < DOC_LIMIT);
  const full = { ...grown, data: { ...grown.data, contamination: [{ points: walk(3000, T0) }] } };
  assert.deepEqual(JSON.parse(JSON.stringify(sb.refitDogTrack(full))), { ...DOG_TRACK_GONE }, 'no room at all: the caller is told, never a run that cannot sync');
});

await t('wired: the result, the replay, the map, the video and the files', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /<button class="btn" id="btnDogTrack">Import the dog’s GPS track<\/button>/);
  assert.match(html, /<p class="body small muted" id="dogTrackHint">From Garmin Explore: export the dog’s track as GPX, then choose it here\.<\/p>/);
  assert.match(html, /<button class="btn ghost small" id="btnDogTrackOff" hidden>Remove the dog’s track<\/button>/);
  assert.match(html, /<button class="btn ghost" id="repDogTrack">Import the dog’s GPS track<\/button>/);
  /* No accept on the file box: iOS greys out a .gpx it has no app for when asked for that type. */
  assert.match(html, /<input id="dogTrackFile" type="file" hidden>/);
  assert.match(html, /id="dogPick" hidden role="dialog" aria-modal="true"/);
  assert.match(js, /const corrected = dogPts \?\? lineCorrect\(track, dogRow\?\.lineM \?\? 0\);/);
  assert.match(decl('function paintReplay('), /const sofar = dogPts \? dogTrackUntil\(dogPts, at\) : handlerSofar;/);
  assert.match(decl('function paintReplay('), /setSrc\('handler', dogPts \? lineOf\(handlerSofar\) : EMPTY\);/);
  assert.match(js, /add\(\{ id: 'handler-line', type: 'line', source: 'handler',/);
  assert.match(js, /saveGpx\(fileModelOf\(shareOutSession\)\)/);
  assert.match(js, /savePdf\(fileModelOf\(shareOutSession\)\)/);
  assert.match(decl('function renderResult('), /paintDogTrack\(s\);/);
  const sw = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
  assert.match(sw, /'dogtrack\.js'/);
  /* The map tutorial's comment sits over the map tutorial, not over the picker. */
  assert.match(html, /<!-- How to move a 3D map with two fingers[^]*?-->\n<div class="map-tut" id="mapTut"/);
  /* Save video draws the handler's walk white and thin, as the map does, never in the dog's colour. */
  const clip = readFileSync(new URL('../public/clip.js', import.meta.url), 'utf8');
  const thin = clip.slice(clip.indexOf('  if (thin) {'), clip.indexOf('    return;', clip.indexOf('  if (thin) {')));
  assert.match(thin, /strokeStyle = WHITE; ctx\.lineWidth = 2/);
  assert.ok(!/dog\?\.colour|dog\?\.casing/.test(thin));
});

console.log(`\n${pass} passed total\n`);
