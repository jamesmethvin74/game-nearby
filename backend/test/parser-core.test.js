import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSidearmRows, normalizeMascotRows, parseResult } from "../src/parser-core.js";

const source={season:"2026",timezone:"America/Chicago",home_venue:"Bill Stephens Track/Soccer Complex",home_latitude:35.0767,home_longitude:-92.4545};

test("parses real UCA-style final tie and derives score",()=>{
  const rows=[{date:"Aug 20 (Thu) 7:30 P.M.",opponentName:"Drake",opponentText:"at Drake",location:"Des Moines, Iowa",result:"T, 1-1",full:"Aug 20 (Thu) 7:30 P.M. at Drake Des Moines, Iowa T, 1-1"}];
  const [game]=normalizeSidearmRows(rows,source);
  assert.equal(game.opponent,"Drake");
  assert.equal(game.homeAway,"away");
  assert.equal(game.status,"FINAL");
  assert.equal(game.result,"T");
  assert.equal(game.teamScore,1);
  assert.equal(game.opponentScore,1);
  assert.equal(game.countsForRecord,1);
});

test("exhibitions do not count toward record",()=>{
  const rows=[{date:"Aug 15 (Sat) 7 P.M.",opponentName:"Memphis",opponentText:"vs Memphis",location:"Bill Stephens Track/Soccer Complex",result:"",full:"Aug 15 (Sat) 7 P.M. vs Memphis Exhibition"}];
  const [game]=normalizeSidearmRows(rows,source);
  assert.equal(game.countsForRecord,0);
});

test("recognizes canceled and postponed states",()=>{
  assert.equal(parseResult("Canceled").status,"CANCELED");
  assert.equal(parseResult("Postponed").status,"POSTPONED");
});

test("parses Conway/Mascot Media style schedule row",()=>{
  const rows=[{cells:["","Aug 28 / 7:00 PM VS Capital High School (MO) John McConnell Stadium Conway, AR","John McConnell Stadium Conway, AR","- -"],full:"Aug 28 / 7:00 PM VS Capital High School (MO) John McConnell Stadium Conway, AR - -"}];
  const conway={season:"2026",timezone:"America/Chicago",home_venue:"John McConnell Stadium",home_latitude:35.0872,home_longitude:-92.4628};
  const [game]=normalizeMascotRows(rows,conway);
  assert.equal(game.opponent,"Capital High School (MO)");
  assert.equal(game.homeAway,"home");
  assert.equal(game.venue,"John McConnell Stadium");
});

test("parses Vilonia varsity volleyball from the official Mascot Media format",()=>{
  const rows=[{cells:["","Aug 25 / 05:30 PM VS Greenbrier TBD Vilonia, AR, AR","TBD Vilonia, AR, AR","- -"],full:"Aug 25 / 05:30 PM VS Greenbrier TBD Vilonia, AR, AR - -"}];
  const vilonia={season:"2026",timezone:"America/Chicago",home_venue:"Vilonia High School",home_latitude:35.0839,home_longitude:-92.2029};
  const [game]=normalizeMascotRows(rows,vilonia);
  assert.equal(game.opponent,"Greenbrier");
  assert.equal(game.homeAway,"home");
  assert.equal(game.venue,"TBD Vilonia, AR, AR");
  assert.equal(game.status,"SCHEDULED");
  assert.equal(game.scheduledTimeKnown,true);
});

test("keeps a multiword Conway away opponent separate from its field",()=>{
  const rows=[{cells:["","Oct 23 / 7:00 PM AT Pulaski Academy Pulaski Academy Field Little Rock, AR","Pulaski Academy Field Little Rock, AR","- -"],full:"Oct 23 / 7:00 PM AT Pulaski Academy Pulaski Academy Field Little Rock, AR - -"}];
  const conway={season:"2026",timezone:"America/Chicago",home_venue:"John McConnell Stadium",home_latitude:35.0872,home_longitude:-92.4628};
  const [game]=normalizeMascotRows(rows,conway);
  assert.equal(game.opponent,"Pulaski Academy");
  assert.equal(game.homeAway,"away");
  assert.equal(game.venue,"Pulaski Academy Field");
});
