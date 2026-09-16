import test from "node:test";
import assert from "node:assert/strict";
import { buildCollegeConferenceMembership } from "../src/college-conference-membership.js";

const built=buildCollegeConferenceMembership({verifiedAt:"2026-09-15T12:00:00Z"});
const byTeam=new Map(built.memberships.map(row=>[row.team_id,row]));

test("2026 UCA realignment is sport-specific",()=>{
  assert.match(byTeam.get("uca-football-men-2026").conference_id,/united-athletic-conference/);
  assert.match(byTeam.get("uca-basketball-women-2026").conference_id,/united-athletic-conference/);
  assert.match(byTeam.get("uca-volleyball-women-2026").conference_id,/united-athletic-conference/);
  assert.match(byTeam.get("uca-soccer-men-2026").conference_id,/atlantic-sun-conference/);
});

test("Little Rock is a 2026 full UAC member",()=>{
  for(const id of ["little-rock-basketball-men-2026","little-rock-basketball-women-2026","little-rock-soccer-women-2026","little-rock-volleyball-women-2026"])
    assert.match(byTeam.get(id).conference_id,/united-athletic-conference/);
});

test("Lyon football is SCAC while other supported teams remain SLIAC",()=>{
  assert.match(byTeam.get("lyon-football-men-2026").conference_id,/southern-collegiate-athletic-conference/);
  assert.match(byTeam.get("lyon-volleyball-women-2026").conference_id,/st-louis-intercollegiate-athletic-conference/);
});

test("conference ids include sport and gender so standings cohorts cannot mix",()=>{
  assert.notEqual(byTeam.get("uark-basketball-men-2026").conference_id,byTeam.get("uark-basketball-women-2026").conference_id);
  assert.match(byTeam.get("uark-basketball-men-2026").conference_id,/basketball-men$/);
  assert.match(byTeam.get("uark-basketball-women-2026").conference_id,/basketball-women$/);
});

test("current college population has explicit membership rows for every supported inventory team",()=>{
  assert.equal(built.unresolved.length,0);
  assert.ok(built.memberships.length>0);
  assert.ok(built.memberships.every(row=>row.membership_state==="member"));
});
