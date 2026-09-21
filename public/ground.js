/* What the ground is, along a trail.

   Scent does not lie on tarmac the way it lies on grass, and a handler wants
   to know how much of each a trail crossed. The map's own data already knows
   most of it: woods, grass, fields, buildings, car parks, and the roads with
   their class. This module turns that into one letter per point and a total
   in metres per surface.

   It is a reading of a MAP, not of the ground. A concrete farm track nobody
   drew is a field here, and a pavement beside a verge is whichever the GPS
   happened to favour. The totals are honest to a few metres in the places
   the map is good, and say "not mapped" where it is not.

   Pure: no DOM, no map, no network. The app fetches the tiles; this reads
   them. */

import { dist } from './geo.js';

/** Letter and name. Nothing here says what a surface does to scent.

    It used to: hard ground carried `spread: 0.5`, one number doing five
    different jobs — how far scent is carried, how strongly it draws, how
    wide the pools are, how long it lasts, and (wrongly) how sure the band
    is. That was a trainer's working rule applied to every run by default.
    Now a point on tarmac is only MARKED as tarmac, and what that does is
    five separate dials on the bench (params.js), each at 1 — so an unproven
    rule changes nothing until someone chooses to try it. */
export const SURFACES = [
  { id: 'w', label: 'Woods' },
  { id: 's', label: 'Scrub' },
  { id: 'g', label: 'Grass' },
  { id: 'c', label: 'Crop & field' },
  { id: 'h', label: 'Hard surface' },
  { id: 'a', label: 'Water' },
  { id: 'u', label: 'Not mapped' },
];
const BY_ID = new Map(SURFACES.map(s => [s.id, s]));
export const surfaceById = (id) => BY_ID.get(id) ?? BY_ID.get('u');
export const isHard = (id) => id === 'h';

/** Which rules read the ground. Stored with every reading, so a run read
    under old rules is shown for what it is instead of being quietly
    rewritten the next time someone looks at it. */
export const GROUND_V = 2;
export const GROUND_RULES = {
  1: 'Blank map, built-up areas (houses, schools, industry) and buildings were all counted as hard surface.',
  2: 'Only what the map draws as sealed (roads, paved paths, car parks) is hard. Blank map is Not mapped; built-up areas and buildings are surroundings, not ground.',
};

/** Which layers and properties the app must ask the tiles for. */
export const GROUND_LAYERS = {
  streets: { landuse: ['class'], road: ['class', 'type', 'surface', 'structure'], building: [], water: [] },
  terrain: { landcover: ['class'] },
};

/* What the ground is made of, where the map actually says. */
const GREEN = { wood: 'w', scrub: 's', grass: 'g', park: 'g', pitch: 'g', cemetery: 'g', agriculture: 'c' };
const SEALED_USE = new Set(['parking']);
/* What surrounds the trail, which is a different question. A "residential"
   area is a boundary drawn round houses, gardens, lawns and drives: it says
   the trail went through a town, not what the ground underfoot was made of.
   Rules v1 read these as tarmac, which filled every gap in the map with a
   guess — the one thing the spec forbids. */
const ZONES = new Set(['residential', 'commercial_area', 'industrial', 'airport',
  'hospital', 'school', 'facility']);
const COVER = { wood: 'w', scrub: 's', grass: 'g', crop: 'c' };

/* Half the width of the sealed ground a road stands for, in metres: the
   carriageway and the pavement beside it, plus a little for the GPS. Roads
   arrive as centre lines with no width, so this is the width. */
const ROAD_HALF = {
  motorway: 12, motorway_link: 8, trunk: 10, trunk_link: 7.5,
  primary: 8.5, primary_link: 7, secondary: 7.5, secondary_link: 6.5,
  tertiary: 7, tertiary_link: 6.5, street: 6.5, street_limited: 6, service: 4, pedestrian: 5,
};
const PAVED_PATHS = new Set(['sidewalk', 'crossing', 'steps', 'platform']);
const PATH_HALF = 3.5;

