let schemaReady = false;
let schemaPromise = null;

const MIGRATIONS = [
  "0003_fix_volleyball_conferences_and_sources.sql",
  "0004_schedule_authority_v2.sql",
  "0005_statewide_volleyball_discovery.sql",
  "0006_school_location_enrichment.sql",
  "0007_canonical_game_location_propagation.sql",
  "0008_statewide_catalog_visibility.sql",
  "0009_arkansas_catalog_scope.sql"
];

async function tableColumns(db, table) {
  const { results = [] } = await db.prepare(`PRAGMA table_info(${table})`).all();
  return new Set(results.map(row => row.name));
}

async function addColumnIfMissing(db, table, column, ddl) {
  const columns = await tableColumns(db, table);
  if (columns.has(column)) return;
  try {
    await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${ddl}`).run();
  } catch (error) {
    const after = await tableColumns(db, table);
    if (!after.has(column)) throw error;
  }
}

async function markApplied(db, name) {
  await db.prepare("INSERT OR IGNORE INTO d1_migrations(name) VALUES(?)").bind(name).run();
}

async function apply0003(db) {
  await db.prepare(`INSERT OR IGNORE INTO conferences (id,name,classification,standings_method,coverage_complete,source_url) VALUES
    ('6a-central-volleyball','6A Central','6A Volleyball','calculated',0,'https://www.ahsaa.org/volleyball'),
    ('5a-central-volleyball','5A Central','5A Volleyball','calculated',0,'https://www.ahsaa.org/volleyball')`).run();
  await db.prepare("UPDATE teams SET conference_id='6a-central-volleyball', updated_at=CURRENT_TIMESTAMP WHERE id='conway-volleyball-2026'").run();
  await db.prepare(`INSERT OR IGNORE INTO schools (id,name,city,state,level,mascot,latitude,longitude) VALUES
    ('greenbrier','Greenbrier High School','Greenbrier','AR','high-school','Panthers',35.2334,-92.3870),
    ('vilonia','Vilonia High School','Vilonia','AR','high-school','Eagles',35.0839,-92.2029)`).run();
  await db.prepare(`INSERT OR IGNORE INTO teams (id,school_id,sport,gender,season,conference_id) VALUES
    ('greenbrier-volleyball-2026','greenbrier','volleyball','girls','2026','5a-central-volleyball'),
    ('vilonia-volleyball-2026','vilonia','volleyball','girls','2026','5a-central-volleyball')`).run();
  await db.prepare(`INSERT OR IGNORE INTO sources
    (id,team_id,source_url,source_type,source_priority,parser_type,parser_version,timezone,expected_min_games,refresh_minutes,active_result_minutes,home_venue,home_latitude,home_longitude)
    VALUES
    ('greenbrier-volleyball-official','greenbrier-volleyball-2026','https://www.greenbrierathletics.com/sport/volleyball/girls/?tab=schedule','official-school',1,'mascot-media','1','America/Chicago',15,180,60,'Greenbrier High School',35.2334,-92.3870),
    ('vilonia-volleyball-official','vilonia-volleyball-2026','https://www.viloniaathletics.com/sport/volleyball/girls/?tab=schedule','official-school',1,'mascot-media','1','America/Chicago',15,180,60,'Vilonia High School',35.0839,-92.2029)`).run();
}

async function apply0004(db) {
  for (const [table, column, ddl] of [
    ["sources", "authority_rank", "authority_rank INTEGER NOT NULL DEFAULT 50"],
    ["sources", "stale_after_minutes", "stale_after_minutes INTEGER"],
    ["sources", "consecutive_failures", "consecutive_failures INTEGER NOT NULL DEFAULT 0"],
    ["sources", "last_game_count", "last_game_count INTEGER"],
    ["sources", "suspicious_game_count", "suspicious_game_count INTEGER NOT NULL DEFAULT 0"],
    ["games", "canonical_event_id", "canonical_event_id TEXT"]
  ]) await addColumnIfMissing(db, table, column, ddl);

  await db.prepare(`CREATE TABLE IF NOT EXISTS school_aliases (
    normalized_alias TEXT PRIMARY KEY,
    school_id TEXT NOT NULL REFERENCES schools(id),
    alias_text TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS canonical_events (
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
  )`).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_canonical_events_time ON canonical_events(scheduled_at)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_canonical_events_participants ON canonical_events(participant_a_school_id,participant_b_school_id,sport,gender,season)").run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS canonical_event_members (
    canonical_event_id TEXT NOT NULL REFERENCES canonical_events(id) ON DELETE CASCADE,
    game_id TEXT NOT NULL UNIQUE REFERENCES games(id) ON DELETE CASCADE,
    source_id TEXT NOT NULL REFERENCES sources(id),
    reporting_team_id TEXT NOT NULL REFERENCES teams(id),
    added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(canonical_event_id,game_id)
  )`).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_canonical_members_source ON canonical_event_members(source_id)").run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS event_conflicts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    canonical_event_id TEXT NOT NULL REFERENCES canonical_events(id) ON DELETE CASCADE,
    conflict_type TEXT NOT NULL,
    values_json TEXT NOT NULL,
    evidence_json TEXT,
    detected_at TEXT NOT NULL,
    resolved_at TEXT
  )`).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_event_conflicts_active ON event_conflicts(canonical_event_id,resolved_at)").run();
  await db.prepare(`INSERT OR IGNORE INTO school_aliases(normalized_alias,school_id,alias_text) VALUES
    ('conway','conway','Conway'),
    ('conway wampus cat','conway','Conway Wampus Cat'),
    ('greenbrier','greenbrier','Greenbrier'),
    ('greenbrier panther','greenbrier','Greenbrier Panther'),
    ('vilonia','vilonia','Vilonia'),
    ('vilonia eagle','vilonia','Vilonia Eagle')`).run();
  await db.prepare(`UPDATE sources
    SET authority_rank=20,
        stale_after_minutes=CASE WHEN refresh_minutes*3 > 720 THEN refresh_minutes*3 ELSE 720 END
    WHERE source_type IN ('official-school','official-athletics')`).run();
  await db.prepare("UPDATE sources SET source_priority=2 WHERE id IN ('conway-volleyball-official','greenbrier-volleyball-official','vilonia-volleyball-official')").run();
  await db.prepare(`INSERT OR IGNORE INTO sources
    (id,team_id,source_url,source_type,source_priority,parser_type,parser_version,timezone,expected_min_games,refresh_minutes,active_result_minutes,home_venue,home_latitude,home_longitude,enabled,authority_rank,stale_after_minutes)
    VALUES
    ('conway-volleyball-dragonfly','conway-volleyball-2026','https://maxinfosite-api-live.dragonflyathletics.com/states/ArkAA/schedules/2026/WVB_Varsity/0','official-conference',1,'dragonfly-public','3','America/Chicago',5,180,60,'Buzz Bolding Arena',35.0887,-92.4421,1,10,720),
    ('greenbrier-volleyball-dragonfly','greenbrier-volleyball-2026','https://maxinfosite-api-live.dragonflyathletics.com/states/ArkAA/schedules/2026/WVB_Varsity/0','official-conference',1,'dragonfly-public','3','America/Chicago',5,180,60,'Greenbrier High School',35.2334,-92.3870,1,10,720),
    ('vilonia-volleyball-dragonfly','vilonia-volleyball-2026','https://maxinfosite-api-live.dragonflyathletics.com/states/ArkAA/schedules/2026/WVB_Varsity/0','official-conference',1,'dragonfly-public','3','America/Chicago',5,180,60,'Vilonia High School',35.0839,-92.2029,1,10,720)`).run();
}

async function apply0005(db) {
  await addColumnIfMissing(db, "sources", "collection_mode", "collection_mode TEXT NOT NULL DEFAULT 'team' CHECK(collection_mode IN ('team','statewide'))");
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_sources_collection_mode ON sources(collection_mode, enabled, parser_type)").run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS school_external_identities (
    provider TEXT NOT NULL,
    external_school_id TEXT NOT NULL,
    school_id TEXT NOT NULL REFERENCES schools(id),
    observed_name TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(provider, external_school_id)
  )`).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_school_external_school ON school_external_identities(school_id, provider)").run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS team_external_identities (
    provider TEXT NOT NULL,
    external_team_id TEXT NOT NULL,
    team_id TEXT NOT NULL REFERENCES teams(id),
    external_code TEXT,
    last_seen_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(provider, external_team_id)
  )`).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_team_external_team ON team_external_identities(team_id, provider)").run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS catalog_sync_state (
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
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS statewide_collection_state (
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
  )`).run();
}

