/* The close-up: the team seen from the side with its land behind it, 168 ×
   96 with the ground the team walks on at row 84. The five lands of the
   Deep Wood are five depths of the same walk: an open field under a whole
   sky, the wood's edge with the sky still between its young trees, the
   forest where the light comes down through leaves, the old forest of
   giant trunks and mist, and the ancient wood, near black, lit by fungi
   and by what moon finds a gap.

   Each land has what is behind everything (a sky, or the light between far
   trunks), two ranks of far things that pass slowly, the ground with the
   trail on it, a rank of trunks standing on that ground, and something
   near the lens that passes fast. Every layer is painted once, as a strip
   twice the scene's width that joins up with itself, and after that a
   frame is a handful of copies.

   What other feet left across the trail (lands.js says how much of it
   each land has) is the one thing drawn fresh each frame: a line of prints
   going away from the lens has to lean as it passes, and a strip cannot. */

import { bayer, clump, ctx2d, hash, makeCanvas, mix, R } from './core.js';
import { RAMPS } from './ramps.js';
import { LANDS } from './lands.js';
import { eyes, greatTree, shaft, tree, wisp } from './scenery.js';
import { drawStile } from './landmarks.js';

export const CLOSE = { w: 168, h: 96, ground: 84 };

const W = CLOSE.w, H = CLOSE.h, HOR = 54, TILE = W * 2, G = CLOSE.ground;

/** The lands a close-up can show: the board's own five (lands.js). */
export const CLOSE_KINDS = ['field', 'edge', 'forest', 'old', 'ancient'];

/* How far the trail is worn above and below the team's feet: broad in the
   field, a thread in the ancient wood, as on the board. */
const TRAIL = { field: [7, 6], edge: [6, 6], forest: [6, 5], old: [5, 4], ancient: [4, 4] };
/* And how ragged its edges are. */
const FRAY = { field: 0, edge: 0.3, forest: 0.7, old: 1.1, ancient: 1.5 };

const DAY = RAMPS.meadow.sky;
const NIGHT_SKY = ['#060a1c', '#0b1230', '#141e48', '#22306a', '#e8eefc'];
/* What is seen between the far trunks, top of the picture to the horizon:
   sun in the leaves, then a green dusk, then next to nothing. */
const AIR = {
  forest: ['#5e9244', '#86b658', '#b0d070', '#d2e48c', '#ecf2b0'],
  old: ['#0c2024', '#122e32', '#1a4240', '#28594f', '#44806a'],
  ancient: ['#03060c', '#060c16', '#0a1420', '#0f2030', '#16303c'],
};
const MOON = [196, 232, 255];

const kept = new Map();
function keep(key, w, h, draw) {
  let s = kept.get(key);
  if (!s) { s = makeCanvas(w, h); draw(ctx2d(s)); kept.set(key, s); }
  return s;
}
const px = (c, x, y, col, w = 1, h = 1) => { c.fillStyle = col; c.fillRect(x, y, w, h); };
/* Something that repeats along a strip: its place, wrapped, so that the
   strip's two ends meet. */
const wrap = (x) => ((x % TILE) + TILE) % TILE;
const twice = (x, w, fn) => { fn(x); if (x + w > TILE) fn(x - TILE); if (x < 0) fn(x + TILE); };

function bands(c, w, top, bottom, cols) {
  const n = cols.length, bandH = (bottom - top) / n;
  for (let y = top; y < bottom; y++) {
    const f = (y - top) / bandH, i = Math.min(n - 1, Math.floor(f)), frac = f - i;
    for (let x = 0; x < w; x++) {
      const next = i < n - 1 && frac > 0.4 && bayer(x, y) < (frac - 0.4) / 0.6;
      px(c, x, y, cols[next ? i + 1 : i]);
    }
  }
}

/* A ridge line: a silhouette along the strip, joined at the ends because
   its waves are whole divisions of the strip. */
function ridge(c, base, amp, waves, col, seed, to = H) {
  c.fillStyle = col;
  for (let x = 0; x < TILE; x++) {
    const a = x / TILE * Math.PI * 2;
    const h = amp * (0.6 * Math.sin(a * waves[0] + seed) + 0.4 * Math.sin(a * waves[1] + seed * 2.3));
    const top = R(base - h);
    c.fillRect(x, top, 1, to - top);
  }
}
const ridgeY = (x, base, amp, waves, seed) => { const a = x / TILE * Math.PI * 2; return R(base - amp * (0.6 * Math.sin(a * waves[0] + seed) + 0.4 * Math.sin(a * waves[1] + seed * 2.3))); };

function circle(c, cx, cy, r, col) {
  c.fillStyle = col;
  for (let y = -r; y <= r; y++) { const half = Math.floor(Math.sqrt(r * r - y * y + r * 0.7)); c.fillRect(cx - half, cy + y, half * 2 + 1, 1); }
}

function cloud(c, x, y, w, cols) {
  for (let i = 0; i < w; i++) {
    const u = i / (w - 1), top = R(3.5 * Math.sin(u * Math.PI) * (0.7 + 0.3 * Math.sin(u * 9 + x)));
    if (top <= 0) continue;
    px(c, x + i, y - top, cols[0], 1, 1);
    px(c, x + i, y - top + 1, cols[1], 1, Math.max(1, top));
    if (i > 2 && i < w - 3) px(c, x + i, y + 1, cols[2], 1, 1);
  }
}

/* An ellipse laid on the ground in an ordered dither, thick at its heart
   and gone at its edge: sun through the leaves, moss, a pool of moonlight. */
function patch(c, cx, cy, rx, ry, col, k = 1) {
  c.fillStyle = col;
  for (let y = -ry; y <= ry; y++) for (let x = -rx; x <= rx; x++) {
    const d = (x * x) / (rx * rx + 1) + (y * y) / (ry * ry + 1);
    if (d < 1 && bayer(cx + x, cy + y) < (1 - d) * k) c.fillRect(cx + x, cy + y, 1, 1);
  }
}

/* ── Behind everything ── */

function sky(kind, night) {
  const key = night ? (kind === 'forest' ? 'forest-night' : 'night') : kind === 'edge' ? 'field' : kind;
  return keep('sky/' + key, W, HOR + 4, (c) => {
    if (key === 'night') {
      const S = NIGHT_SKY;
      bands(c, W, 0, HOR + 4, [S[0], S[0], S[1], S[2], S[3]]);
      // The moon, upper left, a bite out of it.
      circle(c, 24, 13, 6, S[4]); circle(c, 27, 11, 5, S[0]);
      px(c, 20, 15, mix(S[4], S[2], 0.4), 2, 1);
    } else if (key === 'field') {
      bands(c, W, 0, HOR + 4, [DAY[0], DAY[1], DAY[1], DAY[2], DAY[3]]);
      // The sun, upper left, and three clouds lit from it.
      for (const [r, col] of [[9, mix(DAY[1], DAY[4], 0.35)], [7, DAY[4]], [5, '#fffbe0']]) circle(c, 26, 14, r, col);
      for (const [x, y, w] of [[70, 12, 26], [122, 24, 34], [8, 34, 20]]) cloud(c, x, y, w, ['#ffffff', DAY[3], mix(DAY[1], DAY[2], 0.5)]);
    } else if (key === 'forest-night') {
      // No sky in the forest, only what is between the trunks: at night, the moon's blue.
      bands(c, W, 0, HOR + 4, [NIGHT_SKY[0], NIGHT_SKY[1], NIGHT_SKY[1], NIGHT_SKY[2], NIGHT_SKY[3]]);
    } else {
      const A = AIR[key];
      bands(c, W, 0, HOR + 4, A);
      if (key === 'forest') {
        // Where the sun is, behind the leaves.
        for (const [r, col] of [[19, mix(A[3], A[4], 0.5)], [13, A[4]], [8, '#fbfbdc']]) circle(c, 38, 20, r, col);
      } else if (key === 'ancient') {
        // The one gap the moon has found, high on the right.
        const Mn = LANDS.ancient.moon;
        patch(c, 118, 14, 30, 16, Mn[0], 0.9); patch(c, 120, 12, 17, 9, Mn[1], 1); patch(c, 121, 11, 7, 4, Mn[2], 1.2);
      }
    }
  });
}