/** Is this line sealed ground, and how wide? 0 = not a hard surface. */
function hardHalf(p) {
  if (p.structure === 'tunnel') return 0;                 // it is under the ground, not on it
  if (ROAD_HALF[p.class]) return p.surface === 'unpaved' ? 0 : ROAD_HALF[p.class];
  if (p.class === 'path' || p.class === 'track') {
    return p.surface === 'paved' || PAVED_PATHS.has(p.type) ? PATH_HALF : 0;
  }
  return 0;
}

const bboxOf = (rings, pad = 0) => {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const r of rings) for (const [x, y] of r) {
    if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y;
  }
  return [w - pad, s - pad, e + pad, n + pad];
};

/**
 * Decoded tiles → one searchable ground.
 * @param {Array<object>} tiles  results of mvt.decodeTile, streets and terrain
 *        tiles mixed, each carrying `kind: 'streets' | 'terrain'` and
 *        `box: [w, s, e, n]` — the ground it speaks for.
 */
export function buildGround(tiles) {
  const areas = [], lines = [], zones = [], boxes = { streets: [], terrain: [] };
  for (const t of tiles || []) {
    if (t.box && boxes[t.kind]) boxes[t.kind].push(t.box);
    for (const f of t.landuse || []) {
      if (f.type !== 3) continue;
      const cls = f.props.class;
      const as = GREEN[cls] ?? (SEALED_USE.has(cls) ? 'h' : null);
      if (as) areas.push({ rank: GREEN[cls] ? 3 : 4, as, rings: f.geom, box: bboxOf(f.geom) });
      if (ZONES.has(cls)) zones.push({ rings: f.geom, box: bboxOf(f.geom) });
    }
    /* A building is something the trail went past, not ground it was laid on.
       A fix inside one is GPS drift against a wall, and what was underfoot
       there is not known. */
    for (const f of t.building || []) if (f.type === 3) zones.push({ rings: f.geom, box: bboxOf(f.geom) });
    for (const f of t.water || []) if (f.type === 3) areas.push({ rank: 1, as: 'a', rings: f.geom, box: bboxOf(f.geom) });
    for (const f of t.landcover || []) {
      if (f.type === 3 && COVER[f.props.class]) areas.push({ rank: 5, as: COVER[f.props.class], rings: f.geom, box: bboxOf(f.geom) });
    }
    for (const f of t.road || []) {
      const half = hardHalf(f.props);
      if (!half) continue;
      if (f.type === 3) { areas.push({ rank: 0, as: 'h', rings: f.geom, box: bboxOf(f.geom) }); continue; }   // a paved square
      if (f.type !== 2) continue;
      // ~0.00018° is 20 m of latitude and more than 12 m of longitude anywhere people train.
      for (const line of f.geom) lines.push({ half, pts: line, box: bboxOf([line], 0.00018) });
    }
  }
  areas.sort((a, b) => a.rank - b.rank);
  return { areas, lines, zones, boxes };
}

/** Even-odd across every ring, so holes and multi-part areas need no sorting out. */
function inside(rings, x, y) {
  let hit = false;
  for (const r of rings) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i], [xj, yj] = r[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
    }
  }
  return hit;
}

/** Metres from a point to a line of [lon, lat], on a local flat earth. */
function metresTo(line, lat, lon) {
  const ky = 111320, kx = 111320 * Math.cos((lat * Math.PI) / 180);
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const ax = (line[i - 1][0] - lon) * kx, ay = (line[i - 1][1] - lat) * ky;
    const bx = (line[i][0] - lon) * kx, by = (line[i][1] - lat) * ky;
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    const d = Math.hypot(ax + t * dx, ay + t * dy);
    if (d < best) best = d;
  }
  return best;
}

const within = (box, lon, lat) => lon >= box[0] && lon <= box[2] && lat >= box[1] && lat <= box[3];

/** The surface under one point. Sealed roads first — a lane through a wood is
    still tarmac, and a bridge is not the river under it — then what the map
    has drawn, most specific first, then the coarse land cover. */
