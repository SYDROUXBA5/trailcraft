/* Sync, checked where it can go wrong: which copy wins, whether a deleted
   trail stays deleted, and whether a long track survives the trip to the
   cloud and back exactly as it left. */

import assert from 'node:assert/strict';
import {
  mergeRecords, visible, tombstone, pruneTombstones,
  packPoints, unpackPoints, toCloud, fromCloud, approxBytes, DOC_LIMIT, mergeCalibration,
  checkAuthFields, authMessage, AUTH_MIN_PASSWORD, syncPlan, RUN_FIELDS,
  mergeOne, calibrationDiffers, syncMessage, fromCloudRecord,
} from '../public/sync-core.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log(`  ok  ${name}`); };

t('merge: the newer copy wins, whichever side it is on', () => {
  const local = [{ id: 'bo', name: 'Bo', updatedAt: 200 }, { id: 'nell', name: 'Nell (old)', updatedAt: 100 }];
  const remote = [{ id: 'bo', name: 'Bo (old)', updatedAt: 150 }, { id: 'nell', name: 'Nell', updatedAt: 300 }];
  const { merged, toUpload } = mergeRecords(local, remote);
  const byId = Object.fromEntries(merged.map(r => [r.id, r]));
  assert.equal(byId.bo.name, 'Bo', 'the phone had the newer Bo');
  assert.equal(byId.nell.name, 'Nell', 'the cloud had the newer Nell');
  assert.deepEqual(toUpload.map(r => r.id), ['bo'], 'only what the cloud is missing goes up');
});

t('merge: nothing is lost from either side', () => {
  const { merged, toUpload } = mergeRecords(
    [{ id: 'phoneOnly', updatedAt: 5 }],
    [{ id: 'cloudOnly', updatedAt: 5 }],
  );
  assert.deepEqual(merged.map(r => r.id).sort(), ['cloudOnly', 'phoneOnly']);
  assert.deepEqual(toUpload.map(r => r.id), ['phoneOnly'], 'a trail only on this phone is backed up');
});

t('merge: records from before sync lose to any real edit', () => {
  // Every existing trail on the phone predates sync and carries no stamp.
  const { merged, toUpload } = mergeRecords(
    [{ id: 's1', summary: 'from before sync' }],
    [{ id: 's1', summary: 'edited on the other phone', updatedAt: 10 }],
  );
  assert.equal(merged[0].summary, 'edited on the other phone');
  assert.equal(toUpload.length, 0);

  // But one that exists ONLY on the phone still gets backed up.
  assert.equal(mergeRecords([{ id: 's2' }], []).toUpload.length, 1);
});

t('merge: a deleted trail stays deleted — it is not resurrected by the other phone', () => {
  const deletedHere = tombstone('s9', 500);
  const staleThere = { id: 's9', summary: 'still here on the old phone', updatedAt: 100 };
  const { merged, toUpload } = mergeRecords([deletedHere], [staleThere]);
  assert.equal(merged[0].deleted, true, 'the tombstone is newer, so it wins');
  assert.equal(visible(merged).length, 0, 'and the app does not show it');
  assert.equal(toUpload[0].deleted, true, 'and the deletion is sent so other phones learn it');

  // And the reverse: deleted in the cloud, stale on this phone.
  const r = mergeRecords([staleThere], [tombstone('s9', 500)]);
  assert.equal(visible(r.merged).length, 0, 'deleted elsewhere means deleted here');
});

t('merge: an edit made after a deletion brings the record back, deliberately', () => {
  const { merged } = mergeRecords(
    [{ id: 's3', summary: 're-created', updatedAt: 900 }],
    [tombstone('s3', 400)],
  );
  assert.equal(visible(merged).length, 1, 'newer is newer, whether it is a delete or an edit');
});

t('tombstones are pruned once they have had time to reach every phone', () => {
  const now = 100 * 86400e3;
  const rows = [
    tombstone('old', now - 91 * 86400e3),
    tombstone('recent', now - 5 * 86400e3),
    { id: 'live', updatedAt: 1 },
  ];
  assert.deepEqual(pruneTombstones(rows, now).map(r => r.id), ['recent', 'live']);
});

