/* The handler's squad picture (move F): what the K9 team's phone shows on
   its run screen during an incident, and pretend mode's Handler's view.
   The words and the sums are pure (incident.js); the screens are checked
   from their source. Above all: a training run with no incident looks and
   behaves exactly as before, and "How sure are you?" is left out only
   during an incident. */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSim, callSignsOf } from '../public/squad.js';
import { createSimIncident, standingOf, handlerPicture, handlerLine, sayWords, freshSays, sideWords, nearestOn,
         callsReady, runSquadOn, cleanHear, spokenDist, HEAR_KINDS, HANDLER_KINDS, HANDLER_NOTE, HANDLER_SHORT,
         CALL_KEYS, CALL_UNDO_MS, CALL_HOLD_MS, RUN_MARKS, ring, runShareStep, heldCalls, handlerFrame, frameCamera,
         darkAt } from '../public/incident.js';
import { liveWpsSig } from '../public/sync.js';
import { asksHowSure } from '../public/call.js';
import { initHandler, paintHandler, clearHandler, handlerOn } from '../public/handler-ui.js';
import { project } from '../public/geo.js';

let pass = 0;
/* Just enough of a page for handler-ui.js to build its box and lift the
   map's corner buttons, without a browser. */
function fakePage() {
  const cls = () => { const set = new Set(); return { add: (c) => set.add(c), remove: (c) => set.delete(c), contains: (c) => set.has(c),
    toggle: (c, on) => { if (on ?? !set.has(c)) set.add(c); else set.delete(c); } }; };
  const el = (tag) => {
    const e = { tag, children: [], hidden: false, dataset: {}, className: '', classList: cls(), _text: '',
      append(...k) { this.children.push(...k); }, addEventListener() {}, setAttribute() {},
      getBoundingClientRect: () => ({ top: 500, height: 300 }), closest: () => null };
    Object.defineProperty(e, 'textContent', { get() { return this._text; }, set(v) { this._text = String(v); if (v === '') this.children = []; } });
    return e;
  };
  const root = { classList: cls(), style: { setProperty() {} } };
  globalThis.document = { createElement: el, documentElement: root };
  globalThis.window = { innerHeight: 844 };
  return { el, root };
}
const t = (name, fn) => { fn(); pass++; console.log(`  ok  ${name}`); };
const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const OVERCLAIM = /\b(secure|evidence-grade|sealed|CJIS|prediction|predicts?|proof|proves?|certified)\b/i;

const app = read('public/app.js');
const ui = read('public/incident-ui.js');
const hv = read('public/handler-ui.js');
const inc = read('public/incident.js');
const handlerAt = inc.indexOf("/* ── The handler's squad picture");
assert.ok(handlerAt > 0, 'the handler part of incident.js is found');
const handlerPart = inc.slice(handlerAt);
const html = read('public/index.html');
const css = read('public/app.css');

/* ── A training run with no incident: exactly as before ──────────────── */
t('"How sure are you?": the same three conditions as before on a training run, never during an incident', () => {
  for (const firstInd of [true, false]) for (const revealed of [true, false]) for (const coach of [true, false]) {
    const before = firstInd && !revealed && !coach;   // the run screen's rule until now
    assert.equal(asksHowSure({ firstInd, revealed, coach }), before, `no incident: ${firstInd}/${revealed}/${coach}`);
    assert.equal(asksHowSure({ firstInd, revealed, coach, incident: false }), before);
    assert.equal(asksHowSure({ firstInd, revealed, coach, incident: true }), false, 'skipped during an incident');
  }
  assert.match(app, /if \(asksHowSure\(\{ firstInd: isFirstInd, revealed: !!run\.revealedAt, coach: coach\.on, incident: incidentRunOn\(\) \}\)\) openCall\(wp\);/);
  /* incidentRunOn is false unless an incident is in force and this phone's run is its trail. */
  assert.match(ui, /export const incidentRunOn = \(\) => !!ctx && !!I\.active && sharingRun\(\) && !!runGoing\(\);/);
});

