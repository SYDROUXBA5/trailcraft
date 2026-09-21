import assert from 'node:assert/strict';
import { decodeTile, tileOf, tileBox } from '../public/mvt.js';
import { SURFACES, buildGround, surfaceAt, surfaceAlong, surfaceRows, withSurface,
         tilesCovering, isHard, GROUND_LAYERS, aroundAt, GROUND_V, GROUND_RULES,
         readingSig, readingFits, readingVersion, groundPrint,
         CONDITIONS, blankSeen, cleanSeen, seenLine,
         FIX_AS, alongOf, idxAt, makeFix, fixSpan, applyFixes, stretchMetres } from '../public/ground.js';
import { PV, setParam, resetParams, applyPreset, PRESETS, presetById, dialById, DEFAULTS } from '../public/params.js';
import { project, dist, densify, scentField } from '../public/geo.js';
import { ScentSim } from '../public/sim.js';
import { FLAT, stability } from '../public/field.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log(`  ok  ${name}`); };

/* ── A vector tile, written by hand, so the reader is tested against the
   format and not against a file borrowed from a map company. ── */
const V = (n) => { const out = []; while (n > 127) { out.push((n % 128) | 128); n = Math.floor(n / 128); } out.push(n); return out; };
const zz = (n) => (n < 0 ? -2 * n - 1 : 2 * n);
const field = (tag, wire, bytes) => [...V(tag * 8 + wire), ...bytes];
const blob = (tag, bytes) => field(tag, 2, [...V(bytes.length), ...bytes]);
const str = (tag, s) => blob(tag, [...new TextEncoder().encode(s)]);
const pen = (...moves) => moves.flatMap(([cmd, ...pts]) =>
  cmd === 7 ? [15] : [(pts.length << 3) | cmd, ...pts.flatMap(([dx, dy]) => [zz(dx), zz(dy)])]);
const feature = (type, tags, cmds) => blob(2, [
  ...field(1, 0, V(900719925)),                        // an id, which the reader has no use for
  ...blob(2, tags.flatMap(V)), ...field(3, 0, V(type)), ...blob(4, cmds.flatMap(V)),
]);
const layer = (name, feats, keys, values) => blob(3, [
  ...field(15, 0, V(2)), ...str(1, name), ...feats.flat(),
  ...keys.flatMap(k => str(3, k)), ...values.flatMap(v => blob(4, str(1, v))), ...field(5, 0, V(4096)),
]);

const Z = 15, X = 16143, Y = 10939;                    // the tile Wells sits in
const square = pen([1, [1000, 1000]], [2, [2000, 0], [0, 2000], [-2000, 0]], [7]);
const tileBytes = new Uint8Array([
  ...layer('poi_label', [feature(1, [0, 0], pen([1, [5, 5]]))], ['name'], ['ignored']),
  ...layer('landuse', [feature(3, [0, 0], square)], ['class'], ['wood']),
  ...layer('road', [feature(2, [0, 0, 1, 1], pen([1, [0, 2000]], [2, [4096, 0], [0, 10]]))], ['class', 'surface'], ['street', 'paved']),
]);

t('vector tile: wanted layers come out with their properties and geometry, the rest is skipped', () => {
  const tile = decodeTile(tileBytes, Z, X, Y, { landuse: ['class'], road: ['class', 'surface'] });
  assert.deepEqual(Object.keys(tile).sort(), ['landuse', 'road']);
  const wood = tile.landuse[0];
  assert.equal(wood.type, 3);
  assert.deepEqual(wood.props, { class: 'wood' });
  assert.equal(wood.geom.length, 1);
  assert.equal(wood.geom[0].length, 5, 'four corners and the closing point');
  assert.deepEqual(wood.geom[0][0], wood.geom[0][4]);
  const road = tile.road[0];
  assert.equal(road.type, 2);
  assert.deepEqual(road.props, { class: 'street', surface: 'paved' });
  assert.equal(road.geom[0].length, 3);

  const [w, s, e, n] = tileBox(Z, X, Y);
  for (const [lon, lat] of wood.geom[0]) assert.ok(lon > w && lon < e && lat > s && lat < n, 'inside its own tile');
  // The square runs from a quarter to three quarters of the tile, so its first corner is a quarter of the way in.
  assert.ok(Math.abs(wood.geom[0][0][0] - (w + (e - w) * 1000 / 4096)) < 1e-9);
  assert.deepEqual(tileOf(51.2092, -2.6466, 15), { z: 15, x: X, y: Y });
  assert.deepEqual(decodeTile(new Uint8Array(0), Z, X, Y, { landuse: [] }), {}, 'an empty tile is an empty answer');
});

