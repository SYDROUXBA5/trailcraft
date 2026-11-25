/* Real glass for what floats over the map (Rémi, 24 Nov 2026: "can you recreate
   for this app this agentic liquid glass?").

   The liquid glass in app.css is a blur with a painted rim: zoomed in, its
   edge is a grey smear. Here the same panes are drawn by the map itself, as
   its last layer: the picture of the map so far is copied, and each pane is
   painted from that copy as a slab of glass. In its bevel the ground is bent
   (refraction) and bright lines part into colours (dispersion); the bevel
   catches the light, brightest top left and again bottom right, as the rim
   in app.css is. Safari cannot bend a backdrop from CSS, which is why this is
   done on the map's own canvas.

   The panes are styled, not a physical model: the bevel pulls in what lies
   just beyond it, because the strictly physical bend hid a strip of ground
   under the edge and read as a cut-off.

   Each pane the layer has drawn is marked data-rg, and app.css takes its own
   glass off a marked pane. Anything that stops the layer (no WebGL 2, the
   light theme, Reduce Transparency, the Look setting) takes the marks off
   again, so the blur is always what is left. */

/* The same pieces app.css gives the liquid glass to. */
export const GLASS_PANES = '.wx-panel, .hud-pill, .wx-rose, .map-fab, .map-style, #scrLay .glass-bottom, #scrRun .glass-bottom, .rep-dock';
/* How strongly the edge bends the ground, how far the colours part, how much the glass softens what is under it. */
export const GLASS_LOOK = { refraction: 1.0, rainbow: 1.6, frost: 0.12 };
/* The pane's own colour, as app.css states it in --lg-tint: 'rgba(0, 70, 160, 0.30)' to [r, g, b, a], each 0 to 1. */
export function parseTint(str) {
  const m = /rgba?\(([^)]+)\)/.exec(str || '');
  if (!m) return null;
  const v = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat);
  if (v.length < 3 || v.some(x => !Number.isFinite(x))) return null;
  return [v[0] / 255, v[1] / 255, v[2] / 255, v.length > 3 ? Math.min(1, Math.max(0, v[3])) : 1];
}
const SPILL = 34;       // CSS px round a pane that its shadow can reach
const CARRY = 48;       // CSS px a square edge lying on the screen's edge is carried past it, so no bevel is drawn there

/* What the shader needs for one pane. r: the pane's box on screen. rad: its corner radii, top left, top right,
   bottom right, bottom left. view: the canvas's box. k: picture pixels per CSS pixel. W, H: the picture's size.
   Lengths out are in picture pixels, y down from the top; the scissor box is counted from the bottom left. */
export function paneBox(r, rad, view, k, W, H) {
  let { left, top, right, bottom } = r;
  const [tl, tr, br, bl] = rad;
  const on = (a, b) => Math.abs(a - b) < 1;
  if (on(left, view.left) && tl < 1 && bl < 1) left -= CARRY;
  if (on(right, view.left + view.width) && tr < 1 && br < 1) right += CARRY;
  if (on(top, view.top) && tl < 1 && tr < 1) top -= CARRY;
  if (on(bottom, view.top + view.height) && bl < 1 && br < 1) bottom += CARRY;
  const w = right - left, h = bottom - top, half = Math.min(w, h) / 2;
  const bevel = Math.min(half, Math.max(10, Math.min(20, 0.13 * Math.min(w, h) + 8.5)));
  const c = (v) => Math.min(Math.max(0, v), half) * k;
  const x0 = Math.max(0, Math.floor((left - view.left - SPILL) * k)), x1 = Math.min(W, Math.ceil((right - view.left + SPILL) * k));
  const y0 = Math.max(0, Math.floor((top - view.top - SPILL) * k)), y1 = Math.min(H, Math.ceil((bottom - view.top + SPILL) * k));
  return {
    rect: [((left + right) / 2 - view.left) * k, ((top + bottom) / 2 - view.top) * k, w / 2 * k, h / 2 * k],
    radii: [c(br), c(tr), c(bl), c(tl)],          // the order the shader picks its corner in
    bevel: bevel * k,
    scissor: [x0, H - y1, Math.max(0, x1 - x0), Math.max(0, y1 - y0)],
  };
}

