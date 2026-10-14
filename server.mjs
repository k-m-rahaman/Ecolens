/* Zero-dependency local server. Run with Node.js 20+; online requests are disabled by default. */
import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { networkInterfaces } from 'node:os';
import { Readable } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { handleNaacRequest } from './naac-api.js';
import { createJsonNaacStore } from './naac-store.mjs';
import {
  MAX_BODY_BYTES, apiError, errorPayload, capSetting, onlineStatus,
  prepareInput, analyzeWithGemini, isAllowedOrigin
} from './cloudflare-worker.mjs';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm', '.onnx': 'application/octet-stream', '.bin': 'application/octet-stream',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8'
};
const SOURCE_DIR = path.dirname(fileURLToPath(import.meta.url));

export function privateLanHosts(env = {}) {
  if (env.LAN_PREVIEW !== '1') return [];
  const configured = String(env.LAN_HOSTS || '').split(',').map(value => value.trim());
  let detected = [];
  try { detected = Object.values(networkInterfaces()).flat().filter(item => item && item.family === 'IPv4' && !item.internal).map(item => item.address); } catch {}
  return [...new Set([...configured, ...detected])].filter(value => {
    const parts = value.split('.').map(Number);
    return parts.length === 4 && parts.every(number => Number.isInteger(number) && number >= 0 && number <= 255) &&
      (parts[0] === 10 || (parts[0] === 192 && parts[1] === 168) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31));
  });
}

function responseJSON(res, body, status = 200, origin = '') {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', 'Vary': 'Origin'
  };
  if (origin) headers['Access-Control-Allow-Origin'] = origin;
  if (status === 429) headers['Retry-After'] = '60';
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

async function readJSON(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) throw apiError('INVALID_JSON', 415);
  const length = Number(req.headers['content-length']);
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) throw apiError('IMAGE_TOO_LARGE', 413);
  let bytes = 0;
  const chunks = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) throw apiError('IMAGE_TOO_LARGE', 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw apiError('INVALID_JSON'); }
}

export function createLocalQuota(rootDir, env) {
  const quotaDirectory = path.join(rootDir, '.ecolens');
  const quotaFile = path.join(quotaDirectory, 'quota.json');
  let serial = Promise.resolve();
  let recent = [];
  const clients = new Map();
  return async function reserve(client) {
    const operation = serial.then(async () => {
      const now = Date.now(), day = new Date(now).toISOString().slice(0, 10);
      let quota;
      try {
        const stored = JSON.parse(await fs.readFile(quotaFile, 'utf8'));
        if (!stored || typeof stored.day !== 'string' || !Number.isInteger(stored.daily) || stored.daily < 0) throw new Error('Invalid quota file');
        quota = stored.day === day ? stored : { day, daily: 0 };
      } catch (error) {
        if (error.code !== 'ENOENT') throw apiError('QUOTA_STORAGE_REQUIRED', 503);
        quota = { day, daily: 0 };
      }
      recent = recent.filter(value => now - value < 60000);
      for (const [ip, times] of clients) {
        const valid = times.filter(value => now - value < 60000);
        if (valid.length) clients.set(ip, valid); else clients.delete(ip);
      }
      const clientTimes = clients.get(client) || [];
      if (quota.daily >= capSetting(env.DAILY_SCAN_LIMIT, 20, 50)) throw apiError('DAILY_LIMIT', 429);
      if (recent.length >= capSetting(env.SCANS_PER_MINUTE, 3, 6) || clientTimes.length >= 3 || (clientTimes.length && now - clientTimes.at(-1) < 10000)) throw apiError('RATE_LIMIT', 429);
      quota.daily += 1;
      try {
        await fs.mkdir(quotaDirectory, { recursive: true });
        const temporary = `${quotaFile}.tmp`;
        await fs.writeFile(temporary, JSON.stringify(quota), { mode: 0o600 });
        await fs.rename(temporary, quotaFile);
      } catch { throw apiError('QUOTA_STORAGE_REQUIRED', 503); }
      recent.push(now);
      clients.set(client, [...clientTimes, now]);
    });
    serial = operation.catch(() => {});
    return operation;
  };
}

