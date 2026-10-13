/* The effects of a moment: the ring of sparks where the paw lands, the
   confetti, the trail lighting up ahead of the team, and the finale's
   moonbeam and its fireflies. Each is a pure function of the time since it began, like the
   states: nothing here remembers a particle from one frame to the next, so
   a moment can be frozen, skipped or drawn again and looks the same. They
   are drawn in art pixels on whatever canvas the caller has: the board's
   effects layer, or the close-up. */

import { bayer, hash } from './core.js';
import { RAMPS } from './ramps.js';

const R = Math.round;

export const GOLD = ['#8a5a14', '#c8902a', '#f2c14e', '#ffe08a', '#fff8dc'];

/** What a stage's sparks and confetti are made of: its harness colour, a
    lighter one, gold and white. */
const PAPER = {
  hot: ['#ffffff', '#ffd24a', '#5ac8ff', '#ff6ab0'],
  warm: ['#fff4d8', '#5ac8ff', '#7af0b0', '#ff6ab0'],
  cold: ['#ffd24a', '#ffffff', '#ff8ab0', '#7af0b0'],
};

export const STAGE_GLOW = {
  hot: [RAMPS.kit.harnessHot[2], RAMPS.kit.harnessHot[3], GOLD[2], '#ffffff'],
  warm: [RAMPS.kit.harnessWarm[2], RAMPS.kit.harnessWarm[3], GOLD[3], '#ffffff'],
  cold: [RAMPS.kit.harnessCold[2], RAMPS.kit.harnessCold[3], GOLD[2], '#ffffff'],
};

/** A ring of eight sparks stepping out from where the paw landed, T ms
    after it: big and white for two frames, then the stage's colour, then
    thinning out. It lies on the ground, so it is wider than it is tall. */
export function burst(c, cx, cy, T, cols, o) {
  if (T < 0 || T >= 467) return;
  const f = Math.floor(T / 67);
  const r = [4, 8, 11, 13, 14, 15, 15][f], flat = o && o.round ? 1 : 0.6;
  for (let i = 0; i < 8; i++) {
    if (f >= 5 && (i + f) % 2) continue;
    const a = i / 8 * Math.PI * 2 + 0.39;
    const x = cx + R(r * Math.cos(a)), y = cy + R(r * flat * Math.sin(a));
    c.fillStyle = f < 2 ? cols[3] : f < 4 ? cols[2] : cols[i % 2];
    if (f < 2) c.fillRect(x - 1, y - 1, 2, 2);
    else if (f < 4) { c.fillRect(x - 1, y, 3, 1); c.fillRect(x, y - 1, 1, 3); }
    else c.fillRect(x, y, 1, 1);
  }
  // The flash itself: one frame of white across the middle.
  if (f === 0) { c.fillStyle = 'rgba(255,255,255,0.85)'; c.fillRect(cx - 7, cy - 2, 14, 4); c.fillRect(cx - 4, cy - 4, 8, 8); }
}

/** One frame of white round a stone: the new ring catching the light. */
export function flash(c, cx, cy, T) {
  if (T < 0 || T >= 100) return;
  c.fillStyle = T < 67 ? '#ffffff' : GOLD[3];
  for (let a = 0; a < 360; a += 6) {
    const x = cx + R(13 * Math.cos(a * Math.PI / 180)), y = cy + R(8 * Math.sin(a * Math.PI / 180));
    c.fillRect(x, y, 1, 1);
    if (T < 67) c.fillRect(x, y - 1, 1, 1);
  }
}

/** Confetti: n pieces thrown up from (cx, cy), opening out, then falling
    and turning over for about a second. o: { n, stage | gold, spread, seed,
    life }. */
