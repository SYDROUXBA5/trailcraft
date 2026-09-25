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

/* ── What a screen reader is told ────────────────────────────────── */

const css = readFileSync(new URL('../public/app.css', import.meta.url), 'utf8');
/** The body of the first rule whose selector is exactly this, inside the given CSS. */
function rule(sel, src = css) {
  const m = src.match(new RegExp(`(^|\\n)\\s*${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`));
  assert.ok(m, `app.css still has ${sel}`);
  return m[2];
}
/** The inside of an @media block that starts with this head. */
function media(head) {
  const i = css.indexOf(head);
  assert.ok(i >= 0, `app.css still has ${head}`);
  let depth = 0, j = css.indexOf('{', i);
  for (let k = j; k < css.length; k++) {
    if (css[k] === '{') depth++;
    else if (css[k] === '}' && --depth === 0) return css.slice(j + 1, k);
  }
  throw new Error(`${head} never closes`);
}

t('the toast is a live region that is always in the page', () => {
  assert.match(html, /<div id="toast" class="toast" role="status" aria-live="polite" aria-atomic="true"><\/div>/);
  const body = js.slice(js.indexOf('const toast = (msg) => {'), js.indexOf('\n};', js.indexOf('const toast = (msg) => {')));
  assert.ok(!/\.hidden\b/.test(body), 'the toast is never hidden: a hidden live region is not listened to');
  assert.match(body, /t\.classList\.remove\('show'\);\s*toast\._gone = setTimeout\(\(\) => \{ t\.textContent = ''; \}/,
    'it fades, then empties, so nothing stale is left to find');
  assert.ok(!/visibility/.test(rule('.toast')) && !/visibility/.test(rule('.toast.show')),
    'visibility: hidden takes it out of what a screen reader can hear, the same as hidden');
});

t('a toast stays up long enough to read', () => {
  const line = js.match(/^const toastMs = .*$/m)?.[0];
  assert.ok(line, 'app.js has toastMs');
  const toastMs = new Function(`${line}; return toastMs;`)();
  assert.equal(toastMs('Saved'), 3000, 'never under three seconds');
  assert.equal(toastMs('x'.repeat(25)), 3000);
  assert.equal(toastMs('x'.repeat(50)), 4500, 'a second and a half, and 60 ms a character');
  const long = 'Signed in. This phone’s records belong to another account, so nothing was backed up';
  assert.equal(toastMs(long), 1500 + 60 * long.length);
  assert.match(js, /\}, toastMs\(msg\)\);/, 'the toast uses it');
});

t('on a narrow phone a toast goes across the screen, under the air panel', () => {
  const narrow = media('@media (max-width: 480px) {\n  .toast');
  const r = rule('.toast', narrow);
  assert.match(r, /max-width: calc\(100vw - 24px\)/);
  assert.match(r, /top: calc\(var\(--top-row\) \+ var\(--wx-gap, 0px\)\)/, 'below the wind, not on top of it');
  assert.match(js, /setProperty\('--wx-gap', on \? `\$\{Math\.round\(p\.offsetHeight\) \+ 8\}px` : '0px'\)/, 'the gap is still measured');
});

t('a new screen puts focus on its heading, without scrolling or a ring', () => {
  const f = fnSrc('function focusScreen(id)');
  assert.match(f, /querySelector\('h1, h2, \.hud-pill, \.nav-banner'\)/);
  const go = fnSrc('function go(id, { back = false } = {})');
  assert.match(go, /const from = currentScreen;/);
  assert.match(go, /if \(id !== from && !mapTut\.open\) focusScreen\(id\);\n\}$/, 'last, and only when the screen changes');
  assert.match(css, /\.screen \[tabindex="-1"\]:focus \{ outline: none; \}/);

  // Run for real against a small fake of a screen.
  const made = (head) => {
    const attrs = new Map(), focused = [];
    const h = head && {
      hasAttribute: (a) => attrs.has(a), setAttribute: (a, v) => attrs.set(a, v),
      focus: (o) => focused.push(o),
    };
    const screen = { querySelector: () => h };
    return { screen, attrs, focused };
  };
  const run = (el) => new Function('$', `${f}; focusScreen('scrX');`)(() => el.screen);
  const a = made(true);
  run(a);
  assert.equal(a.attrs.get('tabindex'), '-1');
  assert.deepEqual(a.focused, [{ preventScroll: true }], 'the map and the page stay where they are');
  const b = made(false);
  run(b);                                     // a screen with nothing to stand on is left alone
  assert.deepEqual(b.focused, []);
});

