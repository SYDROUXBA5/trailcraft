/* The ground under it all, painted a band of rows at a time and pixel by
   pixel: big quiet tonal shapes first (mown and long grass, sun pools on a
   forest floor, moss and deep shade), then the water and the hard ground,
   then the trail on top of it, then the small things that lie on the ground.

   Every pixel is a function of where it is and nothing else, so a tile
   paints the same rows the same way whatever is painted around it. How deep
   a row is (layout.levelAt) drives all of it: the field opens out, the wood
   closes in, the trail narrows and frays. */

import { bayer, clamp, hash, hexToRgb, mix, R, smooth } from './core.js';
import { castOf, GRAVEL, LANDS, ROAD, surfaceOf, TARMAC, trailHalf, trailRough } from './lands.js';
import { RAMPS } from './ramps.js';
import { fbm, vnoise } from './terrain.js';
import { gateX, pathRange, streamY } from './layout.js';

const rgb = (ramp) => ramp.map(hexToRgb);
const one = hexToRgb;
const FI = LANDS.field, FO = LANDS.forest, OL = LANDS.old, AN = LANDS.ancient;

/* Each land's ground in tones. A ramp has no tone between `base` and
   `shade`, and a large area needs one (long grass, deep shade): those are
   mixed here, once. */
const FIELD = { g: rgb(FI.floor), long: one(mix(FI.floor[2], FI.floor[1], 0.55)), path: rgb(FI.path) };
const FOR = { g: rgb(FO.floor), deep: one(mix(FO.floor[2], FO.floor[1], 0.5)), path: rgb(FO.path) };
const OLD = { g: rgb(OL.floor), mid: one(mix(OL.floor[1], OL.floor[2], 0.5)), path: rgb(OL.path), moss: [one(OL.mossLo), one(OL.moss)] };
const ANC = { g: rgb(AN.floor), mid: one(mix(AN.floor[1], AN.floor[2], 0.45)), path: rgb(AN.path), moon: rgb(AN.moon), black: one('#060a12') };
const WATER = { field: rgb(FI.water), edge: rgb(FI.water), forest: rgb(FO.water), old: rgb(OL.water), ancient: rgb(AN.water) };
const BANK = { field: FIELD.g[0], edge: FIELD.g[0], forest: FOR.g[0], old: OLD.g[0], ancient: ANC.g[0] };
const PATH = { field: FIELD.path, edge: FIELD.path, forest: FOR.path, old: OLD.path, ancient: ANC.path };
const GRV = rgb(GRAVEL), TAR = rgb(TARMAC);

/* In the dark lands the floor is a tone lighter beside the trail, so the
   trail lies in a soft corridor of what light there is and never against
   black. This is each floor tone's next one up. */
const UP = new Map();
[[OLD.g[0], OLD.g[1]], [OLD.g[1], OLD.mid], [OLD.mid, OLD.g[2]], [OLD.g[2], OLD.g[3]], [OLD.moss[0], OLD.moss[1]],
  [ANC.black, ANC.g[0]], [ANC.g[0], ANC.g[1]], [ANC.g[1], ANC.mid], [ANC.mid, ANC.g[2]], [ANC.g[2], ANC.g[3]]].forEach(([a, b]) => UP.set(a, b));

/* A short upright tick (a blade of grass) or a short flat one (a leaf):
   two pixels, never one, so the texture is clusters and not noise. */
const tickV = (x, y, s) => hash((x * 7919 + s * 31) ^ ((y >> 1) * 104729));
const tickH = (x, y, s) => hash(((x >> 1) * 7919 + s * 31) ^ (y * 104729));

/* What the shaders say about a pixel besides its colour: the tone of the
   trail's verge there, whether a trail can be worn into it, and whether it
   is hard ground (a road keeps no path). LV is the depth of the row. */
let VERGE = null, OPEN = true, HARD = null, LV = 1;
/* The moon comes fully into the glade at the heart of the wood for whoever
   gets there: until then it is only a glimmer. */
let GLADE = true;

/** The field's patches: above 0.6 mown and sunlit, below 0.37 long grass. */
const meadowField = (x, y) => fbm(x, y, 44, 1) + (vnoise(x, y, 5, 2) - 0.5) * 0.14;

