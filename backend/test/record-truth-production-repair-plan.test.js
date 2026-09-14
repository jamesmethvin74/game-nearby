import test from "node:test";
import assert from "node:assert/strict";

import {
  RECORD_TRUTH_REPAIR_CASES,
  RECORD_TRUTH_REPAIR_TEAM_IDS,
  RECORD_TRUTH_PRODUCTION_REPAIR_PLAN,
  recordTruthProductionRepairPlan
} from "../src/record-truth-production-repair-plan.js";

test("production repair plan remains fail-closed and approval-gated",()=>{
  assert.equal(RECORD_TRUTH_PRODUCTION_REPAIR_PLAN.version,"record-truth-six-games-v2");
  assert.equal(RECORD_TRUTH_PRODUCTION_REPAIR_PLAN.approval_required,true);
  assert.equal(RECORD_TRUTH_PRODUCTION_REPAIR_PLAN.production_write_authorized,false);
  assert.equal(RECORD_TRUTH_PRODUCTION_REPAIR_PLAN.preflight.rows_written,0);
  assert.equal(RECORD_TRUTH_PRODUCTION_REPAIR_PLAN.preflight.rows_read_max,300);
  assert.equal(RECORD_TRUTH_PRODUCTION_REPAIR_PLAN.preflight.fail_closed,true);
});

test("all six isolated games remain represented",()=>{
  assert.equal(RECORD_TRUTH_REPAIR_CASES.length,6);
  assert.deepEqual(RECORD_TRUTH_REPAIR_CASES.map(item=>item.repair_class),[
    "already-repaired-partial-canonical",
    "already-repaired-partial-canonical",
    "poisoned-canonical",
    "corroborated-canonical-verification",
    "verified-rematch-split",
    "verified-rematch-split"
  ]);
});

test("only North Little Rock-Beebe remains write-capable",()=>{
  const beebe=RECORD_TRUTH_REPAIR_CASES.find(item=>item.key==="north-little-rock-beebe-20260824");
  assert.equal(beebe.execution,"repair-one-canonical-and-one-placeholder");
  assert.deepEqual(beebe.authoritative_game_ids,[
    "maxpreps-volleyball-results:df-hrdb8f-volleyball-2026:native:eccd4ee4-19ba-4805-8f3e-76057b40f3e2",
    "maxpreps-volleyball-results:df-jufft8-volleyball-2026:native:eccd4ee4-19ba-4805-8f3e-76057b40f3e2"
  ]);
  assert.equal(beebe.placeholder_game_id,"df-hrdb8f-volleyball-2026-official-school-results:beebe|away|1");
  assert.equal(RECORD_TRUTH_PRODUCTION_REPAIR_PLAN.write_fuses.primary_canonical_repairs_max,1);
  assert.equal(RECORD_TRUTH_PRODUCTION_REPAIR_PLAN.write_fuses.placeholder_game_rows_max,1);
  assert.equal(RECORD_TRUTH_PRODUCTION_REPAIR_PLAN.write_fuses.local_team_record_rebuilds_max,2);
  assert.equal(RECORD_TRUTH_PRODUCTION_REPAIR_PLAN.write_fuses.rematch_new_canonicals_max,0);
});

test("North Little Rock-Lakeside is pinned to exact reciprocal DragonFly evidence",()=>{
  const lakeside=RECORD_TRUTH_REPAIR_CASES.find(item=>item.key==="north-little-rock-lakeside-20260827");
  assert.equal(lakeside.execution,"verify-only-no-write");
  assert.deepEqual(lakeside.authoritative_contest_ids,["695c0750c5e8bf402b000008"]);
  assert.equal(lakeside.authoritative_game_ids.length,4);
  assert.ok(lakeside.authoritative_game_ids.every(id=>id.includes("native:695c0750c5e8bf402b000008")));
  assert.equal(lakeside.expected_home_school_id,"df-hrdb8f");
  assert.equal(lakeside.expected_away_school_id,"df-vt4unv");
  assert.equal(lakeside.expected_home_score,1);
  assert.equal(lakeside.expected_away_score,3);
});

test("both same-day rematches are verify-only exact splits",()=>{
  const harrison=RECORD_TRUTH_REPAIR_CASES.find(item=>item.key==="harrison-cotter-rematch-20260829");
  assert.equal(harrison.execution,"verify-existing-split-no-write");
  assert.equal(harrison.authoritative_game_ids.length,4);
  assert.match(harrison.second_canonical_id,/3fa66510-5b2b-47c8-b51a-642679c44b6a$/);

  const cabot=RECORD_TRUTH_REPAIR_CASES.find(item=>item.key==="cabot-blue-springs-south-rematch-20260829");
  assert.equal(cabot.execution,"verify-existing-split-no-write");
  assert.equal(cabot.authoritative_game_ids.length,2);
  assert.match(cabot.second_canonical_id,/df6a4eed-d762-4c70-abe3-624fd7452bcc$/);
});

test("catalog still records all ten affected local teams while write fuse is two",()=>{
  assert.equal(RECORD_TRUTH_REPAIR_TEAM_IDS.length,10);
  const plan=recordTruthProductionRepairPlan();
  assert.equal(plan.cases.length,6);
  assert.equal(plan.local_team_ids.length,10);
  assert.equal(plan.write_fuses.local_team_record_rebuilds_max,2);
});
