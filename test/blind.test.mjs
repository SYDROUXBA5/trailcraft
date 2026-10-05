/* A blind trail: a trail laid without this phone (on the layer's own phone
   or watch, or a real search). The handler taps Blind trail where they
   stand, the dog is recorded until Found or Done, and nothing is graded,
   because there is no line. The layer's Trail Card or GPX file can be added
   afterwards and the run is graded against it then.

   These check the pure parts: the session it starts as, the GPX file read
   in, what is asked before a line is put on, what the line puts on the
   session, the honest sentence while there is no line, and that every
   reader of a session (the link model, the report, the GPX export, the
   stats, the call maths, the log's search) neither crashes on a trail with
   no line nor claims a grade, an age or a laid trail it does not have. */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { noLineYet, unwalkedPlan, ranBlind } from '../public/debrief.js';
import {
  blindSession, lineCheck, linePatch, patchSession, teachesDrift, runAgeMin, handlerStats, dogStats,
  canLayAgain, routeOf, runAgain, LINE_ASK_M,
} from '../public/store.js';
import {
  parseGpx, blindSummary, trailModel, headline, detailSections, notes, toGpx, fileBase, liveMeta, liveModel, GPX_MAX_POINTS,
} from '../public/share.js';
import { mergeOne } from '../public/sync-core.js';
import { callVerdict, scorable, calibrationLosses, CONFIDENCE } from '../public/call.js';
import { logRows, filterRows, searchWords } from '../public/log.js';
import { project, pathLen } from '../public/geo.js';

let pass = 0;
const t = async (name, fn) => { await fn(); pass++; console.log(`  ok  ${name}`); };

const NOW = Date.UTC(2026, 9, 5, 9, 0);
const RUN = NOW + 60e3;
const HOME = { lat: 51.2, lon: -2.6 };

/* A dog's track heading north from HOME for a couple of hundred metres. */
const track = Array.from({ length: 40 }, (_, i) => ({ ...project(HOME, 0, i * 5), t: RUN + i * 4000, acc: 4 }));
/* The layer's line, laid an hour before the dog set off, a few metres west. */
const laid = Array.from({ length: 40 }, (_, i) => ({ ...project(project(HOME, 270, 4), 0, i * 5), t: RUN - 3600e3 + i * 3000 }));

/* The session as Stop leaves it: the run kept, nothing graded. */
const ran = (extra = {}) => {
  const s = blindSession({ id: 'b1', handlerId: 'h1', dogId: 'd1', now: NOW });
  return patchSession(s, { summary: 'x', data: { track, trackStarted: RUN, trackWaypoints: [], coach: null, found: true, ...extra } });
};

await t('Blind trail starts a person trail for the picked dog, with no line and no laid time of its own', () => {
  const s = blindSession({ id: 'b1', handlerId: 'h1', dogId: 'd1', now: NOW });
  assert.equal(s.targetId, 'person');
  assert.equal(s.dogId, 'd1');
  assert.equal(s.handlerId, 'h1');
  assert.equal(s.layerId, null);
  assert.equal(s.startedAt, NOW);
  assert.equal(s.data.lineLater, true);
  assert.equal('trail' in s.data, false, 'no line, not an empty one a reader could take for a trail');
  assert.ok(noLineYet(s.data));
  assert.ok(!unwalkedPlan(s.data), 'not a drawn plan: the debrief’s blind and this are different things');
  assert.ok(!canLayAgain(s) && routeOf(s) === null, 'there is no route to lay again');
  assert.ok(!noLineYet({ trail: laid }), 'a laid trail is not one');
  assert.ok(!noLineYet(null) && !noLineYet({}));
});