t('points: packed into columns and back, exactly', () => {
  const pts = Array.from({ length: 50 }, (_, i) => ({
    lat: 51.2094 + i * 1e-5, lon: -2.6449 + i * 1e-5, t: 1_700_000_000_000 + i * 1000,
    acc: 4 + (i % 3), ...(i % 7 === 0 ? { dwellS: 12 } : {}),
  }));
  const back = unpackPoints(packPoints(pts));
  assert.deepEqual(back, pts, 'every field, every point, nothing invented');

  /* The phone's own scratch copy is kept short instead: rounded to about 11 cm
     and written as steps. It is text, rewritten every few seconds; the backup
     is not, and pays nothing for the longer numbers. */
  const short = packPoints(pts, { compact: true });
  assert.ok(JSON.stringify(short).length < JSON.stringify(packPoints(pts)).length / 2,
    'the short form is less than half the size');
  const fromShort = unpackPoints(short);
  fromShort.forEach((p, i) => {
    assert.ok(Math.abs(p.lat - pts[i].lat) <= 1e-6, `point ${i} is where it was`);
    assert.equal(p.t, pts[i].t, `point ${i} time is exact`);
  });
});

t('toCloud: a real session becomes storable, and comes back identical', () => {
  const track = Array.from({ length: 400 }, (_, i) => ({ lat: 51.2 + i * 1e-5, lon: -2.64, t: 1_700_000_000_000 + i * 2000, acc: 5 }));
  const session = {
    id: 's1', startedAt: 1, updatedAt: 2, summary: 'Bo worked 6 m right of the line.',
    data: {
      trail: track, track,
      waypoints: [{ kind: 'indication', lat: 51.2, lon: -2.64, t: 3 }],
      weather: { wind_speed: 2.2, wind_direction: 290, series: [{ t: 1, wind_speed: 2 }] },
      contamination: [{ points: track.slice(0, 10) }],
      grid: [[1, 2], [3, 4]],          // an array of arrays, which Firestore refuses outright
      nothing: undefined,
      result: { mean: -6.1, ageMin: 40 },
    },
  };
  const cloud = toCloud(session);

  // No array directly inside an array anywhere — Firestore's hard rule.
  const nested = (v) => Array.isArray(v) ? v.some(x => Array.isArray(x) || nested(x))
    : (v && typeof v === 'object') ? Object.values(v).some(nested) : false;
  assert.equal(nested(cloud), false, 'nothing Firestore would reject');

  const back = fromCloud(cloud);
  const expected = JSON.parse(JSON.stringify(session));   // undefined drops, as JSON drops it
  assert.deepEqual(back, expected, 'the session comes back exactly as it went up');
});

t('toCloud: a long track fits a single document with room to spare', () => {
  // Two hours of walking, one kept fix per second — the long end of real use.
  const track = Array.from({ length: 7200 }, (_, i) => ({
    lat: 51.20941234 + i * 1e-6, lon: -2.64491234 + i * 1e-6, t: 1_700_000_000_000 + i * 1000, acc: 4.2, alt: 58.3,
  }));
  const packed = approxBytes(toCloud({ data: { track } }));
  const naive = approxBytes({ data: { track } });
  assert.ok(packed < DOC_LIMIT * 0.6, `${(packed / 1024).toFixed(0)} KB, well under the 1 MB ceiling`);
  assert.ok(packed < naive * 0.8, `packing saves space (${(packed / 1024).toFixed(0)} vs ${(naive / 1024).toFixed(0)} KB)`);
});

t('calibration: runs from both phones are kept, none twice, none lost', () => {
  const row = (t, k) => ({ t, k, predSide: 1, mean: 8, wind: 3 });
  const phoneA = [row(1, 2.1), row(2, 1.9), row(3, 2.4)];
  const phoneB = [row(2, 1.9), row(4, 2.2)];            // run 2 synced already; run 4 only here

  const merged = mergeCalibration(phoneA, phoneB);
  assert.deepEqual(merged.map(r => r.t), [1, 2, 3, 4], 'every run once, oldest first');

  // Newest-wins would have dropped phone A's runs 1 and 3 — the exact failure this avoids.
  const many = Array.from({ length: 60 }, (_, i) => row(i, 2));
  assert.equal(mergeCalibration(many, []).length, 50, 'capped at the fifty the store keeps');
  assert.equal(mergeCalibration(many, [])[0].t, 10, 'and it is the oldest that go');
  assert.deepEqual(mergeCalibration(null, undefined), []);
});

