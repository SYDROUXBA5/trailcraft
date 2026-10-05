/* Marks placed after the run. A trail's run screen has only Found and Done;
   once it ends, the run is graded and kept as always, and its replay opens
   with the laid trail and the grade kept off the map, so the handler can
   pause at each moment and mark it from memory, and set the one wind of the
   run. See the result saves what changed, grades again in a new wind, and
   shows the result. A hide search keeps its live marks.

   These check the pure parts (marks.js): where a moment of the run was, a
   mark placed there, a moment inside a GPS gap, the rule for when a call was
   made knowing the answer, and what ending the marking has to save. Then the
   app's own marking code, lifted out of app.js and run against stand-ins. */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { MARK_KINDS, GAP_MS, posAt, placeMark, addMark, removeMark, asksCall, callOwed, callMovedTo, removable, seenWhen,
  sameMarks, markingSave } from '../public/marks.js';
import { callVerdict, stampCall, CALL_V, firstCallWasFind } from '../public/call.js';
import { mergeOne, RUN_FIELDS } from '../public/sync-core.js';
import { runAgain } from '../public/store.js';
import { noLineYet, ownRun } from '../public/debrief.js';
import { patchSession } from '../public/store.js';
import { fmtDur } from '../public/geo.js';

let pass = 0;
const t = async (name, fn) => { await fn(); pass++; console.log(`  ok  ${name}`); };

const T = Date.UTC(2026, 9, 5, 9, 0);
/* A walk north, a fix every 2 s, with a 10 s stand at the fourth fix and a
   40 s hole in the GPS after the eighth. */
const track = [];
for (let i = 0; i < 12; i++) {
  const t0 = i < 8 ? T + i * 2000 : T + i * 2000 + 40000;
  track.push({ lat: 51 + i * 1e-4, lon: -2.6, t: t0, ...(i === 3 ? { dwellS: 10 } : {}) });
}

await t('the five marks, in the run screen’s order', () => {
  assert.deepEqual(MARK_KINDS, ['Indication', 'Lost it', 'Re-found', 'Article', 'Reward']);
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const pills = (id) => [...html.slice(html.indexOf(`id="${id}"`)).split('</div>')[0].matchAll(/data-wp="([^"]+)">([^<]+)</g)]
    .map(m => (assert.equal(m[1], m[2]), m[1]));
  assert.deepEqual(pills('wpRow'), MARK_KINDS, 'the search’s live marks');
  assert.deepEqual(pills('repMarks'), MARK_KINDS, 'the same names on the replay');
  assert.equal(GAP_MS, 15000, 'the run screen’s GPS warning waits the same 15 s');
});

await t('posAt: where the replay draws the dog at that moment', () => {
  assert.equal(posAt([], T), null);
  assert.equal(posAt(track, NaN), null);
  assert.deepEqual(posAt(track, T - 5000), { lat: 51, lon: -2.6, approx: false }, 'before the start: the start');
  assert.deepEqual(posAt(track, T + 2000), { lat: 51 + 1e-4, lon: -2.6, approx: false }, 'on a fix');
  assert.deepEqual(posAt(track, T + 3000), { lat: 51 + 1e-4, lon: -2.6, approx: false }, 'between fixes: the last one');
  /* Standing still folds the fixes into one point: still there, not lost. */
  assert.equal(posAt(track, T + 6000 + 9000).approx, false, 'standing at a fix is not a gap');
  const hole = posAt(track, T + 14000 + 20000);
  assert.equal(hole.approx, true, 'twenty seconds into a hole in the GPS');
  assert.equal(hole.lat, track[7].lat, 'placed where the GPS last was');
  assert.equal(posAt(track, T + 14000 + 14000).approx, false, 'inside the 15 s grace');
  assert.equal(posAt(track, track[8].t).approx, false, 'the fix after the hole is good again');
  assert.equal(posAt([{ lat: 1, lon: 2, t: 'x' }, { lat: 1, lon: 2, t: T }], T).lat, 1, 'a point without a time is passed over');
});

await t('placeMark: the shape a live mark has always had, kept inside the run', () => {
  assert.deepEqual(placeMark(track, 'Indication', T + 4000), { kind: 'Indication', lat: track[2].lat, lon: -2.6, t: T + 4000 });
  assert.deepEqual(placeMark(track, 'Article', T + 34000.4), { kind: 'Article', lat: track[7].lat, lon: -2.6, t: T + 34000, approx: true },
    'in a gap: approx, as a live mark on a stale fix');
  assert.equal(placeMark(track, 'Reward', T + 999999).t, track[11].t, 'never after the run ended');
  assert.equal(placeMark(track, 'Reward', T - 999999).t, T, 'nor before it began');
  assert.equal(placeMark(track, 'Sniff', T), null, 'only the five marks');
  assert.equal(placeMark([], 'Reward', T), null);
  assert.equal(placeMark(track, 'Reward', undefined), null);
});

