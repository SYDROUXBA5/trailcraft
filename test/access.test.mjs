/* What a screen reader hears, and what a phone set to larger text shows.

   None of it can be seen on screen by the person who builds the app, which is
   exactly why it drifts: a chip lit in moss looks chosen, and nobody notices
   that VoiceOver says "Rex, button" and nothing more. So the markup, the code
   that paints it and the stylesheet are read here and held to what a handler
   who cannot see the screen, or cannot read small type, needs from them. */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log(`  ok  ${name}`); };

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const js = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

/** A top-level function or arrow in app.js, from its head to the brace that closes it at the margin. */
function fnSrc(head) {
  const i = js.indexOf(`\n${head}`);
  assert.ok(i >= 0, `app.js still has ${head}`);
  const j = js.indexOf('\n}', i + 1);
  return js.slice(i, j + 2);
}

/* ── Which one is chosen ─────────────────────────────────────────── */

t('every chip that can be chosen says whether it is', () => {
  /* Each row the code draws: the chip, and the test that lights it. The same
     test has to feed aria-pressed, or the eye and the ear disagree. */
  const rows = [
    ['data-handler', 'h.id === handler.id'],
    ['data-dog', 'd.id === dog?.id'],
    ['data-target', 't.id === target.id'],
    ['data-odour=', '!custom && o === odour'],
    ['data-odour-other', 'custom'],
    ['data-trail-level', 'l.id === S.level.id'],
    ['data-layer=""', '!layer'],
    ['data-layer="${esc(l.id)}"', 'l.id === layer?.id'],
    ['data-flag', 'd.flags.includes(f.v)'],
    ['data-notetag', 'd.noteTag === t.v'],
    ['data-pick', 'd[f.id] === o.v'],
    ['data-seen', 'dbSeen?.[f.id] === o.v'],
    ['data-colour', 'c.hex === cur'],
  ];
  for (const [attr, test] of rows) {
    const line = js.split('\n').find(l => l.includes(attr) && l.includes('<button'));
    assert.ok(line, `app.js still draws the ${attr} chips`);
    assert.ok(line.includes(`aria-pressed="\${${test}}"`), `the ${attr} chip says aria-pressed from ${test}`);
  }
});

t('chips repainted in place are pressed as they are lit', () => {
  assert.match(js, /const pressed = \(b, on, cls = 'selected'\) => \{\s*b\.classList\.toggle\(cls, on\);\s*b\.setAttribute\('aria-pressed', String\(on\)\);/);
  for (const [fn, call] of [
    ['function paintStylePick()', /pressed\(b, b\.dataset\.style === settings\.mapStyle\)/],
    ['function paintDogSex()', /pressed\(b, b\.dataset\.sex === obDogSex\)/],
    ['function paintDogUnits()', /pressed\(b, \(b\.dataset\.units === 'imperial'\) === im, 'on'\)/],
    ['function paintAge()', /pressed\(b, mine\)/],
    ['function paintCoachControls()', /pressed\(chip, opts\[i\] === settings\.coachTol\)/],
  ]) assert.match(fnSrc(fn), call, `${fn} keeps aria-pressed in step`);
  assert.match(js, /\[data-trail-style\]'\)\.forEach\(b => pressed\(b, /);
  assert.match(js, /\[data-dog-style\]'\)\.forEach\(b => pressed\(b, /);
  // The static chips start out saying what they show.
  assert.match(html, /class="age-chip selected" data-age="10" aria-pressed="true"/);
  for (const a of ['0', '5', 'custom']) assert.match(html, new RegExp(`data-age="${a}" aria-pressed="false"`));
});

t('the cards that work as radio buttons are radio buttons', () => {
  const cards = [...html.matchAll(/<button[^>]*class="radio-card[^"]*"[^>]*>/g)].map(m => m[0]);
  assert.equal(cards.length, 5, 'three trail levels and the two kinds of run');
  for (const c of cards) {
    assert.match(c, /role="radio"/, c);
    assert.match(c, /aria-checked="(true|false)"/, c);
  }
  assert.match(html, /id="obDogLevel" role="radiogroup" aria-labelledby="obDogLevelLabel"/);
  assert.match(html, /id="obDogLevelLabel"[^>]*>Trail level</);
  assert.match(html, /id="coachModeRow" role="radiogroup"/);
  assert.match(fnSrc('function paintDogLevel()'), /b\.setAttribute\('aria-checked', String\(on\)\)/);
  assert.match(fnSrc('function paintCoachControls()'), /b\.setAttribute\('aria-checked', String\(sel\)\)/);
});

t('the two GPS filters are named by their labels', () => {
  assert.match(html, /<label class="field-label" for="accCap">Reject GPS fixes worse than/);
  assert.match(html, /<label class="field-label" for="stillCap">Ignore movement under/);
  // Every label that points somewhere points at something that exists.
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
  for (const [, f] of html.matchAll(/<label[^>]*\bfor="([^"]+)"/g)) assert.ok(ids.has(f), `label for="${f}" has a field`);
});

console.log(`\n${pass} passed total\n`);
