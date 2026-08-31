import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { catalogAmbiguities, discoverDragonFlyVarsityVolleyballTeams } from "../src/dragonfly-discovery.js";

const fixture=fileURLToPath(new URL("./fixtures/dragonfly-greenbrier-vilonia-2026.json",import.meta.url));

test("discovers stable DragonFly school and team identities from schedule participants",()=>{
  const payload=JSON.parse(fs.readFileSync(fixture,"utf8"));
  const entries=discoverDragonFlyVarsityVolleyballTeams(payload);
  assert.equal(entries.length,2);
  const greenbrier=entries.find(e=>e.orgShortCode==="SE48QJ");
  const vilonia=entries.find(e=>e.orgShortCode==="YF5Y8Q");
  assert.equal(greenbrier.schoolName,"GREENBRIER HIGH SCHOOL");
  assert.equal(greenbrier.teamId,"695c155dbb8c2087231e7e45");
  assert.equal(greenbrier.teamCode,"WVB:695c155dbb8c2087231e7e45");
  assert.equal(greenbrier.eventCount,1);
  assert.equal(vilonia.teamId,"698a49819bbf0a84a92470a1");
  assert.equal(catalogAmbiguities(entries).size,0);
});

test("counts repeated appearances without duplicating a discovered team",()=>{
  const payload=JSON.parse(fs.readFileSync(fixture,"utf8"));
  payload.schedule.push({...payload.schedule[0],eventId:"second-game"});
  const entries=discoverDragonFlyVarsityVolleyballTeams(payload);
  assert.equal(entries.length,2);
  assert.equal(entries.find(e=>e.orgShortCode==="SE48QJ").eventCount,2);
  assert.equal(entries.find(e=>e.orgShortCode==="YF5Y8Q").eventCount,2);
});

test("flags same normalized school name with different DragonFly organizations as ambiguous",()=>{
  const payload={schedule:[
    {associatedSports:[{code:"WVB",level:"Varsity"}],participants:[
      {name:"Central High School",orgShortCode:"AAA111",team:{teamId:"team-a",code:"WVB:team-a",level:"Varsity"}},
      {name:"North High School",orgShortCode:"NORTH1",team:{teamId:"team-n",code:"WVB:team-n",level:"Varsity"}}
    ]},
    {associatedSports:[{code:"WVB",level:"Varsity"}],participants:[
      {name:"Central High School",orgShortCode:"BBB222",team:{teamId:"team-b",code:"WVB:team-b",level:"Varsity"}},
      {name:"South High School",orgShortCode:"SOUTH1",team:{teamId:"team-s",code:"WVB:team-s",level:"Varsity"}}
    ]}
  ]};
  const entries=discoverDragonFlyVarsityVolleyballTeams(payload);
  const ambiguous=catalogAmbiguities(entries);
  assert.equal(entries.length,4);
  assert.equal(ambiguous.has("central"),true);
  assert.equal(ambiguous.size,1);
});

test("ignores placeholders, non-varsity participants and unrelated sports",()=>{
  const payload={schedule:[
    {associatedSports:[{code:"WVB",level:"Varsity"}],participants:[
      {name:"Varsity High School",orgShortCode:"VAR001",team:{teamId:"varsity",code:"WVB:varsity",level:"Varsity"}},
      {name:"JV High School",orgShortCode:"JV0001",team:{teamId:"jv",code:"WVB:jv",level:"JV"}},
      {name:"TBD",orgShortCode:"TBD001",team:{teamId:"tbd",code:"WVB:tbd",level:"Varsity"}}
    ]},
    {associatedSports:[{code:"FB",level:"Varsity"}],participants:[
      {name:"Football High School",orgShortCode:"FB0001",team:{teamId:"football",code:"FB:football",level:"Varsity"}}
    ]}
  ]};
  const entries=discoverDragonFlyVarsityVolleyballTeams(payload);
  assert.deepEqual(entries.map(e=>e.orgShortCode),["VAR001"]);
});