function fieldPx(x, y) {
  /* The first field is nearly all mown and in the sun; the long grass
     comes in as the wood gets nearer, and stands thick at its edge. */
  const n = meadowField(x, y) + smooth((9 - LV) / 6) * 0.2 - smooth((LV - 10) / 5) * 0.1, G = FIELD.g;
  VERGE = G[3];
  if (n > 0.6) return tickV(x, y, 1) < 0.045 ? G[2] : n > 0.66 && tickH(x, y, 2) < 0.03 ? G[4] : G[3];
  if (n < 0.37) { const k = tickV(x, y, 3); return k < 0.17 ? G[1] : k > 0.93 ? G[2] : FIELD.long; }
  const k = tickV(x, y, 4);
  return k < 0.04 ? FIELD.long : k > 0.975 ? G[3] : G[2];
}

/** The forest's floor lies in long bands down the light: 0..1. */
const woodField = (x, y) => fbm((x * 0.86 + y * 0.51) / 2.3, -x * 0.51 + y * 0.86, 24, 3);

function forestPx(x, y) {
  /* Shade is the rule and the sun comes down in pools, broken into
     leaf-sized dapples, fewer of them the deeper it goes. */
  const d = clamp((LV - 15) / 30, 0, 1);
  const n = woodField(x, y), G = FOR.g, k = tickH(x, y, 5);
  VERGE = G[2];
  if (n > 0.56 + d * 0.1) { const dap = vnoise(x, y, 5, 41); return dap > 0.42 ? (k < 0.07 ? G[4] : G[3]) : G[2]; }
  if (n < 0.38 + d * 0.13) return k < 0.06 ? G[0] : k > 0.95 ? G[2] : n < 0.3 + d * 0.1 ? G[1] : FOR.deep;
  return k < 0.05 ? G[3] : k > 0.94 ? FOR.deep : G[2];
}

function oldPx(x, y) {
  /* Deep shade, cushions of moss, a rare pool of light. */
  const d = clamp((LV - 45) / 30, 0, 1);
  const n = fbm(x, y, 30, 5), G = OLD.g, k = tickH(x, y, 6);
  VERGE = G[1];
  /* The pools of light close and the deep shade spreads, level by level:
     the old forest is darker at its far end than where it starts. */
  if (n > 0.66 + d * 0.16) return vnoise(x, y, 5, 43) > 0.5 ? (k < 0.07 ? G[4] : G[3]) : G[2];
  if (vnoise(x, y * 1.5, 8, 44) > 0.8 - (1 - d) * 0.03) return k < 0.12 ? OLD.moss[1] : OLD.moss[0];
  if (n < 0.44 + d * 0.2) return k < 0.05 ? G[2] : n < 0.34 + d * 0.2 ? G[0] : G[1];
  return k < 0.04 ? G[2] : k > 0.95 ? G[1] : OLD.mid;
}

function ancientPx(layout, x, y) {
  const G = ANC.g, k = tickH(x, y, 8), ht = layout.heart;
  VERGE = G[1];
  if (ht) {
    /* The glade: moonlight on moss, brightest round the last stone, its
       edge the ragged shadow of the trees that ring it. */
    const q = ((x - ht.x) * (x - ht.x)) / (ht.rx * ht.rx) + ((y - ht.y) * (y - ht.y)) / (ht.ry * ht.ry) + (vnoise(x, y, 9, 95) - 0.5) * 0.36;
    if (q < 1) {
      const Mo = ANC.moon, lit = GLADE ? 0 : 0.3;
      VERGE = Mo[1];
      if (q + lit < 0.3) return k < 0.08 ? Mo[3] : vnoise(x, y, 4, 96) > 0.6 ? Mo[2] : Mo[1];
      if (q + lit < 0.62) return k < 0.05 ? Mo[2] : vnoise(x, y, 5, 97) > 0.55 ? Mo[1] : Mo[0];
      return bayer(x, y) < (1 - q) * 2.2 ? Mo[0] : G[3];
    }
    /* Beyond it the wood closes over: nothing comes down through that. */
    const up = (ht.y - ht.ry - y) / 46;
    if (up > 0 && bayer(x, y) < up * 0.95 + (vnoise(x, y, 11, 98) - 0.5) * 0.5) { OPEN = false; return ANC.black; }
  }
  /* Almost no light reaches the floor, and less of it the further in. */
  const n = fbm(x, y, 28, 11), d = clamp((LV - 76) / 22, 0, 1);
  if (n > 0.72 + d * 0.12) return k < 0.06 ? G[3] : G[2];
  if (n < 0.46 + d * 0.14) return k < 0.04 ? G[1] : G[0];
  return k < 0.05 ? G[2] : k > 0.96 ? G[0] : ANC.mid;
}

