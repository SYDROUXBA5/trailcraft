/* A finished trail, sent beyond this phone: a link that carries every detail,
   a GPX file for any mapping app, and the rows of detail that the link's page
   and the printed report both read — so the two can never disagree.

   The link keeps the Trail Card's promise. The trail rides in the address's
   #fragment, which a browser never sends to a server: GitHub Pages hands over
   the page and never learns where anyone trained. The price is said where the
   link is made — it is long, and once sent it cannot be called back. */

import { simplify, pathLen, cardinal, fmtDist, fmtShort, fmtDur, fmtSpeed, fmtTemp, fmtWeight, fmtCoord } from './geo.js';
import { through, inflate, b64url, unb64url, needStreams } from './card.js';
import { targetById, ageBand, dogAge, healApproach } from './store.js';
import { DEBRIEF, FLAGS, NOTE_TAGS, ownRun, toldField, toldOf, trailShown, ranBlind, unwalkedPlan } from './debrief.js';
import { CONFIDENCE, labelOf as callLabel } from './call.js';
import { cleanSeen, seenLine } from './ground.js';
import { rainRate } from './field.js';

const MAGIC = 'TS1.';
const fin = Number.isFinite;
const str = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 80) : null);

/* A stranger's link is read inside limits no genuine one comes near: how long
   the code is, what it inflates to, and how many points it holds. Deflate
   squeezes a run of zeros about a thousand to one, so without them a link of
   a few kilobytes unfolds into millions of points and takes the phone down
   with it. The encoder keeps to the same limits, so a link this app makes
   always opens. */
const MAX_CODE = 64000;
const MAX_JSON = 4 * 1024 * 1024;
const MAX_POINTS = 50000;
const MAX_LINES = 50;
const TOO_BIG = 'This shared trail is too big to open';
const DAMAGED = 'This shared trail is damaged — ask for the link again';
/* The errors written here are meant to be read; anything else that goes
   wrong while reading a link is said as damage, never as a JS message. */
const refuse = (msg) => Object.assign(new Error(msg), { plain: true });

/* Times must fall in a plausible era, as they must on a Trail Card: the GPX
   file and the report turn them into dates, and Date.toISOString throws
   outright past the year 275760. */
const T_MIN = Date.UTC(2000, 0, 1), T_MAX = Date.UTC(2100, 0, 1);
const inEra = (ms) => fin(ms) && ms >= T_MIN && ms <= T_MAX;
const era = (ms) => (inEra(ms) ? ms : null);
const pick = (o, keys) => Object.fromEntries(keys.filter(k => o?.[k] != null).map(k => [k, o[k]]));
const cap = (w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w);
const DOG_KEYS = ['name', 'breed', 'sex', 'dob', 'weightKg', 'lineM'];

/* ── The model: one plain object behind the link, the file and the report ── */

/** A session and the people around it, as plain data. Names travel as names:
    whoever opens the link has none of this phone's records to look ids up in. */
export function trailModel(s, { dog = null, handler = null, layer = null, k = null } = {}) {
  const d = s?.data ?? {};
  const t = targetById(s?.targetId);
  return {
    kind: t.kind === 'hide' ? 'search' : 'trail',
    name: str(s?.name),
    target: t.label,
    laidAt: s?.startedAt ?? null,
    runAt: d.trackStarted ?? null,
    dog: dog ? pick(dog, DOG_KEYS) : null,
    handler: handler?.name ?? null,
    layer: layer?.name ?? null,
    plan: !!d.plan,
    walked: !!d.walked,
    /* A drawn line that arrived as a Trail Card. Without it the link, the
       report and a kept copy took the sketch for a laid trail, and worked a
       trail age out of the guessed laid time the phone that ran it refused. */
    drawn: !!d.drawn,
    trail: d.trail?.length ? d.trail : null,
    hides: d.hides?.length ? d.hides : null,
    contamination: (d.contamination ?? []).filter(c => c?.points?.length > 1).map(c => ({ points: c.points })),
    track: d.track?.length > 1 ? d.track : null,
    wps: d.track?.length > 1 ? (d.trackWaypoints ?? []) : [],
    wx: d.weather ?? null,
    runWx: runWxOf(d),
    result: d.result ?? null,
    coach: d.coach ?? null,
    /* When the trail was first put on screen. Without it every coach-off run
       went out as "blind", including one revealed a minute in. */
    revealedAt: fin(d.revealedAt) && d.revealedAt > 0 ? d.revealedAt : null,
    debrief: d.debrief ?? null,
    seen: d.seen ?? null,
    k: fin(k) ? k : null,
    thinnedM: 0,
  };
}

/* The run's own weather, fetched when the laid series did not reach the run.
   A link without it replayed the run in the laid-time wind while its result
   quoted the run's. Only the stretch the dog ran is needed, and a sample
   either side, so the link carries a handful of samples, not twelve hours. */
function runWxOf(d) {
  const w = d.runWeather;
  if (!w || typeof w !== 'object') return null;
  const track = Array.isArray(d.track) ? d.track : [];
  const from = fin(d.trackStarted) ? d.trackStarted : track[0]?.t;
  if (!Array.isArray(w.series) || !fin(from)) return w;
  const last = track[track.length - 1]?.t;
  const to = fin(last) && last > from ? last : from;
  const pad = 30 * 60e3;
  return { ...w, series: w.series.filter(e => fin(e?.t) && e.t >= from - pad && e.t <= to + pad) };
}

/* ── Packing: deltas of small integers, which deflate squeezes hard ───── */

const deltas = (a) => a.map((v, i) => (i ? v - a[i - 1] : v));
const sums = (a) => { let s = 0; return a.map(d => (s += d)); };
const round = (x, dp) => Math.round(x * 10 ** dp) / 10 ** dp;

/* 1e-6° is 11 cm: finer than any phone's GPS, so nothing a map can show is
   lost. Times go to whole seconds, heights to decimetres. */
