import test from "node:test";
import assert from "node:assert/strict";
import { normalizeHootensRows, expandedAlias } from "../src/hootens-statewide-results.js";
import { shouldRunHootensStatewideResults } from "../src/milestone2-scheduled-worker.js";

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

test("Hooten statewide collection runs on Friday result ticks and morning cleanup",()=>{
  assert.equal(shouldRunHootensStatewideResults({kind:"friday-football-results"}),true);
  assert.equal(shouldRunHootensStatewideResults({kind:"morning-results"}),true);
  assert.equal(shouldRunHootensStatewideResults({kind:"evening-results"}),false);
  assert.equal(shouldRunHootensStatewideResults({kind:"saturday-college-results"}),false);
});