/* ── Ground rules, on a small made-up parish. Boxes are [lon, lat] rings. ── */
const O = { lat: 51.2, lon: -2.6 };
const at = (east, north) => { const p = project(project(O, 90, east), 0, north); return { lat: p.lat, lon: p.lon }; };
const ring = (x0, y0, x1, y1) => [[at(x0, y0), at(x1, y0), at(x1, y1), at(x0, y1), at(x0, y0)].map(p => [p.lon, p.lat])];
const poly = (cls, ...r) => ({ type: 3, props: { class: cls }, geom: ring(...r) });
const lineF = (props, ...pts) => ({ type: 2, props, geom: [pts.map(([x, y]) => { const p = at(x, y); return [p.lon, p.lat]; })] });
const everywhere = [-3, 51, -2, 52];

const parish = () => buildGround([
  { kind: 'streets', box: everywhere,
    landuse: [poly('residential', 0, 0, 400, 400), poly('park', 100, 100, 200, 200), poly('wood', 500, 0, 900, 400),
              poly('agriculture', 0, 500, 400, 900), poly('parking', 1000, 800, 1100, 900)],
    building: [{ type: 3, props: {}, geom: ring(20, 20, 40, 40) }],
    water: [{ type: 3, props: {}, geom: ring(400, 0, 440, 400) }],
    road: [lineF({ class: 'street' }, [700, -50], [700, 450]),                       // a lane through the wood
           lineF({ class: 'primary', structure: 'bridge' }, [350, 200], [500, 200]), // a bridge over the river
           lineF({ class: 'path', type: 'footway' }, [600, -50], [600, 450]),         // an earth path in the wood
           lineF({ class: 'path', type: 'footway', surface: 'paved' }, [150, 90], [150, 210]),
           lineF({ class: 'street', structure: 'tunnel' }, [800, -50], [800, 450])] },
  { kind: 'terrain', box: everywhere, landcover: [poly('grass', 1000, 0, 1400, 400)] },
]);

t('ground: sealed roads first, then what the map drew, most specific first, then the coarse cover', () => {
  const g = parish();
  assert.equal(surfaceAt(g, at(300, 300)), 'u', 'a housing area says where, not what: the lawn or the drive is not known');
  assert.equal(surfaceAt(g, at(120, 180)), 'g', 'a park inside it is grass');
  assert.equal(surfaceAt(g, at(30, 30)), 'u', 'a building is something passed, not ground underfoot');
  assert.equal(surfaceAt(g, at(1050, 850)), 'h', 'a car park is sealed ground the map actually drew');
  assert.equal(surfaceAt(g, at(550, 200)), 'w');
  assert.equal(surfaceAt(g, at(703, 200)), 'h', 'a tarmac lane through the wood is still tarmac');
  assert.equal(surfaceAt(g, at(712, 200)), 'w', 'and a dozen metres off it is wood again');
  assert.equal(surfaceAt(g, at(601, 200)), 'w', 'an earth path in a wood is the wood');
  assert.equal(surfaceAt(g, at(800, 200)), 'w', 'a road in a tunnel is not on the ground');
  assert.equal(surfaceAt(g, at(151, 150)), 'h', 'a path the map says is paved');
  assert.equal(surfaceAt(g, at(420, 100)), 'a', 'the river');
  assert.equal(surfaceAt(g, at(420, 200)), 'h', 'the bridge over it, not the water under it');
  assert.equal(surfaceAt(g, at(200, 700)), 'c');
  assert.equal(surfaceAt(g, at(1200, 200)), 'g', 'open country falls back on the coarse land cover');
  assert.equal(surfaceAt(g, at(1200, 700)), 'u', 'blank on both maps is Not mapped — never tarmac by default');
});

