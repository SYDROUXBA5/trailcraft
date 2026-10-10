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

import { createTeam, TEAM, ANCHOR, MOMENTS, ICONS, gateOpen, boardLayout, boardTiles, tilesNear, drawBoard, drawBarrier, barrierBand,
         trailPoint, throughGate, gateX, ringArt, stamp, plaqueSize, drawPlaque, lockPixels, unlockWood, duskify, crispURL, BOARD_LANDS } from './pixel-team.js';
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
  { kind: 'hot', text: `Red meadow · ${stageLabel('hot')}` },
  { kind: 'warm', text: `Amber wood · ${stageLabel('warm')}` },
  { kind: 'cold', text: `Blue town · ${stageLabel('cold')}` },
  { kind: 'cold', text: `The climb · ${stageLabel('cold')}` },
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
    seg = n === 1 ? -0.5 : n - 2 + (b ? throughGate(b.kind) : 0.35);
  }
  const pt = trailPoint(layout, 0, seg);
  let left = layout.faceLeft[clamp(Math.floor(seg + 1e-6), 0, N - 1)];
  if (seg !== Math.round(seg)) {
    /* Between two stones the next one is close, and the dog, leading off
       towards it, would stand on its ring. The team turns the other way
       when that keeps the stone in sight and there is room. */
    const nx = layout.stones[Math.floor(seg) + 1];
    const covers = (l) => !!nx && Math.abs(nx.y - pt[1]) < 30 && (l ? nx.x < pt[0] - 12 && nx.x > pt[0] - 66 : nx.x > pt[0] + 12 && nx.x < pt[0] + 66);
    const fits = (l) => (l ? pt[0] - 71 >= 0 : pt[0] + 71 <= layout.W);
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
 *                   played over the result): its stones cannot be tapped }
 *
 * Returns { update(opts), select(level | null), home(smooth), play(moment),
 * skip(), playing, team, layout, teamSpot(), destroy() }. `team` is the
 * pixel-team player; `teamSpot()` is where it stands, in art pixels.
 */
