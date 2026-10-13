/* The board's ambient life: what moves on the land while nobody is doing
   anything, a little more of it the deeper the wood. Grass leaning in the
   wind, a butterfly and a cloud's shadow over the open field; leaves coming
   down in the forest and dust in its shafts of sun; fireflies, drifting
   mist, a campfire and the hamlet's lanterns in the old forest; in the
   ancient wood, motes rising, eyes that blink, the moon's shafts breathing,
   and a car's headlamps passing along the lane.

   It is drawn on one small canvas laid over the part of the board on screen
   (board.js owns it and calls this at most thirty times a second, only with
   Animations on, the board in view and the app in front). Nothing here
   repaints a tile or reads a pixel back: every frame is a hundred or so
   small rectangles, placed by a pure function of the clock, so it costs
   next to nothing and there is no state to lose. Nothing here is big enough
   to hide a stone, a plate or the trail, and the dark woods' lights are
   kept dimmer than the trail's own. A land not reached yet is dimmed and
   still: nothing moves above the lock line. */

import { ctx2d, hash, makeCanvas } from './core.js';
import { RAMPS } from './ramps.js';
import { castOf, LANDS } from './lands.js';
import { streamY } from './layout.js';
import { sceneOf } from './scene.js';
import { car, houseParts, LAMP_TOP, wisp } from './scenery.js';

/* The open lands: the field and the wood's edge. */
const openLand = (layout, y) => { const l = layout.landAt(y); return l === 'field' || l === 'edge'; };

const R = Math.round;
const CELL = 64;

/* A few places in each band of rows, the same every time, for the things
   that are not tied to a piece of scenery. */
function spots(layout, view, per, seed, fn) {
  const c0 = Math.floor(view.y0 / CELL), c1 = Math.floor(view.y1 / CELL);
  for (let ci = c0; ci <= c1; ci++) {
    for (let k = 0; k < per; k++) {
      const x = R(hash(ci * 31 + k * 7 + seed) * (layout.W - 8)) + 4, y = ci * CELL + R(hash(ci * 17 + k * 3 + seed * 5) * CELL);
      if (y < view.y0 || y >= view.y1 || y < view.lock) continue;
      fn(x, y, ci * 16 + k);
    }
  }
}
/* What scenery is on screen and reached, by its tag. */
function tagged(items, view, fn) {
  for (const it of items) {
    const g = it.tag;
    if (g && g.y >= view.y0 - 4 && g.y <= view.y1 + 30 && g.y >= view.lock) fn(g);
  }
}

