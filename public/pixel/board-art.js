/* The board as a picture: any band of its rows, painted the same way
   whichever tile asks, plus the locked land beyond a boss and the dusk. */

import { bayer, clamp, ctx2d, disc, makeCanvas, OUTLINE, R, stamp } from './core.js';
import { ICONS, stoneArt, stoneInk } from './stones.js';
import { trailPoint } from './layout.js';
import { BOARD_LANDS } from './scenery.js';
import { drawBarrier } from './landmarks.js';
import { sceneOf } from './scene.js';
import { paintGround, paintTrail } from './ground.js';
import { vnoise } from './terrain.js';

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
  paintGround(c, layout, y0, y1, { aurora: state.aurora !== false });
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
    const land = layout.landAt(s.y);
    stoneArt(c, s.x, s.y, status, land);
    const icon = status === 'passed' ? ICONS.paw : ICONS[(state.icons || {})[s.level]] || ICONS.ruler;
    // An icon is cut into the stone, not stuck on it: ahead, it is the
    // rock's own ink; reached, it is rimmed in that ink and not in black.
    const ink = stoneInk(land, 'ahead');
    const pal = status === 'ahead' ? { w: ink, d: 'rgba(0,0,0,0)', g: ink } : status === 'passed' ? { g: '#ffd24a' } : { d: '#5b4636' };
    stamp(c, icon, s.x - 3, s.y - 4, pal, status === 'ahead' ? 'rgba(0,0,0,0)' : stoneInk(land, status));
    if (status === 'passed') { c.fillStyle = '#fff6c8'; c.fillRect(s.x - 1, s.y - 4, 1, 1); c.fillRect(s.x - 2, s.y - 1, 1, 1); c.fillRect(s.x, s.y, 2, 1); }
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
  const dusk = [74, 58, 92], mist = [214, 204, 222], haze = [150, 138, 170];
  for (let r = 0; r < h; r++) {
    const y = y0 + r;
    if (y >= line) break;
    /* Mist lying above the line in banks: solid shapes with a paler heart,
       thickest a little way up and thinning over forty rows. A flat half-tone
       band was a screen door across the board. */
    const up = line - y, m = up > 44 ? 0 : up < 6 ? 0.34 + up * 0.04 : 0.58 * (1 - (up - 6) / 38);
    for (let x = 0; x < W; x++) {
      const i = (r * W + x) * 4;
      if (!d[i + 3]) continue;
      for (let k = 0; k < 3; k++) d[i + k] = R(d[i + k] * 0.62 + dusk[k] * 0.38);
      if (m <= 0) continue;
      const n = vnoise(x * 0.42, y, 7, 71) * 0.7 + vnoise(x * 0.9 + 40, y * 1.6, 4, 72) * 0.3;
      if (n < m) { const c = n < m - 0.16 ? mist : haze; for (let k = 0; k < 3; k++) d[i + k] = R(d[i + k] * (n < m - 0.16 ? 0.3 : 0.55) + c[k] * (n < m - 0.16 ? 0.7 : 0.45)); }
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
