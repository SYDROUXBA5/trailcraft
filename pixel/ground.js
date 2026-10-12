/* The ground under it all, painted a band of rows at a time and pixel by
   pixel: big quiet tonal shapes first (mown and long grass, drifts of leaf
   litter, lawn and cobbles, rock and wind-packed snow), then the water, then
   the trail on top of it, then the small things that lie on the ground.

   Every pixel is a function of where it is and nothing else, so a tile
   paints the same rows the same way whatever is painted around it. */

import { bayer, clamp, hash, hexToRgb, mix, R, smooth } from './core.js';
import { RAMPS } from './ramps.js';
import { fbm, vnoise } from './terrain.js';
import { gateX, pathRange, streamY } from './layout.js';

const rgb = (ramp) => ramp.map(hexToRgb);
const one = hexToRgb;
const M = RAMPS.meadow, WD = RAMPS.wood, TN = RAMPS.town, CL = RAMPS.climb;

/* Each land's ground in tones. A ramp has no tone between `base` and
   `shade`, and a large area needs one (long grass, a lee slope): those are
   mixed here, once. */
const HOT = { g: rgb(M.grass), long: one(mix(M.grass[2], M.grass[1], 0.55)), path: rgb(M.path), water: rgb(M.water), bank: one(M.grass[0]) };
const WARM = { g: rgb(WD.litter), deep: one(mix(WD.litter[2], WD.litter[1], 0.5)), path: rgb(WD.path), water: rgb(WD.water), bank: one(WD.litter[0]) };
const TOWN = {
  lawn: rgb(TN.lawn), cob: rgb(TN.cobble), stone: rgb(TN.stone),
  cobMid: one(mix(TN.cobble[2], TN.cobble[1], 0.5)), cobDim: one(mix(TN.cobble[1], TN.cobble[2], 0.35)),
  flag: one(mix(TN.stone[2], TN.stone[1], 0.35)), flagHi: one(TN.stone[2]),
  lawnMid: one(mix(TN.lawn[1], TN.lawn[2], 0.55)),
};
const ALP = {
  snow: rgb(CL.snow), lee: one(mix(CL.snow[2], CL.snow[1], 0.5)), rock: rgb(CL.rock), path: rgb(CL.track), sky: rgb(CL.sky), aurora: rgb(CL.aurora),
  far: one('#2a3768'), farLit: one('#44548c'), farSnow: one('#aebfe2'), star: one('#fff3c4'), starLo: one('#93a8de'),
  glow: one('#d2f6e2'), tar: one('#3a4460'), tarHi: one('#4c5876'), tarLo: one('#1e2740'), paint: one('#e4ecf7'),
  rut: one(mix(CL.track[0], CL.track[1], 0.55)), slush: one('#7c8aa8'),
};

/* A short upright tick (a blade of grass) or a short flat one (a leaf):
   two pixels, never one, so the texture is clusters and not noise. */
const tickV = (x, y, s) => hash((x * 7919 + s * 31) ^ ((y >> 1) * 104729));
const tickH = (x, y, s) => hash(((x >> 1) * 7919 + s * 31) ^ (y * 104729));

/* What the shaders say about a pixel besides its colour. */
let VERGE = null, OPEN = true;
/* The northern lights over the summit are for whoever gets there: until
   then the sky is dark, with only a glimmer of them. */
let AURORA = true;

/** The meadow's patches: above 0.6 mown and sunlit, below 0.37 long grass. */
export const meadowField = (x, y) => fbm(x, y, 44, 1) + (vnoise(x, y, 5, 2) - 0.5) * 0.14;

function hotPx(x, y) {
  const n = meadowField(x, y), G = HOT.g;
  VERGE = G[3];
  if (n > 0.6) return tickV(x, y, 1) < 0.045 ? G[2] : n > 0.66 && tickH(x, y, 2) < 0.03 ? G[4] : G[3];
  if (n < 0.37) { const k = tickV(x, y, 3); return k < 0.17 ? G[1] : k > 0.93 ? G[2] : HOT.long; }
  const k = tickV(x, y, 4);
  return k < 0.04 ? HOT.long : k > 0.975 ? G[3] : G[2];
}

