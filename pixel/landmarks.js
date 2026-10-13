/* The bosses' landmarks, one where each stage ends: the stile in the hedge
   where the field meets the wood, the footbridge over the stream at the
   fork, the gate of the foresters' hamlet, and the banner on the great tree
   at the heart of the ancient wood. */

import { bayer, disc, hash, mix, R, STAGES, stamp, thick } from './core.js';
import { castOf } from './lands.js';
import { gateX } from './layout.js';
import { GREAT, house } from './scenery.js';
import { RAMPS } from './ramps.js';

/* Everything here is outlined in the ink of what it is made of: timber's
   own dark brown, the wall's own dark stone. One near-black line round all
   of it is what made the gates look stuck on to the land. */
const OUTLINE = '#33200f';
const LEAF = '#1c3a22';

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
  c.fillStyle = castOf('edge');
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

/* The footbridge that closes the forest: a gate at its near end, the Warm
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

/* The foresters' hamlet that closes the old forest: a dry-stone wall
   across the board, a cottage behind it each side of the lane, two stone
   gateposts with a field gate between them and a lantern on one, lit once
   the way is open. */
const WALL = ['#1a2024', '#3c4648', '#66726e', '#94a098', '#c8d0c0'];

function hamletArt(c, layout, b, gate, passed) {
  const { W } = layout;
  const cx = b.x, g = b.y + 3, K = WALL;
  /* The cottages first: the wall crosses their feet. As wide as the board
     leaves room for, each side of the lane. */
  const w = Math.max(30, Math.min(44, cx - 22));
  house(c, cx - 19 - (w >> 1), g - 6, w, 17, 31);
  house(c, cx + 20 + (w >> 1), g - 6, w, 17, 12);
  // The wall: courses of field stone, a coping along its top, moss on it.
  const gap = (x) => x > cx - 13 && x < cx + 13;
  c.fillStyle = castOf('old');
  for (let x = 0; x < W; x++) { if (gap(x - 2)) continue; c.fillRect(x, g + 1, 1, 2); if (bayer(x, g + 3) < 0.5) c.fillRect(x, g + 3, 1, 1); }
  for (let x = 0; x < W; x++) {
    if (gap(x)) continue;
    c.fillStyle = K[0]; c.fillRect(x, g - 9, 1, 10);
    for (let j = 0; j < 8; j++) {
      const row = j >> 1, off = (row & 1) * 3, joint = (x + off) % 6 === 5 || j % 2 === 1 && hash(x * 7 + row) > 0.86;
      const k = hash(Math.floor((x + off) / 6) * 31 + row * 7);
      c.fillStyle = joint ? K[1] : j === 0 ? K[3] : k < 0.3 ? K[3] : k > 0.8 ? K[1] : K[2];
      c.fillRect(x, g - 8 + j, 1, 1);
    }
    if (hash(x * 13 + 5) > 0.82) { c.fillStyle = '#62a848'; c.fillRect(x, g - 9, 2, 1); }
    else if (x % 4 < 3) { c.fillStyle = K[4]; c.fillRect(x, g - 9, 1, 1); }
  }
  mirrored(c, layout, b, () => {
    banner(c, cx - 21, g, STAGES.cold.colour, STAGES.cold.light, passed);
    // Two gateposts of dressed stone, capped.
    const pillar = (x) => {
      c.fillStyle = castOf('old'); c.fillRect(x + 4, g, 5, 1); c.fillRect(x + 6, g + 1, 4, 1);
      c.fillStyle = K[0]; c.fillRect(x - 1, g - 21, 7, 22); c.fillRect(x - 2, g - 23, 9, 3);
      c.fillStyle = K[2]; c.fillRect(x, g - 20, 5, 20);
      c.fillStyle = K[3]; c.fillRect(x, g - 20, 2, 20); c.fillRect(x - 1, g - 22, 7, 1);
      c.fillStyle = K[4]; c.fillRect(x, g - 20, 1, 19); c.fillRect(x - 1, g - 22, 4, 1);
      c.fillStyle = K[1]; c.fillRect(x + 4, g - 19, 1, 19); for (let j = 4; j < 20; j += 5) c.fillRect(x, g - j, 4, 1);
    };
    const hinge = cx - 13;
    pillar(hinge); pillar(cx + 9);
    gateLeaf(c, hinge + 2, g - 17, 15, 17, [3, 7, 11, 15], gate);
    // The lantern on the far gatepost.
    const lx = cx + 10;
    c.fillStyle = '#14181c'; c.fillRect(lx, g - 31, 5, 7); c.fillRect(lx + 1, g - 32, 3, 1); c.fillRect(lx + 2, g - 24, 1, 2);
    c.fillStyle = passed ? '#ffd36a' : '#5a4a2a'; c.fillRect(lx + 1, g - 30, 3, 5);
    if (passed) {
      c.fillStyle = '#fff4c2'; c.fillRect(lx + 2, g - 29, 1, 3);
      for (let dy = -7; dy <= 7; dy++) for (let dx = -8; dx <= 8; dx++) {
        const d = Math.hypot(dx, dy);
        if (d > 3.4 && d <= 8 && bayer(lx + 2 + dx, g - 28 + dy) < (8.4 - d) * 0.12) { c.fillStyle = 'rgba(255,214,120,0.55)'; c.fillRect(lx + 2 + dx, g - 28 + dy, 1, 1); }
      }
    }
  });
}

/* The heart of the wood has no gate: the last boss's banner hangs on the
   great tree (scenery.js paints the tree itself, in the board's tiles).
   Cold's blue until the last boss is beaten, gold after. */
function heartArt(c, layout, b, passed) {
  const ht = layout.heart;
  if (!ht) return;
  banner(c, ht.tx + GREAT.hw + 3, ht.ty + 3, STAGES.cold.colour, STAGES.cold.light, passed);
}

/**
 * Draw boss k's landmark (k counts from the bottom: the stile, the
 * footbridge, the hamlet's gate, the great tree's banner). gate: 0 shut … 1 open.
 */
export function drawBarrier(c, layout, k, gate, passed) {
  const b = layout.bosses[k];
  if (!b) return;
  if (b.kind === 'stile') hedgeArt(c, layout, b, gate, passed);
  else if (b.kind === 'bridge') bridgeArt(c, layout, b, gate, passed);
  else if (b.kind === 'hamlet') hamletArt(c, layout, b, gate, passed);
  else heartArt(c, layout, b, passed);
}

/** The rows boss k's landmark covers. */
export function barrierBand(layout, k) {
  const b = layout.bosses[k];
  if (!b) return [0, 0];
  return [Math.max(0, b.y - (b.kind === 'hamlet' || b.kind === 'heart' ? 62 : 40)), b.y + 8];
}

/** The hedgerow that closes the Hot stage, drawn on its own so the page can
    put it over the team. */
export function drawHedge(c, layout, gate, passed) { drawBarrier(c, layout, 0, gate, passed); }

/** The rows the hedge layer covers. */
export function hedgeBand(layout) { return [layout.hedgeY - 40, layout.hedgeY + 8]; }
