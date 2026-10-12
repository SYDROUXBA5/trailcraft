/* The board's ambient life: what moves on the land while nobody is doing
   anything. Grass leaning in the wind, light on the water, a butterfly and
   a cloud's shadow in the meadow; leaves coming down and fireflies in the
   wood; windows, lamps and chimney smoke in the town; snow on the climb.

   It is drawn on one small canvas laid over the part of the board on screen
   (board.js owns it and calls this at most thirty times a second, only with
   Animations on, the board in view and the app in front). Nothing here
   repaints a tile or reads a pixel back: every frame is a hundred or so
   small rectangles, placed by a pure function of the clock, so it costs
   next to nothing and there is no state to lose. A land not reached yet is
   dimmed and still: nothing moves above the lock line. */

import { hash } from './core.js';
import { CAST, RAMPS } from './ramps.js';
import { streamY } from './layout.js';
import { sceneOf } from './scene.js';
import { houseParts, LAMP_TOP, TENT_LAMP } from './scenery.js';

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

function meadow(c, layout, view, t, dusk) {
  const G = RAMPS.meadow.grass, oy = view.y0;
  // The wind crosses the field in waves: whole tufts of long grass lean
  // with it and come back, a patch at a time, not each on its own.
  spots(layout, view, 12, 1, (x, y, i) => {
    if (layout.landAt(y) !== 'hot' || layout.pathDist(x, y) < 11) return;
    const w = Math.sin(t / 700 - x / 34 - y / 90), lean = w > 0.4 ? 1 : w < -0.4 ? -1 : 0;
    const yy = y - oy;
    c.fillStyle = G[1]; c.fillRect(x, yy, 5, 1); c.fillRect(x + 1, yy - 1, 1, 1); c.fillRect(x + 3, yy - 1, 1, 1);
    c.fillStyle = G[3]; c.fillRect(x + lean, yy - 3, 1, 2); c.fillRect(x + 2 + lean, yy - 4, 1, 3); c.fillRect(x + 4 + lean, yy - 3, 1, 2);
    c.fillStyle = G[4]; c.fillRect(x + 2 + lean * 2, yy - 5, 1, 1); c.fillRect(x + lean * 2, yy - 4, 1, 1);
    if (i % 4 === 0) { c.fillStyle = RAMPS.meadow.buttercup[3]; c.fillRect(x + 4 + lean * 2, yy - 4, 1, 1); }
  });
  if (dusk) {
    // After dark the meadow has fireflies instead of butterflies.
    spots(layout, view, 2, 9, (x, y, i) => {
      if (layout.landAt(y) !== 'hot') return;
      const T = (t + i * 900) % 3600;
      if (T > 2200) return;
      c.fillStyle = T % 900 < 560 ? '#e8f47a' : '#8a9a3a';
      c.fillRect(x + R(5 * Math.sin(T / 700 + i)), y - oy + R(3 * Math.sin(T / 450)), 1, 1);
    });
    return;
  }
  // A cloud's shadow crossing, slowly: broad, faint, ragged at its edges.
  const [hex, a] = CAST.meadow;
  const mid = (view.y0 + view.y1) / 2;
  if (layout.landAt(mid) === 'hot') {
    const span = layout.W + 160, cx = ((t / 90) % span) - 80, cy = Math.floor(mid / 300) * 300 + 150;
    if (cy > view.lock + 20) {
      c.fillStyle = hex; c.globalAlpha = a * 0.62;
      for (let j = -13; j <= 13; j++) {
        const half = R(58 * Math.sqrt(1 - (j * j) / 182) + 5 * Math.sin(j * 1.3));
        c.fillRect(R(cx) - half + (j & 1), cy + j * 2 - oy, half * 2, 2);
      }
      c.globalAlpha = 1;
    }
  }
  // Butterflies working their way up the field: two wings that open and
  // shut, big enough to see, white ones and blue ones.
  spots(layout, view, 1, 4, (x, y, i) => {
    if (i % 2 || layout.landAt(y) !== 'hot') return;
    const T = (t + i * 1300) % 7000, bx = x + R(18 * Math.sin(T / 900) + 5 * Math.sin(T / 230)), by = y - R(T / 7000 * 40) + R(3 * Math.sin(T / 170)) - oy;
    const open = Math.floor((t + i * 50) / 133) % 2;
    const wing = (i >> 1) % 2 ? '#fff8dc' : '#8cc6ee';
    c.fillStyle = 'rgba(28,52,64,0.3)'; c.fillRect(bx, by + 5, 3, 1);
    c.fillStyle = wing;
    if (open) { c.fillRect(bx - 2, by - 1, 2, 2); c.fillRect(bx + 1, by - 1, 2, 2); c.fillRect(bx - 1, by + 1, 1, 1); c.fillRect(bx + 1, by + 1, 1, 1); }
    else { c.fillRect(bx - 1, by - 2, 1, 3); c.fillRect(bx + 1, by - 2, 1, 3); }
    c.fillStyle = '#3a2a14'; c.fillRect(bx, by - 1, 1, 3);
  });
}

