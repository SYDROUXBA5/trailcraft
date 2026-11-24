/* Home's background, dark theme (Rémi, 24 Nov 2026: picked "Slow air, scent lingers" from the scent drafts).
   Real scent meeting the orb: strands of scent arrive on a slow wind from above, squash against the orb, slide round
   it, and are drawn into the still air behind it where they linger; purple specks drift in the air and show only where
   there is scent. The steady wind round the orb and a starting scent are baked (scripts/bake-home-air.mjs →
   holo/homeair-1.json), so the phone runs only the scent (15 a second), the eddies and the specks (30 a second).
   Loaded with import() by app.js; runs only while home is on screen with the dial closed and the app in front.
   With Reduce Motion (the phone's or the app's), one still frame. */
/* ── The physics, shared with scripts/bake-home-air.mjs (Node imports this file: nothing at the top level touches the page).
   Units are "bake px": the orb's radius is 66; the app scales by its own orb's radius / 66.
   a = along the wind (downwind +), c = across it, both from the orb's centre. ── */
export const AIR = { R: 66, CELL: 6, U0: 0.06, SPF: 5, NU: 0.034, K: 0.6, RD: 6, FPS: 30 };
export const UB = AIR.U0 * AIR.CELL * AIR.SPF * AIR.FPS;                 // the free wind, bake px a second (54)
const OCT = [[150, 14, 0.05], [65, 6.5, 0.1], [28, 2.2, 0.22]];        // eddy size, strength (px/s), how fast it changes shape

/** Perlin noise in 3D, from a fixed seed so the baked scent and the live one are the same weather. */
export function makeNoise(seed0 = 7) {
  let seed = seed0;
  const rnd = () => { seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const P = new Uint8Array(512), p = [...Array(256).keys()];
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) P[i] = p[i & 255];
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10), lerp = (a, b, t) => a + (b - a) * t;
  const grad = (h, x, y, z) => { h &= 15; const u = h < 8 ? x : y, v = h < 4 ? y : (h === 12 || h === 14 ? x : z); return ((h & 1) ? -u : u) + ((h & 2) ? -v : v); };
  return function noise3(x, y, z) {
    const X0 = Math.floor(x), Y0 = Math.floor(y), Z0 = Math.floor(z);
    x -= X0; y -= Y0; z -= Z0; const xi = X0 & 255, yi = Y0 & 255, zi = Z0 & 255;
    const u = fade(x), v = fade(y), w = fade(z);
    const A = P[xi] + yi, AA = P[A] + zi, AB = P[A + 1] + zi, B = P[xi + 1] + yi, BA = P[B] + zi, BB = P[B + 1] + zi;
    return lerp(lerp(lerp(grad(P[AA], x, y, z), grad(P[BA], x - 1, y, z), u), lerp(grad(P[AB], x, y - 1, z), grad(P[BB], x - 1, y - 1, z), u), v),
      lerp(lerp(grad(P[AA + 1], x, y, z - 1), grad(P[BA + 1], x - 1, y, z - 1), u), lerp(grad(P[AB + 1], x, y - 1, z - 1), grad(P[BB + 1], x - 1, y - 1, z - 1), u), v), w);
  };
}

/** Eddies and gusts at (a, c) at time t (already slowed to 60%): T.g multiplies the wind, T.a / T.c are added (px/s). */
export function turb(noise3, a, c, t, T) {
  const q = (a - UB * t) / 280;                                             // gusts ride the wind
  T.g = 1 + 0.3 * noise3(q, 7.3, t * 0.04) + 0.13 * noise3(q * 2.7, 3.1, t * 0.09);
  const oa = a - UB * t * 0.9;                                              // eddies drift downwind with the air
  let va = 0, vc = 0;
  for (const [L, k, ev] of OCT) {
    const x = oa / L, y = c / L, z = t * ev, h = 0.02;
    const n0 = noise3(x, y, z), na = noise3(x + h, y, z), nb = noise3(x, y + h, z);
    va += k * (nb - n0) / h; vc -= k * (na - n0) / h;                       // curl: swirls, no air piling up
  }
  const u = Math.min(1, Math.max(0, (Math.hypot(a, c) - AIR.R) / AIR.RD)), m = u * u * (3 - 2 * u);   // still at the orb's skin
  T.a = va * m; T.c = vc * m;
}

