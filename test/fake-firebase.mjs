/* A stand-in for the three Firebase modules sync.js loads from Google's CDN
   (sync-flow.test.mjs points those addresses here), so the backup can be run
   for real on a laptop: two phones, one account, one cloud.

   It keeps only what the tests need. Documents live in memory. A phone can be
   put out of signal, and its saves then wait, in order, as Firestore's do,
   while a query answers from what that phone last saw (fromCache).
   The server stamps syncedAt from its own clock. And the one security rule
   that decides whether a save may replace the copy in the cloud is applied
   exactly as firestore.rules says: a save naming the copy it was made from
   (baseAt) is refused when the cloud holds a different one. */

const SERVER = Symbol('serverTimestamp');
const DELETE = Symbol('delete');

export const cloud = {
  docs: new Map(),        // path → { data, syncedAt }
  clock: 1000,            // the server's clock, in ms
  baseRule: true,         // false: the rules from before the baseAt check
  fail: null,             // an error code the next read throws
  read: 0,                // documents handed out by queries
  pauses: new Map(),      // table → { reached, release } for a read to wait on
  beforeBatch: null,      // runs once, just before the next batch is applied
};
export const phones = [];   // one { auth, fs } per initializeApp, newest last

let signedIn = null;
/** Who the next phone to start up is already signed in as. */
export const startSignedIn = (u) => { signedIn = u; };

const err = (code) => Object.assign(new Error(code), { code });
const clone = (v) => JSON.parse(JSON.stringify(v));

/** Hold the next read of `table` until released, and say when it gets there. */
export function pause(table) {
  let release, reached;
  const hit = new Promise(r => { reached = r; });
  const gate = new Promise(r => { release = r; });
  cloud.pauses.set(table, { gate, reached });
  return { hit, release: () => { cloud.pauses.delete(table); release(); } };
}

/** Put a document straight into the cloud, as another phone once did. */
export function seed(path, data) {
  cloud.docs.set(path, { data: clone(data), syncedAt: ++cloud.clock });
}
export const cloudDoc = (path) => (cloud.docs.has(path) ? clone(cloud.docs.get(path).data) : null);

/* ── Signal ──────────────────────────────────────────────────────────── */
export function setOnline(fs, on) {
  fs.online = on;
  if (on) for (const go of fs.waiting.splice(0)) go();
}
const reachable = (fs) => (fs.online ? Promise.resolve() : new Promise(r => fs.waiting.push(r)));
const alive = (fs) => { if (fs.terminated) throw err('failed-precondition'); };

/* ── App and auth ────────────────────────────────────────────────────── */
export const initializeApp = (config) => ({ config });
export function getAuth(app) {
  app.auth = { currentUser: signedIn, listeners: [] };
  signedIn = null;
  return app.auth;
}
export const initializeAuth = getAuth;
export const indexedDBLocalPersistence = {};
export const getRedirectResult = async () => null;
export function onAuthStateChanged(auth, cb) {
  auth.listeners.push(cb);
  queueMicrotask(() => cb(auth.currentUser));
  return () => {};
}
export async function signOut(auth) {
  auth.currentUser = null;
  for (const cb of auth.listeners) cb(null);
}

/* Proving it is them, before an account is deleted. It can be held, as a
   password check waiting on the server is. */
let reauthGate = null;
export function holdReauth() {
  let release, reached;
  const hit = new Promise(r => { reached = r; });
  const gate = new Promise(r => { release = r; });
  reauthGate = { gate, reached };
  return { hit, release: () => { reauthGate = null; release(); } };
}
export const EmailAuthProvider = { credential: (email, password) => ({ email, password }) };
export async function reauthenticateWithCredential() {
  if (reauthGate) { reauthGate.reached(); await reauthGate.gate; }
}
export async function deleteUser(user) {
  for (const p of phones) {
    if (p.auth.currentUser?.uid !== user.uid) continue;
    p.auth.currentUser = null;
    for (const cb of p.auth.listeners) cb(null);
  }
}

/* ── Firestore ───────────────────────────────────────────────────────── */
export function initializeFirestore(app) {
  const fs = { online: true, waiting: [], terminated: false, cleared: false, cache: new Map() };
  phones.push({ auth: app.auth, fs });
  return fs;
}
export const persistentLocalCache = () => ({});
export const persistentMultipleTabManager = () => ({});
export async function terminate(fs) { fs.terminated = true; }
export async function clearIndexedDbPersistence(fs) { fs.cleared = true; }

