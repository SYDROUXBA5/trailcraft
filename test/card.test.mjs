/* Trail Cards, checked headlessly: a trail survives the trip into a QR-sized
   string and back within the error the card promises, damage is rejected in
   plain language, and the result actually fits a scannable code. */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { encodeTrail, decodeTrail, maxDeviation , cardUrl, cardFromText, walkedPlanFor, inflate } from '../public/card.js';
import { simplify, dist, pathLen } from '../public/geo.js';

let pass = 0;
const t = (name, fn) => Promise.resolve().then(fn).then(() => { pass++; console.log(`  ok  ${name}`); });

/* Deterministic jitter — Math.random would make failures unreproducible. */
const jitter = (i) => ((i * 2654435761 % 977) / 977 - 0.5) * 2;

/** A drawn trail: clean corners, paced clock. */
const drawn = (n = 40) => Array.from({ length: n }, (_, i) => ({
  lat: 51.2 + 0.0004 * i + (i % 7 === 0 ? 0.0006 : 0),
  lon: -2.6 + 0.0003 * Math.sin(i / 5),
  t: 1756200000000 + i * 9000,
}));

/** A recorded trail: 600 GPS fixes over ~900 m with ±4 m of noise. */
const recorded = () => Array.from({ length: 600 }, (_, i) => ({
  lat: 51.2 + (0.9 / 111.32) * (i / 600) / 1000 * 1000 * 0.001 * 8.1 + jitter(i) * 4 / 111320,
  lon: -2.6 + jitter(i + 300) * 4 / 70000,
  t: 1756200000000 + i * 2000,
}));

await t('round-trip: a drawn trail survives within 2 m and 1 s', async () => {
  const wps = [
    { kind: 'article', lat: 51.204, lon: -2.599, t: 1756200200000 },
    { kind: 'note', lat: 51.206, lon: -2.598, t: 1756200300000 },
  ];
  const card = await encodeTrail({ points: drawn(), waypoints: wps, drawn: true, from: 'Rémi' });
  assert.ok(card.startsWith('TC1.'), 'carries the version prefix');
  const back = await decodeTrail(card);
  assert.equal(back.points.length, 40, 'nothing dropped under the cap');
  assert.equal(back.drawn, true);
  assert.equal(back.approx, false, 'no thinning, no approx flag');
  assert.equal(back.from, 'Rémi');
  drawn().forEach((p, i) => {
    assert.ok(dist(p, back.points[i]) < 2, `point ${i} moved ${dist(p, back.points[i]).toFixed(2)} m`);
    assert.ok(Math.abs(p.t - back.points[i].t) <= 1000, 'timestamps hold to the second');
  });
  assert.equal(back.waypoints.length, 2);
  assert.equal(back.waypoints[0].kind, 'article');
  assert.ok(dist(wps[0], back.waypoints[0]) < 2);
});

await t('a 600-fix recorded trail fits one QR and stays true to the line', async () => {
  const pts = recorded();
  const info = {};
  const card = await encodeTrail({ points: pts, waypoints: [], from: '' }, info);
  assert.ok(card.length < 1800, `encoded length ${card.length} must fit a scannable QR`);
  const back = await decodeTrail(card);
  assert.ok(back.approx, 'the card admits it thinned the line');
  assert.ok(back.points.length <= 120);
  assert.ok(info.tol >= 2, 'encoder reports the tolerance it used');
  assert.equal(back.tol, info.tol, 'the receiving phone learns the REAL bound, not a guess');
  const dev = maxDeviation(pts, back.points);
  assert.ok(dev <= back.tol + 2, `deviation ${dev.toFixed(1)} within the bound the card itself states (${back.tol}+quantize)`);
  assert.equal(back.started, pts[0].t, 'first fix time survives exactly (whole seconds)');
});

await t('overflowing marks keep the LAST twelve — the indication is at the end', async () => {
  const wps = Array.from({ length: 15 }, (_, i) => ({
    kind: i === 14 ? 'indication' : `mark${i}`, lat: 51.2 + i * 1e-4, lon: -2.6, t: 1756200000000 + i * 60000,
  }));
  const info = {};
  const card = await encodeTrail({ points: drawn(10), waypoints: wps, from: '' }, info);
  const back = await decodeTrail(card);
  assert.equal(info.wpsKept, 12);
  assert.equal(info.wpsTotal, 15);
  assert.equal(back.waypoints.length, 12);
  assert.equal(back.waypoints[11].kind, 'indication', 'the final mark survives');
  assert.equal(back.waypoints[0].kind, 'mark3', 'the EARLIEST marks are what gets dropped');
});

