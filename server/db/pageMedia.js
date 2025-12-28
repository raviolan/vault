export function getPageMedia(db, pageId) {
  const row = db.prepare('SELECT * FROM page_media WHERE page_id = ?').get(pageId);
  if (!row) return null;
  const toSlot = (path, x, y, zoom) => {
    if (!path) return null;
    return { path, posX: Number(x ?? 50), posY: Number(y ?? 50), zoom: Number(zoom ?? 1) };
  };
  return {
    header: toSlot(row.header_path, row.header_pos_x, row.header_pos_y, row.header_zoom),
    profile: toSlot(row.profile_path, row.profile_pos_x, row.profile_pos_y, row.profile_zoom),
  };
}

export function setPageMedia(db, pageId, patch) {
  const now = Math.floor(Date.now() / 1000);
  const cur = db.prepare('SELECT * FROM page_media WHERE page_id = ?').get(pageId);
  const next = { ...cur };
  if (!cur) {
    // Create a row with defaults; then patch below
    db.prepare('INSERT INTO page_media(page_id, header_path, header_pos_x, header_pos_y, header_zoom, profile_path, profile_pos_x, profile_pos_y, profile_zoom, updated_at) VALUES (?, NULL, 50, 50, 1, NULL, 50, 50, 1, ?)')
      .run(pageId, now);
  }
  // Apply patch to DB: supports header/path/pos, profile/path/pos
  const fields = [];
  const values = [];
  if (patch.header) {
    if (patch.header.path !== undefined) { fields.push('header_path = ?'); values.push(patch.header.path); }
    if (patch.header.posX !== undefined) { fields.push('header_pos_x = ?'); values.push(Number(patch.header.posX)); }
    if (patch.header.posY !== undefined) { fields.push('header_pos_y = ?'); values.push(Number(patch.header.posY)); }
    if (patch.header.zoom !== undefined) { fields.push('header_zoom = ?'); values.push(Number(patch.header.zoom)); }
  }
  if (patch.profile) {
    if (patch.profile.path !== undefined) { fields.push('profile_path = ?'); values.push(patch.profile.path); }
    if (patch.profile.posX !== undefined) { fields.push('profile_pos_x = ?'); values.push(Number(patch.profile.posX)); }
    if (patch.profile.posY !== undefined) { fields.push('profile_pos_y = ?'); values.push(Number(patch.profile.posY)); }
    if (patch.profile.zoom !== undefined) { fields.push('profile_zoom = ?'); values.push(Number(patch.profile.zoom)); }
  }
  fields.push('updated_at = ?'); values.push(now);
  const sql = `UPDATE page_media SET ${fields.join(', ')} WHERE page_id = ?`;
  db.prepare(sql).run(...values, pageId);
  return getPageMedia(db, pageId);
}

export function clearPageMediaSlot(db, pageId, slot) {
  const now = Math.floor(Date.now() / 1000);
  if (slot === 'header') {
    db.prepare('INSERT INTO page_media(page_id, updated_at) VALUES(?, ?) ON CONFLICT(page_id) DO UPDATE SET header_path = NULL, header_zoom = 1, updated_at = excluded.updated_at')
      .run(pageId, now);
  } else if (slot === 'profile') {
    db.prepare('INSERT INTO page_media(page_id, updated_at) VALUES(?, ?) ON CONFLICT(page_id) DO UPDATE SET profile_path = NULL, profile_zoom = 1, updated_at = excluded.updated_at')
      .run(pageId, now);
  }
  return getPageMedia(db, pageId);
}
