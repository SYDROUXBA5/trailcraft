/* Vehicles, for a vehicle search.

   What each vehicle is (its size, its axles, where an odour can sit on it),
   where it stands (snapped to the verge of a road the map has drawn, or
   inside a car park the map has drawn, or wherever it was tapped), and which
   way it faces.

   Sizes are typical ones for each kind, not any one make. The 3D models in
   models/ were scaled to the same lengths.

   Pure: no map, no network. Everything works in metres on a local flat earth
   round the point it is given, and hands back plain {lat, lon}. */

import { ScentSim } from './sim.js';
import { stability, FLAT } from './field.js';
import { dist } from './geo.js';

const KY = 111320;                                  // metres per degree of latitude
const kx = (lat) => KY * Math.cos((lat * Math.PI) / 180);
const rad = (d) => (d * Math.PI) / 180;
const norm360 = (d) => ((d % 360) + 360) % 360;
/** A compass bearing as a unit step east and north. */
const unit = (brg) => [Math.sin(rad(brg)), Math.cos(rad(brg))];
const bearingOf = (x, y) => norm360((Math.atan2(x, y) * 180) / Math.PI);

/** Metres east and north of `o`. */
export const toLocal = (o, p) => [(p.lon - o.lon) * kx(o.lat), (p.lat - o.lat) * KY];
/** The point that far east and north of `o`. */
export const fromLocal = (o, [x, y]) => ({ lat: o.lat + y / KY, lon: o.lon + x / kx(o.lat) });

/* L, W, H: length, body width (mirrors not counted), height, in metres.
   front, rear: the axles, metres forward of the middle (rear is negative).
   door: the seam a hand goes to first, metres forward of the middle. */
export const VEHICLES = [
  { id: 'car',    label: 'Car',       L: 4.85, W: 1.85, H: 1.45, front: 1.50, rear: -1.40, door: 0.15 },
  { id: 'suv',    label: 'SUV',       L: 4.90, W: 1.95, H: 1.75, front: 1.50, rear: -1.40, door: 0.20 },
  { id: 'pickup', label: 'Pickup',    L: 5.90, W: 2.00, H: 1.95, front: 1.95, rear: -1.83, door: 0.35 },
  { id: 'van',    label: 'Van',       L: 5.95, W: 2.05, H: 2.60, front: 2.10, rear: -1.40, door: 1.30 },
  { id: 'box',    label: 'Box truck', L: 7.90, W: 2.45, H: 3.30, front: 3.10, rear: -1.35, door: 2.70 },
];
export const vehicleById = (id) => VEHICLES.find(v => v.id === id) ?? VEHICLES[0];
/** The 3D model and the two pictures made for each kind (Blender, 2026-11-22). */
export const modelOf = (id) => `models/${vehicleById(id).id}.glb`;
export const cardOf = (id) => `img/vehicles/${vehicleById(id).id}.webp`;

/* Where on a vehicle an odour can sit. u is forward of the middle, v is to
   the vehicle's LEFT, h is the height in metres. Which of left and right is
   the driver's side depends on the country (keepsLeft). */
export function spotsOf(id) {
  const v = vehicleById(id), half = v.W / 2, end = v.L / 2;
  const rearName = v.id === 'pickup' ? 'Tailgate' : v.id === 'car' ? 'Boot / trunk seam' : 'Rear doors';
  return [
    { id: 'fb',   name: 'Front bumper',     u: end,           v: 0,     h: 0.5 },
    { id: 'fwl',  name: 'Front wheel well', u: v.front,       v: half,  h: 0.6, side: 'l' },
    { id: 'fwr',  name: 'Front wheel well', u: v.front,       v: -half, h: 0.6, side: 'r' },
    { id: 'dl',   name: 'Door seam',        u: v.door,        v: half,  h: 1.0, side: 'l' },
    { id: 'dr',   name: 'Door seam',        u: v.door,        v: -half, h: 1.0, side: 'r' },
    { id: 'fuel', name: 'Fuel door',        u: v.rear + 0.55, v: half,  h: 0.9, side: 'l' },
    { id: 'rwl',  name: 'Rear wheel well',  u: v.rear,        v: half,  h: 0.6, side: 'l' },
    { id: 'rwr',  name: 'Rear wheel well',  u: v.rear,        v: -half, h: 0.6, side: 'r' },
    { id: 'rear', name: rearName,           u: -end,          v: 0,     h: 0.8 },
    { id: 'under', name: 'Underneath',      u: -0.3,          v: 0,     h: 0.2 },
    { id: 'cab',  name: 'Inside',           u: v.door,        v: 0,     h: 1.0 },
  ];
}
export const spotById = (type, id) => spotsOf(type).find(s => s.id === id) ?? spotsOf(type)[1];

