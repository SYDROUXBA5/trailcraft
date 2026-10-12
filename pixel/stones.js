/* The board's furniture: stepping stones, their icons, the number plaques
   and the ring round the next stone. */

import { bayer, ctx2d, ellipse, makeCanvas, mix, stamp } from './core.js';
import { CAST, RAMPS } from './ramps.js';

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

export const DIGITS = {
  0: ['www', 'w.w', 'w.w', 'w.w', 'www'], 1: ['.w.', 'ww.', '.w.', '.w.', 'www'],
  2: ['www', '..w', 'www', 'w..', 'www'], 3: ['www', '..w', '.ww', '..w', 'www'],
  4: ['w.w', 'w.w', 'www', '..w', '..w'], 5: ['www', 'w..', 'www', '..w', 'www'],
  6: ['www', 'w..', 'www', 'w.w', 'www'], 7: ['www', '..w', '.w.', '.w.', '.w.'],
  8: ['www', 'w.w', 'www', 'w.w', 'www'], 9: ['www', 'w.w', 'www', '..w', 'www'],
};

/* The stones are cut from each land's own rock, so a stone on the snow is
   not the meadow's grey one moved. Five tones each, ink to glint. */
const ROCK = {
  hot: RAMPS.meadow.stone, warm: RAMPS.wood.stone, town: RAMPS.town.stone,
  alp: ['#27304e', '#4c5a80', '#8090b2', '#b8c4dc', '#f0f5fc'],
};
const SHADE = { hot: CAST.meadow, warm: CAST.wood, town: CAST.town, alp: CAST.climb };
/* The number tags: wood in the fields and the wood, slate in the town, dark
   larch under a cap of snow on the climb. [ink, shade, base, light]. */
const TAG = {
  hot: ['#3d2616', '#5a3c22', '#77522f', '#9a7445'],
  warm: ['#2e180e', '#4a2c18', '#683f22', '#8a5a30'],
  town: ['#10152e', '#232c50', '#36426e', '#55648f'],
  alp: ['#1c1a2c', '#332c3a', '#4c3f46', '#eef4fc'],
};

const hexA = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
};

/** Digits in a 3 × 5 pixel font, with a dark rim. */
export function drawDigits(c, text, x, y, col = '#ffffff') {
  String(text).split('').forEach((ch, i) => {
    if (DIGITS[ch]) stamp(c, DIGITS[ch], x + i * 4, y, { w: col });
  });
}

export const digitsWidth = (text) => String(text).length * 4 - 1;

/** A level's number on a little tag, drawn at (0, 0) of its own small
    canvas: it hangs under the stone, always in the same place. */
export function plaqueSize(text) { return [digitsWidth(text) + 6, 9]; }

export function drawPlaque(c, text, status, boss, land = 'hot') {
  const [w, h] = plaqueSize(text);
  let T = TAG[land] || TAG.hot;
  // A stone not reached yet: its tag is the same tag with the colour let out.
  if (status === 'ahead') T = T.map((t, i) => (land === 'alp' && i === 3 ? '#c6d0e2' : mix(t, land === 'town' ? '#2a3350' : '#6a6a66', 0.5)));
  // The outline is the tag's own ink and the corners are cut, so it is a
  // tag on the ground and not a black box stuck on the picture.
  c.fillStyle = T[0]; c.fillRect(1, 0, w - 2, h); c.fillRect(0, 1, w, h - 2);
  c.fillStyle = T[2]; c.fillRect(1, 1, w - 2, h - 2);
  c.fillStyle = T[3]; c.fillRect(1, 1, w - 2, 1);
  c.fillStyle = T[1]; c.fillRect(1, h - 2, w - 2, 1); c.fillRect(w - 2, 2, 1, h - 3);
  if (boss) {
    // The boss level's plate has a gold frame.
    c.fillStyle = '#f2c14e'; c.fillRect(1, 1, w - 2, 1); c.fillRect(1, h - 2, w - 2, 1); c.fillRect(1, 1, 1, h - 2); c.fillRect(w - 2, 1, 1, h - 2);
    c.fillStyle = '#b8861b'; c.fillRect(2, h - 2, w - 3, 1); c.fillRect(w - 2, 2, 1, h - 3);
  }
  const col = status === 'ahead' ? (land === 'town' ? '#aab3cd' : '#e2e3d8') : status === 'passed' ? '#ffe39a' : '#ffffff';
  String(text).split('').forEach((ch, i) => {
    const rows = DIGITS[ch];
    if (!rows) return;
    // A pixel of the tag's ink under each stroke lifts the number off it.
    for (const [dy, fill] of [[1, T[0]], [0, col]]) {
      if (dy && status === 'ahead') continue;
      c.fillStyle = fill;
      rows.forEach((r, y) => { for (let x = 0; x < r.length; x++) if (r[x] === 'w' && 2 + y + dy < h - 1) c.fillRect(3 + i * 4 + x, 2 + y + dy, 1, 1); });
    }
  });
}

