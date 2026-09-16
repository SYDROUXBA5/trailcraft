/* Sharing a trail: the link must give back what went in, refuse what it
   cannot read in plain words, and the GPX must be a file any importer opens. */

import assert from 'node:assert/strict';
import {
  trailModel, encodeShared, decodeShared, sharedUrl, sharedFromText,
  toGpx, fileBase, detailSections, headline, notes, liveMeta, liveModel,
} from '../public/share.js';
import { through, b64url } from '../public/card.js';
import { dist } from '../public/geo.js';

let pass = 0;
const t = async (name, fn) => { await fn(); pass++; console.log(`  ok  ${name}`); };

/* A seeded wobble, so a noisy track is the same noisy track every run. */
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;

const T0 = Date.parse('2026-09-16T13:00:00Z');
function walk(n, { from = { lat: 51.2, lon: -2.6 }, stepS = 2, noiseM = 0, heading = 40 } = {}) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const m = i * 1.3 * stepS;
    const dn = m * Math.cos(heading * Math.PI / 180) + rnd() * noiseM;
    const de = m * Math.sin(heading * Math.PI / 180) + rnd() * noiseM;
    pts.push({
      lat: from.lat + dn / 111320,
      lon: from.lon + de / (111320 * Math.cos(from.lat * Math.PI / 180)),
      t: T0 + i * stepS * 1000 + 137,
      alt: 40 + i * 0.05,
    });
  }
  return pts;
}

function session({ trailN = 200, trackN = 600, noise = 1.5, plan = false } = {}) {
  const trail = walk(trailN);
  trail[trail.length - 1].dwellS = 900;
  const track = walk(trackN, { noiseM: noise }).map(p => ({ ...p, t: p.t + 25 * 60e3 }));
  return {
    id: 's1', startedAt: T0, targetId: 'person', layerId: 'l1', dogId: 'd1',
    data: {
      plan, trail, contamination: [],
      weather: { temp: 14.23, wind_speed: 3.46, wind_direction: 225, soil_temp: 11.1, humidity: 78.4,
        series: [{ t: T0, temp: 14.2, wind_speed: 3.4, wind_direction: 224 }] },
      track, trackStarted: T0 + 25 * 60e3,
      trackWaypoints: [{ ...track[300], kind: 'Indication' }],
      result: { kind: 'trail', sentence: 'Bo worked about 4 m to the right of the line.', mean: 4.213, side: 'right',
        predSide: 1, agree: 0.83, ageMin: 25, regimeWord: 'crosswind', stability: 'Unstable',
        wind: { speed: 3.9, from: 230 } },
    },
  };
}
const people = {
  dog: { id: 'd1', name: 'Bo', breed: 'Malinois', sex: 'Male', dob: Date.parse('2023-05-01'), weightKg: 29.4, lineM: 5, photo: 'data:…' },
  handler: { id: 'h1', name: 'Rémi' },
  layer: { id: 'l1', name: 'Sophie' },
};

await t('the model carries names, never this phone’s ids or photos', () => {
  const m = trailModel(session(), people);
  assert.equal(m.dog.name, 'Bo');
  assert.equal(m.handler, 'Rémi');
  assert.equal(m.layer, 'Sophie');
  assert.equal(m.dog.photo, undefined);
  assert.equal(JSON.stringify(m).includes('"d1"'), false);
  assert.equal(m.kind, 'trail');
});

await t('a link gives back the trail, the run and every detail', async () => {
  const m = trailModel(session(), people);
  const info = {};
  const code = await encodeShared(m, info);
  assert.match(code, /^TS1\.[A-Za-z0-9_-]+$/);
  assert.equal(info.thinnedM, 0);
  const back = await decodeShared(code);
  assert.equal(back.trail.length, m.trail.length);
  assert.equal(back.track.length, m.track.length);
  back.trail.forEach((p, i) => {
    assert.ok(dist(p, m.trail[i]) < 0.12, `point ${i} moved ${dist(p, m.trail[i])} m`);
    assert.ok(Math.abs(p.t - m.trail[i].t) < 1000);
    assert.ok(Math.abs(p.alt - m.trail[i].alt) <= 0.051);
  });
  assert.equal(back.trail.at(-1).dwellS, 900, 'the standing spot keeps its wait');
  assert.equal(back.wps[0].kind, 'Indication');
  assert.equal(back.result.sentence, m.result.sentence);
  assert.equal(back.result.mean, 4.21);
  assert.equal(back.wx.temp, 14.2);
  assert.equal(back.wx.series.length, 1);
  assert.deepEqual([back.handler, back.layer, back.dog.name, back.dog.breed], ['Rémi', 'Sophie', 'Bo', 'Malinois']);
  assert.equal(back.laidAt, T0);
});

