/* Sign-in and the cloud mirror.

   The phone stays the source of truth. localStorage is what the app reads,
   always; Firestore is a copy of it that follows along, and fills a new phone
   back up. That is what lets the app keep working in a field with no signal:
   nothing waits on the network, and Firestore's own offline cache queues every
   write until there is somewhere to send it.

   Firebase is loaded lazily, from Google's CDN, only when a config exists. If
   it cannot load — offline, blocked, not set up — the app does not notice. */

import { firebaseConfig, appleSignInEnabled } from './firebase-config.js';
import { mergeRecords, mergeCalibration, toCloud, fromCloud, approxBytes, DOC_LIMIT, packPoints, unpackPoints } from './sync-core.js';

const SDK = 'https://www.gstatic.com/firebasejs/12.3.0';
const TABLES = ['handlers', 'dogs', 'layers', 'sessions'];

export const sync = {
  configured: !!firebaseConfig,
  apple: !!firebaseConfig && appleSignInEnabled,
  user: null,               // { uid, name, email, photo }
  status: 'off',            // off | loading | signed-out | syncing | synced | error
  lastSync: 0,
  error: null,
};

let fb = null, auth = null, fs = null, db = null, stopMirror = null;
const watchers = new Set();
export function onSync(fn) { watchers.add(fn); fn(sync); return () => watchers.delete(fn); }
const emit = () => { for (const fn of watchers) { try { fn(sync); } catch { /* never break sync */ } } };

/* Firebase's error codes are for developers. A handler in a field needs to
   know what happened and whether to do anything about it. */
function plain(e) {
  const code = e?.code || '';
  if (code.includes('popup-closed') || code.includes('cancelled')) return null;   // they closed it: not an error
  if (code.includes('network')) return 'No signal — it will try again when you have some';
  if (code.includes('unauthorized-domain')) return 'This web address is not allowed to sign in yet — see the setup guide';
  if (code.includes('operation-not-allowed')) return 'That sign-in method is not switched on in Firebase yet';
  if (code.includes('permission-denied')) return 'The cloud refused the save — check the security rules';
  if (code.includes('quota')) return 'The free cloud allowance is used up for today';
  return 'Sign-in did not work — try again';
}

