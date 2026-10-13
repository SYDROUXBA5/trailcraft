/* Contamination: what other feet, paws, hooves and wheels have left on the
   ground, and who left it. The further into the wood the trail goes, the
   more of it crosses the trail, and that is the difficulty a mantrailing
   team climbs: nothing in the field, a line of boot prints and a dog's at
   the wood's edge, from one track every other level to more than one a
   level through the forest, two in the old forest, three and more in the
   ancient wood, at every angle.

   Every maker has its own mark and its own tint, so a handler can tell
   boots from paws from deer slots from horseshoes, a bike's tyre from a
   cart's ruts, a herd's way from a footpath. The true trail stays the
   widest, palest, calmest line on the board: every print is darker than
   the trail's own earth, nothing is printed on the trail itself, and worn
   paths stop short of it.

   Tracks are worked out once for a layout by a seeded draw, so the same
   board is always the same. Each is then drawn once, into a list of
   coloured pixels, and a tile only copies the ones on its rows: a track is
   thousands of single pixels, and as canvas calls they were half of what a
   tile cost to paint. */

import { clamp, ctx2d, hash, hexToRgb, makeCanvas, R, seeded, stamp } from './core.js';
import { drawHuman, HUMAN_BOX, humanPose } from './human.js';
import { castOf, LANDS, ROAD, surfaceOf, trailHalf } from './lands.js';
import { streamY, trailPoint } from './layout.js';
import { glow } from './terrain.js';

/* ── Which tracks, where ── */

/* What crosses, and the level it first turns up at. */
const KINDS = [['boot', 12], ['paw', 14], ['deer', 18], ['bike', 22], ['path', 27], ['horse', 33], ['ruts', 46], ['herd', 52]];

/* How many tracks cross each stretch of trail, by the level it leaves. It
   climbs inside every land as well as from one to the next: a wood that
   was the same for thirty levels and then twice as trodden at a gate was a
   staircase, not a wood getting deeper. */
const density = (lv) => (lv < 16 ? 0 : lv < 46 ? 0.5 + (lv - 16) * 0.8 / 29 : lv < 76 ? 1.5 + (lv - 46) * 0.8 / 29 : 2.6 + (lv - 76) * 0.9 / 23);

/* The steepest a track lies across the board: 52 degrees. */
const MAX_ANG = 0.9;
/* And the least its line may differ from the trail's own where they meet:
   40 degrees. A tyre line that ran along the trail for a stone's length cut
   it in two, and the two halves read as a cart's ruts. */
const MIN_CROSS = 0.7;

/* The ladder's "Cross-tracks" wave (61 to 65), set by hand: one line to a
   level, each from edge to edge of the board, steep and shallow and leaning
   both ways, so they cross each other as well as the trail.
   A crowd's worth of short lines there was only litter on the floor. */
const CROWD = { 61: ['boot', 0.74], 62: ['paw', 0.6], 63: ['boot', 0.18], 64: ['horse', 0.8], 65: ['paw', 0.64] };

const PRINTS = { boot: 1, paw: 1, deer: 1, horse: 1 };

const trackCache = new WeakMap();

/** Every track on a board: { kind, level, x, y (where its line meets the
    trail), ang, dir, s0, s1 (how far along its line it runs, each way),
    span (how many rows it can reach, up or down), seed, wob, lam (how it
    wanders), who (a maker stands on it) }. */
