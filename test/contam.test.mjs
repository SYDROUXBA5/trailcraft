/* Contamination people, checked headlessly: their codes survive the trip
   into a QR code and back, a damaged or crafted code is refused in plain
   words, a walk coming back goes to the right person on the right trail or
   to nothing, the real clocks decide before and after, every person has a
   colour of their own, and the cross-track levels count real walks once
   there are any without ever counting more than drawn lines did. */

import assert from 'node:assert/strict';
import { encodeTrail, decodeTrail, encodeContam, isContamCard, through, b64url, TOO_TWISTY } from '../public/card.js';
import { planSession } from '../public/store.js';
import { mergeContam } from '../public/sync-core.js';
import { CONTAM_COLOURS, colourIndex, contamColour, nextColour, contamStatus, contamWay, newContam, orderFromTimes,
  crossings, contamWalkFor, attachWalk, sameWalk, withIds, contamWords, deltaE, trailClock, reorderContam, contamKey } from '../public/contam.js';
import { hexToRgb, luminance } from '../public/colours.js';
import { project, dist } from '../public/geo.js';
import { runFacts } from '../public/levels.js';
import { readBackup } from '../public/backup.js';
import { packDraft, unpackDraft } from '../public/draft.js';
import { trailModel, liveMeta, encodeShared, decodeShared, detailSections } from '../public/share.js';

let pass = 0;
const t = (name, fn) => Promise.resolve().then(fn).then(() => { pass++; console.log(`  ok  ${name}`); });

const MIN = 60000;
const T0 = Date.UTC(2026, 5, 1, 12, 0, 0);
const HOME = { lat: 51.2, lon: -2.65 };

/** A straight trail north, 300 m, a fix every 5 m, laid at walking pace. */
const trail = Array.from({ length: 61 }, (_, i) => ({ ...project(HOME, 0, i * 5), t: T0 + i * 4000 }));
const trailEnd = trail[trail.length - 1].t;
/** A walk across the trail's middle, west to east, starting at `t0`. */
const across = (t0, { off = 0 } = {}) => {
  const mid = project(trail[30], 90, off);
  return Array.from({ length: 21 }, (_, i) => ({ ...project(project(mid, 270, 50), 90, i * 5), t: t0 + i * 4000 }));
};
const DAMAGED = /damaged/;

/** A TC2 card built by hand, for the codes this app would never make. */
async function craft(payload) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  return 'TC2.' + b64url(await through(bytes, new CompressionStream('deflate-raw')));
}
const q = (v) => Math.round(v * 1e5);
const cols = (pts, times = true) => {
  const d = (a) => a.map((v, i) => (i ? v - a[i - 1] : v));
  const c = [d(pts.map(p => q(p.lat))), d(pts.map(p => q(p.lon)))];
  if (times) c.push(d(pts.map(p => Math.round(p.t / 1000))));
  return c;
};
const good5 = (o = {}) => ({ v: 2, k: 5, i: 'plan1', c: 'cid1', f: 'Sam', n: 'Sam', o: 'a', x: 1, a: 0, p: cols(across(trailEnd + 20 * MIN)), ...o });

/* ── The codec ────────────────────────────────────────────────────── */

await t('a guided route, a free walk and a walked line each survive the trip into a code and back', async () => {
  const route = across(trailEnd + 5 * MIN);
  const g = await decodeTrail(await encodeContam({ kind: 3, planId: 'plan1', cid: 'cid1', from: 'Rémi', who: 'Sam', order: 'after', ci: 2, points: route }));
  assert.equal(g.kind, 3);
  assert.deepEqual([g.planId, g.cid, g.from, g.who, g.order, g.ci], ['plan1', 'cid1', 'Rémi', 'Sam', 'after', 2]);
  assert.equal(g.points.length, route.length);
  assert.ok(g.points.every((p, i) => dist(p, route[i]) < 2 && p.t === undefined), 'a route is a line, with no clock of its own');
  assert.ok(isContamCard(g));

  const f = await decodeTrail(await encodeContam({ kind: 4, planId: 'plan1', cid: 'cid2', from: 'Rémi', who: 'Jo', order: 'before' }));
  assert.deepEqual([f.kind, f.cid, f.who, f.order, f.points.length, f.ci], [4, 'cid2', 'Jo', 'before', 0, null]);

  const walked = across(trailEnd + 25 * MIN);
  const w = await decodeTrail(await encodeContam({ kind: 5, planId: 'plan1', cid: 'cid1', from: 'Sam', who: 'Sam', order: 'after', ci: 2, points: walked }));
  assert.equal(w.kind, 5);
  assert.ok(w.points.every((p, i) => dist(p, walked[i]) < 2 && Math.abs(p.t - walked[i].t) <= 1000), 'within 2 m and 1 s');
  assert.equal(w.started, w.points[0].t);
});

await t('a long walk is thinned to fit one code, and the code still fits a scannable QR', async () => {
  const long = Array.from({ length: 900 }, (_, i) => ({ ...project(HOME, (i * 7) % 360, 20 + (i % 13)), t: T0 + i * 2000 }));
  const info = {};
  const str = await encodeContam({ kind: 5, planId: 'plan1', cid: 'cid1', who: 'Sam', points: long }, info);
  const back = await decodeTrail(str);
  assert.ok(back.points.length <= 120 && info.tol > 0);
  assert.ok(str.length < 2900, `card length ${str.length}`);
});

