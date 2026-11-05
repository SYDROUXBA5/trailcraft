/* The handler's squad picture: what the K9 team's phone shows during an
   incident, on the run screen itself. A slim layer of what the squad put on
   the map (perimeter lines, sightings, roadblocks, rally points) and the
   cover officer, one line of words ("Sighting 180 m ahead-left · cover 2A12
   about 40 m behind"), a few spoken lines in the coach's voice, each kind
   switchable, and big call buttons with a few seconds to take one back.

   The same picture is drawn twice over: on a real handler's run screen
   (incident-ui.js paintRun), and on the command map in pretend mode as
   "Handler's view", driven by the same pretend incident, so a chief sees
   what K9-1's phone shows without a second device.

   It is a rough guide from positions that are often 10-30 s old and a
   minute or more from a phone standing still or locked, and a website goes
   quiet with the screen locked. It is never a safety cue: the radio
   stays the main channel, and the words where it is set up say so.

   The rules of it (which points, which side, the words) are in incident.js;
   this is the screen. Call signs and labels were typed on other people's
   phones: they reach the page by textContent only. */

import { MARKS, HEAR_KINDS, HEAR_LABELS, HANDLER_NOTE, HANDLER_SHORT, CALL_KEYS, CALL_UNDO_MS,
         cleanHear, handlerPicture, handlerLine, freshSays, sayWords, RUN_MARKS, INC_COLOURS } from './incident.js';
import { form } from './sheet.js';

const EMPTY = { type: 'FeatureCollection', features: [] };
const SRC = 'hv-lines';
/* The same red as the command map's perimeter, so a line means one thing
   on both screens. */
const LINE_C = INC_COLOURS.perimeter;
const FULL = 1;   // markers stay at full strength behind 3D buildings
/* At most this many lines said at once: a burst of points (a sergeant
   setting up) is heard as the latest few, not a minute of talking. */
const SAY_MAX = 3;

let ctx = null;
const H = {
  where: null,          // 'run' | 'pretend' while a picture is up
  v: null,              // the last view painted (its hooks, for the buttons)
  box: null, els: null, // the box the picture is in, and its parts
  markers: new Map(),   // item id → { marker, el, pin, tag }
  incId: null,
  said: null,           // ids already said (incident.js freshSays)
  hear: cleanHear(null),
  pending: null,        // { kind, token, until, timer, tick } while Undo is offered
  lifted: false,        // the map's corner buttons moved up above the box
  pad: 0,               // the run camera's bottom padding asked for (app.js runPadding)
};

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const imperial = () => !!ctx?.imperial?.();

/** Which picture is up: 'run', 'pretend', or null. */
export const handlerOn = () => H.where;

/* ── The box: the line, the note, the calls, Undo ────────────────────── */
function mount(box) {
  box.textContent = '';
  const line = el('p', 'hv-line');
  const noteRow = el('div', 'hv-note-row');
  const note = el('p', 'hv-note', HANDLER_SHORT);
  const hear = el('button', 'btn ghost small hv-hear', 'Squad voice');
  hear.type = 'button';
  noteRow.append(note, hear);
  const calls = el('div', 'hv-calls');
  for (const k of CALL_KEYS) {
    const b = el('button', `hv-call hv-c-${RUN_MARKS[k]}`, k);
    b.type = 'button';
    b.dataset.call = k;
    calls.append(b);
  }
  const undo = el('div', 'hv-undo');
  undo.hidden = true;
  const undoText = el('span', 'hv-undo-text');
  const undoBtn = el('button', 'btn small hv-undo-btn', 'Undo');
  undoBtn.type = 'button';
  undo.append(undoText, undoBtn);
  box.append(line, calls, undo, noteRow);
  calls.addEventListener('click', (e) => {
    const b = e.target.closest('[data-call]');
    if (b) onCall(b.dataset.call);
  });
  undoBtn.addEventListener('click', onUndo);
  hear.addEventListener('click', openHear);
  H.box = box;
  H.els = { line, undo, undoText };
}

/* ── Calls, with a few seconds to take one back ──────────────────────── */
function onCall(key) {
  const v = H.v;
  if (!v?.call || !RUN_MARKS[key]) return;
  /* A second call settles the first: only the latest can be undone. */
  settle();
  let token = null;
  try { token = v.call(key); } catch { token = null; }
  if (!token) return;
  navigator.vibrate?.(35);
  const p = { key, token, until: Date.now() + CALL_UNDO_MS, timer: 0, tick: 0 };
  p.timer = setTimeout(settle, CALL_UNDO_MS);
  p.tick = setInterval(paintUndo, 500);
  H.pending = p;
  paintUndo();
}
function settle() {
  const p = H.pending;
  if (!p) return;
  clearTimeout(p.timer); clearInterval(p.tick);
  H.pending = null;
  paintUndo();
}
function onUndo() {
  const p = H.pending;
  if (!p) return;
  const late = Date.now() >= p.until;
  settle();
  let ok = false;
  if (!late) { try { ok = !!H.v?.undo?.(p.token); } catch { ok = false; } }
  ctx.toast(ok ? `${p.key} taken back` : `Too late to undo: ${p.key} has gone to the squad`);
}
function paintUndo() {
  const e = H.els;
  if (!e) return;
  const p = H.pending;
  e.undo.hidden = !p;
  if (!p) return;
  const s = Math.max(1, Math.ceil((p.until - Date.now()) / 1000));
  e.undoText.textContent = `${p.key} marked · goes to the squad in ${s} s`;
}