async function apply0006(db) {
  for (const [column, ddl] of [
    ["address", "address TEXT"],
    ["postal_code", "postal_code TEXT"],
    ["location_source", "location_source TEXT"],
    ["location_matched_name", "location_matched_name TEXT"],
    ["location_updated_at", "location_updated_at TEXT"]
  ]) await addColumnIfMissing(db, "schools", column, ddl);

  await db.prepare(`CREATE TABLE IF NOT EXISTS school_location_sync_state (
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
  )`).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_schools_location_ready ON schools(level, latitude, longitude)").run();
}

async function apply0007(db) {
  await db.prepare(`CREATE TRIGGER IF NOT EXISTS trg_games_inherit_canonical_location_insert
    AFTER INSERT ON games
    WHEN NEW.canonical_event_id IS NOT NULL
    BEGIN
      UPDATE games SET
        latitude = COALESCE((SELECT latitude FROM canonical_events WHERE id = NEW.canonical_event_id), latitude),
        longitude = COALESCE((SELECT longitude FROM canonical_events WHERE id = NEW.canonical_event_id), longitude)
      WHERE id = NEW.id;
    END`).run();
  await db.prepare(`CREATE TRIGGER IF NOT EXISTS trg_games_inherit_canonical_location_update
    AFTER UPDATE OF canonical_event_id ON games
    WHEN NEW.canonical_event_id IS NOT NULL
    BEGIN
      UPDATE games SET
        latitude = COALESCE((SELECT latitude FROM canonical_events WHERE id = NEW.canonical_event_id), latitude),
        longitude = COALESCE((SELECT longitude FROM canonical_events WHERE id = NEW.canonical_event_id), longitude)
      WHERE id = NEW.id;
    END`).run();
  await db.prepare(`CREATE TRIGGER IF NOT EXISTS trg_canonical_location_propagates_to_games
    AFTER UPDATE OF latitude, longitude ON canonical_events
    WHEN NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL
    BEGIN
      UPDATE games SET latitude = NEW.latitude, longitude = NEW.longitude
      WHERE canonical_event_id = NEW.id;
    END`).run();
}

