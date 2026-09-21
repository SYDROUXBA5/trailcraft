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
  assert.match(metric, /Typical distance from the line: 4\.2 m/, 'an older result with only a mean still reads');
  assert.match(metric, /Mainly: to the right/);
  assert.match(metric, /Forecast wind suggests drift: to the right/);
  assert.match(metric, /Track vs forecast: same side/);
  assert.doesNotMatch(metric, /on the scent/i);
  assert.match(metric, /Trail age at start: 25 min · Hot/);
  assert.match(metric, /Dog: Bo · Malinois · Male · 3 yr 4 mo · 29\.4 kg/);
  assert.match(imperial, /Length: \d+ yd/);
  assert.match(imperial, /Air: 58 °F/);
  assert.match(imperial, /Start: 51°12'/);
  for (const text of [metric, imperial]) assert.doesNotMatch(text, /undefined|NaN|null|: $/m);
  assert.equal(headline(m), m.result.sentence);
});

await t('a newer result shows the median, the time per side, and whether the run was coached', async () => {
  const s = session();
  s.data.result = { ...s.data.result, medAbs: 3.7, shares: { left: 0.38, on: 0.41, right: 0.21 }, mainSide: 'left',
    accMed: 4, noisy: false };
  s.data.coach = { assisted: true, tolM: 20, scent: false, calls: 2, shadow: { tolM: 20, plain: 2, scent: 1 } };
  const m = trailModel(s, people);
  const text = detailSections(m, { when: () => 'x' }).flatMap(sec => sec.rows.map(r => r.join(': '))).join('\n');
  assert.match(text, /Typical distance from the line: 3\.7 m/);
  assert.match(text, /Time left · on · right: 38 % · 41 % · 21 %/);
  assert.match(text, /Track vs forecast: other side/);
  assert.match(text, /Run: assisted — the coach was on/);
  assert.match(text, /Coach calls: 2/);
  assert.match(text, /Had the coach been on: 2 calls with a 20 m corridor, 1 with the scent corridor/);
  const back = await decodeShared(await encodeShared(m));
  assert.equal(back.coach.assisted, true);
  assert.equal(back.coach.shadow.scent, 1);
  assert.equal(back.result.shares.on, 0.41);
  const blind = trailModel({ ...s, data: { ...s.data, coach: { assisted: false, shadow: { tolM: 20, plain: 0, scent: 0 } } } }, people);
  assert.match(detailSections(blind, { when: () => 'x' }).flatMap(sec => sec.rows.map(r => r.join(': '))).join('\n'), /Run: blind — no prompts/);
  assert.match(notes(m).join(' '), /estimates from a forecast, not measurements/);
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

/* ── The judgement travels with the run ──────────────────────────────
   Until this, the debrief and the handler's call were stripped from every
   shared run: the only parts of the record a person had to supply were the
   only parts that could never leave the phone. */

const judged = ({ seen = false, debrief = true } = {}) => {
  const s = session({ trailN: 40, trackN: 80 });
  s.data.trackWaypoints = [{ ...s.data.track[50], kind: 'Indication', call: { v: 1, conf: 'sure', seen, at: 1 } }];
  if (debrief) {
    s.data.debrief = { v: 1, outcome: 'found', target: 'real', blind: 'handler', help: 'none',
      response: 'clear', flags: ['hot'], note: 'Cast wider at the gate.', noteTag: 'handler', by: 'Rémi', at: T0 };
  }
  return s;
};

await t('the handler’s judgement and their call travel with the run', async () => {
  const back = await decodeShared(await encodeShared(trailModel(judged(), people)));
  const d = back.debrief;
  assert.equal(d.outcome, 'found');
  assert.equal(d.target, 'real');
  assert.equal(d.blind, 'handler', 'who knew the answer — the field that decides whether the run proves anything');
  assert.equal(d.help, 'none');
  assert.equal(d.response, 'clear');
  assert.deepEqual(d.flags, ['hot']);
  assert.equal(d.note, 'Cast wider at the gate.');
  assert.equal(d.noteTag, 'handler');
  assert.equal(d.by, 'Rémi');
  assert.deepEqual(back.wps[0].call, { conf: 'sure', seen: false }, 'the call made before looking');
  assert.equal(back.wps[0].kind, 'Indication');
});

await t('a call made with the trail on screen still says so on the far side', async () => {
  const back = await decodeShared(await encodeShared(trailModel(judged({ seen: true }), people)));
  assert.equal(back.wps[0].call.seen, true, 'or a reading would arrive looking like a blind call');
});

await t('a run with no judgement carries none, and says nothing about one', async () => {
  const s = session({ trailN: 40, trackN: 80 });
  const back = await decodeShared(await encodeShared(trailModel(s, people)));
  assert.equal(back.debrief, null);
  assert.equal(back.wps[0].call, undefined);
  assert.ok(!detailSections(back).some(sec => sec.title.startsWith('Judged')));
});

await t('a hand-made link cannot smuggle a judgement in', async () => {
  const forge = async (obj) => 'TS1.' + b64url(await through(
    new TextEncoder().encode(JSON.stringify(obj)), new CompressionStream('deflate-raw')));
  const trail = { lat: [51200000, 10], lon: [-2600000, 10] };

  const noOutcome = await decodeShared(await forge({ kind: 'trail', trail, debrief: { outcome: '<script>', target: 'real' } }));
  assert.equal(noOutcome.debrief, null, 'an outcome the app never offers means no judgement at all');

  const odd = await decodeShared(await forge({ kind: 'trail', trail, debrief: {
    outcome: 'found', target: 'nonsense', blind: 'double', help: 42,
    flags: ['fouled', 'evil', { x: 1 }], note: 'x'.repeat(500), noteTag: 'bogus', by: { a: 1 }, at: 'yesterday',
  } }));
  const d = odd.debrief;
  assert.equal(d.outcome, 'found');
  assert.equal(d.target, null, 'a value not in the list is dropped, not shown');
  assert.equal(d.blind, 'double');
  assert.equal(d.help, null);
  assert.deepEqual(d.flags, ['fouled'], 'only flags the app offers');
  assert.equal(d.note.length, 140);
  assert.equal(d.noteTag, null);
  assert.equal(d.by, null);
  assert.equal(d.at, null);

  const call = await decodeShared(await forge({ kind: 'trail', trail,
    wps: { lat: [51200000], lon: [-2600000], kd: [[0, 'Indication']], cl: [[0, 'lol', 0], [9, 'sure', 0]] } }));
  assert.equal(call.wps[0].call, undefined, 'a confidence the app never offers is dropped');
  assert.equal(call.wps.length, 1, 'and a call pointing past the end cannot conjure a mark');
});

await t('the page and the report show the judgement, with the call first', async () => {
  const back = await decodeShared(await encodeShared(trailModel(judged(), people)));
  const sec = detailSections(back).find(x => x.title.startsWith('Judged'));
  assert.ok(sec, 'there is a judged section');
  assert.equal(sec.title, 'Judged by Rémi', 'a judgement has an author');
  assert.deepEqual(sec.rows[0], ['Their call, before looking', 'Certain'], 'made first, shown first');
  assert.ok(sec.rows.some(([k, v]) => k === 'How did it end' && v === 'Found it'));
  assert.ok(sec.rows.some(([k, v]) => k === 'Who knew the answer' && v === 'The handler did not'),
    'third person — the reader is not the handler');
  assert.ok(!sec.rows.some(([k]) => k === 'Help you gave'), 'not "you" on someone else’s page');
  assert.ok(sec.rows.some(([k, v]) => k === 'Flagged' && v === 'Too hot'));
  assert.ok(sec.note.includes('not something the phone measured'));

  const titles = detailSections(back).map(x => x.title);
  assert.ok(titles.indexOf('Run') < titles.indexOf('Judged by Rémi'), 'measured above judged');

  const onScreen = await decodeShared(await encodeShared(trailModel(judged({ seen: true }), people)));
  assert.equal(detailSections(onScreen).find(x => x.title.startsWith('Judged')).rows[0][1],
    'Certain (trail already on screen)');
});

console.log(`\n${pass} passed total`);
