/* The trail board: the pixel landscape a team climbs, its stepping stones
   and the team standing on it. This file owns the board's DOM and nothing
   else: what the levels are comes from levels.js, how a team reads from
   teams.js, and every pixel from pixel-team.js.

   mountBoard(host, opts) is the one way in. The page hands it the element
   that scrolls and what teamLevel() said, and gets back a small handle to
   repaint it, mark a stone, or play a level-up on it.

   The whole ladder is about 4,150 art rows. An old iPhone blanks a canvas
   taller than 4,096 pixels, so the picture is cut into tiles of TILE rows,
   and a tile is only made and painted once it is near the part of the
   board on screen. */

import { createTeam, TEAM, ANCHOR, REACH, MOMENTS, ICONS, gateOpen, boardLayout, boardTiles, tilesNear, drawBoard, drawBarrier, barrierBand,
         trailPoint, throughGate, gateX, teamRect, ringArt, stamp, plaqueSize, drawPlaque, drawLand, drawStones, lockPixels, unlockWood, duskify, duskOf, DUSK, crispURL, BOARD_LANDS,
         SPEED, STAGE_GLOW, GREAT, burst, confetti, flash, trailGlow, stampPaw, moonbeam, gather } from './pixel-team.js';
import { LADDER_V1, levelSpec } from './levels.js';
import { standing, stoneStatus, stoneLabel, stageLabel } from './teams.js';

/** Every level has its stone. */
export const BOARD_LEVELS = LADDER_V1.levels.length;

/* One art pixel is this many CSS pixels, everywhere on the board. */
const SCALE = 2;
/* A stone's button: 48 CSS px, centred on the stone, so it clears the 44 px
   a thumb needs whatever the art underneath is. */
const HIT = 48;
/** Rows of art to a tile. With the board at most 240 art pixels wide, a tile
    is a canvas of 240 × 256: small on any phone there has ever been. */
export const TILE = 256;
/** The widest the board is drawn, in CSS pixels. */
export const BOARD_MAX_W = 480;
/** Rows of clear ground beyond each boss's gate, where a team that has just
    come through it stands (pixel-team.js boardLayout, throughGate). */
export const GATE_ROOM = 30;

/** The icon on a stone says what its wave makes harder. */
export const WAVE_ICON = Object.freeze({
  runaway: 'ruler', delayed: 'clock', article: 'article',
  outOfSight: 'blind', turns: 'turn', indication: 'pin', ageWarm: 'hourglass', surfaces: 'cobbles', split: 'fork',
  handlerBlind: 'blindfold', doubleBlind: 'query', ageCold: 'hourglass', crossTracks: 'cross', ground: 'road', direction: 'compass',
  empty: 'empty', distance: 'far', town: 'car', veryOld: 'moon', operational: 'torch',
});

/* What each land is called on its sign, in plain words, with the stage it
   is trained in: "The forest · Warm". */
const landSign = (key) => { const L = BOARD_LANDS[key]; return { kind: L.stage, land: key, text: `${L.name} · ${stageLabel(L.stage)}` }; };
/* The land each boss stands in, and the one that opens beyond it. */
const BOSS_LANDS = ['edge', 'forest', 'old', 'ancient'];

/* A stone's number plate and what it says aloud are the same on every board
   this page ever draws, so they are made once: a level-up's own small board
   then costs almost nothing. */
const plaques = new Map(), labels = new Map();

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const el = (tag, cls) => { const n = document.createElement(tag); if (cls) n.className = cls; return n; };

/** The board's layout for a width in CSS pixels: all hundred levels, a
    trailhead under stone 1 and the heart of the wood round stone 100. */
const layouts = new Map();
export function layoutFor(cssWidth) {
  /* One layout to a width, kept: everything worked out from a layout (where
     each tree stands, every track, their pixels) is kept against it, and a
     level-up's own small board, or the same board mounted again, then gets
     all of that for nothing. A phone has one width, or two. */
  const W = Math.ceil(clamp(cssWidth, 280, BOARD_MAX_W) / SCALE);
  if (!layouts.has(W)) {
    /* Three at the most: a window dragged wider on a desk passes through a
       hundred widths, and each would keep its whole wood. */
    if (layouts.size >= 3) layouts.delete(layouts.keys().next().value);
    layouts.set(W, freshLayout(W));
  }
  return layouts.get(W);
}
/* The land painted for a layout, a canvas to a tile (mountBoard, landRows):
   kept against the layout, so every board of that width shares it. */
const landStore = new WeakMap();
function landsOf(layout) {
  let m = landStore.get(layout);
  if (!m) landStore.set(layout, m = new Map());
  return m;
}
function freshLayout(W) {
  const levels = LADDER_V1.levels.map(l => ({ level: l.level, stage: l.stage, boss: l.boss }));
  /* Room under stone 1 for the trailhead, where a new team waits, and for
     the field's sign below that; room over the last for the whole of the
     great tree and a good depth of the wood closing in behind it, so the
     finale is played near the middle of a phone's screen and not jammed
     against the top of it. */
  /* An odd width rounds up: half an art pixel off the right edge is not
     seen, a sliver of the page showing down the left is. */
  return boardLayout(W, levels, { bottom: 84, top: 184, heart: true, gateRoom: GATE_ROOM });
}

/** What the art needs to know of a team: the last stone behind it, the
    first it passed itself (a preset steps over the ones before), the stone
    that wears the ring, and the boss that still bars the way. */
export function boardView(lv) {
  const current = clamp(lv?.passed ?? 0, 0, BOARD_LEVELS);
  const boss = LADDER_V1.bosses.map(b => (typeof b === 'number' ? b : b.level)).find(n => n > current) ?? null;
  return {
    current,
    start: lv?.placement?.startLevel ?? 1,
    next: lv && !lv.done && lv.level <= BOARD_LEVELS ? lv.level : null,
    boss,
  };
}

/** Where the team stands, as a place along the trail: `seg` counts stones
    from 0 (stone 1), so 6 is on stone 7, 6.35 a little past it and -0.5 the
    trailhead. A team that has beaten a boss waits just through its gate; a
    team placed by a preset, on the path short of its first stone. */
const TRAILHEAD = -0.62;

export function teamSeat(lv, layout) {
  const N = layout.stones.length;
  const bossAt = (n) => layout.bosses.find(b => b.level === n) ?? null;
  const at = standing(lv);
  let seg;
  if (at.on != null) {
    const n = clamp(at.on, 1, N), b = bossAt(n);
    seg = n - 1 + (b && n < N ? throughGate(b.kind) : 0);
  } else {
    const n = clamp(at.before, 1, N), b = bossAt(n - 1);
    /* A team that has passed nothing waits at the trailhead, a full body's
       height short of the first stone: nearer, the handler's head covered
       the very stone and number the screen is about. */
    seg = n === 1 ? TRAILHEAD : n - 2 + (b ? throughGate(b.kind) : 0.35);
  }
  const pt = trailPoint(layout, 0, seg);
  let left = layout.faceLeft[clamp(Math.floor(seg + 1e-6), 0, N - 1)];
  if (seg !== Math.round(seg)) {
    /* Between two stones the next one is close, and the dog, leading off
       towards it, would stand on its ring. The team turns the other way
       when that keeps the stone in sight and there is room. */
    const nx = layout.stones[Math.floor(seg) + 1];
    const [a0, a1] = REACH.ahead;
    const covers = (l) => !!nx && Math.abs(nx.y - pt[1]) < 30 && (l ? nx.x < pt[0] - a0 && nx.x > pt[0] - a1 : nx.x > pt[0] + a0 && nx.x < pt[0] + a1);
    const fits = (l) => (l ? pt[0] - REACH.nose >= 0 : pt[0] + REACH.nose <= layout.W);
    if (covers(left) && !covers(!left) && fits(!left)) left = !left;
  }
  return { seg, left, pt };
}

