import test from "node:test";
import assert from "node:assert/strict";

import { parseMascotResultCell } from "../src/parser-core.js";
import { relatedObservationsForReconciliation } from "../src/canonical-observation-writer.js";
import { duplicateAndCrossSourceIssues } from "../src/record-truth-audit.js";

function observation(overrides={}) {
  return {
    id:"obs-1",
    reporting_school_id:"school-a",
    opponent_school_id:"school-b",
    sport:"volleyball",
    gender:"girls",
    season:"2026",
    scheduled_at:"2026-08-29T13:00:00.000Z",
    scheduled_time_known:1,
    home_away:"home",
    source_id:"source-a",
    source_event_key:"native:first-match",
    parser_type:"maxpreps-scores",
    ...overrides
  };
}

function auditCandidate(overrides={}) {
  return {
    id:"game-a",
    school_id:"school-a",
    opponent_school_id:"school-b",
    opponent:"School B",
    sport:"volleyball",
    gender:"girls",
    season:"2026",
    scheduled_at:"2026-08-25T23:00:00.000Z",
    status:"FINAL",
    team_score:3,
    opponent_score:0,
    result:"W",
    counts_for_record:1,
    source_id:"source-a",
    canonical_event_id:"ce:test",
    ...overrides
  };
}

test("Mascot volleyball placeholder T 0-0 stays non-final",()=>{
  assert.deepEqual(parseMascotResultCell("T 0 - 0",{sport:"volleyball"}),{
    status:"SCHEDULED",teamScore:null,opponentScore:null,result:null
  });
});

test("Mascot volleyball bare numeric scores become final team-oriented truth",()=>{
  assert.deepEqual(parseMascotResultCell("0 - 3",{sport:"volleyball"}),{
    status:"FINAL",teamScore:0,opponentScore:3,result:"L"
  });
  assert.deepEqual(parseMascotResultCell("3 - 1",{sport:"volleyball"}),{
    status:"FINAL",teamScore:3,opponentScore:1,result:"W"
  });
});

test("scoreless ties remain legitimate outside volleyball",()=>{
  assert.deepEqual(parseMascotResultCell("T 0 - 0",{sport:"soccer"}),{
    status:"FINAL",teamScore:0,opponentScore:0,result:"T"
  });
});

test("same-day native rematches do not absorb untimed generic observations",()=>{
  const first=observation({id:"first",source_event_key:"native:first-match",scheduled_at:"2026-08-29T13:00:00.000Z"});
  const second=observation({id:"second",source_event_key:"native:second-match",scheduled_at:"2026-08-29T20:00:00.000Z"});
  const generic=observation({
    id:"generic",
    source_id:"official-school",
    source_event_key:"school-b|home|1",
    parser_type:"mascot",
    scheduled_at:"2026-08-29T17:00:00.000Z",
    scheduled_time_known:0
  });
  const candidates=[first,second,generic];

  assert.deepEqual(
    relatedObservationsForReconciliation(first,candidates).map(row=>row.id),
    ["first"]
  );
  assert.deepEqual(
    relatedObservationsForReconciliation(second,candidates).map(row=>row.id),
    ["second"]
  );
  assert.deepEqual(
    relatedObservationsForReconciliation(generic,candidates),
    []
  );
});

test("single native match still accepts an untimed corroborating observation",()=>{
  const native=observation({id:"native"});
  const generic=observation({
    id:"generic",
    source_id:"official-school",
    source_event_key:"school-b|home|1",
    parser_type:"mascot",
    scheduled_time_known:0
  });
  assert.deepEqual(
    relatedObservationsForReconciliation(native,[native,generic]).map(row=>row.id),
    ["native","generic"]
  );
});

test("duplicate unresolved finals are incomplete evidence, not a source contradiction",()=>{
  const a=auditCandidate({id:"a",source_id:"dragonfly-a",team_score:null,opponent_score:null,result:null});
  const b=auditCandidate({id:"b",source_id:"dragonfly-b",team_score:null,opponent_score:null,result:null});
  assert.equal(
    duplicateAndCrossSourceIssues([a,b]).some(issue=>issue.code==="SAME_GAME_SOURCE_CONTRADICTION"),
    false
  );
});

test("verified versus unresolved duplicate final is not labeled a source contradiction",()=>{
  const verified=auditCandidate({id:"verified",source_id:"official-school"});
  const unresolved=auditCandidate({id:"unresolved",source_id:"dragonfly",team_score:null,opponent_score:null,result:null});
  assert.equal(
    duplicateAndCrossSourceIssues([verified,unresolved]).some(issue=>issue.code==="SAME_GAME_SOURCE_CONTRADICTION"),
    false
  );
});

test("two verifiable duplicate finals that disagree remain blocking",()=>{
  const win=auditCandidate({id:"win",source_id:"source-win",team_score:3,opponent_score:0,result:"W"});
  const loss=auditCandidate({id:"loss",source_id:"source-loss",team_score:0,opponent_score:3,result:"L"});
  const issues=duplicateAndCrossSourceIssues([win,loss]);
  assert.equal(issues.length,1);
  assert.equal(issues[0].code,"SAME_GAME_SOURCE_CONTRADICTION");
  assert.equal(issues[0].severity,"blocking");
  assert.match(issues[0].detail,/source-win=W 3-0/);
  assert.match(issues[0].detail,/source-loss=L 0-3/);
});
