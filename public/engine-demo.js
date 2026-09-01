/* The scent engine, demonstrated — a screen the instructor opens for a client.

   Nothing here is a mock-up of the physics: the hillside is synthetic, but the
   code working on it is the app's own — stability(), flowAt() (deflection,
   drainage, downslope scent-creep, shelter), scentLife(), ScentSim, regime().
   Drag the ground-vs-air slider below zero and the plume starts running
   downhill; give it wind and the wind takes over. What the client watches is
   exactly what the app computes on their dog's real trail. */

import { buildTerrain, stability, flowAt, scentLife, regime, normOf } from './field.js';
import { ScentSim } from './sim.js';
import { densify, timestamps } from './geo.js';

const $ = (id) => document.getElementById(id);

const N = 44, CELL = 10, EXTENT = (N - 1) * CELL;          // ~430 m square
const CTR = { lat: 51.2, lon: -2.6 };

/* One readable hillside: high ground north-west falling away south-east, a
   knoll on the slope, a hollow low down — every terrain feature the flow
   field knows how to use, in one picture. */
function makeTerrain() {
  const dLat = EXTENT / 111320, dLon = EXTENT / (111320 * Math.cos(CTR.lat * Math.PI / 180));
  const bbox = {
    north: CTR.lat + dLat / 2, south: CTR.lat - dLat / 2,
    west: CTR.lon - dLon / 2, east: CTR.lon + dLon / 2,
  };
  const h = new Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = i / (N - 1), y = j / (N - 1);
    h[j * N + i] =
      52 * (1 - (x * 0.55 + y * 0.45)) +
      15 * Math.exp(-(((x - 0.38) ** 2 + (y - 0.42) ** 2) / 0.018)) -
      12 * Math.exp(-(((x - 0.72) ** 2 + (y - 0.72) ** 2) / 0.014));
  }
  D.hgrid = h;                       // kept for the elevation tint in the shading
  return buildTerrain(h, N, CELL, bbox);
}

/* The demo trail crosses the slope, so downhill and downwind genuinely
   disagree — which is the whole lesson. */
function makeTrail(T) {
  const corners = [[0.14, 0.30], [0.42, 0.26], [0.60, 0.48], [0.86, 0.44]].map(([x, y]) => ({
    lat: T.bbox.north - y * (T.bbox.north - T.bbox.south),
    lon: T.bbox.west + x * (T.bbox.east - T.bbox.west),
  }));
  return timestamps(densify(corners, 5), Date.now() - 22 * 60000, 1.3);
}

function sprite() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d').createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,190,80,0.9)');
  g.addColorStop(0.45, 'rgba(250,150,40,0.42)');
  g.addColorStop(1, 'rgba(245,120,20,0)');
  const ctx = c.getContext('2d');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  return c;
}

const D = {
  on: false, T: null, sim: null, trail: null, puff: null,
  streaks: [], raf: 0, lastAdv: 0, ground: null, W: 0, H: 0,
};

const reduceMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function readWx() {
  const dT = Number($('engDT').value);
  return {
    temp: 13.4, soil_temp: 13.4 + dT,
    wind_speed: Number($('engWind').value),
    wind_direction: Number($('engFrom').value),
    humidity: Number($('engHum').value),
    precipitation: Number($('engRain').value),
  };
}

const CARD = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];

function paintReadouts(wx, st) {
  $('engDTVal').textContent = `${wx.soil_temp - wx.temp >= 0 ? '+' : ''}${(wx.soil_temp - wx.temp).toFixed(1)} °C`;
  $('engWindVal').textContent = `${wx.wind_speed.toFixed(1)} m/s`;
  $('engFromVal').textContent = `${Math.round(wx.wind_direction)}° ${CARD[Math.round(wx.wind_direction / 22.5) % 16]}`;
  $('engHumVal').textContent = `${Math.round(wx.humidity)}%`;
  $('engRainVal').textContent = `${wx.precipitation.toFixed(1)} mm`;

  const life = Math.round(scentLife(wx, st));
  const lead = regime(D.T, [], wx, st);
  $('engStats').innerHTML =
    `<span class="pill klass ${lead.key === 'drain' ? 'cold' : 'warm'}">scent moves ${lead.word}</span>` +
    `<span class="pill">${st.label}</span>` +
    `<span class="pill">scent life ${life} min</span>`;
  $('engVerdict').textContent = st.plain;
}

