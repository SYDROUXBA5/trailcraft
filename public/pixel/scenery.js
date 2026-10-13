/* What stands on the board: trees of every age, the things a walk in a
   wood turns up, the foresters' cottages and their lanterns, a parked car,
   and the air of a deep wood (mist, shafts of light, eyes).

   One trail going in: an open field (Hot), the wood's edge, the forest
   (Warm), the old forest and the ancient wood (Cold). The lands' colours are
   lands.js; this is what is built out of them.

   The whole ladder is some 5,400 art pixels tall, more than an old iPhone
   will give one canvas, so nothing here needs the whole board at once:
   drawBoard paints any band of rows, and the same band is always painted
   the same way, whichever tile asks for it. A wood is a great many trees,
   so each kind and size of tree is painted once, kept, and copied. */

import { bayer, clump, ctx2d, darker, disc, ellipse, hash, lighter, makeCanvas, R, stamp } from './core.js';
import { castOf, LANDS } from './lands.js';
import { glow } from './terrain.js';

/** The lands' colours, by land: board.js and the showcase read them here. */
export const BOARD_LANDS = LANDS;

/* ── Painted once, copied after ── */

const sprites = new Map();

/* A piece of scenery on its own small canvas. `draw` paints it with its
   foot at (0, 0); ax and ay say where that is on the canvas. */
function sprite(key, w, h, ax, ay, draw) {
  let s = sprites.get(key);
  if (!s) {
    const cv = makeCanvas(w, h), x = ctx2d(cv);
    x.translate(ax, ay);
    draw(x);
    s = { cv, ax, ay };
    sprites.set(key, s);
  }
  return s;
}
const place = (c, s, x, y) => c.drawImage(s.cv, x - s.ax, y - s.ay);

/* The shadow a standing thing throws: an ellipse on the ground down and to
   the right of its foot, as long as the land's light is low, its edge
   broken up so it never ends on a hard line. Never black: the land's own
   shadow colour. */
function castShadow(c, x, base, r, land) {
  const len = LANDS[land].castLen;
  const rx = R(r * (0.8 + len * 0.5)), ry = Math.max(2, R(r * 0.34));
  const cx = x + R(r * len * 0.7) + 1, cy = base + 1;
  c.fillStyle = castOf(land);
  for (let y = -ry; y <= ry; y++) {
    const half = R(rx * Math.sqrt(Math.max(0, 1 - (y * y) / ((ry + 0.5) * (ry + 0.5)))));
    c.fillRect(cx - half + 1 + y, cy + y, half * 2 - 1, 1);
    if (bayer(cx - half + y, cy + y) < 0.5) c.fillRect(cx - half + y, cy + y, 1, 1);
    if (bayer(cx + half + y, cy + y) < 0.5) c.fillRect(cx + half + y, cy + y, 1, 1);
  }
}

/* A flat shadow under something small. */
function ground(c, x, y, rx, land) {
  ellipse(c, x + 2, y, rx, Math.max(1, R(rx * 0.3)), castOf(land));
}

/* ── Trees ── */

/* A tree with its foot at (0, 0). th is the trunk's height and hw its
   half-width, so a tree can be a forest giant; `sapling` and `snag` are
   the young and the dead. */