/* Rolled road stone: paler where the wheels do not run, darker in the two
   ruts, a few bigger stones catching the light. `a` is how far from the
   middle, in pixels. */
function gravelPx(x, y, a) {
  const k = hash(x * 131 + y * 7919);
  if (a > 1.6 && a < 3.6) return k < 0.3 ? GRV[2] : GRV[1];
  return k < 0.05 ? GRV[4] : k < 0.3 ? GRV[3] : k > 0.94 ? GRV[1] : GRV[2];
}

function tarmacPx(x, y) {
  const k = hash(x * 131 + y * 7919);
  return vnoise(x, y * 2, 7, 93) > 0.76 ? TAR[3] : k < 0.05 ? TAR[1] : TAR[2];
}

/* What lies across the board there, or null: the forestry track (a gravel
   road that wanders a little) and the lane (tarmac, ruled, with its white
   edge lines and a broken line down the middle). */
function bandPx(cr, x, y, bank) {
  if (cr.kind === 'track') {
    const a = Math.abs(y - cr.y - R(2.4 * Math.sin(x / 23 + cr.level)));
    const rag = vnoise(x, y, 4, 91) > 0.5 ? 1 : 0;
    if (a > 6 + rag) return null;
    HARD = 'track';
    return a > 5 ? bank : gravelPx(x, y, a);
  }
  if (cr.kind === 'lane') {
    const dy = y - cr.y, a = Math.abs(dy);
    if (a > 8 || dy === -8) return null;
    HARD = 'lane';
    if (a === 8) return bank;
    if (a === 7) return TAR[0];
    if (a === 6) return x % 23 < 20 ? TAR[4] : TAR[2];
    if (dy === 0 && x % 14 < 7) return TAR[4];
    return tarmacPx(x, y);
  }
  return null;
}

/* The car park: a gravel bay beside the road, kerbed with logs on the
   three sides away from it, its bays marked off by a line of pale stone. */
function parkPx(p, x, y) {
  const ax = Math.abs(x - p.x) - p.rx, ay = Math.abs(y - p.y) - p.ry;
  const q = Math.hypot(Math.max(ax + 4, 0), Math.max(ay + 4, 0)) - 4;
  if (q > 1) return null;
  HARD = 'park';
  if (q > 0) return (x - p.x) * p.side < -p.rx + 2 ? gravelPx(x, y, 0) : y < p.y ? OLD.g[4] : OLD.g[0];
  if (q > -1.2 && (x - p.x) * p.side > -p.rx + 2) return y < p.y - p.ry + 2 || (x - p.x) * p.side > p.rx - 2 ? one('#8a6a48') : one('#4a3626');
  const bay = ((x - p.x + p.rx) % 15 + 15) % 15;
  if (bay === 14 && ay < -3 && ay > -p.ry * 2 + 3 && y % 3 !== 2 && y < p.y + 3) return GRV[4];
  return gravelPx(x, y, 0);
}

/* A band of water across the board, or null where there is none. */
function waterPx(w, x, y, P, bank) {
  const dy = y - streamY(w, x), half = w.half;
  if (dy < -half - 1 || dy > half + 1) return null;
  if (dy === -half - 1 || dy === half + 1) return bank;
  if (dy === -half) return P[0];
  if (dy === -half + 1) return P[1];
  const s = vnoise(x / 2.6, y * 2.1, 4, 50 + w.seed);
  if (dy === half) return tickH(x, y, 9) < 0.3 ? P[3] : P[1];
  return s > 0.8 ? P[4] : s > 0.62 ? P[3] : s < 0.25 ? P[1] : P[2];
}

/* Through its last ten levels the old forest's floor goes over to the
   ancient wood's in patches that grow and join, so the wood has been
   darkening for a long way by the hamlet's wall and does not drop to black
   behind it. */