/* ── What to hear ────────────────────────────────────────────────────── */
async function openHear() {
  const fields = HEAR_KINDS.map(k => ({ key: k, label: HEAR_LABELS[k], value: H.hear[k] ? 'on' : 'off',
    choices: [{ value: 'on', text: 'Say it' }, { value: 'off', text: 'Off' }] }));
  const out = await form({ title: 'Squad voice', body: HANDLER_NOTE, fields, yes: 'Save', grid: true });
  if (!out) return;
  const next = {};
  for (const k of HEAR_KINDS) next[k] = out[k] !== 'off';
  H.hear = cleanHear(next);
  try { ctx.kv.set('squadHear', H.hear); } catch { /* kept for this visit */ }
}

/* ── The map: perimeter lines as a layer, points as markers ──────────── */
/* About one pin and its tag across and down, in pixels: closer than this two pins overlap. */
const PIN_W = 64, PIN_H = 44;
function paintMap(pic) {
  const g = ctx.getMap();
  const m = g?.map;
  if (!m || !g.GL) return;
  /* Not gated on isStyleLoaded: that is false whenever any tile is still
     coming in, which on a moving map is most of the time, and the lines
     were then never drawn. A style that truly is not ready throws, and the
     next paint tries again. */
  {
    try {
      if (!m.getSource(SRC)) m.addSource(SRC, { type: 'geojson', data: EMPTY });
      if (!m.getLayer(SRC)) {
        const paint = { 'line-color': LINE_C, 'line-width': 4, 'line-dasharray': [2, 1.2] };
        if (typeof m.setConfigProperty === 'function') paint['line-emissive-strength'] = 1;
        m.addLayer({ id: SRC, type: 'line', source: SRC, paint, layout: { 'line-cap': 'round', 'line-join': 'round' } });
      }
      m.getSource(SRC)?.setData({ type: 'FeatureCollection', features: pic.items.filter(i => i.pts).map(i => ({
        type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: i.pts.map(p => [p.lon, p.lat]) } })) });
    } catch { /* the style is reloading: the next paint puts it back */ }
  }
  const keep = new Set();
  /* The last known point first, the cover officer last: when the cover
     stands on another pin (at the point as the dog starts), it steps aside,
     never the point. Only the cover moves: a squad point (a sighting, a
     roadblock) is always drawn where it was put, as a real handler needs. */
  const points = pic.lkp ? [{ id: 'lkp', kind: 'lkp', pos: pic.lkp }] : [];
  points.push(...pic.items.filter(i => i.pos));
  if (pic.cover?.pos) points.push(pic.cover);
  /* Where the box covers the map (the map canvas's own pixels): in the
     pretend Handler's view a point under it is not drawn at all, rather than
     a pin cut off at its edge. On a real run screen nothing is hidden: a
     danger behind the handler shows through the glass, as it always has. */
  const canvas = m.getCanvas?.()?.getBoundingClientRect?.();
  const boxTop = H.v?.lift?.getBoundingClientRect?.()?.top;
  const under = canvas && Number.isFinite(boxTop) ? boxTop - canvas.top : Infinity;
  const placed = [];
  /* The handler's own spot counts as taken: the cover walks about 10 m
     behind, so its pin would otherwise stand right over the dog's dot. */
  if (H.v?.me) { try { const me = m.project([H.v.me.lon, H.v.me.lat]); if (me) placed.push({ x: me.x, y: me.y }); } catch { /* no projection yet */ } }
  for (const it of points) {
    keep.add(it.id);
    let p = H.markers.get(it.id);
    if (!p) {
      const e = el('div', `hv-mark hv-k-${it.kind}`);
      const pin = el('span', 'hv-pin', it.kind === 'cover' ? 'COVER' : it.kind === 'lkp' ? 'LKP' : MARKS[it.kind].short);
      const tag = el('span', 'hv-tag');
      e.append(pin, tag);
      p = { el: e, pin, tag, marker: new g.GL.Marker({ element: e, anchor: 'bottom', occludedOpacity: FULL }).setLngLat([it.pos.lon, it.pos.lat]).addTo(m) };
      H.markers.set(it.id, p);
    }
    p.marker.setLngLat([it.pos.lon, it.pos.lat]);
    let at = null;
    try { at = m.project([it.pos.lon, it.pos.lat]); } catch { /* no projection yet */ }
    p.el.classList.toggle('hv-under', H.v?.where === 'pretend' && !!at && at.y > under);
    let dx = 0;
    if (at) {
      if (it.kind === 'cover') while (placed.some(q => Math.abs(q.x - (at.x + dx)) < PIN_W && Math.abs(q.y - at.y) < PIN_H)) dx += PIN_W;
      placed.push({ x: at.x + dx, y: at.y });
    }
    if (p.dx !== dx) { p.dx = dx; p.marker.setOffset?.([dx, 0]); }
    const tag = it.kind === 'cover' ? it.name : (it.label || '');
    if (p.tag.textContent !== tag) p.tag.textContent = tag;
    p.el.setAttribute('aria-label', it.kind === 'cover' ? `Cover officer ${it.name}` : it.kind === 'lkp' ? 'Last known point' : MARKS[it.kind].label);
  }
  for (const [id, p] of H.markers) if (!keep.has(id)) { p.marker.remove(); H.markers.delete(id); }
}
function clearMap() {
  for (const p of H.markers.values()) p.marker.remove();
  H.markers.clear();
  const m = ctx?.getMap()?.map;
  if (!m) return;
  try { if (m.getLayer(SRC)) m.removeLayer(SRC); if (m.getSource(SRC)) m.removeSource(SRC); } catch { /* style gone */ }
}

