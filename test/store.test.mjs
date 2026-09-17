import assert from 'node:assert/strict';
import { createStore, migrateV1, TARGETS, targetById, verbs, uid,
         dogStats, ageBand, AGE_BANDS, dogAge, SaveError } from '../public/store.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log(`  ok  ${name}`); };

/** localStorage with none of the browser: what the store actually needs. */
const fakeBackend = () => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    _dump: () => m,
  };
};

t('targets: person is a trail, everything else is a hide, verbs follow', () => {
  assert.equal(TARGETS.length, 8);
  assert.equal(targetById('person').kind, 'person');
  assert.ok(TARGETS.filter(x => x.kind === 'hide').length === 7);
  assert.equal(targetById('nonsense').id, 'person', 'unknown id falls back to person');
  assert.equal(verbs(targetById('person')).lay, 'Lay a trail');
  assert.equal(verbs(targetById('narcotics')).lay, 'Set a hide');
  assert.equal(verbs(targetById('narcotics')).run, 'Search');
  assert.equal(verbs(targetById('article')).setter, 'Who sets the hide');
});

t('profiles: handlers own dogs, layers are shared, deletes cascade', () => {
  const db = createStore(fakeBackend());
  const h1 = db.handlers.upsert({ id: uid(), name: 'Rémi', photo: null });
  const h2 = db.handlers.upsert({ id: uid(), name: 'Anna', photo: null });
  db.dogs.upsert({ id: 'bo', handlerId: h1.id, name: 'Bo', photo: null, level: 'Hot', lineM: 10 });
  db.dogs.upsert({ id: 'nell', handlerId: h2.id, name: 'Nell', photo: null, level: 'Warm', lineM: 8 });
  db.layers.upsert({ id: 'soph', name: 'Sophie', photo: null });

  assert.equal(db.handlers.all().length, 2);
  db.deleteHandler(h2.id);
  assert.equal(db.handlers.all().length, 1);
  assert.equal(db.dogs.all().length, 1, "a deleted handler's dogs go with them");
  assert.equal(db.layers.all().length, 1, 'layers survive — they are shared');

  db.dogs.upsert({ ...db.dogs.byId('bo'), lineM: 12 });
  assert.equal(db.dogs.byId('bo').lineM, 12, 'upsert replaces, never duplicates');
  assert.equal(db.dogs.all().length, 1);
});

t('snapshot: remembered choices resolve, stale ids heal to real rows', () => {
  const db = createStore(fakeBackend());
  const h = db.handlers.upsert({ id: 'h1', name: 'Rémi', photo: null });
  db.dogs.upsert({ id: 'bo', handlerId: 'h1', name: 'Bo', photo: null, level: 'Hot', lineM: 10 });
  db.kv.set('lastHandlerId', 'gone');       // a deleted handler
  db.kv.set('lastDogId', 'gone-too');
  db.kv.set('lastTargetId', 'narcotics');

  const s = db.snapshot();
  assert.equal(s.handler.id, h.id, 'stale handler id falls back to the first real one');
  assert.equal(s.dog.id, 'bo', 'stale dog id falls back to the team');
  assert.equal(s.target.id, 'narcotics', 'target choice is remembered');
  assert.equal(s.layer, null, 'no layer means Just me, single phone');
  assert.equal(s.tutorialDone, false);
});

t('sessions: newest first, update patches in place, delete removes', () => {
  const db = createStore(fakeBackend());
  db.addSession({ id: 'a', startedAt: 1, summary: 'first', data: {} });
  db.addSession({ id: 'b', startedAt: 2, summary: 'second', data: {} });
  assert.deepEqual(db.sessions().map(s => s.id), ['b', 'a']);
  db.updateSession('a', { summary: 'patched' });
  assert.equal(db.sessions().find(s => s.id === 'a').summary, 'patched');
  assert.equal(db.updateSession('ghost', {}), null, 'patching a ghost is a null, not a crash');
  db.deleteSession('b');
  assert.deepEqual(db.sessions().map(s => s.id), ['a']);
});

