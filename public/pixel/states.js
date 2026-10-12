/* What the team is doing at a given time: the looping states (waiting,
   trailing, lost, find, missed, resting, night) and the gaits they share.
   The one-shot moments are in moments.js. */

import { clamp, R, smooth } from './core.js';
import { DOG_BOX } from './dog.js';
import { HUMAN_BOX, HUMAN_GAITS } from './human.js';

/* A state is a pure function of time: frame(state, t) says where the team
   is and what it does, so any moment can be drawn again exactly. That is
   also how things arrive late here: an ear's swing is the head's movement
   of a frame ago, read from the same function one frame earlier. */

export const STATES = ['waiting', 'trailing', 'lost', 'find', 'missed', 'resting', 'night'];

/* The team space: 136 × 60, ground on row 54. The dog's box keeps its place;
   the handler stands behind it. ANCHOR is the point that stands on a stone:
   the handler's feet, so the handler stands on the team's stone and the dog
   leads off ahead of it along the trail. */
export const TEAM = { w: 136, h: 60, ground: 54 };

export const DX = 44;

export const HX = 4;

export const ANCHOR = [16, TEAM.ground];

export const LINE_LEN = 40;
/** The team's footprint on a board, in the team's own art pixels (facing
    right). The layout, the board and the showcase all need to keep stones,
    plaques and gates clear of the team, and each used to carry its own copy
    of these numbers: they follow TEAM, DX and the sprites, so they are said
    once, here, and change here when the sprites do.
      body   the columns the handler and dog fill, and how many rows tall
      ahead  how far in front of ANCHOR the dog's span starts and ends
      nose   the furthest forward any pixel of the dog goes, from ANCHOR
      gate   the column a boss's gate stands at while the team plays the boss */
export const REACH = Object.freeze({ body: Object.freeze([4, 92]), tall: 40, ahead: Object.freeze([26, 78]), nose: 78, gate: 96 });

export const dogY = TEAM.ground - DOG_BOX.ground;

export const humY = TEAM.ground - HUMAN_BOX.ground;

export const step = (t, ms) => Math.floor(t / ms);

/* Cycle steps are whole numbers of 30 fps ticks (33.3 ms), so no pose is
   held for an odd tick and the gait stays even. Every gait has eight
   frames. */
const WALK_MS = 100, TROT_MS = 67, RUN_MS = 67, DASH_MS = 50;

/** How fast the ground passes under each gait, in art pixels a second. The
    handler's stride sets it (a foot on the ground must not slide), and the
    dog's stride is cut to the same speed: a hound working a scent on a taut
    line takes short steps. Whoever moves the team (the close-up's scroll,
    the board's walk between stones) moves it at this speed. */
export const SPEED = {
  trail: 2 * HUMAN_GAITS.walk.reach / (HUMAN_GAITS.walk.on * WALK_MS * 8 / 1000),
  run: 2 * HUMAN_GAITS.run.reach / (HUMAN_GAITS.run.on * RUN_MS * 8 / 1000),
};
const dogReach = (speed, ms) => speed * 0.5 * (ms * 8 / 1000) / 2;

/* A wag: the root swings three poses each way, the tip a frame behind.
   Returns [root, tip], each -1..1. */
const WAG = [0.5, 1, 0.5, -0.5, -1, -0.5];
export const wagAt = (t, ms) => { const n = step(t, ms); return [WAG[n % 6], WAG[(n + 5) % 6] - WAG[n % 6]]; };

/** The old four-pose wag, for whoever still asks in degrees. */
export const wag = (t, ms, amp) => [0, amp, 0, -amp][step(t, ms) % 4];

/** The dog's trot. extra: pose fields to lay over it; o: { fast, stride }.
    The body rises a pixel as one diagonal pair of legs takes over from the
    other, the ears land a frame after it, the loose skin shifts, and the
    tail wags with its tip behind its root. */
