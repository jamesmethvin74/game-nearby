import test from "node:test";
import assert from "node:assert/strict";
import { volleyballResultSnapshotChanged } from "../src/volleyball-live-results.js";
import { certifiedStatewideSignature } from "../src/dragonfly-certified-statewide.js";
import { statewideSportConfig } from "../src/statewide-sport-config.js";

const config=statewideSportConfig("volleyball-girls");
const payload={schedule:[{
  eventId:"event-1",date:"2026-09-03T23:00:00.000Z",associatedSports:[{code:"WVB",name:"Girls' Volleyball",level:"Varsity"}],
  participants:[
    {name:"Conway High School",orgShortCode:"HNHRP8",isHome:false,team:{teamId:"team-conway"},result:{code:"W",score:3,opponentScore:0}},
    {name:"Little Rock Southwest High School",orgShortCode:"BKC4UX",isHome:true,team:{teamId:"team-southwest"},result:{code:"L",score:0,opponentScore:3}}
  ]
}]};

test("live probe uses the certified statewide semantic signature",()=>{
  const signature=certifiedStatewideSignature(payload,config);
  const unchanged=volleyballResultSnapshotChanged(JSON.stringify({signature}),payload);
  assert.equal(unchanged.changed,false);
  assert.equal(unchanged.signature,signature);

  const changed=volleyballResultSnapshotChanged(JSON.stringify({signature:"old"}),payload);
  assert.equal(changed.changed,true);
});
