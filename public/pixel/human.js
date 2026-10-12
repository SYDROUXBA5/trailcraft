/* The people: the handler (eight jackets, three hats) and the person hiding
   at the end of the trail. Like the dog, a person is painted fresh for every
   pose from a skeleton (paint.js): hips, shoulders, the head, and limbs whose
   elbows and knees are found from where the hands and feet have to be. That
   is what lets a walk have eight frames, a fist-pump crouch first, and a hand
   land on the dog wherever the dog is. A person faces right; `flip` in the
   look turns them round. */

import { RAMPS } from './ramps.js';
import { ball, colours, contour, develop, dot, knee, limb, sheet, tint, wipe } from './paint.js';

/* `colour` is what a swatch shows: the jacket's own base tone. The ids are
   saved on teams and never change. */
export const JACKETS = [
  { id: 'navy', name: 'Navy' },
  { id: 'red', name: 'Red' },
  { id: 'forest', name: 'Forest' },
  { id: 'orange', name: 'Orange' },
  { id: 'hivis', name: 'Hi-vis' },
  { id: 'sky', name: 'Sky' },
  { id: 'slate', name: 'Slate' },
  { id: 'plum', name: 'Plum' },
].map(j => Object.assign(j, { colour: RAMPS.jackets[j.id][2] }));

export const jacketById = (id) => JACKETS.find(j => j.id === id) || JACKETS[0];

export const HATS = [
  { id: 'none', name: 'No hat' },
  { id: 'cap', name: 'Cap', colour: RAMPS.hats.cap[2] },
  { id: 'beanie', name: 'Beanie', colour: RAMPS.hats.beanie[2] },
  { id: 'bush', name: 'Bush hat', colour: RAMPS.hats.bush[2] },
];

/* The person hiding at the end of the trail: their own skin and hair, a
   yellow jacket with a reflective band, so they are never taken for the
   handler. */
export const RUNAWAY = { find: true, jacket: 'findYellow', hat: 'none' };

/* The person lives in a 24 × 40 box facing right; the soles stand on row 38
   and the feet's centre is column 12. They stand 34 rows tall, which leaves
   four above for a hat or a raised fist. */
export const HUMAN_BOX = { w: 24, h: 40, ground: 38 };

/* Proportions, in art pixels: about 3.6 heads tall. */
export const HUMAN_TORSO = { hip: 23.4, length: 9.0, shoulder: 4.3, waist: 3.5, thigh: 6.8, shin: 6.3, upper: 5.2, fore: 5 };
export const HUMAN_HEAD = { skull: [4.0, 4.1], face: [3.1, 3.3], above: 6.1 };
export const HATS_ART = { cap: { crown: 3, peak: 4 }, beanie: { crown: 4, bobble: true }, bush: { crown: 3, brim: 7 } };

const G = HUMAN_BOX.ground;
/* Room round the box for a fist above the head and a hat tipped off it. */
const PAD = 8;
const T = HUMAN_TORSO;

const M = { skin: 1, hair: 2, jacket: 3, trousers: 4, boots: 5, hat: 6, refl: 7, eye: 8, web: 9, toyA: 10, toyB: 11, lamp: 12 };
const EYE = ['#0c0a0e', '#1a1418', '#2a2024', '#8a7a80', '#ffffff'];
const TOY_A = ['#5a1a20', '#9a2a26', '#d23b2e', '#f27a5c', '#ffd0c0'];
const TOY_B = ['#16305e', '#1f4c8a', '#2f6fb8', '#6aa8e0', '#c8e4ff'];
const LAMP = ['#6a5a20', '#c8a83a', '#ffe98a', '#fff6c8', '#ffffff'];

const pals = new Map();

function humanPal(look) {
  const key = (look.find ? 'f/' : 'h/') + look.jacket + '/' + look.hat;
  let p = pals.get(key);
  if (p) return p;
  const P = RAMPS.people, r = [];
  r[M.skin] = look.find ? P.skinFind : P.skin;
  // The hider's hair is painted a tone down its ramp: at its own base it was
  // the skin's value and the head read as bald.
  r[M.hair] = look.find ? ['#2a100e', P.hairFind[0], P.hairFind[1], P.hairFind[2], P.hairFind[3]] : P.hair;
  r[M.jacket] = RAMPS.jackets[look.jacket] || RAMPS.jackets.navy;
  r[M.trousers] = P.trousers;
  r[M.boots] = P.boots;
  r[M.hat] = RAMPS.hats[look.hat] || RAMPS.hats.cap;
  r[M.refl] = RAMPS.kit.reflective;
  r[M.eye] = EYE;
  r[M.web] = RAMPS.kit.webbing;
  r[M.toyA] = TOY_A; r[M.toyB] = TOY_B; r[M.lamp] = LAMP;
  p = colours(r);
  pals.set(key, p);
  return p;
}

