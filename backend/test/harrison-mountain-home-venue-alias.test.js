import test from "node:test";
import assert from "node:assert/strict";
import { detectEventConflicts, resolveCanonicalEvent } from "../src/schedule-authority-core.js";

const base={
  sport:"volleyball",gender:"girls",season:"2026",
  scheduled_at:"2026-08-25T22:30:00.000Z",scheduled_time_known:1,
  status:"FINAL"
};

const observations=[
  {
    ...base,id:"mh-df",source_id:"df-dxgr8r-volleyball-2026-dragonfly",source_event_key:"native:69b2c51d453393061a000000",
    parser_type:"dragonfly-public",source_type:"official-conference",authority_rank:10,
    reporting_school_id:"df-dxgr8r",reporting_school_name:"MOUNTAIN HOME HIGH SCHOOL",opponent_school_id:"df-ht8yyh",opponent:"HARRISON HIGH SCHOOL",
    home_away:"away",venue:"HARRISON HIGH SCHOOL",team_score:3,opponent_score:1
  },
  {
    ...base,id:"mh-df-statewide",source_id:"df-dxgr8r-volleyball-2026-dragonfly-statewide",source_event_key:"native:69b2c51d453393061a000000",
    parser_type:"dragonfly-public",source_type:"official-conference",authority_rank:10,
    reporting_school_id:"df-dxgr8r",reporting_school_name:"MOUNTAIN HOME HIGH SCHOOL",opponent_school_id:"df-ht8yyh",opponent:"HARRISON HIGH SCHOOL",
    home_away:"away",venue:"HARRISON HIGH SCHOOL",team_score:3,opponent_score:1
  },
  {
    ...base,id:"harrison-df",source_id:"df-ht8yyh-volleyball-2026-dragonfly",source_event_key:"native:69b2c51d453393061a000000",
    parser_type:"dragonfly-public",source_type:"official-conference",authority_rank:10,
    reporting_school_id:"df-ht8yyh",reporting_school_name:"HARRISON HIGH SCHOOL",opponent_school_id:"df-dxgr8r",opponent:"MOUNTAIN HOME HIGH SCHOOL",
    home_away:"home",venue:"HARRISON HIGH SCHOOL",team_score:1,opponent_score:3
  },
  {
    ...base,id:"harrison-df-statewide",source_id:"df-ht8yyh-volleyball-2026-dragonfly-statewide",source_event_key:"native:69b2c51d453393061a000000",
    parser_type:"dragonfly-public",source_type:"official-conference",authority_rank:10,
    reporting_school_id:"df-ht8yyh",reporting_school_name:"HARRISON HIGH SCHOOL",opponent_school_id:"df-dxgr8r",opponent:"MOUNTAIN HOME HIGH SCHOOL",
    home_away:"home",venue:"HARRISON HIGH SCHOOL",team_score:1,opponent_score:3
  },
  {
    ...base,id:"mh-mascot",source_id:"df-dxgr8r-volleyball-2026-official-school-results",source_event_key:"harrison-goblins|away|1",
    parser_type:"mascot-media",source_type:"official-school",authority_rank:20,
    reporting_school_id:"df-dxgr8r",reporting_school_name:"MOUNTAIN HOME HIGH SCHOOL",opponent_school_id:"df-ht8yyh",opponent:"Harrison Goblins",
    home_away:"away",venue:"Goblin Arena",team_score:3,opponent_score:1
  }
];

test("Harrison High School and Goblin Arena are the same verified home venue",()=>{
  const conflicts=detectEventConflicts(observations);
  assert.deepEqual(conflicts,[]);

  const canonical=resolveCanonicalEvent(observations);
  assert.equal(canonical.homeSchoolId,"df-ht8yyh");
  assert.equal(canonical.awaySchoolId,"df-dxgr8r");
  assert.equal(canonical.homeScore,1);
  assert.equal(canonical.awayScore,3);
  assert.equal(canonical.status,"FINAL");
  assert.equal(canonical.trustState,"CORROBORATED");
  assert.equal(canonical.conflicts.length,0);
});

test("a genuinely different venue still creates a VENUE conflict",()=>{
  const changed=observations.map(o=>({...o}));
  changed[4].venue="Bomber Gym";
  const conflicts=detectEventConflicts(changed);
  assert.equal(conflicts.some(conflict=>conflict.type==="VENUE"),true);
});
