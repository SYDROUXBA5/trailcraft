/* Holograms for the set-up dial (Rémi, 23–24 Nov 2026).

   What is searched for, drawn as a hologram: a realistic model (made with an AI
   3D tool from a product photo, cleaned in Blender into an even quad mesh;
   trailcraft-vehicle-search/tools/holo_import.py) shown as a fine wire of light
   with its creases bright, a nearly clear glass body with scan contours, a band
   of light sweeping up it, all softly blooming, standing on a projector base
   (rings, ticks, turning arcs, a faint beam and motes rising in it). Every
   training aid is its own molecule, solid and shaded so its shape reads. People
   and dogs are never drawn: the dial shows their names.

   Loaded only when the dial opens — import('./holo.js') — and each model only
   the first time its answer comes up, so the app starts as fast as before;
   three.js is vendored at a pinned version. With Reduce Motion on, nothing
   spins, sweeps, rises or builds itself. */
import * as THREE from './vendor/three-0.187.0/three.module.js';

const ICE = new THREE.Color('#00E5FF');
const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion === 'off';   // the phone's setting, or the app's own
const fromB64 = (s, T) => { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return new T(u.buffer); };

/* kind: [file, size, 'max' (largest side) or 'y' (height), crease angle, contour spacing] */
const MODELS = {
  vehicle: ['holo/vehicle-2.json', 2.8, 'max', 70, 0.05], person: ['holo/person-1.json', 2.15, 'y', 50, 0.035],
  narcotics: ['holo/narcotics-2.json', 1.9, 'max', 70, 0.05], explosives: ['holo/explosives-2.json', 1.9, 'max', 30, 0.05],
  firearms: ['holo/firearms-2.json', 1.9, 'max', 70, 0.045], article: ['holo/article-2.json', 2.1, 'max', 70, 0.05],
  sport: ['holo/sport-2.json', 1.9, 'max', 70, 0.05], other: ['holo/other-2.json', 1.5, 'max', 70, 0.05],
};
const CAM_D = 6.25;
/* The dials every part of one hologram reads. Each hologram (the dial's, home's) has its own set. */
const dials = () => ({ uRes: { value: new THREE.Vector2(512, 512) }, uScan: { value: -9 }, uTime: { value: 0 }, uNear: { value: CAM_D - 1.4 }, uFar: { value: CAM_D + 1.4 },
  uFade: { value: 1 }, uCut: { value: 9 } });
/* Light only adds to the colour and leaves alpha alone; the last pass makes alpha from how bright it is. */
const ADD = { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
  blendEquationAlpha: THREE.AddEquation, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor };
/* Lines take the brightest of themselves and what is under them, so a dense wire reads as a fine mesh, never a glare. */
const MAX = { blending: THREE.CustomBlending, blendEquation: THREE.MaxEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
  blendEquationAlpha: THREE.MaxEquation, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor };

/* Lines of light: each edge a quad turned to face the screen, `width` px across, a white-hot core, an ice edge,
   brightest at the front, faint where hidden. Quads face whichever way their edge runs: both sides drawn. */
