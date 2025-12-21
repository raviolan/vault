import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';

// Resolve canonical data root as in server/index.js
function getDataRoot() {
  const env = process.env.DATA_DIR;
  if (env) return path.resolve(env);
  const dockerPath = '/data';
  try { if (fs.existsSync(dockerPath)) return dockerPath; } catch {}
  return path.resolve(process.cwd(), 'data');
}

const DATA_DIR = getDataRoot();
const VAULT_DIR = path.join(DATA_DIR, 'vault');
const DB_PATH = path.join(VAULT_DIR, 'vault.sqlite');

function ensureDir() {
  fs.mkdirSync(VAULT_DIR, { recursive: true });
}

function readMigrationsDir() {
  const dir = path.join(path.dirname(new URL(import.meta.url).pathname), 'migrations');
  // On Windows file URL path may start with / drive letter, but we assume POSIX here
  return dir;
}

export function openDb() {
  ensureDir();
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

function cleanMigrationSql(sql, filename) {
  // Remove explicit transaction statements to avoid nested transactions
  // We only strip lines that are exactly BEGIN TRANSACTION[;] or COMMIT[;] (case-insensitive)
  const lines = sql.split(/\r?\n/);
  let stripped = false;
  const cleaned = lines.filter((line) => {
    const trimmed = line.trim();
    // Keep SQL comments as-is
    if (trimmed.startsWith('--')) return true;
    const noSemi = trimmed.replace(/;\s*$/, '');
    if (/^BEGIN\s+TRANSACTION$/i.test(noSemi)) { stripped = true; return false; }
    if (/^COMMIT$/i.test(noSemi)) { stripped = true; return false; }
    return true;
  }).join('\n');
  if (stripped) {
    console.warn(`Stripped explicit transaction statements from migration ${filename}. Migrations must not include BEGIN/COMMIT.`);
  }
  return cleaned.trim();
}

export function migrate(db) {
  const migDir = readMigrationsDir();
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, filename TEXT NOT NULL UNIQUE, applied_at INTEGER NOT NULL);`);

  const applied = new Set(db.prepare('SELECT filename FROM schema_migrations ORDER BY id').all().map(r => r.filename));
  const files = fs.readdirSync(migDir).filter(f => /\d+_.+\.sql$/.test(f)).sort();
  const nowTs = () => Math.floor(Date.now() / 1000);

  for (const f of files) {
    if (applied.has(f)) continue;
    const rawSql = fs.readFileSync(path.join(migDir, f), 'utf8');
    const sql = cleanMigrationSql(rawSql, f);
    const trx = db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations(filename, applied_at) VALUES (?, ?)').run(f, nowTs());
    });
    trx();
  }
}

// ---- Slug helpers ----
export function slugifyTitle(title) {
  let s = String(title || '');
  s = s.replaceAll('Å', 'A').replaceAll('Ä', 'A').replaceAll('Ö', 'O')
       .replaceAll('å', 'a').replaceAll('ä', 'a').replaceAll('ö', 'o');
  s = s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  s = s.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  s = s.replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!s) s = 'page';
  return s;
}

export function ensureUniqueSlug(db, baseSlug) {
  let base = baseSlug || 'page';
  const exists = (x) => !!db.prepare('SELECT 1 FROM pages WHERE slug = ? LIMIT 1').get(x);
  if (!exists(base)) return base;
  let i = 2;
  while (i < 100000) {
    const cand = `${base}-${i}`;
    if (!exists(cand)) return cand;
    i++;
  }
  return `${base}-${randomUUID().slice(0,8)}`;
}

export function backfillSlugs(db) {
  const need = db.prepare('SELECT id, title FROM pages WHERE slug IS NULL OR slug = ""').all();
  if (!need.length) return;
  const upd = db.prepare('UPDATE pages SET slug = ?, updated_at = ? WHERE id = ?');
  const ts = Math.floor(Date.now() / 1000);
  const trx = db.transaction(() => {
    for (const r of need) {
      const unique = ensureUniqueSlug(db, slugifyTitle(r.title || ''));
      upd.run(unique, ts, r.id);
    }
  });
  trx();
}

// Data access helpers
export function escapeLike(str) {
  return String(str || '').replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
}

function makeSnippetFromJson(jsonStr) {
  try {
    const obj = JSON.parse(String(jsonStr || '{}')) || {};
    let text = String(obj.text || obj.title || '');
    text = text.replace(/\s+/g, ' ').trim();
    if (text.length > 140) text = text.slice(0, 137) + '…';
    return text;
  } catch { return ''; }
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

export function getBacklinks(db, pageId) {
  const page = db.prepare('SELECT id, title, updated_at FROM pages WHERE id = ?').get(pageId);
  if (!page) return null;
  const title = String(page.title || '');
  const token = `[[${title}]]`;
  // Escape for LIKE
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

// ---- Blocks CRUD + reorder ----
function nowTs() { return Math.floor(Date.now() / 1000); }

function touchPage(db, pageId) {
  const ts = nowTs();
  db.prepare('UPDATE pages SET updated_at = ? WHERE id = ?').run(ts, pageId);
}

export function normalizeSiblingSort(db, pageId, parentId) {
  const trx = db.transaction(() => {
    const rows = db.prepare('SELECT id FROM blocks WHERE page_id = ? AND parent_id IS ? ORDER BY sort, created_at, id').all(pageId, parentId);
    const upd = db.prepare('UPDATE blocks SET sort = ? WHERE id = ?');
    let i = 0;
    for (const r of rows) {
      upd.run(i++, r.id);
    }
    touchPage(db, pageId);
  });
  trx();
}

export function createBlock(db, { pageId, parentId = null, sort = 0, type, props = {}, content = {} }) {
  const id = randomUUID();
  const ts = nowTs();
  const insert = db.prepare('INSERT INTO blocks(id, page_id, parent_id, sort, type, props_json, content_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const trx = db.transaction(() => {
    insert.run(id, pageId, parentId, sort, String(type), JSON.stringify(props || {}), JSON.stringify(content || {}), ts, ts);
    normalizeSiblingSort(db, pageId, parentId ?? null);
    touchPage(db, pageId);
  });
  trx();
  const row = db.prepare('SELECT id, page_id, parent_id, sort, type, props_json, content_json, created_at, updated_at FROM blocks WHERE id = ?').get(id);
  return {
    id: row.id,
    pageId: row.page_id,
    parentId: row.parent_id,
    sort: row.sort,
    type: row.type,
    propsJson: row.props_json,
    contentJson: row.content_json,
    createdAt: new Date(row.created_at * 1000).toISOString(),
    updatedAt: new Date(row.updated_at * 1000).toISOString(),
  };
}

export function patchBlock(db, blockId, patch) {
  const cur = db.prepare('SELECT * FROM blocks WHERE id = ?').get(blockId);
  if (!cur) return null;
  const next = {
    page_id: cur.page_id,
    parent_id: (patch.parentId === undefined ? cur.parent_id : patch.parentId),
    sort: (patch.sort === undefined ? cur.sort : patch.sort),
    type: (patch.type === undefined ? cur.type : String(patch.type)),
    props_json: (patch.props === undefined ? cur.props_json : JSON.stringify(patch.props || {})),
    content_json: (patch.content === undefined ? cur.content_json : JSON.stringify(patch.content || {})),
    updated_at: nowTs(),
  };
  const trx = db.transaction(() => {
    db.prepare('UPDATE blocks SET parent_id = ?, sort = ?, type = ?, props_json = ?, content_json = ?, updated_at = ? WHERE id = ?')
      .run(next.parent_id ?? null, next.sort, next.type, next.props_json, next.content_json, next.updated_at, blockId);
    // If parent or sort changed, normalize that sibling group
    normalizeSiblingSort(db, cur.page_id, next.parent_id ?? null);
    touchPage(db, cur.page_id);
  });
  trx();
  const row = db.prepare('SELECT id, page_id, parent_id, sort, type, props_json, content_json, created_at, updated_at FROM blocks WHERE id = ?').get(blockId);
  return {
    id: row.id,
    pageId: row.page_id,
    parentId: row.parent_id,
    sort: row.sort,
    type: row.type,
    propsJson: row.props_json,
    contentJson: row.content_json,
    createdAt: new Date(row.created_at * 1000).toISOString(),
    updatedAt: new Date(row.updated_at * 1000).toISOString(),
  };
}

export function deleteBlock(db, blockId) {
  const cur = db.prepare('SELECT * FROM blocks WHERE id = ?').get(blockId);
  if (!cur) return false;
  const trx = db.transaction(() => {
    db.prepare('DELETE FROM blocks WHERE id = ?').run(blockId);
    normalizeSiblingSort(db, cur.page_id, cur.parent_id ?? null);
    touchPage(db, cur.page_id);
  });
  trx();
  return true;
}

export function reorderBlocks(db, pageId, moves) {
  if (!Array.isArray(moves) || !moves.length) return { ok: true };
  const update = db.prepare('UPDATE blocks SET parent_id = ?, sort = ?, updated_at = ? WHERE id = ? AND page_id = ?');
  const ts = nowTs();
  const parentsTouched = new Set();
  const trx = db.transaction(() => {
    for (const m of moves) {
      update.run(m.parentId ?? null, m.sort, ts, m.id, pageId);
      parentsTouched.add(m.parentId ?? null);
    }
    for (const pid of parentsTouched) {
      normalizeSiblingSort(db, pageId, pid);
    }
    touchPage(db, pageId);
  });
  trx();
  return { ok: true };
}
