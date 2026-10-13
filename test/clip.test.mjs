/* The replay as a video (clip.js). Save video on the replay records the run
   playing through once, sped up to fit 15, 30 or 60 seconds, as a tall file
   the phone can keep and send.

   The pure parts first: where the run's clock is at each moment of the
   video, when a blind run's answer may appear, which file type a device can
   record, the file's name and what the strips say. Then the recorder itself,
   run against stand-ins for the map, the canvas and the browser's recorder,
   to see that it hands everything back however it ends. Then the wiring, as
   the other tests read it: off the source. What a real phone's encoder
   makes of it cannot be checked here. */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CLIP, CLIP_TYPES, CLIP_SAYS, pickType, clipSupport, clipPlan, clipAt, runClock, answerPlan, clipOffered,
  withoutAnswer, clipLines, clipClosing, windLine, creditLine, clipName, clipProgress, coverCrop, framePadding,
  wrapText, drawFrame, recordClip, canHoldScreen, clipSeconds, cssUrl, routeUntil, placeLabels } from '../public/clip.js';
import { ranBlind } from '../public/debrief.js';
import { fileBase } from '../public/share.js';

let pass = 0;
const t = async (name, fn) => { await fn(); pass++; console.log(`  ok  ${name}`); };
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} is not ${b}`);

const T = Date.UTC(2026, 9, 13, 9, 0);
/* A dog going north for five minutes, a fix every 10 s, about 11 m apart. */
const track = Array.from({ length: 31 }, (_, i) => ({ lat: 51.2 + i * 0.0001, lon: -2.65, t: T + i * 10000 }));
const trail = [{ lat: 51.2, lon: -2.65, t: T - 3600e3 }, { lat: 51.203, lon: -2.65, t: T - 3500e3 }];
const run = (over = {}, top = {}) => ({
  id: 'r1', targetId: 'person', handlerId: 'h', dogId: 'd', summary: 'Saved words.',
  data: { trail, track, trackStarted: T, trackWaypoints: [], coach: { assisted: false }, revealedAt: null, ...over }, ...top,
});

/* ── Time ─────────────────────────────────────────────────────────── */

await t('the video is the length asked for: the run, a blind run’s reveal, then the card', () => {
  assert.deepEqual(CLIP.LENGTHS, [15, 30, 60]);
  for (const s of CLIP.LENGTHS) {
    const open = clipPlan(s), blind = clipPlan(s, { reveal: true });
    assert.deepEqual(open, { total: s, runS: s - 2, revealS: 0, cardS: 2 }, 'the whole run in the length less the card');
    assert.deepEqual(blind, { total: s, runS: s - 4.5, revealS: 2.5, cardS: 2 });
    near(blind.runS + blind.revealS + blind.cardS, s);
  }
  assert.equal(clipPlan(NaN).total, 15, 'a length that is not one is the shortest');
  const tiny = clipPlan(2, { reveal: true });
  assert.ok(tiny.runS >= 1 && tiny.runS + tiny.revealS + tiny.cardS === 2, 'never a video with no run in it');
});

await t('the run’s clock goes from its start to its end at one steady speed, whatever the speed button says', () => {
  const p = clipPlan(30);
  const from = T, to = T + 300000;
  assert.equal(runClock(p, 0, from, to), from);
  near(runClock(p, 14, from, to), from + 150000, 1e-6);
  assert.equal(runClock(p, 28, from, to), to, 'the run ends as the card begins');
  assert.equal(runClock(p, 29.5, from, to), to, 'and stays there under it');
  assert.equal(runClock(p, -3, from, to), from);
  /* Twice the length, half the speed: the same moments at twice the time. */
  near(runClock(clipPlan(60), 29, from, to), from + 150000, 1e-6);
  let last = -Infinity;
  for (let x = 0; x <= 30; x += 1 / 30) { const at = runClock(p, x, from, to); assert.ok(at >= last); last = at; }
});

await t('the phases: run, reveal, card, done, each with how far through it is', () => {
  const p = clipPlan(15, { reveal: true });            // 10.5 run, 2.5 reveal, 2 card
  assert.deepEqual(clipAt(p, 0), { phase: 'run', f: 0, k: 0, answer: false });
  assert.equal(clipAt(p, 5.25).f, 0.5);
  assert.equal(clipAt(p, 10.49).phase, 'run');
  assert.deepEqual(clipAt(p, 10.5), { phase: 'reveal', f: 1, k: 0, answer: true });
  near(clipAt(p, 11.75).k, 0.5);
  assert.equal(clipAt(p, 12.99).phase, 'reveal');
  assert.deepEqual(clipAt(p, 13), { phase: 'card', f: 1, k: 0, answer: true });
  near(clipAt(p, 14).k, 0.5);
  assert.deepEqual(clipAt(p, 15), { phase: 'done', f: 1, k: 1, answer: true });
  const open = clipPlan(15);
  assert.equal(clipAt(open, 0).answer, true, 'with no reveal planned the trail is there from the first frame');
  assert.equal(clipAt(open, 13).phase, 'card');
  assert.equal(clipAt(open, 12.99).phase, 'run', 'and there is no reveal to wait through');
});

await t('a blind run never shows its answer while the route is still drawing', () => {
  for (const s of CLIP.LENGTHS) {
    const p = clipPlan(s, { reveal: true });
    for (let x = 0; x < s; x += 1 / CLIP.FPS) {
      const st = clipAt(p, x);
      if (st.f < 1) assert.equal(st.answer, false, `${s} s video at ${x.toFixed(2)} s`);
      if (st.phase === 'reveal' || st.phase === 'card') assert.equal(st.answer, true);
    }
  }
});

/* ── The honest reveal ────────────────────────────────────────────── */

await t('the answer is drawn when the handler had it: the decision table', () => {
  const rows = [
    ['a blind trail run', run(), 'person', 'end'],
    ['coached', run({ coach: { assisted: true } }), 'person', 'start'],
    ['the trail shown during the run', run({ revealedAt: T + 60000 }), 'person', 'start'],
    ['shown on an earlier run of it', run({ revealedAt: T - 86400e3 }), 'person', 'start'],
    ['the debrief says the handler knew', run({ debrief: { blind: 'open' } }), 'person', 'start'],
    ['a blind trail with no line', run({ trail: null, lineLater: true }), 'person', 'none'],
    ['a blind trail whose line was added later', run({ lineLater: true }), 'person', 'end'],
    ['a trail of one point', run({ trail: [trail[0]] }), 'person', 'none'],
    ['a search, hides not revealed', run({ trail: null, hides: [{ lat: 51.2, lon: -2.65 }] }, { targetId: 'narcotics' }), 'hide', 'end'],
    ['a search with the hides revealed', run({ trail: null, hides: [{ lat: 51.2, lon: -2.65 }], revealedAt: T + 5000 }, { targetId: 'narcotics' }), 'hide', 'start'],
    ['a search with no hides kept', run({ trail: null, hides: [] }, { targetId: 'narcotics' }), 'hide', 'none'],
    ['nothing at all', null, 'person', 'none'],
  ];
  for (const [what, s, kind, want] of rows) assert.equal(answerPlan(s, kind), want, what);
  /* It is the app's one test for "blind", not a second opinion. */
  for (const [what, s, kind, want] of rows) if (want !== 'none') assert.equal(want === 'end', ranBlind(s.data), what);
});

await t('Save video is never offered while the run is being marked', () => {
  assert.equal(clipOffered({ run: true }), true);
  assert.equal(clipOffered({ run: true, marking: true }), false, 'before See the result the answer is still hidden');
  assert.equal(clipOffered({ run: false }), false, 'nothing recorded, nothing to film');
  assert.equal(clipOffered({ run: true, recording: true }), false, 'one at a time');
  assert.equal(clipOffered(), false);
});

await t('the run with its answer held back keeps the dog and the marks and nothing laid', () => {
  const s = run({ planTrail: trail, contamination: [{ points: trail }], hides: [trail[0]], surf: 'ab', surfFix: [{}],
    trackWaypoints: [{ kind: 'Indication', lat: 51.2, lon: -2.65, t: T + 5000 }], result: { kind: 'trail' } });
  const h = withoutAnswer(s);
  assert.deepEqual([h.data.trail, h.data.planTrail, h.data.contamination, h.data.hides, h.data.surf, h.data.surfFix], [null, null, null, [], null, null]);
  assert.equal(h.data.track, s.data.track);
  assert.equal(h.data.trackWaypoints, s.data.trackWaypoints);
  assert.equal(h.data.lineLater, s.data.lineLater, 'it stays the kind of run it was, so its marks do not change at the reveal');
  assert.equal(s.data.trail, trail, 'the run itself is untouched');
});

/* ── What the device can record ───────────────────────────────────── */

await t('MP4 with H.264 where the device can make it, else WebM, and the file is named for what was made', () => {
  const only = (...ok) => (m) => ok.includes(m);
  assert.deepEqual(pickType(() => true), { mime: 'video/mp4;codecs=avc1.640028', type: 'video/mp4', ext: 'mp4' }, 'a recent Chrome');
  assert.deepEqual(pickType(only('video/mp4', 'video/mp4;codecs=avc1')), { mime: 'video/mp4;codecs=avc1', type: 'video/mp4', ext: 'mp4' }, 'Safari, an iPhone');
  assert.deepEqual(pickType(only('video/mp4')), { mime: 'video/mp4', type: 'video/mp4', ext: 'mp4' });
  assert.deepEqual(pickType(only('video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm')),
    { mime: 'video/webm;codecs=vp9', type: 'video/webm', ext: 'webm' }, 'no H.264 encoder: VP9');
  assert.deepEqual(pickType(only('video/webm;codecs=vp8', 'video/webm')), { mime: 'video/webm;codecs=vp8', type: 'video/webm', ext: 'webm' }, 'Firefox');
  assert.equal(pickType(() => false), null);
  assert.equal(pickType(null), null);
  assert.equal(pickType(() => { throw new Error('no'); }), null, 'a recorder that throws when asked is a no');
  const mp4 = CLIP_TYPES.findIndex(m => m.startsWith('video/webm'));
  assert.ok(CLIP_TYPES.slice(0, mp4).every(m => m.startsWith('video/mp4')) && mp4 > 0, 'every MP4 is tried before any WebM');
});

await t('a browser with no recorder, or no canvas stream, cannot record and is told so', () => {
  const MR = Object.assign(function MediaRecorder() {}, { isTypeSupported: (m) => m === 'video/mp4' });
  const canvas = { prototype: { captureStream() {} } };
  assert.deepEqual(clipSupport({ MediaRecorder: MR, HTMLCanvasElement: canvas }), { mime: 'video/mp4', type: 'video/mp4', ext: 'mp4' });
  assert.equal(clipSupport({ HTMLCanvasElement: canvas }), null);
  assert.equal(clipSupport({ MediaRecorder: MR, HTMLCanvasElement: { prototype: {} } }), null);
  assert.equal(clipSupport({ MediaRecorder: Object.assign(function () {}, { isTypeSupported: () => false }), HTMLCanvasElement: canvas }), null);
  assert.equal(CLIP_SAYS.unsupported, 'This device can’t record the replay.');
});

/* ── Words ────────────────────────────────────────────────────────── */

await t('the file is named as every other export of the run is', () => {
  const m = { kind: 'trail', laidAt: new Date(2026, 9, 13, 8).getTime(), dog: { name: 'Rex' } };
  assert.equal(clipName(m, 'mp4'), 'trailcraft-2026-10-13-rex-trail.mp4');
  assert.equal(clipName(m, 'webm'), 'trailcraft-2026-10-13-rex-trail.webm');
  assert.equal(clipName(m, '../x'), `${fileBase(m)}.mp4`, 'only ever one of the two extensions');
  assert.equal(clipName({ kind: 'search', laidAt: m.laidAt, dog: { name: 'Bo’s Girl' } }, 'mp4'), 'trailcraft-2026-10-13-bo-s-girl-search.mp4');
});

await t('the top strip: the dog, then the day, the distance and the time, in the handler’s units', () => {
  const day = (ms) => `day(${ms - T})`;
  const metric = clipLines({ dog: ' Rex ', track, level: 'Scent Reader II', imperial: false, day });
  assert.equal(metric.title, 'Rex');
  assert.match(metric.stats, /^day\(0\) · 33[0-9] m · 5:00$/);
  assert.equal(metric.level, 'Scent Reader II');
  const imperial = clipLines({ dog: 'Rex', track, imperial: true, day });
  assert.match(imperial.stats, /^day\(0\) · 36[0-9] yd · 5:00$/, 'yards for a handler who thinks in them');
  assert.equal(imperial.level, null, 'a run that is no team’s has no level line');
  const long = clipLines({ dog: 'Rex', track: track.map((p, i) => ({ ...p, lat: 51.2 + i * 0.001 })), day });
  assert.match(long.stats, / · 3\.3 km · /);
  assert.deepEqual(clipLines({}), { title: 'The dog', stats: '', level: null });
  assert.equal(clipLines({ dog: 'Rex', track: [track[0]], day }).stats, 'day(0)', 'one fix is a day and nothing else');
});

await t('the closing card: the run’s own sentence, in the reader’s units, and how it was run', () => {
  const result = { kind: 'trail', medAbs: 2.4, shares: { left: 0.1, on: 0.74, right: 0.16 } };
  const blind = clipClosing(run({ result }), { dog: 'Rex', units: {} });
  assert.deepEqual(blind, { sentence: 'Rex’s track stayed within 3 m of the line for 74 % of the run.', tag: 'Blind run' });
  assert.match(clipClosing(run({ result }), { dog: 'Rex', units: { imperial: true } }).sentence, /within 10 ft of the line/);
  assert.equal(clipClosing(run({ result, coach: { assisted: true } }), { dog: 'Rex' }).tag, 'Coached run');
  assert.equal(clipClosing(run({ result, revealedAt: T + 1000 }), { dog: 'Rex' }).tag, 'Trail shown during the run');
  assert.equal(clipClosing(run({ result, debrief: { blind: 'open' } }), { dog: 'Rex' }).tag, 'The handler knew the answer');
  const noLine = clipClosing(run({ trail: null, lineLater: true, found: true }), { dog: 'Rex', units: {} });
  assert.match(noLine.sentence, /^Rex ran a blind trail to the find: 33[0-9] m in 5:00\. Not graded until the laid trail is added\.$/);
  assert.equal(noLine.tag, 'Blind trail');
  const search = clipClosing(run({ trail: null, hides: [trail[0]], result: { kind: 'search', toFirst: 95000, catchM: 6 } }, { targetId: 'narcotics' }),
    { dog: 'Rex', units: {}, kind: 'hide' });
  assert.deepEqual(search, { sentence: 'Rex indicated in 1:35, 6 m from the hide.', tag: 'Blind search' });
  assert.equal(clipClosing(run({ trail: null, hides: [trail[0]], revealedAt: T }, { targetId: 'narcotics' }), { kind: 'hide' }).tag, 'Hides shown during the search');
  assert.equal(clipClosing(run(), { dog: 'Rex' }).sentence, 'Saved words.', 'never graded: the words it was saved with');
  assert.equal(clipClosing(run({}, { summary: '' }), { dog: 'Rex' }).sentence, 'Rex’s run.');
});

await t('the wind: felt when the handler said so, else the forecast, with an arrow that points where the air is going', () => {
  const wx = { wind_direction: 250, wind_speed: 3.4 };
  assert.deepEqual(windLine(wx), { toward: 70, words: 'Wind: from WSW, 12 km/h (forecast)' });
  assert.equal(windLine(wx, { imperial: true }).words, 'Wind: from WSW, 8 mph (forecast)');
  assert.deepEqual(windLine({ wind_direction: 180 }, { felt: 'From S, felt (forecast N)', mode: 'from' }),
    { toward: 0, words: 'Wind: from S, felt (forecast N)' }, 'the handler’s word comes first');
  assert.deepEqual(windLine(wx, { felt: 'Swirling, felt (forecast WSW)', mode: 'swirl' }), { toward: null, words: 'Wind: swirling, felt (forecast WSW)' },
    'a swirling wind has no arrow');
  assert.equal(windLine(wx, { felt: 'Calm, felt', mode: 'calm' }).toward, null);
  assert.equal(windLine(null), null);
  assert.equal(windLine({ wind_speed: 4 }), null, 'no direction, nothing to say');
  assert.equal(windLine({ wind_direction: 90 }).words, 'Wind: from E (forecast)');
});

await t('the map’s credit is the one the live map shows, and is never left off', () => {
  assert.equal(creditLine('© Mapbox © OpenStreetMap Improve this map © Maxar'), '© Mapbox © OpenStreetMap © Maxar');
  assert.equal(creditLine('  © OpenStreetMap\n contributors '), '© OpenStreetMap contributors');
  assert.equal(creditLine('', { mapbox: true }), '© Mapbox © OpenStreetMap');
  assert.equal(creditLine(null), '© OpenStreetMap contributors');
  assert.equal(clipProgress(11.7, 30), '11 s of 30 s');
  assert.equal(clipProgress(31, 30), '30 s of 30 s');
});

await t('Mapbox’s wordmark is taken from the map’s own stylesheet, and only a picture written into it', () => {
  const svg = 'data:image/svg+xml;charset=utf-8,%3Csvg width=%2788%27 height=%2723%27%3E%3C/svg%3E';
  assert.equal(cssUrl(`url("${svg}")`), svg, 'as a browser hands a background-image back');
  assert.equal(cssUrl(`url('${svg}')`), svg);
  assert.equal(cssUrl(`url(${svg})`), svg);
  assert.equal(cssUrl('none'), null, 'a map with no wordmark');
  assert.equal(cssUrl('url("https://example.com/logo.png")'), null, 'never a picture from elsewhere: it would spoil the canvas for the recorder');
  assert.equal(cssUrl(null), null);
});

/* ── Geometry ─────────────────────────────────────────────────────── */

await t('the frame is the middle of the map, as wide or as tall as it goes', () => {
  assert.deepEqual(coverCrop(1280, 800, 720, 1280), { x: 415, y: 0, w: 450, h: 800 }, 'a desktop: the middle column');
  const phone = coverCrop(390, 844, 720, 1280);
  near(phone.h, 390 * 16 / 9, 1e-9);
  assert.deepEqual([phone.x, phone.w], [0, 390]);
  near(phone.y, (844 - phone.h) / 2, 1e-9);
  assert.deepEqual(coverCrop(720, 1280, 720, 1280), { x: 0, y: 0, w: 720, h: 1280 });
  assert.deepEqual(coverCrop(0, 0, 720, 1280), { x: 0, y: 0, w: 0, h: 0 }, 'a map not laid out yet');
  /* The run is fitted clear of the strips, and of the part of the map the video does not show. */
  const pad = framePadding(1280, 800);
  const k = 450 / 720;                      // map pixels to a frame pixel, on that desktop
  assert.ok(pad.left > 415 && pad.right > 415, 'inside the column the video keeps');
  assert.deepEqual(pad, { top: Math.round(320 * k), bottom: Math.round(300 * k), left: Math.round(415 + 56 * k), right: Math.round(415 + 110 * k) });
  assert.ok(pad.left + pad.right < 1280 && pad.top + pad.bottom < 800, 'with room left for the run');
  /* And clear of what a social app lays over a tall video: its caption over
     the bottom fifth and more, its buttons down the right edge. */
  assert.ok(pad.bottom / k >= 0.23 * CLIP.H, 'the route ends above a Reel’s caption');
  assert.ok((pad.right - 415) / k >= 100 && pad.right > pad.left, 'and left of its buttons');
  assert.ok(pad.top / k >= 246 + 66, 'under the top strip at its tallest, and the wind below it');
  const pp = framePadding(390, 844);
  assert.ok(pp.top > (844 - 390 * 16 / 9) / 2 && pp.left + pp.right < 390 && pp.top + pp.bottom < 844);
  assert.ok(844 - pp.top - pp.bottom > 300 && 390 - pp.left - pp.right > 250, 'a phone still has most of its map for the run');
});

await t('the route so far: every fix reached, and the place between two fixes', () => {
  const pts = [{ x: 0, y: 0, t: 0 }, { x: 10, y: 0, t: 10 }, { x: 10, y: 20, t: 20 }];
  assert.deepEqual(routeUntil(pts, -1), []);
  assert.deepEqual(routeUntil(pts, 0), [pts[0]]);
  assert.deepEqual(routeUntil(pts, 5), [pts[0], { x: 5, y: 0, t: 5 }]);
  assert.deepEqual(routeUntil(pts, 15), [pts[0], pts[1], { x: 10, y: 10, t: 15 }]);
  assert.deepEqual(routeUntil(pts, 99), pts, 'the whole of it at the reveal');
  assert.deepEqual(routeUntil([], 5), []);
});

await t('marks made close together are each named once, and no name sits on another', () => {
  const measure = (s) => s.length * 12;
  const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  /* Lost it, Cast, Re-found and a Negative within a few steps, as they are made. */
  const close = ['Lost it', 'Cast', 'Re-found', 'Negative'].map((kind, i) => ({ kind, x: 300 + i * 9, y: 620 + i * 5, t: 1000 + i }));
  const far = { kind: 'Head pop', x: 520, y: 900, t: 10 };
  const placed = placeLabels([far, ...close], measure, { topH: 246 });
  assert.deepEqual(placed.map(m => m.kind), ['Negative', 'Re-found', 'Cast', 'Lost it', 'Head pop'], 'newest first');
  const rects = placed.map(m => m.label).filter(Boolean);
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) assert.ok(!hit(rects[i], rects[j]), 'no two names overlap');
  assert.ok(placed[0].label && placed[0].label.y < placed[0].y, 'the newest is named, above its dot');
  assert.ok(placed[1].label && placed[1].label.y > placed[1].y, 'the one before it below its own, the space above being taken');
  assert.deepEqual([placed[2].label, placed[3].label], [null, null], 'with no room left a mark keeps its dot and loses its name');
  assert.ok(placed[4].label, 'a mark on its own is named as before');
  assert.equal(placed.length, 5, 'every dot is still drawn');
  /* The wind and the reveal are spoken for. */
  const wind = { x: 36, y: 260, w: 400, h: 52 };
  const under = placeLabels([{ kind: 'Cast', x: 200, y: 340, t: 1 }, { kind: 'Scent pool', x: 210, y: 345, t: 0 }], measure, { topH: 246, avoid: [wind] });
  assert.ok(!hit(under[0].label, wind) && under[0].label.y > under[0].y, 'a name moves below its dot to stay off the wind');
  assert.equal(under[1].label, null);
  /* A fresh mark (gold) is the newest whatever its place in the list, and off the frame nothing is drawn. */
  const fresh = placeLabels([{ kind: 'A', x: 300, y: 600, t: 5, fresh: true }, { kind: 'B', x: 300, y: 600, t: 9 }], measure, { topH: 246 });
  assert.equal(fresh[0].kind, 'A');
  assert.deepEqual(placeLabels([{ kind: 'Up', x: 300, y: 100, t: 1 }, { kind: 'Low', x: 300, y: 1200, t: 1 }, { kind: 'Nowhere', x: NaN, y: 3, t: 1 }], measure, { topH: 246 }), []);
});

await t('a long sentence wraps to the width it is given', () => {
  const measure = (s) => s.length * 10;
  assert.deepEqual(wrapText('one two three four', 90, measure), ['one two', 'three', 'four']);
  assert.deepEqual(wrapText('incomprehensibilities', 50, measure), ['incomprehensibilities'], 'a word too wide keeps its line');
  assert.deepEqual(wrapText('', 50, measure), []);
});

/* ── Drawing and recording, against stand-ins ─────────────────────── */

/** A 2D context that takes anything and notes the words it was asked to draw. */
function fakeCtx(said = [], alpha = 255) {
  const base = {
    measureText: (s) => ({ width: String(s).length * 10 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4).fill(alpha) }),
    fillText: (s) => { said.push(String(s)); },
    said,
    drew: [], path: [],
    drawImage(img, ...at) { this.drew.push([img, ...at]); },
    lineTo(x, y) { this.path.push([x, y]); },
  };
  return new Proxy(base, {
    get: (o, k) => (k in o ? o[k] : (o[k] = () => {})),
    set: (o, k, v) => { o[k] = v; return true; },
  });
}

const hostOf = (over = {}) => ({
  from: T, to: T + 300000, points: [...track, ...trail], reveal: 'end', revealWords: 'The laid trail',
  lines: { title: 'Rex', stats: '13 Oct 2026 · 330 m · 5:00', level: 'Scent Reader II' },
  closing: { sentence: 'Rex’s track stayed within 3 m of the line for 74 % of the run.', tag: 'Blind run' },
  credit: '© Mapbox © OpenStreetMap © Maxar',
  calls: [],
  answer(show) { this.calls.push(['answer', show]); },
  paint(at) { this.calls.push(['paint', at]); },
  marks: (at) => [{ kind: 'Indication', lat: 51.201, lon: -2.65, t: T + 100000 }].filter(w => w.t <= at),
  wind: () => ({ toward: 70, words: 'Wind: from WSW, 12 km/h (forecast)' }),
  ...over,
});

await t('a frame says the dog, the stats, the level, the clock, the marks reached, the wind and the credit', () => {
  const ctx = fakeCtx();
  const host = hostOf();
  drawFrame(ctx, { mapBuf: null, host, st: clipAt(clipPlan(15, { reveal: true }), 5), clock: '2:23',
    marks: [{ kind: 'Indication', x: 300, y: 600, fresh: true }, { kind: 'Off the frame', x: 300, y: 20 }], wind: host.wind() });
  for (const want of ['Rex', '13 Oct 2026 · 330 m · 5:00', 'Scent Reader II', '2:23', 'Indication', 'Wind: from WSW, 12 km/h (forecast)',
    'Trailcraft', '© Mapbox © OpenStreetMap © Maxar']) assert.ok(ctx.said.includes(want), `the frame says "${want}"`);
  assert.ok(!ctx.said.includes('Off the frame'), 'a mark under the top strip is not labelled over it');
  assert.ok(!ctx.said.includes('The laid trail') && !ctx.said.includes('Blind run'), 'nothing of the end before the end');
});

await t('with the answer on the map the route is drawn again over it, and Mapbox’s wordmark sits beside its credit', () => {
  const host = hostOf({ dog: { colour: '#FF8800', casing: '#0B1630' } });
  const plan = clipPlan(15, { reveal: true });
  const logo = { naturalWidth: 88, naturalHeight: 23 };
  const mapBuf = { map: true };
  for (const at of [11.5, 14]) {            // the reveal, then the closing card
    const ctx = fakeCtx();
    drawFrame(ctx, { mapBuf, host, st: clipAt(plan, at), clock: '5:00', marks: [], wind: host.wind(), logo,
      route: [{ x: 100, y: 900 }, { x: 140, y: 800 }, { x: 180, y: 700 }] });
    /* (The wind's arrow is lines too, a few pixels long about its own middle.) */
    assert.deepEqual(ctx.path.filter(q => q[1] >= 700), [[140, 800], [180, 700], [140, 800], [180, 700]], 'a casing, then the dog’s colour');
    assert.equal(ctx.drew[0][0], mapBuf, 'over the map');
    const mark = ctx.drew.find(d => d[0] === logo);
    assert.ok(mark, 'the wordmark is drawn');
    const [, x, y, w, h] = mark;
    assert.ok(x === 36 && y + h <= CLIP.H - 24 && y > CLIP.H - 120 && Math.abs(w / h - 88 / 23) < 1e-9, 'bottom left, at its own shape');
    assert.equal(ctx.said[ctx.said.length - 1], '© Mapbox © OpenStreetMap © Maxar', 'and the text credit with it');
  }
  /* A basic map has no wordmark, and a picture that will not draw costs only itself. */
  const plain = fakeCtx();
  drawFrame(plain, { mapBuf, host, st: clipAt(plan, 5), clock: '1:00', marks: [], wind: host.wind() });
  assert.equal(plain.drew.length, 1);
  const bad = fakeCtx();
  bad.drawImage = (img) => { if (img === logo) throw new Error('tainted'); };
  drawFrame(bad, { mapBuf, host, st: clipAt(plan, 5), clock: '1:00', marks: [], wind: host.wind(), logo });
  assert.equal(bad.said[bad.said.length - 1], '© Mapbox © OpenStreetMap © Maxar');
});

await t('the frame keeps clear of what a social app covers: words below a Story’s header, the wind under the strip, only the credit at the bottom', () => {
  const at = [];
  const ctx = fakeCtx();
  ctx.fillText = (s, x, y) => { at.push({ s: String(s), x, y }); };
  const host = hostOf();
  drawFrame(ctx, { mapBuf: null, host, st: clipAt(clipPlan(15, { reveal: true }), 5), clock: '2:23', marks: [], wind: host.wind() });
  const y = (s) => at.find(a => a.s === s).y;
  assert.ok(at.every(a => a.y >= 110), 'nothing is said in the top 110 px');
  assert.ok(y('Rex') < y('13 Oct 2026 · 330 m · 5:00') && y('13 Oct 2026 · 330 m · 5:00') < y('Scent Reader II'));
  assert.equal(y('Trailcraft'), y('13 Oct 2026 · 330 m · 5:00'), 'the name of the app is up beside the stats');
  assert.ok(y('Wind: from WSW, 12 km/h (forecast)') > 246 && y('Wind: from WSW, 12 km/h (forecast)') < 320, 'the wind is under the top strip');
  const low = at.filter(a => a.y > CLIP.H - 300).map(a => a.s);
  assert.deepEqual(low, ['© Mapbox © OpenStreetMap © Maxar'], 'and the bottom of the frame holds the credit alone');
});

await t('the reveal is named, and the closing card says the sentence with the credit still under it', () => {
  const host = hostOf();
  const plan = clipPlan(15, { reveal: true });
  const reveal = fakeCtx();
  drawFrame(reveal, { mapBuf: null, host, st: clipAt(plan, 11.5), clock: '5:00', marks: [], wind: host.wind() });
  assert.ok(reveal.said.includes('The laid trail'));
  const card = fakeCtx();
  drawFrame(card, { mapBuf: null, host, st: clipAt(plan, 14), clock: '5:00', marks: [], wind: host.wind() });
  assert.ok(card.said.includes('TRAILCRAFT') && card.said.includes('Blind run'));
  assert.ok(card.said.join(' ').includes(host.closing.sentence), 'the whole sentence, wrapped onto its lines in order');
  assert.ok(!card.said.includes(host.closing.sentence), 'and it did wrap: it is wider than the frame');
  assert.equal(card.said[card.said.length - 1], '© Mapbox © OpenStreetMap © Maxar', 'the credit is drawn last, over the card');
  assert.ok(!card.said.some(s => s.startsWith('Wind:')), 'the wind badge is not left on the card');
});

/** The browser, as much of it as the recorder touches. Frames are pumped by
    hand on a clock of our own, so thirty seconds take no time. */
function world({ types = ['video/mp4;codecs=avc1.640028', 'video/mp4'], alpha = 255, recorder = true, plays = NaN, stalls = false, wake = true } = {}) {
  const w = { clock: 1000, raf: [], docOn: new Map(), tracks: [{ stopped: 0, stop() { this.stopped++; } }], rec: null, locks: [], drawn: 0, videos: [] };
  /* The player the finished file is measured with. `plays` is the length
     it reports: NaN for a device that will not say, a pair for a file with
     no length in it until the player has been sent to its end. */
  const videoOf = () => {
    const v = { duration: Array.isArray(plays) ? plays[0] : plays, removeAttribute() {}, load() {},
      set src(u) { this.url = u; queueMicrotask(() => this.onloadedmetadata?.()); },
      set currentTime(x) { this.duration = Array.isArray(plays) ? plays[1] : this.duration; queueMicrotask(() => this.onseeked?.()); } };
    w.videos.push(v);
    return v;
  };
  const canvasOf = () => {
    const ctx = fakeCtx([], alpha);
    return { width: 0, height: 0, clientWidth: 390, clientHeight: 844, getContext: () => ctx, ctx,
      captureStream: (fps) => { w.fps = fps; return { getTracks: () => w.tracks }; } };
  };
  w.canvas = canvasOf();
  const mapCanvas = { width: 780, height: 1688, clientWidth: 390, clientHeight: 844 };
  const on = new Map();
  w.map = {
    on, did: [], vis: { 'wp-text': 'visible' },
    on_(type, f) { (on.get(type) ?? on.set(type, new Set()).get(type)).add(f); },
    getCanvas: () => mapCanvas,
    getCenter: () => ({ lng: -2.65, lat: 51.2 }), getZoom: () => 15.5, getBearing: () => 30, getPitch: () => 45,
    getLayer: (id) => (id in w.map.vis ? { id } : undefined),
    getLayoutProperty: (id) => w.map.vis[id],
    setLayoutProperty: (id, k, v) => { w.map.vis[id] = v; },
    cameraForBounds: (b, o) => { w.fit = { b, o }; return { center: [-2.65, 51.2015], zoom: 16.2 }; },
    jumpTo: (c) => w.map.did.push(c),
    triggerRepaint: () => { for (const f of [...(on.get('render') ?? [])]) f(); },
    project: ([lon, lat]) => ({ x: 195, y: 422 - (lat - 51.2015) * 100000 }),
  };
  w.map.on = (type, f) => { w.map.on_(type, f); if (type === 'idle') setTimeout(() => { if (on.get('idle')?.has(f)) f(); }, 0); };
  w.map.off = (type, f) => on.get(type)?.delete(f);
  w.listeners = () => [...on.values()].reduce((n, s) => n + s.size, 0);
  const g = globalThis;
  const set = (k, v) => Object.defineProperty(g, k, { value: v, configurable: true, writable: true });
  set('performance', { now: () => w.clock });
  set('requestAnimationFrame', (f) => { w.raf.push(f); return w.raf.length; });
  set('cancelAnimationFrame', () => { w.raf.length = 0; });
  set('document', {
    visibilityState: 'visible', createElement: (tag) => (tag === 'video' ? videoOf() : canvasOf()),
    addEventListener: (type, f) => w.docOn.set(f, type), removeEventListener: (type, f) => w.docOn.delete(f),
  });
  set('navigator', wake ? { wakeLock: { request: async () => { const l = { released: 0, release: async () => { l.released++; } }; w.locks.push(l); return l; } } } : {});
  set('HTMLCanvasElement', { prototype: { captureStream() {} } });
  set('MediaRecorder', recorder ? Object.assign(class {
    constructor(stream, opts) { this.stream = stream; this.opts = opts; this.state = 'inactive'; w.rec = this; }
    start(slice) { this.state = 'recording'; this.slice = slice; }
    requestData() { this.asked = (this.asked ?? 0) + 1; }
    stop() {
      if (this.state === 'inactive') throw new Error('not recording');
      this.state = 'inactive'; this.stopped = true;
      if (stalls) return;                    // a recorder that never hands the file over
      queueMicrotask(() => { this.ondataavailable?.({ data: new Blob(['video']) }); this.onstop?.(); });
    }
  }, { isTypeSupported: (m) => types.includes(m) }) : undefined);
  /** Frames for `s` seconds of the page's clock. */
  w.pump = async (s) => {
    for (let x = 0; x < s; x += 1 / 30) {
      w.clock += 1000 / 30;
      for (const f of w.raf.splice(0)) f(w.clock);
      await new Promise(r => setImmediate(r));
    }
  };
  w.hide = () => { g.document.visibilityState = 'hidden'; for (const [f] of [...w.docOn]) f(); };
  return w;
}
/* Let the recorder finish getting ready: the screen hold, the camera, the map going quiet. */
const ready = async (w) => { for (let i = 0; i < 6 && !w.rec; i++) { await new Promise(r => setTimeout(r, 2)); await w.pump(0.04); } };

await t('a blind run, recorded: the answer held back, shown at the end, and everything handed back', async () => {
  const w = world();
  const host = hostOf();
  const seen = [];
  const job = recordClip({ map: w.map, canvas: w.canvas, seconds: 15, host, onProgress: (p) => seen.push(p) });
  await ready(w);
  assert.ok(w.rec, 'the recorder was started');
  assert.deepEqual([w.canvas.width, w.canvas.height, w.fps], [720, 1280, 30]);
  assert.deepEqual(w.rec.opts, { mimeType: 'video/mp4;codecs=avc1.640028', videoBitsPerSecond: 5000000 });
  assert.equal(w.rec.slice, 1000, 'in pieces, not one lump at the end');
  assert.deepEqual(w.map.did[0], { center: [-2.65, 51.2015], zoom: 16.2, bearing: 0, pitch: 0 }, 'flat and north up, fitted once');
  assert.deepEqual(w.fit.o.padding, framePadding(390, 844));
  assert.equal(w.map.vis['wp-text'], 'none', 'the map’s own mark labels give way to the video’s');
  assert.deepEqual(host.calls[0], ['answer', false], 'a blind run opens with nothing laid on the map');
  const t0 = w.clock;
  let out = null;
  job.done.then((o) => { out = o; });
  await w.pump(10.2);
  assert.ok(!host.calls.some(c => c[0] === 'answer' && c[1] === true), 'ten seconds in, still held back');
  assert.equal(out, null);
  await w.pump(6);
  assert.equal(out?.status, 'done');
  assert.ok(w.rec.stopped);
  assert.deepEqual([out.type, out.ext, out.seconds], ['video/mp4', 'mp4', 15]);
  assert.ok(out.blob instanceof Blob && out.blob.size > 0 && out.blob.type === 'video/mp4');
  assert.equal(w.rec.asked, 1, 'the recorder is asked for what it has before it is stopped');
  assert.deepEqual(seen.find(p => p.stage === 'prepare'), { stage: 'prepare', t: 0, total: 15, held: true }, 'the screen is held, and the caller is told');
  assert.equal(seen[seen.length - 1].stage, 'finish', 'and told when the file is being handed over');
  /* The answer once, and only once the route had finished. */
  const answers = host.calls.filter(c => c[0] === 'answer');
  assert.deepEqual(answers, [['answer', false], ['answer', true]]);
  const shown = host.calls.findIndex(c => c[0] === 'answer' && c[1] === true);
  const paints = host.calls.filter(c => c[0] === 'paint').map(c => c[1]);
  assert.equal(paints[0], host.from);
  assert.ok(paints.every((at, i) => i === 0 || at >= paints[i - 1]), 'the run only ever goes forwards');
  assert.ok(host.calls.slice(0, shown).filter(c => c[0] === 'paint').every(c => c[1] < host.to), 'the route was still drawing at every frame before it');
  assert.equal(paints[paints.length - 1], host.to);
  /* Fifteen seconds, to within a frame or two. */
  const total = seen.filter(p => p.stage === 'record').map(p => p.t);
  assert.equal(seen[0].stage, 'prepare');
  assert.equal(total[total.length - 1], 15);
  /* The card is held a moment past the length before the stop, for an encoder a few frames behind. */
  assert.ok(total.filter(x => x === 15).length >= Math.floor(CLIP.DRAIN_S * 30), 'drained before stopping');
  assert.ok(w.canvas.ctx.said.includes('The laid trail') && w.canvas.ctx.said.includes('Blind run'));
  /* And nothing kept. */
  assert.equal(w.listeners(), 0, 'no listener left on the map');
  assert.equal(w.docOn.size, 0, 'nor on the page');
  assert.equal(w.raf.length, 0, 'no frame still asked for');
  assert.equal(w.tracks[0].stopped, 1, 'the stream is stopped');
  assert.deepEqual(w.locks.map(l => l.released), [1], 'the screen is let go');
  assert.equal(w.map.vis['wp-text'], 'visible');
  assert.deepEqual(w.map.did[w.map.did.length - 1], { center: { lng: -2.65, lat: 51.2 }, zoom: 15.5, bearing: 30, pitch: 45 }, 'the camera exactly where it was');
  assert.ok(w.clock - t0 >= 15000 && w.clock - t0 < 16300);
});

await t('a run that was not blind has its trail from the first frame, and no reveal to wait for', async () => {
  const w = world({ types: ['video/webm;codecs=vp8', 'video/webm'] });
  const host = hostOf({ reveal: 'start' });
  const job = recordClip({ map: w.map, canvas: w.canvas, seconds: 15, host });
  await ready(w);
  let out = null;
  job.done.then((o) => { out = o; });
  await w.pump(15.3);
  assert.deepEqual(host.calls.filter(c => c[0] === 'answer'), [['answer', true]]);
  assert.deepEqual([out.status, out.type, out.ext], ['done', 'video/webm', 'webm'], 'and a browser with no H.264 makes a WebM, named as one');
  assert.equal(w.rec.opts.mimeType, 'video/webm;codecs=vp8');
  assert.ok(!w.canvas.ctx.said.includes('The laid trail'));
});

await t('Cancel stops at once and has put the map back by the time it returns', async () => {
  const w = world();
  const host = hostOf();
  const job = recordClip({ map: w.map, canvas: w.canvas, seconds: 30, host });
  await ready(w);
  await w.pump(4);
  job.cancel('cancelled');
  assert.equal(w.listeners(), 0);
  assert.equal(w.docOn.size, 0);
  assert.equal(w.tracks[0].stopped, 1);
  assert.equal(w.map.vis['wp-text'], 'visible');
  assert.deepEqual(w.map.did[w.map.did.length - 1], { center: { lng: -2.65, lat: 51.2 }, zoom: 15.5, bearing: 30, pitch: 45 });
  assert.ok(w.rec.stopped, 'the recorder is stopped, its file thrown away');
  assert.deepEqual(await job.done, { status: 'cancelled', reason: 'cancelled' });
  const n = host.calls.length;
  await w.pump(1);
  assert.equal(host.calls.length, n, 'and the replay is not touched again');
  assert.ok(!host.calls.some(c => c[0] === 'answer' && c[1] === true), 'cancelled before the end, the answer never went on the map');
  job.cancel('again');     // a second press is nothing
});

await t('cancelled while still getting ready, it never starts', async () => {
  const w = world();
  const job = recordClip({ map: w.map, canvas: w.canvas, seconds: 15, host: hostOf() });
  job.cancel('closed');
  assert.deepEqual(await job.done, { status: 'cancelled', reason: 'closed' });
  await ready(w);
  assert.equal(w.rec, null);
  assert.equal(w.listeners(), 0);
  assert.deepEqual(w.locks.map(l => l.released), [1], 'a screen hold that arrived late is let go');
});

await t('the app going to the background stops the recording, and says that is why', async () => {
  const w = world();
  const job = recordClip({ map: w.map, canvas: w.canvas, seconds: 30, host: hostOf() });
  await ready(w);
  await w.pump(3);
  w.hide();
  assert.deepEqual(await job.done, { status: 'cancelled', reason: 'background' });
  assert.equal(w.listeners() + w.docOn.size, 0);
  assert.equal(w.tracks[0].stopped, 1);
  assert.equal(CLIP_SAYS.background, 'Recording stopped because Trailcraft went to the background. Keep it on screen and try again.');
});

await t('a device that cannot record, or hands over an empty map, is told in plain words and nothing is left running', async () => {
  const none = world({ recorder: false });
  const a = recordClip({ map: none.map, canvas: none.canvas, seconds: 15, host: hostOf() });
  assert.deepEqual(await a.done, { status: 'failed', say: 'This device can’t record the replay.', why: 'unsupported' });
  assert.equal(none.listeners(), 0);
  assert.equal(none.map.did.length, 0, 'the camera was never moved');
  const webmOnlyNot = world({ types: [] });
  assert.equal((await recordClip({ map: webmOnlyNot.map, canvas: webmOnlyNot.canvas, seconds: 15, host: hostOf() }).done).status, 'failed');

  /* A web view whose map canvas reads back as nothing at all. */
  const blank = world({ alpha: 0 });
  const b = recordClip({ map: blank.map, canvas: blank.canvas, seconds: 15, host: hostOf() });
  await ready(blank);
  let out = null;
  b.done.then((o) => { out = o; });
  await blank.pump(3);
  assert.deepEqual(out, { status: 'failed', say: 'This device can’t record the map.', why: 'blank' });
  assert.equal(blank.listeners() + blank.docOn.size, 0);
  assert.equal(blank.tracks[0].stopped, 1);
});

await t('the screen is held by the app’s own shell where there is one, and the caller hears when nothing holds it', async () => {
  /* The iPhone app: the shell's hold, asked for and given back, whichever way it ends. */
  const w = world({ wake: false });
  const holds = [];
  const seen = [];
  const job = recordClip({ map: w.map, canvas: w.canvas, seconds: 15, host: hostOf({ hold: async (on) => { holds.push(on); return true; } }), onProgress: (p) => seen.push(p) });
  await ready(w);
  assert.equal(seen[0].held, true, 'the shell’s hold is enough with no hold of the page’s own');
  job.cancel('cancelled');
  await job.done;
  assert.deepEqual(holds, [true, false], 'held, and let go');
  /* An older iPhone in Safari, or an app built before its hold: nothing. */
  const bare = world({ wake: false });
  const said = [];
  const b = recordClip({ map: bare.map, canvas: bare.canvas, seconds: 15, host: hostOf({ hold: async () => false }), onProgress: (p) => said.push(p) });
  await ready(bare);
  assert.deepEqual(said[0], { stage: 'prepare', t: 0, total: 15, held: false }, 'the phone may lock itself: the caller is told before it does');
  b.cancel('cancelled');
  await b.done;
  /* A shell hold that arrives after Cancel is let go. */
  const late = world({ wake: false });
  const lateHolds = [];
  const c = recordClip({ map: late.map, canvas: late.canvas, seconds: 15, host: hostOf({ hold: async (on) => { lateHolds.push(on); return true; } }) });
  c.cancel('closed');
  await c.done;
  await ready(late);
  assert.deepEqual(lateHolds, [true, false]);
  assert.equal(canHoldScreen({ navigator: { wakeLock: { request() {} } } }), true);
  assert.equal(canHoldScreen({ navigator: {} }), false, 'iOS before 16.4 has no hold for a page');
  assert.equal(canHoldScreen({}), false);
  assert.match(CLIP_SAYS.lock, /may lock while recording.*pick 15 s/);
});

await t('a file that came out short is not announced as the video, and the length said is the length made', async () => {
  /* An encoder that fell behind: thirteen seconds of a fifteen-second video, the reveal and the card gone. */
  const short = world({ plays: 13.02 });
  const a = recordClip({ map: short.map, canvas: short.canvas, seconds: 15, host: hostOf() });
  await ready(short);
  let out = null;
  a.done.then((o) => { out = o; });
  await short.pump(15.6);
  assert.deepEqual(out, { status: 'failed', say: 'This device couldn’t keep up. Try a shorter video.', why: 'short' });
  assert.equal(short.listeners() + short.docOn.size, 0, 'and the map is handed back all the same');
  /* A whole one, a few frames over: said as what it is. */
  const whole = world({ plays: 15.21 });
  const b = recordClip({ map: whole.map, canvas: whole.canvas, seconds: 15, host: hostOf() });
  await ready(whole);
  b.done.then((o) => { out = o; });
  await whole.pump(15.6);
  assert.deepEqual([out.status, out.seconds], ['done', 15]);
  assert.match(whole.videos[0].url, /^blob:/, 'measured from the file itself');
  /* A WebM has no length in it until the player has been to its end. */
  const webm = world({ types: ['video/webm'], plays: [Infinity, 29.9] });
  const c = recordClip({ map: webm.map, canvas: webm.canvas, seconds: 30, host: hostOf({ reveal: 'start' }) });
  await ready(webm);
  c.done.then((o) => { out = o; });
  await webm.pump(30.6);
  assert.deepEqual([out.status, out.ext, out.seconds], ['done', 'webm', 30]);
  /* Within the allowance it stands; just past it, it does not. */
  assert.ok(CLIP.SHORT_S > 0.5 && CLIP.SHORT_S < 1);
  /* The player by itself: a length, a length found at the end, and a device that will not say. */
  const player = (first, after) => ({ createElement: () => ({ duration: first, removeAttribute() {}, load() {},
    set src(u) { queueMicrotask(() => this.onloadedmetadata?.()); },
    set currentTime(x) { this.duration = after; queueMicrotask(() => this.onseeked?.()); } }) });
  const gone = [];
  const urls = { createObjectURL: () => 'blob:x', revokeObjectURL: (u) => gone.push(u) };
  assert.equal(await clipSeconds(new Blob(['v']), { doc: player(14.97), urls }), 14.97);
  assert.equal(await clipSeconds(new Blob(['v']), { doc: player(Infinity, 30.02), urls }), 30.02);
  assert.equal(await clipSeconds(new Blob(['v']), { doc: player(NaN, NaN), urls }), null);
  assert.equal(await clipSeconds(new Blob(['v']), { doc: { createElement: () => ({ set src(u) {} }) }, urls, ms: 5 }), null, 'a player that never answers is not waited on');
  assert.equal(await clipSeconds(new Blob(['v']), { doc: { createElement() { throw new Error('no'); } }, urls }), null);
  assert.deepEqual(gone, ['blob:x', 'blob:x', 'blob:x', 'blob:x'], 'the file’s address is let go every time one was made');
});

await t('a recorder that never hands the file over is given up on, not waited for', async () => {
  const w = world({ stalls: true });
  const seen = [];
  const job = recordClip({ map: w.map, canvas: w.canvas, seconds: 15, host: hostOf(), stopWait: 30, onProgress: (p) => seen.push(p.stage) });
  await ready(w);
  let out = null;
  job.done.then((o) => { out = o; });
  await w.pump(15.4);
  assert.equal(seen[seen.length - 1], 'finish');
  await new Promise(r => setTimeout(r, 60));
  assert.deepEqual(out, { status: 'failed', say: 'The recording stopped before it finished. Try again.', why: 'failed' });
  assert.equal(w.listeners() + w.docOn.size, 0);
  assert.equal(w.tracks[0].stopped, 1);
  assert.equal(CLIP.STOP_WAIT_MS, 5000);
  /* Cancel while it waits still answers at once. */
  const v = world({ stalls: true });
  const j = recordClip({ map: v.map, canvas: v.canvas, seconds: 15, host: hostOf() });
  await ready(v);
  await v.pump(15.4);
  j.cancel('cancelled');
  assert.deepEqual(await j.done, { status: 'cancelled', reason: 'cancelled' });
});

/* ── The wiring ───────────────────────────────────────────────────── */

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const js = read('public/app.js'), html = read('public/index.html'), clip = read('public/clip.js'), css = read('public/app.css');
const bodyOf = (name, kw = 'function') => {
  const i = js.indexOf(`\n${kw} ${name}(`);
  assert.ok(i > 0, `app.js still has ${name}()`);
  return js.slice(i, js.indexOf('\n}\n', i) + 2);
};

await t('wired: Save video sits on the replay, never in the marking, and the sheet offers the three lengths', () => {
  assert.match(html, /<div class="row-gap" id="repEditRow" hidden>\s*<button class="btn ghost" id="repEdit">Edit marks<\/button>\s*<button class="btn ghost" id="repClip">Save video<\/button>/);
  assert.match(html, /<div class="clip" id="clipSheet" role="dialog" aria-modal="true" aria-labelledby="clipTitle" hidden>/);
  assert.deepEqual([...html.matchAll(/role="radio" data-clip="(\d+)"/g)].map(m => Number(m[1])), [...CLIP.LENGTHS]);
  assert.match(html, /id="clipBar" role="progressbar"/);
  assert.match(html, /id="clipStatus" role="status"/);
  const tools = bodyOf('paintMarkTools');
  assert.match(tools, /\$\('repClip'\)\.hidden = !clipOffered\(\{ run: s\?\.data\?\.track\?\.length > 1, marking: !!m \}\);/);
  assert.match(tools, /\$\('repEditRow'\)\.hidden = !!m \|\| !s \|\|/, 'the whole row goes while marking');
  const open = bodyOf('openClip');
  assert.match(open, /if \(!clipOffered\(\{ run: s\?\.data\?\.track\?\.length > 1, marking: !!replay\.mark, recording: !!clipUi\.job \}\)\) return;/);
  assert.match(bodyOf('startClip'), /if \(clipUi\.job \|\| !s \|\| replay\.mark \|\| !mapReady\) return;/, 'and Start refuses it too');
  for (const id of ['repClip', 'clipStart', 'clipClose', 'clipCancel', 'clipSave', 'clipDoneClose']) {
    assert.match(js, new RegExp(`\\$\\('${id}'\\)\\.addEventListener\\('click', `), `${id} is wired`);
  }
  /* 44 px targets: the lengths are taller, and the buttons are the app's own. */
  assert.match(css, /\.clip-len \.db-opt \{\s*flex: 1 1 0; min-height: 52px;/);
});

await t('wired: the replay is lent to the video and put back, and leaving the replay stops it', () => {
  const host = bodyOf('clipHost');
  assert.match(host, /reveal: answerPlan\(s, kind\),/);
  assert.match(host, /const was = replay\.s;\s*\n\s*replay\.s = show \? s : hidden;\s*\n\s*if \(!show\) plumeStop\(\);/, 'the scent goes with the trail');
  /* The answer put back over the hidden copy adds to the map and clears nothing: clearing empties the
     dog's route as well, and the map can draw that empty moment into the video. */
  assert.match(host, /drawReplayGround\(replay\.s, \{ keep: show && was === hidden \}\);/);
  assert.match(bodyOf('drawReplayGround'), /^\nfunction drawReplayGround\(s, \{ keep = false \} = \{\}\) \{\n  if \(!keep\) clearMap\(\);\n/);
  assert.match(host, /route: \(\) => track,\s*\n\s*dog: \{ colour: dp\.base, casing: dp\.casing \},/, 'the route and its colour, for the video to draw over the scent');
  assert.match(host, /const dp = trackPalette\(settings\.dogColor\);/);
  assert.match(host, /logo: GL === mapboxgl && \$\('map'\)\.querySelector\('\.mapboxgl-ctrl-logo'\)\s*\n\s*\? cssUrl\(getComputedStyle\(\$\('map'\)\.querySelector\('\.mapboxgl-ctrl-logo'\)\)\.backgroundImage\) : null,/,
    'Mapbox’s wordmark, from the live map’s own stylesheet, and only on a Mapbox map');
  assert.match(host, /hold: \(on\) => keepAwake\(on\),/, 'the iPhone app’s own hold on the screen');
  assert.match(host, /const hidden = withoutAnswer\(s\);/);
  assert.match(host, /level: lv && proven\(lv\) \? earnedName\(lv\) : null, imperial: imp\(\)/, 'an earned level only, in the handler’s units');
  assert.match(host, /credit: creditLine\(\$\('map'\)\.querySelector\('\.mapboxgl-ctrl-attrib-inner, \.maplibregl-ctrl-attrib-inner'\)\?\.textContent/);
  const restore = bodyOf('clipRestore');
  assert.match(restore, /replay\.s = was\.s;\s*\n\s*replay\.at = was\.at;\s*\n\s*drawReplayGround\(was\.s\);\s*\n\s*paintReplay\(\);/);
  assert.match(bodyOf('stopClip'), /job\.cancel\(reason\);\s*\n\s*clipRestore\(\);/, 'put back before anything else runs');
  assert.match(bodyOf('closeReplay'), /replayPause\(\);\s*\n\s*closeClip\(\);/);
  assert.ok(/if \(currentScreen === 'scrReplay' && clipUi\.open\) \{[\s\S]{0,200}?closeClip\(\);\s*\n\s*return;/.test(js), 'the back gesture closes the sheet first');
  assert.match(bodyOf('clipLock'), /\$\('map'\)/, 'the map takes no keys while it is filmed');
  assert.match(bodyOf('clipLock'), /\$\('wxPanel'\), \$\('wxRose'\),/, 'nor is the compass, a button of its own beside the air panel, left reachable');
  assert.match(html, /id="wxRose"[^>]*role="button"|role="button"[^>]*id="wxRose"/);
});

await t('wired: why there is no video is said in the sheet, where it stays, and a device that cannot is not offered Start again', () => {
  assert.match(html, /<p class="clip-say" id="clipSay" role="status">A tall video of the whole run, sped up to fit the length you pick\. Keep Trailcraft on screen while it records\.<\/p>/);
  assert.match(js, /const CLIP_INTRO = 'A tall video of the whole run, sped up to fit the length you pick\. Keep Trailcraft on screen while it records\.';/);
  const start = bodyOf('startClip');
  assert.doesNotMatch(start, /toast\(/, 'not a toast: one raised in a hidden page is never shown, and any toast is gone in seconds');
  assert.match(start, /\$\('clipSay'\)\.textContent = out\.status === 'failed' \? out\.say : CLIP_SAYS\.background;/);
  assert.match(start, /if \(out\.status === 'failed' && \(out\.why === 'blank' \|\| out\.why === 'unsupported'\)\) \{\s*\n\s*clipCannot\(out\.say\);\s*\n\s*return \$\('clipClose'\)\.focus/);
  assert.ok(start.indexOf("$('clipSay').textContent = CLIP_INTRO;") > 0 && start.indexOf("$('clipSay').textContent = CLIP_INTRO;") < start.indexOf('recordClip({'), 'a new try starts with a clean sheet');
  const cannot = bodyOf('clipCannot');
  assert.match(cannot, /You can still record the screen from Control Centre while the replay plays\./);
  assert.match(cannot, /\$\('clipLen'\)\.hidden = true;\s*\n\s*\$\('clipStart'\)\.hidden = true;/);
  const open = bodyOf('openClip');
  assert.match(open, /\$\('clipSay'\)\.textContent = CLIP_INTRO;\s*\n\s*\$\('clipLen'\)\.hidden = false;\s*\n\s*\$\('clipStart'\)\.hidden = false;/);
  assert.match(open, /if \(!clipSupport\(\)\) clipCannot\(CLIP_SAYS\.unsupported\);/);
  assert.match(start, /if \(stage === 'finish'\) \{ \$\('clipStatus'\)\.textContent = 'Finishing the video…'; return; \}/);
});

await t('wired: a phone with nothing to keep its screen on is told before Start, and offered the short video', () => {
  assert.match(js, /const clipHolds = async \(\) => canHoldScreen\(\) \|\| \(isNative\(\) && await keepAwake\(false\)\);/);
  const open = bodyOf('openClip');
  assert.match(open, /else if \(clipOnPhone\(\)\) clipHolds\(\)\.then\(\(ok\) => \{/);
  assert.match(open, /clipUi\.seconds = CLIP\.LENGTHS\[0\];\s*\n\s*paintClipLen\(\);\s*\n\s*\$\('clipSay'\)\.textContent = `\$\{CLIP_INTRO\} \$\{CLIP_SAYS\.lock\}`;/);
  const start = bodyOf('startClip');
  assert.match(start, /\$\('clipHint'\)\.textContent = CLIP_SAYS\.touch;\s*\n\s*\$\('clipHint'\)\.hidden = held !== false \|\| !clipOnPhone\(\);/);
  assert.match(html, /<p class="clip-say" id="clipHint" hidden><\/p>/);
  /* The shell's side of it: the system's own idle timer, on the main queue, registered beside the compass. */
  const swift = read('ios/App/App/TrailcraftNative.swift');
  assert.match(swift, /bridge\?\.registerPluginInstance\(KeepAwakePlugin\(\)\)/);
  assert.match(swift, /public let jsName = "KeepAwake"/);
  for (const [name, to] of [['on', 'true'], ['off', 'false']]) {
    assert.match(swift, new RegExp(`CAPPluginMethod\\(name: "${name}", returnType: CAPPluginReturnPromise\\)`));
    assert.match(swift, new RegExp(`@objc func ${name}\\(_ call: CAPPluginCall\\) \\{\\s*DispatchQueue\\.main\\.async \\{\\s*UIApplication\\.shared\\.isIdleTimerDisabled = ${to}\\s*call\\.resolve\\(\\)`));
  }
  assert.doesNotMatch(clip, /a dimmed screen still records/, 'the old reasoning is gone: an unheld phone locks, and a locked phone stops the recording');
});

await t('wired: the file goes to the phone’s share sheet in the app, a phone browser’s where it takes files, else a download', () => {
  const out = bodyOf('deliverClip', 'async function');
  assert.ok(out.indexOf('shareBlob(made.blob, made.name)') < out.indexOf('navigator.canShare'), 'the app’s own sheet first');
  /* A computer downloads, as Rémi was told: its share menu (Safari on a Mac, Chrome on Windows) has no plain save. */
  assert.match(out, /if \(clipOnPhone\(\) && navigator\.canShare\?\.\(\{ files: \[file\] \}\)\) \{\s*\n\s*try \{ await navigator\.share\(\{ files: \[file\], title: made\.name \}\); return 'shared'; \}/);
  assert.match(js, /const clipOnPhone = \(\) => isNative\(\) \|\| \(navigator\.maxTouchPoints > 0 && matchMedia\('\(pointer: coarse\)'\)\.matches\);/);
  assert.ok(out.indexOf("if (isNative()) { toast('Could not share the video from this app'); return 'failed'; }\n  const a =") > 0
    && out.indexOf('a.download = made.name;') > out.indexOf('navigator.canShare'), 'never a download inside the app, where one goes nowhere');
  assert.match(out, /URL\.revokeObjectURL\(a\.href\)/);
  assert.match(out, /toast\(`Saved \$\{made\.name\}`\);\s*\n\s*return 'saved';/);
  assert.match(bodyOf('startClip'), /name: clipName\(modelOf\(s\), out\.ext\)/, 'named by the app’s one file-name helper, for the type that was made');
  assert.match(bodyOf('startClip'), /if \(isNative\(\)\) saveClip\(\);/, 'a browser needs a fresh tap to share; the app does not');
  assert.match(read('ios/App/App/Info.plist'), /<key>NSPhotoLibraryAddUsageDescription<\/key>\s*<string>[^<]{20,}<\/string>/, 'Save Video in the share sheet needs its reason');
});

await t('wired: one save at a time, the pane says what is happening, and an unsaved video is not "Done"', () => {
  const save = bodyOf('saveClip');
  /* The app saves by itself when a recording ends while Save video sits under a finger: a second save joins the first. */
  assert.match(save, /if \(clipUi\.saving\) return clipUi\.saving;\s*\n\s*\$\('clipSave'\)\.disabled = true;\s*\n\s*if \(isNative\(\)\) \$\('clipDoneSay'\)\.textContent = 'Getting the video ready to share…';/);
  assert.match(save, /\.finally\(\(\) => \{\s*\n\s*if \(clipUi\.saving !== saving\) return;[^\n]*\n\s*clipUi\.saving = null;\s*\n\s*\$\('clipSave'\)\.disabled = false;\s*\n\s*if \(clipUi\.made === made\) paintClipDone\(\);/);
  assert.match(save, /if \(clipUi\.made === made && \(how === 'shared' \|\| how === 'saved'\)\) clipUi\.saved = how;/);
  assert.match(bodyOf('closeClip'), /clipUi\.made = null;\s*\n\s*clipUi\.saved = false;\s*\n\s*clipUi\.saving = null;\s*\n\s*\$\('clipSave'\)\.disabled = false;/);
  assert.match(css, /\.clip \.btn:disabled \{ opacity: 0\.45; cursor: default; \}/);
  const done = bodyOf('paintClipDone');
  assert.match(done, /\$\('clipDoneClose'\)\.textContent = clipUi\.saved \? 'Done' : 'Discard';/, 'closing lets the file go, and the button says so until it has been saved');
  assert.match(done, /`\$\{ready\} Tap Save video to keep it\.`/);
  assert.match(html, /<button class="btn ghost" id="clipDoneClose">Discard<\/button>/);
  /* The length said is the length made, and a WebM is not passed off as something Photos will take. */
  assert.match(done, /made\.ext === 'webm'\s*\n\s*\? `Your \$\{made\.seconds\} s video is ready as a \.webm file\. It plays in a browser, but Photos and some apps won’t take it\./);
  assert.match(done, /: `Your \$\{made\.seconds\} s video is ready\.`;/);
  assert.match(bodyOf('startClip'), /clipUi\.made = \{ blob: out\.blob, type: out\.type, ext: out\.ext, seconds: out\.seconds, name:/);
});

await t('wired: the map is copied inside its own render, and is not rebuilt to keep every frame', () => {
  assert.doesNotMatch(js, /preserveDrawingBuffer:/);
  const render = clip.slice(clip.indexOf('const onRender = () => {'), clip.indexOf('const onHidden'));
  assert.match(render, /bufCtx\.drawImage\(src, c\.x, c\.y, c\.w, c\.h, 0, 0, W, H\)/);
  assert.match(clip, /map\.on\('render', onRender\);/);
  const tidy = clip.slice(clip.indexOf('function tidy() {'), clip.indexOf('function finish('));
  for (const want of ["map.off('render', onRender)", "document.removeEventListener('visibilitychange', onHidden)", 'cancelAnimationFrame(raf)',
    'getTracks().forEach(tr => tr.stop())', 'letGo()', 'map.jumpTo(cam)']) assert.ok(tidy.includes(want), `tidy() does ${want}`);
  assert.doesNotMatch(clip, /ReplayKit|getDisplayMedia/, 'the canvas is recorded, not the screen');
});

console.log(`\n${pass} passed total`);