await t('a contamination code is made only with its ids, and a walk only with its clock', async () => {
  await assert.rejects(encodeContam({ kind: 3, planId: 'plan1', points: across(T0) }), /no id/);
  await assert.rejects(encodeContam({ kind: 3, planId: '../x', cid: 'c', points: across(T0) }), /no id/);
  await assert.rejects(encodeContam({ kind: 5, planId: 'p', cid: 'c', points: across(T0).map(({ lat, lon }) => ({ lat, lon })) }), /no clock/);
  await assert.rejects(encodeContam({ kind: 2, planId: 'p', cid: 'c', points: across(T0) }), /Not a contamination/);
});

await t('every bound a Trail Card has, a contamination code has too', async () => {
  const no = async (payload, why) => assert.rejects(decodeTrail(await craft(payload)), DAMAGED, why);
  await decodeTrail(await craft(good5()));                                   // the baseline is accepted
  await no(good5({ v: 1 }), 'version');
  await no(good5({ k: 6 }), 'unknown kind');
  await no(good5({ k: 2 }), 'an old kind under the new prefix');
  await no(good5({ i: undefined }), 'no trail id');
  await no(good5({ c: '' }), 'no person id');
  await no(good5({ c: 'a/b' }), 'a person id off the allow-list');
  await no(good5({ i: 'x'.repeat(33) }), 'a trail id too long');
  await no(good5({ o: 'during' }), 'an order off the allow-list');
  await no(good5({ p: cols(across(T0), false) }), 'a walk with no clock');
  await no({ ...good5(), k: 3 }, 'a route with a clock column is not a route');
  await no({ v: 2, k: 4, i: 'p', c: 'c', o: 'a', p: cols(across(T0)) }, 'a free walk carrying a line');
  await no(good5({ p: [[1], [1], [1]] }), 'a single point');
  await no(good5({ p: [new Array(241).fill(0), new Array(241).fill(0), new Array(241).fill(0)] }), 'too many points');
  await no(good5({ p: [[q(51.2), 0.5], [q(-2.6), 0], [T0 / 1000, 1]] }), 'a delta that is not a whole number');
  await no(good5({ p: [[q(95), 0], [q(-2.6), 1], [T0 / 1000, 1]] }), 'latitude out of range');
  await no(good5({ p: [[q(51.2), 1], [q(-2.6), 1], [Date.UTC(1990, 0, 1) / 1000, 1]] }), 'a clock before the era');
  await no(good5({ p: [[q(51.2), 1], [q(-2.6), 1], [T0 / 1000, -5]] }), 'times out of order');
  await no(good5({ p: [[q(51.2), q(3)], [q(-2.6), 0], [T0 / 1000, 600]] }), 'a path longer than 200 km');
  await no(good5({ p: [[q(51.2), 1], [q(-2.6), 1], [T0 / 1000, 13 * 3600]] }), 'a walk longer than half a day');
  await assert.rejects(decodeTrail('TC2.' + 'A'.repeat(8100)), DAMAGED, 'longer than any code this app makes');
  /* Inflated past a quarter of a megabyte: a zip bomb is refused unread. */
  const bomb = 'TC2.' + b64url(await through(new TextEncoder().encode(`{"v":2,"pad":"${'0'.repeat(300000)}"}`), new CompressionStream('deflate-raw')));
  assert.ok(bomb.length < 8000);
  await assert.rejects(decodeTrail(bomb), DAMAGED);
  await assert.rejects(decodeTrail('TC2.!!!'), DAMAGED);
  await assert.rejects(decodeTrail(await craft([1, 2])), DAMAGED, 'not an object');
  /* Names are cut to length and a crafted colour is no colour. */
  const odd = await decodeTrail(await craft(good5({ n: 'x'.repeat(90), x: 99 })));
  assert.equal(odd.who.length, 40);
  assert.equal(odd.ci, null);
});

await t('old Trail Cards decode exactly as before, and a newer prefix is still named as newer', async () => {
  const pts = trail.slice(0, 20);
  const card = await decodeTrail(await encodeTrail({ points: pts, waypoints: [], from: 'Rémi', kind: 2, planId: 'plan1' }));
  assert.deepEqual([card.kind, card.planId, card.points.length, isContamCard(card)], [2, 'plan1', 20, false]);
  const plain = await decodeTrail(await encodeTrail({ points: pts, waypoints: [], from: 'Rémi' }));
  assert.equal(plain.kind, 0);
  await assert.rejects(decodeTrail('TC3.abc'), /newer Trailcraft/);
});

/* ── Colours ──────────────────────────────────────────────────────── */

