import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  FINAL_MISSING_SCORE_CASES,
  classifyFinalMissingScoreRows,
  FINAL_MISSING_SCORE_FINGERPRINT_PREFIX,
  MAX_PLAN_READS,
  MAX_DIRECT_WRITES
} from "../src/final-missing-score-repair.js";
import { FINAL_MISSING_SCORE_PLAN_PATH, FINAL_MISSING_SCORE_EXECUTE_PATH } from "../src/logo-bootstrap-worker.js";

function rows({complete=false,contradict=false}={}){
  return FINAL_MISSING_SCORE_CASES.flatMap(item=>[
    {canonical_id:item.canonicalId,canonical_status:"FINAL",home_school_id:item.homeSchoolId,away_school_id:item.awaySchoolId,home_score:complete?0:null,away_score:3,game_id:`${item.key}:home:a`,reporting_team_id:item.homeTeamId,source_id:`${item.key}:home:a`,game_status:"FINAL",team_score:contradict?1:0,opponent_score:3,game_result:"L"},
    {canonical_id:item.canonicalId,canonical_status:"FINAL",home_school_id:item.homeSchoolId,away_school_id:item.awaySchoolId,home_score:complete?0:null,away_score:3,game_id:`${item.key}:home:b`,reporting_team_id:item.homeTeamId,source_id:`${item.key}:home:b`,game_status:"FINAL",team_score:null,opponent_score:3,game_result:"L"},
    {canonical_id:item.canonicalId,canonical_status:"FINAL",home_school_id:item.homeSchoolId,away_school_id:item.awaySchoolId,home_score:complete?0:null,away_score:3,game_id:`${item.key}:away:a`,reporting_team_id:item.awayTeamId,source_id:`${item.key}:away:a`,game_status:"FINAL",team_score:3,opponent_score:0,game_result:"W"},
    {canonical_id:item.canonicalId,canonical_status:"FINAL",home_school_id:item.homeSchoolId,away_school_id:item.awaySchoolId,home_score:complete?0:null,away_score:3,game_id:`${item.key}:away:b`,reporting_team_id:item.awayTeamId,source_id:`${item.key}:away:b`,game_status:"FINAL",team_score:3,opponent_score:null,game_result:"W"},
    {canonical_id:item.canonicalId,canonical_status:"FINAL",home_school_id:item.homeSchoolId,away_school_id:item.awaySchoolId,home_score:complete?0:null,away_score:3,game_id:`${item.key}:scheduled`,reporting_team_id:item.homeTeamId,source_id:`${item.key}:school`,game_status:"SCHEDULED",team_score:null,opponent_score:null,game_result:null}
  ]);
}

const venueConflict=[{id:1,canonical_event_id:FINAL_MISSING_SCORE_CASES[1].canonicalId,conflict_type:"VENUE",values_json:'["a","b"]',resolved_at:null}];

test("four audit flags are two reciprocal canonical finals",()=>{
  assert.equal(FINAL_MISSING_SCORE_CASES.length,2);
  assert.equal(new Set(FINAL_MISSING_SCORE_CASES.map(item=>item.canonicalId)).size,2);
  assert.equal(new Set(FINAL_MISSING_SCORE_CASES.flatMap(item=>[item.homeTeamId,item.awayTeamId])).size,4);
});

test("duplicate source observations and unrelated venue conflict do not block proven score resolution",()=>{
  const result=classifyFinalMissingScoreRows(rows(),venueConflict);
  assert.equal(result.safe,true);
  assert.deepEqual(result.reasons,[]);
  assert.deepEqual(result.cases.map(item=>item.action),["apply_canonical_resolution","apply_canonical_resolution"]);
  assert.equal(result.cases[1].current.ignored_venue_conflict_count,1);
});

test("canonical completion is idempotent even when raw source rows remain partial",()=>{
  const result=classifyFinalMissingScoreRows(rows({complete:true}),venueConflict);
  assert.equal(result.safe,true);
  assert.deepEqual(result.cases.map(item=>item.action),["already_complete","already_complete"]);
});

test("contradictory FINAL observation fails closed",()=>{
  const result=classifyFinalMissingScoreRows(rows({contradict:true}),venueConflict);
  assert.equal(result.safe,false);
  assert.match(result.reasons.join(" "),/contradicts verified 0-3 result/);
});

test("score or result conflicts still block execution",()=>{
  const conflict=[{id:2,canonical_event_id:FINAL_MISSING_SCORE_CASES[0].canonicalId,conflict_type:"SCORE",values_json:'["3-0","3-1"]',resolved_at:null}];
  const result=classifyFinalMissingScoreRows(rows(),conflict);
  assert.equal(result.safe,false);
  assert.match(result.reasons.join(" "),/blocking active conflicts=SCORE/);
});

test("repair writes only canonical truth and rebuilds four touched records",async()=>{
  assert.equal(FINAL_MISSING_SCORE_FINGERPRINT_PREFIX,"final-missing-score-two-games-v2");
  assert.ok(MAX_PLAN_READS<=200);
  assert.equal(MAX_DIRECT_WRITES,2);
  assert.match(FINAL_MISSING_SCORE_PLAN_PATH,/final-missing-score-plan/);
  assert.match(FINAL_MISSING_SCORE_EXECUTE_PATH,/final-missing-score-execute/);
  const source=await readFile(new URL("../src/final-missing-score-repair.js",import.meta.url),"utf8");
  assert.match(source,/fingerprint!==plan\.fingerprint/);
  assert.match(source,/canonical write count mismatch/);
  assert.match(source,/direct write fuse tripped/);
  assert.match(source,/rebuildTeamRecords\(env,touchedTeamIds/);
  assert.doesNotMatch(source,/UPDATE games/);
  assert.doesNotMatch(source,/UPDATE event_conflicts/);
});
