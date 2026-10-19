/* The development server's request handler, called directly with a pretend
   request and response, so nothing listens on a port.

   It serves the phone during field tests, so one odd address must never take
   it down, and no address may reach a file outside public/. */

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { handler, bindHost, caFingerprint } = require('../server.cjs');

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

/* npm run dev listens on this Mac alone, so the steps for the phone that
   still said to run it led to a connection the server refuses. */
t('the phone steps and the certificate script start the server the phone can reach', () => {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  const cert = readFileSync(new URL('../scripts/make-cert.sh', import.meta.url), 'utf8');
  assert.match(pkg, /"dev:lan": "LAN=1 node server\.cjs"/);
  const phone = readme.slice(readme.indexOf('## On your phone'), readme.indexOf('## Trusting the certificate'));
  assert.match(phone, /2\. `npm run dev:lan` and note the `https:\/\/192\.168\.x\.x:2777` address it prints/);
  const trust = readme.slice(readme.indexOf('## Trusting the certificate'));
  assert.match(trust, /On the iPhone, with `npm run dev:lan` running:/);
  assert.match(cert, /echo "Run npm run dev:lan, then on the phone open: {2}https:\/\/\$LAN:2777\/ca\.crt"/);
  assert.ok(!/Start the server, then on the phone/.test(cert));
});

/* A throwaway authority made with the same openssl line as make-cert.sh, for
   this test alone; it is not the one in certs/. Its fingerprint was read with
   openssl x509 -fingerprint -sha256. */
const THROWAWAY_CA = `-----BEGIN CERTIFICATE-----
MIIDvjCCAqagAwIBAgIUbh9Wfx5ATYBKE/eATHKfwS3IYq4wDQYJKoZIhvcNAQEL
BQAwMzEcMBoGA1UEAwwTVHJhaWxjcmFmdCBMb2NhbCBDQTETMBEGA1UECgwKVHJh
aWxjcmFmdDAeFw0yNjEwMTkxOTAyNTNaFw0zNjEwMTYxOTAyNTNaMDMxHDAaBgNV
BAMME1RyYWlsY3JhZnQgTG9jYWwgQ0ExEzARBgNVBAoMClRyYWlsY3JhZnQwggEi
MA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQDKbuPUTm33bTzu7RUVqJZ6lpKU
u6OXia/cDgXV6uxtozXy50uhoOlYd8WpGMR7gcaXSrsA0wHEvTG2Afbwuqvxtukc
RFVT/S66cyt5IZpNh6lnm2+WuZyF21kDskDPmtj83TozxFtVDDaWc3RC+xbQ1Euf
NWwv3Nqx/G1WgnBeSz/MLKfwPjZpeChzO80TGXsRlhN0iimqDJXy2nfgHIqtZ254
FZ+P42/V9I+qySOxYj9+/3+IpbcX851hleBb5uVFEsOw0uGaZc/N43YCcwUvJxZK
yKSaLscWcWlI7vMrWxLIcmtS3M9ts3FThV6gLp2lWm2tB8K7i0T9B52Xf3bXAgMB
AAGjgckwgcYwHQYDVR0OBBYEFPWFbdZOBZat5iN+uyn+P1+kmWstMB8GA1UdIwQY
MBaAFPWFbdZOBZat5iN+uyn+P1+kmWstMBIGA1UdEwEB/wQIMAYBAf8CAQAwDgYD
VR0PAQH/BAQDAgEGMGAGA1UdHgEB/wRWMFSgUjALgglsb2NhbGhvc3QwB4IFbG9j
YWwwCocIfwAAAP8AAAAwCocICgAAAP8AAAAwCocIrBAAAP/wAAAwCocIwKgAAP//
AAAwCocIqf4AAP//AAAwDQYJKoZIhvcNAQELBQADggEBAFj2aUyAIHrNEfe2mLAJ
J8nC7usQp6gFaxLROwc2t8IuT2wuRJ5kMqLH+C1GGAuBepwtu9Sk/wwsaWQei1rX
V8wdKw6vx/oGNGE9Fz6eFwqilk9tr86UuEnS1j1+y323HUdJMkmD+BZ82ejL1khg
bWZSB3QOZ1opIkuG6zLe+8RMBf3VDwWSdW60Z6RG4hRI3Vmp4v8vk+7d95paT+PM
v7zmwKfkYtmgktx9iYeyr/ouISnlpO4yZWgwnWy5hnKubMPxhX3DaBSyAmVMUsFG
p3DoZ6Tl31sbbr3dvjF1/6GGmOiMi9RUCm3fuBo0rB2665deYkFSfI85IGC5TVPq
vZg=
-----END CERTIFICATE-----
`;

