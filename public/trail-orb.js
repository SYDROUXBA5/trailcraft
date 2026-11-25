/* Home's orb on a person trail: the trail itself, and how old it is
   (Rémi, 25 Nov 2026: of three mock-ups he picked "Idea 1, scent trail").

   Footprints cross the orb one after another and each gives off scent that
   drifts up on the wind. The fresher the trail, the more scent is left: a hot
   trail is bright red and dense, a warm one thinner amber haze, a cold one a
   few faint blue specks over prints glinting with frost. It is drawn on a
   plain 2D canvas over the orb, the glow from one soft dot drawn once per
   colour (shadowBlur on every speck was too slow for a phone).

   It runs only while start() says so (home on screen, dial closed, app in
   front); with Reduce Motion, or the app's own motion off, it is one still
   frame of the same trail. */

const COL = { hot: [255, 90, 72], warm: [255, 166, 48], cold: [95, 180, 255] };
const FROST = [235, 248, 255];
const HEAT = { hot: 1, warm: 0.5, cold: 0.15 };              // how much scent is left
const RATE = { hot: 34, warm: 13, cold: 4 };                  // specks a second, off the whole trail
const PRINTS = 14, STEP = 0.2, CYCLE = 4.6;                   // a print every 0.2 s; the walk starts again every 4.6 s
const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion === 'off';
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

const sprites = new Map();
function sprite(col) {
  const key = col.join();
  if (sprites.has(key)) return sprites.get(key);
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d'), gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, `rgba(${col},1)`); gr.addColorStop(0.25, `rgba(${col},0.85)`); gr.addColorStop(0.6, `rgba(${col},0.22)`); gr.addColorStop(1, `rgba(${col},0)`);
  x.fillStyle = gr; x.fillRect(0, 0, 64, 64); sprites.set(key, c); return c;
}

export function createTrailOrb(host) {
  const cv = document.createElement('canvas');
  cv.className = 'trail-orb'; cv.setAttribute('aria-hidden', 'true'); cv.hidden = true;
  host.appendChild(cv);
  const g = cv.getContext('2d');
  let S = 0, level = null, run = false, raf = 0, last = 0, T = 0, cycle = -1, prints = [], parts = [];

  /* A walked line from bottom left to top right, gently weaving; prints left, right, left. */
  const fit = () => {
    const w = Math.round(host.getBoundingClientRect().width) || 240, dpr = Math.min(2, devicePixelRatio || 1);
    if (w === S && cv.width === Math.round(w * dpr)) return;
    S = w; cv.width = cv.height = Math.round(S * dpr); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const P = (u) => ({ x: S * (0.14 + 0.72 * u), y: S * (0.84 - 0.66 * u) + Math.sin(u * Math.PI * 2) * S * 0.07 });
    const k = S / 240;                                         // drawn at 240 px, scaled to the orb
    prints = Array.from({ length: PRINTS }, (_, i) => {
      const u = (i + 0.5) / PRINTS, p = P(u), q = P(Math.min(1, u + 0.01)), a = Math.atan2(q.y - p.y, q.x - p.x), side = i % 2 ? 1 : -1;
      return { x: p.x + Math.cos(a + Math.PI / 2) * 6 * k * side, y: p.y + Math.sin(a + Math.PI / 2) * 6 * k * side, a, born: i * STEP, k };
    });
  };

  const dot = (col, x, y, r, a) => { const s = sprite(col); g.globalAlpha = a; g.drawImage(s, x - r * 3, y - r * 3, r * 6, r * 6); g.globalAlpha = 1; };

  const draw = (dt) => {
    const c = COL[level], heat = HEAT[level], n = Math.floor(T / CYCLE), t = T - n * CYCLE;
    if (n !== cycle) { cycle = n; parts = []; }
    g.clearRect(0, 0, S, S);
    g.save(); g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 1, 0, Math.PI * 2); g.clip();
    g.globalCompositeOperation = 'lighter';
    for (const p of prints) {
      const age = t - p.born; if (age < 0) continue;
      const a = Math.min(1, age * 3) * (level === 'cold' ? 0.32 : level === 'warm' ? 0.6 : 0.95);
      g.save(); g.translate(p.x, p.y); g.rotate(p.a + Math.PI / 2); g.scale(p.k, p.k);
      dot(c, 0, 0, 4 + 4 * heat, 0.35 * a);
      g.fillStyle = rgba(level === 'cold' ? [200, 230, 255] : c, a);
      g.beginPath(); g.ellipse(0, -3.6, 3.6, 5.4, 0, 0, Math.PI * 2); g.fill();          // the sole
      g.beginPath(); g.ellipse(0, 5, 2.7, 2.9, 0, 0, Math.PI * 2); g.fill();             // the heel
      g.restore();
      if (Math.random() < RATE[level] * dt / PRINTS) parts.push({ x: p.x + (Math.random() - 0.5) * 6 * p.k, y: p.y + (Math.random() - 0.5) * 6 * p.k,
        vx: (6 + Math.random() * 10) * p.k, vy: -(10 + Math.random() * 12) * (0.5 + heat * 0.7) * p.k, life: 1.2 + Math.random() * 1.2, age: 0, r: (0.8 + Math.random() * 1.6) * (0.6 + heat * 0.5) * p.k });
      if (level === 'cold' && Math.random() < 1.8 * dt) parts.push({ x: p.x + (Math.random() - 0.5) * 8 * p.k, y: p.y + (Math.random() - 0.5) * 8 * p.k, vx: 0, vy: 0, life: 0.5, age: 0, r: 1.4 * p.k, frost: true });
    }
    for (let i = parts.length - 1; i >= 0; i--) {
      const q = parts[i]; q.age += dt;
      if (q.age > q.life) { parts.splice(i, 1); continue; }
      q.x += q.vx * dt; q.y += q.vy * dt; q.vx += Math.sin((q.y + T * 20) * 0.08) * 24 * dt;    // the wind is not steady
      const k = 1 - q.age / q.life;
      dot(q.frost ? FROST : c, q.x, q.y, q.r * (q.frost ? 1 : 1 + (1 - k) * 1.6), (q.frost ? 0.9 : 0.6) * k);
    }
    g.restore(); g.globalCompositeOperation = 'source-over';
  };

  /* Reduce Motion: the whole trail laid, and the scent caught in the air above it. */
  const drawStill = () => {
    fit(); T = PRINTS * STEP + 1.4; cycle = Math.floor(T / CYCLE); parts = [];
    for (let i = 0; i < 40; i++) draw(1 / 30);
  };

  const loop = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000 || 1 / 60); last = now; T += dt;
    draw(dt); if (run) raf = requestAnimationFrame(loop);
  };

  return {
    /** 'hot' | 'warm' | 'cold' shows the trail at that age; null puts it away. */
    show(lv) {
      level = COL[lv] ? lv : null; cv.hidden = !level;
      if (!level) { this.stop(); return; }
      fit(); T = 0; cycle = -1; parts = [];
      if (!run) drawStill();
    },
    start() {
      if (run || !level) return;
      if (still()) { drawStill(); return; }
      fit(); T = 0; cycle = -1; parts = []; run = true; last = performance.now(); raf = requestAnimationFrame(loop);   // the walk from its start
    },
    stop() { run = false; cancelAnimationFrame(raf); },
  };
}