export function surfaceAt(ground, pt) {
  if (!ground) return 'u';
  const { lat, lon } = pt;
  for (const l of ground.lines) {
    if (within(l.box, lon, lat) && metresTo(l.pts, lat, lon) <= l.half) return 'h';
  }
  for (const a of ground.areas) {
    if (within(a.box, lon, lat) && inside(a.rings, lon, lat)) return a.as;
  }
  /* Nothing drawn here. It might be a yard, a lawn, a farm track or a
     square; the map does not say, so neither does this. */
  return 'u';
}

/* ── Conditions: what the handler SAW ────────────────────────────────
   The third kind of ground fact, and the only one a person supplies. The
   map says what the ground is made of and what surrounds it; only someone
   standing there knows whether it was wet, or in the sun.

   Never derived from the forecast. A forecast air temperature is not the
   temperature of a pavement in the sun, and forecast humidity is not a wet
   verge. Recorded as seen and kept as seen — and not fed into the model,
   because nothing yet says what either should do to it. */
export const CONDITIONS = [
  { id: 'wet', label: 'The ground', options: [
    { v: 'dry', label: 'Dry' },
    { v: 'damp', label: 'Damp' },
    { v: 'wet', label: 'Wet' },
    { v: 'frozen', label: 'Frozen' },
  ] },
  { id: 'sun', label: 'Sun on the trail', options: [
    { v: 'sun', label: 'In sun' },
    { v: 'mixed', label: 'Some of each' },
    { v: 'shade', label: 'In shade' },
  ] },
];
const SEEN_OK = new Map(CONDITIONS.map(c => [c.id, new Set(c.options.map(o => o.v))]));

export const blankSeen = () => ({ v: 1, wet: null, sun: null });

/** Only values the app offers; anything else becomes "not recorded". Used on
    the way into storage and on the way in from a shared link alike. */
export function cleanSeen(o) {
  if (!o || typeof o !== 'object') return null;
  const c = { v: 1 };
  for (const [id, ok] of SEEN_OK) c[id] = ok.has(o[id]) ? o[id] : null;
  return c.wet || c.sun ? c : null;
}

/** "Wet, in shade" — or '' when nothing was recorded. */
export function seenLine(c) {
  const bits = CONDITIONS.map(f => f.options.find(o => o.v === c?.[f.id])?.label).filter(Boolean);
  return bits.join(', ').replace(/^./, ch => ch.toUpperCase());
}

/** Is this point inside something built up — a housing area, a school, a
    building? Surroundings, kept apart from what the ground is made of. */
export function aroundAt(ground, pt) {
  if (!ground?.zones) return false;
  const { lat, lon } = pt;
  return ground.zones.some(z => within(z.box, lon, lat) && inside(z.rings, lon, lat));
}

/**
 * The ground along a trail.
 * @returns {{ letters: string, metres: object }} one letter per input point,
 *          and metres per surface measured every `step` metres along the line
 *          — finer than the fixes, or a six-metre road crossed between two of
 *          them would never be seen.
 */
export function surfaceAlong(ground, pts, step = 2) {
  if (!pts || !pts.length) return { letters: '', metres: {}, around: 0 };
  if (pts.length === 1) return { letters: surfaceAt(ground, pts[0]), metres: {}, around: 0 };
  /* Sampled here rather than with densify(): each fix has to find its own
     sample again afterwards, and a projected copy of it is never quite equal. */
  const fine = [pts[0]], at = [0];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const n = Math.max(1, Math.round(dist(a, b) / step));
    for (let k = 1; k < n; k++) {
      fine.push({ lat: a.lat + ((b.lat - a.lat) * k) / n, lon: a.lon + ((b.lon - a.lon) * k) / n });
    }
    fine.push(b);
    at.push(fine.length - 1);
  }
  const raw = fine.map(p => surfaceAt(ground, p));
  /* One sample on its own between two that agree is the GPS brushing an
     edge, not two metres of something else. Three in a row is a road. */
  const seen = raw.map((s, i) => (i > 0 && i < raw.length - 1 && raw[i - 1] === raw[i + 1] ? raw[i - 1] : s));

  const zoned = fine.map(p => aroundAt(ground, p));
  const metres = {};
  let around = 0;
  for (let i = 1; i < fine.length; i++) {
    const d = dist(fine[i - 1], fine[i]) / 2;
    metres[seen[i - 1]] = (metres[seen[i - 1]] ?? 0) + d;
    metres[seen[i]] = (metres[seen[i]] ?? 0) + d;
    around += (zoned[i - 1] ? d : 0) + (zoned[i] ? d : 0);
  }
  for (const k of Object.keys(metres)) metres[k] = Math.round(metres[k] * 10) / 10;
  const letters = at.map(i => seen[i]).join('');
  return { letters, metres, around: Math.round(around * 10) / 10 };
}

