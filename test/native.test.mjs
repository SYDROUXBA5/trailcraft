/* Files out of the iPhone app (native.js shareFile).

   Inside the app a download link does nothing and says nothing: the web view
   hands a blob: link to the system and cancels it. So "Export everything"
   was a dead button there, and so were Save GPX and the PDF wherever the web
   view offered no share sheet for files. The file now goes through
   Capacitor's own Filesystem and Share plugins. Here the plugins are fakes
   that record what they were asked. */

import assert from 'node:assert/strict';
import { shareFile, isNative } from '../public/native.js';

let pass = 0;
const t = async (name, fn) => { await fn(); pass++; console.log(`  ok  ${name}`); };

/** A shell with the two plugins, each keeping what it was handed. */
function shell({ shareFails = null, writeFails = false, plugins = ['Filesystem', 'Share'] } = {}) {
  const seen = { writes: [], shares: [] };
  const all = {
    Filesystem: {
      async writeFile(o) {
        if (writeFails) throw new Error('disk');
        seen.writes.push(o);
        return { uri: `file:///cache/${o.path}` };
      },
    },
    Share: {
      async share(o) {
        if (shareFails) throw new Error(shareFails);
        seen.shares.push(o);
        return {};
      },
    },
  };
  const Plugins = Object.fromEntries(plugins.map(p => [p, all[p]]));
  globalThis.window = { Capacitor: { isNativePlatform: () => true, getPlatform: () => 'ios', Plugins } };
  return seen;
}

await t('in a browser there is no shell, and nothing is attempted', async () => {
  globalThis.window = {};
  assert.equal(isNative(), false);
  assert.equal(await shareFile('{}', 'x.json'), 'none');
});

await t('text goes to the cache folder as text, then to the share sheet', async () => {
  const seen = shell();
  assert.equal(isNative(), true);
  const how = await shareFile('{"app":"trailcraft"}', 'trailcraft-backup-2026-09-24.json');
  assert.equal(how, 'shared');
  assert.deepEqual(seen.writes, [{ path: 'trailcraft-backup-2026-09-24.json', directory: 'CACHE', data: '{"app":"trailcraft"}', encoding: 'utf8' }]);
  assert.deepEqual(seen.shares, [{ title: 'trailcraft-backup-2026-09-24.json', files: ['file:///cache/trailcraft-backup-2026-09-24.json'] }]);
});

await t('bytes (the PDF) go as base64, whole', async () => {
  const seen = shell();
  const bytes = new Uint8Array(70000).map((_, i) => i % 256);
  assert.equal(await shareFile(bytes, 'report.pdf'), 'shared');
  const w = seen.writes[0];
  assert.equal(w.encoding, undefined, 'no encoding means base64 to the plugin');
  assert.deepEqual(new Uint8Array(Buffer.from(w.data, 'base64')), bytes);
});

await t('a name is one file in the cache folder, never a path out of it', async () => {
  const seen = shell();
  await shareFile('x', '../../Documents/Bo’s run 1/2.gpx');
  assert.ok(!seen.writes[0].path.includes('/'), seen.writes[0].path);
  assert.ok(!seen.writes[0].path.startsWith('.'));
  await shareFile('x', '..');
  assert.equal(seen.writes[1].path, 'trailcraft');
});

await t('closing the sheet is not a failure; everything else says so', async () => {
  shell({ shareFails: 'Share canceled' });
  assert.equal(await shareFile('x', 'a.json'), 'cancelled');
  shell({ shareFails: 'Error sharing item' });
  assert.equal(await shareFile('x', 'a.json'), 'failed');
  shell({ writeFails: true });
  assert.equal(await shareFile('x', 'a.json'), 'failed');
});

await t('an app built before the plugins were in says there is nothing to share with', async () => {
  shell({ plugins: ['Filesystem'] });
  assert.equal(await shareFile('x', 'a.json'), 'none');
  shell({ plugins: [] });
  assert.equal(await shareFile('x', 'a.json'), 'none');
});

delete globalThis.window;
console.log(`\n${pass} passed total\n`);
