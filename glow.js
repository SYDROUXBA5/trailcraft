/* ─────────────────────────────────────────────────────────────────────
   glow.js — the scent plume drawn as light, with height.

   The same parcels the model already carries (sim.js), drawn the way the
   3D scent engine draws them instead of as specks on the ground: each
   parcel adds a soft patch of scent into a picture of its own, and that
   picture is then turned into light — thin scent a dim violet-red, thick
   scent amber, the core pale and hot. Adding first and colouring second is
   what stops a dense plume burning out to a flat blob.

   HEIGHT IS ILLUSTRATIVE. The model is flat: it knows where a parcel is on
   the map, not how high. Height is added here from the stability the app
   already works out, so the picture can show what the words say — scent
   lifting over warm ground, lying low over cold ground. It is drawn at the
   map's own terrain exaggeration so it sits on the hills as they are shown.

   The same layer also draws the SCENT REACH (reach.js): the ground the
   dog's nose could have smelled from where it walked, as two flat bands on
   the ground under the wind and the scent.

   One Mapbox custom layer. No three.js: a few small shaders and buffers.
   ───────────────────────────────────────────────────────────────────── */

const CIRC = 40075016.686;                        // metres round the equator
const mercX = (lon) => (180 + lon) / 360;
const mercY = (lat) => (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360))) / 360;

const SPRITE_VS = `#version 300 es
in vec3 aPos;                 // east, north, up from the plume's own origin, metres
in vec4 aK;                   // weight, freshness, size in metres, how lifted (0..1)
uniform mat4 uM;
uniform vec2 uView;           // size of the picture being drawn into, pixels
uniform float uCap;           // largest point this device will draw
out vec3 vAcc;
void main(){
  vec4 a = uM * vec4(aPos, 1.0), b = uM * vec4(aPos + vec3(aK.z, 0.0, 0.0), 1.0);
  float px = length((b.xy / b.w - a.xy / a.w) * uView * 0.5) * 2.0;        // how many pixels across this parcel is, from here
  float pxc = clamp(px, 2.0, uCap);
  gl_Position = a.w > 0.0 ? a : vec4(2.0, 2.0, 2.0, 1.0);
  gl_PointSize = pxc;
  /* a parcel carries a fixed amount of scent: spread wider it is thinner, and one too small or too big to draw at its true size is dimmed to match */
  float w = aK.x * min(px / pxc, pxc / px) * min(px / pxc, pxc / px) / pow(max(aK.z, 0.5), 1.3);
  vAcc = vec3(w, w * aK.y, w * aK.w);
}`;
const SPRITE_FS = `#version 300 es
precision highp float;
in vec3 vAcc;
out vec4 o;
void main(){
  vec2 d = gl_PointCoord - 0.5; float r2 = dot(d, d) * 4.0;
  if (r2 > 1.0) discard;
  o = vec4(vAcc * max(0.0, exp(-r2 * 3.2) - 0.0408), 1.0);
}`;
const QUAD_VS = `#version 300 es
in vec2 aP; out vec2 vUv;
void main(){ vUv = aP * 0.5 + 0.5; gl_Position = vec4(aP, 0.0, 1.0); }`;
/* The colours and the curve are the scent engine's own (its "glow" look). */
const QUAD_FS = `#version 300 es
precision highp float;
uniform sampler2D uT;
uniform float uK, uGain;
uniform vec3 uTail, uEmber, uAmber, uHot, uLoft;   // the colours, thin to thick (the trail's own, or a contamination person's)
in vec2 vUv; out vec4 o;
void main(){
  vec3 s = texture(uT, vUv).rgb; float d = s.r;
  if (d < 1e-5) discard;
  float fresh = clamp(s.g / d, 0.0, 1.0), loft = clamp(s.b / d, 0.0, 1.0);
  float L = 1.0 - exp(-pow(d * uK, 0.62));                 // how much of the view the scent fills, with the thin edge kept visible
  float t = clamp(0.35 * fresh + 0.45 * L + 0.2 * L * L, 0.0, 1.0);
  vec3 tail = uTail, ember = uEmber, amber = uAmber, hot = uHot;
  vec3 col = mix(tail, ember, smoothstep(0.02, 0.26, t));
  col = mix(col, amber, smoothstep(0.24, 0.56, t));
  col = mix(col, hot, smoothstep(0.66, 1.0, t));
  col = mix(col, uLoft, loft * 0.45);                       // lifted into the light
  vec3 glow = pow(col * (L * 0.98 + pow(L, 12.0) * 0.35), vec3(0.72)) * uGain;
  o = vec4(glow, 0.42 * L);                                  // the map under thick scent is dimmed a little, as in the engine
}`;

