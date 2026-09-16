/* Sign-in and the cloud mirror.

   The phone stays the source of truth. localStorage is what the app reads,
   always; Firestore is a copy of it that follows along, and fills a new phone
   back up. That is what lets the app keep working in a field with no signal:
   nothing waits on the network, and Firestore's own offline cache queues every
   write until there is somewhere to send it.

   Firebase is loaded lazily, from Google's CDN, only when a config exists. If
   it cannot load — offline, blocked, not set up — the app does not notice. */

import { firebaseConfig, appleSignInEnabled } from './firebase-config.js';
import { mergeRecords, mergeCalibration, toCloud, fromCloud, approxBytes, DOC_LIMIT } from './sync-core.js';

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
export async function initSync(store) {
  db = store;
  if (!firebaseConfig) { sync.status = 'off'; emit(); return; }
  sync.status = 'loading'; emit();
  try {
    const f = await loadFirebase();
    const app = f.initializeApp(firebaseConfig);
    auth = f.getAuth(app);
    fs = f.initializeFirestore(app, {
      localCache: f.persistentLocalCache({ tabManager: f.persistentMultipleTabManager() }),
    });
    // A redirect sign-in comes back through a full page load and lands here.
    await f.getRedirectResult(auth).catch((e) => { sync.error = plain(e); });
    f.onAuthStateChanged(auth, onUser);
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