const deepening = (L, x, y) => (LV > 65.5 && vnoise(x, y, 13, 88) + (bayer(x, y) - 0.5) * 0.1 < (LV - 65.5) / 9.5 * 0.66 ? ancientPx(L, x, y) : oldPx(x, y));
const FLOOR = { field: (L, x, y) => fieldPx(x, y), edge: (L, x, y) => fieldPx(x, y), forest: (L, x, y) => forestPx(x, y), old: deepening, ancient: ancientPx };

function groundPixels(layout, y0, y1) {
  const { W, H, bosses, stones, xAt } = layout;
  const h = y1 - y0, img = new ImageData(W, h), d = img.data;
  for (let r = 0; r < h; r++) {
    const y = y0 + r;
    const rowLand = layout.landAt(y);
    LV = layout.levelAt(y);
    const half = trailHalf(LV), rough = trailRough(LV);
    const tx = xAt[clamp(y, 0, H)], ta = xAt[clamp(y - 2, 0, H)], tb = xAt[clamp(y + 2, 0, H)];
    const lean = ta === ta && tb === tb ? (ta - tb) / 4 : 0;
    const cosF = 1 / Math.sqrt(1 + lean * lean);
    const near = stones.filter(s => !s.boss && Math.abs(s.y - y) <= 7);
    const crs = layout.crossings.filter(cr => cr.kind !== 'brook' && Math.abs(cr.y - y) <= 10);
    const waters = layout.waters.filter(w => Math.abs(w.y - y) <= w.half + 7);
    const park = layout.park && Math.abs(layout.park.y - y) <= layout.park.ry + 2 ? layout.park : null;
    /* One land gives way to the next in tongues, over two dozen rows each
       side of the boss that stands between them, never on a line. */
    let seam = null;
    for (let k = 0; k < bosses.length - 1; k++) if (Math.abs(y - bosses[k].y) < 24) seam = { y: bosses[k].y, lo: layout.landAt(bosses[k].y + 30), hi: layout.landAt(bosses[k].y - 30), k };
    for (let x = 0; x < W; x++) {
      let land = rowLand;
      if (seam) land = (seam.y - y) / 13 + (vnoise(x, y, 9, 77 + seam.k) - 0.5) * 2 > 0 ? seam.hi : seam.lo;
      OPEN = true; HARD = null;
      let col = FLOOR[land](layout, x, y);
      for (let i = 0; i < crs.length; i++) { const bc = bandPx(crs[i], x, y, BANK[land]); if (bc) { col = bc; VERGE = null; } }
      if (park) { const pc = parkPx(park, x, y); if (pc) { col = pc; VERGE = null; } }
      let wet = false;
      for (let i = 0; i < waters.length; i++) {
        const w = waters[i];
        const wc = waterPx(w, x, y, WATER[w.land], BANK[w.land]);
        if (wc) { col = wc; wet = true; }
      }
      if (OPEN && !wet && tx === tx) {
        const dd = Math.abs(x - tx) * cosF;
        /* The road's surface changes over a few rows, not on one. */
        const surf = LV > ROAD.gravel[0] - 0.2 && LV < ROAD.tarmac[1] + 0.2 ? surfaceOf(LV + (bayer(x, y) - 0.5) * 0.1) : 'earth';
        if (HARD === 'lane' || HARD === 'track') {
          /* Nothing is worn into a road: where the trail goes over one there
             is only the dirt feet have carried on to it. */
          if (dd < 2.2 && bayer(x, y) < 0.55 - dd * 0.12) col = PATH[land][2];
        } else if (surf === 'gravel') {
          const e = ROAD.half - dd + (vnoise(x, y, 4, 33) - 0.5) * 1.2;
          if (e >= 0) col = e < 1 ? GRV[1] : gravelPx(x, y, dd);
          else if (HARD !== 'park' && VERGE && e > -1.6) col = VERGE;
        } else if (surf === 'tarmac') {
          const e = ROAD.half - dd;
          if (e >= 0) col = e < 0.9 ? TAR[0] : e < 1.9 ? (y % 11 < 9 ? TAR[4] : TAR[2]) : tarmacPx(x, y);
          else if (HARD !== 'park' && e > -1.2) col = TAR[0];
        } else if (HARD !== 'park') {
          const P = PATH[land];
          /* The trail narrows and its edges fray as the wood closes in. */
          let e = half - dd + (rough ? (vnoise(x, y, 4, 33) - 0.5) * 1.9 * rough : 0);
          /* Feet have worn the ground bare round every stone. */
          for (let i = 0; i < near.length; i++) {
            const s = near[i], q = Math.sqrt(((x - s.x) * (x - s.x)) / 121 + ((y - s.y) * (y - s.y)) / 36);
            if (q < 1.3) e = Math.max(e, (1 - q) * 6);
          }
          if (e >= 0) {
            const k = hash(x * 131 + y * 7919);
            col = e < (half < 4 ? 0.8 : 1.25) ? P[1] : k < 0.02 ? P[1] : k > 0.985 ? P[4] : dd < 1.8 && vnoise(x, y, 4, 31) > 0.4 ? P[3] : P[2];
          } else {
            if (VERGE && e > -(1 + 1.7 * vnoise(x, y, 3, 32))) col = VERGE;
            /* The corridor of light the trail lies in, in the dark lands:
               solid beside it, breaking up over a dozen pixels. */
            else if (LANDS[land].dark && e > -13) { const up = UP.get(col); if (up && bayer(x, y) < 1.25 + e / 10) col = up; }
          }
        }
      }
      const i = (r * W + x) * 4;
      d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255;
    }
  }
  return img;
}

