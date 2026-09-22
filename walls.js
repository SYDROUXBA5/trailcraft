/* Buildings, as walls the drifting scent cannot pass through.

   At nose height scent is carried by air, and air does not go through a
   building: it goes round the ends and over the roof. The roof is well above
   a dog's nose, so here a building is a wall. The map already carries every
   building outline it has drawn; this turns those outlines into something a
   moving parcel can hit.

   Two parts, kept apart because they are not equally sure:
   - The wall itself. Certain, and always on: a step that would carry scent
     into a building stops just short of it and slides along the wall, which
     over a few steps takes it round the corner.
   - The sheltered pocket behind a building. The shape is well established —
     air slows and curls back towards the downwind wall — but how big and how
     strong it is here is a guess, so it is a dial that ships switched off
     (params.js, wakeSlow = 1).

   Used only for what is DRAWN. The grading calls driftFrom without walls, so
   no score moves because a building appeared on the map.

   Pure: no map, no network. Everything inside works in metres on a local
   flat earth around the first point it was given. */

const CELL = 16;                     // metres per bucket of the spatial index
const KY = 111320;                   // metres per degree of latitude
const GAP = 0.3;                     // how far short of a wall a stopped step waits
const HEAD_ON = 0.2;                 // along-the-wall share below which a hit counts as square on
const key = (ix, iy) => ix * 131071 + iy;

const toXY = (W, p) => [(p.lon - W.ref.lon) * W.kx, (p.lat - W.ref.lat) * KY];
const toLL = (W, x, y) => ({ lat: W.ref.lat + y / KY, lon: W.ref.lon + x / W.kx });

function addToGrid(grid, id, x0, y0, x1, y1) {
  for (let ix = Math.floor(x0 / CELL); ix <= Math.floor(x1 / CELL); ix++) {
    for (let iy = Math.floor(y0 / CELL); iy <= Math.floor(y1 / CELL); iy++) {
      const k = key(ix, iy);
      let a = grid.get(k);
      if (!a) grid.set(k, a = []);
      a.push(id);
    }
  }
}

/**
 * Building outlines → a searchable set of walls.
 * @param {Array<{rings: number[][][], h: number|null}>} list  rings of [lon, lat]
 * @param {{lat: number, lon: number}} ref  where the local metres are measured from
 */
export function wallIndex(list, ref) {
  if (!list?.length || !ref) return null;
  const kx = KY * Math.cos((ref.lat * Math.PI) / 180);
  const W = { ref: { lat: ref.lat, lon: ref.lon }, kx, walls: [], grid: new Map(), lee: null, mark: null, stamp: 0 };
  for (const w of list) {
    const rings = (w.rings ?? []).map(r => r.map(([lon, lat]) => [(lon - ref.lon) * kx, (lat - ref.lat) * KY]))
      .filter(r => r.length >= 3);
    if (!rings.length) continue;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const r of rings) for (const [x, y] of r) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    if (!(x1 > x0 && y1 > y0)) continue;
    const id = W.walls.length;
    W.walls.push({ rings, box: [x0, y0, x1, y1], h: Number.isFinite(w.h) && w.h > 0 ? w.h : null });
    addToGrid(W.grid, id, x0, y0, x1, y1);
  }
  if (!W.walls.length) return null;
  W.mark = new Int32Array(W.walls.length);
  return W;
}

/** Even-odd across every ring, so courtyards are open ground. */
function insideRings(rings, x, y) {
  let hit = false;
  for (const r of rings) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i], [xj, yj] = r[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
    }
  }
  return hit;
}

/**
 * A point inside a building, moved to just outside its nearest wall.
 *
 * A trail point inside a footprint is a walker on the pavement beside it
 * whom GPS, or a line drawn by finger, put a few metres out. Their scent
 * starts where they really were, and every wall applies to it from there.
 * (The first version let such scent ignore that building for its whole
 * flight instead; in a town, where a line drawn along a street clips houses,
 * that let about a fifth of the drawn cloud fly through them.)
 */