export function tracksOf(layout) {
  let t = trackCache.get(layout);
  if (t) return t;
  t = [];
  const rnd = seeded(41), { stones, W } = layout;
  const far = W / 2 + 70;
  const add = (i, kind, u, ang, dir, o) => {
    const p = trailPoint(layout, i, u);
    if (!(o && o.fork)) {
      /* The trail's own line there, and how far a line at `a` is from it. */
      const a0 = trailPoint(layout, i, u - 0.12), a1 = trailPoint(layout, i, u + 0.12);
      const tau = Math.atan2(a1[1] - a0[1], a1[0] - a0[0]);
      const off = (a) => { const d = (((a * dir - tau) % Math.PI) + Math.PI) % Math.PI; return Math.min(d, Math.PI - d); };
      const sg = ang < 0 ? -1 : 1;
      let best = ang;
      for (const a of [ang, -ang, MAX_ANG * sg, -MAX_ANG * sg, ang * 0.3]) {
        if (off(a) > off(best)) best = a;
        if (off(a) >= MIN_CROSS) { best = a; break; }
      }
      ang = best;
    }
    const reach = Math.min(240, far / Math.max(0.25, Math.abs(Math.cos(ang))));
    const tr = Object.assign({ kind, level: i + 1, x: p[0], y: p[1], ang, dir, s0: -reach, s1: reach, reach, seed: R(rnd() * 1e4), wob: 3 + rnd() * 6, lam: 16 + rnd() * 20 }, o);
    tr.span = Math.ceil(Math.abs(Math.sin(ang)) * Math.max(-tr.s0, tr.s1) + tr.wob * 2 + (tr.fork ? 34 : 14));
    t.push(tr);
  };
  const crossed = new Set(layout.crossings.map(cr => cr.level));
  if (layout.park) crossed.add(layout.park.level);
  let acc = 0, last = '';
  for (let i = 0; i < stones.length - 1; i++) {
    const lvl = i + 1;
    /* Set by hand at the wood's edge: the first boot prints, and then a
       dog's, low on the last stretch before the stile and well clear of it. */
    if (lvl === 12) { add(i, 'boot', 0.55, -0.22, 1); continue; }
    if (lvl === 14 && stones[i + 1].boss) { add(i, 'paw', 0.3, 0.14, -1); continue; }
    if (stones[i].boss || stones[i + 1].boss || crossed.has(lvl)) continue;
    // The footpath a walker is on.
    if (lvl === 31 || lvl === 52) { add(i, 'path', 0.55, lvl === 31 ? 0.2 : -0.24, 1, { who: 'walker' }); continue; }
    if (CROWD[lvl]) { add(i, CROWD[lvl][0], 0.5, CROWD[lvl][1] * (lvl % 2 ? 1 : -1), 1); continue; }
    /* A decoy: a path that leaves the trail and goes its own way. It starts
       at the trail's edge, climbing away to one side. */
    if (lvl >= 41 && lvl <= 44) {
      const side = stones[i + 1].x > stones[i].x ? -1 : 1;
      add(i, 'path', 0.34, -0.62 - rnd() * 0.2, side, { s0: 0, fork: true });
    }
    acc += density(lvl);
    const n = Math.floor(acc);
    acc -= n;
    const avail = KINDS.filter(k => k[1] <= lvl);
    for (let j = 0; j < n; j++) {
      // The newest kinds come up a little more often than the old ones,
      // and never the same thing twice running.
      let kind = avail[Math.min(avail.length - 1, Math.floor(Math.pow(rnd(), 0.75) * avail.length))][0];
      if (kind === last) kind = avail[Math.floor(rnd() * avail.length)][0];
      // By "Very old" (91 on) other dogs have been everywhere.
      if (lvl >= 93 && lvl <= 96 && j === 0) kind = 'paw';
      last = kind;
      const u = n === 1 ? 0.4 + rnd() * 0.2 : 0.2 + (j + 0.2 + rnd() * 0.6) / n * 0.6;
      /* Across the trail, mostly; the deeper, the more it may come at any
         angle (add() turns away any that would run along the trail). */
      const wild = clamp((lvl - 40) / 50, 0, 1);
      const ang = clamp((rnd() - 0.5) * (0.7 + wild * 1.5), -MAX_ANG, MAX_ANG), dir = rnd() < 0.5 ? 1 : -1;
      /* In the old woods, where two and three things cross every stretch,
         most lines of prints come in from the board's edge, cross, and are
         only followed a little way on: what matters is that they crossed
         it, and whole lines of all of them leave no floor to see. */
      const o = {}, a = rnd(), b = rnd();
      if (lvl >= 46 && PRINTS[kind] && a < 0.64) o[a < 0.32 ? 's0' : 's1'] = (a < 0.32 ? -1 : 1) * (30 + b * 40);
      add(i, kind, u, ang, dir, o);
    }
  }
  trackCache.set(layout, t);
  return t;
}

/* ── The marks ── */

/* Each print heading up the board, and heading up and to the right; the
   other six ways are these two turned. Big enough to be told apart at a
   glance (a boot is a sole and a heel, a paw a pad under four toes, a slot
   two toes that close to a point, a shoe an open ring), and few enough to a
   line that each is seen: small marks close together were a row of
   stitches. */