t('surroundings are measured apart from the ground', () => {
  const g = parish();
  assert.equal(aroundAt(g, at(300, 300)), true, 'inside a housing area');
  assert.equal(aroundAt(g, at(120, 180)), true, 'a park in a town is grass underfoot AND built-up around');
  assert.equal(aroundAt(g, at(30, 30)), true, 'a building');
  assert.equal(aroundAt(g, at(550, 200)), false, 'the wood');
  assert.equal(aroundAt(g, at(1050, 850)), false, 'a car park on its own is ground, not a zone');
  assert.equal(aroundAt(null, at(0, 0)), false);

  // 100 m through the estate, clear of the park: all built-up, none of it known underfoot.
  const pts = [250, 300, 350].map((x, i) => ({ ...at(x, 300), t: i * 30000 }));
  const r = surfaceAlong(g, pts);
  assert.ok(Math.abs(r.around - 100) < 1, `${r.around} m through built-up surroundings`);
  assert.equal(r.metres.h, undefined, 'and none of it counted as tarmac');
  assert.ok(Math.abs(r.metres.u - 100) < 1, 'it is Not mapped');
  assert.equal(surfaceAlong(g, []).around, 0);
});

t('a reading carries the rules it was made under, and an old one still fits', () => {
  assert.equal(GROUND_V, 2);
  for (const v of [1, 2]) assert.ok(GROUND_RULES[v]?.length > 20, `rules v${v} are written down`);
  const trail = [at(0, 0), at(50, 0), at(100, 0)];
  const letters = 'ggg';
  /* Exactly the signature the app wrote before rules had a version of their own. */
  const v1 = `1:${trail.length}:${trail[0].lat.toFixed(5)},${trail[0].lon.toFixed(5)}:${trail[2].lat.toFixed(5)},${trail[2].lon.toFixed(5)}`;
  assert.equal(readingFits({ trail, surf: letters, surfSig: v1 }), true, 'a reading saved before this change still fits');
  assert.equal(readingVersion({ surfSig: v1 }), 1, 'and knows it was read under rules v1');
  assert.equal(readingSig(trail), `2:${groundPrint(trail)}`);
  assert.equal(readingVersion({ surfSig: readingSig(trail) }), 2);
  assert.equal(readingFits({ trail, surf: letters, surfSig: readingSig(trail) }), true);

  const walked = [at(0, 0), at(40, 10), at(100, 0)].map(p => ({ ...p, lat: p.lat + 0.0001 }));
  assert.equal(readingFits({ trail: walked, surf: letters, surfSig: v1 }), false, 'not once the trail is replaced');
  assert.equal(readingFits({ trail, surf: 'gg', surfSig: v1 }), false, 'nor with the wrong number of letters');
  assert.equal(readingFits({ trail, surf: letters }), false);
  assert.equal(readingFits(null), false);
  assert.equal(readingVersion({}), null);
});

t('ground: a blank is Not mapped whether or not the tiles loaded', () => {
  const streetsOnly = buildGround([{ kind: 'streets', box: everywhere, landuse: [poly('wood', 0, 0, 100, 100)] }]);
  assert.equal(surfaceAt(streetsOnly, at(50, 50)), 'w');
  assert.equal(surfaceAt(streetsOnly, at(500, 500)), 'u');
  assert.equal(surfaceAt(buildGround([]), at(0, 0)), 'u');
  assert.equal(surfaceAt(null, at(0, 0)), 'u');
});

t('ground along a trail: metres per surface, and a road crossed between two fixes is still counted', () => {
  const g = parish();
  // West to east through the wood at walking-fix spacing of 25 m: 640 → 760, the lane is at 700 ± 6.5.
  const pts = [640, 665, 690, 715, 740, 760].map((x, i) => ({ ...at(x, 200), t: i * 20000 }));
  const { letters, metres } = surfaceAlong(g, pts);
  assert.equal(letters.length, pts.length);
  assert.equal(letters, 'wwwwww', 'no fix happened to land on the lane…');
  assert.ok(Math.abs(metres.h - 13) <= 3, `…but its ${metres.h} m are in the total`);
  assert.ok(Math.abs(metres.w + metres.h - 120) < 1, 'and everything adds up to the length of the trail');

  const rows = surfaceRows(metres);
  assert.deepEqual(rows.map(r => r.id), ['w', 'h'], 'longest first');
  assert.equal(rows[0].label, 'Woods');
  assert.ok(Math.abs(rows.reduce((a, r) => a + r.share, 0) - 1) < 1e-9);
  assert.deepEqual(surfaceRows({}), []);
  assert.deepEqual(surfaceRows(undefined), []);
});