/** The ink a stone's icon is rimmed with: the stone's own, not black. */
export const stoneInk = (land, status) => (status === 'passed' ? '#6a4310' : (ROCK[land] || ROCK.hot)[0]);

/** A stepping stone, centred on (x, y): a top face 19 by 11, lit from the
    upper left, three rows of side under it and its shadow thrown down-right
    in the land's own shadow colour. */
export function stoneArt(c, x, y, status, land = 'hot') {
  const dim = status === 'ahead';
  let K = ROCK[land] || ROCK.hot;
  // Not reached yet: the same rock, sunk a tone and let towards the ground.
  if (dim) K = [K[0], mix(K[0], K[1], 0.6), mix(K[1], K[2], 0.45), mix(K[2], K[3], 0.25), K[3]];
  const cast = SHADE[land] || SHADE.hot;
  ellipse(c, x + 3, y + 6, 10, 4, hexA(cast[0], cast[1]));
  ellipse(c, x + 2, y + 5, 10, 5, hexA(cast[0], cast[1] * 0.8));
  // The side, then the face on top of it: the outline is the rock's ink,
  // dropping to its shade along the lit top edge.
  ellipse(c, x, y + 3, 10, 6, K[0]);
  ellipse(c, x, y + 3, 9, 5, K[1]);
  c.fillStyle = mix(K[1], K[0], 0.45); c.fillRect(x + 3, y + 6, 6, 2); c.fillRect(x + 1, y + 8, 5, 1);
  c.fillStyle = mix(K[1], K[2], 0.5); c.fillRect(x - 9, y + 4, 3, 2); c.fillRect(x - 7, y + 6, 3, 1);
  ellipse(c, x, y, 10, 6, K[1]);
  c.fillStyle = K[0]; c.fillRect(x + 5, y + 5, 5, 1); c.fillRect(x + 8, y + 3, 2, 2); c.fillRect(x - 4, y + 6, 9, 1);
  ellipse(c, x, y, 9, 5, K[2]);
  // Light on the upper left of the face, a glint on its rim, wear lower right.
  c.fillStyle = K[3];
  c.fillRect(x - 6, y - 4, 9, 1); c.fillRect(x - 8, y - 3, 7, 1); c.fillRect(x - 9, y - 2, 4, 1); c.fillRect(x - 9, y - 1, 2, 2);
  c.fillStyle = K[4]; c.fillRect(x - 5, y - 5, 5, 1); c.fillRect(x - 7, y - 4, 2, 1);
  c.fillStyle = mix(K[2], K[1], 0.6);
  c.fillRect(x + 2, y + 4, 5, 1); c.fillRect(x + 6, y + 2, 3, 1); c.fillRect(x + 7, y + 1, 2, 1); c.fillRect(x + 5, y + 3, 3, 1);
}

/** The ring that marks the next stone: two tones of gold round the whole
    stone, light on its upper left, with a glow breaking up outside it. The
    canvas carries where the stone's middle is (ax, ay). */
export function ringArt(big, read) {
  const W = 37, H = 29, cx = 18, cy = 13.5;
  const c = makeCanvas(W, H), x = ctx2d(c);
  const rx = big ? 14 : 13, ry = big ? 10 : 9;
  const inside = (px, py, a, b) => ((px - cx) / a) * ((px - cx) / a) + ((py - cy) / b) * ((py - cy) / b) <= 1;
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      if (inside(px, py, rx - 2, ry - 2)) continue;
      if (inside(px, py, rx, ry)) {
        const d = (px - cx) / rx + (py - cy) / ry;
        // The stone being read wears the same ring in white: gold is for the next one.
        x.fillStyle = read ? (d < -0.55 ? '#ffffff' : d > 0.6 ? '#93a0bc' : '#e6ecf6') : d < -0.55 ? '#fff2b8' : d > 0.6 ? '#c08a1c' : '#f2c14e';
        x.fillRect(px, py, 1, 1);
      } else if (inside(px, py, rx + 4, ry + 4)) {
        const far = inside(px, py, rx + 2, ry + 2) ? 0.62 : 0.3;
        if (!read && bayer(px, py) < far) { x.fillStyle = 'rgba(255,214,110,0.5)'; x.fillRect(px, py, 1, 1); }
      }
    }
  }
  c.ax = cx; c.ay = 12;
  return c;
}
