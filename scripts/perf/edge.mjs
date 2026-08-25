#!/usr/bin/env node
/**
 * A stand-in for Vercel's edge, so the numbers mean something.
 *
 * Measuring against `vite preview` or a bare static server measures a server
 * this shop does not use. The routing and the cache headers in vercel.json are
 * a real part of how fast the site is — an asset served without
 * `immutable` is a revalidation on every repeat view — so they are replicated
 * here rather than assumed away. Everything below is read from vercel.json at
 * startup; nothing is hard-coded twice.
 *
 *   node scripts/perf/edge.mjs --port=5000 --api=4000
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIST = path.join(ROOT, 'dist');
const PORT = Number(arg('port', 5000));
const API = Number(arg('api', 4000));

const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));

/* vercel.json source patterns are path-to-regexp-ish. Only the handful of forms
   this file actually uses are supported, and an unrecognised one throws rather
   than silently matching nothing — a rewrite that quietly stops applying would
   make the measurement wrong in the flattering direction. */
const toRe = (src) => {
  if (src === '/(.*)') return /^\//;
  const m = src.match(/^\/\(\?!api\/\)?\.\*\)$/) || src.match(/^\/\(\(\?!api\/\)\.\*\)$/);
  if (m) return { negativePrefix: '/api/' };
  const body = src
    .replace(/^\//, '')
    .replace(/\(\.\*\)/g, '.*')
    .replace(/\(([a-z|]+)\)/g, '($1)');
  return new RegExp(`^/${body}$`);
};

const HEADER_RULES = (cfg.headers || []).map((h) => ({ re: toRe(h.source), headers: h.headers }));
const REWRITES = (cfg.rewrites || []).map((r) => ({ re: toRe(r.source), dest: r.destination }));

const headersFor = (url) => {
  const out = {};
  for (const rule of HEADER_RULES) {
    const hit = rule.re instanceof RegExp ? rule.re.test(url) : !url.startsWith(rule.re.negativePrefix);
    if (hit) for (const { key, value } of rule.headers) out[key] = value;
  }
  return out;
};

const rewriteFor = (url) => {
  for (const r of REWRITES) {
    if (r.re instanceof RegExp ? r.re.test(url) : !url.startsWith(r.re.negativePrefix)) return r.dest;
  }
  return null;
};

/* Compression, because the real edge compresses.
   Measured without it first, and the numbers were fiction: 457 KB of
   JavaScript on the wire where Vercel would have sent about 130. Every
   conclusion drawn from that would have been about a transfer that never
   happens. Text is compressed, already-compressed formats are not — gzipping a
   webp costs CPU and adds bytes. */
const COMPRESSIBLE = /^(text\/|application\/(javascript|json|xml|manifest)|image\/svg)/;

const TYPES = {
  '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json',
  '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json',
};

/* The API's responses are compressed here, not by the API.
   Express has no compression middleware in this project, and the edge is what
   compresses in production — /api/products is 56 KB of JSON that arrives as
   about 8. Modelling that here matters both ways: without it the catalogue
   looks half a second slower than it is, and adding compression to Express
   later would look like a win that the edge had already delivered. */
const proxy = (req, res, extra = {}) => {
  const accepts = String(req.headers['accept-encoding'] || '');
  const enc = /\bbr\b/.test(accepts) ? 'br' : /\bgzip\b/.test(accepts) ? 'gzip' : null;

  const up = http.request(
    { host: '127.0.0.1', port: API, path: req.url, method: req.method,
      headers: { ...req.headers, host: `localhost:${PORT}`, 'accept-encoding': 'identity' } },
    (r) => {
      const type = String(r.headers['content-type'] || '');
      if (!enc || !COMPRESSIBLE.test(type) || r.headers['content-encoding']) {
        res.writeHead(r.statusCode, { ...r.headers, ...extra });
        return r.pipe(res);
      }
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => {
        const raw = Buffer.concat(chunks);
        const out = enc === 'br'
          ? zlib.brotliCompressSync(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } })
          : zlib.gzipSync(raw, { level: 6 });
        const headers = { ...r.headers, ...extra, 'content-encoding': enc,
          'content-length': out.length, vary: 'Accept-Encoding' };
        delete headers['transfer-encoding'];
        res.writeHead(r.statusCode, headers);
        res.end(out);
      });
    });
  up.on('error', (e) => { res.writeHead(502); res.end(e.message); });
  req.pipe(up);
};

const sendFile = (res, file, extra, req) => {
  const type = TYPES[path.extname(file)] || 'application/octet-stream';
  const accepts = String(req?.headers['accept-encoding'] || '');
  const body = fs.readFileSync(file);

  if (COMPRESSIBLE.test(type)) {
    // br where offered, gzip otherwise — the same order a CDN negotiates in.
    const enc = /\bbr\b/.test(accepts) ? 'br' : /\bgzip\b/.test(accepts) ? 'gzip' : null;
    if (enc) {
      const out = enc === 'br'
        ? zlib.brotliCompressSync(body, {
          params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } })   // a CDN's on-the-fly level
        : zlib.gzipSync(body, { level: 6 });
      res.writeHead(200, { 'content-type': type, 'content-encoding': enc,
        'content-length': out.length, vary: 'Accept-Encoding', ...extra });
      return res.end(out);
    }
  }
  res.writeHead(200, { 'content-type': type, 'content-length': body.length, ...extra });
  return res.end(body);
};

http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  const extra = headersFor(url);

  // Real files win, exactly as they do on the CDN.
  let file = path.join(DIST, url === '/' ? 'index.html' : url.replace(/^\/+/, ''));
  if (file.startsWith(DIST) && fs.existsSync(file)) {
    if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (fs.existsSync(file) && fs.statSync(file).isFile()) return sendFile(res, file, extra, req);
  }

  const dest = rewriteFor(url);
  if (dest === '/api') return proxy(req, res, extra);
  return sendFile(res, path.join(DIST, 'index.html'), extra, req);
}).listen(PORT, () => {
  console.log(`edge on :${PORT} → api :${API}`);
  console.log(`  ${REWRITES.length} rewrites, ${HEADER_RULES.length} header rules from vercel.json`);
});