/** Scent arriving on the wind at cross position c: thin broken strands with clean air between, from far upwind. */
export function inflow(noise3, c, t) {
  const n = 0.75 * noise3(c / 38, t * 0.5, 3.3) + 0.6 * noise3(c / 12, t * 1.7, 8.1);
  return Math.min(1, Math.max(0, (n - 0.1) * 3));
}

/* ── The page ── */

const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion === 'off';
const HAZE = [185, 160, 255], SPECK = '205,180,255', HAZE_A = 0.38, HAZE_GAIN = 1.1, SPECK_A = 0.7, SPECK_W = 1.1;
const WB = (() => { const m = Math.hypot(-0.35, 0.94); return [-0.35 / m, 0.94 / m]; })(), NB = [-WB[1], WB[0]];   // wind from above, a little from the right
const DT = 1 / AIR.FPS, K = AIR.K, PXF = AIR.U0 * AIR.CELL * AIR.SPF;   // free wind, bake px a frame
const SCS = 3, VG = 8, HK = 14, NBK = 24, RW = (AIR.R + 2.5) / AIR.R;      // scent cell and eddy lattice (css px), speck trail length

async function unpack(b64) {
  const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
  const out = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer();
  return new Uint8Array(out);
}
let bakedP = null;
const baked = () => (bakedP ??= fetch('holo/homeair-1.json').then((r) => { if (!r.ok) throw new Error('homeair'); return r.json(); })
  .then(async (j) => ({ ...j, windQ: new Int8Array((await unpack(j.wind.data)).buffer), scentQ: await unpack(j.scent.data) })));

