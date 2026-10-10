/* The trail board (public/board.js, and the layout in public/pixel-team.js):
   where a hundred stones go, how the picture is cut up so an old iPhone can
   hold it, where a team stands, and the rule that a level-up is played once.
   The pixels themselves are looked at in a browser, not here.
   Run with `node test/board.test.mjs`. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { boardLayout, boardTiles, tilesNear, trailPoint, throughGate, gateX, barrierBand, lockPixels, ICONS, TEAM, MOMENTS, createTeam } from '../public/pixel-team.js';
import { BOARD_LEVELS, TILE, BOARD_MAX_W, GATE_ROOM, WAVE_ICON, layoutFor, boardView, teamSeat, teamBox } from '../public/board.js';
import { LADDER_V1, newTeam, teamLevel, levelSpec } from '../public/levels.js';
import { shownLevel, withShown, momentFor, beforeMoment, resultLine, standing, stoneStatus } from '../public/teams.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log(`  ok  ${name}`); };

const NOW = Date.UTC(2026, 9, 10, 12);
const fresh = (preset = 'new') => teamLevel([], { ...newTeam({ handlerId: 'h', dogId: 'd', preset, now: NOW - 1000 }), dogId: 'd' }, { now: NOW });
/** A team that has gone on to pass up to `passed`: the fields the board reads. */
const at = (passed, preset = 'new') => ({ ...fresh(preset), passed, level: Math.min(100, passed + 1), done: passed >= 100 });
/* The phones the board is drawn for, in CSS pixels: an SE, a 13 mini, a
   Pro Max, and the widest the board goes. */
const WIDTHS = [320, 375, 390, 430, 480, 1024];

t('the board has a stone for every level, climbing from the meadow to the summit', () => {
  for (const w of WIDTHS) {
    const L = layoutFor(w);
    assert.equal(L.stones.length, 100);
    assert.equal(BOARD_LEVELS, 100);
    L.stones.forEach((s, i) => {
      assert.equal(s.level, i + 1);
      assert.ok(s.x >= 12 && s.x <= L.W - 12, `stone ${s.level} is on the board at ${w} px (${s.x} of ${L.W})`);
      if (i) assert.ok(s.y < L.stones[i - 1].y, 'each stone is above the one before');
      assert.deepEqual(trailPoint(L, i, 0), [s.x, s.y], `the trail goes through stone ${s.level}`);
      assert.ok(L.pathDist(s.x, s.y) < 1.5);
    });
    assert.ok(L.stones[0].y < L.H && L.stones[99].y > 0);
    // The trail ends on the last stone: nothing leads on from the summit.
    const end = L.path[L.path.length - 1];
    assert.deepEqual([Math.round(end.x), Math.round(end.y)], [L.stones[99].x, L.stones[99].y]);
  }
});

t('four lands, each closed by its boss: stile, footbridge, town wall, cairn', () => {
  const L = layoutFor(375);
  assert.deepEqual(L.bosses.map(b => [b.level, b.kind]), [[15, 'stile'], [45, 'bridge'], [75, 'wall'], [100, 'cairn']]);
  assert.deepEqual(L.bosses.map(b => b.level), LADDER_V1.bosses.map(b => b.level));
  /* A boss's stone is in its gateway, on the line itself: the land it closes
     is the one just under it. */
  const land = (n) => L.landAt(L.stones[n - 1].y + (L.stones[n - 1].boss ? 8 : 0));
  for (let n = 1; n <= 100; n++) {
    const want = n <= 15 ? 'hot' : n <= 45 ? 'warm' : n <= 75 ? 'town' : 'alp';
    assert.equal(land(n), want, `stone ${n} stands in the ${want}`);
    // The first two lands are the first two stages, and Cold has the last two.
    assert.equal(levelSpec(n).stage, want === 'town' || want === 'alp' ? 'cold' : want);
  }
  // The sky is over the summit only, and the last stone has snow under it.
  const top = L.stones[99];
  assert.ok(L.skyAt(top.x) < top.y, 'the cairn stands on the mountain');
  assert.ok(L.skyAt(top.x + 40) < top.y, 'and so does the dog beside it');
  assert.ok(L.skyAt(top.x) > 0, 'with sky above');
  assert.equal(L.landAt(0), 'alp');
  // Each boss's own art keeps inside the board, and the bands do not meet.
  L.bosses.forEach((b, k) => {
    const [y0, y1] = barrierBand(L, k);
    assert.ok(y0 >= 0 && y1 <= L.H && y1 - y0 <= 80);
    assert.ok(b.lock <= b.y);
    assert.ok(Math.abs(gateX(L, b) - b.x) < 12, 'the gateway is on the trail');
  });
});

