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
         POSITION_TTL, INCIDENT_TTL, PATHS, DEMO_LABEL, FRESH_MS, SIM_SQUAD, simUnits, cleanDemoNames,
         keptLines, dogRecord, cleanRecord, recordWords, licenceState, licenceEnd, licenceDay, dayWords, pretendRecord,
         RECORD_KEYS, RECORD_SAYS, RECORD_NOTE, GAPS_MAX, GAP_MAX, callSignsOf } from '../public/squad.js';
import { calibration, runsOf } from '../public/call.js';
import { createSquad, findSquad, joinSquad, myMember, watchSquad, putPosition, clearPosition, setRole,
         removeMember, leaveSquad, newCode, deleteSquad, getSquad, TOMBSTONE_MS, shareRecord } from '../public/squad-cloud.js';
import { html, esc } from '../public/squad-ui.js';
import { MARKS, DRAW_TOOLS, RUN_MARKS, incidentDoc, cleanIncident, activeOf, pastOf, markDoc, cleanMark, mayMark, mayUnmark,
         trackBuffer, minuteOf, cleanTrack, joinTracks, trailInfo, aheadLine, elapsedWords, clockWords, countWords,
         summarise, buildReplay, placeAt, replayAt, scentPath, createSimIncident, mayShareRun, metresWords, callWords,
         stripWords, quietLines, followPoints, allInView, SGT, standing, standingOf, PACES, cleanPaces, cleanBrief,
         cleanLastSeen, seenAt, lastSeenFrom, hhmm, reachM, reachRings, nearM, passedLines, warnWords, reachWords,
         isClosed, insideLine,
         onScentWords, briefWords, logLines, ring, REACH_CAP_M, downwindBand, BAND_WORDS, bandWindWords, CALM_MS,
         sceneWalkers, sceneWords, nameList, SCENE_M, FOOT_MS, speedAt, insideWalkers, insideWords, INSIDE_M,
         PERIM_GRACE_MS, onFootNow, coverWords, aboutWords, SCENE_NOTE, scentStart, insideNow, GOING_GRACE_MS } from '../public/incident.js';
import { wallIndex, wallAt, blockStep, outside as outsideWall } from '../public/walls.js';
import { startIncident, endIncident, watchIncidents, watchIncident, putMark, withdrawMark, putTrack,
         loadIncident, updateSeen, setCover } from '../public/incident-cloud.js';