function fatLines(H, pairs, { width = 2.1, gain = 1, hidden = false, core = 1 } = {}) {
  const p = pairs.attributes.position.array, n = p.length / 6;
  const A = new Float32Array(n * 12), B = new Float32Array(n * 12), T = new Float32Array(n * 4), S = new Float32Array(n * 4), I = new Uint32Array(n * 6);
  for (let i = 0; i < n; i++) for (let k = 0; k < 4; k++) {
    const v = i * 4 + k;
    for (let c = 0; c < 3; c++) { A[v * 3 + c] = p[i * 6 + c]; B[v * 3 + c] = p[i * 6 + 3 + c]; }
    T[v] = k < 2 ? 0 : 1; S[v] = k % 2 ? 1 : -1;
    if (k === 0) I.set([v, v + 1, v + 2, v + 2, v + 1, v + 3], i * 6);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(A, 3)); g.setAttribute('aB', new THREE.BufferAttribute(B, 3));
  g.setAttribute('aT', new THREE.BufferAttribute(T, 1)); g.setAttribute('aS', new THREE.BufferAttribute(S, 1)); g.setIndex(new THREE.BufferAttribute(I, 1));
  return new THREE.Mesh(g, new THREE.ShaderMaterial({ transparent: true, depthWrite: false, depthTest: !hidden, side: THREE.DoubleSide, ...MAX,
    uniforms: { ...H, uWidth: { value: width }, uColor: { value: ICE }, uGain: { value: gain }, uCore: { value: core } },
    vertexShader: `attribute vec3 aB; attribute float aT; attribute float aS; uniform vec2 uRes; uniform float uWidth, uScan, uNear, uFar;
      varying float vS; varying float vFade; varying float vScan; varying float vY;
      void main() {
        vec4 wa = modelMatrix * vec4(position, 1.0), wb = modelMatrix * vec4(aB, 1.0);
        vec4 ca = projectionMatrix * viewMatrix * wa, cb = projectionMatrix * viewMatrix * wb;
        vec2 d = (cb.xy / cb.w - ca.xy / ca.w) * uRes; float L = length(d); vec2 dir = L > 1e-5 ? d / L : vec2(1.0, 0.0), nrm = vec2(-dir.y, dir.x);
        vec4 c = aT < 0.5 ? ca : cb; vec4 w = aT < 0.5 ? wa : wb;
        c.xy += (nrm * aS * uWidth + dir * (aT * 2.0 - 1.0) * uWidth * 0.6) / uRes * c.w;
        vS = aS; vY = w.y; vFade = clamp((-(viewMatrix * w).z - uNear) / (uFar - uNear), 0.0, 1.0);
        float q = (w.y - uScan) * 11.0; vScan = exp(-q * q); gl_Position = c; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uGain, uFade, uCut, uCore; varying float vS; varying float vFade; varying float vScan; varying float vY;
      void main() { if (vY > uCut) discard;
        float r = abs(vS), a = 1.0 - smoothstep(0.62, 1.0, r), core = 1.0 - smoothstep(0.15, 0.6, r);
        float qc = (vY - uCut) * 14.0, edge = exp(-qc * qc);            /* the line being drawn, while it builds */
        float k = mix(1.55, 0.38, vFade) + vScan * 1.6 + edge * 2.0;
        vec3 c = mix(uColor, vec3(0.80, 1.0, 1.0), clamp(vScan + edge + (1.0 - vFade) * 0.35, 0.0, 1.0));
        c = mix(c, vec3(1.0), core * (0.55 - 0.4 * vFade) * uCore);
        gl_FragColor = vec4(c * k * a * uGain * uFade, 0.0); }` }));
}