const GLASS_VS = `#version 300 es
void main(){ vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;

const GLASS_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uRes;
uniform vec4 uRect;     // centre and half size, picture pixels, y down
uniform vec4 uRad;      // corner radii: bottom right, top right, bottom left, top left
uniform float uBevel;
uniform float uS;       // picture pixels per CSS pixel
uniform vec3 uLook;     // refraction, rainbow, frost
uniform vec4 uTint;     // the pane's own colour and how much of it (app.css, --lg-tint)
out vec4 o;
const vec3 SPECN = vec3(1.5, 2.0, 1.5);
float sd(vec2 p){
  vec2 r = p.x > 0.0 ? uRad.xy : uRad.zw;
  float c = p.y > 0.0 ? r.x : r.y;
  vec2 q = abs(p) - uRect.zw + c;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - c;
}
vec3 at(vec2 p){ return texture(uTex, vec2(p.x, uRes.y - p.y) / uRes).rgb; }
vec3 soft(vec2 p, float r){
  if(r < 0.6) return at(p);
  vec3 c = at(p) * 0.36;
  c += at(p + vec2( r, r * 0.4)) * 0.16;
  c += at(p + vec2(-r * 0.4, r)) * 0.16;
  c += at(p + vec2(-r, -r * 0.4)) * 0.16;
  c += at(p + vec2( r * 0.4, -r)) * 0.16;
  return c;
}
vec3 spec(float k){ return vec3(clamp(1.0 - 2.0 * k, 0.0, 1.0), 1.0 - abs(2.0 * k - 1.0), clamp(2.0 * k - 1.0, 0.0, 1.0)); }
void main(){
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 lp = p - uRect.xy;
  float d = sd(lp);
  float a = smoothstep(0.8, -0.8, d);
  /* The pane's shadow on the ground, a little below it. */
  float sh = 0.45 * (1.0 - smoothstep(-10.0 * uS, 24.0 * uS, sd(lp - vec2(0.0, 9.0 * uS))));
  if(a <= 0.0){ o = vec4(0.0, 0.0, 0.0, sh); return; }
  float w = max(uBevel, 1.0);
  float t = clamp(-d / w, 0.0, 1.0);
  float sl = pow(max(1.0 - t, 0.0), 1.7);                 // how steep the bevel is here: 1 at the rim, 0 on the flat
  float rad = uLook.z * 6.0 * uS;
  vec2 g = vec2(0.0, -1.0);
  vec3 N = vec3(0.0, 0.0, 1.0);
  vec3 col;
  if(sl < 0.004){
    col = soft(p, rad);                         // the flat of the pane: the ground as it is
  } else {
    vec2 e = vec2(0.75, 0.0);
    g = normalize(vec2(sd(lp + e.xy) - sd(lp - e.xy), sd(lp + e.yx) - sd(lp - e.yx)) + 0.00001);
    N = normalize(vec3(g * sl * 2.4, 1.0));
    float depth = -w * uLook.x;                 // towards the edge: what lies just beyond is pulled in, squeezed
    col = vec3(0.0);
    for(int i = 0; i < 5; i++){
      float k = float(i) / 4.0;
      float ior = 1.5 + (k - 0.5) * 0.16 * uLook.y;
      vec3 T = refract(vec3(0.0, 0.0, -1.0), N, 1.0 / ior);
      col += soft(p + T.xy / max(-T.z, 0.2) * depth, rad) * spec(k);
    }
    col /= SPECN;
  }
  /* Clear, not grey: the colour under it comes through stronger, and it is dark because it dims the ground. */
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = max(mix(vec3(lum), col, 1.5), 0.0);
  col *= mix(0.64, 1.0, sl * sl);                 // dimmed as the blur dims it (brightness 0.64), so white words read the same
  col = mix(col, uTint.rgb, uTint.a * (1.0 - 0.6 * sl * sl));   // and tinted as the blur is tinted, less in the bevel, which stays clear
  vec2 u = lp / uRect.zw;
  col += 0.07 * smoothstep(0.2, -1.0, u.y) * (1.0 - 0.5 * abs(u.x));
  /* The light: in at the top left, out again at the bottom right. */
  vec3 V = vec3(0.0, 0.0, 1.0);
  vec3 H1 = normalize(normalize(vec3(-0.55, -0.75, 0.50)) + V);
  vec3 H2 = normalize(normalize(vec3(0.55, 0.75, 0.42)) + V);
  col += (pow(max(dot(N, H1), 0.0), 30.0) + pow(max(dot(N, H2), 0.0), 30.0) * 0.28) * vec3(1.0, 0.98, 0.94) * 0.6;
  col += pow(max(1.0 - N.z, 0.0), 2.2) * vec3(0.50, 0.68, 0.85) * 0.16;
  float line = smoothstep(-1.5 * uS, -0.35 * uS, d);
  float fc = 0.5 + 0.5 * dot(g, normalize(vec2(-0.6, -0.8)));
  col += line * (0.06 + 0.55 * pow(max(fc, 0.0), 3.0) + 0.22 * pow(max(1.0 - fc, 0.0), 3.0));
  o = vec4(clamp(col, 0.0, 1.0) * a, a + (1.0 - a) * sh);
}`;

