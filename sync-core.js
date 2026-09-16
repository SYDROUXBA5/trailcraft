/* Sync, the part that can be wrong.

   Everything here is pure — no Firebase, no browser — so the decisions that
   decide whether a handler loses a season of training records can be tested
   on a laptop rather than discovered in a field.

   The rules:
   - The phone is the source of truth. The cloud is a mirror of it.
   - Every record carries `updatedAt`. When two copies disagree, the newer
     one wins. Records from before sync existed carry no stamp and count as
     the oldest possible, so any real edit elsewhere beats them.
   - A deletion is a TOMBSTONE, not an absence. Removing a record outright
     means the next phone to sync still has a copy and puts it straight back;
     a tombstone is a newer fact that says "gone", and it wins like any other.
   - Firestore will not store an array inside an array, nor `undefined`, and
     a document tops out at a megabyte. Long GPS tracks are packed into
     parallel columns, which is lossless and several times smaller. */

const stamp = (r) => (Number.isFinite(r?.updatedAt) ? r.updatedAt : 0);

/** Merge the phone's copy of a table with the cloud's.
    Returns what the phone should now hold, and what should go up. */
export function mergeRecords(local = [], remote = []) {
  const L = new Map((local || []).filter(r => r?.id).map(r => [r.id, r]));
  const R = new Map((remote || []).filter(r => r?.id).map(r => [r.id, r]));
  const merged = [], toUpload = [];

  for (const id of new Set([...L.keys(), ...R.keys()])) {
    const l = L.get(id), r = R.get(id);
    if (l && !r) { merged.push(l); toUpload.push(l); continue; }
    if (r && !l) { merged.push(r); continue; }
    if (stamp(l) > stamp(r)) { merged.push(l); toUpload.push(l); }
    else merged.push(r);                         // remote newer, or a tie: nothing to send
  }
  return { merged, toUpload };
}

/** What the app should actually see: tombstones are bookkeeping, not rows. */
export const visible = (rows) => (rows || []).filter(r => r && !r.deleted);

/** A deletion that survives syncing. */
export const tombstone = (id, now = Date.now()) => ({ id, deleted: true, updatedAt: now });

/** Tombstones only need to live long enough to reach every phone. Ninety days
    is far longer than any phone goes unopened, and keeps localStorage from
    filling with the ghosts of deleted trails. */
export function pruneTombstones(rows, now = Date.now(), keepMs = 90 * 86400e3) {
  return (rows || []).filter(r => !r?.deleted || now - stamp(r) < keepMs);
}

/* ── Packing for Firestore ─────────────────────────────────────────── */

const POINT_KEYS = ['lat', 'lon', 't', 'acc', 'alt', 'dwellS', 'kind'];
const isPoint = (p) => p && typeof p === 'object' && Number.isFinite(p.lat) && Number.isFinite(p.lon);

/** Points as parallel columns: lossless, and far smaller than an array of
    small objects, which Firestore bills and limits by the byte. */
export function packPoints(pts) {
  const out = { __pts: pts.length };
  for (const k of POINT_KEYS) {
    if (pts.some(p => p?.[k] != null)) out[k] = pts.map(p => (p?.[k] ?? null));
  }
  return out;
}

export function unpackPoints(packed) {
  return Array.from({ length: packed.__pts }, (_, i) => {
    const p = {};
    for (const k of POINT_KEYS) {
      const col = packed[k];
      if (col && col[i] != null) p[k] = col[i];
    }
    return p;
  });
}

/** Make any value storable in Firestore, reversibly.
    Point arrays are packed; any other array holding arrays is kept as JSON
    text; undefined disappears exactly as JSON.stringify would remove it. */
export function toCloud(value) {
  if (Array.isArray(value)) {
    if (value.length && value.every(isPoint)) return packPoints(value);
    if (value.some(Array.isArray)) return { __json: JSON.stringify(value) };
    return value.map(toCloud);
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined) continue;
      out[k] = toCloud(v);
    }
    return out;
  }
  return value === undefined ? null : value;
}

export function fromCloud(value) {
  if (Array.isArray(value)) return value.map(fromCloud);
  if (value && typeof value === 'object') {
    if ('__pts' in value) return unpackPoints(value);
    if ('__json' in value) return JSON.parse(value.__json);
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = fromCloud(v);
    return out;
  }
  return value;
}

/** Roughly how many bytes a document will be, to catch the megabyte ceiling
    before Firestore refuses it rather than after. */
export const approxBytes = (value) => new TextEncoder().encode(JSON.stringify(value)).length;
export const DOC_LIMIT = 1_000_000;

/** Calibration is different from every other record: rows are APPENDED, run by
    run, possibly on two phones in the same week. Newest-wins would throw away
    whichever phone's runs happened to be older, so it is a union instead —
    every graded run from either phone, once each, oldest first, capped at the
    same fifty the store keeps. */
export function mergeCalibration(localRows = [], remoteRows = [], cap = 50) {
  const seen = new Map();
  for (const r of [...(remoteRows || []), ...(localRows || [])]) {
    if (r && Number.isFinite(r.t)) seen.set(`${r.t}|${r.k}`, r);
  }
  return [...seen.values()].sort((a, b) => a.t - b.t).slice(-cap);
}