function open(c, layout, view, t, dusk) {
  const G = RAMPS.meadow.grass, oy = view.y0;
  // The wind crosses the field in waves: whole tufts of long grass lean
  // with it and come back, a patch at a time, not each on its own.
  spots(layout, view, 12, 1, (x, y, i) => {
    if (!openLand(layout, y) || layout.pathDist(x, y) < 11) return;
    const w = Math.sin(t / 700 - x / 34 - y / 90), lean = w > 0.4 ? 1 : w < -0.4 ? -1 : 0;
    const yy = y - oy;
    c.fillStyle = G[1]; c.fillRect(x, yy, 5, 1); c.fillRect(x + 1, yy - 1, 1, 1); c.fillRect(x + 3, yy - 1, 1, 1);
    c.fillStyle = G[3]; c.fillRect(x + lean, yy - 3, 1, 2); c.fillRect(x + 2 + lean, yy - 4, 1, 3); c.fillRect(x + 4 + lean, yy - 3, 1, 2);
    c.fillStyle = G[4]; c.fillRect(x + 2 + lean * 2, yy - 5, 1, 1); c.fillRect(x + lean * 2, yy - 4, 1, 1);
    if (i % 4 === 0) { c.fillStyle = RAMPS.meadow.buttercup[3]; c.fillRect(x + 4 + lean * 2, yy - 4, 1, 1); }
  });
  if (dusk) {
    // After dark the field has fireflies instead of butterflies.
    spots(layout, view, 2, 9, (x, y, i) => {
      if (!openLand(layout, y)) return;
      const T = (t + i * 900) % 3600;
      if (T > 2200) return;
      c.fillStyle = T % 900 < 560 ? '#e8f47a' : '#8a9a3a';
      c.fillRect(x + R(5 * Math.sin(T / 700 + i)), y - oy + R(3 * Math.sin(T / 450)), 1, 1);
    });
    return;
  }
  // A cloud's shadow crossing, slowly: broad, faint, ragged at its edges.
  // Only the open field has a whole sky over it.
  const mid = (view.y0 + view.y1) / 2;
  if (layout.landAt(mid) === 'field') {
    const span = layout.W + 160, cx = ((t / 90) % span) - 80, cy = Math.floor(mid / 300) * 300 + 150;
    if (cy > view.lock + 20) {
      c.fillStyle = castOf('field', 0.62);
      for (let j = -13; j <= 13; j++) {
        const half = R(58 * Math.sqrt(1 - (j * j) / 182) + 5 * Math.sin(j * 1.3));
        c.fillRect(R(cx) - half + (j & 1), cy + j * 2 - oy, half * 2, 2);
      }
    }
  }
  // Butterflies working their way up the field: two wings that open and
  // shut, big enough to see, white ones and blue ones.
  spots(layout, view, 1, 4, (x, y, i) => {
    if (i % 2 || !openLand(layout, y)) return;
    const T = (t + i * 1300) % 7000, bx = x + R(18 * Math.sin(T / 900) + 5 * Math.sin(T / 230)), by = y - R(T / 7000 * 40) + R(3 * Math.sin(T / 170)) - oy;
    const flap = Math.floor((t + i * 50) / 133) % 2;
    const wing = (i >> 1) % 2 ? '#fff8dc' : '#8cc6ee';
    c.fillStyle = castOf('field'); c.fillRect(bx, by + 5, 3, 1);
    c.fillStyle = wing;
    if (flap) { c.fillRect(bx - 2, by - 1, 2, 2); c.fillRect(bx + 1, by - 1, 2, 2); c.fillRect(bx - 1, by + 1, 1, 1); c.fillRect(bx + 1, by + 1, 1, 1); }
    else { c.fillRect(bx - 1, by - 2, 1, 3); c.fillRect(bx + 1, by - 2, 1, 3); }
    c.fillStyle = '#3a2a14'; c.fillRect(bx, by - 1, 1, 3);
  });
}

/* Leaves coming down: slantwise, tumbling through three shapes as they
   fall, their shadow waiting on the ground. `per` to a band of rows. */
function leaves(c, layout, view, t, land, per, cols) {
  const oy = view.y0, shade = castOf(land, 0.6);
  spots(layout, view, per, 3, (x, y, i) => {
    if (layout.landAt(y) !== land) return;
    const life = 3000 + (i % 5) * 320, T = (t + i * 700) % life, drop = 56;
    const lx = x + R(life / 110);
    if (T > life - 600) { c.fillStyle = cols[1]; c.fillRect(lx, y - oy, 3, 1); c.fillRect(lx + 1, y - oy - 1, 1, 1); return; }
    const fx = x + R(T / 110 + 4 * Math.sin(T / 260 + i)), fy = y - drop + R(T / (life - 600) * drop);
    if (fy < view.lock) return;
    c.fillStyle = shade; c.fillRect(lx, y - oy + 1, 3, 1);
    c.fillStyle = cols[i % 3];
    const turn = Math.floor(T / 170) % 3, yy = fy - oy;
    if (turn === 0) { c.fillRect(fx, yy, 3, 1); c.fillRect(fx + 1, yy - 1, 1, 1); }
    else if (turn === 1) { c.fillRect(fx, yy - 1, 1, 3); c.fillRect(fx + 1, yy, 1, 1); }
    else { c.fillRect(fx, yy, 2, 1); c.fillRect(fx + 1, yy + 1, 2, 1); }
    c.fillStyle = cols[2]; c.fillRect(fx, yy, 1, 1);
  });
}

