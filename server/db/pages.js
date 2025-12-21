import { randomUUID } from 'node:crypto';
import { ensureUniqueSlug, slugifyTitle } from './slugs.js';

export function listPages(db) {
  const rows = db.prepare('SELECT id, title, type, slug, created_at, updated_at FROM pages ORDER BY updated_at DESC, created_at DESC').all();
  return rows.map(r => ({
    id: r.id,
    title: r.title,
    type: r.type,
    slug: r.slug,
    createdAt: new Date(r.created_at * 1000).toISOString(),
    updatedAt: new Date(r.updated_at * 1000).toISOString(),
  }));
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
    createdAt: new Date(ts * 1000).toISOString(),
    updatedAt: new Date(ts * 1000).toISOString(),
  };
}

export function getPageWithBlocks(db, id) {
  const page = db.prepare('SELECT id, title, type, slug, created_at, updated_at FROM pages WHERE id = ?').get(id);
  if (!page) return null;
  const blocks = db.prepare('SELECT id, page_id, parent_id, sort, type, props_json, content_json, created_at, updated_at FROM blocks WHERE page_id = ? ORDER BY parent_id IS NOT NULL, parent_id, sort, created_at').all(id);
  return {
    id: page.id,
    title: page.title,
    type: page.type,
    slug: page.slug,
    createdAt: new Date(page.created_at * 1000).toISOString(),
    updatedAt: new Date(page.updated_at * 1000).toISOString(),
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

export function patchPage(db, pageId, { title, type, regenerateSlug = false } = {}) {
  const cur = db.prepare('SELECT * FROM pages WHERE id = ?').get(pageId);
  if (!cur) return null;
  const nextTitle = (title === undefined ? cur.title : String(title));
  const nextType = (type === undefined ? cur.type : String(type));
  let nextSlug = cur.slug;
  if (regenerateSlug) {
    nextSlug = ensureUniqueSlug(db, slugifyTitle(nextTitle || ''));
  }
  const ts = Math.floor(Date.now() / 1000);
  const trx = db.transaction(() => {
    db.prepare('UPDATE pages SET title = ?, type = ?, slug = ?, updated_at = ? WHERE id = ?')
      .run(nextTitle, nextType, nextSlug, ts, pageId);
  });
  trx();
  return getPageWithBlocks(db, pageId);
}

export function deletePage(db, id) {
  db.prepare('DELETE FROM pages WHERE id = ?').run(id);
}

