/* The replay as a video.

   A handler wants to send the run to someone: the dog's route drawing
   itself over the ground, the marks as they were made, the wind, and the one
   sentence the run earned. This module makes that file. It is a tall frame
   (9:16, the shape a phone and every messaging app shows whole), the whole
   run sped up to fit the length that was asked for, and it is recorded while
   it plays: the browser's own recorder is handed a canvas and encodes what
   is drawn on it.

   Two halves. The first is plain arithmetic and words with nothing of the
   browser in it, so it is tested in node (test/clip.test.mjs): where the
   run's clock is at each moment of the video, when the answer may appear,
   which file type the device can record, what the strips say. The second
   draws the frame and drives the recorder, and only ever runs in the app. */

import { fmtDist, fmtDur, fmtSpeed, cardinal, pathLen } from './geo.js';
import { ranBlind, noLineYet, trailShown } from './debrief.js';
import { fileBase, resultSentence, blindSummary } from './share.js';

/** The frame and its timing. A 720 by 1280 frame at 5 Mbit/s is sharp on a
    phone and still a file a messaging app takes: a minute is under 40 MB. */
export const CLIP = Object.freeze({
  W: 720, H: 1280, FPS: 30, BPS: 5000000,
  /* The closing card, long enough to read one sentence. */
  CARD_S: 2,
  /* The laid trail of a blind run, shown at the end for this long. */
  REVEAL_S: 2.5,
  /* The card held a moment past the length asked for before the recorder is
     stopped: an encoder a few frames behind loses those, not the card. */
  DRAIN_S: 0.2,
  /* How long the recorder is given to hand the file over once stopped. */
  STOP_WAIT_MS: 5000,
  /* A file this much shorter than asked has lost its end, which is the
     reveal and the result: it is not offered as the video. */
  SHORT_S: 0.75,
  LENGTHS: Object.freeze([15, 30, 60]),
});

/* ── What the device can record ───────────────────────────────────────
   MP4 with H.264 first: it is what Photos, Messages and every social app
   take without converting, and what an iPhone records. The profile and
   level are spelt out where a browser wants them (High 4.0 holds a
   720 by 1280 frame at 30 a second with room to spare), then the looser
   spellings Safari answers to. WebM is what is left on a browser with no
   H.264 encoder: it plays, but Photos will not keep it. */
export const CLIP_TYPES = Object.freeze([
  'video/mp4;codecs=avc1.640028',
  'video/mp4;codecs=avc1.4D401F',
  'video/mp4;codecs=avc1.42E01F',
  'video/mp4;codecs=avc1',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
]);

/** The first type the recorder says it can make, with the plain type and
    the extension the file is saved under, or null when it can make none.
    `supports` is MediaRecorder.isTypeSupported; one that throws is a no. */
export function pickType(supports, types = CLIP_TYPES) {
  if (typeof supports !== 'function') return null;
  for (const mime of types) {
    let ok = false;
    try { ok = !!supports(mime); } catch { ok = false; }
    if (!ok) continue;
    const type = mime.split(';')[0];
    return { mime, type, ext: type === 'video/mp4' ? 'mp4' : 'webm' };
  }
  return null;
}

/** Can this browser record a canvas at all, and as what? */
export function clipSupport(env = globalThis) {
  const MR = env.MediaRecorder;
  const canvas = env.HTMLCanvasElement?.prototype;
  if (typeof MR !== 'function' || typeof canvas?.captureStream !== 'function') return null;
  return pickType((m) => MR.isTypeSupported(m));
}

/** Can a web page keep this screen on? Nobody touches the phone while it
    records, so without a hold it locks itself (an iPhone after thirty
    seconds, unless told otherwise), the page goes to the background and the
    recording stops. iOS before 16.4 has no such hold for a page at all. */
export const canHoldScreen = (env = globalThis) => typeof env.navigator?.wakeLock?.request === 'function';

/** How long a finished file really plays for, in seconds, or null when the
    device will not say. A recorder that fell behind hands over a file that
    stops early, and what is missing is always the end. A WebM straight from
    the recorder has no length written in it, so the player is sent to the
    end to find out. */
export function clipSeconds(blob, { doc = globalThis.document, urls = globalThis.URL, ms = 2500 } = {}) {
  return new Promise((res) => {
    let url = null, v = null, timer = 0, over = false;
    const end = (s) => {
      if (over) return;
      over = true;
      clearTimeout(timer);
      try { v.onloadedmetadata = v.onseeked = v.ondurationchange = v.onerror = null; v.removeAttribute?.('src'); v.load?.(); } catch { /* never made */ }
      try { if (url) urls.revokeObjectURL(url); } catch { /* nothing to let go */ }
      res(Number.isFinite(s) && s > 0 ? s : null);
    };
    try {
      v = doc.createElement('video');
      v.preload = 'metadata'; v.muted = true; v.playsInline = true;
      v.onloadedmetadata = () => {
        if (Number.isFinite(v.duration)) return end(v.duration);
        const found = () => { if (Number.isFinite(v.duration)) end(v.duration); };
        v.ondurationchange = found;
        v.onseeked = () => end(v.duration);
        try { v.currentTime = 1e9; } catch { end(null); }
      };
      v.onerror = () => end(null);
      timer = setTimeout(() => end(null), ms);
      url = urls.createObjectURL(blob);
      v.src = url;
    } catch { end(null); }
  });
}

/* ── Time ─────────────────────────────────────────────────────────────
   The video is the length that was asked for, to the frame. The closing
   card takes the last two seconds; a blind run's reveal takes the two and a
   half before that; the run itself fills what is left, start to end, at one
   steady speed. The on-screen speed button has no part in it. */

/** The three stretches of a video `seconds` long. A length too short to
    hold them (never offered) gives the run at least a second. */
export function clipPlan(seconds, { reveal = false } = {}) {
  const total = Number.isFinite(seconds) && seconds > 0 ? seconds : CLIP.LENGTHS[0];
  const cardS = Math.min(CLIP.CARD_S, Math.max(0, total - 1));
  const revealS = reveal ? Math.min(CLIP.REVEAL_S, Math.max(0, total - cardS - 1)) : 0;
  return { total, runS: total - cardS - revealS, revealS, cardS };
}

