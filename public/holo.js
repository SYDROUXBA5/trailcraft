/* Holograms for the set-up dial (Rémi, 23 Nov 2026): the thing searched for and
   the vehicle drawn in ice light (a fresnel rim, scan lines, a slight flicker),
   and every training aid as its own molecule, solid and shaded so its shape
   reads. People and dogs are never drawn: the dial shows their names.

   Loaded only when the dial opens — import('./holo.js') — so the app starts as
   fast as before; three.js is vendored at a pinned version. The meshes and the
   molecules are small JSON files made from scans and from each odour's SMILES
   (trailcraft-vehicle-search/tools/holo_geometry.py and make_odour_molecules.py).
   With Reduce Motion on, nothing spins, flickers or builds itself. */
import * as THREE from './vendor/three-0.187.0/three.module.js';

const ICE = new THREE.Color('#00E5FF');
const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion === 'off';   // the phone's setting, or the app's own

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
/* Light: see-through, brightest at the rim. */
const FS = `uniform float uTime, uOpacity, uReveal, uMinY, uMaxY, uBase, uScan; uniform vec3 uColor;
  varying vec3 vN; varying vec3 vV; varying vec3 vW;
  void main() {
    float cut = mix(uMinY - .05, uMaxY + .05, uReveal); if (vW.y > cut) discard;
    float fr = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.0);
    float scan = mix(1.0, .5 + .5 * step(.45, fract(vW.y * 24.0 - uTime * 1.3)), uScan);
    float band = smoothstep(.14, .0, abs(vW.y - cut)) * (1.0 - step(.999, uReveal));
    float flick = 1.0 - uScan * .07 * (1.0 - sin(uTime * 41.0) * sin(uTime * 17.0));
    float a = ((uBase + fr * .95) * scan * flick + band * .45) * uOpacity;
    gl_FragColor = vec4(uColor * (.55 + fr * 1.35) + vec3(.55, 1.0, 1.0) * band * .45, a); }`;
/* Solid: lit and shaded, for molecules. */
const MFS = `uniform float uTime, uOpacity, uReveal, uMinY, uMaxY, uBase, uScan; uniform vec3 uColor;
  varying vec3 vN; varying vec3 vV; varying vec3 vW;
  void main() {
    float cut = mix(uMinY - .05, uMaxY + .05, uReveal); if (vW.y > cut) discard;
    vec3 n = normalize(vN), v = normalize(vV), l = normalize(vec3(.45, .8, .55));
    float diff = max(dot(n, l), 0.0), fr = pow(1.0 - max(dot(n, v), 0.0), 2.6);
    float spec = pow(max(dot(reflect(-l, n), v), 0.0), 28.0);
    float scan = mix(1.0, .88 + .12 * step(.5, fract(vW.y * 26.0 - uTime * 1.3)), uScan);
    float band = smoothstep(.14, .0, abs(vW.y - cut)) * (1.0 - step(.999, uReveal));
    vec3 col = uColor * (.18 + .82 * diff) * scan + vec3(1.0) * spec * .55 + mix(uColor, vec3(1.0), .3) * fr * .75 + vec3(.6, 1.0, 1.0) * band * .6;
    gl_FragColor = vec4(col, uOpacity); }`;
const uniforms = (color, base) => ({ uTime: { value: 0 }, uOpacity: { value: 1 }, uReveal: { value: 1 }, uMinY: { value: -1 }, uMaxY: { value: 1 },
  uBase: { value: base }, uScan: { value: still() ? 0 : 1 }, uColor: { value: new THREE.Color(color) } });
const lightMat = (color = ICE, base = .17) => new THREE.ShaderMaterial({ uniforms: uniforms(color, base), vertexShader: VS, fragmentShader: FS,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
const solidMat = (color) => new THREE.ShaderMaterial({ uniforms: uniforms(color, 0), vertexShader: VS, fragmentShader: MFS,
  transparent: true, depthWrite: true, blending: THREE.NormalBlending });

const fromB64 = (s, T) => { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return new T(u.buffer); };
const meshOf = (j) => { const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(fromB64(j.pos, Float32Array), 3)); g.setAttribute('normal', new THREE.BufferAttribute(fromB64(j.nor, Float32Array), 3));
  g.setIndex(new THREE.BufferAttribute(fromB64(j.idx, j.u32 ? Uint32Array : Uint16Array), 1)); return g; };
/* Stand it on the ring, its largest side (or its height) = size. */
const fit = (obj, size, axis = 'y') => {
  const b = new THREE.Box3().setFromObject(obj), s = new THREE.Vector3(); b.getSize(s);
  obj.scale.multiplyScalar(size / (axis === 'max' ? Math.max(s.x, s.y, s.z) : s[axis]));
  const b2 = new THREE.Box3().setFromObject(obj), c = new THREE.Vector3(); b2.getCenter(c);
  obj.position.x -= c.x; obj.position.z -= c.z; obj.position.y += -1.02 - b2.min.y; return obj;
};
const lit = (geos, base) => { const g = new THREE.Group(), mats = [];
  for (const geo of geos) { const m = lightMat(ICE, base); mats.push(m); g.add(geo.isObject3D ? (geo.material = m, geo) : new THREE.Mesh(geo, m)); }
  g.userData.mats = mats; return g; };
const prim = (kind) => {
  const M = (geo, x = 0, y = 0, z = 0, rz = 0) => { const m = new THREE.Mesh(geo); m.position.set(x, y, z); m.rotation.z = rz; return m; };
  if (kind === 'narcotics') return [M(new THREE.CapsuleGeometry(.36, .9, 12, 32), -.15, .25, 0, .8), M(new THREE.CapsuleGeometry(.22, .5, 10, 24), .55, -.45, .2, -.5)];
  if (kind === 'firearms') return [M(new THREE.CylinderGeometry(.28, .28, 1.2, 32)), M(new THREE.ConeGeometry(.26, .55, 32), 0, .87), M(new THREE.CylinderGeometry(.31, .31, .12, 32), 0, -.62)];
  if (kind === 'explosives') return [-.36, 0, .36].map(x => M(new THREE.CylinderGeometry(.17, .17, 1.4, 24), x)).concat([M(new THREE.TorusGeometry(.62, .05, 10, 40), 0, .3, 0, Math.PI / 2)]);
  if (kind === 'article') return [M(new THREE.BoxGeometry(1.4, .9, .9)), M(new THREE.TorusGeometry(.28, .05, 10, 30, Math.PI), 0, .45)];
  if (kind === 'sport') { const d = M(new THREE.SphereGeometry(.55, 32, 24), 0, -.1); d.scale.y = 1.25; return [d, M(new THREE.ConeGeometry(.42, .7, 32), 0, .78)]; }
  return [M(new THREE.IcosahedronGeometry(.8, 1))];
};
const COL = { C: ['#18D8F2', .15], N: ['#3F7BFF', .17], O: ['#E6FDFF', .17], Cl: ['#7DFFC8', .2], K: ['#B794FF', .24], P: ['#FFC266', .2], S: ['#FFE066', .2] };
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
  g.position.y = .25; g.userData.mats = mats; g.userData.mol = true; return g;
};

