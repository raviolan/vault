CREATE TABLE IF NOT EXISTS timeline_events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  event_type TEXT NOT NULL DEFAULT '',
  start_year INTEGER NOT NULL,
  start_month INTEGER,
  start_day INTEGER,
  start_precision TEXT NOT NULL DEFAULT 'day',
  end_year INTEGER,
  end_month INTEGER,
  end_day INTEGER,
  end_precision TEXT,
  arc_page_id TEXT REFERENCES pages(id) ON DELETE SET NULL,
  location_page_id TEXT REFERENCES pages(id) ON DELETE SET NULL,
  archived_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS timeline_event_pages (
  event_id TEXT NOT NULL REFERENCES timeline_events(id) ON DELETE CASCADE,
  page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  sort INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (event_id, page_id)
);

CREATE TABLE IF NOT EXISTS timeline_event_tags (
  event_id TEXT NOT NULL REFERENCES timeline_events(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_timeline_events_start ON timeline_events(start_year, start_month, start_day, created_at);
CREATE INDEX IF NOT EXISTS idx_timeline_events_type ON timeline_events(event_type);
CREATE INDEX IF NOT EXISTS idx_timeline_events_arc ON timeline_events(arc_page_id);
CREATE INDEX IF NOT EXISTS idx_timeline_events_location ON timeline_events(location_page_id);
CREATE INDEX IF NOT EXISTS idx_timeline_events_archived ON timeline_events(archived_at);
CREATE INDEX IF NOT EXISTS idx_timeline_event_pages_page ON timeline_event_pages(page_id, event_id);
CREATE INDEX IF NOT EXISTS idx_timeline_event_tags_tag ON timeline_event_tags(tag_id, event_id);