export function makeRealGlass(map, opts = {}) {
  const root = document.documentElement;
  const calm = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-transparency: reduce)') : { matches: false };
  let gl = null, ok = false, prog = null, vao = null, tex = null, fbo = null, tw = 0, th = 0, proved = false;
  let on = opts.on !== false, held = false;
  const U = {}, drawn = new Set(), corners = new WeakMap();
  let tint = [6 / 255, 8 / 255, 12 / 255, 0.2];
  const readTint = () => { tint = parseTint(getComputedStyle(root).getPropertyValue('--lg-tint')) || tint; };
  const wanted = () => on && !held && ok && root.dataset.theme === 'dark' && !calm.matches;
  const unmark = () => { for (const el of drawn) el.removeAttribute('data-rg'); drawn.clear(); };
  const kick = () => { try { map.triggerRepaint(); } catch { /* the map has gone */ } };

  function cornersOf(el, r) {
    const c = corners.get(el);
    if (c && Math.abs(c.w - r.width) < 0.5 && Math.abs(c.h - r.height) < 0.5) return c.rad;
    const cs = getComputedStyle(el);
    const px = (v) => { const n = parseFloat(v) || 0; return /%/.test(v) ? n / 100 * Math.min(r.width, r.height) : n; };
    const rad = [px(cs.borderTopLeftRadius), px(cs.borderTopRightRadius), px(cs.borderBottomRightRadius), px(cs.borderBottomLeftRadius)];
    corners.set(el, { w: r.width, h: r.height, rad });
    return rad;
  }
  function target(w, h) {
    if (tex && tw === w && th === h) return;
    if (!tex) { tex = gl.createTexture(); fbo = gl.createFramebuffer(); }
    tw = w; th = h;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  }

  const layer = {
    id: 'real-glass', type: 'custom', renderingMode: '2d',
    onAdd(_map, context) {
      gl = context; tex = null; fbo = null; tw = th = 0; proved = false;
      try {
        if (typeof WebGL2RenderingContext === 'undefined' || !(gl instanceof WebGL2RenderingContext)) throw new Error('needs WebGL 2');
        const mk = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
        prog = gl.createProgram(); gl.attachShader(prog, mk(gl.VERTEX_SHADER, GLASS_VS)); gl.attachShader(prog, mk(gl.FRAGMENT_SHADER, GLASS_FS)); gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
        for (const n of ['uTex', 'uRes', 'uRect', 'uRad', 'uBevel', 'uS', 'uLook', 'uTint']) U[n] = gl.getUniformLocation(prog, n);
        vao = gl.createVertexArray();
        readTint();
        ok = true;
      } catch (err) { ok = false; console.warn('real glass unavailable, the blur stays:', err && err.message); }
      watch();
    },
    onRemove() { unmark(); gl = null; ok = false; },
    /* The last layer: copy the map as drawn so far, then paint each pane from the copy. */
    render() {
      if (!gl) return;
      if (!wanted()) { if (drawn.size) unmark(); return; }
      const view = map.getCanvas().getBoundingClientRect();
      if (view.width < 2 || view.height < 2) return;
      const todo = [];
      for (const el of document.querySelectorAll(GLASS_PANES)) {
        const r = el.getBoundingClientRect();
        if (r.width < 8 || r.height < 8 || r.right <= view.left || r.left >= view.right || r.bottom <= view.top || r.top >= view.bottom) continue;
        todo.push([el, r]);
      }
      if (!todo.length) return;
      const vp = gl.getParameter(gl.VIEWPORT), W = vp[2], H = vp[3], k = W / view.width;
      const cur = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING);
      if (!proved) while (gl.getError() !== gl.NO_ERROR) { /* whatever was left over is not ours */ }
      target(W, H);
      gl.disable(gl.SCISSOR_TEST);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, cur); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, fbo);
      gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, cur);
      if (!proved) {                              // once: a map whose picture cannot be copied keeps the blur
        if (gl.getError() !== gl.NO_ERROR) { ok = false; unmark(); console.warn('real glass unavailable, the blur stays: the map picture cannot be copied'); return; }
        proved = true;
      }
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.STENCIL_TEST); gl.disable(gl.CULL_FACE);
      gl.enable(gl.BLEND); gl.blendEquation(gl.FUNC_ADD); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.colorMask(true, true, true, true);
      gl.useProgram(prog); gl.bindVertexArray(vao);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(U.uTex, 0); gl.uniform2f(U.uRes, W, H); gl.uniform1f(U.uS, k);
      gl.uniform3f(U.uLook, GLASS_LOOK.refraction, GLASS_LOOK.rainbow, GLASS_LOOK.frost);
      gl.uniform4fv(U.uTint, tint);
      gl.enable(gl.SCISSOR_TEST);
      for (const [el, r] of todo) {
        const b = paneBox(r, cornersOf(el, r), view, k, W, H);
        if (!b.scissor[2] || !b.scissor[3]) continue;
        gl.uniform4fv(U.uRect, b.rect); gl.uniform4fv(U.uRad, b.radii); gl.uniform1f(U.uBevel, b.bevel);
        gl.scissor(b.scissor[0], b.scissor[1], b.scissor[2], b.scissor[3]);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        if (!drawn.has(el)) { el.setAttribute('data-rg', ''); drawn.add(el); }
      }
      gl.disable(gl.SCISSOR_TEST);
      gl.bindVertexArray(null);
    },
  };

  /* The map only draws when it has something new. A pane that appears, moves or changes size while the map is
     still has to ask for a frame, or its glass stays where it was. */
  let raf = 0, until = 0, sig = '';
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => watch(200)) : null;
  function signature() {
    let s = root.dataset.theme + (on ? 1 : 0) + (held ? 1 : 0) + (calm.matches ? 1 : 0);
    for (const el of document.querySelectorAll(GLASS_PANES)) {
      ro?.observe(el);
      const r = el.getBoundingClientRect();
      if (r.width) s += '|' + Math.round(r.left) + ',' + Math.round(r.top) + ',' + Math.round(r.width) + ',' + Math.round(r.height);
    }
    return s;
  }
  function tick() {
    raf = 0;
    const s = signature();
    if (s !== sig) { sig = s; readTint(); kick(); }
    if (performance.now() < until) raf = requestAnimationFrame(tick);
  }
  function watch(ms = 700) { until = Math.max(until, performance.now() + ms); if (!raf) raf = requestAnimationFrame(tick); }
  if (typeof MutationObserver === 'function') {
    new MutationObserver(() => watch()).observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'class', 'style', 'data-theme', 'aria-expanded'] });
  }
  calm.addEventListener?.('change', () => watch());

  if (typeof location !== 'undefined' && /^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
    globalThis.__realGlass = { map, state: () => ({ ok, on, held, wanted: wanted(), drawn: drawn.size, proved }) };
  }

  return {
    layer,
    get ok() { return ok; },
    /* The Look setting: Real or Blur. */
    setOn(v) { on = !!v; if (!on) unmark(); watch(); kick(); },
    /* While the map's own picture is being copied for a video (clip.js), the glass must not be in it: the panes'
       words are not on the map, so a video would show empty glass. */
    hold(v) { held = !!v; if (held) unmark(); watch(); kick(); },
    /* Keep it the last layer, so the whole map is under the glass. */
    raise() { try { if (map.getLayer(layer.id)) map.moveLayer(layer.id); } catch { /* a style still loading */ } },
  };
}
