/* The map and sign-in libraries ship inside the app (public/vendor/) and the
   page's Content-Security-Policy refuses script from anywhere else. Inside the
   iPhone app that page also holds the bridge to location and files, so this
   is what stands between a CDN that serves the wrong bytes and the phone.

   Nothing here touches the network: the copies are checked against the
   record npm run vendor made when it took them from the registry, and the
   policy is read from index.html. */

import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PACKAGES, untar, localiseFirebase, integrityOf, sha256 } from '../scripts/vendor.mjs';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url));
const text = (rel) => read(rel).toString('utf8');

let pass = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);

const lock = JSON.parse(text('scripts/vendor.lock.json'));
const html = text('public/index.html');
const sync = text('public/sync.js');

/* The policy as { directive: [sources] }. */
const cspMeta = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/);
const csp = Object.fromEntries((cspMeta?.[1] ?? '').split(';').map((d) => d.trim().split(/\s+/)).filter((d) => d[0])
  .map(([k, ...v]) => [k, v]));

/* ── The copies ───────────────────────────────────────────────────── */

t('every vendored file is exactly what was taken from the registry', () => {
  assert.deepEqual(Object.keys(lock), PACKAGES.map((p) => `${p.name}@${p.version}`));
  for (const pkg of PACKAGES) {
    const entry = lock[`${pkg.name}@${pkg.version}`];
    assert.equal(entry.integrity, pkg.integrity, `${pkg.name}: the lock and the pinned integrity agree`);
    assert.match(entry.integrity, /^sha512-[A-Za-z0-9+/]{86}==$/);
    assert.deepEqual(Object.keys(entry.files), Object.values(pkg.files));
    for (const [file, want] of Object.entries(entry.files)) {
      const rel = `public/vendor/${pkg.name}-${pkg.version}/${file}`;
      const body = read(rel);
      assert.equal(body.length, want.bytes, `${rel} size`);
      assert.equal(sha256(body), want.sha256, `${rel} has changed since npm run vendor took it`);
    }
  }
});

