/* What stands on the board: the lands' colours, trees, flowers, houses,
   lamps, boulders and the landmarks beside the levels. */

import { bayer, clump, darker, disc, ellipse, hash, lighter, R, stamp } from './core.js';
import { CAST, RAMPS } from './ramps.js';
import { glow } from './terrain.js';

/* One trail climbing four lands: the red meadow (Hot), the amber wood at
   dusk (Warm), then Cold's two, a blue town at night and the climb to a
   snowy summit. A boss stands where a land ends: the stile in the hedge,
   the footbridge over the stream, the gate in the town wall, and the cairn
   on the summit.

   The whole ladder is some 4,000 art pixels tall, more than an old iPhone
   will give one canvas, so nothing here needs the whole board at once:
   drawBoard paints any band of rows, and the same band is always painted
   the same way, whichever tile asks for it. */

export const BOARD_LANDS = {
  hot: {
    g: '#9cc35a', gHi: '#b2d06c', gLo: '#87ae49', tuft: '#6c9a3c', dirt: '#d9b679', dirtHi: '#e8cb94', dirtLo: '#9a7444',
    fl: '#d9412b', flHi: '#f27a5c', fl2: '#f3d34a', eye: '#3a1a14',
    tree: '#4c8236', treeHi: '#6aa246', treeLo: '#35602a', trunk: '#6b4a2e', print: '#a9844f',
    haw: '#6a9a40', hawHi: '#88b656', hawLo: '#4a7430', berry: '#c8302a',
  },
  warm: {
    g: '#a86f36', gHi: '#c4893f', gLo: '#8f5a2a', tuft: '#7a4c24', dirt: '#d7b47c', dirtHi: '#e6c896', dirtLo: '#6e4a22',
    fl: '#e8953a', flHi: '#f4b04a', fl2: '#c2521e', eye: '#4a2a10',
    tree: '#c8701e', treeHi: '#e89a3a', treeLo: '#8a4a14', trunk: '#4a2e1a', print: '#a07a48',
    haw: '#b8541e', hawHi: '#d8742e', hawLo: '#7e3412', berry: '#f2c14e',
    pine: '#2f4a2a', pineHi: '#476a36', pineRim: '#d08a2a',
    leaves: ['#d9822a', '#b8521c', '#f0b048'],
  },
  /* The town at night: blue ground, a cobbled street, lit windows. */
  town: {
    g: '#263c66', gHi: '#2f4877', gLo: '#1f3157', tuft: '#35517f', dirt: '#8792b3', dirtHi: '#aab3cd', dirtLo: '#141d3a',
    fl: '#ffd36a', flHi: '#fff0b0', fl2: '#8fb0e8', eye: '#141d3a',
    tree: '#2c5a6a', treeHi: '#3f7a88', treeLo: '#1c3d4e', trunk: '#231c2c', print: '#55618a',
    haw: '#2f6078', hawHi: '#44809a', hawLo: '#1f4258', berry: '#ffd36a',
    pine: '#1f3f48', pineHi: '#2c5a60', pineRim: '#6a86b8',
    lit: '#ffd36a', litHi: '#fff0b0', dark: '#121a36', cobble: '#5d6990',
  },
  /* The climb: moonlit rock low down, snow from half way, then the sky. */
  alp: {
    g: '#56658a', gHi: '#67769c', gLo: '#475478', tuft: '#3d4a6b', dirt: '#aab8d2', dirtHi: '#d0daea', dirtLo: '#566489',
    snow: '#e4ecf7', snowHi: '#ffffff', snowLo: '#bccbe3',
    fl: '#ffffff', flHi: '#ffffff', fl2: '#bccbe3', eye: '#3d4a6b',
    tree: '#2a4a48', treeHi: '#3b6460', treeLo: '#1c3534', trunk: '#3a2e2a', print: '#8496ba',
    pine: '#28504a', pineHi: '#3a6c62', pineRim: '#e4ecf7', capped: true,
    lit: '#ffd36a', litHi: '#fff0b0',
    sky: ['#0a0f2c', '#0f1740', '#172254', '#22306a'], star: '#fff3c4', starLo: '#93a8de', far: '#2a3768', farSnow: '#aebfe2',
    aurora: '#5fe0a8', auroraLo: '#2f9aa8',
  },
};

/* Scenery: big trees (taller than the people, as on a map), flower clumps
   and landmarks, all kept off the trail, the stones and the places the
   team stands. */
/* What a land's cast shadows are made of (ramps.js): never black. */
function castOf(L) {
  const key = L === BOARD_LANDS.warm ? 'wood' : L === BOARD_LANDS.town ? 'town' : L === BOARD_LANDS.alp ? 'climb' : 'meadow';
  const [hex, a] = CAST[key];
  const n = parseInt(hex.slice(1), 16);
  return [`rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`, key === 'wood' ? 1.2 : key === 'town' ? 0.4 : key === 'climb' ? 0.8 : 0.5];
}

/* The shadow a standing thing throws: an ellipse on the ground down and to
   the right of its foot, as long as the land's light is low, its edge
   broken up so it never ends on a hard line. */
