-- Add slug column to pages and ensure uniqueness
ALTER TABLE pages ADD COLUMN slug TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS pages_slug_unique ON pages(slug);
