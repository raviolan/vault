function normalizeName(input) {
  const raw = String(input == null ? '' : input);
  // Trim and collapse internal whitespace
  const collapsed = raw.trim().replace(/\s+/g, ' ');
  const key = collapsed.toLowerCase();
  const display = collapsed;
  if (!key) return { error: 'empty' };
  if (key.length > 64) return { error: 'too_long' };
  return { key, display };
}

export function ensureTag(db, nameInput) {
  const norm = normalizeName(nameInput);
  if (norm.error) {
    const e = Object.assign(new Error('invalid tag'), { status: 400 });
    throw e;
  }
  const { key, display } = norm;
  const existing = db.prepare('SELECT id, name, display_name FROM tags WHERE name = ?').get(key);
  if (existing) {
    // Update latest casing for display
    if (existing.display_name !== display) {
      db.prepare('UPDATE tags SET display_name = ? WHERE id = ?').run(display, existing.id);
    }
    return { id: existing.id, name: existing.name, display_name: display };
  }
  const info = db.prepare('INSERT INTO tags(name, display_name) VALUES (?, ?)').run(key, display);
  const id = info.lastInsertRowid;
  return { id, name: key, display_name: display };
}

export function listTagsWithCounts(db) {
  const rows = db.prepare(
    `SELECT t.display_name AS display_name, COUNT(pt.page_id) AS cnt
       FROM tags t
  LEFT JOIN page_tags pt ON pt.tag_id = t.id
   GROUP BY t.id, t.display_name, t.name
   ORDER BY t.name ASC`
  ).all();
  return rows.map(r => ({ name: r.display_name, count: Number(r.cnt || 0) }));
}

export function getPageTags(db, pageId) {
  const rows = db.prepare(
    `SELECT t.name AS key, t.display_name AS display
       FROM page_tags pt
       JOIN tags t ON t.id = pt.tag_id
      WHERE pt.page_id = ?
      ORDER BY t.name ASC`
  ).all(pageId);
  return rows.map(r => r.display);
}

export function setPageTags(db, pageId, tagNames) {
  const normalized = Array.isArray(tagNames) ? tagNames.map(normalizeName) : [];
  // Validate and de-dupe by key
  const map = new Map();
  for (const n of normalized) {
    if (n && !n.error) {
      if (!map.has(n.key)) map.set(n.key, n.display);
      else map.set(n.key, n.display); // latest casing wins
    }
  }
  const keys = Array.from(map.keys());

  const trx = db.transaction(() => {
    const tagIds = [];
    for (const key of keys) {
      const display = map.get(key);
      const existing = db.prepare('SELECT id, display_name FROM tags WHERE name = ?').get(key);
      let id;
      if (existing) {
        if (existing.display_name !== display) {
          db.prepare('UPDATE tags SET display_name = ? WHERE id = ?').run(display, existing.id);
        }
        id = existing.id;
      } else {
        const info = db.prepare('INSERT INTO tags(name, display_name) VALUES (?, ?)').run(key, display);
        id = info.lastInsertRowid;
      }
      tagIds.push(id);
    }

    // Replace set: delete anything not in new tagIds
    if (tagIds.length) {
      db.prepare(`DELETE FROM page_tags WHERE page_id = ? AND tag_id NOT IN (${tagIds.map(() => '?').join(',')})`).run(pageId, ...tagIds);
    } else {
      db.prepare('DELETE FROM page_tags WHERE page_id = ?').run(pageId);
    }

    // Insert missing
    const existingPairs = db.prepare('SELECT tag_id FROM page_tags WHERE page_id = ?').all(pageId).map(r => r.tag_id);
    const have = new Set(existingPairs);
    const ins = db.prepare('INSERT OR IGNORE INTO page_tags(page_id, tag_id) VALUES (?, ?)');
    for (const id of tagIds) {
      if (!have.has(id)) ins.run(pageId, id);
    }
  });
  trx();

  // Return display names in stable order by canonical key
  const out = db.prepare(
    `SELECT t.name AS key, t.display_name AS display
       FROM page_tags pt JOIN tags t ON t.id = pt.tag_id
      WHERE pt.page_id = ?
      ORDER BY t.name ASC`
  ).all(pageId);
  return out.map(r => r.display);
}