/* How a foot travels through one stride: on the ground going back for the
   first part, then lifted and brought forward. */
function footfall(ph, on, reach, lift) {
  ph = ((ph % 1) + 1) % 1;
  if (ph < on) return [reach * (1 - 2 * ph / on), 0];
  const u = (ph - on) / (1 - on);
  const e = u * u * (3 - 2 * u);
  return [reach * (-1 + 2 * e), lift * Math.sin(Math.PI * u)];
}

/** The gaits. `reach` is how far a foot lands in front of the hips and how
    far behind it leaves, `on` the part of the stride it spends on the
    ground: together with the stride's time they say how fast the ground has
    to pass for the feet not to slide (states.js works that out). */
export const HUMAN_GAITS = {
  walk: { on: 0.6, reach: 5.0, lift: 2.4 },
  run: { on: 0.5, reach: 5.2, lift: 3.2 },
};

/** Joints for a pose. o: { walk (0..1), gait, bob, crouch, sit, lean, breath,
    armN, armF (a way of holding the arm, or a point [x, y] in the box to put
    the hand on), pump (0..1), wave, feed, give, nod, blink, mouth, x, sway } */
export function humanPose(o) {
  o = o || {};
  const g = o.walk == null ? null : (HUMAN_GAITS[o.gait] || HUMAN_GAITS.walk);
  const ph = o.walk || 0;
  // The hips sink as the weight lands on a foot and rise as it passes over.
  const sink = g ? (Math.cos(ph * Math.PI * 4) > 0.3 ? 1 : 0) : 0;
  const lean = o.lean || 0, crouch = o.crouch || 0;
  let hip, sh;
  if (o.sit) {
    hip = [9.5, G - 3.2];
    sh = [hip[0] - 1.2 + lean, hip[1] - T.length + 0.6 + (o.bob || 0)];
  } else {
    // `sway` moves the weight over one foot without moving the feet.
    hip = [12 - crouch * 0.35 + (o.x || 0) + (o.sway || 0), T.hip + sink + crouch + (o.bob || 0)];
    sh = [hip[0] + lean + crouch * 0.5, hip[1] - T.length + crouch * 0.25 - (o.breath ? 1 : 0)];
  }
  const head = [sh[0] + 0.8 + lean * 0.35 + crouch * 0.15, sh[1] - HUMAN_HEAD.above + (o.nod || 0)];
  const P = { hip, sh, head, sit: !!o.sit, blink: !!o.blink, mouth: !!o.mouth, toy: !!o.toy };

  const leg = (near) => {
    const h = [hip[0] + (near ? 1.3 : -1.3), hip[1]];
    if (o.sit) {
      const kn = [h[0] + 5.4 + (near ? 0 : -1), G - 6.4 - (near ? 0 : 1)];
      return [h, kn, [h[0] + 9 + (near ? 0 : -1.5), G - 2], [h[0] + 9.6 + (near ? 0 : -1.5), G]];
    }
    const f = g ? footfall(ph + (near ? 0 : 0.5), g.on, g.reach, g.lift) : [near ? 1.4 : -1.6, 0];
    const foot = [12 + (o.x || 0) + f[0] + (g ? 0 : 0), G - f[1]];
    // A lifted foot trails its toe: the ankle leads it.
    const ank = [foot[0] - 0.6 - (f[1] > 0.6 ? 0.8 : 0), foot[1] - 2];
    return [h, knee(h, ank, T.thigh, T.shin, -1), ank, foot];
  };
  P.legN = leg(true); P.legF = leg(false);

  const arm = (near, mode) => {
    const s = [sh[0] + (near ? 2.6 : -2.0), sh[1] + 1.2];
    // `reach`: a punch at the sky is drawn longer than the arm is, or the
    // fist stops at the cap and reads as tipping it.
    let h, bend = 1, reach = 0;
    if (Array.isArray(mode)) h = mode;
    else switch (mode) {
      case 'line': h = [s[0] + 4.6 + (o.give || 0), s[1] + 4.4]; break;
      case 'low': h = [s[0] + 2.2, s[1] + 8.4]; break;
      case 'feed': h = [s[0] + 4 + (o.feed || 0) * 1.5, s[1] + 6.4]; break;
      case 'fist': { const p = o.pump || 0; h = [s[0] + 3.6 + p * 2.6, s[1] + 2.2 - p * 15.4]; bend = 1; reach = p * 4.4; break; }
      case 'wave': h = [s[0] + 4.6 + (o.wave || 0) * 2.6, s[1] - 8.4 + (o.wave || 0) * 1.5]; break;
      case 'knee': h = [P.legN[1][0] - (near ? 0.5 : 2), P.legN[1][1] - 1.5]; break;
      case 'hip': h = [s[0] + 0.5, s[1] + 7]; bend = 1; break;
      case 'swing': {
        const a = (ph + (near ? 0.5 : 0)) * Math.PI * 2;
        const sw = Math.cos(a) * (o.gait === 'run' ? 1.5 : 1);
        h = [s[0] + 0.4 + 3.4 * sw, s[1] + 9 - Math.abs(sw) * (o.gait === 'run' ? 3 : 1)];
        break;
      }
      default: h = [s[0] + 0.6, s[1] + 9.3];
    }
    // A hand cannot go further than the arm is long.
    const d = Math.hypot(h[0] - s[0], h[1] - s[1]), max = T.upper + T.fore + reach - 0.2;
    if (d > max) h = [s[0] + (h[0] - s[0]) * max / d, s[1] + (h[1] - s[1]) * max / d];
    return [s, knee(s, h, T.upper + reach / 2, T.fore + reach / 2, bend), h];
  };
  P.armN = arm(true, o.armN || 'hang');
  P.armF = arm(false, o.armF || 'hang');
  return P;
}

