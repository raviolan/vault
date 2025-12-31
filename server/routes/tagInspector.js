import { sendJson, readBody } from '../lib/http.js';
import { badRequest, notFound } from '../lib/errors.js';

function normKey(input) {
  const raw = String(input == null ? '' : input);
  const collapsed = raw.trim().replace(/\s+/g, ' ');
  const key = collapsed.toLowerCase();
  const display = collapsed;
  if (!key) return { error: 'empty' };
  if (key.length > 64) return { error: 'too_long' };
  return { key, display };
}

function getAllTagsWithUsage(db) {
  const tags = db.prepare(`SELECT id, name, display_name, created_at FROM tags`).all();
  const usage = db.prepare(`
    SELECT pt.tag_id AS tag_id, COUNT(DISTINCT pt.page_id) AS pages
    FROM page_tags pt
    GROUP BY pt.tag_id
  `).all();
  const byType = db.prepare(`
    SELECT pt.tag_id AS tag_id, p.type AS type, COUNT(DISTINCT p.id) AS pages
    FROM page_tags pt
    JOIN pages p ON p.id = pt.page_id
    GROUP BY pt.tag_id, p.type
  `).all();
  const usageByTag = new Map();
  for (const r of usage) usageByTag.set(r.tag_id, Number(r.pages || 0));
  const byTypeMap = new Map(); // tagId -> { type -> count }
  for (const r of byType) {
    let m = byTypeMap.get(r.tag_id);
    if (!m) { m = new Map(); byTypeMap.set(r.tag_id, m); }
    m.set(r.type, Number(r.pages || 0));
  }
  return tags.map(t => ({
    id: t.id,
    key: t.name,
    tag: t.display_name,
    createdAt: t.created_at,
    usedOnPagesCount: Number(usageByTag.get(t.id) || 0),
    byTypeCounts: Object.fromEntries(Array.from(byTypeMap.get(t.id) || new Map()))
  }));
}

function editDistance(a, b) {
  const s = String(a || '').toLowerCase();
  const t = String(b || '').toLowerCase();
  const n = s.length; const m = t.length;
  if (n === 0) return m; if (m === 0) return n;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 0; i <= n; i++) dp[i][0] = i;
  for (let j = 0; j <= m; j++) dp[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }
  return dp[n][m];
}

function pluralBase(s) {
  const w = String(s || '');
  if (/^[a-z]+$/i.test(w)) {
    if (w.toLowerCase().endsWith('s') && w.length > 3) return w.slice(0, -1).toLowerCase();
  }
  return w.toLowerCase();
}

function computeFlags(rows, pageTypes) {
  const tags = rows.map(r => ({ key: r.key, display: r.tag, count: r.usedOnPagesCount }));
  // Precompute groups for near-duplicates
  const groupKeyToMembers = new Map();
  for (const t of tags) {
    const base = pluralBase(t.display);
    let g = groupKeyToMembers.get(base);
    if (!g) { g = []; groupKeyToMembers.set(base, g); }
    g.push(t.display);
  }

  // Prepare quick lookup for potential near duplicates by edit distance
  const allDisplays = tags.map(t => t.display);

  const out = new Map();
  for (const r of rows) {
    const disp = r.tag;
    const key = r.key;
    const usedOnce = r.usedOnPagesCount === 1;
    const duplicatesStructure = pageTypes.has(key);
    let nearDuplicateGroupKey = null;
    let weirdFormat = false;

    // near-duplicates: case/plural/small edit distance
    const base = pluralBase(disp);
    const siblings = groupKeyToMembers.get(base) || [];
    if (siblings.length > 1) nearDuplicateGroupKey = base;
    else {
      // small edit distance if short and alphabetic
      if (/^[a-z-]+$/i.test(disp) && disp.length <= 12) {
        for (const other of allDisplays) {
          if (other === disp) continue;
          if (!/^[a-z-]+$/i.test(other)) continue;
          const maxDist = disp.length <= 5 ? 1 : 2;
          if (editDistance(disp, other) <= maxDist) { nearDuplicateGroupKey = pluralBase(other); break; }
        }
      }
    }

    // weird format: trailing punctuation or repeated separators
    if (/[\.;:!?,]$/.test(disp) || /--+/.test(disp) || /\s{2,}/.test(disp)) weirdFormat = true;

    out.set(r.id, {
      usedOnce,
      duplicatesStructure,
      ...(nearDuplicateGroupKey ? { nearDuplicateGroupKey } : {}),
      weirdFormat,
    });
  }
  return out;
}