/** The top-left of the team's canvas, in art pixels, when its handler's
    feet are at `pt`. */
export function teamBox(pt, left) {
  const ax = left ? TEAM.w - 1 - ANCHOR[0] : ANCHOR[0];
  return [pt[0] - ax, pt[1] - 1 - TEAM.ground];
}

/* How far in front of the handler's feet the find reaches: the dog, then
   the bush with the person behind it. */
const FIND_REACH = 118;
const GOLD_SPARK = '#f2c14e';

/** Size a small pixel canvas and show it SCALE times bigger, crisp. */
function pixelCanvas(c, w, h) {
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  c.style.width = w * SCALE + 'px'; c.style.height = h * SCALE + 'px';
  const x = c.getContext('2d');
  x.imageSmoothingEnabled = false;
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.clearRect(0, 0, w, h);
  return x;
}

/**
 * Draw the board for a team into `host`, the element that scrolls.
 *
 * opts: { lv        what teamLevel() returned for the team,
 *         look      { coat, jacket, hat, stage } for the pixel team,
 *         motion    false for still poses,
 *         dark      the app's dark theme is on,
 *         imperial  the app's distance units, for the stones' spoken labels,
 *         onPick(level)  a stone was tapped,
 *         still     true where the board is only a picture (a level-up
 *                   played over the result): its stones cannot be tapped,
 *         ambient(ctx, layout, view, t)  what moves on the land by itself
 *                   (grass, water, leaves, mist, fireflies), drawn on a layer of its own
 *                   under the team; the board is complete without it }
 *
 * Returns { update(opts), select(level | null), home(smooth), play(moment),
 * skip(), playing, team, layout, teamSpot(), destroy() }. `team` is the
 * pixel-team player; `teamSpot()` is where it stands, in art pixels.
 */
