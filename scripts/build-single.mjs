/* Build dist/Trailcraft.html — the whole app as ONE file that opens from disk,
   no server, double-click and go.

   Why this exists: file:// forbids ES-module imports, so the nine modules are
   folded in. Naive concatenation would be a trap — geo.js and gesture.js both
   export project() and flattening them would silently cross-wire the scent
   maths into the spring physics — so each module becomes an IIFE namespace
   (__geo, __gesture, …) and every import statement becomes a destructuring
   from the right namespace. The vendored QR libraries inline as the classic
   scripts they already are. The map and sign-in libraries load from their
   makers' CDNs here, at the same pinned versions the app ships in vendor/:
   the map needs the network for tiles anyway, so inlining 2.4 MB would fatten
   the file without buying any offline ability, and file:// cannot import the
   Firebase modules from disk. For the same reason this copy drops the page's
   Content-Security-Policy: every script in it is inline, so a policy would
   have to allow inline script, which is what it is there to stop. This file
   only ever opens from this Mac's own disk; the website and the iPhone app
   keep the policy and the vendored copies.

   Run: node scripts/build-single.mjs   (or: npm run build) */

import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, posix } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pub = (f) => readFileSync(join(root, 'public', f), 'utf8');

/* Dependency order: roots first, then their dependents, app last. */
const MODULES = ['native', 'params', 'geo', 'colours', 'mvt', 'ground', 'debrief', 'marks', 'call', 'coach', 'field', 'walls', 'sim', 'card', 'contam', 'sync-core', 'dogtrack', 'backup', 'firebase-config', 'sync', 'store', 'log', 'draft', 'share', 'clip', 'pdf',
  /* The team levels: the engine, its words, the pixel art, then the board that draws with all three.
     The art is a folder of modules behind the one door, pixel-team: each needs only the ones before it. */
  'levels', 'teams',
  'pixel/core', 'pixel/ramps', 'pixel/lands', 'pixel/paint', 'pixel/terrain', 'pixel/dog', 'pixel/human', 'pixel/props', 'pixel/rope', 'pixel/states', 'pixel/moments', 'pixel/stones', 'pixel/layout',
  'pixel/scenery', 'pixel/tracks', 'pixel/landmarks', 'pixel/scene', 'pixel/ground', 'pixel/board-art', 'pixel/close', 'pixel/fx', 'pixel/ambient', 'pixel/team', 'pixel/player',
  'pixel-team', 'board'];

/** Inline-script safety: a literal "</script>" inside JS would end the tag.
    The escape is invisible at runtime (identical string value). */
const safe = (js) => js.replace(/<\/script/gi, '<\\/script');

/** Namespace identifier for a module file name — hyphens are not valid in
    JS identifiers, so engine-demo becomes __engine_demo. A module in a folder
    keeps the folder, with a $ for the slash: pixel/team is __pixel$team, which
    pixel-team (__pixel_team) can never be mistaken for. */
