/* A synthetic but realistic trail pair, for showing the app without walking a
   field first. The dog track is derived from the runner track the way a real
   one is: it weaves across the scent, drifts downwind on open legs, overshoots
   corners, and casts back to re-find. */
import { project, dist } from './geo.js';

const LEGS = [   // [bearing°, metres] — a working trail with four turns
  [70, 180], [150, 120], [60, 200], [340, 140], [20, 160],
];
const START = { lat: 51.2150, lon: -2.6520 };   // open ground north-west of Wells
const STEP = 8;                                  // metres between fixes
const RUNNER_MS = 1.35;                          // walking pace

export function runnerTrail(laidAt, start = START, totalM = 800, baseAlt = 92) {
  const raw = LEGS.reduce((s, [, l]) => s + l, 0);
  const scale = totalM / raw;                       // keep the shape, set the length
  const pts = [];
  let cur = { ...start }, t = laidAt;
  pts.push({ ...cur, t, acc: 6, alt: baseAlt });
  for (const [brg, len] of LEGS) {
    const legM = len * scale;
    let walked = 0;
    while (walked < legM - 1e-9) {
      const step = Math.min(STEP, legM - walked);   // partial last step, so the
      cur = project(cur, brg, step);                // total length is exact
      walked += step;
      t += (step / RUNNER_MS) * 1000;
      pts.push({ ...cur, t, acc: 5 + Math.random() * 4, alt: baseAlt + Math.sin(walked / 40) * 6 });
    }
  }
  return pts;
}

/** Bearing from a to b, degrees. */
function bearing(a, b) {
  const y = Math.sin((b.lon - a.lon) * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180);
  const x = Math.cos(a.lat * Math.PI / 180) * Math.sin(b.lat * Math.PI / 180)
    - Math.sin(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.cos((b.lon - a.lon) * Math.PI / 180);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

export function dogTrail(runner, workedAt, windFromDeg) {
  const downwind = ((windFromDeg ?? 0) + 180) % 360;
  const out = [];
  let t = workedAt;
  const DOG_MS = 1.15;   // slower — the dog works, casts, checks
  const overshootAt = Math.floor(runner.length * 0.55);

  for (let i = 0; i < runner.length; i++) {
    const a = runner[i], b = runner[Math.min(i + 1, runner.length - 1)];
    const hdg = i < runner.length - 1 ? bearing(a, b) : bearing(runner[i - 1], a);

    // Weave across the scent: two out-of-phase sines so it never looks periodic.
    const weave = Math.sin(i / 3.1) * 3.4 + Math.sin(i / 7.7) * 2.2;
    let p = project(a, (hdg + 90) % 360, weave);

    // Scent has drifted downwind, so the dog works slightly off the true line.
    p = project(p, downwind, 2.5 + Math.sin(i / 11) * 1.8);

    t += (dist(out[out.length - 1] || p, p) / DOG_MS) * 1000 + 900;
    out.push({ ...p, t, acc: 6 + Math.random() * 5, alt: a.alt });

    // Partway along, the dog overruns a corner, casts, and re-finds.
    if (i === overshootAt) {
      let q = p;
      for (let k = 0; k < 6; k++) {
        q = project(q, hdg, 3.5);
        t += 2600;
        out.push({ ...q, t, acc: 9, alt: a.alt });
      }
      for (let k = 0; k < 5; k++) {
        q = project(q, (hdg + 200) % 360, 3.2);
        t += 2400;
        out.push({ ...q, t, acc: 8, alt: a.alt });
      }
    }
  }
  return out;
}

export function buildDemo(now = Date.now(), opts = {}) {
  const {
    start = START, totalM = 800, baseAlt = 92,
    laidMinsAgo = 95, workedMinsAgo = 18,
  } = opts;
  const laidAt = now - laidMinsAgo * 60 * 1000;
  const workedAt = now - workedMinsAgo * 60 * 1000;
  return { laidAt, workedAt, runner: runnerTrail(laidAt, start, totalM, baseAlt) };
}