export function routeTagInspector(req, res, ctx) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = url;

  // Centralized page types from schema; keep in sync with pages route
  const PAGE_TYPES = new Set(['note', 'npc', 'character', 'location', 'arc', 'tool']);

  // Summary
  if (pathname === '/api/tag-inspector/summary' && req.method === 'GET') {
    // totalTags
    const totalTags = Number(ctx.db.prepare('SELECT COUNT(1) AS c FROM tags').get().c || 0);
    // pages without tags
    const pagesWithoutTagsCount = Number(ctx.db.prepare(`
      SELECT COUNT(1) AS c
      FROM pages p
      LEFT JOIN page_tags pt ON pt.page_id = p.id
      WHERE pt.tag_id IS NULL
    `).get().c || 0);
    // unused tags
    const unusedTagsCount = Number(ctx.db.prepare(`
      SELECT COUNT(1) AS c
      FROM tags t
      LEFT JOIN page_tags pt ON pt.tag_id = t.id
      WHERE pt.page_id IS NULL
    `).get().c || 0);
    // suspicious count = any flag
    const rows = getAllTagsWithUsage(ctx.db);
    const flags = computeFlags(rows, PAGE_TYPES);
    let suspicious = 0;
    for (const r of rows) {
      const f = flags.get(r.id) || {};
      if (f.usedOnce || f.duplicatesStructure || f.nearDuplicateGroupKey || f.weirdFormat) suspicious++;
    }
    sendJson(res, 200, {
      totalTags,
      pagesWithoutTagsCount,
      suspiciousTagsCount: suspicious,
      unusedTagsCount,
    });
    return true;
  }

  // Tags listing
  if (pathname === '/api/tag-inspector/tags' && req.method === 'GET') {
    const rows = getAllTagsWithUsage(ctx.db);
    const flags = computeFlags(rows, PAGE_TYPES);
    const out = rows.map(r => ({
      tag: r.tag,
      key: r.key,
      usedOnPagesCount: r.usedOnPagesCount,
      byTypeCounts: r.byTypeCounts,
      flags: flags.get(r.id) || { usedOnce: false, duplicatesStructure: false, weirdFormat: false },
    }));
    sendJson(res, 200, { tags: out });
    return true;
  }

  // Pages without tags
  if (pathname === '/api/tag-inspector/pages-without-tags' && req.method === 'GET') {
    const rows = ctx.db.prepare(`
      SELECT p.id, p.title, p.type, p.slug
      FROM pages p
      LEFT JOIN page_tags pt ON pt.page_id = p.id
      WHERE pt.tag_id IS NULL
      ORDER BY p.updated_at DESC, p.created_at DESC
    `).all();
    const pages = rows.map(r => ({ id: r.id, title: r.title, type: r.type, slug: r.slug }));
    sendJson(res, 200, { pages });
    return true;
  }

  // Tag detail
  const detailMatch = pathname.match(/^\/api\/tag-inspector\/tag\/(.+)$/);
  if (detailMatch && req.method === 'GET') {
    const { key } = normKey(decodeURIComponent(detailMatch[1]));
    const tag = ctx.db.prepare('SELECT id, name, display_name FROM tags WHERE name = ?').get(key);
    if (!tag) { notFound(res); return true; }
    const usage = ctx.db.prepare(`
      SELECT p.id, p.title, p.type, p.slug
      FROM page_tags pt
      JOIN pages p ON p.id = pt.page_id
      WHERE pt.tag_id = ?
      ORDER BY p.updated_at DESC, p.created_at DESC
    `).all(tag.id);
    const byType = new Map();
    for (const u of usage) {
      byType.set(u.type, (byType.get(u.type) || 0) + 1);
    }
    sendJson(res, 200, {
      tag: tag.display_name,
      key: tag.name,
      usageSummaryByType: Object.fromEntries(byType),
      usedOnPagesCount: usage.length,
      usages: usage.map(u => ({ pageId: u.id, pageTitle: u.title, pageSlug: u.slug, pageType: u.type })),
    });
    return true;
  }

  // Rename
  if (pathname === '/api/tag-inspector/rename' && req.method === 'POST') {
    return (async () => {
      const body = JSON.parse(await readBody(req) || '{}');
      const from = normKey(body.from);
      const to = normKey(body.to);
      if (from.error || to.error) { badRequest(res, 'invalid tag'); return true; }
      const src = ctx.db.prepare('SELECT id, name, display_name FROM tags WHERE name = ?').get(from.key);
      if (!src) { notFound(res); return true; }
      const dst = ctx.db.prepare('SELECT id, name, display_name FROM tags WHERE name = ?').get(to.key);
      if (dst && dst.id === src.id) {
        // Same key; just update display casing if needed
        if (src.display_name !== to.display) ctx.db.prepare('UPDATE tags SET display_name = ? WHERE id = ?').run(to.display, src.id);
        sendJson(res, 200, { updatedPages: 0, updatedOccurrences: 0 });
        return true;
      }
      if (dst) {
        // Merge into existing
        const affected = ctx.db.prepare('SELECT COUNT(DISTINCT page_id) AS c FROM page_tags WHERE tag_id = ?').get(src.id).c || 0;
        const trx = ctx.db.transaction(() => {
          // Move associations
          const rows = ctx.db.prepare('SELECT page_id FROM page_tags WHERE tag_id = ?').all(src.id);
          const ins = ctx.db.prepare('INSERT OR IGNORE INTO page_tags(page_id, tag_id) VALUES (?, ?)');
          for (const r of rows) ins.run(r.page_id, dst.id);
          // Remove old tag (cascade cleans up duplicates)
          ctx.db.prepare('DELETE FROM tags WHERE id = ?').run(src.id);
        });
        trx();
        sendJson(res, 200, { updatedPages: Number(affected), updatedOccurrences: Number(affected) });
        return true;
      }
      // Simple rename (update single row)
      const affected = ctx.db.prepare('SELECT COUNT(DISTINCT page_id) AS c FROM page_tags WHERE tag_id = ?').get(src.id).c || 0;
      ctx.db.prepare('UPDATE tags SET name = ?, display_name = ? WHERE id = ?').run(to.key, to.display, src.id);
      sendJson(res, 200, { updatedPages: Number(affected), updatedOccurrences: Number(affected) });
      return true;
    })();
  }

  // Merge
  if (pathname === '/api/tag-inspector/merge' && req.method === 'POST') {
    return (async () => {
      const body = JSON.parse(await readBody(req) || '{}');
      const from = normKey(body.from);
      const to = normKey(body.to);
      if (from.error || to.error) { badRequest(res, 'invalid tag'); return true; }
      const src = ctx.db.prepare('SELECT id, name, display_name FROM tags WHERE name = ?').get(from.key);
      if (!src) { notFound(res); return true; }
      let dst = ctx.db.prepare('SELECT id, name, display_name FROM tags WHERE name = ?').get(to.key);
      if (!dst) {
        // Create destination by renaming src if empty target does not exist
        const affected = ctx.db.prepare('SELECT COUNT(DISTINCT page_id) AS c FROM page_tags WHERE tag_id = ?').get(src.id).c || 0;
        ctx.db.prepare('UPDATE tags SET name = ?, display_name = ? WHERE id = ?').run(to.key, to.display, src.id);
        sendJson(res, 200, { updatedPages: Number(affected), updatedOccurrences: Number(affected) });
        return true;
      }
      // Merge src -> dst
      const affected = ctx.db.prepare('SELECT COUNT(DISTINCT page_id) AS c FROM page_tags WHERE tag_id = ?').get(src.id).c || 0;
      const trx = ctx.db.transaction(() => {
        const rows = ctx.db.prepare('SELECT page_id FROM page_tags WHERE tag_id = ?').all(src.id);
        const ins = ctx.db.prepare('INSERT OR IGNORE INTO page_tags(page_id, tag_id) VALUES (?, ?)');
        for (const r of rows) ins.run(r.page_id, dst.id);
        ctx.db.prepare('DELETE FROM tags WHERE id = ?').run(src.id);
      });
      trx();
      sendJson(res, 200, { updatedPages: Number(affected), updatedOccurrences: Number(affected) });
      return true;
    })();
  }

  // Delete
  if (pathname === '/api/tag-inspector/delete' && req.method === 'POST') {
    return (async () => {
      const body = JSON.parse(await readBody(req) || '{}');
      const t = normKey(body.tag);
      if (t.error) { badRequest(res, 'invalid tag'); return true; }
      const src = ctx.db.prepare('SELECT id, name FROM tags WHERE name = ?').get(t.key);
      if (!src) { notFound(res); return true; }
      const affected = ctx.db.prepare('SELECT COUNT(DISTINCT page_id) AS c FROM page_tags WHERE tag_id = ?').get(src.id).c || 0;
      ctx.db.prepare('DELETE FROM tags WHERE id = ?').run(src.id);
      sendJson(res, 200, { updatedPages: Number(affected), updatedOccurrences: Number(affected) });
      return true;
    })();
  }

  return false;
}