export function confetti(c, cx, cy, T, o) {
  const n = o.n || 16, life = o.life || 1150, seed = o.seed || 0, spread = (o.spread || 46) / 46;
  if (T < 0 || T > life + 160) return;
  // Paper that shows on the land it falls over: the field is full of red
  // and white already, the forest of green and yellow, the dark woods of
  // teal, so each stage throws what its own ground is not.
  const cols = o.gold ? [GOLD[2], '#ffffff', GOLD[3], '#8ad8ff'] : (PAPER[o.stage] || PAPER.hot);
  for (let i = 0; i < n; i++) {
    const tt = T - hash(i * 7 + seed) * 140;
    if (tt < 0 || tt > life) continue;
    const s = tt / 1000;
    const ang = -Math.PI / 2 + (hash(i * 3 + seed) - 0.5) * 2.5;
    const v = 46 + hash(i * 11 + seed) * 62;
    // Thrown, then held up by the air: it never falls faster than paper does.
    const up = Math.sin(ang) * v, vy = Math.min(42, up + 190 * s);
    const x = cx + Math.cos(ang) * v * spread * (1 - Math.exp(-s * 2.2)) / 2.2 * 2.4 + Math.sin(tt / 170 + i) * 2;
    const y = cy + (vy < 42 ? up * s + 95 * s * s : up * ((42 - up) / 190) + 95 * Math.pow((42 - up) / 190, 2) + 42 * (s - (42 - up) / 190));
    // Going: it blinks out over its last fifth.
    if (tt > life * 0.8 && Math.floor(tt / 67) % 2) continue;
    // A piece of paper turning over: face on, on edge, face on, end on. Its
    // underside is the darkest tone, so it shows on grass as on bare earth.
    const turn = (Math.floor(tt / 100) + i) % 4;
    const X = R(x), Y = R(y), col = cols[(i + (turn === 2 ? 1 : 0)) % cols.length];
    const w = turn === 0 ? 3 : turn === 1 ? 2 : turn === 2 ? 3 : 2, h = turn === 0 ? 2 : turn === 1 ? 3 : turn === 2 ? 2 : 2;
    // A dark edge all round: that, not its colour, is what lifts a piece
    // of paper off poppies and leaf litter.
    c.fillStyle = o.gold ? '#5a3608' : '#2a1426';
    c.fillRect(X - 1, Y, w + 2, h); c.fillRect(X, Y - 1, w, h + 2);
    c.fillStyle = col;
    c.fillRect(X, Y, w, h);
    if (turn !== 2) { c.fillStyle = '#ffffff'; c.fillRect(X, Y, 1, 1); }
  }
}

/** The trail lighting up ahead of the team. pts: points along it, each with
    its place in the line (`i` of `n`); k: how much of the line has come on
    (0..1); t: the clock. A point comes on as a small gold star and settles
    to a glint; the caller leaves out the ones the team has passed. */
export function trailGlow(c, pts, k, t, n) {
  const lit = k * n;
  let prev = null;
  for (const p of pts) {
    if (p.i >= lit) break;
    // A line of light two pixels thick down the middle of the trail, dark
    // gold under it, so it reads on a tan path as on tarmac.
    if (prev && p.i === prev.i + 1) {
      const steps = Math.max(Math.abs(p[0] - prev[0]), Math.abs(p[1] - prev[1])) || 1;
      for (let j = 0; j <= steps; j++) {
        const x = Math.round(prev[0] + (p[0] - prev[0]) * j / steps), y = Math.round(prev[1] + (p[1] - prev[1]) * j / steps);
        c.fillStyle = GOLD[0]; c.fillRect(x - 1, y + 1, 3, 1);
        c.fillStyle = (Math.floor(t / 100) + p.i) % 4 === 0 ? '#ffffff' : GOLD[3]; c.fillRect(x - 1, y - 1, 2, 2);
      }
    }
    prev = p;
  }
  // Its head: a star running up the trail ahead of the dog.
  if (prev && k < 1) {
    c.fillStyle = GOLD[2]; c.fillRect(prev[0] - 3, prev[1] - 1, 6, 2); c.fillRect(prev[0] - 1, prev[1] - 3, 2, 6);
    c.fillStyle = '#ffffff'; c.fillRect(prev[0] - 2, prev[1] - 1, 4, 2); c.fillRect(prev[0] - 1, prev[1] - 2, 2, 4);
  }
}

const MOONLIGHT = ['#8cc4a8', '#d4f0d0', '#ffffff'];

/** The moon finding the great tree, T ms after it breaks through the
    canopy: a thread of white for two frames, then a beam that opens to `w`
    wide over a third of a second and stays, breathing. It comes down from
    the upper left to (cx, cy), starting at row `top`, and lies in a pool
    there. Three bands of thin light, one inside the other, with only the
    outer edge broken up: dithered all through, it was a mesh across the
    glade and sharper than anything in it. */
