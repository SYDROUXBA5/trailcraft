/* The dog: ten coats on six builds, the harness it wears, and the rig that
   poses it. Nothing here is one body recoloured: each build has its own
   height, length, chest, tuck, head, muzzle, ears and tail, so a hound, a
   shepherd and a beagle can be told apart filled in black.

   A dog is painted fresh for every pose (paint.js) from a skeleton: where the
   chest, the hips, the joints and the head are. That is what lets the gaits
   have eight frames, the ears and tail arrive late, and a sit be a movement
   rather than a swap of pictures. It faces right; a mirrored dog turns on
   the spot. */

import { RAMPS } from './ramps.js';
import { ball, colours, contour, develop, dot, knee, limb, matAt, shape, sheet, tint, wipe } from './paint.js';

/* `pal` is what a swatch shows (b body, u points, s saddle); `fur` says which
   ramp each part of the dog is painted from; `mark` is the coat's pattern. */
export const COATS = [
  { id: 'bloodhound-red', name: 'Bloodhound, red', build: 'hound', mark: 'wash', belly: true,
    pal: { s: '#9c4a26', b: '#c26a36', u: '#e0935a' },
    fur: { body: 'red', back: 'redDeep', points: 'redPale', ear: 'redDeep', muzzle: 'redPale', nose: 'nose' } },
  { id: 'bloodhound-bt', name: 'Bloodhound, black and tan', build: 'hound', mark: 'saddle', belly: true,
    pal: { s: '#2e2624', b: '#b9733a', u: '#d49a56' },
    fur: { body: 'tan', back: 'black', points: 'tanPale', ear: 'black', earIn: 'tan', muzzle: 'tanPale', tail: 'black', nose: 'nose' } },
  { id: 'bloodhound-liver', name: 'Bloodhound, liver and tan', build: 'hound', mark: 'saddle', belly: true,
    pal: { s: '#5a3226', b: '#b9733a', u: '#d49a56' },
    fur: { body: 'tan', back: 'liver', points: 'tanPale', ear: 'liver', earIn: 'tan', muzzle: 'tanPale', tail: 'liver', nose: 'noseLiver' } },
  { id: 'malinois', name: 'Malinois', build: 'malinois', mark: 'wash', belly: true, mask: true,
    pal: { s: '#a87440', b: '#c99455', u: '#e2bd86' },
    fur: { body: 'fawn', back: 'fawnDeep', points: 'fawnPale', ear: 'mask', earIn: 'fawnDeep', muzzle: 'mask', tip: 'mask', nose: 'nose' } },
  { id: 'shepherd', name: 'German shepherd', build: 'shepherd', mark: 'saddle', mask: true,
    pal: { s: '#2e2624', b: '#b9733a', u: '#d49a56' },
    fur: { body: 'tan', back: 'black', points: 'tanPale', ear: 'black', earIn: 'tan', muzzle: 'black', tail: 'black', tip: 'black', nose: 'nose' } },
  { id: 'lab-yellow', name: 'Labrador, yellow', build: 'lab', mark: 'wash', belly: true, cheek: true, earT: 1,
    pal: { s: '#c99a58', b: '#e3bd7a', u: '#f3dcae' },
    fur: { body: 'yellow', back: 'yellowDeep', points: 'cream', ear: 'yellowDeep', muzzle: 'yellow', leg: 'yellow', nose: 'nose' } },
  { id: 'lab-black', name: 'Labrador, black', build: 'lab', mark: 'none', sheen: true, earT: 1, iris: true,
    pal: { s: '#43434f', b: '#2c2b34', u: '#43434f' },
    fur: { body: 'jet', points: 'jet', nose: 'nose' } },
  { id: 'lab-chocolate', name: 'Labrador, chocolate', build: 'lab', mark: 'wash', earT: 1, iris: true,
    pal: { s: '#4c2c1c', b: '#643b27', u: '#7c4e36' },
    fur: { body: 'choc', back: 'chocDeep', points: 'chocPale', ear: 'chocDeep', muzzle: 'choc', leg: 'choc', nose: 'noseLiver' } },
  { id: 'beagle', name: 'Beagle', build: 'beagle', mark: 'blanket', belly: true, blaze: true,
    pal: { s: '#2e2624', b: '#b9733a', u: '#f1ece3' },
    fur: { body: 'tan', back: 'black', points: 'white', ear: 'tan', muzzle: 'white', tail: 'black', tip: 'white', nose: 'nose' } },
  { id: 'springer', name: 'Springer, liver and white', build: 'springer', mark: 'patches', blaze: true, neck: 'body',
    pal: { s: '#6e3024', b: '#f1ece3', u: '#f1ece3' },
    fur: { body: 'white', back: 'springerLiver', points: 'white', head: 'springerLiver', ear: 'springerLiver', muzzle: 'white', tail: 'white', leg: 'whiteLeg', nose: 'noseLiver' } },
];

export const coatById = (id) => COATS.find(c => c.id === id) || COATS[0];

/* The six builds, in art pixels. wither: height of the shoulder above the
   ground; len: chest front to rump; chest and rump: half width and half
   depth of the two masses; tuck: how far the belly rises to the loin; drop:
   how far the back falls to the croup; leg: half the foreleg's width;
   neck: its thickness at the shoulder and at the head, then its length;
   skull: half width, half height; muz: length, depth at the stop, depth at
   the nose, how far below the skull's middle it leaves. */
export const DOG_TORSO = {
  hound:    { wither: 19, len: 24, chest: [6.2, 5.2], rump: [4.8, 4.7], tuck: 1.2, drop: 0, leg: 1.4, neck: [4.0, 3.3, 7.5], hock: 0 },
  shepherd: { wither: 19, len: 25, chest: [5.8, 4.8], rump: [4.6, 4.3], tuck: 2.4, drop: 2.6, leg: 1.3, neck: [3.5, 2.8, 8], hock: 2 },
  malinois: { wither: 19, len: 22, chest: [5.2, 4.5], rump: [4.0, 3.8], tuck: 3.2, drop: 0, leg: 1.1, neck: [3.1, 2.5, 8], hock: 0.5 },
  lab:      { wither: 18, len: 23, chest: [6.0, 4.8], rump: [4.7, 4.4], tuck: 1.8, drop: 0, leg: 1.5, neck: [4.0, 3.3, 6.5], hock: 0 },
  beagle:   { wither: 13, len: 17, chest: [4.6, 4.0], rump: [3.8, 3.7], tuck: 0.8, drop: 0, leg: 1.2, neck: [3.1, 2.7, 5], hock: 0 },
  springer: { wither: 16, len: 20, chest: [5.2, 4.5], rump: [4.1, 4.0], tuck: 1.6, drop: 0, leg: 1.2, neck: [3.2, 2.6, 6.5], hock: 0 },
};