t('the map libraries are byte for byte the registry files; Firebase differs only in its imports', () => {
  for (const name of ['mapbox-gl@3.14.0', 'maplibre-gl@4.7.1']) {
    for (const f of Object.values(lock[name].files)) assert.equal(f.sourceSha256, undefined, `${name} is not edited`);
  }
  const dir = 'public/vendor/firebase-12.3.0';
  for (const f of ['firebase-app.js', 'firebase-auth.js', 'firebase-firestore.js']) {
    const src = text(`${dir}/${f}`);
    assert.doesNotMatch(src, /(from|import)\s*\(?\s*["']https?:/, `${f} imports nothing from another host`);
  }
  for (const f of ['firebase-auth.js', 'firebase-firestore.js']) {
    assert.equal(text(`${dir}/${f}`).split('from"./firebase-app.js"').length, 2, `${f} imports the copy beside it`);
  }
});

t('the import rewrite takes exactly one gstatic import, or refuses', () => {
  const gs = 'from"https://www.gstatic.com/firebasejs/12.3.0/firebase-app.js"';
  assert.equal(localiseFirebase('firebase-auth.js', `import{a}${gs};x()`, '12.3.0'), 'import{a}from"./firebase-app.js";x()');
  assert.throws(() => localiseFirebase('firebase-auth.js', 'x()', '12.3.0'), /found 0/);
  assert.throws(() => localiseFirebase('firebase-auth.js', `${gs}${gs}`, '12.3.0'), /found 2/);
  assert.throws(() => localiseFirebase('firebase-auth.js', `${gs};import"https://evil.test/x.js"`, '12.3.0'), /another host/);
  assert.equal(localiseFirebase('firebase-app.js', 'same', '12.3.0'), 'same');
});

/* A tar archive by hand: a 512-byte header per file, the body padded to 512. */
function tarOf(files) {
  const blocks = [];
  for (const [name, body] of Object.entries(files)) {
    const head = Buffer.alloc(512);
    head.write(name, 0, 'latin1');
    head.write(body.length.toString(8).padStart(11, '0'), 124, 'latin1');
    head.write('0', 156, 'latin1');
    blocks.push(head, Buffer.concat([Buffer.from(body), Buffer.alloc((512 - (body.length % 512)) % 512)]));
  }
  return Buffer.concat([...blocks, Buffer.alloc(1024)]);
}

t('the archive reader finds each named file and stops at the end', () => {
  const big = 'x'.repeat(700);
  const files = untar(tarOf({ 'package/a.js': 'one', 'package/dist/b.css': big, 'package/c.txt': '' }));
  assert.equal(files.get('package/a.js').toString(), 'one');
  assert.equal(files.get('package/dist/b.css').toString(), big);
  assert.equal(files.get('package/c.txt').length, 0);
  assert.equal(files.size, 3);
  assert.equal(integrityOf(Buffer.from('abc')), `sha512-${createHash('sha512').update('abc').digest('base64')}`);
});

/* ── Where the page loads them from ───────────────────────────────── */

t('the page loads every script and the map styles from itself, none from a CDN', () => {
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(scripts.includes('vendor/mapbox-gl-3.14.0/mapbox-gl.js'));
  assert.ok(scripts.includes('vendor/maplibre-gl-4.7.1/maplibre-gl.js'));
  for (const s of scripts) assert.doesNotMatch(s, /^(https?:)?\/\//, `${s} is loaded from another host`);
  const sheets = [...html.matchAll(/<link rel="stylesheet"[^>]*href="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(sheets.includes('vendor/mapbox-gl-3.14.0/mapbox-gl.css'));
  assert.ok(sheets.includes('vendor/maplibre-gl-4.7.1/maplibre-gl.css'));
  for (const s of sheets) assert.ok(!/^https?:/.test(s) || s.startsWith('https://fonts.googleapis.com/'), s);
  for (const s of [...scripts, ...sheets].filter((s) => s.startsWith('vendor/'))) {
    assert.ok(existsSync(new URL(`../public/${s}`, import.meta.url)), `${s} is in public/`);
  }
  assert.doesNotMatch(html, /cdn\.jsdelivr\.net|mapbox-gl-js\/v|www\.gstatic\.com\/firebasejs/);
});

t('sync.js imports Firebase from the vendored copy, at the pinned version', () => {
  const fb = PACKAGES.find((p) => p.name === 'firebase');
  assert.match(sync, new RegExp(`const SDK = '\\./vendor/firebase-${fb.version.replace(/\./g, '\\.')}';`));
  assert.doesNotMatch(sync, /gstatic\.com\/firebasejs/);
  for (const f of ['app', 'auth', 'firestore']) assert.ok(sync.includes(`import(\`\${SDK}/firebase-${f}.js\`)`));
});

/* ── The policy ───────────────────────────────────────────────────── */

t('the policy comes before anything the page loads or runs', () => {
  assert.ok(cspMeta, 'index.html has a Content-Security-Policy');
  const at = html.indexOf(cspMeta[0]);
  for (const tag of ['<script', '<link', '<style']) {
    const first = html.indexOf(tag);
    assert.ok(first === -1 || at < first, `the policy precedes the first ${tag}`);
  }
});

t('script runs only from the app itself, the one theme script by its hash, and Google\'s sign-in helper', () => {
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.equal(inline.length, 1, 'one inline script: the theme, before first paint');
  const hash = `'sha256-${createHash('sha256').update(inline[0]).digest('base64')}'`;
  assert.deepEqual(csp['script-src'], ["'self'", hash, 'https://apis.google.com'],
    `the theme script changed: its hash is now ${hash}`);
  for (const [k, v] of Object.entries(csp)) {
    assert.ok(!v.includes("'unsafe-eval'"), `${k} allows eval`);
    if (k !== 'style-src') assert.ok(!v.includes("'unsafe-inline'"), `${k} allows inline`);
    for (const src of v) assert.ok(src !== '*' && src !== 'https:' && src !== 'http:', `${k} allows ${src}`);
  }
  assert.deepEqual(csp['default-src'], ["'self'"]);
  assert.deepEqual(csp['object-src'], ["'none'"]);
  assert.deepEqual(csp['base-uri'], ["'self'"]);
  assert.deepEqual(csp['form-action'], ["'self'"]);
  // Map libraries start their workers from blob: addresses; the service worker is the app's own.
  assert.deepEqual(csp['worker-src'], ["'self'", 'blob:']);
  assert.deepEqual(csp['child-src'], ["'self'", 'blob:'], 'iOS 15.0 to 15.4 read workers from child-src');
});

t('every outside address the app asks for is allowed, and nothing else', () => {
  const app = text('public/app.js');
  const fetched = new Set([...app.matchAll(/fetch\(`https:\/\/([a-z0-9.-]+)\//g)].map((m) => m[1]));
  for (const h of ['firestore.googleapis.com', 'api.mapbox.com']) assert.ok(fetched.has(h), h);
  assert.match(app, /`https:\/\/api\.open-meteo\.com\/v1\/forecast/);
  assert.match(app, /'https:\/\/tile\.openstreetmap\.org\/\{z\}/);
  const connect = csp['connect-src'];
  for (const h of [...fetched, 'api.open-meteo.com', 'tile.openstreetmap.org', 'events.mapbox.com',
                   'identitytoolkit.googleapis.com', 'securetoken.googleapis.com']) {
    assert.ok(connect.includes(`https://${h}`), `connect-src allows ${h}`);
  }
  assert.deepEqual(connect.filter((s) => s !== "'self'").map((s) => new URL(s).hostname).sort(), [
    'api.mapbox.com', 'api.open-meteo.com', 'events.mapbox.com', 'firestore.googleapis.com',
    'identitytoolkit.googleapis.com', 'securetoken.googleapis.com', 'tile.openstreetmap.org',
  ]);
  assert.deepEqual(csp['img-src'], ["'self'", 'data:', 'blob:', 'https://api.mapbox.com', 'https://tile.openstreetmap.org',
    ...[3, 4, 5, 6].map((n) => `https://lh${n}.googleusercontent.com`)], 'and the Google profile photo on the account card');
  /* The photo address only arrives at run time, so the account card draws
     only what profilePhoto (sync-core.js) lets through: those same hosts. */
  const app2 = text('public/app.js');
  assert.match(app2, /const photo = profilePhoto\(u\.photo\);/);
  assert.ok(!/src="\$\{esc\(u\.photo\)\}"/.test(app2), 'the raw photo address is never drawn');
  assert.match(text('public/sync-core.js'), /\/\^lh\[3-6\]\\\.googleusercontent\\\.com\$\//, 'the same hosts the policy allows');
  assert.deepEqual(csp['media-src'], ["'self'", 'blob:'], 'clips and spoken notes play from blob: addresses');
  assert.deepEqual(csp['font-src'], ["'self'", 'https://fonts.gstatic.com']);
  const authDomain = text('public/firebase-config.js').match(/authDomain:\s*"([^"]+)"/)[1];
  assert.deepEqual(csp['frame-src'], [`https://${authDomain}`], 'only the sign-in helper may be framed');
});

t('no page in public/ loads script or styles from another host', () => {
  /* Everything in public/ is published on the app's own address and copied
     into the iPhone app, so a page there that ran a CDN's script could read
     every record and the saved sign-in. Only Google Fonts' stylesheet may
     come from outside; Google's sign-in helper is loaded by Firebase at run
     time and allowed by the policy, never by a tag. */
  assert.ok(!existsSync(new URL('../public/indoor.html', import.meta.url)), 'the indoor prototype lives in prototypes/');
  const pages = readdirSync(new URL('../public/', import.meta.url)).filter((f) => f.endsWith('.html'));
  assert.ok(pages.includes('index.html') && pages.length >= 2);
  for (const page of pages) {
    const src = text(`public/${page}`);
    for (const [tag] of src.matchAll(/<script\b[^>]*>/gi)) {
      const at = tag.match(/\ssrc\s*=\s*["']?([^"'\s>]+)/i)?.[1];
      if (at) assert.ok(!/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(at), `${page}: ${tag}`);
    }
    for (const [tag] of src.matchAll(/<link\b[^>]*>/gi)) {
      if (!/rel\s*=\s*["']?[^"'>]*\b(?:stylesheet|modulepreload|preload)\b/i.test(tag)) continue;
      const at = tag.match(/\shref\s*=\s*["']?([^"'\s>]+)/i)?.[1] ?? '';
      if (/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(at)) {
        assert.equal(new URL(at, 'https://x/').hostname, 'fonts.googleapis.com', `${page}: ${tag}`);
      }
    }
  }
});

/* ── The Desktop copy ─────────────────────────────────────────────── */

t('the single-file Desktop copy drops the policy and loads the same versions from their CDNs', () => {
  const build = text('scripts/build-single.mjs');
  assert.match(build, /html = html\.replace\(\/<!-- What this page may load and run/);
  assert.match(html, /<!-- What this page may load and run\.[\s\S]*?-->\n<meta http-equiv="Content-Security-Policy"/,
    'the build strips the comment and the policy together, so they must stay adjacent');
  for (const pkg of PACKAGES.filter((p) => p.name !== 'firebase')) {
    assert.ok(build.includes(`'vendor/${pkg.name}-${pkg.version}/`), `${pkg.name} is mapped`);
  }
  assert.ok(build.includes("'https://api.mapbox.com/mapbox-gl-js/v3.14.0/mapbox-gl.js'"));
  assert.ok(build.includes("'https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.js'"));
  assert.ok(build.includes(`const LOCAL_SDK = "const SDK = './vendor/firebase-12.3.0';";`));
  assert.ok(build.includes(`const CDN_SDK = "const SDK = 'https://www.gstatic.com/firebasejs/12.3.0';";`));
});

for (const [name, fn] of tests) {
  await fn();
  pass++;
  console.log(`  ok  ${name}`);
}
console.log(`\n${pass} passed total\n`);