async function apply0008(db) {
  await db.prepare("UPDATE sources SET authority_rank = 99 WHERE collection_mode = 'statewide'").run();
  await db.prepare(`CREATE TRIGGER IF NOT EXISTS trg_statewide_team_scope_updates_source_authority
    AFTER UPDATE OF active ON teams
    BEGIN
      UPDATE sources
      SET authority_rank = CASE WHEN NEW.active = 1 THEN 10 ELSE 99 END,
          updated_at = NEW.updated_at
      WHERE team_id = NEW.id AND collection_mode = 'statewide';
    END`).run();
  await db.prepare(`CREATE TRIGGER IF NOT EXISTS trg_statewide_source_scope_on_insert
    AFTER INSERT ON sources
    WHEN NEW.collection_mode = 'statewide'
    BEGIN
      UPDATE sources
      SET authority_rank = CASE
        WHEN (SELECT active FROM teams WHERE id = NEW.team_id) = 1 THEN 10
        ELSE 99
      END
      WHERE id = NEW.id;
    END`).run();
}

async function apply0009(db) {
  await addColumnIfMissing(db, "schools", "catalog_scope", "catalog_scope TEXT NOT NULL DEFAULT 'local' CHECK(catalog_scope IN ('local','opponent-only','unknown'))");
  await addColumnIfMissing(db, "schools", "membership_source", "membership_source TEXT");
  await addColumnIfMissing(db, "schools", "membership_verified_at", "membership_verified_at TEXT");
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_schools_catalog_scope ON schools(catalog_scope, state, name)").run();
  await db.prepare("UPDATE schools SET catalog_scope='local', membership_source=COALESCE(membership_source,'curated-local') WHERE catalog_scope='local'").run();
  await db.prepare(`CREATE TRIGGER IF NOT EXISTS trg_dragonfly_school_starts_unverified
    AFTER INSERT ON schools
    WHEN NEW.id LIKE 'df-%'
    BEGIN
      UPDATE schools
      SET catalog_scope='unknown', state='', membership_source='dragonfly-participant', membership_verified_at=NULL
      WHERE id=NEW.id;
    END`).run();
}

async function runSchemaBootstrap(env) {
  const db = env.DB;
  await db.prepare(`CREATE TABLE IF NOT EXISTS d1_migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
  )`).run();

  const { results = [] } = await db.prepare("SELECT name FROM d1_migrations").all();
  const applied = new Set(results.map(row => row.name));
  const steps = [apply0003, apply0004, apply0005, apply0006, apply0007, apply0008, apply0009];

  for (let i = 0; i < MIGRATIONS.length; i++) {
    const name = MIGRATIONS[i];
    if (applied.has(name)) continue;
    await steps[i](db);
    await markApplied(db, name);
  }
}

export async function ensureStatewideSchema(env) {
  if (schemaReady) return;
  if (!schemaPromise) {
    schemaPromise = runSchemaBootstrap(env)
      .then(() => { schemaReady = true; })
      .finally(() => { schemaPromise = null; });
  }
  return schemaPromise;
}
