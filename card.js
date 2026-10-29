/* Trail Cards — a trail encoded into a single QR code, so an instructor hands
   a trail to a student phone-to-phone in a car park with zero bars. The data
   IS the code: no server, no account, nothing leaves the two phones.

   One QR, deliberately. Animated multi-frame codes fail exactly where this is
   used — two phones at arm's length in field light, one of them shaking — and
   a frame missed is a trail corrupted. Everything here serves squeezing a
   trail into one scannable code instead:

     - simplify to ≤120 points (geo.js Douglas–Peucker; the card records that
       it thinned the line, and the tolerance bounds the error);
     - quantize lat/lon to 1e-5° (~1.1 m) and times to whole seconds — honest
       for GPS data whose own accuracy is 3 m on a good day;
     - delta-encode (consecutive fixes differ by metres, so deltas are small
       integers), then deflate, then base64url.

   The `TC1.` prefix is the version contract: a future format bumps to TC2.
   and a phone that only speaks TC1 says "newer card than this app" instead
   of mis-reading it. CompressionStream is used for deflate — present in every
   browser this app supports and in Node ≥18, so the tests run the same code. */

import { simplify, pathLen, dist } from './geo.js';

const MAGIC = 'TC1.';
const MAX_PTS = 120;
/* One QR holds under 3,000 characters, so a card several times that long, or
   one that inflates past a quarter of a megabyte, was never made by this app.
   A card can also arrive as a link, and a link has no QR to limit it. */
const MAX_CARD = 8000;
const MAX_CARD_JSON = 256 * 1024;

/* ── byte plumbing ────────────────────────────────────────────────── */

export async function through(bytes, stream) {
  const out = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

/** Inflate, but stop once the output passes `max` bytes and give back null.
    Deflate squeezes a run of zeros about a thousand to one, so a code of a
    few kilobytes can otherwise unfold into hundreds of megabytes before
    anything has looked at it. */
export async function inflate(bytes, max) {
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const parts = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > max) {
      reader.cancel().catch(() => {});
      return null;
    }
    parts.push(value);
  }
  const out = new Uint8Array(n);
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}

export const b64url = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export const unb64url = (s) => {
  const raw = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
};

/* ── the card ─────────────────────────────────────────────────────── */

const q = (deg) => Math.round(deg * 1e5);
const deltas = (ints) => ints.map((v, i) => i ? v - ints[i - 1] : v);
const absolutes = (ds) => { let a = 0; return ds.map(d => (a += d)); };

/* iOS below 16.4 has no CompressionStream — name the real cause instead of
   letting a ReferenceError masquerade as a damaged card. */
export function needStreams() {
  if (typeof CompressionStream === 'undefined' || typeof DecompressionStream === 'undefined') {
    throw new Error('Trail Cards need iOS 16.4 or newer');
  }
}

/** A session's trail as a Trail Card string.
    `info`, if given, is filled with what the encoding actually did —
    { tol, wpsKept, wpsTotal } — so the UI can state the REAL thinning bound
    and mark count instead of a hard-coded guess. */
export async function encodeTrail(session, info = {}) {
  needStreams();
  let pts = session.points || [];
  if (pts.length < 2) throw new Error('Nothing to share — the trail has no line');

  // Thin adaptively: double the tolerance until the card fits. The final
  // tolerance bounds how far the shared line can sit from the recorded one.
  let tol = 2, tolUsed = 0;
  while (pts.length > MAX_PTS && tol <= 64) {
    pts = simplify(session.points, tol);
    tolUsed = tol;
    tol *= 2;
  }
  // Refusing beats truncating: silently dropping the tail of a trail is the
  // one thing this app must never do to data.
  if (pts.length > MAX_PTS) throw new Error('Trail too long and twisty for one card — share it as GPX instead');

  // Marks accumulate chronologically, so when they overflow the card keep the
  // LAST twelve: the indication and the article are at the end of a session.
  const allWps = session.waypoints || [];
  const wps = allWps.slice(-12);

  info.tol = tolUsed; info.wpsKept = wps.length; info.wpsTotal = allWps.length;

  const payload = {
    v: 1,
    f: String(session.from || '').slice(0, 40),
    d: session.drawn ? 1 : 0,
    /* Optional relay fields, additive on purpose: an older app ignores them
       and still reads the line. k: 0/absent = a laid trail; 1 = a PLAN the
       layer's phone walks them along; 2 = the WALKED trail coming back.
       g = the chosen ageing countdown, minutes. */
    ...(session.kind ? { k: session.kind } : {}),
    ...(Number.isFinite(session.ageMin) ? { g: Math.max(0, Math.min(1440, Math.round(session.ageMin))) } : {}),
    /* i = which plan: the handler's session id on a plan card, echoed back on
       the walked card, so the walk goes back to the plan it was drawn as and
       not to whichever plan happens to be newest. */
    ...(session.planId ? { i: String(session.planId).slice(0, 32) } : {}),
    a: tolUsed,               // 0 = untouched; otherwise the metric bound itself
    p: [
      deltas(pts.map(p => q(p.lat))),
      deltas(pts.map(p => q(p.lon))),
      deltas(pts.map(p => Math.round(p.t / 1000))),
    ],
    w: wps.map(w =>
      [String(w.kind || 'note').slice(0, 16), q(w.lat), q(w.lon), Math.round(w.t / 1000)]),
  };

  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const packed = await through(bytes, new CompressionStream('deflate-raw'));
  return MAGIC + b64url(packed);
}