await t('a trail too twisty for the tolerance ceiling is refused, never truncated', async () => {
  // 300 corners each deviating ~100 m — survives simplify at 64 m in full.
  const zigzag = Array.from({ length: 300 }, (_, i) => ({
    lat: 51.2 + i * 0.0013, lon: -2.6 + (i % 2 ? 0.0015 : -0.0015), t: 1756200000000 + i * 60000,
  }));
  await assert.rejects(() => encodeTrail({ points: zigzag, waypoints: [], from: '' }),
    /too long and twisty/, 'refusal names the problem instead of silently dropping the tail');
});

await t('crafted cards cannot flood storage or leak raw errors', async () => {
  const { deflateRawSync } = await import('node:zlib');
  const craft = (payload) => 'TC1.' + Buffer.from(deflateRawSync(JSON.stringify(payload)))
    .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  // 500 points is beyond anything a genuine encoder emits — reject by count.
  const big = {
    v: 1, f: '', d: 0, a: 0,
    p: [Array(500).fill(1).map((_, i) => i ? 1 : 5120000),
        Array(500).fill(1).map((_, i) => i ? 1 : -260000),
        Array(500).fill(1).map((_, i) => i ? 1 : 1756200000)],
    w: [],
  };
  await assert.rejects(() => decodeTrail(craft(big)), /damaged/, 'cardinality cap holds');

  // p elements that are not arrays must read as damage, not a TypeError.
  await assert.rejects(() => decodeTrail(craft({ v: 1, f: '', d: 0, a: 0, p: [1, 2, 3], w: [] })),
    /damaged/, 'shape check covers the inner arrays');

  // A megabyte 'from' name is capped at decode, not trusted from the wire.
  const named = craft({ v: 1, f: 'x'.repeat(100000), d: 0, a: 0,
    p: [[5120000, 100], [-260000, 100], [1756200000, 60]], w: [] });
  const back = await decodeTrail(named);
  assert.ok(back.from.length <= 40, `hostile sender name capped, got ${back.from.length}`);
});

await t('a crafted card that unfolds into megabytes is refused before it is read', async () => {
  const { deflateRawSync } = await import('node:zlib');
  const craft = (text) => 'TC1.' + Buffer.from(deflateRawSync(text))
    .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  // A million zero steps per column: a short code, and megabytes once inflated.
  const zeros = `[1${',0'.repeat(1e6)}]`;
  const bomb = craft(`{"v":1,"f":"","d":0,"a":0,"p":[${zeros},${zeros},${zeros}],"w":[]}`);
  assert.ok(bomb.length < 8000, `the bomb fits a link: ${bomb.length} chars`);
  const t0 = Date.now();
  await assert.rejects(() => decodeTrail(bomb), /damaged/);
  assert.ok(Date.now() - t0 < 2000, 'refused without summing a million steps');

  /* A card that is otherwise perfectly good but inflates past the limit is
     refused too: the limit is on what the code unfolds into, not on what
     it happens to say once it has. */
  const padded = craft(`{"v":1,"f":"","d":0,"a":0,"p":[[5120000,100],[-260000,100],[1756200000,60]],"w":[]}${' '.repeat(300000)}`);
  assert.ok(padded.length < 8000);
  await assert.rejects(() => decodeTrail(padded), /damaged/);

  // No QR holds a card this long, and a link is not let off because it has none.
  await assert.rejects(() => decodeTrail('TC1.' + 'A'.repeat(9000)), /damaged/);

  // A payload that is not an object reads as damage, not a TypeError.
  await assert.rejects(() => decodeTrail(craft('null')), /Trail Card is damaged/);
});

await t('inflate stops at its limit and gives back exactly what fits under it', async () => {
  const { deflateRawSync } = await import('node:zlib');
  const raw = new TextEncoder().encode('scent '.repeat(5000));
  const packed = new Uint8Array(deflateRawSync(raw));
  assert.deepEqual(await inflate(packed, raw.length), raw);
  assert.equal(await inflate(packed, raw.length - 1), null);
});

await t('simplify: collinear collapses, corners survive, bound holds', () => {
  const line = Array.from({ length: 50 }, (_, i) => ({ lat: 51.2 + i * 0.0001, lon: -2.6, t: i }));
  assert.equal(simplify(line, 4).length, 2, 'a straight line is two points');

  const corner = [
    { lat: 51.2, lon: -2.6 }, { lat: 51.205, lon: -2.6 }, { lat: 51.205, lon: -2.59 },
  ];
  const densifiedCorner = [corner[0], corner[1], corner[2]];
  assert.equal(simplify(densifiedCorner, 50).length, 3, 'a 350 m corner outlives a 50 m tolerance');

  const wiggly = drawn();
  const thin = simplify(wiggly, 8);
  assert.ok(maxDeviation(wiggly, thin) <= 8, 'every dropped point within the tolerance');
});

