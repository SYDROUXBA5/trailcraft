/* The pixel team: a handler, a dog in a harness and the line between them,
   drawn by code on one small pixel grid and scaled up crisp. No image files.

   1  Grid and colour helpers
   2  Palettes: coats, jackets, hats, stages, landscapes
   3  Sprites (one character per pixel)
   4  Rigs: the dog and the person
   5  The line
   6  States: what the team is doing at a given time
   7  Scenes: the team on its own, the close-up landscape, the boss gate
   8  Board scenery: stones, icons, digits, the trail
   9  The player: one canvas, 30 fps at most, only while visible

   Everything is drawn at art size (1 unit = 1 art pixel) into a small buffer,
   then copied up by a whole number of device pixels with smoothing off. */

/* ───────────────────────── 1. Grid and colour helpers ───────────────────────── */

const R = Math.round;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(v => clamp(R(v), 0, 255).toString(16).padStart(2, '0')).join('');
}
export function mix(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return rgbToHex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
}
const darker = (c, t = 0.3) => mix(c, '#140c08', t);
const lighter = (c, t = 0.2) => mix(c, '#ffffff', t);

/** A repeatable 0..1 number from an integer: the same scatter on every phone. */
function hash(n) {
  n = (n | 0) ^ 0x9e3779b9;
  n = Math.imul(n ^ (n >>> 16), 0x85ebca6b);
  n = Math.imul(n ^ (n >>> 13), 0xc2b2ae35);
  n ^= n >>> 16;
  return (n >>> 0) / 4294967296;
}
function seeded(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}
function ctx2d(c) {
  const x = c.getContext('2d');
  x.imageSmoothingEnabled = false;
  return x;
}

/** Integer points of a straight line (Bresenham). */
function linePoints(x0, y0, x1, y1) {
  x0 = R(x0); y0 = R(y0); x1 = R(x1); y1 = R(y1);
  const pts = [];
  const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (let guard = 0; guard < 2000; guard++) {
    pts.push([x0, y0]);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
  return pts;
}

/** A limb or neck: a stepped line `w` pixels thick, on the grid. */
function thick(c, a, b, w, col) {
  c.fillStyle = col;
  const steep = Math.abs(b[1] - a[1]) >= Math.abs(b[0] - a[0]);
  const off = -Math.floor((w - 1) / 2);
  for (const p of linePoints(a[0], a[1], b[0], b[1])) {
    if (steep) c.fillRect(p[0] + off, p[1], w, 1);
    else c.fillRect(p[0], p[1] + off, 1, w);
  }
}

/** A connected one-pixel path through float points, with the L-shaped
    corners taken out so a curve reads as clean pixel art. */
function pixelPath(points) {
  const raw = [];
  for (let i = 0; i < points.length - 1; i++) {
    const seg = linePoints(points[i][0], points[i][1], points[i + 1][0], points[i + 1][1]);
    for (let j = raw.length ? 1 : 0; j < seg.length; j++) raw.push(seg[j]);
  }
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const a = out[out.length - 1], b = raw[i], c = raw[i + 1];
    if (a && a[0] === b[0] && a[1] === b[1]) continue;
    if (a && c && a[0] !== c[0] && a[1] !== c[1] &&
        Math.abs(a[0] - c[0]) === 1 && Math.abs(a[1] - c[1]) === 1) continue;
    out.push(b);
  }
  return out;
}

function disc(c, cx, cy, r, col) {
  c.fillStyle = col;
  for (let y = -r; y <= r; y++) {
    const half = Math.floor(Math.sqrt(r * r - y * y + r * 0.8));
    c.fillRect(cx - half, cy + y, half * 2 + 1, 1);
  }
}
function ellipse(c, cx, cy, rx, ry, col) {
  c.fillStyle = col;
  for (let y = -ry; y <= ry; y++) {
    const half = Math.floor(rx * Math.sqrt(Math.max(0, 1 - (y * y) / ((ry + 0.5) * (ry + 0.5)))));
    c.fillRect(cx - half, cy + y, half * 2 + 1, 1);
  }
}

/* ───────────────────────── 2. Palettes ───────────────────────── */

export const OUTLINE = '#1c1411';

export const STAGES = {
  hot: { id: 'hot', name: 'Hot', colour: '#BE3F2E', light: '#E2604C' },
  warm: { id: 'warm', name: 'Warm', colour: '#D0821F', light: '#EDA548' },
  cold: { id: 'cold', name: 'Cold', colour: '#3B8BD6', light: '#6AAEEA' },
};

/* Coat slots: s saddle (top of the back), b body, u points (chest, lower
   legs), f face, m muzzle, r ears, t tail, T tail tip, n nose. A capital
   letter in a sprite is the same slot one shade darker. */
export const COATS = [
  { id: 'bloodhound-red', name: 'Bloodhound, red', head: 'hound', ear: 'long', tail: 'saber',
    pal: { s: '#b0552c', b: '#c86a3a', u: '#e08b52', f: '#c86a3a', m: '#e08b52', r: '#8e3c1c', t: '#c86a3a', T: '#e08b52', n: '#3a1a12' } },
  { id: 'bloodhound-bt', name: 'Bloodhound, black and tan', head: 'hound', ear: 'long', tail: 'saber',
    pal: { s: '#2b2421', b: '#b46f37', u: '#c8884a', f: '#b46f37', m: '#c8884a', r: '#3a2c24', t: '#2b2421', T: '#b46f37', n: '#1e1714' } },
  { id: 'bloodhound-liver', name: 'Bloodhound, liver and tan', head: 'hound', ear: 'long', tail: 'saber',
    pal: { s: '#3f231c', b: '#5b3428', u: '#c98a52', f: '#5b3428', m: '#c98a52', r: '#3a1f19', t: '#3f231c', T: '#5b3428', n: '#24120d' } },
  { id: 'malinois', name: 'Malinois', head: 'wedge', ear: 'prick', tail: 'brush', build: 'malinois',
    pal: { s: '#b07f45', b: '#cf9f5f', u: '#dfb77d', f: '#cf9f5f', m: '#2a2019', r: '#2a2019', t: '#c2904f', T: '#2a2019', n: '#15100c' } },
  { id: 'shepherd', name: 'German shepherd', head: 'wedge', ear: 'prick', tail: 'brush', build: 'shepherd', tailLift: -50,
    pal: { s: '#26201c', b: '#bd7a3b', u: '#cd8f4d', f: '#bd7a3b', m: '#2b2320', r: '#2b2320', t: '#3a2f28', T: '#26201c', n: '#15100c' } },
  { id: 'lab-yellow', name: 'Labrador, yellow', head: 'broad', ear: 'drop', tail: 'otter',
    pal: { s: '#ddb571', b: '#e8c688', u: '#f0d6a6', f: '#e8c688', m: '#f0d6a6', r: '#cc9f5c', t: '#ddb571', T: '#e8c688', n: '#3a2a22' } },
  { id: 'lab-black', name: 'Labrador, black', head: 'broad', ear: 'drop', tail: 'otter',
    pal: { s: '#4a4a58', b: '#2b2a33', u: '#34333e', f: '#3a3a47', m: '#45455a', r: '#4a4a58', t: '#2b2a33', T: '#3a3a47', n: '#0e0d10' } },
  { id: 'lab-chocolate', name: 'Labrador, chocolate', head: 'broad', ear: 'drop', tail: 'otter',
    pal: { s: '#6a4029', b: '#5e3824', u: '#704630', f: '#5e3824', m: '#734a33', r: '#4c2c1c', t: '#5e3824', T: '#6a4029', n: '#2a1810' } },
  { id: 'beagle', name: 'Beagle', head: 'broad', ear: 'mid', tail: 'saber',
    pal: { s: '#27211f', b: '#bf7d3e', u: '#f1ece3', f: '#bf7d3e', m: '#f1ece3', r: '#a9692f', t: '#27211f', T: '#f1ece3', n: '#1f1a18' } },
  { id: 'springer', name: 'Springer, liver and white', head: 'broad', ear: 'feather', tail: 'stub',
    pal: { s: '#6a2e22', b: '#efeae1', u: '#efeae1', f: '#6a2e22', m: '#efeae1', r: '#6a2e22', t: '#efeae1', T: '#6a2e22', n: '#4a2018' } },
];
export const coatById = (id) => COATS.find(c => c.id === id) || COATS[0];

export const JACKETS = [
  { id: 'navy', name: 'Navy', colour: '#24426f' },
  { id: 'red', name: 'Red', colour: '#b5382b' },
  { id: 'forest', name: 'Forest', colour: '#3d6a3a' },
  { id: 'orange', name: 'Orange', colour: '#e07a26' },
  { id: 'hivis', name: 'Hi-vis', colour: '#e3cf3a' },
  { id: 'sky', name: 'Sky', colour: '#2f7fc1' },
  { id: 'slate', name: 'Slate', colour: '#5f6673' },
  { id: 'plum', name: 'Plum', colour: '#6a4a9c' },
];
export const jacketById = (id) => JACKETS.find(j => j.id === id) || JACKETS[0];

export const HATS = [
  { id: 'none', name: 'No hat' },
  { id: 'cap', name: 'Cap', colour: '#c9962e' },
  { id: 'beanie', name: 'Beanie', colour: '#b5382b' },
  { id: 'bush', name: 'Bush hat', colour: '#8c7a52' },
];

/* Scent has its own colours: nothing in the scenery uses them. */
const SCENT = ['#bff4ff', '#ffffff'];

/* The person hiding at the end of the trail. */
const RUNAWAY = { hair: '#b8742f', skin: '#d99c74', jacket: '#e9d33a', trousers: '#3a4250', boots: '#2c2622', stripe: '#f4f4ee' };

/* Landscapes for the close-up. */
const LANDS = {
  hot: {
    sky: ['#8fcbe6', '#a9d8ea', '#c7e6ec', '#e6f1e2'], sun: '#fff3b8', sunHi: '#fffbe0',
    far: '#9cc77a', near: '#78ad57', hedge: '#4c7d34', hedgeHi: '#64983f',
    g: '#89b852', gHi: '#a0c866', gLo: '#73a345', tuft: '#5a8b38', fl: '#d9412b', flHi: '#f2765a', fl2: '#f3d34a',
  },
  warm: {
    sky: ['#3e2c4e', '#7a3e4c', '#c8643a', '#eda048'], sun: '#ffd37a', sunHi: '#fff0c0',
    far: '#6a3e48', near: '#4e3440', hedge: '#3b2a26', hedgeHi: '#5a3b2c',
    g: '#a8743a', gHi: '#b8854a', gLo: '#8e5f2c', tuft: '#7e5428', fl: '#e08a2a', flHi: '#f4b04a', fl2: '#c2521e',
    tree: '#9a4e3a', treeHi: '#b8664a', trunk: '#4e3440',
  },
  night: {
    sky: ['#081226', '#0d1a34', '#132646', '#1b3358'], sun: '#eef0dc', sunHi: '#ffffff',
    far: '#16304e', near: '#10243e', hedge: '#0b1a2e', hedgeHi: '#152a46',
    g: '#24405f', gHi: '#2d4e72', gLo: '#1b3350', tuft: '#2f4d70', fl: '#2f4c70', flHi: '#34557c', fl2: '#2b476b',
    window: '#f5d27a',
  },
};

/* ───────────────────────── 3. Sprites ─────────────────────────
   One character per pixel; '.' is clear. Letters are palette slots, and a
   capital is its slot one shade darker. Fixed slots: e eye, k harness ring,
   h/H harness (the stage colour), w cream, g/G gold, d dark. */

const FIXED = { e: '#1c1411', k: '#e9eef2', l: '#ffe4bd', w: '#f7f1de', W: '#c9c0a6', d: '#3a2e26', g: '#f2c14e', G: '#b8861b', x: '#ffffff', o: OUTLINE };

/* Torsos face right. `strap` is where the harness goes: column, top row,
   bottom row and the chest-strap row. Builds change the frame: the hound is
   long and deep, the shepherd slopes to the rear, the Malinois is square. */
const DOG_TORSO = {
  stand: {
    rows: [
      '..ssssssssss....',
      '.sssssssssssss..',
      'sssssssssssssbb.',
      'bbsssssssssbbbbu',
      'bbbbbbbbbbbbbbuu',
      '.bbBbbbbbbbbbbuu',
      '..BB..BBBBBBBuu.',
    ],
    neck: [13, 1], tail: [0, 1], front: [[12, 4], [14, 4]], rear: [[2, 4], [4, 4]], strap: [8, 0, 6, 3], lineIn: [-2, -2],
  },
  /* Sitting: chest up, front legs straight, the haunch round, the tail
     round the feet. */
  sit: {
    rows: [
      '.......sss...',
      '......sssss..',
      '......ssssbu.',
      '.....sssssbuu',
      '.....ssssbbuu',
      '....sssssbbuu',
      '....ssssbbbuu',
      '...sssssbbbuu',
      '..sssssbbb.uu',
      '.ssssssbbb.uu',
      'sssssssbbb.uu',
      'ssssssbbbb.uu',
      '.BBBBuuuu.uuu',
    ],
    neck: [9, 1], tail: [1, 12], front: [], rear: [], strap: [7, 0, 7, 4], lineIn: [3, -2],
  },
  lie: {
    rows: [
      '...sssssssssss...',
      '.sssssssssssssbb.',
      'sssssssssssssbbbu',
      'bbbsssssssssbbbuu',
      'bbbbbbbbbbbbbbuuu',
      'bBBBuuubbbbBBBBu.',
    ],
    neck: [14, 1], tail: [0, 2], front: [[13, 4], [15, 4]], rear: [], strap: [9, 0, 5, 3], lineIn: [0, -2],
  },
};
/* Other builds, standing. */
const DOG_BUILDS = {
  shepherd: {
    rows: [
      '.........ssssss..',
      '.....sssssssssss.',
      '..sssssssssssssbb',
      'sssssssssssssbbbu',
      'bbbbbbbbbbbbbbbuu',
      '.bbBbbbbbbbbbbbuu',
      '..BB..BBBBBBBBuu.',
    ],
    neck: [14, 1], tail: [0, 3], front: [[13, 4], [15, 4]], rear: [[2, 4], [4, 4]], strap: [10, 0, 6, 3], lineIn: [1, -2],
  },
  malinois: {
    rows: [
      '..sssssssss...',
      '.ssssssssssss.',
      'sssssssssssbbu',
      'bbsssssssbbbuu',
      '.bbbbbbbbbbbuu',
      '..BB...BBBBuu.',
    ],
    neck: [11, 1], tail: [0, 1], front: [[10, 3], [12, 3]], rear: [[2, 3], [4, 3]], strap: [7, 0, 5, 3], lineIn: [-2, -2],
  },
};
function torsoFor(coat, body) {
  return body === 'stand' && coat.build && DOG_BUILDS[coat.build] ? DOG_BUILDS[coat.build] : DOG_TORSO[body];
}

/* Heads face right. `a` is where the neck joins. */
const DOG_HEADS = {
  hound: {
    fwd: { a: [1, 4], rows: [
      '.ffff.....',
      'fFfFff....',
      'fffeFfff..',
      'Ffffffmmm.',
      '.FFffmmmmn',
      '..FmmmmmM.',
      '...MM.mMM.',
      '......M...',
    ] },
    down: { a: [1, 1], rows: [
      '.fff.....',
      'ffffff...',
      'fffeFff..',
      'FfffffFm.',
      '.FFffmmm.',
      '...Mmmmm.',
      '....mmmm.',
      '....MmmM.',
      '.....mmn.',
    ] },
    up: { a: [1, 6], rows: [
      '......mn',
      '.....mmm',
      '....mmmm',
      '.fffffmM',
      'fffeFfM.',
      'ffffff..',
      'Fffff...',
      '.FF.....',
    ] },
  },
  wedge: {
    fwd: { a: [1, 3], rows: [
      '.fff......',
      'fffef.....',
      'ffffffmm..',
      '.fffmmmmmn',
      '..ffmmmm..',
      '...mm.....',
    ] },
    down: { a: [1, 1], rows: [
      '.ff...',
      'fffe..',
      'ffffm.',
      '.ffmm.',
      '..fmm.',
      '..mmm.',
      '..mmm.',
      '...mn.',
    ] },
    up: { a: [1, 5], rows: [
      '.....mn',
      '....mmm',
      '...mmm.',
      '.ffem..',
      'ffffm..',
      'ffff...',
      '.ff....',
    ] },
  },
  broad: {
    fwd: { a: [1, 4], rows: [
      '.fffff..',
      'fffffff.',
      'ffffeff.',
      'Fffffmmm',
      'Ffffmmmn',
      '.FFfmmmm',
      '...Fmmm.',
    ] },
    down: { a: [1, 1], rows: [
      '.fff...',
      'ffffF..',
      'fffef..',
      'Fffffm.',
      '.Ffmmm.',
      '..mmmm.',
      '..mmmm.',
      '...mn..',
    ] },
    up: { a: [1, 5], rows: [
      '......n',
      '....mmm',
      '...fmmm',
      '.fffem.',
      'ffffff.',
      'Ffff...',
      '.FF....',
    ] },
  },
};

/* Ears sit on top of the head; `o` is their place from the head's corner. */
const DOG_EARS = {
  long: {
    fwd: { o: [-1, 1], rows: ['.rr.', 'rrrr', 'rrrr', 'rrrr', 'rrrr', 'rrrR', 'rrRR', 'rrRR', '.rR.', '..R.'] },
    down: { o: [-1, 1], rows: ['rr..', 'rrr.', 'rrrr', 'rrrr', 'rrrr', '.rrR', '.rRR', '.rRR', '..RR', '..R.'] },
    up: { o: [-1, 4], rows: ['rr..', 'rrr.', 'rrrr', '.rrR', '..RR'] },
  },
  mid: {
    fwd: { o: [0, 1], rows: ['rr.', 'rrr', 'rrr', 'rrR', '.R.'] },
    down: { o: [-1, 0], rows: ['rr.', 'rrr', 'rrr', 'rrR', '.R.'] },
    up: { o: [-1, 4], rows: ['rrr.', 'rrrR', '.RR.'] },
  },
  drop: {
    fwd: { o: [0, 1], rows: ['rr.', 'rrr', 'rrR', '.R.'] },
    down: { o: [-1, 0], rows: ['rr', 'rr', 'rR', '.R'] },
    up: { o: [-1, 4], rows: ['rrr', 'rRR'] },
  },
  feather: {
    fwd: { o: [0, 1], rows: ['rr.', 'rrr', 'rrr', 'rrr', 'rRr', 'RrR', '.R.'] },
    down: { o: [-1, 0], rows: ['rr.', 'rrr', 'rrr', 'rrr', 'rRr', 'R.R'] },
    up: { o: [-1, 4], rows: ['rrr.', 'rrrr', '.rRr', '..R.'] },
  },
  prick: {
    fwd: { o: [0, -3], rows: ['.r..', '.rr.', 'rrr.', 'rrrr'] },
    down: { o: [-2, -1], rows: ['rr..', '.rrr', '..rr'] },
    up: { o: [-2, 2], rows: ['rr..', '.rrr', '..rr'] },
  },
};

/* The person faces right in a three-quarter view. */
const HUMAN_HEAD = ['.aaaa.', 'aaaaaa', 'aasese', 'asssss', '.ssss.'];
const HUMAN_TORSO = [
  '.jjjjj.',
  'Jjjjjjj',
  'Jjjjjzj',
  'Jjjjjzj',
  'JjjjJzj',
  'Jjjjjzj',
  'Jjjjjjj',
  'ppppppp',
];
const HATS_ART = {
  cap: { o: [0, -1], rows: ['.cccc..', 'cccccCC'] },
  beanie: { o: [0, -2], rows: ['..C...', '.cccc.', 'cccccc', 'CCCCCC'] },
  bush: { o: [-1, -2], rows: ['..cccc..', '..cccc..', 'CCCCCCCC'] },
};

const PROPS = {
  rucksack: ['.cccc..', 'cCCCCc.', 'cccccc.', 'cCddCc.', 'cccccc.', '.CCCC..'],
  bowl: ['.wwww.', 'bbbbbb', '.BBBB.'],
  bush: [
    '....vvvv..vvv...',
    '..vvvyvvvvvyvvv.',
    '.vyvvvvvpvvvvvvv',
    'vvvvvvvvvvvvyvvv',
    'vvyvvvpvvvvvvvvv',
    'vvvvvvvvvvyvvvpv',
    'vyvvvvvvvvvvvvvV',
    'vvvvvvvyvvvvvvvV',
    'vvvyvvvvvvvvpvVV',
    'VvvvvvVvvvvvvvVV',
    '.VVvVVVVVvVVVVV.',
    '..VVVVVVVVVVVV..',
  ],
  heart: ['pp.pp', 'ppppp', 'ppppp', '.ppp.', '..p..'],
  query: ['www', '..w', '.ww', '...', '.w.'],
  spark: ['..g..', '..g..', 'ggwgg', '..g..', '..g..'],
  sparkS: ['.g.', 'gwg', '.g.'],
};

