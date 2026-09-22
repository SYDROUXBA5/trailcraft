/* Sign-in and the cloud mirror.

   The phone stays the source of truth. localStorage is what the app reads,
   always; Firestore is a copy of it that follows along, and fills a new phone
   back up. That is what lets the app keep working in a field with no signal:
   nothing waits on the network, and Firestore's own offline cache queues every
   write until there is somewhere to send it.

   Firebase is loaded lazily, from Google's CDN, only when a config exists. If
   it cannot load — offline, blocked, not set up — the app does not notice. */

import { firebaseConfig, appleSignInEnabled } from './firebase-config.js';
import { isNative } from './native.js';
import { syncPlan,
         mergeRecords, mergeCalibration, toCloud, fromCloud, approxBytes, DOC_LIMIT, packPoints, unpackPoints,
         authMessage } from './sync-core.js';

const SDK = 'https://www.gstatic.com/firebasejs/12.3.0';
const TABLES = ['handlers', 'dogs', 'layers', 'sessions'];

export const sync = {
  configured: !!firebaseConfig,
  apple: !!firebaseConfig && appleSignInEnabled,
  user: null,               // { uid, name, email, photo }
  status: 'off',            // off | loading | signed-out | other | syncing | synced | error
  lastSync: 0,
  error: null,
};

let fb = null, auth = null, fs = null, db = null, stopMirror = null;
const watchers = new Set();
export function onSync(fn) { watchers.add(fn); fn(sync); return () => watchers.delete(fn); }
const emit = () => { for (const fn of watchers) { try { fn(sync); } catch { /* never break sync */ } } };

/* Firebase's error codes are for developers. A handler in a field needs to
   know what happened and whether to do anything about it (sync-core.js). */
const plain = (e) => authMessage(e?.code || '');

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
    /* Inside the iPhone app, getAuth() also loads Google's sign-in helper page
       from firebaseapp.com. That page never answers an app that isn't a website,
       so every sign-in would wait forever. The iPhone app only signs in by email,
       which needs no helper page, so it starts sign-in without one and keeps the
       account in the app's own storage. */
    auth = isNative()
      ? f.initializeAuth(app, { persistence: f.indexedDBLocalPersistence })
      : f.getAuth(app);
    fs = f.initializeFirestore(app, {
      localCache: f.persistentLocalCache({ tabManager: f.persistentMultipleTabManager() }),
    });
    // A redirect sign-in comes back through a full page load and lands here.
    if (!isNative()) await f.getRedirectResult(auth).catch((e) => { sync.error = plain(e); });
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

/* ── Email and password ───────────────────────────────────────────────
   Works everywhere, including inside the iPhone app, where Google refuses
   to sign anyone in from an app's built-in browser. Each returns the user,
   or null with sync.error saying why in plain words. */
async function authReady() {
  if (!firebaseConfig) { sync.error = authMessage('not-configured'); emit(); return null; }
  await ready;
  if (!auth) { sync.error = authMessage('not-configured'); emit(); return null; }
  sync.error = null; emit();
  return loadFirebase();
}

export async function signUpWithEmail({ name, email, password }) {
  const f = await authReady();
  if (!f) return null;
  try {
    const cred = await f.createUserWithEmailAndPassword(auth, String(email).trim(), password);
    const n = String(name ?? '').trim();
    if (n) {
      await f.updateProfile(cred.user, { displayName: n }).catch(() => {});
      /* The sign-in event can fire before the name is set: carry it over. */
      if (sync.user?.uid === cred.user.uid) { sync.user = { ...sync.user, name: n }; emit(); }
    }
    f.sendEmailVerification(cred.user).catch(() => { /* the account works without it */ });
    return cred.user;
  } catch (e) {
    sync.error = plain(e); emit();
    return null;
  }
}

export async function signInWithEmail({ email, password }) {
  const f = await authReady();
  if (!f) return null;
  try {
    return (await f.signInWithEmailAndPassword(auth, String(email).trim(), password)).user;
  } catch (e) {
    sync.error = plain(e); emit();
    return null;
  }
}

/** Sends a reset link. True unless it could not be sent at all: whether an
    account exists for that address is deliberately not revealed. */
export async function resetPassword(email) {
  const f = await authReady();
  if (!f) return false;
  try {
    await f.sendPasswordResetEmail(auth, String(email).trim());
    return true;
  } catch (e) {
    const code = e?.code || '';
    if (code.includes('user-not-found')) return true;
    sync.error = plain(e); emit();
    return false;
  }
}

const hasRecords = () => !!(db?.rawSessions?.().length || db?.handlers?.raw?.().length || db?.dogs?.raw?.().length);

/** "These are mine": the records already on the phone become this account's
    and are backed up. The one place a set of records changes hands, and it
    takes a tap to say so. */
export async function adoptRecords() {
  const u = auth?.currentUser;
  if (!u) return false;
  db.kv.set('ownerUid', u.uid);
  await onUser(u);
  return sync.status !== 'ask';
}

/** "Use this account, start fresh here": the phone's records are not this
    account's, so they go rather than being uploaded into it. The old
    account's copy in Firestore's own cache goes with them, which needs the
    database shut down — so the caller reloads the app afterwards. */
export async function useThisAccount() {
  const u = auth?.currentUser;
  if (!u) return false;
  try {
    stopMirror?.(); stopMirror = null;
    db.wipeAll();                    // takes the old owner with it
    db.kv.set('ownerUid', u.uid);
    const f = await loadFirebase();
    try { await f.terminate(fs); await f.clearIndexedDbPersistence(fs); } catch { /* cache stays; the records are gone */ }
    return true;
  } catch {
    return false;
  }
}