export function dogTrot(t, extra, o) {
  const fast = o && o.fast, ms = fast ? DASH_MS : TROT_MS;
  const k = o && o.stride != null ? o.stride : 1;
  const n = step(t, ms), f = n % 8, pf = (f + 7) % 8;
  const up = (g) => (g % 4 === 0 ? -1 : 0);
  const w = wagAt(t, 67);
  return Object.assign({
    x: DX, y: dogY, body: 'stand',
    legs: { phase: f / 8, gait: 'trot', reach: dogReach(fast ? SPEED.run : SPEED.trail, ms) * k },
    bob: up(f), head: 'down', hdx: [0, 1, 1, 0, 0, -1, -1, 0][f] * 0.6,
    ear: [pf % 4 < 2 ? -0.7 : 0.5, -up(pf) * 1.5 - (up(f) ? 0 : 0)], fold: f % 4 < 2 ? 0 : 1,
    tail: 6 + w[0] * 9, tailTip: w[1] * 14, jowl: up(pf) ? 0.6 : 0,
  }, extra || {});
}

/** The handler's stride. o: { run, stride }. The free arm swings opposite
    the leg, and the head nods a frame after each foot lands. */
export function handlerWalk(t, extra, o) {
  const run = o && o.run, f = step(t, run ? RUN_MS : WALK_MS) % 8;
  return {
    x: HX, hold: 'n',
    o: Object.assign({ walk: f / 8, gait: run ? 'run' : 'walk', lean: run ? 1.2 : -1.4, armN: 'line', armF: 'swing', nod: f % 4 === 1 ? 1 : 0 }, extra || {}),
    hatLift: run && f % 4 === 1 ? 1 : 0,
  };
}

/* Standing: four breaths of 500 ms, the weight shifting to the other foot
   every other loop, a blink about every 3.2 s. */
export function handlerIdle(t, extra) {
  const n = step(t, 500) % 8;
  return Object.assign({ armN: 'low', breath: n % 4 === 1 || n % 4 === 2 ? 1 : 0, sway: n >= 4 ? -0.7 : 0.3, blink: (t % 3200) < 100 }, extra || {});
}

const SNIFF = [0, 1, 1, 0, -1, -1];

/* Sniffing on the spot: the nose works two pixels side to side, the ears a
   frame behind it. */
function sniffing(t) {
  const f = step(t, 133) % 6;
  return { head: 'down', hdx: SNIFF[f], ear: [-SNIFF[(f + 5) % 6] * 0.8, 0], jowl: f % 3 === 0 ? 0.6 : 0 };
}

export function frameWaiting(t) {
  const T = t % 6400;
  const dog = { x: DX, y: dogY, body: 'stand' };
  if (T < 3400) Object.assign(dog, sniffing(T));
  else if (T < 3667) {
    // The head comes up over two frames; the ears are still on their way.
    const k = T < 3533 ? 0.5 : 1;
    Object.assign(dog, { head: 'down', headTo: 'fwd', hk: k, ear: [0, k < 1 ? 1.5 : -1] });
  } else if (T < 4900) {
    Object.assign(dog, { head: 'fwd', mouth: true, tongue: step(T, 250) % 2 === 0, ear: [0, T < 3800 ? -1 : 0], blink: T > 4400 && T < 4500 });
  } else if (T < 5900) {
    // A look round at the handler, and back.
    const a = T - 4900;
    const k = a < 67 ? 0.4 : a < 133 ? 0.8 : a > 933 ? 0.4 : a > 866 ? 0.8 : 1;
    Object.assign(dog, { head: 'fwd', headTo: 'back', hk: k, ear: [k < 1 ? (a < 500 ? -1.5 : 1.5) : a < 200 ? 1 : 0, 0] });
  } else {
    const k = T < 6067 ? 0.35 : T < 6200 ? 0.8 : 1;
    Object.assign(dog, { head: 'fwd', headTo: 'down', hk: k, ear: [0, k < 1 ? -1.5 : 1] });
  }
  const w = wagAt(t, 133);
  dog.tail = w[0] * 10; dog.tailTip = w[1] * 14;
  return {
    handler: { x: HX, o: handlerIdle(t), hold: 'n' },
    dog, line: 54,
    fx: T < 3400 ? [{ kind: 'scent', near: true }] : [],
  };
}

export function frameTrailing(t) {
  const f = step(t, TROT_MS) % 8;
  // Each time a pair of legs takes over, the pull runs down the line to the
  // hand as a one-pixel wave over three frames.
  return { handler: handlerWalk(t), dog: dogTrot(t), line: LINE_LEN, wave: f % 4 < 3 ? (f % 4 + 0.5) / 3 : null, fx: [{ kind: 'scent' }, { kind: 'dust' }], moving: true, speed: SPEED.trail };
}

