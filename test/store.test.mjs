import assert from 'node:assert/strict';
import { handlerStats, ODOURS, targetText, teachesDrift, runAgeMin, driftRows } from '../public/store.js';
import { createStore, migrateV1, TARGETS, targetById, verbs, uid,
         dogStats, ageBand, AGE_BANDS, dogAge, SaveError, patchSession, runAgain,
         askDelete, dogsOf, storageWords, healApproach, healSession, APPROACH_V } from '../public/store.js';
import { mergeCalibration, calibrationDiffers } from '../public/sync-core.js';
import { readBackup } from '../public/backup.js';

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

t('a change to a session keeps whatever it did not mention', () => {
  /* A scanned Trail Card: saved with no weather, the run begins at once, the
     weather lands mid-run, then the run is saved from the copy taken at the
     start. The run's save used to hand back the whole of data and put the
     weather back to null. */
  const db = createStore(fakeBackend());
  const trail = [{ lat: 51, lon: -2.6, t: 1 }, { lat: 51.001, lon: -2.6, t: 2 }];
  db.addSession({ id: 'card', startedAt: 1, summary: 'laid', data: { trail, weather: null, contamination: [] } });
  db.updateSession('card', { data: { weather: { wind_speed: 3 } } });
  db.updateSession('card', { data: { contamination: [{ who: 'Sam' }] } });
  db.updateSession('card', { data: { offAt: 5 } });
  const after = db.updateSession('card', { summary: 'ran', data: { track: trail, result: { sentence: 'ok' } } });
  assert.deepEqual(after.data.weather, { wind_speed: 3 }, 'the weather that landed mid-run is still there');
  assert.deepEqual(after.data.contamination, [{ who: 'Sam' }], 'and the contamination trail');
  assert.equal(after.data.offAt, 5, 'and when the layer went off');
  assert.deepEqual(after.data.trail, trail, 'and the trail itself');
  assert.equal(after.summary, 'ran');
  assert.equal(after.data.result.sentence, 'ok');
  const named = db.updateSession('card', { name: 'Hill' });
  assert.deepEqual(named.data, after.data, 'a change with no data leaves data alone');
  assert.equal(db.updateSession('card', { data: { weather: null } }).data.weather, null, 'null is how a field is cleared');

  const held = { id: 'x', summary: 'a', data: { trail, weather: { wind_speed: 1 } } };
  const laid = patchSession(held, { summary: 'b', data: { track: trail } });
  assert.deepEqual(laid.data, { trail, weather: { wind_speed: 1 }, track: trail }, 'the pure merge is the same one');
  assert.equal(held.data.track, undefined, 'and it changes nothing it was handed');
  assert.deepEqual(patchSession({ id: 'y' }, {}).data, {}, 'no data on either side is empty data');
});

t('running a trail again makes a new session and leaves the first run alone', () => {
  const trail = [{ lat: 51, lon: -2.6, t: 1 }, { lat: 51.001, lon: -2.6, t: 2 }];
  const first = {
    id: 'one', handlerId: 'h', dogId: 'bella', layerId: 'sam', targetId: 'person', odour: null,
    startedAt: 100, name: 'Hill', summary: 'Bella’s track stayed on the line.', updatedAt: 9,
    data: {
      trail, weather: { wind_speed: 3 }, contamination: [{ who: 'Sam' }], surf: 'gg', surfFix: [{ id: 'f' }],
      plan: true, walked: true, planTrail: trail, offAt: 50, imported: { from: 'Jo', at: 20 }, revealedAt: 400,
      track: trail, trackStarted: 300, trackWaypoints: [{ kind: 'Indication', call: 'sure' }],
      result: { sentence: 'Bella ran' }, coach: { tol: 5 }, debrief: { outcome: 'found' }, seen: { at: 1 },
    },
  };
  const before = JSON.stringify(first);
  const again = runAgain(first, { id: 'two', summary: 'Run again, not graded yet.' });
  assert.equal(JSON.stringify(first), before, 'the first run is not touched');
  assert.equal(again.id, 'two');
  assert.equal(again.dogId, null, 'the dog is whoever runs it this time');
  assert.equal(again.summary, 'Run again, not graded yet.');
  assert.equal(again.updatedAt, undefined, 'stamped when it is saved, not copied');
  for (const k of ['handlerId', 'layerId', 'targetId', 'startedAt', 'name']) assert.equal(again[k], first[k], `${k} comes along`);
  for (const k of ['trail', 'weather', 'contamination', 'surf', 'surfFix', 'plan', 'walked', 'planTrail', 'offAt', 'imported', 'revealedAt']) {
    assert.deepEqual(again.data[k], first.data[k], `the trail's ${k} comes along`);
  }
  for (const k of ['track', 'trackStarted', 'trackWaypoints', 'result', 'coach', 'debrief', 'seen']) {
    assert.ok(!(k in again.data), `the first run's ${k} does not`);
  }
  assert.equal(again.data.planOf, 'one', 'a second run of a plan remembers the plan, so its walked card finds it');
  assert.equal(runAgain(again, { id: 'three', summary: '' }).data.planOf, 'one', 'and a third names the same plan');
  assert.equal(runAgain({ ...first, data: { ...first.data, plan: undefined } }, { id: 'x', summary: '' }).data.planOf,
    undefined, 'a trail that was never a plan has no plan to name');

  const db = createStore(fakeBackend());
  db.addSession(first);
  db.addSession(again);
  db.updateSession('two', { dogId: 'rex', data: { track: trail, result: { sentence: 'Rex ran' } } });
  assert.equal(db.sessions().find(s => s.id === 'one').data.result.sentence, 'Bella ran', 'Bella’s run is still Bella’s');
  assert.equal(db.sessions().find(s => s.id === 'one').dogId, 'bella');
  assert.equal(db.sessions().find(s => s.id === 'two').data.result.sentence, 'Rex ran');
});

