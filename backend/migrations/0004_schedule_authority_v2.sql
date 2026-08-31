PRAGMA foreign_keys = ON;

ALTER TABLE sources ADD COLUMN authority_rank INTEGER NOT NULL DEFAULT 50;
ALTER TABLE sources ADD COLUMN stale_after_minutes INTEGER;
ALTER TABLE sources ADD COLUMN consecutive_failures INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sources ADD COLUMN last_game_count INTEGER;
ALTER TABLE sources ADD COLUMN suspicious_game_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE games ADD COLUMN canonical_event_id TEXT;

CREATE TABLE IF NOT EXISTS school_aliases (
  normalized_alias TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id),
  alias_text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS canonical_events (
  id TEXT PRIMARY KEY,
  sport TEXT NOT NULL,
  gender TEXT NOT NULL,
  season TEXT NOT NULL,
  participant_a_school_id TEXT NOT NULL REFERENCES schools(id),
  participant_b_school_id TEXT NOT NULL REFERENCES schools(id),
  home_school_id TEXT REFERENCES schools(id),
  away_school_id TEXT REFERENCES schools(id),
  scheduled_at TEXT NOT NULL,
  scheduled_time_known INTEGER NOT NULL DEFAULT 1 CHECK(scheduled_time_known IN (0,1)),
  venue TEXT,
  location_text TEXT,
  latitude REAL,
  longitude REAL,
  conference_game INTEGER NOT NULL DEFAULT 0 CHECK(conference_game IN (0,1)),
  status TEXT NOT NULL DEFAULT 'SCHEDULED' CHECK(status IN ('SCHEDULED','FINAL','POSTPONED','CANCELED')),
  home_score INTEGER,
  away_score INTEGER,
  selected_source_id TEXT REFERENCES sources(id),
  trust_state TEXT NOT NULL DEFAULT 'SINGLE_SOURCE_LIVE',
  conflict_count INTEGER NOT NULL DEFAULT 0,
  resolution_json TEXT,
  last_reconciled_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_canonical_events_time ON canonical_events(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_canonical_events_participants ON canonical_events(participant_a_school_id,participant_b_school_id,sport,gender,season);

CREATE TABLE IF NOT EXISTS canonical_event_members (
  canonical_event_id TEXT NOT NULL REFERENCES canonical_events(id) ON DELETE CASCADE,
  game_id TEXT NOT NULL UNIQUE REFERENCES games(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES sources(id),
  reporting_team_id TEXT NOT NULL REFERENCES teams(id),
  added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(canonical_event_id,game_id)
);

CREATE INDEX IF NOT EXISTS idx_canonical_members_source ON canonical_event_members(source_id);

CREATE TABLE IF NOT EXISTS event_conflicts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  canonical_event_id TEXT NOT NULL REFERENCES canonical_events(id) ON DELETE CASCADE,
  conflict_type TEXT NOT NULL,
  values_json TEXT NOT NULL,
  evidence_json TEXT,
  detected_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_event_conflicts_active ON event_conflicts(canonical_event_id,resolved_at);

INSERT OR IGNORE INTO school_aliases(normalized_alias,school_id,alias_text) VALUES
 ('conway','conway','Conway'),
 ('conway wampus cat','conway','Conway Wampus Cat'),
 ('greenbrier','greenbrier','Greenbrier'),
 ('greenbrier panther','greenbrier','Greenbrier Panther'),
 ('vilonia','vilonia','Vilonia'),
 ('vilonia eagle','vilonia','Vilonia Eagle');

UPDATE sources
SET authority_rank=20,
    stale_after_minutes=CASE WHEN refresh_minutes*3 > 720 THEN refresh_minutes*3 ELSE 720 END
WHERE source_type IN ('official-school','official-athletics');

UPDATE sources
SET source_priority=2
WHERE id IN ('conway-volleyball-official','greenbrier-volleyball-official','vilonia-volleyball-official');

INSERT OR IGNORE INTO sources
 (id,team_id,source_url,source_type,source_priority,parser_type,parser_version,timezone,expected_min_games,refresh_minutes,active_result_minutes,home_venue,home_latitude,home_longitude,enabled,authority_rank,stale_after_minutes)
VALUES
 ('conway-volleyball-dragonfly','conway-volleyball-2026','https://maxinfosite-api-live.dragonflyathletics.com/states/ArkAA/schedules/2026/WVB_Varsity/0','official-conference',1,'dragonfly-public','2','America/Chicago',1,180,60,'Buzz Bolding Arena',35.0887,-92.4421,1,10,720),
 ('greenbrier-volleyball-dragonfly','greenbrier-volleyball-2026','https://maxinfosite-api-live.dragonflyathletics.com/states/ArkAA/schedules/2026/WVB_Varsity/0','official-conference',1,'dragonfly-public','2','America/Chicago',1,180,60,'Greenbrier High School',35.2334,-92.3870,1,10,720),
 ('vilonia-volleyball-dragonfly','vilonia-volleyball-2026','https://maxinfosite-api-live.dragonflyathletics.com/states/ArkAA/schedules/2026/WVB_Varsity/0','official-conference',1,'dragonfly-public','2','America/Chicago',1,180,60,'Vilonia High School',35.0839,-92.2029,1,10,720);