/* ── Email accounts: checked on the phone, explained in plain words ── */

t('creating an account needs a name, a real-looking email and a long enough password', () => {
  const ok = checkAuthFields({ mode: 'up', name: 'Rémi', email: 'remi@example.com', password: 'longenough' });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.errors, {});

  const bad = checkAuthFields({ mode: 'up', name: '  ', email: 'remi@', password: 'short' });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.name, 'a blank name is caught');
  assert.ok(bad.errors.email, 'a half-typed email is caught');
  assert.ok(bad.errors.password.includes(String(AUTH_MIN_PASSWORD)), 'the password rule says the number');

  assert.ok(checkAuthFields({ mode: 'up', name: 'R', email: 'a@b.co', password: '        ' }).errors.password,
    'eight spaces is not a password');
  assert.ok(checkAuthFields({ mode: 'up', name: 'R', email: 'a@b.co', password: 'x'.repeat(129) }).errors.password);
  assert.equal(checkAuthFields({ mode: 'up', name: 'R', email: 'a b@c.com', password: 'longenough' }).errors.email,
    'That email doesn’t look right.');
  assert.equal(AUTH_MIN_PASSWORD, 8);
});

t('signing in needs only the email and a password, of any length', () => {
  const r = checkAuthFields({ mode: 'in', email: ' remi@example.com ', password: 'abc' });
  assert.equal(r.ok, true, 'an old short password still signs in; the length rule is for new ones');
  assert.equal(r.errors.name, undefined, 'no name asked when signing in');
  assert.equal(checkAuthFields({ mode: 'in', email: 'remi@example.com', password: '' }).errors.password, 'Type your password.');
  assert.equal(checkAuthFields({ mode: 'in', email: '', password: 'x' }).errors.email, 'Type your email.');
  assert.equal(checkAuthFields().ok, false);
});

t('every sign-in failure says what happened in words a handler can act on', () => {
  const cases = {
    'auth/email-already-in-use': 'Sign in instead',
    'auth/invalid-email': 'doesn’t look right',
    'auth/weak-password': String(AUTH_MIN_PASSWORD),
    'auth/invalid-credential': 'don’t match an account',
    'auth/wrong-password': 'don’t match an account',
    'auth/user-not-found': 'don’t match an account',
    'auth/too-many-requests': 'reset your password',
    'auth/network-request-failed': 'No signal',
    'auth/api-key-not-valid': 'setup guide',
    'auth/operation-not-allowed': 'switched on yet',
    'auth/requires-recent-login': 'sign back in',
    'auth/popup-blocked': 'Allow pop-ups',
  };
  for (const [code, words] of Object.entries(cases)) {
    const m = authMessage(code);
    assert.ok(m.includes(words), `${code} → "${m}"`);
    assert.ok(!/auth\/|firebase|code/i.test(m), `${code} does not show the developer's code`);
    assert.ok(!m.includes('—'), 'no dash-spliced sentences');
  }
  assert.equal(authMessage('auth/popup-closed-by-user'), null, 'closing the window yourself is not an error');
  assert.equal(authMessage('auth/something-new'), 'Sign-in did not work. Try again.');
  assert.equal(authMessage(), 'Sign-in did not work. Try again.');
  /* A wrong password and an unknown email read the same, so the form never
     tells a stranger which emails have accounts. */
  assert.equal(authMessage('auth/wrong-password'), authMessage('auth/user-not-found'));
});

