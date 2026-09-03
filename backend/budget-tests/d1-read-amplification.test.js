import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

const recordRebuild = fs.readFileSync(new URL("../src/record-rebuild.js", import.meta.url), "utf8");
const migration = fs.readFileSync(new URL("../migrations/0012_d1_read_budget_indexes.sql", import.meta.url), "utf8");

test("team record rebuild scopes FINAL reads inside SQL instead of filtering statewide rows in JavaScript", () => {
  assert.match(recordRebuild, /cem\.reporting_team_id IN \(SELECT value FROM json_each\(\?\)\)/);
  assert.match(recordRebuild, /g\.team_id IN \(SELECT value FROM json_each\(\?\)\)/);
  assert.doesNotMatch(recordRebuild, /wantedTeamIds/);
  assert.doesNotMatch(recordRebuild, /canonicalRows\.filter/);
  assert.doesNotMatch(recordRebuild, /rawRows\.filter/);
});

test("D1 read-budget migration adds indexes for recurring collector and record predicates", () => {
  for (const indexName of [
    "idx_canonical_members_reporting_team",
    "idx_games_team_record_lookup",
    "idx_games_source_time",
    "idx_games_opponent_time",
    "idx_sources_enabled_checked"
  ]) {
    assert.match(migration, new RegExp(`CREATE INDEX IF NOT EXISTS ${indexName}`));
  }
});

test("SQLite planner can use the new team-scoped record indexes", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE canonical_event_members(canonical_event_id TEXT, game_id TEXT, reporting_team_id TEXT);
    CREATE TABLE games(id TEXT PRIMARY KEY, team_id TEXT, source_id TEXT, opponent_school_id TEXT, scheduled_at TEXT, status TEXT, canonical_event_id TEXT, counts_for_record INTEGER);
    CREATE TABLE sources(id TEXT PRIMARY KEY, enabled INTEGER, last_checked_at TEXT, authority_rank INTEGER, source_priority INTEGER);
    CREATE INDEX idx_canonical_members_reporting_team ON canonical_event_members(reporting_team_id, canonical_event_id);
    CREATE INDEX idx_games_team_record_lookup ON games(team_id, status, canonical_event_id, counts_for_record);
    CREATE INDEX idx_games_source_time ON games(source_id, scheduled_at);
    CREATE INDEX idx_games_opponent_time ON games(opponent_school_id, scheduled_at);
    CREATE INDEX idx_sources_enabled_checked ON sources(enabled, last_checked_at, authority_rank, source_priority, id);
  `);

  const canonicalPlan = db.prepare(`
    EXPLAIN QUERY PLAN
    SELECT canonical_event_id FROM canonical_event_members
    WHERE reporting_team_id IN (SELECT value FROM json_each(?))
  `).all(JSON.stringify(["team-a"])).map(row => row.detail).join("\n");
  assert.match(canonicalPlan, /idx_canonical_members_reporting_team/);

  const rawPlan = db.prepare(`
    EXPLAIN QUERY PLAN
    SELECT id FROM games
    WHERE team_id IN (SELECT value FROM json_each(?))
      AND canonical_event_id IS NULL
      AND status='FINAL'
  `).all(JSON.stringify(["team-a"])).map(row => row.detail).join("\n");
  assert.match(rawPlan, /idx_games_team_record_lookup/);
});
