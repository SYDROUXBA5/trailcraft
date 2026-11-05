/* The squad demo: the pure rules of it (squad.js), and the cloud side
   (squad-cloud.js) run for real against the fake cloud with several phones
   on it — a chief, a K9 handler, an officer and a stranger — under a copy of
   firestore.rules (fake-squad-rules.mjs). Nothing here contacts Firebase. */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as fake from './fake-firebase.mjs';
import { allow } from './fake-squad-rules.mjs';
import { ROLES, canSetRole, canRemove, canLeave, cleanCallSign, cleanSquadName, newJoinCode, codeFromText,
         showCode, squadLink, CODE_ALPHABET, shouldSend, SEND, writesPerHour, headingOf, freshness, ageWords,
         roster, onDutyCount, fitPoints, cleanMember, cleanPosition, positionDoc, createSim, compass,
         POSITION_TTL, PATHS, DEMO_LABEL, FRESH_MS } from '../public/squad.js';
import { createSquad, findSquad, joinSquad, myMember, watchSquad, putPosition, clearPosition, setRole,
         removeMember, leaveSquad, newCode, deleteSquad, getSquad, TOMBSTONE_MS } from '../public/squad-cloud.js';
import { html, esc } from '../public/squad-ui.js';
import { MARKS, DRAW_TOOLS, RUN_MARKS, incidentDoc, cleanIncident, activeOf, pastOf, markDoc, cleanMark, mayMark, mayUnmark,
         trackBuffer, minuteOf, cleanTrack, joinTracks, trailInfo, aheadLine, elapsedWords, clockWords, countWords,
         summarise, buildReplay, placeAt, replayAt, scentPath, createSimIncident, mayShareRun } from '../public/incident.js';
import { startIncident, endIncident, watchIncidents, watchIncident, putMark, removeMark, putTrack,
         loadIncident } from '../public/incident-cloud.js';
import { project } from '../public/geo.js';
import { dist } from '../public/geo.js';

let pass = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);
const tick = () => new Promise(r => setImmediate(r));
const settle = async () => { for (let i = 0; i < 5; i++) await tick(); };
const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

/* ── Pure ────────────────────────────────────────────────────────────── */
t('a join code is eight unambiguous characters, and a link or a typed code reads back to it', () => {
  for (let i = 0; i < 200; i++) {
    const c = newJoinCode();
    assert.equal(c.length, 8);
    for (const ch of c) assert.ok(CODE_ALPHABET.includes(ch));
  }
  assert.doesNotMatch(CODE_ALPHABET, /[0O1IL]/, 'nothing that reads as something else');
  // Bytes of 248 and up are thrown away, not folded in (no bias to the first letters).
  let calls = 0;
  const c = newJoinCode((n) => { calls++; return new Uint8Array(n).fill(calls === 1 ? 250 : 3); });
  assert.equal(c, 'DDDDDDDD');
  assert.equal(calls, 2);
  assert.equal(codeFromText('k7mp-4xq2'), 'K7MP4XQ2');
  assert.equal(codeFromText(' K7MP 4XQ2 '), 'K7MP4XQ2');
  assert.equal(codeFromText('https://x.test/trailcraft/#squad=K7MP-4XQ2'), 'K7MP4XQ2');
  assert.equal(codeFromText('#squad=K7MP-4XQ2'), 'K7MP4XQ2');
  assert.equal(codeFromText('K7MP-4XQ'), '', 'too short');
  assert.equal(codeFromText('K7MP-4XQO'), '', 'an O is never in a code');
  assert.equal(codeFromText('<script>'), '');
  assert.equal(showCode('K7MP4XQ2'), 'K7MP-4XQ2');
  assert.equal(squadLink('https://x.test/', 'K7MP4XQ2'), 'https://x.test/#squad=K7MP-4XQ2');
});

t('only Command promotes and removes, never the creator, and the creator cannot leave', () => {
  const chief = { uid: 'chief', role: 'command' };
  const sgt = { uid: 'sgt', role: 'command' };
  const k9 = { uid: 'k9', role: 'k9' };
  assert.ok(canSetRole(chief, k9, 'chief'));
  assert.ok(canSetRole(sgt, k9, 'chief'));
  assert.ok(!canSetRole(sgt, chief, 'chief'), 'the creator stays Command');
  assert.ok(!canSetRole(k9, sgt, 'chief'), 'a K9 handler cannot promote');
  assert.ok(canRemove(chief, sgt, 'chief'));
  assert.ok(!canRemove(sgt, chief, 'chief'));
  assert.ok(!canRemove(chief, chief, 'chief'), 'nobody removes themselves: they leave');
  assert.ok(!canRemove(k9, sgt, 'chief'));
  assert.ok(!canLeave(chief, 'chief'));
  assert.ok(canLeave(k9, 'chief'));
  assert.deepEqual(Object.keys(ROLES), ['command', 'k9', 'officer']);
});

