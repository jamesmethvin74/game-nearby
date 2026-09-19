PRAGMA foreign_keys = ON;

-- Final user-facing read model. ONE_TRUTH_TB is the only authoritative
-- presentation surface for schedules/results/records/standings.
CREATE TABLE IF NOT EXISTS ONE_TRUTH_TB (
  truth_id TEXT PRIMARY KEY,
  row_type TEXT NOT NULL CHECK(row_type IN ('META','TEAM','GAME')),
  team_id TEXT,
  school_id TEXT,
  school_name TEXT,
  school_level TEXT,
  sport TEXT,
  gender TEXT,
  season TEXT,
  conference_id TEXT,
  conference_name TEXT,
  conference_membership_state TEXT,
  rank INTEGER,
  overall_wins INTEGER,
  overall_losses INTEGER,
  overall_ties INTEGER,
  conference_wins INTEGER,
  conference_losses INTEGER,
  conference_ties INTEGER,
  overall_record TEXT,
  conference_record TEXT,
  scored_finals INTEGER,
  conference_scored_finals INTEGER,
  truth_state TEXT,
  game_id TEXT,
  canonical_event_id TEXT,
  opponent_school_id TEXT,
  opponent TEXT,
  scheduled_at TEXT,
  scheduled_time_known INTEGER,
  venue TEXT,
  latitude REAL,
  longitude REAL,
  home_away TEXT,
  conference_game INTEGER,
  counts_for_record INTEGER,
  status TEXT,
  team_score INTEGER,
  opponent_score INTEGER,
  result TEXT,
  source_id TEXT,
  source_type TEXT,
  parser_type TEXT,
  source_url TEXT,
  data_trust TEXT,
  conflict_count INTEGER,
  truth_generation TEXT NOT NULL,
  refreshed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_one_truth_team
  ON ONE_TRUTH_TB(row_type,team_id);
CREATE INDEX IF NOT EXISTS idx_one_truth_school
  ON ONE_TRUTH_TB(row_type,school_id,sport,gender,season);
CREATE INDEX IF NOT EXISTS idx_one_truth_schedule
  ON ONE_TRUTH_TB(row_type,scheduled_at,school_id);
CREATE INDEX IF NOT EXISTS idx_one_truth_conference
  ON ONE_TRUTH_TB(row_type,conference_id,sport,gender,season,rank);

-- Rebuild staging only; no application read is permitted from this table.
CREATE TABLE IF NOT EXISTS ONE_TRUTH_STAGE_TB AS
  SELECT * FROM ONE_TRUTH_TB WHERE 0;
