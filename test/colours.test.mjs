import assert from 'node:assert/strict';
import { mix, luminance, plumePalette, stepPalette, isHex, COLOUR_PRESETS } from '../public/colours.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log(`  ok  ${name}`); };

t('mixing: halfway between black and white is mid grey, and the ends are the ends', () => {
  assert.equal(mix('#000000', '#FFFFFF', 0.5), '#808080');
  assert.equal(mix('#F5D14A', '#FFFFFF', 0), '#F5D14A');
  assert.equal(mix('#F5D14A', '#FFFFFF', 1), '#FFFFFF');
});

t('luminance: white is 1, black is 0, gold is light and navy is dark', () => {
  assert.ok(Math.abs(luminance('#FFFFFF') - 1) < 1e-9);
  assert.equal(luminance('#000000'), 0);
  assert.ok(luminance('#F5D14A') > 0.5);
  assert.ok(luminance('#0B1630') < 0.05);
});

t('footprints: a light print gets a dark edge, a dark print a light one, a bad colour falls back', () => {
  assert.equal(stepPalette('#F5D14A').halo, '#0B1630');
  assert.match(stepPalette('#0B1630').halo, /255, 255, 255/);
  assert.equal(stepPalette('nonsense').base, '#0B1630');
  assert.notEqual(stepPalette('#0B1630').lit, '#0B1630', 'the walking step is visibly different');
});

t('plume: darker at the edge, lighter against the line, from any base', () => {
  const p = plumePalette('#4FD1FF');
  assert.ok(luminance(p.dark) < luminance(p.base) && luminance(p.base) < luminance(p.light));
  assert.equal(plumePalette('oops').base, '#F5D14A');
});

t('presets are valid hex and unique', () => {
  assert.ok(COLOUR_PRESETS.every(c => isHex(c.hex)));
  assert.equal(new Set(COLOUR_PRESETS.map(c => c.hex)).size, COLOUR_PRESETS.length);
});

console.log(`\n${pass} passed total\n`);