await t('every person has a colour of their own, apart from the defaults and from each other with red-green colour blindness', () => {
  /* Machado, Oliveira & Fernandes (2009), severity 1, on linear RGB, then
     CIELAB: how the colours look to someone with deuteranopia or protanopia. */
  const M = {
    none: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    deu: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
    pro: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  };
  const lin = (v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const lab = (hex, k) => {
    const c = hexToRgb(hex).map(lin);
    const [r, g, b] = M[k].map(row => Math.min(1, Math.max(0, row[0] * c[0] + row[1] * c[1] + row[2] * c[2])));
    const f = (x) => (x > 0.008856 ? Math.cbrt(x) : 7.787 * x + 16 / 116);
    const X = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047), Y = f(0.2126 * r + 0.7152 * g + 0.0722 * b),
      Z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
    return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
  };
  const dE = (a, b, k = 'none') => { const x = lab(a, k), y = lab(b, k); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]); };
  const hexes = CONTAM_COLOURS.map(c => c.hex);
  assert.equal(new Set(hexes).size, 4);
  assert.equal(CONTAM_COLOURS[0].name, 'Violet', 'violet first, as every contamination line used to be');
  for (let i = 0; i < hexes.length; i++) for (let j = i + 1; j < hexes.length; j++) {
    for (const k of ['none', 'deu', 'pro']) assert.ok(dE(hexes[i], hexes[j], k) >= 30, `${hexes[i]} vs ${hexes[j]} (${k}): ${dE(hexes[i], hexes[j], k).toFixed(1)}`);
  }
  /* Lightness steps, the first two (the first two people) furthest apart. */
  const L = hexes.map(h => lab(h, 'none')[0]);
  const gaps = [];
  for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) gaps.push(Math.abs(L[i] - L[j]));
  assert.equal(Math.abs(L[0] - L[1]), Math.max(...gaps), `lightness ${L.map(Math.round)}`);
  assert.ok(Math.abs(L[0] - L[1]) >= 30);
  /* Apart from the trail's gold, the footprints' navy, the dog's white and
     the wind, the defaults in Settings. */
  for (const h of hexes) for (const other of ['#F5D14A', '#0B1630', '#FFFFFF']) assert.ok(dE(h, other) >= 30, `${h} vs ${other}`);
  /* The wind's drifting dots are not lines, and only need to be told apart. */
  for (const h of hexes) assert.ok(dE(h, '#DCE9FF') >= 20, `${h} vs the wind`);
  /* The pale end of each cloud is not the wind's colour or white either. */
  for (const c of CONTAM_COLOURS) for (const other of ['#FFFFFF', '#DCE9FF']) assert.ok(dE(c.light, other) >= 20, `${c.light} vs ${other}`);
  assert.ok(CONTAM_COLOURS.every(c => c.name && c.dark && c.light));
  assert.ok(Math.abs(deltaE('#4FD1FF', '#4FD1FF')) < 1e-9);
});

await t('a person’s colour is never one the handler chose for the dog, the scent or the footprints', () => {
  /* Settings' Cyan for the dog is too like Sky blue: the second person skips it. */
  assert.ok(deltaE('#4FD1FF', CONTAM_COLOURS[1].hex) < 20);
  assert.equal(nextColour([{ ci: 0 }], ['#4FD1FF', '#F5D14A', '#0B1630']), 2);
  /* Coral for the scent is too like Salmon. */
  assert.ok(deltaE('#FF6B57', CONTAM_COLOURS[2].hex) < 20);
  assert.equal(nextColour([{ ci: 0 }, { ci: 1 }], ['#FFFFFF', '#FF6B57', '#0B1630']), 3);
  assert.equal(nextColour([], ['not a colour', null]), 0, 'anything not a colour is ignored');
  /* Every colour like one of theirs: the palette as it is, rather than none. */
  assert.equal(nextColour([{ ci: 0 }], CONTAM_COLOURS.map(c => c.hex)), 1);
});

await t('a new person takes the first free colour; an old entry is coloured by its place', () => {
  assert.equal(nextColour([]), 0);
  assert.equal(nextColour([{ ci: 0 }, { ci: 2 }]), 1);
  assert.equal(nextColour([{ ci: 0 }, { ci: 1 }, { ci: 2 }, { ci: 3 }]), 0, 'round again once all are used');
  assert.equal(nextColour([{}, {}]), 2, 'old entries hold their place colours');
  assert.equal(colourIndex({}, 1), 1);
  assert.equal(colourIndex({ ci: 3 }, 0), 3);
  assert.equal(colourIndex({ ci: 9 }, 0), 1, 'any index wraps to the palette');
  assert.equal(contamColour({ ci: 'x' }, 6).name, CONTAM_COLOURS[2].name);
});

/* ── Entries and their walks ──────────────────────────────────────── */

const entry = (o = {}) => newContam({ id: 'cid1', of: 'plan1', who: 'Sam', order: 'after', points: across(trailEnd + 60e3), ci: 1, now: T0, ...o });

await t('a guided entry is drawn, a free one waits, and a walked one is walked', () => {
  const g = entry();
  assert.deepEqual([contamWay(g), contamStatus(g), g.ci, g.of], ['guided', 'drawn', 1, 'plan1']);
  const f = entry({ way: 'free', points: across(T0) });
  assert.deepEqual([contamWay(f), contamStatus(f), f.points.length], ['free', 'waiting', 0], 'a free walk has no line until it is walked');
  assert.equal(contamStatus({ ...g, status: 'waiting' }), 'waiting');
  assert.equal(contamStatus({ who: 'Old', order: 'before', points: across(T0) }), 'drawn', 'an old entry is a drawn line');
  assert.equal(contamStatus({ ...g, walked: true, points: [] }), 'drawn', 'a walk with no line is not a walk');
});