/* One phone, two people: the second one's sign-in must not hoover up the first's records. */
t('signing in never merges one handler’s records into another’s account', () => {
  assert.equal(syncPlan(null, 'A', false), 'adopt', 'an empty phone is simply taken over');
  assert.equal(syncPlan(null, 'A', true), 'ask', 'records saved before anyone signed in are uploaded only on purpose');
  assert.equal(syncPlan('A', 'A', true), 'sync', 'their own records sync as usual');
  assert.equal(syncPlan('A', 'B', true), 'other', 'someone else’s records are left alone');
  assert.equal(syncPlan('A', 'B', false), 'other', 'and are still theirs even with nothing showing');
  assert.equal(syncPlan('', 'B', true), 'ask', 'an empty owner is nobody, not a stranger');
  assert.equal(syncPlan(null, 'A'), 'adopt', 'an unknown phone is treated as empty by callers that do not say');
  assert.equal(syncPlan('A', null), 'signed-out');
  assert.equal(syncPlan(null, null), 'signed-out');
  assert.equal(syncPlan(undefined, undefined), 'signed-out');
});

/* A whole run, as the backup carries it. The handler's call on the indication
   is what their calibration is built from: a restore that quietly drops it
   would show a handler a confidence history that is not theirs. */
t('a run restored on another phone still knows what the handler called', () => {
  const session = {
    id: 's1', updatedAt: 5, targetId: 'person', startedAt: 1000,
    data: {
      trail: [{ lat: 51.2094, lon: -2.6449, t: 1000 }, { lat: 51.2095, lon: -2.6447, t: 2000, dwellS: 12 }],
      track: [{ lat: 51.2094, lon: -2.6448, t: 3000, acc: 4, alt: 30 }],
      trackWaypoints: [
        { kind: 'Indication', lat: 51.2095, lon: -2.6446, t: 3500, call: { v: 1, conf: 0.9, seen: false, at: 3600 } },
        { kind: 'Cast', lat: 51.2096, lon: -2.6445, t: 3800 },
      ],
      result: { found: true },
    },
  };
  const back = fromCloud(toCloud(session));
  const wps = back.data.trackWaypoints;
  assert.equal(wps.length, 2);
  assert.equal(wps[0].kind, 'Indication');
  assert.deepEqual(wps[0].call, { v: 1, conf: 0.9, seen: false, at: 3600 }, 'the call comes back whole');
  assert.equal(wps[1].call, undefined, 'a mark with no call gains none');
  assert.equal(back.data.trail[1].dwellS, 12, 'and the rest of the walk is unchanged');
  assert.equal(back.data.track[0].acc, 4);
  assert.equal(back.data.result.found, true);
});

/* The call was lost because the packing had a list of fields and nobody
   remembered to add to it. There is no list to forget now, and this is what
   says so — including for whatever gets hung on a point next. */
t('whatever a point carries travels with it, except the app’s own working notes', () => {
  const pts = [
    { lat: 51.2094, lon: -2.6449, t: 1000, kind: 'Indication', note: 'by the gate',
      call: { v: 1, conf: 0.5, seen: true, at: 1100 }, somethingNew: 42, _seen: 1000 },
    { lat: 51.2095, lon: -2.6447, t: 2000, dwellS: 9 },
  ];
  const back = unpackPoints(packPoints(pts));
  assert.equal(back.length, 2);
  assert.equal(back[0].note, 'by the gate');
  assert.equal(back[0].somethingNew, 42, 'a field this test invented survives, so tomorrow’s will too');
  assert.deepEqual(back[0].call, { v: 1, conf: 0.5, seen: true, at: 1100 });
  assert.equal(back[0]._seen, undefined, 'working notes are the one thing dropped');
  assert.equal(back[1].dwellS, 9);
  assert.equal(back[1].note, undefined, 'and a point without a field does not gain one');
});

/* Firestore charges eight bytes for a number whatever it holds, so the
   ceiling is about how MANY points there are, not how they are written. This
   is the honest picture of where it bites. */
