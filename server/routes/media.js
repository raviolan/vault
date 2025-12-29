import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { sendJson, sendText, readBuffer, writeJsonAtomic, decodePathParam } from '../lib/http.js';

const FILE_RE = /^[a-z0-9-]+\.(png|jpg|jpeg|webp|gif|avif)$/i;
const ALLOWED_MIME = new Set([
  'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'
]);

function extForContentType(ct) {
  const lower = String(ct || '').toLowerCase();
  if (lower.includes('image/png')) return 'png';
  if (lower.includes('image/jpeg') || lower.includes('image/jpg')) return 'jpg';
  if (lower.includes('image/webp')) return 'webp';
  if (lower.includes('image/gif')) return 'gif';
  if (lower.includes('image/avif')) return 'avif';
  return null;
}

function contentTypeForExt(ext) {
  const e = String(ext || '').toLowerCase();
  return (
    e === 'png' ? 'image/png' :
    e === 'jpg' || e === 'jpeg' ? 'image/jpeg' :
    e === 'webp' ? 'image/webp' :
    e === 'gif' ? 'image/gif' :
    e === 'avif' ? 'image/avif' :
    'application/octet-stream'
  );
}

function ensureMediaDir(DATA_DIR) {
  const dir = path.join(DATA_DIR, 'media');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function loadUserState(USER_DIR) {
  const p = path.join(USER_DIR, 'state.json');
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return {}; }
}