function paintTree(c, land, r, kind, th, hw, seed) {
  const L = LANDS[land];
  if (kind === 'sapling') {
    castShadow(c, 0, 0, 3, land);
    c.fillStyle = darker(L.trunk, 0.35); c.fillRect(0, -6, 1, 7);
    c.fillStyle = lighter(L.trunk, 0.2); c.fillRect(0, -5, 1, 3);
    const rp = [darker(L.hawLo, 0.3), L.hawLo, L.haw, L.hawHi, lighter(L.hawHi, 0.25)];
    clump(c, 1, -8, 3, 3, rp, seed + 3);
    clump(c, -1, -10, 2, 2, rp, seed + 5);
    return;
  }
  castShadow(c, 0, 0, kind === 'snag' ? 5 : r, land);
  // The trunk: lit down its left, flared at the foot, its dark side its own
  // deep tone rather than a black line.
  const deep = darker(L.trunk, 0.5), bark = kind === 'snag' ? lighter(L.trunk, 0.35) : L.trunk;
  c.fillStyle = deep; c.fillRect(-hw - 1, -th, hw * 2 + 3, th + 1); c.fillRect(-hw - 2, -1, hw * 2 + 5, 2);
  c.fillStyle = bark; c.fillRect(-hw, -th, hw * 2 + 1, th); c.fillRect(-hw - 1, -1, 2, 1);
  c.fillStyle = lighter(bark, L.dark ? 0.38 : 0.25); c.fillRect(-hw, -th, Math.max(1, hw - 1), th - 1);
  if (hw >= 2) {
    // A big tree stands on its roots, and its bark is furrowed.
    c.fillStyle = deep;
    c.fillRect(-hw - 4, 0, 4, 2); c.fillRect(-hw - 6, 1, 3, 1); c.fillRect(hw + 1, 0, 4, 2); c.fillRect(hw + 4, 1, 3, 1); c.fillRect(-1, 1, 3, 1);
    c.fillStyle = bark; c.fillRect(-hw - 3, -1, 3, 1); c.fillRect(-hw - 5, 0, 2, 1); c.fillRect(hw + 1, -1, 2, 1);
    c.fillStyle = deep;
    for (let j = 2; j < th - 3; j += 5) { c.fillRect(j % 2 ? 0 : hw - 1, -th + j, 1, 3); c.fillRect(-hw + 1 + (j % 3), -th + j + 2, 1, 2); }
    if (L.moss) { c.fillStyle = L.moss; c.fillRect(-hw, -5, 2, 3); c.fillRect(-hw - 2, -1, 2, 1); c.fillRect(-hw, -9, 1, 2); c.fillStyle = L.mossLo; c.fillRect(-hw + 1, -3, 1, 2); }
  }
  if (kind === 'snag') {
    // Dead and bare: two broken limbs and a splintered top.
    const top = -th;
    c.fillStyle = deep;
    for (let k = 0; k < 6; k++) { c.fillRect(-hw - 1 - k, top + 6 - k, 2, 2); c.fillRect(hw + 1 + k, top + 11 - R(k * 0.8), 2, 2); }
    c.fillStyle = bark;
    for (let k = 0; k < 6; k++) { c.fillRect(-hw - 1 - k, top + 6 - k, 1, 1); c.fillRect(hw + 1 + k, top + 11 - R(k * 0.8), 1, 1); }
    c.fillRect(-hw, top - 2, 1, 2); c.fillRect(hw - 1, top - 1, 1, 1);
    return;
  }
  const cy = -th - r + 2;
  if (kind === 'pine') {
    // Three filled tiers, dark green with a rim where the light catches.
    const edge = darker(L.pine, 0.55);
    for (let k = 0; k < 3; k++) {
      const ty = cy - r + 1 + k * 5, w = 2 + k * 2 + R(r / 4);
      for (let j = 0; j < 7; j++) {
        const half = R(w * (j + 1) / 7);
        c.fillStyle = edge; c.fillRect(-half - 1, ty + j, half * 2 + 3, 2);
      }
      c.fillStyle = edge; c.fillRect(-w - 1, ty + 6, w * 2 + 3, 2);
      for (let j = 0; j < 7; j++) {
        const half = R(w * (j + 1) / 7);
        c.fillStyle = j > 4 ? darker(L.pine, 0.3) : L.pine; c.fillRect(-half, ty + j, half * 2 + 1, 1);
        c.fillStyle = L.pineRim; c.fillRect(-half, ty + j, 1, 1);
        if (j < 3) { c.fillStyle = L.pineHi; c.fillRect(-half + 1, ty + j, Math.max(0, half), 1); }
      }
    }
    return;
  }
  // A broadleaf crown: three masses of leaves, the highest and leftmost in
  // the light, each shaded in clumps and dark only underneath. The biggest
  // crowns carry a lower bough each side.
  const col = kind === 'haw' ? [L.haw, L.hawHi, L.hawLo] : [L.tree, L.treeHi, L.treeLo];
  const ramp = [darker(col[2], 0.38), col[2], col[0], col[1], lighter(col[1], 0.22)];
  const a = Math.max(3, R(r * 0.72)), b = Math.max(3, R(r * 0.84));
  if (r >= 12) {
    const e = Math.max(4, R(r * 0.5));
    clump(c, -R(r * 0.86), cy + R(r * 0.5), e, R(e * 0.8), ramp, seed + 17);
    clump(c, R(r * 0.84), cy + R(r * 0.56), e, R(e * 0.8), ramp, seed + 23);
  }
  clump(c, R(r * 0.5), cy + R(r * 0.36), a, R(a * 0.86), ramp, seed + 3);
  clump(c, -R(r * 0.52), cy + R(r * 0.24), a, R(a * 0.9), ramp, seed + 11);
  clump(c, 0, cy - R(r * 0.2), b, R(b * 0.88), ramp, seed);
  if (kind === 'haw' && !L.dark) {
    // Hawthorn: berries in the leaves, in twos.
    c.fillStyle = L.berry;
    for (let k = 0; k < 5; k++) { const bx = -r + 3 + R(hash(seed * 5 + k) * (r * 2 - 7)), by = cy - r + 4 + R(hash(seed * 3 + k) * (r * 2 - 8)); c.fillRect(bx, by, 2, 1); }
  }
}

/** A tree standing at (x, base) in `land`'s colours. kind: 'round', 'haw',
    'pine', 'sapling' or 'snag'; o.th and o.hw the trunk's height and
    half-width. No two neighbours need be the same: there are three of each. */
export function tree(c, x, base, land, r, kind, o = {}) {
  const th = o.th || (kind === 'haw' ? 5 : 7), hw = o.hw || 1, v = (x * 7 + base * 3) % 3;
  const left = Math.max(r * 1.9, hw + 8) + 3, right = r * 2.6 + 6, up = th + r * 2 + 6;
  place(c, sprite(['tree', land, r, kind, th, hw, v].join('/'), R(left + right), R(up + r * 0.4 + 6), R(left), R(up),
    (cc) => paintTree(cc, land, r, kind, th, hw, v * 37 + r)), x, base);
}

/* The great tree at the heart of the wood: a trunk a cottage wide, roots
   like walls, a crown that is the sky, and the moon down its left side.
   Pale fungi climb it, and they are what light there is. */
export const GREAT = { th: 62, hw: 11, r: 28 };

