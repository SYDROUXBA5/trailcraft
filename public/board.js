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
         trailPoint, throughGate, gateX, ringArt, stamp, plaqueSize, drawPlaque, lockPixels, unlockWood, duskify, crispURL, BOARD_LANDS, RAMPS, CAST,
         SPEED, STAGE_GLOW, burst, confetti, flash, trailGlow, stampPaw, skyFlare } from './pixel-team.js';
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

/* What each land is called on its sign. */
const LAND_SIGNS = [
  { kind: 'hot', land: 'meadow', text: `Red meadow · ${stageLabel('hot')}` },
  { kind: 'warm', land: 'wood', text: `Amber wood · ${stageLabel('warm')}` },
  { kind: 'cold', land: 'town', text: `Blue town · ${stageLabel('cold')}` },
  { kind: 'cold', land: 'climb', text: `The climb · ${stageLabel('cold')}` },
];

/* A stone's number plate and what it says aloud are the same on every board
   this page ever draws, so they are made once: a level-up's own small board
   then costs almost nothing. */
const plaques = new Map(), labels = new Map();

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const el = (tag, cls) => { const n = document.createElement(tag); if (cls) n.className = cls; return n; };

/** The board's layout for a width in CSS pixels: all hundred levels, a
    trailhead under stone 1 and the summit's sky over stone 100. */
