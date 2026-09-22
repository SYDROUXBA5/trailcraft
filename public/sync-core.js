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