/* ── The far and middle ranks ── */

/* Trunks that go up out of the picture. */
function trunks(c, n, seed, w0, w1, col, lit) {
  for (let i = 0; i < n; i++) {
    const x = R(hash(i * 5 + seed) * TILE), w = w0 + R(hash(i * 3 + seed) * (w1 - w0));
    twice(x, w, (q) => { px(c, q, 0, col, w, HOR + 3); if (lit) px(c, q, 0, lit, 1, HOR + 3); });
  }
}
/* Masses of leaves, hung along a row. */
function boughs(c, n, seed, y, r0, r1, col) {
  for (let i = 0; i < n; i++) {
    const r = r0 + R(hash(i * 11 + seed) * (r1 - r0)), x = R(hash(i * 7 + seed) * TILE);
    twice(x - r, r * 2 + 1, (q) => circle(c, q + r, y + R(hash(i * 13 + seed) * 8) - 4, r, col));
  }
}
/* A tree of the board's own (scenery.js), stood on a strip: twice where it
   overhangs an end. */
function stand(c, x, base, land, r, kind, o) {
  tree(c, x, base, land, r, kind, o);
  if (x < 70) tree(c, x + TILE, base, land, r, kind, o);
  if (x > TILE - 70) tree(c, x - TILE, base, land, r, kind, o);
}

/* A trunk of the dark woods, going up out of the picture: bark in furrows,
   lit only along its left edge, moss up its weather side, roots like
   knees. Painted here and not taken from the board: a board tree is a few
   rows tall, and its flat lit side would be a pillar at this size. `dead`
   is a snag: pale, bare, broken off at `top` with two stubs of limb. */
function bole(c, x, base, hw, land, o = {}) {
  const L = LANDS[land], dead = !!o.dead, top = o.top || 0, seed = o.seed || x;
  const bark = dead ? mix(L.trunk, '#aab4bc', 0.3) : L.trunk, deep = mix(bark, '#000000', 0.42);
  const rim = mix(bark, land === 'ancient' ? '#a8c4dc' : '#b4d8b0', dead ? 0.6 : 0.45), w = hw * 2 + 1;
  c.fillStyle = `rgba(4,8,12,${land === 'ancient' ? 0.5 : 0.4})`; c.fillRect(x - hw - 1, base + 1, w + 14, 2); c.fillRect(x - hw + 3, base + 3, w + 10, 1);
  for (let y = top; y <= base; y++) {
    const flare = y > base - 7 ? R((y - (base - 7)) * 0.55) : 0, x0 = x - hw - flare;
    px(c, x0, y, bark, w + flare * 2, 1);
    px(c, x + R(hw * 0.25), y, deep, hw - R(hw * 0.25) + 1 + flare, 1);
    px(c, x0, y, rim, 1, 1);
    if (hw >= 3) px(c, x0 + 1, y, mix(bark, rim, 0.4), 1, 1);
  }
  // Furrows in the bark: dark streaks, each with a lit lip on the moon's side.
  for (let i = 0; i < hw * 3; i++) {
    const fx = x - hw + 2 + R(hash(i * 7 + seed) * Math.max(1, w - 4)), fy = top + 2 + R(hash(i * 13 + seed) * Math.max(1, base - top - 14)), len = 4 + R(hash(i * 3 + seed) * 9);
    px(c, fx, fy, deep, 1, len);
    if (fx < x && hw >= 3) px(c, fx - 1, fy + 1, mix(bark, rim, 0.25), 1, len - 2);
  }
  if (dead) {
    for (let k = 0; k < 7; k++) { px(c, x + hw + k, top + 12 - k, bark, 2, 2); px(c, x + hw + k, top + 12 - k, rim, 1, 1); px(c, x - hw - 2 - k, top + 22 - R(k * 0.7), bark, 2, 2); px(c, x - hw - 2 - k, top + 22 - R(k * 0.7), rim, 1, 1); }
    px(c, x - hw, top - 3, bark, 2, 3); px(c, x - hw, top - 3, rim, 1, 3); px(c, x + 1, top - 1, bark, hw, 1);
  } else if (L.moss) {
    for (let i = 0; i < hw * 3; i++) { const u = hash(i * 5 + seed), my = base - 2 - R(u * u * 40), mx = x - hw + R(hash(i * 11 + seed) * hw); px(c, mx, my, L.mossLo, 3, 2); px(c, mx, my, L.moss, 2, 1); }
  }
  // Roots: a knee each side of the foot.
  px(c, x - hw - 8, base, deep, 6, 2); px(c, x - hw - 7, base - 1, bark, 4, 1); px(c, x - hw - 7, base - 1, rim, 2, 1);
  px(c, x + hw + 3, base, deep, 6, 2); px(c, x + hw + 3, base - 1, bark, 3, 1);
}
function boles(c, list, land) {
  for (const [x, base, hw, o] of list) { bole(c, x, base, hw, land, o); if (x < 30) bole(c, x + TILE, base, hw, land, Object.assign({ seed: x }, o)); if (x > TILE - 30) bole(c, x - TILE, base, hw, land, Object.assign({ seed: x }, o)); }
}
/* The canopy, hanging into the top of the picture: bough on bough. */
function canopy(c, n, seed, y, land, thin) {
  const L = LANDS[land], ramp = [mix(L.treeLo, '#000000', 0.4), L.treeLo, L.tree, L.treeHi, mix(L.treeHi, '#ffffff', 0.15)];
  for (let i = 0; i < n; i++) {
    if (thin && i % 3 === 0) continue;
    const x = R((i + hash(i * 7 + seed) * 0.8) * TILE / n), rx = 13 + R(hash(i * 11 + seed) * 9), ry = 7 + R(hash(i * 13 + seed) * 5);
    twice(x - rx - 1, rx * 2 + 3, (q) => clump(c, q + rx + 1, y + R(hash(i * 5 + seed) * 7) - 3, rx, ry, ramp, i * 13 + seed));
  }
}
/* A fern: fronds arching out of one root, darkest where they start. */
function fernAt(c, x, y, size, F) {
  for (const [dir, k] of [[-1, 1], [-0.55, 0.8], [0.15, 0.7], [0.6, 0.85], [1, 1]]) {
    const len = R(size * k);
    for (let j = 0; j <= len; j++) {
      const fx = R(x + dir * j * 0.85), fy = y - R(Math.sin(j / len * Math.PI * 0.72) * len * 0.62);
      const col = j < len * 0.35 ? F[0] : j < len * 0.8 ? F[1] : F[2];
      px(c, fx, fy, col);
      if (j % 2 && j > 1) px(c, fx, fy + 1, F[0]);
    }
  }
}

