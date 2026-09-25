/* The backup file and the way back in from one (backup.js, store.js restore).

   "Export everything" wrote a file nothing could read, without any dog's
   calibration, and the Wipe dialog told handlers to export first. These pin
   that the file now holds everything, reads back as it was, only ever adds,
   and is read as a stranger's input. */

import assert from 'node:assert/strict';
import { createStore, SaveError } from '../public/store.js';
import { readBackup, planRestore, restoreQuestion, restoreChanges, makeBackup, BACKUP_VERSION } from '../public/backup.js';

let pass = 0;
const t = async (name, fn) => { await fn(); pass++; console.log(`  ok  ${name}`); };

const fakeBackend = () => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    _dump: () => m,
  };
};

const NOW = Date.UTC(2026, 8, 24, 12);
const pt = (i, t = NOW - 3600e3 + i * 1000) => ({ lat: 51.2 + i * 1e-5, lon: -2.6 + i * 1e-5, t, acc: 4 });
const trail = Array.from({ length: 20 }, (_, i) => pt(i));
const calRow = (i) => ({ t: NOW - 86400e3 * (10 - i), predSide: 1, mean: 2.5 + i, wind: 3, stability: 'neutral', k: 1.1 + i / 10 });

/** A phone with a season on it: a handler, a dog, a layer, two sessions and
    six graded runs banked for the dog. */
function seasonPhone() {
  const backend = fakeBackend();
  const db = createStore(backend);
  db.handlers.upsert({ id: 'remi', name: 'Rémi', photo: 'data:image/jpeg;base64,AAAA' });
  db.dogs.upsert({ id: 'bo', handlerId: 'remi', name: 'Bo', photo: null, level: 'Warm', lineM: 10 });
  db.layers.upsert({ id: 'soph', name: 'Sophie', photo: null });
  db.addSession({ id: 's1', handlerId: 'remi', dogId: 'bo', layerId: 'soph', targetId: 'person', startedAt: NOW - 7200e3,
    summary: 'Bo ran it.', data: { trail, track: trail, waypoints: [], weather: { temp: 12, wind_speed: 3 }, contamination: [{ points: trail.slice(0, 4) }],
      result: { kind: 'trail', sentence: 'Bo ran it', mean: 2.1 } } });
  db.addSession({ id: 's2', handlerId: 'remi', dogId: null, layerId: null, targetId: 'narcotics', odour: 'Cocaine', startedAt: NOW - 3600e3,
    summary: 'Hides set.', data: { hides: [pt(1)], weather: null } });
  for (let i = 0; i < 6; i++) db.addCalibration('bo', calRow(i));
  return { db, backend };
}

await t('the file holds every record and every dog’s calibration, with a version', () => {
  const { db } = seasonPhone();
  const text = db.exportAll();
  const o = JSON.parse(text);
  assert.equal(o.version, BACKUP_VERSION);
  assert.equal(o.version, 3);
  assert.equal(o.app, 'trailcraft');
  assert.equal(o.handlers.length, 1);
  assert.equal(o.dogs.length, 1);
  assert.equal(o.layers.length, 1);
  assert.equal(o.sessions.length, 2);
  assert.deepEqual(o.calibration, [{ id: 'bo', rows: db.calibration('bo') }], 'the months of graded runs are in it');
  assert.ok(!text.includes('\n  '), 'written without indenting, which tripled the size of a long history');
  /* A deleted dog's rows stay on the phone where nothing reaches them. */
  db.addCalibration('gone', calRow(0));
  assert.deepEqual(JSON.parse(db.exportAll()).calibration.map(c => c.id), ['bo']);
  assert.deepEqual(makeBackup({ dogs: [{ id: 'bo' }], calibration: [{ id: 'bo', rows: [] }] }).calibration, [], 'a dog with nothing learned adds nothing');
});