/* The wind, as hairlines. Each stroke is a short chain of pieces; a piece is a thin four-cornered strip between two points
   on the stroke's path, widened on screen so it stays a hairline whatever the zoom. */
const WIND_VS = `#version 300 es
in vec2 aC;                   // which corner of the strip: x 0 at its tail end, 1 at its head end; y -1 / +1 across it
in vec3 iA;                   // the tail end, metres from the origin
in vec3 iB;                   // the head end
in vec3 iT;                   // how far along the whole stroke each end is (0 tail, 1 head), and the stroke's strength
uniform mat4 uM;
uniform vec2 uView;           // drawing size, pixels
uniform float uW, uRefW;      // half-width in pixels; how far away the middle of the view is
out vec2 vE;
out float vA;
void main(){
  vec4 a = uM * vec4(iA, 1.0), b = uM * vec4(iB, 1.0), p = mix(a, b, aC.x);
  vec2 d = (b.xy / b.w - a.xy / a.w) * uView; float l = length(d);
  vec2 n = l > 1e-3 ? vec2(-d.y, d.x) / l : vec2(0.0, 1.0);
  float t = mix(iT.x, iT.y, aC.x), near = clamp(uRefW / p.w, 0.45, 1.6);      // nearer strokes a little wider, far ones finer
  p.xy += n * aC.y * uW * near * (0.5 + 0.5 * t) * 2.0 / uView * p.w;             // and each tapers toward its tail
  gl_Position = (a.w > 0.0 && b.w > 0.0) ? p : vec4(2.0, 2.0, 2.0, 1.0);
  vE = vec2(aC.y, t); vA = iT.z * sqrt(near);
}`;
const WIND_FS = `#version 300 es
precision highp float;
uniform vec3 uCol;
in vec2 vE; in float vA; out vec4 o;
void main(){
  float a = (1.0 - smoothstep(0.25, 1.0, abs(vE.x))) * vE.y * vE.y * vA;       // soft at the edges, fading smoothly from head to tail
  o = vec4(uCol * a, a);
}`;

/* Scent reach: the ground a dog's nose could have smelled (reach.js). Each piece is a strip of ground lying flat, from
   one point to the next, as wide and as strong as the reach is at each end. Pieces are not added together: the strongest
   one at each spot is kept, because standing in reach twice does not make ground more smelled than standing in it once. */
