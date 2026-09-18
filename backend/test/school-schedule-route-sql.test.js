import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { localSchoolSchedule } from "../src/m4-public-worker.js";

function d1Adapter(db) {
  return {
    prepare(sql) {
      const statement = db.prepare(sql);
      let values = [];
      const query = {
        bind(...next) {
          values = next;
          return query;
        },
        async first() {
          return statement.get(...values) || null;
        },
        async all() {
          const results = statement.all(...values);
          return {
            results,
            meta: { rows_read: results.length, rows_written: 0, duration: 0 }
          };
        }
      };
      return query;
    }
  };
}

test("school schedule route SQL executes against the guaranteed schema without optional forced indexes", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE schools(
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      level TEXT NOT NULL,
      catalog_scope TEXT NOT NULL
    );
    CREATE TABLE conferences(
      id TEXT PRIMARY KEY,
      name TEXT
    );
    CREATE TABLE teams(
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL,
      sport TEXT NOT NULL,
      gender TEXT NOT NULL,
      season TEXT NOT NULL,
      conference_id TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      UNIQUE(school_id,sport,gender,season)
    );
    CREATE TABLE team_records(
      team_id TEXT PRIMARY KEY,
      wins INTEGER,
      losses INTEGER,
      ties INTEGER,
      conference_wins INTEGER,
      conference_losses INTEGER,
      conference_ties INTEGER,
      calculated_at TEXT
    );
    CREATE TABLE sources(
      id TEXT PRIMARY KEY,
      source_type TEXT,
      parser_type TEXT,
      collection_mode TEXT,
      authority_rank INTEGER,
      source_priority INTEGER,
      last_successful_fetch_at TEXT
    );
    CREATE TABLE games(
      id TEXT PRIMARY KEY,
      team_id TEXT,
      source_id TEXT,
      canonical_event_id TEXT,
      opponent_school_id TEXT,
      opponent TEXT,
      scheduled_at TEXT,
      scheduled_time_known INTEGER,
      venue TEXT,
      location_text TEXT,
      latitude REAL,
      longitude REAL,
      home_away TEXT,
      conference_game INTEGER,
      counts_for_record INTEGER,
      status TEXT,
      team_score INTEGER,
      opponent_score INTEGER,
      result TEXT,
      notes TEXT,
      source_url TEXT,
      source_updated_at TEXT,
      last_checked_at TEXT
    );
    CREATE TABLE canonical_events(
      id TEXT PRIMARY KEY,
      scheduled_at TEXT,
      scheduled_time_known INTEGER,
      venue TEXT,
      location_text TEXT,
      latitude REAL,
      longitude REAL,
      conference_game INTEGER,
      status TEXT,
      home_score INTEGER,
      away_score INTEGER,
      home_school_id TEXT,
      away_school_id TEXT,
      trust_state TEXT,
      conflict_count INTEGER
    );

    INSERT INTO schools(id,name,level,catalog_scope)
    VALUES('sample','Sample High School','high-school','local');
    INSERT INTO teams(id,school_id,sport,gender,season,conference_id,active)
    VALUES('sample-basketball-boys-2026','sample','basketball','boys','2026',NULL,1);
  `);

  const response = await localSchoolSchedule(
    new Request("https://example.test/api/v1/schools/sample/schedule"),
    { DB: d1Adapter(db) },
    "sample"
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  const body = await response.json();
  assert.equal(body.schoolId, "sample");
  assert.deepEqual(body.games, []);
  assert.equal(body.team_statuses.length, 1);
  assert.equal(body.team_statuses[0].team_id, "sample-basketball-boys-2026");
  assert.equal(body.team_statuses[0].sport, "basketball");
});
