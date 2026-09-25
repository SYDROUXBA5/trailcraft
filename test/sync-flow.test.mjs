/* The backup, run for real: sync.js itself, on phones that share one account
   and one cloud (fake-firebase.mjs stands in for Google's servers). The pure
   decisions are in sync.test.mjs; this is whether they are made at the right
   moments. Each phone is its own copy of sync.js, with its own storage. */

import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { createStore } from '../public/store.js';
import { trailModel, liveMeta } from '../public/share.js';
import { unpackPoints } from '../public/sync-core.js';
import * as fake from './fake-firebase.mjs';

/* sync.js loads Firebase from Google's CDN, and its config from a file that
   may be empty. Both addresses are pointed at stand-ins, for this run only. */
const HOOKS = `
let fakeUrl;
export async function initialize(data) { fakeUrl = data.fakeUrl; }
export async function resolve(specifier, context, next) {
  if (specifier.startsWith('https://www.gstatic.com/firebasejs/')) return { url: fakeUrl, shortCircuit: true };
  if (specifier === './firebase-config.js' && /\\/public\\/sync\\.js(\\?|$)/.test(context.parentURL || '')) {
    return { shortCircuit: true, url: 'data:text/javascript,' + encodeURIComponent(
      'export const firebaseConfig = { projectId: "test" }; export const appleSignInEnabled = false;') };
  }
  return next(specifier, context);
}`;
register(`data:text/javascript,${encodeURIComponent(HOOKS)}`, import.meta.url,
  { data: { fakeUrl: new URL('./fake-firebase.mjs', import.meta.url).href } });

/* One clock that always moves forward, so "newer" is never a coin toss. */
let now = 1_760_000_000_000;
Date.now = () => (now += 1);
const later = (ms) => { now += ms; };

const ALICE = { uid: 'alice', displayName: 'Alice', email: 'alice@example.com', photoURL: null,
  providerData: [{ providerId: 'password' }] };

const memory = () => {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
};

const tick = () => new Promise(r => setImmediate(r));
async function until(what, ok) {
  for (let i = 0; i < 2000; i++) { if (ok()) return; await tick(); }
  throw new Error(`waited for ${what}`);
}
const done = (p) => until(`the sync to finish (still ${p.s.sync.status})`,
  () => ['synced', 'partial', 'error', 'other', 'ask', 'signed-out'].includes(p.s.sync.status));

let count = 0;
async function phone({ user = ALICE, setup } = {}) {
  const store = createStore(memory());
  setup?.(store);
  fake.startSignedIn(user);
  const s = await import(`../public/sync.js?phone=${++count}`);
  await s.initSync(store);
  const p = { s, store, ...fake.phones[fake.phones.length - 1] };
  await done(p);
  return p;
}
/* Coming back to the app a while later, and waiting for the pull it runs. */
async function comeBack(p) {
  later(2 * 60e3);
  let started = false;
  const off = p.s.onSync(st => { if (st.status === 'syncing') started = true; });
  assert.equal(p.s.resync(), true, 'a pull runs on coming back');
  await until('the pull', () => started && ['synced', 'partial', 'error'].includes(p.s.sync.status));
  off();
}

const doc = (table, id) => fake.cloudDoc(`users/alice/${table}/${id}`);
const local = (p, id) => p.store.rawSessions().find(x => x.id === id);
const walk = (n) => Array.from({ length: n }, (_, i) => ({ lat: 51.2 + i * 1e-4, lon: -2.6, t: 1000 * i }));
const trail = (id, extra = {}) => ({ id, handlerId: 'h1', dogId: 'd1', startedAt: 1000, summary: 'Wood edge',
  data: { trail: walk(5) }, ...extra });

function fresh() {
  fake.cloud.docs.clear();
  fake.cloud.baseRule = true;
  fake.cloud.fail = null;
  fake.cloud.beforeBatch = null;
}

let pass = 0;
const t = async (name, fn) => { fresh(); await fn(); pass++; console.log(`  ok  ${name}`); };

