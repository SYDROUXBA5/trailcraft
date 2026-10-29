/* Contamination people: other people's lines across or beside a trail.

   Each one is an entry on the trail's session (data.contamination), with
   its own id, so a walk that comes back by QR code goes to that person's
   line and to nobody else's. An entry is laid one of two ways:

     guided — the handler draws the route on the map, the code carries it,
              and the person's phone walks them along it;
     free   — nothing is drawn; the code asks their phone to record wherever
              they walk.

   Either way their phone records the real walk, GPS and clock, and hands it
   back as a walked contamination card. Until then a drawn line is only a
   sketch timed from the main trail (geo.js contamTimed), and nothing here
   claims an age for it.

   Old entries ({ who, order, laidAt, points }, no id) keep working: they are
   drawn lines, they count for the levels exactly as they always did, and
   they get an id only if the handler asks for their code. Everything here is
   plain data in, plain data out, so the tests run it without a phone. */

import { dist, densify, pathLen } from './geo.js';
import { hexToRgb } from './colours.js';
import { unwalkedPlan, noLineYet } from './debrief.js';

/* Four colours, none of them the trail's gold, the footprints' navy, the
   dog's white or the wind's pale blue (the defaults in Settings). They are
   set at four different lightnesses (CIELAB L* about 46, 80, 71 and 48) and
   checked with red-green colour blindness simulated (deuteranopia and
   protanopia): every pair stays at least 30 ΔE apart there, and the first
   two handed out, so the first two people on any trail, differ most in
   lightness. Violet stays first, as every contamination line was violet
   before there could be several. The pale end of each cloud is kept off
   white and the wind's colour. On a page printed in black and white they
   still go from dark to light, and the legend always says the colour's name
   next to the person's, so colour is never the only way to tell who is who. */
export const CONTAM_COLOURS = Object.freeze([
  Object.freeze({ name: 'Violet', hex: '#7A52E0', dark: '#4B2A9E', light: '#B9A3F2' }),
  Object.freeze({ name: 'Sky blue', hex: '#86D0FF', dark: '#2F86C4', light: '#7FE3F0' }),
  Object.freeze({ name: 'Salmon', hex: '#FF8F6B', dark: '#C4553A', light: '#FFC0A8' }),
  Object.freeze({ name: 'Teal', hex: '#0B7F74', dark: '#075A52', light: '#5FC2B4' }),
]);

/** Which colour an entry is drawn in: its own, or its place in the list for
    an old entry (or one that came in a share link, which carries lines only). */
export function colourIndex(c, i = 0) {
  const ci = c?.ci;
  return Number.isInteger(ci) && ci >= 0 ? ci % CONTAM_COLOURS.length : Math.max(0, i) % CONTAM_COLOURS.length;
}
export const contamColour = (c, i = 0) => CONTAM_COLOURS[colourIndex(c, i)];

/** A colour in CIELAB (D65), for telling how far apart two colours look. */
export function labOf(hex) {
  const lin = (v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const [r, g, b] = hexToRgb(hex).map(lin);
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const X = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
  const Y = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
  const Z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
  return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
}
/** How far apart two colours look (CIE76 ΔE): under about 20, two thin
    lines on a satellite picture are easily taken for each other. */
export const deltaE = (a, b) => { const x = labOf(a), y = labOf(b); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]); };
const NEAR_DE = 20;
const isHexColour = (s) => typeof s === 'string' && /^#[0-9a-fA-F]{6}$/.test(s);

/** The first colour no entry on this trail is using yet; once all are taken,
    they go round again from the one used least. `avoid` is the handler's own
    colours from Settings (dog, scent, footprints): a contamination colour
    that looks like one of them is skipped, unless every one does. */
export function nextColour(list = [], avoid = []) {
  const used = new Array(CONTAM_COLOURS.length).fill(0);
  (Array.isArray(list) ? list : []).forEach((c, i) => { used[colourIndex(c, i)]++; });
  const mine = (Array.isArray(avoid) ? avoid : []).filter(isHexColour);
  const clash = CONTAM_COLOURS.map(c => mine.some(h => deltaE(c.hex, h) < NEAR_DE));
  const open = clash.every(Boolean) ? clash.map(() => false) : clash;
  let best = -1;
  for (let i = 0; i < CONTAM_COLOURS.length; i++) {
    if (open[i]) continue;
    if (best < 0 || used[i] < used[best]) best = i;
  }
  return best;
}

