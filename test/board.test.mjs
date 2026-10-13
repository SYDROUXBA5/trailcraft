/* The trail board (public/board.js, and the layout in public/pixel-team.js):
   where a hundred stones go, how the picture is cut up so an old iPhone can
   hold it, where a team stands, and the rule that a level-up is played once.
   The pixels themselves are looked at in a browser, not here.
   Run with `node test/board.test.mjs`. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { drawBoard, drawBarrier, drawAmbient, boardLayout, boardTiles, tilesNear, trailPoint, throughGate, gateX, barrierBand, lockPixels, ICONS, TEAM, MOMENTS, LANDS, LAND_ORDER, landOfLevel, tracksOf, surfaceOf, trailHalf, trailRough, STILL_AT, SPEED, STATES, frame, confetti, burst, createTeam, CLOSE_KINDS, RAMPS, moonbeam, gather, drawGate } from '../public/pixel-team.js';
import * as PIXEL from '../public/pixel-team.js';
import { BOARD_LEVELS, TILE, BOARD_MAX_W, GATE_ROOM, WAVE_ICON, layoutFor, boardView, teamSeat, teamBox } from '../public/board.js';
import { paintTracks } from '../public/pixel/tracks.js';
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

t('the board has a stone for every level, going from the open field to the heart of the wood', () => {
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
    // The trail ends on the last stone: nothing leads on from the heart of the wood.
    const end = L.path[L.path.length - 1];
    assert.deepEqual([Math.round(end.x), Math.round(end.y)], [L.stones[99].x, L.stones[99].y]);
  }
});

t('five lands, deeper and darker: the field, the wood\'s edge, and three woods each closed by its boss', () => {
  const L = layoutFor(375);
  assert.deepEqual(L.bosses.map(b => [b.level, b.kind]), [[15, 'stile'], [45, 'bridge'], [75, 'hamlet'], [100, 'heart']]);
  assert.deepEqual(L.bosses.map(b => b.level), LADDER_V1.bosses.map(b => b.level));
  /* A boss's stone is in its gateway, on the line itself: the land it closes
     is the one just under it. */
  const land = (n) => L.landAt(L.stones[n - 1].y + (L.stones[n - 1].boss ? 8 : 0));
  for (let n = 1; n <= 100; n++) {
    const want = n <= 10 ? 'field' : n <= 15 ? 'edge' : n <= 45 ? 'forest' : n <= 75 ? 'old' : 'ancient';
    assert.equal(land(n), want, `stone ${n} stands in the ${want}`);
    assert.equal(landOfLevel(n), want, `and level ${n} is counted in it`);
    // The field and the wood's edge are Hot, the forest Warm, and Cold has the two old woods.
    assert.equal(LANDS[want].stage, levelSpec(n).stage);
  }
  /* The trees just start: no boss stands where the field ends. */
  assert.ok(L.edgeY < L.stones[9].y && L.edgeY > L.stones[10].y);
  // The trail ends in a glade at the heart of the wood, with the great tree beside the last stone.
  const top = L.stones[99];
  assert.ok(L.heart && Math.abs(L.heart.x - top.x) < 2 && Math.abs(L.heart.y - top.y) < 20, 'the glade is round the last stone');
  assert.ok(Math.abs(L.heart.tx - top.x) >= 24 && L.heart.tx >= 30 && L.heart.tx <= L.W - 30, 'the great tree stands beside it, on the board');
  assert.equal(L.landAt(0), 'ancient');
  // Each boss's own art keeps inside the board, and the bands do not meet.
  L.bosses.forEach((b, k) => {
    const [y0, y1] = barrierBand(L, k);
    assert.ok(y0 >= 0 && y1 <= L.H && y1 - y0 <= 80);
    assert.ok(b.lock <= b.y);
    assert.ok(Math.abs(gateX(L, b) - b.x) < 12, 'the gateway is on the trail');
  });
});