/** A point on the vehicle, in the world. `veh` = { type, lat, lon, heading }. */
export function onVehicle(veh, u, v) {
  const f = unit(veh.heading), l = unit(veh.heading - 90);
  return fromLocal(veh, [f[0] * u + l[0] * v, f[1] * u + l[1] * v]);
}
/** Where an odour spot is: the side of the body it is on, and its height. */
export function spotWorld(veh, spotId) {
  const s = spotById(veh.type, spotId);
  /* A hide on the outside of the body sits on its skin, not in the air
     beside it: a few centimetres out from the side for a side spot. */
  const out = s.v ? Math.sign(s.v) * 0.05 : 0;
  return { ...onVehicle(veh, s.u, s.v + out), h: s.h, spot: s.id };
}
/** The vehicle's outline on the ground, as a closed ring of [lon, lat]. */
export function footprint(veh, pad = 0) {
  const v = vehicleById(veh.type), L = v.L / 2 + pad, W = v.W / 2 + pad;
  const ring = [[L, W], [L, -W], [-L, -W], [-L, W], [L, W]].map(([u, w]) => onVehicle(veh, u, w));
  return ring.map(p => [p.lon, p.lat]);
}

/* Which side of the road traffic keeps to, by the countries that keep left.
   Boxes, so a border town can be wrong: Turn it round fixes any one vehicle. */
const KEEP_LEFT = [
  [-11, 49.8, 2, 61],        // Britain and Ireland
  [112, -44, 154, -10],      // Australia
  [166, -48, 179, -34],      // New Zealand
  [129, 30, 146, 46],        // Japan
  [68, 6, 89, 30],           // India
  [16, -35, 33, -22],        // South Africa and its neighbours
  [99, 1, 105, 7],           // Malaysia and Singapore
  [113.8, 22.1, 114.5, 22.6],// Hong Kong
];
export const keepsLeft = (lat, lon) => KEEP_LEFT.some(([w, s, e, n]) => lon >= w && lon <= e && lat >= s && lat <= n);
/** The driver's side of the body: right where traffic keeps left. */
export const driverSide = (lat, lon) => (keepsLeft(lat, lon) ? 'r' : 'l');

/* Half the carriageway a road stands for, in metres, to its edge line.
   ground.js has wider figures on purpose (pavement plus GPS margin, for what
   is underfoot); a parked vehicle stands just off the carriageway. */
const CARRIAGEWAY = {
  motorway: 7.5, motorway_link: 4, trunk: 6.5, trunk_link: 4, primary: 5.5, primary_link: 4,
  secondary: 5, secondary_link: 3.8, tertiary: 4.2, tertiary_link: 3.5, street: 3.6, street_limited: 3.2, service: 2.6,
};
export const VERGE_GAP = 0.8;              // from the edge line to the vehicle's side
export const SNAP_MAX = 40;                // a tap further than this from any road is not "the roadside"

/** The roads in decoded street tiles (mvt.js): centre lines with a class. */
export function roadsOf(tiles) {
  const out = [];
  for (const t of tiles || []) for (const f of t.road || []) {
    if (f.type !== 2 || !CARRIAGEWAY[f.props.class] || f.props.structure === 'tunnel') continue;
    for (const pts of f.geom) if (pts.length > 1) out.push({ cls: f.props.class, half: CARRIAGEWAY[f.props.class], pts });
  }
  return out;
}
/** The car parks in decoded street tiles: areas the map calls parking. */
export function parksOf(tiles) {
  const out = [];
  for (const t of tiles || []) for (const f of t.landuse || []) {
    if (f.type === 3 && f.props.class === 'parking') out.push({ rings: f.geom });
  }
  return out;
}

/** The nearest point of any road line to `p`, with the road's direction there. */
function nearestRoad(roads, p) {
  let best = null;
  for (const r of roads) for (let i = 1; i < r.pts.length; i++) {
    const a = toLocal(p, { lon: r.pts[i - 1][0], lat: r.pts[i - 1][1] }), b = toLocal(p, { lon: r.pts[i][0], lat: r.pts[i][1] });
    const dx = b[0] - a[0], dy = b[1] - a[1], len2 = dx * dx + dy * dy;
    if (!len2) continue;
    const t = Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / len2));
    const q = [a[0] + t * dx, a[1] + t * dy], d = Math.hypot(q[0], q[1]);
    if (!best || d < best.d) best = { d, q, dir: [dx / Math.sqrt(len2), dy / Math.sqrt(len2)], road: r };
  }
  return best;
}

/**
 * Stand a vehicle on the verge nearest the tap, on the tap's side of the
 * road, facing the way traffic on that side goes. Null when no drawn road is
 * within SNAP_MAX metres.
 */
export function snapToVerge(roads, tap, type, { left = keepsLeft(tap.lat, tap.lon) } = {}) {
  const near = nearestRoad(roads, tap);
  if (!near || near.d > SNAP_MAX) return null;
  /* The side the tap was on. A tap right on the centre line counts as the
     side traffic keeps to. */
  let n = near.d > 0.3 ? [-near.q[0] / near.d, -near.q[1] / near.d] : null;
  if (!n) { const [dx, dy] = near.dir; n = left ? [-dy, dx] : [dy, -dx]; }
  const off = near.road.half + VERGE_GAP + vehicleById(type).W / 2;
  const at = fromLocal(tap, [near.q[0] + n[0] * off, near.q[1] + n[1] * off]);
  /* Keeping right, the road is on the vehicle's left; keeping left, on its right. */
  const nb = bearingOf(n[0], n[1]);
  return { ...at, heading: norm360(left ? nb + 90 : nb - 90), place: 'verge', road: near.road.cls };
}