export const DOG_HEADS = {
  hound:    { skull: [4.2, 4.4], muz: [7, 2.9, 2.7, 1.5], flews: true, eye: [1.6, -1.2], ear: 'long', tail: 'saber' },
  shepherd: { skull: [3.8, 3.7], muz: [6, 2.0, 1.2, 0.9], eye: [1.5, -0.9], ear: 'prick', tail: 'brush' },
  malinois: { skull: [3.5, 3.4], muz: [5.5, 1.8, 1.1, 0.8], eye: [1.4, -0.8], ear: 'prick', tail: 'whip' },
  lab:      { skull: [4.5, 4.3], muz: [5.2, 2.7, 2.6, 1.1], blunt: true, eye: [1.9, -1.2], ear: 'drop', tail: 'otter' },
  beagle:   { skull: [3.8, 3.6], muz: [4.5, 2.2, 2.0, 1.1], eye: [1.5, -0.8], ear: 'mid', tail: 'flag' },
  springer: { skull: [3.8, 3.7], muz: [5.5, 2.2, 1.9, 1.1], eye: [1.5, -0.9], ear: 'feather', tail: 'stub' },
};

/* Ears: where they are set on the skull (along the muzzle's line, across
   it), how long, how thick at the set and at the tip. The hanging ones hang
   straight down whatever the head does, which is most of what makes a hound
   look like one with its nose on the ground. */
export const DOG_EARS = {
  long:    { set: [-2.8, -0.4], len: 10, r: [2.0, 1.9] },
  mid:     { set: [-1.4, -1.0], len: 6.2, r: [2.1, 1.8] },
  feather: { set: [-1.5, -1.0], len: 7.6, r: [2.1, 2.5], fringe: true },
  drop:    { set: [-1.3, -2.4], len: 6.4, w: 5.0 },
  prick:   { set: [-1.0, -2.4], len: 6.4, w: 3.8 },
};

/* Tails: length, the angle they leave the rump at (0 straight back, 90
   straight up, negative hanging), how far they curve by the tip, and the
   thickness at root, middle and tip. */
const TAILS = {
  saber: { len: 12, at: 58, curl: 52, r: [1.8, 1.4, 0.8], tip: 0 },
  flag:  { len: 9, at: 84, curl: 14, r: [1.5, 1.3, 0.9], tip: 3 },
  brush: { len: 13, at: -62, curl: 34, r: [1.6, 2.3, 1.1], tip: 3 },
  whip:  { len: 11, at: -22, curl: 44, r: [1.4, 1.5, 0.8], tip: 3 },
  otter: { len: 11, at: -12, curl: 16, r: [2.0, 1.5, 0.7], tip: 0 },
  stub:  { len: 4, at: 24, curl: 6, r: [1.4, 1.3, 1.1], tip: 0, plume: true },
};

/* The dog lives in a 48 × 34 box facing right; its paws stand on row 32. */
export const DOG_BOX = { w: 48, h: 34, ground: 32 };

const G = DOG_BOX.ground;
/* Room round the box for a swung ear, a wagging tail, a shake. */
const PAD = 8;

const M = { body: 1, back: 2, points: 3, head: 4, muzzle: 5, ear: 6, earIn: 7, tail: 8, tip: 9, nose: 10, eye: 11, tongue: 12, leg: 13, harness: 14, web: 15, metal: 16, refl: 17, toyA: 18, toyB: 19, iris: 20 };

const EYE = ['#0c0a0e', '#1a1418', '#2a2024', '#8a7a80', '#ffffff'];
/* A dark dog's eye is lost in its coat: it gets an amber iris beside the light. */
const IRIS = ['#2a140c', '#5e3216', '#96592a', '#c98a4a', '#ffffff'];
const TOY_A = ['#5a1a20', '#9a2a26', '#d23b2e', '#f27a5c', '#ffd0c0'];
const TOY_B = ['#16305e', '#1f4c8a', '#2f6fb8', '#6aa8e0', '#c8e4ff'];

const pals = new Map();

function dogPal(coat, stage) {
  const key = coat.id + '/' + stage;
  let p = pals.get(key);
  if (p) return p;
  const F = RAMPS.fur, f = coat.fur;
  const kit = RAMPS.kit;
  const h = stage === 'cold' ? kit.harnessCold : stage === 'warm' ? kit.harnessWarm : kit.harnessHot;
  const r = [];
  r[M.body] = F[f.body];
  r[M.back] = F[f.back || f.body];
  r[M.points] = F[f.points || f.body];
  r[M.head] = F[f.head || f.body];
  r[M.muzzle] = F[f.muzzle || f.points || f.body];
  r[M.ear] = F[f.ear || f.head || f.body];
  r[M.earIn] = F[f.earIn || f.ear || f.body];
  r[M.tail] = F[f.tail || f.body];
  r[M.tip] = F[f.tip || f.tail || f.body];
  r[M.nose] = F[f.nose || 'nose'];
  r[M.eye] = EYE;
  r[M.tongue] = F.tongue;
  r[M.leg] = F[f.leg || f.points || f.body];
  r[M.harness] = h;
  r[M.web] = kit.webbing;
  r[M.metal] = kit.metal;
  r[M.refl] = kit.reflective;
  r[M.toyA] = TOY_A;
  r[M.toyB] = TOY_B;
  r[M.iris] = IRIS;
  p = colours(r);
  pals.set(key, p);
  return p;
}

const lerp = (a, b, k) => a + (b - a) * k;
const mixPt = (a, b, k) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k)];
const rad = (d) => d * Math.PI / 180;

/* Head carriage for each way of standing: the neck's angle from level
   (negative is up), the head's own pitch (positive is nose down), and
   whether the nose goes to the ground. */
const CARRIAGE = {
  stand: { fwd: [-46, 8], down: [32, 54, 1], low: [6, 30], up: [-60, -26], back: [-78, 6] },
  sit:   { fwd: [-60, 6], down: [-20, 46], low: [-40, 20], up: [-68, -24], back: [-82, 4] },
  lie:   { fwd: [-38, 8], down: [16, 20, 1], low: [-10, 16], up: [-52, -20], back: [-70, 6] },
};