function wood(c, layout, view, t) {
  const oy = view.y0, cols = [RAMPS.wood.amber[3], RAMPS.wood.russet[2], RAMPS.wood.amber[4]];
  // Leaves coming down, a dozen or more in sight: slantwise, tumbling
  // through three shapes as they fall, their shadow waiting on the ground.
  spots(layout, view, 4, 3, (x, y, i) => {
    if (layout.landAt(y) !== 'warm') return;
    const life = 3000 + (i % 5) * 320, T = (t + i * 700) % life, drop = 56;
    const lx = x + R(life / 110);
    if (T > life - 600) { c.fillStyle = cols[1]; c.fillRect(lx, y - oy, 3, 1); c.fillRect(lx + 1, y - oy - 1, 1, 1); return; }
    const fx = x + R(T / 110 + 4 * Math.sin(T / 260 + i)), fy = y - drop + R(T / (life - 600) * drop);
    if (fy < view.lock) return;
    c.fillStyle = 'rgba(48,20,44,0.22)'; c.fillRect(lx, y - oy + 1, 3, 1);
    c.fillStyle = cols[i % 3];
    const turn = Math.floor(T / 170) % 3, yy = fy - oy;
    if (turn === 0) { c.fillRect(fx, yy, 3, 1); c.fillRect(fx + 1, yy - 1, 1, 1); }
    else if (turn === 1) { c.fillRect(fx, yy - 1, 1, 3); c.fillRect(fx + 1, yy, 1, 1); }
    else { c.fillRect(fx, yy, 2, 1); c.fillRect(fx + 1, yy + 1, 2, 1); }
    c.fillStyle = RAMPS.wood.amber[4]; c.fillRect(fx, yy, 1, 1);
  });
  // Deeper into the wood, fireflies.
  const deep = layout.stones[34] ? layout.stones[34].y : 0;
  spots(layout, view, 3, 6, (x, y, i) => {
    if (layout.landAt(y) !== 'warm' || y > deep) return;
    const T = (t + i * 800) % 3800;
    if (T > 2400) return;
    c.fillStyle = T % 800 < 480 ? '#fff0a0' : '#c89a2a';
    c.fillRect(x + R(6 * Math.sin(T / 800 + i)), y - oy + R(4 * Math.sin(T / 520 + i * 2)), 1, 1);
  });
}