await t('a GPX file’s track is read with its times and heights; a route without times is untimed', async () => {
  const Parser = await xmlParser();
  if (!Parser) return console.log('      (no XML parser in this Node: GPX reading checked in the browser only)');
  const gpx = `<?xml version="1.0"?>
<gpx version="1.1" creator="Watch" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>Morning</name></metadata>
  <trk><name>Sam’s lay</name>
    <trkseg>
      <trkpt lat="51.2" lon="-2.6"><ele>40.5</ele><time>2026-10-05T08:00:00Z</time></trkpt>
      <trkpt lat="51.2001" lon="-2.6"><ele>41</ele><time>2026-10-05T08:00:05Z</time></trkpt>
    </trkseg>
    <trkseg>
      <trkpt lat="51.2002" lon="-2.6"><time>2026-10-05T08:00:10Z</time></trkpt>
    </trkseg>
  </trk>
</gpx>`;
  const got = parseGpx(gpx, Parser);
  assert.equal(got.points.length, 3, 'the segments of one track are joined');
  assert.ok(got.timed);
  assert.equal(got.points[0].t, Date.UTC(2026, 9, 5, 8, 0, 0));
  assert.equal(got.points[0].ele, 40.5);
  assert.equal(got.name, 'Sam’s lay');

  const rte = `<gpx xmlns="http://www.topografix.com/GPX/1/1"><rte><name>Plan</name>
    <rtept lat="51.2" lon="-2.6"/><rtept lat="51.201" lon="-2.6"/></rte></gpx>`;
  const r = parseGpx(rte, Parser);
  assert.equal(r.points.length, 2);
  assert.equal(r.timed, false);
  assert.ok(r.points.every(p => !('t' in p)));

  /* One point with no time, or one out of order, and the clock is not trusted at all. */
  const some = gpx.replace('<time>2026-10-05T08:00:05Z</time>', '');
  assert.equal(parseGpx(some, Parser).timed, false);
  assert.ok(parseGpx(some, Parser).points.every(p => !('t' in p)), 'no half a clock left on the line');
  const back = gpx.replace('08:00:10Z', '07:59:00Z');
  assert.equal(parseGpx(back, Parser).timed, false);

  /* A track with one point is skipped for one with two; bad points are dropped. */
  const two = `<gpx><trk><trkseg><trkpt lat="51" lon="-2"/></trkseg></trk>
    <trk><trkseg><trkpt lat="91" lon="-2"/><trkpt lat="51" lon="-2"/><trkpt lat="51.001" lon="-2"/></trkseg></trk></gpx>`;
  assert.equal(parseGpx(two, Parser).points.length, 2);
});

await t('a file that is not a usable GPX track is refused in plain words', async () => {
  const Parser = await xmlParser();
  if (!Parser) return;
  const plain = (fn, re) => assert.throws(fn, (e) => e.plain === true && re.test(e.message));
  plain(() => parseGpx('', Parser), /empty/);
  plain(() => parseGpx('<kml><Document/></kml>', Parser), /not a GPX file/);
  plain(() => parseGpx('<gpx><trk><trkseg>', Parser), /not a GPX file/);
  plain(() => parseGpx('<gpx><trk><trkseg><trkpt lat="51" lon="-2"/></trkseg></trk></gpx>', Parser), /at least two points/);
  plain(() => parseGpx('<gpx/>', Parser), /at least two points/);
  plain(() => parseGpx('<gpx><trk><trkseg><trkpt lat="0" lon="0"/><trkpt lat="10" lon="10"/></trkseg></trk></gpx>', Parser), /far too long/);
  plain(() => parseGpx('<gpx/>', undefined), /cannot read GPX/);
});

await t('a watch’s thousands of fixes are thinned to fit, never cut short', async () => {
  const Parser = await xmlParser();
  if (!Parser) return;
  const n = GPX_MAX_POINTS + 2000;
  const pts = Array.from({ length: n }, (_, i) => {
    const p = project(HOME, 0, i * 0.5);
    return `<trkpt lat="${p.lat.toFixed(7)}" lon="${(p.lon + (i % 2 ? 1e-6 : 0)).toFixed(7)}"><time>${new Date(NOW + i * 1000).toISOString()}</time></trkpt>`;
  }).join('');
  const got = parseGpx(`<gpx><trk><trkseg>${pts}</trkseg></trk></gpx>`, Parser);
  assert.ok(got.points.length <= GPX_MAX_POINTS && got.points.length >= 2);
  assert.equal(got.points[got.points.length - 1].t, NOW + (n - 1) * 1000, 'the end is kept');
  assert.ok(got.timed);
});