t('export and wipe: everything out, then everything gone', () => {
  const db = createStore(fakeBackend());
  db.handlers.upsert({ id: 'h', name: 'Rémi', photo: null });
  db.addSession({ id: 's', startedAt: 1, summary: 'x', data: {} });
  const out = JSON.parse(db.exportAll());
  assert.equal(out.version, 3, 'a backup Restore can read (backup.test.mjs)');
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


t('calibration: silent under five runs, then the median speaks', () => {
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

/* The dog card is the only reader, so it is told what the runs said. It used
   to be held between 0.5 and 6: a dog at 0.2 was shown as 0.5, and one at
   20 as 6, a clamp bound passed off as a measurement. */
t('calibration: the dog card gets the median as measured, never a clamp bound', () => {
  const db = createStore(fakeBackend());
  const row = (k) => ({ t: 1, predSide: 1, mean: 2, wind: 6, stability: 'Stable', k });
  for (const k of [0.2, 0.18, 0.25, 0.21, 0.3]) db.addCalibration('bo', row(k));
  assert.equal(db.dogDrift('bo'), 0.21, 'a dog that barely drifts is not printed as 0.5');
  for (const k of [20, 18, 25, 21, 30]) db.addCalibration('rex', row(k));
  assert.equal(db.dogDrift('rex'), 21, 'nor one that drifts a long way as 6');
});

/* A coached run, a revealed one and a drawn plan were all banked as the dog's
   natural drift. The coach tells the handler "left, 12 m" and the dog is
   brought back; the stored figure came out smaller than the dog's own. */
t('teachesDrift: only a run nothing was steering banks towards the dog’s drift', () => {
  assert.equal(teachesDrift({ track: [] }), true, 'coach off, trail never shown, a real line');
  assert.equal(teachesDrift({ coach: { assisted: false } }), true);
  assert.equal(teachesDrift({ coach: { assisted: true } }), false, 'the coach was on');
  assert.equal(teachesDrift({ revealedAt: 5000 }), false, 'the trail was on screen');
  assert.equal(teachesDrift({ revealedAt: 0 }), true, 'nought is never');
  assert.equal(teachesDrift({ plan: true }), false, 'a drawn plan, not yet walked');
  assert.equal(teachesDrift({ plan: true, walked: true }), true, 'the walked card makes the line real');
  assert.equal(teachesDrift({ plan: true, walked: true, revealedAt: 5000 }), false,
    'but it does not undo a reveal');
  assert.equal(teachesDrift(null), false);
});

/* A run the debrief says the handler knew was walked along what they knew,
   and a drawn Trail Card is a sketch just as a plan is. Both banked. */
t('teachesDrift agrees with "blind": a run the handler knew, or a drawn card, teaches nothing', () => {
  assert.equal(teachesDrift({ coach: { assisted: false }, debrief: { outcome: 'found', blind: 'open' } }), false,
    'the handler knew the answer');
  assert.equal(teachesDrift({ debrief: { outcome: 'found', blind: 'handler' } }), true);
  assert.equal(teachesDrift({ drawn: true }), false, 'a drawn card, which carries `drawn`, not `plan`');
  assert.equal(runAgeMin({ data: { drawn: true, result: { ageMin: 35 } } }), null, 'and has no age');
});

/* Six rows of 1 to 6 gave the dog card a drift of 4, the upper of the middle
   two, and always erred high. */
t('calibration: an even number of runs gives the middle of the two middle ones', () => {
  const db = createStore(fakeBackend());
  const row = (k) => ({ t: 1, predSide: 1, mean: 2, wind: 6, stability: 'Stable', k });
  for (const k of [6, 1, 5, 2, 4, 3]) db.addCalibration('bo', row(k));
  assert.equal(db.dogDrift('bo'), 3.5);
  db.addCalibration('bo', row(7));
  assert.equal(db.dogDrift('bo'), 4, 'an odd count is its middle, as before');
});

/* Rows banked before teachesDrift came from coached, revealed and noisy runs,
   and a debrief written after Stop can say the handler knew. They are kept,
   but neither the drift figure nor the card's count reads them. */
t('drift rows whose run would not bank today are not read, and nothing is deleted', () => {
  const db = createStore(fakeBackend());
  const track = [{ lat: 51.2, lon: -2.64, t: 0 }, { lat: 51.2009, lon: -2.64, t: 60000 }];
  const run = (t0, data = {}) => ({ id: `r${t0}`, handlerId: 'h1', dogId: 'bo', targetId: 'person', startedAt: 1,
    data: { track, trackStarted: t0, result: { kind: 'trail', medAbs: 4 }, ...data } });
  const runs = [
    run(1000), run(2000), run(3000), run(4000), run(5000),
    run(6000, { coach: { assisted: true } }),
    run(7000, { revealedAt: 7500 }),
    run(8000, { result: { kind: 'trail', medAbs: 4, noisy: true } }),
    run(9000, { debrief: { outcome: 'found', blind: 'open' } }),
  ];
  for (const r of runs) db.addSession(r);
  const row = (t, k) => ({ t, predSide: 1, mean: 8, wind: 4, stability: 'Stable', k });
  for (const t0 of [1000, 2000, 3000, 4000]) db.addCalibration('bo', row(t0, 2));
  for (const t0 of [6000, 7000, 8000, 9000]) db.addCalibration('bo', row(t0, 20));
  assert.equal(db.dogDrift('bo'), null, 'four good rows are not five: the steered ones do not make up the number');
  db.addCalibration('bo', row(424242, 2));   // its run was deleted: read as it was
  assert.equal(db.dogDrift('bo'), 2, 'the steered rows no longer drag the figure');
  assert.equal(db.calibration('bo').length, 9, 'every row is still stored');
  const st = dogStats('bo', db.sessions(), db.calibration('bo'));
  assert.equal(st.calRows, 5, 'the card counts the rows the figure was worked from');
  assert.equal(driftRows(db.calibration('bo'), []).length, 9, 'with no runs to check, nothing is left out');
});

/* driftRows reads a row's verdict off its run, and a row whose run cannot be
   found is read as it was banked. So deleting a coached, revealed or "I
   knew" run put its row straight back into the dog's figure: five clean runs
   read 3, and deleting the two coached ones made it 4. */
t('deleting a run that would not bank leaves its drift row out, on every phone', () => {
  const db = createStore(fakeBackend());
  const track = [{ lat: 51.2, lon: -2.64, t: 0 }, { lat: 51.2009, lon: -2.64, t: 60000 }];
  const T = Date.UTC(2026, 8, 1);             // in the era a backup file keeps
  const run = (n, data = {}) => ({ id: `r${n}`, handlerId: 'h1', dogId: 'bo', targetId: 'person', startedAt: 1,
    data: { track, trackStarted: T + n, result: { kind: 'trail', medAbs: 4 }, ...data } });
  const row = (n, k) => ({ t: T + n, predSide: 1, mean: 8, wind: 4, stability: 'Stable', k });
  [1, 2, 3, 4, 5].forEach(k => { db.addSession(run(k * 1000)); db.addCalibration('bo', row(k * 1000, k)); });
  db.addSession(run(6000, { coach: { assisted: true } }));
  db.addSession(run(7000, { debrief: { outcome: 'found', target: 'real', blind: 'open' } }));
  db.addCalibration('bo', row(6000, 20));
  db.addCalibration('bo', row(7000, 20));
  assert.equal(db.dogDrift('bo'), 3);
  const heard = [];
  db.onChange((table, rec) => heard.push(`${table}/${rec.id}`));
  db.deleteSession('r6000');
  db.deleteSession('r7000');
  assert.equal(db.dogDrift('bo'), 3, 'the steered rows stay out once their runs are gone');
  assert.equal(db.calibration('bo').length, 7, 'and are still kept');
  assert.equal(dogStats('bo', db.sessions(), db.calibration('bo')).calRows, 5);
  assert.ok(heard.includes('calibration/bo'), 'the set-aside rows go to the cloud like any change');
  db.deleteSession('r1000');
  assert.equal(db.calibration('bo').filter(r => r.skip).length, 2, 'a clean run deleted keeps its row as it was');

  /* The other phone has no run left to judge them by, so the flag travels:
     through the cloud, whichever side has it, and through a backup file. */
  const mine = db.calibration('bo');
  const bare = mine.map(({ skip, ...r }) => r);
  for (const merged of [mergeCalibration(bare, mine), mergeCalibration(mine, bare)]) {
    assert.equal(merged.filter(r => r.skip).length, 2);
  }
  assert.ok(calibrationDiffers(mine, bare), 'a newly set-aside row is sent');
  assert.equal(calibrationDiffers(mine, mine), false);
  db.dogs.upsert({ id: 'bo', handlerId: 'h1', name: 'Bo', photo: null, level: 'Hot', lineM: 10 });
  const back = readBackup(db.exportAll()).calibration.find(c => c.id === 'bo').rows;
  assert.equal(back.filter(r => r.skip).length, 2, 'and a backup file keeps it');
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

t('handlerStats: runs, laid trails, time, age bands, dogs and the typical offset, for one handler only', () => {
  const p = (lat, lon, t) => ({ lat, lon, t });
  const trackA = [p(51.2094, -2.6449, 0), p(51.2103, -2.6449, 60000), p(51.2112, -2.6449, 120000)];     // ~200 m, 2 min
  const trackB = [p(51.2094, -2.6449, 0), p(51.2130, -2.6449, 300000)];                                  // ~400 m, 5 min
  const sessions = [
    { id: 'a', handlerId: 'h1', dogId: 'd1', layerId: 'l1', startedAt: 1000, data: { track: trackA, trail: trackA, result: { ageMin: 5, medAbs: 4 }, coach: { assisted: true } } },
    { id: 'b', handlerId: 'h1', dogId: 'd2', layerId: null, startedAt: 2000, data: { track: trackB, trail: trackB, result: { ageMin: 45, medAbs: 8 }, coach: { assisted: false } } },
    { id: 'c', handlerId: 'h1', dogId: 'd1', layerId: null, startedAt: 3000, data: { trail: trackA } },              // laid, never run
    { id: 'd', handlerId: 'h2', dogId: 'd9', layerId: null, startedAt: 4000, data: { track: trackB, result: { ageMin: 300 } } },
  ];
  const st = handlerStats('h1', sessions);
  assert.equal(st.runs, 2);
  assert.equal(st.laid, 2, 'b and c were walked by the handler themself');
  assert.ok(st.metres > 550 && st.metres < 650, `about 600 m, got ${st.metres}`);
  assert.equal(st.seconds, 420);
  assert.deepEqual(st.bands, { hot: 1, warm: 1, cold: 0 });
  assert.deepEqual(st.dogs, { d1: 1, d2: 1 });
  assert.equal(st.assisted, 1); assert.equal(st.blind, 1);
  assert.equal(st.medOff, 8);
  assert.equal(handlerStats('h2', sessions).bands.cold, 1);
  assert.equal(handlerStats('nobody', sessions).runs, 0);
});

/* The handler card counted every coach-off run as blind, including runs where
   the trail was revealed on screen. They are neither, and are counted apart. */
t('handlerStats: a coach-off run with the trail shown is not a blind run', () => {
  const track = [{ lat: 51.2, lon: -2.64, t: 0 }, { lat: 51.2009, lon: -2.64, t: 60000 }];
  const run = (id, data) => ({ id, handlerId: 'h1', dogId: 'd1', startedAt: 1, data: { track, trackStarted: 1000, ...data } });
  const st = handlerStats('h1', [
    run('a', { coach: { assisted: true }, revealedAt: 2000 }),
    run('b', { coach: { assisted: false } }),
    run('c', { coach: { assisted: false }, revealedAt: 5000 }),
    run('d', { coach: { assisted: false }, revealedAt: 0 }),
  ]);
  assert.equal(st.assisted, 1, 'the coach turning on stamps a reveal too, and it is still an assisted run');
  assert.equal(st.blind, 2, 'never shown, or nought');
  assert.equal(st.shown, 1);
  assert.equal(handlerStats('nobody', []).shown, 0);
});

/* Coach off, nothing revealed, and the debrief says "I knew": the handler
   card counted it blind while the call block said "you knew the answer". */
t('handlerStats: a run the handler knew is not counted blind', () => {
  const track = [{ lat: 51.2, lon: -2.64, t: 0 }, { lat: 51.2009, lon: -2.64, t: 60000 }];
  const run = (id, data) => ({ id, handlerId: 'h1', dogId: 'bo', startedAt: 1, data: { track, coach: { assisted: false }, ...data } });
  const st = handlerStats('h1', [
    run('a', { debrief: { outcome: 'found', blind: 'open' } }),
    run('b', { debrief: { outcome: 'found', blind: 'double' } }),
    run('c', {}),
  ]);
  assert.deepEqual([st.assisted, st.blind, st.shown, st.knew], [0, 2, 0, 1]);
});

/* A drawn plan's laid time is when it was drawn, less a guessed walk. An 800 m
   plan drawn at 10:00, walked 10:05-10:15 and run at 10:25 is a 20-minute
   (Hot) trail, but was graded 35 minutes old and filed Warm. */
t('a run graded against a drawn plan has no age, and joins no band, until it is walked', () => {
  const track = [{ lat: 51.2, lon: -2.64, t: 0 }, { lat: 51.2009, lon: -2.64, t: 60000 }];
  const run = (id, data) => ({ id, handlerId: 'h1', dogId: 'bo', targetId: 'person', startedAt: 1,
    data: { track, result: { ageMin: 35 }, ...data } });
  const drawn = run('a', { plan: true });
  const walked = run('b', { plan: true, walked: true });
  assert.equal(runAgeMin(drawn), null, 'the 35 minutes an older result saved is not believed');
  assert.equal(runAgeMin(walked), 35);
  assert.equal(runAgeMin(run('c', {})), 35);
  for (const st of [dogStats('bo', [drawn, walked]), handlerStats('h1', [drawn, walked])]) {
    assert.deepEqual(st.bands, { hot: 0, warm: 1, cold: 0 }, 'only the walked one is filed');
    assert.equal(st.unwalked, 1, 'the drawn one is counted apart');
    assert.equal(st.unknownAge, 0, 'and not as a run with no weather');
  }
});

t('odours: narcotics and explosives name theirs, each target remembers its own, the record says which', () => {
  for (const id of ['narcotics', 'explosives']) {
    const set = ODOURS[id];
    assert.equal(targetById(id).kind, 'hide');
    assert.ok(set.ask && set.name);
    assert.ok(set.list.length >= 10);
    assert.equal(new Set(set.list).size, set.list.length, 'no odour listed twice');
    for (const o of set.list) assert.ok(o.length <= 40, `${o} fits the typed field`);
  }
  assert.deepEqual(Object.keys(ODOURS), ['narcotics', 'explosives']);

  assert.equal(targetText({ targetId: 'narcotics', odour: 'Cocaine' }), 'Narcotics · Cocaine');
  assert.equal(targetText({ targetId: 'explosives' }), 'Explosives');
  assert.equal(targetText({ targetId: 'other', odour: ' Truffle ' }), 'Truffle');
  assert.equal(targetText({ targetId: 'other', odour: '' }), 'Other');
  assert.equal(targetText({ targetId: 'person', odour: null }), 'A person');
  assert.equal(targetText({}), 'A person');

  const db = createStore(fakeBackend());
  db.handlers.upsert({ id: 'h1', name: 'Rémi', photo: null });
  db.kv.set('odour.narcotics', 'Heroin');
  db.kv.set('odour.other', 'Truffle');
  assert.equal(db.snapshot().odour, '', 'a person has no odour to name');
  db.kv.set('lastTargetId', 'narcotics');
  assert.equal(db.snapshot().odour, 'Heroin');
  db.kv.set('lastTargetId', 'explosives');
  assert.equal(db.snapshot().odour, '');
  db.kv.set('lastTargetId', 'other');
  assert.equal(db.snapshot().odour, 'Truffle');
});

/* ── Deleting ────────────────────────────────────────────────────────
   There was no delete at all, so a full phone could only be wiped. Every
   delete now asks first, and the question has to name exactly what goes. */

t('deleting a session: the question names it and everything that goes with it', () => {
  const run = { id: 's1', targetId: 'person', name: 'Church lane loop', dogId: 'bo',
    data: { trail: [{ lat: 51, lon: -2 }], track: [{ lat: 51, lon: -2 }], debrief: { grade: 'good' } } };
  const q = askDelete('session', { row: run, dog: { id: 'bo', name: 'Bo' }, when: 'Tue 3 Sep, 10:00' });
  assert.match(q, /^Delete “Church lane loop”\?/, 'a named session is asked about by its name');
  assert.match(q, /The laid trail, Bo’s run and the debrief go, and cannot be got back\./);
  assert.doesNotMatch(q, /account backup/, 'nothing about a backup when there is none');

  const laid = { id: 's2', targetId: 'person', data: { trail: [{ lat: 51, lon: -2 }] } };
  assert.equal(askDelete('session', { row: laid, when: 'Tue 3 Sep, 10:00' }),
    'Delete this trail from Tue 3 Sep, 10:00? The laid trail goes, and cannot be got back.',
    'an unnamed one is asked about by its date, and a trail never run loses only the trail');

  const hides = { id: 's3', targetId: 'narcotics', dogId: 'gone', data: { hides: [{ lat: 51, lon: -2 }], track: [{ lat: 51, lon: -2 }] } };
  const hq = askDelete('session', { row: hides, dog: null, when: 'Wed 4 Sep, 09:00', backedUp: true });
  assert.match(hq, /^Delete this search from Wed 4 Sep, 09:00\? The hides and the dog’s search go/,
    'a hide set is a search, and a dog since deleted is still "the dog"');
  assert.match(hq, /It goes from your account backup too\.$/, 'signed in, the question says the backup copy goes as well');
});

t('deleting a dog: its profile goes, its sessions stay, and the question says both', () => {
  const bo = { id: 'bo', handlerId: 'h1', name: 'Bo' };
  const sessions = [{ id: 'a', dogId: 'bo' }, { id: 'b', dogId: 'bo' }, { id: 'c', dogId: 'nell' }];
  assert.equal(askDelete('dog', { row: bo, sessions }),
    'Delete Bo? Bo’s profile goes, and cannot be got back. Bo’s 2 sessions stay in the session list.');
  assert.equal(askDelete('dog', { row: bo, sessions: sessions.slice(0, 1), learned: true, backedUp: true }),
    'Delete Bo? Bo’s profile and what the app has learned about Bo go, and cannot be got back. '
    + 'It goes from your account backup too. Bo’s session stays in the session list.');
  assert.equal(askDelete('dog', { row: bo, sessions: [] }), 'Delete Bo? Bo’s profile goes, and cannot be got back.');
});

t('deleting a handler takes their dogs, and the question names every dog that goes', () => {
  const db = createStore(fakeBackend());
  db.handlers.upsert({ id: 'h1', name: 'Rémi' });
  db.handlers.upsert({ id: 'h2', name: 'Anna' });
  db.dogs.upsert({ id: 'bo', handlerId: 'h1', name: 'Bo' });
  db.dogs.upsert({ id: 'tess', handlerId: 'h1', name: 'Tess' });
  db.dogs.upsert({ id: 'nell', handlerId: 'h2', name: 'Nell' });
  db.addSession({ id: 's1', handlerId: 'h1', dogId: 'bo', startedAt: 1, data: {} });

  const q = askDelete('handler', { row: db.handlers.byId('h1'), dogs: db.dogs.all(), sessions: db.sessions() });
  assert.equal(q, 'Delete Rémi and their 2 dogs, Bo and Tess? All 3 profiles go, and cannot be got back. '
    + 'Their session stays in the session list.');
  const named = dogsOf(db.dogs.all(), 'h1').map(d => d.id);
  db.deleteHandler('h1');
  assert.deepEqual(db.dogs.all().map(d => d.id), ['nell'], 'exactly the dogs the question named are the ones that went');
  assert.deepEqual(named.sort(), ['bo', 'tess']);
  assert.deepEqual(db.sessions().map(s => s.id), ['s1'], 'the sessions stay, as the question said');

  assert.equal(askDelete('handler', { row: { id: 'h2', name: 'Anna' }, dogs: [{ id: 'nell', handlerId: 'h2', name: 'Nell' }], backedUp: true }),
    'Delete Anna and their dog Nell? Both profiles go, and cannot be got back. They go from your account backup too.');
  assert.equal(askDelete('handler', { row: { id: 'h3', name: 'Sam' }, dogs: [], sessions: [] }),
    'Delete Sam? Sam’s profile goes, and cannot be got back.');
});

t('the delete questions are plain: no em dashes, nothing left blank', () => {
  const qs = [
    askDelete('session', { row: { targetId: 'person', data: {} } }),
    askDelete('dog', { row: { id: 'x' } }),
    askDelete('handler', { row: { id: 'y' } }),
  ];
  for (const q of qs) {
    assert.doesNotMatch(q, /—/, q);
    assert.doesNotMatch(q, /undefined|null|\s\?|\s{2}/, q);
  }
  assert.equal(qs[0], 'Delete this trail? The laid trail goes, and cannot be got back.');
  assert.equal(qs[1], 'Delete this dog? This dog’s profile goes, and cannot be got back.');
});

t('the storage line points at the session list when the phone is nearly full', () => {
  const MB = 1048576;
  assert.deepEqual(storageWords(0.02 * MB, 5), { nearly: false, text: 'Records use under 0.1 MB of the roughly 5 MB allowed here.' });
  assert.deepEqual(storageWords(2 * MB, 5), { nearly: false, text: 'Records use 2.0 MB of the roughly 5 MB allowed here.' });
  const full = storageWords(4.6 * MB, 5);
  assert.equal(full.nearly, true);
  assert.equal(full.text, 'Records use 4.6 MB of the roughly 5 MB allowed here. Nearly full: open the session list and delete old sessions.');
  assert.doesNotMatch(full.text, /—/);
  assert.equal(storageWords(4.6 * MB, 50).nearly, false, 'the iOS app has far more room');
});

t('an old search result is read with its approach the right way round, once', () => {
  /* The words were back to front until this was fixed: a dog that came in
     nose to the wind was written up as "coming with the wind". */
  const old = { kind: 'search', sentence: 'Bo indicated in 1:40, 2 m from the hide, coming with the wind.',
    toFirst: 100e3, catchM: 2, approach: 'with the wind', ageMin: 1 };
  const fixed = healApproach(old);
  assert.equal(fixed.approach, 'into the wind');
  assert.equal(fixed.sentence, 'Bo indicated in 1:40, 2 m from the hide, coming into the wind.');
  assert.equal(fixed.approachV, APPROACH_V);
  assert.equal(healApproach(fixed), fixed, 'a healed result is never swapped back');
  assert.equal(healApproach({ ...old, approach: 'into the wind' }).approach, 'with the wind');
  const across = { ...old, approach: 'across the wind' };
  assert.equal(healApproach(across), across, 'across the wind was always right');
  const now = { ...old, approach: 'with the wind', approachV: APPROACH_V };
  assert.equal(healApproach(now), now, 'a result graded since is left as it is');
  const trail = { kind: 'trail', sentence: 'x' };
  assert.equal(healApproach(trail), trail);
  assert.equal(healApproach(null), null);

  const db = createStore(fakeBackend());
  db.addSession({ id: 's1', handlerId: 'h', startedAt: 1, summary: old.sentence, data: { result: old } });
  const read = db.sessions()[0];
  assert.equal(read.summary, 'Bo indicated in 1:40, 2 m from the hide, coming into the wind.', 'the list reads right');
  assert.equal(read.data.result.approach, 'into the wind');
  // Changed and saved back whole, then read again: still right, not swapped twice.
  db.addSession({ ...read, id: 's2' });
  assert.equal(db.sessions().find(x => x.id === 's2').data.result.approach, 'into the wind');
  const plain = { id: 'p', data: { result: trail } };
  assert.equal(healSession(plain), plain, 'anything else is the same object');
});

console.log(`\n${pass} passed total\n`);