/** The wood's floor lies in long bands down the light: 0..1. */
export const woodField = (x, y) => fbm((x * 0.86 + y * 0.51) / 2.3, -x * 0.51 + y * 0.86, 24, 3);

function warmPx(x, y) {
  const n = woodField(x, y), G = WARM.g, k = tickH(x, y, 5);
  VERGE = G[3];
  if (n > 0.6) return k < 0.06 ? G[4] : k > 0.93 ? G[2] : G[3];
  if (n < 0.38) return k < 0.06 ? G[0] : k > 0.94 ? G[2] : n < 0.3 ? G[1] : WARM.deep;
  return k < 0.05 ? G[3] : k > 0.95 ? WARM.deep : G[2];
}

/* Setts in running bond, three rows to a course. */
function cobble(x, y, main) {
  const row = Math.floor(y / 3), off = (row & 1) * 2, col = Math.floor((x + off) / 4);
  const joint = y % 3 === 2 || (x + off) % 4 === 3, k = hash(row * 7919 + col * 104729);
  const C = TOWN.cob;
  if (main) return joint ? C[1] : k < 0.14 ? C[3] : k < 0.34 ? TOWN.cobMid : C[2];
  return joint ? C[0] : k < 0.2 ? TOWN.cobMid : k < 0.5 ? C[1] : TOWN.cobDim;
}

/* The square's flags: bigger, paler, laid square. */
function flags(x, y) {
  const row = Math.floor(y / 5), off = (row & 1) * 4, col = Math.floor((x + off) / 8);
  if (y % 5 === 4 || (x + off) % 8 === 7) return TOWN.stone[1];
  return hash(row * 131 + col * 7919) < 0.25 ? TOWN.flagHi : TOWN.flag;
}

function townPx(x, y, crs) {
  VERGE = null;
  for (let i = 0; i < crs.length; i++) {
    const cr = crs[i];
    if (cr.kind === 'street') {
      const dy = y - cr.y, a = Math.abs(dy);
      if (a <= 6) return cobble(x, y, false);
      if (a === 7) return dy < 0 ? TOWN.stone[2] : TOWN.stone[1];
      if (dy === 8) return TOWN.cob[0];
    } else if (cr.kind === 'square') {
      const ax = Math.abs(x - cr.x) - 34, ay = Math.abs(y - cr.y) - 16;
      const q = Math.hypot(Math.max(ax, 0), Math.max(ay, 0));
      if (q <= 9) return flags(x, y);
      if (q <= 10) return y > cr.y + 16 ? TOWN.stone[1] : TOWN.stone[2];
      if (q <= 11 && y > cr.y) return TOWN.cob[0];
    }
  }
  const n = fbm(x, y, 34, 5), L = TOWN.lawn, k = tickV(x, y, 6);
  // Mown and unmown, a tone apart: at two tones apart the lawns were
  // camouflage and the houses floated on them.
  if (n < 0.4) return k < 0.05 ? L[2] : n < 0.3 && k > 0.9 ? L[1] : TOWN.lawnMid;
  return k < 0.035 ? L[3] : k > 0.955 ? L[1] : L[2];
}

/* The summit's sky: bands, far peaks, three curtains of the northern
   lights and the stars between them. */