function far(kind) {
  return keep('far/' + kind, TILE, H, (c) => {
    const M = RAMPS.meadow;
    if (kind === 'field' || kind === 'edge') {
      ridge(c, HOR - 9, 5, [2, 5], mix(M.grass[2], DAY[2], 0.62), 1.3);
      ridge(c, HOR - 4, 4, [3, 7], mix(M.grass[2], DAY[2], 0.36), 4.1);
      if (kind === 'field') {
        // Fields on the near hill: hedgerows, and a patch of ripe corn.
        for (let i = 0; i < 9; i++) {
          const x = R(hash(i * 17) * TILE), y0 = ridgeY(x, HOR - 4, 4, [3, 7], 4.1);
          for (let k = 0; k < 14; k++) twice(wrap(x + k * 2), 1, (q) => px(c, q, y0 + 2 + R(k * 0.35), mix(M.hedge[2], DAY[2], 0.3)));
          if (i % 3 === 0) twice(wrap(x + 30), 16, (q) => px(c, q, y0 + 4, mix(M.buttercup[2], DAY[2], 0.45), 16, 2));
        }
      } else {
        // The wood itself, ahead: a dark line of crowns along the hill.
        const col = mix(LANDS.forest.treeLo, DAY[2], 0.3);
        for (let i = 0; i < 44; i++) {
          const x = R(hash(i * 5) * TILE), r = 4 + R(hash(i * 9) * 4);
          twice(x - r, r * 2 + 1, (q) => circle(c, q + r, HOR - 6 - R(hash(i) * 5), r, col));
        }
        c.fillStyle = col; c.fillRect(0, HOR - 6, TILE, H);
      }
    } else if (kind === 'forest') {
      const L = LANDS.forest, A = AIR.forest;
      trunks(c, 34, 1, 2, 4, mix(L.trunk, A[3], 0.62), mix(L.trunk, A[4], 0.8));
      boughs(c, 30, 2, 5, 8, 15, mix(L.tree, A[2], 0.45));
      for (let x = 0; x < TILE; x += 9) twice(x, 12, (q) => circle(c, q + 5, HOR + 1, 4 + (x % 3), mix(L.treeLo, A[2], 0.4)));
    } else if (kind === 'old') {
      const L = LANDS.old, A = AIR.old;
      trunks(c, 26, 3, 3, 7, mix(L.trunk, A[3], 0.55), mix(L.trunk, A[4], 0.6));
      boughs(c, 26, 4, 3, 10, 18, mix(L.treeLo, A[1], 0.5));
      for (let x = 0; x < TILE; x += 11) twice(x, 14, (q) => circle(c, q + 6, HOR + 2, 5 + (x % 3), mix(L.treeLo, A[2], 0.45)));
    } else {
      const L = LANDS.ancient, A = AIR.ancient;
      // Black against what light there is; every third one dead and broken off.
      for (let i = 0; i < 22; i++) {
        const x = R(hash(i * 5 + 7) * TILE), w = 4 + R(hash(i * 3 + 7) * 5), dead = i % 3 === 0, top = dead ? 10 + R(hash(i) * 22) : 0;
        const col = mix(L.treeLo, A[2], dead ? 0.55 : 0.2);
        twice(x, w + 8, (q) => {
          px(c, q, top, col, w, HOR + 3 - top);
          px(c, q, top, mix(col, A[4], 0.5), 1, HOR + 3 - top);
          if (dead) { for (let k = 0; k < 6; k++) { px(c, q + w + k, top + 10 - k, col, 2, 1); px(c, q - 1 - k, top + 18 - R(k * 0.7), col, 2, 1); } px(c, q + 1, top - 2, col, 1, 2); }
          else if (i % 2) for (let k = 0; k < 3; k++) px(c, q + (k % 2 ? w - 1 : 0), 12 + k * 13 + R(hash(i + k) * 6), L.fungus[0], 2, 1);
        });
      }
      boughs(c, 18, 9, 1, 10, 18, mix(L.treeLo, A[0], 0.6));
    }
  });
}

function mid(kind) {
  return keep('mid/' + kind, TILE, H, (c) => {
    const M = RAMPS.meadow;
    if (kind === 'field') {
      // Open country: a low hedge a long way off, two oaks standing in it,
      // and the gate into the next field left open.
      for (let x = 0; x < TILE; x += 8) twice(x, 12, (q) => clump(c, q + 4, HOR - 1, 5, 2, M.hedge, x));
      c.fillStyle = M.hedge[1]; c.fillRect(0, HOR, TILE, 2);
      stand(c, 108, HOR, 'field', 9, 'round', { th: 8 });
      stand(c, 286, HOR, 'field', 7, 'haw');
      px(c, 196, HOR - 7, mix(M.grass[3], DAY[2], 0.2), 22, 9);
      px(c, 195, HOR - 9, M.trunk[1], 2, 11); px(c, 195, HOR - 9, M.trunk[3], 1, 10); px(c, 218, HOR - 9, M.trunk[1], 2, 11); px(c, 218, HOR - 9, M.trunk[3], 1, 10);
      for (let k = 0; k < 4; k++) px(c, 220, HOR - 7 + k * 2, M.trunk[3], 8 - (k % 2), 1);
      px(c, 227, HOR - 8, M.trunk[2], 1, 8);
    } else if (kind === 'edge') {
      // Young trees, one at a time, the sky still between them; what is
      // left of the hedge at their feet.
      for (let x = 0; x < TILE; x += 10) if (hash(x * 3) > 0.35) twice(x, 12, (q) => clump(c, q + 4, HOR - 1, 5, 2 + (x % 2), M.hedge, x));
      for (let i = 0; i < 15; i++) {
        const x = 12 + i * 22 + R(hash(i * 5) * 10), u = hash(i * 9 + 2);
        if (u < 0.3) stand(c, x, HOR, 'edge', 4, 'sapling');
        else if (u < 0.6) stand(c, x, HOR, 'edge', 6 + (i % 3), 'haw', { th: 6 });
        else stand(c, x, HOR, 'edge', 8 + (i % 4), i % 5 === 4 ? 'pine' : 'round', { th: 9 + (i % 3) * 2 });
      }
    } else if (kind === 'forest') {
      // A wall of trees: crowns touching, pines among them, fern at their feet.
      const L = LANDS.forest;
      for (let i = 0; i < 19; i++) {
        const x = 8 + i * 18 + R(hash(i * 5 + 3) * 8);
        stand(c, x, HOR, 'forest', 10 + (i % 4), i % 4 === 2 ? 'pine' : 'round', { th: 14 + ((i * 7) % 4) * 3, hw: 1 });
      }
      for (let x = 0; x < TILE; x += 7) twice(x, 10, (q) => clump(c, q + 3, HOR, 4, 2 + (x % 2), [L.treeLo, L.fern[0], L.fern[1], L.fern[2], L.fern[2]], x * 3));
    } else if (kind === 'old') {
      const L = LANDS.old, list = [];
      for (let i = 0; i < 11; i++) list.push([14 + i * 31 + R(hash(i * 5 + 1) * 12), HOR + 1, 2 + (i % 3), {}]);
      boles(c, list, 'old');
      canopy(c, 13, 3, 9, 'old');
      for (let x = 0; x < TILE; x += 9) twice(x, 12, (q) => clump(c, q + 4, HOR, 5, 2 + (x % 2), [L.treeLo, L.fern[0], L.fern[0], L.fern[1], L.fern[2]], x * 3));
    } else {
      const L = LANDS.ancient, list = [];
      for (let i = 0; i < 9; i++) {
        const dead = i % 3 === 1;
        list.push([20 + i * 37 + R(hash(i * 5 + 4) * 14), HOR + 1, dead ? 2 : 3 + (i % 2), dead ? { dead: true, top: 14 + (i % 2) * 9 } : {}]);
      }
      boles(c, list, 'ancient');
      canopy(c, 11, 6, 6, 'ancient', true);
      // Pale fungi up the living ones: what light there is down here.
      for (const [x, , hw, o] of list) if (!o.dead) for (let k = 0; k < 4; k++) twice(x, 8, (q) => { const fy = HOR - 6 - k * 9 - R(hash(x + k) * 4), fx = q + (k % 2 ? hw - 1 : -hw - 2); px(c, fx, fy, L.fungus[0], 3, 1); px(c, fx, fy - 1, L.fungus[1], 2, 1); });
    }
  });
}

