import { sendJson } from '../lib/http.js';
import { badRequest } from '../lib/errors.js';
import { escapeLike } from '../db/index.js';

// GET /api/wikilinks/occurrences?label=<label>&limit=100
export function routeWikiLinks(req, res, ctx) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname, searchParams } = url;

  if (pathname === '/api/wikilinks/occurrences' && req.method === 'GET') {
    const rawLabel = String(searchParams.get('label') || '').trim();
    const limit = Math.min(Math.max(Number(searchParams.get('limit')) || 100, 1), 500);
    if (!rawLabel) { badRequest(res, 'label required'); return true; }

    const token = `[[${rawLabel}]]`;
    const like = `%${escapeLike(token)}%`;

    // Fetch candidate blocks that contain the literal token in content or props JSON
    const rows = ctx.db.prepare(`
      SELECT b.id AS block_id, b.page_id, p.title, p.slug, p.type, p.updated_at,
             b.content_json, b.props_json
        FROM blocks b
        JOIN pages p ON p.id = b.page_id
       WHERE (b.content_json LIKE ? ESCAPE '\\'
           OR b.props_json LIKE ? ESCAPE '\\')
       ORDER BY p.updated_at DESC, p.id, b.parent_id IS NOT NULL, b.parent_id, b.sort, b.created_at
    `).all(like, like);

    // Group by page and count exact occurrences of the literal token
    const byPage = new Map();
    for (const r of rows) {
      const pageId = r.page_id;
      let entry = byPage.get(pageId);
      if (!entry) {
        entry = { pageId, title: r.title, slug: r.slug, type: r.type, matches: 0, blockIds: [] };
        byPage.set(pageId, entry);
      }
      const cj = String(r.content_json || '');
      const pj = String(r.props_json || '');
      const countIn = (s) => (s.split(token).length - 1);
      const cnt = countIn(cj) + countIn(pj);
      if (cnt > 0) {
        entry.matches += cnt;
        entry.blockIds.push(r.block_id);
      }
    }

    // Order by page updated_at (already ordered in query), then slice to limit
    const results = Array.from(byPage.values()).slice(0, limit)
      .filter(r => r.matches > 0);

    sendJson(res, 200, results);
    return true;
  }

  // POST /api/wikilinks/resolve
  if (pathname === '/api/wikilinks/resolve' && req.method === 'POST') {
    return (async () => {
      // Read body (keep under http.readBody limit semantics)
      const chunks = [];
      let total = 0;
      await new Promise((resolve, reject) => {
        req.on('data', (c) => { total += c.length; if (total > 2_000_000) { reject(Object.assign(new Error('payload too large'), { status: 413 })); try { req.destroy(); } catch {} } chunks.push(c); });
        req.on('end', resolve);
        req.on('error', reject);
      });
      let payload = {};
      try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch {}

      const label = String(payload.label || '').trim();
      const targetPageId = String(payload.targetPageId || '').trim();
      const scope = String(payload.scope || 'page');
      const pageId = payload.pageId ? String(payload.pageId) : null;
      const pageIdsReq = Array.isArray(payload.pageIds) ? payload.pageIds.map(String) : null;

      if (!label) { badRequest(res, 'label required'); return true; }
      if (!targetPageId) { badRequest(res, 'targetPageId required'); return true; }

      const token = `[[${label}]]`;
      const replacement = `[[page:${targetPageId}|${label}]]`;
      const like = `%${escapeLike(token)}%`;

      // Determine pages to process
      let pagesToProcess = [];
      if (scope === 'page') {
        if (!pageId) { badRequest(res, 'pageId required for scope=page'); return true; }
        pagesToProcess = [pageId];
      } else {
        if (pageIdsReq && pageIdsReq.length) {
          // Use provided subset
          const uniq = Array.from(new Set(pageIdsReq.map(s => String(s).trim()).filter(Boolean)));
          pagesToProcess = uniq;
        } else {
          // Fallback: all pages that have occurrences
          const rows = ctx.db.prepare(`
            SELECT DISTINCT b.page_id AS page_id
              FROM blocks b
             WHERE (b.content_json LIKE ? ESCAPE '\\' OR b.props_json LIKE ? ESCAPE '\\')
          `).all(like, like);
          pagesToProcess = rows.map(r => r.page_id);
        }
      }

      let updatedBlocks = 0;
      let updatedPages = 0;
      const ts = Math.floor(Date.now() / 1000);

      const updBlock = ctx.db.prepare('UPDATE blocks SET content_json = ?, props_json = ?, updated_at = ? WHERE id = ?');
      const touchPage = ctx.db.prepare('UPDATE pages SET updated_at = ? WHERE id = ?');

      for (const pid of pagesToProcess) {
        const blocks = ctx.db.prepare(`
          SELECT id, content_json, props_json
            FROM blocks
           WHERE page_id = ?
             AND (content_json LIKE ? ESCAPE '\\' OR props_json LIKE ? ESCAPE '\\')
        `).all(pid, like, like);

        let pageChanged = false;
        for (const b of blocks) {
          // Replace only exact literal token [[label]]; leave [[page:...]] untouched
          const replaceAll = (s) => {
            const str = String(s || '');
            if (!str || str.indexOf(token) === -1) return str;
            return str.split(token).join(replacement);
          };

          const newContent = replaceAll(b.content_json);
          const newProps = replaceAll(b.props_json);
          if (newContent !== b.content_json || newProps !== b.props_json) {
            updBlock.run(newContent, newProps, ts, b.id);
            updatedBlocks++;
            pageChanged = true;
          }
        }
        if (pageChanged) {
          touchPage.run(ts, pid);
          updatedPages++;
        }
      }

      sendJson(res, 200, { updatedPages, updatedBlocks });
      return true;
    })();
  }

  return false;
}