await t('addMark and removeMark keep time order and the very mark the call is written onto', () => {
  const a = placeMark(track, 'Lost it', T + 8000), b = placeMark(track, 'Indication', T + 2000);
  const wps = addMark(addMark([], a), b);
  assert.deepEqual(wps.map(w => w.kind), ['Indication', 'Lost it']);
  assert.equal(wps[0], b, 'the same object');
  const before = wps.slice();
  assert.deepEqual(removeMark(wps, 0).map(w => w.kind), ['Lost it']);
  assert.deepEqual(wps, before, 'never in place');
  assert.deepEqual(addMark(undefined, a), [a]);
});

await t('the call is asked exactly when the run screen would have asked it', () => {
  const ind = { kind: 'Indication', t: T };
  assert.equal(asksCall([ind], ind, {}, false), true, 'the first indication, answer unseen');
  assert.equal(asksCall([ind], ind, {}, true), false, 'not once the trail or the grade has been seen');
  assert.equal(asksCall([ind], ind, { revealedAt: T - 1 }, false), false, 'not after Show trail during the run');
  assert.equal(asksCall([ind], ind, { coach: { assisted: true } }, false), false, 'not with the coach reading it out');
  const second = { kind: 'Indication', t: T + 5 };
  assert.equal(asksCall([ind, second], second, {}, false), false, 'only the first');
  assert.equal(asksCall([{ kind: 'Reward' }], { kind: 'Reward' }, {}, false), false, 'only an indication');
});

await t('the question follows the run’s first indication in time, not the first one placed', () => {
  const find = { kind: 'Indication', t: T + 300e3, call: { conf: 'certain' } };
  const early = { kind: 'Indication', t: T + 100e3 };
  const wps = addMark([find], early);
  assert.equal(callOwed(wps, {}, false), early, 'the earlier one, placed second, is the first commitment');
  assert.equal(asksCall(wps, early, {}, false), true, 'so placing it asks again');
  const moved = callMovedTo(wps, early);
  assert.equal(moved[0], early, 'the mark itself is kept, so the answer lands on the one saved');
  assert.equal(moved[1].call, undefined, 'the later one no longer holds a call');
  assert.equal(find.call.conf, 'certain', 'the old list is not changed under the caller');
  const later = { kind: 'Indication', t: T + 400e3 };
  assert.equal(asksCall(addMark(wps, later), later, {}, false), false, 'a later indication never asks');
  const late = { kind: 'Indication', t: T, late: true };
  assert.equal(callOwed(addMark([early], late), {}, false), early, 'a mark placed with the answer known is never the commitment');
  assert.equal(callOwed([early], {}, true), null);
});

await t('once the answer is seen, the indication a blind call is scored against stays', () => {
  const called = { kind: 'Indication', t: T, call: { conf: 'certain', seen: false } };
  const other = { kind: 'Indication', t: T + 60e3 };
  const note = { kind: 'Indication', t: T + 90e3, late: true };
  const lost = { kind: 'Lost it', t: T + 30e3 };
  const wps = [called, lost, other, note];
  assert.equal(removable(wps, 0, true), true, 'freely, while the answer is still hidden');
  assert.equal(removable(wps, 0, false), false, 'not the call itself once seen');
  assert.equal(removable(wps, 2, false), false, 'nor another blind indication the call is scored with');
  assert.equal(removable(wps, 1, false), true, 'other marks are not part of the score');
  assert.equal(removable(wps, 3, false), true, 'a note placed after looking comes off as it went on');
  assert.equal(removable([{ ...called, call: { conf: 'certain', seen: true } }, other], 1, false), true, 'a seen call is not scored at all');
  assert.equal(removable([other], 0, false), true, 'no call, nothing to protect');
  assert.equal(removable(wps, 9, false), false);
  assert.equal(placeMark(track, 'Indication', T, { late: true }).late, true);
  assert.equal('late' in placeMark(track, 'Indication', T), false, 'a blind mark keeps the old shape exactly');
  assert.equal(sameMarks([other], [{ ...other, late: true }]), false);
});

