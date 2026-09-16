/* The markup and the code that reaches into it, checked against each other.

   app.js finds every element with $('someId'). When markup changes and a
   reference is left behind, $ returns null and the very next .addEventListener
   throws — which aborts wire() partway through, so every control AFTER the
   stale one silently stops working. The app still loads and still looks right,
   which is the worst way for something to be broken.

   That has happened here, so it is pinned: every id app.js reaches for must
   exist in index.html, and nothing is allowed to drift again. */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log(`  ok  ${name}`); };

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const js = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

/** Ids the markup actually defines, static ones and any the code writes. */
const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
const jsMadeIds = new Set([...js.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));

/** Every $('...') lookup in app.js, with the line it is on. */
const lookups = [];
const lines = js.split('\n');
lines.forEach((line, i) => {
  for (const m of line.matchAll(/\$\('([A-Za-z][\w-]*)'\)/g)) lookups.push({ id: m[1], line: i + 1 });
});

t('every id app.js reaches for exists in the markup', () => {
  assert.ok(lookups.length > 80, `expected a lot of lookups, found ${lookups.length}`);
  const missing = lookups.filter(l => !htmlIds.has(l.id) && !jsMadeIds.has(l.id));
  assert.deepEqual(missing, [],
    missing.map(m => `app.js:${m.line} looks for #${m.id}, which no longer exists`).join('\n'));
});

t('wire() reaches nothing that the markup does not define', () => {
  /* wire() is the dangerous one: it runs once at boot, and a throw inside it
     takes every listener after that line with it. */
  const start = js.indexOf('\nfunction wire() {');
  assert.ok(start > 0, 'wire() is still where the test expects it');
  const body = js.slice(start, js.indexOf('\n}', js.lastIndexOf('addEventListener', js.indexOf('\n/* ── Boot', start))));
  const wired = [...body.matchAll(/\$\('([A-Za-z][\w-]*)'\)\s*\.addEventListener/g)].map(m => m[1]);
  assert.ok(wired.length > 30, `expected many listeners, found ${wired.length}`);
  const orphans = [...new Set(wired)].filter(id => !htmlIds.has(id));
  assert.deepEqual(orphans, [],
    `wire() attaches listeners to elements the markup does not have: ${orphans.join(', ')}`);
});

t('nothing calls window.prompt — it is blocked in a home-screen web app', () => {
  /* iOS refuses prompt() outright when the app is launched from the Home
     Screen, which is where this one lives. A control built on it looks like
     it does nothing at all. */
  const bad = [];
  lines.forEach((line, i) => {
    if (/(^|[^.\w])prompt\s*\(/.test(line) && !/\/\//.test(line.slice(0, line.search(/prompt\s*\(/)))) {
      bad.push(`app.js:${i + 1}`);
    }
  });
  assert.deepEqual(bad, [], `prompt() cannot be used here: ${bad.join(', ')}`);
});

t('every module the app imports is cached for offline use', () => {
  /* A module missing from the service worker's shell is invisible online and
     fatal offline: the import fails and the app never starts — in a field,
     with no signal, which is the one place this app has to work. */
  const sw = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
  const shell = sw.slice(sw.indexOf('const SHELL'), sw.indexOf('];', sw.indexOf('const SHELL')));
  const cached = new Set([...shell.matchAll(/'([\w./-]+\.js)'/g)].map(m => m[1]));

  const pub = new URL('../public/', import.meta.url);
  const imported = new Set(['app.js']);
  for (const f of readdirSync(pub).filter(n => n.endsWith('.js'))) {
    const src = readFileSync(new URL(f, pub), 'utf8');
    for (const m of src.matchAll(/from '\.\/([\w-]+\.js)'/g)) imported.add(m[1]);
  }
  const missing = [...imported].filter(m => !cached.has(m));
  assert.deepEqual(missing, [], `imported but not cached offline: ${missing.join(', ')}`);
});

console.log(`\n${pass} passed total\n`);
