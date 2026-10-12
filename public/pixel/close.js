/* The close-up: the team seen from the side with its land behind it, 168 ×
   96 with the ground the team walks on at row 84. Each land has a sky in
   dithered bands, two far layers that pass slowly, the ground with the
   trail on it, and something near the lens that passes fast. Every layer is
   painted once, as a strip twice the scene's width that joins up with
   itself, and after that a frame is a handful of copies: the old close-up
   set every pixel of its sky again thirty times a second. */

import { bayer, clump, ctx2d, hash, hexToRgb, makeCanvas, mix, R } from './core.js';
import { CAST, RAMPS } from './ramps.js';

export const CLOSE = { w: 168, h: 96, ground: 84 };

const W = CLOSE.w, H = CLOSE.h, HOR = 54, TILE = W * 2;

/** The lands a close-up can show. `night` is the meadow after dark, for the
    night state on a day land. */
export const CLOSE_KINDS = ['hot', 'warm', 'town', 'climb', 'night'];

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

function shadowOf(land) { const [hex, a] = CAST[land]; const [r, g, b] = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; }

/* ── The sky ── */

function sky(kind) {
  return keep('sky/' + kind, W, HOR + 4, (c) => {
    if (kind === 'hot') {
      const S = RAMPS.meadow.sky;
      bands(c, W, 0, HOR + 4, [S[0], S[1], S[1], S[2], S[3]]);
      // The sun, upper left, and three clouds lit from it.
      for (const [r, col] of [[9, mix(S[1], S[4], 0.35)], [7, S[4]], [5, '#fffbe0']]) circle(c, 26, 14, r, col);
      for (const [x, y, w] of [[70, 12, 26], [122, 24, 34], [8, 34, 20]]) cloud(c, x, y, w, ['#ffffff', S[3], mix(S[1], S[2], 0.5)]);
    } else if (kind === 'warm') {
      const S = RAMPS.wood.sky;
      bands(c, W, 0, HOR + 4, [S[0], S[1], S[1], S[2], S[3], S[4]]);
      for (const [r, col] of [[13, mix(S[3], S[4], 0.4)], [10, S[4]], [7, '#fff0c0']]) circle(c, 40, HOR - 6, r, col);
      for (const [x, y, w] of [[90, 16, 40], [20, 8, 28], [130, 30, 30]]) cloud(c, x, y, w, [S[3], S[2], S[1]], true);
    } else {
      const S = kind === 'climb' ? RAMPS.climb.sky : RAMPS.town.sky;
      bands(c, W, 0, HOR + 4, [S[0], S[0], S[1], S[2], S[3]]);
      // The moon, upper left, a bite out of it.
      circle(c, 24, 13, 6, S[4]); circle(c, 27, 11, 5, S[0]);
      px(c, 20, 15, mix(S[4], S[2], 0.4), 2, 1);
    }
  });
}

function circle(c, cx, cy, r, col) {
  c.fillStyle = col;
  for (let y = -r; y <= r; y++) { const half = Math.floor(Math.sqrt(r * r - y * y + r * 0.7)); c.fillRect(cx - half, cy + y, half * 2 + 1, 1); }
}

function cloud(c, x, y, w, cols, flat) {
  const h = flat ? 3 : 6;
  for (let i = 0; i < w; i++) {
    const u = i / (w - 1), top = R((flat ? 1.5 : 3.5) * Math.sin(u * Math.PI) * (0.7 + 0.3 * Math.sin(u * 9 + x)));
    if (top <= 0) continue;
    px(c, x + i, y - top, cols[0], 1, 1);
    px(c, x + i, y - top + 1, cols[1], 1, Math.max(1, top));
    px(c, x + i, y + 1, cols[2], 1, Math.min(h - 3, 2) > 0 && i > 2 && i < w - 3 ? 1 : 0);
  }
}

/* ── The far and middle layers ── */

