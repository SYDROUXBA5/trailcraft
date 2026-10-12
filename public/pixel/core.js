/* The pixel grid's tools: colour maths, seeded noise, small canvases, the
   sprite baker and the shapes everything else is drawn with. Nothing here
   knows what a dog or a tree is.

   Everything is drawn at art size (1 unit = 1 art pixel) into a small buffer,
   then copied up by a whole number of device pixels with smoothing off. */

export const R = Math.round;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(v => clamp(R(v), 0, 255).toString(16).padStart(2, '0')).join('');
}

export function mix(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return rgbToHex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
}

export const darker = (c, t = 0.3) => mix(c, '#140c08', t);

export const lighter = (c, t = 0.2) => mix(c, '#ffffff', t);

/** A repeatable 0..1 number from an integer: the same scatter on every phone. */
export function hash(n) {
  n = (n | 0) ^ 0x9e3779b9;
  n = Math.imul(n ^ (n >>> 16), 0x85ebca6b);
  n = Math.imul(n ^ (n >>> 13), 0xc2b2ae35);
  n ^= n >>> 16;
  return (n >>> 0) / 4294967296;
}

export function seeded(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

export function ctx2d(c) {
  const x = c.getContext('2d');
  x.imageSmoothingEnabled = false;
  return x;
}

/** Integer points of a straight line (Bresenham). */
export function linePoints(x0, y0, x1, y1) {
  x0 = R(x0); y0 = R(y0); x1 = R(x1); y1 = R(y1);
  const pts = [];
  const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (let guard = 0; guard < 2000; guard++) {
    pts.push([x0, y0]);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
  return pts;
}

/** A limb or neck: a stepped line `w` pixels thick, on the grid. */
export function thick(c, a, b, w, col) {
  c.fillStyle = col;
  const steep = Math.abs(b[1] - a[1]) >= Math.abs(b[0] - a[0]);
  const off = -Math.floor((w - 1) / 2);
  for (const p of linePoints(a[0], a[1], b[0], b[1])) {
    if (steep) c.fillRect(p[0] + off, p[1], w, 1);
    else c.fillRect(p[0], p[1] + off, 1, w);
  }
}

/** A connected one-pixel path through float points, with the L-shaped
    corners taken out so a curve reads as clean pixel art. */
export function pixelPath(points) {
  const raw = [];
  for (let i = 0; i < points.length - 1; i++) {
    const seg = linePoints(points[i][0], points[i][1], points[i + 1][0], points[i + 1][1]);
    for (let j = raw.length ? 1 : 0; j < seg.length; j++) raw.push(seg[j]);
  }
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const a = out[out.length - 1], b = raw[i], c = raw[i + 1];
    if (a && a[0] === b[0] && a[1] === b[1]) continue;
    if (a && c && a[0] !== c[0] && a[1] !== c[1] &&
        Math.abs(a[0] - c[0]) === 1 && Math.abs(a[1] - c[1]) === 1) continue;
    out.push(b);
  }
  return out;
}

export function disc(c, cx, cy, r, col) {
  c.fillStyle = col;
  for (let y = -r; y <= r; y++) {
    const half = Math.floor(Math.sqrt(r * r - y * y + r * 0.8));
    c.fillRect(cx - half, cy + y, half * 2 + 1, 1);
  }
}

export function ellipse(c, cx, cy, rx, ry, col) {
  c.fillStyle = col;
  for (let y = -ry; y <= ry; y++) {
    const half = Math.floor(rx * Math.sqrt(Math.max(0, 1 - (y * y) / ((ry + 0.5) * (ry + 0.5)))));
    c.fillRect(cx - half, cy + y, half * 2 + 1, 1);
  }
}

export const OUTLINE = '#1c1411';

export const STAGES = {
  hot: { id: 'hot', name: 'Hot', colour: '#BE3F2E', light: '#E2604C' },
  warm: { id: 'warm', name: 'Warm', colour: '#D0821F', light: '#EDA548' },
  cold: { id: 'cold', name: 'Cold', colour: '#3B8BD6', light: '#6AAEEA' },
};

/* One character per pixel; '.' is clear. Letters are palette slots, and a
   capital is its slot one shade darker. Fixed slots: e eye, k harness ring,
   h/H harness (the stage colour), w cream, g/G gold, d dark. */

export const FIXED = { e: '#1c1411', k: '#e9eef2', l: '#ffe4bd', w: '#f7f1de', W: '#c9c0a6', d: '#3a2e26', g: '#f2c14e', G: '#b8861b', x: '#ffffff', o: OUTLINE };

const baked = new Map();

function colourFor(ch, pal) {
  if (pal && pal[ch]) return pal[ch];
  const lo = ch.toLowerCase();
  if (ch !== lo && pal && pal[lo]) return darker(pal[lo], 0.28);
  return FIXED[ch] || null;
}

/** A sprite turned into a little canvas once, then copied every frame. */
export function bake(rows, pal, key) {
  let c = baked.get(key);
  if (c) return c;
  c = makeCanvas(rows[0].length, rows.length);
  const x = ctx2d(c);
  for (let y = 0; y < rows.length; y++) {
    for (let i = 0; i < rows[y].length; i++) {
      const ch = rows[y][i];
      if (ch === '.') continue;
      const col = colourFor(ch, pal);
      if (!col) continue;
      x.fillStyle = col;
      x.fillRect(i, y, 1, 1);
    }
  }
  baked.set(key, c);
  return c;
}

/** Draw a baked sprite, mirrored when `flip`. */
export function blit(c, img, x, y, flip) {
  if (!flip) { c.drawImage(img, R(x), R(y)); return; }
  c.save();
  c.translate(R(x) + img.width, R(y));
  c.scale(-1, 1);
  c.drawImage(img, 0, 0);
  c.restore();
}

/** A sprite with its own dark rim, drawn straight onto the scene (icons, digits). */
export function stamp(c, rows, x, y, pal, rim = OUTLINE) {
  c.fillStyle = rim;
  for (let j = 0; j < rows.length; j++) {
    for (let i = 0; i < rows[j].length; i++) {
      if (rows[j][i] === '.') continue;
      c.fillRect(x + i - 1, y + j, 1, 1); c.fillRect(x + i + 1, y + j, 1, 1);
      c.fillRect(x + i, y + j - 1, 1, 1); c.fillRect(x + i, y + j + 1, 1, 1);
    }
  }
  for (let j = 0; j < rows.length; j++) {
    for (let i = 0; i < rows[j].length; i++) {
      const ch = rows[j][i];
      if (ch === '.') continue;
      c.fillStyle = colourFor(ch, pal) || '#ff00ff';
      c.fillRect(x + i, y + j, 1, 1);
    }
  }
}

/* Two scratch canvases put the dark rim round a whole character at once. */
let scratchA = null, scratchB = null;

function scratch(w, h) {
  if (!scratchA || scratchA.width < w || scratchA.height < h) {
    scratchA = makeCanvas(w, h); scratchB = makeCanvas(w, h);
  }
  const a = ctx2d(scratchA), b = ctx2d(scratchB);
  a.setTransform(1, 0, 0, 1, 0, 0); a.clearRect(0, 0, scratchA.width, scratchA.height);
  b.setTransform(1, 0, 0, 1, 0, 0); b.clearRect(0, 0, scratchB.width, scratchB.height);
  return [a, b];
}

export function outlined(dst, w, h, draw, rim = OUTLINE) {
  const [a, b] = scratch(w, h);
  draw(a);
  b.globalCompositeOperation = 'source-over';
  b.drawImage(scratchA, 0, 0);
  b.globalCompositeOperation = 'source-in';
  b.fillStyle = rim;
  b.fillRect(0, 0, scratchB.width, scratchB.height);
  b.globalCompositeOperation = 'source-over';
  dst.drawImage(scratchB, -1, 0); dst.drawImage(scratchB, 1, 0);
  dst.drawImage(scratchB, 0, -1); dst.drawImage(scratchB, 0, 1);
  dst.drawImage(scratchA, 0, 0);
}

export function shadow(c, cx, gy, w) {
  c.fillStyle = 'rgba(20,16,10,0.22)';
  c.fillRect(cx - (w >> 1) + 1, gy + 1, w - 2, 1);
  c.fillRect(cx - (w >> 1) + 3, gy + 2, w - 6, 1);
}

/** Knock pixels out of a layer in an ordered dither: a fade that stays on the grid. */
export function ditherOut(c, x0, y0, w, h, amount) {
  if (amount <= 0) return;
  c.save();
  c.globalCompositeOperation = 'destination-out';
  c.fillStyle = '#000';
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (bayer(x, y) < amount) c.fillRect(x, y, 1, 1);
  c.restore();
}

export function bayer(x, y) {
  const m = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  return (m[(y & 3) * 4 + (x & 3)] + 0.5) / 16;
}

/** A mass of leaves, or a boulder, or a drift: an ellipse shaded from the
    upper left in the ramp's tones, the light and shade broken into clumps
    rather than bands, with a dark edge on the side away from the light and
    underneath only. `seed` makes each one its own. */
export function clump(c, cx, cy, rx, ry, ramp, seed = 0, o) {
  const rough = o && o.rough != null ? o.rough : 0.3;
  for (let y = -ry - 1; y <= ry + 1; y++) {
    for (let x = -rx - 1; x <= rx + 1; x++) {
      const nx = x / (rx + 0.5), ny = y / (ry + 0.5);
      // A ragged edge: the outline wanders by a pixel.
      const wob = 1 + 0.16 * Math.sin((x + seed) * 1.9 + y * 0.7) * rough / 0.3;
      const d = (nx * nx + ny * ny) / wob;
      if (d > 1) continue;
      const lit = -(nx * 0.62 + ny * 0.78) + rough * Math.sin((x + seed * 3) * 0.9 + 1) * Math.cos((y - seed) * 1.1);
      let tone = lit > 0.62 ? 3 : lit > 0.05 ? 2 : 1;
      if (d > 0.74 && nx * 0.6 + ny * 0.8 > 0.12) tone = 0;
      else if (tone === 3 && lit > 0.98 && rough > 0.2) tone = 4;
      c.fillStyle = ramp[tone];
      c.fillRect(cx + x, cy + y, 1, 1);
    }
  }
}