await t('before a line goes on, a wrong-looking one is asked about and an impossible one refused', () => {
  const s = ran();
  const ok = lineCheck(s.data, { points: laid, timed: true, via: 'gpx' });
  assert.deepEqual(ok, { refuse: null, ask: [], cut: 0 }, 'the layer’s line, laid before the run, near the dog');
  assert.match(lineCheck(s.data, { points: laid.slice(0, 1), timed: true }).refuse, /fewer than two points/);
  const far = laid.map(p => ({ ...project(p, 90, LINE_ASK_M + 200), t: p.t }));
  assert.match(lineCheck(s.data, { points: far, timed: true }).ask[0], /long way from where the dog set off/);
  const elsewhere = laid.map(p => ({ lat: p.lat + 1, lon: p.lon, t: p.t }));
  assert.match(lineCheck(s.data, { points: elsewhere, timed: true }).refuse, /nowhere near/);
  /* Recorded wholly after the dog set off: the dog's own track, most often,
     never the laid trail — refused, not asked about. */
  const late = laid.map(p => ({ ...p, t: p.t + 3 * 3600e3 }));
  assert.match(lineCheck(s.data, { points: late, timed: true }).refuse, /after the dog set off.*dog’s own track/);
  assert.match(lineCheck(s.data, { points: track, timed: true }).refuse, /dog’s own track/, 'the run’s own track loaded back');
  const one = [laid[0], ...late.slice(1)];
  assert.match(lineCheck(s.data, { points: one, timed: true }).refuse, /no trail recorded before the dog set off/);
  const untimed = laid.map(({ t: _t, ...p }) => p);
  assert.match(lineCheck(s.data, { points: untimed, timed: false }).ask[0], /no times on it/);
});

await t('a timed line becomes the trail with its own laid time, so the age is real and the run can bank', () => {
  const s = ran();
  const patch = linePatch(s, { points: laid, timed: true, via: 'card', from: 'Sam', waypoints: [{ kind: 'Article', lat: 51, lon: -2, t: 1 }] }, NOW + 86400e3);
  const s2 = patchSession(s, patch);
  assert.equal(s2.startedAt, laid[0].t, 'laid when the layer set off');
  assert.equal(Math.round((s2.data.trackStarted - s2.startedAt) / 60000), 60);
  assert.deepEqual(s2.data.trail.map(p => p.t), laid.map(p => p.t));
  assert.ok(!noLineYet(s2.data), 'it has its line now');
  assert.equal(s2.data.lineLater, true, 'and still says how it began');
  assert.deepEqual(s2.data.lineAdded, { at: NOW + 86400e3, via: 'card', from: 'Sam', timed: true });
  assert.equal(s2.data.drawn, undefined);
  assert.equal(s2.data.waypoints.length, 1, 'the layer’s own marks come with it');
  assert.ok(!unwalkedPlan(s2.data));
  assert.ok(ranBlind(s2.data) && teachesDrift(s2.data), 'a blind trail was run blind: it may teach the dog’s drift');
  assert.equal(s2.data.track, track, 'the dog’s run is untouched');
});

await t('a line with no times is timed as a drawn plan is, and gives no age and banks nothing', () => {
  const s = ran();
  const pts = laid.map(({ t: _t, ...p }) => p);
  const s2 = patchSession(s, linePatch(s, { points: pts, timed: false, via: 'gpx', from: 'plan.gpx' }, NOW + 5e6));
  const tr = s2.data.trail;
  assert.ok(tr.length >= pts.length && tr.every(p => Number.isFinite(p.t)), 'the scent model has a clock to read');
  assert.ok(tr[tr.length - 1].t <= RUN, 'laid, as far as the clock goes, before the dog set off');
  assert.equal(s2.startedAt, tr[0].t);
  assert.equal(s2.data.drawn, true);
  assert.equal(s2.data.lineAdded.timed, false);
  assert.ok(unwalkedPlan(s2.data), 'read everywhere as a line with a made-up clock');
  assert.ok(!teachesDrift(s2.data));
  assert.equal(runAgeMin({ data: { ...s2.data, result: { ageMin: 12 } } }), null);
  /* A card drawn on the map, or a walked card carrying the drawn line, says it has no real times. */
  const card = linePatch(s, { points: laid, timed: true, via: 'card' }, NOW);
  assert.equal(card.data.lineAdded.timed, true);
  const half = linePatch(s, { points: [laid[0], { lat: laid[1].lat, lon: laid[1].lon }], timed: true, via: 'gpx' }, NOW);
  assert.equal(half.data.lineAdded.timed, false, 'a line that says timed but is not, is not');
});

