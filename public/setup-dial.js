/* The set-up as a dial (Rémi, 23 Nov 2026: v2 dial, names for people and dogs,
   light for things, molecules for training aids).

   One question at a time. The answers sit round a half dial at the foot of the
   screen; turn it with a thumb and it springs onto each one under a glass lens.
   Above it, a glass orb shows the answer: a person or a dog by NAME, in light;
   the thing searched for, the vehicle, a pill as a hologram; every training aid
   as its molecule. Tap the orb (or the lens, or Enter) to keep it.

   It is a way of showing the home set-up rows, not a second copy of them: the
   steps and the answers are read from #homeSetup as the app draws it, and a
   pick is the app's own chip being tapped, so every rule (no "Just me" for a
   person, the odour list following what is hidden, "+ Add dog" opening its
   form) stays where it is. The dial opens whenever the app opens the rows —
   from Change, from one part of the summary line (then it asks just that), or
   on its own when something is missing — and closes them when it is done. */
import { haptic } from './native.js';

const Q = { rowHandlers: 'Who is handling?', rowDogs: 'Which dog?', rowTargets: 'What are we looking for?', rowCarries: 'What is hidden in it?', rowLevels: 'How old is the trail?' };
const NAMED = new Set(['rowHandlers', 'rowDogs', 'rowLevels', 'rowLayers']);
const KIND = { person: 'person', vehicle: 'vehicle', article: 'article', cadaver: 'mol:Cadaver', narcotics: 'narcotics', explosives: 'explosives',
  firearms: 'firearms', sport: 'sport', other: 'other' };