/** Where the video is at `t` seconds in: which stretch, how far through the
    run (`f`, 0 to 1), how far through this stretch (`k`), and whether the
    answer is on the map yet. `answer` is the whole of the honest reveal:
    with a reveal planned it is false for every moment the route is still
    drawing. */
export function clipAt(plan, t) {
  const x = Math.max(0, Number.isFinite(t) ? t : 0);
  const hidden = plan.revealS > 0;
  if (x < plan.runS) return { phase: 'run', f: plan.runS > 0 ? x / plan.runS : 1, k: plan.runS > 0 ? x / plan.runS : 1, answer: !hidden };
  if (x < plan.runS + plan.revealS) return { phase: 'reveal', f: 1, k: (x - plan.runS) / plan.revealS, answer: true };
  if (x < plan.total) return { phase: 'card', f: 1, k: plan.cardS > 0 ? (x - plan.runS - plan.revealS) / plan.cardS : 1, answer: true };
  return { phase: 'done', f: 1, k: 1, answer: true };
}

/** The run's own clock at that moment of the video. */
export const runClock = (plan, t, from, to) => from + clipAt(plan, t).f * (to - from);

/* ── The honest reveal ────────────────────────────────────────────────
   A video of a blind run that showed the laid trail from its first frame
   would say the handler was following a line on a screen. So the answer is
   drawn when the handler had it, by the same test every other screen uses
   (debrief.js ranBlind): a blind run keeps it back until the route has
   finished drawing; a coached run, one with the trail shown, or one the
   handler says they knew, has it from the start, because that is how it was
   run. A blind trail with no line, and a search with no hides kept, have
   nothing to show at either end. `kind` is the target's: 'person' for a
   trail, 'hide' for a search. */
export function answerPlan(session, kind) {
  const d = session?.data;
  if (!d) return 'none';
  if (kind === 'hide') {
    if (!(Array.isArray(d.hides) && d.hides.length)) return 'none';
  } else if (noLineYet(d) || !(Array.isArray(d.trail) && d.trail.length > 1)) return 'none';
  return ranBlind(d) ? 'end' : 'start';
}

/** Whether Save video is offered at all. Never while the run is being
    marked: before See the result the answer is still kept from the handler
    (the video would be a way round that), and while marks are being edited
    the video would be of marks not yet kept. */
export const clipOffered = ({ run = false, marking = false, recording = false } = {}) => !!run && !marking && !recording;

/** The session as the video draws it while the answer is held back:
    nothing laid, nothing set, no scent, no ground. Only ever drawn. Unlike
    the marking's hidden copy it stays the kind of run it was, so its marks
    are the same before the reveal and after. */
export function withoutAnswer(session) {
  return { ...session, data: { ...session.data, trail: null, planTrail: null, contamination: null,
    hides: [], surf: null, surfFix: null } };
}

/* ── Words ────────────────────────────────────────────────────────── */

/** The top strip: the dog, then the day, how far the dog went and how long
    it took, then the level the team has earned. `day` turns a time into a
    date in the reader's own format; `imperial` is the units setting. */
export function clipLines({ dog = null, track = [], level = null, imperial = false, day = null } = {}) {
  const tr = Array.isArray(track) ? track.filter(p => Number.isFinite(p?.lat) && Number.isFinite(p?.lon)) : [];
  const a = tr[0]?.t, b = tr.length ? tr[tr.length - 1].t : NaN;
  const ms = Number.isFinite(a) && Number.isFinite(b) && b > a ? b - a : null;
  const stats = [
    Number.isFinite(a) && typeof day === 'function' ? day(a) : null,
    tr.length > 1 ? fmtDist(pathLen(tr), !!imperial) : null,
    ms != null ? fmtDur(ms) : null,
  ].filter(Boolean);
  return {
    title: typeof dog === 'string' && dog.trim() ? dog.trim() : 'The dog',
    stats: stats.join(' · '),
    level: typeof level === 'string' && level.trim() ? level.trim() : null,
  };
}

/** The closing card: the run's one sentence, said as the result screen says
    it (share.js), and the plain fact of how it was run. A blind trail with
    no line says so; a run that was never graded says only what it was. */
export function clipClosing(session, { dog = null, units = {}, kind = 'person' } = {}) {
  const d = session?.data ?? {};
  const name = typeof dog === 'string' && dog.trim() ? dog.trim() : null;
  let sentence;
  if (kind !== 'hide' && noLineYet(d)) sentence = blindSummary(d, name, units).sentence;
  else sentence = (d.result && resultSentence(d.result, name, units, session?.summary))
    || (typeof session?.summary === 'string' && session.summary.trim())
    || `${name ?? 'The dog'}’s ${kind === 'hide' ? 'search' : 'run'}.`;
  /* One test for "blind", the same one as everywhere else. */
  const tag = kind !== 'hide' && noLineYet(d) ? 'Blind trail'
    : ranBlind(d) ? (kind === 'hide' ? 'Blind search' : 'Blind run')
      : d.coach?.assisted ? 'Coached run'
        : trailShown(d) ? (kind === 'hide' ? 'Hides shown during the search' : 'Trail shown during the run')
          : 'The handler knew the answer';
  return { sentence, tag };
}

/** The wind badge: where the arrow points (the way the air is going, with
    north at the top) and what it says. The handler's own word for the wind
    comes first when they gave one (`felt`, field.js windWords in its short
    form); a swirling or calm wind has no arrow. Null with no wind known. */
export function windLine(wx, { felt = null, mode = null, imperial = false } = {}) {
  const dir = Number.isFinite(wx?.wind_direction) ? wx.wind_direction : null;
  const steady = mode !== 'swirl' && mode !== 'calm';
  const toward = steady && dir != null ? (dir + 180) % 360 : null;
  if (typeof felt === 'string' && felt.trim()) {
    const said = felt.trim();
    return { toward, words: `Wind: ${said.charAt(0).toLowerCase()}${said.slice(1)}` };
  }
  if (dir == null) return null;
  const speed = Number.isFinite(wx.wind_speed) ? `, ${fmtSpeed(wx.wind_speed, !!imperial)}` : '';
  return { toward, words: `Wind: from ${cardinal(dir)}${speed} (forecast)` };
}

