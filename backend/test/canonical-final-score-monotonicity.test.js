import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { CANONICAL_EVENT_UPSERT_SQL } from "../src/canonical-observation-writer.js";

function database() {
  const db=new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE canonical_events(
      id TEXT PRIMARY KEY,
      sport TEXT,gender TEXT,season TEXT,
      participant_a_school_id TEXT,participant_b_school_id TEXT,
      home_school_id TEXT,away_school_id TEXT,
      scheduled_at TEXT,scheduled_time_known INTEGER,
      venue TEXT,location_text TEXT,latitude REAL,longitude REAL,
      conference_game INTEGER,status TEXT,home_score INTEGER,away_score INTEGER,
      selected_source_id TEXT,trust_state TEXT,conflict_count INTEGER,
      resolution_json TEXT,last_reconciled_at TEXT,updated_at TEXT
    )
  `);
  return db;
}

function values({
  home="home",away="away",status="FINAL",homeScore=0,awayScore=3,
  selectedSource="source-a",trustState="CORROBORATED",updatedAt="2026-09-14T21:00:00.000Z"
}={}) {
  return [
    "ce:test","volleyball","girls","2026","away","home",home,away,
    "2026-08-25T23:30:00.000Z",1,"Gym","Gym",null,null,0,
    status,homeScore,awayScore,selectedSource,trustState,0,"{}",updatedAt,updatedAt
  ];
}

function row(db) {
  return db.prepare("SELECT home_school_id,away_school_id,status,home_score,away_score,selected_source_id,trust_state FROM canonical_events WHERE id='ce:test'").get();
}

test("partial refresh cannot erase a complete FINAL score for unchanged home/away orientation",()=>{
  const db=database();
  const upsert=db.prepare(CANONICAL_EVENT_UPSERT_SQL);
  upsert.run(...values());
  upsert.run(...values({homeScore:null,awayScore:null,selectedSource:"source-b",updatedAt:"2026-09-14T22:00:00.000Z"}));

  const current=row(db);
  assert.equal(current.home_school_id,"home");
  assert.equal(current.away_school_id,"away");
  assert.equal(current.status,"FINAL");
  assert.equal(current.home_score,0);
  assert.equal(current.away_score,3);
  assert.equal(current.selected_source_id,"source-b");
  assert.equal(current.trust_state,"CORROBORATED");
});

test("a new complete FINAL score still replaces the old score",()=>{
  const db=database();
  const upsert=db.prepare(CANONICAL_EVENT_UPSERT_SQL);
  upsert.run(...values());
  upsert.run(...values({homeScore:1,awayScore:3,selectedSource:"source-b",updatedAt:"2026-09-14T22:00:00.000Z"}));

  assert.equal(row(db).home_score,1);
  assert.equal(row(db).away_score,3);
});

test("partial refresh is not preserved across a home/away orientation change",()=>{
  const db=database();
  const upsert=db.prepare(CANONICAL_EVENT_UPSERT_SQL);
  upsert.run(...values());
  upsert.run(...values({home:"away",away:"home",homeScore:null,awayScore:null,selectedSource:"source-b",updatedAt:"2026-09-14T22:00:00.000Z"}));

  const current=row(db);
  assert.equal(current.home_school_id,"away");
  assert.equal(current.away_school_id,"home");
  assert.equal(current.home_score,null);
  assert.equal(current.away_score,null);
});