/* The body: nearly clear, a fresnel rim, scan contours that glow in the band's wake, brighter where it passes. */
const fill = (H, g, spacing) => new THREE.Mesh(g, new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, ...ADD,
  uniforms: { ...H, uC: { value: ICE }, uSp: { value: spacing } },
  vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vW;
    void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - w.xyz);
      gl_Position = projectionMatrix * viewMatrix * w; }`,
  fragmentShader: `uniform vec3 uC; uniform float uSp, uScan, uFade, uCut; varying vec3 vN; varying vec3 vV; varying vec3 vW;
    void main() { if (vW.y > uCut) discard;
      float f = pow(max(1.0 - abs(dot(normalize(vN), vV)), 0.0), 2.6);   /* never a negative base: pow() of one is NaN, and the blur spreads a NaN pixel into a square */
      float d = abs(fract(vW.y / uSp) - 0.5) * uSp, w = fwidth(vW.y); float line = 1.0 - smoothstep(w * 0.4, w * 1.6, uSp * 0.5 - d);
      float qb = (vW.y - uScan) * 9.0, band = exp(-qb * qb), above = smoothstep(uScan + 0.02, uScan - 0.25, vW.y);
      float trail = smoothstep(uScan - 0.55, uScan, vW.y) * above;
      float k = 0.012 + 0.34 * f + line * (0.012 + 0.10 * f + 0.55 * trail) + band * 0.16;
      gl_FragColor = vec4(uC * k * uFade, 0.0); }` }));

/* The projector it stands on: rings, ticks, three turning arcs, a faint beam and motes rising in it. */
function base(H) {
  const grp = new THREE.Group(), mat = (op) => new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, ...ADD,
    uniforms: { ...H, uC: { value: ICE }, uOp: { value: op } }, vertexShader: `void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 uC; uniform float uOp, uFade; void main() { gl_FragColor = vec4(uC * uOp * uFade, 0.0); }` });
  const flat = (geo, op, into = grp) => { const m = new THREE.Mesh(geo, mat(op)); m.rotation.x = -Math.PI / 2; into.add(m); return m; };
  flat(new THREE.RingGeometry(1.0, 1.025, 128), 0.85); flat(new THREE.RingGeometry(0.80, 0.81, 128), 0.45); flat(new THREE.CircleGeometry(1.0, 96), 0.05);
  const arcs = new THREE.Group(); grp.add(arcs);
  for (let i = 0; i < 3; i++) flat(new THREE.RingGeometry(0.86, 0.905, 64, 1, i * 2.094, 1.25), 0.55, arcs);
  const t = [];
  for (let a = 0; a < 360; a += 6) { const big = a % 30 === 0, r0 = big ? 1.05 : 1.065, r1 = big ? 1.14 : 1.10, c = Math.cos(a * Math.PI / 180), s = Math.sin(a * Math.PI / 180);
    t.push(r0 * c, 0, r0 * s, r1 * c, 0, r1 * s); }
  const tg = new THREE.BufferGeometry(); tg.setAttribute('position', new THREE.Float32BufferAttribute(t, 3));
  grp.add(fatLines(H, tg, { width: 1.3, gain: 0.7 }));
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.08, 0.99, 1, 96, 1, true), new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, ...ADD,
    uniforms: { ...H, uC: { value: ICE } }, vertexShader: `varying float vY; void main() { vY = uv.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 uC; uniform float uFade; varying float vY; void main() { float k = 1.0 - vY; gl_FragColor = vec4(uC * 0.11 * k * k * uFade, 0.0); }` }));
  grp.add(beam);
  const N = 70, P = new Float32Array(N * 3), seed = new Float32Array(N);
  for (let i = 0; i < N; i++) { const r = Math.sqrt(Math.random()) * 0.95, a = Math.random() * 6.283; P[i * 3] = r * Math.cos(a); P[i * 3 + 2] = r * Math.sin(a); seed[i] = Math.random(); }
  const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(P, 3)); pg.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const uH = { value: 1 };
  grp.add(new THREE.Points(pg, new THREE.ShaderMaterial({ transparent: true, depthWrite: false, ...ADD, uniforms: { ...H, uH, uC: { value: ICE } },
    vertexShader: `attribute float aSeed; uniform float uTime, uH; varying float vA;
      void main() { float k = fract(aSeed * 7.3 + uTime * (0.06 + 0.08 * aSeed)); vec3 p = position; p.y = k * uH;
        vA = smoothstep(0.0, 0.12, k) * (1.0 - smoothstep(0.55, 1.0, k)); vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = (2.0 + 2.5 * aSeed) * (6.25 / -mv.z); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uC; uniform float uFade; varying float vA;
      void main() { float a = smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5)); gl_FragColor = vec4(mix(uC, vec3(1.0), 0.4) * a * vA * 0.9 * uFade, 0.0); }` })));
  /* Stand it under something `h` tall. */
  grp.userData = { arcs, fit(y0, h) { grp.position.y = y0; beam.scale.y = h + 0.25; beam.position.y = (h + 0.25) / 2; uH.value = h + 0.25; } };
  return grp;
}

/* The model: its wire (when it has one) faint over the surface, its creases bright, its glass body, hidden lines faint. */
function hologram(H, j, [, size, axis, angle, spacing], kind) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(fromB64(j.pos, Float32Array), 3)); g.setAttribute('normal', new THREE.BufferAttribute(fromB64(j.nor, Float32Array), 3));
  g.setIndex(new THREE.BufferAttribute(fromB64(j.idx, j.u32 ? Uint32Array : Uint16Array), 1));
  g.computeBoundingBox(); const s = new THREE.Vector3(); g.boundingBox.getSize(s);
  const k = size / (axis === 'max' ? Math.max(s.x, s.y, s.z) : s[axis]); g.scale(k, k, k); g.computeBoundingBox();
  const c = new THREE.Vector3(); g.boundingBox.getCenter(c); g.translate(-c.x, -c.y, -c.z); g.computeBoundingBox();
  const grp = new THREE.Group(), edges = new THREE.EdgesGeometry(g, angle);
  const depth = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ colorWrite: false, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 }));
  const body = fill(H, g, spacing), hid = fatLines(H, edges, { width: 1.1, gain: 0.16, hidden: true });
  const lines = fatLines(H, edges, { width: kind === 'person' ? 1.3 : 2.1, gain: kind === 'person' ? 0.45 : 1.3 });
  depth.renderOrder = 0; body.renderOrder = 1; hid.renderOrder = 2; lines.renderOrder = 3;
  grp.add(depth, body, hid, lines);
  if (j.wire) {
    const w = new THREE.BufferGeometry(); w.setAttribute('position', g.attributes.position);
    w.setIndex(new THREE.BufferAttribute(fromB64(j.wire, j.u32 ? Uint32Array : Uint16Array), 1));
    const wire = fatLines(H, w.toNonIndexed(), { width: 1.0, gain: 0.36, core: 0.15 });      // a fine ice wire, no white core to glare wire.renderOrder = 3; grp.add(wire);
  }
  grp.userData = { min: g.boundingBox.min.y, max: g.boundingBox.max.y };
  return grp;
}

/* Molecules: solid, lit and shaded, unchanged. They write alpha, so they stay solid over the orb. */
const VS = `varying vec3 vN; varying vec3 vV; varying vec3 vW;
  void main() {
    #ifdef USE_INSTANCING
      vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
      vN = normalize(normalMatrix * mat3(instanceMatrix) * normal);
    #else
      vec4 w = modelMatrix * vec4(position, 1.0);
      vN = normalize(normalMatrix * normal);
    #endif
    vW = w.xyz; vec4 mv = viewMatrix * w; vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`;
const MFS = `uniform float uTime, uOpacity, uReveal, uMinY, uMaxY, uScan; uniform vec3 uColor;
  varying vec3 vN; varying vec3 vV; varying vec3 vW;
  void main() {
    float cut = mix(uMinY - .05, uMaxY + .05, uReveal); if (vW.y > cut) discard;
    vec3 n = normalize(vN), v = normalize(vV), l = normalize(vec3(.45, .8, .55));
    float diff = max(dot(n, l), 0.0), fr = pow(max(1.0 - dot(n, v), 0.0), 2.6);   /* dot can round past 1 where a ball faces the camera: a negative base is NaN, a white square once blurred */
    float spec = pow(max(dot(reflect(-l, n), v), 0.0), 28.0);
    float scan = mix(1.0, .88 + .12 * step(.5, fract(vW.y * 26.0 - uTime * 1.3)), uScan);
    float band = smoothstep(.14, .0, abs(vW.y - cut)) * (1.0 - step(.999, uReveal));
    vec3 col = uColor * (.18 + .82 * diff) * scan + vec3(1.0) * spec * .55 + mix(uColor, vec3(1.0), .3) * fr * .75 + vec3(.6, 1.0, 1.0) * band * .6;
    gl_FragColor = vec4(col * uOpacity, uOpacity); }`;
const solidMat = (color) => new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: MFS, transparent: true, depthWrite: true,
  blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  uniforms: { uTime: { value: 0 }, uOpacity: { value: 1 }, uReveal: { value: 1 }, uMinY: { value: -1 }, uMaxY: { value: 1 }, uScan: { value: still() ? 0 : 1 }, uColor: { value: new THREE.Color(color) } } });
const COL = { C: ['#18D8F2', .15], N: ['#3F7BFF', .17], O: ['#E6FDFF', .17], Cl: ['#7DFFC8', .2], K: ['#B794FF', .24], P: ['#FFC266', .2], S: ['#FFE066', .2], Na: ['#FFB38A', .23] };
const molecule = (m) => {
  const g = new THREE.Group(), P = m.atoms.map(a => new THREE.Vector3(...a.p)), rad = Math.max(.8, ...P.map(p => p.length())), k = 1.28 / rad, mats = [];
  P.forEach(p => p.multiplyScalar(k));
  for (const [el, [col, r]] of Object.entries(COL)) {
    const idx = m.atoms.map((a, i) => a.e === el ? i : -1).filter(i => i >= 0); if (!idx.length) continue;
    const mat = solidMat(col); mats.push(mat);
    const im = new THREE.InstancedMesh(new THREE.SphereGeometry(r, 28, 20), mat, idx.length), M = new THREE.Matrix4();
    idx.forEach((i, n) => { M.makeTranslation(P[i].x, P[i].y, P[i].z); im.setMatrixAt(n, M); }); g.add(im);
  }
  const rods = [], up = new THREE.Vector3(0, 1, 0);
  for (const [a, b, o] of m.bonds) { const d = new THREE.Vector3().subVectors(P[b], P[a]), len = d.length(), mid = P[a].clone().add(P[b]).multiplyScalar(.5);
    const q = new THREE.Quaternion().setFromUnitVectors(up, d.clone().normalize());
    const side = new THREE.Vector3().crossVectors(d, new THREE.Vector3(0, 0, 1)).normalize().multiplyScalar(.06);
    (o === 2 ? [side, side.clone().negate()] : [new THREE.Vector3()]).forEach(off => rods.push({ pos: mid.clone().add(off), q, len, r: o === 2 ? .032 : .05 })); }
  if (rods.length) { const bm = solidMat('#8FDCEB'); mats.push(bm);
    const ib = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 14), bm, rods.length), M = new THREE.Matrix4();
    rods.forEach((r, n) => { M.compose(r.pos, r.q, new THREE.Vector3(r.r, r.len, r.r)); ib.setMatrixAt(n, M); }); g.add(ib); }
  /* However it turns, no atom leaves this ball: its reveal sweeps the whole of
     it, so the line that draws it in never stays behind as a ceiling. */
  const reach = 1.28 + Math.max(...m.atoms.map(a => (COL[a.e] || [, .2])[1]));
  g.userData = { mats, mol: true, reach }; return g;
};

/* Bloom: the frame blurred twice at half size and twice at quarter size, added back over itself; alpha from brightness. */
const QV = `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const blurMat = new THREE.ShaderMaterial({ uniforms: { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } }, vertexShader: QV,
  fragmentShader: `uniform sampler2D tSrc; uniform vec2 uDir; varying vec2 vUv;
    void main() { vec3 c = texture2D(tSrc, vUv).rgb * 0.2270;
      c += (texture2D(tSrc, vUv + uDir * 1.3846).rgb + texture2D(tSrc, vUv - uDir * 1.3846).rgb) * 0.3162;
      c += (texture2D(tSrc, vUv + uDir * 3.2308).rgb + texture2D(tSrc, vUv - uDir * 3.2308).rgb) * 0.0703; gl_FragColor = vec4(c, 1.0); }` });