function paintGreat(c, lit) {
  const L = LANDS.ancient, { th, hw, r } = GREAT;
  /* Its bark is a tone paler than any other trunk up here: it is the one
     tree in the wood that has to be seen for what it is, moon or no moon. */
  const K = ['#0e0c12', '#2a2428', '#463c40', '#6a5e60', lit ? '#b4c4c0' : '#7e7a7c'];
  // Its shadow lies across the glade.
  c.fillStyle = castOf('ancient');
  for (let j = 0; j < 8; j++) c.fillRect(-hw - 6 + j * 3, j, hw * 2 + 34 - j * 2, 1);
  // Roots: three each side, flowing out and down like the walls of a room.
  for (const [sx, n] of [[-1, 0], [1, 1]]) for (let k = 0; k < 3; k++) {
    const len = 15 - k * 3 + n;
    for (let i = 0; i < len; i++) {
      const rx = sx * (hw + 2 + i), ry = -5 + k * 4 + R(i * 0.5), tall = Math.max(1, 7 - k * 2 - R(i * 0.45));
      c.fillStyle = K[0]; c.fillRect(rx, ry - tall - 1, 1, tall + 3);
      c.fillStyle = sx < 0 ? K[2] : K[1]; c.fillRect(rx, ry - tall, 1, tall);
      if (sx < 0) { c.fillStyle = i % 2 ? K[3] : K[4]; c.fillRect(rx, ry - tall, 1, 1); }
    }
  }
  // The trunk: wide at the foot, furrowed, what light there is down its left.
  for (let j = 0; j <= th; j++) {
    const y = -j, w = hw + (j < 12 ? R((12 - j) * 0.45) : 0) - (j > th - 12 ? R((j - th + 12) * 0.2) : 0);
    c.fillStyle = K[0]; c.fillRect(-w - 1, y, w * 2 + 3, 1);
    c.fillStyle = K[1]; c.fillRect(-w, y, w * 2 + 1, 1);
    c.fillStyle = K[2]; c.fillRect(-w, y, R(w * 1.1), 1);
    c.fillStyle = K[3]; c.fillRect(-w, y, 3 + (j % 7 === 0 ? 1 : 0), 1);
    if (j % 3) { c.fillStyle = K[4]; c.fillRect(-w, y, 1, 1); }
  }
  // Furrows in the bark, long and broken, each with its lit lip.
  for (let j = 3; j < th - 6; j += 3) {
    const fx = -hw + 4 + (j * 5) % (hw * 2 - 6);
    c.fillStyle = K[0]; c.fillRect(fx, -j - 5, 1, 5 + (j % 4));
    if (fx < 2) { c.fillStyle = K[3]; c.fillRect(fx - 1, -j - 4, 1, 3); }
  }
  // A hollow at its foot big enough to sleep in, and moss up the weather side.
  ellipse(c, 3, -7, 4, 7, K[0]);
  ellipse(c, 3, -6, 3, 6, '#05060a');
  c.fillStyle = K[3]; c.fillRect(-1, -12, 1, 6); c.fillRect(0, -14, 2, 1);
  c.fillStyle = L.mossLo; c.fillRect(-hw - 3, -16, 4, 12); c.fillRect(-hw - 8, -4, 6, 2); c.fillRect(-hw + 1, -28, 2, 8);
  c.fillStyle = L.moss; c.fillRect(-hw - 3, -16, 2, 9); c.fillRect(-hw - 8, -4, 3, 1); c.fillRect(-hw, -28, 1, 5); c.fillRect(-hw - 1, -20, 1, 3);
  // Bracket fungi in a stair up the trunk: pale, and brighter under the moon.
  const U = L.fungus;
  for (const [fx, fy, w] of [[-hw - 2, -20, 5], [-hw + 6, -29, 6], [hw - 7, -22, 6], [-hw + 1, -38, 5], [hw - 4, -41, 4], [-3, -47, 5], [hw - 9, -33, 4], [-hw + 3, -53, 4]]) {
    c.fillStyle = U[0]; c.fillRect(fx, fy + 1, w, 1); c.fillRect(fx + 1, fy + 2, w - 2, 1);
    c.fillStyle = U[1]; c.fillRect(fx, fy, w, 1);
    c.fillStyle = lit ? U[2] : U[1]; c.fillRect(fx, fy, lit ? 3 : 1, 1);
  }
  // The crown: bough on bough, a tone above the canopy round it, with the
  // moon caught along its top.
  const ramp = ['#08141a', '#10262c', '#1a3c40', '#285a56', lit ? '#7cc0a0' : '#3a6e62'];
  const cy = -th - r + 10;
  for (const [dx, dy, rx, ry, sd] of [[-r - 6, 10, 16, 11, 1], [r + 8, 12, 15, 10, 2], [-r + 6, -2, 18, 13, 3], [r - 4, 0, 17, 12, 4], [0, 8, 22, 12, 5], [-9, -13, 18, 12, 6], [13, -11, 16, 11, 7], [2, -21, 14, 9, 8]]) {
    clump(c, dx, cy + dy, rx, ry, ramp, sd * 13);
  }
}

/** The great tree, its foot at (x, base). `lit`: the moon is on it. */
export function greatTree(c, x, base, lit) {
  const { th, r } = GREAT;
  place(c, sprite('great/' + (lit ? 1 : 0), 118, th + r * 2 + 26, 56, th + r * 2 + 12, (cc) => paintGreat(cc, lit)), x, base);
}

/* ── The small things ── */

const LANDMARKS = {
  log: ['.bbbbbbbbbbbB.', 'bBbbbbBbbbbbww', 'bbbbbbbbbbbbwd', '.BBBBBBBBBBBB.'],
  mushroom: ['.rrr.', 'rwrrw', 'rrrrr', '..s..', '..s..'],
  mushroomS: ['.rr.', 'rwrr', '.s..'],
  stump: ['.bbbb.', 'bwwwwb', 'bwbbwb', 'bBBBBb', 'bBbBBb'],
  signpost: [
    '.....p.....',
    'wwwwwpwwww.',
    'wddddpdddww',
    'wwwwwpwwww.',
    '.....p.....',
    '.wwwwpwwwww',
    'wwdddpddddw',
    '.wwwwpwwwww',
    '.....p.....',
    '.....p.....',
    '.....p.....',
  ],
};

/* A pool among the trees: the sky in it by day, the moon in the old woods. */
function pond(c, x, y, land) {
  const W = LANDS[land].water, bank = LANDS[land].floor[0], reed = LANDS[land].floor;
  ellipse(c, x, y, 17, 7, bank);
  ellipse(c, x, y, 16, 6, W[1]);
  ellipse(c, x - 1, y - 1, 14, 4, W[2]);
  ellipse(c, x - 3, y - 2, 8, 2, W[3]);
  c.fillStyle = W[4]; c.fillRect(x - 9, y - 3, 5, 1); c.fillRect(x + 3, y - 1, 4, 1); c.fillRect(x - 3, y + 2, 3, 1);
  c.fillStyle = W[0]; c.fillRect(x - 9, y + 5, 19, 1); c.fillRect(x + 9, y + 4, 5, 1);
  // Reeds at one end, their heads in the light.
  for (let k = 0; k < 5; k++) {
    const rx = x + 11 + k * 2, top = y - 9 + (k % 2) * 2 + (k === 4 ? 2 : 0);
    c.fillStyle = reed[0]; c.fillRect(rx, top + 2, 1, y + 3 - top - 2);
    c.fillStyle = reed[2]; c.fillRect(rx - 1, top + 3, 1, y - top - 2);
    c.fillStyle = '#7a4a22'; c.fillRect(rx, top, 1, 3);
    c.fillStyle = '#a86a32'; c.fillRect(rx, top, 1, 1);
  }
}

