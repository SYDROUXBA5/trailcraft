/* The bosses' landmarks, one where each land ends: the stile in the hedge,
   the footbridge over the stream, the gate in the town wall and the cairn
   on the summit. */

import { bayer, disc, hash, mix, R, STAGES, stamp, thick } from './core.js';
import { gateX } from './layout.js';
import { BOARD_LANDS } from './scenery.js';
import { CAST, RAMPS } from './ramps.js';

/* Everything here is outlined in the ink of what it is made of: timber's
   own dark brown, the wall's own dark blue. One near-black line round all
   of it is what made the gates look stuck on to the land. */
const OUTLINE = '#33200f';
const LEAF = '#1c3a22';
const castOf = (key) => {
  const [hex, a] = CAST[key], n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

export const WOOD = { wood: '#8a5a32', hi: '#b07a46', lo: '#5e3a1e' };

/* A post three wide: lit down its left, shaded down its right, its foot's
   shadow on the grass. */
function post(c, x, ground, h) {
  c.fillStyle = 'rgba(28,30,40,0.3)'; c.fillRect(x + 2, ground, 5, 1); c.fillRect(x + 4, ground + 1, 4, 1);
  c.fillStyle = OUTLINE; c.fillRect(x - 1, ground - h - 1, 5, h + 2);
  c.fillStyle = WOOD.wood; c.fillRect(x, ground - h, 3, h + 1);
  c.fillStyle = WOOD.hi; c.fillRect(x, ground - h, 1, h);
  c.fillStyle = WOOD.lo; c.fillRect(x + 2, ground - h + 1, 1, h);
}

/** A gate leaf hung on the post at x, swinging away from us: it turns
    edge-on as it opens, so the rails shorten and the free end rises a
    little (it is further off). The diagonal brace shows at every angle. */
function gateLeaf(c, x, top, gw, h, rails, open) {
  const a = Math.min(open, 1.2) * 62 * Math.PI / 180;
  const w = Math.max(3, R(gw * Math.cos(a)));
  const dy = -R(Math.sin(a) * 2);
  const shade = open > 0.2 ? mix(WOOD.wood, '#3a2414', 0.25) : WOOD.wood;
  const x0 = x + 3, x1 = x0 + w - 1;
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
  const h = 24, gw = 18, hinge = cx - 11;
  // The banner on its pole, left of the gate: hot red, gold once passed.
  const fx = cx - 19;
  banner(c, fx, ground, STAGES.hot.colour, STAGES.hot.light, passed);
  // The stile: a three-rail fence with a step either side.
  const sx0 = cx + 16, sx1 = cx + 31;
  post(c, sx0, ground, 13); post(c, sx1, ground, 13);
  for (const ry of [3, 7, 11]) {
    c.fillStyle = OUTLINE; c.fillRect(sx0 + 3, ground - 13 + ry - 1, sx1 - sx0 - 3, 3);
    c.fillStyle = WOOD.wood; c.fillRect(sx0 + 3, ground - 13 + ry, sx1 - sx0 - 3, 1);
    c.fillStyle = WOOD.hi; c.fillRect(sx0 + 3, ground - 13 + ry, 4, 1);
  }
  const plank = (x, y, w) => {
    c.fillStyle = OUTLINE; c.fillRect(x - 1, y - 1, w + 2, 4); c.fillRect(x + 1, y + 2, 3, ground - y - 1);
    c.fillStyle = WOOD.hi; c.fillRect(x, y, w, 1);
    c.fillStyle = WOOD.wood; c.fillRect(x, y + 1, w, 1); c.fillRect(x + 2, y + 2, 1, ground - y - 2);
  };
  plank(sx0 + 4, ground - 5, 5); plank(sx0 + 9, ground - 9, 5);
  // The gate: two tall posts with caps, the leaf between.
  post(c, hinge, ground, h); post(c, hinge + gw + 3, ground, h);
  c.fillStyle = OUTLINE; c.fillRect(hinge - 2, ground - h - 3, 7, 3); c.fillRect(hinge + gw + 1, ground - h - 3, 7, 3);
  c.fillStyle = WOOD.hi; c.fillRect(hinge - 1, ground - h - 2, 5, 1); c.fillRect(hinge + gw + 2, ground - h - 2, 5, 1);
  gateLeaf(c, hinge, ground - h, gw, h, [4, 8, 12, 16, 20], open);
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
  const col = passed ? '#f2c14e' : colour, hi = passed ? '#fff0b0' : light, lo = mix(col, '#2a1420', 0.38), top = ground - 38;
  c.fillStyle = 'rgba(28,30,40,0.3)'; c.fillRect(fx + 1, ground, 5, 1);
  c.fillStyle = OUTLINE; c.fillRect(fx - 1, top - 1, 4, 40); c.fillRect(fx - 1, top - 3, 4, 2);
  c.fillStyle = '#b89a6a'; c.fillRect(fx, top, 2, 38);
  c.fillStyle = '#e8d6ac'; c.fillRect(fx, top, 1, 38);
  c.fillStyle = '#f2c14e'; c.fillRect(fx, top - 2, 2, 2);
  // The cloth: a fold of shade down it, a swallow tail at its free end.
  c.fillStyle = mix(col, '#1a0c14', 0.62); c.fillRect(fx - 16, top, 16, 13);
  c.fillStyle = col; c.fillRect(fx - 15, top + 1, 15, 11);
  c.fillStyle = hi; c.fillRect(fx - 15, top + 1, 15, 1); c.fillRect(fx - 4, top + 2, 2, 9);
  c.fillStyle = lo; c.fillRect(fx - 15, top + 10, 15, 2); c.fillRect(fx - 7, top + 2, 2, 9);
  c.clearRect(fx - 16, top + 5, 2, 3); c.clearRect(fx - 14, top + 6, 1, 1);
  stamp(c, ['.w.w.', 'w...w', '.www.', '.www.'], fx - 13, top + 4, { w: passed ? '#7a4a10' : '#ffe4bd' }, 'rgba(0,0,0,0)');
}

/* The hedgerow that closes the Hot stage: two rows deep, with an arch over
   the gate, the stile and the boss banner. */
function hedgeArt(c, layout, b, gate, passed) {
  const { W } = layout;
  const cx = b.x, hedgeY = b.y, g = hedgeY + 3;
  const gap = (x) => x > cx - 27 && x < cx + 36;
  const bumps = [];
  for (let x = -3; x < W + 4; x += 3) {
    if (gap(x)) continue;
    bumps.push([x, hedgeY - 8 + R(hash(x * 5) * 2), 4 + (hash(x + 3) > 0.5 ? 1 : 0)]);
    bumps.push([x + 1, hedgeY - 2 + R(hash(x * 7) * 2), 4 + (hash(x) > 0.6 ? 1 : 0)]);
  }
  // The arch over the gate.
  for (let k = 0; k <= 8; k++) {
    const a = Math.PI * k / 8;
    bumps.push([R(cx + 1 - Math.cos(a) * 16), R(g - 30 - Math.sin(a) * 7), k % 2 ? 3 : 4]);
  }
  // The hedge's shadow lies on the field in front of it.
  c.fillStyle = castOf('meadow');
  for (let x = 0; x < W; x++) { if (gap(x - 2)) continue; c.fillRect(x, hedgeY + 3, 1, 3); if (bayer(x, hedgeY + 6) < 0.5) c.fillRect(x, hedgeY + 6, 1, 1); }
  const F = RAMPS.meadow.foliage;
  for (const [x, y, r] of bumps) disc(c, x, y + 1, r + 1, LEAF);
  for (const [x, y, r] of bumps) disc(c, x, y, r, F[1]);
  for (const [x, y, r] of bumps) disc(c, x - 1, y - 1, r - 1, F[2]);
  for (const [x, y, r] of bumps) {
    if (hash(x * 11 + y) > 0.35) { c.fillStyle = F[3]; c.fillRect(x - 2, y - r + 1, 3, 1); c.fillRect(x - 3, y - r + 2, 2, 1); }
    if (hash(x * 3 + y) > 0.72) { c.fillStyle = F[4]; c.fillRect(x - 1, y - r + 1, 2, 1); }
    if (hash(x * 3 + y) > 0.6) { c.fillStyle = '#f4efdc'; c.fillRect(x + 1, y - 1, 2, 1); c.fillRect(x + 1, y - 2, 1, 1); }
    else if (hash(x * 5 + y) > 0.8) { c.fillStyle = '#c8302a'; c.fillRect(x - 1, y + 1, 2, 1); }
  }
  // Ivy down the arch's legs to the gate posts.
  c.fillStyle = RAMPS.meadow.foliage[2];
  for (let y = g - 30; y < g - 14; y += 2) { c.fillRect(cx - 14, y, 2, 1); c.fillRect(cx + 15, y + 1, 2, 1); }
  mirrored(c, layout, b, () => bossGate(c, cx, g, gate, passed));
}

/* The footbridge that closes the wood: a gate at its near end, the Warm
   banner beside it. The deck and the stream are part of the ground. */
function bridgeArt(c, layout, b, gate, passed) {
  const g = b.y + 3, bx = gateX(layout, b);
  mirrored(c, layout, { ...b, x: bx }, () => {
    banner(c, bx - 19, g, STAGES.warm.colour, STAGES.warm.light, passed);
    const h = 22, gw = 18, hinge = bx - 11;
    post(c, hinge, g, h); post(c, hinge + gw + 4, g, h);
    c.fillStyle = OUTLINE; c.fillRect(hinge - 2, g - h - 3, 7, 3); c.fillRect(hinge + gw + 2, g - h - 3, 7, 3);
    c.fillStyle = WOOD.hi; c.fillRect(hinge - 1, g - h - 2, 5, 1); c.fillRect(hinge + gw + 3, g - h - 2, 5, 1);
    gateLeaf(c, hinge, g - h, gw, h, [4, 8, 12, 16], gate);
    // A lantern on the far post: lit once the way is open, its light on
    // the post and the planks under it.
    const lx = hinge + gw + 3;
    c.fillStyle = OUTLINE; c.fillRect(lx, g - h - 10, 5, 7); c.fillRect(lx + 1, g - h - 11, 3, 1);
    c.fillStyle = passed ? '#ffd36a' : '#6a4a22'; c.fillRect(lx + 1, g - h - 9, 3, 5);
    if (passed) {
      c.fillStyle = '#fff4c2'; c.fillRect(lx + 2, g - h - 8, 1, 3);
      for (let dy = -7; dy <= 7; dy++) for (let dx = -8; dx <= 8; dx++) {
        const d = Math.hypot(dx, dy);
        if (d > 3.4 && d <= 8 && bayer(lx + 2 + dx, g - h - 7 + dy) < (8.4 - d) * 0.12) { c.fillStyle = 'rgba(255,214,120,0.55)'; c.fillRect(lx + 2 + dx, g - h - 7 + dy, 1, 1); }
      }
    }
  });
}

/* The town wall that closes the town: battlements across the board, an
   arched gate, and a clock tower beside it. */
function wallArt(c, layout, b, gate, passed) {
  const { W } = layout;
  const T = RAMPS.town, K = T.stone;
  const OUTLINE = K[0];
  const cx = b.x, g = b.y + 3, wh = 21;
  const stone = K[2], hi = K[3], lo = K[1], joint = mix(K[1], K[2], 0.45);
  const arch = (x) => x >= cx - 14 && x <= cx + 14;
  // Its shadow on the street side, then the wall: courses of stone, each
  // lit along its top, a walk along the wall's head and merlons on it.
  c.fillStyle = castOf('town');
  for (let x = 0; x < W; x++) { c.fillRect(x, g + 1, 1, 4); if (bayer(x, g + 5) < 0.5) c.fillRect(x, g + 5, 1, 1); }
  c.fillStyle = OUTLINE; c.fillRect(-1, g - wh - 1, W + 2, wh + 2);
  c.fillStyle = stone; c.fillRect(0, g - wh, W, wh);
  c.fillStyle = lo; c.fillRect(0, g - 3, W, 3);
  for (let j = 0; j < wh - 3; j += 5) {
    const y = g - wh + j, off = (j / 5) % 2 ? 5 : 0;
    c.fillStyle = hi; c.fillRect(0, y, W, 1);
    c.fillStyle = joint; c.fillRect(0, y + 4, W, 1);
    for (let x = off - 2; x < W; x += 10) {
      c.fillStyle = joint; c.fillRect(x, y + 1, 1, 3);
      if (hash(x * 7 + j) > 0.7) { c.fillStyle = lo; c.fillRect(x + 2, y + 2, 5, 2); }
      else if (hash(x * 3 + j) > 0.8) { c.fillStyle = K[4]; c.fillRect(x + 1, y, 4, 1); }
    }
  }
  for (let x = 1; x < W; x += 9) {
    if (arch(x) || arch(x + 5)) continue;
    c.fillStyle = OUTLINE; c.fillRect(x - 1, g - wh - 7, 7, 7);
    c.fillStyle = stone; c.fillRect(x, g - wh - 6, 5, 6);
    c.fillStyle = hi; c.fillRect(x, g - wh - 6, 5, 1); c.fillRect(x, g - wh - 6, 1, 6);
    c.fillStyle = lo; c.fillRect(x + 4, g - wh - 5, 1, 5);
  }
  // The gatehouse: the wall stands a little taller over the arch, with a
  // dressed stone ring round a dark way through.
  c.fillStyle = OUTLINE; c.fillRect(cx - 16, g - wh - 6, 33, wh + 7);
  c.fillStyle = stone; c.fillRect(cx - 15, g - wh - 5, 31, wh + 5);
  c.fillStyle = hi; c.fillRect(cx - 15, g - wh - 5, 31, 1); c.fillRect(cx - 15, g - wh - 5, 1, wh + 4);
  c.fillStyle = lo; c.fillRect(cx + 14, g - wh - 4, 2, wh + 4);
  c.fillStyle = K[4]; c.fillRect(cx - 13, g - 19, 27, 1); c.fillRect(cx - 13, g - 19, 2, 19); c.fillRect(cx + 12, g - 19, 2, 19);
  c.fillStyle = OUTLINE; c.fillRect(cx - 11, g - 16, 23, 17); c.fillRect(cx - 9, g - 18, 19, 2);
  c.fillStyle = passed || gate > 0.5 ? BOARD_LANDS.alp.g : '#0c1228'; c.fillRect(cx - 10, g - 15, 21, 16); c.fillRect(cx - 8, g - 17, 17, 2);
  if (passed || gate > 0.5) { c.fillStyle = RAMPS.climb.track[2]; c.fillRect(cx - 4, g - 15, 9, 16); c.fillStyle = RAMPS.climb.rock[1]; c.fillRect(cx - 10, g - 15, 21, 2); }
  // Torches either side of it, each with its light on the stone.
  for (const tx of [cx - 20, cx + 20]) {
    for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
      const d = Math.hypot(dx, dy);
      if (d <= 6 && bayer(tx + dx, g - 13 + dy) < (6.6 - d) * 0.16) { c.fillStyle = 'rgba(255,214,120,0.5)'; c.fillRect(tx + dx, g - 13 + dy, 1, 1); }
    }
    c.fillStyle = OUTLINE; c.fillRect(tx - 1, g - 12, 3, 8);
    c.fillStyle = '#7a4a22'; c.fillRect(tx, g - 11, 1, 6);
    c.fillStyle = T.lamp[2]; c.fillRect(tx - 1, g - 15, 3, 3);
    c.fillStyle = T.lamp[4]; c.fillRect(tx, g - 16, 1, 3);
  }
  mirrored(c, layout, b, () => {
    // The clock tower, tall enough to be seen from the street below: the
    // moon down its left side, its face lit from inside.
    const tx = cx + 22, tw = 19, th = 45;
    c.fillStyle = castOf('town'); for (let k = 0; k < 12; k++) c.fillRect(tx + tw, g - k, 12 - k, 1);
    c.fillStyle = OUTLINE; c.fillRect(tx - 1, g - th - 1, tw + 2, th + 2);
    c.fillStyle = stone; c.fillRect(tx, g - th, tw, th);
    c.fillStyle = hi; c.fillRect(tx, g - th, 3, th);
    c.fillStyle = K[4]; c.fillRect(tx, g - th, 1, th);
    c.fillStyle = lo; c.fillRect(tx + tw - 4, g - th, 4, th);
    for (let j = 7; j < th - 2; j += 5) {
      c.fillStyle = joint; c.fillRect(tx + 3, g - th + j, tw - 7, 1);
      c.fillStyle = joint; c.fillRect(tx + 5 + ((j / 5) & 1) * 5, g - th + j + 1, 1, 4);
    }
    c.fillStyle = OUTLINE; c.fillRect(tx - 2, g - th - 2, tw + 4, 3);
    c.fillStyle = hi; c.fillRect(tx - 1, g - th - 1, tw + 2, 1);
    // A pointed roof, its left slope in the moon.
    const R0 = T.roof, mid = tx + 9;
    for (let j = 0; j < 12; j++) {
      const half = R((j + 1) * 0.95);
      c.fillStyle = R0[0]; c.fillRect(mid - half - 1, g - th - 14 + j, half * 2 + 3, 2);
    }
    for (let j = 0; j < 12; j++) {
      const half = R((j + 1) * 0.95);
      c.fillStyle = R0[3]; c.fillRect(mid - half, g - th - 13 + j, half, 1);
      c.fillStyle = R0[1]; c.fillRect(mid, g - th - 13 + j, half + 1, 1);
      c.fillStyle = R0[4]; c.fillRect(mid - half, g - th - 13 + j, 1, 1);
    }
    c.fillStyle = OUTLINE; c.fillRect(mid, g - th - 19, 1, 6);
    c.fillStyle = passed ? '#f2c14e' : STAGES.cold.colour; c.fillRect(mid + 1, g - th - 19, 5, 3);
    // The clock: a lit face with its glow on the stone round it.
    const cy = g - th + 11;
    for (let dy = -10; dy <= 10; dy++) for (let dx = -9; dx <= 9; dx++) {
      const d = Math.hypot(dx, dy);
      if (d > 6 && d <= 10 && dx + mid >= tx && dx + mid < tx + tw && bayer(mid + dx, cy + dy) < (10.4 - d) * 0.14) { c.fillStyle = 'rgba(255,224,150,0.5)'; c.fillRect(mid + dx, cy + dy, 1, 1); }
    }
    disc(c, mid, cy, 7, OUTLINE);
    disc(c, mid, cy, 6, T.lamp[2]);
    disc(c, mid - 1, cy - 1, 4, T.lamp[3]);
    c.fillStyle = T.lamp[0];
    c.fillRect(mid, cy - 6, 1, 1); c.fillRect(mid, cy + 6, 1, 1); c.fillRect(mid - 6, cy, 1, 1); c.fillRect(mid + 6, cy, 1, 1);
    c.fillStyle = '#1c1430'; c.fillRect(mid, cy - 4, 1, 5); c.fillRect(mid, cy, 4, 1);
    // A lit window under it and a door at its foot.
    c.fillStyle = OUTLINE; c.fillRect(mid - 3, g - th + 23, 7, 10); c.fillRect(mid - 2, g - th + 22, 5, 1);
    c.fillStyle = T.lamp[2]; c.fillRect(mid - 2, g - th + 24, 5, 8);
    c.fillStyle = T.lamp[3]; c.fillRect(mid - 2, g - th + 24, 2, 4);
    c.fillStyle = OUTLINE; c.fillRect(mid, g - th + 24, 1, 8); c.fillRect(mid - 2, g - th + 28, 5, 1);
    c.fillStyle = OUTLINE; c.fillRect(mid - 3, g - 9, 7, 9);
    c.fillStyle = T.trunk[3]; c.fillRect(mid - 2, g - 8, 5, 8);
    c.fillStyle = T.trunk[4]; c.fillRect(mid - 2, g - 8, 1, 8);
    // The gate in the arch: timber, swinging open.
    if (gate < 1.2) {
      c.save();
      c.beginPath(); c.rect(cx - 10, g - 17, 21, 18); c.clip();
      const OUT = '#33200f';
      c.fillStyle = OUT; c.fillRect(cx - 13, g - 17, 3, 18);
      gateLeaf(c, cx - 13, g - 16, 21, 16, [3, 8, 13], gate);
      c.restore();
    }
    // The banner flies from the wall beyond the tower, clear of the gateway.
    banner(c, tx + tw + 20, g - wh + 12, STAGES.cold.colour, STAGES.cold.light, passed);
  });
}