export class Timestamp {
  constructor(ms) { this.ms = ms; }
  toMillis() { return this.ms; }
  static fromMillis(ms) { return new Timestamp(ms); }
}
export const serverTimestamp = () => ({ [SERVER]: true });

export function collection(parent, ...parts) {
  const fs = parent.fs ?? parent;
  return { fs, path: [parent.path, ...parts].filter(Boolean).join('/') };
}
export function doc(fs, ...parts) {
  const path = parts.join('/');
  return { fs, path, id: parts[parts.length - 1] };
}
export const query = (col, ...wheres) => ({ ...col, wheres });
export const where = (field, op, value) => ({ field, op, value });

const snapOf = (path, d, fs) => ({
  id: path.split('/').pop(),
  ref: { fs, path, id: path.split('/').pop() },
  exists: () => !!d,
  data: () => (d ? { ...clone(d.data), ...(d.syncedAt != null ? { syncedAt: new Timestamp(d.syncedAt) } : {}) } : undefined),
});

/* The documents a query matches in one set of them: the cloud's, or the
   phone's own copy of what it has seen. */
function matching(q, from) {
  const found = [];
  for (const [path, d] of from) {
    if (!path.startsWith(`${q.path}/`) || path.slice(q.path.length + 1).includes('/')) continue;
    if ((q.wheres || []).some(w => !(w.op === '>' && d[w.field] != null && d[w.field] > w.value.toMillis()))) continue;
    found.push([path, d]);
  }
  return found;
}
const seen = (fs, path, d) => { if (d) fs.cache.set(path, clone(d)); else fs.cache.delete(path); };

export async function getDocs(q) {
  alive(q.fs);
  /* Offline, Firestore answers a query from the phone's own copy at once. */
  if (!q.fs.online) {
    return { docs: matching(q, q.fs.cache).map(([path, d]) => snapOf(path, d, q.fs)), metadata: { fromCache: true } };
  }
  const table = q.path.split('/').pop();
  const p = cloud.pauses.get(table);
  if (p) { p.reached(); await p.gate; }
  alive(q.fs);
  if (cloud.fail) { const code = cloud.fail; cloud.fail = null; throw err(code); }
  const docs = matching(q, cloud.docs).map(([path, d]) => { seen(q.fs, path, d); return snapOf(path, d, q.fs); });
  cloud.read += docs.length;
  return { docs, metadata: { fromCache: false } };
}

export async function getDoc(ref) {
  alive(ref.fs);
  await reachable(ref.fs);
  seen(ref.fs, ref.path, cloud.docs.get(ref.path));
  return snapOf(ref.path, cloud.docs.get(ref.path), ref.fs);
}

/* firestore.rules, users/{uid}/{table}/{recordId}: an update that names the
   copy it was made from must name the one the cloud holds. */
function allowed(path, data) {
  if (!cloud.baseRule || data === DELETE || !path.startsWith('users/')) return true;
  const held = cloud.docs.get(path);
  if (!held || !('baseAt' in data)) return true;
  return data.baseAt === (held.data.updatedAt ?? null);
}

/* A save the server took is in the saving phone's own copy too, with the
   time the server stamped on it. */
function apply(fs, writes) {
  for (const [path, data] of writes) if (!allowed(path, data)) throw err('permission-denied');
  const at = ++cloud.clock;
  for (const [path, data, merge] of writes) {
    if (data === DELETE) { cloud.docs.delete(path); seen(fs, path, null); continue; }
    const { syncedAt, ...rest } = data;
    const held = cloud.docs.get(path);
    cloud.docs.set(path, {
      data: merge && held ? { ...held.data, ...clone(rest) } : clone(rest),
      syncedAt: syncedAt?.[SERVER] ? at : (held?.syncedAt ?? null),
    });
    seen(fs, path, cloud.docs.get(path));
  }
}

export async function setDoc(ref, data, opts = {}) {
  alive(ref.fs);
  await reachable(ref.fs);
  alive(ref.fs);
  apply(ref.fs, [[ref.path, data, !!opts.merge]]);
}
export async function deleteDoc(ref) {
  alive(ref.fs);
  await reachable(ref.fs);
  apply(ref.fs, [[ref.path, DELETE]]);
}
export function writeBatch(fs) {
  const writes = [];
  return {
    set(ref, data) { writes.push([ref.path, data, false]); },
    delete(ref) { writes.push([ref.path, DELETE]); },
    async commit() {
      alive(fs); await reachable(fs); alive(fs);
      const first = cloud.beforeBatch; cloud.beforeBatch = null; first?.();
      apply(fs, writes);
    },
  };
}
export const onSnapshot = () => () => {};