function town(c, layout, view, t, items) {
  const oy = view.y0, T = RAMPS.town;
  for (const it of items) {
    const g = it.tag;
    if (!g || g.y < view.y0 - 4 || g.y > view.y1 + 30 || g.y < view.lock) continue;
    if (g.k === 'lamp') {
      // The lamp breathes: its glass a tone brighter, then its pool of light
      // a ring wider on the ground.
      const p = Math.floor((t + g.x * 37) / 500) % 4;
      if (p === 0) continue;
      c.fillStyle = T.lamp[4]; c.fillRect(g.x - 1, g.y - LAMP_TOP - 1 - oy, 3, 3);
      if (p >= 2) {
        c.fillStyle = 'rgba(255,214,120,0.2)';
        for (let j = -4; j <= 4; j++) { const half = R(22 * Math.sqrt(1 - (j * j) / 20)); c.fillRect(g.x - half, g.y + 1 + j * 2 - oy, half * 2, 2); }
      }
      if (p === 2) { c.fillStyle = 'rgba(255,236,170,0.45)'; c.fillRect(g.x - 5, g.y - LAMP_TOP - 3 - oy, 11, 1); c.fillRect(g.x - 5, g.y - LAMP_TOP + 3 - oy, 11, 1); }
    } else if (g.k === 'house') {
      const P = houseParts(g.x, g.y, g.w, g.h, g.seed, !!g.snowy);
      // Every lit window lives: a television's blue, a fire's flare, someone
      // crossing the room, each in its own time.
      P.wins.forEach((wn, k) => {
        if (!wn.lit) return;
        const f = Math.floor((t + g.x * 91 + k * 700) / 150) % (16 + (k * 5 + g.seed) % 9);
        if (f === 3 || f === 4) { c.fillStyle = 'rgba(255,255,255,0.45)'; c.fillRect(wn.x, wn.y - oy, wn.w, wn.h); }
        else if (f === 9 || f === 10) { c.fillStyle = 'rgba(30,34,80,0.55)'; c.fillRect(wn.x + (f === 9 ? 0 : 3), wn.y - oy, 2, wn.h); }
        else if (f === 13 && (k + g.seed) % 2) { c.fillStyle = 'rgba(120,170,255,0.5)'; c.fillRect(wn.x, wn.y - oy, wn.w, wn.h); }
      });
      // Smoke from the chimneys that have a fire under them: a column of
      // puffs that swell, lean with the wind and thin out.
      if (P.smoke) {
        const smoke = g.snowy ? [236, 242, 252] : [150, 162, 200];
        for (let i = 0; i < 5; i++) {
          const life = 3000, S = (t + i * 600 + g.x * 50) % life, u = S / life;
          const sz = u < 0.25 ? 2 : u < 0.6 ? 3 : 4;
          c.fillStyle = `rgba(${smoke[0]},${smoke[1]},${smoke[2]},${u > 0.7 ? 0.28 : u > 0.4 ? 0.5 : 0.8})`;
          const sx = P.chx + 1 + R(u * 12 + Math.sin(S / 350 + i) * 2), sy = P.chy - 2 - R(u * 26) - oy;
          c.fillRect(sx, sy, sz, sz - 1); c.fillRect(sx + 1, sy - 1, sz - 1, 1);
        }
      }
    } else if (g.k === 'fountain') {
      // The jet stands and falls; drops ring the basin.
      const f = Math.floor(t / 133) % 4;
      c.fillStyle = T.water[4];
      c.fillRect(g.x, g.y - 19 - (f % 2) - oy, 1, 2);
      c.fillRect(g.x - 3 - (f > 1 ? 1 : 0), g.y - 14 + f - oy, 1, 2); c.fillRect(g.x + 3 + (f > 1 ? 1 : 0), g.y - 14 + f - oy, 1, 2);
      c.fillRect(g.x - 8 + f * 2, g.y - 2 - oy, 2, 1); c.fillRect(g.x + 4 - f, g.y + 1 - oy, 2, 1);
      c.fillStyle = T.water[3]; c.fillRect(g.x - 6 - f, g.y - 6 + f - oy, 1, 1); c.fillRect(g.x + 6 + f, g.y - 6 + f - oy, 1, 1);
    }
  }
}

