PRAGMA foreign_keys = ON;

-- D1 read-budget hardening.
-- These indexes support the exact recurring collector/rebuild predicates that
-- previously scanned far more rows than the requested team/source required.

CREATE INDEX IF NOT EXISTS idx_canonical_members_reporting_team
  ON canonical_event_members(reporting_team_id, canonical_event_id);

CREATE INDEX IF NOT EXISTS idx_games_team_record_lookup
  ON games(team_id, status, canonical_event_id, counts_for_record);

CREATE INDEX IF NOT EXISTS idx_games_source_time
  ON games(source_id, scheduled_at);

CREATE INDEX IF NOT EXISTS idx_games_opponent_time
  ON games(opponent_school_id, scheduled_at);

CREATE INDEX IF NOT EXISTS idx_sources_enabled_checked
  ON sources(enabled, last_checked_at, authority_rank, source_priority, id);