export function mountBoard(host, opts = {}) {
  const o = Object.assign({ lv: null, look: {}, motion: true, dark: false, imperial: false, onPick: null, still: false }, opts);
  const dpr = Math.max(1, Math.round(window.devicePixelRatio || 1));
  const icons = {};
  for (const l of LADDER_V1.levels) icons[l.level] = WAVE_ICON[l.waveKey] || 'ruler';

  host.textContent = '';
  const board = el('div', 'tb-board');
  const teamCanvas = el('canvas', 'tb-team');
  const sweepCanvas = el('canvas', 'tb-layer tb-sweep');
  const stampCanvas = el('canvas', 'tb-layer tb-stamp');
  const ribbon = el('div', 'tb-ribbon');
  for (const c of [teamCanvas, sweepCanvas, stampCanvas]) c.setAttribute('aria-hidden', 'true');
  ribbon.setAttribute('aria-hidden', 'true');
  sweepCanvas.style.display = 'none'; stampCanvas.style.display = 'none'; ribbon.style.display = 'none';
  stampCanvas.width = 36; stampCanvas.height = 36;
  stampCanvas.style.width = 36 * SCALE + 'px'; stampCanvas.style.height = 36 * SCALE + 'px';
  board.append(sweepCanvas, stampCanvas, teamCanvas, ribbon);
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

    const ringS = ringArt(false), ringB = ringArt(true), ringSel = ringArt(true);
    const sc = ringSel.getContext('2d');
    sc.globalCompositeOperation = 'source-in'; sc.fillStyle = '#f4f6fa'; sc.fillRect(0, 0, ringSel.width, ringSel.height);
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
    ring = { small: img(ringS, 'tb-ring cur small', 12, 8), big: img(ringB, 'tb-ring cur big', 12, 8), sel: img(ringSel, 'tb-ring sel', 12, 8), pointer };

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
      const pl = img({ width: pw, height: ph }, 'tb-plaque', pw >> 1, s.boss ? -10 : -6);
      b.appendChild(pl);
      plaqueEls.push(pl);
      b.addEventListener('click', () => { rover = s.level; if (o.onPick && !moment) o.onPick(s.level); });
      board.appendChild(b);
      return b;
    });

    /* Signs: each land's name where it starts, each boss's by its gate. A
       sign keeps to the side the trail and the team are not on. */
    const sign = (kind, text, y, side) => {
      const d = el('div', `tb-sign ${kind} ${side}`);
      d.textContent = text;
      d.style.top = y * SCALE + 'px';
      board.appendChild(d);
    };
    const away = (y) => (layout.xAt[clamp(Math.round(y), 0, layout.H)] > layout.W / 2 ? 'left' : 'right');
    sign(LAND_SIGNS[0].kind, LAND_SIGNS[0].text, stoneAt(1).y + 72, 'mid');
    layout.bosses.forEach((b, k) => {
      const last = k === layout.bosses.length - 1;
      const name = `Boss · ${levelSpec(b.level).bossName}`;
      if (last) { sign('boss', name, b.y - 64, 'mid'); return; }
      /* The team waits just through the gate, facing on: the sign goes behind it. */
      sign('boss', name, b.y - (b.kind === 'wall' ? 80 : 60), layout.faceLeft[b.level - 1] ? 'right' : 'left');
      const land = LAND_SIGNS[k + 1], y = b.y - (b.kind === 'wall' ? 122 : 102);
      if (land) sign(land.kind, land.text, y, away(y + 6));
    });
  }

  /* ── Painting ── */

  /* The row the lit land ends on: everything above the boss still to beat. */
  const lockLine = () => {
    const b = layout.bosses.find(x => x.level === shown.boss);
    // Nothing lies beyond the last boss: the sky over the summit is never dimmed.
    return b && b.kind !== 'cairn' ? b.lock : -1;
  };
  const artKey = () => [shown.current, shown.start, shown.next, shown.boss, shown.prints, o.dark, layout.W].join('/');

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
    drawBoard(c, layout, { current: shown.current, start: shown.start, next: shown.next, icons, hedge: false,
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
      drawPlaque(big.getContext('2d'), level, status, levelSpec(level).boss);
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

  function teamSpot() { return teamSeat(o.lv, layout); }
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
      const seat = teamSpot();
      shown.prints = shown.next == null ? null : Math.floor(seat.seg + 1e-6);
    }
    stones();
    paintTiles();
    paintGates();
    if (!moment) {
      team.set({ look: o.look, motion: o.motion, state: restState() });
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
  /* A pop: 0.85, up past 1 to 1.08, then back to 1. */
  const pop = (T) => (T < 0 || T >= 380 ? 1 : T < 133 ? 0.85 + 0.23 * T / 133 : 1.08 - 0.08 * (T - 133) / 247);

  /* The stamp: the paw lands at twice size, then a ring of gold steps out. */
  function stampAt(T, s) {
    if (T < 0 || T > 600) { stampCanvas.style.display = 'none'; return; }
    stampCanvas.style.display = 'block';
    stampCanvas.style.left = (s.x - 18) * SCALE + 'px'; stampCanvas.style.top = (s.y - 18) * SCALE + 'px';
    const c = stampCanvas.getContext('2d');
    c.clearRect(0, 0, 36, 36);
    if (T < 140) {
      c.fillStyle = '#1c1411';
      ICONS.paw.forEach((r, y) => { for (let x = 0; x < r.length; x++) if (r[x] !== '.') c.fillRect(11 + x * 2, 10 + y * 2, 4, 4); });
      c.fillStyle = '#f2c14e';
      ICONS.paw.forEach((r, y) => { for (let x = 0; x < r.length; x++) if (r[x] !== '.') c.fillRect(12 + x * 2, 11 + y * 2, 2, 2); });
      return;
    }
    const r = [9, 12, 15, 17][Math.min(3, Math.floor((T - 140) / 115))];
    c.fillStyle = T > 480 ? '#fff3c4' : '#f2c14e';
    let last = null;
    for (let a = 0; a < 360; a += 4) {
      const x = 18 + Math.round(r * Math.cos(a * Math.PI / 180)), y = 18 + Math.round(r * 0.62 * Math.sin(a * Math.PI / 180));
      if (last && last[0] === x && last[1] === y) continue;
      last = [x, y];
      if (T > 480 && (x + y) % 2) continue;
      c.fillRect(x, y, 1, 1);
    }
  }
  function ribbonAt(text, cls, x, y, k) {
    if (!text) { ribbon.style.display = 'none'; return; }
    if (ribbon.textContent !== text) ribbon.textContent = text;
    ribbon.className = 'tb-ribbon ' + cls;
    ribbon.style.display = 'block';
    ribbon.style.left = clamp(x * SCALE, 78, layout.W * SCALE - 78) + 'px';
    ribbon.style.top = y * SCALE + 'px';
    ribbon.style.transform = `translateX(-50%) scale(${k.toFixed(3)})`;
  }
  const cue = (m, name) => { if (!m.fired[name]) { m.fired[name] = true; if (m.onCue) m.onCue(name); } };

  /* A level passed: the paw lands on its stone, the new name pops up over
     it, and the team trots on to stand there. */
  function levelUpAt(m, t) {
    const c = MOMENTS.levelup.cues;
    const top = stoneAt(m.after.current);
    show({ current: t >= c.paw ? m.after.current : m.before.current, next: t >= c.arrive ? m.after.next : m.before.next,
      boss: t >= c.arrive ? m.after.boss : m.before.boss });
    stampAt(t - c.paw, top);
    if (t >= c.name) cue(m, 'name');
    if (m.title && t >= c.arrive) cue(m, 'title');
    // The name sits over the stone, and leaves before the team gets there.
    ribbonAt(t >= c.name && (t < c.trot + 400 || t >= c.arrive + 250) ? (t >= c.arrive ? m.title || m.name : m.name) : '',
      t >= c.arrive && m.title ? 'boss' : '', top.x, top.y - (t >= c.arrive ? 58 : 26), pop(t - (t >= c.arrive ? c.arrive + 250 : c.name)));
    const u = clamp((t - c.trot) / (c.arrive - c.trot), 0, 1);
    const left = u >= 1 ? m.seatB.left : m.seatA.left;
    const seg = m.seatA.seg + (m.seatB.seg - m.seatA.seg) * u;
    const pt = u <= 0 ? m.seatA.pt : u >= 1 ? m.seatB.pt : trailPoint(layout, 0, seg);
    placeAt(teamBox(pt, left), left);
    if (o.motion && u > 0 && u < 1) scrollTo(pt[1], 0.62, false);
    /* The summit has no gate to open: its flag turns gold as the team arrives. */
    if (m.bossK != null) { gateState = { k: m.bossK, open: 1, passed: t >= c.arrive }; paintGates(); }
    if (t >= c.buzz) cue(m, 'buzz');
  }

  /* A boss beaten: the trot to the gate, the find, the next land lighting
     up from the gate upward, the gate swinging, the team going through,
     then the title. */
  function bossAt(m, t) {
    const c = MOMENTS.boss.cues;
    const b = layout.bosses[m.bossK], s = stoneAt(b.level);
    const left = stoneAt(b.level - 1).x > s.x;
    const home = teamBox(m.seatA.pt, left);
    // At the gate: the gap between the dog and the person sits in the gateway.
    const gateFor = (l) => [m.gateX - (l ? TEAM.w - 1 - 75 : 75) + (l ? 2 : 0), b.y + 4 - TEAM.ground];
    const gate = gateFor(left);
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
      box = lerpBox(gateFor(flip), beyond, u);
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
    ribbonAt(t >= c.title ? m.title : '', 'boss', s.x, b.y - 96, pop(t - c.title));
    if (t >= c.buzz) cue(m, 'buzz');
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
    sweepCanvas.style.display = 'none'; stampCanvas.style.display = 'none';
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
    moment = { kind: gated ? 'boss' : 'levelup', before, after, seatA, seatB, lvAfter: m.after, name: m.name || '', title: m.title || '',
      bossK: b ? bossK : null, gateX: b ? gateX(layout, b) : 0,
      onCue: m.onCue || null, onEnd: m.onEnd || null, fired: {}, locked: null, tick: null };
    const mm = moment;
    mm.tick = (t) => (mm.kind === 'boss' ? bossAt(mm, t) : levelUpAt(mm, t));
    o.lv = m.before;
    shown = Object.assign({}, before, { prints: null });
    stones(); paintTiles(); paintGates();
    if (gated) {
      /* Still, it goes straight to the gate; moving, it starts on the team
         (bossAt scrolls with it). */
      scrollTo(o.motion ? seatA.pt[1] : b.y, 0.72, false);
      mm.locked = lockedAbove(b, before);
    } else scrollTo(seatA.pt[1], 0.62, false);
    if (!o.motion) {
      mm.tick(MOMENTS[mm.kind].duration);
      const top = stoneAt(after.current);
      ribbonAt(mm.title || mm.name, mm.title ? 'boss' : '', top.x, seatB.pt[1] - 56, 1);
      finish();
      return api;
    }
    team.set({ motion: true, look: o.look, state: mm.kind });
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
  return api;
}