function packPts(pts) {
  if (!pts?.length) return undefined;
  const col = (f) => deltas(pts.map(f));
  const o = { lat: col(p => Math.round(p.lat * 1e6)), lon: col(p => Math.round(p.lon * 1e6)) };
  if (pts.every(p => fin(p.t))) o.t = col(p => Math.round(p.t / 1000));
  if (pts.every(p => fin(p.alt))) o.alt = col(p => Math.round(p.alt * 10));
  const dw = pts.flatMap((p, i) => (p.dwellS > 0 ? [[i, Math.round(p.dwellS)]] : []));
  if (dw.length) o.dw = dw;
  const kd = pts.flatMap((p, i) => (typeof p.kind === 'string' ? [[i, p.kind]] : []));
  if (kd.length) o.kd = kd;
  /* The handler's call, made before they looked. Without this column it was
     stripped from every shared run, and the one thing that cannot be
     reconstructed afterwards never left the phone. */
  const cl = pts.flatMap((p, i) => (p.call?.conf ? [[i, p.call.conf, p.call.seen ? 1 : 0]] : []));
  if (cl.length) o.cl = cl;
  return o;
}

/* Each [index, value] pair names a point by its place in the line, and only
   a whole number that is a real place is used. An index of '__proto__' or
   'length' would otherwise write onto every array in the page, or throw. */
const pairs = (col, n) => (Array.isArray(col) ? col : [])
  .filter(e => Array.isArray(e) && Number.isInteger(e[0]) && e[0] >= 0 && e[0] < n);

function unpackPts(o) {
  if (!o || !Array.isArray(o.lat) || !Array.isArray(o.lon) || o.lat.length !== o.lon.length || !o.lat.length) return null;
  const lat = sums(o.lat), lon = sums(o.lon);
  let t = Array.isArray(o.t) && o.t.length === lat.length ? sums(o.t).map(s => s * 1000) : null;
  /* One time out of its era and the whole column goes: a line with no clock
     still draws and grades, and one with an impossible clock breaks Save GPX. */
  if (t && !t.every(inEra)) t = null;
  let alt = Array.isArray(o.alt) && o.alt.length === lat.length ? sums(o.alt).map(a => a / 10) : null;
  if (alt && !alt.every(fin)) alt = null;
  const pts = lat.map((v, i) => {
    const p = { lat: v / 1e6, lon: lon[i] / 1e6 };
    if (t) p.t = t[i];
    if (alt) p.alt = alt[i];
    return p;
  });
  for (const [i, s] of pairs(o.dw, pts.length)) if (fin(s)) pts[i].dwellS = s;
  for (const [i, k] of pairs(o.kd, pts.length)) if (typeof k === 'string') pts[i].kind = k.slice(0, 40);
  /* Only a confidence the app itself offers gets through; anything else in a
     crafted link is dropped rather than shown. */
  for (const [i, c, seen] of pairs(o.cl, pts.length)) {
    if (CALL_VS.has(c)) pts[i].call = { conf: c, seen: seen === 1 };
  }
  const sane = pts.every(p => fin(p.lat) && fin(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180);
  return sane ? pts : null;
}

/* Weather keeps its numbers to one decimal — a forecast is not more precise
   than that — and drops anything that is not a number or a short word. */
function packWx(wx) {
  if (!wx || typeof wx !== 'object') return undefined;
  const flat = (e) => Object.fromEntries(Object.entries(e ?? {})
    .filter(([k, v]) => k !== 'series' && (fin(v) || (typeof v === 'string' && v.length < 40)))
    .map(([k, v]) => [k, fin(v) && k !== 't' ? round(v, 1) : v]));
  const out = flat(wx);
  if (Array.isArray(wx.series)) out.series = wx.series.map(flat);
  return out;
}

/* And read back the same way: numbers stay numbers, the forecast's own time
   is the one word kept, and the series is no longer than a day of
   fifteen-minute steps. A word where a number belongs would reach the
   weather panel as a string and break the arithmetic done on it there. */
const WX_SERIES_MAX = 96;
/* Only the fields the app itself writes into a weather record, each within
   what the air can actually do. Any other key is dropped: a link could carry
   a field name the cloud refuses (an empty one, or one shaped like __x__),
   and one such kept run used to stop the whole backup at every launch. */
const WX_RANGE = {
  temp: [-60, 60], dew_point: [-60, 60], soil_temp: [-60, 85], humidity: [0, 100],
  wind_speed: [0, 80], wind_gusts: [0, 120], wind_direction: [0, 360],
  precipitation: [0, 300], pressure: [300, 1100], gap: [0, 1e10],
};
function cleanWx(wx) {
  const flat = (e) => {
    if (!e || typeof e !== 'object' || Array.isArray(e)) return null;
    const out = {};
    for (const [k, [lo, hi]] of Object.entries(WX_RANGE)) {
      if (fin(e[k]) && e[k] >= lo && e[k] <= hi) out[k] = e[k];
    }
    if (typeof e.time === 'string' && e.time.length < 40) out.time = e.time;
    if (inEra(e.t)) out.t = e.t;
    return out;
  };
  const out = flat(wx);
  if (!out) return null;
  if (Array.isArray(wx.series)) out.series = wx.series.slice(0, WX_SERIES_MAX).map(flat).filter(Boolean);
  return out;
}

const roundDeep = (v) => (fin(v) ? round(v, 2)
  : Array.isArray(v) ? v.map(roundDeep)
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, roundDeep(x)]))
  : v);

/* ── The judgement ────────────────────────────────────────────────────
   What the handler said about the run, travelling with it. Every value is
   checked against the app's own option lists on the way back in: a link is a
   stranger's input, and a debrief field is shown to whoever opens it. */
const CALL_VS = new Set(CONFIDENCE.map(c => c.v));
const DEBRIEF_VS = new Map(DEBRIEF.map(f => [f.id, new Set(f.options.map(o => o.v))]));
const FLAG_VS = new Set(FLAGS.map(f => f.v));
const TAG_VS = new Set(NOTE_TAGS.map(t => t.v));

function packDebrief(d) {
  if (!d?.outcome) return undefined;
  const o = {};
  for (const f of DEBRIEF) if (d[f.id]) o[f.id] = d[f.id];
  if (d.flags?.length) o.flags = d.flags;
  if (d.note) o.note = String(d.note).slice(0, 140);
  if (d.noteTag) o.noteTag = d.noteTag;
  if (d.by) o.by = String(d.by).slice(0, 60);
  if (fin(d.at)) o.at = d.at;
  return o;
}