/** The map's credit as the live map shows it, tidied for one line: the
    "Improve this map" link is an invitation to tap, not a credit. With
    nothing to read (the control not drawn yet) the credit the map's own
    licence asks for is said anyway: a video with the map in it and no
    credit is not ours to send. */
export function creditLine(shown, { mapbox = false } = {}) {
  const said = String(shown ?? '').replace(/Improve this map/gi, ' ').replace(/\s+/g, ' ').trim();
  return said || (mapbox ? '© Mapbox © OpenStreetMap' : '© OpenStreetMap contributors');
}

/** The picture inside a CSS `url(...)`, when it is one written into the
    stylesheet itself (a data: address). That is how the live map carries
    Mapbox's wordmark, which its terms ask for beside the text credit, and a
    picture from the page's own stylesheet can be drawn into the video
    without a request and without spoiling the canvas for the recorder. */
export function cssUrl(value) {
  const m = /^url\((['"]?)([\s\S]*)\1\)$/.exec(String(value ?? '').trim());
  return m && /^data:image\//i.test(m[2]) ? m[2].replace(/\\(["'])/g, '$1') : null;
}

/** The file's name: the one every other export of this run carries. */
export const clipName = (model, ext) => `${fileBase(model)}.${ext === 'webm' ? 'webm' : 'mp4'}`;

/** "12 s of 30 s" under the progress bar. */
export const clipProgress = (t, total) => `${Math.min(total, Math.max(0, Math.floor(t)))} s of ${total} s`;

/* ── Geometry ─────────────────────────────────────────────────────── */

/** The part of a `sw` by `sh` picture that fills a `dw` by `dh` frame with
    none of the frame left empty: the middle of it, as wide or as tall as it
    goes. The map behind a phone is taller than 9:16 and a desktop's is far
    wider, and the run is framed in the middle of both. */
export function coverCrop(sw, sh, dw, dh) {
  if (!(sw > 0 && sh > 0 && dw > 0 && dh > 0)) return { x: 0, y: 0, w: 0, h: 0 };
  const want = dw / dh;
  if (sw / sh > want) { const w = sh * want; return { x: (sw - w) / 2, y: 0, w, h: sh }; }
  const h = sw / want;
  return { x: 0, y: (sh - h) / 2, w: sw, h };
}

/* What the run must stay clear of, in frame pixels. Not only this video's
   own strips: a tall video is made to be posted, and Reels and TikTok lay
   their caption and account over the bottom fifth or more and a column of
   buttons down the right edge, while Stories cover the top with their
   header. So the words start below that header (TOP_SAFE), the wind sits
   under the strip instead of in the bottom corner, and the route is fitted
   into what is left. The map itself still fills the whole frame. */
const TOP_SAFE = 70;
const STRIP = 176 + TOP_SAFE;                 // the top strip at its tallest, with a level line
const TOP = STRIP + 74, BOTTOM = 300, LEFT = 56, RIGHT = 110;
/* Under this line is the map's credit; no mark is named over it. */
const LOW = 120;

/** The padding, in the map's own pixels, that keeps a fitted run inside the
    part of the map the video shows and out from under its strips. */
export function framePadding(mapW, mapH) {
  const c = coverCrop(mapW, mapH, CLIP.W, CLIP.H);
  const k = c.w / CLIP.W || 1;             // map pixels to a frame pixel
  return {
    top: Math.round(c.y + TOP * k), bottom: Math.round(c.y + BOTTOM * k),
    left: Math.round(c.x + LEFT * k), right: Math.round(c.x + RIGHT * k),
  };
}

/** The dog's route as far as it had got at `at`: every fix up to then and
    the place between two fixes it had reached. `pts` are { x, y, t }, in
    time order. */
export function routeUntil(pts, at) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (p.t <= at) { out.push(p); continue; }
    const a = pts[i - 1];
    if (a && p.t > a.t && at > a.t) {
      const k = (at - a.t) / (p.t - a.t);
      out.push({ x: a.x + (p.x - a.x) * k, y: a.y + (p.y - a.y) * k, t: at });
    }
    break;
  }
  return out;
}

const overlap = (a, b, gap = 4) => a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

/** Where each mark's name goes. Marks made a few steps apart (Lost it, Cast,
    Re-found is the ordinary run of them) are a few pixels apart at the
    video's scale, and names all set the same distance above their dots pile
    into one unreadable heap. So the newest mark is named first, above its
    dot, and each older one takes the place above or else below its own dot
    if nothing is there yet; one with no room keeps its dot and loses its
    name, which the video said when it was the newest. `marks` are
    { kind, x, y, t, fresh } in frame pixels; `measure` gives a name's
    width; `avoid` are rectangles already spoken for (the wind, the reveal).
    Returns the marks on the frame, newest first, each with `label`
    ({ x, y, w, h }) or null. */
export function placeLabels(marks, measure, { topH = 0, avoid = [] } = {}) {
  const { W, H } = CLIP;
  const taken = avoid.filter(Boolean);
  const seen = (marks || []).map((m, i) => ({ m, i }))
    .filter(({ m }) => Number.isFinite(m.x) && Number.isFinite(m.y)
      && m.x >= -40 && m.x <= W + 40 && m.y >= topH && m.y <= H - LOW)
    .sort((a, b) => (b.m.fresh ? 1 : 0) - (a.m.fresh ? 1 : 0) || (b.m.t ?? 0) - (a.m.t ?? 0) || b.i - a.i);
  return seen.map(({ m }, n) => {
    const w = measure(m.kind) + 26, h = 38;
    const x = Math.min(W - 12 - w, Math.max(12, m.x - w / 2));
    const above = { x, y: Math.max(topH + 6, m.y - 58), w, h }, below = { x, y: m.y + 20, w, h };
    const free = (r) => r.y + r.h <= H - LOW + 30 && !taken.some(b => overlap(r, b));
    /* The newest is always named: it is the thing that just happened. */
    const label = free(above) ? above : free(below) ? below : n === 0 ? above : null;
    if (label) taken.push(label);
    return { ...m, label };
  });
}

/** Words broken into lines no wider than `maxW`, by whatever `measure` says
    a string's width is. A single word wider than the line keeps its line. */
export function wrapText(text, maxW, measure) {
  const lines = [];
  let line = '';
  for (const word of String(text ?? '').split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && measure(next) > maxW) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/* ── Drawing ──────────────────────────────────────────────────────────
   System type, so the video looks like the phone it was made on and needs
   no font to have loaded; the app's navy and gold. Sizes are for a frame
   720 wide watched on a phone: nothing under 17 px. */
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const NAVY = '11, 22, 48', GOLD = '#DDB95A', WHITE = '#FFFFFF';
const navy = (a) => `rgba(${NAVY}, ${a})`;
const face = (weight, size, italic = false) => `${italic ? 'italic ' : ''}${weight} ${size}px ${FONT}`;

/* A line of type made to fit: smaller down to `min`, then cut with an
   ellipsis, because a name can be any length and the strip cannot. */
function fitted(ctx, text, maxW, weight, size, min, italic = false) {
  let s = size;
  ctx.font = face(weight, s, italic);
  while (s > min && ctx.measureText(text).width > maxW) { s -= 1; ctx.font = face(weight, s, italic); }
  let out = text;
  while (out.length > 1 && ctx.measureText(out).width > maxW) out = `${out.slice(0, -2).trimEnd()}…`;
  return out;
}

function pill(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawTop(ctx, lines, clock, f) {
  const { W } = CLIP;
  const h = (lines.level ? 176 : 142) + TOP_SAFE;
  const g = ctx.createLinearGradient(0, 0, 0, h + 30);
  g.addColorStop(0, navy(0.72)); g.addColorStop(TOP_SAFE / (h + 30), navy(0.94));
  g.addColorStop(h / (h + 30), navy(0.9)); g.addColorStop(1, navy(0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, h + 30);

  const y0 = TOP_SAFE;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'right';
  ctx.font = face(700, 40);
  ctx.fillStyle = GOLD;
  ctx.fillText(clock, W - 36, y0 + 64);
  /* The widest the clock gets, so the name beside it does not shift as the digits change. */
  const clockW = ctx.measureText(clock.replace(/\d/g, '0')).width;
  /* Whose video it is, under the clock: up here it is clear of the caption
     a social app lays over the bottom of the frame. */
  ctx.font = face(700, 23);
  ctx.fillText('Trailcraft', W - 36, y0 + 104);
  const brandW = ctx.measureText('Trailcraft').width;

  ctx.textAlign = 'left';
  ctx.fillStyle = WHITE;
  ctx.fillText(fitted(ctx, lines.title, W - 72 - clockW - 20, 700, 46, 30), 36, y0 + 64);
  if (lines.stats) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.88)';
    ctx.fillText(fitted(ctx, lines.stats, W - 72 - brandW - 20, 500, 25, 19), 36, y0 + 104);
  }
  if (lines.level) {
    ctx.fillStyle = GOLD;
    ctx.fillText(fitted(ctx, lines.level, W - 72, 600, 23, 18, true), 36, y0 + 140);
  }
  /* How far through the run, as a thin line under everything said. */
  const y = h - 16;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
  pill(ctx, 36, y, W - 72, 5, 2.5); ctx.fill();
  ctx.fillStyle = GOLD;
  pill(ctx, 36, y, Math.max(5, (W - 72) * Math.min(1, Math.max(0, f))), 5, 2.5); ctx.fill();
  return h;
}

/* The bottom edge is the map's credit and nothing else: Mapbox's wordmark
   as the live map shows it (when the map is Mapbox's), and the credit text.
   It stays whole in the file wherever the video is posted. */
function drawBottom(ctx, credit, logo) {
  const { W, H } = CLIP;
  const g = ctx.createLinearGradient(0, H - LOW, 0, H);
  g.addColorStop(0, navy(0)); g.addColorStop(0.55, navy(0.86)); g.addColorStop(1, navy(0.95));
  ctx.fillStyle = g;
  ctx.fillRect(0, H - LOW, W, LOW);
  let left = 36;
  if (logo) {
    const lh = 26, lw = lh * ((logo.naturalWidth / logo.naturalHeight) || 88 / 23);
    try { ctx.drawImage(logo, 36, H - 30 - lh, lw, lh); left += lw + 24; } catch { /* the text credit still stands */ }
  }
  if (!credit) return;
  /* The credit is not decoration: it stays whole. Two lines before it is cut. */
  const maxW = W - 36 - left;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.86)';
  ctx.textAlign = 'right';
  let size = 18;
  ctx.font = face(500, size);
  while (size > 14 && ctx.measureText(credit).width > maxW) { size -= 1; ctx.font = face(500, size); }
  const rows = wrapText(credit, maxW, (s) => ctx.measureText(s).width).slice(0, 2);
  rows.forEach((row, i) => ctx.fillText(row, W - 36, H - 34 - (rows.length - 1 - i) * (size + 5)));
}

/* The wind, under the top strip on the left. Returns the room it took, so
   no mark is named over it. */
function drawWind(ctx, wind, topH) {
  if (!wind) return null;
  const cx = 62, cy = topH + 40, r = 26;
  ctx.fillStyle = navy(0.86);
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)'; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = WHITE; ctx.strokeStyle = WHITE; ctx.lineWidth = 3.5; ctx.lineCap = 'round';
  if (wind.toward == null) {
    /* No one direction to point: a ring, as the air panel draws a calm. */
    ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI * 2); ctx.stroke();
  } else {
    ctx.rotate(wind.toward * Math.PI / 180);      // north is up: 0 points to the top
    ctx.beginPath(); ctx.moveTo(0, 14); ctx.lineTo(0, -6); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, -17); ctx.lineTo(9, -3); ctx.lineTo(-9, -3); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  const words = fitted(ctx, wind.words, CLIP.W - 36 - (cx + r + 12) - 28, 600, 22, 17);
  const w = ctx.measureText(words).width + 28;
  ctx.fillStyle = navy(0.86);
  pill(ctx, cx + r + 12, cy - 21, w, 42, 21); ctx.fill();
  ctx.fillStyle = WHITE;
  ctx.fillText(words, cx + r + 26, cy + 1);
  ctx.textBaseline = 'alphabetic';
  return { x: cx - r, y: cy - r, w: 2 * r + 12 + w, h: 2 * r };
}