t('the size guard counts the way Firestore counts', () => {
  const walk = (n) => Array.from({ length: n }, (_, i) => ({
    lat: 51.2094 + i * 0.000012, lon: -2.6449 + i * 0.000018,
    t: 1758000000000 + i * 1000, acc: 5, alt: 42,
  }));
  const session = (mins) => ({ id: 's', updatedAt: 1,
    data: { trail: walk(mins * 60), track: walk(mins * 60), trackWaypoints: walk(12) } });

  assert.ok(approxBytes(toCloud(session(180))) < DOC_LIMIT,
    'three hours laid and three hours run still fits in one record');
  assert.ok(approxBytes(toCloud(session(240))) > DOC_LIMIT,
    'four and four does not — and the handler is told so rather than being told it was backed up');

  /* Shortening the numbers does NOT change what Firestore charges. Anything
     claiming otherwise is measuring the text and not the record. */
  const plain = approxBytes(packPoints(walk(2000)));
  const short = approxBytes(packPoints(walk(2000), { compact: true }));
  assert.ok(short >= plain * 0.9, `the short form buys nothing here (${short} vs ${plain})`);

  /* Written before any of this: still a walk, not a crash. */
  const older = { __pts: 3, lat: [51.2, 51.3, 51.4], lon: [-2.6, -2.7, -2.8], t: [1000, 2000, 3000], kind: [null, 'Indication', null] };
  assert.deepEqual(unpackPoints(older), [
    { lat: 51.2, lon: -2.6, t: 1000 },
    { lat: 51.3, lon: -2.7, t: 2000, kind: 'Indication' },
    { lat: 51.4, lon: -2.8, t: 3000 },
  ]);
});


/* A record written by someone else — a live run is — can claim anything. */
t('a record never unpacks into more points than it actually holds', () => {
  const bomb = { __pts: 2e7, lat: [51.2], lon: [-2.6] };
  const pts = unpackPoints(bomb);
  assert.equal(pts.length, 1, 'twenty million claimed, one there: one');
  assert.equal(unpackPoints({ __pts: -3, lat: [1], lon: [2] }).length, 0);
  assert.equal(unpackPoints({ __pts: 2 ** 32, lat: [1, 2], lon: [3, 4] }).length, 2, 'no RangeError');
});

t('field names the cloud refuses never reach it', () => {
  const out = toCloud({ data: { weather: { temp: 5, '': 1, '__x__': 2, series: [{ t: 1, '__name__': 3 }] } } });
  assert.deepEqual(Object.keys(out.data.weather).sort(), ['series', 'temp']);
  assert.deepEqual(Object.keys(out.data.weather.series[0]), ['t']);
});

/* ── Two phones, one account ──────────────────────────────────────── */
const run = { id: 's1', name: 'Wood edge', updatedAt: 100, data: { trail: [1], track: [2], result: { found: true } } };
const renamed = { id: 's1', name: 'Top field', updatedAt: 200, data: { trail: [1] } };

t('a session edited on a phone that missed a run keeps the run and the edit', () => {
  const { keep, up } = mergeOne(renamed, run, { union: true });
  assert.equal(keep.name, 'Top field', 'the newer edit wins what both have');
  assert.deepEqual(keep.data.result, { found: true }, 'and the run only the older copy had is kept');
  assert.ok(keep.updatedAt > 200, 'stamped newer than both, so every phone takes it');
  assert.equal(up, true);
  assert.equal(mergeOne(renamed, run).keep, renamed, 'without union, newest wins whole, as for a dog or a handler');
});

t('a merge that adds nothing is not sent again', () => {
  assert.deepEqual(mergeOne(run, { ...run }, { union: true }), { keep: run, up: false }, 'a tie goes to the cloud');
  const oldBuild = { ...run, syncedAt: { seconds: 1, nanoseconds: 0 }, baseAt: 90 };
  assert.equal(mergeOne(oldBuild, run, { union: true }).up, false,
    'the cloud’s own bookkeeping, kept by an older build, is not a field to merge back');
});

t('a deletion is never merged into, whichever side is newer', () => {
  const gone = { id: 's1', deleted: true, updatedAt: 300 };
  assert.equal(mergeOne(gone, run, { union: true }).keep, gone);
  assert.equal(mergeOne({ ...gone, updatedAt: 50 }, run, { union: true }).keep, run, 'newest still wins');
});

t('a pull of only what changed does not send the rest again', () => {
  const local = [{ id: 'a', updatedAt: 5 }, { id: 'b', updatedAt: 5 }];
  const { merged, toUpload } = mergeRecords(local, [{ id: 'b', updatedAt: 9 }], { partial: true });
  assert.deepEqual(merged.map(r => [r.id, r.updatedAt]), [['a', 5], ['b', 9]]);
  assert.deepEqual(toUpload, [], 'a record missing from a partial pull is not missing from the cloud');
});

