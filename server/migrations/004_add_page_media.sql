-- Add page_media table for header/profile media per page
-- This migration is additive and backwards compatible.

CREATE TABLE IF NOT EXISTS page_media (
  page_id TEXT PRIMARY KEY REFERENCES pages(id) ON DELETE CASCADE,
  header_path TEXT NULL,
  header_pos_x REAL NULL DEFAULT 50,
  header_pos_y REAL NULL DEFAULT 50,
  profile_path TEXT NULL,
  profile_pos_x REAL NULL DEFAULT 50,
  profile_pos_y REAL NULL DEFAULT 50,
  updated_at INTEGER NOT NULL
);

-- Optional index to help cleanup/sorting by recency
CREATE INDEX IF NOT EXISTS idx_page_media_updated_at ON page_media(updated_at);