/* The trunks that stand on the ground this side of the horizon: the ones
   the team passes between. They move with the ground they stand on. */
const NEAR_BASE = HOR + 10;
function near(kind) {
  if (kind === 'field') return null;
  return keep('near/' + kind, TILE, H, (c) => {
    const L = LANDS[kind];
    if (kind === 'edge') {
      stand(c, 150, NEAR_BASE, 'edge', 11, 'round', { th: 13, hw: 1 });
      stand(c, 300, NEAR_BASE - 2, 'edge', 5, 'sapling');
    } else if (kind === 'forest') {
      /* A pine's tiers reach down to its trunk only up to eleven across
         (scenery.js): wider, the crown hung clear of a bare pole. */
      for (const [x, r, th, k] of [[40, 15, 30, 'round'], [128, 11, 22, 'pine'], [206, 16, 34, 'round'], [296, 14, 28, 'round']]) stand(c, x, NEAR_BASE, 'forest', r, k, { th, hw: 2 });
      // Sun coming down between them.
      for (const x of [86, 250]) twice(x - 30, 44, (q) => shaft(c, q + 30, NEAR_BASE + 3, 8, 50));
    } else if (kind === 'old') {
      // Giants: trunks a stride wide, their crowns out of the picture.
      boles(c, [[56, NEAR_BASE, 6, {}], [170, NEAR_BASE + 1, 7, {}], [270, NEAR_BASE - 1, 5, {}], [118, NEAR_BASE - 3, 3, {}]], 'old');
      canopy(c, 9, 21, 2, 'old');
    } else {
      const list = [[70, NEAR_BASE, 8, {}], [236, NEAR_BASE + 1, 7, {}], [150, NEAR_BASE - 2, 3, { dead: true, top: 8 }], [312, NEAR_BASE - 3, 2, { dead: true, top: 20 }]];
      boles(c, list, 'ancient');
      canopy(c, 7, 25, 0, 'ancient', true);
      for (const [x, base, hw, o] of list) {
        if (!o.dead) for (let k = 0; k < 6; k++) twice(x, 12, (q) => { const fy = base - 8 - k * 9 - R(hash(x + k) * 4), fx = q + (k % 2 ? hw - 1 : -hw - 3); px(c, fx, fy, L.fungus[0], 4, 1); px(c, fx, fy - 1, L.fungus[1], 3, 1); px(c, fx + 1, fy - 1, L.fungus[2], 1, 1); });
      }
      for (const x of [112, 280]) twice(x - 30, 44, (q) => shaft(c, q + 30, NEAR_BASE + 4, 6, 52, MOON));
    }
  });
}

/* ── The ground ── */

