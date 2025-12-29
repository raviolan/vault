import { sendJson, readBody, parseJsonSafe, decodePathParam } from '../lib/http.js';
import { badRequest, notFound } from '../lib/errors.js';

export function routeTags(req, res, ctx) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = url;

  // GET /api/tags -> { tags: [{ name, count }] }
  if (pathname === '/api/tags' && req.method === 'GET') {
    const tags = ctx.dbListTagsWithCounts(ctx.db);
    sendJson(res, 200, { tags });
    return true;
  }

  // /api/pages/:id/tags
  const pageTagsMatch = pathname.match(/^\/api\/pages\/([^\/]+)\/tags$/);
  if (pageTagsMatch) {
    const pageId = decodePathParam(pageTagsMatch[1]);
    // Do not infer existence from tag rows; check pages table directly
    const exists = !!ctx.db.prepare('SELECT 1 FROM pages WHERE id = ? LIMIT 1').get(pageId);
    if (!exists) { notFound(res); return true; }

    if (req.method === 'GET') {
      const tags = ctx.dbGetPageTags(ctx.db, pageId);
      sendJson(res, 200, { pageId, tags });
      return true;
    }

    if (req.method === 'PUT') {
      return (async () => {
        const body = parseJsonSafe(await readBody(req), {});
        if (!body || !Array.isArray(body.tags)) { badRequest(res, 'tags required'); return true; }
        const tags = ctx.dbSetPageTags(ctx.db, pageId, body.tags);
        sendJson(res, 200, { pageId, tags });
        return true;
      })();
    }
  }

  return false;
}
