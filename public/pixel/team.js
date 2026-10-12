/* The team put together: handler, line and dog drawn from a frame, with
   their shadows, props and effects (scent, sparks, the torch beam). */

import { bake, blit, ctx2d, ditherOut, hash, hexToRgb, makeCanvas, R } from './core.js';
import { CAST, RAMPS } from './ramps.js';
import { ball, colours, contour, develop, dot, sheet, tint } from './paint.js';
import { coatById, DOG_BOX, dogHeadTop, dogLineIn, dogNose, dogRing, dogSpan, dogToScene, drawDog } from './dog.js';
import { drawHuman, handOf, humanPose, lampOf, RUNAWAY } from './human.js';
import { PROP_PALS, PROPS } from './props.js';
import { drawLine, paintRope } from './rope.js';
import { DX, frameFind, frameLost, frameMissed, frameNight, frameResting, frameTrailing, frameWaiting, humY, LINE_LEN, step, TEAM } from './states.js';
import { frameBoss, frameLevelUp, frameSummit } from './moments.js';

/* Scent has its own colours: nothing in the scenery uses them. */
const SCENT = ['#bff4ff', '#ffffff'];

export function frame(state, t, env) {
  switch (state) {
    case 'trailing': return frameTrailing(t);
    case 'lost': return frameLost(t);
    case 'find': return frameFind(t);
    case 'missed': return frameMissed(t);
    case 'resting': return frameResting(t);
    case 'night': return frameNight(t);
    case 'levelup': return frameLevelUp(t, env);
    case 'boss': return frameBoss(t, env);
    case 'summit': return frameSummit(t, env);
    default: return frameWaiting(t);
  }
}

/* The team is drawn on its own layer first, so night can darken it alone. */
let layer = null;

function teamLayer(W, H) {
  if (!layer || layer.width < W || layer.height < H) layer = makeCanvas(W, H);
  const x = ctx2d(layer);
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.globalCompositeOperation = 'source-over';
  x.clearRect(0, 0, layer.width, layer.height);
  return x;
}

/* Where the person at the find stands, from the dog's box: just past the
   nose of a dog sat at the find. */
const PERSON_AT = 52;

const LAND_OF = { hot: 'meadow', warm: 'wood', cold: 'town' };
const landOf = (look) => look.land || LAND_OF[look.stage] || 'meadow';

/* A cast shadow: a flat ellipse of the land's own shadow colour, a pixel
   right of centre (the light is upper left), its two ends broken up. */
function castShadow(c, cx, gy, w, land) {
  const [hex, a] = CAST[land] || CAST.meadow;
  const [r, g, b] = hexToRgb(hex);
  c.fillStyle = `rgba(${r},${g},${b},${a})`;
  const x0 = R(cx - w / 2) + 1;
  c.fillRect(x0 + 2, gy, w - 4, 1);
  c.fillRect(x0, gy + 1, w, 1);
  c.fillRect(x0 + 3, gy + 2, w - 6, 1);
  c.fillRect(x0 - 1, gy + 1, 1, 1); c.fillRect(x0 + w + 1, gy + 1, 1, 1);
  c.fillRect(x0 + 1, gy + 2, 1, 1); c.fillRect(x0 + w - 3, gy + 2, 1, 1);
}

/* The bush the person hides behind, 24 × 18, in the land's own leaves. It
   is painted once for each land and kept. */
const bushes = new Map();
const BUSH = { w: 24, h: 18 };

function bushArt(land) {
  let cv = bushes.get(land);
  if (cv) return cv;
  const L = RAMPS[land] || RAMPS.meadow;
  const leaf = land === 'wood' ? L.russet : land === 'climb' ? L.pine : land === 'town' ? L.foliage : L.hedge;
  const berry = land === 'wood' ? L.amber : land === 'climb' ? L.snow : land === 'town' ? L.lamp : L.poppy;
  const B = sheet(BUSH.w + 4, BUSH.h + 4);
  for (const [x, y, rx, ry] of [[8, 13, 6.5, 6], [20, 14, 6, 5.5], [14, 10, 7.5, 8], [14, 16, 11, 4]]) ball(B, x, y, rx, ry, { m: 1, lit: [-0.35, 0.5] });
  // Leaves: small clumps of light on the sunny side and shade underneath,
  // never single pixels.
  for (let i = 0; i < 14; i++) {
    const x = 4 + R(hash(i * 7 + 1) * 20), y = 5 + R(hash(i * 13 + 5) * 12), up = y < 11;
    tint(B, x, y, up ? 4 : 0, 1); tint(B, x + 1, y, up ? 3 : 1, 1); tint(B, x, y + 1, up ? 3 : 1, 1);
  }
  for (const [x, y] of [[7, 11], [17, 8], [21, 15], [12, 15]]) { if (B.m[y * B.w + x]) { dot(B, x, y, 2, 2); dot(B, x + 1, y, 2, 3); } }
  if (land === 'climb') for (let x = 6; x < 22; x++) for (let y = 2; y < 6; y++) tint(B, x, y, 3, 1);
  contour(B);
  const img = develop(B, colours([null, leaf, berry]));
  cv = makeCanvas(B.w, B.h);
  ctx2d(cv).drawImage(img, 0, 0);
  bushes.set(land, cv);
  return cv;
}