/** Even-odd across every ring. */
function inside(rings, p) {
  let hit = false;
  for (const r of rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > p.lat) !== (yj > p.lat) && p.lon < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}
/**
 * Park a vehicle where the tap is, inside a car park the map has drawn,
 * nose in towards the nearest edge of the car park. Null outside every one.
 */
export function parkAt(parks, tap) {
  const park = parks.find(k => inside(k.rings, tap));
  if (!park) return null;
  let best = null;
  for (const r of park.rings) for (let i = 1; i < r.length; i++) {
    const a = toLocal(tap, { lon: r[i - 1][0], lat: r[i - 1][1] }), b = toLocal(tap, { lon: r[i][0], lat: r[i][1] });
    const dx = b[0] - a[0], dy = b[1] - a[1], len2 = dx * dx + dy * dy;
    if (!len2) continue;
    const t = Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / len2));
    const q = [a[0] + t * dx, a[1] + t * dy], d = Math.hypot(q[0], q[1]);
    if (!best || d < best.d) best = { d, q };
  }
  const heading = best && best.d > 0.1 ? bearingOf(best.q[0], best.q[1]) : 0;
  return { lat: tap.lat, lon: tap.lon, heading, place: 'park' };
}

/** The verges as lines to light up: each road's edge lines, both sides. */
export function vergeLines(roads) {
  const feats = [];
  for (const r of roads) {
    const o = { lon: r.pts[0][0], lat: r.pts[0][1] };
    const xy = r.pts.map(([lon, lat]) => toLocal(o, { lon, lat }));
    const off = r.half + VERGE_GAP * 0.5;
    for (const s of [1, -1]) {
      const line = xy.map((p, i) => {
        const a = xy[Math.max(0, i - 1)], b = xy[Math.min(xy.length - 1, i + 1)];
        const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
        const q = fromLocal(o, [p[0] - (dy / L) * off * s, p[1] + (dx / L) * off * s]);
        return [q.lon, q.lat];
      });
      feats.push({ type: 'Feature', properties: { cls: r.cls }, geometry: { type: 'LineString', coordinates: line } });
    }
  }
  return { type: 'FeatureCollection', features: feats };
}
/** The car parks as areas to light up. */
export const parkAreas = (parks) => ({ type: 'FeatureCollection',
  features: parks.map(k => ({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: k.rings } })) });

/**
 * Where along a run the dog's nose was in the hides' cloud: the same
 * simulation the map draws (sim.js seedHides), put on the run's clock every
 * `every` ms, and a track point counts as in scent when a parcel still
 * carrying scent (str above `min`) is within `near` metres of it. Returns
 * a flag per point, the first point in scent (its time into the run and its
 * distance from the odour) and the time spent in scent.
 */
export function scentAlong(track, hides, wxAt, { T = FLAT, every = 4000, near = 2.5, min = 0.06 } = {}) {
  const n = track?.length || 0, inScent = new Uint8Array(n);
  const out = { inScent, first: -1, firstT: null, firstDist: null, ms: 0 };
  if (!n || !hides?.length) return out;
  const sim = new ScentSim().seedHides(hides);
  let i = 0;
  for (let t = track[0].t; i < n; t += every) {
    const wx = wxAt(t);
    let parts = [];
    if (wx) {
      sim.advance(T, wx, stability(wx.soil_temp, wx.temp), t);
      parts = sim.drawable().filter(q => (q.str ?? 0) > min);
    }
    for (; i < n && track[i].t < t + every; i++) {
      const p = track[i];
      if (parts.some(q => Math.abs(q.lat - p.lat) < 3e-5 && dist(p, q) < near)) inScent[i] = 1;
    }
  }
  for (let k = 0; k < n; k++) {
    if (!inScent[k]) continue;
    if (out.first < 0) { out.first = k; out.firstT = track[k].t - track[0].t; out.firstDist = dist(track[k], hides[0]); }
    if (k > 0 && inScent[k - 1]) out.ms += track[k].t - track[k - 1].t;
  }
  return out;
}

/** The run's first Indication against the vehicle: at it when within half its
    length plus `margin` metres of GPS, else how far off. Null with none. */
export function indicationOn(marks, veh, { margin = 5 } = {}) {
  const m = (marks || []).find(w => w?.kind === 'Indication' && Number.isFinite(w.lat) && Number.isFinite(w.lon));
  if (!m || !veh) return null;
  const d = dist(m, veh);
  return { t: m.t ?? null, d, at: d <= vehicleById(veh.type).L / 2 + margin };
}