/** Makes the background inside host (a box behind home's page) around orb. Resolves to { start, stop } or throws. */
export async function createHomeAir(host, orb) {
  if (typeof DecompressionStream !== 'function') throw new Error('no DecompressionStream');
  const B = await baked(), noise = makeNoise();
  const hazeCv = document.createElement('canvas'), speckCv = document.createElement('canvas');
  hazeCv.className = 'air-haze'; speckCv.className = 'air-specks';
  host.append(hazeCv, speckCv);
  const hx = hazeCv.getContext('2d'), sx = speckCv.getContext('2d');
  const T = { g: 1, a: 0, c: 0 };
  let t = B.t, key = '', W = 0, H = 0, R = 0, ox = 0, oy = 0, S = 1;
  let gx0 = 0, gy0 = 0, gw = 0, gh = 0, GN = 0, C = null, HAT = null, MN = null, MX = null, MASK = null, img = null;
  let vw = 0, vh = 0, VA = null, VC = null, VMx = null, VMy = null, VTx = null, VTy = null;
  let N = 0, px = null, py = null, age = null, life = null, hxs = null, hys = null, hk = 0, dpr = 1;
  let raf = 0, last = 0, frame = 0;

  /* the baked wind (units of the free wind; a, c in bake px) and the baked scent, read bilinearly */
  function windAt(a, c) {
    const w = B.wind, fx = (a - w.a0) / w.d - 0.5, fy = (c - w.c0) / w.d - 0.5;
    if (fx < 0 || fy < 0 || fx > w.nx - 1 || fy > w.ny - 1) return [1, 0];
    const i0 = Math.min(w.nx - 2, fx | 0), j0 = Math.min(w.ny - 2, fy | 0), tx = fx - i0, ty = fy - j0, k = (j0 * w.nx + i0) * 2, r = w.nx * 2, Q = B.windQ;
    const at = (o) => ((Q[k + o] * (1 - tx) + Q[k + o + 2] * tx) * (1 - ty) + (Q[k + r + o] * (1 - tx) + Q[k + r + o + 2] * tx) * ty) / w.q;
    return [at(0), at(1)];
  }
  function scentAt(a, c) {
    const s = B.scent, fx = (a - s.a0) / s.d - 0.5, fy = (c - s.c0) / s.d - 0.5;
    if (fx < 0 || fy < 0 || fx > s.nx - 1 || fy > s.ny - 1) return 0;
    const i0 = Math.min(s.nx - 2, fx | 0), j0 = Math.min(s.ny - 2, fy | 0), tx = fx - i0, ty = fy - j0, k = j0 * s.nx + i0, Q = B.scentQ;
    return ((Q[k] * (1 - tx) + Q[k + 1] * tx) * (1 - ty) + (Q[k + s.nx] * (1 - tx) + Q[k + s.nx + 1] * tx) * ty) / s.q;
  }
  const toA = (x, y) => ((x - ox) * WB[0] + (y - oy) * WB[1]) / S, toC = (x, y) => ((x - ox) * NB[0] + (y - oy) * NB[1]) / S;

  /* sizes come from the orb: everything scales with its radius, so a bigger phone sees the same weather, bigger */
  function layout() {
    const hr = host.getBoundingClientRect(), or = orb.getBoundingClientRect();
    if (!hr.width || !hr.height || !or.width) return false;
    const nk = [hr.width, hr.height, or.width, or.left - hr.left, or.top - hr.top].map(Math.round).join();
    if (nk === key) return true;
    key = nk; W = hr.width; H = hr.height; R = or.width / 2; ox = or.left - hr.left + R; oy = or.top - hr.top + R; S = R / AIR.R;
    // the scent: a screen-aligned grid, with room above and to the right for the wind to shape the strands before they show
    gx0 = -12; gy0 = -Math.round(1.6 * R); gw = Math.ceil((W + 12 + 0.6 * R) / SCS); gh = Math.ceil((H - gy0 + 12) / SCS); GN = gw * gh;
    C = new Float32Array(GN); HAT = new Float32Array(GN); MN = new Float32Array(GN); MX = new Float32Array(GN); MASK = new Uint8Array(GN);
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
      const x = gx0 + (i + 0.5) * SCS, y = gy0 + (j + 0.5) * SCS, k = j * gw + i;
      C[k] = scentAt(toA(x, y), toC(x, y)) || 0; MASK[k] = (x - ox) ** 2 + (y - oy) ** 2 < R * R ? 1 : 0;
    }
    // the air: the baked wind on an 8 px lattice, turned into screen px a frame; eddies are added to it every scent step
    vw = Math.ceil(gw * SCS / VG) + 1; vh = Math.ceil(gh * SCS / VG) + 1; const vn = vw * vh;
    VA = new Float32Array(vn); VC = new Float32Array(vn); VMx = new Float32Array(vn); VMy = new Float32Array(vn); VTx = new Float32Array(vn); VTy = new Float32Array(vn);
    for (let j = 0; j < vh; j++) for (let i = 0; i < vw; i++) {
      const x = gx0 + i * VG, y = gy0 + j * VG, k = j * vw + i, a = toA(x, y), c = toC(x, y), [wa, wc] = windAt(a, c);
      VA[k] = a; VC[k] = c; VMx[k] = (wa * WB[0] + wc * NB[0]) * PXF * S; VMy[k] = (wa * WB[1] + wc * NB[1]) * PXF * S;
    }
    buildVel();
    // the specks: about as many for the orb's size as in the drafts
    N = Math.max(1200, Math.min(3600, Math.round(130 * W * H / (R * R))));
    px = new Float32Array(N); py = new Float32Array(N); age = new Float32Array(N); life = new Float32Array(N);
    hxs = new Float32Array(N * HK); hys = new Float32Array(N * HK); hk = 0;
    for (let i = 0; i < N; i++) { spawn(i); age[i] = Math.random() * life[i]; }
    // canvases: the scent at its own grid (the browser smooths it up), the specks at up to 2x
    hazeCv.width = gw; hazeCv.height = gh;
    Object.assign(hazeCv.style, { left: gx0 + 'px', top: gy0 + 'px', width: gw * SCS + 'px', height: gh * SCS + 'px' });
    img = hx.createImageData(gw, gh);
    for (let k = 0; k < GN; k++) { img.data[k * 4] = HAZE[0]; img.data[k * 4 + 1] = HAZE[1]; img.data[k * 4 + 2] = HAZE[2]; }
    dpr = Math.min(2, window.devicePixelRatio || 1);
    speckCv.width = Math.round(W * dpr); speckCv.height = Math.round(H * dpr);
    return true;
  }

  function buildVel() {
    const f = S * DT;
    for (let k = 0; k < VA.length; k++) {
      turb(noise, VA[k], VC[k], t, T);
      VTx[k] = K * (T.g * VMx[k] + (T.a * WB[0] + T.c * NB[0]) * f); VTy[k] = K * (T.g * VMy[k] + (T.a * WB[1] + T.c * NB[1]) * f);
    }
  }
  let QX = 0, QY = 0;
  function vel(x, y) {
    let fx = (x - gx0) / VG, fy = (y - gy0) / VG;
    if (fx < 0) fx = 0; else if (fx > vw - 1.001) fx = vw - 1.001;
    if (fy < 0) fy = 0; else if (fy > vh - 1.001) fy = vh - 1.001;
    const i0 = fx | 0, j0 = fy | 0, tx = fx - i0, ty = fy - j0, k = j0 * vw + i0;
    QX = (VTx[k] * (1 - tx) + VTx[k + 1] * tx) * (1 - ty) + (VTx[k + vw] * (1 - tx) + VTx[k + vw + 1] * tx) * ty;
    QY = (VTy[k] * (1 - tx) + VTy[k + 1] * tx) * (1 - ty) + (VTy[k + vw] * (1 - tx) + VTy[k + vw + 1] * tx) * ty;
  }
  let SMN = 0, SMX = 0;
  function sample(A, x, y, mm) {
    let fx = (x - gx0) / SCS - 0.5, fy = (y - gy0) / SCS - 0.5;
    if (fy < 0 || fx > gw - 1.001) { const v = inflow(noise, toC(x, y), t); SMN = SMX = v; return v; }   // upwind: fresh scent on the wind
    if (fx < 0) fx = 0; if (fy > gh - 1.001) fy = gh - 1.001;
    const i0 = fx | 0, j0 = fy | 0, tx = fx - i0, ty = fy - j0, k = j0 * gw + i0;
    const p = A[k], q = A[k + 1], r = A[k + gw], s = A[k + gw + 1];
    if (mm) { SMN = Math.min(p, q, r, s); SMX = Math.max(p, q, r, s); }
    return (p * (1 - tx) + q * tx) * (1 - ty) + (r * (1 - tx) + s * tx) * ty;
  }
  /* MacCormack: trace back, check by tracing forward, correct half the error, never past the values it came from.
     Scent can't pass through the orb: a trace that lands inside it is put back on its skin. */
  function stepScent(n) {
    const rw = RW * R;
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
      const k = j * gw + i; let x = gx0 + (i + 0.5) * SCS, y = gy0 + (j + 0.5) * SCS;
      let dx = x - ox, dy = y - oy, d2 = dx * dx + dy * dy;
      if (d2 < rw * rw) { const d = Math.sqrt(d2) || 1; x = ox + dx / d * (rw + SCS); y = oy + dy / d * (rw + SCS); }
      vel(x, y); const v1x = QX, v1y = QY; vel(x - v1x * n * 0.5, y - v1y * n * 0.5);
      let bx = x - QX * n, by = y - QY * n; dx = bx - ox; dy = by - oy; d2 = dx * dx + dy * dy;
      if (d2 < rw * rw) { const d = Math.sqrt(d2) || 1; bx = ox + dx / d * rw; by = oy + dy / d * rw; }
      HAT[k] = sample(C, bx, by, true); MN[k] = SMN; MX[k] = SMX;
      let fx = x + v1x * n, fy = y + v1y * n; dx = fx - ox; dy = fy - oy; d2 = dx * dx + dy * dy;
      if (d2 < rw * rw) { const d = Math.sqrt(d2) || 1; fx = ox + dx / d * rw; fy = oy + dy / d * rw; }
      FWDX[k] = fx; FWDY[k] = fy;
    }
    for (let k = 0; k < GN; k++) {
      let v = HAT[k] + 0.5 * (C[k] - sample(HAT, FWDX[k], FWDY[k], false));
      if (v < MN[k]) v = MN[k]; else if (v > MX[k]) v = MX[k];
      C[k] = v;
    }
  }
  let FWDX = new Float32Array(0), FWDY = new Float32Array(0);
  const ALPHA = new Uint8Array(256);
  for (let i = 0; i < 256; i++) ALPHA[i] = Math.round(255 * HAZE_A * Math.pow(Math.min(1, i / 255 * HAZE_GAIN), 1.15));
  function paintHaze() {
    const d = img.data;
    for (let k = 0; k < GN; k++) d[k * 4 + 3] = MASK[k] ? 0 : ALPHA[Math.min(255, (C[k] * 255) | 0)];
    hx.putImageData(img, 0, 0);
  }

  function spawn(i) {
    let x, y; do { x = Math.random() * (W + 40) - 20; y = Math.random() * (H + 40) - 20; } while ((x - ox) ** 2 + (y - oy) ** 2 < (R + 3) ** 2);
    px[i] = x; py[i] = y; age[i] = 0; life[i] = (3 + Math.random() * 5) / K;
    for (let k = 0; k < HK; k++) { hxs[k * N + i] = x; hys[k * N + i] = y; }
  }
  function stepSpecks() {
    hk = (hk + 1) % HK;
    for (let i = 0; i < N; i++) {
      const x0 = px[i], y0 = py[i]; vel(x0, y0); vel(x0 + QX * 0.5, y0 + QY * 0.5);
      const x = x0 + QX, y = y0 + QY; px[i] = x; py[i] = y; age[i] += DT;
      if (age[i] > life[i] || x < -30 || x > W + 30 || y < -30 || y > H + 30 || (x - ox) ** 2 + (y - oy) ** 2 < (R + S) ** 2) spawn(i);
      hxs[hk * N + i] = px[i]; hys[hk * N + i] = py[i];
    }
  }
  const paths = new Array(NBK);
  function drawSpecks() {
    sx.setTransform(1, 0, 0, 1, 0, 0); sx.clearRect(0, 0, speckCv.width, speckCv.height); sx.setTransform(dpr, 0, 0, dpr, 0, 0);
    sx.globalCompositeOperation = 'lighter'; sx.lineCap = 'round'; sx.lineWidth = SPECK_W;
    paths.fill(null);
    const ref = PXF * K * S;
    for (let i = 0; i < N; i++) {
      const f = Math.min(1, age[i] / 0.6, (life[i] - age[i]) / 0.6); if (f <= 0) continue;
      const sc = Math.min(1, sample(C, px[i], py[i], false) * 1.4); if (sc < 0.03) continue;   // lit only where there is scent
      const c = hk * N + i, p = ((hk - 1 + HK) % HK) * N + i, sp = Math.hypot(hxs[c] - hxs[p], hys[c] - hys[p]) / ref;
      const s = (0.45 + 0.55 * Math.min(1, sp * sp)) * Math.pow(sc, 0.9);
      for (let r = 0; r < HK - 1; r++) {
        const k1 = ((hk - r + HK) % HK) * N + i, k2 = ((hk - r - 1 + HK) % HK) * N + i;
        const dx = hxs[k1] - hxs[k2], dy = hys[k1] - hys[k2]; if ((dx === 0 && dy === 0) || dx * dx + dy * dy > 900) continue;
        const ramp = 1 - r / (HK - 1), a = f * s * ramp * ramp; if (a <= 0.02) continue;
        const b = Math.min(NBK - 1, (a * NBK) | 0), pa = paths[b] || (paths[b] = new Path2D());
        pa.moveTo(hxs[k2], hys[k2]); pa.lineTo(hxs[k1], hys[k1]);
      }
    }
    for (let b = 0; b < NBK; b++) if (paths[b]) { sx.strokeStyle = `rgba(${SPECK},${SPECK_A * (b + 0.5) / NBK})`; sx.stroke(paths[b]); }
  }

  function ensure() {
    if (!layout()) return false;
    if (FWDX.length !== GN) { FWDX = new Float32Array(GN); FWDY = new Float32Array(GN); }
    return true;
  }
  function tick(now) {
    raf = requestAnimationFrame(tick);
    if (now - last < 30) return;                                            // 30 a second is plenty for drifting air
    last = now;
    if (!ensure()) return;
    stepSpecks(); frame++;
    if (frame % 2 === 0) { stepScent(2); t += 2 * DT * K; buildVel(); paintHaze(); }
    drawSpecks();
  }
  function paintStill() {
    if (!ensure()) return;
    for (let i = 0; i < HK; i++) stepSpecks();                              // give the specks their trails, then hold
    paintHaze(); drawSpecks();
  }
  new ResizeObserver(() => { if (!raf && still()) paintStill(); }).observe(host);   // running, the next tick lays out again itself
  return {
    start() { if (raf) return; if (still()) { paintStill(); return; } if (!ensure()) return; paintHaze(); last = 0; raf = requestAnimationFrame(tick); },
    stop() { if (raf) cancelAnimationFrame(raf); raf = 0; },
  };
}
