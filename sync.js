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
         mergeRecords, mergeOne, mergeCalibration, calibrationDiffers, toCloud, fromCloud, fromCloudRecord,
         approxBytes, DOC_LIMIT, packPoints, unpackPoints,
         authMessage, syncMessage } from './sync-core.js';

const SDK = 'https://www.gstatic.com/firebasejs/12.3.0';
const TABLES = ['handlers', 'dogs', 'layers', 'sessions'];

export const sync = {
  configured: !!firebaseConfig,
  apple: !!firebaseConfig && appleSignInEnabled,
  user: null,               // { uid, name, email, photo }
  status: 'off',            // off | loading | signed-out | other | ask | syncing | synced | partial | error
  lastSync: 0,
  error: null,
};

let fb = null, auth = null, fs = null, db = null, stopMirror = null;
const watchers = new Set();
export function onSync(fn) { watchers.add(fn); fn(sync); return () => watchers.delete(fn); }
const emit = () => { for (const fn of watchers) { try { fn(sync); } catch { /* never break sync */ } } };

/* Firebase's error codes are for developers. A handler in a field needs to
   know what happened and whether to do anything about it (sync-core.js).
   `plain` is for signing in; a backup, a pull or a live link that fails says
   so in its own words (syncMessage), never "Sign-in did not work". */
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
    forgetSkipped();                 // those records are not this phone's any more
    db.wipeAll();                    // takes the old owner with it
    db.kv.set('ownerUid', u.uid);
    const f = await loadFirebase();
    try { await f.terminate(fs); await f.clearIndexedDbPersistence(fs); } catch { /* cache stays; the records are gone */ }
    return true;
  } catch {
    return false;
  }
}

/** "Wipe this phone" while signed in: the phone is cleared AND signed out.
    It used to stay signed in, so the mirror went on uploading whatever the
    next person saved into this account, and the next launch pulled the whole
    backup back onto the phone they were holding. Now the phone is nobody's:
    no owner mark, no account, nothing listening. The account's backup is
    kept, and signing in again brings it back. The database's own cache of
    that account goes too, which shuts the database down, so the caller
    reloads the app afterwards. False, with nothing changed, if signing out
    did not work. */
let wiping = false;
export async function wipeAndSignOut() {
  const f = await loadFirebase();
  wiping = true;                          // no pull on coming back may start meanwhile (resync)
  stopMirror?.(); stopMirror = null;
  try {
    await f.signOut(auth);
  } catch {
    wiping = false;
    onUser(auth?.currentUser ?? null);   // still signed in: back to backing up
    return false;
  }
  try { await f.terminate(fs); } catch { /* already shut */ }
  /* A sync still running stops with its database. Waited for (not for ever:
     a write held for signal never answers once the database is shut), so
     nothing it merges can land on the phone after it is cleared. */
  let timer;
  await Promise.race([userRun, new Promise(r => { timer = setTimeout(r, 3000); })]);
  clearTimeout(timer);
  forgetSkipped();
  db.wipeAll();                           // the owner mark goes with it, and is not put back
  try { await f.clearIndexedDbPersistence(fs); } catch { /* the cache stays; the phone is clear */ }
  return true;
}

export async function signOut() {
  if (!auth) return;
  const f = await loadFirebase();
  await f.signOut(auth);
}

/* One account change at a time: a deletion waits for a backup still running,
   so nothing it uploads can land after the removal. */
let userRun = Promise.resolve();
const onUser = (u, how) => (userRun = userRun.then(() => applyUser(u, how)).catch(() => {}));

/* Coming back to the app, or back into signal. The only pull used to be at
   launch, and an iPhone keeps the app alive for days: a phone that had not
   pulled since the morning edited its old copy of a trail and sent it over
   the run another phone had recorded on it since. Now it fetches what other
   phones changed before anything here is edited over it. Only what changed
   is read (syncedAt), so it is cheap, and it runs at most once a minute. */