/* ── A reading belongs to one trail, read under one set of rules ──────
   The signature is "<rules version>:<trail fingerprint>". A walked card
   replaces the drawn line, and letters for the old line would colour the
   wrong ground, so the fingerprint must match. The version need not: an old
   reading still describes this trail, just by older rules, and is shown as
   such. Replacing it is a choice someone makes, never a side effect. */
export const groundPrint = (pts) => `${pts.length}:${pts[0].lat.toFixed(5)},${pts[0].lon.toFixed(5)}`
  + `:${pts[pts.length - 1].lat.toFixed(5)},${pts[pts.length - 1].lon.toFixed(5)}`;
export const readingSig = (pts, v = GROUND_V) => `${v}:${groundPrint(pts)}`;

/** Does the stored reading describe this trail (by any rules)? */
export function readingFits(data) {
  const t = data?.trail, sig = data?.surfSig;
  if (!t || t.length < 2 || typeof sig !== 'string' || !sig.includes(':')) return false;
  return sig.slice(sig.indexOf(':') + 1) === groundPrint(t) && data.surf?.length === t.length;
}

/** Which rules the stored reading was made under, or null if there is none. */
export function readingVersion(data) {
  const v = parseInt(String(data?.surfSig ?? ''), 10);
  return Number.isFinite(v) ? v : null;
}

/** Rows for a card: surfaces that were crossed, longest first, with their share. */
export function surfaceRows(metres) {
  const total = Object.values(metres || {}).reduce((a, b) => a + b, 0);
  if (!(total > 0)) return [];
  return Object.entries(metres)
    .filter(([, m]) => m >= 0.5)
    .sort((a, b) => b[1] - a[1])
    .map(([id, m]) => ({ id, label: surfaceById(id).label, metres: m, share: m / total }));
}

/** The same trail with `hard: true` on the points that lie on hard ground, for
    the plume and the scent band to look up their own dials against. Points
    on ordinary ground are passed through untouched, and the saved trail is
    never written on. */
export function withSurface(pts, letters) {
  if (!pts || !letters || letters.length !== pts.length) return pts;
  return pts.map((p, i) => (isHard(letters[i]) ? { ...p, hard: true } : p));
}

/** The tiles that cover a trail, at the finest zoom that keeps the count sane. */
export function tilesCovering(pts, tileOf, { zooms = [15, 14, 13], max = 12, padDeg = 0.0003 } = {}) {
  if (!pts || !pts.length) return [];
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const p of pts) {
    if (p.lon < w) w = p.lon; if (p.lon > e) e = p.lon;
    if (p.lat < s) s = p.lat; if (p.lat > n) n = p.lat;
  }
  for (const z of zooms) {
    const a = tileOf(n + padDeg, w - padDeg, z), b = tileOf(s - padDeg, e + padDeg, z);
    const count = (b.x - a.x + 1) * (b.y - a.y + 1);
    if (count > max && z !== zooms[zooms.length - 1]) continue;
    const out = [];
    for (let x = a.x; x <= b.x; x++) for (let y = a.y; y <= b.y; y++) out.push({ z, x, y });
    return out.slice(0, max * 2);
  }
  return [];
}