await t('before or after comes from the two clocks', () => {
  assert.equal(orderFromTimes(trail, across(trailEnd + 5 * MIN)).order, 'after');
  assert.equal(orderFromTimes(trail, across(T0 - 30 * MIN)).order, 'before');
  const o = orderFromTimes(trail, across(T0 + 60e3));
  assert.deepEqual([o.order, o.overlap], ['after', true], 'walked while it was being laid: whichever started first');
  assert.equal(orderFromTimes(trail, across(T0).map(({ lat, lon }) => ({ lat, lon }))), null, 'no clock, no answer');
  assert.equal(Math.round(orderFromTimes(trail, across(trailEnd + 25 * MIN)).gapMs / MIN), 25);
});

await t('a real crossing is where the walk came within reach of the trail, and when', () => {
  const x = crossings(trail, across(trailEnd + 25 * MIN));
  assert.equal(x.length, 1);
  assert.ok(x[0].dtMs > 25 * MIN, 'well after the trail went by there');
  assert.equal(crossings(trail, across(trailEnd, { off: 200 })).length, 0, 'a walk 200 m away crosses nothing');
  assert.ok(crossings(trail, across(T0 - 60 * MIN))[0].dtMs < 0, 'before the trail was there');
  assert.equal(crossings(trail, across(T0).map(({ lat, lon }) => ({ lat, lon }))).length, 0, 'a line with no clock says nothing');
});

const sess = (id, list, o = {}) => ({ id, planOf: null, deleted: false, contamination: list, ...o });
const card5 = (o = {}) => ({ kind: 5, planId: 'plan1', cid: 'cid1', from: 'Sam', who: 'Sam', points: across(trailEnd + 25 * MIN), started: trailEnd + 25 * MIN, ...o });

await t('a walk comes back to its person on its trail, among several', () => {
  const list = [entry(), entry({ id: 'cid2', who: 'Jo', ci: 2 }), entry({ id: 'cid3', who: 'Al', way: 'free' })];
  const pick = contamWalkFor(card5({ cid: 'cid2' }), [sess('other', []), sess('plan1', list)]);
  assert.deepEqual(pick.ids, ['plan1']);
  assert.equal(pick.entry.who, 'Jo');
  assert.equal(contamWalkFor(card5({ cid: 'cid3' }), [sess('plan1', list)]).entry.who, 'Al', 'a free walk too');
});

await t('a second run of the trail is the same trail: the walk goes on both', () => {
  const list = [entry()];
  const pick = contamWalkFor(card5(), [sess('plan1', list), sess('copy', list, { planOf: 'plan1' }), sess('gone', list, { deleted: true })]);
  assert.deepEqual(pick.ids, ['plan1', 'copy'], 'never a deleted one');
  /* A copy of a laid trail (no plan id behind it) still names its trail in its entries. */
  assert.deepEqual(contamWalkFor(card5(), [sess('copy2', list)]).ids, ['copy2']);
});

await t('a walk for no trail here, a person no longer on it, or the same walk again is refused by name', () => {
  assert.equal(contamWalkFor(card5({ planId: 'elsewhere' }), [sess('plan1', [entry()])]).why, 'other');
  assert.equal(contamWalkFor(card5({ cid: 'nobody' }), [sess('plan1', [entry()])]).why, 'gone');
  assert.equal(contamWalkFor(card5(), [sess('plan1', [entry({ of: 'another' })])]).why, 'gone', 'an id on another trail is not this one');
  const walked = attachWalk([entry()], 'cid1', card5(), trail).list;
  assert.equal(contamWalkFor(card5(), [sess('plan1', walked)]).why, 'dup');
  assert.ok(sameWalk(walked[0], card5()));
  assert.equal(contamWalkFor({ ...card5(), kind: 3 }, [sess('plan1', [entry()])]).why, 'bad');
  assert.equal(contamWalkFor(card5({ points: [] }), [sess('plan1', [entry()])]).why, 'bad');
  assert.equal(contamWalkFor(card5({ cid: '<b>' }), [sess('plan1', [entry()])]).why, 'bad');
});

await t('a different walk for someone already walked is asked about, never assumed', () => {
  const walked = attachWalk([entry()], 'cid1', card5(), trail).list;
  const again = contamWalkFor(card5({ points: across(trailEnd + 40 * MIN) }), [sess('plan1', walked)]);
  assert.equal(again.ask, 'replace');
  assert.deepEqual(again.ids, ['plan1']);
});

await t('the walk replaces a drawn line, fills a free one, and keeps who, id and colour', () => {
  const list = [entry({ order: 'before' }), entry({ id: 'cid2', way: 'free', who: 'Jo', ci: 3, order: 'after' })];
  const a = attachWalk(list, 'cid1', card5(), trail, T0 + 99);
  const e = a.list[0];
  assert.deepEqual([e.id, e.who, e.ci, e.of, e.walked, e.status, contamStatus(e)], ['cid1', 'Sam', 1, 'plan1', true, 'walked', 'walked']);
  assert.equal(e.points[0].t, card5().points[0].t, 'its real clock');
  assert.equal(e.laidAt, card5().points[0].t);
  assert.equal(e.order, 'after', 'from the clocks');
  assert.deepEqual([a.contradicts, a.chosen, e.orderChosen], [true, 'before', 'before'], 'and the handler is told it was not what was chosen');
  assert.equal(a.list[1], list[1], 'nobody else is touched');
  const b = attachWalk(list, 'cid2', card5({ cid: 'cid2', points: across(trailEnd + 3 * MIN) }), trail);
  assert.deepEqual([b.list[1].way, b.list[1].points.length > 1, b.contradicts], ['free', true, false]);
  assert.equal(attachWalk(list, 'nobody', card5(), trail), null);
});