const prop = (name) => bake(PROPS[name], PROP_PALS[name], 'prop/' + name);

/** The handler's pose for a frame, the pat's hand found on this dog. */
function poseOf(F, dog, hx, hy) {
  const o = F.handler.o || {};
  if (o.armN !== 'pat') return humanPose(o);
  const top = dogHeadTop(dog), s = F.handler.pat || 0;
  const hover = s < 0 ? s : 0, along = s > 0 ? s : 0;
  return humanPose(Object.assign({}, o, { armN: [top[0] - hx - 1 - along, top[1] - hy - 2 + hover + (along ? 1 : 0)] }));
}

/** The team at (ox, oy) in a scene, from a frame. */
export function drawTeam(c, F, t, look, ox, oy, W, H) {
  const coat = coatById(look.coat);
  const stage = look.stage || 'hot';
  const land = landOf(look);
  // On the night lands, and by torchlight anywhere, the moon rims the top of
  // both of them: a dark coat and a navy jacket are lost on navy without it.
  const rim = !!F.torch || land === 'town' || land === 'climb';
  const hLook = { jacket: look.jacket || 'navy', hat: look.hat || 'none', torch: !!F.torch, hatLift: F.handler.hatLift || 0, rim };
  const G = oy + TEAM.ground;
  const hx = ox + F.handler.x, hy = oy + humY;
  const dog = Object.assign({}, F.dog, { x: ox + F.dog.x, y: oy + F.dog.y, coat, rim });
  // Lapping: the nose dips into the bowl and comes out of it.
  if (dog.drink != null) dog.hdy = -2 + dog.drink;
  const pose = poseOf(F, dog, hx, hy);
  const L = teamLayer(W, H);

  // The person at the find, behind a bush: they come up from behind it, so
  // whatever is below the bush's shoulder is not drawn.
  const px = F.person ? ox + (F.person.x != null ? F.person.x : DX + PERSON_AT) : 0;
  if (F.person) {
    const py = oy + humY + F.person.rise;
    L.save();
    L.beginPath(); L.rect(0, 0, W, G - 5); L.clip();
    drawHuman(L, px, py, humanPose({ armN: 'wave', armF: 'low', wave: F.person.wave, mouth: true }), Object.assign({}, RUNAWAY, { flip: true, toyIn: F.person.toy ? 'n' : '' }));
    L.restore();
  }
  if (F.person && F.bush) {
    const bx = ox + (F.bushX != null ? F.bushX : (F.person.x != null ? F.person.x : DX + PERSON_AT));
    castShadow(L, bx + 13, G, 22, land);
    L.drawImage(bushArt(land), bx - 2, G - BUSH.h - 1);
    if (F.bushFade) ditherOut(L, bx - 3, G - BUSH.h - 3, BUSH.w + 6, BUSH.h + 6, F.bushFade);
  }

  // Shadows: under everything that stands on the ground.
  const span = dogSpan(dog);
  castShadow(L, hx + 12 + (pose.sit ? 4 : 0), G, pose.sit ? 20 : 14, land);
  castShadow(L, (span[0] + span[1]) / 2, G, Math.max(18, span[1] - span[0] + (dog.body === 'lie' ? 8 : 2)), land);

  // Props behind.
  if (F.handler.rucksack) { castShadow(L, hx + 3, G, 10, land); blit(L, prop('rucksack'), hx - 2, G - 9); }

  // Handler, then the line, then the dog: the rope runs behind the dog's
  // tail and its low point stays in the gap between them.
  drawHuman(L, hx, hy, pose, hLook, F.handler.armOnTop ? 'body' : 'all');
  const hand = F.handler.hold === 'ground' ? [hx + 17, G] : handOf(hx, hy, F.handler.hold === 'f' ? pose.armF[2] : pose.armN[2]);
  if (F.handler.hold !== 'ground') { hand[0] += 1; hand[1] += 1; }
  const via = dog.flip || (dog.body === 'lie' && F.handler.hold === 'ground') ? null : dogLineIn(dog);
  const rope = drawLine(L, hand, dogRing(dog), F.line || LINE_LEN, G, [hand[0] + 2, span[0] - 3], via, F.wave);
  drawDog(L, dog, coat, stage);
  // The last few pixels into the ring go over the dog, so the line clearly
  // clips on to the harness.
  paintRope(L, rope.top, rope.count - 4);
  if (F.handler.armOnTop) drawHuman(L, hx, hy, pose, hLook, 'arm');
  if (F.bowl) {
    // The bowl sits under the nose, so a lapping nose dips into it.
    const n = dogNose(Object.assign({}, dog, { head: 'down', headTo: null, hk: 0, hdy: 0 }));
    blit(L, prop('bowl'), n[0] - 4, G - 3);
  }

  const lamp = lampOf(pose), lx = hx + lamp[0], ly = hy + lamp[1];
  if (F.torch) {
    // Night: the team goes dark like the rest, except inside the torch's
    // cone, where coat, harness and line keep their colours.
    L.globalCompositeOperation = 'source-atop';
    for (let x = 0; x < W; x++) {
      const cone = coneAt(lx, ly, G, x);
      // Dark enough to be night, not so dark that a black dog is a hole;
      // and what the beam falls on is lifted, not veiled: the light is on
      // the dog, it does not pass in front of it.
      L.fillStyle = 'rgba(10,20,52,0.4)';
      if (!cone) { L.fillRect(x, 0, 1, H); continue; }
      L.fillRect(x, 0, 1, cone[0]); L.fillRect(x, cone[1] + 1, 1, H - cone[1] - 1);
      L.fillStyle = 'rgba(255,238,170,0.2)';
      L.fillRect(x, cone[0], 1, cone[1] - cone[0] + 1);
    }
    L.globalCompositeOperation = 'source-over';
    beam(c, lx, ly, G, t);
  }
  c.drawImage(layer, 0, 0);
  if (F.torch) { c.fillStyle = '#fffbe0'; c.fillRect(lx, ly, 2, 1); }

  for (const e of F.fx || []) drawFx(c, e, t, F, dog, ox, oy, G, { hx, hy, pose, px });
}