/* Fireflies: a light that wanders a little and goes out for a while. */
function fireflies(c, layout, view, t, per, seed, where) {
  const oy = view.y0;
  spots(layout, view, per, seed, (x, y, i) => {
    if (!where(y)) return;
    const T = (t + i * 800) % 3800;
    if (T > 2400) return;
    c.fillStyle = T % 800 < 480 ? '#fff0a0' : '#c89a2a';
    c.fillRect(x + R(6 * Math.sin(T / 800 + i)), y - oy + R(4 * Math.sin(T / 520 + i * 2)), 1, 1);
  });
}

function forest(c, layout, view, t, items) {
  const oy = view.y0;
  leaves(c, layout, view, t, 'forest', 4, ['#d8d05a', '#a8b83e', '#f0e488']);
  // Dust turning over in the shafts of sun.
  tagged(items, view, (g) => {
    if (g.k !== 'shaft' || g.moon || layout.landAt(g.y) !== 'forest') return;
    for (let k = 0; k < 2; k++) {
      const T = (t + g.x * 53 + k * 1700) % 3400, j = R(T / 3400 * g.len);
      c.fillStyle = T % 500 < 300 ? '#fffbe0' : '#f0e488';
      c.fillRect(R(g.x - (g.len - j) * 0.55) + 1 + ((k * 3 + R(T / 600)) % Math.max(1, g.w - 2)), g.y - g.len + j - oy, 1, 1);
    }
  });
  // Deeper in, fireflies.
  const deep = layout.stones[34] ? layout.stones[34].y : 0;
  fireflies(c, layout, view, t, 3, 6, (y) => layout.landAt(y) === 'forest' && y <= deep);
}

function old(c, layout, view, t, items) {
  const oy = view.y0;
  fireflies(c, layout, view, t, 3, 6, (y) => layout.landAt(y) === 'old');
  leaves(c, layout, view, t, 'old', 1, ['#8ab46a', '#5a8a54', '#b8d48a']);
  tagged(items, view, (g) => {
    if (g.k === 'wisp' && layout.landAt(g.y) === 'old') {
      // The mist is never quite still: a second, thinner wisp slides along the first.
      wisp(c, g.x + R(9 * Math.sin(t / 2300 + g.x)), g.y - oy + (Math.floor(t / 1900 + g.x) % 2), g.len - 8, '190,226,214', 0.12);
    } else if (g.k === 'camp' && g.fire) {
      // The fire: three shapes of flame, and a spark going up now and then.
      const fx = g.x + g.fire[0], fy = g.y + g.fire[1] - oy, f = Math.floor(t / 133) % 3, S = (t + g.x * 31) % 1700;
      c.fillStyle = '#f08a2c'; c.fillRect(fx - 1 + (f === 1 ? -1 : 0), fy - 4, 3, 2);
      c.fillStyle = '#ffd36a'; c.fillRect(fx + (f === 2 ? 1 : 0), fy - 5 - (f === 0 ? 1 : 0), 1, 3);
      c.fillStyle = '#fff4c2'; c.fillRect(fx, fy - 2, 1, 1);
      if (S < 900) { c.fillStyle = S < 500 ? '#ffd36a' : '#c8502a'; c.fillRect(fx + R(S / 220) - 1, fy - 6 - R(S / 70), 1, 1); }
    } else if (g.k === 'lamp') {
      // The lamp breathes: its glass a tone brighter, then its pool of light
      // a ring wider on the ground.
      const p = Math.floor((t + g.x * 37) / 500) % 4;
      if (p === 0) return;
      c.fillStyle = '#fff6c8'; c.fillRect(g.x - 1, g.y - LAMP_TOP - 1 - oy, 3, 3);
      if (p >= 2) {
        c.fillStyle = 'rgba(255,214,120,0.2)';
        for (let j = -4; j <= 4; j++) { const half = R(22 * Math.sqrt(1 - (j * j) / 20)); c.fillRect(g.x - half, g.y + 1 + j * 2 - oy, half * 2, 2); }
      }
      if (p === 2) { c.fillStyle = 'rgba(255,236,170,0.45)'; c.fillRect(g.x - 5, g.y - LAMP_TOP - 3 - oy, 11, 1); c.fillRect(g.x - 5, g.y - LAMP_TOP + 3 - oy, 11, 1); }
    } else if (g.k === 'house') {
      const P = houseParts(g.x, g.y, g.w, g.h, g.seed);
      // Every lit window lives: a fire's flare, someone crossing the room,
      // each in its own time.
      P.wins.forEach((wn, k) => {
        if (!wn.lit) return;
        const f = Math.floor((t + g.x * 91 + k * 700) / 150) % (16 + (k * 5 + g.seed) % 9);
        if (f === 3 || f === 4) { c.fillStyle = 'rgba(255,255,255,0.45)'; c.fillRect(wn.x, wn.y - oy, wn.w, wn.h); }
        else if (f === 9 || f === 10) { c.fillStyle = 'rgba(30,34,40,0.55)'; c.fillRect(wn.x + (f === 9 ? 0 : 3), wn.y - oy, 2, wn.h); }
      });
      // Smoke from the chimneys that have a fire under them: a column of
      // puffs that swell, lean with the wind and thin out.
      if (P.smoke) {
        for (let i = 0; i < 5; i++) {
          const life = 3000, S = (t + i * 600 + g.x * 50) % life, u = S / life;
          const sz = u < 0.25 ? 2 : u < 0.6 ? 3 : 4;
          c.fillStyle = `rgba(170,190,186,${u > 0.7 ? 0.28 : u > 0.4 ? 0.5 : 0.8})`;
          const sx = P.chx + 1 + R(u * 12 + Math.sin(S / 350 + i) * 2), sy = P.chy - 2 - R(u * 26) - oy;
          c.fillRect(sx, sy, sz, sz - 1); c.fillRect(sx + 1, sy - 1, sz - 1, 1);
        }
      }
    }
  });
}

