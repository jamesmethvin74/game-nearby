-- Provenance-aware school mascot/logo lookup for LocalBleachersAR.
-- Curated rows are never overwritten by automated provider refreshes.
CREATE TABLE IF NOT EXISTS school_brand_assets (
  school_id TEXT PRIMARY KEY REFERENCES schools(id) ON DELETE CASCADE,
  mascot TEXT,
  logo_url TEXT,
  primary_color TEXT,
  secondary_color TEXT,
  provider TEXT,
  provider_name TEXT,
  external_school_id TEXT,
  source_url TEXT,
  mascot_source_url TEXT,
  match_method TEXT,
  match_confidence REAL,
  status TEXT NOT NULL DEFAULT 'unresolved' CHECK(status IN ('matched','curated','unresolved')),
  last_checked_at TEXT,
  mascot_checked_at TEXT,
  verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_school_brand_assets_provider
  ON school_brand_assets(provider, external_school_id);
CREATE INDEX IF NOT EXISTS idx_school_brand_assets_status
  ON school_brand_assets(status, provider);

CREATE TABLE IF NOT EXISTS school_brand_sync_state (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  source_url TEXT NOT NULL,
  last_checked_at TEXT,
  last_successful_sync_at TEXT,
  source_school_count INTEGER NOT NULL DEFAULT 0,
  target_school_count INTEGER NOT NULL DEFAULT 0,
  matched_school_count INTEGER NOT NULL DEFAULT 0,
  unresolved_school_count INTEGER NOT NULL DEFAULT 0,
  ambiguous_school_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  details_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