t('ground along a trail: one stray sample at an edge is the GPS, three in a row is a road', () => {
  // A ground that answers 'h' for exactly one 2 m sample: a 1 m wide sliver of paved path crossed square on.
  const sliver = buildGround([{ kind: 'streets', box: everywhere,
    landuse: [poly('grass', 0, 0, 200, 200)],
    road: [] }]);
  sliver.areas.unshift({ rank: 0, as: 'h', rings: ring(99.5, 0, 100.5, 200), box: [-3, 51, -2, 52] });
  const pts = [80, 120].map((x, i) => ({ ...at(x, 100), t: i * 30000 }));
  const { metres } = surfaceAlong(sliver, pts);
  assert.equal(metres.h, undefined, 'a single sample between two of grass is smoothed away');
  assert.ok(Math.abs(metres.g - 40) < 0.5);
});

t('hard ground is marked, not scaled, and the saved trail is never written on', () => {
  assert.equal(isHard('h'), true);
  for (const x of SURFACES) if (x.id !== 'h') assert.equal(isHard(x.id), false, `${x.label} is not hard`);
  assert.equal(isHard('?'), false);
  for (const x of SURFACES) assert.equal(x.spread, undefined, `${x.label} carries no baked-in figure`);
  const pts = [at(0, 0), at(5, 0), at(10, 0)];
  const out = withSurface(pts, 'ghw');
  assert.equal(out[0], pts[0]);
  assert.equal(out[2], pts[2]);
  assert.equal(out[1].hard, true);
  assert.equal(pts[1].hard, undefined, 'the saved trail is not written on');
  assert.equal(withSurface(pts, 'gh'), pts, 'letters for another trail are ignored');
  assert.equal(withSurface(pts, null), pts);

  const dense = densify(pts.map((p, i) => ({ ...p, t: i * 5000, ...(i >= 1 ? { hard: true } : {}) })), 1);
  assert.ok(dense.filter(p => p.hard).length >= 6, 'points put in between two hard fixes are hard too');
  assert.ok(dense.slice(0, 3).every(p => !p.hard));
});

/* The ground under test: six fixes, the last three on tarmac. */
const wx = { wind_speed: 4, wind_direction: 0, wind_gusts: 4, temp: 12, soil_temp: 12 };
const base = [0, 10, 20, 30, 40, 50].map((x, i) => ({ ...at(x, 0), t: i * 8000 }));
const hard = base.map((p, i) => (i >= 3 ? { ...p, hard: true } : p));
const offM = (F, pts, i) => dist(pts[i], F[i].centre);

/** One parcel on grass and the identical parcel on tarmac, advanced together. */
function twin({ dwell = 0 } = {}) {
  const sim = new ScentSim().seed([{ ...at(0, 0), t: 0 }, { ...at(0, 0), t: 0, hard: true }]);
  for (const p of sim.parts) Object.assign(p, { phase: 0.5, life: 1, seed: 0, dwellS: dwell });
  sim.advance(FLAT, wx, stability(wx.soil_temp, wx.temp), 60000);
  const soft = sim.parts.find(p => !p.hard), firm = sim.parts.find(p => p.hard);
  const far = (p) => dist({ lat: p.hlat, lon: p.hlon }, p);
  return { soft, firm, far };
}

t('at the shipped dials, tarmac changes nothing at all', () => {
  resetParams();
  for (const id of ['hardHold', 'hardGive', 'hardCarry', 'hardWiden', 'hardDoubt']) {
    assert.equal(DEFAULTS[id], 1, `${id} ships at 1`);
  }
  const A = scentField(base, wx, 3600000), B = scentField(hard, wx, 3600000);
  for (let i = 0; i < base.length; i++) {
    assert.equal(B[i].halfWidth, A[i].halfWidth, `band width unchanged at ${i}`);
    assert.ok(Math.abs(offM(B, hard, i) - offM(A, base, i)) < 1e-9, `band offset unchanged at ${i}`);
  }
  const { soft, firm, far } = twin();
  assert.ok(far(soft) > 5, 'there is a drift to compare');
  assert.ok(Math.abs(far(firm) - far(soft)) < 1e-9, 'carried the same distance');
  assert.equal(firm.str, soft.str, 'drawn the same strength');
});