const REACH_VS = `#version 300 es
in vec2 aC;                   // which corner: x 0 at the first end, 1 at the second; y -1 / +1 across
in vec4 iA;                   // the first end: east, north, up (metres from the origin) and how wide the reach is there
in vec4 iB;                   // the second end
in vec2 iW;                   // how strong at each end
in vec2 iT;                   // how far the nose went (east, north) before the next piece: the strip is swept along it
uniform mat4 uM;
out vec2 vP;                  // where this spot is, metres along and across from the first end
flat out vec3 vK;             // the piece's length, and its width at each end
flat out vec2 vW;
flat out vec2 vT;             // that step, along and across the piece
void main(){
  vec2 d = iB.xy - iA.xy; float L = length(d);
  vec2 along = L > 1e-3 ? d / L : vec2(1.0, 0.0), across = vec2(-along.y, along.x);
  vec2 T = vec2(dot(iT, along), dot(iT, across));
  float R = max(iA.w, iB.w);
  float s = mix(min(0.0, T.x) - R, L + max(0.0, T.x) + R, aC.x), c = mix(min(0.0, T.y) - R, max(0.0, T.y) + R, aC.y * 0.5 + 0.5);
  vP = vec2(s, c); vK = vec3(L, iA.w, iB.w); vW = iW; vT = T;
  gl_Position = uM * vec4(iA.xy + along * s + across * c, mix(iA.z, iB.z, aC.x), 1.0);
}`;
const REACH_FS = `#version 300 es
precision highp float;
uniform float uEdge;          // the share of the width at full strength before it fades to the rim
uniform int uSweep;           // how many places along the nose's step the strip is taken at
in vec2 vP; flat in vec3 vK; flat in vec2 vW; flat in vec2 vT; out vec4 o;
float strip(vec2 p){
  float h = vK.x > 1e-3 ? clamp(p.x / vK.x, 0.0, 1.0) : 0.0;
  float q = length(p - vec2(h * vK.x, 0.0)) / mix(vK.y, vK.z, h);
  return mix(vW.x, vW.y, h) * (1.0 - smoothstep(uEdge, 1.0, q));
}
void main(){
  float v = 0.0;
  for (int k = 0; k < uSweep; k++) v = max(v, strip(vP - vT * (uSweep > 1 ? float(k) / float(uSweep - 1) : 0.0)));
  if (v <= 0.0) discard;
  o = vec4(v);
}`;
/* Then the two bands: a light wash where it possibly reached, a stronger one where it likely did, a fine line at each edge. */
const BAND_FS = `#version 300 es
precision highp float;
uniform sampler2D uT;
uniform vec2 uCut;            // possible, likely
uniform vec3 uCol;
in vec2 vUv; out vec4 o;
void main(){
  float v = texture(uT, vUv).r;
  if (v < uCut.x * 0.5) discard;
  float g = max(fwidth(v), 0.004);
  float poss = smoothstep(uCut.x - g, uCut.x + g, v), likely = smoothstep(uCut.y - g, uCut.y + g, v);
  float rim = max(0.6 * (1.0 - smoothstep(0.0, 1.5 * g, abs(v - uCut.x))), 0.9 * (1.0 - smoothstep(0.0, 1.5 * g, abs(v - uCut.y))));
  float a = max(0.17 * poss + 0.19 * likely, rim);
  o = vec4(uCol * a, a);
}`;

/* How high above the ground a parcel is drawn, metres. ILLUSTRATIVE: see the top of this file.
   d = how far it has drifted from where it left the ground, r = the parcel's own fixed number 0..1. */
export function parcelHeight(d, r, st) {
  const dT = st && Number.isFinite(st.dT) ? st.dT : 0, base = 0.25 + 0.35 * r;
  if (dT > 0.5) return Math.min(40, base + d * 0.06 * Math.min(dT, 9) * (0.15 + 1.5 * r * r) + 0.10 * Math.pow(d, 0.8) * r);   // warm ground: it climbs as it goes, some parcels much more than others
  if (dT < -0.5) return base * (1 - 0.5 * Math.min(1, -dT / 5)) + 0.03 * Math.pow(d, 0.7) * r;                                 // cold ground: it stays pressed down
  return base + 0.10 * Math.pow(d, 0.8) * r;                                                                                   // neutral: it spreads upward slowly
}

/* The trail's colours: thin scent a dim violet-red, thick scent amber, the core pale and hot. */
const TRAIL_PALETTE = { tail: [0.30, 0.09, 0.40], ember: [0.92, 0.19, 0.07], amber: [1.0, 0.50, 0.12], hot: [1.0, 0.86, 0.62], loft: [1.0, 0.80, 0.52] };
const rgbOf = (hex) => { const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '') || [0, 'ff', 'ff', 'ff']; return [1, 2, 3].map(i => parseInt(m[i], 16) / 255); };
/** A contamination person's colours (contam.js CONTAM_COLOURS) laid out the same way: their dark for thin scent,
    their colour in the body, their light for the core. So their scent glows like the trail's, but is theirs. */
export const paletteFrom = (c) => { const d = rgbOf(c.dark), h = rgbOf(c.hex), l = rgbOf(c.light);
  return { tail: d.map(v => v * 0.6), ember: d, amber: h, hot: l.map((v, i) => v * 0.75 + h[i] * 0.25), loft: l }; };   // the core stays their colour, not white

