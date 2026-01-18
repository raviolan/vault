-- Add zoom columns for header/profile media (defaults to 1)
ALTER TABLE page_media ADD COLUMN header_zoom REAL NOT NULL DEFAULT 1;
ALTER TABLE page_media ADD COLUMN profile_zoom REAL NOT NULL DEFAULT 1;