/* A car and the light it throws, painted once for each way it can face. */
const cars = new Map();
const CAR = { w: 84, h: 24, x: 19, y: 16 };
function carArt(left, colour) {
  const key = (left ? 'l' : 'r') + colour;
  let cv = cars.get(key);
  if (!cv) { cv = makeCanvas(CAR.w, CAR.h); car(ctx2d(cv), left ? CAR.w - 1 - CAR.x : CAR.x, CAR.y, colour, left, true); cars.set(key, cv); }
  return cv;
}

function ancient(c, layout, view, t, items) {
  const oy = view.y0, F = LANDS.ancient.fungus;
  // Motes going up through the dark, a few at a time, the fungi's own colour.
  spots(layout, view, 2, 11, (x, y, i) => {
    if (layout.landAt(y) !== 'ancient' || layout.pathDist(x, y) < 7) return;
    const life = 4600 + (i % 4) * 500, T = (t + i * 900) % life;
    if (T > life * 0.8 && Math.floor(T / 133) % 2) return;
    c.fillStyle = i % 3 ? F[1] : F[2];
    c.fillRect(x + R(4 * Math.sin(T / 800 + i)), y - R(T / life * 34) - oy, 1, 1);
  });
  tagged(items, view, (g) => {
    if (layout.landAt(g.y) !== 'ancient') return;
    if (g.k === 'eyes') {
      // A blink: the two lights go out for two frames, every few seconds.
      const T = (t + g.x * 97 + g.y * 31) % (3400 + (g.x % 5) * 600);
      if (T < 134) { c.fillStyle = LANDS.ancient.floor[0]; c.fillRect(g.x - 1, g.y - 1 - oy, 6, 3); }
    } else if (g.k === 'shaft') {
      // The moon's shafts breathe, and dust turns over in them.
      const T = (t + g.x * 53) % 4200, j = R(T / 4200 * g.len), p = Math.floor((t + g.x * 41) / 700) % 3;
      c.fillStyle = '#d8f0ff';
      c.fillRect(R(g.x - (g.len - j) * 0.55) + 1 + (R(T / 700) % Math.max(1, g.w - 2)), g.y - g.len + j - oy, 1, 1);
      if (p) { c.fillStyle = p === 2 ? 'rgba(196,232,255,0.16)' : 'rgba(196,232,255,0.08)'; c.fillRect(g.x - 1, g.y - 1 - oy, g.w + 2, 2); c.fillRect(g.x + 1, g.y - 2 - oy, g.w - 2, 4); }
    } else if (g.k === 'wisp') {
      wisp(c, g.x + R(7 * Math.sin(t / 2700 + g.x)), g.y - oy, g.len - 8, '150,190,200', 0.1);
    }
  });
  // The lane: a car comes through every nine seconds or so, one way and
  // then the other, its lamps lying on the tarmac ahead of it.
  const ry = layout.roadY;
  if (ry != null && ry + 4 >= view.lock && ry > view.y0 - 12 && ry < view.y1 + 20) {
    const n = Math.floor(t / 9000), T = t - n * 9000, left = n % 2 === 1, span = layout.W + 2 * CAR.w;
    if (T < 2800) {
      const u = T / 2800, x = left ? layout.W + CAR.w - u * span : -CAR.w + u * span;
      c.drawImage(carArt(left, n % 4 < 2 ? '#8a2a2a' : '#3a5a7a'), R(x) - (left ? CAR.w - 1 - CAR.x : CAR.x), ry + 4 - CAR.y - oy);
    }
  }
}