await t('a phone that has not pulled for hours cannot send its old copy over a run recorded on another phone', async () => {
  const A = await phone({ setup: st => { st.kv.set('ownerUid', 'alice'); st.addSession(trail('s1')); } });
  const B = await phone();
  assert.ok(local(B, 's1'), 'the tablet has the trail from its morning launch');

  A.store.updateSession('s1', { data: { track: walk(40), result: { found: true } } });
  await done(A);
  assert.ok(doc('sessions', 's1').data.result, 'the run is in the account');

  /* The tablet was left open and never pulled. It renames its old copy. */
  B.store.updateSession('s1', { name: 'Top field' });
  await done(B);

  const up = doc('sessions', 's1');
  assert.ok(up.data.result, 'the run is still in the account');
  assert.equal(up.name, 'Top field', 'and so is the new name');
  assert.ok(local(B, 's1').data.result, 'the tablet now has the run too');
  assert.equal(B.s.sync.status, 'synced');

  await comeBack(A);
  assert.equal(local(A, 's1').name, 'Top field', 'the phone takes the new name when it comes back');
  assert.ok(local(A, 's1').data.result, 'and keeps its run');
});

await t('before the new rules are live, a run overwritten in the cloud is put back by the phone that has it', async () => {
  fake.cloud.baseRule = false;
  const A = await phone({ setup: st => { st.kv.set('ownerUid', 'alice'); st.addSession(trail('s1')); } });
  const B = await phone();
  A.store.updateSession('s1', { data: { track: walk(40), result: { found: true } } });
  await done(A);
  B.store.updateSession('s1', { name: 'Top field' });
  await done(B);
  assert.ok(!doc('sessions', 's1').data.result, 'the old rules let the stale copy over the run');

  await comeBack(A);
  assert.ok(local(A, 's1').data.result, 'the phone that recorded the run did not lose it');
  assert.equal(local(A, 's1').name, 'Top field');
  assert.ok(doc('sessions', 's1').data.result, 'and put it back in the account');
  await comeBack(B);
  assert.ok(local(B, 's1').data.result, 'from where the tablet takes it');
});

await t('coming back to the app pulls what the other phone changed, and reads only that', async () => {
  const A = await phone({ setup: st => {
    st.kv.set('ownerUid', 'alice');
    for (let i = 0; i < 30; i++) st.addSession(trail(`s${i}`));
  } });
  const B = await phone();
  assert.equal(B.store.rawSessions().length, 30);
  A.store.updateSession('s7', { data: { result: { found: true } } });
  A.store.deleteSession('s8');
  await done(A);

  const before = fake.cloud.read;
  await comeBack(B);
  assert.ok(local(B, 's7').data.result, 'the other phone’s run arrived');
  assert.equal(B.store.sessions().some(x => x.id === 's8'), false, 'and its deletion');
  assert.ok(fake.cloud.read - before <= 4, `read ${fake.cloud.read - before} documents, not all 30 again`);
  assert.equal(B.s.resync(), false, 'not again within the minute');

  let rewrites = 0;
  const replace = B.store.replaceSessions;
  B.store.replaceSessions = (rows) => { rewrites++; return replace(rows); };
  await comeBack(B);
  assert.equal(rewrites, 0, 'with nothing new, the whole history is not written again');
});

await t('a pull with no signal does not make the next one skip what the other phone sent', async () => {
  const A = await phone({ setup: st => { st.kv.set('ownerUid', 'alice'); st.addSession(trail('s1')); } });
  const B = await phone();
  A.store.updateSession('s1', { data: { result: { found: true } } });   // the tablet has not seen this
  await done(A);
  B.store.addSession(trail('s2'));                                      // stored after it, by the server's clock
  await done(B);

  fake.setOnline(B.fs, false);
  await comeBack(B);                       // answered from the tablet's own copy, which has s2 but not s1
  assert.ok(!local(B, 's1').data.result);
  fake.setOnline(B.fs, true);
  await comeBack(B);
  assert.ok(local(B, 's1').data.result, 'the run from the other phone still arrives');
});

