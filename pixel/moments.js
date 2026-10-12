/* The one-shot moments: the level-up, the boss and the summit, with the
   cues the board and the page hang their own effects on. Each is a pure
   function of its clock, like the states, so a skip is just its last frame.

   `env` is what the board knows and the team does not: `stride` scales the
   run's steps to the ground the team really covers between two stones, so
   the feet land where the board moves them and do not slide. */

import { clamp } from './core.js';
import { dogTrot, dogY, DX, frameFind, frameWaiting, handlerIdle, handlerPump, handlerWalk, hideProps, HX, REACH, sitDown, SPEED, step, wagAt } from './states.js';

export const MOMENTS = {
  /* A level passed. tick: the stone is ticked; paw: the stamp lands (the
     flash, the ring of sparks); cheer: the handler's fist; name: the new
     name pops; trot: the team sets off, the trail lighting ahead of it;
     arrive: on the next stone, the confetti; buzz: the phone's tap; hide:
     the person ducks away; then the hold. */
  levelup: { duration: 4900, cues: { tick: 150, paw: 650, cheer: 800, name: 1150, trot: 1500, arrive: 3000, buzz: 3080, hide: 4200 } },
  /* A boss beaten. arrive: at the gate; toss: the toy is thrown; sweep: the
     land beyond lights up; gate: it opens; aside: the person steps away;
     through: the team goes through; title: the title card; buzz. */
  boss: { duration: 8800, cues: { arrive: 1700, toss: 2700, sweep: 3100, gate: 4400, aside: 5000, through: 5300, title: 7100, buzz: 7180 } },
  /* The last stone. As a level passed up to the arrival, then its own
     finale: flag: the flag goes up gold; flare: the aurora flares and the
     stars fall; title: Master Trailer; buzz. It lasts as long as a boss,
     which is what the page allows for it. */
  summit: { duration: 8800, cues: { tick: 150, paw: 650, cheer: 800, name: 1150, trot: 1700, arrive: 3700, flag: 4100, flare: 4700, title: 6400, buzz: 6480 } },
};

/** The frame shown when motion is off. */
export const STILL_AT = { waiting: 300, trailing: 160, lost: 1800, find: 3000, missed: 3200, resting: 900, night: 160, levelup: 4900, boss: 8800, summit: 8800 };

/* The gate, in the boss: its shut-to-open steps, with an overshoot. */
const GATE_STEPS = [0, 0.45, 1.12, 1.12, 0.94, 1];

const strideOf = (env, second) => (second && env && env.stride2) || (env && env.stride) || 1;

/* The run between two stones: one frame of gathering the other way, the
   run itself with shorter steps as it pulls up, the tail up and going. */
function running(t, from, to, env, extra, second) {
  const k = strideOf(env, second);
  const brake = t > to - 134 ? 0.5 : 1;
  if (t < from) {
    return {
      handler: { x: HX, o: { armN: 'line', crouch: 1, lean: -1 }, hold: 'n' },
      dog: Object.assign({ x: DX, y: dogY, body: 'stand', head: 'fwd', jx: -1, bob: 1, tail: 20, ear: [1, 0] }, extra || {}),
      line: 48, fx: [],
    };
  }
  const w = wagAt(t, 67);
  return {
    handler: handlerWalk(t, null, { run: true }),
    dog: dogTrot(t, Object.assign({ head: 'fwd', na: 14, pitch: 6, tail: 24 + w[0] * 12, tailTip: w[1] * 16, mouth: true, tongue: step(t, 200) % 2 === 0 }, extra || {}), { fast: true, stride: k * brake }),
    line: 44, wave: step(t, 50) % 4 < 3 ? (step(t, 50) % 4 + 0.5) / 3 : null,
    fx: [{ kind: 'dust' }], moving: true, speed: SPEED.run * k,
  };
}

/* Before the run: the stone is stamped under the team. The dog's head comes
   up from the scent, ears a frame late; the handler's fist goes up. */
function stamped(t, c) {
  if (t < c.paw) return frameWaiting(t);
  const T = t - c.paw;
  const w = wagAt(t, 67);
  const k = T < 67 ? 0.5 : 1;
  const dog = { x: DX, y: dogY, body: 'stand', head: 'down', headTo: 'fwd', hk: k, ear: [0, T < 67 ? 1.5 : T < 134 ? -1.5 : 0],
    mouth: T > 200, tongue: T > 200 && step(T, 250) % 2 === 0, tail: 14 + w[0] * 14, tailTip: w[1] * 18, bob: T < 67 ? 1 : 0 };
  const handler = (t >= c.cheer && handlerPump(t - c.cheer)) || { x: HX, o: handlerIdle(t, { armN: 'low' }), hold: 'n' };
  const out = { handler, dog, line: 54, fx: [] };
  if (handler.spark) out.fx.push({ kind: 'fist' });
  return out;
}

export function frameLevelUp(t, env) {
  const c = MOMENTS.levelup.cues;
  if (t < c.trot - 67) return stamped(t, c);
  if (t < c.arrive) return running(t, c.trot, c.arrive, env);
  // The find on the new stone: the person up from the bush, the dog sat and
  // telling, the fist; then the person ducks away and the two of them hold.
  const f = frameFind(t - c.arrive, 650, { pop: 650 });
  if (t >= c.hide) {
    hideProps(f, t - c.hide);
    const T = t - c.hide, w = wagAt(t, 100);
    f.dog = { x: DX + 2, y: dogY, body: 'sit', head: 'fwd', headTo: 'back', hk: T < 67 ? 0.4 : T < 134 ? 0.8 : 1, ear: [T < 200 ? -1.5 : 0, 0], tail: w[0] * 12, tailTip: w[1] * 14, mouth: true, tongue: true };
    f.handler = { x: HX, o: handlerIdle(t, { armN: 'low', armF: 'feed' }), hold: 'f' };
    f.fx = [];
  }
  return f;
}

