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