t('the old sample board still lays out: twenty levels, one boss, the trail running on', () => {
  const levels = LADDER_V1.levels.slice(0, 20).map(l => ({ level: l.level, stage: l.stage, boss: l.boss }));
  const L = boardLayout(187, levels);
  assert.equal(L.stones.length, 20);
  assert.equal(L.bosses.length, 1);
  assert.equal(L.hedgeY, L.stones[14].y + 3);
  assert.equal(L.sky, null);
  assert.ok(L.path[L.path.length - 1].y < L.stones[19].y, 'the trail goes on past the last stone, into the mist');
  assert.equal(L.landAt(L.stones[17].y), 'warm');
});

t('the board is taller than an old iPhone’s canvas, so it is cut into tiles that are not', () => {
  for (const w of WIDTHS) {
    const L = layoutFor(w);
    assert.ok(L.H > 4096, 'one canvas for the whole board would be blanked');
    assert.ok(L.W <= BOARD_MAX_W / 2 && L.W * 2 >= Math.min(w, BOARD_MAX_W), `${L.W} art pixels fill ${w}`);
    const tiles = boardTiles(L.H, TILE);
    assert.equal(tiles[0].y0, 0);
    assert.equal(tiles[tiles.length - 1].y1, L.H);
    tiles.forEach((tl, i) => {
      if (i) assert.equal(tl.y0, tiles[i - 1].y1, 'no gap and no overlap');
      const rows = tl.y1 - tl.y0;
      assert.ok(rows > 0 && rows <= TILE);
      // A tile's canvas is art-sized: far inside 4096 px a side and 16 MP.
      assert.ok(L.W <= 4096 && rows <= 4096 && L.W * rows <= 16e6 / 100);
    });
    // Every tile at once would still be small; what is near the screen is smaller.
    assert.ok(tiles.length * L.W * TILE < 2e6);
    const viewRows = 900 / 2;
    for (const top of [0, 1000, L.H - viewRows]) {
      const near = tilesNear(tiles, top, top + viewRows, TILE / 2);
      assert.ok(near.length >= 2 && near.length <= 5, `${near.length} tiles for one screen`);
      for (const i of near) assert.ok(tiles[i].y1 > top - TILE / 2 && tiles[i].y0 < top + viewRows + TILE / 2);
      // Nothing on screen is left without its tile.
      for (let y = Math.max(0, top); y < Math.min(L.H, top + viewRows); y += 16) assert.ok(near.some(i => tiles[i].y0 <= y && y < tiles[i].y1));
    }
  }
});

t('every wave has its own icon for what it makes harder', () => {
  for (const w of LADDER_V1.waves) {
    assert.ok(WAVE_ICON[w.key], `${w.key} has an icon`);
    const rows = ICONS[WAVE_ICON[w.key]];
    assert.ok(rows, `${WAVE_ICON[w.key]} is drawn`);
    assert.equal(rows.length, 7);
    for (const r of rows) assert.equal(r.length, 7, `${WAVE_ICON[w.key]} is 7 by 7`);
  }
  assert.ok(ICONS.paw, 'and a passed stone its paw');
  assert.ok(new Set(Object.values(WAVE_ICON)).size >= 17, 'few waves share one');
});

