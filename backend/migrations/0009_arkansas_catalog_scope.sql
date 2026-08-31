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

-- DragonFly schedule participation alone is not evidence that an organization is an
-- Arkansas high school. Newly generated df-* rows stay internal until an Arkansas
-- location authority verifies them.
CREATE TRIGGER IF NOT EXISTS trg_dragonfly_school_starts_unverified
AFTER INSERT ON schools
WHEN NEW.id LIKE 'df-%'
BEGIN
  UPDATE schools
  SET catalog_scope='unknown',
      state='',
      membership_source='dragonfly-participant',
      membership_verified_at=NULL
  WHERE id=NEW.id;
END;