/* A deer, head up: it has heard the dog. Paler in the dark woods, where a
   brown deer is a hole in the trees. */
function deer(c, x, y, land) {
  const B = LANDS[land].dark ? ['#2a2420', '#6a5a48', '#9a8a70', '#c0b294', '#eee4c8'] : ['#4a2a18', '#7a4a26', '#a8703a', '#c8934e', '#ecd8ae'];
  ground(c, x, y + 1, 8, land);
  // Far legs, then the body, then the near ones.
  c.fillStyle = B[0]; c.fillRect(x - 5, y - 8, 1, 8); c.fillRect(x + 4, y - 8, 1, 8);
  ellipse(c, x, y - 11, 7, 4, B[0]);
  ellipse(c, x, y - 11, 6, 3, B[2]);
  c.fillStyle = B[3]; c.fillRect(x - 4, y - 14, 9, 1); c.fillRect(x - 5, y - 13, 6, 1);
  c.fillStyle = B[1]; c.fillRect(x - 4, y - 9, 9, 1);
  c.fillStyle = B[4]; c.fillRect(x - 7, y - 13, 2, 3); c.fillRect(x - 3, y - 8, 6, 1);
  c.fillStyle = B[1]; c.fillRect(x - 3, y - 8, 1, 8); c.fillRect(x + 6, y - 8, 1, 8);
  c.fillStyle = B[2]; c.fillRect(x - 4, y - 8, 1, 4); c.fillRect(x + 5, y - 8, 1, 4);
  c.fillStyle = B[0]; c.fillRect(x - 3, y - 1, 1, 1); c.fillRect(x + 6, y - 1, 1, 1);
  // Neck and head, lifted.
  c.fillStyle = B[0]; c.fillRect(x + 4, y - 18, 5, 6); c.fillRect(x + 6, y - 21, 6, 5);
  c.fillStyle = B[2]; c.fillRect(x + 5, y - 17, 3, 5); c.fillRect(x + 7, y - 20, 4, 3);
  c.fillStyle = B[3]; c.fillRect(x + 5, y - 17, 1, 4); c.fillRect(x + 7, y - 20, 3, 1);
  c.fillStyle = B[4]; c.fillRect(x + 6, y - 14, 2, 2);
  c.fillStyle = '#0c0a0e'; c.fillRect(x + 9, y - 19, 1, 1); c.fillRect(x + 11, y - 18, 1, 1);
  c.fillStyle = B[1]; c.fillRect(x + 6, y - 22, 1, 2);
  c.fillStyle = B[4];
  for (const [dx, dy, w, h] of [[8, -25, 1, 4], [7, -26, 1, 2], [9, -27, 1, 2], [10, -25, 1, 3], [11, -27, 1, 3], [12, -26, 1, 1]]) c.fillRect(x + dx, y + dy, w, h);
}

function tent(c, x, y, land) {
  const T = ['#6a2a1c', '#a8482a', '#e8743a', '#f6a05a', '#ffd6a0'];
  ground(c, x + 2, y + 1, 12, land);
  for (let j = 0; j < 13; j++) {
    const half = R(j * 0.9) + 1;
    c.fillStyle = T[0]; c.fillRect(x - half - 1, y - 12 + j, half * 2 + 3, 1);
    c.fillStyle = T[2]; c.fillRect(x - half, y - 12 + j, half, 1);
    c.fillStyle = T[1]; c.fillRect(x, y - 12 + j, half + 1, 1);
    c.fillStyle = T[3]; c.fillRect(x - half, y - 12 + j, 1, 1);
  }
  // The door, unzipped; guy lines pegged out; a lantern by the door.
  for (let j = 0; j < 8; j++) { c.fillStyle = '#2a1626'; c.fillRect(x - R(j * 0.3), y - 7 + j, R(j * 0.6) + 1, 1); }
  c.fillStyle = '#d8d2c0'; c.fillRect(x - 14, y, 2, 1); c.fillRect(x + 12, y, 2, 1);
  c.fillStyle = '#2a2420'; c.fillRect(x + 13, y - 5, 3, 6);
  c.fillStyle = LAMP[2]; c.fillRect(x + 14, y - 4, 1, 3);
  glow(c, x + 14, y + 1, 8, 3, [255, 214, 120], 0.16);
}

/* A boulder left by something older than the trees, moss on its weather side. */
export function boulder(c, x, y, r, land) {
  const L = LANDS[land], K = L.rock, ry = R(r * 0.72);
  ellipse(c, x + R(r * 0.6) + 1, y + 1, r, Math.max(2, R(r * 0.4)), castOf(land));
  ellipse(c, x, y - ry + 1, r, ry, K[0]);
  ellipse(c, x, y - ry, r, ry, K[1]);
  ellipse(c, x - 1, y - ry - 1, r - 1, ry - 1, K[2]);
  ellipse(c, x - R(r * 0.3), y - ry - R(ry * 0.3), R(r * 0.55), Math.max(1, R(ry * 0.5)), K[3]);
  c.fillStyle = K[0]; c.fillRect(x + R(r * 0.2), y - ry + 1, 1, R(ry * 0.8)); c.fillRect(x + R(r * 0.2) + 1, y - 2, 2, 1);
  if (L.moss) {
    ellipse(c, x - 1, y - ry * 2 + 2, R(r * 0.7), 1, L.mossLo);
    c.fillStyle = L.moss; c.fillRect(x - R(r * 0.5), y - ry * 2 + 1, R(r * 0.7), 1);
  }
}

