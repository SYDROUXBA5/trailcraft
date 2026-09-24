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
    Returns what the phone should now hold, and what should go up.

    `partial`: the cloud side is only what changed there lately (a pull on
    coming back to the app), so a record missing from it is not missing from
    the cloud, and is not sent again. `union`: see mergeOne. */
export function mergeRecords(local = [], remote = [], { partial = false, union = false } = {}) {
  const L = new Map((local || []).filter(r => r?.id).map(r => [r.id, r]));
  const R = new Map((remote || []).filter(r => r?.id).map(r => [r.id, r]));
  const merged = [], toUpload = [];

  for (const id of new Set([...L.keys(), ...R.keys()])) {
    const l = L.get(id), r = R.get(id);
    if (partial && !r) { merged.push(l); continue; }
    const { keep, up } = mergeOne(l, r, { union });
    merged.push(keep);
    if (up) toUpload.push(keep);
  }
  return { merged, toUpload };
}

/* Fields the cloud cannot hold (toCloud leaves them out). A copy with one
   and a copy without are the same record, not two to be merged. */
const cloudless = (k) => !k || /^__.*__$/.test(k);
/* The cloud's own bookkeeping on a record (fromCloudRecord). A phone on an
   older build kept them when it pulled; carried over as "only the older copy
   has it", they would make every merge look new and send it up again. */
const CLOUD_ONLY = new Set(['baseAt', 'syncedAt']);
const plainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/* The newer copy, plus any field only the older one has, or null when the
   older one has nothing the newer lacks. A session is only ever changed by
   laying new fields over it (patchSession): nothing takes a field away, and
   clearing one sets it to null, which counts as having it. So a field the
   newer copy lacks was never there, not removed. */
function withMissing(win, lose) {
  if (!plainObject(win) || !plainObject(lose) || win.deleted || lose.deleted) return null;
  const out = { ...win };
  let added = 0;
  for (const [k, v] of Object.entries(lose)) {
    if (cloudless(k) || CLOUD_ONLY.has(k) || k === 'updatedAt' || k === 'data' || k in win || v === undefined) continue;
    out[k] = v; added++;
  }
  if (plainObject(lose.data)) {
    if (!('data' in win)) { out.data = lose.data; added++; }
    else if (plainObject(win.data)) {
      const data = { ...win.data };
      for (const [k, v] of Object.entries(lose.data)) {
        if (cloudless(k) || k in win.data || v === undefined) continue;
        data[k] = v; added++;
      }
      out.data = data;
    }
  }
  return added ? out : null;
}

/** One record, two copies: `keep` is what both should hold, and `up` says
    the cloud does not have it yet. The newer copy wins.

    `union` is for sessions, which two phones can each add to: a run on one,
    a new name on the other. Newest-wins alone threw the run away whenever
    the other phone's edit was later, on both phones and in the backup. With
    it, the newer copy wins every field both have, and a field only the older
    one has is kept. What comes out differs from both copies, so it is
    stamped newer than both: every phone then takes it, and a save made from
    either old copy is refused by the rules as out of date. */
export function mergeOne(l, r, { union = false } = {}) {
  if (!l || !r) return { keep: l || r || null, up: !!l };
  const mine = stamp(l) > stamp(r);
  const extra = union ? withMissing(mine ? l : r, mine ? r : l) : null;
  if (extra) return { keep: { ...extra, updatedAt: Math.max(stamp(l), stamp(r)) + 1 }, up: true };
  return mine ? { keep: l, up: true } : { keep: r, up: false };   // a tie goes to the cloud: nothing to send
}

/** A record as the cloud holds it, without the two fields that are only the
    cloud's business: which copy a save was made from (baseAt), and when the
    server stored it (syncedAt). Neither belongs on the phone. */