function unpackDebrief(o) {
  if (!o || typeof o !== 'object') return null;
  const d = { v: 1, flags: [], note: '', noteTag: null };
  for (const [id, ok] of DEBRIEF_VS) d[id] = ok.has(o[id]) ? o[id] : null;
  /* Without an outcome there is no judgement to show, whatever else came. */
  if (!d.outcome) return null;
  d.flags = (Array.isArray(o.flags) ? o.flags : []).filter(f => FLAG_VS.has(f));
  d.note = typeof o.note === 'string' ? o.note.slice(0, 140) : '';
  d.noteTag = TAG_VS.has(o.noteTag) ? o.noteTag : null;
  d.by = str(o.by);
  d.at = era(o.at);
  return d;
}

/* The verdict that came with the run, rebuilt field by field from what the
   app itself writes. A kept run shows it on this phone's own result screen,
   so a word from outside the app's short lists is dropped, a number has to
   be a number in range, free text is cut short, and nothing else comes. */
const RESULT_KINDS = new Set(['trail', 'search']);
const SIDES = new Set(['left', 'right']);
const APPROACHES = new Set(['into the wind', 'with the wind', 'across the wind']);
const REGIME_KEYS = new Set(['wind', 'drain']);
const PRED_SIDES = new Set([-1, 0, 1]);
const text = (n) => (v) => (typeof v === 'string' ? v.trim().slice(0, n) : null);
const within = (lo, hi) => (v) => (fin(v) && v >= lo && v <= hi ? v : null);
const oneOf = (set) => (v) => (set.has(v) ? v : null);
const fraction = within(0, 1);
const RESULT_FIELDS = {
  sentence: text(300), modelled: text(300), stability: text(40), stabilityPlain: text(300),
  regimeWord: text(20), regimeKey: oneOf(REGIME_KEYS), mv: text(40),
  side: oneOf(SIDES), mainSide: oneOf(SIDES), approach: oneOf(APPROACHES), predSide: oneOf(PRED_SIDES),
  mean: within(-1e5, 1e5), medAbs: within(0, 1e5), accMed: within(0, 1e5), catchM: within(0, 1e5),
  toFirst: within(0, 7 * 864e5), ageMin: within(0, 10 * 525600),
  agree: fraction, sideAgreement: fraction, approachV: within(0, 100),
  noisy: (v) => v === true, catchApprox: (v) => v === true,
  shares: (v) => (v && typeof v === 'object' && [v.left, v.on, v.right].every(x => fraction(x) != null)
    ? { left: v.left, on: v.on, right: v.right } : null),
  wind: (v) => (v && typeof v === 'object' && within(0, 100)(v.speed) != null
    ? { speed: v.speed, from: within(0, 360)(v.from) } : null),
  /* The bench dials that were moved when it was graded: names and numbers. */
  mp: (v) => (v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v).filter(([k, x]) => /^[A-Za-z]\w{0,39}$/.test(k) && fin(x)).slice(0, 64))
    : null),
};

export function cleanResult(r) {
  if (!r || typeof r !== 'object' || !RESULT_KINDS.has(r.kind)) return null;
  const out = { kind: r.kind };
  for (const [k, clean] of Object.entries(RESULT_FIELDS)) if (k in r) out[k] = clean(r[k]);
  return out;
}

/** A dog as a link or a live run describes it: names as short words, numbers
    as numbers, and a date of birth in the same era as every other time. */
function cleanDog(d) {
  if (!d || typeof d !== 'object') return null;
  return {
    ...pick({ name: str(d.name), breed: str(d.breed), sex: str(d.sex) }, ['name', 'breed', 'sex']),
    ...pick({ dob: era(d.dob), weightKg: fin(d.weightKg) ? d.weightKg : null,
      lineM: fin(d.lineM) ? d.lineM : null }, ['dob', 'weightKg', 'lineM']),
  };
}

function pack(m) {
  const o = {
    kind: m.kind, name: m.name ?? undefined, target: m.target, laidAt: m.laidAt, runAt: m.runAt,
    dog: m.dog ? pick(m.dog, DOG_KEYS) : undefined,
    handler: m.handler, layer: m.layer,
    plan: m.plan ? 1 : undefined, walked: m.walked ? 1 : undefined, drawn: m.drawn ? 1 : undefined,
    trail: packPts(m.trail), hides: packPts(m.hides), track: packPts(m.track), wps: packPts(m.wps),
    contam: m.contamination?.length ? m.contamination.map(c => packPts(c.points)) : undefined,
    wx: packWx(m.wx), runWx: packWx(m.runWx), result: m.result ? roundDeep(m.result) : undefined,
    coach: m.coach ? { assisted: !!m.coach.assisted, tolM: m.coach.tolM, scent: !!m.coach.scent, calls: m.coach.calls,
      shadow: m.coach.shadow ? pick(m.coach.shadow, ['tolM', 'plain', 'scent']) : undefined } : undefined,
    revealedAt: m.revealedAt ?? undefined,
    debrief: packDebrief(m.debrief),
    seen: m.seen ? { wet: m.seen.wet ?? undefined, sun: m.seen.sun ?? undefined } : undefined,
    k: m.k, thinnedM: m.thinnedM || undefined,
  };
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v != null));
}

/* Everything read back from a link is a stranger's input: every field is
   checked for its type here, and every string is escaped where it is shown. */
