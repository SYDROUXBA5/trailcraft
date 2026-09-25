/* The development server's request handler, called directly with a pretend
   request and response, so nothing listens on a port.

   It serves the phone during field tests, so one odd address must never take
   it down, and no address may reach a file outside public/. */

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { handler, bindHost } = require('../server.cjs');

let pass = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);

/** Runs the handler for one raw request line and resolves with what it answered. */
function ask(url) {
  return new Promise((resolve, reject) => {
    const res = {
      status: 0,
      writeHead(status) { this.status = status; return this; },
      end(body = '') { resolve({ status: this.status, body: String(body) }); },
    };
    try {
      handler({ url, method: 'GET', headers: {} }, res);
    } catch (err) {
      reject(err);
    }
  });
}

const buildTxt = readFileSync(new URL('../public/build.txt', import.meta.url), 'utf8');
const pkg = readFileSync(new URL('../package.json', import.meta.url), 'utf8');

t('files in public/ are served, and / is the app', async () => {
  const stamp = await ask('/build.txt');
  assert.equal(stamp.status, 200);
  assert.equal(stamp.body, buildTxt);
  const home = await ask('/');
  assert.equal(home.status, 200);
  assert.match(home.body, /<html/i);
});

t('a malformed percent escape is a 400, and the server is still answering afterwards', async () => {
  for (const url of ['/%E0%A4%A', '/%', '/app.js%zz', '/%E0%A4']) {
    const out = await ask(url);
    assert.equal(out.status, 400, `${url} should be refused, not thrown`);
  }
  assert.equal((await ask('/build.txt')).status, 200);
});

t('an address that is not a URL, or smuggles a NUL byte, is a 400 rather than a crash', async () => {
  assert.equal((await ask('//')).status, 400);
  assert.equal((await ask('/index.html%00.txt')).status, 400);
  assert.equal((await ask('/%00')).status, 400);
});

t('no address reaches a file outside public/', async () => {
  const attempts = [
    '/../package.json',
    '/../../../../etc/passwd',
    '/%2e%2e/package.json',
    '/..%2fpackage.json',
    '/..%2F..%2F..%2Fetc%2Fpasswd',
    '/%2e%2e%2f%2e%2e%2fpackage.json',
    '/.%2e/.%2e/server.cjs',
    '/..%5cpackage.json',
    '/../public-old/index.html',
  ];
  for (const url of attempts) {
    const out = await ask(url);
    assert.notEqual(out.status, 200, `${url} must not be served`);
    assert.notEqual(out.body, pkg, `${url} leaked package.json`);
    assert.doesNotMatch(out.body, /root:.*:0:0:/, `${url} leaked /etc/passwd`);
  }
});

t('it listens on this Mac alone unless LAN is asked for', () => {
  assert.equal(bindHost({}), '127.0.0.1');
  assert.equal(bindHost({ HTTP: '1' }), '127.0.0.1', 'the preview configs start it with HTTP=1 and stay local');
  assert.equal(bindHost({ LAN: '0' }), '127.0.0.1');
  assert.equal(bindHost({ LAN: '1' }), '0.0.0.0');
  assert.equal(bindHost({ LAN: '1', HTTP: '1' }), '0.0.0.0');
});

for (const [name, fn] of tests) {
  await fn();
  pass++;
  console.log(`  ok  ${name}`);
}
console.log(`\n${pass} passed total\n`);
