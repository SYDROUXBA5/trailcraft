/* Vehicles for a vehicle search: snapping to a verge or a car park, which
   way they face, and where an odour spot lands. Synthetic roads, exact. */
import assert from 'node:assert/strict';
import { VEHICLES, vehicleById, spotsOf, spotWorld, footprint, keepsLeft, driverSide, roadsOf, parksOf,
  snapToVerge, parkAt, vergeLines, parkAreas, toLocal, fromLocal, VERGE_GAP, SNAP_MAX, modelOf, cardOf, scentAlong, indicationOn, describeSpot,
  DISTRACTORS, fromBody, vehicleAt, odourHides, gradeVehicles } from '../public/vehicles.js';
import { ScentSim, poolRadius, hidePoolRadius, HIDE_POOL } from '../public/sim.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log(`  ok  ${name}`); };
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
const angle = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

const TX = { lat: 31.6629, lon: -97.4852 };          // Valley Mills, Texas: keeps right
const UK = { lat: 51.2094, lon: -2.6449 };            // Wells, Somerset: keeps left
/* A street running east-west through the origin, as decoded tiles give it. */
const ewRoad = (o, cls = 'street') => {
  const a = fromLocal(o, [-200, 0]), b = fromLocal(o, [200, 0]);
  return [{ road: [{ type: 2, props: { class: cls }, geom: [[[a.lon, a.lat], [b.lon, b.lat]]] }] }];
};

t('five kinds, each with its model, its picture and real proportions', () => {
  assert.deepEqual(VEHICLES.map(v => v.id), ['car', 'suv', 'pickup', 'van', 'box']);
  for (const v of VEHICLES) {
    assert.ok(v.L > v.W && v.W > 1.5 && v.H > 1, v.id);
    assert.ok(v.front > 0 && v.rear < 0 && v.front < v.L / 2 && -v.rear < v.L / 2, `${v.id} axles under the body`);
  }
  assert.equal(modelOf('pickup'), 'models/pickup.glb');
  assert.equal(cardOf('van'), 'img/vehicles/van.webp');
  assert.equal(vehicleById('nonsense').id, 'car');
});

t('which side traffic keeps to', () => {
  assert.equal(keepsLeft(TX.lat, TX.lon), false);
  assert.equal(keepsLeft(UK.lat, UK.lon), true);
  assert.equal(keepsLeft(-33.87, 151.21), true, 'Sydney');
  assert.equal(keepsLeft(48.85, 2.35), false, 'Paris');
  assert.equal(driverSide(TX.lat, TX.lon), 'l');
  assert.equal(driverSide(UK.lat, UK.lon), 'r');
});

t('roadside: a tap north of an east-west street stands the vehicle on the north verge, facing the traffic', () => {
  const roads = roadsOf(ewRoad(TX));
  const tap = fromLocal(TX, [12, 9]);
  const v = snapToVerge(roads, tap, 'pickup');
  const [x, y] = toLocal(TX, v);
  near(y, 3.6 + VERGE_GAP + 1.0, 0.05, 'just off the edge line');
  near(x, 12, 0.05, 'level with the tap');
  assert.equal(v.place, 'verge'); assert.equal(v.road, 'street');
  near(angle(v.heading, 270), 0, 0.5, 'keeping right, the north side goes west');
  const south = snapToVerge(roads, fromLocal(TX, [0, -6]), 'pickup');
  near(toLocal(TX, south)[1], -(3.6 + VERGE_GAP + 1.0), 0.05, 'the south verge');
  near(angle(south.heading, 90), 0, 0.5, 'and its traffic goes east');
});

t('roadside where traffic keeps left: the same tap faces the other way', () => {
  const v = snapToVerge(roadsOf(ewRoad(UK)), fromLocal(UK, [0, 9]), 'car');
  near(angle(v.heading, 90), 0, 0.5, 'keeping left, the north side goes east');
});

