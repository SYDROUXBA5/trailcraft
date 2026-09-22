/* The unfinished recording.

   This is the one piece of the app whose whole job is to survive the app
   dying, so it is tested the way it fails: a half-written record, a record
   from an older build, a record from yesterday, a walk of one fix. Anything
   that is not clearly this morning's walk must come back as nothing rather
   than as something the handler is invited to keep. */

import assert from 'node:assert/strict';
import { packDraft, unpackDraft, draftAlive, draftStats, DRAFT_MAX_AGE, DRAFT_V } from '../public/draft.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log(`  ok  ${name}`); };

const NOW = Date.UTC(2026, 8, 22, 8, 30);
const walk = (n, from = NOW) => Array.from({ length: n }, (_, i) => ({
  lat: 51.2094 + i * 0.00002, lon: -2.6449 + i * 0.00003, t: from + i * 1000, alt: null, acc: null,
}));

t('a walk goes down and comes back the same walk', () => {
  const pts = walk(300);
  const d = unpackDraft(packDraft({ kind: 'lay', startedAt: NOW, pts, wps: walk(2), targetId: 'person', layerId: 'L1' }, NOW));
  assert.equal(d.kind, 'lay');
  assert.equal(d.pts.length, 300);
  assert.equal(d.wps.length, 2);
  assert.equal(d.targetId, 'person');
  assert.equal(d.layerId, 'L1');
  assert.equal(d.startedAt, NOW);
  for (const i of [0, 150, 299]) {
    assert.ok(Math.abs(d.pts[i].lat - pts[i].lat) < 1e-5, 'where it was');
    assert.ok(Math.abs(d.pts[i].lon - pts[i].lon) < 1e-5);
    assert.equal(d.pts[i].t, pts[i].t, 'and when — the clock the model runs on');
  }
});

t('a long track is written down small enough to write down often', () => {
  /* Forty minutes of walking, rewritten every few seconds. Packed it is about
     90 KB and well under a millisecond; the raw points are twice that. */
  const packed = JSON.stringify(packDraft({ kind: 'run', startedAt: NOW, pts: walk(2400) }, NOW));
  const plain = JSON.stringify(walk(2400));
  assert.ok(packed.length < plain.length / 2, `${packed.length} vs ${plain.length}`);
  assert.ok(packed.length < 120 * 1024, `40 minutes should stay under 120 KB, is ${Math.round(packed.length / 1024)} KB`);
});

t('a run remembers which trail it belongs to', () => {
  const d = unpackDraft(packDraft({ kind: 'run', startedAt: NOW, sessionId: 'sess1', pts: walk(10) }, NOW));
  assert.equal(d.sessionId, 'sess1');
  assert.equal(d.kind, 'run');
});

t('hides are kept as hides', () => {
  const d = unpackDraft(packDraft({ kind: 'hide', startedAt: NOW, hides: walk(3) }, NOW));
  assert.equal(d.hides.length, 3);
  assert.ok(draftAlive(d, NOW + 60e3));
  assert.equal(draftStats(d).hides, 3);
});

t('anything that is not a draft this build wrote comes back as nothing', () => {
  assert.equal(unpackDraft(null), null);
  assert.equal(unpackDraft('a walk'), null);
  assert.equal(unpackDraft({}), null);
  assert.equal(unpackDraft({ v: DRAFT_V + 1, kind: 'lay', at: NOW }), null, 'a record from another build');
  assert.equal(unpackDraft({ v: DRAFT_V, kind: 'nonsense', at: NOW }), null);
  assert.equal(unpackDraft({ v: DRAFT_V, kind: 'lay' }), null, 'half written: no clock');
  assert.equal(packDraft({ kind: 'something', pts: walk(3) }, NOW), null);
});

t('only this morning’s walk is offered back, and only if it is a walk', () => {
  const d = unpackDraft(packDraft({ kind: 'lay', startedAt: NOW, pts: walk(40) }, NOW));
  assert.ok(draftAlive(d, NOW + 5 * 60e3), 'minutes later: yes');
  assert.ok(!draftAlive(d, NOW + DRAFT_MAX_AGE + 1), 'yesterday: no');
  assert.ok(!draftAlive(d, NOW - 60e3), 'a clock that went backwards: no');
  assert.ok(!draftAlive(null, NOW));

  const oneFix = unpackDraft(packDraft({ kind: 'lay', startedAt: NOW, pts: walk(1) }, NOW));
  assert.ok(!draftAlive(oneFix, NOW), 'one fix is not a trail');
  const noHides = unpackDraft(packDraft({ kind: 'hide', startedAt: NOW, hides: [] }, NOW));
  assert.ok(!draftAlive(noHides, NOW), 'no hides is nothing to keep');
});

t('the offer is written from the walk itself, not from when it was written down', () => {
  const d = unpackDraft(packDraft({ kind: 'run', startedAt: NOW, pts: walk(600) }, NOW + 90e3));
  const st = draftStats(d);
  assert.equal(st.points, 600);
  assert.equal(st.lastedMs, 599 * 1000, 'how long it ran, from its own fixes');
  assert.ok(st.metres > 100 && st.metres < 5000, `${st.metres} m`);
  assert.equal(st.startedAt, NOW);
  assert.equal(draftStats(null), null);
});

console.log(`\n${pass} passed total\n`);
