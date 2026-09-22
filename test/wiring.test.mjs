/* The markup and the code that reaches into it, checked against each other.

   app.js finds every element with $('someId'). When markup changes and a
   reference is left behind, $ returns null and the very next .addEventListener
   throws — which aborts wire() partway through, so every control AFTER the
   stale one silently stops working. The app still loads and still looks right,
   which is the worst way for something to be broken.

   That has happened here, so it is pinned: every id app.js reaches for must
   exist in index.html, and nothing is allowed to drift again. */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

  /* The Desktop single-file copy inlines a fixed list of modules. One that
     app.js imports but the list forgets is a ReferenceError on open — which
     is how the Desktop copy shipped broken for a day after sign-in landed. */
  const build = readFileSync(new URL('../scripts/build-single.mjs', import.meta.url), 'utf8');
  const bundled = new Set([...build.match(/const MODULES = \[([^\]]+)\]/)[1].matchAll(/'([\w-]+)'/g)].map(m => `${m[1]}.js`));
  const forgotten = [...imported].filter(m => m !== 'app.js' && !bundled.has(m));
  assert.deepEqual(forgotten, [], `imported but left out of the single-file build: ${forgotten.join(', ')}`);
});

t('a ::before or ::after placed absolutely stays inside its own element', () => {
  /* An absolutely placed pseudo-element is laid out against the nearest
     POSITIONED ancestor. If its host is not positioned it escapes: the chips'
     glass rim (inset 0, corners inherited from a 999px pill) grew to the size
     of the whole screen, and a dozen of them stacked into one big outline —
     a black arc on the light theme, a white ring on the dark one. No DOM query
     finds it, because a pseudo-element is not an element. */
  const css = readFileSync(new URL('../public/app.css', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map(m => ({ sels: m[1].split(',').map(s => s.trim()), body: m[2] }));
  const positioned = new Set(rules
    .filter(r => /position:\s*(relative|absolute|fixed|sticky)/.test(r.body))
    .flatMap(r => r.sels));
  const escaping = rules
    .filter(r => /position:\s*absolute/.test(r.body))
    .flatMap(r => r.sels)
    .map(s => s.match(/^(.+?)::?(?:before|after)$/))
    .filter(m => m && !positioned.has(m[1]))
    .map(m => m[0]);
  assert.deepEqual(escaping, [],
    `these would be drawn against the whole screen — give the host position: relative: ${escaping.join(', ')}`);
});

/* Debug probes (window.__something) are how the map gets inspected from the
   preview; they must never ship. */
t('no debug probe is left in the app', () => {
  for (const f of readdirSync(new URL('../public/', import.meta.url)).filter(x => x.endsWith('.js') && x !== 'token.js')) {
    const src = readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8');
    assert.ok(!/TEMP PROBE|window\.__[a-zA-Z]/.test(src), `${f} still has a debug probe`);
  }
});

/* Nothing else parses the app's own files: a duplicate `const` shipped a blank
   page once, caught only by eye. Node checks each module's syntax here. */
t('every script in public/ parses as a module', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tc-syntax-'));
  try {
    for (const f of readdirSync(new URL('../public/', import.meta.url)).filter(x => x.endsWith('.js') && x !== 'sw.js' && x !== 'token.js')) {
      const tmp = join(dir, f.replace(/\.js$/, '.mjs'));
      copyFileSync(new URL(`../public/${f}`, import.meta.url), tmp);
      try { execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' }); }
      catch (e) { assert.fail(`${f} does not parse: ${String(e.stderr || e.message).split('\n').slice(0, 6).join(' | ')}`); }
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

/* A test file that is never run is worse than no test file: it reads as
   cover. This caught call.test.mjs sitting in the folder, passing when run by
   hand, and absent from `npm test`. */
t('every test file is actually in the npm test script', () => {
  const script = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).scripts.test;
  const files = readdirSync(new URL('.', import.meta.url)).filter(f => f.endsWith('.test.mjs'));
  assert.ok(files.length > 10, 'found the test folder');
  for (const f of files) {
    assert.ok(script.includes(`test/${f}`), `${f} exists but npm test never runs it`);
  }
});

/* ── Deleting an account, and the privacy page (App Store needs both) ── */
const syncJs = readFileSync(new URL('../public/sync.js', import.meta.url), 'utf8');
const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
const privacy = readFileSync(new URL('../public/privacy.html', import.meta.url), 'utf8');

t('deleting an account proves it is them, then removes live runs, the backup, and last the account', () => {
  const body = syncJs.slice(syncJs.indexOf('async function removeAccount'), syncJs.indexOf('async function removeAll'));
  assert.match(syncJs, /if \(deleting\) return/, 'one deletion at a time');
  const at = (s) => { const i = body.indexOf(s); assert.ok(i > 0, `deleteAccount calls ${s}`); return i; };
  assert.ok(at('reauthenticateWith') < at('await userRun') && at('await userRun') < at('stopMirror'),
    'they prove it is them, then any backup still running finishes, then nothing more uploads');
  assert.ok(at('stopMirror') < at('removeLive('), 'the phone stops uploading before the backup goes');
  assert.ok(at('removeLive(') < at('removeAll(') && at('removeAll(') < at('deleteUser('),
    'the account goes last, so a failure never strands a backup without one');
  assert.ok(body.includes("'calibration'"), 'what the model learned goes too');
  assert.ok(/fb\.collection\(run\.ref, 'chunks'\)[\s\S]*deleteDoc\(run\.ref\)/.test(syncJs), 'a live run’s pieces go before the run');
});

t('a phone carrying another account’s records uploads nothing until it is answered', () => {
  const body = syncJs.slice(syncJs.indexOf('async function applyUser'), syncJs.indexOf('export async function deleteAccount'));
  const plan = body.indexOf('syncPlan('), claim = body.indexOf("kv.set('ownerUid'"), full = body.indexOf('fullSync(');
  assert.ok(plan > 0 && plan < full, 'whose records these are is settled before any sync');
  assert.match(body, /if \(plan === 'other' \|\| plan === 'ask'\) \{[^}]*return;/,
    'it returns: nothing is read from or written to that account');
  assert.ok(claim > 0 && claim < full, 'the account claims the records before the first upload, not after');
  assert.match(syncJs, /export async function useThisAccount[\s\S]{0,400}db\.wipeAll\(\)[\s\S]{0,160}kv\.set\('ownerUid'/,
    'starting fresh clears the phone first, then claims it');
  assert.match(syncJs, /export async function startLive[\s\S]{0,400}sync\.status === 'other' \|\| sync\.status === 'ask'[\s\S]{0,200}throw/,
    'a live link cannot publish records the account has not been given');
  assert.match(syncJs, /if \(db\.kv\.get\('ownerUid', null\) === u\.uid\) db\.kv\.set\('ownerUid', null\);/,
    'deleting one account never un-owns another account’s records');
  assert.match(js, /db\.wipeAll\(\);\s*\n\s*reclaim\(\);/,
    'wiping the phone takes the owner mark with it, so the account claims it again');
});

t('only a live run’s owner can list or delete it; strangers still only read an unexpired link', () => {
  const live = rules.slice(rules.indexOf('match /live/{liveId}'), rules.indexOf('match /{document=**}'));
  assert.match(live, /allow delete: if request\.auth != null && resource\.data\.uid == request\.auth\.uid;/);
  assert.match(live, /allow get: if resource\.data\.expiresAt > request\.time\.toMillis\(\)\s*\|\| \(request\.auth != null && resource\.data\.uid == request\.auth\.uid\);/);
  assert.match(live, /allow list: if request\.auth != null && resource\.data\.uid == request\.auth\.uid;/,
    'a stranger can open a run by its id, but never list them');
  const runRules = live.slice(0, live.indexOf('match /chunks'));
  assert.ok(!/allow read:/.test(runRules), 'no plain read on a run: it would let anyone list them');
  assert.ok(!/allow [a-z, ]*: if true/.test(rules), 'nothing is open to everyone');
  assert.match(rules, /match \/\{document=\*\*\} \{ allow read, write: if false; \}/, 'everything else stays shut');
});

t('the privacy page names who runs it, how to reach them, and every service the app talks to', () => {
  assert.match(privacy, /Rémi Droux/);
  assert.match(privacy, /mailto:contact@naifubushcraft\.com/);
  const named = {
    'api.mapbox.com': 'Mapbox', 'tile.openstreetmap.org': 'OpenStreetMap', 'api.open-meteo.com': 'Open-Meteo',
    'fonts.googleapis.com': 'Google Fonts', 'fonts.gstatic.com': 'Google Fonts', 'cdn.jsdelivr.net': 'jsDelivr',
    'www.gstatic.com': 'Firebase', 'sydrouxba5.github.io': 'GitHub Pages',
  };
  const dir = new URL('../public/', import.meta.url);
  const hosts = new Set();
  for (const f of readdirSync(dir).filter(f => /\.(js|html)$/.test(f) && f !== 'privacy.html' && f !== 'token.js')) {
    for (const m of readFileSync(new URL(f, dir), 'utf8').matchAll(/https:\/\/([a-z0-9.-]+\.[a-z]{2,})/g)) hosts.add(m[1]);
  }
  for (const h of hosts) {
    assert.ok(h in named, `the app now talks to ${h}: say so on privacy.html, then add it here`);
    if (named[h]) assert.ok(privacy.includes(named[h]), `privacy.html names ${named[h]} (${h})`);
  }
  assert.match(privacy, /stored in London/, 'where the backup lives');
});

t('Settings and the sign-in screen link to the privacy page, opening outside the app', () => {
  const links = [...html.matchAll(/<a class="privacy-link" href="([^"]+)" target="_blank" rel="noopener">/g)].map(m => m[1]);
  assert.equal(links.length, 2);
  for (const l of links) assert.equal(l, 'https://sydrouxba5.github.io/trailcraft/privacy.html');
});

console.log(`\n${pass} passed total\n`);