function castShadow(c, x, base, r, L) {
  const [col, len] = castOf(L);
  const rx = R(r * (0.8 + len * 0.5)), ry = Math.max(2, R(r * 0.34));
  const cx = x + R(r * len * 0.7) + 1, cy = base + 1;
  c.fillStyle = col;
  for (let y = -ry; y <= ry; y++) {
    const half = R(rx * Math.sqrt(Math.max(0, 1 - (y * y) / ((ry + 0.5) * (ry + 0.5)))));
    c.fillRect(cx - half + 1 + y, cy + y, half * 2 - 1, 1);
    if (bayer(cx - half + y, cy + y) < 0.5) c.fillRect(cx - half + y, cy + y, 1, 1);
    if (bayer(cx + half + y, cy + y) < 0.5) c.fillRect(cx + half + y, cy + y, 1, 1);
  }
}

export function tree(c, x, base, L, r, kind) {
  const trunkH = kind === 'haw' ? 5 : 7;
  castShadow(c, x, base, r, L);
  // The trunk: lit down its left, flared at the foot, its dark side its own
  // deep tone rather than a black line.
  const deep = darker(L.trunk, 0.5);
  c.fillStyle = deep; c.fillRect(x - 2, base - trunkH, 5, trunkH + 1); c.fillRect(x - 3, base - 1, 7, 2);
  c.fillStyle = L.trunk; c.fillRect(x - 1, base - trunkH, 3, trunkH); c.fillRect(x - 2, base - 1, 2, 1);
  c.fillStyle = lighter(L.trunk, 0.25); c.fillRect(x - 1, base - trunkH, 1, trunkH - 1);
  const cy = base - trunkH - r + 2;
  if (kind === 'pine') {
    // Three filled tiers, dark green with a rim where the low light catches:
    // amber in the wood at dusk, snow on the mountain.
    const edge = darker(L.pine, 0.55);
    for (let k = 0; k < 3; k++) {
      const ty = cy - r + 1 + k * 5, w = 2 + k * 2 + R(r / 4);
      for (let j = 0; j < 7; j++) {
        const half = R(w * (j + 1) / 7);
        c.fillStyle = edge; c.fillRect(x - half - 1, ty + j, half * 2 + 3, 2);
      }
      c.fillStyle = edge; c.fillRect(x - w - 1, ty + 6, w * 2 + 3, 2);
      for (let j = 0; j < 7; j++) {
        const half = R(w * (j + 1) / 7);
        c.fillStyle = j > 4 ? darker(L.pine, 0.3) : L.pine; c.fillRect(x - half, ty + j, half * 2 + 1, 1);
        c.fillStyle = L.pineRim; c.fillRect(x - half, ty + j, 1, 1);
        if (j < 3) { c.fillStyle = L.pineHi; c.fillRect(x - half + 1, ty + j, Math.max(0, half), 1); }
        // Snow lies on the top of each tier.
        if (L.capped && j < 2 + (k === 0 ? 1 : 0)) { c.fillStyle = L.pineRim; c.fillRect(x - half, ty + j, half * 2 + 1 - (j ? 1 : 0), 1); }
      }
    }
    return;
  }
  // A broadleaf crown: three masses of leaves, the highest and leftmost in
  // the light, each shaded in clumps and dark only underneath.
  const col = kind === 'haw' ? [L.haw, L.hawHi, L.hawLo] : [L.tree, L.treeHi, L.treeLo];
  const ramp = [darker(col[2], 0.38), col[2], col[0], col[1], lighter(col[1], 0.22)];
  const seed = x * 7 + base;
  const a = Math.max(3, R(r * 0.72)), b = Math.max(3, R(r * 0.84));
  clump(c, x + R(r * 0.5), cy + R(r * 0.36), a, R(a * 0.86), ramp, seed + 3);
  clump(c, x - R(r * 0.52), cy + R(r * 0.24), a, R(a * 0.9), ramp, seed + 11);
  clump(c, x, cy - R(r * 0.2), b, R(b * 0.88), ramp, seed);
  if (kind === 'haw') {
    // Hawthorn: berries in the leaves, in twos.
    c.fillStyle = L.berry;
    for (let k = 0; k < 5; k++) { const bx = x - r + 3 + R(hash(x * 5 + k) * (r * 2 - 7)), by = cy - r + 4 + R(hash(base * 3 + k) * (r * 2 - 8)); c.fillRect(bx, by, 2, 1); }
  }
}

/** A poppy: red petals round a dark eye, on a stem. */
export function poppy(c, x, y, L) {
  c.fillStyle = L.tuft; c.fillRect(x, y + 2, 1, 1);
  c.fillStyle = L.fl; c.fillRect(x - 1, y, 3, 1); c.fillRect(x, y - 1, 1, 3);
  c.fillStyle = L.flHi; c.fillRect(x - 1, y - 1, 1, 1);
  c.fillStyle = L.eye; c.fillRect(x, y, 1, 1);
}