/* Icons for the stones: one hard part each, 7 by 7. */
export const ICONS = {
  ruler: ['.......', 'wwwwwww', 'wdwdwdw', 'wdwwwdw', 'wwwwwww', '.......', '.......'],
  clock: ['..www..', '.wwdww.', 'wwwdwww', 'wwwddww', 'wwwwwww', '.wwwww.', '..www..'],
  article: ['.w.w.w.', '.w.w.w.', '.wwwww.', 'wwwwww.', '.wwwww.', '..www..', '..ddd..'],
  turn: ['....w..', '....ww.', 'wwwwwww', 'w...ww.', 'w...w..', 'w......', 'w......'],
  blind: ['......d', '..wwwd.', '.wwwdw.', 'wwwddww', '.wdwww.', '.dwww..', 'd......'],
  cross: ['ww...ww', 'www.www', '.wwwww.', '..www..', '.wwwww.', 'www.www', 'ww...ww'],
  cobbles: ['.......', 'ww.www.', 'ww.www.', '.......', 'www.ww.', 'www.ww.', '.......'],
  moon: ['..www..', '.ww....', 'ww.....', 'ww.....', 'ww.....', '.ww....', '..www..'],
  compass: ['...w...', '..www..', '.wwdww.', 'wwdddww', '.wwdww.', '..www..', '...w...'],
  paw: ['..g.g..', '.gg.gg.', 'g.....g', 'g.ggg.g', '.ggggg.', '.ggggg.', '..ggg..'],
  flag: ['.wgggg.', '.wggg..', '.wgggg.', '.w.....', '.w.....', '.w.....', 'ww.....'],
  pin: ['..www..', '.wwdww.', '.wdddw.', '.wwdww.', '..www..', '...w...', '...w...'],
  hourglass: ['wwwwwww', '.wdddw.', '..wdw..', '...w...', '..wdw..', '.wdddw.', 'wwwwwww'],
  fork: ['w.....w', 'ww...ww', '.ww.ww.', '..www..', '...w...', '...w...', '...w...'],
  blindfold: ['..www..', '.wwwww.', 'ddddddd', 'ddddddd', '.wwwww.', '.wwwww.', '..www..'],
  query: ['.wwww..', 'ww..ww.', '....ww.', '...ww..', '..ww...', '.......', '..ww...'],
  empty: ['..www..', '.w...w.', 'w.....w', 'w.....w', 'w.....w', '.w...w.', '..www..'],
  far: ['.......', '.w...w.', 'ww...ww', 'wwwwwww', 'ww...ww', '.w...w.', '.......'],
  road: ['w..d..w', 'w.....w', 'w..d..w', 'w.....w', 'w..d..w', 'w.....w', 'w..d..w'],
  car: ['.......', '..www..', '.wdwdw.', 'wwwwwww', 'wwwwwww', '.d...d.', '.......'],
  torch: ['g.g.g..', '.ggg...', 'ggwwg..', '.wwww..', '..wwww.', '...wwd.', '....dd.'],
};

const DIGITS = {
  0: ['www', 'w.w', 'w.w', 'w.w', 'www'], 1: ['.w.', 'ww.', '.w.', '.w.', 'www'],
  2: ['www', '..w', 'www', 'w..', 'www'], 3: ['www', '..w', '.ww', '..w', 'www'],
  4: ['w.w', 'w.w', 'www', '..w', '..w'], 5: ['www', 'w..', 'www', '..w', 'www'],
  6: ['www', 'w..', 'www', 'w.w', 'www'], 7: ['www', '..w', '.w.', '.w.', '.w.'],
  8: ['www', 'w.w', 'www', 'w.w', 'www'], 9: ['www', 'w.w', 'www', '..w', 'www'],
};

/** Every sprite table, for a test or a sprite sheet. */
export const SPRITES = { DOG_TORSO, DOG_HEADS, DOG_EARS, HUMAN_HEAD, HUMAN_TORSO, HATS_ART, PROPS, ICONS, DIGITS };

const baked = new Map();
function colourFor(ch, pal) {
  if (pal && pal[ch]) return pal[ch];
  const lo = ch.toLowerCase();
  if (ch !== lo && pal && pal[lo]) return darker(pal[lo], 0.28);
  return FIXED[ch] || null;
}
/** A sprite turned into a little canvas once, then copied every frame. */
function bake(rows, pal, key) {
  let c = baked.get(key);
  if (c) return c;
  c = makeCanvas(rows[0].length, rows.length);
  const x = ctx2d(c);
  for (let y = 0; y < rows.length; y++) {
    for (let i = 0; i < rows[y].length; i++) {
      const ch = rows[y][i];
      if (ch === '.') continue;
      const col = colourFor(ch, pal);
      if (!col) continue;
      x.fillStyle = col;
      x.fillRect(i, y, 1, 1);
    }
  }
  baked.set(key, c);
  return c;
}
/** Draw a baked sprite, mirrored when `flip`. */
function blit(c, img, x, y, flip) {
  if (!flip) { c.drawImage(img, R(x), R(y)); return; }
  c.save();
  c.translate(R(x) + img.width, R(y));
  c.scale(-1, 1);
  c.drawImage(img, 0, 0);
  c.restore();
}
/** A sprite with its own dark rim, drawn straight onto the scene (icons, digits). */
export function stamp(c, rows, x, y, pal, rim = OUTLINE) {
  c.fillStyle = rim;
  for (let j = 0; j < rows.length; j++) {
    for (let i = 0; i < rows[j].length; i++) {
      if (rows[j][i] === '.') continue;
      c.fillRect(x + i - 1, y + j, 1, 1); c.fillRect(x + i + 1, y + j, 1, 1);
      c.fillRect(x + i, y + j - 1, 1, 1); c.fillRect(x + i, y + j + 1, 1, 1);
    }
  }
  for (let j = 0; j < rows.length; j++) {
    for (let i = 0; i < rows[j].length; i++) {
      const ch = rows[j][i];
      if (ch === '.') continue;
      c.fillStyle = colourFor(ch, pal) || '#ff00ff';
      c.fillRect(x + i, y + j, 1, 1);
    }
  }
}

/* Two scratch canvases put the dark rim round a whole character at once. */
let scratchA = null, scratchB = null;
function scratch(w, h) {
  if (!scratchA || scratchA.width < w || scratchA.height < h) {
    scratchA = makeCanvas(w, h); scratchB = makeCanvas(w, h);
  }
  const a = ctx2d(scratchA), b = ctx2d(scratchB);
  a.setTransform(1, 0, 0, 1, 0, 0); a.clearRect(0, 0, scratchA.width, scratchA.height);
  b.setTransform(1, 0, 0, 1, 0, 0); b.clearRect(0, 0, scratchB.width, scratchB.height);
  return [a, b];
}
function outlined(dst, w, h, draw, rim = OUTLINE) {
  const [a, b] = scratch(w, h);
  draw(a);
  b.globalCompositeOperation = 'source-over';
  b.drawImage(scratchA, 0, 0);
  b.globalCompositeOperation = 'source-in';
  b.fillStyle = rim;
  b.fillRect(0, 0, scratchB.width, scratchB.height);
  b.globalCompositeOperation = 'source-over';
  dst.drawImage(scratchB, -1, 0); dst.drawImage(scratchB, 1, 0);
  dst.drawImage(scratchB, 0, -1); dst.drawImage(scratchB, 0, 1);
  dst.drawImage(scratchA, 0, 0);
}

/* ───────────────────────── 4. Rigs ───────────────────────── */

/* The dog lives in a 34 × 24 box facing right; its paws stand on row 23. */
export const DOG_BOX = { w: 34, h: 24, ground: 23 };
const DOG_TORSO_AT = { stand: [6, 10], sit: [6, 11], lie: [4, 18] };
const HEAD_FROM_NECK = {
  stand: { fwd: [4, -3], down: [5, 5], up: [3, -5] },
  sit: { fwd: [2, -4], down: [3, -1], up: [2, -5] },
  lie: { fwd: [3, -3], down: [4, -1], up: [3, -4] },
};

function dogPal(coat, stage) {
  const st = STAGES[stage] || STAGES.hot;
  return Object.assign({}, coat.pal, { h: st.light, H: st.colour });
}

/** Where the dog's parts are, before drawing: used for the line and pats. */
function dogLayout(P) {
  const body = P.body || 'stand';
  const T = torsoFor(P.coat || COATS[0], body);
  const at = DOG_TORSO_AT[body];
  const jx = P.jx || 0, bob = P.bob || 0;
  const tx = at[0] + jx, ty = at[1] + bob;
  const nb = [tx + T.neck[0], ty + T.neck[1]];
  const off = HEAD_FROM_NECK[body][P.head || 'fwd'];
  const ne = [nb[0] + off[0] + (P.hdx || 0), nb[1] + off[1] + (P.hdy || 0)];
  // The D-ring stands up off the back strap: the line ties on 2 px above the back.
  const ring = [tx + T.strap[0] + 1, ty + T.strap[1] - 3];
  // The line comes in over the croup, just above the back, never round the rump.
  const lineIn = [tx + T.lineIn[0], ty + T.lineIn[1]];
  return { body, T, tx, ty, nb, ne, ring, lineIn };
}

/** A point in the dog's box, to the scene, allowing for a mirrored dog.
    A mirrored dog turns on the spot: its body keeps its place. */
const DOG_TURN = 5;
function dogToScene(P, pt) {
  if (!P.flip) return [P.x + pt[0], P.y + pt[1]];
  return [P.x + DOG_BOX.w - 1 - pt[0] - DOG_TURN, P.y + pt[1]];
}

function dogLeg(c, top, knee, paw, upper, lower) {
  thick(c, top, knee, 2, upper);
  thick(c, knee, paw, 2, lower);
  c.fillStyle = lower;
  c.fillRect(paw[0] + 2, paw[1], 1, 1);
}
function dogRearLeg(c, top, dx, lift, G, upper, lower) {
  const stifle = [top[0] + 1 + R(dx * 0.3), top[1] + 2];
  const hock = [top[0] - 1 + R(dx * 0.6), G - 2 - lift];
  const paw = [top[0] + dx, G - lift];
  thick(c, top, stifle, 2, upper);
  thick(c, stifle, hock, 2, upper);
  thick(c, hock, paw, 2, lower);
  c.fillStyle = lower;
  c.fillRect(paw[0] + 2, paw[1], 1, 1);
}

function dogTail(c, root, coat, pal, angle, body) {
  const type = coat.tail;
  const spec = {
    saber: { len: 7, curl: 9, w: [2, 2, 2, 1, 1, 1, 1] },
    brush: { len: 7, curl: 7, w: [2, 2, 2, 2, 2, 2, 1] },
    otter: { len: 6, curl: 2, w: [2, 2, 2, 2, 1, 1] },
    stub: { len: 4, curl: 4, w: [2, 2, 2, 1] },
  }[type] || { len: 6, curl: 5, w: [2, 2, 1, 1, 1, 1] };
  let a = angle * Math.PI / 180;
  let x = root[0], y = root[1];
  const tip = Math.max(1, Math.floor(spec.len / 3));
  for (let i = 0; i < spec.len; i++) {
    x -= Math.cos(a); y -= Math.sin(a);
    const w = spec.w[i];
    c.fillStyle = i >= spec.len - tip ? pal.T : pal.t;
    c.fillRect(R(x), R(y), w, w);
    a += (spec.curl * Math.PI / 180) * (body === 'sit' ? -0.3 : 1);
  }
}

/** The harness, drawn over the torso: a back strap in the stage colour with a
    cream stitch line and dark edges, a chest strap, and a silver D-ring that
    stands up off the back so the line never lies along the dog. */
function drawHarness(c, T, tx, ty, pal) {
  const [sx, top, bot, chest] = T.strap;
  const solid = (i, j) => j >= 0 && j < T.rows.length && i >= 0 && T.rows[j][i] && T.rows[j][i] !== '.';
  const px = (x, y, col) => { c.fillStyle = col; c.fillRect(tx + x, ty + y, 1, 1); };
  // A near-black edge either side frames the stage colour on any coat.
  const edge = '#2a1512';
  for (let j = top - 1; j <= bot; j++) {
    px(sx - 1, j, edge); px(sx + 2, j, edge);
    px(sx, j, j === top - 1 ? pal.h : j > bot - 2 ? pal.H : pal.h);
    px(sx + 1, j, j > bot - 2 ? pal.H : pal.h);
  }
  // Stitching: a light line down the strap, so it reads on any coat.
  for (let j = top - 1; j < bot - 1; j += 2) px(sx, j, FIXED.l);
  // The chest strap runs forward to the chest.
  let end = sx + 3;
  while (solid(end + 1, chest)) end++;
  for (let i = sx + 3; i <= end; i++) { px(i, chest, pal.h); px(i, chest + 1, edge); }
  px(sx + 3, chest, FIXED.l);
  // The D-ring.
  px(sx + 1, top - 3, FIXED.k); px(sx, top - 2, FIXED.k); px(sx + 2, top - 2, FIXED.k); px(sx + 1, top - 2, edge);
}

/** Draw the dog. P: { x, y, flip, body, legs:{phase}|null, head, hdx, hdy,
    headBack, ear:[dx,dy], tail, mouth, jx, bob, tongue }. */
export function drawDog(c, P, coat, stage) {
  if (!P.coat) P = Object.assign({}, P, { coat });
  const pal = dogPal(coat, stage);
  const key = coat.id + '/' + stage;
  const L = dogLayout(P);
  const { body, T, tx, ty, nb, ne } = L;
  const G = DOG_BOX.ground;
  const flipT = P.flip;
  c.save();
  if (flipT) c.setTransform(-1, 0, 0, 1, P.x + DOG_BOX.w - DOG_TURN, P.y);
  else c.setTransform(1, 0, 0, 1, P.x, P.y);

  const up = pal.b, upF = darker(pal.b, 0.25), lo = pal.u, loF = darker(pal.u, 0.25);
  // Legs on the far side first, a shade darker.
  const ph = P.legs ? P.legs.phase * Math.PI * 2 : null;
  const stride = (a) => (ph === null ? [0, 0] : [R(2.2 * Math.sin(a)), Math.cos(a) > 0.55 ? 2 : Math.cos(a) > 0.1 ? 1 : 0]);
  if (body === 'stand') {
    const ff = T.front[1], fr = T.rear[1];
    const s1 = stride(ph + Math.PI), s2 = stride(ph);
    dogLeg(c, [tx + ff[0], ty + ff[1]], [tx + ff[0] + R(s1[0] * 0.4), ty + ff[1] + 3], [tx + ff[0] + s1[0], G - s1[1]], upF, loF);
    dogRearLeg(c, [tx + fr[0], ty + fr[1]], s2[0], s2[1], G, upF, loF);
  } else if (body === 'lie') {
    c.fillStyle = loF; c.fillRect(tx + 15, G - 2, 7, 2);
  }

  // The tail sits behind the body (sitting, it curls round the feet in front).
  if (body !== 'sit') dogTail(c, [tx + T.tail[0], ty + T.tail[1]], coat, pal, (P.tail == null ? 55 : P.tail) + (coat.tailLift || 0), body);

  blit(c, bake(T.rows, pal, 'torso-' + body + (coat.build || '') + '/' + key), tx, ty);
  drawHarness(c, T, tx, ty, pal);
  if (body === 'sit') dogTail(c, [tx + T.tail[0], ty + T.tail[1]], coat, pal, P.tail == null ? 178 : P.tail, body);

  if (body === 'stand') {
    const nf = T.front[0], nr = T.rear[0];
    const s1 = stride(ph), s2 = stride(ph + Math.PI);
    dogLeg(c, [tx + nf[0], ty + nf[1]], [tx + nf[0] + R(s1[0] * 0.4), ty + nf[1] + 3], [tx + nf[0] + s1[0], G - s1[1]], up, lo);
    dogRearLeg(c, [tx + nr[0], ty + nr[1]], s2[0], s2[1], G, up, lo);
  } else if (body === 'lie') {
    c.fillStyle = lo; c.fillRect(tx + 14, G - 1, 8, 2);
  }

  // Neck, head, ears.
  thick(c, nb, ne, 3, pal.f);
  const headName = P.head || 'fwd';
  const H = DOG_HEADS[coat.head][headName];
  const E = DOG_EARS[coat.ear][headName];
  const hw = H.rows[0].length;
  const back = !!P.headBack;
  const hx = back ? ne[0] - (hw - 1 - H.a[0]) : ne[0] - H.a[0];
  const hy = ne[1] - H.a[1];
  blit(c, bake(H.rows, pal, 'head-' + coat.head + headName + '/' + key), hx, hy, back);
  if (P.mouth) {
    // An open mouth: a dark notch under the nose.
    const nose = findChar(H.rows, 'n');
    if (nose) {
      const mx = back ? hx + hw - 1 - nose[0] : hx + nose[0];
      c.fillStyle = '#5a1a14';
      c.fillRect(mx + (back ? 1 : -1), hy + nose[1] + 1, 1, 1);
      c.fillRect(mx, hy + nose[1] + 1, 1, 1);
    }
  }
  if (P.tongue) {
    const nose = findChar(H.rows, 'n');
    if (nose) {
      const mx = back ? hx + hw - 1 - nose[0] : hx + nose[0];
      c.fillStyle = '#e46a7a';
      c.fillRect(mx, hy + nose[1] + 1, 1, 1);
    }
  }
  const ear = P.ear || [0, 0];
  const ew = E.rows[0].length;
  const ex = back ? hx + hw - E.o[0] - ew - ear[0] : hx + E.o[0] + ear[0];
  // Long ears swing with the head but never hang below the paws.
  const ey = Math.min(hy + E.o[1] + ear[1], G - E.rows.length);
  blit(c, bake(E.rows, pal, 'ear-' + coat.ear + headName + '/' + key), ex, ey, back);
  c.restore();
}
function findChar(rows, ch) {
  for (let y = 0; y < rows.length; y++) { const i = rows[y].indexOf(ch); if (i >= 0) return [i, y]; }
  return null;
}

/** The harness ring, in scene pixels: where the line ties on. */
export function dogRing(P) { return dogToScene(P, dogLayout(P).ring); }
/** Where the line crosses the croup on its way to the ring, in scene pixels. */
function dogLineIn(P) { return dogToScene(P, dogLayout(P).lineIn); }
/** The top of the dog's head, in scene pixels: where a pat lands. */
function dogHeadTop(P) {
  const L = dogLayout(P);
  return dogToScene(P, [L.ne[0] + (P.headBack ? -1 : 1), L.ne[1] - 3]);
}
function dogNose(P) {
  const L = dogLayout(P);
  const H = DOG_HEADS[P.headType || 'hound'][P.head || 'fwd'];
  const n = findChar(H.rows, 'n');
  const pt = [L.ne[0] - H.a[0] + n[0], L.ne[1] - H.a[1] + n[1]];
  return dogToScene(P, pt);
}

/* The person lives in a 16 × 26 box facing right; boots stand on row 25. */
export const HUMAN_BOX = { w: 16, h: 26, ground: 25 };

/** Joints for a pose. o: { bob, crouch, sit, lean, walk (0..1), armN, armF, pump, pat, wave, reach } */
function humanPose(o) {
  const u = (o.bob || 0) + (o.crouch || 0) + (o.sit ? 5 : 0);
  const lean = o.lean || 0;
  const P = {
    head: [5 + lean, 0 + u], torso: [4, 5 + u],
    shN: [9, 6 + u], shF: [5, 6 + u], hipN: [8, 13 + u], hipF: [5, 13 + u],
  };
  const legAt = (hip, side) => {
    if (o.sit) return [[hip[0] + 4, hip[1]], [hip[0] + 5 + (side ? 0 : -1), 23]];
    if (o.crouch) return [[hip[0] + 4, hip[1] + 1 + (side ? 0 : 1)], [hip[0] + (side ? 2 : -1), 23]];
    if (o.walk == null) return [[hip[0], R((hip[1] + 23) / 2)], [hip[0], 23]];
    const a = (o.walk + (side ? 0 : 0.5)) * Math.PI * 2;
    const fx = hip[0] + R(3 * Math.sin(a));
    const lift = Math.cos(a) > 0.3 ? 1 : 0;
    return [[R((hip[0] + fx) / 2) + lift, R((hip[1] + 23) / 2)], [fx, 23 - lift]];
  };
  P.legN = legAt(P.hipN, true);
  P.legF = legAt(P.hipF, false);
  const arm = (s, mode, side) => {
    switch (mode) {
      case 'line': return [[s[0] + 3, s[1] + 2], [s[0] + 6, s[1] + 2]];
      case 'low': return [[s[0] + 1, s[1] + 4], [s[0] + 3, s[1] + 6]];
      case 'feed': return [[s[0] + 2, s[1] + 3], [s[0] + 4 + (o.feed || 0), s[1] + 5]];
      // The fist-pump, on the near side so it clears the head: up (arm
      // straight, fist above the hat) or cocked (fist at the ear, elbow out).
      case 'fist': return o.pump ? [[s[0] + 2, s[1] - 5], [s[0] + 2, s[1] - 11]] : [[s[0] + 4, s[1]], [s[0] + 5, s[1] - 4]];
      case 'lowF': return [[s[0] + 3, s[1] + 4], [s[0] + 6, s[1] + 5]];
      case 'wave': return [[s[0] + 2, s[1] - 3], [s[0] + 2 + (o.wave || 0), s[1] - 7]];
      case 'knee': return [[s[0] + 2, s[1] + 4], [s[0] + 4, s[1] + 6]];
      case 'reach': {
        const t = o.reach; // a point in the box
        return [[R((s[0] + t[0]) / 2), R((s[1] + t[1]) / 2) - 1], [t[0], t[1]]];
      }
      case 'swing': {
        const a = ((o.walk || 0) + (side ? 0 : 0.5)) * Math.PI * 2;
        const sw = -Math.sin(a);
        return [[s[0] + R(1.2 * sw), s[1] + 4], [s[0] + R(2.4 * sw), s[1] + 6]];
      }
      default: return [[s[0], s[1] + 4], [s[0], s[1] + 7]];
    }
  };
  P.armN = arm(P.shN, o.armN || 'hang', true);
  P.armF = arm(P.shF, o.armF || 'hang', false);
  return P;
}

