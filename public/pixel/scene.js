/* What is placed where on a board: every tree, cottage and landmark, and
   whoever else is out in the wood, chosen once for a layout by a seeded
   draw, so the same board is always the same.

   The wood is one thing that changes with depth, not five sets: how thick
   the trees stand, how big and what kind, comes from the level a row is at
   (`standAt`), so the field thins into saplings, the saplings into forest,
   the forest into giants, with no line where one stops. */

import { clamp, hash, R, seeded } from './core.js';
import { surfaceOf } from './lands.js';
import { trailPoint } from './layout.js';
import { boulder, car, eyes, fieldGate, GREAT, greatTree, house, lamp, landmark, shaft, tree, wisp } from './scenery.js';
import { campfire, litter, onTrack, picnic, stray, tracksOf, walker } from './tracks.js';

const overlaps = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

/* Boxes, kept by the rows they cover (sixty-four to a shelf). "Is anything in
   the way of this one" is asked thirteen thousand times while a board's
   trees are planted, and asked of every box on the board each time it was
   most of what opening the board cost: only the boxes on the same shelves
   can be in the way. */
function shelves(boxes) {
  const rows = new Map();
  const out = {
    push(box) {
      for (let k = Math.floor(box[1] / 64), b = Math.floor(box[3] / 64); k <= b; k++) { let r = rows.get(k); if (!r) rows.set(k, r = []); r.push(box); }
    },
    hits(box) {
      for (let k = Math.floor(box[1] / 64), b = Math.floor(box[3] / 64); k <= b; k++) {
        const r = rows.get(k);
        if (r) for (let i = 0; i < r.length; i++) if (overlaps(r[i], box)) return true;
      }
      return false;
    },
  };
  if (boxes) boxes.forEach(out.push);
  return out;
}

/* Where everything stands is worked out once for a layout, and kept. Each
   item is { box, base, draw(c, state), tag }, sorted so the nearer ones
   overlap the further. */
const scenes = new WeakMap();

export function sceneOf(layout) {
  let s = scenes.get(layout);
  if (!s) { s = buildScene(layout); scenes.set(layout, s); }
  return s;
}

/* How many trees are tried for each row of the board at a level, and what
   one that takes is: null in the open field, saplings at the wood's edge,
   and on to trunks like towers. `a` and `b` are two draws, 0..1. */
const tries = (lv) => (lv < 6.5 ? 0 : lv < 15 ? 0.77 : lv < 45 ? 1.43 : lv < 75 ? 2.6 : 3.6);

function standAt(lv, a, b) {
  if (lv < 15) {
    // The wood's edge: saplings first, then proper trees down both sides.
    const e = clamp((lv - 6.5) / 8.5, 0, 1);
    if (a > e * 1.1 + 0.08) return null;
    return { sapling: true, r: [7, 9, 11][R(b * 2)], th: 7, hw: 1, kind: b < 0.3 ? 'haw' : 'round', gap: 6, room: 8, sides: lv > 10 ? 0.1 + e * 0.2 : 0 };
  }
  if (lv < 45) {
    // The forest: young and open for its first few levels, then walls of it.
    const d = clamp((lv - 15) / 30, 0, 1);
    if (lv < 20 && b > 0.45 + (lv - 15) * 0.11) return null;
    const r = [7, 9, 11, 12][Math.min(3, R(b * 2 + d * 1.2))];
    const kind = a < 0.2 + d * 0.12 ? 'pine' : a < 0.5 ? 'haw' : 'round';
    return { r: kind === 'pine' ? Math.min(r, 11) : r, th: 8 + 2 * R(d * 2.4 + b * 0.8), hw: r >= 12 ? 2 : 1, kind, gap: 6 - d * 3, room: 9 - d * 3 };
  }
  if (lv < 75) {
    // The old forest: giants with mossy feet, dark pines between them.
    const d = clamp((lv - 45) / 30, 0, 1);
    if (a < 0.55 + d * 0.2) return { r: b < 0.5 ? 12 : 14, th: 13 + 3 * R(d * 2.2 + b * 1.4), hw: 2 + (b < 0.4 + d * 0.3 ? 1 : 0), kind: a < 0.2 ? 'haw' : 'round', gap: 3 - d * 2, room: 9 - d * 3 };
    return { r: b < 0.5 ? 9 : 11, th: 10 + 3 * R(b * 2), hw: 1, kind: 'pine', gap: 3, room: 8 };
  }
  // The ancient wood: towers of trunk, and the dead standing among them.
  const d = clamp((lv - 75) / 25, 0, 1);
  if (a < 0.12) return { r: 5, th: 20 + 4 * R(b * 2), hw: 1 + R(b), kind: 'snag', gap: 2, room: 9 };
  return { r: [13, 15, 17][R(b * 2)], th: 20 + 4 * R(d * 2 + b * 1.5), hw: 3 + R(b * (0.6 + d)), kind: a < 0.3 ? 'haw' : 'round', gap: 1.5 - d, room: 8 - d * 2 };
}