function far(kind) {
  return keep('far/' + kind, TILE, H, (c) => {
    if (kind === 'hot' || kind === 'night') {
      const M = RAMPS.meadow, S = M.sky;
      ridge(c, HOR - 9, 5, [2, 5], mix(M.grass[2], S[2], 0.62), 1.3);
      ridge(c, HOR - 4, 4, [3, 7], mix(M.grass[2], S[2], 0.36), 4.1);
      // Fields on the near hill: hedgerows, and a patch of ripe corn.
      for (let i = 0; i < 9; i++) {
        const x = R(hash(i * 17) * TILE), y0 = ridgeY(x, HOR - 4, 4, [3, 7], 4.1);
        for (let k = 0; k < 14; k++) twice(wrap(x + k * 2), 1, (q) => px(c, q, y0 + 2 + R(k * 0.35), mix(M.hedge[2], S[2], 0.3)));
        if (i % 3 === 0) twice(wrap(x + 30), 16, (q) => px(c, q, y0 + 4, mix(M.buttercup[2], S[2], 0.45), 16, 2));
      }
    } else if (kind === 'warm') {
      const Wd = RAMPS.wood, S = Wd.sky;
      ridge(c, HOR - 12, 5, [2, 6], mix(Wd.trunk[0], S[1], 0.6), 0.7);
      // A treeline against the low sun: crowns, no trunks.
      for (let i = 0; i < 40; i++) {
        const x = R(hash(i * 5) * TILE), r = 4 + R(hash(i * 9) * 4);
        twice(x, r * 2, (q) => circle(c, q, HOR - 4 - R(hash(i) * 5), r, mix(Wd.trunk[0], S[1], 0.36)));
      }
      c.fillStyle = mix(Wd.trunk[0], S[1], 0.36); c.fillRect(0, HOR - 4, TILE, H);
    } else if (kind === 'town') {
      const T = RAMPS.town;
      // Roofs against the sky, a spire among them.
      for (let i = 0; i < 26; i++) {
        const x = i * 13 + R(hash(i * 3) * 4), hh = 9 + R(hash(i * 7) * 9), w = 11 + R(hash(i * 11) * 5);
        px(c, x, HOR - hh, T.roof[0], w, hh + 2);
        for (let k = 0; k < 4; k++) px(c, x + k, HOR - hh - 4 + k, T.roof[1], w - k * 2 > 0 ? w - k * 2 : 1, 1);
        px(c, x + 2, HOR - hh - 6, T.roof[0], 2, 4);
        if (hash(i * 13) > 0.55) px(c, x + 3 + R(hash(i) * (w - 6)), HOR - hh + 3, T.lamp[1], 1, 2);
      }
      for (let k = 0; k < 16; k++) px(c, 200 - R(k / 3), HOR - 30 + k, T.roof[0], 1 + R(k / 3) * 2, 1);
      px(c, 196, HOR - 14, T.roof[0], 9, 16); px(c, 200, HOR - 10, T.lamp[2], 1, 2);
    } else {
      const C = RAMPS.climb;
      // Peaks: rock, with snow lying on the slopes that face the moon.
      for (const [base, amp, waves, seed, k] of [[HOR - 14, 12, [3, 7], 2.2, 0.5], [HOR - 6, 9, [4, 9], 5.0, 0.2]]) {
        ridge(c, base, amp, waves, mix(C.rock[1], C.sky[2], k), seed);
        for (let x = 0; x < TILE; x++) {
          const y = ridgeY(x, base, amp, waves, seed), yl = ridgeY(wrap(x - 1), base, amp, waves, seed);
          const facing = y <= yl;
          px(c, x, y, mix(facing ? C.snow[3] : C.snow[1], C.sky[2], k * 0.6), 1, facing ? 3 + R(hash(x) * 3) : 1);
        }
      }
    }
  });
}

/* A broadleaf tree: trunk, then three clumps of crown, the highest lit. */
function oak(c, x, base, s, leaf, trunk, seed) {
  px(c, x - 1, base - s * 2, trunk[1], 3, s * 2); px(c, x - 1, base - s * 2, trunk[2], 1, s * 2);
  px(c, x + 2, base - 2, trunk[1], 1, 2); px(c, x - 2, base - 1, trunk[1], 1, 1);
  clump(c, x + R(s * 0.9), base - s * 2 - 1, R(s * 1.1), R(s * 0.9), leaf, seed + 2);
  clump(c, x - R(s * 0.9), base - s * 2 - 2, R(s * 1.1), R(s * 0.95), leaf, seed + 5);
  clump(c, x, base - s * 3, R(s * 1.25), s, leaf, seed);
}

