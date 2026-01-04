import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { sendJson, sendText } from '../lib/http.js';

// Proxy for Open5e with simple disk caching.
// GET /api/open5e/* => https://api.open5e.com/*
// Safety: GET only; no path traversal; HTTPS only upstream.

const UPSTREAM_BASE = 'https://api.open5e.com/';
const DEFAULT_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

function safeJoin(base, tail) {
  // Disallow parent segments
  if (tail.includes('..')) throw Object.assign(new Error('bad path'), { status: 400 });
  return new URL(tail.replace(/^\/+/, ''), base).toString();
}

function cachePaths(DATA_DIR, fullUrl) {
  const cacheDir = path.join(DATA_DIR, 'cache', 'open5e');
  const h = crypto.createHash('sha1').update(fullUrl).digest('hex');
  const pfx = path.join(cacheDir, h);
  return { dir: cacheDir, body: `${pfx}.body`, meta: `${pfx}.json` };
}

async function readCache(metaPath, bodyPath) {
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    const body = fs.readFileSync(bodyPath);
    return { meta, body };
  } catch {
    return null;
  }
}

function writeCache(metaPath, bodyPath, meta, body) {
  fs.mkdirSync(path.dirname(metaPath), { recursive: true });
  fs.writeFileSync(bodyPath, body);
  fs.writeFileSync(metaPath, JSON.stringify(meta));
}

export async function routeOpen5e(req, res, ctx) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname, search } = url;
  const m = pathname.match(/^\/api\/open5e\/(.*)$/);
  if (!m) return false;

  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'method not allowed' });
    return true;
  }

  // Local helper: list pages linked to a specific Open5e resource
  // GET /api/open5e/local-pages?type=creature&slug=hawk
  try {
    const tailCheck = decodeURIComponent(m[1] || '').replace(/^\/+/, '');
    if (tailCheck === 'local-pages') {
      const t = (url.searchParams.get('type') || '').toLowerCase();
      const s = (url.searchParams.get('slug') || '').toLowerCase();
      if (!t || !s) { sendJson(res, 200, { pages: [] }); return true; }
      // LIKE-based search on JSON text to avoid requiring JSON1
      const likeType = `%"open5eSource"%"type":"${t.replace(/"/g, '"')}"%`;
      const likeSlug = `%"open5eSource"%"slug":"${s.replace(/"/g, '"')}"%`;
      const rows = ctx.db.prepare(
        `SELECT p.id, p.title, p.slug, p.type
           FROM pages p
           JOIN page_sheets ps ON ps.page_id = p.id
          WHERE ps.sheet_json LIKE ? ESCAPE '\\'
            AND ps.sheet_json LIKE ? ESCAPE '\\'
          LIMIT 5`
      ).all(likeType, likeSlug);
      sendJson(res, 200, { pages: rows });
      return true;
    }
  } catch {}

  // Construct upstream URL safely
  let tail = m[1] || '';
  try { tail = decodeURIComponent(tail); } catch {}
  let upstream;
  try {
    upstream = safeJoin(UPSTREAM_BASE, tail) + (search || '');
    if (!upstream.startsWith('https://')) throw new Error('bad upstream');
  } catch {
    sendJson(res, 400, { error: 'bad request' });
    return true;
  }

  const { dir, body: bodyPath, meta: metaPath } = cachePaths(ctx.DATA_DIR, upstream);
  const ttl = Number(process.env.OPEN5E_CACHE_TTL_MS || DEFAULT_TTL);

  // Serve fresh cache if valid
  try {
    const cached = await readCache(metaPath, bodyPath);
    if (cached && (Date.now() - (cached.meta.savedAt || 0) < ttl)) {
      const ct = cached.meta.contentType || 'application/json; charset=utf-8';
      res.writeHead(cached.meta.status || 200, { 'Content-Type': ct });
      res.end(cached.body);
      return true;
    }
  } catch {}

  // Fetch upstream; on failure, serve stale cache if present
  let resp;
  try {
    resp = await fetch(upstream, { method: 'GET' });
  } catch (e) {
    const cached = await readCache(metaPath, bodyPath);
    if (cached) {
      const ct = cached.meta.contentType || 'application/json; charset=utf-8';
      res.writeHead(cached.meta.status || 200, { 'Content-Type': ct, 'X-Cache': 'STALE' });
      res.end(cached.body);
      return true;
    }
    sendJson(res, 502, { error: 'upstream unavailable' });
    return true;
  }

  const buf = Buffer.from(await resp.arrayBuffer());
  const ct = resp.headers.get('content-type') || 'application/json; charset=utf-8';
  const status = resp.status;
  try {
    writeCache(metaPath, bodyPath, { status, contentType: ct, savedAt: Date.now(), upstream }, buf);
  } catch {}

  res.writeHead(status, { 'Content-Type': ct });
  res.end(buf);
  return true;
}