export function layoutFor(cssWidth) {
  const levels = LADDER_V1.levels.map(l => ({ level: l.level, stage: l.stage, boss: l.boss }));
  /* Room under stone 1 for the trailhead, where a new team waits, and for
     the meadow's sign below that; room over the last for the night sky. */
  /* An odd width rounds up: half an art pixel off the right edge is not
     seen, a sliver of the page showing down the left is. */
  return boardLayout(Math.ceil(clamp(cssWidth, 280, BOARD_MAX_W) / SCALE), levels, { bottom: 84, top: 110, summit: true, gateRoom: GATE_ROOM });
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
 *                   (grass, water, smoke, snow), drawn on a layer of its own
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
      const d = el('div', `tb-sign ${kind} ${side}`);
      const wood = RAMPS && RAMPS[land] && RAMPS[land].trunk, cast = CAST && CAST[land];
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
      const w = d.offsetWidth, rows = Math.ceil(d.offsetHeight / SCALE), left = side === 'left';
      let edge = left ? Infinity : -Infinity;
      const reach = (x, half) => { edge = left ? Math.min(edge, x - half) : Math.max(edge, x + half); };
      for (let r = y - 2; r <= y + rows + 2; r++) reach(layout.xAt[clamp(Math.round(r), 0, layout.H)], 6);
      /* A stone's number plate hangs under it, a boss's lower still: a stone
         up to 24 rows above the sign is still in its way. */
      for (const st of layout.stones) if (st.y > y - 24 && st.y < y + rows + 12) reach(st.x, 14);
      const x = (left ? edge - 5 : edge + 5) * SCALE - (left ? w : 0);
      d.style.left = clamp(Math.round(x / SCALE) * SCALE, 4, Math.max(4, layout.W * SCALE - w - 4)) + 'px';
      return d;
    };
    const away = (y) => (layout.xAt[clamp(Math.round(y), 0, layout.H)] > layout.W / 2 ? 'left' : 'right');
    /* The stones may be set closer or wider apart than the forty rows these
       distances were measured at. */
    const k = (layout.spacing || 40) / 40, up = (n) => Math.round(n * k);
    /* The first land's sign stands in its own grass at the foot of the
       board, not on a strip of flat colour under it. */
    { const y = Math.min(stoneAt(1).y + up(72) - 6, layout.H - 20); sign(LAND_SIGNS[0].kind, LAND_SIGNS[0].land, LAND_SIGNS[0].text, y, away(y + 6)); }
    layout.bosses.forEach((b, i) => {
      const last = i === layout.bosses.length - 1;
      const name = `Boss · ${levelSpec(b.level).bossName}`;
      const here = LAND_SIGNS[Math.min(i, LAND_SIGNS.length - 1)].land;
      /* The summit has only sky above it: its sign stands on the snow just
         below the last stone. */
      if (last) { const y = b.y + 30; sign('boss', here, name, y, away(y + 6)).dataset.boss = b.level; return; }
      /* The team waits just through the gate, facing on: the sign goes behind it. */
      sign('boss', here, name, b.y - up(b.kind === 'wall' ? 80 : 60) - 6, layout.faceLeft[b.level - 1] ? 'right' : 'left').dataset.boss = b.level;
      const land = LAND_SIGNS[i + 1], y = b.y - up(b.kind === 'wall' ? 122 : 102) - 6;
      if (land) sign(land.kind, land.land, land.text, y, away(y + 6));
    });
  }

  /* ── Painting ── */

  /* The row the lit land ends on: everything above the boss still to beat. */
  const lockLine = () => {
    const b = layout.bosses.find(x => x.level === shown.boss);
    // Nothing lies beyond the last boss: the sky over the summit is never dimmed.
    return b && b.kind !== 'cairn' ? b.lock : -1;
  };
  const artKey = () => [shown.current, shown.start, shown.next, shown.boss, shown.prints, shown.aurora, o.dark, layout.W].join('/');

  /* Dark theme: the day lands go to dusk. The town is night already, and
     keeps its lights. `c` is a canvas whose top row is board row y0. */
  function dusk(c, y0, h) {
    const far = layout.bosses[2], near = layout.bosses[1];
    const a = far && near ? clamp(far.y - y0, 0, h) : h, b = far && near ? clamp(near.y - y0, 0, h) : h;
    if (a > 0) duskify(c, layout.W, a, 0);
    if (h - b > 0) duskify(c, layout.W, h - b, b);
  }

  function paintTile(i) {
    const t = tiles[i], key = artKey();
    let cv = tileEls[i];
    if (cv && cv.dataset.key === key) return;
    if (!cv) {
      cv = tileEls[i] = el('canvas', 'tb-art');
      cv.setAttribute('aria-hidden', 'true');
      cv.style.top = t.y0 * SCALE + 'px';
      board.insertBefore(cv, board.firstChild);
    }
    const h = t.y1 - t.y0;
    const c = pixelCanvas(cv, layout.W, h);
    drawBoard(c, layout, { current: shown.current, start: shown.start, next: shown.next, icons, hedge: false, aurora: shown.aurora !== false,
      prints: shown.prints == null ? null : [shown.prints, shown.prints + 1] }, t);
    const line = lockLine();
    if (line > t.y0) {
      const im = c.getImageData(0, 0, layout.W, h);
      lockPixels(im.data, layout.W, t.y0, line);
      c.putImageData(im, 0, 0);
    }
    if (o.dark) dusk(c, t.y0, h);
    cv.dataset.key = key;
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
    for (const i of tilesNear(tiles, top, bottom, TILE / 2)) paintTile(i);
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
    const land = BOARD_LANDS[layout.landAt(y)];
    const hex = layout.sky && y < layout.sky.y + layout.sky.drop ? land.sky[0] : land.snow && y < layout.bosses[2].y - 400 ? land.snow : land.g;
    const px = new Uint8ClampedArray([parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16), 255]);
    if (y < lockLine()) lockPixels(px, 1, 0, 1e9);
    if (o.dark && layout.landAt(y) !== 'town') for (let k = 0; k < 3; k++) px[k] = Math.round((px[k] * 0.74 + [26, 36, 70][k] * 0.26) * 0.94);
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
        lockPixels(im.data, layout.W, g.y0, 1e9);
        c.putImageData(im, 0, 0);
      }
      if (o.dark && b.kind !== 'wall') duskify(c, layout.W, g.y1 - g.y0);
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
    const next = shown.next, nextBoss = next != null && stoneAt(next).boss;
    wear(ring.small, next, !nextBoss); wear(ring.big, next, !nextBoss);
    wear(ring.sel, selected, selected !== next && selected != null && !stoneAt(selected).boss);
    wear(ring.pointer, selected, true);
  }

  /* A sign steps aside for the team: a boss's own sign while the team
     stands at its gate or just through it (it lay across the handler), and
     every sign near a moment while it plays (the title landed on one). */
  function signs() {
    board.querySelectorAll('.tb-sign').forEach((d) => {
      const boss = Number(d.dataset.boss) || 0;
      let hide = false;
      if (moment) hide = true;
      else if (boss && boss < layout.stones.length) hide = shown.current >= boss - 1 && shown.current <= boss + 1;
      d.classList.toggle('away', hide);
    });
  }

  function teamSpot() { return teamSeat(o.lv, layout); }
  /* The team's look, with the land it stands on: its shadow is that land's
     shadow, and the cold stage is the town or the climb. */
  const LAND_NAME = { hot: 'meadow', warm: 'wood', town: 'town', alp: 'climb' };
  const lookHere = (lv = o.lv) => Object.assign({}, o.look, { land: LAND_NAME[layout.landAt(teamSeat(lv, layout).pt[1])] || 'meadow' });
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
      shown.aurora = shown.current >= layout.stones.length;
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
     burst of confetti. The summit is the same as far as the arrival, then
     has a finale of its own. */
  function levelUpAt(m, t) {
    const sum = m.kind === 'summit';
    const c = MOMENTS[m.kind].cues;
    const top = stoneAt(m.after.current);
    show(Object.assign({ current: t >= c.paw ? m.after.current : m.before.current, next: t >= c.arrive ? m.after.next : m.before.next,
      boss: t >= c.arrive ? m.after.boss : m.before.boss }, sum ? { aurora: t >= c.flare } : {}));
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
    /* The summit has no gate to open: its flag turns gold once the team is
       up there (at the cue of its own, in the finale). */
    if (m.bossK != null) { gateState = { k: m.bossK, open: 1, passed: t >= (sum ? c.flag : c.arrive) }; paintGates(); }
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
      if (t >= c.flag) burst(g, m.gateX + (layout.faceLeft[layout.bosses[m.bossK].level - 1] ? 33 : -13), layout.bosses[m.bossK].y - 44, t - c.flag, STAGE_GLOW.cold, { round: true });
      // The flare keeps to the sky over the team's heads.
      if (layout.sky && t >= c.flare) skyFlare(g, layout.W, 4, Math.max(20, layout.sky.y - 52), t - c.flare);
      if (t >= c.flare) burst(g, top.x, top.y - 4, t - c.flare, [GOLD_SPARK, '#ffffff', '#b4f8c8', '#fff0b0'], { round: true });
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
    lockPixels(im.data, layout.W, y0, b.lock);
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
    /* The last boss stands on the summit with no gate and no land beyond,
       so it is played as a level passed, with its title. */
    const gated = m.kind === 'boss' && b && b.kind !== 'cairn';
    /* The last boss stands on the summit with no gate and no land beyond:
       it is played as a level passed as far as the cairn, and then has the
       summit's own finale. */
    const summit = !!b && b.kind === 'cairn';
    const kind = gated ? 'boss' : summit ? 'summit' : 'levelup';
    moment = { kind, before, after, seatA, seatB, lvAfter: m.after, name: m.name || '', title: m.title || '',
      bossK: b ? bossK : null, gateX: b ? gateX(layout, b) : 0,
      onCue: m.onCue || null, onEnd: m.onEnd || null, fired: {}, locked: null, tick: null };
    const mm = moment;
    const cues = MOMENTS[kind].cues;
    let env;
    if (gated) {
      const s = stoneAt(b.level);
      mm.gateLeft = stoneAt(b.level - 1).x > s.x;
      // At the gate: the gap between the dog and the person sits in the gateway.
      mm.gateFor = (l) => [mm.gateX - (l ? TEAM.w - 1 - REACH.gate : REACH.gate) + (l ? 2 : 0), b.y + 4 - TEAM.ground];
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
      mm.endLeft = summit || Math.abs(over(seatB.left)) <= Math.abs(over(!seatB.left)) ? seatB.left : !seatB.left;
      mm.endShift = summit ? 0 : over(mm.endLeft);
      // A light every six pixels or so of the way, for the trail to come on by.
      mm.dots = [];
      for (let d = 8; d < mm.way.len - 6; d += 6) { const q = along(mm.way, d); q.d = d; q.i = mm.dots.length; mm.dots.push(q); }
      env = { stride: strideFor(mm.way.len, cues.arrive - cues.trot) };
    }
    mm.tick = (t) => (mm.kind === 'boss' ? bossAt(mm, t) : levelUpAt(mm, t));
    o.lv = m.before;
    shown = Object.assign({}, before, { prints: null, aurora: before.current >= layout.stones.length });
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
     the ones it stands on, not the summit's. */
  scrollTo(teamSpot().pt[1], 0.68, false);
  render();
  ambientKick();
  return api;
}
