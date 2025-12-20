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

export function migrate(db) {
  const migDir = readMigrationsDir();
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, filename TEXT NOT NULL UNIQUE, applied_at INTEGER NOT NULL);`);

  const applied = new Set(db.prepare('SELECT filename FROM schema_migrations ORDER BY id').all().map(r => r.filename));
  const files = fs.readdirSync(migDir).filter(f => /\d+_.+\.sql$/.test(f)).sort();
  const nowTs = () => Math.floor(Date.now() / 1000);

  for (const f of files) {
    if (applied.has(f)) continue;
    const sql = fs.readFileSync(path.join(migDir, f), 'utf8');
    const trx = db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations(filename, applied_at) VALUES (?, ?)').run(f, nowTs());
    });
    trx();
  }
}

// Data access helpers
export function listPages(db) {
  const rows = db.prepare('SELECT id, title, type, created_at, updated_at FROM pages ORDER BY updated_at DESC, created_at DESC').all();
  return rows.map(r => ({
    id: r.id,
    title: r.title,
    type: r.type,
    createdAt: new Date(r.created_at * 1000).toISOString(),
    updatedAt: new Date(r.updated_at * 1000).toISOString(),
  }));
}

export function createPage(db, { title, type = 'note' }) {
  const id = randomUUID();
  const ts = Math.floor(Date.now() / 1000);
  db.prepare('INSERT INTO pages(id, title, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(id, title, type, ts, ts);
  return {
    id,
    title,
    type,
    createdAt: new Date(ts * 1000).toISOString(),
    updatedAt: new Date(ts * 1000).toISOString(),
  };
}

export function getPageWithBlocks(db, id) {
  const page = db.prepare('SELECT id, title, type, created_at, updated_at FROM pages WHERE id = ?').get(id);
  if (!page) return null;
  const blocks = db.prepare('SELECT id, page_id, parent_id, sort, type, props_json, content_json, created_at, updated_at FROM blocks WHERE page_id = ? ORDER BY parent_id IS NOT NULL, parent_id, sort, created_at').all(id);
  return {
    id: page.id,
    title: page.title,
    type: page.type,
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

export function deletePage(db, id) {
  db.prepare('DELETE FROM pages WHERE id = ?').run(id);
}