/* Felled timber stacked beside the forestry road: sawn ends, pale and round. */
function logpile(c, x, y, land) {
  const T = ['#2a1c14', '#5a4230', '#86623e', '#c8a06a', '#ecd8a4'];
  ground(c, x + 3, y + 1, 13, land);
  for (const [row, n, dx] of [[0, 5, 0], [1, 4, 3], [2, 3, 6]]) for (let k = 0; k < n; k++) {
    const cx = x - 12 + dx + k * 6, cy = y - 3 - row * 5;
    disc(c, cx, cy, 3, T[0]); disc(c, cx, cy, 2, T[3]);
    c.fillStyle = T[4]; c.fillRect(cx - 1, cy - 1, 2, 1);
    c.fillStyle = T[2]; c.fillRect(cx, cy, 1, 1);
  }
  // The stack runs back from the road: bark along its top.
  c.fillStyle = T[1]; c.fillRect(x - 6, y - 17, 15, 1); c.fillRect(x - 3, y - 18, 13, 1);
  c.fillStyle = T[0]; c.fillRect(x + 9, y - 17, 7, 14);
  c.fillStyle = T[1]; c.fillRect(x + 9, y - 16, 5, 12);
}

/* The car park's sign: a blue plate on a post. */
function parkSign(c, x, y, land) {
  ground(c, x, y + 1, 4, land);
  c.fillStyle = '#2a2a30'; c.fillRect(x - 1, y - 14, 3, 15);
  c.fillStyle = '#9aa2aa'; c.fillRect(x - 1, y - 14, 1, 14);
  c.fillStyle = '#10244a'; c.fillRect(x - 5, y - 24, 11, 11);
  c.fillStyle = '#2a5aa8'; c.fillRect(x - 4, y - 23, 9, 9);
  c.fillStyle = '#5a8ad8'; c.fillRect(x - 4, y - 23, 9, 1);
  c.fillStyle = '#ffffff'; c.fillRect(x - 2, y - 21, 1, 6); c.fillRect(x - 1, y - 21, 3, 1); c.fillRect(x + 1, y - 20, 1, 2); c.fillRect(x - 1, y - 18, 3, 1);
}

/** A named thing at (x, y), in the colours of the land it stands in. */
export function landmark(c, name, x, y, land = 'forest') {
  const dim = LANDS[land].dark;
  if (name === 'pond') return pond(c, x, y, land);
  if (name === 'log') {
    stamp(c, LANDMARKS.log, x - 7, y - 2, dim ? { b: '#5a4638', w: '#b8a080', d: '#6a5240' } : { b: '#7a5232', w: '#d9b07a', d: '#8a5a32' });
    c.fillStyle = dim ? LANDS[land].moss : '#e8d45a'; c.fillRect(x - 3, y - 3, 2, 1); c.fillRect(x + 2, y - 3, 1, 1);
    return;
  }
  if (name === 'mushrooms') {
    stamp(c, LANDMARKS.mushroom, x - 5, y - 4, { r: '#d9412b', w: '#fff4e0', s: '#f0e2c4' });
    stamp(c, LANDMARKS.mushroomS, x + 2, y - 1, { r: '#c2521e', w: '#fff4e0', s: '#f0e2c4' });
    return;
  }
  if (name === 'stump') return stamp(c, LANDMARKS.stump, x - 3, y - 4, dim ? { b: '#5a4638', w: '#b8a080' } : { b: '#7a5232', w: '#d9b07a' });
  if (name === 'deer') return deer(c, x, y, land);
  if (name === 'signpost') return stamp(c, LANDMARKS.signpost, x - 5, y - 10, { p: '#5e3a1e', w: dim ? '#e6d2a8' : '#d9b07a', d: '#5e3a1e' });
  if (name === 'tent') return tent(c, x, y, land);
  if (name === 'logpile') return logpile(c, x, y, land);
  if (name === 'parksign') return parkSign(c, x, y, land);
}

/** The field gate at the trailhead, standing open, and the fence running
    off to both sides of the field: come in. */
export function fieldGate(c, x, y, W) {
  const T = RAIL;
  const post = (px0, tall) => {
    c.fillStyle = castOf('field'); c.fillRect(px0 + 2, y, 5, 2);
    c.fillStyle = T[0]; c.fillRect(px0 - 1, y - tall, 4, tall + 1);
    c.fillStyle = T[2]; c.fillRect(px0, y - tall, 2, tall);
    c.fillStyle = T[4]; c.fillRect(px0, y - tall, 1, tall - 1); c.fillRect(px0, y - tall - 1, 2, 1);
  };
  const rails = (a, b) => {
    for (const ry of [y - 9, y - 5]) { c.fillStyle = T[0]; c.fillRect(a, ry + 1, b - a, 1); c.fillStyle = T[3]; c.fillRect(a, ry, b - a, 1); c.fillStyle = T[4]; c.fillRect(a, ry - 1, b - a, 1); }
  };
  rails(0, x - 11); rails(x + 12, W);
  for (let fx = x - 25; fx > -4; fx -= 14) post(fx, 11);
  for (let fx = x + 25; fx < W + 4; fx += 14) post(fx, 11);
  // The gate, swung back against the fence on the far side.
  const gx = x - 31;
  for (const ry of [y - 14, y - 11, y - 8, y - 5, y - 2]) { c.fillStyle = T[0]; c.fillRect(gx + 1, ry + 1, 18, 1); c.fillStyle = T[4]; c.fillRect(gx + 1, ry, 18, 1); }
  c.fillStyle = T[3]; for (let k = 0; k < 13; k++) c.fillRect(gx + 3 + k, y - 14 + k, 2, 1);
  c.fillStyle = T[0]; c.fillRect(gx, y - 15, 2, 15); c.fillStyle = T[4]; c.fillRect(gx, y - 15, 1, 14);
  post(x - 12, 15); post(x + 11, 15);
}
const RAIL = ['#3a2620', '#5c3d2a', '#80583a', '#a67c4e', '#caa26a'];

/** A car, parked side on. `left` turns it the other way. Thirty pixels
    long: a dog of forty-eight had been walking past a car of fourteen.
    `beams`: its headlamps are on, and light the road ahead of it. */