export function outside(W, p) {
  if (!W || !p) return p;
  let id = wallAt(W, p);
  if (id < 0) return p;
  let [x, y] = toXY(W, p);
  for (let tries = 0; tries < 3 && id >= 0; tries++) {        // a terrace: out of one, into the next
    let best = null;
    for (const r of W.walls[id].rings) {
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const ax = r[j][0], ay = r[j][1], sx = r[i][0] - ax, sy = r[i][1] - ay;
        const L2 = sx * sx + sy * sy;
        if (!L2) continue;
        const u = Math.max(0, Math.min(1, ((x - ax) * sx + (y - ay) * sy) / L2));
        const qx = ax + u * sx, qy = ay + u * sy, d = Math.hypot(qx - x, qy - y);
        if (!best || d < best.d) best = { d, qx, qy, nx: -sy / Math.sqrt(L2), ny: sx / Math.sqrt(L2) };
      }
    }
    if (!best) break;
    let ox = best.qx - x, oy = best.qy - y;
    const ol = Math.hypot(ox, oy);
    if (ol > 1e-6) { ox /= ol; oy /= ol; }
    else {                                                   // exactly on the wall: go out along its normal
      ox = best.nx; oy = best.ny;
      if (wallAt(W, toLL(W, best.qx + ox * GAP, best.qy + oy * GAP)) === id) { ox = -ox; oy = -oy; }
    }
    x = best.qx + ox * GAP * 2;
    y = best.qy + oy * GAP * 2;
    id = wallAt(W, toLL(W, x, y));
  }
  if (id < 0) return toLL(W, x, y);
  /* Still inside: the map draws building parts as outlines inside other
     outlines, and stepping out of one can land in the next. Search outwards
     from the original point for the nearest open ground instead. */
  const [x0, y0] = toXY(W, p);
  for (const r of [1, 2, 3, 5, 8, 12, 18, 25, 35, 50]) {
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * 2 * Math.PI;
      const q = toLL(W, x0 + r * Math.cos(a), y0 + r * Math.sin(a));
      if (wallAt(W, q) < 0) return q;
    }
  }
  return toLL(W, x, y);                                      // nothing open within 50 m: leave it
}

/** Which building a point is inside, or -1. */
export function wallAt(W, p) {
  if (!W || !p) return -1;
  const [x, y] = toXY(W, p);
  const ids = W.grid.get(key(Math.floor(x / CELL), Math.floor(y / CELL)));
  if (!ids) return -1;
  for (const id of ids) {
    const b = W.walls[id].box;
    if (x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3] && insideRings(W.walls[id].rings, x, y)) return id;
  }
  return -1;
}

/* The earliest place a straight move from (ax, ay) to (bx, by) meets a wall
   edge, as a share `t` of the move plus the edge's direction. Every edge is
   checked, not just where the move ends: a ten-metre step would otherwise
   jump clean over a five-metre-deep building. */
function firstHit(W, ax, ay, bx, by, skip) {
  const st = ++W.stamp;
  const dx = bx - ax, dy = by - ay;
  const lo = [Math.min(ax, bx), Math.min(ay, by)], hi = [Math.max(ax, bx), Math.max(ay, by)];
  let best = null;
  for (let ix = Math.floor(lo[0] / CELL); ix <= Math.floor(hi[0] / CELL); ix++) {
    for (let iy = Math.floor(lo[1] / CELL); iy <= Math.floor(hi[1] / CELL); iy++) {
      const ids = W.grid.get(key(ix, iy));
      if (!ids) continue;
      for (const id of ids) {
        if (id === skip || W.mark[id] === st) continue;
        W.mark[id] = st;
        const b = W.walls[id].box;
        if (hi[0] < b[0] || lo[0] > b[2] || hi[1] < b[1] || lo[1] > b[3]) continue;
        for (const r of W.walls[id].rings) {
          for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
            const px = r[j][0], py = r[j][1], sx = r[i][0] - px, sy = r[i][1] - py;
            const den = dx * sy - dy * sx;
            if (Math.abs(den) < 1e-12) continue;           // parallel: it cannot cross
            const qx = px - ax, qy = py - ay;
            const t = (qx * sy - qy * sx) / den;
            const u = (qx * dy - qy * dx) / den;
            if (t < 0 || t > 1 || u < 0 || u > 1) continue;
            if (!best || t < best.t) {
              const el = Math.hypot(sx, sy);
              best = { t, ex: sx / el, ey: sy / el, id };
            }
          }
        }
      }
    }
  }
  return best;
}

/**
 * One step of drifting scent, with the buildings in the way.
 * A step that would enter a building stops just short of the wall, and the
 * rest of it goes along the wall. `skip` is a building the step is allowed
 * to cross — the one a trail point sits inside, when GPS has put the line
 * through a wall. That building must not trap its own scent.
 *
 * `slide` is how much of a blocked step still moves along the wall. A
 * glancing hit keeps its own along-the-wall share; a head-on hit has none,
 * and on its own would pin the scent to the wall for ever. Real air meeting
 * a face splits and runs round both ends, so a head-on hit is sent towards
 * the nearer end of the building at `slide` of the step.
 */