const BOOT = ['.##.', '####', '####', '####', '....', '.##.', '.##.'];
const BOOT_NE = ['...##.', '..####', '..####', '...##.', '##....', '##....'];
const PAW = ['..#.#..', '#.#.#.#', '#.....#', '..###..', '.#####.', '.#####.'];
const PAW_NE = ['..#.#..', '......#', '.##....', '####..#', '####...', '.##....'];
const DEER = ['.#.#.', '.#.#.', '##.##', '##.##'];
const DEER_NE = ['..##.', '.##.#', '##..#', '...#.', '...#.'];
const SHOE = ['.###.', '#...#', '#...#', '#...#', '##.##'];
const SHOE_NE = ['.####', '#...#', '#...#', '....#', '..##.'];

const turned = (rows) => { const out = []; for (let x = 0; x < rows[0].length; x++) { let s = ''; for (let y = rows.length - 1; y >= 0; y--) s += rows[y][x]; out.push(s); } return out; };
const round4 = (m) => { const e = turned(m), s = turned(e); return [m, e, s, turned(s)]; };
/* N, E, S, W, then NE, SE, SW, NW. */
const round8 = (m, ne) => round4(m).concat(round4(ne));
const MARKS = { boot: round8(BOOT, BOOT_NE), paw: round8(PAW, PAW_NE), deer: round8(DEER, DEER_NE), horse: round8(SHOE, SHOE_NE) };

/* The mask for a maker heading (dx, dy). */
function markFor(kind, dx, dy) {
  const M = MARKS[kind], k = ((Math.round(Math.atan2(dx, -dy) / (Math.PI / 4)) % 8) + 8) % 8;
  return k % 2 ? M[4 + (k >> 1)] : M[k >> 1];
}

/* What each kind of print is made of, on each ground: dark where grass is
   pressed flat, the colour of turned mud under trees; each maker its own
   hue (boots tan, paws rust, slots sage, shoes plum) and all of them
   greying as the wood darkens. `IN` is the pressed shadow under a print.
   Every tint is darker than the body of that land's trail (lands.js, the
   path's middle tone): the trail is the palest line on every floor. */
const TINT = {
  boot: { field: '#5e4426', edge: '#5e4426', forest: '#a08058', old: '#8a7654', ancient: '#7c7462' },
  paw: { field: '#8a4a1c', edge: '#8a4a1c', forest: '#b87840', old: '#9c6840', ancient: '#86583e' },
  deer: { field: '#4e5a2c', edge: '#4e5a2c', forest: '#8c9874', old: '#6e8272', ancient: '#667e80' },
  horse: { field: '#4a3420', edge: '#4a3420', forest: '#8a6248', old: '#7c5c4c', ancient: '#74586a' },
};
const IN = { field: '#6f9a40', edge: '#6f9a40', forest: '#1c3a2a', old: '#0c2024', ancient: '#060c16' };
/* The floor along a line of prints, where whatever made them brushed
   through: trodden pale in grass, scuffed dark under trees. It is what
   makes a line of the prints. */
const WAY = { field: '#bcd66a', edge: '#bcd66a', forest: '#2e5a34', old: '#143436', ancient: '#0c1a26' };
/* Worn lines: [mud, its lit middle, its dark edge]. Duller than the trail. */
const WORN = {
  field: ['#b08552', '#d6b074', '#7a9a44'], edge: ['#b08552', '#d6b074', '#7a9a44'], forest: ['#7a5a3a', '#9a7a50', '#243e28'],
  old: ['#4a3e30', '#605240', '#12282a'], ancient: ['#2a2a32', '#3e3e48', '#0a121c'],
};
const TYRE = { field: ['#7a6a44', '#c4d07a'], edge: ['#7a6a44', '#c4d07a'], forest: ['#243a28', '#8aa860'], old: ['#0e2226', '#587868'], ancient: ['#070d16', '#3e5660'] };

/* A stride, in pixels from one print to the next (left foot, then right);
   how far each foot is from the line; and how far a print keeps from the
   trail's edge (half its own size and a pixel of floor). */
