-- Add per-page sheet data (AC, passives, notes) stored as JSON.
CREATE TABLE IF NOT EXISTS page_sheets (
  page_id TEXT PRIMARY KEY REFERENCES pages(id) ON DELETE CASCADE,
  sheet_json TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_page_sheets_updated_at ON page_sheets(updated_at);