/** Wiping the phone takes the owner mark with it (it lives in the same
    store), so the account that is signed in says again that these are its
    records — or the next account to sign in would be offered them. */
export function reclaim() {
  const u = auth?.currentUser;
  if (u && db) db.kv.set('ownerUid', u.uid);
}

export async function signOut() {
  if (!auth) return;
  const f = await loadFirebase();
  await f.signOut(auth);
}

/* One account change at a time: a deletion waits for a backup still running,
   so nothing it uploads can land after the removal. */
let userRun = Promise.resolve();
const onUser = (u) => (userRun = userRun.then(() => applyUser(u)).catch(() => {}));

async function applyUser(u) {
  stopMirror?.(); stopMirror = null;
  sync.user = u ? { uid: u.uid, name: u.displayName, email: u.email, photo: u.photoURL,
    password: (u.providerData || []).some(p => p.providerId === 'password') } : null;
  if (!u) { sync.status = 'signed-out'; emit(); return; }

  /* Records already belonging to another account are never merged into this
     one (sync-core.js syncPlan). Nothing is read or written until the handler
     says what to do with them — renderAccount asks. */
  const plan = syncPlan(db.kv.get('ownerUid', null), u.uid, hasRecords());
  if (plan === 'other' || plan === 'ask') { sync.status = plan; sync.error = null; emit(); return; }

  sync.status = 'syncing'; emit();
  try {
    /* Claimed before the first upload, not after it: the merge starts sending
       straight away, and half-sent records still belong to this account. */
    db.kv.set('ownerUid', u.uid);
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

/* ── Deleting the account ──────────────────────────────────────────────
   Everything the account holds goes, in this order: the live runs it shared
   (their pieces, then the run), every backed-up table, then the account.
   A failure part-way leaves an account that still works, never a backup
   with no account left to reach it. The phone keeps its own copy: that is
   the handler's, on their phone, and "Wipe this phone" is its button.
   Firebase only deletes an account whose owner has just proved it is them,
   so that comes first: the password for an email account, Google's own
   check for a Google one (Google sign-in exists only on the web). */
let deleting = false;
export async function deleteAccount({ password = '' } = {}) {
  if (deleting) return { ok: false, error: null };
  const u = auth?.currentUser;
  if (!u) return { ok: false, error: 'You aren’t signed in.' };
  if (live) return { ok: false, error: 'Finish your live run first.' };
  deleting = true;
  try { return await removeAccount(u, password); } finally { deleting = false; }
}

async function removeAccount(u, password) {
  const f = await loadFirebase();
  const via = (u.providerData || []).map(p => p.providerId);
  try {
    if (via.includes('password')) {
      await f.reauthenticateWithCredential(u, f.EmailAuthProvider.credential(u.email, password));
    } else if (isHomeScreenApp()) {
      /* A popup never answers a home-screen web app (see signInWith). */
      return { ok: false, error: 'To delete this account, open Trailcraft in Safari rather than from the home screen, sign in, and delete it there.' };
    } else if (via.includes('apple.com')) {
      await f.reauthenticateWithPopup(u, new f.OAuthProvider('apple.com'));
    } else {
      const g = new f.GoogleAuthProvider();
      g.setCustomParameters({ prompt: 'select_account', login_hint: u.email || '' });
      await f.reauthenticateWithPopup(u, g);
    }
  } catch (e) {
    return { ok: false, error: plain(e) };        // null when they closed the window: nothing to say
  }
  await userRun;                                  // a backup still running finishes first
  stopMirror?.(); stopMirror = null;              // nothing may upload again while the backup goes
  try {
    await removeLive(u.uid);
    for (const name of [...TABLES, 'calibration']) await removeAll(userCol(u.uid, name));
    await f.deleteUser(u);                         // the auth watcher then shows the phone signed out
    /* Only if these records were this account's. Deleting a different account
       must not un-own them, or the next sign-in would take them up. */
    if (db.kv.get('ownerUid', null) === u.uid) db.kv.set('ownerUid', null);
  } catch (e) {
    /* The account is still there, so put its backup back in step with the phone. */
    onUser(auth.currentUser);
    const c = e?.code || '';
    return { ok: false, error: c.includes('permission-denied') || c.includes('requires-recent-login') ? plain(e)
      : 'The account could not be deleted. Nothing was lost. Try again when you have signal.' };
  }
  return { ok: true };
}

async function removeAll(col) {
  const snap = await fb.getDocs(col);
  for (let i = 0; i < snap.docs.length; i += 400) {
    const batch = fb.writeBatch(fs);
    for (const d of snap.docs.slice(i, i + 400)) batch.delete(d.ref);
    await batch.commit();
  }
}

async function removeLive(uid) {
  const runs = await fb.getDocs(fb.query(fb.collection(fs, 'live'), fb.where('uid', '==', uid)));
  for (const run of runs.docs) {
    await removeAll(fb.collection(run.ref, 'chunks'));   // the pieces first: their rule reads the run
    await fb.deleteDoc(run.ref);
  }
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
  /* The records on this phone are not this account's until that is settled,
     and a live link would publish them under it. */
  if (sync.status === 'other' || sync.status === 'ask') {
    throw new Error('Settle whose records these are (Settings → Account) before sharing live');
  }
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