import { project, pathLen, bearing } from '../public/geo.js';
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
  assert.deepEqual(m, { uid: 'a', role: 'officer', callSign: 'Unit', name: 'A', dog: null, joinedAt: 0, record: null },
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
  assert.equal(standingOf(si.marks).filter(m => m.kind === 'roadblock').length, 2, 'both cars at their roadblocks');
  assert.ok(marks.every(m => m.kind === 'perimeter' ? m.pts.length > 3 : Number.isFinite(m.lat)));
  assert.ok(si.trail.length > 50 && dist(si.trail[0], lkp) < 10, 'the trail starts at the last known point');
  // The person at the screen draws too, and can take it back: withdrawn, not gone.
  const id = si.addMark({ kind: 'roadblock', by: 'you', at: t, lat: center.lat, lon: center.lon });
  si.removeMark(id, 'you', t + 500);
  assert.deepEqual([si.marks.get(id).withdrawnBy, si.marks.get(id).withdrawnAt], ['you', t + 500]);
  assert.ok(!standingOf(si.marks).some(m => m.id === id), 'off the map');
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
  assert.equal(endScene.marks.length, standingOf(si.marks).length, 'the map at the end: what still stood');
  assert.equal(endScene.said.length, si.marks.size, 'the log at the end: everything said, withdrawn too');
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

/* ── Move A: a believable demo, readable from across the room ───────── */
/* A town of blocks for the pretend squad to walk round: 40 m buildings on
   a 70 m grid, so the streets between them are 30 m wide. */
const TOWN = { lat: 51.2094, lon: -2.6476 };
function townWalls() {
  const kx = 111320 * Math.cos(TOWN.lat * Math.PI / 180);
  const ll = (x, y) => [TOWN.lon + x / kx, TOWN.lat + y / 111320];
  const list = [];
  for (let gx = -6; gx <= 6; gx++) {
    for (let gy = -6; gy <= 6; gy++) {
      const x = gx * 70 + 15, y = gy * 70 + 15;   // the street crossings sit on the centre
      list.push({ rings: [[ll(x, y), ll(x + 40, y), ll(x + 40, y + 40), ll(x, y + 40), ll(x, y)]], h: 10 });
    }
  }
  return wallIndex(list, TOWN);
}

t('distances follow Settings: metres, or yards and miles', () => {
  assert.equal(metresWords(320), '320 m');
  assert.equal(metresWords(1500), '1.5 km');
  assert.equal(metresWords(320, true), '350 yd');
  assert.equal(metresWords(1609.344, true), '1.0 mi');
  const ui = read('public/incident-ui.js');
  assert.match(ui, /const distWords = \(m\) => metresWords\(m, imperial\(\)\)/);
  assert.doesNotMatch(ui.replace('metresWords(m, imperial())', ''), /metresWords\(/, 'every distance on the incident screens goes through the setting');
  assert.match(read('public/app.js'), /imperial: imp,/, 'the one switch Settings already has, not a second one');
});

t('the command screen’s words: the call said aloud, the phone strip, and a unit not heard from', () => {
  assert.equal(callWords('lost', 'K9-1'), 'K9-1, lost it');
  assert.equal(callWords('refound', 'K9-1'), 'K9-1, re-found');
  assert.equal(callWords('indication', 'Dog <b>'), 'Dog <b>, indication', 'spoken, never put in the page');
  assert.equal(callWords('roadblock', 'Foot 3'), '', 'only the K9 team’s calls are said');
  const now = 1_700_000_600_000;
  const info = { heading: 90, compass: 'E', lengthM: 400, elapsedMs: 10 * 60e3 };
  const call = { kind: 'refound', at: now - 60e3 };
  assert.equal(stripWords({ k9: { callSign: 'K9-1', dog: 'Rex' }, info, call, now }), 'K9-1 Rex · heading E · Re-found 1 min ago · 10 min');
  assert.equal(stripWords({ k9: null, info: { heading: null, lengthM: 0, elapsedMs: 30e3 }, call: null, now }), 'No K9 team · on the way · 30 s');
  // The folded strip carries the card's clock and the amber warning, with its rough guide.
  assert.equal(stripWords({ k9: { callSign: 'K9-1', dog: 'Rex' }, info, call: null, now, seenMs: 13 * 60e3, warn: warnWords('walk') }),
    'K9-1 Rex · heading E · Inside walking range (rough guide) · 13 min since seen');
  assert.equal(stripWords({ k9: { callSign: 'K9-1', dog: 'Rex' }, info, call: null, now, seenMs: null }), 'K9-1 Rex · heading E · 10 min',
    'no last-seen time: since the opening, as the card');
  const rows = [
    { callSign: 'Foot 5', fresh: 'stale', pos: { at: now - 150e3 } },
    { callSign: '2A12', fresh: 'live', pos: { at: now - 5e3 } },
    { callSign: 'Off', fresh: 'off', pos: null },
  ];
  assert.deepEqual(quietLines(rows, now), ['Foot 5: no update from the app for 2 min, check by radio']);
  assert.deepEqual(quietLines(undefined, now), []);
  // The live card says it, and the strip, by textContent (paintLive), never by HTML.
  const ui = read('public/incident-ui.js');
  assert.match(ui, /text\('strip', stripWords\(/);
  assert.match(ui, /seenMs: finite\(v\.inc\.lastSeenAt\) \? v\.now - v\.inc\.lastSeenAt : null/);
  assert.match(ui, /querySelector\('\.inc-strip'\)\?\.classList\.toggle\('warn', !!rn\.warn( \|\| insideNow\(inside\)\.length > 0)?\)/, 'on the strip itself, which the CSS colours');
  assert.match(ui, /text\('quiet', quietLines\(st\.rows, v\.now\)/);
});

t('following the K9 team: the team, the point and the perimeter stay in view until a hand moves the map', () => {
  const inc = { lkp: { lat: 51.2, lon: -2.6 } };
  const marks = [{ kind: 'perimeter', pts: [{ lat: 51.201, lon: -2.6 }, { lat: 51.2, lon: -2.601 }] },
                 { kind: 'roadblock', lat: 51.3, lon: -2.7 }];
  const pts = followPoints({ inc, marks, k9: { lat: 51.2005, lon: -2.6005, at: 1 } });
  assert.equal(pts.length, 4, 'the point, the team and the perimeter line; a roadblock far off is not chased');
  assert.deepEqual(followPoints({ inc: null, marks, k9: null }), []);
  const pad = { top: 90, bottom: 40, left: 40, right: 380 };
  const size = { w: 1600, h: 900 };
  assert.equal(allInView([{ x: 100, y: 100 }, { x: 1200, y: 800 }], size, pad), true);
  assert.equal(allInView([{ x: 1300, y: 400 }], size, pad), false, 'under the panel is out of view');
  assert.equal(allInView([{ x: 500, y: 50 }], size, pad), false, 'under the pills is out of view');
  const ui = read('public/incident-ui.js');
  const follow = ui.slice(ui.indexOf('function onHand('), ui.indexOf('/* ── Hearing the K9 team'));
  assert.match(follow, /if \(e && !e\.originalEvent\) return;/, 'the map easing itself does not count as a hand');
  assert.match(follow, /\['dragstart', 'zoomstart', 'rotatestart', 'pitchstart'\]/);
  assert.match(follow, /if \(I\.follow\.paused \|\| I\.tool \|\| I\.form/, 'never moves the map while someone draws');
  assert.match(follow, /fitOnMap\(\[\.\.\.pts, \.\.\.room\], 17\)/, 'it builds on fitOnMap');
  assert.match(ui, /onLook\(pauseFollow\)/, 'a tap on a unit in the list, or Fit everyone, pauses it too');
  assert.match(ui, /\$\('cmdFollow'\)\.addEventListener\('click', resumeFollow\)/);
  const sq = read('public/squad-ui.js');
  for (const fn of ['function focusUnit(', 'function fitAll(']) {
    const body = sq.slice(sq.indexOf(fn), sq.indexOf('\n}', sq.indexOf(fn)));
    assert.match(body, /looked\('/, `${fn} tells the incident layer`);
  }
});

t('the six confirm() boxes are the app’s own sheets, which put nothing in the page as HTML', () => {
  for (const f of ['public/squad-ui.js', 'public/incident-ui.js']) {
    assert.doesNotMatch(read(f), /\bconfirm\(/, `${f} asks with a sheet`);
  }
  const sq = read('public/squad-ui.js'), inc = read('public/incident-ui.js');
  assert.equal((sq.match(/await ask\(\{/g) || []).length, 4, 'remove a member, new code, leave, delete');
  assert.equal((inc.match(/await ask\(\{/g) || []).length, 2, 'End incident, remove a mark');
  for (const [src, n] of [[sq, 3], [inc, 2]]) assert.ok((src.match(/danger: true/g) || []).length >= n, 'the dangerous answer is red');
  const sheet = read('public/sheet.js');
  assert.doesNotMatch(sheet, /innerHTML|insertAdjacentHTML|outerHTML|document\.write/, 'textContent only');
  assert.match(sheet, /e\.key === 'Escape'/, 'Escape cancels');
  assert.match(sheet, /data-sheet-safe|dataset\.sheetSafe/, 'the safe answer takes the focus');
  const page = read('public/index.html');
  assert.match(page, /<div class="app-sheet" id="appSheet" hidden role="dialog" aria-modal="true" aria-labelledby="appSheetTitle"><\/div>/);
  // Cached for offline use and folded into the one-file build, before the screens that use it.
  assert.ok(read('public/sw.js').includes("'sheet.js'"));
  const build = read('scripts/build-single.mjs');
  assert.ok(build.indexOf("'sheet'") > 0 && build.indexOf("'sheet'") < build.indexOf("'squad-ui'"));
  // A sheet left up while the incident ended does not act on it afterwards.
  assert.match(inc, /The sheet was up a while: the incident may have ended under it\.[\s\S]*?if \(!now\.inc \|\| now\.inc\.id !== v\.inc\.id/);
});

t('his department: the name and call signs he types replace the pretend ones, tidied, on this device only', () => {
  assert.deepEqual(cleanDemoNames(null), { squad: SIM_SQUAD, callSigns: simUnits().map(u => u.callSign) });
  const n = cleanDemoNames({ squad: '  Wells\u0000 Police ', callSigns: ['K9 Alpha', '', 'x'.repeat(60)] });
  assert.equal(n.squad, 'Wells Police');
  assert.equal(n.callSigns[0], 'K9 Alpha');
  assert.equal(n.callSigns[1], 'K9-2', 'blank keeps the usual one');
  assert.equal(n.callSigns[2].length, 24, 'bounded like any call sign');
  const sim = createSim({ center: TOWN, now: 1_700_000_000_000, seed: 2, callSigns: n.callSigns });
  assert.equal(sim.members().get('sim-1').callSign, 'K9 Alpha');
  assert.equal(sim.members().get('sim-1').dog, 'Rex', 'the dogs stay');
  const ui = read('public/squad-ui.js');
  assert.match(ui, /\$\('sqSim'\)\.addEventListener\('click', openDemo\)/, 'the form comes before the pretend squad starts');
  assert.match(ui, /ctx\.kv\.set\('squadDemoNames', names\)/, 'remembered on the device, never in the cloud');
  assert.doesNotMatch(ui.slice(ui.indexOf('async function openDemo('), ui.indexOf('/* ── Wall mode')), /handle\(|putPosition|createSquad/);
  assert.match(ui, /name: S\.simName, members: S\.sim\.members\(\)/);
});

t('pretend walkers keep out of buildings, and so does the pretend person’s line', () => {
  const W = townWalls();
  const t0 = 1_700_000_000_000;
  const sim = createSim({ center: TOWN, now: t0, seed: 4, walls: W });
  for (const u of sim.units) if (u.mode === 'foot') { const p = outsideWall(W, u); u.lat = p.lat; u.lon = p.lon; }
  const feet = sim.units.filter(u => u.mode === 'foot');
  let moved = 0;
  const was = new Map(feet.map(u => [u.uid, { lat: u.lat, lon: u.lon }]));
  for (let s = 1; s <= 900; s++) {
    sim.step(t0 + s * 1000);
    for (const u of feet) {
      assert.equal(wallAt(W, u), -1, `${u.callSign} stepped into a building at ${s} s`);
      const v = dist(was.get(u.uid), u);
      assert.ok(v <= 1.8 || v < 26, `${u.callSign} moved ${v.toFixed(1)} m in a second`);
      moved += v;
      was.set(u.uid, { lat: u.lat, lon: u.lon });
    }
  }
  assert.ok(moved > 1500, 'and they still get about');
  // The person's line: no step of it goes through a wall, and the same seed gives the same line.
  const lkp = { lat: TOWN.lat, lon: TOWN.lon };
  const path = scentPath({ lkp, seed: 9, walls: W });
  for (let i = 1; i < path.pts.length; i++) {
    assert.equal(blockStep(W, path.pts[i - 1], path.pts[i]), path.pts[i], `step ${i} of the line crosses a wall`);
  }
  assert.ok(path.lostAt > 0 && path.refoundAt > path.lostAt);
  assert.deepEqual(scentPath({ lkp, seed: 9 }), scentPath({ lkp, seed: 9, walls: null }), 'without walls, the line it always was');
  // Buildings that arrive after the squad starts move nobody into a wall.
  const late = createSim({ center: TOWN, now: t0, seed: 6 });
  late.setWalls(W);
  for (const u of late.units) if (u.mode === 'foot') assert.equal(wallAt(W, u), -1);
});

t('the pretend sergeant contains wide early, then tightens ahead of the team, and never reads the hidden line', () => {
  const W = townWalls();
  const t0 = 1_800_000_000_000;
  const sim = createSim({ center: TOWN, now: t0, seed: 11, walls: W });
  const si = createSimIncident({ sim, lkp: { lat: TOWN.lat, lon: TOWN.lon }, now: t0, seed: 5 });
  let t = t0, wide = null, inner = null, wideGoneBeforeInner = false, refoundAt = 0;
  while (t < t0 + 40 * 60e3 && si.phase !== 'found') {
    t += 2000; sim.step(t); si.step(t);
    const ms = standingOf(si.marks);
    const w = ms.find(m => m.label === 'Wide perimeter');
    const i = ms.find(m => m.label === 'Inner perimeter');
    if (w && !wide) wide = { at: t, mark: w };
    if (i && !inner) { inner = { at: t, mark: i }; wideGoneBeforeInner = !w; }
    const re = ms.find(m => m.kind === 'refound');
    if (re && !refoundAt) refoundAt = re.at;
    const k9 = sim.unit('sim-1');
    assert.equal(wallAt(W, k9), -1, 'the dog keeps out of buildings');
  }
  assert.equal(si.phase, 'found', 'the team still reaches the person among the buildings');
  assert.ok(wide && wide.at - t0 <= SGT.wideAfterMs + 4000, 'a wide perimeter goes up at once');
  // A ring's radius, from the middle of its points (the last repeats the first, to close it).
  const r = (m) => { const q = m.pts.slice(0, -1); return Math.round(dist(q[0], { lat: q.reduce((a, p) => a + p.lat, 0) / q.length, lon: q.reduce((a, p) => a + p.lon, 0) / q.length })); };
  assert.ok(Math.abs(r(wide.mark) - SGT.wideM) < 15, 'round the last known point');
  assert.ok(inner && inner.at > refoundAt && refoundAt > 0, 'tightened only after the handler called the re-find');
  assert.ok(r(inner.mark) < r(wide.mark), 'tighter');
  assert.ok(wideGoneBeforeInner, 'the wide line is withdrawn as the inner one goes up');
  assert.equal(standingOf(si.marks).filter(m => m.kind === 'roadblock').length, 2, 'the cars’ roadblocks are on the inner line now');
  const gone = [...si.marks.values()].filter(m => m.withdrawnAt);
  assert.ok(gone.some(m => m.label === 'Wide perimeter') && gone.every(m => m.withdrawnBy === 'sim-7'),
    'the wide line is withdrawn by the sergeant, kept for the log');
  for (const m of si.marks.values()) if (m.kind === 'rally') assert.equal(wallAt(W, m), -1, 'a rally point in the open');
  // What the sergeant reads: never the hidden line, nor where the person is.
  const src = read('public/incident.js');
  const sgt = src.slice(src.indexOf('function sergeant('), src.indexOf('const si = {', src.indexOf('function sergeant(')))
    .replace(/\/\*[\s\S]*?\*\//g, '');   // the code, not its comments
  assert.ok(sgt.length > 500);
  assert.doesNotMatch(sgt, /\bscent\b|\bperson\b|hiddenRoute|pathAt/, 'the sergeant knows what a real one would');
  assert.match(sgt, /trailInfo\(si\.trail, inc, t\)/, 'he goes by the team’s own track');
  // Nothing on any screen reads the hidden line (only the end-of-scenario line will).
  for (const f of ['squad-ui.js', 'incident-ui.js', 'squad.js']) assert.doesNotMatch(read(`public/${f}`), /hiddenRoute|\.scent\b/, f);
  assert.doesNotMatch(read('public/app.js'), /hiddenRoute/);
  assert.equal(si.scent, undefined, 'the line is not on the incident the screens draw from');
});

t('hear it: the command screen says the K9 team’s new calls in the coach voice, and can be switched off', () => {
  const app = read('public/app.js');
  const init = app.slice(app.indexOf('initIncidents({'), app.indexOf('});', app.indexOf('initIncidents({')));
  assert.match(init, /speak: \(text\) => coachSpeak\(text\)/, 'the coach’s own voice, wired through initIncidents');
  const ui = read('public/incident-ui.js');
  const say = ui.slice(ui.indexOf('function speakCalls('), ui.indexOf('function setVoice('));
  assert.match(say, /I\.said = \{ for: live\.id, ids: new Set\(v\.marks/, 'calls made before the screen opened are not said');
  assert.match(say, /mk\.by !== meUid\(\)/, 'a handler does not hear their own');
  assert.match(say, /if \(!I\.voice \|\| !ctx\.speak\) return;/);
  assert.match(say, /callWords\(mk\.kind, who\(mk\.by, st\.members\)\)/);
  assert.match(ui, /data-inc-act="voice" aria-pressed=/, 'a switch on the incident card');
  assert.match(ui, /ctx\.kv\.set\('squadVoice', I\.voice\)/, 'remembered on the device');
});

t('Wall mode: a big clock, the latest lines, big units, short pins, a night look that keeps the lines bright', () => {
  const page = read('public/index.html');
  for (const id of ['cmdWall', 'cmdWallClock', 'cmdWallInc', 'cmdWallLog', 'cmdNight', 'cmdWallBtn', 'cmdFollow', 'cmdKept', 'sqKept', 'sqKept2']) {
    assert.ok(page.includes(`id="${id}"`), `#${id}`);
  }
  const cmd = page.slice(page.indexOf('<section id="scrCommand"'), page.indexOf('</section>', page.indexOf('<section id="scrCommand"')));
  assert.match(cmd, /id="cmdWall"/, 'inside the command screen');
  const css = read('public/app.css');
  assert.match(css, /#map\.map-wall \.inc-mark-tag \{ display: none; \}/, 'short pins on the wall');
  assert.match(css, /#map\.map-wall\.map-zoomed \.inc-mark-tag \{ display: block;/, 'details close in');
  assert.match(css, /@media \(max-width: 899px\) \{ \.cmd-wall-btn \{ display: none; \} \}/, 'a wall is a big screen');
  const sq = read('public/squad-ui.js');
  assert.match(sq, /setConfigProperty\?\.\('basemap', 'lightPreset', on \? 'night' : 'day'\)/, 'the Standard map’s night light');
  assert.match(sq, /const under = \['inc-reach-fill', 'inc-lines'\]\.find\(id => m\.getLayer\(id\)\);/, 'the veil goes under the incident’s layers');
  assert.match(read('public/incident-ui.js'), /`\$\{l\.type\}-emissive-strength`\]: 1/, 'which glow at night');
  assert.match(sq, /function closeCommand\(\)[\s\S]*?setWall\(false\);/, 'leaving the map leaves Wall mode');
  // The live log (move B) takes over the slot; until then the marks fill it, five at most, by html``.
  const inc = read('public/incident-ui.js');
  assert.match(inc, /put\(\$\('cmdWallLog'\), html`/);
  assert.match(inc, /\.slice\(-5\)/);
});

t('the phone strip folds the incident to one line, and opens on a tap', () => {
  const inc = read('public/incident-ui.js');
  assert.match(inc, /<button type="button" class="inc-strip" data-inc-act="unfold"/);
  assert.match(inc, /if \(act === 'unfold'\) return foldPanel\(false\);/);
  assert.match(inc, /\$\('cmdPanel'\)\?\.classList\.toggle\('inc-on', !!live\)/);
  const css = read('public/app.css');
  assert.match(css, /\.cmd-panel\.folded\.inc-on \.inc-live > :not\(\.inc-strip\) \{ display: none; \}/);
  assert.match(css, /\.inc-strip \{ display: none; \}/, 'only on a phone, folded');
});

t('what’s kept, and for how long, is worked out from the app’s own numbers', () => {
  const lines = keptLines();
  const all = lines.map(l => `${l.head} ${l.text}`).join(' ');
  assert.ok(all.includes(`${POSITION_TTL / 3600e3} hours`), 'positions');
  assert.ok(all.includes(`${INCIDENT_TTL / 86400e3} days`), 'incidents');
  assert.ok(all.includes('deleted at once'), 'off duty, a position goes at once');
  assert.ok(all.includes('each member\'s name, call sign'), 'names are kept with the squad, and it says so');
  assert.ok(all.includes('the brief (direction and description)') && all.includes('every squad member can see them'),
    'the brief is personal data: kept a week, seen by all, and it says so');
  assert.doesNotMatch(all, /secure|evidence|sealed|CJIS|proof|guarantee/i, 'honest words only');
  assert.match(read('public/squad-ui.js'), /info\(\{ title: 'What’s kept, and for how long', items: keptLines\(\) \}\)/);
});

t('last seen, how they left and the brief: bounded on the way out, cleaned on the way in', () => {
  const now = 1_800_000_000_000;
  const d = incidentDoc({ name: 'X', lkp: { lat: 51.2, lon: -2.6 }, k9Uid: 'k9', uid: 'chief', now,
    lastSeenAt: now - 9 * 60e3, pace: 'run', brief: { dir: '  north,\n to the  park ', desc: 'x'.repeat(400), article: true, evil: 1 } });
  assert.equal(d.lastSeenAt, now - 9 * 60e3);
  assert.equal(d.pace, 'run');
  assert.deepEqual(d.brief, { dir: 'north, to the park', desc: 'x'.repeat(160), article: true }, 'tidied, bounded, nothing extra');
  // Never later than the opening, never more than two days before it; nonsense is nothing.
  assert.equal(cleanLastSeen(now + 60e3, now), now);
  assert.equal(cleanLastSeen(now - 9 * 864e5, now), now - 48 * 3600e3);
  assert.equal(cleanLastSeen('soon', now), null);
  const plain = incidentDoc({ name: 'X', lkp: { lat: 51.2, lon: -2.6 }, uid: 'chief', now, pace: 'teleport', brief: { dir: ' ' } });
  assert.deepEqual([plain.lastSeenAt, plain.pace, plain.brief], [null, null, null]);
  assert.equal(seenAt(cleanIncident(plain, 'i')), now, 'not said: the clock starts when the incident opened');
  const c = cleanIncident({ ...d, brief: { dir: '<b>N</b>', article: 'yes' } }, 'i');
  assert.deepEqual(c.brief, { dir: '<b>N</b>', desc: '', article: null }, 'kept as text (html`` escapes it), a non-answer is not known');
  assert.equal(cleanBrief({ article: false }).article, false, 'no scent article is an answer');
  // A time typed in the form is the last time it was that o'clock.
  const at = new Date(2027, 2, 3, 14, 20).getTime();
  assert.equal(lastSeenFrom('14:05', at), new Date(2027, 2, 3, 14, 5).getTime());
  // A few minutes ahead is a slip (a fast phone), refused, never yesterday's 24-hour ring; well ahead is yesterday.
  assert.ok(Number.isNaN(lastSeenFrom('14:22', at)), '2 min ahead: refused');
  assert.ok(Number.isNaN(lastSeenFrom('23:50', at)), '9 h 30 min ahead: still refused');
  assert.equal(lastSeenFrom('14:21', at), new Date(2027, 2, 3, 14, 21).getTime(), 'within a minute: a clock a little out');
  const early = new Date(2027, 2, 3, 9, 0).getTime();
  assert.equal(lastSeenFrom('22:30', early), new Date(2027, 2, 2, 22, 30).getTime(), '13 h 30 min ahead: yesterday');
  const ui0 = read('public/incident-ui.js');
  assert.equal((ui0.match(/Number\.isNaN\((lastSeenAt|t)\)\) return (err|ctx\.toast)\('That time is after now'\)/g) || []).length, 2,
    'the start form and the last-seen sheet both say so');
  for (const bad of ['', '25:00', '14:5', 'noon', null]) assert.equal(lastSeenFrom(bad, at), null, String(bad));
  assert.equal(hhmm(new Date(2027, 2, 3, 9, 4).getTime()), '09:04');
  // Paces: this device's, each held to a sensible span.
  assert.deepEqual(cleanPaces(null), { walk: 5, run: 10, vehicle: 40 });
  assert.deepEqual(cleanPaces({ walk: 0.2, run: 'x', vehicle: 999 }), { walk: 1, run: 10, vehicle: 130 });
  assert.equal(briefWords(d.brief, 'run'), `Running · Heading north, to the park · ${'x'.repeat(160)} · Scent article: yes`);
});

t('the ring grows from the last known point at the pace, and the perimeter goes amber once it is passed', () => {
  const t0 = 1_800_000_000_000;
  const lkp = { lat: 51.2094, lon: -2.6476 };
  const inc = { lkp, startedAt: t0, endedAt: null, lastSeenAt: t0 - 3 * 60e3, pace: 'walk' };
  const r = reachRings({ inc, now: t0 + 3 * 60e3, paces: null });
  assert.equal(r.sinceMs, 6 * 60e3, 'from last seen, not from the opening');
  assert.equal(Math.round(r.main.m), 500, '6 min at 5 km/h');
  assert.equal(Math.round(r.wide.m), 1000, 'the dashed ring: if they ran');
  assert.equal(reachRings({ inc: { ...inc, pace: 'run' }, now: t0, paces: null }).wide, null, 'running: no wider ring');
  assert.equal(reachRings({ inc: { ...inc, pace: 'vehicle' }, now: t0 + 864e5, paces: null }).main.m, REACH_CAP_M, 'capped');
  assert.equal(Math.round(reachRings({ inc, now: t0 + 3 * 60e3, paces: { walk: 4 } }).main.m), 400, 'the device’s own pace');
  // Ended, or in a replay: the ring is as it was at that moment, never past the end.
  const ended = { ...inc, endedAt: t0 + 60e3 };
  assert.equal(reachRings({ inc: ended, now: t0 + 3600e3, paces: null }).sinceMs, 4 * 60e3);
  assert.equal(reachRings({ inc: ended, now: t0, paces: null }).sinceMs, 3 * 60e3);
  // A wide ring of 450 m round the point: inside walking range once the ring passes 450 m.
  const wide = { id: 'w', kind: 'perimeter', at: t0, pts: ring(lkp, 450, 12) };
  const road = { id: 'rb', kind: 'roadblock', at: t0, lat: lkp.lat, lon: lkp.lon };
  assert.ok(Math.abs(nearM(lkp, wide.pts) - 450 * Math.cos(Math.PI / 12)) < 3, 'how near the line comes: the middle of a side');
  const at = (min) => reachRings({ inc, now: t0 - 3 * 60e3 + min * 60e3, paces: null });
  assert.deepEqual(passedLines({ inc, marks: [wide, road], reach: at(5) }), [], '417 m: still inside it');
  assert.deepEqual(passedLines({ inc, marks: [wide, road], reach: at(6) }), ['w'], '500 m: past it');
  assert.equal(warnWords('walk'), 'Perimeter now inside walking range');
  assert.equal(warnWords('vehicle'), 'Perimeter now inside driving range');
  assert.match(reachWords(at(6)), /^Rough guide, not where the person is: walking 5 km\/h, about 500 m; running 10 km\/h, about 1\.0 km \(dashed\)$/);
  assert.match(reachWords(at(6), true), /walking 3 mph, about .*yd; running 6 mph/, 'miles when Settings say so');
  // The dog at the last known point, after last seen: a position, not a claim about the scent.
  assert.equal(onScentWords({ inc, trail: [], now: t0 + 60e3 }), 'Dog not at the last known point yet · 4 min since last seen');
  const walkIn = [{ ...project(lkp, 90, 300), t: t0 + 60e3 }, { ...project(lkp, 90, 120), t: t0 + 3 * 60e3 }];
  assert.equal(onScentWords({ inc, trail: walkIn, now: t0 + 4 * 60e3 }), 'Dog not at the last known point yet · 7 min since last seen', 'the walk in is not the point');
  assert.equal(onScentWords({ inc, trail: [...walkIn, { ...project(lkp, 90, 20), t: t0 + 6 * 60e3 }], now: t0 + 9e5 }),
    'Dog at the last known point about 9 min after last seen', 'from when the team reached the last known point');
  const noSeen = { ...inc, lastSeenAt: null };
  assert.equal(onScentWords({ inc: noSeen, trail: [], now: t0 + 60e3 }), 'Dog not at the last known point yet · 1 min since the incident opened',
    'no last-seen time given: counted from the opening, and it says so');
  assert.doesNotMatch(read('public/incident.js'), /on scent \$\{|started trailing/, 'never worded as what the dog did');
  // A closed ring that does not go round the point (an inner ring ahead of the dog) is never "passed".
  const ahead = { id: 'in', kind: 'perimeter', at: t0, pts: ring(project(lkp, 90, 700), 250, 12) };
  assert.ok(isClosed(ahead.pts) && !insideLine(lkp, ahead.pts) && insideLine(lkp, wide.pts));
  assert.deepEqual(passedLines({ inc, marks: [wide, ahead], reach: at(12) }), ['w'], 'only the ring round the point');
  // An open line (a cordon across a road) is judged by how near it comes.
  const cordon = { id: 'c', kind: 'perimeter', at: t0, pts: [project(lkp, 0, 300), project(lkp, 60, 320), project(lkp, 120, 300)] };
  assert.ok(!isClosed(cordon.pts));
  assert.deepEqual(passedLines({ inc, marks: [cordon], reach: at(4) }), ['c'], '333 m: past a cordon about 280 m off');
  // Honest words only.
  const words = [reachWords(at(6)), warnWords('walk'), onScentWords({ inc, trail: [], now: t0 })].join(' ');
  assert.doesNotMatch(words, /predict|proof|secure|evidence|sealed/i);
});

t('in the pretend demo the wide ring goes amber as a moment in the story, and the sergeant\'s inner ring is never amber', () => {
  const center = { lat: 51.2094, lon: -2.6476 };
  const t0 = 1_800_000_000_000;
  let inners = 0;
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const sim = createSim({ center, now: t0, seed: seed + 20 });
    /* As the "Pretend incident" button does: seen walking off a minute before. */
    const si = createSimIncident({ sim, lkp: project(sim.unit('sim-1'), 30, 120), now: t0, seed, lastSeenAt: t0 - 60e3, pace: 'walk' });
    let t = t0, firstAmber = null;
    const flagged = new Set();
    while (t < t0 + 30 * 60e3 && si.phase !== 'found') {
      t += 4000; sim.step(t); si.step(t);
      const marks = standingOf(si.marks);
      const passed = passedLines({ inc: si.inc, marks, reach: reachRings({ inc: si.inc, now: t, paces: null }) });
      if (passed.length && firstAmber == null) firstAmber = t - t0;
      for (const id of passed) flagged.add(id);
    }
    const inner = [...si.marks.values()].filter(m => m.label === 'Inner perimeter');
    inners += inner.length;
    /* Ahead of the dog, clear of the point: never amber. (A long trail can
       make him tighten round it anyway; then the warning is the honest one.) */
    for (const m of inner) if (!insideLine(si.inc.lkp, m.pts)) assert.ok(!flagged.has(m.id), `seed ${seed}: the inner ring ahead of the dog is never amber`);
    for (const m of inner) if (insideLine(si.inc.lkp, m.pts)) assert.ok(pathLen(si.trail.filter(p => p.t <= m.at)) >= SGT.anywayM - 50, `seed ${seed}: round the point only on a long trail`);
    if (firstAmber != null) assert.ok(firstAmber >= 200e3, `seed ${seed}: amber at ${firstAmber / 1e3} s, not from the start`);
  }
  assert.ok(inners > 0, 'some runs reach the tightening');
  assert.match(read('public/incident-ui.js'), /seenAt: viewNow\(\) - 60e3, pace: 'walk'/);
});

t('the live log says what happened in plain words, keeps a withdrawn mark crossed out, and stops at a replay’s moment', () => {
  const t0 = new Date(2027, 2, 3, 14, 0).getTime();
  const min = (n) => t0 + n * 60e3;
  const inc = { lkp: { lat: 51.2, lon: -2.6 }, startedAt: t0, endedAt: min(30), startedBy: 'sgt', k9Uid: 'k9',
                lastSeenAt: min(-4), pace: 'walk', status: 'ended' };
  const marks = [
    { id: 'a', kind: 'lost', by: 'k9', at: min(9), lat: 51.201, lon: -2.6 },
    { id: 'b', kind: 'sighting', by: 'f5', at: min(10), lat: 51.202, lon: -2.6, label: 'Person seen on foot' },
    { id: 'c', kind: 'roadblock', by: 'car3', at: min(11), lat: 51.203, lon: -2.6, withdrawnBy: 'sgt', withdrawnAt: min(12) },
    { id: 'd', kind: 'perimeter', by: 'sgt', at: min(5), pts: [{ lat: 51.21, lon: -2.6 }, { lat: 51.21, lon: -2.61 }], label: 'Wide perimeter' },
  ];
  const names = { sgt: 'Sgt 1', k9: 'K9-1', f5: 'Foot 5', car3: 'Car 3' };
  const trail = [{ lat: 51.199, lon: -2.6, t: min(2) }, { lat: 51.2, lon: -2.6, t: min(4) }, { lat: 51.201, lon: -2.6, t: min(5) }];
  const log = logLines({ inc, marks: new Map(marks.map(m => [m.id, m])), trail, who: (u) => names[u], team: 'K9-1 Rex' });
  assert.deepEqual(log.map(l => `${l.time} ${l.text}`), [
    '13:56 Last seen, walking',
    '14:00 Incident opened by Sgt 1',
    '14:04 K9-1 Rex at the last known point',
    '14:05 Sgt 1 perimeter line: Wide perimeter',
    '14:09 K9-1 lost it',
    '14:10 Foot 5 sighting: Person seen on foot',
    '14:11 Car 3 roadblock',
    '14:30 Incident ended',
  ]);
  assert.equal(log.find(l => l.key === 'm:c').withdrawn, 'withdrawn by Sgt 1, 14:12', 'kept, crossed out, who and when');
  assert.deepEqual(log.find(l => l.key === 'm:d').at, { lat: 51.21, lon: -2.6 }, 'a line is found by its first point');
  assert.equal(log.find(l => l.key === 'm:d').pts.length, 2, 'and shown whole');
  // At a replay's moment: only what had happened, the roadblock not yet withdrawn.
  const at = logLines({ inc, marks, trail, who: (u) => names[u], now: min(11.5) });
  assert.equal(at[at.length - 1].text, 'Car 3 roadblock');
  assert.equal(at[at.length - 1].withdrawn, null);
  assert.ok(!at.some(l => l.key === 'end'));
  // standing(): what the map draws at a moment.
  assert.ok(standing(marks[2], min(11.5)) && !standing(marks[2], min(12)) && !standing(marks[0], min(8)));
  assert.equal(mayUnmark(marks[2], 'sgt', true), false, 'withdrawn once, never again');
  // Withdrawn fields from another phone are cleaned: both halves or neither.
  const p = markDoc({ kind: 'roadblock', uid: 'ofc', at: 5, lat: 51.1, lon: -2.1 });
  assert.equal(cleanMark({ ...p, withdrawnBy: 'chief', withdrawnAt: 9 }, 'm').withdrawnBy, 'chief');
  assert.equal(cleanMark({ ...p, withdrawnBy: 'chief' }, 'm').withdrawnBy, undefined);
  assert.equal(cleanMark({ ...p, withdrawnBy: 7, withdrawnAt: 9 }, 'm').withdrawnAt, undefined);
  assert.equal(summarise({ inc, trail, marks, units: 4, now: min(30) }).marks, 3, 'the end counts what still stood');
});

t('the pretend incident carries last seen and the brief, and the sergeant’s withdrawn line shows in its log', () => {
  const center = { lat: 51.2094, lon: -2.6476 };
  const t0 = 1_800_000_000_000;
  const sim = createSim({ center, now: t0, seed: 11 });
  const si = createSimIncident({ sim, lkp: project(sim.unit('sim-1'), 30, 120), now: t0, seed: 5,
    lastSeenAt: t0 - 3 * 60e3, pace: 'walk', brief: { dir: 'east', desc: 'grey hoodie', article: true } });
  assert.equal(seenAt(si.inc), t0 - 3 * 60e3);
  assert.deepEqual(si.inc.brief, { dir: 'east', desc: 'grey hoodie', article: true });
  let t = t0;
  while (t < t0 + 40 * 60e3 && si.phase !== 'found') { t += 4000; sim.step(t); si.step(t); }
  const names = new Map([...sim.members().values()].map(m => [m.uid, m.callSign]));
  const log = logLines({ inc: si.inc, marks: si.marks, trail: si.trail, who: (u) => names.get(u) || 'You' });
  const wide = log.find(l => /Wide perimeter/.test(l.text));
  assert.match(wide.withdrawn, new RegExp(`^withdrawn by ${names.get('sim-7')}, \\d\\d:\\d\\d$`));
  assert.ok(log.some(l => / at the last known point$/.test(l.text)) && log.some(l => / lost it$/.test(l.text)));
  // The sergeant's inner ring, drawn ahead of the dog, is never flagged the moment he draws it.
  const inner = [...si.marks.values()].find(m => m.label === 'Inner perimeter');
  if (inner) {
    const r = reachRings({ inc: si.inc, now: inner.at, paces: null });
    assert.ok(!passedLines({ inc: si.inc, marks: [inner], reach: r }).includes(inner.id), 'the inner ring is not amber when drawn');
  }
  si.setSeen({ lastSeenAt: t0 + 3600e3, pace: 'teleport', brief: null });
  assert.deepEqual([si.inc.lastSeenAt, si.inc.pace, si.inc.brief], [t0, null, null], 'Command corrects it, cleaned the same way');
  // The rings read the last known point and the clock: nothing of the hidden line.
  const src = read('public/incident.js');
  const reach = src.slice(src.indexOf('export const PACES'), src.indexOf('/* ── The live log'))
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/`[^`]*`|'[^'\n]*'/g, '""');   // the code, not its comments or words
  assert.ok(reach.length > 1500);
  assert.doesNotMatch(reach, /hiddenRoute|scent\.|\bperson\b/);
});

t('the incident card: the big clock, the rings, the amber line, the brief, paces and a log that jumps the map', () => {
  const ui = read('public/incident-ui.js');
  for (const k of ['seenClock', 'seenSub', 'warn', 'onScent', 'brief', 'reach']) assert.match(ui, new RegExp(`data-inc-text="${k}"`), k);
  for (const k of ['seen', 'pace', 'dir', 'desc', 'art']) assert.match(ui, new RegExp(`data-inc-${k}=?`), `the form takes ${k}`);
  assert.match(ui, /maxlength="\$\{DIR_MAX\}"/);
  assert.match(ui, /maxlength="\$\{DESC_MAX\}"/);
  // Layers: the rings under the perimeter, which goes amber when passed.
  const layers = ui.slice(ui.indexOf('const LAYERS = ['), ui.indexOf('const SOURCES'));
  assert.ok(layers.indexOf("'inc-reach-fill'") < layers.indexOf("'inc-lines'"), 'the rings under the lines');
  assert.match(layers, /'line-dasharray': \[2, 2\]/, 'the running ring dashed');
  assert.match(layers, /\['case', \['boolean', \['get', 'warn'\], false\], WARN_C, '#D93025'\]/);
  assert.match(ui, /`\$\{PACES\[reach\.pace\]\.label\} range · rough guide`/, 'the ring says it is a rough guide on the map too');
  // The log: a tap moves the map, and in a replay the slider, to that moment.
  const tap = ui.slice(ui.indexOf('function onLogLine('), ui.indexOf('/* ── Last seen, the brief and the paces'));
  assert.match(tap, /playReplay\(false\);[\s\S]*r\.t = Math\.max\(r\.rp\.start, Math\.min\(r\.rp\.end, l\.t\)\)/);
  assert.match(tap, /pauseFollow\(\)/, 'live: following stops, so the map stays where it was sent');
  assert.match(tap, /if \(l\.pts\?\.length\) fitOnMap\(l\.pts, 17\);\n  else if \(l\.at\) fitOnMap\(\[l\.at\]\);/, 'a line shown whole, a point close in');
  assert.match(ui, /put\(el, html`\$\{lines\.map\(\(l, i\) => html`<li class="\$\{cls\(l, i\)\}">/, 'by html``');
  assert.match(ui, /const cls = \(l, i\) => \[l\.withdrawn \? 'inc-log-off' : '', l\.ahead \? 'inc-log-ahead' : ''/, 'crossed out; in a replay, what is to come dimmed');
  // A replay's log holds the whole incident, so a tap can jump forward too.
  const lo = ui.slice(ui.indexOf('function logOf('), ui.indexOf('function paintLog('));
  assert.match(lo, /now: Infinity(?:, scene: whole)? \}\)\n    \.filter\(l => l\.t > v\.now\)\.map\(l => \(\{ \.\.\.l, withdrawn: null, ahead: true \}\)\)/);
  assert.match(read('public/app.css'), /\.inc-log-ahead \.inc-log-line \{ opacity: 0\.5; \}/);
  assert.match(read('public/app.css'), /\.inc-log-off \.inc-log-text \{[^}]*text-decoration: line-through/);
  // Wall mode's slot is the live log now.
  const wall = ui.slice(ui.indexOf('function paintWall('), ui.indexOf('/* ── The panel'));
  assert.match(wall, /logOf\(v, st\.members\)\.filter\(l => !l\.ahead\)\.slice\(-5\)\.reverse\(\)/, 'newest first, as on the card');
  assert.match(wall, /: `Opened \$\{elapsedWords\(upTo - v\.inc\.startedAt\)\} ago · last seen not given`/, 'no last-seen clock nobody gave');
  assert.match(wall, /\$\{rn\.warn \? ` · \$\{rn\.warn\} · rough guide` : ''\}/, 'the wall\'s warning is a rough guide too');
  assert.match(wall, /\$\('cmdWallSeen'\)/);
  // Withdrawn, not removed: the map and the counts read what stands.
  assert.match(ui, /marks: standingOf\(I\.marks\), said: \[\.\.\.I\.marks\.values\(\)\]/);
  assert.match(ui, /await withdrawMark\(h, I\.sid, v\.inc\.id, mark\.id\)/);
  assert.doesNotMatch(ui, /removeMark\(h|deleteDoc/);
  // Paces on this device; last seen and the brief by Command, in the cloud.
  assert.match(ui, /ctx\.kv\.set\('squadPaces', I\.paces\)/);
  assert.match(ui, /It never moves or shrinks a perimeter: Command decides\./);
  assert.match(ui, /\$\{cmd \? html`<button type="button" class="btn ghost small" data-inc-act="seen">/);
  assert.match(ui, /The sheet was up a while: the incident may have ended under it\. \*\/\n  const now = shown\(\);\n  if \(!now\.inc \|\| now\.inc\.id !== inc\.id/);
  const sheet = read('public/sheet.js');
  assert.match(sheet, /el\('option', '', c\.text\)/, 'a choice in the sheet goes in by textContent');
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
  await refused(withdrawMark(k9, sq.id, inc.id, rb), 'taking back someone else’s mark');
  await refused(fake.deleteDoc(fake.doc(ofc.fs, ...PATHS.mark(sq.id, inc.id, rb))), 'its maker deleting a mark outright');
  await withdrawMark(chief, sq.id, inc.id, rb);
  await settle();
  assert.deepEqual(standingOf(live.marks).map(m => m.kind).sort(), ['indication', 'perimeter']);
  assert.equal(live.marks.get(rb).withdrawnBy, 'chief', 'withdrawn, and kept for the log');
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
  await refused(withdrawMark(ofc, sq.id, 'i2', mid), 'taking a mark back after the end');
  await setRole(chief, sq.id, 'k9', 'command');
  await refused(withdrawMark(k9, sq.id, 'i2', mid), 'a promoted Command withdrawing a mark after the end');
  await refused(fake.deleteDoc(fake.doc(k9.fs, ...PATHS.mark(sq.id, 'i2', mid))), 'a promoted Command deleting a mark after the end');
  await refused(fake.deleteDoc(fake.doc(k9.fs, ...PATHS.incident(sq.id, 'i2'))), 'a promoted Command deleting an ended incident');
  await refused(fake.deleteDoc(fake.doc(k9.fs, ...PATHS.track(sq.id, 'i2', 'k9', 0))), 'a promoted Command deleting a track');
  await setRole(chief, sq.id, 'k9', 'k9');
  await clearPosition(ofc, sq.id);
});

t('last seen, pace and the brief in the cloud: Command sets and corrects them, bounded, and the end keeps them', async () => {
  const lkp = { lat: 51.2094, lon: -2.6476 };
  const inc = await startIncident(chief, sq.id, { name: 'Seen test', lkp, k9Uid: 'k9', lastSeenAt: Date.now() - 6 * 60e3,
    pace: 'run', brief: { dir: 'north', desc: 'red coat', article: false } });
  const path = `squads/${sq.id}/incidents/${inc.id}`;
  const held = fake.cloudDoc(path);
  assert.equal(held.pace, 'run');
  assert.deepEqual(held.brief, { dir: 'north', desc: 'red coat', article: false });
  const write = (h, x) => fake.setDoc(fake.doc(h.fs, ...PATHS.incident(sq.id, inc.id)), { ...fake.cloudDoc(path), ...x });
  await refused(write(chief, { lastSeenAt: held.startedAt + 60e3 }), 'last seen after the incident opened');
  await refused(write(chief, { lastSeenAt: held.startedAt - 3 * 864e5 }), 'last seen three days before');
  await refused(write(chief, { pace: 'teleport' }), 'a pace that is not one');
  await refused(write(chief, { brief: { dir: 'n', evil: '<script>' } }), 'a brief with more in it');
  await refused(write(chief, { brief: { desc: 'x'.repeat(161) } }), 'a description past 160');
  await refused(write(chief, { brief: { article: 'maybe' } }), 'a scent article that is not yes or no');
  await refused(write(chief, { startedAt: held.startedAt - 3600e3, lastSeenAt: held.startedAt - 3600e3 - 60e3 }),
    'the opening time moved, last seen with it');
  await refused(write(chief, { startedAt: held.startedAt + 60e3 }), 'the opening time moved on');
  await refused(updateSeen(ofc, sq.id, inc, { lastSeenAt: null, pace: 'walk', brief: null }), 'an officer correcting last seen');
  const t = Date.now() - 2 * 60e3;
  await updateSeen(chief, sq.id, inc, { lastSeenAt: t, pace: 'walk', brief: { dir: 'east' } });
  assert.deepEqual([fake.cloudDoc(path).lastSeenAt, fake.cloudDoc(path).pace, fake.cloudDoc(path).brief], [t, 'walk', { dir: 'east', desc: '', article: null }]);
  assert.equal(fake.cloudDoc(path).startedAt, held.startedAt, 'nothing else moves');
  const now = cleanIncident(fake.cloudDoc(path), inc.id);
  await endIncident(chief, sq.id, now, summarise({ inc: now, trail: [], marks: [], units: 1, now: Date.now() }));
  const ended = fake.cloudDoc(path);
  assert.deepEqual([ended.status, ended.lastSeenAt, ended.pace, ended.brief.dir], ['ended', t, 'walk', 'east'], 'ending wipes nothing said');
  await refused(updateSeen(chief, sq.id, now, { lastSeenAt: null, pace: 'run', brief: null }), 'correcting an ended incident');
});

t('the cover officer in the cloud: Command picks a member, never the handler, and the end keeps it', async () => {
  const inc = await startIncident(chief, sq.id, { name: 'Cover test', lkp: { lat: 51.2094, lon: -2.6476 }, k9Uid: 'k9' });
  const path = `squads/${sq.id}/incidents/${inc.id}`;
  assert.equal(fake.cloudDoc(path).coverUid, null);
  await refused(setCover(ofc, sq.id, inc, 'ofc'), 'an officer choosing the cover');
  await setCover(chief, sq.id, inc, 'ofc');
  assert.equal(fake.cloudDoc(path).coverUid, 'ofc');
  const write = (x) => fake.setDoc(fake.doc(chief.fs, ...PATHS.incident(sq.id, inc.id)), { ...fake.cloudDoc(path), ...x });
  await refused(write({ coverUid: 'k9' }), 'the handler as their own cover');
  await refused(write({ coverUid: 'x'.repeat(129) }), 'a cover past 128');
  await refused(write({ coverUid: 7 }), 'a cover that is not an account');
  const now = cleanIncident(fake.cloudDoc(path), inc.id);
  assert.equal(now.coverUid, 'ofc');
  await updateSeen(chief, sq.id, now, { lastSeenAt: null, pace: 'walk', brief: null });
  assert.equal(fake.cloudDoc(path).coverUid, 'ofc', 'correcting last seen keeps the cover');
  await endIncident(chief, sq.id, now, summarise({ inc: now, trail: [], marks: [], units: 1, now: Date.now() }));
  assert.equal(fake.cloudDoc(path).coverUid, 'ofc', 'ending keeps the cover');
  await refused(setCover(chief, sq.id, now, null), 'changing an ended incident');
});

/* ── Move D: the dog's record card ─────────────────────────────────────── */
const DAYMS = 864e5;
const R0 = 1_760_000_000_000;
const recRun = (o = {}) => ({
  id: o.id || `r${Math.round(o.age ?? 0)}-${o.at ?? 0}`, dogId: 'rex', handlerId: o.h ?? 'me', startedAt: o.at ?? R0,
  data: { track: [{ lat: 51, lon: -2, t: 0 }, { lat: 51.001, lon: -2, t: 60e3 }], trackStarted: o.at ?? R0,
    ...(o.age == null ? {} : { result: { ageMin: o.age } }), debrief: o.debrief ?? null,
    ...(o.coach ? { coach: { assisted: true } } : {}), ...(o.shown ? { revealedAt: 5 } : {}),
    ...(o.imported ? { imported: { at: (o.at ?? R0) + DAYMS } } : {}) },
});

t('the dog’s record: worked out from this phone’s own runs, the blind figure by its own filter', () => {
  const real = (outcome, x = {}) => ({ outcome, target: 'real', blind: 'handler', ...x });
  const runs = [
    recRun({ id: 'a', age: 20, at: R0 - 5 * DAYMS, debrief: real('found') }),
    recRun({ id: 'b', age: 90, at: R0 - 4 * DAYMS, debrief: real('false') }),
    recRun({ id: 'c', age: 300, at: R0 - 3 * DAYMS, coach: true, debrief: real('found') }),     // coach on: not blind
    recRun({ id: 'd', age: 30, at: R0 - 2 * DAYMS, shown: true, debrief: real('found') }),      // trail shown: not blind
    recRun({ id: 'e', at: R0 - DAYMS, debrief: { outcome: 'blank', target: 'control', blind: 'open' } }),   // the handler knew
    recRun({ id: 'f', age: 15, at: R0, imported: true, debrief: real('found') }),               // someone else's run
    recRun({ id: 'g', age: 10, at: R0 - 6 * DAYMS, debrief: { outcome: 'blank', target: 'control', blind: 'double' } }),
  ];
  const now = R0 + 40 * DAYMS;
  const r = dogRecord({ dog: 'Rex', runs, handlerId: 'me', licence: { body: ' NPCC ', expires: now + 90 * DAYMS }, now });
  assert.deepEqual([r.trails, r.h1, r.h4, r.older, r.noAge], [6, 3, 1, 1, 1], 'age bands; a run kept from another link is left out');
  assert.deepEqual([r.blind, r.blindReal, r.blindFound], [3, 2, 1], 'blind: nothing told the handler; found: on a real person only');
  assert.equal(r.wrong, 1);
  assert.equal(r.last, R0 - DAYMS, 'the newest own run, not the imported one');
  assert.equal(r.sure, calibration(runsOf(runs.filter(x => x.id !== 'f'), 'me')).bands.find(b => b.v === 'sure').n);
  assert.deepEqual(r.gaps.split('\n'), ['No blind runs over 4 h old.', 'Not trained in the last 30 days.', 'No run yet without help.']);
  assert.deepEqual([r.lic, r.licTo, r.pretend, r.v], ['NPCC', now + 90 * DAYMS, false, 1]);
  assert.deepEqual(Object.keys(r).sort(), [...RECORD_KEYS].sort(), 'every field, every time');
  // A dog whose every run the handler knew: the gaps say so, about the handler.
  const knew = dogRecord({ dog: 'Rex', runs: [recRun({ age: 20, debrief: { outcome: 'found', target: 'real', blind: 'open', help: 'none' } })], now: R0 });
  assert.match(knew.gaps, /^No blind runs yet\.\nEvery run so far was one the handler knew the answer to\./);
  assert.doesNotMatch(knew.gaps, /\byou\b/i, 'Command’s card is about the handler, never “you”');
  const none = dogRecord({ dog: 'Rex', runs: [], now: R0 });
  assert.deepEqual([none.trails, none.last, none.gaps], [0, null, 'No trails in the handler’s Trailcraft log yet.']);
});

t('a shared record is bounded field by field on the way in', () => {
  const big = { v: 1, at: R0, dog: '<b>Rex</b>'.repeat(9), pretend: 'yes', trails: 1e9, h1: 1e9, h4: 2.5, older: '3', noAge: -1,
    blind: 4, blindReal: 9, blindFound: 12, wrong: 2, last: 'then', sure: 3, sureRight: 8,
    gaps: ['x'.repeat(300), 'a', 'b', 'c', 'd', 'e', 'f'].join('\n'), lic: 'L'.repeat(90), licTo: 'soon', evil: 1 };
  const c = cleanRecord(big);
  assert.equal(c.dog.length, 40);
  assert.deepEqual([c.trails, c.h1, c.h4, c.older, c.pretend], [100000, 100000, 0, 0, false]);
  assert.deepEqual([c.blind, c.blindReal, c.blindFound, c.sure, c.sureRight], [4, 4, 4, 3, 3], 'never more found than run');
  // Every count is a count of trails: none above them, and the age bands add up to them.
  const few = cleanRecord({ v: 1, at: R0, trails: 10, h1: 6, h4: 2, older: 1, noAge: 1, blind: 61, blindReal: 61, blindFound: 50, sure: 40, sureRight: 40 });
  assert.deepEqual([few.blind, few.blindReal, few.blindFound, few.sure, few.sureRight], [10, 10, 10, 10, 10], '“Trails 10 · Blind runs 61” cannot be shown');
  assert.equal(cleanRecord({ v: 1, at: R0, trails: 10, h1: 6, h4: 2, older: 1, noAge: 0 }), null, 'bands that do not add up: not made by the app');
  assert.deepEqual([c.last, c.licTo, c.lic.length, c.evil], [null, null, 60, undefined]);
  const gaps = c.gaps.split('\n');
  assert.deepEqual([gaps.length, gaps[0].length], [GAPS_MAX, GAP_MAX]);
  assert.equal(cleanRecord({ ...big, v: 2 }), null, 'a record of another shape is not read');
  assert.equal(cleanRecord(null), null);
  assert.equal(cleanRecord({ ...big, at: 'x' }), null);
  // Only a K9 handler carries one; it rides on the member as the cloud gives it.
  const m = cleanMember({ uid: 'k', role: 'k9', callSign: 'K9-1', dog: 'Rex', joinedAt: 1, record: big }, 'k');
  assert.equal(m.record.trails, 100000);
  assert.equal(cleanMember({ uid: 'o', role: 'officer', callSign: '2A12', joinedAt: 1, record: big }, 'o').record, null);
});

t('the licence chip: as typed, amber in its last 30 days, red after; dates read the same on every phone', () => {
  const rec = (lic, licTo) => cleanRecord({ v: 1, at: R0, lic, licTo });
  assert.deepEqual(licenceState(rec(null, null), R0), { cls: 'none', text: 'No licence typed in by the handler' });
  assert.equal(licenceState(rec('NPCC', null), R0).text, 'NPCC · no end date typed in');
  assert.equal(licenceState(rec('NPCC', R0 + 200 * DAYMS), R0).cls, 'ok');
  const soon = licenceState(rec('NAPWDA', R0 + 18 * DAYMS), R0);
  assert.equal(soon.cls, 'soon');
  assert.match(soon.text, /^NAPWDA · ends \d{1,2} [A-Z][a-z]{2} \d{4}, in 18 days$/);
  assert.equal(licenceState(rec('NAPWDA', R0 + 30 * DAYMS), R0).cls, 'soon', '30 days is within 30 days');
  assert.equal(licenceState(rec('NAPWDA', R0 + 31 * DAYMS), R0).cls, 'ok');
  assert.match(licenceState(rec('USPCA', R0 - DAYMS), R0).text, /^USPCA · ended /);
  assert.equal(licenceState(rec('USPCA', R0 - DAYMS), R0).cls, 'late');
  const end = licenceEnd('2026-12-01');
  assert.equal(new Date(end).getDate(), 1);
  assert.equal(licenceDay(end), '2026-12-01', 'back into the date field as it was typed');
  for (const bad of ['', '2026-02-31', '01/12/2026', 'soon', '1850-01-01']) assert.equal(licenceEnd(bad), null, bad);
  assert.equal(licenceDay(null), '');
  assert.equal(dayWords(new Date(2026, 10, 4, 12).getTime()), '4 Nov 2026');
});

t('the card’s words show the record and leave the decision to the supervisor', () => {
  const r = cleanRecord({ v: 1, at: R0, dog: 'Rex', trails: 12, h1: 8, h4: 3, older: 1, noAge: 0, blind: 6, blindReal: 6, blindFound: 5,
    wrong: 2, last: R0 - 2 * DAYMS, sure: 3, sureRight: 3, gaps: 'No blind runs over 4 h old.', lic: 'NPCC', licTo: R0 + 9 * DAYMS });
  const w = recordWords(r, R0);
  assert.equal(w.title, 'Rex’s record');
  const row = (k) => w.rows.find(x => x.k.includes(k));
  assert.equal(row('Trails').sub, '8 under 1 h old · 3 at 1–4 h · 1 over 4 h', 'counts first, so “1 h 8” never reads as a time');
  assert.equal(recordWords(cleanRecord({ ...r, h1: 7, noAge: 1 }), R0).rows[0].sub, '7 under 1 h old · 3 at 1–4 h · 1 over 4 h · 1 age not known');
  assert.equal(row('Blind').sub, '6 on a real person: found 5 of 6 (83%)', 'says why the two numbers differ');
  assert.equal(row('Wrong').sub, 'in 12 trails, from the handler’s debriefs');
  assert.equal(row('Last').v, dayWords(R0 - 2 * DAYMS));
  assert.equal(row('Last').sub, '2 days ago, as of when it was shared');
  assert.equal(w.old, '', 'shared today: nothing to say');
  // Shared months ago: last trained is still counted to the day it was shared, and the card asks for it again.
  const later = recordWords(r, R0 + 183 * DAYMS);
  assert.equal(later.rows.find(x => x.k.includes('Last')).sub, '2 days ago, as of when it was shared');
  assert.equal(later.old, 'Shared 183 days ago: ask the handler to share it again');
  assert.equal(recordWords(r, R0 + 7 * DAYMS).old, '', 'a week is still current');
  assert.equal(recordWords(cleanRecord({ ...r, pretend: true }), R0 + 30 * DAYMS).old, '', 'never on a pretend card');
  // Named by the team's dog as the squad knows it, not by what the record says.
  assert.equal(recordWords(r, R0, 'Bella').title, 'Bella’s record');
  assert.deepEqual([row('Certain').v, row('Certain').sub], ['3 of 3 right', 'too few to say'], 'no percentage under five');
  assert.equal(recordWords(cleanRecord({ ...r, blindReal: 2, blindFound: 2 }), R0).rows[1].sub, '2 on a real person: found 2 of 2, too few to read much into');
  assert.equal(w.lic.cls, 'soon');
  assert.match(w.from, /^From the handler’s own Trailcraft log, worked out /);
  const all = [w.title, w.from, later.old, ...w.rows.flatMap(x => [x.k, x.v, x.sub]), ...w.gaps, w.lic.text, RECORD_SAYS, RECORD_NOTE].join(' ');
  assert.doesNotMatch(all, /secure|evidence|sealed|CJIS|prediction|proof|certified|cleared|approved|justif|deploy/i);
  assert.equal(RECORD_SAYS, 'It shows the record; the supervisor decides.');
  assert.match(RECORD_NOTE, /not licensing \(NPCC in the UK\) or certification \(state, POST, NAPWDA or USPCA in the US\)\. A court can ask to see it\./);
});

t('pretend: Rex and Bella carry made-up records, labelled pretend, frozen into the pretend incident', () => {
  const t0 = 1_700_000_000_000;
  const sim = createSim({ center: { lat: 51.2094, lon: -2.6476 }, now: t0, seed: 3, callSigns: ['Dog 1'] });
  const ms = [...sim.members().values()];
  const rex = ms.find(m => m.uid === 'sim-1'), bella = ms.find(m => m.uid === 'sim-2');
  assert.equal(rex.callSign, 'Dog 1', 'his call signs, the same dog');
  assert.deepEqual([rex.record.dog, rex.record.pretend, bella.record.dog, bella.record.pretend], ['Rex', true, 'Bella', true]);
  assert.ok(ms.filter(m => m.role !== 'k9').every(m => m.record === null));
  assert.equal(licenceState(rex.record, t0).cls, 'ok');
  assert.equal(licenceState(bella.record, t0).cls, 'soon', 'the chief sees the amber chip');
  assert.equal(recordWords(rex.record, t0).from, 'Pretend: made up for the demo');
  assert.ok(rex.record.blindFound <= rex.record.blindReal && rex.record.blindReal <= rex.record.blind);
  const si = createSimIncident({ sim, lkp: { lat: 51.21, lon: -2.646 }, k9Uid: 'sim-1', now: t0, k9Record: rex.record });
  assert.deepEqual(si.inc.k9Record, rex.record, 'frozen into the incident as picked');
  // Frozen: the incident carries its own copy, never a link to the member.
  const d = incidentDoc({ name: 'X', lkp: { lat: 51.2, lon: -2.6 }, k9Uid: 'k9', uid: 'c', now: t0, k9Record: rex.record });
  assert.deepEqual(cleanIncident(d, 'i').k9Record, rex.record);
  assert.equal(incidentDoc({ name: 'X', lkp: { lat: 51.2, lon: -2.6 }, uid: 'c', now: t0, k9Record: rex.record }).k9Record, null, 'no team, no card');
  assert.equal(cleanIncident({ ...d, k9Record: { v: 1, at: 'x' } }, 'i').k9Record, null);
});

t('the record card screens go by their functions, escape what others typed, and keep the licence on the phone', () => {
  const ui = read('public/incident-ui.js');
  assert.match(ui, /k9Record: frozenRecord\(st, k9Uid\) \}\);/, 'the pretend incident freezes the card');
  assert.match(ui, /startIncident\(h, I\.sid, \{ name: f\.name, lkp: f\.lkp, k9Uid: f\.k9Uid, \.\.\.seen, k9Record: frozenRecord\(st, f\.k9Uid\) \}\)/,
    'the real incident freezes the card');
  assert.match(ui, /\$\{pickCardHtml\(k9s, f\.k9Uid, st\.sim \? viewNow\(\) : Date\.now\(\)\)\}/, 'shown as Command picks the team');
  assert.match(ui, /\$\{frozenCardHtml\(inc, st\.members\?\.get\(inc\.k9Uid\)\?\.dog \?\? null\)\}/, 'on the live card');
  assert.match(ui, /\$\{frozenCardHtml\(r\.rp\.inc, st\.members\?\.get\(r\.rp\.inc\.k9Uid\)\?\.dog \?\? null\)\}/, 'in the replay');
  assert.match(ui, /recordCard\(rec, inc\.startedAt, \{ frozen: true, dog \}\)/, 'read as it was when the incident opened');
  assert.match(ui, /const w = recordWords\(rec, inc\.startedAt, dog\);/, 'the fold says the trails and licence as they were then');
  assert.match(ui, /if \(I\.recOpen == null\) I\.recOpen = true;/, 'the first pretend incident opens with the record unfolded');
  const card = ui.slice(ui.indexOf('function recordCard('), ui.indexOf('function pickCardHtml('));
  assert.match(card, /return html`/);
  assert.doesNotMatch(card, /innerHTML|safe\(/);
  // What a handler typed cannot reach the page as markup.
  const evil = '<img src=x onerror=alert(1)>';
  const out = html`<b>${recordWords(cleanRecord({ v: 1, at: R0, dog: evil, gaps: evil, lic: evil }), R0).title}</b>`;
  assert.doesNotMatch(Object.getOwnPropertySymbols(out).map(k => out[k])[0], /<img/);
  const sq = read('public/squad-ui.js');
  assert.match(sq, /await shareRecord\(h, S\.squad\.id, dogRecord\(\{ dog: mine\.dog, runs: dog\.runs, handlerId: dog\.handlerId, licence, now: Date\.now\(\) \}\)\)/);
  assert.match(sq, /note: `\$\{RECORD_NOTE\} The licence is kept on this phone and sent only with the card\.`/, 'the note where it is shared');
  assert.match(sq, /const licenceKey = \(dogId\) => `squadLicence\.\$\{dogId\}`;/);
  const share = sq.slice(sq.indexOf('async function doShareRecord'), sq.indexOf('async function doStopRecord'));
  assert.doesNotMatch(share, /db\.|dogs\.(save|put|patch)|patchDog|\bconfirm\(/, 'the licence never goes on the dog’s synced record');
  assert.match(share, /await form\(\{/);
  const app = read('public/app.js');
  assert.match(app, /dogRuns: \(name\) => \{/);
  assert.match(read('public/index.html'), /id="sqRecord"[^>]*>Share your dog’s record with the squad</);
  assert.match(read('public/app.css'), /\.inc-lic-soon(, \.inc-rec-old)? \{/);
});

t('the record in the cloud: the handler shares it on their own member record, bounded, and it is frozen into the incident', async () => {
  const mpath = `squads/${sq.id}/members/k9`;
  const now = Date.now();
  const rec = dogRecord({ dog: 'Rex', runs: [recRun({ age: 20, at: now - DAYMS, debrief: { outcome: 'found', target: 'real', blind: 'handler' } })],
    licence: { body: 'NPCC', expires: now + 20 * DAYMS }, now });
  await shareRecord(k9, sq.id, rec);
  assert.deepEqual(cleanRecord(fake.cloudDoc(mpath).record), cleanRecord(rec));
  assert.equal(fake.cloudDoc(mpath).role, 'k9', 'nothing else on the member moves');
  const mine = await myMember(k9, sq.id);
  assert.equal(mine.record.trails, 1);
  // Bounded by the rules, not only by the app.
  const write = (who, r) => fake.setDoc(fake.doc(who.fs, ...PATHS.member(sq.id, 'k9')), { record: r }, { merge: true });
  await refused(write(k9, { ...rec, trails: -1 }), 'a count below nought');
  await refused(write(k9, { ...rec, trails: 1.5 }), 'a count that is not whole');
  await refused(write(k9, { ...rec, blindFound: 2, blindReal: 1 }), 'more found than run');
  await refused(write(k9, { ...rec, gaps: 'x'.repeat(621) }), 'gaps past their length');
  await refused(write(k9, { ...rec, lic: 'L'.repeat(61) }), 'a licence past 60');
  await refused(write(k9, { ...rec, evil: '<script>' }), 'a record with more in it');
  await refused(write(k9, { ...rec, v: 2 }), 'a record of another shape');
  await refused(write(k9, { ...rec, blind: rec.trails + 60, blindReal: 0, blindFound: 0 }), 'more blind runs than trails');
  await refused(write(k9, { ...rec, sure: rec.trails + 1, sureRight: 0 }), 'more “Certain” calls than trails');
  await refused(write(k9, { ...rec, h1: rec.h1 + 1 }), 'age bands that do not add up to the trails');
  await refused(write(chief, { ...rec, trails: 99 }), 'Command writing a handler’s record');
  await refused(write(chief, null), 'Command taking a handler’s record away');
  await refused(write(ofc, { ...rec, trails: 99 }), 'another member writing it');
  await refused(shareRecord(stranger, sq.id, rec), 'a stranger sharing into the squad');
  // Command picks the team: the card goes into the incident as it stood.
  const inc = await startIncident(chief, sq.id, { name: 'Record test', lkp: { lat: 51.2094, lon: -2.6476 }, k9Uid: 'k9', k9Record: mine.record });
  const path = `squads/${sq.id}/incidents/${inc.id}`;
  assert.deepEqual(cleanRecord(fake.cloudDoc(path).k9Record), mine.record);
  assert.deepEqual(inc.k9Record, mine.record);
  // Only the handler's own record, exactly as stored, can be frozen: not one Command made up.
  const made = (id, k9Record) => fake.setDoc(fake.doc(chief.fs, ...PATHS.incident(sq.id, id)), { name: 'X', lkp: { lat: 51.2, lon: -2.6 },
    k9Uid: 'k9', startedBy: 'chief', startedAt: Date.now(), endedAt: null, status: 'active', summary: null, k9Record,
    expiresAt: Date.now() + 3600e3, deleteAt: fake.Timestamp.fromMillis(Date.now() + 3600e3) });
  const stored = fake.cloudDoc(mpath).record;
  await refused(made('madeUp', { ...stored, trails: 146, h1: 146, blind: 52, blindReal: 52, blindFound: 52, licTo: Date.now() + 1500 * DAYMS }),
    'a record Command wrote itself');
  await refused(made('madeUp2', { ...stored, lic: 'NAPWDA' }), 'the licence changed on the way');
  const reordered = Object.fromEntries(Object.entries(stored).reverse());
  await made('exactCopy', reordered);
  assert.deepEqual(fake.cloudDoc(`squads/${sq.id}/incidents/exactCopy`).k9Record, reordered, 'the same map, in any order');
  // The app copies it exactly as stored, and says so when the card Command saw has since changed.
  await assert.rejects(startIncident(chief, sq.id, { name: 'Stale card', lkp: { lat: 51.2094, lon: -2.6476 }, k9Uid: 'k9',
    k9Record: { ...mine.record, trails: 2, h1: 2 } }), /changed the dog’s record/);
  // The handler shares a newer one, or stops: the incident keeps what Command saw.
  await shareRecord(k9, sq.id, null);
  assert.equal(fake.cloudDoc(mpath).record, null);
  assert.equal((await myMember(k9, sq.id)).record, null);
  assert.deepEqual(cleanRecord(fake.cloudDoc(path).k9Record), mine.record);
  const iw = (x) => fake.setDoc(fake.doc(chief.fs, ...PATHS.incident(sq.id, inc.id)), { ...fake.cloudDoc(path), ...x });
  await refused(iw({ k9Record: { ...fake.cloudDoc(path).k9Record, blindFound: 0 } }), 'the frozen card changed');
  await refused(iw({ k9Record: null }), 'the frozen card taken away');
  const held = cleanIncident(fake.cloudDoc(path), inc.id);
  await setCover(chief, sq.id, held, 'ofc');
  await updateSeen(chief, sq.id, held, { lastSeenAt: null, pace: 'walk', brief: null });
  await endIncident(chief, sq.id, held, summarise({ inc: held, trail: [], marks: [], units: 1, now: Date.now() }));
  assert.deepEqual(cleanRecord(fake.cloudDoc(path).k9Record), mine.record, 'the cover, last seen and the end all keep it');
  // A card with no team to belong to is refused.
  const lone = { name: 'X', lkp: { lat: 51.2, lon: -2.6 }, k9Uid: null, startedBy: 'chief', startedAt: Date.now(), endedAt: null, status: 'active',
    summary: null, k9Record: mine.record, expiresAt: Date.now() + 3600e3, deleteAt: fake.Timestamp.fromMillis(Date.now() + 3600e3) };
  await refused(fake.setDoc(fake.doc(chief.fs, ...PATHS.incident(sq.id, 'loneRecord')), lone), 'a card with no K9 team');
});

t('a mark taken back in the cloud is withdrawn, once, in the withdrawer’s name, and never deleted', async () => {
  const inc = await startIncident(chief, sq.id, { name: 'Withdraw test', lkp: { lat: 51.2094, lon: -2.6476 }, k9Uid: 'k9' });
  const mid = await putMark(ofc, sq.id, inc.id, { kind: 'roadblock', lat: 51.21, lon: -2.64 });
  const ref = fake.doc(ofc.fs, ...PATHS.mark(sq.id, inc.id, mid));
  const path = `squads/${sq.id}/incidents/${inc.id}/marks/${mid}`;
  await refused(fake.setDoc(ref, { withdrawnBy: 'chief', withdrawnAt: Date.now() }, { merge: true }), 'withdrawn in someone else’s name');
  await refused(fake.setDoc(ref, { withdrawnBy: 'ofc', withdrawnAt: Date.now() + 3600e3 }, { merge: true }), 'withdrawn an hour ahead');
  await refused(fake.setDoc(ref, { withdrawnBy: 'ofc', withdrawnAt: Date.now(), lat: 51.3 }, { merge: true }), 'moved as it is withdrawn');
  await refused(withdrawMark(stranger, sq.id, inc.id, mid), 'a stranger withdrawing it');
  const born = { ...markDoc({ kind: 'sighting', uid: 'ofc', at: Date.now(), lat: 51.21, lon: -2.64 }), withdrawnBy: 'ofc', withdrawnAt: Date.now() };
  await refused(fake.setDoc(fake.doc(ofc.fs, ...PATHS.mark(sq.id, inc.id, 'ofc_900')),
    { ...born, deleteAt: fake.Timestamp.fromMillis(born.expiresAt) }), 'a mark made already withdrawn');
  await withdrawMark(ofc, sq.id, inc.id, mid);
  const held = fake.cloudDoc(path);
  assert.equal(held.withdrawnBy, 'ofc');
  assert.equal(held.kind, 'roadblock', 'the rest of it kept');
  await refused(withdrawMark(chief, sq.id, inc.id, mid), 'withdrawing it twice');
  const { withdrawnBy, withdrawnAt, ...back } = held;
  await refused(fake.setDoc(ref, back), 'its maker bringing it back');
  await refused(fake.deleteDoc(ref), 'its maker deleting it');
  await refused(fake.deleteDoc(fake.doc(chief.fs, ...PATHS.mark(sq.id, inc.id, mid))), 'the creator deleting a mark while the incident runs');
  // Read back by every member: off the map, in the log.
  const { marks } = await loadIncident(k9, sq.id, inc.id);
  assert.equal(marks.get(mid).withdrawnBy, 'ofc');
  assert.equal(standingOf(marks).length, 0);
  // Command withdraws anyone's.
  const mid2 = await putMark(ofc, sq.id, inc.id, { kind: 'sighting', lat: 51.21, lon: -2.64 });
  await refused(withdrawMark(k9, sq.id, inc.id, mid2), 'a handler withdrawing an officer’s mark');
  await withdrawMark(chief, sq.id, inc.id, mid2);
  assert.equal(fake.cloudDoc(`squads/${sq.id}/incidents/${inc.id}/marks/${mid2}`).withdrawnBy, 'chief');
  await endIncident(chief, sq.id, inc, summarise({ inc, trail: [], marks, units: 1, now: Date.now() }));
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
  // A running incident with a mark on it: deleting the squad ends it first, then takes it all.
  const live = await startIncident(chief, sq.id, { name: 'Still running', lkp: { lat: 51.2094, lon: -2.6476 }, k9Uid: 'k9' });
  await putMark(ofc, sq.id, live.id, { kind: 'sighting', lat: 51.21, lon: -2.64 });
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

/* ── Move C: keeping officers off the track ──────────────────────────── */
t('the downwind band is a wedge from the last known point the way the wind blows, and none in a calm', () => {
  const lkp = { lat: 51.2094, lon: -2.6476 };
  const b = downwindBand(lkp, { speed: 4, from: 270 });          // a westerly blows east
  assert.ok(b);
  assert.ok(Math.abs(bearing(lkp, b.tip) - 90) < 0.5, 'it points downwind');
  assert.equal(b.lengthM, 180);
  assert.deepEqual(b.pts[0], b.pts[b.pts.length - 1], 'a closed shape');
  assert.deepEqual(b.pts[0], lkp, 'from the point itself');
  for (const p of b.pts.slice(1, -1)) {
    assert.ok(Math.abs(dist(lkp, p) - b.lengthM) < 1, 'the far edge is an arc');
    assert.ok(Math.abs(bearing(lkp, p) - 90) <= b.half + 0.5, 'inside the spread');
  }
  const light = downwindBand(lkp, { speed: 1, from: 0 });
  assert.ok(light.half > b.half && light.lengthM < b.lengthM, 'a light wind wanders more and carries less');
  assert.ok(Math.abs(bearing(lkp, light.tip) - 180) < 0.5, 'a northerly blows south');
  assert.ok(downwindBand(lkp, { speed: 30, from: 90 }).lengthM <= 250, 'never longer than 250 m');
  assert.equal(downwindBand(lkp, { speed: CALM_MS / 2, from: 90 }), null, 'a calm gives no direction');
  for (const w of [null, {}, { speed: NaN, from: 10 }, { speed: 3 }]) assert.equal(downwindBand(lkp, w), null);
  assert.equal(downwindBand({ lat: 99, lon: 0 }, { speed: 3, from: 10 }), null);
  // Honest words: a modelled guide, never where the person went.
  assert.match(BAND_WORDS, /modelled guide from the forecast wind, not where the person went/);
  assert.equal(bandWindWords({ speed: 4, from: 225 }), 'wind from the SW, 14 km/h');
  assert.equal(bandWindWords({ speed: 4, from: 225 }, true), 'wind from the SW, 9 mph');
  assert.match(bandWindWords({ speed: 0.2, from: 225 }), /too light to give a direction/);
  assert.equal(bandWindWords(null), '');
});

t('who walked the scene: units on foot within about 30 m of the point between the opening and the dog', () => {
  const lkp = { lat: 51.2094, lon: -2.6476 };
  const t0 = 1_800_000_000_000;
  const inc = { lkp, k9Uid: 'k9', startedAt: t0 };
  const at = (b, m, t, spd) => ({ ...project(lkp, b, m), t, spd });
  const lines = new Map([
    ['foot3', { uid: 'foot3', pts: [at(0, 200, t0 + 10e3, 1.4), at(0, 12, t0 + 60e3, 0.8), at(0, 20, t0 + 70e3, 1.2)] }],
    // A car driving past at 10 m/s, fixes either side of the point: left out by its speed.
    ['car', { uid: 'car', pts: [at(270, 60, t0 + 30e3), at(270, 15, t0 + 34.5e3), at(90, 30, t0 + 39e3)] }],
    // A car stopped at the point: its officer may have got out, so it counts.
    ['car2', { uid: 'car2', pts: [at(180, 25, t0 + 40e3, 0), at(180, 25, t0 + 50e3, 0)] }],
    ['early', { uid: 'early', pts: [at(0, 5, t0 - 60e3, 0.5), at(0, 300, t0 + 10e3, 1)] }],     // before the opening
    ['late', { uid: 'late', pts: [at(0, 5, t0 + 200e3, 0.5)] }],                                 // after the dog
    ['far', { uid: 'far', pts: [at(0, SCENE_M + 5, t0 + 20e3, 0.5)] }],
    ['k9', { uid: 'k9', pts: [at(0, 2, t0 + 30e3, 1)] }],                                        // the team itself
  ]);
  const got = sceneWalkers({ inc, lines, until: t0 + 120e3 });
  assert.deepEqual(got.map(w => w.uid), ['car2', 'foot3'], 'oldest first');
  assert.ok(Math.abs(got[1].m - 12) < 1, 'how close they came');
  assert.deepEqual(sceneWalkers({ inc, lines: [...lines.values()], until: t0 + 50e3 }).map(w => w.uid), ['car2'], 'a list does as well as a Map; only up to the dog');
  assert.deepEqual(sceneWalkers({ inc: null, lines, until: Infinity }), []);
  assert.ok(speedAt(lines.get('car').pts, 1) > FOOT_MS, 'a speed worked from the fixes either side');
  assert.equal(speedAt(lines.get('foot3').pts, 1), 0.8, 'what the phone said comes first');
  assert.equal(sceneWords([]), '');
  assert.equal(sceneWords(['Foot 3']), 'Before the dog: Foot 3 was at the last known point');
  assert.equal(sceneWords(['Foot 3', '2A12']), 'Before the dog: Foot 3 and 2A12 were at the last known point');
  assert.equal(sceneWords(['Foot 3', '2A12', 'Foot 5'], false), 'At the last known point so far: Foot 3, 2A12 and Foot 5');
  assert.equal(nameList(['A', 'B', 'C', 'D']), 'A, B, C and D');
  assert.match(SCENE_NOTE, /about 30 m/);
  // The folded phone strip names anyone inside the perimeter.
  assert.match(stripWords({ k9: { callSign: 'K9-1' }, info: { lengthM: 10 }, now: 0, inside: [{ callSign: 'Foot 5' }] }),
    /Foot 5 inside the perimeter/);
  assert.doesNotMatch(stripWords({ k9: { callSign: 'K9-1' }, info: { lengthM: 10 }, now: 0 }), /inside/);
  // The log says it once the dog is there, after the team's own line.
  const trail = [{ ...project(lkp, 0, 5), t: t0 + 120e3 }];
  const log = logLines({ inc: { ...inc, startedBy: 'c', name: 'X' }, marks: new Map(), trail, who: () => 'Sgt', team: 'K9-1 Rex',
                         scene: sceneWords(['Foot 3']) });
  assert.deepEqual(log.map(l => l.key), ['open', 'trail', 'scene']);
  assert.equal(log[2].text, 'Before the dog: Foot 3 was at the last known point');
  assert.deepEqual(logLines({ inc: { ...inc, startedBy: 'c' }, marks: new Map(), trail, who: () => 'Sgt' }).map(l => l.key), ['open', 'trail'],
    'no line when nobody walked it');
});

t('inside the perimeter: foot units well inside a ring that has stood a while, not the team, its cover or those doing as told', () => {
  const c = { lat: 51.2094, lon: -2.6476 };
  const t0 = 1_800_000_000_000;
  const now = t0 + PERIM_GRACE_MS + 10e3;
  const inc = { lkp: c, k9Uid: 'k9', coverUid: 'cover' };
  const perim = { id: 'p', kind: 'perimeter', at: t0, pts: ring(c, 300, 12) };
  // A rally point just outside the ring, as a staging point stands.
  const rally = { id: 'r', kind: 'rally', at: t0, ...project(c, 180, 310) };
  const row = (uid, b, m, spd = 0.5) => ({ uid, callSign: uid.toUpperCase(), pos: { ...project(c, b, m), at: now - 5e3, spd } });
  const rows = [row('foot3', 0, 100), row('edge', 90, 300 - INSIDE_M + 8), row('k9', 0, 50), row('cover', 0, 60),
                row('atRally', 180, 270), row('car', 270, 100, 9), row('outside', 0, 400), row('parked', 300, 150)];
  // The parked car drove in a minute ago: a car, by its own line.
  const lines = new Map([['parked', { uid: 'parked', pts: [{ ...project(c, 300, 600), t: now - 60e3 }, { ...project(c, 300, 150), t: now - 20e3 }] }]]);
  const got = insideWalkers({ inc, marks: [perim, rally], rows, lines, now });
  assert.deepEqual(got.map(w => w.uid), ['foot3']);
  assert.ok(Math.abs(got[0].m - 200) < 10, 'how far in');
  assert.equal(insideWords(got[0]), 'FOOT3 is inside the perimeter, about 190 m in');
  assert.deepEqual(insideWalkers({ inc, marks: [{ ...perim, at: now - 60e3 }], rows, now }), [], 'a ring just drawn gives officers time to get out');
  assert.deepEqual(insideWalkers({ inc, marks: [{ ...perim, pts: perim.pts.slice(0, 5) }], rows, now }), [], 'an open line holds nobody in');
  // A rally point inside the ring excuses nobody: they stand on the ground it holds.
  const inRally = { ...rally, ...project(c, 180, 250) };
  assert.deepEqual(insideWalkers({ inc, marks: [perim, inRally], rows, lines, now }).map(w => w.uid), ['foot3', 'atRally']);
  // Walking out of the ring, or to the rally point, in the first minutes of the ring is doing as told.
  const out = new Map([['foot3', { uid: 'foot3', pts: [{ ...project(c, 0, 60), t: now - 65e3, spd: 1.2 }, { ...project(c, 0, 100), t: now - 5e3, spd: 1.2 }] }]]);
  assert.deepEqual(insideWalkers({ inc, marks: [perim, rally], rows, lines: out, now }).map(w => w.uid), ['parked'],
    'on the way out (and the parked car, with no line here, goes by its last position)');
  const toRally = new Map([['foot3', { uid: 'foot3', pts: [{ ...project(c, 0, 140), t: now - 65e3 }, { ...project(c, 0, 100), t: now - 5e3 }] }]]);
  assert.ok(!insideWalkers({ inc, marks: [perim, rally], rows, lines: toRally, now }).some(w => w.uid === 'foot3'), 'straight to the rally point');
  const behind = { ...rally, ...project(c, 0, 330) };
  assert.ok(insideWalkers({ inc, marks: [perim, behind], rows, lines: toRally, now }).some(w => w.uid === 'foot3'),
    'walking inward, away from the rally point: still in');
  const across = new Map([['foot3', { uid: 'foot3', pts: [{ ...project(c, 300, 120), t: now - 65e3 }, { ...project(c, 0, 100), t: now - 5e3 }] }]]);
  assert.ok(insideWalkers({ inc, marks: [perim, rally], rows, lines: across, now }).some(w => w.uid === 'foot3'),
    'a little nearer the rally point on the way across: still in');
  assert.ok(onFootNow(null, { spd: null }, now) && !onFootNow(null, { spd: 8 }, now), 'with no line, the last position says');
  assert.deepEqual(insideWalkers({ inc: null, marks: [perim], rows, now }), []);
});

t('inside the perimeter goes by fresh positions heard since the ring went up, and keeps walking out in softer words', () => {
  const c = { lat: 51.2094, lon: -2.6476 };
  const t0 = 1_800_000_000_000;
  const inc = { lkp: c, k9Uid: 'k9', startedAt: t0 - 60e3 };
  const perim = { id: 'p', kind: 'perimeter', at: t0, pts: ring(c, 300, 12) };
  const at = (b, m, heard, spd = 0.4) => ({ ...project(c, b, m), at: heard, spd });
  // A phone that went quiet five minutes ago inside a ring that has stood three: no live claim.
  const now = t0 + 8 * 60e3;
  const quiet = [{ uid: 'f5', callSign: 'Foot 5', pos: at(0, 100, now - 5 * 60e3) }];
  const got = insideWalkers({ inc, marks: [perim], rows: quiet, now });
  assert.equal(got.length, 1);
  assert.ok(got[0].old, 'kept only as last heard');
  assert.equal(insideWords(got[0], false, now), 'Foot 5 was inside the perimeter, last heard 5 min ago');
  assert.deepEqual(insideNow(got), [], 'never said out loud or counted as now');
  assert.doesNotMatch(stripWords({ k9: { callSign: 'K9-1' }, info: { lengthM: 10 }, now, inside: got }), /inside/, 'not on the folded strip');
  // Heard before the ring went up: it says nothing about the ring.
  const before = [{ uid: 'f5', callSign: 'Foot 5', pos: at(0, 100, t0 - 30e3) }];
  assert.deepEqual(insideWalkers({ inc, marks: [perim], rows: before, now: t0 + 3 * 60e3 }), []);
  // Older than the half hour the map draws: nothing at all.
  assert.deepEqual(insideWalkers({ inc, marks: [perim], rows: [{ uid: 'f5', callSign: 'Foot 5', pos: at(0, 100, now - 31 * 60e3) }], now }), []);
  // Walking out along the likely track from the last known point, well after the ring went up: listed.
  const late = t0 + GOING_GRACE_MS + 60e3;
  const rows = [{ uid: 'f3', callSign: 'Foot 3', pos: at(90, 120, late - 3e3, 1.3) }];
  const lines = new Map([['f3', { uid: 'f3', pts: [at(90, 40, late - 63e3, 1.3), at(90, 120, late - 3e3, 1.3)].map(p => ({ ...p, t: p.at })) }]]);
  const going = insideWalkers({ inc, marks: [perim], rows, lines, now: late });
  assert.deepEqual(going.map(w => [w.uid, w.going, w.old]), [['f3', true, false]], 'walking out is still on the ground the ring holds');
  assert.equal(insideWords(going[0]), 'Foot 3 is walking out of the perimeter, about 170 m in');
  assert.deepEqual(insideNow(going), [], 'in softer words, not spoken');
  // The same walk in the first minutes of the ring is doing as told.
  const early = t0 + PERIM_GRACE_MS + 20e3;
  const rowsE = [{ ...rows[0], pos: { ...rows[0].pos, at: early - 3e3 } }];
  const linesE = new Map([['f3', { uid: 'f3', pts: lines.get('f3').pts.map(p => ({ ...p, t: p.t - (late - early) })) }]]);
  assert.deepEqual(insideWalkers({ inc, marks: [perim], rows: rowsE, lines: linesE, now: early }), []);
  // The log keeps each time a unit went in, so a moment at ×10 is not lost.
  const seen = [{ uid: 'f5', callSign: 'Foot 5', m: 268, t: t0 + 150e3, at: project(c, 0, 30) }];
  const log = logLines({ inc: { ...inc, startedBy: 'c' }, marks: new Map(), trail: [], who: () => 'Sgt', inside: seen });
  assert.deepEqual(log.map(l => l.text), ['Incident opened by Sgt', 'Foot 5 went inside the perimeter, about 270 m in']);
  assert.deepEqual(logLines({ inc: { ...inc, startedBy: 'c' }, marks: new Map(), trail: [], who: () => 'Sgt', inside: seen, now: t0 + 100e3 })
    .map(l => l.key), ['open'], 'not before it happened, in a replay');
});

t('the cover officer’s distance says about, and how old the positions are', () => {
  const c = { lat: 51.2094, lon: -2.6476 };
  const now = 1_800_000_000_000;
  const k9 = { pos: { ...c, at: now - 5e3 } };
  const cover = { pos: { ...project(c, 90, 38), at: now - 25e3 } };
  assert.equal(coverWords({ name: 'Foot 3', cover, k9, now }), 'Cover: Foot 3, about 40 m from the handler · positions up to 25 s old, may be out of date');
  assert.equal(coverWords({ name: 'Foot 3', cover: { pos: { ...cover.pos, at: now - 2e3 } }, k9, now }),
    'Cover: Foot 3, about 40 m from the handler · positions a few seconds old, may be out of date');
  assert.equal(coverWords({ name: 'Foot 3', cover: null, k9, now }), 'Cover: Foot 3, no position from the app yet');
  assert.equal(coverWords({ name: '', cover, k9, now }), '');
  assert.equal(aboutWords(3), 'about 5 m');
  assert.equal(aboutWords(137), 'about 140 m');
  assert.match(aboutWords(40, true), /^about \d+ (ft|yd)$/);
  // On the incident: a member's account, never the handler's own.
  const lkp = { lat: 51.2, lon: -2.6 };
  assert.equal(incidentDoc({ name: 'x', lkp, k9Uid: 'k9', uid: 'c', now, coverUid: 'f3' }).coverUid, 'f3');
  assert.equal(incidentDoc({ name: 'x', lkp, k9Uid: 'k9', uid: 'c', now, coverUid: 'k9' }).coverUid, null);
  assert.equal(incidentDoc({ name: 'x', lkp, k9Uid: 'k9', uid: 'c', now }).coverUid, null);
  assert.equal(cleanIncident({ lkp, startedAt: now, coverUid: 'x'.repeat(129) }, 'i').coverUid, null);
  assert.equal(cleanIncident({ lkp, startedAt: now, coverUid: 42 }, 'i').coverUid, null);
  assert.equal(cleanIncident({ lkp, startedAt: now, k9Uid: 'k9', coverUid: 'f3' }, 'i').coverUid, 'f3');
});

t('the pretend incident walks the scene, picks a cover, and has one officer stop inside the perimeter', () => {
  const center = { lat: 51.2094, lon: -2.6476 };
  const t0 = 1_800_000_000_000;
  const sim = createSim({ center, now: t0, seed: 7 });
  const si = createSimIncident({ sim, lkp: project(sim.unit('sim-1'), 30, 120), now: t0, seed: 3, lastSeenAt: t0 - 60e3, pace: 'walk' });
  let scene = null, coverGap = Infinity, insideSeen = new Set(), t = t0, gaps = [], jump = 0, prev = null, held = 0;
  while (t < t0 + 25 * 60e3 && si.phase !== 'found') {
    t += 2000;
    sim.step(t); si.step(t, 10);
    // The standby team drives to the rally point: never a jump on the map.
    const k9b = sim.unit('sim-2');
    if (prev) jump = Math.max(jump, dist(prev, k9b));
    prev = { lat: k9b.lat, lon: k9b.lon };
    const lines = new Map([...si.tracks].map(([uid, pts]) => [uid, { uid, pts }]));
    const on = scentStart(si.trail, si.inc.lkp);
    if (on && !scene) scene = sceneWalkers({ inc: si.inc, lines, until: on.t });
    const rows = roster(sim.members(), sim.positions(), t);
    const inside = insideWalkers({ inc: si.inc, marks: standingOf(si.marks, t), rows, lines, now: t });
    for (const w of inside) insideSeen.add(w.uid);
    if (insideNow(inside).some(w => w.uid === 'sim-6')) held += 2000;
    if (si.inc.coverUid && si.phase === 'trailing') coverGap = Math.min(coverGap, dist(sim.unit(si.inc.coverUid), sim.unit('sim-1')));
    if (si.inc.coverUid && si.phase === 'trailing' && t - si.trailStart > 60e3) gaps.push(dist(sim.unit(si.inc.coverUid), sim.unit('sim-1')));
  }
  gaps.sort((a, b) => a - b);
  assert.ok(gaps[Math.floor(gaps.length * 0.9)] < 20, 'the cover stays a few metres behind the handler, not 75 m off');
  assert.ok(jump < 8 * 2 + 5, 'the standby van drives round: no jump');
  assert.ok(held >= 30e3 * 10, 'at ×10 Foot 5 stays inside for at least half a minute of real time');
  assert.ok(!insideSeen.has('sim-2'), 'the standby team at the rally point outside the ring is never inside');
  const rp = [...si.marks.values()].filter(m => m.kind === 'rally' && !m.withdrawnAt);
  const ringNow = [...si.marks.values()].filter(m => m.kind === 'perimeter' && !m.withdrawnAt);
  assert.ok(rp.length === 1 && ringNow.every(g => !insideLine(rp[0], g.pts)), 'the rally point stands outside the ring');
  assert.equal(si.phase, 'found');
  assert.deepEqual(scene.map(w => w.uid), ['sim-5'], 'the first officer on scene stood at the point before the dog');
  assert.equal(si.inc.coverUid, 'sim-5', 'the sergeant put them with the team as cover');
  assert.ok(coverGap < 40, 'the cover walks with the team');
  assert.ok(insideSeen.has('sim-6'), 'Foot 5 stopped inside the perimeter');
  assert.ok(!insideSeen.has('sim-1') && !insideSeen.has('sim-5'), 'never the team or its cover');
  si.setCover('sim-1');
  assert.equal(si.inc.coverUid, null, 'the handler is never their own cover');
  si.setCover('sim-3');
  assert.equal(si.inc.coverUid, 'sim-3');
  // The stray goes by what the sergeant knows, never the hidden line.
  const src = read('public/incident.js');
  const stray = src.slice(src.indexOf('function stray('), src.indexOf('const si = {', src.indexOf('function stray('))).replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(stray.length > 200);
  assert.doesNotMatch(stray, /\bscent\b|\bperson\b|hiddenRoute|pathAt/);
  const cover = src.slice(src.indexOf('function cover()'), src.indexOf('function record('));
  assert.doesNotMatch(cover.replace(/\/\*[\s\S]*?\*\//g, ''), /\bscent\b|\bperson\b|hiddenRoute/);
});

t('the command screen keeps officers off the track by its own functions, and says so honestly', () => {
  const ui = read('public/incident-ui.js');
  // The band: drawn only for a live incident, from the wind the app already has, with its caveat on the map.
  const bandOf = ui.slice(ui.indexOf('function bandOf('), ui.indexOf('function bandText('));
  assert.match(bandOf, /v\.inc\.status !== 'active' \|\| v\.replay\) return null;/);
  assert.match(bandOf, /downwindBand\(v\.inc\.lkp, windAt\(v\.inc\.lkp\)\)/);
  assert.match(ui, /el\.textContent = 'Downwind · modelled guide';/);
  assert.match(ui, /setData\(m, 'inc-band', lines\(band \? \[polygon\(band\.pts\)\] : \[\]\)\);/);
  assert.match(ui, /I\.bandTag\?\.marker\?\.remove\(\); I\.bandTag = null;\n  I\.log = \[\]/, 'torn down with the map');
  assert.doesNotMatch(ui, /start the dog here/i);
  // Who walked the scene: on the card, in the log, and to the handler before the run starts.
  assert.match(ui, /text\('scene', sc\.text \?/);
  const start = ui.slice(ui.indexOf('async function startTrailing('), ui.indexOf('/* ── The banner, on every screen'));
  assert.match(start, /await info\(\{ title: 'Before you start', close: 'Start trailing',/);
  assert.ok(start.indexOf('await info(') < start.indexOf('ctx.startTrail()'), 'told before the run starts');
  assert.match(ui, /logLines\(\{ \.\.\.base, marks: v\.said \|\| v\.marks, trail: v\.trail, scene: sceneAt\(v\.trail\) \}\)/);
  // Worked out on the device: positions it already gets, no new cloud reads.
  assert.match(ui, /if \(!st\.sim\) noteWalkers\(st\);/);
  const walk = ui.slice(ui.indexOf('function noteWalkers('), ui.indexOf('/** Command puts a cover officer'));
  assert.doesNotMatch(walk, /onSnapshot|getDocs|watch[A-Z]|loadIncident|ctx\.handle/);
  // Inside the perimeter: on the card, said once, only with the voice on.
  assert.match(ui, /text\('inside', inside\.map\(w => insideWords\(w, imperial\(\), v\.now\)\)\.join\('\\n'\)\);/);
  assert.match(ui, /if \(I\.voice && ctx\.speak && sq\(\)\.view\)/);
  assert.match(ui, /const inside = amCommand\(\) \? insideOf\(v, st\) : \[\];/, 'a line to Command, not to every member');
  // The cover: Command picks by a sheet, never confirm(); the card says the positions may be out of date.
  assert.match(ui, /data-inc-act="cover">Cover officer<\/button>/);
  assert.match(ui, /if \(act === 'cover'\) return pickCover\(\);/);
  assert.match(ui, /await setCover\(h, I\.sid, now\.inc, got\.uid \|\| null\)/);
  assert.doesNotMatch(ui, /\bconfirm\(/);
  // The wind comes from what app.js already fetched, near the point, never a new ask.
  const app = read('public/app.js');
  const wn = app.slice(app.indexOf('windNear: (p) => {'), app.indexOf('});', app.indexOf('windNear: (p) => {')));
  assert.match(wn, /dist\(wxNow\.near, p\) > 5000/);
  assert.doesNotMatch(wn, /fetchWeather|weatherHere|geolocation/);
  assert.match(app, /wxNow\.near = \{ lat: at\.lat, lon: at\.lon \};/);
  // No words a chief could over-read.
  const words = read('public/incident.js').slice(read('public/incident.js').indexOf('/* ── Keeping officers off the track'),
                                                  read('public/incident.js').indexOf('/* ── The live log'));
  assert.doesNotMatch(words, /secure|evidence|sealed|CJIS|prediction|proof/i);
  assert.match(read('public/app.css'), /\.inc-band-tag \{/);
});

t('two members with one call sign stay two everywhere: the cover list, the scene line, the log', () => {
  const members = new Map([
    ['a', { uid: 'a', callSign: 'Foot 3', role: 'officer', joinedAt: 1 }],
    ['b', { uid: 'b', callSign: 'foot 3', role: 'officer', joinedAt: 2 }],
    ['c', { uid: 'c', callSign: '2A12', role: 'officer', joinedAt: 3 }],
  ]);
  const names = callSignsOf(members);
  assert.deepEqual([...names].map(([uid, n]) => [uid, n.callSign]), [['a', 'Foot 3'], ['b', 'foot 3 (2)'], ['c', '2A12']]);
  assert.deepEqual(roster(members, new Map(), 0).map(r => r.callSign).sort(), ['2A12', 'Foot 3', 'foot 3 (2)'], 'the roster says the same');
  const ui = read('public/incident-ui.js');
  const who = ui.slice(ui.indexOf('function who('), ui.indexOf('/* ── Following the squad'));
  assert.match(who, /names = callSignsOf\(members\)/, 'every name on the incident screens goes by it');
  const pick = ui.slice(ui.indexOf('async function pickCover('), ui.indexOf('/* ── The live log'));
  assert.match(pick, /const rows = roster\(st\.members, st\.positions \|\| new Map\(\), v\.now\);/);
  assert.match(pick, /r\.uid !== v\.inc\.k9Uid && r\.role !== 'command' && r\.role !== 'k9'/, 'not Command, not the standby dog’s handler');
  assert.match(pick, /sort\(\(a, b\) => far\(a\) - far\(b\)/, 'nearest the handler first');
  assert.doesNotMatch(pick, /m\.callSign/, 'never the raw call sign');
  assert.match(ui, /const team = k9 \? `\$\{who\(v\.inc\.k9Uid, members\)\}/);
});

t('the map keeps its caveats readable: tags clear of pins, the panel and the Wall box; the cover named with the team', () => {
  const ui = read('public/incident-ui.js');
  const room = ui.slice(ui.indexOf('function tagRoom('), ui.indexOf('const TAG_SPOTS'));
  assert.match(room, /const pad = mapPad\(\);/);
  assert.match(room, /\.inc-mark \.inc-pin, \.inc-mark-tag, \.sq-unit, \.sq-tag/, 'pins and their labels are taken');
  assert.match(room, /underWall: /);
  const band = ui.slice(ui.indexOf('function paintBandTag('), ui.indexOf('function pinEl('));
  assert.match(band, /if \(len < BAND_MIN_PX\) \{ tag\.el\.hidden = true; return; \}/, 'a band a few pixels long labels nothing');
  assert.match(band, /const room = tagRoom\(\);/);
  assert.match(band, /if \(room\.clear\(x0, y0, tw, th\)\)/);
  assert.doesNotMatch(band, /W - 4|H - 4/, 'not the whole canvas, which runs under the panel');
  const reach = ui.slice(ui.indexOf('function paintReachTag('), ui.indexOf('const BAND_ANCHORS'));
  assert.match(reach, /const room = tagRoom\(\);/);
  assert.match(reach, /room\.clear\(x0, y0, tw, th\)/, 'never on a pin’s label');
  assert.match(reach, /window\.matchMedia\(NARROW\)\.matches\) \{ tag\.el\.hidden = true; return; \}/);
  // The band is drawn stronger on the Wall, and again after a style reload.
  assert.match(ui, /wall: \{ color: '#3FD3EA', fill: 0\.4, width: 3\.5, dash: \[3, 1\.5\] \}/);
  assert.match(ui, /if \(l\.src === 'inc-band'\) I\.bandLook = null;/);
  assert.match(ui, /setCoverUnit\(v\.inc\?\.coverUid \?\? null\);/);
  const sq = read('public/squad-ui.js');
  const dc = sq.slice(sq.indexOf('function declutter('), sq.indexOf('/* The arrow points'));
  assert.match(dc, /merged && m === lead \? `\$\{m\.label\} \+ cover \$\{cover\.callSign\}` : m\.label/);
  assert.match(dc, /m\.tag\.textContent !== label\) m\.tag\.textContent = label/, 'by textContent');
  assert.match(dc, /m\.tag\.hidden = merged && m === cover;/);
  assert.match(read('public/app.css'), /\.sq-tag\.sq-tag-up \{ top: auto; bottom: 34px; \}/);
  // The Demo label stays in view on a phone: the card scrolls, never the panel.
  const css = read('public/app.css');
  assert.match(css, /\.cmd-incident \{ flex: 0 1 auto; min-height: 0; overflow-y: auto;/);
  assert.match(css, /\.cmd-panel \.sq-demo \{ margin: 0; position: sticky; top: 0;/);
  assert.match(ui, /if \(panel && panel\.scrollTop\) panel\.scrollTop = 0;/);  assert.match(css, /\.cmd-panel\.inc-form \{ max-height: 62vh; \}/, 'the phone start form gets the room for the record card');
  assert.match(ui, /classList\.toggle\('inc-form', !!I\.form\)/);
  // The last known point, the calls and the caveats are not faded behind 3D buildings.
  assert.equal((ui.match(/occludedOpacity: FULL/g) || []).length, 5);
  // Inside the perimeter is said and logged once per going in, not on every GPS flicker.
  const speak = ui.slice(ui.indexOf('function speakInside('), ui.indexOf('/** Command puts a cover officer'));
  assert.match(speak, /if \(last != null && v\.now - last < BACK_IN_MS\) continue;/);
  assert.match(speak, /for \(const w of insideNow\(list\)\)/, 'only the live line, never the softer ones');
  assert.match(speak, /if \(!w\.old && w\.going && I\.inside\.ids\.has\(w\.uid\)\) I\.inside\.ids\.set\(w\.uid, v\.now\);/,
    'walking out but still inside keeps the time fresh, so stopping again is not a second "went inside"');
  assert.match(ui, /const inside = I\.inside\.for === v\.inc\.id \? I\.inside\.seen : \[\];/, 'into the log, the Wall and the replay');
});

t('a phone with two dogs of one name shares the right one: the handler’s own first, else it asks', () => {
  const app = read('public/app.js');
  const hook = app.slice(app.indexOf('dogRuns: (name) => {'), app.indexOf('shareBase:'));
  assert.match(hook, /d\.handlerId === hid \|\| \(d\.teams \|\| \[\]\)\.some\(t => t\.handlerId === hid\)/);
  assert.match(hook, /return \(mine\.length \? mine : named\)\.map/);
  const sq = read('public/squad-ui.js');
  const share = sq.slice(sq.indexOf('async function doShareRecord'), sq.indexOf('async function doStopRecord'));
  assert.match(share, /if \(dogs\.length > 1\) \{\n    const pick = await form\(\{/);
  assert.doesNotMatch(share, /\bconfirm\(/);
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
  at("allow delete: if signedIn() && creator() == request.auth.uid\n                        && (!exists(incidentPath()) || get(incidentPath()).data.status == 'ended');");
  at("&& request.resource.data.startedAt == resource.data.startedAt\n");
  at("request.resource.data.code == get(squadPath()).data.code");
  at("getAfter(squadPath()).data.createdBy == request.auth.uid");
  at("&& expires(d, 12);");
  at("get(incidentPath()).data.k9Uid == request.auth.uid");
  at("trackId == request.auth.uid + '_' + string(d.n)");
  at("&& resource.data.status == 'active'");
  at("&& request.resource.data.status == 'active'\n");
  at("trackOk(request.resource.data) && exists(incidentPath())");
  at("'indication', 'lost', 'refound', 'article', 'sighting', 'roadblock', 'rally', 'perimeter'");
  // Move B: last seen, how they left and the brief on the incident; a mark withdrawn, not deleted.
  at("'expiresAt', 'deleteAt', 'summary', 'lastSeenAt', 'pace', 'brief', 'coverUid', 'k9Record'])");
  // Move D: the dog's record card, bounded, on the member and frozen into the incident.
  at("&& request.resource.data.get('k9Record', null) == resource.data.get('k9Record', null);");
  at("d.keys().hasOnly(['uid', 'role', 'callSign', 'name', 'dog', 'joinedAt', 'code', 'record'])");
  at("&& recordOk(d.get('record', null));");
  at("&& recordOk(d.get('k9Record', null))");
  at("function tally(v) { return v is int && v >= 0 && v <= 100000; }");
  at("&& r.blindFound <= r.blindReal && r.blindReal <= r.blind && r.sureRight <= r.sure");
  at("&& r.blind <= r.trails && r.sure <= r.trails");
  at("&& r.h1 + r.h4 + r.older + r.noAge == r.trails");
  at("|| request.resource.data.k9Record == get(/databases/$(database)/documents/squads/$(squadId)/members/$(request.resource.data.k9Uid)).data.get('record', null));");
  at("&& optNum(r.get('last', null)) && optText(r.get('gaps', null), 620)");
  at("&& optText(r.get('lic', null), 60) && optNum(r.get('licTo', null)));");
  // Move C: the cover officer, a member's account and never the handler's own.
  at("&& optText(d.get('coverUid', null), 128)");
  at("&& (d.get('coverUid', null) == null || d.coverUid != d.get('k9Uid', null))");
  at("(num(d.lastSeenAt) && d.lastSeenAt <= d.startedAt && d.lastSeenAt >= d.startedAt - 172800000)");
  at("(d.get('pace', null) == null || d.pace in ['walk', 'run', 'vehicle'])");
  at("b.keys().hasOnly(['dir', 'desc', 'article'])");
  at("optText(b.get('dir', null), 40) && optText(b.get('desc', null), 160)");
  at("request.resource.data.diff(resource.data).affectedKeys().hasOnly(['withdrawnBy', 'withdrawnAt'])");
  at("&& resource.data.get('withdrawnBy', null) == null\n                && request.resource.data.withdrawnBy == request.auth.uid\n                && recent(request.resource.data.withdrawnAt);");
  at("|| (isMember() && (resource.data.by == request.auth.uid || isCommand()) && withdrawOk()");
  assert.doesNotMatch(rules.slice(at('match /marks/{markId}'), at('match /tracks/{trackId}')), /'withdrawnBy'[^\n]*\]\)\n\s*&& d\.kind/,
    'markOk itself never takes the withdrawn fields: a new mark cannot be born withdrawn');
  assert.ok(rules.lastIndexOf('match /{document=**} { allow read, write: if false; }') > at('match /squads/{squadId}'),
    'everything else is still refused, after the squads');
  // The copy refuses what the rules refuse, for the paths it does not know.
  assert.equal(allow('get', 'elsewhere/x', { uid: 'a', before: new Map(), after: new Map() }), false);
});

t('review fixes: nothing said that Command did not say, the wall reads from across the room, pins and tags stay readable', () => {
  const ui = read('public/incident-ui.js'), css = read('public/app.css');
  // "Last seen & brief" fills in only what was said, and refuses a time after the opening.
  const ed = ui.slice(ui.indexOf('async function editSeen('), ui.indexOf('async function editPaces('));
  assert.match(ed, /value: finite\(inc\.lastSeenAt\) \? hhmm\(inc\.lastSeenAt\) : ''/);
  assert.match(ed, /value: inc\.pace \|\| '',\n\s+choices: \[\{ value: '', text: 'Not known' \}, \.\.\.PACE_KEYS/);
  assert.match(ed, /pace: got\.pace \|\| null/);
  assert.match(ed, /if \(t != null && t > inc\.startedAt\) return ctx\.toast\('Last seen can’t be after the incident opened'\)/);
  assert.doesNotMatch(ed, /seenAt\(inc\)|\|\| 'walk'/);
  // The start form does not say "walking" unless Command does.
  assert.match(ui, /seen: '', pace: null, dir: '', desc: '', article: null \};/);
  assert.match(ui, /\['', 'Not known'\]\]\.map\(\(\[k, t\]\) => html`<button type="button" class="chip" data-inc-pace="\$\{k\}"/);
  // The description is personal data every member reads: said where it is typed.
  assert.equal((ui.match(/DESC_HINT/g) || []).length, 3, 'defined, on the form, in the sheet');
  assert.match(ui, /const DESC_HINT = 'Every squad member sees this\. Keep it short\.';/);
  assert.match(read('public/sheet.js'), /if \(f\.hint\) lab\.append\(el\('span', 'app-sheet-hint', f\.hint\)\);/, 'by textContent');
  // Wall mode: the card keeps to its head, the units get the height, the toast clears the demo label.
  assert.match(css, /\.cmd-wall \.inc-live \.inc-log, \.cmd-wall \.inc-live \.inc-brief, \.cmd-wall \.inc-live \.inc-reach,/);
  assert.match(css, /\.cmd-wall \.cmd-list \{ flex: 1; min-height: 40vh; \}/);
  assert.match(css, /body\.wall-on \.toast \{ top: auto; bottom: 24px; left: auto; right: 474px;/);
  assert.match(read('public/squad-ui.js'), /document\.body\.classList\.toggle\('wall-on', S\.wall\);/);
  // Pins: sized as drawn, the latest call on top.
  const pins = ui.slice(ui.indexOf('function paintPins('), ui.indexOf('/* A tap on a pin.'));
  assert.match(pins, /w = Math\.max\(w, pe\.offsetWidth \+ 4\);/);
  assert.match(pins, /p\.marker\.setOffset\(\[k \* w, 0\]\)/);
  assert.match(pins, /const z = String\(1 \+ n\);/);
  // The ring's tag goes on an edge it can be read whole on, or not at all.
  const tag = ui.slice(ui.indexOf('const TAG_SPOTS'), ui.indexOf('function pinEl('));
  for (const k of ["i: 54, anchor: 'left'", "i: 18, anchor: 'right'", "i: 36, anchor: 'bottom'", "i: 0, anchor: 'top'"]) assert.ok(tag.includes(k), k);
  assert.match(tag, /tag\.el\.hidden = !spot;/);
  // Phone: Follow K9 sits under the weather panel.
  assert.match(css, /@media \(max-width: 899px\) \{ \.cmd-follow \{ top: calc\(var\(--top-row, 14px\) \+ max\(56px, var\(--wx-gap, 0px\) \+ 8px\)\); \} \}/);
  // The strip goes amber with the line.
  assert.match(css, /\.cmd-panel\.folded\.inc-on \.inc-strip\.warn \{/);
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