/* ── Larger text, and zoom ─────────────────────────────────────────── */

/** Every font size the stylesheet sets: the innermost selector, and the size as written. */
function fontSizes() {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  const found = [], stack = [];
  let from = 0;
  for (let i = 0; i < bare.length; i++) {
    const c = bare[i];
    if (c === '{') { stack.push(bare.slice(from, i).trim().replace(/\s+/g, ' ')); from = i + 1; }
    else if (c === '}') { stack.pop(); from = i + 1; }
    else if (c === ';') {
      const d = bare.slice(from, i).trim();
      const m = d.match(/^font(-size)?\s*:\s*(.*)$/);
      if (m) {
        // The size in a shorthand is the part before the family: a length, a calc() or a max().
        const size = m[1] ? m[2] : (m[2].match(/(max\([^;]*?\)\)|calc\([^)]*\)|\d+(\.\d+)?px)/)?.[0] ?? null);
        if (size) found.push({ sel: stack.at(-1) ?? '', size: size.trim(), at: stack.slice(0, -1).join(' ') });
      }
      from = i + 1;
    }
  }
  return found;
}
const sizes = fontSizes();

t('pinch zoom is allowed, in Safari and in the iPhone app', () => {
  const vp = html.match(/<meta name="viewport" content="([^"]+)">/)?.[1];
  assert.ok(vp, 'index.html has a viewport');
  assert.ok(!/maximum-scale|user-scalable/.test(vp), `the viewport does not stop zooming: ${vp}`);
  assert.match(vp, /width=device-width/);
  const cap = JSON.parse(readFileSync(new URL('../capacitor.config.json', import.meta.url), 'utf8'));
  assert.equal(cap.ios?.zoomEnabled, true, 'Capacitor blocks zooming in the app unless ios.zoomEnabled says otherwise');
  assert.match(css, /button, \[role="button"\], summary \{ touch-action: manipulation; \}/, 'a double tap on a button is two presses, not a zoom');
});