t('roadside: a wider road puts the vehicle further out, and no road means no snap', () => {
  const a = snapToVerge(roadsOf(ewRoad(TX, 'primary')), fromLocal(TX, [0, 9]), 'car');
  near(toLocal(TX, a)[1], 5.5 + VERGE_GAP + 1.85 / 2, 0.05, 'a primary road');
  assert.equal(snapToVerge(roadsOf(ewRoad(TX)), fromLocal(TX, [0, SNAP_MAX + 5]), 'car'), null);
  assert.equal(snapToVerge([], TX, 'car'), null);
  const tunnel = [{ road: [{ type: 2, props: { class: 'street', structure: 'tunnel' }, geom: ewRoad(TX)[0].road[0].geom }] }];
  assert.equal(roadsOf(tunnel).length, 0, 'a road in a tunnel has no verge to park on');
});

t('car park: a tap inside parks there, nose in to the nearest edge; outside, nothing', () => {
  const ring = [[-20, -10], [20, -10], [20, 10], [-20, 10], [-20, -10]].map(p => { const q = fromLocal(TX, p); return [q.lon, q.lat]; });
  const parks = parksOf([{ landuse: [{ type: 3, props: { class: 'parking' }, geom: [ring] }, { type: 3, props: { class: 'grass' }, geom: [ring] }] }]);
  assert.equal(parks.length, 1, 'only what the map calls parking');
  const p = parkAt(parks, fromLocal(TX, [5, 7]));
  assert.equal(p.place, 'park');
  near(angle(p.heading, 0), 0, 0.5, 'the north edge is nearest');
  assert.equal(parkAt(parks, fromLocal(TX, [30, 0])), null);
  assert.equal(parkAreas(parks).features[0].geometry.type, 'Polygon');
});

t('odour spots land on the body: front wheel well on the left, at arch height', () => {
  const veh = { type: 'pickup', ...TX, heading: 0 };                      // facing north
  const s = spotWorld(veh, 'fwl');
  const [x, y] = toLocal(TX, s);
  near(y, 1.95, 0.01, 'at the front axle');
  near(x, -(1.0 + 0.05), 0.01, 'on the left side, which faces west');
  assert.equal(s.h, 0.6); assert.equal(s.spot, 'fwl');
  const turned = toLocal(TX, spotWorld({ ...veh, heading: 90 }, 'fwl'));
  near(turned[0], 1.95, 0.01, 'turned to face east, the front is east');
  near(turned[1], 1.05, 0.01, 'and its left is north');
  assert.equal(spotsOf('van').length, 11);
  assert.ok(spotsOf('pickup').some(x => x.name === 'Tailgate'));
});

t('footprint and verge lines are well-formed', () => {
  const ring = footprint({ type: 'car', ...TX, heading: 30 });
  assert.equal(ring.length, 5);
  assert.deepEqual(ring[0], ring[4], 'closed');
  const corners = ring.slice(0, 4).map(([lon, lat]) => toLocal(TX, { lon, lat }));
  near(Math.hypot(corners[0][0] - corners[1][0], corners[0][1] - corners[1][1]), 1.85, 0.01, 'width');
  near(Math.hypot(corners[1][0] - corners[2][0], corners[1][1] - corners[2][1]), 4.85, 0.01, 'length');
  const lines = vergeLines(roadsOf(ewRoad(TX)));
  assert.equal(lines.features.length, 2, 'one edge each side');
  const ys = lines.features.map(f => toLocal(TX, { lon: f.geometry.coordinates[0][0], lat: f.geometry.coordinates[0][1] })[1]).sort((a, b) => a - b);
  near(ys[0], -(3.6 + VERGE_GAP / 2), 0.05, 'south edge'); near(ys[1], 3.6 + VERGE_GAP / 2, 0.05, 'north edge');
});