await t('an old entry gets its id and trail the first time its code is asked for', () => {
  let n = 0;
  const old = [{ who: 'Old', order: 'after', laidAt: 0, points: across(T0) }, entry()];
  const { list, changed } = withIds(old, 'plan1', () => `new${++n}`);
  assert.ok(changed);
  assert.deepEqual([list[0].id, list[0].of, list[0].who], ['new1', 'plan1', 'Old']);
  assert.equal(list[1], old[1]);
  assert.equal(withIds(list, 'plan1', () => 'x').changed, false);
});

await t('the legend says when they really crossed, and gives a drawn line no age', () => {
  /* Set off 25 min after the trail was finished, and crossed its middle,
     laid two minutes before the end, 40 s into the walk: 28 min, at that spot. */
  assert.equal(contamWords(attachWalk([entry()], 'cid1', card5(), trail).entry, trail), 'crossed 28 min after the trail');
  assert.match(contamWords(entry(), trail), /^drawn, not walked, after the trail$/);
  assert.equal(contamWords(entry({ way: 'free' }), trail), 'waiting for their walk');
  const far = attachWalk([entry()], 'cid1', card5({ points: across(trailEnd + 10 * MIN, { off: 300 }) }), trail).entry;
  assert.match(contamWords(far, trail), /walked \d+ min after the trail, never within 15 m of it/);
});

/* ── Levels ───────────────────────────────────────────────────────── */

function runOn(contamination) {
  const track = trail.map((p, i) => ({ lat: p.lat, lon: p.lon + 0.00003, t: trailEnd + 60 * MIN + i * 6000 }));
  return { id: `r${Math.random()}`, handlerId: 'h1', dogId: 'd1', layerId: null, targetId: 'person', startedAt: T0, summary: '',
    data: { trail, track, trackStarted: track[0].t, trackWaypoints: [], result: { ageMin: 60 }, found: true, contamination,
      debrief: { v: 1, outcome: 'found', target: 'real', blind: 'open', help: 'none', start: 'article', setting: 'rural' } } };
}
const cross = (t0, o) => entry({ id: `c${t0}`, points: across(t0, o) });

await t('levels: drawn lines count as they always have until a real walk comes back', () => {
  const two = [cross(trailEnd + MIN), cross(trailEnd + 2 * MIN)];
  assert.equal(runFacts(runOn(two), { sessions: [] }).crossTracks, 2, 'two drawn cross-tracks laid after');
  /* One real walk that crossed after the trail: from then on only real walks count. */
  const real = attachWalk(two, two[0].id, card5({ cid: two[0].id }), trail).list;
  assert.equal(runFacts(runOn(real), { sessions: [] }).crossTracks, 1, 'only the real walk counts once there is one');
  /* Both walked, one of them really before the trail though planned after:
     it crossed nothing laid yet, and the game does not get easier. */
  const both = attachWalk(real, two[1].id, card5({ cid: two[1].id, points: across(T0 - 40 * MIN) }), trail).list;
  assert.equal(both[1].order, 'before');
  assert.equal(runFacts(runOn(both), { sessions: [] }).crossTracks, 1);
  /* A walk after the trail that never came near it crossed nothing either. */
  const wide = attachWalk(two, two[0].id, card5({ cid: two[0].id, points: across(trailEnd + 5 * MIN, { off: 200 }) }), trail).list;
  assert.equal(runFacts(runOn(wide), { sessions: [] }).crossTracks, 0, 'never within reach: no cross-track, and the drawn line no longer stands in');
  /* Never more than the drawn lines counted, whatever comes back. */
  for (const list of [real, both, wide]) {
    assert.ok(runFacts(runOn(list), { sessions: [] }).crossTracks <= runFacts(runOn(two), { sessions: [] }).crossTracks);
  }
});

await t('levels: a free walk with no line yet counts for nothing, and its walk counts when it crosses', () => {
  const free = [entry({ way: 'free' })];
  assert.equal(runFacts(runOn(free), { sessions: [] }).crossTracks, 0);
  const walked = attachWalk(free, 'cid1', card5(), trail).list;
  assert.equal(runFacts(runOn(walked), { sessions: [] }).crossTracks, 1);
});

/* ── Backup, drafts, share links ──────────────────────────────────── */

const NOW = T0 + 86400000;
const wrap = (sessions) => JSON.stringify({ app: 'trailcraft', version: 3, exportedAt: new Date(NOW).toISOString(),
  handlers: [], dogs: [], layers: [], sessions, calibration: [] });
const backupSess = (contamination) => ({ id: 's1', startedAt: T0, updatedAt: T0, data: { trail, contamination } });