/* Who each contamination line is, under the wind on the left: a dot in the
   line's colour, the name and what the line is (contam.js contamKey). Only
   ever drawn once the answer is on the frame, as the lines are. Returns the
   room it took, so no mark is named over it. */
function drawKey(ctx, rows, top) {
  if (!(rows?.length)) return null;
  const x = 36, rowH = 34, padX = 14, shown = rows.slice(0, 4);
  ctx.save();
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  const said = shown.map(r => {
    const text = fitted(ctx, `${r.who} · ${r.words}`, CLIP.W * 0.6, 600, 20, 15);
    return { text, font: ctx.font, width: ctx.measureText(text).width };
  });
  const w = Math.max(...said.map(x => x.width)) + padX * 2 + 24, h = shown.length * rowH + 12;
  ctx.fillStyle = navy(0.86);
  pill(ctx, x, top, w, h, 16); ctx.fill();
  shown.forEach((r, i) => {
    const cy = top + 6 + rowH * i + rowH / 2;
    ctx.fillStyle = r.hex;
    ctx.beginPath(); ctx.arc(x + padX + 7, cy, 7, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = WHITE; ctx.lineWidth = 2; ctx.stroke();
    ctx.font = said[i].font;
    ctx.fillStyle = WHITE;
    ctx.fillText(said[i].text, x + padX + 24, cy + 1);
  });
  ctx.restore();
  return { x, y: top, w, h };
}

/* The dog's route, drawn again in code over the copied map. The map draws
   it too, but the ground is in relief there, and on relief the map lays
   every line flat on the ground and then draws its dots and footprints
   over the top whatever their order: once the laid trail and its scent are
   on, the route they are meant to be compared with is underneath them. */
function drawRoute(ctx, pts, dog, { thin = false } = {}) {
  if (!(pts?.length > 1)) return;
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const line = () => { ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y); ctx.stroke(); };
  /* The handler's own walk, beside a dog's own GPS track: thin and white, as
     the map draws it (app.js handler-line), never in the dog's colour, so on
     a phone-sized video it is not read as a second dog. */
  if (thin) {
    ctx.globalAlpha = 0.35; ctx.strokeStyle = '#0B1630'; ctx.lineWidth = 4; line();
    ctx.globalAlpha = 0.6; ctx.strokeStyle = WHITE; ctx.lineWidth = 2; line();
    ctx.restore();
    return;
  }
  ctx.globalAlpha = 0.6; ctx.strokeStyle = dog?.casing || '#0B1630'; ctx.lineWidth = 9; line();
  ctx.globalAlpha = 1; ctx.strokeStyle = dog?.colour || WHITE; ctx.lineWidth = 5; line();
  ctx.restore();
}