/* The summit cairn: stones piled by everyone who got here, and a flag. */
export const CAIRN = { off: 23, flag: 44 };

function cairnArt(c, layout, b, passed) {
  const K = ['#27304e', '#4c5a80', '#8090b2', '#b8c4dc', '#f0f5fc'];
  const left = layout.faceLeft[b.level - 1];
  const x = b.x + (left ? CAIRN.off : -CAIRN.off), g = b.y + 2;
  const tiers = [23, 21, 18, 15, 12, 9, 7, 4];
  c.fillStyle = castOf('climb');
  for (let k = 0; k < 4; k++) c.fillRect(x - 9 + k * 3, g + k, 26, 1);
  tiers.forEach((w, k) => {
    const y = g - 4 - k * 4, x0 = x - (w >> 1) + (k % 2 ? 1 : 0);
    c.fillStyle = K[0]; c.fillRect(x0 - 1, y - 1, w + 2, 6);
    // Each course is two or three stones, no two the same.
    let px = x0, i = 0;
    while (px < x0 + w) {
      const sw = Math.min(x0 + w - px, 5 + Math.floor(hash(k * 13 + i * 7) * 5));
      c.fillStyle = (k + i) % 2 ? K[2] : mix(K[2], K[3], 0.4); c.fillRect(px, y, sw, 4);
      c.fillStyle = K[3]; c.fillRect(px, y, sw - 1, 1); c.fillRect(px, y, 1, 3);
      c.fillStyle = K[1]; c.fillRect(px + 1, y + 3, sw - 1, 1); c.fillRect(px + sw - 1, y + 1, 1, 3);
      if (px + sw < x0 + w) { c.fillStyle = K[0]; c.fillRect(px + sw, y, 1, 4); }
      px += sw + 1; i++;
    }
  });
  // Snow lying on the ledges, and at its foot.
  c.fillStyle = '#ffffff';
  c.fillRect(x - 2, g - 4 - 7 * 4 - 1, 4, 1); c.fillRect(x - 6, g - 4 - 5 * 4 - 1, 5, 1); c.fillRect(x + 3, g - 4 - 3 * 4 - 1, 5, 1); c.fillRect(x - 11, g - 4 - 4 - 1, 6, 1);
  c.fillRect(x - 14, g, 8, 1); c.fillRect(x + 7, g, 7, 1);
  // The flag: Cold's blue until the last boss is beaten, gold after.
  const top = g - 4 - 7 * 4;
  const col = passed ? '#f2c14e' : STAGES.cold.colour, hi = passed ? '#fff0b0' : STAGES.cold.light;
  c.fillStyle = K[0]; c.fillRect(x - 1, top - 20, 4, 20);
  c.fillStyle = '#b89a6a'; c.fillRect(x, top - 19, 2, 19);
  c.fillStyle = '#e8d6ac'; c.fillRect(x, top - 19, 1, 19);
  c.fillStyle = mix(col, '#0c1030', 0.6); c.fillRect(x + 2, top - 21, 17, 13);
  c.fillStyle = col; c.fillRect(x + 3, top - 20, 15, 11);
  c.fillStyle = hi; c.fillRect(x + 3, top - 20, 15, 1); c.fillRect(x + 8, top - 19, 2, 9);
  c.fillStyle = mix(col, '#0c1030', 0.35); c.fillRect(x + 3, top - 11, 15, 2); c.fillRect(x + 12, top - 19, 2, 9);
  c.clearRect(x + 17, top - 16, 2, 3);
  stamp(c, ['.w.w.', 'w...w', '.www.', '.www.'], x + 6, top - 17, { w: passed ? '#7a4a10' : '#ffffff' }, 'rgba(0,0,0,0)');
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
  return [Math.max(0, b.y - (b.kind === 'wall' || b.kind === 'cairn' ? 62 : 40)), b.y + 8];
}

/** The hedgerow that closes the Hot stage, drawn on its own so the page can
    put it over the team. */
export function drawHedge(c, layout, gate, passed) { drawBarrier(c, layout, 0, gate, passed); }

/** The rows the hedge layer covers. */
export function hedgeBand(layout) { return [layout.hedgeY - 40, layout.hedgeY + 8]; }