t('export and wipe: everything out, then everything gone', () => {
  const db = createStore(fakeBackend());
  db.handlers.upsert({ id: 'h', name: 'Rémi', photo: null });
  db.addSession({ id: 's', startedAt: 1, summary: 'x', data: {} });
  const out = JSON.parse(db.exportAll());
  assert.equal(out.version, 2);
  assert.equal(out.handlers.length, 1);
  assert.equal(out.sessions.length, 1);
  db.wipeAll();
  assert.equal(db.handlers.all().length, 0);
  assert.equal(db.sessions().length, 0);
});

t('migration: the field phone keeps its team and its trails', () => {
  const backend = fakeBackend();
  // What a real pre-redesign phone carries.
  backend.setItem('tc.team', JSON.stringify({
    handler: { name: 'Rémi', photo: null },
    dogs: [{ id: 'd1', name: 'Bo', level: 'hot', photo: null },
           { id: 'd2', name: 'Nell', level: 'warm', photo: null }],
    lastDog: 'd2',
  }));
  const pts = [{ lat: 51.2094, lon: -2.6449, t: 1000 }, { lat: 51.2103, lon: -2.6449, t: 2000 }];
  backend.setItem('tc.sessions', JSON.stringify([
    { id: 'r2', mode: 'runner', started: 2000, ended: 3000, points: pts, waypoints: [] },
    { id: 'g1', mode: 'dog', dog: 'Bo', dogId: 'd1', linkTo: 'r1', started: 1500,
      ended: 1600, points: pts, waypoints: [], klass: 'hot' },
    { id: 'r1', mode: 'runner', started: 1000, ended: 1100, points: pts, waypoints: [] },
  ]));

  const db = createStore(backend);
  const moved = migrateV1(backend, db);
  assert.ok(moved >= 3, `migrated ${moved} things`);

  const s = db.snapshot();
  assert.equal(s.handler.name, 'Rémi');
  assert.equal(s.team.length, 2);
  assert.equal(s.team.find(d => d.id === 'd1').level, 'Hot', 'levels carry over, capitalised');
  assert.equal(s.dog.id, 'd2', 'the remembered dog is still the remembered dog');

  const sess = db.sessions();
  assert.deepEqual(sess.map(x => x.id), ['r2', 'r1'], 'newest first, dog runs folded in');
  const withRun = sess.find(x => x.id === 'r1');
  assert.equal(withRun.dogId, 'd1', 'the run attributed its dog');
  assert.ok(withRun.data.track, 'and its track rode along');
  assert.ok(withRun.summary.includes('Bo'), 'the one-line story names the dog');

  assert.equal(migrateV1(backend, db), 0, 'running it again moves nothing');
});


t('calibration: silent under five runs, then the median speaks, clamped', () => {
  const db = createStore(fakeBackend());
  const row = (k) => ({ t: 1, predSide: 1, mean: 8, wind: 4, stability: 'Stable', k });
  for (const k of [2.1, 1.9, 2.4]) db.addCalibration('bo', row(k));
  assert.equal(db.dogDrift('bo'), null, 'three runs are not evidence');
  db.addCalibration('bo', row(2.0));
  db.addCalibration('bo', row(55));            // one absurd gusty outlier
  const d = db.dogDrift('bo');
  assert.ok(d >= 1.9 && d <= 2.4, `median shrugs off the outlier (${d})`);
  db.addCalibration('bo', row(null));          // an ungradeable run banks nothing usable
  assert.ok(db.dogDrift('bo') != null, 'null k rows are kept but never counted');
  assert.equal(db.dogDrift('nell'), null, 'another dog starts from zero');
  assert.equal(db.calibration('bo').length, 6, 'rows are all retained');
});

t('ageBand: the words the sport uses, with the boundaries stated', () => {
  assert.equal(ageBand(5).key, 'hot');
  assert.equal(ageBand(29).key, 'hot');
  assert.equal(ageBand(30).key, 'warm', '30 minutes is where hot ends');
  assert.equal(ageBand(119).key, 'warm');
  assert.equal(ageBand(120).key, 'cold', 'two hours in is cold work');
  assert.equal(ageBand(600).key, 'cold');
  assert.equal(ageBand(null), null, 'an ungraded run is not quietly filed as hot');
  assert.equal(ageBand(-5), null);
  assert.equal(AGE_BANDS.length, 3);
});

