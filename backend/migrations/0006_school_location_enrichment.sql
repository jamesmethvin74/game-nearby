PRAGMA foreign_keys = ON;

ALTER TABLE schools ADD COLUMN address TEXT;
ALTER TABLE schools ADD COLUMN postal_code TEXT;
ALTER TABLE schools ADD COLUMN location_source TEXT;
ALTER TABLE schools ADD COLUMN location_matched_name TEXT;
ALTER TABLE schools ADD COLUMN location_updated_at TEXT;

CREATE TABLE IF NOT EXISTS school_location_sync_state (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  last_checked_at TEXT,
  last_successful_sync_at TEXT,
  target_school_count INTEGER NOT NULL DEFAULT 0,
  matched_school_count INTEGER NOT NULL DEFAULT 0,
  unresolved_school_count INTEGER NOT NULL DEFAULT 0,
  ambiguous_school_count INTEGER NOT NULL DEFAULT 0,
  public_feature_count INTEGER NOT NULL DEFAULT 0,
  private_feature_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  details_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_schools_location_ready
  ON schools(level, latitude, longitude);