function ground(kind) {
  return keep('ground/' + kind, TILE, H, (c) => {
    const L = LANDS[kind], g = L.floor, path = L.path, M = RAMPS.meadow;
    const [ta, tb] = TRAIL[kind], fray = FRAY[kind];
    // Big quiet shapes first: the far ground a little hazed, then the near.
    px(c, 0, HOR, g[2], TILE, H - HOR);
    px(c, 0, HOR, mix(g[3], g[2], 0.4), TILE, 2);
    for (let x = 0; x < TILE; x++) {
      const a = x / TILE * Math.PI * 2;
      const e1 = HOR + 9 + R(3 * Math.sin(a * 3 + 1) + 2 * Math.sin(a * 7)), e2 = HOR + 17 + R(3 * Math.sin(a * 2 + 4) + 2 * Math.sin(a * 5 + 2));
      px(c, x, HOR + 2, mix(g[3], g[2], 0.55), 1, e1 - HOR - 2);
      px(c, x, e2, mix(g[1], g[2], 0.55), 1, G - 7 - e2 > 0 ? G - 7 - e2 : 0);
      px(c, x, G + 7, mix(g[1], g[2], 0.3), 1, H - G - 7);
    }
    const strew = (n, seed, y0, y1, draw) => { for (let i = 0; i < n; i++) { const x = R(hash(i * 31 + seed) * TILE), y = y0 + R(hash(i * 17 + seed * 3) * (y1 - y0)); twice(x, 12, (q) => draw(q, y, i)); } };
    const offTrail = (y) => y < G - ta - 2 || y > G + tb + 1;
    // Light on the ground, before anything lies on it.
    if (kind === 'forest') strew(18, 12, HOR + 4, H - 2, (x, y, i) => { if (offTrail(y)) { patch(c, x, y, 6 + (i % 4) * 2, y > G ? 2 : 1, g[3], 0.9); patch(c, x, y, 3, 1, g[4], 0.7); } });
    if (kind === 'old') strew(7, 13, HOR + 5, H - 2, (x, y, i) => { if (offTrail(y)) patch(c, x, y, 7 + (i % 3) * 2, 1, g[3], 0.6); });
    if (kind === 'ancient') strew(4, 14, HOR + 8, H - 3, (x, y) => { if (offTrail(y)) { patch(c, x, y, 11, 2, L.moon[0], 0.8); patch(c, x, y, 5, 1, L.moon[1], 0.8); } });
    // In the dark woods the trail lies in a paler corridor, so that it is
    // found before anything else is.
    if (L.dark) {
      const lift = mix(g[3], path[1], 0.3);
      for (let x = 0; x < TILE; x++) for (let k = 1; k <= 4; k++) {
        if (bayer(x, G - ta - k) < 0.7 - k * 0.15) px(c, x, G - ta - k, lift);
        if (bayer(x, G + tb + k) < 0.7 - k * 0.15) px(c, x, G + tb + k, lift);
      }
    }
    // The trail: a crown of light along its middle, a rut of shade each
    // side, a verge that frays as the wood closes in.
    for (let x = 0; x < TILE; x++) {
      const a = x / TILE * Math.PI * 2;
      const top = G - ta + R(0.8 * Math.sin(a * 5) + fray * 0.8 * Math.sin(a * 23 + 1)), bot = G + tb - 1 + R(0.8 * Math.sin(a * 4 + 2) + fray * 0.8 * Math.sin(a * 19 + 4));
      const hgt = bot - top;
      px(c, x, top, path[2], 1, hgt);
      px(c, x, top, hash(x * 3) > 0.5 ? g[3] : path[1], 1, 1);
      px(c, x, top + 1, path[1], 1, 1);
      px(c, x, top + R(hgt * 0.34), path[3], 1, Math.max(1, R(hgt * 0.26)));
      px(c, x, bot - 2, path[1], 1, 1);
      px(c, x, bot - 1, hash(x * 7) > 0.4 ? path[1] : g[1], 1, 1);
      px(c, x, bot, g[1], 1, 1);
    }
    // Grit on the trail, in every land.
    strew(22, 9, G - ta + 2, G + tb - 3, (x, y) => { px(c, x, y, path[1], 2, 1); });
    strew(7, 4, G - ta + 2, G + tb - 3, (x, y) => { px(c, x, y, L.rock[2], 2, 1); px(c, x, y, L.rock[3], 1, 1); px(c, x, y + 1, path[0], 2, 1); });
    const tuft = (x, y) => { px(c, x, y, g[1]); px(c, x + 1, y - 1, g[3]); px(c, x + 2, y, g[1]); px(c, x + 1, y, g[3]); };
    const fern = (x, y, big) => { const F = L.fern; px(c, x, y, F[0], big ? 7 : 5, 1); px(c, x + 1, y - 1, F[1], big ? 5 : 3, 1); px(c, x + 2, y - 2, F[2], big ? 3 : 1, 1); if (big) px(c, x + 3, y - 3, F[2], 1, 1); };
    if (kind === 'field' || kind === 'edge') {
      // Tufts, then flowers in drifts rather than sprinkled: fewer of them
      // where the trees begin.
      strew(70, 1, HOR + 3, H - 2, (x, y) => { if (offTrail(y)) tuft(x, y); });
      const drifts = kind === 'field' ? [[40, HOR + 12, 14, M.poppy], [150, HOR + 8, 10, M.buttercup], [230, H - 4, 12, M.poppy], [300, HOR + 14, 12, M.buttercup], [100, H - 3, 9, M.buttercup]]
        : [[60, HOR + 10, 8, M.buttercup], [250, H - 4, 7, M.poppy]];
      for (const [cx, cy, n, ramp] of drifts) {
        for (let i = 0; i < n; i++) {
          const x = cx + R((hash(i * 7 + cx) - 0.5) * 44), y = cy + R((hash(i * 11 + cx) - 0.5) * 9);
          if (!offTrail(y) || y <= HOR + 2 || y >= H - 1) continue;
          twice(wrap(x), 2, (q) => { px(c, q, y, ramp[2]); px(c, q + 1, y, ramp[3]); px(c, q, y + 1, g[0]); });
        }
      }
      if (kind === 'edge') {
        strew(9, 21, HOR + 5, H - 3, (x, y, i) => { if (offTrail(y)) fern(x, y, i % 2 === 0); });
        strew(16, 22, HOR + 4, H - 2, (x, y, i) => { if (offTrail(y)) px(c, x, y, LANDS.forest.leaf[i % 5], 2, 1); });
      }
    } else if (kind === 'forest') {
      // Last year's leaves, fern, a fallen branch or two, a ring of mushrooms.
      strew(60, 2, HOR + 3, H - 1, (x, y, i) => { if (offTrail(y)) { px(c, x, y, L.leaf[i % 5], 2, 1); if (i % 4 === 0) px(c, x + 1, y - 1, L.leaf[(i + 2) % 5]); } });
      strew(40, 3, HOR + 3, H - 2, (x, y) => { if (offTrail(y)) tuft(x, y); });
      strew(16, 5, HOR + 5, H - 2, (x, y, i) => { if (offTrail(y)) fern(x, y, i % 2 === 0); });
      strew(8, 6, HOR + 6, H - 3, (x, y) => { if (offTrail(y)) { px(c, x, y, L.trunk, 6, 1); px(c, x, y - 1, mix(L.trunk, '#ffffff', 0.25), 4, 1); } });
      for (let i = 0; i < 7; i++) { const a = i / 7 * Math.PI * 2, x = 120 + R(9 * Math.cos(a)), y = HOR + 13 + R(3 * Math.sin(a)); px(c, x, y, '#c8302a', 3, 1); px(c, x, y, '#f6e8d0', 1, 1); px(c, x + 1, y + 1, '#f6e8d0', 1, 1); }
    } else {
      // Moss, dark fern, and roots across the trail itself.
      strew(kind === 'old' ? 16 : 7, 7, HOR + 4, H - 2, (x, y) => { if (offTrail(y)) { patch(c, x, y, 5, 1, L.mossLo, 1.2); px(c, x - 1, y, L.moss, 3, 1); } });
      strew(kind === 'old' ? 18 : 9, 8, HOR + 5, H - 2, (x, y, i) => { if (offTrail(y)) fern(x, y, i % 2 === 0); });
      strew(30, 10, HOR + 3, H - 1, (x, y) => { if (offTrail(y)) tuft(x, y); });
      for (let i = 0; i < (kind === 'old' ? 5 : 7); i++) {
        const x0 = R((i + 0.3 + hash(i * 7) * 0.5) * TILE / (kind === 'old' ? 5 : 7));
        for (let y = G - ta - 5; y <= G + tb + 3; y++) {
          // On the trail a root is worn pale along its top: the same earth, a tone down.
          const x = wrap(x0 + R(2.4 * Math.sin((y - G) * 0.55 + i)) + R((y - G) * 0.3)), on = !offTrail(y);
          px(c, x, y, on ? path[1] : L.root[2], 1, 1); px(c, wrap(x + 1), y, on ? path[0] : L.root[1], 1, 1);
        }
      }
      if (kind === 'ancient') {
        // The fungi that light it: a few clusters, each with a faint pool round it.
        strew(11, 15, HOR + 5, H - 3, (x, y, i) => {
          if (!offTrail(y)) return;
          patch(c, x + 2, y, 6, 1, L.fungus[0], 0.6);
          px(c, x, y, L.fungus[1], 2, 1); px(c, x + 3, y - 1, L.fungus[1], 2, 1); px(c, x + 3, y - 1, L.fungus[2], 1, 1); if (i % 2) px(c, x + 1, y - 1, L.fungus[2], 1, 1);
        });
        strew(10, 16, HOR + 5, H - 2, (x, y) => { if (offTrail(y)) px(c, x, y, mix(L.root[2], '#ffffff', 0.3), 4, 1); });
      } else {
        // What people leave: a can by the trail, a crisp packet further off.
        px(c, 96, G - ta - 5, '#c8ccd0', 3, 2); px(c, 96, G - ta - 5, '#e83a3a', 3, 1);
        px(c, 262, G + tb + 4, '#e8c23a', 3, 2); px(c, 263, G + tb + 4, '#fff6c8', 1, 1);
      }
    }
  });
}

/* Things near the lens, passing at twice the ground's speed, in front of
   the team. They are dark and few: there for depth, not to be looked at. */
