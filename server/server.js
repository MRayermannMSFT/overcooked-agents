import http from 'node:http';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const SHARED_DIR = path.join(ROOT, 'shared');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join('; '),
};

const WILDCARD_HOSTS = new Set(['0.0.0.0', '::', '[::]']);

/** Hostnames accepted in the Host header (blocks DNS-rebinding when bound to loopback). */
export function allowedHostnames(host) {
  const set = new Set(['localhost', '127.0.0.1', '[::1]']);
  if (host && !WILDCARD_HOSTS.has(host)) set.add(host.includes(':') && !host.startsWith('[') ? `[${host}]` : host.toLowerCase());
  return set;
}

export function hostnameOf(hostHeader) {
  const h = String(hostHeader || '').toLowerCase();
  if (h.startsWith('[')) return h.slice(0, h.indexOf(']') + 1);
  return h.split(':')[0];
}

/** Resolve a URL path inside baseDir, refusing anything that escapes it. */
export function safeJoin(baseDir, urlPath) {
  let rel;
  try {
    rel = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (rel.includes('\0')) return null;
  const full = path.resolve(baseDir, `.${path.posix.sep}${rel.replace(/^\/+/, '')}`);
  if (full !== baseDir && !full.startsWith(baseDir + path.sep)) return null;
  return full;
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8', ...headers });
  res.end(body);
}

function sendJson(res, status, value) {
  send(res, status, JSON.stringify(value), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
}

async function serveFile(req, res, baseDir, urlPath) {
  let full = safeJoin(baseDir, urlPath);
  if (!full) return send(res, 403, 'Forbidden');
  let st;
  try {
    st = await fsp.stat(full);
    if (st.isDirectory()) {
      full = path.join(full, 'index.html');
      st = await fsp.stat(full);
    }
  } catch {
    return send(res, 404, 'Not found');
  }
  const ext = path.extname(full).toLowerCase();
  const immutable = urlPath.startsWith('/vendor/') || urlPath.startsWith('/fonts/');
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': st.size,
    'Cache-Control': immutable ? 'public, max-age=86400' : 'no-cache',
  });
  if (req.method === 'HEAD') return res.end();
  const data = await fsp.readFile(full);
  res.end(data);
}

/**
 * HTTP server: static UI + JSON snapshot + Server-Sent Events stream of kitchen updates.
 */
export function createKitchenServer({ kitchen, watcher, host = '127.0.0.1', info = {}, tickMs = 5000, pingMs = 15000 }) {
  const clients = new Set();
  const allowed = allowedHostnames(host);
  const checkHost = !WILDCARD_HOSTS.has(host);
  let visibleIds = new Set(kitchen.visible().map((s) => s.id));

  function broadcast(event, payload) {
    if (!clients.size) return;
    const msg = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const res of clients) res.write(msg);
  }

  function pushUpdate(changed = [], fx = []) {
    const now = Date.now();
    const vis = new Set(kitchen.visible(now).map((s) => s.id));
    const removed = [...visibleIds].filter((id) => !vis.has(id));
    const ids = new Set(changed.filter((id) => vis.has(id)));
    for (const id of vis) if (!visibleIds.has(id)) ids.add(id);
    visibleIds = vis;
    const sessions = [...ids].map((id) => kitchen.get(id).snapshot());
    const effects = fx.filter((f) => vis.has(f.sessionId));
    if (!sessions.length && !removed.length && !effects.length) return;
    broadcast('update', { now, sessions, removed, fx: effects, totals: kitchen.totals() });
  }

  const onUpdate = ({ changed, fx }) => pushUpdate(changed, fx);
  watcher?.on('update', onUpdate);
  const tick = setInterval(() => pushUpdate(), tickMs);
  const ping = setInterval(() => {
    for (const res of clients) res.write(': ping\n\n');
  }, pingMs);
  tick.unref?.();
  ping.unref?.();

  const server = http.createServer(async (req, res) => {
    try {
      if (checkHost && !allowed.has(hostnameOf(req.headers.host))) return send(res, 403, 'Forbidden host');
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', { Allow: 'GET, HEAD' });
      const url = new URL(req.url, 'http://localhost');
      const p = url.pathname;

      if (p === '/api/health') {
        return sendJson(res, 200, {
          ok: true,
          ready: watcher ? watcher.ready : true,
          sessions: kitchen.sessions.size,
          visible: visibleIds.size,
          clients: clients.size,
          ...info,
        });
      }
      if (p === '/api/state') return sendJson(res, 200, { ...kitchen.snapshot(), info });
      if (p === '/api/stream') {
        res.writeHead(200, {
          ...SECURITY_HEADERS,
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-store',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        res.write('retry: 2000\n\n');
        res.write(`event: snapshot\ndata: ${JSON.stringify({ ...kitchen.snapshot(), info })}\n\n`);
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
      }
      if (p.startsWith('/shared/')) return await serveFile(req, res, SHARED_DIR, p.slice('/shared'.length));
      if (p.startsWith('/api/')) return send(res, 404, 'Not found');
      return await serveFile(req, res, PUBLIC_DIR, p);
    } catch (err) {
      if (!res.headersSent) send(res, 500, 'Internal error');
      else res.end();
      server.emit('handlerError', err);
    }
  });

  function cleanup() {
    clearInterval(tick);
    clearInterval(ping);
    watcher?.off('update', onUpdate);
    for (const res of clients) res.end();
    clients.clear();
  }

  server.on('close', cleanup);

  /** Close the server, including long-lived SSE connections. */
  server.stop = () =>
    new Promise((resolve) => {
      cleanup();
      server.close(() => resolve());
      server.closeAllConnections?.();
    });

  server.pushUpdate = pushUpdate;
  server.clients = clients;
  return server;
}