function skyPx(layout, x, y) {
  const { W, sky } = layout, S = ALP.sky;
  const peaks = [[W * 0.13, sky.y + 10], [W * 0.88, sky.y + 22], [W * 0.31, sky.y + 34], [W * 0.7, sky.y + 40], [W * 0.5, sky.y + 52]];
  let far = 1e9, lit = false;
  for (const p of peaks) { const f = p[1] + Math.abs(x - p[0]) * 0.85; if (f < far) { far = f; lit = x < p[0]; } }
  if (y >= far) return y < far + 4 + R(vnoise(x, 0, 4, 9) * 5) ? ALP.farSnow : lit ? ALP.farLit : ALP.far;
  const f = clamp(y / (sky.y + sky.drop), 0, 0.999) * 4;
  const i = Math.floor(f), frac = f - i;
  let col = S[i < 3 && frac > 0.45 && bayer(x, y) < (frac - 0.45) / 0.55 ? i + 1 : i];
  /* A curtain hangs from a wavy lower edge and fades upward in rays. */
  let best = 0;
  for (let j = 0; j < 3; j++) {
    const edge = 30 + j * 15 + 7 * Math.sin(x / (19 + j * 6) + j * 2.1) + 3 * Math.sin(x / 7 + j);
    const up = edge - y;
    if (up < 0 || up > 22) continue;
    const ray = 0.45 + 0.55 * vnoise(x, j * 50, 3, 40 + j);
    const v = (1 - up / 22) * ray * (j === 1 ? 1 : 0.8) * (AURORA ? 1 : 0.34);
    if (v > best) best = v;
  }
  if (best > 0.12) {
    const A = ALP.aurora, b = bayer(x, y);
    if (best > 0.74) col = b < (best - 0.74) * 6 ? A[4] : A[3];
    else if (best > 0.5) col = b < (best - 0.5) * 4.2 ? A[3] : A[2];
    else if (best > 0.3) col = b < (best - 0.3) * 5 ? A[2] : A[1];
    else if (b < (best - 0.12) * 5.5) col = A[1];
  }
  if (best < 0.3) {
    const st = hash(x * 7919 + y * 104729);
    if (st < 0.006) col = st < 0.0022 ? ALP.star : ALP.starLo;
  }
  return col;
}

/* The mountain: moonlit rock by the town wall, snow from half way, both
   modelled as a height field lit from the upper left so drifts and ribs
   have a bright side and a blue one. */
