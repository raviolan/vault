import { sendJson, readBody } from '../lib/http.js';
import { badRequest, notFound } from '../lib/errors.js';

export function routeBlocks(req, res, ctx) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = url;

  // POST /api/pages/:id/blocks (create block for page)
  const pageBlocksMatch = pathname.match(/^\/api\/pages\/([^\/]+)\/blocks$/);
  if (pageBlocksMatch && req.method === 'POST') {
    return (async () => {
      const pageId = pageBlocksMatch[1];
      const bodyRaw = await readBody(req);
      let body = {};
      try { body = JSON.parse(bodyRaw || '{}'); } catch {}
      const { type, parentId = null, sort = 0, props = {}, content = {} } = body;
      if (!type) { badRequest(res, 'type required'); return true; }
      const block = ctx.dbCreateBlock(ctx.db, { pageId, parentId, sort: Number(sort) || 0, type: String(type), props, content });
      sendJson(res, 201, block);
      return true;
    })();
  }

  // PATCH/DELETE /api/blocks/:id
  const blockMatch = pathname.match(/^\/api\/blocks\/([^\/]+)$/);
  if (blockMatch && req.method === 'PATCH') {
    return (async () => {
      const blockId = blockMatch[1];
      const bodyRaw = await readBody(req);
      let patch = {};
      try { patch = JSON.parse(bodyRaw || '{}'); } catch {}
      const updated = ctx.dbPatchBlock(ctx.db, blockId, patch || {});
      if (!updated) { notFound(res); return true; }
      sendJson(res, 200, updated);
      return true;
    })();
  }
    if (blockMatch && req.method === 'DELETE') {
      const blockId = blockMatch[1];
      const ok = ctx.dbDeleteBlock(ctx.db, blockId);
    if (!ok) { notFound(res); return true; }
      sendJson(res, 200, { ok: true });
      return true;
    }

  // POST /api/blocks/reorder
  if (pathname === '/api/blocks/reorder' && req.method === 'POST') {
    return (async () => {
      const bodyRaw = await readBody(req);
      let reqBody = {};
      try { reqBody = JSON.parse(bodyRaw || '{}'); } catch {}
      const pageId = reqBody.pageId;
      const moves = Array.isArray(reqBody.moves) ? reqBody.moves.map(m => ({ id: m.id, parentId: m.parentId ?? null, sort: Number(m.sort) || 0 })) : [];
      if (!pageId) { badRequest(res, 'pageId required'); return true; }
      const out = ctx.dbReorderBlocks(ctx.db, pageId, moves);
      sendJson(res, 200, out);
      return true;
    })();
  }

  return false;
}
