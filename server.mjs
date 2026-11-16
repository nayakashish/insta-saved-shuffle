// Zero-dependency static server, used both for development and in the
// Docker image. Serves ./public, plus at most one private file: the list at
// DEFAULT_LIST (default ./saved/saved_posts.html) is exposed at
// /default/saved_posts.html so the site opens with it preloaded. Nothing
// else outside ./public is reachable over HTTP.
//
// Binding:
//   default          127.0.0.1 and ::1, plus this machine's Tailscale address
//                    (100.64.0.0/10) when Tailscale is connected
//   --local          127.0.0.1 and ::1 only
//   HOST=0.0.0.0     every interface (what the Docker image uses)
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';

const ROOT = resolve(fileURLToPath(new URL('./public', import.meta.url)));
const DEFAULT_LIST = resolve(process.env.DEFAULT_LIST || fileURLToPath(new URL('./saved/saved_posts.html', import.meta.url)));
const PORT = Number(process.env.PORT || 4321);

const HOSTS = process.env.HOST ? [process.env.HOST] : ['127.0.0.1', '::1'];
let tailscaleIp = null;
if (!process.env.HOST && !process.argv.includes('--local')) {
  for (const list of Object.values(networkInterfaces())) {
    for (const net of list || []) {
      const [a, b] = net.address.split('.').map(Number);
      if (net.family === 'IPv4' && a === 100 && b >= 64 && b <= 127) tailscaleIp = net.address;
    }
  }
  if (tailscaleIp) HOSTS.push(tailscaleIp);
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// The page loads only its own files; the one third party is Instagram's
// embed, in an iframe. Inline style attributes are used for progress bars.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  'frame-src https://www.instagram.com',
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const BASE_HEADERS = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

function send(req, res, status, headers, body) {
  res.writeHead(status, { ...BASE_HEADERS, ...headers });
  res.end(req.method === 'HEAD' ? undefined : body);
}

// Revalidate every time (so a redeploy is picked up at once), but answer
// unchanged files with 304 instead of resending them.
async function sendFile(req, res, file, extraHeaders = {}) {
  const info = await stat(file);
  if (!info.isFile()) throw new Error('not a file');
  const modified = new Date(Math.floor(info.mtimeMs / 1000) * 1000);
  const since = Date.parse(req.headers['if-modified-since'] || '');
  const headers = {
    'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
    'Last-Modified': modified.toUTCString(),
    ...extraHeaders,
  };
  if (!Number.isNaN(since) && modified.getTime() <= since) {
    send(req, res, 304, headers);
    return;
  }
  send(req, res, 200, headers, await readFile(file));
}

const handler = async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(req, res, 405, { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' }, 'Method not allowed');
    return;
  }
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/healthz') {
      send(req, res, 200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }, 'ok');
      return;
    }
    if (url.pathname === '/default/saved_posts.html') {
      // Personal data: never let a shared cache keep it.
      await sendFile(req, res, DEFAULT_LIST, { 'Cache-Control': 'private, no-store' });
      return;
    }
    let path = normalize(decodeURIComponent(url.pathname));
    if (path.endsWith(sep) || path === '/') path = join(path, 'index.html');
    const file = resolve(join(ROOT, path));
    if (file !== ROOT && !file.startsWith(ROOT + sep)) {
      send(req, res, 403, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Forbidden');
      return;
    }
    await sendFile(req, res, file);
  } catch {
    send(req, res, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Not found');
  }
};

const servers = HOSTS.map((host) => {
  const server = createServer(handler);
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use on ${host}. Try: PORT=4322 npm run dev`);
      process.exit(1);
    }
    if (host === '::1') return; // no IPv6 loopback on this machine
    throw err;
  });
  server.listen(PORT, host);
  return server;
});

// Docker sends SIGTERM on stop; Node ignores it by default when it is PID 1.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    for (const server of servers) server.close();
    process.exit(0);
  });
}

if (HOSTS.includes('0.0.0.0')) {
  console.log(`Listening on 0.0.0.0:${PORT}`);
  if (!process.env.DOCKER) {
    for (const list of Object.values(networkInterfaces())) {
      for (const net of list || []) {
        if (net.family === 'IPv4' && !net.internal) console.log(`On your network: http://${net.address}:${PORT}/`);
      }
    }
  }
} else {
  console.log(`Site: http://localhost:${PORT}/`);
  if (tailscaleIp) console.log(`On your tailnet: http://${tailscaleIp}:${PORT}/`);
}
stat(DEFAULT_LIST).then(
  () => console.log('Default list: served at /default/saved_posts.html (anyone who can reach this server can read it)'),
  () => console.log('Default list: none, visitors start on the import page'),
);