t('dogStats: counts the work, and only the work the dog actually did', () => {
  const t0 = Date.parse('2026-08-01T09:00:00Z');
  const leg = (n, dLat) => Array.from({ length: n }, (_, i) => ({
    lat: 51.2 + i * dLat, lon: -2.64, t: t0 + i * 1000,
  }));
  // ~100 m and ~300 m of dog track.
  const short = leg(11, 0.00009), long = leg(31, 0.00009);

  const sessions = [
    { id: 'e', dogId: 'bo', targetId: 'person', startedAt: t0 + 5e6,
      data: { track: long, trackStarted: t0 + 5e6, result: { ageMin: 240, mean: -6, sideAgreement: 0.5 } } },
    { id: 'd', dogId: 'bo', targetId: 'narcotics', startedAt: t0 + 4e6,
      data: { track: short, trackStarted: t0 + 4e6, result: { ageMin: 45, mean: 4 } } },
    { id: 'c', dogId: 'bo', targetId: 'person', startedAt: t0 + 3e6,
      data: { track: short, trackStarted: t0 + 3e6, result: { ageMin: 10, mean: 8, sideAgreement: 1 } } },
    // Laid but never run: says nothing about the dog.
    { id: 'b', dogId: null, targetId: 'person', startedAt: t0 + 2e6, data: { trail: long } },
    // Another dog's run.
    { id: 'a', dogId: 'nell', targetId: 'person', startedAt: t0 + 1e6,
      data: { track: long, trackStarted: t0 + 1e6, result: { ageMin: 20, mean: 3 } } },
  ];

  const st = dogStats('bo', sessions, [{ k: 2.1 }, { k: 1.8 }, { k: null }]);
  assert.equal(st.runs, 3, 'only Bo\u2019s worked trails');
  assert.ok(st.metres > 480 && st.metres < 520, `total distance ${st.metres.toFixed(0)} m`);
  assert.ok(st.longest > 260 && st.longest < 320, `longest ${st.longest.toFixed(0)} m`);
  assert.equal(st.firstAt, t0 + 3e6, 'the first trail is the earliest RUN');
  assert.equal(st.lastAt, t0 + 5e6);
  assert.deepEqual(st.bands, { hot: 1, warm: 1, cold: 1 });
  assert.equal(st.targets.person, 2);
  assert.equal(st.targets.narcotics, 1);
  assert.equal(st.graded, 3);
  assert.ok(Math.abs(st.meanOffset - 6) < 0.01, 'mean offset is the average SIZE, not the average side');
  assert.ok(Math.abs(st.sideAgree - 0.75) < 0.01);
  assert.equal(st.calRows, 2, 'null-k calibration rows are kept but not counted');

  // A dog that has never run reads as zero, not as broken.
  const none = dogStats('ghost', sessions);
  assert.equal(none.runs, 0);
  assert.equal(none.metres, 0);
  assert.equal(none.firstAt, null);
  assert.equal(none.meanOffset, null);
  assert.deepEqual(none.bands, { hot: 0, warm: 0, cold: 0 });
  assert.deepEqual(dogStats('bo', null).bands, { hot: 0, warm: 0, cold: 0 });
});

t('dogStats: a run graded without an age is counted, never mis-filed', () => {
  const t0 = Date.parse('2026-08-01T09:00:00Z');
  const track = [{ lat: 51.2, lon: -2.64, t: t0 }, { lat: 51.2009, lon: -2.64, t: t0 + 60000 }];
  const st = dogStats('bo', [
    { id: '1', dogId: 'bo', targetId: 'person', startedAt: t0, data: { track, result: { mean: 5 } } },
  ]);
  assert.equal(st.runs, 1);
  assert.equal(st.unknownAge, 1, 'it shows up as unknown rather than joining a band it is not in');
  assert.deepEqual(st.bands, { hot: 0, warm: 0, cold: 0 });
});