t('what the art is told about a team: behind it, its start, the ring, the boss in the way', () => {
  assert.deepEqual(boardView(null), { current: 0, start: 1, next: null, boss: 15 });
  assert.deepEqual(boardView(fresh()), { current: 0, start: 1, next: 1, boss: 15 });
  assert.deepEqual(boardView(at(7)), { current: 7, start: 1, next: 8, boss: 15 });
  assert.deepEqual(boardView(at(15)), { current: 15, start: 1, next: 16, boss: 45 });
  assert.deepEqual(boardView(at(99)), { current: 99, start: 1, next: 100, boss: 100 });
  assert.deepEqual(boardView(at(100)), { current: 100, start: 1, next: null, boss: null });
  // Placed by a preset: the stones before its start are behind it, not passed.
  const placed = fresh('experienced');
  assert.deepEqual(boardView(placed), { current: 45, start: 46, next: 46, boss: 75 });
  assert.equal(stoneStatus(15, placed), 'skipped');
  assert.equal(stoneStatus(46, placed), 'next');
});

t('the team stands on the last stone it passed, through a beaten gate, or short of its first', () => {
  const L = layoutFor(375);
  const stone = (n) => [L.stones[n - 1].x, L.stones[n - 1].y];
  // A new team waits at the trailhead, below stone 1.
  const head = teamSeat(fresh(), L);
  assert.equal(head.seg, -0.5);
  assert.ok(head.pt[1] > L.stones[0].y);
  // On a stone.
  const on7 = teamSeat(at(7), L);
  assert.equal(on7.seg, 6);
  assert.deepEqual(on7.pt, stone(7));
  assert.equal(on7.left, L.faceLeft[6]);
  // Past a boss: just through its gate, above the boss's line.
  for (const b of L.bosses.slice(0, 3)) {
    const seat = teamSeat(at(b.level), L);
    assert.equal(seat.seg, b.level - 1 + throughGate(b.kind));
    assert.ok(seat.pt[1] < b.lock && seat.pt[1] > L.stones[b.level].y, `through the ${b.kind}, short of the next stone`);
  }
  // A team placed by a preset stands on the path just before its first stone.
  const placed = teamSeat(fresh('outOfSight'), L);
  assert.deepEqual(standing(fresh('outOfSight')), { before: 16 });
  assert.ok(placed.seg > 14 && placed.seg < 15);
  // A finished team stands on the summit, beside the cairn.
  const done = teamSeat(at(100), L);
  assert.equal(done.seg, 99);
  assert.deepEqual(done.pt, stone(100));
  // Wherever it stands, the team's picture is on the board from top to toe.
  for (let n = 0; n <= 100; n++) {
    const seat = teamSeat(at(n), L), box = teamBox(seat.pt, seat.left);
    assert.ok(box[1] >= 0 && box[1] + TEAM.h <= L.H + 8, `level ${n}`);
  }
});

t('a land not reached yet is dimmed above its line, and only there', () => {
  const W = 4, rows = 6;
  const px = new Uint8ClampedArray(W * rows * 4).fill(200);
  px[3] = 0;                                    // one clear pixel in the first row
  const before = px.slice();
  lockPixels(px, W, 100, 103);                  // board rows 100..105, the line on row 103
  for (let r = 0; r < rows; r++) {
    for (let x = 0; x < W; x++) {
      const i = (r * W + x) * 4, same = [0, 1, 2].every(k => px[i + k] === before[i + k]);
      if (r >= 3) assert.ok(same, 'rows from the line down are as they were');
      else if (r === 0 && x === 0) assert.ok(same, 'a clear pixel stays clear');
      else assert.ok(!same, 'rows above it are sunk towards dusk');
      assert.equal(px[i + 3], before[i + 3], 'nothing changes how solid a pixel is');
    }
  }
});

/* ── The moment: played once ── */

const up = (o) => ({ type: 'levelUp', at: NOW, sessionId: 's1', from: 7, to: 8, done: false, passed: [7], fromName: 'Line Puller I', toName: 'Line Puller II', ...o });
const bossEv = (level) => { const b = LADDER_V1.bosses.find(x => x.level === level); return { type: 'boss', at: NOW, sessionId: 's1', level, bossName: b.name, title: b.title }; };