const RESYNC_EVERY = 60e3;
let lastPull = 0;
let pulling = false;
export function resync() {
  const u = auth?.currentUser;
  /* Not while the account is being deleted or the phone wiped: a pull would
     put the mirror back, and send saves into what is being taken away. */
  if (!u || !db || pulling || deleting || wiping || sync.user?.uid !== u.uid) return false;
  if (!['syncing', 'synced', 'partial', 'error'].includes(sync.status)) return false;
  if (Date.now() - lastPull < RESYNC_EVERY) return false;
  lastPull = Date.now();
  onUser(u, { resume: true });
  return true;
}

async function applyUser(u, { resume = false } = {}) {
  stopMirror?.(); stopMirror = null;
  sync.user = u ? { uid: u.uid, name: u.displayName, email: u.email, photo: u.photoURL,
    password: (u.providerData || []).some(p => p.providerId === 'password') } : null;
  if (!u) { forgetSkipped(); sync.status = 'signed-out'; emit(); return; }

  /* Records already belonging to another account are never merged into this
     one (sync-core.js syncPlan). Nothing is read or written until the handler
     says what to do with them — renderAccount asks. */
  const plan = syncPlan(db.kv.get('ownerUid', null), u.uid, hasRecords());
  if (plan === 'other' || plan === 'ask') { forgetSkipped(); sync.status = plan; sync.error = null; emit(); return; }

  /* A pull on coming back reads only what changed since the last one. After
     a failure, or with records the cloud refused, it reads everything, so
     those are sent again. */
  const partial = resume && pulled.size > 0 && failed.size === 0;
  sync.status = 'syncing'; pulling = true; emit();
  /* The mirror only listens once the merge is done, and the merge reads each
     table once. A save made in between used to go nowhere while the card
     said "Backed up": it is noted here and sent at the end. */
  const meanwhile = new Map();
  const stopNoting = db.onChange((table, rec) => { if (rec?.id) meanwhile.set(`${table}/${rec.id}`, [table, rec.id]); });
  try {
    /* Claimed before the first upload, not after it: the merge starts sending
       straight away, and half-sent records still belong to this account. */
    db.kv.set('ownerUid', u.uid);
    if (!partial) forgetSkipped();
    refused.clear();
    for (const id of await fullSync(u.uid, { partial })) tooBig.add(id);
    for (const [id, why] of refused) failed.set(id, why);
    lastPull = Date.now();
    stopNoting();
    stopMirror = db.onChange((table, rec) => mirror(u.uid, table, rec));
    /* Sent as they stand now, not as they were noted: the merge may have
       replaced one with a newer copy from the cloud since. */
    for (const [table, id] of meanwhile.values()) {
      const rec = current(table, id);
      if (rec) mirror(u.uid, table, rec);
    }
    pulling = false;
    /* "Backed up" only when everything is. Anything left behind is named. */
    settle();
    return;
  } catch (e) {
    pulled.clear();                      // the next pull reads everything again
    sync.status = 'error';
    sync.error = syncMessage(e) || 'Could not sync. Your trails are still safe on this phone.';
  } finally {
    stopNoting();
    pulling = false;
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

/* ── Two phones, one account ───────────────────────────────────────────
   What this phone last knew of each record in the cloud: `table/id` → that
   copy's updatedAt. Every save names it as the copy it was made from
   (baseAt), and the rules refuse a save when the cloud holds a different
   copy: another phone changed the record since this one last read it. The
   phone then merges the two (put). It compares copies, not times, so two
   phones whose clocks differ by a few seconds cannot fool it. */
const known = new Map();
/* Up to when each table has been read, by the server's clock: every save
   carries syncedAt, which the server stamps as it stores it. A pull on
   coming back reads only what was stored after that. */
const pulled = new Map();

const stampOf = (rec) => (Number.isFinite(rec?.updatedAt) ? rec.updatedAt : null);
const setKnown = (k, at) => { if (at == null) known.delete(k); else known.set(k, at); };
const baseOf = (table, id) => known.get(`${table}/${id}`) ?? null;
/* What goes up: the record, the copy it was made from, and a slot for the
   server to write when it stored it. */
const forCloud = (table, rec, body = toCloud(rec)) =>
  ({ ...body, baseAt: baseOf(table, rec.id), syncedAt: fb.serverTimestamp() });
const refusedByRules = (e) => String(e?.code || '').includes('permission-denied');

/* A record as the phone holds it now, tombstone and all. */
function current(table, id) {
  if (table === 'calibration') return { id, rows: db.calibration(id), updatedAt: Date.now() };
  const rows = table === 'sessions' ? db.rawSessions() : db[table].raw();
  return rows.find(r => r.id === id) ?? null;
}

/* Put one record on the phone as the cloud and the phone agreed it. Not a
   save: nothing is announced, so the mirror does not send it back. */
function keepHere(table, rec) {
  if (table === 'calibration') return db.setCalibration(rec.id, rec.rows);
  const rows = table === 'sessions' ? db.rawSessions() : db[table].raw();
  const i = rows.findIndex(r => r.id === rec.id);
  if (i >= 0) rows[i] = rec; else rows.push(rec);
  if (table === 'sessions') db.replaceSessions(rows); else db[table].replaceAll(rows);
}

/** Read one table, or only what changed in it since the last pull. */
async function readTable(uid, name, partial) {
  const since = partial ? pulled.get(name) : undefined;
  const snap = await fb.getDocs(since === undefined ? userCol(uid, name)
    : fb.query(userCol(uid, name), fb.where('syncedAt', '>', fb.Timestamp.fromMillis(since))));
  let mark = since ?? 0;
  const rows = snap.docs.map((d) => {
    const raw = d.data();
    mark = Math.max(mark, raw.syncedAt?.toMillis?.() ?? 0);
    const rec = fromCloudRecord(raw);
    if (rec.id == null) rec.id = d.id;
    setKnown(`${name}/${d.id}`, stampOf(rec));
    return rec;
  });
  /* With no signal the answer comes from the phone's own copy of the cloud,
     which holds this phone's saves but not what other phones sent meanwhile.
     Marking the table read up to the newest save in it would skip theirs for
     good, so the mark stays where the last real read left it. */
  if (snap.metadata?.fromCache) mark = since;
  return { rows, mark, whole: since === undefined };
}

/** Bring the phone and the account into agreement, both directions.
    `partial`: only what other phones changed since the last pull. */
async function fullSync(uid, { partial = false } = {}) {
  const skipped = [];
  const marks = new Map();
  for (const name of TABLES) {
    const { rows: remote, mark, whole } = await readTable(uid, name, partial);
    marks.set(name, mark);
    /* Nothing changed there: the phone's copy is not rewritten for nothing,
       which for sessions is the whole history, every time the app comes back. */
    if (!whole && !remote.length) continue;
    const local = name === 'sessions' ? db.rawSessions() : db[name].raw();
    // Rows from before sync existed have no stamp. Give them the oldest real
    // one on both sides at once, so the two copies agree from here on.
    const stamped = local.map(r => (Number.isFinite(r.updatedAt) ? r : { ...r, updatedAt: 1 }));
    const { merged, toUpload } = mergeRecords(stamped, remote, { partial: !whole, union: name === 'sessions' });
    if (name === 'sessions') db.replaceSessions(merged); else db[name].replaceAll(merged);
    skipped.push(...await uploadAll(uid, name, toUpload));
  }

  const { rows: cal, mark, whole } = await readTable(uid, 'calibration', partial);
  marks.set('calibration', mark);
  const remote = new Map(cal.map(c => [c.id, c.rows || []]));
  const local = new Map(db.allCalibration().map(c => [c.id, c.rows]));
  const up = [];
  for (const dogId of new Set([...remote.keys(), ...(whole ? local.keys() : [])])) {
    const rows = mergeCalibration(local.get(dogId), remote.get(dogId));
    db.setCalibration(dogId, rows);
    if (calibrationDiffers(rows, remote.get(dogId))) up.push({ id: dogId, rows, updatedAt: Date.now() });
  }
  skipped.push(...await uploadAll(uid, 'calibration', up));
  /* Only once everything was read and merged: a pull that failed half-way
     leaves the next one reading all of it again. */
  for (const [name, at] of marks) if (at !== undefined) pulled.set(name, at);
  return skipped;
}

/** Firestore takes at most 500 writes in one batch. */
/* One request to Firestore may carry at most 10 MiB, and at most 500 writes.
   A first backup of a long history used to go up as batches of 400 whole
   sessions, far over the size limit, so it failed at every launch. */
/* Counted in stored bytes (approxBytes), which runs about a third smaller
   than the request that carries them, so the budget leaves that room. */
const BATCH_BYTES = 5_000_000;
const BATCH_WRITES = 400;

/* Records the cloud would not take for a reason other than size. Kept apart
   from the too-long ones, so the handler is told the right thing. */
const refused = new Map();

async function uploadAll(uid, name, rows) {
  const skipped = [];
  let batch = null, n = 0, bytes = 0, inBatch = [];
  const send = async () => {
    if (n) {
      try {
        await batch.commit();
        for (const rec of inBatch) setKnown(`${name}/${rec.id}`, stampOf(rec));
      } catch (e) {
        if (!refusedByRules(e)) throw e;
        /* One record another phone changed a moment ago, since it was read,
           refuses the whole batch. Each goes on its own instead, merged
           first where it has to be. */
        for (const rec of inBatch) {
          try { await put(uid, name, rec); } catch (err) { refused.set(rec.id, syncMessage(err) || 'the cloud refused it'); }
        }
      }
    }
    batch = null; n = 0; bytes = 0; inBatch = [];
  };
  for (const rec of rows) {
    const body = toCloud(rec);
    const size = approxBytes(body);
    /* Skipped, and SAID: a backup that quietly leaves a session behind and
       then reports "backed up" is worse than one that fails. */
    if (size > DOC_LIMIT) { skipped.push(rec.id); continue; }
    if (n && (n >= BATCH_WRITES || bytes + size > BATCH_BYTES)) await send();
    batch ??= fb.writeBatch(fs);
    const payload = forCloud(name, rec, body);
    /* A record the SDK refuses outright is left behind by itself, not with
       every record that happened to share its batch. */
    try { batch.set(userDoc(uid, name, rec.id), payload); } catch (e) { refused.set(rec.id, syncMessage(e) || 'the cloud refused it'); continue; }
    n++; bytes += size; inBatch.push(rec);
  }
  await send();
  return skipped;
}

/** One record to the cloud, made from the copy this phone last knew. When
    the rules refuse it, another phone has changed that record since: the
    two are merged (sync-core.js mergeOne, or the calibration union), the
    phone keeps the merge, and the merge goes up in its place. Once: a
    second refusal is reported, not chased. */
async function put(uid, table, rec) {
  const k = `${table}/${rec.id}`;
  const base = known.get(k) ?? null;
  const payload = forCloud(table, rec);
  /* This phone's writes reach the cloud in the order they were made, so
     its next save of this record is made from this one. */
  setKnown(k, stampOf(rec));
  try {
    await fb.setDoc(userDoc(uid, table, rec.id), payload);
  } catch (e) {
    if (!refusedByRules(e)) { if (known.get(k) === stampOf(rec)) setKnown(k, base); throw e; }
    await mend(uid, table, rec.id);
  }
}

/* One merge at a time for any one record: two refused saves of it would
   otherwise each merge with a cloud copy the other is about to replace. */
const mending = new Map();
function mend(uid, table, id) {
  const k = `${table}/${id}`;
  const run = (mending.get(k) || Promise.resolve()).catch(() => {}).then(() => mendNow(uid, table, id));
  mending.set(k, run);
  run.catch(() => {}).then(() => { if (mending.get(k) === run) mending.delete(k); });
  return run;
}

async function mendNow(uid, table, id) {
  const k = `${table}/${id}`;
  const snap = await fb.getDoc(userDoc(uid, table, id));
  const cloud = snap.exists() ? { ...fromCloudRecord(snap.data()), id } : null;
  const at = stampOf(cloud);
  setKnown(k, at);
  const mine = current(table, id);
  let keep, up;
  if (table === 'calibration') {
    const rows = mergeCalibration(mine?.rows, cloud?.rows);
    keep = { id, rows, updatedAt: Date.now() };
    up = calibrationDiffers(rows, cloud?.rows || []);
  } else {
    ({ keep, up } = mergeOne(mine, cloud, { union: table === 'sessions' }));
  }
  if (!keep) return;
  keepHere(table, keep);
  if (!up) return;                                  // the cloud's copy was the one to keep
  await fb.setDoc(userDoc(uid, table, id), forCloud(table, keep));
  setKnown(k, stampOf(keep));
}

/* What is NOT in the cloud: records too long to fit, and records the cloud
   refused. Both are kept by id until that same record goes up, so no other
   save can report "backed up" over the top of one that never went. */
const tooBig = new Set();
const failed = new Map();      // id → what went wrong, in words
/* Saves on their way, each marked with its account. Offline that can be
   hours, and until one lands the card says "Backing up", not "Backed up". */
const sending = new Set();

/** Forget both, because the records they describe are no longer this
    account's business: wiped, signed out, or handed to someone else. What
    this phone knew of the cloud goes too, so the next sync reads it all. */
export function forgetSkipped() {
  tooBig.clear();
  failed.clear();
  known.clear();
  pulled.clear();
}

function settle() {
  const n = tooBig.size;
  const line = n
    ? `${n} very long session${n === 1 ? '' : 's'} could not be backed up — ${n === 1 ? 'it is' : 'they are'} still on this phone only`
    : failed.size
      ? `${failed.size} record${failed.size === 1 ? '' : 's'} did not reach your account: ${[...failed.values()][0]}`
      : null;
  const busy = pulling || [...sending].some(s => s.uid === sync.user?.uid);
  sync.error = line;
  sync.status = line ? 'partial' : busy ? 'syncing' : 'synced';
  if (!busy) sync.lastSync = Date.now();
  emit();
}

/** Every save on the phone, copied up as it happens. Not awaited: Firestore
    queues it offline, and the handler is never kept waiting on a network. */
function mirror(uid, table, rec) {
  if (!fs || !rec?.id) return;
  /* Firestore holds a write until it can send it, which offline can be hours.
     By then the phone may be signed out, or signed in as somebody else, and an
     answer about the old account must not touch what the screen is saying. */
  const theirs = () => sync.user?.uid === uid && ['syncing', 'synced', 'partial'].includes(sync.status);
  if (!theirs()) return;
  if (approxBytes(toCloud(rec)) > DOC_LIMIT) { tooBig.add(rec.id); settle(); return; }
  const going = { uid };
  sending.add(going);
  settle();
  put(uid, table, rec)
    .then(() => { if (!theirs()) return; tooBig.delete(rec.id); failed.delete(rec.id); })
    .catch((e) => {
      if (!theirs()) return;
      failed.set(rec.id, syncMessage(e) || 'the cloud refused it');
    })
    .finally(() => { sending.delete(going); if (theirs()) settle(); });
}

/* ── Live: a run, followed from anywhere while it happens ─────────────
   One document per run at live/{id}, with the trail and the team, and a
   chunk document per minute of dog track under it — a viewer's listener
   then receives a minute's worth of points when it changes, not the whole
   run every ten seconds. The id is 120 random bits: the link is the key.
   A run stays readable for 24 hours after it ends (the rules check
   expiresAt), and a TTL policy in Firestore deletes it after that.

   That clean-up reads deleteAt, not expiresAt. A TTL policy only acts on a
   Timestamp, and expiresAt is a number, which the rules and the viewers
   read; live runs written with only the number were never deleted. So the
   run and every chunk carry the same moment twice (expiry). */

const LIVE_TTL = 24 * 3600e3;
const CHUNK_MS = 60e3;
/* Offline, Firestore keeps a write for later and does not answer until the
   server has it, which with no signal is never. Share live waits this long
   for the run to be taken, then says so rather than doing nothing. */
const LIVE_WAIT = 15e3;
let live = null;   // { id, startedAt, chunks: Map<n, signature>, expiresAt, wpsN }

const liveId = () => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => alphabet[b % 64]).join('');   // 256 = 4 × 64: no bias
};

