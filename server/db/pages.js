import { randomUUID } from 'node:crypto';
import { ensureUniqueSlug, slugifyTitle } from './slugs.js';
import { getPageMedia as dbGetPageMedia } from './pageMedia.js';

function mapPageRow(r) {
  return {
    id: r.id,
    title: r.title,
    type: r.type,
    slug: r.slug,
    archivedAt: r.archived_at ? new Date(r.archived_at * 1000).toISOString() : null,
    archiveReason: r.archive_reason || '',
    createdAt: new Date(r.created_at * 1000).toISOString(),
    updatedAt: new Date(r.updated_at * 1000).toISOString(),
  };
}

function archiveWhereClause(mode) {
  if (mode === 'only') return 'WHERE p.archived_at IS NOT NULL';
  if (mode === 'include') return '';
  return 'WHERE p.archived_at IS NULL';
}

export function listPages(db, { archived = 'exclude' } = {}) {
  const rows = db.prepare(
    `SELECT p.id, p.title, p.type, p.slug, p.archived_at, p.archive_reason, p.created_at, p.updated_at
       FROM pages p
       ${archiveWhereClause(archived)}
      ORDER BY p.updated_at DESC, p.created_at DESC`
  ).all();
  return rows.map(mapPageRow);
}

export function createPage(db, { title, type = 'note' }) {
  const id = randomUUID();
  const ts = Math.floor(Date.now() / 1000);
  const base = slugifyTitle(title || '');
  const slug = ensureUniqueSlug(db, base);
  db.prepare('INSERT INTO pages(id, title, type, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, title, type, slug, ts, ts);
  return {
    id,
    title,
    type,
    slug,
    archivedAt: null,
    archiveReason: '',
    createdAt: new Date(ts * 1000).toISOString(),
    updatedAt: new Date(ts * 1000).toISOString(),
  };
}

function buildDuplicateTitle(db, title) {
  const base = `${String(title || '').trim() || 'Untitled'} Copy`;
  let candidate = base;
  let suffix = 2;
  while (db.prepare('SELECT 1 FROM pages WHERE title = ?').get(candidate)) {
    candidate = `${base} ${suffix}`;
    suffix += 1;
  }
  return candidate;
}

export function getPageWithBlocks(db, id) {
  const page = db.prepare('SELECT id, title, type, slug, archived_at, archive_reason, created_at, updated_at FROM pages WHERE id = ?').get(id);
  if (!page) return null;
  const blocks = db.prepare('SELECT id, page_id, parent_id, sort, type, props_json, content_json, created_at, updated_at FROM blocks WHERE page_id = ? ORDER BY parent_id IS NOT NULL, parent_id, sort, created_at').all(id);
  const media = (() => {
    try {
      const m = dbGetPageMedia(db, id);
      const map = (slot) => slot ? ({ url: `/media/${slot.path}`, posX: slot.posX, posY: slot.posY, zoom: Number(slot.zoom ?? 1) }) : null;
      return m ? { header: map(m.header), profile: map(m.profile) } : { header: null, profile: null };
    } catch { return { header: null, profile: null }; }
  })();
  return {
    ...mapPageRow(page),
    media,
    blocks: blocks.map(b => ({
      id: b.id,
      pageId: b.page_id,
      parentId: b.parent_id,
      sort: b.sort,
      type: b.type,
      propsJson: b.props_json,
      contentJson: b.content_json,
      createdAt: new Date(b.created_at * 1000).toISOString(),
      updatedAt: new Date(b.updated_at * 1000).toISOString(),
    })),
  };
}

export function getPageWithBlocksBySlug(db, slug) {
  const row = db.prepare('SELECT id FROM pages WHERE slug = ?').get(slug);
  if (!row) return null;
  return getPageWithBlocks(db, row.id);
}

export function patchPage(db, pageId, { title, type, regenerateSlug = false, archivedAt, archiveReason } = {}) {
  const cur = db.prepare('SELECT * FROM pages WHERE id = ?').get(pageId);
  if (!cur) return null;
  const nextTitle = (title === undefined ? cur.title : String(title));
  const nextType = (type === undefined ? cur.type : String(type));
  const nextArchivedAt = archivedAt === undefined
    ? cur.archived_at
    : (archivedAt ? Math.floor(new Date(archivedAt).getTime() / 1000) : null);
  const nextArchiveReason = archiveReason === undefined
    ? (cur.archive_reason || '')
    : String(archiveReason || '');
  let nextSlug = cur.slug;
  if (regenerateSlug) {
    nextSlug = ensureUniqueSlug(db, slugifyTitle(nextTitle || ''));
  }
  const ts = Math.floor(Date.now() / 1000);
  const trx = db.transaction(() => {
    db.prepare('UPDATE pages SET title = ?, type = ?, slug = ?, archived_at = ?, archive_reason = ?, updated_at = ? WHERE id = ?')
      .run(nextTitle, nextType, nextSlug, nextArchivedAt, nextArchiveReason, ts, pageId);
  });
  trx();
  return getPageWithBlocks(db, pageId);
}

export function deletePage(db, id) {
  db.prepare('DELETE FROM pages WHERE id = ?').run(id);
}

export function duplicatePage(db, id) {
  const source = db.prepare('SELECT * FROM pages WHERE id = ?').get(id);
  if (!source) return null;

  const nextId = randomUUID();
  const ts = Math.floor(Date.now() / 1000);
  const nextTitle = buildDuplicateTitle(db, source.title);
  const nextSlug = ensureUniqueSlug(db, slugifyTitle(nextTitle));
  const sourceBlocks = db.prepare(
    `SELECT id, parent_id, sort, type, props_json, content_json
       FROM blocks
      WHERE page_id = ?
      ORDER BY parent_id IS NOT NULL, parent_id, sort, created_at`
  ).all(id);
  const sourceSheet = db.prepare('SELECT sheet_json FROM page_sheets WHERE page_id = ?').get(id);
  const sourceTags = db.prepare('SELECT tag_id FROM page_tags WHERE page_id = ? ORDER BY tag_id').all(id);
  const sourceMedia = db.prepare('SELECT * FROM page_media WHERE page_id = ?').get(id);
  const blockIds = new Map(sourceBlocks.map((block) => [block.id, randomUUID()]));

  const trx = db.transaction(() => {
    db.prepare(
      `INSERT INTO pages(id, title, type, slug, archived_at, archive_reason, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, '', ?, ?)`
    ).run(nextId, nextTitle, source.type, nextSlug, ts, ts);

    if (sourceBlocks.length) {
      const insertBlock = db.prepare(
        `INSERT INTO blocks(id, page_id, parent_id, sort, type, props_json, content_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const block of sourceBlocks) {
        insertBlock.run(
          blockIds.get(block.id),
          nextId,
          block.parent_id ? blockIds.get(block.parent_id) || null : null,
          block.sort,
          block.type,
          block.props_json,
          block.content_json,
          ts,
          ts,
        );
      }
    }

    if (sourceSheet?.sheet_json) {
      db.prepare('INSERT INTO page_sheets(page_id, sheet_json, updated_at) VALUES (?, ?, ?)')
        .run(nextId, sourceSheet.sheet_json, ts);
    }

    if (sourceTags.length) {
      const insertTag = db.prepare('INSERT INTO page_tags(page_id, tag_id) VALUES (?, ?)');
      for (const row of sourceTags) insertTag.run(nextId, row.tag_id);
    }

    if (sourceMedia) {
      db.prepare(
        `INSERT INTO page_media(
           page_id, header_path, header_pos_x, header_pos_y, header_zoom,
           profile_path, profile_pos_x, profile_pos_y, profile_zoom, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        nextId,
        sourceMedia.header_path,
        sourceMedia.header_pos_x,
        sourceMedia.header_pos_y,
        sourceMedia.header_zoom,
        sourceMedia.profile_path,
        sourceMedia.profile_pos_x,
        sourceMedia.profile_pos_y,
        sourceMedia.profile_zoom,
        ts,
      );
    }
  });

  trx();
  return getPageWithBlocks(db, nextId);
}
