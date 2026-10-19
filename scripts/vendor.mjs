#!/usr/bin/env node
/* npm run vendor: copy the map and sign-in libraries into public/vendor/.

   They used to load from api.mapbox.com, cdn.jsdelivr.net and www.gstatic.com
   at every start. Inside the iPhone app that page also holds the bridge to the
   phone's location and files, so whatever those hosts sent back ran with the
   app's own reach, and nothing checked it. Now the exact same versions ship
   inside the app, and the page's Content-Security-Policy refuses script from
   anywhere else.

   Each package comes from the npm registry as the tarball of that exact
   version and is refused unless it matches the sha512 written below. Those
   values are the registry's own published integrity for each version, copied
   here once, so a later run cannot quietly take different bytes. The archive
   is read in this process (no tar binary is run on it) and only the named
   files are taken out.

   Firebase's browser files import each other by their full gstatic address;
   those imports are pointed at the copy beside them, and nothing else in the
   files is changed. Map libraries are copied byte for byte.

   scripts/vendor.lock.json records what was written, and test/vendor.test.mjs
   checks the files in public/vendor/ still match it. Changing a version means
   changing it here, in index.html, sync.js, sw.js and build-single.mjs, and
   running this again. */

import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const PACKAGES = [
  {
    name: 'mapbox-gl', version: '3.14.0', licence: 'Mapbox Web SDK licence (LICENSE.txt)',
    integrity: 'sha512-KYhi9ZOQL4BB0J061admPH8O5ZZhhxsyiJ6DQCOkCaps0JEB4HF3SbJwu8S0pJKaQUxNS33sSbzW8iDSSauHPQ==',
    files: { 'dist/mapbox-gl.js': 'mapbox-gl.js', 'dist/mapbox-gl.css': 'mapbox-gl.css', 'LICENSE.txt': 'LICENSE.txt' },
  },
  {
    name: 'maplibre-gl', version: '4.7.1', licence: 'BSD-3-Clause (LICENSE.txt)',
    integrity: 'sha512-lgL7XpIwsgICiL82ITplfS7IGwrB1OJIw/pCvprDp2dhmSSEBgmPzYRvwYYYvJGJD7fxUv1Tvpih4nZ6VrLuaA==',
    files: { 'dist/maplibre-gl.js': 'maplibre-gl.js', 'dist/maplibre-gl.css': 'maplibre-gl.css', 'LICENSE.txt': 'LICENSE.txt' },
  },
  {
    name: 'firebase', version: '12.3.0', licence: 'Apache-2.0',
    integrity: 'sha512-/JVja0IDO8zPETGv4TvvBwo7RwcQFz+RQ3JBETNtUSeqsDdI9G7fhRTkCy1sPKnLzW0xpm/kL8GOj6ncndTT3g==',
    files: { 'firebase-app.js': 'firebase-app.js', 'firebase-auth.js': 'firebase-auth.js', 'firebase-firestore.js': 'firebase-firestore.js' },
  },
];

const GSTATIC_APP = (v) => `from"https://www.gstatic.com/firebasejs/${v}/firebase-app.js"`;

/** The sha512 integrity string npm uses, for a buffer. */
export const integrityOf = (buf) => `sha512-${createHash('sha512').update(buf).digest('base64')}`;
export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/* The files a (gunzipped) tar archive holds, by name. Only plain files are
   kept; a pax or GNU long-name entry is skipped along with whatever it names,
   which is fine because every file wanted here has a short name. */
export function untar(tar) {
  const out = new Map();
  for (let at = 0; at + 512 <= tar.length;) {
    const head = tar.subarray(at, at + 512);
    if (head.every((b) => b === 0)) break;
    const text = (from, len) => head.subarray(from, from + len).toString('latin1').replace(/\0.*$/s, '');
    const size = parseInt(text(124, 12).trim() || '0', 8);
    const type = text(156, 1) || '0';
    const prefix = text(345, 155);
    const name = prefix ? `${prefix}/${text(0, 100)}` : text(0, 100);
    if (type === '0') out.set(name, tar.subarray(at + 512, at + 512 + size));
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}

/* Firebase's auth and Firestore files import the app file by its gstatic
   address. Pointed at the copy beside them, so nothing is fetched from
   Google's CDN. Exactly one such import is expected in each; anything else
   means the files changed shape and a person should look. */
export function localiseFirebase(name, text, version) {
  if (name === 'firebase-app.js') return text;
  const parts = text.split(GSTATIC_APP(version));
  if (parts.length !== 2) throw new Error(`${name}: expected one gstatic import of firebase-app.js, found ${parts.length - 1}`);
  const out = parts.join('from"./firebase-app.js"');
  if (/(from|import)\s*\(?\s*["']https?:/.test(out)) throw new Error(`${name}: an import from another host is left`);
  return out;
}

async function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const lock = {};
  for (const pkg of PACKAGES) {
    const url = `https://registry.npmjs.org/${pkg.name}/-/${pkg.name}-${pkg.version}.tgz`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    const tgz = Buffer.from(await res.arrayBuffer());
    const got = integrityOf(tgz);
    if (got !== pkg.integrity) throw new Error(`${pkg.name}@${pkg.version}: integrity ${got} is not the pinned ${pkg.integrity}`);
    const entries = untar(gunzipSync(tgz));
    const dir = join(root, 'public', 'vendor', `${pkg.name}-${pkg.version}`);
    mkdirSync(dir, { recursive: true });
    const files = {};
    for (const [from, to] of Object.entries(pkg.files)) {
      const raw = entries.get(`package/${from}`);
      if (!raw) throw new Error(`${pkg.name}: package/${from} is not in the tarball`);
      const body = pkg.name === 'firebase'
        ? Buffer.from(localiseFirebase(to, raw.toString('utf8'), pkg.version), 'utf8')
        : raw;
      writeFileSync(join(dir, to), body);
      files[to] = { sha256: sha256(body), bytes: body.length, ...(body === raw ? {} : { sourceSha256: sha256(raw) }) };
    }
    lock[`${pkg.name}@${pkg.version}`] = { tarball: url, integrity: pkg.integrity, licence: pkg.licence, files };
    console.log(`  ${pkg.name}@${pkg.version}  integrity ok  →  public/vendor/${pkg.name}-${pkg.version}/`);
  }
  writeFileSync(join(root, 'scripts', 'vendor.lock.json'), `${JSON.stringify(lock, null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