/* Hillshade once per terrain — the ground does not move. */
function paintGround() {
  const { T } = D;
  const g = document.createElement('canvas');
  g.width = D.W; g.height = D.H;
  const ctx = g.getContext('2d');
  const img = ctx.createImageData(D.W, D.H);
  const L = { x: -0.55, y: -0.65, z: 0.53 };                 // light from the NW
  for (let py = 0; py < D.H; py++) for (let px = 0; px < D.W; px++) {
    const x = px / D.W, y = py / D.H;
    const i = Math.min(N - 1, Math.round(x * (N - 1))), j = Math.min(N - 1, Math.round(y * (N - 1)));
    const gx = T.gx[j * N + i], gy = T.gy[j * N + i];
    const inv = 1 / Math.hypot(-gx, -gy, 1);
    const shade = Math.max(0, (-gx * L.x * 3 + -gy * L.y * 3 + 1 * L.z) * inv);
    const alt = (D.hgrid[j * N + i] + 12) / 70;               // high tan, low deep green
    const o = (py * D.W + px) * 4;
    img.data[o]     = 96 + shade * 74 + alt * 52;
    img.data[o + 1] = 116 + shade * 62 + alt * 40;
    img.data[o + 2] = 84 + shade * 52 + alt * 26;
    img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  D.ground = g;
}

function px(p) {
  const n = normOf(D.T, p.lat, p.lon);
  return [n.x * D.W, n.y * D.H];
}

function frame(now) {
  if (!D.on) return;
  const cv = $('engCanvas'), ctx = cv.getContext('2d');
  const wx = readWx();
  const st = stability(wx.soil_temp, wx.temp);

  if (!D.lastAdv || now - D.lastAdv > 250) {
    D.sim.advance(D.T, wx, st, Date.now());
    D.lastAdv = now;
    paintReadouts(wx, st);
  }

  ctx.clearRect(0, 0, D.W, D.H);
  ctx.drawImage(D.ground, 0, 0);

  // Wind streaks, advected by the same flowAt the app uses on real ground.
  const step = (reduceMotion() ? 0.35 : 2.2) / EXTENT;
  ctx.lineWidth = 1; ctx.lineCap = 'round';
  const f = { u: 0, v: 0 };
  for (const s of D.streaks) {
    flowAt(D.T, s.x, s.y, wx, st, f);
    const nx = s.x + f.u * step, ny = s.y + f.v * step;
    const sp = Math.hypot(f.u, f.v);
    ctx.strokeStyle = `rgba(225,240,255,${Math.min(0.8, 0.3 + sp * 0.09)})`;
    ctx.beginPath();
    ctx.moveTo(s.x * D.W, s.y * D.H);
    ctx.lineTo(nx * D.W, ny * D.H);
    ctx.stroke();
    s.x = nx; s.y = ny; s.life++;
    if (s.life > s.max || nx < 0 || nx > 1 || ny < 0 || ny > 1) {
      s.x = Math.random(); s.y = Math.random(); s.life = 0; s.max = 40 + Math.random() * 50;
    }
  }

  // The plume — real ScentSim particles, metric sprites, same as the map.
  const ppm = D.W / EXTENT;
  ctx.globalCompositeOperation = 'lighter';
  for (const s of D.sim.parts) {
    if (s.str < 0.02) continue;
    const [x, y] = px(s);
    const rad = Math.max(2, Math.min(26, (1.6 + s.phase * 7.5 * Math.max(0.5, st.mix)) * ppm));
    ctx.globalAlpha = Math.min(0.95, s.str * 0.9);
    ctx.drawImage(D.puff, x - rad, y - rad, rad * 2, rad * 2);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';

  // The laid trail over the plume, cased so the glow cannot drown it — the
  // whole lesson is the GAP between where the feet went and where the scent is.
  const line = () => {
    ctx.beginPath();
    D.trail.forEach((p, i) => {
      const [x, y] = px(p);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.stroke();
  };
  ctx.strokeStyle = 'rgba(20,30,45,0.75)'; ctx.lineWidth = 4; ctx.setLineDash([]);
  line();
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.setLineDash([6, 5]);
  line();
  ctx.setLineDash([]);

  D.raf = requestAnimationFrame(frame);
}

export function openEngineDemo() {
  const cv = $('engCanvas');
  const w = cv.clientWidth || 320;
  cv.width = w; cv.height = w;                                // square ground
  D.W = cv.width; D.H = cv.height;

  if (!D.T) {
    D.T = makeTerrain();
    D.trail = makeTrail(D.T);
    D.puff = sprite();
    D.streaks = Array.from({ length: 550 }, () => ({
      x: Math.random(), y: Math.random(), life: Math.random() * 40, max: 40 + Math.random() * 50,
    }));
  }
  paintGround();
  // The trail re-ages in real time between openings; keep the story stable at
  // ~22 minutes old so the demo always shows a living plume.
  D.trail = makeTrail(D.T);
  D.sim = new ScentSim().seed(D.trail);
  D.on = true;
  D.lastAdv = 0;
  cancelAnimationFrame(D.raf);
  D.raf = requestAnimationFrame(frame);
}

export function stopEngineDemo() {
  D.on = false;
  cancelAnimationFrame(D.raf);
}