function humanPal(look) {
  const j = look.jacket || '#24426f';
  return {
    a: look.hair || '#3b2a20', s: look.skin || '#e2ae86', S: darker(look.skin || '#e2ae86', 0.18),
    j, J: darker(j, 0.3), z: look.stripe || lighter(j, 0.35), p: look.trousers || '#3a3f4a',
    c: look.hatColour || '#2b3140', C: darker(look.hatColour || '#2b3140', 0.3),
  };
}

/** Draw a person at box (x, y). `parts`: 'all', 'body' (no near arm) or 'arm'. */
export function drawHuman(c, x, y, P, look, parts = 'all') {
  const pal = humanPal(look);
  const key = 'h/' + [pal.a, pal.s, pal.j, pal.z, pal.p].join();
  const at = (p) => [x + p[0], y + p[1]];
  const sleeveN = lighter(pal.j, 0.14), sleeveF = pal.J;
  const boots = look.boots || '#4a3222';
  const drawArm = (sh, arm, col) => {
    thick(c, at(sh), at(arm[0]), 2, col);
    thick(c, at(arm[0]), at(arm[1]), 2, col);
    c.fillStyle = pal.s;
    c.fillRect(x + arm[1][0], y + arm[1][1], 2, 2);
  };
  if (parts === 'arm') { drawArm(P.shN, P.armN, sleeveN); return; }
  const drawLeg = (hip, leg, col) => {
    thick(c, at(hip), at(leg[0]), 2, col);
    thick(c, at(leg[0]), at(leg[1]), 2, col);
    c.fillStyle = boots;
    c.fillRect(x + leg[1][0], y + leg[1][1] + 1, 3, 2);
  };
  drawArm(P.shF, P.armF, sleeveF);
  drawLeg(P.hipF, P.legF, darker(pal.p, 0.25));
  blit(c, bake(HUMAN_TORSO, pal, 'torso/' + key), x + P.torso[0], y + P.torso[1]);
  if (look.stripe) { c.fillStyle = look.stripe; c.fillRect(x + P.torso[0] + 1, y + P.torso[1] + 4, 6, 1); }
  drawLeg(P.hipN, P.legN, pal.p);
  blit(c, bake(HUMAN_HEAD, pal, 'head/' + key), x + P.head[0], y + P.head[1]);
  const hat = HATS_ART[look.hat];
  if (hat) blit(c, bake(hat.rows, pal, 'hat-' + look.hat + '/' + pal.c), x + P.head[0] + hat.o[0], y + P.head[1] + hat.o[1] - (look.hatLift || 0));
  if (look.torch) {
    c.fillStyle = '#26221e';
    c.fillRect(x + P.head[0], y + P.head[1] + 1, 6, 1);
    c.fillStyle = '#fff6c8';
    c.fillRect(x + P.head[0] + 5, y + P.head[1] + 1, 2, 1);
  }
  if (parts === 'all') drawArm(P.shN, P.armN, sleeveN);
}
const handOf = (x, y, arm) => [x + arm[1][0] + 1, y + arm[1][1] + 1];

/* ───────────────────────── 5. The line ─────────────────────────
   One pixel wide, one rope colour, a slightly darker knot every 5 px, stepped on the
   grid. Its length is fixed: when the hand and the harness are that far
   apart it is taut and straight; closer, it hangs in a curve, and any length
   left over lies on the ground. The low point stays in the gap between the
   handler and the dog, so the rope never crosses the dog. */

export const LINE = { colour: '#f39436', knot: '#d0702a' };

/** a: the hand, b: the harness ring, len: the line's length, ground: the
    ground row, gap: [x, x] the low point must stay within, via: where the line
    crosses the croup (optional): from there it runs straight along just above
    the back into the ring. Returns { taut, top }: top is the last stretch into
    the ring, for drawing again over the dog. */
export function drawLine(c, a, b, len, ground, gap, via) {
  const end = via || b;
  const run = via ? Math.hypot(b[0] - via[0], b[1] - via[1]) : 0;
  const dx = end[0] - a[0], dy = end[1] - a[1];
  const d = Math.hypot(dx, dy), L = Math.max(d, len - run);
  const taut = d >= L - 0.5;
  let px;
  if (taut) px = linePoints(a[0], a[1], end[0], end[1]);
  else {
    // A parabola of the same length sags by s; a quadratic curve with its
    // control point 2s below the chord sags by the same s.
    const s = Math.sqrt(3 * d * (L - d) / 8);
    let cx = (a[0] + end[0]) / 2;
    if (gap) cx = clamp(cx, Math.min(gap[0], gap[1]), Math.max(gap[0], gap[1]));
    const cy = (a[1] + end[1]) / 2 + 2 * s;
    const n = Math.max(4, Math.ceil((d + 2 * s) / 1.5));
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const u = i / n, v = 1 - u;
      const x = v * v * a[0] + 2 * u * v * cx + u * u * end[0];
      const y = Math.min(ground, v * v * a[1] + 2 * u * v * cy + u * u * end[1]);
      pts.push([x, y]);
    }
    px = pixelPath(pts);
  }
  const top = via ? linePoints(via[0], via[1], b[0], b[1]).slice(1) : [];
  const all = px.concat(top);
  paintRope(c, all, 0);
  return { taut, top: top.slice(-4, -1), count: all.length };
}
function paintRope(c, pts, from) {
  pts.forEach((p, i) => {
    c.fillStyle = (i + from) % 5 === 2 ? LINE.knot : LINE.colour;
    c.fillRect(p[0], p[1], 1, 1);
  });
}

/* ───────────────────────── 6. States ─────────────────────────
   A state is a pure function of time: frame(state, t) says where the team
   is and what it does, so any moment can be drawn again exactly. */

export const STATES = ['waiting', 'trailing', 'lost', 'find', 'missed', 'resting', 'night'];
export const MOMENTS = {
  levelup: { duration: 4400, cues: { tick: 150, paw: 700, name: 1250, trot: 1800, arrive: 3000, buzz: 3500, hide: 3950 } },
  boss: { duration: 8200, cues: { arrive: 1600, toss: 2700, sweep: 3000, gate: 4400, aside: 5000, through: 5300, title: 6900, buzz: 7000 } },
};
/** The frame shown when motion is off. */
export const STILL_AT = { waiting: 300, trailing: 160, lost: 1650, find: 1400, missed: 2300, resting: 300, night: 160, levelup: 4400, boss: 8200 };

/* The team space: 100 × 46, ground on row 42. The dog's box keeps its place;
   the handler stands behind it. ANCHOR is the point that stands on a stone:
   the handler's feet, so the handler stands on the team's stone and the dog
   leads off ahead of it along the trail. */
export const TEAM = { w: 100, h: 46, ground: 42 };
const DX = 36;
const HX = 8;
export const ANCHOR = [15, TEAM.ground];
const LINE_LEN = 26;
const dogY = TEAM.ground - DOG_BOX.ground;
const humY = TEAM.ground - HUMAN_BOX.ground;
/* The gate, in the boss: its shut-to-open steps, with an overshoot. */
const GATE_STEPS = [0, 0.45, 1.12, 1.12, 0.94, 1];

const step = (t, ms) => Math.floor(t / ms);
/* Cycle steps are whole numbers of 30 fps ticks (33.3 ms), so no pose is
   held for an odd tick and the gait stays even. */
const trotPhase = (t) => (step(t, 67) % 6) / 6;
const walkPhase = (t) => (step(t, 100) % 6) / 6;
const wag = (t, ms, amp) => [0, amp, 0, -amp][step(t, ms) % 4];

function dogTrot(t, extra) {
  const ph = trotPhase(t);
  const f = step(t, 67) % 6;
  return Object.assign({
    x: DX, y: dogY, body: 'stand', legs: { phase: ph }, bob: (f === 1 || f === 4) ? 1 : 0,
    head: 'down', hdy: f % 3 === 0 ? 1 : 0, ear: [0, f % 2], tail: 72 + (f % 2 ? 5 : -5),
  }, extra || {});
}
function handlerWalk(t, hx, extra) {
  return { x: hx, pose: humanPose(Object.assign({ walk: walkPhase(t), lean: 1, armN: 'line', armF: 'swing', bob: (step(t, 100) % 3 === 0) ? 1 : 0 }, extra || {})), hold: 'n' };
}

function frameWaiting(t) {
  const T = t % 2400;
  const sniff = T < 1700;
  return {
    handler: { x: HX, pose: humanPose({ armN: 'low', bob: (t % 1800) < 900 ? 0 : 1 }), hold: 'n' },
    dog: { x: DX, y: dogY, body: 'stand', head: sniff ? 'down' : 'fwd', hdy: sniff ? step(t, 220) % 2 : 0, tail: 58 + wag(t, 100, 14), ear: [0, 0] },
    line: 32,
    fx: sniff ? [{ kind: 'scent', near: true }] : [],
  };
}
function frameTrailing(t) {
  return { handler: handlerWalk(t, HX), dog: dogTrot(t), line: LINE_LEN, fx: [{ kind: 'scent' }, { kind: 'dust' }], moving: true };
}
/* Lost it: the dog casts with its head at withers height: air-scenting,
   turning on the spot to check back, the nose dipped. About 167 ms each;
   the ears trail the head by two frames. */
const LOST_HEAD = [
  { head: 'fwd', back: false, hdy: -2 }, { head: 'fwd', back: false, hdy: -3 }, { head: 'fwd', back: false, hdy: -2 },
  { head: 'fwd', back: true, hdy: -2 }, { head: 'fwd', back: true, hdy: -3 }, { head: 'fwd', back: true, hdy: -2 },
  { head: 'fwd', back: false, hdy: -2 }, { head: 'down', back: false, hdy: -2 }, { head: 'down', back: false, hdy: -1 },
  { head: 'fwd', back: false, hdy: -1 },
];
function frameLost(t) {
  const slow = smooth(t / 600);
  const handler = t < 500
    ? handlerWalk(t, HX + R(slow * 3))
    : { x: HX + 3, pose: humanPose({ armN: 'feed', feed: step(t, 467) % 2, lean: -1 }), hold: 'n' };
  if (t < 600) {
    return { handler, dog: dogTrot(t, { x: DX - R(slow * 3), head: t < 300 ? 'down' : 'fwd', hdy: 0, tail: 50 }), line: 28, fx: [] };
  }
  const T = t - 600, n = LOST_HEAD.length;
  const k = step(T, 167) % n;
  const h = LOST_HEAD[k];
  const lag = (j) => LOST_HEAD[(k + n - j) % n].back !== h.back;
  const swing = lag(1) ? 2 : lag(2) ? 1 : 0;
  return {
    handler,
    dog: { x: DX - 3, y: dogY, body: 'stand', head: h.head, flip: h.back, hdy: h.hdy, ear: [swing * (h.back ? 1 : -1), swing ? -1 : 0], tail: 40 + wag(t, 167, 6) },
    line: 28,
    fx: [{ kind: 'query', blink: step(T, 333) % 4 !== 3 }],
  };
}
/** The find. `from` skips the run-in, for the moments where the run-in is a trot. */
function frameFind(t, from = 0) {
  t += from;
  const pop = 420, stop = 650, half = 770, sit = 870;
  const out = { fx: [], person: null, bush: true, line: LINE_LEN };
  if (t < stop) {
    out.dog = dogTrot(t, { tail: 80 });
    out.handler = t < 520 ? handlerWalk(t, HX) : { x: HX, pose: humanPose({ armN: 'line' }), hold: 'n' };
  } else if (t < sit) {
    // The settle: the head comes up and the dog checks on two paces, the line
    // still taut; then the rump folds down and the line starts to give.
    const A = t < half;
    out.dog = { x: DX + 2, y: dogY, body: 'stand', head: 'fwd', hdy: A ? 0 : 1, bob: A ? 0 : 2, tail: A ? 82 : 66, ear: [A ? -1 : 0, 0] };
    out.line = A ? 27 : 30;
    out.handler = { x: HX, pose: humanPose({ armN: 'line' }), hold: 'n' };
  } else {
    // The indication: the dog sits facing the person and barks; the line
    // overshoots slack and settles; the handler drops the line hand and
    // punches the air with the other.
    const T = t - sit;
    const bark = (T % 1000) < 167 || ((T % 1000) > 333 && (T % 1000) < 500);
    out.dog = { x: DX + 2, y: dogY, body: 'sit', head: 'fwd', mouth: bark, tail: 178 + wag(t, 100, 6), ear: [0, bark ? -1 : 0] };
    out.line = T < 100 ? 35 : T < 200 ? 33 : 34;
    const up = step(T, 200) % 2 === 0;
    out.handler = { x: HX, pose: humanPose({ armN: 'fist', pump: up ? 1 : 0, armF: 'lowF', bob: up ? -1 : 0 }), hold: 'f', hatLift: T < 200 ? 1 : 0 };
    if (bark) out.fx.push({ kind: 'bark' });
    if ((T % 1800) < 900) out.fx.push({ kind: 'sparkle', t: T % 1800 });
  }
  // The person rises from behind the bush in three frames: crouched, half up, up.
  if (t >= pop) out.person = { rise: [14, 10, 6][clamp(step(t - pop, 67), 0, 2)], wave: step(t, 233) % 2, toy: true };
  return out;
}
/* The shake travels down the body: head, then body, then tail. */
const SHAKE = [
  { hdx: 2, jx: 0, ear: [2, -3], tail: 48 },
  { hdx: -1, jx: 2, ear: [-2, -2], tail: 58 },
  { hdx: 0, jx: -1, ear: [1, -3], tail: 80 },
];
function frameMissed(t) {
  const out = { fx: [], line: 30 };
  if (t < 400) {
    out.dog = { x: DX, y: dogY, body: 'stand', head: 'down', hdy: step(t, 200) % 2, tail: 40 };
    out.handler = { x: HX, pose: humanPose({ armN: 'line' }), hold: 'n' };
    return out;
  }
  if (t < 1150) {
    // The shake: head, body, tail in turn, the ears flung out, spray off the back.
    const f = SHAKE[step(t, 67) % 3];
    out.dog = { x: DX, y: dogY, body: 'stand', head: 'fwd', hdx: f.hdx, jx: f.jx, ear: f.ear, tail: f.tail };
    out.handler = { x: HX, pose: humanPose({ armN: 'low' }), hold: 'n' };
    out.fx.push({ kind: 'drops', t: t - 400 });
    return out;
  }
  // A calm trot back, a half sit, a sit, a pat. The handler puts the line down.
  const walk = clamp((t - 1150) / 450, 0, 1);
  const dogX = DX - R(smooth(walk) * 5);
  if (walk < 1) out.dog = dogTrot(t, { x: dogX, flip: true, head: 'fwd', hdy: 0, tail: 60 });
  else if (t < 1700) out.dog = { x: dogX, y: dogY, body: 'stand', flip: true, head: 'fwd', bob: 2, tail: 50, ear: [0, 0] };
  else out.dog = { x: dogX, y: dogY, body: 'sit', flip: true, head: 'fwd', tail: 178 + wag(t, 133, 4), ear: [0, 0] };
  const hx = HX + R(smooth(clamp((t - 1150) / 600, 0, 1)) * 4);
  if (t < 1750) {
    out.handler = { x: hx, pose: humanPose({ armN: 'low' }), hold: 'n' };
  } else {
    const top = dogHeadTop(out.dog);
    const pat = step(t, 267) % 2;
    const reach = [clamp(top[0] - hx - 1, 8, 15), top[1] - humY - 1 + pat];
    out.handler = { x: hx, pose: humanPose({ crouch: 4, armN: 'reach', reach, armF: 'low' }), hold: 'ground', armOnTop: true };
    const T = (t - 1950) % 1600;
    if (t > 1950 && T < 1100) out.fx.push({ kind: 'heart', t: T });
  }
  return out;
}
function frameResting(t) {
  const T = t % 3600;
  const drink = T >= 1800 && T < 2800;
  return {
    handler: { x: HX + 2, pose: humanPose({ sit: true, armN: 'knee', armF: 'knee', bob: (t % 2400) < 1200 ? 0 : 1 }), hold: 'n', rucksack: true },
    dog: { x: DX - 2, y: dogY, body: 'lie', head: drink ? 'down' : 'fwd', drink: drink ? step(t, 180) % 2 : -1, hdy: T >= 2800 ? -1 : 0, tongue: drink && step(t, 180) % 2 === 0, tail: -8 + (step(t, 600) % 2) * 10, ear: [0, 0] },
    bowl: true, line: 34,
    fx: [],
  };
}
function frameNight(t) {
  const f = frameTrailing(t);
  f.torch = true;
  return f;
}
/** The props at the find leave quietly: the person ducks, the bush dithers away. */
function hideProps(f, T) {
  if (!f.person) return f;
  f.person.rise = [6, 10, 14, 30][clamp(step(T, 60), 0, 3)];
  f.bushFade = clamp((T - 150) / 300, 0, 1);
  if (f.bushFade >= 1) { f.person = null; f.bush = false; }
  return f;
}
function frameLevelUp(t) {
  const c = MOMENTS.levelup.cues;
  if (t < c.trot) return frameWaiting(t);
  if (t < c.arrive) { const f = frameTrailing(t); f.fx = [{ kind: 'dust' }]; return f; }
  const f = frameFind(t - c.arrive, 430);
  return t >= c.hide ? hideProps(f, t - c.hide) : f;
}
/* The boss, team side: trot in, the find at the gate, the toy, wait for the
   gate, then through it with the toy and on to the next stone. */
function frameBoss(t) {
  const c = MOMENTS.boss.cues;
  if (t < c.arrive) return frameTrailing(t);
  if (t < c.through) {
    const f = frameFind(t - c.arrive, 430);
    f.person.x = DX + 50;
    if (t >= c.toss) {
      // The person throws the toy; the dog catches it and tugs.
      const T = t - c.toss;
      f.person.toy = false;
      f.fx = f.fx.filter(e => e.kind === 'sparkle' && T < 400);
      if (T < 240) f.fx.push({ kind: 'toss', u: T / 240 });
      else {
        const tug = step(T, 133) % 2;
        f.dog = { x: DX + 2, y: dogY, body: 'sit', head: 'fwd', hdx: tug, hdy: tug ? 0 : 1, toy: true, tail: 178 + wag(t, 100, 6), ear: [tug, 0] };
        const up = T < 900 && step(T, 200) % 2 === 0;
        f.handler = { x: HX, pose: humanPose({ armN: T < 900 ? 'fist' : 'low', pump: up ? 1 : 0, armF: 'lowF', bob: up ? -1 : 0 }), hold: 'f' };
      }
    }
    if (t >= c.aside) hideProps(f, t - c.aside);
    return f;
  }
  if (t < c.title) {
    const f = frameTrailing(t);
    f.dog = dogTrot(t, { head: 'fwd', hdy: 2, toy: true, tail: 70 });
    f.fx = [{ kind: 'dust' }];
    return f;
  }
  const f = frameWaiting(t - c.title + 1800);
  f.dog = Object.assign(f.dog, { head: 'fwd', hdy: 1, toy: true });
  f.fx = [];
  return f;
}
/** How open the gate is at boss time t. */
export function gateOpen(t) {
  const T = t - MOMENTS.boss.cues.gate;
  return T < 0 ? 0 : GATE_STEPS[clamp(step(T, 133), 0, GATE_STEPS.length - 1)];
}

export function frame(state, t) {
  switch (state) {
    case 'trailing': return frameTrailing(t);
    case 'lost': return frameLost(t);
    case 'find': return frameFind(t);
    case 'missed': return frameMissed(t);
    case 'resting': return frameResting(t);
    case 'night': return frameNight(t);
    case 'levelup': return frameLevelUp(t);
    case 'boss': return frameBoss(t);
    default: return frameWaiting(t);
  }
}

/* ───────────────────────── 7. Scenes ───────────────────────── */

function shadow(c, cx, gy, w) {
  c.fillStyle = 'rgba(20,16,10,0.22)';
  c.fillRect(cx - (w >> 1) + 1, gy + 1, w - 2, 1);
  c.fillRect(cx - (w >> 1) + 3, gy + 2, w - 6, 1);
}

/* The team is drawn on its own layer first, so night can darken it alone. */
let layer = null;
function teamLayer(W, H) {
  if (!layer || layer.width < W || layer.height < H) layer = makeCanvas(W, H);
  const x = ctx2d(layer);
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.globalCompositeOperation = 'source-over';
  x.clearRect(0, 0, layer.width, layer.height);
  return x;
}
/** Knock pixels out of a layer in an ordered dither: a fade that stays on the grid. */
function ditherOut(c, x0, y0, w, h, amount) {
  if (amount <= 0) return;
  c.save();
  c.globalCompositeOperation = 'destination-out';
  c.fillStyle = '#000';
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (bayer(x, y) < amount) c.fillRect(x, y, 1, 1);
  c.restore();
}

