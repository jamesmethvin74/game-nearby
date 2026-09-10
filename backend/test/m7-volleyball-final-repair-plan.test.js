import test from "node:test";
import assert from "node:assert/strict";
import { M7_AUG17_FINAL_TARGETS, m7Aug17ReportingObservations } from "../src/m7-volleyball-final-repair-plan.js";

test("M7 Aug 17 repair cohort is exactly two local-local 3-0 finals",()=>{
  assert.equal(M7_AUG17_FINAL_TARGETS.length,2);
  assert.deepEqual(M7_AUG17_FINAL_TARGETS.map(row=>[row.home.name,row.home.score,row.away.name,row.away.score]),[
    ["Gentry",3,"Decatur",0],
    ["Lonoke",3,"Stuttgart",0]
  ]);
});

test("M7 Aug 17 repair produces exactly four deterministic reporting observations",()=>{
  const rows=m7Aug17ReportingObservations();
  assert.equal(rows.length,4);
  assert.equal(new Set(rows.map(row=>row.game_id)).size,4);
  assert.equal(new Set(rows.map(row=>row.source_id)).size,4);
  for(const row of rows){
    assert.match(row.source_id,/^maxpreps-volleyball-results:/);
    assert.match(row.source_event_key,/^native:/);
    assert.ok(row.canonical_event_id.startsWith("ce:volleyball:girls:2026:"));
    assert.equal(row.result,row.team_score>row.opponent_score?"W":"L");
  }
});
