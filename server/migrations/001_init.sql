-- Initial vault schema
CREATE TABLE IF NOT EXISTS pages (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  type TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS blocks (
  id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL,
  parent_id TEXT NULL,
  sort INTEGER NOT NULL,
  type TEXT NOT NULL,
  props_json TEXT NOT NULL DEFAULT '{}',
  content_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(page_id) REFERENCES pages(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS blocks_page_parent_sort ON blocks(page_id, parent_id, sort);
CREATE INDEX IF NOT EXISTS pages_updated ON pages(updated_at);

CREATE TABLE IF NOT EXISTS schema_migrations (
  id INTEGER PRIMARY KEY,
  filename TEXT NOT NULL UNIQUE,
  applied_at INTEGER NOT NULL
);

