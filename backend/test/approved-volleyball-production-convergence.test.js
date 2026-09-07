import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  runApprovedVolleyballProductionConvergence,
  STATE_ID,
  CONWAY_TEAM,
  SOUTHWEST_TEAM,
  FLIPPIN_TEAM,
  CONWAY_SOURCE,
  SIX_A_CENTRAL_SOURCE_URL,
  HISTORICAL_DATES
} from "../src/approved-volleyball-production-convergence.js";

function d1FromSqlite(db){
  const prepare=sql=>{let args=[];return {
    bind(...next){args=next;return this;},
    async all(){return {results:db.prepare(sql).all(...args)};},
    async first(){return db.prepare(sql).get(...args)||null;},
    async run(){return db.prepare(sql).run(...args);}
  }};
  return {prepare,async batch(statements){const out=[];for(const statement of statements) out.push(await statement.run());return out;}};
}

function seed(db){
  db.exec(`
    CREATE TABLE statewide_collection_state(
      id TEXT PRIMARY KEY,provider TEXT NOT NULL,feed_url TEXT NOT NULL,
      last_checked_at TEXT,last_successful_fetch_at TEXT,last_event_count INTEGER NOT NULL DEFAULT 0,
      last_observation_count INTEGER NOT NULL DEFAULT 0,last_source_count INTEGER NOT NULL DEFAULT 0,
      consecutive_failures INTEGER NOT NULL DEFAULT 0,last_error TEXT,details_json TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE teams(id TEXT PRIMARY KEY,conference_id TEXT);
    CREATE TABLE team_records(
      team_id TEXT PRIMARY KEY,wins INTEGER,losses INTEGER,ties INTEGER,
      conference_wins INTEGER,conference_losses INTEGER,conference_ties INTEGER
    );
    CREATE TABLE games(
      id TEXT PRIMARY KEY,team_id TEXT,status TEXT,opponent TEXT,
      team_score INTEGER,opponent_score INTEGER,result TEXT
    );
  `);
  for(const id of [CONWAY_TEAM,SOUTHWEST_TEAM,FLIPPIN_TEAM]) db.prepare("INSERT INTO teams(id,conference_id) VALUES(?,NULL)").run(id);
  db.prepare("UPDATE teams SET conference_id='6a-central-volleyball' WHERE id=?").run(CONWAY_TEAM);
  db.prepare("INSERT INTO team_records VALUES(?,?,?,?,?,?,?)").run(CONWAY_TEAM,4,5,0,0,0,0);
  db.prepare("INSERT INTO team_records VALUES(?,?,?,?,?,?,?)").run(SOUTHWEST_TEAM,1,3,0,0,0,0);
  db.prepare("INSERT INTO team_records VALUES(?,?,?,?,?,?,?)").run(FLIPPIN_TEAM,3,1,0,0,0,0);
  db.prepare("INSERT INTO games VALUES('conway-lrc',?,'FINAL','Little Rock Christian Early Bird Invitational',1,2,'W')").run(CONWAY_TEAM);
}

function successfulMembership(db,calls){
  return async(_env,options)=>{
    calls.push(["membership",options]);
    assert.deepEqual(options.conferenceIds,["6a-central"]);
    assert.deepEqual(options.targetTeamIds,[SOUTHWEST_TEAM]);
    assert.equal(options.conferenceSourceOverrides["6a-central"].source_url,SIX_A_CENTRAL_SOURCE_URL);
    db.prepare("UPDATE teams SET conference_id='6a-central-volleyball' WHERE id=?").run(SOUTHWEST_TEAM);
    return {status:"SUCCESS",assignments:1,conferenceWrites:1,teamWrites:1};
  };
}

function successfulFallback(db,calls){
  return async(_env,options)=>{
    calls.push(["fallback",options]);
    assert.deepEqual(options.dates,HISTORICAL_DATES);
    assert.deepEqual(options.targetTeamIds,[FLIPPIN_TEAM]);
    db.prepare("INSERT OR REPLACE INTO games VALUES('flippin-bergman',?,'FINAL','Bergman High School',3,2,'W')").run(FLIPPIN_TEAM);
    db.prepare("INSERT OR REPLACE INTO games VALUES('flippin-cotter',?,'FINAL','Cotter High School',0,2,'L')").run(FLIPPIN_TEAM);
    return {status:"SUCCESS",dates:HISTORICAL_DATES,matchedFinals:2,touchedTeams:3,writes:6};
  };
}