/* ── What lies on the ground ── */

/* Scattered on a jittered grid, each cell from its own seed, so a tile's
   edge never cuts a drift in two differently. */
function eachCell(y0, y1, W, cw, ch, seed, fn) {
  for (let gy = Math.floor((y0 - 8) / ch); gy <= Math.floor((y1 + 8) / ch); gy++) for (let gx = 0; gx <= Math.floor(W / cw); gx++) {
    const k = gx * 7919 + gy * 104729 + seed * 131;
    fn(gx * cw + R(hash(k) * (cw - 1)), gy * ch + R(hash(k + 1) * (ch - 1)), hash(k + 2));
  }
}

const hex = (c, col, x, y, w, h) => { c.fillStyle = col; c.fillRect(x, y, w, h); };

function decals(c, layout, y0, y1) {
  const { W, landAt, levelAt, pathDist } = layout;
  const wet = (x, y) => layout.waters.some(w => Math.abs(y - streamY(w, x)) <= w.half + 2);
  const hard = (x, y) => layout.crossings.some(cr => cr.kind !== 'brook' && Math.abs(y - cr.y) < 11) ||
    (layout.park && Math.abs(x - layout.park.x) < layout.park.rx + 4 && Math.abs(y - layout.park.y) < layout.park.ry + 4);
  const off = (x, y, d) => pathDist(x, y) > d && !wet(x, y) && !hard(x, y);
  const meadow = (y) => { const l = landAt(y); return l === 'field' || l === 'edge'; };
  const G = RAMPS.meadow.grass, P = RAMPS.meadow.poppy, B = RAMPS.meadow.buttercup;
  /* The field: flowers in drifts, each kind keeping to its own ground. The
     first field has only a few; they thicken towards the wood. */
  eachCell(y0, y1, W, 5, 5, 1, (x, y, k) => {
    if (!meadow(y) || !meadow(y - 10) || !off(x, y, 9)) return;
    const few = levelAt(y) < 8 ? 0.2 : 0.6;
    if (fbm(x, y, 36, 21) > 0.63 && k < few) {
      hex(c, G[1], x, y + 1, 1, 2); hex(c, P[2], x - 1, y - 1, 3, 2); hex(c, P[3], x - 1, y - 1, 2, 1); hex(c, P[0], x, y, 1, 1);
    } else if (fbm(x + 300, y, 30, 22) > 0.65 && k < few + 0.1) {
      hex(c, B[2], x, y, 2, 1); hex(c, B[3], x, y, 1, 1); hex(c, G[1], x, y + 1, 1, 1);
    } else if (fbm(x, y + 500, 28, 23) > 0.68 && k < 0.5) {
      hex(c, '#ffffff', x, y, 2, 1); hex(c, B[2], x + 1, y, 1, 1); hex(c, '#eef4e0', x, y - 1, 1, 1); hex(c, G[1], x, y + 1, 1, 1);
    }
  });
  /* Tussocks: three blades, in the long grass mostly. */
  eachCell(y0, y1, W, 9, 7, 2, (x, y, k) => {
    if (!meadow(y)) return;
    const n = meadowField(x, y);
    if ((n < 0.4 ? k < 0.75 : k < 0.2) && off(x, y, 7)) {
      const col = n > 0.6 ? G[2] : G[1];
      hex(c, col, x, y, 1, 2); hex(c, col, x + 1, y - 1, 1, 2); hex(c, col, x + 2, y, 1, 2); hex(c, n > 0.6 ? G[4] : G[3], x + 1, y - 2, 1, 1);
    }
  });
  /* The forest: fallen leaves in drifts, a twig here and there. */
  const LEAF = FO.leaf, FF = FO.floor;
  eachCell(y0, y1, W, 5, 4, 3, (x, y, k) => {
    if (landAt(y) !== 'forest' || landAt(y + 6) !== 'forest' || wet(x, y) || hard(x, y)) return;
    const on = pathDist(x, y) < 6;
    if (fbm(x, y, 22, 24) > (on ? 0.7 : 0.56) && k < 0.6) {
      const col = LEAF[Math.floor(k * 9) % 5];
      hex(c, FF[0], x + 1, y + 1, 2, 1); hex(c, col, x, y, 2, 1); hex(c, col, x + 1, y - 1, 1, 1);
    } else if (k > 0.985 && !on) {
      hex(c, '#3a2a20', x, y, 3, 1); hex(c, '#3a2a20', x + 3, y - 1, 2, 1); hex(c, '#86623e', x + 1, y - 1, 1, 1);
    }
  });
  /* Ferns: a rosette of fronds, in every wood, in its own greens; and in
     the ancient wood pale fungi that seem to glow, in twos and threes. */
  const fern = (x, y, F) => {
    hex(c, F[0], x - 3, y, 7, 1); hex(c, F[1], x - 3, y - 1, 2, 1); hex(c, F[1], x + 2, y - 1, 2, 1); hex(c, F[1], x - 1, y - 2, 1, 2); hex(c, F[1], x + 1, y - 2, 1, 2);
    hex(c, F[2], x - 3, y - 2, 1, 1); hex(c, F[2], x, y - 3, 1, 2); hex(c, F[2], x + 3, y - 2, 1, 1);
  };
  eachCell(y0, y1, W, 13, 9, 6, (x, y, k) => {
    const land = landAt(y);
    if (land === 'field' || land === 'edge' || landAt(y - 8) !== land || landAt(y + 8) !== land || !off(x, y, 9)) return;
    if (land === 'forest') { if (fbm(x, y, 26, 62) < 0.5 && k < 0.5) fern(x, y, FO.fern); return; }
    if (land === 'old') { if (k < 0.42) fern(x, y, OL.fern); return; }
    const ht = layout.heart;
    if (ht && y < ht.y - ht.ry - 6) return;
    if (k < 0.22) fern(x, y, AN.fern);
    else if (k > 0.86) { const U = AN.fungus; hex(c, U[0], x, y, 2, 1); hex(c, U[1], x, y - 1, 1, 1); hex(c, U[0], x + 4, y + 1, 1, 1); hex(c, U[1], x + 4, y, 1, 1); }
  });
  /* Roots across the trail in the old woods: the going gets rough. */
  const [i0, i1] = pathRange(layout, y0 - 8, y1 + 8);
  for (let i = i0 - (i0 % 9); i <= i1; i += 9) {
    const p = layout.path[i];
    if (!p) continue;
    const land = landAt(p.y), lv = levelAt(p.y);
    if ((land !== 'old' && land !== 'ancient') || surfaceOf(lv) !== 'earth' || hard(p.x, p.y) || layout.stones.some(s => Math.abs(s.y - p.y) < 10)) continue;
    const h = hash(i * 13 + 5);
    if (h > (land === 'ancient' ? 0.75 : 0.25 + (lv - 46) / 80)) continue;
    const K = LANDS[land].root, side = h * 40 % 2 < 1 ? -1 : 1;
    const x = R(p.x), y = R(p.y), len = 9 + R(h * 60 % 6);
    for (let k = 0; k < len; k++) {
      const rx = x + side * (k - 3), ry = y + R(1.6 * Math.sin(k / 2.2 + h * 9)) + (k > len - 3 ? 1 : 0);
      hex(c, K[0], rx, ry + 1, 1, 1); hex(c, K[1], rx, ry, 1, 1);
      if (k % 3 !== 2) hex(c, K[2], rx, ry - 1, 1, 1);
    }
  }
  /* The glade's ring of pale fungi round the last stone: a fairy ring. */
  if (layout.heart) {
    const ht = layout.heart, s = layout.stones[layout.stones.length - 1], U = AN.fungus;
    if (s.y + 24 > y0 && s.y - 24 < y1) for (let k = 0; k < 22; k++) {
      const a = k / 22 * Math.PI * 2 + 0.2, x = R(s.x + Math.cos(a) * 27), y = R(s.y + 2 + Math.sin(a) * 13);
      if (pathDist(x, y) < 6 || Math.abs(x - ht.x) > ht.rx) continue;
      hex(c, U[0], x, y + 1, 2, 1); hex(c, U[k % 3 ? 1 : 2], x, y, 2, 1); if (k % 2) hex(c, U[2], x, y - 1, 1, 1);
    }
  }
}

