import test from "node:test";
import assert from "node:assert/strict";
import { normalizeRankOneRows } from "../src/rankone-public.js";
import { isCollegeRuntimeParser } from "../src/college-source-runtime.js";

const source={
  season:"2026",
  timezone:"America/Chicago",
  home_venue:"Panther Stadium",
  home_latitude:34.5,
  home_longitude:-92.6
};

test("Rank One public parser supports modern football schedule rows with final scores",()=>{
  const [game]=normalizeRankOneRows([{
    cells:["Sep 4","7:00 PM","VS","Bentonville High School","Panther Stadium","L 14 - 20","","" ]
  }],{...source,sport:"football"});
  assert.equal(game.opponent,"Bentonville High School");
  assert.equal(game.homeAway,"home");
  assert.equal(game.venue,"Panther Stadium");
  assert.equal(game.status,"FINAL");
  assert.equal(game.teamScore,14);
  assert.equal(game.opponentScore,20);
  assert.equal(game.result,"L");
});

test("Rank One public parser supports away volleyball finals",()=>{
  const [game]=normalizeRankOneRows([{
    cells:["Sep 1","6:00 PM","@","Vilonia","Vilonia Arena","W 3 - 1","Conference"]
  }],{...source,sport:"volleyball"});
  assert.equal(game.opponent,"Vilonia");
  assert.equal(game.homeAway,"away");
  assert.equal(game.status,"FINAL");
  assert.equal(game.teamScore,3);
  assert.equal(game.opponentScore,1);
  assert.equal(game.result,"W");
});

test("Rank One public parser supports legacy combined relation rows",()=>{
  const [game]=normalizeRankOneRows([{
    cells:["Sep 4 7:00 PM","@ Bentonville","Non Conference","Tiger Stadium","","W 28 - 21"]
  }],{...source,sport:"football"});
  assert.equal(game.opponent,"Bentonville");
  assert.equal(game.homeAway,"away");
  assert.equal(game.venue,"Tiger Stadium");
  assert.equal(game.status,"FINAL");
  assert.equal(game.teamScore,28);
  assert.equal(game.opponentScore,21);
});

test("Rank One bare Score column is treated as a final school/opponent score pair",()=>{
  const [game]=normalizeRankOneRows([{
    cells:["Sep 4","7:00 PM","VS","Opponent High","Home Gym","54 - 41"]
  }],{...source,sport:"basketball"});
  assert.equal(game.status,"FINAL");
  assert.equal(game.teamScore,54);
  assert.equal(game.opponentScore,41);
  assert.equal(game.result,"W");
});

test("Rank One basketball January dates use the second calendar year",()=>{
  const [game]=normalizeRankOneRows([{
    cells:["Jan 12","7:00 PM","VS","Cabot","Home Gym","W 62 - 58"]
  }],{...source,sport:"basketball"});
  assert.match(game.scheduledAt,/^2027-01-13T01:00:00\.000Z$/);
});

test("rankone-public is registered with the external source runtime",()=>{
  assert.equal(isCollegeRuntimeParser("rankone-public"),true);
});