const STEP = { boot: 10, paw: 12, deer: 13, horse: 14 };
const SWAY = { boot: 2.5, paw: 1.5, deer: 1, horse: 2.5 };
const CLEAR = { boot: 4.5, paw: 4.5, deer: 3.5, horse: 4 };
/* A boot and a shoe press in deep enough to throw a shadow; toes and slots
   are too fine for one, and with it were blobs. */
const UNDER = { boot: 1, horse: 1 };

function mark(c, rows, x, y, col, under) {
  const ox = x - (rows[0].length >> 1), oy = y - (rows.length >> 1);
  if (under) { c.fillStyle = under; for (let j = 0; j < rows.length; j++) for (let i = 0; i < rows[j].length; i++) if (rows[j][i] === '#') c.fillRect(ox + i, oy + j + 1, 1, 1); }
  c.fillStyle = col;
  for (let j = 0; j < rows.length; j++) for (let i = 0; i < rows[j].length; i++) if (rows[j][i] === '#') c.fillRect(ox + i, oy + j, 1, 1);
}

/* One track, whole, on to `c`: anything with a fillStyle and a fillRect
   (raster() below hands it a pen that writes pixels into a buffer). */
function drawTrack(c, layout, t) {
  const { W, H, xAt, landAt, levelAt, pathDist, stones } = layout;
  const ca = Math.cos(t.ang) * t.dir, sa = Math.sin(t.ang);
  const w0 = t.wob * Math.sin(t.seed);
  /* A fork bends away from the trail as it goes; the others just wander. */
  const at = (s) => {
    const w = t.wob * Math.sin(s / t.lam + t.seed) - w0, bend = t.fork ? Math.min(s, 60) * Math.min(s, 60) / 260 : 0;
    return [t.x + ca * s - sa * w, t.y + sa * s + ca * w + bend];
  };
  const seen = (p) => p[0] > -6 && p[0] < W + 6 && p[1] > -6 && p[1] < H + 6;
  /* How far a point is from the trail. A line is mostly nowhere near the
     trail it crosses, and there the answer is only "far": the trail moves
     a pixel or so a row, so forty across is twenty at the least. */
  const dist = (p) => { const tx = xAt[clamp(R(p[1]), 0, H)]; return tx === tx && Math.abs(p[0] - tx) > 40 ? 99 : pathDist(p[0], p[1]); };
  /* Whether a point `d` from the trail is within `m` pixels of a road
     (nothing prints on one), and whether it is on the bare ground round a
     stone. */
  const road = (p, d, m) => d < ROAD.half + m && surfaceOf(levelAt(p[1])) !== 'earth';
  const byStone = (p) => { const i = clamp(Math.floor(levelAt(p[1])) - 1, 0, stones.length - 1); return [stones[i], stones[i + 1]].some(s => s && Math.abs(s.x - p[0]) < 15 && Math.abs(s.y - p[1]) < 9); };
  /* Nothing is tracked over the forestry track, the lane, the car park or
     water, or in the glade at the heart of the wood: nobody else has ever
     got that far. Only what this line can reach is asked about. */
  const reaches = (y, m) => Math.abs(y - t.y) < t.span + m;
  const roads = layout.crossings.filter(cr => cr.kind !== 'brook' && reaches(cr.y, 12)), waters = layout.waters.filter(w => reaches(w.y, 12));
  const park = layout.park && reaches(layout.park.y, layout.park.ry + 6) ? layout.park : null;
  const ht = layout.heart && reaches(layout.heart.y, layout.heart.ry + 6) ? layout.heart : null;
  const band = (p) => {
    for (let i = 0; i < roads.length; i++) if (Math.abs(p[1] - roads[i].y) < 11) return true;
    for (let i = 0; i < waters.length; i++) if (Math.abs(p[1] - streamY(waters[i], R(p[0]))) <= waters[i].half + 3) return true;
    if (park && Math.abs(p[0] - park.x) < park.rx + 4 && Math.abs(p[1] - park.y) < park.ry + 4) return true;
    return !!ht && Math.pow((p[0] - ht.x) / (ht.rx + 4), 2) + Math.pow((p[1] - ht.y) / (ht.ry + 4), 2) < 1;
  };
  /* A line that is only followed a little way thins out before it stops. */
  const fades = (s, n) => (t.s0 > -t.reach && s - t.s0 < 20 && hash(n * 7 + t.seed) > (s - t.s0) / 20 + 0.15) ||
    (t.s1 < t.reach && t.s1 - s < 20 && hash(n * 7 + t.seed) > (t.s1 - s) / 20 + 0.15);
  const mod = (k, m) => ((k % m) + m) % m;
  if (STEP[t.kind]) {
    const step = STEP[t.kind], clear = CLEAR[t.kind];
    /* The line itself first: grass trodden flat in a pale swath that shows
       from across the field, and under trees a broken scuff. */
    for (let s = t.s0; s <= t.s1; s += 1) {
      const p = at(s);
      if (!seen(p)) continue;
      const d = dist(p);
      if (d < trailHalf(levelAt(p[1])) + 2.5 || road(p, d, 2) || band(p) || fades(s, Math.floor(s / step))) continue;
      const land = landAt(p[1]), x = R(p[0]), y = R(p[1]);
      c.fillStyle = WAY[land];
      if (land === 'field' || land === 'edge') c.fillRect(x - 2, y - 2, 5, 5);
      else if (hash(Math.floor(s / 3) * 11 + t.seed) < 0.7) c.fillRect(x - 1, y, 2, 2);
    }
    let n = Math.floor(t.s0 / step);
    for (let s = n * step; s <= t.s1; s += step, n++) {
      /* No two strides the same length, and now and then a print that did
         not take: a ruled row of marks is stitching. */
      if (hash(n * 53 + t.seed) < 0.1) continue;
      const jit = (hash(n * 31 + t.seed) - 0.5) * step * 0.3, p = at(s + jit), ahead = at(s + jit + 2);
      const side = (n % 2 ? 1 : -1) * SWAY[t.kind];
      const q = [R(p[0] - sa * side), R(p[1] + ca * side)];
      if (!seen(q)) continue;
      const d = dist(q);
      if (d < trailHalf(levelAt(q[1])) + clear || byStone(q) || road(q, d, clear) || band(q) || fades(s, n)) continue;
      const land = landAt(q[1]);
      mark(c, markFor(t.kind, ahead[0] - p[0], ahead[1] - p[1]), q[0], q[1], TINT[t.kind][land], UNDER[t.kind] ? IN[land] : null);
    }
    return;
  }
  const herd = t.kind === 'herd', worn = herd || t.kind === 'path';
  /* A footpath is three pixels of mud, a herd's way four: the trail is
     seven and more, wherever it is. Both stop short of the trail, a strip
     of unworn ground between; a tyre and a cart's wheels stop at its edge
     and go on beyond it. */
  const gap = worn ? (herd ? 4.5 : 3.5) : t.kind === 'ruts' ? 4.5 : 1.5, wide = herd ? 4 : 3;
  const rag = (s) => (herd && hash(Math.floor(s / 4) * 13 + t.seed) > 0.5 ? 1 : 0);
  /* Where the line is on the ground: worked out once, then laid a coat at
     a time (a path's dark edge, its mud, what lies in the mud). */
  const pts = [];
  for (let s = t.s0; s <= t.s1; s += worn ? 1 : 0.5) {
    const p = at(s);
    if (!seen(p) || band(p)) continue;
    const d = dist(p);
    if (d < trailHalf(levelAt(p[1])) + gap || (!worn && road(p, d, gap))) continue;
    pts.push([R(p[0]), R(p[1]), s, landAt(p[1]), R(p[0] - sa), R(p[1] + ca)]);
  }
  for (const [x, y, s, land, lx, ly] of pts) {
    const k = Math.floor(s * 2);
    if (t.kind === 'bike') {
      // One tyre: a thin dark groove, its tread a broken pale lip.
      const T = TYRE[land];
      c.fillStyle = T[0]; c.fillRect(x, y, 1, 1);
      if (mod(k, 6) < 2) { c.fillStyle = T[1]; c.fillRect(lx, ly, 1, 1); }
    } else if (t.kind === 'ruts') {
      // Two wheels, a cart's width apart, worn down to the mud.
      for (const o of [-3, 3]) {
        const qx = x + R(-sa * o), qy = y + R(ca * o);
        c.fillStyle = WORN[land][0]; c.fillRect(qx, qy, 2, 2);
        if (mod(k, 9) < 2) { c.fillStyle = WORN[land][2]; c.fillRect(qx, qy + 1, 1, 1); }
      }
    } else {
      // A footpath other people keep open, or a herd's way poached to mud:
      // this is its dark lower edge, and the mud goes over it below.
      c.fillStyle = WORN[land][2]; c.fillRect(x - 1, y - rag(s), wide, 3 + rag(s));
    }
  }
  if (!worn) return;
  for (const [x, y, s, land] of pts) { c.fillStyle = WORN[land][0]; c.fillRect(x - 1, y - 1 - rag(s), wide, 3 + rag(s)); }
  for (const [x, y, s, land] of pts) {
    const h = hash(Math.floor(s * 2) * 17 + t.seed);
    if (!herd) {
      // The lit middle of a footpath, in broken runs.
      if (hash(Math.floor(s / 3) * 17 + t.seed) > (LANDS[land].dark ? 0.6 : 0.3)) { c.fillStyle = WORN[land][1]; c.fillRect(x, y, 1, 1); }
    } else if (h < 0.2) {
      // The slots a herd leaves in its mud.
      c.fillStyle = h < 0.1 ? WORN[land][2] : WORN[land][1]; c.fillRect(x + (h < 0.06 ? 1 : 0), y, 2, 1);
    }
  }
}