function climb(c, layout, view, t, items) {
  const oy = view.y0, W = layout.W, h = view.y1 - view.y0;
  // Snow, enough of it to be weather: small flakes far off and slow, big
  // ones near and quick, all leaning with a gust that comes and goes. A
  // white flake on white snow is nothing, so the small ones are the snow's
  // blue shade and the big ones carry a pixel of it underneath.
  const S = RAMPS.climb.snow, gust = 26 * Math.sin(t / 3800) + 9 * Math.sin(t / 900);
  for (let layer = 0; layer < 2; layer++) {
    const n = layer ? 30 : 44, speed = layer ? 58 : 32, drift = layer ? 16 : 9;
    for (let i = 0; i < n; i++) {
      const y = (hash(i * 7 + layer * 100) * h + t / 1000 * speed) % h;
      const row = view.y0 + y;
      if (row < view.lock || layout.landAt(row) !== 'alp') continue;
      const x = ((hash(i * 13 + layer * 31) * W + t / 1000 * drift + gust * (layer ? 1 : 0.5) + 3 * Math.sin(t / 700 + i)) % W + W) % W;
      const px = R(x), py = R(y);
      if (!layer) { c.fillStyle = i % 3 ? S[1] : S[4]; c.fillRect(px, py, 1, 1); continue; }
      c.fillStyle = S[0]; c.fillRect(px + 1, py + 1, 2, 1);
      c.fillStyle = S[4]; c.fillRect(px, py, 2, 2);
      if (i % 4 === 0) c.fillRect(px - 1, py, 4, 1);
    }
  }
  for (const it of items) {
    const g = it.tag;
    if (!g || g.y < view.y0 - 4 || g.y > view.y1 + 30 || g.y < view.lock) continue;
    if (g.k === 'tent') {
      // The lantern by the tent's door gutters.
      const f = Math.floor(t / 167) % 5;
      c.fillStyle = f === 2 ? RAMPS.climb.lantern[1] : f === 4 ? RAMPS.climb.lantern[4] : RAMPS.climb.lantern[2];
      c.fillRect(g.x + TENT_LAMP[0], g.y + TENT_LAMP[1] - oy, 1, 3);
    }
  }
  // Over the summit, a star falls now and then.
  if (layout.sky && view.y0 < layout.sky.y + 20) {
    const S = t % 9000;
    if (S < 600) {
      const x = R(W * 0.2 + S * 0.12), y = R(layout.sky.y - 40 + S * 0.05) - oy;
      for (let k = 0; k < 6; k++) { c.fillStyle = k === 0 ? '#ffffff' : k < 3 ? '#b8c4dc' : '#5a688e'; c.fillRect(x - k * 2, y - k, 1, 1); }
    }
  }
}

/* Light on the water: short dashes that slide along a brook or a stream. */
function water(c, layout, view, t) {
  const oy = view.y0;
  for (const w of layout.waters || []) {
    if (w.y < view.y0 - 12 || w.y > view.y1 + 12 || w.y < view.lock) continue;
    const ramp = w.land === 'warm' ? RAMPS.wood.water : RAMPS.meadow.water;
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

function ponds(c, view, t, items) {
  const oy = view.y0;
  for (const it of items) {
    const g = it.tag;
    if (!g || (g.k !== 'pond' && g.k !== 'tarn') || g.y < view.y0 - 8 || g.y > view.y1 + 8 || g.y < view.lock) continue;
    const f = Math.floor((t + g.x * 40) / 300) % 3, ramp = g.k === 'tarn' ? RAMPS.climb.ice : RAMPS.meadow.water;
    c.fillStyle = ramp[4];
    c.fillRect(g.x - 7 + f * 3, g.y - 1 - oy, 3, 1); c.fillRect(g.x + 2 - f * 2, g.y + 2 - oy, 2, 1);
  }
}

/** Draw one frame of ambient life. c: a canvas whose top row is board row
    view.y0; view: { y0, y1, dark, lock, current }; t: the clock in ms. */
export function drawAmbient(c, layout, view, t) {
  const lands = {};
  for (let y = view.y0; y < view.y1; y += 40) lands[layout.landAt(y)] = true;
  lands[layout.landAt(view.y1 - 1)] = true;
  const items = sceneOf(layout);
  if (lands.hot) meadow(c, layout, view, t, !!view.dark);
  if (lands.warm) wood(c, layout, view, t);
  if (lands.hot || lands.warm) water(c, layout, view, t);
  if (lands.town || lands.alp) town(c, layout, view, t, items);
  if (lands.alp) climb(c, layout, view, t, items);
  ponds(c, view, t, items);
}