/* opts.id: the layer's id (one per palette); opts.palette: its colours (the trail's by default). */
export function makeScentGlow(map, opts = {}) {
  const PAL = opts.palette || TRAIL_PALETTE, MAIN = !opts.id;
  let gl = null, ok = true, sprite = null, quad = null, vao = null, buf = null, qvao = null, qbuf = null, fbo = null, tex = null, fw = 0, fh = 0, wide = true, cap = 64;
  let count = 0, data = new Float32Array(0), origin = null, shown = true, hideWind = false, hidePlume = false, dirty = false;
  let wind = null, wvao = null, wbuf = null, wn = 0, wdata = new Float32Array(0), wdirty = false, wcol = [0.86, 0.91, 1.0], wz = 0;
  const ground = new Map();                                 // ground heights already asked for, on an 11 m grid
  let groundEx = null;
  /* the scent reach: its pieces as given, as packed for the graphics card, and the picture they are gathered into */
  let reach = null, band = null, rvao = null, rbuf = null, bvao = null, rfbo = null, rtex = null, rw = 0, rh = 0;
  let rpieces = null, rdata = new Float32Array(0), rn = 0, rshow = 0, rpackedAt = 0, rorigin = null, rdirty = false;
  let rcut = [0.2, 0.5], redge = 0.55, rsweep = 6, rcol = [0.20, 0.92, 0.86];   // turquoise: cool against the warm scent, and it shows on grass

  const program = (vs, fs) => {
    const mk = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const p = gl.createProgram(); gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
  };
  function target(w, h) {
    if (fbo && w === fw && h === fh) return;
    fw = w; fh = h;
    if (!tex) { tex = gl.createTexture(); fbo = gl.createFramebuffer(); }
    gl.bindTexture(gl.TEXTURE_2D, tex);
    if (wide) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  }
  /* The ground's height where a parcel is, at the exaggeration the map is drawn with. Asked for once per 11 m square and kept
     for a few seconds only: the map sharpens its ground as it loads and eases the exaggeration in as it zooms, so an old
     answer goes stale. */
  function groundAt(lat, lon, now) {
    const key = Math.round(lat * 1e4) * 4e6 + Math.round(lon * 1e4);
    const hit = ground.get(key);
    if (hit && now - hit[1] < 2500) return hit[0];
    const v = map.queryTerrainElevation ? map.queryTerrainElevation({ lng: Math.round(lon * 1e4) / 1e4, lat: Math.round(lat * 1e4) / 1e4 }) : 0;
    if (v == null) return hit ? hit[0] : 0;                  // that piece of ground has not loaded yet: keep the last answer and ask again next time
    if (ground.size > 40000) ground.clear();
    ground.set(key, [v, now + Math.random() * 600]);         // staggered, so they do not all come due on the same frame
    return v;
  }

  function reachTarget(w, h) {
    if (rfbo && w === rw && h === rh) return;
    rw = w; rh = h;
    if (!rtex) { rtex = gl.createTexture(); rfbo = gl.createFramebuffer(); }
    gl.bindTexture(gl.TEXTURE_2D, rtex);
    if (wide) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    gl.bindFramebuffer(gl.FRAMEBUFFER, rfbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, rtex, 0);
  }
  /* The reach's pieces, in metres from the origin and sitting on the ground as the map draws it. Done again every few
     seconds while it is on screen, because the ground under it sharpens as the map loads (see groundAt). */
  function packReach(now) {
    const ex = (map.getTerrain && map.getTerrain() && Number(map.getTerrain().exaggeration)) || 1;
    if (ex !== groundEx) { ground.clear(); groundEx = ex; }
    const n = rpieces.length;
    if (rdata.length < n * 12) rdata = new Float32Array(n * 12);
    const kk = CIRC * Math.cos(origin.lat * Math.PI / 180), ox = mercX(origin.lon), oy = mercY(origin.lat), lift = 0.3 * ex;
    for (let i = 0; i < n; i++) {
      const a = rpieces[i].a, b = rpieces[i].b, step = rpieces[i].step, o = i * 12;
      rdata[o] = (mercX(a.lon) - ox) * kk; rdata[o + 1] = -(mercY(a.lat) - oy) * kk; rdata[o + 2] = groundAt(a.lat, a.lon, now) + lift; rdata[o + 3] = a.r;
      rdata[o + 4] = (mercX(b.lon) - ox) * kk; rdata[o + 5] = -(mercY(b.lat) - oy) * kk; rdata[o + 6] = groundAt(b.lat, b.lon, now) + lift; rdata[o + 7] = b.r;
      rdata[o + 8] = a.w; rdata[o + 9] = b.w;
      rdata[o + 10] = step ? step.lon / 360 * kk : 0; rdata[o + 11] = step ? -(mercY(a.lat + step.lat) - mercY(a.lat)) * kk : 0;
    }
    rn = n; rpackedAt = now; rorigin = origin; rdirty = false;
    gl.bindBuffer(gl.ARRAY_BUFFER, rbuf); gl.bufferData(gl.ARRAY_BUFFER, rdata.subarray(0, n * 12), gl.DYNAMIC_DRAW);
  }

  function localMatrix(m) {
    const k = 1 / (CIRC * Math.cos(origin.lat * Math.PI / 180)), o = [mercX(origin.lon), mercY(origin.lat)], M = new Float32Array(16);
    for (let r = 0; r < 4; r++) {
      M[r] = m[r] * k; M[4 + r] = -m[4 + r] * k; M[8 + r] = m[8 + r] * k;
      M[12 + r] = m[r] * o[0] + m[4 + r] * o[1] + m[12 + r];
    }
    return M;
  }
  const layer = {
    id: opts.id || 'scent-engine-glow', type: 'custom', renderingMode: '3d',
    onAdd(_map, context) {
      gl = context; fbo = null; tex = null; fw = fh = 0; rfbo = null; rtex = null; rw = rh = 0; rn = 0; rdirty = true;
      try {
        if (typeof WebGL2RenderingContext === 'undefined' || !(gl instanceof WebGL2RenderingContext)) throw new Error('needs WebGL 2');
        wide = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
        cap = Math.min(220, gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)[1] || 64);
        sprite = program(SPRITE_VS, SPRITE_FS); quad = program(QUAD_VS, QUAD_FS);
        vao = gl.createVertexArray(); buf = gl.createBuffer();
        gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        const aPos = gl.getAttribLocation(sprite, 'aPos'), aK = gl.getAttribLocation(sprite, 'aK');
        gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 28, 0);
        gl.enableVertexAttribArray(aK); gl.vertexAttribPointer(aK, 4, gl.FLOAT, false, 28, 12);
        qvao = gl.createVertexArray(); qbuf = gl.createBuffer();
        gl.bindVertexArray(qvao); gl.bindBuffer(gl.ARRAY_BUFFER, qbuf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        const aP = gl.getAttribLocation(quad, 'aP'); gl.enableVertexAttribArray(aP); gl.vertexAttribPointer(aP, 2, gl.FLOAT, false, 0, 0);
        /* the wind strokes: one strip of four corners, drawn once for every piece of every stroke */
        wind = program(WIND_VS, WIND_FS); wvao = gl.createVertexArray(); gl.bindVertexArray(wvao);
        const cb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, cb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, -1, 0, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
        const aC = gl.getAttribLocation(wind, 'aC'); gl.enableVertexAttribArray(aC); gl.vertexAttribPointer(aC, 2, gl.FLOAT, false, 0, 0);
        wbuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, wbuf);
        [['iA', 0], ['iB', 12], ['iT', 24]].forEach(([name, off]) => { const loc = gl.getAttribLocation(wind, name); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 36, off); gl.vertexAttribDivisor(loc, 1); });
        /* the scent reach: one strip of four corners for every piece, and a picture-wide sheet to band it */
        reach = program(REACH_VS, REACH_FS); rvao = gl.createVertexArray(); gl.bindVertexArray(rvao);
        const rc = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, rc); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, -1, 0, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
        const rC = gl.getAttribLocation(reach, 'aC'); gl.enableVertexAttribArray(rC); gl.vertexAttribPointer(rC, 2, gl.FLOAT, false, 0, 0);
        rbuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, rbuf);
        [['iA', 4, 0], ['iB', 4, 16], ['iW', 2, 32], ['iT', 2, 40]].forEach(([name, size, off]) => { const loc = gl.getAttribLocation(reach, name); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 48, off); gl.vertexAttribDivisor(loc, 1); });
        band = program(QUAD_VS, BAND_FS); bvao = gl.createVertexArray(); gl.bindVertexArray(bvao); gl.bindBuffer(gl.ARRAY_BUFFER, qbuf);
        const bP = gl.getAttribLocation(band, 'aP'); gl.enableVertexAttribArray(bP); gl.vertexAttribPointer(bP, 2, gl.FLOAT, false, 0, 0);
        gl.bindVertexArray(null);
        ok = true; dirty = true; wdirty = true;
      } catch (err) { ok = false; console.warn('scent glow unavailable, falling back to specks:', err && err.message); }
    },
    onRemove() { gl = null; },
    /* First, every parcel is added into a picture of its own, at half size. */
    prerender(_gl, matrix) {
      if (!ok || !gl || !origin) return;
      const plumeOn = shown && !hidePlume && count > 0, reachOn = rshow > 0 && !!rpieces && rpieces.length > 0;
      if (!plumeOn && !reachOn) return;
      const w = Math.max(2, gl.drawingBufferWidth >> 1), h = Math.max(2, gl.drawingBufferHeight >> 1);
      /* The map works in numbers too large for the graphics card to hold a parcel's place exactly, so parcels are kept in metres
         from a nearby origin and that shift is folded into the map's own matrix here, at full precision. */
      const M = localMatrix(matrix);
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.STENCIL_TEST); gl.disable(gl.CULL_FACE); gl.disable(gl.SCISSOR_TEST);
      gl.colorMask(true, true, true, true); gl.clearColor(0, 0, 0, 0);
      if (reachOn) {                                         // the reach into a picture of its own, the strongest piece winning at each spot
        const now = performance.now();
        reachTarget(w, h);
        gl.bindVertexArray(rvao);
        if (rdirty || rorigin !== origin || now - rpackedAt > 2500) packReach(now);
        gl.bindFramebuffer(gl.FRAMEBUFFER, rfbo); gl.viewport(0, 0, w, h); gl.clear(gl.COLOR_BUFFER_BIT);
        gl.enable(gl.BLEND); gl.blendEquation(gl.MAX); gl.blendFunc(gl.ONE, gl.ONE);
        gl.useProgram(reach);
        gl.uniformMatrix4fv(gl.getUniformLocation(reach, 'uM'), false, M);
        gl.uniform1f(gl.getUniformLocation(reach, 'uEdge'), redge);
        gl.uniform1i(gl.getUniformLocation(reach, 'uSweep'), rsweep);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, Math.min(rshow, rn));
        gl.blendEquation(gl.FUNC_ADD); gl.bindVertexArray(null);
      }
      if (!plumeOn) return;
      target(w, h);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, w, h);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND); gl.blendEquation(gl.FUNC_ADD); gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(sprite); gl.bindVertexArray(vao);
      if (dirty) { gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, count * 7), gl.DYNAMIC_DRAW); dirty = false; }
      gl.uniformMatrix4fv(gl.getUniformLocation(sprite, 'uM'), false, M);
      gl.uniform2f(gl.getUniformLocation(sprite, 'uView'), w, h);
      gl.uniform1f(gl.getUniformLocation(sprite, 'uCap'), cap);
      gl.drawArrays(gl.POINTS, 0, count);
      gl.bindVertexArray(null);
    },
    /* Then that picture is turned into light and laid over the map. */
    render(_gl, matrix) {
      if (!ok || !gl || !origin) return;
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.STENCIL_TEST); gl.disable(gl.CULL_FACE);
      gl.enable(gl.BLEND); gl.blendEquation(gl.FUNC_ADD); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      if (rshow > 0 && rn > 0 && rtex) {                     // the reach lies on the ground, under the wind and the scent
        gl.useProgram(band); gl.bindVertexArray(bvao);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, rtex);
        gl.uniform1i(gl.getUniformLocation(band, 'uT'), 0);
        gl.uniform2f(gl.getUniformLocation(band, 'uCut'), rcut[0], rcut[1]);
        gl.uniform3f(gl.getUniformLocation(band, 'uCol'), rcol[0], rcol[1], rcol[2]);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.bindVertexArray(null);
      }
      if (!shown) return;
      if (wn && !hideWind) {                                 // the wind first, so the scent glows over it
        const M = localMatrix(matrix), c = map.getCenter(), kk = CIRC * Math.cos(origin.lat * Math.PI / 180);
        const cx = (mercX(c.lng) - mercX(origin.lon)) * kk, cy = -(mercY(c.lat) - mercY(origin.lat)) * kk;
        gl.useProgram(wind); gl.bindVertexArray(wvao);
        if (wdirty) { gl.bindBuffer(gl.ARRAY_BUFFER, wbuf); gl.bufferData(gl.ARRAY_BUFFER, wdata.subarray(0, wn * 9), gl.DYNAMIC_DRAW); wdirty = false; }
        gl.uniformMatrix4fv(gl.getUniformLocation(wind, 'uM'), false, M);
        gl.uniform2f(gl.getUniformLocation(wind, 'uView'), gl.drawingBufferWidth, gl.drawingBufferHeight);
        gl.uniform1f(gl.getUniformLocation(wind, 'uW'), 0.85 * (globalThis.devicePixelRatio || 1));
        gl.uniform1f(gl.getUniformLocation(wind, 'uRefW'), M[3] * cx + M[7] * cy + M[11] * wz + M[15]);
        gl.uniform3f(gl.getUniformLocation(wind, 'uCol'), wcol[0], wcol[1], wcol[2]);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, wn);
        gl.bindVertexArray(null);
      }
      if (hidePlume || !count || !tex) return;
      gl.useProgram(quad); gl.bindVertexArray(qvao);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(gl.getUniformLocation(quad, 'uT'), 0);
      gl.uniform1f(gl.getUniformLocation(quad, 'uK'), wide ? 0.9 : 7.2);
      gl.uniform1f(gl.getUniformLocation(quad, 'uGain'), 1.0);
      for (const k of ['tail', 'ember', 'amber', 'hot', 'loft']) gl.uniform3fv(gl.getUniformLocation(quad, 'u' + k[0].toUpperCase() + k.slice(1)), PAL[k]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.bindVertexArray(null);
    },
  };

  /* parts: the model's parcels (lat, lon, hlat, hlon, seed, str). weight(s) is the app's own measure of how much each one counts. */
  function update(parts, st, weight) {
    if (!ok) return;
    const ex = (map.getTerrain && map.getTerrain() && Number(map.getTerrain().exaggeration)) || 1;
    if (ex !== groundEx) { ground.clear(); groundEx = ex; }
    if (!parts.length) { count = 0; map.triggerRepaint(); return; }
    if (!origin || Math.abs(parts[0].lat - origin.lat) > 0.05 || Math.abs(parts[0].lon - origin.lon) > 0.05) origin = { lat: parts[0].hlat ?? parts[0].lat, lon: parts[0].hlon ?? parts[0].lon };
    if (data.length < parts.length * 7) data = new Float32Array(Math.ceil(parts.length * 1.3) * 7);
    const kk = CIRC * Math.cos(origin.lat * Math.PI / 180), ox = mercX(origin.lon), oy = mercY(origin.lat), mLat = 111320, mLon = 111320 * Math.cos(origin.lat * Math.PI / 180), scale = wide ? 1 : 0.125;
    let n = 0; const now = performance.now();
    for (const s of parts) {
      const w = weight(s);
      if (!(w > 0.004)) continue;
      const d = Math.hypot((s.lat - s.hlat) * mLat, (s.lon - s.hlon) * mLon), r = (s.seed % 6.28318) / 6.28318, low = s.hide ? 0.35 : 1, h = parcelHeight(d, r, st) * low, o = n * 7;   // a placed odour hangs low (sim.js HIDE_POOL)
      data[o] = (mercX(s.lon) - ox) * kk; data[o + 1] = -(mercY(s.lat) - oy) * kk; data[o + 2] = groundAt(s.lat, s.lon, now) + (0.4 * low + h) * ex;
      data[o + 3] = w * scale; data[o + 4] = Math.min(1, Math.max(0, s.str)); data[o + 5] = Math.min(14, (1.8 + 0.11 * d + 0.16 * h) * (s.hide ? 0.5 : 1));      // a parcel that has gone further has spread wider: soft enough that thin scent reads as haze, not dots data[o + 6] = Math.min(1, Math.max(0, (h - 3) / 17));
      n++;
    }
    count = n; dirty = true; map.triggerRepaint();
  }
  /* for checking from the console on a development machine only */
  if (MAIN && typeof location !== 'undefined' && /^(localhost|127\.0\.0\.1)$/.test(location.hostname)) globalThis.__scentGlow = { map, peek: () => ({ count, origin, reach: [rn, rshow, rpieces ? rpieces.length : 0], sample: Array.from(data.subarray(0, 14)), ground: ground.size, ex: groundEx, wide, cap, terrain: map.getTerrain && map.getTerrain(), q: origin && map.queryTerrainElevation && map.queryTerrainElevation({ lng: origin.lon, lat: origin.lat }), pitch: map.getPitch(), zoom: map.getZoom(), proj: map.getProjection && map.getProjection().name }) };
  /* The wind strokes. streaks: each has where it is now (lat, lon), the points it has been through (tail: [lon, lat] pairs,
     oldest first) and a strength a (0..1). */
  function setWind(streaks) {
    if (!ok) return;
    if (!origin && streaks.length) origin = { lat: streaks[0].lat, lon: streaks[0].lon };
    if (!origin) return;
    const ex = (map.getTerrain && map.getTerrain() && Number(map.getTerrain().exaggeration)) || 1, now = performance.now();
    const kk = CIRC * Math.cos(origin.lat * Math.PI / 180), ox = mercX(origin.lon), oy = mercY(origin.lat);
    let n = 0;
    for (const p of streaks) {
      const tail = p.tail, spans = tail ? tail.length : 0;
      if (!spans || !(p.a > 0.01)) continue;
      if (wdata.length < (n + spans) * 9) { const more = new Float32Array(Math.ceil((n + spans) * 1.5) * 9); more.set(wdata.subarray(0, n * 9)); wdata = more; }
      const z = groundAt(p.lat, p.lon, now) + 0.5 + 1.0 * ex; wz = z;        // just clear of the ground
      let ax = (mercX(tail[0][0]) - ox) * kk, ay = -(mercY(tail[0][1]) - oy) * kk;
      for (let j = 0; j < spans; j++) {
        const q = j + 1 < spans ? tail[j + 1] : [p.lon, p.lat], bx = (mercX(q[0]) - ox) * kk, by = -(mercY(q[1]) - oy) * kk, o = n * 9;
        wdata[o] = ax; wdata[o + 1] = ay; wdata[o + 2] = z; wdata[o + 3] = bx; wdata[o + 4] = by; wdata[o + 5] = z;
        wdata[o + 6] = j / spans; wdata[o + 7] = (j + 1) / spans; wdata[o + 8] = p.a;
        ax = bx; ay = by; n++;
      }
    }
    wn = n; wdirty = true; map.triggerRepaint();
  }
  return {
    layer, update, setWind,
    clearWind() { if (wn) { wn = 0; map.triggerRepaint(); } },
    setWindColour(hex) { const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || ''); if (m) { wcol = [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255]; map.triggerRepaint(); } },
    clear() { if (count) { count = 0; map.triggerRepaint(); } },
    /* The scent reach (reach.js). pieces: strips of ground in the order the dog walked them, each { a, b } with lat, lon, r
       (metres wide) and w (0..1) at each end. cut: where "possible" and "likely" begin. Nothing is drawn until showReach. */
    setReach(pieces, cut) {
      if (!ok) return;
      rpieces = pieces && pieces.length ? pieces : null; rdirty = true; rn = 0;
      if (cut) { rcut = [cut.possible, cut.likely]; redge = cut.edge; rsweep = Math.max(1, cut.sweep | 0); }
      if (rpieces && !origin) origin = { lat: rpieces[0].a.lat, lon: rpieces[0].a.lon };
      /* asked again a few times as the ground under it loads, in case nothing else redraws the map meanwhile */
      if (rpieces) for (const ms of [900, 2700, 5600]) setTimeout(() => { if (rpieces && rshow) map.triggerRepaint(); }, ms);
      map.triggerRepaint();
    },
    /** Draw the first n pieces: the reach as far as the dog had got. */
    showReach(n) { n = Math.max(0, n | 0); if (n !== rshow) { rshow = n; map.triggerRepaint(); } },
    clearReach() { rpieces = null; rn = 0; if (rshow) { rshow = 0; map.triggerRepaint(); } },
    setShown(v) { shown = !!v; map.triggerRepaint(); },
    /* The replay can leave the wind or the scent off the map for a while, each on its own (its Layers). */
    setHidden(h) { hideWind = !!h?.wind; hidePlume = !!h?.plume; map.triggerRepaint(); },
    get ok() { return ok; },
    get count() { return count; },
  };
}