function successfulRebuild(db,calls){
  return async(_env,teamIds)=>{
    calls.push(["rebuild",teamIds]);
    assert.deepEqual(teamIds,[CONWAY_TEAM,SOUTHWEST_TEAM,FLIPPIN_TEAM]);
    db.prepare("UPDATE team_records SET wins=5,losses=4,ties=0,conference_wins=1,conference_losses=0,conference_ties=0 WHERE team_id=?").run(CONWAY_TEAM);
    db.prepare("UPDATE team_records SET wins=1,losses=3,ties=0,conference_wins=0,conference_losses=1,conference_ties=0 WHERE team_id=?").run(SOUTHWEST_TEAM);
    db.prepare("UPDATE team_records SET wins=4,losses=2,ties=0,conference_wins=0,conference_losses=0,conference_ties=0 WHERE team_id=?").run(FLIPPIN_TEAM);
    return {teams:3,scoredFinals:19,standings:{cohorts:1,standingsRows:2}};
  };
}

test("approved production convergence is tightly scoped, proves exact records/finals, then becomes a no-op",async()=>{
  const db=new DatabaseSync(":memory:");
  seed(db);
  const env={DB:d1FromSqlite(db)};
  const calls=[];

  const result=await runApprovedVolleyballProductionConvergence(env,{
    now:new Date("2026-09-07T22:00:00.000Z"),
    refreshSourceIds:async(sourceIds,reason)=>{
      calls.push(["refresh",sourceIds,reason]);
      assert.deepEqual(sourceIds,[CONWAY_SOURCE]);
      db.prepare("UPDATE games SET team_score=2,opponent_score=1,result='W' WHERE id='conway-lrc'").run();
      return {outcomes:[{sourceId:CONWAY_SOURCE,status:"SUCCESS"}]};
    },
    membershipSync:successfulMembership(db,calls),
    resultFallback:successfulFallback(db,calls),
    rebuildRecords:successfulRebuild(db,calls)
  });

  assert.equal(result.status,"COMPLETE");
  assert.equal(result.checks.conwayOverall,true);
  assert.equal(result.checks.conwayConference,true);
  assert.equal(result.checks.southwestConference,true);
  assert.equal(result.checks.flippinOverall,true);
  assert.equal(result.checks.conwayLrChristian,true);
  assert.equal(result.checks.flippinBergman,true);
  assert.equal(result.checks.flippinCotter,true);
  assert.deepEqual(calls.map(call=>call[0]),["refresh","membership","fallback","rebuild"]);

  const marker=db.prepare("SELECT * FROM statewide_collection_state WHERE id=?").get(STATE_ID);
  assert.ok(marker?.last_successful_fetch_at);
  assert.equal(JSON.parse(marker.details_json).status,"COMPLETE");

  const second=await runApprovedVolleyballProductionConvergence(env,{
    now:new Date("2026-09-07T22:30:00.000Z"),
    refreshSourceIds:async()=>{throw new Error("completed convergence must not refresh")},
    membershipSync:async()=>{throw new Error("completed convergence must not sync membership")},
    resultFallback:async()=>{throw new Error("completed convergence must not fetch results")},
    rebuildRecords:async()=>{throw new Error("completed convergence must not rebuild")}
  });
  assert.equal(second.status,"ALREADY_COMPLETE");
});

test("retry skips Conway once production already has the corrected 5-4 record and 2-1 final",async()=>{
  const db=new DatabaseSync(":memory:");
  seed(db);
  const env={DB:d1FromSqlite(db)};
  const calls=[];
  db.prepare("UPDATE games SET team_score=2,opponent_score=1,result='W' WHERE id='conway-lrc'").run();
  db.prepare("UPDATE team_records SET wins=5,losses=4 WHERE team_id=?").run(CONWAY_TEAM);

  const result=await runApprovedVolleyballProductionConvergence(env,{
    now:new Date("2026-09-07T22:30:00.000Z"),
    refreshSourceIds:async()=>{throw new Error("Conway is already fixed and must not refresh")},
    membershipSync:successfulMembership(db,calls),
    resultFallback:successfulFallback(db,calls),
    rebuildRecords:successfulRebuild(db,calls)
  });

  assert.equal(result.status,"COMPLETE");
  assert.equal(result.beforeChecks.conwayOverall,true);
  assert.equal(result.beforeChecks.conwayLrChristian,true);
  assert.equal(result.officialRefresh.status,"SKIPPED_ALREADY_FIXED");
  assert.deepEqual(calls.map(call=>call[0]),["membership","fallback","rebuild"]);
});