await t('a backup keeps good entries and refuses crafted ones', () => {
  const walked = attachWalk([entry()], 'cid1', card5(), trail).list;
  const ok = readBackup(wrap([backupSess([...walked, entry({ id: 'cid2', way: 'free' }), { who: 'Old', order: 'before', laidAt: 0, points: across(T0) }])]), { now: NOW });
  assert.equal(ok.sessions.length, 1);
  assert.equal(ok.sessions[0].data.contamination.length, 3);
  assert.equal(ok.sessions[0].data.contamination[0].walked, true);
  for (const bad of [{ id: 'a b' }, { of: '<x>' }, { order: 'during' }, { way: 'flying' }, { status: 'done' }, { ci: 9 }, { ci: 1.5 }, { walked: 'yes' }, { who: 'x'.repeat(500) }]) {
    const f = readBackup(wrap([backupSess([{ ...entry(), ...bad }])]), { now: NOW });
    assert.equal(f.sessions.length, 0, JSON.stringify(bad));
  }
  /* A walk whose clock is out of its era loses the clock, and with it the claim to be a walk. */
  const odd = attachWalk([entry()], 'cid1', card5(), trail).list;
  odd[0].points[3] = { ...odd[0].points[3], t: Date.UTC(1980, 0, 1) };
  const f = readBackup(wrap([backupSess(odd)]), { now: NOW });
  assert.deepEqual([f.sessions[0].data.contamination[0].walked, f.sessions[0].data.contamination[0].status], [false, 'drawn']);
});

await t('a contamination walk cut short comes back after a crash, free or guided', () => {
  const free = { kind: 4, planId: 'plan1', cid: 'cid3', who: 'Al', order: 'after', from: 'Rémi', points: [] };
  const d = unpackDraft(JSON.parse(JSON.stringify(packDraft({ kind: 'walk', startedAt: T0, pts: across(T0), plan: free }, T0))));
  assert.deepEqual([d.plan.kind, d.plan.cid, d.plan.who, d.plan.order, d.plan.points.length, d.pts.length], [4, 'cid3', 'Al', 'after', 0, 21]);
  const guided = { kind: 3, planId: 'plan1', cid: 'cid1', who: 'Sam', order: 'before', from: 'Rémi', points: across(T0) };
  const g = unpackDraft(JSON.parse(JSON.stringify(packDraft({ kind: 'walk', startedAt: T0, pts: across(T0), plan: guided }, T0))));
  assert.deepEqual([g.plan.kind, g.plan.points.length], [3, 21]);
  assert.equal(packDraft({ kind: 'walk', startedAt: T0, pts: [], plan: { kind: 4, points: [] } }, T0), null, 'a free walk with no ids is nothing to keep');
  /* A trail's walk is as it was. */
  const plain = unpackDraft(JSON.parse(JSON.stringify(packDraft({ kind: 'walk', startedAt: T0, pts: across(T0), plan: { points: trail, planId: 'p', ageMin: 10 } }, T0))));
  assert.equal(plain.plan.kind, undefined);
});

await t('a share link and a live document carry lines only; the report names each person', async () => {
  const walked = attachWalk([entry(), entry({ id: 'cid2', who: 'Jo', ci: 2 })], 'cid1', card5(), trail).list;
  const s = { ...runOn(walked), startedAt: T0 };
  const m = trailModel(s);
  assert.deepEqual(m.contamination.map(c => [c.who, c.ci, !!c.walked]), [['Sam', 1, true], ['Jo', 2, false]]);
  const live = liveMeta(m, T0);
  assert.ok(live.contamination.every(c => Object.keys(c).join() === 'points'), 'the cloud gets the lines and nothing else');
  const back = await decodeShared(await encodeShared(m));
  assert.equal(back.contamination.length, 2);
  assert.ok(back.contamination.every(c => Object.keys(c).join() === 'points'), 'a link carries lines as it always did');
  const rows = detailSections(m).flatMap(x => x.rows);
  assert.ok(rows.some(([k, v]) => k === 'Sky blue line' && v === 'Sam, crossed 28 min after the trail'), JSON.stringify(rows));
  assert.ok(rows.some(([k, v]) => k === 'Salmon line' && /^Jo, drawn, not walked/.test(v)));
  assert.ok(detailSections(back).flatMap(x => x.rows).some(([k, v]) => k === 'Contamination' && /2 crossing trails/.test(v)), 'a link’s lines are counted as before');
});

/* ── A plan's made-up clock ───────────────────────────────────────── */

/* A plan drawn at 10:00 is timed as if walked and finished at 10:00
   (planSession). Sam, planned before, walks 10:05–10:10; the layer walks the
   plan 10:15–10:20. Sam's walk comes back first, as a "before" walk does. */