/** One build's joints in one way of standing, before any movement. */
function stance(b, body) {
  const crx = b.chest[0], cry = b.chest[1], rrx = b.rump[0], rry = b.rump[1];
  const topS = G - b.wither;
  const S0 = [27, topS + cry];
  const H0 = [S0[0] + crx - b.len + rrx, topS + b.drop + rry];
  const k = {};
  if (body === 'sit') {
    k.S = [S0[0] - 3, S0[1] + 0.6];
    k.H = [k.S[0] - (S0[0] - H0[0]) * 0.58, G - rry + 0.3];
    k.fore = [[k.S[0] + 1.5, k.S[1] + 1], null, [k.S[0] + 3, G]];
    k.hind = [[k.H[0] + 0.5, k.H[1] - 0.5], [k.H[0] + rrx * 0.95, G - 4.6], [k.H[0] + 1.8, G - 1.2], [k.H[0] + rrx + 2.6, G]];
    k.tail = [k.H[0] - rrx + 0.8, G - 2.2];
  } else if (body === 'lie') {
    k.S = [S0[0] - 1, G - cry - 0.2];
    k.H = [H0[0] + 1.5, G - rry - 0.2];
    k.fore = [[k.S[0] + 2, k.S[1] + 1.2], [k.S[0] + 0.5, G - 1.4], [k.S[0] + crx + 5, G]];
    k.hind = [[k.H[0] + 0.5, k.H[1]], [k.H[0] + rrx * 0.85, G - 3.6], [k.H[0] + 1.5, G - 1.2], [k.H[0] + rrx + 3, G]];
    k.tail = [k.H[0] - rrx + 0.8, G - 2.4];
  } else {
    k.S = S0; k.H = H0;
    k.fore = [[S0[0] + 1.5, S0[1] + 1], null, [S0[0] + 1.5, G]];
    const paw = [H0[0] - 1.5 - b.hock, G];
    k.hind = [[H0[0] + 0.3, H0[1] + 0.5], null, [paw[0] - 2.2, G - (G - H0[1]) * 0.4], paw];
    k.tail = [H0[0] - rrx + 1.2, H0[1] - rry + 1.6];
  }
  return k;
}

/* How a foot travels through one stride. `ph` 0..1: on the ground going
   back for the first part, then lifted and brought forward. */
function footfall(ph, onGround, reach, lift) {
  ph = ((ph % 1) + 1) % 1;
  if (ph < onGround) return [reach * (1 - 2 * ph / onGround), 0];
  const u = (ph - onGround) / (1 - onGround);
  const e = u * u * (3 - 2 * u);
  return [reach * (-1 + 2 * e), lift * Math.sin(Math.PI * u)];
}

/* When each leg starts its stride. A trot moves the diagonal pairs
   together; a walk is four beats, hind then fore on the same side. */
const GAITS = {
  trot: { on: 0.5, nf: 0, fh: 0, ff: 0.5, nh: 0.5, reach: 0.2, lift: 2.6 },
  walk: { on: 0.64, nh: 0, nf: 0.25, fh: 0.5, ff: 0.75, reach: 0.16, lift: 1.8 },
};

/** Where every part of the dog is for a pose, in its own box. Used to draw
    it and, without drawing, to know where the ring, the nose and the head are. */