await t('export, wipe, restore: everything comes back as it was, and nothing else moves', () => {
  const { db, backend } = seasonPhone();
  const text = db.exportAll();
  const before = { h: db.handlers.all(), d: db.dogs.all(), l: db.layers.all(), s: db.sessions(), c: db.calibration('bo') };
  db.wipeAll();
  db.draft.save({ recording: 'the walk in progress' });
  const heard = [];
  db.onChange((table, rec) => heard.push(`${table}/${rec.id}`));
  const file = readBackup(text);
  const plan = db.restore(file);
  assert.deepEqual(db.handlers.all(), before.h);
  assert.deepEqual(db.dogs.all(), before.d);
  assert.deepEqual(db.layers.all(), before.l);
  assert.deepEqual(db.sessions(), before.s, 'sessions to the last point, newest first');
  assert.deepEqual(db.calibration('bo'), before.c, 'and what Bo taught the model');
  assert.equal(db.dogDrift('bo') != null, true, 'so the drift fit is back too');
  assert.deepEqual(db.draft.read(), { recording: 'the walk in progress' }, 'the recording in progress is never touched');
  assert.ok(!backend._dump().has('tc.kv') || !('ownerUid' in JSON.parse(backend.getItem('tc.kv'))), 'a restore does not claim an account');
  /* Announced like any save, so a signed-in phone backs every one up. */
  assert.deepEqual(heard.sort(), ['calibration/bo', 'dogs/bo', 'handlers/remi', 'layers/soph', 'sessions/s1', 'sessions/s2']);
  assert.equal(plan.tables.sessions.added, 2);
});

await t('a restore only adds: the phone’s own records, and newer copies of them, stay', () => {
  const { db } = seasonPhone();
  const file = readBackup(db.exportAll());
  const other = createStore(fakeBackend());
  other.handlers.upsert({ id: 'anna', name: 'Anna', photo: null });
  other.addSession({ id: 'mine', handlerId: 'anna', startedAt: NOW, summary: 'Only here', data: {} });
  /* The same session, changed here after the backup was made. */
  other.addSession({ ...file.sessions.find(s => s.id === 's2'), summary: 'Renamed here' });
  const heard = [];
  other.onChange((table, rec) => heard.push(`${table}/${rec.id}`));
  other.restore(file);
  assert.ok(other.sessions().some(s => s.id === 'mine'), 'nothing on the phone is deleted');
  assert.ok(other.handlers.byId('anna'));
  assert.equal(other.sessions().find(s => s.id === 's2').summary, 'Renamed here', 'the newer copy on the phone wins');
  assert.equal(other.sessions().find(s => s.id === 's1').summary, 'Bo ran it.');
  assert.ok(!heard.includes('sessions/s2') && !heard.includes('sessions/mine'), 'what did not change is not sent again');

  /* A second restore of the same file changes nothing at all. */
  const again = other.previewRestore(file);
  assert.equal(restoreChanges(again), false);
});

await t('newest wins by id, a tie keeps the phone’s copy, and a later delete here stays deleted', () => {
  const phone = {
    handlers: [], dogs: [], layers: [],
    sessions: [
      { id: 'a', summary: 'phone', updatedAt: 100, data: {} },
      { id: 'b', summary: 'phone', updatedAt: 200, data: {} },
      { id: 'c', summary: 'phone', updatedAt: 300, data: {} },
      { id: 'd', deleted: true, updatedAt: 500 },
      { id: 'e', deleted: true, updatedAt: 50 },
    ],
    calibration: [],
  };
  const file = { damaged: {}, handlers: [], dogs: [], layers: [], calibration: [], sessions: [
    { id: 'a', summary: 'file', updatedAt: 150, data: {} },
    { id: 'b', summary: 'file', updatedAt: 200, data: {} },
    { id: 'c', summary: 'file', updatedAt: 250, data: {} },
    { id: 'd', summary: 'file', updatedAt: 400, data: {} },
    { id: 'e', summary: 'file', updatedAt: 60, data: {} },
    { id: 'f', summary: 'file', updatedAt: 60, data: {} },
  ] };
  const plan = planRestore(phone, file);
  const by = Object.fromEntries(plan.tables.sessions.rows.map(r => [r.id, r]));
  assert.equal(by.a.summary, 'file', 'the file’s copy is newer');
  assert.equal(by.b.summary, 'phone', 'a tie keeps what is here');
  assert.equal(by.c.summary, 'phone', 'the phone’s copy is newer');
  assert.equal(by.d.deleted, true, 'deleted here after the backup: it stays deleted');
  assert.equal(by.e.summary, 'file', 'deleted here before the backup was made: it comes back');
  assert.equal(by.f.summary, 'file');
  assert.deepEqual(plan.tables.sessions.changed.map(r => r.id).sort(), ['a', 'e', 'f']);
  assert.equal(plan.tables.sessions.added, 2);
  assert.equal(plan.tables.sessions.updated, 1);
  assert.equal(plan.tables.sessions.stayDeleted, 1);
});

