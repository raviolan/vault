import { sendJson, readBody } from '../lib/http.js';
import { badRequest, notFound } from '../lib/errors.js';

export function routePages(req, res, ctx) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = url;

  // GET /api/pages
  if (pathname === '/api/pages' && req.method === 'GET') {
    sendJson(res, 200, ctx.dbListPages(ctx.db));
    return true;
  }

  // POST /api/pages (create)
  if (pathname === '/api/pages' && req.method === 'POST') {
    return (async () => {
      const body = JSON.parse(await readBody(req) || '{}');
      if (!body.title) return badRequest(res, 'title required'), true;
      const page = ctx.dbCreatePage(ctx.db, { title: String(body.title), type: String(body.type || 'note') });
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
    const slug = slugMatch[1];
    const page = ctx.dbGetPageWithBlocksBySlug(ctx.db, slug);
    if (!page) { notFound(res); return true; }
    sendJson(res, 200, page);
    return true;
  }

  // /api/pages/:id
  const pageIdMatch = pathname.match(/^\/api\/pages\/([^\/]+)$/);
  if (pageIdMatch) {
    const id = pageIdMatch[1];
    if (req.method === 'GET') {
      const page = ctx.dbGetPageWithBlocks(ctx.db, id);
      if (!page) { notFound(res); return true; }
      sendJson(res, 200, page);
      return true;
    }
    if (req.method === 'PATCH') {
      return (async () => {
        const body = JSON.parse(await readBody(req) || '{}');
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