export function dogLayout(P) {
  const coat = P.coat || COATS[0];
  const b = DOG_TORSO[coat.build] || DOG_TORSO.hound;
  const hd = DOG_HEADS[coat.build] || DOG_HEADS.hound;
  const body = P.body || 'stand';
  const K = stance(b, body);
  let S = K.S, H = K.H, fore = K.fore, hind = K.hind, tailAt = K.tail;
  const k = P.to && P.k ? P.k : 0;
  let K2 = null;
  if (k) {
    K2 = stance(b, P.to);
    S = mixPt(S, K2.S, k); H = mixPt(H, K2.H, k); tailAt = mixPt(tailAt, K2.tail, k);
  }
  const jx = P.jx || 0, bob = P.bob || 0;
  S = [S[0] + jx, S[1] + bob]; H = [H[0] + jx + (P.rx || 0), H[1] + bob + (P.rump || 0)];
  tailAt = [tailAt[0] + jx + (P.rx || 0), tailAt[1] + bob + (P.rump || 0)];
  // A dog turning towards us is shorter from nose to tail.
  if (P.short) { const c = S[0] - (S[0] - H[0]) * P.short; tailAt = [tailAt[0] + c - H[0], tailAt[1]]; H = [c, H[1]]; }

  // Legs. Standing, the feet are placed and the joints follow; sitting and
  // lying, the joints are where the pose puts them.
  const g = P.legs ? (GAITS[P.legs.gait] || GAITS.trot) : null;
  const ph = P.legs ? P.legs.phase : 0;
  // `reach` in pixels overrides the build's own stride: the team's speed over
  // the ground is set by the handler's walk, and every dog keeps to it.
  const reach = !g ? 0 : P.legs.reach != null ? P.legs.reach : b.wither * g.reach * (P.legs.stride == null ? 1 : P.legs.stride);
  const foreLeg = (far) => {
    const sh0 = K.fore[0];
    const foot = g ? footfall(ph + (far ? g.ff : g.nf), g.on, reach, g.lift) : [0, 0];
    // A lifted paw comes up and forward by more than it would in life: at
    // this size a paw two pixels off the ground is not seen at all.
    const lift = P.paw && !far ? P.paw * 1.5 : foot[1];
    const sh = [sh0[0] + jx + (far ? 2 : 0), sh0[1] + bob - (far ? 1 : 0)];
    const paw = [K.fore[2][0] + foot[0] + (far ? 2 : 0) + (P.paw && !far ? 1 + P.paw * 0.9 : 0), G - lift - (far ? 1 : 0)];
    const rest = G - sh0[1] - 1.5;
    const wrist = [paw[0] - 0.2 - (lift > 0.5 ? 0.8 : 0), paw[1] - 1.6];
    const el = K.fore[1] ? [K.fore[1][0] + jx + (far ? 2 : 0), K.fore[1][1] - (far ? 1 : 0)] : knee(sh, wrist, rest * 0.47, rest * 0.58, 1);
    return [sh, el, wrist, paw];
  };
  const hindLeg = (far) => {
    const hip0 = K.hind[0];
    const foot = g ? footfall(ph + (far ? g.fh : g.nh), g.on, reach, g.lift * 0.8) : [0, 0];
    const dxh = H[0] - K.H[0] - jx, dyh = H[1] - K.H[1] - bob;
    const hip = [hip0[0] + jx + dxh + (far ? 2 : 0), hip0[1] + bob + dyh - (far ? 1 : 0)];
    const paw = [K.hind[3][0] + foot[0] + (far ? 2.5 : 0), G - foot[1] - (far ? 1 : 0)];
    const h0 = K.hind[2];
    const hock = [h0[0] + foot[0] * 0.8 + (far ? 2.5 : 0) + (foot[1] > 0.5 ? 0.6 : 0), h0[1] - foot[1] * 1.15 - (far ? 1 : 0)];
    let st;
    if (K.hind[1]) st = [K.hind[1][0] + (far ? 2 : 0), K.hind[1][1] - (far ? 1 : 0)];
    else {
      const d0 = Math.hypot(h0[0] - hip0[0], h0[1] - hip0[1]);
      st = knee(hip, hock, d0 * 0.6, d0 * 0.66, -1);
    }
    return [hip, st, hock, paw];
  };
  let legs = { nf: foreLeg(false), ff: foreLeg(true), nh: hindLeg(false), fh: hindLeg(true) };
  if (K2) {
    // Between two ways of standing every joint goes straight from one to
    // the other: the pose in between is a dog half way down.
    const P2 = Object.assign({}, P, { body: P.to, to: null, k: 0 });
    const L2 = dogLayout(P2).legs;
    const out = {};
    for (const n of ['nf', 'ff', 'nh', 'fh']) out[n] = legs[n].map((p, i) => mixPt(p, L2[n][i], k));
    legs = out;
  }

  // The trunk's own directions: along the spine and out through the back.
  const D = Math.hypot(S[0] - H[0], S[1] - H[1]) || 1;
  const ax = [(S[0] - H[0]) / D, (S[1] - H[1]) / D];
  const up = [ax[1], -ax[0]];
  const at = (u, v) => [H[0] + ax[0] * u + up[0] * v, H[1] + ax[1] * u + up[1] * v];
  const crx = b.chest[0], cry = b.chest[1];
  const withers = [S[0] + up[0] * cry, S[1] + up[1] * cry];

  // Head: neck out of the front of the chest, then the head on the end of it.
  const car = (bd, name) => (CARRIAGE[bd] || CARRIAGE.stand)[name] || CARRIAGE.stand.fwd;
  const turnOf = (name) => (name === 'back' ? 1 : 0);
  let c0 = car(body, P.head || 'fwd');
  let na = c0[0], pitch = c0[1], toGround = c0[2] || 0, turn = turnOf(P.head) || (P.headBack ? 1 : 0);
  if (k) { const c1 = car(P.to, P.head || 'fwd'); na = lerp(na, c1[0], k); pitch = lerp(pitch, c1[1], k); toGround = lerp(toGround, c1[2] || 0, k); }
  if (P.headTo && P.hk) {
    const c2 = car(k > 0.5 ? P.to : body, P.headTo);
    na = lerp(na, c2[0], P.hk); pitch = lerp(pitch, c2[1], P.hk); toGround = lerp(toGround, c2[2] || 0, P.hk);
    turn = lerp(turn, turnOf(P.headTo), P.hk);
  }
  if (P.turn != null) turn = P.turn;
  na += P.na || 0; pitch += P.pitch || 0;
  const fs = Math.cos(Math.PI * turn);
  const dir = fs >= 0 ? 1 : -1;
  const nb = [S[0] + ax[0] * crx * 0.5 + up[0] * cry * 0.5, S[1] + ax[1] * crx * 0.5 + up[1] * cry * 0.5];
  // Looking back, the neck swings over the shoulder as the head comes round.
  const nA = rad(na - turn * 26);
  let C = [nb[0] + Math.cos(nA) * b.neck[2], nb[1] + Math.sin(nA) * b.neck[2]];
  const th = rad(pitch);
  const f = [Math.cos(th) * dir, Math.sin(th)], dn = [-Math.sin(th) * dir, Math.cos(th)];
  const mlen = hd.muz[0] * Math.max(0.12, Math.abs(fs));
  const tipU = hd.skull[0] + mlen - 0.6, tipV = hd.muz[3];
  const noseY0 = C[1] + f[1] * tipU + dn[1] * tipV;
  if (toGround) C = [C[0], C[1] + (G - 1.6 - noseY0) * toGround];
  C = [C[0] + (P.hdx || 0), C[1] + (P.hdy || 0)];
  // The nose and the flews stop at the ground, whatever was asked.
  const low = C[1] + f[1] * tipU + dn[1] * (tipV + hd.muz[2] * 0.6);
  if (low > G - 0.6) C = [C[0], C[1] - (low - (G - 0.6))];
  const hp = (u, v) => [C[0] + f[0] * u + dn[0] * v, C[1] + f[1] * u + dn[1] * v];
  const nose = hp(tipU, tipV - hd.muz[2] * 0.3);

  // The harness: a plate along the top of the shoulders, the ring at its
  // rear end, standing two rows off the back.
  const plateA = [withers[0] - ax[0] * 4.2, withers[1] - ax[1] * 4.2], plateB = [withers[0] + ax[0] * 2.2, withers[1] + ax[1] * 2.2];
  const ring = [Math.round(plateA[0] + up[0] * 2.2 - ax[0] * 0.3), Math.round(plateA[1] + up[1] * 2.2 - ax[1] * 0.3)];
  const croup = [H[0] + up[0] * (b.rump[1] + 2) - ax[0] * 1, H[1] + up[1] * (b.rump[1] + 2) - ax[1] * 1];
  return {
    b, hd, coat, body, S, H, legs, at, ax, up, D, withers, nb, C, f, dn, fs, dir, mlen, hp, nose, tailAt,
    plateA, plateB, ring, lineIn: [Math.round(croup[0]), Math.round(croup[1])],
    ne: [Math.round(C[0]), Math.round(C[1])],
    // The trunk's span, for keeping the line's low point clear of the dog.
    span: [Math.round(H[0] - b.rump[0]) - 1, Math.round(S[0] + crx) + 1], back: Math.round(Math.min(S[1] - cry, H[1] - b.rump[1])),
  };
}

/** A point in the dog's box, to the scene, allowing for a mirrored dog.
    A mirrored dog turns on the spot: its body keeps its place. */
const DOG_TURN = 5;

export function dogToScene(P, pt) {
  if (!P.flip) return [P.x + pt[0], P.y + pt[1]];
  return [P.x + DOG_BOX.w - 1 - pt[0] - DOG_TURN, P.y + pt[1]];
}

const page = { B: null };

/* A paw: four wide, two deep, the toes a tone lighter, a nail's gap in the
   bottom row. Rounded to the grid here so a paw is never a smear. */
function paw(B, p, far, m) {
  const x = Math.round(p[0]) - 1 + PAD, y = Math.round(p[1]) - 1 + PAD;
  const t = far ? 1 : 2;
  for (let i = 0; i < 4; i++) { dot(B, x + i, y, m, i === 3 && !far ? 3 : t); dot(B, x + i, y + 1, m, i === 2 ? Math.max(0, t - 1) : t); }
}

function tail(B, L, P, sp, body) {
  const lying = body !== 'stand' && !(P.to === 'stand' && P.k > 0.5);
  // Standing, each build carries its tail its own way. On the ground it lies
  // out behind, a little shorter (it curves towards us), tapering all the
  // way, and turns up at the end: laid straight with a square end it was a
  // plank, the same plank for every dog.
  const n = lying ? Math.max(4, Math.round(sp.len * (body === 'sit' ? 0.8 : 0.9))) : sp.len;
  let a = rad((lying ? -8 : sp.at) + (P.tail || 0));
  const curl = rad((lying ? 0 : sp.curl) + (P.tailTip || 0)) / n;
  const hook = rad(sp.len > 10 ? 15 : sp.len > 6 ? 11 : 6);
  let x = L.tailAt[0] + PAD, y = L.tailAt[1] + PAD;
  const r = sp.r;
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1 || 1);
    let rr = u < 0.5 ? lerp(r[0], r[1], u * 2) : lerp(r[1], r[2], u * 2 - 1);
    if (lying) rr *= 1 - u * 0.3;
    const nx = x - Math.cos(a), ny = Math.min(y - Math.sin(a), G + PAD - rr * 0.6);
    limb(B, [x, y], [nx, ny], rr, rr, { m: sp.tip && i >= n - sp.tip ? M.tip : M.tail });
    if (sp.plume && i > 0) dot(B, Math.round(nx), Math.round(ny + rr + 1), M.tail, 1);
    x = nx; y = ny; a += curl + (lying && u > 0.4 ? hook + rad(P.tailTip || 0) / n : 0);
  }
}

