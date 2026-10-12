/* The line between the handler's hand and the dog's harness, on the same
   pixel grid as everything else. */

import { clamp, linePoints, pixelPath } from './core.js';
import { RAMPS } from './ramps.js';

/* One pixel wide, one rope colour, a slightly darker knot every 5 px, stepped on the
   grid. Its length is fixed: when the hand and the harness are that far
   apart it is taut and straight; closer, it hangs in a curve, and any length
   left over lies on the ground. The low point stays in the gap between the
   handler and the dog, so the rope never crosses the dog. */

export const LINE = { colour: RAMPS.kit.line[2], knot: RAMPS.kit.line[1] };

/** a: the hand, b: the harness ring, len: the line's length, ground: the
    ground row, gap: [x, x] the low point must stay within, via: where the line
    crosses the croup (optional): from there it runs straight along just above
    the back into the ring. Returns { taut, top }: top is the last stretch into
    the ring, for drawing again over the dog. wave: 0..1 or null: where a
    tug from the dog has got to on its way down a taut line to the hand,
    shown as a pixel's lift that travels. */
export function drawLine(c, a, b, len, ground, gap, via, wave) {
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
  if (taut && wave != null && px.length > 8) {
    const at = Math.round((1 - wave) * (px.length - 1));
    for (let i = Math.max(1, at - 2); i <= Math.min(px.length - 2, at + 2); i++) px[i] = [px[i][0], px[i][1] - 1];
  }
  const top = via ? linePoints(via[0], via[1], b[0], b[1]).slice(1) : [];
  const all = px.concat(top);
  paintRope(c, all, 0);
  return { taut, top: top.slice(-4, -1), count: all.length };
}

export function paintRope(c, pts, from) {
  pts.forEach((p, i) => {
    c.fillStyle = (i + from) % 5 === 2 ? LINE.knot : LINE.colour;
    c.fillRect(p[0], p[1], 1, 1);
  });
}