function alpPx(layout, x, y, crs) {
  const { sky } = layout;
  if (sky && y < layout.skyAt(x)) { OPEN = false; return skyPx(layout, x, y); }
  for (let i = 0; i < crs.length; i++) {
    const cr = crs[i];
    if (cr.kind !== 'road') continue;
    const dy = y - cr.y, a = Math.abs(dy);
    // A ploughed road: banks of thrown snow each side, ragged, the far one
    // in the light and the near one in its own shade; slush where the
    // wheels run, and a dusting the plough left behind.
    const rag = vnoise(x, cr.y + (dy < 0 ? 0 : 50), 4, 91) > 0.55 ? 1 : 0;
    if (a <= 5 - (a === 5 ? rag : 0)) {
      VERGE = null;
      if (dy === 0 && x % 12 < 6) return ALP.paint;
      if ((a === 3 || a === 2) && vnoise(x, y, 5, 92) > 0.45) return a === 3 ? ALP.slush : ALP.tarHi;
      return vnoise(x, y * 2, 7, 93) > 0.78 ? ALP.tarHi : hash(x * 31 + y * 7919) < 0.04 ? ALP.tarLo : ALP.tar;
    }
    if (a <= 7 + rag) { VERGE = null; return dy < 0 ? (a >= 7 ? ALP.snow[3] : ALP.snow[4]) : a === 5 || a === 6 ? ALP.snow[0] : ALP.snow[1]; }
  }
  const wall = layout.bosses[2] ? layout.bosses[2].y : layout.H, topY = sky ? sky.y : 0;
  const a = smooth(((wall - y) / Math.max(1, wall - topY) - 0.04) / 0.36);
  // The snow line is made of patches, each a solid shape: lying deeper on
  // the left of every hollow, with a lit lip along its top and its own blue
  // shade along its foot. (Dithered, every edge of it was a checkerboard.)
  const lies = (px, py) => {
    const b = smooth(((wall - py) / Math.max(1, wall - topY) - 0.04) / 0.36);
    return b >= 1 || (b > 0 && b * 1.1 + 0.9 * (0.7 * vnoise(px, py, 14, 14) + 0.3 * vnoise(px + 40, py, 5, 15) - 0.5) > 0.5);
  };
  let snow = a >= 1, lip = 0;
  if (!snow && a > 0) {
    snow = lies(x, y);
    if (snow) lip = !lies(x, y - 1) ? 1 : !lies(x, y + 1) || !lies(x + 1, y + 1) ? -1 : 0;
    else if (lies(x, y - 1) || lies(x - 1, y - 1)) lip = 2;
  }
  /* A few ribs of rock stand through the snow on the way up. */
  if (snow && a >= 1 && vnoise(x * 0.55, y, 20, 16) > 0.83 && y > topY + 150) snow = false;
  const hgt = fbm(x, y * 1.7, 30, 11), slope = fbm(x + 2, (y + 2) * 1.7, 30, 11) - hgt;
  if (snow) {
    const S = ALP.snow;
    VERGE = S[3];
    /* Near the top the aurora is on the snow's highlights. */
    // It fades out down the slope through an ordered dither: cut on a row,
    // it drew a ruled line across the last screen of the game.
    const hi = AURORA && sky && bayer(x, y) >= (y - sky.y - 100) / 90 ? ALP.glow : S[3];
    if (lip === 1) return S[4];
    if (lip === -1) return S[1];
    if (slope < -0.05) return S[1];
    if (slope < -0.022) return ALP.lee;
    if (slope > 0.03) return hash(x * 131 + y * 7919) < 0.03 ? S[4] : hi;
    return tickH(x, y, 7) < 0.02 ? ALP.lee : S[2];
  }
  const K = ALP.rock, k = tickH(x, y, 8);
  VERGE = K[3];
  if (lip === 2) return K[0];
  if (slope < -0.03) return k < 0.1 ? K[0] : K[1];
  if (slope > 0.035) return k < 0.08 ? K[4] : K[3];
  return k < 0.07 ? K[1] : k > 0.95 ? K[3] : K[2];
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

function groundPixels(layout, y0, y1) {
  const { W, H, bosses, stones, xAt } = layout;
  const h = y1 - y0, img = new ImageData(W, h), d = img.data;
  const hedge = bosses[0] && bosses[0].kind === 'stile' ? bosses[0].y : null;
  for (let r = 0; r < h; r++) {
    const y = y0 + r;
    const rowLand = layout.landAt(y);
    const tx = xAt[clamp(y, 0, H)], ta = xAt[clamp(y - 2, 0, H)], tb = xAt[clamp(y + 2, 0, H)];
    const lean = ta === ta && tb === tb ? (ta - tb) / 4 : 0;
    const cosF = 1 / Math.sqrt(1 + lean * lean);
    const near = stones.filter(s => !s.boss && Math.abs(s.y - y) <= 7);
    const crs = layout.crossings.filter(cr => Math.abs(cr.y - y) <= 30);
    const waters = layout.waters.filter(w => Math.abs(w.y - y) <= w.half + 7);
    for (let x = 0; x < W; x++) {
      let land = rowLand;
      /* The meadow gives way to the wood in tongues, not on a line. */
      if (hedge !== null && Math.abs(y - hedge) < 22) land = (hedge - y) / 13 + (vnoise(x, y, 9, 77) - 0.5) * 2 > 0 ? 'warm' : 'hot';
      OPEN = true;
      let col = land === 'hot' ? hotPx(x, y) : land === 'warm' ? warmPx(x, y) : land === 'town' ? townPx(x, y, crs) : alpPx(layout, x, y, crs);
      let wet = false;
      for (let i = 0; i < waters.length; i++) {
        const w = waters[i];
        const wc = waterPx(w, x, y, w.land === 'hot' ? HOT.water : WARM.water, w.land === 'hot' ? HOT.bank : WARM.bank);
        if (wc) { col = wc; wet = true; }
      }
      if (OPEN && !wet && tx === tx) {
        const dd = Math.abs(x - tx) * cosF;
        if (land === 'town') {
          const e = 7 - dd;
          if (e >= 0) col = e < 1 ? TOWN.cob[1] : cobble(x, y, true);
          else if (e >= -1) col = TOWN.stone[3];
          else if (e >= -2) col = TOWN.cob[0];
        } else {
          const P = land === 'hot' ? HOT.path : land === 'warm' ? WARM.path : ALP.path;
          let e = 4.7 - dd;
          /* Feet have worn the ground bare round every stone. */
          for (let i = 0; i < near.length; i++) {
            const s = near[i], q = Math.sqrt(((x - s.x) * (x - s.x)) / 121 + ((y - s.y) * (y - s.y)) / 36);
            if (q < 1.3) e = Math.max(e, (1 - q) * 6);
          }
          if (land === 'alp') e += 0.6;
          if (e >= 0 && land === 'alp') {
            // The packed track is a trench trodden into the snow: darker
            // and bluer than any drift, its far bank white where the moon
            // catches it, its near bank in shadow. Pale on pale, it was lost.
            const k = hash(x * 131 + y * 7919), lit = x > tx;
            col = e < 1.1 ? (lit ? ALP.snow[4] : P[0]) : e < 2.3 && !lit ? ALP.rut : k < 0.03 ? P[0] : dd < 1.7 && vnoise(x, y, 4, 31) > 0.45 ? P[2] : P[1];
          } else if (e >= 0) {
            const k = hash(x * 131 + y * 7919);
            col = e < 1.25 ? P[1] : k < 0.02 ? P[1] : k > 0.985 ? P[4] : dd < 1.8 && vnoise(x, y, 4, 31) > 0.4 ? P[3] : P[2];
          } else if (VERGE && e > -(1 + 1.7 * vnoise(x, y, 3, 32))) col = VERGE;
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
  const { W, landAt, pathDist } = layout;
  const wet = (x, y) => layout.waters.some(w => Math.abs(y - streamY(w, x)) <= w.half + 2);
  const off = (x, y, d) => pathDist(x, y) > d && !wet(x, y);
  const G = M.grass, P = M.poppy, B = M.buttercup;
  /* The meadow: flowers in drifts, each kind keeping to its own ground. */
  eachCell(y0, y1, W, 5, 5, 1, (x, y, k) => {
    if (landAt(y) !== 'hot' || landAt(y - 10) !== 'hot' || !off(x, y, 9)) return;
    if (fbm(x, y, 36, 21) > 0.63 && k < 0.6) {
      hex(c, G[1], x, y + 1, 1, 2); hex(c, P[2], x - 1, y - 1, 3, 2); hex(c, P[3], x - 1, y - 1, 2, 1); hex(c, P[0], x, y, 1, 1);
    } else if (fbm(x + 300, y, 30, 22) > 0.65 && k < 0.7) {
      hex(c, B[2], x, y, 2, 1); hex(c, B[3], x, y, 1, 1); hex(c, G[1], x, y + 1, 1, 1);
    } else if (fbm(x, y + 500, 28, 23) > 0.68 && k < 0.5) {
      hex(c, '#ffffff', x, y, 2, 1); hex(c, B[2], x + 1, y, 1, 1); hex(c, '#eef4e0', x, y - 1, 1, 1); hex(c, G[1], x, y + 1, 1, 1);
    }
  });
  /* Tussocks: three blades, in the long grass mostly. */
  eachCell(y0, y1, W, 9, 7, 2, (x, y, k) => {
    const land = landAt(y);
    if (land === 'hot') {
      const n = fbm(x, y, 44, 1);
      if ((n < 0.4 ? k < 0.75 : k < 0.2) && off(x, y, 7)) {
        const col = n > 0.6 ? G[2] : G[1];
        hex(c, col, x, y, 1, 2); hex(c, col, x + 1, y - 1, 1, 2); hex(c, col, x + 2, y, 1, 2); hex(c, n > 0.6 ? G[4] : G[3], x + 1, y - 2, 1, 1);
      }
    } else if (land === 'town' && k < 0.12 && off(x, y, 12)) {
      const L = TN.lawn;
      hex(c, L[3], x, y, 1, 2); hex(c, L[3], x + 2, y, 1, 2); hex(c, L[4], x + 1, y - 1, 1, 1);
    }
  });
  /* The wood: fallen leaves in drifts, a twig here and there. */
  const LV = [WD.amber[3], WD.russet[2], WD.amber[4], WD.russet[3], WD.amber[2]];
  eachCell(y0, y1, W, 5, 4, 3, (x, y, k) => {
    if (landAt(y) !== 'warm' || landAt(y + 6) !== 'warm' || wet(x, y)) return;
    const on = pathDist(x, y) < 6;
    if (fbm(x, y, 22, 24) > (on ? 0.66 : 0.47) && k < 0.7) {
      const col = LV[Math.floor(k * 7) % 5];
      hex(c, WD.litter[0], x + 1, y + 1, 2, 1); hex(c, col, x, y, 2, 1); hex(c, col, x + 1, y - 1, 1, 1);
    } else if (k > 0.985 && !on) {
      hex(c, WD.trunk[1], x, y, 3, 1); hex(c, WD.trunk[1], x + 3, y - 1, 2, 1); hex(c, WD.trunk[3], x + 1, y - 1, 1, 1);
    }
  });
  /* The climb: boot and paw prints down the packed track, stones on the scree. */
  eachCell(y0, y1, W, 11, 9, 4, (x, y, k) => {
    // Scree lies where it fell, in a few spills, not evenly over the snow
    // like pepper: most of the slope is left clean.
    if (landAt(y) !== 'alp' || k > 0.5 || fbm(x, y, 38, 61) < 0.64 || !off(x, y, 9) || (layout.sky && y < layout.skyAt(x) + 8)) return;
    const K = CL.rock, big = k < 0.16;
    hex(c, CL.snow[1], x + 1, y + 1, big ? 4 : 3, 1); hex(c, K[1], x, y, big ? 4 : 3, 1); hex(c, K[3], x, y - (big ? 1 : 0), big ? 3 : 2, 1); hex(c, K[4], x, y - (big ? 1 : 0), 1, 1);
  });
  const [i0, i1] = pathRange(layout, y0 - 8, y1 + 8);
  for (let i = i0 - (i0 % 7); i <= i1; i += 7) {
    const p = layout.path[i], q = layout.path[Math.min(layout.path.length - 1, i + 1)];
    if (!p || landAt(p.y) !== 'alp' || layout.stones.some(s => Math.abs(s.y - p.y) < 9)) continue;
    const tx = q.x - p.x, ty = q.y - p.y, n = Math.hypot(tx, ty) || 1, side = (i / 7) % 2 ? 2 : -2;
    const x = R(p.x - ty / n * side), y = R(p.y + tx / n * side);
    c.fillStyle = CL.track[0];
    if ((i / 7) % 2) { c.fillRect(x - 1, y, 3, 2); c.fillRect(x - 1, y - 2, 1, 1); c.fillRect(x + 1, y - 2, 1, 1); } else { c.fillRect(x - 1, y - 2, 2, 2); c.fillRect(x - 1, y + 1, 2, 1); }
  }
}

/* Stepping stones where the trail fords a brook. */
function ford(c, layout, w) {
  const S = w.land === 'hot' ? M.stone : WD.stone, P = w.land === 'hot' ? M.water : WD.water;
  for (let k = -1; k <= 1; k++) {
    const y = w.y + k * 3 + 1, xx = layout.xAt[clamp(y, 0, layout.H)];
    const x = R(xx === xx ? xx : w.x) + (k === 0 ? 1 : -1);
    hex(c, P[0], x - 3, y, 8, 2); hex(c, S[0], x - 3, y - 2, 7, 3);
    hex(c, S[2], x - 3, y - 2, 6, 2); hex(c, S[3], x - 2, y - 2, 4, 1); hex(c, S[4], x - 2, y - 2, 2, 1);
  }
}

/* The footbridge's deck over the stream: planks, a rail each side, and
   its shadow on the water downstream of it. */
function deck(c, layout, b) {
  const bx = gateX(layout, b), top = b.y - 16, h = 19, T = WD.trunk;
  c.fillStyle = 'rgba(48,20,44,0.42)';
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

export function paintGround(c, layout, y0, y1, o) {
  AURORA = !o || o.aurora !== false;
  /* putImageData takes no notice of the canvas's transform: the caller has
     moved row y0 to the top, so that is where these rows go. */
  c.putImageData(groundPixels(layout, y0, y1), 0, 0);
  decals(c, layout, y0, y1);
}

export function paintTrail(c, layout, y0, y1) {
  for (const w of layout.waters) {
    if (w.y - 24 > y1 || w.y + 12 < y0) continue;
    if (w.kind === 'brook') ford(c, layout, w);
  }
  for (const b of layout.bosses) if (b.kind === 'bridge' && b.y - 26 <= y1 && b.y + 8 >= y0) deck(c, layout, b);
}
