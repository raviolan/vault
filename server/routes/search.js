import { sendJson } from '../lib/http.js';

function parseArchivedMode(raw) {
  const mode = String(raw || '').toLowerCase();
  if (mode === 'only' || mode === 'include') return mode;
  if (mode === '1' || mode === 'true') return 'include';
  return 'exclude';
}

export function routeSearch(req, res, ctx) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = url;
  if (pathname === '/api/search' && req.method === 'GET') {
    const q = url.searchParams.get('q') || '';
    const limitParam = url.searchParams.get('limit');
    const limit = Math.max(1, Math.min(1000, Number(limitParam) || 30));
    const detailFlag = (url.searchParams.get('detail') || url.searchParams.get('includeMatches') || '').toLowerCase();
    const wantDetail = detailFlag === '1' || detailFlag === 'true';
    const archived = parseArchivedMode(url.searchParams.get('archived'));
    const results = wantDetail && ctx.dbSearchPagesWithMatches
      ? ctx.dbSearchPagesWithMatches(ctx.db, q, limit, 3, { archived })
      : ctx.dbSearchPages(ctx.db, q, limit, { archived });
    sendJson(res, 200, { q, results });
    return true;
  }
  return false;
}