/* The harness, over the trunk: a strap from the breastbone up the front of
   the shoulder (the Y front), a girth behind the elbow, a plate along the
   withers with reflective piping, a handle, and the ring at the plate's
   rear where the line clips on. */
function harness(B, L) {
  const p = (q) => [q[0] + PAD, q[1] + PAD];
  const { S, ax, up, b } = L;
  const crx = b.chest[0], cry = b.chest[1];
  const pt = (u, v) => [S[0] + ax[0] * u + up[0] * v + PAD, S[1] + ax[1] * u + up[1] * v + PAD];
  // A line of the harness's own ink each side of every strap: without it a
  // red harness on a red hound is only its piping.
  const strap = { m: M.harness, atop: true, t: 2, edge: true, ink: true };
  // Sat up, the trunk stands on end and the plate is seen from behind: a
  // short block with two pixels of piping, not a striped bar across the back.
  const steep = Math.abs(ax[1]) > 0.5;
  // Girth, behind the elbow.
  limb(B, pt(-3.4, cry + 1), pt(-3.4, steep ? -cry * 0.2 : -cry - 1), 0.8, 0.8, strap);
  // The plate along the withers: light on top, a row of reflective piping.
  const a = steep ? mixPt(L.plateA, L.plateB, 0.35) : L.plateA;
  limb(B, p(a), p(L.plateB), 1.4, 1.4, { m: M.harness, lit: [-0.3, 0.6], edge: true, ink: true });
  for (let i = steep ? 3.5 : 0.5; i <= (steep ? 5 : 6); i += 1) dot(B, L.plateA[0] + ax[0] * i - up[0] * 0.9 + PAD, L.plateA[1] + ax[1] * i - up[1] * 0.9 + PAD, M.refl, 3);
}

/* The Y front: from the plate down the front of the shoulder to the
   breastbone. It lies over the root of the neck, so it is drawn after the
   neck and before the head, which may hang in front of it. */
function yfront(B, L) {
  const { S, ax, up, b } = L;
  const crx = b.chest[0], cry = b.chest[1];
  const pt = (u, v) => [S[0] + ax[0] * u + up[0] * v + PAD, S[1] + ax[1] * u + up[1] * v + PAD];
  const a = pt(2.2, cry + 0.4), z = pt(crx + 1.2, -cry * 0.3);
  limb(B, a, z, 0.8, 0.8, { m: M.harness, atop: true, t: 2, edge: true, ink: true });
  // The piping runs the length of the chest strap, on its upper edge.
  for (let k = 0.18; k <= 0.86; k += 0.085) { const q = mixPt(a, z, k); tint(B, q[0] - up[0] * 0.5, q[1] - up[1] * 0.5 - 0.3, 4, M.harness); }
}

/* After the contour, so daylight shows under them: the handle (a low loop
   of webbing over the plate) and the ring at the plate's rear. */
function fittings(B, L) {
  const { ax, up } = L;
  const at = (u, v) => [Math.round(L.plateA[0] + ax[0] * u + up[0] * v) + PAD, Math.round(L.plateA[1] + ax[1] * u + up[1] * v) + PAD];
  // A dog looking round brings its head and neck in front of the plate: the
  // handle and the ring stay behind them, or they are drawn across its face.
  const turned = L.fs < 0.3;
  const put = (x, y, m, t) => {
    if (turned) { const was = matAt(B, x, y); if (was === M.head || was === M.muzzle || was === M.ear || was === M.earIn || was === M.nose || was === M.eye || was === M.iris) return; }
    dot(B, x, y, m, t);
  };
  if (Math.abs(ax[1]) <= 0.5) for (const [u, v] of [[2.2, 2.6], [3.2, 3.6], [4.2, 3.6], [5.2, 3.6], [6.2, 2.6]]) { const q = at(u, v); put(q[0], q[1], M.web, v > 3 ? 3 : 1); }
  const r = [L.ring[0] + PAD, L.ring[1] + PAD];
  put(r[0], r[1], M.metal, 4); put(r[0] - 1, r[1], M.metal, 1); put(r[0], r[1] - 1, M.metal, 2); put(r[0] - 1, r[1] - 1, M.metal, 3);
}

/* The coat's pattern, laid on the trunk's body fur only. */
function markings(B, L, coat) {
  const { b, D, at } = L;
  const p = (u, v) => { const q = at(u, v); return [q[0] + PAD, q[1] + PAD]; };
  const rr = b.rump[1], cr = b.chest[1], rrx = b.rump[0], crx = b.chest[0];
  const lay = (pts, m) => shape(B, pts, { m, on: M.body, keep: true });
  if (coat.belly) lay([p(-rrx - 2, -rr * 0.5), p(D * 0.5, -(rr - b.tuck) * 0.45), p(D + crx + 2, -cr * 0.35), p(D + crx + 2, -cr - 3), p(-rrx - 2, -rr - 3)], M.points);
  if (coat.mark === 'wash') lay([p(-rrx - 2, rr + 3), p(D + crx * 0.7, cr + 3), p(D + crx * 0.5, cr * 0.42), p(D * 0.5, rr * 0.5), p(-rrx - 2, rr * 0.4)], M.back);
  if (coat.mark === 'saddle') lay([p(-rrx - 2, rr + 3), p(D + crx * 0.3, cr + 3), p(D + 1, cr * 0.1), p(D * 0.66, -cr * 0.42), p(D * 0.2, -rr * 0.4), p(-rrx - 2, -rr * 0.1)], M.back);
  if (coat.mark === 'blanket') {
    lay([p(-rrx * 0.2, rr + 3), p(D - 1.5, cr + 3), p(D - 2.5, cr * 0.1), p(D * 0.5, -cr * 0.2), p(rrx * 0.2, 0)], M.back);
    ball(B, p(D + crx * 0.75, -cr * 0.3)[0], p(D + crx * 0.75, -cr * 0.3)[1], 2.6, 3.4, { m: M.points, on: M.body, keep: true });
  }
  if (coat.mark === 'patches') {
    const a = p(D * 0.82, cr * 0.25), c = p(D * 0.12, rr * 0.3);
    ball(B, a[0], a[1], 3.4, 3.6, { m: M.back, on: M.body, keep: true });
    ball(B, c[0], c[1], 3.2, 3.6, { m: M.back, on: M.body, keep: true });
  }
}