async function loadFirebase() {
  if (fb) return fb;
  const [a, b, c] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-auth.js`),
    import(`${SDK}/firebase-firestore.js`),
  ]);
  fb = { ...a, ...b, ...c };
  return fb;
}

/** Called once at boot. Does nothing at all until a config exists. */
let ready = Promise.resolve();   // settles once Firestore exists; live viewers wait on it
export async function initSync(store) {
  db = store;
  if (!firebaseConfig) { sync.status = 'off'; emit(); return; }
  sync.status = 'loading'; emit();
  ready = (async () => {
    const f = await loadFirebase();
    const app = f.initializeApp(firebaseConfig);
    auth = f.getAuth(app);
    fs = f.initializeFirestore(app, {
      localCache: f.persistentLocalCache({ tabManager: f.persistentMultipleTabManager() }),
    });
    // A redirect sign-in comes back through a full page load and lands here.
    await f.getRedirectResult(auth).catch((e) => { sync.error = plain(e); });
    f.onAuthStateChanged(auth, onUser);
  })();
  try {
    await ready;
  } catch {
    sync.status = 'error';
    sync.error = 'Sign-in could not load — check your connection and reopen the app';
    emit();
  }
}

/* A home-screen web app on an iPhone opens a sign-in popup but never gets the
   answer back from it, so it waits forever. It gets a full-page redirect
   instead, which always completes. A normal browser tab keeps the popup,
   because it does not lose the page. */
const isHomeScreenApp = () =>
  matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

async function signInWith(provider) {
  const f = await loadFirebase();
  sync.error = null; emit();
  try {
    if (isHomeScreenApp()) return await f.signInWithRedirect(auth, provider);
    return await f.signInWithPopup(auth, provider);
  } catch (e) {
    const code = e?.code || '';
    if (code.includes('popup-blocked') || code.includes('not-supported')) {
      return f.signInWithRedirect(auth, provider);
    }
    sync.error = plain(e); emit();
    return null;
  }
}

export async function signInWithGoogle() {
  const f = await loadFirebase();
  const p = new f.GoogleAuthProvider();
  p.setCustomParameters({ prompt: 'select_account' });
  return signInWith(p);
}

export async function signInWithApple() {
  if (!sync.apple) return null;
  const f = await loadFirebase();
  const p = new f.OAuthProvider('apple.com');
  p.addScope('email');
  p.addScope('name');
  return signInWith(p);
}

export async function signOut() {
  if (!auth) return;
  const f = await loadFirebase();
  await f.signOut(auth);
}

async function onUser(u) {
  stopMirror?.(); stopMirror = null;
  sync.user = u ? { uid: u.uid, name: u.displayName, email: u.email, photo: u.photoURL } : null;
  if (!u) { sync.status = 'signed-out'; emit(); return; }

  sync.status = 'syncing'; emit();
  try {
    await fullSync(u.uid);
    stopMirror = db.onChange((table, rec) => mirror(u.uid, table, rec));
    sync.status = 'synced';
    sync.lastSync = Date.now();
    sync.error = null;
  } catch (e) {
    sync.status = 'error';
    sync.error = plain(e) || 'Could not sync — your trails are still safe on this phone';
  }
  emit();
}

const userCol = (uid, name) => fb.collection(fs, 'users', uid, name);
const userDoc = (uid, name, id) => fb.doc(fs, 'users', uid, name, String(id));

/** Bring the phone and the account into agreement, both directions. */
async function fullSync(uid) {
  for (const name of TABLES) {
    const snap = await fb.getDocs(userCol(uid, name));
    const remote = snap.docs.map(d => fromCloud(d.data()));
    const local = name === 'sessions' ? db.rawSessions() : db[name].raw();
    // Rows from before sync existed have no stamp. Give them the oldest real
    // one on both sides at once, so the two copies agree from here on.
    const stamped = local.map(r => (Number.isFinite(r.updatedAt) ? r : { ...r, updatedAt: 1 }));
    const { merged, toUpload } = mergeRecords(stamped, remote);
    if (name === 'sessions') db.replaceSessions(merged); else db[name].replaceAll(merged);
    await uploadAll(uid, name, toUpload);
  }

  const snap = await fb.getDocs(userCol(uid, 'calibration'));
  const remote = new Map(snap.docs.map(d => [d.id, fromCloud(d.data()).rows || []]));
  const local = new Map(db.allCalibration().map(c => [c.id, c.rows]));
  const up = [];
  for (const dogId of new Set([...remote.keys(), ...local.keys()])) {
    const rows = mergeCalibration(local.get(dogId), remote.get(dogId));
    db.setCalibration(dogId, rows);
    if (rows.length !== (remote.get(dogId) || []).length) up.push({ id: dogId, rows, updatedAt: Date.now() });
  }
  await uploadAll(uid, 'calibration', up);
}

/** Firestore takes at most 500 writes in one batch. */
async function uploadAll(uid, name, rows) {
  for (let i = 0; i < rows.length; i += 400) {
    const batch = fb.writeBatch(fs);
    let n = 0;
    for (const rec of rows.slice(i, i + 400)) {
      const payload = toCloud(rec);
      if (approxBytes(payload) > DOC_LIMIT) { sync.error = 'One very long track is too large to back up'; continue; }
      batch.set(userDoc(uid, name, rec.id), payload);
      n++;
    }
    if (n) await batch.commit();
  }
}

/** Every save on the phone, copied up as it happens. Not awaited: Firestore
    queues it offline, and the handler is never kept waiting on a network. */
function mirror(uid, table, rec) {
  if (!fs || !rec?.id) return;
  const payload = toCloud(rec);
  if (approxBytes(payload) > DOC_LIMIT) { sync.error = 'One very long track is too large to back up'; emit(); return; }
  fb.setDoc(userDoc(uid, table, rec.id), payload)
    .then(() => { sync.lastSync = Date.now(); sync.status = 'synced'; emit(); })
    .catch((e) => { sync.error = plain(e); emit(); });
}

/* ── Live: a run, followed from anywhere while it happens ─────────────
   One document per run at live/{id}, with the trail and the team, and a
   chunk document per minute of dog track under it — a viewer's listener
   then receives a minute's worth of points when it changes, not the whole
   run every ten seconds. The id is 120 random bits: the link is the key.
   A run stays readable for 24 hours after it ends (the rules check
   expiresAt), and a TTL policy in Firestore deletes it after that. */

const LIVE_TTL = 24 * 3600e3;
const CHUNK_MS = 60e3;
let live = null;   // { id, startedAt, chunks: Map<n, signature>, expiresAt, wpsN }

const liveId = () => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => alphabet[b % 64]).join('');   // 256 = 4 × 64: no bias
};

/** Publish a run. `meta` is share.js's liveMeta(): the trail, not the run. */
export async function startLive(meta) {
  if (!fs || !sync.user) throw new Error('Sign in to share live');
  const f = await loadFirebase();
  const id = liveId();
  const expiresAt = Date.now() + LIVE_TTL;
  await f.setDoc(f.doc(fs, 'live', id), {
    ...toCloud(meta), uid: sync.user.uid, expiresAt, ended: false, createdAt: Date.now(), at: Date.now(),
  });
  live = { id, startedAt: meta.startedAt, chunks: new Map(), expiresAt, wpsN: -1 };
  return id;
}

export const liveNow = () => live?.id ?? null;

/** Send what has changed: the minute-chunks with new points (or a standing
    spot whose wait grew), and the marks when there is a new one. Not
    awaited — Firestore queues it offline and the handler is never kept. */
export function pushLive(pts, wps = []) {
  if (!live || !fs) return;
  const groups = new Map();
  for (const p of pts) {
    const n = Math.max(0, Math.floor(((p.t ?? live.startedAt) - live.startedAt) / CHUNK_MS));
    if (!groups.has(n)) groups.set(n, []);
    groups.get(n).push(p);
  }
  for (const [n, g] of groups) {
    const sig = `${g.length}|${Math.round(g[g.length - 1].dwellS ?? 0)}`;
    if (live.chunks.get(n) === sig) continue;
    live.chunks.set(n, sig);
    const clean = g.map(p => ({ lat: p.lat, lon: p.lon, t: p.t, alt: p.alt ?? null, dwellS: p.dwellS || 0 }));
    fb.setDoc(fb.doc(fs, 'live', live.id, 'chunks', String(n)),
      { n, expiresAt: live.startedAt + 36 * 3600e3, ...packPoints(clean) }).catch(() => {});
  }
  if (wps.length !== live.wpsN) {
    live.wpsN = wps.length;
    fb.setDoc(fb.doc(fs, 'live', live.id), { wps: packPoints(wps), at: Date.now() }, { merge: true }).catch(() => {});
  }
}

/** The run is over: the last points, the verdict, and 24 more hours to read it. */
export async function endLive({ result = null, track = [], wps = [] } = {}) {
  if (!live) return;
  pushLive(track, wps);
  const id = live.id;
  live = null;
  await fb.setDoc(fb.doc(fs, 'live', id), {
    ended: true, endedAt: Date.now(), expiresAt: Date.now() + LIVE_TTL, at: Date.now(),
    result: result ? toCloud(result) : null,
  }, { merge: true });
}

/** Follow a run. `cb` gets { meta, chunks } on every change, or { error }.
    No sign-in needed: the rules let anyone with the id read until it expires. */
export async function watchLive(id, cb) {
  if (!firebaseConfig) { cb({ error: 'Live links need the cloud switched on in this app' }); return () => {}; }
  try { await ready; } catch { /* reported below */ }
  if (!fs) { cb({ error: 'Could not connect — check your signal and try the link again' }); return () => {}; }
  const f = fb;
  let meta = null;
  const chunks = new Map();
  const push = () => {
    if (!meta) return;
    cb({ meta, chunks: [...chunks.entries()].sort((a, b) => Number(a[0]) - Number(b[0])).map(e => e[1]) });
  };
  const offDoc = f.onSnapshot(f.doc(fs, 'live', id), (snap) => {
    if (!snap.exists()) { cb({ error: 'This live link has expired, or never existed' }); return; }
    meta = fromCloud(snap.data());
    push();
  }, (e) => cb({ error: e?.code?.includes('permission') ? 'This live link has expired' : (plain(e) || 'Could not follow this run') }));
  const offChunks = f.onSnapshot(f.collection(fs, 'live', id, 'chunks'), (qs) => {
    qs.docChanges().forEach(ch => {
      if (ch.type === 'removed') chunks.delete(ch.doc.id);
      else chunks.set(ch.doc.id, unpackPoints(ch.doc.data()));
    });
    push();
  }, () => { /* the document listener reports the reason */ });
  return () => { offDoc(); offChunks(); };
}