const STEP = 30, R = 292;
const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion === 'off';   // the phone's setting, or the app's own
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function initSetupDial() {
  const home = document.getElementById('scrHome'), setup = document.getElementById('homeSetup'), sum = document.getElementById('homeSum');
  if (!home || !setup || !sum || document.getElementById('setupDial')) return;
  const ticksSvg = Array.from({ length: 120 }, (_, i) => { const a = i * 3 * Math.PI / 180, maj = i % 5 === 0, r0 = maj ? 334 : 345, r1 = 364;
    return `<line x1="${(r0 * Math.sin(a)).toFixed(1)}" y1="${(-r0 * Math.cos(a)).toFixed(1)}" x2="${(r1 * Math.sin(a)).toFixed(1)}" y2="${(-r1 * Math.cos(a)).toFixed(1)}" stroke="rgba(255,255,255,${maj ? .62 : .26})" stroke-width="${maj ? 2 : 1.2}" stroke-linecap="round"/>`; }).join('');
  const arcTop = (() => { const p = (a) => `${(371 * Math.sin(a * Math.PI / 180)).toFixed(1)} ${(-371 * Math.cos(a * Math.PI / 180)).toFixed(1)}`; return `M ${p(-9)} A 371 371 0 0 1 ${p(9)}`; })();
  const el = document.createElement('div');
  el.className = 'sd'; el.id = 'setupDial'; el.hidden = true;
  el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Set up');
  el.innerHTML = `
    <div class="sd-top"><button type="button" class="sd-back" aria-label="Back">‹</button><div class="sd-ticks" aria-hidden="true"></div><button type="button" class="sd-done">Done</button></div>
    <div class="sd-q" aria-live="polite"></div><div class="sd-ans"></div>
    <div class="sd-mid"><button type="button" class="sd-orb" aria-label="Keep this answer"><span class="sd-name"></span></button><div class="sd-tx" aria-live="polite"></div></div>
    <div class="sd-dial"><svg viewBox="-380 -380 760 760" aria-hidden="true">
        <defs><radialGradient id="sdDisc" cx="0" cy="0" r="380" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#0c2650"/><stop offset=".76" stop-color="#061631"/><stop offset=".86" stop-color="#0b2246"/><stop offset="1" stop-color="#04101f"/></radialGradient>
          <linearGradient id="sdRim" x1="0" y1="-380" x2="0" y2="200" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#9ff6ff"/><stop offset=".35" stop-color="#007BFF"/><stop offset="1" stop-color="#002a66"/></linearGradient></defs>
        <circle r="378" fill="url(#sdDisc)" stroke="url(#sdRim)" stroke-width="2.5"/><circle r="322" fill="none" stroke="rgba(0,229,255,.14)"/>
        <g class="sd-tg">${ticksSvg}</g><path d="${arcTop}" fill="none" stroke="#00E5FF" stroke-width="3.5" stroke-linecap="round"/></svg>
      <div class="sd-labs"></div></div>
    <div class="sd-lens" aria-hidden="true"></div>
    <div class="sd-hint">Turn to choose · tap the middle to keep</div>`;
  home.appendChild(el);
  const $ = (s) => el.querySelector(s);
  const qEl = $('.sd-q'), ans = $('.sd-ans'), orb = $('.sd-orb'), nameEl = $('.sd-name'), tx = $('.sd-tx'), dial = $('.sd-dial'), labs = $('.sd-labs'), tg = $('.sd-tg'), lens = $('.sd-lens'), ticks = $('.sd-ticks');

  /* What the rows say right now. */
  const steps = () => [...setup.querySelectorAll('.label')].filter(l => !l.hidden).map(l => {
    let r = l.nextElementSibling; while (r && !r.classList.contains('chip-row')) r = r.nextElementSibling;
    return r && !r.hidden ? { id: r.id, row: r, label: l } : null; }).filter(Boolean);
  const nameOf = (b) => { const w = b.querySelector('.who b, b'); if (w) return w.textContent.trim();
    const k = b.cloneNode(true); k.querySelectorAll('[class*="ava"], .sub, i').forEach(n => n.remove()); return k.textContent.trim(); };
  const kindOf = (id, b) => id === 'rowTargets' ? KIND[b.dataset.target] : id === 'rowCarries' ? KIND[b.dataset.carries]
    : id === 'rowOdours' && b.dataset.odour ? 'mol:' + b.dataset.odour : null;
  const optionsOf = (s) => [...s.row.querySelectorAll('button')].map(b => ({ b, name: nameOf(b),
    sub: b.querySelector('.sub')?.textContent.trim() || (b.getAttribute('aria-label') || '').split(': ')[1] || '',
    add: b.matches('[data-add-handler], [data-add-dog], [data-add-layer], [data-odour-other]'),
    sel: b.classList.contains('selected') || b.getAttribute('aria-pressed') === 'true', kind: kindOf(s.id, b) }));
  const question = (s) => Q[s.id] || `${s.label.textContent.trim()}?`;

  /* The dial: a spring that follows the thumb and settles on an answer. */
  let rot = 0, vel = 0, target = 0, alpha = 0, opts = [], els = [], cur = -1, cand = -1, candT = 0, quiet = true, raf = 0, last = 0;
  let list = [], at = 0, only = false, intent = null, closing = false, holo = null, holoP = null;
  const loop = (t) => {
    const dt = Math.min(.033, (t - last) / 1000 || .016); last = t;
    if (still()) { rot = target; vel = 0; } else { vel += (150 * (target - rot) - 21 * vel) * dt; rot += vel * dt; }
    els.forEach((e, i) => { const a = i * STEP + rot, ar = a * Math.PI / 180, d = Math.abs(a), near = Math.max(0, 1 - d / (STEP * .9));
      e.style.transform = `translate(${(R * Math.sin(ar)).toFixed(2)}px, ${(-R * Math.cos(ar)).toFixed(2)}px) translate(-50%, -50%) scale(${(1 + .42 * near * near).toFixed(3)})`;
      e.style.opacity = (Math.max(0, 1 - d / 78) * alpha).toFixed(3); e.classList.toggle('on', d < STEP / 2); });
    tg.setAttribute('transform', `rotate(${rot.toFixed(2)})`); holo?.dial(rot);
    const n = Math.round(-rot / STEP);
    if (!quiet && alpha > .5 && n >= 0 && n < els.length) {
      if (n !== cand) { if (cand !== -1) { lens.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.07)' }, { transform: 'scale(1)' }], { duration: 200 }); haptic('edge'); } cand = n; candT = t; }
      if (n !== cur && t - candT > 110 && Math.abs(vel) < 60) { cur = n; present(opts[n]); }
    }
    if (!el.hidden) raf = requestAnimationFrame(loop);
  };
  const tween = (set, from, to, ms) => new Promise(res => { if (still()) { set(to); return res(); } const t0 = performance.now();
    const f = (t) => { const k = Math.min(1, (t - t0) / ms), e = k < .5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2; set(from + (to - from) * e); k < 1 ? requestAnimationFrame(f) : res(); }; requestAnimationFrame(f); });
  const fade = (node, on, ms = 260) => node.animate(on ? [{ opacity: 0, filter: 'blur(6px)' }, { opacity: 1, filter: 'blur(0)' }] : [{ opacity: 1 }, { opacity: 0, filter: 'blur(6px)' }],
    { duration: still() ? 1 : ms, fill: 'forwards', easing: 'cubic-bezier(.2,.8,.2,1)' }).finished;
  const turnTo = (i) => { target = -Math.max(0, Math.min(opts.length - 1, i)) * STEP; };

  /* The orb: a name in light for people and dogs, a hologram for everything else. */
  let seq = 0;
  const present = async (o) => {
    const my = ++seq; if (!o) return;
    const named = !o.kind || o.add || !holo;
    if (named) { holo?.show(null); nameEl.textContent = o.name; nameEl.classList.toggle('small', o.add || o.name.length > 9); fade(nameEl, true, 380); }
    else { nameEl.textContent = ''; holo.show(o.kind); }
    const info = o.kind?.startsWith('mol:') && holo ? holo.info(o.kind.slice(4)) : null;
    const sub = info ? [info.formula, info.what].filter(Boolean).join(' · ') : o.sub;
    await fade(tx, false, 120); if (my !== seq) return;
    tx.innerHTML = named ? `<div class="sd-sub">${esc(sub)}</div>` : `<div class="sd-nm">${esc(o.name)}</div><div class="sd-sub">${esc(sub)}</div>`;
    fade(tx, true, 300);
  };
  const ensureHolo = () => {
    if (holoP) return holoP;
    const size = Math.round(orb.getBoundingClientRect().width) || 260;
    holoP = import('./holo.js').then(m => m.createHolo(orb, size)).then(h => { holo = h; if (!el.hidden) h.start(); cur = -1; cand = -1; return h; })   // the answer is shown again, now in light
      .catch(() => null);                          // no WebGL, or the single-file copy: names for everything
    return holoP;
  };

  const paintTop = () => {
    ticks.innerHTML = list.map((_, k) => `<b class="${k < at ? 'done' : k === at ? 'on' : ''}"></b>`).join('');
    ans.innerHTML = list.slice(0, at).map(s => { const o = optionsOf(s).find(x => x.sel); return o ? `<span>${esc(o.name.replace(/^A (\w)/, (_, c) => c.toUpperCase()))}</span>` : ''; }).join('');
  };
  const show = async (i, dir = 1) => {
    list = steps(); at = Math.max(0, Math.min(i, list.length - 1)); const s = list[at]; if (!s) return close();
    opts = optionsOf(s); const sel = Math.max(0, opts.findIndex(o => o.sel));
    qEl.textContent = question(s); paintTop(); fade(qEl, true, 380);
    labs.innerHTML = opts.map(o => `<button type="button" class="sd-l${o.add ? ' add' : ''}" tabindex="-1">${esc(o.name)}</button>`).join(''); els = [...labs.children];
    rot = -sel * STEP + 75 * dir; vel = 0; target = -sel * STEP; cur = -1; cand = -1; quiet = false;
    await tween(v => { alpha = v; }, 0, 1, 420);
  };
  const rollOut = async (dir = 1) => { quiet = true; seq++; holo?.show(null);
    await Promise.all([fade(tx, false, 260), fade(nameEl, false, 220), fade(qEl, false, 240), tween(v => { target = v; }, target, target - 75 * dir, 360), tween(v => { alpha = v; }, 1, 0, 300)]);
    tx.innerHTML = ''; nameEl.textContent = ''; };

  const keep = async () => {
    const s = list[at]; if (!s || cur < 0 || quiet) return;
    const fresh = steps().find(x => x.id === s.id), o = (fresh && optionsOf(fresh)[cur]) || opts[cur]; if (!o) return;   // the rows may have been drawn again
    if (o.add) { close(true); o.b.click(); return; }             // "+ Add dog", "+ Other": the app takes it from here
    orb.animate([{ boxShadow: '0 0 0 0 rgba(0,229,255,.8)' }, { boxShadow: '0 0 0 18px rgba(0,229,255,0)' }], { duration: still() ? 1 : 650 });
    if (!o.sel) o.b.click();                                       // the app's own chip; a chosen one is kept as it is
    if (only) return finish();
    const now = steps(), k = now.findIndex(x => x.id === s.id);
    if (k < 0 || k >= now.length - 1) return finish();
    await rollOut(1); show(k + 1, 1);
  };
  const back = async () => { if (at <= 0) return close(); await rollOut(-1); show(at - 1, -1); };
  const finish = () => { haptic('back'); close();
    const go = document.getElementById('btnLay');
    if (go && !still()) go.animate([{ boxShadow: '0 0 0 0 rgba(0,229,255,0)' }, { boxShadow: '0 0 0 3px rgba(0,229,255,.9), 0 0 46px rgba(0,229,255,.6)' }, { boxShadow: '0 0 0 0 rgba(0,229,255,0)' }], { duration: 1200, delay: 250 }); };

  const open = async (o = {}) => {
    if (!el.hidden) return;
    list = steps(); if (!list.length) return;
    const need = list.findIndex(s => !optionsOf(s).some(x => x.sel));
    only = !!o.row; at = o.row ? Math.max(0, list.findIndex(s => s.id === o.row)) : o.first ? 0 : Math.max(0, need);   // opened by the app itself: what is missing
    el.hidden = false; document.body.classList.add('sd-open'); last = performance.now(); raf = requestAnimationFrame(loop);
    fade(el, true, 320); ensureHolo(); holo?.start();
    show(at, 1);
  };
  function close(keepRows = false) {
    if (el.hidden) return; quiet = true; seq++; holo?.show(null); holo?.stop();
    el.hidden = true; document.body.classList.remove('sd-open'); cancelAnimationFrame(raf);
    if (!keepRows && sum.getAttribute('aria-expanded') === 'true') { closing = true; sum.click(); closing = false; }
  }

  /* The app opens its rows; the dial opens over them. A tap on one part of the
     line says which question to ask; otherwise the first one missing, or the first. */
  sum.addEventListener('click', (e) => {
    if (closing || sum.getAttribute('aria-expanded') === 'true') return;
    const chip = e.target.closest('.sum-chip'); if (!chip) { intent = { first: true }; return; }   // Change: from the start
    const word = chip.textContent.replace(/^[A-Z](?=[A-Z])/, '').split(' · ')[0].trim();
    const s = steps().find(x => optionsOf(x).some(o => o.name === word || word.startsWith(o.name)));
    intent = s ? { row: s.id } : { first: true };
  }, true);
  new MutationObserver(() => { if (!setup.hidden && el.hidden && !closing) { const o = intent || {}; intent = null; open(o); } })
    .observe(setup, { attributes: true, attributeFilter: ['hidden'] });
  if (!setup.hidden) open({});

  /* The thumb on the dial; a tap on a label turns to it. */
  let drag = null;
  const angleAt = (x, y) => { const r = dial.getBoundingClientRect(); return Math.atan2(x - (r.left + r.width / 2), -(y - (r.top + r.height / 2))) * 180 / Math.PI; };
  dial.addEventListener('pointerdown', (e) => { if (quiet) return; e.preventDefault(); dial.setPointerCapture(e.pointerId);
    drag = { a0: angleAt(e.clientX, e.clientY), r0: target, x: e.clientX, y: e.clientY, t: performance.now(), v: 0, la: 0, lt: performance.now(), moved: false }; });
  dial.addEventListener('pointermove', (e) => { if (!drag) return;
    let d = angleAt(e.clientX, e.clientY) - drag.a0; if (d > 180) d -= 360; if (d < -180) d += 360;
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 6) drag.moved = true;
    const now = performance.now(); drag.v = (d - drag.la) / Math.max(1, now - drag.lt) * 1000; drag.la = d; drag.lt = now;
    target = Math.max(-(opts.length - 1) * STEP - 20, Math.min(20, drag.r0 + d)); });
  const up = (e) => { if (!drag) return; const d = drag; drag = null;
    if (!d.moved) { const hit = e.target.closest?.('.sd-l'); if (hit) turnTo(els.indexOf(hit)); return; }
    turnTo(Math.round(-(target + Math.max(-60, Math.min(60, d.v * .12))) / STEP)); };
  dial.addEventListener('pointerup', up); dial.addEventListener('pointercancel', up);
  dial.addEventListener('wheel', (e) => { e.preventDefault(); turnTo(Math.round(-target / STEP) + (e.deltaY > 0 ? 1 : -1)); }, { passive: false });
  orb.addEventListener('click', keep); lens.addEventListener('click', keep);
  $('.sd-back').addEventListener('click', back); $('.sd-done').addEventListener('click', () => close());
  el.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { turnTo(Math.round(-target / STEP) + 1); e.preventDefault(); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { turnTo(Math.round(-target / STEP) - 1); e.preventDefault(); }
    else if (e.key === 'Enter') { keep(); e.preventDefault(); }
    else if (e.key === 'Escape') close();
  });
  return { open, close };
}
