/* A finished trail, sent beyond this phone: a link that carries every detail,
   a GPX file for any mapping app, and the rows of detail that the link's page
   and the printed report both read — so the two can never disagree.

   The link keeps the Trail Card's promise. The trail rides in the address's
   #fragment, which a browser never sends to a server: GitHub Pages hands over
   the page and never learns where anyone trained. The price is said where the
   link is made — it is long, and once sent it cannot be called back. */

import { simplify, pathLen, cardinal, fmtDist, fmtShort, fmtSpeed, fmtTemp, fmtWeight, fmtCoord } from './geo.js';
import { through, b64url, unb64url, needStreams } from './card.js';
import { targetById, ageBand, dogAge } from './store.js';

const MAGIC = 'TS1.';
const fin = Number.isFinite;
const str = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 80) : null);
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
    target: t.label,
    laidAt: s?.startedAt ?? null,
    runAt: d.trackStarted ?? null,
    dog: dog ? pick(dog, DOG_KEYS) : null,
    handler: handler?.name ?? null,
    layer: layer?.name ?? null,
    plan: !!d.plan,
    walked: !!d.walked,
    trail: d.trail?.length ? d.trail : null,
    hides: d.hides?.length ? d.hides : null,
    contamination: (d.contamination ?? []).filter(c => c?.points?.length > 1).map(c => ({ points: c.points })),
    track: d.track?.length > 1 ? d.track : null,
    wps: d.track?.length > 1 ? (d.trackWaypoints ?? []) : [],
    wx: d.weather ?? null,
    result: d.result ?? null,
    k: fin(k) ? k : null,
    thinnedM: 0,
  };
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
  return o;
}

function unpackPts(o) {
  if (!o || !Array.isArray(o.lat) || !Array.isArray(o.lon) || o.lat.length !== o.lon.length || !o.lat.length) return null;
  const lat = sums(o.lat), lon = sums(o.lon);
  const t = Array.isArray(o.t) && o.t.length === lat.length ? sums(o.t) : null;
  const alt = Array.isArray(o.alt) && o.alt.length === lat.length ? sums(o.alt) : null;
  const pts = lat.map((v, i) => {
    const p = { lat: v / 1e6, lon: lon[i] / 1e6 };
    if (t) p.t = t[i] * 1000;
    if (alt) p.alt = alt[i] / 10;
    return p;
  });
  for (const [i, s] of Array.isArray(o.dw) ? o.dw : []) if (pts[i] && fin(s)) pts[i].dwellS = s;
  for (const [i, k] of Array.isArray(o.kd) ? o.kd : []) if (pts[i]) pts[i].kind = String(k).slice(0, 40);
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

const roundDeep = (v) => (fin(v) ? round(v, 2)
  : Array.isArray(v) ? v.map(roundDeep)
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, roundDeep(x)]))
  : v);

function pack(m) {
  const o = {
    kind: m.kind, target: m.target, laidAt: m.laidAt, runAt: m.runAt,
    dog: m.dog ? pick(m.dog, DOG_KEYS) : undefined,
    handler: m.handler, layer: m.layer,
    plan: m.plan ? 1 : undefined, walked: m.walked ? 1 : undefined,
    trail: packPts(m.trail), hides: packPts(m.hides), track: packPts(m.track), wps: packPts(m.wps),
    contam: m.contamination?.length ? m.contamination.map(c => packPts(c.points)) : undefined,
    wx: packWx(m.wx), result: m.result ? roundDeep(m.result) : undefined,
    k: m.k, thinnedM: m.thinnedM || undefined,
  };
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v != null));
}

/* Everything read back from a link is a stranger's input: every field is
   checked for its type here, and every string is escaped where it is shown. */