t('the deeper the wood, the more has crossed the trail: nothing in the field, three and more at the top', () => {
  for (const w of WIDTHS) {
    const L = layoutFor(w), T = tracksOf(L);
    const per = (a, b) => T.filter(x => x.level >= a && x.level <= b).length / (b - a + 1);
    assert.equal(per(1, 11), 0, 'the open field is clean');
    // The wood's edge: a line of boot prints, then a dog's, and nothing else.
    assert.deepEqual(T.filter(x => x.level <= 15).map(x => [x.level, x.kind]), [[12, 'boot'], [14, 'paw']]);
    /* It climbs inside each land as well as from one to the next. */
    assert.ok(per(16, 30) >= 0.4 && per(16, 30) < 0.9, `one every other level where the forest starts (${per(16, 30)})`);
    assert.ok(per(31, 45) >= 0.9 && per(31, 45) < 1.5, `about one a level deep in it (${per(31, 45)})`);
    assert.ok(per(46, 60) >= 1.4 && per(46, 60) < 2.4, `nearer two in the old forest (${per(46, 60)})`);
    assert.ok(per(76, 90) >= 2.4, `nearer three in the ancient wood (${per(76, 90)})`);
    assert.ok(per(91, 99) >= 3, `three and more at the top (${per(91, 99)})`);
    assert.ok(per(31, 45) > per(16, 30) && per(46, 60) > per(31, 45) && per(76, 90) > per(46, 60) && per(91, 99) > per(76, 90));
    /* The ladder's own waves show: a path forks off every stretch of
       "Split + decoy" that has room for one; "Cross-tracks" is one line to
       a level, each whole from edge to edge, some leaning each way (a crowd of
       short ones was litter); and by 95 other dogs
       have been through. */
    assert.ok(T.filter(x => x.fork).length >= 3 && T.filter(x => x.fork).every(x => x.level >= 41 && x.level <= 44 && x.kind === 'path'));
    const crowd = T.filter(x => x.level >= 61 && x.level <= 65);
    assert.equal(crowd.length, 5);
    for (const x of crowd) assert.ok(x.s0 === -x.reach && x.s1 === x.reach, `level ${x.level} is crossed by a whole line`);
    for (const lean of [1, -1]) assert.ok(crowd.filter(x => Math.sign(x.ang * x.dir) === lean).length >= 2, 'and they cross each other');
    assert.ok(per(61, 65) < per(91, 99), 'the top of the wood is still the most trodden');
    assert.ok(T.some(x => x.kind === 'paw' && x.level >= 93 && x.level <= 96));
    /* Each maker turns up at its own depth and never before it. */
    const first = (k) => Math.min(...T.filter(x => x.kind === k).map(x => x.level));
    for (const [k, lv] of [['boot', 12], ['paw', 14], ['deer', 18], ['bike', 22], ['path', 27], ['horse', 33], ['ruts', 46], ['herd', 52]]) assert.ok(first(k) >= lv, `${k} from level ${lv}`);
    for (const x of T) {
      /* A track crosses the trail; one that ran along it would be a second trail. */
      assert.ok(Math.abs(x.ang) <= 0.9 + 1e-9, `level ${x.level} ${x.kind} crosses at ${x.ang}`);
      /* A track crosses the trail, never runs along it: 40 degrees between
         them at the least, where they meet. */
      if (!x.fork) {
        const a0 = trailPoint(L, x.level - 1, 0.38), a1 = trailPoint(L, x.level - 1, 0.62);
        const d = ((((x.ang * x.dir - Math.atan2(a1[1] - a0[1], a1[0] - a0[0])) % Math.PI) + Math.PI) % Math.PI);
        assert.ok(Math.min(d, Math.PI - d) > 0.5, `level ${x.level} ${x.kind} lies ${Math.min(d, Math.PI - d).toFixed(2)} off the trail's own line`);
      }
      // Nothing crosses in a boss's gateway (the dog's prints before the
      // stile are set by hand, low and clear of it), on a brook's ford or
      // on the road's own crossing.
      assert.ok(!L.stones[x.level - 1].boss && (!L.stones[x.level].boss || x.level === 14));
      assert.ok(!L.crossings.some(cr => cr.level === x.level));
      assert.ok(L.pathDist(x.x, x.y) < 2, 'and each is hung on the trail itself');
    }
    assert.equal(tracksOf(L), T, 'worked out once for a layout');
  }
});