await t('marks placed after the answer was seen never change how a blind call is scored', () => {
  /* A drawn trail: its end is where a finger stopped, so a far call is only
     wrong once a later indication at the end shows the find was that one. */
  const end = { lat: 51.002, lon: -2.6 };
  const call = { v: CALL_V, conf: 'certain', seen: false, at: T + 1 };
  const run = (more) => ({
    data: { track, trackStarted: T, trail: [{ lat: 51, lon: -2.6 }, end], walkedDrawn: true, walked: true,
      trackWaypoints: [{ kind: 'Indication', lat: 51.0012, lon: -2.6, t: T + 2000, call }, ...more] },
  });
  const atEnd = { kind: 'Indication', lat: end.lat, lon: end.lon, t: T + 20000 };
  assert.equal(firstCallWasFind(run([atEnd])), false, 'marked blind at the end: the call was wrong');
  assert.equal(firstCallWasFind(run([{ ...atEnd, late: true }])), firstCallWasFind(run([])), 'placed after looking: as if never placed');
});

await t('when the answer was seen: null not yet, a time once shown, old runs as they always were', () => {
  assert.equal(seenWhen({ resultSeenAt: T }, T - 1), false, 'called before the result was shown');
  assert.equal(seenWhen({ resultSeenAt: T }, T), true);
  assert.equal(seenWhen({ resultSeenAt: null }, T), false);
  assert.equal(seenWhen({ revealedAt: T }, T + 1), true, 'Show trail during the run still counts');
  assert.equal(seenWhen({}, T), false, 'an old run’s live call is judged as it always was');
});

await t('a call placed after the result was seen is not a blind call, whatever its stamp says', () => {
  const run = (resultSeenAt, at) => ({
    data: {
      track, trackStarted: T, resultSeenAt,
      trackWaypoints: [{ kind: 'Indication', lat: track[11].lat, lon: -2.6, t: track[11].t, call: { v: CALL_V, conf: 'sure', seen: false, at } }],
      trail: [{ lat: 51.0011, lon: -2.6 }, { lat: 51.0011, lon: -2.6 }],
      debrief: { outcome: 'false', target: 'real', blind: 'handler' },
    },
  });
  assert.equal(callVerdict(run(T + 60e3, T + 59e3)).ok, true, 'marked from memory, then the result');
  assert.deepEqual(callVerdict(run(T + 60e3, T + 61e3)), { ok: false, why: 'seen' }, 'marked after looking');
  assert.equal(callVerdict(run(null, T + 61e3)).ok, true, 'still marking, nothing seen');
  assert.equal(stampCall('sure', false).seen, false);
});

await t('what See the result has to do', () => {
  const a = { kind: 'Indication', lat: 51, lon: -2.6, t: T };
  const b = { ...a, call: { conf: 'sure' } };
  assert.equal(sameMarks([a], [{ ...a }]), true);
  assert.equal(sameMarks([a, { ...a, kind: 'Reward' }], [{ ...a, kind: 'Reward' }, a]), true, 'whatever the order');
  assert.equal(sameMarks([a], [b]), false, 'a call answered is a change');
  assert.equal(sameMarks([a], [{ ...a, approx: true }]), false);
  assert.equal(sameMarks(undefined, []), true);
  const f = { v: 1, mode: 'from', from: 180, ref: 0, at: T };
  assert.deepEqual(markingSave({ before: [a], after: [a], feltBefore: null, feltAfter: null }), { marks: false, wind: false },
    'nothing changed: the result as it was graded');
  assert.deepEqual(markingSave({ before: [], after: [a], feltBefore: undefined, feltAfter: null }), { marks: true, wind: false });
  assert.deepEqual(markingSave({ before: [a], after: [a], feltBefore: null, feltAfter: f }), { marks: false, wind: true });
  assert.deepEqual(markingSave({ before: [a], after: [a], feltBefore: f, feltAfter: { ...f } }), { marks: false, wind: false });
});

/* ── The app's own code ─────────────────────────────────────────────── */

const js = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const bodyOf = (name, kw = 'function') => {
  const i = js.indexOf(`\n${kw} ${name}(`);
  assert.ok(i > 0, `app.js still has ${name}()`);
  return js.slice(i, js.indexOf('\n}\n', i) + 2);
};
const block = js.slice(js.indexOf('/* ── Marking the run'), js.indexOf('/* ── Wind tracers'));