await t('a launch sync whose batch meets a record changed a moment ago still sends the rest, and merges that one', async () => {
  fake.seed('users/alice/sessions/s1', { ...trail('s1'), updatedAt: 5 });
  /* Between this phone reading the cloud and sending, the other phone
     stores its run on the same trail. */
  fake.cloud.beforeBatch = () => fake.seed('users/alice/sessions/s1',
    { ...trail('s1', { data: { trail: walk(5), result: { found: true } } }), updatedAt: 7 });
  const B = await phone({ setup: st => {
    st.kv.set('ownerUid', 'alice');
    st.addSession(trail('s1', { name: 'Top field' }));
    st.addSession(trail('s2'));
  } });
  assert.equal(B.s.sync.status, 'synced');
  assert.ok(doc('sessions', 's2'), 'the record nobody else touched went up');
  const s1 = doc('sessions', 's1');
  assert.equal(s1.name, 'Top field', 'this phone’s edit is in the account');
  assert.deepEqual(s1.data.result, { found: true }, 'and so is the other phone’s run');
  assert.deepEqual(local(B, 's1').data.result, { found: true }, 'which this phone now has too');
});

await t('a deletion on one phone wins over an older edit the other phone sends once it has signal', async () => {
  const A = await phone({ setup: st => { st.kv.set('ownerUid', 'alice'); st.addSession(trail('s1')); } });
  const B = await phone();
  fake.setOnline(B.fs, false);
  B.store.updateSession('s1', { name: 'Edited in the field' });      // waits for signal
  A.store.deleteSession('s1');
  await done(A);
  fake.setOnline(B.fs, true);
  await done(B);
  assert.equal(doc('sessions', 's1').deleted, true, 'still deleted in the account');
  assert.equal(B.store.sessions().some(x => x.id === 's1'), false, 'and on the phone that was offline');
});

await t('a save made while the launch sync runs is uploaded, and "backed up" waits for it', async () => {
  fake.seed('users/alice/sessions/old', { ...trail('old'), updatedAt: 5 });
  const hold = fake.pause('calibration');
  const store = createStore(memory());
  store.kv.set('ownerUid', 'alice');
  fake.startSignedIn(ALICE);
  const s = await import(`../public/sync.js?phone=${++count}`);
  await s.initSync(store);
  await hold.hit;                                   // sessions already read and merged
  store.addSession(trail('kept', { data: { track: walk(30), result: { found: true } } }));
  assert.equal(s.sync.status, 'syncing');
  hold.release();
  await done({ s });
  assert.ok(doc('sessions', 'kept')?.data?.result, 'the run saved during the sync reached the account');
  assert.equal(s.sync.status, 'synced');
});

await t('offline, the card says a save is on its way, not that it is backed up', async () => {
  const A = await phone({ setup: st => st.kv.set('ownerUid', 'alice') });
  const was = A.s.sync.lastSync;
  fake.setOnline(A.fs, false);
  A.store.addSession(trail('field'));
  await tick();
  assert.equal(A.s.sync.status, 'syncing', 'backing up, not backed up');
  assert.equal(A.s.sync.lastSync, was, 'and "Backed up" keeps the time it last was');
  fake.setOnline(A.fs, true);
  await done(A);
  assert.equal(A.s.sync.status, 'synced');
  assert.ok(doc('sessions', 'field'));
});

const rows = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => ({ t: from + i, k: 1 + (from + i) / 100 }));

await t('a dog at the fifty-row cap still gets its newest run into the account', async () => {
  fake.seed('users/alice/calibration/d1', { id: 'd1', rows: rows(1, 50), updatedAt: 5 });
  await phone({ setup: st => { st.kv.set('ownerUid', 'alice'); st.setCalibration('d1', rows(2, 51)); } });
  const up = doc('calibration', 'd1').rows;
  assert.equal(up.length, 50);
  assert.ok(up.some(r => r.t === 51), 'the run only this phone had is in the account');
});

await t('two phones calibrating the same dog keep each other’s runs', async () => {
  const A = await phone({ setup: st => { st.kv.set('ownerUid', 'alice'); st.setCalibration('d1', rows(1, 50)); } });
  const B = await phone();
  A.store.addCalibration('d1', { t: 100, k: 2 });
  await done(A);
  B.store.addCalibration('d1', { t: 101, k: 3 });   // the tablet never saw row 100
  await done(B);
  const up = doc('calibration', 'd1').rows.map(r => r.t);
  assert.ok(up.includes(100) && up.includes(101), `both runs are in the account (${up.slice(-3)})`);
  assert.ok(B.store.calibration('d1').some(r => r.t === 100), 'and on the tablet');
});