/* ── Contamination cards ──────────────────────────────────────────────
   Three more kinds, for the people who lay contamination across a trail:
     3 = a guided route for their phone to walk them along (no clock: it is
         a drawn line, and they make the clock by walking it);
     4 = a free walk: no line at all, only which trail and which person;
     5 = their walk coming back: the real line with its real clock.

   They go out under `TC2.`, not TC1. An app that only speaks TC1 reads any
   unknown kind as a plain laid trail, and would have offered to RUN a
   contamination route as if it were the trail. Under TC2 the same app says
   "this card is from a newer Trailcraft", which is the truth. Every TC1 card
   still decodes exactly as before.

   Each names its trail (i) and its person (c) by id, both required and both
   held to the same allow-list as a plan id: a walk that comes back goes to
   that person's line on that trail, or to nothing. */
const MAGIC2 = 'TC2.';
const CONTAM_KINDS = new Set([3, 4, 5]);
const DAMAGED = 'Trail Card is damaged — try scanning again';
const T_MIN = Date.UTC(2000, 0, 1), T_MAX = Date.UTC(2100, 0, 1);
const IDS = /^[\w-]{1,32}$/;
/* A contamination walk is someone walking across a field, not a day's
   march: one that lasts longer than this was not made by this app. */
const MAX_WALK_MS = 12 * 3600e3;

/** A contamination entry as a card: `kind` 3 (route), 4 (free) or 5 (walked).
    `info` is filled as encodeTrail fills it.

    Whatever this makes, decodeTrail takes: the decoder's bounds are applied
    here first, so a person is never handed a code the handler's phone can
    only call damaged. `forLink` is for a walk too long and winding for one
    QR code: as a link it may carry twice the points (the decoder's own
    limit), and only then is it thinned past 16 m. */