export function flowerClump(c, x, y, L, rnd) {
  for (let k = 0; k < 4; k++) {
    const fx = x + R(rnd() * 6) - 3, fy = y + R(rnd() * 4) - 2;
    c.fillStyle = L.tuft; c.fillRect(fx, fy + 1, 1, 1);
    c.fillStyle = k === 3 ? L.fl2 : L.fl; c.fillRect(fx, fy, 1, 1);
    if (k === 0) { c.fillStyle = L.flHi; c.fillRect(fx + 1, fy, 1, 1); }
  }
}

const LANDMARKS = {
  sheep: ['..wwww...', '.wwwwwwdd', 'wwwwwwwdd', '.wwwwww..', '.d.d..d..'],
  log: ['.bbbbbbbbbbbB.', 'bBbbbbBbbbbbww', 'bbbbbbbbbbbbwd', '.BBBBBBBBBBBB.'],
  mushroom: ['.rrr.', 'rwrrw', 'rrrrr', '..s..', '..s..'],
  mushroomS: ['.rr.', 'rwrr', '.s..'],
  stump: ['.bbbb.', 'bwwwwb', 'bwbbwb', 'bBBBBb', 'bBbBBb'],
  deer: [
    '.........a.a.',
    '..........a..',
    '.........bbb.',
    '.........bbbe',
    '..bbbbbbbbb..',
    '.wbbbbbbbbb..',
    '.bbbbbbbbb...',
    '.bBbb...bBb..',
    '.b.b....b.b..',
    '.b.b....b.b..',
  ],
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
  car: [
    '....cccccc....',
    '...cwwcwwwc...',
    '.cccccccccccc.',
    'ycccccccccccCr',
    '.CdddCCCCdddC.',
    '..ddd....ddd..',
  ],
  tent: [
    '......t......',
    '.....ttt.....',
    '....ttTtt....',
    '...tttTttt...',
    '..tttdddttt..',
    '.ttttdddtttt.',
    'tttttdddttttt',
  ],
  snowman: ['..www..', '.wdwdw.', '.wwgww.', '..www..', '.wwwww.', 'wwwdwww', 'wwwwwww', '.wwwww.'],
  bench: ['bbbbbbbbb', 'b.......b', 'bbbbbbbbb', '.b.....b.'],
};

/* The animals and the small things are painted, not stamped: at the size a
   48-pixel dog stands beside them a 9-pixel sheep was a speck. Each has its
   shadow, in the land's own shadow colour. */
function ground(c, x, y, rx, key) {
  const [hex, a] = CAST[key];
  const n = parseInt(hex.slice(1), 16);
  ellipse(c, x + 2, y, rx, Math.max(1, R(rx * 0.3)), `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`);
}

function pond(c, x, y, ice) {
  const W = ice ? RAMPS.climb.ice : RAMPS.meadow.water;
  const bank = ice ? RAMPS.climb.snow[1] : RAMPS.meadow.grass[0];
  ellipse(c, x, y, 17, 7, bank);
  ellipse(c, x, y, 16, 6, W[1]);
  ellipse(c, x - 1, y - 1, 14, 4, W[2]);
  ellipse(c, x - 3, y - 2, 8, 2, W[3]);
  c.fillStyle = W[4]; c.fillRect(x - 9, y - 3, 5, 1); c.fillRect(x + 3, y - 1, 4, 1); c.fillRect(x - 3, y + 2, 3, 1);
  c.fillStyle = W[0]; c.fillRect(x - 9, y + 5, 19, 1); c.fillRect(x + 9, y + 4, 5, 1);
  if (ice) { c.fillStyle = W[1]; c.fillRect(x - 4, y + 1, 7, 1); c.fillRect(x + 2, y + 2, 1, 2); c.fillRect(x - 5, y, 1, 1); return; }
  // Reeds at one end, their heads in the light.
  for (let k = 0; k < 5; k++) {
    const rx = x + 11 + k * 2, top = y - 9 + (k % 2) * 2 + (k === 4 ? 2 : 0);
    c.fillStyle = RAMPS.meadow.grass[0]; c.fillRect(rx, top + 2, 1, y + 3 - top - 2);
    c.fillStyle = RAMPS.meadow.grass[1]; c.fillRect(rx - 1, top + 3, 1, y - top - 2);
    c.fillStyle = '#7a4a22'; c.fillRect(rx, top, 1, 3);
    c.fillStyle = '#a86a32'; c.fillRect(rx, top, 1, 1);
  }
}

function sheep(c, x, y, turn) {
  const s = turn ? -1 : 1;
  ground(c, x, y + 1, 7, 'meadow');
  c.fillStyle = '#2e2622'; for (const dx of [-4, -2, 2, 4]) c.fillRect(x + dx, y - 2, 1, 3);
  ellipse(c, x, y - 5, 6, 4, '#8f8a7e');
  ellipse(c, x, y - 6, 6, 3, '#d6d0c2');
  ellipse(c, x - 1, y - 7, 4, 2, '#f6f2e6');
  c.fillStyle = '#ffffff'; c.fillRect(x - 3, y - 9, 3, 1);
  c.fillStyle = '#b4ae9e'; c.fillRect(x - 2, y - 3, 6, 1);
  // The head: dark, an ear, a light in the eye.
  c.fillStyle = '#2e2622'; c.fillRect(x + s * 6 - (s < 0 ? 3 : 0), y - 8, 4, 4); c.fillRect(x + s * 5 - (s < 0 ? 1 : 0), y - 9, 2, 1);
  c.fillStyle = '#5a4c44'; c.fillRect(x + s * 7 - (s < 0 ? 2 : 0), y - 8, 3, 1);
  c.fillStyle = '#f6f2e6'; c.fillRect(x + s * 8, y - 7, 1, 1);
}