/* Lost it: the dog casts for the scent, the head sweeping low ahead, up to
   the air, round and low behind, and back, with a held beat at each end.
   `turn` is how far the head has come round (1 is looking straight back). */
const CAST_HEAD = [
  { head: 'low', turn: 0, hdx: 1 }, { head: 'low', turn: 0, hdx: 1 },
  { head: 'up', turn: 0.14 }, { head: 'up', turn: 0.5 },
  { head: 'low', turn: 1, hdx: -1 }, { head: 'low', turn: 1, hdx: -1 },
  { head: 'up', turn: 0.6 }, { head: 'fwd', turn: 0.16 },
];

export function frameLost(t) {
  const slow = smooth(t / 600);
  const handler = t < 500
    ? Object.assign(handlerWalk(t, { lean: -1.4 + slow }), { x: HX + R(slow * 3) })
    : { x: HX + 3, o: handlerIdle(t, { armN: 'feed', feed: step(t, 467) % 2, armF: 'feed' }), hold: 'n' };
  if (t < 600) {
    // The trot dies away: shorter steps, the head coming off the ground.
    return { handler, dog: dogTrot(t, { x: DX - R(slow * 3), headTo: 'low', hk: slow, tail: -10 * slow }, { stride: 1 - slow * 0.8 }), line: 44, fx: [] };
  }
  const T = t - 600, n = CAST_HEAD.length;
  const k = step(T, 133) % n;
  const h = CAST_HEAD[k], was = CAST_HEAD[(k + n - 1) % n], before = CAST_HEAD[(k + n - 2) % n];
  // Ears swing against the head's turn, a frame late, and settle a pixel past.
  const swing = (was.turn - h.turn) * 3 + (before.turn - was.turn) * -1;
  const w = wagAt(t, 133);
  return {
    handler,
    dog: { x: DX - 3, y: dogY, body: 'stand', head: h.head, turn: h.turn, hdx: h.hdx || 0, ear: [swing, -Math.abs(swing) * 0.6], tail: -22 + w[0] * 5, tailTip: w[1] * 8, paw: k === 3 ? 2 : 0 },
    line: 50,
    fx: [{ kind: 'query', blink: step(T, 333) % 4 !== 3 }],
  };
}

/* The fist-pump, once: a crouch of two pixels for two frames, the fist up
   over two, a held frame with a spark, and two to settle. */
const PUMP = [
  { crouch: 2, pump: 0 }, { crouch: 2, pump: 0 }, { pump: 0.55, bob: -1 }, { pump: 1, bob: -2 },
  { pump: 1, bob: -1, spark: true }, { pump: 0.6, bob: 1 }, { pump: 0.15 },
];

export function handlerPump(T) {
  const f = step(T, 67);
  if (f < 0 || f >= PUMP.length) return null;
  const p = PUMP[f];
  return { x: HX, hold: 'f', spark: !!p.spark, hatLift: f === 4 || f === 5 ? 1 : 0,
    o: { armN: 'fist', pump: p.pump, armF: 'feed', crouch: p.crouch || 0, bob: p.bob || 0, mouth: f >= 2 && f <= 5 } };
}

/* The dog's sit: a dip of a pixel the other way first, the rump down, a
   pixel past, and back. */
const SIT = [{ k: 0, bob: 1 }, { k: 0.55 }, { k: 1, rump: 1 }, { k: 1 }];

export function sitDown(T, base) {
  const f = clamp(step(T, 67), 0, 3), s = SIT[f];
  return Object.assign({ body: 'stand', to: 'sit', k: s.k, bob: s.bob || 0, rump: s.rump || 0, head: 'fwd', ear: [0, f === 2 ? 1.5 : f === 3 ? -1 : 0], tail: f < 2 ? 8 : 0 }, base);
}