await t('rejection: damage reads as a sentence, not a stack trace', async () => {
  const card = await encodeTrail({ points: drawn(10), waypoints: [], from: '' });
  await assert.rejects(() => decodeTrail('hello'), /Not a Trail Card/);
  await assert.rejects(() => decodeTrail('TC9.abcdef'), /newer Trailcraft/);
  await assert.rejects(() => decodeTrail(card.slice(0, 30)), /damaged/);
  const mid = 30 + Math.floor((card.length - 30) / 2);
  const corrupted = card.slice(0, mid) + (card[mid] === 'A' ? 'B' : 'A') + card.slice(mid + 1);
  await assert.rejects(() => decodeTrail(corrupted), /damaged/, 'flipped interior byte');
  await assert.rejects(() => encodeTrail({ points: [], waypoints: [] }), /no line/);

  // A hostile card can carry any integer as a timestamp; the year 2150 must
  // bounce at decode, before GPX export or date rendering ever sees it.
  const evil = await encodeTrail({
    points: [{ lat: 51.2, lon: -2.6, t: 5680281600000 }, { lat: 51.201, lon: -2.6, t: 5680281660000 }],
    waypoints: [], from: 'x',
  });
  await assert.rejects(() => decodeTrail(evil), /damaged/, 'implausible era rejected');
});

await t('the vendored QR encoder can actually build the big card', async () => {
  const src = readFileSync(new URL('../public/vendor/qrcode.js', import.meta.url), 'utf8');
  const qrcode = new Function(`${src}; return qrcode;`)();
  const card = await encodeTrail({ points: recorded(), waypoints: [], from: 'Rémi' });
  const qr = qrcode(0, 'M');                    // type 0 = pick smallest that fits
  qr.addData(card, 'Byte');
  qr.make();
  assert.ok(qr.getModuleCount() > 21, `real QR produced: ${qr.getModuleCount()} modules across`);
});

await t('the vendored decoder loads as a classic script would', () => {
  const src = readFileSync(new URL('../public/vendor/jsQR.js', import.meta.url), 'utf8');
  const jsQR = new Function(`${src}; return globalThis.jsQR;`)();
  assert.equal(typeof jsQR, 'function', 'global jsQR exists outside CommonJS');
});


await t('relay cards: a plan carries its countdown, a walked card comes back, old cards read as plain trails', async () => {
  const t0 = Date.UTC(2026, 8, 13, 9, 0, 0);
  const pts = [];
  for (let i = 0; i < 20; i++) pts.push({ lat: 51.2094 + i * 1e-4, lon: -2.6449, t: t0 + i * 45000 });

  // The plan the handler draws: kind 1, with the chosen ageing riding along.
  const plan = await encodeTrail({ points: pts, waypoints: [], drawn: true, from: 'Rémi', kind: 1, ageMin: 10 });
  const gotPlan = await decodeTrail(plan);
  assert.equal(gotPlan.kind, 1, 'a plan says it is a plan');
  assert.equal(gotPlan.ageMin, 10, 'and carries the countdown');
  assert.ok(gotPlan.drawn, 'a plan is drawn, and says so');

  // The walked trail coming back: kind 2, no countdown needed.
  const walked = await encodeTrail({ points: pts, waypoints: [], from: 'Sophie', kind: 2 });
  const gotWalked = await decodeTrail(walked);
  assert.equal(gotWalked.kind, 2);
  assert.equal(gotWalked.ageMin, null, 'no countdown on a walked card');
  assert.equal(gotWalked.drawn, false, 'a walk with GPS is not drawn');
  // With no GPS of the walk it carries the drawn line back, and says so.
  const gotDrawnWalk = await decodeTrail(await encodeTrail({ points: pts, waypoints: [], from: 'Sophie', kind: 2, drawn: true }));
  assert.equal(gotDrawnWalk.kind, 2);
  assert.equal(gotDrawnWalk.drawn, true, 'a walked card carrying the drawn line says so');

  // A pre-relay card (no kind, no age) reads exactly as before.
  const plain = await encodeTrail({ points: pts, waypoints: [], from: 'Rémi' });
  const gotPlain = await decodeTrail(plain);
  assert.equal(gotPlain.kind, 0, 'old cards are plain trails');
  assert.equal(gotPlain.ageMin, null);

  // Absurd values collapse safely instead of propagating.
  const silly = await encodeTrail({ points: pts, waypoints: [], kind: 1, ageMin: 99999 });
  assert.equal((await decodeTrail(silly)).ageMin, 1440, 'countdown is clamped to a day');
});