function ears(B, L, P, far) {
  const { hd, hp, f, dn, dir, fs } = L;
  const E = DOG_EARS[hd.ear];
  const sw = P.ear || [0, 0];
  const p = (q) => [q[0] + PAD, q[1] + PAD];
  const side = Math.abs(fs) < 0.3;
  if (hd.ear === 'prick') {
    // Upright ears turn with the head. The far one shows a little behind.
    const off = far ? -1.6 : 0, lean = sw[0] * 0.8, flat = sw[1];
    const base = hp(E.set[0] + off - (side ? 2 : 0), E.set[1] + 0.6);
    const front = [base[0] + f[0] * E.w * 0.5, base[1] + f[1] * E.w * 0.5], back = [base[0] - f[0] * E.w * 0.5, base[1] - f[1] * E.w * 0.5];
    const tip = [base[0] - dn[0] * (E.len - Math.abs(flat)) + f[0] * (0.4 + lean - flat * 1.6), base[1] - dn[1] * (E.len - Math.abs(flat)) + f[1] * (0.4 + lean - flat * 1.6)];
    shape(B, [p(back), p(front), p(tip)], { m: M.ear, t: far ? 1 : 2, under: far });
    if (!far) {
      // The inside of the ear, towards the front.
      const mid = mixPt(mixPt(back, front, 0.62), tip, 0.38);
      limb(B, p(mixPt(back, front, 0.6)), p(mid), 0.5, 0.4, { m: M.earIn, t: 2, on: M.ear });
      dot(B, tip[0] + PAD, tip[1] + PAD, M.ear, 1);
    }
    if (side && !far) {
      const b2 = hp(E.set[0] + 3.4, E.set[1] + 0.6);
      shape(B, [p([b2[0] - 1.8, b2[1]]), p([b2[0] + 1.8, b2[1]]), p([b2[0] + 0.6, b2[1] - E.len])], { m: M.ear, t: 2 });
    }
    return;
  }
  if (far) return;
  if (hd.ear === 'drop') {
    // A triangle folded close to the cheek, hanging to the jaw line.
    const a = hp(E.set[0] - 1.6, E.set[1]), c = hp(E.set[0] + E.w - 1.8, E.set[1] + 0.4);
    const tipx = (a[0] + c[0]) / 2 - dir * 0.8 + sw[0], tipy = Math.max(a[1], c[1]) + E.len + sw[1];
    shape(B, [p(a), p(c), p([tipx + dir * 1.2, tipy - 1]), p([tipx, tipy]), p([tipx - dir * 1.6, tipy - 2.4])], L.coat.earT != null ? { m: M.ear, edge: true, t: L.coat.earT } : { m: M.ear, edge: true, lit: [-0.7, 0.2] });
    return;
  }
  // Hanging ears: from the set straight down, the tip swung by `sw`.
  const set = hp(E.set[0], E.set[1]);
  const tip = [set[0] - dir * 0.6 + sw[0], Math.min(set[1] + E.len + sw[1], G + 1 - E.r[1])];
  const mid = [lerp(set[0], tip[0], 0.5) - dir * 0.4 + sw[0] * 0.2, lerp(set[1], tip[1], 0.5)];
  if (L.coat.fur.earIn) {
    limb(B, p([set[0] + dir, set[1]]), p([mid[0] + dir, mid[1]]), E.r[0], E.r[0], { m: M.earIn, t: 2, edge: true });
    limb(B, p([mid[0] + dir, mid[1]]), p([tip[0] + dir, tip[1]]), E.r[0], E.r[1], { m: M.earIn, t: 2 });
  }
  limb(B, p(set), p(mid), E.r[0] * 0.92, E.r[0], { m: M.ear, edge: !L.coat.fur.earIn, lit: [-0.85, 0.5] });
  limb(B, p(mid), p(tip), E.r[0], E.r[1], { m: M.ear, edge: !L.coat.fur.earIn, lit: [-2, 0.45] });
  // A fold of light down the ear's leather.
  for (let k = 0.15; k < 0.8; k += 0.12) { const q = mixPt(set, tip, k); tint(B, q[0] - dir + PAD, q[1] + PAD, 3, M.ear); }
  if (E.fringe) {
    for (let i = -2; i <= 2; i++) dot(B, Math.round(tip[0]) + i + PAD, Math.round(tip[1] + E.r[1]) + (i & 1 ? 1 : 0) + PAD, M.ear, i & 1 ? 1 : 2);
  }
}