/* The marks, named in type made for the video. The map draws them too, but
   at the size a finger-length away wants; scaled into this frame its 11 px
   labels are a smudge. A mark just reached is gold for a moment, which is
   the only way a viewer knows something happened there. Every dot first,
   then the names where placeLabels found room, the newest last and so on
   top. */
function drawMarks(ctx, marks, topH, avoid) {
  ctx.font = face(700, 22);
  const placed = placeLabels(marks, (s) => ctx.measureText(s).width, { topH, avoid });
  for (const m of placed) {
    ctx.beginPath(); ctx.arc(m.x, m.y, 9, 0, Math.PI * 2);
    ctx.fillStyle = m.fresh ? GOLD : WHITE; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = navy(1); ctx.stroke();
  }
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = face(700, 22);
  for (let i = placed.length - 1; i >= 0; i--) {
    const m = placed[i], r = m.label;
    if (!r) continue;
    ctx.fillStyle = m.fresh ? GOLD : navy(0.9);
    pill(ctx, r.x, r.y, r.w, r.h, 19); ctx.fill();
    ctx.fillStyle = m.fresh ? navy(1) : WHITE;
    ctx.fillText(m.kind, r.x + r.w / 2, r.y + 20);
  }
  ctx.textBaseline = 'alphabetic';
}

/* What has just appeared, named, in the row under the wind. */
function drawReveal(ctx, words, k, topH) {
  if (!words) return null;
  ctx.save();
  ctx.globalAlpha = Math.min(1, k * 5);
  ctx.font = face(700, 26);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const w = ctx.measureText(words).width + 40, y = topH + 80;
  ctx.fillStyle = GOLD;
  pill(ctx, (CLIP.W - w) / 2, y, w, 50, 25); ctx.fill();
  ctx.fillStyle = navy(1);
  ctx.fillText(words, CLIP.W / 2, y + 26);
  ctx.restore();
  return { x: (CLIP.W - w) / 2, y, w, h: 50 };
}