t('the squad layer is drawn only on the run screen of an incident run: never on a training run', () => {
  const run = { on: true, kind: 'run', pts: [], wps: [] };
  const live = { id: 'i1', status: 'active' };
  assert.equal(runSquadOn({ screen: 'scrRun', inc: null, sharing: false, running: run }), false, 'no incident');
  assert.equal(runSquadOn({ screen: 'scrRun', inc: { ...live, status: 'ended' }, sharing: true, running: run }), false, 'an ended one');
  assert.equal(runSquadOn({ screen: 'scrRun', inc: live, sharing: false, running: run }), false, 'not this phone’s trail (no Start trailing)');
  assert.equal(runSquadOn({ screen: 'scrRun', inc: live, sharing: true, running: null }), false, 'no run going');
  assert.equal(runSquadOn({ screen: 'scrResult', inc: live, sharing: true, running: run }), false, 'another screen');
  assert.equal(runSquadOn({ screen: 'scrRun', inc: live, sharing: true, running: run }), true);
  assert.match(ui, /function paintRun\(\) \{[\s\S]{0,200}if \(!runSquadOn\(\{ screen: ctx\.screen\(\), inc: a, sharing: sharingRun\(\), running: r \}\)\) \{\s*if \(handlerOn\(\) === 'run'\) clearHandler\(\);\s*return;/);
});

t('a training run’s screen is untouched: the box starts hidden, the run screen code is as it was', () => {
  assert.match(html, /<div class="hv-box" id="runSquadBox" hidden><\/div>/, 'hidden until an incident run paints it');
  assert.match(html, /<div class="hv-pretend" id="cmdHandler" hidden>/);
  /* The run screen's own buttons are set exactly as before. */
  assert.match(app, /\$\('wpRow'\)\.hidden = onTrail;/);
  assert.match(app, /\$\('btnRunStop'\)\.textContent = onTrail \? 'Found' : 'Stop';/);
  assert.match(app, /\$\('btnShowTrail'\)\.hidden = !onTrail \|\| blindTrail;/);
  /* app.js never draws the squad box itself, and its only new hooks are the call pair. */
  assert.ok(!/runSquadBox|handler-ui|paintHandler\(/.test(app), 'app.js never paints the squad box');
  assert.match(app, /addCall: \(kind\) => \(rec\.on && rec\.kind === 'run' \? addWaypoint\(kind\) : null\),/);
  assert.match(app, /undoCall: \(wp\) => dropWaypoint\(wp\),/);
  /* A training run's marks still go through the same addWaypoint, toasted and stamped as before. */
  assert.match(app, /function addWaypoint\(kind\) \{[\s\S]{0,1400}rec\.wps\.push\(wp\);\s*setSrc\('wps', pointsOf\(rec\.wps, 'kind'\)\);\s*navigator\.vibrate\?\.\(35\);/);
});

t('with no picture up, clearing touches nothing: not the map, not the page', () => {
  const touched = [];
  initHandler({ kv: { get: () => null }, getMap: () => { touched.push('map'); return {}; }, toast: () => touched.push('toast') });
  clearHandler();
  paintHandler(null);
  assert.equal(handlerOn(), null);
  assert.deepEqual(touched, [], 'a training run never reaches the map through this module');
  assert.match(hv, /export function clearHandler\(\) \{\s*if \(!H\.where && !H\.box && !H\.markers\.size\) return;/);
});

/* ── Calls, with a few seconds to undo ───────────────────────────────── */
t('a call waits out its Undo time before the squad is sent it; a run that ends sends the rest', () => {
  const now = 1_000_000;
  const wps = [{ kind: 'Lost it', t: now - 20e3 }, { kind: 'Re-found', t: now - CALL_HOLD_MS - 1 }, { kind: 'Indication', t: now - 2000 }];
  assert.equal(callsReady(wps, 0, now), 2, 'the last is still inside its hold');
  assert.equal(callsReady(wps, 2, now), 2);
  assert.equal(callsReady(wps, 2, now + CALL_HOLD_MS), 3);
  assert.equal(callsReady(wps, 0, now, true), 3, 'Indication then Found: nothing is lost');
  assert.equal(callsReady([], 0, now), 0);
  assert.equal(callsReady(wps, 9, now), 3, 'never past the end');
  assert.ok(CALL_HOLD_MS > CALL_UNDO_MS, 'Undo never races the send');
  assert.deepEqual(CALL_KEYS.map(k => RUN_MARKS[k]), ['lost', 'refound', 'indication', 'article']);
  /* The same rules, as the phone runs them each second (runShareStep). */
  const rec = { startedAt: now - 60e3, pts: [{ lat: 1, lon: 1, t: now - 30e3 }], wps };
  let st = runShareStep(null, { rec, sharing: true, onDuty: true, startedAt: now - 90e3, now });
  assert.deepEqual(st.calls.map(w => w.kind), ['Lost it', 'Re-found'], 'the newest waits out its hold');
  assert.equal(st.pts.length, 1);
  st = runShareStep(st.run, { rec: null, sharing: true, onDuty: true, startedAt: now - 90e3, now: now + 100 });
  assert.deepEqual(st.calls.map(w => w.kind), ['Indication'], 'the run ended: Indication then Found loses nothing');
  assert.equal(st.run.list, null);
  assert.deepEqual(runShareStep(st.run, { rec: null, sharing: true, onDuty: true, startedAt: 0, now }).calls, [], 'sent once');
  /* Undo only takes back a call not yet sent, inside its time. */
  assert.match(ui, /if \(i < 0 \|\| i < I\.run\.wps \|\| Date\.now\(\) - wp\.t >= CALL_UNDO_MS\) return false;/);
});

/* ── Which side, how far ─────────────────────────────────────────────── */
const o = { lat: 51.2094, lon: -2.6476 };
t('sides from the way the handler is going, and a compass word before there is one', () => {
  assert.equal(sideWords(o, 90, project(o, 90, 100)), 'ahead');
  assert.equal(sideWords(o, 90, project(o, 45, 100)), 'ahead-left');
  assert.equal(sideWords(o, 90, project(o, 140, 100)), 'ahead-right');
  assert.equal(sideWords(o, 90, project(o, 0, 100)), 'left');
  assert.equal(sideWords(o, 90, project(o, 180, 100)), 'right');
  assert.equal(sideWords(o, 90, project(o, 320, 100)), 'behind-left');
  assert.equal(sideWords(o, 90, project(o, 270, 100)), 'behind');
  assert.equal(sideWords(o, null, project(o, 45, 100)), 'to the NE');
  assert.equal(sideWords(null, 0, o), '');
  const n = nearestOn(project(o, 0, 50), [project(o, 270, 100), project(o, 90, 100)]);
  assert.ok(Math.abs(n.m - 50) < 1, 'the nearest place on a line is across it, not at an end');
});

/* ── The picture, from a pretend incident ────────────────────────────── */
const center = { lat: 51.2094, lon: -2.6476 };
const t0 = 1_800_000_000_000;
const sim = createSim({ center, now: t0, seed: 11 });
const lkp = project(sim.unit('sim-1'), 30, 120);
const si = createSimIncident({ sim, lkp, k9Uid: 'sim-1', now: t0, seed: 5, lastSeenAt: t0 - 4 * 60e3, pace: 'walk' });
let clock = t0;
while (clock < t0 + 40 * 60e3 && !standingOf(si.marks).some(m => m.kind === 'sighting')) { clock += 4000; sim.step(clock); si.step(clock); }
const names = callSignsOf(sim.members());
const who = (uid) => names.get(uid)?.callSign || 'A member';

t('the handler sees the squad’s perimeter, sightings, roadblocks and rally points, never the team’s own calls', () => {
  const k9 = sim.unit('sim-1');
  si.setCover('sim-3');
  const cover = sim.unit('sim-3');
  const marks = standingOf(si.marks, clock);
  const pic = handlerPicture({ inc: si.inc, marks, me: k9, heading: 90, cover: { ...cover, at: clock }, coverName: who('sim-3'), now: clock });
  assert.ok(pic.items.length, 'there are squad points by now');
  assert.ok(pic.items.every(i => HANDLER_KINDS.includes(i.kind)), 'no K9 calls, no ring, no band');
  assert.ok(pic.items.some(i => i.kind === 'sighting'), 'the sighting is there');
  assert.ok(pic.items.every(i => i.m != null && typeof i.side === 'string' && i.side), 'each with a distance and a side');
  assert.equal(pic.cover.name, who('sim-3'));
  assert.ok(pic.cover.m >= 0);
  const line = handlerLine(pic, { now: clock });
  assert.match(line, /^Sighting \d+ m (ahead|behind|left|right)[a-z-]* · cover .+ about \d+ m /, line);
  /* A withdrawn point leaves the handler’s map as it leaves Command’s. */
  const sight = pic.items.find(i => i.kind === 'sighting');
  si.removeMark(sight.id, 'you', clock + 1);
  const after = handlerPicture({ inc: si.inc, marks: standingOf(si.marks, clock + 2), me: k9, heading: 90, now: clock + 2 });
  assert.ok(!after.items.some(i => i.id === sight.id));
  assert.deepEqual(handlerPicture({ inc: { ...si.inc, status: 'ended' }, marks, me: k9, now: clock }).items, [], 'ended: nothing');
  assert.deepEqual(handlerPicture({ inc: null, marks, me: k9, now: clock }), { items: [], cover: null });
  assert.deepEqual(pic.lkp, { lat: si.inc.lkp.lat, lon: si.inc.lkp.lon }, 'the last known point is on the handler’s map too');
});

const inc0 = { id: 'i', status: 'active', coverUid: 'c1', lkp: o };
t('the one line, as the spec writes it: "Sighting 180 m ahead-left · cover 2A12 about 40 m behind"', () => {
  const now = 5e6;
  const marks = [{ id: 'm1', kind: 'sighting', by: 'f5', at: now - 20e3, lat: project(o, 45, 180).lat, lon: project(o, 45, 180).lon }];
  const cover = { ...project(o, 270, 40), at: now - 5000 };
  const pic = handlerPicture({ inc: inc0, marks, me: o, heading: 90, cover, coverName: '2A12', now });
  assert.equal(handlerLine(pic, { now }), 'Sighting 180 m ahead-left · cover 2A12 about 40 m behind');
  assert.equal(handlerLine(pic, { now, imperial: true }), 'Sighting 197 yd ahead-left · cover 2A12 about 44 yd behind');
  assert.equal(handlerLine(pic, { now: now + 6 * 60e3 }), 'Sighting 180 m ahead-left, 6 min ago · cover 2A12 about 40 m behind, 6 min ago',
    'old points and old positions say how old');
  const none = handlerPicture({ inc: { ...inc0, coverUid: null }, marks: [], me: o, heading: 90, now });
  assert.equal(handlerLine(none, { now }), 'No squad points on the map yet');
  const noPos = handlerPicture({ inc: inc0, marks: [], me: o, heading: 90, cover: null, coverName: '2A12', now });
  assert.equal(handlerLine(noPos, { now }), 'Cover 2A12, no position yet');
  /* With no sighting, the perimeter: inside it, or how far. */
  const loop = ring(o, 300, 12);
  const pin = handlerPicture({ inc: { ...inc0, coverUid: null }, marks: [{ id: 'p', kind: 'perimeter', by: 's', at: now, pts: loop }], me: o, heading: 0, now });
  assert.equal(handlerLine(pin, { now }), 'Inside the perimeter');
  const away = handlerPicture({ inc: { ...inc0, coverUid: null }, marks: [{ id: 'p', kind: 'perimeter', by: 's', at: now, pts: [project(o, 0, 120), project(project(o, 0, 120), 90, 200)] }], me: o, heading: 0, now });
  assert.match(handlerLine(away, { now }), /^Perimeter 1[12]0 m ahead(-right)?$/);
});

t('spoken lines in the coach’s voice: "Sighting, Foot 5, 200 metres ahead, left"', () => {
  const item = { kind: 'sighting', m: 203, side: 'ahead-left' };
  assert.equal(sayWords(item, 'Foot 5'), 'Sighting, Foot 5, 200 metres ahead, left');
  assert.equal(sayWords({ kind: 'roadblock', m: 1240, side: 'right' }, 'Car 2'), 'Roadblock, Car 2, 1.2 kilometres right');
  assert.equal(sayWords({ kind: 'rally', m: 64, side: 'to the NE' }), 'Rally point, 60 metres to the north east');
  assert.equal(sayWords({ kind: 'perimeter', inside: true, m: 80, side: 'left' }, 'Sgt 1'), 'Perimeter up, Sgt 1. You are inside it');
  assert.equal(sayWords({ kind: 'perimeter', inside: false, m: 150, side: 'ahead' }, 'Sgt 1'), 'Perimeter up, Sgt 1, nearest 150 metres ahead');
  assert.equal(sayWords({ kind: 'cover', name: '2A12' }), 'Cover officer, 2A12');
  assert.equal(sayWords({ kind: 'sighting', m: null, side: '' }, 'Foot 5'), 'Sighting, Foot 5', 'no fix yet: no distance');
  assert.equal(spokenDist(200, true), '220 yards');
});

t('each kind can be switched off; nothing already on the map is read out; the handler’s own points are not said back', () => {
  assert.deepEqual(cleanHear(null), Object.fromEntries(HEAR_KINDS.map(k => [k, true])));
  assert.deepEqual(cleanHear({ roadblock: false, rally: 'no', junk: false }),
    { sighting: true, roadblock: false, rally: true, perimeter: true, cover: true });
  const now = 5e6;
  const pt = (id, kind, by) => ({ id, kind, by, at: now, lat: project(o, 0, 100).lat, lon: project(o, 0, 100).lon });
  const pic1 = handlerPicture({ inc: inc0, marks: [pt('a', 'sighting', 'f5')], me: o, heading: 0, cover: { ...o, at: now }, coverName: '2A12', now });
  const first = freshSays({ pic: pic1, said: null, hear: cleanHear(null), me: 'k9' });
  assert.deepEqual(first.say, [], 'the run screen opening does not read the whole map');
  const pic2 = handlerPicture({ inc: inc0, marks: [pt('a', 'sighting', 'f5'), pt('b', 'roadblock', 'car'), pt('c', 'sighting', 'k9'), pt('d', 'sighting', 'f3')],
    me: o, heading: 0, cover: { ...o, at: now }, coverName: '2A12', now });
  const next = freshSays({ pic: pic2, said: first.said, hear: cleanHear({ roadblock: false }), me: 'k9' });
  assert.deepEqual(next.say.map(i => i.id), ['d'], 'roadblocks off, own point not said, old one not again');
  assert.ok(next.said.has('b') && next.said.has('c'), 'and not said later when switched back on');
});

t('a stretch off duty mid-run is skipped, not queued: back on duty only what comes after goes', () => {
  const t0 = 2_000_000;
  const rec = { startedAt: t0, pts: [], wps: [] };
  const fix = (s) => rec.pts.push({ lat: 51 + s * 1e-5, lon: -2.6, t: t0 + s * 1000 });
  const sent = { pts: [], calls: [] };
  let run = null;
  const tick = (s, { sharing, onDuty }) => {
    const st = runShareStep(run, { rec, sharing, onDuty, startedAt: t0, now: t0 + s * 1000 });
    run = st.run; sent.pts.push(...st.pts); sent.calls.push(...st.calls);
  };
  for (let s = 1; s <= 5; s++) { fix(s); tick(s, { sharing: true, onDuty: true }); }
  rec.wps.push({ kind: 'Indication', lat: 51, lon: -2.6, t: t0 + 5000 });
  /* Off duty: the run goes on, and so do the calls, on the phone only. */
  for (let s = 6; s <= 20; s++) { fix(s); tick(s, { sharing: false, onDuty: false }); }
  rec.wps.push({ kind: 'Lost it', lat: 51, lon: -2.6, t: t0 + 15000 });
  tick(21, { sharing: false, onDuty: false });
  /* Back on duty. */
  for (let s = 22; s <= 24; s++) { fix(s); tick(s, { sharing: true, onDuty: true }); }
  rec.wps.push({ kind: 'Re-found', lat: 51, lon: -2.6, t: t0 + 24000 });
  tick(24 + CALL_HOLD_MS / 1000 + 1, { sharing: true, onDuty: true });
  assert.deepEqual(sent.pts.map(p => (p.t - t0) / 1000), [1, 2, 3, 4, 5, 22, 23, 24], 'nothing from the off-duty stretch');
  assert.deepEqual(sent.calls.map(w => w.kind), ['Re-found'], 'the calls made off duty stay on the phone; the one held as the switch went off too');
  /* Not yet said yes with Start trailing, but on duty: the run is not
     skipped, so a yes a moment later still counts it from the incident's start. */
  const r2 = { startedAt: t0, pts: [{ lat: 1, lon: 1, t: t0 + 1000 }], wps: [] };
  let st = runShareStep(null, { rec: r2, sharing: false, onDuty: true, startedAt: t0, now: t0 + 2000 });
  st = runShareStep(st.run, { rec: r2, sharing: true, onDuty: true, startedAt: t0, now: t0 + 3000 });
  assert.equal(st.pts.length, 1);
  assert.match(ui, /function everySecond\(\) \{[\s\S]{0,900}runShareStep\(/);
});

t('an incident that ends during a run takes the squad box down and says what stayed on the phone', () => {
  /* Calls still in their hold cannot go to a closed incident: they are counted, not sent. */
  const t0 = 3_000_000;
  const list = [{ kind: 'Lost it', t: t0 + 1000 }, { kind: 'Reward', t: t0 + 2000 }, { kind: 'Indication', t: t0 + 3000 }];
  assert.equal(heldCalls({ wps: 1, list }, t0), 1, 'Reward is the dog’s, not the squad’s');
  assert.equal(heldCalls({ wps: 3, list }, t0), 0);
  assert.equal(heldCalls({ wps: 0, list: null }, t0), 0);
  assert.equal(heldCalls(undefined, t0), 0);
  /* The wiring: the end of an incident, or leaving the squad, repaints the
     run screen at once (the tick that kept the box fresh has stopped). */
  const fn = (name) => ui.slice(ui.indexOf(`function ${name}(`), ui.indexOf('\n}\n', ui.indexOf(`function ${name}(`)));
  assert.match(fn('setActive'), /if \(!leftHeld\(was, said\) && said\)[\s\S]*stopContributing\(\);[\s\S]*I\.active = a;[\s\S]*paintRun\(\);\s*if \(!a\) return;/);
  assert.match(fn('follow'), /if \(I\.active\) leftHeld\(I\.active, 'You left the squad\.'\);[\s\S]*stopContributing\(\);[\s\S]*paintRun\(\);/);
  assert.match(fn('leftHeld'), /stayed on this phone, not sent to the squad/);
  assert.doesNotMatch(fn('leftHeld'), /cloudMark|putMark/, 'never tried against a closed incident');
  /* And the box itself: painted on the run screen, then cleared as paintRun
     does once runSquadOn is false — hidden, its markers off the map, the
     corner buttons and the camera given back. */
  const page = fakePage();
  const pads = [];
  const markers = [];
  initHandler({ kv: { get: () => null, set() {} }, imperial: () => false, toast() {}, runPadding: (px) => pads.push(px),
    getMap: () => ({ map: { isStyleLoaded: () => false }, GL: { Marker: class { constructor() { markers.push(this); this.on = true; }
      setLngLat() { return this; } addTo() { return this; } remove() { this.on = false; } } } }) });
  const box = page.el('div');
  const lkp = { lat: 51.2094, lon: -2.6476 };
  const inc = { id: 'i9', status: 'active', lkp, k9Uid: 'k9', coverUid: null };
  const marks = [{ id: 'm1', kind: 'sighting', by: 'f5', at: 1, lat: 51.211, lon: -2.6476 }];
  paintHandler({ where: 'run', box, inc, marks, me: lkp, heading: 0, now: 10, myUid: 'k9', voice: false, night: true,
    call: () => null, undo: () => false });
  assert.equal(handlerOn(), 'run');
  assert.equal(box.hidden, false);
  assert.ok(box.classList.contains('hv-night'), 'night from the caller’s signal');
  assert.ok(page.root.classList.contains('hv-lift'), 'the corner buttons move up above the box');
  assert.equal(pads.length, 1);
  assert.ok(pads[0] > 0, 'the run camera keeps the handler above the box');
  assert.ok(markers.some(m => m.on));
  clearHandler();
  assert.equal(handlerOn(), null);
  assert.equal(box.hidden, true, 'no frozen box left on the run screen');
  assert.equal(box.textContent, '');
  assert.ok(markers.every(m => !m.on), 'no stale markers on the map');
  assert.ok(!page.root.classList.contains('hv-lift'));
  assert.deepEqual(pads, [pads[0], 0], 'the camera’s padding given back');
  delete globalThis.document; delete globalThis.window;
});

t('Handler’s view frames the dog with the squad’s picture round it, close in when it can', () => {
  const me = { lat: 51.2094, lon: -2.6476 };
  const at = (m, deg) => project(me, deg, m);
  const pic = { cover: { pos: at(40, 180) }, lkp: me,
    items: [{ kind: 'sighting', pos: at(180, 320) }, { kind: 'rally', pos: at(250, 90) }, { kind: 'roadblock', pos: at(300, 10) },
            { kind: 'roadblock', pos: at(2000, 200) }, { kind: 'perimeter', pts: [at(400, 0), at(400, 90)], near: at(290, 45) }] };
  const f = handlerFrame(pic, me, { maxM: 600 });
  assert.deepEqual(f[0], me, 'the dog first');
  assert.equal(f.length, 1 + 1 + 3 + 1, 'the cover, the three nearest points, the nearest stretch of the line');
  assert.ok(!f.some(p => Math.abs(p.lat - at(2000, 200).lat) < 1e-9), 'a point 2 km off is left to the words');
  assert.deepEqual(handlerFrame(pic, me, { maxM: 10 }), [me], 'nothing in reach: the dog alone');
  assert.deepEqual(handlerFrame(pic, null), []);
  const cam = frameCamera(f, 340, 380, { min: 15, max: 17 });
  assert.ok(cam.zoom >= 15 && cam.zoom <= 17, `zoom ${cam.zoom}`);
  assert.ok(frameCamera([me, at(5, 0)], 340, 380, { min: 15, max: 17 }).zoom === 17, 'never closer than street level');
  assert.ok(frameCamera([me, at(9000, 0)], 340, 380, { min: 15, max: 17 }).zoom === 15, 'never further out than about a kilometre');
  /* The camera holds every point: each within the picture at that zoom. */
  const mpp = 156543.03 * Math.cos(me.lat * Math.PI / 180) / Math.pow(2, cam.zoom) / 2;   // 512 px tiles
  for (const p of f) {
    const dx = (p.lon - cam.center.lon) * 111320 * Math.cos(me.lat * Math.PI / 180) / mpp;
    const dy = (p.lat - cam.center.lat) * 110540 / mpp;
    assert.ok(Math.abs(dx) <= 171 && Math.abs(dy) <= 191, `${dx.toFixed(0)},${dy.toFixed(0)} px from the middle`);
  }
  const fh = ui.slice(ui.indexOf('function followHandler('), ui.indexOf('/* ── Following the K9 team'));
  assert.match(fh, /handlerFrame\(pic, k9,/);
  assert.match(fh, /frameCamera\(frame,/);
  assert.doesNotMatch(fh.replace(/\/\*[\s\S]*?\*\//g, ''), /fitBounds/, 'no fitBounds: it would add the map’s own padding to this one');
  assert.match(ui, /const pic = paintHandler\(\{\s*where: 'pretend'/);
  assert.match(css, /html\.hv-lift \.map-fab \{ bottom: calc\(var\(--hv-gap, 0px\) \+ 12px\); \}/);
});

t('night is the sun or the squad’s Night look, never the phone’s theme', () => {
  const wells = { lat: 51.2094, lon: -2.6476 };
  assert.equal(darkAt(wells, Date.UTC(2026, 5, 21, 12, 0)), false, 'midsummer noon');
  assert.equal(darkAt(wells, Date.UTC(2026, 11, 21, 23, 0)), true, 'a winter night');
  assert.equal(darkAt(null, Date.now()), false);
  assert.match(ui, /night: darkAt\(me, Date\.now\(\)\),/, 'the run screen goes by the sun where the handler is');
  assert.match(ui, /lift: \$\('cmdHandler'\), night: !!st\.night,/, 'Handler’s view by the squad’s Night look');
  assert.match(read('public/squad-ui.js'), /night: !!\(S\.wall && S\.night\)/);
  assert.match(hv, /v\.box\.classList\.toggle\('hv-night', !!v\.night\);/);
});

t('the run camera and the voice: asked for only while the box is up; squad lines wait for the coach', () => {
  /* app.js: the padding hook eases back to none, and only the box asks. */
  assert.match(app, /runPadding: \(px\) => runPadding\(px\),/);
  assert.match(app, /function runPadding\(px\) \{[\s\S]{0,500}map\.easeTo\(\{ padding: \{ top: 0, left: 0, right: 0, bottom: Math\.min\(v, Math\.round\(h \/ 2\)\) \}/);
  assert.equal((app.match(/runPadding\(/g) || []).length, 2, 'defined once, handed to the incident screens once: no run path calls it');
  assert.match(hv, /function lift\(v\) \{[\s\S]{0,700}const pad = v\.where === 'run' \?/, 'only the run screen’s box pads the camera');
  assert.match(hv, /function unlift\(\) \{[\s\S]{0,200}if \(H\.pad\) \{ H\.pad = 0; try \{ ctx\.runPadding\?\.\(0\);/);
  /* Squad lines wait; coach cues are as they were. */
  assert.match(hv, /const say = ctx\.speakSoon \?\? ctx\.speak;/);
  assert.match(app, /speakSoon: \(text\) => speakSoon\(text\),/);
  assert.match(app, /function speakSoon\(text\) \{\s*if \(!coachTalking\(\) && !soon\.text\) return coachSpeak\(text\);/);
  assert.match(app, /if \(fresh && said\) coachSpeak\(said\);/, 'a stale line is dropped');
  assert.match(app, /function webSpeak\(text\) \{\s*if \(!\('speechSynthesis' in window\)\) return;\s*try \{\s*speechSynthesis\.cancel\(\);/, 'the coach still cuts in');
});

t('a call taken back and another made before the next live push still reach a live viewer', () => {
  const ind = { lat: 51.2, lon: -2.6, t: 1000, kind: 'Indication' };
  const art = { lat: 51.2001, lon: -2.6, t: 4000, kind: 'Article' };
  assert.notEqual(liveWpsSig([ind]), liveWpsSig([art]), 'same count, different mark: sent again');
  assert.equal(liveWpsSig([ind]), liveWpsSig([{ ...ind }]), 'nothing changed: not sent again');
  assert.equal(liveWpsSig([]), '0');
  assert.match(read('public/sync.js'), /const sig = liveWpsSig\(wps\);\s*if \(sig !== live\.wpsSig\) \{/);
});

/* ── Honest words: never a safety cue ────────────────────────────────── */
t('it never presents itself as a safety cue, and never claims more than it knows', () => {
  assert.match(HANDLER_NOTE, /often 10–30 s old, and a minute or more when a phone is standing still or locked/);
  assert.equal(HANDLER_SHORT, 'Rough guide · positions can be a minute or more old · radio first');
  assert.doesNotMatch(HANDLER_SHORT + HANDLER_NOTE, /up to 30 s/, 'no limit the app does not keep');
  assert.match(HANDLER_NOTE, /not a safety cue/);
  assert.match(HANDLER_NOTE, /radio comes first/);
  assert.match(HANDLER_SHORT, /radio first/);
  for (const [name, src] of [['handler-ui.js', hv], ['incident.js (handler part)', handlerPart]]) {
    assert.doesNotMatch(src.replace(/\/\*[\s\S]*?\*\//g, ''), OVERCLAIM, name);
    /* "safety" only ever in "not a safety cue" / "never a safety cue". */
    for (const m of src.matchAll(/safety/gi)) assert.match(src.slice(m.index - 10, m.index + 12), /(not|never) a safety cue/, name);
  }
  assert.match(hv, /HANDLER_SHORT/, 'the short caveat is on the box');
  assert.match(hv, /form\(\{ title: 'Squad voice', body: HANDLER_NOTE/, 'and the full one where the voice is set');
});

t('nothing in the handler’s picture reads the pretend hidden route', () => {
  assert.doesNotMatch(hv, /hiddenRoute|scent\.pts/);
  assert.doesNotMatch(handlerPart, /hiddenRoute|scentPath/);
  const fn = ui.slice(ui.indexOf("/* ── Handler's view (pretend mode)"), ui.indexOf('/* ── Following the K9 team'));
  assert.ok(fn.length > 200);
  assert.doesNotMatch(fn, /hiddenRoute/);
});

/* ── The screens, from their source ──────────────────────────────────── */
t('the box is built with textContent only: call signs and labels are other people’s words', () => {
  assert.doesNotMatch(hv, /innerHTML|insertAdjacentHTML|outerHTML/);
  assert.match(hv, /p\.tag\.textContent = tag/);
  for (const bad of [/\.at\(-?\d/, /findLast/, /structuredClone/, /console\.log/, /window\.__/, /TEMP PROBE/]) assert.doesNotMatch(hv, bad);
});

t('the call buttons are big, and dim red at night', () => {
  assert.match(css, /\.hv-call \{ min-height: 60px;/);
  assert.match(css, /\.hv-box\.hv-night \.hv-call \{ --hv-c: #2A0805; color: #FF8474;/);
  assert.doesNotMatch(css, /data-theme="dark"\] \.hv-call|prefers-color-scheme: dark\) \{ :root:not\(\[data-theme="light"\]\) \.hv-call/,
    'never the theme: a phone in dark mode all day keeps the four colours');
  assert.match(css, /html\[data-motion="off"\] \.hv-call:active \{ transform: none; \}/, 'the press respects Reduce Motion');
});

t('pretend mode: Handler’s view and Command view, from the same pretend incident', () => {
  assert.match(ui, /st\.sim && inc\.k9Uid \? html`<button type="button" class="btn small moss" data-inc-act="hv">Handler’s view<\/button>`/);
  assert.match(ui, /if \(act === 'hv'\) return setHv\(true\);/);
  assert.match(ui, /\$\('cmdHandlerBack'\)\.addEventListener\('click', \(\) => setHv\(false\)\);/);
  assert.match(html, /id="cmdHandlerBack">Command view<\/button>/);
  assert.match(html, /<div class="hv-pretend" id="cmdHandler" hidden>[\s\S]{0,600}data-demo-label/, 'the demo label stays on screen');
  /* Pretend calls are the pretend K9 team's, made after the Undo time. */
  assert.match(ui, /si\.addMark\(\{ kind, by: live\.k9Uid, at: tok\.at, lat: tok\.lat, lon: tok\.lon \}\);[\s\S]{0,80}\}, CALL_UNDO_MS\);/);
  /* The handler's phone never says the team's own calls back to it. */
  assert.match(ui, /if \(!I\.voice \|\| !ctx\.speak \|\| I\.hv\) return;/);
  /* Closing the map leaves Handler's view. */
  assert.match(ui, /I\.foldedFor = null;\s*setHv\(false, false\);/);
  assert.match(css, /#map\.hv-on \.sq-unit:not\(\.sq-lead\)/);
  assert.match(read('public/squad-ui.js'), /m\.el\.classList\.toggle\('sq-lead', r\.uid === S\.lead\);/);
});

t('the new module is cached for offline use and in the single-file build', () => {
  assert.match(read('public/sw.js'), /'handler-ui\.js', 'incident-ui\.js'/);
  assert.match(read('scripts/build-single.mjs'), /'squad-ui', 'handler-ui', 'incident-ui'\]/);
  assert.match(read('package.json'), /node test\/handler\.test\.mjs/);
});

/* ── The real run screen keeps every squad point where it was put ─────── */
t('on a real run, two squad points side by side both stay where they were put, and none hides under the box; only the pretend view tidies', () => {
  const runOnce = (where, alone = false) => {
    const page = fakePage();
    const markers = [];
    /* One pixel a metre-ish: the map projects longitude and latitude
       straight to pixels, and the box's top sits at y 500. */
    const project = ([lon, lat]) => ({ x: (lon + 2.6476) * 1e5 + 200, y: (51.2094 - lat) * 1e5 + 300 });
    initHandler({ kv: { get: () => null, set() {} }, imperial: () => false, toast() {}, runPadding() {},
      getMap: () => ({ map: { project, getCanvas: () => ({ getBoundingClientRect: () => ({ top: 0, left: 0 }) }),
        getSource: () => null, getLayer: () => null, addSource() {}, addLayer() {} },
        GL: { Marker: class { constructor({ element }) { this.el = element; this.off = [0, 0]; markers.push(this); }
          setLngLat() { return this; } addTo() { return this; } remove() {} setOffset(o) { this.off = o; return this; } } } }) });
    const box = page.el('div');
    const lift = { getBoundingClientRect: () => ({ top: 500 }) };
    const lkp = { lat: 51.2094, lon: -2.6476 };
    const inc = { id: 'i7', status: 'active', lkp, k9Uid: 'k9', coverUid: 'f5' };
    const marks = [
      { id: 'a', kind: 'sighting', by: 'f6', at: 1, lat: 51.2084, lon: -2.6470 },
      { id: 'b', kind: 'roadblock', by: 'c3', at: 2, lat: 51.2084, lon: -2.64699 },   // a pixel away
      { id: 'c', kind: 'sighting', by: 'f6', at: 3, lat: 51.2070, lon: -2.6476 },     // behind, under the box
    ];
    /* alone: the dog away from the point, nothing else drawn, the cover 10 m behind it. */
    const me = alone ? { lat: 51.2000, lon: -2.6476 } : lkp;
    paintHandler({ where, box, lift, inc, marks: alone ? [] : marks, me, heading: 0, now: 10, myUid: 'k9', voice: false,
      cover: alone ? { lat: 51.19991, lon: -2.6476, at: 9 } : { lat: 51.2084, lon: -2.6470, at: 9 }, coverName: 'Foot 3', call: () => null, undo: () => false });
    const out = markers.map(mk => ({ kind: [...['lkp', 'sighting', 'roadblock', 'cover']].find(k => mk.el.className.includes(`hv-k-${k}`)),
      off: mk.off, under: mk.el.classList.contains('hv-under') }));
    clearHandler();
    delete globalThis.document; delete globalThis.window;
    return out;
  };
  for (const where of ['run', 'pretend']) {
    const out = runOnce(where);
    const points = out.filter(o => o.kind === 'sighting' || o.kind === 'roadblock');
    assert.equal(points.length, 3, where);
    for (const o of points) assert.deepEqual(o.off, [0, 0], `${where}: a ${o.kind} is drawn where it was put`);
    const cover = out.find(o => o.kind === 'cover');
    assert.ok(cover && cover.off[0] > 0, `${where}: the cover steps aside from the point it stands on`);
    const hidden = out.filter(o => o.under).length;
    assert.equal(hidden, where === 'pretend' ? 1 : 0, `${where}: a point under the box is ${where === 'pretend' ? 'left off' : 'still drawn'}`);
    const alone = runOnce(where, true).find(o => o.kind === 'cover');
    assert.ok(alone && alone.off[0] > 0, `${where}: the cover 10 m behind steps aside from the dog's own dot`);
  }
});

console.log(`${pass} passed total`);