function deer(c, x, y) {
  const B = ['#4a2a18', '#7a4a26', '#a8703a', '#c8934e', '#ecd8ae'];
  ground(c, x, y + 1, 8, 'wood');
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
  // Neck and head, lifted: it has heard the dog.
  c.fillStyle = B[0]; c.fillRect(x + 4, y - 18, 5, 6); c.fillRect(x + 6, y - 21, 6, 5);
  c.fillStyle = B[2]; c.fillRect(x + 5, y - 17, 3, 5); c.fillRect(x + 7, y - 20, 4, 3);
  c.fillStyle = B[3]; c.fillRect(x + 5, y - 17, 1, 4); c.fillRect(x + 7, y - 20, 3, 1);
  c.fillStyle = B[4]; c.fillRect(x + 6, y - 14, 2, 2);
  c.fillStyle = '#0c0a0e'; c.fillRect(x + 9, y - 19, 1, 1); c.fillRect(x + 11, y - 18, 1, 1);
  c.fillStyle = B[1]; c.fillRect(x + 6, y - 22, 1, 2);
  c.fillStyle = B[4];
  for (const [dx, dy, w, h] of [[8, -25, 1, 4], [7, -26, 1, 2], [9, -27, 1, 2], [10, -25, 1, 3], [11, -27, 1, 3], [12, -26, 1, 1]]) c.fillRect(x + dx, y + dy, w, h);
}

function snowman(c, x, y) {
  const S = RAMPS.climb.snow;
  ground(c, x, y + 1, 6, 'climb');
  for (const [dy, r] of [[-4, 5], [-11, 4], [-17, 3]]) {
    ellipse(c, x, y + dy, r, r - 1, S[1]);
    ellipse(c, x - 1, y + dy - 1, r - 1, r - 2, S[3]);
    c.fillStyle = S[4]; c.fillRect(x - r + 2, y + dy - r + 2, 2, 1);
  }
  c.fillStyle = '#1c2240'; c.fillRect(x - 1, y - 18, 1, 1); c.fillRect(x + 1, y - 18, 1, 1); c.fillRect(x, y - 12, 1, 1); c.fillRect(x, y - 9, 1, 1);
  c.fillStyle = '#e8743a'; c.fillRect(x, y - 17, 3, 1);
  c.fillStyle = '#c8302a'; c.fillRect(x - 3, y - 14, 7, 1); c.fillRect(x + 2, y - 13, 1, 3);
  c.fillStyle = '#1c2240'; c.fillRect(x - 3, y - 20, 7, 1); c.fillRect(x - 2, y - 24, 5, 4);
  c.fillStyle = '#38426a'; c.fillRect(x - 2, y - 24, 1, 4);
  c.fillStyle = '#6a4a2e'; c.fillRect(x - 7, y - 13, 3, 1); c.fillRect(x + 5, y - 12, 3, 1); c.fillRect(x - 8, y - 14, 1, 1);
}

function tent(c, x, y) {
  const T = ['#6a2a1c', '#a8482a', '#e8743a', '#f6a05a', '#ffd6a0'];
  ground(c, x + 2, y + 1, 12, 'climb');
  for (let j = 0; j < 13; j++) {
    const half = R(j * 0.9) + 1;
    c.fillStyle = T[0]; c.fillRect(x - half - 1, y - 12 + j, half * 2 + 3, 1);
    c.fillStyle = T[2]; c.fillRect(x - half, y - 12 + j, half, 1);
    c.fillStyle = T[1]; c.fillRect(x, y - 12 + j, half + 1, 1);
    c.fillStyle = T[3]; c.fillRect(x - half, y - 12 + j, 1, 1);
  }
  // The door, unzipped, and snow lying along the ridge.
  for (let j = 0; j < 8; j++) { c.fillStyle = '#2a1626'; c.fillRect(x - R(j * 0.3), y - 7 + j, R(j * 0.6) + 1, 1); }
  c.fillStyle = RAMPS.climb.snow[3]; c.fillRect(x - 1, y - 13, 3, 1); c.fillRect(x - 3, y - 11, 2, 1); c.fillRect(x - 5, y - 9, 2, 1);
  c.fillStyle = RAMPS.climb.snow[1]; c.fillRect(x - 13, y, 4, 1); c.fillRect(x + 11, y, 4, 1);
  // A lantern by the door.
  c.fillStyle = RAMPS.climb.trunk[0]; c.fillRect(x + 13, y - 5, 3, 6);
  c.fillStyle = RAMPS.climb.lantern[2]; c.fillRect(x + 14, y - 4, 1, 3);
  glow(c, x + 14, y + 1, 8, 3, [255, 214, 120], 0.16);
}

