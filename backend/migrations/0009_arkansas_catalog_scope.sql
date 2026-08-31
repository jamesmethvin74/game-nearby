PRAGMA foreign_keys = ON;

ALTER TABLE schools ADD COLUMN catalog_scope TEXT NOT NULL DEFAULT 'local'
  CHECK(catalog_scope IN ('local','opponent-only','unknown'));
ALTER TABLE schools ADD COLUMN membership_source TEXT;
ALTER TABLE schools ADD COLUMN membership_verified_at TEXT;

CREATE INDEX IF NOT EXISTS idx_schools_catalog_scope ON schools(catalog_scope, state, name);

-- Existing curated LocalBleachersAR schools predate statewide discovery and remain local.
UPDATE schools
SET catalog_scope='local',
    membership_source=COALESCE(membership_source,'curated-local')
WHERE catalog_scope='local';