t('hard ground where the ladder works on it: forestry road, car park, the lane to the hamlet, and a lane across the ancient wood', () => {
  for (let n = 1; n <= 100; n++) {
    const want = n >= 66 && n <= 70 ? 'gravel' : n >= 71 && n <= 75 ? 'tarmac' : 'earth';
    assert.equal(surfaceOf(n), want, `stone ${n} is on ${want}`);
  }
  for (const w of WIDTHS) {
    const L = layoutFor(w);
    // The car park is where the gravel turns to tarmac, beside the trail and on the board.
    assert.ok(L.park && L.park.y < L.stones[69].y && L.park.y > L.stones[70].y);
    assert.ok(L.park.x - L.park.rx >= 0 && L.park.x + L.park.rx <= L.W && Math.abs(L.park.x - L.xAt[L.park.y]) > L.park.rx - 2);
    // The lane with the headlights crosses in the wave that works beside traffic.
    assert.ok(L.roadY < L.stones[85].y && L.roadY > L.stones[89].y, 'between stones 86 and 90');
    assert.ok(L.waters.some(wa => wa.kind === 'stream' && wa.land === 'forest'), 'the fork\'s stream');
    assert.ok(L.crossings.every(cr => L.landAt(cr.y) === cr.land));
  }
});

t('the trail is worn thinner and rougher the deeper it goes, and every land has its colours', () => {
  for (let n = 2; n <= 100; n++) {
    assert.ok(trailHalf(n) <= trailHalf(n - 1) + 1e-9 && trailRough(n) >= trailRough(n - 1) - 1e-9, `level ${n}`);
  }
  assert.ok(trailHalf(1) > 5 && trailHalf(100) >= 3, 'a broad path in the field, and still the widest line in the ancient wood');
  assert.equal(trailRough(1), 0);
  assert.deepEqual(LAND_ORDER, ['field', 'edge', 'forest', 'old', 'ancient']);
  assert.deepEqual(LAND_ORDER.map(k => [LANDS[k].name, LANDS[k].stage, LANDS[k].dark]),
    [['Open field', 'hot', false], ['The wood’s edge', 'hot', false], ['The forest', 'warm', false], ['The old forest', 'cold', true], ['The ancient wood', 'cold', true]]);
  for (const k of LAND_ORDER) {
    const L = LANDS[k];
    for (const ramp of ['floor', 'path', 'water', 'rock', 'sign']) assert.equal(L[ramp].length, 5, `${k}.${ramp} is five tones`);
    assert.equal(L.tag.length, 4);
    for (const c of [...L.floor, ...L.path, ...L.rock, ...L.tag, L.tagInk, L.g, L.print, L.cast[0]]) assert.match(c, /^#[0-9a-f]{6}$/);
  }
  /* The heart of the wood has no gate, so its stone is painted and wears the ring. */
  assert.match(readFileSync(new URL('../public/board.js', import.meta.url), 'utf8'), /x\.kind !== 'heart'/);
  assert.match(readFileSync(new URL('../public/pixel/board-art.js', import.meta.url), 'utf8'), /s\.boss && !\(layout\.heart && s === stones\[stones\.length - 1\]\)/);
});

t('the old sample board still lays out: twenty levels, one boss, the trail running on', () => {
  const levels = LADDER_V1.levels.slice(0, 20).map(l => ({ level: l.level, stage: l.stage, boss: l.boss }));
  const L = boardLayout(187, levels);
  assert.equal(L.stones.length, 20);
  assert.equal(L.bosses.length, 1);
  assert.equal(L.hedgeY, L.stones[14].y + 3);
  assert.equal(L.heart, null);
  assert.ok(L.path[L.path.length - 1].y < L.stones[19].y, 'the trail goes on past the last stone, into the trees');
  assert.equal(L.landAt(L.stones[17].y), 'forest');
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
  assert.equal(head.seg, -0.62);
  assert.ok(head.pt[1] > L.stones[0].y);
  // Far enough below it that the handler's head (34 rows) is under the
  // stone's number plate, which hangs to 20 rows below the stone, and still
  // on the board.
  assert.ok(head.pt[1] - 34 >= L.stones[0].y + 20, `feet at ${head.pt[1]}, stone 1 at ${L.stones[0].y}`);
  assert.ok(head.pt[1] < L.H);
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
  // A finished team stands on the last stone, under the great tree.
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

t('tracks reach a tile as pixels, not as canvas calls, and the crown of the trail is never printed on', () => {
  const had = { document: globalThis.document, ImageData: globalThis.ImageData };
  let sheet = null;
  globalThis.ImageData = class { constructor(w, h) { this.width = w; this.height = h; this.data = new Uint8ClampedArray(w * h * 4); } };
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ({ putImageData(img) { sheet = img; } }) }) };
  try {
    for (const w of [320, 390]) {
      const L = layoutFor(w), n = { fill: 0, copy: 0, px: 0 };
      const c = { set fillStyle(v) {}, fillRect() { n.fill++; }, drawImage() { n.copy++; } };
      for (const tile of boardTiles(L.H, TILE)) {
        sheet = null;
        paintTracks(c, L, tile.y0, tile.y1);
        if (!sheet) continue;
        for (let i = 3; i < sheet.data.length; i += 4) {
          if (!sheet.data[i]) continue;
          const x = ((i - 3) / 4) % L.W, y = tile.y0 + Math.floor((i - 3) / 4 / L.W);
          n.px++;
          assert.ok(L.pathDist(x, y) > trailHalf(L.levelAt(y)) - 2, `a track's pixel on the trail's crown at ${x}, ${y} (level ${L.levelAt(y).toFixed(1)})`);
        }
      }
      assert.equal(n.fill, 0, 'not one fillRect');
      assert.ok(n.copy >= 10 && n.px > 20000, `${n.copy} tiles took ${n.px} pixels`);
    }
    // The trail is the widest line on the board, wherever it is.
    for (let lv = 1; lv <= 100; lv++) assert.ok(trailHalf(lv) * 2 >= 7, `the trail is ${(trailHalf(lv) * 2).toFixed(1)} wide at ${lv}`);
  } finally {
    globalThis.document = had.document; globalThis.ImageData = had.ImageData;
  }
});

