/* Fixed plume scenes, for proving a speed-up changed nothing.

   The plume's hot loop is worth making cheaper, and every such change must
   leave every parcel exactly where it was. These scenes lay the same parcels
   every time (a seeded Math.random), drive them across open ground, a hill in
   stable air, and a street of houses with building wakes and the tarmac rule,
   and read back where each parcel is and how strong. plume-golden.json holds
   what the model drew before the allocation work; field.test.mjs compares.

   If the scent physics is changed ON PURPOSE, the golden file is meant to
   move with it: regenerate it with `node test/plume-scenes.mjs --write` and
   say in the commit why the plume moved. */

import { writeFileSync } from 'node:fs';
import { FLAT, buildTerrain, stability } from '../public/field.js';
import { ScentSim, driftFrom, predictedOffsets } from '../public/sim.js';
import { wallIndex } from '../public/walls.js';
import { applyPreset, resetParams, setParam } from '../public/params.js';

const WELLS = { lat: 51.2094, lon: -2.6449 };
const BBOX = { west: -2.6500, east: -2.6398, north: 51.2140, south: 51.2048 };
const t0 = Date.parse('2026-08-24T07:00:00Z');
/* Positions in units of 1e-8° from Wells (about a millimetre), strengths in
   millionths: fine enough to catch any real change, coarse enough to absorb
   the last bits of floating point. */
const Q = 1e8, QS = 1e6;

function seeded(s) {
  let a = s | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hill() {
  const n = 24, h = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = i / (n - 1) - 0.5, y = j / (n - 1) - 0.5;
    h[j * n + i] = 30 * Math.exp(-(x * x + y * y) / 0.06) + 4 * Math.sin(x * 7);
  }
  return buildTerrain(h, n, 40, BBOX);
}

function street() {
  const KX = 111320 * Math.cos((WELLS.lat * Math.PI) / 180);
  const list = [];
  for (let k = 0; k < 6; k++) {
    const x0 = k * 30 - 20, y0 = k === 1 ? 3 : k % 2 ? 12 : -28;   // the second stands on the trail
    const ring = [[x0, y0], [x0 + 16, y0], [x0 + 16, y0 + 14], [x0, y0 + 14], [x0, y0]]
      .map(([x, y]) => [WELLS.lon + x / KX, WELLS.lat + y / 111320]);
    list.push({ rings: [ring], h: k === 2 ? null : 7 });
  }
  return wallIndex(list, WELLS);
}

/* Twelve points eastward, one a four-minute stand and two on tarmac. In the
   street scene five of them fall inside a house, which moves them out. */
const trail = Array.from({ length: 12 }, (_, i) => ({
  lat: WELLS.lat + Math.sin(i / 3) * 6e-5, lon: WELLS.lon + i * 4e-5, t: t0 + i * 20000,
  ...(i === 5 ? { dwellS: 240 } : {}), ...(i === 8 || i === 9 ? { hard: true } : {}),
}));

const q = (p) => [Math.round((p.lat - WELLS.lat) * Q), Math.round((p.lon - WELLS.lon) * Q)];
const cloud = (sim) => sim.drawable().flatMap(s => [...q(s), Math.round(s.str * QS)]);

const SCENES = {
  open(out) {
    const wx = { wind_speed: 4, wind_gusts: 7, wind_direction: 250 };
    const sim = new ScentSim().seed(trail);
    sim.advance(FLAT, wx, stability(12, 12), t0 + 150000);          // mid-lay
    out.mid = cloud(sim);
    sim.advance(FLAT, wx, stability(12, 12), t0 + 40 * 60000);      // worked later
    out.late = cloud(sim);
    // Still air, a zero budget and a negative one: the edges driftFrom guards.
    out.edges = [
      ...q(driftFrom(FLAT, WELLS, 30, { wind_speed: 0, wind_direction: 90 }, null)),
      ...q(driftFrom(FLAT, WELLS, 0, wx, null)), ...q(driftFrom(FLAT, WELLS, -5, wx, null)),
      ...q(driftFrom(null, WELLS, 12, wx, null)), ...q(driftFrom(FLAT, WELLS, 40, wx, null, 3)),
    ];
  },
  hill(out) {
    const T = hill();
    const wx = { wind_speed: 1.5, wind_gusts: 2.6, wind_direction: 20 };
    const st = stability(8, 11.5);                                    // stable: drainage and creep
    const sim = new ScentSim().seed(trail);
    sim.advance(T, wx, st, t0 + 25 * 60000);
    out.late = cloud(sim);
    out.offsets = predictedOffsets(T, trail, wx, st, t0 + 25 * 60000)
      .flatMap(o => [...q(o.to), Math.round(o.metres * 1e4), Math.round((o.bearing ?? -1) * 1e4)]);
    out.convective = q(driftFrom(T, trail[3], 50, wx, stability(20, 11)));
  },
  street(out) {
    applyPreset('wakeRule');                     // resets every dial, so the pool is set again
    setParam('poolParts', 100);
    setParam('hardCarry', 1.4); setParam('hardGive', 0.7); setParam('hardWiden', 1.5);
    const T = hill();
    const W = street();
    const wx = { wind_speed: 5, wind_gusts: 9, wind_direction: 200 };
    const st = stability(15, 13);
    const sim = new ScentSim().seed(trail);
    sim.walls = W;
    sim.advance(T, wx, st, t0 + 12 * 60000);
    out.late = cloud(sim);
    out.walled = [...q(driftFrom(T, trail[4], 60, wx, st, 5, W)), ...q(driftFrom(T, trail[4], 60, wx, st, 3, W))];
  },
};

/** Every scene's numbers, laid from the same seed each time. */
export function scenes() {
  const real = Math.random;
  const out = {};
  try {
    for (const [name, run] of Object.entries(SCENES)) {
      resetParams();
      setParam('poolParts', 100);                  // the smallest pool the bench allows keeps this file small
      Math.random = seeded(name.length * 7919);
      run(out[name] = {});
    }
  } finally {
    Math.random = real;
    resetParams();
  }
  return out;
}

if (process.argv.includes('--write')) {
  writeFileSync(new URL('./plume-golden.json', import.meta.url), JSON.stringify(scenes()) + '\n');
  console.log('wrote test/plume-golden.json');
}
