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
  /* All of it, or none of it: a half-cached update that activates anyway
     deletes the last working copy and leaves nothing to start from. */
  assert.match(sw, /await c\.addAll\(SHELL\);/, 'the shell installs all-or-nothing');
  assert.ok(!/addAll\(SHELL\)\s*\.catch/.test(sw) && !/SHELL\.map\([^)]*catch/.test(sw),
    'and its failures are never swallowed');
  assert.ok(!cached.has('token.js'),
    'the Mapbox token is not deployed, so requiring it would fail every web install');
  assert.match(sw, /const whole = \(await Promise\.all\(SHELL\.map/, 'the old cache goes only once the new one is whole');
  assert.match(sw, /e\.request\.mode === 'navigate' \? caches\.match\('index\.html'\)/,
    'only a page falls back to the page: a missing script must not come back as HTML');

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

t('every screen in the markup is one the app can actually show', () => {
  /* go() hides every screen in SCREENS and shows the one asked for. A section
     missing from that list is built, filled in and left hidden — the app looks
     like it froze. That shipped twice, so it is pinned here. */
  const inList = new Set((js.match(/const SCREENS = \[([\s\S]*?)\];/)?.[1] || '')
    .match(/'([^']+)'/g)?.map(s2 => s2.slice(1, -1)) || []);
  const inMarkup = [...html.matchAll(/<section id="(scr[A-Za-z]+)"[^>]*class="[^"]*\bscreen\b/g)].map(m => m[1]);
  assert.ok(inMarkup.length > 25, `found ${inMarkup.length} screens in the markup`);
  for (const id of inMarkup) assert.ok(inList.has(id), `${id} is in index.html but not in SCREENS, so go('${id}') shows nothing`);
  for (const id of inList) assert.ok(inMarkup.includes(id), `SCREENS names ${id}, which no longer exists`);
});

t('"backed up" means backed up', () => {
  /* The backup used to skip a session that was too long, set an error, and
     then report success over the top of it. */
  assert.match(syncJs, /const tooBig = new Set\(\);/);
  assert.match(syncJs, /failed\.set\(rec\.id/, 'a refused write is remembered by record, not by a flag');
  assert.match(syncJs, /sync\.status = line \? 'partial' : 'synced';/,
    'anything left behind keeps the backup marked incomplete');
  const settle = syncJs.slice(syncJs.indexOf('function settle()'), syncJs.indexOf('/* ── Deleting the account'));
  assert.ok(!/status = 'synced';[\s\S]{0,40}error = null/.test(settle), 'success never clears a recorded failure');
  /* A write can land hours later, after a sign-out or a different account. */
  assert.match(syncJs, /const theirs = \(\) => sync\.user\?\.uid === uid/, 'a late answer speaks only for its own account');
  for (const where of ['forgetSkipped();                 // those records', 'if (!u) { forgetSkipped();']) {
    assert.ok(syncJs.includes(where), `the list is forgotten: ${where.slice(0, 30)}`);
  }
  assert.match(js, /\['synced', 'partial', 'other', 'ask'\]\.includes\(st\.status\)/,
    'a partial backup still lets them off the sign-in screen');
  assert.match(js, /forgetSkipped\(\);    \/\/ and the list/, 'wiping the phone forgets it too');
});

t('seeing the answer once counts for the rest of the run', () => {
  assert.match(js, /callSeen = !!run\.revealedAt;/, 'a call is judged on whether they have looked, not on what is on screen');
  assert.match(js, /if \(run\.revealed && !run\.revealedAt\) run\.revealedAt = Date\.now\(\);/,
    'the first reveal is stamped and never unstamped');
  assert.match(js, /run\.revealedAt = s\.data\.revealedAt \|\| 0;/,
    'a second run of the same trail knows the answer was already shown');
  assert.match(js, /revealedAt: run\.revealedAt \|\| s\.data\.revealedAt \|\| null/,
    'and saving a later run never erases when it was shown');
  assert.match(js, /if \(!run\.revealedAt\) run\.revealedAt = Date\.now\(\);/,
    'switching the coach on is being shown the answer');
  assert.match(js, /stampCall\(v, callSeen \|\| !!run\.revealedAt \|\| coach\.on\)/,
    'and the call is judged when it is answered, not when it was asked');
  assert.match(js, /if \(isFirstInd && !run\.revealedAt && !coach\.on\) openCall\(wp\);/,
    'and they are not asked once they have looked, or while the coach is talking');
  assert.ok(/revealedAt: run\.revealedAt \|\| s\.data\.revealedAt \|\| null/.test(js),
    'the run is saved with when the answer was shown');
});

t('an unfinished recording is written down, and nothing reloads over it', () => {
  assert.match(js, /function onFix[\s\S]{0,2000}keepDraft\(\);/, 'every fix keeps the draft up to date');
  assert.match(js, /const busy = unsavedWork\(\);/, 'an update waits for unsaved work, not just for the GPS');
  assert.match(js, /function unsavedWork\(\)[\s\S]{0,200}rec\.on[\s\S]{0,200}draftAlive/,
    'unsaved means recording OR a walk still on the phone');
  /* The walk goes into the session before anything that can hang: grading
     asks the weather service, and the run must not depend on it. */
  const stop = js.slice(js.indexOf('async function stopRun'), js.indexOf('/* ── The result'));
  const rawSave = stop.indexOf('saveSession(s, raw)');
  assert.ok(rawSave > 0 && rawSave < stop.indexOf('computeResult('), 'the track is saved before it is graded');
  assert.ok(stop.lastIndexOf('dropDraft()') > stop.indexOf('saveSession(s, patch)'),
    'the draft is dropped after the graded save, not before it');
  assert.match(stop, /if \(saved\) dropDraft\(\);/, 'and only if the phone really took it');
  assert.match(js, /if \(guardSave\(s, \(\) => db\.addSession\(s\)\)\) dropDraft\(\);/,
    'a refused save keeps the draft: it is the only durable copy');
  assert.match(js, /currentScreen === 'scrHome' && !unsavedWork\(\)/,
    'the service worker’s own reload waits for unsaved work too');
  assert.match(js, /function paintHides\(\) \{\s*\n\s*keepDraft\(true\);/, 'hides are written down as they are placed');
  for (const [where, what] of [['async function confirmLay', 'dropDraft();'], ['function discardLay', 'dropDraft();']]) {
    const body = js.slice(js.indexOf(where), js.indexOf(where) + 1200);
    assert.ok(body.includes(what), `${where} clears the draft`);
  }
  assert.match(js, /if \(S\.handler && offerRecovery\(\)\) return;/,
    'boot offers it back, once there is a handler to save it for');
  assert.ok(htmlIds.has('scrRecover') && htmlIds.has('btnRecoverKeep') && htmlIds.has('btnRecoverDrop'));
});

t('a save sends only what it changes, so nothing written meanwhile is lost', () => {
  /* The store merges data (store.test), but only if nobody hands it the whole
     of data rebuilt from a copy taken earlier. */
  const stale = [...js.matchAll(/(?:updateSession|saveSession)\([^;]*?data: \{ \.\.\.[\w.]+\.data\b/g)].map(m => m[0].slice(0, 70));
  assert.deepEqual(stale, [], 'no save rebuilds data from a copy it was holding');
  const body = (name) => js.slice(js.indexOf(name), js.indexOf(name) + 2400);
  for (const where of ['async function confirmLay', 'function saveDrawPlan', 'async function handleCard']) {
    assert.match(body(where), /keepWeather\((s|sess)\.id, /, `${where}: the late weather goes through keepWeather`);
  }
  assert.match(js, /function keepWeather\(id, wx\) \{[\s\S]{0,200}if \(live\) live\.data\.weather = wx;[\s\S]{0,80}db\.updateSession\(id, \{ data: \{ weather: wx \} \}\)/,
    'a run already going is given the weather, and only the weather is written');
  assert.match(js, /if \(kept && pendingSession\?\.id === id\) \{/, 'the share screen is only moved on if it still shows that session');
  const stop = js.slice(js.indexOf('async function finishRun'), js.indexOf('/* ── The result'));
  assert.match(stop, /guardSave\(patchSession\(s, raw\)/, 'a refused save keeps the whole session on screen, trail and all');
  assert.match(stop, /run\.session = saved \?\? patchSession\(s, patch\);/);
  assert.match(js, /function saveSession\(s, patch\) \{\s*\n\s*const merged = patchSession\(s, patch\);/);
});

t('running a trail or hide set again records a new session', () => {
  const start = js.slice(js.indexOf('async function startRun'), js.indexOf('function toggleReveal'));
  const fork = start.indexOf('runAgain(had');
  assert.ok(fork > 0 && fork < start.indexOf('run.session = s;'), 'the copy is made before the run takes a session');
  assert.match(start, /const had = db\.sessions\(\)\.find\(x => x\.id === s\.id\) \?\? s;\s*\n\s*run\.copy = !!had\.data\?\.track;/,
    'decided on what is stored, not on the copy the button was holding');
  assert.match(start, /guardSave\(s, \(\) => db\.addSession\(s\)\)/, 'saved at once, so a recording cut short can come back to it');
  assert.match(start, /if \(!\(await startWatch\('runHudText'\)\)\) \{ dropRunCopy\(\); return go\('scrHome'\); \}/,
    'a copy for a run that never started is not left behind');
  const stop = js.slice(js.indexOf('async function finishRun'), js.indexOf('/* ── The result'));
  assert.ok(stop.indexOf('dropRunCopy();') > 0 && stop.indexOf('dropRunCopy();') < stop.indexOf("toast('Too short to grade"),
    'nor one for a run too short to keep');
  assert.match(js, /function dropRunCopy\(\) \{[\s\S]{0,160}\?\.data\.track\) return;/, 'and never one that has a run in it');
});

t('a re-grade is for the dog that ran, not the one picked on Home', () => {
  const grade = js.slice(js.indexOf('async function computeResult'), js.indexOf('async function computeResult') + 900);
  assert.ok(!/S\.dog\b/.test(grade), 'grading never reads the Home selection');
  assert.match(grade, /const dogRow = S\.dogs\.find\(d => d\.id === s\.dogId\) \?\? null;/);
  const stop = js.slice(js.indexOf('async function finishRun'), js.indexOf('/* ── The result'));
  assert.match(stop, /const dogId = S\.dog\?\.id \?\? null;[\s\S]{0,160}computeResult\(\{ \.\.\.s, dogId \}/,
    'a run being recorded now is the picked dog’s, and is graded as that dog');
  assert.match(stop, /const patch = \{\s*\n\s*dogId,/, 'and saved under the same dog it was graded for');
  assert.match(js, /Nothing is banked to \$\{d\?\.name \?\? 'this dog'\}/, 'the provisional note names the run’s dog');
  assert.match(js, /function takeWalked[\s\S]{0,300}x\.data\.plan && !x\.data\.walked && ownRun\(x\)/,
    'a walked card from the camera never re-grades a run kept from someone else');
});

t('Stop works once, and grading cannot wait for ever on the weather', () => {
  assert.match(js, /async function stopRun\(\) \{\s*\n\s*if \(run\.stopping\) return;\s*\n\s*run\.stopping = true;\s*\n\s*\$\('btnRunStop'\)\.disabled = true;/,
    'a second tap does nothing while the first is still grading');
  assert.match(js, /finally \{ run\.stopping = false; \$\('btnRunStop'\)\.disabled = false; \}/, 'and the next run can be stopped');
  assert.match(js, /\$\('btnRunStop'\)\.addEventListener\('click', stopRun\);/);
  const wx = js.slice(js.indexOf('async function fetchWeather'), js.indexOf('async function fetchWeather') + 700);
  assert.match(wx, /fetch\(url, \{ signal: ctl\.signal \}\)/, 'the weather ask can be called off');
  assert.match(wx, /setTimeout\(\(\) => ctl\.abort\(\), within\)/);
  assert.ok(wx.indexOf('clearTimeout(timer)') > wx.indexOf('res.json()'), 'the clock runs until the body has been read');
  assert.match(js, /fetchWeather\(track\[0\]\.lat, track\[0\]\.lon, startedAt, \{ within: WX_WAIT \}\)/, 'grading gives up on it');
  assert.match(js, /const WX_WAIT = \d{4,5};/);
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

/* A function's body in app.js, from its name to the brace that closes it. */
const bodyOf = (name) => {
  const i = js.indexOf(`\nfunction ${name}(`);
  assert.ok(i > 0, `app.js still has ${name}()`);
  return js.slice(i, js.indexOf('\n}\n', i) + 2);
};

t('a session, a dog and a handler can each be deleted, and only after a question naming what goes', () => {
  /* There was no delete anywhere: store.deleteSession and deleteHandler had
     no caller, so a full phone could only be wiped. Each delete goes through
     the store, whose tombstone is what reaches the backup and other phones. */
  const flows = [
    ['confirmDeleteSession', "askDelete('session'", 'db.deleteSession(id)'],
    ['confirmDeleteDog', "askDelete('dog'", 'db.dogs.remove(id)'],
    ['confirmDeleteHandler', "askDelete('handler'", 'db.deleteHandler(id)'],
  ];
  for (const [fn, ask, del] of flows) {
    const body = bodyOf(fn);
    assert.ok(body.includes(ask), `${fn} asks in askDelete's words`);
    assert.ok(body.includes(del), `${fn} deletes through the store`);
    assert.ok(body.indexOf('confirm(q)') > 0 && body.indexOf('confirm(q)') < body.indexOf(del),
      `${fn} asks before it deletes`);
  }
  const controls = [
    ['btnResDelete', "deleteShownSession(sessionById($('resGround').dataset.sid))"],
    ['btnShareDelete', "deleteShownSession(sessionById($('shareGround').dataset.sid))"],
    ['dogDelete', 'dogCardId && confirmDeleteDog(dogCardId)'],
    ['hDelete', 'handlerCardId && confirmDeleteHandler(handlerCardId)'],
  ];
  for (const [id, call] of controls) {
    assert.ok(htmlIds.has(id), `#${id} is on its screen`);
    assert.ok(js.includes(`$('${id}').addEventListener('click', () => ${call}`), `#${id} is wired to ${call}`);
  }
  assert.ok(bodyOf('deleteShownSession').includes('confirmDeleteSession(s.id)'));
});

t('the session list deletes from a card without opening it, only once Delete sessions is on', () => {
  assert.ok(htmlIds.has('btnSessDelete'), 'the list has its Delete sessions switch');
  assert.match(bodyOf('sessionCard'), /\$\{del \? `<button[^`]*data-del-session="\$\{s\.id\}"[^`]*>Delete<\/button>` : ''\}/,
    'a card carries its own Delete only in delete mode');
  assert.match(js, /recent\.map\(s => sessionCard\(s\)\)/, 'home never shows one');
  const i = js.indexOf("$('sessionList').addEventListener('click'");
  const handler = js.slice(i, js.indexOf('\n  });', i));
  assert.ok(handler.indexOf('[data-del-session]') > 0 && handler.indexOf('[data-del-session]') < handler.indexOf('[data-open-session]'),
    'the Delete inside a card is looked for before the card itself');
  assert.match(handler, /if \(confirmDeleteSession\(del\.dataset\.delSession\)\) renderSessions\(\);\s*return;/);
});

t('the full-phone banner and the storage line point at a delete that exists', () => {
  /* They used to send the handler to "Settings → All sessions → delete old
     ones", a flow that did not exist. */
  for (const [name, src] of [['app.js', js], ['index.html', html]]) {
    assert.doesNotMatch(src, /All sessions → delete old ones|delete old sessions soon|delete old sessions in Settings soon/,
      `${name} still points at a delete that is not there`);
  }
  assert.ok(htmlIds.has('saveFree'), 'the banner has its own way to the list');
  assert.match(js, /\$\('saveFree'\)\.addEventListener\('click', \(\) => openSessionList\(\{ deleting: true \}\)\);/,
    'and it opens the session list with Delete sessions already on');
  assert.match(bodyOf('showSaveTrouble'), /\$\('saveFree'\)\.hidden = !e\.full;/, 'shown whenever the phone is full');
  assert.match(bodyOf('paintStorageLine'), /storageWords\(db\.usage\(\)\.bytes, STORAGE_MB\)/);
});

t('grading reads the approach, the trail ends, the rain and the handler the right way', () => {
  const block = (start) => {
    const i = js.indexOf(start);
    assert.ok(i >= 0, `app.js still has ${start}`);
    return js.slice(i, js.indexOf('\n}', i) + 2);
  };
  /* The approach was worked out inline and named back to front. */
  const search = bodyOf('searchResult');
  assert.match(search, /approach = approachToWind\(bearing\(path\[back\], path\[path\.length - 1\]\), wx\.wind_direction\);/);
  assert.match(search, /approachV: APPROACH_V/, 'a new result is marked, so the store never swaps it back');
  assert.doesNotMatch(js, /off > 135 \? 'into the wind'/);
  /* Past the ends of the trail a fix has no side. */
  assert.match(block('async function computeResult('),
    /const offs = signedOffsets\(trail, corrected, \{ withinEnds: true \}\);/);
  /* Rain is held as Open-Meteo's 15-minute total and read as a rate. */
  assert.match(bodyOf('benchWx'), /precipitation: PV\.rain \/ RAIN_SUMS_PER_HOUR/);
  assert.match(block('const scentLifeOf = '), /rain = rainRate\(wx\)/);
  assert.doesNotMatch(js, /rain = wx\?\.precipitation/);
  /* One handler's calls, and one handler's sticky answers. */
  assert.match(bodyOf('paintCallBlock'), /calibration\(runsOf\(db\.sessions\(\), s\.handlerId \?\? S\.handler\?\.id\)\)/);
  assert.doesNotMatch(js, /calibration\(db\.sessions\(\)\)/);
  assert.match(bodyOf('openDebrief'), /const last = stickyDebrief\(db\.sessions\(\), s\);/);
});

t('a replay shows the air as it was, and a search can be replayed', () => {
  /* The plume's first frame prunes, and it was drawn on the real clock
     before the replay set its own: a run from yesterday lost every parcel.
     A search has no trail, and reading its first point threw. */
  const start = bodyOf('plumeStart');
  assert.match(start, /function plumeStart\(trail, wx, T, contamination = null, \{ at = null, since = at \} = \{\}\)/);
  assert.ok(start.indexOf('plume.clock = at;') > 0 && start.indexOf('plume.clock = at;') < start.indexOf('plumeFrame();'),
    'the clock is set before the first frame prunes');
  assert.ok(start.indexOf('plume.clock = at;') < start.indexOf('if (!settings.plume'), 'and on every start, so none leaks');
  const frame = bodyOf('plumeFrame');
  assert.match(frame, /plume\.sim\.prune\(now, plume\.wx, plume\.st, \{ max: 9000, since: plume\.since \}\)/);
  assert.match(frame, /plume\.contam\.prune\(now, plume\.wx, plume\.st, \{ max: 5000, since: plume\.since \}\)/);
  const open = bodyOf('openReplay');
  assert.match(open, /plumeStart\(trailOf\(s\), s\.data\.weather, plume\.T, s\.data\.contamination,\s*\{ at: replay\.at, since: replay\.from \}\)/,
    'on the replay’s clock, pruned by the start of the run');
  assert.doesNotMatch(open, /plume\.clock =/, 'the clock is plumeStart’s to set');
  const hide = open.indexOf("if (targetById(s.targetId).kind === 'hide') {");
  assert.ok(hide > 0 && hide < open.indexOf('s.data.trail[0]'), 'a search never reads a trail it does not have');
  assert.match(open.slice(hide), /^[^}]*setSrc\('hides', pointsOf\(s\.data\.hides \|\| \[\]\)\);/, 'it shows the hides');
  assert.match(open, /fitTo\(s\.data\.trail \|\| s\.data\.hides \|\| \[\], track,/);
  assert.ok(open.indexOf('replay.s = s;') > open.indexOf('plumeStart('), 'nothing is left half open');
  assert.match(bodyOf('paintReplay'), /const laid = targetById\(s\.targetId\)\.kind === 'hide' \? 'Hides' : 'Trail';/);
  assert.match(bodyOf('showOnMap'),
    /plumeStart\(trailOf\(s\), wx, undefined, s\.data\.contamination, \{ at: s\.data\.trackStarted \?\? null \}\)/,
    'a saved run’s map shows the air when the dog set off, not now');
});

/** The source of one function, from its opening line to the next top-level one. */
const fnSrc = (head) => {
  const at = js.indexOf(head);
  assert.ok(at >= 0, `${head} exists`);
  const next = js.slice(at + head.length).search(/\n(?:async )?function |\n(?:const|let) \w+ = /);
  return js.slice(at, next < 0 ? undefined : at + head.length + next);
};

t('a back gesture never leaves a recording, and a screen swiped away is tidied up', () => {
  const pop = js.slice(js.indexOf("window.addEventListener('popstate'"), js.indexOf("window.addEventListener('popstate'") + 800);
  assert.match(pop, /if \(currentScreen && currentScreen === liveScreen\(\)\) \{\s*\n\s*try \{ history\.pushState\(\{ tc: currentScreen \}, ''\); \}/,
    'while something is recording, the history entry is put back');
  assert.ok(pop.indexOf('liveScreen()') < pop.indexOf('goBackNow()'), 'before anything can leave the screen');
  assert.match(fnSrc('function liveScreen()'),
    /if \(rec\.on\) return \{ run: 'scrRun', walk: 'scrWalk', lay: 'scrLay' \}\[rec\.kind\] \?\? null;\s*\n\s*return rec\.kind === 'hide' && rec\.hides\.length \? 'scrLay' : null;/,
    'a run, a walk, a GPS lay and a hide set with hides in it are all recordings');
  assert.match(fnSrc('function goBackNow()'), /LEAVE\[currentScreen\]\?\.\(\);/, 'going back runs the screen’s own tidy-up');
  const screens = [...js.match(/const SCREENS = \[([\s\S]*?)\];/)[1].matchAll(/'(\w+)'/g)].map(m => m[1]);
  for (const [scr, what] of [['scrBench', 'closeBench()'], ['scrReplay', 'closeReplay()'], ['scrFix', 'closeFix()'],
    ['scrShowMap', 'plumeStop()'], ['scrContam', 'closeContam()'], ['scrDraw', 'closeDraw()'],
    ['scrCountdown', 'stopCountdownUi()'], ['scrLay', "map.off('click', onHideTap)"]]) {
    assert.ok(screens.includes(scr), `${scr} is a screen`);
    assert.ok(new RegExp(`\\n  ${scr}: \\(\\) => [^\\n]*${what.replace(/[()?.]/g, '\\$&')}`).test(js), `${scr} runs ${what} when swiped away`);
  }
  for (const fn of ['function startLay() {', 'function openDraw() {', 'function startWalk(card) {']) {
    assert.match(fnSrc(fn), /\n\s*if \(rec\.on\) return toast\(/, `${fn} refuses while something else is recording`);
  }
  assert.match(fnSrc('async function startRun(s) {'), /plumeStop\(\);/, 'a plume left drawing never paints onto a blind run');
});

t('the layer’s guided walk is written down, and comes back after a crash', () => {
  assert.match(fnSrc('function keepDraft('),
    /plan: rec\.kind === 'walk' \? walk\.card : null, offAt: rec\.kind === 'walk' \? walk\.offAt : 0,/,
    'the draft carries the plan it is walking and when she left');
  assert.match(fnSrc('function walkHud()'), /keepDraft\(true\);/, 'the departure is written down the moment it happens');
  assert.match(fnSrc('async function finishWalk()'), /await stopWatch\(\);[\s\S]*return keepWalk\(\);/);
  const keep = fnSrc('async function keepWalk()');
  assert.match(keep, /if \(guardSave\(own, \(\) => db\.addSession\(own\)\)\) dropDraft\(\);/,
    'the draft goes once her record is really kept, not before');
  assert.match(fnSrc('async function recoverKeep()'),
    /if \(d\.kind === 'walk'\) \{[\s\S]{0,400}walk\.card = d\.plan;\s*\n\s*walk\.offAt = d\.offAt \|\| 0;[\s\S]{0,120}return keepWalk\(\);/,
    'a recovered walk is finished the way the button finishes one');
  const cancel = js.slice(js.indexOf("$('walkCancel').addEventListener"), js.indexOf("$('walkCancel').addEventListener") + 400);
  assert.match(cancel, /dropDraft\(\);/, 'a walk cancelled on purpose is never offered back');
});

t('the walk to the start neither starts the clock nor goes on the trail', () => {
  const hud = fnSrc('function walkHud()');
  assert.match(hud, /departure\(walk, \{ d: dA, t: last\.t, \.\.\.walkedOfTrail\(rec\.pts, walk\.card\.points\) \}\)/,
    'the fallback is fed the trail walked, not every metre since the scan');
  assert.ok(!/walked: pathLen\(rec\.pts\)/.test(js), 'the old measure is gone');
  assert.match(fnSrc('async function keepWalk()'),
    /const trail = rec\.pts\.slice\(trailFrom\(rec\.pts, walk\.card\.points\[0\], walk\.offAt\)\);/,
    'the walked card and her record start where she left the start');
});

t('a walked card names its plan, and one that does not is asked about', () => {
  assert.match(fnSrc('async function renderShareQr(s)'), /kind: 1, ageMin: s\.data\.ageMin \?\? 10, planId: s\.data\.planOf \?\? s\.id/,
    'the plan card says which plan it is');
  assert.match(fnSrc('async function keepWalk()'), /kind: 2,\s*\n\s*planId: walk\.card\.planId \?\? null/, 'the walked card says it back');
  const take = fnSrc('function takeWalked(card, asked)');
  assert.match(take, /walkedPlanFor\(card, plans, asked\)/);
  assert.match(take, /pick\.ask \? askWhichPlan\(pick\.ask\) : pick\.id/, 'with several plans and no name, the handler picks');
  assert.match(fnSrc('async function handleCard(data)'), /return takeWalked\(card, asked\);/);
});

t('a web recording keeps the screen awake after the page has been hidden', () => {
  const hold = fnSrc('async function holdScreen()');
  assert.match(hold, /if \(isNative\(\) \|\| !rec\.on \|\| rec\.lock \|\| document\.visibilityState !== 'visible'\) return;/);
  assert.match(hold, /lock\.addEventListener\?\.\('release', \(\) => \{ if \(rec\.lock === lock\) rec\.lock = null; \}\);/,
    'a lock the browser let go of is known to be gone');
  assert.match(js, /document\.addEventListener\('visibilitychange', \(\) => \{\s*\n\s*if \(document\.visibilityState === 'visible'\) holdScreen\(\);/,
    'and asked for again when the page comes back');
  const watch = fnSrc('async function startWatch(hudId)');
  assert.match(watch, /await holdScreen\(\);/);
  assert.ok(!/wakeLock/.test(watch), 'one place asks for the lock');
});

t('the HUD says when the GPS is keeping nothing, and a mark says when it is a guess', () => {
  const start = fnSrc('async function startRun(s) {');
  assert.match(start, /hudText = \(\) => \{[\s\S]{0,300}const trouble = gpsTrouble\(\{ last: rec\.pts\[rec\.pts\.length - 1\], startedAt: rec\.started,\s*\n\s*droppedAt: rec\.droppedAt, blocked: rec\.blocked \}\);\s*\n\s*if \(trouble\) return gpsTroubleText\(trouble\);/,
    'the run HUD, before its clock');
  assert.match(fnSrc('function gpsHudText()'), /if \(trouble\) return gpsTroubleText\(trouble\);/, 'and the lay HUD');
  assert.match(fnSrc('function walkHud()'), /trouble \? gpsTroubleText\(trouble\) : clock/, 'and the walk');
  assert.match(fnSrc('function onFix(pos)'), /if \(verdict === 'drop'\) \{ rec\.dropped\+\+; rec\.lastAcc = acc; rec\.droppedAt = pt\.t; return; \}/);
  const watch = fnSrc('async function startWatch(hudId)');
  assert.match(watch, /if \(e\.code === 1\) rec\.blocked = true;/, 'a refusal stays on the HUD, not just in a toast');
  assert.match(watch, /if \(e\?\.code === 'NOT_AUTHORIZED'\) rec\.blocked = true;/);
  assert.equal((watch.match(/rec\.droppedAt = 0; rec\.blocked = false;/g) || []).length, 2, 'both ways of recording start clean');
  assert.match(fnSrc('function addWaypoint(kind)'), /const stale = !!gpsTrouble\(\{ last, droppedAt: rec\.droppedAt \}\);[\s\S]{0,200}\.\.\.\(stale \? \{ approx: true \} : \{\}\)/);
  assert.match(fnSrc('function searchResult('), /ind\.approx \? 'roughly ' : ''/, 'and the result does not claim a distance it never measured');
});

console.log(`\n${pass} passed total\n`);