/* The boss, team side: the run in, the find at the gate, the toy thrown and
   caught, the wait while the land beyond lights and the gate swings, then
   through it with the toy and on to the next stone. */
export function frameBoss(t, env) {
  const c = MOMENTS.boss.cues;
  if (t < c.arrive) return running(t, 0, c.arrive, env);
  if (t < c.through) {
    const f = frameFind(t - c.arrive, 650, { pop: 650 });
    f.person.x = REACH.gate + 12;
    if (t >= c.toss) {
      // The person throws the toy; the dog catches it and tugs.
      const T = t - c.toss;
      f.person.toy = false;
      f.fx = f.fx.filter(e => e.kind === 'sparkle' && T < 400);
      if (T < 240) f.fx.push({ kind: 'toss', u: T / 240 });
      else {
        const n = step(T, 133), tug = n % 2, w = wagAt(t, 67);
        f.dog = { x: DX + 2, y: dogY, body: 'sit', head: 'fwd', hdx: tug ? 1 : -0.5, pitch: tug ? -8 : 6, toy: true, tail: w[0] * 16, tailTip: w[1] * 18, ear: [tug ? -1.5 : 1, tug ? -1 : 0] };
        f.handler = (T < 900 && handlerPump(T - 300)) || { x: HX, o: handlerIdle(t, { armN: 'hip', armF: 'feed' }), hold: 'f' };
        if (f.handler.spark) f.fx.push({ kind: 'fist' });
        // The dog is up and facing the gate a moment before it goes through.
        if (t > c.through - 268) {
          const g = clamp(step(268 - (c.through - t), 67), 0, 3);
          f.dog = { x: DX + 2, y: dogY, body: 'stand', to: 'sit', k: [1, 0.55, 0.2, 0][g], bob: g === 3 ? -1 : 0, head: 'fwd', toy: true, tail: 20, ear: [0, g < 2 ? 1 : -1] };
        }
      }
    }
    if (t >= c.aside) hideProps(f, t - c.aside);
    return f;
  }
  if (t < c.title) return running(t, c.through, c.title, env, { toy: true, mouth: false, tongue: false }, true);
  // Through: the dog sits with its prize and looks round; one more fist.
  const T = t - c.title, w = wagAt(t, 100);
  const sat = T >= 268;
  const dog = sat
    ? { x: DX, y: dogY, body: 'sit', head: 'fwd', headTo: 'back', hk: T < 400 ? 0 : T < 467 ? 0.5 : 1, toy: true, tail: w[0] * 14, tailTip: w[1] * 16, ear: [T > 400 && T < 600 ? -1.5 : 0, 0] }
    : Object.assign(sitDown(T, { x: DX, y: dogY }), { toy: true });
  const handler = handlerPump(T - 200) || { x: HX, o: handlerIdle(t, { armN: 'low' }), hold: 'n' };
  const fx = handler.spark ? [{ kind: 'fist' }] : [];
  return { handler, dog, line: 56, fx };
}

/* The summit: the last stone stamped, the climb to the cairn, then the two
   of them under the sky: the dog sits and sings at it, the handler's fist
   stays up, and they turn to look at each other for the hold. */
export function frameSummit(t, env) {
  const c = MOMENTS.summit.cues;
  if (t < c.trot - 67) return stamped(t, c);
  if (t < c.arrive) return running(t, c.trot, c.arrive, env);
  const T = t - c.arrive, w = wagAt(t, 100);
  let dog;
  if (T < 268) dog = sitDown(T, { x: DX, y: dogY });
  else if (t < c.title) {
    // Head back, muzzle to the sky, in three long calls.
    const call = step(T - 268, 400) % 3 < 2;
    dog = { x: DX, y: dogY, body: 'sit', head: 'up', pitch: call ? -14 : 0, na: call ? -6 : 0, mouth: call, ear: [call ? -1.5 : 0, call ? 1 : 0], tail: w[0] * 14, tailTip: w[1] * 16 };
  } else {
    const a = t - c.title;
    dog = { x: DX, y: dogY, body: 'sit', head: 'up', headTo: 'back', hk: a < 67 ? 0.4 : a < 134 ? 0.8 : 1, ear: [a < 300 ? -1.5 : 0, 0], tail: w[0] * 14, tailTip: w[1] * 16, mouth: true, tongue: true };
  }
  let handler;
  const up = t - c.flag;
  if (up < 0) handler = { x: HX, o: handlerIdle(t, { armN: 'low' }), hold: 'n' };
  else if (up < 268) handler = handlerPump(up);
  else if (t < c.title + 600) handler = { x: HX, hold: 'f', hatLift: step(up, 400) % 2, o: { armN: 'fist', pump: 1, armF: 'feed', bob: step(up, 400) % 2 ? -1 : 0, mouth: true } };
  else handler = { x: HX, o: handlerIdle(t, { armN: 'hip', armF: 'feed' }), hold: 'f' };
  const fx = [];
  if (handler.spark || (up > 268 && up < 400)) fx.push({ kind: 'fist' });
  return { handler, dog, line: 56, fx };
}

/** How open the gate is at boss time t. */
export function gateOpen(t) {
  const T = t - MOMENTS.boss.cues.gate;
  return T < 0 ? 0 : GATE_STEPS[clamp(step(T, 133), 0, GATE_STEPS.length - 1)];
}