const CONE = 64;

/** The torch's cone at column px: [top, bottom] rows, or null outside it. */
function coneAt(x, y, G, px) {
  const i = px - x;
  if (i < 2 || i >= CONE) return null;
  return [y + R(i * 0.44) - R(i * 0.12), Math.min(G + 2, y + R(i * 0.44) + R(i * 0.3) + 1)];
}

/** The light itself, drawn behind the team: a soft wedge and a bright pool
    on the ground ahead, flat tints on the grid (no dither over the dog). */
function beam(c, x, y, G, t) {
  const flick = step(t, 100) % 9 === 0;
  for (let px = x + 2; px < x + CONE; px++) {
    const cone = coneAt(x, y, G, px);
    c.fillStyle = flick ? 'rgba(255,236,160,0.12)' : 'rgba(255,236,160,0.17)';
    c.fillRect(px, cone[0], 1, cone[1] - cone[0] + 1);
  }
  c.fillStyle = 'rgba(255,240,175,0.3)';
  for (let k = -2; k <= 2; k++) {
    const half = [10, 17, 21, 19, 12][k + 2];
    c.fillRect(x + 44 - half, G + k, half * 2, 1);
  }
}

function drawFx(c, e, t, F, dog, ox, oy, G, S) {
  switch (e.kind) {
    case 'scent': {
      // A short line of scent dots on the ground ahead, drifting to the nose
      // and blinking, plus a wisp rising into it.
      const nose = dogNose(dog);
      const dir = dog.flip ? -1 : 1;
      const n = e.near ? 3 : 7;
      const drift = (t / 50) % 5;
      for (let i = 0; i < n; i++) {
        const ph = (step(t, 133) + i) % 3;
        if (ph === 2) continue;
        c.fillStyle = SCENT[ph];
        c.fillRect(R(nose[0] + dir * (3 + i * 5 - drift)), G - 1 - (i % 2) * 2, ph ? 1 : 2, 1);
      }
      const w = step(t, 133) % 3;
      c.fillStyle = SCENT[1];
      c.fillRect(nose[0] + dir * (1 + w), nose[1] + 2 - w, 1, 1);
      break;
    }
    case 'dust': {
      // A puff behind the hind feet as each pair of legs pushes off.
      const f = step(t, 67) % 4;
      if (f > 1) break;
      const p = dogToScene(dog, [6, DOG_BOX.ground]);
      const dir = dog.flip ? 1 : -1;
      c.fillStyle = 'rgba(240,230,205,0.85)';
      c.fillRect(p[0] + dir * (1 + f * 2), G - 1 - f, 2, 1);
      c.fillRect(p[0] + dir * (4 + f * 2), G - 2 - f * 2, 1, 1);
      break;
    }
    case 'query': {
      if (!e.blink) break;
      const top = dogHeadTop(Object.assign({}, dog, { turn: 0, head: 'fwd' }));
      const q = bake(PROPS.query, PROP_PALS.query, 'prop/query');
      // Its own dark edge, so it reads on snow as on grass.
      c.globalAlpha = 0.55;
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) blit(c, bake(PROPS.query, { w: '#1c2240' }, 'prop/query-rim'), top[0] - 2 + dx, top[1] - 12 + dy);
      c.globalAlpha = 1;
      blit(c, q, top[0] - 2, top[1] - 12);
      break;
    }
    case 'bark': {
      const nose = dogNose(dog), dir = dog.flip ? -1 : 1;
      c.fillStyle = '#fff6d8';
      for (const [dx, dy] of [[3, -3], [4, -4], [5, -5], [4, 0], [5, 0], [6, 0], [3, 3], [4, 4]]) c.fillRect(nose[0] + dir * dx, nose[1] + dy - 1, 1, 1);
      break;
    }
    case 'sparkle': {
      const pts = [[S.px + 3, oy + 6], [S.px + 20, oy + 12], [S.px - 4, oy + 18], [S.px + 14, oy + 2]];
      pts.forEach((p, i) => {
        const T = e.t - i * 160;
        if (T < 0 || T > 520) return;
        const big = T > 120 && T < 380;
        blit(c, big ? prop('spark') : bake(PROPS.sparkS, PROP_PALS.spark, 'prop/sparkS'), p[0] - (big ? 3 : 1), p[1] - (big ? 3 : 1));
      });
      break;
    }
    case 'fist': {
      // A spark off the raised fist, on the frame it stops.
      const h = handOf(S.hx, S.hy, S.pose.armN[2]);
      blit(c, prop('spark'), h[0] - 2, h[1] - 8);
      break;
    }
    case 'toss': {
      // The toy in the air, from the person's hand to the dog's mouth.
      const from = [S.px + 4, oy + humY + 8], to = dogNose(dog);
      const x = R(from[0] + (to[0] - from[0]) * e.u), y = R(from[1] + (to[1] - from[1]) * e.u - 12 * Math.sin(Math.PI * e.u));
      const spin = step(e.u * 240, 60) % 2;
      c.fillStyle = '#5a1a20'; c.fillRect(x - 1, y - 1, spin ? 6 : 4, spin ? 4 : 6);
      for (let i = 0; i < 4; i++) { c.fillStyle = i % 2 ? '#2f6fb8' : '#d23b2e'; if (spin) c.fillRect(x + i, y, 1, 2); else c.fillRect(x, y + i, 2, 1); }
      break;
    }
    case 'drops': {
      // Spray off the back and neck, in arcs both ways.
      const sp = dogSpan(dog);
      for (let i = 0; i < 14; i++) {
        const T = e.t - (i % 4) * 90;
        if (T < 0 || T > 460) continue;
        const dir = i % 2 ? 1 : -1;
        const x0 = sp[0] + 3 + (i % 7) * ((sp[1] - sp[0] + 6) / 7);
        const x = R(x0 + dir * (1 + T / 40 * (0.6 + hash(i) * 0.7)));
        const y = R(sp[2] - 1 - T / 45 + (T * T) / 17000);
        c.fillStyle = i % 3 ? '#cfe6f5' : '#ffffff';
        c.fillRect(x, y, 1, i % 3 ? 1 : 2);
      }
      break;
    }
    case 'heart': {
      const hd = dogHeadTop(dog);
      const y = R(hd[1] - 9 - e.t / 150);
      if (e.t > 900 && step(e.t, 67) % 2) break;
      blit(c, prop('heart'), hd[0] - 3 + (step(e.t, 267) % 2), y);
      break;
    }
    default: break;
  }
}
