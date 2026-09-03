import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import {
  STATEWIDE_HIGH_SCHOOL_SPORTS,
  statewideSportConfig
} from "../src/statewide-sport-config.js";
import {
  buildCertifiedStatewideRows,
  certifiedStatewideSignature
} from "../src/dragonfly-certified-statewide.js";
import { discoverCertifiedSportParticipants } from "../src/dragonfly-certified-sport-catalog.js";

const checkedAt="2026-09-03T20:00:00.000Z";

function mapping(externalTeamId,teamId,schoolId){
  return {
    external_team_id:externalTeamId,
    source_id:`${teamId}-dragonfly-statewide`,
    source_url:"https://example.test/statewide",
    team_id:teamId,
    school_id:schoolId,
    school_name:schoolId,
    latitude:35.0,
    longitude:-92.0
  };
}

function event({id="event-1",code="MFB",date="2026-09-04T00:00:00.000Z",home,away,status="FINAL"}){
  return {
    eventId:id,
    date,
    associatedSports:[{code,level:"Varsity"}],
    status:{name:status},
    participants:[
      {name:home.name,orgShortCode:home.org,isHome:true,team:{teamId:home.teamId,level:"Varsity",code},result:home.result},
      {name:away.name,orgShortCode:away.org,isHome:false,team:{teamId:away.teamId,level:"Varsity",code},result:away.result}
    ]
  };
}

test("Milestone 2 uses the six verified Arkansas DragonFly varsity feeds",()=>{
  assert.deepEqual(STATEWIDE_HIGH_SCHOOL_SPORTS.map(item=>[item.teamCode,item.feedCode,item.providerSportCode]),[
    ["FB","MFB_Varsity","MFB"],
    ["MBB","MBB_Varsity","MBB"],
    ["WBB","WBB_Varsity","WBB"],
    ["MSO","MSO_Varsity","MSO"],
    ["WSO","WSO_Varsity","WSO"],
    ["WVB","WVB_Varsity","WVB"]
  ]);
  assert.equal(new Set(STATEWIDE_HIGH_SCHOOL_SPORTS.map(item=>item.feedUrl)).size,6);
});

test("football feed builds reciprocal observations and a football canonical event",()=>{
  const config=statewideSportConfig("FB");
  const payload={timestamp:checkedAt,schedule:[event({
    code:"MFB",
    home:{name:"Conway High School",org:"A",teamId:"conway-fb",result:{score:28,opponentScore:14,code:"W"}},
    away:{name:"Bryant High School",org:"B",teamId:"bryant-fb",result:{score:14,opponentScore:28,code:"L"}}
  })]};
  const rows=buildCertifiedStatewideRows(payload,[
    mapping("conway-fb","conway-football-2026","conway"),
    mapping("bryant-fb","bryant-football-2026","bryant")
  ],config,{checkedAt});

  assert.equal(rows.games.length,2);
  assert.equal(rows.canonicals.length,1);
  assert.equal(rows.members.length,2);
  assert.equal(rows.canonicals[0].sport,"football");
  assert.equal(rows.canonicals[0].gender,"boys");
  assert.match(rows.canonicals[0].id,/^ce:football:boys:2026:/);
  assert.deepEqual(new Set(rows.touchedTeamIds),new Set(["conway-football-2026","bryant-football-2026"]));
});

test("certified Arkansas schedules retain games against an unmapped out-of-state opponent",()=>{
  const config=statewideSportConfig("MBB");
  const payload={timestamp:checkedAt,schedule:[event({
    code:"MBB",
    home:{name:"Arkansas School",org:"ARKAAA",teamId:"ark-mbb",result:{score:71,opponentScore:68,code:"W"}},
    away:{name:"Memphis Prep",org:"TN123",teamId:"tn-mbb",result:{score:68,opponentScore:71,code:"L"}}
  })]};
  const rows=buildCertifiedStatewideRows(payload,[mapping("ark-mbb","ark-basketball-boys-2026","ark-school")],config,{checkedAt});

  assert.equal(rows.games.length,1);
  assert.equal(rows.canonicals.length,0);
  assert.equal(rows.members.length,0);
  assert.equal(rows.externalOpponentObservations,1);
  assert.equal(rows.games[0].opponent,"Memphis Prep");
  assert.equal(rows.games[0].opponent_school_id,null);
  assert.equal(rows.games[0].canonical_event_id,null);
  assert.equal(rows.games[0].status,"FINAL");
  assert.equal(rows.games[0].team_score,71);
  assert.equal(rows.games[0].opponent_score,68);
  assert.equal(rows.games[0].result,"W");
});

test("sport discovery only accepts the configured varsity sport",()=>{
  const payload={schedule:[
    event({id:"mbb",code:"MBB",home:{name:"A",org:"AAA",teamId:"a-mbb"},away:{name:"B",org:"BBB",teamId:"b-mbb"},status:"SCHEDULED"}),
    event({id:"wbb",code:"WBB",home:{name:"A",org:"AAA",teamId:"a-wbb"},away:{name:"B",org:"BBB",teamId:"b-wbb"},status:"SCHEDULED"})
  ]};
  const entries=discoverCertifiedSportParticipants(payload,"MBB");
  assert.deepEqual(entries.map(item=>item.externalTeamId).sort(),["a-mbb","b-mbb"]);
});

test("statewide signature is sport-scoped and ignores feed timestamp churn",()=>{
  const payload={timestamp:"2026-01-01",schedule:[event({
    code:"WSO",
    home:{name:"A",org:"AAA",teamId:"a",result:{score:2}},
    away:{name:"B",org:"BBB",teamId:"b",result:{score:1}}
  })]};
  const same=structuredClone(payload);
  same.timestamp="2099-01-01";
  assert.equal(certifiedStatewideSignature(payload,"WSO"),certifiedStatewideSignature(same,"WSO"));
  assert.notEqual(certifiedStatewideSignature(payload,"WSO"),certifiedStatewideSignature(payload,"MSO"));
});

test("multisport collection uses touched-team record rebuild instead of statewide rebuild",()=>{
  const source=fs.readFileSync(fileURLToPath(new URL("../src/dragonfly-certified-statewide.js",import.meta.url)),"utf8");
  assert.match(source,/rebuildTeamRecords\(env,rows\.touchedTeamIds,checkedAt\)/);
  assert.doesNotMatch(source,/rebuildStatewideRecords/);
  assert.match(source,/source_id IN \(SELECT value FROM json_each\(\?\)\)/);
});
