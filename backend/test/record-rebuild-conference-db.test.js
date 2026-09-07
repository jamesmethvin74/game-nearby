import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { rebuildTeamRecord } from "../src/record-rebuild.js";

function d1FromSqlite(db){
  const prepare=sql=>{let args=[];return {bind(...next){args=next;return this;},async all(){return {results:db.prepare(sql).all(...args)};},async first(){return db.prepare(sql).get(...args)||null;},async run(){return db.prepare(sql).run(...args);}}};
  return {prepare,async batch(statements){const out=[];for(const statement of statements) out.push(await statement.run());return out;}};
}

function applyMigrations(db){
  const dir=fileURLToPath(new URL("../migrations/",import.meta.url));
  for(const file of fs.readdirSync(dir).filter(name=>name.endsWith(".sql")).sort()) db.exec(fs.readFileSync(`${dir}/${file}`,"utf8"));
}

test("record rebuild infers conference final when both varsity teams share explicit conference membership",async()=>{
  const db=new DatabaseSync(":memory:"); applyMigrations(db); const env={DB:d1FromSqlite(db)};
  const now="2026-09-07T21:00:00.000Z";
  db.prepare("INSERT INTO conferences(id,name,classification,standings_method,coverage_complete,updated_at) VALUES('test-6a','Test 6A','Arkansas high school','published',0,?)").run(now);
  for(const [id,name] of [["test-conway","Conway High School"],["test-southwest","Little Rock Southwest High School"]]) {
    db.prepare("INSERT INTO schools(id,name,city,state,level,catalog_scope,updated_at) VALUES(?,?,?,'AR','high-school','local',?)").run(id,name,name,now);
    db.prepare("INSERT INTO teams(id,school_id,sport,gender,season,conference_id,active,updated_at) VALUES(?,?,'volleyball','girls','2026','test-6a',1,?)").run(`${id}-volleyball-2026`,id,now);
  }
  db.prepare(`INSERT INTO sources(id,team_id,source_url,source_type,source_priority,parser_type,parser_version,timezone,expected_min_games,refresh_minutes,active_result_minutes,enabled,authority_rank,stale_after_minutes,collection_mode,updated_at)
    VALUES('test-conway-df','test-conway-volleyball-2026','https://dragonfly.test','official-conference',1,'dragonfly-public','3','America/Chicago',1,180,60,0,10,720,'statewide',?)`).run(now);
  const ce="ce:volleyball:girls:2026:test-conway:test-southwest:20260903:df-test";
  db.prepare(`INSERT INTO canonical_events(id,sport,gender,season,participant_a_school_id,participant_b_school_id,home_school_id,away_school_id,scheduled_at,scheduled_time_known,conference_game,status,home_score,away_score,selected_source_id,trust_state,conflict_count,resolution_json,last_reconciled_at,updated_at)
    VALUES(?,'volleyball','girls','2026','test-conway','test-southwest','test-southwest','test-conway','2026-09-03T23:00:00.000Z',1,0,'FINAL',0,3,'test-conway-df','CORROBORATED',0,'{}',?,?)`).run(ce,now,now);
  db.prepare(`INSERT INTO games(id,team_id,source_id,source_event_key,opponent,opponent_school_id,scheduled_at,scheduled_time_known,home_away,conference_game,counts_for_record,status,team_score,opponent_score,result,source_url,source_updated_at,last_checked_at,updated_at,canonical_event_id)
    VALUES('g-conway','test-conway-volleyball-2026','test-conway-df','native:test','Little Rock Southwest High School','test-southwest','2026-09-03T23:00:00.000Z',1,'away',0,1,'FINAL',3,0,'W','https://dragonfly.test',?,?,?,?)`).run(now,now,now,ce);
  db.prepare("INSERT INTO canonical_event_members(canonical_event_id,game_id,source_id,reporting_team_id,added_at) VALUES(?,?,?,?,?)").run(ce,'g-conway','test-conway-df','test-conway-volleyball-2026',now);

  await rebuildTeamRecord(env,'test-conway-volleyball-2026',now);
  const record=db.prepare("SELECT * FROM team_records WHERE team_id='test-conway-volleyball-2026'").get();
  assert.equal(record.wins,1);
  assert.equal(record.losses,0);
  assert.equal(record.conference_wins,1);
  assert.equal(record.conference_losses,0);
});