/* A pine: tiers of dark needles, each lit along its left edge. */
function pine(c, x, base, h, ramp, trunk, snow) {
  px(c, x, base - 4, trunk[1], 2, 4);
  const tiers = Math.max(3, R(h / 5));
  for (let i = 0; i < tiers; i++) {
    const y1 = base - 3 - i * (h - 3) / tiers, half = R((tiers - i) * (h / tiers) * 0.34) + 2, th = R((h - 3) / tiers) + 2;
    for (let k = 0; k < th; k++) {
      const w2 = R(half * (k + 1) / th), y = R(y1 - th + k);
      px(c, x + 1 - w2, y, ramp[1], w2 * 2, 1);
      px(c, x + 1 - w2, y, snow ? snow[3] : ramp[k === th - 1 ? 3 : 2], Math.max(1, R(w2 * (snow ? 1.1 : 0.7))), 1);
      if (k === th - 1) px(c, x + 1 - w2 + 1, y + 1, ramp[0], w2 * 2 - 2, 1);
    }
  }
}

function house(c, x, base, w, h, T, kind, seed) {
  const wall = kind % 2 ? T.brick : T.plaster;
  px(c, x, base - h, wall[1], w, h); px(c, x, base - h, wall[2], 2, h);
  // The roof: a slope lit by the moon on its left, an eave line under it.
  const rh = 6 + (kind % 3) * 2;
  for (let k = 0; k < rh; k++) {
    const inset = kind % 3 === 1 ? 0 : R((rh - 1 - k) * 0.9);
    px(c, x - 1 + inset, base - h - rh + k, T.roof[2], w + 2 - inset * 2, 1);
    px(c, x - 1 + inset, base - h - rh + k, T.roof[3], Math.max(1, R((w + 2 - inset * 2) * 0.4)), 1);
  }
  px(c, x - 1, base - h, T.roof[0], w + 2, 1);
  px(c, x + w - 5, base - h - rh - 3, wall[0], 3, 4); px(c, x + w - 5, base - h - rh - 3, wall[2], 1, 4);
  // Windows, most of them lit, and a door with its step.
  for (let j = 0; j < 2; j++) for (let i = 0; i < Math.floor((w - 4) / 7); i++) {
    const wx = x + 3 + i * 7, wy = base - h + 3 + j * 9;
    if (j === 1 && i === 0) { px(c, wx, wy - 1, T.trunk[1], 4, base - wy + 1); px(c, wx + 3, wy + 3, T.lamp[2]); px(c, wx - 1, base - 1, T.stone[2], 6, 1); continue; }
    const lit = hash(seed * 7 + i * 3 + j) > 0.35;
    px(c, wx - 1, wy - 1, wall[0], 6, 7);
    px(c, wx, wy, lit ? T.lamp[2] : T.roof[1], 4, 5);
    if (lit) { px(c, wx, wy, T.lamp[3], 2, 2); px(c, wx + 2, wy, wall[0], 1, 5); px(c, wx, wy + 2, T.lamp[1], 4, 1); }
  }
}