t('each ground dial moves its own part of the model and nothing else', () => {
  const A = scentField(base, wx, 3600000);
  const ref = twin();
  try {
    /* Transport: the band's offset and the parcel's travel, not the width. */
    resetParams(); setParam('hardCarry', 0.5);
    let B = scentField(hard, wx, 3600000);
    assert.ok(Math.abs(offM(B, hard, 4) - offM(A, base, 4) / 2) < 0.05, 'the band is carried half as far');
    assert.equal(B[4].halfWidth, A[4].halfWidth, 'carrying is not widening');
    assert.equal(B[1].halfWidth, A[1].halfWidth);
    let w = twin();
    assert.ok(Math.abs(w.far(w.firm) / w.far(w.soft) - 0.5) < 0.02, 'the parcel is carried half as far');

    /* Release: how strongly it draws, and nothing about where. */
    resetParams(); setParam('hardGive', 0.5);
    w = twin();
    assert.ok(Math.abs(w.firm.str / w.soft.str - 0.5) < 1e-9, 'drawn half as strong');
    assert.ok(Math.abs(w.far(w.firm) - w.far(w.soft)) < 1e-9, 'giving off is not carrying');

    /* Retention: how long it lasts, so a weaker parcel after a minute. */
    resetParams(); setParam('hardHold', 0.5);
    w = twin();
    assert.ok(w.firm.str < w.soft.str, 'holding less means fainter sooner');
    assert.ok(Math.abs(w.far(w.firm) - w.far(w.soft)) < 1e-9, 'and it is still carried the same way');

    /* Uncertainty: the band widens over ground the model understands less. */
    resetParams(); setParam('hardDoubt', 2);
    B = scentField(hard, wx, 3600000);
    assert.ok(Math.abs(B[4].halfWidth - A[4].halfWidth * 2) < 1e-9, 'twice as unsure is twice as wide');
    assert.ok(Math.abs(offM(B, hard, 4) - offM(A, base, 4)) < 1e-9, 'doubt does not move the band');
  } finally { resetParams(); }
  assert.deepEqual(twin().firm.str, ref.firm.str, 'and everything returns when the dials do');
});

t('uncertainty can only widen, even if a dial is forced below one', () => {
  assert.equal(dialById('hardDoubt').min, 1, 'the slider cannot go below 1');
  const A = scentField(base, wx, 3600000);
  try {
    PV.hardDoubt = 0.25;           // past the slider, straight into the live values
    const B = scentField(hard, wx, 3600000);
    assert.equal(B[4].halfWidth, A[4].halfWidth, 'the band never looks surer over tarmac');
  } finally { resetParams(); }
});

t('the tarmac rule is a named experiment: never the default, and never narrows the band', () => {
  const rule = presetById('tarmacRule');
  assert.ok(rule && PRESETS.includes(rule));
  assert.equal(presetById('nope'), null);
  assert.equal(applyPreset('nope'), false);
  for (const [k, v] of Object.entries(rule.set)) {
    const d = dialById(k);
    assert.ok(d, `${k} is a real dial`);
    assert.ok(v >= d.min && v <= d.max, `${k}=${v} is inside its slider`);
    assert.notEqual(v, DEFAULTS[k], `${k} is actually moved by the rule`);
  }
  assert.equal(rule.set.hardDoubt, undefined, 'the rule does not touch uncertainty');
  try {
    setParam('widthBase', 5);     // something else moved first
    assert.equal(applyPreset('tarmacRule'), true);
    assert.equal(PV.widthBase, DEFAULTS.widthBase, 'a preset starts from the defaults, not from whatever was left');
    assert.equal(PV.hardCarry, 0.5);
    const A = scentField(base, wx, 3600000), B = scentField(hard, wx, 3600000);
    assert.ok(B[4].halfWidth >= A[4].halfWidth, 'the band is no narrower than on grass');
    assert.ok(offM(B, hard, 4) < offM(A, base, 4), 'but it is carried less far, which is the rule');
  } finally { resetParams(); }
});