const BUSH_PAL = { v: '#4c8236', y: '#6ea447', p: '#d9412b', V: '#35602a' };

/** The team at (ox, oy) in a scene, from a frame. */
function drawTeam(c, F, t, look, ox, oy, W, H) {
  const coat = coatById(look.coat);
  const stage = look.stage || 'hot';
  const hLook = {
    jacket: jacketById(look.jacket).colour, hat: look.hat || 'none',
    hatColour: (HATS.find(h => h.id === look.hat) || {}).colour, torch: !!F.torch,
    hair: '#3b2a20', skin: '#e2ae86', hatLift: F.handler.hatLift || 0,
  };
  const G = oy + TEAM.ground;
  const hx = ox + F.handler.x, hy = oy + humY;
  const dog = Object.assign({}, F.dog, { x: ox + F.dog.x, y: oy + F.dog.y, headType: coat.head, coat });
  if (dog.drink != null && dog.drink >= 0) {
    // Lapping: the nose dips to the water and no lower.
    const n0 = dogNose(Object.assign({}, dog, { hdy: 0 }));
    dog.hdy = (G - 3 + dog.drink) - n0[1];
  }
  const L = teamLayer(W, H);

  // The person at the find, behind a bush: only the head, arms and toy show.
  if (F.person) {
    const px = ox + (F.person.x != null ? F.person.x : DX + 34), py = oy + humY + F.person.rise;
    const pose = humanPose({ armN: 'wave', armF: 'wave', wave: F.person.wave });
    outlined(L, W, H, (a) => {
      drawHuman(a, px, py, pose, RUNAWAY);
      if (F.person.toy) {
        const hnd = handOf(px, py, pose.armN);
        a.fillStyle = '#d23b2e'; a.fillRect(hnd[0] - 1, hnd[1] - 3, 2, 2);
        a.fillStyle = '#2f6fb8'; a.fillRect(hnd[0] - 1, hnd[1] - 5, 2, 2);
        a.fillStyle = '#d23b2e'; a.fillRect(hnd[0] - 1, hnd[1] - 7, 2, 2);
      }
    });
    L.clearRect(0, G - 11, W, H);
  }
  if (F.person && F.bush) {
    const bx = ox + (F.bushX != null ? F.bushX : (F.person.x != null ? F.person.x : DX + 34));
    const B = PROPS.bush;
    outlined(L, W, H, (a) => blit(a, bake(B, BUSH_PAL, 'bush'), bx, G - B.length + 1));
    if (F.bushFade) ditherOut(L, bx - 1, G - B.length - 1, B[0].length + 2, B.length + 2, F.bushFade);
  }

  // Shadows.
  shadow(L, hx + 8, G, 12);
  shadow(L, dogToScene(dog, [14, 0])[0], G, dog.body === 'lie' ? 22 : 20);

  // Props behind.
  if (F.handler.rucksack) {
    outlined(L, W, H, (a) => blit(a, bake(PROPS.rucksack, { c: '#5e6b3a', d: '#3b4426' }, 'ruck'), hx - 3, G - 5));
  }

  // Handler, then the line, then the dog: the rope runs behind the dog's
  // tail and its low point stays in the gap between them.
  outlined(L, W, H, (a) => drawHuman(a, hx, hy, F.handler.pose, hLook, F.handler.armOnTop ? 'body' : 'all'));
  const DL = dogLayout(dog);
  const e1 = dogToScene(dog, [DL.tx, 0])[0], e2 = dogToScene(dog, [DL.tx + DL.T.rows[0].length, 0])[0];
  const hand = F.handler.hold === 'ground' ? [hx + 2, G] : handOf(hx, hy, F.handler.hold === 'f' ? F.handler.pose.armF : F.handler.pose.armN);
  const via = dog.flip || dog.body === 'lie' && F.handler.hold === 'ground' ? null : dogLineIn(dog);
  const rope = drawLine(L, hand, dogRing(dog), F.line || LINE_LEN, G, [hand[0] + 2, Math.min(e1, e2) - 3], via);
  outlined(L, W, H, (a) => {
    drawDog(a, dog, coat, stage);
    if (dog.toy) {
      const n = dogNose(dog);
      a.fillStyle = '#d23b2e'; a.fillRect(n[0] - 1, n[1] + 1, 2, 2);
      a.fillStyle = '#2f6fb8'; a.fillRect(n[0] + 1, n[1] + 1, 2, 2);
    }
  });
  // The last few pixels into the ring go over the dog's rim, so the line
  // clearly clips on to the harness.
  paintRope(L, rope.top, rope.count - 4);
  if (F.handler.armOnTop) outlined(L, W, H, (a) => drawHuman(a, hx, hy, F.handler.pose, hLook, 'arm'));
  if (F.bowl) {
    // The bowl sits in front of the nose, so a lapping nose dips into it.
    const n = dogNose(Object.assign({}, dog, { head: 'down', hdy: 0 }));
    outlined(L, W, H, (a) => blit(a, bake(PROPS.bowl, { w: '#8fd0f0', b: '#8c99a6' }, 'bowl'), n[0] - 2, G - 2));
  }

  if (F.torch) {
    // Night: the team goes dark like the rest, except inside the torch's
    // cone, where coat, harness and line keep their colours.
    const lx = hx + F.handler.pose.head[0] + 6, ly = hy + F.handler.pose.head[1] + 1;
    L.globalCompositeOperation = 'source-atop';
    for (let x = 0; x < W; x++) {
      const cone = coneAt(lx, ly, G, x);
      L.fillStyle = 'rgba(10,20,52,0.6)';
      if (!cone) { L.fillRect(x, 0, 1, H); continue; }
      L.fillRect(x, 0, 1, cone[0]); L.fillRect(x, cone[1] + 1, 1, H - cone[1] - 1);
      L.fillStyle = 'rgba(10,20,52,0.16)';
      L.fillRect(x, cone[0], 1, cone[1] - cone[0] + 1);
    }
    L.globalCompositeOperation = 'source-over';
    beam(c, lx, ly, G, t);
  }
  c.drawImage(layer, 0, 0);
  if (F.torch) { c.fillStyle = '#fffbe0'; c.fillRect(hx + F.handler.pose.head[0] + 6, hy + F.handler.pose.head[1] + 1, 2, 1); }

  for (const e of F.fx || []) drawFx(c, e, t, F, dog, ox, oy, G);
}

/** The torch's cone at column px: [top, bottom] rows, or null outside it. */
function coneAt(x, y, G, px) {
  const i = px - x;
  if (i < 2 || i >= 44) return null;
  return [y + R(i * 0.42) - R(i * 0.14), Math.min(G + 1, y + R(i * 0.42) + R(i * 0.26) + 1)];
}
/** The light itself, drawn behind the team: a soft wedge and a bright pool
    on the ground ahead, flat tints on the grid (no dither over the dog). */
function beam(c, x, y, G, t) {
  const flick = step(t, 100) % 9 === 0;
  for (let px = x + 2; px < x + 44; px++) {
    const cone = coneAt(x, y, G, px);
    c.fillStyle = flick ? 'rgba(255,236,160,0.12)' : 'rgba(255,236,160,0.17)';
    c.fillRect(px, cone[0], 1, cone[1] - cone[0] + 1);
  }
  c.fillStyle = 'rgba(255,240,175,0.3)';
  for (let k = -2; k <= 1; k++) {
    const half = [8, 13, 15, 12][k + 2];
    c.fillRect(x + 30 - half, G + k, half * 2, 1);
  }
}

function drawFx(c, e, t, F, dog, ox, oy, G) {
  switch (e.kind) {
    case 'scent': {
      // A short line of scent dots on the ground ahead, drifting to the nose
      // and blinking, plus a wisp rising into it.
      const nose = dogNose(dog);
      const dir = dog.flip ? -1 : 1;
      const n = e.near ? 3 : 6;
      const drift = (t / 50) % 4;
      for (let i = 0; i < n; i++) {
        const ph = (step(t, 120) + i) % 3;
        if (ph === 2) continue;
        c.fillStyle = SCENT[ph];
        c.fillRect(R(nose[0] + dir * (2 + i * 4 - drift)), G - 1 - (i % 2), 1, 1);
      }
      const w = step(t, 120) % 3;
      c.fillStyle = SCENT[1];
      c.fillRect(nose[0] + dir * (1 + w), nose[1] + 3 - w, 1, 1);
      break;
    }
    case 'dust': {
      const f = step(t, 80) % 6;
      if (f === 2 || f === 5) {
        const p = dogToScene(dog, [6, DOG_BOX.ground]);
        c.fillStyle = 'rgba(235,225,200,0.8)';
        c.fillRect(p[0] - 2, G - 1, 1, 1); c.fillRect(p[0] - 4, G - 2, 1, 1);
      }
      break;
    }
    case 'query': {
      if (!e.blink) break;
      const top = dogHeadTop(dog);
      stamp(c, PROPS.query, top[0] - 1, top[1] - 9, {});
      break;
    }
    case 'bark': {
      const nose = dogNose(dog);
      c.fillStyle = '#fff6d8';
      c.fillRect(nose[0] + 2, nose[1] - 2, 1, 1); c.fillRect(nose[0] + 3, nose[1] - 3, 1, 1);
      c.fillRect(nose[0] + 3, nose[1], 1, 1); c.fillRect(nose[0] + 4, nose[1] - 1, 1, 1);
      break;
    }
    case 'sparkle': {
      const px = F.person && F.person.x != null ? F.person.x : DX + 34;
      const pts = [[px + 2, 8], [px + 14, 12], [px - 6, 16], [px + 10, 3]];
      pts.forEach((p, i) => {
        const T = e.t - i * 160;
        if (T < 0 || T > 520) return;
        const big = T > 120 && T < 380;
        stamp(c, big ? PROPS.spark : PROPS.sparkS, ox + p[0] - (big ? 2 : 1), oy + p[1] - (big ? 2 : 1), {}, 'rgba(0,0,0,0)');
      });
      break;
    }
    case 'toss': {
      // The toy in the air, from the person's hand to the dog's mouth.
      const px = ox + (F.person && F.person.x != null ? F.person.x : DX + 34) + 10;
      const from = [px, oy + humY + 2], to = dogNose(dog);
      const x = R(from[0] + (to[0] - from[0]) * e.u), y = R(from[1] + (to[1] - from[1]) * e.u - 10 * Math.sin(Math.PI * e.u));
      c.fillStyle = OUTLINE; c.fillRect(x - 1, y - 1, 4, 4);
      c.fillStyle = '#d23b2e'; c.fillRect(x, y, 1, 2);
      c.fillStyle = '#2f6fb8'; c.fillRect(x + 1, y, 1, 2);
      break;
    }
    case 'drops': {
      // Spray off the back and neck, in arcs both ways.
      const DL = dogLayout(dog);
      for (let i = 0; i < 12; i++) {
        const T = e.t - (i % 4) * 90;
        if (T < 0 || T > 460) continue;
        const dir = i % 2 ? 1 : -1;
        const from = dogToScene(dog, [DL.tx + 2 + (i % 6) * 2, DL.ty - 1]);
        const x = R(from[0] + dir * (1 + T / 45 * (0.6 + hash(i) * 0.7)));
        const y = R(from[1] - T / 55 + (T * T) / 21000);
        c.fillStyle = i % 3 ? '#cfe6f5' : '#ffffff';
        c.fillRect(x, y, 1, 1);
      }
      break;
    }
    case 'heart': {
      const hd = dogHeadTop(dog);
      const y = R(hd[1] - 7 - e.t / 180);
      if (e.t > 900 && step(e.t, 70) % 2) break;
      stamp(c, PROPS.heart, hd[0] - 6, y, { p: '#ef5a6f' });
      break;
    }
    default: break;
  }
}

/* The close-up: a landscape strip the team trots through. */
export const CLOSE = { w: 112, h: 62, ground: 56 };

function skyBands(c, W, top, bottom, cols) {
  const n = cols.length;
  const bandH = (bottom - top) / n;
  for (let y = top; y < bottom; y++) {
    const f = (y - top) / bandH;
    const i = Math.min(n - 1, Math.floor(f));
    const frac = f - i;
    for (let x = 0; x < W; x++) {
      // An ordered dither blends each band into the next.
      const useNext = i < n - 1 && frac > 0.45 && bayer(x, y) < (frac - 0.45) / 0.55;
      c.fillStyle = cols[useNext ? i + 1 : i];
      c.fillRect(x, y, 1, 1);
    }
  }
}
function hillLine(c, W, base, amp, period, scroll, col, seed) {
  c.fillStyle = col;
  for (let x = 0; x < W; x++) {
    const wx = x + scroll;
    const h = amp * (0.6 * Math.sin(wx / period + seed) + 0.4 * Math.sin(wx / (period * 0.43) + seed * 2));
    const top = R(base - h);
    c.fillRect(x, top, 1, CLOSE.h - top);
  }
}

/** Paint a landscape into c. kind: 'hot' | 'warm' | 'night'. */
function landscape(c, W, H, kind, scroll, t) {
  const P = LANDS[kind];
  const horizon = 30;
  skyBands(c, W, 0, horizon, P.sky);
  if (kind === 'night') {
    for (let i = 0; i < 40; i++) {
      const x = R(hash(i * 3) * W), y = R(hash(i * 5 + 1) * (horizon - 8));
      if ((step(t, 400) + i) % 9 === 0) continue;
      c.fillStyle = i % 4 ? '#8ea4c8' : '#e8eefc';
      c.fillRect(x, y, 1, 1);
    }
    disc(c, W - 20, 10, 4, P.sun); c.fillStyle = P.sky[0]; disc(c, W - 18, 9, 3, P.sky[0]);
  } else {
    const sx = kind === 'hot' ? W - 22 : W - 30, sy = kind === 'hot' ? 9 : horizon - 6;
    disc(c, sx, sy, kind === 'hot' ? 5 : 8, P.sun);
    disc(c, sx - 1, sy - 1, kind === 'hot' ? 3 : 5, P.sunHi);
  }
  hillLine(c, W, horizon - 6, 4, 26, scroll * 0.15, P.far, 1.3);
  if (kind === 'night') {
    // A small town on the hill, windows lit.
    for (let i = 0; i < 6; i++) {
      const wx = ((i * 23 + 7 - R(scroll * 0.3)) % (W + 30) + W + 30) % (W + 30) - 15;
      const hh = 6 + R(hash(i) * 6);
      c.fillStyle = P.near; c.fillRect(wx, horizon - hh, 9, hh + 2);
      c.fillRect(wx + 1, horizon - hh - 2, 7, 2); c.fillRect(wx + 3, horizon - hh - 3, 3, 1);
      c.fillStyle = P.window;
      if (hash(i + 9) > 0.3) c.fillRect(wx + 2, horizon - hh + 2, 1, 1);
      if (hash(i + 19) > 0.4) c.fillRect(wx + 6, horizon - hh + 4, 1, 1);
    }
  } else {
    hillLine(c, W, horizon - 2, 3, 15, scroll * 0.35, P.near, 4.1);
  }
  if (kind === 'warm') {
    // Autumn trees on the far side: no outline, two dusky tones, small, so
    // the outlined team stands out in front of them.
    for (let i = 0; i < 9; i++) {
      const span = W + 40;
      const wx = ((i * 23 + 11 - R(scroll * 0.4)) % span + span) % span - 20;
      const r = 3 + R(hash(i * 7) * 2);
      const ty = horizon - 3 - r - R(hash(i * 5) * 2);
      c.fillStyle = P.trunk; c.fillRect(wx, ty + r - 1, 1, horizon - ty - r + 1);
      disc(c, wx, ty, r, P.tree);
      disc(c, wx - 1, ty - 1, r - 2, P.treeHi);
    }
  } else {
    // A hedge line.
    c.fillStyle = P.hedge;
    for (let x = 0; x < W; x++) {
      const wx = x + R(scroll * 0.55);
      const h = 2 + R(1.5 + 1.5 * Math.sin(wx / 3.1) + Math.sin(wx / 7.3));
      c.fillRect(x, horizon - h, 1, h + 1);
    }
    c.fillStyle = P.hedgeHi;
    for (let x = 0; x < W; x += 1) {
      const wx = x + R(scroll * 0.55);
      if (hash(wx * 3) > 0.7) c.fillRect(x, horizon - 2 - R(1.5 + 1.5 * Math.sin(wx / 3.1)), 1, 1);
    }
  }
  // The ground.
  c.fillStyle = P.g; c.fillRect(0, horizon, W, H - horizon);
  c.fillStyle = P.gHi; c.fillRect(0, horizon, W, 1);
  for (let row = 0; row < 8; row++) {
    const y0 = horizon + 2 + row * 4;
    const speed = 0.55 + row * 0.08;
    for (let i = 0; i < 16 + row * 2; i++) {
      const span = W + 10;
      const wx = ((R(hash(i * 17 + row * 101) * span) - R(scroll * speed)) % span + span) % span - 5;
      const y = y0 + R(hash(i * 5 + row) * 3);
      const r = hash(i * 11 + row * 7);
      if (r < 0.5) { c.fillStyle = P.tuft; c.fillRect(wx, y, 1, 1); c.fillRect(wx + 1, y - 1, 1, 1); c.fillRect(wx + 2, y, 1, 1); }
      else if (r < 0.75) { c.fillStyle = P.fl; c.fillRect(wx, y, 1, 1); c.fillStyle = P.flHi; c.fillRect(wx + 1, y, 1, 1); }
      else if (r < 0.85) { c.fillStyle = P.fl2; c.fillRect(wx, y, 1, 1); }
      else { c.fillStyle = P.gLo; c.fillRect(wx, y, 3, 1); }
    }
  }
}

const WOOD = { wood: '#8a5a32', hi: '#b07a46', lo: '#5e3a1e' };
function post(c, x, ground, h) {
  c.fillStyle = OUTLINE; c.fillRect(x - 1, ground - h - 1, 4, h + 2);
  c.fillStyle = WOOD.wood; c.fillRect(x, ground - h, 2, h + 1);
  c.fillStyle = WOOD.hi; c.fillRect(x, ground - h, 1, h);
}
/** A gate leaf hung on the post at x, swinging away from us: it turns
    edge-on as it opens, so the rails shorten and the free end rises a
    little (it is further off). The diagonal brace shows at every angle. */
function gateLeaf(c, x, top, gw, h, rails, open) {
  const a = Math.min(open, 1.2) * 62 * Math.PI / 180;
  const w = Math.max(3, R(gw * Math.cos(a)));
  const dy = -R(Math.sin(a) * 2);
  const shade = open > 0.2 ? mix(WOOD.wood, '#3a2414', 0.25) : WOOD.wood;
  const x0 = x + 2, x1 = x0 + w - 1;
  const bars = [];
  for (const ry of rails) bars.push([[x0, top + ry], [x1, top + ry + dy]]);
  bars.push([[x0, top + rails[rails.length - 1]], [x1, top + rails[0] + dy]]);
  bars.push([[x1, top + rails[0] + dy], [x1, top + rails[rails.length - 1] + dy]]);
  for (const [p, q] of bars) thick(c, [p[0], p[1] - 1], [q[0], q[1] - 1], 1, OUTLINE), thick(c, [p[0], p[1] + 1], [q[0], q[1] + 1], 1, OUTLINE);
  for (const [p, q] of bars) { c.fillStyle = OUTLINE; c.fillRect(q[0] + 1, q[1] - 1, 1, 3); }
  for (const [p, q] of bars) thick(c, p, q, 1, shade);
  c.fillStyle = WOOD.hi;
  for (const ry of rails) c.fillRect(x0, top + ry, 1, 1);
}
/** A wooden field gate in the hedge, for the close-up. open: 0 shut … 1
    open (1.12 is the swing past, before it settles). part: 'back' (the
    hinge post and the step, behind the team), 'front' (the latch post and
    the leaf, in front of it) or 'all'. */
export function drawStile(c, x, ground, open, small, part = 'all') {
  const h = small ? 11 : 15, gw = small ? 8 : 12;
  const rails = small ? [3, 6, 9] : [3, 7, 11];
  if (part !== 'front') {
    post(c, x, ground, h);
    c.fillStyle = OUTLINE; c.fillRect(x - 4, ground - 5, 7, 3);
    c.fillStyle = WOOD.hi; c.fillRect(x - 3, ground - 4, 5, 1);
  }
  if (part === 'back') return;
  post(c, x + gw + 3, ground, h);
  gateLeaf(c, x, ground - h, gw, h, rails, open);
  if (open > 1.05) {
    // The swing past the stop knocks up a little dust at the hinge.
    c.fillStyle = 'rgba(240,228,200,0.85)';
    c.fillRect(x - 2, ground - 1, 1, 1); c.fillRect(x + 3, ground - 2, 1, 1); c.fillRect(x + 5, ground, 1, 1); c.fillRect(x - 4, ground - 2, 1, 1);
  }
}
/** The boss landmark on the board, centred on cx: a field gate under a
    hedge arch, a stile with two steps beside it, and the banner. */
