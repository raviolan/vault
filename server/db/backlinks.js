export function getBacklinks(db, pageId) {
  const page = db.prepare('SELECT id, title, updated_at FROM pages WHERE id = ?').get(pageId);
  if (!page) return null;
  const title = String(page.title || '');
  const token = `[[${title}]]`;
  const escapeLike = (s) => String(s).replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
  const likeTitle = `%${escapeLike(token)}%`;
  const likeIdPrefix = `%${escapeLike(`[[page:${pageId}`)}%`;
  const titleLen = token.length || 1;
  const idPrefix = `[[page:${pageId}`;
  const idLen = idPrefix.length || 1;
  const rows = db.prepare(
    `SELECT p.id AS id, p.title AS title, p.type AS type,
            SUM((LENGTH(b.content_json) - LENGTH(REPLACE(b.content_json, ?, ''))) / ?) +
            SUM((LENGTH(b.content_json) - LENGTH(REPLACE(b.content_json, ?, ''))) / ?) AS count
       FROM pages p
       JOIN blocks b ON b.page_id = p.id
      WHERE p.id != ?
        AND b.type = 'paragraph'
        AND (b.content_json LIKE ? ESCAPE '\\' OR b.content_json LIKE ? ESCAPE '\\')
      GROUP BY p.id, p.title, p.type
      ORDER BY count DESC, p.updated_at DESC`
  ).all(token, titleLen, idPrefix, idLen, pageId, likeTitle, likeIdPrefix);
  return rows.map(r => ({ id: r.id, title: r.title, type: r.type, count: Math.max(1, Math.round(Number(r.count || 0))) }));
}