export async function encodeContam(c, info = {}, { forLink = false } = {}) {
  needStreams();
  const kind = c?.kind;
  if (!CONTAM_KINDS.has(kind)) throw new Error('Not a contamination card');
  if (!IDS.test(String(c.planId || '')) || !IDS.test(String(c.cid || ''))) throw new Error('That contamination line has no id yet');
  let all = kind === 4 ? [] : (c.points || []);
  if (kind !== 4 && all.length < 2) throw new Error('Nothing to share — the line has no points');
  if (!all.every(p => Number.isFinite(p?.lat) && Number.isFinite(p?.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180)) {
    throw new Error('That line has a point off the map');
  }
  if (kind === 5) {
    if (!all.every(p => Number.isFinite(p.t))) throw new Error('That walk has no clock');
    if (all.some((p, i) => i && p.t < all[i - 1].t)) throw new Error('That walk’s clock is out of order');
    if (all[0].t < T_MIN || all[all.length - 1].t > T_MAX) throw new Error('That walk’s clock is wrong');
    /* Someone who forgot to tap Done leaves the phone recording on a table:
       the walk is at the start, so the first 12 hours are kept (a second
       short of it, for the clock rounded to whole seconds) and the rest,
       which no contamination walk lasts, is left off. */
    const end = all[0].t + MAX_WALK_MS - 1000;
    if (all[all.length - 1].t > end) all = all.filter(p => p.t <= end);
    if (all.length < 2) throw new Error('That walk has no track to send');
  }
  /* A little under the decoder's 200 km, for the rounding of each point. */
  if (kind !== 4 && pathLen(all) > 199000) throw new Error('That walk is too long to send back');
  /* A walk's crossings are measured to 15 m (contam.js), so it is thinned by
     no more than 16 m for a QR code; a link may go further, and says so. */
  const cap = forLink ? 2 * MAX_PTS : MAX_PTS;
  const maxTol = kind === 5 && !forLink ? 16 : 64;
  let pts = all, tol = 2, tolUsed = 0;
  while (pts.length > cap && tol <= maxTol) {
    pts = simplify(all, tol);
    tolUsed = tol;
    tol *= 2;
  }
  if (pts.length > cap) throw new Error(TOO_TWISTY);
  info.tol = tolUsed;
  const payload = {
    v: 2, k: kind,
    i: String(c.planId), c: String(c.cid),
    f: String(c.from || '').slice(0, 40),
    n: String(c.who || '').slice(0, 40),
    o: c.order === 'after' ? 'a' : 'b',
    ...(Number.isInteger(c.ci) && c.ci >= 0 && c.ci < 8 ? { x: c.ci } : {}),
    ...(kind === 4 ? {} : {
      a: tolUsed,
      p: kind === 5
        ? [deltas(pts.map(p => q(p.lat))), deltas(pts.map(p => q(p.lon))), deltas(pts.map(p => Math.round(p.t / 1000)))]
        : [deltas(pts.map(p => q(p.lat))), deltas(pts.map(p => q(p.lon)))],
    }),
  };
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const packed = await through(bytes, new CompressionStream('deflate-raw'));
  const out = MAGIC2 + b64url(packed);
  if (out.length > MAX_CARD) throw new Error(TOO_TWISTY);
  return out;
}

/** What encodeContam says when a walk will not go in one QR code: the
    caller then offers it as a link (forLink). */
export const TOO_TWISTY = 'That walk is too long and twisty for one card';

/** A TC2 card's payload, held to the same bounds as a Trail Card's. */
function contamFromPayload(payload) {
  const bad = () => { throw new Error(DAMAGED); };
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || payload.v !== 2 || !CONTAM_KINDS.has(payload.k)) bad();
  const kind = payload.k;
  if (typeof payload.i !== 'string' || !IDS.test(payload.i) || typeof payload.c !== 'string' || !IDS.test(payload.c)) bad();
  if (payload.o !== 'a' && payload.o !== 'b') bad();
  let points = [];
  if (kind === 4) {
    /* A free walk carries no line; one that does was not made by this app. */
    if (payload.p !== undefined) bad();
  } else {
    const cols = kind === 5 ? 3 : 2;
    if (!Array.isArray(payload.p) || payload.p.length !== cols
        || !payload.p.every(a => Array.isArray(a) && a.length <= 2 * MAX_PTS && a.every(v => Number.isInteger(v)))) bad();
    const [la, lo, ts] = payload.p.map(absolutes);
    if (la.length < 2 || lo.length !== la.length || (ts && ts.length !== la.length)) bad();
    points = la.map((v, i) => ({ lat: v / 1e5, lon: lo[i] / 1e5, ...(ts ? { t: ts[i] * 1000 } : {}) }));
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon) || Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180) bad();
      if (ts) {
        if (!Number.isFinite(p.t) || p.t < T_MIN || p.t > T_MAX) bad();
        if (i && p.t < points[i - 1].t) bad();
      }
    }
    if (pathLen(points) > 200000) bad();
    if (ts && points[points.length - 1].t - points[0].t > MAX_WALK_MS) bad();
  }
  const tol = typeof payload.a === 'number' && payload.a >= 2 && payload.a <= 64 ? payload.a : 0;
  return {
    kind,
    planId: payload.i, cid: payload.c,
    from: typeof payload.f === 'string' ? payload.f.slice(0, 40) : '',
    who: typeof payload.n === 'string' ? payload.n.slice(0, 40) : '',
    order: payload.o === 'a' ? 'after' : 'before',
    ci: Number.isInteger(payload.x) && payload.x >= 0 && payload.x < 8 ? payload.x : null,
    drawn: kind === 3, approx: tol > 0, tol,
    points, waypoints: [],
    started: kind === 5 ? points[0].t : null,
    ended: kind === 5 ? points[points.length - 1].t : null,
    ageMin: null,
  };
}

/** Whether a decoded card is one of the contamination kinds. */
export const isContamCard = (card) => CONTAM_KINDS.has(card?.kind);

/** A Trail Card string back into a trail. Throws plain-language errors — the
    message is shown to whoever scanned the code. */
