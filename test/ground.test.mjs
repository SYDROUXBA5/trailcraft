import assert from 'node:assert/strict';
import { decodeTile, tileOf, tileBox } from '../public/mvt.js';
import { SURFACES, buildGround, surfaceAt, surfaceAlong, surfaceRows, withSpread,
         tilesCovering, spreadOf, GROUND_LAYERS } from '../public/ground.js';
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
              poly('agriculture', 0, 500, 400, 900)],
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
  assert.equal(surfaceAt(g, at(300, 300)), 'h', 'a housing estate is hard ground');
  assert.equal(surfaceAt(g, at(120, 180)), 'g', 'a park inside it is grass');
  assert.equal(surfaceAt(g, at(30, 30)), 'h', 'a building');
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
  assert.equal(surfaceAt(g, at(1200, 700)), 'h', 'blank on both maps is built-up ground');
});

t('ground: a blank only means town where both maps were loaded; otherwise it is not mapped', () => {
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

t('spread: only hard ground is marked, and everything else is handed back untouched', () => {
  assert.equal(spreadOf('h'), 0.5);
  for (const s of SURFACES) if (s.id !== 'h') assert.equal(s.spread, 1, `${s.label} spreads as normal`);
  assert.equal(spreadOf('?'), 1);
  const pts = [at(0, 0), at(5, 0), at(10, 0)];
  const out = withSpread(pts, 'ghw');
  assert.equal(out[0], pts[0]);
  assert.equal(out[2], pts[2]);
  assert.equal(out[1].spread, 0.5);
  assert.equal(pts[1].spread, undefined, 'the saved trail is not written on');
  assert.equal(withSpread(pts, 'gh'), pts, 'letters for another trail are ignored');
  assert.equal(withSpread(pts, null), pts);
});

t('the scent band and the plume are half as wide over hard ground, and unchanged everywhere else', () => {
  const wx = { wind_speed: 4, wind_direction: 0, wind_gusts: 4, temp: 12, soil_temp: 12 };
  const base = [0, 10, 20, 30, 40, 50].map((x, i) => ({ ...at(x, 0), t: i * 8000 }));
  const hard = base.map((p, i) => (i >= 3 ? { ...p, spread: 0.5 } : p));
  const A = scentField(base, wx, 3600000), B = scentField(hard, wx, 3600000);
  assert.equal(B[1].halfWidth, A[1].halfWidth);
  assert.ok(Math.abs(B[4].halfWidth - A[4].halfWidth / 2) < 1e-9);
  assert.ok(Math.abs(dist(hard[4], B[4].centre) - dist(base[4], A[4].centre) / 2) < 0.05);

  const dense = densify(hard, 2);
  assert.ok(dense.filter(p => p.spread === 0.5).length >= 10, 'the points put in between two hard fixes are hard too');
  assert.ok(dense.slice(0, 10).every(p => p.spread === undefined));

  const sim = new ScentSim().seed([{ ...at(0, 0), t: 0 }, { ...at(0, 0), t: 0, spread: 0.5 }]);
  for (const p of sim.parts) Object.assign(p, { phase: 0.5, life: 1, seed: 0 });     // the same parcel, twice
  sim.advance(FLAT, wx, stability(wx.soil_temp, wx.temp), 60000);
  const soft = sim.parts.find(p => p.spread === 1), firm = sim.parts.find(p => p.spread === 0.5);
  const far = (p) => dist({ lat: p.hlat, lon: p.hlon }, p);
  assert.ok(far(soft) > 5, 'there is a drift to halve');
  assert.ok(Math.abs(far(firm) / far(soft) - 0.5) < 0.02, `hard ground carried ${far(firm).toFixed(1)} m against ${far(soft).toFixed(1)} m`);
  assert.ok(Math.abs(firm.str / soft.str - 0.5) < 1e-9, 'and drawn half as strong, so the thinner band is not a brighter one');
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