t('a run walked up into the cloud is in scent near the odour; one kept upwind never is', () => {
  /* A westerly at 3 m/s carries the odour east. Half an hour after it went in,
     a dog walking west along the wind line towards it enters the cloud on
     the way; a dog walking a line 60 m upwind of it never does. */
  const t0 = Date.parse('2026-08-24T07:00:00Z'), run0 = t0 + 30 * 60000;
  const hides = [{ ...TX, t: t0 }];
  const wx = { wind_speed: 3, wind_direction: 270, temp: 18, soil_temp: 17, humidity: 60 };
  const walk = (from, to, secs) => Array.from({ length: secs + 1 }, (_, k) => ({ ...fromLocal(TX, [from[0] + (to[0] - from[0]) * k / secs, from[1] + (to[1] - from[1]) * k / secs]), t: run0 + k * 1000 }));
  const down = walk([70, 0], [1, 0], 70);
  const a = scentAlong(down, hides, () => wx);
  assert.ok(a.first >= 0, 'it meets the scent');
  assert.ok(a.firstDist > 5 && a.firstDist < 70, `before it reaches the odour: ${a.firstDist.toFixed(1)} m out`);
  assert.equal(a.inScent[a.inScent.length - 1], 1, 'and is in scent at the odour');
  assert.ok(a.ms > 10000, `working scent for a while: ${a.ms} ms`);
  const up = walk([-60, -40], [-60, 40], 80);
  const b = scentAlong(up, hides, () => wx);
  assert.equal(b.first, -1, 'upwind there is nothing to smell');
  assert.equal(b.ms, 0);
  assert.equal(scentAlong(down, hides, () => null).first, -1, 'no forecast, no cloud, no claim');
});

t('an indication counts at the vehicle within half its length plus the GPS margin', () => {
  const veh = { type: 'pickup', ...TX, heading: 0 };
  const at = (m) => indicationOn([{ kind: 'Lost it', ...fromLocal(TX, [0, 1]), t: 1 }, { kind: 'Indication', ...fromLocal(TX, [m, 0]), t: 2 }], veh);
  assert.equal(at(3).at, true);
  assert.equal(at(7.9).at, true, '2.95 + 5');
  assert.equal(at(12).at, false);
  near(at(12).d, 12, 0.05, 'and says how far');
  assert.equal(indicationOn([], veh), null);
});

t('a tap on the top-down picture is a point on the vehicle, named and given a height', () => {
  const veh = { type: 'pickup', ...TX, heading: 0 };
  const w = describeSpot(veh, 1.9, 0.95);
  assert.equal(w.name, 'Front wheel well, driver side', 'near a named spot it takes that name');
  assert.equal(w.h, 0.6);
  const side = describeSpot(veh, -2.5, -1.2);
  assert.equal(side.v, -1.0, 'off the body is brought onto its edge');
  assert.match(side.name, /^Body, rear, passenger side$|^Rear wheel well/);
  const top = describeSpot(veh, 0.2, 0);
  assert.match(top.name, /^Top or inside|^Door seam/);
  const s = spotWorld({ ...veh, spot: 'tap', spotU: 1.0, spotV: 1.0, spotH: 0.8 }, 'tap');
  const [x, y] = toLocal(TX, s);
  near(y, 1.0, 0.01, 'forward'); near(x, -1.05, 0.01, 'on the left skin');
  assert.equal(s.h, 0.8); assert.equal(s.spot, 'tap');
});

t('a placed odour has a smaller pool than a person standing, and its parcels say so', () => {
  assert.ok(HIDE_POOL > 0 && HIDE_POOL < 1);
  near(hidePoolRadius(900), poolRadius(900) * HIDE_POOL, 1e-9, 'the share');
  const sim = new ScentSim().seedHides([{ ...TX, t: 0 }]);
  assert.ok(sim.pool.length > 0 && sim.pool.every(p => p.hide === true), 'every hide parcel is marked');
  const trail = new ScentSim().seed([{ ...TX, t: 0 }, { ...fromLocal(TX, [5, 0]), t: 4000 }]);
  assert.ok(trail.pool.every(p => p.hide === false), 'a person at a trail end is not');
});

/* Several vehicles: a car park row, four vehicles facing north, 6 m apart, east of each other. */
const row = [['suv', 0], ['pickup', 6], ['van', 12], ['car', 18]].map(([type, x], i) => ({ n: i + 1, type, ...fromLocal(TX, [x, 0]), heading: 0, odours: [] }));
row[1].odours = [{ kind: 'target', name: 'cocaine', spot: 'fwl' }];
row[2].odours = [{ kind: 'distractor', name: 'Coffee', spot: 'rear' }];
row[0].odours = [{ kind: 'distractor', name: 'Gloves', spot: 'dl' }];