export function mountBoard(host, opts = {}) {
  const o = Object.assign({ lv: null, look: {}, motion: true, dark: false, imperial: false, onPick: null, still: false, ambient: null }, opts);
  const dpr = Math.max(1, Math.round(window.devicePixelRatio || 1));
  const icons = {};
  for (const l of LADDER_V1.levels) icons[l.level] = WAVE_ICON[l.waveKey] || 'ruler';

  host.textContent = '';
  const board = el('div', 'tb-board');
  const teamCanvas = el('canvas', 'tb-team');
  const sweepCanvas = el('canvas', 'tb-layer tb-sweep');
  /* One layer for everything a moment throws about (the paw, its sparks,
     the lit trail, the confetti): as tall as the part of the board on
     screen and no taller, moved to wherever that is. */
  const fxCanvas = el('canvas', 'tb-layer tb-fx');
  const ribbon = el('div', 'tb-ribbon');
  const ambientCanvas = el('canvas', 'tb-layer tb-ambient');
  ambientCanvas.style.display = 'none';
  for (const c of [teamCanvas, sweepCanvas, fxCanvas, ambientCanvas]) c.setAttribute('aria-hidden', 'true');
  ribbon.setAttribute('aria-hidden', 'true');
  sweepCanvas.style.display = 'none'; fxCanvas.style.display = 'none'; ribbon.style.display = 'none';
  board.append(ambientCanvas, sweepCanvas, teamCanvas, fxCanvas, ribbon);
  if (o.still) board.setAttribute('aria-hidden', 'true');
  host.appendChild(board);

  let layout = null, tiles = [], tileEls = [], gates = [], builtW = 0, selected = null;
  /* What the stones and the art show. It follows o.lv, except while a
     moment plays: then the moment says, a cue at a time. */
  let shown = boardView(o.lv);
  let gateState = null;           // while a boss plays: { k, open, passed }
  let moment = null;              // the moment being played
  let buttons = [], plaqueEls = [], ring = null, queued = 0, facing = null;
  let rover = null;               // the stone the arrow keys have moved to

  const stoneAt = (level) => layout.stones[clamp(level, 1, BOARD_LEVELS) - 1];
  const hostWidth = () => Math.min(host.clientWidth || window.innerWidth || 390, BOARD_MAX_W);

  /* On the team's own board the loop stops while the team is scrolled out
     of sight. A moment's board is watched as a whole instead: there the
     team walks in from off the edge, and a clock that waited for it to be
     in view never started (the boss moment froze with no team on screen). */
  const team = createTeam(teamCanvas, { scene: 'team', scale: SCALE, look: o.look, motion: o.motion, state: restState(), watch: o.still ? host : null,
    onFrame: (t) => { if (moment) moment.tick(t); }, onEnd: () => { if (moment) finish(); } });

  /* At rest the team waits, sniffing. When the engine says the dog has done
     enough, it lies down by its water bowl instead. */
  function restState() {
    const lv = o.lv;
    return lv && (lv.easeOff || (lv.counted && lv.counted.today > 0 && lv.counted.left === 0)) ? 'resting' : 'waiting';
  }

  /* ── Building: the things that depend only on the width ── */

  function build() {
    builtW = hostWidth();
    layout = layoutFor(builtW);
    tiles = boardTiles(layout.H, TILE);
    board.style.width = layout.W * SCALE + 'px';
    board.style.height = layout.H * SCALE + 'px';
    board.querySelectorAll('.tb-art, .tb-gate, .tb-stone, .tb-sign').forEach(n => n.remove());
    tileEls = tiles.map(() => null);

    /* Each boss's landmark is a small layer of its own, so the team can
       stand in front of it or behind it. */
    gates = layout.bosses.map((b, k) => {
      const c = el('canvas', 'tb-layer tb-gate');
      c.setAttribute('aria-hidden', 'true');
      const [y0, y1] = barrierBand(layout, k);
      c.style.top = y0 * SCALE + 'px';
      pixelCanvas(c, layout.W, y1 - y0);
      board.insertBefore(c, sweepCanvas);
      return { c, y0, y1, key: '' };
    });

    /* The stone being read wears the gold ring too, steady and one pixel
       proud (app.css); the arrow over it is what says it is not the next. */
    const ringS = ringArt(false), ringB = ringArt(true), ringSel = ringArt(true, true);
    const ptr = el('canvas'); ptr.width = 6; ptr.height = 5;
    stamp(ptr.getContext('2d'), ['ggggg', '.ggg.', '..g..'], 0, 0, { g: '#f4f6fa' });
    /* A stone's parts are small images, scaled up once to device pixels.
       The ring, the white ring and the pointer are single images that move
       to whichever stone wears them: a hundred stones, four of each. */
    const img = (src, cls, ax, ay) => {
      const im = el('img', cls);
      im.alt = '';
      if (src.toDataURL) im.src = crispURL(src, SCALE * dpr);
      im.style.width = src.width * SCALE + 'px'; im.style.height = src.height * SCALE + 'px';
      im.style.left = (HIT / 2 - 1 - ax * SCALE) + 'px'; im.style.top = (HIT / 2 - 1 - ay * SCALE) + 'px';
      return im;
    };
    const pointer = img(ptr, 'tb-pointer', 3, 0);
    pointer.style.left = ''; pointer.style.top = '';
    ring = { small: img(ringS, 'tb-ring cur small', ringS.ax, ringS.ay), big: img(ringB, 'tb-ring cur big', ringB.ax, ringB.ay), sel: img(ringSel, 'tb-ring sel', ringSel.ax, ringSel.ay), pointer };

    plaqueEls = [];
    buttons = layout.stones.map((s) => {
      const b = el('button', 'tb-stone');
      b.type = 'button';
      // Centred on the stone's middle pixel, so everything inside sits on the grid.
      b.style.left = (s.x * SCALE + 1) + 'px';
      b.style.top = (s.y * SCALE + 1) + 'px';
      b.dataset.level = s.level;
      if (o.still) b.tabIndex = -1;
      const [pw, ph] = plaqueSize(s.level);
      const pl = img({ width: pw, height: ph }, 'tb-plaque', pw >> 1, s.boss ? -10 : -11);
      b.appendChild(pl);
      plaqueEls.push(pl);
      b.addEventListener('click', () => { rover = s.level; if (o.onPick && !moment) o.onPick(s.level); });
      board.appendChild(b);
      return b;
    });

    /* Signs: each land's name where it starts, each boss's by its gate. A
       sign is a plank on a post in the wood of the land it stands in (the
       five tones of that land's tree trunks, and its own cast shadow), set
       beside the trail on the side the team is not on. The words are real
       text, so they stay sharp and can be read. */
    const sign = (kind, land, text, y, side) => {
      /* On the narrowest phones the lands' names are set a little tighter:
         "The ancient wood · Cold" at full size is two thirds of an SE's board. */
      const cls = `tb-sign ${kind}${layout.W < 180 ? ' tight' : ''} `;
      const d = el('div', cls + side);
      const L = BOARD_LANDS && BOARD_LANDS[land], wood = L && L.sign, cast = L && L.cast;
      if (wood) wood.forEach((c, i) => d.style.setProperty('--w' + i, c));
      if (cast) { const [r, g, b] = [1, 3, 5].map(i => parseInt(cast[0].slice(i, i + 2), 16)); d.style.setProperty('--cast', `rgba(${r}, ${g}, ${b}, ${cast[1]})`); }
      const plank = el('b'), words = el('span');
      words.textContent = text;
      plank.appendChild(words);
      d.appendChild(plank);
      d.style.top = y * SCALE + 'px';
      d.dataset.y = y;
      board.appendChild(d);
      /* Beside the trail and clear of it: clear of every row of path the
         sign is level with, and of any stone and its number plate there.
         Never off the board. */
      const w = d.offsetWidth, rows = Math.ceil(d.offsetHeight / SCALE);
      const lo = 4, hi = Math.max(4, layout.W * SCALE - w - 4);
      /* Where the sign would stand on one side, and by how much it would
         not fit there (it is then pushed back in, over the trail). */
      const stand = (left, y) => {
        let edge = left ? Infinity : -Infinity, stone = edge;
        const reach = (x, half) => { if (x === x) edge = left ? Math.min(edge, x - half) : Math.max(edge, x + half); };
        /* A stone's number plate hangs under it, a boss's lower still: a stone
           up to 24 rows above the sign is still in its way. */
        for (const st of layout.stones) if (st.y > y - 24 && st.y < y + rows + 12) reach(st.x, 14);
        stone = edge;
        for (let r = y - 2; r <= y + rows + 2; r++) reach(layout.xAt[clamp(Math.round(r), 0, layout.H)], 6);
        /* Above the last stone there is no trail to keep clear of: the sign
           goes to the board's edge. */
        if (!Number.isFinite(edge)) return { x: left ? lo : hi, over: 0, bad: 0, left, y };
        const want = (e) => (left ? e - 5 : e + 5) * SCALE - (left ? w : 0);
        const over = (x) => (left ? Math.max(0, lo - x) : Math.max(0, x - hi));
        const x = want(edge), o = over(x);
        /* Lying over a stone is far worse than lying over a little trail. */
        return { x: clamp(Math.round(x / SCALE) * SCALE, lo, hi), over: o, bad: o + (Number.isFinite(stone) ? over(want(stone)) * 1000 : 0), left, y };
      };
      /* Where it was asked for, if it fits. "The ancient wood · Cold" is
         longer than the lands' names used to be, and beside a stone in the
         middle of a narrow board it fits on neither side: it lay across the
         stone and its ring. So it tries the other side, and then the rows
         just above and below (between two stones there is only the trail
         to clear), and takes the nearest place that holds it, or failing
         that the one where it covers no stone and the least trail. */
      let at = null;
      for (let k = 0; k <= 14 && !(at && at.over === 0); k++) {
        const yy = y + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 4;
        for (const left of [side === 'left', side !== 'left']) {
          const c = stand(left, yy);
          if (!at || c.bad < at.bad) at = c;
          if (at.over === 0) break;
        }
      }
      if (at.left !== (side === 'left')) d.className = cls + (at.left ? 'left' : 'right');
      if (at.y !== y) { d.style.top = at.y * SCALE + 'px'; d.dataset.y = at.y; }
      d.style.left = at.x + 'px';
      /* The rows and columns it fills, plank and post, in art pixels: a
         sign steps aside when the team stands in front of it (signs()). */
      d.dataset.box = [Math.floor(at.x / SCALE), at.y, Math.ceil((at.x + w) / SCALE), at.y + rows + 6].join(',');
      return d;
    };
    const away = (y) => (layout.xAt[clamp(Math.round(y), 0, layout.H)] > layout.W / 2 ? 'left' : 'right');
    /* The stones may be set closer or wider apart than the forty rows these
       distances were measured at. */
    const k = (layout.spacing || 40) / 40, up = (n) => Math.round(n * k);
    /* The first land's sign stands in its own grass at the foot of the
       board, not on a strip of flat colour under it. */
    { const y = Math.min(stoneAt(1).y + up(72) - 6, layout.H - 20), s = landSign('field'); sign(s.kind, s.land, s.text, y, away(y + 6)); }
    /* No boss stands where the field gives way to the wood's edge: its sign
       is all that says so. */
    if (layout.edgeY > 0) { const y = layout.edgeY - 6, s = landSign('edge'); sign(s.kind, s.land, s.text, y, away(y + 6)); }
    layout.bosses.forEach((b, i) => {
      const last = i === layout.bosses.length - 1;
      const name = `Boss · ${levelSpec(b.level).bossName}`;
      const here = BOSS_LANDS[Math.min(i, BOSS_LANDS.length - 1)];
      /* The heart of the wood has no gate for a sign to stand by, and the
         team fills the glade once it is there: the sign stands among the
         trunks at the glade's top edge, on the side the great tree is not. */
      if (b.kind === 'heart') {
        const ht = layout.heart, y = ht ? Math.max(4, Math.round(ht.y - ht.ry - 12)) : b.y - 60;
        sign('boss', here, name, y, ht && ht.tx < b.x ? 'right' : 'left').dataset.boss = b.level;
        return;
      }
      /* A boss's name stands at its own gate, on the near side of it and
         beside the trail (it stood sixty rows beyond, among the first stones
         of the next land and under that land's own sign). It steps aside
         when the team comes up to the gate (signs()). The next land's name
         is past the gate, higher behind the hamlet's roofs than behind a
         hedge. */
      const tall = b.kind === 'hamlet';
      { const y = b.y + 6; sign('boss', here, name, y, away(y + 6)).dataset.boss = b.level; }
      const next = !last && BOSS_LANDS[i + 1] ? landSign(BOSS_LANDS[i + 1]) : null, y = b.y - up(tall ? 104 : 84) - 6;
      if (next) sign(next.kind, next.land, next.text, y, away(y + 6));
    });
  }

  /* ── Painting ── */

  /* The row the lit land ends on: everything above the boss still to beat. */
  const lockLine = () => {
    const b = layout.bosses.find(x => x.level === shown.boss);
    // Nothing lies beyond the last boss: the heart of the wood is never dimmed.
    return b && b.kind !== 'heart' ? b.lock : -1;
  };
  /* The row the dark woods start on: above it a locked land sinks to
     blue-black, not violet, and the dark theme adds no dusk. */
  const deepLine = () => (layout.bosses[1] ? layout.bosses[1].y : -1);
  /* The car on the lane is part of the picture only when nothing moves:
     with the ambient layer running, cars are driven along it there. */
  const traffic = () => !(o.motion && typeof o.ambient === 'function');
  const artKey = () => [shown.current, shown.start, shown.next, shown.boss, shown.prints, shown.glade, o.dark, traffic(), layout.W].join('/');

  /* Dark theme: the field and the forest go to dusk. The old forest and the
     ancient wood are dark already, and darker still would lose the trail:
     they are left as they are. `c` is a canvas whose top row is board row y0. */
  function dusk(c, y0, h, at = 0) {
    const a = clamp(deepLine() - y0, 0, h), b = clamp((layout.bosses[0] ? layout.bosses[0].y : -1) - y0, a, h);
    duskify(c, layout.W, b - a, at + a, DUSK.forest);
    duskify(c, layout.W, h - b, at + b, DUSK.field);
  }

  /* The land under a tile's stones (ground, tracks, trees) is the same
     whatever the team has done: it is painted once, half a tile at a time,
     and kept with the layout, so the level-up's own small board finds it
     painted already. A moment changes the stones four or five times, and
     each time every tile on screen was painted again from the ground up,
     in one frame. Only the tiles the glade is on know whether the moon is
     in it, and only the lane's whether a car is standing on it: those are
     kept once for each. */
  const halfOf = (t) => t.y0 + ((t.y1 - t.y0) >> 1);
  function landRows(i, a, b) {
    const t = tiles[i], mid = halfOf(t), ht = layout.heart, road = layout.roadY;
    const glade = shown.glade !== false || !(ht && t.y0 < ht.y + ht.ry + 80);
    const parked = traffic() || !(road != null && road > t.y0 - 30 && road < t.y1 + 30);
    const key = [i, glade, parked].join('/'), store = landsOf(layout);
    let L = store.get(key);
    if (!L) { L = { cv: el('canvas'), done: [false, false] }; L.cv.width = layout.W; L.cv.height = t.y1 - t.y0; store.set(key, L); }
    const c = L.cv.getContext('2d');
    [[t.y0, mid], [mid, t.y1]].forEach(([p, q], k) => {
      if (L.done[k] || q <= a || p >= b) return;
      /* Whatever stands across the edge of these rows is drawn whole and
         cut off at it, as it is at the edge of a tile. */
      c.save();
      c.beginPath(); c.rect(0, p - t.y0, layout.W, q - p); c.clip();
      c.clearRect(0, p - t.y0, layout.W, q - p);
      drawLand(c, layout, { glade, traffic: parked }, { y0: p, y1: q, top: t.y0 });
      c.restore();
      L.done[k] = true;
    });
    return L.cv;
  }

  /* Rows a..b of tile i, painted and put through the lock and the dusk. */
  function paintRows(i, a, b) {
    const t = tiles[i], at = a - t.y0, h = b - a;
    let cv = tileEls[i];
    if (!cv) {
      cv = tileEls[i] = el('canvas', 'tb-art');
      cv.setAttribute('aria-hidden', 'true');
      cv.style.top = t.y0 * SCALE + 'px';
      pixelCanvas(cv, layout.W, t.y1 - t.y0);
      board.insertBefore(cv, board.firstChild);
    }
    const c = cv.getContext('2d');
    c.imageSmoothingEnabled = false;
    c.setTransform(1, 0, 0, 1, 0, 0);
    const land = landRows(i, a, b);
    c.save();
    c.beginPath(); c.rect(0, at, layout.W, h); c.clip();
    c.clearRect(0, at, layout.W, h);
    c.drawImage(land, 0, at, layout.W, h, 0, at, layout.W, h);
    drawStones(c, layout, { current: shown.current, start: shown.start, next: shown.next, icons, hedge: false,
      prints: shown.prints == null ? null : [shown.prints, shown.prints + 1] }, { y0: a, y1: b, top: t.y0 });
    c.restore();
    const line = lockLine();
    if (line > a) {
      const im = c.getImageData(0, at, layout.W, h);
      lockPixels(im.data, layout.W, a, line, deepLine());
      c.putImageData(im, 0, at);
    }
    if (o.dark) dusk(c, a, h, at);
  }
  /* A tile, whole and now: one that is on screen. If paintAhead has done
     half of it already, only the other half is left to do. */
  function paintTile(i) {
    const t = tiles[i], key = artKey(), cv = tileEls[i];
    if (cv && cv.dataset.key === key) return;
    const part = cv ? cv.dataset.part : '';
    if (part === key + '|0') paintRows(i, halfOf(t), t.y1);
    else if (part === key + '|1') paintRows(i, t.y0, halfOf(t));
    else paintRows(i, t.y0, t.y1);
    tileEls[i].dataset.key = key;
    tileEls[i].dataset.part = '';
  }
  /* The tiles just off screen are painted before they are scrolled to, half
     a tile at a time and each half in a turn of its own between frames: a
     tile painted inside the scroll's own frame, or two of them at once, is
     a frame dropped on an old phone. `lead` is which half goes first: the
     one nearer the screen. */
  let ahead = 0, dead = false;
  function paintAhead() {
    if (ahead || dead || !layout) return;
    ahead = setTimeout(() => {
      ahead = 0;
      if (dead) return;
      const [top, bottom] = rowsOnScreen(), key = artKey(), mid = (top + bottom) / 2;
      let best = -1;
      for (const i of tilesNear(tiles, top, bottom, TILE)) {
        if (tileEls[i] && tileEls[i].dataset.key === key) continue;
        if (best < 0 || Math.abs((tiles[i].y0 + tiles[i].y1) / 2 - mid) < Math.abs((tiles[best].y0 + tiles[best].y1) / 2 - mid)) best = i;
      }
      if (best < 0) return;
      const t = tiles[best], cv = tileEls[best], part = cv ? cv.dataset.part : '';
      if (part === key + '|0' || part === key + '|1') paintTile(best);
      else {
        const lead = (t.y0 + t.y1) / 2 < mid ? 1 : 0;
        if (lead) paintRows(best, halfOf(t), t.y1); else paintRows(best, t.y0, halfOf(t));
        tileEls[best].dataset.key = '';
        tileEls[best].dataset.part = key + '|' + lead;
      }
      paintAhead();
    }, 0);
  }

  /* The rows on screen, in art pixels. A board not laid out yet (its screen
     is hidden) is taken to be showing the team. */
  function rowsOnScreen() {
    const viewH = host.clientHeight;
    if (!viewH) { const y = teamSpot().pt[1]; return [y - 300, y + 200]; }
    const top = (host.scrollTop - board.offsetTop) / SCALE;
    return [top, top + viewH / SCALE];
  }
  function paintTiles() {
    queued = 0;
    const [top, bottom] = rowsOnScreen();
    for (const i of tilesNear(tiles, top, bottom, 0)) paintTile(i);
    paintAhead();
    /* Number plates too are only made for the stones near the screen: a
       hundred little images up front is what a slow phone would feel. */
    buttons.forEach((b, i) => {
      const y = layout.stones[i].y, pl = plaqueEls[i], key = b.dataset.status;
      if (y < top - TILE / 2 || y > bottom + TILE / 2 || !key || pl.dataset.key === key) return;
      pl.dataset.key = key;
      pl.src = plaqueURL(i + 1, key);
    });
    margins((top + bottom) / 2);
  }
  /* Beside the board on a wide screen, and past its ends on a pull, is more
     of the land on screen: its ground colour, through the same lock and
     dusk the tiles get. */
  function margins(row) {
    const y = clamp(Math.round(row), 0, layout.H - 1);
    const land = BOARD_LANDS[layout.landAt(y)], hex = land.g;
    const px = new Uint8ClampedArray([parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16), 255]);
    if (y < lockLine()) lockPixels(px, 1, 0, 1e9, land.dark ? 1e9 : -1);
    if (o.dark) for (let k = 0; k < 3; k++) px[k] = duskOf(px[k], DUSK[land.key], k);
    const colour = `rgb(${px[0]}, ${px[1]}, ${px[2]})`;
    if (host.dataset.land !== colour) { host.dataset.land = colour; host.style.background = colour; }
  }
  const onScroll = () => { if (!queued) queued = requestAnimationFrame(paintTiles); };
  host.addEventListener('scroll', onScroll, { passive: true });

  /* ── Ambient life ──
     One small canvas, only as tall as the part of the board on screen, moved
     to wherever that is and drawn at 30 frames a second at most. It runs
     only with Animations on, the board in view and the app in front; still,
     the land is the picture alone. `view` is the band of rows the canvas
     covers, as drawBoard takes it, and what is lit. */
  let ambRaf = 0, ambLast = 0, ambSeen = true, ambTop = -1, ambRows = 0;
  const ambientOn = () => typeof o.ambient === 'function' && o.motion && ambSeen && !document.hidden && !!layout;
  function ambientFrame(now) {
    ambRaf = 0;
    if (!ambientOn()) { ambientCanvas.style.display = 'none'; return; }
    ambRaf = requestAnimationFrame(ambientFrame);
    if (now - ambLast < 33) return;
    ambLast = now;
    const top = clamp(Math.floor((host.scrollTop - board.offsetTop) / SCALE), 0, layout.H);
    const rows = Math.min(layout.H - top, Math.ceil(host.clientHeight / SCALE) + 2);
    if (rows <= 0) return;
    let c = ambientCanvas.getContext('2d');
    if (rows !== ambRows || ambientCanvas.width !== layout.W) { ambRows = rows; c = pixelCanvas(ambientCanvas, layout.W, rows); }
    else c.clearRect(0, 0, layout.W, rows);
    if (top !== ambTop) { ambTop = top; ambientCanvas.style.top = top * SCALE + 'px'; }
    o.ambient(c, layout, { y0: top, y1: top + rows, dark: o.dark, lock: lockLine(), current: shown.current }, now);
    ambientCanvas.style.display = 'block';
  }
  const ambientKick = () => {
    if (ambientOn()) { if (!ambRaf) ambRaf = requestAnimationFrame(ambientFrame); }
    else ambientCanvas.style.display = 'none';
  };
  const ambWatch = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver((es) => { ambSeen = es[es.length - 1].isIntersecting; ambientKick(); }) : null;
  if (ambWatch) ambWatch.observe(host);
  document.addEventListener('visibilitychange', ambientKick);

  function paintGates() {
    const line = lockLine();
    gates.forEach((g, k) => {
      const b = layout.bosses[k];
      const live = gateState && gateState.k === k ? gateState : null;
      const behind = shown.current >= b.level;
      const open = live ? live.open : behind ? 1 : 0;
      /* Gold is for a boss the team beat itself, not one a preset stepped over. */
      const passed = live ? live.passed : behind && shown.start <= b.level;
      const key = [open, passed, b.lock < line, o.dark].join('/');
      if (g.key === key) return;
      g.key = key;
      const c = pixelCanvas(g.c, layout.W, g.y1 - g.y0);
      c.setTransform(1, 0, 0, 1, 0, -g.y0);
      drawBarrier(c, layout, k, open, passed);
      c.setTransform(1, 0, 0, 1, 0, 0);
      if (b.lock < line) {
        const im = c.getImageData(0, 0, layout.W, g.y1 - g.y0);
        lockPixels(im.data, layout.W, g.y0, 1e9, deepLine());
        c.putImageData(im, 0, 0);
      }
      if (o.dark) duskify(c, layout.W, g.y1 - g.y0, 0, DUSK[layout.landAt(b.y + 8)]);
    });
  }

  function plaqueURL(level, status) {
    const key = level + '/' + status + '/' + dpr;
    if (!plaques.has(key)) {
      const big = el('canvas');
      const [pw, ph] = plaqueSize(level); big.width = pw; big.height = ph;
      drawPlaque(big.getContext('2d'), level, status, levelSpec(level).boss, layout.landAt(layout.stones[level - 1].y));
      plaques.set(key, crispURL(big, SCALE * dpr));
    }
    return plaques.get(key);
  }
  function stones() {
    /* What a stone says is the team's own record, not the moment being
       played on it; what it shows follows the moment. */
    const view = { passed: shown.current, level: shown.next, done: shown.next == null, placement: { startLevel: shown.start } };
    buttons.forEach((b, i) => {
      const l = i + 1;
      const status = stoneStatus(l, view);
      b.dataset.status = status;
      b.setAttribute('aria-pressed', String(l === selected));
      const lk = l + '/' + status + '/' + o.imperial;
      if (!labels.has(lk)) labels.set(lk, stoneLabel(l, view, { imperial: o.imperial }));
      if (b.dataset.label !== lk) { b.dataset.label = lk; b.setAttribute('aria-label', labels.get(lk)); }
    });
    plates();
    /* The gold ring on the next stone (a boss's gate is its own mark), the
       white one and the pointer on the stone being read. */
    const wear = (im, level, ok) => {
      const b = ok && level != null ? buttons[level - 1] : null;
      if (b) { if (im.parentNode !== b) b.insertBefore(im, b.firstChild); } else im.remove();
    };
    /* One stone takes the Tab key, and the arrows move along the trail from
       it: a hundred tab stops stood between the page's top and whatever came
       after the board. It is the stone last moved to or read, else the next. */
    if (!o.still) {
      const stop = clamp(rover ?? selected ?? shown.next ?? Math.max(1, shown.current), 1, buttons.length);
      buttons.forEach((b, i) => { const ti = i + 1 === stop ? 0 : -1; if (b.tabIndex !== ti) b.tabIndex = ti; });
    }
    /* The heart of the wood has no gate: its stone is a stone like the
       others, and wears the ring. */
    const gated = (level) => level != null && layout.bosses.some(x => x.level === level && x.kind !== 'heart');
    const next = shown.next;
    wear(ring.small, next, !gated(next)); wear(ring.big, next, !gated(next));
    wear(ring.sel, selected, selected !== next && selected != null && !gated(selected));
    wear(ring.pointer, selected, true);
  }

  /* A stone's number plate hangs under it. Where the next stone is nearly
     straight above the one the team waits on, that is where the handler's
     head is: the plate hung across the cap (and, put in front of the team
     instead, the handler wore it). There the plate goes beside its stone,
     on the side the trail does not leave by, and back under it once the
     team has moved on. Not during a moment, when the team runs to that
     stone. Returns the side it went to, for whoever asks. */
  function plates() {
    const seat = !moment && shown.next != null ? teamSeat(o.lv, layout) : null;
    buttons.forEach((b, i) => {
      const s = layout.stones[i], pl = plaqueEls[i];
      let side = 0;
      const [pw, ph] = plaqueSize(s.level);
      if (seat && s.level === shown.next) {
        const hx = seat.pt[0], hy = seat.pt[1];
        if (Math.abs(s.x - hx) < (pw >> 1) + 8 && s.y + 9 < hy - 22 && s.y + 22 > hy - 41) {
          const nx = layout.stones[i + 1], want = nx && nx.x > s.x ? -1 : 1;
          const fits = (d) => (d > 0 ? s.x + 17 + pw <= layout.W : s.x - 17 - pw >= 0);
          side = fits(want) ? want : -want;
        }
      }
      if ((pl.dataset.side || '0') === String(side)) return;
      pl.dataset.side = side;
      pl.style.left = (HIT / 2 - 1 + (side > 0 ? 16 : side < 0 ? -16 - pw : -(pw >> 1)) * SCALE) + 'px';
      pl.style.top = (HIT / 2 - 1 + (side ? -(ph >> 1) : s.boss ? 10 : 11) * SCALE) + 'px';
    });
  }

  /* A sign steps aside for the team: a boss's own sign while the team
     stands at its gate or just through it (it lay across the handler), any
     sign the team is standing in front of (the dog wore one across its
     back), and every sign near a moment while it plays (the title landed
     on one). */
  function signs() {
    const seat = teamSeat(o.lv, layout), tb = teamRect({ x: seat.pt[0], y: seat.pt[1] }, seat.left);
    board.querySelectorAll('.tb-sign').forEach((d) => {
      const boss = Number(d.dataset.boss) || 0;
      let hide = false;
      if (moment) hide = true;
      else if (boss && boss < layout.stones.length) hide = shown.current >= boss - 1 && shown.current <= boss + 1;
      /* Standing in front of it, not beside it: a sign at the team's feet
         (the field's own, at the trailhead) stays where it is. */
      if (!hide && d.dataset.box) { const b = d.dataset.box.split(',').map(Number); hide = b[0] < tb[2] - 4 && b[2] > tb[0] + 4 && b[1] < tb[3] - 9 && b[3] > tb[1] + 6; }
      d.classList.toggle('away', hide);
      // During a moment they are gone at once, not faded: the first frames are the team's.
      d.classList.toggle('now', !!moment);
    });
  }

  function teamSpot() { return teamSeat(o.lv, layout); }
  /* The team's look, with the land it stands on: its shadow is that land's
     shadow, and in the dark woods it is rimmed with light. */
  const lookHere = (lv = o.lv) => Object.assign({}, o.look, { land: layout.landAt(teamSeat(lv, layout).pt[1]) });
  function placeAt(box, left) {
    if (facing !== left) { facing = left; team.set({ flip: left }); }
    teamCanvas.style.left = box[0] * SCALE + 'px';
    teamCanvas.style.top = box[1] * SCALE + 'px';
    /* A gate is in front of the team once its feet are past the gate's line. */
    const feet = box[1] + TEAM.ground;
    gates.forEach((g, k) => g.c.classList.toggle('over', feet < layout.bosses[k].y + 3));
  }
  function place() {
    const { pt, left } = teamSpot();
    placeAt(teamBox(pt, left), left);
  }

  function render() {
    if (!moment) {
      shown = boardView(o.lv);
      shown.glade = shown.current >= layout.stones.length;
      const seat = teamSpot();
      shown.prints = shown.next == null ? null : Math.floor(seat.seg + 1e-6);
    }
    stones();
    paintTiles();
    paintGates();
    signs();
    if (!moment) {
      team.set({ look: lookHere(), motion: o.motion, state: restState() });
      place();
    }
  }

  /* ── Moments: a level passed, a boss beaten ──
     Each is a pure function of its clock, as in pixel-team.js: tick(t) puts
     the board in the state of that instant, so a skip is just tick(end). */

  const scrollTo = (artY, at, smooth) => {
    const max = Math.max(0, host.scrollHeight - host.clientHeight);
    const y = clamp(artY * SCALE + board.offsetTop - host.clientHeight * at, 0, max);
    if (smooth && o.motion && host.scrollTo) host.scrollTo({ top: y, behavior: 'smooth' });
    else host.scrollTop = y;
  };
  const lerpBox = (a, b, u) => [Math.round(a[0] + (b[0] - a[0]) * u), Math.round(a[1] + (b[1] - a[1]) * u)];
  const show = (patch) => {
    let changed = false;
    for (const k of Object.keys(patch)) if (shown[k] !== patch[k]) { shown[k] = patch[k]; changed = true; }
    if (changed) { stones(); paintTiles(); paintGates(); }
  };
  /* A pop, in whole frames: small, past its size, back under it, there. */
  const POP = [0.6, 1.16, 1.06, 0.96];
  const pop = (T) => (T < 0 ? 1 : POP[Math.floor(T / 67)] || 1);

  /* The effects layer for this frame: cleared, moved to the rows on screen,
     and drawn on in the board's own rows. */
  let fxTop = -1, fxRows = 0;
  function fxBegin() {
    const top = clamp(Math.floor((host.scrollTop - board.offsetTop) / SCALE) - 12, 0, layout.H);
    const rows = Math.max(1, Math.min(layout.H - top, Math.ceil((host.clientHeight || 600) / SCALE) + 24));
    let c;
    if (rows !== fxRows || fxCanvas.width !== layout.W) { fxRows = rows; c = pixelCanvas(fxCanvas, layout.W, rows); }
    else { c = fxCanvas.getContext('2d'); c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, layout.W, rows); }
    if (top !== fxTop) { fxTop = top; fxCanvas.style.top = top * SCALE + 'px'; }
    fxCanvas.style.display = 'block';
    c.setTransform(1, 0, 0, 1, 0, -top);
    return c;
  }
  function ribbonAt(text, cls, x, y, k) {
    /* In the level-up's own overlay the card under the board says the name
       and the title: said on the board as well, it was written twice. */
    if (!text || o.still) { ribbon.style.display = 'none'; return; }
    if (ribbon.textContent !== text) ribbon.textContent = text;
    ribbon.className = 'tb-ribbon ' + cls;
    ribbon.style.display = 'block';
    ribbon.style.left = clamp(x * SCALE, 78, layout.W * SCALE - 78) + 'px';
    ribbon.style.top = y * SCALE + 'px';
    ribbon.style.transform = `translateX(-50%) scale(${k.toFixed(3)})`;
  }
  const cue = (m, name) => { if (!m.fired[name]) { m.fired[name] = true; if (m.onCue) m.onCue(name); } };

  /* The way from one seat to another along the trail, as points a pixel or
     so apart with how far along each is: the team is moved by distance, at
     the speed its feet are going, so they do not slide. */
  function wayBetween(seatA, seatB) {
    const pts = [], n = Math.max(8, Math.ceil(Math.abs(seatB.seg - seatA.seg) * 48));
    let d = 0;
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const p = i === 0 ? seatA.pt : i === n ? seatB.pt : trailPoint(layout, 0, seatA.seg + (seatB.seg - seatA.seg) * u);
      if (i) d += Math.hypot(p[0] - pts[i - 1].x, p[1] - pts[i - 1].y);
      pts.push({ x: p[0], y: p[1], d });
    }
    return { pts, len: d };
  }
  function along(way, d) {
    const pts = way.pts;
    let i = 1;
    while (i < pts.length - 1 && pts[i].d < d) i++;
    const a = pts[i - 1], b = pts[i], k = b.d > a.d ? clamp((d - a.d) / (b.d - a.d), 0, 1) : 0;
    return [Math.round(a.x + (b.x - a.x) * k), Math.round(a.y + (b.y - a.y) * k)];
  }
  /* How long the run's steps must be for the feet to keep up with the way. */
  const strideFor = (len, ms) => clamp((len / (ms / 1000)) / SPEED.run, 0.55, 1.6);
  const glowOf = () => STAGE_GLOW[(o.look && o.look.stage) || 'hot'] || STAGE_GLOW.hot;

  /* A level passed: the paw lands on its stone with a flash and a ring of
     sparks, the new name pops up over it, the trail lights up towards it,
     the team runs there, and the stone after it takes the ring under a
     burst of confetti. The last level is the same as far as the arrival,
     then has the finale at the heart of the wood. */
  function levelUpAt(m, t) {
    const sum = m.kind === 'heart';
    const c = MOMENTS[m.kind].cues;
    const top = stoneAt(m.after.current);
    show(Object.assign({ current: t >= c.paw ? m.after.current : m.before.current, next: t >= c.arrive ? m.after.next : m.before.next,
      boss: t >= c.arrive ? m.after.boss : m.before.boss }, sum ? { glade: t >= c.moon } : {}));
    if (t >= c.name) cue(m, 'name');
    const titleAt = sum ? c.title : c.arrive + 250;
    if (m.title && t >= titleAt) cue(m, 'title');
    // The name sits over the stone, and leaves before the team gets there.
    const titled = !!m.title && t >= titleAt;
    ribbonAt(t >= c.name && (t < c.trot + 400 || t >= titleAt) ? (titled ? m.title : m.name) : '',
      titled ? 'boss' : '', top.x, top.y - (t >= c.arrive ? (sum ? 84 : 66) : 30), pop(t - (t >= titleAt ? titleAt : c.name)));
    const u = clamp((t - c.trot) / (c.arrive - c.trot), 0, 1);
    const d = u * m.way.len;
    let pt = u <= 0 ? m.seatA.pt : u >= 1 ? m.seatB.pt : along(m.way, d);
    /* The team pulls up a little to one side when the find would not fit
       on the board from the stone itself (a stone in the middle of a narrow
       board), and steps back on to it once the person has ducked away. */
    if (m.endShift) {
      const back = c.hide != null ? clamp((t - c.hide) / 500, 0, 1) : 0;
      pt = [pt[0] + Math.round(m.endShift * u * u * (1 - back)), pt[1]];
    }
    /* On the way the team faces the way it is going; at each end, the way
       it stands there. */
    const left = u <= 0 ? m.seatA.left : u >= 1 ? m.endLeft : m.goLeft;
    placeAt(teamBox(pt, left), left);
    if (o.motion && u > 0 && u < 1) scrollTo(pt[1], 0.62, false);
    /* The heart of the wood has no gate to open: the banner on the great
       tree turns gold once the team is under it (at the cue of its own, in
       the finale). */
    if (m.bossK != null) { gateState = { k: m.bossK, open: 1, passed: t >= (sum ? c.banner : c.arrive) }; paintGates(); }
    if (t >= c.buzz) cue(m, 'buzz');
    if (!o.motion) return;
    const g = fxBegin(), glow = glowOf();
    // The trail lights up from the team to the stamped stone, ahead of the run.
    const lit = clamp((t - c.name) / Math.max(1, c.trot - c.name + 250), 0, 1);
    if (lit > 0 && u < 1) trailGlow(g, m.dots.filter(p => p.d > d + 10), lit, t, m.dots.length);
    stampPaw(g, top.x, top.y - 1, t - c.paw, ICONS.paw);
    burst(g, top.x, top.y, t - c.paw, glow);
    if (t >= c.arrive) {
      const ring = m.after.next != null ? stoneAt(m.after.next) : null;
      if (ring && !sum) flash(g, ring.x, ring.y, t - c.arrive);
      if (!sum) confetti(g, pt[0] + (left ? -34 : 34), pt[1] - 30, t - c.arrive, { n: 38, stage: (o.look && o.look.stage) || 'hot', spread: 64, seed: m.after.current, life: 1350 });
    }
    if (sum) {
      /* The finale. The banner on the great tree goes gold; then the moon
         finds the tree (the tiles are painted again with the glade lit, and
         the beam comes down on top of them), and every firefly on screen
         winds in to it and rings its trunk; then the title under gold. */
      const ht = layout.heart, bx = ht.tx + GREAT.hw - 5, by = ht.ty - 29;
      if (t >= c.banner) burst(g, bx, by, t - c.banner, [GOLD_SPARK, '#fff0b0', GOLD_SPARK, '#ffffff'], { round: true });
      if (t >= c.moon) {
        /* On the glade between the team and the tree, not down the far
           side of the trunk. */
        moonbeam(g, Math.round((top.x * 2 + ht.tx) / 3), top.y + 7, Math.max(0, fxTop), t - c.moon, 46);
        burst(g, top.x, top.y - 4, t - c.moon, [GOLD_SPARK, '#ffffff', '#b4f8c8', '#fff0b0'], { round: true });
        gather(g, ht.tx, ht.ty - 8, t - c.moon, 22, Math.min(layout.W * 0.5, 96), GREAT.th - 14);
      }
      if (t >= c.title) {
        confetti(g, top.x, top.y - 70, t - c.title, { n: 40, gold: true, spread: 80, seed: 7, life: 1500 });
        confetti(g, top.x, top.y - 70, t - c.title - 500, { n: 24, gold: true, spread: 60, seed: 11, life: 1500 });
      }
    }
  }

  /* A boss beaten: the run to the gate, the find, the next land lighting
     up from the gate upward, the gate swinging, the team going through,
     then the title under gold. */
  function bossAt(m, t) {
    const c = MOMENTS.boss.cues;
    const b = layout.bosses[m.bossK], s = stoneAt(b.level);
    const left = m.gateLeft;
    const home = teamBox(m.seatA.pt, left);
    const gate = m.gateFor(left);
    const beyond = teamBox(m.seatB.pt, m.seatB.left);
    let box, flip = left;
    /* The board follows the team to the gate. A run that passes several
       levels ending on the boss starts three or more stones below it, off
       the bottom of a small board: scrolled to the gate from the first
       frame, the moment opened on a gate with nobody at it. The scroll ends
       exactly where play() used to put it, with the gate low on the screen. */
    if (o.motion) scrollTo(m.seatA.pt[1] + (b.y - m.seatA.pt[1]) * clamp(t / c.arrive, 0, 1), 0.72, false);
    if (t < c.arrive) box = lerpBox(home, gate, t / c.arrive);
    else if (t < c.through) box = gate;
    else {
      /* Through the gate the team faces the way it will stand beyond it,
         turning about the gateway if that is the other way. Walked through
         facing as it came, its box was slid towards one worked out for the
         other facing, which put the handler a team's width off to the side
         (off the edge of a narrow board) until the last frame snapped it back. */
      const u = Math.min(1, (t - c.through) / (c.title - c.through));
      flip = m.seatB.left;
      box = lerpBox(m.gateFor(flip), beyond, u);
    }
    placeAt(box, flip);
    gateState = { k: m.bossK, open: gateOpen(t), passed: t >= c.gate };
    show({ current: t >= c.gate ? m.after.current : b.level - 1, next: t >= c.title ? m.after.next : b.level,
      boss: t >= c.sweep ? m.after.boss : m.before.boss });
    paintGates();
    // The land beyond lights up as a front climbing from the gate.
    const p = clamp((t - c.sweep) / 1300, 0, 1);
    if (m.locked && p > 0 && p < 1) {
      sweepCanvas.style.display = 'block';
      sweepCanvas.getContext('2d').putImageData(unlockWood(m.locked, layout, p), 0, 0);
    } else sweepCanvas.style.display = 'none';
    if (t >= c.title) cue(m, 'title');
    ribbonAt(t >= c.title ? m.title : '', 'boss', s.x, b.y - 112, pop(t - c.title));
    if (t >= c.buzz) cue(m, 'buzz');
    if (!o.motion) return;
    const g = fxBegin();
    // Sparks off the gate as it swings, and gold over the title.
    burst(g, m.gateX, b.y - 14, t - c.gate - 133, glowOf(), { round: true });
    if (t >= c.title) {
      confetti(g, s.x, b.y - 96, t - c.title, { n: 36, gold: true, spread: 78, seed: b.level, life: 1500 });
      confetti(g, s.x, b.y - 96, t - c.title - 420, { n: 20, gold: true, spread: 56, seed: b.level + 3, life: 1300 });
    }
  }

  /* The land beyond a gate as it looks while locked, for the rows on screen
     above it: what the sweep dissolves. */
  function lockedAbove(b, view) {
    /* Only as far up as the screen shows, so the front takes its whole time
       to climb what the handler can see. */
    const rows = Math.min(b.lock, Math.ceil((host.clientHeight || 600) * 0.75 / SCALE) + 8);
    const y0 = b.lock - rows;
    const cv = el('canvas'); cv.width = layout.W; cv.height = rows;
    const c = cv.getContext('2d');
    drawBoard(c, layout, { current: view.current, start: view.start, next: view.next, icons, hedge: false, prints: null }, { y0, y1: b.lock });
    const im = c.getImageData(0, 0, layout.W, rows);
    lockPixels(im.data, layout.W, y0, b.lock, deepLine());
    c.putImageData(im, 0, 0);
    if (o.dark) dusk(c, y0, rows);
    sweepCanvas.style.top = y0 * SCALE + 'px';
    pixelCanvas(sweepCanvas, layout.W, rows);
    return c.getImageData(0, 0, layout.W, rows);
  }

  function finish() {
    const m = moment;
    if (!m) return;
    moment = null; gateState = null;
    sweepCanvas.style.display = 'none'; fxCanvas.style.display = 'none';
    /* The name stays up where the handler asked for no movement: it is the
       whole of the moment there. */
    if (o.motion) ribbon.style.display = 'none';
    o.lv = m.lvAfter;
    gates.forEach(g => { g.key = ''; });
    render();
    scrollTo(teamSpot().pt[1], 0.62, false);
    if (m.onEnd) m.onEnd();
  }

  /**
   * Play a moment. m: { before, after   what teamLevel() said, or its like,
   *                     kind            'levelup' | 'boss',
   *                     name, title     the name earned, the boss's title,
   *                     onCue(name)     'name' | 'title' | 'buzz', once each,
   *                     onEnd() }
   * The board is put as it was before the run, then played to how it is now.
   * With motion off there is nothing to watch: it goes straight to the end,
   * the name left standing over the team.
   */
  function play(m) {
    if (moment) finish();
    const before = boardView(m.before), after = boardView(m.after);
    const seatA = teamSeat(m.before, layout), seatB = teamSeat(m.after, layout);
    const bossK = layout.bosses.findIndex(b => b.level > before.current && b.level <= after.current);
    const b = bossK >= 0 ? layout.bosses[bossK] : null;
    /* The last boss is the great tree at the heart of the wood, with no
       gate and no land beyond: it is played as a level passed as far as the
       tree, and then has a finale of its own. */
    const gated = m.kind === 'boss' && b && b.kind !== 'heart';
    const finale = !!b && b.kind === 'heart';
    const kind = gated ? 'boss' : finale ? 'heart' : 'levelup';
    moment = { kind, before, after, seatA, seatB, lvAfter: m.after, name: m.name || '', title: m.title || '',
      bossK: b ? bossK : null, gateX: b ? gateX(layout, b) : 0,
      onCue: m.onCue || null, onEnd: m.onEnd || null, fired: {}, locked: null, tick: null };
    const mm = moment;
    const cues = MOMENTS[kind].cues;
    let env;
    if (gated) {
      const s = stoneAt(b.level);
      // At the gate: the gap between the dog and the person sits in the gateway.
      mm.gateFor = (l) => [mm.gateX - (l ? TEAM.w - 1 - REACH.gate : REACH.gate) + (l ? 2 : 0), b.y + 4 - TEAM.ground];
      /* The team comes to the gate facing the way it came, unless that
         puts more of it off the edge of the board than the other way would
         (a team is 136 wide; the narrowest board is 140). */
      const off = (l) => { const x = mm.gateFor(l)[0]; return Math.max(0, -x - 2, x + TEAM.w - layout.W - 2); };
      const came = stoneAt(b.level - 1).x > s.x;
      mm.gateLeft = off(came) <= off(!came) ? came : !came;
      const home = teamBox(seatA.pt, mm.gateLeft), gate = mm.gateFor(mm.gateLeft);
      const out = mm.gateFor(seatB.left), beyond = teamBox(seatB.pt, seatB.left);
      env = { stride: strideFor(Math.hypot(gate[0] - home[0], gate[1] - home[1]), cues.arrive),
        stride2: strideFor(Math.hypot(beyond[0] - out[0], beyond[1] - out[1]), cues.title - cues.through) };
    } else {
      mm.way = wayBetween(seatA, seatB);
      mm.goLeft = Math.abs(seatB.pt[0] - seatA.pt[0]) < 2 ? seatB.left : seatB.pt[0] < seatA.pt[0];
      /* The find is played where the team pulls up, and the person in the
         bush stands a good way past the dog's nose: the team faces whichever
         way keeps them on the board, and turns to how it will stand once
         the moment is over. */
      const over = (l) => (l ? Math.max(0, FIND_REACH - seatB.pt[0]) : Math.min(0, layout.W - FIND_REACH - seatB.pt[0]));
      mm.endLeft = finale || Math.abs(over(seatB.left)) <= Math.abs(over(!seatB.left)) ? seatB.left : !seatB.left;
      mm.endShift = finale ? 0 : over(mm.endLeft);
      // A light every six pixels or so of the way, for the trail to come on by.
      mm.dots = [];
      for (let d = 8; d < mm.way.len - 6; d += 6) { const q = along(mm.way, d); q.d = d; q.i = mm.dots.length; mm.dots.push(q); }
      env = { stride: strideFor(mm.way.len, cues.arrive - cues.trot) };
    }
    mm.tick = (t) => (mm.kind === 'boss' ? bossAt(mm, t) : levelUpAt(mm, t));
    o.lv = m.before;
    shown = Object.assign({}, before, { prints: null, glade: before.current >= layout.stones.length });
    stones(); paintTiles(); paintGates(); signs();
    if (gated) {
      /* Still, it goes straight to the gate; moving, it starts on the team
         (bossAt scrolls with it). */
      scrollTo(o.motion ? seatA.pt[1] : b.y, 0.72, false);
      mm.locked = lockedAbove(b, before);
    } else scrollTo(seatA.pt[1], 0.62, false);
    if (!o.motion) {
      mm.tick(MOMENTS[mm.kind].duration);
      const top = stoneAt(after.current);
      ribbonAt(mm.title || mm.name, mm.title ? 'boss' : '', top.x, seatB.pt[1] - 66, 1);
      finish();
      return api;
    }
    team.set({ motion: true, look: lookHere(m.before), env, state: mm.kind });
    mm.tick(0);
    return api;
  }

  const api = {
    /** Paint again with anything that changed: the level, the look, the theme. */
    update(patch = {}) {
      Object.assign(o, patch);
      if (patch.lv) rover = null;
      if (moment && patch.lv) moment.lvAfter = patch.lv;
      if (!layout || hostWidth() !== builtW) { if (moment) finish(); build(); }
      ambientKick();
      if (moment) { if (patch.motion === false) finish(); return api; }
      render();
      return api;
    },
    /** Mark one stone as the one being read, or none. */
    select(level) { selected = level; stones(); return api; },
    /** Bring the team into view, with the stones just ahead of it. */
    home(smooth = false) {
      scrollTo(teamSpot().pt[1], 0.68, smooth);
      paintTiles();
      return api;
    },
    play,
    /** End the moment being played, at how it ends. */
    skip() { finish(); return api; },
    get playing() { return !!moment; },
    teamSpot,
    get team() { return team; },
    get layout() { return layout; },
    get scale() { return SCALE; },
    destroy() {
      moment = null;
      if (queued) cancelAnimationFrame(queued);
      if (ahead) clearTimeout(ahead);
      dead = true;
      host.removeEventListener('scroll', onScroll);
      document.removeEventListener('visibilitychange', ambientKick);
      if (ambWatch) ambWatch.disconnect();
      if (ambRaf) cancelAnimationFrame(ambRaf);
      o.ambient = null;
      team.destroy();
      host.textContent = '';
    },
  };
  /* The arrow keys walk the stones: up the trail and down it, Home and End
     to its two ends. The stone moved to takes the Tab stop with it. */
  board.addEventListener('keydown', (e) => {
    const b = e.target.closest ? e.target.closest('.tb-stone') : null;
    if (!b || o.still) return;
    const n = Number(b.dataset.level);
    const to = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? n + 1 : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? n - 1
      : e.key === 'Home' ? 1 : e.key === 'End' ? buttons.length : null;
    if (to == null) return;
    e.preventDefault();
    rover = clamp(to, 1, buttons.length);
    stones();
    buttons[rover - 1].focus({ preventScroll: true });
    scrollTo(stoneAt(rover).y, 0.5, false);
  });
  build();
  /* Go to the team before anything is painted, so the first tiles made are
     the ones it stands on, not the ones at the top. */
  scrollTo(teamSpot().pt[1], 0.68, false);
  render();
  ambientKick();
  return api;
}
