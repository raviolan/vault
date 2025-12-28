// Page Snapshots helper
// Efficiently fetch lightweight page summaries and first-context excerpts

function uniqValidIds(ids) {
  const out = [];
  const seen = new Set();
  for (const v of Array.isArray(ids) ? ids : []) {
    const s = String(v || '').trim();
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function normalizeExcerpt(s, limit = 160) {
  const clean = String(s || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  if (clean.length <= limit) return clean;
  return clean.slice(0, limit - 1).trimEnd() + '…';
}

// Clean up raw text for use as an excerpt
function cleanupText(t) {
  let s = String(t || '');
  // Strip leading list markers
  s = s.replace(/^\s*(?:[-•]\s+)/, '');
  // Replace wikilinks [[page:...|Label]] -> Label; [[page:...]] -> ''
  s = s.replace(/\[\[page:[^\]|\]]+\|([^\]]+)\]\]/gi, '$1');
  s = s.replace(/\[\[page:[^\]]+\]\]/gi, '');
  return s;
}

function isJunkText(t) {
  const raw = String(t || '').trim();
  if (!raw) return true;
  if (raw.startsWith('#')) return true; // tags like #pc
  const s = raw.toLowerCase();
  if (s === 'hello world') return true;
  if (s.startsWith('lorem ipsum')) return true;
  return false;
}

function firstContextForPage(blocksByParent, topList) {
  // Scan top-level blocks in order until we find a section/paragraph/heading
  const top = Array.isArray(topList) ? topList : [];
  let contextTitle = undefined;
  let contextText = '';

  // Helper: pre-order walk to find first paragraph/heading text
  const findDescendantText = (node) => {
    if (!node) return '';
    if (node.type === 'paragraph' || node.type === 'heading') {
      try {
        const cj = JSON.parse(node.content_json || '{}');
        const t = cj?.text || '';
        const cleaned = cleanupText(t);
        if (cleaned && !isJunkText(cleaned)) return String(cleaned);
      } catch {}
    }
    const kids = blocksByParent.get(node.id) || [];
    for (const k of kids) {
      const res = findDescendantText(k);
      if (res) return res;
    }
    return '';
  };

  // Pass 1: prefer specific top-level sections by name
  const preferred = ['overview', 'summary', 'at a glance', 'description', 'bio', 'background'];
  let preferredSection = null;
  for (const b of top) {
    if (b.type !== 'section') continue;
    try {
      const cj = JSON.parse(b.content_json || '{}');
      const t = String(cj?.title || '').trim();
      if (!t) continue;
      const lower = t.toLowerCase();
      if (preferred.includes(lower)) { preferredSection = { node: b, title: t }; break; }
    } catch {}
  }

  if (preferredSection) {
    contextTitle = preferredSection.title;
    const firstText = findDescendantText(preferredSection.node);
    contextText = firstText || contextTitle || '';
    return { contextTitle, contextText: normalizeExcerpt(contextText) };
  }

  // Pass 2: fallback to first top-level section/paragraph/heading, skipping junk
  for (const b of top) {
    if (b.type === 'section') {
      try {
        const cj = JSON.parse(b.content_json || '{}');
        const t = String(cj?.title || '').trim();
        if (t) contextTitle = t;
      } catch {}
      const firstText = findDescendantText(b);
      if (firstText || contextTitle) { contextText = firstText || contextTitle || ''; break; }
    } else if (b.type === 'paragraph' || b.type === 'heading') {
      try {
        const cj = JSON.parse(b.content_json || '{}');
        const t = cleanupText(cj?.text || '');
        if (t && !isJunkText(t)) { contextText = String(t); break; }
      } catch {}
    } else {
      // continue scanning
    }
  }

  return { contextTitle, contextText: normalizeExcerpt(contextText) };
}

export function getPageSnapshots(db, ids) {
  const inputIds = Array.isArray(ids) ? ids : [];
  const wanted = uniqValidIds(inputIds);
  if (!wanted.length) return inputIds.map(id => ({ id, missing: true }));

  // Fetch pages
  const placeholders = wanted.map(() => '?').join(',');
  const pages = db.prepare(`SELECT id, title, type, slug, created_at, updated_at FROM pages WHERE id IN (${placeholders})`).all(...wanted);
  const pageById = new Map(pages.map(p => [p.id, p]));

  // Fetch blocks for those pages
  const blocks = db.prepare(`
    SELECT id, page_id, parent_id, sort, type, props_json, content_json, created_at
    FROM blocks
    WHERE page_id IN (${placeholders})
    ORDER BY page_id, parent_id IS NOT NULL, parent_id, sort, created_at, id
  `).all(...wanted);

  // Fetch media for those pages
  const mediaRows = db.prepare(`
    SELECT page_id, header_path, profile_path
    FROM page_media
    WHERE page_id IN (${placeholders})
  `).all(...wanted);
  const mediaByPage = new Map(mediaRows.map(m => [m.page_id, m]));

  // Build parent -> children lists per page
  const childrenByPage = new Map(); // pageId -> Map(parentId -> children[])
  for (const b of blocks) {
    let map = childrenByPage.get(b.page_id);
    if (!map) { map = new Map(); childrenByPage.set(b.page_id, map); }
    const key = b.parent_id === null ? null : b.parent_id;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(b);
  }

  // Build snapshots keyed by id
  const snaps = new Map();
  for (const p of pages) {
    const childrenMap = childrenByPage.get(p.id) || new Map();
    const top = childrenMap.get(null) || [];
    const { contextTitle, contextText } = firstContextForPage(childrenMap, top);
    const m = mediaByPage.get(p.id) || {};
    const profileUrl = m.profile_path ? `/media/${m.profile_path}` : null;
    const headerUrl = m.header_path ? `/media/${m.header_path}` : null;
    const thumbUrl = profileUrl || headerUrl || null;
    snaps.set(p.id, {
      id: p.id,
      title: p.title,
      type: p.type,
      slug: p.slug,
      updatedAt: new Date(p.updated_at * 1000).toISOString(),
      ...(contextTitle ? { contextTitle } : {}),
      ...(contextText ? { contextText } : {}),
      ...(thumbUrl ? { thumbUrl } : {}),
      ...(profileUrl ? { profileUrl } : {}),
      ...(headerUrl ? { headerUrl } : {}),
    });
  }

  // Return in the same order as input ids; include placeholders for missing
  const out = [];
  for (const id of inputIds) {
    const s = snaps.get(id);
    if (s) out.push(s);
    else out.push({ id, missing: true });
  }
  return out;
}
