/* The painter the characters are made with. A character is not a picture
   that is copied: it is painted fresh for each pose from a few soft masses
   (balls, tapered limbs, flat shapes) laid on a sheet. The sheet does not
   hold colours. It holds, for each pixel, what the thing is made of (a
   material) and how the light sits on it (a tone, 0 ink to 4 glint), and the
   colours are only looked up at the end. That is what lets one drawing wear
   ten coats and eight jackets, and what keeps the light coming from above
   whichever way a limb is turned.

   Options a mass takes:
     m      the material it is made of
     t      one flat tone, instead of light from above
     lit    [a, b]: lighter above a, in shade below b, measured from -1 (its
            top) to 1 (its underside); [-2, 2] is flat
     under  only where the sheet is still empty (it goes behind)
     atop   only where something is already painted (a strap on a body)
     on     only over this material; with keep, the tone underneath stays,
            so a marking takes the modelling of the body it lies on
     edge   a crease of shade where it overlaps what was there before
     ink    with edge: the crease is the mass's own ink instead, so a strap
            keeps a dark line each side and reads on fur of its own colour */

import { ctx2d, hexToRgb, makeCanvas } from './core.js';

const LIT = [-0.5, 0.42];

/** A sheet to paint on. */
export function sheet(w, h) {
  const n = w * h;
  return { w, h, m: new Uint8Array(n), t: new Uint8Array(n), k: new Uint8Array(n), v: new Float32Array(n), cv: null, c: null, img: null };
}

export function wipe(B) { B.m.fill(0); B.t.fill(0); }

/** The material at a pixel (0 is bare sheet). */
export function matAt(B, x, y) {
  x = Math.round(x); y = Math.round(y);
  return x < 0 || y < 0 || x >= B.w || y >= B.h ? 0 : B.m[y * B.w + x];
}

/** One pixel, set outright. */
export function dot(B, x, y, m, t) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= B.w || y >= B.h) return;
  const i = y * B.w + x;
  B.m[i] = m; B.t[i] = t;
}

/** Change the tone of a pixel that is already painted (and, given m, only
    if it is that material): a fold, a lip, a closed eye. */
export function tint(B, x, y, t, m) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= B.w || y >= B.h) return;
  const i = y * B.w + x;
  if (!B.m[i] || (m && B.m[i] !== m)) return;
  B.t[i] = t;
}

/* Every mass is first marked on the sheet's scratch layer (k, with v the
   height of each pixel within the mass), then laid in one pass, so the
   options mean the same for a ball, a limb and a shape. */
function lay(B, x0, y0, x1, y1, o) {
  const w = B.w, lit = o.lit || LIT;
  x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(w - 1, x1); y1 = Math.min(B.h - 1, y1);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = y * w + x;
      if (B.k[i] !== 1) continue;
      const was = B.m[i];
      if ((o.under && was) || (o.atop && !was) || (o.on && was !== o.on)) { B.k[i] = 0; continue; }
      B.k[i] = 2;
      if (!(o.keep && was)) B.t[i] = o.t != null ? o.t : B.v[i] < lit[0] ? 3 : B.v[i] > lit[1] ? 1 : 2;
      B.m[i] = o.m;
    }
  }
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = y * w + x;
      if (B.k[i] !== 2) continue;
      if (o.edge) {
        // The crease falls on what lies underneath, beside and below the new
        // mass (never above it: light comes from there).
        for (const j of [i - 1, i + 1, i + w]) {
          if (j < 0 || j >= B.m.length || B.k[j] === 2 || !B.m[j]) continue;
          if (o.ink) { B.m[j] = o.m; B.t[j] = 0; }
          else if (B.t[j] > 1 && B.t[j] < 4) B.t[j] = 1;
        }
      }
    }
  }
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) B.k[y * w + x] = 0;
}

/** An ellipse, lit as a ball is: a cap of light, a cap of shade. */
export function ball(B, cx, cy, rx, ry, o) {
  const x0 = Math.floor(cx - rx), x1 = Math.ceil(cx + rx), y0 = Math.floor(cy - ry), y1 = Math.ceil(cy + ry);
  for (let y = Math.max(0, y0); y <= Math.min(B.h - 1, y1); y++) {
    for (let x = Math.max(0, x0); x <= Math.min(B.w - 1, x1); x++) {
      const dx = (x - cx) / rx, dy = (y - cy) / ry;
      if (dx * dx + dy * dy > 1) continue;
      const i = y * B.w + x;
      B.k[i] = 1; B.v[i] = dy;
    }
  }
  lay(B, x0, y0, x1, y1, o);
}

/** A tapered limb from a to b, ra thick at a and rb at b (half widths). Its
    light is judged across it, so a leg, a neck and a back are all lit on
    whichever side is uppermost. */