t('a level passed is a moment, and only the first time it is asked for', () => {
  const dog = { id: 'd', teams: [newTeam({ handlerId: 'h', dogId: 'd', preset: 'new', now: NOW })] };
  const lv = at(7);
  assert.equal(shownLevel(dog.teams[0]), 0, 'a team that has been shown nothing');
  const m = momentFor([up()], lv, shownLevel(dog.teams[0]));
  assert.deepEqual([m.kind, m.level, m.from, m.name, m.fromName, m.title], ['levelup', 7, 7, 'Line Puller II', 'Line Puller I', null]);
  // What was shown is kept on the team's own row, and nothing else changes.
  const rows = withShown(dog, 'h', m.level);
  assert.equal(rows[0].shown, 7);
  assert.deepEqual({ ...rows[0], shown: undefined }, { ...dog.teams[0], shown: undefined });
  assert.equal(dog.teams[0].shown, undefined, 'the dog it was given is not touched');
  const kept = { ...dog, teams: rows };
  // The same run again (a debrief edit, its marks, a laid trail added): nothing.
  assert.equal(momentFor([up()], lv, shownLevel(kept.teams[0])), null);
  assert.equal(withShown(kept, 'h', 7), null, 'and nothing to save');
  assert.equal(withShown(kept, 'h', 6), null, 'it never goes down');
  assert.equal(withShown(kept, 'nobody', 9), null);
  // The next level is a new moment.
  const next = momentFor([up({ from: 8, passed: [8], toName: 'Line Puller III' })], at(8), shownLevel(kept.teams[0]));
  assert.equal(next.level, 8);
});

t('no moment for a run that passed nothing, or an old one looked at again', () => {
  const lv = at(7);
  assert.equal(momentFor([], lv, 0), null);
  assert.equal(momentFor(null, lv, 0), null);
  assert.equal(momentFor([up()], null, 0), null);
  // An old run's level-up, seen after the team has moved on (or on a phone
  // that never showed it): the team no longer stands where that run put it.
  assert.equal(momentFor([up({ from: 3, passed: [3] })], lv, 0), null);
  assert.equal(momentFor([up()], at(30), 0), null);
});

t('one run passing several levels is one moment, and a boss makes it the boss’s', () => {
  const many = momentFor([up({ from: 6, passed: [6, 7] })], at(7), 5);
  assert.deepEqual([many.kind, many.level, many.from, many.passed], ['levelup', 7, 6, [6, 7]]);
  const b = momentFor([up({ from: 14, to: 16, passed: [14, 15], toName: 'Scent Reader V' }), bossEv(15)], at(15), 13);
  assert.deepEqual([b.kind, b.level, b.bossLevel, b.title, b.bossName], ['boss', 15, 15, 'Trail Hound', 'First Trail']);
  const last = momentFor([up({ from: 100, to: 100, done: true, passed: [100], toName: 'Mission Ready V' }), bossEv(100)], at(100), 99);
  assert.deepEqual([last.kind, last.done, last.title], ['boss', true, 'Master Trailer']);
  // The board is put back to how the team stood going in.
  const before = beforeMoment(at(15), b);
  assert.deepEqual([before.passed, before.level, before.done], [13, 14, false]);
  assert.deepEqual(standing(before), { on: 13 });
  // A placed team's first pass starts from the path short of its stone.
  const placed = { ...fresh('outOfSight'), passed: 16, level: 17 };
  const first = momentFor([up({ from: 16, passed: [16], fromName: 'Scent Reader V', toName: 'Seeker I' })], placed, 0);
  assert.deepEqual(standing(beforeMoment(placed, first)), { before: 16 });
});

