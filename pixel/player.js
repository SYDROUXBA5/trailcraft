/* The player: one canvas, 30 fps at most, running only while it is on
   screen and the page is visible. */

import { bayer, clamp, ctx2d, makeCanvas, R } from './core.js';
import { REACH, SPEED, TEAM } from './states.js';
import { gateOpen, MOMENTS, STILL_AT } from './moments.js';
import { LANDS } from './lands.js';
import { CLOSE, drawGate, foreground, heartTree, landscape } from './close.js';
import { drawTeam, frame } from './team.js';
import { burst, confetti, gather, moonbeam, STAGE_GLOW } from './fx.js';

/**
 * createTeam(canvas, opts) draws the team into `canvas`.
 * opts: { scene: 'team' | 'close', scale (CSS px per art px), state, look:{coat, jacket, hat, stage, land},
 *         motion (false = still poses), flip, env:{stride} (what a moment's run is told by whoever
 *         moves the team), onFrame(t), onEnd() }
 * The loop runs only while the canvas is on screen and the page is visible.
 */
export function createTeam(canvas, opts = {}) {
  const o = Object.assign({ scene: 'team', scale: 2, state: 'waiting', look: {}, motion: true, flip: false, env: null }, opts);
  let W = 0, H = 0, buf = null, bctx = null, out = null;
  let raf = 0, last = 0, startAt = 0, pausedAt = null, frozen = null, onScreen = true, ended = false;
  let dead = false;               // destroyed: nothing asks for another frame
  let mixA = null, mixB = null;

  function size() {
    W = o.scene === 'close' ? CLOSE.w : TEAM.w;
    H = o.scene === 'close' ? CLOSE.h : TEAM.h;
    buf = makeCanvas(W, H); bctx = ctx2d(buf);
    const dpr = Math.max(1, Math.round(window.devicePixelRatio || 1));
    canvas.width = W * o.scale * dpr; canvas.height = H * o.scale * dpr;
    canvas.style.width = W * o.scale + 'px'; canvas.style.height = H * o.scale + 'px';
    out = ctx2d(canvas);
  }

  function draw(t) {
    const c = bctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, W, H);
    const state = o.state;
    const F = frame(state, t, o.env);
    const look = Object.assign({}, o.look);
    if (o.scene === 'close') {
      drawClose(c, F, t, look, state);
    } else {
      if (o.flip) c.setTransform(-1, 0, 0, 1, W, 0);
      drawTeam(c, F, t, look, 0, 0, W, H);
      c.setTransform(1, 0, 0, 1, 0, 0);
    }
    out.setTransform(1, 0, 0, 1, 0, 0);
    out.imageSmoothingEnabled = false;
    out.clearRect(0, 0, canvas.width, canvas.height);
    out.drawImage(buf, 0, 0, canvas.width, canvas.height);
  }

  /* How far the ground has passed under the team by time t: a moment's
     runs, or a state that walks for as long as it lasts. */
  function passed(state, F, t) {
    const k = (o.env && o.env.stride) || 1;
    const run = (a, b) => SPEED.run * k * clamp(t - a, 0, b - a) / 1000;
    const m = MOMENTS[state] && MOMENTS[state].cues;
    if (state === 'boss') return run(0, m.arrive) + run(m.through, m.title);
    if (m) return run(m.trot, m.arrive);
    return F.moving ? (F.speed || SPEED.trail) * t / 1000 : 0;
  }

  /* The land the close-up shows: the one the board says the team stands in,
     or, for a caller that only knows the stage, that stage's first land. */
  const kindOf = (look) => (LANDS[look.land] ? look.land : look.stage === 'cold' ? 'old' : look.stage === 'warm' ? 'forest' : 'field');
  /* What lies beyond each land's gate, and which gate it is: the field
     gate into the wood (level 15), the footbridge (45), the hamlet's
     gateway (75). The open field has no gate of its own: its boss is the
     wood's edge's. */
  const NEXT_KIND = { field: 'forest', edge: 'forest', forest: 'old', old: 'ancient', ancient: 'ancient' };
  const GATE_KIND = { field: 'stile', edge: 'stile', forest: 'bridge', old: 'hamlet', ancient: 'hamlet' };

  function drawClose(c, F, t, look, state) {
    const ox = 6, oy = CLOSE.ground - TEAM.ground;
    const kind = kindOf(look);
    const night = state === 'night';
    const scroll = passed(state, F, t);
    // Nothing drifts or flickers in a still picture, unless the clock is
    // held on purpose (a screenshot of one instant).
    const live = o.motion || frozen != null ? t : null;
    const teamLook = Object.assign(look, { stage: night ? 'cold' : look.stage, land: kind });
    if (state === 'boss') {
      const cu = MOMENTS.boss.cues, next = NEXT_KIND[kind], gk = GATE_KIND[kind];
      const p = clamp((t - cu.sweep) / 1300, 0, 1);
      if (p <= 0) landscape(c, W, H, kind, scroll, live);
      else if (p >= 1) landscape(c, W, H, next, scroll, live);
      else sweep(c, kind, next, scroll, live, p);
      // The gate stands just ahead of the dog when the team arrives; the
      // person waits on the far side, then ducks behind the bush, which stays.
      const gate = R(ox + REACH.gate + passed(state, F, cu.arrive) - scroll);
      if (F.person) F.person.x = gate + 12 - ox;
      const open = gateOpen(t);
      /* Beyond the gate the team stands in the next land's light: its rim
         and its shadow change as it goes through. */
      if (t >= cu.through) teamLook.land = next;
      if (t >= cu.through) {
        // Through the open gate: it is behind the team now.
        drawGate(c, gk, gate, open, 'all');
        drawTeam(c, F, t, teamLook, ox, oy, W, H);
      } else {
        drawGate(c, gk, gate, open, 'back');
        drawTeam(c, F, t, teamLook, ox, oy, W, H);
        drawGate(c, gk, gate, open, 'front');
      }
      foreground(c, p >= 0.5 ? next : kind, scroll, live);
      if (t >= cu.title) confetti(c, W / 2, 30, t - cu.title, { n: 28, gold: true, spread: 70, seed: 3 });
      return;
    }
    if (state === 'heart') {
      /* The finale is the ancient wood's whoever asks for it: the great
         tree comes into the picture as the team runs up, and stands behind
         the two of them. It moves with the ground it stands on. */
      const cu = MOMENTS.heart.cues, lit = t >= cu.moon;
      const tx = R(ox + 70 + (passed(state, F, cu.arrive) - scroll) * 0.76);
      teamLook.land = 'ancient';
      landscape(c, W, H, 'ancient', scroll, live, false, true);
      heartTree(c, tx, lit);
      if (lit && live != null) moonbeam(c, tx + 6, CLOSE.ground + 2, 0, t - cu.moon, 30);
      drawTeam(c, F, t, teamLook, ox, oy, W, H);
      foreground(c, 'ancient', scroll, live);
      burst(c, ox + 16, CLOSE.ground + 1, t - cu.paw, STAGE_GLOW.cold);
      if (live != null) gather(c, tx, CLOSE.ground - 22, t - cu.moon, 16, 80, 34);
      if (t >= cu.title) confetti(c, W / 2, 26, t - cu.title, { n: 36, gold: true, spread: 76, seed: 5 });
      return;
    }
    landscape(c, W, H, kind, scroll, live, night);
    drawTeam(c, F, t, teamLook, ox, oy, W, H);
    foreground(c, kind, scroll, live, night);
    if (state === 'levelup') {
      const cu = MOMENTS.levelup.cues;
      burst(c, ox + 16, CLOSE.ground + 1, t - cu.paw, STAGE_GLOW[look.stage] || STAGE_GLOW.hot);
      if (t >= cu.arrive) confetti(c, ox + 60, CLOSE.ground - 44, t - cu.arrive, { n: 16, stage: look.stage, spread: 46, seed: 1 });
    }
  }

  /* One land gives way to the next as a front climbing from the ground to
     the sky: below it the new stage, a narrow dithered band at the front,
     above it the old one. */
  function sweep(c, from, to, scroll, live, p) {
    if (!mixA) { mixA = makeCanvas(W, H); mixB = makeCanvas(W, H); }
    const a = ctx2d(mixA), b = ctx2d(mixB);
    landscape(a, W, H, from, scroll, live);
    landscape(b, W, H, to, scroll, live);
    const A = a.getImageData(0, 0, W, H), B = b.getImageData(0, 0, W, H);
    const band = 4, front = H + band - p * (H + band * 2);
    for (let y = 0; y < H; y++) {
      const k = (y - (front - band)) / (band * 2);
      if (k <= 0) continue;
      for (let x = 0; x < W; x++) {
        if (k >= 1 || bayer(x, y) < k) {
          const i = (y * W + x) * 4;
          A.data[i] = B.data[i]; A.data[i + 1] = B.data[i + 1]; A.data[i + 2] = B.data[i + 2];
        }
      }
    }
    c.putImageData(A, 0, 0);
  }

  function now() { return (typeof performance !== 'undefined' ? performance.now() : Date.now()); }
  function time() {
    if (frozen != null) return frozen;
    if (!o.motion) return STILL_AT[o.state] || 0;
    if (pausedAt != null) return pausedAt;
    return now() - startAt;
  }

  function tick() {
    raf = 0;
    if (!running()) return;
    const n = now();
    // At most 30 fps: every second frame at 60 Hz, every fourth at 120 Hz.
    // The gate sits below one tick, so a frame that lands a little early
    // under timer jitter is not pushed back to a third vsync.
    if (n - last >= 28) {
      last = n;
      let t = time();
      const m = MOMENTS[o.state];
      if (m && t >= m.duration) { t = m.duration; if (!ended) { ended = true; draw(t); if (o.onFrame) o.onFrame(t); if (o.onEnd) o.onEnd(); } }
      if (!ended) { draw(t); if (o.onFrame) o.onFrame(t); }
    }
    /* Only when nothing is waiting already. onFrame and onEnd above can call
       set() (the board turns the team round, and puts it back to waiting
       when a moment ends), and set() asks for a frame of its own: asking
       again here started a second loop beside it, whose handle was lost.
       destroy() could then stop only one, and the other went on redrawing
       a canvas that was no longer on the page for as long as the app ran. */
    if (!raf && running()) raf = requestAnimationFrame(tick);
  }
  const running = () => !dead && o.motion && frozen == null && onScreen && !document.hidden && !ended;
  function kick() { if (!raf && running()) raf = requestAnimationFrame(tick); }
  function pause() { if (pausedAt == null) pausedAt = now() - startAt; }
  function resume() { if (pausedAt != null) { startAt = now() - pausedAt; pausedAt = null; } }

  const onVis = () => { if (document.hidden) pause(); else { resume(); kick(); } };
  document.addEventListener('visibilitychange', onVis);
  let io = null;
  if (typeof IntersectionObserver !== 'undefined') {
    io = new IntersectionObserver((es) => {
      onScreen = es[es.length - 1].isIntersecting;
      if (onScreen) { resume(); kick(); } else pause();
    });
    /* `watch` is what has to be in view for the clock to run, when that is
       not the sprite itself: a moment played on a board that scrolls must
       not stop because the team is, for a frame, off the edge of it. */
    io.observe(o.watch || canvas);
  }

  size();
  startAt = now();

  const api = {
    /** Change look, state, flip or motion. A new state starts its clock again. */
    set(patch) {
      const restart = patch.state && (patch.state !== o.state || MOMENTS[patch.state]);
      if (patch.look) patch = Object.assign({}, patch, { look: Object.assign({}, o.look, patch.look) });
      Object.assign(o, patch);
      if (patch.scene || patch.scale) size();
      if (restart) { startAt = now(); pausedAt = null; ended = false; }
      if (patch.motion === false) { ended = false; }
      draw(time());
      if (o.onFrame && (frozen != null || !o.motion)) o.onFrame(time());
      kick();
      return api;
    },
    play(state, extra) { return api.set(Object.assign({ state }, extra || {})); },
    /** Hold the clock at t ms (screenshots, tests), or let it run again with null. */
    freeze(t) { frozen = t; draw(time()); if (o.onFrame) o.onFrame(time()); kick(); return api; },
    renderAt(t) { draw(t); return api; },
    skip() { const m = MOMENTS[o.state]; if (m) { startAt = now() - m.duration; pausedAt = null; } kick(); return api; },
    get time() { return time(); },
    get size() { return { w: W, h: H, scale: o.scale }; },
    destroy() {
      dead = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      document.removeEventListener('visibilitychange', onVis);
      if (io) io.disconnect();
    },
  };
  draw(time());
  kick();
  return api;
}