const ns = (name) => '__' + name.replace(/-/g, '_').replace(/\//g, '$');

/** The module an import names, as MODULES spells it: './core.js' asked for
    from pixel/dog is pixel/core, './pixel/core.js' from pixel-team the same. */
const resolve = (from, spec) => posix.normalize(posix.join(posix.dirname(from), spec));

/** `a, b as c` from an import or a re-export, as [name there, name here]. */
const pairs = (names) => names.split(',').map(n => n.trim()).filter(Boolean)
  .map(n => { const m = n.match(/^([\w$]+)(?:\s+as\s+([\w$]+))?$/); if (!m) throw new Error(`cannot read the name "${n}"`); return [m[1], m[2] || m[1]]; });

/** One module → an IIFE namespace. Imports become destructuring, exports are
    collected and returned. */
/* `import { a, b as c }` becomes `const { a, b: c }`. Written out as it was,
   `b as c` inside a destructuring is a syntax error — and one syntax error in
   the single inline module means the whole Desktop copy never runs. */
const destructure = (names) => names.replace(/\s+/g, ' ').trim()
  .replace(/\b([\w$]+)\s+as\s+([\w$]+)\b/g, '$1: $2');

/** A dependency must already be inlined when its dependent runs: one that is
    missing from MODULES, or listed after the module that needs it, would be
    a ReferenceError the moment the Desktop copy opened. */
function needs(name, spec) {
  const dep = resolve(name, spec);
  const at = MODULES.indexOf(dep), me = MODULES.indexOf(name);
  if (at < 0) throw new Error(`${name}.js imports ${dep}.js, which is not in MODULES`);
  if (me >= 0 && at > me) throw new Error(`${name}.js imports ${dep}.js, which MODULES lists after it`);
  return dep;
}

function toNamespace(name) {
  let src = pub(`${name}.js`);
  const preludes = [];

  /* `export { a, b } from './x.js'` hands on another module's names: the
     door a folder of modules is reached by (pixel-team.js) is made of these. */
  const handedOn = [];
  src = src.replace(/export\s*\{([\s\S]*?)\}\s*from\s*'(\.\.?\/[\w/-]+)\.js';?/g, (_, names, dep) => {
    for (const [there, here] of pairs(names)) handedOn.push(`${here}: ${ns(needs(name, dep))}.${there}`);
    return '';
  });

  src = src.replace(/import\s*\{([\s\S]*?)\}\s*from\s*'(\.\.?\/[\w/-]+)\.js';?/g, (_, names, dep) => {
    preludes.push(`const {${destructure(names)}} = ${ns(needs(name, dep))};`);
    return '';
  });

  const exported = [];
  src = src.replace(/^export\s+(async\s+function|function|class|const)\s+(\w+)/gm, (_, kind, id) => {
    exported.push(id);
    return `${kind} ${id}`;
  });
  if (/^export\s/m.test(src)) throw new Error(`${name}.js: unhandled export form`);
  if (!exported.length && !handedOn.length) throw new Error(`${name}.js: no exports found`);

  return `const ${ns(name)} = (() => {\n${preludes.join('\n')}\n${src}\nreturn { ${[...exported, ...handedOn].join(', ')} };\n})();`;
}

/** app.js is the program, not a library: imports become top-level
    destructuring, and the one dynamic import (demo mode) is rewired. */
function appBody() {
  let src = pub('app.js');
  const preludes = [];
  src = src.replace(/import\s*\{([\s\S]*?)\}\s*from\s*'\.\/([\w-]+)\.js';?/g, (_, names, dep) => {
    preludes.push(`const {${destructure(names)}} = ${ns(dep)};`);
    return '';
  });
  if (/from\s+'\.\//.test(src)) throw new Error('app.js: an import survived the transform');
  return `${preludes.join('\n')}\n${src}`;
}

/* sync.js imports Firebase from its copy in vendor/, which a page opened from
   disk cannot do; here it comes from Google's CDN, at the same version. */
const LOCAL_SDK = "const SDK = './vendor/firebase-12.3.0';";
const CDN_SDK = "const SDK = 'https://www.gstatic.com/firebasejs/12.3.0';";
let bundle = [
  `/* Trailcraft single-file build — generated ${new Date().toISOString().slice(0, 16)}Z. Source of truth: the modules in public/. */`,
  ...MODULES.map(toNamespace),
  appBody(),
].join('\n\n');
if (bundle.split(LOCAL_SDK).length !== 2) throw new Error('sync.js: the Firebase SDK address changed; update build-single.mjs');
bundle = bundle.replace(LOCAL_SDK, () => CDN_SDK);

let html = pub('index.html');

// The file build has no server: no manifest, no service worker to register
// (app.js's registration is failure-guarded, but the link tag would 404).
html = html.replace(/<link rel="manifest"[^>]*>\n?/, '');

// The token rides along in the single file when the local token.js exists
// (dist/ is gitignored, so this never reaches the public repository).
let tokenJs = '';
try { tokenJs = readFileSync(join(root, 'public', 'token.js'), 'utf8'); } catch { /* fine — Settings field */ }
html = html.replace(/<script src="token\.js"><\/script>/,
  () => tokenJs ? `<script>\n${safe(tokenJs)}\n</script>` : '');

html = html.replace(
  /<link rel="stylesheet" href="app\.css">/,
  () => `<style>\n${pub('app.css')}\n</style>`);

html = html.replace(/<!-- What this page may load and run\.[\s\S]*?-->\n<meta http-equiv="Content-Security-Policy"[^>]*>\n?/, '');

/* The pinned libraries, from the CDNs that publish the same versions. */
const CDN = {
  'vendor/mapbox-gl-3.14.0/mapbox-gl.js': 'https://api.mapbox.com/mapbox-gl-js/v3.14.0/mapbox-gl.js',
  'vendor/mapbox-gl-3.14.0/mapbox-gl.css': 'https://api.mapbox.com/mapbox-gl-js/v3.14.0/mapbox-gl.css',
  'vendor/maplibre-gl-4.7.1/maplibre-gl.js': 'https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.js',
  'vendor/maplibre-gl-4.7.1/maplibre-gl.css': 'https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.css',
};
for (const [local, cdn] of Object.entries(CDN)) {
  const before = html;
  html = html.replace(`"${local}"`, () => `"${cdn}"`);
  if (html === before) throw new Error(`index.html no longer loads ${local}: update CDN in build-single.mjs`);
}

html = html.replace(/<script src="vendor\/qrcode\.js"><\/script>/, () => `<script>\n${safe(pub('vendor/qrcode.js'))}\n</script>`);
html = html.replace(/<script src="vendor\/jsQR\.js"><\/script>/, () => `<script>\n${safe(pub('vendor/jsQR.js'))}\n</script>`);
html = html.replace(/<script src="app\.js" type="module"><\/script>/, () => `<script type="module">\n${safe(bundle)}\n</script>`);

for (const leftover of ['href="app.css"', 'src="app.js"', 'vendor/qrcode.js"', 'vendor/jsQR.js"', '"vendor/', '<meta http-equiv="Content-Security-Policy"']) {
  if (html.includes(leftover)) throw new Error(`assembly incomplete: ${leftover} still referenced`);
}

/* The build must prove the page will actually run, not just that it was
   written. A bundle that does not parse is a page whose every button is dead,
   and until this check existed that shipped for days looking like success. */
{
  const probe = join(tmpdir(), `trailcraft-bundle-${process.pid}.mjs`);
  writeFileSync(probe, bundle);
  try {
    execFileSync(process.execPath, ['--check', probe], { stdio: 'pipe' });
  } catch (e) {
    throw new Error(`the single-file bundle does not parse:\n${String(e.stderr || e.message).slice(0, 600)}`);
  } finally {
    rmSync(probe, { force: true });
  }
}

mkdirSync(join(root, 'dist'), { recursive: true });
const out = join(root, 'dist', 'Trailcraft.html');
writeFileSync(out, html);
console.log(`built ${out} — ${(html.length / 1024).toFixed(0)} KB`);