function mid(kind) {
  return keep('mid/' + kind, TILE, H, (c) => {
    if (kind === 'hot' || kind === 'night') {
      const M = RAMPS.meadow;
      // A hedge along the field's edge, oaks standing in it, a gate.
      for (let x = 0; x < TILE; x += 9) twice(x, 14, (q) => clump(c, q + 4, HOR - 3, 7, 4, M.hedge, x));
      c.fillStyle = M.hedge[1]; c.fillRect(0, HOR - 1, TILE, 3);
      for (const [x, s, seed] of [[30, 6, 1], [102, 5, 4], [176, 7, 9], [262, 5, 13], [310, 6, 21]]) oak(c, x, HOR, s, M.foliage, M.trunk, seed);
      px(c, 214, HOR - 8, M.grass[2], 20, 9);
      for (let k = 0; k < 4; k++) px(c, 214, HOR - 7 + k * 2, M.trunk[3], 20, 1);
      px(c, 214, HOR - 8, M.trunk[2], 1, 9); px(c, 233, HOR - 8, M.trunk[1], 1, 9); px(c, 223, HOR - 8, M.trunk[2], 1, 9);
    } else if (kind === 'warm') {
      const Wd = RAMPS.wood;
      // Trunks that go up out of the picture, sun-struck down their left
      // side, with the low light coming between them in bars.
      for (let i = 0; i < 9; i++) {
        const x = 18 + i * 37 + R(hash(i * 5) * 14), w = 4 + R(hash(i * 3) * 3);
        for (let y = 0; y < HOR + 3; y++) for (let k = 0; k < 10; k++) { const sx = x - 26 + k + R(y * 0.3); if (bayer(sx, y) < (k > 2 && k < 7 ? 0.5 : 0.25)) twice(wrap(sx), 1, (q) => px(c, q, y, mix(Wd.amber[3], Wd.sky[2], 0.45))); }
        twice(x, w, (q) => { px(c, q, 0, Wd.trunk[1], w, HOR + 3); px(c, q, 0, Wd.amber[3], 1, HOR + 3); px(c, q + 1, 0, Wd.trunk[2], 1, HOR + 3); px(c, q + w - 1, 0, Wd.trunk[0], 1, HOR + 3); });
        for (let k = 0; k < 5; k++) twice(x, w, (q) => px(c, q + 1 + (k % 2), 6 + k * 10 + R(hash(i + k) * 5), Wd.trunk[0], 2, 1));
        // A bough of amber leaves across some of them.
        if (i % 2 === 0) twice(wrap(x - 8), 24, (q) => { clump(c, q + 4, 6 + (i % 3) * 5, 9, 4, Wd.amber, i * 3); clump(c, q + 16, 9 + (i % 3) * 5, 7, 3, Wd.russet, i * 5); });
      }
      for (let x = 0; x < TILE; x += 11) twice(x, 12, (q) => clump(c, q + 3, HOR, 6, 3, Wd.russet, x * 3));
    } else if (kind === 'town') {
      const T = RAMPS.town;
      // A terrace, a garden wall, and the lamps of the street.
      let x = 2;
      for (let i = 0; x < TILE - 30; i++) {
        const w = 24 + (i % 3) * 7, h = 20 + ((i * 7) % 3) * 4;
        house(c, x, HOR + 2, w, h, T, i, i);
        x += w + (i % 4 === 2 ? 22 : 1);
        if (i % 4 === 2) {
          px(c, x - 21, HOR - 5, T.stone[1], 20, 7); px(c, x - 21, HOR - 5, T.stone[3], 20, 1);
          clump(c, x - 11, HOR - 9, 7, 5, T.foliage, i);
        }
      }
    } else {
      const C = RAMPS.climb;
      // Rock ribs through the snow, and pines carrying it.
      for (const [x, w, h] of [[40, 30, 9], [150, 44, 12], [250, 26, 8]]) {
        clump(c, x, HOR, R(w / 2), h, C.rock, x, { rough: 0.45 });
        for (let k = -R(w / 3); k < R(w / 4); k++) px(c, x + k, HOR - h + 1 + R(Math.abs(k) * 0.3), C.snow[3], 1, 2);
      }
      for (const [x, h] of [[14, 22], [72, 28], [96, 18], [196, 26], [222, 20], [300, 30], [322, 18]]) pine(c, x, HOR + 2, h, C.pine, C.trunk, C.snow);
    }
  });
}

/* ── The ground ── */