function unpack(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw refuse(DAMAGED);
  /* Counted before a single point is built, so an oversized link costs
     nothing but the refusal. */
  const contam = Array.isArray(o.contam) ? o.contam : [];
  const count = [o.trail, o.hides, o.track, o.wps, ...contam]
    .reduce((n, l) => n + (Array.isArray(l?.lat) ? l.lat.length : 0), 0);
  if (count > MAX_POINTS || contam.length > MAX_LINES) throw refuse(TOO_BIG);
  const trail = unpackPts(o.trail), hides = unpackPts(o.hides), track = unpackPts(o.track);
  if (!trail && !hides) throw refuse(DAMAGED);
  /* A search needs hides and a trail needs a line. A link whose label says
     one and whose contents are the other opened, could be kept, and then
     crashed every screen that expected the geometry its label promised. */
  const kind = o.kind === 'search' ? (hides ? 'search' : 'trail') : (trail?.length > 1 ? 'trail' : 'search');
  if (kind === 'trail' && !(trail?.length > 1)) throw refuse(DAMAGED);
  if (kind === 'search' && !hides?.length) throw refuse(DAMAGED);
  return {
    kind,
    name: str(o.name),
    target: str(o.target) ?? (kind === 'search' ? 'A hide' : 'A person'),
    laidAt: era(o.laidAt),
    runAt: era(o.runAt),
    dog: cleanDog(o.dog),
    handler: str(o.handler),
    layer: str(o.layer),
    plan: !!o.plan,
    walked: !!o.walked,
    /* Absent from a link made before it was carried: read as laid, as it was. */
    drawn: !!o.drawn,
    trail, hides,
    track: track?.length > 1 ? track : null,
    wps: unpackPts(o.wps) ?? [],
    contamination: contam.map(unpackPts).filter(p => p?.length > 1).map(points => ({ points })),
    wx: cleanWx(o.wx),
    /* Held to exactly what the laid weather is: a stranger's numbers either way. */
    runWx: cleanWx(o.runWx),
    /* A link sent before the approach was put right still says it back to front. */
    result: healApproach(cleanResult(o.result)),
    coach: o.coach && typeof o.coach === 'object' ? {
      assisted: !!o.coach.assisted, tolM: fin(o.coach.tolM) ? o.coach.tolM : null, scent: !!o.coach.scent,
      calls: fin(o.coach.calls) ? o.coach.calls : null,
      shadow: o.coach.shadow && typeof o.coach.shadow === 'object' ? {
        tolM: fin(o.coach.shadow.tolM) ? o.coach.shadow.tolM : null,
        plain: fin(o.coach.shadow.plain) ? o.coach.shadow.plain : null,
        scent: fin(o.coach.shadow.scent) ? o.coach.shadow.scent : null,
      } : null,
    } : null,
    revealedAt: era(o.revealedAt),
    debrief: unpackDebrief(o.debrief),
    seen: cleanSeen(o.seen),
    k: fin(o.k) ? o.k : null,
    thinnedM: fin(o.thinnedM) ? o.thinnedM : 0,
  };
}

/* ── The link ─────────────────────────────────────────────────────── */

/* Links of this size go through Messages, WhatsApp and mail intact. A very
   long run is thinned until it fits — the dwell and marked points never are,
   because the standing spot is where the scent pools. */
const LINK_BUDGET = 12000;
const THIN_STEPS = [0.5, 1, 2, 4];

function thinKeeping(pts, tol) {
  if (!pts || pts.length < 3) return pts;
  const anchors = [0];
  pts.forEach((p, i) => { if (i > 0 && i < pts.length - 1 && (p.dwellS > 0 || p.kind)) anchors.push(i); });
  anchors.push(pts.length - 1);
  const out = [];
  for (let a = 0; a < anchors.length - 1; a++) {
    const seg = simplify(pts.slice(anchors[a], anchors[a + 1] + 1), tol);
    out.push(...(a ? seg.slice(1) : seg));
  }
  return out;
}

const squeeze = async (m) => MAGIC + b64url(await through(
  new TextEncoder().encode(JSON.stringify(pack(m))), new CompressionStream('deflate-raw')));

/** The model as a link code. `info` is filled with what encoding did —
    { thinnedM, chars } — so the page can say it rather than guess. */
export async function encodeShared(model, info = {}) {
  needStreams();
  let m = model;
  let code = await squeeze(m);
  for (const tol of THIN_STEPS) {
    if (code.length <= LINK_BUDGET) break;
    m = {
      ...model,
      trail: thinKeeping(model.trail, tol),
      track: thinKeeping(model.track, tol),
      contamination: (model.contamination ?? []).map(c => ({ points: thinKeeping(c.points, tol) })),
      thinnedM: tol,
    };
    code = await squeeze(m);
  }
  /* Past either limit a link is refused on opening, so it is not made at all:
     the length of the code, and the number of points inside it. */
  const points = [m.trail, m.hides, m.track, m.wps, ...(m.contamination ?? []).map(c => c.points)]
    .reduce((n, l) => n + (Array.isArray(l) ? l.length : 0), 0);
  if (code.length > MAX_CODE || points > MAX_POINTS || (m.contamination?.length ?? 0) > MAX_LINES) {
    throw refuse('This run is too long for a link. Save it as a GPX file instead');
  }
  info.thinnedM = m.thinnedM || 0;
  info.chars = code.length;
  return code;
}

export async function decodeShared(code) {
  const s = String(code ?? '').trim();
  if (!s.startsWith(MAGIC)) {
    if (/^TS\d+\./.test(s)) throw new Error('This trail was shared from a newer Trailcraft — update the app to open it');
    throw new Error('This link does not hold a shared trail');
  }
  needStreams();
  if (s.length > MAX_CODE) throw refuse(TOO_BIG);
  let bytes, json;
  try {
    bytes = await inflate(unb64url(s.slice(MAGIC.length)), MAX_JSON);
    if (bytes) json = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error('This shared trail is damaged — the link may have been cut short when it was copied');
  }
  if (!bytes) throw refuse(TOO_BIG);
  try {
    return unpack(json);
  } catch (e) {
    throw e?.plain ? e : refuse(DAMAGED);
  }
}

export const sharedUrl = (code, base) => `${String(base).replace(/#.*$/, '')}#t=${code}`;