const page = { B: null };

function boot(B, leg, far) {
  const x = Math.round(leg[3][0]) + PAD, y = Math.round(leg[3][1]) + PAD;
  const t = far ? 1 : 2;
  // Heel, upper and toe, over a darker sole line.
  for (let i = -2; i <= 1; i++) dot(B, x + i, y - 2, M.boots, i === 1 && !far ? 3 : t);
  for (let i = -2; i <= 2; i++) dot(B, x + i, y - 1, M.boots, i === 2 && !far ? 3 : t);
  for (let i = -2; i <= 3; i++) dot(B, x + i, y, M.boots, far ? 0 : 1);
}

function legOf(B, leg, far) {
  const p = (q) => [q[0] + PAD, q[1] + PAD];
  const o = far ? { m: M.trousers, t: 1 } : { m: M.trousers, edge: true, lit: [-2, 2] };
  limb(B, p(leg[0]), p(leg[1]), 1.9, 1.5, o);
  limb(B, p(leg[1]), p([leg[2][0], leg[2][1] - 0.4]), 1.45, 1.25, o);
  // A crease of light down the shin of the near leg: the front of the leg
  // faces the sky a little.
  if (!far) for (let k = 0.25; k < 0.9; k += 0.25) tint(B, leg[1][0] + (leg[2][0] - leg[1][0]) * k + 1 + PAD, leg[1][1] + (leg[2][1] - leg[1][1]) * k + PAD, 3, M.trousers);
  boot(B, leg, far);
}

function armOf(B, arm, far, look) {
  const p = (q) => [q[0] + PAD, q[1] + PAD];
  const o = far ? { m: M.jacket, t: 1 } : { m: M.jacket, edge: true, lit: [-0.55, 2] };
  limb(B, p(arm[0]), p(arm[1]), far ? 1.5 : 1.75, far ? 1.3 : 1.5, o);
  limb(B, p(arm[1]), p(arm[2]), far ? 1.3 : 1.5, far ? 1.1 : 1.25, far ? o : { m: M.jacket, lit: [-0.55, 2] });
  // The hand: two by two, the knuckles a tone lighter, and a cuff behind it.
  const hx = Math.round(arm[2][0]) + PAD, hy = Math.round(arm[2][1]) + PAD;
  const dx = arm[2][0] - arm[1][0], dy = arm[2][1] - arm[1][1], d = Math.hypot(dx, dy) || 1;
  tint(B, arm[2][0] - dx / d * 1.6 + PAD, arm[2][1] - dy / d * 1.6 + PAD, far ? 0 : 1, M.jacket);
  dot(B, hx, hy, M.skin, far ? 1 : 3); dot(B, hx + 1, hy, M.skin, far ? 1 : 2);
  dot(B, hx, hy + 1, M.skin, far ? 1 : 2); dot(B, hx + 1, hy + 1, M.skin, 1);
  if (look.toyIn === (far ? 'f' : 'n')) {
    // The tug toy, held up by its middle.
    for (let j = -4; j <= -1; j++) { dot(B, hx, hy + j, j % 2 ? M.toyB : M.toyA, 2); dot(B, hx + 1, hy + j, j % 2 ? M.toyB : M.toyA, j === -4 ? 3 : 1); }
  }
}