function fore(kind) {
  return keep('fore/' + kind, TILE, H, (c) => {
    const L = LANDS[kind], g = L.floor, M = RAMPS.meadow;
    const blades = (x0, n, span, tall, flower) => {
      for (let i = 0; i < n; i++) {
        const x = x0 + R(hash(i * 3 + x0) * span), h = tall + R(hash(i * 7 + x0) * tall * 1.4), lean = hash(i + x0) > 0.5 ? 1 : -1;
        for (let k = 0; k < h; k++) px(c, x + (k > h * 0.6 ? lean : 0), H - 1 - k, k > h - 3 ? g[1] : g[0]);
        if (flower && i % 5 === 0) { px(c, x - 1, H - h - 2, flower[2], 3, 2); px(c, x, H - h - 2, flower[3]); }
      }
    };
    const ferns = (x0, n, F) => { for (let i = 0; i < n; i++) fernAt(c, x0 + i * 13 + R(hash(i + x0) * 5), H - 1, 11 + R(hash(i * 3 + x0) * 6), F); };
    if (kind === 'field') {
      for (const x0 of [20, 150, 260]) blades(x0, 16, 46, 5, M.poppy);
    } else if (kind === 'edge') {
      blades(30, 14, 40, 5, M.buttercup); blades(210, 12, 40, 5, null);
      ferns(126, 2, [g[0], L.fern[0], L.fern[1]]);
      // Cow parsley: a thin stem and a flat white head.
      for (const x of [262, 270, 281]) { px(c, x, H - 14, g[0], 1, 14); px(c, x - 2, H - 15, '#f4f6e6', 5, 1); px(c, x - 1, H - 16, '#ffffff', 3, 1); }
    } else if (kind === 'forest') {
      ferns(112, 4, [L.treeLo, L.fern[0], L.fern[1]]); ferns(262, 3, [L.treeLo, L.fern[0], L.fern[1]]);
      /* A fallen trunk with moss along it: round at its ends, bark along
         its top, its sawn end showing (a plain bar of brown was a rule
         across the foot of the picture). */
      const dark = mix(L.trunk, '#000000', 0.45), lit = mix(L.trunk, '#ffffff', 0.18);
      for (let k = 0; k < 42; k++) {
        const hh = k < 1 || k > 40 ? 3 : k < 3 || k > 38 ? 5 : 6 + (hash(k * 5) > 0.8 ? 1 : 0);
        px(c, 190 + k, H - hh, dark, 1, hh); px(c, 190 + k, H - hh, k % 9 === 4 ? dark : L.trunk, 1, 1);
        if (k > 3 && k < 36 && hash(k * 3) > 0.55) px(c, 190 + k, H - hh + 2, mix(L.trunk, '#000000', 0.2), 1, 1);
      }
      px(c, 228, H - 5, lit, 3, 4); px(c, 229, H - 4, L.trunk, 1, 2); px(c, 227, H - 4, lit, 1, 2);
      px(c, 196, H - 7, L.fern[1], 12, 1); px(c, 198, H - 8, L.fern[2] || L.fern[1], 5, 1); px(c, 214, H - 7, L.fern[0], 7, 1);
    } else {
      // Roots as thick as an arm, humped out of the ground, and the fern
      // that grows in their lee: near black, with a rim of what light there is.
      const dark = mix(L.root[0], '#000000', 0.3);
      for (const [x0, w, hgt] of kind === 'old' ? [[124, 46, 7], [268, 38, 5]] : [[112, 54, 8], [214, 30, 5], [282, 44, 7]]) {
        for (let k = 0; k < w; k++) {
          const hh = R(hgt * Math.sin(k / (w - 1) * Math.PI) * (0.75 + 0.25 * Math.sin(k * 0.7)));
          if (hh <= 0) continue;
          px(c, x0 + k, H - hh, dark, 1, hh); px(c, x0 + k, H - hh, k < w * 0.45 ? L.root[2] : L.root[1], 1, 1);
        }
        if (L.moss) px(c, x0 + R(w * 0.3), H - hgt, L.moss, 6, 1);
      }
      ferns(kind === 'old' ? 176 : 172, kind === 'old' ? 3 : 2, [dark, L.fern[0], L.fern[1]]);
      if (kind === 'ancient') for (const x of [128, 150, 300]) { px(c, x, H - 5, L.fungus[0], 4, 1); px(c, x, H - 6, L.fungus[1], 3, 1); px(c, x + 1, H - 6, L.fungus[2], 1, 1); px(c, x + 1, H - 4, dark, 1, 4); }
    }
  });
}

/* Night over a day land: its own strips, gone to navy. */
function nighted(img, key) {
  return keep('night/' + key, img.width, img.height, (c) => {
    c.drawImage(img, 0, 0);
    c.globalCompositeOperation = 'source-atop';
    c.fillStyle = 'rgba(10,22,58,0.66)';
    c.fillRect(0, 0, img.width, img.height);
    c.globalCompositeOperation = 'source-over';
  });
}

const MAKERS = { far, mid, near, ground, fore };
function layer(name, kind, night) {
  const img = MAKERS[name](kind);
  return img && night ? nighted(img, name + '/' + kind) : img;
}

/* Copy rows y0..y1 of a strip into the scene, moved along by `off`. */
function pass(c, img, off, y0, y1) {
  const o = wrap(R(off)), h = y1 - y0, a = Math.min(W, TILE - o);
  c.drawImage(img, o, y0, a, h, 0, y0, a, h);
  if (a < W) c.drawImage(img, 0, y0, W - a, h, a, y0, W - a, h);
}

/* The ground is one strip passed at five speeds, slowest at the horizon:
   that, and nothing cleverer, is what makes it lie flat. */
const GROUND_BANDS = [[HOR, HOR + 6, 0.62], [HOR + 6, HOR + 14, 0.76], [HOR + 14, G - 8, 0.9], [G - 8, G + 7, 1], [G + 7, H, 1.2]];
const speedAt = (y) => { for (const b of GROUND_BANDS) if (y < b[1]) return b[2]; return 1.2; };
const NEAR_SPEED = speedAt(NEAR_BASE);

/* ── What crossed the trail ──
   Each line belongs to whoever made it and looks like them: a boot's sole
   and heel, a paw's pad under its arch of toes, a deer's split slot, a horseshoe,
   the one unbroken line of a bike tyre, a cart's two ruts, the trampled
   band a herd leaves, and the worn earth of a footpath, which stops short
   of the trail: nothing is allowed to look more walked than the trail is.
   `x` is where a line meets the trail, along the strip; `lean` how far it
   slants a row. None in the field, one at the wood's edge, and more with
   every land after it. */
const TRACKS = {
  field: [],
  edge: [{ x: 228, kind: 'boot', lean: 0.5 }],
  forest: [{ x: 70, kind: 'paw', lean: -0.5 }, { x: 196, kind: 'path', lean: 0.8 }, { x: 292, kind: 'deer', lean: 0.3 }],
  old: [{ x: 36, kind: 'ruts', lean: 0.6 }, { x: 108, kind: 'boot', lean: -0.7 }, { x: 170, kind: 'paw', lean: 0.4 }, { x: 236, kind: 'path', lean: -0.9 }, { x: 300, kind: 'tyre', lean: 0.2 }],
  ancient: [{ x: 20, kind: 'herd', lean: 0.5 }, { x: 62, kind: 'paw', lean: -0.8 }, { x: 104, kind: 'horse', lean: 0.3 }, { x: 150, kind: 'boot', lean: 1 }, { x: 196, kind: 'deer', lean: -0.4 },
    { x: 236, kind: 'path', lean: 0.9 }, { x: 278, kind: 'paw', lean: 0.2 }, { x: 318, kind: 'ruts', lean: -0.6 }],
};
const STEP = { boot: 4, paw: 3, deer: 4, horse: 5, tyre: 2, ruts: 2, herd: 2, path: 2 };

const inks = new Map();
function trackInk(kind, night) {
  const key = kind + (night ? '/n' : '');
  let k = inks.get(key);
  if (!k) {
    const L = LANDS[kind], g = L.floor, p = L.path, n = (col) => (night ? mix(col, '#0a163a', 0.66) : col);
    /* Pressed into grass a print is dark; on the floor of a dark wood it
       is the pale earth it turned up. Never paler than the trail's crown. */
    k = { print: n(L.dark ? mix(p[2], g[2], 0.22) : mix(p[0], g[2], 0.22)), faint: n(mix(p[2], p[1], 0.5)), cut: n(mix(g[0], p[0], 0.45)), worn: n(mix(p[1], g[1], 0.45)), bare: n(mix(p[2], g[2], 0.4)) };
    inks.set(key, k);
  }
  return k;
}