const TRY = [0, 0, 0, 0];

function buildScene(layout) {
  const { W, H, stones, clear, bosses, pathDist, landAt, levelAt, heart } = layout;
  const rnd = seeded(7);
  const placed = shelves(), feet = shelves(), stood = shelves(clear), items = [];
  /* Keep out of the band a boss's own art fills, off every stone and the
     tag that hangs under it, and off the roads, the water and the glade. */
  const inBand = (box) => bosses.some(b => box[1] < b.y + 8 && box[3] > b.y - (b.kind === 'hamlet' || b.kind === 'heart' ? 62 : 40));
  const kept = shelves(stones.map(s => [s.x - 15, s.y - 10, s.x + 15, s.y + 22]));
  for (const cr of layout.crossings) kept.push([0, cr.y - 9, W, cr.y + (cr.kind === 'brook' ? 7 : 10)]);
  for (const b of bosses) if (b.kind === 'bridge') kept.push([0, b.y - 16, W, b.y + 2]);
  if (layout.park) { const p = layout.park; kept.push([p.x - p.rx - 2, p.y - p.ry - 2, p.x + p.rx + 2, p.y + p.ry + 3]); }
  if (heart) kept.push([heart.x - heart.rx + 8, heart.y - heart.ry + 10, heart.x + heart.rx - 8, heart.y + heart.ry - 6]);
  const clearOf = (box) => !inBand(box) && !stood.hits(box) && !kept.hits(box);
  const free = (box, gap = 5) => box[0] >= 0 && box[2] <= W && clearOf(box) && !placed.hits(box) && !feet.hits(box) &&
    pathDist((box[0] + box[2]) / 2, (box[1] + box[3]) / 2) > Math.max(box[2] - box[0], box[3] - box[1]) / 2 + gap;
  /* `tag` says what a thing is and where, for whatever wants to bring it
     to life afterwards (ambient.js): the picture itself never needs it. */
  const put = (box, base, draw, tag) => { placed.push(box); items.push({ box, base, draw, tag: tag || null }); };
  /* A tree keeps its whole self off the trail, the stones and the things on
     the ground, but only its foot off other trees: crowns close overhead. */
  const plant = (x, base, s, land) => {
    const { r, th, hw, kind } = s;
    const top = base - th - r * 2 + 2, cy = base - th - r + 2;
    /* Another tree's foot is what is most often in the way: asked first,
       and of a box that is only kept if the tree is (most are not, and
       thirteen thousand boxes thrown away were the collector's work). */
    TRY[0] = x - s.room; TRY[1] = base - R(s.room * 0.7); TRY[2] = x + s.room; TRY[3] = base + 2;
    if (feet.hits(TRY)) return false;
    const foot = TRY.slice(), box = [x - r - 1, top, x + r + 2, base + 2];
    if (!clearOf(box) || placed.hits(box)) return false;
    if (pathDist(x, cy) < r + s.gap || pathDist(x, base - 2) < hw + 9 || pathDist(x, base - th / 2) < hw + 7) return false;
    feet.push(foot);
    items.push({ box, base, draw: (c) => tree(c, x, base, land, r, kind, { th, hw }), tag: { k: 'tree', x, y: base, r, th, hw, land } });
    return true;
  };
  /* A thing near a level's stone, wherever there is room. */
  const near = (level, ext, draw, tag, o = {}) => {
    const s = stones[level - 1];
    if (!s) return null;
    for (let k = 0; k < (o.tries || 60); k++) {
      const x = R(rnd() * W), y = R(s.y - (o.span || 20) + rnd() * (o.span || 20) * 2);
      const box = [x + ext[0], y + ext[1], x + ext[2], y + ext[3]];
      if (!free(box, o.gap == null ? 5 : o.gap)) continue;
      const land = landAt(y);
      put(box, y, (c) => draw(c, x, y, land), tag ? Object.assign({ x, y }, tag) : null);
      return [x, y];
    }
    return null;
  };
  const MARK = { log: [-9, -4, 9, 3], mushrooms: [-6, -5, 7, 3], stump: [-4, -5, 4, 2], deer: [-9, -28, 14, 3], pond: [-18, -10, 22, 8], signpost: [-6, -11, 7, 2], logpile: [-16, -19, 18, 3] };
  const mark = (level, name) => near(level, MARK[name], (c, x, y, land) => landmark(c, name, x, y, land), { k: name });
  const fixed = (box, base, draw, tag) => { placed.push(box); items.push({ box, base, draw, tag: tag || null }); };

  /* ── The trailhead: a gate standing open, grass, sky. Nothing else. ── */
  {
    const gy = H - 5, gx = R(layout.xAt[clamp(gy, 0, H)] || stones[0].x);
    items.push({ box: [0, gy - 18, W, gy + 3], base: gy - 60, draw: (c) => fieldGate(c, gx, gy, W), tag: null });
  }

  /* ── Who else is out here, on the tracks they are leaving ── */
  for (const t of tracksOf(layout)) {
    if (t.who !== 'walker') continue;
    const [wx, wy, left] = onTrack(layout, t, 36), land = landAt(wy), second = t.level > 45;
    const box = left ? [wx - 38, wy - 38, wx + 9, wy + 4] : [wx - 9, wy - 38, wx + 38, wy + 4];
    fixed(box, wy + 1, (c) => walker(c, wx, wy + 1, land, left, second ? { jacket: 'hivis', hat: 'bush' } : {}), { k: 'walker', x: wx, y: wy });
    // The fingerpost where their path leaves the trail.
    const [px, py] = onTrack(layout, t, -14), pbox = [px - 6, py - 14, px + 7, py];
    fixed(pbox, py - 3, (c) => landmark(c, 'signpost', px, py - 3, land));
  }

  /* ── The field and the wood's edge ── */
  mark(13, 'log');

  /* ── The forest: what a walk in one turns up ── */
  mark(19, 'mushrooms'); mark(22, 'stump'); mark(26, 'deer'); mark(29, 'mushrooms'); mark(34, 'log');
  mark(36, 'pond'); mark(41, 'deer'); mark(43, 'stump');
  /* Felled timber beside the forestry track. */
  for (const cr of layout.crossings) {
    if (cr.kind !== 'track') continue;
    const x = cr.x > W / 2 ? R(W * 0.2) : R(W * 0.8), y = cr.y - 9;
    fixed([x - 16, y - 19, x + 18, y + 3], y, (c) => landmark(c, 'logpile', x, y, cr.land), { k: 'logpile', x, y });
  }
  /* The fork before the footbridge has a fingerpost. */
  if (bosses[1]) { const s = stones[bosses[1].level - 2]; if (s) near(s.level, MARK.signpost, (c, x, y, land) => landmark(c, 'signpost', x, y, land), null, { span: 14, gap: 2 }); }

  /* ── The old forest: everybody's leavings ── */
  near(50, [-11, -7, 13, 6], (c, x, y, land) => picnic(c, x, y, land), { k: 'picnic' }, { gap: 2 });
  near(58, [-11, -7, 13, 6], (c, x, y, land) => { picnic(c, x, y, land); litter(c, x + 9, y + 4, 0.1); }, { k: 'picnic' }, { gap: 2 });
  /* Somebody camped by the trail: tent, fire, and what they left (the tag
     says where the tent and the fire are from the camp's own x and y, for
     whatever makes the fire flicker). On a
     narrow board there is no room for the fire beside the tent, so it is
     pitched with the fire in front of its door. */
  const camp = (level, fire) => near(level, [-30, -16, 32, 8], (c, x, y, land) => {
    landmark(c, 'tent', x - 14, y, land);
    if (fire) campfire(c, x + 14, y + 2);
    litter(c, x + 22, y + 5, 0.1); litter(c, x - 2, y + 6, 0.5); if (fire) litter(c, x + 6, y - 6, 0.9);
  }, { k: 'camp', tent: [-14, 0], fire: fire ? [14, 2] : null }, { span: 26, gap: 2 }) || near(level, [-17, -16, 18, 11], (c, x, y, land) => {
    landmark(c, 'tent', x, y, land);
    if (fire) campfire(c, x + 8, y + 7);
    litter(c, x - 12, y + 6, 0.5);
  }, { k: 'camp', tent: [0, 0], fire: fire ? [8, 7] : null }, { span: 40, gap: 2, tries: 240 });
  camp(61, true);
  mark(48, 'deer'); mark(53, 'log'); mark(55, 'mushrooms'); mark(56, 'deer'); mark(63, 'signpost'); mark(64, 'stump');
  /* The forestry road: stacks of timber beside it, and the car park where
     it turns to tarmac. */
  mark(67, 'logpile'); mark(69, 'logpile');
  if (layout.park) {
    const p = layout.park, cols = ['#c8443a', '#3f8a9a', '#d9b23a'];
    /* Two cars in it, nosed in at an angle to each other. */
    for (let k = 0; k < 2; k++) {
      const x = p.x + (k ? 5 : -6), y = p.y + (k ? 10 : -3);
      fixed([x - 16, y - 14, x + 17, y + 3], y, (c) => car(c, x, y, cols[k], k === 0), { k: 'car', x, y });
    }
    const sx = p.x + p.side * (p.rx - 3), sy = p.y - p.ry - 1;
    fixed([sx - 6, sy - 25, sx + 7, sy + 2], sy, (c) => landmark(c, 'parksign', sx, sy, 'old'));
    fixed([p.x - 4, p.y + p.ry - 4, p.x + 8, p.y + p.ry + 2], p.y + p.ry, (c) => { litter(c, p.x - 2, p.y + p.ry - 2, 0.1); litter(c, p.x + 4, p.y + p.ry - 1, 0.9); });
  }
  /* The lane on to the hamlet: a lantern at each bend, and the first
     cottages standing back from it among the trees. */
  const town = bosses.find(b => b.kind === 'hamlet');
  if (town) {
    for (const lvl of [town.level - 3, town.level - 2, town.level - 1]) {
      const s = stones[lvl - 1];
      if (!s || surfaceOf(lvl + 0.5) !== 'tarmac') continue;
      for (const [u, far] of [[0.5, 15], [0.5, -15], [0.36, 16], [0.64, 16], [0.36, -16], [0.64, -16], [0.5, 24], [0.5, -24]]) {
        const p = trailPoint(layout, lvl - 1, u);
        const x = clamp(R(p[0] + (p[0] < W / 2 ? -1 : 1) * far), 5, W - 6), base = R(p[1] + 2);
        const box = [x - 9, base - 26, x + 10, base + 6];
        if (!clearOf(box) || placed.hits(box)) continue;
        put(box, base, (c) => lamp(c, x, base), { k: 'lamp', x, y: base });
        break;
      }
    }
    for (const [lvl, seed] of [[town.level - 2, 4], [town.level - 1, 9]]) {
      const s = stones[lvl - 1];
      for (let k = 0; s && k < 60; k++) {
        const w = [38, 44][k % 2], h = 17, x = rnd() < 0.5 ? R(w / 2 + 3 + rnd() * W * 0.16) : R(W - w / 2 - 4 - rnd() * W * 0.16);
        const base = R(s.y - 30 + rnd() * 50);
        const box = [x - (w >> 1) - 3, base - h - R(w * 0.3) - 8, x + (w >> 1) + 10, base + 8];
        if (!free(box, 3)) continue;
        put(box, base, (c) => house(c, x, base, w, h, seed), { k: 'house', x, y: base, w, h, seed });
        break;
      }
    }
  }

  /* ── The ancient wood ── */
  camp(80, false);
  mark(84, 'signpost'); mark(90, 'log');
  /* Other dogs: nobody's, and they have been everywhere up here. */
  [93, 94, 96].forEach((lvl, k) => near(lvl, [-12, -15, 13, 3], (c, x, y, land) => stray(c, x, y, land, x > W / 2, k), { k: 'stray' }, { gap: 3 }));
  /* A car on the lane, its lamps on: they lie across the trail. It is in
     the picture only where nothing moves (`traffic` is false when the
     ambient layer is driving cars along the lane itself). */
  if (layout.roadY != null) {
    const y = layout.roadY + 4, lane = layout.crossings.find(cr => cr.kind === 'lane');
    const leftSide = lane.x > W / 2, x = leftSide ? 19 : W - 20;
    fixed([x - 16, y - 14, x + 17, y + 3], y, (c, st) => { if (!st || st.traffic !== false) car(c, x, y, '#8a2a2a', !leftSide, true); }, { k: 'car', x, y, beams: true, left: !leftSide });
  }
  /* The great tree at the heart of the wood, beside the last stone. */
  if (heart) {
    const tx = heart.tx, ty = heart.ty;
    fixed([tx - GREAT.hw - 12, ty - GREAT.th, tx + GREAT.hw + 12, ty + 4], ty, (c, st) => greatTree(c, tx, ty, !st || st.glade !== false), { k: 'great', x: tx, y: ty });
  }

  /* ── Small things under the trees, by depth ── */
  for (let y = 0; y < H; y += 34) {
    const yy = R(y + rnd() * 30), lv = levelAt(yy), land = landAt(yy), x = R(8 + rnd() * (W - 16)), pick = rnd();
    if (lv < 16 || (heart && yy < heart.y + heart.ry)) continue;
    const box = [x - 6, yy - 5, x + 7, yy + 3];
    if (!free(box, 2)) continue;
    if (land !== 'forest' && pick < 0.3) { const r = 5 + R(rnd() * 4), bb = [x - r - 1, yy - r, x + r + 2, yy + 2]; if (free(bb, 3)) put(bb, yy, (c) => boulder(c, x, yy, r, land)); continue; }
    const name = pick < 0.6 ? 'mushrooms' : pick < 0.8 ? 'stump' : 'log';
    put(box, yy, (c) => landmark(c, name, x, yy, land));
  }
  /* Litter: more of it the further in, and never far from the trail. */
  for (let y = 0; y < H; y += 6) {
    const yy = R(y + rnd() * 5), lv = levelAt(yy), x = R(6 + rnd() * (W - 12)), kk = rnd(), take = rnd();
    if (lv < 46 || take > (lv < 76 ? 0.25 + (lv - 46) / 60 : 0.6)) continue;
    const box = [x - 2, yy - 2, x + 6, yy + 3];
    if (!free(box, 1) || pathDist(x, yy) > 34) continue;
    put(box, yy, (c) => litter(c, x, yy, kk));
  }

  /* ── The trees ── */
  for (let y0 = 0; y0 < H; y0 += 8) {
    const lvBand = levelAt(y0 + 4), n = tries(lvBand) * 8;
    for (let k = 0; k < n; k++) {
      const x = R(-10 + rnd() * (W + 20)), base = R(y0 + rnd() * 8), a = rnd(), b = rnd(), lv = levelAt(base);
      const s = standAt(lv, a, b);
      if (!s) continue;
      const land = landAt(base - 4);
      if (s.sapling) {
        // Proper trees only down the field's sides; young ones anywhere off the trail.
        if (s.sides && Math.min(x, W - x) < W * s.sides && rnd() < 0.7) { plant(x, base, s, land); continue; }
        if (pathDist(x, base) <= 15) continue;
        const box = [x - 4, base - 13, x + 5, base + 2];
        if (free(box, 4)) put(box, base, (c) => tree(c, x, base, land, 4, 'sapling'));
        continue;
      }
      plant(x, base, s, land);
    }
  }

  /* ── The air: mist between the trunks, more of it the further in ── */
  for (let y = 0; y < H; y += 12) {
    const yy = R(y + rnd() * 11), lv = levelAt(yy), x = R(rnd() * W), len = 34 + R(rnd() * 46), take = rnd();
    if (lv < 46 || (heart && yy < heart.y + heart.ry + 10)) continue;
    const d = lv < 76 ? clamp((lv - 45) / 30, 0, 1) * 0.75 + 0.2 : 1;
    if (take > d || pathDist(x, yy) < len / 2 + 5) continue;
    const old = lv < 76;
    items.push({ box: [x - len / 2, yy - 2, x + len / 2, yy + 3], base: yy + 4, draw: (c) => wisp(c, x, yy, len, old ? '190,226,214' : '150,190,200', old ? 0.2 + d * 0.08 : 0.2), tag: { k: 'wisp', x, y: yy, len } });
  }

  /* Eyes beside some of the ancient trunks, and shafts of light (the sun in
     the forest, paler in the old forest, the moon at the top): these go
     over everything, so they are last however near they are. */
  const air = [];
  for (const it of items) {
    const g = it.tag;
    if (!g || g.k !== 'tree' || g.land !== 'ancient' || g.hw < 2 || hash(g.x * 31 + g.y) > 0.11) continue;
    const ex = g.x + (g.x < W / 2 ? g.hw + 3 : -g.hw - 7), ey = g.y - 5 - R(hash(g.y) * 8);
    if (ex < 2 || ex > W - 6) continue;
    air.push({ box: [ex - 1, ey - 1, ex + 5, ey + 2], base: 1e9, draw: (c) => eyes(c, ex, ey), tag: { k: 'eyes', x: ex, y: ey } });
  }
  for (const s of stones) {
    const every = s.level < 46 ? 7 : s.level < 76 ? 6 : 3;
    if (s.level < 24 || s.boss || s.level >= stones.length - 1 || s.level % every !== 1 || surfaceOf(s.level + 0.5) !== 'earth') continue;
    const p = trailPoint(layout, s.level - 1, 0.5), w = 7 + (s.level % 4), len = 46 + (s.level % 5) * 5;
    const x = p[0] - (w >> 1) + (s.level % 2 ? 10 : -12), y = p[1] + 3;
    const rgb = s.level < 46 ? [255, 244, 196] : s.level < 76 ? [226, 244, 214] : [196, 226, 255];
    air.push({ box: [x - len * 0.55, y - len, x + w + 4, y + 5], base: 1e9, draw: (c) => shaft(c, x, y, w, len, rgb), tag: { k: 'shaft', x, y, w, len } });
  }
  /* The moon comes down into the glade in three shafts. */
  if (heart) {
    const s = stones[stones.length - 1];
    for (const [dx, w, len] of [[-22, 9, 60], [6, 12, 70], [30, 8, 54]]) {
      const x = s.x + dx, y = s.y + 6;
      air.push({ box: [x - len * 0.55, y - len, x + w + 4, y + 5], base: 1e9, draw: (c, st) => { if (!st || st.glade !== false) shaft(c, x, y, w, len, [196, 232, 255]); }, tag: { k: 'shaft', x, y, w, len, moon: true } });
    }
  }
  items.sort((a, b) => a.base - b.base);
  return items.concat(air);
}
