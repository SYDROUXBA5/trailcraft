/* Sync, checked where it can go wrong: which copy wins, whether a deleted
   trail stays deleted, and whether a long track survives the trip to the
   cloud and back exactly as it left. */

import assert from 'node:assert/strict';
import {
  mergeRecords, visible, tombstone, pruneTombstones,
  packPoints, unpackPoints, toCloud, fromCloud, approxBytes, DOC_LIMIT, mergeCalibration,
  checkAuthFields, authMessage, AUTH_MIN_PASSWORD,
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

console.log(`\n${pass} passed total\n`);