const mixMat = new THREE.ShaderMaterial({ uniforms: { tA: { value: null }, tB: { value: null }, tC: { value: null } }, vertexShader: QV,
  fragmentShader: `uniform sampler2D tA, tB, tC; varying vec2 vUv;
    void main() { vec4 s = texture2D(tA, vUv); vec3 c = s.rgb + texture2D(tB, vUv).rgb * 0.75 + texture2D(tC, vUv).rgb * 0.7;
      c = min(c, vec3(1.0)); float a = max(s.a, max(c.r, max(c.g, c.b)));
      gl_FragColor = vec4(c, a); }` });

/** A hologram in `host` (a square `size` px). show(kind): 'person', 'vehicle',
    'narcotics', 'explosives', 'firearms', 'article', 'sport', 'other',
    'mol:<odour name as the app lists it>', or null. dial(deg) turns it with the dial. */
export async function createHolo(host, size) {
  const mols = await fetch('holo/molecules-2.json').then(r => { if (!r.ok) throw new Error('molecules'); return r.json(); });
  const models = {};          // each model fetched the first time it is wanted
  const load = (kind) => (models[kind] ??= fetch(MODELS[kind][0]).then(r => { if (!r.ok) throw new Error(kind); return r.json(); }));
  const px = Math.round(size * Math.min(2, devicePixelRatio || 1));
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(1); renderer.setSize(px, px, false); renderer.setClearColor(0x000000, 0);
  Object.assign(renderer.domElement.style, { width: size + 'px', height: size + 'px' });
  host.appendChild(renderer.domElement);
  const H = dials(); H.uRes.value.set(px, px);
  const rt = (s) => new THREE.WebGLRenderTarget(s, s, { type: THREE.HalfFloatType });     // one sample: a multisampled target lost what lay outside the beam
  const RT = rt(px), H1 = rt(px >> 1), H2 = rt(px >> 1), Q1 = rt(px >> 2), Q2 = rt(px >> 2);
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), blurMat), quadScene = new THREE.Scene(); quadScene.add(quad);
  const pass = (src, dst, dx, dy) => { quad.material = blurMat; blurMat.uniforms.tSrc.value = src.texture; blurMat.uniforms.uDir.value.set(dx, dy); renderer.setRenderTarget(dst); renderer.render(quadScene, quadCam); };

  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(30, 1, .1, 50);
  /* A little from above, so a flat thing (a wallet, a tin) reads; far enough back that it stays inside the circle as it turns. */
  camera.position.set(0, 2.05, 5.9); camera.lookAt(0, -0.05, 0);
  const stage = new THREE.Group(), pad = base(H); scene.add(stage, pad); pad.visible = false;

  const draw = () => {
    renderer.setRenderTarget(RT); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.render(scene, camera);
    const h = 1 / (px >> 1), q = 1 / (px >> 2);
    pass(RT, H1, h, 0); pass(H1, H2, 0, h); pass(H2, H1, h * 2, 0); pass(H1, H2, 0, h * 2);
    pass(H2, Q1, q, 0); pass(Q1, Q2, 0, q); pass(Q2, Q1, q * 2, 0); pass(Q1, Q2, 0, q * 2);
    quad.material = mixMat; mixMat.uniforms.tA.value = RT.texture; mixMat.uniforms.tB.value = H2.texture; mixMat.uniforms.tC.value = Q2.texture;
    renderer.setRenderTarget(null); renderer.clear(); renderer.render(quadScene, quadCam);
  };
  let cur = null, curKind, dialDeg = 0, spin = 0, run = false, raf = 0, last = performance.now(), t0 = last;
  const setU = (o, u, v) => o?.userData.mats?.forEach(m => { m.uniforms[u].value = v; });
  const tween = (ms, f) => new Promise(res => { if (still()) { f(1); return res(); } const s = performance.now();
    const step = (t) => { const k = Math.min(1, (t - s) / ms); f(k); if (!run) draw(); k < 1 ? requestAnimationFrame(step) : res(); }; requestAnimationFrame(step); });
  const frame = (t) => {
    const dt = Math.min(.05, (t - last) / 1000); last = t; const time = (t - t0) / 1000, calm = still();
    if (!calm) spin += dt * .55;
    stage.rotation.y = (calm ? .75 : .75 + spin) + dialDeg * Math.PI / 180 * 2.2;
    H.uTime.value = calm ? 2 : time; pad.userData.arcs.rotation.y = calm ? 0 : -time * .35;
    if (cur?.userData.mol) { setU(cur, 'uTime', time); if (!calm) { cur.rotation.x = Math.sin(time * .7) * .25; cur.rotation.z = Math.cos(time * .5) * .12; } }
    else if (cur) { const { min, max } = cur.userData; H.uScan.value = calm ? -9 : min - .15 + ((time * .42) % 1) * (max - min + .3); }
    draw(); if (run) raf = requestAnimationFrame(frame);
  };
  const api = {
    info: (name) => mols[name] ? { formula: mols[name].formula, what: mols[name].what } : null,
    async show(kind) {
      if (kind === curKind) return; curKind = kind;
      const old = cur; cur = null;
      if (old) {
        await tween(180, k => { if (old.userData.mol) setU(old, 'uOpacity', 1 - k); else H.uFade.value = 1 - k; });
        stage.remove(old); pad.visible = false;
      }
      if (kind !== curKind) return;
      let obj = null;
      if (kind?.startsWith('mol:')) { const m = mols[kind.slice(4)]; obj = m ? molecule(m) : null; }
      else if (MODELS[kind]) { const j = await load(kind).catch(() => null); if (kind !== curKind) return; obj = j && hologram(H, j, MODELS[kind], kind); }
      if (!obj) { draw(); return; }
      stage.add(obj); cur = obj;
      if (obj.userData.mol) {
        const r = obj.userData.reach;              // the ball it turns in, not the shape it starts in
        setU(obj, 'uMinY', -r); setU(obj, 'uMaxY', r); setU(obj, 'uReveal', 0);
        await tween(650, k => setU(obj, 'uReveal', 1 - (1 - k) ** 3));
      } else {
        /* It builds from the base up, a bright line drawing it, on its projector. */
        const { min, max } = obj.userData; pad.userData.fit(min - .05, max - min); pad.visible = true;
        H.uFade.value = 1; H.uCut.value = min - .05;
        await tween(750, k => { H.uCut.value = min - .05 + (max - min + .3) * (1 - (1 - k) ** 3); });
        H.uCut.value = 9;
      }
      if (!run) draw();
    },
    dial(deg) { dialDeg = deg; },
    start() { if (run) return; run = true; last = performance.now(); raf = requestAnimationFrame(frame); },
    stop() { run = false; cancelAnimationFrame(raf); },
  };
  return api;
}
