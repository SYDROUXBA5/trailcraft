/* Sharing a trail: the link must give back what went in, refuse what it
   cannot read in plain words, and the GPX must be a file any importer opens. */

import assert from 'node:assert/strict';
import {
  trailModel, encodeShared, decodeShared, sharedUrl, sharedFromText,
  toGpx, fileBase, detailSections, headline, notes, liveMeta, liveModel,
  sessionFromModel, keptSession, peopleOf,
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

const rowsOf = (secs) => secs.flatMap(sec => sec.rows.map(r => r.join(': '))).join('\n');
/* Bob's phone: his own handler and dog, and none of Alice's. */
const bobs = {
  dogs: [{ id: 'd9', name: 'Nell' }], handlers: [{ id: 'h9', name: 'Bob' }], layers: [],
  me: { id: 'h9', name: 'Bob' },
};

await t('a kept run goes on under its own handler, with its dog, its coach and what was seen', async () => {
  /* Alice sends Bob a coached run with ground notes, and Bob keeps it. Passed
     on again, it used to name Bob as the handler, with no dog, no coach and
     nothing seen on the ground. */
  const s = session();
  s.data.coach = { assisted: true, tolM: 20, scent: false, calls: 2 };
  s.data.seen = { wet: 'damp', sun: 'shade' };
  const alice = { ...people, handler: { id: 'h1', name: 'Alice' } };
  const got = await decodeShared(await encodeShared(trailModel(s, alice)));
  const kept = keptSession(got, { id: 'k1', at: T0 + 60 * 60e3 });
  assert.equal(kept.handlerId, null, 'no id of this phone’s is pointed at');
  assert.equal(kept.data.coach.assisted, true);
  assert.equal(kept.data.seen.wet, 'damp');
  assert.equal(kept.data.imported.from, 'Alice', 'older builds still read who it came from');
  const again = trailModel(kept, peopleOf(kept, bobs));
  const text = rowsOf(detailSections(again, { when: () => 'x' }));
  assert.match(text, /Handler: Alice/);
  assert.match(text, /Dog: Bo · Malinois/);
  assert.match(text, /Laid by: Sophie/);
  assert.match(text, /Run: assisted — the coach was on/);
  assert.match(text, /Conditions: Damp/);
  assert.doesNotMatch(text, /Bob|Nell/);
  const twice = await decodeShared(await encodeShared(again));
  assert.equal(twice.handler, 'Alice');
  assert.equal(twice.dog.name, 'Bo');
  assert.equal(twice.coach.calls, 2);
  assert.equal(twice.seen.sun, 'shade');
  /* The copy on the shared page is the same run, before anyone keeps it. */
  assert.equal(sessionFromModel(got).data.seen.wet, 'damp');
});

await t('whose a record is: a run kept by an older build, a run made here on a sent trail, a Trail Card', () => {
  const at = T0 + 60 * 60e3;
  /* Kept before the names were stored: only `from`, which was the handler. */
  const old = { ...session(), dogId: null, handlerId: null, layerId: null };
  old.data.imported = { from: 'Alice', at };
  const p = peopleOf(old, bobs);
  assert.equal(p.handler.name, 'Alice');
  assert.equal(p.dog, null, 'no dog is better than this phone’s dog');
  /* A trail Alice sent and Bob kept, then ran himself: his run, her layer. */
  const ran = { ...session(), dogId: 'd9', handlerId: 'h9', layerId: null };
  ran.data.imported = { from: 'Alice', at: T0, dog: { name: 'Bo' }, handler: 'Alice', layer: 'Sophie' };
  const q = peopleOf(ran, bobs);
  assert.deepEqual([q.handler.name, q.dog.name, q.layer.name], ['Bob', 'Nell', 'Sophie']);
  /* A Trail Card's trail is filed under this phone's handler, whoever sent it. */
  const card = { id: 'c1', startedAt: T0, targetId: 'person', handlerId: 'h9', dogId: null, layerId: null,
    data: { trail: walk(20), imported: { from: 'another phone', at: T0 } } };
  assert.equal(peopleOf(card, bobs).handler.name, 'Bob');
  /* This phone's own record reads as it always did. */
  assert.equal(peopleOf({ ...session(), handlerId: 'gone' }, bobs).handler.name, 'Bob');
  /* The names came from a stranger's link: only words get through. */
  const odd = { ...old, data: { ...old.data, imported: { at, handler: { name: 'x' }, layer: 42, dog: { name: 'Bo', photo: 'data:…' } } } };
  const r = peopleOf(odd, bobs);
  assert.equal(r.handler, null);
  assert.equal(r.layer, null);
  assert.deepEqual(r.dog, { name: 'Bo' });
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

await t('a search link sent before the fix reads with the approach the right way round', async () => {
  /* The approach used to be written back to front. A link made then still
     carries it that way; one made since carries approachV and is left alone. */
  const hides = [{ lat: 51.2, lon: -2.6 }];
  const track = walk(50).map(p => ({ ...p, t: p.t + 60e3 }));
  const search = (result) => trailModel({ startedAt: T0, targetId: 'cadaver', data: {
    hides, track, trackStarted: T0 + 60e3, trackWaypoints: [], result } }, people);
  const old = { kind: 'search', sentence: 'Bo indicated in 1:40, 2 m from the hide, coming with the wind.',
    toFirst: 100e3, catchM: 2, approach: 'with the wind', ageMin: 1 };
  const back = await decodeShared(await encodeShared(search(old)));
  assert.equal(back.result.approach, 'into the wind');
  assert.equal(headline(back), 'Bo indicated in 1:40, 2 m from the hide, coming into the wind.');
  const rows = detailSections(back, { when: () => 'x' }).flatMap(sec => sec.rows.map(r => r.join(': '))).join('\n');
  assert.match(rows, /Came in: into the wind/);
  const now = await decodeShared(await encodeShared(search({ ...old, approachV: 2 })));
  assert.equal(now.result.approach, 'with the wind', 'graded since: already right');
});

await t('rain is shown as a rate, not a bare 15-minute total', () => {
  const s = session();
  s.data.weather = { ...s.data.weather, precipitation: 0.5 };
  const rows = detailSections(trailModel(s, people), { when: () => 'x' }).flatMap(sec => sec.rows.map(r => r.join(': '))).join('\n');
  assert.match(rows, /Rain: 2\.0 mm\/h/);
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
  assert.ok(sec.note.includes('None of it comes from the phone'));

  const titles = detailSections(back).map(x => x.title);
  assert.ok(titles.indexOf('Run') < titles.indexOf('Judged by Rémi'), 'measured above judged');

  const onScreen = await decodeShared(await encodeShared(trailModel(judged({ seen: true }), people)));
  assert.equal(detailSections(onScreen).find(x => x.title.startsWith('Judged')).rows[0][1],
    'Certain (trail already on screen)');
});

await t('what the handler saw on the ground travels, and a forged value does not', async () => {
  const s = judged();
  s.data.seen = { v: 1, wet: 'damp', sun: 'shade', at: T0 };
  const back = await decodeShared(await encodeShared(trailModel(s, people)));
  assert.deepEqual(back.seen, { v: 1, wet: 'damp', sun: 'shade' });
  const sec = detailSections(back).find(x => x.title === 'Seen on the ground');
  assert.deepEqual(sec.rows, [['Conditions', 'Damp, in shade']]);
  assert.ok(sec.note.includes('written down by hand'));

  const none = await decodeShared(await encodeShared(trailModel(judged(), people)));
  assert.equal(none.seen, null);
  assert.ok(!detailSections(none).some(x => x.title === 'Seen on the ground'));

  const forge = async (obj) => 'TS1.' + b64url(await through(
    new TextEncoder().encode(JSON.stringify(obj)), new CompressionStream('deflate-raw')));
  const odd = await decodeShared(await forge({ kind: 'trail', trail: { lat: [51200000, 10], lon: [-2600000, 10] },
    seen: { wet: 'soaking', sun: '<img>' } }));
  assert.equal(odd.seen, null, 'values the app never offers are not shown to anyone');
});

await t('a trail’s name travels with it, and a blank or odd one does not', async () => {
  const named = { ...session({ trailN: 20 }), name: '  Church lane loop  ' };
  const m = trailModel(named, people);
  assert.equal(m.name, 'Church lane loop');
  const back = await decodeShared(await encodeShared(m));
  assert.equal(back.name, 'Church lane loop');
  assert.equal(trailModel({ ...named, name: '   ' }, people).name, null);
  assert.equal(trailModel({ ...named, name: 42 }, people).name, null);
  const plain = await decodeShared(await encodeShared(trailModel(session({ trailN: 20 }), people)));
  assert.equal(plain.name, null, 'an unnamed trail stays unnamed');
});

/* ── Hostile links ─────────────────────────────────────────────────
   Every payload below is one a stranger could send. A link is opened by
   tapping it, so whatever is in it has to be refused or made harmless
   before any of it reaches the page. */
const forgeLink = async (obj) => 'TS1.' + b64url(await through(
  new TextEncoder().encode(JSON.stringify(obj)), new CompressionStream('deflate-raw')));
const oneHide = { lat: [51200000], lon: [-2600000] };
const twoPts = { lat: [51200000, 100], lon: [-2600000, 100] };

await t('a link cannot put markup into the result a kept run shows', async () => {
  const xss = '<img src=x onerror=alert(document.domain)>';
  const m = await decodeShared(await forgeLink({
    kind: 'search', hides: oneHide,
    result: { kind: 'search', sentence: 'Found it', approach: xss, ageMin: '<b>9</b>', catchM: '<svg onload=x>',
      toFirst: 90e3, catchApprox: 'yes', approachV: 2, extra: '<script>alert(1)</script>', __proto__: { kind: 'x' } },
  }));
  assert.equal(m.result.kind, 'search');
  assert.equal(m.result.sentence, 'Found it');
  assert.equal(m.result.approach, null, 'an approach the app never writes is dropped');
  assert.equal(m.result.ageMin, null);
  assert.equal(m.result.catchM, null);
  assert.equal(m.result.toFirst, 90e3);
  assert.equal(m.result.catchApprox, false);
  assert.equal('extra' in m.result, false, 'a field the app never writes does not come');
  assert.doesNotMatch(JSON.stringify(m.result), /</);

  const trail = await decodeShared(await forgeLink({
    kind: 'trail', trail: twoPts,
    result: { kind: 'trail', sentence: 'Bo ran.', side: '<b>left</b>', mainSide: '__proto__', predSide: '1',
      shares: { left: 0.2, on: 0.5, right: '<i>' }, wind: { speed: 3, from: 'north' }, medAbs: -4, mean: 2.5,
      regimeKey: 'javascript:', mp: { '__proto__': 1, drift: 2, 'a b': 3, bad: 'x' } },
  }));
  const r = trail.result;
  assert.equal(r.side, null);
  assert.equal(r.mainSide, null);
  assert.equal(r.predSide, null);
  assert.equal(r.shares, null, 'shares only come whole and as fractions');
  assert.deepEqual(r.wind, { speed: 3, from: null });
  assert.equal(r.medAbs, null);
  assert.equal(r.mean, 2.5);
  assert.equal(r.regimeKey, null);
  assert.deepEqual(Object.keys(r.mp), ['drift']);
  assert.equal(({}).drift, undefined);

  const odd = await decodeShared(await forgeLink({ kind: 'trail', trail: twoPts, result: { kind: '<b>', sentence: 'x' } }));
  assert.equal(odd.result, null, 'a result of a kind the app never writes is no result');
});

await t('a genuine result still comes through whole', async () => {
  const hides = [{ lat: 51.2, lon: -2.6 }];
  const track = walk(50).map(p => ({ ...p, t: p.t + 60e3 }));
  const result = { kind: 'search', sentence: 'Bo indicated in 1:40, 2 m from the hide, coming into the wind.',
    toFirst: 100e3, catchM: 2, catchApprox: false, approach: 'into the wind', approachV: 2, ageMin: 1,
    stability: 'neutral', stabilityPlain: 'Ground and air are close.', wind: { speed: 2.4, from: 200 } };
  const back = await decodeShared(await encodeShared(trailModel({ startedAt: T0, targetId: 'cadaver', data: {
    hides, track, trackStarted: T0 + 60e3, trackWaypoints: [], result } }, people)));
  assert.deepEqual(back.result, result);
});

await t('a link cannot slip a word in where the weather keeps a number', async () => {
  const m = await decodeShared(await forgeLink({
    kind: 'trail', trail: twoPts,
    wx: { wind_speed: '<img src=x>', temp: 12, time: '2026-09-16T13:00', evil: { a: 1 }, note: '<b>hi</b>',
      series: Array.from({ length: 300 }, (_, i) => ({ t: T0 + i, wind_speed: i % 2 ? 'x' : 3 })) },
  }));
  assert.equal(m.wx.wind_speed, undefined);
  assert.equal(m.wx.temp, 12);
  assert.equal(m.wx.time, '2026-09-16T13:00');
  assert.equal('evil' in m.wx, false);
  assert.equal('note' in m.wx, false);
  assert.ok(m.wx.series.length <= 96, `series capped, got ${m.wx.series.length}`);
  assert.ok(m.wx.series.every(e => e.wind_speed === undefined || e.wind_speed === 3));
});

await t('a link too big to be real is refused in words, before it is built', async () => {
  /* The finding's own payload: millions of zero steps deflate to a few
     kilobytes and used to unfold into millions of points. */
  const zeros = (n, first) => [first, ...new Array(n).fill(0)];
  const bomb = await forgeLink({ kind: 'trail', trail: { lat: zeros(1e6, 51200000), lon: zeros(1e6, -2600000) } });
  assert.ok(bomb.length < 64000, `the bomb is a short link: ${bomb.length} chars`);
  const t0 = Date.now();
  await assert.rejects(decodeShared(bomb), /too big to open/);
  assert.ok(Date.now() - t0 < 3000, 'refused without building it');

  // Under the inflate limit but over the point count.
  const many = await forgeLink({ kind: 'trail', trail: { lat: zeros(30000, 51200000), lon: zeros(30000, -2600000) },
    track: { lat: zeros(30000, 51200000), lon: zeros(30000, -2600000) } });
  await assert.rejects(decodeShared(many), /too big to open/);

  // A code longer than any link this app makes is not even inflated.
  await assert.rejects(decodeShared('TS1.' + 'A'.repeat(70000)), /too big to open/);

  // Crossing trails by the hundred.
  await assert.rejects(decodeShared(await forgeLink({ kind: 'trail', trail: twoPts,
    contam: Array.from({ length: 60 }, () => twoPts) })), /too big to open/);
});

await t('a run too long for a link is refused where the link is made, not where it is opened', async () => {
  /* Hides are never thinned, so enough of them scattered at random cannot be
     squeezed under the limit however hard the lines are thinned. */
  const hides = Array.from({ length: 20000 }, () => ({ lat: 51.2 + rnd() * 0.02, lon: -2.6 + rnd() * 0.02 }));
  const m = { kind: 'search', target: 'A hide', hides, contamination: [], wps: [], plan: false, walked: false };
  await assert.rejects(encodeShared(m), /too long for a link\. Save it as a GPX file instead/);
});

await t('point indexes from a link cannot reach the prototype, or throw a raw error', async () => {
  const m = await decodeShared(await forgeLink({ kind: 'trail', trail: { ...twoPts,
    kd: [['__proto__', 'Indication'], ['length', 'x'], [1.5, 'x'], [-1, 'x'], [99, 'x'], 'junk', null, [0, 'Start'], [1, { toString: 1 }]],
    dw: [['__proto__', 9], ['length', 5], [1, 30]],
    cl: [['__proto__', 'sure', 1], ['constructor', 'sure', 1]] } }));
  assert.equal([].kind, undefined, 'Array.prototype.kind');
  assert.equal([].dwellS, undefined, 'Array.prototype.dwellS');
  assert.equal([].call, undefined, 'Array.prototype.call');
  assert.deepEqual(Object.keys(Object.getPrototypeOf([])).filter(k => ['kind', 'dwellS', 'call'].includes(k)), []);
  const keys = [];
  for (const k in [1]) keys.push(k);
  assert.deepEqual(keys, ['0']);
  assert.equal(m.trail[0].kind, 'Start');
  assert.equal(m.trail[1].kind, undefined);
  assert.equal(m.trail[1].dwellS, 30);
  assert.equal(m.trail.length, 2);
});

await t('times from a link are kept to a real era, so Save GPX and Save PDF work', async () => {
  const m = await decodeShared(await forgeLink({
    kind: 'trail', laidAt: 9e15, runAt: -5,
    trail: { ...twoPts, t: [1e14, 1] },
    track: { ...twoPts, t: [Math.round(T0 / 1000), 2] },
    dog: { name: 'Bo', dob: 9e15 },
    debrief: { outcome: 'found', at: 9e15 },
  }));
  assert.equal(m.laidAt, null);
  assert.equal(m.runAt, null);
  assert.equal(m.trail[0].t, undefined, 'a time out of its era takes its column with it');
  assert.equal(m.track[1].t, T0 + 2000, 'a real clock is kept');
  assert.equal(m.dog.dob, undefined);
  assert.equal(m.debrief.at, null);
  assertWellFormed(toGpx(m));

  /* A run kept before links were checked still holds its impossible times;
     the file is made without them rather than not at all. */
  const old = { ...m, laidAt: 9e15, trail: m.trail.map(p => ({ ...p, t: 1e17 })),
    track: m.track.map(p => ({ ...p, t: -1e17 })) };
  const gpx = toGpx(old);
  assert.doesNotMatch(gpx, /<time>/);
  assertWellFormed(gpx);
});

await t('a live run from someone else is held to the same checks as a link', () => {
  const m = liveModel({
    kind: 'search', target: 'A hide', laidAt: 9e15, startedAt: T0,
    hides: [{ lat: 51.2, lon: -2.6 }],
    dog: { name: { evil: 1 }, breed: '<b>Mal</b>' },
    wx: { wind_speed: '<img>', temp: 9 },
    result: { kind: 'search', sentence: 'Found', approach: '<img src=x onerror=alert(1)>', ageMin: 3 },
  }, [[{ lat: 51.2, lon: -2.6, t: T0 }], [{ lat: 51.2001, lon: -2.6, t: T0 + 1000 }]]);
  assert.equal(m.laidAt, null);
  assert.equal(m.runAt, T0);
  assert.equal(m.dog.name, undefined);
  assert.equal(m.wx.wind_speed, undefined);
  assert.equal(m.wx.temp, 9);
  assert.equal(m.result.approach, null);
  assert.equal(m.result.ageMin, 3);
  assert.equal(m.track.length, 2);
});


/* The checkers' second round: what a link could still do after the first fix. */
await t('weather from a link keeps only real weather, so a kept run cannot jam the backup', async () => {
  const m = await decodeShared(await forgeLink({
    kind: 'trail', trail: twoPts,
    wx: { temp: 12, wind_speed: 3, humidity: 250, wind_direction: -40, '': 2, '__x__': 1, constructor: 4, toString: 5,
      series: [{ t: 1758000000000, temp: 11, '__name__': 1, '': 1 }] },
  }));
  assert.deepEqual(Object.keys(m.wx).sort(), ['series', 'temp', 'wind_speed'],
    'only the fields the app writes, each within what the air can do');
  assert.deepEqual(Object.keys(m.wx.series[0]).sort(), ['t', 'temp']);
});

await t('a link whose label says one thing and whose contents another is read by its contents', async () => {
  const hidesCalledTrail = await decodeShared(await forgeLink({ kind: 'trail', hides: oneHide }));
  assert.equal(hidesCalledTrail.kind, 'search', 'hides make a search, whatever the label says');
  const trailCalledSearch = await decodeShared(await forgeLink({ kind: 'search', trail: twoPts }));
  assert.equal(trailCalledSearch.kind, 'trail', 'a line makes a trail');
  await assert.rejects(decodeShared(await forgeLink({ kind: 'trail', trail: { lat: [51200000], lon: [-2600000] } })),
    'a single point is neither: refused, rather than crashing the screen that opens it');
});

await t('the encoder refuses exactly what the decoder would', async () => {
  /* A long walk back and forth over the same few metres packs small but holds
     more points than a link may carry. It used to make a link that then would
     not open. */
  const pts = Array.from({ length: 52000 }, (_, i) => ({ lat: 51.2 + (i % 2) * 1e-5, lon: -2.6, t: 1758000000000 + i * 1000 }));
  const model = trailModel({ ...session({ trailN: 3 }), data: { ...session({ trailN: 3 }).data, track: pts } }, people);
  await assert.rejects(encodeShared(model), /too long for a link/);
});

/* A run started too long after laying for the laid forecast to reach it has
   its own weather, fetched for the grade. A link carried only the laid one,
   so whoever opened it replayed the run in the wrong wind beside a result
   quoting the right one. */
await t('a link carries the run’s own weather, cut to the stretch the dog ran', async () => {
  const s = session({ trailN: 20, trackN: 60 });
  const from = s.data.trackStarted, to = s.data.track.at(-1).t;
  const series = Array.from({ length: 49 }, (_, i) => ({ t: from - 6 * 3600e3 + i * 15 * 60e3,
    wind_speed: 5.04, wind_direction: 90, temp: 8 }));
  s.data.runWeather = { time: '2026-09-16T13:30', wind_speed: 5.04, wind_direction: 90, temp: 8, series };
  const m = trailModel(s, people);
  assert.ok(m.runWx.series.length < 12, `only the run and a sample either side, got ${m.runWx.series.length}`);
  assert.ok(m.runWx.series[0].t <= from && m.runWx.series.at(-1).t >= to, 'every moment of the run is still inside it');
  const back = await decodeShared(await encodeShared(m));
  assert.equal(back.runWx.wind_direction, 90);
  assert.equal(back.runWx.wind_speed, 5, 'one decimal, as the laid weather');
  assert.equal(back.runWx.series.length, m.runWx.series.length);
  assert.equal(back.runWx.time, '2026-09-16T13:30');
  assert.equal((await decodeShared(await encodeShared(trailModel(session(), people)))).runWx, null,
    'a run the laid forecast reached has none to carry');
});

await t('the run’s weather from a link is held to exactly what the laid weather is', async () => {
  const m = await decodeShared(await forgeLink({
    kind: 'trail', trail: twoPts,
    runWx: { wind_speed: '<img src=x>', temp: 12, wind_direction: 400, '__x__': 1, note: '<b>hi</b>',
      series: Array.from({ length: 300 }, (_, i) => ({ t: T0 + i, wind_speed: i % 2 ? 'x' : 3, '': 1 })) },
  }));
  assert.deepEqual(Object.keys(m.runWx).sort(), ['series', 'temp'], 'only real weather, each within what the air can do');
  assert.ok(m.runWx.series.length <= 96, `series capped, got ${m.runWx.series.length}`);
  assert.ok(m.runWx.series.every(e => Object.keys(e).every(k => ['t', 'wind_speed'].includes(k))));
  assert.equal((await decodeShared(await forgeLink({ kind: 'trail', trail: twoPts, runWx: 'x' }))).runWx, null);
});

console.log(`\n${pass} passed total`);
