/* How much one plume frame costs, and how much garbage it leaves.

   The live plume advances every parcel every 400 ms. On a desktop the time
   is small; on a phone the time AND the collections it causes are what make
   panning stutter, so this counts both. Run from the repo root:

     node scripts/bench-plume.mjs            all three grounds
     node scripts/bench-plume.mjs terrain    one of flat | terrain | walls

   Young-generation collections are counted with a PerformanceObserver, so
   `node --trace-gc` is not needed, though it agrees. Not a test: timings move
   with the machine, and nothing here should fail a build. */

import { PerformanceObserver, performance, constants } from 'node:perf_hooks';
import { FLAT, buildTerrain, stability } from '../public/field.js';
import { ScentSim } from '../public/sim.js';
import { wallIndex } from '../public/walls.js';
import { applyPreset, resetParams } from '../public/params.js';

// A fixed stream of randomness, so every run lays the same parcels.
let a = 0x2f6b1d;
Math.random = () => {
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const WELLS = { lat: 51.2094, lon: -2.6449 };
const BBOX = { west: -2.6600, east: -2.6300, north: 51.2200, south: 51.2000 };
const t0 = Date.parse('2026-08-24T07:00:00Z');

// 1,386 trail points × 7 specks ≈ 9,700 parcels, the size a long live lay reaches.
const trail = Array.from({ length: 1386 }, (_, i) => ({
  lat: WELLS.lat + Math.sin(i / 90) * 4e-4, lon: WELLS.lon + i * 1.4e-5, t: t0 + i * 2000,
}));
const wx = { wind_speed: 4, wind_gusts: 7, wind_direction: 250, temp: 14, soil_temp: 12, humidity: 70 };
const st = stability(12, 14);

function hill() {
  const n = 64, h = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = i / (n - 1) - 0.5, y = j / (n - 1) - 0.5;
    h[j * n + i] = 40 * Math.exp(-(x * x + y * y) / 0.05) + 6 * Math.sin(x * 9);
  }
  return buildTerrain(h, n, 30, BBOX);
}

function houses() {
  const KX = 111320 * Math.cos((WELLS.lat * Math.PI) / 180);
  const list = [];
  for (let k = 0; k < 40; k++) {
    const x0 = k * 45 - 60, y0 = (k % 2 ? 25 : -45);
    const ring = [[x0, y0], [x0 + 18, y0], [x0 + 18, y0 + 14], [x0, y0 + 14], [x0, y0]]
      .map(([x, y]) => [WELLS.lon + x / KX, WELLS.lat + y / 111320]);
    list.push({ rings: [ring], h: 8 });
  }
  return wallIndex(list, WELLS);
}

const grounds = {
  flat: () => ({ T: FLAT, walls: null }),
  terrain: () => ({ T: hill(), walls: null }),
  walls: () => { applyPreset('wakeRule'); return { T: hill(), walls: houses() }; },
};

let minor = 0;
new PerformanceObserver(list => {
  for (const e of list.getEntries()) if (e.detail?.kind === constants.NODE_PERFORMANCE_GC_MINOR) minor++;
}).observe({ entryTypes: ['gc'] });

const pick = process.argv[2];
for (const [name, make] of Object.entries(grounds)) {
  if (pick && pick !== name) continue;
  resetParams();
  const { T, walls } = make();
  const sim = new ScentSim().seed(trail);
  sim.walls = walls;
  const end = trail[trail.length - 1].t;
  for (let i = 0; i < 5; i++) sim.advance(T, wx, st, end + i * 400);     // warm the JIT
  await new Promise(r => setTimeout(r, 50));                              // let warm-up GCs report
  minor = 0;
  const N = 20;
  const start = performance.now();
  for (let i = 0; i < N; i++) sim.advance(T, wx, st, end + (5 + i) * 400);
  const ms = (performance.now() - start) / N;
  await new Promise(r => setTimeout(r, 50));
  console.log(`${name.padEnd(8)} ${sim.parts.length + sim.pool.length} parcels  ${ms.toFixed(1)} ms/advance  `
    + `${(minor / N).toFixed(1)} minor GCs/advance`);
}