await t('a failed sync says what failed, not that signing in did', async () => {
  fake.cloud.fail = 'resource-exhausted';
  const A = await phone({ setup: st => st.kv.set('ownerUid', 'alice') });
  assert.equal(A.s.sync.status, 'error');
  assert.equal(A.s.sync.error, 'The free cloud allowance is used up for today.');
  fake.cloud.fail = 'internal';
  await comeBack(A);
  assert.equal(A.s.sync.error, 'Could not sync. Your trails are still safe on this phone.');
  assert.ok(!/Sign-in/.test(A.s.sync.error));
});

await t('no pull on coming back starts while the account is being deleted', async () => {
  const A = await phone({ setup: st => { st.kv.set('ownerUid', 'alice'); st.addSession(trail('s1')); } });
  const check = fake.holdReauth();
  const going = A.s.deleteAccount({ password: 'a good password' });
  await check.hit;                          // the handler is typing their password in
  later(2 * 60e3);
  assert.equal(A.s.resync(), false, 'a pull would put the mirror back while the backup goes');
  check.release();
  assert.deepEqual(await going, { ok: true });
  assert.equal(doc('sessions', 's1'), null, 'the backup is gone');
  A.store.updateSession('s1', { name: 'After' });
  await tick();
  assert.equal(doc('sessions', 's1'), null, 'and nothing saved afterwards puts it back');
});

await t('wiping the phone while signed in signs out, and the next person’s records stay off the account', async () => {
  const A = await phone({ setup: st => { st.kv.set('ownerUid', 'alice'); st.addSession(trail('mine')); } });
  assert.ok(doc('sessions', 'mine'));
  assert.equal(await A.s.wipeAndSignOut(), true);
  assert.equal(A.auth.currentUser, null, 'signed out');
  assert.equal(A.store.rawSessions().length, 0, 'the phone is clear');
  assert.equal(A.store.kv.get('ownerUid', null), null, 'and belongs to nobody');
  assert.ok(A.fs.cleared, 'the database’s own copy of the account went too');
  A.store.addSession(trail('sams'));
  await tick();
  assert.equal(doc('sessions', 'sams'), null, 'what the next person saves goes nowhere');
  assert.ok(doc('sessions', 'mine'), 'the account’s backup is kept');

  /* The app starts again (it reloads), still signed out: nothing comes back. */
  const again = createStore(memory());
  again.addSession(trail('sams'));
  const s = await import(`../public/sync.js?phone=${++count}`);
  await s.initSync(again);
  await done({ s });
  assert.equal(s.sync.status, 'signed-out');
  assert.deepEqual(again.rawSessions().map(x => x.id), ['sams']);
});

/* ── Live runs ─────────────────────────────────────────────────────────
   What the rules let into live/ is read from firestore.rules itself, so a
   field the app starts writing, or a limit it outgrows, fails here rather
   than as a live link that silently never starts. */