export function blockStep(W, from, to, skip = -1, slide = 0.6) {
  if (!W) return to;
  const [ax, ay] = toXY(W, from), [bx, by] = toXY(W, to);
  const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
  if (len < 1e-6) return to;
  const hit = firstHit(W, ax, ay, bx, by, skip);
  if (!hit) return to;
  const back = Math.max(0, hit.t - GAP / len);
  const hx = ax + dx * back, hy = ay + dy * back;
  /* What is left of the step, kept only along the wall. */
  const rem = len * (1 - back);
  let along = (dx * hit.ex + dy * hit.ey) * (1 - back);
  if (Math.abs(along) < rem * HEAD_ON) {
    /* Head-on, within about 12 degrees of square: split at the building,
       towards the side of it this step is on, across the direction of travel. */
    const b = W.walls[hit.id].box;
    const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
    const nx = -dy / len, ny = dx / len;
    const side = (hx - cx) * nx + (hy - cy) * ny >= 0 ? 1 : -1;
    along = rem * slide * side * (hit.ex * nx + hit.ey * ny >= 0 ? 1 : -1);
  } else if (Math.abs(along) < rem * slide) {
    /* A glancing hit keeps its own direction, moving at least `slide`. */
    along = Math.sign(along) * rem * slide;
  }
  let sx = hit.ex * along, sy = hit.ey * along;
  const sl = Math.hypot(sx, sy);
  if (sl > 1e-6) {
    const again = firstHit(W, hx, hy, hx + sx, hy + sy, skip);   // a neighbour in a terrace
    if (again) { const k = Math.max(0, again.t - GAP / sl); sx *= k; sy *= k; }
  }
  return toLL(W, hx + sx, hy + sy);
}

/* ── The sheltered pocket behind a building ──────────────────────────
   Laid out along the forecast wind: each building throws a pocket from its
   most downwind point, as wide as the building is across the wind and as
   long as `len` building heights. A rotated building is treated as the
   box it makes across the wind — a simplification, like everything here. */
function leeOf(W, going, len, hDef) {
  const g = ((Math.round(going) % 360) + 360) % 360;
  const tag = `${g}|${len}|${hDef}`;
  if (W.lee?.tag === tag) return W.lee;
  const r = (g * Math.PI) / 180;
  const wx = Math.sin(r), wy = Math.cos(r);           // where the air goes, x east, y north
  const nx = wy, ny = -wx;                              // across it
  const zones = new Array(W.walls.length), grid = new Map();
  W.walls.forEach((w, id) => {
    let a1 = -Infinity, c0 = Infinity, c1 = -Infinity;
    for (const ring of w.rings) for (const [x, y] of ring) {
      const a = x * wx + y * wy, c = x * nx + y * ny;
      if (a > a1) a1 = a;
      if (c < c0) c0 = c;
      if (c > c1) c1 = c;
    }
    const L = len * (w.h ?? hDef);
    zones[id] = { a1, c0, c1, L };
    const xs = [], ys = [];
    for (const a of [a1, a1 + L]) for (const c of [c0, c1]) { xs.push(a * wx + c * nx); ys.push(a * wy + c * ny); }
    addToGrid(grid, id, Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
  });
  W.lee = { tag, wx, wy, nx, ny, zones, grid };
  return W.lee;
}

/**
 * How much of the wind is left at a point: 1 in open air, down to `slow`
 * right against a building's downwind wall, recovering to 1 at the end of
 * the pocket. `going` is where the air goes, in degrees.
 */
export function leeFactor(W, p, going, len, slow, hDef) {
  if (!W || !(slow < 1) || !(len > 0)) return 1;
  const L = leeOf(W, going, len, hDef);
  const [x, y] = toXY(W, p);
  const ids = L.grid.get(key(Math.floor(x / CELL), Math.floor(y / CELL)));
  if (!ids) return 1;
  let k = 1;
  const a = x * L.wx + y * L.wy, c = x * L.nx + y * L.ny;
  for (const id of ids) {
    const z = L.zones[id];
    if (c < z.c0 || c > z.c1 || a <= z.a1 || a > z.a1 + z.L) continue;
    const depth = (a - z.a1) / z.L;                   // 0 at the wall, 1 at the pocket's end
    const f = slow + (1 - slow) * depth * depth;
    if (f < k) k = f;
  }
  return k;
}

/**
 * Where the drawn band's centre runs through buildings. The band is a
 * straight-line estimate and cannot bend round them; this says where it
 * does not, instead of pretending. Returns how many buildings, and the
 * stretches of centre line inside them.
 */
export function bandInWalls(W, field) {
  const out = { count: 0, pieces: [] };
  if (!W || !field?.length) return out;
  const hit = new Set();
  let run = null;
  for (const f of field) {
    const id = wallAt(W, f.centre);
    if (id >= 0) {
      hit.add(id);
      if (!run) out.pieces.push(run = []);
      run.push(f.centre);
    } else {
      run = null;
    }
  }
  out.pieces = out.pieces.filter(p => p.length > 1);
  out.count = hit.size;
  return out;
}