/* ── Drawn once, copied after ── */

/* The few dozen colours tracks are made of, by number: a track's pixels are
   kept as a column, a row and one of these. */
const INKS = [[0, 0, 0]], inkAt = new Map();
function inkOf(hex) {
  let k = inkAt.get(hex);
  if (k === undefined) { k = INKS.length; INKS.push(hexToRgb(hex)); inkAt.set(hex, k); }
  return k;
}

/* A track's pixels, top row first: { n, xs, ys, cs }. It is drawn on a pad
   that is kept from one track to the next, and only the pixels it touched
   are read back and wiped: a pad is the board's width by a few hundred
   rows, a track a thousand pixels of it. */
let pad = new Uint8Array(0);
function raster(layout, t) {
  const W = layout.W, ya = Math.max(0, t.y - t.span), yb = Math.min(layout.H, t.y + t.span);
  if (pad.length < W * (yb - ya + 1)) pad = new Uint8Array(W * (yb - ya + 1));
  const buf = pad, hit = [];
  let ink = 0;
  const pen = {
    set fillStyle(v) { ink = inkOf(v); },
    fillRect(x, y, w, h) {
      const x1 = Math.min(W, x + w), y1 = Math.min(yb + 1, y + h);
      for (let yy = Math.max(ya, y); yy < y1; yy++) for (let xx = Math.max(0, x), o = (yy - ya) * W; xx < x1; xx++) { if (!buf[o + xx]) hit.push(o + xx); buf[o + xx] = ink; }
    },
  };
  drawTrack(pen, layout, t);
  const order = Uint32Array.from(hit).sort();
  const n = order.length, xs = new Uint16Array(n), ys = new Int16Array(n), cs = new Uint8Array(n);
  for (let k = 0; k < n; k++) { const i = order[k], row = Math.floor(i / W); xs[k] = i - row * W; ys[k] = ya + row; cs[k] = buf[i]; buf[i] = 0; }
  return { n, xs, ys, cs };
}

