function makeSnippetFromJson(jsonStr) {
  try {
    const obj = JSON.parse(String(jsonStr || '{}')) || {};
    let text = String(obj.text || obj.title || '');
    text = text.replace(/\s+/g, ' ').trim();
    if (text.length > 140) text = text.slice(0, 137) + '…';
    return text;
  } catch { return ''; }
}

export function escapeLike(str) {
  return String(str || '').replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
}

export function searchPages(db, q, limit = 30) {
  const qTrim = String(q || '').trim();
  if (!qTrim) return [];
  const like = `%${escapeLike(qTrim)}%`;
  const rows = db.prepare(
    `SELECT p.id, p.title, p.type, p.slug, p.updated_at,
            (
              SELECT b.content_json FROM blocks b
               WHERE b.page_id = p.id AND b.type = 'paragraph' AND b.content_json LIKE ? ESCAPE '\\'
               ORDER BY b.sort, b.created_at LIMIT 1
            ) AS match_snippet_json,
            (
              SELECT b.content_json FROM blocks b
               WHERE b.page_id = p.id AND b.type = 'paragraph'
               ORDER BY b.sort, b.created_at LIMIT 1
            ) AS fallback_snippet_json
       FROM pages p
      WHERE p.title LIKE ? ESCAPE '\\'
         OR EXISTS (
              SELECT 1 FROM blocks b2
               WHERE b2.page_id = p.id AND b2.type = 'paragraph' AND b2.content_json LIKE ? ESCAPE '\\'
            )
      ORDER BY p.updated_at DESC
      LIMIT ?`
  ).all(like, like, like, Number(limit) || 30);
  return rows.map(r => ({
    id: r.id,
    title: r.title,
    type: r.type,
    slug: r.slug,
    updatedAt: new Date(r.updated_at * 1000).toISOString(),
    snippet: makeSnippetFromJson(r.match_snippet_json || r.fallback_snippet_json || '')
  }));
}

// Utility: normalize text for searching/excerpting
function normalizeText(str) {
  return String(str || '');
}

function getBlockText(type, contentJsonStr) {
  try {
    const obj = JSON.parse(String(contentJsonStr || '{}')) || {};
    if (type === 'paragraph' || type === 'heading') return normalizeText(obj.text);
    if (type === 'section') return normalizeText(obj.title);
    return '';
  } catch {
    return '';
  }
}

function buildExcerpt(text, termLower, matchIdx, termLen) {
  const raw = String(text || '');
  const start = Math.max(0, matchIdx - 60);
  const end = Math.min(raw.length, matchIdx + termLen + 80);
  let slice = raw.slice(start, end);
  slice = slice.replace(/\s+/g, ' ').trim();
  const lead = start > 0 ? '…' : '';
  const trail = end < raw.length ? '…' : '';
  return `${lead}${slice}${trail}`;
}

function computeSectionPath(blockId, blocksById, maxDepth = 20) {
  const out = [];
  let curId = blockId;
  let depth = 0;
  const seen = new Set();
  while (curId && depth < maxDepth) {
    if (seen.has(curId)) break;
    seen.add(curId);
    const b = blocksById.get(curId);
    if (!b) break;
    const parentId = b.parent_id;
    if (parentId) {
      const parent = blocksById.get(parentId);
      if (parent && parent.type === 'section') {
        const title = getBlockText('section', parent.content_json);
        if (title) out.unshift(title);
      }
    }
    curId = parentId;
    depth++;
  }
  return out;
}

// Detailed search including per-page matches and locations.
export function searchPagesWithMatches(db, q, limit = 30, perPageMatchLimit = 3) {
  const base = searchPages(db, q, limit);
  const qTrim = String(q || '').trim();
  if (!qTrim) return [];
  const termLower = qTrim.toLowerCase();
  const pageIds = base.map(r => r.id);
  if (!pageIds.length) return [];

  // Load all blocks for candidate pages
  const placeholders = pageIds.map(() => '?').join(',');
  const blockRows = db.prepare(
    `SELECT id, page_id, parent_id, sort, type, content_json
       FROM blocks
      WHERE page_id IN (${placeholders})
      ORDER BY page_id, parent_id IS NOT NULL, parent_id, sort, created_at`
  ).all(...pageIds);

  // Group blocks by page and map by id
  const blocksByPage = new Map();
  const blocksById = new Map();
  for (const b of blockRows) {
    if (!blocksByPage.has(b.page_id)) blocksByPage.set(b.page_id, []);
    blocksByPage.get(b.page_id).push(b);
    blocksById.set(b.id, b);
  }

  const out = [];
  for (const page of base) {
    const blocks = blocksByPage.get(page.id) || [];
    const matches = [];
    let matchCount = 0;

    // Title match
    const titleLower = String(page.title || '').toLowerCase();
    const tIdx = titleLower.indexOf(termLower);
    if (tIdx >= 0) {
      matchCount += 1;
      if (matches.length < perPageMatchLimit) {
        matches.push({
          blockId: null,
          blockType: 'title',
          sectionPath: [],
          excerpt: buildExcerpt(page.title || '', termLower, tIdx, termLower.length),
        });
      }
    }

    // Block matches across paragraph/heading/section title
    for (const b of blocks) {
      if (!['paragraph', 'heading', 'section'].includes(b.type)) continue;
      const text = getBlockText(b.type, b.content_json);
      if (!text) continue;
      const lower = text.toLowerCase();
      let from = 0;
      let foundInThisBlock = 0;
      while (true) {
        const idx = lower.indexOf(termLower, from);
        if (idx < 0) break;
        matchCount += 1;
        foundInThisBlock += 1;
        if (matches.length < perPageMatchLimit) {
          matches.push({
            blockId: b.id,
            blockType: b.type,
            sectionPath: computeSectionPath(b.id, blocksById),
            excerpt: buildExcerpt(text, termLower, idx, termLower.length),
          });
        }
        from = idx + termLower.length;
        if (foundInThisBlock > 32) break; // safety
      }
      if (matches.length >= perPageMatchLimit) {
        // keep counting other blocks to compute matchCount, but can early continue
        continue;
      }
    }

    out.push({ ...page, matchCount, matches });
  }

  return out;
}