await t('a walk measured against a plan not walked yet keeps the order chosen, and is put right by the real walk', () => {
  const at = T0 + 3 * 3600e3;
  const corners = [trail[0], trail[trail.length - 1]].map(({ lat, lon }) => ({ lat, lon }));
  const plan = planSession({ id: 'plan1', handlerId: 'h1', corners, ageMin: 10, now: at, summary: '' });
  plan.data.contamination = [entry({ order: 'before', points: across(at - 20 * MIN) })];
  assert.equal(trailClock(plan.data), null, 'a plan’s drawn line has no real clock');
  const sam = card5({ points: across(at + 5 * MIN) });
  const a = attachWalk(plan.data.contamination, 'cid1', sam, trailClock(plan.data));
  assert.deepEqual([a.entry.order, a.contradicts, a.entry.orderChosen], ['before', false, undefined], 'the order chosen stands');
  assert.equal(contamWords(a.entry, trailClock(plan.data)), 'walked, waiting for the main trail', 'and no minutes are made up');
  assert.equal(detailWords({ ...plan.data, contamination: a.list }), 'Sam, walked, waiting for the main trail');

  /* The layer's walked card: the trail now has a real clock. */
  const walkedTrail = trail.map((p, i) => ({ lat: p.lat, lon: p.lon, t: at + 15 * MIN + i * 4000 }));
  const walked = { ...plan.data, trail: walkedTrail, walked: true, contamination: a.list };
  assert.equal(trailClock(walked), walkedTrail);
  const re = reorderContam(a.list, trailClock(walked));
  assert.deepEqual([re.list[0].order, re.list[0].orderChosen, re.turned.length], ['before', undefined, 0], 'before, as it really was');
  assert.match(contamWords(re.list[0], trailClock(walked)), /before the trail/);

  /* Planned after, but really walked before: put right, and said. */
  const late = attachWalk([entry({ order: 'after' })], 'cid1', sam, trailClock(plan.data)).list;
  assert.equal(late[0].order, 'after', 'still as chosen while the clock is made up');
  const fixed = reorderContam(late, walkedTrail);
  assert.deepEqual([fixed.list[0].order, fixed.list[0].orderChosen, fixed.turned.length], ['before', 'after', 1]);
  /* Measured again with a clock that agrees with the plan, "planned" goes. */
  const back = reorderContam(fixed.list, trail.map(p => ({ ...p, t: p.t + 3 * 3600e3 - 60 * MIN })));
  assert.deepEqual([back.list[0].order, back.list[0].orderChosen], ['after', undefined]);
  assert.equal(reorderContam(back.list, trail.map(p => ({ ...p, t: p.t + 3 * 3600e3 - 60 * MIN }))).changed, false);
  /* A blind trail with no line, or one added with no times, has no clock either. */
  assert.equal(trailClock({ lineLater: true, trail: [] }), null);
  assert.equal(trailClock({ lineLater: true, drawn: true, trail: walkedTrail }), null);
});

/** The report's row for the first person, as the PDF and the share say it. */
function detailWords(data) {
  const m = trailModel({ id: 's1', handlerId: 'h1', targetId: 'person', startedAt: data.trail[0].t, data });
  const row = detailSections(m).flatMap(x => x.rows).find(([k]) => / line$/.test(k));
  return row ? row[1] : null;
}

await t('levels: on a plan not walked yet, a real walk counts where it met the line, by the order chosen', () => {
  const at = T0 + 3 * 3600e3;
  const plan = planSession({ id: 'plan1', handlerId: 'h1', corners: [trail[0], trail[trail.length - 1]].map(({ lat, lon }) => ({ lat, lon })),
    ageMin: 10, now: at, summary: '' });
  /* Planned after, and walked before the plan's made-up clock says it ended. */
  const list = attachWalk([entry({ order: 'after' })], 'cid1', card5({ points: across(at - 30 * MIN) }), trailClock(plan.data)).list;
  const run = { ...runOn(list), data: { ...runOn(list).data, ...plan.data, contamination: list, track: runOn(list).data.track } };
  assert.equal(runFacts(run, { sessions: [] }).crossTracks, 1, 'the made-up clock does not decide it');
  /* Never more than the drawn line counted. */
  const drawnRun = { ...run, data: { ...run.data, contamination: [entry({ order: 'after' })] } };
  assert.ok(runFacts(run, { sessions: [] }).crossTracks <= runFacts(drawnRun, { sessions: [] }).crossTracks);
});

/* ── What the encoder makes, the decoder takes ────────────────────── */

await t('anything encodeContam makes, decodeTrail takes', async () => {
  const shapes = [
    across(trailEnd),
    Array.from({ length: 400 }, (_, i) => ({ ...project(HOME, (i * 37) % 360, 10 + (i % 17) * 3), t: T0 + i * 3000 })),
    Array.from({ length: 2000 }, (_, i) => ({ ...project(HOME, 0, i * 4), t: T0 + i * 2000 })),
  ];
  for (const pts of shapes) for (const kind of [3, 5]) for (const forLink of [false, true]) {
    let str;
    const info = {};
    try { str = await encodeContam({ kind, planId: 'plan1', cid: 'cid1', who: 'Sam', points: pts }, info, { forLink }); }
    catch (e) { assert.equal(e.message, TOO_TWISTY); continue; }
    const back = await decodeTrail(str);
    assert.equal(back.kind, kind);
    assert.ok(str.length <= 8000);
    if (kind === 5 && !forLink) assert.ok(info.tol <= 16, 'a QR code’s walk is thinned by no more than 16 m');
  }
});