t('the line on a result says what the run did for the team, in the app’s units', () => {
  assert.equal(resultLine(null, []), null, 'nobody’s try says nothing');
  assert.deepEqual(resultLine({ verdict: 'pass', why: 'Passed: 92 m, 4 min old, found in 8 min' }, [up()]),
    { kind: 'up', mark: '★', text: 'Level 7 passed · Line Puller II' });
  assert.equal(resultLine(null, [up({ passed: [6, 7] })]).text, 'Levels 6 and 7 passed · Line Puller II');
  assert.equal(resultLine(null, [up({ passed: [11, 12, 13] })]).text, 'Levels 11 to 13 passed · Line Puller II');
  assert.equal(resultLine(null, [up({ passed: [15], toName: 'Scent Reader V' }), bossEv(15)]).text, 'Level 15 passed · Scent Reader V · Trail Hound');
  // Counted, and nothing new passed.
  assert.deepEqual(resultLine({ verdict: 'pass', why: 'Passed: 92 m, found in 8 min (L7 again)' }, []),
    { kind: 'yes', mark: '✓', text: 'Counts: 92 m, found in 8 min (L7 again)' });
  assert.deepEqual(resultLine({ verdict: 'miss', why: 'Missed: not found' }, []), { kind: 'miss', mark: '✕', text: 'Missed: not found' });
  assert.deepEqual(resultLine({ verdict: 'notCounted', why: 'Not counted: 96 of 120 m, too short' }, []),
    { kind: 'no', mark: '–', text: 'Not counted: 96 of 120 m, too short' });
  assert.equal(resultLine({ verdict: 'notCounted', why: 'Not counted: 96 of 120 m, too short' }, [], { imperial: true }).text, 'Not counted: 105 of 131 yd, too short');
  assert.equal(resultLine({ verdict: 'notCounted', why: '' }, []).text, 'Not counted');
});

/* ── Wiring, read from the source ── */

const src = (f) => readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8');

