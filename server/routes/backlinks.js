import { sendJson } from '../lib/http.js';
import { notFound } from '../lib/errors.js';

export function routeBacklinks(req, res, ctx) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = url;

  const backlinksMatch = pathname.match(/^\/api\/pages\/([^\/]+)\/backlinks$/);
  if (backlinksMatch && req.method === 'GET') {
    const id = backlinksMatch[1];
    const page = ctx.dbGetPageWithBlocks(ctx.db, id);
    if (!page) { notFound(res); return true; }
    const backlinks = ctx.dbGetBacklinks(ctx.db, id);
    if (backlinks == null) { notFound(res); return true; }
    sendJson(res, 200, { pageId: id, title: page.title, backlinks });
    return true;
  }
  return false;
}