export async function decodeTrail(str) {
  needStreams();
  const s = String(str || '').trim();
  if (!s.startsWith('TC')) throw new Error('Not a Trail Card');
  if (s.startsWith(MAGIC2)) {
    if (s.length > MAX_CARD) throw new Error(DAMAGED);
    let payload;
    try {
      const bytes = await inflate(unb64url(s.slice(MAGIC2.length)), MAX_CARD_JSON);
      if (!bytes) throw new Error('too big');
      payload = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new Error(DAMAGED);
    }
    return contamFromPayload(payload);
  }
  if (!s.startsWith(MAGIC)) throw new Error('This card is from a newer Trailcraft than this app');
  if (s.length > MAX_CARD) throw new Error('Trail Card is damaged — try scanning again');

  let payload;
  try {
    const packed = unb64url(s.slice(MAGIC.length));
    const bytes = await inflate(packed, MAX_CARD_JSON);
    if (!bytes) throw new Error('too big');
    payload = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error('Trail Card is damaged — try scanning again');
  }

  /* The lengths are checked before any column is summed: a crafted card
     can carry arrays far longer than any encoder writes. */
  if (!payload || typeof payload !== 'object' || payload.v !== 1 || !Array.isArray(payload.p)
      || payload.p.length !== 3 || !payload.p.every(a => Array.isArray(a) && a.length <= 2 * MAX_PTS)) {
    throw new Error('Trail Card is damaged — try scanning again');
  }
  const [la, lo, ts] = payload.p.map(absolutes);
  /* Cardinality is part of the format: a genuine encoder never emits more than
     MAX_PTS, so anything bigger is a crafted card trying to flood localStorage. */
  if (la.length < 2 || la.length > 2 * MAX_PTS
      || lo.length !== la.length || ts.length !== la.length) {
    throw new Error('Trail Card is damaged — try scanning again');
  }

  const points = la.map((v, i) => ({ lat: v / 1e5, lon: lo[i] / 1e5, t: ts[i] * 1000 }));
  // Times must live in a plausible era: everything downstream (GPX export,
  // date rendering, ageing) trusts these as real clock readings, and
  // Date.toISOString throws outright past year ~275760.
  const T_MIN = Date.UTC(2000, 0, 1), T_MAX = Date.UTC(2100, 0, 1);
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon) || !Number.isFinite(p.t)) throw new Error('Trail Card is damaged — try scanning again');
    if (Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180) throw new Error('Trail Card is damaged — try scanning again');
    if (p.t < T_MIN || p.t > T_MAX) throw new Error('Trail Card is damaged — try scanning again');
    if (i && p.t < points[i - 1].t) throw new Error('Trail Card is damaged — try scanning again');
  }
  if (pathLen(points) > 200000) throw new Error('Trail Card is damaged — try scanning again');

  const waypoints = (Array.isArray(payload.w) ? payload.w : [])
    .slice(0, 12)
    .filter(w => Array.isArray(w) && w.length === 4 && typeof w[0] === 'string')
    .map(w => ({ kind: w[0].slice(0, 16), lat: w[1] / 1e5, lon: w[2] / 1e5, t: w[3] * 1000 }))
    .filter(w => Number.isFinite(w.lat) && Number.isFinite(w.lon) && Number.isFinite(w.t)
      && Math.abs(w.lat) <= 90 && Math.abs(w.lon) <= 180 && w.t >= T_MIN && w.t <= T_MAX);

  // `a` carries the metric thinning bound itself (older TC1 cards sent 1 as a
  // bare flag — read that as the old wording's ~10 m).
  const tol = typeof payload.a === 'number' && payload.a >= 2 ? payload.a : (payload.a ? 10 : 0);

  // Relay fields are read defensively: a crafted kind collapses to a plain
  // trail, a crafted countdown to none — never to surprising behaviour.
  const kind = payload.k === 1 || payload.k === 2 ? payload.k : 0;
  const ageMin = Number.isFinite(payload.g) && payload.g >= 0 && payload.g <= 1440
    ? Math.round(payload.g) : null;
  const planId = typeof payload.i === 'string' && /^[\w-]{1,32}$/.test(payload.i) ? payload.i : null;

  return {
    from: typeof payload.f === 'string' ? payload.f.slice(0, 40) : '',
    drawn: !!payload.d,
    approx: !!payload.a,
    tol,
    kind, ageMin, planId,
    points, waypoints,
    started: points[0].t,
    ended: points[points.length - 1].t,
  };
}

/** Which plan on this phone a walked card (kind 2) belongs to.

    `plans` is this phone's own plans still waiting for their walk, newest
    first, each { id, planOf, run, start }: planOf is the plan a second run's
    copy was made from, run whether a dog has run it, start its first point.
    `asked` is the plan the handler scanned it for, if they did.

    A card that names its plan goes to that plan or to nothing. One from an
    older app names none, and then a guess is only made when there is nothing
    to choose between: with several plans waiting, the wrong one would have
    its dog graded against someone else's walk and banked into its
    calibration. So { ask } lists the ones to ask about, likeliest first. */