await t('with no line the result is said plainly: the run, the find, and no grade', () => {
  const s = ran();
  const sum = blindSummary(s.data, 'Rex', {});
  assert.equal(sum.found, true);
  assert.equal(sum.ms, 39 * 4000);
  assert.ok(Math.abs(sum.metres - 195) < 1);
  assert.deepEqual(sum.end, track[track.length - 1], 'the find is where the track ends');
  assert.match(sum.sentence, /^Rex ran a blind trail to the find: 195 m in /);
  assert.match(sum.sentence, /Not graded until the laid trail is added\.$/);
  assert.doesNotMatch(sum.sentence, /line|left|right|old|age/, 'nothing measured against a line, and no age');
  const done = blindSummary({ ...s.data, found: false, trackWaypoints: [{ kind: 'Indication' }] }, '', { imperial: true });
  assert.match(done.sentence, /^The dog ran a blind trail, no find: /);
  assert.equal(done.marks, 1);
  assert.equal(blindSummary({}, 'Rex').sentence, 'A blind trail with no run recorded.');
  assert.equal(blindSummary(null, null).metres, 0);
});

await t('the link model, report, GPX file and live share show the dog alone, with no laid time or age', () => {
  const s = ran();
  const m = trailModel(s, { dog: { name: 'Rex' } });
  assert.equal(m.lineLater, true);
  assert.equal(m.trail, null);
  assert.equal(m.laidAt, null, 'its startedAt is when it began, not when anything was laid');
  assert.equal(m.found, true);
  assert.match(headline(m), /^Rex ran a blind trail to the find/);
  const rows = detailSections(m).flatMap(sec => sec.rows.map(r => r.join(': ')));
  assert.ok(rows.includes('Graded: not yet — no laid trail to compare with'));
  assert.ok(rows.includes('Trail age at start: not known — no laid trail added yet'));
  assert.ok(!rows.some(r => /^(Laid|Length|Start|End):/.test(r)), 'no trail it does not have');
  assert.ok(!detailSections(m).some(sec => sec.title === 'Trail'));
  assert.match(notes(m)[0], /no laid trail has been added yet/);
  const gpx = toGpx(m);
  assert.match(gpx, /<name>Found<\/name>/, 'the find is marked where the track ends');
  assert.doesNotMatch(gpx, /Trail start|Laid trail/);
  assert.match(gpx, /Rex’s run/);
  assert.match(fileBase(m), /^trailcraft-2026-10-05-rex-blind-trail$/);
  const live = liveMeta(m, RUN);
  assert.equal(live.trail, null, 'a live viewer sees the dog only');
  assert.equal(live.laidAt, null);

  /* Once the line is on, it is an ordinary trail again, and says what its line was. */
  const s2 = patchSession(s, linePatch(s, { points: laid.map(({ t: _t, ...p }) => p), timed: false, via: 'gpx' }, NOW));
  const m2 = trailModel(s2, {});
  assert.equal(m2.lineLater, false);
  assert.equal(m2.lineUntimed, true);
  assert.equal(m2.laidAt, s2.startedAt);
  const rows2 = detailSections(m2).flatMap(sec => sec.rows.map(r => r.join(': ')));
  assert.ok(rows2.includes('Trail age at start: not known — the line had no times'));
  assert.ok(!rows2.some(r => /^Laid:|^Drawn:/.test(r)), 'its made-up laid time is not printed');
});

await t('stats count a blind trail as a run with no age or grade yet, and its line is not one the handler laid', () => {
  const s = ran();
  const h = handlerStats('h1', [s]);
  assert.equal(h.runs, 1);
  assert.equal(h.noLine, 1);
  assert.equal(h.unknownAge + h.unwalked + h.bands.hot + h.bands.warm + h.bands.cold, 0);
  assert.equal(h.medOff, null);
  assert.equal(h.laid, 0);
  const s2 = patchSession(s, linePatch(s, { points: laid, timed: true, via: 'card' }, NOW));
  assert.equal(handlerStats('h1', [s2]).laid, 0, 'the layer laid it, not the handler');
  assert.equal(handlerStats('h1', [s2]).laidMetres, 0);
  const d = dogStats('d1', [s]);
  assert.equal(d.runs, 1);
  assert.equal(d.noLine, 1);
  assert.equal(d.graded, 0, 'an ungraded run is not a graded one');
});