function drawCard(ctx, host, k) {
  const { W, H } = CLIP;
  const a = Math.min(1, k / 0.18);
  ctx.save();
  ctx.fillStyle = navy(0.93 * a);
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = a;
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.font = face(500, 36);
  const said = wrapText(host.closing.sentence, W - 120, (s) => ctx.measureText(s).width);
  const rows = [
    { text: 'TRAILCRAFT', font: face(700, 24), colour: GOLD, gap: 64 },
    { text: fitted(ctx, host.lines.title, W - 96, 700, 60, 36), font: ctx.font, colour: WHITE, gap: 76 },
    ...said.map((text, i) => ({ text, font: face(500, 36), colour: WHITE, gap: i ? 48 : 0 })),
    { text: host.closing.tag, font: face(700, 26), colour: GOLD, gap: 70 },
    host.lines.stats ? { text: fitted(ctx, host.lines.stats, W - 96, 500, 25, 19), font: ctx.font, colour: 'rgba(255, 255, 255, 0.82)', gap: 46 } : null,
    host.lines.level ? { text: fitted(ctx, host.lines.level, W - 96, 600, 24, 18, true), font: ctx.font, colour: GOLD, gap: 40 } : null,
  ].filter(Boolean);
  rows[2].gap = 76;                                  // the sentence's first line, below the name
  const tall = rows.reduce((s, r, i) => s + (i ? r.gap : 0), 0);
  let y = (H - tall) / 2;
  rows.forEach((r, i) => {
    if (i) y += r.gap;
    ctx.font = r.font; ctx.fillStyle = r.colour;
    ctx.fillText(r.text, W / 2, y);
  });
  ctx.restore();
}

/** One whole frame of the video onto `ctx`: the map as it was last copied
    (`mapBuf`), then everything said over it. `st` is clipAt's answer;
    `route` is the dog's route so far in frame pixels, given when the map's
    own drawing of it is covered, and `route2` the handler's beside it when
    the route is the dog's own GPS track; `logo` is the map's wordmark, when
    it has one. */
export function drawFrame(ctx, { mapBuf, host, st, clock, marks, wind, route = null, route2 = null, logo = null }) {
  const { W, H } = CLIP;
  const card = st.phase === 'card' || st.phase === 'done';
  /* Where the map has nothing (no signal, no tiles) the frame is the app's
     navy, not the black of an empty canvas. */
  ctx.fillStyle = '#0B1630';
  ctx.fillRect(0, 0, W, H);
  if (mapBuf) ctx.drawImage(mapBuf, 0, 0);
  drawRoute(ctx, route2, host.dog, { thin: true });
  drawRoute(ctx, route, host.dog);
  const topH = drawTop(ctx, host.lines, clock, st.f);
  const windBox = card ? null : drawWind(ctx, wind, topH);
  const showKey = !card && st.answer && host.reveal !== 'none';
  const taken = [
    windBox,
    showKey ? drawKey(ctx, host.key, (windBox ? windBox.y + windBox.h : topH) + 16) : null,
    st.phase === 'reveal' ? drawReveal(ctx, host.revealWords, st.k, topH) : null,
  ];
  drawMarks(ctx, marks, topH, taken);
  if (card) drawCard(ctx, host, st.phase === 'done' ? 1 : st.k);
  /* Last, over the card too: the map is under the card, and so is its credit. */
  drawBottom(ctx, host.credit, logo);
}

/* ── Recording ──────────────────────────────────────────────────────── */

/** What is said when a recording cannot be made or did not finish, and
    what the handler is told about the screen. Plain words, one or two
    sentences each: they are shown as they are. */
export const CLIP_SAYS = Object.freeze({
  unsupported: 'This device can’t record the replay.',
  blank: 'This device can’t record the map.',
  background: 'Recording stopped because Trailcraft went to the background. Keep it on screen and try again.',
  failed: 'The recording stopped before it finished. Try again.',
  empty: 'The recording came out empty. Try again.',
  short: 'This device couldn’t keep up. Try a shorter video.',
  /* Before Start, where nothing can keep the screen on. */
  lock: 'This phone may lock while recording. Keep a finger on the screen, or pick 15 s.',
  /* While recording, when the hold that was asked for was not given. */
  touch: 'Keep the screen awake: touch it now and then.',
});

const nextFrame = () => new Promise(res => requestAnimationFrame(() => res()));

/* The map quiet after a move: every tile it asked for has landed. A map
   with something always moving on it (the wind's streaks) never goes quiet,
   so the wait gives up and records what there is. */
const settled = (map, ms) => new Promise((res) => {
  let over = false;
  const done = () => { if (over) return; over = true; map.off('idle', done); clearTimeout(timer); res(); };
  const timer = setTimeout(done, ms);
  map.on('idle', done);
});

/* The map's wordmark as a picture the frame can take. Only one that is
   safe to draw: a picture that spoils the canvas (a browser that treats it
   as someone else's) would leave the recorder with nothing, so it is tried
   on a scrap of canvas first and left out if that cannot be read back. The
   text credit is drawn either way. */
async function wordmark(url) {
  if (!url || typeof Image !== 'function') return null;
  try {
    const img = new Image();
    img.src = url;
    await Promise.race([img.decode(), new Promise((_, no) => setTimeout(no, 1500))]);
    if (!(img.naturalWidth > 0 && img.naturalHeight > 0)) return null;
    const scrap = document.createElement('canvas');
    scrap.width = 8; scrap.height = 8;
    const c = scrap.getContext('2d');
    c.drawImage(img, 0, 0, 8, 8);
    c.getImageData(0, 0, 1, 1);
    return img;
  } catch { return null; }
}

/** Record the replay. `map` is the live map; `canvas` is a canvas the caller
    has put on screen (it is the preview, and a canvas in the page is what
    every browser will record); `seconds` is the length asked for.

    `host` is the replay itself, as much of it as the video needs:
      from, to          the run's clock
      points            everything the frame has to hold, as { lat, lon }
      reveal            answerPlan's word: 'start', 'end' or 'none'
      revealWords       what the reveal is called
      lines, closing    clipLines' and clipClosing's
      credit            creditLine's
      logo              the map's wordmark as a data: address (cssUrl), or null
      route             the dog's route as { lat, lon, t }, in time order
      route2            the handler's, when the route is the dog's own GPS
                        track (optional), drawn thinner beside it
      dog               the route's { colour, casing }
      answer(show)      draw the laid trail and its scent, or take them off
      paint(at)         the replay as it stood at that moment of the run
      marks(at)         the marks reached by then, as { kind, lat, lon, t }
      wind(at)          windLine's answer for that moment
      hold(on)          the shell's own screen hold, where there is a shell:
                        resolves true when it took

    `onProgress` hears { stage: 'prepare', held } once the screen's hold has
    been asked for (`held` false means the phone may lock itself and stop
    the recording), { stage: 'record', t, total } on every frame, and
    { stage: 'finish' } while the file is handed over and checked.

    Returns { done, cancel }. `done` never rejects: it settles as
    { status: 'done', blob, type, ext, seconds } (`seconds` is the length
    the file really is, where the device can say), { status: 'cancelled',
    reason } or { status: 'failed', say, why } (`why` is the key of
    CLIP_SAYS). `cancel(reason)` stops at once and has put the map back as
    it was by the time it returns; the caller puts its replay back. */
