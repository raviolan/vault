function escapeLike(s) {
  return String(s).replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
}

function getBlockText(type, contentJsonStr) {
  try {
    const obj = JSON.parse(String(contentJsonStr || '{}')) || {};
    if (type === 'paragraph' || type === 'heading') return String(obj.text || '');
    if (type === 'section') return String(obj.title || '');
    return '';
  } catch {
    return '';
  }
}

function buildExcerpt(text, matchIdx, termLen) {
  const raw = String(text || '');
  const start = Math.max(0, matchIdx - 60);
  const end = Math.min(raw.length, matchIdx + termLen + 80);
  let slice = raw.slice(start, end);
  slice = slice.replace(/\[\[page:[^\]|\]]+\|([^\]]+)\]\]/gi, '$1');
  slice = slice.replace(/\[\[page:[^\]]+\]\]/gi, '');
  slice = slice.replace(/\[\[([^\]]+)\]\]/g, '$1');
  slice = slice.replace(/[0-9a-f-]{12,}\|([^\]]+)\]\]/gi, '$1');
  slice = slice.replace(/[0-9a-f-]{12,}\|([^|\]]+)/gi, '$1');
  slice = slice.replace(/\[\[page:[^\]|\]]+\|/gi, '');
  slice = slice.replace(/\]\]/g, '');
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
    const block = blocksById.get(curId);
    if (!block) break;
    const parentId = block.parent_id;
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

function countOccurrences(text, token) {
  const raw = String(text || '');
  const needle = String(token || '');
  if (!raw || !needle) return [];
  const out = [];
  let from = 0;
  while (true) {
    const idx = raw.indexOf(needle, from);
    if (idx < 0) break;
    out.push({ index: idx, length: needle.length });
    from = idx + needle.length;
  }
  return out;
}

function countIdLinkOccurrences(text, pageId) {
  const raw = String(text || '');
  if (!raw || !pageId) return [];
  const esc = String(pageId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\[\\[page:${esc}(?:\\|[^\\]]*)?\\]\\]`, 'gi');
  const out = [];
  let m;
  while ((m = re.exec(raw)) !== null) {
    const token = String(m[0] || '');
    out.push({ index: m.index, length: token.length });
    if (!token.length) re.lastIndex += 1;
  }
  return out;
}

export function getBacklinks(db, pageId, { perPageMatchLimit = 3 } = {}) {
  const page = db.prepare('SELECT id, title FROM pages WHERE id = ?').get(pageId);
  if (!page) return null;
  const title = String(page.title || '');
  const titleToken = `[[${title}]]`;
  const likeTitle = `%${escapeLike(titleToken)}%`;
  const likeIdPrefix = `%${escapeLike(`[[page:${pageId}`)}%`;

  const pages = db.prepare(
    `SELECT DISTINCT p.id, p.title, p.type, p.slug, p.updated_at
       FROM pages p
       JOIN blocks b ON b.page_id = p.id
      WHERE p.id != ?
        AND b.type IN ('paragraph', 'heading', 'section')
        AND (b.content_json LIKE ? ESCAPE '\\' OR b.content_json LIKE ? ESCAPE '\\')
      ORDER BY p.updated_at DESC`
  ).all(pageId, likeTitle, likeIdPrefix);
  if (!pages.length) return [];

  const pageIds = pages.map(p => p.id);
  const placeholders = pageIds.map(() => '?').join(',');
  const blockRows = db.prepare(
    `SELECT id, page_id, parent_id, sort, type, content_json
       FROM blocks
      WHERE page_id IN (${placeholders})
      ORDER BY page_id, parent_id IS NOT NULL, parent_id, sort, created_at, id`
  ).all(...pageIds);

  const blocksByPage = new Map();
  const blocksById = new Map();
  for (const row of blockRows) {
    if (!blocksByPage.has(row.page_id)) blocksByPage.set(row.page_id, []);
    blocksByPage.get(row.page_id).push(row);
    blocksById.set(row.id, row);
  }

  const out = [];
  for (const source of pages) {
    const blocks = blocksByPage.get(source.id) || [];
    const matches = [];
    let count = 0;

    for (const block of blocks) {
      if (!['paragraph', 'heading', 'section'].includes(block.type)) continue;
      const text = getBlockText(block.type, block.content_json);
      if (!text) continue;
      const occurrences = [
        ...countOccurrences(text, titleToken),
        ...countIdLinkOccurrences(text, pageId),
      ].sort((a, b) => a.index - b.index);
      if (!occurrences.length) continue;

      for (const occurrence of occurrences) {
        count += 1;
        if (matches.length < perPageMatchLimit) {
          matches.push({
            blockId: block.id,
            blockType: block.type,
            sectionPath: computeSectionPath(block.id, blocksById),
            excerpt: buildExcerpt(text, occurrence.index, occurrence.length),
          });
        }
      }
    }

    if (!count) continue;
    out.push({
      id: source.id,
      title: source.title,
      type: source.type,
      slug: source.slug,
      updatedAt: new Date(source.updated_at * 1000).toISOString(),
      count,
      matches,
    });
  }

  return out.sort((a, b) => b.count - a.count || String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}
