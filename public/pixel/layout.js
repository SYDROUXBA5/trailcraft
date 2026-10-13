/* Where everything on the trail board is: the stones, the path between
   them, the lands and their bosses, and the tiles the picture is cut into.
   Geometry only; nothing here draws. */

import { clamp, R } from './core.js';
import { ANCHOR, REACH, TEAM } from './states.js';
import { LAND_ORDER } from './lands.js';

/* The boss that closes each stage: the stile where the field meets the wood,
   the footbridge at the fork, the gate of the foresters' hamlet, and the
   great tree at the heart of the ancient wood. */
const BOSS_KINDS = ['stile', 'bridge', 'hamlet', 'heart'];

/* The field ends, and the wood's edge begins, half way between these two
   stones. No boss stands there: the trees just start. */
const EDGE_AFTER = 10;

/* The trail is a curve through the stones, 40 points to each stretch. */
const PATH_N = 40;

/**
 * Lay the board out: the first level at the bottom, climbing upward on a
 * winding trail. levels: [{ level, stage, boss }]. W in art pixels.
 * opts: { spacing, top, bottom, heart }. With `heart` the trail ends at the
 * last stone, in the glade at the heart of the wood (`heart`); otherwise it
 * runs on off the top.
 *
 * Besides the stones and the path it says where each boss stands
 * (`bosses`, bottom to top, each { level, x, y, lock, kind }: y is the line
 * the land changes on), which land a row is in (`landAt`), how deep a row is
 * (`levelAt`: the level it belongs to, with its fraction) and how far a point
 * is from the trail (`pathDist`).
 */