export function car(c, x, y, colour, left, beams) {
  const s = left ? -1 : 1;
  const r = (dx, dy, w, h, col) => { c.fillStyle = col; c.fillRect(s > 0 ? x + dx : x - dx - w + 1, y + dy, w, h); };
  const ink = darker(colour, 0.62), lo = darker(colour, 0.3), hi = lighter(colour, 0.32);
  if (beams) {
    // Two cones of light lying on the road, breaking up as they go.
    for (let k = 0; k < 46; k++) {
      const half = 2 + R(k * 0.16), a = k < 10 ? 0.5 : k < 26 ? 0.32 : 0.18;
      c.fillStyle = `rgba(255,244,196,${a})`;
      for (let j = -half; j <= half; j++) if (k < 20 || bayer(x + s * (16 + k), y - 3 + j) < 1.3 - k / 46) c.fillRect(x + s * (16 + k), y - 3 + j, 1, 1);
    }
  }
  c.fillStyle = 'rgba(4,8,14,0.42)'; c.fillRect(x - 14, y, 30, 2); c.fillRect(x - 11, y + 2, 26, 1);
  r(-15, -8, 30, 7, ink); r(-9, -13, 16, 6, ink); r(-10, -11, 1, 3, ink); r(7, -10, 2, 2, ink);
  r(-14, -7, 28, 5, colour); r(-14, -7, 28, 1, hi); r(-14, -4, 28, 2, lo);
  r(-8, -12, 14, 5, colour); r(-8, -12, 14, 1, hi); r(6, -10, 2, 3, colour); r(-9, -10, 1, 3, colour);
  // Glass, the sky in the corner of each pane.
  r(-7, -11, 5, 3, '#3a5a78'); r(0, -11, 6, 3, '#3a5a78'); r(6, -10, 1, 2, '#3a5a78');
  r(-7, -11, 2, 1, '#bcd8e0'); r(0, -11, 3, 1, '#bcd8e0'); r(0, -10, 1, 1, '#bcd8e0');
  // A door's line, a handle, lamps front and back.
  r(-1, -7, 1, 4, lo); r(1, -6, 2, 1, ink);
  r(13, -6, 2, 2, beams ? '#ffffff' : '#fff0b0'); r(-15, -6, 1, 2, '#e04a3a'); r(-15, -3, 30, 1, ink);
  for (const wx of [-9, 8]) {
    const cx = x + s * wx;
    disc(c, cx, y - 2, 3, '#0c0e14'); disc(c, cx, y - 2, 1, '#8a9298');
    c.fillStyle = '#c8d0d8'; c.fillRect(cx, y - 3, 1, 1);
  }
}

/* ── The foresters' hamlet ── */

/* Lamplight: the only warm colour in the old woods. */
const LAMP = ['#7a3e1c', '#c8742a', '#ffd36a', '#fff4c2', '#ffffff'];
const IRON = ['#14181c', '#262c32', '#3c444a', '#5a646a', '#8a969a'];
const STONE = ['#22262a', '#4c5456', '#7a8480', '#a8b0a6', '#d8dccc'];

/** A pool of light on the ground: three rings, the outermost breaking up. */
function lightPool(c, x, y, rx, ry) {
  for (let dy = -ry; dy <= ry; dy++) {
    for (let dx = -rx; dx <= rx; dx++) {
      const d = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry);
      if (d > 1) continue;
      if (d > 0.62 && bayer(x + dx, y + dy) < (d - 0.62) * 2.6) continue;
      c.fillStyle = d < 0.12 ? 'rgba(255,226,150,0.55)' : d < 0.36 ? 'rgba(255,220,134,0.36)' : 'rgba(255,214,120,0.2)';
      c.fillRect(x + dx, y + dy, 1, 1);
    }
  }
}

/** How high a lantern's light is above its foot (ambient.js reads it). */
export const LAMP_TOP = 21;

/** A lantern on an iron post, a stone at its foot, a lit glass, and its
    pool of light on the ground. */
export function lamp(c, x, base) {
  lightPool(c, x, base + 1, 19, 8);
  c.fillStyle = STONE[0]; c.fillRect(x - 2, base - 2, 5, 3);
  c.fillStyle = STONE[2]; c.fillRect(x - 1, base - 2, 3, 2);
  c.fillStyle = STONE[3]; c.fillRect(x - 1, base - 2, 1, 1);
  c.fillStyle = IRON[0]; c.fillRect(x - 1, base - 17, 3, 15);
  c.fillStyle = IRON[3]; c.fillRect(x - 1, base - 17, 1, 15);
  c.fillStyle = LAMP[1]; c.fillRect(x, base - 17, 1, 5);
  // The lantern: a cap, four panes of glass, a collar.
  c.fillStyle = IRON[0];
  c.fillRect(x - 3, base - 18, 7, 1); c.fillRect(x - 4, base - 23, 9, 1); c.fillRect(x - 2, base - 24, 5, 1); c.fillRect(x - 1, base - 25, 3, 1); c.fillRect(x, base - 26, 1, 1);
  c.fillRect(x - 3, base - 22, 1, 4); c.fillRect(x + 3, base - 22, 1, 4);
  c.fillStyle = IRON[3]; c.fillRect(x - 3, base - 23, 4, 1); c.fillRect(x - 1, base - 24, 2, 1);
  c.fillStyle = LAMP[2]; c.fillRect(x - 2, base - 22, 5, 4);
  c.fillStyle = LAMP[3]; c.fillRect(x - 1, base - 22, 3, 3);
  c.fillStyle = LAMP[4]; c.fillRect(x, base - 21, 1, 2);
  // Its halo in the dark under the trees.
  for (let dy = -6; dy <= 6; dy++) for (let dx = -7; dx <= 7; dx++) {
    const d = Math.hypot(dx, dy * 1.15);
    if (d > 3.6 && d <= 7 && bayer(x + dx, base - 20 + dy) < (7.4 - d) * 0.13) { c.fillStyle = 'rgba(255,224,140,0.5)'; c.fillRect(x + dx, base - 20 + dy, 1, 1); }
  }
}

/* Cottage walls and roofs: three of each, picked by the seed. Field stone,
   tarred weatherboard, limewash; slate, moss-grown tile, thatch. */