/** The find. `from` skips the run-in, for the moments where the run-in is a trot. */
export function frameFind(t, from = 0, o) {
  t += from;
  // `pop` is when the person comes up: a moment that skips the run-in has
  // them rise as the team pulls up, not standing there already.
  const pop = o && o.pop != null ? o.pop : 420, stop = 650, up = 784, sat = 1052;
  const out = { fx: [], person: null, bush: true, line: LINE_LEN };
  const at = { x: DX + 2, y: dogY };
  if (t < stop) {
    out.dog = dogTrot(t, { tail: 12 }, { stride: t > 500 ? 0.5 : 1 });
    out.handler = t < 520 ? handlerWalk(t) : { x: HX, o: { armN: 'line', lean: -1 }, hold: 'n' };
  } else if (t < up) {
    // The head comes up, the ears a frame behind it; the line is still taut.
    const A = t < 717;
    out.dog = Object.assign({ body: 'stand', head: 'down', headTo: 'fwd', hk: A ? 0.55 : 1, ear: [0, A ? 1.5 : -1], tail: 14 }, at);
    out.line = 42;
    out.handler = { x: HX, o: { armN: 'line', lean: -0.6 }, hold: 'n' };
  } else if (t < sat) {
    out.dog = sitDown(t - up, at);
    out.line = 44 + step(t - up, 67) * 2;
    out.handler = { x: HX, o: { armN: 'line' }, hold: 'n' };
  } else {
    // The indication, every 2.4 s: sat facing the person, a look round at
    // the handler, a paw lifted, a bark or two; the tail sweeps the ground.
    const T = t - sat, L = T % 2400, f = step(L, 100);
    const back = f >= 2 && f <= 5 ? (f === 2 || f === 5 ? 0.5 : 1) : 0;
    const bark = (L >= 1200 && L < 1367) || (L >= 1533 && L < 1700);
    const w = wagAt(t, 67);
    out.dog = Object.assign({
      body: 'sit', head: 'fwd', headTo: 'back', hk: back, mouth: bark || (L > 1900), tongue: L > 1900 && step(L, 250) % 2 === 0,
      paw: f >= 7 && f <= 10 ? (f === 7 || f === 10 ? 1.5 : 3) : 0,
      ear: [f === 2 ? -1.5 : f === 6 ? 1.5 : 0, bark ? -1.5 : 0], tail: w[0] * 16, tailTip: w[1] * 18, hdy: bark ? -1 : 0,
    }, at);
    // The line overshoots slack and settles, two frames after the dog.
    out.line = T < 133 ? 50 : T < 200 ? 56 : T < 267 ? 53 : 54;
    out.handler = handlerPump(L) || { x: HX, o: handlerIdle(t, { armN: 'hip', armF: 'feed' }), hold: 'f' };
    if (out.handler.spark) out.fx.push({ kind: 'fist' });
    if (bark) out.fx.push({ kind: 'bark' });
    if ((T % 1800) < 900) out.fx.push({ kind: 'sparkle', t: T % 1800 });
  }
  // The person rises from behind the bush in three frames: crouched, half up, up.
  if (t >= pop) out.person = { rise: [18, 11, 2, 4][clamp(step(t - pop, 67), 0, 3)], wave: [0, 0.5, 1, 0.5][step(t, 133) % 4], toy: true };
  return out;
}

/* The shake-off, eight frames of 50 ms: the head leads, the twist runs down
   the body to the tail a frame behind each time, the ears fly wide. */
const SHAKE = [1.5, 2, 0, -2, -1.5, 0, 2, 0];