/** The marking code with everything it calls replaced by a note of it. */
function marking({ session, screen = 'scrReplay' } = {}) {
  const els = new Map();
  const did = [], toasts = [], saved = new Map([[session.id, session]]);
  const sb = {
    $: (id) => {
      if (!els.has(id)) els.set(id, { id, hidden: false, innerHTML: '', textContent: '', disabled: false, focused: 0, parentNode: null,
        focus() { this.focused++; }, appendChild(el) { el.parentNode = this; },
        querySelector: () => null });
      return els.get(id);
    },
    replay: { s: null, from: T, to: track[11].t, at: track[11].t, back: null, mark: null },
    rec: { on: false }, run: { session }, currentScreen: screen, callWp: null, navigator: {},
    targetById: (id) => ({ kind: id === 'hide' ? 'hide' : 'person' }), ownRun, noLineYet, patchSession,
    placeMark, addMark, removeMark, callOwed, callMovedTo, removable, markingSave, fmtDur,
    keepPatch: (s, p) => sb.saveSession(s, p), foldIntoPending: () => null,
    esc: (s) => String(s ?? ''), toast: (m) => toasts.push(m), snap() {}, imp: () => false,
    sessionById: (id) => saved.get(id) ?? null,
    db: { sessions: () => [...saved.values()], updateSession: (id, p) => { saved.set(id, patchSession(saved.get(id), p)); did.push(['update', p]); } },
    guardSave: (s, f) => f(),
    saveSession: (s, p) => { const n = patchSession(s, p); saved.set(s.id, n); did.push(['save', p]); return n; },
    setWindFelt: async (s, f) => { did.push(['wind', f]); const n = patchSession(s, { data: { windFelt: f, result: { regraded: true } } }); saved.set(s.id, n); return n; },
    openReplay: (s) => { sb.replay.s = s; did.push(['openReplay', s]); sb.paintMarkTools(); },
    closeReplay: () => { did.push(['closeReplay']); if (sb.replay.mark) sb.endMarking(); sb.replay.s = null; },
    renderResult: (s) => { did.push(['renderResult', s]); sb.noteAnswerSeen(s); },
    leaveForm: (to) => did.push(['leaveForm', to]), go: (to) => did.push(['go', to]),
    paintReplay() {}, replayPause() {}, closeCall: () => did.push(['closeCall']), openCall: (wp) => did.push(['openCall', wp]),
    closeFeltSheet() {}, paintFeltSheet() {}, feltOf: (d) => d?.windFelt ?? null, feltSame: () => false,
    windFeltFor: (s, c) => ({ v: 1, mode: 'from', from: Number(c), ref: 0, at: T }), feltChoiceOf: (b) => b.dataset.feltFrom,
    windWords: () => 'Wind from S',
  };
  vm.createContext(sb);
  vm.runInContext(`${block}\nthis.answerHidden = answerHidden; this.marksEditable = marksEditable; this.marksUnkept = marksUnkept;`, sb);
  return { sb, did, toasts, saved, els };
}

const kept = (over = {}) => ({
  id: 'r1', targetId: 'person', startedAt: T - 30 * 60e3, handlerId: 'h',
  data: { trail: [{ lat: 51, lon: -2.6 }, { lat: 51.001, lon: -2.6 }], contamination: [{ points: [] }], surf: 'aa', surfFix: [],
    track, trackStarted: T, trackWaypoints: [], result: { sentence: 'Graded.' }, found: true, resultSeenAt: null, ...over },
});

await t('after Found: the replay opens with the answer kept off the map, and the run already kept', async () => {
  const { sb, did } = marking({ session: kept() });
  sb.openMarking(sb.run.session, { hidden: true });
  const shown = did.find(d => d[0] === 'openReplay')[1];
  assert.equal(shown.data.trail, null, 'no laid trail');
  assert.equal(shown.data.contamination, null, 'no contamination');
  assert.equal(shown.data.result, null, 'no grade');
  assert.equal(noLineYet(shown.data), true, 'drawn as a blind trail is: the dog, and the find');
  assert.equal(sb.run.session.data.trail.length, 2, 'only drawn: the session itself is untouched');
  assert.equal(sb.replay.mark.hidden, true);
  assert.equal(sb.$('repMarks').hidden, false, 'the marks');
  assert.equal(sb.$('repRow').hidden, true, 'not Done or the debrief yet');
  assert.equal(sb.$('repCancel').hidden, true, 'nothing to cancel: the run is kept, this only adds to it');
  assert.equal(sb.$('callSheet').parentNode, sb.$('scrReplay'), 'the call sheet lent to the replay');
  assert.equal(sb.$('feltSheet').parentNode, sb.$('scrReplay'), 'and the wind sheet');
});