function ground(kind) {
  return keep('ground/' + kind, TILE, H, (c) => {
    const land = kind === 'warm' ? 'wood' : kind === 'town' ? 'town' : kind === 'climb' ? 'climb' : 'meadow';
    const L = RAMPS[land];
    const g = land === 'wood' ? L.litter : land === 'town' ? L.lawn : land === 'climb' ? L.snow : L.grass;
    const path = land === 'town' ? L.cobble : land === 'climb' ? L.track : L.path;
    const G = CLOSE.ground;
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
    // The trail: a crown of light along its middle, a rut of shade each
    // side, a ragged verge.
    for (let x = 0; x < TILE; x++) {
      const a = x / TILE * Math.PI * 2, top = G - 6 + R(0.8 * Math.sin(a * 5)), bot = G + 5 + R(0.8 * Math.sin(a * 4 + 2));
      px(c, x, top, path[2], 1, bot - top);
      px(c, x, top, hash(x * 3) > 0.5 ? g[3] : path[1], 1, 1);
      px(c, x, top + 1, path[1], 1, 1);
      px(c, x, top + 4, path[3], 1, 3);
      px(c, x, bot - 2, path[1], 1, 1);
      px(c, x, bot - 1, hash(x * 7) > 0.4 ? path[1] : g[1], 1, 1);
      px(c, x, bot, g[1], 1, 1);
    }
    const strew = (n, seed, y0, y1, draw) => { for (let i = 0; i < n; i++) { const x = R(hash(i * 31 + seed) * TILE), y = y0 + R(hash(i * 17 + seed * 3) * (y1 - y0)); twice(x, 8, (q) => draw(q, y, i)); } };
    const offTrail = (y) => y < G - 8 || y > G + 6;
    if (land === 'meadow') {
      // Tufts, then flowers in drifts rather than sprinkled.
      strew(70, 1, HOR + 3, H - 2, (x, y) => { if (!offTrail(y)) return; px(c, x, y, g[1]); px(c, x + 1, y - 1, g[3]); px(c, x + 2, y, g[1]); px(c, x + 1, y, g[3]); });
      for (const [cx, cy, n, ramp] of [[40, HOR + 12, 14, L.poppy], [150, HOR + 8, 10, L.buttercup], [230, H - 4, 12, L.poppy], [300, HOR + 14, 12, L.buttercup], [100, H - 3, 9, L.buttercup]]) {
        for (let i = 0; i < n; i++) {
          const x = cx + R((hash(i * 7 + cx) - 0.5) * 44), y = cy + R((hash(i * 11 + cx) - 0.5) * 9);
          if (!offTrail(y) || y <= HOR + 2 || y >= H - 1) continue;
          twice(wrap(x), 2, (q) => { px(c, q, y, ramp[2]); px(c, q + 1, y, ramp[3]); px(c, q, y + 1, g[0]); });
        }
      }
      strew(26, 9, G - 5, G + 4, (x, y) => { px(c, x, y, path[1], 2, 1); });
      strew(8, 4, G - 4, G + 3, (x, y) => { px(c, x, y, L.stone[2], 2, 1); px(c, x, y, L.stone[3], 1, 1); px(c, x, y + 1, path[0], 2, 1); });
    } else if (land === 'wood') {
      // Leaves lying in drifts of amber and russet, twigs, a ring of mushrooms.
      strew(120, 2, HOR + 3, H - 1, (x, y, i) => { const r = i % 3 ? L.amber : L.russet; px(c, x, y, r[offTrail(y) ? 2 : 1], 2, 1); if (i % 4 === 0) px(c, x + 1, y - 1, r[3]); });
      strew(14, 6, HOR + 6, H - 3, (x, y) => { if (offTrail(y)) px(c, x, y, L.trunk[1], 5, 1); });
      for (let i = 0; i < 7; i++) { const a = i / 7 * Math.PI * 2, x = 120 + R(9 * Math.cos(a)), y = HOR + 13 + R(3 * Math.sin(a)); px(c, x, y, L.mushroom[2], 3, 1); px(c, x, y, L.mushroom[4], 1, 1); px(c, x + 1, y + 1, L.mushroom[4], 1, 1); }
      // Long plum shadows from the trunks behind, lying to the right.
      c.fillStyle = shadowOf('wood');
      for (let i = 0; i < 9; i++) { const x = 18 + i * 37 + R(hash(i * 5) * 14); for (let k = 0; k < 16; k++) twice(wrap(x + k * 2), 6, (q) => c.fillRect(q, HOR + 1 + k, 5, 1)); }
    } else if (land === 'town') {
      // The street: cobbles in courses, a kerb, the lawn beyond it.
      px(c, 0, G - 9, L.stone[2], TILE, 1); px(c, 0, G - 8, L.stone[0], TILE, 1);
      for (let y = G - 7; y < G + 7; y++) for (let x = (y % 2) * 3; x < TILE; x += 6) { px(c, x, y, path[1], 1, 1); if (hash(x * 5 + y) > 0.6) px(c, x + 2, y, path[3], 2, 1); }
      px(c, 0, G + 7, L.stone[3], TILE, 1); px(c, 0, G + 8, L.stone[0], TILE, 1);
      strew(40, 3, HOR + 3, G - 11, (x, y) => { px(c, x, y, g[1], 2, 1); px(c, x + 1, y - 1, g[3]); });
      // Light spilt on the ground under the lit windows.
      for (let i = 0; i < 12; i++) { const x = 10 + i * 28; px(c, x, HOR + 2, mix(L.lamp[1], g[2], 0.62), 6, 2); px(c, x + 1, HOR + 4, mix(L.lamp[1], g[2], 0.8), 6, 2); }
    } else {
      // Drifts with a blue lee side, rock showing through, prints on the
      // packed track.
      for (let i = 0; i < 12; i++) {
        const x = R(hash(i * 13) * TILE), y = HOR + 6 + R(hash(i * 5) * 16), w = 18 + R(hash(i) * 20);
        twice(x, w, (q) => { for (let k = 0; k < w; k++) { const hgt = R(2.2 * Math.sin(k / (w - 1) * Math.PI)); if (hgt > 0) { px(c, q + k, y - hgt, g[3], 1, hgt); if (k > w * 0.55) px(c, q + k, y, g[1], 1, 1); } } });
      }
      strew(9, 8, HOR + 4, G - 10, (x, y) => { clump(c, x + 3, y, 4, 2, L.rock, x, { rough: 0.4 }); px(c, x, y - 2, g[3], 5, 1); });
      strew(30, 5, G - 4, G + 3, (x, y, i) => { px(c, x, y, path[i % 2 ? 1 : 0], 2, 1); });
      strew(40, 7, HOR + 3, H - 1, (x, y) => { if (offTrail(y)) px(c, x, y, g[4]); });
    }
  });
}

