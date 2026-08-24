PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schools (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'AR',
  level TEXT NOT NULL CHECK(level IN ('high-school','college')),
  mascot TEXT,
  logo_url TEXT,
  latitude REAL,
  longitude REAL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS conferences (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  classification TEXT,
  standings_method TEXT NOT NULL DEFAULT 'unavailable' CHECK(standings_method IN ('calculated','published','unavailable')),
  coverage_complete INTEGER NOT NULL DEFAULT 0 CHECK(coverage_complete IN (0,1)),
  source_url TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id),
  sport TEXT NOT NULL,
  gender TEXT NOT NULL,
  season TEXT NOT NULL,
  conference_id TEXT REFERENCES conferences(id),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(school_id, sport, gender, season)
);

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id),
  source_url TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK(source_type IN ('official-school','official-athletics','official-conference','secondary')),
  source_priority INTEGER NOT NULL DEFAULT 1,
  parser_type TEXT NOT NULL,
  parser_version TEXT NOT NULL DEFAULT '1',
  timezone TEXT NOT NULL DEFAULT 'America/Chicago',
  expected_min_games INTEGER NOT NULL DEFAULT 1,
  refresh_minutes INTEGER NOT NULL DEFAULT 360,
  active_result_minutes INTEGER NOT NULL DEFAULT 60,
  home_venue TEXT,
  home_latitude REAL,
  home_longitude REAL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  etag TEXT,
  last_modified TEXT,
  last_successful_fetch_at TEXT,
  last_failure_at TEXT,
  last_error TEXT,
  last_http_status INTEGER,
  last_checked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id),
  source_id TEXT NOT NULL REFERENCES sources(id),
  source_event_key TEXT NOT NULL,
  opponent TEXT NOT NULL,
  opponent_school_id TEXT REFERENCES schools(id),
  scheduled_at TEXT NOT NULL,
  scheduled_time_known INTEGER NOT NULL DEFAULT 1 CHECK(scheduled_time_known IN (0,1)),
  venue TEXT,
  location_text TEXT,
  latitude REAL,
  longitude REAL,
  home_away TEXT NOT NULL CHECK(home_away IN ('home','away','neutral','unknown')),
  conference_game INTEGER NOT NULL DEFAULT 0 CHECK(conference_game IN (0,1)),
  counts_for_record INTEGER NOT NULL DEFAULT 1 CHECK(counts_for_record IN (0,1)),
  status TEXT NOT NULL DEFAULT 'SCHEDULED' CHECK(status IN ('SCHEDULED','FINAL','POSTPONED','CANCELED')),
  team_score INTEGER,
  opponent_score INTEGER,
  result TEXT CHECK(result IN ('W','L','T') OR result IS NULL),
  notes TEXT,
  source_url TEXT NOT NULL,
  source_updated_at TEXT NOT NULL,
  last_checked_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(source_id, source_event_key)
);

CREATE INDEX IF NOT EXISTS idx_games_team_time ON games(team_id, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_games_status_time ON games(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_games_location ON games(latitude, longitude);

CREATE TABLE IF NOT EXISTS team_records (
  team_id TEXT PRIMARY KEY REFERENCES teams(id),
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  ties INTEGER NOT NULL DEFAULT 0,
  conference_wins INTEGER NOT NULL DEFAULT 0,
  conference_losses INTEGER NOT NULL DEFAULT 0,
  conference_ties INTEGER NOT NULL DEFAULT 0,
  calculated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS standings (
  conference_id TEXT NOT NULL REFERENCES conferences(id),
  team_id TEXT NOT NULL REFERENCES teams(id),
  rank INTEGER,
  conference_record TEXT,
  overall_record TEXT,
  method TEXT NOT NULL CHECK(method IN ('calculated','published')),
  source_url TEXT,
  calculated_at TEXT NOT NULL,
  PRIMARY KEY(conference_id, team_id)
);

CREATE TABLE IF NOT EXISTS collection_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT NOT NULL REFERENCES sources(id),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL CHECK(status IN ('RUNNING','SUCCESS','FAILURE','NOT_MODIFIED','SKIPPED')),
  http_status INTEGER,
  games_seen INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  parser_version TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO schools (id,name,city,state,level,mascot,latitude,longitude) VALUES
 ('uca','University of Central Arkansas','Conway','AR','college','Bears / Sugar Bears',35.0809,-92.4590),
 ('hendrix','Hendrix College','Conway','AR','college','Warriors',35.0997,-92.4426),
 ('conway','Conway High School','Conway','AR','high-school','Wampus Cats',35.0887,-92.4421);

INSERT OR IGNORE INTO conferences (id,name,classification,standings_method,coverage_complete,source_url) VALUES
 ('uac','United Athletic Conference','NCAA Division I FCS','calculated',0,'https://uacfootball.com/'),
 ('asun','ASUN Conference','NCAA Division I','calculated',0,'https://asunsports.org/'),
 ('scac','Southern Collegiate Athletic Conference','NCAA Division III','calculated',0,'https://scacsports.com/'),
 ('7a-central','7A Central','Arkansas high school','calculated',0,'https://www.ahsaa.org/');

INSERT OR IGNORE INTO teams (id,school_id,sport,gender,season,conference_id) VALUES
 ('uca-football-2026','uca','football','men','2026','uac'),
 ('uca-mens-soccer-2026','uca','soccer','men','2026','asun'),
 ('hendrix-football-2026','hendrix','football','men','2026','scac'),
 ('conway-football-2026','conway','football','boys','2026','7a-central');

INSERT OR IGNORE INTO sources
 (id,team_id,source_url,source_type,source_priority,parser_type,parser_version,timezone,expected_min_games,refresh_minutes,active_result_minutes,home_venue,home_latitude,home_longitude)
VALUES
 ('uca-football-official','uca-football-2026','https://ucasports.com/sports/football/schedule/2026','official-athletics',1,'sidearm','1','America/Chicago',8,360,60,'Estes Stadium',35.0779,-92.4574),
 ('uca-mens-soccer-official','uca-mens-soccer-2026','https://ucasports.com/sports/mens-soccer/schedule/2026','official-athletics',1,'sidearm','1','America/Chicago',8,360,60,'Bill Stephens Track/Soccer Complex',35.0767,-92.4545),
 ('hendrix-football-official','hendrix-football-2026','https://hendrixwarriors.com/sports/football/schedule/2026','official-athletics',1,'sidearm','1','America/Chicago',7,360,60,'Young-Wise Memorial Stadium',35.1020,-92.4412),
 ('conway-football-official','conway-football-2026','https://www.conwaywampuscats.com/sport/football/boys/?tab=schedule','official-school',1,'mascot-media','1','America/Chicago',8,360,60,'John McConnell Stadium',35.0872,-92.4628);
