import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { upsertResolvedObservation, reconcileResolvedObservation } from "../src/canonical-observation-writer.js";
import { applyAuditedSourceDefectSnapshot } from "../src/statewide-data-integrity-repair.js";
import { rebuildOneTruth } from "../src/one-truth.js";
import { PRESENTATION_SUPPRESSED_NOTE } from "../src/current-schedule-truth.js";

function d1FromSqlite(db){
  const prepare=sql=>{let args=[];return {
    bind(...next){args=next;return this;},
    async all(){return {results:db.prepare(sql).all(...args)};},
    async first(){return db.prepare(sql).get(...args)||null;},
    async run(){return db.prepare(sql).run(...args);}
  };};
  return {
    prepare,
    async batch(statements){
      const out=[];
      for(const statement of statements) out.push(await statement.run());
      return out;
    }
  };
}

function applyMigrations(db){
  const dir=fileURLToPath(new URL("../migrations/",import.meta.url));
  for(const file of fs.readdirSync(dir).filter(name=>name.endsWith(".sql")).sort()){
    db.exec(fs.readFileSync(`${dir}/${file}`,"utf8"));
  }
}

function insertSource(db,{id,teamId,sourceType,parserType,authorityRank,collectionMode,now}){
  db.prepare(`
    INSERT INTO sources(
      id,team_id,source_url,source_type,source_priority,parser_type,parser_version,timezone,
      expected_min_games,refresh_minutes,active_result_minutes,enabled,authority_rank,
      stale_after_minutes,collection_mode,updated_at
    ) VALUES(?,?,?,?,1,?,'1','America/Chicago',1,60,30,1,?,720,?,?)
  `).run(id,teamId,`https://example.test/${id}`,sourceType,parserType,authorityRank,collectionMode,now);
}

function observation(overrides={}){
  return {
    sourceEventKey:"van-buren|home|1",
    opponent:"Van Buren High School",
    scheduledAt:"2026-09-15T23:00:00.000Z",
    scheduledTimeKnown:true,
    venue:"Conway High School",
    locationText:"Conway, AR",
    latitude:null,
    longitude:null,
    homeAway:"home",
    conferenceGame:false,
    countsForRecord:true,
    status:"FINAL",
    teamScore:3,
    opponentScore:0,
    result:"W",
    notes:null,
    sourceUpdatedAt:"2026-09-16T01:00:00.000Z",
    ...overrides
  };
}

