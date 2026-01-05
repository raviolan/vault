import { sendJson } from '../lib/http.js';

export function routeSearch(req, res, ctx) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = url;
  if (pathname === '/api/search' && req.method === 'GET') {
    const q = url.searchParams.get('q') || '';
    const limitParam = url.searchParams.get('limit');
    const limit = Math.max(1, Math.min(1000, Number(limitParam) || 30));
    const detailFlag = (url.searchParams.get('detail') || url.searchParams.get('includeMatches') || '').toLowerCase();
    const wantDetail = detailFlag === '1' || detailFlag === 'true';
    const results = wantDetail && ctx.dbSearchPagesWithMatches
      ? ctx.dbSearchPagesWithMatches(ctx.db, q, limit)
      : ctx.dbSearchPages(ctx.db, q, limit);
    sendJson(res, 200, { q, results });
    return true;
  }
  return false;
}
