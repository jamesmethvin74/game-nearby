import test from "node:test";
import assert from "node:assert/strict";
import {
  currentScheduleTruthSql,
  isResultOnlyObservationSource,
  resultOnlySourceSql,
  RESULT_ONLY_SOURCE_SUFFIX
} from "../src/current-schedule-truth.js";

test("result-only status is an explicit source role, never inferred from parser family",()=>{
  assert.equal(RESULT_ONLY_SOURCE_SUFFIX,"-official-school-results");

  // Full official school schedule sources are schedule authority even when they
  // use the same parser as supplemental result collectors.
  assert.equal(isResultOnlyObservationSource({
    source_id:"conway-football-official",
    source_type:"official-school",
    parser_type:"mascot-media"
  }),false);
  assert.equal(isResultOnlyObservationSource({
    source_id:"college-rankone-schedule",
    source_type:"official-school",
    parser_type:"rankone-public"
  }),false);

  // The bootstrapped supplemental result sources carry an explicit role in id.
  assert.equal(isResultOnlyObservationSource({
    source_id:"df-7x4sxh-football-2026-official-school-results",
    source_type:"official-school",
    parser_type:"mascot-media"
  }),true);
  assert.equal(isResultOnlyObservationSource({
    id:"some-team-official-school-results",
    parser_type:"rankone-public"
  }),true);

  assert.match(resultOnlySourceSql("src"),/official-school-results/);
  assert.doesNotMatch(resultOnlySourceSql("src"),/mascot-media/);
  assert.doesNotMatch(resultOnlySourceSql("src"),/rankone-public/);
  assert.match(currentScheduleTruthSql("g","src"),/official-school-results/);
});
