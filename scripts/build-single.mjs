/* Build dist/Trailcraft.html — the whole app as ONE file that opens from disk,
   no server, double-click and go.

   Why this exists: file:// forbids ES-module imports, so the nine modules are
   folded in. Naive concatenation would be a trap — geo.js and gesture.js both
   export project() and flattening them would silently cross-wire the scent
   maths into the spring physics — so each module becomes an IIFE namespace
   (__geo, __gesture, …) and every import statement becomes a destructuring
   from the right namespace. The vendored QR libraries inline as the classic
   scripts they already are. Mapbox stays on its CDN: the map needs the
   network for tiles anyway, so inlining 1.7 MB would fatten the file without
   buying any offline ability.

   Run: node scripts/build-single.mjs   (or: npm run build) */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pub = (f) => readFileSync(join(root, 'public', f), 'utf8');

/* Dependency order: roots first, then their dependents, app last. */
const MODULES = ['geo', 'field', 'sim', 'gesture', 'team', 'design', 'card', 'wind', 'demo', 'engine-demo'];

/** Inline-script safety: a literal "</script>" inside JS would end the tag.
    The escape is invisible at runtime (identical string value). */
const safe = (js) => js.replace(/<\/script/gi, '<\\/script');

/** Namespace identifier for a module file name — hyphens are not valid in
    JS identifiers, so engine-demo becomes __engine_demo. */
const ns = (name) => '__' + name.replace(/-/g, '_');

/** One module → an IIFE namespace. Imports become destructuring, exports are
    collected and returned. */
function toNamespace(name) {
  let src = pub(`${name}.js`);
  const preludes = [];

  src = src.replace(/import\s*\{([\s\S]*?)\}\s*from\s*'\.\/([\w-]+)\.js';?/g, (_, names, dep) => {
    preludes.push(`const {${names.replace(/\s+/g, ' ').trim()}} = ${ns(dep)};`);
    return '';
  });

  const exported = [];
  src = src.replace(/^export\s+(async\s+function|function|class|const)\s+(\w+)/gm, (_, kind, id) => {
    exported.push(id);
    return `${kind} ${id}`;
  });
  if (/^export\s/m.test(src)) throw new Error(`${name}.js: unhandled export form`);
  if (!exported.length) throw new Error(`${name}.js: no exports found`);

  return `const ${ns(name)} = (() => {\n${preludes.join('\n')}\n${src}\nreturn { ${exported.join(', ')} };\n})();`;
}

/** app.js is the program, not a library: imports become top-level
    destructuring, and the one dynamic import (demo mode) is rewired. */
function appBody() {
  let src = pub('app.js');
  const preludes = [];
  src = src.replace(/import\s*\{([\s\S]*?)\}\s*from\s*'\.\/([\w-]+)\.js';?/g, (_, names, dep) => {
    preludes.push(`const {${names.replace(/\s+/g, ' ').trim()}} = ${ns(dep)};`);
    return '';
  });
  src = src.replace(/await\s+import\('\.\/demo\.js'\)/g, '__demo');
  if (/from\s+'\.\//.test(src)) throw new Error('app.js: an import survived the transform');
  return `${preludes.join('\n')}\n${src}`;
}

const bundle = [
  `/* Trailcraft single-file build — generated ${new Date().toISOString().slice(0, 16)}Z. Source of truth: the modules in public/. */`,
  ...MODULES.map(toNamespace),
  appBody(),
].join('\n\n');

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

html = html.replace(/<script src="vendor\/qrcode\.js"><\/script>/, () => `<script>\n${safe(pub('vendor/qrcode.js'))}\n</script>`);
html = html.replace(/<script src="vendor\/jsQR\.js"><\/script>/, () => `<script>\n${safe(pub('vendor/jsQR.js'))}\n</script>`);
html = html.replace(/<script src="app\.js" type="module"><\/script>/, () => `<script type="module">\n${safe(bundle)}\n</script>`);

for (const leftover of ['href="app.css"', 'src="app.js"', 'vendor/qrcode.js"', 'vendor/jsQR.js"']) {
  if (html.includes(leftover)) throw new Error(`assembly incomplete: ${leftover} still referenced`);
}

mkdirSync(join(root, 'dist'), { recursive: true });
const out = join(root, 'dist', 'Trailcraft.html');
writeFileSync(out, html);
console.log(`built ${out} — ${(html.length / 1024).toFixed(0)} KB`);