await t('a call on a blind trail is judged once the line is added, not before', () => {
  const conf = CONFIDENCE[0].v;
  const ind = { kind: 'Indication', ...track[track.length - 1], call: { v: 1, conf, seen: false, at: RUN + 150e3 } };
  const s = ran({ trackWaypoints: [ind], debrief: { outcome: 'found', blind: 'handler' } });
  assert.deepEqual(callVerdict(s), { ok: false, why: 'noline' });
  assert.equal(scorable(s), null);
  assert.equal(calibrationLosses([s]).noLine, 1);
  /* A false indication was wrong whatever the line. */
  const wrong = ran({ trackWaypoints: [ind], debrief: { outcome: 'false', blind: 'handler' } });
  assert.equal(callVerdict(wrong).right, false);
  const s2 = patchSession(s, linePatch(s, { points: track.map(p => ({ ...p, t: p.t - 3600e3 })), timed: true, via: 'card' }, NOW));
  assert.equal(callVerdict(s2).ok, true, 'judged against the laid trail’s end');
  assert.equal(callVerdict(s2).right, true);
});

await t('a blind trail is found in the log by the words it was run under', () => {
  const s = ran();
  const rows = logRows([s, { id: 'x', targetId: 'person', startedAt: NOW, data: { trail: laid } }], () => ({}), NOW);
  assert.deepEqual(filterRows(rows, { words: searchWords('blind') }).map(r => r.s.id), ['b1']);
});

await t('a blind trail’s session is its one run: a copy keeps its flag, never its run', () => {
  const s = ran();
  const copy = runAgain(s, { id: 'c', summary: '' });
  assert.equal(copy.data.lineLater, true);
  assert.equal(copy.data.track, undefined);
});

/* The app's own code, lifted out and run: the run's marks on the map and in
   the replay put the find where Found was tapped, and only on a blind trail
   with no line, where there is no trail end to show it. */
const js = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const bodyOf = (name) => {
  const i = js.indexOf(`\nfunction ${name}(`);
  assert.ok(i > 0, `app.js still has ${name}()`);
  return js.slice(i, js.indexOf('\n}\n', i) + 2);
};

await t('the map marks the find at the end of a blind trail’s track', () => {
  const sb = { noLineYet };
  vm.createContext(sb);
  vm.runInContext(bodyOf('marksOf'), sb);
  const s = ran({ trackWaypoints: [{ kind: 'Reward', lat: 1, lon: 1, t: RUN }] });
  const marks = sb.marksOf(s);
  assert.equal(marks.length, 2);
  assert.deepEqual({ ...marks[1] }, { kind: 'Found', lat: track[39].lat, lon: track[39].lon, t: track[39].t });
  assert.equal(sb.marksOf(ran({ found: false })).length, 0, 'Done marks no find');
  const withLine = patchSession(s, linePatch(s, { points: laid, timed: true, via: 'card' }, NOW));
  assert.equal(sb.marksOf(withLine).length, 1, 'with a line, the trail’s end shows it');
  assert.equal(sb.marksOf({ data: {} }).length, 0);
});