await t('a session keeps a field only one copy has, as syncing does', () => {
  const phone = { handlers: [], dogs: [], layers: [], calibration: [],
    sessions: [{ id: 's', name: 'Renamed', updatedAt: 300, data: { trail } }] };
  const file = { damaged: {}, handlers: [], dogs: [], layers: [], calibration: [],
    sessions: [{ id: 's', updatedAt: 200, data: { trail, track: trail, result: { kind: 'trail' } } }] };
  const plan = planRestore(phone, file);
  const s = plan.tables.sessions.rows[0];
  assert.equal(s.name, 'Renamed');
  assert.deepEqual(s.data.track, trail, 'the run in the backup is not thrown away');
  assert.ok(s.updatedAt > 300, 'stamped newer than both, so it goes up');
  assert.equal(plan.tables.sessions.updated, 1);
});

await t('calibration is a union, and only for dogs the phone will have', () => {
  const phone = { handlers: [], layers: [], sessions: [],
    dogs: [{ id: 'bo', name: 'Bo', updatedAt: 10 }],
    calibration: [{ id: 'bo', rows: [calRow(0), calRow(1)] }] };
  const file = { damaged: {}, handlers: [], layers: [], sessions: [],
    dogs: [{ id: 'nell', name: 'Nell', updatedAt: 10 }],
    calibration: [{ id: 'bo', rows: [calRow(1), calRow(2)] }, { id: 'nell', rows: [calRow(3)] }, { id: 'ghost', rows: [calRow(4)] }] };
  const plan = planRestore(phone, file);
  const by = Object.fromEntries(plan.calibration.map(c => [c.id, c.rows]));
  assert.deepEqual(by.bo.map(r => r.t), [calRow(0).t, calRow(1).t, calRow(2).t], 'every graded run once, oldest first');
  assert.deepEqual(by.nell.map(r => r.t), [calRow(3).t]);
  assert.ok(!('ghost' in by), 'no dog, no rows');
  assert.equal(plan.learned, 2);
});

await t('the question says what it adds, what it updates, what it leaves, and that nothing goes', () => {
  const q = restoreQuestion({
    tables: {
      sessions: { added: 12, updated: 3, stayDeleted: 1, changed: [1] },
      dogs: { added: 2, updated: 0, stayDeleted: 0, changed: [1] },
      handlers: { added: 1, updated: 0, stayDeleted: 0, changed: [1] },
      layers: { added: 0, updated: 0, stayDeleted: 0, changed: [] },
    },
    calibration: [{}], learned: 1, damaged: { sessions: 2, dogs: 0, handlers: 0, layers: 0 },
  }, '20 September 2026');
  assert.equal(q, 'Restore the backup from 20 September 2026? It adds 12 sessions, 2 dogs and 1 handler and brings 3 sessions up to date.'
    + ' It also brings back what the app learned about 1 dog. 1 session deleted on this phone since then stays deleted.'
    + ' 2 sessions in the file are damaged and left out. Nothing on this phone is deleted.');
  assert.ok(!/[—–]/.test(q), 'no dashes');
  const onlyLearned = restoreQuestion({
    tables: Object.fromEntries(['sessions', 'dogs', 'handlers', 'layers'].map(n => [n, { added: 0, updated: 0, stayDeleted: 0, changed: [] }])),
    calibration: [{}, {}], learned: 2, damaged: {},
  });
  assert.equal(onlyLearned, 'Restore the backup? It brings back what the app learned about 2 dogs. Nothing on this phone is deleted.');
});

await t('a file from before this (version 2, no calibration) still restores', () => {
  const v2 = JSON.stringify({ version: 2, exportedAt: '2026-09-01T10:00:00.000Z',
    handlers: [{ id: 'remi', name: 'Rémi', photo: null, updatedAt: NOW - 1e6 }], dogs: [], layers: [],
    sessions: [{ id: 's1', handlerId: 'remi', startedAt: NOW - 1e6, summary: 'x', data: { trail }, updatedAt: NOW - 1e6 }] }, null, 2);
  const file = readBackup(v2, { now: NOW });
  assert.equal(file.version, 2);
  assert.equal(file.exportedAt, Date.UTC(2026, 8, 1, 10));
  assert.equal(file.sessions.length, 1);
  assert.deepEqual(file.calibration, []);
});