t('what other people typed is tidied and bounded, and kept out of the page by html``', () => {
  assert.equal(cleanCallSign('  K9\u0000-1\n  Reyes  '), 'K9-1 Reyes');
  assert.equal(cleanCallSign('x'.repeat(50)).length, 24);
  assert.equal(cleanSquadName('y'.repeat(99)).length, 60);
  const m = cleanMember({ uid: 'a', role: 'admin', callSign: '', name: 'A', dog: 'Rex', joinedAt: 'x' }, 'a');
  assert.deepEqual(m, { uid: 'a', role: 'officer', callSign: 'Unit', name: 'A', dog: null, joinedAt: 0 },
    'an unknown role is an officer, and only a K9 handler has a dog');
  assert.equal(cleanMember(null, 'a'), null);
  const evil = '<img src=x onerror=alert(1)>"\'&';
  const out = html`<b>${evil}</b><i title="${evil}">${[html`<u>${evil}</u>`]}</i>`;
  const s = Object.getOwnPropertySymbols(out).map(k => out[k])[0];
  assert.doesNotMatch(s, /<img|onerror=alert\(1\)>|"'/);
  assert.equal(s, `<b>${esc(evil)}</b><i title="${esc(evil)}"><u>${esc(evil)}</u></i>`);
});

t('the squad screens write HTML only through html``, and say it is a demo', () => {
  const ui = read('public/squad-ui.js');
  const sinks = [...ui.matchAll(/\.innerHTML\s*=\s*([^;]+);/g)].map(m => m[1].trim());
  assert.deepEqual(sinks, ['piece[SAFE]', 'qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true })'],
    'one sink for html`` pieces, and the QR library’s own SVG');
  assert.doesNotMatch(ui, /insertAdjacentHTML|outerHTML|document\.write/);
  for (const m of ui.matchAll(/put\([^,]+,\s*([^)]{0,6})/g)) assert.match(m[1], /^html`/, 'put() is only ever given html``');
  const page = read('public/index.html');
  for (const id of ['scrSquad', 'scrSquadNew', 'scrSquadJoin', 'scrCommand']) {
    const sec = page.slice(page.indexOf(`<section id="${id}"`), page.indexOf('</section>', page.indexOf(`<section id="${id}"`)));
    assert.ok(sec.includes('data-demo-label') && sec.includes(DEMO_LABEL), `${id} says ${DEMO_LABEL}`);
  }
  assert.doesNotMatch(page.slice(page.indexOf('scrSquad'), page.indexOf('scrSessions')), /<script|\son[a-z]+="/,
    'no inline script or handler: the CSP allows neither');
});

t('a position goes on real movement, at most every ten seconds, and once a minute standing still', () => {
  const at = 1_000_000;
  const here = { lat: 51.2, lon: -2.6, acc: 5, hdg: 90, spd: 1.4 };
  assert.ok(shouldSend(null, here, at), 'the first fix always goes');
  const last = { ...here, at };
  const moved = { ...here, lat: here.lat + 0.0003 };   // ~33 m north
  assert.ok(!shouldSend(last, moved, at + 9e3), 'never within ten seconds');
  assert.ok(shouldSend(last, moved, at + 10e3), 'moved, ten seconds on: it goes');
  const nudge = { ...here, lat: here.lat + 0.00005 };  // ~5 m: GPS wobble
  assert.ok(!shouldSend(last, nudge, at + 30e3), 'a few metres of wobble is not news');
  assert.ok(shouldSend(last, nudge, at + 60e3), 'but a minute on, a heartbeat');
  assert.ok(shouldSend(last, { ...here, hdg: 200 }, at + 12e3), 'a sharp turn while moving: the arrow is wrong');
  assert.ok(!shouldSend(last, { ...here, hdg: 200, spd: 0 }, at + 12e3), 'a phone turning in a hand is not a turn');
  assert.ok(!shouldSend(last, { ...moved, acc: 400 }, at + 70e3), 'a fix too vague to place anyone is not sent');
  assert.ok(!shouldSend(last, { lat: NaN, lon: 1 }, at + 70e3));
  assert.deepEqual(writesPerHour(), { moving: 360, still: 60 });
  assert.equal(SEND.minGapMs, 10e3);
});

t('the heading is the phone’s own while moving, else the way it went', () => {
  assert.equal(headingOf(null, { lat: 0, lon: 0, hdg: 45, spd: 2 }), 45);
  const prev = { lat: 51.2, lon: -2.6, hdg: 10 };
  const east = headingOf(prev, { lat: 51.2, lon: -2.5998, hdg: -1, spd: 0 });
  assert.ok(Math.abs(east - 90) < 1, `due east, not ${east}`);
  assert.equal(headingOf(prev, { lat: 51.2, lon: -2.6, hdg: null, spd: 0 }), 10, 'standing still keeps the last');
  assert.equal(compass(44), 'NE');
  assert.equal(compass(359), 'N');
  assert.equal(compass(null), '');
});

t('freshness: green, amber after 75 s, grey after two minutes, gone after half an hour', () => {
  const now = 10_000_000;
  assert.equal(freshness(now - 5e3, now), 'live');
  // A member standing still sends once a minute: they must stay green between heartbeats.
  assert.ok(FRESH_MS > SEND.heartbeatMs, 'quiet only after a heartbeat has been missed');
  assert.equal(freshness(now - SEND.heartbeatMs - 5e3, now), 'live');
  assert.equal(freshness(now - 90e3, now), 'quiet');
  assert.equal(freshness(now - 120e3, now), 'stale');
  assert.equal(freshness(now - 31 * 60e3, now), 'gone');
  assert.equal(ageWords(now - 3e3, now), 'now');
  assert.equal(ageWords(now - 42e3, now), '42 s ago');
  assert.equal(ageWords(now - 5 * 60e3, now), '5 min ago');
});

t('the roster puts the on-duty first, then Command, K9 and officers, and drops dead positions', () => {
  const now = 50_000_000;
  const members = new Map([
    ['a', { uid: 'a', role: 'officer', callSign: '2A14' }],
    ['b', { uid: 'b', role: 'k9', callSign: 'K9-1' }],
    ['c', { uid: 'c', role: 'command', callSign: 'Chief' }],
    ['d', { uid: 'd', role: 'officer', callSign: '2A2' }],
    ['e', { uid: 'e', role: 'officer', callSign: 'Foot 3' }],
  ]);
  const positions = new Map([
    ['a', { lat: 1, lon: 1, at: now - 1e3 }],
    ['d', { lat: 2, lon: 2, at: now - 3 * 60e3 }],
    ['e', { lat: 3, lon: 3, at: now - 2 * 3600e3 }],
    ['ghost', { lat: 9, lon: 9, at: now }],
  ]);
  const rows = roster(members, positions, now);
  assert.deepEqual(rows.map(r => r.callSign), ['2A2', '2A14', 'Chief', 'K9-1', 'Foot 3']);
  assert.deepEqual(rows.map(r => r.fresh), ['stale', 'live', 'off', 'off', 'off']);
  assert.equal(onDutyCount(rows), 2);
  assert.deepEqual(fitPoints(rows), [{ lat: 2, lon: 2 }, { lat: 1, lon: 1 }], 'a grey unit is still one to find');
});

t('a call sign taken twice is numbered for the later one, and flagged', () => {
  const members = new Map([
    ['x', { uid: 'x', role: 'k9', callSign: 'K9-1', joinedAt: 1 }],
    ['y', { uid: 'y', role: 'officer', callSign: 'k9-1', joinedAt: 5 }],
    ['z', { uid: 'z', role: 'officer', callSign: 'K9-1', joinedAt: 9 }],
    ['w', { uid: 'w', role: 'officer', callSign: '2A12', joinedAt: 2 }],
  ]);
  const rows = roster(members, new Map(), 0);
  const by = Object.fromEntries(rows.map(r => [r.uid, r]));
  assert.equal(by.x.callSign, 'K9-1', 'the first to join keeps it');
  assert.equal(by.x.dup, false);
  assert.equal(by.y.callSign, 'k9-1 (2)');
  assert.equal(by.z.callSign, 'K9-1 (3)');
  assert.ok(by.y.dup && by.z.dup && !by.w.dup);
});

t('a position is lean and bounded on the way out, and checked on the way in', () => {
  const d = positionDoc('u', { lat: 51.123456789, lon: -2.987654321, acc: 7.6, hdg: -90, spd: 1.234 }, 1000);
  assert.deepEqual(d, { uid: 'u', lat: 51.123457, lon: -2.987654, acc: 8, hdg: 270, spd: 1.2, at: 1000, expiresAt: 1000 + POSITION_TTL });
  assert.equal(cleanPosition({ lat: 91, lon: 0, at: 1 }), null);
  assert.equal(cleanPosition({ lat: '51', lon: 0, at: 1 }), null);
  assert.equal(cleanPosition({ lat: 51, lon: 0 }), null, 'no time, no position');
  assert.deepEqual(cleanPosition({ lat: 51, lon: 0, at: 5, hdg: 370, spd: -1, acc: 'x' }, 'z'),
    { uid: 'z', lat: 51, lon: 0, at: 5, acc: null, hdg: 10, spd: null });
});

t('the pretend squad moves like people and cars, stays near, and one unit goes grey', () => {
  const center = { lat: 51.2094, lon: -2.6476 };
  const t0 = 1_700_000_000_000;
  const a = createSim({ center, now: t0, seed: 3 });
  const b = createSim({ center, now: t0, seed: 3 });
  a.step(t0 + 120e3); b.step(t0 + 120e3);
  assert.deepEqual([...a.positions().values()], [...b.positions().values()], 'seeded: the same squad every time');
  assert.equal(a.members().size, 7);
  assert.deepEqual([...a.members().values()].map(m => m.role).filter(r => r === 'k9').length, 2);
  for (const m of a.members().values()) assert.deepEqual(cleanMember(m, m.uid), m, 'members as the cloud would give them');
  // Ten minutes, second by second: speeds stay human, and nobody wanders off.
  let prev = new Map(a.units.map(u => [u.uid, { lat: u.lat, lon: u.lon }]));
  let greyed = false;
  for (let s = 121; s <= 600; s++) {
    const now = t0 + s * 1000;
    a.step(now);
    for (const u of a.units) {
      const v = dist(prev.get(u.uid), u);
      assert.ok(v <= (u.mode === 'car' ? 12.5 : 1.8), `${u.callSign} moved ${v.toFixed(1)} m in a second`);
      assert.ok(dist(center, u) < 1600, `${u.callSign} stayed within the patrol area`);
    }
    prev = new Map(a.units.map(u => [u.uid, { lat: u.lat, lon: u.lon }]));
    const rows = roster(a.members(), a.positions(), now);
    if (rows.some(r => r.fresh === 'stale')) greyed = true;
    for (const p of a.positions().values()) assert.deepEqual(cleanPosition(p, p.uid), p);
  }
  assert.ok(greyed, 'a unit went quiet long enough to turn grey');
  // Sent somewhere, a unit goes there and waits.
  const post = { lat: center.lat + 0.002, lon: center.lon + 0.002 };
  a.goTo('sim-5', post);
  a.step(t0 + 1200e3);
  assert.ok(dist(a.units[4], post) < 8, 'it reached the post and held it');
  // A clock that is not a whole number of milliseconds still arrives (it once looped for ever).
  const c = createSim({ center, now: t0 + 0.37, seed: 1 });
  for (const step of [1003.3, 6.999999999, 0.0001, 2500.25]) c.step(c.at + step);
  assert.ok(c.at > t0 + 3500);
});

/* ── Incidents: the pure part ───────────────────────────────────────── */
t('an incident and its marks are lean on the way out and cleaned on the way in', () => {
  const d = incidentDoc({ name: '  Missing\n walker  ', lkp: { lat: 51.2094123456, lon: -2.6476987654 }, k9Uid: 'k9', uid: 'chief', now: 1000 });
  assert.equal(d.name, 'Missing walker');
  assert.deepEqual(d.lkp, { lat: 51.209412, lon: -2.647699 });
  assert.equal(d.status, 'active');
  assert.equal(d.expiresAt, 1000 + 7 * 864e5);
  assert.equal(cleanIncident({ ...d, lkp: { lat: 99, lon: 0 } }, 'i'), null, 'no last known point, no incident');
  const c = cleanIncident({ ...d, status: 'weird', summary: { durationMs: 'x', k9M: 400 } }, 'i');
  assert.equal(c.status, 'active');
  assert.deepEqual(c.summary, { durationMs: 0, k9M: 400, marks: 0, units: 0 });
  const all = new Map([['a', { ...c, id: 'a', startedAt: 1 }], ['b', { ...c, id: 'b', startedAt: 5 }],
                       ['c', { ...c, id: 'c', status: 'ended', endedAt: 9 }]]);
  assert.equal(activeOf(all).id, 'b', 'the newest active one is in force');
  assert.deepEqual(pastOf(all).map(i => i.id), ['c']);
  // A point and a line.
  const p = markDoc({ kind: 'roadblock', uid: 'ofc', at: 5, lat: 51.1234567, lon: -2.1 });
  assert.deepEqual([p.lat, p.pts, p.label], [51.123457, null, null]);
  const line = markDoc({ kind: 'perimeter', uid: 'ofc', at: 5, pts: Array.from({ length: 300 }, (_, i) => ({ lat: 51 + i * 1e-4, lon: -2 })) });
  assert.equal(line.pts.length, 200, 'a line is bounded, as the rules say');
  assert.equal(line.lat, null);
  assert.equal(cleanMark({ ...line, pts: [{ lat: 51, lon: -2 }] }, 'm'), null, 'a line of one point is not a line');
  assert.equal(cleanMark({ ...p, kind: 'nuke' }, 'm'), null);
  assert.equal(cleanMark({ ...p, lat: 'x' }, 'm'), null);
  assert.equal(cleanMark({ ...p, label: 'x'.repeat(99) }, 'm').label.length, 60);
  // Who may mark.
  const inc = { status: 'active', k9Uid: 'k9' };
  assert.ok(mayMark(inc, 'k9', 'indication'));
  assert.ok(!mayMark(inc, 'ofc', 'lost'), 'the scent calls are the trailing team’s');
  assert.ok(mayMark(inc, 'ofc', 'roadblock'));
  assert.ok(!mayMark({ ...inc, status: 'ended' }, 'ofc', 'roadblock'));
  assert.ok(mayUnmark({ by: 'ofc' }, 'ofc', false) && mayUnmark({ by: 'ofc' }, 'chief', true) && !mayUnmark({ by: 'ofc' }, 'k9', false));
  // The run screen's marks, as the incident knows them; Reward stays the dog's.
  assert.deepEqual(Object.values(RUN_MARKS), ['indication', 'lost', 'refound', 'article']);
  for (const k of DRAW_TOOLS) assert.ok(MARKS[k] && !MARKS[k].k9);
  assert.equal(countWords('roadblock', 3), '3 roadblocks');
  assert.equal(countWords('perimeter', 1), '1 perimeter line');
  // A name from another phone reaches the page escaped.
  const evil = '<img src=x onerror=alert(1)>';
  const out = html`<h3>${cleanIncident({ ...d, name: evil }, 'i').name}</h3>`;
  assert.doesNotMatch(Object.getOwnPropertySymbols(out).map(k => out[k])[0], /<img/);
});

t('a member’s movements go a minute to a document, in order, and a failed send goes again', () => {
  const b = trackBuffer(10_000);
  assert.ok(b.add({ lat: 51, lon: -2, t: 10_500 }));
  assert.ok(!b.add({ lat: 51, lon: -2, t: 10_500 }), 'nothing older than the last fix');
  assert.ok(!b.add({ lat: 'x', lon: -2, t: 11_000 }));
  b.add({ lat: 51.0001, lon: -2, t: 70_100 });
  b.add({ lat: 51.0002, lon: -2, t: 71_000 });
  const sent = b.take();
  assert.deepEqual(sent.map(x => [x.n, x.t.length]), [[0, 1], [1, 2]]);
  assert.equal(b.pending, 0);
  b.again(1);
  assert.deepEqual(b.take().map(x => x.n), [1]);
  assert.equal(minuteOf(10_000, 5_000), 0, 'a fix from before the start counts in the first minute');
  assert.equal(minuteOf(0, 99 * 864e5), 2880, 'never past the rules’ last minute');
  const full = trackBuffer(0);
  for (let i = 1; i <= 650; i++) full.add({ lat: 51, lon: -2, t: i * 50 });
  assert.equal(full.take()[0].t.length, 600, 'a minute holds what the rules allow');
  // Read back: the account is the document's name, whatever it says inside.
  const tr = cleanTrack({ uid: 'evil', lat: [51, 'x', 51.1], lon: [-2, -2, -2.1], t: [1, 2, 3], cs: 'K9-1', role: 'boss' }, 'k9_4');
  assert.deepEqual([tr.uid, tr.n, tr.pts.length, tr.callSign, tr.role], ['k9', 4, 2, 'K9-1', '']);
  const lines = joinTracks([cleanTrack({ lat: [51.2], lon: [-2], t: [70e3] }, 'a_1'), cleanTrack({ lat: [51.1, 51.2], lon: [-2, -2], t: [10e3, 70e3] }, 'a_0')]);
  assert.deepEqual(lines.get('a').pts.map(p => p.t), [10e3, 70e3], 'in time order, once each');
});

t('the trail’s heading is worked over the last 40 m, with the time since the start', () => {
  const lkp = { lat: 51.2094, lon: -2.6476 };
  const inc = { lkp, startedAt: 0, endedAt: null };
  assert.equal(trailInfo([], inc, 65e3).heading, null);
  assert.equal(elapsedWords(trailInfo([], inc, 65e3).elapsedMs), '1 min');
  const trail = [lkp];
  for (let i = 1; i <= 10; i++) trail.push(project(trail[i - 1], 90, 10));
  // A dog casting a few metres to the side at the end does not swing the way.
  trail.push(project(trail[10], 0, 4));
  const info = trailInfo(trail, inc, 600e3);
  assert.ok(Math.abs(info.heading - 90) < 10, `heading ${info.heading}`);
  assert.equal(info.compass, 'E');
  assert.ok(info.lengthM >= 100 && info.fromLkpM >= 99);
  const ahead = aheadLine(info, 150);
  assert.ok(Math.abs(ahead[1].lon - ahead[0].lon) > 0.001, 'a line ahead, the way it goes');
  assert.equal(aheadLine(trailInfo(trail.slice(0, 3), inc, 1)), null, 'not until the way is known');
  assert.equal(elapsedWords(3725e3), '1 h 02');
  assert.equal(clockWords(3725e3), '1:02:05');
  assert.equal(clockWords(65e3), '01:05');
});

t('the replay moves everyone smoothly between fixes, never across a long gap, and shows marks as they were made', () => {
  const inc = { id: 'i', name: 'X', lkp: { lat: 51, lon: -2 }, k9Uid: 'k9', startedAt: 0, endedAt: 600e3 };
  const tracks = new Map([
    ['k9', { uid: 'k9', callSign: 'K9-1', role: 'k9', pts: [{ lat: 51, lon: -2, t: 0 }, { lat: 51.001, lon: -2, t: 60e3 }, { lat: 51.002, lon: -2, t: 120e3 }] }],
    ['ofc', { uid: 'ofc', callSign: '', role: '', pts: [{ lat: 51, lon: -2.01, t: 30e3 }, { lat: 51, lon: -2.02, t: 400e3 }] }],
  ]);
  const marks = [{ id: 'm1', kind: 'lost', by: 'k9', at: 90e3, lat: 51.0015, lon: -2 }];
  const members = new Map([['ofc', { uid: 'ofc', role: 'officer', callSign: '2A12', name: 'Martin', dog: null }]]);
  const rp = buildReplay({ inc, tracks, marks, members });
  assert.equal(rp.end, 600e3);
  assert.equal(rp.units.find(u => u.uid === 'ofc').callSign, '2A12', 'a member’s current name first');
  assert.equal(rp.units.find(u => u.uid === 'k9').callSign, 'K9-1', 'else the one the track carried');
  const mid = placeAt(tracks.get('k9').pts, 30e3);
  assert.ok(Math.abs(mid.lat - 51.0005) < 1e-9 && mid.at === 30e3 && mid.spd > 1);
  assert.equal(placeAt(tracks.get('ofc').pts, 10e3), null, 'not there before their first fix');
  const gap = placeAt(tracks.get('ofc').pts, 200e3);
  assert.equal(gap.lon, -2.01, 'a six-minute gap is not filled with a made-up line');
  assert.equal(gap.at, 30e3, 'so they go grey, as they did live');
  const early = replayAt(rp, 60e3), late = replayAt(rp, 100e3);
  assert.equal(early.marks.length, 0);
  assert.equal(late.marks.length, 1);
  assert.ok(late.trail.length > early.trail.length, 'the trail grows');
  assert.equal(late.positions.get('k9').at, 100e3);
  assert.equal(late.members.get('ofc').callSign, '2A12');
});

t('the pretend incident plays out on one device: trail, calls, perimeter, roadblocks, sighting, end and replay', () => {
  const center = { lat: 51.2094, lon: -2.6476 };
  const t0 = 1_800_000_000_000;
  const path = scentPath({ lkp: center, seed: 5 });
  assert.ok(path.lostAt > 0 && path.refoundAt > path.lostAt, 'the dog loses it, then picks it up');
  const sim = createSim({ center, now: t0, seed: 11 });
  const k9 = sim.unit('sim-1');
  const lkp = project(k9, 30, 120);
  const si = createSimIncident({ sim, lkp, k9Uid: 'sim-1', name: 'Missing <b>walker</b>', now: t0, seed: 5 });
  assert.equal(si.phase, 'responding');
  let t = t0;
  const order = [];
  while (t < t0 + 40 * 60e3 && si.phase !== 'found') {
    t += 4000;
    sim.step(t);
    si.step(t);
    for (const m of si.marks.values()) if (!order.includes(m.kind)) order.push(m.kind);
  }
  assert.equal(si.phase, 'found', 'the team reaches the person');
  assert.ok(order.indexOf('lost') < order.indexOf('refound'), `calls in order: ${order}`);
  assert.ok(order.indexOf('refound') < order.indexOf('indication'));
  for (const k of ['perimeter', 'rally', 'roadblock', 'sighting']) assert.ok(order.includes(k), `a ${k}`);
  const marks = [...si.marks.values()];
  assert.equal(marks.find(m => m.kind === 'perimeter').by, 'sim-7', 'the sergeant sets the perimeter');
  assert.equal(marks.filter(m => m.kind === 'roadblock').length, 2, 'both cars at their roadblocks');
  assert.ok(marks.every(m => m.kind === 'perimeter' ? m.pts.length > 3 : Number.isFinite(m.lat)));
  assert.ok(si.trail.length > 50 && dist(si.trail[0], lkp) < 10, 'the trail starts at the last known point');
  // The person at the screen draws too, and can take it back.
  const id = si.addMark({ kind: 'roadblock', by: 'you', at: t, lat: center.lat, lon: center.lon });
  si.removeMark(id);
  assert.ok(!si.marks.has(id));
  si.end(t + 1000);
  assert.equal(si.inc.status, 'ended');
  assert.ok(si.inc.summary.k9M > 500 && si.inc.summary.marks >= 7);
  const before = si.marks.size;
  si.step(t + 60e3);
  assert.equal(si.marks.size, before, 'nothing more happens once it is ended');
  const rp = si.replay(sim.members());
  assert.equal(rp.units.length, 7, 'everyone’s movements, for the debrief');
  const k9Line = rp.units.find(u => u.uid === 'sim-1');
  assert.ok(k9Line.pts.length > si.trail.length - 1, 'the team’s fine trail is in the replay');
  const endScene = replayAt(rp, rp.end);
  assert.equal(endScene.marks.length, si.marks.size);
  // Same seed, same incident: a test sees the same thing every time.
  const sim2 = createSim({ center, now: t0, seed: 11 });
  const si2 = createSimIncident({ sim: sim2, lkp, k9Uid: 'sim-1', now: t0, seed: 5 });
  for (let x = t0 + 4000; x <= t0 + 300e3; x += 4000) { sim2.step(x); si2.step(x); }
  assert.ok(si2.trail.length > 5);
});

t('a pretend incident far from the K9 team starts it a short walk away, not minutes off', () => {
  const center = { lat: 51.2094, lon: -2.6476 };
  const t0 = 1_800_000_000_000;
  const sim = createSim({ center, now: t0, seed: 11 });
  const lkp = project(sim.unit('sim-1'), 90, 600);
  const si = createSimIncident({ sim, lkp, k9Uid: 'sim-1', now: t0, seed: 5 });
  const d = dist(sim.unit('sim-1'), lkp);
  assert.ok(d > 50 && d < 70, `the team starts ~60 m from the point (was ${Math.round(d)} m)`);
  let t = t0;
  while (si.phase === 'responding' && t < t0 + 5 * 60e3) { t += 1000; sim.step(t); si.step(t); }
  assert.notEqual(si.phase, 'responding', 'trailing within a minute or two of pretend time');
  assert.ok(t - t0 < 2 * 60e3);
});

t('a handler’s run reaches the incident only on duty, and only after Start trailing', () => {
  const inc = { id: 'i1', status: 'active', k9Uid: 'k9' };
  assert.equal(mayShareRun({ inc, me: 'k9', onDuty: true, consent: 'i1' }), true);
  assert.equal(mayShareRun({ inc, me: 'k9', onDuty: false, consent: 'i1' }), false, 'off duty: nothing goes');
  assert.equal(mayShareRun({ inc, me: 'k9', onDuty: true, consent: null }), false, 'picked, but never pressed Start trailing');
  assert.equal(mayShareRun({ inc, me: 'k9', onDuty: true, consent: 'old' }), false, 'a yes to another incident');
  assert.equal(mayShareRun({ inc, me: 'ofc', onDuty: true, consent: 'i1' }), false, 'not the trailing team');
  assert.equal(mayShareRun({ inc: { ...inc, status: 'ended' }, me: 'k9', onDuty: true, consent: 'i1' }), false);
  // The incident layer goes by it: tracks and marks from the run, the
  // flush, and the duty positions all stop with the switch off.
  const ui = read('public/incident-ui.js');
  const fn = (name) => ui.slice(ui.indexOf(`function ${name}(`), ui.indexOf('\n}\n', ui.indexOf(`function ${name}(`)));
  assert.match(fn('everySecond'), /const r = sharingRun\(\) \? runGoing\(\) : null;/);
  assert.match(fn('flush'), /if \(!sq\(\)\.onDuty\) return;/);
  assert.match(fn('onSent'), /!sq\(\)\.onDuty/);
  assert.match(fn('startTrailing'), /if \(!sq\(\)\.onDuty\) return[\s\S]*I\.consent = I\.active\.id;/);
  assert.match(fn('stopContributing'), /I\.consent = null;/);
  assert.match(ui, /mayShareRun\(\{ inc: I\.active, me: sq\(\)\.me, onDuty: sq\(\)\.onDuty, consent: I\.consent \}\)/);
});

t('the command map keeps Mapbox’s marker classes, keeps rows under a finger, and skips the gestures card', () => {
  const ui = read('public/squad-ui.js');
  const markers = ui.slice(ui.indexOf('function paintMarkers('), ui.indexOf('function turnArrows('));
  assert.doesNotMatch(markers, /m\.el\.className\s*=/, 'className is never reassigned once Mapbox has added its own');
  assert.match(markers, /el\.className = 'sq-unit';[\s\S]*new g\.GL\.Marker/, 'set once, before the marker is made');
  assert.match(read('public/app.css'), /\.sq-unit \{ position: absolute; top: 0; left: 0;/);
  const paint = ui.slice(ui.indexOf('function paintCommand('), ui.indexOf('function commandRow('));
  assert.doesNotMatch(paint.slice(0, paint.indexOf('function paintList(')), /put\(\$\('cmdList'\)/, 'the list is not rebuilt every tick');
  assert.match(paint, /if \(key !== listKey/);
  assert.match(read('public/app.js'), /!mapTut\.held && id !== 'scrCommand'\) openMapTut\(\)/);
  // Duty: a start overtaken by a stop undoes itself; a heartbeat while still.
  const start = ui.slice(ui.indexOf('async function startDuty('), ui.indexOf('export async function stopDuty('));
  assert.match(start, /const gen = \+\+dutyGen;/);
  assert.match(start, /if \(gen !== dutyGen\) \{ try \{ bg\?\.stop\?\.\(\); \}/);
  assert.ok(start.indexOf('duty.bg = bg;') > start.indexOf('if (gen !== dutyGen) { try'), 'the watcher is kept only after the check');
  assert.match(start, /duty\.beat = setInterval/);
  assert.match(ui.slice(ui.indexOf('export async function stopDuty(')), /dutyGen\+\+;[\s\S]*clearInterval\(duty\.beat\)/);
  // Account deletion takes the person out of the squad, after the password.
  assert.match(read('public/app.js'), /deleteAccount\(\{ password, beforeDelete: squadForget \}\)/);
  const sync = read('public/sync.js');
  assert.ok(sync.indexOf('await beforeDelete?.()') > sync.indexOf('reauthenticateWithCredential'), 'only once the password is proved');
  assert.ok(sync.indexOf('await beforeDelete?.()') < sync.indexOf('await f.deleteUser(u)'));
  // The account's own name never goes to the squad.
  assert.doesNotMatch(ui, /displayName: ctx\.user\(\)/);
});

t('every element the squad screens use is in the page', () => {
  const ui = read('public/squad-ui.js');
  const page = read('public/index.html');
  const ids = new Set([...ui.matchAll(/\$\('([\w-]+)'\)/g)].map(m => m[1]));
  assert.ok(ids.size > 30);
  for (const id of ids) assert.ok(page.includes(`id="${id}"`), `squad-ui.js uses #${id}, which index.html does not have`);
});

/* ── The cloud: phones on the fake, under the rules ─────────────────── */
let clock = 1_760_000_000_000;
Date.now = () => (clock += 1);
const phone = (uid) => {
  fake.startSignedIn(uid ? { uid, displayName: uid, email: `${uid}@example.com`, emailVerified: true } : null);
  const app = fake.initializeApp({});
  fake.getAuth(app);
  const fs = fake.initializeFirestore(app);
  return { f: fake, fs, uid };
};
const refused = async (p, what) => {
  await assert.rejects(p, (e) => e.code === 'permission-denied', `${what} should be refused`);
};

const chief = phone('chief');
const k9 = phone('k9');
const ofc = phone('ofc');
const stranger = phone('stranger');
let sq;

t('a chief makes a squad: Command, a code that leads to it, and nothing a stranger can read', async () => {
  sq = await createSquad(chief, { name: 'Wells K9 & patrol', callSign: 'Chief', displayName: 'Ann' });
  assert.match(sq.id, /^[A-Za-z0-9]{20}$/);
  assert.equal(codeFromText(sq.code), sq.code);
  const mine = await myMember(chief, sq.id);
  assert.equal(mine.role, 'command');
  assert.equal(fake.cloudDoc(`squads/${sq.id}`).createdBy, 'chief');
  // A stranger with the code learns the name, and nothing else.
  const found = await findSquad(stranger, sq.code);
  assert.deepEqual(found, { id: sq.id, name: 'Wells K9 & patrol', by: 'Chief', code: sq.code });
  assert.equal(await findSquad(stranger, 'ABCDEFGH'), null);
  await refused(fake.getDoc(fake.doc(stranger.fs, 'squads', sq.id)), 'a stranger reading the squad');
  await refused(fake.getDocs(fake.collection(stranger.fs, 'squads', sq.id, 'members')), 'a stranger listing members');
  await refused(fake.getDocs(fake.collection(stranger.fs, 'joinCodes')), 'listing join codes');
  await refused(fake.getDocs(fake.collection(stranger.fs, 'squads')), 'listing squads');
  assert.equal(await myMember(stranger, sq.id), null);
  // Signed out, not even a code.
  const nobody = phone(null);
  await refused(fake.getDoc(fake.doc(nobody.fs, 'joinCodes', sq.code)), 'reading a code signed out');
  // Nobody makes a squad in someone else's name, or without being its Command.
  const b = fake.writeBatch(stranger.fs);
  b.set(fake.doc(stranger.fs, 'squads', 'fakeSquad'), { name: 'X', code: 'ABCDEFGH', createdBy: 'chief', createdAt: 1, v: 1, demo: true });
  await refused(b.commit(), 'a squad made in the chief’s name');
  const lone = fake.writeBatch(stranger.fs);
  lone.set(fake.doc(stranger.fs, 'squads', 'lone'), { name: 'X', code: 'ABCDEFGH', createdBy: 'stranger', createdAt: 1, v: 1, demo: true });
  await refused(lone.commit(), 'a squad with no Command record in the same batch');
});

t('joining needs the code the squad holds, and never makes you Command', async () => {
  await refused(joinSquad(k9, { id: sq.id, code: 'ABCDEFGH', role: 'k9', callSign: 'K9-1', dog: 'Rex' }), 'the wrong code');
  await refused(fake.setDoc(fake.doc(k9.fs, 'squads', sq.id, 'members', 'k9'),
    { uid: 'k9', role: 'command', callSign: 'K9-1', name: '', dog: null, joinedAt: 1, code: sq.code }), 'joining as Command');
  await refused(fake.setDoc(fake.doc(k9.fs, 'squads', sq.id, 'members', 'ofc'),
    { uid: 'ofc', role: 'officer', callSign: 'X', name: '', dog: null, joinedAt: 1, code: sq.code }), 'joining someone else');
  await refused(fake.setDoc(fake.doc(k9.fs, 'squads', sq.id, 'members', 'k9'),
    { uid: 'k9', role: 'k9', callSign: 'K9-1', name: '', dog: 'Rex', joinedAt: 1, code: sq.code, admin: true }), 'a field the app never writes');
  await joinSquad(k9, { id: sq.id, code: sq.code, role: 'k9', callSign: 'K9-1', dog: 'Rex', displayName: 'Reyes' });
  await joinSquad(ofc, { id: sq.id, code: sq.code, role: 'officer', callSign: '2A12', dog: 'Ignored' });
  assert.equal((await myMember(k9, sq.id)).dog, 'Rex');
  assert.equal((await myMember(ofc, sq.id)).dog, null);
  // Members read the squad; they cannot make themselves Command afterwards.
  assert.ok((await fake.getDoc(fake.doc(ofc.fs, 'squads', sq.id))).exists());
  await refused(fake.setDoc(fake.doc(ofc.fs, 'squads', sq.id, 'members', 'ofc'), { role: 'command' }, { merge: true }), 'promoting yourself');
  await refused(setRole(k9, sq.id, 'ofc', 'command'), 'a K9 handler promoting');
  // Switching between K9 and officer on your own record is fine.
  await joinSquad(ofc, { id: sq.id, code: sq.code, role: 'officer', callSign: '2A12 Martin' });
  assert.equal((await myMember(ofc, sq.id)).callSign, '2A12 Martin');
});

t('on duty: a member writes only their own position, bounded and with a TTL; off duty it is gone', async () => {
  await putPosition(k9, sq.id, { lat: 51.21, lon: -2.65, acc: 6, hdg: 80, spd: 1.3 });
  const p = fake.cloudDoc(`squads/${sq.id}/positions/k9`);
  assert.equal(p.uid, 'k9');
  assert.ok(p.deleteAt.toMillis() === p.expiresAt && p.expiresAt - p.at === POSITION_TTL, 'TTL as a Timestamp for the clean-up');
  await refused(fake.setDoc(fake.doc(k9.fs, ...PATHS.position(sq.id, 'ofc')),
    { uid: 'ofc', lat: 1, lon: 1, at: 1, expiresAt: Date.now() + 1e3, deleteAt: fake.Timestamp.fromMillis(Date.now() + 1e3) }), 'writing someone else’s position');
  const base = { uid: 'k9', lat: 1, lon: 1, at: 1 };
  await refused(fake.setDoc(fake.doc(k9.fs, ...PATHS.position(sq.id, 'k9')), { ...base, expiresAt: Date.now() + 1e3 }), 'a position the clean-up would never delete');
  const far = Date.now() + 13 * 3600e3;
  await refused(fake.setDoc(fake.doc(k9.fs, ...PATHS.position(sq.id, 'k9')),
    { ...base, expiresAt: far, deleteAt: fake.Timestamp.fromMillis(far) }), 'a position kept more than twelve hours');
  const soon = Date.now() + 3600e3;
  await refused(fake.setDoc(fake.doc(k9.fs, ...PATHS.position(sq.id, 'k9')),
    { ...base, lat: 91, expiresAt: soon, deleteAt: fake.Timestamp.fromMillis(soon) }), 'a place that is not on Earth');
  await refused(putPosition(stranger, sq.id, { lat: 1, lon: 1 }), 'a stranger putting themselves on the map');
  await refused(fake.getDocs(fake.collection(stranger.fs, ...PATHS.positions(sq.id))), 'a stranger reading positions');
  await clearPosition(k9, sq.id);
  assert.equal(fake.cloudDoc(`squads/${sq.id}/positions/k9`), null);
});

t('command follows the squad live, and a member removed is cut off at once', async () => {
  const seen = [];
  const stop = watchSquad(chief, sq.id, (u) => seen.push(u));
  const k9Seen = [];
  const stopK9 = watchSquad(k9, sq.id, (u) => k9Seen.push(u));
  const ofcSeen = [];
  watchSquad(ofc, sq.id, (u) => ofcSeen.push(u));
  await settle();
  const last = () => seen[seen.length - 1];
  assert.equal(last().squad.name, 'Wells K9 & patrol');
  assert.deepEqual([...last().members.keys()].sort(), ['chief', 'k9', 'ofc']);
  assert.equal(last().positions.size, 0);
  await putPosition(ofc, sq.id, { lat: 51.2, lon: -2.64, acc: 5, hdg: 10, spd: 9 });
  await settle();
  assert.equal(last().positions.get('ofc').lat, 51.2, 'command sees the officer the moment they write');
  assert.equal(k9Seen[k9Seen.length - 1].positions.get('ofc').lat, 51.2, 'and so does the K9 team');
  // A stranger watching is refused outright.
  const strangerSeen = [];
  watchSquad(stranger, sq.id, (u) => strangerSeen.push(u));
  await settle();
  assert.deepEqual(strangerSeen, [{ gone: true }]);
  // Promote, then the new Command removes the officer.
  await setRole(chief, sq.id, 'k9', 'command');
  await settle();
  assert.equal(last().members.get('k9').role, 'command');
  await refused(setRole(k9, sq.id, 'chief', 'officer'), 'stepping the creator down');
  await refused(removeMember(k9, sq, 'chief'), 'removing the creator');
  const before = sq.code;
  const fresh = await removeMember(k9, sq, 'ofc', { by: 'K9-1' });
  sq = { ...sq, code: fresh };
  await settle();
  assert.notEqual(fresh, before, 'removing someone changes the code');
  assert.equal(last().squad.code, fresh);
  assert.equal(await findSquad(stranger, before), null, 'the old code leads nowhere');
  await refused(joinSquad(ofc, { id: sq.id, code: before, role: 'officer', callSign: 'Back again' }), 'the removed officer rejoining with the old code');
  assert.ok(!last().members.has('ofc') && !last().positions.has('ofc'), 'gone from the map and the list');
  assert.deepEqual(ofcSeen[ofcSeen.length - 1], { gone: true }, 'the removed officer’s screen is told');
  await refused(fake.getDoc(fake.doc(ofc.fs, 'squads', sq.id)), 'the removed officer reading on');
  await refused(putPosition(ofc, sq.id, { lat: 1, lon: 1 }), 'the removed officer still sharing');
  // Step the K9 handler back down to K9.
  await setRole(chief, sq.id, 'k9', 'k9');
  stop(); stopK9();
});

t('a new code locks out the old one; the creator cannot leave, others can', async () => {
  const old = sq.code;
  await refused(newCode(k9, { ...sq }), 'a K9 handler making a new code');
  const fresh = await newCode(chief, sq);
  assert.notEqual(fresh, old);
  assert.equal(await findSquad(stranger, old), null, 'the old code leads nowhere');
  await refused(joinSquad(ofc, { id: sq.id, code: old, role: 'officer', callSign: '2A12' }), 'rejoining with the old code');
  await joinSquad(ofc, { id: sq.id, code: fresh, role: 'officer', callSign: '2A12' });
  sq = { ...sq, code: fresh };
  await refused(leaveSquad(chief, sq.id), 'the creator leaving');
  await leaveSquad(ofc, sq.id);
  assert.equal(await myMember(ofc, sq.id), null);
});

t('incidents: Command starts one; the K9 team alone calls the scent; anyone drops a roadblock', async () => {
  const at = Date.now();
  const week = { expiresAt: at + 7 * 864e5, deleteAt: fake.Timestamp.fromMillis(at + 7 * 864e5) };
  const inc = { name: 'Missing walker', lkp: { lat: 51.21, lon: -2.65 }, k9Uid: 'k9', startedBy: 'chief',
                startedAt: at, endedAt: null, status: 'active', ...week };
  await joinSquad(ofc, { id: sq.id, code: sq.code, role: 'officer', callSign: '2A12' });
  await refused(fake.setDoc(fake.doc(ofc.fs, ...PATHS.incident(sq.id, 'i1')), { ...inc, startedBy: 'ofc' }), 'an officer starting an incident');
  await fake.setDoc(fake.doc(chief.fs, ...PATHS.incident(sq.id, 'i1')), inc);
  const mark = (by, kind) => ({ kind, by, at: Date.now(), lat: 51.211, lon: -2.651, label: null, ...week });
  await fake.setDoc(fake.doc(k9.fs, ...PATHS.mark(sq.id, 'i1', 'k9_0')), mark('k9', 'indication'));
  await refused(fake.setDoc(fake.doc(ofc.fs, ...PATHS.mark(sq.id, 'i1', 'ofc_0')), mark('ofc', 'indication')), 'an officer calling an indication');
  await fake.setDoc(fake.doc(ofc.fs, ...PATHS.mark(sq.id, 'i1', 'ofc_1')), mark('ofc', 'roadblock'));
  await refused(fake.setDoc(fake.doc(ofc.fs, ...PATHS.mark(sq.id, 'i1', 'ofc_2')), mark('k9', 'roadblock')), 'a mark in someone else’s name');
  await refused(fake.getDocs(fake.collection(stranger.fs, ...PATHS.marks(sq.id, 'i1'))), 'a stranger reading the marks');
  const track = { uid: 'k9', n: 0, lat: [51.21], lon: [-2.65], t: [at], ...week };
  await fake.setDoc(fake.doc(k9.fs, ...PATHS.track(sq.id, 'i1', 'k9', 0)), track);
  await refused(fake.setDoc(fake.doc(ofc.fs, ...PATHS.track(sq.id, 'i1', 'k9', 1)), { ...track, n: 1 }), 'writing the K9 team’s track');
  // Ended: no more marks.
  await fake.setDoc(fake.doc(chief.fs, ...PATHS.incident(sq.id, 'i1')), { ...inc, status: 'ended', endedAt: Date.now() });
  await refused(fake.setDoc(fake.doc(ofc.fs, ...PATHS.mark(sq.id, 'i1', 'ofc_3')), mark('ofc', 'sighting')), 'a mark on an ended incident');
});

t('an incident in the cloud: every member hears of it, sees the trail and the marks, and the end is final', async () => {
  await refused(startIncident(ofc, sq.id, { name: 'X', lkp: { lat: 51.2, lon: -2.6 }, k9Uid: 'k9' }), 'an officer starting an incident');
  const heard = { ofc: null, k9: null };
  const offA = watchIncidents(ofc, sq.id, (all) => { heard.ofc = all; });
  const offB = watchIncidents(k9, sq.id, (all) => { heard.k9 = all; });
  const inc = await startIncident(chief, sq.id, { name: 'Missing walker', lkp: { lat: 51.2094, lon: -2.6476 }, k9Uid: 'k9' });
  await settle();
  assert.equal(activeOf(heard.ofc).id, inc.id, 'the officer hears of it');
  assert.equal(activeOf(heard.k9).k9Uid, 'k9', 'the K9 team knows it is theirs');
  await refused(fake.getDocs(fake.collection(stranger.fs, ...PATHS.incidents(sq.id))), 'a stranger reading incidents');

  // The officer follows it: the trailing team's track arrives, and only theirs.
  let live = null;
  const offC = watchIncident(ofc, sq.id, inc, (u) => { live = u; });
  const kb = trackBuffer(inc.startedAt);
  for (let i = 0; i < 5; i++) kb.add({ lat: 51.2094 + i * 1e-4, lon: -2.6476, t: inc.startedAt + 1000 + i * 15e3 });
  for (const doc of kb.take()) await putTrack(k9, sq.id, inc.id, doc, { callSign: 'K9-1', role: 'k9' });
  const ob = trackBuffer(inc.startedAt);
  ob.add({ lat: 51.21, lon: -2.64, t: inc.startedAt + 2000 });
  for (const doc of ob.take()) await putTrack(ofc, sq.id, inc.id, doc, { callSign: '2A12', role: 'officer' });
  await refused(fake.setDoc(fake.doc(ofc.fs, ...PATHS.track(sq.id, inc.id, 'k9', 9)), { uid: 'k9', n: 9, lat: [], lon: [], t: [],
    expiresAt: Date.now() + 1000, deleteAt: fake.Timestamp.fromMillis(Date.now() + 1000) }), 'writing the K9 team’s track');
  await settle();
  assert.equal(live.trail.length, 5, 'the trail, from the K9 team’s track alone');

  // Marks: the team calls the scent, an officer draws a perimeter, nobody else calls the scent.
  await putMark(k9, sq.id, inc.id, { kind: 'indication', lat: 51.2097, lon: -2.6476 });
  await refused(putMark(ofc, sq.id, inc.id, { kind: 'lost', lat: 51.21, lon: -2.64 }), 'an officer calling lost it');
  const pid = await putMark(ofc, sq.id, inc.id, { kind: 'perimeter', pts: [{ lat: 51.21, lon: -2.65 }, { lat: 51.211, lon: -2.64 }, { lat: 51.208, lon: -2.64 }] });
  const rb = await putMark(ofc, sq.id, inc.id, { kind: 'roadblock', lat: 51.21, lon: -2.64, label: '<b>A39</b>' });
  await refused(removeMark(k9, sq.id, inc.id, rb), 'taking back someone else’s mark');
  await removeMark(chief, sq.id, inc.id, rb);
  await settle();
  assert.deepEqual([...live.marks.values()].map(m => m.kind).sort(), ['indication', 'perimeter']);
  assert.equal(live.marks.get(pid).pts.length, 3);

  // Ended: final. No reopening, no more marks; the last minute of a track still lands.
  const summary = summarise({ inc, trail: live.trail, marks: live.marks, units: 3, now: Date.now() });
  await refused(endIncident(ofc, sq.id, inc, summary), 'an officer ending it');
  await endIncident(chief, sq.id, inc, summary);
  await settle();
  assert.equal(activeOf(heard.ofc), null);
  assert.equal(pastOf(heard.ofc)[0].summary.k9M, summary.k9M);
  await refused(fake.setDoc(fake.doc(chief.fs, ...PATHS.incident(sq.id, inc.id)),
    { ...fake.cloudDoc(`squads/${sq.id}/incidents/${inc.id}`), status: 'active', endedAt: null }), 'reopening an ended incident');
  await refused(putMark(ofc, sq.id, inc.id, { kind: 'sighting', lat: 51.21, lon: -2.64 }), 'a mark after the end');
  ob.add({ lat: 51.2101, lon: -2.64, t: inc.startedAt + 70e3 });
  for (const doc of ob.take()) await putTrack(ofc, sq.id, inc.id, doc, { callSign: '2A12', role: 'officer' });
  await refused(putTrack(ofc, sq.id, 'noSuchIncident', { n: 0, lat: [51], lon: [-2], t: [1] }, {}), 'a track for no incident');

  // The debrief: everyone's movements and the marks, read once.
  const { tracks, marks } = await loadIncident(ofc, sq.id, inc.id);
  assert.deepEqual([...tracks.keys()].sort(), ['k9', 'ofc']);
  assert.equal(tracks.get('ofc').pts.length, 2);
  const rp = buildReplay({ inc: pastOf(heard.ofc)[0], tracks, marks, members: new Map() });
  assert.equal(rp.units.find(u => u.uid === 'k9').callSign, 'K9-1', 'a name even for someone no longer listed');
  assert.equal(replayAt(rp, rp.end).marks.length, 2);
  await refused(loadIncident(stranger, sq.id, inc.id), 'a stranger loading the replay');
  offA(); offB(); offC();
});

t('an ended incident is final, and phones cannot fake the time or flood the squad', async () => {
  const at = Date.now();
  const week = () => ({ expiresAt: Date.now() + 7 * 864e5, deleteAt: fake.Timestamp.fromMillis(Date.now() + 7 * 864e5) });
  const inc = { name: 'Late test', lkp: { lat: 51.21, lon: -2.65 }, k9Uid: 'k9', startedBy: 'chief',
                startedAt: at, endedAt: null, status: 'active', ...week() };
  await fake.setDoc(fake.doc(chief.fs, ...PATHS.incident(sq.id, 'i2')), inc);
  const track = (uid, n) => ({ uid, n, lat: [51.21], lon: [-2.65], t: [Date.now()], ...week() });
  await fake.setDoc(fake.doc(k9.fs, ...PATHS.track(sq.id, 'i2', 'k9', 0)), track('k9', 0));
  await refused(fake.setDoc(fake.doc(k9.fs, ...PATHS.track(sq.id, 'i2', 'k9', 30)), track('k9', 30)), 'a minute the incident has not reached yet');
  // Marks: a time near now, and an id of the member's own, numbered under 1000.
  const mark = (by, extra = {}) => ({ kind: 'sighting', by, at: Date.now(), lat: 51.211, lon: -2.651, label: null, ...week(), ...extra });
  await refused(fake.setDoc(fake.doc(ofc.fs, ...PATHS.mark(sq.id, 'i2', 'ofc_0')), mark('ofc', { at: Date.now() + 3600e3 })), 'a mark dated an hour ahead');
  await refused(fake.setDoc(fake.doc(ofc.fs, ...PATHS.mark(sq.id, 'i2', 'whatever')), mark('ofc')), 'a mark under an id of its own choosing');
  await refused(fake.setDoc(fake.doc(ofc.fs, ...PATHS.mark(sq.id, 'i2', 'ofc_1000')), mark('ofc')), 'a thousand-and-first mark');
  await refused(fake.setDoc(fake.doc(ofc.fs, ...PATHS.mark(sq.id, 'i2', 'k9_0')), mark('ofc')), 'a mark filed under another member');
  const mid = await putMark(ofc, sq.id, 'i2', { kind: 'roadblock', lat: 51.21, lon: -2.64 });
  const mid2 = await putMark(ofc, sq.id, 'i2', { kind: 'rally', lat: 51.21, lon: -2.64 });
  assert.equal(mid, 'ofc_0');
  assert.equal(mid2, 'ofc_1', 'each mark a number of its own, never written over the last');
  // A position dated ahead never turns grey: refused.
  const soon = Date.now() + 3600e3;
  await refused(fake.setDoc(fake.doc(ofc.fs, ...PATHS.position(sq.id, 'ofc')),
    { uid: 'ofc', lat: 51.2, lon: -2.6, at: Date.now() + 3600e3, expiresAt: soon, deleteAt: fake.Timestamp.fromMillis(soon) }), 'a position dated an hour ahead');
  await putPosition(ofc, sq.id, { lat: 51.2, lon: -2.6 });
  // Ended: the last minute lands for two minutes, then nothing changes.
  await fake.setDoc(fake.doc(chief.fs, ...PATHS.incident(sq.id, 'i2')), { ...inc, status: 'ended', endedAt: Date.now() });
  await fake.setDoc(fake.doc(k9.fs, ...PATHS.track(sq.id, 'i2', 'k9', 0)), track('k9', 0));
  clock += 130e3;
  await refused(fake.setDoc(fake.doc(k9.fs, ...PATHS.track(sq.id, 'i2', 'k9', 0)), track('k9', 0)), 'rewriting a track after the end');
  await refused(removeMark(ofc, sq.id, 'i2', mid), 'taking a mark back after the end');
  await setRole(chief, sq.id, 'k9', 'command');
  await refused(removeMark(k9, sq.id, 'i2', mid), 'a promoted Command deleting a mark after the end');
  await refused(fake.deleteDoc(fake.doc(k9.fs, ...PATHS.incident(sq.id, 'i2'))), 'a promoted Command deleting an ended incident');
  await refused(fake.deleteDoc(fake.doc(k9.fs, ...PATHS.track(sq.id, 'i2', 'k9', 0))), 'a promoted Command deleting a track');
  await setRole(chief, sq.id, 'k9', 'k9');
  await clearPosition(ofc, sq.id);
});

t('the incident screens write HTML only through html``, and use only elements the page has', () => {
  const ui = read('public/incident-ui.js');
  assert.doesNotMatch(ui, /innerHTML|insertAdjacentHTML|outerHTML|document\.write/, 'no HTML but through put(html``)');
  for (const m of ui.matchAll(/put\([^,]+,\s*([^)]{0,6})/g)) assert.match(m[1], /^html`|^panel/, 'put() is only ever given html``');
  assert.match(ui, /function panelHtml[\s\S]*?return html`/);
  const page = read('public/index.html');
  for (const m of ui.matchAll(/\$\('([\w-]+)'\)/g)) assert.ok(page.includes(`id="${m[1]}"`), `incident-ui.js uses #${m[1]}`);
  const banner = page.slice(page.indexOf('id="incBanner"'), page.indexOf('</div>', page.indexOf('id="incBanner"')));
  assert.doesNotMatch(banner, /<script|\son[a-z]+="/, 'no inline script or handler');
  // Every file the incident adds is cached for offline use and folded into the one-file build.
  const sw = read('public/sw.js'), build = read('scripts/build-single.mjs');
  for (const f of ['incident', 'incident-cloud', 'incident-ui']) {
    assert.ok(sw.includes(`'${f}.js'`), `sw.js caches ${f}.js`);
    assert.ok(build.includes(`'${f}'`), `the build folds in ${f}.js`);
  }
});

t('the creator deletes the squad: everything in it goes, and a tombstone keeps its id from coming back', async () => {
  await putPosition(k9, sq.id, { lat: 51.21, lon: -2.65 });
  await refused(deleteSquad(k9, sq), 'a member deleting the squad');
  await refused(fake.deleteDoc(fake.doc(chief.fs, ...PATHS.squad(sq.id))), 'deleting the squad outright, tombstone and all');
  assert.ok([...fake.cloud.docs.keys()].some(p => p.startsWith(`squads/${sq.id}/incidents/`)), 'there are incidents to delete');
  // A member the creator's phone has not heard of still goes: the cloud is asked.
  const late = phone('late');
  await joinSquad(late, { id: sq.id, code: sq.code, role: 'officer', callSign: 'Late' });
  await deleteSquad(chief, sq);
  const left = [...fake.cloud.docs.keys()].filter(p => p.startsWith(`squads/${sq.id}/`) || p.startsWith('joinCodes/'));
  assert.deepEqual(left, [], 'members, positions, incidents, marks, tracks and the code all gone');
  const tomb = fake.cloudDoc(`squads/${sq.id}`);
  assert.equal(tomb.gone, true);
  assert.ok(Object.keys(tomb).every(k => ['gone', 'createdBy', 'expiresAt', 'deleteAt'].includes(k)), 'nothing of the squad in its tombstone');
  assert.ok(tomb.deleteAt.toMillis() - Date.now() > 8 * 864e5 && tomb.deleteAt.toMillis() <= Date.now() + TOMBSTONE_MS, 'kept longer than any incident');
  // A former member who knew the id cannot make it again and read what was there.
  const b = fake.writeBatch(k9.fs);
  b.set(fake.doc(k9.fs, ...PATHS.squad(sq.id)), { name: 'Mine now', code: 'ABCDEFGH', createdBy: 'k9', createdAt: 1, v: 1, demo: true });
  b.set(fake.doc(k9.fs, ...PATHS.member(sq.id, 'k9')), { uid: 'k9', role: 'command', callSign: 'K9-1', name: '', dog: null, joinedAt: 1, code: 'ABCDEFGH' });
  await refused(b.commit(), 'making a deleted squad again under its old id');
  await refused(fake.setDoc(fake.doc(chief.fs, ...PATHS.squad(sq.id)), { name: 'Back', code: 'ABCDEFGH', createdBy: 'chief', createdAt: 1, v: 1, demo: true }), 'bringing a tombstone back');
  // Even a member record somehow left behind grants nothing on a tombstone.
  fake.cloud.docs.set(`squads/${sq.id}/members/k9`, { data: { uid: 'k9', role: 'command', callSign: 'K9-1', name: '', dog: null, joinedAt: 1 }, syncedAt: null });
  await refused(fake.getDoc(fake.doc(k9.fs, ...PATHS.squad(sq.id))), 'reading a deleted squad');
  await refused(fake.getDocs(fake.collection(k9.fs, ...PATHS.incidents(sq.id))), 'listing a deleted squad’s incidents');
  assert.equal(await getSquad(chief, sq.id).catch(() => null), null);
  fake.cloud.docs.delete(`squads/${sq.id}/members/k9`);
});

t('firestore.rules says what the fake’s copy of it relies on', () => {
  const rules = read('firestore.rules');
  const at = (s) => { const i = rules.indexOf(s); assert.ok(i > 0, `firestore.rules says: ${s}`); return i; };
  at('match /joinCodes/{code}');
  at('match /squads/{squadId}');
  for (const sub of ['members/{uid}', 'positions/{uid}', 'incidents/{incidentId}', 'marks/{markId}', 'tracks/{trackId}']) at(`match /${sub}`);
  assert.equal(rules.match(/allow list: if false;/g).length, 2, 'neither squads nor codes can be listed');
  at("function isMember() { return signedIn() && exists(mePath()) && squadLive(); }");
  at("get(squadPath()).data.get('gone', false) != true");
  at("allow delete: if false;");
  at("d.expiresAt >= request.time.toMillis() + 192 * 3600000");
  at("getAfter(squadPath()).data.get('gone', false) == true");
  at("&& d.uid == uid && place(d.lat, d.lon) && recent(d.at)");
  at("markId.matches(request.auth.uid + '_[0-9]{1,3}')");
  at("&& recent(request.resource.data.at)");
  at("request.time.toMillis() < get(incidentPath()).data.endedAt + 120000");
  at("request.resource.data.n <= (request.time.toMillis() - get(incidentPath()).data.startedAt) / 60000 + 1");
  assert.equal((rules.match(/allow delete: if signedIn\(\) && creator\(\) == request\.auth\.uid;/g) || []).length, 2,
    'an incident and a track are deleted only by the creator, with the squad');
  at("request.resource.data.code == get(squadPath()).data.code");
  at("getAfter(squadPath()).data.createdBy == request.auth.uid");
  at("&& expires(d, 12);");
  at("get(incidentPath()).data.k9Uid == request.auth.uid");
  at("trackId == request.auth.uid + '_' + string(d.n)");
  at("&& resource.data.status == 'active'");
  at("&& request.resource.data.status == 'active';");
  at("trackOk(request.resource.data) && exists(incidentPath())");
  at("'indication', 'lost', 'refound', 'article', 'sighting', 'roadblock', 'rally', 'perimeter'");
  assert.ok(rules.lastIndexOf('match /{document=**} { allow read, write: if false; }') > at('match /squads/{squadId}'),
    'everything else is still refused, after the squads');
  // The copy refuses what the rules refuse, for the paths it does not know.
  assert.equal(allow('get', 'elsewhere/x', { uid: 'a', before: new Map(), after: new Map() }), false);
});

t('nothing is published: the rules reach Firebase only by npm run rules:publish', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.doesNotMatch(pkg.scripts.test, /rules:publish|firebase-tools/);
});

for (const [name, fn] of tests) {
  await fn();
  pass++;
  console.log(`  ok  ${name}`);
}
console.log(`\n${pass} passed total\n`);