await t('marks go where the dog was at that moment, the first indication asks the call, and a mark comes off again', async () => {
  const { sb, did, toasts } = marking({ session: kept() });
  sb.openMarking(sb.run.session, { hidden: true });
  sb.replay.at = T + 4000;
  sb.placeMarkNow('Indication');
  const wp = sb.replay.mark.wps[0];
  assert.deepEqual({ ...wp }, { kind: 'Indication', lat: track[2].lat, lon: -2.6, t: T + 4000 });
  assert.equal(did.find(d => d[0] === 'openCall')[1], wp, 'asked, on that very mark');
  assert.equal(sb.replay.s.data.trackWaypoints, sb.replay.mark.wps, 'drawn on the map');
  assert.match(sb.$('repMarkList').innerHTML, /data-mark="0" aria-label="Remove Indication at 0:04">Indication 0:04/);
  sb.replay.at = T + 34000;
  sb.placeMarkNow('Indication');
  assert.equal(did.filter(d => d[0] === 'openCall').length, 1, 'a second indication is not asked about');
  assert.match(toasts.at(-1), /where the GPS last was, so it may be off/);
  sb.callWp = wp;
  sb.removeMarkAt(0);
  assert.ok(did.some(d => d[0] === 'closeCall'), 'the question about a mark that went goes with it');
  assert.deepEqual(sb.replay.mark.wps.map(w => w.approx), [true]);
  assert.equal(toasts.at(-1), 'Indication removed');
});

await t('See the result: marks saved, the wind graded in, then the result, which stamps the answer seen', async () => {
  const { sb, did, saved } = marking({ session: kept() });
  sb.openMarking(sb.run.session, { hidden: true });
  sb.replay.at = T + 4000;
  sb.placeMarkNow('Reward');
  sb.pickFeltOnMark({ dataset: { feltFrom: '180' } });
  assert.equal(sb.replay.s.data.windFelt.from, 180, 'the replay reads the wind at once');
  assert.equal(saved.get('r1').data.windFelt, undefined, 'saved only at See the result');
  await sb.seeResult();
  const order = did.map(d => d[0]).filter(k => ['save', 'wind', 'closeReplay', 'renderResult', 'update', 'leaveForm'].includes(k));
  assert.deepEqual(order, ['save', 'wind', 'closeReplay', 'renderResult', 'update', 'leaveForm']);
  const now = saved.get('r1');
  assert.deepEqual(now.data.trackWaypoints.map(w => w.kind), ['Reward']);
  assert.ok(Number.isFinite(now.data.marksAt), 'with the time the marks changed');
  assert.equal(now.data.result.regraded, true, 'graded again in the wind set');
  assert.ok(Number.isFinite(now.data.resultSeenAt), 'the moment the answer was seen');
  assert.equal(did.at(-1)[1], 'scrResult');
  assert.equal(sb.replay.mark, null);
  assert.equal(sb.$('callSheet').parentNode, sb.$('scrRun'), 'the sheets go home to the run screen');
});

await t('marked out of order: an earlier indication placed second takes the question over', () => {
  const { sb, did } = marking({ session: kept() });
  sb.openMarking(sb.run.session, { hidden: true });
  sb.replay.at = track[11].t;
  sb.placeMarkNow('Indication');
  const find = sb.replay.mark.wps[0];
  find.call = { v: CALL_V, conf: 'certain', seen: false, at: T };
  sb.replay.at = T + 4000;
  sb.placeMarkNow('Indication');
  const early = sb.replay.mark.wps[0];
  assert.equal(early.t, T + 4000);
  assert.equal(did.filter(d => d[0] === 'openCall').at(-1)[1], early, 'asked about the earlier one');
  assert.equal(sb.replay.mark.wps[1].call, undefined, 'the find no longer holds the call');
  assert.equal(sb.replay.mark.wps[1].t, find.t);
  sb.replay.at = T + 6000;
  sb.placeMarkNow('Indication');
  assert.equal(did.filter(d => d[0] === 'openCall').length, 2, 'a later one is not asked about');
  /* The first taken off while still hidden: the question goes to the next. */
  early.call = { v: CALL_V, conf: 'sure', seen: false, at: T };
  sb.removeMarkAt(0);
  assert.equal(did.filter(d => d[0] === 'openCall').at(-1)[1], sb.replay.mark.wps[0]);
  assert.equal(sb.replay.mark.wps[0].t, T + 6000);
});