/* ── Hostile files ───────────────────────────────────────────────── */

const refused = (text, re) => assert.throws(() => readBackup(text, { now: NOW }), (e) => e.plain === true && re.test(e.message));
const wrap = (o) => JSON.stringify({ app: 'trailcraft', version: 3, exportedAt: new Date(NOW).toISOString(),
  handlers: [], dogs: [], layers: [], sessions: [], calibration: [], ...o });

await t('a file that is not a Trailcraft backup is refused in words, before anything is shown', () => {
  refused('', /not a Trailcraft backup/);
  refused('not json at all', /not a Trailcraft backup/);
  refused('[1,2,3]', /not a Trailcraft backup/);
  refused('{"version":3,"handlers":[]}', /not a Trailcraft backup/, 'a version 3 file names the app');
  refused('{"name":"package","version":"1.0.0"}', /not a Trailcraft backup/);
  refused(wrap({ version: 4 }), /newer Trailcraft/);
  refused(wrap({ sessions: 'lots' }), /damaged/);
  refused(wrap({ calibration: {} }), /damaged/);
  refused(wrap({ sessions: Array.from({ length: 20001 }, () => null) }), /too big/);
  refused(' '.repeat(64 * 1024 * 1024 + 1), /too big/);
  refused('['.repeat(100000) + ']'.repeat(100000), /not a Trailcraft backup/);
});

await t('no key in a file reaches an object’s prototype, and no id is one', () => {
  const text = wrap({
    handlers: [
      JSON.parse('{"id":"remi","name":"Rémi","__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}'),
      { id: '__proto__', name: 'x' }, { id: 'toString', name: 'x' }, { id: 'hasOwnProperty', name: 'x' },
      { id: '__weird__', name: 'x' }, { id: 'a"b', name: 'x' }, { id: 'a/b', name: 'x' }, { id: 'x'.repeat(65), name: 'x' },
      { id: 42, name: 'x' },
    ],
    sessions: [JSON.parse(`{"id":"s","startedAt":${NOW},"data":{"__proto__":{"polluted":true},"trail":${JSON.stringify(trail)},"result":{"kind":"trail","__proto__":{"polluted":true}}}}`)],
  });
  const file = readBackup(text, { now: NOW });
  assert.equal({}.polluted, undefined, 'Object.prototype is untouched');
  assert.deepEqual(file.handlers.map(h => h.id), ['remi']);
  assert.equal(file.damaged.handlers, 8, 'every bad id is left out and counted');
  const h = file.handlers[0];
  assert.equal(Object.getPrototypeOf(h), Object.prototype);
  assert.ok(!Object.prototype.hasOwnProperty.call(h, '__proto__') && !Object.prototype.hasOwnProperty.call(h, 'constructor'));
  const s = file.sessions[0];
  assert.equal(Object.getPrototypeOf(s.data), Object.prototype);
  assert.equal(Object.getPrototypeOf(s.data.result), Object.prototype);
  assert.equal(s.data.polluted, undefined);
  /* And merging it the way syncing does (withMissing assigns key by key)
     cannot set a prototype either. */
  const plan = planRestore({ handlers: [], dogs: [], layers: [], calibration: [],
    sessions: [{ id: 's', updatedAt: 1e13, data: {} }] }, file);
  assert.equal(Object.getPrototypeOf(plan.tables.sessions.rows[0].data), Object.prototype);
  assert.equal({}.polluted, undefined);
});

