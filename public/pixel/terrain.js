/* The landscape painter's tools: soft noise for the big tonal shapes, a
   small indexed pixel buffer that scenery is modelled in (so every pixel of
   a tree or a house is one of its ramp's five tones and nothing in between),
   the outline that goes on the shadow side only, cast shadows and pools of
   light. Nothing here knows which land it is painting. */

import { bayer, ctx2d, hash, hexToRgb, makeCanvas, R, smooth } from './core.js';

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

/* ── The indexed buffer ──
   A sprite is modelled as indices into a palette made of whole ramps laid
   end to end: index = ramp * 5 + tone. That is what lets the outline pass
   find "the ink of whatever this pixel borders" without being told. */

export function pix(w, h) { return { w, h, d: new Int8Array(w * h).fill(-1) }; }

export function pset(p, x, y, i) { if (x >= 0 && y >= 0 && x < p.w && y < p.h) p.d[y * p.w + x] = i; }

export function pget(p, x, y) { return x >= 0 && y >= 0 && x < p.w && y < p.h ? p.d[y * p.w + x] : -1; }

export function prect(p, x, y, w, h, i) {
  for (let yy = Math.max(0, y); yy < Math.min(p.h, y + h); yy++) for (let xx = Math.max(0, x); xx < Math.min(p.w, x + w); xx++) p.d[yy * p.w + xx] = i;
}

export function pell(p, cx, cy, rx, ry, i) {
  for (let y = -ry; y <= ry; y++) {
    const half = Math.floor(rx * Math.sqrt(Math.max(0, 1 - (y * y) / ((ry + 0.5) * (ry + 0.5)))));
    prect(p, cx - half, cy + y, half * 2 + 1, 1, i);
  }
}

export const pdisc = (p, cx, cy, r, i) => pell(p, cx, cy, r, r, i);

/** Rows of a sprite string into the buffer: each character names an index
    through `map`; '.' is clear. */
export function pstr(p, rows, x, y, map) {
  for (let j = 0; j < rows.length; j++) for (let i = 0; i < rows[j].length; i++) {
    const ch = rows[j][i];
    if (ch !== '.' && map[ch] !== undefined) pset(p, x + i, y + j, map[ch]);
  }
}

/**
 * A lit mass made of clumps: a canopy, a bush, a hedge top, a boulder.
 * blobs: [[x, y, r]]. Its outline is all of them together; inside, every
 * pixel is shaded partly as a point on the whole mass and partly as a point
 * on its own clump, lit from the upper left. That gives each clump a bright
 * crown and a dark underside where it meets the next, which is what makes a
 * tree read as leaves in bunches and not as a ball. `ramp` is the index of
 * the ramp's ink; the tones written are ramp+1 .. ramp+4.
 */
export function dome(p, blobs, ramp, o = {}) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const [x, y, r] of blobs) { x0 = Math.min(x0, x - r); y0 = Math.min(y0, y - r); x1 = Math.max(x1, x + r); y1 = Math.max(y1, y + r); }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = (x1 - x0) / 2 + 0.5, ry = (y1 - y0) / 2 + 0.5;
  const whole = o.whole === undefined ? 0.55 : o.whole, lift = o.lift || 0;
  for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) for (let x = Math.floor(x0); x <= Math.ceil(x1); x++) {
    let best = -1, bestK = 2;
    for (let b = 0; b < blobs.length; b++) {
      const q = blobs[b], dx = x - q[0], dy = y - q[1];
      const k = (dx * dx + dy * dy) / (q[2] * q[2] + q[2] * 0.8);
      if (k <= 1 && k < bestK) { bestK = k; best = b; }
    }
    if (best < 0) continue;
    const q = blobs[best];
    const g = -((x - cx) / rx * 0.62 + (y - cy) / ry * 0.78);
    const l = -((x - q[0]) / q[2] * 0.62 + (y - q[1]) / q[2] * 0.78);
    const v = g * whole + l * (1 - whole) + lift;
    const tone = v > 0.62 ? (o.glint === false ? 3 : 4) : v > 0.2 ? 3 : v > -0.34 ? 2 : 1;
    pset(p, x, y, ramp + tone);
  }
}

/**
 * The contour. Scenery is outlined on its shadow side and its foot only:
 * a clear pixel just right of, or just under, a filled one takes the ink of
 * the ramp it borders. With `full` the lit sides get the ramp's shade, for
 * small things that must stand off any ground (a sheep, a stone).
 */
export function rim(p, full) {
  const { w, h, d } = p, out = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (d[y * w + x] >= 0) continue;
    const l = x > 0 ? d[y * w + x - 1] : -1, u = y > 0 ? d[(y - 1) * w + x] : -1;
    if (l >= 0 || u >= 0) { const n = l >= 0 ? l : u; out.push(y * w + x, n - (n % 5)); continue; }
    if (!full) continue;
    const r = x < w - 1 ? d[y * w + x + 1] : -1, b = y < h - 1 ? d[(y + 1) * w + x] : -1;
    if (r >= 0 || b >= 0) { const n = r >= 0 ? r : b; out.push(y * w + x, n - (n % 5) + 1); }
  }
  for (let k = 0; k < out.length; k += 2) d[out[k]] = out[k + 1];
}

/** The buffer as a canvas, through a palette of hex colours. */
export function toCanvas(p, pal) {
  const c = makeCanvas(p.w, p.h), x = ctx2d(c);
  const img = x.createImageData(p.w, p.h), d = img.data;
  const rgb = pal.map(hexToRgb);
  for (let i = 0; i < p.d.length; i++) {
    const k = p.d[i];
    if (k < 0 || !rgb[k]) continue;
    d[i * 4] = rgb[k][0]; d[i * 4 + 1] = rgb[k][1]; d[i * 4 + 2] = rgb[k][2]; d[i * 4 + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  return c;
}

/** Ramps laid end to end: the palette a buffer's indices point into. */
export const palette = (...ramps) => [].concat(...ramps);

/* ── Shadows and light, drawn straight onto a board tile ── */

/**
 * A cast shadow: an ellipse lying on the ground, leaning down-right by
 * `lean` pixels a row, in whatever colour is set, with its edge thinned by
 * an ordered dither so it never ends on a hard line.
 */
export function castBlob(c, cx, cy, rx, ry, lean = 0) {
  for (let y = -ry; y <= ry; y++) {
    const half = rx * Math.sqrt(Math.max(0, 1 - (y * y) / ((ry + 0.5) * (ry + 0.5))));
    const x0 = R(cx - half + y * lean), x1 = R(cx + half + y * lean);
    if (x1 - x0 > 2) c.fillRect(x0 + 1, cy + y, x1 - x0 - 1, 1);
    if (bayer(x0, cy + y) < 0.5) c.fillRect(x0, cy + y, 1, 1);
    if (bayer(x1, cy + y) < 0.5) c.fillRect(x1, cy + y, 1, 1);
  }
}

/**
 * A pool of light on the ground: three rings, each adding a little more of
 * the lamp's colour, each ring's edge dithered into the next. Added, not
 * painted, so the cobbles and the grass still show through it.
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
