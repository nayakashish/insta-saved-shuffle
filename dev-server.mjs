// Zero-dependency static dev server. Serves ./public, plus exactly one file
// from the private ./saved folder: saved/saved_posts.html is exposed at
// /default/saved_posts.html so the site opens with that list preloaded.
// Nothing else in ./saved is reachable over HTTP.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';

const ROOT = resolve(fileURLToPath(new URL('./public', import.meta.url)));
const DEFAULT_LIST = resolve(fileURLToPath(new URL('./saved/saved_posts.html', import.meta.url)));
const PORT = Number(process.env.PORT || 4321);
// Loopback only by default (both IPv4 and IPv6, so "localhost" always lands
// here). HOST=0.0.0.0 opens it to the local network, e.g. to try it on a phone.
// --tailscale adds this machine's Tailscale address (100.64.0.0/10), so the
// site is reachable from your tailnet but not from the local network.
const HOSTS = process.env.HOST ? [process.env.HOST] : ['127.0.0.1', '::1'];
let tailscaleIp = null;
if (process.argv.includes('--tailscale')) {
  for (const list of Object.values(networkInterfaces())) {
    for (const net of list || []) {
      const [a, b] = net.address.split('.').map(Number);
      if (net.family === 'IPv4' && a === 100 && b >= 64 && b <= 127) tailscaleIp = net.address;
    }
  }
  if (!tailscaleIp) {
    console.error('No Tailscale address found on this machine. Is Tailscale connected?');
    process.exit(1);
  }
  HOSTS.push(tailscaleIp);
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

const handler = async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/default/saved_posts.html') {
      const body = await readFile(DEFAULT_LIST);
      res.writeHead(200, { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : body);
      return;
    }
    let path = normalize(decodeURIComponent(url.pathname));
    if (path.endsWith(sep) || path === '/') path = join(path, 'index.html');
    const file = resolve(join(ROOT, path));
    if (file !== ROOT && !file.startsWith(ROOT + sep)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    const info = await stat(file);
    if (!info.isFile()) throw new Error('not a file');
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
  }
};

for (const host of HOSTS) {
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
}

console.log(`Dev site: http://localhost:${PORT}/`);
if (tailscaleIp) console.log(`On your tailnet: http://${tailscaleIp}:${PORT}/`);
if (HOSTS.includes('0.0.0.0')) {
  for (const list of Object.values(networkInterfaces())) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) console.log(`On your network: http://${net.address}:${PORT}/`);
    }
  }
}