/* Light on the water: short dashes that slide along a brook or a stream. */
function water(c, layout, view, t) {
  const oy = view.y0;
  for (const w of layout.waters || []) {
    if (w.y < view.y0 - 12 || w.y > view.y1 + 12 || w.y < view.lock) continue;
    const ramp = LANDS[w.land].water;
    // The light rides the current in clusters: a long dash, a short one
    // under it, a glint that comes and goes between them.
    const f = Math.floor(t / 160);
    for (let x = (f * 2) % 18 - 6; x < layout.W; x += 18) {
      const k = Math.floor((x - (f * 2) % 18) / 18);
      const y = streamY(w, x) + (((k % 3) + 3) % 3) - 1;
      if (Math.abs(x - w.x) < 14) continue;       // the crossing itself: stones, a ford, a bridge
      c.fillStyle = ramp[3]; c.fillRect(x, y - oy, 6, 1); c.fillRect(x + 3, y + 2 - oy, 4, 1);
      c.fillStyle = ramp[4]; c.fillRect(x + 1 + (f % 3), y - oy, 2, 1);
      if ((k + f) % 4 === 0) c.fillRect(x + 9, y - 2 - oy, 1, 1);
    }
  }
}

function ponds(c, layout, view, t, items) {
  const oy = view.y0;
  tagged(items, view, (g) => {
    if (g.k !== 'pond') return;
    const f = Math.floor((t + g.x * 40) / 300) % 3;
    c.fillStyle = LANDS[layout.landAt(g.y)].water[4];
    c.fillRect(g.x - 7 + f * 3, g.y - 1 - oy, 3, 1); c.fillRect(g.x + 2 - f * 2, g.y + 2 - oy, 2, 1);
  });
}

/** Draw one frame of ambient life. c: a canvas whose top row is board row
    view.y0; view: { y0, y1, dark, lock, current }; t: the clock in ms. */
export function drawAmbient(c, layout, view, t) {
  const lands = {};
  for (let y = view.y0; y < view.y1; y += 40) lands[layout.landAt(y)] = true;
  lands[layout.landAt(view.y1 - 1)] = true;
  const items = sceneOf(layout);
  if (lands.field || lands.edge) open(c, layout, view, t, !!view.dark);
  if (lands.edge) leaves(c, layout, view, t, 'edge', 1, ['#d8d05a', '#a8b83e', '#f0e488']);
  if (lands.forest) forest(c, layout, view, t, items);
  water(c, layout, view, t);
  if (lands.old) old(c, layout, view, t, items);
  if (lands.ancient) ancient(c, layout, view, t, items);
  ponds(c, layout, view, t, items);
}