/** The code inside a pasted link or bare text, or null. */
export function sharedFromText(text) {
  const m = String(text ?? '').match(/(TS\d+\.[A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

/* ── A run someone sent, kept on this phone ───────────────────────── */

/** The model dressed as a session, so the map screen can show it exactly
    as it shows this phone's own. The coach and what was seen on the ground
    come with it: the shared page lists both as part of the run, and a kept
    copy that dropped them passed on less than it was given. */
export function sessionFromModel(m) {
  return {
    id: 'shared', targetId: m.kind === 'search' ? 'article' : 'person',
    startedAt: m.laidAt ?? Date.now(), dogId: null, handlerId: null, layerId: null, summary: headline(m),
    name: m.name ?? null,
    data: {
      trail: m.trail ?? undefined, hides: m.hides ?? undefined, contamination: m.contamination ?? [],
      weather: m.wx ?? null, runWeather: m.runWx ?? undefined, track: m.track ?? undefined, trackWaypoints: m.wps ?? [],
      trackStarted: m.runAt ?? undefined, result: m.result ?? undefined, plan: m.plan, walked: m.walked,
      drawn: !!m.drawn, k: m.k,
      debrief: m.debrief ?? undefined, coach: m.coach ?? undefined, seen: m.seen ?? undefined,
      /* Kept with the run, or a run the sender revealed would be called blind
         once it is on this phone. */
      revealedAt: m.revealedAt ?? undefined,
    },
  };
}

/** A shared run saved among this phone's records. None of its people are on
    this phone, so there are no ids to point at: the dog, the handler and the
    layer are kept as the names they came with. `from` stays for the builds
    that read only that. */
export function keptSession(m, { id, at }) {
  const s = sessionFromModel(m);
  return { ...s, id, data: { ...s.data, imported: {
    from: m.handler ?? null, at, dog: m.dog ?? null, handler: m.handler ?? null, layer: m.layer ?? null } } };
}

/** The dog, handler and layer behind a record, as trailModel wants them.
    This phone's own are looked up by id. A run kept from someone else's link
    has no ids here, and used to fall back to this phone's handler: a kept run
    passed on again went out under the name of someone who never ran it, with
    no dog at all. It now goes out under the names it came with. A run this
    phone made on a trail someone sent is this phone's, and only the layer is
    theirs.

    So is a kept trail with no track yet: nobody has run it, and whoever runs
    it will be on this phone. ownRun cannot say so until Stop writes the
    run's start, and a live run on a kept trail went out meanwhile under the
    sender's handler and dog. Only the layer keeps its kept name. */
export function peopleOf(s, { dogs = [], handlers = [], layers = [], me = null } = {}) {
  const byId = (list, id) => (id == null ? null : list.find(x => x?.id === id) ?? null);
  const named = (v) => (str(v) ? { name: str(v) } : null);
  const own = { dog: byId(dogs, s?.dogId), handler: byId(handlers, s?.handlerId), layer: byId(layers, s?.layerId) };
  const imp = s?.data?.imported;
  if (!imp || typeof imp !== 'object') return { ...own, handler: own.handler ?? me };
  const unrun = !(Array.isArray(s.data.track) && s.data.track.length);
  if (unrun || ownRun(s)) return { ...own, handler: own.handler ?? me, layer: own.layer ?? named(imp.layer) };
  /* A run kept before the names were stored has only `from`, which on a kept
     run was always the sender's handler. A Trail Card's trail is filed under
     this phone's handler, so its `from`, whoever sent the card, is not read. */
  return {
    dog: own.dog ?? cleanDog(imp.dog),
    handler: s.handlerId == null ? named('handler' in imp ? imp.handler : imp.from) : own.handler,
    layer: own.layer ?? named(imp.layer),
  };
}

/* ── GPX ──────────────────────────────────────────────────────────── */

const xml = (v) => String(v ?? '')
  .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
  .replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
const isoTime = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const deg = (x) => x.toFixed(7);

/* Child order follows the GPX 1.1 schema (ele, time, name, desc, sym, type) —
   strict importers reject a file that has them in any other order. */
function gpxPoint(tag, p, { name, sym, type } = {}) {
  return `<${tag} lat="${deg(p.lat)}" lon="${deg(p.lon)}">`
    + (fin(p.alt) ? `<ele>${p.alt.toFixed(1)}</ele>` : '')
    + (inEra(p.t) ? `<time>${isoTime(p.t)}</time>` : '')
    + (name ? `<name>${xml(name)}</name>` : '')
    + (sym ? `<sym>${xml(sym)}</sym>` : '')
    + (type ? `<type>${xml(type)}</type>` : '')
    + `</${tag}>`;
}

function gpxTrack(name, desc, type, pts) {
  return [
    '  <trk>',
    `    <name>${xml(name)}</name>`,
    desc ? `    <desc>${xml(desc)}</desc>` : null,
    `    <type>${xml(type)}</type>`,
    '    <trkseg>',
    ...pts.map(p => `      ${gpxPoint('trkpt', p)}`),
    '    </trkseg>',
    '  </trk>',
  ].filter(Boolean).join('\n');
}

/** The laid trail and the dog's run as two tracks in one file, with the start,
    the end, every hide and every mark as waypoints. */
export function toGpx(m, u = {}) {
  const dogName = m.dog?.name || 'Dog';
  const said = m.result ? resultSentence(m.result, m.dog?.name, u) : null;
  const all = [m.trail, m.hides, m.track, ...(m.contamination ?? []).map(c => c.points)].filter(Boolean).flat();
  const lats = all.map(p => p.lat), lons = all.map(p => p.lon);
  /* Asked as the app asks it (unwalkedPlan), so a drawn card is a drawn line
     here too, not a laid trail. */
  const drawn = unwalkedPlan(m);
  const title = m.kind === 'search' ? `${dogName} — ${m.target.toLowerCase()} search` : `${dogName} — trail`;

  const wpts = [];
  if (m.trail) {
    wpts.push(gpxPoint('wpt', m.trail[0], { name: 'Trail start', sym: 'Flag, Green' }));
    wpts.push(gpxPoint('wpt', m.trail[m.trail.length - 1], {
      name: m.layer ? `Trail end — ${m.layer}` : 'Trail end', sym: 'Flag, Red' }));
  }
  (m.hides ?? []).forEach((h, i) => wpts.push(gpxPoint('wpt', h, { name: `Hide ${i + 1}`, sym: 'Flag, Blue' })));
  (m.wps ?? []).forEach(w => wpts.push(gpxPoint('wpt', w, { name: w.kind || 'Mark', sym: 'Pin, Blue', type: 'Mark' })));

  const trks = [];
  if (m.trail?.length > 1) {
    trks.push(gpxTrack(
      drawn ? 'Drawn plan' : m.layer ? `Laid trail — ${m.layer}` : 'Laid trail',
      drawn ? 'Drawn on the map with a finger, not walked' : null,
      drawn ? 'Plan' : 'Laid trail', m.trail));
  }
  (m.contamination ?? []).forEach((c, i) => trks.push(gpxTrack(`Contamination ${i + 1}`, null, 'Contamination', c.points)));
  if (m.track?.length > 1) {
    trks.push(gpxTrack(`${dogName}’s run`,
      `Recorded on the handler’s phone${m.dog?.lineM ? `; the dog works about ${m.dog.lineM} m ahead on the line` : ''}`,
      'Dog run', m.track));
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="Trailcraft" xmlns="http://www.topografix.com/GPX/1/1" '
      + 'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" '
      + 'xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">',
    '  <metadata>',
    `    <name>${xml(title)}</name>`,
    said ? `    <desc>${xml(said)}</desc>` : null,
    inEra(m.laidAt) ? `    <time>${isoTime(m.laidAt)}</time>` : null,
    all.length ? `    <bounds minlat="${deg(Math.min(...lats))}" minlon="${deg(Math.min(...lons))}" `
      + `maxlat="${deg(Math.max(...lats))}" maxlon="${deg(Math.max(...lons))}"/>` : null,
    '  </metadata>',
    ...wpts.map(w => `  ${w}`),
    ...trks,
    '</gpx>',
    '',
  ].filter(v => v != null).join('\n');
}

/** A file name that sorts by date and survives every file system. */
export function fileBase(m) {
  const slug = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  let day = '';
  if (fin(m.laidAt)) {
    const d = new Date(m.laidAt);
    day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  return ['trailcraft', day, slug(m.dog?.name), m.kind === 'search' ? 'search' : 'trail'].filter(Boolean).join('-');
}

/* ── Every detail, in words ───────────────────────────────────────── */

/* Durations are said as the rest of the app says them (geo.js, fmtDur). This
   page had its own hours form, so a search the sentence timed at "1:15:00"
   sat above a grid, and a saved summary, reading "75:00". */
const clock = fmtDur;
const minutes = (min) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}`);

/** A result's one sentence, built from its numbers in the reader's units.
    The sentence saved with a result was fixed when it was graded, in the
    units in force then, so a shared page or report headed by it said "4 m"
    above rows in feet; and a result from before the median was kept carries
    a sentence that claimed too much. Grading, the result screen, the lists,
    the link and the report all say it from here, so they cannot disagree.
    A search with no indication has no numbers to say it from, and keeps its
    own; null when there is no result to read.

    With no dog's name to say it with — a run kept by a build that did not
    keep the name, or one whose dog has since been deleted — the sentence
    saved with the result is said instead, or `saved` (the record's summary)
    when it has none. Rebuilt, it came out as "The dog's track…" and threw
    away the one place the name survived; the saved words, in the units they
    were saved in, are the lesser loss. A result from before the median was
    kept is still rebuilt, because its saved sentence claimed too much. The
    saved text is a stranger's on a kept record: it comes through
    cleanResult, and every caller escapes what this returns. */
export function resultSentence(r, dogName, u = {}, saved = null) {
  const c = cleanResult(r);
  if (!c) return null;
  const named = typeof dogName === 'string' && dogName.trim() !== '';
  const legacy = c.kind === 'trail' && c.medAbs == null && c.mean != null;
  if (!named && !legacy) {
    const kept = c.sentence || (typeof saved === 'string' && saved.trim() ? saved : null);
    if (kept) return kept;
  }
  const dog = named ? dogName : 'The dog';
  const len = (x) => fmtShort(x, !!u.imperial);
  if (c.kind === 'search') {
    if (c.toFirst == null) return c.sentence ?? null;
    return `${dog} indicated in ${clock(c.toFirst)}`
      + (c.catchM != null ? `, ${c.catchApprox ? 'roughly ' : ''}${len(c.catchM)} from the hide` : '')
      + (c.catchM != null && c.catchApprox ? ' (the GPS had dropped out)' : '')
      + (c.approach ? `, coming ${c.approach}.` : '.');
  }
  const unread = `${dog} ran, but the track could not be compared with the line.`;
  /* Saved before the wording changed: only a signed mean. Its numbers still
     read; its sentence is said in today's words rather than as it was. */
  if (c.medAbs == null) {
    if (c.mean == null) return unread;
    const a = Math.abs(c.mean);
    return a < 3
      ? `${dog}’s track stayed close to the line — under ${len(3)} from it on average.`
      : `${dog}’s track sat mainly to the ${c.side ?? (c.mean > 0 ? 'right' : 'left')} of the line — about ${len(a)} from it on average.`;
  }
  if (!c.shares) return unread;
  /* The uncertainty is said only when there is a figure for it: "(±—)" is a
     placeholder, not a number. */
  if (c.noisy) return `${dog}’s track sat about ${len(c.medAbs)} from the line, but GPS uncertainty`
    + `${c.accMed != null ? ` (±${len(c.accMed)})` : ''} is too large to read which side.`;
  /* Judged on the share it prints. A link rounds the share to two places, so
     judging on the raw one let a run at 69.6 % read one way on the phone that
     ran it and "70 %" on the phone it was sent to. */
  const on = Math.round(c.shares.on * 100);
  if (on >= 70) return `${dog}’s track stayed within ${len(3)} of the line for ${on} % of the run.`;
  if (c.mainSide) return `${dog}’s track ran mainly to the ${c.mainSide} of the line — typically ${len(c.medAbs)} from it.`;
  return `${dog}’s track worked both sides of the line — typically ${len(c.medAbs)} from it.`;
}

/** The one sentence that leads — the verdict when there is one. */
export function headline(m, u = {}) {
  const said = m.result ? resultSentence(m.result, m.dog?.name, u) : null;
  if (said) return said;
  const n = m.hides?.length ?? 0;
  if (m.kind === 'search') return `${n} hide${n === 1 ? '' : 's'} set, not yet searched.`;
  /* A drawn card has no walk coming, so it is not said to be waiting for one. */
  if (unwalkedPlan(m)) return m.plan ? 'A trail drawn on the map, not yet walked.' : 'A trail drawn on the map, not yet run.';
  return `A trail laid${m.layer ? ` by ${m.layer}` : ''}, not yet run.`;
}

/** Every detail as titled sections of [label, value] rows: what the shared
    page lists and the printed report sets in type. `u` carries the reader's
    units and a date formatter, so nothing here decides how numbers look. */
export function detailSections(m, u = {}) {
  const imp = !!u.imperial, fahr = !!u.fahrenheit, coord = u.coord || 'dd';
  const when = u.when || ((ms) => new Date(ms).toLocaleString([], {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }));
  const r = m.result;
  const out = [];
  const drawn = unwalkedPlan(m);

  const team = [];
  if (m.dog?.name) {
    const age = fin(m.dog.dob) ? dogAge(m.dog.dob, m.runAt ?? m.laidAt ?? Date.now())?.text : null;
    team.push(['Dog', [m.dog.name, m.dog.breed, m.dog.sex, age,
      fin(m.dog.weightKg) ? fmtWeight(m.dog.weightKg, imp) : null].filter(Boolean).join(' · ')]);
  }
  if (m.handler) team.push(['Handler', m.handler]);
  if (m.layer && m.kind === 'trail') team.push(['Laid by', m.layer]);
  team.push(['Looking for', m.target]);
  out.push({ title: 'Team', rows: team });

  /* A drawn plan's laid time is when it was drawn, less a guessed walk, so
     any age worked from it is made up and too old. None until it is walked,
     and none ever for a drawn card, which no walk will come back for. */
  const ageMin = drawn ? null : fin(r?.ageMin) ? r.ageMin
    : fin(m.runAt) && fin(m.laidAt) ? Math.max(0, Math.round((m.runAt - m.laidAt) / 60000)) : null;
  const ageRow = fin(ageMin) ? [m.kind === 'search' ? 'Hide age at start' : 'Trail age at start',
    `${minutes(ageMin)}${ageBand(ageMin) ? ` · ${ageBand(ageMin).label}` : ''}`]
    : drawn && fin(m.runAt) ? ['Trail age at start', m.plan ? 'not known — drawn, not yet walked' : 'not known — drawn, not walked'] : null;

  if (m.kind === 'trail' && m.trail) {
    const tr = m.trail, a = tr[0], b = tr[tr.length - 1];
    const rows = [];
    if (fin(m.laidAt)) rows.push([drawn ? 'Drawn' : 'Laid', when(m.laidAt)]);
    rows.push(['Length', fmtDist(pathLen(tr), imp)]);
    if (!drawn && fin(a.t) && fin(b.t) && b.t > a.t) rows.push(['Walked in', clock(b.t - a.t)]);
    if (ageRow) rows.push(ageRow);
    rows.push(['Start', fmtCoord(a.lat, a.lon, coord)]);
    rows.push(['End', fmtCoord(b.lat, b.lon, coord)]);
    if (m.contamination?.length) {
      rows.push(['Contamination', `${m.contamination.length} crossing trail${m.contamination.length === 1 ? '' : 's'}`]);
    }
    out.push({ title: drawn ? 'Drawn plan' : 'Trail', rows });
  } else if (m.hides) {
    const rows = [];
    if (fin(m.laidAt)) rows.push(['Set', when(m.laidAt)]);
    if (ageRow) rows.push(ageRow);
    m.hides.forEach((h, i) => rows.push([`Hide ${i + 1}`, fmtCoord(h.lat, h.lon, coord)]));
    out.push({ title: m.hides.length === 1 ? 'Hide' : 'Hides', rows });
  }

  if (m.track) {
    const tr = m.track, a = tr[0], b = tr[tr.length - 1];
    const rows = [];
    if (fin(m.runAt)) rows.push(['Started', when(m.runAt)]);
    if (fin(a.t) && fin(b.t) && b.t > a.t) rows.push(['Duration', clock(b.t - a.t)]);
    rows.push(['Distance', fmtDist(pathLen(tr), imp)]);
    if (r?.kind === 'trail') {
      /* Recorded first, then the forecast's suggestion — kept apart, because
         only the first is a measurement. Older results carry only a mean. */
      const typical = fin(r.medAbs) ? r.medAbs : fin(r.mean) ? Math.abs(r.mean) : null;
      if (fin(typical)) rows.push(['Typical distance from the line', typical < 0.5 ? 'on the line' : fmtShort(typical, imp, 1)]);
      if (r.shares) {
        const pc = (x) => `${Math.round(x * 100)} %`;
        rows.push(['Time left · on · right', `${pc(r.shares.left)} · ${pc(r.shares.on)} · ${pc(r.shares.right)}`]);
      } else if (r.side && fin(r.mean) && Math.abs(r.mean) >= 0.5) {
        rows.push(['Mainly', `to the ${r.side}`]);
      }
      if (r.noisy && fin(r.accMed)) rows.push(['GPS uncertainty', `±${fmtShort(r.accMed, imp)} — too large to read the side`]);
      if (r.predSide) rows.push(['Forecast wind suggests drift', r.predSide > 0 ? 'to the right' : 'to the left']);
      const main = r.mainSide ?? (fin(r.mean) && Math.abs(r.mean) >= 0.5 ? r.side : null);
      if (r.predSide && main && !r.noisy) {
        rows.push(['Track vs forecast', (r.predSide > 0 ? 'right' : 'left') === main ? 'same side' : 'other side']);
      }
      if (r.regimeWord) rows.push(['Wind to the trail', cap(String(r.regimeWord))]);
      if (r.stability) rows.push(['Air at ground level', String(r.stability)]);
    } else if (r?.kind === 'search') {
      rows.push(['First indication', fin(r.toFirst) ? clock(r.toFirst) : 'none marked']);
      if (fin(r.catchM)) rows.push(['From the hide', fmtShort(r.catchM, imp)]);
      if (r.approach) rows.push(['Came in', String(r.approach)]);
    }
    if (fin(m.dog?.lineM) && m.dog.lineM > 0) rows.push(['Line', fmtShort(m.dog.lineM, imp)]);
    out.push({ title: 'Run', rows });
  }

  /* What the handler judged, kept apart from what the phone measured above it.
     The call comes first because it was made first: before they looked. */
  const call = (m.wps ?? []).find(w => w.kind === 'Indication' && w.call?.conf)?.call;
  const jd = m.debrief;
  if (call || jd?.outcome) {
    const rows = [];
    if (call) rows.push(['Their call, before looking', callLabel(call.conf)
      + (call.seen ? ' (trail already on screen)' : '')]);
    if (jd?.outcome) {
      for (const f of DEBRIEF) {
        /* Third person: whoever opens this is not the handler who answered. */
        const v = toldOf(f.id, jd[f.id]);
        if (v) rows.push([toldField(f.id), v]);
      }
      if (jd.flags?.length) rows.push(['Flagged', jd.flags.map(f => FLAGS.find(x => x.v === f)?.label ?? f).join(', ')]);
      if (jd.note) rows.push(['For next time', jd.note]);
    }
    out.push({ title: jd?.by ? `Judged by ${jd.by}` : 'Judged by the handler', rows,
      note: jd?.outcome ? 'Written by the handler after the run. None of it comes from the phone.' : undefined });
  }

  /* What the handler saw on the ground: an observation, not a judgement, and
     not a forecast. */
  const seen = seenLine(m.seen);
  if (seen) {
    out.push({ title: 'Seen on the ground', rows: [['Conditions', seen]],
      note: 'What the handler saw on the day, written down by hand.' });
  }

  const wx = m.wx, wind = r?.wind ?? (wx ? { speed: wx.wind_speed, from: wx.wind_direction } : null);
  const weather = [];
  if (fin(wx?.temp)) weather.push(['Air', fmtTemp(wx.temp, fahr)]);
  if (fin(wx?.soil_temp)) weather.push(['Ground', fmtTemp(wx.soil_temp, fahr)]);
  if (fin(wind?.speed)) weather.push([r?.wind ? 'Wind during the run' : 'Wind',
    `${fmtSpeed(wind.speed, imp)}${fin(wind.from) ? ` from ${cardinal(wind.from)}` : ''}`]);
  if (fin(wx?.wind_gusts)) weather.push(['Gusts', fmtSpeed(wx.wind_gusts, imp)]);
  if (fin(wx?.humidity)) weather.push(['Humidity', `${Math.round(wx.humidity)} %`]);
  /* As a rate: the record holds a 15-minute total, and "0.5 mm" with no
     time attached reads as a drizzle when it is 2 mm an hour. */
  if (rainRate(wx) > 0) weather.push(['Rain', `${rainRate(wx).toFixed(1)} mm/h`]);
  if (weather.length) out.push({ title: 'Weather', rows: weather, note: 'Forecast for open ground, wind at 10 m (Open-Meteo)' });

  if (m.wps?.length && fin(m.track?.[0]?.t)) {
    out.push({ title: 'Marks', rows: m.wps.map(w => [w.kind || 'Mark', fin(w.t) ? clock(w.t - m.track[0].t) : '—']) });
  }

  /* Whether the run was coached is part of the record: a run with a voice
     saying "left" is not the same evidence as a blind one. */
  const c = m.coach;
  if (c && typeof c === 'object') {
    const rows = [];
    /* Blind is about what the handler knew (ranBlind, the test every screen
       uses). A coach-off run with the trail revealed on screen is not one,
       and the reader is told when; nor is one whose debrief says the
       handler knew the answer. */
    const into = !trailShown(m) ? null : fin(m.runAt) ? m.revealedAt - m.runAt : NaN;
    rows.push(['Run', c.assisted ? 'assisted — the coach was on'
      : ranBlind(m) ? 'blind — no prompts'
      : into == null ? 'coach off, but the handler knew the answer'
      : !fin(into) ? 'coach off, but the trail was shown on screen'
      : into < 0 ? 'coach off, but the trail had been shown on screen on an earlier run'
      : `coach off, but the trail was shown on screen ${clock(into)} into the run`]);
    if (c.assisted) {
      rows.push(['Corridor', `${fmtShort(c.tolM ?? 20, imp)}${c.scent ? ' · experimental scent corridor' : ''}`]);
      if (fin(c.calls)) rows.push(['Coach calls', String(c.calls)]);
    }
    if (c.shadow && fin(c.shadow.plain)) {
      rows.push(['Had the coach been on', `${c.shadow.plain} call${c.shadow.plain === 1 ? '' : 's'} with a ${fmtShort(c.shadow.tolM ?? 20, imp)} corridor`
        + (fin(c.shadow.scent) ? `, ${c.shadow.scent} with the scent corridor` : '')]);
    }
    out.push({ title: 'Coach', rows });
  }
  return out;
}

/** Caveats the reader has to see, in the order they matter. */
export function notes(m) {
  const n = [];
  if (unwalkedPlan(m) && m.result) n.push('Compared against a line drawn on the map, not the trail as walked.');
  if (m.thinnedM > 0) n.push(`Lines thinned by up to ${m.thinnedM} m to fit in the link.`);
  n.push('The wind side and the scent band are estimates from a forecast, not measurements. They suggest an explanation; they do not judge the dog.');
  return n;
}

/* ── Live: the same trail, followed while it happens ──────────────── */

/** What a live run publishes before its first fix: everything but the run.
    The viewer sees the laid trail from the start — that was the choice made
    for this feature, so an instructor elsewhere can judge the dog against it. */
export function liveMeta(m, startedAt = Date.now()) {
  return {
    v: 1, kind: m.kind, target: m.target,
    dog: m.dog ? pick(m.dog, DOG_KEYS) : null,
    handler: m.handler, layer: m.layer,
    laidAt: m.laidAt, startedAt,
    plan: m.plan, walked: m.walked,
    trail: m.trail, hides: m.hides,
    contamination: m.contamination ?? [],
    wx: packWx(m.wx) ?? null,
    k: m.k,
  };
}

/** A model again, from the live document and its minute-by-minute chunks
    of track — in time order whatever order they arrived in. */
export function liveModel(meta, chunks = []) {
  /* Someone else's run, read from the cloud: held to the same limits and the
     same checks as a link, and the newest fixes kept if it ran past them. */
  const pts = (Array.isArray(chunks) ? chunks : []).flat().filter(p => fin(p?.lat) && fin(p?.lon))
    .sort((a, b) => (a.t ?? 0) - (b.t ?? 0)).slice(-MAX_POINTS);
  const okPts = (a) => (Array.isArray(a) && a.length ? a.slice(0, MAX_POINTS).filter(p => fin(p?.lat) && fin(p?.lon)) : null);
  return {
    kind: meta?.kind === 'search' ? 'search' : 'trail',
    target: str(meta?.target) ?? 'A person',
    laidAt: era(meta?.laidAt),
    runAt: era(meta?.startedAt),
    dog: cleanDog(meta?.dog),
    handler: str(meta?.handler), layer: str(meta?.layer),
    plan: !!meta?.plan, walked: !!meta?.walked,
    trail: okPts(meta?.trail), hides: okPts(meta?.hides),
    contamination: (Array.isArray(meta?.contamination) ? meta.contamination.slice(0, MAX_LINES) : [])
      .map(c => ({ points: okPts(c?.points) })).filter(c => c.points?.length > 1),
    track: pts.length > 1 ? pts : null,
    wps: okPts(meta?.wps) ?? [],
    wx: cleanWx(meta?.wx),
    result: healApproach(cleanResult(meta?.result)),
    k: fin(meta?.k) ? meta.k : null,
    ended: !!meta?.ended,
    thinnedM: 0,
  };
}
