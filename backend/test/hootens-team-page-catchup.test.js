import test from "node:test";
import assert from "node:assert/strict";
import {
  hootensTeamSlug,
  parseHootensTeamPageResult,
  teamPageFinalForCandidate,
  selectBoundedTeamPageGroups,
  MAX_TEAM_PAGES
} from "../src/hootens-team-page-catchup.js";

test("Hootens team slugs preserve full school identity and use the site's LR convention",()=>{
  assert.equal(hootensTeamSlug("Central Arkansas Christian"),"central-arkansas-christian");
  assert.equal(hootensTeamSlug("Fort Smith Northside"),"fort-smith-northside");
  assert.equal(hootensTeamSlug("Southside (Batesville)"),"southside-batesville");
  assert.equal(hootensTeamSlug("Little Rock Central"),"lr-central");
});

test("strict Hootens result parser accepts coherent finals and rejects placeholders or contradictory labels",()=>{
  assert.deepEqual(parseHootensTeamPageResult("W 41 - 8"),{status:"FINAL",result:"W",teamScore:41,opponentScore:8});
  assert.deepEqual(parseHootensTeamPageResult("L 27 – 38"),{status:"FINAL",result:"L",teamScore:27,opponentScore:38});
  assert.equal(parseHootensTeamPageResult("—"),null);
  assert.equal(parseHootensTeamPageResult("W 7 - 21"),null);
});

test("team-page matching requires exact local date plus deterministic opponent identity",()=>{
  const rows=[
    ["09/04","Cutter Morning Star","7:00 PM","Central Arkansas Christian","W 41 - 8"],
    ["09/11","Mena","7:00 PM","Mena","—"]
  ];
  const final=teamPageFinalForCandidate(rows,{
    scheduled_at:"2026-09-05T00:00:00.000Z",
    opponent_school_name:"Cutter Morning Star"
  });
  assert.equal(final?.teamScore,41);
  assert.equal(final?.opponentScore,8);
  assert.equal(final?.result,"W");

  assert.equal(teamPageFinalForCandidate(rows,{
    scheduled_at:"2026-09-12T00:00:00.000Z",
    opponent_school_name:"Cutter Morning Star"
  }),null,"wrong date must not borrow another final");

  assert.equal(teamPageFinalForCandidate(rows,{
    scheduled_at:"2026-09-05T00:00:00.000Z",
    opponent_school_name:"Mena"
  }),null,"wrong opponent must not borrow another final");
});

test("current-season later row wins over a duplicate prior-season row before result parsing",()=>{
  const rows=[
    ["09/11","LR Southwest","7:00 PM","LR Central","W 31 - 14"],
    ["09/11","LR Southwest","7:00 PM","LR Central","—"]
  ];
  const final=teamPageFinalForCandidate(rows,{
    scheduled_at:"2026-09-12T00:00:00.000Z",
    opponent_school_name:"Little Rock Southwest"
  });
  assert.equal(final,null,"an old score must not leak into an unplayed current-season row");
});

test("current-season later scored row can replace an older duplicate score",()=>{
  const rows=[
    ["09/04","Lake Hamilton","7:00 PM","Marion","W 35 - 20"],
    ["09/04","Lake Hamilton","7:00 PM","Marion","L 27 - 38"]
  ];
  const final=teamPageFinalForCandidate(rows,{
    scheduled_at:"2026-09-05T00:00:00.000Z",
    opponent_school_name:"Lake Hamilton"
  });
  assert.equal(final?.result,"L");
  assert.equal(final?.teamScore,27);
  assert.equal(final?.opponentScore,38);
});

test("team-page selection enforces a hard distinct-page cap while keeping multiple gaps from selected schools",()=>{
  const candidates=[];
  for(let i=0;i<MAX_TEAM_PAGES+3;i++){
    candidates.push({
      team_id:`team-${i}`,
      school_id:`school-${i}`,
      school_name:`School ${i}`,
      scheduled_at:`2026-09-${String(i+1).padStart(2,"0")}T00:00:00.000Z`
    });
  }
  candidates.push({
    team_id:"team-0",
    school_id:"school-0",
    school_name:"School 0",
    scheduled_at:"2026-09-12T00:00:00.000Z"
  });

  const groups=selectBoundedTeamPageGroups(candidates);
  assert.equal(groups.length,MAX_TEAM_PAGES);
  assert.equal(groups[0].teamId,"team-0");
  assert.equal(groups[0].candidates.length,2);
  assert.equal(groups.some(group=>group.teamId===`team-${MAX_TEAM_PAGES}`),false);
});