/** Where the tent's lantern burns, from the tent's own point. */
export const TENT_LAMP = [14, -4];

export function landmark(c, name, x, y) {
  if (name === 'pond') return pond(c, x, y);
  if (name === 'tarn') return pond(c, x, y, true);
  if (name === 'fountain') return fountain(c, x, y);
  if (name === 'sheep') { sheep(c, x - 6, y - 2, true); sheep(c, x + 12, y + 5, false); return; }
  if (name === 'log') {
    stamp(c, LANDMARKS.log, x - 7, y - 2, { b: '#7a5232', w: '#d9b07a', d: '#8a5a32' });
    c.fillStyle = '#e8d45a'; c.fillRect(x - 3, y - 3, 1, 1); c.fillRect(x + 2, y - 3, 1, 1);
    return;
  }
  if (name === 'mushrooms') {
    stamp(c, LANDMARKS.mushroom, x - 5, y - 4, { r: '#d9412b', w: '#fff4e0', s: '#f0e2c4' });
    stamp(c, LANDMARKS.mushroomS, x + 2, y - 1, { r: '#c2521e', w: '#fff4e0', s: '#f0e2c4' });
    return;
  }
  if (name === 'stump') return stamp(c, LANDMARKS.stump, x - 3, y - 4, { b: '#7a5232', w: '#d9b07a' });
  if (name === 'deer') return deer(c, x, y);
  if (name === 'signpost') return stamp(c, LANDMARKS.signpost, x - 5, y - 10, { p: '#5e3a1e', w: '#d9b07a', d: '#5e3a1e' });
  if (name === 'bench') {
    const T = RAMPS.town.trunk;
    ground(c, x, y + 1, 8, 'town');
    c.fillStyle = T[0]; c.fillRect(x - 8, y - 9, 17, 5); c.fillRect(x - 8, y - 4, 17, 2); c.fillRect(x - 7, y - 2, 2, 3); c.fillRect(x + 6, y - 2, 2, 3);
    c.fillStyle = T[3]; c.fillRect(x - 7, y - 8, 15, 1); c.fillRect(x - 7, y - 4, 15, 1);
    c.fillStyle = T[2]; c.fillRect(x - 7, y - 6, 15, 1);
    return;
  }
  if (name === 'snowman') return snowman(c, x, y);
  if (name === 'tent') return tent(c, x, y);
}

/** A car, parked side on. `left` turns it the other way. Thirty pixels
    long: a dog of forty-eight had been walking past a car of fourteen. */
export function car(c, x, y, colour, left) {
  const s = left ? -1 : 1;
  const r = (dx, dy, w, h, col) => { c.fillStyle = col; c.fillRect(s > 0 ? x + dx : x - dx - w + 1, y + dy, w, h); };
  const ink = darker(colour, 0.62), lo = darker(colour, 0.3), hi = lighter(colour, 0.32);
  c.fillStyle = 'rgba(6,8,30,0.42)'; c.fillRect(x - 14, y, 30, 2); c.fillRect(x - 11, y + 2, 26, 1);
  r(-15, -8, 30, 7, ink); r(-9, -13, 16, 6, ink); r(-10, -11, 1, 3, ink); r(7, -10, 2, 2, ink);
  r(-14, -7, 28, 5, colour); r(-14, -7, 28, 1, hi); r(-14, -4, 28, 2, lo);
  r(-8, -12, 14, 5, colour); r(-8, -12, 14, 1, hi); r(6, -10, 2, 3, colour); r(-9, -10, 1, 3, colour);
  // Glass, the moon in the corner of each pane.
  r(-7, -11, 5, 3, '#4a6aa8'); r(0, -11, 6, 3, '#4a6aa8'); r(6, -10, 1, 2, '#4a6aa8');
  r(-7, -11, 2, 1, '#bcd8f0'); r(0, -11, 3, 1, '#bcd8f0'); r(0, -10, 1, 1, '#bcd8f0');
  // A door's line, a handle, lamps front and back.
  r(-1, -7, 1, 4, lo); r(1, -6, 2, 1, ink);
  r(13, -6, 2, 2, '#fff0b0'); r(-15, -6, 1, 2, '#e04a3a'); r(-15, -3, 30, 1, ink);
  for (const wx of [-9, 8]) {
    const cx = x + s * wx - (s < 0 ? 0 : 0);
    disc(c, cx, y - 2, 3, '#0c0e1c'); disc(c, cx, y - 2, 1, '#8792b3');
    c.fillStyle = '#c4d0e8'; c.fillRect(cx, y - 3, 1, 1);
  }
}

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

/** How high a street lamp's light is above its foot (ambient.js reads it). */
export const LAMP_TOP = 21;

/** A street lamp: an iron post on a stone foot, the moon down its left
    side, a lantern with a lit glass, and its pool of light on the ground. */