/* The phone fetches the authority over Wi-Fi before it trusts anything, so
   the only thing that tells the real one from a look-alike is its fingerprint,
   which the server and the script must print in the form iOS shows. */
t('the authority fingerprint is printed as the spaced SHA-256 pairs iOS shows', () => {
  assert.equal(caFingerprint(THROWAWAY_CA),
    '52 FD 8E 3A 6D 55 70 00 0F B0 83 EE D8 29 79 13 BA 1A B0 2E BF CC 5E 13 82 8A 5A E4 E0 D2 7E 14');
  assert.equal(caFingerprint('not a certificate'), null);
  assert.equal(caFingerprint(''), null);
  const server = readFileSync(new URL('../server.cjs', import.meta.url), 'utf8');
  const listen = server.slice(server.indexOf('if (require.main === module)'));
  assert.match(listen, /caFingerprint\(fs\.readFileSync\(path\.join\(CERT_DIR, 'ca\.pem'\)\)\)/);
  assert.match(listen, /\/ca\.crt`\)/, 'the certificate address is printed beside the fingerprint');
  assert.match(listen, /console\.log\(`    \$\{fp\}`\)/);
});

t('the certificate script prints the fingerprint and limits a new authority to local names', () => {
  const cert = readFileSync(new URL('../scripts/make-cert.sh', import.meta.url), 'utf8');
  assert.match(cert, /openssl x509 -in "\$CERTS\/ca\.pem" -noout -fingerprint -sha256 \| sed 's\/\^\[\^=\]\*=\/\/; s\/:\/ \/g'/);
  assert.match(cert, /-addext "nameConstraints=critical,\$NAMES"/);
  const names = [...cert.matchAll(/permitted;([A-Z]+:[^,"]+)/g)].map((m) => m[1]);
  assert.deepEqual(names, [
    'DNS:localhost', 'DNS:local',
    'IP:127.0.0.0/255.0.0.0', 'IP:10.0.0.0/255.0.0.0',
    'IP:172.16.0.0/255.240.0.0', 'IP:192.168.0.0/255.255.0.0',
    'IP:169.254.0.0/255.255.0.0',
  ]);
  // Never regenerated behind the owner's back: an existing authority is reused.
  assert.match(cert, /if \[ ! -f "\$CERTS\/ca\.pem" \] \|\| \[ ! -f "\$CERTS\/ca-key\.pem" \]; then/);
});

t('the phone steps compare the fingerprint before anything is installed or trusted', () => {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  const trust = readme.slice(readme.indexOf('## Trusting the certificate'), readme.indexOf('## How to use it'));
  const compare = trust.indexOf('Compare the fingerprint before you install anything');
  assert.ok(compare > 0);
  assert.ok(compare < trust.indexOf('tap **Install**'), 'compare comes before Install');
  assert.ok(compare < trust.indexOf('Certificate Trust Settings'), 'and before full trust');
  assert.match(trust, /AirDrop `certs\/ca\.pem`/);
  assert.match(trust, /Remove Profile/);
});

for (const [name, fn] of tests) {
  await fn();
  pass++;
  console.log(`  ok  ${name}`);
}
console.log(`\n${pass} passed total\n`);