export function fromCloudRecord(data) {
  const { baseAt, syncedAt, ...rest } = data || {};
  return fromCloud(rest);
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

/* The fields every point is expected to carry, in the order the columns are
   written. This is documentation and column order, NOT a filter: anything else
   a point happens to hold is carried too (see below). */
const POINT_KEYS = ['lat', 'lon', 't', 'acc', 'alt', 'dwellS', 'kind', 'call'];
const isPoint = (p) => p && typeof p === 'object' && Number.isFinite(p.lat) && Number.isFinite(p.lon);

/* Compact mode: for the phone's own scratch copy of a recording in progress
   (draft.js), which is stored as text and rewritten every few seconds, so
   every character counts. Firestore is not stored as text — a number costs
   eight bytes there however short it is — so the backup writes points plainly
   and exactly, and none of this touches it.

   What a stored number is worth keeping to, when it is kept short: six decimal
   places is about 11 cm, already finer than the fix behind it. */
const ROUND = { lat: 1e6, lon: 1e6, alt: 10, acc: 10, dwellS: 10, t: 1 };
const tidy = (k, v) => (ROUND[k] && typeof v === 'number' && Number.isFinite(v)
  ? Math.round(v * ROUND[k]) / ROUND[k] : v);

/* Working notes the app hangs on a point while it is being drawn or walked —
   `_seen` and anything else beginning with an underscore. They mean nothing
   tomorrow and nothing on another phone, so they are the one thing not kept. */
const working = (k) => k.startsWith('_');

/** Points as parallel columns: lossless, and far smaller than an array of
    small objects, which Firestore bills and limits by the byte.

    Every field is carried, not a chosen few. A fixed list meant that adding
    something to a point — the handler's call on an indication — quietly failed
    to survive the trip to another phone, and nothing said so: the mark came
    back, the answer did not. Whatever a point holds now goes with it. */
export function packPoints(pts, { compact = false } = {}) {
  const out = { __pts: pts.length };
  const keys = [...POINT_KEYS];
  for (const p of pts) {
    for (const k of Object.keys(p || {})) if (!working(k) && !keys.includes(k)) keys.push(k);
  }
  for (const k of keys) {
    if (!pts.some(p => p?.[k] != null)) continue;
    const col = pts.map(p => (p?.[k] == null ? null : (compact ? tidy(k, p[k]) : p[k])));
    out[k] = compact ? squeeze(k, col) : col;
  }
  return out;
}

/* However many points a record claims, never more than its columns hold.
   A live document is written by whoever started the run, and a hundred bytes
   claiming twenty million points used to make every viewer build them. */
const MAX_UNPACK = 200000;
export function unpackPoints(packed) {
  const keys = Object.keys(packed).filter(k => k !== '__pts');
  const cols = {};
  for (const k of keys) cols[k] = spread(packed[k]);
  const longest = Math.max(0, ...Object.values(cols).map(c => (Array.isArray(c) ? c.length : 0)));
  const claimed = Number.isInteger(packed.__pts) && packed.__pts > 0 ? packed.__pts : 0;
  return Array.from({ length: Math.min(claimed, longest, MAX_UNPACK) }, (_, i) => {
    const p = {};
    for (const k of keys) {
      const col = cols[k];
      if (Array.isArray(col) && col[i] != null) p[k] = col[i];
    }
    return p;
  });
}

/* A column of numbers, written as the step from one to the next.

   Along a walked line every value is close to the one before it: a step is two
   or three digits where the position itself is nine, and a second of clock is
   four where the clock is thirteen. It is the same numbers either way, and it
   is what decides whether a long morning's session fits in one record at all.
   Columns that are not plain numbers, or that have gaps, stay as they are —
   they are short, and simple beats clever on the thing that holds the backup.

   `{ d: [...] }` is a step-written column; a bare array is one written out in
   full, which is what every record made before this was. Both are read. */
const STEP = { lat: 1e6, lon: 1e6, t: 1, alt: 10, acc: 10 };

function squeeze(k, col) {
  const s = STEP[k];
  if (!s || col.length < 8) return col;
  if (!col.every(v => typeof v === 'number' && Number.isFinite(v))) return col;
  const ints = col.map(v => Math.round(v * s));
  const d = [ints[0]];
  for (let i = 1; i < ints.length; i++) d.push(ints[i] - ints[i - 1]);
  const out = { d, s };
  /* Only if it is actually smaller: a column that jumps about is better left
     alone, and the step form then costs more than it saves. */
  return JSON.stringify(out).length < JSON.stringify(col).length ? out : col;
}

function spread(col) {
  if (Array.isArray(col) || !col || typeof col !== 'object' || !Array.isArray(col.d)) return col;
  const s = Number.isFinite(col.s) && col.s > 0 ? col.s : 1;
  const out = [];
  let n = 0;
  for (let i = 0; i < col.d.length; i++) {
    n = i === 0 ? col.d[0] : n + col.d[i];
    out.push(s === 1 ? n : n / s);
  }
  return out;
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
      /* Firestore refuses an empty field name and any shaped like __x__, and
         one refused field stops the batch it is in. Nothing the app writes
         looks like either, so anything that does came from somewhere else. */
      if (!k || /^__.*__$/.test(k)) continue;
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
    before Firestore refuses it rather than after.

    Counted the way Firestore counts, NOT as JSON text. A number costs eight
    bytes there whether it is 3 or 51.209412, so measuring the text says a
    document has shrunk when nothing has moved — and a guard that reads low
    waves through exactly the documents the server will refuse, which fails
    the whole batch and stops the rest of the backup with it. */
const utf8 = (s) => new TextEncoder().encode(String(s)).length;
export function approxBytes(value) {
  if (value === null || value === undefined || typeof value === 'boolean') return 1;
  if (typeof value === 'number') return 8;
  if (typeof value === 'string') return utf8(value) + 1;
  if (Array.isArray(value)) return value.reduce((n, v) => n + approxBytes(v), 0);
  if (typeof value === 'object') {
    return Object.entries(value)
      .reduce((n, [k, v]) => n + utf8(k) + 1 + approxBytes(v), 0);
  }
  return 8;
}
/* Firestore's hard ceiling is 1,048,576 bytes including the document's own
   name and a little overhead. The margin is deliberate: the estimate is close,
   not exact, and being refused costs the whole batch. */
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

/** Whether the cloud's rows are not the merged ones, by content. Counting
    them was not enough: at the fifty-row cap a merge that took in a new run
    and let the oldest go has fifty rows, the same as the cloud, and was
    never sent. */
export function calibrationDiffers(rows = [], remoteRows = []) {
  const key = (r) => `${r?.t}|${r?.k}`;
  const theirs = new Set((remoteRows || []).map(key));
  return (rows || []).length !== (remoteRows || []).length || (rows || []).some(r => !theirs.has(key(r)));
}

/* ── Accounts by email ────────────────────────────────────────────────
   Checked on the phone before anything is sent, so a typo is caught next to
   the field it is in rather than after a round trip. The server still has
   the last word; these only catch what is obviously wrong. */
/** Whose records are on this phone, and so what signing in may do with them.

    No owner and an empty phone: nothing to lose, so the account takes it.
    No owner but records already here: they were saved before anyone signed
    in, and on a shared phone they may be someone else's, so backing them up
    is a decision the handler makes once, not something that just happens.
    The same owner: the usual sync.
    A different owner: STOP. Merging would upload one person's dogs, trails
    and the places they walked into another person's account, which on a
    shared phone is a handler's records landing in a stranger's backup. The
    handler decides instead: sign out, or clear the phone and start fresh. */
export function syncPlan(owner, uid, hasRecords = false) {
  if (!uid) return 'signed-out';
  if (owner) return owner === uid ? 'sync' : 'other';
  return hasRecords ? 'ask' : 'adopt';
}

export const AUTH_MIN_PASSWORD = 8;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** { ok, errors: { name?, email?, password? } } for 'up' (create) or 'in'. */
export function checkAuthFields({ mode = 'up', name = '', email = '', password = '' } = {}) {
  const errors = {};
  const n = String(name ?? '').trim(), e = String(email ?? '').trim(), pw = String(password ?? '');
  if (mode === 'up' && !n) errors.name = 'Add your name, so your records say who laid them.';
  if (!e) errors.email = 'Type your email.';
  else if (!EMAIL_RE.test(e)) errors.email = 'That email doesn’t look right.';
  if (!pw) errors.password = mode === 'up' ? `Choose a password of at least ${AUTH_MIN_PASSWORD} characters.` : 'Type your password.';
  else if (mode === 'up' && pw.trim().length < AUTH_MIN_PASSWORD) errors.password = `At least ${AUTH_MIN_PASSWORD} characters, please.`;
  else if (pw.length > 128) errors.password = 'That password is too long.';
  return { ok: Object.keys(errors).length === 0, errors };
}

/** What a sign-in failure means, in words a handler can act on. null means
    "they closed it themselves", which is not an error. */
export function authMessage(code = '') {
  const c = String(code);
  if (c.includes('popup-closed') || c.includes('cancelled')) return null;
  if (c.includes('email-already-in-use')) return 'There’s already an account with that email. Sign in instead.';
  if (c.includes('invalid-email')) return 'That email doesn’t look right.';
  if (c.includes('weak-password')) return `That password is too easy to guess. Use at least ${AUTH_MIN_PASSWORD} characters.`;
  if (c.includes('invalid-credential') || c.includes('invalid-login-credentials')
    || c.includes('wrong-password') || c.includes('user-not-found')) return 'That email and password don’t match an account.';
  if (c.includes('missing-password')) return 'Type your password.';
  if (c.includes('too-many-requests')) return 'Too many tries. Wait a few minutes, or reset your password.';
  if (c.includes('user-disabled')) return 'This account has been switched off.';
  if (c.includes('api-key') || c.includes('not-configured')) return 'Accounts aren’t set up yet. See the setup guide.';
  if (c.includes('network')) return 'No signal. It will try again when you have some.';
  if (c.includes('unauthorized-domain')) return 'This web address is not allowed to sign in yet. See the setup guide.';
  if (c.includes('operation-not-allowed')) return 'This way of signing in isn’t switched on yet.';
  if (c.includes('requires-recent-login')) return 'For your safety, sign out, sign back in, then try again.';
  if (c.includes('user-mismatch')) return 'That’s a different account. Use the one you’re deleting.';
  if (c.includes('popup-blocked')) return 'The browser blocked Google’s check. Allow pop-ups for this page and try again.';
  if (c.includes('permission-denied')) return 'The cloud refused the save. Check the security rules.';
  if (c.includes('quota')) return 'The free cloud allowance is used up for today.';
  return 'Sign-in did not work. Try again.';
}

/** What a failed backup, pull or live link means. Not authMessage: that one
    ends in "Sign-in did not work", which is wrong for all of these and was
    what every one of them said, even to someone following a live link who
    never signed in. null for anything unrecognised, so the caller's own
    words show instead. */
export function syncMessage(e) {
  if (e?.name === 'SaveError') {
    return e.full ? 'This phone is full. Delete an old session to make room.' : 'This phone could not save what came from your account.';
  }
  const c = String(e?.code || '');
  if (c.includes('permission-denied')) return 'Your account turned it down. It tries again when you next open the app.';
  if (c.includes('resource-exhausted') || c.includes('quota')) return 'The free cloud allowance is used up for today.';
  if (c.includes('unavailable') || c.includes('deadline-exceeded') || c.includes('network')) return 'No signal. It will try again when you have some.';
  if (c.includes('unauthenticated')) return 'You are signed out. Sign in again to back up.';
  return null;
}