export function recordClip({ map, canvas, seconds, host, onProgress = () => {}, stopWait = CLIP.STOP_WAIT_MS }) {
  const pick = clipSupport();
  let settle;
  const done = new Promise((res) => { settle = res; });
  const failed = (why) => ({ status: 'failed', say: CLIP_SAYS[why], why });
  if (!pick || !map || !canvas) {
    settle(failed('unsupported'));
    return { done, cancel() {} };
  }

  const plan = clipPlan(seconds, { reveal: host.reveal === 'end' });
  const { W, H } = CLIP;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const mapBuf = document.createElement('canvas');
  mapBuf.width = W; mapBuf.height = H;
  const bufCtx = mapBuf.getContext('2d');
  const probe = document.createElement('canvas');
  probe.width = 96; probe.height = 96;

  /* `over`: nothing more is drawn or recorded and the map is its own again.
     `closed`: the caller has its answer. They part company at the natural
     end, where the map is handed back before the file has been checked. */
  let over = false, closed = false, raf = 0, rec = null, stream = null, lock = null, shell = false, stall = 0;
  let t0 = 0, last = 0, renders = 0, seen = false, answered = null, logo = null;
  const chunks = [];
  const cam = { center: map.getCenter(), zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() };
  /* The map's own small labels under the marks are taken off for the length
     of the recording: the video names the marks itself, and both together
     is two labels a few pixels apart. */
  const hush = ['wp-text'].filter(id => map.getLayer?.(id))
    .map(id => ({ id, was: map.getLayoutProperty(id, 'visibility') ?? 'visible' }));
  const track = (typeof host.route === 'function' ? host.route() || [] : [])
    .filter(p => Number.isFinite(p?.lat) && Number.isFinite(p?.lon) && Number.isFinite(p?.t));
  let trackXY = null, trackKey = '';
  const track2 = (typeof host.route2 === 'function' ? host.route2() || [] : [])
    .filter(p => Number.isFinite(p?.lat) && Number.isFinite(p?.lon) && Number.isFinite(p?.t));
  let track2XY = null;

  /* The map's canvas is copied inside its own 'render' event. A WebGL
     canvas keeps its picture only until the browser has shown it; read at
     any other time it is empty. Here it has just been drawn and not yet
     handed over, so the copy is whole, and the map does not have to be
     rebuilt to keep every frame it ever draws (preserveDrawingBuffer),
     which costs a phone memory and speed on every screen of the app. */
  const onRender = () => {
    const src = map.getCanvas();
    const c = coverCrop(src.width, src.height, W, H);
    if (!c.w) return;
    bufCtx.fillStyle = '#0B1630';
    bufCtx.fillRect(0, 0, W, H);
    try { bufCtx.drawImage(src, c.x, c.y, c.w, c.h, 0, 0, W, H); } catch { return; }
    renders++;
    /* Once, a few frames in: is there anything in the copy at all? A web
       view that hands over an empty picture would otherwise make thirty
       seconds of navy and call it a video. */
    if (!seen && renders >= 6) {
      try {
        const p = probe.getContext('2d');
        p.clearRect(0, 0, 96, 96);
        p.drawImage(src, c.x, c.y, c.w, c.h, 0, 0, 96, 96);
        const px = p.getImageData(0, 0, 96, 96).data;
        let any = false;
        for (let i = 3; i < px.length; i += 4) if (px[i]) { any = true; break; }
        if (any) seen = true;
        else if (renders >= 45) finish(failed('blank'));
      } catch { seen = true; }      // unreadable is not the same as empty
    }
  };

  const onHidden = () => { if (document.visibilityState !== 'visible') finish({ status: 'cancelled', reason: 'background' }); };

  /* The screen's holds, given back: the page's own and the shell's. Asking
     is a promise and so is letting go. */
  const letGo = () => {
    const l = lock; lock = null;
    try { l?.release?.()?.catch?.(() => {}); } catch { /* already let go */ }
    if (shell) { shell = false; try { Promise.resolve(host.hold(false)).catch(() => {}); } catch { /* the shell has gone */ } }
  };

  /* Everything handed back, once, whichever way it ends. */
  function tidy() {
    cancelAnimationFrame(raf);
    clearTimeout(stall);
    map.off('render', onRender);
    document.removeEventListener('visibilitychange', onHidden);
    for (const l of hush) { try { map.setLayoutProperty(l.id, 'visibility', l.was); } catch { /* the style changed under it */ } }
    try { stream?.getTracks().forEach(tr => tr.stop()); } catch { /* already stopped */ }
    letGo();
    try { map.jumpTo(cam); } catch { /* the map has gone */ }
  }

  /* The recording over, and the map its own again. */
  function release() {
    if (over) return;
    over = true;
    if (rec) {
      rec.ondataavailable = null; rec.onerror = null; rec.onstop = null;
      try { if (rec.state !== 'inactive') rec.stop(); } catch { /* never started */ }
    }
    tidy();
  }

  function finish(result) {
    if (closed) return;
    closed = true;
    release();
    settle(result);
  }

  /* The natural end: the recorder is asked for what it has, then to stop,
     and the file is whatever it hands over then. It is not taken on trust.
     A recorder that never answers is given up on, and a file that comes
     back shorter than the video was (an encoder that fell behind drops the
     end, which is the reveal and the result) is said to have failed, not
     announced as the video. */
  function wrap() {
    if (over) return;
    cancelAnimationFrame(raf);
    onProgress({ stage: 'finish', t: plan.total, total: plan.total });
    stall = setTimeout(() => finish(failed('failed')), stopWait);
    rec.onstop = async () => {
      if (over) return;
      const blob = new Blob(chunks, { type: pick.type });
      release();
      if (!blob.size) return finish(failed('empty'));
      const made = await clipSeconds(blob);
      if (made != null && made < plan.total - CLIP.SHORT_S) return finish(failed('short'));
      finish({ status: 'done', blob, type: pick.type, ext: pick.ext, mime: pick.mime,
        seconds: made != null ? Math.round(made) : plan.total });
    };
    try { rec.requestData?.(); } catch { /* stop hands over the rest anyway */ }
    try { rec.stop(); } catch { finish(failed('failed')); }
  }

  /* A place on the ground to a place in the frame: the map's own pixels,
     then through the same crop the picture went through. */
  const toFrame = () => {
    const src = map.getCanvas();
    const crop = coverCrop(src.width, src.height, W, H);
    const dpr = src.width / (src.clientWidth || src.width);
    const k = W / (crop.w || W);
    const place = (p) => { const q = map.project([p.lon, p.lat]); return { x: (q.x * dpr - crop.x) * k, y: (q.y * dpr - crop.y) * k }; };
    return { place, key: `${src.width}x${src.height}` };
  };

  function frame(now) {
    if (over) return;
    raf = requestAnimationFrame(frame);
    /* A 120 Hz screen would have the map redraw the route four times for
       every frame the recorder keeps. */
    if (now - last < 1000 / CLIP.FPS - 5) return;
    last = now;
    const t = (now - t0) / 1000;
    const st = clipAt(plan, t);
    if (st.answer !== answered) { answered = st.answer; host.answer(st.answer); }
    const at = host.from + st.f * (host.to - host.from);
    if (st.phase === 'run' || renders < 2 || st.k < 0.3) host.paint(at);
    map.triggerRepaint();
    const fresh = plan.runS > 0 ? (host.to - host.from) * (1.2 / plan.runS) : 0;   // 1.2 s of video, in run time
    const to = toFrame();
    const marks = (host.marks(at) || []).map((m) => ({ kind: m.kind, t: m.t, ...to.place(m), fresh: st.phase === 'run' && at - m.t < fresh }));
    /* The route in code only while the answer is on the map over it. The
       camera does not move, so its place in the frame is worked out once
       (and again if the window is resized under it). */
    let route = null, route2 = null;
    if (st.answer && host.reveal !== 'none' && track.length > 1) {
      if (trackKey !== to.key) {
        trackXY = track.map(p => ({ ...to.place(p), t: p.t }));
        track2XY = track2.length > 1 ? track2.map(p => ({ ...to.place(p), t: p.t })) : null;
        trackKey = to.key;
      }
      route = routeUntil(trackXY, at);
      route2 = track2XY ? routeUntil(track2XY, at) : null;
    }
    drawFrame(ctx, { mapBuf, host, st, clock: fmtDur(at - host.from), marks, wind: host.wind(at), route, route2, logo });
    onProgress({ stage: 'record', t: Math.min(t, plan.total), total: plan.total });
    if (t >= plan.total + CLIP.DRAIN_S) wrap();
  }

  (async () => {
    /* Two holds on the screen, either of which will do: the shell's own
       (the iPhone app, where the web view's is missing or not honoured) and
       the page's. With neither the phone locks itself after its usual
       half-minute, the page goes to the background and the recording is
       stopped there, so the caller is told before it finds out. */
    try { shell = !!(await host.hold?.(true)); } catch { shell = false; }
    try { lock = (await navigator.wakeLock?.request('screen')) ?? null; } catch { lock = null; }
    if (over) return letGo();
    onProgress({ stage: 'prepare', t: 0, total: plan.total, held: shell || !!lock });
    document.addEventListener('visibilitychange', onHidden);
    for (const l of hush) map.setLayoutProperty(l.id, 'visibility', 'none');

    /* Flat and north up, fitted once and left alone: a camera that swings
       with the dog is hard to watch on a phone, and with north at the top
       the wind's arrow means what it says. */
    try {
      const b = host.points.reduce((box, p) => [
        [Math.min(box[0][0], p.lon), Math.min(box[0][1], p.lat)], [Math.max(box[1][0], p.lon), Math.max(box[1][1], p.lat)],
      ], [[Infinity, Infinity], [-Infinity, -Infinity]]);
      const box = map.getCanvas();
      const fit = map.cameraForBounds(b, { padding: framePadding(box.clientWidth, box.clientHeight), bearing: 0, pitch: 0, maxZoom: 18.5 });
      if (fit) map.jumpTo({ center: fit.center, zoom: fit.zoom, bearing: 0, pitch: 0 });
    } catch { /* a run the map cannot frame is recorded where the camera stands */ }

    answered = clipAt(plan, 0).answer;
    host.answer(answered);
    host.paint(host.from);
    map.on('render', onRender);
    map.triggerRepaint();
    const [mark] = await Promise.all([wordmark(host.logo), settled(map, 3500)]);
    logo = mark;
    await nextFrame();
    if (over) return;

    try {
      /* A first frame on the canvas before the recorder looks at it, so the
         video does not open on an empty one. */
      drawFrame(ctx, { mapBuf, host, st: clipAt(plan, 0), clock: fmtDur(0), marks: [], wind: host.wind(host.from), logo });
      stream = canvas.captureStream(CLIP.FPS);
      rec = new MediaRecorder(stream, { mimeType: pick.mime, videoBitsPerSecond: CLIP.BPS });
    } catch {
      return finish(failed('unsupported'));
    }
    rec.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
    rec.onerror = () => finish(failed('failed'));
    try { rec.start(1000); } catch { return finish(failed('unsupported')); }
    t0 = performance.now();
    last = 0;
    raf = requestAnimationFrame(frame);
  })();

  return { done, cancel: (reason = 'cancelled') => finish({ status: 'cancelled', reason }) };
}