await t('every screen that drew the laid trail steps round a blind trail with no line', () => {
  /* Each of these read s.data.trail[0] or graded against the line. */
  assert.match(bodyOf('openReplay'), /\} else if \(noLineYet\(s\.data\)\) \{/);
  assert.match(bodyOf('showOnMap'), /const noLine = noLineYet\(s\.data\);\s*\n\s*if \(noLine\) \{/);
  assert.match(js, /const blindTrail = noLineYet\(s\.data\);\s*\n\s*if \(blindTrail && s\.data\.track\) return toast/);
  assert.match(js, /if \(blindTrail\) \{[\s\S]{0,200}\} else if \(t\.kind === 'person'\) \{\s*\n\s*\/\/ Only the start of the trail/);
  assert.match(js, /const graded = blindTrail \? null : await computeResult\(/, 'Stop grades nothing without a line');
  assert.match(bodyOf('openSession'), /if \(s\.data\.result \|\| noLineYet\(s\.data\)\) \{/, 'its card opens the result, where the line is added');
  assert.match(bodyOf('paintPick'), /\$\('btnBlind'\)\.hidden = t\.kind !== 'person';/);
  assert.match(js, /\$\('btnBlind'\)\.addEventListener\('click', startBlind\);/);
  assert.match(js, /if \(noLineYet\(s\.data\)\) \{\s*\n\s*const now = keepPatch\(s, \{ data: \{ windFelt: wf \} \}\);/, 'a wind felt later is kept, with nothing to re-grade');
  assert.match(bodyOf('toggleReveal'), /if \(!s \|\| noLineYet\(s\.data\)\) return;/);
  /* The line goes on and the run is graded as a walked card grades a plan. */
  const apply = js.slice(js.indexOf('\nasync function applyLine('), js.indexOf('\n}\n', js.indexOf('\nasync function applyLine(')));
  assert.match(apply, /const check = lineCheck\(s\.data, line\);/);
  assert.match(apply, /for \(const q of check\.ask\) if \(!confirm\(q\)\) return false;/);
  assert.match(apply, /lined\.data\.trackStarted, \{ bank: teachesDrift\(lined\.data\) \}\);/);
  /* Graded before anything is saved, and saved with its grade in one go: a
     grade that fails leaves the run waiting for its line, not stuck with a
     line and no result that nothing could ever grade. */
  assert.ok(apply.indexOf('await computeResult(') < apply.indexOf('saveSession('), 'graded first, saved after');
  assert.equal((apply.match(/saveSession\(/g) || []).length, 1, 'the line and its grade are one save');
  assert.match(apply, /\} catch \(e\) \{[\s\S]{0,260}return false;/, 'a failed grade adds nothing');
  assert.match(apply, /if \(!\(s\.data\.track\?\.length > 1\)\) \{ toast\(/, 'a blind trail with no run takes no line');
  /* Never takes over a recording begun while it graded. */
  assert.match(apply, /if \(gradedElsewhere\(\)\) return true;\s*\n[\s\S]{0,120}run\.session = s2;/);
  assert.match(bodyOf('gradedElsewhere'), /if \(!rec\.on && \(currentScreen === 'scrResult' \|\| currentScreen === 'scrScan'\)\) return false;/);
  const walk = js.slice(js.indexOf('\nasync function applyWalked('), js.indexOf('\n}\n', js.indexOf('\nasync function applyWalked(')));
  assert.match(walk, /if \(gradedElsewhere\([^)]*\)\) return true;\s*\n\s*run\.session = s2;/, 'a walked card does not either');
  assert.match(bodyOf('renderResult'), /\$\('addLineBox'\)\.hidden = !\(awaiting && ownRun\(s\) && s\.data\.track\?\.length > 1\);/);
  assert.match(bodyOf('renderResult'), /const r = \(awaiting \? \{\} : [^;]*\) \?\? \{\};/, 'a run with no result still draws');
  /* A blind run opened from the replay is the one its card acts on. */
  assert.match(bodyOf('replaySession'), /if \(s\.data\.result \|\| noLineYet\(s\.data\)\) run\.session = s; else pendingSession = s;/);
  assert.match(js, /\(s\?\.data\?\.result \|\| noLineYet\(s\?\.data\)\)\) \{ run\.session = s; renderResult\(s\); go\('scrResult'\); \}/);
  /* Empty blind sessions are not left behind. */
  const blind = bodyOf('startBlind');
  assert.ok(blind.indexOf('recordingWaits()') > -1 && blind.indexOf('recordingWaits()') < blind.indexOf('db.addSession'), 'a waiting recording is asked about before the session is made');
  assert.match(bodyOf('recoverDrop'), /dropEmptyBlind\(thrown\);/);
  assert.match(bodyOf('offerRecovery'), /if \(d\.kind === 'run'\) \{ dropEmptyBlind\(d\.sessionId\);/);
  assert.match(bodyOf('boot'), /sweepEmptyBlind\(\)/);
  assert.match(bodyOf('dropEmptyBlind'), /if \(!s \|\| !noLineYet\(s\.data\) \|\| s\.data\.track\) return false;/, 'only a blind trail with nothing in it');
  assert.match(bodyOf('sweepEmptyBlind'), /now - s\.startedAt > DRAFT_MAX_AGE/, 'and only once no recording could still be going');
  /* Done put right in the debrief is a find on a blind trail. */
  assert.match(bodyOf('saveDebrief'), /s\.data\?\.lineLater && s\.data\.found !== true && d\.outcome === 'found' \? \{ found: true \}/);
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  for (const id of ['btnBlind', 'addLineBox', 'btnAddLine', 'btnLineScan', 'btnLineGpx', 'lineFile', 'shareOutNoLink']) {
    assert.match(html, new RegExp(`id="${id}"`), `index.html has #${id}`);
  }
  assert.ok(pathLen(track) > 0);
});

await t('what the layer’s watch recorded after the dog set off is left out of the trail', () => {
  const s = ran();
  /* The laid line, then the layer's watch running on at the hide and on the
     walk back, until well after the find. */
  const tail = Array.from({ length: 30 }, (_, i) => ({ ...project(laid[laid.length - 1], i * 12, 2), t: RUN - 600e3 + i * 60e3 }));
  const whole = [...laid, ...tail];
  const check = lineCheck(s.data, { points: whole, timed: true, via: 'gpx' });
  assert.equal(check.refuse, null);
  assert.deepEqual(check.ask, [], 'nothing to ask: the part before the dog set off is the trail');
  assert.ok(check.cut > 0 && check.cut < tail.length, 'and the rest is counted as cut');
  const patch = linePatch(s, { points: whole, timed: true, via: 'gpx' }, NOW);
  assert.ok(patch.data.trail.every(p => p.t <= RUN), 'nothing laid after the dog set off');
  assert.equal(patch.data.trail.length, whole.filter(p => p.t <= RUN).length);
  assert.equal(patch.startedAt, laid[0].t);
  /* An untimed line, or a run with no start, is kept whole. */
  const untimed = whole.map(({ t: _t, ...p }) => p);
  assert.equal(lineCheck(s.data, { points: untimed, timed: false }).cut, 0);
  const noStart = patchSession(s, { data: { trackStarted: undefined } });
  assert.equal(linePatch(noStart, { points: whole, timed: true, via: 'gpx' }, NOW).data.trail.length, whole.length);
});

await t('a GPX time with no zone is read as UTC, as GPX times are', async () => {
  const Parser = await xmlParser();
  if (!Parser) return console.log('      (no XML parser in this Node: GPX reading checked in the browser only)');
  const gpx = (a, b) => `<?xml version="1.0"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg>
    <trkpt lat="51.2" lon="-2.6"><time>${a}</time></trkpt><trkpt lat="51.2001" lon="-2.6"><time>${b}</time></trkpt>
  </trkseg></trk></gpx>`;
  const bare = parseGpx(gpx('2026-07-05T10:00:00', '2026-07-05T10:00:05.5'), Parser);
  assert.equal(bare.points[0].t, Date.UTC(2026, 6, 5, 10, 0, 0));
  assert.equal(bare.points[1].t, Date.UTC(2026, 6, 5, 10, 0, 5, 500));
  const zoned = parseGpx(gpx('2026-07-05T11:00:00+01:00', '2026-07-05T10:00:05Z'), Parser);
  assert.equal(zoned.points[0].t, Date.UTC(2026, 6, 5, 10, 0, 0), 'an offset given is honoured');
  assert.ok(zoned.timed);
});

await t('a live viewer of a blind trail is told it is one, not that a trail was laid and never run', () => {
  const s = ran();
  const live = liveMeta(trailModel(s, { dog: { name: 'Rex' } }), RUN);
  const m = liveModel({ ...live, ended: true }, [track]);
  assert.equal(m.lineLater, true);
  assert.equal(m.found, null, 'the live document says nothing of which button ended it');
  const said = headline(m);
  assert.match(said, /^Rex ran a blind trail: 195 m in .*Not graded until the laid trail is added\.$/);
  assert.doesNotMatch(said, /not yet run|to the find|no find/);
  const run = detailSections(m).find(x => x.rows.some(([k]) => k === 'Graded'));
  assert.ok(run, 'the run section says it is not graded');
  assert.ok(!run.rows.some(([k]) => k === 'Ended'), 'and does not guess how it ended');
  assert.equal(headline(liveModel(live, [])), 'A blind trail. No run recorded yet.');
  /* A laid trail run live is still one. */
  const laidLive = liveModel({ ...live, trail: laid, laidAt: laid[0].t }, [track]);
  assert.ok(!laidLive.lineLater);
  assert.ok(!liveModel({ kind: 'search', hides: [laid[0]] }, []).lineLater);
});

await t('the report of a blind trail with no line shows the run’s own forecast', () => {
  const series = [0, 15, 30].map(i => ({ t: RUN + (i - 15) * 60e3, temp: 12, soil_temp: 9, humidity: 80, wind_speed: 4, wind_direction: 270 }));
  const s = ran({ runWeather: { series } });
  const m = trailModel(s, { dog: { name: 'Rex' } });
  const wx = detailSections(m).find(x => x.title === 'Weather');
  assert.ok(wx, 'a Weather section');
  const row = (k) => wx.rows.find(([a]) => a === k)?.[1];
  assert.match(row('Air'), /12/);
  assert.match(row('Ground'), /9/);
  assert.equal(row('Humidity'), '80 %');
  assert.match(row('Wind during the run'), /from W/);
  assert.equal(detailSections(trailModel(ran(), {})).find(x => x.title === 'Weather'), undefined, 'none when nothing was kept');
});

await t('a blind run ended with Done and put right in the debrief reads as a find', () => {
  /* What saveDebrief now saves; every reader goes from data.found. */
  const s = ran({ found: undefined });
  assert.match(blindSummary(s.data, 'Rex').sentence, /, no find:/);
  const fixed = patchSession(s, { data: { found: true } });
  assert.match(blindSummary(fixed.data, 'Rex').sentence, /to the find:/);
});

await t('a line added from a GPX file with no times is not called a drawn Trail Card on the dog’s card', () => {
  const s = ran();
  const pts = laid.map(({ t: _t, ...p }) => p);
  const fromFile = patchSession(s, linePatch(s, { points: pts, timed: false, via: 'gpx' }, NOW));
  const fromCard = patchSession({ ...s, id: 'b2' }, linePatch(s, { points: pts, timed: false, via: 'card' }, NOW));
  for (const st of [handlerStats('h1', [fromFile, fromCard]), dogStats('d1', [fromFile, fromCard])]) {
    assert.equal(st.unwalked, 2);
    assert.equal(st.untimedLines, 1, 'the file');
    assert.equal(st.drawnCards, 1, 'the card');
  }
  assert.equal(handlerStats('h1', []).untimedLines, 0);
  assert.equal(dogStats('d1', []).untimedLines, 0);
});

await t('sync keeps the line’s laid time when the newer copy is a phone that had not heard of the line', () => {
  const run = { ...ran(), updatedAt: NOW + 1000 };
  const lined = patchSession(run, linePatch(run, { points: laid, timed: true, via: 'gpx' }, NOW + 2000));
  const graded = { ...patchSession(lined, { summary: 'Rex worked it.', data: { result: { kind: 'trail', ageMin: 60 } } }), updatedAt: NOW + 3000 };
  /* The other phone saves a debrief on its old copy, later. */
  const stale = { ...patchSession(run, { data: { debrief: { outcome: 'found' } } }), updatedAt: NOW + 4000 };
  for (const [l, r] of [[stale, graded], [graded, stale]]) {
    const { keep } = mergeOne(l, r, { union: true });
    assert.equal(keep.startedAt, laid[0].t, 'the laid time, not the moment the blind trail began');
    assert.equal(keep.summary, 'Rex worked it.');
    assert.ok(keep.data.lineAdded && keep.data.trail.length === laid.length && keep.data.result);
    assert.deepEqual(keep.data.debrief, { outcome: 'found' }, 'and the newer debrief');
  }
});

/** The XML parser a browser has as DOMParser: @xmldom/xmldom when it is
    installed (it comes with the iOS tooling), or none. */
async function xmlParser() {
  try {
    const require = createRequire(import.meta.url);
    const { DOMParser } = require('@xmldom/xmldom');
    /* Quiet about the broken files fed it on purpose; it still throws on them. */
    return class extends DOMParser { constructor() { super({ onError() {} }); } };
  } catch { return null; }
}

console.log(`\n${pass} passed total\n`);