export function moonbeam(c, cx, cy, top, T, w = 24) {
  if (T < 0 || cy <= top) return;
  const open = T < 134 ? 0.12 : Math.min(1, 0.12 + (T - 134) / 330);
  const breath = T < 464 ? 1 : 0.84 + 0.16 * Math.sin((T - 464) / 520);
  const half = Math.max(1, R(w * open / 2));
  if (T < 134) {
    c.fillStyle = MOONLIGHT[2];
    for (let y = top; y <= cy; y++) if (bayer(R(cx - (cy - y) * 0.42), y) < 0.9) c.fillRect(R(cx - (cy - y) * 0.42), y, 1, 1);
    return;
  }
  const veil = [`rgba(140,196,168,${(0.2 * breath).toFixed(2)})`, `rgba(212,240,208,${(0.17 * breath).toFixed(2)})`, `rgba(255,255,255,${(0.15 * breath).toFixed(2)})`];
  const band = (k, mx, y, hw, ragged) => {
    const il = ragged && bayer(mx - hw, y) < 0.5 ? 1 : 0, ir = ragged && bayer(mx + hw, y) < 0.5 ? 1 : 0;
    c.fillStyle = veil[k]; c.fillRect(mx - hw + il, y, hw * 2 + 1 - il - ir, 1);
  };
  for (let y = top; y <= cy; y++) {
    const u = (y - top) / (cy - top), mx = R(cx - (cy - y) * 0.42);
    const hw = Math.max(1, R(half * (0.55 + 0.45 * u)));
    band(0, mx, y, hw, true);
    if (hw > 3) band(1, mx, y, R(hw * 0.56), false);
    if (hw > 6) band(2, mx, y, Math.max(1, R(hw * 0.2)), false);
  }
  // The pool it makes on the ground.
  for (let j = -4; j <= 4; j++) {
    const rx = R((half + 5) * Math.sqrt(1 - (j * j) / 20.25));
    band(j > -3 && j < 3 ? 1 : 0, cx, cy + 1 + j, rx, true);
  }
}

/** Every firefly in the wood coming to the great tree: n lights that start
    scattered `span` wide round (cx, cy), wind inward and up the trunk by
    `rise`, and then ring it for as long as the moment lasts. T: ms since
    they were called. Each has a dim pixel behind it while it travels. */
export function gather(c, cx, cy, T, n = 18, span = 70, rise = 46) {
  if (T < 0) return;
  for (let i = 0; i < n; i++) {
    const t0 = T - hash(i * 5 + 2) * 500;
    if (t0 < 0) continue;
    const a0 = hash(i * 3) * Math.PI * 2, r0 = span * (0.45 + 0.55 * hash(i * 7)), ring = 8 + (i % 3) * 5;
    const at = (tt) => {
      const u = Math.min(1, tt / 1500), e = 1 - (1 - u) * (1 - u), over = u >= 1 ? tt - 1500 : 0;
      const r = r0 * (1 - e) + ring * e, a = a0 + e * 4.2 + over / (700 + (i % 4) * 160);
      return [R(cx + r * Math.cos(a)), R(cy + r * 0.45 * Math.sin(a) - rise * e - (over ? 2 * Math.sin(tt / 300 + i) : 0))];
    };
    const p = at(t0), blink = Math.floor((t0 + i * 130) / 133) % 5;
    if (t0 < 1500 && t0 > 100) { const q = at(t0 - 100); c.fillStyle = '#6a7a2a'; c.fillRect(q[0], q[1], 1, 1); }
    if (blink > 2) { c.fillStyle = 'rgba(232,244,122,0.35)'; c.fillRect(p[0] - 1, p[1], 3, 1); c.fillRect(p[0], p[1] - 1, 1, 3); }
    c.fillStyle = blink === 0 ? '#8a9a3a' : blink > 2 ? '#fffbd0' : i % 4 === 0 ? '#b8fff0' : '#e8f47a';
    c.fillRect(p[0], p[1], 1, 1);
  }
}

/** The paw as it lands on a stone, T ms after: wide and flat for a frame
    (the squash), tall for a frame, then its own size. `rows` is the icon. */
export function stampPaw(c, cx, cy, T, rows) {
  if (T < 0 || T >= 200) return;
  const f = Math.floor(T / 67);
  const sx = [3, 2, 2][f], sy = [1, 3, 2][f];
  const w = rows[0].length * sx, h = rows.length * sy, x0 = cx - (w >> 1), y0 = cy - (h >> 1) - (f === 1 ? 1 : 0);
  for (const [dx, dy, col] of [[0, 1, GOLD[0]], [0, 0, f === 0 ? '#ffffff' : GOLD[2]]]) {
    c.fillStyle = col;
    rows.forEach((r, y) => { for (let x = 0; x < r.length; x++) if (r[x] !== '.') c.fillRect(x0 + x * sx + dx, y0 + y * sy + dy, sx, sy); });
  }
}