function unpack(o) {
  if (!o || typeof o !== 'object') throw new Error('This shared trail is damaged');
  const trail = unpackPts(o.trail), hides = unpackPts(o.hides), track = unpackPts(o.track);
  if (!trail && !hides) throw new Error('This shared trail is damaged — ask for the link again');
  const kind = o.kind === 'search' ? 'search' : 'trail';
  const dog = o.dog && typeof o.dog === 'object' ? {
    ...pick({ name: str(o.dog.name), breed: str(o.dog.breed), sex: str(o.dog.sex) }, ['name', 'breed', 'sex']),
    ...pick({ dob: fin(o.dog.dob) ? o.dog.dob : null, weightKg: fin(o.dog.weightKg) ? o.dog.weightKg : null,
      lineM: fin(o.dog.lineM) ? o.dog.lineM : null }, ['dob', 'weightKg', 'lineM']),
  } : null;
  return {
    kind,
    target: str(o.target) ?? (kind === 'search' ? 'A hide' : 'A person'),
    laidAt: fin(o.laidAt) ? o.laidAt : null,
    runAt: fin(o.runAt) ? o.runAt : null,
    dog,
    handler: str(o.handler),
    layer: str(o.layer),
    plan: !!o.plan,
    walked: !!o.walked,
    trail, hides,
    track: track?.length > 1 ? track : null,
    wps: unpackPts(o.wps) ?? [],
    contamination: (Array.isArray(o.contam) ? o.contam : []).map(unpackPts).filter(p => p?.length > 1).map(points => ({ points })),
    wx: o.wx && typeof o.wx === 'object' ? o.wx : null,
    result: o.result && typeof o.result === 'object' ? o.result : null,
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
  let json;
  try {
    const bytes = await through(unb64url(s.slice(MAGIC.length)), new DecompressionStream('deflate-raw'));
    json = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error('This shared trail is damaged — the link may have been cut short when it was copied');
  }
  return unpack(json);
}

export const sharedUrl = (code, base) => `${String(base).replace(/#.*$/, '')}#t=${code}`;

/** The code inside a pasted link or bare text, or null. */
export function sharedFromText(text) {
  const m = String(text ?? '').match(/(TS\d+\.[A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

/* ── GPX ──────────────────────────────────────────────────────────── */

const xml = (v) => String(v ?? '')
  .replace(/[ --]/g, '')
  .replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
const isoTime = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const deg = (x) => x.toFixed(7);

/* Child order follows the GPX 1.1 schema (ele, time, name, desc, sym, type) —
   strict importers reject a file that has them in any other order. */
function gpxPoint(tag, p, { name, sym, type } = {}) {
  return `<${tag} lat="${deg(p.lat)}" lon="${deg(p.lon)}">`
    + (fin(p.alt) ? `<ele>${p.alt.toFixed(1)}</ele>` : '')
    + (fin(p.t) ? `<time>${isoTime(p.t)}</time>` : '')
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
export function toGpx(m) {
  const dogName = m.dog?.name || 'Dog';
  const all = [m.trail, m.hides, m.track, ...(m.contamination ?? []).map(c => c.points)].filter(Boolean).flat();
  const lats = all.map(p => p.lat), lons = all.map(p => p.lon);
  const drawn = m.plan && !m.walked;
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
    m.result?.sentence ? `    <desc>${xml(m.result.sentence)}</desc>` : null,
    fin(m.laidAt) ? `    <time>${isoTime(m.laidAt)}</time>` : null,
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

const clock = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  return h ? `${h}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${mm}:${String(ss).padStart(2, '0')}`;
};
const minutes = (min) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}`);

/** The one sentence that leads — the verdict when there is one. */
export function headline(m) {
  if (m.result?.sentence) return m.result.sentence;
  const n = m.hides?.length ?? 0;
  if (m.kind === 'search') return `${n} hide${n === 1 ? '' : 's'} set, not yet searched.`;
  if (m.plan && !m.walked) return 'A trail drawn on the map, not yet walked.';
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
  const drawn = m.plan && !m.walked;

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

  const ageMin = fin(r?.ageMin) ? r.ageMin
    : fin(m.runAt) && fin(m.laidAt) ? Math.max(0, Math.round((m.runAt - m.laidAt) / 60000)) : null;
  const ageRow = fin(ageMin) ? [m.kind === 'search' ? 'Hide age at start' : 'Trail age at start',
    `${minutes(ageMin)}${ageBand(ageMin) ? ` · ${ageBand(ageMin).label}` : ''}`] : null;

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
      if (fin(r.mean)) rows.push(['Average offset', Math.abs(r.mean) < 0.5 ? 'on the line'
        : `${fmtShort(Math.abs(r.mean), imp, 1)}${r.side ? ` to the ${r.side}` : ''}`]);
      if (r.predSide) rows.push(['Wind pushed scent', r.predSide > 0 ? 'to the right' : 'to the left']);
      if (r.predSide && fin(r.agree)) rows.push(['On the scent side', `${Math.round(r.agree * 100)} % of the run`]);
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

  const wx = m.wx, wind = r?.wind ?? (wx ? { speed: wx.wind_speed, from: wx.wind_direction } : null);
  const weather = [];
  if (fin(wx?.temp)) weather.push(['Air', fmtTemp(wx.temp, fahr)]);
  if (fin(wx?.soil_temp)) weather.push(['Ground', fmtTemp(wx.soil_temp, fahr)]);
  if (fin(wind?.speed)) weather.push([r?.wind ? 'Wind during the run' : 'Wind',
    `${fmtSpeed(wind.speed, imp)}${fin(wind.from) ? ` from ${cardinal(wind.from)}` : ''}`]);
  if (fin(wx?.wind_gusts)) weather.push(['Gusts', fmtSpeed(wx.wind_gusts, imp)]);
  if (fin(wx?.humidity)) weather.push(['Humidity', `${Math.round(wx.humidity)} %`]);
  if (fin(wx?.precipitation) && wx.precipitation > 0) weather.push(['Rain', `${wx.precipitation.toFixed(1)} mm`]);
  if (weather.length) out.push({ title: 'Weather', rows: weather, note: 'Forecast for open ground, wind at 10 m (Open-Meteo)' });

  if (m.wps?.length && fin(m.track?.[0]?.t)) {
    out.push({ title: 'Marks', rows: m.wps.map(w => [w.kind || 'Mark', fin(w.t) ? clock(w.t - m.track[0].t) : '—']) });
  }
  return out;
}

/** Caveats the reader has to see, in the order they matter. */
export function notes(m) {
  const n = [];
  if (m.plan && !m.walked && m.result) n.push('Graded against a line drawn on the map, not the trail as walked.');
  if (m.thinnedM > 0) n.push(`Lines thinned by up to ${m.thinnedM} m to fit in the link.`);
  n.push('The model explains what the dog did. It does not predict where scent is.');
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
  const pts = chunks.flat().filter(p => fin(p?.lat) && fin(p?.lon)).sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
  const okPts = (a) => (Array.isArray(a) && a.length ? a.filter(p => fin(p?.lat) && fin(p?.lon)) : null);
  return {
    kind: meta?.kind === 'search' ? 'search' : 'trail',
    target: str(meta?.target) ?? 'A person',
    laidAt: fin(meta?.laidAt) ? meta.laidAt : null,
    runAt: fin(meta?.startedAt) ? meta.startedAt : null,
    dog: meta?.dog && typeof meta.dog === 'object' ? pick(meta.dog, DOG_KEYS) : null,
    handler: str(meta?.handler), layer: str(meta?.layer),
    plan: !!meta?.plan, walked: !!meta?.walked,
    trail: okPts(meta?.trail), hides: okPts(meta?.hides),
    contamination: (Array.isArray(meta?.contamination) ? meta.contamination : [])
      .map(c => ({ points: okPts(c?.points) })).filter(c => c.points?.length > 1),
    track: pts.length > 1 ? pts : null,
    wps: okPts(meta?.wps) ?? [],
    wx: meta?.wx && typeof meta.wx === 'object' ? meta.wx : null,
    result: meta?.result && typeof meta.result === 'object' ? meta.result : null,
    k: fin(meta?.k) ? meta.k : null,
    ended: !!meta?.ended,
    thinnedM: 0,
  };
}