function mark(c, kind, x, y, k, n, on, ink) {
  const big = k >= 0.9, side = n % 2 ? 1 : -1;
  if (kind === 'path') {
    // Worn earth, a paler line where the feet go; it gives out before the trail.
    if (on) return;
    const half = R(3.5 * k);
    c.fillStyle = ink.worn; c.fillRect(x - half, y, half * 2 + 1, 2);
    c.fillStyle = ink.bare; c.fillRect(x - 1, y, big ? 3 : 2, 2);
    return;
  }
  if (kind === 'herd') {
    if (on) return;
    const half = R(6 * k);
    c.fillStyle = ink.cut;
    for (let j = 0; j < 3; j++) c.fillRect(x - half + R(hash(n * 7 + j * 3 + y) * half * 2), y + (j & 1), 2, 1);
    return;
  }
  if (kind === 'tyre' || kind === 'ruts') {
    const gap = kind === 'ruts' ? R(4 * k) : 0;
    c.fillStyle = on ? ink.faint : ink.cut;
    c.fillRect(x - gap, y, 1, 2); if (gap) c.fillRect(x + gap, y, 1, 2);
    // The tread: a nick to one side, every other step.
    if (!on && n % 2) { c.fillStyle = ink.print; c.fillRect(x - gap + 1, y, 1, 1); if (gap) c.fillRect(x + gap + 1, y, 1, 1); }
    return;
  }
  c.fillStyle = on ? ink.faint : ink.print;
  const o = side * (big ? 2 : 1);
  if (kind === 'boot') {
    // Sole, a gap, heel.
    c.fillRect(x + o, y, big ? 3 : 2, 1);
    if (big) c.fillRect(x + o + 1, y + 2, 2, 1);
  } else if (kind === 'paw') {
    // Four toes in an arch over the pad; a dog's prints come in pairs.
    const dx = x + o + (n % 4 < 2 ? 0 : side);
    if (big) { c.fillRect(dx, y, 3, 1); c.fillRect(dx - 1, y - 1, 1, 1); c.fillRect(dx + 3, y - 1, 1, 1); c.fillRect(dx, y - 2, 1, 1); c.fillRect(dx + 2, y - 2, 1, 1); }
    else { c.fillRect(dx, y, 1, 1); c.fillRect(dx - 1, y - 1, 1, 1); c.fillRect(dx + 1, y - 1, 1, 1); }
  } else if (kind === 'deer') {
    // A slot: two slivers side by side, pointing the way it went.
    c.fillRect(x + o, y, 1, 2); c.fillRect(x + o + 2, y, 1, 2);
  } else {
    // A shoe: an arch, open behind.
    c.fillRect(x + o, y, 1, 2); c.fillRect(x + o + 3, y, 1, 2); c.fillRect(x + o + 1, y - 1, 2, 1);
  }
}

function tracks(c, kind, scroll, night) {
  const list = TRACKS[kind];
  if (!list.length) return;
  const ink = trackInk(kind, night), ta = TRAIL[kind][0], tb = TRAIL[kind][1];
  for (const tr of list) {
    /* How far ahead of the middle of the picture the line is, where it
       meets the trail. Every row of the ground passes at its own speed, so
       the line leans over as it goes by, as a real one does. */
    const d = ((tr.x - scroll) % TILE + TILE * 1.5) % TILE - TILE / 2;
    if (Math.abs(d) * 0.62 > W / 2 + 36) continue;
    for (let y = HOR + 4, n = 0; y < H; n++) {
      const k = speedAt(y);
      mark(c, tr.kind, R(W / 2 + d * k + tr.lean * (y - G)), y, k, n, y >= G - ta - 1 && y <= G + tb + 1, ink);
      y += STEP[tr.kind] + (k >= 0.9 && STEP[tr.kind] > 2 ? 1 : 0);
    }
  }
}

const STARS = 46;

/** Paint a landscape into c. kind: one of CLOSE_KINDS. `scroll` is how far
    the ground has passed under the team, in art pixels; `t` runs the
    things that move by themselves, or is null for a still picture. `night`
    is night over a day land (the dark woods are dark already); `glade`
    leaves out the near trunks. */
export function landscape(c, w, h, kind, scroll, t, night, glade) {
  if (CLOSE_KINDS.indexOf(kind) < 0) kind = 'field';
  const L = LANDS[kind], live = t != null, T = live ? t : 0;
  night = !!night && !L.dark;
  c.drawImage(sky(kind, night), 0, 0);
  if (night && kind !== 'forest') {
    for (let i = 0; i < STARS; i++) {
      const x = R(hash(i * 3) * W), y = R(hash(i * 5 + 1) * (HOR - 10));
      if (live && (Math.floor(t / 400) + i) % 9 === 0) continue;
      px(c, x, y, i % 4 ? '#8ea4c8' : '#e8eefc');
      if (i % 11 === 0) { px(c, x - 1, y, '#5a70a0'); px(c, x + 1, y, '#5a70a0'); px(c, x, y - 1, '#5a70a0'); px(c, x, y + 1, '#5a70a0'); }
    }
  }
  pass(c, layer('far', kind, night), scroll * 0.2, 0, HOR + 2);
  if (L.dark) {
    // Mist lying between the far trunks and the near ones, moving a little.
    const rgb = kind === 'old' ? '190,226,214' : '150,190,200';
    for (let i = 0; i < 3; i++) {
      const x = wrap(40 + i * 118 - scroll * 0.3 + T / (260 + i * 90)), y = HOR - 14 + i * 7;
      twice(x, 40, (q) => { if (q > -50 && q < W + 50) { wisp(c, R(q), y, 70 + i * 12, rgb, kind === 'old' ? 0.13 : 0.09); wisp(c, R(q) + 9, y + 1, 44 + i * 8, rgb, kind === 'old' ? 0.11 : 0.07); } });
    }
  }
  pass(c, layer('mid', kind, night), scroll * 0.45, 0, HOR + 4);
  if (kind === 'ancient') {
    // Something watching from between the trunks. It blinks.
    for (let i = 0; i < 3; i++) {
      const x = wrap(52 + i * 121 - scroll * 0.45), blink = live && (Math.floor(t / 180) + i * 7) % 23 < 2;
      if (x < W - 4 && !blink && (!live || Math.floor((t + i * 2600) / 5200) % 2 === 0)) eyes(c, R(x), HOR - 7 - i * 3);
    }
  }
  const g = layer('ground', kind, night);
  for (const [y0, y1, k] of GROUND_BANDS) pass(c, g, scroll * k, y0, y1);
  tracks(c, kind, scroll, night);
  // A glade has no trunks this side of the horizon: the finale's great tree stands alone in it.
  const n = glade ? null : layer('near', kind, night);
  if (n) pass(c, n, scroll * NEAR_SPEED, 0, NEAR_BASE + 6);
}

/** What goes in front of the team: the near layer, and what is in the air. */
export function foreground(c, kind, scroll, t, night) {
  if (CLOSE_KINDS.indexOf(kind) < 0) kind = 'field';
  const L = LANDS[kind];
  night = !!night && !L.dark;
  pass(c, layer('fore', kind, night), scroll * 2, 0, H);
  if (t == null) return;
  if (night || kind === 'old') {
    // Fireflies: after dark anywhere, and all day under the old trees.
    for (let i = 0; i < 7; i++) { const T = (t + i * 700) % 4200; if (T > 2600) continue; px(c, R(hash(i * 9) * W + 6 * Math.sin(T / 600 + i)), 36 + R(hash(i * 5) * 40 + 3 * Math.sin(T / 400)), T % 800 < 500 ? '#e8f47a' : '#8a9a3a'); }
    return;
  }
  if (kind === 'forest') falling(c, t, 9, ['#d8d05a', '#b8c84a', '#e8c040'], 2600, 40, true);
  else if (kind === 'edge') falling(c, t, 3, ['#d8d05a', '#b8c84a'], 3200, 40, true);
  else if (kind === 'ancient') {
    // Motes going up through what light there is, slowly.
    for (let i = 0; i < 10; i++) {
      const life = 5200 + (i % 4) * 700, T = (t + hash(i * 3) * life) % life;
      const x = R(hash(i * 7) * W + 5 * Math.sin(T / 900 + i)), y = H - 8 - R(T / life * 70);
      if (T > life * 0.85 && Math.floor(T / 133) % 2) continue;
      px(c, x, y, i % 3 ? '#7ae6d2' : '#d8fff4');
    }
  }
  if (kind === 'field' || kind === 'edge') {
    // A butterfly working its way across.
    const T = t % 9000, x = R(T / 9000 * (W + 20)) - 10, y = 30 + R(8 * Math.sin(T / 500) + 4 * Math.sin(T / 190));
    const open = Math.floor(t / 133) % 2;
    px(c, x, y, '#fff8dc', open ? 2 : 1, 1); px(c, x + (open ? 2 : 1), y, '#f3d34a', open ? 2 : 1, 1); px(c, x + 1, y + 1, '#6a5a20');
  }
}