const ID = /^[\w-]{1,32}$/;
export const okId = (s) => typeof s === 'string' && ID.test(s);
const fin = (n) => typeof n === 'number' && Number.isFinite(n);
const okPt = (p) => !!p && fin(p.lat) && fin(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180;

/** guided (a line drawn to walk) or free (no line: walk where you like). */
export const contamWay = (c) => (c?.way === 'free' ? 'free' : 'guided');

/** drawn: a line on the map and nothing more yet. waiting: their code has
    been handed over, or there was never a line to draw (free), and the walk
    has not come back. walked: the real walk is in. */
export function contamStatus(c) {
  if (c?.walked === true && Array.isArray(c.points) && c.points.length > 1) return 'walked';
  if (contamWay(c) === 'free' || c?.status === 'waiting') return 'waiting';
  return 'drawn';
}

/** A new entry. `of` is the trail it belongs to (the plan's id, or the
    session's own), which the code carries and the walk brings back. */
export function newContam({ id, of, who, order, way = 'guided', points = [], ci = 0, now = Date.now() }) {
  const free = way === 'free';
  const pts = free ? [] : (Array.isArray(points) ? points : []);
  return {
    id, of, who: String(who || 'Someone').slice(0, 40),
    order: order === 'after' ? 'after' : 'before',
    way: free ? 'free' : 'guided',
    status: free ? 'waiting' : 'drawn',
    ci,
    laidAt: pts[0]?.t ?? now,
    points: pts,
  };
}

/* ── Real times ───────────────────────────────────────────────────────
   A walked line has a clock, and the clock says whether it came before or
   after the main trail, whatever was chosen when it was planned. */

/** Before or after the main trail, from the two clocks. `overlap` when the
    two walks were going on at the same time: then it is whichever started
    first. Null when either has no clock. */
export function orderFromTimes(trail, pts) {
  const ts = (a) => (Array.isArray(a) ? a.map(p => p?.t).filter(fin) : []);
  const a = ts(trail), b = ts(pts);
  if (!a.length || !b.length) return null;
  const a0 = Math.min(...a), a1 = Math.max(...a), b0 = Math.min(...b), b1 = Math.max(...b);
  if (b1 <= a0) return { order: 'before', overlap: false, gapMs: a0 - b1 };
  if (b0 >= a1) return { order: 'after', overlap: false, gapMs: b0 - a1 };
  return { order: b0 < a0 ? 'before' : 'after', overlap: true, gapMs: 0 };
}

/** Lines resampled for comparing, capped so a long walk cannot stall a
    phone: about two thousand points each, however long. */
function sampled(pts) {
  const line = (Array.isArray(pts) ? pts : []).filter(okPt);
  if (line.length < 2) return line;
  const spacing = Math.max(5, pathLen(line) / 2000);
  return densify(line, spacing);
}

/** Where a walked line really meets the trail: every stretch of it within
    `nearM` of the main trail, with how long after the trail was laid at
    that spot it went by (negative: before). Only lines with clocks can say;
    without them this is empty. A crossing is counted once per stretch, at
    its closest point. */
export function crossings(trail, pts, nearM = 15) {
  const T = sampled(trail).filter(p => fin(p.t));
  const W = sampled(pts).filter(p => fin(p.t));
  if (T.length < 2 || W.length < 2) return [];
  const out = [];
  let cur = null;
  for (const w of W) {
    let best = Infinity, at = null;
    for (const p of T) {
      const d = dist(w, p);
      if (d < best) { best = d; at = p; }
    }
    if (best <= nearM) {
      if (!cur || best < cur.d) cur = { ...(cur || {}), d: best, t: w.t, dtMs: w.t - at.t, lat: w.lat, lon: w.lon };
    } else if (cur) { out.push(cur); cur = null; }
  }
  if (cur) out.push(cur);
  return out;
}

const mins = (ms) => Math.max(1, Math.round(Math.abs(ms) / 60000));
const minWords = (ms) => {
  const m = mins(ms);
  return m < 90 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
};

/** The main trail's line, when its clock is a real one to measure a walk
    against; null when it is not. A plan's drawn line (store.js planSession)
    is timed as if it had been walked and finished the moment it was drawn,
    which is a made-up clock: a person who really walked before the trail
    would read as after it. A blind trail has no line at all yet. Until the
    real line is in, nothing is worked out from the trail's clock. */
export function trailClock(data) {
  if (!data || unwalkedPlan(data) || noLineYet(data)) return null;
  return Array.isArray(data.trail) && data.trail.length > 1 ? data.trail : null;
}

/** One line of the legend for an entry: what it is, in words a handler
    reads at a glance. A drawn line has no walked clock, so it gets no age.
    `trail` is trailClock's: with no real trail clock yet, a walk is only
    said to be in. */
export function contamWords(c, trail) {
  const st = contamStatus(c);
  if (st === 'waiting') return contamWay(c) === 'free' ? 'waiting for their walk' : 'drawn, waiting for their walk';
  if (st === 'drawn') return `drawn, not walked, ${c?.order === 'after' ? 'after' : 'before'} the trail`;
  if (!(Array.isArray(trail) && trail.length > 1)) return 'walked, waiting for the main trail';
  const hit = crossings(trail, c.points)[0];
  if (hit) {
    return hit.dtMs >= 0 ? `crossed ${minWords(hit.dtMs)} after the trail` : `crossed ${minWords(hit.dtMs)} before the trail`;
  }
  const ord = orderFromTimes(trail, c.points);
  if (!ord) return 'walked';
  if (ord.overlap) return 'walked while the trail was being laid';
  return `walked ${minWords(ord.gapMs)} ${ord.order} the trail, never within 15 m of it`;
}

/* ── A walk coming back ───────────────────────────────────────────────
   The walked contamination card names the trail (planId) and the person's
   entry on it (cid). Every session on this phone holding that entry is the
   same trail: a second run of a trail is a copy of it, contamination and
   all (store.js runAgain), so the walk belongs on each of them. */

/** Which sessions a walked contamination card goes to.

    `sessions` is this phone's own (never one kept from someone else's
    link), each { id, planOf, deleted, contamination }. Returns
      { ids, entry }          — attach to these;
      { ask: 'replace', ids } — the entry already has a different walk;
      { why }                 — nothing to attach to: 'other' (no trail here
                                is that one), 'gone' (the trail is here but
                                that person is not on it any more), 'dup'
                                (this very walk is already in), 'bad' (not
                                a walked contamination card). */
export function contamWalkFor(card, sessions = []) {
  if (card?.kind !== 5 || !okId(card.planId) || !okId(card.cid) || !(card.points?.length > 1)) return { why: 'bad' };
  const live = (Array.isArray(sessions) ? sessions : []).filter(s => s && !s.deleted);
  const trail = live.filter(s => s.id === card.planId || s.planOf === card.planId
    || (Array.isArray(s.contamination) && s.contamination.some(c => c?.of === card.planId)));
  if (!trail.length) return { why: 'other' };
  const holding = trail.filter(s => Array.isArray(s.contamination)
    && s.contamination.some(c => c?.id === card.cid && (c.of == null || c.of === card.planId)));
  if (!holding.length) return { why: 'gone' };
  const entryOf = (s) => s.contamination.find(c => c?.id === card.cid);
  const fresh = holding.filter(s => !sameWalk(entryOf(s), card));
  if (!fresh.length) return { why: 'dup' };
  const entry = entryOf(fresh[0]);
  /* A different walk already in: the person walked it twice, or a second
     card was made. Replacing a real walk is asked, never assumed. */
  if (fresh.some(s => contamStatus(entryOf(s)) === 'walked')) return { ask: 'replace', ids: fresh.map(s => s.id), entry };
  return { ids: fresh.map(s => s.id), entry };
}

/** Whether an entry already holds this very walk: same first fix, same end. */
export function sameWalk(c, card) {
  if (contamStatus(c) !== 'walked' || !(card?.points?.length > 1)) return false;
  const a = c.points, b = card.points;
  const near = (p, q) => Math.abs(p.lat - q.lat) < 2e-5 && Math.abs(p.lon - q.lon) < 2e-5;
  return a[0].t === b[0].t && near(a[0], b[0]) && near(a[a.length - 1], b[b.length - 1]);
}

/** The session's contamination list with the walk put on its entry. The
    entry keeps its id, who and colour; its line becomes the real walk, and
    whether it came before or after the trail comes from the two clocks.
    `contradicts` is set when that is not what was chosen, for the handler
    to be told. */
export function attachWalk(list, cid, card, trail, now = Date.now()) {
  const entries = Array.isArray(list) ? list : [];
  const at = entries.findIndex(c => c?.id === cid);
  if (at < 0) return null;
  const was = entries[at];
  /* `trail` is trailClock's: null while the main trail's clock is made up
     (a plan not walked yet) or missing, and then what was chosen stands
     until the real line comes in (reorderContam). */
  const ord = orderFromTimes(trail, card.points);
  /* What was chosen at the planning stage, even when a walk before this one
     had already moved the order. */
  const chosen = was.orderChosen === 'after' || was.orderChosen === 'before' ? was.orderChosen
    : was.order === 'after' ? 'after' : 'before';
  const order = ord ? ord.order : chosen;
  const { orderChosen: _was, ...kept } = was;
  const next = {
    ...kept,
    order,
    ...(order !== chosen ? { orderChosen: chosen } : {}),
    status: 'walked', walked: true,
    walkedAt: now,
    walkedBy: String(card.from || '').slice(0, 40) || null,
    laidAt: card.points[0].t,
    points: card.points.map(p => ({ lat: p.lat, lon: p.lon, t: p.t })),
  };
  /* A free walk had no line, and a guided one's drawn line is replaced: the
     sketch was only ever a guess at where they would go. */
  const out = entries.slice();
  out[at] = next;
  return { list: out, entry: next, order, chosen, contradicts: order !== chosen, overlap: !!ord?.overlap };
}

/** The walked entries measured again against the trail's real clock, once
    it is in (the layer's walked card on a plan, or a blind trail's line).
    Each keeps what was chosen when it was planned, as orderChosen, only
    while the clocks say otherwise. `turned` is the entries whose order now
    differs from what was chosen, for the handler to be told. */
export function reorderContam(list, trail) {
  const entries = Array.isArray(list) ? list : [];
  let changed = false;
  const turned = [];
  const out = entries.map(c => {
    if (!contamWalked(c)) return c;
    const ord = orderFromTimes(trail, c.points);
    if (!ord) return c;
    const chosen = c.orderChosen === 'after' || c.orderChosen === 'before' ? c.orderChosen : c.order === 'after' ? 'after' : 'before';
    const next = { ...c, order: ord.order };
    if (ord.order !== chosen) { next.orderChosen = chosen; turned.push(next); } else delete next.orderChosen;
    if (next.order === c.order && next.orderChosen === c.orderChosen) return c;
    changed = true;
    return next;
  });
  return { list: out, changed, turned };
}

/** The rows of the map's key and the video's: one per named person, in
    their colour, with what their line is. Lines that came in a link carry
    no names, and get no key. */
export function contamKey(list, trail) {
  const entries = Array.isArray(list) ? list : [];
  if (!entries.some(c => typeof c?.who === 'string')) return [];
  return entries.map((c, i) => ({
    ci: colourIndex(c, i), hex: contamColour(c, i).hex, colour: contamColour(c, i).name,
    who: c?.who || `Contamination ${i + 1}`, words: contamWords(c, trail),
  }));
}

/** Entries ready for their code: an old entry gets its id and trail here,
    the first time its code is asked for. */
export function withIds(list, of, makeId) {
  let changed = false;
  const out = (Array.isArray(list) ? list : []).map(c => {
    if (!c || (okId(c.id) && c.of)) return c;
    changed = true;
    return { ...c, id: okId(c.id) ? c.id : makeId(), of: c.of || of };
  });
  return { list: out, changed };
}

/** What the levels count as a cross-track or a walk along the trail, once
    real walks exist: see levels.js runFacts. Exported for the tests. */
export const contamWalked = (c) => contamStatus(c) === 'walked';