function head(B, L, P) {
  const { hd, hp, C, f, dn, dir, fs, mlen, coat, b } = L;
  const p = (q) => [q[0] + PAD, q[1] + PAD];
  const sx = hd.skull[0], sy = hd.skull[1], mz = hd.muz;
  const neckM = coat.neck === 'body' ? M.body : M.head;
  ears(B, L, P, true);
  // Neck: out of the shoulders to the back of the skull.
  limb(B, p(L.nb), p([C[0] - f[0] * sx * 0.35, C[1] - f[1] * sx * 0.35 + 0.5]), b.neck[0], b.neck[1], { m: neckM, lit: coat.sheen ? [-0.25, 0.55] : [-0.62, 0.3] });
  if (hd.flews) {
    // The dewlap: loose skin under a hound's throat.
    const d = mixPt(L.nb, C, 0.62);
    ball(B, d[0] + PAD + dir * 1.2, d[1] + PAD + b.neck[1] * 0.8 + (P.jowl || 0), 2.4, 2.2, { m: M.points, bias: 0, lit: [-2, 0.1] });
  }
  yfront(B, L);
  // A black coat is modelled by its sheen: more of each mass is in the light.
  ball(B, C[0] + PAD, C[1] + PAD, sx, sy, { m: M.head, lit: coat.sheen ? [-0.05, 0.7] : [-0.5, 0.42] });
  const face = Math.abs(fs) < 0.3;
  if (face) {
    // Half way round, the head is seen from the front: no length to the
    // muzzle, two eyes, the nose in the middle.
    ball(B, C[0] + PAD, C[1] + PAD + sy * 0.45, mz[1] + 0.4, mz[1], { m: M.muzzle, lit: [-0.6, 0.4] });
    dot(B, C[0] + PAD, C[1] + PAD + sy * 0.3, M.nose, 2); dot(B, C[0] + PAD + 1, C[1] + PAD + sy * 0.3, M.nose, 2);
    dot(B, C[0] + PAD - 2, C[1] + PAD - 1, M.eye, 0); dot(B, C[0] + PAD + 3, C[1] + PAD - 1, M.eye, 0);
    ears(B, L, P, false);
    return;
  }
  const m0 = hp(sx * 0.2, mz[3] * 0.7), m1 = hp(sx + mlen - mz[2], mz[3]);
  limb(B, p(m0), p(m1), mz[1], mz[2], { m: M.muzzle, lit: coat.sheen ? [0.1, 0.75] : [-0.45, 0.4] });
  if (coat.mask) {
    // The mask runs up from the muzzle to the eyes.
    const q = hp(sx * 0.8, 1.3);
    ball(B, q[0] + PAD, q[1] + PAD, 2.2, 2.0, { m: M.muzzle, on: M.head, keep: true });
  }
  if (coat.blaze) {
    // A white blaze from the muzzle up between the eyes.
    limb(B, p(hp(sx * 0.95, -0.6)), p(hp(sx * 0.35, -sy - 0.5)), 1.1, 0.7, { m: M.muzzle, on: M.head, keep: true });
  }
  if (coat.cheek) {
    const q = hp(0.4, sy * 0.55);
    ball(B, q[0] + PAD, q[1] + PAD, 2.2, 1.6, { m: M.points, on: M.head, keep: true });
  }
  if (hd.flews) {
    // Flews: the heavy lips hang below the jaw and arrive a frame late.
    const q = hp(sx + mlen * 0.5, mz[3] + mz[2] + 0.3 + (P.jowl || 0));
    ball(B, q[0] + PAD, q[1] + PAD, 2.4, 1.7, { m: M.muzzle, lit: [-2, -0.1] });
  }
  // Mouth: a dark line back from the nose; open, it shows the tongue.
  const tipU = sx + mlen - 0.8, lipV = mz[3] + mz[2] * 0.5;
  if (P.mouth || P.tongue) {
    const j0 = hp(sx * 0.7, lipV + 0.6), j1 = hp(tipU - 0.8, lipV + 2.2);
    limb(B, p(j0), p(j1), 1, 0.8, { m: M.muzzle, t: 1 });
    for (let u = sx * 0.9; u <= tipU - 0.6; u += 0.8) { const q = hp(u, lipV + 0.7); dot(B, q[0] + PAD, q[1] + PAD, M.tongue, 0); }
    if (P.tongue) {
      const q = hp(tipU - 1.2, lipV + 1.2);
      dot(B, q[0] + PAD, q[1] + PAD, M.tongue, 2); dot(B, q[0] + PAD + dir, q[1] + PAD, M.tongue, 3);
      dot(B, q[0] + PAD + dir, q[1] + PAD + 1, M.tongue, 2); dot(B, q[0] + PAD + dir, q[1] + PAD + 2, M.tongue, 2);
    }
  } else {
    for (let u = sx + mlen * 0.25; u <= tipU; u += 0.8) { const q = hp(u, lipV - 0.2); tint(B, q[0] + PAD, q[1] + PAD, 1, M.muzzle); }
  }
  // Nose: two by two on the end of the muzzle, a light on its top.
  // On a blunt muzzle the nose is the front-most thing, not the lip under it.
  const n = hp(sx + mlen - (hd.blunt ? 0.2 : 0.9), mz[3] - mz[2] + (hd.blunt ? 1.4 : 1.1));
  const nx = Math.round(n[0]) + PAD, ny = Math.round(n[1]) + PAD;
  dot(B, nx, ny, M.nose, 3); dot(B, nx - dir, ny, M.nose, 2); dot(B, nx, ny + 1, M.nose, 0); dot(B, nx - dir, ny + 1, M.nose, 1);
  // Eye: two dark pixels, the light in the top one's corner; a hound's
  // droops, with a fold of brow over it.
  const e = hp(hd.eye[0], hd.eye[1]);
  const ex = Math.round(e[0]) + PAD, ey = Math.round(e[1]) + PAD;
  if (P.blink) { tint(B, ex, ey + 1, 1); tint(B, ex + dir, ey + 1, 1); }
  else {
    dot(B, ex, ey, M.eye, 4); dot(B, ex + dir, ey, M.eye, 0);
    dot(B, ex, ey + 1, M.eye, 0); dot(B, ex + dir, ey + 1, M.eye, 0);
    if (coat.iris) { dot(B, ex, ey + 1, M.iris, 2); dot(B, ex + dir, ey + 1, M.iris, 3); }
    if (hd.flews) { tint(B, ex, ey + 2, 1); tint(B, ex + dir, ey + 2, 1); tint(B, ex - dir, ey - 1, 1); tint(B, ex, ey - 1, 1); tint(B, ex + dir, ey - 1, 1); }
  }
  ears(B, L, P, false);
}

function foreleg(B, J, far, b) {
  const p = (q) => [q[0] + PAD, q[1] + PAD];
  const o = far ? { m: M.body, t: 1, under: true } : { m: M.body, edge: true, lit: [-2, 2] };
  const lo = far ? { m: M.leg, t: 1, under: true } : { m: M.leg, lit: [-2, 2], edge: true };
  limb(B, p(J[0]), p(J[1]), b.leg + 0.6, b.leg + 0.2, o);
  limb(B, p(J[1]), p(J[2]), b.leg + 0.15, b.leg - 0.25, lo);
  paw(B, J[3], far, M.leg);
}

function hindleg(B, J, far, b, folded) {
  const p = (q) => [q[0] + PAD, q[1] + PAD];
  const o = far ? { m: M.body, t: 1, under: true } : { m: M.body, edge: true, lit: [-0.75, 0.6] };
  const lo = far ? { m: M.leg, t: 1, under: true } : { m: M.leg, lit: [-2, 2] };
  // The thigh is a mass, not a stick: wide at the hip, narrowing to the stifle.
  limb(B, p(J[0]), p(J[1]), folded ? b.rump[0] * 0.92 : b.rump[0] * 0.78, b.leg + 1.0, o);
  limb(B, p(J[1]), p(J[2]), b.leg + 0.6, b.leg - 0.1, far ? o : { m: M.body, lit: [-2, 2] });
  limb(B, p(J[2]), p([J[3][0] - 0.4, J[3][1] - 1.4]), b.leg - 0.15, b.leg - 0.3, lo);
  paw(B, J[3], far, M.leg);
}

/** Draw the dog. P: { x, y, flip, body, to, k, legs:{phase, gait, stride},
    head, headTo, hk, turn, na, pitch, hdx, hdy, ear:[dx,dy], tail, tailTip,
    jowl, mouth, tongue, blink, paw, jx, bob, rump, short, toy } */