t('the board draws only tiles near the screen, and its stones are labelled buttons', () => {
  const board = src('board.js');
  /* Now, the tiles on screen; a turn at a time between frames, the ones a
     tile's height past it; and each of those half a tile to a turn. */
  assert.match(board, /for \(const i of tilesNear\(tiles, top, bottom, 0\)\) paintTile\(i\);\s*\n\s*paintAhead\(\);/);
  assert.match(board, /for \(const i of tilesNear\(tiles, top, bottom, TILE\)\) \{/);
  assert.match(board, /ahead = setTimeout\(\(\) => \{/);
  assert.match(board, /if \(ahead\) clearTimeout\(ahead\);/, 'and not after the board is gone');
  // One layout to a width, so its scene, its tracks and its painted land are worked out once.
  assert.equal(layoutFor(390), layoutFor(390));
  assert.match(board, /if \(layouts\.size >= 3\) layouts\.delete\(layouts\.keys\(\)\.next\(\)\.value\);/, 'and three widths at the most are kept');
  /* The wood under a tile's stones is painted once and kept: a stone
     turning gold copies it. */
  assert.match(board, /const land = landRows\(i, a, b\);/);
  assert.match(board, /c\.drawImage\(land, 0, at, layout\.W, h, 0, at, layout\.W, h\);\s*\n\s*drawStones\(/);
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
         the hamlet's is taller for its cottages, which stand to each side. */
      if (b.kind !== 'hamlet') assert.ok(seat.pt[1] <= y0 + 8, `${b.kind} at ${w} px: feet at ${seat.pt[1]}, the gate's art from ${y0 + 7}`);
      assert.ok(seat.pt[1] - 24 > next.y + 8 || Math.abs(seat.pt[0] - next.x) > 20, 'and the handler is not standing on the next stone');
    }
    /* The other stones keep their step, and the trail still only climbs. */
    assert.equal(L.stones[0].y - L.stones[1].y, L.spacing);
    for (let i = 1; i < L.path.length; i++) assert.ok(L.path[i].y <= L.path[i - 1].y + 1e-6);
  }
  assert.equal(boardLayout(160, LADDER_V1.levels.slice(0, 20).map(l => ({ level: l.level, boss: l.boss }))).stones[14].y
    - boardLayout(160, LADDER_V1.levels.slice(0, 20).map(l => ({ level: l.level, boss: l.boss }))).stones[15].y, 52, 'the sample board keeps the plain step: no room past its gate unless asked');
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

t('the heart of the wood has a finale of its own, as long as a boss, and every moment ends on a frame that can be held', () => {
  /* The page allows a boss's length for the last level (it calls it a boss),
     so the finale at the great tree is exactly as long. */
  assert.equal(MOMENTS.heart.duration, MOMENTS.boss.duration);
  for (const kind of ['levelup', 'boss', 'heart']) {
    const m = MOMENTS[kind], at = Object.values(m.cues);
    assert.ok(at.every((v, i) => i === 0 || v > at[i - 1]), `${kind}: the cues come in order`);
    assert.ok(at[at.length - 1] < m.duration - 500, `${kind}: there is a hold after the last cue`);
    assert.equal(STILL_AT[kind], m.duration, `${kind}: with motion off it shows its end`);
    // The cues the page hangs its haptics and its card on are still there.
    assert.ok('buzz' in m.cues && ('name' in m.cues || 'title' in m.cues));
  }
  /* The banner on the great tree, then the moon, then the title. Nothing of
     the old summit (its flag, its aurora) is left for a caller to ask for. */
  for (const k of ['banner', 'moon', 'title']) assert.ok(k in MOMENTS.heart.cues);
  assert.equal(MOMENTS.summit, undefined);
  const board = src('board.js');
  assert.match(board, /const kind = gated \? 'boss' : finale \? 'heart' : 'levelup';/);
  assert.match(board, /team\.set\(\{ motion: true, look: lookHere\(m\.before\), env, state: mm\.kind \}\);/);
});
t('every state and moment is a pure function of its clock, at any time and any stride', () => {
  for (const state of STATES.concat(['levelup', 'boss', 'heart'])) {
    for (let ms = 0; ms <= 9200; ms += 33) {
      const a = frame(state, ms, { stride: 0.7, stride2: 1.4 }), b = frame(state, ms, { stride: 0.7, stride2: 1.4 });
      assert.ok(a.dog && a.handler && a.handler.o, `${state} at ${ms}: a dog and a handler`);
      assert.deepEqual(a, b, `${state} at ${ms}: the same frame twice`);
      for (const v of [a.dog.x, a.dog.y, a.handler.x, a.line]) assert.ok(Number.isFinite(v), `${state} at ${ms}: numbers`);
    }
  }
});
t('the team is moved at the speed its feet are going, so they do not slide', () => {
  assert.ok(SPEED.trail > 10 && SPEED.trail < 30 && SPEED.run > SPEED.trail * 1.6);
  /* A run says how fast the ground must pass, scaled by the stride it was
     given; the board works the stride out from the way and the time. */
  const c = MOMENTS.levelup.cues, mid = (c.trot + c.arrive) / 2;
  assert.equal(frame('levelup', mid, { stride: 1 }).speed, SPEED.run);
  assert.equal(frame('levelup', mid, { stride: 1.25 }).speed, SPEED.run * 1.25);
  assert.ok(frame('levelup', mid, { stride: 1.25 }).dog.legs.reach > frame('levelup', mid, { stride: 1 }).dog.legs.reach);
  assert.equal(frame('trailing', 500).speed, SPEED.trail);
  const board = src('board.js');
  assert.match(board, /const strideFor = \(len, ms\) => clamp\(\(len \/ \(ms \/ 1000\)\) \/ SPEED\.run, 0\.55, 1\.6\);/);
  assert.match(board, /env = \{ stride: strideFor\(mm\.way\.len, cues\.arrive - cues\.trot\) \};/);
});
t('a moment’s effects are drawn from the clock alone, and only with Animations on', () => {
  const seen = (fn) => { const out = []; fn({ set fillStyle(v) { this.f = v; }, fillRect(...a) { out.push(a.join()); } }); return out; };
  const a = seen(c => confetti(c, 100, 100, 600, { n: 16, stage: 'hot', seed: 7 }));
  assert.ok(a.length >= 16, 'sixteen pieces in the air');
  assert.deepEqual(a, seen(c => confetti(c, 100, 100, 600, { n: 16, stage: 'hot', seed: 7 })), 'the same frame twice');
  assert.equal(seen(c => confetti(c, 100, 100, 5000, { n: 16, stage: 'hot' })).length, 0, 'and none left lying about');
  assert.ok(seen(c => burst(c, 50, 50, 70, ['#111', '#222', '#333', '#fff'])).length >= 8, 'a ring of eight sparks');
  assert.equal(seen(c => burst(c, 50, 50, 600, ['#111', '#222', '#333', '#fff'])).length, 0);
  const board = src('board.js');
  /* Still, the moment is its end state: no effects layer is ever shown. */
  assert.match(board, /if \(!o\.motion\) return;\s*\n\s*const g = fxBegin\(\)/);
  assert.match(board, /sweepCanvas\.style\.display = 'none'; fxCanvas\.style\.display = 'none';/);
  assert.match(board, /const ambientOn = \(\) => typeof o\.ambient === 'function' && o\.motion && ambSeen && !document\.hidden && !!layout;/);
  assert.match(src('app.js'), /onPick: pickStone, ambient: drawAmbient \};/);
});

t('every tile of the board paints, and every band of it moves, in all five lands and both themes', () => {
  /* Not the pixels (those are looked at in a browser): that no painter of
     any land throws. A name used before it was made, in the field's
     butterflies, stopped the whole board's ambient life and no test said so. */
  const ctx = () => new Proxy({}, { get: (o, k) => (k in o ? o[k]
    : k === 'getImageData' || k === 'createImageData' ? (...a) => ({ data: new Uint8ClampedArray(a[a.length - 2] * a[a.length - 1] * 4), width: a[a.length - 2], height: a[a.length - 1] })
    : () => ({ addColorStop() {} })), set: (o, k, v) => { o[k] = v; return true; } });
  const canvas = () => { const c = { width: 0, height: 0, style: {}, getContext: () => (c.x2d ||= ctx()), toDataURL: () => '' }; return c; };
  const had = { document: globalThis.document, ImageData: globalThis.ImageData };
  globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {}, createElement: () => canvas() };
  globalThis.ImageData = class { constructor(a, b, c) { if (typeof a === 'number') { this.width = a; this.height = b; this.data = new Uint8ClampedArray(a * b * 4); } else { this.data = a; this.width = b; this.height = c; } } };
  try {
    for (const w of [320, 390]) {
      const L = layoutFor(w), tiles = boardTiles(L.H, TILE);
      for (const state of [{ current: 0, next: 1 }, { current: 59, start: 20, next: 60, prints: [58, 59] }, { current: 100, next: null, glade: true }, { current: 99, next: 100, glade: false }]) {
        for (const tile of tiles) drawBoard(canvas().getContext('2d'), L, state, tile);
      }
      L.bosses.forEach((b, k) => { for (const open of [0, 0.5, 1]) drawBarrier(canvas().getContext('2d'), L, k, open, open === 1); });
      for (const dark of [false, true]) for (const clock of [0, 133, 950, 4321, 60000]) {
        for (const tile of tiles) drawAmbient(canvas().getContext('2d'), L, { y0: tile.y0, y1: tile.y1, dark, lock: -1, current: 100 }, clock);
      }
    }
  } finally {
    globalThis.document = had.document; globalThis.ImageData = had.ImageData;
  }
});

t('the close-up shows the same five lands, each gate and the finale, at any instant of any state', () => {
  assert.deepEqual(CLOSE_KINDS, LAND_ORDER, 'one close-up for each land of the board, by the same names');
  const ctx = () => new Proxy({}, { get: (o, k) => (k in o ? o[k]
    : k === 'getImageData' || k === 'createImageData' ? (...a) => ({ data: new Uint8ClampedArray(a[a.length - 2] * a[a.length - 1] * 4), width: a[a.length - 2], height: a[a.length - 1] })
    : () => ({ addColorStop() {} })), set: (o, k, v) => { o[k] = v; return true; } });
  const canvas = () => { const c = { width: 0, height: 0, style: {}, getContext: () => (c.x2d ||= ctx()), toDataURL: () => '' }; return c; };
  const had = { document: globalThis.document, window: globalThis.window, raf: globalThis.requestAnimationFrame, caf: globalThis.cancelAnimationFrame };
  globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {}, createElement: () => canvas() };
  globalThis.window = { devicePixelRatio: 1 };
  globalThis.requestAnimationFrame = () => 0; globalThis.cancelAnimationFrame = () => {};
  try {
    for (const land of LAND_ORDER) {
      for (const state of STATES.concat(['levelup', 'boss', 'heart'])) {
        const team = createTeam(canvas(), { scene: 'close', scale: 2, state, motion: true, look: { coat: 'bloodhound-red', jacket: 'navy', hat: 'cap', stage: LANDS[land].stage, land }, env: { stride: 1 } });
        /* The middle of the boss's sweep, the gate ajar, the moon's first
           frames and the hold are all in here. */
        for (const ms of [0, 300, 1800, 3700, 4500, 4800, 5400, 7200, 8800]) team.freeze(ms);
        team.set({ motion: false });
        team.destroy();
      }
    }
    for (const kind of ['stile', 'bridge', 'hamlet']) for (const part of ['back', 'front', 'all']) drawGate(canvas().getContext('2d'), kind, 100, 0.5, part);
  } finally {
    globalThis.document = had.document; globalThis.window = had.window; globalThis.requestAnimationFrame = had.raf; globalThis.cancelAnimationFrame = had.caf;
  }
  /* The finale's light is the clock's alone, like every other effect. */
  const seen = (fn) => { const out = []; fn({ set fillStyle(v) { this.f = v; }, fillRect(...a) { out.push([this.f].concat(a)); } }); return out; };
  assert.equal(seen(c => moonbeam(c, 60, 96, 0, -1)).length, 0, 'no moon before its cue');
  const thread = seen(c => moonbeam(c, 60, 96, 0, 67)), beam = seen(c => moonbeam(c, 60, 96, 0, 2000));
  const width = (list) => Math.max(...list.map(v => v[1] + v[3])) - Math.min(...list.map(v => v[1]));
  assert.ok(thread.length > 20 && beam.length > thread.length && width(beam) > width(thread) + 10, 'a thread of light, then the beam opened out');
  assert.deepEqual(beam, seen(c => moonbeam(c, 60, 96, 0, 2000)), 'the same frame twice');
  assert.ok(seen(c => gather(c, 60, 90, 2600, 22)).length >= 22, 'every firefly has come to the tree');
  assert.deepEqual(seen(c => gather(c, 60, 90, 900, 22)), seen(c => gather(c, 60, 90, 900, 22)));
});
t('nothing of the town at night or the snowy climb is left to draw from', () => {
  for (const k of ['wood', 'town', 'climb']) assert.equal(RAMPS[k], undefined, `RAMPS.${k} is gone`);
  for (const k of ['CAST', 'skyFlare', 'shootingStars']) assert.equal(PIXEL[k], undefined, `${k} is gone`);
  const art = ['ambient', 'board-art', 'close', 'fx', 'ground', 'landmarks', 'lands', 'layout', 'moments', 'player', 'scene', 'scenery', 'stones', 'team', 'tracks']
    .map(f => src(`pixel/${f}.js`)).join('\n') + src('board.js');
  for (const word of ['aurora', 'cairn', 'summit', 'snow', 'fountain', 'RAMPS.town', 'RAMPS.climb', 'RAMPS.wood']) assert.ok(!art.includes(word), `no "${word}" in the board's art or its moments`);
  /* With motion on, the lane's car is the ambient layer's to drive; still, it is in the picture. */
  assert.match(src('board.js'), /const traffic = \(\) => !\(o\.motion && typeof o\.ambient === 'function'\);/);
  assert.match(src('pixel/scene.js'), /if \(!st \|\| st\.traffic !== false\) car\(/);
});

console.log(`\nboard: ${pass} checks passed`);