let sheet = null;

/** Every track whose line passes through rows y0..y1, on to a board whose
    row y0 the caller has moved to the top of `c`. */
export function paintTracks(c, layout, y0, y1) {
  const W = layout.W, h = y1 - y0;
  let img = null;
  for (const t of tracksOf(layout)) {
    if (t.y + t.span < y0 || t.y - t.span >= y1) continue;
    const px = t.px || (t.px = raster(layout, t)), { xs, ys, cs } = px;
    // The first of its pixels on these rows, by halving.
    let lo = 0, hi = px.n;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (ys[mid] < y0) lo = mid + 1; else hi = mid; }
    if (lo < px.n && ys[lo] < y1 && !img) img = new ImageData(W, h);
    for (let i = lo; i < px.n && ys[i] < y1; i++) {
      const o = ((ys[i] - y0) * W + xs[i]) * 4, k = INKS[cs[i]];
      img.data[o] = k[0]; img.data[o + 1] = k[1]; img.data[o + 2] = k[2]; img.data[o + 3] = 255;
    }
  }
  if (!img) return;
  /* Over the ground and what lies on it, so by way of a sheet of its own:
     written straight on to the tile it would wipe out the rows it covers. */
  if (!sheet || sheet.width !== W || sheet.height !== h) sheet = makeCanvas(W, h);
  ctx2d(sheet).putImageData(img, 0, 0);
  c.drawImage(sheet, 0, y0);
}