const expiry = (ms) => ({ expiresAt: ms, deleteAt: fb.Timestamp.fromMillis(ms) });

/** Publish a run. `meta` is share.js's liveMeta(): the trail, not the run.
    Refuses, rather than waiting for ever, when the cloud does not take the
    run within `waitMs`. */
export async function startLive(meta, { waitMs = LIVE_WAIT } = {}) {
  if (!fs || !sync.user) throw new Error('Sign in to share live');
  /* The records on this phone are not this account's until that is settled,
     and a live link would publish them under it. */
  if (sync.status === 'other' || sync.status === 'ask') {
    throw new Error('Settle whose records these are (Settings → Account) before sharing live');
  }
  const f = await loadFirebase();
  const id = liveId();
  const at = Date.now();
  const expiresAt = at + LIVE_TTL;
  const wrote = f.setDoc(f.doc(fs, 'live', id), {
    ...toCloud(meta), uid: sync.user.uid, ...expiry(expiresAt), ended: false, createdAt: at, at,
  });
  let timer;
  const late = new Promise(r => { timer = setTimeout(r, waitMs, 'late'); });
  const took = await Promise.race([wrote, late]).finally(() => clearTimeout(timer));
  if (took === 'late') {
    wrote.catch(() => {});
    dropLive(id);
    throw new Error('No signal, so the run is not live. Try again when you have some.');
  }
  live = { id, startedAt: meta.startedAt, chunks: new Map(), expiresAt, wpsN: -1 };
  return id;
}