t('the moment is kept as shown before it plays, and only plays over a result that is on screen', () => {
  const app = src('app.js');
  const fn = app.slice(app.indexOf('function levelMoment('), app.indexOf('function paintResultLevel('));
  assert.ok(fn.length > 100);
  const save = fn.indexOf('withShown('), play = fn.indexOf('playMoment(');
  assert.ok(save > 0 && play > save, 'saved first, so a moment cut short is not played again');
  assert.match(fn, /momentFor\(events, lv, shownLevel\(team\)\)/);
  assert.match(fn, /catch \(e\) \{ if \(e\?\.name !== 'SaveError'\) throw e; return; \}/, 'a phone too full to remember it plays nothing');
  // Every place a run's verdict can change hands its events on.
  assert.ok((app.match(/runLevelled\(/g) || []).length >= 7);
  assert.match(app, /function renderResult\(s\) \{\s*\n\s*noteAnswerSeen\(s\);\s*\n\s*paintResultLevel\(s\);/);
  // It can always be skipped, and it leaves by itself.
  assert.match(app, /\$\('levelUp'\)\.addEventListener\('click', momentTap\);/);
  assert.match(app, /moment\.timer = setTimeout\(closeMoment,/);
  assert.match(app, /if \(canHaptic\(\)\) \{\s*\n\s*haptic\('back'\);/, 'the iOS app taps the wrist');
  assert.match(app, /navigator\.vibrate\?\.\(/, 'and a browser that can, buzzes');
  const html = src('index.html');
  assert.match(html, /<div class="lu" id="levelUp" hidden role="dialog"/);
  assert.match(html, /<button type="button" class="btn moss" id="luDone">Carry on<\/button>/);
  assert.match(html, /<button type="button" class="res-level" id="resLevel" hidden><\/button>/);
});

t('the board draws only tiles near the screen, and its stones are labelled buttons', () => {
  const board = src('board.js');
  assert.match(board, /for \(const i of tilesNear\(tiles, top, bottom, TILE \/ 2\)\) paintTile\(i\);/);
  assert.match(board, /host\.addEventListener\('scroll', onScroll, \{ passive: true \}\);/);
  assert.doesNotMatch(board, /pixelCanvas\([a-z]+, layout\.W, layout\.H\)/, 'never one canvas for the whole board');
  assert.match(board, /const b = el\('button', 'tb-stone'\);\s*\n\s*b\.type = 'button';/);
  assert.match(board, /labels\.set\(lk, stoneLabel\(l, view, \{ imperial: o\.imperial \}\)\);/);
  assert.match(board, /b\.setAttribute\('aria-label', labels\.get\(lk\)\);/);
  // The two moments are as long as the pixel team's own.
  assert.ok(MOMENTS.levelup.duration >= 3500 && MOMENTS.levelup.duration <= 5000);
  assert.ok(MOMENTS.boss.duration >= 7000 && MOMENTS.boss.duration <= 9000);
  // The pixel loops and the board's own run from the Animations setting.
  const css = src('app.css');
  assert.match(css, /html\[data-motion="on"\] \.lu-name\.pop \{ animation:/);
});

t('a level passed by another run than the one in hand is still played, once', () => {
  /* Two debriefs written out of order: run 2 was debriefed first, then run
     1's debrief let run 1 pass level 5 and run 2 pass level 6. The team now
     stands on 6, and it is run 2's level-up that put it there. */
  const events = [up({ sessionId: 'run1', from: 5, passed: [5], toName: 'Puppy Nose V' }), up({ sessionId: 'run2', from: 6, passed: [6], toName: 'Line Puller I' })];
  const m = momentFor(events, at(6), 4);
  assert.deepEqual([m.level, m.from, m.sessionId, m.name], [6, 6, 'run2', 'Line Puller I']);
  assert.equal(momentFor(events, at(6), 6), null, 'and not again once it has been shown');
  /* The boss that goes with it is the same run's, never an older one's. */
  const withBoss = momentFor([up({ sessionId: 'a', from: 14, passed: [14, 15], toName: 'Scent Reader V' }), bossEv(15), up({ sessionId: 'b', from: 16, passed: [16], toName: 'Seeker I' })], at(16), 15);
  assert.deepEqual([withBoss.kind, withBoss.level, withBoss.title], ['levelup', 16, null]);
  const app = src('app.js');
  assert.match(app, /levelMoment\(\{ session: s, dog, handlerId: s\.handlerId, lv, events: lv\.events \}\);/, 'the team\'s events, whichever run they belong to');
  for (const fn of ['function saveFix() {', 'function removeFix(s, fixId) {']) {
    const at0 = app.indexOf(fn);
    assert.match(app.slice(at0, app.indexOf('\n}\n', at0)), /runLevelled\(s2\);/, `${fn} says the level again`);
  }
});

t('just through a gate there is room to stand: clear of the arch, short of the next stone', () => {
  for (const w of WIDTHS) {
    const L = layoutFor(w);
    for (const b of L.bosses.slice(0, -1)) {
      const s = L.stones[b.level - 1], next = L.stones[b.level];
      assert.equal(s.y - next.y, L.spacing + GATE_ROOM, 'the step past a gate is longer by the room');
      const seat = teamSeat(at(b.level), L);
      const [y0] = barrierBand(L, L.bosses.indexOf(b));
      /* The stile's arch and the bridge's rails are drawn within their band;
         the wall's is taller for its tower, which stands to one side. */
      if (b.kind !== 'wall') assert.ok(seat.pt[1] <= y0 + 8, `${b.kind} at ${w} px: feet at ${seat.pt[1]}, the gate's art from ${y0 + 7}`);
      assert.ok(seat.pt[1] - 24 > next.y + 8 || Math.abs(seat.pt[0] - next.x) > 20, 'and the handler is not standing on the next stone');
    }
    /* The other stones keep their step, and the trail still only climbs. */
    assert.equal(L.stones[0].y - L.stones[1].y, L.spacing);
    for (let i = 1; i < L.path.length; i++) assert.ok(L.path[i].y <= L.path[i - 1].y + 1e-6);
  }
  assert.equal(boardLayout(160, LADDER_V1.levels.slice(0, 20).map(l => ({ level: l.level, boss: l.boss }))).stones[14].y
    - boardLayout(160, LADDER_V1.levels.slice(0, 20).map(l => ({ level: l.level, boss: l.boss }))).stones[15].y, 40, 'the sample board is laid out as it was');
});

t('a boss moment follows the team to the gate, and cannot be left hanging', () => {
  const board = src('board.js');
  const boss = board.slice(board.indexOf('function bossAt(m, t) {'), board.indexOf('function lockedAbove('));
  /* A run that passes three or more levels ending on the boss starts off
     the bottom of the small board: it scrolls with the team from frame 0. */
  assert.match(boss, /if \(o\.motion\) scrollTo\(m\.seatA\.pt\[1\] \+ \(b\.y - m\.seatA\.pt\[1\]\) \* clamp\(t \/ c\.arrive, 0, 1\), 0\.72, false\);/);
  assert.match(board, /scrollTo\(o\.motion \? seatA\.pt\[1\] : b\.y, 0\.72, false\);/);
  assert.match(board, /watch: o\.still \? host : null,/, 'the clock does not wait for the sprite to be in view');
  const app = src('app.js');
  assert.match(app, /if \(on\) moment\.timer = setTimeout\(\(\) => \{ if \(moment\.board\?\.playing\) moment\.board\.skip\(\); \}, MOMENTS\[m\.kind\]\.duration \+ MOMENT_GRACE\);/);
  /* A boss's title card, and any still card, stays until it is closed. */
  assert.match(app, /if \(on && !boss\) moment\.timer = setTimeout\(closeMoment, MOMENT_HOLD\);/);
});

t('a moment watched to its end leaves no loop running, and a destroyed team asks for no frame', () => {
  /* The pixel player in a page made of stubs: a clock, a queue of frames. */
  const ctx = () => new Proxy({}, { get: (o, k) => (k in o ? o[k]
    : k === 'getImageData' || k === 'createImageData' ? (...a) => ({ data: new Uint8ClampedArray(a[a.length - 2] * a[a.length - 1] * 4) })
    : () => ({ addColorStop() {} })), set: (o, k, v) => { o[k] = v; return true; } });
  const canvas = () => { const c = { width: 0, height: 0, style: {}, getContext: () => (c.x2d ||= ctx()) }; return c; };
  const had = { performance: globalThis.performance, raf: globalThis.requestAnimationFrame, caf: globalThis.cancelAnimationFrame, document: globalThis.document, window: globalThis.window };
  let clock = 0, nextId = 1, asked = 0;
  const queue = new Map();
  Object.defineProperty(globalThis, 'performance', { value: { now: () => clock }, configurable: true, writable: true });
  globalThis.requestAnimationFrame = (fn) => { asked++; queue.set(nextId, fn); return nextId++; };
  globalThis.cancelAnimationFrame = (id) => { queue.delete(id); };
  globalThis.window = { devicePixelRatio: 1 };
  globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {}, createElement: () => canvas() };
  try {
    let api = null, ends = 0, most = 0;
    /* As the board does: every frame may turn the team round, and the end
       of the moment puts it back to waiting. Both call set() from inside
       the frame, which is what used to start a second loop. */
    api = createTeam(canvas(), { scene: 'team', scale: 2, motion: true, state: 'levelup',
      onFrame: () => { if (api) api.set({ flip: true }); }, onEnd: () => { ends++; api.set({ state: 'waiting' }); } });
    const frame = () => { clock += 33; const fns = [...queue.values()]; queue.clear(); most = Math.max(most, fns.length); for (const f of fns) f(clock); };
    for (let i = 0; i < Math.ceil(MOMENTS.levelup.duration / 33) + 60; i++) frame();
    assert.equal(ends, 1, 'the moment ended, once');
    assert.equal(most, 1, 'never more than one frame waiting');
    api.destroy();
    const before = asked;
    for (let i = 0; i < 10; i++) frame();
    api.set({ flip: false });
    assert.equal(asked - before, 0, 'nothing is asked for after destroy()');
    assert.equal(queue.size, 0);
  } finally {
    Object.defineProperty(globalThis, 'performance', { value: had.performance, configurable: true, writable: true });
    globalThis.requestAnimationFrame = had.raf; globalThis.cancelAnimationFrame = had.caf; globalThis.document = had.document; globalThis.window = had.window;
  }
});

console.log(`\nboard: ${pass} checks passed`);
