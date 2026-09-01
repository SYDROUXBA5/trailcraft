#!/usr/bin/env node
// Trailcraft — zero-dependency static server.
// Serves HTTPS when certs/ exists (needed: phones only grant Geolocation on a
// secure origin, and localhost is the sole exception). Falls back to HTTP.
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = process.env.PORT || 2777;
const ROOT = path.join(__dirname, 'public');
const CERT_DIR = path.join(__dirname, 'certs');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function lanAddress() {
  for (const iface of Object.values(os.networkInterfaces()).flat()) {
    if (iface && iface.family === 'IPv4' && !iface.internal) return iface.address;
  }
  return null;
}

const handler = (req, res) => {
  const url = new URL(req.url, 'http://x');
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';

  /* The local authority, so a phone can trust this server and hand over GPS.
     iOS only offers to install a configuration profile when the MIME type says
     certificate — served as anything else it just downloads a dead file. */
  if (rel === '/ca.crt' || rel === '/ca.pem') {
    fs.readFile(path.join(CERT_DIR, 'ca.pem'), (err, buf) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' })
           .end('No certificate authority yet — run: npm run cert');
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'application/x-x509-ca-cert',
        'Content-Disposition': 'attachment; filename="trailcraft-ca.crt"',
        'Cache-Control': 'no-store',
      }).end(buf);
    });
    return;
  }

  // Contain traversal: resolve, then require the result to stay under ROOT.
  const file = path.join(ROOT, path.normalize(rel));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      // The service worker owns caching; keep the network copy authoritative.
      'Cache-Control': 'no-cache',
    }).end(buf);
  });
};

const keyPath = path.join(CERT_DIR, 'key.pem');
const certPath = path.join(CERT_DIR, 'cert.pem');
// HTTP=1 forces plain HTTP. Safe on localhost, which browsers already treat as
// a secure context, so Geolocation still works when testing on this machine.
const secure = !process.env.HTTP && fs.existsSync(keyPath) && fs.existsSync(certPath);

const server = secure
  ? https.createServer({ key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) }, handler)
  : http.createServer(handler);

server.listen(PORT, '0.0.0.0', () => {
  const scheme = secure ? 'https' : 'http';
  const lan = lanAddress();
  console.log(`\n  Trailcraft  →  ${scheme}://localhost:${PORT}`);
  if (lan) console.log(`  On your phone →  ${scheme}://${lan}:${PORT}`);
  if (!secure) console.log('  ! No certs/ — GPS will not work off localhost. Run: npm run cert');
  console.log('');
});
