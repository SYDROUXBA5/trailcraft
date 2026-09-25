#!/usr/bin/env node
// Trailcraft — zero-dependency static server.
// Serves HTTPS when certs/ exists (needed: phones only grant Geolocation on a
// secure origin, and localhost is the sole exception). Falls back to HTTP.
//
// Only this Mac can reach it unless LAN=1 is set (npm run dev:lan). Testing on
// a phone needs the network; the rest of the time there is no reason for every
// other device on the same Wi-Fi to reach a development server.
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = process.env.PORT || 2777;
const ROOT = path.join(__dirname, 'public');
const CERT_DIR = path.join(__dirname, 'certs');
const LOOPBACK = '127.0.0.1';

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

/** Every interface when the environment asks for the LAN, this Mac alone otherwise. */
function bindHost(env) {
  return env.LAN && env.LAN !== '0' ? '0.0.0.0' : LOOPBACK;
}

/* The decoded path a request asks for, or null when it cannot be read. A bad
   escape such as /%E0%A4%A makes decodeURIComponent throw, "//" is not a URL
   at all, and a %00 makes fs throw on the spot. Each of those used to be
   thrown inside the handler and take the whole server down, and with it the
   phone halfway through a test; now they are a 400. */
function requestPath(rawUrl) {
  try {
    const rel = decodeURIComponent(new URL(rawUrl, 'http://x').pathname);
    return rel.includes('\0') ? null : rel;
  } catch {
    return null;
  }
}

const handler = (req, res) => {
  let rel = requestPath(req.url);
  if (rel === null) {
    res.writeHead(400, { 'Content-Type': 'text/plain' }).end('Bad request');
    return;
  }
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

  // Contain traversal: resolve, then require the result to sit inside ROOT.
  // ROOT plus a separator, so a sibling such as public-old/ cannot pass for it.
  const file = path.join(ROOT, path.normalize(rel));
  if (!file.startsWith(ROOT + path.sep)) {
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

module.exports = { handler, bindHost, ROOT };

// Listen only when run as a program; the test requires this file for the handler.
if (require.main === module) {
  const keyPath = path.join(CERT_DIR, 'key.pem');
  const certPath = path.join(CERT_DIR, 'cert.pem');
  // HTTP=1 forces plain HTTP. Safe on localhost, which browsers already treat as
  // a secure context, so Geolocation still works when testing on this machine.
  const secure = !process.env.HTTP && fs.existsSync(keyPath) && fs.existsSync(certPath);

  const server = secure
    ? https.createServer({ key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) }, handler)
    : http.createServer(handler);

  const host = bindHost(process.env);
  server.listen(PORT, host, () => {
    const scheme = secure ? 'https' : 'http';
    console.log(`\n  Trailcraft  →  ${scheme}://localhost:${PORT}`);
    if (host === LOOPBACK) {
      console.log('  This Mac only. To test on your phone: npm run dev:lan');
    } else {
      const lan = lanAddress();
      if (lan) console.log(`  On your phone →  ${scheme}://${lan}:${PORT}`);
      if (!secure) console.log('  ! No certs/ — GPS will not work off localhost. Run: npm run cert');
    }
    console.log('');
  });
}