/* Things near the lens, passing at twice the ground's speed, in front of
   the team. They are dark and few: there for depth, not to be looked at. */
function fore(kind) {
  return keep('fore/' + kind, TILE, H, (c) => {
    const land = kind === 'warm' ? 'wood' : kind === 'town' ? 'town' : kind === 'climb' ? 'climb' : 'meadow';
    const L = RAMPS[land];
    if (land === 'meadow') {
      for (const x0 of [20, 150, 260]) for (let i = 0; i < 16; i++) {
        const x = x0 + R(hash(i * 3 + x0) * 46), h = 5 + R(hash(i * 7 + x0) * 8), lean = hash(i + x0) > 0.5 ? 1 : -1;
        for (let k = 0; k < h; k++) px(c, x + (k > h * 0.6 ? lean : 0), H - 1 - k, k > h - 3 ? L.grass[1] : L.grass[0]);
        if (i % 5 === 0) { px(c, x - 1, H - h - 2, L.poppy[2], 3, 2); px(c, x, H - h - 2, L.poppy[3]); }
      }
    } else if (land === 'wood') {
      for (const x0 of [118, 250]) for (let i = 0; i < 7; i++) {
        // Bracken: a stem, and fronds stepping down each side of it.
        const x = x0 + i * 6, h = 8 + R(hash(i + x0) * 7);
        for (let k = 0; k < h; k++) { px(c, x, H - 1 - k, L.trunk[0]); if (k % 2 === 0 && k > 1) px(c, x - (h - k) / 3, H - 1 - k, k > h - 4 ? L.russet[1] : L.russet[0], R((h - k) / 1.5) + 1, 1); }
      }
      px(c, 190, H - 4, L.trunk[0], 40, 4); px(c, 190, H - 5, L.trunk[1], 38, 1); px(c, 194, H - 6, L.pine[2], 14, 1);
    } else if (land === 'town') {
      // A lamp post close by, and a run of railings.
      px(c, 150, 14, L.trunk[0], 3, H - 14); px(c, 151, 14, L.trunk[2], 1, H - 14);
      px(c, 145, 10, L.trunk[0], 13, 5); px(c, 147, 11, L.lamp[2], 9, 3); px(c, 148, 11, L.lamp[4], 4, 2);
      for (let x = 230; x < 310; x += 6) { px(c, x, H - 10, L.trunk[0], 2, 10); px(c, x, H - 12, L.trunk[1], 2, 2); }
      px(c, 230, H - 7, L.trunk[0], 80, 2);
    } else {
      // A marker pole, snow banked against its foot.
      px(c, 154, H - 30, L.trunk[0], 3, 30); px(c, 154, H - 30, '#c8302a', 3, 6); px(c, 154, H - 20, '#c8302a', 3, 4); px(c, 155, H - 30, L.trunk[3], 1, 30);
      for (const [x, w] of [[134, 50], [270, 60]]) for (let k = 0; k < w; k++) { const hh = R(5 * Math.sin(k / (w - 1) * Math.PI)); px(c, x + k, H - hh, L.snow[k > w * 0.6 ? 1 : 3], 1, hh); px(c, x + k, H - hh, L.snow[4], 1, 1); }
    }
  });
}