function hat(B, P, look) {
  const kind = look.hat;
  if (!HATS_ART[kind]) return;
  const hx = P.head[0] + PAD, top = P.head[1] - HUMAN_HEAD.skull[1] + PAD - (look.hatLift || 0);
  if (kind === 'cap') {
    ball(B, hx - 0.4, top + 2.2, 4.7, 3.0, { m: M.hat, lit: [-0.3, 0.5] });
    // The peak, out over the eyes, its underside in shade.
    for (let i = 0; i < 5; i++) { dot(B, hx + 3 + i, top + 3.2, M.hat, i > 2 ? 3 : 2); if (i < 4) dot(B, hx + 3 + i, top + 4.2, M.hat, 1); }
  } else if (kind === 'beanie') {
    ball(B, hx - 0.4, top + 2.0, 4.8, 3.6, { m: M.hat, lit: [-0.4, 2] });
    for (let i = -5; i <= 4; i++) { dot(B, hx + i, top + 3.6, M.hat, i % 2 ? 1 : 2); dot(B, hx + i, top + 4.6, M.hat, 1); }
    dot(B, hx - 1, top - 2, M.hat, 3); dot(B, hx, top - 2, M.hat, 3); dot(B, hx - 1, top - 1, M.hat, 2); dot(B, hx, top - 1, M.hat, 2);
  } else {
    ball(B, hx - 0.4, top + 1.6, 4.0, 3.2, { m: M.hat, lit: [-0.3, 0.6] });
    for (let i = -7; i <= 7; i++) { dot(B, hx + i, top + 3.4, M.hat, i > 2 ? 3 : 2); if (Math.abs(i) < 7) dot(B, hx + i, top + 4.4, M.hat, 1); }
    for (let i = -4; i <= 3; i++) dot(B, hx + i, top + 2.4, M.hat, 0);
  }
}

/** Draw a person at box (x, y). look: { jacket, hat (ids), find, flip,
    torch, hatLift, toyIn }. `parts`: 'all', 'body' (no near arm) or 'arm'
    (the near arm alone, to go over a dog being patted). */