await t('the link is the page address with the trail in the fragment', async () => {
  const code = await encodeShared(trailModel(session({ trailN: 20, trackN: 30 }), people));
  const url = sharedUrl(code, 'https://sydrouxba5.github.io/trailcraft/#c=old');
  assert.equal(url, `https://sydrouxba5.github.io/trailcraft/#t=${code}`);
  assert.equal(sharedFromText(url), code);
  assert.equal(sharedFromText(`look at this ${url} !`), code);
  assert.equal(sharedFromText('https://example.com/'), null);
});

await t('a very long run is thinned to fit, and the standing spot survives', async () => {
  const s = session({ trailN: 2500, trackN: 9000, noise: 4 });
  s.data.trail[1200].dwellS = 300;
  const m = trailModel(s, people);
  const info = {};
  const code = await encodeShared(m, info);
  assert.ok(info.thinnedM > 0, 'a 5 h track should need thinning');
  const back = await decodeShared(code);
  assert.ok(back.track.length < m.track.length);
  assert.equal(back.thinnedM, info.thinnedM);
  assert.ok(back.trail.some(p => p.dwellS === 300), 'a mid-trail wait is never thinned away');
  assert.equal(back.trail.at(-1).dwellS, 900);
  assert.match(notes(back).join(' '), /thinned by up to/);
});

await t('a broken link says what is wrong, in words', async () => {
  const code = await encodeShared(trailModel(session({ trailN: 40, trackN: 40 }), people));
  await assert.rejects(decodeShared(code.slice(0, code.length / 2)), /cut short/);
  await assert.rejects(decodeShared('TS2.abcdef'), /newer Trailcraft/);
  await assert.rejects(decodeShared('hello'), /does not hold a shared trail/);
});

await t('a hand-made link cannot smuggle in the wrong types', async () => {
  const forge = async (obj) => 'TS1.' + b64url(await through(
    new TextEncoder().encode(JSON.stringify(obj)), new CompressionStream('deflate-raw')));
  await assert.rejects(decodeShared(await forge({ kind: 'trail', trail: { lat: ['x'], lon: [1] } })), /damaged/);
  await assert.rejects(decodeShared(await forge([1, 2, 3])), /damaged/);
  const odd = await decodeShared(await forge({
    kind: 'trail', handler: { evil: 1 }, layer: 42, dog: { name: ['<b>'], weightKg: 'heavy' },
    trail: { lat: [51200000, 10], lon: [-2600000, 10] }, runAt: 'soon',
  }));
  assert.equal(odd.handler, null);
  assert.equal(odd.layer, null);
  assert.equal(odd.dog.name, undefined);
  assert.equal(odd.dog.weightKg, undefined);
  assert.equal(odd.runAt, null);
  assert.equal(odd.trail.length, 2);
});

/* A small tokenizer is enough to prove the file is well formed: every tag
   closes in order and every ampersand is an entity. */
function assertWellFormed(x) {
  const stack = [];
  for (const m of x.matchAll(/<(\/?)([A-Za-z_][\w:.-]*)(?:\s[^<>]*?)?(\/?)>/g)) {
    if (m[3]) continue;
    if (m[1]) assert.equal(stack.pop(), m[2], `</${m[2]}> closes the wrong element`);
    else stack.push(m[2]);
  }
  assert.deepEqual(stack, [], 'unclosed elements');
  assert.doesNotMatch(x, /&(?!(amp|lt|gt|quot|apos);)/, 'a raw ampersand');
}

await t('GPX: both tracks, the marks, and a file importers accept', () => {
  const m = trailModel(session(), { ...people, dog: { ...people.dog, name: 'Bo & <Rex>' } });
  const gpx = toGpx(m);
  assertWellFormed(gpx);
  assert.match(gpx, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<gpx version="1\.1" creator="Trailcraft"/);
  assert.equal((gpx.match(/<trk>/g) || []).length, 2);
  assert.match(gpx, /<name>Laid trail — Sophie<\/name>/);
  assert.match(gpx, /<name>Bo &amp; &lt;Rex&gt;’s run<\/name>/);
  assert.equal((gpx.match(/<trkpt /g) || []).length, m.trail.length + m.track.length);
  assert.equal((gpx.match(/<wpt /g) || []).length, 3, 'start, end, one indication');
  assert.match(gpx, /<trkpt lat="[\d.-]+" lon="[\d.-]+"><ele>[\d.]+<\/ele><time>2026-09-16T\d\d:\d\d:\d\dZ<\/time><\/trkpt>/);
  assert.doesNotMatch(gpx, /NaN|undefined|null/);
  const b = gpx.match(/<bounds minlat="([\d.-]+)" minlon="([\d.-]+)" maxlat="([\d.-]+)" maxlon="([\d.-]+)"\/>/);
  assert.ok(b && +b[1] <= +b[3] && +b[2] <= +b[4]);
});