await t('rows of the wrong shape are left out and counted, and the rest still restore', () => {
  const good = { id: 'ok', startedAt: NOW, summary: 'fine', data: { trail } };
  const bad = [
    { id: 's1', startedAt: NOW, data: 'text' },
    { id: 's2', startedAt: NOW, data: { trail: [{ lat: 95, lon: 0 }] } },
    { id: 's3', startedAt: NOW, data: { track: [{ lat: '51', lon: -2 }] } },
    { id: 's4', startedAt: NOW, data: { trail: 'a line' } },
    { id: 's5', startedAt: NOW, data: { contamination: [{ points: [null] }] } },
    { id: 's6', startedAt: NOW, data: { result: 'Bo ran it' } },
    { id: 's7', startedAt: 1e20, data: {} },
    { id: 's8', startedAt: NOW, dogId: 'x y', data: {} },
    { id: 's9', startedAt: NOW, summary: 42, data: {} },
    { id: 's10', startedAt: NOW, data: { deep: JSON.parse('['.repeat(40) + ']'.repeat(40)) } },
    { id: 's11', startedAt: NOW, data: { note: 'x'.repeat(2_000_001) } },
    'not a row', null,
  ];
  const file = readBackup(wrap({
    sessions: [good, ...bad, { id: 'gone', deleted: true, updatedAt: NOW }],
    dogs: [{ id: 'd1', name: 7 }, { id: 'd2', name: 'Bo', handlerId: 'h h' }, { id: 'd3', name: 'Nell', lineM: '10' }, { id: 'd4', name: 'Rex', level: 'Hot', lineM: 10 }],
  }), { now: NOW });
  assert.deepEqual(file.sessions.map(s => s.id), ['ok']);
  assert.equal(file.damaged.sessions, bad.length, 'every damaged session is counted');
  assert.deepEqual(file.dogs.map(d => d.id), ['d4']);
  assert.equal(file.damaged.dogs, 3);
});

await t('what a screen trusts is made safe rather than kept', () => {
  const file = readBackup(wrap({
    handlers: [{ id: 'h', name: 'Rémi', photo: 'x" onerror="alert(1)', updatedAt: NOW * 1000 }],
    sessions: [{ id: 's', startedAt: NOW, data: { trail: trail.map((p, i) => (i === 3 ? { ...p, t: 1e20 } : p)) },
      baseAt: 5, syncedAt: 6, updatedAt: 'yesterday' }],
    calibration: [{ id: 'bo', rows: [{ t: NOW, k: 1.2, mean: 3, predSide: 7, stability: { a: 1 }, extra: 'x' }, { t: 'x' }] }],
  }), { now: NOW });
  assert.equal(file.handlers[0].photo, null, 'only a photo the app itself would draw');
  assert.equal(file.handlers[0].updatedAt, NOW, 'a clock in the future is brought back to now, or it would beat every later edit');
  const s = file.sessions[0];
  assert.ok(s.data.trail.every(p => !('t' in p)), 'one impossible time and the line’s clock goes');
  assert.ok(s.data.trail.every(p => Number.isFinite(p.lat)), 'the line itself stays');
  assert.ok(!('baseAt' in s) && !('syncedAt' in s), 'the cloud’s bookkeeping never lands on the phone');
  assert.equal(s.updatedAt, 1, 'a missing clock counts as the oldest, as syncing does');
  assert.deepEqual(file.calibration, [{ id: 'bo', rows: [{ t: NOW, predSide: null, mean: 3, wind: null, k: 1.2, stability: null }] }]);
});

await t('a phone without room for the backup is left as it was, and says so', () => {
  const { db } = seasonPhone();
  const file = readBackup(db.exportAll());
  /* A phone that refuses the one big write: the sessions. */
  const backend = fakeBackend();
  const full = createStore({ ...backend, setItem(k, v) {
    if (k === 'tc.sessions2') throw Object.assign(new Error('full'), { name: 'QuotaExceededError' });
    backend.setItem(k, v);
  } });
  full.draft.save({ recording: 'kept' });
  const heard = [];
  full.onChange((table, rec) => heard.push(`${table}/${rec.id}`));
  assert.throws(() => full.restore(file), (e) => e instanceof SaveError && e.full && e.restored === false);
  assert.equal(full.handlers.all().length, 0, 'nothing else was written first');
  assert.deepEqual(heard, [], 'and nothing was announced');
  assert.deepEqual(full.draft.read(), { recording: 'kept' });

  /* One that runs out part-way says so too. */
  const b2 = fakeBackend();
  const part = createStore({ ...b2, setItem(k, v) {
    if (k === 'tc.layers') throw Object.assign(new Error('full'), { name: 'QuotaExceededError' });
    b2.setItem(k, v);
  } });
  assert.throws(() => part.restore(file), (e) => e instanceof SaveError && e.restored === true);
  assert.equal(part.sessions().length, 2, 'what fitted is kept');
});

console.log(`\n${pass} passed total\n`);