function insideRoot(absolutePath, rootDir) {
  const relative = path.relative(rootDir, absolutePath);
  return !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

async function serveStatic(req, res, url, rootDir) {
  if (!['GET', 'HEAD'].includes(req.method)) throw apiError('METHOD_NOT_ALLOWED', 405);
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { throw apiError('NOT_FOUND', 404); }
  const segments = pathname.split('/');
  if (segments.some(segment => segment.startsWith('.') || segment.includes('\\') || segment.includes(':') || segment.includes('\0'))) throw apiError('NOT_FOUND', 404);
  if (pathname === '/') pathname = '/index.html';
  if (pathname === '/naac') {
    res.writeHead(308, { Location: '/naac/', 'Cache-Control': 'no-store' });
    res.end(); return;
  }
  if (pathname === '/naac/') pathname = '/naac/index.html';
  const filename = path.resolve(rootDir, `.${pathname}`);
  if (!insideRoot(filename, rootDir)) throw apiError('NOT_FOUND', 404);
  const extension = path.extname(filename).toLowerCase();
  // TensorFlow's downloaded COCO weight shards have no filename extension.
  const contentType = MIME[extension] || (/^\/models\/coco\/group1-shard[1-5]of5$/.test(pathname) ? 'application/octet-stream' : null);
  if (!contentType) throw apiError('NOT_FOUND', 404);
  let stats;
  try {
    // Refuse links at every level. This also works in restricted Windows sessions
    // where resolving the entire real path may be disallowed by the host.
    let current = rootDir;
    for (const segment of path.relative(rootDir, filename).split(path.sep)) {
      current = path.join(current, segment);
      const info = await fs.lstat(current);
      if (info.isSymbolicLink()) throw apiError('NOT_FOUND', 404);
      stats = info;
    }
  } catch { throw apiError('NOT_FOUND', 404); }
  if (!stats.isFile()) throw apiError('NOT_FOUND', 404);
  const cacheControl = /^\/(models|vendor)\//.test(pathname) ? 'public, max-age=86400' : 'no-cache';
  res.writeHead(200, {
    'Content-Type': contentType, 'Content-Length': stats.size, 'Cache-Control': cacheControl,
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(self), microphone=()'
  });
  if (req.method === 'HEAD') { res.end(); return; }
  // The model is small enough for a buffered read; no dependency or shell is required.
  const content = await fs.readFile(filename);
  res.end(content);
}

export function createEcolensServer({ rootDir = SOURCE_DIR, env = process.env, fetchImpl = fetch, naacStore } = {}) {
  const canonicalRoot = path.resolve(rootDir);
  const reserveQuota = createLocalQuota(canonicalRoot, env);
  const sharedReports = naacStore || createJsonNaacStore(canonicalRoot);
  const server = http.createServer(async (req, res) => {
    let corsOrigin = '';
    try {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 8787;
      const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, ...privateLanHosts(env).map(host => `${host}:${port}`)]);
      // Reject arbitrary Host headers to prevent browser DNS-rebinding attacks.
      if (!allowedHosts.has(req.headers.host)) throw apiError('ORIGIN_DENIED', 403);
      const url = new URL(req.url || '/', `http://${req.headers.host}`);
      const origin = typeof req.headers.origin === 'string' ? req.headers.origin : '';
      if (url.pathname.startsWith('/api/naac/')) {
        const init = { method: req.method, headers: req.headers };
        if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
          init.body = Readable.toWeb(req);
          init.duplex = 'half';
        }
        const reportResponse = await handleNaacRequest(new Request(url, init), env, {
          store: sharedReports, client: req.socket.remoteAddress || 'unknown'
        });
        res.writeHead(reportResponse.status, Object.fromEntries(reportResponse.headers));
        res.end(Buffer.from(await reportResponse.arrayBuffer())); return;
      }
      const allowed = isAllowedOrigin(origin, url.origin, env.ALLOWED_ORIGIN);
      if (allowed) corsOrigin = origin;
      if (url.pathname.startsWith('/api/')) {
        if (req.method === 'OPTIONS') {
          if (!allowed) throw apiError('ORIGIN_DENIED', 403);
          res.writeHead(204, {
            'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600', 'Vary': 'Origin'
          });
          res.end(); return;
        }
        if (origin && !allowed) throw apiError('ORIGIN_DENIED', 403);
        if (url.pathname === '/api/status') {
          if (req.method !== 'GET') throw apiError('METHOD_NOT_ALLOWED', 405);
          responseJSON(res, onlineStatus(env), 200, corsOrigin); return;
        }
        if (url.pathname !== '/api/analyze') throw apiError('NOT_FOUND', 404);
        if (req.method !== 'POST') throw apiError('METHOD_NOT_ALLOWED', 405);
        if (!allowed) throw apiError('ORIGIN_DENIED', 403);
        const status = onlineStatus(env);
        if (!status.available) throw apiError(status.reason, 503);
        const input = prepareInput(await readJSON(req));
        await reserveQuota(req.socket.remoteAddress || 'unknown');
        const client = new AbortController();
        const disconnected = () => { if (!res.writableEnded) client.abort(); };
        res.once?.('close', disconnected);
        let analysis;
        try { analysis = await analyzeWithGemini(input, env, { fetchImpl, signal: client.signal }); }
        finally { res.removeListener?.('close', disconnected); }
        responseJSON(res, analysis, 200, corsOrigin); return;
      }
      await serveStatic(req, res, url, canonicalRoot);
    } catch (error) {
      if (res.destroyed) return;
      if (!res.headersSent) responseJSON(res, errorPayload(error), error.status || 502, corsOrigin);
      else res.end();
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const port = capSetting(process.env.PORT, 8787, 65535);
  const env = { ...process.env, LAN_PREVIEW: process.argv.includes('--lan') ? '1' : process.env.LAN_PREVIEW || '0' };
  const server = createEcolensServer({ env });
  server.listen(port, env.LAN_PREVIEW === '1' ? '0.0.0.0' : '127.0.0.1', () => {
    console.log(`EcoLens is ready at http://127.0.0.1:${port}`);
    for (const host of privateLanHosts(env)) console.log(`Phone photo-upload preview: http://${host}:${port} (same Wi-Fi; use HTTPS for camera access)`);
    const status = onlineStatus(process.env);
    console.log(status.available ? 'Online analysis enabled with capped requests. Confirm the provider project has no billing.' : 'Online analysis is disabled; local offline scanning is available.');
  });
  server.on('error', () => { console.error('EcoLens could not start. Check that the local port is available.'); process.exitCode = 1; });
}
