import { sendJson, readBody, parseJsonSafe } from '../lib/http.js';
import { badRequest } from '../lib/errors.js';
import { escapeLike } from '../db/index.js';

// GET /api/wikilinks/occurrences?label=<label>&limit=100
export function routeWikiLinks(req, res, ctx) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname, searchParams } = url;

  // Helper utils for linkify endpoint
  const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const shouldUseWordBoundaries = (term) => /^[\p{L}\p{N}_-]+$/u.test(String(term || ''));
  const linkifyText = (text, term, targetPageId, caseSensitive) => {
    const src = String(text || '');
    if (!src || !term) return { outText: src, replacements: 0 };

    // Split by inline code spans and preserve them
    const parts = src.split(/(`[^`]*`)/g);
    let total = 0;
    const out = [];

    // Prepare regex for non-code segments
    const termEsc = escapeRegExp(term);
    const wordish = shouldUseWordBoundaries(term);
    const body = wordish
      ? `(?<![\\p{L}\\p{N}_])(${termEsc})(?![\\p{L}\\p{N}_])`
      : `(${termEsc})`;
    const flags = `gu${caseSensitive ? '' : 'i'}`;
    const re = new RegExp(body, flags);

    for (const part of parts) {
      if (!part) { out.push(part); continue; }
      if (part.startsWith('`') && part.endsWith('`')) { out.push(part); continue; }

      // Protect existing wikilinks
      const placeholders = [];
      const protectedStr = part.replace(/\[\[[^\]]+\]\]/g, (m) => {
        const key = `§§WIKI_${placeholders.length}§§`;
        placeholders.push({ key, token: m });
        return key;
      });

      let replaced = protectedStr.replace(re, (_m, cap) => {
        total += 1;
        return `[[page:${targetPageId}|${cap}]]`;
      });

      // Restore placeholders
      for (const ph of placeholders) {
        replaced = replaced.split(ph.key).join(ph.token);
      }
      out.push(replaced);
    }
    return { outText: out.join(''), replacements: total };
  };

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

  // POST /api/wikilinks/linkify
  if (pathname === '/api/wikilinks/linkify' && req.method === 'POST') {
    return (async () => {
      // Parse JSON body
      const bodyRaw = await readBody(req);
      const payload = parseJsonSafe(bodyRaw, {});

      const term = String(payload.term || '').trim();
      const targetPageId = String(payload.targetPageId || '').trim();
      const scope = String(payload.scope || 'pages');
      const pageIdsReq = Array.isArray(payload.pageIds) ? payload.pageIds.map(String) : [];
      const pageId = payload.pageId ? String(payload.pageId) : null;
      const caseSensitive = Boolean(payload.caseSensitive);

      if (!term) { badRequest(res, 'term required'); return true; }
      if (!targetPageId) { badRequest(res, 'targetPageId required'); return true; }

      // Determine LIKE prefilter
      const like = `%${escapeLike(term)}%`;

      // Determine pages to process
      let pagesToProcess = [];
      if (scope === 'pages') {
        if (!pageIdsReq || pageIdsReq.length === 0) { badRequest(res, 'pageIds required for scope=pages'); return true; }
        pagesToProcess = Array.from(new Set(pageIdsReq.filter(Boolean)));
      } else if (scope === 'page') {
        if (!pageId) { badRequest(res, 'pageId required for scope=page'); return true; }
        pagesToProcess = [pageId];
      } else if (scope === 'global') {
        const rows = ctx.db.prepare(`
          SELECT DISTINCT b.page_id AS page_id
            FROM blocks b
           WHERE (b.content_json LIKE ? ESCAPE '\\' OR b.props_json LIKE ? ESCAPE '\\')
        `).all(like, like);
        pagesToProcess = rows.map(r => r.page_id);
      } else {
        badRequest(res, 'invalid scope');
        return true;
      }

      let updatedBlocks = 0;
      let updatedPages = 0;
      let linkedOccurrences = 0;
      const ts = Math.floor(Date.now() / 1000);

      const updBlock = ctx.db.prepare('UPDATE blocks SET content_json = ?, updated_at = ? WHERE id = ?');
      const touchPage = ctx.db.prepare('UPDATE pages SET updated_at = ? WHERE id = ?');

      for (const pid of pagesToProcess) {
        const blocks = ctx.db.prepare(`
          SELECT id, type, content_json, props_json
            FROM blocks
           WHERE page_id = ?
             AND (content_json LIKE ? ESCAPE '\\' OR props_json LIKE ? ESCAPE '\\')
        `).all(pid, like, like);

        let pageChanged = false;
        for (const b of blocks) {
          let contentObj = null;
          try { contentObj = JSON.parse(String(b.content_json || '{}') || '{}'); } catch { contentObj = null; }
          // Paragraphs and headings store inline text under content.text
          const hasText = contentObj && typeof contentObj.text === 'string';
          if (!hasText) continue;
          const origText = String(contentObj.text || '');
          const { outText, replacements } = linkifyText(origText, term, targetPageId, caseSensitive);
          if (replacements > 0 && outText !== origText) {
            const next = { ...contentObj, text: outText };
            updBlock.run(JSON.stringify(next), ts, b.id);
            linkedOccurrences += replacements;
            updatedBlocks += 1;
            pageChanged = true;
          }
        }
        if (pageChanged) {
          touchPage.run(ts, pid);
          updatedPages += 1;
        }
      }

      sendJson(res, 200, { updatedPages, updatedBlocks, linkedOccurrences });
      return true;
    })();
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
