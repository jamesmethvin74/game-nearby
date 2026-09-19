import test from "node:test";
import assert from "node:assert/strict";
import { currentScheduleTruthSql, isResultOnlyObservationSource, resultOnlySourceSql } from "../src/current-schedule-truth.js";

test("official-school result parsers are observations, never standalone schedule authority",()=>{
  assert.equal(isResultOnlyObservationSource({source_type:"official-school",parser_type:"mascot-media"}),true);
  assert.equal(isResultOnlyObservationSource({source_type:"official-school",parser_type:"rankone-public"}),true);
  assert.equal(isResultOnlyObservationSource({source_type:"official-conference",parser_type:"dragonfly-public"}),false);
  assert.match(resultOnlySourceSql("src"),/mascot-media/);
  assert.match(resultOnlySourceSql("src"),/rankone-public/);
  assert.match(currentScheduleTruthSql("g","src"),/official-school/);
});
