import { sendJson } from '../lib/http.js';

export function routeSearch(req, res, ctx) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = url;
  if (pathname === '/api/search' && req.method === 'GET') {
    const q = url.searchParams.get('q') || '';
    const results = ctx.dbSearchPages(ctx.db, q, 30);
    sendJson(res, 200, { q, results });
    return true;
  }
  return false;
}