function falling(c, t, n, cols, life0, drift, tumble) {
  for (let i = 0; i < n; i++) {
    const life = life0 + hash(i) * life0 * 0.5;
    const T = (t + hash(i * 3) * life) % life;
    const x = R((hash(i * 7) * W + T / drift + Math.sin(T / 300 + i) * 3) % W);
    const y = R(T / life * (H + 4)) - 2;
    px(c, x, y, cols[i % cols.length], tumble && Math.floor(T / 200) % 2 ? 2 : 1, 1);
  }
}

/* ── The bosses' gates, from the side ──
   Each stands across the trail at `x` (its hinge post; the latch post is 15
   further on). `part` is 'back' (what the team passes in front of), 'front'
   (what it passes behind) or 'all'. Whatever runs away from the lens (the
   stream, the wall) is drawn a row at a time at that row's own speed, like
   the tracks, so it stays on the ground it was built on. */

const WALL = ['#1a2024', '#3c4648', '#66726e', '#94a098', '#c8d0c0'];

/** A boss's gate in the close-up. kind: 'stile' (the field gate into the
    wood), 'bridge' (the gate at the footbridge over the stream) or 'hamlet'
    (the gateway in the foresters' wall, its lantern lit). open: 0 shut … 1. */
export function drawGate(c, kind, x, open, part = 'all') {
  const back = part !== 'front', front = part !== 'back';
  const rowX = (at, y) => R(W / 2 + (at - W / 2) * speedAt(y));
  if (kind === 'bridge' && back) {
    // The stream, coming down from the trees and going out under the lens.
    const Wt = LANDS.forest.water, mid = x + 34;
    for (let y = HOR + 2; y < H; y++) {
      const cx = rowX(mid, y) + R((y - G) * 0.35 + 2 * Math.sin(y * 0.5)), half = R(3 + (y - HOR) * 0.2);
      px(c, cx - half - 1, y, Wt[0], 1, 1); px(c, cx + half + 1, y, LANDS.forest.floor[1], 1, 1);
      px(c, cx - half, y, Wt[2], half * 2 + 1, 1);
      px(c, cx - half, y, Wt[1], 2, 1);
      if ((y + cx) % 3 === 0) px(c, cx - half + 3 + (y % 4), y, Wt[3], 3, 1);
      if ((y * 7 + cx) % 11 === 0) px(c, cx + 1, y, Wt[4], 2, 1);
    }
    // The footbridge: planks across it, and the far handrail.
    const T = RAMPS.meadow.trunk, x0 = x + 17, x1 = x + 53;
    px(c, x0, G - 4, T[0], x1 - x0, 9); px(c, x0, G - 4, T[2], x1 - x0, 7); px(c, x0, G - 4, T[3], x1 - x0, 1);
    for (let k = x0 + 5; k < x1; k += 6) px(c, k, G - 3, T[1], 1, 6);
    for (const k of [x0 + 2, x1 - 4]) { px(c, k - 1, G - 15, T[0], 4, 12); px(c, k, G - 14, T[2], 2, 11); px(c, k, G - 14, T[3], 1, 10); }
    px(c, x0 + 1, G - 13, T[0], x1 - x0 - 2, 3); px(c, x0 + 1, G - 12, T[3], x1 - x0 - 2, 1);
  }
  if (kind === 'hamlet' && back) {
    // The dry-stone wall, running away to the trees.
    for (let y = HOR + 5; y < G - 3; y++) {
      const wx = rowX(x + 1, y) + R((y - G) * 0.2), hgt = R(4 + (y - HOR) * 0.22);
      px(c, wx - 1, y - hgt, WALL[0], 5, hgt + 1); px(c, wx, y - hgt, (y + wx) % 3 ? WALL[2] : WALL[1], 3, hgt); px(c, wx, y - hgt, WALL[3], 3, 1);
    }
  }
  drawStile(c, x, G, open, false, part);
  if (kind === 'bridge' && front) {
    // The near handrail, this side of the team.
    const T = RAMPS.meadow.trunk, x0 = x + 17, x1 = x + 53;
    for (const k of [x0 + 2, x1 - 4]) { px(c, k - 1, G - 5, T[0], 4, 13); px(c, k, G - 4, T[2], 2, 12); px(c, k, G - 4, T[3], 1, 11); }
    px(c, x0 + 1, G - 3, T[0], x1 - x0 - 2, 3); px(c, x0 + 1, G - 2, T[3], x1 - x0 - 2, 1);
  }
  if (kind === 'hamlet') {
    // Stone gateposts over the timber ones, a lantern on the far one.
    const pillar = (px0, lamp) => {
      px(c, px0 - 2, G - 19, WALL[0], 7, 21); px(c, px0 - 1, G - 18, WALL[2], 5, 19); px(c, px0 - 1, G - 18, WALL[3], 1, 19); px(c, px0 + 3, G - 17, WALL[1], 1, 18);
      for (let k = 0; k < 4; k++) px(c, px0 - 1 + (k % 2) * 2, G - 14 + k * 4, WALL[1], 3, 1);
      px(c, px0 - 3, G - 21, WALL[0], 9, 3); px(c, px0 - 2, G - 20, WALL[3], 7, 1);
      if (lamp) {
        px(c, px0 - 1, G - 27, '#2a1c10', 5, 6); px(c, px0, G - 26, '#ffd27a', 3, 4); px(c, px0 + 1, G - 25, '#fff6c8', 1, 2); px(c, px0, G - 28, '#2a1c10', 3, 1);
        patch(c, px0 + 1, G - 24, 9, 7, 'rgba(255,214,122,0.5)', 0.5);
      }
    };
    if (back) pillar(x, true);
    if (front) {
      pillar(x + 15, false);
      for (let y = G + 6; y < H; y++) { const wx = rowX(x + 16, y) + R((y - G) * 0.2), hgt = R(4 + (y - HOR) * 0.22); px(c, wx - 1, y - hgt, WALL[0], 5, hgt + 1); px(c, wx, y - hgt, (y + wx) % 3 ? WALL[2] : WALL[1], 3, hgt); px(c, wx, y - hgt, WALL[3], 3, 1); }
    }
  }
}

/* ── The heart of the wood ── */

/** The finale's own scenery: the great tree standing at x, back from the
    trail, and, once the moon has found it (`lit`), the beam it comes down
    in and the pool it makes on the ground. */
export function heartTree(c, x, lit) {
  if (lit) {
    const Mn = LANDS.ancient.moon;
    c.drawImage(keep('pool', 112, 26, (p) => { patch(p, 56, 13, 54, 12, Mn[0], 1.1); patch(p, 56, 13, 34, 7, Mn[1], 1.1); patch(p, 56, 13, 16, 3, Mn[2], 1.2); }), x - 52, HOR + 6);
  }
  greatTree(c, x, HOR + 14, !!lit);
  if (lit) shaft(c, x + 2, HOR + 22, 26, 76, MOON);
}