export function limb(B, a, b, ra, rb, o) {
  const r = Math.max(ra, rb) + 1;
  const x0 = Math.floor(Math.min(a[0], b[0]) - r), x1 = Math.ceil(Math.max(a[0], b[0]) + r);
  const y0 = Math.floor(Math.min(a[1], b[1]) - r), y1 = Math.ceil(Math.max(a[1], b[1]) + r);
  const ux = b[0] - a[0], uy = b[1] - a[1], len2 = ux * ux + uy * uy || 1;
  for (let y = Math.max(0, y0); y <= Math.min(B.h - 1, y1); y++) {
    for (let x = Math.max(0, x0); x <= Math.min(B.w - 1, x1); x++) {
      let k = ((x - a[0]) * ux + (y - a[1]) * uy) / len2;
      k = k < 0 ? 0 : k > 1 ? 1 : k;
      const px = a[0] + ux * k, py = a[1] + uy * k, rr = ra + (rb - ra) * k;
      const dx = x - px, dy = y - py;
      if (dx * dx + dy * dy > rr * rr + 0.2) continue;
      const i = y * B.w + x;
      B.k[i] = 1; B.v[i] = dy / (rr || 1);
    }
  }
  lay(B, x0, y0, x1, y1, o);
}

/** A flat shape from its corners. Its light is judged column by column, top
    to bottom. */
export function shape(B, pts, o) {
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (const p of pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
  x0 = Math.max(0, Math.floor(x0)); x1 = Math.min(B.w - 1, Math.ceil(x1)); y0 = Math.max(0, Math.floor(y0)); y1 = Math.min(B.h - 1, Math.ceil(y1));
  const n = pts.length;
  for (let x = x0; x <= x1; x++) {
    let top = -1, bot = -1;
    for (let y = y0; y <= y1; y++) {
      // Even-odd, with a little slack so a thin ear is never lost between
      // two rows of pixels.
      let inside = false;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const a = pts[i], b = pts[j];
        if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0] + 0.5) inside = !inside;
      }
      if (!inside) continue;
      B.k[y * B.w + x] = 1;
      if (top < 0) top = y;
      bot = y;
    }
    if (top < 0) continue;
    const half = Math.max(1, (bot - top) / 2), mid = (top + bot) / 2;
    for (let y = top; y <= bot; y++) B.v[y * B.w + x] = (y - mid) / half;
  }
  lay(B, x0, y0, x1, y1, o);
}

/** Where a two-boned limb bends: the joint between a and b for bones l1 and
    l2 long. bend 1 puts it behind a limb that hangs down (an elbow), -1 in
    front (a stifle, a knee). */
export function knee(a, b, l1, l2, bend) {
  let dx = b[0] - a[0], dy = b[1] - a[1];
  let d = Math.hypot(dx, dy) || 0.001;
  dx /= d; dy /= d;
  d = Math.min(d, l1 + l2 - 0.001);
  const along = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const off = Math.sqrt(Math.max(0, l1 * l1 - along * along)) * (bend || 1);
  return [a[0] + dx * along - dy * off, a[1] + dy * along + dx * off];
}

/** The outline, last of all: every bare pixel that touches the figure takes
    the ink of the fill it borders, and only its shade along the top, where
    the light falls. One black line round everything is what made the old
    sprites heavy. With `rim` (the night lands, the torch) the top edge is
    the fill's glint instead: moonlight along the back, which is what parts
    a black dog and a navy jacket from a navy street. */
export function contour(B, rim) {
  const w = B.w, h = B.h, m = B.m;
  const k = B.k;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (m[i]) continue;
      const below = y + 1 < h ? m[i + w] : 0;
      const side = (x > 0 && m[i - 1]) || (x + 1 < w && m[i + 1]) || 0;
      const above = y > 0 ? m[i - w] : 0;
      if (below) { k[i] = below; B.v[i] = rim ? 4 : 1; } else if (side || above) { k[i] = side || above; B.v[i] = 0; }
    }
  }
  for (let i = 0; i < m.length; i++) {
    if (!k[i]) continue;
    m[i] = k[i]; B.t[i] = B.v[i]; k[i] = 0;
  }
}

/** Ramps by material, ready for develop: r[material] = five hex tones. */
export function colours(r) {
  const out = [];
  for (let i = 0; i < r.length; i++) out[i] = r[i] ? r[i].map(hexToRgb) : null;
  return out;
}

/** Turn the sheet into a picture with one palette. The canvas belongs to the
    sheet and is painted over by the next develop: draw it at once. */
export function develop(B, pal) {
  if (!B.cv) { B.cv = makeCanvas(B.w, B.h); B.c = ctx2d(B.cv); B.img = B.c.createImageData(B.w, B.h); }
  const d = B.img.data, m = B.m, t = B.t;
  for (let i = 0, j = 0; i < m.length; i++, j += 4) {
    const ramp = m[i] && pal[m[i]];
    if (!ramp) { d[j + 3] = 0; continue; }
    const c = ramp[t[i] > 4 ? 4 : t[i]];
    d[j] = c[0]; d[j + 1] = c[1]; d[j + 2] = c[2]; d[j + 3] = 255;
  }
  B.c.putImageData(B.img, 0, 0);
  return B.cv;
}