function bossGate(c, cx, ground, open, passed) {
  const h = 18, gw = 10, hinge = cx - 6;
  // The banner on its pole, left of the gate: hot red, gold once passed.
  const fx = cx - 15;
  c.fillStyle = OUTLINE; c.fillRect(fx - 1, ground - 31, 3, 32);
  c.fillStyle = '#d8c9a8'; c.fillRect(fx, ground - 30, 1, 30);
  c.fillStyle = OUTLINE; c.fillRect(fx - 12, ground - 31, 12, 10);
  const flag = passed ? '#f2c14e' : STAGES.hot.colour, flagHi = passed ? '#fff0b0' : STAGES.hot.light;
  c.fillStyle = flag; c.fillRect(fx - 11, ground - 30, 11, 8);
  c.fillStyle = flagHi; c.fillRect(fx - 11, ground - 30, 11, 1);
  c.fillStyle = OUTLINE; c.fillRect(fx - 12, ground - 22, 3, 1); c.fillRect(fx - 11, ground - 21, 1, 1);
  stamp(c, ['.w.w.', 'w...w', '.www.', '.www.'], fx - 8, ground - 28, { w: passed ? '#7a4a10' : '#ffe4bd' }, 'rgba(0,0,0,0)');
  // The stile: a three-rail fence with a step either side.
  const sx0 = cx + 8, sx1 = cx + 22;
  post(c, sx0, ground, 13); post(c, sx1, ground, 13);
  for (const ry of [3, 7, 11]) {
    c.fillStyle = OUTLINE; c.fillRect(sx0 + 2, ground - 13 + ry - 1, sx1 - sx0 - 2, 3);
    c.fillStyle = WOOD.wood; c.fillRect(sx0 + 2, ground - 13 + ry, sx1 - sx0 - 2, 1);
  }
  const plank = (x, y, w) => {
    c.fillStyle = OUTLINE; c.fillRect(x - 1, y - 1, w + 2, 4); c.fillRect(x + 1, y + 2, 3, ground - y - 1);
    c.fillStyle = WOOD.hi; c.fillRect(x, y, w, 1);
    c.fillStyle = WOOD.wood; c.fillRect(x, y + 1, w, 1); c.fillRect(x + 2, y + 2, 1, ground - y - 2);
  };
  plank(sx0 + 3, ground - 5, 5); plank(sx0 + 8, ground - 9, 5);
  // The gate: two tall posts with caps, the leaf between.
  post(c, hinge, ground, h); post(c, hinge + gw + 3, ground, h);
  c.fillStyle = OUTLINE; c.fillRect(hinge - 2, ground - h - 3, 6, 3); c.fillRect(hinge + gw + 1, ground - h - 3, 6, 3);
  c.fillStyle = WOOD.hi; c.fillRect(hinge - 1, ground - h - 2, 4, 1); c.fillRect(hinge + gw + 2, ground - h - 2, 4, 1);
  gateLeaf(c, hinge, ground - h, gw, h, [3, 8, 13], open);
}

function bayer(x, y) {
  const m = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  return (m[(y & 3) * 4 + (x & 3)] + 0.5) / 16;
}

/* ───────────────────────── 8. Board scenery ─────────────────────────
   One trail climbing four lands: the red meadow (Hot), the amber wood at
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
/* The lands in the order the trail climbs them, and the boss that closes each. */
const LAND_ORDER = ['hot', 'warm', 'town', 'alp'];
const BOSS_KINDS = ['stile', 'bridge', 'wall', 'cairn'];
const STONE = { base: '#aab0b4', hi: '#d3d8db', lo: '#7e858b', dim: '#8d978c', dimHi: '#a5ae9f', dimLo: '#6f786c' };

/** Digits in a 3 × 5 pixel font, with a dark rim. */
export function drawDigits(c, text, x, y, col = '#ffffff') {
  String(text).split('').forEach((ch, i) => {
    if (DIGITS[ch]) stamp(c, DIGITS[ch], x + i * 4, y, { w: col });
  });
}
export const digitsWidth = (text) => String(text).length * 4 - 1;

/** A level's number on a little wooden plaque, drawn at (0, 0) of its own
    small canvas: it sits under the stone, always in the same place. */
export function plaqueSize(text) { return [digitsWidth(text) + 6, 9]; }
export function drawPlaque(c, text, status, boss) {
  const [w, h] = plaqueSize(text);
  const wood = status === 'ahead' ? '#5d5a4c' : '#6b4a2e', hi = status === 'ahead' ? '#77745f' : '#8c6640';
  c.fillStyle = OUTLINE; c.fillRect(0, 0, w, h);
  c.fillStyle = wood; c.fillRect(1, 1, w - 2, h - 2);
  c.fillStyle = hi; c.fillRect(1, 1, w - 2, 1);
  if (boss) {
    // The boss level's plate has a gold frame.
    c.fillStyle = '#f2c14e'; c.fillRect(1, 1, w - 2, 1); c.fillRect(1, h - 2, w - 2, 1); c.fillRect(1, 1, 1, h - 2); c.fillRect(w - 2, 1, 1, h - 2);
    c.fillStyle = '#b8861b'; c.fillRect(2, h - 2, w - 3, 1); c.fillRect(w - 2, 2, 1, h - 3);
  }
  const col = status === 'ahead' ? '#d6d9cc' : status === 'passed' ? '#ffe39a' : '#ffffff';
  String(text).split('').forEach((ch, i) => {
    const rows = DIGITS[ch];
    c.fillStyle = col;
    if (rows) rows.forEach((r, y) => { for (let x = 0; x < r.length; x++) if (r[x] === 'w') c.fillRect(3 + i * 4 + x, 2 + y, 1, 1); });
  });
}

/* The trail is a curve through the stones, 40 points to each stretch. */
const PATH_N = 40;

/**
 * Lay the board out: the first level at the bottom, climbing upward on a
 * winding trail. levels: [{ level, stage, boss }]. W in art pixels.
 * opts: { spacing, top, bottom, summit }. With `summit` the trail ends at the
 * last stone, under a night sky; otherwise it runs on off the top.
 *
 * Besides the stones and the path it says where each boss stands
 * (`bosses`, bottom to top, each { level, x, y, lock, kind }: y is the line
 * the land changes on), which land a row is in (`landAt`), and how far a point
 * is from the trail (`pathDist`).
 */
export function boardLayout(W, levels, opts = {}) {
  const spacing = opts.spacing || 40, top = opts.top || 70, bottom = opts.bottom || 50;
  /* Room beyond each boss's gate, on top of the usual step to the next
     stone. A gate is as tall as that step, so a team that had just come
     through one had nowhere to stand: it was drawn waist-deep behind the
     arch, or on top of the next stone. With `gateRoom` there is clear ground
     between the two. Nothing lies beyond the last boss, so it gets none. */
  const gateRoom = opts.gateRoom || 0;
  const lifts = [];
  let lift = 0;
  levels.forEach((lv, i) => { lifts.push(lift); if (lv.boss && i < levels.length - 1) lift += gateRoom; });
  const H = top + bottom + (levels.length - 1) * spacing + lift;
  const amp = Math.round(W * 0.25), cx = Math.round(W / 2);
  const stones = levels.map((lv, i) => ({
    ...lv,
    x: lv.boss ? cx : R(cx + amp * Math.sin(i * 0.95 + 0.4)),
    y: H - bottom - i * spacing - lifts[i],
  }));
  const last = stones[stones.length - 1];
  const ctrl = [[stones[0].x - 6, H + 6]].concat(stones.map(s => [s.x, s.y]), opts.summit ? [] : [[cx, -8]]);
  const path = [];
  for (let i = 0; i < ctrl.length - 1; i++) {
    const p0 = ctrl[Math.max(0, i - 1)], p1 = ctrl[i], p2 = ctrl[i + 1], p3 = ctrl[Math.min(ctrl.length - 1, i + 2)];
    for (let k = 0; k < PATH_N; k++) {
      const u = k / PATH_N, u2 = u * u, u3 = u2 * u;
      const f = (a, b, cc, d) => 0.5 * ((2 * b) + (-a + cc) * u + (2 * a - 5 * b + 4 * cc - d) * u2 + (-a + 3 * b - 3 * cc + d) * u3);
      path.push({ x: f(p0[0], p1[0], p2[0], p3[0]), y: f(p0[1], p1[1], p2[1], p3[1]), seg: i - 1 + u });
    }
  }
  if (opts.summit) path.push({ x: last.x, y: last.y, seg: stones.length - 1 });

  /* Where the trail is on each row: it only ever climbs, so one x a row
     answers "how far is this from the trail" without walking the path. */
  const xAt = new Float32Array(H + 1).fill(NaN);
  for (let i = 0; i < path.length - 1; i++) {
    const p = path[i], q = path[i + 1];
    const ya = Math.min(p.y, q.y), yb = Math.max(p.y, q.y);
    for (let y = Math.max(0, Math.ceil(ya)); y <= Math.min(H, Math.floor(yb)); y++) {
      xAt[y] = yb === ya ? p.x : p.x + (q.x - p.x) * (y - p.y) / (q.y - p.y);
    }
  }
  const pathDist = (x, y) => {
    let best = 1e9;
    y = R(y);
    for (let yy = Math.max(0, y - 14); yy <= Math.min(H, y + 14); yy += 2) {
      const px = xAt[yy];
      if (px !== px) continue;
      const d = Math.hypot(px - x, yy - y);
      if (d < best) best = d;
    }
    return best;
  };

  /* A boss's line is where its land ends: just under its stone, and a little
     lower at the footbridge, whose stream lies between the gate and the far
     bank. `lock` is the row the land beyond is dimmed from until the boss is
     beaten: the far bank, so the stream itself is never under the mist. */
  const bosses = stones.filter(s => s.boss).map((s, k) => {
    const kind = BOSS_KINDS[Math.min(k, BOSS_KINDS.length - 1)];
    const y = s.y + (kind === 'bridge' ? 7 : 3);
    return { level: s.level, x: s.x, y, lock: y - (kind === 'bridge' ? 15 : 0), kind, index: k };
  });
  /* The rows above boss k's line are the next land, up to the last one. */
  const landAt = (y) => {
    let k = 0;
    while (k < bosses.length && k < LAND_ORDER.length - 1 && y < bosses[k].y) k++;
    return LAND_ORDER[k];
  };
  /* The summit: a peak under the last stone, and sky over it. */
  /* The top is flat for as far as the team reaches when it stands there,
     so the dog has snow under it, and falls away outside that. */
  const sky = opts.summit ? { x: last.x, y: last.y - 16, drop: 44, flat: 30 } : null;
  const skyAt = (x) => (sky ? sky.y + sky.drop * Math.pow(Math.max(0, Math.abs(x - sky.x) - sky.flat) / (W / 2 - sky.flat), 1.5) : -1e9);

  const layout = { W, H, stones, path, xAt, pathDist, bosses, landAt, sky, skyAt, spacing, bottom,
    hedgeY: bosses.length ? bosses[0].y : -100 };
  // Where the team stands at each stone (facing the next one): scenery keeps out.
  // The team faces the next stone, unless the board's edge is in the way:
  // its art runs about 71 px ahead of the handler's feet.
  const fits = (s, left) => (left ? s.x - 71 >= 0 : s.x + 71 <= W);
  layout.faceLeft = stones.map((s, i) => {
    let left = stones[i + 1] ? stones[i + 1].x < s.x : false;
    if (!fits(s, left) && fits(s, !left)) left = !left;
    return left;
  });
  layout.clear = stones.map((s, i) => teamRect(s, layout.faceLeft[i]));
  /* And just through each gate, where a team that has beaten the boss waits. */
  for (const b of bosses) {
    if (b.level >= stones.length) continue;
    const pt = trailPoint(layout, b.level - 1, throughGate(b.kind));
    layout.clear.push(teamRect({ x: pt[0], y: pt[1] }, layout.faceLeft[b.level - 1]));
  }
  /* A mountain road crosses the trail in the wave that works beside traffic. */
  const roadAt = stones.find(s => s.level === 88);
  layout.roadY = roadAt && landAt(roadAt.y) === 'alp' ? roadAt.y + 20 : null;
  return layout;
}
/** How far past a boss's stone the team stands once it is through, as a
    share of the way to the next stone. Half-way, on a board laid out with
    `gateRoom`, puts its feet above the top of the stile's arch, the bridge's
    rails and the town wall, and still a body's height short of the next
    stone. (0.35 of an ordinary step left it behind the arch from the chest
    down, which is the picture a team keeps until its next pass.) */
export const throughGate = () => 0.5;

/** The box the team's pixels fill when it stands on stone s. */
export function teamRect(s, faceLeft) {
  const a = faceLeft ? TEAM.w - 1 - ANCHOR[0] : ANCHOR[0];
  const left = s.x - a;
  const x0 = faceLeft ? left + TEAM.w - 78 : left + 4;
  return [x0, s.y - 32, x0 + 74, s.y + 5];
}

/** A point on the trail between stone i and stone i+1 (u 0..1), for the trot.
    i is the stone's index (its level less one); -1 is the lead-in to stone 1. */
export function trailPoint(layout, i, u) {
  const p = layout.path[clamp(R((i + u + 1) * PATH_N), 0, layout.path.length - 1)];
  return [R(p.x), R(p.y)];
}
/* The path's points that fall in a band of rows (the trail only climbs). */
function pathRange(layout, y0, y1) {
  /* Found by halving, not worked out from the step between stones: the
     step is longer just past a boss's gate (gateRoom). */
  const p = layout.path;
  const at = (y) => {
    let lo = 0, hi = p.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (p[mid].y > y) lo = mid + 1; else hi = mid; }
    return lo;
  };
  return [Math.max(0, at(y1) - PATH_N), Math.min(p.length - 1, at(y0) + PATH_N)];
}

/** The board in tiles: bands of rows, each small enough for any phone's
    canvas. Returns [{ y0, y1 }] from the top down. */
export function boardTiles(H, tile = 256) {
  const out = [];
  for (let y = 0; y < H; y += tile) out.push({ y0: y, y1: Math.min(H, y + tile) });
  return out;
}
/** Which tiles a window of rows needs, with a margin so a scroll never shows a bare one. */
export function tilesNear(tiles, top, bottom, margin = 0) {
  const out = [];
  tiles.forEach((t, i) => { if (t.y1 > top - margin && t.y0 < bottom + margin) out.push(i); });
  return out;
}

function stoneArt(c, x, y, status) {
  const dim = status === 'ahead';
  ellipse(c, x + 1, y + 3, 8, 3, 'rgba(20,24,12,0.28)');
  ellipse(c, x, y, 8, 5, OUTLINE);
  ellipse(c, x, y, 7, 4, dim ? STONE.dim : STONE.base);
  c.fillStyle = dim ? STONE.dimLo : STONE.lo;
  c.fillRect(x - 5, y + 3, 11, 1); c.fillRect(x - 6, y + 2, 2, 1); c.fillRect(x + 5, y + 2, 2, 1);
  c.fillStyle = dim ? STONE.dimHi : STONE.hi;
  c.fillRect(x - 4, y - 4, 7, 1); c.fillRect(x - 6, y - 3, 3, 1);
}

/* Scenery: big trees (taller than the people, as on a map), flower clumps
   and landmarks, all kept off the trail, the stones and the places the
   team stands. */