t('dogAge: counted from a birthday, so it is never stale', () => {
  const on = (y, m, d) => Date.UTC(y, m - 1, d, 12);
  const now = on(2026, 9, 15);
  assert.equal(dogAge(on(2023, 9, 15), now).text, '3 yr');
  assert.equal(dogAge(on(2023, 5, 15), now).text, '3 yr 4 mo');
  assert.equal(dogAge(on(2026, 3, 20), now).text, '5 mo', 'a day short of six months is five');
  assert.equal(dogAge(on(2026, 9, 1), now).text, 'under a month');
  assert.equal(dogAge(on(2023, 5, 15), now).totalMonths, 40);

  // Nothing to show beats something wrong.
  assert.equal(dogAge(null, now), null);
  assert.equal(dogAge(undefined, now), null);
  assert.equal(dogAge(on(2027, 1, 1), now), null, 'a birthday in the future is not an age');
});

t('store: every change is announced, and a deletion leaves a tombstone', () => {
  const db = createStore(fakeBackend());
  const heard = [];
  const stop = db.onChange((table, rec) => heard.push([table, rec.id, !!rec.deleted]));

  const bo = db.dogs.upsert({ id: 'bo', handlerId: 'h', name: 'Bo', level: 'Hot', lineM: 10 });
  assert.ok(Number.isFinite(bo.updatedAt), 'a saved row carries the moment it was saved');
  db.addSession({ id: 's1', startedAt: 1, summary: 'x', data: {} });
  db.updateSession('s1', { summary: 'y' });
  db.deleteSession('s1');
  db.dogs.remove('bo');

  assert.deepEqual(heard, [
    ['dogs', 'bo', false], ['sessions', 's1', false], ['sessions', 's1', false],
    ['sessions', 's1', true], ['dogs', 'bo', true],
  ]);

  // The app sees nothing deleted; the sync layer still sees the tombstone.
  assert.equal(db.dogs.all().length, 0);
  assert.equal(db.dogs.byId('bo'), null);
  assert.equal(db.dogs.raw().filter(r => r.deleted).length, 1);
  assert.equal(db.sessions().length, 0);
  assert.equal(db.rawSessions()[0].deleted, true);
  assert.equal(db.updateSession('s1', { summary: 'z' }), null, 'a deleted session cannot be edited back to life');

  stop();
  db.dogs.upsert({ id: 'nell', handlerId: 'h', name: 'Nell' });
  assert.equal(heard.length, 5, 'unsubscribing actually stops the calls');
});

/** A phone with a ceiling: setItem refuses once the total would pass it,
    exactly as Safari does at about five megabytes. */
const fullBackend = (limitChars) => {
  const m = new Map();
  const total = () => [...m.entries()].reduce((n, [k, v]) => n + k.length + v.length, 0);
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => {
      const next = total() - (m.has(k) ? k.length + m.get(k).length : 0) + k.length + String(v).length;
      if (next > limitChars) throw new DOMException('quota', 'QuotaExceededError');
      m.set(k, String(v));
    },
    removeItem: (k) => m.delete(k),
  };
};

t('a full phone throws a SaveError that says so, and loses nothing already saved', () => {
  const db = createStore(fullBackend(2500));
  const big = (id) => ({ id, startedAt: 1, targetId: 'person', data: { trail: Array.from({ length: 40 }, (_, i) => ({ lat: 51 + i / 1e4, lon: -2, t: i })) } });
  db.addSession(big('a'));
  const before = db.usage().bytes;
  assert.ok(before > 0);
  assert.throws(() => db.addSession(big('b')), (e) => e instanceof SaveError && e.name === 'SaveError' && e.full === true && /no room/.test(e.message));
  assert.deepEqual(db.sessions().map(s => s.id), ['a'], 'the first session is untouched');
  assert.equal(db.usage().bytes, before, 'nothing half-written');
  db.deleteSession('a');
  db.addSession(big('b'));
  assert.deepEqual(db.sessions().map(s => s.id), ['b'], 'room freed, the save goes through');
});

t('any other failure to save is still a SaveError, not silence', () => {
  const backend = { getItem: () => null, setItem: () => { throw new Error('disk on fire'); }, removeItem: () => {} };
  const db = createStore(backend);
  assert.throws(() => db.kv.set('x', 1), (e) => e.name === 'SaveError' && e.full === false);
});

console.log(`\n${pass} passed total\n`);