t('calibration goes up when its rows differ, not only when their number does', () => {
  const rows = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => ({ t: a + i, k: 1 }));
  const merged = mergeCalibration(rows(2, 51), rows(1, 50));
  assert.equal(merged.length, 50);
  assert.equal(calibrationDiffers(merged, rows(1, 50)), true, 'fifty rows each, but a new run among them');
  assert.equal(calibrationDiffers(rows(1, 50), rows(1, 50)), false);
  assert.equal(calibrationDiffers(rows(1, 3), []), true);
});

t('a failed backup says what failed, and never that signing in did', () => {
  const said = (code) => syncMessage({ code });
  assert.equal(said('resource-exhausted'), 'The free cloud allowance is used up for today.');
  assert.match(said('unavailable'), /No signal/);
  assert.match(said('deadline-exceeded'), /No signal/);
  assert.match(said('permission-denied'), /tries again/);
  assert.equal(syncMessage({ name: 'SaveError', full: true }), 'This phone is full. Delete an old session to make room.');
  assert.equal(said('internal'), null, 'unknown: the caller says it in its own words');
  assert.equal(syncMessage(undefined), null);
  for (const c of ['unavailable', 'resource-exhausted', 'invalid-argument', 'internal', '']) {
    assert.ok(!/Sign-in/.test(said(c) || ''), c);
  }
});

t('what the cloud writes on a record for itself never lands on the phone', () => {
  const rec = fromCloudRecord({ id: 's1', updatedAt: 5, baseAt: 4, syncedAt: { toMillis: () => 1 }, data: { trail: { __pts: 1, lat: [1], lon: [2] } } });
  assert.deepEqual(Object.keys(rec).sort(), ['data', 'id', 'updatedAt']);
  assert.equal(rec.data.trail.length, 1, 'and the rest comes back as the phone wrote it');
});


/* The checker's own case: phone A ran the dog; phone B, which never pulled,
   renamed its old copy later. Both must survive, and B's never-heard-of-it
   'no dog, not run yet' must not undo A's run. */
t('merging a stale copy keeps the run whole and never lets an empty value win', () => {
  const laid = { id: 's1', name: 'Field', dogId: null, handlerId: 'h1', summary: 'Trail laid, not run yet.',
    data: { trail: [{ lat: 51.2, lon: -2.6, t: 1 }, { lat: 51.21, lon: -2.61, t: 2 }], weather: null, contamination: [] } };
  const ranOnA = { ...laid, updatedAt: 100, dogId: 'd1', handlerId: 'h2', summary: 'Found in 4 min',
    data: { ...laid.data, weather: { temp: 11, wind_speed: 3 }, contamination: [{ who: 'Sam', points: [] }],
      track: [{ lat: 51.2, lon: -2.6, t: 10 }], result: { kind: 'trail', sentence: 'Found' } } };
  const renamedOnB = { ...laid, updatedAt: 200, name: 'Top field' };
  const { keep, up } = mergeOne(renamedOnB, ranOnA, { union: true });
  assert.equal(up, true);
  assert.equal(keep.name, 'Top field', 'the rename survives');
  assert.equal(keep.dogId, 'd1', 'the run is still that dog’s');
  assert.equal(keep.handlerId, 'h2');
  assert.equal(keep.summary, 'Found in 4 min', 'and still says what happened');
  assert.deepEqual(keep.data.weather, { temp: 11, wind_speed: 3 }, 'a copy that never had the weather did not remove it');
  assert.equal(keep.data.contamination.length, 1);
  assert.equal(keep.data.track.length, 1);
  assert.equal(keep.data.result.sentence, 'Found');
  assert.ok(keep.updatedAt > 200, 'stamped newer than both, so every phone takes it');
});

t('a second run starts without the first run’s fetched weather', () => {
  assert.ok(RUN_FIELDS.includes('runWeather'), 'the wind a run was graded in belongs to that run');
});

console.log(`\n${pass} passed total\n`);