t('a pool on tarmac follows the same dials as the trail, and no longer draws brighter', () => {
  /* The same random draws for both, so the only difference is the ground. */
  const end = (h) => {
    const real = Math.random; let x = 42;
    Math.random = () => ((x = (x * 16807) % 2147483647) / 2147483647);
    try {
      const sim = new ScentSim().seed([{ ...at(0, 0), t: 0 }, { ...at(10, 0), t: 1000, dwellS: 0, ...(h ? { hard: true } : {}) }]);
      sim.advance(FLAT, wx, stability(wx.soil_temp, wx.temp), 600000);
      return sim.pool.map(p => p.str).reduce((a, b) => a + b, 0);
    } finally { Math.random = real; }
  };
  try {
    resetParams();
    assert.ok(Math.abs(end(true) - end(false)) < 1e-9, 'at the defaults a tarmac pool is an ordinary pool');
    setParam('hardGive', 0.5);
    const ratio = end(true) / end(false);
    assert.ok(Math.abs(ratio - 0.5) < 1e-9, `a weaker-giving surface gives a weaker pool (${ratio.toFixed(3)})`);
  } finally { resetParams(); }
});

t('conditions are what the handler saw, and only what the app offers', () => {
  assert.deepEqual(CONDITIONS.map(c => c.id), ['wet', 'sun'], 'wet or dry, and sun or shade — asked separately');
  for (const c of CONDITIONS) {
    assert.ok(c.options.length >= 3);
    assert.equal(new Set(c.options.map(o => o.v)).size, c.options.length);
  }
  /* Nothing here may be filled in from the forecast. */
  assert.ok(!/forecast|temperature|humidity|°/i.test(JSON.stringify(CONDITIONS)), 'no forecast words in what is asked');

  assert.deepEqual(blankSeen(), { v: 1, wet: null, sun: null });
  assert.equal(cleanSeen(blankSeen()), null, 'nothing recorded is not a record');
  assert.deepEqual(cleanSeen({ wet: 'wet', sun: 'shade' }), { v: 1, wet: 'wet', sun: 'shade' });
  assert.deepEqual(cleanSeen({ wet: 'soaking', sun: 'shade' }), { v: 1, wet: null, sun: 'shade' }, 'an unknown value is dropped');
  assert.equal(cleanSeen({ wet: '<b>', sun: 42 }), null);
  assert.equal(cleanSeen('wet'), null);
  assert.equal(cleanSeen(null), null);

  assert.equal(seenLine({ wet: 'wet', sun: 'shade' }), 'Wet, in shade', 'one sentence, so one capital');
  assert.equal(seenLine({ wet: null, sun: 'sun' }), 'In sun');
  assert.equal(seenLine({ wet: 'frozen' }), 'Frozen');
  assert.equal(seenLine(null), '');
});

/* ── Hand corrections ── */
const line = (n, step = 5, y = 0) => Array.from({ length: n }, (_, i) => at(i * step, y));   // n points, `step` m apart

t('a correction marks a stretch by place, and the map’s reading is never written on', () => {
  const t = line(41);                                    // 200 m, a point every 5 m
  const along = alongOf(t);
  assert.ok(Math.abs(along[40] - 200) < 0.5);
  assert.equal(idxAt(along, 52), 10);
  assert.ok(!FIX_AS.includes('u'), 'nothing is corrected TO "not mapped"');

  const f = makeFix(t, 50, 100, 'g', { note: 'x'.repeat(200), by: 'Rémi', at: 1000 });
  assert.equal(f.as, 'g');
  assert.equal(f.fromM, 50);
  assert.equal(f.toM, 100);
  assert.ok(Math.abs(f.from.lat - t[10].lat) < 1e-6 && Math.abs(f.to.lon - t[20].lon) < 1e-6, 'anchored to places');
  assert.equal(f.note.length, 80);
  assert.equal(f.by, 'Rémi');
  assert.deepEqual(makeFix(t, 100, 50, 'g', { at: 1000 }).fromM, 50, 'the ends can be given either way round');
  assert.equal(makeFix(t, 50, 100, 'u'), null, 'not to "not mapped"');
  assert.equal(makeFix(t, 50, 100, 'x'), null);
  assert.equal(makeFix(t, 50, 51, 'g'), null, 'a stretch has to have length');

  const map = 'u'.repeat(41);
  const r = applyFixes(t, map, [f]);
  assert.equal(r.letters.slice(10, 21), 'g'.repeat(11));
  assert.equal(r.letters.slice(0, 10), 'u'.repeat(10));
  assert.equal(r.by[15], f.id);
  assert.equal(r.by[5], null, 'the map still speaks for everything else');
  assert.deepEqual(r.off, []);
  assert.equal(map, 'u'.repeat(41), 'the stored reading is untouched');

  const hard = makeFix(t, 90, 150, 'h', { at: 2000 });
  const both = applyFixes(t, map, [f, hard]);
  assert.equal(both.letters[18], 'h', 'where two overlap, the later one wins');
  assert.equal(both.letters[12], 'g');
  assert.equal(applyFixes(t, null, [f]).letters.length, 41, 'no map reading: corrections still apply over "not mapped"');
});