export function walkedPlanFor(card, plans = [], asked = null, { askAlways = false } = {}) {
  if (card?.planId) {
    const its = plans.filter(p => p.id === card.planId || p.planOf === card.planId);
    const hit = its.find(p => p.id === asked) ?? its.find(p => p.run) ?? its[0];
    if (!hit) return { id: null, why: 'other' };
    /* From a link, a plan id proves nothing: anyone who has seen the plan's
       QR can copy it into a card of their own. So the plan is named and asked
       about, unless the handler already said which plan it was for. */
    return askAlways && hit.id !== asked ? { id: null, ask: [hit.id] } : { id: hit.id };
  }
  if (asked) return { id: asked };
  const ran = plans.filter(p => p.run);
  const pool = ran.length ? ran : plans;
  /* askAlways: the card came in a link, not from the handler's own camera,
     so even a single waiting plan is named and asked about before a
     stranger's line can replace it. */
  if (pool.length <= 1 && !(askAlways && pool.length)) return { id: pool[0]?.id ?? null };
  const from = card?.points?.[0];
  const away = (p) => (from && p.start ? dist(from, p.start) : Infinity);
  return { id: null, ask: [...pool].sort((a, b) => away(a) - away(b)).map(p => p.id) };
}

/** Whether a session on this phone is a trail already taken from this card:
    imported, laid at the same moment, along the same line. Opening the same
    card link twice must not add the trail twice. */
export function sameCard(session, card) {
  const t = session?.data?.trail;
  const pts = card?.points;
  if (!session?.data?.imported || !Array.isArray(t) || !Array.isArray(pts) || !pts.length) return false;
  if (session.deleted || session.startedAt !== card.started || t.length !== pts.length) return false;
  const near = (a, b) => !!a && !!b && Math.abs(a.lat - b.lat) < 1e-6 && Math.abs(a.lon - b.lon) < 1e-6;
  return near(t[0], pts[0]) && near(t[t.length - 1], pts[pts.length - 1]);
}

/** Worst-case distance from any original point to the decoded POLYLINE — used
    by tests to hold the quantize+simplify error to its promised bound. To the
    line, not the nearest vertex: a thinned straight kilometre keeps only its
    two ends, and every dropped point is still on it. */
export function maxDeviation(original, decoded) {
  if (!decoded.length) return Infinity;
  const R = 6371000, rad = (d) => d * Math.PI / 180;
  const kx = Math.cos(rad(decoded[0].lat)) * R;
  const xy = (p) => [rad(p.lon) * kx, rad(p.lat) * R];
  const segs = decoded.map(xy);

  let worst = 0;
  for (const p of original) {
    const [px, py] = xy(p);
    let best = Infinity;
    for (let i = 1; i < segs.length; i++) {
      const [ax, ay] = segs[i - 1], [bx, by] = segs[i];
      const dx = bx - ax, dy = by - ay;
      const L2 = dx * dx + dy * dy;
      const s = L2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2)) : 0;
      best = Math.min(best, Math.hypot(px - (ax + s * dx), py - (ay + s * dy)));
    }
    worst = Math.max(worst, best);
  }
  return worst;
}

/* ── Getting a card into the other phone ──────────────────────────────
   A bare `TC1.…` string is not a URL, so a phone's own camera app offers it
   to a search engine instead of to this app — which is exactly what a person
   does when they see a QR code in a car park. Wrapped as a link, the camera
   opens Trailcraft and the card lands where it belongs.

   The card rides in the FRAGMENT. Browsers never send a fragment to the
   server, so the trail still never leaves the two phones — the request that
   loads the app carries the address and nothing else. */

/** A card as a link the receiving phone's camera will honour. Falls back to
    the bare card when there is no web address to hang it on (the single-file
    build opened from disk), because a `file://` link means nothing to
    another phone. */
export function cardUrl(card, base) {
  const root = String(base || '').replace(/[#?].*$/, '');
  if (!/^https?:\/\//i.test(root)) return card;
  return `${root}#c=${card}`;
}

/** Either form back to a card string: a bare `TC1.…`, or a link carrying one.
    Anything else is returned untouched, for decodeTrail to reject by name. */
export function cardFromText(text) {
  const s = String(text || '').trim();
  const at = s.indexOf('#c=');
  return at >= 0 ? s.slice(at + 3).trim() : s;
}
