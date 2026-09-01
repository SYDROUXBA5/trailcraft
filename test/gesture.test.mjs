/* The sheet gesture's physics, checked headlessly. The pointer wiring lives in
   the DOM and cannot be tested here — but every decision it makes (how far a
   flick coasts, which snap point wins, whether the spring overshoots) is pure
   maths, and this is where that maths gets held to account. */

import assert from 'node:assert/strict';
import { project, rubberband, velocityFrom, chooseTarget, Spring } from '../public/gesture.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log(`  ok  ${name}`); };
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

/* ── projection ───────────────────────────────────────────────────── */

t('project: Apple decay — 1000 px/s coasts ~499 px, sign follows velocity', () => {
  near(project(1000), 499, 1, 'magnitude');
  near(project(-1000), -499, 1, 'negative');
  assert.equal(project(0), 0, 'no velocity, no coast');
  assert.ok(project(400, 0.99) < project(400, 0.998), 'snappier rate coasts shorter');
});

/* ── rubberband ───────────────────────────────────────────────────── */

t('rubberband: progressive and bounded, never a hard wall', () => {
  const dim = 400;
  const r50 = rubberband(50, dim), r200 = rubberband(200, dim), r800 = rubberband(800, dim);
  assert.ok(r50 < 50, 'follows less than the finger');
  assert.ok(r200 > r50, 'still monotonic');
  assert.ok(r200 - r50 < (r50 / 50) * 150, 'but flattening — resistance grows');
  assert.ok(r800 < dim * 0.55, 'asymptotically capped');
  assert.ok(rubberband(-200, dim) < 0, 'works in both directions');
  assert.equal(rubberband(100, 0), 0, 'zero dimension cannot divide');
});

/* ── velocity ─────────────────────────────────────────────────────── */

t('velocityFrom: reads the recent window, not the final jitter', () => {
  // A genuine downward flick: 300 px over 100 ms…
  const flick = [];
  for (let i = 0; i <= 10; i++) flick.push({ t: i * 10, y: i * 30 });
  // …then the finger pauses 20 ms before lifting, as fingers do.
  flick.push({ t: 120, y: 300 });
  const v = velocityFrom(flick);
  assert.ok(v > 2000, `a real flick must survive the lift pause, got ${v}`);

  assert.equal(velocityFrom([{ t: 0, y: 0 }]), 0, 'one sample is stillness');
  assert.equal(velocityFrom([]), 0, 'no samples is stillness');
  assert.equal(velocityFrom([{ t: 5, y: 0 }, { t: 5, y: 9 }]), 0, 'same-instant samples cannot divide');
});

/* ── the release decision ─────────────────────────────────────────── */

t('chooseTarget: position decides slow releases, velocity decides flicks', () => {
  const points = [0, 400];                                   // open, closed
  assert.equal(chooseTarget(380, 0, points), 400, 'released low and still — stays closed');
  assert.equal(chooseTarget(60, 0, points), 0, 'released high and still — stays open');
  // The Apple moment: barely moved, but flicked hard.
  assert.equal(chooseTarget(380, -1200, points), 0, 'upward flick from the bottom commits open');
  assert.equal(chooseTarget(80, 900, points), 400, 'downward flick from the top commits closed');
});

/* ── the spring ───────────────────────────────────────────────────── */

const settle = (s, maxSteps = 600) => {
  const path = [s.x];
  for (let i = 0; i < maxSteps && !s.done; i++) { s.step(1 / 60); path.push(s.x); }
  return path;
};

t('Spring: critically damped settles with no overshoot', () => {
  const s = new Spring({ dampingRatio: 1, response: 0.35 });
  s.x = 400; s.target = 0;
  const path = settle(s);
  assert.ok(s.done, 'settles');
  assert.ok(Math.min(...path) > -0.5, `never crosses the target, min ${Math.min(...path).toFixed(2)}`);
});

t('Spring: drawer tuning (0.8) overshoots slightly on a flick, then settles', () => {
  const s = new Spring({ dampingRatio: 0.8, response: 0.3 });
  s.x = 300; s.v = -1500; s.target = 0;                      // flicked toward open
  const path = settle(s);
  assert.ok(s.done, 'settles');
  const over = -Math.min(...path);
  assert.ok(over > 0.5, 'a flick earns a visible touch of bounce');
  assert.ok(over < 60, `but a touch, not a boing — got ${over.toFixed(1)}px`);
});

t('Spring: velocity handoff means no seam at release', () => {
  /* The spring is stiff, so it moves from rest too — the honest claim is not
     "first frame equals finger speed" but that the handed-off velocity
     CONTRIBUTES: released moving, the sheet travels further in the first frame
     than released still, and never moves backwards against the finger. */
  const moving = new Spring({ dampingRatio: 1, response: 0.35 });
  moving.x = 100; moving.v = 800; moving.target = 400;
  const still = new Spring({ dampingRatio: 1, response: 0.35 });
  still.x = 100; still.v = 0; still.target = 400;

  moving.step(1 / 60); still.step(1 / 60);
  assert.ok(moving.x > still.x, 'finger velocity carries into the animation');
  assert.ok(moving.x > 100, 'and continues the finger’s direction, never reversing first');
  near(moving.x - still.x, 800 / 60, 5, 'by roughly the finger’s own contribution');
});

t('Spring: interruption is a retarget, never a jump', () => {
  const s = new Spring({ dampingRatio: 1, response: 0.35 });
  s.x = 400; s.target = 0;
  for (let i = 0; i < 8; i++) s.step(1 / 60);                // mid-flight…
  const grabbed = s.x;
  s.target = 400;                                            // …user changes their mind
  s.step(1 / 60);
  assert.ok(Math.abs(s.x - grabbed) < 30, 'position is continuous through the reversal');
  const path = settle(s);
  assert.ok(s.done && Math.abs(s.x - 400) < 1, 'and it settles at the new target');
});

t('Spring: a huge dt is clamped, not exploded', () => {
  const s = new Spring({ dampingRatio: 1, response: 0.3 });
  s.x = 400; s.target = 0;
  s.step(2.5);                                               // tab was backgrounded
  assert.ok(Number.isFinite(s.x) && Math.abs(s.x) < 1000, 'integrator stays sane');
});

console.log(`\n${pass} passed total`);