/** Where a maker stands on its track, `far` pixels from the trail on the
    side with more room: [x, y, facing left?]. */
export function onTrack(layout, t, far) {
  const side = t.x < layout.W / 2 ? 1 : -1, ca = Math.cos(t.ang) * t.dir, sa = Math.sin(t.ang);
  const s = far * side / (ca || 1);
  return [R(t.x + ca * s), R(t.y + sa * s), side < 0];
}

/* ── Who left them ── */

/* A small white-and-tan terrier, the kind that is on every footpath. */
const TERRIER = [
  '..............cc..',
  'w............cccw.',
  'ww..........ccewwn',
  '.w..........cwwww.',
  '.wwwwwwwwwwwwwww..',
  '.wwcccwwwwwwwwww..',
  '.wwcccwwwwwwwww...',
  '.WwwwwwwwwwwwwW...',
  '.ww.Ww....ww.Ww...',
  '.ww..w....ww..w...',
  '.ww..w....ww..w...',
];
/* A lean dog with nobody: long legs, ribs, its head low and its eye on you. */
const STRAY = [
  '....................bb..',
  't..................bbbb.',
  't.................bbbbyb',
  '.t...............bbbbbbn',
  '.tt.....bbbbbbbbbbbbb...',
  '..bbbbbbbbbbbbbbbbbb....',
  '..bbbbbbbBbbbBbbbbb.....',
  '..bbbBBbbbbbbbbbbb......',
  '..bb..BBBBBBb.bbb.......',
  '..bb.b........bb.b......',
  '.bb..b.......bb..b......',
  '.b...b.......b...b......',
  '.b...bb......b...bb.....',
];

const baked = new Map();
function figure(key, w, h, draw) {
  let cv = baked.get(key);
  if (!cv) { cv = makeCanvas(w, h); draw(ctx2d(cv)); baked.set(key, cv); }
  return cv;
}
const flipped = (c, cv, x, y, left) => {
  if (!left) { c.drawImage(cv, x, y); return; }
  c.save(); c.translate(x + cv.width, y); c.scale(-1, 1); c.drawImage(cv, 0, 0); c.restore();
};

function shade(c, x, y, w, land) {
  c.fillStyle = castOf(land);
  c.fillRect(x + 2, y, w - 4, 1); c.fillRect(x, y + 1, w, 1); c.fillRect(x + 3, y + 2, w - 6, 1);
}

/** A terrier standing at (x, y), its feet on y. */
export function terrier(c, x, y, land, left) {
  const rim = LANDS[land].dark ? '#0a1216' : '#3a2a1e';
  shade(c, x - 8, y, 17, land);
  flipped(c, figure('terrier/' + rim, 20, 13, (k) => stamp(k, TERRIER, 1, 1, { w: '#f4efe4', c: '#b0743a', n: '#2a2024' }, rim)), x - 10, y - 12, left);
}

/** A stray: nobody's dog, in the ancient wood. `tone` picks its coat. */
export function stray(c, x, y, land, left, tone) {
  const coat = ['#9a9488', '#8a6a4a', '#5a5660'][tone % 3];
  shade(c, x - 10, y, 22, land);
  flipped(c, figure('stray/' + coat, 26, 15, (k) => stamp(k, STRAY, 1, 1, { b: coat, t: coat, y: '#e6f06a', n: '#16141a' }, '#04060c')), x - 13, y - 14, left);
}

/** Somebody else out with their dog, on their own path: the same people as
    the team, in another jacket, with a terrier on a short lead. */