/* Night over a day land: the strips of the meadow, gone to navy. */
function nighted(img, key) {
  return keep('night/' + key, img.width, img.height, (c) => {
    c.drawImage(img, 0, 0);
    c.globalCompositeOperation = 'source-atop';
    c.fillStyle = 'rgba(10,22,58,0.66)';
    c.fillRect(0, 0, img.width, img.height);
    c.globalCompositeOperation = 'source-over';
  });
}

function layer(name, kind) {
  const make = name === 'far' ? far : name === 'mid' ? mid : name === 'ground' ? ground : fore;
  if (kind !== 'night') return make(kind);
  return nighted(make('night'), name);
}

/* Copy rows y0..y1 of a strip into the scene, moved along by `off`. */
function pass(c, img, off, y0, y1) {
  const o = wrap(R(off)), h = y1 - y0, a = Math.min(W, TILE - o);
  c.drawImage(img, o, y0, a, h, 0, y0, a, h);
  if (a < W) c.drawImage(img, 0, y0, W - a, h, a, y0, W - a, h);
}

/* The ground is one strip passed at five speeds, slowest at the horizon:
   that, and nothing cleverer, is what makes it lie flat. */
const GROUND_BANDS = [[HOR, HOR + 6, 0.62], [HOR + 6, HOR + 14, 0.76], [HOR + 14, CLOSE.ground - 8, 0.9], [CLOSE.ground - 8, CLOSE.ground + 7, 1], [CLOSE.ground + 7, H, 1.2]];

const STARS = 46;

/** Paint a landscape into c. kind: one of CLOSE_KINDS. `scroll` is how far
    the ground has passed under the team, in art pixels; `t` runs the
    things that move by themselves, or is null for a still picture. */