t('distance to a vehicle body: zero on it, metres off its side and its end', () => {
  const v = row[0];
  assert.equal(fromBody(v, v), 0);
  near(fromBody(v, fromLocal(v, [3, 0])), 3 - 1.95 / 2, 0.01, 'off its side (facing north: x is across)');
  near(fromBody(v, fromLocal(v, [0, -5])), 5 - 4.90 / 2, 0.01, 'behind it');
  near(fromBody({ ...v, heading: 90 }, fromLocal(v, [0, -5])), 5 - 1.95 / 2, 0.01, 'turned east, behind is its side');
  assert.ok(DISTRACTORS.includes('Coffee') && DISTRACTORS.length >= 6);
});

t('a tap finds the vehicle under it, the nearest when two are close', () => {
  assert.equal(vehicleAt(row, fromLocal(TX, [6.3, 1]))?.n, 2);
  assert.equal(vehicleAt(row, fromLocal(TX, [3, 0])), null, 'between two, clear of both');
  assert.equal(vehicleAt(row, fromLocal(TX, [2.8, 0]), 3)?.n, 1, 'with room to spare, the nearer');
});

t('every odour lands on its own vehicle, targets apart from distractors', () => {
  const { targets, distractors } = odourHides(row, 1000);
  assert.equal(targets.length, 1); assert.equal(distractors.length, 2);
  assert.equal(targets[0].n, 2); assert.equal(targets[0].t, 1000); assert.equal(targets[0].name, 'cocaine');
  assert.ok(fromBody(row[1], targets[0]) < 0.1, 'the target is on the pickup');
  const coffee = distractors.find(d => d.name === 'Coffee');
  assert.equal(coffee.n, 3); assert.ok(fromBody(row[2], coffee) < 0.1, 'the coffee is on the van');
  const [, y] = toLocal(row[2], coffee); near(y, -5.95 / 2, 0.01, 'at the van\'s rear doors');
});

t('car by car: the target indicated, a distractor looked at, the rest ignored', () => {
  /* The dog walks north up the aisle 3.5 m east of the van, then crosses to the pickup. */
  const T0 = 0, track = [];
  const walk = (x0, y0, x1, y1, steps, t0) => { for (let i = 0; i <= steps; i++) track.push({ ...fromLocal(TX, [x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps]), t: t0 + i * 1000 }); };
  walk(13.5, -20, 13.5, -3.3, 10, T0);             // up to the van's rear (2.97 m behind its middle: within 2 m of the body)
  walk(13.5, -3.3, 13.5, -3.2, 3, T0 + 11000);     // nose on the rear doors, 3 s
  walk(13.5, -3.2, 7.5, 1.6, 6, T0 + 15000);       // across to the pickup's left front
  const ind = { kind: 'Indication', ...fromLocal(TX, [7.2, 1.7]), t: T0 + 21000 };
  const g = gradeVehicles(track, [ind], row);
  const by = Object.fromEntries(g.rows.map(r => [r.n, r]));
  assert.equal(by[2].status, 'indicated'); assert.equal(by[2].target, true);
  assert.equal(by[3].status, 'looked'); assert.ok(by[3].lookMs >= 3000, `looked ${by[3].lookMs}`);
  assert.equal(by[1].status, 'ignored'); assert.deepEqual(by[1].distractors, ['Gloves']);
  assert.equal(by[4].status, 'ignored'); assert.equal(by[4].odours.length, 0);
  assert.equal(g.right, true); assert.equal(g.falses, 0); assert.equal(g.passed, 2); assert.equal(g.away, 0);
  /* Scrubbed back to before the Indication: the target not yet found. */
  assert.equal(gradeVehicles(track, [ind], row, { until: T0 + 12000 }).rows.find(r => r.n === 2).status, 'missed');
});

t('an Indication at a distractor is a false one; far from every vehicle it is away', () => {
  const g = gradeVehicles([], [{ kind: 'Indication', ...fromLocal(TX, [12.5, -3.4]), t: 5 },
    { kind: 'Indication', ...fromLocal(TX, [40, 40]), t: 6 }, { kind: 'Mark', ...fromLocal(TX, [6, 0]), t: 7 }], row);
  assert.equal(g.rows.find(r => r.n === 3).status, 'false');
  assert.equal(g.falses, 1); assert.equal(g.away, 1); assert.equal(g.right, false); assert.equal(g.passed, 1);
});

console.log(`\n${pass} vehicle tests passed`);
