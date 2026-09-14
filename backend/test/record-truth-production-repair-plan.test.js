import test from "node:test";
import assert from "node:assert/strict";

import {
  RECORD_TRUTH_REPAIR_CASES,
  RECORD_TRUTH_REPAIR_TEAM_IDS,
  RECORD_TRUTH_PRODUCTION_REPAIR_PLAN,
  recordTruthProductionRepairPlan
} from "../src/record-truth-production-repair-plan.js";

test("production repair plan is fail-closed and does not authorize writes",()=>{
  assert.equal(RECORD_TRUTH_PRODUCTION_REPAIR_PLAN.version,"record-truth-six-games-v1");
  assert.equal(RECORD_TRUTH_PRODUCTION_REPAIR_PLAN.approval_required,true);
  assert.equal(RECORD_TRUTH_PRODUCTION_REPAIR_PLAN.production_write_authorized,false);
  assert.equal(RECORD_TRUTH_PRODUCTION_REPAIR_PLAN.preflight.rows_written,0);
  assert.equal(RECORD_TRUTH_PRODUCTION_REPAIR_PLAN.preflight.fail_closed,true);
  assert.equal(RECORD_TRUTH_PRODUCTION_REPAIR_PLAN.postcondition.final_statewide_audit_requires_separate_read_approval,true);
});

test("repair plan contains exactly the six isolated bad-game cases",()=>{
  assert.equal(RECORD_TRUTH_REPAIR_CASES.length,6);
  assert.deepEqual(RECORD_TRUTH_REPAIR_CASES.map(item=>item.repair_class),[
    "partial-canonical-score",
    "partial-canonical-score",
    "poisoned-canonical",
    "poisoned-canonical",
    "same-day-rematch-split",
    "same-day-rematch-split"
  ]);
  assert.equal(new Set(RECORD_TRUTH_REPAIR_CASES.map(item=>item.canonical_id)).size,6);
});

test("North Little Rock authoritative finals are pinned to exact native contests",()=>{
  const beebe=RECORD_TRUTH_REPAIR_CASES.find(item=>item.key==="north-little-rock-beebe-20260824");
  assert.deepEqual(beebe.authoritative_contest_ids,["eccd4ee4-19ba-4805-8f3e-76057b40f3e2"]);
  assert.equal(beebe.expected_home_school_id,"df-jufft8");
  assert.equal(beebe.expected_away_school_id,"df-hrdb8f");
  assert.equal(beebe.expected_home_score,3);
  assert.equal(beebe.expected_away_score,0);

  const lakeside=RECORD_TRUTH_REPAIR_CASES.find(item=>item.key==="north-little-rock-lakeside-20260827");
  assert.deepEqual(lakeside.authoritative_contest_ids,["c15af614-2501-4437-ad9e-2a87b7d3b991"]);
  assert.equal(lakeside.expected_home_school_id,"df-hrdb8f");
  assert.equal(lakeside.expected_away_school_id,"df-vt4unv");
  assert.equal(lakeside.expected_home_score,1);
  assert.equal(lakeside.expected_away_score,3);
});

test("same-day rematches are pinned to two different native contest ids and outcomes",()=>{
  const harrison=RECORD_TRUTH_REPAIR_CASES.find(item=>item.key==="harrison-cotter-rematch-20260829");
  assert.deepEqual(harrison.authoritative_contest_ids,[
    "350185fc-ef8a-471b-a26e-1c9f04dfc231",
    "3fa66510-5b2b-47c8-b51a-642679c44b6a"
  ]);
  assert.deepEqual(harrison.authoritative_truth["350185fc-ef8a-471b-a26e-1c9f04dfc231"],{harrison:2,cotter:0});
  assert.deepEqual(harrison.authoritative_truth["3fa66510-5b2b-47c8-b51a-642679c44b6a"],{harrison:3,cotter:1});

  const cabot=RECORD_TRUTH_REPAIR_CASES.find(item=>item.key==="cabot-blue-springs-south-rematch-20260829");
  assert.deepEqual(cabot.authoritative_contest_ids,[
    "441a726d-4c94-4d68-bae8-4101f7d54446",
    "df6a4eed-d762-4c70-abe3-624fd7452bcc"
  ]);
  assert.deepEqual(cabot.authoritative_truth["441a726d-4c94-4d68-bae8-4101f7d54446"],{cabot:2,blue_springs_south:0});
  assert.deepEqual(cabot.authoritative_truth["df6a4eed-d762-4c70-abe3-624fd7452bcc"],{cabot:1,blue_springs_south:2});
});

test("repair rebuild scope contains only the ten affected local teams",()=>{
  assert.equal(RECORD_TRUTH_REPAIR_TEAM_IDS.length,10);
  assert.equal(RECORD_TRUTH_REPAIR_TEAM_IDS.includes("df-kq5hlr-volleyball-2026"),true);
  assert.equal(RECORD_TRUTH_REPAIR_TEAM_IDS.some(id=>id.includes("blue-springs")),false);
  const plan=recordTruthProductionRepairPlan();
  assert.equal(plan.cases.length,6);
  assert.equal(plan.local_team_ids.length,10);
});
