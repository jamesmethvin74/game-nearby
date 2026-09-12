import test from "node:test";
import assert from "node:assert/strict";
import { buildCertifiedStatewideRows } from "../src/dragonfly-certified-statewide.js";
import { statewideSportConfig } from "../src/statewide-sport-config.js";

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

function basketballEvent({id,date,contestType=""}){
  return {
    eventId:id,
    date,
    contestType,
    associatedSports:[{code:"MBB",level:"Varsity"}],
    status:{name:"SCHEDULED"},
    participants:[
      {name:"Ouachita High School",orgShortCode:"U72RHS",isHome:true,team:{teamId:"ouachita-mbb",level:"Varsity",code:"MBB"}},
      {name:"Tuckerman High School",orgShortCode:"K4KHL3",isHome:false,team:{teamId:"tuckerman-mbb",level:"Varsity",code:"MBB"}}
    ]
  };
}

const mappings=[
  mapping("ouachita-mbb","aaa-u72rhs-boys-basketball-2026","ouachita-high-school"),
  mapping("tuckerman-mbb","aaa-k4khl3-boys-basketball-2026","tuckerman-high-school")
];

test("pre-November 5 DragonFly basketball stays visible but cannot count toward official record",()=>{
  const config=statewideSportConfig("MBB");
  assert.equal(config.firstOfficialContestDate,"2026-11-05");
  const payload={schedule:[basketballEvent({id:"preseason",date:"2026-10-30T23:00:00.000Z"})]};
  const rows=buildCertifiedStatewideRows(payload,mappings,config,{checkedAt:"2026-10-31T01:00:00.000Z"});

  assert.equal(rows.games.length,2,"preseason/benefit schedule entries remain visible");
  assert.equal(rows.canonicals.length,1);
  assert.deepEqual(rows.games.map(game=>game.counts_for_record),[0,0]);
});

test("November 5 and later DragonFly basketball counts normally",()=>{
  const config=statewideSportConfig("MBB");
  const payload={schedule:[basketballEvent({id:"opener",date:"2026-11-06T01:00:00.000Z"})]}; // Nov 5, 7 PM CST
  const rows=buildCertifiedStatewideRows(payload,mappings,config,{checkedAt:"2026-11-06T03:00:00.000Z"});

  assert.deepEqual(rows.games.map(game=>game.counts_for_record),[1,1]);
});

test("explicit exhibition remains non-counting even after the official basketball start",()=>{
  const config=statewideSportConfig("MBB");
  const payload={schedule:[basketballEvent({id:"exhibition",date:"2026-11-10T01:00:00.000Z",contestType:"Exhibition"})]};
  const rows=buildCertifiedStatewideRows(payload,mappings,config,{checkedAt:"2026-11-10T03:00:00.000Z"});

  assert.deepEqual(rows.games.map(game=>game.counts_for_record),[0,0]);
});