export function frameMissed(t) {
  const out = { fx: [], line: 52 };
  if (t < 400) {
    out.dog = Object.assign({ x: DX, y: dogY, body: 'stand', tail: -18 }, sniffing(t));
    out.handler = { x: HX, o: { armN: 'line', lean: -0.6 }, hold: 'n' };
    return out;
  }
  if (t < 1200) {
    const f = step(t - 400, 50) % 8, s = (j) => SHAKE[(f + 8 - j) % 8];
    out.dog = { x: DX, y: dogY, body: 'stand', head: 'fwd', hdx: s(0), pitch: s(0) * 5, jx: s(1) * 0.5, rx: s(2) * 0.5, tail: -10 + s(3) * 12, tailTip: s(4) * 14,
      ear: [-s(0) * 1.8, -3], jowl: Math.abs(s(1)) * 0.6, fold: f % 2, blink: true };
    out.handler = { x: HX, o: handlerIdle(t), hold: 'n' };
    if (f >= 3 && f <= 6 || t > 800) out.fx.push({ kind: 'drops', t: t - 400 });
    return out;
  }
  // A quiet trot back to the handler, a sit, a pat. The handler comes to
  // meet the dog and puts the line down.
  const back = 8, takes = back / SPEED.trail * 1000;
  const walk = clamp((t - 1200) / takes, 0, 1);
  const dogX = DX - R(walk * back);
  const satAt = 1200 + takes;
  if (walk < 1) out.dog = dogTrot(t, { x: dogX, flip: true, head: 'low', tail: -8, hdx: 0 });
  else if (t < satAt + 268) out.dog = sitDown(t - satAt, { x: dogX, y: dogY, flip: true });
  else {
    const w = wagAt(t, 133);
    out.dog = { x: dogX, y: dogY, body: 'sit', flip: true, head: 'fwd', tail: w[0] * 10, tailTip: w[1] * 12, ear: [0, 0], blink: (t % 2900) < 100 };
  }
  const come = clamp((t - 1200) / (12 / SPEED.trail * 1000), 0, 1);
  const hx = HX + R(come * 12);
  if (come < 1) out.handler = Object.assign(handlerWalk(t, { lean: 0, armN: 'low' }), { x: hx });
  else if (t < satAt + 268) out.handler = { x: hx, o: handlerIdle(t), hold: 'n' };
  else {
    // The pat, six frames of 100 ms: bend, the hand to the dog, two strokes, back.
    const P = step(t - satAt - 268, 100) % 12;
    const bend = P === 0 || P === 11 ? 2 : 5;
    out.handler = { x: hx, hold: 'ground', armOnTop: true, pat: P === 0 || P === 11 ? -3 : [0, 1, 2, 1, 0, 1, 2, 1, 0, 0][P - 1],
      o: { crouch: bend, lean: bend * 0.6, armN: 'pat', armF: 'low', blink: P > 6 } };
    const T = (t - satAt - 500) % 1600;
    if (t > satAt + 500 && T < 1100) out.fx.push({ kind: 'heart', t: T });
  }
  out.line = 60;
  return out;
}

/* Lying down, once, five frames of 83 ms: the front goes down first, then
   the hips roll over. */
const LIE = [{ k: 0.2, bob: 1 }, { k: 0.45, rump: -2 }, { k: 0.75, rump: -1 }, { k: 1, bob: 1 }, { k: 1 }];

export function frameResting(t) {
  const T = t % 4800;
  const drink = T >= 2400 && T < 3600;
  const w = wagAt(t, 133);
  let dog;
  if (t < 415) {
    const s = LIE[step(t, 83)];
    dog = { body: 'stand', to: 'lie', k: s.k, bob: s.bob || 0, rump: s.rump || 0, head: 'fwd', headTo: 'low', hk: s.k };
  } else if (drink) {
    const lap = step(T, 167) % 2;
    dog = { body: 'lie', head: 'down', drink: lap, tongue: lap === 0, mouth: true, ear: [0, lap ? 0.5 : 0], tail: 0 };
  } else if (T >= 3600 && T < 4000) {
    // Up from the bowl, the ears a frame behind, a lick of the lips.
    const k = T < 3733 ? 0.5 : 1;
    dog = { body: 'lie', head: 'down', headTo: 'fwd', hk: k, tongue: k < 1, ear: [0, k < 1 ? 1.5 : -1] };
  } else {
    // Panting: the chest a pixel, the tongue in and out; the tail thumps now and then.
    const p = step(T, 250) % 4;
    const thump = T > 1200 && T < 2000;
    dog = { body: 'lie', head: 'fwd', mouth: true, tongue: p < 2, bob: p === 1 ? -1 : 0, hdy: p === 1 ? 1 : 0, tail: thump ? w[0] * 9 : 0, tailTip: thump ? w[1] * 12 : 0, blink: T > 700 && T < 800 };
  }
  return {
    handler: { x: HX + 2, o: { sit: true, armN: 'knee', armF: 'knee', bob: step(t, 1000) % 2, blink: (t % 3200) < 100 }, hold: 'n', rucksack: true },
    dog: Object.assign({ x: DX - 2, y: dogY }, dog),
    bowl: true, line: 62,
    fx: [],
  };
}

export function frameNight(t) {
  const f = frameTrailing(t);
  f.torch = true;
  return f;
}

/** The props at the find leave quietly: the person ducks, the bush dithers away. */
export function hideProps(f, T) {
  if (!f.person) return f;
  f.person.rise = [6, 11, 18, 40][clamp(step(T, 60), 0, 3)];
  f.bushFade = clamp((T - 150) / 300, 0, 1);
  if (f.bushFade >= 1) { f.person = null; f.bush = false; }
  return f;
}
