/* What is placed where on a board: every tree, house and landmark, chosen
   once for a layout by a seeded draw, so the same board is always the same. */

import { clamp, R, seeded } from './core.js';
import { LAND_ORDER, trailPoint } from './layout.js';
import { BOARD_LANDS, boulder, car, house, lamp, landmark, snowPole, tree } from './scenery.js';

const overlaps = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

/* Where everything stands is worked out once for a layout, and kept. Each
   item is { box, base, draw(c) }, sorted so the nearer ones overlap the
   further. */
const scenes = new WeakMap();

export function sceneOf(layout) {
  let s = scenes.get(layout);
  if (!s) { s = buildScene(layout); scenes.set(layout, s); }
  return s;
}

function buildScene(layout) {
  const { W, H, stones, clear, bosses, pathDist, landAt, skyAt } = layout;
  const rnd = seeded(7);
  const placed = [], items = [];
  const L = (key) => BOARD_LANDS[key];
  /* Keep out of the band a boss's own art fills. */
  const inBand = (box) => bosses.some(b => box[1] < b.y + 8 && box[3] > b.y - (b.kind === 'wall' ? 62 : 40));
  const onRoad = (box) => layout.roadY != null && box[3] > layout.roadY - 7 && box[3] < layout.roadY + 10;
  /* Every stone with the tag that hangs under it, and the town's streets and
     its square: nothing stands on those. A lamp behind a number plate made
     the plate a sign on a pole, and a house sat on the corner of the square. */
  const kept = stones.map(s => [s.x - 15, s.y - 10, s.x + 15, s.y + 22]);
  for (const cr of layout.crossings || []) {
    if (cr.kind === 'street') kept.push([0, cr.y - 9, W, cr.y + 10]);
    if (cr.kind === 'square') kept.push([cr.x - 46, cr.y - 28, cr.x + 46, cr.y + 30]);
  }
  const free = (box, gap = 5) => box[0] >= 0 && box[2] <= W && box[1] > skyAt((box[0] + box[2]) / 2) + 4 && !inBand(box) && !onRoad(box) &&
    !clear.some(r => overlaps(r, box)) && !placed.some(r => overlaps(r, box)) && !kept.some(r => overlaps(r, box)) &&
    pathDist((box[0] + box[2]) / 2, (box[1] + box[3]) / 2) > Math.max(box[2] - box[0], box[3] - box[1]) / 2 + gap;
  /* `tag` says what a thing is and where, for whatever wants to bring it
     to life afterwards (ambient.js): the picture itself never needs it. */
  const put = (box, base, draw, tag) => { placed.push(box); items.push({ box, base, draw, tag: tag || null }); };
  /* The rows of each land, top and bottom. */
  const rows = {};
  LAND_ORDER.forEach((key, k) => {
    const y1 = k === 0 ? H : bosses[k - 1] ? bosses[k - 1].y : null;
    if (y1 == null) return;
    const y0 = k < LAND_ORDER.length - 1 && bosses[k] ? bosses[k].y : 0;
    rows[key] = [y0, y1];
  });
  /* A landmark near a level's stone, wherever there is room. */
  const near = (level, name, ext) => {
    const s = stones[level - 1];
    if (!s) return;
    for (let k = 0; k < 40; k++) {
      const x = R(rnd() * W), y = R(s.y - 20 + rnd() * 40);
      const box = [x + ext[0], y + ext[1], x + ext[2], y + ext[3]];
      if (!free(box)) continue;
      put(box, y, (c) => landmark(c, name, x, y), { k: name, x, y });
      return;
    }
  };

  /* The meadow: a pond, sheep and a log, then big trees down both sides. */
  near(3, 'pond', [-18, -10, 22, 8]); near(8, 'sheep', [-14, -13, 22, 8]); near(12, 'log', [-9, -4, 9, 3]);
  if (rows.hot) {
    const [y0, y1] = rows.hot;
    for (let k = 0; k < (y1 - y0 + 40) / 4; k++) {
      const r = 10 + R(rnd() * 4), side = rnd() < 0.5;
      const x = side ? R(rnd() * W * 0.24) : R(W - rnd() * W * 0.24);
      const base = R(y0 + 20 + rnd() * (y1 - y0));
      const box = [x - r - 1, base - 7 - r * 2 - 1, x + r + 2, base + 2];
      const kind = rnd() < 0.35 ? 'haw' : 'round';
      if (!free(box)) continue;
      put(box, base, (c) => tree(c, x, base, L('hot'), r, kind));
    }
  }
  /* The wood is a wood: many trees, three sizes, three kinds, both sides.
     Under them, what a walk in one turns up. */
  if (rows.warm) {
    const [y0, y1] = rows.warm;
    near(19, 'mushrooms', [-6, -5, 7, 3]); near(22, 'signpost', [-6, -11, 7, 2]); near(25, 'stump', [-4, -5, 4, 2]);
    near(28, 'deer', [-9, -28, 14, 3]); near(31, 'mushrooms', [-6, -5, 7, 3]); near(34, 'log', [-9, -4, 9, 3]);
    near(37, 'pond', [-18, -10, 22, 8]); near(40, 'deer', [-9, -28, 14, 3]); near(43, 'signpost', [-6, -11, 7, 2]);
    for (let k = 0; k < (y1 - y0) / 1.5; k++) {
      const r = [6, 8, 11][R(rnd() * 2)], x = R(rnd() * W);
      const base = R(y0 + 8 + rnd() * (y1 - y0 - 30));
      const box = [x - r, base - 7 - r * 2, x + r + 1, base + 1];
      const pick = rnd();
      if (!free(box)) continue;
      const kind = pick < 0.35 ? 'pine' : pick < 0.6 ? 'haw' : 'round';
      put(box, base, (c) => tree(c, x, base, L('warm'), r, kind));
    }
    for (let k = 0; k < (y1 - y0) / 40; k++) {
      const x = R(8 + rnd() * (W - 16)), y = R(y0 + 10 + rnd() * (y1 - y0 - 50));
      const box = [x - 6, y - 5, x + 7, y + 3];
      if (!free(box, 2)) continue;
      const name = rnd() < 0.7 ? 'mushrooms' : 'stump';
      put(box, y, (c) => landmark(c, name, x, y));
    }
  }
  /* The town: lamps along the street, houses behind them, a square. */
  if (rows.town) {
    const [y0, y1] = rows.town;
    const T = L('town');
    for (const s of stones) {
      if (s.y <= y0 + 30 || s.y >= y1 - 30) continue;
      // A lamp half way to the next stone, on the outside of the bend.
      // It keeps clear of the stones, their plates and where the team
      // stands: the other side of the street, or a little along it, if not.
      for (const [u, far] of [[0.5, 14], [0.5, -14], [0.5, 22], [0.5, -22], [0.36, 16], [0.64, 16], [0.36, -16], [0.64, -16], [0.5, 30], [0.5, -30]]) {
        const p = trailPoint(layout, s.level - 1, u);
        const x = clamp(R(p[0] + (p[0] < W / 2 ? -1 : 1) * far), 5, W - 6), base = R(p[1] + 2);
        const box = [x - 9, base - 26, x + 10, base + 6];
        if (inBand(box) || kept.some(r => overlaps(r, box)) || clear.some(r => overlaps(r, box)) || placed.some(r => overlaps(r, box))) continue;
        put(box, base, (c) => lamp(c, x, base), { k: 'lamp', x, y: base });
        break;
      }
    }
    {
      // The fountain stands in the square itself, on the far side of the
      // trail from where the team stands.
      const sq = (layout.crossings || []).find(cr => cr.kind === 'square');
      if (sq) {
        const fx = sq.x + (layout.faceLeft[59] ? 26 : -26), fy = sq.y - 6;
        const box = [fx - 16, fy - 19, fx + 19, fy + 9];
        placed.push(box);
        items.push({ box, base: fy, draw: (c) => landmark(c, 'fountain', fx, fy), tag: { k: 'fountain', x: fx, y: fy } });
      }
    }
    near(52, 'bench', [-9, -10, 10, 3]); near(64, 'bench', [-9, -10, 10, 3]);
    for (let k = 0; k < (y1 - y0) / 2.2; k++) {
      // A house is wider than the dog is long, and its door is a door the
      // handler could walk through.
      const w = [38, 44, 44, 52][R(rnd() * 3)], h = 16 + R(rnd() * 4), side = rnd() < 0.5;
      const x = side ? R(w / 2 + 3 + rnd() * W * 0.22) : R(W - w / 2 - 4 - rnd() * W * 0.22);
      const base = R(y0 + 30 + rnd() * (y1 - y0 - 40));
      const seed = k * 31 + 7;
      const box = [x - (w >> 1) - 3, base - h - R(w * 0.3) - 8, x + (w >> 1) + 10, base + 8];
      if (!free(box, 3)) continue;
      put(box, base, (c) => house(c, x, base, w, h, seed, T, false), { k: 'house', x, y: base, w, h, seed });
    }
    /* Cars are parked where cars are: at the kerb of a cross street, well
       along it from where the trail comes over. */
    (layout.crossings || []).filter(cr => cr.kind === 'street').forEach((cr, k) => {
      const x = cr.x > W / 2 ? R(W * 0.2) : R(W * 0.8), y = cr.y + 5;
      const box = [x - 16, y - 14, x + 17, y + 3];
      const col = ['#c8443a', '#3f9a8a', '#d9b23a', '#8a6ac8'][k % 4];
      placed.push(box);
      items.push({ box, base: y, draw: (c) => car(c, x, y, col, k % 2 === 0), tag: null });
    });
    for (let k = 0; k < (y1 - y0) / 7; k++) {
      const r = [6, 8][R(rnd())], x = R(rnd() * W);
      const base = R(y0 + 30 + rnd() * (y1 - y0 - 40));
      const box = [x - r, base - 7 - r * 2, x + r + 1, base + 1];
      if (!free(box)) continue;
      put(box, base, (c) => tree(c, x, base, T, r, 'round'));
    }
  }
  /* The climb: a hut, a frozen tarn, then pines thinning out to rock and
     snow, with poles marking the path near the top. */
  if (rows.alp) {
    const [, y1] = rows.alp;
    const A = L('alp');
    const y0 = layout.sky ? layout.sky.y : 0;
    const high = (y) => clamp((y1 - y) / Math.max(1, y1 - y0), 0, 1);
    {
      const s = stones[78];
      for (let j = 0; s && j < 40; j++) {
        const x = R(16 + rnd() * (W - 32)), base = R(s.y - 16 + rnd() * 40);
        const box = [x - 24, base - 34, x + 32, base + 8];
        if (!free(box, 3)) continue;
        put(box, base, (c) => house(c, x, base, 40, 16, 3, A, true), { k: 'house', x, y: base, w: 40, h: 16, seed: 3, snowy: true });
        break;
      }
    }
    near(83, 'tarn', [-18, -8, 19, 8]); near(92, 'snowman', [-9, -25, 10, 3]); near(96, 'tent', [-14, -14, 18, 3]);
    if (layout.roadY != null) {
      const x = pathDist(W * 0.22, layout.roadY) > 26 ? R(W * 0.22) : R(W * 0.78), y = layout.roadY + 2;
      const box = [x - 16, y - 14, x + 17, y + 3];
      placed.push(box);
      items.push({ box, base: y, draw: (c) => car(c, x, y, '#d9412b', x < W / 2) });
    }
    for (const s of stones) {
      if (s.level < 84 || s.level >= stones.length || landAt(s.y) !== 'alp') continue;
      const p = trailPoint(layout, s.level - 1, 0.5);
      // A pole stands beside the track, never on the road or behind a plate.
      for (const side of s.level % 2 ? [11, -11] : [-11, 11]) {
        const x = clamp(R(p[0] + side), 3, W - 4), base = R(p[1] + 1);
        const box = [x - 2, base - 14, x + 3, base + 2];
        if (onRoad(box) || kept.some(r => overlaps(r, box)) || clear.some(r => overlaps(r, box))) continue;
        put(box, base, (c) => snowPole(c, x, base));
        break;
      }
    }
    for (let k = 0; k < (y1 - y0) / 1.6; k++) {
      const r = [6, 8, 11][R(rnd() * 2)], x = R(rnd() * W);
      const base = R(y0 + 30 + rnd() * (y1 - y0 - 40));
      const box = [x - r, base - 7 - r * 2, x + r + 1, base + 1];
      // Fewer trees the higher the trail climbs, and none near the top.
      const keep = rnd() > high(base) * 1.25;
      if (!keep || !free(box)) continue;
      put(box, base, (c) => tree(c, x, base, A, r, 'pine'));
    }
    for (let k = 0; k < (y1 - y0) / 9; k++) {
      const r = 5 + R(rnd() * 6), x = R(rnd() * W), y = R(y0 + 24 + rnd() * (y1 - y0 - 30));
      const box = [x - r - 1, y - r, x + r + 2, y + 2];
      if (!free(box, 3)) continue;
      put(box, y, (c) => boulder(c, x, y, r, A));
    }
  }
  items.sort((a, b) => a.base - b.base);
  return items;
}
