import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  runApprovedVolleyballProductionConvergence,
  STATE_ID, CONWAY_TEAM, SOUTHWEST_TEAM, FLIPPIN_TEAM, MELBOURNE_TEAM,
  CONWAY_SOURCE, SIX_A_CENTRAL_SOURCE_URL, THREE_A_TWO_SOURCE_URL,
  THREE_A_TWO_TEAMS, TARGET_TEAMS, HISTORICAL_DATES
} from "../src/approved-volleyball-production-convergence.js";

function d1(db){const prepare=sql=>{let args=[];return{bind(...v){args=v;return this},async all(){return{results:db.prepare(sql).all(...args)}},async first(){return db.prepare(sql).get(...args)||null},async run(){return db.prepare(sql).run(...args)}}};return{prepare,async batch(xs){const out=[];for(const x of xs)out.push(await x.run());return out}}}
function seed(db){
  db.exec(`CREATE TABLE statewide_collection_state(id TEXT PRIMARY KEY,provider TEXT NOT NULL,feed_url TEXT NOT NULL,last_checked_at TEXT,last_successful_fetch_at TEXT,last_event_count INTEGER NOT NULL DEFAULT 0,last_observation_count INTEGER NOT NULL DEFAULT 0,last_source_count INTEGER NOT NULL DEFAULT 0,consecutive_failures INTEGER NOT NULL DEFAULT 0,last_error TEXT,details_json TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);CREATE TABLE teams(id TEXT PRIMARY KEY,conference_id TEXT);CREATE TABLE team_records(team_id TEXT PRIMARY KEY,wins INTEGER,losses INTEGER,ties INTEGER,conference_wins INTEGER,conference_losses INTEGER,conference_ties INTEGER);CREATE TABLE games(id TEXT PRIMARY KEY,team_id TEXT,status TEXT,opponent TEXT,team_score INTEGER,opponent_score INTEGER,result TEXT);`);
  for(const id of TARGET_TEAMS) db.prepare("INSERT INTO teams VALUES(?,NULL)").run(id);
  db.prepare("UPDATE teams SET conference_id='6a-central-volleyball' WHERE id=?").run(CONWAY_TEAM);
  const record=(id,w,l,cw=0,cl=0)=>db.prepare("INSERT INTO team_records VALUES(?,?,?,?,?,?,?)").run(id,w,l,0,cw,cl,0);
  record(CONWAY_TEAM,5,4); record(SOUTHWEST_TEAM,1,3); record(FLIPPIN_TEAM,3,1); record(MELBOURNE_TEAM,3,1);
  for(const id of THREE_A_TWO_TEAMS.filter(id=>![FLIPPIN_TEAM,MELBOURNE_TEAM].includes(id))) record(id,0,0);
  db.prepare("INSERT INTO games VALUES('conway-lrc',?,'FINAL','Little Rock Christian Early Bird Invitational',2,1,'W')").run(CONWAY_TEAM);
}

test("retry skips fixed Conway, scopes 6A Central plus seven 3A-2 teams, repairs Flippin and proves records",async()=>{
  const db=new DatabaseSync(":memory:"); seed(db); const calls=[]; const env={DB:d1(db)};
  const membershipSync=async(_env,o)=>{
    calls.push(["membership",o]);
    if(o.conferenceIds[0]==='6a-central'){
      assert.deepEqual(o.targetTeamIds,[SOUTHWEST_TEAM]);
      assert.equal(o.conferenceSourceOverrides['6a-central'].source_url,SIX_A_CENTRAL_SOURCE_URL);
      db.prepare("UPDATE teams SET conference_id='6a-central-volleyball' WHERE id=?").run(SOUTHWEST_TEAM);
      return {status:'SUCCESS',assignments:1,conferenceWrites:1,teamWrites:1};
    }
    assert.deepEqual(o.conferenceIds,['3a-2']);
    assert.deepEqual(o.targetTeamIds,THREE_A_TWO_TEAMS);
    assert.equal(o.conferenceSourceOverrides['3a-2'].source_url,THREE_A_TWO_SOURCE_URL);
    for(const id of THREE_A_TWO_TEAMS) db.prepare("UPDATE teams SET conference_id='3a-2-volleyball' WHERE id=?").run(id);
    return {status:'SUCCESS',assignments:7,conferenceWrites:1,teamWrites:7};
  };
  const result=await runApprovedVolleyballProductionConvergence(env,{
    now:new Date('2026-09-07T22:30:00.000Z'),
    refreshSourceIds:async()=>{throw new Error('Conway already fixed')},
    membershipSync,
    resultFallback:async(_env,o)=>{calls.push(['fallback',o]);assert.deepEqual(o.dates,HISTORICAL_DATES);assert.deepEqual(o.targetTeamIds,[FLIPPIN_TEAM]);db.prepare("INSERT INTO games VALUES('fb',?,'FINAL','Bergman High School',3,2,'W')").run(FLIPPIN_TEAM);db.prepare("INSERT INTO games VALUES('fc',?,'FINAL','Cotter High School',0,2,'L')").run(FLIPPIN_TEAM);return{status:'SUCCESS',dates:HISTORICAL_DATES,matchedFinals:2,touchedTeams:3,writes:6}},
    rebuildRecords:async(_env,ids)=>{calls.push(['rebuild',ids]);assert.deepEqual(ids,TARGET_TEAMS);db.prepare("UPDATE team_records SET conference_wins=1 WHERE team_id=?").run(CONWAY_TEAM);db.prepare("UPDATE team_records SET conference_losses=1 WHERE team_id=?").run(SOUTHWEST_TEAM);db.prepare("UPDATE team_records SET wins=4,losses=2,conference_wins=3,conference_losses=0 WHERE team_id=?").run(FLIPPIN_TEAM);db.prepare("UPDATE team_records SET wins=3,losses=1,conference_wins=2,conference_losses=1 WHERE team_id=?").run(MELBOURNE_TEAM);return{teams:TARGET_TEAMS.length}}
  });
  assert.equal(result.status,'COMPLETE');
  assert.ok(Object.values(result.checks).every(Boolean));
  assert.equal(result.officialRefresh.status,'SKIPPED_ALREADY_FIXED');
  assert.deepEqual(calls.map(x=>x[0]),['membership','membership','fallback','rebuild']);
  assert.ok(db.prepare("SELECT last_successful_fetch_at FROM statewide_collection_state WHERE id=?").get(STATE_ID).last_successful_fetch_at);
  const second=await runApprovedVolleyballProductionConvergence(env,{now:new Date('2026-09-07T23:00:00.000Z'),refreshSourceIds:async()=>{throw new Error('no-op')},membershipSync:async()=>{throw new Error('no-op')},resultFallback:async()=>{throw new Error('no-op')},rebuildRecords:async()=>{throw new Error('no-op')}});
  assert.equal(second.status,'ALREADY_COMPLETE');
});