const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
const rule = (name) => {
  const at = rules.indexOf(`function ${name}(`);
  assert.ok(at > 0, `firestore.rules has ${name}`);
  return rules.slice(at, rules.indexOf('\n      }', at));
};
function fitsRule(name, data, id) {
  const body = rule(name);
  const allowed = JSON.parse(body.match(/hasOnly\((\[[\s\S]*?\])\)/)[1].replace(/'/g, '"'));
  assert.deepEqual(Object.keys(data).filter(k => !allowed.includes(k)), [], `${name}: fields the rules refuse`);
  for (const [, k, n] of body.matchAll(/text\(d\.get\('(\w+)', null\), (\d+)\)/g)) {
    assert.ok(data[k] == null || (typeof data[k] === 'string' && data[k].length <= Number(n)), `${name}: ${k} is short text`);
  }
  for (const [, k] of body.matchAll(/num\(d\.get\('(\w+)', null\)\)/g)) {
    assert.ok(data[k] == null || typeof data[k] === 'number', `${name}: ${k} is a number`);
  }
  for (const [, k] of body.matchAll(/flag\(d\.get\('(\w+)', null\)\)/g)) {
    assert.ok(data[k] == null || typeof data[k] === 'boolean', `${name}: ${k} is true or false`);
  }
  assert.equal(typeof data.expiresAt, 'number', `${name}: expiresAt stays a number for the rules and viewers`);
  assert.ok(data.deleteAt instanceof fake.Timestamp, `${name}: deleteAt is a Timestamp, the only kind a TTL policy acts on`);
  assert.equal(data.deleteAt.toMillis(), data.expiresAt, `${name}: and it is the same moment`);
  if (name === 'livePiece') {
    assert.equal(id, String(data.n), 'a chunk’s id is its minute');
    assert.ok(Number.isInteger(data.__pts) && data.__pts >= 1 && data.__pts <= 3000);
  }
}
const liveDocs = () => [...fake.cloud.docs.keys()].filter(k => k.startsWith('live/'));
const runSession = { id: 'r1', targetId: 'person', startedAt: 1000,
  data: { trail: walk(30), contamination: [{ points: walk(3) }] } };
const meta = (startedAt) => liveMeta(trailModel(runSession, {
  dog: { name: 'Bramble', breed: 'Bloodhound', sex: 'female', dob: 1_600_000_000_000, weightKg: 41, lineM: 10, photo: 'x' },
  handler: { name: 'Alice' }, layer: { name: 'Sam' } }), startedAt);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

await t('a live run, its chunks and its end all carry a Timestamp a TTL policy can delete them by, and fit the rules', async () => {
  const A = await phone({ setup: st => st.kv.set('ownerUid', 'alice') });
  const from = Date.now();
  const id = await A.s.startLive(meta(from));
  fitsRule('liveRun', fake.cloudDoc(`live/${id}`));
  A.s.pushLive(walk(90).map((p, i) => ({ ...p, t: from + i * 1000 })), [{ lat: 51.2, lon: -2.6, t: from, kind: 'mark' }]);
  await tick(); await tick();
  const pieces = liveDocs().filter(k => k.includes('/chunks/'));
  assert.equal(pieces.length, 2, 'ninety seconds of track is two minutes of chunks');
  for (const k of pieces) fitsRule('livePiece', fake.cloudDoc(k), k.split('/').pop());
  /* A viewer unpacks a chunk whole: the Timestamp beside the points must not
     turn up as part of one. */
  assert.deepEqual(pieces.flatMap(k => unpackPoints(fake.cloudDoc(k))).map(p => Object.keys(p).sort().join()),
    Array(90).fill('dwellS,lat,lon,t'), 'the viewer gets the points and nothing else');
  fitsRule('liveRun', fake.cloudDoc(`live/${id}`));
  await A.s.endLive({ result: { found: true, score: 80 }, track: [], wps: [] });
  const ended = fake.cloudDoc(`live/${id}`);
  assert.equal(ended.ended, true);
  fitsRule('liveRun', ended);
  assert.ok(ended.expiresAt > from + 23 * 3600e3, 'readable for a day after the end');
});

await t('Share live with no signal gives up, and the run it queued never goes live', async () => {
  const A = await phone({ setup: st => st.kv.set('ownerUid', 'alice') });
  fake.setOnline(A.fs, false);
  const tried = A.s.startLive(meta(Date.now()), { waitMs: 30 }).then(() => 'live', e => e.message);
  const said = await Promise.race([tried, sleep(1000).then(() => 'still waiting')]);
  assert.match(said, /No signal/, 'it says so instead of waiting for ever');
  assert.equal(A.s.liveNow(), null, 'nothing is left open on this phone');
  fake.setOnline(A.fs, true);
  await tick(); await tick();
  assert.deepEqual(liveDocs(), [], 'the start that was waiting reaches the cloud, and so does its delete');
});

await t('a live run that started after its run ended is taken back', async () => {
  const A = await phone({ setup: st => st.kv.set('ownerUid', 'alice') });
  const id = await A.s.startLive(meta(Date.now()));
  assert.ok(fake.cloudDoc(`live/${id}`));
  A.s.dropLive(id);
  assert.equal(A.s.liveNow(), null);
  await tick();
  assert.equal(fake.cloudDoc(`live/${id}`), null, 'nobody had the link, so nothing is left behind');
});

console.log(`\n${pass} passed total\n`);