export function routeMedia(req, res, ctx) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname, searchParams } = url;

  // Serve files: GET /media/<filename>
  const m = pathname.match(/^\/media\/([^\/]+)$/);
  if (m && req.method === 'GET') {
    const fname = decodePathParam(m[1]);
    if (!FILE_RE.test(fname)) { sendText(res, 400, 'bad filename'); return true; }
    const dir = ensureMediaDir(ctx.DATA_DIR);
    const full = path.join(dir, fname);
    const norm = path.normalize(full);
    if (!norm.startsWith(dir + path.sep)) { sendText(res, 400, 'bad filename'); return true; }
    if (!fs.existsSync(norm) || !fs.statSync(norm).isFile()) { sendText(res, 404, 'not found'); return true; }
    const ext = path.extname(norm).slice(1).toLowerCase();
    res.writeHead(200, { 'Content-Type': contentTypeForExt(ext), 'Cache-Control': 'public, max-age=31536000, immutable' });
    fs.createReadStream(norm).pipe(res);
    return true;
  }

  // Upload and associate: POST /api/media/upload
  if (pathname === '/api/media/upload' && req.method === 'POST') {
    return (async () => {
      const scope = String(searchParams.get('scope') || '');
      const slot = String(searchParams.get('slot') || '');
      const pageId = searchParams.get('pageId');
      const surfaceId = searchParams.get('surfaceId');
      if (!['page', 'surface'].includes(scope)) { sendJson(res, 400, { error: 'invalid scope' }); return true; }
      if (!['header', 'profile'].includes(slot)) { sendJson(res, 400, { error: 'invalid slot' }); return true; }
      if (scope === 'page' && !pageId) { sendJson(res, 400, { error: 'pageId required' }); return true; }
      if (scope === 'surface' && !surfaceId) { sendJson(res, 400, { error: 'surfaceId required' }); return true; }

      const ct = String(req.headers['content-type'] || '').toLowerCase();
      if (!Array.from(ALLOWED_MIME).some(m => ct.includes(m))) { sendJson(res, 415, { error: 'unsupported media type' }); return true; }
      const ext = extForContentType(ct);
      if (!ext) { sendJson(res, 415, { error: 'unsupported media type' }); return true; }

      const buf = await readBuffer(req, 10 * 1024 * 1024); // 10MB limit
      const dir = ensureMediaDir(ctx.DATA_DIR);
      const name = `${randomUUID()}.${ext}`.toLowerCase().replace(/[^a-z0-9.-]/g, '-');
      const full = path.join(dir, name);
      fs.writeFileSync(full, buf);

      let posX = 50, posY = 50, zoom = 1;

      if (scope === 'page') {
        // Optional cleanup of old file
        try {
          const cur = ctx.db.prepare('SELECT * FROM page_media WHERE page_id = ?').get(pageId);
          const old = slot === 'header' ? cur?.header_path : cur?.profile_path;
          if (old && FILE_RE.test(old)) {
            const p = path.join(dir, old);
            if (p.startsWith(dir) && fs.existsSync(p)) fs.unlinkSync(p);
          }
        } catch {}
        const patch = (slot === 'header') ? { header: { path: name, posX, posY, zoom } } : { profile: { path: name, posX, posY, zoom } };
        const rec = ctx.dbSetPageMedia(ctx.db, pageId, patch);
        if (slot === 'header' && rec?.header) { posX = rec.header.posX; posY = rec.header.posY; zoom = Number(rec.header.zoom ?? 1); }
        if (slot === 'profile' && rec?.profile) { posX = rec.profile.posX; posY = rec.profile.posY; zoom = Number(rec.profile.zoom ?? 1); }
      } else if (scope === 'surface') {
        const state = loadUserState(ctx.USER_DIR);
        const cur = state.surfaceMediaV1 && state.surfaceMediaV1.surfaces ? state.surfaceMediaV1 : { surfaces: {} };
        const s = cur.surfaces || (cur.surfaces = {});
        const prev = s[surfaceId] || {};
        // Optional cleanup of old file
        try {
          const old = prev?.header?.path;
          if (old && FILE_RE.test(old)) {
            const p = path.join(dir, old);
            if (p.startsWith(dir) && fs.existsSync(p)) fs.unlinkSync(p);
          }
        } catch {}
        s[surfaceId] = { ...(prev || {}), header: { path: name, posX, posY, zoom } };
        const next = { ...state, surfaceMediaV1: { surfaces: s } };
        const p = path.join(ctx.USER_DIR, 'state.json');
        writeJsonAtomic(p, next);
      }

      sendJson(res, 200, { ok: true, slot, path: name, url: `/media/${name}`, posX, posY, zoom });
      return true;
    })();
  }

  // Update position: PATCH /api/media/position
  if (pathname === '/api/media/position' && req.method === 'PATCH') {
    return (async () => {
      let body = {};
      try { body = JSON.parse(String(await readBuffer(req, 256 * 1024))); } catch {}
      const { scope, pageId, surfaceId, slot, posX, posY, zoom } = body || {};
      if (!['page', 'surface'].includes(scope)) { sendJson(res, 400, { error: 'invalid scope' }); return true; }
      if (!['header', 'profile'].includes(slot)) { sendJson(res, 400, { error: 'invalid slot' }); return true; }
      const x = Number(posX), y = Number(posY);
      if (!(x >= 0 && x <= 100 && y >= 0 && y <= 100)) { sendJson(res, 400, { error: 'invalid pos' }); return true; }
      const z = (zoom === undefined || zoom === null) ? undefined : Number(zoom);
      if (z !== undefined && !(z >= 0.5 && z <= 3.0)) { sendJson(res, 400, { error: 'invalid zoom' }); return true; }
      if (scope === 'page') {
        if (!pageId) { sendJson(res, 400, { error: 'pageId required' }); return true; }
        const patch = (slot === 'header') ? { header: { posX: x, posY: y, ...(z !== undefined ? { zoom: z } : {}) } } : { profile: { posX: x, posY: y, ...(z !== undefined ? { zoom: z } : {}) } };
        ctx.dbSetPageMedia(ctx.db, pageId, patch);
      } else {
        if (!surfaceId) { sendJson(res, 400, { error: 'surfaceId required' }); return true; }
        const state = loadUserState(ctx.USER_DIR);
        const cur = state.surfaceMediaV1 && state.surfaceMediaV1.surfaces ? state.surfaceMediaV1 : { surfaces: {} };
        const s = cur.surfaces || (cur.surfaces = {});
        const prev = s[surfaceId] || {};
        if (slot === 'header') {
          const header = prev.header ? { ...prev.header, posX: x, posY: y } : { path: null, posX: x, posY: y };
          if (z !== undefined) header.zoom = z;
          s[surfaceId] = { ...(prev || {}), header };
        }
        const next = { ...state, surfaceMediaV1: { surfaces: s } };
        const p = path.join(ctx.USER_DIR, 'state.json');
        writeJsonAtomic(p, next);
      }
      sendJson(res, 200, { ok: true });
      return true;
    })();
  }

  // Remove image: DELETE /api/media
  if (pathname === '/api/media' && req.method === 'DELETE') {
    const scope = String(searchParams.get('scope') || '');
    const slot = String(searchParams.get('slot') || '');
    const pageId = searchParams.get('pageId');
    const surfaceId = searchParams.get('surfaceId');
    if (!['page', 'surface'].includes(scope)) { sendJson(res, 400, { error: 'invalid scope' }); return true; }
    if (!['header', 'profile'].includes(slot)) { sendJson(res, 400, { error: 'invalid slot' }); return true; }

    const dir = ensureMediaDir(ctx.DATA_DIR);

    if (scope === 'page') {
      if (!pageId) { sendJson(res, 400, { error: 'pageId required' }); return true; }
      // Remove file from disk if any
      try {
        const cur = ctx.db.prepare('SELECT * FROM page_media WHERE page_id = ?').get(pageId);
        const old = slot === 'header' ? cur?.header_path : cur?.profile_path;
        if (old && FILE_RE.test(old)) {
          const p = path.join(dir, old);
          if (p.startsWith(dir) && fs.existsSync(p)) fs.unlinkSync(p);
        }
      } catch {}
      ctx.dbClearPageMediaSlot(ctx.db, pageId, slot);
    } else {
      if (!surfaceId) { sendJson(res, 400, { error: 'surfaceId required' }); return true; }
      const state = loadUserState(ctx.USER_DIR);
      const cur = state.surfaceMediaV1 && state.surfaceMediaV1.surfaces ? state.surfaceMediaV1 : { surfaces: {} };
      const s = cur.surfaces || (cur.surfaces = {});
      const prev = s[surfaceId] || {};
      try {
        const old = prev?.header?.path;
        if (old && FILE_RE.test(old)) {
          const p = path.join(dir, old);
          if (p.startsWith(dir) && fs.existsSync(p)) fs.unlinkSync(p);
        }
      } catch {}
      if (prev) {
        s[surfaceId] = { ...(prev || {}), header: null };
      }
      const next = { ...state, surfaceMediaV1: { surfaces: s } };
      const p = path.join(ctx.USER_DIR, 'state.json');
      writeJsonAtomic(p, next);
    }

    sendJson(res, 200, { ok: true });
    return true;
  }

  return false;
}
