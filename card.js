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

import { simplify, pathLen } from './geo.js';

const MAGIC = 'TC1.';
const MAX_PTS = 120;

/* ── byte plumbing ────────────────────────────────────────────────── */

async function through(bytes, stream) {
  const out = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

const b64url = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const unb64url = (s) => {
  const raw = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
};

/* ── the card ─────────────────────────────────────────────────────── */

const q = (deg) => Math.round(deg * 1e5);
const deltas = (ints) => ints.map((v, i) => i ? v - ints[i - 1] : v);
const absolutes = (ds) => { let a = 0; return ds.map(d => (a += d)); };

/* iOS below 16.4 has no CompressionStream — name the real cause instead of
   letting a ReferenceError masquerade as a damaged card. */
function needStreams() {
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

/** A Trail Card string back into a trail. Throws plain-language errors — the
    message is shown to whoever scanned the code. */
export async function decodeTrail(str) {
  needStreams();
  const s = String(str || '').trim();
  if (!s.startsWith('TC')) throw new Error('Not a Trail Card');
  if (!s.startsWith(MAGIC)) throw new Error('This card is from a newer Trailcraft than this app');

  let payload;
  try {
    const packed = unb64url(s.slice(MAGIC.length));
    const bytes = await through(packed, new DecompressionStream('deflate-raw'));
    payload = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error('Trail Card is damaged — try scanning again');
  }

  if (payload.v !== 1 || !Array.isArray(payload.p) || payload.p.length !== 3
      || !payload.p.every(Array.isArray)) {
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

  return {
    from: typeof payload.f === 'string' ? payload.f.slice(0, 40) : '',
    drawn: !!payload.d,
    approx: !!payload.a,
    tol,
    points, waypoints,
    started: points[0].t,
    ended: points[points.length - 1].t,
  };
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