/* ── Painting ────────────────────────────────────────────────────────── */
/** Draw the handler's picture, or take it away (null). `v` is
    { where, box, inc, marks, me, heading, cover, coverName, now, myUid,
      name(uid), call(key) → token, undo(token) → bool, voice }. */
export function paintHandler(v) {
  if (!ctx) return;
  if (!v) return clearHandler();
  if (H.where && (H.where !== v.where || H.box !== v.box)) clearHandler();
  H.where = v.where;
  H.v = v;
  if (H.box !== v.box) mount(v.box);
  v.box.hidden = false;
  /* Night is a signal the caller has (the sun on the run screen, the
     squad's Night switch in Handler's view), never the phone's theme. */
  v.box.classList.toggle('hv-night', !!v.night);
  lift(v);
  if (H.incId !== v.inc?.id) { H.incId = v.inc?.id ?? null; H.said = null; }
  const pic = handlerPicture({ inc: v.inc, marks: v.marks, me: v.me, heading: v.heading, cover: v.cover,
                               coverName: v.coverName, now: v.now });
  const line = handlerLine(pic, { imperial: imperial(), now: v.now });
  if (H.els.line.textContent !== line) H.els.line.textContent = line;
  paintMap(pic);
  const fresh = freshSays({ pic, said: H.said, hear: H.hear, me: v.myUid });
  H.said = fresh.said;
  /* A squad line waits for the coach to finish rather than cutting a cue
     off mid-word (app.js speakSoon); the coach's own cues still come first. */
  const say = ctx.speakSoon ?? ctx.speak;
  if (fresh.say.length && v.voice !== false && say) {
    const words = fresh.say.slice(-SAY_MAX).map(it => sayWords(it, it.kind === 'cover' ? '' : (v.name?.(it.by) || ''), imperial()));
    try { say(words.join('. ')); } catch { /* no voice here */ }
  }
  return pic;
}

/* The box sits over the bottom of the map. The map's corner buttons (find
   me, map style) move up above it, and on the run screen the camera keeps
   the handler's dot above it too, or the handler's own position, the
   latest trail and whoever is behind end up under the buttons. Only while
   a picture is up: a training run never gets here, so its screen is as it
   always was. */
function lift(v) {
  const top = (v.lift || v.box).getBoundingClientRect?.().top;
  if (!Number.isFinite(top)) return;
  const gap = Math.max(0, Math.round(window.innerHeight - top));
  const root = document.documentElement;
  root.style.setProperty('--hv-gap', `${gap}px`);
  if (!H.lifted) { root.classList.add('hv-lift'); H.lifted = true; }
  /* In 10 px steps, so the Undo strip coming and going does not ease the
     camera every second. */
  const pad = v.where === 'run' ? Math.ceil((gap + 20) / 10) * 10 : 0;
  if (pad !== H.pad && (pad || H.pad)) { H.pad = pad; try { ctx.runPadding?.(pad); } catch { /* no map */ } }
}
function unlift() {
  if (H.lifted) { document.documentElement.classList.remove('hv-lift'); H.lifted = false; }
  if (H.pad) { H.pad = 0; try { ctx.runPadding?.(0); } catch { /* no map */ } }
}

/** Everything of the picture off the screen and the map. A cheap no-op
    when nothing is up, as on every training run. */
export function clearHandler() {
  if (!H.where && !H.box && !H.markers.size) return;
  settle();
  clearMap();
  unlift();
  if (H.box) { H.box.hidden = true; H.box.textContent = ''; H.box.classList.remove('hv-night'); }
  H.where = null; H.v = null; H.box = null; H.els = null;
  H.said = null; H.incId = null;
}

export function initHandler(c) {
  ctx = c;
  try { H.hear = cleanHear(ctx.kv.get('squadHear', null)); } catch { /* every kind on */ }
}
