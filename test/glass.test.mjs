// The real glass (public/glass.js): what the shader is told about each pane.
import assert from 'node:assert/strict';
import { paneBox, parseTint, GLASS_PANES, GLASS_LOOK } from '../public/glass.js';
import { readFileSync } from 'node:fs';

let n = 0;
const t = (name, f) => { f(); n++; };
const view = { left: 0, top: 0, width: 390, height: 844 };
const K = 3, W = 1170, H = 2532;

t('a pill in the middle: centre, half size and radii in picture pixels', () => {
  const b = paneBox({ left: 140, top: 14, right: 250, bottom: 50 }, [999, 999, 999, 999], view, K, W, H);
  assert.deepEqual(b.rect, [195 * K, 32 * K, 55 * K, 18 * K]);
  assert.deepEqual(b.radii, [18 * K, 18 * K, 18 * K, 18 * K]);      // never more than half the short side
  assert.ok(b.bevel > 0 && b.bevel <= 18 * K);
});

t('the bevel grows with the pane and stops at 20 CSS px', () => {
  const small = paneBox({ left: 10, top: 10, right: 120, bottom: 46 }, [18, 18, 18, 18], view, K, W, H);
  const big = paneBox({ left: 16, top: 600, right: 374, bottom: 760 }, [26, 26, 26, 26], view, K, W, H);
  assert.ok(small.bevel < big.bevel);
  assert.equal(big.bevel, 20 * K);
});

t('corners go to the shader as bottom right, top right, bottom left, top left', () => {
  const b = paneBox({ left: 100, top: 100, right: 300, bottom: 300 }, [1, 2, 3, 4], view, 1, 390, 844);
  assert.deepEqual(b.radii, [3, 2, 4, 1]);
});

t('the scissor box is counted from the bottom left and holds the shadow', () => {
  const b = paneBox({ left: 100, top: 100, right: 200, bottom: 150 }, [10, 10, 10, 10], view, 1, 390, 844);
  assert.deepEqual(b.scissor, [66, 844 - 184, 168, 118]);
});

t('the scissor box never leaves the picture', () => {
  const b = paneBox({ left: 0, top: 0, right: 390, bottom: 60 }, [20, 20, 20, 20], view, K, W, H);
  assert.equal(b.scissor[0], 0);
  assert.ok(b.scissor[0] + b.scissor[2] <= W && b.scissor[1] + b.scissor[3] <= H);
});

t('a square edge lying on the screen edge is carried past it, a rounded one is not', () => {
  const sheet = paneBox({ left: 0, top: 644, right: 390, bottom: 844 }, [26, 26, 0, 0], view, 1, 390, 844);
  assert.equal(sheet.rect[1] + sheet.rect[3], 844 + 48);             // bottom carried off the screen
  assert.equal(sheet.rect[0] - sheet.rect[2], 0);                    // left edge has a rounded top corner: it stays
  const card = paneBox({ left: 0, top: 644, right: 390, bottom: 844 }, [26, 26, 26, 26], view, 1, 390, 844);
  assert.equal(card.rect[1] + card.rect[3], 844);
});

t('a canvas that does not start at the corner of the screen', () => {
  const b = paneBox({ left: 120, top: 80, right: 220, bottom: 130 }, [10, 10, 10, 10], { left: 100, top: 50, width: 390, height: 844 }, 2, 780, 1688);
  assert.deepEqual(b.rect, [70 * 2, 55 * 2, 50 * 2, 25 * 2]);
});

t('the panes are the same ones app.css gives the liquid glass to, and each has its marked rule', () => {
  const css = readFileSync(new URL('../public/app.css', import.meta.url), 'utf8');
  for (const sel of GLASS_PANES.split(',').map(s => s.trim())) {
    assert.ok(css.includes(`:root[data-theme="dark"] ${sel},`) || css.includes(`:root[data-theme="dark"] ${sel} {`), `liquid glass rule for ${sel}`);
    assert.ok(css.includes(`:root[data-theme="dark"] ${sel}[data-rg]`), `marked rule for ${sel}`);
  }
});

t('the pane colour is read from the stylesheet token, whatever way it is written', () => {
  assert.deepEqual(parseTint('rgba(0, 70, 160, 0.30)'), [0, 70 / 255, 160 / 255, 0.3]);
  assert.deepEqual(parseTint(' rgb(6 8 12 / 0.2)'), [6 / 255, 8 / 255, 12 / 255, 0.2]);
  assert.deepEqual(parseTint('rgb(255, 0, 0)'), [1, 0, 0, 1]);
  assert.equal(parseTint(''), null);
  assert.equal(parseTint('#0A1E3B'), null);
  const css = readFileSync(new URL('../public/app.css', import.meta.url), 'utf8');
  assert.ok(/--lg-tint:\s*rgba?\(/.test(css), 'app.css still states --lg-tint as rgb or rgba');
});

t('the look is what was shown in the demo', () => {
  assert.deepEqual(GLASS_LOOK, { refraction: 1.0, rainbow: 1.6, frost: 0.12 });
});

t('a video of a replay is copied from the map picture, so the glass is held while the video sheet is open', () => {
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const body = (name) => { const i = app.indexOf(`function ${name}(`); return app.slice(i, app.indexOf('\n}\n', i)); };
  assert.ok(body('openClip').includes('realGlass?.hold(true)'));
  assert.ok(body('closeClip').includes('realGlass?.hold(false)'));
});

t('the glass is the last layer added, and the Look setting reaches it', () => {
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const i = app.indexOf('function addOverlays('), end = app.indexOf('\n}\n', i), body = app.slice(i, end);
  assert.ok(body.lastIndexOf('add(realGlass.layer)') > body.lastIndexOf("add({ id:"), 'no style layer is added after the glass');
  assert.ok(app.includes("realGlass?.setOn(settings.glass !== 'blur')"));
});

console.log(`glass.test: ${n} passed`);