t('a correction survives a walked card, and says so when it no longer fits', () => {
  const drawn = line(41);
  const f = makeFix(drawn, 50, 100, 'w', { at: 1000 });
  /* What was really walked: a slightly different line, with a different number of points. */
  const walked = Array.from({ length: 67 }, (_, i) => at(i * 3, 2.5));
  const sp = fixSpan(walked, f);
  assert.ok(sp, 'it still lands');
  assert.ok(Math.abs(alongOf(walked)[sp.i0] - 50) < 4 && Math.abs(alongOf(walked)[sp.i1] - 100) < 4,
    'on the same ground, not the same list positions');

  const elsewhere = Array.from({ length: 41 }, (_, i) => at(i * 5, 300));
  const r = applyFixes(elsewhere, null, [f]);
  assert.deepEqual(r.off, [f.id], 'reported as off this trail');
  assert.equal(r.letters, 'u'.repeat(41), 'and applied to nothing');
});

t('on a trail that doubles back, a correction finds the right pass', () => {
  /* Out 100 m east and back along the same line, 2 m to the side. */
  const out = Array.from({ length: 21 }, (_, i) => at(i * 5, 0));
  const back = Array.from({ length: 20 }, (_, i) => at(95 - i * 5, 2));
  const t = [...out, ...back];
  const f = makeFix(t, 130, 170, 'c', { at: 1000 });      // on the way back
  const sp = fixSpan(t, f);
  assert.ok(sp.i0 > 20 && sp.i1 > 20, `the return leg (indices ${sp.i0}–${sp.i1}), not the outward one`);
});

t('what the map said over a stretch, for "the map said X, you said Y"', () => {
  const t = line(11);                                   // 50 m
  const m = stretchMetres(t, 'uuuuuhhhhhh', 2, 8);      // 30 m
  assert.ok(Math.abs((m.u ?? 0) + (m.h ?? 0) - 30) < 0.5);
  assert.ok(m.u > 0 && m.h > 0);
  assert.deepEqual(stretchMetres(t, null, 0, 2), { u: 10 });
});

t('a stretch corrected to hard ground is what the tarmac dials see', () => {
  const t = line(21);
  const r = applyFixes(t, 'g'.repeat(21), [makeFix(t, 20, 60, 'h', { at: 1 })]);
  const marked = withSurface(t, r.letters);
  assert.ok(marked.slice(4, 13).every(p => p.hard), 'the corrected stretch is marked hard');
  assert.ok(!marked[0].hard && !marked[20].hard);
});

t('tiles for a trail: one fine tile for a short trail, coarser ones rather than dozens for a long one', () => {
  const short = [at(0, 0), at(300, 0)];
  const a = tilesCovering(short, tileOf);
  assert.ok(a.length >= 1 && a.length <= 4);
  assert.ok(a.every(x => x.z === 15));
  const long = [at(0, 0), at(9000, 6000)];
  const b = tilesCovering(long, tileOf);
  assert.ok(b.length <= 24 && b[0].z < 15, `${b.length} tiles at z${b[0].z}`);
  assert.deepEqual(tilesCovering([], tileOf), []);
  assert.deepEqual(Object.keys(GROUND_LAYERS), ['streets', 'terrain']);
});

console.log(`\n${pass} passed total\n`);