await t('a walked card goes back to the plan it walked, not the newest one waiting', async () => {
  const t0 = Date.UTC(2026, 8, 13, 9, 0, 0);
  const pts = [];
  for (let i = 0; i < 20; i++) pts.push({ lat: 51.2094 + i * 1e-4, lon: -2.6449, t: t0 + i * 45000 });

  // The plan names itself, the walker's phone echoes it back.
  const plan = await decodeTrail(await encodeTrail({ points: pts, waypoints: [], kind: 1, ageMin: 10, planId: 'k3j9x2mdlw8a1b' }));
  assert.equal(plan.planId, 'k3j9x2mdlw8a1b', 'a plan card carries its plan');
  const card = await decodeTrail(await encodeTrail({ points: pts, waypoints: [], from: 'Sophie', kind: 2, planId: plan.planId }));
  assert.equal(card.planId, 'k3j9x2mdlw8a1b', 'and the walked card carries it back');
  assert.equal((await decodeTrail(await encodeTrail({ points: pts, waypoints: [], kind: 2 }))).planId, null,
    'an older app’s card names no plan');
  assert.equal((await decodeTrail(await encodeTrail({ points: pts, waypoints: [], kind: 2, planId: 'x"}<b>' }))).planId, null,
    'a crafted id is no id');

  // Two plans waiting on the same field, B the newer. The walk is A's.
  const A = { id: 'k3j9x2mdlw8a1b', planOf: null, run: true, start: pts[0] };
  const B = { id: 'zz9', planOf: null, run: true, start: { lat: 51.2096, lon: -2.6449 } };
  assert.deepEqual(walkedPlanFor(card, [B, A]), { id: A.id }, 'opened from the camera, it still finds its own plan');
  assert.deepEqual(walkedPlanFor(card, [B, A], B.id), { id: A.id }, 'even scanned from the other plan’s result');
  const copy = { id: 'c2', planOf: A.id, run: true, start: pts[0] };
  assert.deepEqual(walkedPlanFor(card, [B, copy]), { id: 'c2' }, 'a second run of the plan answers to it too');
  assert.deepEqual(walkedPlanFor(card, [B]), { id: null, why: 'other' }, 'and a plan not waiting here takes nobody else’s');

  // An older card, with two waiting: ask, rather than grade the wrong dog.
  const old = { ...card, planId: null };
  assert.deepEqual(walkedPlanFor(old, [B, A]), { id: null, ask: [A.id, B.id] }, 'asked, the nearest start first');
  assert.deepEqual(walkedPlanFor(old, [B, A], B.id), { id: B.id }, 'unless the handler said which plan it was for');
  assert.deepEqual(walkedPlanFor(old, [{ ...B, run: false }, A]), { id: A.id }, 'one run waiting: that one');
  assert.deepEqual(walkedPlanFor(old, []), { id: null }, 'nothing waiting: nothing');
});

await t('a card in a QR is a link, so the phone camera opens the app not Google', async () => {
  const pts = [{ lat: 51.2094, lon: -2.6449, t: 1_700_000_000_000 },
               { lat: 51.2103, lon: -2.6441, t: 1_700_000_060_000 }];
  const card = await encodeTrail({ points: pts, waypoints: [], from: 'Remi' });

  const url = cardUrl(card, 'https://sydrouxba5.github.io/trailcraft/');
  assert.ok(url.startsWith('https://'), 'a camera app will treat this as a link');
  assert.ok(url.includes('#c='), 'and the card rides in the fragment, never sent to a server');

  // Both forms scan: a link from a camera, a bare card from an older phone.
  assert.equal(cardFromText(url), card, 'the link gives the card back exactly');
  assert.equal(cardFromText(card), card, 'a bare card passes straight through');
  assert.equal(cardFromText(`  ${url}  `), card, 'whitespace from a scanner is trimmed');
  const back = await decodeTrail(cardFromText(url));
  assert.equal(back.from, 'Remi');
  assert.equal(back.points.length, 2);

  // A page address that already had a hash or query does not grow a second one.
  assert.equal(cardUrl(card, 'https://x.dev/app/#scrHome').split('#').length, 2,
    'exactly one fragment, whatever the page address was');

  // Opened from disk there is no address to hang it on, so send the card bare
  // rather than a file:// link the other phone could never open.
  assert.equal(cardUrl(card, 'file:///Users/remidroux/Desktop/Trailcraft.html'), card);
  assert.equal(cardUrl(card, ''), card);
});

await t('the link wrapper still leaves a long trail inside one QR', async () => {
  const card = await encodeTrail({ points: recorded(), waypoints: [] });
  const url = cardUrl(card, 'https://sydrouxba5.github.io/trailcraft/');
  assert.ok(url.length < 1800, `link length ${url.length} must still fit a scannable QR`);
});

console.log(`\n${pass} passed total`);