t('no field is small enough for the iPhone to zoom into it', () => {
  /* Safari on an iPhone zooms the page when a field under 16px takes focus,
     and now that zoom is allowed it would. At a smaller-than-usual text size
     a scaled field would drop under 16px, so every one has a floor. */
  const fields = sizes.filter(f => /\b(input|select|textarea)\b/.test(f.sel) && !/range|checkbox|color|file/.test(f.sel));
  assert.ok(fields.length >= 3, `expected the field rules, found ${fields.map(f => f.sel).join(' | ')}`);
  for (const f of fields) {
    const px = f.size.match(/^(\d+(\.\d+)?)px$/)?.[1];
    assert.ok(px ? +px >= 16 : /^max\(16px, /.test(f.size), `${f.sel} is at least 16px (${f.size})`);
  }
  const base = fields.find(f => f.sel.startsWith('input[type="text"]'));
  for (const type of ['text', 'email', 'password', 'number', 'date']) assert.ok(base.sel.includes(`input[type="${type}"]`), `${type} fields share the base rule`);
  assert.ok(base.sel.includes('select'));
  // Every text field in the page is one of those types.
  for (const [, type] of html.matchAll(/<input[^>]*type="([a-z-]+)"/g)) {
    assert.ok(['text', 'email', 'password', 'number', 'date', 'range', 'checkbox', 'file'].includes(type), `an <input type="${type}"> has no 16px rule`);
  }
  assert.ok(!/<textarea/.test(html + js), 'a textarea would need its own 16px rule');
});

t('the paper screens grow with the iPhone’s Larger Text; the map screens do not', () => {
  assert.match(css, /@supports \(font: -apple-system-body\) and \(-webkit-touch-callout: none\) \{\s*html \{ font: -apple-system-body; \}\s*:root \{ --px: min\(calc\(1rem \/ 17\), calc\(28px \/ 17\)\); \}\s*body \{ font-family: var\(--body\); \}/,
    'the root takes the system body size on an iPhone only, and the app keeps its own typeface');
  assert.match(css, /--px: min\(calc\(1rem \/ 16\), calc\(28px \/ 17\)\);/, 'elsewhere a pixel of type is a pixel');
  assert.match(css, /html \{ font: 16px\/1\.5 var\(--body\); \}\nbody \{ font: calc\(16 \* var\(--px\)\)\/1\.5 var\(--body\); \}/);
  assert.match(css, /\n\.screen\.glass \{ --px: 1px; font-size: 16px; \}/);
  assert.match(css, /\nbody:has\(> \.screen\.glass:not\(\[hidden\]\)\) \{ --px: 1px; font-size: 16px; \}/,
    'on its own line: a selector list with :has in it is dropped whole where :has is unknown');

  /* A size in plain pixels is only for what floats over the live map, or is
     drawn to fit a fixed shape. Anything else is in pixels of type, so a new
     rule on a paper screen that forgets cannot slip past. */
  const PLAIN = new Set([
    'html', '.hud-pill', '.glass-caption', '.wp-pill', '.rep-play, .rep-speed', '.rep-play',
    '.bench-head b', '.bench-head i', '.bench-read', '.fix-range label', '.fix-nudge', '.fix-label', '.fix-row b', '.fix-row i',
    '.bench-grp > summary::after', '.bench-grp b', '.bench-grp .cnt', '.bench-grp .why', '.dial .nm', '.dial .val', '.dial .note', '.badge',
    '.nav-dist b', '.nav-dist i', '.nav-say > span', '.nav-say .nav-sub',
    '.wx-main b', '.wx-main i', '.wx-sub b', '.wx-sub i', '.wx-note i',
    '.map-tut-card > b', '.map-tut-card > p', '.style-pick button', '.btn.live-btn', '.call-q', '.call-opt b', '.call-opt i',
    '.tut-title.huge', '.ring-big', '.ring-small', '.ava', '.ava.big', '.auth-btn',
    '.screen.glass', 'body:has(> .screen.glass:not([hidden]))',
  ]);
  const plain = sizes.filter(f => /^\d+(\.\d+)?px$/.test(f.size));
  const stray = plain.filter(f => !PLAIN.has(f.sel)).map(f => `${f.sel} (${f.size})`);
  assert.deepEqual(stray, [], 'these paper-screen sizes are in plain pixels and will not grow');
  const scaled = sizes.filter(f => /var\(--px\)/.test(f.size));
  assert.ok(scaled.length > 70, `most sizes grow; found ${scaled.length}`);
  for (const f of scaled.filter(f => PLAIN.has(f.sel))) assert.fail(`${f.sel} sits over the map and must stay in pixels`);
});

t('the forecast note on the air panel can be read', () => {
  const r = rule('.wx-note i');
  const px = +r.match(/font-size: (\d+(\.\d+)?)px/)[1];
  assert.ok(px >= 12, `at least 12px, not ${px}`);
  assert.ok(!/opacity/.test(r), 'at full strength over the imagery');
});

t('a large text size cannot push a screen sideways', () => {
  // The rows that used to hold their width whatever the type size.
  assert.match(css, /\.home-head \{ display: flex; flex-wrap: wrap;/);
  assert.match(css, /\.home-head > :last-child \{ margin-left: auto; \}/);
  assert.match(rule('.grid2'), /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(rule('.grid2 > div'), /overflow-wrap: anywhere/);
  assert.match(css, /\.mode-cards \{ display: flex; flex-wrap: wrap;/);
  assert.match(css, /\.mode-cards > \.radio-card \{ flex: 1 1 7em; \}/);
  assert.match(css, /\.dog-head > div \{ min-width: 0; \}/);
});

console.log(`\n${pass} passed total\n`);