export function lamp(c, x, base) {
  const T = RAMPS.town;
  lightPool(c, x, base + 1, 19, 8);
  c.fillStyle = T.stone[0]; c.fillRect(x - 2, base - 2, 5, 3);
  c.fillStyle = T.stone[2]; c.fillRect(x - 1, base - 2, 3, 2);
  c.fillStyle = T.stone[3]; c.fillRect(x - 1, base - 2, 1, 1);
  c.fillStyle = T.roof[0]; c.fillRect(x - 1, base - 17, 3, 15);
  c.fillStyle = T.roof[3]; c.fillRect(x - 1, base - 17, 1, 15);
  c.fillStyle = T.lamp[1]; c.fillRect(x, base - 17, 1, 5);
  // The lantern: a cap, four panes of glass, a collar.
  c.fillStyle = T.roof[0];
  c.fillRect(x - 3, base - 18, 7, 1); c.fillRect(x - 4, base - 23, 9, 1); c.fillRect(x - 2, base - 24, 5, 1); c.fillRect(x - 1, base - 25, 3, 1); c.fillRect(x, base - 26, 1, 1);
  c.fillRect(x - 3, base - 22, 1, 4); c.fillRect(x + 3, base - 22, 1, 4);
  c.fillStyle = T.roof[3]; c.fillRect(x - 3, base - 23, 4, 1); c.fillRect(x - 1, base - 24, 2, 1);
  c.fillStyle = T.lamp[2]; c.fillRect(x - 2, base - 22, 5, 4);
  c.fillStyle = T.lamp[3]; c.fillRect(x - 1, base - 22, 3, 3);
  c.fillStyle = T.lamp[4]; c.fillRect(x, base - 21, 1, 2);
  // Its halo in the night air.
  for (let dy = -6; dy <= 6; dy++) for (let dx = -7; dx <= 7; dx++) {
    const d = Math.hypot(dx, dy * 1.15);
    if (d > 3.6 && d <= 7 && bayer(x + dx, base - 20 + dy) < (7.4 - d) * 0.13) { c.fillStyle = 'rgba(255,224,140,0.5)'; c.fillRect(x + dx, base - 20 + dy, 1, 1); }
  }
}

/* House walls and roofs for the town: three of each, picked by the seed. */
const SLATE = ['#141c38', '#283a5e', '#3e587c', '#5878a0', '#84a0c4'];
const PLUM = ['#160e26', '#2a1a3e', '#44285a', '#63427e', '#8e6aa8'];

/** Where a house's parts are, from what scene.js keeps about it: used to
    paint it and (ambient.js) to flicker its windows and lift its smoke. */
export function houseParts(x, base, w, h, seed, snowy) {
  const x0 = x - (w >> 1), top = base - h;
  // 0: eaves to the street. 1: gable to the street. 2: eaves, with a dormer.
  const kind = snowy ? 0 : Math.min(2, Math.floor(hash(seed + 11) * 3));
  const rh = kind === 1 ? R(w * 0.3) : 9;
  const right = hash(seed + 2) > 0.5;
  const chx = x0 + (right ? w - 9 : 5), chy = kind === 1 ? top - R(rh * 0.55) - 4 : top - rh - 4;
  const n = Math.max(2, Math.floor((w - 6) / 10));
  const door = snowy ? 0 : Math.floor(hash(seed + 3) * n);
  const wins = [];
  let doorX = x0 + 4;
  for (let k = 0; k < n; k++) {
    const wx = x0 + R((w - (n - 1) * 10 - 5) / 2) + k * 10;
    if (k === door) { doorX = wx; continue; }
    wins.push({ x: wx, y: top + 4, w: 5, h: 6, lit: snowy || hash(seed * 7 + k) > 0.25, ground: true });
  }
  if (kind === 1) wins.push({ x: x - 2, y: top - R(rh * 0.5), w: 5, h: 4, lit: hash(seed + 21) > 0.4 });
  if (kind === 2) wins.push({ x: x0 + (right ? 6 : w - 12), y: top - 7, w: 5, h: 4, lit: hash(seed + 21) > 0.3, dormer: true });
  return { x0, top, rh, kind, chx, chy, wins, doorX, smoke: snowy || hash(seed + 9) > 0.5 };
}

/** A house seen from the street, the moon on its left: a roof with a lit
    slope and a dark one, a chimney, a door with a step, windows that throw
    their light on the ground, and its shadow lying down to the right.
    `snowy` is the mountain hut: timber, with snow on the roof. */