await t('a phone left recording overnight still makes a code the handler can read, of the walk itself', async () => {
  /* Walked for 20 minutes, then left on a table until morning. */
  const walkPart = across(trailEnd + 20 * MIN);
  const table = walkPart[walkPart.length - 1];
  const night = Array.from({ length: 90 }, (_, i) => ({ lat: table.lat, lon: table.lon, t: table.t + (i + 1) * 10 * MIN }));
  const str = await encodeContam({ kind: 5, planId: 'plan1', cid: 'cid1', who: 'Sam', points: [...walkPart, ...night] });
  const back = await decodeTrail(str);
  assert.equal(back.points[0].t, Math.round(walkPart[0].t / 1000) * 1000, 'the walk is kept, from its start');
  assert.ok(back.ended - back.started <= 12 * 3600e3);
  await assert.rejects(encodeContam({ kind: 5, planId: 'p', cid: 'c', points: [...walkPart].reverse() }), /out of order/);
  const far = [{ ...HOME, t: T0 }, { ...project(HOME, 90, 250000), t: T0 + 3600e3 }];
  await assert.rejects(encodeContam({ kind: 5, planId: 'p', cid: 'c', points: far }), /too long to send back/);
  await assert.rejects(encodeContam({ kind: 3, planId: 'p', cid: 'c', points: far }), /too long to send back/);
  await assert.rejects(encodeContam({ kind: 5, planId: 'p', cid: 'c', points: across(Date.UTC(1990, 0, 1)) }), /clock is wrong/);
});

await t('a walk too winding for one QR code goes as a link, not as nothing', async () => {
  /* Zigzags of 60 m every 30 m along, for 4.5 km: a corner every 10 fixes. */
  const zig = (i) => (i % 20 < 10 ? i % 10 : 10 - (i % 10)) * 6;
  const twisty = Array.from({ length: 1500 }, (_, i) => ({ ...project(project(HOME, 0, i * 3), 90, zig(i)), t: T0 + i * 2000 }));
  await assert.rejects(encodeContam({ kind: 5, planId: 'p', cid: 'c', points: twisty }), (e) => e.message === TOO_TWISTY);
  const info = {};
  const str = await encodeContam({ kind: 5, planId: 'p', cid: 'c', points: twisty }, info, { forLink: true });
  const back = await decodeTrail(str);
  assert.ok(back.points.length > 120 && back.points.length <= 240, `${back.points.length} points`);
  assert.equal(back.tol, info.tol, 'how far it was thinned travels with it, for the handler to be told');
});

/* ── Sync, the key, drafts ──────────────────────────────────────────── */

await t('two copies of the list are merged person by person, a walk never lost', () => {
  const sam = entry({ id: 'cSam', who: 'Sam', status: 'drawn' });
  const jo = entry({ id: 'cJo', who: 'Jo', way: 'free' });
  const joWalked = attachWalk([jo], 'cJo', card5({ cid: 'cJo' }), trail, T0 + 5 * MIN).list[0];
  const out = mergeContam([{ ...sam, status: 'waiting' }, jo], [sam, joWalked]);
  assert.deepEqual(out.map(c => [c.id, contamStatus(c)]), [['cSam', 'waiting'], ['cJo', 'walked']]);
  assert.equal(mergeContam([sam, joWalked], [sam, jo]), null, 'the newer copy already has it all');
  const al = entry({ id: 'cAl', who: 'Al' });
  assert.deepEqual(mergeContam([sam], [sam, al]).map(c => c.id), ['cSam', 'cAl'], 'a person added on the other phone is kept');
  const later = attachWalk([jo], 'cJo', card5({ cid: 'cJo', points: across(trailEnd + 40 * MIN) }), trail, T0 + 9 * MIN).list[0];
  assert.equal(mergeContam([joWalked], [later])[0], later, 'the later walk of two');
  const old = [{ who: 'Old', order: 'after', points: across(T0) }];
  assert.equal(mergeContam(old, [{ who: 'Other', order: 'after', points: across(T0) }]), null, 'entries with no id stay as the newer copy has them');
});

await t('the map’s key names each person, in their colour, and gives a link’s unnamed lines none', () => {
  const list = [attachWalk([entry()], 'cid1', card5(), trail).list[0], entry({ id: 'cid2', who: 'Jo', ci: 2, way: 'free' })];
  const key = contamKey(list, trail);
  assert.deepEqual(key.map(r => [r.who, r.colour, r.hex, r.words]), [
    ['Sam', 'Sky blue', CONTAM_COLOURS[1].hex, 'crossed 28 min after the trail'],
    ['Jo', 'Salmon', CONTAM_COLOURS[2].hex, 'waiting for their walk'],
  ]);
  assert.deepEqual(contamKey([{ points: across(T0) }], trail), [], 'lines from a link carry no names');
  assert.deepEqual(contamKey([], trail), []);
});

await t('a walk on the handler’s own phone keeps its colour and where it goes through a crash', () => {
  const here = { kind: 3, planId: 'plan1', cid: 'cid1', who: 'Rémi', order: 'after', from: 'Rémi', ci: 3, local: true, points: across(T0) };
  const d = unpackDraft(JSON.parse(JSON.stringify(packDraft({ kind: 'walk', startedAt: T0, pts: across(T0), plan: here }, T0))));
  assert.deepEqual([d.plan.ci, d.plan.local], [3, true]);
  const theirs = unpackDraft(JSON.parse(JSON.stringify(packDraft({ kind: 'walk', startedAt: T0, pts: across(T0), plan: { ...here, local: 'yes', ci: 99 } }, T0))));
  assert.deepEqual([theirs.plan.ci, theirs.plan.local], [null, undefined], 'only a real flag and colour');
});

console.log(`\n${pass} passed total`);