export function landscape(c, w, h, kind, scroll, t) {
  if (CLOSE_KINDS.indexOf(kind) < 0) kind = 'hot';
  const live = t != null;
  const dark = kind === 'town' || kind === 'climb' || kind === 'night';
  c.drawImage(sky(kind === 'night' ? 'town' : kind), 0, 0);
  if (dark) {
    for (let i = 0; i < STARS; i++) {
      const x = R(hash(i * 3) * W), y = R(hash(i * 5 + 1) * (HOR - 10));
      if (live && (Math.floor(t / 400) + i) % 9 === 0) continue;
      px(c, x, y, i % 4 ? '#8ea4c8' : '#e8eefc');
      if (i % 11 === 0) { px(c, x - 1, y, '#5a70a0'); px(c, x + 1, y, '#5a70a0'); px(c, x, y - 1, '#5a70a0'); px(c, x, y + 1, '#5a70a0'); }
    }
  }
  if (kind === 'climb') c.drawImage(auroraAt(live ? t : 0), 0, 0);
  pass(c, layer('far', kind), scroll * 0.2, 0, HOR + 2);
  pass(c, layer('mid', kind), scroll * 0.45, 0, HOR + 4);
  const g = layer('ground', kind);
  for (const [y0, y1, k] of GROUND_BANDS) pass(c, g, scroll * k, y0, y1);
  if (!live) return;
  if (kind === 'town') {
    // Chimney smoke, three puffs rising and thinning over the roofs.
    for (let i = 0; i < 3; i++) {
      const T = (t + i * 900) % 2700, x = wrap(96 - scroll * 0.45) + R(T / 300) + R(Math.sin(T / 400) * 2), y = 16 - R(T / 220);
      if (x < W && T < 2300) px(c, x, y, T > 1500 ? '#3a4670' : '#5d6c98', T > 1500 ? 2 : 3, T > 900 ? 1 : 2);
    }
  }
}

/** What goes in front of the team: the near layer, and the weather. */
export function foreground(c, kind, scroll, t) {
  if (CLOSE_KINDS.indexOf(kind) < 0) kind = 'hot';
  pass(c, layer('fore', kind), scroll * 2, 0, H);
  if (t == null) return;
  if (kind === 'warm') falling(c, t, 9, ['#e9a03c', '#c8642a', '#f2c14e'], 2600, 40, true);
  if (kind === 'climb') { falling(c, t, 26, ['#ffffff', '#dbe6f6'], 3800, 90, false); falling(c, t + 900, 14, ['#ffffff'], 2300, 60, false); }
  if (kind === 'hot') {
    // A butterfly working its way across.
    const T = t % 9000, x = R(T / 9000 * (W + 20)) - 10, y = 30 + R(8 * Math.sin(T / 500) + 4 * Math.sin(T / 190));
    const open = Math.floor(t / 133) % 2;
    px(c, x, y, '#fff8dc', open ? 2 : 1, 1); px(c, x + (open ? 2 : 1), y, '#f3d34a', open ? 2 : 1, 1); px(c, x + 1, y + 1, '#6a5a20');
  }
  if (kind === 'night') {
    for (let i = 0; i < 6; i++) { const T = (t + i * 700) % 4200; if (T > 2600) continue; px(c, R(hash(i * 9) * W + 6 * Math.sin(T / 600 + i)), 40 + R(hash(i * 5) * 36 + 3 * Math.sin(T / 400)), T % 800 < 500 ? '#e8f47a' : '#8a9a3a'); }
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

/* The quiet aurora is painted five times a second, not thirty: it drifts
   too slowly for more to show, and it is the one thing here set pixel by
   pixel. */
let auroraKept = null, auroraStep = -1;
function auroraAt(t) {
  const n = Math.floor(t / 200);
  if (!auroraKept) auroraKept = makeCanvas(W, HOR);
  if (n !== auroraStep) { auroraStep = n; const a = ctx2d(auroraKept); a.clearRect(0, 0, W, HOR); aurora(a, n * 200, 1); }
  return auroraKept;
}

/** The aurora: three curtains hanging from the top of the sky, dithered
    out downward, drifting; `k` above 1 is the summit's flare. */
export function aurora(c, t, k) {
  const A = RAMPS.climb.aurora;
  for (let band = 0; band < 3; band++) {
    for (let x = 0; x < W; x++) {
      const top = 4 + band * 7 + R(4 * Math.sin(x / 19 + t / 2600 + band * 2) + 2 * Math.sin(x / 7 - t / 1700));
      const len = R((9 + 5 * Math.sin(x / 11 + band + t / 3100)) * k);
      for (let j = 0; j < len; j++) {
        const fade = 1 - j / len;
        if (bayer(x, top + j) < fade * 0.8 * Math.min(1, k)) px(c, x, top + j, A[j < 2 ? (k > 1 ? 4 : 3) : j < len * 0.5 ? 2 : 1]);
      }
    }
  }
}