export function drawDog(c, P, coat, stage) {
  if (!P.coat) P = Object.assign({}, P, { coat });
  const L = dogLayout(P);
  const b = L.b, body = L.body;
  if (!page.B) page.B = sheet(DOG_BOX.w + PAD * 2, DOG_BOX.h + PAD * 2);
  const B = page.B;
  wipe(B);
  const p = (q) => [q[0] + PAD, q[1] + PAD];
  const sp = TAILS[L.hd.tail];
  const folded = body !== 'stand' && !(P.to === 'stand' && P.k > 0.5) || (P.to && P.to !== 'stand' && P.k > 0.5);

  tail(B, L, P, sp, body);
  hindleg(B, L.legs.fh, true, b, folded);
  foreleg(B, L.legs.ff, true, b);

  // The trunk: chest, loin and rump as three masses, the belly rising to
  // the loin by the build's tuck.
  const S = L.S, H = L.H, cr = b.chest, rp = b.rump;
  const loin = rp[1] - b.tuck * 0.5;
  limb(B, p([S[0], S[1] + 0.2]), p([H[0] + L.up[0] * b.tuck * 0.5, H[1] + L.up[1] * b.tuck * 0.5]), cr[1] - 0.3, loin, { m: M.body, under: false });
  const tl = coat.sheen ? [-0.3, 0.5] : null;
  ball(B, H[0] + PAD, H[1] + PAD, rp[0], rp[1], { m: M.body, lit: tl });
  ball(B, S[0] + PAD, S[1] + PAD, cr[0], cr[1], { m: M.body, lit: tl });
  // The breastbone: the chest comes forward under the neck.
  ball(B, S[0] + L.ax[0] * cr[0] * 0.55 + PAD, S[1] + L.ax[1] * cr[0] * 0.55 + PAD + 0.6, cr[0] * 0.6, cr[1] * 0.78, { m: M.body });
  markings(B, L, coat);
  if (coat.sheen) {
    // The sheen along a black back: light over the rump and the shoulder,
    // a short run of glint on each, so the trunk has a top and a side.
    const x0 = Math.round(H[0]) - 2 + PAD, x1 = Math.round(S[0]) + 4 + PAD;
    for (let x = x0; x <= x1; x++) {
      let y = 0;
      while (y < B.h && B.m[y * B.w + x] !== M.body) y++;
      if (y >= B.h - 2) continue;
      const u = (x - x0) / (x1 - x0);
      const hot = (u > 0.12 && u < 0.34) || (u > 0.66 && u < 0.86);
      tint(B, x, y, hot ? 4 : 3, M.body); tint(B, x, y + 1, 3, M.body); if (hot) tint(B, x, y + 2, 3, M.body);
    }
  }
  if (L.hd.flews && body === 'stand') {
    // Loose skin: a fold at the shoulder and one at the flank.
    const q = L.at(L.D - 3.4 + (P.fold || 0), 0), q2 = L.at(L.D * 0.3 - (P.fold || 0), -1);
    for (let i = 0; i < 4; i++) { tint(B, q[0] + PAD - i * 0.3, q[1] + PAD - 1 + i, 1); }
    for (let i = 0; i < 3; i++) { tint(B, q2[0] + PAD + i * 0.3, q2[1] + PAD + i, 1); }
  }
  harness(B, L);

  hindleg(B, L.legs.nh, false, b, folded);
  foreleg(B, L.legs.nf, false, b);
  if (coat.mark === 'patches') {
    // Ticking down a springer's legs, and its feathering.
    for (const J of [L.legs.nf, L.legs.nh]) {
      const a = J[J.length - 2], t = J[J.length - 1];
      for (let k = 0.2; k < 1; k += 0.3) { const q = mixPt(a, t, k); if (matAt(B, Math.round(q[0]) + PAD, Math.round(q[1]) + PAD) === M.leg) dot(B, q[0] + PAD, q[1] + PAD, M.leg, 1); }
    }
    const e = L.legs.nf[1];
    for (let i = 0; i < 4; i++) dot(B, e[0] - b.leg - 1 + PAD, e[1] + i + PAD, M.leg, i & 1 ? 2 : 1);
    const u = L.at(L.D * 0.5, -(rp[1] - b.tuck));
    for (let i = -3; i <= 3; i++) dot(B, u[0] + i + PAD, u[1] + 1 + (i & 1) + PAD, M.body, i & 1 ? 1 : 2);
  }
  head(B, L, P);
  if (P.toy) {
    // The tug toy, held across the mouth.
    const q = L.hp(L.hd.skull[0] + L.mlen - 0.5, L.hd.muz[3] + L.hd.muz[2] * 0.4);
    const x = Math.round(q[0]) + PAD, y = Math.round(q[1]) + PAD;
    for (let j = -2; j <= 3; j++) { dot(B, x, y + j, j % 2 ? M.toyB : M.toyA, 2); dot(B, x + L.dir, y + j, j % 2 ? M.toyB : M.toyA, j < 0 ? 3 : 1); }
  }
  // A round end on a limb leaves one pixel standing proud of the back.
  for (let i = B.w + 1; i < B.m.length - B.w - 1; i++) {
    const m = B.m[i];
    if ((m === M.body || m === M.back || m === M.tail) && !B.m[i - B.w] && !B.m[i - 1] && !B.m[i + 1] && B.m[i + B.w] && B.m[i + B.w - 1] && B.m[i + B.w + 1]) B.m[i] = 0;
  }
  contour(B, P.rim);
  fittings(B, L);
  const img = develop(B, dogPal(coat, stage || 'hot'));
  c.save();
  if (P.flip) { c.translate(Math.round(P.x) + DOG_BOX.w - DOG_TURN + PAD, Math.round(P.y) - PAD); c.scale(-1, 1); c.drawImage(img, 0, 0); }
  else c.drawImage(img, Math.round(P.x) - PAD, Math.round(P.y) - PAD);
  c.restore();
}

const whole = (P) => (P.coat ? P : Object.assign({}, P, { coat: COATS[0] }));

/** The harness ring, in scene pixels: where the line clips on. */
export function dogRing(P) { return dogToScene(P, dogLayout(whole(P)).ring); }

/** Where the line crosses the croup on its way to the ring, in scene pixels. */
export function dogLineIn(P) { return dogToScene(P, dogLayout(whole(P)).lineIn); }

/** The top of the dog's head, in scene pixels: where a pat lands. */
export function dogHeadTop(P) {
  const L = dogLayout(whole(P));
  return dogToScene(P, [Math.round(L.C[0]), Math.round(L.C[1] - L.hd.skull[1])]);
}

/** The top of the shoulders, in scene pixels: where a stroke lands. */
export function dogShoulder(P) {
  const L = dogLayout(whole(P));
  return dogToScene(P, [Math.round(L.withers[0] + L.ax[0] * 3), Math.round(L.withers[1])]);
}

export function dogNose(P) {
  const L = dogLayout(whole(P));
  return dogToScene(P, [Math.round(L.nose[0]), Math.round(L.nose[1])]);
}

/** The columns the trunk covers and the row of its back, in scene pixels. */
export function dogSpan(P) {
  const L = dogLayout(whole(P));
  const a = dogToScene(P, [L.span[0], L.back]), b = dogToScene(P, [L.span[1], L.back]);
  return [Math.min(a[0], b[0]), Math.max(a[0], b[0]), a[1]];
}

