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
import vm from 'node:vm';
import { fmtShort, fmtDur } from '../public/geo.js';
import { ranBlind, trailShown, unwalkedPlan } from '../public/debrief.js';

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
  assert.match(sw, /await c\.addAll\(SHELL\.map\(fresh\)\);/, 'the shell installs all-or-nothing');
  assert.ok(!/addAll\(SHELL\)\s*\.catch/.test(sw) && !/SHELL\.map\([^)]*catch/.test(sw),
    'and its failures are never swallowed');
  assert.ok(!cached.has('token.js'),
    'the Mapbox token is not deployed, so requiring it would fail every web install');
  assert.match(sw, /const whole = \(await Promise\.all\(SHELL\.map/, 'the old cache goes only once the new one is whole');
  // sw.test.mjs runs both of these for real; this keeps the shape from drifting.
  assert.match(sw, /e\.request\.mode === 'navigate' \? openPage\(e\) : shellFile\(e\)/,
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
  assert.match(syncJs, /sync\.status = line \? 'partial' : busy \? 'syncing' : 'synced';/,
    'anything left behind keeps the backup marked incomplete, and a save still on its way is not "backed up"');
  assert.match(syncJs, /if \(!busy\) sync\.lastSync = Date\.now\(\);/, '"Backed up just now" only once nothing is on its way');
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
  assert.match(js, /if \(!idleForUpdate\(\) \|\| tried === remote\) return toast/, 'an update waits for unsaved work, not just for the GPS');
  assert.match(js, /function unsavedWork\(\)[\s\S]{0,200}rec\.on[\s\S]{0,800}draftAlive/,
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
  assert.match(js, /if \(S\.handler && !recoveryLater && offerRecovery\(\)\) return;/,
    'boot offers it back, once there is a handler to save it for, unless she said not now');
  assert.ok(htmlIds.has('scrRecover') && htmlIds.has('btnRecoverKeep') && htmlIds.has('btnRecoverDrop'));
});

/** One top-level function of app.js as source, to be run against stand-ins. */
function fnSource(name) {
  const m = js.match(new RegExp(`\\n((?:async )?function ${name}\\([\\s\\S]*?\\n\\})`));
  assert.ok(m, `${name}() is still where the test expects it`);
  return m[1];
}
const ta = async (name, fn) => { await fn(); pass++; console.log(`  ok  ${name}`); };

t('unsaved work is everything that lives only in memory, not just a recording', () => {
  /* A self-update reloads the page. Corners tapped for a plan, a debrief half
     answered or a form half filled were not counted, so coming back to the
     app after a deploy threw them away without a word. */
  const editing = js.match(/const EDITING = (new Set\(\[[^\]]*\]\));/);
  assert.ok(editing, 'the screens that hold an edit are listed');
  const unsaved = (over = {}) => new Function('s', `
    const { rec, draw, contam, document, db, draftAlive, unpackDraft, currentScreen } = s;
    const EDITING = ${editing[1]};
    ${fnSource('unsavedWork')}
    return unsavedWork();`)({
    rec: { on: false }, draw: { pts: [] }, contam: { pts: [] },
    document: { activeElement: null }, db: { draft: { read: () => null } },
    draftAlive: () => false, unpackDraft: (x) => x, currentScreen: 'scrHome', ...over,
  });
  const corners = [{ lat: 51, lon: -2.6 }, { lat: 51.001, lon: -2.6 }];
  assert.equal(unsaved(), false, 'idle on Home is nothing unsaved');
  assert.equal(unsaved({ rec: { on: true } }), true, 'a recording');
  assert.equal(unsaved({ draftAlive: () => true }), true, 'a walk still waiting on Confirm');
  assert.equal(unsaved({ currentScreen: 'scrDraw', draw: { pts: corners } }), true, 'a plan being drawn');
  assert.equal(unsaved({ currentScreen: 'scrDraw' }), false, 'an empty map is nothing to lose');
  assert.equal(unsaved({ currentScreen: 'scrContam', contam: { pts: corners } }), true, 'a contamination trail being tapped');
  for (const screen of ['scrDebrief', 'scrOnboardHandler', 'scrOnboardDog', 'scrSignIn', 'scrDelete', 'scrFix']) {
    assert.equal(unsaved({ currentScreen: screen }), true, `${screen} holds an edit until it is saved`);
  }
  assert.equal(unsaved({ document: { activeElement: { matches: () => true } } }), true, 'someone typing');
  assert.equal(unsaved({ draw: { pts: corners } }), false,
    'a plan already saved and left behind does not hold every update back');
});

await ta('an update reloads only when idle on Home, and asks again after the slow re-fetch', async () => {
  const check = (env) => new Function('env', `
    const BUILD = 'old';
    const unsavedWork = () => env.busy;
    const toast = (m) => env.toasts.push(m);
    const sessionStorage = { getItem: () => env.tried, setItem: (k, v) => { env.tried = v; }, removeItem: () => { env.tried = null; } };
    const location = { reload: () => { env.reloaded = true; } };
    const AbortSignal = { timeout: () => undefined };
    const fetch = async (u) => {
      if (u === 'build.txt') return { ok: true, text: async () => 'new' };
      env.meanwhile?.();
      return {};
    };
    ${fnSource('idleForUpdate').replaceAll('currentScreen', 'env.screen')}
    ${fnSource('checkForUpdate')}
    return checkForUpdate();`)(env);
  const fresh = (over) => ({ screen: 'scrHome', busy: false, tried: null, toasts: [], reloaded: false, ...over });

  const idle = fresh();
  await check(idle);
  assert.ok(idle.reloaded, 'idle on Home, the new build loads at once');

  /* One bar at the trailhead: the re-fetch takes half a minute, and the
     handler starts the dog in the meantime. */
  const started = fresh({ meanwhile() { this.screen = 'scrRun'; this.busy = true; } });
  started.meanwhile = started.meanwhile.bind(started);
  await check(started);
  assert.ok(!started.reloaded, 'a run that started during the re-fetch is not reloaded over');
  assert.equal(started.toasts.length, 1, 'they are told the update is waiting');
  assert.equal(started.tried, null, 'and the update is not spent: the next idle moment can still load it');

  const drawing = fresh({ screen: 'scrDraw' });
  await check(drawing);
  assert.ok(!drawing.reloaded && drawing.toasts.length === 1, 'away from Home the update waits for the next open');

  assert.match(fnSource('checkForUpdate'), /fetch\('build\.txt', \{[^}]*signal: AbortSignal\.timeout/,
    'asking for the build gives up after a few seconds');
  assert.match(js, /addEventListener\('controllerchange'[\s\S]{0,120}if \(idleForUpdate\(\)\) location\.reload\(\);/,
    'the service worker’s own reload keeps the same rule');
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
  assert.match(start, /if \(!\(await startWatch\('runHudText'\)\)\) \{[^}\n]* dropRunCopy\(\); return go\('scrHome'\); \}/,
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

/* Only the drawn plan was ever held back, so coached runs, revealed runs and
   runs the result itself called unreadable all taught the dog's drift. */
t('a run banks towards the dog’s drift only when nothing was steering and the GPS could tell', () => {
  const stop = js.slice(js.indexOf('async function finishRun'), js.indexOf('/* ── The result'));
  assert.match(stop, /const bank = teachesDrift\(\{ \.\.\.s\.data, coach: coachRecord, revealedAt: run\.revealedAt \|\| s\.data\.revealedAt \|\| null \}\);/,
    'Stop judges this run with its own coach record and its own reveal');
  assert.match(stop, /run\.startedAt, \{ bank \}\);/);
  assert.match(js, /s2\.data\.trackStarted, \{ bank: teachesDrift\(s2\.data\) \}\);/,
    'a walked card re-grades without undoing a coach or a reveal');
  assert.doesNotMatch(js, /\{ bank: (true|!provisional) \}/);
  const grade = js.slice(js.indexOf('async function computeResult('), js.indexOf('\nfunction searchResult('));
  assert.match(grade, /if \(bank && !offBaseline && !noisy\) \{\s*\n\s*db\.addCalibration\(/,
    'a track the GPS could not place on either side banks nothing');
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
  /* Wiping the phone while signed in used to claim it for the account again
     and keep the mirror running: the next person's records went into it. */
  assert.ok(!/reclaim/.test(js) && !/export function reclaim/.test(syncJs), 'nothing claims a wiped phone for the account');
  const wipe = js.slice(js.indexOf("$('btnWipe').addEventListener"), js.indexOf('async function importFromLink'));
  assert.match(wipe, /if \(signedIn\) \{\s*const ok = await wipeAndSignOut\(\)[\s\S]{0,400}return location\.reload\(\);/,
    'signed in, a wipe signs out and starts the app again from clean');
  assert.match(wipe, /This also signs you out\. Your account backup is kept/, 'and says so before it happens');
  assert.ok(wipe.indexOf('wipeAndSignOut()') < wipe.indexOf('db.wipeAll()'), 'only a signed-out phone is wiped in place');
  const wipeFn = syncJs.slice(syncJs.indexOf('export async function wipeAndSignOut'), syncJs.indexOf('export async function signOut'));
  const at = (x) => { const i = wipeFn.indexOf(x); assert.ok(i > 0, `wipeAndSignOut: ${x}`); return i; };
  assert.ok(at('stopMirror') < at('f.signOut(auth)') && at('f.signOut(auth)') < at('db.wipeAll()'),
    'nothing uploads, then the account is left, then the phone is cleared');
  assert.ok(at('await Promise.race([userRun') < at('db.wipeAll()'), 'a sync still running cannot refill the phone');
  assert.ok(!/ownerUid/.test(wipeFn), 'a wiped phone belongs to nobody');
});

/* Two phones on one account. The pull and the refusal are run for real in
   sync-flow.test.mjs; these are the two ends of them that live elsewhere. */
t('a phone pulls when it comes back, and the cloud refuses a save made from an old copy', () => {
  assert.match(js, /addEventListener\('visibilitychange', \(\) => \{ if \(document\.visibilityState === 'visible'\) resync\(\); \}\);/,
    'coming back to the app pulls what another phone changed');
  assert.match(js, /addEventListener\('online', \(\) => resync\(\)\);/, 'and so does coming back into signal');
  const own = rules.slice(rules.indexOf('match /users/{uid}/{table}/{recordId}'), rules.indexOf('match /live/{liveId}'));
  assert.match(own, /allow read, create, delete: if mine\(\);/);
  assert.match(own, /allow update: if mine\(\)\s*&& \(request\.resource\.data\.get\('syncedAt', null\) != request\.time\s*\|\| request\.resource\.data\.get\('baseAt', null\) == resource\.data\.get\('updatedAt', null\)\);/,
    'a build that stamps syncedAt with the server time must name the copy the cloud holds; an older build is let through');
  /* An older build echoes back the baseAt it pulled, so testing for baseAt
     alone refused every save it made. The server-time stamp is what only the
     new build sends. */
  assert.match(syncJs, /syncedAt: fb\.serverTimestamp\(\)/, 'the new build always sends it');
  assert.ok(!/allow [a-z, ]*write/.test(own), 'no blanket write left over the top of the check');
});

t('a wipe waits until the phone knows whether it is signed in', () => {
  const wipe = js.slice(js.indexOf("$('btnWipe').addEventListener"), js.indexOf('async function importFromLink'));
  const guard = wipe.indexOf("if (sync.configured && !sync.user && sync.status === 'loading') return toast(");
  assert.ok(guard > 0 && guard < wipe.indexOf('confirm('), 'asked to wait before anything is asked or wiped');
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
  assert.match(bodyOf('sessionCard'), /\$\{del \? `<button[^`]*data-del-session="\$\{esc\(s\.id\)\}"[^`]*>Delete<\/button>` : ''\}/,
    'a card carries its own Delete only in delete mode');
  assert.match(js, /recent\.map\(s => sessionCard\(s\)\)/, 'home never shows one');
  const i = js.indexOf("$('sessionList').addEventListener('click'");
  const handler = js.slice(i, js.indexOf('\n  });', i));
  assert.ok(handler.indexOf('[data-del-session]') > 0 && handler.indexOf('[data-del-session]') < handler.indexOf('[data-open-session]'),
    'the Delete inside a card is looked for before the card itself');
  assert.match(handler, /if \(confirmDeleteSession\(del\.dataset\.delSession\)\) renderSessions\(\);\s*return;/);
});

t('every view of a run takes its wind from windAt, and the grade only banks the run\'s own wind', () => {
  const grade = js.slice(js.indexOf('async function computeResult('), js.indexOf('async function computeResult(') + 2400);
  assert.match(grade, /let \{ wx, exact \} = windAt\(s, startedAt\);/, 'the grade reads the same wind the coach and replay show');
  assert.match(grade, /if \(!exact\) bank = false;/, 'and banks nothing from a wind that was not the run\'s');
  assert.match(js, /coach\.field = wx && coach\.trail \? scentField\(trailOf\(s\), wx, run\.startedAt\) : \[\];/);
  assert.match(js, /const wx = windAt\(s, run\.startedAt\)\.wx;/, 'the coach');
  assert.match(js, /run\.airAt = Date\.now\(\);\s*\n\s*plumeStart\(trailOf\(s\), windAt\(s, run\.airAt\)\.wx/, 'the reveal');
  assert.match(js, /const w0 = windAt\(s, replay\.at\)\.wx;/, 'the replay as it opens');
  assert.match(js, /const w = windAt\(s, at\)\.wx;\s*\n\s*if \(w && plume\.sim\) \{ plume\.wx = w;/, 'and as its clock moves');
  assert.match(js, /if \(bestGap > WX_MAX_GAP\) throw new Error/, 'weather days away from the moment is refused');
  assert.ok(!/s\.data\.weather, undefined, s\.data\.contamination/.test(js), 'nothing draws a run in the laid-time snapshot any more');
  /* Nor through a variable holding a raw record: a saved trail's plume takes
     its wind from windAt, inline or through a name set from it in the same
     function. keepWeather drew a revealed run in the late laid snapshot. */
  const drawn = [...js.matchAll(/plumeStart\(trailOf\((\w+)\), ([^,]+),/g)];
  assert.ok(drawn.length >= 4, `every plume of a saved trail is checked, found ${drawn.length}`);
  for (const m of drawn) {
    const arg = m[2].trim();
    if (arg.startsWith('windAt(')) continue;
    const fn = js.slice(Math.max(js.lastIndexOf('\nfunction ', m.index), js.lastIndexOf('\nasync function ', m.index)), m.index);
    assert.match(fn, new RegExp(`const ${arg} = [^;]*windAt\\(`), `plumeStart(trailOf(${m[1]}), ${arg}) takes a wind windAt did not give`);
  }
});

t('batch 1 follow-ups the checkers asked for', () => {
  /* A session the phone refused to keep still has its crash copy: deleting the
     session must take that copy too, or it is offered back at the next launch. */
  assert.match(bodyOf('confirmDeleteSession'), /if \(draftFor\(s\)\) dropDraft\(\);/,
    'only the crash copy that is provably this session’s — another walk’s copy may be its only record');
  assert.match(bodyOf('draftFor'), /return Number\.isFinite\(kept\) && kept === drafted;/);
  /* A fix arriving proves location is allowed again; the warning must go. */
  assert.match(bodyOf('onFix'), /rec\.blocked = false;/);
  /* A walk the phone lost part-way is not sent as a finished one unasked. */
  assert.match(js, /if \(short > 60 && !confirm\(`The recording stopped \$\{fmtM\(short\)\} before the drawn end/);
  /* A first backup goes up in batches bounded by size as well as count: one
     request may not exceed 10 MiB, and a refused record is left behind alone. */
  const sync = readFileSync(new URL('../public/sync.js', import.meta.url), 'utf8');
  assert.match(sync, /bytes \+ size > BATCH_BYTES/);
  assert.match(sync, /try \{ batch\.set\(userDoc\(uid, name, rec\.id\), payload\); \} catch \(e\) \{ refused\.set\(rec\.id/,
    'a record the cloud refuses is left behind by itself, and reported as refused rather than as too long');
  assert.match(sync, /const BATCH_BYTES = 5_000_000;/, 'with room for the request to be bigger than the stored size');
  /* One unfinished recording at a time: a waiting one is dealt with before a
     new recording could overwrite it. */
  for (const start of ['function startLay() {', 'function startWalk(card) {', 'async function startRun(s) {']) {
    const at = js.indexOf(start);
    assert.ok(at > 0 && js.slice(at, at + 400).includes('if (recordingWaits()) return;'), `${start} checks for a waiting recording`);
  }
  /* Runs kept before links were checked are read through the same cleaning. */
  assert.match(bodyOf('renderResult'), /s\.data\.imported \? \(cleanResult\(s\.data\.result\) \?\? \{\}\)/);
  assert.match(html, /<link rel="stylesheet" crossorigin="anonymous" href="https:\/\/fonts\.googleapis\.com/,
    'the lettering is fetched so the offline cache can keep it');
  /* The lettering is render-blocking, so it gets a time limit on one bar. */
  const sw = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
  assert.match(sw, /fonts\s*\? await Promise\.race\(\[fetch\(e\.request\), wait\(PATIENCE \* 2, null\)\]\) \?\? Response\.error\(\)/);
});

t('the full-phone banner and the storage line point at a delete that exists', () => {
  /* They used to send the handler to "Settings → All sessions → delete old
     ones", a flow that did not exist. */
  for (const [name, src] of [['app.js', js], ['index.html', html]]) {
    assert.doesNotMatch(src, /All sessions → delete old ones|delete old sessions soon|delete old sessions in Settings soon/,
      `${name} still points at a delete that is not there`);
  }
  assert.ok(htmlIds.has('saveFree'), 'the banner has its own way to the list');
  assert.match(js, /\$\('saveFree'\)\.addEventListener\('click', \(\) => \{[\s\S]{0,160}openSessionList\(\{ deleting: true \}\);/,
    'and it opens the session list with Delete sessions already on');
  /* But never from a recording screen: leaving one with the GPS running
     strands the walk with no way back to Stop. */
  assert.match(bodyOf('showSaveTrouble'), /\$\('saveFree'\)\.hidden = !e\.full \|\| !!liveScreen\(\);/,
    'shown when the phone is full, and never over a recording');
  assert.match(js, /if \(liveScreen\(\)\) return toast\('Stop the recording first/, 'and refuses if one starts meanwhile');
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
  assert.match(bodyOf('contamSim'), /new ScentSim\(\{ pool: false \}\)/,
    'contamination is walked through: nobody stands at the end of it');
  const open = bodyOf('openReplay');
  assert.match(open, /plumeStart\(trailOf\(s\), w0, plume\.T, s\.data\.contamination,\s*\{ at: replay\.at, since: replay\.from \}\)/,
    'on the replay’s clock, pruned by the start of the run, in the wind of that moment');
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
    /if \(d\.kind === 'walk'\) \{[\s\S]{0,400}walk\.card = d\.plan;\s*\n\s*walk\.offAt = d\.offAt \|\| 0;[\s\S]{0,1400}return keepWalk\(\);/,
    'a recovered walk is finished the way the button finishes one, asking the same question if it stopped short');
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
  assert.match(hold, /if \(\(isNative\(\) && !\(coach\.on && rec\.kind === 'run'\)\) \|\| !rec\.on \|\| rec\.lock \|\| document\.visibilityState !== 'visible'\) return;/,
    'in the app only while the coach is on for a run, whose calls need the screen');
  assert.match(hold, /lock\.addEventListener\?\.\('release', \(\) => \{ if \(rec\.lock === lock\) rec\.lock = null; \}\);/,
    'a lock the browser let go of is known to be gone');
  assert.match(js, /document\.addEventListener\('visibilitychange', \(\) => \{\s*\n\s*if \(document\.visibilityState !== 'visible'\) return;\s*\n\s*holdScreen\(\);/,
    'and asked for again when the page comes back');
  const watch = fnSrc('async function startWatch(hudId)');
  assert.match(watch, /await holdScreen\(\);/);
  assert.ok(!/wakeLock/.test(watch), 'one place asks for the lock');
});

/* In the iPhone app a run records with the screen dark, and the app said the
   phone could go in a pocket. The coach's calls cannot play then: iOS gives
   a dark app no sound, speech or buzz. So a coached run says so where the
   handler will read it. The hold itself is run in screens.test.mjs. */
t('in the iPhone app a coached run says its calls need the screen on', () => {
  const watch = fnSrc('async function startWatch(hudId)');
  assert.match(watch, /message: coach\.on && rec\.kind === 'run' \? 'Recording\. Coach calls need the screen on' : 'Recording — the phone can go in your pocket'/,
    'a coached run does not promise the pocket, and a lay or walk is never a coached run');
  /* A run whose GPS would not start left the coach on, and the next lay held
     the screen awake and said the coach needed it. */
  assert.match(fnSrc('async function startRun(s) {'),
    /if \(!\(await startWatch\('runHudText'\)\)\) \{ coachStop\(\); dropRunCopy\(\); return go\('scrHome'\); \}/,
    'a run that never started turns its coach off');
  assert.match(watch, /if \(!rec\.bg\) \{[^\n]*\}\s*\n\s*holdScreen\(\);/, 'the app asks to hold the screen once it records');
  assert.match(fnSrc('async function stopWatch()'), /await letScreenGo\(\);/);
  const sync = fnSrc('function coachSync()');
  assert.match(sync, /holdScreen\(\);/, 'turned on mid-run, the coach asks for the screen');
  assert.match(sync, /if \(isNative\(\)\) letScreenGo\(\);/, 'turned off, the app goes back to recording in the dark');
  assert.match(fnSrc('function paintCoachControls()'),
    /const dark = isNative\(\) \? ' Calls only play while the screen is on, so keep it awake during a coached run\.' : '';/);
  assert.match(fnSrc('function paintCoachControls()'), /\$\('coachNote'\)\.textContent = \(canBuzz[\s\S]*\) \+ dark;/);
  assert.match(fnSrc('async function startRun(s) {'),
    /toast\(isNative\(\) && coach\.on \? 'Coach on\. Its calls only play while the screen is on'/);
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

/* ── Hostile links, at the screen end ─────────────────────────────────
   share.js cleans what a link carries, but runs kept before it did are
   already saved and backed up. So the screens that show a kept run, and the
   rows synced from the cloud, escape what they write into markup. */
const escSrc = js.match(/^const esc = .*$/m)[0];

t('the result grid escapes every value, whatever the saved result holds', () => {
  const src = bodyOf('renderResult');
  const cellSrc = src.match(/const cell = \(b, i, sub = ''\) =>\n?[^;]*;/)?.[0];
  assert.ok(cellSrc, 'renderResult still builds its grid with cell()');
  const cell = new Function(`${escSrc}\n${cellSrc}\nreturn cell;`)();
  const xss = '<img src=x onerror=alert(document.domain)>';
  const out = cell(xss, `of the time ${xss}`, `${xss} min`);
  assert.doesNotMatch(out, /<img/, 'a crafted approach or side is text, not markup');
  assert.match(out, /&lt;img src=x onerror=alert\(document\.domain\)&gt;/);
  /* Every call in the grid goes through cell(): nothing is concatenated
     around it where the escaping would not reach. */
  for (const m of src.matchAll(/\$\('resGrid'\)\.innerHTML =([\s\S]*?);\n/g)) {
    assert.doesNotMatch(m[1].replace(/cell\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\)/g, ''), /[`'"]/,
      'the grid is cells and nothing else');
  }
  assert.doesNotMatch(src, /cell\(`\$\{r\.ageMin\} min`/, 'an age that is not a number reads as a dash');
  assert.match(src, /Number\.isFinite\(r\.ageMin\) \? `\$\{r\.ageMin\} min` : '—'/);
});

t('a photo from a synced record cannot break out of the avatar markup', () => {
  const avaSrc = js.slice(js.indexOf('const PHOTO_RE = '), js.indexOf('\n};\n', js.indexOf('const avaHtml = ')) + 3);
  const avaHtml = new Function(`${escSrc}\n${avaSrc}\nreturn avaHtml;`)();
  const hostile = avaHtml({ name: 'Bo', photo: 'x)" onmouseover="alert(1)' });
  assert.doesNotMatch(hostile, /onmouseover|style=/);
  assert.doesNotMatch(avaHtml({ name: 'Bo', photo: 'javascript:alert(1)' }), /style=/);
  const real = avaHtml({ name: 'Bo', photo: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==' });
  assert.match(real, /style="background-image:url\(data:image\/jpeg;base64,\/9j\/4AAQSkZJRg==\)"/);
  assert.match(real, /has-photo/);
});

t('record ids from the cloud are escaped wherever they go into markup', () => {
  const attrs = ['data-handler', 'data-dog', 'data-layer', 'data-open-session', 'data-del-session', 'data-run-session',
    'data-dog-card', 'data-edit-handler', 'data-edit-layer', 'data-add-dog-for', '<option value'];
  let seen = 0;
  for (const a of attrs) {
    for (const m of js.matchAll(new RegExp(`${a}="\\$\\{([^}]*)\\}"`, 'g'))) {
      seen++;
      assert.match(m[1], /^esc\(/, `${a}="\${${m[1]}}" is written unescaped`);
    }
  }
  assert.ok(seen >= 14, `found the id attributes (${seen})`);
});

t('Save GPX and Save PDF say when a file cannot be made, rather than doing nothing', () => {
  assert.match(fnSrc('async function saveGpx('), /try \{[\s\S]*toGpx\(m[,)][\s\S]*\} *\n? *catch \{ toast\('Could not make the file'\); \}/);
  assert.match(fnSrc('async function savePdf('), /try \{[\s\S]*buildPdf\([\s\S]*\} catch \{\n\s*toast\('Could not make the report'\);/);
});

/* Share live with no signal: the tap used to wait on the cloud with nothing
   on screen, a second tap started a second run with its own timer, and a
   start that landed after Stop left a link open that nothing would end.
   Waiting and giving up are run for real in sync-flow.test.mjs. */
t('Share live says when there is no signal, starts one run at a time, and takes back a start that came too late', () => {
  const go = fnSrc('async function goLive()');
  assert.match(go, /if \(!run\.session \|\| liveStarting\) return;/, 'a second tap while it starts does nothing');
  assert.match(go, /if \(navigator\.onLine === false\) return toast\('No signal/, 'no signal is said at once');
  const busy = go.indexOf('liveStarting = true'), ask = go.indexOf('await startLive('), free = go.indexOf('finally { liveStarting = false;');
  assert.ok(busy > 0 && busy < ask && ask < free, 'busy from before it asks until it has an answer');
  assert.match(go, /const same = \(\) => rec\.on && rec\.kind === 'run' && !run\.stopping && run\.session\?\.id === sid && run\.startedAt === from;/);
  assert.ok(go.indexOf('if (liveState || !same()) return dropLive(id);') > free
    && go.indexOf('if (liveState || !same()) return dropLive(id);') < go.indexOf('setInterval('),
    'a run that ended, or one already live, is taken back before any timer starts');
  assert.equal(go.match(/setInterval\(/g).length, 1, 'one timer, made in one place');
  assert.match(fnSrc('function paintLiveBtn()'), /b\.disabled = liveStarting;/, 'the button shows it is busy');
  assert.match(syncJs, /export async function startLive\(meta, \{ waitMs = LIVE_WAIT \} = \{\}\)[\s\S]{0,900}Promise\.race\(\[wrote, late\]\)[\s\S]{0,200}dropLive\(id\);\s*throw/,
    'the cloud gets a limited wait, and a start given up on is taken back');
});

/* Anyone can make an account, so a live run is checked, not trusted. That
   what the app writes passes these checks is run in sync-flow.test.mjs. */
t('a live run holds only what the app writes, within limits, and cannot outlive two days', () => {
  const live = rules.slice(rules.indexOf('match /live/{liveId}'), rules.indexOf('match /{document=**}'));
  assert.match(live, /allow create: if request\.auth != null && liveRun\(request\.resource\.data\);/);
  assert.match(live, /allow update: if request\.auth != null && resource\.data\.uid == request\.auth\.uid\s*&& liveRun\(request\.resource\.data\);/,
    'only the owner changes a run, and it is checked again');
  const run = live.slice(live.indexOf('function liveRun('), live.indexOf('function column('));
  assert.match(run, /d\.keys\(\)\.hasOnly\(\[/, 'no fields beyond the app’s own');
  assert.match(run, /&& d\.uid == request\.auth\.uid/, 'written under the account writing it, and it stays that account’s');
  assert.match(run, /&& expires\(d\)/);
  assert.match(live, /function expires\(d\) \{\s*return d\.expiresAt is number && d\.expiresAt <= request\.time\.toMillis\(\) \+ 172800000\s*&& \(!\('deleteAt' in d\) \|\| \(d\.deleteAt is timestamp && d\.deleteAt <= request\.time \+ duration\.value\(48, 'h'\)\)\);/,
    'an expiry at most two days off, and a Timestamp copy of it when the build writes one — older builds still share live');
  /* The setup guide told the owner an older phone is refused when it shares
     live, and named the last such build by a stamp the next deploy replaces. */
  const guide = readFileSync(new URL('../docs/SIGN-IN-SETUP.md', import.meta.url), 'utf8');
  const said = guide.slice(guide.indexOf('## Live sharing'), guide.indexOf('2. **Clean-up.**')).replace(/\s+/g, ' ');
  assert.ok(!/is refused when it shares live/.test(said), 'the rules no longer refuse a run without deleteAt');
  assert.match(said, /Builds after 2026-09-24a also give each live run a `deleteAt` field/, 'true of every build deployed from here on');
  assert.match(said, /can go on sharing live, but its runs are never cleaned up/);
  assert.match(live, /v is map && v\.get\('__pts', -1\) is int && v\.get\('__pts', -1\) >= 0 && v\.get\('__pts', -1\) <= n/, 'a line says how many points, within a cap');
  assert.match(run, /points\(d\.get\('trail', null\), 50000\)/);
  assert.match(run, /d\.get\('contamination', \[\]\) is list && d\.get\('contamination', \[\]\)\.size\(\) <= 200/);
  const chunks = live.slice(live.indexOf('match /chunks/{chunk}'));
  assert.match(chunks, /allow create, update: if request\.auth != null[\s\S]{0,120}\.data\.uid == request\.auth\.uid\s*&& livePiece\(request\.resource\.data, chunk\);/);
  assert.ok(!/allow write/.test(chunks), 'no unchecked write left on the chunks');
  const piece = live.slice(live.indexOf('function livePiece('), live.indexOf('// get = opening one run'));
  assert.match(piece, /d\.n is int && d\.n >= 0 && d\.n <= 2880 && id == string\(d\.n\)/, 'a chunk is one minute of two days');
  assert.match(piece, /d\.get\('__pts', -1\) >= 1 && d\.get\('__pts', -1\) <= 3000/);
});

/* "Export everything" was a bare download link, which in the iPhone app does
   nothing and says nothing, into a file nothing could read back, while Wipe
   told handlers to export first. The pure parts are in backup.test.mjs and
   native.test.mjs; this is the glue. */
t('the backup leaves through the share sheet, and Restore reads it back only after asking', () => {
  const at = js.indexOf("$('btnExportAll').addEventListener");
  const exp = js.slice(at, at + 400);
  assert.match(exp, /deliverFile\(db\.exportAll\(\), `trailcraft-backup-[^`]*\.json`, 'application\/json'\)/,
    'the same way out as every other file');
  assert.ok(!/createObjectURL|\.download = /.test(exp), 'no bare download link of its own');
  const deliver = fnSrc('async function deliverFile(');
  assert.match(deliver, /if \(isNative\(\)\) \{\s*const how = await shareFile\(bytes, name\);[\s\S]{0,160}return;\s*\}\s*const a = document\.createElement\('a'\)/,
    'inside the app the plugins take the file; the download link is only for a browser');
  assert.ok(deliver.indexOf('navigator.canShare') < deliver.indexOf('isNative()'), 'the web view’s own share sheet first, where it has one');

  assert.match(html, /<input id="restoreFile" type="file" accept="application\/json,\.json" hidden>/);
  assert.match(html, /id="btnRestore">Restore from a backup file</);
  assert.match(html, /id="obRestore" hidden>Restore from a backup file</, 'on the first screen too, so nobody makes up a profile to reach it');
  assert.match(bodyOf('openHandlerForm'), /\$\('obRestore'\)\.hidden = !firstLaunch;/);
  assert.match(bodyOf('openLayerForm'), /\$\('obRestore'\)\.hidden = true;/);
  assert.match(js, /\$\('restoreFile'\)\.addEventListener\('change', \(e\) => \{\s*const f = e\.target\.files\?\.\[0\];\s*e\.target\.value = '';\s*restoreBackup\(f\);/,
    'the same file can be chosen twice');

  const restore = fnSrc('async function restoreBackup(');
  const steps = ['file.size > BACKUP_MAX_BYTES', 'readBackup(await file.text())', 'db.previewRestore(backup)',
    'restoreChanges(plan)', 'confirm(restoreQuestion(plan, when))', 'db.restore(backup)'];
  let last = -1;
  for (const step of steps) {
    const i = restore.indexOf(step);
    assert.ok(i > last, `restoreBackup does "${step}" in order`);
    last = i;
  }
  assert.match(restore, /catch \(e\) \{ return toast\(e\?\.plain \? e\.message : 'Could not read that file'\); \}/, 'a refused file is said in words');
  assert.match(restore, /if \(e\?\.name !== 'SaveError'\) throw e;/, 'a full phone is said, anything else is not swallowed');

  assert.ok(!/Export (everything )?first/.test(js), 'no confirm still promises that exporting keeps anything');
  assert.match(js, /all profiles\. Save a backup file first if you want them back later\./);
  assert.match(js, /They go\. Save a backup file first if you want to keep them\./);
});

/* "Blind run — no prompts" was said of runs whose trail had been revealed. */
t('the result card never calls a run blind when the trail was on screen', () => {
  const words = bodyOf('coachWords');
  assert.match(words, /function coachWords\(c, d = null\)/);
  assert.match(words, /if \(trailShown\(d\)\) \{[\s\S]*return `Coach off, but \$\{when\}, so this was not a blind run\.\$\{had\}`;/);
  /* Nothing is called blind but through the one shared test (ranBlind). */
  assert.match(words, /if \(ranBlind\(\{ \.\.\.d, coach: c \}\)\) return `Blind run — no prompts\.\$\{had\}`;/);
  assert.equal(words.match(/Blind run/g).length, 1, 'and only there');
  assert.match(js, /\$\('resCoach'\)\.textContent = coachWords\(s\.data\.coach, s\.data\);/);
  assert.match(js, /`assisted \/ blind runs\$\{st\.shown \? ` \\u00b7 \$\{st\.shown\} with the trail shown` : ''\}`/,
    'the handler card says how many were neither');
  assert.match(js, /\(st\.knew \? ` \\u00b7 \$\{st\.knew\} where the handler knew` : ''\)/);
});

/* A search with no indication was timed against the wall clock, so a run kept
   after a crash read "searched 187:30"; and the distance to the hide was
   always in metres, whatever the handler's units. */
t('a search is timed by its own track, and its distance to the hide is in the handler’s units', () => {
  const search = bodyOf('searchResult');
  assert.doesNotMatch(search, /Date\.now\(\)/, 'nothing in grading a search reads the wall clock');
  assert.match(search, /const first = track\[0\]\?\.t, last = track\[track\.length - 1\]\?\.t;/);
  assert.match(search, /searched \$\{fmtDur\(dur\)\} — no indication marked\./);
  assert.match(search, /\$\{fmtM\(catchM\)\} from the hide/);
  assert.doesNotMatch(js, /\$\{catchM\} m\b|\$\{r\.catchM\} m\b/, 'no distance to a hide is written in bare metres');
  assert.match(js, /cell\(r\.catchM != null \? `\$\{r\.catchApprox \? '~' : ''\}\$\{fmtM\(r\.catchM\)\}` : '—', 'from the hide'\)/);
});

/* A drawn plan's age is made up and too old, and was shown as a fact. */
t('a run graded against a drawn plan is given no trail age, and the result shows none', () => {
  const grade = js.slice(js.indexOf('async function computeResult('), js.indexOf('\nfunction searchResult('));
  assert.match(grade, /const ageMin = unwalkedPlan\(s\.data\) \? null : Math\.max\(0, Math\.round\(\(startedAt - s\.startedAt\) \/ 60000\)\);/);
  const show = js.slice(js.indexOf('\nfunction renderResult('), js.indexOf('\nfunction walkVsPlan('));
  assert.match(show, /const age = !drawnOnly && Number\.isFinite\(r\.ageMin\)/, 'an older result\u2019s made-up age is not shown');
  assert.match(show, /cell\(age, 'trail age at start', drawnOnly \? 'known once the walk is scanned' : ''\)/);
  assert.doesNotMatch(js, /ageBand\(x\.data\.result\?\.ageMin\)/, 'the run lists file ages through runAgeMin');
});

/* The run screen said "and you were right" of any first call on a run that
   ended in a find, wherever the find was. */
t('the result card only says a call was right when it was made where the find was', () => {
  const block = bodyOf('paintCallBlock');
  assert.doesNotMatch(block, /else if \(d\.outcome === 'found'\) tail = ', and you were right\.';/);
  assert.match(block, /const at = firstCallWasFind\(s\);\s*\n\s*tail = at === true \? ', and you were right\.'/);
  assert.match(block, /else if \(why === 'later-find'\) tail \+= ' This one doesn’t count towards your record\.';/);
});

/* The coach line said "Blind run — no prompts" of a coach-off run the
   debrief said the handler knew, on the same screen as "you knew the
   answer". And a link's odd fields printed "null calls with a — corridor". */
t('the coach line on the result card is blind only when nobody knew, and prints no placeholders', () => {
  const sb = { fmtM: (m, dp = 0) => fmtShort(m, false, dp), fmtDur, ranBlind, trailShown };
  vm.createContext(sb);
  vm.runInContext(bodyOf('coachWords'), sb);
  const off = { assisted: false, shadow: { tolM: 20, plain: 2, scent: 1 } };
  assert.equal(sb.coachWords(off, { revealedAt: null }),
    'Blind run — no prompts. Had the coach been on: 2 calls with a 20 m corridor, 1 call with the scent corridor.');
  const knew = sb.coachWords(off, { debrief: { outcome: 'found', blind: 'open' } });
  assert.match(knew, /^Coach off, but the debrief says the handler knew the answer, so this was not a blind run\./);
  assert.doesNotMatch(knew, /Blind run/);
  assert.match(sb.coachWords(off, { revealedAt: 65e3, trackStarted: 0 }), /the trail was shown on screen 1:05 into the run/);
  for (const shadow of [{}, { plain: null, tolM: null, scent: null }, { plain: 'x', tolM: {} }, null]) {
    assert.equal(sb.coachWords({ assisted: false, shadow }, {}), 'Blind run — no prompts.', JSON.stringify(shadow));
  }
  assert.equal(sb.coachWords({ assisted: false, shadow: { plain: 3 } }, {}), 'Blind run — no prompts.',
    'a count with no corridor is not said as "a — corridor"');
  assert.equal(sb.coachWords({ assisted: true, tolM: null, calls: null }, {}), 'Assisted run — the coach was on.');
  assert.equal(sb.coachWords({ assisted: true, tolM: 20, scent: true, calls: 2 }, {}),
    'Assisted run — the coach was on with a 20 m corridor and the experimental scent corridor, and made 2 calls.');
  assert.equal(sb.coachWords({ assisted: true, scent: true }, {}), 'Assisted run — the coach was on with the experimental scent corridor.');
});

console.log(`\n${pass} passed total\n`);
