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

test("Mascot Media jamborees never count toward the official record",()=>{
  const rows=[{cells:["Aug 20 5:00 PM VS Jamboree Conway High School Conway, AR","Jamboree","- -",""],full:"Aug 20 5:00 PM VS Jamboree Conway High School Conway, AR"}];
  const conway={season:"2026",timezone:"America/Chicago",home_venue:"Conway High School",home_latitude:35.0872,home_longitude:-92.4628};
  const [game]=normalizeMascotRows(rows,conway);
  assert.equal(game.opponent,"Jamboree");
  assert.equal(game.countsForRecord,0);
  assert.match(game.notes,/jamboree/i);
});

test("parses Vilonia varsity volleyball from the official combined-cell Mascot Media format",()=>{
  const rows=[{cells:["","Aug 25 / 05:30 PM VS Greenbrier TBD Vilonia, AR, AR","TBD Vilonia, AR, AR","- -"],full:"Aug 25 / 05:30 PM VS Greenbrier TBD Vilonia, AR, AR - -"}];
  const vilonia={season:"2026",timezone:"America/Chicago",home_venue:"Vilonia High School",home_latitude:35.0839,home_longitude:-92.2029};
  const [game]=normalizeMascotRows(rows,vilonia);
  assert.equal(game.opponent,"Greenbrier");
  assert.equal(game.homeAway,"home");
  assert.equal(game.venue,"TBD Vilonia, AR, AR");
  assert.equal(game.status,"SCHEDULED");
  assert.equal(game.scheduledTimeKnown,true);
});

test("parses Greenbrier varsity volleyball from the official split-column Mascot Media format",()=>{
  const rows=[{cells:["Aug 25 4:30 PM @ Vilonia Vilonia Vilonia, AR","Vilonia","W 3 - 0",""],full:"Aug 25 4:30 PM @ Vilonia Vilonia Vilonia, AR W 3 - 0"}];
  const greenbrier={season:"2026",timezone:"America/Chicago",home_venue:"Greenbrier High School",home_latitude:35.2334,home_longitude:-92.3870};
  const [game]=normalizeMascotRows(rows,greenbrier,{now:new Date("2026-08-25T23:00:00.000Z")});
  assert.equal(game.opponent,"Vilonia");
  assert.equal(game.homeAway,"away");
  assert.equal(game.status,"FINAL");
  assert.equal(game.result,"W");
  assert.equal(game.teamScore,3);
  assert.equal(game.opponentScore,0);
});

test("Mascot Media cannot publish a known-time future game as FINAL",()=>{
  const rows=[{cells:["Sep 19 4:30 PM VS Clarksville Pea Ridge, AR","Clarksville","W 3 - 0",""],full:"Sep 19 4:30 PM VS Clarksville Pea Ridge, AR W 3 - 0"}];
  const peaRidge={season:"2026",sport:"volleyball",timezone:"America/Chicago",home_venue:"Pea Ridge High School",home_latitude:36.4537,home_longitude:-94.1152};
  const [game]=normalizeMascotRows(rows,peaRidge,{now:new Date("2026-09-11T21:00:00.000Z")});
  assert.equal(game.status,"SCHEDULED");
  assert.equal(game.teamScore,null);
  assert.equal(game.opponentScore,null);
  assert.equal(game.result,null);
  assert.equal(game.scheduledTimeKnown,true);
});

test("Mascot Media preserves the same scored row once its scheduled time has passed",()=>{
  const rows=[{cells:["Sep 19 4:30 PM VS Clarksville Pea Ridge, AR","Clarksville","W 3 - 0",""],full:"Sep 19 4:30 PM VS Clarksville Pea Ridge, AR W 3 - 0"}];
  const peaRidge={season:"2026",sport:"volleyball",timezone:"America/Chicago",home_venue:"Pea Ridge High School",home_latitude:36.4537,home_longitude:-94.1152};
  const [game]=normalizeMascotRows(rows,peaRidge,{now:new Date("2026-09-20T00:00:00.000Z")});
  assert.equal(game.status,"FINAL");
  assert.equal(game.teamScore,3);
  assert.equal(game.opponentScore,0);
  assert.equal(game.result,"W");
});

test("suppresses the proven false Pea Ridge Harrison Aug 24 Mascot observation",()=>{
  const rows=[{cells:["Aug 24 6:00 PM @ Harrison Harrison, AR","Harrison","L 0 - 3",""],full:"Aug 24 6:00 PM @ Harrison Harrison, AR L 0 - 3"}];
  const peaRidge={team_id:"df-7x4sxh-volleyball-2026",season:"2026",sport:"volleyball",timezone:"America/Chicago",home_venue:"Pea Ridge High School",home_latitude:36.4537,home_longitude:-94.1152};
  const games=normalizeMascotRows(rows,peaRidge,{now:new Date("2026-08-25T03:00:00.000Z")});
  assert.equal(games.length,0);
});

test("does not suppress a Pea Ridge Harrison game on another date",()=>{
  const rows=[{cells:["Sep 11 6:00 PM @ Harrison Harrison, AR","Harrison","- -",""],full:"Sep 11 6:00 PM @ Harrison Harrison, AR - -"}];
  const peaRidge={team_id:"df-7x4sxh-volleyball-2026",season:"2026",sport:"volleyball",timezone:"America/Chicago",home_venue:"Pea Ridge High School",home_latitude:36.4537,home_longitude:-94.1152};
  const games=normalizeMascotRows(rows,peaRidge,{now:new Date("2026-09-11T20:00:00.000Z")});
  assert.equal(games.length,1);
  assert.equal(games[0].opponent,"Harrison");
});

test("keeps a multiword Conway away opponent separate from its field",()=>{
  const rows=[{cells:["","Oct 23 / 7:00 PM AT Pulaski Academy Pulaski Academy Field Little Rock, AR","Pulaski Academy Field Little Rock, AR","- -"],full:"Oct 23 / 7:00 PM AT Pulaski Academy Pulaski Academy Field Little Rock, AR - -"}];
  const conway={season:"2026",timezone:"America/Chicago",home_venue:"John McConnell Stadium",home_latitude:35.0872,home_longitude:-92.4628};
  const [game]=normalizeMascotRows(rows,conway);
  assert.equal(game.opponent,"Pulaski Academy");
  assert.equal(game.homeAway,"away");
  assert.equal(game.venue,"Pulaski Academy Field");
});