export function house(c, x, base, w, h, seed, L, snowy) {
  const T = RAMPS.town, P = houseParts(x, base, w, h, seed, snowy);
  const { x0, top, rh, kind } = P;
  const wall = snowy ? RAMPS.climb.trunk : [T.plaster, T.brick, SLATE][Math.floor(hash(seed) * 3) % 3];
  const roof = snowy ? RAMPS.climb.snow : [T.roof, PLUM, T.roof][Math.floor(hash(seed + 5) * 3) % 3];
  const brick = wall === T.brick || snowy;
  const [hex, a] = CAST[snowy ? 'climb' : 'town'];
  const n = parseInt(hex.slice(1), 16);
  const cast = `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  // Its shadow: along the foot and out to the right, the last row breaking up.
  c.fillStyle = cast;
  for (let r = 0; r < 5; r++) for (let px = x0 + 2 + r * 2; px < x0 + w + 4 + r * 2; px++) if (r < 4 || bayer(px, base + r) < 0.5) c.fillRect(px, base + 1 + r, 1, 1);
  for (let k = 0; k < 9; k++) c.fillRect(x0 + w, base - k, 9 - k, 1);

  // The chimney first, so the roof crosses its foot.
  const ch = snowy ? RAMPS.climb.rock : T.brick;
  c.fillStyle = ch[0]; c.fillRect(P.chx - 1, P.chy - 1, 6, 10);
  c.fillStyle = ch[2]; c.fillRect(P.chx, P.chy, 4, 9);
  c.fillStyle = ch[3]; c.fillRect(P.chx, P.chy, 1, 9); c.fillRect(P.chx, P.chy, 4, 1);
  c.fillStyle = ch[1]; c.fillRect(P.chx + 3, P.chy + 1, 1, 8);
  if (snowy) { c.fillStyle = roof[3]; c.fillRect(P.chx - 1, P.chy - 2, 6, 2); }

  // The wall: the moon on its left edge, shade to the right and under the eaves.
  c.fillStyle = wall[0]; c.fillRect(x0 - 1, top, w + 2, h + 1);
  c.fillStyle = wall[2]; c.fillRect(x0, top, w, h);
  c.fillStyle = wall[3]; c.fillRect(x0, top, 1, h);
  c.fillStyle = wall[1]; c.fillRect(x0 + w - 3, top, 3, h); c.fillRect(x0, base - 1, w, 1); c.fillRect(x0, top, w, 2);
  for (let px = x0; px < x0 + w; px++) if (bayer(px, top + 2) < 0.5) c.fillRect(px, top + 2, 1, 1);
  if (brick) {
    // Courses of brick (or the hut's logs): short dashes, not a grid.
    for (let y = top + 4; y < base - 1; y += 3) for (let px = x0 + 1 + ((y / 3) & 1) * 3; px < x0 + w - 4; px += 6) if (hash(px * 7 + y * 13 + seed) < (snowy ? 0.9 : 0.5)) { c.fillStyle = wall[1]; c.fillRect(px, y, snowy ? 5 : 3, 1); }
  }

  if (kind === 1) {
    // Gable to the street: the wall runs up into the roof's point.
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
    // Eaves to the street: a lit slope, tiles in broken rows, a dark eave.
    for (let j = 0; j < rh; j++) {
      const inset = R((rh - 1 - j) * 0.8), y = top - rh + j + 1, a0 = x0 - 2 + inset, b0 = x0 + w + 2 - inset;
      const split = b0 - R((b0 - a0) * 0.3) - j;
      c.fillStyle = roof[0]; c.fillRect(a0 - 1, y, b0 - a0 + 2, 2);
      c.fillStyle = j === 0 ? roof[4] : roof[3]; c.fillRect(a0, y, split - a0, 1);
      c.fillStyle = j === 0 ? roof[3] : roof[2]; c.fillRect(split, y, b0 - split, 1);
      if (!snowy && j > 0 && j % 3 === 2) { for (let px = a0 + 1 + (j & 1) * 2; px < b0 - 2; px += 5) { c.fillStyle = px < split ? roof[2] : roof[1]; c.fillRect(px, y, 3, 1); } }
      if (j === rh - 1) { c.fillStyle = roof[1]; c.fillRect(a0, y, b0 - a0, 1); }
    }
    if (snowy) {
      // Icicles under the eave.
      c.fillStyle = roof[3];
      for (let px = x0 - 1; px < x0 + w + 1; px += 4) c.fillRect(px, top + 1, 1, 1 + ((px * 7) % 3));
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
    c.fillStyle = lit ? T.lamp[2] : T.roof[1]; c.fillRect(wx, wy, ww, wh);
    if (lit) { c.fillStyle = T.lamp[3]; c.fillRect(wx, wy, 2, R(wh / 2)); c.fillStyle = T.lamp[1]; c.fillRect(wx + 3, wy + R(wh / 2) + 1, 2, wh - R(wh / 2) - 1); }
    else { c.fillStyle = T.roof[3]; c.fillRect(wx, wy, 1, 2); c.fillRect(wx + 1, wy, 1, 1); }
    c.fillStyle = wall[0]; c.fillRect(wx + 2, wy, 1, wh); if (wh > 4) c.fillRect(wx, wy + R(wh / 2), ww, 1);
    if (wn.ground) { c.fillStyle = wall[3]; c.fillRect(wx - 1, wy + wh + 1, ww + 2, 1); }
  };
  P.wins.forEach(pane);

  // The door, its step, and a light over it.
  const dx = P.doorX, D = snowy ? RAMPS.climb.trunk : T.trunk;
  c.fillStyle = wall[0]; c.fillRect(dx - 1, base - 11, 8, 11);
  c.fillStyle = D[snowy ? 1 : 3]; c.fillRect(dx, base - 10, 6, 10);
  c.fillStyle = D[snowy ? 2 : 4]; c.fillRect(dx, base - 10, 1, 10); c.fillRect(dx + 1, base - 9, 4, 1);
  c.fillStyle = D[snowy ? 0 : 2]; c.fillRect(dx + 3, base - 8, 1, 8);
  c.fillStyle = T.lamp[2]; c.fillRect(dx + 4, base - 5, 1, 1); c.fillRect(dx + 2, base - 13, 2, 1);
  c.fillStyle = T.lamp[4]; c.fillRect(dx + 2, base - 12, 2, 1);
  c.fillStyle = snowy ? roof[3] : T.stone[3]; c.fillRect(dx - 1, base, 8, 1);
  c.fillStyle = snowy ? roof[1] : T.stone[1]; c.fillRect(dx - 1, base + 1, 8, 1);

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

/** A boulder: its lit side up and to the left, its shadow on the snow in
    blue, a cap of snow lying on it on the mountain. */
export function boulder(c, x, y, r, L) {
  const K = RAMPS.climb.rock, S = RAMPS.climb.snow, ry = R(r * 0.72);
  const [hex, a] = CAST.climb;
  const n = parseInt(hex.slice(1), 16);
  ellipse(c, x + R(r * 0.6) + 1, y + 1, r, Math.max(2, R(r * 0.4)), `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`);
  ellipse(c, x, y - ry + 1, r, ry, K[0]);
  ellipse(c, x, y - ry, r, ry, K[1]);
  ellipse(c, x - 1, y - ry - 1, r - 1, ry - 1, K[2]);
  ellipse(c, x - R(r * 0.3), y - ry - R(ry * 0.3), R(r * 0.55), Math.max(1, R(ry * 0.5)), K[3]);
  c.fillStyle = K[0]; c.fillRect(x + R(r * 0.2), y - ry + 1, 1, R(ry * 0.8)); c.fillRect(x + R(r * 0.2) + 1, y - 2, 2, 1);
  if (L && L.snow) {
    ellipse(c, x - 1, y - ry * 2 + 2, R(r * 0.7), 1, S[3]);
    c.fillStyle = S[4]; c.fillRect(x - R(r * 0.5), y - ry * 2 + 1, R(r * 0.7), 1);
    c.fillStyle = S[1]; c.fillRect(x - R(r * 0.4), y - ry * 2 + 4, R(r * 0.9), 1);
  }
}

/** A fountain in the square: a stone basin, the moon on its rim, water
    standing up out of the middle of it. */
function fountain(c, x, y) {
  const T = RAMPS.town;
  ellipse(c, x + 3, y + 3, 16, 6, 'rgba(6,8,30,0.4)');
  ellipse(c, x, y + 1, 15, 6, T.stone[0]);
  ellipse(c, x, y, 15, 6, T.stone[1]);
  ellipse(c, x, y - 1, 14, 5, T.stone[3]);
  ellipse(c, x, y - 1, 12, 4, T.water[1]);
  ellipse(c, x - 1, y - 2, 9, 2, T.water[2]);
  c.fillStyle = T.water[4]; c.fillRect(x - 7, y - 3, 4, 1); c.fillRect(x + 3, y, 3, 1);
  c.fillStyle = T.stone[0]; c.fillRect(x - 2, y - 12, 5, 11);
  c.fillStyle = T.stone[2]; c.fillRect(x - 1, y - 11, 3, 10);
  c.fillStyle = T.stone[4]; c.fillRect(x - 1, y - 11, 1, 10);
  c.fillStyle = T.stone[0]; c.fillRect(x - 4, y - 13, 9, 2);
  c.fillStyle = T.stone[3]; c.fillRect(x - 3, y - 13, 7, 1);
  c.fillStyle = T.water[4];
  for (const [dx, dy, h] of [[0, -18, 5], [-2, -16, 3], [2, -16, 3], [-4, -13, 3], [4, -13, 3], [-5, -9, 4], [5, -9, 4]]) c.fillRect(x + dx, y + dy, 1, h);
  c.fillStyle = T.water[3]; c.fillRect(x - 3, y - 15, 1, 2); c.fillRect(x + 3, y - 15, 1, 2);
}

/** A snow pole: the markers that show a mountain path under snow. */
export function snowPole(c, x, base) {
  const [hex, a] = CAST.climb;
  const n = parseInt(hex.slice(1), 16);
  c.fillStyle = `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; c.fillRect(x + 1, base, 6, 1); c.fillRect(x + 3, base + 1, 5, 1);
  c.fillStyle = '#5a3a1e'; c.fillRect(x - 1, base - 13, 3, 14);
  c.fillStyle = '#e8c070'; c.fillRect(x - 1, base - 13, 2, 13);
  c.fillStyle = '#fff0c0'; c.fillRect(x - 1, base - 13, 1, 13);
  c.fillStyle = '#d9412b'; c.fillRect(x - 1, base - 13, 3, 4);
  c.fillStyle = '#f27a5c'; c.fillRect(x - 1, base - 13, 1, 4);
  c.fillStyle = RAMPS.climb.snow[4]; c.fillRect(x - 1, base - 14, 3, 1);
}