await t('Edit marks: the called indication stays, and what is added is a note', () => {
  const call = { v: CALL_V, conf: 'certain', seen: false, at: T };
  const seen = kept({ resultSeenAt: T + 120e3, trackWaypoints: [{ kind: 'Indication', lat: 51, lon: -2.6, t: T, call }, { kind: 'Reward', lat: 51, lon: -2.6, t: T + 2000 }] });
  const { sb, did, toasts } = marking({ session: seen });
  sb.replay.s = seen;
  sb.editMarks();
  assert.match(sb.$('repMarkList').innerHTML, /data-mark="0" aria-disabled="true"/, 'shown as kept, with no ×');
  sb.removeMarkAt(0);
  assert.equal(sb.replay.mark.wps.length, 2, 'not taken off');
  assert.match(toasts.at(-1), /marked before you saw the trail/);
  sb.removeMarkAt(1);
  assert.deepEqual(sb.replay.mark.wps.map(w => w.kind), ['Indication'], 'the reward comes off');
  sb.replay.at = T + 4000;
  sb.placeMarkNow('Indication');
  assert.equal(sb.replay.mark.wps[1].late, true, 'placed with the answer known');
  assert.equal(sb.replay.mark.wps[0].call, call, 'the call where it was');
  assert.ok(!did.some(d => d[0] === 'openCall'));
  sb.removeMarkAt(1);
  assert.equal(sb.replay.mark.wps.length, 1, 'a note comes off again');
});