export function drawHuman(c, x, y, P, look, parts = 'all') {
  if (!page.B) page.B = sheet(HUMAN_BOX.w + PAD * 2, HUMAN_BOX.h + PAD * 2);
  const B = page.B;
  wipe(B);
  const p = (q) => [q[0] + PAD, q[1] + PAD];
  if (parts !== 'arm') {
    armOf(B, P.armF, true, look);
    legOf(B, P.legF, true);
    legOf(B, P.legN, false);
    // The trunk: wide at the shoulders, a waist, the jacket's hem over the
    // hips. The back of it is turned from the light.
    const sh = P.sh, hip = P.hip;
    limb(B, p([sh[0], sh[1] + 0.6]), p([hip[0], hip[1] - 0.5]), T.shoulder, T.waist, { m: M.jacket, lit: [-0.62, 0.72] });
    limb(B, p([sh[0] - 3.2, sh[1] + 2]), p([hip[0] - 2.8, hip[1] - 0.5]), 1.1, 1.0, { m: M.jacket, on: M.jacket, t: 1 });
    const hem = Math.round(hip[1] + 2.2) + PAD;
    for (let i = -4; i <= 4; i++) tint(B, hip[0] + i + PAD, hem, 1, M.jacket);
    // The zip, a pocket, and the bands of a jacket made to be seen.
    for (let k = 0.12; k <= 0.95; k += 0.09) tint(B, sh[0] + 2.2 + (hip[0] - sh[0]) * k + PAD, sh[1] + 1 + (hip[1] - sh[1]) * k + PAD, 1, M.jacket);
    tint(B, hip[0] + PAD, hip[1] - 2.6 + PAD, 1, M.jacket); tint(B, hip[0] - 1 + PAD, hip[1] - 2.6 + PAD, 1, M.jacket);
    const bands = look.find ? [0.42] : look.jacket === 'hivis' ? [0.34, 0.66] : [];
    for (const k of bands) {
      const by = Math.round(sh[1] + (hip[1] - sh[1]) * k) + PAD, bx = sh[0] + (hip[0] - sh[0]) * k + PAD;
      for (let i = -6; i <= 6; i++) if (B.m[by * B.w + Math.round(bx + i)] === M.jacket) dot(B, bx + i, by, M.refl, i > 1 ? 3 : 2);
    }
    // Neck and collar.
    limb(B, p([sh[0] + 0.7, sh[1] - 1.2]), p([P.head[0] - 0.2, P.head[1] + 2]), 1.7, 1.7, { m: M.skin, t: 1 });
    dot(B, sh[0] + 1 + PAD, sh[1] - 3 + PAD, M.jacket, 3); dot(B, sh[0] + 2 + PAD, sh[1] - 3 + PAD, M.jacket, 3); dot(B, sh[0] - 1 + PAD, sh[1] - 3 + PAD, M.jacket, 2); dot(B, sh[0] + PAD, sh[1] - 3 + PAD, M.jacket, 2);
    // The head: hair first, the face set into its lower front.
    const hx = P.head[0], hy = P.head[1];
    const sk = HUMAN_HEAD.skull, fc = HUMAN_HEAD.face;
    ball(B, hx - 0.3 + PAD, hy + PAD, sk[0], sk[1], { m: M.hair, lit: [-0.45, 0.55] });
    ball(B, hx + 1.2 + PAD, hy + 1.2 + PAD, fc[0], fc[1], { m: M.skin, lit: [-2, 0.62] });
    // Ear, brow, eye, nose, mouth.
    dot(B, hx - 1.4 + PAD, hy + 1 + PAD, M.skin, 1); dot(B, hx - 1.4 + PAD, hy + 2 + PAD, M.skin, 1);
    const ex = Math.round(hx + 2.3) + PAD, ey = Math.round(hy + 0.4) + PAD;
    if (P.blink) { dot(B, ex, ey + 1, M.skin, 1); dot(B, ex + 1, ey + 1, M.skin, 1); }
    else { dot(B, ex, ey, M.eye, 0); dot(B, ex, ey + 1, M.eye, 0); dot(B, ex + 1, ey, M.eye, 4); }
    dot(B, hx + 4.6 + PAD, hy + 1.6 + PAD, M.skin, 3);
    if (P.mouth) { dot(B, ex, ey + 3, M.eye, 1); dot(B, ex + 1, ey + 3, M.eye, 1); }
    else tint(B, ex + 1, ey + 3, 1, M.skin);
    hat(B, P, look);
  }
  if (parts !== 'body') armOf(B, P.armN, false, look);
  contour(B, look.rim);
  if (look.torch && parts !== 'arm') {
    // The head-torch: a strap round the brow and the lamp at the front.
    const hx = Math.round(P.head[0]) + PAD, hy = Math.round(P.head[1] - 2) + PAD;
    for (let i = -4; i <= 3; i++) dot(B, hx + i, hy, M.web, 2);
    dot(B, hx + 4, hy, M.lamp, 4); dot(B, hx + 5, hy, M.lamp, 3); dot(B, hx + 4, hy - 1, M.web, 3);
  }
  const img = develop(B, humanPal(look));
  x = Math.round(x); y = Math.round(y);
  if (look.flip) {
    c.save(); c.translate(x + HUMAN_BOX.w + PAD, y - PAD); c.scale(-1, 1); c.drawImage(img, 0, 0); c.restore();
  } else c.drawImage(img, x - PAD, y - PAD);
}

/** A point of the pose (say P.armN[2], the near hand) in scene pixels. */
export function handOf(x, y, pt, flip) {
  return flip ? [Math.round(x) + HUMAN_BOX.w - 1 - Math.round(pt[0]), Math.round(y) + Math.round(pt[1])] : [Math.round(x) + Math.round(pt[0]), Math.round(y) + Math.round(pt[1])];
}

/** Where the head-torch sits, in the box: the light the night beam starts at. */
export const lampOf = (P) => [Math.round(P.head[0]) + 5, Math.round(P.head[1] - 2)];
