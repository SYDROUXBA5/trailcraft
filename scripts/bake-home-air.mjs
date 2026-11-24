/* Bakes what home-scent.js needs, so the phone never runs the air simulation itself:
   1. the steady wind round home's orb: a lattice Boltzmann simulation (D2Q9, BGK, Re about 40, so the air stays stuck to
      the orb and closes behind it), averaged, stored at 1/11 of the orb's radius;
   2. a starting scent: the scent carried by that air plus the travelling eddies and gusts home-scent.js adds, run long
      enough to cross the screen and pool behind the orb, so the background is full the moment home opens.
   Units: "bake px", where the orb's radius is 66. The app scales everything by (its orb's radius / 66).
   Axes: a = along the wind (downwind +), c = across it, both from the orb's centre.
   node scripts/bake-home-air.mjs  →  public/holo/homeair-1.json */
import { writeFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { AIR, makeNoise, turb, inflow } from '../public/home-scent.js';

const { R, CELL, U0, SPF, NU, K, FPS } = AIR, DT = 1 / FPS;
const A0 = -420, A1 = 760, CH = 370;                                       // the tunnel: from 420 upwind to 760 downwind, 370 each side
const NX = Math.ceil((A1 - A0) / CELL), NY = Math.ceil(2 * CH / CELL), NC = NX * NY, LX = NX * CELL, LY = NY * CELL;
const OCX = -A0, OCY = LY / 2, CX = OCX / CELL, CY = OCY / CELL, RC = (R + 2) / CELL;
const EX = [0, 1, 0, -1, 0, 1, -1, -1, 1], EY = [0, 0, 1, 0, -1, 1, 1, -1, -1], WT = [4 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 36, 1 / 36, 1 / 36, 1 / 36], OPP = [0, 3, 4, 1, 2, 7, 8, 5, 6];
const SOL = new Uint8Array(NC);
for (let y = 0; y < NY; y++) for (let x = 0; x < NX; x++) SOL[y * NX + x] = (x + .5 - CX) ** 2 + (y + .5 - CY) ** 2 < RC * RC ? 1 : 0;
let F = new Float32Array(9 * NC), G = new Float32Array(9 * NC);
const UX = new Float32Array(NC), UY = new Float32Array(NC), VV = new Float64Array(9), OMEGA = 1 / (3 * NU + .5);
for (let c = 0; c < NC; c++) for (let i = 0; i < 9; i++) { const eu = EX[i] * U0; F[i * NC + c] = WT[i] * (1 + 3 * eu + 4.5 * eu * eu - 1.5 * U0 * U0); }
let n = 0;
function lbm() {
  const s0 = n++;
  for (let y = 0; y < NY; y++) {
    const vin = (s0 < 2500 ? .2 * U0 * Math.sin(s0 * .006) : 0) + .04 * U0 * Math.sin(y * .23 + s0 * .0024) + .03 * U0 * Math.sin(y * .071 - s0 * .0014);
    for (let x = 0; x < NX; x++) {
      const c = y * NX + x;
      if (SOL[c]) { UX[c] = 0; UY[c] = 0; continue; }
      if (x === 0) { const uu = 1.5 * (U0 * U0 + vin * vin); for (let i = 0; i < 9; i++) { const eu = EX[i] * U0 + EY[i] * vin; G[i * NC + c] = WT[i] * (1 + 3 * eu + 4.5 * eu * eu - uu); } UX[c] = U0; UY[c] = vin; continue; }
      if (x === NX - 1) { for (let i = 0; i < 9; i++) G[i * NC + c] = G[i * NC + c - 1]; UX[c] = UX[c - 1]; UY[c] = UY[c - 1]; continue; }
      let r = 0, mx = 0, my = 0;
      for (let i = 0; i < 9; i++) {
        let sy = y - EY[i]; if (sy < 0) sy += NY; else if (sy >= NY) sy -= NY;
        const s = sy * NX + x - EX[i], fi = SOL[s] ? F[OPP[i] * NC + c] : F[i * NC + s];
        VV[i] = fi; r += fi; mx += EX[i] * fi; my += EY[i] * fi;
      }
      const ux = mx / r, uy = my / r, uu = 1.5 * (ux * ux + uy * uy); UX[c] = ux; UY[c] = uy;
      for (let i = 0; i < 9; i++) { const eu = EX[i] * ux + EY[i] * uy; G[i * NC + c] = VV[i] + OMEGA * (WT[i] * r * (1 + 3 * eu + 4.5 * eu * eu - uu) - VV[i]); }
    }
  }
  const t = F; F = G; G = t;
}

/* 1. the wind */
const t0 = Date.now();
for (let i = 0; i < 9000; i++) lbm();
const SX = new Float64Array(NC), SY = new Float64Array(NC), AVG = 3000;
for (let i = 0; i < AVG; i++) { lbm(); for (let c = 0; c < NC; c++) { SX[c] += UX[c]; SY[c] += UY[c]; } }
console.log('air settled', ((Date.now() - t0) / 1000).toFixed(1) + ' s');
// stored crop: a from -360 to 702, c from -342 to 342, one value a cell, int8 = 64 for the free wind
const VA0 = -360, VA1 = 702, VC0 = -342, VC1 = 342, Q = 64;      // whole cells: the orb sits on cell corners
const VNX = (VA1 - VA0) / CELL, VNY = (VC1 - VC0) / CELL, VQ = new Int8Array(VNX * VNY * 2);
const MA = new Float32Array(VNX * VNY), MC = new Float32Array(VNX * VNY);     // the stored wind, read back as the app reads it
for (let j = 0; j < VNY; j++) for (let i = 0; i < VNX; i++) {
  const gx = Math.round((OCX + VA0) / CELL) + i, gy = Math.round((OCY + VC0) / CELL) + j, c = gy * NX + gx, k = j * VNX + i;
  const qa = Math.max(-127, Math.min(127, Math.round(SX[c] / AVG / U0 * Q))), qc = Math.max(-127, Math.min(127, Math.round(SY[c] / AVG / U0 * Q)));
  VQ[k * 2] = qa; VQ[k * 2 + 1] = qc; MA[k] = qa / Q; MC[k] = qc / Q;
}
/* the stored wind as the app samples it: px a frame along (a) and across (c), cell centres at VA0 + (i + .5) * CELL */
function windAt(a, c) {
  let fx = (a - VA0) / CELL - .5, fy = (c - VC0) / CELL - .5;
  if (fx < 0 || fy < 0 || fx > VNX - 1 || fy > VNY - 1) return [1, 0];
  const i0 = Math.min(VNX - 2, fx | 0), j0 = Math.min(VNY - 2, fy | 0), tx = fx - i0, ty = fy - j0, k = j0 * VNX + i0;
  return [(MA[k] * (1 - tx) + MA[k + 1] * tx) * (1 - ty) + (MA[k + VNX] * (1 - tx) + MA[k + VNX + 1] * tx) * ty,
    (MC[k] * (1 - tx) + MC[k + 1] * tx) * (1 - ty) + (MC[k + VNX] * (1 - tx) + MC[k + VNX + 1] * tx) * ty];
}

/* 2. the scent, with exactly the physics home-scent.js runs (stored wind + eddies + gusts), on a 3 px grid */
const N = makeNoise(), PXF = U0 * CELL * SPF;                              // free wind, px a frame
const SC = 3, SA0 = -420, SA1 = 684, SNX = (SA1 - SA0) / SC, SNY = Math.round(LY / SC), SN = SNX * SNY, SC0 = -SNY * SC / 2;
const VG = 6, GNX = (SA1 - SA0) / VG + 1, GNY = SNY * SC / VG + 1;        // eddies worked out on a 6 px lattice, read bilinearly
const GA = new Float32Array(GNX * GNY), GCv = new Float32Array(GNX * GNY), GMa = new Float32Array(GNX * GNY), GMc = new Float32Array(GNX * GNY);
for (let j = 0; j < GNY; j++) for (let i = 0; i < GNX; i++) { const [wa, wc] = windAt(SA0 + i * VG, SC0 + j * VG); GMa[j * GNX + i] = wa * PXF; GMc[j * GNX + i] = wc * PXF; }
const T = { g: 1, a: 0, c: 0 };
let t = 0;
function buildVel() {
  for (let j = 0; j < GNY; j++) for (let i = 0; i < GNX; i++) {
    const k = j * GNX + i; turb(N, SA0 + i * VG, SC0 + j * VG, t, T);
    GA[k] = K * (T.g * GMa[k] + T.a * DT); GCv[k] = K * (T.g * GMc[k] + T.c * DT);
  }
}
let QA = 0, QC = 0;
function vel(a, c) {
  let fx = (a - SA0) / VG, fy = (c - SC0) / VG;
  if (fx < 0) fx = 0; else if (fx > GNX - 1.001) fx = GNX - 1.001;
  if (fy < 0) fy = 0; else if (fy > GNY - 1.001) fy = GNY - 1.001;
  const i0 = fx | 0, j0 = fy | 0, tx = fx - i0, ty = fy - j0, k = j0 * GNX + i0;
  QA = (GA[k] * (1 - tx) + GA[k + 1] * tx) * (1 - ty) + (GA[k + GNX] * (1 - tx) + GA[k + GNX + 1] * tx) * ty;
  QC = (GCv[k] * (1 - tx) + GCv[k + 1] * tx) * (1 - ty) + (GCv[k + GNX] * (1 - tx) + GCv[k + GNX + 1] * tx) * ty;
}
let C = new Float32Array(SN);
const HAT = new Float32Array(SN), MN = new Float32Array(SN), MX = new Float32Array(SN), RW = R + 2.5;
let SMN = 0, SMX = 0;
function sample(A, a, c, mm) {
  let fx = (a - SA0) / SC - .5, fy = (c - SC0) / SC - .5;
  if (fx < 0) { const v = inflow(N, c, t); SMN = SMX = v; return v; }
  if (fx > SNX - 1.001) fx = SNX - 1.001;
  if (fy < 0) fy = 0; else if (fy > SNY - 1.001) fy = SNY - 1.001;
  const i0 = fx | 0, j0 = fy | 0, tx = fx - i0, ty = fy - j0, k = j0 * SNX + i0;
  const p = A[k], q = A[k + 1], r = A[k + SNX], s = A[k + SNX + 1];
  if (mm) { SMN = Math.min(p, q, r, s); SMX = Math.max(p, q, r, s); }
  return (p * (1 - tx) + q * tx) * (1 - ty) + (r * (1 - tx) + s * tx) * ty;
}
const out = (a, c, Rr) => { const d2 = a * a + c * c; if (d2 >= Rr * Rr) return null; const d = Math.sqrt(d2) || 1; return [a / d * Rr, c / d * Rr]; };
function stepScent() {
  buildVel();
  for (let j = 0; j < SNY; j++) for (let i = 0; i < SNX; i++) {
    const k = j * SNX + i; let a = SA0 + (i + .5) * SC, c = SC0 + (j + .5) * SC;
    const o = out(a, c, RW); if (o) { const d = Math.hypot(o[0], o[1]); a = o[0] / d * (RW + SC); c = o[1] / d * (RW + SC); }
    vel(a, c); vel(a - QA * .5, c - QC * .5);
    let ba = a - QA, bc = c - QC; const ob = out(ba, bc, RW); if (ob) [ba, bc] = ob;
    HAT[k] = sample(C, ba, bc, true); MN[k] = SMN; MX[k] = SMX;
  }
  const C2 = new Float32Array(SN);
  for (let j = 0; j < SNY; j++) for (let i = 0; i < SNX; i++) {
    const k = j * SNX + i; let a = SA0 + (i + .5) * SC, c = SC0 + (j + .5) * SC;
    const o = out(a, c, RW); if (o) { const d = Math.hypot(o[0], o[1]); a = o[0] / d * (RW + SC); c = o[1] / d * (RW + SC); }
    vel(a, c); let fa = a + QA, fc = c + QC; const of = out(fa, fc, RW); if (of) [fa, fc] = of;
    let v = HAT[k] + .5 * (C[k] - sample(HAT, fa, fc, false)); if (v < MN[k]) v = MN[k]; else if (v > MX[k]) v = MX[k];
    C2[k] = v;
  }
  C = C2; t += DT * K;
}
const FR = 1300;
for (let f = 0; f < FR; f++) { stepScent(); if (f % 200 === 0) console.log('scent frame', f, ((Date.now() - t0) / 1000).toFixed(1) + ' s'); }

/* stored crop of the scent: a from -300 to 642, c from -321 to 321, 3 px, uint8 = 200 for full strength */
const PA0 = -300, PA1 = 642, PC0 = -321, PC1 = 321, PQ = 200;
const PNX = (PA1 - PA0) / SC, PNY = (PC1 - PC0) / SC, PB = new Uint8Array(PNX * PNY);
for (const [k, v] of Object.entries({ VNX, VNY, SNX, SNY, GNX, GNY, PNX, PNY })) if (!Number.isInteger(v)) throw new Error(`${k} is ${v}: every grid must be whole cells`);
if (!C.every(Number.isFinite)) throw new Error('the scent went NaN');
for (let j = 0; j < PNY; j++) for (let i = 0; i < PNX; i++) PB[j * PNX + i] = Math.max(0, Math.min(255, Math.round(sample(C, PA0 + (i + .5) * SC, PC0 + (j + .5) * SC, false) * PQ)));
const b64 = (u8) => deflateRawSync(Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength), { level: 9 }).toString('base64');
const json = { v: 1, about: 'home-scent.js: steady wind round the orb + a starting scent (scripts/bake-home-air.mjs)',
  wind: { a0: VA0, c0: VC0, nx: VNX, ny: VNY, d: CELL, q: Q, data: b64(new Uint8Array(VQ.buffer)) },
  scent: { a0: PA0, c0: PC0, nx: PNX, ny: PNY, d: SC, q: PQ, data: b64(PB) }, t };
writeFileSync(new URL('../public/holo/homeair-1.json', import.meta.url), JSON.stringify(json));
console.log('wrote public/holo/homeair-1.json', JSON.stringify(json).length, 'bytes', ((Date.now() - t0) / 1000).toFixed(1) + ' s');