test("Conway/Van Buren final survives a later scheduled refresh and stale-twin suppression through records and ONE_TRUTH", async()=>{
  const db=new DatabaseSync(":memory:");
  applyMigrations(db);
  const env={DB:d1FromSqlite(db)};
  const now="2026-09-21T15:40:00.000Z";

  db.prepare("INSERT INTO schools(id,name,city,state,level,catalog_scope,updated_at) VALUES('conway','Conway High School','Conway','AR','high-school','local',?)").run(now);
  db.prepare("INSERT INTO schools(id,name,city,state,level,catalog_scope,updated_at) VALUES('van-buren','Van Buren High School','Van Buren','AR','high-school','opponent-only',?)").run(now);
  db.prepare("INSERT INTO teams(id,school_id,sport,gender,season,active,updated_at) VALUES('conway-volleyball-2026','conway','volleyball','girls','2026',1,?)").run(now);

  insertSource(db,{
    id:"conway-volleyball-official",
    teamId:"conway-volleyball-2026",
    sourceType:"official-school",
    parserType:"mascot-media",
    authorityRank:5,
    collectionMode:"team",
    now
  });
  insertSource(db,{
    id:"conway-volleyball-2026-dragonfly-statewide",
    teamId:"conway-volleyball-2026",
    sourceType:"official-conference",
    parserType:"dragonfly-public",
    authorityRank:10,
    collectionMode:"statewide",
    now
  });

  const official={id:"conway-volleyball-official",team_id:"conway-volleyball-2026",source_url:"https://example.test/conway"};
  const statewide={id:"conway-volleyball-2026-dragonfly-statewide",team_id:"conway-volleyball-2026",source_url:"https://example.test/dragonfly"};

  const finalId=await upsertResolvedObservation(env,official,observation(),now,{opponentSchoolId:"van-buren"});
  const initialCanonical=await reconcileResolvedObservation(env,finalId);
  assert.ok(initialCanonical,"initial scored final should canonicalize");

  await upsertResolvedObservation(env,official,observation({
    status:"SCHEDULED",
    teamScore:null,
    opponentScore:null,
    result:null,
    sourceUpdatedAt:"2026-09-21T15:30:00.000Z"
  }),now,{opponentSchoolId:"van-buren"});
  const afterRefresh=await reconcileResolvedObservation(env,finalId);
  assert.equal(afterRefresh,initialCanonical);

  const preserved=db.prepare("SELECT status,team_score,opponent_score,result FROM games WHERE id=?").get(finalId);
  assert.deepEqual(
    {status:preserved.status,team_score:preserved.team_score,opponent_score:preserved.opponent_score,result:preserved.result},
    {status:"FINAL",team_score:3,opponent_score:0,result:"W"}
  );
  const canonical=db.prepare("SELECT status,home_score,away_score FROM canonical_events WHERE id=?").get(initialCanonical);
  assert.deepEqual(
    {status:canonical.status,home_score:canonical.home_score,away_score:canonical.away_score},
    {status:"FINAL",home_score:3,away_score:0}
  );

  const staleId=await upsertResolvedObservation(env,statewide,observation({
    sourceEventKey:"native:van-buren-stale",
    status:"SCHEDULED",
    teamScore:null,
    opponentScore:null,
    result:null,
    sourceUpdatedAt:"2026-09-21T15:35:00.000Z"
  }),now,{opponentSchoolId:"van-buren"});
  const staleCanonical=await reconcileResolvedObservation(env,staleId);
  assert.equal(staleCanonical,initialCanonical);

  const audit={issues:[{
    code:"STALE_NONTERMINAL_TWIN_OF_FINAL",
    severity:"blocking",
    team_id:"conway-volleyball-2026",
    school_id:"conway",
    sport:"volleyball",
    gender:"girls",
    season:"2026",
    game_id:staleId,
    other_game_id:finalId,
    canonical_event_id:initialCanonical,
    other_canonical_event_id:initialCanonical,
    opponent:"Van Buren High School",
    scheduled_at:"2026-09-15T23:00:00.000Z",
    surface:"source-observation"
  }]};

  const repair=await applyAuditedSourceDefectSnapshot(env,audit,{now:new Date(now)});
  assert.equal(repair.suppression.game_ids.includes(staleId),true);
  const staleNotes=db.prepare("SELECT notes FROM games WHERE id=?").get(staleId)?.notes||"";
  assert.equal(staleNotes.includes(PRESENTATION_SUPPRESSED_NOTE),true);

  const record=db.prepare("SELECT wins,losses,ties FROM team_records WHERE team_id='conway-volleyball-2026'").get();
  assert.deepEqual(
    {wins:record.wins,losses:record.losses,ties:record.ties},
    {wins:1,losses:0,ties:0}
  );

  await rebuildOneTruth(env,{season:"2026",teamIds:["conway-volleyball-2026"]});
  const truthTeam=db.prepare("SELECT overall_record,overall_wins,overall_losses FROM ONE_TRUTH_TB WHERE truth_id='TEAM:conway-volleyball-2026'").get();
  assert.deepEqual(
    {overall_record:truthTeam.overall_record,overall_wins:truthTeam.overall_wins,overall_losses:truthTeam.overall_losses},
    {overall_record:"1-0",overall_wins:1,overall_losses:0}
  );
  const truthGame=db.prepare("SELECT canonical_event_id,status,team_score,opponent_score,counts_for_record FROM ONE_TRUTH_TB WHERE row_type='GAME' AND team_id='conway-volleyball-2026' AND canonical_event_id=?").get(initialCanonical);
  assert.ok(truthGame,"Van Buren final should remain in ONE_TRUTH");
  assert.deepEqual(
    {status:truthGame.status,team_score:truthGame.team_score,opponent_score:truthGame.opponent_score,counts_for_record:truthGame.counts_for_record},
    {status:"FINAL",team_score:3,opponent_score:0,counts_for_record:1}
  );
});