const WALLS = [
  ['#22262a', '#4c5456', '#7a8480', '#a8b0a6', '#d8dccc'],
  ['#1c1410', '#3a2a20', '#5a4230', '#80623e', '#b08e5c'],
  ['#3a4044', '#7c8684', '#b4bcb0', '#d8dccc', '#f4f2e2'],
];
const ROOFS = [
  ['#10181e', '#22323a', '#384c54', '#587078', '#8ca4a4'],
  ['#14241c', '#28402c', '#40603e', '#628454', '#94b078'],
  ['#32260f', '#5e4a22', '#8a7034', '#b4984e', '#dcc47c'],
];
const DOOR = ['#1a100c', '#3a2418', '#5c3d2a', '#80583a', '#a67c4e'];

/** Where a cottage's parts are, from what scene.js keeps about it: used to
    paint it and (ambient.js) to flicker its windows and lift its smoke. */
export function houseParts(x, base, w, h, seed) {
  const x0 = x - (w >> 1), top = base - h;
  // 0: eaves to the lane. 1: gable to the lane. 2: eaves, with a dormer.
  const kind = Math.min(2, Math.floor(hash(seed + 11) * 3));
  const rh = kind === 1 ? R(w * 0.3) : 9;
  const right = hash(seed + 2) > 0.5;
  const chx = x0 + (right ? w - 9 : 5), chy = kind === 1 ? top - R(rh * 0.55) - 4 : top - rh - 4;
  const n = Math.max(2, Math.floor((w - 6) / 10));
  const door = Math.floor(hash(seed + 3) * n);
  const wins = [];
  let doorX = x0 + 4;
  for (let k = 0; k < n; k++) {
    const wx = x0 + R((w - (n - 1) * 10 - 5) / 2) + k * 10;
    if (k === door) { doorX = wx; continue; }
    wins.push({ x: wx, y: top + 4, w: 5, h: 6, lit: hash(seed * 7 + k) > 0.25, ground: true });
  }
  if (kind === 1) wins.push({ x: x - 2, y: top - R(rh * 0.5), w: 5, h: 4, lit: hash(seed + 21) > 0.4 });
  if (kind === 2) wins.push({ x: x0 + (right ? 6 : w - 12), y: top - 7, w: 5, h: 4, lit: hash(seed + 21) > 0.3, dormer: true });
  return { x0, top, rh, kind, chx, chy, wins, doorX, smoke: hash(seed + 9) > 0.5 };
}

/** A forester's cottage seen from the lane, what light there is on its
    left: a roof with a lit slope and a dark one, a chimney, a door with a
    step, windows that throw their light on the ground, and its shadow
    lying down to the right. */
