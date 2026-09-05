import test from "node:test";
import assert from "node:assert/strict";
import { normalizeHootensRows, expandedAlias } from "../src/hootens-statewide-results.js";
import { recoveryAlias, scheduleDateFromRows } from "../src/hootens-complete-results.js";
import { shouldRunHootensStatewideResults } from "../src/milestone2-scheduled-worker.js";
import { collectionPlanAt } from "../src/collection-cadence.js";

test("Hooten scoreboard rows keep only explicit finals",()=>{
  const rows=[
    {cells:["Conway","14","final Watch","20","Bentonville"],teamLinks:[{text:"Conway",href:"/teams/conway/"},{text:"Bentonville",href:"/teams/bentonville/"}]},
    {cells:["Quitman","42","ot","40","Bigelow"],teamLinks:[{text:"Quitman",href:"/teams/quitman/"},{text:"Bigelow",href:"/teams/bigelow/"}]},
    {cells:["Team A","","q1","","Team B"],teamLinks:[{text:"Team A",href:"/teams/a/"},{text:"Team B",href:"/teams/b/"}]}
  ];
  assert.deepEqual(normalizeHootensRows(rows),[{
    homeName:"Conway",awayName:"Bentonville",homeScore:14,awayScore:20,status:"FINAL",
    homeHref:"/teams/conway/",awayHref:"/teams/bentonville/",sourceEventKey:"hootens:conway:bentonville"
  }]);
});

test("Hooten scoreboard accepts score and status values supplied by form controls",()=>{
  const rows=[{
    cells:["Conway",""," Watch ","","Bentonville"],
    controls:[[],["14"],["final"],["20"],[]],
    teamLinks:[{text:"Conway",href:"/teams/conway/"},{text:"Bentonville",href:"/teams/bentonville/"}]
  }];
  assert.deepEqual(normalizeHootensRows(rows),[{
    homeName:"Conway",awayName:"Bentonville",homeScore:14,awayScore:20,status:"FINAL",
    homeHref:"/teams/conway/",awayHref:"/teams/bentonville/",sourceEventKey:"hootens:conway:bentonville"
  }]);
});

test("Hooten Arkansas abbreviations normalize to local school naming",()=>{
  assert.equal(expandedAlias("LR Central"),"little rock central");
  assert.equal(expandedAlias("FS Northside"),"fort smith northside");
  assert.equal(expandedAlias("Har-Ber (Springdale)"),"springdale har ber");
  assert.equal(expandedAlias("Heritage (Rogers)"),"rogers heritage");
  assert.equal(expandedAlias("Southside (Batesville)"),"batesville southside");
});

test("Hooten recovery normalizes the Fort Smith and Har-Ber identities that missed Week 1",()=>{
  assert.equal(recoveryAlias("Har-Ber (Springdale)"),"har ber");
  assert.equal(recoveryAlias("Springdale Har-Ber"),"har ber");
  assert.equal(recoveryAlias("FS Northside"),"fort smith northside");
  assert.equal(recoveryAlias("Fort Smith Southside"),"fort smith southside");
});

test("Hooten recovery uses the actual team-page schedule date instead of inventing a timestamp",()=>{
  const rows=[
    ["08/28","De Queen","7:00 PM","De Queen","W 55 - 49"],
    ["09/04","Mansfield","7:00 PM","Mansfield","—"],
    ["09/11","Central Arkansas Christian","7:00 PM","Mena","—"]
  ];
  assert.deepEqual(scheduleDateFromRows(rows,"Mansfield",new Date("2026-09-05T18:00:00Z")),{
    iso:"2026-09-04T12:00:00.000Z",
    deltaDays:1.25,
    index:1,
    locationText:"Mansfield"
  });
});

test("Hooten statewide collection runs on Friday result ticks and morning cleanup",()=>{
  assert.equal(shouldRunHootensStatewideResults({kind:"friday-football-results"}),true);
  assert.equal(shouldRunHootensStatewideResults({kind:"morning-results"}),true);
  assert.equal(shouldRunHootensStatewideResults({kind:"evening-results"}),false);
  assert.equal(shouldRunHootensStatewideResults({kind:"saturday-college-results"}),false);
});

test("Friday football result polling continues through 1 AM Saturday Central",()=>{
  assert.equal(collectionPlanAt(new Date("2026-09-05T05:30:00Z"))?.kind,"friday-football-results");
  assert.equal(collectionPlanAt(new Date("2026-09-05T06:00:00Z"))?.kind,"friday-football-results");
  assert.equal(collectionPlanAt(new Date("2026-09-05T06:30:00Z")),null);
});
