/* The landscape painter's tools: soft noise for the big tonal shapes, and
   pools of light. Nothing here knows which land it is painting. */

import { bayer, hash, R, smooth } from './core.js';

/* ── Noise ── */

/** Smooth noise from a lattice of repeatable numbers, 0..1. */
export function vnoise(x, y, cell, seed = 0) {
  const gx = Math.floor(x / cell), gy = Math.floor(y / cell);
  const fx = smooth(x / cell - gx), fy = smooth(y / cell - gy);
  const k = seed * 7919 + 13;
  const a = hash(gx * 374761 + gy * 668265 + k), b = hash((gx + 1) * 374761 + gy * 668265 + k);
  const c = hash(gx * 374761 + (gy + 1) * 668265 + k), d = hash((gx + 1) * 374761 + (gy + 1) * 668265 + k);
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}

/** Two octaves: a broad shape with a wandering edge. */
export const fbm = (x, y, cell, seed = 0) => 0.68 * vnoise(x, y, cell, seed) + 0.32 * vnoise(x + 31, y + 17, cell * 0.37, seed + 5);

/* ── Shadows and light, drawn straight onto a board tile ── */

/**
 * A pool of light on the ground: three rings, each adding a little more of
 * the lamp's colour, each ring's edge dithered into the next. Added, not
 * painted, so the tarmac and the grass still show through it.
 */
export function glow(c, cx, cy, rx, ry, rgb, strength = 1) {
  c.save();
  c.globalCompositeOperation = 'lighter';
  const col = `rgb(${R(rgb[0] * strength)},${R(rgb[1] * strength)},${R(rgb[2] * strength)})`;
  c.fillStyle = col;
  for (const k of [1, 0.68, 0.4]) {
    const ax = rx * k, ay = ry * k;
    for (let y = -Math.ceil(ay); y <= Math.ceil(ay); y++) {
      const span = Math.ceil(ax);
      let run = null;
      for (let x = -span; x <= span + 1; x++) {
        const dd = x <= span ? (x * x) / (ax * ax) + (y * y) / (ay * ay) : 9;
        const on = dd <= 0.72 || (dd <= 1 && bayer(cx + x, cy + y) < (1 - dd) / 0.28);
        if (on && run === null) run = x;
        if (!on && run !== null) { c.fillRect(cx + run, cy + y, x - run, 1); run = null; }
      }
    }
  }
  c.restore();
}