await t('back during the marking after the run keeps the marks until See the result', () => {
  const { sb } = marking({ session: kept() });
  sb.openMarking(sb.run.session, { hidden: true });
  assert.equal(sb.marksUnkept(), false, 'nothing placed: back leaves, the run graded as it is');
  sb.replay.at = T + 4000;
  sb.placeMarkNow('Reward');
  assert.equal(sb.marksUnkept(), true);
  sb.removeMarkAt(0);
  sb.pickFeltOnMark({ dataset: { feltFrom: '180' } });
  assert.equal(sb.marksUnkept(), true, 'a wind set is kept the same way');
  const edit = marking({ session: kept({ resultSeenAt: T + 1 }) });
  edit.sb.replay.s = edit.saved.get('r1');
  edit.sb.editMarks();
  edit.sb.placeMarkNow('Reward');
  assert.equal(edit.sb.marksUnkept(), false, 'Edit marks has Cancel, and back is that');
  assert.match(js.slice(js.indexOf("window.addEventListener('popstate'"), js.indexOf("window.addEventListener('popstate'") + 1600),
    /if \(currentScreen === 'scrReplay' && marksUnkept\(\)\) \{\s*try \{ history\.pushState/);
});

await t('a phone too full to keep the run: marks and wind go into its waiting save, not beside it', () => {
  const fold = vm.runInContext(`(${bodyOf('foldIntoPending').trim()})`, vm.createContext({}));
  const ctx = { patchSession, saveTrouble: null, run: { session: null }, writes: [], snapped: 0 };
  ctx.saveSession = (s, p) => { ctx.writes.push(p); return patchSession(s, p); };
  ctx.guardSave = (s, f) => f();
  ctx.snap = () => { ctx.snapped++; };
  vm.createContext(ctx);
  vm.runInContext(`${bodyOf('foldIntoPending')}\n${bodyOf('keepPatch')}\nthis.fold = foldIntoPending; this.keep = keepPatch;`, ctx);
  assert.equal(typeof fold, 'function');
  const runPatch = { data: { track, result: { sentence: 'Graded.' } } };
  const whole = patchSession({ id: 'r1', data: {} }, runPatch);
  ctx.saveTrouble = { session: whole, retry: () => ctx.saveSession({ id: 'r1', data: {} }, runPatch) };
  ctx.run.session = whole;
  const now = ctx.keep(whole, { data: { trackWaypoints: [{ kind: 'Reward', t: T }] } });
  assert.equal(ctx.writes.length, 0, 'nothing written onto the copy from before the run');
  assert.equal(now.data.result.sentence, 'Graded.', 'the run, whole, with the marks on it');
  assert.equal(ctx.saveTrouble.session, now);
  assert.equal(ctx.run.session, now);
  ctx.saveTrouble.retry();
  assert.deepEqual(ctx.writes.map(p => Object.keys(p.data)), [['track', 'result'], ['trackWaypoints']], 'Try again keeps the run, then the marks');
  ctx.saveTrouble = null;
  ctx.keep(whole, { data: { marksAt: 1 } });
  assert.equal(ctx.writes.length, 3, 'with nothing waiting, saved as ever');
  assert.match(bodyOf('regradeInWind', 'async function'), /const s = waiting \?\? db\.sessions\(\)\.find/, 'the wind is graded on the run in memory');
  assert.match(bodyOf('noteAnswerSeen'), /if \(foldIntoPending\(s\.id, patch\)\) return;/);
});

await t('a removed mark and a run not seen yet survive two copies meeting', () => {
  const ind = { kind: 'Indication', lat: 51, lon: -2.6, t: T, call: { v: CALL_V, conf: 'certain', seen: false, at: T } };
  const copy = (data, updatedAt) => ({ id: 'r1', targetId: 'person', updatedAt, data: { track, trackStarted: T, result: { sentence: 'Graded.' }, ...data } });
  /* All the marks taken off on this phone, the older list still in the cloud. */
  const cleared = mergeOne(copy({ trackWaypoints: [], marksAt: T + 5e3 }, 9), copy({ trackWaypoints: [ind], marksAt: T + 1e3 }, 5), { union: true }).keep;
  assert.deepEqual(cleared.data.trackWaypoints, [], 'an emptied list is a decision');
  /* This phone pulled the run before it was marked, then saved a debrief. */
  const pulled = mergeOne(copy({ trackWaypoints: [], debrief: { outcome: 'found' } }, 9), copy({ trackWaypoints: [ind], marksAt: T + 1e3 }, 5), { union: true }).keep;
  assert.deepEqual(pulled.data.trackWaypoints, [ind], 'marks placed on the other phone still arrive');
  const later = mergeOne(copy({ trackWaypoints: [ind], marksAt: T + 1e3, debrief: { outcome: 'found' } }, 9),
    copy({ trackWaypoints: [], marksAt: T + 5e3 }, 5), { union: true }).keep;
  assert.deepEqual(later.data.trackWaypoints, [], 'the list changed last is the list, however new the rest');
  /* A second run on the trail, not seen yet, against the first run's stamp. */
  const second = mergeOne(copy({ trackStarted: T + 3600e3, resultSeenAt: null }, 9), copy({ resultSeenAt: T + 60e3 }, 5), { union: true }).keep;
  assert.equal(second.data.resultSeenAt, null, 'not filled with another run’s time');
  const same = mergeOne(copy({ resultSeenAt: null, debrief: {} }, 9), copy({ resultSeenAt: T + 60e3 }, 5), { union: true }).keep;
  assert.equal(same.data.resultSeenAt, T + 60e3, 'the same run seen on the other phone is seen');
  assert.ok(RUN_FIELDS.includes('resultSeenAt') && RUN_FIELDS.includes('marksAt'));
  const next = runAgain(copy({ resultSeenAt: T + 60e3, marksAt: T }, 5), { id: 'r2', summary: '' });
  assert.equal('resultSeenAt' in next.data, false, 'the next dog’s run starts unseen');
  assert.equal('marksAt' in next.data, false);
});

await t('See the result with nothing changed saves nothing and grades nothing', async () => {
  const { sb, did } = marking({ session: kept() });
  sb.openMarking(sb.run.session, { hidden: true });
  await sb.seeResult();
  assert.ok(!did.some(d => d[0] === 'save' || d[0] === 'wind'));
  assert.ok(did.some(d => d[0] === 'renderResult'));
});

await t('Edit marks: own trails only, the trail in view, nothing asked, and Cancel keeps the run as it was', async () => {
  const seen = kept({ resultSeenAt: T + 120e3, trackWaypoints: [{ kind: 'Indication', lat: 51, lon: -2.6, t: T }] });
  const { sb, did, saved } = marking({ session: seen });
  assert.equal(sb.marksEditable(seen), true);
  assert.equal(sb.marksEditable({ ...seen, targetId: 'hide' }), false, 'a search keeps its marks as they are');
  assert.equal(sb.marksEditable({ ...seen, data: { ...seen.data, imported: { at: T + 1 } } }), false, 'not a run kept from someone else’s link');
  sb.rec.on = true;
  assert.equal(sb.marksEditable(seen), false, 'not while another run is recording');
  sb.rec.on = false;
  sb.replay.s = seen;
  sb.editMarks();
  assert.equal(sb.replay.mark.hidden, false);
  assert.equal(sb.replay.s.data.trail.length, 2, 'the trail stays on the map');
  assert.equal(sb.$('repCancel').hidden, false);
  sb.removeMarkAt(0);
  sb.replay.at = T + 4000;
  sb.placeMarkNow('Indication');
  assert.ok(!did.some(d => d[0] === 'openCall'), 'the answer has been seen: no call');
  sb.cancelMarking();
  assert.equal(sb.replay.mark, null);
  assert.deepEqual(saved.get('r1').data.trackWaypoints.map(w => w.t), [T], 'nothing saved');
  assert.equal(sb.$('repEditRow').hidden, false, 'Edit marks again');
});

await t('the answer is stamped seen once, and only on a run saved as not seen', () => {
  const { sb, saved } = marking({ session: kept({ resultSeenAt: undefined }) });
  sb.noteAnswerSeen(saved.get('r1'));
  assert.equal(saved.get('r1').data.resultSeenAt, undefined, 'an old run is left as it was');
  const fresh = marking({ session: kept() });
  const s = fresh.saved.get('r1');
  fresh.sb.noteAnswerSeen(s);
  const first = fresh.saved.get('r1').data.resultSeenAt;
  assert.ok(first > 0);
  fresh.sb.noteAnswerSeen(fresh.saved.get('r1'));
  assert.equal(fresh.saved.get('r1').data.resultSeenAt, first, 'never moved');
});

await t('wired: the run screen has no marks on a trail, Found and Done open the marking, the result notes it seen', () => {
  const start = bodyOf('startRun', 'async function');
  assert.match(start, /\$\('wpRow'\)\.hidden = onTrail;/, 'a search keeps its live marks');
  const stop = js.slice(js.indexOf('async function finishRun'), js.indexOf('/* ── The result'));
  assert.ok(stop.indexOf('guardSave(patchSession(s, patch)') < stop.indexOf('openMarking(run.session, { hidden: true })'),
    'graded and kept before the marking opens');
  assert.match(stop, /const unseen = markedAfter\(s\) \? \{ resultSeenAt: null \} : \{\};/);
  assert.match(bodyOf('renderResult'), /^\s*function renderResult\(s\) \{\s*\n\s*noteAnswerSeen\(s\);/);
  assert.match(bodyOf('openReplay'), /if \(!replay\.mark\?\.hidden\) noteAnswerSeen\(s\);/, 'the replay with the trail on it is seeing it');
  assert.match(bodyOf('closeReplay'), /if \(replay\.mark\) endMarking\(\);/, 'the back gesture leaves the run as it was graded');
  assert.match(bodyOf('paintWxFelt'), /!markedAfter\(run\.session\)/, 'the wind is only read during a trail');
  assert.match(js, /if \(b\) \(replay\.mark \? pickFeltOnMark\(b\) : pickFeltOnRun\(b\)\);/);
  for (const id of ['repEdit', 'repWind', 'repSee', 'repCancel']) assert.match(js, new RegExp(`\\$\\('${id}'\\)\\.addEventListener\\('click', `));
  assert.match(html, /<button class="btn ghost" id="repWind">Wind<\/button>\s*\n\s*<button class="btn big ember grow" id="repSee">See the result<\/button>/);
  assert.match(html, /<div class="row-gap" id="repEditRow" hidden>\s*<button class="btn ghost" id="repEdit">Edit marks<\/button>/);
  assert.doesNotMatch(js, /Mark what you see/, 'the tutorial no longer tells them to mark during the run');
  assert.match(bodyOf('paintReplay'), /sc\.setAttribute\('aria-valuetext', fmtDur\(/, 'the slider is read out as a time into the run');
  assert.match(bodyOf('editMarks'), /\$\('repMarks'\)\.querySelector\('\.wp-pill'\)\?\.focus\(/, 'focus goes to the tools that came');
  assert.match(bodyOf('cancelMarking'), /\(\$\('repEditRow'\)\.hidden \? \$\('repPlay'\) : \$\('repEdit'\)\)\.focus\(/);
  assert.match(bodyOf('openMarkWind'), /paintFeltSheet\(replay\.s, \{ marking: true \}\)/, 'the sheet says it is one wind for the whole run');
  const css = readFileSync(new URL('../public/app.css', import.meta.url), 'utf8');
  assert.match(css, /#repMarks \{ display: grid; grid-template-columns: repeat\(6, 1fr\);/, 'all five marks in view on a phone');
  assert.match(css, /#repMarks \.wp-pill \{ grid-column: span 2; min-height: 44px;/);
  assert.match(css, /#repMarkList \{ flex-wrap: wrap;/, 'every placed mark in reach');
});

console.log(`\n${pass} passed\n`);
