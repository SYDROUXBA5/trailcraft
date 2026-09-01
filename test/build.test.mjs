/* The build stamp lives in two places: BUILD in app.js (what a running page
   believes it is) and build.txt (what the server says is current). The updater
   compares them across the network, so if they drift apart every phone decides
   it is permanently out of date. This test makes that drift a red bar instead
   of a support call. */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const txt = (await readFile(new URL('../public/build.txt', import.meta.url), 'utf8')).trim();

const m = app.match(/const BUILD = '([^']+)'/);
assert.ok(m, 'app.js must declare const BUILD');
assert.ok(txt.length > 0, 'build.txt must not be empty');
assert.equal(m[1], txt, `BUILD in app.js (${m[1]}) must match build.txt (${txt}) — bump both together`);

console.log(`  ok  build stamp in sync: ${txt}\n\n1 passed total`);