/** A hologram in `host` (a square `size` px). show(kind): 'person', 'vehicle',
    'narcotics', 'explosives', 'firearms', 'article', 'sport', 'other',
    'mol:<odour name as the app lists it>', or null. dial(deg) turns it with the dial. */
export async function createHolo(host, size) {
  const [person, pickup, mols] = await Promise.all(['holo/person-1.json', 'holo/pickup-1.json', 'holo/molecules-1.json']
    .map(u => fetch(u).then(r => { if (!r.ok) throw new Error(u); return r.json(); })));
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, premultipliedAlpha: false });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1)); renderer.setSize(size, size); renderer.setClearColor(0x000000, 0);
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(30, 1, .1, 50);
  camera.position.set(0, .22, 5.8); camera.lookAt(0, .06, 0);
  const ring = new THREE.Mesh(new THREE.RingGeometry(.69, .74, 96), new THREE.MeshBasicMaterial({ color: ICE, transparent: true, opacity: .8, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = -1.08; scene.add(ring);
  const stage = new THREE.Group(); scene.add(stage);
  const personGeo = meshOf(person), pickupGeo = meshOf(pickup);
  const make = (kind) => {
    if (kind === 'person') return fit(lit([personGeo], .17), 2.15);
    if (kind === 'vehicle') return fit(lit([pickupGeo], .19), 2.9, 'max');
    if (kind?.startsWith('mol:')) { const m = mols[kind.slice(4)]; return m ? molecule(m) : null; }
    if (['narcotics', 'explosives', 'firearms', 'article', 'sport', 'other'].includes(kind)) return fit(lit(prim(kind), .2), 1.9, 'max');
    return null;
  };
  let cur = null, curKind, dialDeg = 0, spin = 0, run = false, raf = 0, last = performance.now(), t0 = last;
  const setU = (o, u, v) => o && o.userData.mats.forEach(m => { m.uniforms[u].value = v; });
  const tween = (ms, f) => new Promise(res => { if (still()) { f(1); return res(); } const s = performance.now();
    const step = (t) => { const k = Math.min(1, (t - s) / ms); f(k); k < 1 ? requestAnimationFrame(step) : res(); }; requestAnimationFrame(step); });
  const draw = () => renderer.render(scene, camera);
  const frame = (t) => {
    const dt = Math.min(.05, (t - last) / 1000); last = t; const time = (t - t0) / 1000, calm = still();
    if (!calm) spin += dt * .55;
    stage.rotation.y = (calm ? .5 : spin) + dialDeg * Math.PI / 180 * 2.2;
    if (cur) { setU(cur, 'uTime', time); if (cur.userData.mol && !calm) { cur.rotation.x = Math.sin(time * .7) * .25; cur.rotation.z = Math.cos(time * .5) * .12; } }
    ring.material.opacity = calm ? .7 : .62 + .2 * Math.sin(time * 3);
    draw(); if (run) raf = requestAnimationFrame(frame);
  };
  const api = {
    info: (name) => mols[name] ? { formula: mols[name].formula, what: mols[name].what } : null,
    async show(kind) {
      if (kind === curKind) return; curKind = kind;
      const old = cur; cur = null;
      if (old) { await tween(180, k => setU(old, 'uOpacity', 1 - k)); stage.remove(old); }
      if (kind !== curKind) return;
      const obj = make(kind); if (!obj) { draw(); return; }
      const b = new THREE.Box3().setFromObject(obj);
      setU(obj, 'uMinY', b.min.y); setU(obj, 'uMaxY', b.max.y); setU(obj, 'uReveal', 0); stage.add(obj); cur = obj;
      await tween(650, k => setU(obj, 'uReveal', 1 - (1 - k) ** 3));
      if (!run) draw();
    },
    dial(deg) { dialDeg = deg; },
    start() { if (run) return; run = true; last = performance.now(); raf = requestAnimationFrame(frame); },
    stop() { run = false; cancelAnimationFrame(raf); },
  };
  return api;
}
