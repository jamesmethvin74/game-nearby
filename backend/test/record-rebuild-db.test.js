import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { rebuildStatewideRecords, rebuildTeamRecord } from "../src/record-rebuild.js";

function d1FromSqlite(db){
  const prepare=sql=>{let args=[];return {bind(...next){args=next;return this;},async all(){return {results:db.prepare(sql).all(...args)};},async first(){return db.prepare(sql).get(...args)||null;},async run(){return db.prepare(sql).run(...args);}}};
  return {prepare,async batch(statements){const out=[];for(const statement of statements) out.push(await statement.run());return out;}};
}

function applyMigrations(db){
  const dir=fileURLToPath(new URL("../migrations/",import.meta.url));
  for(const file of fs.readdirSync(dir).filter(name=>name.endsWith(".sql")).sort()) db.exec(fs.readFileSync(`${dir}/${file}`,"utf8"));
}

test("database record rebuild persists duplicate-safe statewide totals", async()=>{
  const db=new DatabaseSync(":memory:"); applyMigrations(db); const env={DB:d1FromSqlite(db)};
  const now="2026-09-01T00:00:00.000Z";
  for(const [id,name] of [["a","Alpha High School"],["b","Beta High School"]]) db.prepare("INSERT INTO schools(id,name,city,state,level,catalog_scope,updated_at) VALUES(?,?,?,'AR','high-school','local',?)").run(id,name,name,now);
  db.prepare("INSERT INTO teams(id,school_id,sport,gender,season,active,updated_at) VALUES('a-volleyball-2026','a','volleyball','girls','2026',1,?)").run(now);
  db.prepare("INSERT INTO sources(id,team_id,source_url,source_type,source_priority,parser_type,parser_version,timezone,expected_min_games,refresh_minutes,active_result_minutes,enabled,authority_rank,stale_after_minutes,collection_mode,updated_at) VALUES('a-statewide','a-volleyball-2026','https://example.test','official-conference',1,'dragonfly-public','1','America/Chicago',1,60,60,0,10,720,'statewide',?)").run(now);
  const insertCanonical=db.prepare(`INSERT INTO canonical_events(id,sport,gender,season,participant_a_school_id,participant_b_school_id,home_school_id,away_school_id,scheduled_at,scheduled_time_known,conference_game,status,home_score,away_score,selected_source_id,trust_state,conflict_count,resolution_json,last_reconciled_at,updated_at) VALUES(?,'volleyball','girls','2026','a','b','a','b',?,1,0,'FINAL',3,0,'a-statewide',?,0,'{}',?,?)`);
  insertCanonical.run('ce-one','2026-08-31T23:00:00.000Z','CORROBORATED',now,now);
  insertCanonical.run('ce-duplicate','2026-08-31T23:00:00.000Z','AUTHORITATIVE_LIVE',now,now);
  const gameInsert=db.prepare(`INSERT INTO games(id,team_id,source_id,source_event_key,opponent,opponent_school_id,scheduled_at,scheduled_time_known,home_away,conference_game,counts_for_record,status,team_score,opponent_score,result,source_url,last_checked_at,updated_at,canonical_event_id) VALUES(?,?,?,?,?,?,?,?,?,0,1,'FINAL',3,0,'W','https://example.test',?,?,?)`);
  gameInsert.run('g-one','a-volleyball-2026','a-statewide','native:one','Beta High School','b','2026-08-31T23:00:00.000Z',1,'home',now,now,'ce-one');
  gameInsert.run('g-dup','a-volleyball-2026','a-statewide','native:dup','Beta High School','b','2026-08-31T23:00:00.000Z',1,'home',now,now,'ce-duplicate');
  await rebuildStatewideRecords(env,now);
  let record=db.prepare("SELECT * FROM team_records WHERE team_id='a-volleyball-2026'").get();
  assert.equal(record.wins,1); assert.equal(record.losses,0);
  await rebuildTeamRecord(env,'a-volleyball-2026',now);
  record=db.prepare("SELECT * FROM team_records WHERE team_id='a-volleyball-2026'").get();
  assert.equal(record.wins,1); assert.equal(record.losses,0);
});