/** Take back a live run whose link nobody was given: its start came too late
    to be any use, or the run it was for had ended by then. Firestore still
    holds the start and sends it when there is signal, and it sends this
    delete straight after it, so what reaches the cloud is nothing at all. */
export function dropLive(id) {
  if (!fs || !id) return;
  if (live?.id === id) live = null;
  fb.deleteDoc(fb.doc(fs, 'live', id)).catch(() => {});
}

export const liveNow = () => live?.id ?? null;

/** Pick a live run back up after the app died mid-run, so the last points and
    the result still reach whoever is watching. Its chunks are unknown, so they
    are simply written again — the same points, the same ids, no duplicates. */
export function resumeLive(id, startedAt) {
  if (!fs || !sync.user || !id) return false;
  live = { id, startedAt: startedAt ?? Date.now(), chunks: new Map(), expiresAt: Date.now() + LIVE_TTL, wpsN: -1 };
  return true;
}

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
      { n, ...expiry(live.startedAt + 36 * 3600e3), ...packPoints(clean) }).catch(() => {});
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
    ended: true, endedAt: Date.now(), ...expiry(Date.now() + LIVE_TTL), at: Date.now(),
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
  }, (e) => cb({ error: e?.code?.includes('permission') ? 'This live link has expired' : (syncMessage(e) || 'Could not follow this run') }));
  const offChunks = f.onSnapshot(f.collection(fs, 'live', id, 'chunks'), (qs) => {
    qs.docChanges().forEach(ch => {
      if (ch.type === 'removed') chunks.delete(ch.doc.id);
      else chunks.set(ch.doc.id, unpackPoints(ch.doc.data()));
    });
    push();
  }, () => { /* the document listener reports the reason */ });
  return () => { offDoc(); offChunks(); };
}
