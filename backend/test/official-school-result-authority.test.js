import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMascotRows } from "../src/parser-core.js";
import { resolveCanonicalEvent } from "../src/schedule-authority-core.js";

const source={
  season:"2026",
  timezone:"America/Chicago",
  home_venue:"John McConnell Stadium",
  home_latitude:35.0872,
  home_longitude:-92.4628
};

test("Mascot Media schedule rows normalize final football and volleyball results",()=>{
  const football=normalizeMascotRows([{
    cells:["Aug 28 / 7:00 PM","Capital High School (MO)","John McConnell Stadium Conway, AR","W 45 - 7"]
  }],{...source,sport:"football"})[0];
  assert.equal(football.opponent,"Capital High School (MO)");
  assert.equal(football.status,"FINAL");
  assert.equal(football.teamScore,45);
  assert.equal(football.opponentScore,7);
  assert.equal(football.result,"W");

  const volleyball=normalizeMascotRows([{
    cells:["Aug 25 | 4:30 PM @ Vilonia","Vilonia","W 3 - 0"]
  }],{...source,sport:"volleyball",home_venue:"Greenbrier High School"})[0];
  assert.equal(volleyball.opponent,"Vilonia");
  assert.equal(volleyball.status,"FINAL");
  assert.equal(volleyball.teamScore,3);
  assert.equal(volleyball.opponentScore,0);
  assert.equal(volleyball.homeAway,"away");
});

test("Mascot basketball January results roll into the second calendar year of the season",()=>{
  const basketball=normalizeMascotRows([{
    cells:["Jan 12 | 7:00 PM","Cabot","W 62 - 58"]
  }],{...source,sport:"basketball",home_venue:"Buzz Bolding Arena"})[0];
  assert.equal(basketball.status,"FINAL");
  assert.equal(basketball.teamScore,62);
  assert.equal(basketball.opponentScore,58);
  assert.match(basketball.scheduledAt,/^2027-01-13T01:00:00\.000Z$/);
});

test("official school final result promotes canonical status while DragonFly keeps schedule authority",()=>{
  const common={
    sport:"football",gender:"boys",season:"2026",
    reporting_school_id:"conway",opponent_school_id:"bentonville",
    scheduled_at:"2026-09-05T00:00:00.000Z",scheduled_time_known:1,
    home_away:"home",venue:"John McConnell Stadium"
  };
  const dragonfly={
    ...common,id:"df",source_id:"conway-football-dragonfly",
    source_type:"official-conference",parser_type:"dragonfly-public",authority_rank:10,
    source_event_key:"native:abc123",status:"SCHEDULED",team_score:null,opponent_score:null
  };
  const school={
    ...common,id:"school",source_id:"conway-football-official",
    source_type:"official-school",parser_type:"mascot-media",authority_rank:20,
    source_event_key:"bentonville|home|1",status:"FINAL",team_score:14,opponent_score:20
  };

  const event=resolveCanonicalEvent([dragonfly,school]);
  assert.equal(event.selectedSourceId,"conway-football-dragonfly");
  assert.equal(event.scheduledAt,dragonfly.scheduled_at);
  assert.equal(event.status,"FINAL");
  assert.equal(event.homeScore,14);
  assert.equal(event.awayScore,20);
  assert.equal(event.resolutionEvidence.scoreObservationId,"school");
});
