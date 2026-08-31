PRAGMA foreign_keys = ON;

ALTER TABLE sources ADD COLUMN collection_mode TEXT NOT NULL DEFAULT 'team'
  CHECK(collection_mode IN ('team','statewide'));

CREATE INDEX IF NOT EXISTS idx_sources_collection_mode
  ON sources(collection_mode, enabled, parser_type);

CREATE TABLE IF NOT EXISTS school_external_identities (
  provider TEXT NOT NULL,
  external_school_id TEXT NOT NULL,
  school_id TEXT NOT NULL REFERENCES schools(id),
  observed_name TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(provider, external_school_id)
);

CREATE INDEX IF NOT EXISTS idx_school_external_school
  ON school_external_identities(school_id, provider);

CREATE TABLE IF NOT EXISTS team_external_identities (
  provider TEXT NOT NULL,
  external_team_id TEXT NOT NULL,
  team_id TEXT NOT NULL REFERENCES teams(id),
  external_code TEXT,
  last_seen_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(provider, external_team_id)
);

CREATE INDEX IF NOT EXISTS idx_team_external_team
  ON team_external_identities(team_id, provider);

CREATE TABLE IF NOT EXISTS catalog_sync_state (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  feed_url TEXT NOT NULL,
  last_checked_at TEXT,
  last_successful_sync_at TEXT,
  discovered_school_count INTEGER NOT NULL DEFAULT 0,
  discovered_team_count INTEGER NOT NULL DEFAULT 0,
  active_source_count INTEGER NOT NULL DEFAULT 0,
  ambiguous_name_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  details_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS statewide_collection_state (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  feed_url TEXT NOT NULL,
  last_checked_at TEXT,
  last_successful_fetch_at TEXT,
  last_event_count INTEGER NOT NULL DEFAULT 0,
  last_observation_count INTEGER NOT NULL DEFAULT 0,
  last_source_count INTEGER NOT NULL DEFAULT 0,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  details_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