/* Stepping stones where the trail fords a brook. */
function ford(c, layout, w) {
  const S = LANDS[w.land].rock, P = LANDS[w.land].water;
  for (let k = -1; k <= 1; k++) {
    const y = w.y + k * 3 + 1, xx = layout.xAt[clamp(y, 0, layout.H)];
    const x = R(xx === xx ? xx : w.x) + (k === 0 ? 1 : -1);
    hex(c, P[0], x - 3, y, 8, 2); hex(c, S[0], x - 3, y - 2, 7, 3);
    hex(c, S[2], x - 3, y - 2, 6, 2); hex(c, S[3], x - 2, y - 2, 4, 1); hex(c, S[4], x - 2, y - 2, 2, 1);
  }
}

/* The footbridge's deck over the stream: planks, a rail each side, and
   its shadow on the water downstream of it. */
const TIMBER = RAMPS.meadow.trunk;
function deck(c, layout, b) {
  const bx = gateX(layout, b), top = b.y - 16, h = 19, T = TIMBER;
  c.fillStyle = castOf('forest');
  c.fillRect(bx + 11, top + 4, 4, h - 6); c.fillRect(bx - 8, top + h, 20, 2);
  hex(c, T[0], bx - 10, top - 1, 21, h + 2);
  for (let j = 0; j < h; j++) {
    const joint = j % 3 === 2;
    hex(c, joint ? T[1] : T[3], bx - 9, top + j, 19, 1);
    if (!joint) { hex(c, T[4], bx - 8, top + j, 5 + R(hash(j * 7 + b.y) * 5), 1); hex(c, T[2], bx + 5, top + j, 5, 1); }
    if (!joint && hash(j * 13 + 1) > 0.6) hex(c, T[1], bx - 9 + R(hash(j * 5) * 16), top + j, 1, 1);
  }
  for (const side of [-10, 9]) {
    hex(c, T[0], bx + side - 1, top - 5, 4, h + 7);
    hex(c, side < 0 ? T[3] : T[2], bx + side, top - 4, 2, h + 5);
    hex(c, side < 0 ? T[4] : T[3], bx + side, top - 4, 1, h + 5);
    for (const py of [top - 6, top + R(h / 2) - 3, top + h - 2]) {
      hex(c, T[0], bx + side - 1, py - 1, 4, 5); hex(c, T[2], bx + side, py, 2, 3); hex(c, T[4], bx + side, py, 2, 1);
    }
  }
}

/** The ground for rows y0..y1. o.glade: whether the moon is full in the
    glade at the heart of the wood (it is, for a team that has finished).
    o.at: the row of the canvas that row y0 goes on. */
export function paintGround(c, layout, y0, y1, o) {
  GLADE = !o || o.glade !== false;
  /* putImageData takes no notice of the canvas's transform: the caller says
     which row of the canvas row y0 is on (o.at; the top one, unless a tile
     is being painted a part at a time). */
  c.putImageData(groundPixels(layout, y0, y1), 0, (o && o.at) || 0);
  decals(c, layout, y0, y1);
}

export function paintTrail(c, layout, y0, y1) {
  for (const w of layout.waters) {
    if (w.y - 24 > y1 || w.y + 12 < y0) continue;
    if (w.kind === 'brook') ford(c, layout, w);
  }
  for (const b of layout.bosses) if (b.kind === 'bridge' && b.y - 26 <= y1 && b.y + 8 >= y0) deck(c, layout, b);
}