export function walker(c, x, y, land, left, o = {}) {
  const look = { jacket: o.jacket || 'red', hat: o.hat || 'beanie', rim: LANDS[land].dark };
  const key = ['walker', look.jacket, look.hat, look.rim ? 1 : 0].join('/');
  const cv = figure(key, HUMAN_BOX.w + 4, HUMAN_BOX.h + 4, (k) => drawHuman(k, 2, 2, humanPose({ walk: 0.14, armN: 'low' }), look));
  const s = left ? -1 : 1;
  shade(c, x - 7, y, 14, land);
  flipped(c, cv, x - 12 - 2, y - HUMAN_BOX.ground - 2, left);
  // The lead, sagging, from the hand to the terrier's collar.
  c.fillStyle = '#e8d6ae';
  for (let k = 0; k <= 9; k++) c.fillRect(x + s * (8 + k), y - 16 + R(k * 0.75 + Math.sin(k / 9 * Math.PI) * 2), 1, 1);
  terrier(c, x + s * 27, y + 1, land, left);
}

/** Litter: a can, a bottle, a wrapper. Small, bright, and wrong in a wood. */
export function litter(c, x, y, k) {
  const i = Math.floor(k * 3);
  if (i === 0) { c.fillStyle = '#5a6470'; c.fillRect(x, y + 1, 3, 1); c.fillStyle = '#d8dce0'; c.fillRect(x, y, 3, 1); c.fillStyle = '#e8443a'; c.fillRect(x + 1, y, 1, 1); }
  else if (i === 1) { c.fillStyle = '#2a6a5a'; c.fillRect(x + 1, y + 1, 4, 1); c.fillStyle = '#7ad0a0'; c.fillRect(x, y, 4, 1); c.fillStyle = '#e6fff0'; c.fillRect(x + 1, y, 1, 1); }
  else { c.fillStyle = '#8a6a1c'; c.fillRect(x + 1, y + 2, 2, 1); c.fillStyle = '#f2d24a'; c.fillRect(x, y, 3, 2); c.fillStyle = '#e8443a'; c.fillRect(x + 1, y, 1, 2); }
}

/** A camp fire in its ring of stones, burning low. */
export function campfire(c, x, y) {
  glow(c, x, y - 1, 16, 8, [255, 170, 70], 0.2);
  c.fillStyle = '#1a1410'; c.fillRect(x - 4, y - 1, 9, 3);
  c.fillStyle = '#6a6a70'; c.fillRect(x - 5, y, 2, 2); c.fillRect(x + 4, y, 2, 2); c.fillRect(x - 3, y + 2, 2, 1); c.fillRect(x + 2, y + 2, 2, 1); c.fillRect(x - 3, y - 2, 2, 1); c.fillRect(x + 2, y - 2, 2, 1);
  c.fillStyle = '#a8a8a8'; c.fillRect(x - 5, y, 1, 1); c.fillRect(x - 3, y - 2, 1, 1); c.fillRect(x + 2, y - 2, 1, 1);
  c.fillStyle = '#c8502a'; c.fillRect(x - 2, y - 1, 5, 2);
  c.fillStyle = '#f08a2c'; c.fillRect(x - 1, y - 3, 3, 3);
  c.fillStyle = '#ffd36a'; c.fillRect(x, y - 4, 1, 3); c.fillRect(x - 1, y - 2, 1, 1);
  c.fillStyle = '#fff4c2'; c.fillRect(x, y - 2, 1, 1);
}

/** A picnic: a checked rug, a basket, a bottle left standing. */
export function picnic(c, x, y, land) {
  c.fillStyle = castOf(land); c.fillRect(x - 7, y + 4, 17, 1);
  for (let j = 0; j < 7; j++) for (let i = 0; i < 15; i++) {
    c.fillStyle = ((i >> 1) + (j >> 1)) % 2 ? '#c8443a' : '#f1ece3';
    c.fillRect(x - 8 + i + (j >> 1), y - 3 + j, 1, 1);
  }
  c.fillStyle = '#5c3d2a'; c.fillRect(x + 1, y - 3, 6, 4);
  c.fillStyle = '#a67c4e'; c.fillRect(x + 1, y - 3, 6, 1); c.fillRect(x + 2, y - 1, 1, 1); c.fillRect(x + 4, y - 1, 1, 1);
  c.fillStyle = '#80583a'; c.fillRect(x + 2, y - 5, 4, 1); c.fillRect(x + 2, y - 4, 1, 1); c.fillRect(x + 5, y - 4, 1, 1);
  c.fillStyle = '#2a6a5a'; c.fillRect(x - 4, y - 2, 2, 3); c.fillStyle = '#7ad0a0'; c.fillRect(x - 4, y - 3, 1, 3); c.fillRect(x - 4, y - 4, 1, 1);
}