export function boardLayout(W, levels, opts = {}) {
  /* 52 rows from stone to stone: a handler stands 34 tall, and at the old 40
     its head was in the next stone's plate. */
  const spacing = opts.spacing || 52, top = opts.top || 70, bottom = opts.bottom || 50;
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
  /* The trail runs nearly straight across the field and winds more the
     deeper it goes; in the old woods it also wanders off its own swing. */
  const swing = (i) => {
    const wide = clamp(0.16 + i * 0.07, 0.16, 1), deep = clamp((i - 44) / 30, 0, 1);
    return clamp(wide * Math.sin(i * 0.95 + 0.4) + deep * 0.2 * Math.sin(i * 2.3 + 1.1), -1.04, 1.04);
  };
  const stones = levels.map((lv, i) => ({
    ...lv,
    x: lv.boss ? cx : R(cx + amp * swing(i)),
    y: H - bottom - i * spacing - lifts[i],
  }));
  const last = stones[stones.length - 1];
  const ctrl = [[stones[0].x - 6, H + 6]].concat(stones.map(s => [s.x, s.y]), opts.heart ? [] : [[cx, -8]]);
  const path = [];
  for (let i = 0; i < ctrl.length - 1; i++) {
    const p0 = ctrl[Math.max(0, i - 1)], p1 = ctrl[i], p2 = ctrl[i + 1], p3 = ctrl[Math.min(ctrl.length - 1, i + 2)];
    for (let k = 0; k < PATH_N; k++) {
      const u = k / PATH_N, u2 = u * u, u3 = u2 * u;
      const f = (a, b, cc, d) => 0.5 * ((2 * b) + (-a + cc) * u + (2 * a - 5 * b + 4 * cc - d) * u2 + (-a + 3 * b - 3 * cc + d) * u3);
      path.push({ x: f(p0[0], p1[0], p2[0], p3[0]), y: f(p0[1], p1[1], p2[1], p3[1]), seg: i - 1 + u });
    }
  }
  if (opts.heart) path.push({ x: last.x, y: last.y, seg: stones.length - 1 });

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
  /* Asked for every tree that is tried and every pixel of every track, so
     it is squares compared and one root at the end (Math.hypot each time
     was a good part of what a board cost to open). */
  const pathDist = (x, y) => {
    let best = 1e18;
    y = R(y);
    for (let yy = Math.max(0, y - 14), y1 = Math.min(H, y + 14); yy <= y1; yy += 2) {
      const px = xAt[yy];
      if (px !== px) continue;
      const dx = px - x, dy = yy - y, d = dx * dx + dy * dy;
      if (d < best) best = d;
    }
    return best === 1e18 ? 1e9 : Math.sqrt(best);
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
  /* The rows above boss k's line are the next land, up to the last one. The
     first stage holds two: the field, then the wood's edge. */
  const edgeY = stones[EDGE_AFTER] ? R((stones[EDGE_AFTER - 1].y + stones[EDGE_AFTER].y) / 2) : -1e9;
  const landAt = (y) => {
    let k = 0;
    while (k < bosses.length && k < LAND_ORDER.length - 2 && y < bosses[k].y) k++;
    return k ? LAND_ORDER[k + 1] : y > edgeY ? 'field' : 'edge';
  };
  /* How deep each row is: 1 at the foot, the last level at the top, and the
     fraction of the way from one stone to the next between them. */
  const depth = new Float32Array(H + 1);
  for (let yy = H, i = 0; yy >= 0; yy--) {
    while (i < stones.length - 1 && stones[i + 1].y >= yy) i++;
    const s = stones[i], n = stones[i + 1];
    depth[yy] = yy >= s.y || !n ? s.level : s.level + clamp((s.y - yy) / Math.max(1, s.y - n.y), 0, 1);
  }
  const levelAt = (y) => depth[clamp(R(y), 0, H)];
  /* The glade at the heart of the wood, round the last stone: open ground
     under the moon, wide enough for the team to stand in facing either way. */
  const heart = opts.heart ? { x: last.x, y: last.y - 8, rx: R(W * 0.46), ry: 42 } : null;

  const layout = { W, H, stones, path, xAt, pathDist, bosses, landAt, levelAt, edgeY, heart, spacing, bottom,
    hedgeY: bosses.length ? bosses[0].y : -100 };
  // Where the team stands at each stone (facing the next one): scenery keeps out.
  // The team faces the next stone, unless the board's edge is in the way:
  // its art runs REACH.nose pixels ahead of the handler's feet.
  const fits = (s, left) => (left ? s.x - REACH.nose >= 0 : s.x + REACH.nose <= W);
  layout.faceLeft = stones.map((s, i) => {
    let left = stones[i + 1] ? stones[i + 1].x < s.x : false;
    if (!fits(s, left) && fits(s, !left)) left = !left;
    return left;
  });
  layout.clear = stones.map((s, i) => teamRect(s, layout.faceLeft[i]));
  /* The great tree stands beside the last stone, on the side the team has
     its back to, so the two of them share the glade. */
  if (heart) { heart.tx = clamp(last.x + (layout.faceLeft[stones.length - 1] ? 38 : -38), 30, W - 30); heart.ty = last.y - 14; }
  /* The trailhead, where a team that has passed nothing waits (board.js). */
  { const pt = trailPoint(layout, 0, -0.62); layout.clear.push(teamRect({ x: pt[0], y: pt[1] }, layout.faceLeft[0])); }
  /* And just through each gate, where a team that has beaten the boss waits. */
  for (const b of bosses) {
    if (b.level >= stones.length) continue;
    const pt = trailPoint(layout, b.level - 1, throughGate(b.kind));
    layout.clear.push(teamRect({ x: pt[0], y: pt[1] }, layout.faceLeft[b.level - 1]));
  }
  /* What lies across the trail, half way between two stones: brooks, the
     forestry track of the "Surfaces" wave, and the lane through the ancient
     wood in the wave that works beside traffic. Each is
     { kind, y, x (the trail there), land, level }. */
  layout.crossings = [];
  for (const [level, kind] of CROSSINGS) {
    const s = stones[level - 1], n = stones[level];
    if (!s || !n || s.boss || n.boss) continue;
    const y = R((s.y + n.y) / 2), land = landAt(y);
    if (landAt(y - 24) !== land || landAt(y + 24) !== land) continue;
    const x = xAt[y];
    layout.crossings.push({ kind, y, x: R(x === x ? x : s.x), land, level });
  }
  const lane = layout.crossings.find(cr => cr.kind === 'lane');
  layout.roadY = lane ? lane.y : null;
  /* Running water, each a band across the board: the stream under the
     footbridge and the brooks. { y, half, land, kind, seed }. */
  layout.waters = bosses.filter(b => b.kind === 'bridge').map(b => ({ y: b.y - 7, half: 5, land: 'forest', kind: 'stream', seed: 1, x: gateX(layout, b) }))
    .concat(layout.crossings.filter(cr => cr.kind === 'brook').map(cr => ({ y: cr.y, half: 4, land: cr.land, kind: 'brook', seed: cr.level, x: cr.x })));
  /* The car park where the forestry road becomes the lane: a gravel bay
     beside the trail, on whichever side has the room. */
  {
    const s = stones[PARK_AFTER - 1], n = stones[PARK_AFTER];
    layout.park = null;
    if (s && n && !s.boss && !n.boss) {
      const y = R((s.y + n.y) / 2), tx = xAt[y], side = tx > W / 2 ? -1 : 1;
      layout.park = { x: R(tx + side * 31), y, side, rx: 23, ry: 15, level: PARK_AFTER };
    }
  }
  return layout;
}

/* [after this level, what]. */
const CROSSINGS = [
  [13, 'brook'],
  [23, 'brook'], [37, 'brook'], [39, 'track'],
  [57, 'brook'],
  [88, 'lane'],
];
const PARK_AFTER = 70;

/** The middle row of a piece of water at x: it wanders a little. */
export function streamY(w, x) {
  return w.kind === 'stream' ? w.y + R(2 * Math.sin(x / 11 + 1)) : w.y + R(3 * Math.sin(x / 19 + w.seed) + 1.5 * Math.sin(x / 7 + w.seed * 2));
}

/** How far past a boss's stone the team stands once it is through, as a
    share of the way to the next stone. Half-way, on a board laid out with
    `gateRoom`, puts its feet above the top of the stile's arch, the bridge's
    rails and the hamlet's gate, and still a body's height short of the next
    stone. (0.35 of an ordinary step left it behind the arch from the chest
    down, which is the picture a team keeps until its next pass.) */
export const throughGate = () => 0.5;

/** The box the team's pixels fill when it stands on stone s. */
export function teamRect(s, faceLeft) {
  const a = faceLeft ? TEAM.w - 1 - ANCHOR[0] : ANCHOR[0];
  const left = s.x - a;
  const [b0, b1] = REACH.body;
  const x0 = faceLeft ? left + TEAM.w - b1 : left + b0;
  return [x0, s.y - REACH.tall, x0 + b1 - b0, s.y + 5];
}

/** A point on the trail between stone i and stone i+1 (u 0..1), for the trot.
    i is the stone's index (its level less one); -1 is the lead-in to stone 1. */
export function trailPoint(layout, i, u) {
  const p = layout.path[clamp(R((i + u + 1) * PATH_N), 0, layout.path.length - 1)];
  return [R(p.x), R(p.y)];
}

/* The path's points that fall in a band of rows (the trail only climbs). */
export function pathRange(layout, y0, y1) {
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

/** Where a boss's gateway is, across the board: on its stone, or, for the
    footbridge, where the trail meets the stream. */
export function gateX(layout, b) {
  if (b.kind !== 'bridge') return b.x;
  const x = layout.xAt[clamp(b.y - 7, 0, layout.H)];
  return R(x === x ? x : b.x);
}
