/* Animated wind over the trail.

   The old version drew a uniform flow, and at the time that was the honest
   rendering: every point on a trail shares one forecast vector, so there was
   nothing to sample.

   (That reasoning cited GFS at 28 km. Measured against the live API, Open-Meteo
   serves the UK from the Met Office 2 km model — for Wells the grid cell centre
   sits ~325 m away, not ~5 km. Fourteen times better than assumed, and still
   one cell over any trail, so the conclusion holds and only the number was
   wrong.)

   That is still true of the *wind data*. It is not true of the ground. The
   terrain under the trail is 10 m data, and field.js bends the coarse wind
   around it — so there is now a real field to draw, and the particles show air
   accelerating over a ridge, going slack in a hollow, and running downhill
   under an inversion.

   Particles live in screen space, but the field is geographic. Unprojecting
   every particle every frame would be thousands of calls a second, so instead a
   coarse screen grid is solved on map move and the particles sample that. */

/** Geographic bearing → screen unit vector, accounting for map rotation.
    Screen y grows downward, so north (0°) with no rotation is (0, −1). */
export function screenVector(bearingDeg, mapBearingDeg = 0) {
  const a = ((bearingDeg - mapBearingDeg) * Math.PI) / 180;
  return { x: Math.sin(a), y: -Math.cos(a) };
}

/** Direction the wind blows TOWARD, from the meteorological "from" bearing. */
export const blowsToward = (fromDeg) => ((fromDeg ?? 0) + 180) % 360;

/** Particle pixels-per-frame for a given wind speed. Tuned to read as motion
    without looking like a screensaver: ~1 px/frame per m/s. */
export const pxPerFrame = (speedMs) => Math.min(6, 0.35 + (speedMs ?? 0) * 0.55);

const COLOURS = [
  [0, 'rgba(134,163,171,0.55)'], [3, 'rgba(88,166,255,0.7)'],
  [7, 'rgba(63,185,80,0.8)'], [12, 'rgba(240,169,44,0.85)'], [18, 'rgba(248,81,73,0.9)'],
];
export function speedColour(s) {
  let c = COLOURS[0][1];
  for (const [t, col] of COLOURS) if ((s ?? 0) >= t) c = col;
  return c;
}

/** Colour for a speed, as an rgba string with explicit alpha. Keeps the ramp in
    one place so the legend and the particles cannot drift apart. */
export function rampColour(speed, alpha) {
  const t = Math.min(1, (speed ?? 0) / 9);
  return `rgba(${Math.round(72 + t * 150)},${Math.round(164 + t * 54)},${Math.round(226 - t * 96)},${alpha})`;
}

const GRID = 22;          // screen-grid resolution for the solved field

/* Streaming particles are the most motion-heavy thing on the screen, and some
   people cannot tolerate that. But the flow field is information, not
   decoration — blanking it would remove content rather than motion. So under
   Reduce Motion the particles crawl instead of stream: direction and speed
   still read, from the streak angles and the colour ramp, without the movement.
   Checked live rather than once, because the setting can change mid-session. */
const reduceMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export class WindOverlay {
  constructor(canvas, map) {
    this.canvas = canvas;
    this.map = map;
    this.ctx = canvas.getContext('2d');
    this.particles = [];
    this.speed = 0;
    this.from = 0;
    this.field = null;        // (lat, lon) => {u, v} in m/s, or null for uniform
    this.grid = null;
    this.running = false;
    this._frame = this._frame.bind(this);
    this._onResize = () => this.resize();
    this._onMove = () => this.solve();
  }

  /** Uniform fallback, used when there is no terrain to bend the wind around. */
  setWind(speedMs, fromDeg) { this.speed = speedMs ?? 0; this.from = fromDeg ?? 0; this.solve(); }

  /** Give the overlay the real flow field. Pass null to go back to uniform. */
  setField(fn) { this.field = fn; this.solve(); }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    this.canvas.width = Math.max(1, w * dpr);
    this.canvas.height = Math.max(1, h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = w; this.h = h;
    this.seed();
    this.solve();
  }

  /* Solve the field onto a coarse screen grid.

     The map is locally conformal over a few hundred metres, so one screen basis
     taken at the centre serves the whole field: how many pixels one metre east
     is, and how many one metre south is. That folds map rotation, pitch and
     zoom into two vectors instead of a trigonometry special case. */
  solve() {
    if (!this.w || !this.map) return;
    const m = this.map;

    let ex = { x: 1, y: 0 }, sy = { x: 0, y: 1 };
    try {
      const c = m.getCenter();
      const o = m.project(c);
      const mPerDegLat = 111320;
      const mPerDegLon = 111320 * Math.cos(c.lat * Math.PI / 180) || 1;
      const pe = m.project([c.lng + 1 / mPerDegLon, c.lat]);        // 1 m east
      const ps = m.project([c.lng, c.lat - 1 / mPerDegLat]);        // 1 m south
      ex = { x: pe.x - o.x, y: pe.y - o.y };
      sy = { x: ps.x - o.x, y: ps.y - o.y };
    } catch { /* map not ready — keep the identity basis */ }

    const g = new Float32Array(GRID * GRID * 3);   // vx, vy, speed
    for (let j = 0; j < GRID; j++) for (let i = 0; i < GRID; i++) {
      const sx = (i / (GRID - 1)) * this.w, sYy = (j / (GRID - 1)) * this.h;
      let u = 0, v = 0;

      if (this.field) {
        try {
          const ll = m.unproject([sx, sYy]);
          const f = this.field(ll.lat, ll.lng);
          u = f.u; v = f.v;
        } catch { /* off-globe or not ready */ }
      } else {
        const to = blowsToward(this.from) * Math.PI / 180;
        u = Math.sin(to) * this.speed;
        v = -Math.cos(to) * this.speed;
      }

      const o = (j * GRID + i) * 3;
      g[o]     = u * ex.x + v * sy.x;
      g[o + 1] = u * ex.y + v * sy.y;
      g[o + 2] = Math.hypot(u, v);
    }
    this.grid = g;
  }

  /** Bilinear read of the solved grid at a screen pixel. */
  _at(x, y, out) {
    const g = this.grid;
    if (!g) { out.vx = 0; out.vy = 0; out.sp = 0; return out; }
    const fx = Math.min(GRID - 1.001, Math.max(0, (x / this.w) * (GRID - 1)));
    const fy = Math.min(GRID - 1.001, Math.max(0, (y / this.h) * (GRID - 1)));
    const i = fx | 0, j = fy | 0, tx = fx - i, ty = fy - j;
    const rd = (k) => {
      const a = g[(j * GRID + i) * 3 + k],       b = g[(j * GRID + i + 1) * 3 + k];
      const c = g[((j + 1) * GRID + i) * 3 + k], d = g[((j + 1) * GRID + i + 1) * 3 + k];
      return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
    };
    out.vx = rd(0); out.vy = rd(1); out.sp = rd(2);
    return out;
  }

  seed() {
    // Fewer, longer-lived particles than a weather map wants: this is one field,
    // not a hemisphere, and the trail underneath has to stay readable.
    const n = Math.round(Math.min(3200, (this.w * this.h) / 520));
    this.particles = Array.from({ length: n }, () => this._spawn(true));
  }

  _spawn(anywhere) {
    return {
      x: Math.random() * this.w,
      y: Math.random() * this.h,
      life: anywhere ? Math.random() * 44 : 0,
      max: 30 + Math.random() * 42,
    };
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.canvas.hidden = false;
    this.resize();
    window.addEventListener('resize', this._onResize);
    this.map?.on('move', this._onMove);
    this._raf = requestAnimationFrame(this._frame);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this._raf);
    window.removeEventListener('resize', this._onResize);
    this.map?.off('move', this._onMove);
    this.ctx?.clearRect(0, 0, this.w || 0, this.h || 0);
    this.canvas.hidden = true;
  }

  _frame() {
    if (!this.running) return;
    const { ctx } = this;

    // Fade previous trails without painting over the map underneath.
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'rgba(0,0,0,0.215)';
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.globalCompositeOperation = 'source-over';

    ctx.lineWidth = 1.05;
    ctx.lineCap = 'round';
    const s = { vx: 0, vy: 0, sp: 0 };
    const step = reduceMotion() ? 0.18 : 1.35;

    for (const p of this.particles) {
      this._at(p.x, p.y, s);
      // 1 px per metre-of-travel would be far too fast; this is tuned to read as
      // air moving rather than as a screensaver.
      const nx = p.x + s.vx * step, ny = p.y + s.vy * step;

      // Satellite imagery is bright, so these need more weight than they would
      // over a dark basemap before they read as moving air at all.
      ctx.strokeStyle = rampColour(s.sp, Math.min(0.75, 0.26 + s.sp * 0.06));
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(nx, ny);
      ctx.stroke();

      p.x = nx; p.y = ny; p.life++;
      if (p.life > p.max || nx < -20 || nx > this.w + 20 || ny < -20 || ny > this.h + 20) {
        Object.assign(p, this._spawn(false));
        // Respawn anywhere: in a bent field there is no single upwind edge to
        // feed from, so uniform reseeding keeps the density even.
        p.x = Math.random() * this.w;
        p.y = Math.random() * this.h;
      }
    }
    this._raf = requestAnimationFrame(this._frame);
  }
}