export function house(c, x, base, w, h, seed) {
  const P = houseParts(x, base, w, h, seed);
  const { x0, top, rh, kind } = P;
  const wi = Math.floor(hash(seed) * 3) % 3;
  const wall = WALLS[wi], roof = ROOFS[Math.floor(hash(seed + 5) * 3) % 3];
  // Its shadow: along the foot and out to the right, the last row breaking up.
  c.fillStyle = castOf('old');
  for (let r = 0; r < 5; r++) for (let px = x0 + 2 + r * 2; px < x0 + w + 4 + r * 2; px++) if (r < 4 || bayer(px, base + r) < 0.5) c.fillRect(px, base + 1 + r, 1, 1);
  for (let k = 0; k < 9; k++) c.fillRect(x0 + w, base - k, 9 - k, 1);

  // The chimney first, so the roof crosses its foot.
  const ch = STONE;
  c.fillStyle = ch[0]; c.fillRect(P.chx - 1, P.chy - 1, 6, 10);
  c.fillStyle = ch[2]; c.fillRect(P.chx, P.chy, 4, 9);
  c.fillStyle = ch[3]; c.fillRect(P.chx, P.chy, 1, 9); c.fillRect(P.chx, P.chy, 4, 1);
  c.fillStyle = ch[1]; c.fillRect(P.chx + 3, P.chy + 1, 1, 8);

  // The wall: light on its left edge, shade to the right and under the eaves.
  c.fillStyle = wall[0]; c.fillRect(x0 - 1, top, w + 2, h + 1);
  c.fillStyle = wall[2]; c.fillRect(x0, top, w, h);
  c.fillStyle = wall[3]; c.fillRect(x0, top, 1, h);
  c.fillStyle = wall[1]; c.fillRect(x0 + w - 3, top, 3, h); c.fillRect(x0, base - 1, w, 1); c.fillRect(x0, top, w, 2);
  for (let px = x0; px < x0 + w; px++) if (bayer(px, top + 2) < 0.5) c.fillRect(px, top + 2, 1, 1);
  if (wi < 2) {
    // Courses of stone, or the boards' joints: short dashes, not a grid.
    for (let y = top + 4; y < base - 1; y += 3) for (let px = x0 + 1 + ((y / 3) & 1) * 3; px < x0 + w - 4; px += 6) if (hash(px * 7 + y * 13 + seed) < (wi ? 0.9 : 0.5)) { c.fillStyle = wall[1]; c.fillRect(px, y, wi ? 5 : 3, 1); }
  }

  if (kind === 1) {
    // Gable to the lane: the wall runs up into the roof's point.
    const half = (w >> 1) + 3;
    for (let j = 0; j <= rh; j++) {
      const hw = R(half * j / rh), y = top - rh + j;
      if (hw > 2) { c.fillStyle = j < 4 ? wall[1] : wall[2]; c.fillRect(x - hw + 2, y, hw * 2 - 3, 1); }
      c.fillStyle = roof[0]; c.fillRect(x - hw - 1, y, 4, 2); c.fillRect(x + hw - 2, y, 4, 2);
      c.fillStyle = roof[3]; c.fillRect(x - hw, y, 3, 1);
      c.fillStyle = roof[1]; c.fillRect(x + hw - 1, y, 2, 1);
    }
    c.fillStyle = roof[4]; c.fillRect(x - 1, top - rh - 1, 2, 1);
  } else {
    // Eaves to the lane: a lit slope, tiles in broken rows, a dark eave.
    for (let j = 0; j < rh; j++) {
      const inset = R((rh - 1 - j) * 0.8), y = top - rh + j + 1, a0 = x0 - 2 + inset, b0 = x0 + w + 2 - inset;
      const split = b0 - R((b0 - a0) * 0.3) - j;
      c.fillStyle = roof[0]; c.fillRect(a0 - 1, y, b0 - a0 + 2, 2);
      c.fillStyle = j === 0 ? roof[4] : roof[3]; c.fillRect(a0, y, split - a0, 1);
      c.fillStyle = j === 0 ? roof[3] : roof[2]; c.fillRect(split, y, b0 - split, 1);
      if (j > 0 && j % 3 === 2) { for (let px = a0 + 1 + (j & 1) * 2; px < b0 - 2; px += 5) { c.fillStyle = px < split ? roof[2] : roof[1]; c.fillRect(px, y, 3, 1); } }
      if (j === rh - 1) { c.fillStyle = roof[1]; c.fillRect(a0, y, b0 - a0, 1); }
    }
  }

  const pane = (wn) => {
    const { x: wx, y: wy, w: ww, h: wh, lit } = wn;
    if (wn.dormer) {
      c.fillStyle = roof[0]; c.fillRect(wx - 2, wy - 3, ww + 4, wh + 4); c.fillRect(wx - 1, wy - 4, ww + 2, 1);
      c.fillStyle = roof[3]; c.fillRect(wx - 1, wy - 3, ww + 1, 1); c.fillRect(wx, wy - 4, ww - 1, 1);
      c.fillStyle = wall[2]; c.fillRect(wx - 1, wy - 2, ww + 2, wh + 2);
    }
    c.fillStyle = wall[0]; c.fillRect(wx - 1, wy - 1, ww + 2, wh + 2);
    c.fillStyle = lit ? LAMP[2] : '#16222a'; c.fillRect(wx, wy, ww, wh);
    if (lit) { c.fillStyle = LAMP[3]; c.fillRect(wx, wy, 2, R(wh / 2)); c.fillStyle = LAMP[1]; c.fillRect(wx + 3, wy + R(wh / 2) + 1, 2, wh - R(wh / 2) - 1); }
    else { c.fillStyle = '#4a6470'; c.fillRect(wx, wy, 1, 2); c.fillRect(wx + 1, wy, 1, 1); }
    c.fillStyle = wall[0]; c.fillRect(wx + 2, wy, 1, wh); if (wh > 4) c.fillRect(wx, wy + R(wh / 2), ww, 1);
    if (wn.ground) { c.fillStyle = wall[3]; c.fillRect(wx - 1, wy + wh + 1, ww + 2, 1); }
  };
  P.wins.forEach(pane);

  // The door, its step, and a light over it.
  const dx = P.doorX, D = DOOR;
  c.fillStyle = wall[0]; c.fillRect(dx - 1, base - 11, 8, 11);
  c.fillStyle = D[3]; c.fillRect(dx, base - 10, 6, 10);
  c.fillStyle = D[4]; c.fillRect(dx, base - 10, 1, 10); c.fillRect(dx + 1, base - 9, 4, 1);
  c.fillStyle = D[2]; c.fillRect(dx + 3, base - 8, 1, 8);
  c.fillStyle = LAMP[2]; c.fillRect(dx + 4, base - 5, 1, 1); c.fillRect(dx + 2, base - 13, 2, 1);
  c.fillStyle = LAMP[4]; c.fillRect(dx + 2, base - 12, 2, 1);
  c.fillStyle = STONE[3]; c.fillRect(dx - 1, base, 8, 1);
  c.fillStyle = STONE[1]; c.fillRect(dx - 1, base + 1, 8, 1);

  // What the windows and the door's light throw on the ground.
  const spill = (sx, sw, far) => {
    for (let r = 0; r < far; r++) {
      const a2 = r < 2 ? 0.36 : r < 4 ? 0.24 : 0.16;
      c.fillStyle = `rgba(255,216,124,${a2})`;
      for (let px = sx - 1 - r; px < sx + sw + 1 + r + 2; px++) if (r < 2 || bayer(px, base + 2 + r) < (r < 4 ? 0.7 : 0.4)) c.fillRect(px, base + 2 + r, 1, 1);
    }
  };
  for (const wn of P.wins) if (wn.lit && wn.ground) spill(wn.x, wn.w, 6);
  spill(dx + 1, 4, 4);
}

/* ── The air of a deep wood ── */

/** A wisp of mist lying between the trees: a solid shape with a paler heart. */
export function wisp(c, x, y, len, rgb, a) {
  const h = len >> 1;
  c.fillStyle = `rgba(${rgb},${a})`;
  c.fillRect(x - h + 6, y - 1, len - 16, 1); c.fillRect(x - h, y, len, 1); c.fillRect(x - h + 3, y + 1, len - 2, 1); c.fillRect(x - h + 10, y + 2, len - 22, 1);
  c.fillStyle = `rgba(${rgb},${a * 0.9})`;
  c.fillRect(x - h + 9, y, len - 20, 2);
}

/** A shaft of light through a gap in the canopy, and where it lands.
    `rgb` is the light's colour: the sun in the forest, the moon further in. */
export function shaft(c, x, y, w, len, rgb = [255, 244, 196]) {
  const col = rgb.join(',');
  for (let j = 0; j < len; j++) {
    const row = y - len + j, xs = R(x - (len - j) * 0.55), k = j / len;
    c.fillStyle = `rgba(${col},0.13)`; c.fillRect(xs, row, w, 1);
    c.fillStyle = `rgba(${col},0.11)`; c.fillRect(xs + 2, row, Math.max(1, w - 5), 1);
    if (k > 0.5 && (j + xs) % 5 === 0) { c.fillStyle = `rgba(${col},0.5)`; c.fillRect(xs + 1 + ((j * 7) % Math.max(1, w - 2)), row, 1, 1); }
  }
  glow(c, x + (w >> 1), y, w + 4, 4, rgb, 0.14);
}

/** Two eyes in the dark. */
export function eyes(c, x, y) {
  c.fillStyle = 'rgba(230,240,106,0.25)'; c.fillRect(x - 1, y, 6, 1); c.fillRect(x, y - 1, 1, 3); c.fillRect(x + 3, y - 1, 1, 3);
  c.fillStyle = '#e6f06a'; c.fillRect(x, y, 1, 1); c.fillRect(x + 3, y, 1, 1);
}