await t('GPX: a drawn plan says it was drawn, and a search marks its hides', () => {
  const plan = trailModel(session({ plan: true }), people);
  assert.match(toGpx(plan), /<name>Drawn plan<\/name>/);
  const hides = [{ lat: 51.2, lon: -2.6 }, { lat: 51.201, lon: -2.601 }];
  const search = trailModel({ startedAt: T0, targetId: 'article', data: { hides, weather: null } }, people);
  const gpx = toGpx(search);
  assertWellFormed(gpx);
  assert.match(gpx, /<name>Hide 2<\/name>/);
  assert.equal((gpx.match(/<trk>/g) || []).length, 0);
});

await t('file names sort by date and survive any file system', () => {
  const m = trailModel(session(), { ...people, dog: { name: 'Rémi’s dog' } });
  assert.match(fileBase(m), /^trailcraft-2026-09-1\d-remi-s-dog-trail$/);
});

await t('details follow the reader’s units and never print a hole', () => {
  const m = trailModel(session(), people);
  const flat = (secs) => secs.flatMap(s => s.rows.map(r => r.join(': '))).join('\n');
  const metric = flat(detailSections(m, { when: () => 'Tue 16 Sep' }));
  const imperial = flat(detailSections(m, { imperial: true, fahrenheit: true, coord: 'dms', when: () => 'Tue 16 Sep' }));
  assert.match(metric, /Length: \d+ m/);
  assert.match(metric, /Air: 14 °C/);
  assert.match(metric, /Average offset: 4\.2 m to the right/);
  assert.match(metric, /Trail age at start: 25 min · Hot/);
  assert.match(metric, /Dog: Bo · Malinois · Male · 3 yr 4 mo · 29\.4 kg/);
  assert.match(imperial, /Length: \d+ yd/);
  assert.match(imperial, /Air: 58 °F/);
  assert.match(imperial, /Start: 51°12'/);
  for (const text of [metric, imperial]) assert.doesNotMatch(text, /undefined|NaN|null|: $/m);
  assert.equal(headline(m), m.result.sentence);
});

await t('a search lists its hides and how the dog found them', () => {
  const hides = [{ lat: 51.2, lon: -2.6 }];
  const track = walk(50).map(p => ({ ...p, t: p.t + 60e3 }));
  const m = trailModel({ startedAt: T0, targetId: 'cadaver', data: {
    hides, track, trackStarted: T0 + 60e3, trackWaypoints: [],
    result: { kind: 'search', sentence: 'Bo indicated in 1:40, 2 m from the hide.', toFirst: 100e3, catchM: 2, approach: 'into the wind', ageMin: 1 },
  } }, people);
  const secs = detailSections(m, { when: () => 'x' });
  assert.deepEqual(secs.map(s => s.title), ['Team', 'Hide', 'Run']);
  const text = secs.flatMap(s => s.rows.map(r => r.join(': '))).join('\n');
  assert.match(text, /Hide 1: 51\.20000, -2\.60000/);
  assert.match(text, /First indication: 1:40/);
  assert.doesNotMatch(text, /Laid by/);
});

await t('live: the meta holds the trail but not the run, and chunks rebuild the run in order', () => {
  const m = trailModel(session(), people);
  const meta = liveMeta(m, T0 + 25 * 60e3);
  assert.equal(meta.track, undefined);
  assert.equal(meta.result, undefined);
  assert.equal(meta.trail.length, m.trail.length);
  assert.equal(meta.wx.temp, 14.2);
  assert.equal(meta.dog.name, 'Bo');
  const late = m.track.slice(60, 120), early = m.track.slice(0, 60);
  const back = liveModel({ ...meta, wps: m.wps, ended: true, result: m.result }, [late, early]);
  assert.equal(back.track.length, 120);
  assert.ok(back.track.every((p, i) => !i || p.t >= back.track[i - 1].t), 'time order restored');
  assert.equal(back.runAt, T0 + 25 * 60e3);
  assert.equal(back.ended, true);
  assert.equal(back.wps[0].kind, 'Indication');
  assert.equal(headline(back), m.result.sentence);
  const empty = liveModel(meta, []);
  assert.equal(empty.track, null);
  assert.match(headline(empty), /not yet run/);
});

console.log(`\n${pass} passed total`);