function tree(c, x, base, L, r, kind) {
  const trunkH = kind === 'haw' ? 5 : 7;
  c.fillStyle = 'rgba(20,24,12,0.25)'; c.fillRect(x - r + 2, base, r * 2 - 1, 2);
  c.fillStyle = OUTLINE; c.fillRect(x - 2, base - trunkH - 1, 5, trunkH + 2);
  c.fillStyle = L.trunk; c.fillRect(x - 1, base - trunkH, 3, trunkH);
  c.fillStyle = darker(L.trunk, 0.35); c.fillRect(x + 1, base - trunkH, 1, trunkH);
  const cy = base - trunkH - r + 2;
  if (kind === 'pine') {
    // Three filled tiers, dark green with a rim where the low light catches:
    // amber in the wood at dusk, snow on the mountain.
    for (let k = 0; k < 3; k++) {
      const ty = cy - r + 1 + k * 5, w = 2 + k * 2 + R(r / 4);
      for (let j = 0; j < 7; j++) {
        const half = R(w * (j + 1) / 7);
        c.fillStyle = OUTLINE; c.fillRect(x - half - 1, ty + j - 1, half * 2 + 3, 2);
      }
      c.fillStyle = OUTLINE; c.fillRect(x - w - 1, ty + 6, w * 2 + 3, 2);
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
  const col = kind === 'haw' ? [L.haw, L.hawHi, L.hawLo] : [L.tree, L.treeHi, L.treeLo];
  disc(c, x, cy, r + 1, OUTLINE);
  disc(c, x, cy, r, col[0]);
  disc(c, x + 2, cy + 2, r - 2, col[2]);
  disc(c, x - 1, cy - 1, r - 2, col[0]);
  disc(c, x - 3, cy - 3, Math.max(1, r - 6), col[1]);
  c.fillStyle = col[1];
  for (let k = 0; k < 4; k++) c.fillRect(x - r + 3 + R(hash(x * 3 + k) * (r * 2 - 6)), cy - r + 4 + R(hash(base + k * 7) * r), 1, 1);
  if (kind === 'haw') {
    // Hawthorn: berries in the leaves.
    c.fillStyle = L.berry;
    for (let k = 0; k < 7; k++) c.fillRect(x - r + 2 + R(hash(x * 5 + k) * (r * 2 - 4)), cy - r + 3 + R(hash(base * 3 + k) * (r * 2 - 5)), 1, 1);
  }
}
/** A poppy: red petals round a dark eye, on a stem. */
function poppy(c, x, y, L) {
  c.fillStyle = L.tuft; c.fillRect(x, y + 2, 1, 1);
  c.fillStyle = L.fl; c.fillRect(x - 1, y, 3, 1); c.fillRect(x, y - 1, 1, 3);
  c.fillStyle = L.flHi; c.fillRect(x - 1, y - 1, 1, 1);
  c.fillStyle = L.eye; c.fillRect(x, y, 1, 1);
}
function flowerClump(c, x, y, L, rnd) {
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
function pond(c, x, y, ice) {
  ellipse(c, x, y, 13, 5, OUTLINE);
  ellipse(c, x, y, 12, 4, ice ? '#9cc4e4' : '#4f9bc8');
  ellipse(c, x + 1, y + 1, 9, 2, ice ? '#c2dcf0' : '#3c84b4');
  c.fillStyle = ice ? '#ffffff' : '#9fd2ee'; c.fillRect(x - 6, y - 2, 4, 1); c.fillRect(x + 3, y, 3, 1);
  if (ice) { c.fillStyle = '#7fa8cc'; c.fillRect(x - 3, y + 1, 5, 1); c.fillRect(x + 1, y + 2, 1, 1); return; }
  // Reeds at one end.
  for (let k = 0; k < 4; k++) {
    const rx = x + 9 + k * 2, top = y - 6 + (k % 2);
    c.fillStyle = OUTLINE; c.fillRect(rx - 1, top - 1, 3, 8 - (k % 2));
    c.fillStyle = '#4f7a2c'; c.fillRect(rx, top, 1, 6 - (k % 2));
    c.fillStyle = '#7a4a22'; c.fillRect(rx, top, 1, 2);
  }
}
function landmark(c, name, x, y) {
  if (name === 'pond') return pond(c, x, y);
  if (name === 'tarn') return pond(c, x, y, true);
  if (name === 'fountain') return fountain(c, x, y);
  if (name === 'sheep') {
    stamp(c, LANDMARKS.sheep, x - 4, y - 4, { w: '#f4efe2', d: '#3a302a' });
    stamp(c, LANDMARKS.sheep, x + 9, y + 2, { w: '#e8e2d2', d: '#3a302a' });
    return;
  }
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
  if (name === 'deer') return stamp(c, LANDMARKS.deer, x - 6, y - 9, { b: '#a8703a', a: '#ecd8ae', w: '#fff4e0' });
  if (name === 'signpost') return stamp(c, LANDMARKS.signpost, x - 5, y - 10, { p: '#5e3a1e', w: '#d9b07a', d: '#5e3a1e' });
  if (name === 'bench') return stamp(c, LANDMARKS.bench, x - 4, y - 3, { b: '#6b5a70' });
  if (name === 'snowman') return stamp(c, LANDMARKS.snowman, x - 3, y - 7, { w: '#f4f8ff', d: '#2a2f40', g: '#e8743a' });
  if (name === 'tent') {
    stamp(c, LANDMARKS.tent, x - 6, y - 6, { t: '#e8743a', d: '#3a2030' });
    // A lantern by the door.
    c.fillStyle = OUTLINE; c.fillRect(x + 7, y - 3, 3, 4);
    c.fillStyle = '#fff0b0'; c.fillRect(x + 8, y - 2, 1, 2);
    return;
  }
}
/** A car, parked side on. `left` turns it the other way. */
function car(c, x, y, colour, left) {
  const rows = left ? LANDMARKS.car.map(r => r.split('').reverse().join('')) : LANDMARKS.car;
  c.fillStyle = 'rgba(8,10,24,0.35)'; c.fillRect(x - 6, y, 13, 1);
  stamp(c, rows, x - 7, y - 5, { c: colour, w: '#bcd8f0', y: '#fff0b0', r: '#d9412b', d: '#1a1a22' });
}
/** A pool of lamplight on the ground: stepped rings, dithered at the edge. */
function lightPool(c, x, y, rx, ry) {
  for (let dy = -ry; dy <= ry; dy++) {
    for (let dx = -rx; dx <= rx; dx++) {
      const d = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry);
      if (d > 1) continue;
      if (d > 0.5 && bayer(x + dx, y + dy) < (d - 0.5) * 2) continue;
      c.fillStyle = d < 0.25 ? 'rgba(255,224,140,0.42)' : 'rgba(255,224,140,0.22)';
      c.fillRect(x + dx, y + dy, 1, 1);
    }
  }
}
/** A street lamp with its pool of light. */
function lamp(c, x, base, L) {
  lightPool(c, x, base + 1, 11, 5);
  c.fillStyle = OUTLINE; c.fillRect(x - 1, base - 12, 3, 13); c.fillRect(x - 2, base - 16, 5, 5);
  c.fillStyle = '#3a4468'; c.fillRect(x, base - 11, 1, 11);
  c.fillStyle = L.lit; c.fillRect(x - 1, base - 15, 3, 3);
  c.fillStyle = L.litHi; c.fillRect(x, base - 14, 1, 1);
}
/* House walls and roofs for the town: a few of each, picked by the seed. */
const HOUSE_WALLS = ['#4a5788', '#5a5584', '#40607c', '#6a5a78'];
const HOUSE_ROOFS = ['#1b2445', '#3a2748', '#152a3e'];
/** A house seen from the street: pitched roof, a chimney, lit windows.
    `snowy` is the mountain hut: timber, with snow on the roof. */
function house(c, x, base, w, h, seed, L, snowy) {
  const x0 = x - (w >> 1), top = base - h, rh = 6 + (w > 22 ? 1 : 0);
  const wall = snowy ? '#7a5232' : HOUSE_WALLS[R(hash(seed) * 3)];
  const roof = snowy ? L.snow : HOUSE_ROOFS[R(hash(seed + 5) * 2)];
  c.fillStyle = 'rgba(8,10,24,0.3)'; c.fillRect(x0 + 1, base, w, 2);
  // The chimney first, so the roof's rim crosses it.
  const chx = x0 + (hash(seed + 2) > 0.5 ? 3 : w - 6);
  c.fillStyle = OUTLINE; c.fillRect(chx - 1, top - rh - 3, 5, 6);
  c.fillStyle = darker(wall, 0.2); c.fillRect(chx, top - rh - 2, 3, 5);
  // Smoke from one chimney in three, and always from the hut.
  if (snowy || hash(seed + 9) > 0.66) {
    c.fillStyle = snowy ? '#ffffff' : '#7f8db5';
    c.fillRect(chx + 1, top - rh - 5, 1, 1); c.fillRect(chx + 2, top - rh - 7, 2, 1); c.fillRect(chx + 1, top - rh - 10, 2, 1);
  }
  c.fillStyle = OUTLINE; c.fillRect(x0 - 1, top - 1, w + 2, h + 2);
  c.fillStyle = wall; c.fillRect(x0, top, w, h);
  c.fillStyle = darker(wall, 0.25); c.fillRect(x0 + w - 2, top, 2, h); c.fillRect(x0, base - 1, w, 1);
  // The roof: wider than the walls at the eaves, narrowing to the ridge.
  for (let j = 0; j <= rh; j++) {
    const inset = R((rh - j) * 0.9);
    c.fillStyle = OUTLINE; c.fillRect(x0 - 3 + inset, top - rh + j - 1, w + 6 - inset * 2, 2);
  }
  for (let j = 0; j < rh; j++) {
    const inset = R((rh - j) * 0.9);
    c.fillStyle = j === 0 ? lighter(roof, snowy ? 0 : 0.18) : j === rh - 1 ? darker(roof, snowy ? 0.12 : 0.3) : roof;
    c.fillRect(x0 - 2 + inset, top - rh + j, w + 4 - inset * 2, 1);
  }
  // Windows, most of them lit, and a door.
  const n = Math.max(2, Math.floor((w - 4) / 6));
  const door = R(hash(seed + 3) * (n - 1));
  for (let k = 0; k < n; k++) {
    const wx = x0 + R((w - (n - 1) * 6 - 3) / 2) + k * 6;
    if (k === door && h >= 11) {
      c.fillStyle = OUTLINE; c.fillRect(wx - 1, base - 7, 5, 7);
      c.fillStyle = snowy ? '#4a2e1a' : '#2a2038'; c.fillRect(wx, base - 6, 3, 6);
      c.fillStyle = L.lit; c.fillRect(wx + 2, base - 3, 1, 1);
      continue;
    }
    const lit = snowy || hash(seed * 7 + k) > 0.22;
    c.fillStyle = OUTLINE; c.fillRect(wx - 1, top + 2, 5, 6);
    c.fillStyle = lit ? L.lit : L.dark; c.fillRect(wx, top + 3, 3, 4);
    if (lit) { c.fillStyle = L.litHi; c.fillRect(wx, top + 3, 1, 2); }
    c.fillStyle = OUTLINE; c.fillRect(wx + 1, top + 3, 1, 4);
    // A lit window throws a little light on the ground below it.
    if (lit) { c.fillStyle = 'rgba(255,224,140,0.22)'; c.fillRect(wx - 1, base + 1, 5, 1); c.fillRect(wx, base + 2, 3, 1); }
  }
}
/** A boulder; snow lies on it on the mountain. */
function boulder(c, x, y, r, L) {
  ellipse(c, x + 1, y + 1, r, R(r * 0.6), 'rgba(8,10,24,0.3)');
  ellipse(c, x, y - 1, r, R(r * 0.7), OUTLINE);
  ellipse(c, x, y - 1, r - 1, R(r * 0.7) - 1, '#7c88a6');
  c.fillStyle = '#5c6888'; c.fillRect(x - r + 2, y, r * 2 - 4, 1); c.fillRect(x + 1, y - 1, r - 2, 1);
  c.fillStyle = L.snow; c.fillRect(x - r + 2, y - R(r * 0.7), r * 2 - 4, 1); c.fillRect(x - r + 3, y - R(r * 0.7) + 1, r - 1, 1);
}
/** A fountain in the square. */
function fountain(c, x, y) {
  lightPool(c, x, y + 2, 15, 6);
  ellipse(c, x, y, 10, 4, OUTLINE);
  ellipse(c, x, y, 9, 3, '#7c88a6');
  ellipse(c, x, y, 7, 2, '#4f9bc8');
  c.fillStyle = OUTLINE; c.fillRect(x - 1, y - 8, 3, 8);
  c.fillStyle = '#aab3cd'; c.fillRect(x, y - 7, 1, 7);
  c.fillStyle = '#d6ecff'; c.fillRect(x - 2, y - 9, 1, 2); c.fillRect(x + 2, y - 9, 1, 2); c.fillRect(x, y - 10, 1, 2); c.fillRect(x - 3, y - 6, 1, 2); c.fillRect(x + 3, y - 6, 1, 2);
}
/** A snow pole: the markers that show a mountain path under snow. */
function snowPole(c, x, base) {
  c.fillStyle = OUTLINE; c.fillRect(x - 1, base - 9, 3, 10);
  c.fillStyle = '#e8c070'; c.fillRect(x, base - 8, 1, 8);
  c.fillStyle = '#d9412b'; c.fillRect(x, base - 8, 1, 3);
}
const overlaps = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

/* Where everything stands is worked out once for a layout, and kept. Each
   item is { box, base, draw(c) }, sorted so the nearer ones overlap the
   further. */
const scenes = new WeakMap();
function sceneOf(layout) {
  let s = scenes.get(layout);
  if (!s) { s = buildScene(layout); scenes.set(layout, s); }
  return s;
}
function buildScene(layout) {
  const { W, H, stones, clear, bosses, pathDist, landAt, skyAt } = layout;
  const rnd = seeded(7);
  const placed = [], items = [];
  const L = (key) => BOARD_LANDS[key];
  /* Keep out of the band a boss's own art fills. */
  const inBand = (box) => bosses.some(b => box[1] < b.y + 8 && box[3] > b.y - (b.kind === 'wall' ? 62 : 40));
  const onRoad = (box) => layout.roadY != null && box[3] > layout.roadY - 7 && box[3] < layout.roadY + 10;
  const free = (box, gap = 5) => box[0] >= 0 && box[2] <= W && box[1] > skyAt((box[0] + box[2]) / 2) + 4 && !inBand(box) && !onRoad(box) &&
    !clear.some(r => overlaps(r, box)) && !placed.some(r => overlaps(r, box)) &&
    pathDist((box[0] + box[2]) / 2, (box[1] + box[3]) / 2) > Math.max(box[2] - box[0], box[3] - box[1]) / 2 + gap;
  const put = (box, base, draw) => { placed.push(box); items.push({ box, base, draw }); };
  /* The rows of each land, top and bottom. */
  const rows = {};
  LAND_ORDER.forEach((key, k) => {
    const y1 = k === 0 ? H : bosses[k - 1] ? bosses[k - 1].y : null;
    if (y1 == null) return;
    const y0 = k < LAND_ORDER.length - 1 && bosses[k] ? bosses[k].y : 0;
    rows[key] = [y0, y1];
  });
  /* A landmark near a level's stone, wherever there is room. */
  const near = (level, name, ext) => {
    const s = stones[level - 1];
    if (!s) return;
    for (let k = 0; k < 40; k++) {
      const x = R(rnd() * W), y = R(s.y - 20 + rnd() * 40);
      const box = [x + ext[0], y + ext[1], x + ext[2], y + ext[3]];
      if (!free(box)) continue;
      put(box, y, (c) => landmark(c, name, x, y));
      return;
    }
  };

  /* The meadow: a pond, sheep and a log, then big trees down both sides. */
  near(3, 'pond', [-16, -6, 16, 7]); near(8, 'sheep', [-7, -6, 19, 8]); near(12, 'log', [-9, -4, 9, 3]);
  if (rows.hot) {
    const [y0, y1] = rows.hot;
    for (let k = 0; k < (y1 - y0 + 40) / 4; k++) {
      const r = 10 + R(rnd() * 4), side = rnd() < 0.5;
      const x = side ? R(rnd() * W * 0.24) : R(W - rnd() * W * 0.24);
      const base = R(y0 + 20 + rnd() * (y1 - y0));
      const box = [x - r - 1, base - 7 - r * 2 - 1, x + r + 2, base + 2];
      const kind = rnd() < 0.35 ? 'haw' : 'round';
      if (!free(box)) continue;
      put(box, base, (c) => tree(c, x, base, L('hot'), r, kind));
    }
  }
  /* The wood is a wood: many trees, three sizes, three kinds, both sides.
     Under them, what a walk in one turns up. */
  if (rows.warm) {
    const [y0, y1] = rows.warm;
    near(19, 'mushrooms', [-6, -5, 7, 3]); near(22, 'signpost', [-6, -11, 7, 2]); near(25, 'stump', [-4, -5, 4, 2]);
    near(28, 'deer', [-7, -10, 8, 2]); near(31, 'mushrooms', [-6, -5, 7, 3]); near(34, 'log', [-9, -4, 9, 3]);
    near(37, 'pond', [-16, -6, 16, 7]); near(40, 'deer', [-7, -10, 8, 2]); near(43, 'signpost', [-6, -11, 7, 2]);
    for (let k = 0; k < (y1 - y0) / 1.5; k++) {
      const r = [6, 8, 11][R(rnd() * 2)], x = R(rnd() * W);
      const base = R(y0 + 8 + rnd() * (y1 - y0 - 30));
      const box = [x - r, base - 7 - r * 2, x + r + 1, base + 1];
      const pick = rnd();
      if (!free(box)) continue;
      const kind = pick < 0.35 ? 'pine' : pick < 0.6 ? 'haw' : 'round';
      put(box, base, (c) => tree(c, x, base, L('warm'), r, kind));
    }
    for (let k = 0; k < (y1 - y0) / 40; k++) {
      const x = R(8 + rnd() * (W - 16)), y = R(y0 + 10 + rnd() * (y1 - y0 - 50));
      const box = [x - 6, y - 5, x + 7, y + 3];
      if (!free(box, 2)) continue;
      const name = rnd() < 0.7 ? 'mushrooms' : 'stump';
      put(box, y, (c) => landmark(c, name, x, y));
    }
  }
  /* The town: lamps along the street, houses behind them, a square. */
  if (rows.town) {
    const [y0, y1] = rows.town;
    const T = L('town');
    for (const s of stones) {
      if (s.y <= y0 + 30 || s.y >= y1 - 30) continue;
      // A lamp half way to the next stone, on the outside of the bend.
      const p = trailPoint(layout, s.level - 1, 0.5);
      const side = p[0] < W / 2 ? -1 : 1;
      const x = clamp(p[0] + side * 12, 4, W - 5), base = p[1] + 2;
      const box = [x - 2, base - 16, x + 3, base + 1];
      if (inBand(box)) continue;
      put(box, base, (c) => lamp(c, x, base, T));
    }
    near(60, 'fountain', [-16, -11, 16, 8]);
    near(52, 'bench', [-5, -4, 6, 2]); near(64, 'bench', [-5, -4, 6, 2]);
    for (let k = 0; k < (y1 - y0) / 2.2; k++) {
      const w = [20, 26, 26, 32][R(rnd() * 3)], h = 11 + R(rnd() * 4), side = rnd() < 0.5;
      const x = side ? R(w / 2 + 2 + rnd() * W * 0.3) : R(W - w / 2 - 3 - rnd() * W * 0.3);
      const base = R(y0 + 30 + rnd() * (y1 - y0 - 40));
      const seed = k * 31 + 7;
      const box = [x - (w >> 1) - 3, base - h - 14, x + (w >> 1) + 4, base + 3];
      if (!free(box, 3)) continue;
      put(box, base, (c) => house(c, x, base, w, h, seed, T, false));
    }
    for (let k = 0; k < 3; k++) {
      const s = stones[[49, 67, 71][k] - 1];
      if (!s) continue;
      for (let j = 0; j < 30; j++) {
        const x = R(10 + rnd() * (W - 20)), y = R(s.y - 20 + rnd() * 40), left = rnd() < 0.5;
        const box = [x - 8, y - 6, x + 8, y + 2];
        if (!free(box, 3)) continue;
        const col = ['#c8443a', '#3f9a8a', '#d9b23a'][k];
        put(box, y, (c) => car(c, x, y, col, left));
        break;
      }
    }
    for (let k = 0; k < (y1 - y0) / 7; k++) {
      const r = [6, 8][R(rnd())], x = R(rnd() * W);
      const base = R(y0 + 30 + rnd() * (y1 - y0 - 40));
      const box = [x - r, base - 7 - r * 2, x + r + 1, base + 1];
      if (!free(box)) continue;
      put(box, base, (c) => tree(c, x, base, T, r, 'round'));
    }
  }
  /* The climb: a hut, a frozen tarn, then pines thinning out to rock and
     snow, with poles marking the path near the top. */
  if (rows.alp) {
    const [, y1] = rows.alp;
    const A = L('alp');
    const y0 = layout.sky ? layout.sky.y : 0;
    const high = (y) => clamp((y1 - y) / Math.max(1, y1 - y0), 0, 1);
    {
      const s = stones[78];
      for (let j = 0; s && j < 40; j++) {
        const x = R(16 + rnd() * (W - 32)), base = R(s.y - 16 + rnd() * 40);
        const box = [x - 14, base - 26, x + 15, base + 3];
        if (!free(box, 3)) continue;
        put(box, base, (c) => house(c, x, base, 20, 12, 3, A, true));
        break;
      }
    }
    near(83, 'tarn', [-16, -6, 16, 7]); near(92, 'snowman', [-4, -8, 5, 2]); near(96, 'tent', [-7, -7, 11, 2]);
    if (layout.roadY != null) {
      const x = pathDist(W * 0.22, layout.roadY) > 26 ? R(W * 0.22) : R(W * 0.78), y = layout.roadY + 2;
      const box = [x - 8, y - 6, x + 8, y + 2];
      placed.push(box);
      items.push({ box, base: y, draw: (c) => car(c, x, y, '#d9412b', x < W / 2) });
    }
    for (const s of stones) {
      if (s.level < 84 || s.level >= stones.length || landAt(s.y) !== 'alp') continue;
      const p = trailPoint(layout, s.level - 1, 0.5);
      const x = clamp(p[0] + (s.level % 2 ? 9 : -9), 3, W - 4), base = p[1] + 1;
      const box = [x - 1, base - 9, x + 2, base + 1];
      put(box, base, (c) => snowPole(c, x, base));
    }
    for (let k = 0; k < (y1 - y0) / 1.6; k++) {
      const r = [6, 8, 11][R(rnd() * 2)], x = R(rnd() * W);
      const base = R(y0 + 30 + rnd() * (y1 - y0 - 40));
      const box = [x - r, base - 7 - r * 2, x + r + 1, base + 1];
      // Fewer trees the higher the trail climbs, and none near the top.
      const keep = rnd() > high(base) * 1.25;
      if (!keep || !free(box)) continue;
      put(box, base, (c) => tree(c, x, base, A, r, 'pine'));
    }
    for (let k = 0; k < (y1 - y0) / 9; k++) {
      const r = 4 + R(rnd() * 4), x = R(rnd() * W), y = R(y0 + 24 + rnd() * (y1 - y0 - 30));
      const box = [x - r - 1, y - r, x + r + 2, y + 2];
      if (!free(box, 3)) continue;
      put(box, y, (c) => boulder(c, x, y, r, A));
    }
  }
  items.sort((a, b) => a.base - b.base);
  return items;
}

/* ── The ground ── */

/* Ground cover is scattered band by band, each band from its own seed, so
   a tile paints the same rows the same way whatever is painted around it. */
const BAND = 64;
function eachBand(y0, y1, seed, fn) {
  for (let b = Math.floor((y0 - 8) / BAND); b <= Math.floor((y1 + 8) / BAND); b++) fn(b * BAND, seeded((b + 3) * 7919 + seed));
}
/* Where the stream under a footbridge runs: its middle row at each x. */
const streamY = (b, x) => b.y - 7 + R(2 * Math.sin(x / 11 + 1));
const STREAM_HALF = 5;
/* Smooth noise from a lattice of repeatable numbers: where snow lies in
   patches, it lies in soft-edged ones, never in a pattern. */
function valueNoise(x, y, cell) {
  const gx = Math.floor(x / cell), gy = Math.floor(y / cell);
  const fx = smooth(x / cell - gx), fy = smooth(y / cell - gy);
  const h = (i, j) => hash(i * 374761 + j * 668265 + cell);
  const a = h(gx, gy), b = h(gx + 1, gy), c = h(gx, gy + 1), d = h(gx + 1, gy + 1);
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}
/* The summit's sky, the far peaks and the mountain itself, pixel by pixel. */
function alpPixels(layout, y0, y1) {
  const { W, sky, skyAt } = layout;
  const A = BOARD_LANDS.alp;
  const wall = layout.bosses[2] ? layout.bosses[2].y : layout.H;
  const topY = sky ? sky.y : 0;
  const h = y1 - y0;
  const img = new ImageData(W, h);
  const d = img.data;
  const rgb = {};
  const col = (hex) => rgb[hex] || (rgb[hex] = hexToRgb(hex));
  const peaks = sky ? [[W * 0.13, sky.y + 10], [W * 0.88, sky.y + 22], [W * 0.31, sky.y + 34], [W * 0.7, sky.y + 40]] : [];
  /* How much snow lies at a row: none by the town wall, all of it from
     four tenths of the way up. */
  const snowAt = (y) => smooth(((wall - y) / Math.max(1, wall - topY) - 0.04) / 0.36);
  const isSnow = (x, y) => {
    const a = snowAt(y);
    if (a >= 1) return true;
    if (a <= 0) return false;
    const n = 0.7 * valueNoise(x, y, 14) + 0.3 * valueNoise(x + 40, y, 5);
    return a * 1.1 + 0.9 * (n - 0.5) > 0.5 + 0.12 * (bayer(x, y) - 0.5);
  };
  for (let r = 0; r < h; r++) {
    const y = y0 + r;
    for (let x = 0; x < W; x++) {
      let hex;
      if (sky && y < skyAt(x)) {
        // Far peaks stand in front of the sky, snow on their tops.
        let far = 1e9;
        for (const p of peaks) far = Math.min(far, p[1] + Math.abs(x - p[0]) * 0.85);
        if (y >= far) hex = y < far + 5 + R(hash(x * 3) * 3) ? A.farSnow : A.far;
        else {
          const f = clamp(y / (sky.y + sky.drop), 0, 0.999) * A.sky.length;
          const i = Math.floor(f), frac = f - i;
          hex = A.sky[i < A.sky.length - 1 && frac > 0.45 && bayer(x, y) < (frac - 0.45) / 0.55 ? i + 1 : i];
          // The northern lights: two ribbons, dithered thin at their edges.
          const wave = 34 + 9 * Math.sin(x / 21) + 4 * Math.sin(x / 8 + 2);
          const da = Math.abs(y - wave), db = Math.abs(y - (wave - 13 + 3 * Math.sin(x / 13 + 1)));
          if (da < 6 && bayer(x, y) < 0.7 - da / 7) hex = A.aurora;
          else if (db < 5 && bayer(x + 1, y) < 0.5 - db / 9) hex = A.auroraLo;
          const st = hash(x * 7919 + y * 104729);
          if (st < 0.007) hex = st < 0.003 ? A.star : A.starLo;
        }
      } else if (isSnow(x, y)) {
        const k = hash(x * 131 + y * 7919);
        // A blue edge where snow meets rock or the sky, and soft drifts.
        const edge = (sky && y - 1 < skyAt(x)) ? false : !isSnow(x, y + 1);
        hex = edge ? A.snowLo : k < 0.012 ? A.snowHi : k < 0.04 ? A.snowLo : A.snow;
      } else {
        const k = hash(x * 131 + y * 7919);
        hex = k < 0.08 ? A.gHi : k < 0.17 ? A.gLo : A.g;
      }
      const c3 = col(hex), i = (r * W + x) * 4;
      d[i] = c3[0]; d[i + 1] = c3[1]; d[i + 2] = c3[2]; d[i + 3] = 255;
    }
  }
  return img;
}
function paintGround(c, layout, y0, y1) {
  const { W, H, bosses, landAt, pathDist } = layout;
  /* The base colour of each land's rows. */
  const lines = [H].concat(bosses.slice(0, LAND_ORDER.length - 1).map(b => b.y), [0]);
  for (let k = 0; k < lines.length - 1; k++) {
    const a = Math.max(y0, lines[k + 1]), b = Math.min(y1, lines[k]);
    if (b <= a) continue;
    const key = LAND_ORDER[k];
    if (key === 'alp') { c.putImageData(alpPixels(layout, a, b), 0, a - y0); continue; }
    c.fillStyle = BOARD_LANDS[key].g; c.fillRect(0, a, W, b - a);
  }
  const nearStone = (x, y, d) => layout.stones.some(s => Math.abs(s.x - x) < d && Math.abs(s.y - y) < d);
  const WL = BOARD_LANDS.warm;
  eachBand(y0, y1, 11, (by, rnd) => {
    // Mottled ground.
    for (let i = 0; i < (W * BAND) / 60; i++) {
      const x = R(rnd() * W), y = by + R(rnd() * BAND), w = 2 + R(rnd() * 3), hi = rnd() < 0.5;
      const key = landAt(y);
      if (key === 'alp') continue;
      c.fillStyle = hi ? BOARD_LANDS[key].gHi : BOARD_LANDS[key].gLo;
      c.fillRect(x, y, w, 1);
    }
    for (let i = 0; i < (W * BAND) / 90; i++) {
      const x = R(rnd() * W), y = by + R(rnd() * BAND);
      const key = landAt(y);
      if (key === 'alp' || (key === 'town' && i % 3)) continue;
      c.fillStyle = BOARD_LANDS[key].tuft; c.fillRect(x, y, 1, 1); c.fillRect(x + 1, y - 1, 1, 1); c.fillRect(x + 2, y, 1, 1);
    }
    // In the wood: fallen leaves in drifts, three ambers.
    for (let i = 0; i < (W * BAND) / 90; i++) {
      const x = R(rnd() * W), y = by + R(rnd() * BAND), wood = landAt(y) === 'warm';
      for (let k = 0; k < 6; k++) {
        const lx = x + R(rnd() * 8) - 4, ly = y + R(rnd() * 4) - 2;
        if (!wood) continue;
        c.fillStyle = WL.leaves[k % 3];
        c.fillRect(lx, ly, 2 - (k % 2), 1);
      }
    }
    // Flowers in the meadow: a few clumps, never on the trail or by a stone.
    for (let i = 0; i < (W * BAND) / 1500; i++) {
      const x = R(rnd() * W), y = by + R(rnd() * BAND);
      const clump = seeded(x * 977 + y * 131 + 5);
      if (landAt(y - 6) !== 'hot' || pathDist(x, y) < 9 || nearStone(x, y, 16)) continue;
      flowerClump(c, x, y, BOARD_LANDS.hot, clump);
    }
  });
  // Poppies in drifts along both edges of the trail through the meadow.
  const { path } = layout;
  const [i0, i1] = pathRange(layout, y0 - 16, y1 + 16);
  for (let i = i0 - (i0 % 3); i <= i1; i += 3) {
    const p = path[i], q = path[Math.min(path.length - 1, i + 1)];
    if (!p || landAt(p.y - 8) !== 'hot') continue;
    const tx = q.x - p.x, ty = q.y - p.y, n = Math.hypot(tx, ty) || 1;
    const drift = Math.sin(p.seg * 2.3) + Math.sin(p.seg * 5.1) * 0.5;
    if (drift < 0.15) continue;
    for (const side of [-1, 1]) {
      if (hash(i * 31 + side) > 0.55) continue;
      const dd = 7 + R(hash(i * 17 + side * 3) * 6);
      const x = R(p.x - ty / n * dd * side), y = R(p.y + tx / n * dd * side);
      if (pathDist(x, y) < 6 || nearStone(x, y, 13)) continue;
      poppy(c, x, y, BOARD_LANDS.hot);
    }
  }
  // The stream that closes the wood: banks, water, a glint or two.
  for (const b of bosses) {
    if (b.kind !== 'bridge' || b.y - 20 > y1 || b.y + 4 < y0) continue;
    for (let x = 0; x < W; x++) {
      const m = streamY(b, x);
      c.fillStyle = '#3a2a1a'; c.fillRect(x, m - STREAM_HALF - 1, 1, STREAM_HALF * 2 + 3);
      c.fillStyle = '#4f9bc8'; c.fillRect(x, m - STREAM_HALF, 1, STREAM_HALF * 2 + 1);
      c.fillStyle = '#3c84b4'; c.fillRect(x, m + 1, 1, STREAM_HALF);
      c.fillStyle = '#2f6e9c'; c.fillRect(x, m + STREAM_HALF, 1, 1);
      if (hash(x * 13 + b.y) > 0.8) { c.fillStyle = '#b9e0f4'; c.fillRect(x, m - STREAM_HALF + 1 + R(hash(x * 7) * 6), 2, 1); }
    }
    // Stepping rocks and reeds along the banks.
    for (let k = 0; k < W / 22; k++) {
      const x = R(hash(k * 41 + 3) * W), m = streamY(b, x);
      if (Math.abs(x - b.x) < 18) continue;
      c.fillStyle = OUTLINE; c.fillRect(x - 1, m - 1, 5, 4);
      c.fillStyle = '#9aa4ac'; c.fillRect(x, m, 3, 2);
      c.fillStyle = '#d3d8db'; c.fillRect(x, m, 2, 1);
      const rx = R(hash(k * 13 + 9) * W);
      if (Math.abs(rx - b.x) < 18) continue;
      const rm = streamY(b, rx) + STREAM_HALF;
      for (let j = 0; j < 3; j++) {
        c.fillStyle = OUTLINE; c.fillRect(rx + j * 2 - 1, rm - 6 + (j % 2), 3, 7 - (j % 2));
        c.fillStyle = '#6a7a2c'; c.fillRect(rx + j * 2, rm - 5 + (j % 2), 1, 5 - (j % 2));
        c.fillStyle = '#7a4a22'; c.fillRect(rx + j * 2, rm - 5 + (j % 2), 1, 2);
      }
    }
  }
  // Wind drifts on the open snow: a short blue shadow under a bright crest.
  if (bosses[2] && y0 < bosses[2].y) {
    const A = BOARD_LANDS.alp, wall = bosses[2].y, topY = layout.sky ? layout.sky.y : 0;
    eachBand(y0, Math.min(y1, wall), 23, (by, rnd) => {
      for (let i = 0; i < (W * BAND) / 420; i++) {
        const x = R(rnd() * W), y = by + R(rnd() * BAND), w = 5 + R(rnd() * 7);
        if (y > wall - (wall - topY) * 0.42 || y < layout.skyAt(x) + 6 || y < layout.skyAt(x + w) + 6) continue;
        c.fillStyle = A.snowLo; c.fillRect(x, y, w, 1); c.fillRect(x + 1, y + 1, w - 3, 1);
        c.fillStyle = A.snowHi; c.fillRect(x + 1, y - 1, w - 2, 1);
      }
    });
  }
  // The mountain road: tarmac across the slope, a broken white line down it.
  if (layout.roadY != null && layout.roadY + 8 > y0 && layout.roadY - 8 < y1) {
    const ry = layout.roadY;
    c.fillStyle = '#1e2740'; c.fillRect(0, ry - 5, W, 11);
    c.fillStyle = '#3a4460'; c.fillRect(0, ry - 4, W, 9);
    c.fillStyle = '#4a5674'; c.fillRect(0, ry - 4, W, 1);
    c.fillStyle = '#e4ecf7';
    for (let x = 3; x < W; x += 12) c.fillRect(x, ry, 6, 1);
  }
}
function paintTrail(c, layout, y0, y1) {
  const { path, landAt } = layout;
  const [i0, i1] = pathRange(layout, y0 - 8, y1 + 8);
  const land = (p) => BOARD_LANDS[landAt(p.y)];
  // The trail: a dark edge, then the dirt, then a lighter middle.
  for (const [r, key] of [[4, 'dirtLo'], [3, 'dirt']]) {
    for (let i = i0; i <= i1; i++) { const p = path[i]; disc(c, R(p.x), R(p.y), r, land(p)[key]); }
  }
  for (let i = i0 - (i0 % 2); i <= i1; i += 2) {
    const p = path[i]; const L = land(p);
    if (hash(i) > 0.55) { c.fillStyle = L.dirtHi; c.fillRect(R(p.x) + (hash(i + 1) > 0.5 ? 1 : -1), R(p.y), 1, 1); }
    // The town's street is cobbled: joints between the setts.
    if (L.cobble) {
      c.fillStyle = L.cobble;
      c.fillRect(R(p.x) - 2 + R(hash(i * 3) * 4), R(p.y), 1, 1);
      if (i % 4 === 0) c.fillRect(R(p.x) - 2, R(p.y) + 1, 2, 1);
    }
  }
  // The footbridge's deck lies over the water and the trail.
  for (const b of layout.bosses) {
    if (b.kind !== 'bridge' || b.y - 22 > y1 || b.y + 6 < y0) continue;
    const bx = gateX(layout, b), top = b.y - 15, h = 17;
    c.fillStyle = 'rgba(8,10,24,0.35)'; c.fillRect(bx - 7, top + 2, 16, h);
    c.fillStyle = OUTLINE; c.fillRect(bx - 8, top - 1, 17, h + 2);
    for (let j = 0; j < h; j++) {
      c.fillStyle = j % 3 === 2 ? WOOD.lo : j % 3 === 0 ? WOOD.hi : WOOD.wood;
      c.fillRect(bx - 7, top + j, 15, 1);
    }
    // Hand rails down both sides, on posts.
    for (const side of [-8, 8]) {
      c.fillStyle = OUTLINE; c.fillRect(bx + side - 1, top - 4, 3, h + 5);
      c.fillStyle = WOOD.wood; c.fillRect(bx + side, top - 3, 1, h + 3);
      c.fillStyle = WOOD.hi; c.fillRect(bx + side, top - 3, 1, 1); c.fillRect(bx + side, top + 8, 1, 1);
    }
  }
}
/** Where a boss's gateway is, across the board: on its stone, or, for the
    footbridge, where the trail meets the stream. */
export function gateX(layout, b) {
  if (b.kind !== 'bridge') return b.x;
  const x = layout.xAt[clamp(b.y - 7, 0, layout.H)];
  return R(x === x ? x : b.x);
}

/* ── The bosses' landmarks ──
   Each is drawn on its own, in board rows, so the page can put it over the
   team when the team is beyond it, and open its gate a step at a time. */

/** Which way round a boss's landmark is: its tall part goes on the far side
    of the gate from the way the trail comes in. */
function mirrored(c, layout, b, draw) {
  const prev = layout.stones[b.level - 2];
  if (prev && prev.x > b.x) {
    c.save(); c.translate(2 * b.x + 1, 0); c.scale(-1, 1);
    draw();
    c.restore();
  } else draw();
}
/** A banner on a pole: the stage's colour until the boss is beaten, gold after. */
function banner(c, fx, ground, colour, light, passed) {
  c.fillStyle = OUTLINE; c.fillRect(fx - 1, ground - 31, 3, 32);
  c.fillStyle = '#d8c9a8'; c.fillRect(fx, ground - 30, 1, 30);
  c.fillStyle = OUTLINE; c.fillRect(fx - 12, ground - 31, 12, 10);
  c.fillStyle = passed ? '#f2c14e' : colour; c.fillRect(fx - 11, ground - 30, 11, 8);
  c.fillStyle = passed ? '#fff0b0' : light; c.fillRect(fx - 11, ground - 30, 11, 1);
  c.fillStyle = OUTLINE; c.fillRect(fx - 12, ground - 22, 3, 1); c.fillRect(fx - 11, ground - 21, 1, 1);
  stamp(c, ['.w.w.', 'w...w', '.www.', '.www.'], fx - 8, ground - 28, { w: passed ? '#7a4a10' : '#ffe4bd' }, 'rgba(0,0,0,0)');
}
/* The hedgerow that closes the Hot stage: two rows deep, with an arch over
   the gate, the stile and the boss banner. */
function hedgeArt(c, layout, b, gate, passed) {
  const { W } = layout;
  const cx = b.x, hedgeY = b.y, g = hedgeY + 3;
  const gap = (x) => x > cx - 22 && x < cx + 27;
  const bumps = [];
  for (let x = -3; x < W + 4; x += 3) {
    if (gap(x)) continue;
    bumps.push([x, hedgeY - 8 + R(hash(x * 5) * 2), 4 + (hash(x + 3) > 0.5 ? 1 : 0)]);
    bumps.push([x + 1, hedgeY - 2 + R(hash(x * 7) * 2), 4 + (hash(x) > 0.6 ? 1 : 0)]);
  }
  // The arch over the gate.
  for (let k = 0; k <= 8; k++) {
    const a = Math.PI * k / 8;
    bumps.push([R(cx + 1 - Math.cos(a) * 12), R(g - 24 - Math.sin(a) * 7), k % 2 ? 3 : 4]);
  }
  for (const [x, y, r] of bumps) disc(c, x, y, r + 1, OUTLINE);
  for (const [x, y, r] of bumps) disc(c, x, y, r, '#3f6e2e');
  for (const [x, y, r] of bumps) {
    c.fillStyle = '#2f5624'; c.fillRect(x - r + 1, y + r - 1, r * 2 - 1, 1);
    c.fillStyle = '#5a8e3a'; c.fillRect(x - 1, y - r + 1, 3, 1); c.fillRect(x - 2, y - r + 2, 1, 1);
    if (hash(x * 3 + y) > 0.6) { c.fillStyle = '#f4efdc'; c.fillRect(x + 1, y - 1, 1, 1); }
  }
  // Ivy down the arch's legs to the gate posts.
  c.fillStyle = '#3f6e2e';
  for (let y = g - 22; y < g - 12; y += 2) { c.fillRect(cx - 9, y, 2, 1); c.fillRect(cx + 9, y + 1, 2, 1); }
  mirrored(c, layout, b, () => bossGate(c, cx, g, gate, passed));
}
/* The footbridge that closes the wood: a gate at its near end, the Warm
   banner beside it. The deck and the stream are part of the ground. */
function bridgeArt(c, layout, b, gate, passed) {
  const g = b.y + 3, bx = gateX(layout, b);
  mirrored(c, layout, { ...b, x: bx }, () => {
    banner(c, bx - 14, g, STAGES.warm.colour, STAGES.warm.light, passed);
    const h = 15, gw = 12, hinge = bx - 8;
    post(c, hinge, g, h); post(c, hinge + gw + 3, g, h);
    c.fillStyle = OUTLINE; c.fillRect(hinge - 2, g - h - 3, 6, 3); c.fillRect(hinge + gw + 1, g - h - 3, 6, 3);
    c.fillStyle = WOOD.hi; c.fillRect(hinge - 1, g - h - 2, 4, 1); c.fillRect(hinge + gw + 2, g - h - 2, 4, 1);
    gateLeaf(c, hinge, g - h, gw, h, [3, 7, 11], gate);
    // A lantern on the far post: lit once the way is open.
    c.fillStyle = OUTLINE; c.fillRect(hinge + gw + 2, g - h - 8, 4, 5);
    c.fillStyle = passed ? '#fff0b0' : '#7a5a2a'; c.fillRect(hinge + gw + 3, g - h - 7, 2, 3);
  });
}
/* The town wall that closes the town: battlements across the board, an
   arched gate, and a clock tower beside it. */
function wallArt(c, layout, b, gate, passed) {
  const { W } = layout;
  const cx = b.x, g = b.y + 3, wh = 15;
  const stone = '#5a668f', hi = '#7785b0', lo = '#3d4870', joint = '#465280';
  const arch = (x) => x >= cx - 9 && x <= cx + 9;
  // The wall, with a walk along the top and merlons on it.
  c.fillStyle = 'rgba(8,10,24,0.35)'; c.fillRect(0, g, W, 2);
  c.fillStyle = OUTLINE; c.fillRect(-1, g - wh - 1, W + 2, wh + 2);
  c.fillStyle = stone; c.fillRect(0, g - wh, W, wh);
  c.fillStyle = hi; c.fillRect(0, g - wh, W, 1);
  c.fillStyle = lo; c.fillRect(0, g - 2, W, 2);
  c.fillStyle = joint;
  for (let j = 3; j < wh - 2; j += 4) {
    c.fillRect(0, g - wh + j, W, 1);
    for (let x = (j % 8 === 3 ? 2 : 6); x < W; x += 8) c.fillRect(x, g - wh + j + 1, 1, 3);
  }
  for (let x = 1; x < W; x += 6) {
    if (arch(x) || arch(x + 3)) continue;
    c.fillStyle = OUTLINE; c.fillRect(x - 1, g - wh - 5, 5, 5);
    c.fillStyle = stone; c.fillRect(x, g - wh - 4, 3, 4);
    c.fillStyle = hi; c.fillRect(x, g - wh - 4, 3, 1);
  }
  // The arch: a dark way through, round at the top.
  c.fillStyle = OUTLINE; c.fillRect(cx - 8, g - 13, 17, 14); c.fillRect(cx - 6, g - 15, 13, 2);
  c.fillStyle = passed || gate > 0.5 ? BOARD_LANDS.alp.g : '#10162e'; c.fillRect(cx - 7, g - 12, 15, 13); c.fillRect(cx - 5, g - 14, 11, 2);
  c.fillStyle = hi; c.fillRect(cx - 9, g - wh - 3, 19, 1);
  c.fillStyle = OUTLINE; c.fillRect(cx - 10, g - wh - 4, 21, 1); c.fillRect(cx - 10, g - wh - 3, 1, 3); c.fillRect(cx + 10, g - wh - 3, 1, 3);
  c.fillStyle = stone; c.fillRect(cx - 9, g - wh - 2, 19, 2);
  // Torches either side of it.
  for (const tx of [cx - 13, cx + 13]) {
    c.fillStyle = OUTLINE; c.fillRect(tx - 1, g - 11, 3, 6);
    c.fillStyle = '#ffd36a'; c.fillRect(tx, g - 10, 1, 2);
    c.fillStyle = '#fff0b0'; c.fillRect(tx, g - 11, 1, 1);
    c.fillStyle = '#5e3a1e'; c.fillRect(tx, g - 8, 1, 2);
  }
  mirrored(c, layout, b, () => {
    // The clock tower, tall enough to be seen from the street below.
    const tx = cx + 14, tw = 15, th = 40;
    c.fillStyle = OUTLINE; c.fillRect(tx - 1, g - th - 1, tw + 2, th + 2);
    c.fillStyle = stone; c.fillRect(tx, g - th, tw, th);
    c.fillStyle = hi; c.fillRect(tx, g - th, 2, th);
    c.fillStyle = lo; c.fillRect(tx + tw - 3, g - th, 3, th);
    c.fillStyle = joint;
    for (let j = 6; j < th - 2; j += 5) c.fillRect(tx + 2, g - th + j, tw - 5, 1);
    // A pointed roof.
    for (let j = 0; j < 10; j++) {
      const half = R((j + 1) * 0.95);
      c.fillStyle = OUTLINE; c.fillRect(tx + 7 - half - 1, g - th - 11 + j, half * 2 + 3, 2);
    }
    for (let j = 0; j < 10; j++) {
      const half = R((j + 1) * 0.95);
      c.fillStyle = j < 2 ? '#34406e' : '#1b2445'; c.fillRect(tx + 7 - half, g - th - 10 + j, half * 2 + 1, 1);
    }
    c.fillStyle = OUTLINE; c.fillRect(tx + 7, g - th - 15, 1, 5);
    c.fillStyle = passed ? '#f2c14e' : STAGES.cold.colour; c.fillRect(tx + 8, g - th - 15, 4, 3);
    // The clock, and a lit window under it.
    disc(c, tx + 7, g - th + 8, 5, OUTLINE);
    disc(c, tx + 7, g - th + 8, 4, '#fff0b0');
    c.fillStyle = OUTLINE; c.fillRect(tx + 7, g - th + 5, 1, 4); c.fillRect(tx + 7, g - th + 8, 3, 1);
    c.fillStyle = OUTLINE; c.fillRect(tx + 5, g - th + 19, 5, 8);
    c.fillStyle = '#ffd36a'; c.fillRect(tx + 6, g - th + 20, 3, 6);
    c.fillStyle = '#fff0b0'; c.fillRect(tx + 6, g - th + 20, 1, 3);
    // The gate in the arch: timber, swinging open.
    if (gate < 1.2) {
      c.save();
      c.beginPath(); c.rect(cx - 7, g - 14, 15, 15); c.clip();
      gateLeaf(c, cx - 9, g - 13, 13, 13, [2, 6, 10], gate);
      c.restore();
    }
    // The banner flies from the wall beyond the tower, clear of the gateway.
    banner(c, tx + tw + 15, g - wh, STAGES.cold.colour, STAGES.cold.light, passed);
  });
}
/* The summit cairn: stones piled by everyone who got here, and a flag. */
function cairnArt(c, layout, b, passed) {
  const left = layout.faceLeft[b.level - 1];
  const x = b.x + (left ? 18 : -18), g = b.y + 2;
  const tiers = [15, 13, 11, 9, 7, 5, 3];
  c.fillStyle = 'rgba(8,10,24,0.25)'; c.fillRect(x - 7, g, 17, 2);
  tiers.forEach((w, k) => {
    const y = g - 3 - k * 3, x0 = x - (w >> 1) + (k % 2 ? 1 : 0);
    c.fillStyle = OUTLINE; c.fillRect(x0 - 1, y - 1, w + 2, 5);
    c.fillStyle = k % 2 ? '#8792ac' : '#9ca6bc'; c.fillRect(x0, y, w, 3);
    c.fillStyle = '#c3cbdb'; c.fillRect(x0, y, w - 1, 1);
    c.fillStyle = '#66718f'; c.fillRect(x0 + 1, y + 2, w - 1, 1);
    if (w > 6) { c.fillStyle = OUTLINE; c.fillRect(x0 + R(w * (k % 2 ? 0.4 : 0.6)), y, 1, 3); }
  });
  // Snow on the top stones.
  c.fillStyle = '#ffffff'; c.fillRect(x - 1, g - 3 - 6 * 3, 3, 1); c.fillRect(x - 3, g - 3 - 4 * 3, 4, 1);
  // The flag: Cold's blue until the last boss is beaten, gold after.
  const top = g - 3 - 6 * 3;
  c.fillStyle = OUTLINE; c.fillRect(x, top - 14, 3, 14);
  c.fillStyle = '#d8c9a8'; c.fillRect(x + 1, top - 13, 1, 13);
  c.fillStyle = OUTLINE; c.fillRect(x + 2, top - 15, 11, 9);
  c.fillStyle = passed ? '#f2c14e' : STAGES.cold.colour; c.fillRect(x + 3, top - 14, 9, 7);
  c.fillStyle = passed ? '#fff0b0' : STAGES.cold.light; c.fillRect(x + 3, top - 14, 9, 1);
  stamp(c, ['.w.w.', 'w...w', '.www.', '.www.'], x + 5, top - 12, { w: passed ? '#7a4a10' : '#ffffff' }, 'rgba(0,0,0,0)');
}

/**
 * Draw boss k's landmark (k counts from the bottom: the stile, the
 * footbridge, the town wall, the cairn). gate: 0 shut … 1 open.
 */
export function drawBarrier(c, layout, k, gate, passed) {
  const b = layout.bosses[k];
  if (!b) return;
  if (b.kind === 'stile') hedgeArt(c, layout, b, gate, passed);
  else if (b.kind === 'bridge') bridgeArt(c, layout, b, gate, passed);
  else if (b.kind === 'wall') wallArt(c, layout, b, gate, passed);
  else cairnArt(c, layout, b, passed);
}
/** The rows boss k's landmark covers. */
export function barrierBand(layout, k) {
  const b = layout.bosses[k];
  if (!b) return [0, 0];
  return [Math.max(0, b.y - (b.kind === 'wall' ? 62 : 40)), b.y + 8];
}
/** The hedgerow that closes the Hot stage, drawn on its own so the page can
    put it over the team. */
export function drawHedge(c, layout, gate, passed) { drawBarrier(c, layout, 0, gate, passed); }
/** The rows the hedge layer covers. */
export function hedgeBand(layout) { return [layout.hedgeY - 40, layout.hedgeY + 8]; }

/**
 * Paint the board, or a band of its rows.
 * state: { current, start, next, icons: {level: iconName}, prints: [from, to], hedge: false }.
 *   Stones up to `current` are behind the team: those from `start` on were
 *   passed and carry a gold paw, those before it a preset stepped over.
 *   `next` wears the ring (the page draws it) and the rest are dimmed.
 *   Numbers live on plaques the page draws (see drawPlaque), so they stay
 *   readable at night.
 * view: { y0, y1 } paints only those rows, with row y0 at the top of `c`.
 */
export function drawBoard(c, layout, state = {}, view = null) {
  const { W, H, stones } = layout;
  const y0 = view ? Math.max(0, view.y0) : 0, y1 = view ? Math.min(H, view.y1) : H;
  const current = state.current || 0, start = state.start || 1;
  const next = state.next === undefined ? current + 1 : state.next;
  c.save();
  c.translate(0, -y0);
  paintGround(c, layout, y0, y1);
  paintTrail(c, layout, y0, y1);
  for (const it of sceneOf(layout)) if (it.box[3] >= y0 - 3 && it.box[1] <= y1 + 3) it.draw(c);
  if (state.hedge !== false) layout.bosses.forEach((b, k) => drawBarrier(c, layout, k, current >= b.level ? 1 : 0, current >= b.level && start <= b.level));
  // Footprints lead on from the dog's nose into the next stone's ring: a
  // boot sole, then a paw, at even steps along the trail.
  if (state.prints) {
    const a = state.prints[0];
    const at = trailPoint(layout, a, 0.7);
    if (at[1] > y0 - 30 && at[1] < y1 + 30) {
      c.fillStyle = BOARD_LANDS[layout.landAt(at[1])].print;
      for (let k = 0; k < 5; k++) {
        const u = 0.45 + k * 0.12;
        const pt = trailPoint(layout, a, u), nx = trailPoint(layout, a, u + 0.04);
        const tx = nx[0] - pt[0], ty = nx[1] - pt[1], n = Math.hypot(tx, ty) || 1;
        const side = k % 2 ? 2 : -2;
        const x = R(pt[0] - ty / n * side), y = R(pt[1] + tx / n * side);
        if (k % 2) {
          c.fillRect(x - 1, y, 3, 2); c.fillRect(x - 1, y - 2, 1, 1); c.fillRect(x + 1, y - 2, 1, 1);
        } else {
          c.fillRect(x - 1, y - 2, 3, 3); c.fillRect(x - 1, y + 2, 3, 1);
        }
      }
    }
  }
  // Stones and their icons: a gold paw once passed, dimmed when ahead.
  for (const s of stones) {
    const status = s.level <= current ? (s.level >= start ? 'passed' : 'skipped') : s.level === next ? 'next' : 'ahead';
    s.status = status;
    if (s.boss || s.y < y0 - 12 || s.y > y1 + 12) continue;
    stoneArt(c, s.x, s.y, status);
    const icon = status === 'passed' ? ICONS.paw : ICONS[(state.icons || {})[s.level]] || ICONS.ruler;
    const pal = status === 'ahead' ? { w: '#4f5848', d: '#8d978c', g: '#4f5848' } : status === 'passed' ? {} : { d: '#5b4636' };
    stamp(c, icon, s.x - 3, s.y - 4, pal, status === 'ahead' ? 'rgba(0,0,0,0)' : OUTLINE);
  }
  if (layout.sky) {
    // The moon over the far peaks: a crescent, cut by a disc of sky.
    if (y0 < 60) {
      const mx = layout.sky.x > W / 2 ? 30 : W - 30;
      disc(c, mx, 22, 7, '#fff3c4');
      disc(c, mx + 4, 20, 6, BOARD_LANDS.alp.sky[0]);
    }
  } else {
    // Mist at the top: the trail goes on.
    for (let y = Math.max(0, y0); y < Math.min(44, y1); y++) {
      const k = 1 - y / 44;
      for (let x = 0; x < W; x++) if (bayer(x, y) < k * k) { c.fillStyle = '#e9dcc4'; c.fillRect(x, y, 1, 1); }
    }
  }
  c.restore();
}

/** A land not reached yet: its colours sunk towards a dusk violet (still
    itself, just not lit), with mist lying just above the line it starts on.
    Works on raw pixels, whose first row is board row y0; rows from `line`
    down are left alone. */
export function lockPixels(d, W, y0, line) {
  const h = d.length / 4 / W;
  const dusk = [74, 58, 92], mist = [214, 204, 222];
  for (let r = 0; r < h; r++) {
    const y = y0 + r;
    if (y >= line) break;
    // Mist: thick just above the line, thinning upward.
    const m = clamp((y - (line - 26)) / 14, 0, 1) * 0.75;
    for (let x = 0; x < W; x++) {
      const i = (r * W + x) * 4;
      if (!d[i + 3]) continue;
      for (let k = 0; k < 3; k++) d[i + k] = R(d[i + k] * 0.62 + dusk[k] * 0.38);
      if (m > 0 && bayer(x, y) < m) for (let k = 0; k < 3; k++) d[i + k] = R(d[i + k] * 0.35 + mist[k] * 0.65);
    }
  }
  return d;
}
/** The Warm wood before the boss, from the painted board: ImageData for the
    rows above the hedge. */
export function lockedWood(c, layout) {
  const h = Math.max(1, layout.hedgeY);
  const img = c.getImageData(0, 0, layout.W, h);
  lockPixels(img.data, layout.W, 0, h);
  return img;
}
/** The lock lifting as a front climbing from the hedge: rows below it are
    lit, a narrow band at the front is dithered, rows above wait. p 0..1. */
export function unlockWood(locked, layout, p) {
  const out = new ImageData(new Uint8ClampedArray(locked.data), locked.width, locked.height);
  const h = locked.height, d = out.data, band = 5;
  const front = h + band - p * (h + band * 2);
  for (let y = 0; y < h; y++) {
    const k = (y - (front - band)) / (band * 2);
    if (k <= 0) continue;
    for (let x = 0; x < locked.width; x++) if (k >= 1 || bayer(x, y) < k) d[(y * locked.width + x) * 4 + 3] = 0;
  }
  return out;
}
/** Dark theme: the board at dusk. Every colour is moved by the same table
    (cooler and about a fifth darker), so the pixels stay crisp. `y` and `h`
    pick the rows of the canvas to move. */
export function duskify(c, w, h, y = 0) {
  const img = c.getImageData(0, y, w, h), d = img.data, tint = [26, 36, 70];
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue;
    for (let k = 0; k < 3; k++) d[i + k] = R((d[i + k] * 0.74 + tint[k] * 0.26) * 0.94);
  }
  c.putImageData(img, 0, y);
}

/** A small pixel image, copied up `scale` times with no smoothing: a crisp data URL. */
export function crispURL(art, scale) {
  const out = makeCanvas(art.width * scale, art.height * scale);
  const x = ctx2d(out);
  x.drawImage(art, 0, 0, out.width, out.height);
  return out.toDataURL();
}
/** The ring that marks the next stone. */
export function ringArt(big) {
  const c = makeCanvas(25, 17), x = ctx2d(c);
  ellipse(x, 12, 8, big ? 12 : 11, big ? 8 : 7, '#f2c14e');
  ellipse(x, 12, 8, big ? 10 : 9, big ? 6 : 5, 'rgba(0,0,0,1)');
  x.globalCompositeOperation = 'destination-out';
  ellipse(x, 12, 8, big ? 10 : 9, big ? 6 : 5, '#000');
  x.globalCompositeOperation = 'source-over';
  return c;
}

/* ───────────────────────── 9. The player ───────────────────────── */

/**
 * createTeam(canvas, opts) draws the team into `canvas`.
 * opts: { scene: 'team' | 'close', scale (CSS px per art px), state, look:{coat, jacket, hat, stage},
 *         motion (false = still poses), flip, onFrame(t), onEnd() }
 * The loop runs only while the canvas is on screen and the page is visible.
 */
export function createTeam(canvas, opts = {}) {
  const o = Object.assign({ scene: 'team', scale: 3, state: 'waiting', look: {}, motion: true, flip: false }, opts);
  let W = 0, H = 0, buf = null, bctx = null, out = null;
  let raf = 0, last = 0, startAt = 0, pausedAt = null, frozen = null, onScreen = true, ended = false;
  let dead = false;               // destroyed: nothing asks for another frame
  let mixA = null, mixB = null;

  function size() {
    W = o.scene === 'close' ? CLOSE.w : TEAM.w;
    H = o.scene === 'close' ? CLOSE.h : TEAM.h;
    buf = makeCanvas(W, H); bctx = ctx2d(buf);
    const dpr = Math.max(1, Math.round(window.devicePixelRatio || 1));
    canvas.width = W * o.scale * dpr; canvas.height = H * o.scale * dpr;
    canvas.style.width = W * o.scale + 'px'; canvas.style.height = H * o.scale + 'px';
    out = ctx2d(canvas);
  }

  function draw(t) {
    const c = bctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, W, H);
    const state = o.state;
    const F = frame(state, t);
    const look = Object.assign({}, o.look);
    if (o.scene === 'close') {
      drawClose(c, F, t, look, state);
    } else {
      if (o.flip) c.setTransform(-1, 0, 0, 1, W, 0);
      drawTeam(c, F, t, look, 0, 0, W, H);
      c.setTransform(1, 0, 0, 1, 0, 0);
    }
    out.setTransform(1, 0, 0, 1, 0, 0);
    out.imageSmoothingEnabled = false;
    out.clearRect(0, 0, canvas.width, canvas.height);
    out.drawImage(buf, 0, 0, canvas.width, canvas.height);
  }

  function drawClose(c, F, t, look, state) {
    const ox = 4, oy = CLOSE.ground - TEAM.ground;
    let scroll = 0, kind = state === 'night' ? 'night' : (look.stage === 'warm' ? 'warm' : 'hot');
    const v = 0.032;
    if (state === 'boss') {
      const cu = MOMENTS.boss.cues;
      scroll = v * Math.min(t, cu.arrive) + 0.068 * clamp(t - cu.through, 0, cu.title - cu.through);
      const p = clamp((t - cu.sweep) / 1300, 0, 1);
      if (p <= 0) landscape(c, W, H, 'hot', scroll, t);
      else if (p >= 1) landscape(c, W, H, 'warm', scroll, t);
      else sweep(c, scroll, t, p);
      if (t > cu.sweep + 600) leaves(c, t - cu.sweep - 600);
      // The gate stands just ahead of the dog when the team arrives; the
      // person waits on the far side, then ducks behind the bush, which stays.
      // The person waits on the far side, then ducks and the bush fades.
      const gateX = R(ox + DX + 36 + v * cu.arrive - scroll);
      if (F.person) F.person.x = gateX + 18 - ox;
      if (t >= cu.through) {
        // Through the open gate: it is behind the team now.
        drawStile(c, gateX, CLOSE.ground, gateOpen(t), false, 'all');
        drawTeam(c, F, t, look, ox, oy, W, H);
        return;
      }
      drawStile(c, gateX, CLOSE.ground, gateOpen(t), false, 'back');
      drawTeam(c, F, t, look, ox, oy, W, H);
      drawStile(c, gateX, CLOSE.ground, gateOpen(t), false, 'front');
      return;
    }
    if (F.moving) scroll = v * t;
    landscape(c, W, H, kind, scroll, t);
    if (kind === 'warm') leaves(c, t);
    drawTeam(c, F, t, Object.assign(look, { stage: state === 'night' ? 'cold' : look.stage }), ox, oy, W, H);
  }

  function sweep(c, scroll, t, p) {
    if (!mixA) { mixA = makeCanvas(W, H); mixB = makeCanvas(W, H); }
    const a = ctx2d(mixA), b = ctx2d(mixB);
    landscape(a, W, H, 'hot', scroll, t);
    landscape(b, W, H, 'warm', scroll, t);
    const A = a.getImageData(0, 0, W, H), B = b.getImageData(0, 0, W, H);
    // A front climbing from the ground to the sky: below it the new stage,
    // a narrow dithered band at the front, above it the old one.
    const band = 3, front = H + band - p * (H + band * 2);
    for (let y = 0; y < H; y++) {
      const k = (y - (front - band)) / (band * 2);
      if (k <= 0) continue;
      for (let x = 0; x < W; x++) {
        if (k >= 1 || bayer(x, y) < k) {
          const i = (y * W + x) * 4;
          A.data[i] = B.data[i]; A.data[i + 1] = B.data[i + 1]; A.data[i + 2] = B.data[i + 2];
        }
      }
    }
    c.putImageData(A, 0, 0);
  }

  function leaves(c, t) {
    for (let i = 0; i < 9; i++) {
      const life = 2600 + hash(i) * 1400;
      const T = (t + hash(i * 3) * life) % life;
      const x = R((hash(i * 7) * W + T / 40 + Math.sin(T / 300 + i) * 3) % W);
      const y = R(T / life * (CLOSE.ground + 4)) - 2;
      c.fillStyle = i % 3 === 0 ? '#e9a03c' : i % 3 === 1 ? '#c8642a' : '#f2c14e';
      c.fillRect(x, y, step(T, 200) % 2 ? 2 : 1, 1);
    }
  }

  function now() { return (typeof performance !== 'undefined' ? performance.now() : Date.now()); }
  function time() {
    if (frozen != null) return frozen;
    if (!o.motion) return STILL_AT[o.state] || 0;
    if (pausedAt != null) return pausedAt;
    return now() - startAt;
  }

  function tick() {
    raf = 0;
    if (!running()) return;
    const n = now();
    // At most 30 fps: every second frame at 60 Hz, every fourth at 120 Hz.
    // The gate sits below one tick, so a frame that lands a little early
    // under timer jitter is not pushed back to a third vsync.
    if (n - last >= 28) {
      last = n;
      let t = time();
      const m = MOMENTS[o.state];
      if (m && t >= m.duration) { t = m.duration; if (!ended) { ended = true; draw(t); if (o.onFrame) o.onFrame(t); if (o.onEnd) o.onEnd(); } }
      if (!ended) { draw(t); if (o.onFrame) o.onFrame(t); }
    }
    /* Only when nothing is waiting already. onFrame and onEnd above can call
       set() (the board turns the team round, and puts it back to waiting
       when a moment ends), and set() asks for a frame of its own: asking
       again here started a second loop beside it, whose handle was lost.
       destroy() could then stop only one, and the other went on redrawing
       a canvas that was no longer on the page for as long as the app ran. */
    if (!raf && running()) raf = requestAnimationFrame(tick);
  }
  const running = () => !dead && o.motion && frozen == null && onScreen && !document.hidden && !ended;
  function kick() { if (!raf && running()) raf = requestAnimationFrame(tick); }
  function pause() { if (pausedAt == null) pausedAt = now() - startAt; }
  function resume() { if (pausedAt != null) { startAt = now() - pausedAt; pausedAt = null; } }

  const onVis = () => { if (document.hidden) pause(); else { resume(); kick(); } };
  document.addEventListener('visibilitychange', onVis);
  let io = null;
  if (typeof IntersectionObserver !== 'undefined') {
    io = new IntersectionObserver((es) => {
      onScreen = es[es.length - 1].isIntersecting;
      if (onScreen) { resume(); kick(); } else pause();
    });
    /* `watch` is what has to be in view for the clock to run, when that is
       not the sprite itself: a moment played on a board that scrolls must
       not stop because the team is, for a frame, off the edge of it. */
    io.observe(o.watch || canvas);
  }

  size();
  startAt = now();

  const api = {
    /** Change look, state, flip or motion. A new state starts its clock again. */
    set(patch) {
      const restart = patch.state && (patch.state !== o.state || MOMENTS[patch.state]);
      if (patch.look) patch = Object.assign({}, patch, { look: Object.assign({}, o.look, patch.look) });
      Object.assign(o, patch);
      if (patch.scene || patch.scale) size();
      if (restart) { startAt = now(); pausedAt = null; ended = false; }
      if (patch.motion === false) { ended = false; }
      draw(time());
      if (o.onFrame && (frozen != null || !o.motion)) o.onFrame(time());
      kick();
      return api;
    },
    play(state, extra) { return api.set(Object.assign({ state }, extra || {})); },
    /** Hold the clock at t ms (screenshots, tests), or let it run again with null. */
    freeze(t) { frozen = t; draw(time()); if (o.onFrame) o.onFrame(time()); kick(); return api; },
    renderAt(t) { draw(t); return api; },
    skip() { const m = MOMENTS[o.state]; if (m) { startAt = now() - m.duration; pausedAt = null; } kick(); return api; },
    get time() { return time(); },
    get size() { return { w: W, h: H, scale: o.scale }; },
    destroy() {
      dead = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      document.removeEventListener('visibilitychange', onVis);
      if (io) io.disconnect();
    },
  };
  draw(time());
  kick();
  return api;
}
