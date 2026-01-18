import { sendJson, readBody, decodePathParam } from '../lib/http.js';
import { badRequest, notFound } from '../lib/errors.js';

// Centralized allowlist for page types
const ALLOWED_TYPES = new Set(['note', 'npc', 'character', 'location', 'arc', 'tool']);

export function routePages(req, res, ctx) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = url;

  // GET /api/pages
  if (pathname === '/api/pages' && req.method === 'GET') {
    sendJson(res, 200, ctx.dbListPages(ctx.db));
    return true;
  }

  // GET /api/pages/snapshots
  if (pathname === '/api/pages/snapshots' && req.method === 'GET') {
    const idsParams = url.searchParams.getAll('ids');
    // Support comma-separated and repeated params
    const ids = [];
    for (const part of idsParams) {
      for (const s of String(part || '').split(',')) ids.push(s);
    }
    const snapshots = ctx.dbGetPageSnapshots(ctx.db, ids);
    sendJson(res, 200, { snapshots });
    return true;
  }

  // POST /api/pages (create)
  if (pathname === '/api/pages' && req.method === 'POST') {
    return (async () => {
      const body = JSON.parse(await readBody(req) || '{}');
      if (!body.title) return badRequest(res, 'title required'), true;
      const type = String(body.type || 'note');
      if (!ALLOWED_TYPES.has(type)) { badRequest(res, 'invalid type'); return true; }
      const page = ctx.dbCreatePage(ctx.db, { title: String(body.title), type });
      sendJson(res, 201, page);
      return true;
    })();
  }

  // POST /api/pages/resolve
  if (pathname === '/api/pages/resolve' && req.method === 'POST') {
    return (async () => {
      const body = JSON.parse(await readBody(req) || '{}');
      const title = String(body.title || '').trim();
      const type = String(body.type || 'note');
      if (!title) return badRequest(res, 'title required'), true;
      if (!ALLOWED_TYPES.has(type)) { badRequest(res, 'invalid type'); return true; }
      const row = ctx.db.prepare('SELECT id FROM pages WHERE title = ?').get(title);
      if (row) {
        const page = ctx.dbGetPageWithBlocks(ctx.db, row.id);
        sendJson(res, 200, { page, created: false });
        return true;
      }
      const created = ctx.dbCreatePage(ctx.db, { title, type });
      const page = ctx.dbGetPageWithBlocks(ctx.db, created.id);
      sendJson(res, 201, { page, created: true });
      return true;
    })();
  }

  // GET /api/pages/slug/:slug
  const slugMatch = pathname.match(/^\/api\/pages\/slug\/([^\/]+)$/);
  if (slugMatch && req.method === 'GET') {
    const slug = decodePathParam(slugMatch[1]);
    const page = ctx.dbGetPageWithBlocksBySlug(ctx.db, slug);
    if (!page) { notFound(res); return true; }
    sendJson(res, 200, page);
    return true;
  }

  // GET/PATCH /api/pages/:id/sheet
  const sheetMatch = pathname.match(/^\/api\/pages\/([^\/]+)\/sheet$/);
  if (sheetMatch) {
    const safeDecode = (v) => {
      try { return decodeURIComponent(v); } catch { return String(v || ''); }
    };
    const pageId = typeof decodePathParam === 'function' ? decodePathParam(sheetMatch[1]) : safeDecode(sheetMatch[1]);
    const exists = ctx.db.prepare('SELECT id, type FROM pages WHERE id=?').get(pageId);
    if (!exists) { notFound(res); return true; }

    if (req.method === 'GET') {
      const row = ctx.db.prepare('SELECT sheet_json FROM page_sheets WHERE page_id=?').get(pageId);
      let sheet = {};
      try { sheet = row && row.sheet_json ? JSON.parse(row.sheet_json) : {}; } catch { sheet = {}; }
      sendJson(res, 200, { pageId, sheet });
      return true;
    }

    if (req.method === 'PATCH') {
      return (async () => {
        const body = JSON.parse(await readBody(req) || '{}');
        const toNumOrNull = (v) => (v === '' || v === null || v === undefined) ? null : (Number.isFinite(Number(v)) ? Number(v) : null);
        // Load existing sheet JSON to preserve unrelated keys
        let prev = {};
        try {
          const row = ctx.db.prepare('SELECT sheet_json FROM page_sheets WHERE page_id=?').get(pageId);
          prev = row?.sheet_json ? JSON.parse(row.sheet_json) : {};
        } catch { prev = {}; }

        // Build patch: only coerce known fields; leave others intact
        const patch = {};
        if ('ac' in body) patch.ac = toNumOrNull(body.ac);
        if ('passivePerception' in body) patch.passivePerception = toNumOrNull(body.passivePerception);
        if ('passiveInsight' in body) patch.passiveInsight = toNumOrNull(body.passiveInsight);
        if ('passiveInvestigation' in body) patch.passiveInvestigation = toNumOrNull(body.passiveInvestigation);
        if ('notes' in body) patch.notes = String(body.notes ?? '');
        // New fields
        if ('tagline' in body) patch.tagline = String(body.tagline ?? '');
        if ('hpMax' in body) patch.hpMax = toNumOrNull(body.hpMax);
        if ('xpReward' in body) patch.xpReward = toNumOrNull(body.xpReward);
        // Persist Open5e metadata if provided (objects as-is)
        if (body && typeof body.open5eSource === 'object' && body.open5eSource) {
          patch.open5eSource = body.open5eSource;
        }
        if (body && typeof body.open5eSnapshotV1 === 'object' && body.open5eSnapshotV1) {
          patch.open5eSnapshotV1 = body.open5eSnapshotV1;
        }

        const next = { ...(prev || {}), ...patch };
        const ts = Math.floor(Date.now() / 1000);
        const json = JSON.stringify(next);
        const cur = ctx.db.prepare('SELECT page_id FROM page_sheets WHERE page_id=?').get(pageId);
        if (cur) {
          ctx.db.prepare('UPDATE page_sheets SET sheet_json=?, updated_at=? WHERE page_id=?').run(json, ts, pageId);
        } else {
          ctx.db.prepare('INSERT INTO page_sheets(page_id, sheet_json, updated_at) VALUES (?,?,?)').run(pageId, json, ts);
        }
        sendJson(res, 200, { ok: true, pageId, sheet: next });
        return true;
      })();
    }
  }

  // /api/pages/:id
  const pageIdMatch = pathname.match(/^\/api\/pages\/([^\/]+)$/);
  if (pageIdMatch) {
    const id = decodePathParam(pageIdMatch[1]);
    // Virtual Dashboard page: id = "dashboard"
    if (id === 'dashboard') {
      if (req.method === 'GET') {
        return (async () => {
          const fs = await import('node:fs');
          const path = await import('node:path');
          const { defaultUserState } = await import('./userState.js');
          const p = path.join(ctx.USER_DIR, 'state.json');
          let state = defaultUserState();
          try { state = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
          const blocks = Array.isArray(state.dashboardV1?.blocks) ? state.dashboardV1.blocks : [];
          sendJson(res, 200, { id: 'dashboard', title: 'Dashboard', type: 'tool', blocks });
          return true;
        })();
      }
      if (req.method === 'PATCH') {
        // No-op for virtual dashboard
        sendJson(res, 200, { ok: true });
        return true;
      }
    }
    // Virtual Session page: id = "session"
    if (id === 'session') {
      if (req.method === 'GET') {
        return (async () => {
          const fs = await import('node:fs');
          const path = await import('node:path');
          const { defaultUserState } = await import('./userState.js');
          const p = path.join(ctx.USER_DIR, 'state.json');
          let state = defaultUserState();
          try { state = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
          const blocks = Array.isArray(state.sessionV1?.blocks) ? state.sessionV1.blocks : [];
          sendJson(res, 200, { id: 'session', title: 'Session', type: 'tool', blocks });
          return true;
        })();
      }
      if (req.method === 'PATCH') {
        // No-op for virtual session
        sendJson(res, 200, { ok: true });
        return true;
      }
    }
    // Virtual Section Intro pages: id = section:<key>
    const secMatch = id.match(/^section:(.+)$/);
    if (secMatch) {
      const key = secMatch[1];
      if (req.method === 'GET') {
        return (async () => {
          // Read from user state
          const fs = await import('node:fs');
          const path = await import('node:path');
          const { defaultUserState } = await import('./userState.js');
          const p = path.join(ctx.USER_DIR, 'state.json');
          let state = defaultUserState();
          try { state = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
          const sec = state.sectionIntroV1?.sections?.[key] || {};
          const blocks = Array.isArray(sec.blocks) ? sec.blocks : [];
          const title = key.charAt(0).toUpperCase() + key.slice(1);
          sendJson(res, 200, { id, title, type: 'section', blocks });
          return true;
        })();
      }
      if (req.method === 'PATCH') {
        // No-op for now for virtual sections
        sendJson(res, 200, { ok: true });
        return true;
      }
    }
    if (req.method === 'GET') {
      const page = ctx.dbGetPageWithBlocks(ctx.db, id);
      if (!page) { notFound(res); return true; }
      sendJson(res, 200, page);
      return true;
    }
    if (req.method === 'PATCH') {
      return (async () => {
        const body = JSON.parse(await readBody(req) || '{}');
        // Validate optional type field if provided
        if (body.type !== undefined) {
          const t = String(body.type);
          if (!ALLOWED_TYPES.has(t)) { badRequest(res, 'invalid type'); return true; }
        }
        const updated = ctx.dbPatchPage(ctx.db, id, { title: body.title, type: body.type, regenerateSlug: !!body.regenerateSlug });
        if (!updated) { notFound(res); return true; }
        sendJson(res, 200, updated);
        return true;
      })();
    }
    if (req.method === 'DELETE') {
      ctx.dbDeletePage(ctx.db, id);
      sendJson(res, 200, { ok: true });
      return true;
    }
  }

  return false;
}
